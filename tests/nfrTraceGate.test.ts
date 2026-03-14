import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateTraceAgainstBaseline, TraceSummary } from "../src/services/nfrTraceGate.js";
import { WorkloadRunner } from "../src/services/workloadRunner.js";

describe("NFR trace baseline gate", () => {
  it("compares reproducible low/mid/high profiles against stored baseline deltas", () => {
    const runner = new WorkloadRunner();
    const baselinePath = path.resolve(process.cwd(), "data/traces/nfr-profile-baseline.json");
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as TraceSummary[];

    const baselineByProfile = new Map(baseline.map((item) => [item.profile, item]));

    const low = runner.captureTrace({ name: "obs_game_local_model", hardwareClass: "low", ticks: 60, disconnectRate: 0.05, seed: 1101 });
    const mid = runner.captureTrace({ name: "obs_game_local_model", hardwareClass: "mid", ticks: 60, disconnectRate: 0.05, seed: 2202 });
    const high = runner.captureTrace({ name: "obs_game_local_model", hardwareClass: "high", ticks: 60, disconnectRate: 0.05, seed: 3303 });

    expect(evaluateTraceAgainstBaseline({ profile: "low", ...low }, baselineByProfile.get("low") as TraceSummary).pass).toBe(true);
    expect(evaluateTraceAgainstBaseline({ profile: "mid", ...mid }, baselineByProfile.get("mid") as TraceSummary).pass).toBe(true);
    expect(evaluateTraceAgainstBaseline({ profile: "high", ...high }, baselineByProfile.get("high") as TraceSummary).pass).toBe(true);
  });
});
