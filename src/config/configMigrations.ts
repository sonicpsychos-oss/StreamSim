import { SimulationConfig } from "../core/types.js";
import { defaultConfig, sanitizeConfig } from "./runtimeConfig.js";

export const CURRENT_CONFIG_SCHEMA_VERSION = 6;

interface PersistedEnvelope {
  schemaVersion?: unknown;
  config?: unknown;
}

type MigrationFn = (input: Record<string, unknown>) => Record<string, unknown>;

function migrateV1toV2(input: Record<string, unknown>): Record<string, unknown> {
  const capture = (input.capture ?? {}) as Record<string, unknown>;
  return {
    ...input,
    capture: {
      ...capture,
      sttProvider:
        capture.sttProvider === "mock" ||
        capture.sttProvider === "local-whisper" ||
        capture.sttProvider === "whispercpp" ||
        capture.sttProvider === "deepgram" ||
        capture.sttProvider === "openai-whisper" ||
        capture.sttProvider === "gpt-4o-mini-transcribe"
          ? capture.sttProvider
          : defaultConfig.capture.sttProvider
    }
  };
}


function migrateV2toV3(input: Record<string, unknown>): Record<string, unknown> {
  const safety = (input.safety ?? {}) as Record<string, unknown>;
  return {
    ...input,
    safety: {
      ...safety,
      dropPolicy: safety.dropPolicy === "censor" || safety.dropPolicy === "drop" ? safety.dropPolicy : defaultConfig.safety.dropPolicy
    }
  };
}


function migrateV3toV4(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...input,
    ttsMode: input.ttsMode === "off" || input.ttsMode === "local" || input.ttsMode === "cloud" ? input.ttsMode : defaultConfig.ttsMode
  };
}

const migrationRegistry: Record<number, MigrationFn> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: (input) => ({
    ...input,
    audioIntelligence: typeof input.audioIntelligence === "object" && input.audioIntelligence !== null ? input.audioIntelligence : defaultConfig.audioIntelligence
  }),
  5: (input) => ({
    ...input,
    ttsProvider:
      input.ttsProvider === "local" || input.ttsProvider === "openai" || input.ttsProvider === "deepgram_aura"
        ? input.ttsProvider
        : defaultConfig.ttsProvider
  })
};

function normalizeVersion(version: unknown): number {
  const numeric = Number(version);
  if (!Number.isFinite(numeric)) return 1;
  if (numeric < 1) return 1;
  return Math.floor(numeric);
}

export function migrateConfigPayload(raw: unknown): { version: number; config: SimulationConfig } {
  const envelope = (typeof raw === "object" && raw !== null ? raw : {}) as PersistedEnvelope;
  const bare = (typeof envelope.config === "object" && envelope.config !== null ? envelope.config : raw) as Record<string, unknown>;
  let version = normalizeVersion(envelope.schemaVersion);
  let current = { ...bare };

  if (version > CURRENT_CONFIG_SCHEMA_VERSION) {
    return { version: CURRENT_CONFIG_SCHEMA_VERSION, config: sanitizeConfig(current) };
  }

  while (version < CURRENT_CONFIG_SCHEMA_VERSION) {
    const migration = migrationRegistry[version];
    if (!migration) break;
    current = migration(current);
    version += 1;
  }

  return { version: CURRENT_CONFIG_SCHEMA_VERSION, config: sanitizeConfig(current) };
}

export function createPersistedEnvelope(config: SimulationConfig): { schemaVersion: number; updatedAt: string; config: SimulationConfig } {
  return {
    schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    config
  };
}
