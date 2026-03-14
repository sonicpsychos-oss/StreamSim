import { ObservabilityLogger } from "./observability.js";

export interface WorkloadProfile {
  name: "obs_game_local_model";
  ticks: number;
  disconnectRate: number;
}

export class WorkloadRunner {
  private readonly obs = new ObservabilityLogger();

  public run(profile: WorkloadProfile): { failures: number; p95LatencyMs: number } {
    const latencies: number[] = [];
    let failures = 0;

    for (let i = 0; i < profile.ticks; i += 1) {
      const cpuPressure = 0.5 + Math.random() * 0.4;
      const gpuPressure = 0.4 + Math.random() * 0.5;
      const endpointFlap = Math.random() < profile.disconnectRate;
      const latencyMs = Math.round(700 + cpuPressure * 900 + gpuPressure * 700 + (endpointFlap ? 1200 : 0));
      latencies.push(latencyMs);
      if (endpointFlap) failures += 1;

      this.obs.log("workload_tick", {
        profile: profile.name,
        latencyMs,
        cpuPressure,
        gpuPressure,
        endpointFlap
      });
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const p95LatencyMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    this.obs.log("workload_summary", { profile: profile.name, failures, p95LatencyMs, ticks: profile.ticks });

    return { failures, p95LatencyMs };
  }
}
