import { DeepgramClient } from "@deepgram/sdk";

export interface DeepgramAuraConfig {
  apiKey: string;
  model?: string;
  encoding?: "linear16";
  container?: "wav";
}

export class DeepgramAuraTtsService {
  constructor(private readonly config: DeepgramAuraConfig) {}

  public async generateTTS(text: string): Promise<ArrayBuffer> {
    const model = this.config.model ?? "aura-2-thalia-en";
    const client = new DeepgramClient({ apiKey: this.config.apiKey });
    const response = await client.speak.v1.audio.generate({
      text,
      model,
      encoding: this.config.encoding ?? "linear16",
      container: this.config.container ?? "wav"
    });

    return response.arrayBuffer();
  }
}
