import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./test-support/repository-pipeline-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";

for (const platform of ["linux", "win32"]) test(`${platform} refuses a passing receipt when local task authority scope changes after report validation`, { skip: platform === "linux" && process.platform !== "linux" }, async t => {
  const f = platform === "linux" ? await fixture(t) : await windowsExecutionFixture(t, { action: "pipeline_local_gate" }), review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token }, original = f.store.update;
  let changed = false;
  f.store.update = async (...args) => {
    const value = await original(...args);
    if (!changed && value?.state === "external_committed" && !value.parentId && value.action === f.proposed.action && value.details.commandStatus === "completed") {
      changed = true;
      if (platform === "linux") await original("personal", "synthetic-account-race", state => { state.accounts.push("changed-after-validation"); });
      else await f.service.revoke("personal", f.proposed.authorityId);
    }
    return value;
  };
  const result = await f.execution.apply("personal", input); f.store.update = original;
  assert.equal(changed, true); assert.equal(result.status, "failed"); assert.equal(result.receiptId, undefined);
  const state = await f.store.snapshot("personal"); assert.equal((state.repositoryExecutionJournal ?? []).some(entry => entry.kind === "receipt.issued"), false);
  const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.programExitCode, 0); assert.equal(status.receipt, null); assert.equal((await f.execution.apply("personal", input)).replayed, true);
  if (platform === "win32") assert.equal(f.effects(), 1);
});
