import { AudioStateManager } from "../core/audioStateManager.js";
import { applySafetyFilter } from "../core/safetyFilter.js";
import { ChatMessage, SimulationConfig } from "../core/types.js";
import { MockInferenceProvider } from "../llm/mockInferenceProvider.js";
import { ContextAssembler } from "../pipeline/contextAssembler.js";
import { parseInferenceOutput } from "../pipeline/outputParser.js";
import { buildPromptPayload } from "../pipeline/promptBuilder.js";
import { SpoolingEngine } from "./spoolingEngine.js";

export class SimulationOrchestrator {
  private readonly spooler = new SpoolingEngine();
  private readonly audioState = new AudioStateManager();
  private readonly provider = new MockInferenceProvider();
  private readonly contextAssembler = new ContextAssembler();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

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

  private async loop(): Promise<void> {
    if (!this.running) return;

    const config = this.getConfig();
    const context = this.contextAssembler.build(config);
    const timing = this.spooler.nextDelayMs(config, context.tone);

    if (!config.compliance.eulaAccepted) {
      this.emitMeta({ warning: "EULA must be accepted before simulation starts." });
      this.running = false;
      return;
    }

    if (this.audioState.canListenToMic()) {
      const payload = buildPromptPayload(config, context);
      let messages: ChatMessage[] = [];

      try {
        const rawOutput = await this.provider.generate(payload, config);
        messages = parseInferenceOutput(rawOutput);
      } catch (error) {
        if (config.safety.dropOnParseFailure) {
          this.emitMeta({ parseError: (error as Error).message, dropped: true });
        }
      }

      const safeMessages = applySafetyFilter(messages);

      safeMessages.forEach((msg) => {
        if (msg.ttsText) {
          this.audioState.startTts();
          setTimeout(() => this.audioState.stopTts(), 1400);
        }
      });

      this.emitMessages(safeMessages);
      this.emitMeta({
        context,
        timing,
        audioState: this.audioState.getState(),
        inferenceMode: config.inferenceMode,
        requestedMessageCount: payload.requestedMessageCount
      });
    }

    this.timer = setTimeout(() => {
      void this.loop();
    }, timing.actualDelayMs);
  }
}
