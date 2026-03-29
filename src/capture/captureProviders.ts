import { CaptureProvider, SimulationConfig, StreamContext } from "../core/types.js";
import { ContextAssembler } from "../pipeline/contextAssembler.js";
import { sharedDeviceCapturePipeline } from "./deviceCapturePipeline.js";
import { mapDeepgramToIntelligence } from "../services/intelligence/deepgramIntelligence.js";

interface JsonCaptureResponse {
  transcript?: string;
  text?: string;
  description?: string;
  caption?: string;
  tone?: { volumeRms?: number; paceWpm?: number };
  visionTags?: string[];
  tags?: string[];
  labels?: string[];
  objects?: string[];
  detections?: Array<{ label?: string; name?: string }>;
  results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
  sentiment?: { average?: number };
  intents?: Array<{ intent?: string; confidence_score?: number }>;
  topics?: Array<{ topic?: string }>;
}

function normalizeTranscript(payload: JsonCaptureResponse): string {
  const fromTopLevel = payload.transcript ?? payload.text ?? payload.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  return typeof fromTopLevel === "string" ? fromTopLevel.trim() : "";
}

function normalizeVisionTags(payload: JsonCaptureResponse): string[] {
  const listCandidates = [
    payload.visionTags,
    payload.tags,
    payload.labels,
    payload.objects,
    payload.detections?.map((entry) => entry.label ?? entry.name ?? "")
  ];
  const listTags = listCandidates
    .flatMap((candidate) => (Array.isArray(candidate) ? candidate : []))
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (listTags.length > 0) return listTags;

  const captionCandidates = [payload.description, payload.caption, payload.text];
  const caption = captionCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!caption) return [];

  const commaDelimited = caption
    .split(/[|,;\n]/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (commaDelimited.length > 1) return commaDelimited;

  const phraseSeed = caption
    .toLowerCase()
    .replace(/\b(i can see|looks like|there is|there's|showing|appears to be)\b/g, "")
    .replace(/[.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!phraseSeed) return [];

  const descriptorCandidates = phraseSeed
    .split(/\b(?:and|with|while|near|next to|in front of|beside|on top of|over)\b/gi)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
    .map((part) => part.replace(/^(a|an|the)\s+/i, "").trim())
    .slice(0, 8);

  return descriptorCandidates.length > 1 ? descriptorCandidates : [caption.trim()].filter(Boolean);
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
    const requests: Array<Promise<Response | null>> = [];
    if (config.capture.sttEndpoint) {
      requests.push(fetch(config.capture.sttEndpoint, { signal: AbortSignal.timeout(1500) }));
    } else {
      requests.push(Promise.resolve(null));
    }
    if (config.capture.visionEnabled && config.capture.visionEndpoint) {
      requests.push(fetch(config.capture.visionEndpoint, { signal: AbortSignal.timeout(1500) }));
    } else {
      requests.push(Promise.resolve(null));
    }

    const [sttResult, visionResult] = await Promise.allSettled(requests);
    const sttRes = sttResult.status === "fulfilled" ? sttResult.value : null;
    const visionRes = visionResult.status === "fulfilled" ? visionResult.value : null;

    const sttData = ((sttRes && sttRes.ok ? await sttRes.json() : {}) ?? {}) as JsonCaptureResponse;
    const visionData = ((visionRes && visionRes.ok ? await visionRes.json() : {}) ?? {}) as JsonCaptureResponse;
    // eslint-disable-next-line no-console
    console.log("[VisionCapture] Vision API call resolved", {
      endpoint: config.capture.visionEndpoint,
      ok: Boolean(visionRes?.ok),
      status: visionRes?.status ?? null,
      hasPayload: Object.keys(visionData).length > 0
    });

    const transcript = normalizeTranscript(sttData);
    if (transcript) {
      sharedDeviceCapturePipeline.ingestMicFrame({
        transcriptChunk: transcript,
        rms: sttData.tone?.volumeRms,
        wordsPerMinute: sttData.tone?.paceWpm
      });
    }
    const visionTags = normalizeVisionTags(visionData);
    // eslint-disable-next-line no-console
    console.log("[VisionCapture] Parsed vision tags array", { visionTags });
    if (visionTags.length) {
      sharedDeviceCapturePipeline.ingestVisionSample({ tags: visionTags });
    }

    const baseContext = await this.fallback.getContext(config);
    const intelligence = config.capture.sttProvider === "deepgram" ? mapDeepgramToIntelligence(sttData, config.audioIntelligence) : null;

    if (!intelligence) return baseContext;
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
