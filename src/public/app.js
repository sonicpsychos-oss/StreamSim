const chatEl = document.getElementById("chat");
const metaEl = document.getElementById("meta");
const readinessList = document.getElementById("readinessList");
const diagnosticsSummary = document.getElementById("diagnosticsSummary");
const statusBanner = document.getElementById("statusBanner");
const runtimeSummary = document.getElementById("runtimeSummary");
const deviceChecks = document.getElementById("deviceChecks");
const aiHealthSummary = document.getElementById("aiHealthSummary");
const aiActiveModelLabel = document.getElementById("aiActiveModelLabel");
const ttsHealthSummary = document.getElementById("ttsHealthSummary");
const sttHealthSummary = document.getElementById("sttHealthSummary");
const apiKeyHealthSummary = document.getElementById("apiKeyHealthSummary");
const visionHealthSummary = document.getElementById("visionHealthSummary");
const liveMonitorEnabled = document.getElementById("liveMonitorEnabled");
const liveMonitorStatus = document.getElementById("liveMonitorStatus");
const liveVideo = document.getElementById("liveVideo");
const voiceMeter = document.getElementById("voiceMeter");
const sttCaptionStatus = document.getElementById("sttCaptionStatus");
const sttCaptionPreview = document.getElementById("sttCaptionPreview");

let liveMonitorStream = null;
let liveMonitorAudioContext = null;
let liveMonitorMeterInterval = null;
let liveMonitorVisionInterval = null;
let liveMonitorVisionCanvas = null;
let micCheckStream = null;
let micCheckAudioContext = null;
let micCheckMeterInterval = null;
let micCheckDataInterval = null;
let micCheckSource = null;
let micCheckAnalyser = null;
let micCheckProcessor = null;
let micCheckQueuedPcm = [];
let micCheckProbeInFlight = false;
let latestCaptionText = "";
let latestStatusPayload = null;
let simulationActionInFlight = false;
let latestDeviceVerification = {
  micPermission: false,
  cameraPermission: false,
  hasMicDevice: false,
  hasCameraDevice: false,
  cameraPermissionState: "unknown",
  cameraFailureReason: null
};

const MIC_CHECK_PROBE_SECONDS = 3.5;
const MIC_CHECK_BUFFER_SECONDS = 8;
const MIC_CHECK_MIN_SAMPLES = 12000;
const CAMERA_FRAME_CONFIRM_TIMEOUT_MS = 3000;
const LIVE_MONITOR_VISION_SAMPLE_MS = 4000;
const STT_DEFAULT_ENDPOINTS = {
  "local-whisper": "http://127.0.0.1:7778/stt",
  whispercpp: "http://127.0.0.1:7778/stt",
  deepgram: "https://api.deepgram.com/v1/listen?model=nova-3&language=en-US&smart_format=true&filler_words=true&punctuate=true&sentiment=true&topics=true&intents=true&utterance_end_ms=3000",
  "openai-whisper": "https://api.openai.com/v1/audio/transcriptions",
  "gpt-4o-mini-transcribe": "https://api.openai.com/v1/audio/transcriptions",
  mock: "http://127.0.0.1:7778/stt"
};

const controls = {
  viewerCount: document.getElementById("viewerCount"),
  engagementMultiplier: document.getElementById("engagementMultiplier"),
  donationFrequency: document.getElementById("donationFrequency"),
  persona: document.getElementById("persona"),
  bias: document.getElementById("bias"),
  inferenceMode: document.getElementById("inferenceMode"),
  localEndpoint: document.getElementById("localEndpoint"),
  localModel: document.getElementById("localModel"),
  cloudEndpoint: document.getElementById("cloudEndpoint"),
  cloudModel: document.getElementById("cloudModel"),
  requestTimeoutMs: document.getElementById("requestTimeoutMs"),
  maxRetries: document.getElementById("maxRetries"),
  dropPolicy: document.getElementById("dropPolicy"),
  cloudApiKey: document.getElementById("cloudApiKey"),
  deepgramApiKey: document.getElementById("deepgramApiKey"),
  slowMode: document.getElementById("slowMode"),
  emoteOnly: document.getElementById("emoteOnly"),
  ttsEnabled: document.getElementById("ttsEnabled"),
  ttsMode: document.getElementById("ttsMode"),
  ttsProvider: document.getElementById("ttsProvider"),
  visionEnabled: document.getElementById("visionEnabled"),
  visionProvider: document.getElementById("visionProvider"),
  useRealCapture: document.getElementById("useRealCapture"),
  visionIntervalSec: document.getElementById("visionIntervalSec"),
  sttProvider: document.getElementById("sttProvider"),
  sttEndpoint: document.getElementById("sttEndpoint"),
  visionEndpoint: document.getElementById("visionEndpoint"),
  audioIntelligenceEnabled: document.getElementById("audioIntelligenceEnabled"),
  allowDiagnostics: document.getElementById("allowDiagnostics"),
  allowNonLocalSidecarOverride: document.getElementById("allowNonLocalSidecarOverride"),
  overrideReason: document.getElementById("overrideReason"),
  eulaAccepted: document.getElementById("eulaAccepted")
};

function setStatus(message, tone = "success") {
  statusBanner.textContent = message;
  statusBanner.classList.remove("success", "warn", "error");
  statusBanner.classList.add(tone);
}

function setLiveMonitorStatus(message, tone = "warn") {
  if (!liveMonitorStatus) return;
  liveMonitorStatus.textContent = message;
  liveMonitorStatus.classList.remove("ok", "warn", "error");
  liveMonitorStatus.classList.add(tone);
}

function setCaptionStatus(message, tone = "warn") {
  if (!sttCaptionStatus) return;
  sttCaptionStatus.textContent = message;
  sttCaptionStatus.classList.remove("ok", "warn", "error");
  sttCaptionStatus.classList.add(tone);
}

function setCaptionPreview(text) {
  if (!sttCaptionPreview) return;
  sttCaptionPreview.textContent = text?.trim() || "No speech captured yet.";
}

