import { InferenceProvider, PromptPayload, RetryProgressHook, SimulationConfig } from "../core/types.js";
import { generateAudienceBatch } from "./mockAudienceGenerator.js";

export class MockInferenceProvider implements InferenceProvider {
  public validateConfig(): { ok: boolean; errors: string[] } {
    return { ok: true, errors: [] };
  }

  public async healthCheck(): Promise<{ ok: boolean; details: string }> {
    return { ok: true, details: "mock ok" };
  }

  public async generate(
    payload: PromptPayload,
    config: SimulationConfig,
    _onRetryProgress?: RetryProgressHook,
    _abortSignal?: AbortSignal
  ): Promise<string> {
    const messages = generateAudienceBatch(config, payload.context.tone, payload.context, payload.providerConditioning).slice(0, payload.requestedMessageCount);

    const serialized = JSON.stringify({ messages });

    if (config.inferenceMode === "mock-cloud" && Math.random() < 0.15) {
      return `###json\n${serialized}\n###`;
    }

    return serialized;
  }
}
