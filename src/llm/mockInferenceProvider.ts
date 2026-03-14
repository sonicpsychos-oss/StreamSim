import { InferenceProvider, PromptPayload, SimulationConfig } from "../core/types.js";
import { generateAudienceBatch } from "./mockAudienceGenerator.js";

export class MockInferenceProvider implements InferenceProvider {
  public async generate(payload: PromptPayload, config: SimulationConfig): Promise<string> {
    const messages = generateAudienceBatch(config, payload.context.tone).slice(0, payload.requestedMessageCount);

    const serialized = JSON.stringify({ messages });

    if (config.inferenceMode === "mock-cloud" && Math.random() < 0.15) {
      return `###json\n${serialized}\n###`;
    }

    return serialized;
  }
}
