export class AudioStateManager {
  private isTtsPlaying = false;

  public startTts(): void {
    this.isTtsPlaying = true;
  }

  public stopTts(): void {
    this.isTtsPlaying = false;
  }

  public canListenToMic(): boolean {
    return !this.isTtsPlaying;
  }

  public getState(): { isTtsPlaying: boolean; micListening: boolean } {
    return {
      isTtsPlaying: this.isTtsPlaying,
      micListening: !this.isTtsPlaying
    };
  }
}
