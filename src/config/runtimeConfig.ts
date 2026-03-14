import { SimulationConfig } from "../core/types.js";

export const defaultConfig: SimulationConfig = {
  viewerCount: 100,
  engagementMultiplier: 1,
  slowMode: false,
  emoteOnly: false,
  persona: "supportive",
  bias: "split",
  donationFrequency: 0.08,
  ttsEnabled: true,
  inferenceMode: "mock-local",
  capture: {
    visionEnabled: true,
    visionIntervalSec: 25,
    useRealCapture: false,
    sttEndpoint: "http://127.0.0.1:7778/stt",
    visionEndpoint: "http://127.0.0.1:7778/vision-tags"
  },
  safety: {
    dropOnParseFailure: true,
    regenerateOnMalformedJson: true
  },
  compliance: {
    eulaAccepted: false,
    eulaVersion: "2026-01"
  },
  provider: {
    localEndpoint: "http://127.0.0.1:11434",
    localModel: "llama3.1:8b-instruct-q4_K_M",
    cloudEndpoint: "https://api.openai.com/v1/chat/completions",
    cloudModel: "gpt-4o-mini",
    requestTimeoutMs: 7000,
    maxRetries: 2
  },
  security: {
    sidecarLocalhostOnly: true,
    allowDiagnostics: false
  }
};

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function sanitizeConfig(input: unknown): SimulationConfig {
  const candidate = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const capture = (candidate.capture ?? {}) as Record<string, unknown>;
  const safety = (candidate.safety ?? {}) as Record<string, unknown>;
  const compliance = (candidate.compliance ?? {}) as Record<string, unknown>;
  const provider = (candidate.provider ?? {}) as Record<string, unknown>;
  const security = (candidate.security ?? {}) as Record<string, unknown>;

  const persona = candidate.persona;
  const bias = candidate.bias;
  const inferenceMode = candidate.inferenceMode;

  return {
    viewerCount: Math.max(1, Math.min(50000, Math.floor(asNumber(candidate.viewerCount, defaultConfig.viewerCount)))),
    engagementMultiplier: Math.max(0.1, Math.min(5, asNumber(candidate.engagementMultiplier, defaultConfig.engagementMultiplier))),
    slowMode: asBoolean(candidate.slowMode, defaultConfig.slowMode),
    emoteOnly: asBoolean(candidate.emoteOnly, defaultConfig.emoteOnly),
    persona: persona === "supportive" || persona === "trolls" || persona === "meme-lords" || persona === "neutral" ? persona : defaultConfig.persona,
    bias: bias === "agree" || bias === "disagree" || bias === "split" ? bias : defaultConfig.bias,
    donationFrequency: Math.max(0, Math.min(1, asNumber(candidate.donationFrequency, defaultConfig.donationFrequency))),
    ttsEnabled: asBoolean(candidate.ttsEnabled, defaultConfig.ttsEnabled),
    inferenceMode:
      inferenceMode === "mock-local" ||
      inferenceMode === "mock-cloud" ||
      inferenceMode === "ollama" ||
      inferenceMode === "lmstudio" ||
      inferenceMode === "openai" ||
      inferenceMode === "groq"
        ? inferenceMode
        : defaultConfig.inferenceMode,
    capture: {
      visionEnabled: asBoolean(capture.visionEnabled, defaultConfig.capture.visionEnabled),
      visionIntervalSec: Math.max(5, Math.min(120, Math.floor(asNumber(capture.visionIntervalSec, defaultConfig.capture.visionIntervalSec)))),
      useRealCapture: asBoolean(capture.useRealCapture, defaultConfig.capture.useRealCapture),
      sttEndpoint: asString(capture.sttEndpoint, defaultConfig.capture.sttEndpoint),
      visionEndpoint: asString(capture.visionEndpoint, defaultConfig.capture.visionEndpoint)
    },
    safety: {
      dropOnParseFailure: asBoolean(safety.dropOnParseFailure, defaultConfig.safety.dropOnParseFailure),
      regenerateOnMalformedJson: asBoolean(safety.regenerateOnMalformedJson, defaultConfig.safety.regenerateOnMalformedJson)
    },
    compliance: {
      eulaAccepted: asBoolean(compliance.eulaAccepted, defaultConfig.compliance.eulaAccepted),
      eulaVersion: asString(compliance.eulaVersion, defaultConfig.compliance.eulaVersion)
    },
    provider: {
      localEndpoint: asString(provider.localEndpoint, defaultConfig.provider.localEndpoint),
      localModel: asString(provider.localModel, defaultConfig.provider.localModel),
      cloudEndpoint: asString(provider.cloudEndpoint, defaultConfig.provider.cloudEndpoint),
      cloudModel: asString(provider.cloudModel, defaultConfig.provider.cloudModel),
      requestTimeoutMs: Math.max(1000, Math.min(30000, Math.floor(asNumber(provider.requestTimeoutMs, defaultConfig.provider.requestTimeoutMs)))),
      maxRetries: Math.max(0, Math.min(5, Math.floor(asNumber(provider.maxRetries, defaultConfig.provider.maxRetries))))
    },
    security: {
      sidecarLocalhostOnly: asBoolean(security.sidecarLocalhostOnly, defaultConfig.security.sidecarLocalhostOnly),
      allowDiagnostics: asBoolean(security.allowDiagnostics, defaultConfig.security.allowDiagnostics)
    }
  };
}

export function mergeConfig(current: SimulationConfig, patch: unknown): SimulationConfig {
  return sanitizeConfig({
    ...current,
    ...(typeof patch === "object" && patch !== null ? patch : {}),
    capture: {
      ...current.capture,
      ...((typeof patch === "object" && patch !== null ? (patch as Record<string, unknown>).capture : {}) as Record<string, unknown>)
    },
    safety: {
      ...current.safety,
      ...((typeof patch === "object" && patch !== null ? (patch as Record<string, unknown>).safety : {}) as Record<string, unknown>)
    },
    compliance: {
      ...current.compliance,
      ...((typeof patch === "object" && patch !== null ? (patch as Record<string, unknown>).compliance : {}) as Record<string, unknown>)
    },
    provider: {
      ...current.provider,
      ...((typeof patch === "object" && patch !== null ? (patch as Record<string, unknown>).provider : {}) as Record<string, unknown>)
    },
    security: {
      ...current.security,
      ...((typeof patch === "object" && patch !== null ? (patch as Record<string, unknown>).security : {}) as Record<string, unknown>)
    }
  });
}
