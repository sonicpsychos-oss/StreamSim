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
