import { StreamContext, ToneSnapshot, SimulationConfig } from "../core/types.js";
import { calibrateToneSnapshot } from "../llm/realismSignals.js";

const transcriptSeed = [
  "chat what should we do next?",
  "that boss phase is actually tough",
  "we are warming up, trust",
  "clip that if you saw it"
];

const visionSeed = ["rgb keyboard", "dark room", "gaming headset", "poster wall", "green hoodie"];

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function sampleTone(): ToneSnapshot {
  const seeded = {
    volumeRms: 0.25 + Math.random() * 0.5,
    paceWpm: 95 + Math.random() * 90
  };

  return calibrateToneSnapshot(seeded);
}

function toneFromTranscript(transcript: string): ToneSnapshot {
  const punctuation = (transcript.match(/[!?]/g) ?? []).length;
  const energyKeywords = (transcript.match(/\b(clip|hype|wow|lets|trust|boss)\b/gi) ?? []).length;
  const exclamationBoost = Math.min(0.25, punctuation * 0.06);
  const keywordBoost = Math.min(0.25, energyKeywords * 0.05);
  return {
    volumeRms: Number((0.28 + exclamationBoost + keywordBoost).toFixed(3)),
    paceWpm: Number((105 + punctuation * 7 + energyKeywords * 6).toFixed(1))
  };
}

export class ContextAssembler {
  private lastVisionAt = 0;
  private lastVisionTags: string[] = [];

  public build(config: SimulationConfig): StreamContext {
    const now = Date.now();
    if (!config.capture.visionEnabled) {
      this.lastVisionTags = [];
    } else if (now - this.lastVisionAt > config.capture.visionIntervalSec * 1000 || this.lastVisionTags.length === 0) {
      this.lastVisionTags = [randomItem(visionSeed), randomItem(visionSeed)].filter((value, i, arr) => arr.indexOf(value) === i);
      this.lastVisionAt = now;
    }

    const transcript = randomItem(transcriptSeed);
    return {
      transcript,
      tone: calibrateToneSnapshot(toneFromTranscript(transcript)),
      visionTags: this.lastVisionTags,
      recentChatHistory: [],
      timestamp: new Date().toISOString()
    };
  }
}
