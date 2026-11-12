/** Read-only identity of the already-running Windows recipe runtime. No discovery or fallback. */
import { win32 } from "node:path";
import { realpathSync } from "node:fs";
import { captureRepositoryExecutableIdentity } from "../../apps/windows-companion/src/repository-runtime.ts";
import { scopeHash } from "./confirmations.mjs";

export function assertWindowsScannerRuntime(value) {
  const identity = value?.identity;
  if (value?.nodeVersion !== "24.14.0" || !identity || typeof identity.canonicalPath !== "string"
    || !/^[A-Za-z]:\\/.test(identity.canonicalPath) || identity.canonicalPath.length > 2048
    || win32.normalize(identity.canonicalPath) !== identity.canonicalPath || /[\x00-\x1f\x7f]/.test(identity.canonicalPath)
    || !/^[a-f0-9]{64}$/.test(identity.sha256) || ![identity.device, identity.inode].every(v => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v))
    || !Number.isSafeInteger(identity.size) || identity.size < 1 || identity.size > 512 * 1024 * 1024
    || !Number.isSafeInteger(identity.modifiedMs) || identity.modifiedMs < 0) throw Error("Scanner generation requires the verified Windows Node 24.14.0 runtime identity.");
  return value;
}

// The native capture resolves drive mappings (for example `subst B:`) as well as
// links. A link or junction anywhere in the executable path stays refused: the
// non-native resolver follows links but leaves drive mappings in place.
const linkResolved = path => realpathSync(path);
/** True when a native canonical path is the requested one or differs only by a link-free drive mapping. */
export function sameLinkFreeExecutable(canonicalPath, executable, resolveLinks = linkResolved) {
  const requested = win32.resolve(executable).toLowerCase();
  if (canonicalPath.toLowerCase() === requested) return true;
  try { return win32.resolve(resolveLinks(executable)).toLowerCase() === requested; } catch { return false; }
}

export async function captureWindowsScannerRuntime({ platform = process.platform, nodeVersion = process.versions.node, executable = process.execPath, capture = captureRepositoryExecutableIdentity, resolveLinks = linkResolved } = {}) {
  if (platform !== "win32" || nodeVersion !== "24.14.0") throw Error("Scanner generation requires the existing Windows Node 24.14.0 runtime; no substitute was selected.");
  const first = assertWindowsScannerRuntime({ nodeVersion, identity: await capture(executable) });
  const second = assertWindowsScannerRuntime({ nodeVersion, identity: await capture(executable) });
  if (scopeHash(first) !== scopeHash(second) || !sameLinkFreeExecutable(first.identity.canonicalPath, executable, resolveLinks)) throw Error("The original Windows scanner runtime identity changed.");
  return first;
}
