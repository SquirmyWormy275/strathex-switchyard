import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
const linux = { skip: process.platform !== "linux" };

test("real Supply Chain namespace inventories declared workspace metadata without opening absent local sources", linux, async t => {
  for (const clean of [false, true]) {
    const f = await repositoryShieldFixture(t, { action: "shield_supply_chain", workspaceLock: true, clean });
    await assert.rejects(access(join(f.root, "packages")), { code: "ENOENT" });
    const review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
    assert.equal(result.status, clean ? "incomplete" : "failed", JSON.stringify(result));
    const report = result.data.shieldReport, local = report.sbom.components.find(component => component.name === "@synthetic/local");
    assert.equal(report.sbom.components.length, 2); assert.equal(local.installedAs, "local-alias"); assert.equal(local.version, "2.0.0"); assert.equal(local.workspace.path, "packages/local"); assert.match(local.workspace.lockMetadataSha256, /^[a-f0-9]{64}$/); assert.equal(local.integritySha256, null);
    assert.ok(report.gaps.includes("workspace_source_unverified")); assert.equal(report.gaps.includes("unsupported_npm_package"), false); assert.equal(report.cycloneDx.compositions[0].aggregate, "unknown"); assert.equal(report.cycloneDx.dependencies, undefined); assert.equal(JSON.stringify(result).includes("NEVER_EXECUTE_WORKSPACE_SCRIPT"), false); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete");
    assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
    const state = await f.store.snapshot("personal"); assert.equal(state.repositoryExecutions.length, 1); assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path)); await assert.rejects(access(join(f.root, "packages")), { code: "ENOENT" });
  }
});

test("Windows guest-double Supply Chain retains workspace aliases and explicit source gaps in authenticated non-passing reports", async t => {
  for (const clean of [false, true]) {
    const f = await windowsExecutionFixture(t, { action: "shield_supply_chain", shield: true, workspaceLock: true, clean });
    await assert.rejects(access(join(f.root, "packages")), { code: "ENOENT" });
    const review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
    assert.equal(result.status, clean ? "incomplete" : "failed", JSON.stringify(result));
    const report = result.data.shieldReport, local = report.sbom.components.find(component => component.name === "@synthetic/local");
    assert.equal(report.sbom.components.length, 2); assert.equal(local.installedAs, "local-alias"); assert.equal(local.version, "2.0.0"); assert.equal(local.workspace.path, "packages/local"); assert.equal(local.integritySha256, null); assert.ok(report.gaps.includes("workspace_source_unverified")); assert.equal(report.gaps.includes("unsupported_npm_package"), false);
    assert.equal(report.cycloneDx.compositions[0].aggregate, "unknown"); assert.equal(report.cycloneDx.dependencies, undefined); assert.equal(JSON.stringify(result).includes("NEVER_EXECUTE_WORKSPACE_SCRIPT"), false); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete"); assert.ok(result.data.receiptEvidenceEnvelope.evidence.toolVersions.guestResultManifest);
    assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId); assert.equal(f.effects(), 1); const state = await f.store.snapshot("personal"); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); await assert.rejects(access(join(f.root, "packages")), { code: "ENOENT" });
  }
});
