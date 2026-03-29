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
});
