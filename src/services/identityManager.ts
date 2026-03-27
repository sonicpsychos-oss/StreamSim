import { ChatMessage } from "../core/types.js";
import { loadBanlist } from "../security/banlistRegistry.js";

const ADJECTIVES = [
  "Salty", "Sleepy", "Turbo", "Pixel", "Glitch", "Cyber", "Stealth", "Macro", "Laggy", "Sweaty", "Cracked", "Hardcore", "Legendary",
  "Hype", "Sus", "Pog", "Cursed", "Random", "Spicy", "Yeet", "Maximum", "Absolute", "Chill", "Golden", "Radiant", "Gloom", "Mellow",
  "Cozy", "Lunar", "Velvet", "Honest", "Quiet", "Sneaky", "Savage", "Primal", "Ancient", "Hyper", "Neon", "Frozen", "Electric", "Shadow",
  "Iron", "Toxic", "Mega", "Ultra", "Infinite", "Bitter", "Fluffy", "Grumpy", "Wild", "Calm", "Brave", "Fancy", "Clumsy", "Dorky",
  "Funky", "Jolly", "Lucky", "Misty", "Nerdy", "Odd", "Proud", "Shady", "Silly", "Tame", "Vast", "Witty", "Young", "Zesty", "Astral",
  "Blazing", "Cobalt", "Dusty", "Eerie", "Fierce", "Gilded", "Hollow", "Icy", "Jaded", "Keen", "Lucid", "Mystic", "Noble", "Opal",
  "Pale", "Quartz", "Rustic", "Solar", "Tidal", "Urban", "Vivid", "Worn", "Xenon", "Amber", "Bold", "Crisp", "Dire", "Elite", "Faded", "Grand"
] as const;

const NOUNS = [
  "Bot", "Frame", "Ping", "Keybind", "Console", "Controller", "Sprite", "Buff", "Nerf", "Carry", "Clutch", "Goblin", "Gremlin", "Meme",
  "Troll", "Noob", "Whale", "Simp", "Main", "Alt", "Panda", "Sloth", "Wizard", "Tea", "Rain", "Vibe", "Cloud", "Moon", "Fern", "Slime",
  "Ghost", "Rex", "Raptor", "Falcon", "Kraken", "Fox", "Badger", "Viper", "Knight", "Rogue", "Titan", "Wolf", "Scrub", "Pilot", "Captain",
  "Legend", "Myth", "Hero", "Villain", "Scout", "Guard", "Beast", "Bird", "Cat", "Dog", "Dragon", "Fish", "Horse", "Lion", "Mouse",
  "Shark", "Snake", "Tiger", "Zebra", "Bloom", "Blaze", "Bolt", "Core", "Dust", "Edge", "Flame", "Gear", "Heart", "Ink", "Jet", "Kite",
  "Leaf", "Mist", "Night", "Orb", "Pulse", "Quill", "Reef", "Star", "Thorn", "Unit", "Void", "Wave", "Yard", "Zone", "Atom", "Beam",
  "Chip", "Disk", "Echo", "Flux", "Grid", "Halo", "Icon", "Jolt"
] as const;

const RARE_SINGLES = [
  "Vesper", "Zenith", "Kael", "Echo", "Jinx", "Riot", "Flux", "Cipher", "Ghost", "Onyx", "Rogue", "Sola", "Nova", "Raven", "Ash", "Blade",
  "Neon", "Frost", "Grimm", "Rune", "Lynx", "Nyx", "Pax", "Quill", "Rhys", "Sage", "Trix", "Vale", "Wren", "Xane", "Yuri", "Zane", "Aero",
  "Bane", "Crux", "Dash", "Ezra", "Finn", "Glee", "Hawk", "Ion", "Jax", "Kite", "Lux", "Miro", "Nero", "Odin", "Pike", "Quinn", "Reed"
] as const;

const USERNAME_BLACKLIST = ["angrybannedword", "offensive", "slur"] as const;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export class IdentityManager {
  private readonly activeSessionPool: string[] = [];
  private readonly maxMemory: number;
  private readonly recurringChancePct: number;
  private readonly banTerms: string[];

  constructor(options?: { maxMemory?: number; recurringChancePct?: number }) {
    this.maxMemory = options?.maxMemory ?? 15;
    this.recurringChancePct = options?.recurringChancePct ?? 20;
    const banlistTerms = loadBanlist().terms.map((term) => term.toLowerCase());
    this.banTerms = [...new Set([...banlistTerms, ...USERNAME_BLACKLIST])];
  }

  public assignToMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((message) => ({ ...message, username: this.getIdentity() }));
  }

  public getIdentity(): string {
    if (this.activeSessionPool.length > 0 && this.randomChance(this.recurringChancePct)) {
      return pick(this.activeSessionPool);
    }

    let candidate = "";
    for (let i = 0; i < 24; i += 1) {
      candidate = this.createNewIdentity();
      if (this.passesSafetyFilter(candidate)) break;
    }

    if (!candidate || !this.passesSafetyFilter(candidate)) {
      candidate = `viewer${Math.floor(Math.random() * 10000)}`;
    }

    this.activeSessionPool.push(candidate);
    if (this.activeSessionPool.length > this.maxMemory) {
      this.activeSessionPool.shift();
    }

    return candidate;
  }

  private randomChance(percent: number): boolean {
    return Math.random() * 100 < percent;
  }

  private generateNumberSuffix(): string {
    if (this.randomChance(50)) {
      const year = Math.floor(Math.random() * 25) + 80;
      return year >= 100 ? `0${year - 100}` : `${year}`;
    }
    return `${Math.floor(Math.random() * 99) + 1}`;
  }

  private passesSafetyFilter(username: string): boolean {
    const normalized = username.toLowerCase();
    return !this.banTerms.some((term) => normalized.includes(term));
  }

  private createNewIdentity(): string {
    const tierRoll = Math.random() * 100;

    // Tier 3: OG handles (5%)
    if (tierRoll <= 5) {
      return pick(RARE_SINGLES);
    }

    const adj = pick(ADJECTIVES);
    const noun = pick(NOUNS);

    // Tier 2: Established (25%)
    if (tierRoll <= 30) {
      return `${adj}${noun}`;
    }

    // Tier 1: Common (70%)
    const separatorRoll = Math.random() * 100;
    let separator = "";
    if (separatorRoll > 40 && separatorRoll <= 80) separator = "_";
    else if (separatorRoll > 80) separator = ".";

    let base = `${adj}${separator}${noun}`;
    if (this.randomChance(50)) {
      base = base.toLowerCase();
    }

    let suffix = this.generateNumberSuffix();
    if (separator !== "_" && this.randomChance(30)) {
      suffix = `_${suffix}`;
    }

    return `${base}${suffix}`;
  }
}
