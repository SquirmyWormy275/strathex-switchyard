/** Kernel locks release on process exit; no stale PID lock is deleted heuristically. */
import { spawn } from "node:child_process";
import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateDirectory } from "./private-fs.mjs";
export async function withStateLock(root, id, fn) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error("Private lock identity is invalid.");
  const directory = join(root, "locks"), path = join(directory, `${id}.lock`);
  await privateDirectory(directory);
  // Pre-create without truncating and reject links before the platform helper opens it.
  try { const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); await file.close(); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const named = await lstat(path);
  if (!named.isFile() || named.isSymbolicLink() || (process.platform !== "win32" && (named.uid !== userInfo().uid || (named.mode & 0o077)))) throw new Error("Private lock ownership or permissions are invalid.");
  let child;
  if (process.platform === "linux") child = spawn("/usr/bin/flock", ["--exclusive", "--timeout", "10", "--conflict-exit-code", "75", path, process.execPath, "-e", 'process.stdout.write("LOCKED\\n"); process.stdin.resume();'], { shell: false, stdio: ["pipe", "pipe", "ignore"] });
  else if (process.platform === "win32") {
    child = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL("./state-lock.ps1", import.meta.url))], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    child.stdin.write(JSON.stringify({ path, parentPid: process.pid }) + "\n");
  } else throw new Error("This platform has no implemented private state lock. No state was changed.");
  let alive = true, resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  child.once("close", () => { alive = false; resolveClosed(); });
  child.stdin.on("error", () => {});
  try {
    await new Promise((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("Private state lock timed out. Existing data was preserved.")); }, 15000);
      const fail = () => { clearTimeout(timer); reject(new Error("The private state lock is unavailable or busy. Existing data was preserved.")); };
      child.once("error", fail); child.once("close", fail);
      child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; if (output === "LOCKED\n" || output === "LOCKED\r\n") { clearTimeout(timer); child.removeListener("close", fail); child.removeListener("error", fail); child.on("error", () => { alive = false; }); resolve(); } else if (output.length > 128) { child.kill(); fail(); } });
    });
    const lease = { assert() { if (!alive || child.exitCode !== null) throw new Error("The private state lock was lost. Existing data must be re-read before retrying."); } };
    lease.assert(); const result = await fn(lease); lease.assert(); return result;
  } finally {
    child.stdin.end();
    let timer; await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(() => { child.kill(); resolve(); }, 2000); })]); clearTimeout(timer);
  }
}
