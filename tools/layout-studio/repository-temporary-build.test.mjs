import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fixture, awaitNativeReady } from "./test-support/repository-pipeline-fixture.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
const linux = { skip: process.platform !== "linux" };

test("both reviewed pipeline actions build in a bounded copy and retain exact approvals, checkpoints and authenticated receipts", linux, async t => {
  for (const action of ["pipeline_local_gate", "pipeline_clean_reproduction"]) {
    const f = await fixture(t, { action, workspaceMode: "temporary-build" }), before = await f.run("status", "--porcelain=v1", "--untracked-files=all"), head = await f.run("rev-parse", "HEAD"), review = await f.execution.review("personal", f.proposed);
    await assert.rejects(f.execution.review("personal", { ...f.proposed, workspaceMode: "temporary-build" }), /Review one exact/);
    assert.equal(review.review.recipe.workspaceMode, "temporary-build"); assert.equal(review.review.executionPolicy.workspace, "bounded-writable-copy"); assert.equal(review.review.executionPolicy.temporaryBytes, 67108864); assert.equal(review.review.executionPolicy.hostRepositoryWritten, false);
    const input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
    assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "passed"); assert.equal(result.providerTaskCompletionVerified, false);
    const state = await f.store.snapshot("personal"), row = state.repositoryExecutionReviews[0]; assert.equal(row.checkpoint.payload.executionPolicy.workspace, "bounded-writable-copy"); assert.equal(row.checkpoint.payload.recipe.workspaceMode, "temporary-build");
    assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId); assert.equal(state.repositoryExecutions.length, 1);
    assert.equal(await readFile(join(f.root, "input.txt"), "utf8"), "reviewed non-production input"); await assert.rejects(access(join(f.root, "built.mjs")), { code: "ENOENT" });
    assert.equal(await f.run("status", "--porcelain=v1", "--untracked-files=all"), before); assert.equal(await f.run("rev-parse", "HEAD"), head);
    assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" });
  }
});
test("stopping the original writable-copy pipeline removes only its owned staging after both namespace levels exit", linux, async t => {
  const f = await fixture(t, { workspaceMode: "temporary-build", hold: true }), review = await f.execution.review("personal", f.proposed), running = f.execution.apply("personal", { requestId: f.proposed.requestId, token: review.confirmation.token });
  await awaitNativeReady(f, running); assert.equal((await f.execution.stopCompartment("personal")).stopped, true); assert.notEqual((await running).status, "completed");
  const state = await f.store.snapshot("personal"); assert.equal(state.repositoryExecutions.length, 1); assert.equal(state.repositoryExecutions[0].stoppedVerified, true); assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true);
  assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); assert.equal(await readFile(join(f.root, "input.txt"), "utf8"), "reviewed non-production input");
  assert.equal(state.repositoryExecutionJournal.some(e => e.kind === "receipt.issued" && e.payload.receipt.result === "passed"), false);
});