function encodePcm16Wav(samples, sampleRate) {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirmCameraFrames(stream) {
  const primaryTrack = stream.getVideoTracks()[0];
  if (!primaryTrack) {
    throw new Error("Camera stream did not include a video track.");
  }

  const probeVideo = document.createElement("video");
  probeVideo.autoplay = true;
  probeVideo.muted = true;
  probeVideo.playsInline = true;
  probeVideo.srcObject = stream;

  try {
    await probeVideo.play().catch(() => {});
    const frameObserved = await Promise.race([
      new Promise((resolve) => {
        probeVideo.onloadeddata = () => resolve(true);
        probeVideo.oncanplay = () => resolve(true);
        probeVideo.onplaying = () => resolve(true);
        if (typeof probeVideo.requestVideoFrameCallback === "function") {
          probeVideo.requestVideoFrameCallback(() => resolve(true));
        }
      }),
      (async () => {
        await wait(CAMERA_FRAME_CONFIRM_TIMEOUT_MS);
        return false;
      })()
    ]);

    if (frameObserved) return;
    if (primaryTrack.readyState === "live") return;
    throw new Error("Camera stream became inactive before frame confirmation.");
  } finally {
    probeVideo.pause();
    probeVideo.srcObject = null;
  }
}

async function probeSttFromMicChunk() {
  if (micCheckProbeInFlight || micCheckQueuedPcm.length < MIC_CHECK_MIN_SAMPLES) return;

  const sampleRate = micCheckAudioContext?.sampleRate ?? 44100;
  const clipSize = Math.min(micCheckQueuedPcm.length, Math.floor(sampleRate * MIC_CHECK_PROBE_SECONDS));
  const clip = micCheckQueuedPcm.slice(-clipSize);
  micCheckQueuedPcm = micCheckQueuedPcm.slice(-Math.floor(sampleRate * MIC_CHECK_BUFFER_SECONDS));

  const wav = encodePcm16Wav(clip, sampleRate);
  const audioBase64 = arrayBufferToBase64(wav);

  micCheckProbeInFlight = true;
  try {
    const result = await post("/api/stt/probe", {
      audioBase64,
      provider: controls.sttProvider.value,
      endpoint: controls.sttEndpoint.value
    });

    const transcript = (result?.transcript ?? "").trim();
    if (transcript) {
      const rms = Math.min(1, Math.max(0.05, Math.sqrt(clip.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, clip.length))));
      const words = transcript.split(/\s+/).filter(Boolean).length;
      const clipDurationSec = Math.max(1, clip.length / Math.max(1, sampleRate));
      const wordsPerMinute = Math.max(70, Math.min(220, Math.round((words / clipDurationSec) * 60)));
      await post("/api/capture/mic-frame", { transcriptChunk: transcript, rms, wordsPerMinute });
      latestCaptionText = transcript;
      setCaptionPreview(transcript);
    }
    setCaptionStatus(`Mic stream active · STT(${result.provider}) ${transcript ? "captured transcript" : "reachable; waiting for speech"}.`, "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setCaptionStatus(`Mic stream active but STT probe failed: ${message}`, "error");
  } finally {
    micCheckProbeInFlight = false;
  }
}

function drawVoiceMeter(level) {
  if (!voiceMeter) return;
  const ctx = voiceMeter.getContext("2d");
  if (!ctx) return;
  const width = voiceMeter.width;
  const height = voiceMeter.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, width, height);
  const meterWidth = Math.max(2, Math.floor(level * width));
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#22c55e");
  gradient.addColorStop(0.7, "#eab308");
  gradient.addColorStop(1, "#ef4444");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, meterWidth, height);
  ctx.strokeStyle = "#334155";
  ctx.strokeRect(0, 0, width, height);
}

function stopMicVerificationCheck() {
  if (micCheckMeterInterval) {
    clearInterval(micCheckMeterInterval);
    micCheckMeterInterval = null;
  }
  if (micCheckDataInterval) {
    clearInterval(micCheckDataInterval);
    micCheckDataInterval = null;
  }
  if (micCheckProcessor) {
    micCheckProcessor.onaudioprocess = null;
    micCheckProcessor.disconnect();
    micCheckProcessor = null;
  }
  if (micCheckAnalyser) {
    micCheckAnalyser.disconnect();
    micCheckAnalyser = null;
  }
  if (micCheckSource) {
    micCheckSource.disconnect();
    micCheckSource = null;
  }
  if (micCheckAudioContext) {
    void micCheckAudioContext.close();
    micCheckAudioContext = null;
  }
  if (micCheckStream) {
    micCheckStream.getTracks().forEach((track) => track.stop());
    micCheckStream = null;
  }
  micCheckQueuedPcm = [];
  micCheckProbeInFlight = false;
}

async function startMicVerificationCheck() {
  stopMicVerificationCheck();
  if (!navigator.mediaDevices?.getUserMedia) {
    setCaptionStatus("Browser does not support microphone verification stream.", "error");
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  micCheckStream = stream;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    setCaptionStatus("Microphone granted, but AudioContext is unavailable in this browser.", "warn");
    return;
  }

  micCheckAudioContext = new AudioContextCtor();
  const source = micCheckAudioContext.createMediaStreamSource(stream);
  const analyser = micCheckAudioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  micCheckSource = source;
  micCheckAnalyser = analyser;

  const processor = micCheckAudioContext.createScriptProcessor(4096, 1, 1);
  source.connect(processor);
  processor.connect(micCheckAudioContext.destination);
  micCheckProcessor = processor;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    micCheckQueuedPcm.push(...input);
    const maxSamples = Math.floor((micCheckAudioContext?.sampleRate ?? 44100) * MIC_CHECK_BUFFER_SECONDS);
    if (micCheckQueuedPcm.length > maxSamples) {
      micCheckQueuedPcm = micCheckQueuedPcm.slice(-maxSamples);
    }
  };

  const samples = new Uint8Array(analyser.frequencyBinCount);
  micCheckMeterInterval = setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const centered = (samples[i] - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / samples.length);
    drawVoiceMeter(Math.min(1, rms * 3.2));
  }, 80);

  micCheckDataInterval = setInterval(() => {
    void probeSttFromMicChunk();
  }, 3200);

  setCaptionStatus("Mic stream active. Speak naturally for a few seconds to verify sentence-level STT.", "ok");
  setCaptionPreview(latestCaptionText || "Listening for speech...");
}

