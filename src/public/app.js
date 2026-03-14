const chatEl = document.getElementById("chat");
const metaEl = document.getElementById("meta");

const controls = {
  viewerCount: document.getElementById("viewerCount"),
  engagementMultiplier: document.getElementById("engagementMultiplier"),
  persona: document.getElementById("persona"),
  bias: document.getElementById("bias"),
  slowMode: document.getElementById("slowMode"),
  emoteOnly: document.getElementById("emoteOnly"),
  ttsEnabled: document.getElementById("ttsEnabled")
};

function getPayload() {
  return {
    viewerCount: Number(controls.viewerCount.value),
    engagementMultiplier: Number(controls.engagementMultiplier.value),
    persona: controls.persona.value,
    bias: controls.bias.value,
    slowMode: controls.slowMode.checked,
    emoteOnly: controls.emoteOnly.checked,
    ttsEnabled: controls.ttsEnabled.checked
  };
}

async function post(url, body = undefined) {
  await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
}

document.getElementById("save").addEventListener("click", async () => {
  await post("/api/config", getPayload());
});
document.getElementById("start").addEventListener("click", async () => post("/api/start"));
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
