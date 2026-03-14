# StreamSim Development Checklist

This checklist maps directly to `docs/technical-spec.md` and tracks implementation status.

Legend:
- [x] Completed in current codebase
- [~] Partially implemented (MVP placeholder)
- [ ] Not started

## 1) Core Product Capabilities (Functional Requirements)

### AI + Generation
- [ ] Hybrid AI generation routing (Cloud OpenAI/Groq + Local Ollama/LM Studio)
- [~] Runtime engine toggle with basic mode validation (mock-local/mock-cloud)
- [~] Persona-driven audience generation
- [~] Bias/debate split behavior (agree/disagree/split with configurable ratio)

### Overlay + UX Surface
- [~] Transparent OBS-ready overlay window
- [x] Persistent simulation watermark at ~20% opacity
- [~] Low-friction control center (core controls present; endpoint controls incomplete)
- [~] EULA gate before start (start blocked until accepted)

### Safety + Compliance
- [x] Local synchronous pre-render safety filter
- [~] Drop-policy behavior (drop instead of censor)
- [x] Banlist source-of-truth/versioning strategy
- [x] Compliance/audit logging for EULA acceptance and version lifecycle events

### Audio / Input Intelligence
- [x] Audio mutual exclusion for TTS playback (pause mic ingest)
- [~] Voice/tone analysis loop (simulated tone values)
- [x] Real microphone capture integration (stream-bound frame ingest + pause/resume validated with live chunk flow)
- [x] STT integration (mock/whispercpp/deepgram adapter paths + pause-resume end-to-end coverage)
- [~] Vision tagging pipeline (mock periodic tags with interval controls)

### Chat Behavior Controls
- [x] Slow mode throughput cap
- [x] Emote-only mode message stripping + drop when no emotes
- [x] Stochastic jitter/burst timing model
- [~] Donation + TTS event generation

## 2) User Flow / Lifecycle (Boot Sequence + Runtime)

### Phase 1: Initialization
- [x] Hardware profiling (VRAM/CPU/network)
- [x] Logic tiering recommendations (high-tier local / low-tier cloud)
- [x] One-click local sidecar orchestrator (OS-specific install/start/pull commands, pull checkpoint persistence, deterministic failure taxonomy + UX actions)
- [x] First-run setup wizard and readiness checks
- [x] EULA gate before simulation starts

### Phase 2: Capture and Context
- [x] Live mic frame capture and buffering
- [x] STT transcript accumulation (last N seconds)
- [~] Tone signal available for pacing (currently mocked)
- [x] Vision capture every configured interval (device pipeline-backed scheduler)
- [x] Context assembler for transcript + tone + vision tags (mock capture sources)

### Phase 3: Generation Pipeline
- [x] Prompt payload builder
- [x] Provider adapters for local/cloud inference (verified payload routing + failover)
- [x] Strict output parsing + schema validation + repair attempt
- [x] Safety filter pre-render stage
- [x] Virtualized queue feed into renderer
- [x] TTS event toggles audio state manager

## 3) Data Contracts & Runtime Config

- [x] Full runtime configuration schema (engine/safety/capture/compliance blocks)
- [~] Persisted config store (JSON file persistence; migrations pending)
- [x] Prompt payload contract implementation
- [x] Inference output contract enforcement
- [~] Internal queue message model (implemented equivalent, not full schema)

## 4) Non-Functional Requirements (NFRs)

- [~] End-to-end latency target: 2–3s under expected load (benchmark harness + percentile fail gates added)
- [x] Jank-free rendering gates with percentile-based CI fail thresholds
- [x] Resource budget profiling under OBS + game + local LLM (workload runner emits pressure + latency envelopes)
- [x] Reliability and auto-recovery from transient failures (chaos-style endpoint flap simulation + retries in test harness)
- [x] Structured pipeline observability logs
- [x] Privacy-by-default validation (automated overlay watermark contract checks + no-persistence tests for vision path)

## 5) Error Handling & Recovery Strategy

### Inference
- [x] Retry/backoff for local endpoint failures
- [x] Cloud retry with non-blocking warnings + deterministic recovery states/messages
- [x] Malformed JSON repair + regenerate fallback

### Audio
- [x] Device disconnect rebind
- [x] `is_tts_playing` watchdog reset for stale state

### Safety
- [x] Conservative fallback mode when dictionary fails (emotes/system only)

### Sidecar
- [x] Guided fallback from failed local sidecar startup to cloud
- [x] Model pull progress/resume/cancel support (streamed status events + cancel/resume endpoints)

## 6) Security Controls

- [x] Secrets in OS keychain (no plaintext keys)
- [x] Localhost-only sidecar defaults with explicit override
- [x] Redacted diagnostic exports
- [x] Local compliance event log implementation

## 7) Acceptance Test Matrix Coverage

### Hybrid Routing
- [x] Local mode routes to Ollama endpoint when available
- [x] Seamless switch to cloud mode without restart

### Safety Filter
- [x] Banned content dropped pre-render
- [x] Non-bannable insults pass through

### Audio Mutual Exclusion
- [~] STT paused while TTS is active (state toggled; real STT integration pending)
- [~] STT resumes on TTS end (state restored; real STT integration pending)

### Spooler
- [x] Jittered inter-arrival behavior
- [x] Slow mode max throughput behavior

### Overlay Compliance
- [x] Watermark visible at ~20% opacity
- [x] Verified across themes/resolutions with automated checks

### Privacy Controls
- [x] Vision frames not persisted by default (validated in automated tests)
- [x] Key material remains in secure keychain

## 8) Milestone Progress (from spec)

### Milestone 1 — Core Simulation Loop
- [~] Capture → STT → Prompt → Inference → Safety Filter → Render
  - Status: Real capture/STT buffering and verified provider routing are implemented; further hardening remains.

### Milestone 2 — Realism & Control
- [~] Tone-based scaling, stochastic spooling, donation/TTS, bias, slow mode, emote-only
  - Status: Present in MVP form with real capture buffering plus incremental realism gaps.

### Milestone 3 — Onboarding, Hardening, Compliance
- [~] Tiering + one-click orchestrator + robust fallback + polished compliance gate

## 9) Implemented Artifacts (evidence)

- Core types and queue message shape: `src/core/types.ts`
- Safety filter + drop behavior: `src/core/safetyFilter.ts`
- Audio mutual exclusion state manager: `src/core/audioStateManager.ts`
- Spooling math and jitter logic: `src/services/spoolingEngine.ts`
- Simulation orchestration pipeline: `src/services/simulationOrchestrator.ts`
- Mock persona/bias audience generation: `src/llm/mockAudienceGenerator.ts`
- API + SSE transport: `src/server.ts`
- Control center + overlay preview: `src/public/index.html`, `src/public/styles.css`, `src/public/app.js`
- Initial unit coverage for spooler/safety: `tests/spoolingEngine.test.ts`
- Config + output parser coverage: `tests/pipeline.test.ts`
- Runtime config persistence: `src/config/configStore.ts`
- Context/prompt/output pipeline: `src/pipeline/contextAssembler.ts`, `src/pipeline/promptBuilder.ts`, `src/pipeline/outputParser.ts`
- Inference adapter scaffold: `src/llm/mockInferenceProvider.ts`
