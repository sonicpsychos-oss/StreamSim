import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SimulationConfig } from "./core/types.js";
import { SimulationOrchestrator } from "./services/simulationOrchestrator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let config: SimulationConfig = {
  viewerCount: 100,
  engagementMultiplier: 1,
  slowMode: false,
  emoteOnly: false,
  persona: "supportive",
  bias: "split",
  donationFrequency: 0.08,
  ttsEnabled: true
};

const sseClients = new Set<express.Response>();
const emit = (event: string, payload: unknown) => {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach((client) => client.write(data));
};

const orchestrator = new SimulationOrchestrator(
  () => config,
  (messages) => emit("messages", messages),
  (meta) => emit("meta", meta)
);

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);
  res.write(`event: watermark\ndata: ${JSON.stringify({ text: "Powered by StreamSim", opacity: 0.2 })}\n\n`);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

app.post("/api/config", (req, res) => {
  config = { ...config, ...req.body };
  res.json({ ok: true, config });
});

app.post("/api/start", (_req, res) => {
  orchestrator.start();
  res.json({ ok: true });
});

app.post("/api/stop", (_req, res) => {
  orchestrator.stop();
  res.json({ ok: true });
});

app.get("/api/status", (_req, res) => {
  res.json({ config, audioState: orchestrator.getAudioState() });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 4173);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`StreamSim running on http://localhost:${port}`);
});
