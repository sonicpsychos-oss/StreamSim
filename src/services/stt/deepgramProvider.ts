export interface DeepgramSttOptions {
  apiKey: string;
  model?: string;
  language?: string;
  smartFormat?: boolean;
  fillerWords?: boolean;
  intents?: boolean;
  topics?: boolean;
  sentiment?: boolean;
  endpoint?: string;
}

export class DeepgramNova2Provider {
  constructor(private readonly options: DeepgramSttOptions) {}

  public buildRealtimeUrl(): string {
    const endpoint = this.options.endpoint ?? "wss://api.deepgram.com/v1/listen";
    const url = new URL(endpoint);
    url.searchParams.set("model", this.options.model ?? "nova-2");
    url.searchParams.set("language", this.options.language ?? "en-US");
    url.searchParams.set("smart_format", String(this.options.smartFormat ?? true));
    url.searchParams.set("filler_words", String(this.options.fillerWords ?? true));
    url.searchParams.set("sentiment", String(this.options.sentiment ?? false));
    url.searchParams.set("intents", String(this.options.intents ?? false));
    url.searchParams.set("topics", String(this.options.topics ?? false));
    return url.toString();
  }

  public authorizationHeader(): string {
    return `Token ${this.options.apiKey}`;
  }
}
