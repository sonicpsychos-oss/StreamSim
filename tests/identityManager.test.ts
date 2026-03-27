import { describe, expect, it } from "vitest";
import { IdentityManager } from "../src/services/identityManager.js";

describe("identity manager", () => {
  it("reuses active-session identities when recurring chance is forced", () => {
    const manager = new IdentityManager({ recurringChancePct: 100, maxMemory: 5 });

    const first = manager.getIdentity();
    const second = manager.getIdentity();

    expect(second).toBe(first);
  });

  it("hydrates usernames for parsed messages", () => {
    const manager = new IdentityManager({ recurringChancePct: 0, maxMemory: 5 });
    const hydrated = manager.assignToMessages([
      { id: "1", username: "", text: "hi", emotes: [], createdAt: new Date().toISOString() },
      { id: "2", username: "", text: "yo", emotes: [], createdAt: new Date().toISOString() }
    ]);

    expect(hydrated).toHaveLength(2);
    expect(hydrated[0].username.length).toBeGreaterThan(0);
    expect(hydrated[1].username.length).toBeGreaterThan(0);
  });
});
