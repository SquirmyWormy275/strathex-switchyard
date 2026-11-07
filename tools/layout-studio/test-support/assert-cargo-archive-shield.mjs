import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { runtimeGuardianStopped } from "../runtime-command.mjs";
export async function assertCargoArchiveShield(t, factory, action, windows) {
  for (const scenario of ["matched", "mismatched", "unsupported", "license-disallowed"]) {
    const archiveStatus = scenario === "license-disallowed" ? "matched" : scenario;
    const f = await factory(t, { action, shield: true, clean: true, cargoArchive: scenario });
    const original = () => Promise.all([readFile(join(f.root, "Cargo.lock")), readFile(join(f.root, "reviewed-package.crate")), readFile(join(f.root, ".git/index")), f.run("rev-parse", "HEAD")]), before = await original();
    const review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
    assert.equal(result.status, ["mismatched", "license-disallowed"].includes(scenario) ? "failed" : "incomplete", JSON.stringify(result));
    const report = result.data.shieldReport, artifact = report.sbom.components[0].artifact;
    assert.equal(artifact.status, "matched"); assert.equal(artifact.archive.status, archiveStatus);
    assert.equal(artifact.licensePolicy, scenario === "license-disallowed" ? "disallowed" : scenario === "matched" ? "permitted" : "unassessed");
    assert.equal(report.findings.some(f => f.ruleId === "license.disallowed"), scenario === "license-disallowed");
    assert.equal(report.gaps.includes("license_choice_not_selected"), scenario === "matched");
    assert.ok(report.gaps.includes("license_metadata"));
    assert.equal(report.findings.some(f => f.ruleId === "artifact.identity-mismatch"), archiveStatus === "mismatched");
    assert.equal(report.gaps.includes("cargo_archive_identity_not_verified"), archiveStatus !== "matched");
    assert.equal(report.cycloneDx.components[0].properties.find(p => p.name === "switchyard:archive-identity").value, archiveStatus);
    assert.equal(report.completeness, "incomplete"); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete");
    assert.equal(JSON.stringify(result).includes("NEVER_EXECUTE"), false);
    assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
    const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.receipt.gateEligible, false);
    const state = await f.store.snapshot("personal");
    if (windows) { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
    else { assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
    assert.ok(state.repositoryProbes.every(row => row.stoppedVerified && row.scratchCleanupPending === false)); assert.deepEqual(await original(), before);
    await assert.rejects(access(join(f.root, "node_modules")), { code: "ENOENT" });
  }
}
