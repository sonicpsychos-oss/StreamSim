import { ChatMessage } from "../core/types.js";

export type MalformedOutputClass = "empty" | "no_json_object" | "json_syntax" | "missing_messages" | "invalid_message_schema";
export type RecoveryAction = "repair" | "regenerate" | "drop";
const MAX_INFERENCE_OUTPUT_CHARS = 250_000;

function coerceMessage(raw: unknown): ChatMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.text !== "string") return null;
  if (!Array.isArray(candidate.emotes) || !candidate.emotes.every((item) => typeof item === "string")) return null;

  return {
    id: typeof candidate.id === "string" ? candidate.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    username: typeof candidate.username === "string" ? candidate.username : "",
    text: candidate.text,
    emotes: candidate.emotes,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
    donationCents: typeof candidate.donationCents === "number" ? candidate.donationCents : undefined,
    ttsText: typeof candidate.ttsText === "string" ? candidate.ttsText : undefined,
    source:
      candidate.source === "real-inference" ||
      candidate.source === "mock-inference" ||
      candidate.source === "mock-audience" ||
      candidate.source === "fallback-mock" ||
      candidate.source === "unknown"
        ? candidate.source
        : undefined
  };
}

export function repairInferenceOutput(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, "").replace(/^###json\s*/i, "").replace(/\s*```$/i, "").replace(/\s*###$/i, "");
}

function sanitizeRawOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.length > MAX_INFERENCE_OUTPUT_CHARS ? trimmed.slice(0, MAX_INFERENCE_OUTPUT_CHARS) : trimmed;
}

function extractLikelyJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1);
  }
  return raw;
}

export function classifyMalformedOutput(raw: string): MalformedOutputClass {
  const trimmed = sanitizeRawOutput(raw);
  if (!trimmed) return "empty";

  const repaired = repairInferenceOutput(trimmed);
  const likely = extractLikelyJsonObject(repaired);
  if (likely === repaired && !repaired.includes("{")) {
    return "no_json_object";
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(likely) as Record<string, unknown>;
  } catch {
    return "json_syntax";
  }

  if (!Array.isArray(data.messages)) return "missing_messages";

  const parsed = data.messages.map(coerceMessage).filter((message): message is ChatMessage => Boolean(message));
  if (!parsed.length) return "invalid_message_schema";

  return "json_syntax";
}

function parsePayload(raw: string): Record<string, unknown> {
  const repaired = repairInferenceOutput(sanitizeRawOutput(raw));
  try {
    return JSON.parse(repaired) as Record<string, unknown>;
  } catch {
    return JSON.parse(extractLikelyJsonObject(repaired)) as Record<string, unknown>;
  }
}

export function recommendedRecoveryAction(kind: MalformedOutputClass): RecoveryAction {
  switch (kind) {
    case "empty":
    case "no_json_object":
      return "regenerate";
    case "json_syntax":
      return "repair";
    case "missing_messages":
    case "invalid_message_schema":
      return "drop";
    default:
      return "drop";
  }
}

export function parseInferenceOutput(raw: string): ChatMessage[] {
  const data = parsePayload(raw);
  if (!Array.isArray(data.messages)) throw new Error("Invalid output: messages array missing");

  const parsed = data.messages.map(coerceMessage).filter((message): message is ChatMessage => Boolean(message));
  if (!parsed.length) throw new Error("No valid messages in output");

  return parsed;
}
