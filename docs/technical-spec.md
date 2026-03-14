# StreamSim Technical Specification (Working Title)

## 1. Executive Summary & Product Vision

### The Problem
Aspiring content creators and streamers face the "dead air" syndrome: it is incredibly difficult to practice on-camera charisma, train your train of thought, and maintain high energy when broadcasting to an empty room (0-5 viewers). Without active chat interaction, creators struggle to develop the skills necessary to engage a large audience. Furthermore, practicing crowd control against toxic or fast-moving chats is impossible without a real audience, leaving creators unprepared for viral moments or targeted harassment.

### The Solution
StreamSim is a desktop application (Windows & Mac) that generates a highly realistic, AI-driven simulated live audience. It runs as a low-profile background app with a transparent UI overlay designed to be captured via OBS or Streamlabs. By actively listening to the user's voice, analyzing their tone, and periodically viewing their camera feed, the AI generates context-aware chat messages, donations, TTS (Text-to-Speech), and adaptive reactions in real-time.

### Unique Selling Point (USP)
Unlike basic dummy-text generators, StreamSim uses multi-modal AI combined with a dynamic "Persona & Bias Engine." Crucially, it features a **Hybrid AI Architecture** allowing users to utilize their own gaming GPUs via local LLMs (Ollama), and a **Stochastic Spooling Engine** to simulate high-pressure, uncensored environments without risking cloud API bans. Paired with strict local profanity filters and immutable platform compliance watermarks, it is the ultimate, safe practice and VOD-creation tool for modern creators.

---

## 2. User Personas & User Stories

### Primary Personas
1. **The Aspiring Streamer (The Trainee):** A new Twitch/YouTube streamer wanting to practice talking to chat and maintaining energy before going live to real people.
2. **The Content Creator (The Illusionist):** A TikTok/YouTube creator who records offline videos but wants the aesthetic and dynamic feel of a "Live Stream VOD" to increase engagement in their edited content.
3. **The Veteran Practicing Moderation (The Stress Tester):** An established streamer who wants to practice maintaining composure against trolls or fast-moving chaotic chats using local AI to bypass corporate safety filters.

### User Stories
* **As an Aspiring Streamer**, I want to toggle my audience to "Positive/Supportive" so that I can build my confidence on camera.
* **As a Content Creator**, I want to ensure my VODs are safe for monetization, so I need the app to automatically filter out platform-bannable slurs from the AI generation.
* **As a Stress Tester**, I want the chat to simulate a 10,000-viewer speed and introduce a "Hater/Critic" bias using a local Ollama model, so I can practice handling a toxic chat without getting my OpenAI API key banned.
* **As any user**, I want a transparent window that seamlessly integrates into OBS using Window Capture, with no audio feedback loops when the AI plays a TTS donation.

---

## 3. Functional Requirements (The "What")

### Must-Have Features
* **Hybrid AI Generation:** Support for both Cloud APIs (OpenAI/Groq) and Local LLMs (Ollama/LM Studio) to generate dynamic, contextual chat arrays.
* **Transparent Chat Overlay:** A chromakey-ready or natively transparent UI window for OBS capture.
* **Content Safety Pre-Render Filter:** An ultra-fast, local synchronous dictionary/regex filter that drops TOS-violating words before they hit the screen.
* **Infinite Audio Loop Prevention:** Hardware/software mutual exclusion that deafens the AI's listening capabilities while TTS donations are playing.
* **Platform Compliance:** An aggressive EULA gate and a persistent 20% opacity watermark to legally classify the app as a simulation tool.
* **Low-Friction Configuration:** A simple dashboard to set viewer count, toggle TTS/Donations, select AI endpoints, and start the simulation.
* **Voice & Tone Analysis:** Algorithmic detection of volume and speech pace to trigger "hype" emotes or "bored" comments.
* **Environment Recognition (Vision):** Periodic webcam frame grabs processed by a Vision AI to generate comments about the user's appearance or background.
* **Debate/Bias Engine:** The AI splits the generated chat into factions (e.g., 70% Agree, 30% Disagree) when the streamer asks a question.
* **Slow Mode Toggle:** Limits the chat speed to a fixed interval (e.g., 1 message every 3 seconds) regardless of viewer count, helping the user practice reading specific names/comments.
* **Emote-Only Mode:** A toggle that strips all text from the generation queue, rendering only emojis/emotes.
* **Stochastic Burst Logic:** Chat doesn't flow linearly; it "bursts" when the streamer does something exciting and "lulls" during quiet moments.

