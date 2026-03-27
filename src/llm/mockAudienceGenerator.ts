import { BiasMode, ChatMessage, PersonaMode, ProviderConditioning, SimulationConfig, StreamContext, ToneSnapshot } from "../core/types.js";
import { providerConditioningForMode, RealismSignalModel, resolvePersonaCalibration } from "./realismSignals.js";
import { IdentityManager } from "../services/identityManager.js";

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

function withBias(text: string, bias: BiasMode, conditioning: ProviderConditioning, contrarianism: number): string {
  const disagreeWeight = Math.min(0.95, 0.25 + conditioning.volatility * 0.35 + contrarianism * 0.4);
  if (bias === "agree") return conditioning.expressiveness > 0.7 ? `${text} FRFR` : `${text} fr`;
  if (bias === "disagree") return `nah ${text.toLowerCase()}`;
  if (Math.random() < disagreeWeight) return `counterpoint: ${text.toLowerCase()}`;
  return `${text} agree`;
}

const realismModel = new RealismSignalModel();
const mockIdentityManager = new IdentityManager();

function engagementFromSignals(config: SimulationConfig, context: StreamContext, conditioning: ProviderConditioning): number {
  const features = realismModel.extract(context, config.persona);
  return Math.min(1.7, 0.55 + features.excitementScore * 0.72 + features.personaBiasScore * 0.2 + conditioning.expressiveness * 0.15);
}

function realisticDonation(config: SimulationConfig, tone: ToneSnapshot, conditioning: ProviderConditioning, context?: StreamContext): { donationCents?: number; ttsText?: string } {
  const safeContext = context ?? { transcript: "", tone, visionTags: [], timestamp: new Date().toISOString() };
  const features = realismModel.extract(safeContext, config.persona);
  const engagement = engagementFromSignals(config, safeContext, conditioning);
  const effectiveRate = Math.min(0.85, config.donationFrequency * engagement * (0.42 + features.donationPropensity) * (0.7 + conditioning.expressiveness * 0.4));
  if (Math.random() >= effectiveRate) return {};

  const base = 100 + Math.floor(Math.random() * 900);
  const hypeMultiplier = features.excitementScore > 0.75 || tone.paceWpm > 170 ? 3 : features.excitementScore > 0.55 ? 2 : 1;
  const personaScalar = 0.7 + features.personaBiasScore * 0.8 + conditioning.volatility * 0.15;
  const donationCents = Math.min(20_000, Math.floor(base * hypeMultiplier * personaScalar));
  const ttsPrefix = tone.volumeRms > 0.5 ? "YO" : "hey";
  return {
    donationCents,
    ttsText: config.ttsEnabled && config.ttsMode !== "off" ? `${ttsPrefix} streamer this is fire. ${context?.transcript.slice(0, 60) ?? "great run"}` : undefined
  };
}

export function generateAudienceBatch(config: SimulationConfig, tone: ToneSnapshot, context?: StreamContext, providerConditioning?: ProviderConditioning): ChatMessage[] {
  const count = Math.max(1, Math.min(8, Math.floor(Math.sqrt(config.viewerCount) / 15) + 1));
  const pool = personaPool(config.persona);
  const personaCalibration = resolvePersonaCalibration(config.persona);
  const conditioning = providerConditioning ?? providerConditioningForMode(config.inferenceMode);

  return Array.from({ length: count }, (_, idx) => {
    const energetic = tone.volumeRms > 0.45 || tone.paceWpm > 160;
    const text = energetic ? `${pick(pool)} !!!` : pick(pool);

    const safeContext = context ?? { transcript: "", tone, visionTags: [], timestamp: new Date().toISOString() };
    const features = realismModel.extract(safeContext, config.persona);
    const message: ChatMessage = {
      id: `${Date.now()}-${idx}-${Math.random().toString(16).slice(2)}`,
      username: mockIdentityManager.nextIdentity(),
      text: withBias(text, config.bias === "split" && features.personaBiasScore < 0.45 ? "disagree" : config.bias, conditioning, personaCalibration.contrarianism),
      emotes: Math.random() > 0.45 ? [pick(emotePool)] : [],
      createdAt: new Date().toISOString(),
      source: "mock-audience"
    };

    Object.assign(message, realisticDonation(config, tone, conditioning, safeContext));

    return message;
  });
}
