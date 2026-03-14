import fs from "node:fs";
import path from "node:path";

export class ObservabilityLogger {
  private readonly filePath = path.resolve(process.cwd(), "data/observability.log");

  public log(event: string, payload: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(
      this.filePath,
      `${JSON.stringify({ event, at: new Date().toISOString(), ...payload })}\n`
    );
  }
}