## User Flow

### Phase 1: Lifecycle & Initialization (The Boot Sequence)
Before the simulation begins, the app optimizes itself for the user's specific hardware environment.

1. **Hardware Profiling:** On launch, the **Performance Benchmarker** (Rust) probes the system’s VRAM, CPU cores, and network latency.
2. **Logic Tiering:**
   * **High-Tier (8GB+ VRAM):** App recommends **Local Inference (Ollama)**.
   * **Low-Tier (<4GB VRAM):** App defaults to **Low-VRAM Mode (Cloud/Groq)**.
3. **The Orchestrator:** If Local is selected, the **One-Click Setup** module checks for the Ollama sidecar. If missing, it silently initializes the background service and pulls the pre-selected quantized model (e.g., Llama-3-8B-4bit).
4. **EULA Gate:** User confirms the Compliance Agreement; the app initializes the **Immutable Watermark** on the overlay layer.

---

### Phase 2: Input Capture & Pre-Processing (The "Listening" Phase)
The app continuously monitors the streamer's environment while respecting the state of the simulation.

5. **Microphone Input:** High-fidelity audio is captured via the system’s default input.
6. **Mutual Exclusion (The "Deafen" Logic):** The **Audio State Manager** checks the global variable `is_tts_playing`.
   * **IF TRUE:** The audio buffer is immediately flushed/discarded. The AI "covers its ears" while it is talking to prevent feedback loops.
   * **IF FALSE:** The audio buffer is passed to the **STT (Speech-to-Text) Engine**.
7. **STT & Tone Analysis:**
   * The audio is converted to text (Whisper/Deepgram).
   * Simultaneously, a **Tone Analyzer** calculates RMS (Volume) and WPM (Speed) to determine the "Energy Level" (e.g., Hype vs. Chill).
8. **Vision Tagging (Periodic):** Every 30 seconds, a webcam frame is captured, processed by a lightweight Vision model, and converted into text tags (e.g., *"User is wearing a headset, background has RGB lights, holding a soda can"*).

---

### Phase 3: Contextual Intelligence (The Prompt Engine)
Raw data is transformed into a structured prompt that the AI can understand.

9. **The Rolling Buffer:** The **Context Manager** prunes the STT transcript, keeping only the **last 90 seconds** of dialogue to prevent context-window bloat and latency.
10. **Prompt Assembly:** The **Prompt Constructor** merges four data streams into one JSON-ready system message:
    * **Static Context:** Persona (Trolls/Supportive), Bias (Agree/Disagree), and Viewer Count.
    * **Long-term Vibe:** A 1-sentence summary of the stream's progress.
    * **Current Context:** Rolling 90s Transcript + Tone Data + Vision Tags.
    * **Output Schema:** A strict instruction to return *only* a JSON array of strings.

---

### Phase 4: Inference & Generation (The "Brain")
The packaged prompt is sent to the chosen "Brain" of the application.

11. **Routing:**
    * **Local Route:** Sent to the **Ollama Sidecar** at `localhost:11434`.
    * **Cloud Route:** Sent to the **Groq/OpenAI API** using the user's encrypted key.
12. **Raw Output:** The LLM generates a batch of 10–50 chat messages (depending on viewer count settings) and returns the JSON array.

---

### Phase 5: Safety & Spooling (The Rendering Pipeline)
Before the user sees the chat, the messages must be sanitized and paced realistically.

