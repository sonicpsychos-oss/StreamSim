import { PromptPayload, SimulationConfig, StreamContext } from "../core/types.js";
import { providerConditioningForMode, resolvePersonaCalibration } from "../llm/realismSignals.js";

export function buildPromptPayload(config: SimulationConfig, context: StreamContext): PromptPayload {
  const requestedMessageCount = Math.max(1, Math.min(10, Math.floor(Math.sqrt(config.viewerCount) / 18) + 1));

  return {
    persona: config.persona,
    bias: config.bias,
    emoteOnly: config.emoteOnly,
    viewerCount: config.viewerCount,
    context,
    requestedMessageCount,
    personaCalibration: resolvePersonaCalibration(config.persona),
    providerConditioning: providerConditioningForMode(config.inferenceMode)
  };
}
