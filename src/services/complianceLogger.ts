import fs from "node:fs";
import path from "node:path";

export class ComplianceLogger {
  constructor(private readonly filePath = path.resolve(process.cwd(), "data/compliance-events.log")) {}

  public logEulaAcceptance(version: string): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify({
      event: "eula_acceptance",
      version,
      at: new Date().toISOString()
    });
    fs.appendFileSync(this.filePath, `${line}\n`);
  }
}
