# StreamSim System Component Map

The component map below groups concrete code modules into execution domains and shows how responsibilities are partitioned.

```mermaid
flowchart TB
  subgraph CLIENT[Client Surfaces]
    controlCenter[src/public/index.html + app.js\nControl Center]
    overlayView[src/public/overlay.html + overlay.js\nChat Overlay]
  end

  subgraph ENTRY[Service Entry]
    server[src/server.ts\nHTTP + SSE + orchestration endpoints]
  end

  subgraph CONFIG[Configuration & Policy]
    runtime[src/config/runtimeConfig.ts]
    store[src/config/configStore.ts]
    migrations[src/config/configMigrations.ts]
    compliance[src/services/complianceGate.ts + complianceLogger.ts]
    trace[src/services/nfrTraceGate.ts + readinessChecks.ts]
  end

  subgraph CAPTURE[Capture & Signal Processing]
    sttEngine[src/capture/sttEngine.ts]
    captureProviders[src/capture/captureProviders.ts]
    devicePipeline[src/capture/deviceCapturePipeline.ts]
    realism[src/llm/realismSignals.ts]
    dgIntelligence[src/services/intelligence/deepgramIntelligence.ts]
  end

  subgraph PIPELINE[Prompt / Context Pipeline]
    context[src/pipeline/contextAssembler.ts]
    prompt[src/pipeline/promptBuilder.ts]
    parser[src/pipeline/outputParser.ts]
  end

  subgraph INFERENCE[Inference Routing]
    factory[src/llm/providerFactory.ts]
    hybrid[src/llm/realInferenceProvider.ts\nHybrid local/cloud + retries]
    mock[src/llm/mockInferenceProvider.ts]
    audience[src/llm/mockAudienceGenerator.ts]
    sidecar[src/services/sidecarManager.ts]
  end

  subgraph RUNTIME[Simulation Runtime]
    orchestrator[src/services/simulationOrchestrator.ts]
    spool[src/services/spoolingEngine.ts]
    identity[src/services/identityManager.ts]
    tts[src/services/tts/textToSpeechService.ts + deepgramTTS.ts]
    audio[src/core/audioStateManager.ts]
    safety[src/core/safetyFilter.ts]
    observability[src/services/observability.ts + bootDiagnostics.ts]
    workload[src/services/workloadRunner.ts]
  end

  subgraph SECURITY[Security & Secrets]
    banlist[src/security/banlistRegistry.ts + banlist-source-of-truth.json]
    diagnostics[src/security/diagnostics.ts]
    secrets[src/security/secretStore.ts]
  end

  controlCenter --> server
  overlayView --> server

  server --> runtime
  server --> store
  store --> migrations
  runtime --> compliance
  runtime --> trace

  orchestrator --> captureProviders
  captureProviders --> sttEngine
  sttEngine --> devicePipeline
  devicePipeline --> realism
  devicePipeline --> dgIntelligence

  devicePipeline --> context
  context --> prompt
  prompt --> factory
  factory --> hybrid
  factory --> mock
  hybrid --> sidecar

  hybrid --> parser
  mock --> audience
  audience --> parser

  parser --> safety
  safety --> identity
  identity --> spool
  spool --> overlayView

  spool --> tts
  tts --> audio
  audio --> sttEngine

  runtime --> observability
  runtime --> workload

  identity --> banlist
  safety --> banlist
  orchestrator --> secrets
  secrets --> diagnostics
```

## Legend

- **Simulation Runtime**: Real-time control loop and post-inference shaping.
- **Capture & Signal Processing**: Raw multimodal ingestion + derived behavioral intelligence.
- **Inference Routing**: Abstraction layer that chooses local/cloud/mock providers.
- **Configuration & Policy**: Runtime config, migration, compliance, and release gates.
- **Security & Secrets**: Banlist governance and key handling.