13. **Local Pre-Render Filter:** The raw JSON array passes through a **Synchronous Safety Filter**.
    * Each message is scanned against a local **Regex/Dictionary of Banned Slurs**.
    * **TOS-Violating messages are dropped** entirely from the array.
    * "Toxic" but safe insults (e.g., *"You're bad at this game"*) are permitted.
14. **The Spooling Engine:** The "Clean" messages enter a **Virtualization Queue**.
    * The engine applies **Poisson Jitter** to the delivery timing, so messages appear in natural "bursts" rather than a mechanical stream.
    * The engine adjusts speed based on the **Tone Analyzer** (Higher volume = faster chat).
15. **UI Rendering:** Messages are rendered in the **Transparent Tauri Window**.
    * **Overlay Tech:** Uses a Virtualized List to handle high-volume chat (10k+ viewers) without CPU spikes.
    * **Watermark:** A 20% opacity "StreamSim" logo is hardcoded into the view layer.

---

### Phase 6: Interactive Events (The Feedback Loop)
Simulated "Live" events that trigger a state change in the application.

16. **Donation/TTS Trigger:** Based on a randomized frequency setting, the app triggers a "Superchat."
17. **TTS Execution:**
    * `is_tts_playing` is set to **TRUE**.
    * The system plays the generated TTS audio.
    * **Event Listener:** Once the audio `.onEnded()` fires, `is_tts_playing` is reset to **FALSE**.
18. **The Loop Closes:** The microphone resumes listening for the streamer's reaction to the donation, and the cycle repeats from Phase 2.

---

## 4. Technical Architecture (The "How")

### Recommended Tech Stack
* **Desktop Framework: Tauri (Rust + React/TypeScript)**
  * *Justification:* Negligible CPU/RAM footprint compared to Electron, preserving system resources for the streamer's game, OBS, and local LLM.
* **AI Engine (Hybrid Local & Cloud): Ollama / LM Studio AND Groq / OpenAI**
  * *Justification:* Streamers possess powerful GPUs (e.g., RTX 3000/4000 series). Allowing them to run quantized local models (e.g., *Llama-3-8B-Instruct.gguf*) via standard localhost ports (`11434`) guarantees zero API costs, zero latency, and immunity from corporate API censorship when running "toxic" personas.
* **Speech-to-Text (STT): Whisper.cpp (Local) or Deepgram API**
  * *Justification:* High-speed transcription is critical for real-time reactivity.
* **Local Database: SQLite**
  * *Justification:* Perfect for storing user presets, configuration profiles, and EULA compliance logs locally.

### System Architecture (Data Flow)
The application logic follows a strict linear pipeline to ensure real-time performance and absolute safety:

1. **User Speaks** ➔ Microphone Input.
2. **Mutual Exclusion Check:** Backend evaluates `is_tts_playing`.
   * *If True:* Audio is discarded (flushed).
   * *If False:* Audio is sent to the STT module.
3. **Prompt Generation:** STT Transcript + Context (Tone/Vision) + Persona Settings are packaged.
4. **LLM Inference:** Prompt is sent to the selected endpoint (Local GPU via Ollama or Cloud API). The LLM outputs a JSON array of raw chat messages.
5. **Pre-Render Safety Filter:** The JSON array hits a synchronous Frontend Regex/Dictionary Filter. Any message containing a platform-bannable word is completely dropped.
6. **Virtualization Queue:** Cleaned messages enter the UI rendering queue.
7. **Render:** Messages render on the transparent UI over an immutable 20% opacity watermark.
8. **TTS Event:** If a donation triggers, play TTS audio ➔ Set `is_tts_playing = TRUE` ➔ Pause Mic recording ➔ Resume Mic recording when audio finishes.

---

## 5. Data Schema & Logic

### Key Algorithms & Logic

