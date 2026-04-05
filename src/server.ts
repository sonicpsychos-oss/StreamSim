import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sharedDeviceCapturePipeline } from "./capture/deviceCapturePipeline.js";
import { sharedSttEngine } from "./capture/sttEngine.js";
import { sharedVisionFrameStore } from "./capture/visionFrameStore.js";
import { ConfigStore } from "./config/configStore.js";
import { mergeConfig } from "./config/runtimeConfig.js";
import { SimulationConfig } from "./core/types.js";
import { redactSecrets } from "./security/diagnostics.js";
import { banlistDiagnostics } from "./security/banlistRegistry.js";
import { SecretStore } from "./security/secretStore.js";
import { collectHardwareProfile, recommendTier } from "./services/bootDiagnostics.js";
import { ComplianceLogger } from "./services/complianceLogger.js";
import { runReadinessChecks } from "./services/readinessChecks.js";
import { reconcileComplianceUpdate } from "./services/complianceGate.js";
import { SimulationOrchestrator } from "./services/simulationOrchestrator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const configStore = new ConfigStore();
const complianceLogger = new ComplianceLogger();
const secretStore = new SecretStore();
let config: SimulationConfig = configStore.load();
sharedSttEngine.configure(config.capture.sttProvider, config.capture.sttEndpoint);
let onboardingComplete = config.compliance.eulaAccepted;
let bootProfile: Awaited<ReturnType<typeof collectHardwareProfile>> | null = null;
let tierRecommendation: ReturnType<typeof recommendTier> | null = null;
let readinessState: Awaited<ReturnType<typeof runReadinessChecks>> | null = null;

const sseClients = new Set<express.Response>();
const emit = (event: string, payload: unknown) => {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach((client) => client.write(data));
};

const orchestrator = new SimulationOrchestrator(
  () => config,
  (messages) => emit("messages", messages),
  (meta) => emit("meta", meta)
);

async function refreshBootAndReadiness(): Promise<void> {
  bootProfile = await collectHardwareProfile(config);
  tierRecommendation = recommendTier(bootProfile);
  const credentials = secretStore.diagnostics();
  readinessState = await runReadinessChecks(config, undefined, {
    hasCloudKey: credentials.hasCloudKey,
    hasDeepgramKey: credentials.hasDeepgramKey,
    hasOpenAiSttKey: credentials.hasOpenAiSttKey
  });
}

void refreshBootAndReadiness();

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);
  res.write(`event: watermark\ndata: ${JSON.stringify({ text: "Powered by StreamSim", opacity: 0.2 })}\n\n`);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

app.post("/api/config", (req, res) => {
  const previousCompliance = { ...config.compliance };
  const mergedConfig = mergeConfig(config, req.body);
  const complianceUpdate = reconcileComplianceUpdate(previousCompliance, mergedConfig.compliance);
  config = {
    ...mergedConfig,
    compliance: complianceUpdate.compliance
  };
  configStore.save(config);
  sharedSttEngine.configure(config.capture.sttProvider, config.capture.sttEndpoint);

  if (complianceUpdate.versionChanged) {
    complianceLogger.logEvent("eula_version_changed", {
      from: previousCompliance.eulaVersion,
      to: complianceUpdate.compliance.eulaVersion
    });
  }

  if (complianceUpdate.acceptanceInvalidated) {
    complianceLogger.logEvent("eula_reaccept_required", {
      version: complianceUpdate.compliance.eulaVersion
    });
  }

  if (complianceUpdate.acceptanceRecorded) {
    complianceLogger.logEulaAcceptance(config.compliance.eulaVersion);
  }

  onboardingComplete = config.compliance.eulaAccepted;

  void refreshBootAndReadiness();
  res.json({ ok: true, config, onboardingComplete });
});

app.post("/api/security/override-localhost", (req, res) => {
  const allow = Boolean(req.body?.allow);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  if (allow && !reason) {
    res.status(400).json({ ok: false, error: "Reason is required for non-localhost sidecar override." });
    return;
  }

  config = mergeConfig(config, { security: { allowNonLocalSidecarOverride: allow } });
  configStore.save(config);
  sharedSttEngine.configure(config.capture.sttProvider, config.capture.sttEndpoint);
  if (allow) {
    complianceLogger.logEvent("localhost_override_enabled", { reason });
  }
  res.json({ ok: true, security: config.security });
});

