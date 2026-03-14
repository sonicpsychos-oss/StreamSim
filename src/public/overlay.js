const chatEl = document.getElementById("chat");

function renderMessage(msg) {
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
  while (chatEl.children.length > 40) chatEl.lastChild.remove();
}

const events = new EventSource("/api/events");
events.addEventListener("messages", (event) => {
  const messages = JSON.parse(event.data);
  messages.forEach(renderMessage);
});
