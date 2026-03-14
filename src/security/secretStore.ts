import { execFileSync } from "node:child_process";

const SERVICE_NAME = "streamsim";
const ACCOUNT_NAME = "cloud-api-key";

export interface SecretStoreDiagnostics {
  keychainBacked: boolean;
  hasCloudKey: boolean;
  provider: string;
  available: boolean;
  warning?: string;
}

interface SecretProvider {
  name: string;
  isAvailable(): { ok: boolean; warning?: string };
  read(): string;
  write(value: string): boolean;
}

function hasBinary(command: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

class DarwinKeychainProvider implements SecretProvider {
  public readonly name = "macos-keychain";

  public isAvailable(): { ok: boolean; warning?: string } {
    return hasBinary("security") ? { ok: true } : { ok: false, warning: "macOS keychain binary 'security' is unavailable." };
  }

  public read(): string {
    return runCommand("security", ["find-generic-password", "-s", SERVICE_NAME, "-a", ACCOUNT_NAME, "-w"]);
  }

  public write(value: string): boolean {
    runCommand("security", ["add-generic-password", "-U", "-s", SERVICE_NAME, "-a", ACCOUNT_NAME, "-w", value]);
    return true;
  }
}

class LinuxSecretToolProvider implements SecretProvider {
  public readonly name = "linux-secret-tool";

  public isAvailable(): { ok: boolean; warning?: string } {
    return hasBinary("secret-tool") ? { ok: true } : { ok: false, warning: "Install libsecret tools (secret-tool) to store cloud keys securely." };
  }

  public read(): string {
    return runCommand("secret-tool", ["lookup", "service", SERVICE_NAME, "account", ACCOUNT_NAME]);
  }

  public write(value: string): boolean {
    runCommand("secret-tool", ["store", "--label=StreamSim Cloud API Key", "service", SERVICE_NAME, "account", ACCOUNT_NAME, value]);
    return true;
  }
}

class WindowsCredentialProvider implements SecretProvider {
  public readonly name = "windows-credential-manager";

  public isAvailable(): { ok: boolean; warning?: string } {
    if (!hasBinary("powershell")) return { ok: false, warning: "PowerShell is unavailable. Cannot access Windows Credential Manager." };
    try {
      const moduleCheck = runCommand("powershell", [
        "-NoProfile",
        "-Command",
        "if(Get-Module -ListAvailable -Name CredentialManager){'ok'}"
      ]);
      if (moduleCheck !== "ok") {
        return { ok: false, warning: "PowerShell CredentialManager module missing. Install-Module CredentialManager to enable secure key storage." };
      }
      return { ok: true };
    } catch {
      return { ok: false, warning: "Unable to verify PowerShell CredentialManager module." };
    }
  }

  public read(): string {
    return runCommand("powershell", [
      "-NoProfile",
      "-Command",
      "$cred=Get-StoredCredential -Target 'streamsim-cloud-api-key'; if($cred){$cred.GetNetworkCredential().Password}"
    ]);
  }

  public write(value: string): boolean {
    runCommand("powershell", [
      "-NoProfile",
      "-Command",
      `$secret=ConvertTo-SecureString '${value.replace(/'/g, "''")}' -AsPlainText -Force; ` +
        "$cred=New-Object System.Management.Automation.PSCredential('streamsim',$secret); " +
        "New-StoredCredential -Target 'streamsim-cloud-api-key' -UserName 'streamsim' -Password $cred.GetNetworkCredential().Password -Persist LocalMachine"
    ]);
    return true;
  }
}

class UnsupportedProvider implements SecretProvider {
  public readonly name = "unsupported";
  public isAvailable(): { ok: boolean; warning?: string } {
    return { ok: false, warning: `Unsupported platform for keychain storage: ${process.platform}` };
  }
  public read(): string {
    return "";
  }
  public write(): boolean {
    return false;
  }
}

function createProvider(): SecretProvider {
  if (process.platform === "darwin") return new DarwinKeychainProvider();
  if (process.platform === "linux") return new LinuxSecretToolProvider();
  if (process.platform === "win32") return new WindowsCredentialProvider();
  return new UnsupportedProvider();
}

export class SecretStore {
  private readonly provider = createProvider();

  public getCloudApiKey(): string {
    const fromKeychain = this.getCloudApiKeyFromKeychain();
    if (fromKeychain) return fromKeychain;
    return process.env.STREAMSIM_CLOUD_API_KEY ?? "";
  }

  public setCloudApiKey(value: string): boolean {
    return this.setCloudApiKeyInKeychain(value);
  }

  public diagnostics(): SecretStoreDiagnostics {
    const availability = this.provider.isAvailable();
    const keychainValue = this.getCloudApiKeyFromKeychain();
    return {
      keychainBacked: Boolean(keychainValue),
      hasCloudKey: Boolean(keychainValue || process.env.STREAMSIM_CLOUD_API_KEY),
      provider: this.provider.name,
      available: availability.ok,
      warning: availability.warning
    };
  }

  private getCloudApiKeyFromKeychain(): string {
    const availability = this.provider.isAvailable();
    if (!availability.ok) return "";
    try {
      return this.provider.read();
    } catch {
      return "";
    }
  }

  private setCloudApiKeyInKeychain(value: string): boolean {
    const availability = this.provider.isAvailable();
    if (!availability.ok) return false;
    try {
      return this.provider.write(value);
    } catch {
      return false;
    }
  }
}

export function evaluateSecretProviderCapabilities(platform: NodeJS.Platform, availableCommands: string[]): { available: boolean; warning?: string } {
  const has = (cmd: string) => availableCommands.includes(cmd);
  if (platform === "darwin") return has("security") ? { available: true } : { available: false, warning: "macOS keychain binary 'security' is unavailable." };
  if (platform === "linux") return has("secret-tool") ? { available: true } : { available: false, warning: "Install libsecret tools (secret-tool) to store cloud keys securely." };
  if (platform === "win32") {
    if (!has("powershell")) return { available: false, warning: "PowerShell is unavailable. Cannot access Windows Credential Manager." };
    if (!has("CredentialManager")) {
      return { available: false, warning: "PowerShell CredentialManager module missing. Install-Module CredentialManager to enable secure key storage." };
    }
    return { available: true };
  }
  return { available: false, warning: `Unsupported platform for keychain storage: ${platform}` };
}
