import fs from "node:fs";
import path from "node:path";
import { WorkloadRunner } from "../src/services/workloadRunner.js";

const outDir = path.resolve(process.cwd(), "data/traces");
fs.mkdirSync(outDir, { recursive: true });

const runner = new WorkloadRunner();
const matrix = [
  { profile: "low" as const, seed: 1101 },
  { profile: "mid" as const, seed: 2202 },
  { profile: "high" as const, seed: 3303 }
];

const traces = matrix.map(({ profile, seed }) =>
  runner.captureTrace({
    name: "obs_game_local_model",
    hardwareClass: profile,
    ticks: 60,
    disconnectRate: 0.05,
    seed
  })
);

for (const trace of traces) {
  const filePath = path.join(outDir, `nfr-${trace.profile}-trace.json`);
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        generatedBy: "scripts/capture-nfr-traces.ts",
        ...trace
      },
      null,
      2
    )
  );
}

const baselinePath = path.join(outDir, "nfr-profile-baseline.json");
fs.writeFileSync(
  baselinePath,
  JSON.stringify(
    traces.map((trace) => ({
      profile: trace.profile,
      p95LatencyMs: trace.p95LatencyMs,
      avgCpuPressure: trace.avgCpuPressure,
      avgGpuPressure: trace.avgGpuPressure
    })),
    null,
    2
  )
);

console.log(`Wrote ${traces.length} reproducible profile traces to ${outDir}`);
