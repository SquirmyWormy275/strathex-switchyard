import { spawn } from "node:child_process";
import { join } from "node:path";

function waitForClose(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    const closed = () => { cleanup(); resolve(true); };
    const cleanup = () => { clearTimeout(timer); child.off("close", closed); };
    child.once("close", closed);
  });
}

function runTaskkill(pid, environment) {
  const systemRoot = environment.SystemRoot || environment.SYSTEMROOT || "C:\\Windows";
  const taskkill = join(systemRoot, "System32", "taskkill.exe");
  return new Promise((resolve) => {
    const killer = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], {
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: "ignore"
    });
    killer.once("error", (error) => resolve({ exitCode: null, error: error.message }));
    killer.once("close", (exitCode) => resolve({ exitCode, error: null }));
  });
}

/**
 * Terminates exactly the process tree rooted at the task-owned child PID and
 * does not return until the root has closed. Windows uses taskkill's /T tree
 * walk; POSIX children are placed in their own process group by the caller.
 */
export async function terminateOwnedProcessTree(child, environment, platform = process.platform) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return { strategy: "already-exited", completed: true, supervisorExitCode: null, supervisorError: null };
  }

  let supervisorExitCode = null;
  let supervisorError = null;
  if (platform === "win32") {
    const result = await runTaskkill(child.pid, environment);
    supervisorExitCode = result.exitCode;
    supervisorError = result.error;
  } else {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if (error?.code !== "ESRCH") supervisorError = error.message; }
  }

  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  const completed = await waitForClose(child);
  return {
    strategy: platform === "win32" ? "taskkill-owned-tree" : "owned-process-group",
    completed,
    supervisorExitCode,
    supervisorError
  };
}
