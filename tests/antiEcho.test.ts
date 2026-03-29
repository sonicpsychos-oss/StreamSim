import { describe, expect, it } from "vitest";
import { SimulationOrchestrator } from "../src/services/simulationOrchestrator.js";
import { ChatMessage } from "../src/core/types.js";
import { defaultConfig } from "../src/config/runtimeConfig.js";

function makeOrchestrator(): SimulationOrchestrator {
  return new SimulationOrchestrator(() => defaultConfig, () => {}, () => {});
}

describe("anti-echo constraint", () => {
  it("drops messages that repeat distinctive transcript terms", () => {
    const orchestrator = makeOrchestrator();
    const input: ChatMessage[] = [
      {
        id: "1",
        username: "user1",
        text: "purple sombrero?? W",
        emotes: ["W"],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "2",
        username: "user2",
        text: "bro what is on your head 💀",
        emotes: ["💀"],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      }
    ];

    const filtered = (orchestrator as any).applyAntiEchoConstraint(input, "I am wearing a purple sombrero.");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].text).toBe("bro what is on your head 💀");
  });

  it("injects a non-echo fallback when every candidate message parrots transcript terms", () => {
    const orchestrator = makeOrchestrator();
    const input: ChatMessage[] = [
      {
        id: "1",
        username: "user1",
        text: "dusty pilot??",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      }
    ];

    const filtered = (orchestrator as any).applyAntiEchoConstraint(input, "Dusty Pilot.");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].text.toLowerCase()).not.toContain("dusty");
    expect(filtered[0].text.toLowerCase()).not.toContain("pilot");
  });

  it("rotates repeated slang and forces contrast between first two messages", () => {
    const orchestrator = makeOrchestrator();
    const input: ChatMessage[] = [
      {
        id: "1",
        username: "user1",
        text: "yup mic w fr",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "2",
        username: "user2",
        text: "yes w audio fr",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "3",
        username: "user3",
        text: "lowkey this is chaos",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "4",
        username: "user4",
        text: "that was lowkey wild",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      }
    ];

    const diverse = (orchestrator as any).enforceDiversityRules(input, ["default"]);
    expect(diverse[1].text).not.toBe("yes w audio fr");
    expect(diverse[3].text.toLowerCase()).not.toContain("lowkey");
  });

  it("detects streamer reading chat and pivots to chatter-response messages", () => {
    const orchestrator = makeOrchestrator();
    const input: ChatMessage[] = [
      {
        id: "1",
        username: "user1",
        text: "any reaction",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      }
    ];

    const rewritten = (orchestrator as any).isReadingChat("bro that take is wild", ["bro that take is wild", "chat got him pressed"]);
    expect(rewritten).toBe(true);
    const reacted = (orchestrator as any).rewriteForReadingChat(input);
    expect(reacted[0].text).toContain("chatter");
  });

  it("forces simp vs anti-simp contrast when thirst mode is active", () => {
    const orchestrator = makeOrchestrator();
    const input: ChatMessage[] = [
      {
        id: "1",
        username: "user1",
        text: "w",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "2",
        username: "user2",
        text: "w",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      }
    ];
    const diverse = (orchestrator as any).enforceDiversityRules(input, ["thirst"]);
    expect(diverse[0].text).toContain("gyatt");
    expect(diverse[1].text).toContain("simps");
  });

  it("keeps full phrases instead of force-trimming most messages to 3 words", () => {
    const orchestrator = makeOrchestrator();
    const input: ChatMessage[] = [
      {
        id: "1",
        username: "user1",
        text: "this sentence should stay fully readable and not be cut",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      }
    ];
    const normalized = (orchestrator as any).enforcePersonaSyntax(input);
    expect(normalized[0].text.split(/\s+/).length).toBeGreaterThan(3);
  });

  it("rewrites duplicate nearby messages to improve diversity", () => {
    const orchestrator = makeOrchestrator();
    const input: ChatMessage[] = [
      {
        id: "1",
        username: "user1",
        text: "mic check passed",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "2",
        username: "user2",
        text: "mic check passed",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      }
    ];
    const diverse = (orchestrator as any).enforceDiversityRules(input, ["default"]);
    expect(diverse[1].text.toLowerCase()).not.toBe("mic check passed");
  });

  it("prevents viewer messages from mirroring streamer-style leading 'we' phrasing", () => {
    const orchestrator = makeOrchestrator();
    const input: ChatMessage[] = [
      {
        id: "1",
        username: "user1",
        text: "We are live now",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      }
    ];
    const normalized = (orchestrator as any).enforcePersonaSyntax(input);
    expect(normalized[0].text).toBe("you live now");
  });

  it("enforces starter diversity and brevity ratio across batches", () => {
    const orchestrator = makeOrchestrator();
    const input: ChatMessage[] = [
      { id: "1", username: "u1", text: "ngl this is kinda too long for chat pace", emotes: [], donationCents: null, ttsText: null, createdAt: new Date().toISOString() },
      { id: "2", username: "u2", text: "ngl we are still talking way too much here", emotes: [], donationCents: null, ttsText: null, createdAt: new Date().toISOString() },
      { id: "3", username: "u3", text: "lowkey another sentence that should be shorter", emotes: [], donationCents: null, ttsText: null, createdAt: new Date().toISOString() },
      { id: "4", username: "u4", text: "lowkey one more heavy sentence for test", emotes: [], donationCents: null, ttsText: null, createdAt: new Date().toISOString() },
      { id: "5", username: "u5", text: "bro this one stays long too", emotes: [], donationCents: null, ttsText: null, createdAt: new Date().toISOString() }
    ];
    const diverse = (orchestrator as any).enforceDiversityRules(input, ["default"]);
    expect(diverse[1].text.split(/\s+/)[0]).not.toBe("ngl");
    const shortCount = diverse.filter((message: ChatMessage) => message.text.trim().split(/\s+/).length <= 4).length;
    expect(shortCount).toBeGreaterThanOrEqual(4);
  });

  it("keeps transcript context stable even after repeated identical lines", () => {
    const orchestrator = makeOrchestrator();
    const baseContext = {
      transcript: "same line from streamer",
      tone: { volumeRms: 0.4, paceWpm: 120 },
      visionTags: [],
      recentChatHistory: [],
      timestamp: new Date().toISOString()
    };

    const first = (orchestrator as any).applyTranscriptDecay(baseContext);
    const second = (orchestrator as any).applyTranscriptDecay(baseContext);
    const third = (orchestrator as any).applyTranscriptDecay(baseContext);
    const fourth = (orchestrator as any).applyTranscriptDecay(baseContext);

    expect(first.transcript).toBe("same line from streamer");
    expect(second.transcript).toBe("same line from streamer");
    expect(third.transcript).toBe("same line from streamer");
    expect(fourth.transcript).toBe("same line from streamer");
  });
});
