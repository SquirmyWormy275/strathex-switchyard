import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { createWindowsBrokerExchanges } from "./windows-broker-exchanges.mjs";
const field = "repositoryWindowsBrokerExchanges", sha = x => createHash("sha256").update(x).digest("hex");

// Explicit protected-service/VHD doubles. AEAD persistence and cross-process
// kernel leases are real; no volume, account, privilege or VM is created.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-broker-owner-")), keys = new Map(), services = [], effects = [], reads = [], records = new Map(), volumes = new Map();
  const store = createSuiteStore({ root, secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => { keys.set(c+p,v); } } });
  await store.initialize("personal"); await store.update("personal", "fixture", s => { s.mode = "personal-companion"; });
  const clientSid = "S-1-5-21-1-2-3-1001", ownerScope = sha(clientSid), installation = { installationId: randomUUID(), ownerScope, serviceImageSha256: "b".repeat(64) };
  let exited = true, consumer = true, active = true, available = true, lost = null, reserve = null, wrongMapping = false, onIdentity = async () => {};
  const p = (state, effectStarted) => ({ state, effectStarted, attached: state === "mounted", mounted: state === "mounted", detachedVerified: ["created","detached","retired"].includes(state), exchangeQuotaEnforced: state === "mounted", virtualBytes: 67108864, backingBytes: 67109376, sandboxEnforced: false });
  const native = {
    reconcile: async () => ({ stopped: exited }),
    identity: async ({ check }) => { await check(); reads.push("identity"); await onIdentity(); return { clientSid, ownerScope, helperSha256: "c".repeat(64), setupSha256: "d".repeat(64) }; },
    probeExchange: async (_binding, { check }) => { await check(); reads.push("probe"); return { status: available ? "available" : "unavailable", installation, effectStarted: false, nativeExitVerified: true }; },
    exchange: async (_binding, request, { check }) => {
      await check(); assert.deepEqual(request.installation, installation); const row = (await store.snapshot("personal"))[field].find(r => r.operationId === request.operationId);
      assert.equal(request.taskScopeSha256, row.scopeDigest); assert.equal(request.inputManifestSha256, row.inputManifestSha256);
      if (request.verb === "inspect") { reads.push("inspect"); return { proof: p(volumes.get(request.operationId), false), nativeExitVerified: true }; }
      const saved = row.commands[request.verb]; assert.equal(saved.requestId, request.requestId); assert.equal(saved.status, "reserved");
      assert.equal(records.has(request.requestId), false, "No native effect request may be replayed"); effects.push(request.verb);
      if (reserve === request.verb) { records.set(request.requestId, { status: "reserved", proof: null, nativeExitVerified: true }); throw Error("Synthetic native reserved result loss"); }
      const next = { create: "created", attach: "mounted", detach: "detached", retire: "retired" }[request.verb]; volumes.set(request.operationId, next);
      const result = { status: "recorded", proof: p(next, true), nativeExitVerified: true, nativeRecordId: randomUUID() }; records.set(request.requestId, result);
      if (lost === request.verb) throw Error("Synthetic lost native response"); return { ...result, status: "observed" };
    },
    lookupExchange: async (_binding, request, { check }) => { await check(); reads.push("lookup-" + request.verb); return structuredClone(records.get(request.requestId) ?? { status: "absent", proof: null, nativeExitVerified: true }); },
    exchangeBinding: async (_binding, request, { check }) => {
      await check(); assert.equal(volumes.get(request.operationId), "mounted"); reads.push("mapping");
      return { nativeExitVerified: true, binding: { schema: "switchyard-windows-bounded-volume/v1", operationId: request.operationId, stagingRoot: "C:\\Program Files\\Switchyard\\exchanges\\disk-" + request.operationId,
        stagingIdentity: { device: "1", inode: "2" }, imageIdentity: { device: "1", inode: "3" }, mountIdentity: { device: "1", inode: "4" }, footerSha256: "f".repeat(64), volumeGuid: "\\\\?\\Volume{" + installation.installationId + "}\\",
        broker: { ...installation, taskScopeSha256: wrongMapping ? "f".repeat(64) : request.taskScopeSha256, inputManifestSha256: request.inputManifestSha256 } } };
    },
    stop: async () => ({ stopped: exited }), close: async () => {}
  };
  const create = () => { const service = createWindowsBrokerExchanges({ store, platform: "win32", native, consumerStopped: async () => consumer, isActive: async () => active }); services.push(service); return service; };
  const service = create(), context = { operationId: randomUUID(), provider: "codex", scopeDigest: "a".repeat(64) }, input = { inputManifestSha256: "e".repeat(64) }, authorize = async () => {};
  t.after(async () => {
    active = consumer = exited = true; lost = reserve = null; wrongMapping = false;
    // No real native assets exist. Remove only test-fake retained uncertainty so
    // every actual kernel lease can close even when the test expects quarantine.
    await store.update("personal", "fixture-destroy-fake-assets", s => { for (const r of s[field] ?? []) r.cleanupPending = false; });
    for (const s of services) { for (const r of (await store.snapshot("personal"))[field] ?? []) await s.cleanup("personal", r.operationId); await s.close(); }
    await rm(root, { recursive: true, force: true });
  });
  return { onIdentity: fn => { onIdentity = fn; }, store, service, create, context, input, effects, reads, records, volumes, authorize, prepare: () => service.prepare("personal", context, authorize, input), lost: v => { lost = v; }, reserved: v => { reserve = v; }, exited: v => { exited = v; }, consumer: v => { consumer = v; }, active: v => { active = v; }, available: v => { available = v; }, wrongMapping: v => { wrongMapping = v; } };
}

