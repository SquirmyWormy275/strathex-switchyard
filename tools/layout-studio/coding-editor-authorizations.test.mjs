import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { createCodingEditorAuthorizations } from "./coding-editor-authorizations.mjs";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sy-editor-review-")), keys = new Map(), services = [];
  const store = createSuiteStore({ root, secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => keys.set(c+p,v) } });
  await store.initialize("personal"); await store.update("personal", "fixture", s => { s.mode = "personal-companion"; });
  const input = { ownerRequestId: randomUUID(), loadRequestId: randomUUID(), requestId: randomUUID(), editorId: randomUUID() };
  const target = { schema: "switchyard-codex-editor-target/v1", ownerRequestId: input.ownerRequestId, loadRequestId: input.loadRequestId, taskId: randomUUID(), sessionId: randomUUID(), accountFingerprint: "a".repeat(64), repositoryRoot: "/synthetic/repository", repositoryIdentity: { device: "1", inode: "2" }, permissions: "read-only/on-request", endpoint: { socketPath: "/tmp/synthetic-editor", socketDevice: "1", socketInode: "3", peerPid: 123, peerBirth: "4", peerExecutableSha256: "b".repeat(64) } };
  let active = true, at = 100000, reads = 0, hook = async () => {};
  const owners = { async editorTarget(c, selection) { reads++; await hook(); assert.equal(c, "personal"); if (selection.ownerRequestId !== input.ownerRequestId || selection.loadRequestId !== input.loadRequestId) throw Error("foreign owner/load"); return { target: structuredClone(target), targetDigest: digest(target), metadataObserved: true, nativeLoadAcknowledged: true, nativeTaskLoaded: false, authorityGranted: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false }; } };
  owners.editorReturnTarget = (c, selected) => owners.editorTarget(c, selected);
  function service() { const value = createCodingEditorAuthorizations({ store, owners, isActive: async () => active, now: () => at }); services.push(value); return value; }
  t.after(async () => { hook = async () => {}; for (const s of services) await s.close(); await rm(root, { recursive: true }); });
  const api = service();
  async function issue() { const review = await api.review("personal", input); return api.issue("personal", { ...input, token: review.confirmation.token }); }
  return { store, input, target, api, service, issue, set active(v) { active = v; }, set at(v) { at = v; }, set hook(v) { hook = v; }, get reads() { return reads; } };
}
test("reviewed launch authorizations expose a permit once and consume it once across service instances under real private leases", async t => {
  const f = await fixture(t), issued = await f.issue(); assert.equal(issued.terminalLaunchAuthorized, false); assert.equal(issued.expiresAt, 130000);
  const saved = (await f.store.snapshot("personal")).codingEditorAuthorizations[0]; assert.equal(saved.permitDigest, digest(issued.permit)); assert.equal(JSON.stringify(saved).includes(issued.permit), false);
  const duplicate = await f.api.issue("personal", { ...f.input, token: randomUUID() }); assert.equal(duplicate.duplicatePrevented, true); assert.equal(duplicate.permit, undefined);
  const results = await Promise.all([f.api, f.service()].map(service => service.consume("personal", { ...f.input, permit: issued.permit })));
  assert.equal(results.filter(r => r.terminalLaunchAuthorized).length, 1); assert.equal(results.filter(r => r.duplicatePrevented).length, 1);
  for (const result of results) for (const flag of ["terminalLaunched", "ideAttached", "modelPromptSubmitted", "completionVerified"]) assert.equal(result[flag], false);
  assert.deepEqual(results.find(r => r.terminalLaunchAuthorized).target, f.target);
  await assert.rejects(f.api.review("personal", f.input), /retained/);
});
test("review is scoped to the original editor, request, task, endpoint and policy", async t => {
  for (const change of [f => { f.target.accountFingerprint = "c".repeat(64); }, f => { f.target.endpoint.socketInode = "99"; }, f => { f.target.repositoryIdentity.inode = "99"; }, f => { f.input.editorId = randomUUID(); }, f => { f.input.requestId = randomUUID(); }, async f => { await f.store.update("personal", "fixture-policy", s => { s.accounts.push("changed-enrollment"); }); }]) {
    const f = await fixture(t), review = await f.api.review("personal", f.input); await change(f);
    await assert.rejects(f.api.issue("personal", { ...f.input, token: review.confirmation.token })); assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations?.length ?? 0, 0);
  }
});
test("expiry, clock reversal, foreign permits, inactive workspace and changed native target never authorize a launch", async t => {
  for (const change of [f => { f.at = 130000; }, f => { f.at = 99999; }, f => { f.active = false; }, f => { f.target.endpoint.peerBirth = "99"; }, f => { f.input.editorId = randomUUID(); }, async f => { await f.store.update("personal", "fixture-mode", s => { s.mode = "keyboard-only"; }); }]) {
    const f = await fixture(t), issued = await f.issue(); await change(f); await assert.rejects(f.api.consume("personal", { ...f.input, permit: issued.permit }));
    assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations[0].status, "issued");
  }
  const f = await fixture(t), issued = await f.issue(); await assert.rejects(f.api.consume("personal", { ...f.input, permit: randomUUID() }), /does not match/);
  assert.equal((await f.api.consume("personal", { ...f.input, permit: issued.permit })).terminalLaunchAuthorized, true);
});
test("post-consumption policy drift spends the permit without authorizing a later retry", async t => {
  const f = await fixture(t), issued = await f.issue(), original = f.target.accountFingerprint;
  f.hook = async () => { if ((await f.store.snapshot("personal")).codingEditorAuthorizations[0].status === "consumed") f.target.accountFingerprint = "c".repeat(64); };
  await assert.rejects(f.api.consume("personal", { ...f.input, permit: issued.permit }), /changed/);
  f.hook = async () => {}; f.target.accountFingerprint = original;
  const duplicate = await f.api.consume("personal", { ...f.input, permit: issued.permit }); assert.equal(duplicate.duplicatePrevented, true); assert.equal(duplicate.terminalLaunchAuthorized, false); assert.equal(duplicate.target, undefined);
});
test("mutable caller input is copied before any await and command, prompt or path overrides refuse", async t => {
  const f = await fixture(t); let unblock, entered; const enteredPromise = new Promise(r => { entered = r; }), gate = new Promise(r => { unblock = r; });
  f.hook = async () => { entered(); await gate; };
  const original = structuredClone(f.input), pending = f.api.review("personal", f.input); await enteredPromise; f.input.editorId = randomUUID(); unblock();
  const reviewed = await pending; assert.deepEqual(reviewed.selection, original);
  for (const method of ["review", "issue", "consume", "returnTarget"]) {
    const input = { ...original, ...(method === "issue" ? { token: randomUUID() } : method === "consume" ? { permit: randomUUID() } : {}) };
    for (const extra of [{ command: "never" }, { prompt: "never" }, { socketPath: "/foreign" }, { editorId: "not-an-id" }]) assert.throws(() => f.api[method]("personal", { ...input, ...extra }));
  }
});
test("closing joins pending metadata and prevents a late review or later use", async t => {
  const f = await fixture(t); let unblock, entered; const enteredPromise = new Promise(r => { entered = r; }), gate = new Promise(r => { unblock = r; });
  f.hook = async () => { entered(); await gate; };
  const work = f.api.review("personal", f.input); await enteredPromise;
  let joined = false; const closed = f.api.close().then(() => { joined = true; }); await new Promise(r => setImmediate(r)); assert.equal(joined, false);
  unblock(); await assert.rejects(work, /stopped|no longer active/); await closed; assert.equal(joined, true);
  await assert.rejects(f.api.review("personal", f.input)); assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0);
});
test("the bounded no-replay history refuses a sixty-fifth request without removing prior records", async t => {
  const f = await fixture(t), review = await f.api.review("personal", f.input);
  await f.store.update("personal", "fixture-history", s => { s.codingEditorAuthorizations = Array.from({ length: 64 }, () => ({ ...f.input, requestId: randomUUID(), status: "consumed" })); });
  await assert.rejects(f.api.issue("personal", { ...f.input, token: review.confirmation.token }), /history is full/);
  assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations.length, 64);
});

