import { ChatMessage, QueueMessage, SimulationConfig } from "./types.js";
import { loadBanlist } from "../security/banlistRegistry.js";

interface SafetyScanResult {
  message: ChatMessage;
  droppedTerms: string[];
}

function escapePatternTerm(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function getTerms(): string[] {
  const banlist = loadBanlist();
  if (!banlist.terms.length) throw new Error("banlist terms unavailable");
  return banlist.terms;
}

function normalizeWordBoundary(term: string): RegExp {
  return new RegExp(`\\b${escapePatternTerm(term)}\\b`, "i");
}

function redactMessageText(text: string, terms: string[]): string {
  return terms.reduce((acc, term) => acc.replace(new RegExp(escapePatternTerm(term), "gi"), "[redacted]"), text);
}

function scanMessage(message: ChatMessage, terms: string[]): SafetyScanResult {
  const droppedTerms = terms.filter((term) => normalizeWordBoundary(term).test(message.text));
  return { message, droppedTerms };
}

function toQueueMessage(message: ChatMessage, config: SimulationConfig, safetyAction: "pass" | "drop" | "censor", droppedTerms: string[]): QueueMessage {
  return {
    id: message.id,
    queueVersion: "v1",
    createdAt: message.createdAt,
    channel: message.donationCents ? "donation" : message.username.toLowerCase() === "system" ? "system" : "chat",
    author: {
      handle: message.username,
      persona: config.persona,
      bias: config.bias === "split" ? "neutral" : config.bias
    },
    payload: {
      text: message.text,
      emotes: message.emotes,
      donationCents: message.donationCents,
      ttsText: message.ttsText
    },
    moderation: {
      safetyAction,
      droppedTerms
    },
    render: {
      priority: message.donationCents ? 2 : 1,
      ttlMs: 15000
    }
  };
}

export function applySafetyPolicy(messages: ChatMessage[], config: SimulationConfig): { safeMessages: ChatMessage[]; queueMessages: QueueMessage[]; droppedCount: number } {
  try {
    const terms = getTerms();
    const scans = messages.map((message) => scanMessage(message, terms));
    const safeMessages: ChatMessage[] = [];
    const queueMessages: QueueMessage[] = [];
    let droppedCount = 0;

    scans.forEach(({ message, droppedTerms }) => {
      if (!droppedTerms.length) {
        safeMessages.push(message);
        queueMessages.push(toQueueMessage(message, config, "pass", []));
        return;
      }

      if (config.safety.dropPolicy === "censor") {
        const censored: ChatMessage = { ...message, text: redactMessageText(message.text, droppedTerms) };
        safeMessages.push(censored);
        queueMessages.push(toQueueMessage(censored, config, "censor", droppedTerms));
        return;
      }

      droppedCount += 1;
      queueMessages.push(toQueueMessage(message, config, "drop", droppedTerms));
    });

    return { safeMessages, queueMessages, droppedCount };
  } catch {
    const fallback = messages.filter((message) => message.username.toLowerCase() === "system" || message.emotes.length > 0);
    return {
      safeMessages: fallback,
      queueMessages: fallback.map((message) => ({
        ...toQueueMessage(message, config, "pass", []),
        moderation: { safetyAction: "pass", droppedTerms: [] }
      })),
      droppedCount: Math.max(0, messages.length - fallback.length)
    };
  }
}
