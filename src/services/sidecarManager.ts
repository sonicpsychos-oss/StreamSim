import { SimulationConfig } from "../core/types.js";

export interface SidecarStatus {
  ready: boolean;
  phase: "idle" | "starting" | "pulling" | "ready" | "failed";
  progress: number;
  details: string;
  fallbackSuggested: boolean;
}

export class SidecarManager {
  public async ensureReady(config: SimulationConfig): Promise<SidecarStatus> {
    if (config.inferenceMode !== "ollama" && config.inferenceMode !== "lmstudio") {
      return { ready: true, phase: "ready", progress: 100, details: "Cloud mode selected.", fallbackSuggested: false };
    }

    try {
      await fetch(`${config.provider.localEndpoint}/api/tags`, { signal: AbortSignal.timeout(config.provider.requestTimeoutMs) });
      return { ready: true, phase: "ready", progress: 100, details: "Local sidecar reachable.", fallbackSuggested: false };
    } catch {
      return {
        ready: false,
        phase: "failed",
        progress: 0,
        details: "Local sidecar unavailable. Falling back to cloud is recommended.",
        fallbackSuggested: true
      };
    }
  }
}
