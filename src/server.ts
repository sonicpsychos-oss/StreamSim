import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ComplianceLogger } from "./services/complianceLogger.js";
import { ConfigStore } from "./config/configStore.js";
import { mergeConfig } from "./config/runtimeConfig.js";
import { SimulationConfig } from "./core/types.js";
import { redactSecrets } from "./security/diagnostics.js";
import { SecretStore } from "./security/secretStore.js";
import { SimulationOrchestrator } from "./services/simulationOrchestrator.js";
import { sharedDeviceCapturePipeline } from "./capture/deviceCapturePipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const configStore = new ConfigStore();
const complianceLogger = new ComplianceLogger();
const secretStore = new SecretStore();
let config: SimulationConfig = configStore.load();
let onboardingComplete = config.compliance.eulaAccepted;

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
  const previousAccepted = config.compliance.eulaAccepted;
  config = mergeConfig(config, req.body);
  configStore.save(config);

  if (!previousAccepted && config.compliance.eulaAccepted) {
    complianceLogger.logEulaAcceptance(config.compliance.eulaVersion);
    onboardingComplete = true;
  }

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

app.post("/api/onboarding/complete", (_req, res) => {
  if (!config.compliance.eulaAccepted) {
    res.status(400).json({ ok: false, error: "EULA acceptance is required." });
    return;
  }
  onboardingComplete = true;
  res.json({ ok: true, onboardingComplete });
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

app.post("/api/capture/mic-frame", (req, res) => {
  sharedDeviceCapturePipeline.ingestMicFrame(req.body ?? {});
  res.json({ ok: true });
});

app.post("/api/capture/vision-sample", (req, res) => {
  sharedDeviceCapturePipeline.ingestVisionSample(req.body ?? {});
  res.json({ ok: true });
});

app.get("/api/status", (_req, res) => {
  res.json({
    config,
    audioState: orchestrator.getAudioState(),
    onboardingComplete,
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

  res.json({ ok: true, diagnostics: redactSecrets({ config, env: process.env }) });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, onboardingComplete });
});

const port = Number(process.env.PORT ?? 4173);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`StreamSim running on http://localhost:${port}`);
});
