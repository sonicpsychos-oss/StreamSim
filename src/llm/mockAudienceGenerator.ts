import { BiasMode, ChatMessage, PersonaMode, SimulationConfig, StreamContext, ToneSnapshot } from "../core/types.js";

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

function engagementFromSignals(tone: ToneSnapshot, context?: StreamContext): number {
  const transcript = context?.transcript ?? "";
  const punctuationBoost = Math.min(0.25, ((transcript.match(/[!?]/g) ?? []).length / 8) * 0.1);
  const visionBoost = Math.min(0.2, (context?.visionTags.length ?? 0) * 0.03);
  const paceBoost = Math.max(0, (tone.paceWpm - 120) / 240);
  const volumeBoost = Math.max(0, tone.volumeRms - 0.35);
  return Math.min(1.4, 0.7 + punctuationBoost + visionBoost + paceBoost + volumeBoost);
}

function realisticDonation(config: SimulationConfig, tone: ToneSnapshot, context?: StreamContext): { donationCents?: number; ttsText?: string } {
  const engagement = engagementFromSignals(tone, context);
  const effectiveRate = Math.min(0.8, config.donationFrequency * engagement);
  if (Math.random() >= effectiveRate) return {};

  const base = 100 + Math.floor(Math.random() * 900);
  const hypeMultiplier = tone.volumeRms > 0.6 || tone.paceWpm > 170 ? 3 : tone.volumeRms > 0.45 ? 2 : 1;
  const donationCents = Math.min(20_000, base * hypeMultiplier);
  const ttsPrefix = tone.volumeRms > 0.5 ? "YO" : "hey";
  return {
    donationCents,
    ttsText: config.ttsEnabled ? `${ttsPrefix} streamer this is fire. ${context?.transcript.slice(0, 60) ?? "great run"}` : undefined
  };
}

export function generateAudienceBatch(config: SimulationConfig, tone: ToneSnapshot, context?: StreamContext): ChatMessage[] {
  const count = Math.max(1, Math.min(8, Math.floor(Math.sqrt(config.viewerCount) / 15) + 1));
  const pool = personaPool(config.persona);

  return Array.from({ length: count }, (_, idx) => {
    const energetic = tone.volumeRms > 0.45 || tone.paceWpm > 160;
    const text = energetic ? `${pick(pool)} !!!` : pick(pool);

    const message: ChatMessage = {
      id: `${Date.now()}-${idx}-${Math.random().toString(16).slice(2)}`,
      username: `viewer_${Math.floor(Math.random() * 9999)}`,
      text: withBias(text, config.bias),
      emotes: Math.random() > 0.45 ? [pick(emotePool)] : [],
      createdAt: new Date().toISOString()
    };

    Object.assign(message, realisticDonation(config, tone, context));

    return message;
  });
}
