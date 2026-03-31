import { sharedSttEngine } from "../capture/sttEngine.js";
import { AudioStateManager } from "../core/audioStateManager.js";
import { applySafetyPolicy } from "../core/safetyFilter.js";
import { ChatMessage, PromptPayload, SimulationConfig } from "../core/types.js";
import { createInferenceProvider } from "../llm/providerFactory.js";
import { classifyMalformedOutput, parseInferenceOutput, recommendedRecoveryAction } from "../pipeline/outputParser.js";
import { buildPromptPayload } from "../pipeline/promptBuilder.js";
import { createCaptureProvider } from "../capture/captureProviders.js";
import { ObservabilityLogger } from "./observability.js";
import { SidecarManager } from "./sidecarManager.js";
import { SpoolingEngine } from "./spoolingEngine.js";
import { MockInferenceProvider } from "../llm/mockInferenceProvider.js";
import { ModSimController } from "./modSimController.js";
import { sharedDeviceCapturePipeline } from "../capture/deviceCapturePipeline.js";
import { sharedTextToSpeechService } from "./tts/textToSpeechService.js";
import { VisionPollingService } from "./visionPollingService.js";

export function explainInferenceFailure(reason: string): string {
  if (reason.includes("Unexpected end of JSON input")) {
    return "OpenAI cloud response was truncated (broken JSON package).";
  }
  return reason;
}

