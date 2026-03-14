import fs from "node:fs";
import path from "node:path";
import { defaultConfig } from "./runtimeConfig.js";
import { SimulationConfig } from "../core/types.js";
import { createPersistedEnvelope, migrateConfigPayload } from "./configMigrations.js";

export class ConfigStore {
  constructor(private readonly filePath = path.resolve(process.cwd(), "data/runtime-config.json")) {}

  public load(): SimulationConfig {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return migrateConfigPayload(JSON.parse(raw)).config;
    } catch {
      this.save(defaultConfig);
      return defaultConfig;
    }
  }

  public save(config: SimulationConfig): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(createPersistedEnvelope(config), null, 2));
  }
}