test("one exact broker exchange is durably reserved, transferred once and retired only after original guest exit", async t => {
  const f = await fixture(t), image = await f.prepare(); assert.equal(image.sandboxEnforced, false); const volume = await image.createVolume();
  assert.equal(volume.nativeBinding.broker.inputManifestSha256, f.input.inputManifestSha256); await volume.assertCurrent();
  await assert.rejects(image.createVolume(), /replay/); await assert.rejects(f.prepare(), /retained/);
  f.consumer(false); await assert.rejects(volume.release(), /guest consumer exit/); assert.deepEqual(f.effects, ["create", "attach"]);
  f.consumer(true); await volume.release(); assert.deepEqual(f.effects, ["create", "attach", "detach", "retire"]);
  assert.equal((await f.service.list("personal"))[0].cleanupPending, false); await assert.rejects(f.prepare(), /replay/); assert.equal(f.effects.length, 4);
});
test("lost create and attach responses recover exact recorded facts through lookup without resending their effects", async t => {
  for (const verb of ["create", "attach"]) {
    const f = await fixture(t); let image; if (verb === "attach") image = await f.prepare(); f.lost(verb);
    await assert.rejects(verb === "create" ? f.prepare() : image.createVolume(), /lost native response/); f.lost(null);
    assert.equal((await f.service.recover("personal")).cleaned, true); assert.equal(f.effects.filter(v => v === verb).length, 1); assert.ok(f.reads.includes("lookup-" + verb));
    assert.equal((await f.service.list("personal"))[0].status, "outcome-unconfirmed");
  }
});
test("a protected reservation without a final result quarantines its original asset and never retries or retires it", async t => {
  const f = await fixture(t); f.reserved("create"); await assert.rejects(f.prepare(), /reserved result loss/);
  assert.equal((await f.service.recover("personal")).cleaned, false); assert.deepEqual(f.effects, ["create"]);
  await assert.rejects(f.prepare(), /retained/); assert.equal((await f.service.list("personal"))[0].cleanupPending, true);
});
test("a failed local reservation starts no native effect and an ambiguous committed reservation is reconciled read-only", async t => {
  for (const afterCommit of [false, true]) {
    const f = await fixture(t), original = f.store.update; let fail = true;
    f.store.update = async (...args) => { if (fail && args[1] === "windows-broker-effect-reserve") { fail = false; if (afterCommit) await original(...args); throw Error("Synthetic reservation persistence failure"); } return original(...args); };
    await assert.rejects(f.prepare(), /reservation persistence/); assert.deepEqual(f.effects, []); assert.equal((await f.service.recover("personal")).cleaned, true);
    assert.equal(f.reads.includes("lookup-create"), afterCommit); assert.deepEqual(f.effects, []);
  }
});
test("lost final local fact persistence uses the recorded native result and preserves the original uncertain Run outcome", async t => {
  const f = await fixture(t), original = f.store.update; let fail = true;
  f.store.update = async (...args) => { if (fail && args[1] === "windows-broker-effect-recorded") { fail = false; throw Error("Synthetic lost local fact write"); } return original(...args); };
  await assert.rejects(f.prepare(), /lost local fact/); assert.equal((await f.service.recover("personal")).cleaned, true); assert.deepEqual(f.effects, ["create", "retire"]);
  assert.equal((await f.service.list("personal"))[0].status, "outcome-unconfirmed");
});
test("unknown original native exit blocks all replacement commands and cleanup until independently reconciled", async t => {
  const f = await fixture(t), image = await f.prepare(); f.exited(false);
  await assert.rejects(image.createVolume(), /guardian exit/); await assert.rejects(f.service.cleanup("personal", f.context.operationId), /guardian exit/); assert.deepEqual(f.effects, ["create"]);
  f.exited(true); assert.equal((await f.service.recover("personal")).cleaned, true); assert.deepEqual(f.effects, ["create", "retire"]);
});
test("a live consumer kernel lease prevents retirement even before a guest session exists", async t => {
  const f = await fixture(t), volume = await (await f.prepare()).createVolume(); let entered, release;
  const ready = new Promise(r => { entered = r; }), hold = new Promise(r => { release = r; });
  const use = volume.withConsumer(async () => { entered(); await hold; }); await ready;
  assert.equal((await f.service.cleanup("personal", f.context.operationId)).cleaned, false); assert.deepEqual(f.effects, ["create", "attach"]);
  release(); await use; await volume.release();
});
test("the host storage lease excludes setup across independent owner instances for the complete mounted lifetime", async t => {
  const f = await fixture(t), volume = await (await f.prepare()).createVolume();
  const attempt = f.store.withResourceLock("windows-storage", "primary-personal-host", async lease => { lease.assert(); return true; });
  let entered = false; attempt.then(() => { entered = true; }); await new Promise(r => setTimeout(r, 50)); assert.equal(entered, false);
  await volume.release(); assert.equal(await attempt, true);
});
test("scope revocation prevents a late volume capability while cleanup remains permitted in keyboard-only mode", async t => {
  const f = await fixture(t), image = await f.prepare(); f.active(false); await assert.rejects(image.createVolume(), /active Personal/);
  await f.store.update("personal", "fixture-disable", s => { s.mode = "keyboard-only"; });
  assert.equal((await f.service.cleanup("personal", f.context.operationId)).cleaned, true); assert.deepEqual(f.effects, ["create", "retire"]);
});
test("wrong mapping scope cannot admit a guest and remains eligible only for exact exit-checked retirement", async t => {
  const f = await fixture(t), image = await f.prepare(); f.wrongMapping(true); await assert.rejects(image.createVolume(), /mapping scope/);
  f.wrongMapping(false); await f.service.cleanup("personal", f.context.operationId); assert.deepEqual(f.effects, ["create", "attach", "detach", "retire"]);
});
test("Work, unknown extra fields and unavailable service cannot reserve an exchange or request setup", async t => {
  const f = await fixture(t); await f.store.initialize("work", "work");
  await assert.rejects(f.service.prepare("work", f.context, f.authorize, f.input), /Personal/);
  await assert.rejects(f.service.prepare("personal", { ...f.context, root: "C:\\foreign" }, f.authorize, f.input), /exact task/);
  await assert.rejects(f.service.prepare("personal", f.context, f.authorize, { ...f.input, capacity: 1 }), /exact task/);
  f.available(false); await assert.rejects(f.prepare(), /unavailable/); assert.deepEqual(f.effects, []); assert.equal((await f.service.list("personal")).length, 0);
});

