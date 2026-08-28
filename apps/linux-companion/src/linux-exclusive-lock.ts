import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

const flockPath = "/usr/bin/flock";
const catPath = "/usr/bin/cat";

export interface LinuxExclusiveLock { release(): Promise<void>; }

/** Kernel flock held by a fixed cat child whose stdin is the release capability. */
export async function acquireLinuxExclusiveLock(lockPath: string, timeoutMs = 30_000): Promise<LinuxExclusiveLock> {
  if (process.platform !== "linux" || !process.getuid || !isAbsolute(lockPath) || /[\0\r\n]/.test(lockPath)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new Error("The Linux exclusive-lock request is invalid.");
  if (await realpath(flockPath) !== flockPath || await realpath(catPath) !== catPath) throw new Error("The fixed Linux flock helpers are unavailable.");
  const parent = await realpath(dirname(lockPath));
  const parentMetadata = await stat(parent);
  const uid = process.getuid();
  if (!parentMetadata.isDirectory() || parentMetadata.uid !== uid || (parentMetadata.mode & 0o077) !== 0) throw new Error("The Linux lock parent is not a private current-user directory.");
  try {
    const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) { if (!exists(error)) throw error; }
  await chmod(lockPath, 0o600);
  const lockMetadata = await lstat(lockPath);
  if (!lockMetadata.isFile() || lockMetadata.isSymbolicLink() || lockMetadata.uid !== uid || (lockMetadata.mode & 0o077) !== 0) throw new Error("The Linux lock file is unsafe.");

  const child = spawn(flockPath, ["--exclusive", "--timeout", String(Math.ceil(timeoutMs / 1_000)), lockPath, catPath], { shell: false, env: { PATH: "/usr/bin:/bin" }, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = ""; let released = false;
  child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 1024) stderr += chunk.toString("utf8").slice(0, 1024 - stderr.length); });
  const closed = new Promise<number>((resolveClose) => { child.once("error", () => resolveClose(-1)); child.once("close", (code) => resolveClose(code ?? -1)); });
  const acquired = new Promise<void>((resolveAcquire, rejectAcquire) => {
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); rejectAcquire(new Error("The Linux exclusive lock timed out.")); }, timeoutMs + 2_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output === "L") { clearTimeout(timer); resolveAcquire(); }
      else if (output.length > 1) { clearTimeout(timer); child.kill("SIGKILL"); rejectAcquire(new Error("The Linux exclusive-lock helper returned invalid output.")); }
    });
    void closed.then((code) => { if (output !== "L") { clearTimeout(timer); rejectAcquire(new Error(`The Linux exclusive-lock helper exited ${code}: ${stderr}`)); } });
  });
  child.stdin.write("L", "utf8");
  try { await acquired; }
  catch (error) { child.stdin.destroy(); await closed; throw error; }
  return {
    async release() {
      if (released) return;
      released = true;
      child.stdin.end();
      const outcome = await Promise.race([closed.then(() => "closed" as const), delay(5_000).then(() => "timeout" as const)]);
      if (outcome === "timeout") { child.kill("SIGKILL"); if (await Promise.race([closed.then(() => true), delay(5_000).then(() => false)]) === false) throw new Error("The Linux exclusive-lock helper did not exit."); }
    }
  };
}

function exists(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EEXIST"; }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
