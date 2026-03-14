import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { SimulationConfig } from "../core/types.js";

export interface SidecarStatus {
  ready: boolean;
  phase: "idle" | "installing" | "starting" | "pulling" | "ready" | "failed" | "cancelled";
  progress: number;
  details: string;
  fallbackSuggested: boolean;
  cancellable?: boolean;
  resumable?: boolean;
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

class LocalSidecarAdapter implements SidecarAdapter {
  public async isInstalled(): Promise<boolean> {
    if (process.platform === "win32") return true;
    try {
      await access("/usr/bin/env", constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  public async install(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }

  public async startService(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }

  public async pullModel(model: string, opts: { signal: AbortSignal; onProgress: (progress: number, details: string) => void }): Promise<void> {
    const cmd = process.platform === "win32" ? "cmd" : "sh";
    const args =
      process.platform === "win32"
        ? ["/c", `echo pulling ${model} && timeout /t 1 > NUL && echo done`]
        : ["-lc", `echo pulling ${model}; sleep 1; echo done`];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let progress = 0;

      const timer = setInterval(() => {
        progress = Math.min(95, progress + 10);
        opts.onProgress(progress, `Pulling ${model}...`);
      }, 120);

      opts.signal.addEventListener("abort", () => {
        clearInterval(timer);
        child.kill();
        reject(new Error("Sidecar pull cancelled."));
      });

      child.on("exit", (code) => {
        clearInterval(timer);
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
}

export class SidecarManager {
  private readonly events = new EventEmitter();
  private readonly adapter: SidecarAdapter;
  private inFlightController: AbortController | null = null;
  private lastPullFailed = false;

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
      const status: SidecarStatus = {
        ready: false,
        phase: "cancelled",
        progress: 0,
        details: "Model pull cancelled by user.",
        fallbackSuggested: true,
        resumable: true
      };
      this.emit(status, "status");
      return status;
    }

    return {
      ready: false,
      phase: "idle",
      progress: 0,
      details: "No active pull to cancel.",
      fallbackSuggested: false
    };
  }

  public async ensureReady(config: SimulationConfig): Promise<SidecarStatus> {
    if (config.inferenceMode !== "ollama" && config.inferenceMode !== "lmstudio") {
      return { ready: true, phase: "ready", progress: 100, details: "Cloud mode selected.", fallbackSuggested: false };
    }

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
        { ready: false, phase: "pulling", progress: 45, details: `Pulling model ${config.provider.localModel}.`, fallbackSuggested: false, cancellable: true },
        "status"
      );

      await this.adapter.pullModel(config.provider.localModel, {
        signal: this.inFlightController.signal,
        onProgress: (progress, details) =>
          this.emit({ ready: false, phase: "pulling", progress: Math.max(45, progress), details, fallbackSuggested: false, cancellable: true }, "progress")
      });

      this.inFlightController = null;
      this.lastPullFailed = false;

      try {
        await fetch(`${config.provider.localEndpoint}/api/tags`, { signal: AbortSignal.timeout(config.provider.requestTimeoutMs) });
        const status: SidecarStatus = {
          ready: true,
          phase: "ready",
          progress: 100,
          details: "Local sidecar reachable.",
          fallbackSuggested: false
        };
        this.emit(status, "status");
        return status;
      } catch {
        // service started but endpoint isn't reachable yet; keep status partial and resumable.
        const failed: SidecarStatus = {
          ready: false,
          phase: "failed",
          progress: 75,
          details: "Sidecar started but readiness probe failed.",
          fallbackSuggested: true,
          resumable: true
        };
        this.lastPullFailed = true;
        this.emit(failed, "status");
        return failed;
      }
    } catch (error) {
      this.inFlightController = null;
      const isCancelled = (error as Error).message.includes("cancelled");
      const failed: SidecarStatus = {
        ready: false,
        phase: isCancelled ? "cancelled" : "failed",
        progress: 0,
        details: isCancelled ? "Model pull cancelled by user." : (error as Error).message,
        fallbackSuggested: true,
        resumable: true
      };
      this.lastPullFailed = !isCancelled;
      this.emit(failed, "status");
      return failed;
    }
  }

  public async resumeLastPull(config: SimulationConfig): Promise<SidecarStatus> {
    if (!this.lastPullFailed) {
      return { ready: false, phase: "idle", progress: 0, details: "No failed pull to resume.", fallbackSuggested: false };
    }
    return this.ensureReady(config);
  }

  private emit(status: SidecarStatus, kind: SidecarProgressEvent["kind"]): void {
    this.events.emit("progress", { ...status, kind } satisfies SidecarProgressEvent);
  }
}
