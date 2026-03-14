import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { HybridInferenceProvider } from "../src/llm/realInferenceProvider.js";
import { DeviceCapturePipeline } from "../src/capture/deviceCapturePipeline.js";
import { redactSecrets } from "../src/security/diagnostics.js";
import { isValidObservabilityEvent } from "../src/services/observability.js";

async function withTestServer(handler: (req: any, res: any) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  };
}

describe("hybrid routing and failover", () => {
  afterEach(() => {
    delete process.env.STREAMSIM_CLOUD_API_KEY;
  });

  it("routes Ollama payload to /api/generate", async () => {
    const server = await withTestServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/generate") {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        req.on("end", () => {
          const payload = JSON.parse(body);
          expect(payload.model).toBe("local-model");
          expect(typeof payload.prompt).toBe("string");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ response: '{"messages":[]}' }));
        });
        return;
      }
      if (req.method === "GET" && req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const provider = new HybridInferenceProvider("ollama");
    const config = { ...defaultConfig, provider: { ...defaultConfig.provider, localEndpoint: server.url, localModel: "local-model" } };
    const output = await provider.generate(
      { persona: "supportive", bias: "agree", emoteOnly: false, viewerCount: 10, requestedMessageCount: 1, context: { transcript: "hi", tone: { volumeRms: 0.4, paceWpm: 120 }, visionTags: [], timestamp: new Date().toISOString() } },
      config
    );

    expect(output).toContain("messages");
    await server.close();
  });

  it("fails over local -> cloud endpoint", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    const local = await withTestServer((_req, res) => {
      res.writeHead(503);
      res.end();
    });
    const cloud = await withTestServer((req, res) => {
      if (req.method !== "POST") return res.end();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: '{"messages":[]}' } }] }));
    });

    const provider = new HybridInferenceProvider("ollama");
    const config = {
      ...defaultConfig,
      provider: { ...defaultConfig.provider, localEndpoint: local.url, localModel: "local", cloudEndpoint: cloud.url, maxRetries: 0 }
    };

    const output = await provider.generate(
      { persona: "supportive", bias: "agree", emoteOnly: false, viewerCount: 10, requestedMessageCount: 1, context: { transcript: "hi", tone: { volumeRms: 0.4, paceWpm: 120 }, visionTags: [], timestamp: new Date().toISOString() } },
      config
    );

    expect(output).toContain("messages");
    await local.close();
    await cloud.close();
  });
});

describe("device capture pipeline + security + observability schema", () => {
  it("accumulates mic transcript and emits periodic vision tags", () => {
    const pipeline = new DeviceCapturePipeline();
    pipeline.ingestMicFrame({ transcriptChunk: "hello", rms: 0.4, wordsPerMinute: 100 });
    pipeline.ingestMicFrame({ transcriptChunk: "world", rms: 0.6, wordsPerMinute: 130 });
    pipeline.ingestVisionSample({ tags: ["keyboard", "ring light"] });

    const config = { ...defaultConfig, capture: { ...defaultConfig.capture, visionIntervalSec: 5, visionEnabled: true } };
    const ctx = pipeline.getContext(config);

    expect(ctx.transcript).toContain("hello world");
    expect(ctx.tone.volumeRms).toBeGreaterThan(0.49);
    expect(ctx.visionTags).toEqual(["keyboard", "ring light"]);
  });

  it("redacts auth and key material", () => {
    const redacted = redactSecrets({ authorization: "Bearer super-secret", api_key: "123", token: "abc" }) as Record<string, string>;
    expect(JSON.stringify(redacted)).not.toContain("super-secret");
    expect(JSON.stringify(redacted)).not.toContain("123");
    expect(JSON.stringify(redacted)).toContain("[REDACTED]");
  });

  it("validates structured observability schema", () => {
    expect(isValidObservabilityEvent({ event: "pipeline_tick", at: new Date().toISOString(), latencyMs: 200 })).toBe(true);
    expect(isValidObservabilityEvent({ event: 1, at: "x" })).toBe(false);
  });
});
