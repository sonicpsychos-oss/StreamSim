import { ChatMessage } from "../core/types.js";

function coerceMessage(raw: unknown): ChatMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.username !== "string") return null;
  if (typeof candidate.text !== "string") return null;
  if (!Array.isArray(candidate.emotes) || !candidate.emotes.every((item) => typeof item === "string")) return null;

  return {
    id: typeof candidate.id === "string" ? candidate.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    username: candidate.username,
    text: candidate.text,
    emotes: candidate.emotes,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
    donationCents: typeof candidate.donationCents === "number" ? candidate.donationCents : undefined,
    ttsText: typeof candidate.ttsText === "string" ? candidate.ttsText : undefined
  };
}

export function repairInferenceOutput(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, "").replace(/^###json\s*/i, "").replace(/\s*```$/i, "").replace(/\s*###$/i, "");
}

export function parseInferenceOutput(raw: string): ChatMessage[] {
  const repaired = repairInferenceOutput(raw);
  const data = JSON.parse(repaired) as Record<string, unknown>;
  if (!Array.isArray(data.messages)) throw new Error("Invalid output: messages array missing");

  const parsed = data.messages.map(coerceMessage).filter((message): message is ChatMessage => Boolean(message));
  if (!parsed.length) throw new Error("No valid messages in output");

  return parsed;
}
