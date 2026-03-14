export type PersonaMode = "supportive" | "trolls" | "meme-lords" | "neutral";
export type BiasMode = "agree" | "disagree" | "split";

export interface SimulationConfig {
  viewerCount: number;
  engagementMultiplier: number;
  slowMode: boolean;
  emoteOnly: boolean;
  persona: PersonaMode;
  bias: BiasMode;
  donationFrequency: number;
  ttsEnabled: boolean;
}

export interface ToneSnapshot {
  volumeRms: number;
  paceWpm: number;
}

export interface ChatMessage {
  id: string;
  username: string;
  text: string;
  emotes: string[];
  donationCents?: number;
  ttsText?: string;
  createdAt: string;
}
