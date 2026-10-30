/** Exact owned-file replacement for launchers; never chmod shared parent directories. */
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, chmod } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { userInfo } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { directoryIdentity } from "../../tools/layout-studio/private-fs.mjs";
export const fileDigest = (b) => createHash("sha256").update(b).digest("hex");
export async function launcherDirectory(path) {
  if (!isAbsolute(path) || /[\0\r\n]/.test(path)) throw new Error("An absolute owned launcher directory is required.");
  await mkdir(path, { recursive: true, mode: 0o755 }); const s = await directoryIdentity(path);
  if (process.platform !== "win32" && (s.uid !== userInfo().uid || s.mode & 0o022)) throw new Error("Launcher directory ownership or write permissions are unsafe.");
}
export async function readOwnedFile(path) {
  try {
    await directoryIdentity(dirname(path));
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const s = await file.stat(), named = await lstat(path);
      if (!s.isFile() || named.isSymbolicLink() || s.ino !== named.ino || s.dev !== named.dev || s.size > 1024 * 1024 || (process.platform !== "win32" && (s.uid !== userInfo().uid || s.mode & 0o022))) throw new Error("An existing launcher is unsafe, changed or too large; it was preserved.");
      const bytes = await file.readFile(); if (bytes.length > 1024 * 1024) throw new Error("The existing launcher exceeds its bound.");
      return { bytes, sha256: fileDigest(bytes), mode: s.mode & 0o777 };
    } finally { await file.close(); }
  } catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
export async function replaceOwnedFile(path, bytes, mode, expected) {
  await launcherDirectory(dirname(path));
  const before = await readOwnedFile(path);
  if ((before?.sha256 ?? null) !== expected) throw new Error("A launcher changed since review. It was preserved; retry from a fresh installation review.");
  if (bytes === null) { if (before) await rm(path); return; }
  if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024 || ![0o600, 0o644, 0o700, 0o755].includes(mode)) throw new Error("Unsupported owned launcher contents or permissions.");
  const temporary = join(dirname(path), `.switchyard-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await chmod(temporary, mode);
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, path); break; }
      catch (e) { if (process.platform !== "win32" || !["EPERM", "EBUSY", "EACCES"].includes(e.code) || attempt >= 5) throw e; await new Promise((r) => setTimeout(r, 10 * 2 ** attempt)); }
    }
    if ((await readOwnedFile(path))?.sha256 !== fileDigest(bytes)) throw new Error("Launcher replacement readback failed. Its dated recovery copy was retained.");
  } finally { await rm(temporary, { force: true }); }
}
