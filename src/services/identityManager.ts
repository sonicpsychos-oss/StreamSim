import { ChatMessage } from "../core/types.js";
import { loadBanlist } from "../security/banlistRegistry.js";

const ADJECTIVES = [
  "salty", "sleepy", "turbo", "pixel", "glitch", "cyber", "stealth", "macro", "laggy", "sweaty", "cracked", "hardcore", "legendary",
  "hype", "sus", "pog", "cursed", "random", "spicy", "yeet", "maximum", "absolute", "chill", "golden", "radiant", "gloom", "mellow",
  "cozy", "lunar", "velvet", "honest", "quiet", "sneaky", "savage", "primal", "ancient", "hyper", "neon", "frozen", "electric", "shadow",
  "iron", "toxic", "mega", "ultra", "infinite", "bitter", "fluffy", "grumpy", "wild", "calm", "brave", "fancy", "clumsy", "dorky",
  "funky", "jolly", "lucky", "misty", "nerdy", "odd", "proud", "shady", "silly", "tame", "vast", "witty", "young", "zesty", "astral",
  "blazing", "cobalt", "dusty", "eerie", "fierce", "gilded", "hollow", "icy", "jaded", "keen", "lucid", "mystic", "noble", "opal",
  "pale", "quartz", "rustic", "solar", "tidal", "urban", "vivid", "worn", "xenon", "amber", "bold", "crisp", "dire", "elite", "faded", "grand"
] as const;

const NOUNS = [
  "bot", "frame", "ping", "keybind", "console", "controller", "sprite", "buff", "nerf", "carry", "clutch", "goblin", "gremlin", "meme",
  "troll", "noob", "whale", "simp", "main", "alt", "panda", "sloth", "wizard", "tea", "rain", "vibe", "cloud", "moon", "fern", "slime",
  "ghost", "rex", "raptor", "falcon", "kraken", "fox", "badger", "viper", "knight", "rogue", "titan", "wolf", "scrub", "pilot", "captain",
  "legend", "myth", "hero", "villain", "scout", "guard", "beast", "bird", "cat", "dog", "dragon", "fish", "horse", "lion", "mouse",
  "shark", "snake", "tiger", "zebra", "bloom", "blaze", "bolt", "core", "dust", "edge", "flame", "gear", "heart", "ink", "jet", "kite",
  "leaf", "mist", "night", "orb", "pulse", "quill", "reef", "star", "thorn", "unit", "void", "wave", "yard", "zone", "atom", "beam",
  "chip", "disk", "echo", "flux", "grid", "halo", "icon", "jolt"
] as const;

const RARE_SINGLES = [
  "vesper", "zenith", "kael", "echo", "jinx", "riot", "flux", "cipher", "ghost", "onyx", "rogue", "sola", "nova", "raven", "ash", "blade",
  "neon", "frost", "grimm", "rune", "lynx", "nyx", "pax", "quill", "rhys", "sage", "trix", "vale", "wren", "xane", "yuri", "zane", "aero",
  "bane", "crux", "dash", "ezra", "finn", "glee", "hawk", "ion", "jax", "kite", "lux", "miro", "nero", "odin", "pike", "quinn", "reed"
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

  private legacyTokenCase(token: string): string {
    const styleRoll = Math.random() * 100;
    if (styleRoll <= 30) return token;
    if (styleRoll <= 55) return token.charAt(0).toUpperCase() + token.slice(1);
    if (styleRoll <= 72) return token.toUpperCase();
    if (styleRoll <= 88) return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();

    const letters = token.split("");
    for (let i = 0; i < letters.length; i += 1) {
      if (/[a-z]/i.test(letters[i]) && this.randomChance(45)) {
        letters[i] = this.randomChance(50) ? letters[i].toUpperCase() : letters[i].toLowerCase();
      }
    }
    return letters.join("");
  }

  private generateLegacyIdentity(adj: string, noun: string): string {
    const separatorRoll = Math.random() * 100;
    let separator = "";
    if (separatorRoll > 35 && separatorRoll <= 65) separator = "_";
    else if (separatorRoll > 65 && separatorRoll <= 80) separator = ".";

    let core = `${this.legacyTokenCase(adj)}${separator}${this.legacyTokenCase(noun)}`;
    if (this.randomChance(25)) core = `${core}${this.randomChance(50) ? "X" : "x"}`;

    const numberSuffixRoll = Math.random() * 100;
    if (numberSuffixRoll <= 35) core = `${core}${this.generateNumberSuffix()}`;
    else if (numberSuffixRoll <= 55) core = `${core}${Math.floor(Math.random() * 900) + 100}`;

    if (this.randomChance(20)) core = `${this.randomChance(50) ? "xX" : "Xx"}${core}`;
    if (this.randomChance(15)) core = `${core}${this.randomChance(50) ? "Xx" : "xX"}`;

    return core;
  }

  private passesSafetyFilter(username: string): boolean {
    const normalized = username.toLowerCase();
    return !this.banTerms.some((term) => normalized.includes(term));
  }

  private createNewIdentity(): string {
    const tierRoll = Math.random() * 100;

    const adj = pick(ADJECTIVES);
    const noun = pick(NOUNS);

    // Legacy throwback names with caps + numbers (~4%)
    if (tierRoll <= 4) {
      return this.generateLegacyIdentity(adj, noun);
    }

    // Tier 3: modern single-word handles (35%)
    if (tierRoll <= 40) {
      const single = pick(RARE_SINGLES);
      return this.randomChance(35) ? `${single}${Math.floor(Math.random() * 90) + 10}` : single;
    }

    // Tier 2: mostly clean compounds (35%)
    if (tierRoll <= 75) {
      return `${adj}${noun}`;
    }

    // Tier 1: legacy separator/suffix handles (25%)
    const separatorRoll = Math.random() * 100;
    let separator = "";
    if (separatorRoll > 40 && separatorRoll <= 80) separator = "_";
    else if (separatorRoll > 80) separator = ".";

    const base = `${adj}${separator}${noun}`;

    let suffix = this.generateNumberSuffix();
    if (separator !== "_" && this.randomChance(30)) {
      suffix = `_${suffix}`;
    }

    return `${base}${suffix}`;
  }
}
