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
if (ticks.length < 40) {
  console.error(`Not enough pipeline_tick events for realistic percentile gates: ${ticks.length}`);
  process.exit(1);
}

const latencies = ticks.map((event) => Number(event.latencyMs ?? 0)).sort((a, b) => a - b);
const jank = ticks.map((event) => Number(event.jankMs ?? 0)).sort((a, b) => a - b);
const percentile = (samples: number[], p: number): number => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))] ?? 0;

const p50Latency = percentile(latencies, 0.5);
const p95Latency = percentile(latencies, 0.95);
const p99Latency = percentile(latencies, 0.99);
const p95Jank = percentile(jank, 0.95);

const malformedDrops = events.filter((event) => event.event === "malformed_json_counter" && event.action === "drop").length;

if (p95Latency > 3000 || p99Latency > 4200) {
  console.error(`SLO failed: latency percentiles exceeded (p50=${p50Latency} p95=${p95Latency} p99=${p99Latency})`);
  process.exit(1);
}

if (p95Jank > 1200) {
  console.error(`Jank gate failed: p95 jank ${p95Jank}ms > 1200ms`);
  process.exit(1);
}

if (malformedDrops > 5) {
  console.error(`Quality gate failed: malformed drops ${malformedDrops} > 5`);
  process.exit(1);
}

console.log(`SLO pass: p50=${p50Latency}ms p95=${p95Latency}ms p99=${p99Latency}ms p95-jank=${p95Jank}ms malformed=${malformedDrops}`);
