import { InferenceMode, InferenceProvider, PromptPayload, RetryProgressHook, SimulationConfig } from "../core/types.js";
import { SecretStore } from "../security/secretStore.js";
import { MockInferenceProvider } from "./mockInferenceProvider.js";

const LOCAL_MODES: InferenceMode[] = ["ollama", "lmstudio", "mock-local"];

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
    if (this.mode === "openai" || this.mode === "groq" || this.mode === "mock-cloud") {
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
      const endpoint = LOCAL_MODES.includes(this.mode) ? `${config.provider.localEndpoint}/api/tags` : config.provider.cloudEndpoint;
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
            { role: "system", content: "You output strict JSON object with key messages only." },
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

    const data = (await response.json()) as { response?: string; text?: string; choices?: Array<{ message?: { content?: string } }> };
    return data.response ?? data.text ?? data.choices?.[0]?.message?.content ?? "";
  }

  private async generateCloud(payload: PromptPayload, config: SimulationConfig): Promise<string> {
    const apiKey = this.secretStore.getCloudApiKey();
    if (!apiKey) {
      throw new Error("Missing cloud API key in keychain for cloud provider.");
    }

    const response = await fetch(config.provider.cloudEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(config.provider.requestTimeoutMs),
      body: JSON.stringify({
        model: config.provider.cloudModel,
        temperature: 0.8,
        messages: [
          { role: "system", content: "You output strict JSON object with key messages only." },
          { role: "user", content: JSON.stringify(payload) }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Cloud provider failed (${response.status})`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      output_text?: string;
    };

    return data.choices?.[0]?.message?.content ?? data.output_text ?? "";
  }
}
