import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { applySafetyFilter } from "../src/core/safetyFilter.js";
import { collectHardwareProfile, recommendTier } from "../src/services/bootDiagnostics.js";
import { runReadinessChecks } from "../src/services/readinessChecks.js";

class ReadySidecar {
  public async ensureReady(): Promise<{ ready: boolean; details: string }> {
    return { ready: true, details: "ok" };
  }
}

describe("boot diagnostics + tiering", () => {
  it("collects profile and returns tier recommendation", async () => {
    const profile = await collectHardwareProfile(defaultConfig);
    const recommendation = recommendTier(profile);
    expect(profile.cpuCores).toBeGreaterThan(0);
    expect(["A", "B", "C"]).toContain(recommendation.tier);
  });
});

describe("readiness checks", () => {
  it("returns readiness shape with device/network/sidecar checks", async () => {
    const result = await runReadinessChecks(defaultConfig, new ReadySidecar() as never);
    expect(result.checks.map((c) => c.id).sort()).toEqual(["device", "network", "sidecar"]);
  });
});

describe("safety conservative fallback", () => {
  it("falls back to system/emote-only when dictionary unavailable", () => {
    const original = process.env.STREAMSIM_BANLIST_FORCE_FAIL;
    process.env.STREAMSIM_BANLIST_FORCE_FAIL = "1";

    const filtered = applySafetyFilter([
      { id: "1", username: "user", text: "hello", emotes: [], createdAt: new Date().toISOString() },
      { id: "2", username: "system", text: "system notice", emotes: [], createdAt: new Date().toISOString() },
      { id: "3", username: "user", text: "", emotes: ["Kappa"], createdAt: new Date().toISOString() }
    ]);

    process.env.STREAMSIM_BANLIST_FORCE_FAIL = original;
    expect(filtered).toHaveLength(2);
    expect(filtered.map((m) => m.id).sort()).toEqual(["2", "3"]);
  });
});