* **The Local Pre-Render Filter (Content Safety)**
  To protect users from YouTube/Twitch demonetization, we must establish a hard boundary between "toxic trolling" and "TOS-violating hate speech." Before any AI batch reaches the UI queue, it passes through an `npm bad-words` (or custom regex) array.
  * *Execution:* The system opts for **Dropping** rather than **Censoring** (`***`), as dropping mimics reality (Twitch AutoMod silently deleting messages). The AI can say *"Your gameplay is complete garbage,"* but cannot generate bannable slurs.

* **Mutual Exclusion Audio State (Infinite Loop Prevention)**
  Because the app relies on STT, any TTS donations played through the streamer's speakers could be picked up by the microphone, transcribed, and fed back to the AI.
  * *Implementation:* An `AudioStateManager` service in Rust/Node. When TTS audio is queued, `is_tts_playing` becomes `TRUE`. The STT listening buffer is paused. On the TTS `.onEnded()` event, `is_tts_playing` returns to `FALSE`, and the microphone buffer resumes. The AI remains deaf to its own simulated donations.

---

## 6. The Spooling Engine (The "Heart" of the Simulation)

To make the chat feel real, we replace the linear `1000ms / Rate` formula with a **Jittered Poisson Distribution**.

### 6.1. The Base Math (Engagement Decay)
In reality, a stream with 100,000 viewers does not have 1,000x the chat speed of a 100-viewer stream. Engagement rate drops as the room grows.
* **Formula:** `Target_MPS (Messages Per Second) = log10(Viewer_Count) * Engagement_Multiplier`
* *Example:* 100 viewers ≈ 2 MPS | 10,000 viewers ≈ 20 MPS.

### 6.2. Stochastic Timing (The Jitter)
Instead of a message every 50ms, the Spooler uses a **Random Variance Window**:
* `Actual_Delay = Base_Delay * (1 + Random(-0.5, 0.8))`
* This creates "clumps" of messages followed by a half-second of silence, mimicking the way real humans react to visual cues on screen.

### 6.3. Dynamic "Energy" Scaling
The Spooler interacts with the **Audio Analysis Module**:
* **Quiet Streamer:** Spooler reduces `Engagement_Multiplier` by 40%. Chat becomes "lurky."
* **Yelling/Hype Streamer:** Spooler increases `Engagement_Multiplier` by 200% and reduces the Jitter window, creating a "wall of text" effect.

### 6.4. Slow Mode & Emote-Only Logic
* **Slow Mode:** When enabled, the Spooler ignores the calculated `Target_MPS` and enforces a hard `MAX_MPS = 0.5` (1 message every 2 seconds).
* **Emote-Only:** A middleware filter in the queue.

```javascript
if (config.emoteOnly) {
  message.text = ""; // Strip text, keep emote metadata
  if (message.emotes.length === 0) dropMessage(); // Drop if no emotes present
}
```

---

## 7. UI/UX Design Guidelines

### Design Philosophy
**"Frictionless Creator Tool"** – Dark mode by default, mimicking native Twitch/YouTube studio interfaces. The app should feel like a professional broadcast tool, not a toy.

### Core Screens
1. **The Aggressive EULA/TOS Gate (Onboarding):**
   * A plain-English, non-skippable scroll-through window.
   * *"StreamSim is strictly an offline practice and VOD creation tool. It does NOT connect to Twitch/YouTube APIs. Using this tool to intentionally deceive live audiences violates platform Terms of Service. By clicking Accept, you agree not to use StreamSim for live view-botting."*
2. **The Control Center (Main Window):**
   * **AI Engine Toggle:** A prominent switch between "Cloud API" and "Local AI (Ollama)". If Local is selected, an input field for the localhost port appears.
   * Sliders for Viewer Count, TTS Frequency, and Donation Frequency.
   * Persona Selection: (Supportive, Trolls, Meme-lords, Neutral).
   * Bias Toggle: "Agree with me" / "Disagree with me" / "Split 50/50".
   * Speed Controls: "Real-world scaling" slider vs. "Slow Mode" checkbox.
   * Emote-Only: One-click panic button to clear chat and allow only emotes.
   * A large green "Start Simulation" button.
