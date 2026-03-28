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

    const diverse = (orchestrator as any).enforceDiversityRules(input);
    expect(diverse[1].text).not.toBe("yes w audio fr");
    expect(diverse[3].text.toLowerCase()).not.toContain("lowkey");
  });
});
