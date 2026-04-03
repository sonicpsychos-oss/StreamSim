import { ChatMessage, PromptPayload, SimulationConfig, StreamContext } from "../core/types.js";
import { IdentityManager } from "./identityManager.js";

const DEFAULT_SLANG_TERMS = ["cooked", "ratio", "l", "fr", "ngl", "lowkey"];
const CONTRARIAN_REGISTRY = [
  "nah that ain't it",
  "cap detected instantly",
  "who told you that",
  "chat not buying this",
  "wild take ngl",
  "bro missed hard",
  "this angle is cooked",
  "hard disagree right now",
  "that logic is fried",
  "stop the glaze immediately",
  "you reaching for that one",
  "we not co-signing this",
  "this ain't convincing",
  "hater mode activated",
  "ratio energy detected",
  "this read is off",
  "nah switch the script",
  "not the move chief",
  "that take fell flat",
  "major side-eye on that",
  "press x to doubt",
  "who let bro cook",
  "nah this is delusion",
  "we need a better take"
];

export class ModSimController {
  private readonly transcriptSeenCounter = new Map<string, { count: number; lastSeenAt: number }>();
  private lastNonEmptyTranscript = "";
  private readonly slangRegistry: string[];
  private readonly identityManager: IdentityManager;

  constructor(options?: { slangRegistry?: string[]; identityManager?: IdentityManager }) {
    this.slangRegistry = (options?.slangRegistry ?? DEFAULT_SLANG_TERMS).map((term) => term.toLowerCase());
    this.identityManager = options?.identityManager ?? new IdentityManager();
  }

  public reset(): void {
    this.transcriptSeenCounter.clear();
    this.lastNonEmptyTranscript = "";
  }

  public preFlight(context: StreamContext): StreamContext {
    const decayedContext = this.applyTranscriptDecay(context);
    const bannedTerms = this.computeSaturatedSlang(decayedContext.recentChatHistory);
    return {
      ...decayedContext,
      bannedTerms
    };
  }

  public generatePrompt(payload: PromptPayload): string {
    const transcript = payload.context.transcript.trim();
    const transcriptTail = transcript.slice(-230);
    const streamTopic = String(payload.streamTopic ?? "").trim() || "Just Chatting";
    const fishingState = payload.context.fishingState ?? "OFF";
    const bannedTerms = payload.context.bannedTerms ?? [];
    const chaosDirective = payload.context.vibe === "nuclear_drama" ? "chaos mode on: stir conflict and hot takes" : "chaos mode off";
    const primacyDirective = fishingState === "AGGRESSIVE_SUBVERSION"
      ? "contrarian primacy: roast over glaze"
      : fishingState === "STANDARD_CONTRARIAN"
        ? "skeptical primacy: tease, avoid full validation"
        : payload.persona === "supportive"
          ? "supportive primacy: kind but situational"
          : "neutral primacy: varied reactions";

    const degeneracyEnabled = payload.persona !== "supportive";
    const degeneracyDirective = degeneracyEnabled
      ? "brain-rot syntax enabled: forced lowercase, no end punctuation, short fragments"
      : "brain-rot syntax disabled: keep concise but readable";

    const bannedTermDirective = bannedTerms.length
      ? `BANNED TERM (this tick only): avoid using ${bannedTerms.map((term) => `"${term}"`).join(", ")}.`
      : "No banned slang this tick.";

    return [
      "Daily briefing (dynamic context follows; global handbook rules are appended after this block).",
      `Topic lock: ${streamTopic}.`,
      transcript
        ? `Latest streamer tail: "${transcriptTail}".`
        : "Streamer is currently quiet; continue ongoing topic naturally.",
      `Visual grounding (internal only): ${payload.context.visionTags.length ? payload.context.visionTags.join(", ") : "none"}.`,
      `Vibe=${payload.context.vibe ?? "unknown"}; Intent=${payload.context.intent ?? "none"}; Command=${Boolean(payload.context.isCommand)}.`,
      `Behavioral modes: ${payload.behavioralModes.join(", ")}.`,
      `Fishing state: ${fishingState}.`,
      primacyDirective,
      chaosDirective,
      degeneracyDirective,
      bannedTermDirective
    ].join(" ");
  }


