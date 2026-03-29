# StreamSim Architectural Diagram

This diagram captures the end-to-end runtime architecture across capture, intelligence, inference routing, safety, anti-echo/glaze controls, identity assignment, spooling, rendering, and observability.

```mermaid
flowchart LR
  %% External actors
  streamer([Streamer / Mic + Camera])
  viewerUI([Control Center UI])
  overlay([Overlay UI / OBS Capture])

  %% Runtime configuration + APIs
  subgraph API[Server & Runtime API Layer]
    server["server.ts<br/>Express + SSE"]
    configStore["Runtime Config<br/>configStore/runtimeConfig"]
    readiness["Readiness + Compliance + NFR gates"]
  end

  %% Core orchestration
  subgraph ORCH[Simulation Control Plane]
    orchestrator[SimulationOrchestrator]
    sidecar["SidecarManager<br/>Local model pull and control"]
    observability[ObservabilityLogger]
    audioState["AudioStateManager<br/>Anti-Echo deafen state"]
  end

  %% Capture and intelligence
  subgraph CAPTURE[Capture + Context Intelligence]
    stt[STT Engine + Providers]
    device["DeviceCapturePipeline<br/>rolling mic + vision buffers"]
    deepgramIntel["Deepgram Intelligence Mapper<br/>sentiment/topic/intent to vibe"]
    contextAsm[Context Assembler]
    promptBuilder[Prompt Builder]
  end

  %% Inference
  subgraph INFER[Hybrid Inference Plane]
    providerFactory[ProviderFactory]
    hybrid["HybridInferenceProvider<br/>local/cloud routing + retries"]
    localLLM[(Ollama / LM Studio)]
    cloudLLM[(OpenAI / Groq)]
    mockLLM[(Mock Provider)]
  end

  %% Post-inference and rendering
  subgraph RENDER[Safety + Persona Realism + Rendering]
    parser["Output Parser<br/>JSON recovery"]
    antiEcho[Anti-Echo + Read-Chat detection]
    glaze[Behavior diversity / anti-glaze rules]
    safety["Safety Filter<br/>banlist + compliance"]
    identity["Identity Manager<br/>safe username assignment"]
    spooler["Spooling Engine<br/>burst timing + pacing"]
    tts["TTS Service<br/>Deepgram TTS + playback"]
  end

  %% Primary flow
  streamer --> stt
  streamer --> device
  stt --> device
  device --> deepgramIntel
  deepgramIntel --> contextAsm
  device --> contextAsm
  contextAsm --> promptBuilder
  promptBuilder --> orchestrator

  viewerUI --> server
  server --> configStore
  configStore --> orchestrator
  readiness --> server

  orchestrator --> sidecar
  orchestrator --> providerFactory
  providerFactory --> hybrid
  hybrid --> localLLM
  hybrid --> cloudLLM
  hybrid --> mockLLM

  localLLM --> parser
  cloudLLM --> parser
  mockLLM --> parser

  parser --> antiEcho
  antiEcho --> glaze
  glaze --> safety
  safety --> identity
  identity --> spooler
  spooler --> overlay

  orchestrator --> observability
  stt -. deafen while TTS .-> audioState
  tts --> audioState
  audioState -. pause/resume .-> stt

  spooler --> tts
  tts --> overlay

  server --> overlay
  orchestrator --> server
```

## Flow Notes

1. **SimulationOrchestrator** is the control hub that drives loop timing, AI status, sidecar activity, and meta events.
2. **DeviceCapturePipeline + Deepgram Intelligence** enrich transcript/tone/vision with vibe/topic/intent signals.
3. **HybridInferenceProvider** performs model routing (local vs cloud), timeout-aware retries, and fallback candidate selection.
4. **Output hardening** then applies parser recovery, anti-echo constraints, anti-glaze/diversity rules, safety filtering, identity assignment, and stochastic spooling.
5. **AudioStateManager + TTS** enforce anti-feedback behavior so STT does not ingest generated playback.
