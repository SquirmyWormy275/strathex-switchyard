/** Kernel locks release on process exit; no stale PID lock is deleted heuristically. */
import { spawn } from "node:child_process";
import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateDirectory } from "./private-fs.mjs";
import { createKeylessLeasePool } from "./keyless-lease-pool.mjs";

let windowsLeases;
function reusableWindowsLeases() {
  return windowsLeases ??= createKeylessLeasePool({ spawnWorker(path) {
    const child = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL("./state-lock.ps1", import.meta.url)), "-Reusable"], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.write(windowsLockRequest({ path, parentPid: process.pid }));
    return child;
  } });
}

/** A closed line protocol avoids loading a JSON/module engine to acquire a lock. */
export function windowsLockRequest({ path, parentPid, trace = false, nonBlocking = false }) {
  if (typeof path !== "string" || !path || /[\0\r\n]/u.test(path) || Buffer.byteLength(path, "utf8") > 16384 || !Number.isInteger(parentPid) || parentPid < 1 || parentPid > 2147483647 || typeof trace !== "boolean" || typeof nonBlocking !== "boolean") throw new Error("The private lock request is invalid.");
  // Reject lone surrogates instead of silently changing the named private path.
  const bytes = Buffer.from(path, "utf8");
  if (bytes.toString("utf8") !== path) throw new Error("The private lock path is not valid Unicode.");
  return `SXSY-LOCK/1\t${parentPid}\t${trace ? 1 : 0}\t${nonBlocking ? 1 : 0}\t${bytes.toString("base64")}\n`;
}
export async function withStateLock(root, id, fn, { onProgress, nonBlocking = false } = {}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error("Private lock identity is invalid.");
  const directory = join(root, "locks"), path = join(directory, `${id}.lock`);
  await privateDirectory(directory);
  onProgress?.("lease-directory");
  // Pre-create without truncating and reject links before the platform helper opens it.
  try { const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); await file.close(); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const named = await lstat(path);
  if (!named.isFile() || named.isSymbolicLink() || (process.platform !== "win32" && (named.uid !== userInfo().uid || (named.mode & 0o077)))) throw new Error("Private lock ownership or permissions are invalid.");
  onProgress?.("lease-file");
  if (process.platform === "win32") return reusableWindowsLeases().withLease(path, fn, { nonBlocking, onProgress });
  let child;
  // cat can echo readiness only after flock grants the kernel lease. Its open
  // input pipe keeps that lease alive; EOF also retires it after parent loss.
  if (process.platform === "linux") child = spawn("/usr/bin/flock", ["--exclusive", ...(nonBlocking ? ["--nonblock"] : ["--timeout", "10"]), "--conflict-exit-code", "75", path, "/usr/bin/cat"], { shell: false, stdio: ["pipe", "pipe", "ignore"] });
  else throw new Error("This platform has no implemented private state lock. No state was changed.");
  onProgress?.("lease-spawned");
  let alive = true, resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  child.once("close", () => { alive = false; resolveClosed(); });
  child.stdin.on("error", () => {});
  if (process.platform === "linux") child.stdin.write("LOCKED\n");
  try {
    await new Promise((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("Private state lock timed out. Existing data was preserved.")); }, 15000);
      const fail = code => { clearTimeout(timer); const error = new Error("The private state lock is unavailable or busy. Existing data was preserved."); if (nonBlocking && code === 75) error.code = "STATE_LOCK_BUSY"; reject(error); };
      child.once("error", fail); child.once("close", fail);
      child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; if (output === "LOCKED\n" || output === "LOCKED\r\n") { clearTimeout(timer); child.removeListener("close", fail); child.removeListener("error", fail); child.on("error", () => { alive = false; }); resolve(); } else if (output.includes("\n") || output.length > 128) { child.kill(); fail(); } });
    });
    const lease = { assert() { if (!alive || child.exitCode !== null) throw new Error("The private state lock was lost. Existing data must be re-read before retrying."); } };
    lease.assert(); onProgress?.("lease-ready"); const result = await fn(lease); lease.assert(); return result;
  } finally {
    child.stdin.end();
    let timer; await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(() => { child.kill(); resolve(); }, 2000); })]); clearTimeout(timer);
  }
}
