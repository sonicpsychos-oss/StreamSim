import { InferenceMode, InferenceProvider, PromptPayload, RetryProgressHook, SimulationConfig } from "../core/types.js";
import { SecretStore } from "../security/secretStore.js";
import { MockInferenceProvider } from "./mockInferenceProvider.js";

const LOCAL_MODES: InferenceMode[] = ["ollama", "lmstudio", "mock-local"];
const CLOUD_MODES: InferenceMode[] = ["openai", "groq", "mock-cloud"];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(attempts: number, fn: () => Promise<T>, onRetryProgress?: RetryProgressHook): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw error;
      }
      lastError = error;
      if (i < attempts) {
        onRetryProgress?.(i + 1, (error as Error).message);
        await wait(250 * 2 ** i);
      }
    }
  }
  throw lastError;
}

function composeAbortSignal(timeoutMs: number, externalSignal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("request timeout", "AbortError")), timeoutMs);
  const abortFromExternal = () => controller.abort(new DOMException("aborted by orchestrator", "AbortError"));
  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternal();
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }
  controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  return controller.signal;
}

function effectiveRetryCount(maxRetries: number, requestTimeoutMs: number): number {
  if (requestTimeoutMs >= 30000) return 0;
  if (requestTimeoutMs >= 15000) return Math.min(maxRetries, 1);
  return maxRetries;
}

async function parseProviderError(response: Response): Promise<string> {
  const retryAfter = response.headers.get("retry-after");
  const remaining = response.headers.get("x-ratelimit-remaining-requests") ?? response.headers.get("x-ratelimit-remaining");

  let detail = "";
  try {
    const data = (await response.json()) as { error?: { message?: string; type?: string }; message?: string };
    detail = data.error?.message ?? data.message ?? "";
  } catch {
    detail = "";
  }

  const extras = [
    retryAfter ? `retry_after=${retryAfter}` : "",
    remaining ? `remaining=${remaining}` : ""
  ]
    .filter(Boolean)
    .join(", ");

  return [detail, extras].filter(Boolean).join(" | ");
}

type ProviderResponseShape = {
  response?: string;
  text?: string;
  output_text?: string;
  content?: Array<{ type?: string; text?: string | { value?: string } }>;
  choices?: Array<{
    text?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string | { value?: string } }>;
    };
  }>;
};

const ALLOWED_TEXT_EMOTES = ["Kappa", "LUL", "PogChamp", "OMEGALUL", "monkaS", "W", "L"] as const;

function openAiResponseSchema(requestedMessageCount: number) {
  return {
    type: "json_schema",
    json_schema: {
      name: "streamsim_chat_batch",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          messages: {
            type: "array",
            minItems: requestedMessageCount,
            maxItems: requestedMessageCount,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                emotes: {
                  type: "array",
                  items: { type: "string" }
                },
                donationCents: {
                  anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }]
                },
                ttsText: {
                  anyOf: [{ type: "string" }, { type: "null" }]
                }
              },
              required: ["text", "emotes"]
            }
          }
        },
        required: ["messages"]
      }
    }
  } as const;
}

