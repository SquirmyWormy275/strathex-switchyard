import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export interface ProviderHostPathSecurity {
  assertCurrentUserProtected(protectedRoot: string, existingPaths: readonly string[]): Promise<void>;
}

/** Runtime DACL/canonical-path proof for every provider-host secret and state file. */
export class WindowsCurrentUserProviderHostPathSecurity implements ProviderHostPathSecurity {
  async assertCurrentUserProtected(protectedRoot: string, existingPaths: readonly string[]): Promise<void> {
    if (process.platform !== "win32") throw new Error("Provider-host protected storage requires Windows current-user ACLs.");
    const root = resolve(protectedRoot);
    if (!isAbsolute(root) || !existingPaths.every((path) => isInside(root, resolve(path)))) throw new Error("Provider-host secrets and state must remain beneath the protected current-user root.");
    for (const path of [root, ...existingPaths]) {
      const metadata = await lstat(path);
      if ((!metadata.isDirectory() && !metadata.isFile()) || metadata.isSymbolicLink() || resolve(await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) {
        throw new Error("A provider-host protected path is not one canonical non-reparse filesystem object.");
      }
    }
    await verifyWindowsAcl([root, ...existingPaths]);
  }
}

function verifyWindowsAcl(paths: readonly string[]): Promise<void> {
  const script = `$ErrorActionPreference='Stop';$document=[Console]::In.ReadToEnd()|ConvertFrom-Json;$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$allowed=@($current,'S-1-5-18');foreach($path in @($document.paths)){$acl=Get-Acl -LiteralPath ([string]$path);$owner=([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value;if($owner -cne $current){throw 'owner'};if([string]$path -ceq [string]$document.root -and -not $acl.AreAccessRulesProtected){throw 'inheritance'};$hasCurrent=$false;foreach($rule in @($acl.Access)){if($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){continue};$sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($sid -notin $allowed){throw 'broad'};if($sid -ceq $current){$hasCurrent=$true}};if(-not $hasCurrent){throw 'missing-current'}};[Console]::Out.Write('ok')`;
  return new Promise<void>((resolveAcl, rejectAcl) => {
    const child = spawn("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true, shell: false, env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" }, stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { if (output.length < 32) output += chunk.toString("utf8"); });
    child.once("error", () => rejectAcl(new Error("Provider-host Windows ACL verification could not start.")));
    child.once("close", (code) => code === 0 && output.trim() === "ok" ? resolveAcl() : rejectAcl(new Error("Provider-host secret storage is not restricted to the current Windows user.")));
    child.stdin.end(JSON.stringify({ root: paths[0], paths }), "utf8");
  });
}

function isInside(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate);
  return suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix));
}