function stopLiveMonitor() {
  if (liveMonitorMeterInterval) {
    clearInterval(liveMonitorMeterInterval);
    liveMonitorMeterInterval = null;
  }
  if (liveMonitorAudioContext) {
    void liveMonitorAudioContext.close();
    liveMonitorAudioContext = null;
  }
  if (liveMonitorVisionInterval) {
    clearInterval(liveMonitorVisionInterval);
    liveMonitorVisionInterval = null;
  }
  if (liveMonitorStream) {
    liveMonitorStream.getTracks().forEach((track) => track.stop());
    liveMonitorStream = null;
  }
  liveMonitorVisionCanvas = null;
  if (liveVideo) liveVideo.srcObject = null;
  drawVoiceMeter(0);
  setLiveMonitorStatus("Live monitor disabled.", "warn");
}

async function pushLiveVisionSample() {
  if (!liveVideo || !liveMonitorStream) return;
  const width = Math.max(320, liveVideo.videoWidth || 640);
  const height = Math.max(180, liveVideo.videoHeight || 360);
  if (!liveMonitorVisionCanvas) {
    liveMonitorVisionCanvas = document.createElement("canvas");
  }
  liveMonitorVisionCanvas.width = width;
  liveMonitorVisionCanvas.height = height;
  const ctx = liveMonitorVisionCanvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(liveVideo, 0, 0, width, height);
  const dataUrl = liveMonitorVisionCanvas.toDataURL("image/jpeg", 0.72);
  await post("/api/capture/vision-sample", { dataUrl });
}

async function startLiveMonitor() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Browser does not support getUserMedia for live monitor.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  liveMonitorStream = stream;
  if (liveVideo) liveVideo.srcObject = stream;

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    setLiveMonitorStatus("Camera is live (voice meter unavailable in this browser).", "warn");
    return true;
  }

  liveMonitorAudioContext = new AudioContextCtor();
  const source = liveMonitorAudioContext.createMediaStreamSource(stream);
  const analyser = liveMonitorAudioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.frequencyBinCount);

  liveMonitorMeterInterval = setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const centered = (samples[i] - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / samples.length);
    drawVoiceMeter(Math.min(1, rms * 3.2));
  }, 90);
  liveMonitorVisionInterval = setInterval(() => {
    void pushLiveVisionSample();
  }, LIVE_MONITOR_VISION_SAMPLE_MS);
  void pushLiveVisionSample();

  setLiveMonitorStatus("Camera and microphone active for live monitor.", "ok");
  return true;
}

function setPending(button, isPending) {
  if (!button) return;
  button.disabled = isPending;
}

function setSimulationActionPending(isPending) {
  simulationActionInFlight = isPending;
  if (startBtn) startBtn.disabled = isPending;
  if (stopBtn) stopBtn.disabled = isPending;
}

async function runAction({ button, pendingText, successText, onRun }) {
  try {
    setPending(button, true);
    if (pendingText) setStatus(pendingText, "warn");
    const result = await onRun();
    if (successText) setStatus(successText, "success");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    metaEl.textContent = message;
    return undefined;
  } finally {
    setPending(button, false);
  }
}

function getPayload() {
  return {
    viewerCount: Number(controls.viewerCount.value),
    engagementMultiplier: Number(controls.engagementMultiplier.value),
    donationFrequency: Number(controls.donationFrequency.value),
    persona: controls.persona.value,
    bias: controls.bias.value,
    inferenceMode: controls.inferenceMode.value,
    slowMode: controls.slowMode.checked,
    emoteOnly: controls.emoteOnly.checked,
    ttsEnabled: controls.ttsEnabled.checked,
    ttsMode: controls.ttsMode.value,
    ttsProvider: controls.ttsProvider.value,
    capture: {
      visionEnabled: controls.visionEnabled.checked,
      visionProvider: controls.visionProvider.value,
      useRealCapture: controls.useRealCapture.checked,
      visionIntervalSec: Number(controls.visionIntervalSec.value),
      sttProvider: controls.sttProvider.value,
      sttEndpoint: controls.sttEndpoint.value,
      visionEndpoint: controls.visionEndpoint.value
    },
    audioIntelligence: {
      enabled: controls.audioIntelligenceEnabled.checked
    },
    provider: {
      localEndpoint: controls.localEndpoint.value,
      localModel: controls.localModel.value,
      cloudEndpoint: controls.cloudEndpoint.value,
      cloudModel: controls.cloudModel.value,
      requestTimeoutMs: Number(controls.requestTimeoutMs.value),
      maxRetries: Number(controls.maxRetries.value)
    },
    safety: {
      dropPolicy: controls.dropPolicy.value
    },
    compliance: {
      eulaAccepted: controls.eulaAccepted.checked
    },
    security: {
      allowDiagnostics: controls.allowDiagnostics.checked,
      allowNonLocalSidecarOverride: controls.allowNonLocalSidecarOverride.checked
    }
  };
}

function hydrateControls(config) {
  controls.viewerCount.value = config.viewerCount;
  controls.engagementMultiplier.value = config.engagementMultiplier;
  controls.donationFrequency.value = config.donationFrequency;
  controls.persona.value = config.persona;
  controls.bias.value = config.bias;
  controls.inferenceMode.value = config.inferenceMode;
  controls.localEndpoint.value = config.provider.localEndpoint;
  controls.localModel.value = config.provider.localModel;
  controls.cloudEndpoint.value = config.provider.cloudEndpoint;
  controls.cloudModel.value = config.provider.cloudModel;
  controls.requestTimeoutMs.value = config.provider.requestTimeoutMs;
  controls.maxRetries.value = config.provider.maxRetries;
  controls.dropPolicy.value = config.safety.dropPolicy;
  controls.slowMode.checked = config.slowMode;
  controls.emoteOnly.checked = config.emoteOnly;
  controls.ttsEnabled.checked = config.ttsEnabled;
  controls.ttsMode.value = config.ttsMode ?? "local";
  controls.ttsProvider.value = config.ttsProvider ?? "local";
  controls.visionEnabled.checked = config.capture.visionEnabled;
  controls.visionProvider.value = config.capture.visionProvider ?? "local";
  controls.useRealCapture.checked = config.capture.useRealCapture;
  controls.visionIntervalSec.value = config.capture.visionIntervalSec;
  controls.sttProvider.value = config.capture.sttProvider ?? "local-whisper";
  controls.sttEndpoint.value = config.capture.sttEndpoint || STT_DEFAULT_ENDPOINTS[controls.sttProvider.value] || STT_DEFAULT_ENDPOINTS["local-whisper"];
  controls.visionEndpoint.value = config.capture.visionEndpoint;
  controls.audioIntelligenceEnabled.checked = Boolean(config.audioIntelligence?.enabled);
  controls.allowDiagnostics.checked = config.security.allowDiagnostics;
  controls.allowNonLocalSidecarOverride.checked = config.security.allowNonLocalSidecarOverride;
  controls.eulaAccepted.checked = config.compliance.eulaAccepted;
  if (wizardEulaAccepted) wizardEulaAccepted.checked = config.compliance.eulaAccepted;
}

