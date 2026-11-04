/** Explicit fixed-surface launch requests; no session control or foreground typing. */
import { createHash } from "node:crypto";
import { mkdtemp, rmdir } from "node:fs/promises";
import { join } from "node:path";
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
export function createClientLaunch({ store, stateDirectory, platform = process.platform, isActive = async () => true, command, guardianStopped = runtimeGuardianStopped, now = Date.now } = {}) {
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
    async launch(c, input) {
      if (Object.keys(input).some(k => !["compartment", "id", "requestId"].includes(k)) || !uuid(input.requestId)) throw new Error("Request one exact documented client recipe and request UUID; imported commands, targets or approval fields cannot execute.");
      const recipe = clientRecipe(input.id);
      if (platform !== "linux" || recipe.target.kind !== "https") throw new Error("Host launch for this platform/client is unfinished. No web substitute or fallback application was opened.");
      if (closed || pending.has(c)) throw new Error("Wait for this workspace's existing client launch; stopped requests cannot resume.");
      seen.add(c); const generation = generations.get(c) ?? 0;
      if (typeof store.withResourceLock !== "function") throw new Error("Client launch requires the protected cross-process resource lease.");
      const operation = Promise.resolve().then(() => store.withResourceLock("client-launch", c, async lease => {
        const s = await store.snapshot(c), scope = workspace(s);
        const check = async () => { lease.assert(); if (closed || generation !== (generations.get(c) ?? 0) || !await isActive(c)) throw new Error("This exact client launch was stopped or its workspace is no longer selected."); await store.authorize(c, { provider: recipe.provider }); const current = await store.snapshot(c); if (current.mode !== (current.policy === "personal" ? "personal-companion" : "managed-companion") || workspace(current) !== scope) throw new Error("The selected client launch workspace/account scope changed."); };
        await check();
        const prior = s.clientLaunches?.find(r => r.requestId === input.requestId);
        if (prior) { if (prior.recipeDigest !== recipe.digest) throw new Error("This request UUID belongs to a different exact client recipe."); return { ...(prior.result ?? { status: "outcome-unconfirmed", requestId: prior.requestId, recipeId: prior.recipeId, summary: "The previous launch request has no settled result. No effect was replayed." }), replayed: true }; }
        if (!await stoppedRecords(c)) throw new Error("A retained client-launch guardian has not independently verified exit; no replacement was started.");
        await privateDirectory(stateDirectory); const scratch = await mkdtemp(join(stateDirectory, "launch-")), scratchIdentity = identity(await directoryIdentity(scratch));
        const resource = { controller: new AbortController(), clients: new Set() }; resources.set(c, resource); let reserved = false, readySaved = false, outcome;
        try {
          await check();
          await store.update(c, "client-launch-reserve", state => {
            const all = state.clientLaunches ?? [], retained = all.filter(r => ["reserved", "launching", "outcome-unconfirmed"].includes(r.status) || r.ownedRuntime && r.stoppedVerified !== true || r.cleanupPending);
            state.clientLaunches = [...retained, ...all.filter(r => !retained.includes(r)).slice(-16)];
            if (state.clientLaunches.length >= 32 || state.clientLaunches.some(r => r.requestId === input.requestId)) throw new Error("The protected client launch inventory is full or changed; existing records were preserved.");
            state.clientLaunches.push({ requestId: input.requestId, recipeId: recipe.id, provider: recipe.provider, recipeDigest: recipe.digest, workspaceDigest: scope, status: "reserved", at: now(), scratch, scratchIdentity, cleanupPending: true });
          }, { provider: recipe.provider }); reserved = true;
          const r = await runOwnedNativeCommand({ executable: "/usr/bin/python3", args: ["-I", "-B", fileURLToPath(new URL("./client-portal.py", import.meta.url))], cwd: scratch, env: desktopEnvironment(), text: JSON.stringify({ schema: "switchyard-client-portal/v1", id: recipe.id }) + "\n", resource, signal: resource.controller.signal, command, guardianStopped, timeout: 45000, maxOutputBytes: 4096, captureStderrBytes: 0,
            onReady: async ownedRuntime => { await check(); await update(c, input.requestId, "client-launch-native-ready", v => { v.status = "launching"; v.ownedRuntime = ownedRuntime; v.stoppedVerified = false; }); readySaved = true; await check(); },
            onStopped: async ownedRuntime => { if (!await guardianStopped(ownedRuntime)) throw new Error("The client-launch guardian has not independently verified exit."); if (!readySaved) return; await update(c, input.requestId, "client-launch-native-exit", v => { if (v.ownedRuntime?.id !== ownedRuntime.id) throw new Error("The exact retained client guardian changed."); v.stoppedVerified = true; }); }
          });
          await check();
          let value; try { value = JSON.parse(r.stdout); } catch { throw new Error("The exact desktop-portal response did not verify; no application state was guessed."); }
          const expected = ["schema", "id", "status", "response", "applicationOpenedVerified", "accountVerified", "sessionIdentified"];
          if (r.status !== "completed" || r.exitCode !== 0 || !value || Object.keys(value).length !== expected.length || Object.keys(value).some(k => !expected.includes(k)) || value.schema !== "switchyard-client-portal-result/v1" || value.id !== recipe.id || !["accepted", "cancelled", "rejected", "outcome-unconfirmed"].includes(value.status) || value.response !== ({ accepted: 0, cancelled: 1, rejected: 2, "outcome-unconfirmed": null })[value.status] || ["applicationOpenedVerified", "accountVerified", "sessionIdentified"].some(k => value[k] !== false)) throw new Error("The exact desktop-portal response did not verify; no application state was guessed.");
          outcome = { status: value.status === "accepted" ? "launch-requested" : value.status, requestId: input.requestId, recipeId: recipe.id, provider: recipe.provider, portalResponse: value.response, applicationOpenedVerified: false, providerAccountVerified: false, sessionIdentified: false, modelPromptSubmitted: false, replayed: false, provenance: "Exact fixed HTTPS target; XDG OpenURI Response; native helper independently exited. External browser/account/session remain outside this request's ownership." };
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
