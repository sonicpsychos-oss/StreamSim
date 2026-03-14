import { describe, expect, it } from "vitest";
import { CURRENT_CONFIG_SCHEMA_VERSION, migrateConfigPayload } from "../src/config/configMigrations.js";

describe("migration strategy registry", () => {
  it("migrates historical fixture payloads through registry", () => {
    const fixtureV1 = {
      schemaVersion: 1,
      config: {
        viewerCount: 42,
        capture: { visionEnabled: true, visionIntervalSec: 12, useRealCapture: true, sttProvider: "invalid-provider" }
      }
    };

    const migrated = migrateConfigPayload(fixtureV1);
    expect(migrated.version).toBe(CURRENT_CONFIG_SCHEMA_VERSION);
    expect(migrated.config.capture.sttProvider).toBe("mock");
    expect(migrated.config.viewerCount).toBe(42);
  });

  it("handles downgrade/newer schema payload safely by sanitizing to current model", () => {
    const future = {
      schemaVersion: 99,
      config: {
        viewerCount: 18,
        capture: { sttProvider: "deepgram" },
        unknownFeature: true
      }
    };

    const migrated = migrateConfigPayload(future);
    expect(migrated.version).toBe(CURRENT_CONFIG_SCHEMA_VERSION);
    expect(migrated.config.viewerCount).toBe(18);
    expect(migrated.config.capture.sttProvider).toBe("deepgram");
  });
});