3. **The Overlay (Transparent Window):**
   * A borderless, transparent window featuring the chat text, emotes, and animated alerts.
   * **The Hardcoded Watermark:** A persistent, immutable watermark (e.g., "Powered by StreamSim" or an AI icon) locked at 20% opacity in the corner. Unobtrusive to viewers, but clearly visible to platform moderators.

---

## 8. Security, Scalability & Compliance

### API Security & AI Censorship Mitigation
Relying solely on cloud APIs (OpenAI/Groq) introduces a massive business risk: if users configure the "Haters/Critics" persona to be aggressive, OpenAI's safety filters will flag our API keys, potentially shutting down the app.
* **The Solution:** We mitigate this by making Local LLMs (Ollama) a first-class citizen. This shifts the compute to the user's hardware, fully bypassing corporate AI censorship for high-stress simulation practice, and ensuring zero API key bans for the company.
* **BYOK (Bring Your Own Key):** For users who *do* want to use cloud APIs, they must input their own keys, encrypted locally using the OS's native secure keychain via Tauri plugins.

### Platform Compliance & Anti-Fake Engagement (Legal Protection)
If Twitch or YouTube categorizes StreamSim as a "view-botting" tool, we face domain blocks and cease-and-desist letters. We proactively prove this is a simulation tool via two methods:
1. **The EULA:** Legally binds the user to offline/VOD use cases.
2. **The Watermark:** Ensures any VOD or stream using the tool has a permanent forensic identifier, proving the engagement is simulated and protecting the parent company from platform interference.

### Privacy First
Since the app records audio and takes pictures of the user's room, all processing must be transparent. The UI features a prominent red "Recording" indicator. Vision frames are held in volatile RAM, processed, and immediately destroyed, never saved to the hard disk.

# Addendum: Performance, Memory, and Onboarding

## 1. Automated Hardware Diagnostics & Performance Tiering
To ensure a high-quality user experience (UX) regardless of the user's hardware, the application will implement a **"Boot-Time Benchmarking" (BTB)** module.

### 1.1 The Hardware Probe
Upon the first launch (and after major hardware changes), the Tauri/Rust backend will execute a brief diagnostic:
* **VRAM Assessment:** Identify available Video RAM (via `sysinfo` or `wgpu`).
* **Inference Speed Test:** Run a 10-token test generation using a tiny bundled model (e.g., Danube-1.8B).
* **Resultant Modes:**
  * **Tier A (High-End GPU - 12GB+ VRAM):** Default to Local Llama-3 8B (Q4_K_M).
  * **Tier B (Mid-Range - 6GB-8GB VRAM):** Recommend Local Phi-3 (3.8B) or Llama-3 8B (Highly Quantized).
  * **Tier C (Low-End/Integrated - <4GB VRAM):** Automatically enable **"Low VRAM Mode."**

### 1.2 "Low VRAM Mode" (Cloud-Centric)
For users with mid-to-low-tier PCs (typical of mobile or console-capture streamers), StreamSim will switch to a **Groq-First Architecture**.
* **Why Groq:** Groq’s LPU (Language Processing Unit) offers the ultra-low latency (<50ms) required for real-time chat simulation that matches the speed of a high-end local GPU, but without the local hardware tax.

---

## 2. Rolling Context Window (The "Long-Session" Solution)
A 4-hour stream generates a massive Speech-to-Text (STT) transcript. Attempting to feed the entire transcript into an LLM prompt leads to **Context Bloat**, resulting in high latency, increased token costs, and eventual "hallucinations" as the context window exceeds its limit (e.g., 8k tokens).

### 2.1 Implementation: The FIFO Buffer
The application will utilize a **First-In-First-Out (FIFO) Rolling Context Manager**:
* **Transcript Buffer:** Only the last **90 seconds** of the STT transcript are sent to the LLM.
* **The "Vibe" Summary:** To maintain long-term continuity, a lightweight "Summary Agent" (running every 5 minutes) generates a single-sentence summary of the previous hour (e.g., *"The streamer has been playing Valorant and is currently on a losing streak, feeling frustrated."*).
* **Prompt Assembly:**
  `[System Persona] + [Long-term Vibe Summary] + [Current Tone/Vision Data] + [Last 90s Transcript] = Prompt.`

