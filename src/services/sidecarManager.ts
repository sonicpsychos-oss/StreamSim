import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SimulationConfig } from "../core/types.js";

export type SidecarErrorClass =
  | "install_failed"
  | "service_start_failed"
  | "pull_failed"
  | "pull_cancelled"
  | "network_unreachable"
  | "permission_denied"
  | "unknown";

export interface SidecarStatus {
  ready: boolean;
  phase: "idle" | "installing" | "starting" | "pulling" | "ready" | "failed" | "cancelled";
  progress: number;
  details: string;
  fallbackSuggested: boolean;
  cancellable?: boolean;
  resumable?: boolean;
  errorClass?: SidecarErrorClass;
  uxAction?: "retry" | "switch_to_cloud" | "check_permissions" | "wait_and_retry";
}

export interface SidecarProgressEvent extends SidecarStatus {
  kind: "status" | "progress";
}

interface SidecarAdapter {
  isInstalled(): Promise<boolean>;
  install(): Promise<void>;
  startService(): Promise<void>;
  pullModel(model: string, opts: { signal: AbortSignal; onProgress: (progress: number, details: string) => void }): Promise<void>;
}

type PullCheckpoint = { model: string; progress: number; updatedAt: string; state: "running" | "failed" | "cancelled" | "completed" };

class LocalSidecarAdapter implements SidecarAdapter {
  public async isInstalled(): Promise<boolean> {
    const result = await this.runShell(this.platformCommand("ollama --version", "ollama --version", "ollama --version"), true);
    return result.code === 0;
  }

  public async install(): Promise<void> {
    if (process.env.STREAMSIM_SIDECAR_DRY_RUN === "1") return;
    const command = this.platformCommand(
      "winget install -e --id Ollama.Ollama --silent",
      "curl -fsSL https://ollama.com/install.sh | sh",
      "curl -fsSL https://ollama.com/install.sh | sh"
    );
    const result = await this.runShell(command, true);
    if (result.code !== 0) throw new Error(`Sidecar install failed: ${result.stderr || result.stdout}`);
  }

  public async startService(): Promise<void> {
    if (process.env.STREAMSIM_SIDECAR_DRY_RUN === "1") return;
    const command = this.platformCommand(
      "powershell -Command \"Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden\"",
      "nohup ollama serve >/tmp/streamsim-ollama.log 2>&1 &",
      "nohup ollama serve >/tmp/streamsim-ollama.log 2>&1 &"
    );
    const result = await this.runShell(command, true);
    if (result.code !== 0) throw new Error(`Sidecar start failed: ${result.stderr || result.stdout}`);
  }

  public async pullModel(model: string, opts: { signal: AbortSignal; onProgress: (progress: number, details: string) => void }): Promise<void> {
    if (process.env.STREAMSIM_SIDECAR_DRY_RUN === "1") {
      for (const p of [20, 50, 80, 100]) opts.onProgress(p, `Pulling ${model} (${p}%)`);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn("ollama", ["pull", model], { stdio: ["ignore", "pipe", "pipe"] });
      let lastProgress = 0;
      const onLine = (line: string) => {
        const match = line.match(/(\d{1,3})%/);
        if (match) {
          lastProgress = Math.max(lastProgress, Math.min(100, Number(match[1])));
          opts.onProgress(lastProgress, `Pulling ${model} (${lastProgress}%)`);
        }
      };

      child.stdout.on("data", (chunk) => String(chunk).split(/\r?\n/).forEach(onLine));
      child.stderr.on("data", (chunk) => String(chunk).split(/\r?\n/).forEach(onLine));

      opts.signal.addEventListener("abort", () => {
        child.kill();
        reject(new Error("Sidecar pull cancelled."));
      });

      child.on("exit", (code) => {
        if (code === 0) {
          opts.onProgress(100, `Model ${model} ready.`);
          resolve();
          return;
        }
        reject(new Error(`Model pull exited with code ${code ?? -1}.`));
      });
      child.on("error", reject);
    });
  }

  private platformCommand(win: string, linux: string, mac: string): string {
    if (process.platform === "win32") return win;
    return process.platform === "darwin" ? mac : linux;
  }

  private async runShell(command: string, quiet = false): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const shell = process.platform === "win32" ? "cmd" : "sh";
    const args = process.platform === "win32" ? ["/c", command] : ["-lc", command];
    return await new Promise((resolve) => {
      const child = spawn(shell, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += String(chunk)));
      child.stderr.on("data", (chunk) => (stderr += String(chunk)));
      child.on("exit", (code) => {
        if (!quiet && stderr) {
          // eslint-disable-next-line no-console
          console.warn(stderr);
        }
        resolve({ code, stdout, stderr });
      });
    });
  }
}

export class SidecarManager {
  private readonly events = new EventEmitter();
  private readonly adapter: SidecarAdapter;
  private inFlightController: AbortController | null = null;
  private lastPullFailed = false;
  private readonly checkpointPath = path.resolve(process.cwd(), "data/sidecar-pull-state.json");

  constructor(adapter: SidecarAdapter = new LocalSidecarAdapter()) {
    this.adapter = adapter;
  }

  public onProgress(listener: (event: SidecarProgressEvent) => void): () => void {
    this.events.on("progress", listener);
    return () => this.events.off("progress", listener);
  }

  public cancelPull(): SidecarStatus {
    if (this.inFlightController) {
      this.inFlightController.abort();
      this.inFlightController = null;
      this.persistCheckpoint({ model: "unknown", progress: 0, updatedAt: new Date().toISOString(), state: "cancelled" });
      const status: SidecarStatus = {
        ready: false,
        phase: "cancelled",
        progress: 0,
        details: "Model pull cancelled by user.",
        fallbackSuggested: true,
        resumable: true,
        errorClass: "pull_cancelled",
        uxAction: "retry"
      };
      this.emit(status, "status");
      return status;
    }

    return { ready: false, phase: "idle", progress: 0, details: "No active pull to cancel.", fallbackSuggested: false };
  }