app.post("/api/start", (_req, res) => {
  if (!config.compliance.eulaAccepted || !onboardingComplete) {
    res.status(400).json({ ok: false, error: "Onboarding + EULA acceptance is required before starting simulation." });
    return;
  }

  const cloudInference = config.inferenceMode === "openai" || config.inferenceMode === "groq" || config.inferenceMode === "mock-cloud";
  const cloudTts = config.ttsEnabled && config.ttsMode === "cloud" && config.ttsProvider === "openai";
  const deepgramTts = config.ttsEnabled && config.ttsMode === "cloud" && config.ttsProvider === "deepgram_aura";
  const cloudStt =
    config.capture.useRealCapture &&
    (config.capture.sttProvider === "openai-whisper" || config.capture.sttProvider === "gpt-4o-mini-transcribe");
  const credentials = secretStore.diagnostics();
  const hasCloudKey = credentials.hasCloudKey;
  const hasDeepgramKey = credentials.hasDeepgramKey;
  const hasOpenAiSttKey = credentials.hasOpenAiSttKey;

  if ((cloudInference || cloudTts) && !hasCloudKey) {
    res.status(400).json({
      ok: false,
      error: "Cloud mode selected without API key. Save Cloud API key or switch inference/TTS/STT to local.",
      missing: { cloudInference, cloudTts }
    });
    return;
  }
  if (cloudStt && !hasOpenAiSttKey) {
    res.status(400).json({
      ok: false,
      error: "OpenAI STT selected without API key. Save OpenAI STT API key or switch STT provider.",
      missing: { cloudStt }
    });
    return;
  }
  if ((config.capture.sttProvider === "deepgram" || deepgramTts) && !hasDeepgramKey) {
    res.status(400).json({
      ok: false,
      error: "Deepgram mode selected without API key. Save Deepgram API key or switch STT/TTS provider.",
      missing: { deepgramStt: config.capture.sttProvider === "deepgram", deepgramTts }
    });
    return;
  }

  if (readinessState && !readinessState.ready) {
    res.status(400).json({ ok: false, error: "Readiness checks are blocking start. Resolve readiness issues first.", readiness: readinessState });
    return;
  }

  orchestrator.start();
  res.json({ ok: true });
});

app.post("/api/stop", (_req, res) => {
  orchestrator.stop();
  res.json({ ok: true });
});

app.post("/api/sidecar/cancel", (_req, res) => {
  orchestrator.cancelSidecarPull();
  res.json({ ok: true });
});

app.post("/api/sidecar/resume", async (_req, res) => {
  await orchestrator.resumeSidecarPull();
  res.json({ ok: true });
});

app.post("/api/audio/rebind", (_req, res) => {
  orchestrator.recoverAudioDevices();
  res.json({ ok: true });
});

app.post("/api/onboarding/complete", async (_req, res) => {
  if (!config.compliance.eulaAccepted) {
    res.status(400).json({ ok: false, error: "EULA acceptance is required." });
    return;
  }

  const credentials = secretStore.diagnostics();
  const readiness = await runReadinessChecks(config, undefined, {
    hasCloudKey: credentials.hasCloudKey,
    hasDeepgramKey: credentials.hasDeepgramKey,
    hasOpenAiSttKey: credentials.hasOpenAiSttKey
  });
  readinessState = readiness;
  if (!readiness.ready) {
    res.status(400).json({ ok: false, error: "Readiness checks failed.", readiness });
    return;
  }

  onboardingComplete = true;
  res.json({ ok: true, onboardingComplete, readiness });
});

app.get("/api/onboarding/readiness", async (_req, res) => {
  const credentials = secretStore.diagnostics();
  readinessState = await runReadinessChecks(config, undefined, {
    hasCloudKey: credentials.hasCloudKey,
    hasDeepgramKey: credentials.hasDeepgramKey,
    hasOpenAiSttKey: credentials.hasOpenAiSttKey
  });
  res.json({ ok: true, readiness: readinessState });
});

app.post("/api/secrets/cloud-key", (req, res) => {
  const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
  if (!key) {
    res.status(400).json({ ok: false, error: "Missing key." });
    return;
  }

  const stored = secretStore.setCloudApiKey(key);
  if (!stored) {
    res.status(500).json({ ok: false, error: "Failed to store key in OS keychain. Check provider dependencies in diagnostics." });
    return;
  }

  res.json({ ok: true });
});

