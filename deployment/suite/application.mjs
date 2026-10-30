/** One verified application owner, with private authenticated startup and stop. */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { verifySuiteRelease } from "./release.mjs";
import { withStateLock } from "../../tools/layout-studio/state-lock.mjs";
import { privateDirectory, privateRead, privateWrite } from "../../tools/layout-studio/private-fs.mjs";
import { runtimeDirectory, publishEndpoint, reviewAccessToken } from "../../tools/layout-studio/physical-intent.mjs";
import { newInstanceIdentity, requestInstance, endpointIdentity } from "../../tools/layout-studio/instance.mjs";
import { stopOwnedChild } from "../../tools/layout-studio/owned-process.mjs";

export const applicationStateRoot = () => join(process.env.XDG_STATE_HOME || (process.platform === "win32" ? process.env.LOCALAPPDATA || join(homedir(), "AppData/Local") : join(homedir(), ".local/state")), "strathex-switchyard/application");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export function applicationEnvironment(source = process.env) {
  const allowed = new Set(["PATH", "HOME", "USER", "LOGNAME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA", "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CURRENT_DESKTOP", "DBUS_SESSION_BUS_ADDRESS", "HYPRLAND_INSTANCE_SIGNATURE"]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toUpperCase())));
}
async function savedEndpoint(stateRoot) {
  await privateDirectory(stateRoot);
  try { const e = JSON.parse(await privateRead(join(stateRoot, "endpoint.json"))); endpointIdentity(e); return e; }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
export async function applicationStatus({ stateRoot = applicationStateRoot() } = {}) {
  const endpoint = await savedEndpoint(stateRoot);
  if (!endpoint) return { status: "not-started" };
  try { return { status: "running", ...(await requestInstance(endpoint)) }; }
  catch (e) { if (e.code === "ECONNREFUSED") return { status: "not-listening", verification: "No process answered; the saved endpoint is retained for recovery." }; throw e; }
}
export async function serveApplication({ bundleRoot, port = 43177, stateRoot = applicationStateRoot(), runtimeRoot = runtimeDirectory(), onReady = () => {} } = {}) {
  const manifest = await verifySuiteRelease(bundleRoot, { platform: process.platform, checkRuntime: true });
  if (!Number.isSafeInteger(port) || port !== 0 && (port < 1024 || port > 65535)) throw new Error("Choose a valid local application port.");
  return withStateLock(stateRoot, "application-owner", async (lease) => {
    lease.assert(); const instance = newInstanceIdentity(manifest.id);
    const token = port ? await reviewAccessToken({ root: runtimeRoot, port, review: manifest.frontend.digest }) : undefined;
    const { createStudioServer } = await import("../../tools/layout-studio/serve.mjs");
    let resolveLife, rejectLife, stopping;
    const life = new Promise((resolve, reject) => { resolveLife = resolve; rejectLife = reject; });
    const server = createStudioServer({ assetRoot: join(bundleRoot, "frontend"), token, instance, onApplicationStop: () => shutdown() });
    function shutdown() {
      if (stopping) return stopping;
      stopping = (async () => { server.closeAllConnections(); if (server.listening) await new Promise((r) => server.close(r)); await server.cleanup(); resolveLife(); })();
      stopping.catch(rejectLife); return stopping;
    }
    const signal = () => { void shutdown(); }, failed = (e) => rejectLife(e);
    const ownerCheck = setInterval(() => { try { lease.assert(); } catch (e) { failed(e); } }, 250); ownerCheck.unref();
    for (const name of ["SIGINT", "SIGTERM"]) process.once(name, signal);
    server.once("error", failed);
    try {
      server.listen(port, "127.0.0.1", () => {
        void (async () => {
          lease.assert(); const url = await publishEndpoint(server, { root: runtimeRoot, review: manifest.frontend.digest });
          const endpoint = JSON.parse(await privateRead(join(runtimeRoot, `${server.address().port}.json`)));
          if (endpoint.pid !== process.pid || endpoint.instance.id !== instance.id) throw new Error("Application startup endpoint readback failed.");
          lease.assert(); await privateWrite(join(stateRoot, "endpoint.json"), JSON.stringify(endpoint) + "\n");
          await requestInstance(endpoint); await onReady({ url, instance, manifest });
        })().catch(failed);
      });
      await life; return { status: "stopped", instanceId: instance.id };
    } finally {
      for (const name of ["SIGINT", "SIGTERM"]) process.removeListener(name, signal);
      clearInterval(ownerCheck);
      server.removeListener("error", failed); await shutdown();
    }
  });
}
export async function launchApplication({ bundleRoot, port = 43177, stateRoot = applicationStateRoot(), environment = applicationEnvironment(), spawnProcess = spawn } = {}) {
  if (!Number.isSafeInteger(port) || port !== 0 && (port < 1024 || port > 65535)) throw new Error("Choose a valid local application port.");
  const manifest = await verifySuiteRelease(bundleRoot, { platform: process.platform, checkRuntime: true });
  return withStateLock(stateRoot, "application-start", async () => {
    let endpoint = await savedEndpoint(stateRoot);
    if (endpoint) {
      try {
        const proof = await requestInstance(endpoint);
        if (proof.build !== manifest.id) throw new Error("Another verified suite build is running. Stop it before changing the installed version.");
        if (proof.status !== "ready") throw new Error("The previous application is stopping. Wait for verified exit before launching again.");
        return { status: "ready", reused: true, url: endpoint.url, pid: proof.pid, instanceId: proof.instanceId, build: proof.build };
      } catch (e) { if (e.code !== "ECONNREFUSED") throw e; }
    }
    const child = spawnProcess(process.execPath, [join(bundleRoot, "deployment/suite/run.mjs"), "--port", String(port)], { cwd: bundleRoot, shell: false, windowsHide: true, detached: true, stdio: "ignore", env: environment });
    let ended = false, error;
    child.once("error", (e) => { error = e; }); child.once("exit", () => { ended = true; });
    try {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !ended && !error) {
        await wait(40); endpoint = await savedEndpoint(stateRoot);
        if (endpoint?.pid !== child.pid) continue;
        const proof = await requestInstance(endpoint);
        if (proof.status !== "ready" || proof.build !== manifest.id) throw new Error("The new application did not verify its exact ready build.");
        child.unref(); return { status: "ready", reused: false, url: endpoint.url, pid: proof.pid, instanceId: proof.instanceId, build: proof.build };
      }
      throw new Error(error ? "The private application process could not start." : "Application startup did not verify. An existing review, occupied port or ownership lease may still be active; no process was displaced.");
    } catch (e) {
      if (!ended && child.pid && !(await stopOwnedChild(child)).stopped) throw new Error("The failed owned application launch could not be confirmed stopped. Its recovery state was preserved.");
      throw e;
    }
  });
}
export async function stopApplication({ stateRoot = applicationStateRoot() } = {}) {
  const endpoint = await savedEndpoint(stateRoot);
  if (!endpoint) return { status: "not-started", stopped: true };
  let birth = null;
  try {
    process.kill(endpoint.pid, 0);
    if (process.platform === "linux") { const s = await readFile(`/proc/${endpoint.pid}/stat`, "utf8"), fields = s.slice(s.lastIndexOf(") ") + 2).split(" "); if (fields[0] === "Z") return { status: "already-exited", stopped: true }; birth = fields[19]; }
  } catch (e) { if (["ESRCH", "ENOENT"].includes(e.code)) return { status: "already-exited", stopped: true }; throw e; }
  const proof = await requestInstance(endpoint, { operation: "stop" });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { process.kill(proof.pid, 0); }
    catch (e) { if (e.code === "ESRCH") return { status: "stopped", stopped: true, instanceId: proof.instanceId }; throw e; }
    if (birth) {
      try { const s = await readFile(`/proc/${proof.pid}/stat`, "utf8"), fields = s.slice(s.lastIndexOf(") ") + 2).split(" "); if (fields[0] === "Z" || fields[19] !== birth) return { status: "stopped", stopped: true, instanceId: proof.instanceId }; }
      catch (e) { if (e.code === "ENOENT") return { status: "stopped", stopped: true, instanceId: proof.instanceId }; throw e; }
    }
    await wait(50);
  }
  throw new Error("The exact application acknowledged stopping, but process exit is unconfirmed. Its state is preserved; no unrelated process was terminated.");
}
