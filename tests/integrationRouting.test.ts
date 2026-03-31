import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { HybridInferenceProvider } from "../src/llm/realInferenceProvider.js";
import { DeviceCapturePipeline } from "../src/capture/deviceCapturePipeline.js";
import { EndpointCaptureProvider } from "../src/capture/captureProviders.js";
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
      {
        persona: "supportive",
        bias: "agree",
        emoteOnly: false,
        viewerCount: 10,
        requestedMessageCount: 1,
        situationalTags: [],
        behavioralModes: ["default"],
        context: { transcript: "hi", tone: { volumeRms: 0.4, paceWpm: 120 }, visionTags: [], recentChatHistory: [], timestamp: new Date().toISOString() }
      },
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
      {
        persona: "supportive",
        bias: "agree",
        emoteOnly: false,
        viewerCount: 10,
        requestedMessageCount: 1,
        situationalTags: [],
        behavioralModes: ["default"],
        context: { transcript: "hi", tone: { volumeRms: 0.4, paceWpm: 120 }, visionTags: [], recentChatHistory: [], timestamp: new Date().toISOString() }
      },
      config
    );

    expect(output).toContain("messages");
    await local.close();
    await cloud.close();
  });

  it("routes LM Studio payload to /v1/chat/completions", async () => {
    const server = await withTestServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        req.on("end", () => {
          const payload = JSON.parse(body);
          expect(payload.messages[0].role).toBe("system");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { content: '{"messages":[]}' } }] }));
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

    const provider = new HybridInferenceProvider("lmstudio");
    const config = { ...defaultConfig, provider: { ...defaultConfig.provider, localEndpoint: server.url } };
    const output = await provider.generate(
      {
        persona: "supportive",
        bias: "agree",
        emoteOnly: false,
        viewerCount: 10,
        requestedMessageCount: 1,
        situationalTags: [],
        behavioralModes: ["default"],
        context: { transcript: "hi", tone: { volumeRms: 0.4, paceWpm: 120 }, visionTags: [], recentChatHistory: [], timestamp: new Date().toISOString() }
      },
      config
    );
    expect(output).toContain("messages");
    await server.close();
  });


  it("surfaces OpenAI-style error payload + rate-limit headers", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    const server = await withTestServer((_req, res) => {
      res.writeHead(429, {
        "Content-Type": "application/json",
        "retry-after": "2",
        "x-ratelimit-remaining-requests": "0"
      });
      res.end(JSON.stringify({ error: { message: "rate limit exceeded", type: "rate_limit" } }));
    });

    const provider = new HybridInferenceProvider("openai");
    const config = { ...defaultConfig, provider: { ...defaultConfig.provider, cloudEndpoint: server.url, cloudModel: "x", maxRetries: 0 } };
    const payload = {
      persona: "supportive" as const,
      bias: "agree" as const,
      emoteOnly: false,
      viewerCount: 10,
      requestedMessageCount: 1,
      situationalTags: [],
      behavioralModes: ["default"],
      context: { transcript: "switch now", tone: { volumeRms: 0.5, paceWpm: 140 }, visionTags: ["monitor"], recentChatHistory: [], timestamp: new Date().toISOString() }
    };

    await expect(provider.generate(payload, config)).rejects.toThrow(/429/);
    await expect(provider.generate(payload, config)).rejects.toThrow(/retry_after=2/);
    await server.close();
  });

  it("surfaces Groq timeout/network semantics with provider-specific context", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    const provider = new HybridInferenceProvider("groq");
    const config = {
      ...defaultConfig,
      provider: { ...defaultConfig.provider, cloudEndpoint: "http://127.0.0.1:1/chat/completions", cloudModel: "x", requestTimeoutMs: 50, maxRetries: 0 }
    };
    const payload = {
      persona: "supportive" as const,
      bias: "agree" as const,
      emoteOnly: false,
      viewerCount: 10,
      requestedMessageCount: 1,
      situationalTags: [],
      behavioralModes: ["default"],
      context: { transcript: "switch now", tone: { volumeRms: 0.5, paceWpm: 140 }, visionTags: ["monitor"], recentChatHistory: [], timestamp: new Date().toISOString() }
    };

    await expect(provider.generate(payload, config)).rejects.toThrow(/timeout\/network failure/i);
  });

  it("caps retries for longer timeout windows to avoid prolonged fallback delays", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    let attemptCount = 0;
    const server = await withTestServer((_req, res) => {
      attemptCount += 1;
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "temporary overload" } }));
    });

    const provider = new HybridInferenceProvider("openai");
    const config = {
      ...defaultConfig,
      provider: { ...defaultConfig.provider, cloudEndpoint: server.url, cloudModel: "x", requestTimeoutMs: 15000, maxRetries: 4 }
    };
    const payload = {
      persona: "supportive" as const,
      bias: "agree" as const,
      emoteOnly: false,
      viewerCount: 10,
      requestedMessageCount: 1,
      situationalTags: [],
      behavioralModes: ["default"],
      context: { transcript: "switch now", tone: { volumeRms: 0.5, paceWpm: 140 }, visionTags: ["monitor"], recentChatHistory: [], timestamp: new Date().toISOString() }
    };

    await expect(provider.generate(payload, config)).rejects.toThrow(/503/);
    expect(attemptCount).toBe(2);
    await server.close();
  });

  it("routes openai/groq cloud requests with runtime mode switching", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    const server = await withTestServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      expect(req.headers.authorization).toBe("Bearer abc123");
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        expect(parsed.messages[1].role).toBe("user");
        expect(parsed.max_tokens).toBeUndefined();
        if (req.headers["x-streamsim-provider"] === "groq") {
          expect(parsed.max_completion_tokens).toBeUndefined();
        } else {
          expect(parsed.max_completion_tokens).toBeGreaterThanOrEqual(150);
        }
        expect(parsed.temperature).toBeUndefined();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"messages":[]}' } }] }));
      });
    });

    const openAiProvider = new HybridInferenceProvider("openai");
    const groqProvider = new HybridInferenceProvider("groq");
    const config = { ...defaultConfig, provider: { ...defaultConfig.provider, cloudEndpoint: server.url + "/chat/completions", cloudModel: "x" } };
    const payload = {
      persona: "supportive" as const,
      bias: "agree" as const,
      emoteOnly: false,
      viewerCount: 10,
      requestedMessageCount: 1,
      situationalTags: [],
      behavioralModes: ["default"],
      context: { transcript: "switch now", tone: { volumeRms: 0.5, paceWpm: 140 }, visionTags: ["monitor"], recentChatHistory: [], timestamp: new Date().toISOString() }
    };

    await expect(openAiProvider.generate(payload, config)).resolves.toContain("messages");
    await expect(groqProvider.generate(payload, config)).resolves.toContain("messages");
    await server.close();
  });

  it("accepts chat-completions content parts payloads used by newer OpenAI-compatible SDKs", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    const server = await withTestServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [{ type: "text", text: '{"messages":[{"username":"newapi","text":"hello","emotes":[]}]}' }]
              }
            }
          ]
        })
      );
    });

    const provider = new HybridInferenceProvider("openai");
    const config = { ...defaultConfig, provider: { ...defaultConfig.provider, cloudEndpoint: server.url, cloudModel: "x" } };
    const payload = {
      persona: "supportive" as const,
      bias: "agree" as const,
      emoteOnly: false,
      viewerCount: 10,
      requestedMessageCount: 1,
      situationalTags: [],
      behavioralModes: ["default"],
      context: { transcript: "switch now", tone: { volumeRms: 0.5, paceWpm: 140 }, visionTags: ["monitor"], recentChatHistory: [], timestamp: new Date().toISOString() }
    };

    await expect(provider.generate(payload, config)).resolves.toContain('"username":"newapi"');
    await server.close();
  });

  it("applies hardware brevity token limits for GPT-5 family cloud models", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    const server = await withTestServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }

      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        expect(parsed.model).toBe("gpt-5-mini");
        expect(parsed.max_tokens).toBeUndefined();
        expect(parsed.max_completion_tokens).toBeGreaterThanOrEqual(150);
        expect(parsed.temperature).toBeUndefined();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"messages":[]}' } }] }));
      });
    });

    const provider = new HybridInferenceProvider("openai");
    const config = { ...defaultConfig, provider: { ...defaultConfig.provider, cloudEndpoint: server.url, cloudModel: "gpt-5-mini" } };
    const payload = {
      persona: "supportive" as const,
      bias: "agree" as const,
      emoteOnly: false,
      viewerCount: 10,
      requestedMessageCount: 1,
      situationalTags: [],
      behavioralModes: ["default"],
      context: { transcript: "switch now", tone: { volumeRms: 0.5, paceWpm: 140 }, visionTags: ["monitor"], recentChatHistory: [], timestamp: new Date().toISOString() }
    };

    await expect(provider.generate(payload, config)).resolves.toContain("messages");
    await server.close();
  });

  it("falls back from gpt-5.4-nano-2026-03-17 to gpt-5-mini on timeout/network failure", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    const modelsSeen: string[] = [];
    const server = await withTestServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }

      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        modelsSeen.push(parsed.model);
        if (parsed.model === "gpt-5.4-nano-2026-03-17") {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "upstream timeout" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"messages":[]}' } }] }));
      });
    });

    const provider = new HybridInferenceProvider("openai");
    const config = { ...defaultConfig, provider: { ...defaultConfig.provider, cloudEndpoint: server.url, cloudModel: "gpt-5.4-nano-2026-03-17", maxRetries: 0 } };
    const payload = {
      persona: "supportive" as const,
      bias: "agree" as const,
      emoteOnly: false,
      viewerCount: 10,
      requestedMessageCount: 1,
      situationalTags: [],
      behavioralModes: ["default"],
      context: { transcript: "can you hear me?", tone: { volumeRms: 0.5, paceWpm: 140 }, visionTags: ["monitor"], recentChatHistory: [], timestamp: new Date().toISOString() }
    };

    await expect(provider.generate(payload, config)).resolves.toContain("messages");
    expect(modelsSeen).toEqual(["gpt-5.4-nano-2026-03-17", "gpt-5-mini"]);
    await server.close();
  });

  it("retries once without response_format when strict schema is rejected", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    const bodies: Array<Record<string, unknown>> = [];
    const server = await withTestServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }

      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        bodies.push(parsed);
        if (bodies.length === 1) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                message:
                  "Invalid schema for response_format 'streamsim_chat_batch': required must include every property key"
              }
            })
          );
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"messages":[]}' } }] }));
      });
    });

    const provider = new HybridInferenceProvider("openai");
    const config = { ...defaultConfig, provider: { ...defaultConfig.provider, cloudEndpoint: server.url, cloudModel: "gpt-5.4-nano-2026-03-17", maxRetries: 0 } };
    const payload = {
      persona: "supportive" as const,
      bias: "agree" as const,
      emoteOnly: false,
      viewerCount: 10,
      requestedMessageCount: 1,
      situationalTags: [],
      behavioralModes: ["default"],
      context: { transcript: "can you hear me?", tone: { volumeRms: 0.5, paceWpm: 140 }, visionTags: ["monitor"], recentChatHistory: [], timestamp: new Date().toISOString() }
    };

    await expect(provider.generate(payload, config)).resolves.toContain("messages");
    expect(bodies).toHaveLength(2);
    expect((bodies[0] as { response_format?: unknown }).response_format).toBeDefined();
    expect((bodies[1] as { response_format?: unknown }).response_format).toBeUndefined();
    await server.close();
  });

  it("includes context.transcript and anti-generic reactive instructions in system prompt", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    const server = await withTestServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }

      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const systemPrompt = parsed.messages[0]?.content as string;
        const userPayload = JSON.parse(parsed.messages[1]?.content as string);

        expect(systemPrompt).toMatch(/react directly to the streamer's words/i);
        expect(systemPrompt).toMatch(/Prioritize the most recent ~10 seconds/i);
        expect(systemPrompt).toMatch(/Current Stream Topic:/i);
        expect(systemPrompt).toMatch(/Do not output generic filler/i);
        expect(systemPrompt).toMatch(/80% of messages must be under 4 words|at least 80% of messages must be under 4 words/i);
        expect(systemPrompt).toMatch(/drop F now|drop \[X\]|spam \[X\]|type \[X\]/i);
        expect(userPayload.context.transcript).toBe("can you hear me?");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"messages":[]}' } }] }));
      });
    });

    const provider = new HybridInferenceProvider("openai");
    const config = { ...defaultConfig, provider: { ...defaultConfig.provider, cloudEndpoint: server.url, cloudModel: "gpt-4o-mini", maxRetries: 0 } };
    const payload = {
      persona: "supportive" as const,
      bias: "agree" as const,
      emoteOnly: false,
      viewerCount: 10,
      requestedMessageCount: 1,
      situationalTags: [],
      behavioralModes: ["default"],
      context: { transcript: "can you hear me?", tone: { volumeRms: 0.5, paceWpm: 140 }, visionTags: ["headset"], recentChatHistory: [], timestamp: new Date().toISOString() }
    };

    await expect(provider.generate(payload, config)).resolves.toContain("messages");
    await server.close();
  });

  it("uses small-talk fallback instructions and strips raw numeric telemetry from user payload", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "abc123";
    const server = await withTestServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }

      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const systemPrompt = parsed.messages[0]?.content as string;
        const userPayload = JSON.parse(parsed.messages[1]?.content as string);

        expect(systemPrompt).toMatch(/streamer is currently silent/i);
        expect(systemPrompt).toMatch(/never mention RMS, WPM, telemetry/i);
        expect(userPayload.context.transcriptAvailable).toBe(false);
        expect(userPayload.context.tone.energy).toBe("high");
        expect(userPayload.context.tone.pace).toBe("fast");
        expect(typeof userPayload.context.tone.volumeRms).toBe("undefined");
        expect(typeof userPayload.context.tone.paceWpm).toBe("undefined");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"messages":[]}' } }] }));
      });
    });

    const provider = new HybridInferenceProvider("openai");
    const config = { ...defaultConfig, provider: { ...defaultConfig.provider, cloudEndpoint: server.url, cloudModel: "gpt-4o-mini", maxRetries: 0 } };
    const payload = {
      persona: "supportive" as const,
      bias: "agree" as const,
      emoteOnly: false,
      viewerCount: 10,
      requestedMessageCount: 1,
      situationalTags: [],
      behavioralModes: ["default"],
      context: { transcript: "", tone: { volumeRms: 0.8, paceWpm: 180 }, visionTags: [], recentChatHistory: [], timestamp: new Date().toISOString() }
    };

    await expect(provider.generate(payload, config)).resolves.toContain("messages");
    await server.close();
  });
});

