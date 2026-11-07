import { withShieldGitInputs } from "./shield-git-inputs.mjs";
/** Host-only Windows Run orchestration; policy admission belongs to its caller. */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureRepositoryExecutableIdentity } from "../../apps/windows-companion/src/repository-runtime.ts";
import { WindowsSandboxBackend } from "../../apps/windows-companion/src/windows-sandbox.ts";
import { privateDirectory } from "./private-fs.mjs";
import { scopeHash } from "./confirmations.mjs";
import { connectedExecutionActions, windowsShieldActions } from "./repository-execution-actions.mjs";
import { loadWindowsReviewedRun } from "./windows-reviewed-run.mjs";
import { createWindowsReviewedInputs } from "./windows-reviewed-inputs.mjs";
import { createWindowsGuestTools } from "./windows-guest-tools.mjs";
import { createWindowsExchangeImages } from "./windows-exchange-images.mjs";
import { createWindowsBrokerExchanges } from "./windows-broker-exchanges.mjs";
import { createWindowsSandboxSessions } from "./windows-sandbox-sessions.mjs";
import { createWindowsSandboxNativeCalls, validateWindowsStoragePrerequisites } from "./windows-sandbox-native.mjs";
import { shieldIndexPrefix, shieldHistoryPrefix } from "./shield-scanner-engine.mjs";

const schema = "switchyard-windows-reviewed-runner/v1";
const helperPath = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url));
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
async function nativePins(helper) {
  if (process.platform !== "win32") throw Error("Native Windows Run requires Windows; no host execution substitute was selected.");
  const pin = async path => {
    const first = await captureRepositoryExecutableIdentity(path), second = await captureRepositoryExecutableIdentity(path);
    if (scopeHash(first) !== scopeHash(second) || first.canonicalPath.toLowerCase() !== resolve(path).toLowerCase()) throw Error("The original native Run prerequisite identity changed.");
    return first;
  };
  const worker = await pin(helper), node = await pin(process.execPath);
  return { helperSha256: worker.sha256, recipeRuntime: { path: node.canonicalPath, sha256: node.sha256 }, nodeVersion: process.versions.node };
}

