interface StoredVisionFrame {
  dataUrl: string;
  updatedAt: number;
  version: number;
}

class VisionFrameStore {
  private latestFrame: StoredVisionFrame | null = null;
  private nextVersion = 1;

  public setFrame(dataUrl: string): void {
    const trimmed = dataUrl.trim();
    if (!trimmed) return;
    this.latestFrame = { dataUrl: trimmed, updatedAt: Date.now(), version: this.nextVersion++ };
  }

  public getLatestFrame(): StoredVisionFrame | null {
    return this.latestFrame;
  }

  public reset(): void {
    this.latestFrame = null;
    this.nextVersion = 1;
  }
}

export const sharedVisionFrameStore = new VisionFrameStore();
