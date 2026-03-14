export type PersonaMode = "supportive" | "trolls" | "meme-lords" | "neutral";
export type BiasMode = "agree" | "disagree" | "split";
export type InferenceMode = "mock-local" | "mock-cloud";

export interface CaptureConfig {
  visionEnabled: boolean;
  visionIntervalSec: number;
}

export interface SafetyConfig {
  dropOnParseFailure: boolean;
}

export interface ComplianceConfig {
  eulaAccepted: boolean;
}

export interface SimulationConfig {
  viewerCount: number;
  engagementMultiplier: number;
  slowMode: boolean;
  emoteOnly: boolean;
  persona: PersonaMode;
  bias: BiasMode;
  donationFrequency: number;
  ttsEnabled: boolean;
  inferenceMode: InferenceMode;
  capture: CaptureConfig;
  safety: SafetyConfig;
  compliance: ComplianceConfig;
}

export interface ToneSnapshot {
  volumeRms: number;
  paceWpm: number;
}

export interface StreamContext {
  transcript: string;
  tone: ToneSnapshot;
  visionTags: string[];
  timestamp: string;
}

export interface PromptPayload {
  persona: PersonaMode;
  bias: BiasMode;
  emoteOnly: boolean;
  viewerCount: number;
  context: StreamContext;
  requestedMessageCount: number;
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

export interface InferenceProvider {
  generate(payload: PromptPayload, config: SimulationConfig): Promise<string>;
}
