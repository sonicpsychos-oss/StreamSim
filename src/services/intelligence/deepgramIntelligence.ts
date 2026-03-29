import { AudioIntelligenceConfig, SimulatedVibe } from "../../core/types.js";

interface DeepgramIntent {
  intent?: string;
  confidence_score?: number;
}

interface DeepgramTopic {
  topic?: string;
}

interface DeepgramResponseLike {
  sentiment?: { average?: number };
  intents?: DeepgramIntent[];
  topics?: DeepgramTopic[];
}

export interface DeepgramIntelligenceResult {
  simulatedVibe: SimulatedVibe;
  topic: string;
  intent: string;
  isCommand: boolean;
  intentScore: number;
  sentiment: number;
}

export function mapDeepgramToIntelligence(
  response: DeepgramResponseLike,
  audioIntelligenceConfig: AudioIntelligenceConfig
): DeepgramIntelligenceResult | null {
  if (!audioIntelligenceConfig.enabled) return null;

  const sentiment = audioIntelligenceConfig.sentiment ? Number(response.sentiment?.average ?? 0) : 0;
  const intent = audioIntelligenceConfig.intents ? response.intents?.[0]?.intent ?? "none" : "none";
  const topic = audioIntelligenceConfig.topics ? response.topics?.[0]?.topic ?? "general" : "general";
  const intentScore = Number(response.intents?.[0]?.confidence_score ?? 0);

  let simulatedVibe: SimulatedVibe = "chill";
  if (sentiment < audioIntelligenceConfig.thresholds.nuclearDrama && intent === "complaint") {
    simulatedVibe = "nuclear_drama";
  } else if (sentiment > audioIntelligenceConfig.thresholds.hypeVibe) {
    simulatedVibe = "hyped";
  } else if (intent === "inquiry" || intent === "question") {
    simulatedVibe = "questioning";
  }

  return {
    simulatedVibe,
    topic,
    intent,
    isCommand: intent === "command",
    intentScore,
    sentiment
  };
}
