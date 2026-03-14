import { ChatMessage } from "./types.js";

const bannedPatterns = [
  /\bslur1\b/i,
  /\bslur2\b/i,
  /\bkill\s+yourself\b/i,
  /\bself\s*harm\b/i
];

export function passesSafetyFilter(message: ChatMessage): boolean {
  return !bannedPatterns.some((pattern) => pattern.test(message.text));
}

export function applySafetyFilter(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(passesSafetyFilter);
}
