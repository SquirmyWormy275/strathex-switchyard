import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";

for (const platform of ["linux", "win32"]) test(`${platform} Shield scans an explicitly approved ignored secret as a read-only input and retains redacted incomplete evidence`, { skip: platform === "linux" && process.platform !== "linux" }, async t => {
  const f = platform === "linux" ? await repositoryShieldFixture(t, { ignoredSecrets: true }) : await windowsExecutionFixture(t, { action: "shield_change_scan", shield: true, ignoredSecrets: true });
  const secret = await readFile(join(f.root, ".env")), index = await f.run("write-tree"), head = await f.run("rev-parse", "HEAD");
  assert.equal(await f.run("ls-files", "--stage", "--", ".env"), ""); assert.equal((await f.run("ls-files", "--others", "--ignored", "--exclude-standard")).trim(), ".env");
  const review = await f.execution.review("personal", f.proposed), input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
  assert.equal(result.status, "failed", JSON.stringify(result)); assert.ok(result.receiptId); assert.equal(result.data.shieldReport.completeness, "incomplete"); assert.ok(result.data.shieldReport.gaps.includes("repository_scope_unverified"));
  assert.ok(result.data.shieldReport.findings.some(finding => finding.path === ".env" && finding.ruleId === "secret.private-key")); assert.equal(JSON.stringify(result.data.shieldReport).includes(secret.toString()), false); assert.equal(JSON.stringify(result).includes("-----BEGIN PRIVATE KEY-----"), false);
  const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.stagingCleanupPending, false); assert.equal(status.receipt.completeness, "incomplete");
  assert.deepEqual(await readFile(join(f.root, ".env")), secret); assert.equal(await f.run("write-tree"), index); assert.equal(await f.run("rev-parse", "HEAD"), head); assert.equal(await f.run("ls-files", "--stage", "--", ".env"), ""); assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
  const next = { ...f.proposed, requestId: randomUUID() }, pending = await f.execution.review("personal", next); await writeFile(join(f.root, ".env"), "changed after exact scan review");
  await assert.rejects(f.execution.apply("personal", { requestId: next.requestId, token: pending.confirmation.token }));
  if (platform === "win32") assert.equal(f.effects(), 1); else assert.equal((await f.store.snapshot("personal")).repositoryExecutions.length, 1);
});
