import { execFileSync } from "node:child_process";

const SERVICE_NAME = "streamsim";
const ACCOUNT_NAME = "cloud-api-key";

function runCommand(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export class SecretStore {
  public getCloudApiKey(): string {
    const fromKeychain = this.getCloudApiKeyFromKeychain();
    if (fromKeychain) return fromKeychain;
    return process.env.STREAMSIM_CLOUD_API_KEY ?? "";
  }

  public setCloudApiKey(value: string): boolean {
    return this.setCloudApiKeyInKeychain(value);
  }

  public diagnostics(): { keychainBacked: boolean; hasCloudKey: boolean } {
    const keychainValue = this.getCloudApiKeyFromKeychain();
    return {
      keychainBacked: Boolean(keychainValue),
      hasCloudKey: Boolean(keychainValue || process.env.STREAMSIM_CLOUD_API_KEY)
    };
  }

  private getCloudApiKeyFromKeychain(): string {
    try {
      if (process.platform === "darwin") {
        return runCommand("security", ["find-generic-password", "-s", SERVICE_NAME, "-a", ACCOUNT_NAME, "-w"]);
      }
      if (process.platform === "linux") {
        return runCommand("secret-tool", ["lookup", "service", SERVICE_NAME, "account", ACCOUNT_NAME]);
      }
      if (process.platform === "win32") {
        return runCommand("powershell", [
          "-NoProfile",
          "-Command",
          "$cred=Get-StoredCredential -Target 'streamsim-cloud-api-key'; if($cred){$cred.GetNetworkCredential().Password}"
        ]);
      }
    } catch {
      return "";
    }
    return "";
  }

  private setCloudApiKeyInKeychain(value: string): boolean {
    try {
      if (process.platform === "darwin") {
        runCommand("security", ["add-generic-password", "-U", "-s", SERVICE_NAME, "-a", ACCOUNT_NAME, "-w", value]);
        return true;
      }
      if (process.platform === "linux") {
        runCommand("secret-tool", ["store", "--label=StreamSim Cloud API Key", "service", SERVICE_NAME, "account", ACCOUNT_NAME, value]);
        return true;
      }
      if (process.platform === "win32") {
        runCommand("powershell", [
          "-NoProfile",
          "-Command",
          `$secret=ConvertTo-SecureString '${value.replace(/'/g, "''")}' -AsPlainText -Force; ` +
            "$cred=New-Object System.Management.Automation.PSCredential('streamsim',$secret); " +
            "New-StoredCredential -Target 'streamsim-cloud-api-key' -UserName 'streamsim' -Password $cred.GetNetworkCredential().Password -Persist LocalMachine"
        ]);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
}
