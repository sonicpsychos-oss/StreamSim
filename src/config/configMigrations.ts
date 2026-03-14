import { SimulationConfig } from "../core/types.js";
import { defaultConfig, sanitizeConfig } from "./runtimeConfig.js";

export const CURRENT_CONFIG_SCHEMA_VERSION = 2;

interface PersistedEnvelope {
  schemaVersion?: unknown;
  config?: unknown;
}

function migrateV1toV2(input: Record<string, unknown>): Record<string, unknown> {
  const capture = (input.capture ?? {}) as Record<string, unknown>;
  return {
    ...input,
    capture: {
      ...capture,
      sttProvider:
        capture.sttProvider === "mock" || capture.sttProvider === "whispercpp" || capture.sttProvider === "deepgram"
          ? capture.sttProvider
          : defaultConfig.capture.sttProvider
    }
  };
}

export function migrateConfigPayload(raw: unknown): { version: number; config: SimulationConfig } {
  const envelope = (typeof raw === "object" && raw !== null ? raw : {}) as PersistedEnvelope;
  const bare = (typeof envelope.config === "object" && envelope.config !== null ? envelope.config : raw) as Record<string, unknown>;
  let version = Number.isFinite(Number(envelope.schemaVersion)) ? Number(envelope.schemaVersion) : 1;
  let current = { ...bare };

  while (version < CURRENT_CONFIG_SCHEMA_VERSION) {
    if (version === 1) {
      current = migrateV1toV2(current);
    }
    version += 1;
  }

  return { version, config: sanitizeConfig(current) };
}

export function createPersistedEnvelope(config: SimulationConfig): { schemaVersion: number; updatedAt: string; config: SimulationConfig } {
  return {
    schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    config
  };
}
