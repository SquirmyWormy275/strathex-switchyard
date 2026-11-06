import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { runtimeGuardianStopped } from "../runtime-command.mjs";
export async function assertPythonWheelShield(t, factory, action, windows) {
  for (const [archiveCase, archiveStatus] of [["deflated", "matched"], ["wrong-name", "mismatched"], ["future-wheel", "unsupported"]]) {
    const f = await factory(t, { action, shield: true, clean: true, pypiWheel: archiveCase });
    const original = () => Promise.all([readFile(join(f.root, "requirements.txt")), readFile(join(f.root, "reviewed-package.whl")), readFile(join(f.root, ".git/index")), f.run("rev-parse", "HEAD")]), before = await original();
    const review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
    assert.equal(result.status, archiveStatus === "mismatched" ? "failed" : "incomplete", JSON.stringify(result));
    const report = result.data.shieldReport, artifact = report.sbom.components[0].artifact;
    assert.equal(artifact.status, "matched"); assert.equal(artifact.archive.status, archiveStatus);
    assert.equal(report.findings.some(f => f.ruleId === "artifact.identity-mismatch"), archiveStatus === "mismatched");
    assert.equal(report.completeness, "incomplete"); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete");
    assert.equal(JSON.stringify(result).includes("NEVER_COPY_PRIVATE_WHEEL"), false);
    assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
    const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.receipt.gateEligible, false);
    const state = await f.store.snapshot("personal");
    if (windows) { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
    else { assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
    assert.ok(state.repositoryProbes.every(row => row.stoppedVerified && row.scratchCleanupPending === false)); assert.deepEqual(await original(), before);
    await assert.rejects(access(join(f.root, "node_modules")), { code: "ENOENT" });
  }
}
