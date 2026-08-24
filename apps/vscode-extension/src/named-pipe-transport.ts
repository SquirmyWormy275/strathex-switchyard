import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { JsonLineTransport } from "./companion-bridge.ts";

const maxFrameBytes = 64 * 1024;
const defaultTimeoutMs = 5_000;

/** Stored by a reviewed local installer/bootstrapper. It contains no clear token. */
export interface StoredCompanionPipeConfiguration {
  readonly version: 1;
  readonly pipePath: string;
  readonly sealedToken: string;
}

export interface ExtensionSecretReader {
  open(sealed: string): Promise<Uint8Array>;
}

/** Uses DPAPI CurrentUser so the VS Code process can open only its own user's sealed pipe token. */
export class WindowsDpapiSecretReader implements ExtensionSecretReader {
  async open(sealed: string): Promise<Uint8Array> {
    if (process.platform !== "win32") throw new Error("Windows DPAPI is unavailable on this platform.");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sealed) || sealed.length > 16 * 1024) throw new Error("The local companion secret envelope is malformed.");
    // ProtectedData is not preloaded in every Windows PowerShell host.
    // The extension must use the same explicit framework dependency as the
    // companion rather than treating a DPAPI failure as permission to use a
    // plaintext configuration token.
    const script = "Add-Type -AssemblyName System.Security;$in=[Console]::In.ReadToEnd();$raw=[Convert]::FromBase64String($in);$out=[Security.Cryptography.ProtectedData]::Unprotect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($out))";
    return new Promise<Uint8Array>((resolve, reject) => {
      const child = spawn("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { shell: false, windowsHide: true, env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" }, stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
      child.once("error", () => reject(new Error("Windows DPAPI could not be started.")));
      child.once("close", (code) => {
        const opened = output.trim();
        if (code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(opened)) { reject(new Error("Windows DPAPI could not open the local companion secret.")); return; }
        resolve(Buffer.from(opened, "base64"));
      });
      child.stdin.end(sealed, "utf8");
    });
  }
}

/**
 * Authenticated one-request local named-pipe transport. Its only endpoint is
 * the B122 pipe path created by the companion; no TCP host/port or arbitrary
 * command configuration is accepted.
 */
export class NamedPipeJsonLineTransport implements JsonLineTransport {
  private readonly configuration: StoredCompanionPipeConfiguration;
  private readonly secrets: ExtensionSecretReader;
  private readonly timeoutMs: number;

  constructor(configuration: StoredCompanionPipeConfiguration, secrets: ExtensionSecretReader = new WindowsDpapiSecretReader(), timeoutMs = defaultTimeoutMs) {
    if (!isStoredConfiguration(configuration)) throw new Error("The stored SXSY-B122 local pipe configuration is invalid.");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new Error("The local companion timeout is outside safe bounds.");
    this.configuration = configuration;
    this.secrets = secrets;
    this.timeoutMs = timeoutMs;
  }

  async request(line: string): Promise<string> {
    if (!line || Buffer.byteLength(line, "utf8") > maxFrameBytes) throw new Error("The companion request is outside the local frame limit.");
    const request: unknown = JSON.parse(line);
    if (!isRequest(request)) throw new Error("The companion request is invalid.");
    const token = Buffer.from(await this.secrets.open(this.configuration.sealedToken));
    try {
      if (token.length < 32) throw new Error("The local companion token is too short.");
      return await this.roundTrip(request, line, token);
    } finally {
      token.fill(0);
    }
  }

  private roundTrip(request: Readonly<{ version: 1; id: string; method: string }>, requestJson: string, token: Buffer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket = connect(this.configuration.pipePath);
      let buffer = Buffer.alloc(0);
      let state: "challenge" | "response" | "done" = "challenge";
      const clientNonce = randomBytes(32).toString("base64");
      let serverNonce: string | undefined;
      let settled = false;
      const done = (work: () => void): void => { if (settled) return; settled = true; socket.destroy(); work(); };
      socket.setTimeout(this.timeoutMs, () => done(() => reject(new Error("The local companion pipe timed out."))));
      socket.once("error", () => done(() => reject(new Error("The local companion pipe is unavailable."))));
      socket.on("data", (chunk: Buffer) => {
        if (buffer.length + chunk.length > maxFrameBytes + 1) return done(() => reject(new Error("The local companion response is too large.")));
        buffer = Buffer.concat([buffer, chunk]);
        while (state !== "done") {
          const newline = buffer.indexOf(0x0a);
          if (newline < 0) return;
          const frame = buffer.subarray(0, newline).toString("utf8");
          buffer = buffer.subarray(newline + 1);
          try {
            const parsed: unknown = JSON.parse(frame);
            if (state === "challenge") {
              if (!isChallenge(parsed) || parsed.clientNonce !== clientNonce || !sameProof(parsed.proof, proof(token, "server", clientNonce, parsed.serverNonce))) throw new Error("invalid server proof");
              serverNonce = parsed.serverNonce;
              const envelope = JSON.stringify({ version: 2, clientNonce, serverNonce, proof: proof(token, "client", clientNonce, serverNonce, requestJson), request });
              if (Buffer.byteLength(envelope, "utf8") > maxFrameBytes) throw new Error("request too large");
              state = "response";
              socket.write(`${envelope}\n`, "utf8");
              continue;
            }
            if (!serverNonce || !isResponseEnvelope(parsed)) throw new Error("invalid response");
            const responseJson = JSON.stringify(parsed.response);
            if (!sameProof(parsed.proof, proof(token, "response", clientNonce, serverNonce, responseJson)) || parsed.response.id !== request.id || buffer.length) throw new Error("invalid response proof");
            state = "done";
            done(() => resolve(responseJson));
          } catch { state = "done"; done(() => reject(new Error("The local companion response is malformed or unauthenticated."))); }
        }
      });
      socket.once("connect", () => socket.write(`${JSON.stringify({ version: 2, clientNonce })}\n`, "utf8"));
    });
  }
}

