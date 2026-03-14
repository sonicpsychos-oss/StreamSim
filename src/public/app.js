const chatEl = document.getElementById("chat");
const metaEl = document.getElementById("meta");
const readinessList = document.getElementById("readinessList");
const diagnosticsSummary = document.getElementById("diagnosticsSummary");
const statusBanner = document.getElementById("statusBanner");
const runtimeSummary = document.getElementById("runtimeSummary");
const deviceChecks = document.getElementById("deviceChecks");

const controls = {
  viewerCount: document.getElementById("viewerCount"),
  engagementMultiplier: document.getElementById("engagementMultiplier"),
  donationFrequency: document.getElementById("donationFrequency"),
  persona: document.getElementById("persona"),
  bias: document.getElementById("bias"),
  inferenceMode: document.getElementById("inferenceMode"),
  localEndpoint: document.getElementById("localEndpoint"),
  localModel: document.getElementById("localModel"),
  cloudEndpoint: document.getElementById("cloudEndpoint"),
  cloudModel: document.getElementById("cloudModel"),
  requestTimeoutMs: document.getElementById("requestTimeoutMs"),
  maxRetries: document.getElementById("maxRetries"),
  dropPolicy: document.getElementById("dropPolicy"),
  cloudApiKey: document.getElementById("cloudApiKey"),
  slowMode: document.getElementById("slowMode"),
  emoteOnly: document.getElementById("emoteOnly"),
  ttsEnabled: document.getElementById("ttsEnabled"),
  visionEnabled: document.getElementById("visionEnabled"),
  useRealCapture: document.getElementById("useRealCapture"),
  visionIntervalSec: document.getElementById("visionIntervalSec"),
  sttEndpoint: document.getElementById("sttEndpoint"),
  visionEndpoint: document.getElementById("visionEndpoint"),
  allowDiagnostics: document.getElementById("allowDiagnostics"),
  allowNonLocalSidecarOverride: document.getElementById("allowNonLocalSidecarOverride"),
  overrideReason: document.getElementById("overrideReason"),
  eulaAccepted: document.getElementById("eulaAccepted")
};

function setStatus(message, tone = "success") {
  statusBanner.textContent = message;
  statusBanner.classList.remove("success", "warn", "error");
  statusBanner.classList.add(tone);
}

function setPending(button, isPending) {
  if (!button) return;
  button.disabled = isPending;
}

async function runAction({ button, pendingText, successText, onRun }) {
  try {
    setPending(button, true);
    if (pendingText) setStatus(pendingText, "warn");
    const result = await onRun();
    if (successText) setStatus(successText, "success");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    metaEl.textContent = message;
    return undefined;
  } finally {
    setPending(button, false);
  }
}

function getPayload() {
  return {
    viewerCount: Number(controls.viewerCount.value),
    engagementMultiplier: Number(controls.engagementMultiplier.value),
    donationFrequency: Number(controls.donationFrequency.value),
    persona: controls.persona.value,
    bias: controls.bias.value,
    inferenceMode: controls.inferenceMode.value,
    slowMode: controls.slowMode.checked,
    emoteOnly: controls.emoteOnly.checked,
    ttsEnabled: controls.ttsEnabled.checked,
    capture: {
      visionEnabled: controls.visionEnabled.checked,
      useRealCapture: controls.useRealCapture.checked,
      visionIntervalSec: Number(controls.visionIntervalSec.value),
      sttEndpoint: controls.sttEndpoint.value,
      visionEndpoint: controls.visionEndpoint.value
    },
    provider: {
      localEndpoint: controls.localEndpoint.value,
      localModel: controls.localModel.value,
      cloudEndpoint: controls.cloudEndpoint.value,
      cloudModel: controls.cloudModel.value,
      requestTimeoutMs: Number(controls.requestTimeoutMs.value),
      maxRetries: Number(controls.maxRetries.value)
    },
    safety: {
      dropPolicy: controls.dropPolicy.value
    },
    compliance: {
      eulaAccepted: controls.eulaAccepted.checked
    },
    security: {
      allowDiagnostics: controls.allowDiagnostics.checked,
      allowNonLocalSidecarOverride: controls.allowNonLocalSidecarOverride.checked
    }
  };
}

