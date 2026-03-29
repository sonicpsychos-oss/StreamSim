import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { EndpointCaptureProvider } from "../src/capture/captureProviders.js";
import { sharedDeviceCapturePipeline } from "../src/capture/deviceCapturePipeline.js";
import { VisionPollingService } from "../src/services/visionPollingService.js";

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
});