app.post("/api/secrets/deepgram-key", (req, res) => {
  const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
  if (!key) {
    res.status(400).json({ ok: false, error: "Missing key." });
    return;
  }

  const stored = secretStore.setDeepgramApiKey(key);
  if (!stored) {
    res.status(500).json({ ok: false, error: "Failed to store Deepgram key in OS keychain. Check provider dependencies in diagnostics." });
    return;
  }

  res.json({ ok: true });
});

app.post("/api/secrets/openai-stt-key", (req, res) => {
  const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
  if (!key) {
    res.status(400).json({ ok: false, error: "Missing key." });
    return;
  }

  const stored = secretStore.setOpenAiSttApiKey(key);
  if (!stored) {
    res.status(500).json({ ok: false, error: "Failed to store OpenAI STT key in OS keychain. Check provider dependencies in diagnostics." });
    return;
  }

  res.json({ ok: true });
});

app.post("/api/capture/mic-frame", (req, res) => {
  sharedDeviceCapturePipeline.ingestMicFrame(req.body ?? {});
  res.json({ ok: true });
});

app.post("/api/stt/probe", async (req, res) => {
  const base64 = typeof req.body?.audioBase64 === "string" ? req.body.audioBase64 : "";
  if (!base64) {
    res.status(400).json({ ok: false, error: "audioBase64 is required." });
    return;
  }

  const provider = (typeof req.body?.provider === "string" ? req.body.provider : config.capture.sttProvider) as typeof config.capture.sttProvider;
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : config.capture.sttEndpoint;
  const frame = Buffer.from(base64, "base64");

  try {
    const transcript = await sharedSttEngine.transcribeFrameWith(provider, endpoint, frame);
    res.json({ ok: true, provider, endpoint, transcript });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(502).json({ ok: false, provider, endpoint, error: message });
  }
});

app.post("/api/capture/audio-chunk", async (req, res) => {
  const base64 = typeof req.body?.audioBase64 === "string" ? req.body.audioBase64 : "";
  if (!base64) {
    res.status(400).json({ ok: false, error: "audioBase64 is required." });
    return;
  }
  const frame = Buffer.from(base64, "base64");
  await sharedSttEngine.ingestAudioFrame(frame);
  res.json({ ok: true });
});

app.post("/api/capture/vision-sample", (req, res) => {
  const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl.trim() : "";
  if (dataUrl) sharedVisionFrameStore.setFrame(dataUrl);
  sharedDeviceCapturePipeline.ingestVisionSample(req.body ?? {});
  res.json({ ok: true });
});

app.get("/api/status", (_req, res) => {
  res.json({
    config,
    audioState: orchestrator.getAudioState(),
    ai: orchestrator.getAiStatus(),
    stt: {
      configuredProvider: config.capture.sttProvider,
      engineProvider: sharedSttEngine.state().provider,
      deepgramKeyPresent: secretStore.diagnostics().hasDeepgramKey,
      openAiSttKeyPresent: secretStore.diagnostics().hasOpenAiSttKey,
      endpoint: config.capture.sttEndpoint,
      localConfigured: config.capture.sttProvider === "local-whisper",
      openAiWhisperConfigured: config.capture.sttProvider === "openai-whisper",
      gpt4oMiniTranscribeConfigured: config.capture.sttProvider === "gpt-4o-mini-transcribe"
    },
    onboardingComplete,
    bootDiagnostics: {
      profile: bootProfile,
      recommendation: tierRecommendation
    },
    readiness: readinessState,
    banlist: banlistDiagnostics(),
    secrets: secretStore.diagnostics(),
    privacy: {
      framePersistence: false,
      captureBuffer: sharedDeviceCapturePipeline.diagnostics()
    }
  });
});

app.get("/api/diagnostics", (_req, res) => {
  if (!config.security.allowDiagnostics) {
    res.status(403).json({ ok: false, error: "Diagnostics disabled by config." });
    return;
  }

  res.json({ ok: true, diagnostics: redactSecrets({ config, env: process.env, bootProfile, tierRecommendation, banlist: banlistDiagnostics() }) });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, onboardingComplete });
});

const port = Number(process.env.PORT ?? 4173);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`StreamSim running on http://localhost:${port}`);
});
