import os from "node:os";
import { SimulationConfig } from "../core/types.js";

export interface HardwareProfile {
  cpuCores: number;
  totalMemoryGb: number;
  estimatedVramGb: number;
  networkLatencyMs: number;
  collectedAt: string;
}

export interface TierRecommendation {
  tier: "A" | "B" | "C";
  inferenceMode: "ollama" | "openai" | "groq";
  reason: string;
}

async function probeLatency(url: string, timeoutMs: number): Promise<number> {
  const started = Date.now();
  try {
    await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    return Math.max(1, Date.now() - started);
  } catch {
    return timeoutMs;
  }
}

function estimateVramGb(): number {
  const env = Number(process.env.STREAMSIM_VRAM_GB ?? "");
  if (Number.isFinite(env) && env > 0) return env;
  const memGb = os.totalmem() / (1024 ** 3);
  return Number(Math.max(1, Math.min(24, memGb * 0.25)).toFixed(1));
}

export async function collectHardwareProfile(config: SimulationConfig): Promise<HardwareProfile> {
  const networkLatencyMs = await probeLatency(config.provider.cloudEndpoint, 2500);
  return {
    cpuCores: os.cpus().length,
    totalMemoryGb: Number((os.totalmem() / (1024 ** 3)).toFixed(1)),
    estimatedVramGb: estimateVramGb(),
    networkLatencyMs,
    collectedAt: new Date().toISOString()
  };
}

export function recommendTier(profile: HardwareProfile): TierRecommendation {
  if (profile.estimatedVramGb >= 12 && profile.cpuCores >= 8) {
    return { tier: "A", inferenceMode: "ollama", reason: "High VRAM + CPU headroom supports local 8B inference." };
  }
  if (profile.estimatedVramGb >= 6 && profile.cpuCores >= 4) {
    return { tier: "B", inferenceMode: "ollama", reason: "Mid-tier hardware can run quantized local models." };
  }
  const cloudMode = profile.networkLatencyMs <= 120 ? "groq" : "openai";
  return { tier: "C", inferenceMode: cloudMode, reason: "Low local headroom; cloud-first low-VRAM mode recommended." };
}
