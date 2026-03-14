import { ChatMessage } from "./types.js";
import { loadBanlist } from "../security/banlistRegistry.js";

function safePatterns(): RegExp[] {
  const banlist = loadBanlist();
  if (!banlist.terms.length) throw new Error("banlist terms unavailable");
  return banlist.terms.map((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i"));
}

export function passesSafetyFilter(message: ChatMessage): boolean {
  return !safePatterns().some((pattern) => pattern.test(message.text));
}

export function applySafetyFilter(messages: ChatMessage[]): ChatMessage[] {
  try {
    return messages.filter(passesSafetyFilter);
  } catch {
    return messages.filter((message) => message.username.toLowerCase() === "system" || message.emotes.length > 0);
  }
}
