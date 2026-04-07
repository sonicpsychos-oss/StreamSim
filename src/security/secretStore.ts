import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SERVICE_NAME = "streamsim";
const CLOUD_ACCOUNT_NAME = "cloud-api-key";
const DEEPGRAM_ACCOUNT_NAME = "deepgram-api-key";
const OPENAI_STT_ACCOUNT_NAME = "openai-stt-api-key";
const SECRET_FILE_PATH = path.join(os.homedir(), ".streamsim", "secrets.json");

type SecretKeyName = "STREAMSIM_CLOUD_API_KEY" | "DEEPGRAM_API_KEY" | "STREAMSIM_OPENAI_STT_API_KEY";

export interface SecretStoreDiagnostics {
  keychainBacked: boolean;
  hasCloudKey: boolean;
  hasDeepgramKey: boolean;
  hasOpenAiSttKey: boolean;
  provider: string;
  available: boolean;
  warning?: string;
}

interface SecretProvider {
  name: string;
  isAvailable(): { ok: boolean; warning?: string };
  read(account: string): string;
  write(account: string, label: string, value: string): boolean;
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

  public read(account: string): string {
    return runCommand("security", ["find-generic-password", "-s", SERVICE_NAME, "-a", account, "-w"]);
  }

  public write(account: string, _label: string, value: string): boolean {
    runCommand("security", ["add-generic-password", "-U", "-s", SERVICE_NAME, "-a", account, "-w", value]);
    return true;
  }
}

class LinuxSecretToolProvider implements SecretProvider {
  public readonly name = "linux-secret-tool";

  public isAvailable(): { ok: boolean; warning?: string } {
    return hasBinary("secret-tool") ? { ok: true } : { ok: false, warning: "Install libsecret tools (secret-tool) to store cloud keys securely." };
  }

  public read(account: string): string {
    return runCommand("secret-tool", ["lookup", "service", SERVICE_NAME, "account", account]);
  }