function syncSttEndpointForProvider() {
  const provider = controls.sttProvider.value;
  const currentEndpoint = controls.sttEndpoint.value?.trim();
  const knownDefaults = new Set(Object.values(STT_DEFAULT_ENDPOINTS));
  if (!currentEndpoint || knownDefaults.has(currentEndpoint)) {
    controls.sttEndpoint.value = STT_DEFAULT_ENDPOINTS[provider] || STT_DEFAULT_ENDPOINTS["local-whisper"];
  }
}


function renderOnboardingState(payload) {
  const onboardingDone = Boolean(payload?.onboardingComplete);
  if (onboardingPill) {
    onboardingPill.textContent = onboardingDone ? "Complete" : "Pending";
    onboardingPill.classList.toggle("complete", onboardingDone);
    onboardingPill.classList.toggle("pending", !onboardingDone);
  }
}

function syncEulaCheckboxes(source) {
  const checked = Boolean(source?.checked);
  controls.eulaAccepted.checked = checked;
  if (wizardEulaAccepted) wizardEulaAccepted.checked = checked;
}
function renderReadiness(readiness) {
  readinessList.innerHTML = "";
  if (!readiness?.checks?.length) {
    readinessList.innerHTML = "<li>Readiness checks pending...</li>";
    return;
  }

  readiness.checks.forEach((check) => {
    const li = document.createElement("li");
    const icon = check.ok ? "✅" : check.severity === "blocking" ? "❌" : "⚠️";
    li.textContent = `${icon} ${check.id.toUpperCase()}: ${check.message}`;
    readinessList.appendChild(li);
  });
}

function renderDiagnostics(payload) {
  const recommendation = payload.bootDiagnostics?.recommendation;
  const profile = payload.bootDiagnostics?.profile;
  const tierText = recommendation ? `${recommendation.tier} → ${recommendation.inferenceMode} (${recommendation.reason})` : "pending";
  const network = profile ? `${profile.networkLatencyMs}ms` : "pending";
  diagnosticsSummary.textContent = `Tier: ${tierText}\nNetwork probe: ${network}\nBanlist: ${payload.banlist?.version ?? "n/a"} (${payload.banlist?.checksum ?? "n/a"})`;
}

function summarizeRuntime(payload) {
  const mode = payload.config.inferenceMode;
  const runningMode = mode === "openai" || mode === "groq" || mode === "mock-cloud" ? "API/cloud" : "Local";
  const usingMock = mode === "mock-local" || mode === "mock-cloud";
  const cloudKeyReady = Boolean(payload.secrets?.hasCloudKey);
  const cloudKeyState = cloudKeyReady ? "present" : "missing";
  const localMode = mode === "ollama" || mode === "lmstudio" || mode === "mock-local";
  const captureMode = payload.config.capture.useRealCapture ? "real capture endpoints" : "simulated capture";
  const sttMode = payload.config.capture.useRealCapture ? "expects microphone input from configured STT endpoint" : "mock/no verified mic pipeline";
  const sttProvider = payload.config.capture.sttProvider ?? "mock";
  const ttsMode = payload.config.ttsMode ?? "local";

  runtimeSummary.textContent = [
    `Inference mode: ${mode} (${runningMode})`,
    `API key: ${localMode ? "not required in local mode" : cloudKeyState}`,
    `AI responses: ${usingMock ? "disabled (mock generator active)" : "enabled"}`,
    `Capture mode: ${captureMode}`,
    `STT path: ${sttMode}`,
    `STT provider: ${sttProvider}`,
    `TTS path: ${payload.config.ttsEnabled ? ttsMode : "off"}`
  ].join("\n");
}

function summarizeAiHealth(payload) {
  if (!aiHealthSummary) return;
  const ai = payload.ai ?? {};
  const health = ai.providerHealth ?? "unknown";
  const state = ai.state ?? "idle";
  const fallback = ai.fallbackMode ? ` | fallback: ${ai.fallbackMode}` : "";
  const mode = payload?.config?.inferenceMode ?? "mock-local";
  const resolvedPrimaryModel = mode === "openai" || mode === "groq" || mode === "mock-cloud"
    ? payload?.config?.provider?.cloudModel
    : payload?.config?.provider?.localModel;
  const activeModel = ai.activeModel ?? resolvedPrimaryModel ?? "n/a";
  if (aiActiveModelLabel) aiActiveModelLabel.textContent = `(model: ${activeModel})`;
  aiHealthSummary.textContent = [
    `AI state: ${state}`,
    `Provider health: ${health}`,
    `Active model: ${activeModel}`,
    `Last update: ${ai.updatedAt ?? "n/a"}${fallback}`,
    `Last detail: ${ai.detail ?? "n/a"}`
  ].join("\n");
}

