import test from "node:test";
import assert from "node:assert/strict";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { assertTaskAuthorityReceiptState } from "./task-authority.mjs";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { validationPolicyDigest, validationReceiptGuard } from "./repository-validation-policy.mjs";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";

test("fresh permission-bound authority reads still reject revocation between the initial record and admission", async t => {
  const f = await authorityFixture(t), review = await f.service.review("personal", f.proposed), grant = await f.service.issue("personal", { ...f.proposed, token: review.confirmation.token });
  const snapshot = f.store.snapshot.bind(f.store); let providerReads = 0, revoke = false;
  f.store.snapshot = async (c, request) => {
    if (request?.provider) { providerReads++; if (revoke) { revoke = false; await f.service.revoke(c, grant.id); } }
    return snapshot(c, request);
  };
  assert.equal((await f.service.assertCurrent("personal", grant.id)).record.id, grant.id); assert.equal(providerReads, 1);
  const before = f.counters().calls; revoke = true;
  await assert.rejects(f.service.assertCurrent("personal", grant.id), /exact task authority/);
  assert.equal(f.counters().calls, before); assert.equal(providerReads, 2);
  assert.ok((await snapshot("personal")).taskAuthorities.find(r => r.id === grant.id).grant.revokedAt);
});

test("fresh authority admission refuses provider replacement before using an earlier binding", async t => {
  const f = await authorityFixture(t), review = await f.service.review("personal", f.proposed), grant = await f.service.issue("personal", { ...f.proposed, token: review.confirmation.token });
  const snapshot = f.store.snapshot.bind(f.store); let replace = true;
  f.store.snapshot = async (c, request) => {
    if (request?.provider && replace) { replace = false; await f.store.update(c, "synthetic-provider-change", s => { Object.assign(s.codingSessions.find(task => task.id === f.task.id), { provider: "claude-code", nativeTransport: "owned-print", nativeIdentityVerified: true }); }); }
    return snapshot(c, request);
  };
  const before = f.counters().calls;
  await assert.rejects(f.service.assertCurrent("personal", grant.id), /provider binding changed/);
  assert.equal(f.counters().calls, before);
});

test("receipt commit checks exact protected account, mode, task, grant, target and expiry without nested state access", async t => {
  const f = await authorityFixture(t, { executionActions: ["pipeline_local_gate"] }), proposal = { ...f.proposed, actions: ["pipeline_local_gate"] }, approval = await f.service.review("personal", proposal), grant = await f.service.issue("personal", { ...proposal, token: approval.confirmation.token }), resolved = await f.service.resolve("personal", grant.id, "pipeline_local_gate");
  const review = { authorityId: grant.id, taskDigest: resolved.binding, workspaceDigest: resolved.workspace, taskId: resolved.task.id, sessionId: resolved.task.sessionId, repositoryRoot: resolved.task.repositoryRoot, targetSnapshotId: resolved.snapshot.id, action: "pipeline_local_gate" }, receipt = { authorityId: grant.id, targetSnapshotId: review.targetSnapshotId, action: review.action }, state = await f.store.snapshot("personal");
  await assertTaskAuthorityReceiptState(state, review, receipt, f.now);
  const mutations = [state => state.accounts.push("changed-account"), state => { state.mode = "keyboard-only"; }, state => { state.modeSelectedAt = 123; }, state => { state.policy = "work"; }, state => { state.taskAuthorityEpoch = 1; }, state => { state.codingSessions[0].accountFingerprint = "e".repeat(64); }, state => { state.codingSessions[0].sessionId = "different-session"; }, state => { state.codingSessions[0].status = "stopped"; }, state => { state.codingTurns = [{ taskId: review.taskId, status: "submitted" }]; }, state => { state.taskAuthorities[0].grant.revokedAt = new Date(f.now()).toISOString(); }];
  for (const mutate of mutations) { const changed = structuredClone(state); mutate(changed); await assert.rejects(assertTaskAuthorityReceiptState(changed, review, receipt, f.now)); }
  for (const changed of [{ ...receipt, authorityId: "unrelated" }, { ...receipt, action: "release_shield" }, { ...receipt, targetSnapshotId: "different-target" }]) await assert.rejects(assertTaskAuthorityReceiptState(state, review, changed, f.now));
  const expected = validationPolicyDigest(state), protectedReceipts = new ReceiptLedger(repositoryEffectJournal(f.store, "personal", { domain: "execution", now: f.now, receiptGuard: validationReceiptGuard(expected, review, f.now) }), { clock: () => new Date(f.now()).toISOString() });
  await f.store.update("personal", "synthetic-account-change", state => { state.accounts.push("later-account"); });
  await assert.rejects(protectedReceipts.issue({ ...receipt, operationId: "synthetic-observation", result: "passed", completeness: "complete", evidenceDigest: "synthetic", policyVersion: "synthetic", toolVersions: {} }), /authority changed/);
  assert.equal((await protectedReceipts.list()).length, 0);
  f.advance(15 * 60000); await assert.rejects(assertTaskAuthorityReceiptState(state, review, receipt, f.now), /expired/);
  await f.service.revoke("personal", grant.id); await assert.rejects(assertTaskAuthorityReceiptState(await f.store.snapshot("personal"), review, receipt, f.now));
});
