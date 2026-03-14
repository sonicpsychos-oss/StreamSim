import { Readable } from "node:stream";
import { sharedDeviceCapturePipeline } from "./deviceCapturePipeline.js";

export type SttProviderKind = "mock" | "whispercpp" | "deepgram";

interface SttBackend {
  transcribe(frame: Buffer): Promise<string>;
}

class MockSttBackend implements SttBackend {
  public async transcribe(frame: Buffer): Promise<string> {
    const text = frame.toString("utf8").trim();
    return text || "";
  }
}

class WhisperCppBackend implements SttBackend {
  constructor(private readonly endpoint: string) {}

  public async transcribe(frame: Buffer): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(frame),
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) throw new Error(`Whisper STT failed (${response.status}).`);
    const json = (await response.json()) as { text?: string };
    return json.text?.trim() ?? "";
  }
}

class DeepgramBackend implements SttBackend {
  constructor(private readonly endpoint: string, private readonly apiKey: string | undefined) {}

  public async transcribe(frame: Buffer): Promise<string> {
    if (!this.apiKey) throw new Error("Deepgram API key missing.");
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": "audio/wav"
      },
      body: new Uint8Array(frame),
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) throw new Error(`Deepgram STT failed (${response.status}).`);
    const json = (await response.json()) as { transcript?: string; results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };
    return json.transcript?.trim() ?? json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  }
}

export interface SttEngine {
  pause(): void;
  resume(): void;
  state(): { paused: boolean; provider: SttProviderKind };
  ingestAudioFrame(frame: Buffer): Promise<void>;
  bindAudioStream(stream: Readable): void;
}

export class DeviceSttEngine implements SttEngine {
  private paused = false;
  private readonly backend: SttBackend;

  constructor(private readonly provider: SttProviderKind = "mock", customBackend?: SttBackend) {
    this.backend = customBackend ?? this.createBackend(provider);
  }

  public pause(): void {
    this.paused = true;
    sharedDeviceCapturePipeline.setMicPaused(true);
  }

  public resume(): void {
    this.paused = false;
    sharedDeviceCapturePipeline.setMicPaused(false);
  }

  public state(): { paused: boolean; provider: SttProviderKind } {
    return { paused: this.paused, provider: this.provider };
  }

  public async ingestAudioFrame(frame: Buffer): Promise<void> {
    if (this.paused || frame.length === 0) return;
    const transcriptChunk = await this.backend.transcribe(frame);
    if (!transcriptChunk) return;

    const paceWpm = Math.max(70, Math.min(220, Math.round((transcriptChunk.split(/\s+/).length / 2) * 60)));
    const rms = Math.min(1, Math.max(0.05, frame.reduce((sum, b) => sum + b, 0) / frame.length / 255));
    sharedDeviceCapturePipeline.ingestMicFrame({ transcriptChunk, wordsPerMinute: paceWpm, rms });
  }

  public bindAudioStream(stream: Readable): void {
    stream.on("data", (chunk: Buffer | string) => {
      const frame = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      void this.ingestAudioFrame(frame);
    });
  }

  private createBackend(provider: SttProviderKind): SttBackend {
    switch (provider) {
      case "whispercpp":
        return new WhisperCppBackend(process.env.STREAMSIM_WHISPER_ENDPOINT ?? "http://127.0.0.1:7778/stt");
      case "deepgram":
        return new DeepgramBackend(
          process.env.STREAMSIM_DEEPGRAM_ENDPOINT ?? "https://api.deepgram.com/v1/listen?model=nova-2&punctuate=true",
          process.env.STREAMSIM_DEEPGRAM_API_KEY
        );
      default:
        return new MockSttBackend();
    }
  }
}

export const sharedSttEngine = new DeviceSttEngine((process.env.STREAMSIM_STT_PROVIDER as SttProviderKind | undefined) ?? "mock");