function summarizeTtsHealth(payload) {
  if (!ttsHealthSummary) return;
  const mode = payload.config?.ttsMode ?? "local";
  const enabled = Boolean(payload.config?.ttsEnabled) && mode !== "off";
  const hasCloudKey = Boolean(payload.secrets?.hasCloudKey);
  const ready = !enabled || mode === "local" || hasCloudKey;
  const reason = !enabled
    ? "disabled"
    : mode === "local"
      ? "local path selected; no API key needed"
      : hasCloudKey
        ? "cloud key present"
        : "cloud key missing";

  ttsHealthSummary.textContent = [
    `TTS enabled: ${enabled ? "yes" : "no"}`,
    `TTS mode: ${mode}`,
    `TTS ready: ${ready ? "yes" : "no"}`,
    `Detail: ${reason}`
  ].join("\n");
}

function summarizeSttHealth(payload) {
  if (!sttHealthSummary) return;
  const capture = payload.config?.capture ?? {};
  const provider = capture.sttProvider ?? "mock";
  const useRealCapture = Boolean(capture.useRealCapture);
  const endpoint = capture.sttEndpoint ?? "n/a";
  const sttRuntime = payload.stt ?? {};

  let ready = true;
  let detail = "ready";
  if (!useRealCapture) {
    detail = "simulated capture mode (real STT optional)";
  } else if (provider === "deepgram" && !sttRuntime.deepgramKeyPresent) {
    ready = false;
    detail = "Deepgram selected but STREAMSIM_DEEPGRAM_API_KEY is missing";
  } else if ((provider === "openai-whisper" || provider === "gpt-4o-mini-transcribe") && !sttRuntime.cloudKeyPresent) {
    ready = false;
    detail = "Cloud OpenAI STT selected but no cloud API key is stored";
  } else if ((provider === "whispercpp" || provider === "local-whisper") && !endpoint.startsWith("http")) {
    ready = false;
    detail = "Whisper endpoint must be a valid URL";
  } else if (provider === "local-whisper") {
    try {
      const parsed = new URL(endpoint);
      if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
        ready = false;
        detail = "Local Whisper must point to localhost/127.0.0.1 endpoint";
      }
    } catch {
      ready = false;
      detail = "Local Whisper endpoint must be a valid URL";
    }
  }

  sttHealthSummary.textContent = [
    `STT provider: ${provider}`,
    `Capture mode: ${useRealCapture ? "real" : "simulated"}`,
    `STT ready: ${ready ? "yes" : "no"}`,
    `Detail: ${detail}`
  ].join("\n");
}

function summarizeVisionHealth(payload) {
  if (!visionHealthSummary) return;
  const capture = payload.config?.capture ?? {};
  const enabled = Boolean(capture.visionEnabled);
  const provider = capture.visionProvider ?? "local";
  const useRealCapture = Boolean(capture.useRealCapture);
  const endpoint = capture.visionEndpoint ?? "n/a";
  const hasVisionSample = Boolean(payload.privacy?.captureBuffer?.hasVisionSample);
  const hasCloudKey = Boolean(payload.secrets?.hasCloudKey);

  let ready = true;
  let detail = "ready";
  if (!enabled) {
    detail = "vision capture disabled";
  } else if (!useRealCapture) {
    detail = "simulated capture mode (real vision polling optional)";
  } else if (!endpoint.startsWith("http")) {
    ready = false;
    detail = "Vision endpoint must be a valid URL";
  } else if (provider === "openai" && !hasCloudKey) {
    ready = false;
    detail = "OpenAI vision selected but no cloud API key is stored";
  }

  const sampleStatus = enabled
    ? hasVisionSample
      ? "latest sample present"
      : "waiting for first sample"
    : "not collecting";
  const detailWithHint = sampleStatus === "waiting for first sample" && enabled && useRealCapture
    ? `${detail}; run Start Simulation and confirm the vision endpoint is producing tags (webcam permission alone does not populate visionTags).`
    : detail;

  visionHealthSummary.textContent = [
    `Vision enabled: ${enabled ? "yes" : "no"}`,
    `Vision provider: ${provider}`,
    `Capture mode: ${useRealCapture ? "real" : "simulated"}`,
    `Vision ready: ${ready ? "yes" : "no"}`,
    `Sample state: ${sampleStatus}`,
    `Detail: ${detailWithHint}`
  ].join("\n");
}

function summarizeApiKeyHealth(payload) {
  if (!apiKeyHealthSummary) return;
  const config = payload?.config ?? {};
  const capture = config.capture ?? {};
  const secrets = payload?.secrets ?? {};

  const hasCloudKey = Boolean(secrets.hasCloudKey);
  const hasDeepgramKey = Boolean(secrets.hasDeepgramKey);
  const ttsEnabled = Boolean(config.ttsEnabled) && (config.ttsMode ?? "local") !== "off";
  const ttsProvider = config.ttsProvider ?? "local";
  const sttProvider = capture.sttProvider ?? "mock";
  const useRealCapture = Boolean(capture.useRealCapture);
  const audioIntelligenceEnabled = Boolean(config.audioIntelligence?.enabled);

  const ttsKeyRequired = ttsEnabled && (ttsProvider === "openai" || ttsProvider === "deepgram_aura");
  const ttsKeyStatus = !ttsKeyRequired
    ? "not required"
    : ttsProvider === "deepgram_aura"
      ? hasDeepgramKey ? "present (Deepgram)" : "missing (Deepgram)"
      : hasCloudKey ? "present (cloud)" : "missing (cloud)";

  const sttKeyRequired = useRealCapture && (sttProvider === "deepgram" || sttProvider === "openai-whisper" || sttProvider === "gpt-4o-mini-transcribe");
  const sttKeyStatus = !sttKeyRequired
    ? "not required"
    : sttProvider === "deepgram"
      ? hasDeepgramKey ? "present (Deepgram)" : "missing (Deepgram)"
      : hasCloudKey ? "present (cloud)" : "missing (cloud)";

  const audioIntelligenceKeyRequired = audioIntelligenceEnabled && useRealCapture && sttProvider === "deepgram";
  const audioIntelligenceKeyStatus = !audioIntelligenceKeyRequired
    ? "not required"
    : hasDeepgramKey ? "present (Deepgram)" : "missing (Deepgram)";

  apiKeyHealthSummary.textContent = [
    `TTS API key: ${ttsKeyStatus}`,
    `STT API key: ${sttKeyStatus}`,
    `Audio intelligence API key: ${audioIntelligenceKeyStatus}`,
    `Cloud key detected: ${hasCloudKey ? "yes" : "no"}`,
    `Deepgram key detected: ${hasDeepgramKey ? "yes" : "no"}`
  ].join("\n");
}

