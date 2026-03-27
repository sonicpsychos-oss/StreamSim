import { ChatMessage } from "../core/types.js";

const ADJECTIVES = [
  "Salty",
  "Epic",
  "Sneaky",
  "Chill",
  "Turbo",
  "Cracked",
  "Lucky",
  "Spicy",
  "Fuzzy",
  "Nova",
  "Hyper",
  "Mellow",
  "Savage",
  "Shadow",
  "Swift",
  "Cosmic",
  "Jolly",
  "Rogue",
  "Zesty",
  "Pixel"
];

const NOUNS = [
  "Wizard",
  "Gamer",
  "Cat",
  "Otter",
  "Ninja",
  "Panda",
  "Falcon",
  "Ghost",
  "Raptor",
  "Viper",
  "Knight",
  "Mage",
  "Fox",
  "Wolf",
  "Dragon",
  "Dolphin",
  "Titan",
  "Bandit",
  "Ranger",
  "Sparrow"
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class IdentityManager {
  private readonly activeChatters: string[] = [];
  private readonly recentMessageHandles: string[] = [];

  constructor(
    private readonly maxActiveChatters = 8,
    private readonly recentWindowSize = 10,
    private readonly reuseWeight = 0.72
  ) {}

  public assignToMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((message) => ({ ...message, username: this.nextIdentity() }));
  }

  public nextIdentity(): string {
    const reuse = this.activeChatters.length > 0 && Math.random() < this.reuseWeight;
    const username = reuse ? pick(this.activeChatters) : this.createAndTrackIdentity();
    this.trackRecentHandle(username);
    return username;
  }

  private createAndTrackIdentity(): string {
    let candidate = this.composeIdentity();
    let attempts = 0;
    while (this.activeChatters.includes(candidate) && attempts < 8) {
      candidate = this.composeIdentity();
      attempts += 1;
    }

    this.activeChatters.push(candidate);
    if (this.activeChatters.length > this.maxActiveChatters) {
      this.activeChatters.shift();
    }

    return candidate;
  }

  private composeIdentity(): string {
    const base = `${pick(ADJECTIVES)}${pick(NOUNS)}`;
    if (Math.random() < 0.55) {
      const number = Math.floor(Math.random() * 1000);
      const separator = Math.random() < 0.28 ? "_" : "";
      return `${base}${separator}${number}`;
    }
    return base;
  }

  private trackRecentHandle(username: string): void {
    this.recentMessageHandles.push(username);
    if (this.recentMessageHandles.length > this.recentWindowSize) {
      this.recentMessageHandles.shift();
    }
  }
}
