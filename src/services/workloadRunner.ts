import { ObservabilityLogger } from "./observability.js";

export interface WorkloadProfile {
  name: "obs_game_local_model";
  hardwareClass?: "low" | "mid" | "high";
  ticks: number;
  disconnectRate: number;
  seed?: number;
}

export interface WorkloadSummary {
  failures: number;
  p95LatencyMs: number;
  avgCpuPressure: number;
  avgGpuPressure: number;
}

export interface WorkloadTrace extends WorkloadSummary {
  profile: "low" | "mid" | "high";
  seed: number;
  latencies: number[];
  cpuPressures: number[];
  gpuPressures: number[];
}

function hardwarePressureEnvelope(hardwareClass: "low" | "mid" | "high"): { cpuBase: number; gpuBase: number; latencyBase: number } {
  if (hardwareClass === "low") return { cpuBase: 0.72, gpuBase: 0.68, latencyBase: 1050 };
  if (hardwareClass === "high") return { cpuBase: 0.35, gpuBase: 0.32, latencyBase: 520 };
  return { cpuBase: 0.52, gpuBase: 0.46, latencyBase: 760 };
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export class WorkloadRunner {
  private readonly obs = new ObservabilityLogger();

  public run(profile: WorkloadProfile): WorkloadSummary {
    const trace = this.captureTrace(profile);
    return {
      failures: trace.failures,
      p95LatencyMs: trace.p95LatencyMs,
      avgCpuPressure: trace.avgCpuPressure,
      avgGpuPressure: trace.avgGpuPressure
    };
  }

  public captureTrace(profile: WorkloadProfile): WorkloadTrace {
    const latencies: number[] = [];
    const cpuPressures: number[] = [];
    const gpuPressures: number[] = [];
    let failures = 0;
    let cpuSum = 0;
    let gpuSum = 0;
    const hardwareClass = profile.hardwareClass ?? "mid";
    const envelope = hardwarePressureEnvelope(hardwareClass);
    const seed = profile.seed ?? 1337;
    const random = createPrng(seed);

    for (let i = 0; i < profile.ticks; i += 1) {
      const cpuPressure = envelope.cpuBase + random() * 0.22;
      const gpuPressure = envelope.gpuBase + random() * 0.22;
      const endpointFlap = random() < profile.disconnectRate;
      const latencyMs = Math.round(envelope.latencyBase + cpuPressure * 650 + gpuPressure * 500 + (endpointFlap ? 1000 : 0));
      latencies.push(latencyMs);
      cpuPressures.push(Number(cpuPressure.toFixed(4)));
      gpuPressures.push(Number(gpuPressure.toFixed(4)));
      cpuSum += cpuPressure;
      gpuSum += gpuPressure;
      if (endpointFlap) failures += 1;

      this.obs.log("workload_tick", {
        profile: profile.name,
        hardwareClass,
        latencyMs,
        cpuPressure,
        gpuPressure,
        endpointFlap
      });
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const p95LatencyMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    const avgCpuPressure = Number((cpuSum / Math.max(1, profile.ticks)).toFixed(4));
    const avgGpuPressure = Number((gpuSum / Math.max(1, profile.ticks)).toFixed(4));

    this.obs.log("workload_summary", { profile: profile.name, hardwareClass, failures, p95LatencyMs, avgCpuPressure, avgGpuPressure, ticks: profile.ticks, seed });

    return { profile: hardwareClass, seed, failures, p95LatencyMs, avgCpuPressure, avgGpuPressure, latencies, cpuPressures, gpuPressures };
  }
}