function renderDeviceChecks(result) {
  deviceChecks.innerHTML = "";
  const cameraPermissionDetail = result.cameraPermission
    ? "granted"
    : result.cameraPermissionState === "granted"
      ? "granted (camera failed to start)"
      : result.cameraPermissionState && result.cameraPermissionState !== "unknown"
        ? `not granted (${result.cameraPermissionState})`
        : "not granted";

  const rows = [
    { label: "Microphone permission", ok: result.micPermission, detail: result.micPermission ? "granted" : "not granted" },
    { label: "Camera permission", ok: result.cameraPermission, detail: cameraPermissionDetail },
    { label: "Microphone device", ok: result.hasMicDevice, detail: result.hasMicDevice ? "detected" : "not detected" },
    { label: "Camera device", ok: result.hasCameraDevice, detail: result.hasCameraDevice ? "detected" : "not detected" }
  ];

  if (result.cameraFailureReason) {
    rows.push({ label: "Camera runtime", ok: false, detail: result.cameraFailureReason });
  }

  rows.forEach((row) => {
    const li = document.createElement("li");
    li.textContent = `${row.ok ? "✅" : "❌"} ${row.label}: ${row.detail}`;
    deviceChecks.appendChild(li);
  });
}

function updateMonitorAvailability(verification) {
  const monitorReady = Boolean(verification?.micPermission && verification?.cameraPermission && verification?.hasMicDevice && verification?.hasCameraDevice);
  if (liveMonitorEnabled) {
    liveMonitorEnabled.disabled = !monitorReady;
  }

  if (!monitorReady) {
    if (liveMonitorEnabled?.checked) liveMonitorEnabled.checked = false;
    stopLiveMonitor();
    setLiveMonitorStatus("Live monitor requires both mic and camera grants plus detected devices.", "warn");
    return;
  }

  setLiveMonitorStatus("Live monitor ready. Toggle enable to start live camera + voice meter.", "ok");
}

async function getDeviceInventory() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { hasMicDevice: false, hasCameraDevice: false };
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    hasMicDevice: devices.some((device) => device.kind === "audioinput"),
    hasCameraDevice: devices.some((device) => device.kind === "videoinput")
  };
}

async function verifyMicrophoneOnly() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Browser does not support microphone capture.");
  }

  let micPermission = false;
  let inferredHasMicDevice = false;
  try {
    const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
    micPermission = true;
    inferredHasMicDevice = audioOnly.getAudioTracks().length > 0;
    audioOnly.getTracks().forEach((track) => track.stop());
  } catch {}

  const inventory = await getDeviceInventory();
  return {
    ...latestDeviceVerification,
    micPermission,
    hasMicDevice: inventory.hasMicDevice || inferredHasMicDevice,
    hasCameraDevice: inventory.hasCameraDevice
  };
}

async function getMediaPermissionState(name) {
  if (!navigator.permissions?.query) return "unknown";
  try {
    const result = await navigator.permissions.query({ name });
    return result.state;
  } catch {
    return "unknown";
  }
}

async function verifyCameraOnly() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Browser does not support camera capture.");
  }

  let cameraPermission = false;
  let cameraFailureReason = null;
  let inferredHasCameraDevice = false;
  let videoOnly = null;

  try {
    videoOnly = await navigator.mediaDevices.getUserMedia({ video: true });
    inferredHasCameraDevice = videoOnly.getVideoTracks().length > 0;
    if (!inferredHasCameraDevice) {
      throw new Error("Camera permission granted, but browser returned no video tracks.");
    }
    await confirmCameraFrames(videoOnly);
    cameraPermission = true;
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "Error";
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : "Unable to access camera";
    cameraFailureReason = `${name}: ${message}`;
  } finally {
    videoOnly?.getTracks().forEach((track) => track.stop());
  }

  const cameraPermissionState = await getMediaPermissionState("camera");

  const inventory = await getDeviceInventory();
  return {
    ...latestDeviceVerification,
    cameraPermission,
    cameraPermissionState,
    cameraFailureReason,
    hasMicDevice: inventory.hasMicDevice || latestDeviceVerification.hasMicDevice,
    hasCameraDevice: inventory.hasCameraDevice || inferredHasCameraDevice
  };
}

async function verifyLocalDevices() {
  const afterMic = await verifyMicrophoneOnly();
  latestDeviceVerification = afterMic;
  return verifyCameraOnly();
}

async function post(url, body = undefined) {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }

  return response.json().catch(() => ({}));
}

const saveBtn = document.getElementById("save");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const rebindBtn = document.getElementById("rebindAudio");
const sidecarCancelBtn = document.getElementById("sidecarCancel");
const sidecarResumeBtn = document.getElementById("sidecarResume");
const runReadinessBtn = document.getElementById("runReadiness");
const saveCloudKeyBtn = document.getElementById("saveCloudKey");
const saveDeepgramKeyBtn = document.getElementById("saveDeepgramKey");
const refreshStatusBtn = document.getElementById("refreshStatus");
const verifyMicBtn = document.getElementById("verifyMic");
const verifyCameraBtn = document.getElementById("verifyCamera");
const openOverlayWindowBtn = document.getElementById("openOverlayWindow");
const applyOverrideBtn = document.getElementById("applyOverride");
const completeWizardBtn = document.getElementById("completeWizard");
const wizardEulaAccepted = document.getElementById("wizardEulaAccepted");
const onboardingPill = document.getElementById("onboardingPill");


function ensureVerifyCameraButtonActive() {
  if (!verifyCameraBtn) return;
  verifyCameraBtn.disabled = false;
  verifyCameraBtn.textContent = "Verify Camera";
}

saveBtn.addEventListener("click", async () => {
  const result = await runAction({
    button: saveBtn,
    pendingText: "Saving config...",
    successText: "Config saved.",
    onRun: () => post("/api/config", getPayload())
  });
  if (result?.config) hydrateControls(result.config);
});

