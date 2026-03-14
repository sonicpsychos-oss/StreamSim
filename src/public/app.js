const chatEl = document.getElementById("chat");
const metaEl = document.getElementById("meta");
const wizardBackdrop = document.getElementById("wizardBackdrop");
const readinessList = document.getElementById("readinessList");
const diagnosticsSummary = document.getElementById("diagnosticsSummary");

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

document.getElementById("save").addEventListener("click", async () => {
  const result = await post("/api/config", getPayload());
  hydrateControls(result.config);
});

document.getElementById("start").addEventListener("click", async () => {
  try {
    await post("/api/start");
  } catch (error) {
    metaEl.textContent = `Start blocked: ${error.message}`;
  }
});

document.getElementById("stop").addEventListener("click", async () => post("/api/stop"));
document.getElementById("rebindAudio").addEventListener("click", async () => post("/api/audio/rebind"));
document.getElementById("sidecarCancel").addEventListener("click", async () => post("/api/sidecar/cancel"));
document.getElementById("sidecarResume").addEventListener("click", async () => post("/api/sidecar/resume"));
document.getElementById("runReadiness").addEventListener("click", async () => {
  const response = await fetch("/api/onboarding/readiness");
  const payload = await response.json();
  renderReadiness(payload.readiness);
});
document.getElementById("saveCloudKey").addEventListener("click", async () => {
  try {
    await post("/api/secrets/cloud-key", { key: controls.cloudApiKey.value });
    metaEl.textContent = "Cloud API key saved to keychain.";
    controls.cloudApiKey.value = "";
  } catch (error) {
    metaEl.textContent = `Cloud key save failed: ${error.message}`;
  }
});
document.getElementById("refreshStatus").addEventListener("click", async () => {
  const response = await fetch("/api/status");
  const payload = await response.json();
  renderReadiness(payload.readiness);
  renderDiagnostics(payload);
  hydrateControls(payload.config);
});
document.getElementById("applyOverride").addEventListener("click", async () => {
  try {
    await post("/api/security/override-localhost", {
      allow: controls.allowNonLocalSidecarOverride.checked,
      reason: controls.overrideReason.value
    });
  } catch (error) {
    metaEl.textContent = `Override failed: ${error.message}`;
  }
});
document.getElementById("completeWizard").addEventListener("click", async () => {
  try {
    const payload = await post("/api/onboarding/complete");
    renderReadiness(payload.readiness);
    wizardBackdrop.classList.add("hidden");
  } catch (error) {
    metaEl.textContent = `Onboarding blocked: ${error.message}`;
  }
});

const events = new EventSource("/api/events");
events.addEventListener("messages", (event) => {
  const messages = JSON.parse(event.data);
  messages.forEach((msg) => {
    const item = document.createElement("div");
    item.className = "chat-msg";
    const donation = msg.donationCents ? `<span class="donation">$${msg.donationCents / 100}</span>` : "";
    item.innerHTML = `<span class="user">${msg.username}</span>${msg.text || msg.emotes.join(" ")}${donation}`;
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
  if (!payload.onboardingComplete) wizardBackdrop.classList.remove("hidden");
}

void boot();
