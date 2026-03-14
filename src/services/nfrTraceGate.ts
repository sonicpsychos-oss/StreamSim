export interface TraceSummary {
  profile: "low" | "mid" | "high";
  p95LatencyMs: number;
  avgCpuPressure: number;
  avgGpuPressure: number;
}

export interface TraceGateResult {
  pass: boolean;
  violations: string[];
}

function pctDelta(current: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return ((current - baseline) / baseline) * 100;
}

export function evaluateTraceAgainstBaseline(current: TraceSummary, baseline: TraceSummary): TraceGateResult {
  const violations: string[] = [];

  const latencyDelta = pctDelta(current.p95LatencyMs, baseline.p95LatencyMs);
  const cpuDelta = pctDelta(current.avgCpuPressure, baseline.avgCpuPressure);
  const gpuDelta = pctDelta(current.avgGpuPressure, baseline.avgGpuPressure);

  if (latencyDelta > 15) violations.push(`p95 latency regression ${latencyDelta.toFixed(1)}%`);
  if (cpuDelta > 20) violations.push(`cpu pressure regression ${cpuDelta.toFixed(1)}%`);
  if (gpuDelta > 20) violations.push(`gpu pressure regression ${gpuDelta.toFixed(1)}%`);

  return { pass: violations.length === 0, violations };
}
