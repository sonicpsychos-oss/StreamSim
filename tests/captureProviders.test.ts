import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { EndpointCaptureProvider } from "../src/capture/captureProviders.js";
import { sharedDeviceCapturePipeline } from "../src/capture/deviceCapturePipeline.js";

describe("EndpointCaptureProvider", () => {
  beforeEach(() => {
    sharedDeviceCapturePipeline.reset();
    vi.restoreAllMocks();
  });

  it("keeps ingesting vision tags even when STT endpoint fails", async () => {
    const provider = new EndpointCaptureProvider();
    const config = {
      ...defaultConfig,
      capture: {
        ...defaultConfig.capture,
        visionIntervalSec: 5
      }
    };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/stt")) throw new Error("stt offline");
      return {
        ok: true,
        json: async () => ({ visionTags: ["boss fight", "health bar"] })
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = await provider.getContext(config);

    expect(context.visionTags).toEqual(["boss fight", "health bar"]);
  });

  it("extracts fallback tags from caption-style vision payloads", async () => {
    const provider = new EndpointCaptureProvider();
    const config = {
      ...defaultConfig,
      capture: {
        ...defaultConfig.capture,
        visionIntervalSec: 5
      }
    };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/stt")) {
        return { ok: true, json: async () => ({ transcript: "sup chat" }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({ description: "game HUD, red warning light, inventory panel" })
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = await provider.getContext(config);

    expect(context.visionTags).toEqual(["game HUD", "red warning light", "inventory panel"]);
  });
});