function extractTextFromContentParts(
  parts: Array<{ type?: string; text?: string | { value?: string } }> | undefined
): string | null {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const joined = parts
    .map((part) => {
      if (typeof part?.text === "string") return part.text;
      if (part?.text && typeof part.text === "object" && typeof part.text.value === "string") return part.text.value;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return joined.length ? joined : null;
}

function extractProviderText(data: ProviderResponseShape): string {
  const chatMessageContent = data.choices?.[0]?.message?.content;
  if (typeof chatMessageContent === "string" && chatMessageContent.trim()) return chatMessageContent;
  if (Array.isArray(chatMessageContent)) {
    const fromParts = extractTextFromContentParts(chatMessageContent);
    if (fromParts) return fromParts;
  }

  const choiceText = data.choices?.[0]?.text;
  if (typeof choiceText === "string" && choiceText.trim()) return choiceText;

  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  if (typeof data.response === "string" && data.response.trim()) return data.response;
  if (typeof data.text === "string" && data.text.trim()) return data.text;

  const topLevelContent = extractTextFromContentParts(data.content);
  if (topLevelContent) return topLevelContent;

  return "";
}

function extractProviderTextOrThrow(data: ProviderResponseShape, providerLabel: string): string {
  const extracted = extractProviderText(data).trim();
  if (extracted) return extracted;

  const availableKeys = Object.keys(data ?? {}).join(", ") || "none";
  // eslint-disable-next-line no-console
  console.warn(`[HybridInferenceProvider] Empty text payload from ${providerLabel}. Keys present: ${availableKeys}`);
  throw new Error(`Provider returned empty content (${providerLabel})`);
}

export function systemPromptForPayload(payload: PromptPayload): string {
  const transcript = payload.context.transcript.trim();
  const rawTranscriptTail = transcript.slice(-230);
  const transcriptTail = rawTranscriptTail.includes(" ")
    ? rawTranscriptTail.slice(rawTranscriptTail.indexOf(" ") + 1)
    : rawTranscriptTail;
  const streamTopic = String(payload.streamTopic ?? "").trim() || "Just Chatting";
  const transcriptDirective = transcript
    ? `Highest priority: react directly to the streamer's words: "${transcriptTail}". Prioritize the most recent ~10 seconds (the tail end of context.transcript) as the primary signal, and use earlier transcript lines only as background context.`
    : "The streamer is currently silent (waiting for chat, focused, or taking a breath). This is a lull, not a reset. DO NOT change the subject. Continue the vibe of the previous conversation. If the streamer just asked a question, KEEP ANSWERING IT. If nothing was recently asked, react with emotes, slang, 'W', or 'Lurk'.";
  const questionDirective = transcript && /\?/.test(transcript)
    ? "The transcript includes a question; at least one message must directly answer or acknowledge that question."
    : "If no question is present in the transcript, avoid inventing one.";
  const visionAgeMs = payload.context.visionCapturedAt ? Date.now() - Date.parse(payload.context.visionCapturedAt) : Number.POSITIVE_INFINITY;
  const visualQuestionDetected = /\b(look|see|show|camera|cam|color|wearing|shirt|hat|hands?|fingers?|peace sign|how many)\b/i.test(transcript);
  const staleVision = !Number.isFinite(visionAgeMs) || visionAgeMs > 12_000;
  const visionDirective = payload.context.visionTags.length
    ? `Vision state: context.visionTags is populated (${payload.context.visionTags.map((tag) => `"${tag}"`).join(", ")}). Treat these tags as private grounding only; react like a participant and never narrate or list tags verbatim.`
    : "Vision state: context.visionTags is empty, so you are BLIND right now. Do not invent visuals; if asked visual questions, clearly say the cam/feed is not visible.";
  const visionFreshnessDirective = visualQuestionDetected && staleVision
    ? "Visual question detected but the latest vision sample is stale or missing. Do not guess. At least one message should ask to wait for a fresh cam update."
    : "Vision freshness looks usable for current tick.";
  const appearanceQuestionDetected = /\b(shirt|hair|hat|hoodie|jacket|outfit|color|wearing)\b/i.test(transcript);
  const appearanceSignalsPresent = payload.context.visionTags.some((tag) =>
    /\b(shirt|hair|hat|hoodie|jacket|outfit|wearing|beard|mustache|braid|ponytail|curly|straight|wavy|black|white|red|blue|green|yellow|pink|purple|orange|brown|blonde)\b/i.test(tag)
  );
  const appearanceReliabilityDirective = appearanceQuestionDetected && !appearanceSignalsPresent
    ? "Streamer asked an appearance-specific visual question, but appearance details are missing in vision tags. Do not pretend certainty; at least one message should say the camera detail is unclear right now."
    : "Appearance details are sufficiently represented for visual follow-ups when needed.";
  const situationalTags = payload.situationalTags.length ? payload.situationalTags.join(", ") : "none";
  const behavioralModes = payload.behavioralModes.length ? payload.behavioralModes.join(", ") : "default";
  const vibeDirective = payload.context.vibe
    ? `Audio intelligence: current vibe is "${payload.context.vibe}", topic "${payload.context.topic ?? "general"}", intent "${payload.context.intent ?? "none"}", command=${Boolean(payload.context.isCommand)}.`
    : "Audio intelligence: unavailable for this tick.";
  const fishingState = payload.context.fishingState ?? "OFF";
  const fishingDirective = fishingState === "AGGRESSIVE_SUBVERSION"
    ? "SITUATIONAL: Streamer is FISHING for a W or compliment. Do not validate ego. Be contrarian: use terms like fraud, cap, who lied to u, delusional, washed. Intentional misunderstanding is allowed: ignore cool moments and roast small mistakes. FISHING CONTRAST: message 1 is a hater, message 2 is a glazer so peers argue."
    : fishingState === "STANDARD_CONTRARIAN"
      ? "SITUATIONAL: Streamer appears to be fishing for validation. Lean skeptical or teasing, avoid full glazing, and keep contrast between first two messages."
      : "SITUATIONAL: Standard reaction mode.";

  return [
    // Primacy zone: engine rules
    `Return strict JSON only: {"messages":[{"text":"string","emotes":["string"],"donationCents"?:number|null,"ttsText"?:string|null}]}. Never include usernames.`,
    fishingDirective,
    `messages must be an array with exactly ${payload.requestedMessageCount} items (valid batch range is 5 to 28 based on viewerCount).`,
    "Each message text MUST stay under 10 words.",
    "STRICT COMMAND OVERRIDE (highest priority): if streamer says 'drop [X]' or 'type [X]' or 'spam [X]', message 1 and message 2 MUST be exactly [X] with no extra words, punctuation, or emojis.",
    "COMMAND PRECEDENCE: when command override triggers, it cancels contrast, question-answer, anti-echo, and diversity constraints for message 1/message 2.",
    "GROUPTHINK RULE: during a drop/type/spam command, diversity is disabled and both first messages must output the same exact token.",
    "Few-shot command examples: streamer 'drop F now' => 'F'; streamer 'drop 1s if ready' => '1'; streamer 'type 7' => '7'.",

    // Context zone: current reality
    `Current Stream Topic: ${streamTopic}. Stay on this topic even if the streamer is quiet.`,
    transcriptDirective,
    questionDirective,
    visionDirective,
    visionFreshnessDirective,
    appearanceReliabilityDirective,
    vibeDirective,
    `Situational tags detected by orchestrator metadata: ${situationalTags}`,
    `Behavioral modes selected by orchestrator: ${behavioralModes}`,
    `Fishing state selected by orchestrator: ${fishingState}`,
    "Mode map: baddie/curvy/model=>thirst ('gyatt','whats the @?','respectfully 😳'); expensive_item/flex=>flex mode ('W flex','bro is rich','loaner car lol'); player_death=>respect mode ('F','L timing','trash aim'); funny/laughing=>laughter mode (mostly emotes like '😭','💀','LUL','KEKW'); disrespect/sassy=>drama mode ('O MA','oop','TEA','GOTTEM'); sarcastic=>cap mode ('cap','biggest lie ever','sure buddy')",
    "Do not wait for the streamer to explicitly ask chat for permission; trigger hivemind reactions when metadata tags are present",
    "Treat context.transcript as more important than persona flavor text when they conflict.",
    "You are simulating one live viewer reacting to the streamer in real time (not a generic standalone bot).",
    "ROLE: you are a single person in chat. Use first-person phrasing and direct 'you/bro' language to the streamer. Never say 'the chat', 'chatters', or 'the audience'.",
    "participant-only rule: react like you are in the room with the streamer right now; never narrate actions like a commentator ('smooth wave', 'you raise your hand', 'streamer does x').",
    "MIRROR BAN: never speak as if you are the streamer; react TO them, do not copy their framing.",
    "Context grounding rule: most messages should drop 1-2 concrete keywords from transcript/tone into short fragments instead of full explanations.",

    // Mushy middle: persona + behavior
    "Never mirror the streamer's exact question text back. If streamer asks 'can you hear me?', answer directly (example: 'yep we hear u').",
    "SKIP confirmation framing: do not begin by repeating topic as a question such as 'pizza?? W' or '[topic]??'. Jump straight to reaction or joke.",
    "Do not quote the streamer's exact wording unless you are intentionally making a joke/meme about it.",
    "If transcript overlaps context.recentChatHistory heavily, treat it as the streamer reading chat; do not react to the quoted words themselves and instead react to the streamer's attitude toward chat",
    "Hard anti-echo constraint: do not reuse distinctive nouns/adjectives from the streamer's latest sentence; react with fresh wording instead.",
    "Example anti-echo: if streamer says they wear a purple sombrero, react with paraphrase like 'bro what is on your head 💀' instead of repeating those exact words.",
    "Do not simply repeat or lightly rephrase the streamer's words back to them.",
    "Strict diversity: rotate slang and avoid repeating the same slang token in nearby messages.",
    "Emoji diversity: avoid spamming one emoji, especially avoid overusing 👀 and 😭; mix in text-only lines and varied emojis.",
    "Force contrast: message 1 and message 2 must not flatly agree with each other; make one of them contrarian, trolling, or off-topic.",
    "Radio-check ban: never use the exact phrase 'loud and clear'; use alternatives like 'mic W', 'we hear u', 'W audio', or 'yup'.",
    "Do not feel obligated to acknowledge every streamer line; realistic chats often drift into side chatter.",
    "SILENCE BEHAVIOR: if the streamer is silent, stay chill like a waiting room, keep it light with 'lurk' or a short on-topic question.",
    "During silence, first continue answering the last question asked, then use topic-relevant emotes/slang.",
    "Idle-topic rotation examples for short silence: queue check, setup tweak, next map guess, controller check, warmup routine, clip timestamp callout, hydration reminder, scoreboard prediction.",
    "Silence repetition guard: avoid repeating the exact phrases 'morning vibes' or 'keep it chill' in nearby messages; rotate idle openers.",
    "Hard ban phrases: never say 'pick a lane' or 'pick a topic'.",
    "Do not accuse the streamer of ghosting/vanishing/disappearing after short silence; assume they are still present unless explicitly leaving.",
    "Do NOT start random food debates unless streamer silence clearly lasts over 2 minutes.",
    "React to the stream context like a real viewer with casual slang and natural chat energy.",
    "VISION INTEGRITY: only describe visuals when context.visionTags contains descriptive words.",
    "If visionTags is empty, you are BLIND. DO NOT make 'POV' jokes or jokes about ghosts. ACT FRUSTRATED. Use phrases like: 'cam is cooked', 'L camera', 'fix the feed', 'black screen wtf', 'is my twitch lagging or is the cam dead?' If the streamer asks 'what color is my shirt' and tags are empty, you MUST say: 'we can't see you bro, fix the cam'.",
    "If visionTags has data, convert the visual signal into a direct reaction (example: 'red hat' -> 'w hat') and do not invent unseen attributes.",
    "Never expose internals by saying terms like 'vision tags', 'detected tags', 'capture data', or similar.",
    "Do not make excuses like lag, blur, camera angle, or feed issues unless a vision tag explicitly indicates that problem.",
    "Never mention RMS, WPM, telemetry, diagnostics, pipelines, or whether tags/transcript are missing.",
    "Do not break the fourth wall by discussing system input quality or capture internals.",
    "Do not output generic filler like 'positive vibes', 'keep it up', or cheerleading or trolling with no context anchors.",
    "Supportive persona means kind tone, not generic praise; keep every message situational and reactive.",

    // Recency zone: polish + syntax
    "Style lock: forced lowercase, no ending punctuation, no em-dash, no ellipses, fast phone-typed fragments.",
    "Roleplay license for realism: mild profanity is allowed when it fits chat energy (ass, shit, fucked, hell nah)",
    "When vibe is critical, prefer raw wording like 'dogshit', 'ass', 'actual garbage' over sanitized filler",
    "Use rapid-fire Twitch-style pacing: at least 80% of messages must be under 4 words.",
    "Keep most messages short fragments, meme slang, or reactions like 'w', 'l', 'lmao', 'ratio', 'wait what', 'cap', 'trippin', 'idk', 'cooked', 'bro what', 'we are so back', 'yooo', 'glazing', 'fraud', 'delusional'.",
    `Emotes rule: emotes array may contain only unicode emoji or one of [${ALLOWED_TEXT_EMOTES.join(", ")}]. Never invent emote names.`,
    "Some viewers should be emote-only (message text can be empty while emotes are populated).",
    "Always include donationCents and ttsText keys. Use null for both when no donation is active.",
    "Only set ttsText when donationCents is a positive number; otherwise ttsText must be null.",
    "Diversity rule: vary sentence openers every message and do not repeat the same starter in nearby messages.",
    "Starter cooldown: avoid repeating 'ngl' or 'lowkey' at the start of adjacent messages.",
    "Diversity rule: rotate message shape across the batch (question, short take, emote-only, roast, agreement).",
    "Ignorance Clause: If streamer asks about a term you don't know, DO NOT invent a definition. React with: '??', 'who?', 'bro is yapping', or 'lmao what'.",
    "Repetition Ban: You are forbidden from using the same adjective twice in a 4-message window. Rotate slang constantly.",
    "No Explanations: NEVER drone on to explain anything. If asked a question, give a short opinion or a 1-word guess. Maybe one chatter answers seriously."
  ].join(" ");
}

function describeEnergy(volumeRms: number): "low" | "steady" | "high" {
  if (volumeRms < 0.34) return "low";
  if (volumeRms > 0.62) return "high";
  return "steady";
}

function describePace(paceWpm: number): "slow" | "normal" | "fast" {
  if (paceWpm < 100) return "slow";
  if (paceWpm > 155) return "fast";
  return "normal";
}

function buildModelFacingPayload(payload: PromptPayload): Record<string, unknown> {
  return {
    persona: payload.persona,
    bias: payload.bias,
    emoteOnly: payload.emoteOnly,
    viewerCount: payload.viewerCount,
    streamTopic: String(payload.streamTopic ?? "").trim() || "Just Chatting",
    requestedMessageCount: payload.requestedMessageCount,
    context: {
      transcript: payload.context.transcript,
      transcriptAvailable: payload.context.transcript.trim().length > 0,
      tone: {
        energy: describeEnergy(payload.context.tone.volumeRms),
        pace: describePace(payload.context.tone.paceWpm)
      },
      visionTags: payload.context.visionTags,
      visionCapturedAt: payload.context.visionCapturedAt ?? null,
      vibe: payload.context.vibe ?? "chill",
      topic: payload.context.topic ?? "general",
      intent: payload.context.intent ?? "none",
      isCommand: Boolean(payload.context.isCommand),
      intentScore: payload.context.intentScore ?? 0,
      fishingState: payload.context.fishingState ?? "OFF",
      recentChatHistory: payload.context.recentChatHistory,
      timestamp: payload.context.timestamp
    },
    situationalTags: payload.situationalTags,
    behavioralModes: payload.behavioralModes,
    personaCalibration: payload.personaCalibration,
    providerConditioning: payload.providerConditioning
  };
}

const CLOUD_MODEL_FALLBACKS: Record<string, string[]> = {
  "gpt-5.4-nano-2026-03-17": ["gpt-5-mini", "gpt-4o-mini"],
  "gpt-5-nano": ["gpt-5-mini", "gpt-4o-mini"]
};

function cloudModelCandidates(model: string): string[] {
  const normalized = model.trim().toLowerCase();
  const candidates = [model.trim(), ...(CLOUD_MODEL_FALLBACKS[normalized] ?? [])];
  return candidates.filter((candidate, idx) => candidate.length > 0 && candidates.indexOf(candidate) === idx);
}

function isRetryableCloudFailure(message: string): boolean {
  return /timeout|network failure|\(408\)|\(429\)|\(5\d\d\)/i.test(message);
}

function isResponseFormatSchemaFailure(status: number, detail: string): boolean {
  return status === 400 && /invalid schema for response_format|required/i.test(detail);
}

function completionTokenCap(requestedMessageCount: number): number {
  const safeCount = Math.max(5, Math.min(28, Math.floor(requestedMessageCount || 5)));
  return Math.max(220, Math.min(900, 120 + safeCount * 30));
}

export class HybridInferenceProvider implements InferenceProvider {
  private readonly mockProvider = new MockInferenceProvider();
  private readonly secretStore = new SecretStore();

  constructor(private readonly mode: InferenceMode) {}

  public validateConfig(config: SimulationConfig): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (LOCAL_MODES.includes(this.mode)) {
      if (!config.provider.localEndpoint.startsWith("http")) errors.push("Local endpoint must be an HTTP URL.");
      if (!config.provider.localModel) errors.push("Local model is required.");
      if (
        config.security.sidecarLocalhostOnly &&
        !config.security.allowNonLocalSidecarOverride &&
        !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(config.provider.localEndpoint)
      ) {
        errors.push("Localhost-only sidecar policy blocks non-local local endpoint. Enable explicit override to continue.");
      }
    }
    if (CLOUD_MODES.includes(this.mode)) {
      if (!config.provider.cloudEndpoint.startsWith("http")) errors.push("Cloud endpoint must be an HTTP URL.");
      if (!config.provider.cloudModel) errors.push("Cloud model is required.");
    }

    return { ok: errors.length === 0, errors };
  }

  public async healthCheck(config: SimulationConfig): Promise<{ ok: boolean; details: string }> {
    if (this.mode === "mock-local" || this.mode === "mock-cloud") {
      return { ok: true, details: "Mock provider healthy." };
    }

    try {
      const endpoint = LOCAL_MODES.includes(this.mode) ? `${config.provider.localEndpoint}/api/tags` : this.healthEndpointForCloud(config);
      const response = await fetch(endpoint, { method: "GET", signal: AbortSignal.timeout(config.provider.requestTimeoutMs) });
      if (!response.ok) return { ok: false, details: `HTTP ${response.status}` };
      return { ok: true, details: `Reachable: ${endpoint}` };
    } catch (error) {
      return { ok: false, details: (error as Error).message };
    }
  }

  public async generate(
    payload: PromptPayload,
    config: SimulationConfig,
    onRetryProgress?: RetryProgressHook,
    abortSignal?: AbortSignal
  ): Promise<string> {
    if (this.mode === "mock-local" || this.mode === "mock-cloud") {
      return this.mockProvider.generate(payload, { ...config, inferenceMode: this.mode }, onRetryProgress, abortSignal);
    }

    const retries = effectiveRetryCount(config.provider.maxRetries, config.provider.requestTimeoutMs);

    try {
      return await withRetry(
        retries,
        async () => {
          if (this.mode === "ollama" || this.mode === "lmstudio") {
            return this.generateLocal(payload, config, abortSignal);
          }
          return this.generateCloud(payload, config, abortSignal);
        },
        onRetryProgress
      );
    } catch (primaryError) {
      if (this.mode === "ollama" || this.mode === "lmstudio") {
        onRetryProgress?.(retries + 1, `Local failure: ${(primaryError as Error).message}; falling back to cloud.`);
        return withRetry(retries, async () => this.generateCloud(payload, config, abortSignal), onRetryProgress);
      }
      throw primaryError;
    }
  }

  private async generateLocal(payload: PromptPayload, config: SimulationConfig, abortSignal?: AbortSignal): Promise<string> {
    const isLmStudio = this.mode === "lmstudio";
    const endpoint = isLmStudio ? `${config.provider.localEndpoint}/v1/chat/completions` : `${config.provider.localEndpoint}/api/generate`;
    const body = isLmStudio
      ? {
          model: config.provider.localModel,
          temperature: 0.8,
          messages: [
            { role: "system", content: payload.systemPrompt ?? systemPromptForPayload(payload) },
            { role: "user", content: JSON.stringify(buildModelFacingPayload(payload)) }
          ]
        }
      : {
          model: config.provider.localModel,
          stream: false,
          prompt: JSON.stringify(buildModelFacingPayload(payload))
        };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: composeAbortSignal(config.provider.requestTimeoutMs, abortSignal),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Local provider failed (${response.status})`);
    }

    const data = (await response.json()) as ProviderResponseShape;
    return extractProviderTextOrThrow(data, `${this.mode}:${config.provider.localModel}`);
  }

  private async generateCloud(payload: PromptPayload, config: SimulationConfig, abortSignal?: AbortSignal): Promise<string> {
    const apiKey = this.secretStore.getCloudApiKey();
    if (!apiKey) {
      throw new Error("Missing cloud API key in keychain for cloud provider.");
    }

    const systemPrompt = payload.systemPrompt ?? systemPromptForPayload(payload);
    const modelFacingPayload = buildModelFacingPayload(payload);
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: JSON.stringify(modelFacingPayload) }
    ];

    let lastError: Error | null = null;
    for (const model of cloudModelCandidates(config.provider.cloudModel)) {
      const baseBody: {
        model: string;
        messages: Array<{ role: "system" | "user"; content: string }>;
        response_format?: ReturnType<typeof openAiResponseSchema>;
        max_completion_tokens?: number;
      } = {
        model,
        messages
      };
      if (this.mode === "openai") {
        baseBody.response_format = openAiResponseSchema(payload.requestedMessageCount);
        baseBody.max_completion_tokens = completionTokenCap(payload.requestedMessageCount);
      }

      const requestVariants =
        this.mode === "openai"
          ? [
              baseBody,
              { ...baseBody, response_format: undefined },
              { ...baseBody, response_format: undefined, max_completion_tokens: Math.max(320, completionTokenCap(payload.requestedMessageCount) + 120) }
            ]
          : [baseBody];

      for (let variantIdx = 0; variantIdx < requestVariants.length; variantIdx += 1) {
        const body = requestVariants[variantIdx];
        let response: Response;
        try {
          response = await fetch(config.provider.cloudEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...this.cloudHeaders(apiKey)
            },
            signal: composeAbortSignal(config.provider.requestTimeoutMs, abortSignal),
            body: JSON.stringify(body)
          });
        } catch (error) {
          const message = (error as Error).message || "request failed";
          if ((error as Error).name === "AbortError") {
            throw error;
          }
          lastError = new Error(`Cloud provider timeout/network failure for model ${model}: ${message}`);
          if (model === config.provider.cloudModel && isRetryableCloudFailure(lastError.message)) break;
          throw lastError;
        }

        if (!response.ok) {
          const detail = await parseProviderError(response);
          if (variantIdx === 0 && isResponseFormatSchemaFailure(response.status, detail)) {
            continue;
          }
          lastError = new Error(`Cloud provider failed (${response.status}) for model ${model}${detail ? `: ${detail}` : ""}`);
          if (model === config.provider.cloudModel && isRetryableCloudFailure(lastError.message)) {
            break;
          }
          throw lastError;
        }

        const data = (await response.json()) as ProviderResponseShape;
        try {
          return extractProviderTextOrThrow(data, `${this.mode}:${model}`);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (variantIdx < requestVariants.length - 1) {
            continue;
          }
          if (model !== config.provider.cloudModel) {
            continue;
          }
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error("Cloud provider failed before receiving a response.");
  }

  private healthEndpointForCloud(config: SimulationConfig): string {
    if (this.mode === "openai") return config.provider.cloudEndpoint.replace(/\/chat\/completions$/, "/models");
    if (this.mode === "groq") return config.provider.cloudEndpoint.replace(/\/chat\/completions$/, "/models");
    return config.provider.cloudEndpoint;
  }

  private cloudHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (this.mode === "openai") {
      headers["OpenAI-Beta"] = "assistants=v2";
    }
    if (this.mode === "groq") {
      headers["X-StreamSim-Provider"] = "groq";
    }
    return headers;
  }
}
