import { CaptureProvider, SimulationConfig, StreamContext } from "../core/types.js";
import { ContextAssembler } from "../pipeline/contextAssembler.js";
import { sharedDeviceCapturePipeline } from "./deviceCapturePipeline.js";
import { mapDeepgramToIntelligence } from "../services/intelligence/deepgramIntelligence.js";

interface JsonCaptureResponse {
  transcript?: string;
  text?: string;
  tone?: { volumeRms?: number; paceWpm?: number };
  results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
  sentiment?: { average?: number };
  intents?: Array<{ intent?: string; confidence_score?: number }>;
  topics?: Array<{ topic?: string }>;
}

function normalizeTranscript(payload: JsonCaptureResponse): string {
  const fromTopLevel = payload.transcript ?? payload.text ?? payload.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  return typeof fromTopLevel === "string" ? fromTopLevel.trim() : "";
}

export class MockCaptureProvider implements CaptureProvider {
  private readonly assembler = new ContextAssembler();

  public async getContext(config: SimulationConfig): Promise<StreamContext> {
    return this.assembler.build(config);
  }
}

export class DeviceCaptureProvider implements CaptureProvider {
  public async getContext(config: SimulationConfig): Promise<StreamContext> {
    return sharedDeviceCapturePipeline.getContext(config);
  }
}

export class EndpointCaptureProvider implements CaptureProvider {
  private readonly fallback = new DeviceCaptureProvider();

  public async getContext(config: SimulationConfig): Promise<StreamContext> {
    const sttRes = config.capture.sttEndpoint
      ? await fetch(config.capture.sttEndpoint, { signal: AbortSignal.timeout(1500) }).catch(() => null)
      : null;

    const sttData = ((sttRes && sttRes.ok ? await sttRes.json() : {}) ?? {}) as JsonCaptureResponse;

    const transcript = normalizeTranscript(sttData);
    if (transcript) {
      sharedDeviceCapturePipeline.ingestMicFrame({
        transcriptChunk: transcript,
        rms: sttData.tone?.volumeRms,
        wordsPerMinute: sttData.tone?.paceWpm
      });
    }
    const baseContext = await this.fallback.getContext(config);
    const intelligence = config.capture.sttProvider === "deepgram" ? mapDeepgramToIntelligence(sttData, config.audioIntelligence) : null;

    if (!intelligence) return baseContext;
    sharedDeviceCapturePipeline.ingestIntelligenceSample({
      vibe: intelligence.simulatedVibe,
      topic: intelligence.topic,
      intent: intelligence.intent,
      isCommand: intelligence.isCommand,
      intentScore: intelligence.intentScore
    });
    return {
      ...baseContext,
      vibe: intelligence.simulatedVibe,
      topic: intelligence.topic,
      intent: intelligence.intent,
      isCommand: intelligence.isCommand,
      intentScore: intelligence.intentScore
    };
  }
}

export function createCaptureProvider(config: SimulationConfig): CaptureProvider {
  if (!config.capture.useRealCapture) return new MockCaptureProvider();
  if (config.capture.sttEndpoint || config.capture.visionEndpoint) return new EndpointCaptureProvider();
  return new DeviceCaptureProvider();
}