function hydrateControls(config) {
  controls.viewerCount.value = config.viewerCount;
  controls.engagementMultiplier.value = config.engagementMultiplier;
  controls.donationFrequency.value = config.donationFrequency;
  controls.persona.value = config.persona;
  controls.bias.value = config.bias;
  controls.inferenceMode.value = config.inferenceMode;
  controls.localEndpoint.value = config.provider.localEndpoint;
  controls.localModel.value = config.provider.localModel;
  controls.cloudEndpoint.value = config.provider.cloudEndpoint;
  controls.cloudModel.value = config.provider.cloudModel;
  controls.requestTimeoutMs.value = config.provider.requestTimeoutMs;
  controls.maxRetries.value = config.provider.maxRetries;
  controls.dropPolicy.value = config.safety.dropPolicy;
  controls.slowMode.checked = config.slowMode;
  controls.emoteOnly.checked = config.emoteOnly;
  controls.ttsEnabled.checked = config.ttsEnabled;
  controls.visionEnabled.checked = config.capture.visionEnabled;
  controls.useRealCapture.checked = config.capture.useRealCapture;
  controls.visionIntervalSec.value = config.capture.visionIntervalSec;
  controls.sttEndpoint.value = config.capture.sttEndpoint;
  controls.visionEndpoint.value = config.capture.visionEndpoint;
  controls.allowDiagnostics.checked = config.security.allowDiagnostics;
  controls.allowNonLocalSidecarOverride.checked = config.security.allowNonLocalSidecarOverride;
  controls.eulaAccepted.checked = config.compliance.eulaAccepted;
  if (wizardEulaAccepted) wizardEulaAccepted.checked = config.compliance.eulaAccepted;
}


function renderOnboardingState(payload) {
  const onboardingDone = Boolean(payload?.onboardingComplete);
  if (onboardingPill) {
    onboardingPill.textContent = onboardingDone ? "Complete" : "Pending";
    onboardingPill.classList.toggle("complete", onboardingDone);
    onboardingPill.classList.toggle("pending", !onboardingDone);
  }
}

function syncEulaCheckboxes(source) {
  const checked = Boolean(source?.checked);
  controls.eulaAccepted.checked = checked;
  if (wizardEulaAccepted) wizardEulaAccepted.checked = checked;
}
function renderReadiness(readiness) {
  readinessList.innerHTML = "";
  if (!readiness?.checks?.length) {
    readinessList.innerHTML = "<li>Readiness checks pending...</li>";
    return;
  }

  readiness.checks.forEach((check) => {
    const li = document.createElement("li");
    const icon = check.ok ? "✅" : check.severity === "blocking" ? "❌" : "⚠️";
    li.textContent = `${icon} ${check.id.toUpperCase()}: ${check.message}`;
    readinessList.appendChild(li);
  });
}

function renderDiagnostics(payload) {
  const recommendation = payload.bootDiagnostics?.recommendation;
  const profile = payload.bootDiagnostics?.profile;
  const tierText = recommendation ? `${recommendation.tier} → ${recommendation.inferenceMode} (${recommendation.reason})` : "pending";
  const network = profile ? `${profile.networkLatencyMs}ms` : "pending";
  diagnosticsSummary.textContent = `Tier: ${tierText}\nNetwork probe: ${network}\nBanlist: ${payload.banlist?.version ?? "n/a"} (${payload.banlist?.checksum ?? "n/a"})`;
}

function summarizeRuntime(payload) {
  const mode = payload.config.inferenceMode;
  const runningMode = mode === "openai" || mode === "groq" || mode === "mock-cloud" ? "API/cloud" : "Local";
  const usingMock = mode === "mock-local" || mode === "mock-cloud";
  const cloudKeyReady = Boolean(payload.secrets?.hasCloudKey);
  const cloudKeyState = cloudKeyReady ? "present" : "missing";
  const captureMode = payload.config.capture.useRealCapture ? "real capture endpoints" : "simulated capture";
  const sttMode = payload.config.capture.useRealCapture ? "expects microphone input from configured STT endpoint" : "mock/no verified mic pipeline";

  runtimeSummary.textContent = [
    `Inference mode: ${mode} (${runningMode})`,
    `API key: ${cloudKeyState}`,
    `AI responses: ${usingMock ? "disabled (mock generator active)" : "enabled"}`,
    `Capture mode: ${captureMode}`,
    `STT path: ${sttMode}`
  ].join("\n");
}

function renderDeviceChecks(result) {
  deviceChecks.innerHTML = "";
  const rows = [
    { label: "Microphone permission", ok: result.micPermission, detail: result.micPermission ? "granted" : "not granted" },
    { label: "Camera permission", ok: result.cameraPermission, detail: result.cameraPermission ? "granted" : "not granted" },
    { label: "Microphone device", ok: result.hasMicDevice, detail: result.hasMicDevice ? "detected" : "not detected" },
    { label: "Camera device", ok: result.hasCameraDevice, detail: result.hasCameraDevice ? "detected" : "not detected" }
  ];

  rows.forEach((row) => {
    const li = document.createElement("li");
    li.textContent = `${row.ok ? "✅" : "❌"} ${row.label}: ${row.detail}`;
    deviceChecks.appendChild(li);
  });
}

