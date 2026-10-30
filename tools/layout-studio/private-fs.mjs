/** Private, atomic local files. No credential or plaintext-state fallback. */
import { constants } from "node:fs";
import { mkdir, lstat, open, realpath, rename, rm } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join, isAbsolute, win32 } from "node:path";
import { randomUUID } from "node:crypto";
const uid = userInfo().uid, maxBytes = 8 * 1024 * 1024;
/** DOS short names/case aliases are valid; directory links and remote roots are not. */
export async function directoryIdentity(path, { platform = process.platform, readStats = lstat, resolvePath = realpath } = {}) {
  if (typeof path !== "string" || /[\0\r\n]/.test(path)) throw new Error("Private storage directory path is invalid.");
  if (platform === "win32" && (!/^[A-Za-z]:[\\/]/.test(path) || path.slice(2).includes(":") || path.split(/[\\/]/).some((p) => p === "." || p === ".."))) throw new Error("Private storage needs a local drive path without directory redirection.");
  const s = await readStats(path);
  if (!s.isDirectory() || s.isSymbolicLink()) throw new Error("Private storage ownership or permissions are invalid.");
  const canonical = await resolvePath(path);
  if (platform !== "win32") {
    if (canonical !== path) throw new Error("Private storage ownership or permissions are invalid.");
  } else {
    if (win32.parse(canonical).root.toLowerCase() !== win32.parse(path).root.toLowerCase()) throw new Error("Private storage needs a local drive path without directory redirection.");
    let current = win32.normalize(path);
    while (true) {
      const entry = await readStats(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Private storage directory links are prohibited.");
      const parent = win32.dirname(current); if (parent === current) break; current = parent;
    }
    const actual = await readStats(canonical);
    if (actual.dev !== s.dev || actual.ino !== s.ino) throw new Error("Private storage directory identity changed during validation.");
  }
  return s;
}
export async function privateDirectory(path) {
  if (!isAbsolute(path)) throw new Error("Private storage needs an absolute path.");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await directoryIdentity(path);
  if (process.platform !== "win32" && (s.uid !== uid || (s.mode & 0o077))) throw new Error("Private storage ownership or permissions are invalid.");
}
export async function privateRead(path, { openFile = open, statName = lstat } = {}) {
  const safe = (s) => s.isFile() && !s.isSymbolicLink() && s.size <= maxBytes && (process.platform === "win32" || s.uid === uid && !(s.mode & 0o077));
  for (let attempt = 0; attempt < 4; attempt++) {
    const f = await openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const s = await f.stat(), named = await statName(path);
      if (!safe(s) || !safe(named)) throw new Error("Private storage file is unsafe or oversized.");
      // An atomic writer can replace the name between open() and lstat(). Reopen
      // the new safe file, never accept an unverified descriptor or a link.
      if (s.ino !== named.ino || s.dev !== named.dev) continue;
      const value = await f.readFile("utf8");
      if (Buffer.byteLength(value) > maxBytes) throw new Error("Private storage file is unsafe or oversized.");
      return value;
    } finally { await f.close(); }
  }
  throw new Error("Private storage changed repeatedly during read. Retry the local operation.");
}
export async function privateWrite(path, text) {
  if (Buffer.byteLength(text) > maxBytes) throw new Error("Private storage limit reached. Review or delete older sessions.");
  await privateDirectory(dirname(path));
  const temporary = join(dirname(path), `.pending-${randomUUID()}`);
  try {
    const f = await open(temporary, "wx", 0o600);
    try { await f.writeFile(text); await f.sync(); } finally { await f.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
