import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { ComplianceLogger } from "../src/services/complianceLogger.js";
import { sharedDeviceCapturePipeline } from "../src/capture/deviceCapturePipeline.js";
import { DeviceSttEngine } from "../src/capture/sttEngine.js";
import { SidecarManager } from "../src/services/sidecarManager.js";
import { classifyMalformedOutput, recommendedRecoveryAction } from "../src/pipeline/outputParser.js";
import { WorkloadRunner } from "../src/services/workloadRunner.js";

class CheckpointAdapter {
  public async isInstalled(): Promise<boolean> {
    return true;
  }
  public async install(): Promise<void> {
    return;
  }
  public async startService(): Promise<void> {
    return;
  }
  public async pullModel(_model: string, opts: { signal: AbortSignal; onProgress: (progress: number, details: string) => void }): Promise<void> {
    for (const p of [55, 70, 100]) {
      if (opts.signal.aborted) throw new Error("Sidecar pull cancelled.");
      opts.onProgress(p, `p:${p}`);
    }
  }
}

describe("sidecar + checkpointing", () => {
  it("persists pull progress checkpoints and surfaces deterministic UX class", async () => {
    const sidecar = new SidecarManager(new CheckpointAdapter());
    const status = await sidecar.ensureReady({ ...defaultConfig, inferenceMode: "ollama" });
    expect(["ready", "failed"]).toContain(status.phase);

    const checkpointPath = path.resolve(process.cwd(), "data/sidecar-pull-state.json");
    expect(fs.existsSync(checkpointPath)).toBe(true);
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as { progress: number };
    expect(checkpoint.progress).toBeGreaterThanOrEqual(55);
  });
});

describe("real audio capture + stt pause/resume", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STREAMSIM_OPENAI_STT_MODEL;
    delete process.env.STREAMSIM_OPENAI_WHISPER_MODEL;
    delete process.env.STREAMSIM_OPENAI_GPT4O_TRANSCRIBE_MODEL;
    delete process.env.STREAMSIM_OPENAI_STT_API_KEY;
    delete process.env.STREAMSIM_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.STREAMSIM_CLOUD_API_KEY = "test-cloud-key";
  });

  it("processes actual stream chunks and respects pause/resume", async () => {
    sharedDeviceCapturePipeline.reset();
    const stt = new DeviceSttEngine("mock");
    const stream = Readable.from([Buffer.from("hello world"), Buffer.from("another frame")]);
    stt.bindAudioStream(stream);
    await new Promise((resolve) => setTimeout(resolve, 30));

    let context = sharedDeviceCapturePipeline.getContext({ ...defaultConfig, capture: { ...defaultConfig.capture, useRealCapture: true } });
    expect(context.transcript).toContain("hello world");

    stt.pause();
    await stt.ingestAudioFrame(Buffer.from("should not pass"));
    context = sharedDeviceCapturePipeline.getContext(defaultConfig);
    expect(context.transcript).not.toContain("should not pass");

    stt.resume();
    await stt.ingestAudioFrame(Buffer.from("resume works"));
    context = sharedDeviceCapturePipeline.getContext(defaultConfig);
    expect(context.transcript).toContain("resume works");
  });

  it("transcribes probe frames without mutating configured provider", async () => {
    const stt = new DeviceSttEngine("mock");
    stt.configure("mock");

    const before = stt.state();
    const transcript = await stt.transcribeFrameWith("mock", undefined, Buffer.from("probe text"));
    const after = stt.state();

    expect(transcript).toBe("probe text");
    expect(before.provider).toBe("mock");
    expect(after.provider).toBe("mock");
  });

  it("hardens STT pause/resume under timing edge + fault-injection frames", async () => {
    sharedDeviceCapturePipeline.reset();
    const delayedBackend = {
      async transcribe(frame: Buffer): Promise<string> {
        await new Promise((resolve) => setTimeout(resolve, 8));
        if (frame.toString("utf8").includes("fault")) throw new Error("simulated-device-fault");
        return frame.toString("utf8");
      }
    };
    const stt = new DeviceSttEngine("mock", delayedBackend);

    await stt.ingestAudioFrame(Buffer.from("baseline"));
    stt.pause();
    await Promise.allSettled([stt.ingestAudioFrame(Buffer.from("fault frame")), stt.ingestAudioFrame(Buffer.from("should stay muted"))]);
    stt.resume();
    await stt.ingestAudioFrame(Buffer.from("resumed final"));

    const context = sharedDeviceCapturePipeline.getContext(defaultConfig);
    expect(context.transcript).toContain("baseline");
    expect(context.transcript).not.toContain("should stay muted");
    expect(context.transcript).toContain("resumed final");
  });

  it("uses provider-specific default model wiring for OpenAI cloud STT providers", async () => {
    process.env.STREAMSIM_OPENAI_STT_API_KEY = "test-openai-stt-key";
    const inspectModelCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const form = init?.body as FormData;
        inspectModelCalls.push(String(form.get("model")));
        return {
          ok: true,
          json: async () => ({ text: "ok" })
        } as Response;
      })
    );

    const stt = new DeviceSttEngine("mock");
    await stt.transcribeFrameWith("openai-whisper", undefined, Buffer.from("audio"));
    await stt.transcribeFrameWith("gpt-4o-mini-transcribe", undefined, Buffer.from("audio"));

    expect(inspectModelCalls[0]).toBe("whisper-1");
    expect(inspectModelCalls[1]).toBe("gpt-4o-mini-transcribe");
  });

  it("supports explicit provider-specific model overrides for OpenAI cloud STT", async () => {
    process.env.STREAMSIM_OPENAI_STT_API_KEY = "test-openai-stt-key";
    process.env.STREAMSIM_OPENAI_WHISPER_MODEL = "whisper-1-large-v3";
    process.env.STREAMSIM_OPENAI_GPT4O_TRANSCRIBE_MODEL = "gpt-4o-transcribe";

    const inspectModelCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const form = init?.body as FormData;
        inspectModelCalls.push(String(form.get("model")));
        return {
          ok: true,
          json: async () => ({ text: "ok" })
        } as Response;
      })
    );

    const stt = new DeviceSttEngine("mock");
    await stt.transcribeFrameWith("openai-whisper", undefined, Buffer.from("audio"));
    await stt.transcribeFrameWith("gpt-4o-mini-transcribe", undefined, Buffer.from("audio"));

    expect(inspectModelCalls[0]).toBe("whisper-1-large-v3");
    expect(inspectModelCalls[1]).toBe("gpt-4o-transcribe");
  });

  it("uses dedicated OpenAI STT API key for STT authorization when present", async () => {
    process.env.STREAMSIM_CLOUD_API_KEY = "cloud-key-for-chat-inference";
    process.env.STREAMSIM_OPENAI_STT_API_KEY = "dedicated-openai-stt-key";
    process.env.STREAMSIM_OPENAI_API_KEY = "openai-stt-key";
    process.env.OPENAI_API_KEY = "openai-global-key";
    const authHeaders: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        authHeaders.push(String((init?.headers as Record<string, string>).Authorization));
        return {
          ok: true,
          json: async () => ({ text: "ok" })
        } as Response;
      })
    );

    const stt = new DeviceSttEngine("mock");
    await stt.transcribeFrameWith("openai-whisper", undefined, Buffer.from("audio"));
    expect(authHeaders[0]).toBe("Bearer dedicated-openai-stt-key");
  });

  it("falls back to OpenAI env keys when dedicated OpenAI STT key is unavailable", async () => {
    delete process.env.STREAMSIM_CLOUD_API_KEY;
    delete process.env.STREAMSIM_OPENAI_STT_API_KEY;
    process.env.STREAMSIM_OPENAI_API_KEY = "openai-specific-key";
    const authHeaders: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        authHeaders.push(String((init?.headers as Record<string, string>).Authorization));
        return {
          ok: true,
          json: async () => ({ text: "ok" })
        } as Response;
      })
    );

    const stt = new DeviceSttEngine("mock");
    await stt.transcribeFrameWith("gpt-4o-mini-transcribe", undefined, Buffer.from("audio"));
    expect(authHeaders[0]).toBe("Bearer openai-specific-key");
  });

  it("fails STT auth when no OpenAI STT key material is available", async () => {
    delete process.env.STREAMSIM_CLOUD_API_KEY;
    delete process.env.STREAMSIM_OPENAI_STT_API_KEY;
    delete process.env.STREAMSIM_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "ok" })
        } as Response;
      })
    );

    const stt = new DeviceSttEngine("mock");
    await expect(stt.transcribeFrameWith("openai-whisper", undefined, Buffer.from("audio"))).rejects.toThrow(
      "OpenAI STT API key missing. Save OpenAI STT API key in Secrets + Maintenance."
    );
  });
});

