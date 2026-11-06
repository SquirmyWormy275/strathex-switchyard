/** Private native command supervision. Callers construct fixed installer/provider commands. */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { stopOwnedChild } from "./owned-process.mjs";
import { desktopEnvironment, windowsHelperTemporaryEnvironment } from "./process-environment.mjs";
const nativeHelper = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url));
export function runtimeStartupFailureEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !["nativeCode,phase", "nativeCode,phase,selfTokenQuery"].includes(Object.keys(value).sort().join())
      || !["request-fields", "environment", "executable-attributes", "executable-open", "executable-hash", "job-create", "job-configure", "self-birth", "ready-write"].includes(value.phase)
      || !(value.nativeCode === null || ["job-create", "job-configure"].includes(value.phase) && Number.isInteger(value.nativeCode) && value.nativeCode >= 0 && value.nativeCode <= 0xffffffff)) return undefined;
  if (Object.hasOwn(value, "selfTokenQuery")) {
    const q = value.selfTokenQuery, uint = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
    if (q !== null && (value.phase !== "job-create" || value.nativeCode !== 5 || !q || typeof q !== "object" || Array.isArray(q)
      || Object.keys(q).sort().join() !== "closeError,error,handlesClosedVerified,opened" || typeof q.opened !== "boolean" || !uint(q.error) || typeof q.handlesClosedVerified !== "boolean"
      || (q.opened ? q.error !== 0 || !uint(q.closeError) || q.handlesClosedVerified !== (q.closeError === 0) : q.closeError !== null || !q.handlesClosedVerified))) return undefined;
    return { phase: value.phase, nativeCode: value.nativeCode, selfTokenQuery: q === null ? null : { ...q } };
  }
  return { phase: value.phase, nativeCode: value.nativeCode };
}
export async function runtimeGuardianStopped(frame, { windowsHelper = nativeHelper } = {}) {
  if (frame?.schema !== "switchyard-runtime-command/v1" || !/^[a-f0-9-]{36}$/.test(frame.id) || !Number.isSafeInteger(frame.guardianPid) || frame.guardianPid < 1 || !/^[0-9]+$/.test(frame.birth ?? "") || frame.containment !== (process.platform === "linux" ? "owned-linux-session" : "windows-job")) throw new Error("The interrupted runtime guardian scope is invalid; preserve its stage.");
  if (process.platform === "linux") {
    try {process.kill(frame.guardianPid,0);const text=await readFile(`/proc/${frame.guardianPid}/stat`,"utf8"),fields=text.slice(text.lastIndexOf(") ")+2).split(" ");if(fields[0]!=="Z")return false;}
    catch(error){if(!["ESRCH","ENOENT"].includes(error.code))return false;}
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
  child.stdin.end(JSON.stringify({ schema: frame.schema, id: frame.id, guardianPid:frame.guardianPid, birth:frame.birth }) + "\n");
  let timer; const code = await Promise.race([ended, new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]); clearTimeout(timer);
  if (code !== 0 || error) { await stopOwnedChild(child); return false; }
  try { const value = JSON.parse(output); return value.schema === frame.schema && value.id === frame.id && value.containment === "windows-job" && value.guardianPid===frame.guardianPid && value.birth===frame.birth && value.guardianExited===true && value.activeProcesses === 0; } catch { return false; }
}
export async function runRuntimeCommand(executable, args, { timeout = 120000, env, cwd = process.cwd(), maxOutputBytes = 524288, inputText, inputBytes, captureStderrBytes = 0, detailed = false, expectedExecutableSha256, linuxExecutable, signal, onGuardianChild = () => {}, onGuardianReady = async () => {}, windowsHelper = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url)) } = {}) {
  if (!["linux", "win32"].includes(process.platform) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600000 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 524288 || !Array.isArray(args) || args.length > 256 || args.some(a=>typeof a!=="string" || a.length>8192 || /[\0\r\n]/.test(a))) throw new Error("Choose a supported, bounded runtime operation.");
  if (inputText !== undefined && inputBytes !== undefined || inputBytes !== undefined && (!(inputBytes instanceof Uint8Array) || inputBytes.byteLength > 524288) || inputText !== undefined && (typeof inputText !== "string" || Buffer.byteLength(inputText) > 524288 || inputText.includes("\0")) || !Number.isSafeInteger(captureStderrBytes) || captureStderrBytes < 0 || captureStderrBytes > 16384 || typeof detailed !== "boolean") throw new Error("Choose a bounded private input and diagnostic contract.");
  if (linuxExecutable !== undefined && (process.platform !== "linux" || executable !== "/usr/bin/bwrap" || !args.includes("/proc/self/fd/3") || !linuxExecutable || Object.keys(linuxExecutable).some(k=>!["fd","sha256"].includes(k)) || !Number.isSafeInteger(linuxExecutable.fd) || linuxExecutable.fd < 3 || !/^[a-f0-9]{64}$/.test(linuxExecutable.sha256 ?? ""))) throw new Error("The pinned Linux executable descriptor contract is invalid.");
  const input = inputText !== undefined ? Buffer.from(inputText) : inputBytes !== undefined ? Buffer.from(inputBytes) : undefined;
  const checkAbort = () => { if (signal?.aborted) throw Object.assign(new Error("The owned native command was cancelled before startup."), { code: "CANCELLED" }); }; checkAbort();
  const resolved = await realpath(executable), digest = createHash("sha256");
  for await (const chunk of createReadStream(resolved)) digest.update(chunk);
  const executableSha256 = digest.digest("hex");
  if (expectedExecutableSha256 !== undefined && (typeof expectedExecutableSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedExecutableSha256) || executableSha256 !== expectedExecutableSha256)) throw new Error("The exact reviewed native executable digest changed before guardian startup.");
  // Hash the native target but preserve the invocation path: Python locates
  // pyvenv.cfg beside its venv alias, and argv[0] is meaningful to native tools.
  let environment=env??desktopEnvironment();
  if(process.platform==="win32"&&resolved.toLowerCase()===(await realpath(windowsHelper)).toLowerCase()){
    if(Object.keys(environment).some(name=>/^(DOTNET_|CORECLR_|COMPLUS_)/i.test(name)))throw Error("The fixed native helper cannot receive runtime startup overrides.");
    environment={...Object.fromEntries(Object.entries(environment).filter(([name])=>!["TEMP","TMP"].includes(name.toUpperCase()))),...windowsHelperTemporaryEnvironment()};
  }
  const request = { schema: "switchyard-runtime-command/v1", id: randomUUID(), executable, executableSha256, args, cwd, environment, timeoutMs: timeout, maxOutputBytes, ...(linuxExecutable ? { linuxExecutableSha256: linuxExecutable.sha256 } : {}), ...(input !== undefined ? { inputBase64: input.toString("base64") } : {}), ...(captureStderrBytes ? { maxStderrBytes: captureStderrBytes } : {}) };
  if (Buffer.byteLength(JSON.stringify(request)) > 1048576) throw new Error("The fixed runtime request exceeds its protocol bound.");
  checkAbort();
  const linux = process.platform === "linux", child = spawn(linux ? process.execPath : windowsHelper, linux ? [fileURLToPath(new URL("./runtime-command-worker.mjs", import.meta.url))] : ["--runtime-command"], { shell: false, windowsHide: true, detached: linux, stdio: ["pipe", "pipe", "ignore", ...(linuxExecutable ? [linuxExecutable.fd] : [])], env: desktopEnvironment() });
  let buffer = "", result, failure, ready = false, pendingReady, readyCommitted = false, guardianBirth, acknowledged = false, aborting, guardianFrame;
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
    if (failure) return;
    buffer += chunk; if (Buffer.byteLength(buffer) > maxOutputBytes * 2 + 65536) { fail("Runtime verification exceeded its output bound."); return; }
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      let frame; try { frame = JSON.parse(buffer.slice(0, end)); } catch { fail("Invalid native runtime response."); return; } buffer = buffer.slice(end + 1);
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) { fail("Invalid native runtime response object."); return; }
      if (frame.schema !== request.schema || frame.id !== request.id || frame.containment !== (linux ? "owned-linux-session" : "windows-job")) { fail("Native runtime response scope changed."); return; }
      const startup = { phase: frame.phase, nativeCode: frame.nativeCode, ...(Object.hasOwn(frame, "selfTokenQuery") ? { selfTokenQuery: frame.selfTokenQuery } : {}) };
      if (!linux && frame.event === "startup-failure" && !ready && ["containment,event,id,nativeCode,phase,schema", "containment,event,id,nativeCode,phase,schema,selfTokenQuery"].includes(Object.keys(frame).sort().join()) && runtimeStartupFailureEvidence(startup)) {
        fail("The native runtime guardian failed before readiness.");
        failure.code = "RUNTIME_STOP_UNCONFIRMED";
        failure.runtimeStartupFailure = runtimeStartupFailureEvidence(startup);
        return;
      } else if (frame.event === "ready" && !ready) {
        ready = true; clearTimeout(readiness);
        if (frame.guardianPid !== child.pid || typeof frame.birth !== "string" || !/^[0-9]+$/.test(frame.birth)) { fail("The native runtime guardian identity changed."); return; }
        const capabilities = Array.isArray(frame.capabilities) ? frame.capabilities : [];
        if (linuxExecutable && !capabilities.includes("pinned-linux-executable")) { fail("The guardian does not support the pinned Linux executable contract."); return; }
        if ((input !== undefined && !capabilities.includes("bounded-stdin")) || (input !== undefined && input.length > 12000 && !capabilities.includes("bounded-stdin-512k")) || (captureStderrBytes && !capabilities.includes("bounded-stderr"))) { fail("The native guardian has not verified the requested private input/diagnostic contract."); return; }
        guardianFrame = frame;
        guardianBirth = frame.birth;
        pendingReady = Promise.resolve().then(() => onGuardianReady(frame)).then(() => { readyCommitted = true; if (!failure && child.exitCode === null && child.signalCode === null) { acknowledged = true; child.stdin.write(JSON.stringify({ schema: request.schema, id: request.id, start: true }) + "\n"); } }).catch(() => { readyCommitted = true; fail("The runtime start acknowledgement was not committed."); });
      } else if (frame.event === "result" && acknowledged && !result && ["completed", "failed", "timed-out", "output-limit"].includes(frame.status) && (frame.exitCode === null || Number.isSafeInteger(frame.exitCode) && frame.exitCode >= 0 && frame.exitCode <= 0xffffffff) && typeof frame.stdout === "string") result = frame;
      else { fail("Unexpected native runtime lifecycle frame."); return; }
    }
  });
  const closed = new Promise((resolve) => { child.once("error", () => { failure ??= new Error("The native runtime guardian is unavailable."); resolve({ code: null }); }); child.once("close", (code, signal) => resolve({ code, signal })); });
  const cancelled = () => { fail("Cancellation requested for this exact owned native command."); failure.code ??= "CANCELLED"; };
  signal?.addEventListener("abort", cancelled, { once: true });
  try { onGuardianChild(child); if (signal?.aborted) cancelled(); if (!failure) child.stdin.write(JSON.stringify(request) + "\n"); } catch { fail("The owned native guardian could not be registered before startup."); }
  const exit = await Promise.race([closed, aborted]); clearTimeout(deadline); clearTimeout(readiness);
  signal?.removeEventListener("abort", cancelled);
  if (failure) { if (exit.stopUnconfirmed || pendingReady && !readyCommitted || acknowledged && !result?.treeExitVerified) failure.code = "RUNTIME_STOP_UNCONFIRMED"; throw failure; }
  if (exit.code !== 0 || !result?.treeExitVerified) throw Object.assign(new Error("Runtime worker exit could not be fully verified. Preserve its staging/recovery state."), { code: "RUNTIME_STOP_UNCONFIRMED" });
  if (!detailed && (result.status !== "completed" || result.exitCode !== 0)) throw new Error(`The optional runtime operation ${result.status === "timed-out" ? "timed out" : result.status === "output-limit" ? "exceeded its output bound" : "failed"}. Existing components were preserved.`);
  const bytes = Buffer.from(result.stdout, "base64");
  if (bytes.toString("base64") !== result.stdout || bytes.length > maxOutputBytes) throw new Error("Invalid bounded runtime output.");
  if (!Buffer.from(bytes.toString("utf8")).equals(bytes)) throw new Error("Native command stdout is not valid UTF-8 text.");
  if (input !== undefined && result.inputDelivered !== true) throw new Error("The exact native input was not fully delivered. Its outcome remains unconfirmed.");
  if (!detailed) return bytes.toString("utf8");
  const errors = Buffer.from(result.stderr ?? "", "base64");
  if (errors.toString("base64") !== (result.stderr ?? "") || errors.length > captureStderrBytes) throw new Error("Invalid bounded private diagnostic output.");
  return { status: result.status, exitCode: result.exitCode, stdout: bytes.toString("utf8"), stderr: errors.toString("utf8"), inputDelivered: result.inputDelivered === true, treeExitVerified: true, guardian: guardianFrame };
}
