import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigStore } from "../src/config/configStore.js";
import { CURRENT_CONFIG_SCHEMA_VERSION, migrateConfigPayload } from "../src/config/configMigrations.js";
import { defaultConfig } from "../src/config/runtimeConfig.js";

describe("config migrations", () => {
  it("migrates legacy bare config payload into current schema", () => {
    const legacy = {
      viewerCount: 80,
      capture: { visionEnabled: true, visionIntervalSec: 10, useRealCapture: true }
    };
    const migrated = migrateConfigPayload(legacy);
    expect(migrated.version).toBe(CURRENT_CONFIG_SCHEMA_VERSION);
    expect(migrated.config.capture.sttProvider).toBe(defaultConfig.capture.sttProvider);
    expect(migrated.config.viewerCount).toBe(80);
  });

  it("loads and saves schema envelope with version", () => {
    const filePath = path.resolve(process.cwd(), "data/runtime-config.migration-test.json");
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ viewerCount: 31, capture: { visionEnabled: false } }, null, 2));
    const store = new ConfigStore(filePath);
    const loaded = store.load();

    expect(loaded.viewerCount).toBe(31);
    store.save(loaded);

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8")) as { schemaVersion: number; config: { viewerCount: number } };
    expect(persisted.schemaVersion).toBe(CURRENT_CONFIG_SCHEMA_VERSION);
    expect(persisted.config.viewerCount).toBe(31);

    fs.rmSync(filePath, { force: true });
  });
});
