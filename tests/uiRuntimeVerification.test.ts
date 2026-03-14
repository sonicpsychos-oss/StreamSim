import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/runtimeConfig.js";

const readRepoFile = (relativePath: string) => {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(fullPath, "utf8");
};

describe("runtime verification + monitoring UI wiring", () => {
  it("keeps runtime verification functions and event wiring in app.js", () => {
    const appJs = readRepoFile("src/public/app.js");

    expect(appJs).toContain("function verifyLocalDevices()");
    expect(appJs).toContain("function summarizeRuntime(payload)");
    expect(appJs).toContain('const verifyDevicesBtn = document.getElementById("verifyDevices")');
    expect(appJs).toContain("verifyDevicesBtn.addEventListener(\"click\"");
    expect(appJs).toContain('const liveMonitorEnabled = document.getElementById("liveMonitorEnabled")');
    expect(appJs).toContain("liveMonitorEnabled?.addEventListener(\"change\"");
    expect(appJs).toContain('const liveVideo = document.getElementById("liveVideo")');
    expect(appJs).toContain('const voiceMeter = document.getElementById("voiceMeter")');
  });

  it("keeps runtime verification and live monitor markup IDs in index.html", () => {
    const indexHtml = readRepoFile("src/public/index.html");

    expect(indexHtml).toContain("<h3>Runtime Verification</h3>");
    expect(indexHtml).toContain('id="runtimeSummary"');
    expect(indexHtml).toContain('id="verifyDevices"');
    expect(indexHtml).toContain('id="liveMonitorEnabled"');
    expect(indexHtml).toContain('id="liveMonitorStatus"');
    expect(indexHtml).toContain('id="liveVideo"');
    expect(indexHtml).toContain('id="voiceMeter"');
    expect(indexHtml).toContain('id="deviceChecks"');
  });

  it("keeps status banner and monitoring styles in styles.css", () => {
    const stylesCss = readRepoFile("src/public/styles.css");

    expect(stylesCss).toContain(".status-banner {");
    expect(stylesCss).toContain(".status-banner.success");
    expect(stylesCss).toContain(".live-monitor-toggle");
    expect(stylesCss).toContain(".monitor-status");
    expect(stylesCss).toContain(".live-monitor-grid");
    expect(stylesCss).toContain("#liveVideo");
    expect(stylesCss).toContain("#voiceMeter");
  });

  it("keeps runtime defaults aligned for onboarding + hardware verification", () => {
    expect(defaultConfig.inferenceMode).toBe("openai");
    expect(defaultConfig.capture.useRealCapture).toBe(true);
  });
});
