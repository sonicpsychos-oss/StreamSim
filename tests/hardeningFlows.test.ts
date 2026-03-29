import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";
import { HybridInferenceProvider } from "../src/llm/realInferenceProvider.js";
import { parseInferenceOutput } from "../src/pipeline/outputParser.js";
import { evaluateSecretProviderCapabilities } from "../src/security/secretStore.js";
import { SidecarManager } from "../src/services/sidecarManager.js";
import { sharedDeviceCapturePipeline } from "../src/capture/deviceCapturePipeline.js";
import { sharedSttEngine } from "../src/capture/sttEngine.js";

class FakeSidecarAdapter {
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
    for (const p of [50, 75, 100]) {
      if (opts.signal.aborted) throw new Error("Sidecar pull cancelled.");
      opts.onProgress(p, "progress");
    }
  }
}

describe("localhost override workflow", () => {
  it("blocks non-local endpoints without explicit override", () => {
    const provider = new HybridInferenceProvider("ollama");
    const config = {
      ...defaultConfig,
      provider: { ...defaultConfig.provider, localEndpoint: "http://10.0.0.5:11434" },
      security: { ...defaultConfig.security, sidecarLocalhostOnly: true, allowNonLocalSidecarOverride: false }
    };

    const result = provider.validateConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Enable explicit override");
  });

  it("allows non-local endpoints with explicit override", () => {
    const provider = new HybridInferenceProvider("ollama");
    const config = {
      ...defaultConfig,
      provider: { ...defaultConfig.provider, localEndpoint: "http://10.0.0.5:11434" },
      security: { ...defaultConfig.security, sidecarLocalhostOnly: true, allowNonLocalSidecarOverride: true }
    };

    const result = provider.validateConfig(config);
    expect(result.ok).toBe(true);
  });
});

describe("keychain capability checks", () => {
  it("surfaces missing linux secret-tool dependency", () => {
    const result = evaluateSecretProviderCapabilities("linux", []);
    expect(result.available).toBe(false);
    expect(result.warning).toContain("secret-tool");
  });

  it("surfaces missing windows credential module", () => {
    const result = evaluateSecretProviderCapabilities("win32", ["powershell"]);
    expect(result.available).toBe(false);
    expect(result.warning).toContain("CredentialManager");
  });
});

describe("sidecar lifecycle orchestration", () => {
  it("streams lifecycle progress through pull completion", async () => {
    const sidecar = new SidecarManager(new FakeSidecarAdapter());
    const events: string[] = [];
    sidecar.onProgress((event) => events.push(`${event.phase}:${event.kind}`));

    const status = await sidecar.ensureReady({ ...defaultConfig, inferenceMode: "ollama" });
    expect(status.phase === "ready" || status.phase === "failed").toBe(true);
    expect(events.some((e) => e.startsWith("pulling:progress"))).toBe(true);
  });
});

describe("malformed json fallback + stt pause", () => {
  it("parses valid JSON object even when prefixed/suffixed with junk", () => {
    const parsed = parseInferenceOutput(`junk before {"messages":[{"username":"u","text":"hi","emotes":[],"donationCents":null,"ttsText":null}]} junk after`);
    expect(parsed).toHaveLength(1);
  });

  it("preserves source tags from inference payload", () => {
    const parsed = parseInferenceOutput('{"messages":[{"username":"u","text":"hi","emotes":[],"donationCents":null,"ttsText":null,"source":"fallback-mock"}]}');
    expect(parsed[0]?.source).toBe("fallback-mock");
  });

  it("pauses mic ingest when stt is paused", () => {
    sharedDeviceCapturePipeline.reset();
    sharedSttEngine.pause();
    sharedDeviceCapturePipeline.ingestMicFrame({ transcriptChunk: "blocked" });
    let context = sharedDeviceCapturePipeline.getContext(defaultConfig);
    expect(context.transcript).toBe("");

    sharedSttEngine.resume();
    sharedDeviceCapturePipeline.ingestMicFrame({ transcriptChunk: "allowed" });
    context = sharedDeviceCapturePipeline.getContext(defaultConfig);
    expect(context.transcript).toContain("allowed");
  });
});