### 2.2 Benefits
* **Deterministic Latency:** Prompt size remains consistent, ensuring AI responses always arrive within the 2-3 second "Reaction Window."
* **Hardware Efficiency:** Prevents local GPU RAM from being consumed by a growing context KV-cache.

---

## 3. Zero-Friction Setup: "The One-Click Orchestrator"
To avoid the technical hurdles of manual CLI installations (Ollama/LM Studio), StreamSim will feature a **Managed Inference Sidecar**.

### 3.1 Integrated Ollama Management
The Tauri app will serve as an orchestrator for the local environment:
* **Bundled Binary:** The app will include a lightweight installer script for the Ollama backend (hidden from the user).
* **The "One-Click Local Setup" Button:**
  1. Checks for an existing Ollama installation.
  2. If missing, it downloads and initializes the Ollama service as a **background sidecar process** managed by Tauri.
  3. **Silent Model Pull:** The app will automatically run `ollama pull llama3:8b-instruct-q4_0` (or `phi3:latest` for Tier B users) in the background with a progress bar in the UI.
* **Automatic Port Mapping:** The app automatically points its internal fetch requests to `localhost:11434` without the user ever needing to touch a configuration file.

### 3.2 Error Handling & Fallback
If the Local Setup fails (e.g., due to Windows Firewall or lack of disk space), the app will proactively suggest: *"We couldn't initialize your GPU. Switch to Cloud Mode (Groq) for 100% free, high-speed chat?"*

---

## 9. Detailed Data Contracts (Implementation-Oriented)

### 9.1 Runtime Configuration Schema

```json
{
  "engine": {
    "mode": "local|cloud",
    "local": { "provider": "ollama", "baseUrl": "http://localhost:11434", "model": "llama3:8b-instruct-q4_0" },
    "cloud": { "provider": "groq|openai", "model": "<model-id>", "apiKeyRef": "keychain://streamsim/default" }
  },
  "persona": "supportive|trolls|meme_lords|neutral",
  "bias": { "type": "agree|disagree|split", "agreeRatio": 0.7 },
  "audience": { "viewerCount": 10000, "emoteOnly": false, "slowMode": false, "slowModeMaxMps": 0.5 },
  "events": { "ttsEnabled": true, "donationFrequency": 0.15, "ttsVoice": "alloy" },
  "safety": { "dropPolicy": true, "dictionaryVersion": "v1" },
  "capture": { "visionEnabled": true, "visionIntervalSec": 30, "sttProvider": "whispercpp|deepgram" }
}
```

### 9.2 Prompt Payload Contract

```json
{
  "static_context": {
    "persona": "trolls",
    "bias": "split",
    "viewer_count": 10000
  },
  "long_term_vibe": "Streamer has been on a losing streak in Valorant and sounds frustrated.",
  "current_context": {
    "transcript_last_90s": "...",
    "tone": { "rms": 0.62, "wpm": 171, "energy": "hype" },
    "vision_tags": ["wearing headset", "rgb background", "drinking soda"]
  },
  "output_schema": {
    "type": "json_array_of_strings",
    "count_hint": 30,
    "rules": ["return only JSON", "no markdown", "no extra keys"]
  }
}
```

### 9.3 Inference Output Contract

```json
[
  "W CLUTCH incoming",
  "why did you peek that 😭",
  "chat vote: rotate or hold?"
]
```

### 9.4 Internal Queue Item Model

```ts
interface QueueMessage {
  id: string;
  text: string;
  emotes: string[];
  createdAtMs: number;
  deliverAtMs: number;
  source: "llm" | "system" | "donation";
  faction?: "agree" | "disagree" | "neutral";
}
```

---

## 10. Non-Functional Requirements (NFRs)

