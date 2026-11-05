/** Host-admitted exchange ownership over the fixed protected System broker. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { scopeHash } from "./confirmations.mjs";
import { createWindowsStorageNative } from "./windows-storage-native.mjs";
import { validateWindowsExchangeBinding } from "./windows-sandbox-native.mjs";

const schema = "switchyard-windows-broker-exchange-owner/v1";
const hostLease = "primary-personal-host", field = "repositoryWindowsBrokerExchanges";
const uuid = v => typeof v === "string" && v !== "00000000-0000-0000-0000-000000000000" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const digest = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === keys.slice().sort().join();
const states = { create: "created", attach: "mounted", detach: "detached", retire: "retired" };

export function createWindowsBrokerExchanges({ store, platform = process.platform, helper, native = createWindowsStorageNative({ store, platform, ...(helper ? { helperPath: helper } : {}) }), consumerStopped = async () => false, isActive = async () => true, now = Date.now } = {}) {
  const resources = new Map(), seen = new Set(); let closed = false, held;
  const key = (c, id) => `${c}:${id}`;
  const get = async (c, id) => (await store.snapshot(c))[field]?.find(r => r.operationId === id);
  const update = (c, id, action, fn) => store.update(c, action, s => {
    const row = s[field]?.find(r => r.operationId === id);
    if (!row || row.schema !== schema) throw Error("The original protected broker ownership changed.");
    return fn(row);
  });
  async function acquire(c, id) {
    if (held) { if (held.key !== key(c, id)) throw Error("Reconcile the original broker exchange before another operation."); if (!held.lease) throw Error("Wait for the original host lease acquisition."); held.lease.assert(); return held; }
    let ready, failed, release;
    const acquired = new Promise((resolve, reject) => { ready = resolve; failed = reject; });
    const wait = new Promise(resolve => { release = resolve; });
    const pending = { key: key(c, id), release, done: null, lease: null };
    // Publish the pending owner before yielding, including acquisition failures.
    held = pending;
    pending.done = store.withResourceLock("windows-storage", hostLease, async lease => { pending.lease = lease; ready(pending); await wait; lease.assert(); });
    pending.done.catch(error => { failed(error); if (held === pending) held = undefined; });
    return acquired;
  }
  async function release(c, id) {
    if (held?.key !== key(c, id)) return;
    const original = held; original.release();
    try { await original.done; } finally { if (held === original) held = undefined; }
  }
  async function access(c, provider, check) {
    if (closed || platform !== "win32") throw Error("The protected Windows exchange is unavailable on this host.");
    const s = await store.snapshot(c);
    if (s.policy !== "personal" || s.mode !== "personal-companion" || !await isActive(c)) throw Error("Choose the active Personal companion workspace for Windows Run.");
    await store.authorize(c, { provider }); await check();
  }
  function valid(row) {
    if (row?.schema !== schema || !uuid(row.operationId) || !digest(row.scopeDigest) || !digest(row.inputManifestSha256) || !["codex", "claude-code"].includes(row.provider)
      || !exact(row.installation, ["installationId", "ownerScope", "serviceImageSha256"]) || !uuid(row.installation.installationId) || ![row.installation.ownerScope, row.installation.serviceImageSha256].every(digest)
      || row.ownerScope !== row.installation.ownerScope || typeof row.clientSid !== "string" || !row.commands || Object.keys(row.commands).some(v => !Object.hasOwn(states, v))) throw Error("Preserve an unfamiliar original broker exchange record.");
    for (const command of Object.values(row.commands)) if (!uuid(command.requestId) || !["reserved", "recorded", "not-started"].includes(command.status)) throw Error("Preserve an unfamiliar original effect request.");
    return row;
  }
  async function client(row, check) {
    if (!(await native.reconcile()).stopped) throw Error("The original storage guardian exit is unconfirmed; no replacement was started.");
    const binding = await native.identity({ check });
    if (row && (binding.clientSid !== row.clientSid || binding.ownerScope !== row.ownerScope)) throw Error("The original broker client identity changed.");
    return binding;
  }
  function request(row, verb, requestId) {
    valid(row); return { installation: row.installation, verb, requestId, operationId: row.operationId, taskScopeSha256: row.scopeDigest, inputManifestSha256: row.inputManifestSha256 };
  }
  function proof(result, verb, originalEffect = true) {
    const p = result?.proof, mounted = p?.state === "mounted", detached = ["created", "detached", "retired"].includes(p?.state);
    if (result?.nativeExitVerified !== true || !exact(p, ["state", "effectStarted", "attached", "mounted", "detachedVerified", "exchangeQuotaEnforced", "virtualBytes", "backingBytes", "sandboxEnforced"])
      || ![...Object.values(states), "outcome-unconfirmed"].includes(p.state) || p.virtualBytes !== 67108864 || p.backingBytes !== 67109376 || p.sandboxEnforced !== false
      || p.effectStarted !== originalEffect || p.attached !== mounted || p.mounted !== mounted || p.exchangeQuotaEnforced !== mounted || p.detachedVerified !== detached
      || verb !== "inspect" && p.state !== states[verb]) throw Error("The original bounded broker result did not verify; preserve its operation.");
    return structuredClone(p);
  }
  async function lookup(c, row, verb, binding, check) {
    const command = row.commands[verb]; if (!command || command.status !== "reserved") return command;
    const observed = await native.lookupExchange(binding, request(row, verb, command.requestId), { check });
    if (observed.nativeExitVerified !== true || !["absent", "reserved", "recorded"].includes(observed.status)) throw Error("The original broker lookup did not verify.");
    if (observed.status === "reserved") return command;
    const p = observed.status === "recorded" ? proof(observed, verb) : null;
    if (observed.status === "absent" && observed.proof !== null) throw Error("An absent original effect cannot claim proof.");
    await update(c, row.operationId, "windows-broker-result-recovered", saved => {
      const original = saved.commands[verb];
      if (original.requestId !== command.requestId || original.status !== "reserved") throw Error("The original effect reservation changed.");
      Object.assign(original, { status: p ? "recorded" : "not-started", proof: p, nativeRecordId: observed.nativeRecordId, recoveredWithoutReplay: true });
    });
    return (await get(c, row.operationId)).commands[verb];
  }
  async function effect(c, id, verb, binding, check) {
    await check(); let row = valid(await get(c, id));
    if (row.commands[verb]) {
      const original = await lookup(c, row, verb, binding, check);
      if (original.status !== "recorded") throw Error("The original effect is unconfirmed or did not start; it cannot be resent.");
      return structuredClone(original.proof);
    }
    const requestId = randomUUID();
    await update(c, id, "windows-broker-effect-reserve", saved => { if (saved.commands[verb]) throw Error("The original broker effect is already reserved; no replay."); saved.commands[verb] = { requestId, status: "reserved", at: now() }; });
    await check(); row = valid(await get(c, id));
    const observed = await native.exchange(binding, request(row, verb, requestId), { check }), p = proof(observed, verb);
    // Retain independently observed facts even if authority changes after effect.
    await update(c, id, "windows-broker-effect-recorded", saved => {
      if (saved.commands[verb].requestId !== requestId || saved.commands[verb].status !== "reserved") throw Error("The original broker effect reservation changed.");
      Object.assign(saved.commands[verb], { status: "recorded", proof: p, nativeRecordId: observed.nativeRecordId });
    });
    await check(); return p;
  }
  async function observe(row, binding, check) {
    const observed = await native.exchange(binding, request(row, "inspect", randomUUID()), { check });
    return proof(observed, "inspect", false);
  }
  async function mapping(c, id, check) {
    held?.lease?.assert(); await check(); const row = valid(await get(c, id));
    if (!row.cleanupPending || row.retirementStarted || row.commands.attach?.status !== "recorded") throw Error("This exchange has no current original mounted lease.");
    const binding = await client(row, check), result = await native.exchangeBinding(binding, { installation: row.installation, operationId: id, taskScopeSha256: row.scopeDigest, inputManifestSha256: row.inputManifestSha256 }, { check });
    if (result.nativeExitVerified !== true) throw Error("The mapping observer exit is unconfirmed.");
    const mapped = validateWindowsExchangeBinding(result.binding, id);
    if (!mapped.broker || Object.entries({ ...row.installation, taskScopeSha256: row.scopeDigest, inputManifestSha256: row.inputManifestSha256 }).some(([k, v]) => mapped.broker[k] !== v)) throw Error("The exact protected broker mapping scope changed.");
    await check(); held.lease.assert(); return mapped;
  }
  async function cleanupOwned(c, id) {
    const initial = await get(c, id); if (!initial?.cleanupPending) { await release(c, id); return { cleaned: true }; }
    if (resources.get(key(c, id))?.busy) return { cleaned: false };
    await acquire(c, id);
    try {
      const current = async () => { held.lease.assert(); if (!await consumerStopped(c, id)) throw Error("The original guest consumer exit is unconfirmed; preserve its exchange."); };
      await current(); let row = valid(await get(c, id)); const binding = await client(row, current);
      for (const verb of Object.keys(states)) if (row.commands[verb]?.status === "reserved") { await lookup(c, row, verb, binding, current); row = valid(await get(c, id)); }
      if (Object.values(row.commands).some(cmd => cmd.status === "reserved")) return { cleaned: false };
      if (row.commands.create?.status === "not-started" || !row.commands.create) {
        if (Object.keys(row.commands).some(v => v !== "create")) throw Error("Preserve an inconsistent original exchange history.");
      } else {
        await update(c, id, "windows-broker-retirement-started", saved => { saved.retirementStarted = true; });
        if (row.commands.retire?.status !== "recorded") {
          const observed = await observe(row, binding, current);
          if (observed.state === "mounted") await effect(c, id, "detach", binding, current);
          else if (!["created", "detached"].includes(observed.state)) throw Error("The original exchange state remains unconfirmed; preserve it.");
          await effect(c, id, "retire", binding, current);
        }
      }
      await current(); await update(c, id, "windows-broker-storage-retired", saved => { saved.cleanupPending = false; saved.retiredAt = now(); });
      await release(c, id); resources.delete(key(c, id)); return { cleaned: true };
    } catch (error) { await update(c, id, "windows-broker-cleanup-unconfirmed", saved => { saved.cleanupPending = true; }).catch(() => {}); throw error; }
  }
  function cleanup(c, id) {
    return store.tryWithResourceLock("repository-execution", scopeHash([schema, "consumer", c, id]), () => cleanupOwned(c, id)).then(result => result.acquired ? result.value : { cleaned: false });
  }
  async function volume(c, id, check) {
    const resource = resources.get(key(c, id)); if (!resource || resource.busy) throw Error("The original broker preparation is unavailable or busy.");
    resource.busy = true;
    try {
      await check(); const row = valid(await get(c, id));
      if (row.commands.attach || row.status !== "created") throw Error("The original image transfer is already reserved; no volume replay.");
      const binding = await client(row, check);
      await effect(c, id, "attach", binding, check); const mapped = await mapping(c, id, check);
      await update(c, id, "windows-broker-mounted", saved => { saved.status = "mounted"; saved.mapping = mapped; });
      return { schema: "switchyard-windows-bounded-volume/v1", operationId: id, scopeDigest: row.scopeDigest, root: join(mapped.stagingRoot, "mount"), maximumBytes: 67108864,
        privateAclReadbackVerified: true, exchangeQuotaEnforced: true, sandboxEnforced: false, nativeBinding: structuredClone(mapped),
        assertCurrent: async () => { const next = await mapping(c, id, check); if (scopeHash(next) !== scopeHash(mapped)) throw Error("The original native mapping identity changed."); },
        withConsumer: fn => store.withResourceLock("repository-execution", scopeHash([schema, "consumer", c, id]), async lease => {
          lease.assert(); const next = await mapping(c, id, check); if (scopeHash(next) !== scopeHash(mapped)) throw Error("The original consumer mapping changed.");
          const result = await fn(); lease.assert(); await check(); return result;
        }), release: async () => { if (!(await cleanup(c, id)).cleaned) throw Error("The original exchange retirement remains pending."); } };
    } catch (error) {
      await update(c, id, "windows-broker-transfer-unconfirmed", saved => { saved.status = "outcome-unconfirmed"; }).catch(() => {});
      throw error;
    } finally { resource.busy = false; }
  }
  return {
    async probe(c, context, authorize) {
      await access(c, context.provider, authorize);
      return store.withResourceLock("windows-storage", hostLease, async lease => {
        const check = async () => { lease.assert(); await access(c, context.provider, authorize); }, binding = await client(null, check), observed = await native.probeExchange(binding, { check });
        if (observed.effectStarted !== false || observed.nativeExitVerified !== true) throw Error("The read-only broker capability did not verify.");
        return { status: observed.status, effectStarted: false };
      });
    },
    async prepare(c, context, authorize, inputs) {
      context = structuredClone(context); inputs = structuredClone(inputs);
      if (!exact(context, ["operationId", "provider", "scopeDigest"]) || !uuid(context.operationId) || !digest(context.scopeDigest) || !["codex", "claude-code"].includes(context.provider) || !exact(inputs, ["inputManifestSha256"]) || !digest(inputs.inputManifestSha256) || typeof authorize !== "function") throw Error("Bind the original broker exchange to one exact task and reviewed input manifest.");
      await access(c, context.provider, authorize); seen.add(c);
      const id = context.operationId; await acquire(c, id);
      if (await get(c, id)) { if (!(await get(c, id)).cleanupPending) await release(c, id); throw Error("The original broker exchange is retained; no operation replay."); }
      const resource = { busy: true, controller: new AbortController() }; resources.set(key(c, id), resource);
      const check = async () => { held.lease.assert(); if (resource.controller.signal.aborted) throw Error("The original broker exchange was stopped."); await access(c, context.provider, authorize); held.lease.assert(); };
      let reserved = false;
      try {
        const binding = await client(null, check), capability = await native.probeExchange(binding, { check });
        if (capability.status !== "available" || capability.effectStarted !== false || capability.nativeExitVerified !== true) throw Error("The protected exchange service is unavailable; no image was requested.");
        await check();
        await store.update(c, "windows-broker-owner-reserve", s => {
          const rows = s[field] ?? []; if (rows.some(r => r.operationId === id || r.cleanupPending)) throw Error("Reconcile the retained original exchange before another operation.");
          if (rows.filter(r => r.cleanupPending).length >= 32) throw Error("The retained broker inventory is full.");
          s[field] = [...rows.slice(-31), { schema, ...context, inputManifestSha256: inputs.inputManifestSha256, clientSid: binding.clientSid, ownerScope: binding.ownerScope, installation: capability.installation, commands: {}, status: "preparing", cleanupPending: true, at: now() }];
        }); reserved = true;
        await effect(c, id, "create", binding, check); await update(c, id, "windows-broker-created", row => { row.status = "created"; }); await check();
        return { operationId: id, attached: false, exchangeQuotaEnforced: false, sandboxEnforced: false, createVolume: () => volume(c, id, check), release: () => cleanup(c, id) };
      } catch (error) {
        const row = await get(c, id); if (reserved || row) await update(c, id, "windows-broker-outcome-unconfirmed", saved => { saved.status = "outcome-unconfirmed"; }).catch(() => {});
        else { resources.delete(key(c, id)); await release(c, id); }
        throw error;
      } finally { resource.busy = false; }
    },
    cleanup,
    async recover(c) { seen.add(c); let cleaned = true; for (const row of (await store.snapshot(c))[field] ?? []) if (!(await cleanup(c, row.operationId)).cleaned) cleaned = false; return { cleaned, cleanupPending: !cleaned }; },
    async stopCompartment(c) {
      for (const [id, resource] of resources) if (id.startsWith(c + ":")) resource.controller.abort();
      const stopped = await native.stop(); const recovered = await this.recover(c); return { stopped: stopped.stopped && recovered.cleaned, ...recovered };
    },
    async list(c) { return ((await store.snapshot(c))[field] ?? []).map(row => ({ operationId: row.operationId, scopeDigest: row.scopeDigest, status: row.status, cleanupPending: row.cleanupPending, exchangeQuotaEnforced: false, sandboxEnforced: false })); },
    async close() { for (const c of seen) { const result = await this.stopCompartment(c); if (!result.stopped) throw Error("The original broker exchange still needs verified retirement."); } await native.close(); closed = true; }
  };
}
