import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, open, lstat, readdir, rename, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { createWindowsExchangeImages } from "./windows-exchange-images.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const identity = value => ({ device: value.dev.toString(), inode: value.ino.toString() });
async function fileHash(path) { const hash = createHash("sha256"); for await (const bytes of createReadStream(path)) hash.update(bytes); return hash.digest("hex"); }

// Explicit native/VHD/DACL doubles. Sparse, owned synthetic files exercise the
// host's real bounded hashing and identity checks; no disk or VM is mounted.
async function fixture(t, hook = async () => {}) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-image-contract-")), helper = join(root, "Switchyard.Hotkeys.exe"), helperBytes = Buffer.from("synthetic image reader"), keys = new Map(), owners = new Map(), services = [];
  await writeFile(helper, helperBytes, { mode: 0o600 });
  const store = createSuiteStore({ root: join(root, "private"), secrets: { get: async (c, p) => keys.get(c + p), set: async (c, p, value) => { keys.set(c + p, value); } } });
  await store.initialize("personal"); await store.update("personal", "fixture", state => { state.mode = "personal-companion"; });
  let stopped = true, consumer = true, authorized = true, creates = 0, inspections = 0, invalidProof = false;
  const command = async (exe, args, options) => {
    assert.equal(exe, helper); assert.equal(options.expectedExecutableSha256, sha(helperBytes)); const inspect = args[0] === "--inspect-bounded-exchange-image";
    assert.deepEqual(args, [inspect ? "--inspect-bounded-exchange-image" : "--create-bounded-exchange-image"]);
    const input = JSON.parse(options.inputText), scope = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: process.platform === "win32" ? "windows-job" : "owned-linux-session" }; owners.set(scope.id, false);
    try {
      await options.onGuardianReady(scope); const row = (await store.snapshot("personal")).repositoryWindowsImages.find(row => row.operationId === input.operationId);
      assert.equal(row.ownedRuntime.id, scope.id); assert.equal(row.stoppedVerified, false);
      const path = join(input.stagingRoot, "exchange.vhd");
      if (!inspect) { creates++; const file = await open(path, "wx", 0o600); try { await file.truncate(67109376); await file.write(Buffer.from("synthetic image contract"), 0, 24, 0); } finally { await file.close(); } }
      else { inspections++; assert.deepEqual(input.imageIdentity, identity(await lstat(path, { bigint: true }))); assert.equal(input.expectedImageSha256, await fileHash(path)); }
      await hook(inspect ? "inspect" : "created", { input, options });
      const proof = { schema: input.schema, operationId: input.operationId, stagingIdentity: input.stagingIdentity, imageIdentity: identity(await lstat(path, { bigint: true })), imageFilename: "exchange.vhd", virtualBytes: 67108864, backingBytes: 67109376, filesystem: "FAT16", imageSha256: await fileHash(path), footerSha256: sha(Buffer.alloc(512)), nativeHeaderVerified: true, privateAclReadbackVerified: true, attached: invalidProof, exchangeQuotaEnforced: false, sandboxEnforced: false };
      return { status: "completed", exitCode: 0, inputDelivered: true, treeExitVerified: true, stdout: JSON.stringify(proof), stderr: "" };
    } finally { owners.set(scope.id, true); }
  };
  const create = () => { const service = createWindowsExchangeImages({ store, stateDirectory: join(root, "images"), helper, helperSha256: sha(helperBytes), platform: "win32", command, guardianStopped: async scope => stopped && owners.get(scope.id) === true, consumerStopped: async () => consumer }); services.push(service); return service; };
  const service = create(), context = { operationId: randomUUID(), scopeDigest: "a".repeat(64), provider: "codex" }, authorize = async () => { if (!authorized) throw Error("Synthetic image scope revoked"); };
  t.after(async () => { stopped = true; consumer = true; for (const scope of owners.keys()) owners.set(scope, true); for (const service of services) await service.close(); await rm(root, { recursive: true, force: true }); });
  return { root, store, service, create, context, authorize, prepare: () => service.prepare("personal", context, authorize), stopped: value => { stopped = value; }, consumer: value => { consumer = value; }, authorized: value => { authorized = value; }, invalid: value => { invalidProof = value; }, effects: () => ({ creates, inspections }) };
}

