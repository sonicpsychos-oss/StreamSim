import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { mergeConfig, sanitizeConfig } from "../src/config/runtimeConfig.js";
import { classifyMalformedOutput, parseInferenceOutput, repairInferenceOutput } from "../src/pipeline/outputParser.js";
import { buildPromptPayload, checkFishingState } from "../src/pipeline/promptBuilder.js";
import { explainInferenceFailure } from "../src/services/simulationOrchestrator.js";
import { HybridInferenceProvider } from "../src/llm/realInferenceProvider.js";

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
    const repaired = repairInferenceOutput(`###json\n{"messages":[{"username":"a","text":"hi","emotes":[],"donationCents":null,"ttsText":null},{"username":"b","text":"yo","emotes":[],"donationCents":null,"ttsText":null}]}\n###`);
    const result = parseInferenceOutput(repaired);
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("a");
  });


  it("accepts messages without username for local identity assignment", () => {
    const result = parseInferenceOutput('{"messages":[{"text":"hi","emotes":[],"donationCents":null,"ttsText":null},{"text":"yo","emotes":[],"donationCents":null,"ttsText":null}]}');
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("");
  });

  it("accepts messages when donation fields are omitted", () => {
    const result = parseInferenceOutput('{"messages":[{"text":"hi","emotes":[]},{"text":"yo","emotes":["🔥"]}]}');
    expect(result).toHaveLength(2);
    expect(result[0].donationCents).toBeUndefined();
    expect(result[0].ttsText).toBeUndefined();
  });

  it("throws when no valid messages are present", () => {
    expect(() => parseInferenceOutput('{"messages":[{"foo":1}]}')).toThrow(/Expected at least 2 valid messages/);
  });

  it("classifies undersized message arrays as invalid schema", () => {
    const malformed = "noise ###json\n{\"messages\":[{\"text\":\"yo\",\"emotes\":[],\"donationCents\":null,\"ttsText\":null}]}### trailing";
    expect(classifyMalformedOutput(malformed)).toBe("invalid_message_schema");
  });

  it("caps oversized payloads to avoid parser stalls and still throws cleanly", () => {
    const huge = `${"x".repeat(300_000)}{"messages":[{"text":"ok","emotes":[],"donationCents":null,"ttsText":null}]}`;
    expect(() => parseInferenceOutput(huge)).toThrow();
  });

  it("filters unsupported emote strings and suppresses ttsText without donation", () => {
    const result = parseInferenceOutput(
      '{"messages":[{"text":"yo","emotes":["W","LetMeCook","🔥"],"donationCents":null,"ttsText":"read this"},{"text":"ok","emotes":[],"donationCents":null,"ttsText":null}]}'
    );
    expect(result[0].emotes).toEqual(["W", "🔥"]);
    expect(result[0].ttsText).toBeUndefined();
  });

  it("normalizes chat style and blocks radio-check phrase", () => {
    const result = parseInferenceOutput(
      '{"messages":[{"text":"LOUD AND CLEAR... We got you—yes.","emotes":[],"donationCents":null,"ttsText":null},{"text":"second","emotes":[],"donationCents":null,"ttsText":null}]}'
    );
    expect(result[0].text).toBe("we hear u we got you yes");
  });

  it("sanitizes repetitive lane/topic phrasing and ghosting language", () => {
    const result = parseInferenceOutput(
      '{"messages":[{"text":"pick a lane you ghosted","emotes":[],"donationCents":null,"ttsText":null},{"text":"pick a topic you vanished","emotes":[],"donationCents":null,"ttsText":null}]}'
    );
    expect(result[0].text).toBe("switch it up you still here");
    expect(result[1].text).toBe("switch it up still here");
  });

  it("drops fully empty messages from parsed output", () => {
    expect(() =>
      parseInferenceOutput(
        '{"messages":[{"text":"","emotes":[],"donationCents":null,"ttsText":null},{"text":"ok","emotes":[],"donationCents":null,"ttsText":null}]}'
      )
    ).toThrow(/Expected at least 2 valid messages/);
  });
});


