import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeGuardianStopped } from "../runtime-command.mjs";

export async function assertLicenseShield(f, { windows = false } = {}) {
  const index = await readFile(join(f.root, ".git/index")), head = await f.run("rev-parse", "HEAD"), original = await readFile(join(f.root, "package-lock.json"));
  const review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token };
  const result = await f.execution.apply("personal", input);
  assert.equal(result.status, "failed", JSON.stringify(result)); assert.ok(result.receiptId);
  const report = result.data.shieldReport;
  assert.deepEqual(report.findings.map(row => [row.ruleId, row.dimension, row.severity]), Array.from({ length: 3 }, () => ["license.disallowed", "licenses", "high"]));
  assert.deepEqual(report.sbom.components.map(c => c.license), ["MIT OR GPL-3.0-only", "MIT AND GPL-3.0-only", null, "MIT OR Apache-2.0 AND GPL-3.0-only", "GPL-2.0-only WITH Classpath-exception-2.0", "GPL-2.0-only", "GPL-2.0-only WITH Bison-exception-2.2", "MIT OR GPL-2.0-only WITH Bison-exception-2.2"]);
  for (const gap of ["license_choice_not_selected", "license_metadata", "publisher_provenance_not_verified"]) assert.ok(report.gaps.includes(gap), gap);
  assert.equal(report.cycloneDx.components[0].licenses[0].license.name, "MIT OR GPL-3.0-only"); assert.equal(report.cycloneDx.compositions[0].aggregate, "unknown");
  assert.equal(report.completeness, "incomplete"); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete");
  assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
  const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.receipt.historicalResult, "failed"); assert.equal(status.receipt.gateEligible, false);
  const state = await f.store.snapshot("personal");
  if (windows) { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
  else { assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
  assert.ok(state.repositoryProbes.every(row => row.stoppedVerified && row.scratchCleanupPending === false));
  assert.deepEqual(await readFile(join(f.root, ".git/index")), index); assert.equal(await f.run("rev-parse", "HEAD"), head); assert.deepEqual(await readFile(join(f.root, "package-lock.json")), original);
  await assert.rejects(access(join(f.root, "node_modules")), { code: "ENOENT" });
}
