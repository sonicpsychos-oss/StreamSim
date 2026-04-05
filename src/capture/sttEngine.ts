import { Readable } from "node:stream";
import { DeepgramClient } from "@deepgram/sdk";
import { SecretStore } from "../security/secretStore.js";
import { sharedDeviceCapturePipeline } from "./deviceCapturePipeline.js";

export type SttProviderKind = "mock" | "local-whisper" | "whispercpp" | "deepgram" | "openai-whisper" | "gpt-4o-mini-transcribe";

interface SttBackend {
  transcribe(frame: Buffer): Promise<string>;
}

const DEFAULT_LOCAL_STT_ENDPOINT = "http://127.0.0.1:7778/stt";
const DEFAULT_DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen?model=nova-3&language=en-US&smart_format=true&punctuate=true&utterance_end_ms=1800";
const DEFAULT_OPENAI_STT_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

class MockSttBackend implements SttBackend {
  public async transcribe(frame: Buffer): Promise<string> {
    const text = frame.toString("utf8").trim();
    return text || "";
  }
}

class WhisperCppBackend implements SttBackend {
  constructor(private readonly endpoint: string) {}

  public async transcribe(frame: Buffer): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(frame),
        signal: AbortSignal.timeout(2500)
      });
    } catch (error) {
      throw new Error(`Whisper STT request failed for ${this.endpoint}: ${(error as Error).message}`);
    }
    if (!response.ok) throw new Error(`Whisper STT failed (${response.status}).`);
    const json = (await response.json()) as { text?: string };
    return json.text?.trim() ?? "";
  }
}

class DeepgramBackend implements SttBackend {
  private readonly secretStore = new SecretStore();

  constructor(private readonly endpoint: string, private readonly apiKey: string | undefined) {}

  public async transcribe(frame: Buffer): Promise<string> {
    const token = this.apiKey ?? this.secretStore.getDeepgramApiKey();
    if (!token) throw new Error("Deepgram API key missing.");

    const endpoint = new URL(this.endpoint);
    const model = endpoint.searchParams.get("model") ?? "nova-3";
    const language = endpoint.searchParams.get("language") ?? "en-US";

    const client = new DeepgramClient({ apiKey: token });

    try {
      const response = await client.listen.v1.media.transcribeFile(frame, {
        model,
        language,
        smart_format: true,
        punctuate: true
      } as any);
      const payload = response as unknown as {
        results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
        result?: { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };
      };
      return payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? payload.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    } catch (error) {
      throw new Error(`Deepgram STT request failed for ${this.endpoint}: ${(error as Error).message}`);
    }
  }
}

class OpenAiWhisperBackend implements SttBackend {
  private readonly secretStore = new SecretStore();

  constructor(private readonly endpoint: string, private readonly model: string) {}

  public async transcribe(frame: Buffer): Promise<string> {
    const apiKey = this.secretStore.getOpenAiSttApiKey();
    if (!apiKey) throw new Error("OpenAI STT API key missing. Save OpenAI STT API key in Secrets + Maintenance.");

    const form = new FormData();
    const audioBlob = new Blob([new Uint8Array(frame)], { type: "audio/wav" });
    form.append("file", audioBlob, "mic-probe.wav");
    form.append("model", this.model);
    form.append("response_format", "json");

    const response = await this.requestTranscription(form, apiKey);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          "OpenAI STT failed (401 Unauthorized). Verify STREAMSIM_OPENAI_STT_API_KEY (or STREAMSIM_OPENAI_API_KEY / OPENAI_API_KEY fallback)."
        );
      }
      throw new Error(`OpenAI STT failed (${response.status}).`);
    }
    const json = (await response.json()) as { text?: string };
    return json.text?.trim() ?? "";
  }

  private async requestTranscription(form: FormData, apiKey: string): Promise<Response> {
    try {
      return await fetch(this.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(10000)
      });
    } catch (error) {
      throw new Error(`OpenAI STT request failed for ${this.endpoint}: ${(error as Error).message}`);
    }
  }
}

export interface SttEngine {
  pause(): void;
  resume(): void;
  state(): { paused: boolean; provider: SttProviderKind };
  transcribeFrame(frame: Buffer): Promise<string>;
  transcribeFrameWith(provider: SttProviderKind, endpoint: string | undefined, frame: Buffer): Promise<string>;
  ingestAudioFrame(frame: Buffer): Promise<void>;
  bindAudioStream(stream: Readable): void;
}

export class DeviceSttEngine implements SttEngine {
  private paused = false;
  private provider: SttProviderKind;
  private backend: SttBackend;
  private transcriptionInFlight = false;
  private pendingFrame: Buffer | null = null;

  constructor(provider: SttProviderKind = "mock", customBackend?: SttBackend) {
    this.provider = provider;
    this.backend = customBackend ?? this.createBackend(provider);
  }

  public configure(provider: SttProviderKind, endpoint?: string): void {
    this.provider = provider;
    this.backend = this.createBackend(provider, endpoint);
  }

