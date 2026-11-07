/** Explicit fixed-surface launch requests; no session control or foreground typing. */
import { createHash } from "node:crypto";
import { mkdtemp, rmdir } from "node:fs/promises";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { clientRecipe } from "../../integrations/client-recipes.mjs";
import { privateDirectory, directoryIdentity } from "./private-fs.mjs";
import { desktopEnvironment } from "./process-environment.mjs";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const workspace = s => hash([s.policy, s.mode, s.modeSelectedAt ?? null, s.accounts, s.taskAuthorityEpoch ?? 0]);
const identity = s => ({ device: s.dev.toString(), inode: s.ino.toString() });
export function clientLaunchCommand(id, { platform = process.platform, windowsSystemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT } = {}) {
  const recipe = clientRecipe(id);
  if (!["linux", "win32"].includes(platform) || recipe.target.kind !== "https") throw new Error("Host launch for this platform/client is unfinished. No web substitute or fallback application was opened.");
  if (platform === "linux") return { executable: "/usr/bin/python3", args: ["-I", "-B", fileURLToPath(new URL("./client-portal.py", import.meta.url))], schema: "switchyard-client-portal/v1", resultSchema: "switchyard-client-portal-result/v1", interface: "xdg-openuri/v1" };
  if (typeof windowsSystemRoot !== "string" || !/^[A-Za-z]:[\\/][^:\r\n\0]+$/.test(windowsSystemRoot) || windowsSystemRoot.split(/[\\/]/).some(p => p === "." || p === "..") || !win32.isAbsolute(windowsSystemRoot)) throw new Error("The Windows system directory is unavailable; no shell or alternate runtime was selected.");
  return { executable: win32.join(windowsSystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Mta", "-File", fileURLToPath(new URL("./client-launch-windows.ps1", import.meta.url))], schema: "switchyard-client-winrt/v1", resultSchema: "switchyard-client-native-launch-result/v1", interface: "windows-launchuri/v1" };
}
export function createClientLaunch({ store, stateDirectory, platform = process.platform, windowsSystemRoot, isActive = async () => true, command, guardianStopped = runtimeGuardianStopped, now = Date.now } = {}) {
  const pending = new Map(), resources = new Map(), generations = new Map(), seen = new Set(); let closed = false;
  async function update(c, requestId, action, fn) { return store.update(c, action, s => { const r = s.clientLaunches?.find(r => r.requestId === requestId); if (!r) throw new Error("The protected client launch identity changed."); return fn(r); }); }
  async function stoppedRecords(c) {
    let stopped = true;
    for (const r of (await store.snapshot(c)).clientLaunches ?? []) if (r.ownedRuntime && r.stoppedVerified !== true) {
      if (!await guardianStopped(r.ownedRuntime)) { stopped = false; continue; }
      await update(c, r.requestId, "client-launch-observed-exit", v => { v.stoppedVerified = true; });
    }
    return stopped;
  }
  async function stopCompartment(c) {
    generations.set(c, (generations.get(c) ?? 0) + 1); const resource = resources.get(c); resource?.controller.abort();
    const results = await Promise.all([...(resource?.clients ?? [])].map(p => p.stop().catch(() => false)));
    await Promise.allSettled([pending.get(c)].filter(Boolean));
    return { stopped: results.every(Boolean) && await stoppedRecords(c), externalApplicationClosed: false };
  }
  return {
    async launch(c, input, context = {}) {
      if (Object.keys(input).some(k => !["compartment", "id", "requestId"].includes(k)) || !uuid(input.requestId)) throw new Error("Request one exact documented client recipe and request UUID; imported commands, targets or approval fields cannot execute.");
      const dispatchScope = context.digest ?? null;
      if (dispatchScope !== null && (!/^[a-f0-9]{64}$/.test(dispatchScope) || typeof context.assertCurrent !== "function")) throw new Error("The exact local client dispatch scope is invalid.");
      const recipe = clientRecipe(input.id);
      const native = clientLaunchCommand(recipe.id, { platform, windowsSystemRoot });
      if (closed || pending.has(c)) throw new Error("Wait for this workspace's existing client launch; stopped requests cannot resume.");
      seen.add(c); const generation = generations.get(c) ?? 0;
      if (typeof store.withResourceLock !== "function") throw new Error("Client launch requires the protected cross-process resource lease.");
      const operation = Promise.resolve().then(() => store.withResourceLock("client-launch", c, async lease => {
        const s = await store.snapshot(c), scope = workspace(s);
        const check = async () => { lease.assert(); if (closed || generation !== (generations.get(c) ?? 0) || !await isActive(c)) throw new Error("This exact client launch was stopped or its workspace is no longer selected."); await store.authorize(c, { provider: recipe.provider }); const current = await store.snapshot(c); if (current.mode !== (current.policy === "personal" ? "personal-companion" : "managed-companion") || workspace(current) !== scope) throw new Error("The selected client launch workspace/account scope changed."); await context.assertCurrent?.(); };
        await check();
        const prior = s.clientLaunches?.find(r => r.requestId === input.requestId);
        if (prior) { if (prior.recipeDigest !== recipe.digest || (prior.dispatchScope ?? null) !== dispatchScope) throw new Error("This request UUID belongs to a different exact client recipe or role binding."); return { ...(prior.result ?? { status: "outcome-unconfirmed", requestId: prior.requestId, recipeId: prior.recipeId, summary: "The previous launch request has no settled result. No effect was replayed." }), replayed: true }; }
        if (!await stoppedRecords(c)) throw new Error("A retained client-launch guardian has not independently verified exit; no replacement was started.");
        await privateDirectory(stateDirectory); const scratch = await mkdtemp(join(stateDirectory, "launch-")), scratchIdentity = identity(await directoryIdentity(scratch));
        const resource = { controller: new AbortController(), clients: new Set() }; resources.set(c, resource); let reserved = false, readySaved = false, outcome;
        try {
          await check();
          await store.update(c, "client-launch-reserve", state => {
            const all = state.clientLaunches ?? [], retained = all.filter(r => ["reserved", "launching", "outcome-unconfirmed"].includes(r.status) || r.ownedRuntime && r.stoppedVerified !== true || r.cleanupPending);
            state.clientLaunches = [...retained, ...all.filter(r => !retained.includes(r)).slice(-16)];
            if (state.clientLaunches.length >= 32 || state.clientLaunches.some(r => r.requestId === input.requestId)) throw new Error("The protected client launch inventory is full or changed; existing records were preserved.");
            state.clientLaunches.push({ requestId: input.requestId, recipeId: recipe.id, provider: recipe.provider, recipeDigest: recipe.digest, dispatchScope, platform, nativeInterface: native.interface, workspaceDigest: scope, status: "reserved", at: now(), scratch, scratchIdentity, cleanupPending: true });
          }, { provider: recipe.provider }); reserved = true;
          const r = await runOwnedNativeCommand({ executable: native.executable, args: native.args, cwd: scratch, env: desktopEnvironment(), text: JSON.stringify({ schema: native.schema, id: recipe.id, targetSha256: createHash("sha256").update(recipe.target.url).digest("hex") }) + "\n", resource, signal: resource.controller.signal, command, guardianStopped, timeout: 45000, maxOutputBytes: 4096, captureStderrBytes: 0,
            onReady: async ownedRuntime => { await check(); await update(c, input.requestId, "client-launch-native-ready", v => { v.status = "launching"; v.ownedRuntime = ownedRuntime; v.stoppedVerified = false; }); readySaved = true; await check(); },
            onStopped: async ownedRuntime => { if (!await guardianStopped(ownedRuntime)) throw new Error("The client-launch guardian has not independently verified exit."); if (!readySaved) return; await update(c, input.requestId, "client-launch-native-exit", v => { if (v.ownedRuntime?.id !== ownedRuntime.id) throw new Error("The exact retained client guardian changed."); v.stoppedVerified = true; }); }
          });
          await check();
          let value; try { value = JSON.parse(r.stdout); } catch { throw new Error("The exact desktop-portal response did not verify; no application state was guessed."); }
          const expected = ["schema", "id", "status", "response", "applicationOpenedVerified", "accountVerified", "sessionIdentified"];
          if (r.status !== "completed" || r.exitCode !== 0 || !value || Object.keys(value).length !== expected.length || Object.keys(value).some(k => !expected.includes(k)) || value.schema !== native.resultSchema || value.id !== recipe.id || !["accepted", "cancelled", "rejected", "outcome-unconfirmed"].includes(value.status) || value.response !== ({ accepted: 0, cancelled: 1, rejected: 2, "outcome-unconfirmed": null })[value.status] || ["applicationOpenedVerified", "accountVerified", "sessionIdentified"].some(k => value[k] !== false)) throw new Error("The exact desktop-portal response did not verify; no application state was guessed.");
          outcome = { status: value.status === "accepted" ? "launch-requested" : value.status, requestId: input.requestId, recipeId: recipe.id, provider: recipe.provider, nativeInterface: native.interface, nativeResponse: value.response, portalResponse: platform === "linux" ? value.response : null, applicationOpenedVerified: false, providerAccountVerified: false, sessionIdentified: false, modelPromptSubmitted: false, replayed: false, provenance: `Exact fixed HTTPS target; ${native.interface} response; native helper independently exited. External browser/account/session remain outside this request's ownership.` };
          return outcome;
        } finally {
          const stops = await Promise.all([...resource.clients].map(p => p.stop().catch(() => false))), stopped = stops.every(Boolean) && await stoppedRecords(c);
          if (reserved) await update(c, input.requestId, "client-launch-result", v => { v.status = stopped && outcome && outcome.status !== "outcome-unconfirmed" ? "settled" : "outcome-unconfirmed"; v.result = outcome ?? { status: "outcome-unconfirmed", requestId: input.requestId, recipeId: recipe.id, summary: "This request did not settle. Its native ownership/evidence remain retained and no automatic replay is allowed." }; v.finishedAt = now(); });
          if (stopped) {
            if (JSON.stringify(identity(await directoryIdentity(scratch))) !== JSON.stringify(scratchIdentity)) throw new Error("Private launch scratch ownership changed; preserve it for review.");
            let removed = false; try { await rmdir(scratch); removed = true; } catch(e) { if (e.code !== "ENOTEMPTY") throw e; }
            if (reserved && removed) await update(c, input.requestId, "client-launch-scratch-cleaned", v => { v.cleanupPending = false; });
            resources.delete(c);
          }
        }
      }));
      pending.set(c, operation); try { return await operation; } finally { if (pending.get(c) === operation) pending.delete(c); }
    },
    async list(c) { return ((await store.snapshot(c)).clientLaunches ?? []).map(r => ({ requestId: r.requestId, recipeId: r.recipeId, status: r.status, nativeOwnerStoppedVerified: r.stoppedVerified ?? null, cleanupPending: r.cleanupPending, result: r.result ?? null })); },
    stopCompartment,
    async close() { closed = true; const stops = await Promise.all([...seen].map(stopCompartment)); if (stops.some(s => !s.stopped)) throw new Error("A client-launch guardian still requires independent exit verification."); }
  };
}
