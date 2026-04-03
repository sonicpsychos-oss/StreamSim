import { describe, expect, it } from "vitest";
import { ModSimController } from "../src/services/modSimController.js";
import { ChatMessage } from "../src/core/types.js";

describe("ModSimController postFlight word cap", () => {
  it("prefers smart compression before hard cut and keeps the closing keyword", () => {
    const modSim = new ModSimController();
    const messages: ChatMessage[] = [
      {
        id: "1",
        username: "",
        text: "this is literally a really wild moment and we are basically all losing composure legendary",
        emotes: [],
        donationCents: null,
        ttsText: null,
        createdAt: new Date().toISOString()
      }
    ];

    const result = modSim.postFlight(messages, { brainRot: false });
    const words = result[0].text.split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(12);
    expect(result[0].text.endsWith("legendary")).toBe(true);
  });
});

describe("ModSimController reading-chat detection", () => {
  it("requires stronger overlap before triggering reading-chat rewrites", () => {
    const modSim = new ModSimController();
    expect(modSim.isReadingChat("chat chat chat", ["chat said this already"])).toBe(false);
    expect(modSim.isReadingChat("bro that take is wild", ["bro that take is wild"])).toBe(true);
    expect(modSim.isReadingChat("bro that take is wild", ["😂😂😂"])).toBe(false);
    expect(modSim.isReadingChat("bro that take is wild", ["bro"])).toBe(false);
    expect(
      modSim.isReadingChat(
        "you said same strategy and same angle again today",
        ["same strategy worked", "that angle was fine", "you said this earlier"]
      )
    ).toBe(true);
  });

  it("uses diversified rewrite phrases that avoid old obvious fallback-looking lines", () => {
    const modSim = new ModSimController();
    const rewritten = modSim.rewriteForReadingChat([
      { id: "1", username: "", text: "a", emotes: [], donationCents: null, ttsText: null, createdAt: new Date().toISOString() },
      { id: "2", username: "", text: "b", emotes: [], donationCents: null, ttsText: null, createdAt: new Date().toISOString() }
    ]);
    expect(rewritten[0].text).not.toMatch(/stop quoting us bro|he reading us again|patch notes unchanged|npc dialogue loop|quote simulator maxed/i);
    expect(rewritten[1].text).not.toMatch(/stop quoting us bro|he reading us again|patch notes unchanged|npc dialogue loop|quote simulator maxed/i);
  });
});
