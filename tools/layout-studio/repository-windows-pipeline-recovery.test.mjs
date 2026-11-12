import test from "node:test";
import assert from "node:assert/strict";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";

// The Windows guest is doubled. Durable task, Git, file and receipt boundaries are real.
test("a lost Windows pipeline observation acknowledgement cannot be upgraded from native program success or replayed after restart", async t => {
  const f = await windowsExecutionFixture(t, { action: "pipeline_local_gate" }), review = await f.execution.review("personal", f.proposed), original = f.store.update; let fail = true;
  f.store.update = async (...args) => { const result = await original(...args); if (fail && args[1] === "windows-pipeline-observed") { fail = false; throw Error("Synthetic lost protected pipeline observation acknowledgement"); } return result; };
  const input = { requestId: f.proposed.requestId, token: review.confirmation.token }, first = await f.execution.apply("personal", input);
  assert.notEqual(first.status, "completed"); assert.equal(f.effects(), 1);
  const before = await f.store.snapshot("personal"); assert.equal(before.repositoryWindowsRuns[0].result.status, "completed"); assert.equal(before.repositoryWindowsRuns[0].nativeExitVerified, true);
  assert.equal(before.repositoryExecutionJournal.some(e => e.kind === "receipt.issued" && e.payload.receipt.result === "passed"), false);
  const reopened = f.create(); await reopened.recoverCompartment("personal"); const status = await reopened.status("personal", f.proposed.requestId);
  assert.equal(status.outcome.status, first.status); assert.equal((await reopened.apply("personal", input)).replayed, true); assert.equal(f.effects(), 1);
  const after = await f.store.snapshot("personal"); assert.equal(after.repositoryExecutionJournal.some(e => e.kind === "receipt.issued" && e.payload.receipt.result === "passed"), false);
});
