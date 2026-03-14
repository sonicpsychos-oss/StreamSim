# StreamSim: The AI-Powered Gym for Content Creators 🎙️🚀

**Practice your stream before you go live.**

StreamSim creates a realistic “practice audience” that reacts to your voice, pacing, and on-camera presence in real time. Instead of rehearsing in silence, you can train in a safe environment that feels like a real channel: chat momentum, engagement spikes, awkward lulls, and moderation moments included.

Whether you’re a first-time streamer, a VTuber refining persona consistency, or a creator preparing a sponsored segment, StreamSim helps you build confidence and repeatable live-performance habits.

---

## Why StreamSim

Going live is a performance problem as much as a technical one. StreamSim is built to help you improve both.

### Creator outcomes
- **Reduce dead air** with realistic, continuous audience prompts.
- **Improve retention instincts** by practicing segment transitions and pacing.
- **Train moderation reflexes** with safety and guardrail simulations.
- **Build confidence faster** through repeatable “live-like” reps.

### Product capabilities
- Real-time audience simulation pipeline (capture → context → inference → filtering → spool).
- Web control center and overlay preview for rehearsal workflows.
- Reliability, compliance, and release-gating checks for safer iteration.

---

## Quickstart (5 minutes)

### 1) Install dependencies
```bash
npm install
```

### 2) Start development mode
```bash
npm run dev
```

### 3) Open the control center
Visit `http://localhost:4173` in your browser.

### 4) Start practicing
Use the control center to run a rehearsal and observe simulated audience reactions in the overlay preview.

---

## First rehearsal workflow (recommended)

Use this simple session structure to get immediate value:

1. **Warm-up (2 min):** Introduce your channel in one sentence.
2. **Hook practice (3 min):** Deliver your opening 30 seconds three times.
3. **Segment transition drill (5 min):** Move between topics without losing energy.
4. **Recovery drill (3 min):** Intentionally pause, then recover with confidence.
5. **Review (2 min):** Note where engagement dropped and iterate.

Tip: Keep sessions short and frequent. Daily 10–15 minute reps beat occasional long rehearsals.

---

## Repository purpose

This repository contains:
- The StreamSim service and web control center/overlay preview.
- Simulation pipeline components (capture, context assembly, inference adapters, safety filtering, and message spooling).
- Reliability/compliance/security hardening utilities and checks.
- Product and engineering documentation.

---

## Technical specs and scripts

### Runtime and stack
- Node.js + TypeScript (`type: module`)
- Express server for API/SSE transport
- Vitest test suite

### Core scripts
- `npm run dev` — start the development server.
- `npm run build` — compile TypeScript to `dist/`.
- `npm run start` — run the compiled server.
- `npm test` — run the Vitest suite.

### Quality and release gates
- `npm run ci:slo` — run SLO checks.
- `npm run ci:trace-gate` — run trace-gate checks against the realistic trace artifact.
- `npm run ci:release-checklist` — execute production release checklist assertions.
- `npm run ci:capture-traces` — capture reproducible NFR traces.

---

## Project layout

- `src/server.ts` — API + SSE entry point.
- `src/public/` — control center and overlay web UI.
- `src/services/` — orchestration, readiness, observability, compliance, and resilience services.
- `src/pipeline/` — context, prompt, and output parsing pipeline layers.
- `src/llm/` — inference providers and realism tuning.
- `src/capture/` — STT and vision capture integrations.
- `src/security/` — banlist/diagnostics/secret-store utilities.
- `src/config/` — runtime config schema, persistence, and migrations.
- `tests/` — integration and unit coverage.
- `docs/` — product specification and development checklist.

---

## Documentation

- Technical specification: [`docs/technical-spec.md`](docs/technical-spec.md)
- Development checklist: [`docs/development-checklist.md`](docs/development-checklist.md)
- Docs index: [`docs/README.md`](docs/README.md)

---

## Who this is for

- New creators who want structured practice before first stream.
- Existing streamers testing new formats, personas, or segment pacing.
- Teams shipping creator tools who need a repeatable simulation harness.

---

## Current status

StreamSim is an actively developed MVP with production-hardening checks in place (readiness checks, compliance gating, reliability tests, and NFR trace validation).

