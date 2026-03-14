export class AudioStateManager {
  private isTtsPlaying = false;
  private ttsStartedAtMs = 0;

  public startTts(): void {
    this.isTtsPlaying = true;
    this.ttsStartedAtMs = Date.now();
  }

  public stopTts(): void {
    this.isTtsPlaying = false;
    this.ttsStartedAtMs = 0;
  }

  public markDeviceDisconnect(): void {
    this.stopTts();
  }

  public forceResetIfStale(maxTtsMs: number): boolean {
    if (!this.isTtsPlaying) return false;
    if (Date.now() - this.ttsStartedAtMs <= maxTtsMs) return false;
    this.stopTts();
    return true;
  }

  public canListenToMic(): boolean {
    return !this.isTtsPlaying;
  }

  public getState(): { isTtsPlaying: boolean; micListening: boolean; ttsAgeMs: number } {
    return {
      isTtsPlaying: this.isTtsPlaying,
      micListening: !this.isTtsPlaying,
      ttsAgeMs: this.isTtsPlaying ? Date.now() - this.ttsStartedAtMs : 0
    };
  }
}
