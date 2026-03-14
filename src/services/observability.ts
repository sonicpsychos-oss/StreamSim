import fs from "node:fs";
import path from "node:path";

export interface ObservabilityEvent {
  event: string;
  at: string;
  inferenceMode?: string;
  requestedMessageCount?: number;
  emittedCount?: number;
  latencyMs?: number;
  targetDelayMs?: number;
  sidecarStatus?: string;
}

export function isValidObservabilityEvent(value: unknown): value is ObservabilityEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return typeof event.event === "string" && typeof event.at === "string";
}

export class ObservabilityLogger {
  private readonly filePath = path.resolve(process.cwd(), "data/observability.log");

  public log(event: string, payload: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const envelope: ObservabilityEvent = { event, at: new Date().toISOString(), ...payload };
    if (!isValidObservabilityEvent(envelope)) {
      throw new Error("Invalid observability event schema.");
    }

    fs.appendFileSync(this.filePath, `${JSON.stringify(envelope)}\n`);
  }
}
