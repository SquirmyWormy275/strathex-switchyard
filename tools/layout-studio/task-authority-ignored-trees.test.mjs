import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, open, rename, access } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { connectedExecutionActions } from "./repository-execution-actions.mjs";

test("generated-tree exclusions refuse broader actions and every overlap with owned or classified source before native queries", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  const proposed = { ...f.proposed, actions: ["shield_change_scan"], classifications: { excludedIgnoredTrees: ["node_modules"] } };
  for (const changed of [
    { ...proposed, actions: ["local_commit"] }, { ...proposed, actions: ["run_target"] }, { ...proposed, actions: ["pipeline_local_gate"] }, { ...proposed, actions: ["shield_change_scan", "local_commit"] },
    { ...proposed, paths: ["node_modules/file.js"] }, { ...proposed, classifications: { excludedIgnoredTrees: ["node_modules"], includedIgnored: ["node_modules/.env"] }, paths: ["node_modules/.env"] },
    { ...proposed, classifications: { excludedIgnoredTrees: ["node_modules"], excludedUntracked: ["node_modules/source.js"] } }, { ...proposed, classifications: { excludedIgnoredTrees: ["private"] } },
    { ...proposed, classifications: { excludedIgnoredTrees: ["build", "build/node_modules"] } }
  ]) await assert.rejects(f.service.review("personal", changed));
  assert.equal(f.counters().calls, 0); assert.equal((await f.service.list("personal")).length, 0);
});
test("reviewed Shield authority witnesses an ignored build root instead of hashing 80 MiB, while ignored secret bytes and root replacement remain exact", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  await writeFile(join(f.root, ".gitignore"), "cache.txt\n.env\nnode_modules/\n"); await mkdir(join(f.root, "node_modules")); await writeFile(join(f.root, ".env"), "synthetic exact secret input");
  const big = await open(join(f.root, "node_modules/large.bin"), "wx"); try { await big.truncate(80 * 1024 * 1024); } finally { await big.close(); }
  const proposed = { ...f.proposed, paths: ["task.txt", ".env"], actions: ["shield_change_scan"], classifications: { includedIgnored: [".env"], excludedIgnoredTrees: ["node_modules"] } }, head = await f.run("rev-parse", "HEAD"), before = await f.run("status", "--porcelain=v1", "--untracked-files=all");
  const review = await f.service.review("personal", proposed); assert.equal(review.scope.targetSnapshot.completeness, "complete"); assert.equal(review.scope.targetSnapshot.policyVersion, "switchyard-task-shield-ignored-trees/v1"); assert.deepEqual(review.scope.classifications.excludedIgnoredTrees, ["node_modules"]); assert.match(review.confirmation.record.reason, /contents are not scanned or hashed/);
  const grant = await f.service.issue("personal", { ...proposed, token: review.confirmation.token }); assert.deepEqual(grant.grant.allowedActions, ["shield_change_scan"]);
  const resolved = await f.service.resolve("personal", grant.id, "shield_change_scan"), excluded = resolved.files.ignored.find(file => file.path === "node_modules"); assert.equal(excluded.classification, "excluded"); assert.match(excluded.digest, /^policy-excluded-directory-sha256:[a-f0-9]{64}$/); assert.match(resolved.files.ignored.find(file => file.path === ".env").digest, /^sha256:/); assert.equal(resolved.files.ignored.some(file => file.path.includes("large.bin")), false);
  await writeFile(join(f.root, "node_modules/generated.js"), "uninspected generated churn"); assert.equal((await f.service.resolve("personal", grant.id, "shield_change_scan")).snapshot.id, grant.targetSnapshot.id);
  await writeFile(join(f.root, ".env"), "changed secret bytes"); await assert.rejects(f.service.resolve("personal", grant.id, "shield_change_scan"), /target changed/); await writeFile(join(f.root, ".env"), "synthetic exact secret input");
  await rename(join(f.root, "node_modules"), join(f.stage, "held-generated-tree")); await mkdir(join(f.root, "node_modules")); await writeFile(join(f.root, "node_modules/file"), "replacement"); await assert.rejects(f.service.resolve("personal", grant.id, "shield_change_scan"), /target changed/);
  assert.equal(await f.run("rev-parse", "HEAD"), head); assert.equal(await f.run("status", "--porcelain=v1", "--untracked-files=all"), before);
  const state = await f.store.snapshot("personal"); assert.ok(state.repositoryProbes.every(probe => probe.stoppedVerified && !probe.scratchCleanupPending)); for (const probe of state.repositoryProbes) await assert.rejects(access(probe.scratch), { code: "ENOENT" }); assert.equal(state.repositoryExecutionJournal?.length ?? 0, 0);
});
test("a generated-tree policy cannot exclude an ordinary untracked directory or a missing ignored root", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") }), proposed = { ...f.proposed, actions: ["shield_change_scan"], classifications: { excludedIgnoredTrees: ["node_modules"] } };
  await mkdir(join(f.root, "node_modules")); await writeFile(join(f.root, "node_modules/file"), "synthetic"); await assert.rejects(f.service.review("personal", proposed), /whole ignored directory/);
  await writeFile(join(f.root, ".gitignore"), "cache.txt\nnode_modules/\n"); const review = await f.service.review("personal", proposed);
  await writeFile(join(f.root, ".gitignore"), "cache.txt\n"); await assert.rejects(f.service.issue("personal", { ...proposed, token: review.confirmation.token }), /whole ignored directory/); assert.equal((await f.service.list("personal")).length, 0);
  await writeFile(join(f.root, ".gitignore"), "cache.txt\nnode_modules/\n"); await f.run("add", "--force", "node_modules/file"); await f.run("-c", "commit.gpgsign=false", "commit", "-m", "synthetic tracked generated-directory input"); await assert.rejects(f.service.review("personal", proposed), /whole ignored directory|contains tracked data/);
});
