export interface DeepgramAuraConfig {
  apiKey: string;
  model?: string;
  encoding?: "linear16";
  container?: "wav";
}

export class DeepgramAuraTtsService {
  constructor(private readonly config: DeepgramAuraConfig) {}

  public async generateTTS(text: string): Promise<ArrayBuffer> {
    const model = this.config.model ?? "aura-luna-en";
    const response = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        encoding: this.config.encoding ?? "linear16",
        container: this.config.container ?? "wav"
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`Deepgram Aura generation failed (${response.status}).`);
    }

    return response.arrayBuffer();
  }
}