export class SimulationOrchestrator {
  private readonly spooler = new SpoolingEngine();
  private readonly audioState = new AudioStateManager();
  private timer: NodeJS.Timeout | null = null;
  private ttsWatchdogTimer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly obs = new ObservabilityLogger();
  private readonly sidecar = new SidecarManager();
  private readonly mockProvider = new MockInferenceProvider();
  private readonly modSim = new ModSimController();
  private readonly visionService = new VisionPollingService(
    () => this.getConfig(),
    (meta) => this.emitMeta(meta)
  );
  private recentChatHistory: string[] = [];
  private aiStatus: {
    state: "idle" | "running" | "degraded" | "error";
    providerHealth: "unknown" | "ok" | "degraded";
    fallbackMode: string | null;
    activeModel: string;
    detail: string;
    updatedAt: string;
  } = {
    state: "idle",
    providerHealth: "unknown",
    fallbackMode: null,
    activeModel: "n/a",
    detail: "Awaiting first simulation tick.",
    updatedAt: new Date().toISOString()
  };

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
    this.visionService.start();
    this.setAiStatus({ state: "running", detail: "Simulation loop started.", fallbackMode: null });
    void this.loop();
  }

  public stop(): void {
    this.running = false;
    this.visionService.stop();
    this.setAiStatus({ state: "idle", detail: "Simulation stopped." });
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.ttsWatchdogTimer) {
      clearTimeout(this.ttsWatchdogTimer);
      this.ttsWatchdogTimer = null;
    }
    this.audioState.stopTts();
    sharedSttEngine.resume();
    sharedDeviceCapturePipeline.reset();
    this.modSim.reset();
  }

  public cancelSidecarPull(): void {
    const status = this.sidecar.cancelPull();
    this.emitMeta({ sidecar: status });
  }

  public async resumeSidecarPull(): Promise<void> {
    const status = await this.sidecar.resumeLastPull(this.getConfig());
    this.emitMeta({ sidecar: status });
  }

  public getAudioState(): { isTtsPlaying: boolean; micListening: boolean; sttPaused: boolean; sttProvider: string; ttsAgeMs: number } {
    const sttState = sharedSttEngine.state();
    return { ...this.audioState.getState(), sttPaused: sttState.paused, sttProvider: sttState.provider };
  }

  public getAiStatus(): { state: string; providerHealth: string; fallbackMode: string | null; activeModel: string; detail: string; updatedAt: string } {
    return { ...this.aiStatus };
  }

  private setAiStatus(
    patch: Partial<{
      state: "idle" | "running" | "degraded" | "error";
      providerHealth: "unknown" | "ok" | "degraded";
      fallbackMode: string | null;
      activeModel: string;
      detail: string;
    }>
  ): void {
    this.aiStatus = {
      ...this.aiStatus,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.emitMeta({ ai: this.getAiStatus() });
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

  private hydrateMessages(messages: ChatMessage[], source: ChatMessage["source"]): ChatMessage[] {
    return messages.map((message) => ({ ...message, source: message.source ?? source ?? "unknown" }));
  }

  private resolveActiveModelName(config: SimulationConfig): string {
    if (config.inferenceMode === "openai" || config.inferenceMode === "groq" || config.inferenceMode === "mock-cloud") {
      return config.provider.cloudModel;
    }
    return config.provider.localModel;
  }

  private transcriptAnchorTerms(transcript: string): string[] {
    const stopwords = new Set([
      "the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "was", "were", "what", "when", "where", "why", "how",
      "can", "hear", "check", "mic", "camera", "chat", "just", "like", "have", "has", "had", "got", "its", "it's", "but", "not", "now",
      "then", "than", "they", "them", "their", "there", "about", "into", "out", "all", "any", "too", "very", "really", "okay", "ok"
    ]);

    return Array.from(
      new Set(
        transcript
          .toLowerCase()
          .replace(/[^a-z0-9\s'-]/g, " ")
          .split(/\s+/)
          .map((token) => token.replace(/^'+|'+$/g, "").trim())
          .filter((token) => token.length >= 5 && !stopwords.has(token))
      )
    ).slice(0, 16);
  }

  private antiEchoFallback(id: string, createdAt: string): ChatMessage {
    const reactions = [
      "nah that's wild 💀",
      "bro is cooking fr",
      "no shot LMAO",
      "chat we are so back",
      "ayo?? W",
      "lowkey cursed",
      "W hat gang",
      "this is peak chaos"
    ];
    return {
      id,
      username: "",
      text: reactions[Math.floor(Math.random() * reactions.length)],
      emotes: [],
      donationCents: null,
      ttsText: null,
      createdAt
    };
  }

  private tokenizeForOverlap(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s']/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4)
    );
  }

  private isReadingChat(transcript: string, recentChatHistory: string[]): boolean {
    return this.modSim.isReadingChat(transcript, recentChatHistory);
  }

  private rewriteForReadingChat(messages: ChatMessage[]): ChatMessage[] {
    return this.modSim.rewriteForReadingChat(messages);
  }

  private applyAntiEchoConstraint(messages: ChatMessage[], transcript: string): ChatMessage[] {
    return this.modSim.applyAntiEchoConstraint(messages, transcript);
  }

  private enforcePersonaSyntax(messages: ChatMessage[]): ChatMessage[] {
    return this.modSim.enforcePersonaSyntax(messages);
  }

  private enforceDiversityRules(messages: ChatMessage[], behavioralModes: string[]): ChatMessage[] {
    return this.modSim.enforceDiversityRules(messages, behavioralModes);
  }

  private applyTranscriptDecay(context: PromptPayload["context"]): PromptPayload["context"] {
    return this.modSim.applyTranscriptDecay(context);
  }

  private verbosePipelineLog(
    route: "primary" | "fallback",
    providerMode: string,
    activeModel: string,
    payload: PromptPayload,
    rawInferenceResult: string
  ): void {
    // eslint-disable-next-line no-console
    console.log(
      `[SimulationOrchestrator][VerbosePipelineLog] route=${route} provider=${providerMode} model=${activeModel} transcript/visionTags + raw InferenceResult`
    );
    // eslint-disable-next-line no-console
    console.log("[SimulationOrchestrator] currentVisionTags before inferencePayload build", payload.context.visionTags);
    const currentVisionTags = payload.context.visionTags;
    // eslint-disable-next-line no-console
    console.log({
      route,
      providerMode,
      activeModel,
      inferencePayload: {
        transcript: payload.context.transcript,
        visionTags: currentVisionTags
      },
      rawInferenceResult
    });
  }

  private async loop(): Promise<void> {
    if (!this.running) return;

    let timing = this.spooler.nextDelayMs(this.getConfig(), { volumeRms: 0.2, paceWpm: 110 });

    try {
      const config = this.getConfig();
      const captureProvider = createCaptureProvider(config);
      const provider = createInferenceProvider(config.inferenceMode);
      const startedAt = Date.now();
      await this.visionService.awaitLatestPoll();

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
        this.setAiStatus({ state: "degraded", providerHealth: "degraded", detail: validation.errors.join(" | ") });
      }

      const health = await provider.healthCheck(config);
      if (!health.ok) {
        this.emitMeta({ warnings: [`Provider unhealthy: ${health.details}`], blocked: false });
        this.setAiStatus({ state: "degraded", providerHealth: "degraded", detail: `Provider unhealthy: ${health.details}` });
      } else {
        this.setAiStatus({ providerHealth: "ok", detail: health.details });
      }

      const captureStarted = Date.now();
      const capturedContext = await captureProvider.getContext(config);
      const contextWithHistory = {
        ...capturedContext,
        recentChatHistory: this.recentChatHistory.slice(0, 20)
      };
      const context = this.modSim.preFlight(contextWithHistory);
      const captureLatencyMs = Date.now() - captureStarted;

      timing = this.spooler.nextDelayMs(config, context.tone);

      if (this.audioState.canListenToMic()) {
        sharedSttEngine.resume();
        const payload = buildPromptPayload(config, context);
        payload.systemPrompt = this.modSim.generatePrompt(payload);
        let messages: ChatMessage[] = [];

        const inferenceStarted = Date.now();
        const activePrimaryModel = this.resolveActiveModelName(config);
        this.setAiStatus({
          state: "running",
          fallbackMode: null,
          activeModel: activePrimaryModel,
          detail: `Generating via ${config.inferenceMode}.`
        });
        try {
          const rawOutput = await provider.generate(payload, config, (attempt, reason) => {
            const recovery = this.cloudRecoveryMeta(attempt, config.provider.maxRetries, reason);
            this.emitMeta({ warnings: [recovery.message], cloudRecovery: recovery.phase, blocked: recovery.blocking });
          });
          this.verbosePipelineLog("primary", config.inferenceMode, activePrimaryModel, payload, rawOutput);
          try {
            messages = this.hydrateMessages(parseInferenceOutput(rawOutput), "real-inference");
          } catch (parseError) {
            const malformedClass = classifyMalformedOutput(rawOutput);
            const action = recommendedRecoveryAction(malformedClass);
            this.obs.log("malformed_json_counter", { malformedClass, action, stage: "first_pass" });

            if ((action === "repair" || action === "regenerate") && config.safety.regenerateOnMalformedJson) {
              const retryOutput = await provider.generate(payload, config);
              messages = this.hydrateMessages(parseInferenceOutput(retryOutput), "real-inference");
              this.emitMeta({ warnings: [`Malformed inference JSON recovered via ${action} fallback.`], blocked: false, malformedClass, action });
              this.obs.log("malformed_json_counter", { malformedClass, action, stage: "recovered" });
            } else {
              this.emitMeta({ warning: `Dropped malformed output (${malformedClass}).`, blocked: false, malformedClass, action: "drop" });
              this.obs.log("malformed_json_counter", { malformedClass, action: "drop", stage: "dropped" });
              if (!config.safety.dropOnParseFailure) throw parseError;
            }
          }
        } catch (error) {
          const reason = explainInferenceFailure((error as Error).message);
          this.obs.log("reliability_recovery", { ok: false, reason });
          this.setAiStatus({ state: "degraded", providerHealth: "degraded", detail: reason });

          try {
            const fallbackOutput = await this.mockProvider.generate(payload, { ...config, inferenceMode: "mock-local" });
            this.verbosePipelineLog("fallback", "mock-local", "mock-local", payload, fallbackOutput);
            messages = this.hydrateMessages(parseInferenceOutput(fallbackOutput), "fallback-mock");
            this.setAiStatus({
              state: "degraded",
              providerHealth: "degraded",
              fallbackMode: "mock-local",
              activeModel: "mock-local",
              detail: `Primary inference failed; mock fallback active: ${reason}`
            });
            this.emitMeta({
              warnings: [reason, "Fallback engaged: mock-local"],
              dropped: false,
              blocked: false,
              cloudRecovery: "degraded",
              source: "fallback-mock",
              provider: config.inferenceMode,
              timeoutMs: config.provider.requestTimeoutMs,
              retries: config.provider.maxRetries
            });
          } catch (fallbackError) {
            const fallbackReason = (fallbackError as Error).message;
            this.setAiStatus({ state: "error", providerHealth: "degraded", fallbackMode: null, detail: `Fallback failed: ${fallbackReason}` });
            if (config.safety.dropOnParseFailure) {
              this.emitMeta({ warning: `${reason} | fallback failed: ${fallbackReason}`, dropped: true, blocked: false, cloudRecovery: "degraded" });
            }
          }
        }
        const inferenceLatencyMs = Date.now() - inferenceStarted;

        const modSimMessages = this.modSim.process(messages, payload);
        const safety = applySafetyPolicy(modSimMessages, config);
        const safeMessages = safety.safeMessages;
        this.recentChatHistory = [...safeMessages.map((message) => message.text), ...this.recentChatHistory].slice(0, 40);

        safeMessages.forEach((msg) => {
          if (config.ttsEnabled && config.ttsMode !== "off" && msg.ttsText) {
            void sharedTextToSpeechService
              .synthesize(config, msg.ttsText)
              .then((tts) => this.emitMeta({ tts: { provider: tts.provider, bytes: tts.bytes } }))
              .catch((error) =>
                this.emitMeta({ warnings: [`TTS synth failed: ${error instanceof Error ? error.message : String(error)}`], blocked: false })
              );
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
          providerSource: safeMessages[0]?.source ?? "unknown",
          requestedMessageCount: payload.requestedMessageCount,
          latencyMs,
          captureLatencyMs,
          inferenceLatencyMs,
          safety: {
            dropPolicy: config.safety.dropPolicy,
            droppedCount: safety.droppedCount,
            queueSize: safety.queueMessages.length
          },
          queueMessages: safety.queueMessages,
          slo: {
            targetMs: 3000,
            withinTarget: latencyMs <= 3000
          },
          ai: this.getAiStatus(),
          providerDiagnostics: {
            timeoutMs: config.provider.requestTimeoutMs,
            retries: config.provider.maxRetries,
            fallbackActive: this.aiStatus.fallbackMode !== null
          }
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.obs.log("pipeline_loop_crash", { reason });
      this.setAiStatus({ state: "degraded", providerHealth: "degraded", detail: `Loop recovered after error: ${reason}` });
      this.emitMeta({ warning: `Simulation loop error recovered: ${reason}`, blocked: false, recovery: "next_tick" });
    }

    if (!this.running) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.loop();
    }, timing.actualDelayMs);
  }
}
