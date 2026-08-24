import { spawn } from "node:child_process";
import type { JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";

const inputName = "SXSY_B122_JOURNAL_INPUT";
const hostKeys = ["PATH", "PATHEXT", "SystemRoot", "ComSpec", "WINDIR"] as const;

function hostEnvironment(input: string): Record<string, string> {
  return Object.fromEntries([
    ...hostKeys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
    [inputName, input]
  ]);
}

function powershell(script: string, input: string): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const executable = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "powershell.exe";
    const child = spawn(executable, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      shell: false, windowsHide: true, env: hostEnvironment(input), stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "", error = "";
    const collect = (target: "output" | "error") => (chunk: Buffer) => { if ((target === "output" ? output : error).length < 16_384) { if (target === "output") output += chunk.toString(); else error += chunk.toString(); } };
    child.stdout.on("data", collect("output")); child.stderr.on("data", collect("error"));
    const timer = setTimeout(() => child.kill(), 10_000);
    child.once("error", (reason) => { clearTimeout(timer); reject(reason); });
    child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolveResult(output.trim()) : reject(new Error(error.trim() || "Windows data-protection operation failed.")); });
  });
}

const protectScript = "Add-Type -AssemblyName System.Security;$plain=[Convert]::FromBase64String($env:SXSY_B122_JOURNAL_INPUT);$blob=[System.Security.Cryptography.ProtectedData]::Protect($plain,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($blob)";
const unprotectScript = "Add-Type -AssemblyName System.Security;$blob=[Convert]::FromBase64String($env:SXSY_B122_JOURNAL_INPUT);$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($blob,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Text.Encoding]::UTF8.GetString($plain)";

/** Current-user Windows DPAPI protects journal authenticator tags at rest. */
export class WindowsDpapiJournalAuthenticator implements JournalAuthenticator {
  readonly provider = "windows-dpapi-current-user-v1";

  private assertWindows(): void {
    if (process.platform !== "win32") throw new Error("Windows DPAPI journal protection is unavailable on this platform.");
  }

  async seal(hash: string): Promise<string> {
    this.assertWindows();
    return powershell(protectScript, Buffer.from(hash, "utf8").toString("base64"));
  }

  async verify(hash: string, tag: string): Promise<boolean> {
    this.assertWindows();
    try { return await powershell(unprotectScript, tag) === hash; } catch { return false; }
  }
}