  public enforcePersonaSyntax(messages: ChatMessage[]): ChatMessage[] {
    const bannedPhrases = [/\bthe chat\b/gi, /\bchatters\b/gi, /\bthe audience\b/gi];
    const sanitize = (text: string): string => {
      let next = text.toLowerCase().replace(/[—]/g, " ").replace(/\.{2,}/g, " ");
      bannedPhrases.forEach((pattern) => {
        next = next.replace(pattern, "we");
      });
      next = next.replace(/^\s*we\s+(are|re|r)\s+/i, "you ");
      next = next.replace(/^\s*we\s+/i, "you ");
      next = next.replace(/[!?.,;:)\]]+$/g, "");
      next = next.replace(/\s+/g, " ").trim();
      return next;
    };
    return messages.map((message) => ({ ...message, text: sanitize(message.text) }));
  }

  public process(messages: ChatMessage[], payload: PromptPayload): ChatMessage[] {
    const context = payload.context;
    const deEchoedMessages = this.isReadingChat(context.transcript, context.recentChatHistory)
      ? this.rewriteForReadingChat(messages)
      : this.applyAntiEchoConstraint(messages, context.transcript);
    const nonMirroredMessages = this.stripBannedStarters(deEchoedMessages, context.transcript);
    const starterSafeMessages = nonMirroredMessages.length ? nonMirroredMessages : deEchoedMessages;
    const diverseMessages = this.enforceDiversityRules(starterSafeMessages, payload.behavioralModes, payload.context.recentChatHistory);
    const personaLocked = this.enforcePersonaSyntax(diverseMessages);
    const scrubbedMessages = this.postFlight(personaLocked, { brainRot: payload.persona !== "supportive" });
    const dedupedPostFlight = this.enforceBatchUniqueness(scrubbedMessages);
    return this.identityManager.assignToMessages(dedupedPostFlight);
  }

  public postFlight(messages: ChatMessage[], options?: { brainRot?: boolean }): ChatMessage[] {
    const brainRot = options?.brainRot ?? true;
    return messages.map((message, index) => {
      const capped = this.enforceWordCapSmart(message.text, 12);
      let text = capped.replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
      if (brainRot) {
        const lowerCaseThis = index % 5 !== 0;
        if (lowerCaseThis) text = text.toLowerCase();
      }
      return { ...message, text };
    });
  }

  public applyTranscriptDecay(context: StreamContext): StreamContext {
    const normalized = context.transcript.trim().toLowerCase();
    if (!normalized) {
      return context;
    }

    this.lastNonEmptyTranscript = context.transcript.trim();
    const now = Date.now();
    for (const [key, value] of this.transcriptSeenCounter.entries()) {
      if (now - value.lastSeenAt > 90_000) {
        this.transcriptSeenCounter.delete(key);
      }
    }

    const existing = this.transcriptSeenCounter.get(normalized);
    const seenCount = existing?.count ?? 0;
    this.transcriptSeenCounter.set(normalized, { count: seenCount + 1, lastSeenAt: now });

    if (seenCount >= 3) {
      return { ...context, transcript: "" };
    }
    return context;
  }

  public enforceDiversityRules(messages: ChatMessage[], behavioralModes: string[], recentChatHistory: string[] = []): ChatMessage[] {
    const slangCooldownWords = ["lowkey", "ngl", "bet", "cooked", "fr"];
    const slangAlternatives: Record<string, string[]> = {
      lowkey: ["ngl", "tbh", "honestly"],
      ngl: ["lowkey", "tbh", "fr"],
      bet: ["aight", "say less", "ok then"],
      cooked: ["chalked", "donezo", "gg"],
      fr: ["facts", "real", "deadass"]
    };
    const recentUsage = new Map<string, number>();

    const remapped = messages.map((message, index) => {
      let text = message.text;
      for (const word of slangCooldownWords) {
        const pattern = new RegExp(`\\b${word}\\b`, "i");
        if (!pattern.test(text)) continue;
        const lastIndex = recentUsage.get(word);
        if (lastIndex !== undefined && index - lastIndex <= 10) {
          const alternatives = slangAlternatives[word];
          text = text.replace(pattern, alternatives[(index + word.length) % alternatives.length]);
        } else {
          recentUsage.set(word, index);
        }
      }
      return { ...message, text };
    });

    const starterAlternatives: Record<string, string[]> = {
      lowkey: ["tbh", "idk", "fr"],
      ngl: ["lowkey", "idk", "tbh"]
    };
    const starterSeen = new Set<string>();
    const withStarterDiversity = remapped.map((message, index) => {
      const words = message.text.trim().split(/\s+/);
      const starter = (words[0] ?? "").toLowerCase();
      if (starterAlternatives[starter] && starterSeen.has(starter)) {
        const alternatives = starterAlternatives[starter];
        words[0] = alternatives[index % alternatives.length];
        return { ...message, text: words.join(" ").trim() };
      }
      if (starter) starterSeen.add(starter);
      return message;
    });

    if (withStarterDiversity.length < 2) return withStarterDiversity;

    if (behavioralModes.includes("thirst")) {
      withStarterDiversity[0] = { ...withStarterDiversity[0], text: "gyatt respectfully 😳" };
      withStarterDiversity[1] = { ...withStarterDiversity[1], text: "simps in chat stand up" };
      return withStarterDiversity;
    }

    const supportiveSignal = /\b(yes|yup|we hear u|w audio|mic w|facts|same|true|good)\b/i;
    if (supportiveSignal.test(withStarterDiversity[0].text) && supportiveSignal.test(withStarterDiversity[1].text)) {
      const contrastReplies = ["nah chat trolling today", "bro that take is wild", "off topic but who ate my snacks", "skill issue detected 🤨"];
      withStarterDiversity[1] = { ...withStarterDiversity[1], text: contrastReplies[Math.floor(Math.random() * contrastReplies.length)] };
    }

    const deduped = withStarterDiversity.map((message) => ({ ...message }));
    const seen = new Set<string>();
    const fallbackReplies = [
      "new angle pls",
      "different take",
      "say it another way",
      "run a fresh line",
      "switch cadence",
      "not this again",
      "change the wording",
      "new flavor pls",
      "mix it up chat",
      "ok pivot now",
      "same beat again",
      "throw a curveball"
    ];
    deduped.forEach((message, index) => {
      const key = this.normalizedDiversityKey(message.text);
      if (!key) return;
      if (seen.has(key)) {
        message.text = fallbackReplies[(index + Math.floor(Math.random() * fallbackReplies.length)) % fallbackReplies.length];
        return;
      }
      seen.add(key);
    });

    const recentlyUsedIdlePhrases = [
      "morning vibes",
      "keep it chill",
      "keep it light",
      "waiting room energy",
      "just lurking"
    ];
    const historyJoined = recentChatHistory.join(" ").toLowerCase();
    deduped.forEach((message, index) => {
      const normalized = message.text.toLowerCase().replace(/\s+/g, " ").trim();
      if (recentlyUsedIdlePhrases.some((phrase) => normalized.includes(phrase) && historyJoined.includes(phrase))) {
        const replacements = ["queue check?", "next map?", "scoreboard soon?", "clip that setup", "hydration break?"];
        message.text = replacements[index % replacements.length];
      }
    });

    const maxWords = 4;
    const minimumShortRatio = 0.8;
    const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
    const requiredShort = Math.ceil(deduped.length * minimumShortRatio);
    let shortCount = deduped.filter((message) => countWords(message.text) <= maxWords).length;
    if (shortCount < requiredShort) {
      const longIndices = deduped
        .map((message, index) => ({ index, words: countWords(message.text) }))
        .filter((entry) => entry.words > maxWords)
        .sort((a, b) => b.words - a.words);
      for (const entry of longIndices) {
        if (shortCount >= requiredShort) break;
        deduped[entry.index].text = this.enforceWordCapSmart(deduped[entry.index].text, maxWords);
        shortCount += 1;
      }
    }

    return deduped;
  }

  public applyAntiEchoConstraint(messages: ChatMessage[], transcript: string): ChatMessage[] {
    const anchors = this.transcriptAnchorTerms(transcript);
    if (!anchors.length) return messages;
    const transcriptHasQuestion = transcript.includes("?");

    const filtered = messages.filter((message) => {
      const lowered = message.text.toLowerCase();
      if (transcriptHasQuestion && this.looksLikeDirectAnswer(lowered)) {
        return true;
      }
      const overlapCount = anchors.filter((token) => lowered.includes(token)).length;
      if (overlapCount <= 1) return true;
      if (anchors.length >= 5 && overlapCount <= 2) return true;
      return false;
    });

    if (filtered.length > 0) return filtered;

    const seed = messages[0];
    return [
      {
        ...seed,
        id: seed?.id ?? `${Date.now()}-anti-echo`,
        createdAt: seed?.createdAt ?? new Date().toISOString(),
        text: CONTRARIAN_REGISTRY[Math.floor(Math.random() * CONTRARIAN_REGISTRY.length)],
        emotes: seed?.emotes ?? []
      }
    ];
  }

  public isReadingChat(transcript: string, recentChatHistory: string[]): boolean {
    if (!transcript.trim() || recentChatHistory.length === 0) return false;
    const normalizedTranscript = transcript
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const transcriptWords = normalizedTranscript.split(" ").filter(Boolean);
    if (transcriptWords.length >= 3 && transcriptWords.length <= 6) {
      const exactQuoted = recentChatHistory.some((line) => {
        const normalizedLine = line
          .toLowerCase()
          .replace(/[^a-z0-9\s']/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return normalizedLine.includes(normalizedTranscript) || normalizedTranscript.includes(normalizedLine);
      });
      if (exactQuoted) return true;
    }
    const transcriptTokens = this.tokenizeForOverlap(transcript);
    const historyTokens = this.tokenizeForOverlap(recentChatHistory.join(" "));
    if (!transcriptTokens.size || !historyTokens.size) return false;
    const overlap = Array.from(transcriptTokens).filter((token) => historyTokens.has(token)).length;
    if (transcriptTokens.size < 5) return false;
    if (overlap < 2) return false;
    return overlap / transcriptTokens.size >= 0.6;
  }

  public rewriteForReadingChat(messages: ChatMessage[]): ChatMessage[] {
    const laughAlong = [
      "LMAOOO true tho",
      "nah thats facts 😭",
      "exactlyyyy",
      "im crying bro 😂",
      "you got him ngl",
      "thats what i said fr",
      "chat catching strays 💀",
      "nah you cooked him",
      "yep thats the one",
      "he asked for that",
      "W read",
      "frfr he walked into that"
    ];
    const agreeAndPileOn = [
      "deadass i agree",
      "same i peeped that",
      "you right on that",
      "facts no printer",
      "nah chat saw it too",
      "we all thinking it",
      "thats exactly it",
      "co-sign",
      "real talk",
      "big facts",
      "not wrong at all",
      "valid take"
    ];
    const gentlePushback = [
      "aight now move on 😂",
      "ok ok next topic",
      "you made your point",
      "we heard it gang",
      "run the next thing",
      "dont loop it too long",
      "say less keep rolling",
      "next question maybe"
    ];
    const emojiCaps = ["💀", "😭", "😂", "🫡", "🤨", "👀", "🔥", "😮‍💨"];

    const reactions = [...laughAlong, ...agreeAndPileOn, ...gentlePushback];
    const pool = reactions
      .map((text) => {
        const withEmoji = Math.random() < 0.35 ? `${text} ${emojiCaps[Math.floor(Math.random() * emojiCaps.length)]}` : text;
        return { text: withEmoji, rank: Math.random() };
      })
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.text);
    return messages.map((message, index) => ({ ...message, text: pool[index % pool.length] }));
  }

  private stripBannedStarters(messages: ChatMessage[], transcript: string): ChatMessage[] {
    const transcriptWords = transcript
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
    if (transcriptWords.length < 2) return messages;
    const bannedStarter = transcriptWords.slice(-2).join(" ");
    return messages.filter((message) => {
      const normalized = message.text
        .toLowerCase()
        .replace(/[^a-z0-9\s']/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return !normalized.startsWith(bannedStarter);
    });
  }


  private enforceWordCapSmart(text: string, maxWords: number): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return normalized;

    const fillerWords = new Set(["really", "literally", "basically", "actually", "kinda", "sorta", "just", "very", "maybe"]);
    let compacted = words.filter((word) => !fillerWords.has(word.toLowerCase()));

    if (compacted.length > maxWords) {
      const glueWords = new Set(["the", "a", "an", "to", "for", "of", "and", "that", "this", "it", "is", "are"]);
      compacted = compacted.filter((word, idx) => idx === 0 || idx === compacted.length - 1 || !glueWords.has(word.toLowerCase()));
    }

    if (compacted.length > maxWords) {
      return [...compacted.slice(0, maxWords - 1), compacted[compacted.length - 1]].join(" ");
    }

    return compacted.join(" ");
  }

  private computeSaturatedSlang(recentChatHistory: string[]): string[] {
    const joined = recentChatHistory.join(" ").toLowerCase();
    const saturated: string[] = [];
    for (const term of this.slangRegistry) {
      const matches = joined.match(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"));
      if ((matches?.length ?? 0) >= 3) {
        saturated.push(term);
      }
    }
    return saturated;
  }

  private transcriptAnchorTerms(transcript: string): string[] {
    return Array.from(
      new Set(
        transcript
          .toLowerCase()
          .replace(/[^a-z0-9\s'-]/g, " ")
          .split(/\s+/)
          .map((token) => token.replace(/^'+|'+$/g, "").trim())
          .filter((token) => token.length >= 5)
      )
    ).slice(0, 16);
  }

  private tokenizeForOverlap(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s']/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4)
    );
  }

  private normalizedDiversityKey(text: string): string {
    return text
      .toLowerCase()
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/[^a-z0-9\s']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private looksLikeDirectAnswer(text: string): boolean {
    return /\b(yes|yep|no|nah|idk|cant|can't|cannot|wait)\b/.test(text) || /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/.test(text);
  }

  private enforceBatchUniqueness(messages: ChatMessage[]): ChatMessage[] {
    const seen = new Set<string>();
    const replacements = ["new angle bro", "different read", "switching lanes", "not the same line", "fresh take only"];
    return messages.map((message, index) => {
      const key = this.normalizedDiversityKey(message.text);
      if (!key) return message;
      if (!seen.has(key)) {
        seen.add(key);
        return message;
      }
      return { ...message, text: replacements[index % replacements.length] };
    });
  }
}
