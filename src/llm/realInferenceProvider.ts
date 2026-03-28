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

function effectiveRetryCount(maxRetries: number, requestTimeoutMs: number): number {
  if (requestTimeoutMs >= 30000) return 0;
  if (requestTimeoutMs >= 15000) return Math.min(maxRetries, 1);
  return maxRetries;
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
    ? `Highest priority: react directly to the streamer's latest words from context.transcript ("${transcript.slice(0, 220)}"). Prioritize the most recent ~10 seconds (the tail end of context.transcript) as the primary signal, and use earlier transcript lines only as background context.`
    : "No transcript text is available right now. Fall back to persona-led small talk and channel chatter topics without claiming missing feeds or missing tags.";
  const questionDirective = transcript && /\?/.test(transcript)
    ? "The transcript includes a question; at least one message must directly answer or acknowledge that question."
    : "If no question is present in the transcript, avoid inventing one.";

  return [
    'Return strict JSON only: {"messages":[{"text":"string","emotes":["string"],"donationCents":number?,"ttsText":"string?"}]}. Never include usernames.',
    "You are simulating a live audience reacting to the streamer in real time (not a generic standalone chat).",
    transcriptDirective,
    questionDirective,
    "Treat context.transcript as more important than persona flavor text when they conflict.",
    "At least 55% of messages must reference specific transcript/tone/vision details; the rest can be side-convos, memes, or crowd noise.",
    "Do not simply repeat or lightly rephrase the streamer's words back to them.",
    "Use rapid-fire Twitch-style pacing: 60%+ of messages must be under 5 words.",
    "Keep most messages short fragments, meme slang, or reactions like 'W', 'LMAO', 'ratio', 'wait what?', 'nah', 'cooked'.",
    "If the streamer gives a clear chat command (examples: 'drop F in chat', 'spam W', 'type yes/no'), many messages should follow that command literally.",
    "Some viewers should be emote-only (message text can be empty while emotes are populated).",
    "Do not feel obligated to acknowledge every streamer line; realistic chats often drift into side chatter.",
    "React to the stream context like a real viewer with casual slang and natural chat energy.",
    "Never mention RMS, WPM, telemetry, diagnostics, pipelines, or whether tags/transcript are missing.",
    "Do not break the fourth wall by discussing system input quality or capture internals.",
    "Do not output generic filler like 'positive vibes', 'keep it up', or cheerleading with no context anchors.",
    "Supportive persona means kind tone, not generic praise; keep every message situational and reactive."
  ].join(" ");
}

function describeEnergy(volumeRms: number): "low" | "steady" | "high" {
  if (volumeRms < 0.34) return "low";
  if (volumeRms > 0.62) return "high";
  return "steady";
}

function describePace(paceWpm: number): "slow" | "normal" | "fast" {
  if (paceWpm < 100) return "slow";
  if (paceWpm > 155) return "fast";
  return "normal";
}

function buildModelFacingPayload(payload: PromptPayload): Record<string, unknown> {
  return {
    persona: payload.persona,
    bias: payload.bias,
    emoteOnly: payload.emoteOnly,
    viewerCount: payload.viewerCount,
    requestedMessageCount: payload.requestedMessageCount,
    context: {
      transcript: payload.context.transcript,
      transcriptAvailable: payload.context.transcript.trim().length > 0,
      tone: {
        energy: describeEnergy(payload.context.tone.volumeRms),
        pace: describePace(payload.context.tone.paceWpm)
      },
      visionTags: payload.context.visionTags,
      timestamp: payload.context.timestamp
    },
    personaCalibration: payload.personaCalibration,
    providerConditioning: payload.providerConditioning
  };
}

function cloudModelSupportsTemperature(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return !/^gpt-5(?:$|[.:-])/.test(normalized);
}

const CLOUD_MODEL_FALLBACKS: Record<string, string[]> = {
  "gpt-5.4-nano-2026-03-17": ["gpt-5-mini", "gpt-4o-mini"],
  "gpt-5-nano": ["gpt-5-mini", "gpt-4o-mini"]
};

function cloudModelCandidates(model: string): string[] {
  const normalized = model.trim().toLowerCase();
  const candidates = [model.trim(), ...(CLOUD_MODEL_FALLBACKS[normalized] ?? [])];
  return candidates.filter((candidate, idx) => candidate.length > 0 && candidates.indexOf(candidate) === idx);
}

function isRetryableCloudFailure(message: string): boolean {
  return /timeout|network failure|\(408\)|\(429\)|\(5\d\d\)/i.test(message);
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

    const retries = effectiveRetryCount(config.provider.maxRetries, config.provider.requestTimeoutMs);

    try {
      return await withRetry(
        retries,
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
        onRetryProgress?.(retries + 1, `Local failure: ${(primaryError as Error).message}; falling back to cloud.`);
        return withRetry(retries, async () => this.generateCloud(payload, config), onRetryProgress);
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
            { role: "user", content: JSON.stringify(buildModelFacingPayload(payload)) }
          ]
        }
      : {
          model: config.provider.localModel,
          stream: false,
          prompt: JSON.stringify(buildModelFacingPayload(payload))
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

    const systemPrompt = systemPromptForPayload(payload);
    const modelFacingPayload = buildModelFacingPayload(payload);
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: JSON.stringify(modelFacingPayload) }
    ];

    let lastError: Error | null = null;
    for (const model of cloudModelCandidates(config.provider.cloudModel)) {
      const body: {
        model: string;
        temperature?: number;
        messages: Array<{ role: "system" | "user"; content: string }>;
      } = {
        model,
        messages
      };
      if (cloudModelSupportsTemperature(model)) {
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
        lastError = new Error(`Cloud provider timeout/network failure for model ${model}: ${message}`);
        if (model === config.provider.cloudModel && isRetryableCloudFailure(lastError.message)) continue;
        throw lastError;
      }

      if (!response.ok) {
        const detail = await parseProviderError(response);
        lastError = new Error(`Cloud provider failed (${response.status}) for model ${model}${detail ? `: ${detail}` : ""}`);
        if (model === config.provider.cloudModel && isRetryableCloudFailure(lastError.message)) {
          continue;
        }
        throw lastError;
      }

      const data = (await response.json()) as ProviderResponseShape;
      return extractProviderText(data);
    }

    throw lastError ?? new Error("Cloud provider failed before receiving a response.");
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
