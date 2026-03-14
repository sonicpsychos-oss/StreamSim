import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface BanlistRecord {
  version: string;
  source: string;
  updatedAt: string;
  terms: string[];
}

const fallback: BanlistRecord = {
  version: "2026.03.0",
  source: "bundled-default",
  updatedAt: "2026-03-01T00:00:00.000Z",
  terms: ["slur1", "slur2", "kill yourself", "self harm"]
};

const banlistPath = path.resolve(process.cwd(), "src/security/banlist-source-of-truth.json");

export function loadBanlist(): BanlistRecord {
  if (process.env.STREAMSIM_BANLIST_FORCE_FAIL === "1") throw new Error("forced banlist failure");
  try {
    const parsed = JSON.parse(fs.readFileSync(banlistPath, "utf8")) as BanlistRecord;
    if (!parsed.version || !Array.isArray(parsed.terms)) throw new Error("invalid banlist schema");
    return parsed;
  } catch {
    return fallback;
  }
}

export function writeBanlist(record: BanlistRecord): void {
  fs.mkdirSync(path.dirname(banlistPath), { recursive: true });
  fs.writeFileSync(banlistPath, JSON.stringify(record, null, 2));
}

export function banlistDiagnostics(record = loadBanlist()): { version: string; source: string; updatedAt: string; checksum: string; size: number } {
  const serialized = JSON.stringify(record.terms);
  const checksum = crypto.createHash("sha256").update(serialized).digest("hex").slice(0, 16);
  return {
    version: record.version,
    source: record.source,
    updatedAt: record.updatedAt,
    checksum,
    size: record.terms.length
  };
}
