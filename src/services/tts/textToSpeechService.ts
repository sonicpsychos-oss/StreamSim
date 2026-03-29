import { SimulationConfig } from "../../core/types.js";
import { SecretStore } from "../../security/secretStore.js";
import { DeepgramAuraTtsService } from "./deepgramTTS.js";

export class TextToSpeechService {
  private readonly secretStore = new SecretStore();

  public async synthesize(config: SimulationConfig, text: string): Promise<{ provider: string; bytes: number }> {
    if (!config.ttsEnabled || config.ttsMode === "off") return { provider: "off", bytes: 0 };
    if (config.ttsMode === "local" || config.ttsProvider === "local") return { provider: "local", bytes: 0 };

    if (config.ttsProvider === "deepgram_aura") {
      const key = this.secretStore.getDeepgramApiKey();
      if (!key) throw new Error("Deepgram TTS selected but DEEPGRAM_API_KEY is missing.");
      const deepgram = new DeepgramAuraTtsService({ apiKey: key, model: "aura-luna-en", encoding: "linear16", container: "wav" });
      const audio = await deepgram.generateTTS(text);
      return { provider: "deepgram_aura", bytes: audio.byteLength };
    }

    const key = this.secretStore.getCloudApiKey();
    if (!key) throw new Error("OpenAI TTS selected but cloud API key is missing.");
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "alloy",
        input: text,
        format: "wav"
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`OpenAI TTS failed (${response.status}).`);
    const audio = await response.arrayBuffer();
    return { provider: "openai", bytes: audio.byteLength };
  }
}

export const sharedTextToSpeechService = new TextToSpeechService();
