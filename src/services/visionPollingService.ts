import { SimulationConfig } from "../core/types.js";
import { sharedDeviceCapturePipeline } from "../capture/deviceCapturePipeline.js";
import { sharedVisionFrameStore } from "../capture/visionFrameStore.js";
import { SecretStore } from "../security/secretStore.js";

interface VisionEndpointPayload {
  visionTags?: string[];
  tags?: string[];
  labels?: string[];
  objects?: string[];
  detections?: Array<{ label?: string; name?: string }>;
  description?: string;
  caption?: string;
  text?: string;
  imageBase64?: string;
  imageUrl?: string;
  frameUrl?: string;
  dataUrl?: string;
}

interface VisionProviderResult {
  tags: string[];
  providerResponse: unknown;
  rawText?: string;
  model?: string;
}

const DEFAULT_OPENAI_CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_VISION_MODEL = "gpt-5.4-nano-2026-03-17";
const VISION_MODEL_FALLBACKS: Record<string, string[]> = {
  "gpt-5.4-nano-2026-03-17": ["gpt-5-mini", "gpt-4o-mini"],
  "gpt-5-nano": ["gpt-5-mini", "gpt-4o-mini"],
  "gpt-5-mini": ["gpt-4o-mini"]
};

const DEAD_VISION_TAGS = new Set([
  "person",
  "people",
  "human",
  "man",
  "woman",
  "boy",
  "girl",
  "face",
  "game",
  "gaming",
  "room",
  "indoors",
  "indoor",
  "camera",
  "webcam",
  "stream",
  "streamer",
  "video",
  "monitor"
]);

function uniqueTagList(tags: string[]): string[] {
  return tags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .filter((tag, index, arr) => arr.indexOf(tag) === index)
    .slice(0, 8);
}

function filterDeadVisionTags(tags: string[]): string[] {
  const normalized = uniqueTagList(tags);
  const filtered = normalized.filter((tag) => !DEAD_VISION_TAGS.has(tag));
  // Never return an empty list if provider gave us at least one normalized tag.
  // This keeps the chat from losing all visual hooks when the scene is generic.
  return filtered.length > 0 ? filtered : normalized;
}

export function explainVisionPollingError(reason: string): string {
  if (reason.includes("Unexpected end of JSON input")) {
    return "Vision endpoint returned truncated JSON (broken package).";
  }
  return reason;
}

function normalizeVisionTags(payload: VisionEndpointPayload): string[] {
  const listCandidates = [
    payload.visionTags,
    payload.tags,
    payload.labels,
    payload.objects,
    payload.detections?.map((entry) => entry.label ?? entry.name ?? "")
  ];
  const listTags = listCandidates
    .flatMap((candidate) => (Array.isArray(candidate) ? candidate : []))
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (listTags.length > 0) return filterDeadVisionTags(listTags);

  const caption = [payload.description, payload.caption, payload.text].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!caption) return [];

  return filterDeadVisionTags(
    caption
    .split(/[|,;\n]/g)
    .map((part) => part.trim())
    .filter(Boolean)
  );
}

function payloadHasVisionSignal(payload: VisionEndpointPayload): boolean {
  if (normalizeVisionTags(payload).length > 0) return true;
  return Boolean(
    payload.dataUrl ||
    payload.imageBase64 ||
    payload.imageUrl ||
    payload.frameUrl
  );
}

function parseVisionTagsFromText(rawText: string): string[] {
  return filterDeadVisionTags(rawText
    .split(/[,\n;|]/g)
    .map((chunk) => chunk.trim())
    .map((chunk) => chunk.replace(/^[-*•\d.)\s]+/, "").trim())
    .map((chunk) => chunk.replace(/^["'`]+|["'`]+$/g, "").trim().toLowerCase())
    .filter(Boolean));
}

function tryParseJsonTags(rawText: string): string[] {
  const attempts = [rawText.trim()];
  const fencedJson = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fencedJson) attempts.push(fencedJson);

  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      const parsed = JSON.parse(attempt) as { tags?: unknown } | unknown[];
      const parsedTags = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { tags?: unknown }).tags)
          ? (parsed as { tags?: unknown[] }).tags
          : [];
      if (!Array.isArray(parsedTags)) continue;
      return filterDeadVisionTags(parsedTags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean));
    } catch {
      continue;
    }
  }
  return [];
}

function extractVisionText(data: {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string | { value?: string } }> } }>;
  output_text?: string;
}): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part?.text === "string") return part.text;
        if (part?.text && typeof part.text === "object" && typeof part.text.value === "string") return part.text.value;
        return "";
      })
      .join(" ")
      .trim();
  }
  return data.output_text ?? "";
}