export function createWindowsReviewedRunner({ store, stateDirectory, platform = process.platform, helper = helperPath, isActive = async () => true, pins = () => nativePins(helper), servicesFactory, backendFactory = options => new WindowsSandboxBackend(options), now = Date.now } = {}) {
  const resources = new Map(), seen = new Set(), cleanupOwners = new Set(); let closed = false, portsPromise;
  const key = (c, id) => `${c}:${id}`;
  const runLease = c => scopeHash([schema, c]);
  const get = async (c, id) => (await store.snapshot(c)).repositoryWindowsRuns?.find(row => row.operationId === id);
  const update = (c, id, action, fn) => store.update(c, action, state => {
    const row = state.repositoryWindowsRuns?.find(row => row.operationId === id);
    if (!row || row.schema !== schema) throw Error("The protected Windows Run ownership changed.");
    return fn(row);
  });
  async function ports() {
    portsPromise ??= (async () => {
      const identities = await pins();
      if (!digest(identities.helperSha256) || !digest(identities.recipeRuntime?.sha256)) throw Error("The fixed Windows Run prerequisites are unverified.");
      let result;
      const consumerStopped = async (c, id) => {
        const resource = resources.get(key(c, id));
        if (resource && !resource.consumerReleased) return false;
        if (!resource && !cleanupOwners.has(key(c, id))) {
          if (!await get(c, id)) return false;
          const available = await store.tryWithResourceLock("repository-execution", runLease(c), async lease => { lease.assert(); });
          if (!available.acquired) return false;
        }
        return result.sessions.consumerStopped(c, id);
      };
      if (servicesFactory) result = await servicesFactory({ identities, consumerStopped });
      else {
        const sessions = createWindowsSandboxSessions({ store, stateDirectory: join(stateDirectory, "sessions"), platform, isActive,
          native: createWindowsSandboxNativeCalls({ store, stateDirectory: join(stateDirectory, "sessions", "native"), platform, helper, isActive }) });
        const options = { store, platform, helper, consumerStopped, isActive, now };
        result = {
          sessions,
          inputs: createWindowsReviewedInputs({ ...options, stateDirectory: join(stateDirectory, "inputs") }),
          tools: createWindowsGuestTools({ ...options, recipeRuntime: identities.recipeRuntime, stateDirectory: join(stateDirectory, "tools") }),
          images: createWindowsBrokerExchanges(options),
          legacyImages: createWindowsExchangeImages({ ...options, helperSha256: identities.helperSha256, stateDirectory: join(stateDirectory, "images") })
        };
      }
      return { ...result, identities };
    })();
    try { return await portsPromise; } catch (error) { portsPromise = undefined; throw error; }
  }
  async function cleanup(c, id, p, heldLease) {
    const row = await get(c, id); if (!row || !row.cleanupPending) return { cleaned: true };
    if (resources.get(key(c, id))?.consumerReleased === false) return { cleaned: false };
    if (!heldLease) { const observed = await store.tryWithResourceLock("repository-execution", runLease(c), lease => cleanup(c, id, p, lease)); return observed.acquired ? observed.value : { cleaned: false }; }
    heldLease.assert(); cleanupOwners.add(key(c, id));
    try {
      await p.sessions.recover(c);
      if (!await p.sessions.consumerStopped(c, id)) return { cleaned: false };
      const results = await Promise.allSettled([p.images.cleanup(c, id), p.inputs.cleanup(c, id), p.tools.cleanup(c, id), ...(p.legacyImages ? [p.legacyImages.cleanup(c, id)] : [])]);
      const cleaned = results.every(result => result.status === "fulfilled" && result.value.cleaned === true);
      heldLease.assert();
      if (cleaned) await update(c, id, "windows-run-storage-retired", row => { row.cleanupPending = false; row.storageRetiredAt = now(); });
      return { cleaned };
    } finally { cleanupOwners.delete(key(c, id)); }
  }
  async function recover(c) {
    seen.add(c);
    const observed = await store.tryWithResourceLock("repository-execution", runLease(c), async lease => {
      const state = await store.snapshot(c);
      // Opening an unrelated workspace must not require the optional Windows
      // Run helper. Retained ownership still requires the real native ports.
      if (!(state.repositoryWindowsRuns?.length || state.repositoryWindowsBrokerExchanges?.some(row => row.cleanupPending) || state.repositoryWindowsImages?.some(row => row.cleanupPending) || state.repositoryWindowsGuests?.some(row => row.stoppedVerified !== true) || state.repositoryWindowsGuestCommands?.some(row => row.stoppedVerified !== true))) return { cleaned: true };
      const p = await ports();
      let cleaned = true; await p.sessions.recover(c); lease.assert();
      for (const row of (await store.snapshot(c)).repositoryWindowsRuns ?? []) {
        if (row.schema !== schema) throw Error("Preserve an unfamiliar protected Windows Run schema.");
        if (resources.has(key(c, row.operationId))) { cleaned = false; continue; }
        if (!(await cleanup(c, row.operationId, p, lease)).cleaned) cleaned = false;
        if (row.status === "executing") await update(c, row.operationId, "windows-run-interruption-observed", row => { row.status = "outcome-unconfirmed"; row.recoveredWithoutReplay = true; });
      }
      // The already-held Run lease proves no preparation is live, including
      // orphaned assets whose final Run cleanup write was lost. Do not try to
      // reacquire that same kernel lease from consumerStopped.
      const retained = await store.snapshot(c);
      for (const [port, rows] of [[p.legacyImages, retained.repositoryWindowsImages], [p.images, retained.repositoryWindowsBrokerExchanges]]) {
        if (!port) continue;
        for (const asset of rows ?? []) if (asset.cleanupPending) {
          const owner = key(c, asset.operationId); cleanupOwners.add(owner);
          try { if (!(await port.cleanup(c, asset.operationId)).cleaned) cleaned = false; }
          finally { cleanupOwners.delete(owner); }
        }
      }
      return { cleaned };
    });
    return observed.acquired ? observed.value : { cleaned: false };
  }
  async function stopCompartment(c) {
    await store.update(c, "windows-run-workspace-cancel", state => { for (const row of state.repositoryWindowsRuns ?? []) if (row.schema === schema && row.cleanupPending) row.stopRequestedAt ??= now(); });
    const active = [...resources.values()].filter(resource => resource.compartment === c);
    active.forEach(resource => resource.controller.abort());
    if (portsPromise && active.length) {
      const p = await ports(), stopped = await Promise.allSettled([p.sessions.stopCompartment(c), p.inputs.stopCompartment(c), p.tools.stopCompartment(c), p.images.stopCompartment(c), ...(p.legacyImages ? [p.legacyImages.stopCompartment(c)] : [])]);
      await Promise.allSettled(active.map(resource => resource.done));
      const recovered = await recover(c);
      return { stopped: stopped.every(result => result.status === "fulfilled" && result.value.stopped !== false) || recovered.cleaned, ...recovered };
    }
    if (portsPromise) { const recovered = await recover(c); return { stopped: recovered.cleaned, ...recovered }; }
    return { stopped: true, cleaned: true };
  }
  return {
    async prerequisites() {
      const p = await ports();
      if (p.identities.nodeVersion !== "24.14.0") throw Error("Windows Run requires its pinned Node 24.14.0 prerequisite.");
      return structuredClone(p.identities);
    },
    async run(c, context, plan, authorize, signal, action = "run_target", gitOptions) {
      context = structuredClone(context); plan = structuredClone(plan);
      const withIndex=plan&&Object.hasOwn(plan,"indexWitness"),withHistory=plan&&Object.hasOwn(plan,"historyWitness");
      if (!connectedExecutionActions("win32").includes(action) || platform !== "win32" || !context || Object.keys(context).sort().join() !== "operationId,provider,scopeDigest" || !uuid(context.operationId) || !digest(context.scopeDigest) || !["codex", "claude-code"].includes(context.provider) || typeof authorize !== "function"
        || !plan || Object.keys(plan).sort().join() !== (withIndex&&withHistory?"allowedFiles,historyWitness,indexWitness,manifestPath,manifestSha256,repositoryRoot,sourceIdentity":withHistory?"allowedFiles,historyWitness,manifestPath,manifestSha256,repositoryRoot,sourceIdentity":withIndex?"allowedFiles,indexWitness,manifestPath,manifestSha256,repositoryRoot,sourceIdentity":"allowedFiles,manifestPath,manifestSha256,repositoryRoot,sourceIdentity")) throw Error("Bind Windows Run only to one host-admitted task operation and exact reviewed file plan.");
      if (withIndex && withHistory && (typeof plan.indexWitness?.head !== "string" || plan.indexWitness.head !== plan.historyWitness?.head)) throw Error("Combined Windows Git inputs require one reviewed HEAD before orchestration.");
      const gitKeys = [...(withIndex ? ["useIndexInputs"] : []), ...(withHistory ? ["useHistoryInputs"] : [])].sort();
      if (withIndex && !windowsShieldActions.includes(action) || withHistory && !["shield_codebase_audit","release_shield"].includes(action) || gitKeys.length && (!gitOptions || Object.keys(gitOptions).sort().join() !== gitKeys.join() || gitKeys.some(key => typeof gitOptions[key] !== "function")) || !gitKeys.length && gitOptions !== undefined) throw Error("Reserved Windows Git inputs require their private current Shield consumers; no worktree fallback is permitted.");
      if (closed || [...resources.values()].some(resource => resource.compartment === c)) throw Error("Wait for the current owned Windows Run; no concurrent replacement was started.");
      const id = context.operationId, operationKey = key(c, id), planDigest = scopeHash(plan), resource = { compartment: c, controller: new AbortController(), consumerReleased: false, done: null };
      resources.set(operationKey, resource); seen.add(c);
      const check = async () => { resource.lease?.assert(); if (closed || resource.controller.signal.aborted || signal?.aborted || !await isActive(c) || resource.reserved === true && (await get(c, id))?.stopRequestedAt !== undefined) throw Error("This exact Windows Run was stopped or its workspace changed."); await store.authorize(c, { provider: context.provider }); await authorize(); resource.lease?.assert(); };
      resource.done = store.withResourceLock("repository-execution", runLease(c), async lease => {
        resource.lease = lease;
        let reserved = false, result, p, pollTimer, polling = false;
        try {
          lease.assert(); await check(); p = await ports(); if (p.identities.nodeVersion !== "24.14.0") throw Error("Windows Run requires its pinned Node 24.14.0 prerequisite; no runtime was downloaded or substituted.");
          const prior = await get(c, id);
          if (prior) {
            if (prior.planDigest !== planDigest || prior.scopeDigest !== context.scopeDigest || prior.provider !== context.provider || (prior.action ?? "run_target") !== action) throw Error("The retained Windows Run belongs to a different exact review; no replay is available.");
            return { ...(prior.result ?? { status: "incomplete", summary: "The original Windows Run remains unconfirmed." }), replayed: true, providerTaskCompletionVerified: false };
          }
          await p.sessions.recover(c);
          const retained = await store.snapshot(c);
          if ([retained.repositoryWindowsRuns, retained.repositoryWindowsImages, retained.repositoryWindowsBrokerExchanges].some(rows => rows?.some(row => row.cleanupPending))) throw Error("Reconcile the existing Windows Run's native owners and storage before another run.");
          const loaded = await loadWindowsReviewedRun({ ...plan, expectedAction: action, recipeRuntimeSha256: p.identities.recipeRuntime.sha256 }); await check();
          await store.update(c, "windows-run-reserve", state => { const rows = state.repositoryWindowsRuns ?? []; if (rows.some(row => row.operationId === id || row.cleanupPending)) throw Error("The Windows Run reservation changed."); state.repositoryWindowsRuns = [...rows.slice(-32), { schema, ...context, action, planDigest, status: "executing", phase: "reserved", cleanupPending: true, createdAt: now() }]; }); reserved = true; resource.reserved = true;
          const preflight = await p.sessions.metadata(c,context,check,signal); await check();
          const storage = validateWindowsStoragePrerequisites(preflight.storage);
          if (!["available","unavailable"].includes(preflight.status) || preflight.effectStarted !== false) throw Error("The native Windows Run preflight did not verify.");
          await update(c,id,"windows-run-preflight",row=>{row.preflight={status:preflight.status,storage,observedAt:now()};});
          const broker = preflight.status === "available" && typeof p.images.probe === "function" ? await p.images.probe(c, context, check) : null;
          if (broker && (!["available", "unavailable"].includes(broker.status) || broker.effectStarted !== false)) throw Error("The exact read-only broker capability did not verify.");
          if (broker) await update(c, id, "windows-run-broker-preflight", row => { row.preflight.broker = structuredClone(broker); });
          if (preflight.status !== "available" || (broker ? broker.status !== "available" : storage.requiresPrivilegedSetup)) {
            result = { status:"unavailable", summary:preflight.status !== "available" ? "Windows Run requires the current-user Windows Sandbox command interface." : "Windows Run requires the separately installed, authenticated scoped storage service. No inputs or exchange storage were staged.", providerTaskCompletionVerified:false };
            await update(c,id,"windows-run-preflight-unavailable",row=>{row.status="settled";row.phase="preflight";row.result=result;row.nativeExitVerified=true;row.cleanupPending=false;});
            return result;
          }
          pollTimer = setInterval(async () => {
            if (polling) return; polling = true;
            try { const row = await get(c, id); if (!row || row.stopRequestedAt !== undefined) resource.controller.abort(); }
            catch { resource.controller.abort(); }
            finally { polling = false; }
          }, 500); pollTimer.unref?.();
          const inputRequest={repositoryRoot:plan.repositoryRoot,sourceIdentity:plan.sourceIdentity,inputFiles:loaded.manifest.inputFiles};
          if(windowsShieldActions.includes(action)&&loaded.manifest.inputFiles.some(file=>!withIndex&&file.path.startsWith(shieldIndexPrefix)||!withHistory&&file.path.startsWith(shieldHistoryPrefix)))throw Error("Windows scanner aliases cannot use physical worktree input staging.");
          const request={files:[
            ...(plan.indexWitness?.rows ?? []).map(row=>({path:shieldIndexPrefix+row.path,sha256:row.sha256,size:row.size,source:{kind:"git-index",path:row.path,objectId:row.objectId,mode:row.mode}})),
            ...(plan.historyWitness?.rows ?? []).map(row=>({path:shieldHistoryPrefix+row.commit+"/"+row.path,sha256:row.sha256,size:row.size,source:{kind:"git-history",path:row.path,commit:row.commit,objectId:row.objectId,mode:row.mode,depth:plan.historyWitness.requestedDepth}}))
          ]};
          const input = await withShieldGitInputs({request,indexWitness:plan.indexWitness,historyWitness:plan.historyWitness},gitOptions,options=>p.inputs.prepare(c,context,inputRequest,check,gitKeys.length?{
            action,...(withIndex?{indexWitness:plan.indexWitness}:{}),...(withHistory?{historyWitness:plan.historyWitness}:{}),...options
          }:undefined));
          await check();
          await update(c, id, "windows-run-inputs-ready", row => { row.phase = "inputs"; });
          const tools = await p.tools.prepare(c, context, { expectedSha256: p.identities.helperSha256 }, check); await tools.assertCurrent(); await check();
          const image = await p.images.prepare(c, context, check, { inputManifestSha256: input.inputManifestSha256 }), exchange = await image.createVolume(); await check();
          await update(c, id, "windows-run-volume-ready", row => { row.phase = "volume"; });
          const destinationRoot = join(stateDirectory, c, "results", id), backendRoot = join(stateDirectory, c, "backends", id);
          await privateDirectory(destinationRoot); await privateDirectory(backendRoot);
          await exchange.assertCurrent?.();
          const allowedTaskRoots = [plan.repositoryRoot, stateDirectory];
          if (exchange.nativeBinding?.broker) allowedTaskRoots.push(exchange.nativeBinding.stagingRoot);
          const runner = p.sessions.forOperation(c, context, check), backend = backendFactory({ allowedTaskRoots, stateRoot: backendRoot, helperDirectory: tools.root, helperFilename: tools.helperFilename, jobManifestRelativePath: loaded.manifest.catalogPath, requireReviewedInputs: true, requireBoundedExchange: true, timeoutMs: loaded.timeoutMs, maxProcessOutputBytes: loaded.recipe.maxOutputBytes, runner, effectGuard: { check: async () => { await check(); await tools.assertCurrent(); return { allowed: true, reason: "The exact host-admitted Windows Run remains current." }; } } });
          const combined = AbortSignal.any([resource.controller.signal, ...(signal ? [signal] : [])]);
          const observed = await backend.execute({ targetRoot: plan.repositoryRoot, destinationRoot, profile: "full_sandbox", recipeId: action, expectedRecipeCatalogSha256: loaded.manifest.catalogSha256, expectedHelperSha256: p.identities.helperSha256, reviewedInputs: input, reviewedExchange: exchange, operationId: id, signal: combined });
          lease.assert(); await update(c, id, "windows-run-backend-observed", row => { row.backendObservation = observed; });
          const nativeExitVerified = await p.sessions.consumerStopped(c, id);
          result = observed.status === "completed" && !nativeExitVerified || observed.status === "running"
            ? { status: "incomplete", summary: "The Windows Run backend returned without independently confirmed guest and native exit. Preserve its original receipt; no program was replayed.", ...(observed.receiptPath ? { receiptPath: observed.receiptPath } : {}) }
            : observed;
          await update(c, id, "windows-run-exit-observed", row => { row.nativeExitVerified = nativeExitVerified; });
          lease.assert(); await update(c, id, "windows-run-result", row => { row.status = "settled"; row.phase = "result"; row.result = { ...result, providerTaskCompletionVerified: false }; });
          return { ...result, providerTaskCompletionVerified: false };
        } catch (error) {
          if (reserved) await update(c, id, "windows-run-unconfirmed", row => { row.status = "outcome-unconfirmed"; }).catch(() => {});
          throw error;
        } finally {
          clearInterval(pollTimer);
          resource.consumerReleased = true;
          if (reserved && p) await cleanup(c, id, p, lease).catch(() => ({ cleaned: false }));
        }
      }).finally(() => { if (resources.get(operationKey) === resource) resources.delete(operationKey); });
      return resource.done;
    },
    recover, stopCompartment,
    async stopOperation(c, id) {
      const row = await get(c, id);
      if (!row || row.schema !== schema) return { accepted: false, stopped: false };
      await update(c, id, "windows-run-cancel-requested", row => { row.stopRequestedAt ??= now(); });
      const resource = resources.get(key(c, id));
      if (resource) { resource.controller.abort(); await stopCompartment(c); }
      else await recover(c);
      return { accepted: true, stopped: (await get(c, id))?.cleanupPending === false, originalOutcomeUnchanged: true };
    },
    async list(c) { return ((await store.snapshot(c)).repositoryWindowsRuns ?? []).map(row => ({ operationId: row.operationId, scopeDigest: row.scopeDigest, status: row.status, phase: row.phase, cleanupPending: row.cleanupPending, result: row.result ?? null, providerTaskCompletionVerified: false })); },
    async close() { closed = true; const stopped = await Promise.all([...seen].map(stopCompartment)); if (portsPromise) { const p = await ports(); const results = await Promise.allSettled([p.sessions.close(), p.inputs.close(), p.tools.close(), p.images.close(), ...(p.legacyImages ? [p.legacyImages.close()] : [])]); if (results.some(result => result.status === "rejected") || stopped.some(result => !result.stopped)) throw Error("A Windows Run native owner remains unconfirmed; preserve its exact resources."); } }
  };
}
