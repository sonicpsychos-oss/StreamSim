import { SimulationConfig, StreamContext, ToneSnapshot } from "../core/types.js";
import { calibrateToneSnapshot } from "../llm/realismSignals.js";

interface MicFrame {
  transcriptChunk: string;
  rms: number;
  wordsPerMinute: number;
  capturedAt: number;
}

interface VisionSample {
  tags: string[];
  capturedAt: number;
}

export class DeviceCapturePipeline {
  private readonly micFrames: MicFrame[] = [];
  private readonly transcriptWindowMs = 30_000;
  private lastVisionSample: VisionSample | null = null;
  private lastVisionEmitAt = 0;
  private micPaused = false;

  public setMicPaused(paused: boolean): void {
    this.micPaused = paused;
  }

  public ingestMicFrame(frame: { transcriptChunk?: string; rms?: number; wordsPerMinute?: number }): void {
    if (this.micPaused) return;

    const normalized: MicFrame = {
      transcriptChunk: String(frame.transcriptChunk ?? "").slice(0, 500),
      rms: Number.isFinite(frame.rms) ? Number(frame.rms) : 0.2,
      wordsPerMinute: Number.isFinite(frame.wordsPerMinute) ? Number(frame.wordsPerMinute) : 110,
      capturedAt: Date.now()
    };

    this.micFrames.push(normalized);
    this.pruneOldMicFrames();
  }

  public ingestVisionSample(sample: { tags?: string[] }): void {
    const tags = Array.isArray(sample.tags) ? sample.tags.filter((tag) => typeof tag === "string" && tag.trim().length > 0).slice(0, 8) : [];
    this.lastVisionSample = { tags, capturedAt: Date.now() };
  }

  public getContext(config: SimulationConfig): StreamContext {
    this.pruneOldMicFrames();

    const transcript = this.micFrames
      .map((frame) => frame.transcriptChunk)
      .filter(Boolean)
      .join(" ")
      .trim();
    const tone = this.computeTone();
    const now = Date.now();
    let visionTags: string[] = [];

    if (config.capture.visionEnabled && this.lastVisionSample) {
      const intervalMs = Math.max(1000, config.capture.visionIntervalSec * 1000);
      if (now - this.lastVisionEmitAt >= intervalMs) {
        visionTags = this.lastVisionSample.tags;
        this.lastVisionEmitAt = now;
      }
    }

    return {
      transcript,
      tone,
      visionTags,
      timestamp: new Date(now).toISOString()
    };
  }

  public reset(): void {
    this.micFrames.length = 0;
    this.lastVisionSample = null;
    this.lastVisionEmitAt = 0;
  }

  public diagnostics(): { micPaused: boolean; bufferedFrames: number; hasVisionSample: boolean } {
    return {
      micPaused: this.micPaused,
      bufferedFrames: this.micFrames.length,
      hasVisionSample: Boolean(this.lastVisionSample)
    };
  }

  private pruneOldMicFrames(): void {
    const cutoff = Date.now() - this.transcriptWindowMs;
    while (this.micFrames.length && this.micFrames[0].capturedAt < cutoff) {
      this.micFrames.shift();
    }
  }

  private computeTone(): ToneSnapshot {
    if (!this.micFrames.length) {
      return calibrateToneSnapshot({ volumeRms: 0.2, paceWpm: 110 });
    }

    const volumeRms = this.micFrames.reduce((sum, frame) => sum + frame.rms, 0) / this.micFrames.length;
    const paceWpm = this.micFrames.reduce((sum, frame) => sum + frame.wordsPerMinute, 0) / this.micFrames.length;

    return calibrateToneSnapshot({
      volumeRms: Number(volumeRms.toFixed(3)),
      paceWpm: Number(paceWpm.toFixed(1))
    });
  }
}

export const sharedDeviceCapturePipeline = new DeviceCapturePipeline();