- **Latency Target:** End-to-end reaction window 2-3s under typical load.
- **Jank-Free Rendering:** Overlay remains smooth at high throughput using virtualization.
- **Resource Budget:** Keep desktop footprint low enough to coexist with OBS + game + optional local LLM.
- **Reliability:** App should recover from transient model/network failures without crash.
- **Observability:** Emit structured logs for each pipeline stage (capture, prompt, inference, filter, spool, render).
- **Privacy-by-Default:** No raw vision frames persisted; microphone/video data processed in-memory unless user explicitly opts in for diagnostics.

---

## 11. Error Handling & Recovery Strategy

### 11.1 Inference Failures
- Local endpoint unavailable -> retry with backoff, then suggest cloud fallback.
- Cloud timeout/rate-limit -> retry with jitter, surface non-blocking warning toast.
- Malformed JSON output -> run strict parser-repair once; if still invalid, discard batch and request regeneration.

### 11.2 Audio Path Failures
- Device disconnect -> auto-rebind default input device.
- `is_tts_playing` stale true beyond playback timeout -> watchdog resets state.

### 11.3 Safety Filter Failures
- If dictionary load fails, enter conservative mode: render only emotes/system messages until filter restored.

### 11.4 Sidecar Failures
- Ollama service start failure -> present guided fallback to cloud mode.
- Model pull interrupted -> resume support where available; otherwise restart with progress UI and cancel option.

---

## 12. Security Controls

- Secrets are never stored in plaintext config files; use OS keychain integration.
- Localhost-only default for sidecar endpoints unless user explicitly changes host.
- EULA acceptance and version are logged locally for compliance auditing.
- Optional diagnostic exports must redact API identifiers and personal speech content by default.

---

## 13. Phased Delivery Plan & Exit Criteria

### Milestone 1 (Core Simulation Loop)
**Scope:** Capture -> STT -> Prompt -> Inference -> Safety Filter -> Render.
**Exit Criteria:**
- Generates and renders contextual chat from voice input.
- Filter drops bannable terms before render.
- Overlay capture works in OBS.

### Milestone 2 (Realism & Control)
**Scope:** Tone-based scaling, stochastic spooling, donation/TTS events, bias factions, slow mode, emote-only.
**Exit Criteria:**
- Chat pacing dynamically adapts to energy state.
- No feedback loop during TTS playback.
- User controls are reflected in runtime behavior immediately.

### Milestone 3 (Onboarding, Hardening, Compliance)
**Scope:** BTB tiering, one-click orchestrator, cloud/local robustness, immutable watermark/EULA polish.
**Exit Criteria:**
- First-run setup chooses sane defaults by hardware tier.
- Fallback path handles local setup failures gracefully.
- Compliance signals are always present in overlay output.

---

## 14. Open Questions / Decisions Log

- Which default cloud model should be selected for Tier C users (cost vs latency tradeoff)?
- Should emote-only mode permit ASCII art or strictly emote tokens?
- What is the first release banlist source of truth (`bad-words`, curated list, or hybrid)?
- Should vision tagging be opt-in at first launch in privacy-sensitive regions?

---

## 15. Acceptance Test Matrix (Traceable)

1. **Hybrid Routing**
   - Given local mode with reachable Ollama, requests route to `localhost:11434`.
   - Given local unavailable, user can switch to cloud mode without restart.
2. **Safety Filter**
   - Given banned slur in generated batch, message is dropped pre-render.
   - Given non-bannable insult, message passes filter.
3. **Audio Mutual Exclusion**
   - While TTS playing, STT ingest remains paused and audio buffers are discarded.
   - On TTS end event, STT resumes.
4. **Spooler Behavior**
   - Inter-arrival timings show jitter rather than fixed cadence.
   - Slow mode enforces max throughput regardless of viewer count.
5. **Overlay Compliance**
   - Watermark remains visible at configured 20% opacity in all themes/resolutions.
6. **Privacy Controls**
   - Vision frames are not persisted to disk by default.
   - Key material remains in secure keychain storage.
