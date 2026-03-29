import { DeepgramClient } from "@deepgram/sdk";

export interface DeepgramSttOptions {
  apiKey: string;
  model?: string;
  language?: string;
  smartFormat?: boolean;
  fillerWords?: boolean;
  intents?: boolean;
  topics?: boolean;
  sentiment?: boolean;
}

export class DeepgramNova3Provider {
  constructor(private readonly options: DeepgramSttOptions) {}

  public async connectRealtime() {
    const client = new DeepgramClient({ apiKey: this.options.apiKey });
    return client.listen.v1.connect({
      model: this.options.model ?? "nova-3",
      language: this.options.language ?? "en-US",
      punctuate: "true",
      interim_results: "true",
      smart_format: String(this.options.smartFormat ?? true),
      sentiment: String(this.options.sentiment ?? true),
      intents: String(this.options.intents ?? true),
      topics: String(this.options.topics ?? true)
    } as any);
  }
}
