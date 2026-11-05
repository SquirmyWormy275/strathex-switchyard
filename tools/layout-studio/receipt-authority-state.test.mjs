import test from "node:test";
import assert from "node:assert/strict";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { assertTaskAuthorityReceiptState } from "./task-authority.mjs";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { validationPolicyDigest, validationReceiptGuard } from "./repository-validation-policy.mjs";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";

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