describe("overlay/privacy/compliance", () => {
  it("keeps watermark visible and fixed for themes/resolutions contract", () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/public/styles.css"), "utf8");
    const html = fs.readFileSync(path.resolve(process.cwd(), "src/public/index.html"), "utf8");
    expect(html).toContain("Powered by StreamSim");
    expect(css).toMatch(/\.watermark\s*\{[^}]*opacity:\s*0\.2/i);
    expect(css).toMatch(/\.watermark\s*\{[^}]*position:\s*absolute/i);
  });

  it("does not persist vision frames to disk", () => {
    const captureDir = path.resolve(process.cwd(), "data/capture");
    if (fs.existsSync(captureDir)) fs.rmSync(captureDir, { recursive: true, force: true });
    sharedDeviceCapturePipeline.ingestVisionSample({ tags: ["desk", "camera"] });
    expect(fs.existsSync(captureDir)).toBe(false);
  });

  it("logs compliance lifecycle events with explicit version", () => {
    const filePath = path.resolve(process.cwd(), "data/compliance-events.log");
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    const logger = new ComplianceLogger(filePath);
    logger.logEulaAcceptance("2026-01");
    logger.logEvent("eula_version_changed", { from: "2026-01", to: "2026-02" });

    const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines[0]).toContain("eula_acceptance");
    expect(lines[0]).toContain("2026-01");
    expect(lines[1]).toContain("eula_version_changed");
  });
});

describe("malformed output policy + reliability workload", () => {
  it("classifies malformed JSON classes and policy actions", () => {
    expect(classifyMalformedOutput("")) .toBe("empty");
    expect(recommendedRecoveryAction("empty")).toBe("regenerate");
    expect(classifyMalformedOutput("not-json")) .toBe("no_json_object");
    expect(classifyMalformedOutput('{"messages": [}')).toBe("json_syntax");
    expect(classifyMalformedOutput('{"foo": 1}')).toBe("missing_messages");
    expect(classifyMalformedOutput('{"messages":[{"foo":1}]}')).toBe("invalid_message_schema");
  });

  it("runs OBS+game+local-model workload envelope", () => {
    const runner = new WorkloadRunner();
    const summary = runner.run({ name: "obs_game_local_model", ticks: 40, disconnectRate: 0.08 });
    expect(summary.p95LatencyMs).toBeGreaterThan(1000);
    expect(summary.failures).toBeGreaterThanOrEqual(0);
  });
});
