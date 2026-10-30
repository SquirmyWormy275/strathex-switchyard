/** Private command supervision. Callers construct only fixed runtime installer/probe commands. */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { stopOwnedChild } from "./owned-process.mjs";
import { desktopEnvironment } from "./process-environment.mjs";
const nativeHelper = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url));
export async function runtimeGuardianStopped(frame, { windowsHelper = nativeHelper } = {}) {
  if (frame?.schema !== "switchyard-runtime-command/v1" || !/^[a-f0-9-]{36}$/.test(frame.id) || !Number.isSafeInteger(frame.guardianPid) || frame.guardianPid < 1 || !/^[0-9]+$/.test(frame.birth ?? "") || frame.containment !== (process.platform === "linux" ? "owned-linux-session" : "windows-job")) throw new Error("The interrupted runtime guardian scope is invalid; preserve its stage.");
  try {
    process.kill(frame.guardianPid, 0);
    if (process.platform !== "linux") return false;
    const text = await readFile(`/proc/${frame.guardianPid}/stat`, "utf8"), fields = text.slice(text.lastIndexOf(") ") + 2).split(" ");
    if (fields[0] !== "Z") return false;
  } catch (error) { if (!["ESRCH", "ENOENT"].includes(error.code)) return false; }
  if (process.platform === "linux") {
    for (const name of await readdir("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try { const text = await readFile(`/proc/${name}/stat`, "utf8"), fields = text.slice(text.lastIndexOf(") ") + 2).split(" "); if (fields[0] !== "Z" && (+fields[2] === frame.guardianPid || +fields[3] === frame.guardianPid)) return false; }
      catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) return false; }
    }
    return true;
  }
  if (process.platform !== "win32") return false;
  const child = spawn(windowsHelper, ["--runtime-command-status"], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: desktopEnvironment() });
  let output = "", error = false;
  child.stdin.on("error", () => {}); child.stdout.on("data", b => { output += b; if (output.length > 2048) { error = true; child.stdin.end(); } });
  const ended = new Promise(resolve => { child.once("error", () => resolve(null)); child.once("close", resolve); });
  child.stdin.end(JSON.stringify({ schema: frame.schema, id: frame.id }) + "\n");
  let timer; const code = await Promise.race([ended, new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]); clearTimeout(timer);
  if (code !== 0 || error) { await stopOwnedChild(child); return false; }
  try { const value = JSON.parse(output); return value.schema === frame.schema && value.id === frame.id && value.containment === "windows-job" && value.activeProcesses === 0; } catch { return false; }
}
export async function runRuntimeCommand(executable, args, { timeout = 120000, env, cwd = process.cwd(), maxOutputBytes = 524288, onGuardianReady = async () => {}, windowsHelper = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url)) } = {}) {
  if (!["linux", "win32"].includes(process.platform) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600000 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 524288) throw new Error("Choose a supported, bounded runtime operation.");
  const resolved = await realpath(executable), digest = createHash("sha256");
  for await (const chunk of createReadStream(resolved)) digest.update(chunk);
  // Hash the native target but preserve the invocation path: Python locates
  // pyvenv.cfg beside its venv alias, and argv[0] is meaningful to native tools.
  const request = { schema: "switchyard-runtime-command/v1", id: randomUUID(), executable, executableSha256: digest.digest("hex"), args, cwd, environment: env ?? desktopEnvironment(), timeoutMs: timeout, maxOutputBytes };
  if (Buffer.byteLength(JSON.stringify(request)) > 65536) throw new Error("The fixed runtime request exceeds its protocol bound.");
  const linux = process.platform === "linux", child = spawn(linux ? process.execPath : windowsHelper, linux ? [fileURLToPath(new URL("./runtime-command-worker.mjs", import.meta.url))] : ["--runtime-command"], { shell: false, windowsHide: true, detached: linux, stdio: ["pipe", "pipe", "ignore"], env: desktopEnvironment() });
  let buffer = "", result, failure, ready = false, pendingReady, readyCommitted = false, guardianBirth, acknowledged = false, aborting;
  let resolveAbort; const aborted = new Promise((r) => { resolveAbort = r; });
  const fail = (message) => {
    failure ??= new Error(message); child.stdin.end();
    aborting ??= (async () => {
      await new Promise((r) => setTimeout(r, 1500));
      if (child.exitCode === null && child.signalCode === null && linux && acknowledged) {
        try {
          const s = await readFile(`/proc/${child.pid}/stat`, "utf8"), f = s.slice(s.lastIndexOf(") ") + 2).split(" ");
          if (f[19] === guardianBirth && +f[2] === child.pid && +f[3] === child.pid) process.kill(-child.pid, "SIGKILL");
        } catch (e) { if (!["ENOENT", "ESRCH"].includes(e.code)) failure.code = "RUNTIME_STOP_UNCONFIRMED"; }
      }
      const stop = await stopOwnedChild(child);
      resolveAbort({ code: null, stopUnconfirmed: !stop.stopped || acknowledged });
    })();
  };
  const deadline = setTimeout(() => fail("The supervised runtime operation exceeded its bounded lifecycle."), timeout + 20000);
  const readiness = setTimeout(() => fail("The native runtime guardian did not verify readiness."), 10000);
  child.stdin.on("error", () => {});
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk; if (Buffer.byteLength(buffer) > maxOutputBytes * 2 + 65536) { fail("Runtime verification exceeded its output bound."); return; }
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      let frame; try { frame = JSON.parse(buffer.slice(0, end)); } catch { fail("Invalid native runtime response."); return; } buffer = buffer.slice(end + 1);
      if (frame.schema !== request.schema || frame.id !== request.id || frame.containment !== (linux ? "owned-linux-session" : "windows-job")) { fail("Native runtime response scope changed."); return; }
      if (frame.event === "ready" && !ready) {
        ready = true; clearTimeout(readiness);
        if (frame.guardianPid !== child.pid || typeof frame.birth !== "string" || !/^[0-9]+$/.test(frame.birth)) { fail("The native runtime guardian identity changed."); return; }
        guardianBirth = frame.birth;
        pendingReady = Promise.resolve().then(() => onGuardianReady(frame)).then(() => { readyCommitted = true; if (!failure && child.exitCode === null && child.signalCode === null) { acknowledged = true; child.stdin.write(JSON.stringify({ schema: request.schema, id: request.id, start: true }) + "\n"); } }).catch(() => { readyCommitted = true; fail("The runtime start acknowledgement was not committed."); });
      } else if (frame.event === "result" && acknowledged && !result && ["completed", "failed", "timed-out", "output-limit"].includes(frame.status) && (frame.exitCode === null || Number.isSafeInteger(frame.exitCode) && frame.exitCode >= 0 && frame.exitCode <= 0xffffffff) && typeof frame.stdout === "string") result = frame;
      else { fail("Unexpected native runtime lifecycle frame."); return; }
    }
  });
  const closed = new Promise((resolve) => { child.once("error", () => { failure ??= new Error("The native runtime guardian is unavailable."); resolve({ code: null }); }); child.once("close", (code, signal) => resolve({ code, signal })); });
  child.stdin.write(JSON.stringify(request) + "\n");
  const exit = await Promise.race([closed, aborted]); clearTimeout(deadline); clearTimeout(readiness);
  if (failure) { if (exit.stopUnconfirmed || pendingReady && !readyCommitted || acknowledged && !result?.treeExitVerified) failure.code = "RUNTIME_STOP_UNCONFIRMED"; throw failure; }
  if (exit.code !== 0 || !result?.treeExitVerified) throw Object.assign(new Error("Runtime worker exit could not be fully verified. Preserve its staging/recovery state."), { code: "RUNTIME_STOP_UNCONFIRMED" });
  if (result.status !== "completed" || result.exitCode !== 0) throw new Error(`The optional runtime operation ${result.status === "timed-out" ? "timed out" : result.status === "output-limit" ? "exceeded its output bound" : "failed"}. Existing components were preserved.`);
  const bytes = Buffer.from(result.stdout, "base64");
  if (bytes.toString("base64") !== result.stdout || bytes.length > maxOutputBytes) throw new Error("Invalid bounded runtime output.");
  return bytes.toString("utf8");
}
