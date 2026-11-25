import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { runtimeGuardianStopped } from "../runtime-command.mjs";
export async function verifyNpmArtifactExecution(t, factory, action, windows, { archives = false } = {}) {
  const scenarios = archives ? [["matched", "matched"], ["matched", "mismatched"], ["matched", "unsupported"], ["matched", "license-disallowed"]] : [["matched"], ["mismatched"], ["unsupported-integrity"]];
  for (const [artifactStatus, scenario] of scenarios) {
    const archiveStatus = scenario === "license-disallowed" ? "matched" : scenario;
    const f = await factory(t, { action, shield: true, clean: true, packageArtifact: artifactStatus, packageArchive: scenario });
    const before = await Promise.all([readFile(join(f.root, "package-lock.json")), readFile(join(f.root, "reviewed-package.tgz")), readFile(join(f.root, ".git/index")), f.run("rev-parse", "HEAD")]);
    const review = await f.execution.review("personal", f.proposed);
    assert.deepEqual(review.review.shield.request.packageArtifacts, f.sample.request.packageArtifacts);
    const input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
    assert.equal(result.status, artifactStatus === "mismatched" || ["mismatched", "license-disallowed"].includes(scenario) ? "failed" : "incomplete", JSON.stringify(result));
    assert.equal(result.data.shieldReport.sbom.components[0].artifact.status, artifactStatus); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete");
    if (archiveStatus) {
      const report = result.data.shieldReport;
      assert.equal(report.sbom.components[0].artifact.archive.status, archiveStatus);
      assert.equal(report.sbom.components[0].artifact.licensePolicy, scenario === "matched" ? "permitted" : scenario === "license-disallowed" ? "disallowed" : "unassessed");
      assert.equal(report.findings.some(f => f.ruleId === "license.disallowed"), scenario === "license-disallowed");
      assert.equal(report.gaps.includes("license_choice_not_selected"), scenario === "matched");
      assert.equal(report.findings.some(f => f.ruleId === "artifact.identity-mismatch"), archiveStatus === "mismatched");
      assert.equal(report.gaps.includes("npm_archive_identity_not_verified"), archiveStatus !== "matched");
      assert.ok(report.gaps.includes("artifact_contents_not_inspected"));
      assert.ok(report.gaps.includes("publisher_provenance_not_verified"));
      assert.ok(report.cycloneDx.components[0].properties.some(p => p.name === "switchyard:archive-identity" && p.value === archiveStatus));
      assert.ok(!JSON.stringify(report).includes("NEVER_EXECUTE_PACKAGE_SCRIPT"));
    }
    assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
    const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.receipt.gateEligible, false);
    const state = await f.store.snapshot("personal");
    if (windows) { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
    else { assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
    assert.ok(state.repositoryProbes.every(row => row.stoppedVerified && row.scratchCleanupPending === false));
    assert.deepEqual(await Promise.all([readFile(join(f.root, "package-lock.json")), readFile(join(f.root, "reviewed-package.tgz")), readFile(join(f.root, ".git/index")), f.run("rev-parse", "HEAD")]), before);
  }
}
