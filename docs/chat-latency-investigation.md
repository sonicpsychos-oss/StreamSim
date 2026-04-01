# Chat Latency Investigation (2026-04-01)

## Symptoms observed
- Chat appears to "drip" all messages, then waits before next generation cycle.
- End-to-end responsiveness feels slower than expected under live capture + vision.

## Likely bottlenecks in current code path

1. **Per-tick health probes in the hot loop**
   - `SimulationOrchestrator.loop()` performs both `sidecar.ensureReady(config)` and `provider.healthCheck(config)` every tick before generation.
   - These checks trigger network and/or sidecar operations that add avoidable latency in steady-state.

2. **Strict serial loop (capture -> infer -> safety -> emit -> wait)**
   - Next loop tick is only scheduled after inference and post-processing complete.
   - During this idle gap, already-emitted batch messages continue dripping, creating visible "all messages drained while waiting" behavior.

3. **Small batch size cap**
   - `requestedMessageCount` is currently capped at 11 messages (`Math.max(5, Math.min(11, ...))`).
   - For high activity this increases inference frequency and request overhead.

4. **Very verbose logging on every inference/vision tick**
   - Raw inference output and vision provider responses are logged each tick.
   - This can increase CPU and I/O pressure, especially with large payloads.

5. **Meta payload size over SSE**
   - Full `queueMessages` arrays are emitted in orchestrator meta events and only trimmed client-side.
   - This can inflate event-stream bandwidth and JSON parse costs.

6. **Vision polling competes for cloud budget**
   - Vision polling can run every 7 seconds by default, and OpenAI vision calls can take up to 5-15s timeout windows.
   - Even though separate from the main loop, this can contend on cloud quotas/rate limits and produce indirect slowdowns.

## Recommended solutions (prioritized)

### P0: Remove expensive checks from every tick
- Cache provider health for a TTL (e.g., 30-60s), or run checks only:
  - on simulation start,
  - when config changes,
  - after a generation failure.
- For sidecar readiness: perform once at start / mode-switch instead of each loop cycle.

**Expected impact:** immediate latency reduction and fewer avoidable network roundtrips.

### P0: Decouple inference scheduling from drip rendering
- Keep a small prefetch queue of generated safe messages.
- Start next inference when queue drops below a low-watermark, not after a full tick sleep.
- Continue drip rendering independently from queue contents.

**Expected impact:** removes visible dead-air between batches; smoother continuous chat flow.

### P1: Increase/adapt batch size with viewer count + latency budget
- Raise cap beyond 11 (e.g., 20-40 for high viewerCount).
- Use adaptive batching:
  - if p95 inference latency is high, increase batch size and lower call frequency,
  - if latency is low, keep smaller batches for freshness.

**Expected impact:** fewer provider calls and better throughput under load.

### P1: Gate verbose logs behind debug flags
- Only log raw inference payloads/responses in diagnostics mode.
- Default to concise counters/latency summaries in production runtime.

**Expected impact:** reduced CPU + stdout overhead and cleaner observability.

### P1: Trim SSE meta payload at source
- Send queue previews (top N) from server instead of full `queueMessages`.
- Omit large nested provider responses unless diagnostics explicitly enabled.

**Expected impact:** lower serialization/deserialization overhead and less UI event-stream pressure.

### P2: Vision/inference resource isolation
- Add configurable vision backoff when inference latency exceeds threshold.
- Optionally pause vision calls while inference retries/fallback are active.

**Expected impact:** lower cloud contention and more predictable inference responsiveness.

## Validation plan
1. Add per-stage timing metrics (already partially available) and report p50/p95 for:
   - sidecar-ready checks,
   - health checks,
   - capture,
   - inference,
   - render queue fill level.
2. Run A/B traces with:
   - current behavior,
   - cached checks + queue prefetch + trimmed meta.
3. Compare:
   - p95 end-to-end latency,
   - average dead-air interval between message batches,
   - SSE bytes/sec,
   - provider request rate.
