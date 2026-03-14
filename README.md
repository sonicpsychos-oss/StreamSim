# StreamSim

StreamSim is a local-first simulation control center for testing creator workflows with a synthetic audience stream.

## Repository purpose
This repository contains:
- The StreamSim service and web control center/overlay preview.
- Simulation pipeline components (capture, context assembly, inference adapters, safety filtering, and message spooling).
- Reliability/compliance/security hardening utilities and checks.
- Product and engineering documentation.

## Quick start
```bash
npm install
npm run dev
```

Open `http://localhost:4173`.

## Scripts
- `npm run dev` — start the development server.
- `npm run build` — compile TypeScript to `dist/`.
- `npm test` — run the Vitest suite.
- `npm run ci:slo` — run SLO checks.
- `npm run ci:trace-gate` — run trace-gate checks against the realistic trace artifact.
- `npm run ci:release-checklist` — execute production release checklist assertions.
- `npm run ci:capture-traces` — capture reproducible NFR traces.

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

## Documentation
- Technical specification: [`docs/technical-spec.md`](docs/technical-spec.md)
- Development checklist: [`docs/development-checklist.md`](docs/development-checklist.md)
- Docs index: [`docs/README.md`](docs/README.md)

## Current status
The repository is an actively developed MVP with production-hardening checks in place (readiness checks, compliance gating, reliability tests, and NFR trace validation).
