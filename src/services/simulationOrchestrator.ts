import { AudioStateManager } from "../core/audioStateManager.js";
import { applySafetyFilter } from "../core/safetyFilter.js";
import { ChatMessage, SimulationConfig, ToneSnapshot } from "../core/types.js";
import { generateAudienceBatch } from "../llm/mockAudienceGenerator.js";
import { SpoolingEngine } from "./spoolingEngine.js";

export class SimulationOrchestrator {
  private readonly spooler = new SpoolingEngine();
  private readonly audioState = new AudioStateManager();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly getConfig: () => SimulationConfig,
    private readonly emitMessages: (messages: ChatMessage[]) => void,
    private readonly emitMeta: (meta: Record<string, unknown>) => void
  ) {}

  public start(): void {
    if (this.timer) return;
    this.loop();
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public getAudioState(): { isTtsPlaying: boolean; micListening: boolean } {
    return this.audioState.getState();
  }

  private loop(): void {
    const config = this.getConfig();
    const tone = this.sampleTone();
    const timing = this.spooler.nextDelayMs(config, tone);

    if (this.audioState.canListenToMic()) {
      let messages = generateAudienceBatch(config, tone);

      if (config.emoteOnly) {
        messages = messages
          .map((m) => ({ ...m, text: "" }))
          .filter((m) => m.emotes.length > 0);
      }

      const safeMessages = applySafetyFilter(messages);

      safeMessages.forEach((msg) => {
        if (msg.ttsText) {
          this.audioState.startTts();
          setTimeout(() => this.audioState.stopTts(), 1400);
        }
      });

      this.emitMessages(safeMessages);
      this.emitMeta({ tone, timing, audioState: this.audioState.getState() });
    }

    this.timer = setTimeout(() => this.loop(), timing.actualDelayMs);
  }

  private sampleTone(): ToneSnapshot {
    return {
      volumeRms: Number((Math.random() * 0.8).toFixed(2)),
      paceWpm: Math.floor(80 + Math.random() * 120)
    };
  }
}
