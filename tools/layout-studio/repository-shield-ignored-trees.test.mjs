import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, readFile, access, stat, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";

async function exercise(f, windows) {
  const head = await f.run("rev-parse", "HEAD"), before = await f.run("status", "--porcelain=v1", "--untracked-files=all"), secret = await readFile(join(f.root, ".env"));
  const grant = (await f.service.list("personal"))[0]; assert.deepEqual(grant.proposal.classifications.excludedIgnoredTrees, ["node_modules"]); assert.deepEqual(grant.grant.allowedActions, ["shield_change_scan"]);
  const review = await f.execution.review("personal", f.proposed); assert.equal(review.review.shield.completeShieldGateAvailable, false);
  await writeFile(join(f.root, "node_modules/generated.js"), "changed outside reviewed source-byte scope");
  const input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input); assert.equal(result.status, "failed", JSON.stringify(result)); assert.ok(result.receiptId); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete"); assert.equal(result.data.shieldReport.completeness, "incomplete"); assert.ok(result.data.shieldReport.findings.some(finding => finding.path === ".env" && finding.ruleId === "secret.private-key")); assert.ok(result.data.shieldReport.gaps.includes("repository_scope_unverified")); assert.equal(JSON.stringify(result.data.shieldReport).includes("-----BEGIN PRIVATE KEY-----"), false); assert.equal(result.data.shieldReport.inventory.some(file => file.path.startsWith("node_modules")), false);
  assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId); const state = await f.store.snapshot("personal");
  if (windows) { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
  else { assert.equal(state.repositoryExecutions.length, 1); assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
  assert.deepEqual(await readFile(join(f.root, ".env")), secret); assert.equal((await stat(join(f.root, "node_modules/large.bin"))).size, 80 * 1024 * 1024); assert.equal(await f.run("ls-files", "--stage", "--", ".env", "node_modules"), ""); assert.equal(await f.run("rev-parse", "HEAD"), head); assert.equal(await f.run("status", "--porcelain=v1", "--untracked-files=all"), before);
  await rename(join(f.root, "node_modules"), join(f.stage, "previous-generated-tree")); await mkdir(join(f.root, "node_modules")); await writeFile(join(f.root, "node_modules/file"), "new directory identity");
  await assert.rejects(f.execution.review("personal", { ...f.proposed, requestId: randomUUID() }), /target changed/);
}
test("Linux pinned Shield scans an exact ignored secret while an explicitly excluded 80 MiB generated tree remains outside staged inputs", { skip: process.platform !== "linux" }, async t => {
  await exercise(await repositoryShieldFixture(t, { ignoredSecrets: true, ignoredBuildTree: true }), false);
});
test("Windows guest-double Shield enforces the same ignored-tree policy, source witnesses, non-passing receipt and root-replacement refusal", async t => {
  await exercise(await windowsExecutionFixture(t, { action: "shield_change_scan", shield: true, ignoredSecrets: true, ignoredBuildTree: true }), true);
});
