import { sharedSttEngine } from "../capture/sttEngine.js";
import { AudioStateManager } from "../core/audioStateManager.js";
import { applySafetyFilter } from "../core/safetyFilter.js";
import { ChatMessage, SimulationConfig } from "../core/types.js";
import { createInferenceProvider } from "../llm/providerFactory.js";
import { classifyMalformedOutput, parseInferenceOutput, recommendedRecoveryAction } from "../pipeline/outputParser.js";
import { buildPromptPayload } from "../pipeline/promptBuilder.js";
import { createCaptureProvider } from "../capture/captureProviders.js";
import { ObservabilityLogger } from "./observability.js";
import { SidecarManager } from "./sidecarManager.js";
import { SpoolingEngine } from "./spoolingEngine.js";

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
  ) {
    this.sidecar.onProgress((event) => this.emitMeta({ sidecar: event }));
  }

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
    if (this.ttsWatchdogTimer) {
      clearTimeout(this.ttsWatchdogTimer);
      this.ttsWatchdogTimer = null;
    }
  }

  public cancelSidecarPull(): void {
    const status = this.sidecar.cancelPull();
    this.emitMeta({ sidecar: status });
  }

  public async resumeSidecarPull(): Promise<void> {
    const status = await this.sidecar.resumeLastPull(this.getConfig());
    this.emitMeta({ sidecar: status });
  }

  public getAudioState(): { isTtsPlaying: boolean; micListening: boolean; sttPaused: boolean; ttsAgeMs: number } {
    return { ...this.audioState.getState(), sttPaused: sharedSttEngine.state().paused };
  }

  public recoverAudioDevices(): void {
    this.audioState.markDeviceDisconnect();
    sharedSttEngine.resume();
    this.emitMeta({ warning: "Audio capture device rebind requested." });
  }

  private cloudRecoveryMeta(attempt: number, maxRetries: number, reason: string): { phase: string; message: string; blocking: boolean } {
    if (attempt <= maxRetries) {
      return { phase: "retrying", message: `Cloud request retry ${attempt}/${maxRetries} after: ${reason}`, blocking: false };
    }
    return { phase: "degraded", message: `Cloud retries exhausted. Entering degraded recovery state: ${reason}`, blocking: false };
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
      this.emitMeta({ warning: sidecarStatus.details, fallbackSuggested: sidecarStatus.fallbackSuggested, blocked: false, recovery: sidecarStatus.uxAction });
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

    const captureStarted = Date.now();
    const context = await captureProvider.getContext(config);
    const captureLatencyMs = Date.now() - captureStarted;

    const timing = this.spooler.nextDelayMs(config, context.tone);

    if (this.audioState.canListenToMic()) {
      sharedSttEngine.resume();
      const payload = buildPromptPayload(config, context);
      let messages: ChatMessage[] = [];

      const inferenceStarted = Date.now();
      try {
        const rawOutput = await provider.generate(payload, config, (attempt, reason) => {
          const recovery = this.cloudRecoveryMeta(attempt, config.provider.maxRetries, reason);
          this.emitMeta({ warnings: [recovery.message], cloudRecovery: recovery.phase, blocked: recovery.blocking });
        });
        try {
          messages = parseInferenceOutput(rawOutput);
        } catch (parseError) {
          const malformedClass = classifyMalformedOutput(rawOutput);
          const action = recommendedRecoveryAction(malformedClass);
          this.obs.log("malformed_json_counter", { malformedClass, action, stage: "first_pass" });

          if ((action === "repair" || action === "regenerate") && config.safety.regenerateOnMalformedJson) {
            const retryOutput = await provider.generate(payload, config);
            messages = parseInferenceOutput(retryOutput);
            this.emitMeta({ warnings: [`Malformed inference JSON recovered via ${action} fallback.`], blocked: false, malformedClass, action });
            this.obs.log("malformed_json_counter", { malformedClass, action, stage: "recovered" });
          } else {
            this.emitMeta({ warning: `Dropped malformed output (${malformedClass}).`, blocked: false, malformedClass, action: "drop" });
            this.obs.log("malformed_json_counter", { malformedClass, action: "drop", stage: "dropped" });
            if (!config.safety.dropOnParseFailure) throw parseError;
          }
        }
      } catch (error) {
        this.obs.log("reliability_recovery", { ok: false, reason: (error as Error).message });
        if (config.safety.dropOnParseFailure) {
          this.emitMeta({ warning: (error as Error).message, dropped: true, blocked: false, cloudRecovery: "degraded" });
        }
      }
      const inferenceLatencyMs = Date.now() - inferenceStarted;

      const safeMessages = applySafetyFilter(messages);

      safeMessages.forEach((msg) => {
        if (msg.ttsText) {
          this.audioState.startTts();
          sharedSttEngine.pause();
          setTimeout(() => {
            this.audioState.stopTts();
            sharedSttEngine.resume();
          }, 1400);
          if (this.ttsWatchdogTimer) clearTimeout(this.ttsWatchdogTimer);
          this.ttsWatchdogTimer = setTimeout(() => {
            const forced = this.audioState.forceResetIfStale(2800);
            if (forced) {
              sharedSttEngine.resume();
              this.emitMeta({ warnings: ["TTS watchdog forced stale-state reset."], blocked: false });
            }
          }, 3200);
        }
      });

      this.emitMessages(safeMessages);
      const latencyMs = Date.now() - startedAt;
      this.obs.log("pipeline_tick", {
        inferenceMode: config.inferenceMode,
        requestedMessageCount: payload.requestedMessageCount,
        emittedCount: safeMessages.length,
        latencyMs,
        captureLatencyMs,
        inferenceLatencyMs,
        targetDelayMs: timing.actualDelayMs,
        jankMs: Math.max(0, latencyMs - timing.actualDelayMs)
      });

      this.emitMeta({
        context,
        timing,
        audioState: this.getAudioState(),
        inferenceMode: config.inferenceMode,
        requestedMessageCount: payload.requestedMessageCount,
        latencyMs,
        captureLatencyMs,
        inferenceLatencyMs,
        slo: {
          targetMs: 3000,
          withinTarget: latencyMs <= 3000
        }
      });
    }

    this.timer = setTimeout(() => {
      void this.loop();
    }, timing.actualDelayMs);
  }
}
