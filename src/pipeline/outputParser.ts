import { ChatMessage } from "../core/types.js";

export type MalformedOutputClass = "empty" | "no_json_object" | "json_syntax" | "missing_messages" | "invalid_message_schema";
export type RecoveryAction = "repair" | "regenerate" | "drop";
const MAX_INFERENCE_OUTPUT_CHARS = 250_000;
const ALLOWED_TEXT_EMOTES = new Set(["Kappa", "LUL", "PogChamp", "OMEGALUL", "monkaS", "W", "L"]);
const UNICODE_EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const RADIO_CHECK_BANNED_PHRASE = /\bloud and clear\b/gi;
const REPETITION_BANNED_PHRASES = [/\bpick a lane\b/gi, /\bpick a topic\b/gi];
const GHOSTING_BANNED_PHRASES = [/\byou (vanished|disappeared)\b/gi, /\bghosted\b/gi];

function normalizeChatTextStyle(text: string): string {
  let normalized = text.toLowerCase();
  normalized = normalized.replace(/[—]/g, " ");
  normalized = normalized.replace(/\.{3,}/g, " ");
  normalized = normalized.replace(RADIO_CHECK_BANNED_PHRASE, "we hear u");
  for (const pattern of REPETITION_BANNED_PHRASES) {
    normalized = normalized.replace(pattern, "switch it up");
  }
  for (const pattern of GHOSTING_BANNED_PHRASES) {
    normalized = normalized.replace(pattern, "still here");
  }
  normalized = normalized.replace(/\s+/g, " ").trim();
  normalized = normalized.replace(/\.$/, "");
  return normalized;
}

function isAllowedEmote(value: string): boolean {
  const trimmed = value.trim();
  return ALLOWED_TEXT_EMOTES.has(trimmed) || UNICODE_EMOJI_PATTERN.test(trimmed);
}

function normalizeTtsText(candidate: Record<string, unknown>, donationCents: number | null): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(candidate, "ttsText")) return undefined;
  if (candidate.ttsText === null) return undefined;
  if (typeof candidate.ttsText !== "string") return undefined;
  const trimmed = candidate.ttsText.trim();
  if (!trimmed) return undefined;
  return donationCents && donationCents > 0 ? trimmed : undefined;
}

function coerceMessage(raw: unknown): ChatMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.text !== "string") return null;
  if (!Array.isArray(candidate.emotes) || !candidate.emotes.every((item) => typeof item === "string")) return null;
  if (
    Object.prototype.hasOwnProperty.call(candidate, "donationCents") &&
    !(candidate.donationCents === null || typeof candidate.donationCents === "number")
  ) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(candidate, "ttsText") && !(candidate.ttsText === null || typeof candidate.ttsText === "string")) return null;

  const donationCents = typeof candidate.donationCents === "number" && candidate.donationCents > 0 ? Math.floor(candidate.donationCents) : null;
  const emotes = candidate.emotes.map((emote) => emote.trim()).filter((emote) => isAllowedEmote(emote));

  const text = normalizeChatTextStyle(candidate.text);
  if (!text && emotes.length === 0) return null;

  return {
    id: typeof candidate.id === "string" ? candidate.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    username: typeof candidate.username === "string" ? candidate.username : "",
    text,
    emotes,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
    donationCents: donationCents ?? undefined,
    ttsText: normalizeTtsText(candidate, donationCents),
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
  if (parsed.length < 2) return "invalid_message_schema";

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
  if (parsed.length < 2) throw new Error("Expected at least 2 valid messages in output");

  return parsed;
}
