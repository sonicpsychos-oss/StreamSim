import { CaptureProvider, SimulationConfig, StreamContext } from "../core/types.js";
import { ContextAssembler } from "../pipeline/contextAssembler.js";

interface JsonCaptureResponse {
  transcript?: string;
  tone?: { volumeRms?: number; paceWpm?: number };
  visionTags?: string[];
}

export class MockCaptureProvider implements CaptureProvider {
  private readonly assembler = new ContextAssembler();

  public async getContext(config: SimulationConfig): Promise<StreamContext> {
    return this.assembler.build(config);
  }
}

export class EndpointCaptureProvider implements CaptureProvider {
  private readonly fallback = new MockCaptureProvider();

  public async getContext(config: SimulationConfig): Promise<StreamContext> {
    try {
      const [sttRes, visionRes] = await Promise.all([
        fetch(config.capture.sttEndpoint, { signal: AbortSignal.timeout(1500) }),
        config.capture.visionEnabled ? fetch(config.capture.visionEndpoint, { signal: AbortSignal.timeout(1500) }) : Promise.resolve(null)
      ]);

      const sttData = ((sttRes && sttRes.ok ? await sttRes.json() : {}) ?? {}) as JsonCaptureResponse;
      const visionData = ((visionRes && visionRes.ok ? await visionRes.json() : {}) ?? {}) as JsonCaptureResponse;

      const transcript = sttData.transcript ?? "";
      if (!transcript) throw new Error("STT transcript unavailable");

      return {
        transcript,
        tone: {
          volumeRms: Number(sttData.tone?.volumeRms ?? 0.2),
          paceWpm: Number(sttData.tone?.paceWpm ?? 110)
        },
        visionTags: Array.isArray(visionData.visionTags) ? visionData.visionTags : [],
        timestamp: new Date().toISOString()
      };
    } catch {
      return this.fallback.getContext(config);
    }
  }
}

export function createCaptureProvider(config: SimulationConfig): CaptureProvider {
  return config.capture.useRealCapture ? new EndpointCaptureProvider() : new MockCaptureProvider();
}
