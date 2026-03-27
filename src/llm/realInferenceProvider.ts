import { InferenceMode, InferenceProvider, PromptPayload, RetryProgressHook, SimulationConfig } from "../core/types.js";
import { SecretStore } from "../security/secretStore.js";
import { MockInferenceProvider } from "./mockInferenceProvider.js";

const LOCAL_MODES: InferenceMode[] = ["ollama", "lmstudio", "mock-local"];
const CLOUD_MODES: InferenceMode[] = ["openai", "groq", "mock-cloud"];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(attempts: number, fn: () => Promise<T>, onRetryProgress?: RetryProgressHook): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts) {
        onRetryProgress?.(i + 1, (error as Error).message);
        await wait(250 * 2 ** i);
      }
    }
  }
  throw lastError;
}

async function parseProviderError(response: Response): Promise<string> {
  const retryAfter = response.headers.get("retry-after");
  const remaining = response.headers.get("x-ratelimit-remaining-requests") ?? response.headers.get("x-ratelimit-remaining");

  let detail = "";
  try {
    const data = (await response.json()) as { error?: { message?: string; type?: string }; message?: string };
    detail = data.error?.message ?? data.message ?? "";
  } catch {
    detail = "";
  }

  const extras = [
    retryAfter ? `retry_after=${retryAfter}` : "",
    remaining ? `remaining=${remaining}` : ""
  ]
    .filter(Boolean)
    .join(", ");

  return [detail, extras].filter(Boolean).join(" | ");
}

type ProviderResponseShape = {
  response?: string;
  text?: string;
  output_text?: string;
  content?: Array<{ type?: string; text?: string | { value?: string } }>;
  choices?: Array<{
    text?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string | { value?: string } }>;
    };
  }>;
};

