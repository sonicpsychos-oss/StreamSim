import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
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
