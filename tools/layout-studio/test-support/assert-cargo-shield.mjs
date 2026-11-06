import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeGuardianStopped } from "../runtime-command.mjs";

export async function assertCargoShield(f, { windows = false } = {}) {
  const index = await readFile(join(f.root, ".git/index"));
  const head = await f.run("rev-parse", "HEAD");
  const original = await readFile(join(f.root, "Cargo.lock"));
  const review = await f.execution.review("personal", f.proposed);
  const input = { requestId: f.proposed.requestId, token: review.confirmation.token };
  const result = await f.execution.apply("personal", input);
  assert.equal(result.status, "failed", JSON.stringify(result));
  assert.ok(result.receiptId);

  const report = result.data.shieldReport;
  const components = report.sbom.components;
  const bom = report.cycloneDx;
  assert.equal(report.sbom.schema, "switchyard-lock-inventory/v2");
  assert.deepEqual(components.map(c => [c.ecosystem, c.name, c.version, c.sourceKind]), [
    ["Cargo", "synthetic-app", "0.1.0", "local"],
    ["Cargo", "example", "1.2.3", "crates.io"],
    ["Cargo", "example", "1.2.3", "git"]
  ]);
  assert.deepEqual(report.findings.map(row => [row.ruleId, row.severity, row.dimension]), [
    ["RUSTSEC-synthetic-only", "unknown", "vulnerabilities"]
  ]);
  assert.equal(bom.components[1].purl, "pkg:cargo/example@1.2.3");
  assert.equal(bom.components[2].purl, undefined);
  assert.ok(bom.components.every(c => c.hashes === undefined));
  assert.equal(new Set(bom.components.map(c => c["bom-ref"])).size, 3);
  assert.equal(bom.dependencies, undefined);
  assert.equal(bom.compositions[0].aggregate, "unknown");
  assert.equal(JSON.stringify(report).includes("private.invalid"), false);
  for (const gap of ["cargo_resolution_not_performed", "advisory_severity_unassessed", "license_metadata", "package_source_or_integrity", "publisher_provenance_not_verified"]) assert.ok(report.gaps.includes(gap), gap);
  assert.equal(report.completeness, "incomplete");
  assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete");
  assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);

  const status = await f.execution.status("personal", f.proposed.requestId);
  assert.equal(status.nativeExitVerified, true);
  assert.equal(status.receipt.historicalResult, "failed");
  assert.equal(status.receipt.gateEligible, false);
  const state = await f.store.snapshot("personal");
  if (windows) {
    assert.equal(f.effects(), 1);
    assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true);
    assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false);
  } else {
    assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true);
    assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false);
    await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" });
  }
  assert.ok(state.repositoryProbes.every(row => row.stoppedVerified && row.scratchCleanupPending === false));
  assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
  assert.equal(await f.run("rev-parse", "HEAD"), head);
  assert.deepEqual(await readFile(join(f.root, "Cargo.lock")), original);
  for (const name of ["node_modules", "target"]) await assert.rejects(access(join(f.root, name)), { code: "ENOENT" });
}