  public pause(): void {
    this.paused = true;
    this.pendingFrame = null;
    sharedDeviceCapturePipeline.setMicPaused(true);
  }

  public resume(): void {
    this.paused = false;
    sharedDeviceCapturePipeline.setMicPaused(false);
  }

  public state(): { paused: boolean; provider: SttProviderKind } {
    return { paused: this.paused, provider: this.provider };
  }

  public async transcribeFrame(frame: Buffer): Promise<string> {
    if (frame.length === 0) return "";
    return this.backend.transcribe(frame);
  }

  public async transcribeFrameWith(provider: SttProviderKind, endpoint: string | undefined, frame: Buffer): Promise<string> {
    if (frame.length === 0) return "";
    const backend = this.createBackend(provider, endpoint);
    return backend.transcribe(frame);
  }

  public async ingestAudioFrame(frame: Buffer): Promise<void> {
    if (this.paused || frame.length === 0) return;
    if (this.transcriptionInFlight) {
      this.pendingFrame = frame;
      return;
    }
    await this.processAudioFrame(frame);
  }

  public bindAudioStream(stream: Readable): void {
    stream.on("data", (chunk: Buffer | string) => {
      const frame = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      void this.ingestAudioFrame(frame);
    });
  }

  private async processAudioFrame(initialFrame: Buffer): Promise<void> {
    let frame: Buffer | null = initialFrame;
    this.transcriptionInFlight = true;

    try {
      while (frame && !this.paused) {
        const transcriptChunk = await this.transcribeFrame(frame);
        if (transcriptChunk) {
          const paceWpm = Math.max(70, Math.min(220, Math.round((transcriptChunk.split(/\s+/).length / 2) * 60)));
          const rms = Math.min(1, Math.max(0.05, frame.reduce((sum, b) => sum + b, 0) / frame.length / 255));
          sharedDeviceCapturePipeline.ingestMicFrame({ transcriptChunk, wordsPerMinute: paceWpm, rms });
        }

        frame = this.pendingFrame;
        this.pendingFrame = null;
      }
    } finally {
      this.transcriptionInFlight = false;
    }
  }

  private createBackend(provider: SttProviderKind, endpoint?: string): SttBackend {
    switch (provider) {
      case "local-whisper":
        return new WhisperCppBackend(endpoint ?? process.env.STREAMSIM_LOCAL_STT_ENDPOINT ?? DEFAULT_LOCAL_STT_ENDPOINT);
      case "whispercpp":
        return new WhisperCppBackend(endpoint ?? process.env.STREAMSIM_WHISPER_ENDPOINT ?? DEFAULT_LOCAL_STT_ENDPOINT);
      case "deepgram":
        return new DeepgramBackend(
          this.resolveProviderEndpoint(provider, endpoint, process.env.STREAMSIM_DEEPGRAM_ENDPOINT ?? DEFAULT_DEEPGRAM_ENDPOINT),
          process.env.DEEPGRAM_API_KEY ?? process.env.STREAMSIM_DEEPGRAM_API_KEY
        );
      case "openai-whisper":
        return new OpenAiWhisperBackend(
          this.resolveProviderEndpoint(provider, endpoint, process.env.STREAMSIM_OPENAI_STT_ENDPOINT ?? DEFAULT_OPENAI_STT_ENDPOINT),
          this.resolveOpenAiSttModel(provider)
        );
      case "gpt-4o-mini-transcribe":
        return new OpenAiWhisperBackend(
          this.resolveProviderEndpoint(provider, endpoint, process.env.STREAMSIM_OPENAI_STT_ENDPOINT ?? DEFAULT_OPENAI_STT_ENDPOINT),
          this.resolveOpenAiSttModel(provider)
        );
      default:
        return new MockSttBackend();
    }
  }

  private resolveProviderEndpoint(provider: "deepgram" | "openai-whisper" | "gpt-4o-mini-transcribe", requestedEndpoint: string | undefined, fallback: string): string {
    if (!requestedEndpoint) return fallback;
    const normalized = requestedEndpoint.trim();
    if (!normalized) return fallback;
    if ((provider === "openai-whisper" || provider === "gpt-4o-mini-transcribe") && normalized === DEFAULT_LOCAL_STT_ENDPOINT) {
      return fallback;
    }
    return normalized;
  }

  private resolveOpenAiSttModel(provider: "openai-whisper" | "gpt-4o-mini-transcribe"): string {
    if (provider === "openai-whisper") {
      return process.env.STREAMSIM_OPENAI_WHISPER_MODEL ?? process.env.STREAMSIM_OPENAI_STT_MODEL ?? "whisper-1";
    }
    return process.env.STREAMSIM_OPENAI_GPT4O_TRANSCRIBE_MODEL ?? process.env.STREAMSIM_OPENAI_STT_MODEL ?? "gpt-4o-mini-transcribe";
  }

}

export const sharedSttEngine = new DeviceSttEngine((process.env.STREAMSIM_STT_PROVIDER as SttProviderKind | undefined) ?? "mock");