  public async ensureReady(config: SimulationConfig): Promise<SidecarStatus> {
    if (config.inferenceMode !== "ollama" && config.inferenceMode !== "lmstudio") {
      return { ready: true, phase: "ready", progress: 100, details: "Cloud mode selected.", fallbackSuggested: false };
    }

    const checkpoint = this.readCheckpoint();
    const checkpointProgress = checkpoint?.model === config.provider.localModel ? checkpoint.progress : 0;
    let latestProgress = checkpointProgress;

    try {
      this.emit({ ready: false, phase: "starting", progress: 5, details: "Checking local sidecar installation.", fallbackSuggested: false }, "status");
      if (!(await this.adapter.isInstalled())) {
        this.emit({ ready: false, phase: "installing", progress: 10, details: "Installing local sidecar.", fallbackSuggested: false }, "status");
        await this.adapter.install();
      }

      this.emit({ ready: false, phase: "starting", progress: 35, details: "Starting local sidecar service.", fallbackSuggested: false }, "status");
      await this.adapter.startService();

      this.inFlightController = new AbortController();
      this.emit(
        {
          ready: false,
          phase: "pulling",
          progress: Math.max(45, checkpointProgress),
          details: checkpointProgress > 0 ? `Resuming model pull from ${checkpointProgress}%.` : `Pulling model ${config.provider.localModel}.`,
          fallbackSuggested: false,
          cancellable: true
        },
        "status"
      );

      await this.adapter.pullModel(config.provider.localModel, {
        signal: this.inFlightController.signal,
        onProgress: (progress, details) => {
          const normalized = Math.max(45, progress);
          latestProgress = normalized;
          this.persistCheckpoint({ model: config.provider.localModel, progress: normalized, updatedAt: new Date().toISOString(), state: "running" });
          this.emit({ ready: false, phase: "pulling", progress: normalized, details, fallbackSuggested: false, cancellable: true }, "progress");
        }
      });

      this.inFlightController = null;
      this.lastPullFailed = false;
      this.persistCheckpoint({ model: config.provider.localModel, progress: 100, updatedAt: new Date().toISOString(), state: "completed" });

      await fetch(`${config.provider.localEndpoint}/api/tags`, { signal: AbortSignal.timeout(config.provider.requestTimeoutMs) });
      const status: SidecarStatus = { ready: true, phase: "ready", progress: 100, details: "Local sidecar reachable.", fallbackSuggested: false };
      this.emit(status, "status");
      return status;
    } catch (error) {
      this.inFlightController = null;
      const mapped = this.mapError(error);
      this.lastPullFailed = mapped.errorClass !== "pull_cancelled";
      this.persistCheckpoint({ model: config.provider.localModel, progress: latestProgress, updatedAt: new Date().toISOString(), state: mapped.errorClass === "pull_cancelled" ? "cancelled" : "failed" });
      const failed: SidecarStatus = {
        ready: false,
        phase: mapped.errorClass === "pull_cancelled" ? "cancelled" : "failed",
        progress: latestProgress,
        details: mapped.details,
        fallbackSuggested: true,
        resumable: true,
        errorClass: mapped.errorClass,
        uxAction: mapped.uxAction
      };
      this.emit(failed, "status");
      return failed;
    }
  }

  public async resumeLastPull(config: SimulationConfig): Promise<SidecarStatus> {
    const checkpoint = this.readCheckpoint();
    if (!this.lastPullFailed && checkpoint?.state !== "failed" && checkpoint?.state !== "cancelled") {
      return { ready: false, phase: "idle", progress: 0, details: "No failed pull to resume.", fallbackSuggested: false };
    }
    return this.ensureReady(config);
  }

  private emit(status: SidecarStatus, kind: SidecarProgressEvent["kind"]): void {
    this.events.emit("progress", { ...status, kind } satisfies SidecarProgressEvent);
  }

  private persistCheckpoint(checkpoint: PullCheckpoint): void {
    fs.mkdirSync(path.dirname(this.checkpointPath), { recursive: true });
    fs.writeFileSync(this.checkpointPath, JSON.stringify(checkpoint, null, 2));
  }

  private readCheckpoint(): PullCheckpoint | null {
    try {
      return JSON.parse(fs.readFileSync(this.checkpointPath, "utf8")) as PullCheckpoint;
    } catch {
      return null;
    }
  }

  private mapError(error: unknown): { errorClass: SidecarErrorClass; details: string; uxAction: SidecarStatus["uxAction"] } {
    const message = (error as Error)?.message ?? "Unknown sidecar error";
    if (/cancelled/i.test(message)) return { errorClass: "pull_cancelled", details: message, uxAction: "retry" };
    if (/install/i.test(message)) return { errorClass: "install_failed", details: message, uxAction: "switch_to_cloud" };
    if (/start/i.test(message)) return { errorClass: "service_start_failed", details: message, uxAction: "wait_and_retry" };
    if (/permission|access denied|eacces/i.test(message)) return { errorClass: "permission_denied", details: message, uxAction: "check_permissions" };
    if (/network|connect|ENOTFOUND|ECONNREFUSED/i.test(message)) return { errorClass: "network_unreachable", details: message, uxAction: "switch_to_cloud" };
    if (/pull|model/i.test(message)) return { errorClass: "pull_failed", details: message, uxAction: "retry" };
    return { errorClass: "unknown", details: message, uxAction: "switch_to_cloud" };
  }
}
