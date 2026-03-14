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
    visionIntervalSec: 25
  },
  safety: {
    dropOnParseFailure: true
  },
  compliance: {
    eulaAccepted: false
  }
};

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeConfig(input: unknown): SimulationConfig {
  const candidate = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const capture = (candidate.capture ?? {}) as Record<string, unknown>;
  const safety = (candidate.safety ?? {}) as Record<string, unknown>;
  const compliance = (candidate.compliance ?? {}) as Record<string, unknown>;

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
    inferenceMode: inferenceMode === "mock-local" || inferenceMode === "mock-cloud" ? inferenceMode : defaultConfig.inferenceMode,
    capture: {
      visionEnabled: asBoolean(capture.visionEnabled, defaultConfig.capture.visionEnabled),
      visionIntervalSec: Math.max(5, Math.min(120, Math.floor(asNumber(capture.visionIntervalSec, defaultConfig.capture.visionIntervalSec))))
    },
    safety: {
      dropOnParseFailure: asBoolean(safety.dropOnParseFailure, defaultConfig.safety.dropOnParseFailure)
    },
    compliance: {
      eulaAccepted: asBoolean(compliance.eulaAccepted, defaultConfig.compliance.eulaAccepted)
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
    }
  });
}
