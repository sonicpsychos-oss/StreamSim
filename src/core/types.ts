export type PersonaMode = "supportive" | "trolls" | "meme-lords" | "neutral";
export type BiasMode = "agree" | "disagree" | "split";
export type InferenceMode = "mock-local" | "mock-cloud" | "ollama" | "lmstudio" | "openai" | "groq";

export interface CaptureConfig {
  visionEnabled: boolean;
  visionIntervalSec: number;
  useRealCapture: boolean;
  sttEndpoint: string;
  sttProvider: "mock" | "whispercpp" | "deepgram";
  visionEndpoint: string;
}

export interface SafetyConfig {
  dropOnParseFailure: boolean;
  regenerateOnMalformedJson: boolean;
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
  provider: ProviderConfig;
  security: SecurityConfig;
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

export type RetryProgressHook = (attempt: number, reason: string) => void;

export interface InferenceProvider {
  generate(payload: PromptPayload, config: SimulationConfig, onRetryProgress?: RetryProgressHook): Promise<string>;
  healthCheck(config: SimulationConfig): Promise<{ ok: boolean; details: string }>;
  validateConfig(config: SimulationConfig): { ok: boolean; errors: string[] };
}

export interface CaptureProvider {
  getContext(config: SimulationConfig): Promise<StreamContext>;
}
