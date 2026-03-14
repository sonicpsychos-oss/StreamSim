import { describe, expect, it } from "vitest";
import { evaluateTraceAgainstBaseline } from "../src/services/nfrTraceGate.js";
import { WorkloadRunner } from "../src/services/workloadRunner.js";

describe("NFR trace baseline gate", () => {
  it("compares low/mid/high profiles against baseline deltas", () => {
    const runner = new WorkloadRunner();

    const baselineLow = { profile: "low" as const, p95LatencyMs: 2600, avgCpuPressure: 0.8, avgGpuPressure: 0.75 };
    const baselineMid = { profile: "mid" as const, p95LatencyMs: 2200, avgCpuPressure: 0.65, avgGpuPressure: 0.58 };
    const baselineHigh = { profile: "high" as const, p95LatencyMs: 1800, avgCpuPressure: 0.5, avgGpuPressure: 0.42 };

    const low = runner.run({ name: "obs_game_local_model", hardwareClass: "low", ticks: 40, disconnectRate: 0.05 });
    const mid = runner.run({ name: "obs_game_local_model", hardwareClass: "mid", ticks: 40, disconnectRate: 0.05 });
    const high = runner.run({ name: "obs_game_local_model", hardwareClass: "high", ticks: 40, disconnectRate: 0.05 });

    expect(evaluateTraceAgainstBaseline({ profile: "low", ...low }, baselineLow).pass).toBe(true);
    expect(evaluateTraceAgainstBaseline({ profile: "mid", ...mid }, baselineMid).pass).toBe(true);
    expect(evaluateTraceAgainstBaseline({ profile: "high", ...high }, baselineHigh).pass).toBe(true);
  });
});
