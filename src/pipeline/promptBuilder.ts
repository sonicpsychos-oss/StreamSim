import { PromptPayload, SimulationConfig, StreamContext } from "../core/types.js";
import { providerConditioningForMode, resolvePersonaCalibration } from "../llm/realismSignals.js";

function detectSituationalTags(context: StreamContext): string[] {
  const tags = new Set<string>(context.visionTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  const transcript = context.transcript.toLowerCase();
  if (/\b(lmao|lmfao|haha|😭|💀|funny)\b/.test(transcript)) tags.add("funny");
  if (/\b(laugh|laughing)\b/.test(transcript)) tags.add("laughing");
  if (/\b(sarcasm|sarcastic|yeah right|sure buddy)\b/.test(transcript)) tags.add("sarcastic");
  if (/\b(disrespect|sassy|outta pocket|wild)\b/.test(transcript)) tags.add("disrespect");
  if (/\b(i died|you died|player died|death|respawn)\b/.test(transcript)) tags.add("player_death");
  return Array.from(tags);
}

function mapBehavioralModes(situationalTags: string[]): string[] {
  const modes = new Set<string>();
  if (situationalTags.some((tag) => ["baddie", "curvy", "model"].includes(tag))) modes.add("thirst");
  if (situationalTags.some((tag) => ["expensive_item", "flex"].includes(tag))) modes.add("flex");
  if (situationalTags.includes("player_death")) modes.add("respect");
  if (situationalTags.some((tag) => ["funny", "laughing"].includes(tag))) modes.add("laughter");
  if (situationalTags.some((tag) => ["disrespect", "sassy"].includes(tag))) modes.add("drama");
  if (situationalTags.includes("sarcastic")) modes.add("cap");
  if (modes.size === 0) modes.add("default");
  return Array.from(modes);
}

export function buildPromptPayload(config: SimulationConfig, context: StreamContext): PromptPayload {
  const requestedMessageCount = Math.max(1, Math.min(10, Math.floor(Math.sqrt(config.viewerCount) / 18) + 1));
  const situationalTags = detectSituationalTags(context);
  const behavioralModes = mapBehavioralModes(situationalTags);

  return {
    persona: config.persona,
    bias: config.bias,
    emoteOnly: config.emoteOnly,
    viewerCount: config.viewerCount,
    streamTopic: config.streamTopic,
    context,
    situationalTags,
    behavioralModes,
    requestedMessageCount,
    personaCalibration: resolvePersonaCalibration(config.persona),
    providerConditioning: providerConditioningForMode(config.inferenceMode)
  };
}