async function verifyLocalDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error("Browser does not support media device enumeration.");
  }

  let micPermission = false;
  let cameraPermission = false;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    micPermission = true;
    cameraPermission = true;
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    try {
      const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
      micPermission = true;
      audioOnly.getTracks().forEach((track) => track.stop());
    } catch {}

    try {
      const videoOnly = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraPermission = true;
      videoOnly.getTracks().forEach((track) => track.stop());
    } catch {}
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const hasMicDevice = devices.some((device) => device.kind === "audioinput");
  const hasCameraDevice = devices.some((device) => device.kind === "videoinput");

  return { micPermission, cameraPermission, hasMicDevice, hasCameraDevice };
}

async function post(url, body = undefined) {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }

  return response.json().catch(() => ({}));
}

const saveBtn = document.getElementById("save");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const rebindBtn = document.getElementById("rebindAudio");
const sidecarCancelBtn = document.getElementById("sidecarCancel");
const sidecarResumeBtn = document.getElementById("sidecarResume");
const runReadinessBtn = document.getElementById("runReadiness");
const saveCloudKeyBtn = document.getElementById("saveCloudKey");
const refreshStatusBtn = document.getElementById("refreshStatus");
const verifyDevicesBtn = document.getElementById("verifyDevices");
const openOverlayWindowBtn = document.getElementById("openOverlayWindow");
const applyOverrideBtn = document.getElementById("applyOverride");
const completeWizardBtn = document.getElementById("completeWizard");
const wizardEulaAccepted = document.getElementById("wizardEulaAccepted");
const onboardingPill = document.getElementById("onboardingPill");

saveBtn.addEventListener("click", async () => {
  const result = await runAction({
    button: saveBtn,
    pendingText: "Saving config...",
    successText: "Config saved.",
    onRun: () => post("/api/config", getPayload())
  });
  if (result?.config) hydrateControls(result.config);
});

startBtn.addEventListener("click", async () => {
  await runAction({
    button: startBtn,
    pendingText: "Starting simulation...",
    successText: "Simulation started.",
    onRun: () => post("/api/start")
  });
});

stopBtn.addEventListener("click", async () => {
  await runAction({
    button: stopBtn,
    pendingText: "Stopping simulation...",
    successText: "Simulation stopped.",
    onRun: () => post("/api/stop")
  });
});

rebindBtn.addEventListener("click", async () => {
  await runAction({
    button: rebindBtn,
    pendingText: "Rebinding audio...",
    successText: "Audio rebind requested.",
    onRun: () => post("/api/audio/rebind")
  });
});

sidecarCancelBtn.addEventListener("click", async () => {
  await runAction({
    button: sidecarCancelBtn,
    pendingText: "Cancelling sidecar pull...",
    successText: "Sidecar pull cancellation requested.",
    onRun: () => post("/api/sidecar/cancel")
  });
});

sidecarResumeBtn.addEventListener("click", async () => {
  await runAction({
    button: sidecarResumeBtn,
    pendingText: "Resuming sidecar pull...",
    successText: "Sidecar pull resume requested.",
    onRun: () => post("/api/sidecar/resume")
  });
});

runReadinessBtn.addEventListener("click", async () => {
  const payload = await runAction({
    button: runReadinessBtn,
    pendingText: "Running readiness checks...",
    successText: "Readiness refreshed.",
    onRun: async () => {
      const response = await fetch("/api/onboarding/readiness");
      if (!response.ok) throw new Error(`Readiness request failed (${response.status})`);
      return response.json();
    }
  });
  if (payload?.readiness) renderReadiness(payload.readiness);
});

saveCloudKeyBtn.addEventListener("click", async () => {
  await runAction({
    button: saveCloudKeyBtn,
    pendingText: "Saving cloud API key...",
    successText: "Cloud API key saved to keychain.",
    onRun: () => post("/api/secrets/cloud-key", { key: controls.cloudApiKey.value })
  });
  controls.cloudApiKey.value = "";
});