test("detached image ownership precedes native effects, verifies bounded original bytes and requires a fresh native detached observation before cleanup", async t => {
  const f = await fixture(t), lease = await f.prepare(); assert.equal(lease.attached, false); assert.equal(lease.exchangeQuotaEnforced, false); assert.equal(lease.sandboxEnforced, false); assert.equal(Object.hasOwn(lease, "protections"), false);
  assert.equal((await lstat(lease.path)).size, 67109376); await lease.assertCurrent(); assert.deepEqual(f.effects(), { creates: 1, inspections: 1 });
  await assert.rejects(f.prepare(), /Reconcile|replay/); f.consumer(false); await assert.rejects(lease.release(), /consumer exit/); await access(lease.path); f.consumer(true); await lease.release(); await assert.rejects(access(lease.path), { code: "ENOENT" }); assert.deepEqual(f.effects(), { creates: 1, inspections: 2 });
  await assert.rejects(f.prepare(), /replay/); assert.equal((await f.service.list("personal"))[0].cleanupPending, false);
});
test("unknown inspection exit blocks another image and a verified late stop reconciles only the original image", async t => {
  const f = await fixture(t), lease = await f.prepare(); f.stopped(false); await assert.rejects(lease.assertCurrent(), /exit|owned native command/); const other = f.create(); await assert.rejects(other.prepare("personal", { ...f.context, operationId: randomUUID() }, f.authorize), /Reconcile/); assert.equal(f.effects().creates, 1);
  f.stopped(true); const stopped = await f.service.stopCompartment("personal"); assert.equal(stopped.stopped, true); assert.equal(stopped.cleanupPending, false); await assert.rejects(access(lease.path), { code: "ENOENT" });
  const next = await f.service.prepare("personal", { ...f.context, operationId: randomUUID() }, f.authorize); assert.equal(f.effects().creates, 2); await next.release();
});
test("changed image bytes, foreign entries and replaced directories are preserved without another native command", async t => {
  const f = await fixture(t), lease = await f.prepare(), file = await open(lease.path, "r+"); await file.write(Buffer.from("changed"), 0, 7, 4096); await file.close(); await assert.rejects(lease.assertCurrent(), /bytes changed/); await assert.rejects(lease.release(), /bytes changed/); assert.deepEqual(f.effects(), { creates: 1, inspections: 0 });
  const foreign = await fixture(t), owned = await foreign.prepare(), directory = join(foreign.root, "images/personal", `disk-${foreign.context.operationId}`); await writeFile(join(directory, "foreign"), "preserve foreign"); await assert.rejects(owned.release(), /unfamiliar/); assert.equal(await readFile(join(directory, "foreign"), "utf8"), "preserve foreign");
  await rename(directory, directory + "-original"); await mkdir(directory); await writeFile(join(directory, "foreign"), "preserve replacement"); await assert.rejects(owned.assertCurrent(), /replaced/); await assert.rejects(owned.release(), /replaced/); assert.equal(await readFile(join(directory, "foreign"), "utf8"), "preserve replacement");
});
test("failed readiness starts no image while a lost native creation result preserves its unknown original file", async t => {
  const before = await fixture(t), original = before.store.update; let fail = true; before.store.update = async (...args) => { if (fail && args[1] === "windows-image-native-ready") { fail = false; throw Error("Synthetic failed image readiness"); } return original(...args); };
  await assert.rejects(before.prepare()); assert.equal(before.effects().creates, 0); assert.equal((await before.service.cleanup("personal", before.context.operationId)).cleaned, true);
  const unknown = await fixture(t, async stage => { if (stage === "created") throw Error("Synthetic lost image result"); }); await assert.rejects(unknown.prepare(), /lost image result/); const row = (await unknown.store.snapshot("personal")).repositoryWindowsImages[0]; assert.equal(row.stoppedVerified, true); assert.equal(row.proof, undefined); await assert.rejects(unknown.service.cleanup("personal", unknown.context.operationId), /unconfirmed/); await access(join(row.path, "exchange.vhd")); await assert.rejects(unknown.service.prepare("personal", { ...unknown.context, operationId: randomUUID() }, unknown.authorize), /Reconcile/); assert.equal(unknown.effects().creates, 1);
});
test("observed image facts survive scope revocation and lost final writes without upgrading the original result or replaying creation", async t => {
  let revoke; const f = await fixture(t, async stage => { if (stage === "created") revoke(); }); revoke = () => f.authorized(false); await assert.rejects(f.prepare(), /revoked/); const row = (await f.store.snapshot("personal")).repositoryWindowsImages[0]; assert.ok(row.proof); assert.equal(row.status, "outcome-unconfirmed"); assert.equal((await f.service.cleanup("personal", f.context.operationId)).cleaned, true); assert.equal((await f.service.list("personal"))[0].status, "outcome-unconfirmed");
  const lost = await fixture(t), original = lost.store.update; let fail = true; lost.store.update = async (...args) => { if (fail && args[1] === "windows-image-ready") { fail = false; throw Error("Synthetic lost final image write"); } return original(...args); }; await assert.rejects(lost.prepare(), /lost final/); assert.equal((await lost.create().recover("personal")).cleanupPending, false); await assert.rejects(lost.prepare(), /replay/); assert.equal(lost.effects().creates, 1);
});
test("request scope overrides and a changed native observation cannot turn an image into a writable-volume capability", async t => {
  const f = await fixture(t); await assert.rejects(f.service.prepare("personal", { ...f.context, capacity: 128 * 1024 * 1024 }, f.authorize)); assert.equal(f.effects().creates, 0); const lease = await f.prepare(); f.invalid(true); await assert.rejects(lease.assertCurrent(), /proof/); await access(lease.path); f.invalid(false); await lease.release(); assert.equal((await f.service.list("personal"))[0].exchangeQuotaEnforced, false);
});
test("a failed read-only readiness write retains independently observed command exits without replacing an unknown owner", async t => {
  const f = await fixture(t), lease = await f.prepare(), original = f.store.update; let fail = true;
  f.store.update = async (...args) => { if (fail && args[1] === "windows-image-native-ready") { fail = false; throw Error("Synthetic lost inspect readiness"); } return original(...args); };
  await assert.rejects(lease.assertCurrent(), /lost inspect readiness/); assert.equal(f.effects().inspections, 0); assert.equal((await f.service.list("personal"))[0].stoppedVerified, true); await lease.release();
});
test("stop rejects a late creation lease while preserving observed facts for cleanup and refusing replay", async t => {
  let entered, release; const ready = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async stage => { if (stage === "created") { entered(); await hold; } });
  const pending = f.prepare().catch(error => error); await ready; const stopped = f.service.stopCompartment("personal"); release(); assert.match((await pending).message, /stopped/); const result = await stopped; assert.equal(result.stopped, true); assert.equal(result.cleanupPending, false);
  const row = (await f.store.snapshot("personal")).repositoryWindowsImages[0]; assert.ok(row.proof); assert.equal(row.status, "outcome-unconfirmed"); assert.equal(row.cleanupPending, false); await assert.rejects(f.prepare(), /replay/); assert.equal(f.effects().creates, 1);
});
