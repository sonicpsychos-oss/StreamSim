import { StreamContext, ToneSnapshot, SimulationConfig } from "../core/types.js";

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
  return {
    volumeRms: Number((Math.random() * 0.8).toFixed(2)),
    paceWpm: Math.floor(80 + Math.random() * 120)
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

    return {
      transcript: randomItem(transcriptSeed),
      tone: sampleTone(),
      visionTags: this.lastVisionTags,
      timestamp: new Date().toISOString()
    };
  }
}