function visionModelCandidates(primaryModel: string): string[] {
  const normalized = primaryModel.trim().toLowerCase();
  const candidates = [primaryModel.trim(), ...(VISION_MODEL_FALLBACKS[normalized] ?? []), "gpt-4o-mini"];
  return candidates.filter((candidate, index) => candidate && candidates.indexOf(candidate) === index);
}

function selectVisionPrimaryModel(chatModel: string): string {
  const normalized = chatModel.trim().toLowerCase();
  if (normalized.includes("mini")) return DEFAULT_VISION_MODEL;
  if (normalized.includes("nano")) return chatModel.trim();
  return DEFAULT_VISION_MODEL;
}

function resolveOpenAiVisionEndpoint(config: SimulationConfig): string {
  const endpoint = String(config.provider.cloudEndpoint ?? "").trim();
  if (/^https:\/\/api\.openai\.com\/v1\/chat\/completions\/?$/i.test(endpoint)) return endpoint;
  return DEFAULT_OPENAI_CHAT_COMPLETIONS_ENDPOINT;
}

export class VisionPollingService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly secretStore = new SecretStore();
  private inFlightTick: Promise<void> | null = null;

  constructor(
    private readonly getConfig: () => SimulationConfig,
    private readonly emitMeta: (meta: Record<string, unknown>) => void
  ) {}

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.inFlightTick = this.tick();
    void this.inFlightTick;
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.inFlightTick = null;
  }

  public async awaitLatestPoll(maxWaitMs = 1500): Promise<void> {
    if (!this.inFlightTick) return;
    await Promise.race([
      this.inFlightTick,
      new Promise<void>((resolve) => {
        setTimeout(resolve, maxWaitMs);
      })
    ]);
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.inFlightTick = this.tick();
      void this.inFlightTick;
    }, delayMs);
  }

  private async tick(): Promise<void> {
    const config = this.getConfig();
    const delayMs = Math.max(5, config.capture.visionIntervalSec) * 1000;

    if (!config.capture.visionEnabled || !config.capture.useRealCapture) {
      this.scheduleNext(delayMs);
      return;
    }

    try {
      let endpointPayload: VisionEndpointPayload = {};
      if (config.capture.visionEndpoint) {
        try {
          const endpointResponse = await fetch(config.capture.visionEndpoint, { signal: AbortSignal.timeout(3000) });
          if (!endpointResponse.ok) {
            throw new Error(`vision endpoint failed (${endpointResponse.status})`);
          }
          endpointPayload = ((await endpointResponse.json()) ?? {}) as VisionEndpointPayload;
        } catch (endpointError) {
          if (config.capture.visionProvider !== "openai") throw endpointError;
          const latestFrame = sharedVisionFrameStore.getLatestFrame();
          if (!latestFrame) throw endpointError;
          endpointPayload = { dataUrl: latestFrame.dataUrl };
          this.emitMeta({
            warnings: [`Vision endpoint unavailable; falling back to latest browser frame (${explainVisionPollingError(endpointError instanceof Error ? endpointError.message : String(endpointError))}).`],
            blocked: false,
            vision: { provider: config.capture.visionProvider, source: "live-monitor-fallback", ok: true }
          });
        }
      } else if (config.capture.visionProvider === "openai") {
        const latestFrame = sharedVisionFrameStore.getLatestFrame();
        if (!latestFrame) {
          this.emitMeta({
            warnings: ["Vision polling skipped: waiting for browser camera frame upload."],
            blocked: false,
            vision: { provider: config.capture.visionProvider, ok: false, source: "live-monitor" }
          });
          this.scheduleNext(delayMs);
          return;
        }
        endpointPayload = { dataUrl: latestFrame.dataUrl };
      } else {
        this.emitMeta({
          warnings: ["Vision polling skipped: local vision provider requires a vision endpoint URL."],
          blocked: false,
          vision: { provider: config.capture.visionProvider, ok: false }
        });
        this.scheduleNext(delayMs);
        return;
      }
      if (config.capture.visionProvider === "openai" && !payloadHasVisionSignal(endpointPayload)) {
        const latestFrame = sharedVisionFrameStore.getLatestFrame();
        if (latestFrame) {
          endpointPayload = { ...endpointPayload, dataUrl: latestFrame.dataUrl };
          this.emitMeta({
            warnings: ["Vision endpoint returned no image/tags; using latest browser frame for OpenAI tagging."],
            blocked: false,
            vision: { provider: config.capture.visionProvider, source: "live-monitor-fallback", ok: true }
          });
        }
      }
      // eslint-disable-next-line no-console
      console.log("[VisionPollingService] vision endpoint payload", endpointPayload);

      const providerResult: VisionProviderResult =
        config.capture.visionProvider === "openai"
          ? await this.fetchOpenAiVisionTags(config, endpointPayload)
          : { tags: normalizeVisionTags(endpointPayload), providerResponse: endpointPayload };
      // eslint-disable-next-line no-console
      console.log("[VisionService] Raw response from provider:", providerResult.providerResponse);
      const tags = providerResult.tags;

      if (tags.length > 0 && tags.every((tag) => DEAD_VISION_TAGS.has(tag))) {
        this.emitMeta({
          warnings: ["Vision tags were all generic labels; consider improving lighting or camera framing for richer activity/expression tags."],
          vision: {
            provider: config.capture.visionProvider,
            endpoint: config.capture.visionEndpoint,
            tags,
            rawText: providerResult.rawText ?? "",
            providerResponse: providerResult.providerResponse
          }
        });
      }

      if (tags.length) {
        sharedDeviceCapturePipeline.ingestVisionSample({ tags });
      } else {
        this.emitMeta({
          warnings: [
            `Vision provider returned empty tags${providerResult.model ? ` (model=${providerResult.model})` : ""}. Check providerResponse/rawText in metadata for diagnosis.`
          ],
          vision: {
            provider: config.capture.visionProvider,
            endpoint: config.capture.visionEndpoint,
            rawText: providerResult.rawText ?? "",
            providerResponse: providerResult.providerResponse,
            tags
          }
        });
      }

      // eslint-disable-next-line no-console
      console.log("[VisionPollingService] normalized vision tags", { tags, provider: config.capture.visionProvider });
      this.emitMeta({
        vision: {
          provider: config.capture.visionProvider,
          endpoint: config.capture.visionEndpoint,
          providerResponse: providerResult.providerResponse,
          tags,
          updatedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      const message = explainVisionPollingError(error instanceof Error ? error.message : String(error));
      this.emitMeta({ warnings: [`Vision poll failed: ${message}`], blocked: false, vision: { provider: config.capture.visionProvider, ok: false } });
    }

    this.scheduleNext(delayMs);
  }

  private async fetchOpenAiVisionTags(config: SimulationConfig, payload: VisionEndpointPayload): Promise<VisionProviderResult> {
    const cloudApiKey = this.secretStore.getCloudApiKey();
    if (!cloudApiKey) {
      throw new Error("Cloud API key missing for OpenAI vision provider.");
    }

    const imageInput =
      payload.dataUrl ||
      (payload.imageBase64 ? `data:image/jpeg;base64,${payload.imageBase64}` : "") ||
      payload.imageUrl ||
      payload.frameUrl ||
      "";

    if (!imageInput) {
      return { tags: normalizeVisionTags(payload), providerResponse: payload };
    }

    const endpoint = resolveOpenAiVisionEndpoint(config);
    let lastError: Error | null = null;
    let lastEmptyResult: VisionProviderResult | null = null;
    const primaryVisionModel = selectVisionPrimaryModel(config.provider.cloudModel);
    for (const model of visionModelCandidates(primaryVisionModel)) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cloudApiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are a stream-vision tagger. Prioritize streamer activity, facial expressions, body language, and scene energy (example outputs: focused expression, leaning in, adjusting headset, dim gaming vibe). Use raw, unfiltered, slang-aware descriptors and describe intent, not sanitized euphemisms. If a provocative/aggressive hand gesture appears, tag it explicitly (examples: flipping off chat, middle finger, aggressive gesture). Avoid static object lists unless they directly explain action/mood. Exclude generic dead tags such as person, man, woman, game, room, camera, monitor, stream, and video."
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: 'Return strict JSON: {"tags":["tag1","tag2","tag3"]}. Use short phrase-style tags focused on actions/expressions/energy (not generic object labels).'
                },
                {
                  type: "image_url",
                  image_url: { url: imageInput }
                }
              ]
            }
          ],
          max_completion_tokens: 120
        }),
        signal: AbortSignal.timeout(Math.max(5000, Math.min(config.provider.requestTimeoutMs, 15000)))
      });

      if (!response.ok) {
        lastError = new Error(`OpenAI vision request failed (${response.status}) for model ${model}`);
        if (response.status === 408 || response.status === 429 || response.status >= 500) continue;
        throw lastError;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
        output_text?: string;
      };
      // eslint-disable-next-line no-console
      console.log("[VisionService] Raw response from provider:", data);

      const text = extractVisionText(data);
      const tags = tryParseJsonTags(text).length ? tryParseJsonTags(text) : parseVisionTagsFromText(text);
      if (tags.length > 0) {
        return {
          providerResponse: { model, data },
          tags,
          rawText: text,
          model
        };
      }
      lastEmptyResult = {
        providerResponse: { model, data },
        tags: [],
        rawText: text,
        model
      };
    }

    if (lastEmptyResult) return lastEmptyResult;
    throw lastError ?? new Error("OpenAI vision request failed before any provider response.");
  }
}