function extractTextFromContentParts(
  parts: Array<{ type?: string; text?: string | { value?: string } }> | undefined
): string | null {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const joined = parts
    .map((part) => {
      if (typeof part?.text === "string") return part.text;
      if (part?.text && typeof part.text === "object" && typeof part.text.value === "string") return part.text.value;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return joined.length ? joined : null;
}

function extractProviderText(data: ProviderResponseShape): string {
  const chatMessageContent = data.choices?.[0]?.message?.content;
  if (typeof chatMessageContent === "string" && chatMessageContent.trim()) return chatMessageContent;
  if (Array.isArray(chatMessageContent)) {
    const fromParts = extractTextFromContentParts(chatMessageContent);
    if (fromParts) return fromParts;
  }

  const choiceText = data.choices?.[0]?.text;
  if (typeof choiceText === "string" && choiceText.trim()) return choiceText;

  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  if (typeof data.response === "string" && data.response.trim()) return data.response;
  if (typeof data.text === "string" && data.text.trim()) return data.text;

  const topLevelContent = extractTextFromContentParts(data.content);
  if (topLevelContent) return topLevelContent;

  return "";
}

function systemPromptForPayload(payload: PromptPayload): string {
  const transcript = payload.context.transcript.trim();
  const transcriptDirective = transcript
    ? `Highest priority: react directly to the streamer's latest words from context.transcript ("${transcript.slice(0, 220)}").`
    : "No transcript text is available right now; infer likely chat reactions from tone + vision tags without inventing quoted speech.";

  return [
    'Return strict JSON only: {"messages":[{"text":"string","emotes":["string"],"donationCents":number?,"ttsText":"string?"}]}. Never include usernames.',
    "You are simulating a live audience reacting to the streamer in real time (not a generic standalone chat).",
    transcriptDirective,
    "Treat context.transcript as more important than persona flavor text when they conflict.",
    "Reference concrete details from context (transcript/tone/vision) in at least half of the messages."
  ].join(" ");
}

function cloudModelSupportsTemperature(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return !/^gpt-5(?:$|[-:])/.test(normalized);
}

export class HybridInferenceProvider implements InferenceProvider {
  private readonly mockProvider = new MockInferenceProvider();
  private readonly secretStore = new SecretStore();

  constructor(private readonly mode: InferenceMode) {}

  public validateConfig(config: SimulationConfig): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (LOCAL_MODES.includes(this.mode)) {
      if (!config.provider.localEndpoint.startsWith("http")) errors.push("Local endpoint must be an HTTP URL.");
      if (!config.provider.localModel) errors.push("Local model is required.");
      if (
        config.security.sidecarLocalhostOnly &&
        !config.security.allowNonLocalSidecarOverride &&
        !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(config.provider.localEndpoint)
      ) {
        errors.push("Localhost-only sidecar policy blocks non-local local endpoint. Enable explicit override to continue.");
      }
    }
    if (CLOUD_MODES.includes(this.mode)) {
      if (!config.provider.cloudEndpoint.startsWith("http")) errors.push("Cloud endpoint must be an HTTP URL.");
      if (!config.provider.cloudModel) errors.push("Cloud model is required.");
    }

    return { ok: errors.length === 0, errors };
  }

  public async healthCheck(config: SimulationConfig): Promise<{ ok: boolean; details: string }> {
    if (this.mode === "mock-local" || this.mode === "mock-cloud") {
      return { ok: true, details: "Mock provider healthy." };
    }

    try {
      const endpoint = LOCAL_MODES.includes(this.mode) ? `${config.provider.localEndpoint}/api/tags` : this.healthEndpointForCloud(config);
      const response = await fetch(endpoint, { method: "GET", signal: AbortSignal.timeout(config.provider.requestTimeoutMs) });
      if (!response.ok) return { ok: false, details: `HTTP ${response.status}` };
      return { ok: true, details: `Reachable: ${endpoint}` };
    } catch (error) {
      return { ok: false, details: (error as Error).message };
    }
  }

  public async generate(payload: PromptPayload, config: SimulationConfig, onRetryProgress?: RetryProgressHook): Promise<string> {
    if (this.mode === "mock-local" || this.mode === "mock-cloud") {
      return this.mockProvider.generate(payload, { ...config, inferenceMode: this.mode }, onRetryProgress);
    }

    try {
      return await withRetry(
        config.provider.maxRetries,
        async () => {
          if (this.mode === "ollama" || this.mode === "lmstudio") {
            return this.generateLocal(payload, config);
          }
          return this.generateCloud(payload, config);
        },
        onRetryProgress
      );
    } catch (primaryError) {
      if (this.mode === "ollama" || this.mode === "lmstudio") {
        onRetryProgress?.(config.provider.maxRetries + 1, `Local failure: ${(primaryError as Error).message}; falling back to cloud.`);
        return withRetry(config.provider.maxRetries, async () => this.generateCloud(payload, config), onRetryProgress);
      }
      throw primaryError;
    }
  }

  private async generateLocal(payload: PromptPayload, config: SimulationConfig): Promise<string> {
    const isLmStudio = this.mode === "lmstudio";
    const endpoint = isLmStudio ? `${config.provider.localEndpoint}/v1/chat/completions` : `${config.provider.localEndpoint}/api/generate`;
    const body = isLmStudio
      ? {
          model: config.provider.localModel,
          temperature: 0.8,
          messages: [
            { role: "system", content: systemPromptForPayload(payload) },
            { role: "user", content: JSON.stringify(payload) }
          ]
        }
      : {
          model: config.provider.localModel,
          stream: false,
          prompt: JSON.stringify(payload)
        };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(config.provider.requestTimeoutMs),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Local provider failed (${response.status})`);
    }

    const data = (await response.json()) as ProviderResponseShape;
    return extractProviderText(data);
  }

  private async generateCloud(payload: PromptPayload, config: SimulationConfig): Promise<string> {
    const apiKey = this.secretStore.getCloudApiKey();
    if (!apiKey) {
      throw new Error("Missing cloud API key in keychain for cloud provider.");
    }

    const body: {
      model: string;
      temperature?: number;
      messages: Array<{ role: "system" | "user"; content: string }>;
    } = {
      model: config.provider.cloudModel,
      messages: [
        { role: "system", content: systemPromptForPayload(payload) },
        { role: "user", content: JSON.stringify(payload) }
      ]
    };
    if (cloudModelSupportsTemperature(config.provider.cloudModel)) {
      body.temperature = 0.8;
    }

    let response: Response;
    try {
      response = await fetch(config.provider.cloudEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.cloudHeaders(apiKey)
        },
        signal: AbortSignal.timeout(config.provider.requestTimeoutMs),
        body: JSON.stringify(body)
      });
    } catch (error) {
      const message = (error as Error).message || "request failed";
      throw new Error(`Cloud provider timeout/network failure: ${message}`);
    }

    if (!response.ok) {
      const detail = await parseProviderError(response);
      throw new Error(`Cloud provider failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    const data = (await response.json()) as ProviderResponseShape;
    return extractProviderText(data);
  }

  private healthEndpointForCloud(config: SimulationConfig): string {
    if (this.mode === "openai") return config.provider.cloudEndpoint.replace(/\/chat\/completions$/, "/models");
    if (this.mode === "groq") return config.provider.cloudEndpoint.replace(/\/chat\/completions$/, "/models");
    return config.provider.cloudEndpoint;
  }

  private cloudHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (this.mode === "openai") {
      headers["OpenAI-Beta"] = "assistants=v2";
    }
    if (this.mode === "groq") {
      headers["X-StreamSim-Provider"] = "groq";
    }
    return headers;
  }
}
