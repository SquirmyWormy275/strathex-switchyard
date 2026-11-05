import test from "node:test";
import assert from "node:assert/strict";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";

async function verify(f) {
  const review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
  assert.equal(result.status, "failed", JSON.stringify(result)); assert.ok(result.receiptId); assert.equal(result.data.shieldReport.findings[0].dimension, "vulnerabilities"); assert.equal(result.data.shieldReport.findings[0].severity, "unknown"); assert.ok(result.data.shieldReport.gaps.includes("advisory_severity_unassessed")); assert.equal(result.data.shieldReport.completeness, "incomplete"); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete"); assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
  const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.receipt.historicalResult, "failed"); assert.equal(status.receipt.completeness, "incomplete"); assert.equal(status.receipt.gateEligible, false);
}
test("Linux pinned Supply Chain authenticates unassessed source severity as a failed incomplete finding after native exit", { skip: process.platform !== "linux" }, async t => {
  await verify(await repositoryShieldFixture(t, { action: "shield_supply_chain", advisorySeverity: "unknown" }));
});
test("Windows guest-double Supply Chain preserves unknown severity and its coverage gap in an authenticated failed receipt", async t => {
  await verify(await windowsExecutionFixture(t, { action: "shield_supply_chain", shield: true, advisorySeverity: "unknown" }));
});
