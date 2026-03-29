import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { parseInferenceOutput } from "../src/pipeline/outputParser.js";
import { SpoolingEngine } from "../src/services/spoolingEngine.js";
import { defaultConfig } from "../src/config/runtimeConfig.js";

describe("NFR measurement pass", () => {
  it("meets parser throughput + latency threshold", () => {
    const payload = JSON.stringify({
      messages: Array.from({ length: 20 }, (_, i) => ({
        username: `u${i}`,
        text: `hello ${i}`,
        emotes: [],
        donationCents: null,
        ttsText: null
      }))
    });

    const runs = 200;
    const start = performance.now();
    for (let i = 0; i < runs; i += 1) {
      parseInferenceOutput(payload);
    }
    const duration = performance.now() - start;
    const avg = duration / runs;

    expect(avg).toBeLessThan(2);
  });

  it("spooling jitter stays bounded to avoid jank spikes", () => {
    const spooler = new SpoolingEngine();
    const contextTone = { volumeRms: 0.5, paceWpm: 130 };
    const delays = Array.from({ length: 400 }, () => spooler.nextDelayMs(defaultConfig, contextTone).actualDelayMs);
    const max = Math.max(...delays);
    const min = Math.min(...delays);

    expect(min).toBeGreaterThan(100);
    expect(max).toBeLessThan(5000);
  });
});
