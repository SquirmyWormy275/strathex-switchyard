import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeGuardianStopped } from "../runtime-command.mjs";

export async function assertPypiShield(f, { windows = false } = {}) {
  const index = await readFile(join(f.root, ".git/index")), head = await f.run("rev-parse", "HEAD"), original = await readFile(join(f.root, "requirements.txt"));
  const review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token };
  const result = await f.execution.apply("personal", input);
  assert.equal(result.status, "failed", JSON.stringify(result)); assert.ok(result.receiptId);
  const report = result.data.shieldReport, component = report.sbom.components[0], bom = report.cycloneDx;
  assert.equal(report.sbom.schema, "switchyard-lock-inventory/v2");
  assert.deepEqual(report.sbom.components, [{ ecosystem: "PyPI", name: "mixed-name", version: "1.2.0", declaredSha256: ["a".repeat(64)], requirementsPath: "requirements.txt" }]);
  assert.deepEqual(report.findings.map(row => [row.ruleId, row.severity, row.dimension]), [["PYSEC-synthetic-only", "unknown", "vulnerabilities"]]);
  assert.equal(component.version, "1.2.0"); assert.equal(bom.components[0].purl, "pkg:pypi/mixed-name@1.2.0"); assert.equal(bom.components[0].hashes, undefined); assert.equal(bom.dependencies, undefined); assert.equal(bom.compositions[0].aggregate, "unknown");
  for (const gap of ["python_environment_not_resolved", "advisory_severity_unassessed", "license_metadata", "package_source_or_integrity", "publisher_provenance_not_verified"]) assert.ok(report.gaps.includes(gap), gap);
  assert.equal(report.completeness, "incomplete"); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete");
  assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
  const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.receipt.historicalResult, "failed"); assert.equal(status.receipt.gateEligible, false);
  const state = await f.store.snapshot("personal");
  if (windows) { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
  else { assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
  assert.ok(state.repositoryProbes.every(row => row.stoppedVerified && row.scratchCleanupPending === false));
  assert.deepEqual(await readFile(join(f.root, ".git/index")), index); assert.equal(await f.run("rev-parse", "HEAD"), head); assert.deepEqual(await readFile(join(f.root, "requirements.txt")), original);
  await assert.rejects(access(join(f.root, "node_modules")), { code: "ENOENT" });
}
