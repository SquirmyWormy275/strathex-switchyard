import { win32 } from "node:path";

export interface WindowsEditorEndpoint { readonly url: string; readonly authToken: string; }
export const windowsEditorTokenVariable = "SWITCHYARD_CODEX_REMOTE_TOKEN";
function requireValue(value: unknown): asserts value { if (!value) throw Error("The exact Windows Codex terminal target is invalid."); }

/** A local, canonical DOS path. No remote root, stream, device or shell wrapper. */
export function windowsEditorLocalPath(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z]:\\/.test(value) || Buffer.byteLength(value) > 4096 || /[\/\x00-\x1f\x7f"<>|?*]/.test(value.slice(2)) || value.slice(2).includes(":") || win32.normalize(value) !== value) return false;
  const parts = value.slice(3).split("\\");
  return value.length === 3 || parts.every(p => p.length > 0 && !/[. ]$/.test(p) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p));
}

export function windowsEditorEndpoint(value: unknown): Readonly<WindowsEditorEndpoint> {
  requireValue(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === "authToken,url");
  const endpoint = value as WindowsEditorEndpoint;
  requireValue(typeof endpoint.url === "string" && Buffer.byteLength(endpoint.url) <= 128 && typeof endpoint.authToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(endpoint.authToken));
  const url = new URL(endpoint.url), token = Buffer.from(endpoint.authToken, "base64url");
  try {
    requireValue(url.protocol === "ws:" && url.hostname === "127.0.0.1" && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password && url.href === endpoint.url && Number(url.port) >= 1024 && Number(url.port) <= 65535);
    requireValue(token.length === 32 && token.toString("base64url") === endpoint.authToken);
    return Object.freeze({ url: endpoint.url, authToken: endpoint.authToken });
  } finally { token.fill(0); }
}

/** Reviewed Codex 0.166.0 remote syntax. The bearer is a terminal-local env value,
 * never a command argument, URL credential, shell expression or prompt. */
export function codexWindowsTerminalResume(threadId: string, repositoryRoot: string, input: WindowsEditorEndpoint): Readonly<{ shellArgs: readonly string[]; env: Readonly<Record<string, string>> }> {
  requireValue(typeof threadId === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(threadId) && threadId !== "00000000-0000-0000-0000-000000000000" && windowsEditorLocalPath(repositoryRoot));
  const endpoint = windowsEditorEndpoint(input);
  return Object.freeze({
    shellArgs: Object.freeze(["resume", "--remote", endpoint.url, "--remote-auth-token-env", windowsEditorTokenVariable, "--sandbox", "read-only", "--ask-for-approval", "on-request", "--cd", repositoryRoot, threadId]),
    env: Object.freeze({ [windowsEditorTokenVariable]: endpoint.authToken })
  });
}
