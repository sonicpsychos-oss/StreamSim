import fs from "node:fs";
import path from "node:path";
import { defaultConfig, sanitizeConfig } from "./runtimeConfig.js";
import { SimulationConfig } from "../core/types.js";

export class ConfigStore {
  constructor(private readonly filePath = path.resolve(process.cwd(), "data/runtime-config.json")) {}

  public load(): SimulationConfig {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return sanitizeConfig(JSON.parse(raw));
    } catch {
      this.save(defaultConfig);
      return defaultConfig;
    }
  }

  public save(config: SimulationConfig): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(config, null, 2));
  }
}
