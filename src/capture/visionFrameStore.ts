interface StoredVisionFrame {
  dataUrl: string;
  updatedAt: number;
}

class VisionFrameStore {
  private latestFrame: StoredVisionFrame | null = null;

  public setFrame(dataUrl: string): void {
    const trimmed = dataUrl.trim();
    if (!trimmed) return;
    this.latestFrame = { dataUrl: trimmed, updatedAt: Date.now() };
  }

  public getLatestFrame(): StoredVisionFrame | null {
    return this.latestFrame;
  }

  public reset(): void {
    this.latestFrame = null;
  }
}

export const sharedVisionFrameStore = new VisionFrameStore();
