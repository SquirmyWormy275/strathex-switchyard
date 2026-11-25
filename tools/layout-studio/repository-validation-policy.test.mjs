import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-support/repository-pipeline-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";

for (const platform of ["linux", "win32"]) test(`${platform} cannot commit a passing receipt when signed policy changes after evidence validation`, { skip: platform === "linux" && process.platform !== "linux" }, async t => {
  const f = platform === "linux" ? await fixture(t, { signedFeeds: true }) : await windowsExecutionFixture(t, { action: "pipeline_local_gate", signedFeeds: true });
  const review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token }, original = f.store.update;
  let changed = false;
  f.store.update = async (...args) => {
    const value = await original(...args);
    // This exact parent transition occurs after the host has validated its
    // report/evidence, before ReceiptLedger commits the gate-bearing result.
    if (!changed && value?.state === "external_committed" && !value.parentId && value.action === f.proposed.action && value.details.commandStatus === "completed") {
      changed = true;
      const withdrawal = await f.fixtures.review("personal", { requestId: randomUUID(), action: "revoke-fixture", fixtureId: "synthetic-scanner", reason: "Synthetic policy change at receipt commit boundary" });
      assert.equal((await f.fixtures.apply("personal", { requestId: withdrawal.review.requestId, token: withdrawal.confirmation.token })).status, "completed");
    }
    return value;
  };
  const result = await f.execution.apply("personal", input); f.store.update = original;
  assert.equal(changed, true); assert.equal(result.status, "failed"); assert.equal(result.receiptId, undefined);
  const state = await f.store.snapshot("personal"); assert.equal(state.repositoryExecutionJournal.some(entry => entry.kind === "receipt.issued"), false);
  const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.programExitCode, 0); assert.equal(status.receipt, null);
  assert.equal((await f.execution.apply("personal", input)).replayed, true);
  if (platform === "win32") assert.equal(f.effects(), 1);
});