/** Read only the companion-created, DPAPI-sealed local endpoint record. */
export class ProvisionedNamedPipeJsonLineTransport implements JsonLineTransport {
  private readonly configurationPath: string;
  private readonly secrets: ExtensionSecretReader;
  private readonly timeoutMs: number;

  constructor(configurationPath = defaultCompanionPipeConfigurationPath(), secrets: ExtensionSecretReader = new WindowsDpapiSecretReader(), timeoutMs = defaultTimeoutMs) {
    this.configurationPath = configurationPath;
    this.secrets = secrets;
    this.timeoutMs = timeoutMs;
  }

  async request(line: string): Promise<string> {
    let configuration: unknown;
    try { configuration = JSON.parse(await readFile(this.configurationPath, "utf8")); } catch { throw new Error("The authenticated local companion pipe is not provisioned."); }
    if (!isStoredConfiguration(configuration)) throw new Error("The authenticated local companion pipe configuration is invalid.");
    return new NamedPipeJsonLineTransport(configuration, this.secrets, this.timeoutMs).request(line);
  }
}

/** Mirrors the companion's host-owned state location; it never uses a workspace path or VS Code setting. */
export function defaultCompanionPipeConfigurationPath(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const base = environment.LOCALAPPDATA
    ?? environment.APPDATA
    ?? environment.XDG_STATE_HOME
    ?? (environment.HOME ? join(environment.HOME, ".local", "state") : join(homedir(), ".local", "state"));
  return join(base, "STRATHEX", "switchyard", "authenticated-pipe.json");
}

export function isStoredConfiguration(value: unknown): value is StoredCompanionPipeConfiguration {
  if (!isRecord(value) || value.version !== 1 || typeof value.pipePath !== "string" || typeof value.sealedToken !== "string" || !value.sealedToken) return false;
  return process.platform === "win32"
    ? /^\\\\\.\\pipe\\sxsy-b122-[a-zA-Z0-9-]{1,48}$/.test(value.pipePath)
    : isAbsolute(value.pipePath) && value.pipePath.endsWith(".sock") && !value.pipePath.includes("\0");
}

function isRequest(value: unknown): value is { readonly version: 1; readonly id: string; readonly method: string } {
  return isRecord(value) && value.version === 1 && typeof value.id === "string" && typeof value.method === "string";
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isNonce(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32; }
function isProof(value: unknown): value is string { return isNonce(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function isChallenge(value: unknown): value is { version: 2; clientNonce: string; serverNonce: string; proof: string } { return isRecord(value) && exact(value, ["version", "clientNonce", "serverNonce", "proof"]) && value.version === 2 && isNonce(value.clientNonce) && isNonce(value.serverNonce) && isProof(value.proof); }
function isResponseEnvelope(value: unknown): value is { version: 2; response: { version: 1; id: string; ok: boolean }; proof: string } { return isRecord(value) && exact(value, ["version", "response", "proof"]) && value.version === 2 && isRecord(value.response) && value.response.version === 1 && typeof value.response.id === "string" && typeof value.response.ok === "boolean" && isProof(value.proof); }
function proof(token: Buffer, role: "server" | "client" | "response", clientNonce: string, serverNonce: string, document = ""): string { const documentDigest = createHash("sha256").update(document).digest("hex"); return createHmac("sha256", token).update(`sxsy-b122-pipe-v2\0${role}\0${clientNonce}\0${serverNonce}\0${documentDigest}`).digest("base64"); }
function sameProof(left: string, right: string): boolean { const a = Buffer.from(left, "base64"); const b = Buffer.from(right, "base64"); return a.length === b.length && timingSafeEqual(a, b); }
