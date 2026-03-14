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
- [ ] Banlist source-of-truth/versioning strategy
- [ ] Compliance/audit logging for EULA acceptance and version

### Audio / Input Intelligence
- [x] Audio mutual exclusion for TTS playback (pause mic ingest)
- [~] Voice/tone analysis loop (simulated tone values)
- [ ] Real microphone capture integration
- [ ] STT integration (Whisper.cpp/Deepgram or equivalent)
- [~] Vision tagging pipeline (mock periodic tags with interval controls)

### Chat Behavior Controls
- [x] Slow mode throughput cap
- [x] Emote-only mode message stripping + drop when no emotes
- [x] Stochastic jitter/burst timing model
- [~] Donation + TTS event generation

## 2) User Flow / Lifecycle (Boot Sequence + Runtime)

### Phase 1: Initialization
- [ ] Hardware profiling (VRAM/CPU/network)
- [ ] Logic tiering recommendations (high-tier local / low-tier cloud)
- [ ] One-click local sidecar orchestrator (install/start/pull model)
- [ ] First-run setup wizard and readiness checks
- [x] EULA gate before simulation starts

### Phase 2: Capture and Context
- [ ] Live mic frame capture and buffering
- [ ] STT transcript accumulation (last N seconds)
- [~] Tone signal available for pacing (currently mocked)
- [~] Vision capture every configured interval (mock scheduler implemented)
- [x] Context assembler for transcript + tone + vision tags (mock capture sources)

### Phase 3: Generation Pipeline
- [x] Prompt payload builder
- [~] Provider adapters for local/cloud inference (mock providers wired through adapter interface)
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

- [ ] End-to-end latency target: 2–3s under expected load (measured)
- [ ] Jank-free rendering at high throughput with explicit virtualization strategy
- [ ] Resource budget profiling under OBS + game + local LLM
- [ ] Reliability and auto-recovery from transient failures
- [ ] Structured pipeline observability logs
- [ ] Privacy-by-default validation (no frame persistence, opt-in diagnostics)

## 5) Error Handling & Recovery Strategy

### Inference
- [ ] Retry/backoff for local endpoint failures
- [ ] Cloud timeout/rate-limit retry + non-blocking warning UI
- [ ] Malformed JSON repair + regenerate fallback

### Audio
- [ ] Device disconnect rebind
- [ ] `is_tts_playing` watchdog reset for stale state

### Safety
- [ ] Conservative fallback mode when dictionary fails (emotes/system only)

### Sidecar
- [ ] Guided fallback from failed local sidecar startup to cloud
- [ ] Model pull progress/resume/cancel support

## 6) Security Controls

- [ ] Secrets in OS keychain (no plaintext keys)
- [ ] Localhost-only sidecar defaults with explicit override
- [ ] Redacted diagnostic exports
- [ ] Local compliance event log implementation

## 7) Acceptance Test Matrix Coverage

### Hybrid Routing
- [ ] Local mode routes to Ollama endpoint when available
- [ ] Seamless switch to cloud mode without restart

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
- [ ] Verified across themes/resolutions with automated checks

### Privacy Controls
- [ ] Vision frames not persisted by default (after vision implementation)
- [ ] Key material remains in secure keychain

## 8) Milestone Progress (from spec)

### Milestone 1 — Core Simulation Loop
- [~] Capture → STT → Prompt → Inference → Safety Filter → Render
  - Status: Render/filter/spool/control loop exists, but real capture/STT/provider inference are pending.

### Milestone 2 — Realism & Control
- [~] Tone-based scaling, stochastic spooling, donation/TTS, bias, slow mode, emote-only
  - Status: Mostly present in MVP form, with mocked tone + generator.

### Milestone 3 — Onboarding, Hardening, Compliance
- [ ] Tiering + one-click orchestrator + robust fallback + polished compliance gate

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
