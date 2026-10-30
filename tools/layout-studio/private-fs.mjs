/** Private, atomic local files. No credential or plaintext-state fallback. */
import { constants } from "node:fs";
import { mkdir, lstat, open, realpath, rename, rm } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
const uid = userInfo().uid, maxBytes = 8 * 1024 * 1024;
export async function privateDirectory(path) {
  if (!isAbsolute(path)) throw new Error("Private storage needs an absolute path.");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || await realpath(path) !== path || (process.platform !== "win32" && (s.uid !== uid || (s.mode & 0o077)))) throw new Error("Private storage ownership or permissions are invalid.");
}
export async function privateRead(path) {
  const f = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const s = await f.stat(), named = await lstat(path);
    if (!s.isFile() || named.isSymbolicLink() || s.ino !== named.ino || s.dev !== named.dev || s.size > maxBytes || (process.platform !== "win32" && (s.uid !== uid || (s.mode & 0o077)))) throw new Error("Private storage file is unsafe or oversized.");
    return await f.readFile("utf8");
  } finally { await f.close(); }
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
