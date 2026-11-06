/** Explicit Linux metadata-owner registry. Does not create/resume a thread or grant IDE authority. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createCodexUnixTasks } from "./codex-unix-tasks.mjs";
import { retireStoppedCodexListener } from "./codex-owned-listener.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function binding(task) {
  if (!task || task.provider !== "codex" || task.status !== "registered" || !uuid(task.id) || typeof task.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(task.sessionId) || !/^[a-f0-9]{64}$/.test(task.accountFingerprint ?? "") || !task.repositoryIdentity?.device || !task.repositoryIdentity?.inode) throw Error("Choose an exact registered Codex task with its original account and repository identity.");
  return { taskId: task.id, sessionId: task.sessionId, accountFingerprint: task.accountFingerprint, repositoryRoot: task.repositoryRoot, repositoryIdentity: structuredClone(task.repositoryIdentity) };
}
const view = row => ({ requestId: row.requestId, taskId: row.taskId, status: row.status, stoppedVerified: row.stoppedVerified, metadataObserved: row.status === "bound", nativeTaskLoaded: false, ideAttached: false, completionVerified: false });
export function createCodingTaskOwners({ store, root, runtimeRoot, resolveCli, resolveMcp, driverFactory = createCodexUnixTasks, retire = retireStoppedCodexListener, platform = process.platform, now = Date.now } = {}) {
  const live = new Map(), pending = new Map(), generations = new Map(); let closed = false;
  const key = (c, id) => `${c}:${id}`;
  const generation = c => generations.get(c) ?? 0;
  const current = (c, g) => { if (closed || generation(c) !== g) throw Error("This task owner admission has stopped."); };
  async function exact(c, original, g) {
    current(c, g); await store.authorize(c, { provider: "codex" }); current(c, g);
    const task = (await store.snapshot(c)).codingSessions?.find(t => t.id === original.taskId);
    if (digest(binding(task)) !== digest(original)) throw Error("The original task, native account or repository binding changed.");
    await verifyRepositoryIdentity(original); current(c, g);
  }
  async function update(c, id, action, fn, provider = false) {
    return store.update(c, action, s => { const row = s.codingTaskOwners?.find(r => r.requestId === id); if (!row) throw Error("The original task owner reservation is unavailable."); return fn(row, s); }, provider ? { provider: "codex" } : {});
  }
  async function ownedRecord(c, id, resource) {
    const row = (await store.snapshot(c)).codingTaskOwners?.find(r => r.requestId === id);
    if (!row || row.status !== "bound" || row.bindingDigest !== digest(resource.original) || row.ownershipDigest !== digest([resource.owner.scope, resource.owner.privateOwnership]) || !resource.owner.binding) throw Error("The original protected task owner changed.");
    return row;
  }
  async function stopRecord(c, id, resource) {
    if (resource.stopping) return resource.stopping;
    resource.stopping = (async () => {
      let result;
      try { const exits = await resource.driver.close(); result = Array.isArray(exits) && exits.every(e => e?.stopped === true) && (!resource.owner || (await resource.owner.stop()).stopped === true); }
      catch { result = false; }
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

  return {
    async list(c) { await store.authorize(c, { provider: "codex" }); return ((await store.snapshot(c)).codingTaskOwners ?? []).map(view); },
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
