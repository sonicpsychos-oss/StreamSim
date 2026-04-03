import { FishingState, PromptPayload, SimulationConfig, StreamContext } from "../core/types.js";
import { providerConditioningForMode, resolvePersonaCalibration } from "../llm/realismSignals.js";

const LEADING_VALIDATION_PATTERNS = [
  /right\?/i,
  /dont i/i,
  /don't i/i,
  /am i not/i,
  /isnt it/i,
  /isn't it/i,
  /agree\??/i,
  /tell me/i,
  /be real/i
];
const BRAGGING_PATTERNS = [
  /\b(i\s*am|i'm|im|literally)\s+(the\s+)?(goat|best)\b/i,
  /\bthis\s+(is|was)\s+(fire|clean)\b/i,
  /\bno\s+one\s+is\s+touching\s+me\b/i,
  /\bwho\s+can\s+stop\s+me\b/i
];
const PITY_BAIT_PATTERNS = [
  /\bi\s*(am|'m)?\s*so\s*bad\b/i,
  /\bi\s*suck\b/i,
  /\bi\s*should\s*just\s*quit\b/i,
  /\bchat\s*i\s*am\s*washed\b/i
];
const BENIGN_SELF_TALK_PATTERNS = [/\bgood\s+job\b/i, /\bnice\s+job\b/i, /\bwell\s+played\b/i];
const GESTURE_SIGNAL_PATTERNS: Array<{ pattern: RegExp; tags: string[] }> = [
  { pattern: /\b(middle\s*finger|flipping\s*off|flip(?:ped)?\s*off|giving\s*the\s*finger)\b/i, tags: ["gesture_middle_finger", "aggressive", "disrespect"] },
  { pattern: /\b(heart\s*hands|hand\s*heart|heart\s*gesture|finger\s*heart)\b/i, tags: ["gesture_heart_hands", "affectionate", "supportive"] },
  { pattern: /\b(thumbs?\s*up)\b/i, tags: ["gesture_thumbs_up", "approval"] },
  { pattern: /\b(peace\s*sign|v\s*sign)\b/i, tags: ["gesture_peace_sign", "calm"] }
];
const VISION_SEMANTIC_PATTERNS: Array<{ pattern: RegExp; tags: string[] }> = [
  { pattern: /\b(smil(?:e|ing)|grin(?:ning)?)\b/i, tags: ["positive_expression"] },
  { pattern: /\b(laugh(?:ing)?|chuckl(?:e|ing)|giggl(?:e|ing))\b/i, tags: ["laughing", "humor_energy"] },
  { pattern: /\b(frown(?:ing)?|upset|annoyed|frustrated|angry|mad)\b/i, tags: ["negative_expression", "frustrated"] },
  { pattern: /\b(focused|locked\s*in|concentrating|serious\s*face)\b/i, tags: ["focused_expression"] },
  { pattern: /\b(confused|puzzled)\b/i, tags: ["confused_expression"] },
  { pattern: /\b(yawn(?:ing)?|sleepy|tired|exhausted)\b/i, tags: ["low_energy"] },
  { pattern: /\b(leaning\s*in|leans?\s*forward)\b/i, tags: ["engaged_posture"] },
  { pattern: /\b(leaning\s*back|laid\s*back|reclined)\b/i, tags: ["relaxed_posture"] },
  { pattern: /\b(reading\s*chat|looking\s*at\s*chat|eyes?\s*on\s*chat)\b/i, tags: ["chat_engagement"] },
  { pattern: /\b(adjust(?:ing)?\s*(?:headset|mic)|fix(?:ing)?\s*(?:headset|mic))\b/i, tags: ["equipment_adjustment"] },
  { pattern: /\b(drinking|sipp(?:ing)?|water\s*bottle|energy\s*drink)\b/i, tags: ["drinking"] },
  { pattern: /\b(eating|snack(?:ing)?)\b/i, tags: ["eating"] },
  { pattern: /\b(waving|wave\s*to\s*chat)\b/i, tags: ["greeting"] },
  { pattern: /\b(clapping|applaud(?:ing)?)\b/i, tags: ["celebration"] },
  { pattern: /\b(dancing|head\s*bobb(?:ing)?|nodd(?:ing)?)\b/i, tags: ["hype_motion"] },
  { pattern: /\b(dim|dark|low\s*light)\b/i, tags: ["dim_lighting"] },
  { pattern: /\b(bright|well\s*lit)\b/i, tags: ["bright_lighting"] },
  { pattern: /\b(rgb|neon|led)\b/i, tags: ["rgb_lighting"] }
];

export function checkFishingState(transcript: string, vibe?: string, intent?: string): FishingState {
  const normalized = transcript.trim();
  if (!normalized) return "OFF";

  const isAskingLeadingQ = LEADING_VALIDATION_PATTERNS.some((regex) => regex.test(normalized));
  const isBragging = BRAGGING_PATTERNS.some((regex) => regex.test(normalized));
  const isPityBait = PITY_BAIT_PATTERNS.some((regex) => regex.test(normalized));
  const isBenignSelfTalk = BENIGN_SELF_TALK_PATTERNS.some((regex) => regex.test(normalized));
  const isArrogant = vibe === "arrogant";
  const inquiryIntent = intent === "inquiry";
  const hasValidationSignal = isAskingLeadingQ || isBragging || isPityBait;

  if (isBenignSelfTalk && !hasValidationSignal) {
    return "OFF";
  }

  if (!isArrogant && !hasValidationSignal) {
    return "OFF";
  }
  if (isArrogant && !hasValidationSignal) {
    return "STANDARD_CONTRARIAN";
  }

  let confidenceScore = 0;
  if (isAskingLeadingQ) confidenceScore += 2;
  if (isBragging || isPityBait) confidenceScore += 1;
  if (inquiryIntent) confidenceScore += 1;
  if (isArrogant) confidenceScore += 2;

  if ((isAskingLeadingQ || isPityBait) && confidenceScore >= 4) {
    return "AGGRESSIVE_SUBVERSION";
  }

  if (hasValidationSignal && confidenceScore >= 2) {
    return "STANDARD_CONTRARIAN";
  }

  return "OFF";
}

function detectSituationalTags(context: StreamContext): string[] {
  const tags = new Set<string>(context.visionTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  const transcript = context.transcript.toLowerCase();
  const visionText = context.visionTags.join(" ").toLowerCase();

  for (const signal of GESTURE_SIGNAL_PATTERNS) {
    if (signal.pattern.test(visionText)) {
      signal.tags.forEach((tag) => tags.add(tag));
    }
  }
  for (const signal of VISION_SEMANTIC_PATTERNS) {
    if (signal.pattern.test(visionText)) {
      signal.tags.forEach((tag) => tags.add(tag));
    }
  }

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
  if (situationalTags.some((tag) => ["affectionate", "supportive", "gesture_heart_hands"].includes(tag))) modes.add("support");
  if (situationalTags.some((tag) => ["approval", "gesture_thumbs_up", "gesture_peace_sign", "calm"].includes(tag))) modes.add("approval");
  if (situationalTags.some((tag) => ["aggressive", "gesture_middle_finger"].includes(tag))) modes.add("conflict");
  if (situationalTags.some((tag) => ["focused_expression", "engaged_posture", "chat_engagement"].includes(tag))) modes.add("focus");
  if (situationalTags.some((tag) => ["hype_motion", "celebration", "humor_energy"].includes(tag))) modes.add("hype");
  if (situationalTags.some((tag) => ["negative_expression", "frustrated", "confused_expression"].includes(tag))) modes.add("tilt");
  if (situationalTags.some((tag) => ["relaxed_posture", "low_energy"].includes(tag))) modes.add("chill");
  if (modes.size === 0) modes.add("default");
  return Array.from(modes);
}

export function buildPromptPayload(config: SimulationConfig, context: StreamContext): PromptPayload {
  const requestedMessageCount = resolveRequestedMessageCount(config.viewerCount);
  const situationalTags = detectSituationalTags(context);
  const behavioralModes = mapBehavioralModes(situationalTags);

  const fishingState = checkFishingState(context.transcript, context.vibe, context.intent);

  return {
    persona: config.persona,
    bias: config.bias,
    emoteOnly: config.emoteOnly,
    viewerCount: config.viewerCount,
    streamTopic: config.streamTopic,
    context: {
      ...context,
      fishingState
    },
    situationalTags,
    behavioralModes,
    requestedMessageCount,
    personaCalibration: resolvePersonaCalibration(config.persona),
    providerConditioning: providerConditioningForMode(config.inferenceMode)
  };
}

function resolveRequestedMessageCount(viewerCount: number): number {
  const viewers = Math.max(1, Math.floor(viewerCount));
  if (viewers <= 200) return Math.max(5, Math.min(8, Math.floor(Math.sqrt(viewers) / 8) + 4));
  if (viewers <= 1_000) return Math.max(7, Math.min(12, Math.floor(Math.sqrt(viewers) / 5) + 3));
  if (viewers <= 5_000) return Math.max(10, Math.min(20, Math.floor(Math.sqrt(viewers) / 4) + 4));
  return Math.max(12, Math.min(28, Math.floor(Math.sqrt(viewers) / 3.5) + 6));
}
