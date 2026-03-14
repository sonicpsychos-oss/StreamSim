import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ObservabilityLogger } from "../src/services/observability.js";

describe("NFR instrumentation + privacy defaults", () => {
  it("records full-loop SLO metadata in observability stream", () => {
    const logger = new ObservabilityLogger();
    logger.log("pipeline_tick", { latencyMs: 1200, captureLatencyMs: 80, inferenceLatencyMs: 500, targetDelayMs: 600 });

    const filePath = path.resolve(process.cwd(), "data/observability.log");
    const tail = fs.readFileSync(filePath, "utf8").trim().split("\n").at(-1) ?? "{}";
    const event = JSON.parse(tail) as Record<string, unknown>;

    expect(event.event).toBe("pipeline_tick");
    expect(event.captureLatencyMs).toBe(80);
    expect(event.inferenceLatencyMs).toBe(500);
  });

  it("validates privacy-by-default frame persistence assumptions", () => {
    const captureDir = path.resolve(process.cwd(), "data/capture");
    expect(fs.existsSync(captureDir)).toBe(false);
  });
});
