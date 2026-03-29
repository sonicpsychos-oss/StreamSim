export type PersonaMode = "supportive" | "trolls" | "meme-lords" | "neutral";
export type BiasMode = "agree" | "disagree" | "split";
export type InferenceMode = "mock-local" | "mock-cloud" | "ollama" | "lmstudio" | "openai" | "groq";
export type TtsMode = "off" | "local" | "cloud";
export type TtsProvider = "local" | "openai" | "deepgram_aura";
export type SimulatedVibe = "chill" | "nuclear_drama" | "hyped" | "questioning";
export type FishingState = "OFF" | "STANDARD_CONTRARIAN" | "AGGRESSIVE_SUBVERSION";

export interface CaptureConfig {
  visionEnabled: boolean;
  visionIntervalSec: number;
  visionProvider: "local" | "openai";
  useRealCapture: boolean;
  sttEndpoint: string;
  sttProvider: "mock" | "local-whisper" | "whispercpp" | "deepgram" | "openai-whisper" | "gpt-4o-mini-transcribe";
  visionEndpoint: string;
}

export interface SafetyConfig {
  dropOnParseFailure: boolean;
  regenerateOnMalformedJson: boolean;
  dropPolicy: "drop" | "censor";
}

export interface PersonaCalibration {
  positivity: number;
  sarcasm: number;
  contrarianism: number;
}

export interface ProviderConditioning {
  providerClass: "mock" | "local" | "cloud";
  expressiveness: number;
  volatility: number;
  policyStrictness: number;
}

export interface ComplianceConfig {
  eulaAccepted: boolean;
  eulaVersion: string;
}

export interface ProviderConfig {
  localEndpoint: string;
  localModel: string;
  cloudEndpoint: string;
  cloudModel: string;
  requestTimeoutMs: number;
  maxRetries: number;
}

export interface SecurityConfig {
  sidecarLocalhostOnly: boolean;
  allowNonLocalSidecarOverride: boolean;
  allowDiagnostics: boolean;
}

export interface AudioIntelligenceConfig {
  enabled: boolean;
  sentiment: boolean;
  intents: boolean;
  topics: boolean;
  thresholds: {
    nuclearDrama: number;
    hypeVibe: number;
  };
}

export interface SimulationConfig {
  streamTopic: string;
  viewerCount: number;
  engagementMultiplier: number;
  slowMode: boolean;
  emoteOnly: boolean;
  persona: PersonaMode;
  bias: BiasMode;
  donationFrequency: number;
  ttsEnabled: boolean;
  ttsMode: TtsMode;
  ttsProvider: TtsProvider;
  inferenceMode: InferenceMode;
  capture: CaptureConfig;
  safety: SafetyConfig;
  compliance: ComplianceConfig;
  provider: ProviderConfig;
  security: SecurityConfig;
  audioIntelligence: AudioIntelligenceConfig;
}

export interface ToneSnapshot {
  volumeRms: number;
  paceWpm: number;
}

export interface StreamContext {
  transcript: string;
  tone: ToneSnapshot;
  visionTags: string[];
  vibe?: SimulatedVibe;
  topic?: string;
  intent?: string;
  isCommand?: boolean;
  intentScore?: number;
  fishingState?: FishingState;
  recentChatHistory: string[];
  timestamp: string;
}

export interface PromptPayload {
  persona: PersonaMode;
  bias: BiasMode;
  emoteOnly: boolean;
  viewerCount: number;
  streamTopic?: string;
  context: StreamContext;
  situationalTags: string[];
  behavioralModes: string[];
  requestedMessageCount: number;
  personaCalibration: PersonaCalibration;
  providerConditioning: ProviderConditioning;
}

export type MessageSource = "real-inference" | "mock-inference" | "mock-audience" | "fallback-mock" | "unknown";

export interface ChatMessage {
  id: string;
  username: string;
  text: string;
  emotes: string[];
  donationCents?: number | null;
  ttsText?: string | null;
  createdAt: string;
  source?: MessageSource;
}

export interface QueueMessage {
  id: string;
  queueVersion: "v1";
  createdAt: string;
  channel: "chat" | "donation" | "system";
  author: {
    handle: string;
    persona: PersonaMode;
    bias: "agree" | "disagree" | "neutral";
  };
  payload: {
    text: string;
    emotes: string[];
    donationCents?: number | null;
    ttsText?: string | null;
  };
  moderation: {
    safetyAction: "pass" | "drop" | "censor";
    droppedTerms: string[];
  };
  render: {
    priority: number;
    ttlMs: number;
  };
}

export type RetryProgressHook = (attempt: number, reason: string) => void;

export interface InferenceProvider {
  generate(payload: PromptPayload, config: SimulationConfig, onRetryProgress?: RetryProgressHook): Promise<string>;
  healthCheck(config: SimulationConfig): Promise<{ ok: boolean; details: string }>;
  validateConfig(config: SimulationConfig): { ok: boolean; errors: string[] };
}

export interface CaptureProvider {
  getContext(config: SimulationConfig): Promise<StreamContext>;
}
