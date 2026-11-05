import test from "node:test";
import assert from "node:assert/strict";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";

// Actual task/Git, protected checkpoint/budget/receipt and file boundaries.
// Guest execution and native exit are explicit doubles; no VM is opened.
for (const action of ["pipeline_local_gate", "pipeline_clean_reproduction"]) test(`reviewed Windows ${action} connects exact host-authenticated evidence without replay or provider completion`, async t => {
  const f = await windowsExecutionFixture(t, { action, signedFeeds: true }), head = await f.run("rev-parse", "HEAD"), review = await f.execution.review("personal", f.proposed);
  assert.equal(review.review.action, action); assert.equal(review.confirmation.record.action, action);
  const input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(result.providerTaskCompletionVerified, false); assert.equal(result.nativePermissionsChanged, false);
  const evidence = result.data.receiptEvidenceEnvelope; assert.equal(evidence.action, action); assert.equal(evidence.completeness, "complete"); assert.equal(evidence.outcome, "passed");
  assert.equal(evidence.evidence.manifestSha256, f.proposed.manifestSha256); assert.equal(evidence.evidence.helperSha256, f.prerequisites.helperSha256);
  const feeds = await f.fixtures.resolve("personal", { scannerFixtureIds: ["synthetic-scanner"], advisoryFixtureIds: ["synthetic-advisory"], observedAt: new Date(f.now()) });
  for (const feed of feeds) assert.equal(evidence.evidence.toolVersions[`fixture:${feed.kind}:${feed.id}`], `manifest=sha256:${feed.manifestSha256};content=sha256:${feed.contentSha256};feed=${feed.feedVersion};tool=${feed.toolName}@${feed.toolVersion}`);
  const repeated = await f.execution.apply("personal", input); assert.equal(repeated.receiptId, result.receiptId); assert.equal(f.effects(), 1); assert.equal(await f.run("rev-parse", "HEAD"), head);
  const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.stagingCleanupPending, false);
});