  public write(account: string, label: string, value: string): boolean {
    runCommand("secret-tool", ["store", `--label=${label}`, "service", SERVICE_NAME, "account", account, value]);
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

  public read(account: string): string {
    return runCommand("powershell", [
      "-NoProfile",
      "-Command",
      `$cred=Get-StoredCredential -Target 'streamsim-${account}'; if($cred){$cred.GetNetworkCredential().Password}`
    ]);
  }

  public write(account: string, _label: string, value: string): boolean {
    runCommand("powershell", [
      "-NoProfile",
      "-Command",
      `$secret=ConvertTo-SecureString '${value.replace(/'/g, "''")}' -AsPlainText -Force; ` +
        "$cred=New-Object System.Management.Automation.PSCredential('streamsim',$secret); " +
        `New-StoredCredential -Target 'streamsim-${account}' -UserName 'streamsim' -Password $cred.GetNetworkCredential().Password -Persist LocalMachine`
    ]);
    return true;
  }
}

class UnsupportedProvider implements SecretProvider {
  public readonly name = "unsupported";
  public isAvailable(): { ok: boolean; warning?: string } {
    return { ok: false, warning: `Unsupported platform for keychain storage: ${process.platform}` };
  }
  public read(_account: string): string {
    return "";
  }
  public write(_account: string, _label: string, _value: string): boolean {
    return false;
  }
}

function createProvider(): SecretProvider {
  if (process.platform === "darwin") return new DarwinKeychainProvider();
  if (process.platform === "linux") return new LinuxSecretToolProvider();
  if (process.platform === "win32") return new WindowsCredentialProvider();
  return new UnsupportedProvider();
}

function readFileSecrets(): Partial<Record<SecretKeyName, string>> {
  try {
    const raw = readFileSync(SECRET_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Record<SecretKeyName, string>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeFileSecrets(nextValues: Partial<Record<SecretKeyName, string>>): boolean {
  try {
    mkdirSync(path.dirname(SECRET_FILE_PATH), { recursive: true });
    writeFileSync(SECRET_FILE_PATH, JSON.stringify(nextValues, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export class SecretStore {
  private readonly provider = createProvider();

  public getCloudApiKey(): string {
    return this.getSecretValue("STREAMSIM_CLOUD_API_KEY", CLOUD_ACCOUNT_NAME, ["STREAMSIM_CLOUD_API_KEY"]);
  }

  public setCloudApiKey(value: string): boolean {
    return this.setSecretValue("STREAMSIM_CLOUD_API_KEY", CLOUD_ACCOUNT_NAME, "StreamSim Cloud API Key", value);
  }

  public getDeepgramApiKey(): string {
    return this.getSecretValue("DEEPGRAM_API_KEY", DEEPGRAM_ACCOUNT_NAME, ["DEEPGRAM_API_KEY", "STREAMSIM_DEEPGRAM_API_KEY"]);
  }

  public setDeepgramApiKey(value: string): boolean {
    return this.setSecretValue("DEEPGRAM_API_KEY", DEEPGRAM_ACCOUNT_NAME, "StreamSim Deepgram API Key", value);
  }

  public getOpenAiSttApiKey(): string {
    return this.getSecretValue("STREAMSIM_OPENAI_STT_API_KEY", OPENAI_STT_ACCOUNT_NAME, [
      "STREAMSIM_OPENAI_STT_API_KEY",
      "STREAMSIM_OPENAI_API_KEY",
      "OPENAI_API_KEY"
    ]);
  }

  public setOpenAiSttApiKey(value: string): boolean {
    return this.setSecretValue("STREAMSIM_OPENAI_STT_API_KEY", OPENAI_STT_ACCOUNT_NAME, "StreamSim OpenAI STT API Key", value);
  }

  public hasKey(name: SecretKeyName): boolean {
    if (name === "DEEPGRAM_API_KEY") return Boolean(this.getDeepgramApiKey());
    if (name === "STREAMSIM_OPENAI_STT_API_KEY") return Boolean(this.getOpenAiSttApiKey());
    return Boolean(this.getCloudApiKey());
  }

  public diagnostics(): SecretStoreDiagnostics {
    const availability = this.provider.isAvailable();
    const cloudKeychainValue = this.getKeyFromKeychain(CLOUD_ACCOUNT_NAME);
    const deepgramKeychainValue = this.getKeyFromKeychain(DEEPGRAM_ACCOUNT_NAME);
    const openAiSttKeychainValue = this.getKeyFromKeychain(OPENAI_STT_ACCOUNT_NAME);
    const fromFile = readFileSecrets();
    return {
      keychainBacked: Boolean(cloudKeychainValue || deepgramKeychainValue || openAiSttKeychainValue),
      hasCloudKey: Boolean(cloudKeychainValue || fromFile.STREAMSIM_CLOUD_API_KEY || process.env.STREAMSIM_CLOUD_API_KEY),
      hasDeepgramKey: Boolean(deepgramKeychainValue || fromFile.DEEPGRAM_API_KEY || process.env.DEEPGRAM_API_KEY || process.env.STREAMSIM_DEEPGRAM_API_KEY),
      hasOpenAiSttKey: Boolean(
        openAiSttKeychainValue ||
          fromFile.STREAMSIM_OPENAI_STT_API_KEY ||
          process.env.STREAMSIM_OPENAI_STT_API_KEY ||
          process.env.STREAMSIM_OPENAI_API_KEY ||
          process.env.OPENAI_API_KEY
      ),
      provider: availability.ok ? this.provider.name : `${this.provider.name}+file-fallback`,
      available: availability.ok || Boolean(fromFile.STREAMSIM_CLOUD_API_KEY || fromFile.DEEPGRAM_API_KEY || fromFile.STREAMSIM_OPENAI_STT_API_KEY),
      warning: availability.warning
    };
  }

  private getSecretValue(name: SecretKeyName, account: string, envFallbackNames: string[]): string {
    const fromKeychain = this.getKeyFromKeychain(account);
    if (fromKeychain) return fromKeychain;

    const fromFile = readFileSecrets()[name];
    if (fromFile) return fromFile;

    for (const envName of envFallbackNames) {
      const fromEnv = process.env[envName];
      if (fromEnv) return fromEnv;
    }
    return "";
  }

  private setSecretValue(name: SecretKeyName, account: string, label: string, value: string): boolean {
    const normalized = value.trim();
    if (!normalized) return false;

    const savedInKeychain = this.setKeyInKeychain(account, label, normalized);
    if (!savedInKeychain) {
      const existing = readFileSecrets();
      if (!writeFileSecrets({ ...existing, [name]: normalized })) return false;
    }

    process.env[name] = normalized;
    return true;
  }

  private getKeyFromKeychain(account: string): string {
    const availability = this.provider.isAvailable();
    if (!availability.ok) return "";
    try {
      return this.provider.read(account);
    } catch {
      return "";
    }
  }

  private setKeyInKeychain(account: string, label: string, value: string): boolean {
    const availability = this.provider.isAvailable();
    if (!availability.ok) return false;
    try {
      return this.provider.write(account, label, value);
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
