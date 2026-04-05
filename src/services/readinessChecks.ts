import { SimulationConfig } from "../core/types.js";
import { SidecarManager } from "./sidecarManager.js";
import { SecretStore } from "../security/secretStore.js";



const secretStore = new SecretStore();
export interface ReadinessCheck {
  id: "device" | "network" | "sidecar" | "credentials";
  ok: boolean;
  severity: "blocking" | "warning";
  message: string;
}

async function checkNetwork(config: SimulationConfig): Promise<ReadinessCheck> {
  try {
    const response = await fetch(config.provider.cloudEndpoint, { method: "HEAD", signal: AbortSignal.timeout(2500) });
    return {
      id: "network",
      ok: response.status < 500,
      severity: "warning",
      message: response.status < 500 ? "Cloud endpoint reachable." : `Cloud endpoint unstable (HTTP ${response.status}).`
    };
  } catch (error) {
    return { id: "network", ok: false, severity: "warning", message: `Cloud endpoint unreachable: ${(error as Error).message}` };
  }
}

function checkDevice(config: SimulationConfig, credentials: { hasCloudKey: boolean; hasDeepgramKey: boolean; hasOpenAiSttKey: boolean }): ReadinessCheck {
  const errors: string[] = [];
  try {
    new URL(config.capture.sttEndpoint);
    new URL(config.capture.visionEndpoint);
  } catch {
    errors.push("Capture endpoints must be valid URLs.");
  }

  if (config.ttsEnabled && !config.provider.maxRetries) {
    errors.push("TTS enabled with zero retries may produce dropouts.");
  }

  if (config.capture.useRealCapture && config.capture.sttProvider === "deepgram" && !credentials.hasDeepgramKey) {
    errors.push("Deepgram STT selected but DEEPGRAM_API_KEY is missing.");
  }

  if (
    config.capture.useRealCapture &&
    (config.capture.sttProvider === "openai-whisper" || config.capture.sttProvider === "gpt-4o-mini-transcribe") &&
    !credentials.hasOpenAiSttKey
  ) {
    errors.push("Cloud OpenAI STT selected but no OpenAI STT API key is stored.");
  }

  if (config.capture.useRealCapture && (config.capture.sttProvider === "whispercpp" || config.capture.sttProvider === "local-whisper") && !config.capture.sttEndpoint.startsWith("http")) {
    errors.push("Whisper STT endpoint must be a valid URL.");
  }

  if (config.capture.useRealCapture && config.capture.sttProvider === "local-whisper") {
    try {
      const parsed = new URL(config.capture.sttEndpoint);
      if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
        errors.push("Local Whisper STT must point to localhost/127.0.0.1 endpoint.");
      }
    } catch {
      errors.push("Local Whisper STT endpoint must be a valid URL.");
    }
  }

  return {
    id: "device",
    ok: errors.length === 0,
    severity: "blocking",
    message: errors.length === 0 ? "Device/capture configuration is valid." : errors.join(" ")
  };
}

function checkCredentials(config: SimulationConfig, credentials: { hasCloudKey: boolean; hasDeepgramKey: boolean; hasOpenAiSttKey: boolean }): ReadinessCheck {
  const cloudInference = config.inferenceMode === "openai" || config.inferenceMode === "groq" || config.inferenceMode === "mock-cloud";
  const cloudTts = config.ttsEnabled && config.ttsMode === "cloud" && config.ttsProvider === "openai";
  const deepgramTts = config.ttsEnabled && config.ttsMode === "cloud" && config.ttsProvider === "deepgram_aura";

  if ((cloudInference || cloudTts) && !credentials.hasCloudKey) {
    return {
      id: "credentials",
      ok: false,
      severity: "blocking",
      message: "Cloud mode selected without a stored API key. Save a cloud key or switch to local mode."
    };
  }
  if (config.capture.sttProvider === "deepgram" || deepgramTts) {
    const hasKey = credentials.hasDeepgramKey || secretStore.hasKey("DEEPGRAM_API_KEY");
    if (!hasKey) {
      return {
        id: "credentials",
        ok: false,
        severity: "blocking",
        message: "Missing Deepgram API Key"
      };
    }
  }

  return {
    id: "credentials",
    ok: true,
    severity: "warning",
    message: cloudInference || cloudTts || deepgramTts ? "Provider credentials ready." : "Local-only mode selected; cloud key not required."
  };
}

async function checkSidecar(config: SimulationConfig, sidecar: SidecarManager): Promise<ReadinessCheck> {
  if (config.inferenceMode !== "ollama" && config.inferenceMode !== "lmstudio") {
    return { id: "sidecar", ok: true, severity: "warning", message: "Cloud mode selected; sidecar optional." };
  }

  const status = await sidecar.ensureReady(config);
  return {
    id: "sidecar",
    ok: status.ready,
    severity: "blocking",
    message: status.ready ? "Local sidecar is ready." : status.details
  };
}

export async function runReadinessChecks(
  config: SimulationConfig,
  sidecar = new SidecarManager(),
  credentials = { hasCloudKey: false, hasDeepgramKey: false, hasOpenAiSttKey: false }
): Promise<{ checks: ReadinessCheck[]; ready: boolean }> {
  const checks = [checkDevice(config, credentials), checkCredentials(config, credentials), await checkNetwork(config), await checkSidecar(config, sidecar)];
  const ready = checks.filter((check) => check.severity === "blocking").every((check) => check.ok);
  return { checks, ready };
}
