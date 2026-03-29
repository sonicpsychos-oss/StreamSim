import { describe, expect, it } from "vitest";
import { calibrateToneSnapshot, RealismSignalModel } from "../src/llm/realismSignals.js";
import { ContextAssembler } from "../src/pipeline/contextAssembler.js";
import { defaultConfig } from "../src/config/runtimeConfig.js";

describe("realism signal extraction + calibration", () => {
  it("keeps calibrated tone in production bounds", () => {
    const calibrated = calibrateToneSnapshot({ volumeRms: 3, paceWpm: 400 });
    expect(calibrated.volumeRms).toBeLessThanOrEqual(0.9);
    expect(calibrated.volumeRms).toBeGreaterThanOrEqual(0.18);
    expect(calibrated.paceWpm).toBeLessThanOrEqual(240);
    expect(calibrated.paceWpm).toBeGreaterThanOrEqual(75);
  });

  it("provides rolling excitement + donation propensity + persona-conditioned bias", () => {
    const model = new RealismSignalModel();
    const baseline = model.extract(
      { transcript: "chat what should we do", tone: { volumeRms: 0.3, paceWpm: 110 }, visionTags: [], recentChatHistory: [], timestamp: new Date().toISOString() },
      "neutral"
    );
    const excited = model.extract(
      { transcript: "CHAT LETS GO!!! clip that!!!", tone: { volumeRms: 0.8, paceWpm: 190 }, visionTags: ["keyboard", "lights"], recentChatHistory: [], timestamp: new Date().toISOString() },
      "supportive"
    );

    expect(excited.excitementScore).toBeGreaterThan(baseline.excitementScore);
    expect(excited.donationPropensity).toBeGreaterThan(baseline.donationPropensity);
    expect(excited.personaBiasScore).toBeGreaterThan(0.5);
  });

  it("aligns mock context tone with calibrated rules rather than unbounded random values", () => {
    const assembler = new ContextAssembler();
    const context = assembler.build(defaultConfig);
    expect(context.tone.volumeRms).toBeGreaterThanOrEqual(0.18);
    expect(context.tone.volumeRms).toBeLessThanOrEqual(0.9);
    expect(context.tone.paceWpm).toBeGreaterThanOrEqual(75);
    expect(context.tone.paceWpm).toBeLessThanOrEqual(240);
  });
});
