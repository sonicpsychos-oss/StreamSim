import { SimulationConfig } from "../core/types.js";
import { sharedDeviceCapturePipeline } from "../capture/deviceCapturePipeline.js";
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

  if (listTags.length > 0) return listTags.slice(0, 8);

  const caption = [payload.description, payload.caption, payload.text].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!caption) return [];

  return caption
    .split(/[|,;\n]/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export class VisionPollingService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly secretStore = new SecretStore();

  constructor(
    private readonly getConfig: () => SimulationConfig,
    private readonly emitMeta: (meta: Record<string, unknown>) => void
  ) {}

  public start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    const config = this.getConfig();
    const delayMs = Math.max(5, config.capture.visionIntervalSec) * 1000;

    if (!config.capture.visionEnabled || !config.capture.useRealCapture || !config.capture.visionEndpoint) {
      this.scheduleNext(delayMs);
      return;
    }

    try {
      const endpointResponse = await fetch(config.capture.visionEndpoint, { signal: AbortSignal.timeout(3000) });
      if (!endpointResponse.ok) {
        throw new Error(`vision endpoint failed (${endpointResponse.status})`);
      }
      const endpointPayload = ((await endpointResponse.json()) ?? {}) as VisionEndpointPayload;

      const tags =
        config.capture.visionProvider === "openai"
          ? await this.fetchOpenAiVisionTags(config, endpointPayload)
          : normalizeVisionTags(endpointPayload);

      if (tags.length) {
        sharedDeviceCapturePipeline.ingestVisionSample({ tags });
      }

      this.emitMeta({
        vision: {
          provider: config.capture.visionProvider,
          endpoint: config.capture.visionEndpoint,
          tags,
          updatedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitMeta({ warnings: [`Vision poll failed: ${message}`], blocked: false, vision: { provider: config.capture.visionProvider, ok: false } });
    }

    this.scheduleNext(delayMs);
  }

  private async fetchOpenAiVisionTags(config: SimulationConfig, payload: VisionEndpointPayload): Promise<string[]> {
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
      return normalizeVisionTags(payload);
    }

    const response = await fetch(config.provider.cloudEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cloudApiKey}`
      },
      body: JSON.stringify({
        model: config.provider.cloudModel,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "List 5-8 descriptive visual tags for this frame (e.g., green hoodie, gaming headset, messy room, smiling). Output: comma-separated list only."
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
      throw new Error(`OpenAI vision request failed (${response.status})`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
      output_text?: string;
    };

    const content = data.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((part) => part.text ?? "").join(" ")
          : data.output_text ?? "";

    return text
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8);
  }
}