describe("prompt payload", () => {
  it("scales requested message count with viewer count up to higher-room caps", () => {
    const low = buildPromptPayload(defaultConfig, {
      transcript: "",
      tone: { volumeRms: 0.1, paceWpm: 90 },
      visionTags: [],
      recentChatHistory: [],
      timestamp: new Date().toISOString()
    });
    const high = buildPromptPayload({ ...defaultConfig, viewerCount: 50_000 }, {
      transcript: "",
      tone: { volumeRms: 0.1, paceWpm: 90 },
      visionTags: [],
      recentChatHistory: [],
      timestamp: new Date().toISOString()
    });
    const medium = buildPromptPayload({ ...defaultConfig, viewerCount: 2_000 }, {
      transcript: "",
      tone: { volumeRms: 0.1, paceWpm: 90 },
      visionTags: [],
      recentChatHistory: [],
      timestamp: new Date().toISOString()
    });

    expect(low.requestedMessageCount).toBeGreaterThanOrEqual(5);
    expect(low.requestedMessageCount).toBeLessThanOrEqual(8);
    expect(medium.requestedMessageCount).toBeGreaterThan(10);
    expect(high.requestedMessageCount).toBe(28);
  });

  it("detects aggressive fishing only when vibe + inquiry + leading keywords align", () => {
    expect(checkFishingState("be real this fit is fire right?", "arrogant", "inquiry")).toBe("AGGRESSIVE_SUBVERSION");
    expect(checkFishingState("be real this fit is fire right?", "chill", "inquiry")).toBe("STANDARD_CONTRARIAN");
    expect(checkFishingState("i am locking in", "confident", "inquiry")).toBe("OFF");
  });

  it("keeps benign self-talk out of contrarian mode", () => {
    expect(checkFishingState("good job", "chill", "statement")).toBe("OFF");
    expect(checkFishingState("nice job to me", "confident", "statement")).toBe("OFF");
  });

  it("recognizes pity-bait validation fishing", () => {
    expect(checkFishingState("man i'm so bad i should just quit", "questioning", "inquiry")).toBe("STANDARD_CONTRARIAN");
    expect(checkFishingState("chat i'm so bad i should just quit right?", "confident", "inquiry")).toBe("AGGRESSIVE_SUBVERSION");
  });

  it("keeps neutral inquiries out of fishing mode without explicit validation signals", () => {
    expect(checkFishingState("what settings should i try next", "questioning", "inquiry")).toBe("OFF");
    expect(checkFishingState("we queue now", "arrogant", "statement")).toBe("STANDARD_CONTRARIAN");
  });

  it("injects fishingState metadata into payload context", () => {
    const payload = buildPromptPayload(defaultConfig, {
      transcript: "yo chat be honest this run was clean right?",
      tone: { volumeRms: 0.4, paceWpm: 125 },
      visionTags: [],
      vibe: "hyped",
      intent: "inquiry",
      recentChatHistory: [],
      timestamp: new Date().toISOString()
    });

    expect(payload.context.fishingState).toBe("STANDARD_CONTRARIAN");
  });

  it("derives gesture-aware situational tags and behavioral modes from vision tags", () => {
    const payload = buildPromptPayload(defaultConfig, {
      transcript: "chat going wild",
      tone: { volumeRms: 0.45, paceWpm: 132 },
      visionTags: ["middle finger to camera", "heart hands pose"],
      recentChatHistory: [],
      timestamp: new Date().toISOString()
    });

    expect(payload.situationalTags).toEqual(expect.arrayContaining([
      "gesture_middle_finger",
      "aggressive",
      "disrespect",
      "gesture_heart_hands",
      "supportive",
      "affectionate"
    ]));
    expect(payload.behavioralModes).toEqual(expect.arrayContaining(["drama", "conflict", "support"]));
  });

  it("adds broader expression/activity/environment context from vision tags", () => {
    const payload = buildPromptPayload(defaultConfig, {
      transcript: "queue next",
      tone: { volumeRms: 0.31, paceWpm: 118 },
      visionTags: ["smiling while reading chat", "leaning in", "adjusting headset", "dim rgb room"],
      recentChatHistory: [],
      timestamp: new Date().toISOString()
    });

    expect(payload.situationalTags).toEqual(expect.arrayContaining([
      "positive_expression",
      "chat_engagement",
      "engaged_posture",
      "equipment_adjustment",
      "dim_lighting",
      "rgb_lighting"
    ]));
    expect(payload.behavioralModes).toEqual(expect.arrayContaining(["focus"]));
  });
});

describe("inference failure explanation", () => {
  it("maps truncated JSON parse errors to a user-friendly cloud detail", () => {
    expect(explainInferenceFailure("Unexpected end of JSON input")).toBe("OpenAI cloud response was truncated (broken JSON package).");
  });

  it("preserves unrelated error details", () => {
    expect(explainInferenceFailure("Cloud provider failed (429)")).toBe("Cloud provider failed (429)");
  });
});

describe("cloud generation hardening", () => {
  it("sets a bounded max_completion_tokens budget for cloud generation", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "test-key";
    const provider = new HybridInferenceProvider("openai");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{\"messages\":[{\"text\":\"a\",\"emotes\":[],\"donationCents\":null,\"ttsText\":null},{\"text\":\"b\",\"emotes\":[],\"donationCents\":null,\"ttsText\":null}]}" } }] })
    }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = buildPromptPayload(defaultConfig, {
      transcript: "yo",
      tone: { volumeRms: 0.2, paceWpm: 110 },
      visionTags: [],
      recentChatHistory: [],
      timestamp: new Date().toISOString()
    });

    await provider.generate(payload, defaultConfig);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(220);
    expect(body.max_completion_tokens).toBeLessThanOrEqual(900);
    vi.unstubAllGlobals();
  });

  it("throws explicit error when provider payload has no text field", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "test-key";
    const provider = new HybridInferenceProvider("openai");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id: "abc123" }) })));
    const payload = buildPromptPayload(defaultConfig, {
      transcript: "yo",
      tone: { volumeRms: 0.2, paceWpm: 110 },
      visionTags: [],
      recentChatHistory: [],
      timestamp: new Date().toISOString()
    });

    await expect(provider.generate(payload, defaultConfig)).rejects.toThrow(/Provider returned empty content/);
    vi.unstubAllGlobals();
  });
});
