const chatEl = document.getElementById("chat");
const metaEl = document.getElementById("meta");

const controls = {
  viewerCount: document.getElementById("viewerCount"),
  engagementMultiplier: document.getElementById("engagementMultiplier"),
  donationFrequency: document.getElementById("donationFrequency"),
  persona: document.getElementById("persona"),
  bias: document.getElementById("bias"),
  inferenceMode: document.getElementById("inferenceMode"),
  slowMode: document.getElementById("slowMode"),
  emoteOnly: document.getElementById("emoteOnly"),
  ttsEnabled: document.getElementById("ttsEnabled"),
  visionEnabled: document.getElementById("visionEnabled"),
  visionIntervalSec: document.getElementById("visionIntervalSec"),
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
      visionIntervalSec: Number(controls.visionIntervalSec.value)
    },
    compliance: {
      eulaAccepted: controls.eulaAccepted.checked
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
  controls.slowMode.checked = config.slowMode;
  controls.emoteOnly.checked = config.emoteOnly;
  controls.ttsEnabled.checked = config.ttsEnabled;
  controls.visionEnabled.checked = config.capture.visionEnabled;
  controls.visionIntervalSec.value = config.capture.visionIntervalSec;
  controls.eulaAccepted.checked = config.compliance.eulaAccepted;
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
  metaEl.textContent = JSON.stringify(meta, null, 2);
});

async function boot() {
  const response = await fetch("/api/status");
  const payload = await response.json();
  hydrateControls(payload.config);
}

void boot();
