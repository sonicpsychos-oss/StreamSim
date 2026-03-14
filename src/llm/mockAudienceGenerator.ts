import { BiasMode, ChatMessage, PersonaMode, SimulationConfig, ToneSnapshot } from "../core/types.js";

const supportive = ["Let's go!", "Huge improvement today", "W gameplay", "You're cooking"];
const trolls = ["That was rough", "Skill issue", "Chat is carrying", "No way you missed that"];
const neutral = ["What build is this?", "Any tips for new players?", "What's next?", "Clean reset"];
const memes = ["PogChamp", "W stream", "clip it", "we're so back"];
const emotePool = ["🔥", "😂", "👏", "Pog", "W", "LUL", "Kappa"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function personaPool(persona: PersonaMode): string[] {
  switch (persona) {
    case "supportive":
      return supportive;
    case "trolls":
      return trolls;
    case "meme-lords":
      return memes;
    default:
      return neutral;
  }
}

function withBias(text: string, bias: BiasMode): string {
  if (bias === "agree") return `${text} fr`;
  if (bias === "disagree") return `nah ${text.toLowerCase()}`;
  if (Math.random() > 0.5) return `${text} agree`; 
  return `counterpoint: ${text.toLowerCase()}`;
}

export function generateAudienceBatch(config: SimulationConfig, tone: ToneSnapshot): ChatMessage[] {
  const count = Math.max(1, Math.min(8, Math.floor(Math.sqrt(config.viewerCount) / 15) + 1));
  const pool = personaPool(config.persona);

  return Array.from({ length: count }, (_, idx) => {
    const energetic = tone.volumeRms > 0.45 || tone.paceWpm > 160;
    const text = energetic ? `${pick(pool)} !!!` : pick(pool);
    const donationRoll = Math.random() < config.donationFrequency;

    const message: ChatMessage = {
      id: `${Date.now()}-${idx}-${Math.random().toString(16).slice(2)}`,
      username: `viewer_${Math.floor(Math.random() * 9999)}`,
      text: withBias(text, config.bias),
      emotes: Math.random() > 0.45 ? [pick(emotePool)] : [],
      createdAt: new Date().toISOString()
    };

    if (donationRoll) {
      message.donationCents = (Math.floor(Math.random() * 20) + 1) * 100;
      if (config.ttsEnabled) {
        message.ttsText = `Donation from ${message.username}: ${message.text}`;
      }
    }

    return message;
  });
}
