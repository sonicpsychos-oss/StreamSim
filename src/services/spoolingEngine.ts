import { SimulationConfig, ToneSnapshot } from "../core/types.js";

const MIN_DELAY_MS = 60;

export interface SpoolTiming {
  targetMps: number;
  baseDelayMs: number;
  actualDelayMs: number;
}

export class SpoolingEngine {
  public calculateTargetMps(config: SimulationConfig, tone: ToneSnapshot): number {
    if (config.slowMode) {
      return 1 / 3;
    }

    const baseMps = Math.sqrt(Math.max(1, config.viewerCount)) / 5;
    let toneBoost = 1;

    if (tone.volumeRms < 0.15 && tone.paceWpm < 95) {
      toneBoost = 0.6;
    } else if (tone.volumeRms > 0.5 || tone.paceWpm > 165) {
      toneBoost = 2;
    }

    return Math.max(0.1, baseMps * config.engagementMultiplier * toneBoost);
  }

  public nextDelayMs(config: SimulationConfig, tone: ToneSnapshot): SpoolTiming {
    const targetMps = this.calculateTargetMps(config, tone);
    const baseDelayMs = 1000 / targetMps;
    const jitter = -0.5 + Math.random() * 1.3;
    const actualDelayMs = Math.max(MIN_DELAY_MS, Math.floor(baseDelayMs * (1 + jitter)));

    return { targetMps, baseDelayMs, actualDelayMs };
  }

  public batchOffsetsMs(batchSize: number, tickDelayMs: number): number[] {
    if (batchSize <= 0) return [];
    if (batchSize === 1) return [0];

    const baseSpacing = Math.max(MIN_DELAY_MS, Math.floor(Math.max(MIN_DELAY_MS * batchSize, tickDelayMs) / batchSize));
    const offsets = [0];
    for (let i = 1; i < batchSize; i += 1) {
      const jitter = 0.75 + Math.random() * 0.5;
      const spacing = Math.max(MIN_DELAY_MS, Math.floor(baseSpacing * jitter));
      offsets.push(offsets[i - 1] + spacing);
    }
    return offsets;
  }
}
