import { ObservabilityLogger } from "./observability.js";

export interface WorkloadProfile {
  name: "obs_game_local_model";
  hardwareClass?: "low" | "mid" | "high";
  ticks: number;
  disconnectRate: number;
}

export interface WorkloadSummary {
  failures: number;
  p95LatencyMs: number;
  avgCpuPressure: number;
  avgGpuPressure: number;
}

function hardwarePressureEnvelope(hardwareClass: "low" | "mid" | "high"): { cpuBase: number; gpuBase: number; latencyBase: number } {
  if (hardwareClass === "low") return { cpuBase: 0.72, gpuBase: 0.68, latencyBase: 1050 };
  if (hardwareClass === "high") return { cpuBase: 0.35, gpuBase: 0.32, latencyBase: 520 };
  return { cpuBase: 0.52, gpuBase: 0.46, latencyBase: 760 };
}

export class WorkloadRunner {
  private readonly obs = new ObservabilityLogger();

  public run(profile: WorkloadProfile): WorkloadSummary {
    const latencies: number[] = [];
    let failures = 0;
    let cpuSum = 0;
    let gpuSum = 0;
    const hardwareClass = profile.hardwareClass ?? "mid";
    const envelope = hardwarePressureEnvelope(hardwareClass);

    for (let i = 0; i < profile.ticks; i += 1) {
      const cpuPressure = envelope.cpuBase + Math.random() * 0.22;
      const gpuPressure = envelope.gpuBase + Math.random() * 0.22;
      const endpointFlap = Math.random() < profile.disconnectRate;
      const latencyMs = Math.round(envelope.latencyBase + cpuPressure * 650 + gpuPressure * 500 + (endpointFlap ? 1000 : 0));
      latencies.push(latencyMs);
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

    this.obs.log("workload_summary", { profile: profile.name, hardwareClass, failures, p95LatencyMs, avgCpuPressure, avgGpuPressure, ticks: profile.ticks });

    return { failures, p95LatencyMs, avgCpuPressure, avgGpuPressure };
  }
}
