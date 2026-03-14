import fs from "node:fs";
import path from "node:path";

export class ComplianceLogger {
  constructor(private readonly filePath = path.resolve(process.cwd(), "data/compliance-events.log")) {}

  public logEulaAcceptance(version: string): void {
    this.logEvent("eula_acceptance", { version });
  }

  public logEvent(event: string, metadata: Record<string, unknown> = {}): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...metadata
    });
    fs.appendFileSync(this.filePath, `${line}\n`);
  }
}
