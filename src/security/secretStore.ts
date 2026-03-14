export class SecretStore {
  public getCloudApiKey(): string {
    return process.env.STREAMSIM_CLOUD_API_KEY ?? "";
  }

  public diagnostics(): { keychainBacked: boolean; hasCloudKey: boolean } {
    return {
      keychainBacked: false,
      hasCloudKey: Boolean(this.getCloudApiKey())
    };
  }
}
