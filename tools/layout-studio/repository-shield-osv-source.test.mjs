import test from "node:test";
import assert from "node:assert/strict";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { collectOsvAdvisories } from "./osv-advisory-source.mjs";

async function verifyCalculated(t, factory, action, mixed, v4 = false) {
  const query = { ecosystem: "npm", name: "synthetic", version: "1.0.0" };
  const source = { id: "GHSA-synthetic-only", modified: new Date().toISOString(), affected: [{ package: { ecosystem: query.ecosystem, name: query.name }, versions: [query.version] }], severity: [{ type: "CVSS_V2", score: "AV:N/AC:L/Au:N/C:C/I:C/A:C/E:F/RL:OF/RC:C/TD:N" }, ...(mixed ? [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] : [])] };
  if (v4) source.severity = [{ type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:U/MVC:N/MVI:N/MVA:N" }];
  const collected = await collectOsvAdvisories([query], { fetchImpl: async () => new Response(JSON.stringify({ vulns: [source] }), { headers: { "content-type": "application/json" } }) });
  const severity = mixed || v4 ? "critical" : "high";
  assert.equal(collected.feed.packages[0].advisories[0].severity, severity);
  const f = await factory(t, { action, shield: true, advisorySeverity: collected.feed.packages[0].advisories[0].severity });
  const review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
  assert.equal(result.status, "failed", JSON.stringify(result)); assert.equal(result.data.shieldReport.completeness, "incomplete");
  const findings = result.data.shieldReport.findings.filter(row => row.dimension === "vulnerabilities"); assert.ok(findings.length); assert.ok(findings.every(row => row.severity === severity));
  assert.equal(result.data.shieldReport.gaps.includes("advisory_severity_unassessed"), false); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete");
  assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
  const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.receipt.gateEligible, false);
}
test("Linux actual isolated Supply Chain retains V2 high despite zero source environment score", { skip: process.platform !== "linux" }, async t => {
  await verifyCalculated(t, repositoryShieldFixture, "shield_supply_chain", false);
});
test("Linux actual isolated Release retains mixed critical severity with failed incomplete evidence", { skip: process.platform !== "linux" }, async t => {
  await verifyCalculated(t, repositoryShieldFixture, "release_shield", true);
});
test("Windows guest-double Supply Chain preserves mixed V2/V3 critical evidence and original receipt", async t => {
  await verifyCalculated(t, windowsExecutionFixture, "shield_supply_chain", true);
});

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

test("Linux actual isolated Release retains V4 critical despite zero supplied context and preserves native exit and receipt", { skip: process.platform !== "linux" }, async t => {
  await verifyCalculated(t, repositoryShieldFixture, "release_shield", false, true);
});
test("Windows guest-double Supply Chain retains V4 critical without granting complete coverage or a usable gate", async t => {
  await verifyCalculated(t, windowsExecutionFixture, "shield_supply_chain", false, true);
});
