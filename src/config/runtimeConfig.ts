import { SimulationConfig } from "../core/types.js";

export const defaultConfig: SimulationConfig = {
  streamTopic: "Just Chatting",
  viewerCount: 100,
  engagementMultiplier: 1,
  slowMode: false,
  emoteOnly: false,
  persona: "supportive",
  bias: "split",
  donationFrequency: 0.08,
  ttsEnabled: true,
  ttsMode: process.env.SIM_DEFAULT_TTS === "deepgram_aura" ? "cloud" : "local",
  ttsProvider: process.env.SIM_DEFAULT_TTS === "deepgram_aura" ? "deepgram_aura" : "local",
  inferenceMode: "openai",
  capture: {
    visionEnabled: true,
    visionIntervalSec: 25,
    visionProvider: "local",
    useRealCapture: true,
    sttEndpoint: process.env.STREAMSIM_DEEPGRAM_ENDPOINT ?? "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&filler_words=true&punctuate=true&sentiment=true&topics=true&intents=true",
    sttProvider: process.env.SIM_DEFAULT_STT === "deepgram_nova_2" ? "deepgram" : "local-whisper",
    visionEndpoint: "http://127.0.0.1:7778/vision-tags"
  },
  safety: {
    dropOnParseFailure: true,
    regenerateOnMalformedJson: true,
    dropPolicy: "drop"
  },
  compliance: {
    eulaAccepted: false,
    eulaVersion: "2026-01"
  },
  provider: {
    localEndpoint: "http://127.0.0.1:11434",
    localModel: "llama3.1:8b-instruct-q4_K_M",
    cloudEndpoint: "https://api.openai.com/v1/chat/completions",
    cloudModel: "gpt-5.4-nano-2026-03-17",
    requestTimeoutMs: 30000,
    maxRetries: 1
  },
  security: {
    sidecarLocalhostOnly: true,
    allowNonLocalSidecarOverride: false,
    allowDiagnostics: false
  },
  audioIntelligence: {
    enabled: true,
    sentiment: true,
    intents: true,
    topics: true,
    thresholds: {
      nuclearDrama: -0.9,
      hypeVibe: 0.8
    }
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
  const audioIntelligence = (candidate.audioIntelligence ?? {}) as Record<string, unknown>;
  const thresholds = (audioIntelligence.thresholds ?? {}) as Record<string, unknown>;

  const persona = candidate.persona;
  const bias = candidate.bias;
  const inferenceMode = candidate.inferenceMode;

  return {
    streamTopic: asString(candidate.streamTopic, defaultConfig.streamTopic),
    viewerCount: Math.max(1, Math.min(50000, Math.floor(asNumber(candidate.viewerCount, defaultConfig.viewerCount)))),
    engagementMultiplier: Math.max(0.1, Math.min(5, asNumber(candidate.engagementMultiplier, defaultConfig.engagementMultiplier))),
    slowMode: asBoolean(candidate.slowMode, defaultConfig.slowMode),
    emoteOnly: asBoolean(candidate.emoteOnly, defaultConfig.emoteOnly),
    persona: persona === "supportive" || persona === "trolls" || persona === "meme-lords" || persona === "neutral" ? persona : defaultConfig.persona,
    bias: bias === "agree" || bias === "disagree" || bias === "split" ? bias : defaultConfig.bias,
    donationFrequency: Math.max(0, Math.min(1, asNumber(candidate.donationFrequency, defaultConfig.donationFrequency))),
    ttsEnabled: asBoolean(candidate.ttsEnabled, defaultConfig.ttsEnabled),
    ttsMode: candidate.ttsMode === "off" || candidate.ttsMode === "local" || candidate.ttsMode === "cloud" ? candidate.ttsMode : defaultConfig.ttsMode,
    ttsProvider:
      candidate.ttsProvider === "local" || candidate.ttsProvider === "openai" || candidate.ttsProvider === "deepgram_aura"
        ? candidate.ttsProvider
        : defaultConfig.ttsProvider,
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
      visionProvider: capture.visionProvider === "openai" || capture.visionProvider === "local" ? capture.visionProvider : defaultConfig.capture.visionProvider,
      useRealCapture: asBoolean(capture.useRealCapture, defaultConfig.capture.useRealCapture),
      sttEndpoint: asString(capture.sttEndpoint, defaultConfig.capture.sttEndpoint),
      sttProvider:
        capture.sttProvider === "local-whisper" ||
        capture.sttProvider === "whispercpp" ||
        capture.sttProvider === "deepgram" ||
        capture.sttProvider === "openai-whisper" ||
        capture.sttProvider === "gpt-4o-mini-transcribe" ||
        capture.sttProvider === "mock"
          ? capture.sttProvider
          : defaultConfig.capture.sttProvider,
      visionEndpoint: asString(capture.visionEndpoint, defaultConfig.capture.visionEndpoint)
    },
    safety: {
      dropOnParseFailure: asBoolean(safety.dropOnParseFailure, defaultConfig.safety.dropOnParseFailure),
      regenerateOnMalformedJson: asBoolean(safety.regenerateOnMalformedJson, defaultConfig.safety.regenerateOnMalformedJson),
      dropPolicy: safety.dropPolicy === "censor" || safety.dropPolicy === "drop" ? safety.dropPolicy : defaultConfig.safety.dropPolicy
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
      requestTimeoutMs: Math.max(1000, Math.min(120000, Math.floor(asNumber(provider.requestTimeoutMs, defaultConfig.provider.requestTimeoutMs)))),
      maxRetries: Math.max(0, Math.min(5, Math.floor(asNumber(provider.maxRetries, defaultConfig.provider.maxRetries))))
    },
    security: {
      sidecarLocalhostOnly: asBoolean(security.sidecarLocalhostOnly, defaultConfig.security.sidecarLocalhostOnly),
      allowNonLocalSidecarOverride: asBoolean(security.allowNonLocalSidecarOverride, defaultConfig.security.allowNonLocalSidecarOverride),
      allowDiagnostics: asBoolean(security.allowDiagnostics, defaultConfig.security.allowDiagnostics)
    },
    audioIntelligence: {
      enabled: asBoolean(audioIntelligence.enabled, defaultConfig.audioIntelligence.enabled),
      sentiment: asBoolean(audioIntelligence.sentiment, defaultConfig.audioIntelligence.sentiment),
      intents: asBoolean(audioIntelligence.intents, defaultConfig.audioIntelligence.intents),
      topics: asBoolean(audioIntelligence.topics, defaultConfig.audioIntelligence.topics),
      thresholds: {
        nuclearDrama: Math.max(-1, Math.min(1, asNumber(thresholds.nuclearDrama, defaultConfig.audioIntelligence.thresholds.nuclearDrama))),
        hypeVibe: Math.max(-1, Math.min(1, asNumber(thresholds.hypeVibe, defaultConfig.audioIntelligence.thresholds.hypeVibe)))
      }
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
    },
    audioIntelligence: {
      ...current.audioIntelligence,
      ...((typeof patch === "object" && patch !== null ? (patch as Record<string, unknown>).audioIntelligence : {}) as Record<string, unknown>),
      thresholds: {
        ...current.audioIntelligence.thresholds,
        ...((typeof patch === "object" && patch !== null
          ? ((patch as Record<string, unknown>).audioIntelligence as Record<string, unknown> | undefined)?.thresholds
          : {}) as Record<string, unknown>)
      }
    }
  });
}