test("return metadata requires the consumed exact editor selection and survives creation expiry without changing state", async t => {
  const f = await fixture(t);
  await assert.rejects(f.api.returnTarget("personal", f.input), /original consumed/); assert.equal(f.reads, 0);
  const issued = await f.issue(), reads = f.reads;
  await assert.rejects(f.api.returnTarget("personal", f.input), /original consumed/); assert.equal(f.reads, reads);
  await f.api.consume("personal", { ...f.input, permit: issued.permit }); f.at = 999999;
  const before = await f.store.snapshot("personal");
  for (const api of [f.api, f.service()]) {
    const result = await api.returnTarget("personal", f.input); assert.deepEqual(result.target, f.target);
    for (const key of ["authorityGranted", "terminalLaunched", "nativeTaskLoaded", "ideAttached", "modelPromptSubmitted", "completionVerified"]) assert.equal(result[key], false);
    assert.equal(result.permit, undefined); assert.equal(result.terminalLaunchAuthorized, undefined);
  }
  assert.deepEqual(await f.store.snapshot("personal"), before);
});
test("return refuses changed original account, endpoint, policy, editor, retained scope and consumption time", async t => {
  for (const drift of ["account", "endpoint", "policy", "editor", "request", "scope", "time"]) {
    const f = await fixture(t), issued = await f.issue(); await f.api.consume("personal", { ...f.input, permit: issued.permit });
    if (drift === "account") f.target.accountFingerprint = "c".repeat(64);
    if (drift === "endpoint") f.target.endpoint.peerBirth = "99";
    if (drift === "policy") await f.store.update("personal", "fixture-policy", s => { s.accounts.push("changed"); });
    if (drift === "editor") f.input.editorId = randomUUID();
    if (drift === "request") f.input.requestId = randomUUID();
    if (drift === "scope" || drift === "time") await f.store.update("personal", "fixture-authorization", s => { if (drift === "scope") s.codingEditorAuthorizations[0].scopeDigest = "d".repeat(64); else s.codingEditorAuthorizations[0].consumedAt = 130000; });
    const before = await f.store.snapshot("personal"); await assert.rejects(f.api.returnTarget("personal", f.input)); assert.deepEqual(await f.store.snapshot("personal"), before);
  }
});
test("return fences a late consumed-record replacement and joins shutdown without refreshing the permit", async t => {
  for (const phase of ["replace", "close"]) {
    const f = await fixture(t), issued = await f.issue(); await f.api.consume("personal", { ...f.input, permit: issued.permit });
    if (phase === "replace") {
      f.hook = async () => { f.hook = async () => {}; await f.store.update("personal", "fixture-replace", s => { s.codingEditorAuthorizations[0].permitDigest = "f".repeat(64); }); };
      await assert.rejects(f.api.returnTarget("personal", f.input), /changed/);
    } else {
      let entered, release; const started = new Promise(r => { entered = r; }), gate = new Promise(r => { release = r; });
      f.hook = async () => { entered(); await gate; };
      const work = assert.rejects(f.api.returnTarget("personal", f.input)); await started;
      let joined = false; const closed = f.api.close().then(() => { joined = true; }); await new Promise(r => setImmediate(r)); assert.equal(joined, false);
      release(); await work; await closed; assert.equal(joined, true);
    }
    assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations[0].status, "consumed");
  }
});