startBtn.addEventListener("click", async () => {
  if (simulationActionInFlight) return;
  setSimulationActionPending(true);
  await runAction({
    button: startBtn,
    pendingText: "Starting simulation...",
    successText: "Simulation started.",
    onRun: async () => {
      const mode = controls.inferenceMode.value;
      const cloudMode = mode === "openai" || mode === "groq" || mode === "mock-cloud";
      const cloudStt =
        controls.useRealCapture.checked &&
        (controls.sttProvider.value === "openai-whisper" || controls.sttProvider.value === "gpt-4o-mini-transcribe");
      const hasCloudKey = Boolean(latestStatusPayload?.secrets?.hasCloudKey);
      if (cloudMode && !hasCloudKey) {
        throw new Error("Cloud inference selected but no API key is stored. Save a Cloud API key before starting.");
      }
      if (controls.ttsEnabled.checked && controls.ttsMode.value === "cloud" && controls.ttsProvider.value === "openai" && !hasCloudKey) {
        throw new Error("OpenAI TTS selected but no Cloud API key is stored. Save a Cloud API key or switch TTS provider.");
      }
      if (cloudStt && !hasCloudKey) {
        throw new Error("Cloud OpenAI STT selected but no API key is stored. Save a Cloud API key or switch STT provider.");
      }
      const hasDeepgramKey = Boolean(latestStatusPayload?.secrets?.hasDeepgramKey || latestStatusPayload?.stt?.deepgramKeyPresent);
      if (controls.sttProvider.value === "deepgram" && !hasDeepgramKey) {
        throw new Error("Deepgram STT selected but no Deepgram API key is stored.");
      }
      if (controls.ttsEnabled.checked && controls.ttsMode.value === "cloud" && controls.ttsProvider.value === "deepgram_aura" && !hasDeepgramKey) {
        throw new Error("Deepgram Aura TTS selected but no Deepgram API key is stored.");
      }
      return post("/api/start");
    }
  });
  setSimulationActionPending(false);
});

stopBtn.addEventListener("click", async () => {
  if (simulationActionInFlight) return;
  setSimulationActionPending(true);
  await runAction({
    button: stopBtn,
    pendingText: "Stopping simulation...",
    successText: "Simulation stopped.",
    onRun: () => post("/api/stop")
  });
  setSimulationActionPending(false);
});

rebindBtn.addEventListener("click", async () => {
  await runAction({
    button: rebindBtn,
    pendingText: "Rebinding audio...",
    successText: "Audio rebind requested.",
    onRun: () => post("/api/audio/rebind")
  });
});

sidecarCancelBtn.addEventListener("click", async () => {
  await runAction({
    button: sidecarCancelBtn,
    pendingText: "Cancelling sidecar pull...",
    successText: "Sidecar pull cancellation requested.",
    onRun: () => post("/api/sidecar/cancel")
  });
});

sidecarResumeBtn.addEventListener("click", async () => {
  await runAction({
    button: sidecarResumeBtn,
    pendingText: "Resuming sidecar pull...",
    successText: "Sidecar pull resume requested.",
    onRun: () => post("/api/sidecar/resume")
  });
});

runReadinessBtn.addEventListener("click", async () => {
  const payload = await runAction({
    button: runReadinessBtn,
    pendingText: "Running readiness checks...",
    successText: "Readiness refreshed.",
    onRun: async () => {
      const response = await fetch("/api/onboarding/readiness");
      if (!response.ok) throw new Error(`Readiness request failed (${response.status})`);
      return response.json();
    }
  });
  if (payload?.readiness) renderReadiness(payload.readiness);
});

saveCloudKeyBtn.addEventListener("click", async () => {
  const saved = await runAction({
    button: saveCloudKeyBtn,
    pendingText: "Saving cloud API key...",
    successText: "Cloud API key saved to keychain.",
    onRun: () => post("/api/secrets/cloud-key", { key: controls.cloudApiKey.value })
  });
  if (!saved) return;
  controls.cloudApiKey.value = "";
  await refreshStatus();
});

saveDeepgramKeyBtn.addEventListener("click", async () => {
  const saved = await runAction({
    button: saveDeepgramKeyBtn,
    pendingText: "Saving Deepgram API key...",
    successText: "Deepgram API key saved to keychain.",
    onRun: () => post("/api/secrets/deepgram-key", { key: controls.deepgramApiKey.value })
  });
  if (!saved) return;
  controls.deepgramApiKey.value = "";
  await refreshStatus();
});

async function refreshStatus() {
  const response = await fetch("/api/status");
  if (!response.ok) throw new Error(`Status request failed (${response.status})`);
  const payload = await response.json();
  latestStatusPayload = payload;
  renderReadiness(payload.readiness);
  renderDiagnostics(payload);
  hydrateControls(payload.config);
  renderOnboardingState(payload);
  summarizeRuntime(payload);
  summarizeAiHealth(payload);
  summarizeTtsHealth(payload);
  summarizeSttHealth(payload);
  summarizeApiKeyHealth(payload);
  summarizeVisionHealth(payload);
  return payload;
}

refreshStatusBtn.addEventListener("click", async () => {
  await runAction({
    button: refreshStatusBtn,
    pendingText: "Refreshing status...",
    successText: "Status refreshed.",
    onRun: () => refreshStatus()
  });
});

verifyMicBtn?.addEventListener("click", async () => {
  const verification = await runAction({
    button: verifyMicBtn,
    pendingText: "Requesting microphone permission...",
    successText: "Microphone verification complete.",
    onRun: () => verifyMicrophoneOnly()
  });
  if (!verification) return;
  latestDeviceVerification = verification;
  renderDeviceChecks(verification);
  updateMonitorAvailability(verification);

  if (verification.micPermission && verification.hasMicDevice) {
    try {
      await startMicVerificationCheck();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCaptionStatus(`Unable to start mic/STT check: ${message}`, "error");
    }
  }
});

ensureVerifyCameraButtonActive();

