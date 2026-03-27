import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { mergeConfig, sanitizeConfig } from "../src/config/runtimeConfig.js";
import { parseInferenceOutput, repairInferenceOutput } from "../src/pipeline/outputParser.js";

describe("runtime config", () => {
  it("clamps invalid values and supports nested sections", () => {
    const sanitized = sanitizeConfig({
      viewerCount: -10,
      engagementMultiplier: 100,
      persona: "invalid",
      capture: { visionIntervalSec: 1 },
      compliance: { eulaAccepted: true }
    });

    expect(sanitized.viewerCount).toBe(1);
    expect(sanitized.engagementMultiplier).toBe(5);
    expect(sanitized.persona).toBe(defaultConfig.persona);
    expect(sanitized.capture.visionIntervalSec).toBe(5);
    expect(sanitized.compliance.eulaAccepted).toBe(true);
  });

  it("merges nested patch fields", () => {
    const merged = mergeConfig(defaultConfig, { capture: { visionEnabled: false }, provider: { maxRetries: 4 } });
    expect(merged.capture.visionEnabled).toBe(false);
    expect(merged.capture.visionIntervalSec).toBe(defaultConfig.capture.visionIntervalSec);
    expect(merged.provider.maxRetries).toBe(4);
  });
});

describe("output parser", () => {
  it("repairs fenced JSON payload and returns messages", () => {
    const repaired = repairInferenceOutput(`###json\n{"messages":[{"username":"a","text":"hi","emotes":[]}]}\n###`);
    const result = parseInferenceOutput(repaired);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("a");
  });


  it("accepts messages without username for local identity assignment", () => {
    const result = parseInferenceOutput('{"messages":[{"text":"hi","emotes":[]}]}');
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("");
  });

  it("throws when no valid messages are present", () => {
    expect(() => parseInferenceOutput('{"messages":[{"foo":1}]}')).toThrow(/No valid messages/);
  });
});