refreshStatusBtn.addEventListener("click", async () => {
  const payload = await runAction({
    button: refreshStatusBtn,
    pendingText: "Refreshing status...",
    successText: "Status refreshed.",
    onRun: async () => {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error(`Status request failed (${response.status})`);
      return response.json();
    }
  });
  if (!payload) return;
  renderReadiness(payload.readiness);
  renderDiagnostics(payload);
  hydrateControls(payload.config);
  renderOnboardingState(payload);
  summarizeRuntime(payload);
});

verifyDevicesBtn.addEventListener("click", async () => {
  const verification = await runAction({
    button: verifyDevicesBtn,
    pendingText: "Verifying camera and microphone...",
    successText: "Device verification complete.",
    onRun: () => verifyLocalDevices()
  });
  if (verification) renderDeviceChecks(verification);
});

openOverlayWindowBtn.addEventListener("click", () => {
  const popup = window.open("/overlay.html", "streamsim-overlay", "popup=yes,width=900,height=700");
  if (!popup) {
    setStatus("Popup blocked. Allow popups to open transparent chat window.", "warn");
  }
});

applyOverrideBtn.addEventListener("click", async () => {
  await runAction({
    button: applyOverrideBtn,
    pendingText: "Applying override...",
    successText: "Override updated.",
    onRun: () =>
      post("/api/security/override-localhost", {
        allow: controls.allowNonLocalSidecarOverride.checked,
        reason: controls.overrideReason.value
      })
  });
});

completeWizardBtn.addEventListener("click", async () => {
  const onboardingPayload = await runAction({
    button: completeWizardBtn,
    pendingText: "Saving compliance + completing onboarding...",
    successText: "Onboarding complete.",
    onRun: async () => {
      syncEulaCheckboxes(wizardEulaAccepted ?? controls.eulaAccepted);
      await post("/api/config", getPayload());
      return post("/api/onboarding/complete");
    }
  });
  if (!onboardingPayload?.readiness) return;
  renderReadiness(onboardingPayload.readiness);
  const status = await fetch("/api/status").then((response) => response.json());
  hydrateControls(status.config);
  renderDiagnostics(status);
  renderOnboardingState(status);
  summarizeRuntime(status);
});


controls.eulaAccepted?.addEventListener("change", () => {
  syncEulaCheckboxes(controls.eulaAccepted);
});

wizardEulaAccepted?.addEventListener("change", () => {
  syncEulaCheckboxes(wizardEulaAccepted);
});

liveMonitorEnabled?.addEventListener("change", async () => {
  if (!liveMonitorEnabled.checked) {
    stopLiveMonitor();
    return;
  }

  const monitorStarted = await runAction({
    button: liveMonitorEnabled,
    pendingText: "Requesting camera/microphone access for live monitor...",
    successText: "Live monitor enabled.",
    onRun: () => startLiveMonitor()
  });

  if (!monitorStarted) {
    liveMonitorEnabled.checked = false;
    stopLiveMonitor();
  }
});

window.addEventListener("beforeunload", () => {
  stopLiveMonitor();
});

const events = new EventSource("/api/events");
events.addEventListener("messages", (event) => {
  const messages = JSON.parse(event.data);
  messages.forEach((msg) => {
    const item = document.createElement("div");
    item.className = "chat-msg";

    const user = document.createElement("span");
    user.className = "user";
    user.textContent = msg.username;

    const messageText = document.createElement("span");
    messageText.textContent = msg.text || msg.emotes.join(" ");

    item.append(user, messageText);

    if (msg.donationCents) {
      const donation = document.createElement("span");
      donation.className = "donation";
      donation.textContent = `$${(msg.donationCents / 100).toFixed(2)}`;
      item.append(donation);
    }

    chatEl.prepend(item);
    while (chatEl.children.length > 22) chatEl.lastChild.remove();
  });
});

events.addEventListener("meta", (event) => {
  const meta = JSON.parse(event.data);
  if (meta?.queueMessages) {
    meta.queuePreview = meta.queueMessages.slice(0, 3);
    delete meta.queueMessages;
  }
  const warningLines = [meta.warning, ...(meta.warnings ?? [])].filter(Boolean);
  const recovery = meta.cloudRecovery ? `Recovery=${meta.cloudRecovery}` : "";
  const banner = warningLines.length ? `⚠️ ${warningLines.join(" | ")} ${recovery}`.trim() + "\n" : "";
  metaEl.textContent = `${banner}${JSON.stringify(meta, null, 2)}`;
});

async function boot() {
  const response = await fetch("/api/status");
  const payload = await response.json();
  hydrateControls(payload.config);
  renderReadiness(payload.readiness);
  renderDiagnostics(payload);
  renderOnboardingState(payload);
  summarizeRuntime(payload);
}

void boot();
