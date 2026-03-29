import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { EndpointCaptureProvider } from "../src/capture/captureProviders.js";
import { sharedDeviceCapturePipeline } from "../src/capture/deviceCapturePipeline.js";
import { sharedVisionFrameStore } from "../src/capture/visionFrameStore.js";
import { VisionPollingService, explainVisionPollingError } from "../src/services/visionPollingService.js";

describe("EndpointCaptureProvider", () => {
  beforeEach(() => {
    sharedDeviceCapturePipeline.reset();
    vi.restoreAllMocks();
  });

  it("does not block context retrieval on vision endpoint latency", async () => {
    const provider = new EndpointCaptureProvider();
    const config = {
      ...defaultConfig,
      capture: {
        ...defaultConfig.capture,
        sttEndpoint: "http://127.0.0.1:7778/stt"
      }
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transcript: "audio is good" })
      }))
    );

    const context = await provider.getContext(config);
    expect(context.transcript).toContain("audio is good");
  });
});

describe("VisionPollingService", () => {
  beforeEach(() => {
    sharedDeviceCapturePipeline.reset();
    sharedVisionFrameStore.reset();
    vi.restoreAllMocks();
    process.env.STREAMSIM_CLOUD_API_KEY = "test-cloud-key";
  });

  it("ingests local vision tags asynchronously", async () => {
    const config = {
      ...defaultConfig,
      capture: {
        ...defaultConfig.capture,
        visionEnabled: true,
        useRealCapture: true,
        visionProvider: "local" as const,
        visionIntervalSec: 5,
        visionEndpoint: "http://127.0.0.1:7778/vision-tags"
      }
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ visionTags: ["green hoodie", "gaming headset"] })
      }))
    );

    const service = new VisionPollingService(() => config, () => undefined);
    await (service as any).tick();

    const context = sharedDeviceCapturePipeline.getContext(config);
    expect(context.visionTags).toEqual(["green hoodie", "gaming headset"]);
  });

  it("emits provider response details for vision diagnostics", async () => {
    const config = {
      ...defaultConfig,
      capture: {
        ...defaultConfig.capture,
        visionEnabled: true,
        useRealCapture: true,
        visionProvider: "local" as const,
        visionIntervalSec: 5,
        visionEndpoint: "http://127.0.0.1:7778/vision-tags"
      }
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ visionTags: ["ring light"] })
      }))
    );

    const emitMeta = vi.fn();
    const service = new VisionPollingService(() => config, emitMeta);
    await (service as any).tick();

    expect(emitMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        vision: expect.objectContaining({
          providerResponse: { visionTags: ["ring light"] },
          tags: ["ring light"]
        })
      })
    );
  });

  it("maps OpenAI vision output text back into context.visionTags", async () => {
    const config = {
      ...defaultConfig,
      provider: { ...defaultConfig.provider, cloudEndpoint: "https://api.openai.com/v1/chat/completions", cloudModel: "gpt-4o-mini" },
      capture: {
        ...defaultConfig.capture,
        visionEnabled: true,
        useRealCapture: true,
        visionProvider: "openai" as const,
        visionIntervalSec: 5,
        visionEndpoint: "http://127.0.0.1:7778/vision-tags"
      }
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/vision-tags")) {
        return {
          ok: true,
          json: async () => ({ imageBase64: "abcd1234==" })
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "green hoodie, gaming headset, ring light" } }] })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new VisionPollingService(() => config, () => undefined);
    await (service as any).tick();

    const context = sharedDeviceCapturePipeline.getContext(config);
    expect(context.visionTags).toEqual(["green hoodie", "gaming headset", "ring light"]);
  });

  it("uses live-monitor uploaded frame for OpenAI provider when vision endpoint is blank", async () => {
    const config = {
      ...defaultConfig,
      provider: { ...defaultConfig.provider, cloudEndpoint: "https://api.openai.com/v1/chat/completions", cloudModel: "gpt-4o-mini" },
      capture: {
        ...defaultConfig.capture,
        visionEnabled: true,
        useRealCapture: true,
        visionProvider: "openai" as const,
        visionEndpoint: ""
      }
    };
    sharedVisionFrameStore.setFrame("data:image/jpeg;base64,abcd1234==");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ring light, keyboard" } }] })
      }))
    );

    const service = new VisionPollingService(() => config, () => undefined);
    await (service as any).tick();
    const context = sharedDeviceCapturePipeline.getContext(config);
    expect(context.visionTags).toEqual(["ring light", "keyboard"]);
  });

  it("falls back to gpt-4o-mini when primary OpenAI vision model is rate-limited", async () => {
    const config = {
      ...defaultConfig,
      provider: { ...defaultConfig.provider, cloudEndpoint: "https://api.openai.com/v1/chat/completions", cloudModel: "gpt-5.4-nano-2026-03-17" },
      capture: {
        ...defaultConfig.capture,
        visionEnabled: true,
        useRealCapture: true,
        visionProvider: "openai" as const,
        visionEndpoint: "http://127.0.0.1:7778/vision-tags"
      }
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/vision-tags")) {
        return { ok: true, json: async () => ({ imageBase64: "abcd1234==" }) };
      }
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      if (parsed.model === "gpt-5.4-nano-2026-03-17") {
        return { ok: false, status: 429, json: async () => ({ error: { message: "rate limit" } }) };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ring light, keyboard" } }] })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new VisionPollingService(() => config, () => undefined);
    await (service as any).tick();
    const context = sharedDeviceCapturePipeline.getContext(config);
    expect(context.visionTags).toEqual(["ring light", "keyboard"]);
  });

  it("forces OpenAI vision requests to OpenAI endpoint when cloud endpoint is local", async () => {
    const config = {
      ...defaultConfig,
      provider: { ...defaultConfig.provider, cloudEndpoint: "http://127.0.0.1:1234/v1/chat/completions", cloudModel: "gpt-4o-mini" },
      capture: {
        ...defaultConfig.capture,
        visionEnabled: true,
        useRealCapture: true,
        visionProvider: "openai" as const,
        visionEndpoint: ""
      }
    };
    sharedVisionFrameStore.setFrame("data:image/jpeg;base64,abcd1234==");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "desk lamp, keyboard" } }] })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new VisionPollingService(() => config, () => undefined);
    await (service as any).tick();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("maps truncated JSON polling errors to a clearer warning", async () => {
    const config = {
      ...defaultConfig,
      capture: {
        ...defaultConfig.capture,
        visionEnabled: true,
        useRealCapture: true,
        visionProvider: "local" as const,
        visionIntervalSec: 5,
        visionEndpoint: "http://127.0.0.1:7778/vision-tags"
      }
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        }
      }))
    );

    const emitMeta = vi.fn();
    const service = new VisionPollingService(() => config, emitMeta);
    await (service as any).tick();

    expect(emitMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        warnings: ["Vision poll failed: Vision endpoint returned truncated JSON (broken package)."]
      })
    );
  });
});

describe("explainVisionPollingError", () => {
  it("rewrites truncated JSON parser failures", () => {
    expect(explainVisionPollingError("Unexpected end of JSON input")).toBe("Vision endpoint returned truncated JSON (broken package).");
  });
});
