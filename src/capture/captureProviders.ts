import { CaptureProvider, SimulationConfig, StreamContext } from "../core/types.js";
import { ContextAssembler } from "../pipeline/contextAssembler.js";
import { sharedDeviceCapturePipeline } from "./deviceCapturePipeline.js";

interface JsonCaptureResponse {
  transcript?: string;
  text?: string;
  tone?: { volumeRms?: number; paceWpm?: number };
  visionTags?: string[];
  tags?: string[];
  results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
}

function normalizeTranscript(payload: JsonCaptureResponse): string {
  const fromTopLevel = payload.transcript ?? payload.text ?? payload.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  return typeof fromTopLevel === "string" ? fromTopLevel.trim() : "";
}

function normalizeVisionTags(payload: JsonCaptureResponse): string[] {
  const raw = Array.isArray(payload.visionTags) ? payload.visionTags : Array.isArray(payload.tags) ? payload.tags : [];
  return raw.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean);
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
    try {
      const [sttRes, visionRes] = await Promise.all([
        fetch(config.capture.sttEndpoint, { signal: AbortSignal.timeout(1500) }),
        config.capture.visionEnabled ? fetch(config.capture.visionEndpoint, { signal: AbortSignal.timeout(1500) }) : Promise.resolve(null)
      ]);

      const sttData = ((sttRes && sttRes.ok ? await sttRes.json() : {}) ?? {}) as JsonCaptureResponse;
      const visionData = ((visionRes && visionRes.ok ? await visionRes.json() : {}) ?? {}) as JsonCaptureResponse;

      const transcript = normalizeTranscript(sttData);
      if (transcript) {
        sharedDeviceCapturePipeline.ingestMicFrame({
          transcriptChunk: transcript,
          rms: sttData.tone?.volumeRms,
          wordsPerMinute: sttData.tone?.paceWpm
        });
      }
      const visionTags = normalizeVisionTags(visionData);
      if (visionTags.length) {
        sharedDeviceCapturePipeline.ingestVisionSample({ tags: visionTags });
      }

      return this.fallback.getContext(config);
    } catch {
      return this.fallback.getContext(config);
    }
  }
}

export function createCaptureProvider(config: SimulationConfig): CaptureProvider {
  if (!config.capture.useRealCapture) return new MockCaptureProvider();
  if (config.capture.sttEndpoint || config.capture.visionEndpoint) return new EndpointCaptureProvider();
  return new DeviceCaptureProvider();
}
