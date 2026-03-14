import fs from "node:fs";
import path from "node:path";

const filePath = path.resolve(process.cwd(), "data/observability.log");
if (!fs.existsSync(filePath)) {
  console.error("observability.log missing");
  process.exit(1);
}

const events = fs
  .readFileSync(filePath, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Record<string, unknown>);

const ticks = events.filter((event) => event.event === "pipeline_tick");
if (ticks.length === 0) {
  console.error("No pipeline_tick events found");
  process.exit(1);
}

const avgLatency = ticks.reduce((sum, e) => sum + Number(e.latencyMs ?? 0), 0) / ticks.length;
const malformedDrops = events.filter((event) => event.event === "malformed_json_counter" && event.action === "drop").length;

if (avgLatency > 3000) {
  console.error(`SLO failed: avg latency ${avgLatency.toFixed(1)}ms > 3000ms`);
  process.exit(1);
}

if (malformedDrops > 5) {
  console.error(`Quality gate failed: malformed drops ${malformedDrops} > 5`);
  process.exit(1);
}

console.log(`SLO pass: avg latency ${avgLatency.toFixed(1)}ms, malformed drops ${malformedDrops}`);
