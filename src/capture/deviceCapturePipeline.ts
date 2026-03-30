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
  private lastIntelligenceSample: Pick<StreamContext, "vibe" | "topic" | "intent" | "isCommand" | "intentScore"> | null = null;
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
    // eslint-disable-next-line no-console
    console.log("[DeviceCapturePipeline] Saved latest vision tags", { tags, capturedAt: this.lastVisionSample.capturedAt });
  }

  public ingestIntelligenceSample(sample: Pick<StreamContext, "vibe" | "topic" | "intent" | "isCommand" | "intentScore">): void {
    this.lastIntelligenceSample = {
      vibe: sample.vibe,
      topic: sample.topic,
      intent: sample.intent,
      isCommand: sample.isCommand,
      intentScore: sample.intentScore
    };
  }

  public getContext(config: SimulationConfig): StreamContext {
    this.pruneOldMicFrames();

    const transcript = this.micFrames
      .filter((frame) => Date.now() - frame.capturedAt <= this.transcriptWindowMs)
      .map((frame) => frame.transcriptChunk)
      .filter(Boolean)
      .join(" ")
      .trim();
    const tone = this.computeTone();
    const now = Date.now();
    const visionTags = config.capture.visionEnabled && this.lastVisionSample ? this.lastVisionSample.tags : [];
    // eslint-disable-next-line no-console
    console.log("[DeviceCapturePipeline] Returning context with latest saved vision tags", {
      visionEnabled: config.capture.visionEnabled,
      hasVisionSample: Boolean(this.lastVisionSample),
      visionTags
    });

    return {
      transcript,
      tone,
      visionTags,
      vibe: this.lastIntelligenceSample?.vibe,
      topic: this.lastIntelligenceSample?.topic,
      intent: this.lastIntelligenceSample?.intent,
      isCommand: this.lastIntelligenceSample?.isCommand,
      intentScore: this.lastIntelligenceSample?.intentScore,
      recentChatHistory: [],
      timestamp: new Date(now).toISOString()
    };
  }

  public reset(): void {
    this.micFrames.length = 0;
    this.lastVisionSample = null;
    this.lastIntelligenceSample = null;
  }

  public diagnostics(): { micPaused: boolean; bufferedFrames: number; hasVisionSample: boolean; latestVisionTagCount: number; latestVisionCapturedAt: number | null } {
    return {
      micPaused: this.micPaused,
      bufferedFrames: this.micFrames.length,
      hasVisionSample: Boolean(this.lastVisionSample),
      latestVisionTagCount: this.lastVisionSample?.tags.length ?? 0,
      latestVisionCapturedAt: this.lastVisionSample?.capturedAt ?? null
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