verifyCameraBtn?.addEventListener("click", async () => {
  const verification = await runAction({
    button: verifyCameraBtn,
    pendingText: "Requesting camera permission...",
    onRun: () => verifyCameraOnly()
  });
  if (!verification) return;

  latestDeviceVerification = verification;
  renderDeviceChecks(verification);
  updateMonitorAvailability(verification);

  if (!verification.cameraPermission) {
    if (verification.cameraPermissionState === "denied") {
      setStatus("Camera permission is denied in browser site settings. Change it to Allow and retry.", "error");
      return;
    }
    if (!verification.hasCameraDevice) {
      setStatus("No camera device detected. Connect a camera and try Verify Camera again.", "error");
      return;
    }
    setStatus(`Camera did not start (${verification.cameraFailureReason ?? "unknown reason"}). Close other apps using the camera and retry.`, "error");
    return;
  }

  if (!verification.hasCameraDevice) {
    setStatus("Camera stream opened, but device inventory is unavailable in this browser. Camera verification complete.", "warn");
    return;
  }

  setStatus("Camera verification complete.", "success");
});

openOverlayWindowBtn.addEventListener("click", () => {
  const popup = window.open("/overlay.html", "streamsim-overlay", "popup=yes,width=900,height=700");
  if (!popup) {
    setStatus("Popup blocked. Allow popups to open transparent chat window.", "warn");
  }
});

applyOverrideBtn.addEventListener("click", async () => {
  await runAction({
    button: applyOverrideBtn,
    pendingText: "Applying override...",
    successText: "Override updated.",
    onRun: () =>
      post("/api/security/override-localhost", {
        allow: controls.allowNonLocalSidecarOverride.checked,
        reason: controls.overrideReason.value
      })
  });
});

completeWizardBtn.addEventListener("click", async () => {
  const onboardingPayload = await runAction({
    button: completeWizardBtn,
    pendingText: "Saving compliance + completing onboarding...",
    successText: "Onboarding complete.",
    onRun: async () => {
      syncEulaCheckboxes(wizardEulaAccepted ?? controls.eulaAccepted);
      await post("/api/config", getPayload());
      return post("/api/onboarding/complete");
    }
  });
  if (!onboardingPayload?.readiness) return;
  renderReadiness(onboardingPayload.readiness);
  const status = await fetch("/api/status").then((response) => response.json());
  hydrateControls(status.config);
  renderDiagnostics(status);
  renderOnboardingState(status);
  summarizeRuntime(status);
  summarizeAiHealth(status);
  summarizeTtsHealth(status);
  summarizeSttHealth(status);
  summarizeApiKeyHealth(status);
  summarizeVisionHealth(status);
});


controls.eulaAccepted?.addEventListener("change", () => {
  syncEulaCheckboxes(controls.eulaAccepted);
});

wizardEulaAccepted?.addEventListener("change", () => {
  syncEulaCheckboxes(wizardEulaAccepted);
});

controls.sttProvider?.addEventListener("change", () => {
  syncSttEndpointForProvider();
});

liveMonitorEnabled?.addEventListener("change", async () => {
  if (!liveMonitorEnabled.checked) {
    stopLiveMonitor();
    return;
  }

  const monitorStarted = await runAction({
    button: liveMonitorEnabled,
    pendingText: "Requesting camera/microphone access for live monitor...",
    successText: "Live monitor enabled.",
    onRun: () => startLiveMonitor()
  });

  if (!monitorStarted) {
    liveMonitorEnabled.checked = false;
    stopLiveMonitor();
  }
});

window.addEventListener("beforeunload", () => {
  stopLiveMonitor();
  stopMicVerificationCheck();
});

const events = new EventSource("/api/events");
events.addEventListener("messages", (event) => {
  const messages = JSON.parse(event.data);
  messages.forEach((msg) => {
    const item = document.createElement("div");
    item.className = "chat-msg";

    const user = document.createElement("span");
    user.className = "user";
    user.textContent = msg.username ? `${msg.username}:` : "";

    const messageText = document.createElement("span");
    messageText.textContent = msg.text || msg.emotes.join(" ");

    item.append(user, messageText);

    const source = document.createElement("span");
    source.className = "source-tag";
    source.textContent = msg.source ?? "unknown";
    item.append(source);

    if (msg.donationCents) {
      const donation = document.createElement("span");
      donation.className = "donation";
      donation.textContent = `$${(msg.donationCents / 100).toFixed(2)}`;
      item.append(donation);
    }

    chatEl.prepend(item);
    while (chatEl.children.length > 22) chatEl.lastChild.remove();
  });
});

events.addEventListener("meta", (event) => {
  const meta = JSON.parse(event.data);
  if (meta?.queueMessages) {
    meta.queuePreview = meta.queueMessages.slice(0, 3);
    delete meta.queueMessages;
  }
  const warningLines = [meta.warning, ...(meta.warnings ?? [])].filter(Boolean);
  const recovery = meta.cloudRecovery ? `Recovery=${meta.cloudRecovery}` : "";
  const banner = warningLines.length ? `⚠️ ${warningLines.join(" | ")} ${recovery}`.trim() + "\n" : "";
  metaEl.textContent = `${banner}${JSON.stringify(meta, null, 2)}`;
});

async function boot() {
  const response = await fetch("/api/status");
  const payload = await response.json();
  latestStatusPayload = payload;
  hydrateControls(payload.config);
  renderReadiness(payload.readiness);
  renderDiagnostics(payload);
  renderOnboardingState(payload);
  summarizeRuntime(payload);
  summarizeAiHealth(payload);
  summarizeTtsHealth(payload);
  summarizeSttHealth(payload);
  summarizeApiKeyHealth(payload);
  summarizeVisionHealth(payload);
  latestDeviceVerification = { micPermission: false, cameraPermission: false, hasMicDevice: false, hasCameraDevice: false, cameraPermissionState: "unknown", cameraFailureReason: null };
  if (liveMonitorEnabled) {
    liveMonitorEnabled.checked = false;
    liveMonitorEnabled.disabled = true;
  }
  setLiveMonitorStatus("Run Verify Mic/Camera to enable the live monitor.", "warn");
  stopMicVerificationCheck();
  setCaptionPreview("No speech captured yet.");
  setCaptionStatus("Run Verify Microphone to start mic/STT check.", "warn");
  ensureVerifyCameraButtonActive();
}

void boot();
