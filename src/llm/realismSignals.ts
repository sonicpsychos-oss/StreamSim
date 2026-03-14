import { InferenceMode, PersonaCalibration, PersonaMode, ProviderConditioning, StreamContext, ToneSnapshot } from "../core/types.js";

const personaBiasCenter: Record<PersonaMode, number> = {
  supportive: 0.78,
  trolls: 0.28,
  "meme-lords": 0.55,
  neutral: 0.5
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeTone(tone: ToneSnapshot): { volume: number; pace: number } {
  return {
    volume: clamp((tone.volumeRms - 0.18) / 0.72),
    pace: clamp((tone.paceWpm - 75) / 165)
  };
}

export interface RealismFeatureVector {
  excitementScore: number;
  donationPropensity: number;
  personaBiasScore: number;
}

export class RealismSignalModel {
  private rollingExcitement = 0.5;

  public extract(context: StreamContext, persona: PersonaMode): RealismFeatureVector {
    const { volume, pace } = normalizeTone(context.tone);
    const punctuationDensity = clamp(((context.transcript.match(/[!?]/g) ?? []).length / 10) * 0.5);
    const mentionBoost = clamp(((context.transcript.match(/\b(chat|clip|donation|hype|lets go|gg)\b/gi) ?? []).length / 6) * 0.3);
    const visionBoost = clamp((context.visionTags.length / 8) * 0.2);

    const instantExcitement = clamp(volume * 0.35 + pace * 0.25 + punctuationDensity + mentionBoost + visionBoost);
    this.rollingExcitement = Number((this.rollingExcitement * 0.65 + instantExcitement * 0.35).toFixed(4));

    const donationPropensity = Number(clamp(0.02 + this.rollingExcitement * 0.6 + volume * 0.18 + mentionBoost * 0.2).toFixed(4));
    const personaBiasScore = Number(clamp(personaBiasCenter[persona] + (this.rollingExcitement - 0.5) * 0.22).toFixed(4));

    return {
      excitementScore: this.rollingExcitement,
      donationPropensity,
      personaBiasScore
    };
  }
}

export function calibrateToneSnapshot(tone: ToneSnapshot): ToneSnapshot {
  const { volume, pace } = normalizeTone(tone);
  return {
    volumeRms: Number((0.18 + volume * 0.72).toFixed(3)),
    paceWpm: Number((75 + pace * 165).toFixed(1))
  };
}


const personaCalibrationMap: Record<PersonaMode, PersonaCalibration> = {
  supportive: { positivity: 0.9, sarcasm: 0.1, contrarianism: 0.15 },
  trolls: { positivity: 0.2, sarcasm: 0.78, contrarianism: 0.82 },
  "meme-lords": { positivity: 0.6, sarcasm: 0.52, contrarianism: 0.45 },
  neutral: { positivity: 0.5, sarcasm: 0.28, contrarianism: 0.35 }
};

const providerConditioningMap: Record<InferenceMode, ProviderConditioning> = {
  "mock-local": { providerClass: "mock", expressiveness: 0.52, volatility: 0.48, policyStrictness: 0.35 },
  "mock-cloud": { providerClass: "mock", expressiveness: 0.58, volatility: 0.45, policyStrictness: 0.6 },
  ollama: { providerClass: "local", expressiveness: 0.8, volatility: 0.72, policyStrictness: 0.28 },
  lmstudio: { providerClass: "local", expressiveness: 0.78, volatility: 0.68, policyStrictness: 0.32 },
  openai: { providerClass: "cloud", expressiveness: 0.74, volatility: 0.52, policyStrictness: 0.75 },
  groq: { providerClass: "cloud", expressiveness: 0.77, volatility: 0.58, policyStrictness: 0.68 }
};

export function resolvePersonaCalibration(persona: PersonaMode): PersonaCalibration {
  return personaCalibrationMap[persona];
}

export function providerConditioningForMode(mode: InferenceMode): ProviderConditioning {
  return providerConditioningMap[mode];
}
