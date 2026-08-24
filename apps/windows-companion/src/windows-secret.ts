import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";

import type { JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";

/**
 * Small boundary around a Windows CurrentUser secret protector.  Callers may
 * persist only the returned opaque string; the clear value is held only for a
 * single local IPC round trip.  Tests inject a deterministic protector.
 */
export interface UserSecretProtector {
  readonly provider: string;
  seal(cleartext: Uint8Array): Promise<string>;
  open(sealed: string): Promise<Uint8Array>;
}

/** Test-only protector. It is intentionally conspicuous and never selected by production startup. */
export class FakeUserSecretProtector implements UserSecretProtector {
  readonly provider = "fake-test-protector";

  async seal(cleartext: Uint8Array): Promise<string> {
    return `fake:${Buffer.from(cleartext).toString("base64")}`;
  }

  async open(sealed: string): Promise<Uint8Array> {
    if (!sealed.startsWith("fake:")) throw new Error("The test secret is not sealed by this protector.");
    return Buffer.from(sealed.slice("fake:".length), "base64");
  }
}

/**
 * Windows DPAPI CurrentUser adapter. It invokes a constant PowerShell script
 * with data exclusively on stdin (never in command arguments or a file). The
 * B122 host does not fall back to a user-supplied passphrase or plaintext key.
 */
export class WindowsDpapiCurrentUserProtector implements UserSecretProtector {
  readonly provider = "windows-dpapi-current-user";

  async seal(cleartext: Uint8Array): Promise<string> {
    return this.invoke("protect", cleartext);
  }

  async open(sealed: string): Promise<Uint8Array> {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sealed) || sealed.length > 16 * 1024) {
      throw new Error("The DPAPI secret envelope is malformed.");
    }
    const opened = await this.invoke("unprotect", Buffer.from(sealed, "base64"));
    return Buffer.from(opened, "base64");
  }

  private async invoke(mode: "protect" | "unprotect", bytes: Uint8Array): Promise<string> {
    if (process.platform !== "win32") throw new Error("Windows DPAPI is unavailable on this platform.");
    const script = mode === "protect"
      // ProtectedData is not preloaded in every Windows PowerShell host.
      // Load its framework assembly explicitly rather than falling back to a
      // cleartext token or a caller-supplied passphrase.
      ? "Add-Type -AssemblyName System.Security;$in=[Console]::In.ReadToEnd();$raw=[Convert]::FromBase64String($in);$out=[Security.Cryptography.ProtectedData]::Protect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($out))"
      : "Add-Type -AssemblyName System.Security;$in=[Console]::In.ReadToEnd();$raw=[Convert]::FromBase64String($in);$out=[Security.Cryptography.ProtectedData]::Unprotect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($out))";
    const input = Buffer.from(bytes).toString("base64");
    return new Promise<string>((resolve, reject) => {
      const child = spawn("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        shell: false,
        windowsHide: true,
        env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" },
        stdio: ["pipe", "pipe", "pipe"]
      });
      let output = "";
      let error = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString("utf8"); });
      child.once("error", () => reject(new Error("Windows DPAPI could not be started.")));
      child.once("close", (code) => {
        const sealed = output.trim();
        if (code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(sealed)) {
          reject(new Error(error.trim() ? "Windows DPAPI rejected the local secret." : "Windows DPAPI returned an invalid local secret."));
          return;
        }
        resolve(sealed);
      });
      child.stdin.end(input, "utf8");
    });
  }
}

/** Journal tags are DPAPI-encrypted digests, not a locally persisted signing key. */
export class DpapiJournalAuthenticator implements JournalAuthenticator {
  readonly provider: string;
  private readonly protector: UserSecretProtector;

  constructor(protector: UserSecretProtector = new WindowsDpapiCurrentUserProtector()) {
    this.protector = protector;
    this.provider = protector.provider;
  }

  seal(hash: string): Promise<string> {
    return this.protector.seal(Buffer.from(hash, "utf8"));
  }

  async verify(hash: string, authenticationTag: string): Promise<boolean> {
    try {
      const actual = Buffer.from(await this.protector.open(authenticationTag));
      const expected = Buffer.from(hash, "utf8");
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}

export async function createSealedRandomToken(protector: UserSecretProtector): Promise<string> {
  return protector.seal(randomBytes(32));
}
