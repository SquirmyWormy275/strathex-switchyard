import { spawn } from "node:child_process";

import type { ConfirmationAttestationRequest, ConfirmationAttestor } from "../../../packages/control-plane/src/runtime.ts";

const defaultPowerShell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const maximumOutput = 4_096;

export interface WindowsUserPresenceResult {
  readonly verified: boolean;
  readonly operator?: string;
}

export interface WindowsUserPresenceRunner {
  verify(prompt: string): Promise<WindowsUserPresenceResult>;
}

/**
 * Uses Windows UserConsentVerifier (Windows Hello/PIN/biometric when available)
 * through the inbox, absolute-path PowerShell host. The prompt travels on
 * stdin and no credential, token, target path, or action data enters argv.
 */
export class PowerShellWindowsUserPresenceRunner implements WindowsUserPresenceRunner {
  private readonly executable: string;
  private readonly timeoutMs: number;

  constructor(options: { readonly executable?: string; readonly timeoutMs?: number } = {}) {
    this.executable = options.executable ?? defaultPowerShell;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    if (!/^[A-Za-z]:\\[^\r\n\0]+\.exe$/i.test(this.executable)) throw new Error("The Windows user-presence host must be an absolute executable path.");
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 5 * 60_000) throw new Error("The Windows user-presence timeout is outside safe bounds.");
  }

  async verify(promptInput: string): Promise<WindowsUserPresenceResult> {
    if (process.platform !== "win32") throw new Error("Windows user presence is unavailable on this platform.");
    const prompt = boundedPrompt(promptInput);
    const encoded = Buffer.from(prompt, "utf8").toString("base64");
    return new Promise<WindowsUserPresenceResult>((resolveResult, rejectResult) => {
      const child = spawn(this.executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Sta", "-Command", userPresenceScript], {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let output = "";
      let errorOutput = "";
      let settled = false;
      const append = (current: string, chunk: Buffer): string => current.length >= maximumOutput ? current : current + chunk.toString("utf8").slice(0, maximumOutput - current.length);
      const finish = (error?: Error, result?: WindowsUserPresenceResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) rejectResult(error); else resolveResult(result ?? { verified: false });
      };
      child.stdout.on("data", (chunk: Buffer) => { output = append(output, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { errorOutput = append(errorOutput, chunk); });
      child.once("error", () => finish(new Error("The trusted Windows user-presence host could not be started.")));
      child.once("close", (code) => {
        const line = output.trim();
        if (code === 0 && line.startsWith("VERIFIED:")) {
          const operator = line.slice("VERIFIED:".length).trim();
          if (/^[A-Za-z0-9_.@\\ -]{1,160}$/.test(operator)) return finish(undefined, { verified: true, operator });
        }
        if (code === 3) return finish(undefined, { verified: false });
        finish(new Error(errorOutput.trim() ? "Windows user presence was unavailable." : "Windows user presence returned an invalid result."));
      });
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error("Windows user presence timed out."));
      }, this.timeoutMs);
      child.stdin.end(encoded, "utf8");
    });
  }
}

/** Catalog-bound attestor used by the durable executor; raw client reason is never displayed as authority. */
export class WindowsHelloConfirmationAttestor implements ConfirmationAttestor {
  private readonly runner: WindowsUserPresenceRunner;

  constructor(runner: WindowsUserPresenceRunner = new PowerShellWindowsUserPresenceRunner()) {
    this.runner = runner;
  }

  async attest(input: ConfirmationAttestationRequest): Promise<Readonly<{ reauthenticated: boolean; operator: string }> | undefined> {
    const prompt = boundedPrompt(`Approve SXSY-B122 ${input.definition.title}. Verify the exact target and scope in VS Code before continuing.`);
    const result = await this.runner.verify(prompt);
    return result.verified && result.operator ? { reauthenticated: true, operator: result.operator } : undefined;
  }
}

function boundedPrompt(value: string): string {
  const normalized = value.replace(/[\r\n\0]+/g, " ").trim();
  if (!normalized || normalized.length > 240) throw new Error("The Windows user-presence prompt is invalid.");
  return normalized;
}

const userPresenceScript = String.raw`$ErrorActionPreference='Stop'
$encoded=[Console]::In.ReadToEnd()
$prompt=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
$verifier=[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$availability=$verifier::CheckAvailabilityAsync()
while ([string]$availability.Status -eq 'Started') { Start-Sleep -Milliseconds 25 }
if ([string]$availability.GetResults() -ne 'Available') { exit 2 }
$verification=$verifier::RequestVerificationAsync($prompt)
while ([string]$verification.Status -eq 'Started') { Start-Sleep -Milliseconds 25 }
if ([string]$verification.GetResults() -ne 'Verified') { exit 3 }
[Console]::Out.Write('VERIFIED:' + [Environment]::UserDomainName + '\\' + [Environment]::UserName)`;
