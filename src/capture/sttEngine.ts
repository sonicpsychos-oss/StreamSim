import { sharedDeviceCapturePipeline } from "./deviceCapturePipeline.js";

export interface SttEngine {
  pause(): void;
  resume(): void;
  state(): { paused: boolean };
}

export class DeviceSttEngine implements SttEngine {
  private paused = false;

  public pause(): void {
    this.paused = true;
    sharedDeviceCapturePipeline.setMicPaused(true);
  }

  public resume(): void {
    this.paused = false;
    sharedDeviceCapturePipeline.setMicPaused(false);
  }

  public state(): { paused: boolean } {
    return { paused: this.paused };
  }
}

export const sharedSttEngine = new DeviceSttEngine();