describe("device capture pipeline + security + observability schema", () => {
  it("accumulates mic transcript and keeps latest vision tags available between updates", () => {
    const pipeline = new DeviceCapturePipeline();
    pipeline.ingestMicFrame({ transcriptChunk: "hello", rms: 0.4, wordsPerMinute: 100 });
    pipeline.ingestMicFrame({ transcriptChunk: "world", rms: 0.6, wordsPerMinute: 130 });
    pipeline.ingestVisionSample({ tags: ["keyboard", "ring light"] });

    const config = { ...defaultConfig, capture: { ...defaultConfig.capture, visionIntervalSec: 5, visionEnabled: true } };
    const ctx = pipeline.getContext(config);
    const ctxImmediateFollowup = pipeline.getContext(config);

    expect(ctx.transcript).toContain("hello world");
    expect(ctx.tone.volumeRms).toBeGreaterThan(0.49);
    expect(ctx.visionTags).toEqual(["keyboard", "ring light"]);
    expect(ctxImmediateFollowup.visionTags).toEqual(["keyboard", "ring light"]);
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

  it("normalizes endpoint STT response while vision state is decoupled", async () => {
    const stt = await withTestServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: "hello from endpoint", tone: { volumeRms: 0.7, paceWpm: 150 } }));
    });
    const vision = await withTestServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tags: ["desk", "camera"] }));
    });

    const provider = new EndpointCaptureProvider();
    const ctx = await provider.getContext({
      ...defaultConfig,
      capture: {
        ...defaultConfig.capture,
        useRealCapture: true,
        sttEndpoint: stt.url,
        visionEndpoint: vision.url,
        visionEnabled: true,
        visionIntervalSec: 1
      }
    });

    expect(ctx.transcript).toContain("hello from endpoint");
    expect(ctx.visionTags).toEqual([]);
    await stt.close();
    await vision.close();
  });
});
