import { AudioStateManager } from "../core/audioStateManager.js";
import { applySafetyFilter } from "../core/safetyFilter.js";
import { ChatMessage, SimulationConfig } from "../core/types.js";
import { createCaptureProvider } from "../capture/captureProviders.js";
import { createInferenceProvider } from "../llm/providerFactory.js";
import { parseInferenceOutput } from "../pipeline/outputParser.js";
import { buildPromptPayload } from "../pipeline/promptBuilder.js";
import { ObservabilityLogger } from "./observability.js";
import { SpoolingEngine } from "./spoolingEngine.js";
import { SidecarManager } from "./sidecarManager.js";

export class SimulationOrchestrator {
  private readonly spooler = new SpoolingEngine();
  private readonly audioState = new AudioStateManager();
  private timer: NodeJS.Timeout | null = null;
  private ttsWatchdogTimer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly obs = new ObservabilityLogger();
  private readonly sidecar = new SidecarManager();

  constructor(
    private readonly getConfig: () => SimulationConfig,
    private readonly emitMessages: (messages: ChatMessage[]) => void,
    private readonly emitMeta: (meta: Record<string, unknown>) => void
  ) {}

  public start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public getAudioState(): { isTtsPlaying: boolean; micListening: boolean } {
    return this.audioState.getState();
  }

  public recoverAudioDevices(): void {
    this.audioState.stopTts();
    this.emitMeta({ warning: "Audio capture device rebind requested." });
  }

  private async loop(): Promise<void> {
    if (!this.running) return;

    const config = this.getConfig();
    const captureProvider = createCaptureProvider(config);
    const provider = createInferenceProvider(config.inferenceMode);
    const startedAt = Date.now();

    if (!config.compliance.eulaAccepted) {
      this.emitMeta({ warning: "EULA must be accepted before simulation starts." });
      this.running = false;
      return;
    }

    const sidecarStatus = await this.sidecar.ensureReady(config);
    if (!sidecarStatus.ready) {
      this.emitMeta({ warning: sidecarStatus.details, fallbackSuggested: sidecarStatus.fallbackSuggested, blocked: false });
      this.obs.log("sidecar_status", { sidecarStatus: sidecarStatus.phase, progress: sidecarStatus.progress });
    }

    const validation = provider.validateConfig(config);
    if (!validation.ok) {
      this.emitMeta({ warnings: validation.errors, blocked: false });
    }

    const health = await provider.healthCheck(config);
    if (!health.ok) {
      this.emitMeta({ warnings: [`Provider unhealthy: ${health.details}`], blocked: false });
    }

    const context = await captureProvider.getContext(config);
    const timing = this.spooler.nextDelayMs(config, context.tone);

    if (this.audioState.canListenToMic()) {
      const payload = buildPromptPayload(config, context);
      let messages: ChatMessage[] = [];

      try {
        const rawOutput = await provider.generate(payload, config);
        try {
          messages = parseInferenceOutput(rawOutput);
        } catch (parseError) {
          if (!config.safety.regenerateOnMalformedJson) throw parseError;
          const retryOutput = await provider.generate(payload, config);
          messages = parseInferenceOutput(retryOutput);
          this.emitMeta({ warnings: ["Malformed inference JSON recovered via regenerate fallback."], blocked: false });
        }
      } catch (error) {
        if (config.safety.dropOnParseFailure) {
          this.emitMeta({ warning: (error as Error).message, dropped: true, blocked: false });
        }
      }

      const safeMessages = applySafetyFilter(messages);

      safeMessages.forEach((msg) => {
        if (msg.ttsText) {
          this.audioState.startTts();
          setTimeout(() => this.audioState.stopTts(), 1400);
          if (this.ttsWatchdogTimer) clearTimeout(this.ttsWatchdogTimer);
          this.ttsWatchdogTimer = setTimeout(() => {
            this.audioState.stopTts();
            this.emitMeta({ warnings: ["TTS watchdog forced stale-state reset."], blocked: false });
          }, 5000);
        }
      });

      this.emitMessages(safeMessages);
      const latencyMs = Date.now() - startedAt;
      this.obs.log("pipeline_tick", {
        inferenceMode: config.inferenceMode,
        requestedMessageCount: payload.requestedMessageCount,
        emittedCount: safeMessages.length,
        latencyMs,
        targetDelayMs: timing.actualDelayMs
      });

      this.emitMeta({
        context,
        timing,
        audioState: this.audioState.getState(),
        inferenceMode: config.inferenceMode,
        requestedMessageCount: payload.requestedMessageCount,
        latencyMs
      });
    }

    this.timer = setTimeout(() => {
      void this.loop();
    }, timing.actualDelayMs);
  }
}
