/** Explicit Linux task-owner registry. Loading needs an exact one-use review; no model or IDE authority. */
import { createHash } from "node:crypto";
import { join, posix } from "node:path";
import { createCodexUnixTasks } from "./codex-unix-tasks.mjs";
import { retireStoppedCodexListener } from "./codex-owned-listener.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
import { suiteConfirmations } from "./confirmations.mjs";
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function binding(task) {
  if (!task || task.provider !== "codex" || task.status !== "registered" || !uuid(task.id) || typeof task.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(task.sessionId) || !/^[a-f0-9]{64}$/.test(task.accountFingerprint ?? "") || !task.repositoryIdentity?.device || !task.repositoryIdentity?.inode) throw Error("Choose an exact registered Codex task with its original account and repository identity.");
  return { taskId: task.id, sessionId: task.sessionId, accountFingerprint: task.accountFingerprint, repositoryRoot: task.repositoryRoot, repositoryIdentity: structuredClone(task.repositoryIdentity), taskSchema: task.schema ?? null, launchPolicy: task.launchPolicy ?? null, nativeTransport: task.nativeTransport ?? null };
}
const view = row => ({ requestId: row.requestId, taskId: row.taskId, status: row.status, stoppedVerified: row.stoppedVerified, metadataObserved: row.status === "bound", nativeTaskLoaded: false, ideAttached: false, completionVerified: false });
export function createCodingTaskOwners({ store, root, runtimeRoot, resolveCli, resolveMcp, driverFactory = createCodexUnixTasks, retire = retireStoppedCodexListener, platform = process.platform, now = Date.now, isActive = async () => true } = {}) {
  const live = new Map(), pending = new Map(), generations = new Map(); let closed = false;
  const key = (c, id) => `${c}:${id}`;
  const generation = c => generations.get(c) ?? 0;
  const current = (c, g) => { if (closed || generation(c) !== g) throw Error("This task owner admission has stopped."); };
  async function exact(c, original, g) {
    current(c, g); if (!(await isActive(c))) throw Error("The original task workspace is no longer active.");
    await store.authorize(c, { provider: "codex" }); current(c, g);
    const task = (await store.snapshot(c)).codingSessions?.find(t => t.id === original.taskId);
    if (digest(binding(task)) !== digest(original)) throw Error("The original task, native account or repository binding changed.");
    await verifyRepositoryIdentity(original); current(c, g); if (!(await isActive(c))) throw Error("The original task workspace is no longer active.");
  }
  async function update(c, id, action, fn, provider = false) {
    return store.update(c, action, s => { const row = s.codingTaskOwners?.find(r => r.requestId === id); if (!row) throw Error("The original task owner reservation is unavailable."); return fn(row, s); }, provider ? { provider: "codex" } : {});
  }
  async function ownedRecord(c, id, resource) {
    const row = (await store.snapshot(c)).codingTaskOwners?.find(r => r.requestId === id);
    if (!row || row.status !== "bound" || row.bindingDigest !== digest(resource.original) || row.ownershipDigest !== digest([resource.owner.scope, resource.owner.privateOwnership]) || row.ownershipDigest !== digest([row.scope, row.privateOwnership]) || !resource.owner.binding || resource.owner.closed) throw Error("The original protected task owner changed.");
    return row;
  }
  async function loadBoundary(c, ownerId, resource) {
    await exact(c, resource.original, resource.g);
    const original = resource.original;
    if (original.taskSchema !== "switchyard-coding-session/v1" || original.launchPolicy !== "read-only/on-request" || original.nativeTransport !== "owned-stdio") throw Error("Only an exact Switchyard-created read-only task can be loaded on this owned connection.");
    const row = await ownedRecord(c, ownerId, resource);
    const login = await resource.driver.account(c);
    if (login?.type !== "chatgpt" || login.fingerprint !== original.accountFingerprint) throw Error("The original native task account changed before loading.");
    await exact(c, original, resource.g); await ownedRecord(c, ownerId, resource);
    return row;
  }
  const loadScope = (c, row, state) => ({ action: "load_codex_task", sessionId: row.sessionId,
    targetSnapshotId: digest(["switchyard-owned-task-load/v1", c, row.requestId, row.bindingDigest, row.ownershipDigest]),
    scopeDigest: digest([state.policy, state.mode, state.accounts, "read-only/on-request", "no-model-turn"]) });
  const loadView = (row, current = false) => ({ requestId: row.requestId, ownerRequestId: row.ownerRequestId, taskId: row.taskId, status: row.status,
    nativeLoadAcknowledged: row.status === "loaded", nativeTaskLoaded: current && row.status === "loaded", modelPromptSubmitted: false, ideAttached: false, completionVerified: false });
  async function stopRecord(c, id, resource) {
    if (resource.stopping) return resource.stopping;
    resource.stopping = (async () => {
      let driverStopped = false, ownerStopped = !resource.owner;
      try { const exits = await resource.driver.close(); driverStopped = Array.isArray(exits) && exits.every(e => e?.stopped === true); } catch { /* Still retire the original native owner independently. */ }
      if (resource.owner) { try { ownerStopped = (await resource.owner.stop()).stopped === true; } catch { ownerStopped = false; } }
      let result = driverStopped && ownerStopped;
      await update(c, id, "coding-owner-retirement", row => {
        // Native exit belongs to this in-memory owner, never a replacement
        // protected record. Earlier startup checkpoints may omit later fields.
        const actual = resource.owner?.privateOwnership;
        if (row.bindingDigest !== digest(resource.original) || row.scope && digest(row.scope) !== digest(resource.owner?.scope) || row.privateOwnership && (!actual || Object.entries(row.privateOwnership).some(([name, value]) => digest(value) !== digest(actual[name])))) result = false;
        row.status = result ? "stopped" : "uncertain"; row.stoppedVerified = result; row.updatedAt = now();
      });
      if (result && live.get(key(c, id)) === resource) live.delete(key(c, id));
      return { stopped: result };
    })();
    try { return await resource.stopping; } finally { resource.stopping = null; }
  }

  async function editorObservation(c, { ownerRequestId, loadRequestId }, returning = false) {
    if (![ownerRequestId, loadRequestId].every(uuid)) throw Error("Choose the original owner and acknowledged load UUIDs.");
    const resource = live.get(key(c, ownerRequestId)); if (!resource) throw Error("This host does not own the original live task connection.");
    const boundary = async () => {
      const owner = await loadBoundary(c, ownerRequestId, resource), state = await store.snapshot(c);
      const load = state.codingTaskLoads?.find(row => row.requestId === loadRequestId);
      if (!load || load.schema !== "switchyard-coding-task-load/v1" || load.status !== "loaded" || load.ownerRequestId !== ownerRequestId || load.taskId !== owner.taskId || load.acknowledgedThreadId !== owner.sessionId || load.bindingDigest !== owner.bindingDigest || load.ownershipDigest !== owner.ownershipDigest || load.scopeDigest !== digest(loadScope(c, owner, state)) || !uuid(owner.sessionId)) throw Error("The original acknowledged load and current policy do not verify an exact editor target.");
      return { owner, load };
    };
    const initial = await boundary();
    if (typeof resource.owner.inspectBinding !== "function") throw Error("This owner cannot recheck its original editor endpoint.");
    const endpoint = await resource.owner.inspectBinding();
    const fields = ["socketPath", "socketDevice", "socketInode", "peerPid", "peerBirth", "peerExecutableSha256"];
    if (!endpoint || Object.keys(endpoint).sort().join() !== fields.sort().join() || typeof endpoint.socketPath !== "string" || !endpoint.socketPath.startsWith("/") || Buffer.byteLength(endpoint.socketPath) > 103 || /[\\\x00-\x20\x7f#?%]/.test(endpoint.socketPath) || ![endpoint.socketDevice, endpoint.socketInode, endpoint.peerBirth].every(v => typeof v === "string" && /^[1-9]\d{0,24}$/.test(v)) || !Number.isSafeInteger(endpoint.peerPid) || endpoint.peerPid < 1 || !/^[a-f0-9]{64}$/.test(endpoint.peerExecutableSha256 ?? "") || digest(endpoint) !== digest(resource.owner.binding)) throw Error("The original editor endpoint identity is incomplete or changed.");
    const observed = await resource.driver.read(initial.owner.sessionId, initial.owner.repositoryRoot, c);
    if (observed.id !== initial.owner.sessionId || observed.repositoryRoot !== initial.owner.repositoryRoot || !(returning ? ["idle", "active"] : ["idle"]).includes(observed.observation)) throw Error("The exact editor task is unavailable for this operation.");
    const final = await boundary();
    if (digest(initial) !== digest(final) || digest(await resource.owner.inspectBinding()) !== digest(endpoint)) throw Error("The original editor target changed during preparation.");
    if (posix.normalize(endpoint.socketPath) !== endpoint.socketPath || digest(initial) !== digest(await boundary())) throw Error("The editor target or policy changed after endpoint inspection.");
    const target = { schema: "switchyard-codex-editor-target/v1", ownerRequestId, loadRequestId, taskId: final.owner.taskId, sessionId: final.owner.sessionId, repositoryRoot: final.owner.repositoryRoot, repositoryIdentity: structuredClone(resource.original.repositoryIdentity), accountFingerprint: resource.original.accountFingerprint, permissions: "read-only/on-request", endpoint };
    return { target, targetDigest: digest(target), metadataObserved: true, nativeLoadAcknowledged: true, nativeTaskLoaded: false, authorityGranted: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false };
  }

  return {
    async list(c) { await store.authorize(c, { provider: "codex" }); return ((await store.snapshot(c)).codingTaskOwners ?? []).map(view); },
    async listLoads(c) { await store.authorize(c, { provider: "codex" }); return ((await store.snapshot(c)).codingTaskLoads ?? []).map(row => loadView(row)); },
    async open(c, { requestId, taskId }) {
      if (platform !== "linux") throw Error("Persistent task metadata owners currently require Linux.");
      if (!uuid(requestId) || !uuid(taskId)) throw Error("Choose exact task and owner request UUIDs.");
      const g = generation(c), operationKey = key(c, requestId); current(c, g);
      if (pending.has(operationKey)) return pending.get(operationKey);
      const operation = store.withResourceLock("coding-task", key(c, taskId), async lease => {
        current(c, g); await store.authorize(c, { provider: "codex" });
        const original = binding((await store.snapshot(c)).codingSessions?.find(t => t.id === taskId)); await exact(c, original, g); lease.assert();
        const reservation = await store.update(c, "coding-owner-reserve", s => {
          current(c, g); const fresh = binding(s.codingSessions?.find(t => t.id === taskId)); if (digest(fresh) !== digest(original)) throw Error("The task changed before owner reservation.");
          const rows = s.codingTaskOwners ??= [], existing = rows.find(r => r.requestId === requestId);
          if (existing) { if (existing.bindingDigest !== digest(original)) throw Error("This owner request already names another task binding."); return { duplicate: true, value: view(existing) }; }
          if (rows.some(r => r.taskId === taskId && r.stoppedVerified !== true)) throw Error("The original task owner has not verified retirement. No replacement was started.");
          if (rows.length >= 64) throw Error("Task owner history is full. Existing no-replay records are preserved.");
          rows.push({ schema: "switchyard-coding-task-owner/v1", requestId, ...original, bindingDigest: digest(original), status: "reserved", stoppedVerified: false, createdAt: now(), updatedAt: now() });
          return { duplicate: false };
        }, { provider: "codex" });
        if (reservation.duplicate) return { ...reservation.value, duplicatePrevented: true };
        let resource;
        const retain = async (status, owner, scope = owner.scope) => {
          lease.assert(); await exact(c, original, g);
          if (resource.owner && resource.owner !== owner) throw Error("The original native task owner cannot be replaced."); resource.owner = owner;
          const ownership = structuredClone(owner.privateOwnership), prior = { "reserved-private": "reserved", "guardian-ready": "reserved-private", listening: "guardian-ready", authenticated: "listening" }[status];
          await update(c, requestId, "coding-owner-" + status, row => {
            current(c, g); if (row.bindingDigest !== digest(original) || row.stoppedVerified || row.status !== prior || row.scope && digest(row.scope) !== digest(scope)) throw Error("The task owner reservation changed before native startup.");
            row.scope = scope ? structuredClone(scope) : null; row.privateOwnership = ownership; row.ownershipDigest = digest([row.scope, ownership]); row.status = status; row.updatedAt = now();
          }, true);
          await exact(c, original, g); lease.assert();
        };
        const driver = driverFactory({ store, ...(root ? { root: join(root, requestId) } : {}), runtimeRoot, resolveCli, resolveMcp,
          onReserved: (_c, owner) => retain("reserved-private", owner), onReady: (_c, scope, owner) => retain("guardian-ready", owner, scope), onListening: (_c, owner) => retain("listening", owner),
          onAuthenticated: async (_c, owner) => { if (owner.accountFingerprint !== original.accountFingerprint) throw Error("The owned listener belongs to another native account."); await retain("authenticated", owner); }
        });
        resource = { driver, compartment: c, owner: null, original, g }; live.set(operationKey, resource);
        try {
          const login = await driver.account(c); await exact(c, original, g);
          if (login?.type !== "chatgpt" || login.fingerprint !== original.accountFingerprint || !resource.owner?.binding) throw Error("The exact owned account and listener did not verify.");
          const observed = await driver.read(original.sessionId, original.repositoryRoot, c); await exact(c, original, g);
          if (observed.id !== original.sessionId || observed.repositoryRoot !== original.repositoryRoot || (await driver.account(c)).fingerprint !== original.accountFingerprint) throw Error("The task metadata changed before owner binding.");
          await exact(c, original, g); lease.assert();
          const result = await update(c, requestId, "coding-owner-bound", (row, state) => { current(c, g); if (row.status !== "authenticated" || row.bindingDigest !== digest(original) || digest(binding(state.codingSessions?.find(t => t.id === taskId))) !== digest(original)) throw Error("The authenticated owner reservation changed."); row.status = "bound"; row.updatedAt = now(); return view(row); }, true);
          await exact(c, original, g); return result;
        } catch (error) { await stopRecord(c, requestId, resource).catch(() => {}); throw error; }
      });
      pending.set(operationKey, operation);
      try { return await operation; } finally { if (pending.get(operationKey) === operation) pending.delete(operationKey); }
    },
    async read(c, requestId) {
      if (!uuid(requestId)) throw Error("Choose an exact owner request UUID.");
      const resource = live.get(key(c, requestId)); if (!resource) throw Error("This host does not own the original live task connection; no process was adopted.");
      await exact(c, resource.original, resource.g);
      await ownedRecord(c, requestId, resource);
      const login = await resource.driver.account(c); if (login.fingerprint !== resource.original.accountFingerprint) throw Error("The original native task account changed.");
      const result = await resource.driver.read(resource.original.sessionId, resource.original.repositoryRoot, c); await exact(c, resource.original, resource.g);
      if (result.id !== resource.original.sessionId || result.repositoryRoot !== resource.original.repositoryRoot || (await resource.driver.account(c)).fingerprint !== resource.original.accountFingerprint) throw Error("The exact native task metadata changed.");
      await exact(c, resource.original, resource.g); await ownedRecord(c, requestId, resource);
      if (!["not-observed", "idle", "error", "waiting-on-approval", "active", "unknown"].includes(result.observation)) throw Error("The owned provider returned an unfamiliar metadata state.");
      return { observation: result.observation, completionVerified: false, nativeTaskLoaded: false, ideAttached: false };
    },
    async reviewLoad(c, ownerRequestId) {
      if (!uuid(ownerRequestId)) throw Error("Choose an exact owner request UUID.");
      const resource = live.get(key(c, ownerRequestId)); if (!resource) throw Error("This host does not own the original live task connection.");
      const row = await loadBoundary(c, ownerRequestId, resource), state = await store.snapshot(c);
      if (state.codingTaskLoads?.some(r => r.ownerRequestId === ownerRequestId)) throw Error("This owner already has a retained load request. Its outcome cannot be replayed.");
      await store.claimSession(c, { provider: "codex", sessionId: row.sessionId });
      const confirmation = await suiteConfirmations(store, c, "codex", now).issue({ ...loadScope(c, row, state), reason: "Load this exact saved task on its original owned native connection with read-only/on-request permissions. No model turn or IDE attachment is included.", reauthenticated: false });
      await loadBoundary(c, ownerRequestId, resource);
      return { status: "requires-confirmation", confirmation, scope: { ownerRequestId, taskId: row.taskId, sessionId: row.sessionId, repositoryRoot: row.repositoryRoot, accountFingerprint: row.accountFingerprint, permissions: "read-only/on-request" }, modelPromptSubmitted: false, nativeTaskLoaded: false, ideAttached: false };
    },
    editorTarget(c, selected) { return editorObservation(c, selected); },
    editorReturnTarget(c, selected) { return editorObservation(c, selected, true); },
    async load(c, { ownerRequestId, requestId, token }) {
      if (![ownerRequestId, requestId, token].every(uuid)) throw Error("Use the exact owner UUID, stable load UUID and one-use review token.");
      await store.authorize(c, { provider: "codex" });
      const duplicate = state => { const row = state.codingTaskLoads?.find(r => r.requestId === requestId); if (!row) return null; if (row.ownerRequestId !== ownerRequestId) throw Error("This load UUID already names another owner."); return { ...loadView(row), duplicatePrevented: true }; };
      const previous = duplicate(await store.snapshot(c)); if (previous) return previous;
      const resource = live.get(key(c, ownerRequestId)); if (!resource) throw Error("This host does not own the original live task connection.");
      const operationKey = key(c, "load-" + requestId);
      if (pending.has(operationKey)) return pending.get(operationKey);
      const operation = store.withResourceLock("coding-task", key(c, resource.original.taskId), async lease => {
        const again = duplicate(await store.snapshot(c)); if (again) return again;
        const row = await loadBoundary(c, ownerRequestId, resource), state = await store.snapshot(c), scope = loadScope(c, row, state);
        const decision = await suiteConfirmations(store, c, "codex", now).consume({ ...scope, token }); if (!decision.allowed) throw Error(decision.reason);
        await store.update(c, "coding-owner-load-reserve", s => {
          current(c, resource.g); lease.assert();
          const owner = s.codingTaskOwners?.find(r => r.requestId === ownerRequestId);
          if (!owner || owner.status !== "bound" || digest(loadScope(c, owner, s)) !== digest(scope) || digest(binding(s.codingSessions?.find(t => t.id === row.taskId))) !== row.bindingDigest) throw Error("The reviewed task owner or policy changed before load reservation.");
          const rows = s.codingTaskLoads ??= [];
          if (rows.some(r => r.ownerRequestId === ownerRequestId || r.requestId === requestId)) throw Error("The original load outcome is already retained; no replay is allowed.");
          if (rows.length >= 64) throw Error("Task load history is full. Original request identities are preserved.");
          rows.push({ schema: "switchyard-coding-task-load/v1", requestId, ownerRequestId, taskId: row.taskId, bindingDigest: row.bindingDigest, ownershipDigest: row.ownershipDigest, scopeDigest: digest(scope), status: "reserved", acknowledgedThreadId: null, createdAt: now(), updatedAt: now() });
        }, { provider: "codex" });
        let attempted = false, acknowledged = false;
        const beforeEffect = async () => {
          await loadBoundary(c, ownerRequestId, resource); lease.assert();
          await store.update(c, "coding-owner-load-boundary", s => {
            current(c, resource.g); lease.assert(); const owner = s.codingTaskOwners?.find(r => r.requestId === ownerRequestId), saved = s.codingTaskLoads?.find(r => r.requestId === requestId);
            if (!owner || owner.status !== "bound" || digest(loadScope(c, owner, s)) !== digest(scope) || digest(binding(s.codingSessions?.find(t => t.id === row.taskId))) !== row.bindingDigest || !saved || saved.ownerRequestId !== ownerRequestId || saved.scopeDigest !== digest(scope) || !["reserved", "attempting"].includes(saved.status)) throw Error("The original reviewed load boundary changed.");
            saved.status = "attempting"; saved.updatedAt = now();
          }, { provider: "codex" }); attempted = true;
        };
        try {
          const observed = await resource.driver.read(row.sessionId, row.repositoryRoot, c);
          if (observed.id !== row.sessionId || observed.repositoryRoot !== row.repositoryRoot || observed.observation !== "idle") throw Error("Only a freshly observed idle task may be loaded; its running permissions are preserved.");
          await beforeEffect();
          const result = await resource.driver.resume(row.sessionId, row.repositoryRoot, c, { beforeEffect });
          acknowledged = result?.id === row.sessionId;
          if (!acknowledged || result.repositoryRoot !== row.repositoryRoot || result.permissions !== "read-only/on-request" || result.modelPromptSubmitted !== false) throw Error("The owned task load did not verify its exact identity and permissions.");
          await beforeEffect();
          return await store.update(c, "coding-owner-load-acknowledged", s => {
            current(c, resource.g); lease.assert(); const owner = s.codingTaskOwners?.find(r => r.requestId === ownerRequestId), saved = s.codingTaskLoads?.find(r => r.requestId === requestId);
            if (!owner || owner.status !== "bound" || digest(loadScope(c, owner, s)) !== digest(scope) || digest(binding(s.codingSessions?.find(t => t.id === row.taskId))) !== row.bindingDigest || !saved || saved.ownerRequestId !== ownerRequestId || saved.scopeDigest !== digest(scope) || saved.status !== "attempting") throw Error("The original owner changed before load acknowledgement.");
            saved.status = "loaded"; saved.acknowledgedThreadId = row.sessionId; saved.updatedAt = now(); return loadView(saved, true);
          }, { provider: "codex" });
        } catch (error) {
          acknowledged ||= error.resumedThreadId === row.sessionId;
          await store.update(c, "coding-owner-load-uncertain", s => {
            const saved = s.codingTaskLoads?.find(r => r.requestId === requestId);
            if (!saved || saved.ownerRequestId !== ownerRequestId || saved.scopeDigest !== digest(scope)) throw Error("The original load record changed; preserve it for review.");
            saved.status = attempted || acknowledged ? "outcome-unconfirmed" : "refused-before-effect"; if (acknowledged) saved.acknowledgedThreadId = row.sessionId; saved.updatedAt = now();
          }).catch(() => {});
          await stopRecord(c, ownerRequestId, resource).catch(() => {}); throw error;
        }
      });
      resource.loads ??= new Set(); resource.loads.add(operation);
      pending.set(operationKey, operation);
      try { return await operation; } finally { resource.loads.delete(operation); if (pending.get(operationKey) === operation) pending.delete(operationKey); }
    },
    async recover(c, requestId) {
      if (!uuid(requestId)) throw Error("Choose an exact owner request UUID."); await store.authorize(c, { provider: "codex" });
      const row = (await store.snapshot(c)).codingTaskOwners?.find(r => r.requestId === requestId); if (!row) throw Error("No protected original owner exists.");
      return store.withResourceLock("coding-task", key(c, row.taskId), async lease => {
        if (live.has(key(c, requestId))) throw Error("Use this host's normal shutdown for its live owner.");
        const retained = (await store.snapshot(c)).codingTaskOwners?.find(r => r.requestId === requestId);
        if (digest(retained) !== digest(row)) throw Error("The protected recovery owner changed.");
        if (row.stoppedVerified) return { stopped: true, duplicatePrevented: true };
        if (!row.scope || !row.privateOwnership || row.ownershipDigest !== digest([row.scope, row.privateOwnership])) throw Error("Original native ownership is incomplete. Preserve it for review.");
        lease.assert(); const result = await retire(row.scope, row.privateOwnership); if (result?.stopped !== true) throw Error("The original listener retirement remains unconfirmed.");
        await update(c, requestId, "coding-owner-recovered-retirement", currentRow => { if (digest(currentRow) !== digest(row)) throw Error("Owner recovery changed before retirement persistence."); currentRow.status = "stopped"; currentRow.stoppedVerified = true; currentRow.updatedAt = now(); });
        return { stopped: true };
      });
    },
    async stop(c, requestId) {
      if (!uuid(requestId)) throw Error("Choose an exact owner request UUID."); await store.authorize(c);
      const resource = live.get(key(c, requestId)); if (!resource) throw Error("This host does not own that live connection. Use exact saved retirement recovery instead.");
      const result = await stopRecord(c, requestId, resource); await Promise.allSettled([...(resource.loads ?? [])]); return result;
    },
    async stopCompartment(c) {
      generations.set(c, generation(c) + 1);
      const resources = [...live.entries()].filter(([, r]) => r.compartment === c);
      const results = await Promise.all(resources.map(async ([id, r]) => stopRecord(c, id.slice(c.length + 1), r).catch(() => ({ stopped: false }))));
      await Promise.allSettled([...pending.entries()].filter(([id]) => id.startsWith(c + ":")).map(([, p]) => p));
      return { stopped: results.every(r => r.stopped) && ![...live.values()].some(r => r.compartment === c) };
    },
    async close() { closed = true; const compartments = new Set([...live.values()].map(r => r.compartment)); for (const id of pending.keys()) compartments.add(id.split(":")[0]); return Promise.all([...compartments].map(c => this.stopCompartment(c))); }
  };
}
