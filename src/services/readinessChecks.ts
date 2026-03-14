import { SimulationConfig } from "../core/types.js";
import { SidecarManager } from "./sidecarManager.js";

export interface ReadinessCheck {
  id: "device" | "network" | "sidecar";
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

function checkDevice(config: SimulationConfig): ReadinessCheck {
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

  return {
    id: "device",
    ok: errors.length === 0,
    severity: "blocking",
    message: errors.length === 0 ? "Device/capture configuration is valid." : errors.join(" ")
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

export async function runReadinessChecks(config: SimulationConfig, sidecar = new SidecarManager()): Promise<{ checks: ReadinessCheck[]; ready: boolean }> {
  const checks = [checkDevice(config), await checkNetwork(config), await checkSidecar(config, sidecar)];
  const ready = checks.filter((check) => check.severity === "blocking").every((check) => check.ok);
  return { checks, ready };
}