test("lost detach or retirement acknowledgements recover the original effect and never turn cleanup into another effect attempt", async t => {
  for (const verb of ["detach", "retire"]) {
    const f = await fixture(t), volume = await (await f.prepare()).createVolume(); f.lost(verb);
    await assert.rejects(volume.release(), /lost native response/); f.lost(null);
    assert.equal((await f.service.recover("personal")).cleaned, true);
    assert.equal(f.effects.filter(v => v === verb).length, 1); assert.ok(f.reads.includes("lookup-" + verb));
    assert.deepEqual(f.effects, ["create", "attach", "detach", "retire"]);
  }
});
test("capability probing is read-only and a stopped exact scope cannot reserve a later exchange", async t => {
  const f = await fixture(t); assert.deepEqual(await f.service.probe("personal", f.context, f.authorize), { status: "available", effectStarted: false });
  assert.deepEqual(f.effects, []); assert.equal((await f.service.list("personal")).length, 0);
  f.active(false); await assert.rejects(f.service.probe("personal", f.context, f.authorize), /active Personal/); assert.deepEqual(f.effects, []);
});

test("duplicate preparations are fenced before native identity while the first exact owner is still discovering its installation", async t => {
  const f = await fixture(t); let entered, release;
  const ready = new Promise(r => { entered = r; }), hold = new Promise(r => { release = r; });
  f.onIdentity(async () => { entered(); await hold; });
  const first = f.prepare(); await ready;
  await assert.rejects(f.prepare(), /retained or busy/); assert.deepEqual(f.reads, ["identity"]); assert.deepEqual(f.effects, []);
  release(); const image = await first; await image.release(); assert.deepEqual(f.effects, ["create", "retire"]);
});
test("a retired capability refuses stale access before touching native identity or another operation's host lease", async t => {
  const f = await fixture(t), volume = await (await f.prepare()).createVolume(); await volume.release();
  const reads = f.reads.length; await assert.rejects(volume.assertCurrent(), /lease expired/); assert.equal(f.reads.length, reads);
  assert.equal((await f.service.list("personal"))[0].cleanupPending, false);
});

test("a failed ownership read after kernel acquisition releases only the unused host lease without dispatching a native effect", async t => {
  const f = await fixture(t), original = f.store.snapshot; let snapshots = 0;
  f.store.snapshot = async (...args) => { if (++snapshots === 2) throw Error("Synthetic ownership read failure"); return original(...args); };
  await assert.rejects(f.prepare(), /ownership read failure/); f.store.snapshot = original;
  assert.deepEqual(f.effects, []); assert.deepEqual(f.reads, []);
  assert.equal(await f.store.withResourceLock("windows-storage", "primary-personal-host", async lease => { lease.assert(); return true; }), true);
});
