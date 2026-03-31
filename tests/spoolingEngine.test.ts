import { describe, expect, it } from "vitest";
import { applySafetyPolicy } from "../src/core/safetyFilter.js";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { SpoolingEngine } from "../src/services/spoolingEngine.js";

const engine = new SpoolingEngine();

const baseConfig = {
  ...defaultConfig,
  viewerCount: 100,
  engagementMultiplier: 1,
  slowMode: false,
  emoteOnly: false,
  persona: "supportive" as const,
  bias: "split" as const,
  donationFrequency: 0,
  ttsEnabled: false
};

describe("SpoolingEngine", () => {
  it("enforces slow mode max mps", () => {
    const mps = engine.calculateTargetMps(
      { ...baseConfig, slowMode: true },
      { volumeRms: 0.8, paceWpm: 180 }
    );

    expect(mps).toBeCloseTo(1 / 3, 4);
  });

  it("boosts high-energy tone", () => {
    const calm = engine.calculateTargetMps(baseConfig, { volumeRms: 0.1, paceWpm: 90 });
    const hype = engine.calculateTargetMps(baseConfig, { volumeRms: 0.7, paceWpm: 170 });

    expect(hype).toBeGreaterThan(calm);
  });

  it("creates staggered offsets for multi-message batches", () => {
    const offsets = engine.batchOffsetsMs(6, 1200);
    expect(offsets).toHaveLength(6);
    expect(offsets[0]).toBe(0);
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
  });
});

describe("Safety Filter", () => {
  it("drops banned content instead of censoring", () => {
    const safe = {
      id: "1",
      username: "a",
      text: "nice play",
      emotes: [],
      createdAt: new Date().toISOString()
    };
    const unsafe = {
      id: "2",
      username: "b",
      text: "go do self harm",
      emotes: [],
      createdAt: new Date().toISOString()
    };

    const result = applySafetyPolicy([safe, unsafe], defaultConfig);
    expect(result.safeMessages).toHaveLength(1);
    expect(result.safeMessages[0].id).toBe("1");
    expect(result.droppedCount).toBe(1);
  });
});
