# StreamSim: The AI-Powered Gym for Content Creators. 🎙️🚀

Never stream to 0 viewers again. StreamSim generates a hyper-realistic, real-time simulated audience that hears your voice, sees your camera, and reacts to your energy. Built for aspiring streamers and VOD creators who want to master "dead air," practice crowd control, and build on-camera charisma before going live.

## What this repository contains
- Product/architecture specification: [`docs/technical-spec.md`](docs/technical-spec.md)
- Development checklist: [`docs/development-checklist.md`](docs/development-checklist.md)
- Working MVP application scaffold implementing core simulation logic + dashboard/overlay preview

## Implemented in this milestone
- **Spooling Engine** with engagement-decay math, jitter, energy scaling, and Slow Mode override.
- **Safety pre-render filter** that drops disallowed text.
- **AudioStateManager** for TTS/mic mutual exclusion behavior.
- **Simulation orchestrator** that binds config + tone sampling + mock audience generation.
- **Control Center + Overlay preview UI** (dark themed) with immutable watermark.
- **SSE event stream API** for near-real-time overlay updates.

## Quick start
```bash
npm install
npm run dev
```

Then open `http://localhost:4173`.

## Vision
StreamSim simulates realistic audience behavior (chat, reactions, donation/TTS events) from multimodal context (voice/tone + periodic vision tags), while enforcing local pre-render safety constraints and a compliance-oriented simulation watermark.
