import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { connectedExecutionActions } from "./repository-execution-actions.mjs";
import { createTaskAuthority } from "./task-authority.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
const input = f => ({ taskId: f.task.id, action: "shield_codebase_audit", planRevision: "automatic-history-1", historyDepth: 4 });
const issueInput = r => Object.fromEntries(["taskId", "planRevision", "paths", "classifications", "actions", "lifetimeMinutes"].map(k => [k, r.scope[k]]));
async function fixture(t) {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  await writeFile(join(f.root, "app.js"), "SYNTHETIC_PRIVATE_OLD_SOURCE\n"); await f.run("add", "app.js"); await f.run("-c", "commit.gpgsign=false", "commit", "-m", "SYNTHETIC_PRIVATE_COMMIT_MESSAGE");
  const old = (await f.run("rev-parse", "HEAD")).trim();
  await writeFile(join(f.root, "app.js"), "current clean source\n"); await f.run("add", "app.js"); await f.run("-c", "commit.gpgsign=false", "commit", "-m", "synthetic clean version");
  return { ...f, old };
}

test("authenticated automatic history preparation derives immutable versions and absent paths without source disclosure", async t => {
  const f = await fixture(t); await writeFile(join(f.root, "new.txt"), "new staged source"); await f.run("add", "new.txt");
  const original = await readFile(join(f.root, ".git/index")), head = (await f.run("rev-parse", "HEAD")).trim();
  const suite = createSuite({ store: f.store, taskAuthority: f.service, agents: { close: async () => {} }, coding: { close: async () => {} } }); f.onCleanup(() => suite.close());
  const token = "J".repeat(43), server = createStudioServer({ suite, token, discover: async () => ({}) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); f.onCleanup(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`, api = authenticated => fetch(origin + "/api/suite/coding/authority/scanner-review", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input(f)) });
  assert.equal((await api(false)).status, 401); assert.equal(f.counters().calls, 0);
  const response = await api(true), review = await response.json(); assert.equal(response.status, 200, JSON.stringify(review));
  const p = review.preparation; assert.equal(p.policy, "bounded-current-and-history/v1"); assert.equal(p.historyHead, head); assert.equal(p.historyDepth, 4); assert.equal(p.historyStopping.kind, "root");
  assert.deepEqual(p.historyPaths, [".gitignore", "app.js", "new.txt", "task.txt"]); assert.equal(p.historyInputs.length, 8); assert.ok(p.historyAbsent.every(row => row.paths.includes("new.txt")));
  const old = p.historyInputs.find(row => row.source.commit === f.old && row.source.path === "app.js"); assert.ok(old); assert.equal(old.path, ".switchyard-history/" + f.old + "/app.js"); assert.equal(old.source.objectId, (await f.run("rev-parse", f.old + ":app.js")).trim()); assert.equal(old.source.depth, 4);
  for (const key of ["scanPerformed", "authorityGranted", "securityCoverageComplete"]) assert.equal(p[key], false);
  for (const text of ["SYNTHETIC_PRIVATE_OLD_SOURCE", "SYNTHETIC_PRIVATE_COMMIT_MESSAGE", "synthetic@example.invalid"]) assert.equal(JSON.stringify(review).includes(text), false);
  assert.ok(review.scope.paths.every(path => !path.startsWith(".switchyard-history/"))); assert.equal(p.historyGaps.includes("worktree_and_index_not_scanned"), true);
  const grant = await f.service.issue("personal", { ...issueInput(review), token: review.confirmation.token }); assert.ok(grant.id);
  assert.deepEqual(await readFile(join(f.root, ".git/index")), original); assert.equal((await f.run("rev-parse", "HEAD")).trim(), head);
});

test("automatic history preparation refuses malformed or unsupported requests before native queries", async t => {
  const f = await fixture(t);
  for (const historyDepth of [undefined, null, "4", 0, 7, 1.5, {}, []]) await assert.rejects(f.service.reviewScanner("personal", { ...input(f), historyDepth }));
  for (const extra of [{ includeIndex: "yes" }, { action: "shield_change_scan" }, { action: "shield_supply_chain" }, { paths: ["app.js"] }, { commits: [f.old] }, { ref: "main" }]) await assert.rejects(f.service.reviewScanner("personal", { ...input(f), ...extra }));
  assert.equal(f.counters().calls, 0); assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0);
});

test("automatic history preparation refuses more than eight tracked paths without truncation", async t => {
  const f = await fixture(t); for (let i = 0; i < 6; i++) await writeFile(join(f.root, "added" + i), "small"); await f.run("add", "--all");
  await assert.rejects(f.service.reviewScanner("personal", input(f)), /1.8|bounds/); assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0);
});

test("automatic history preparation refuses combined input overflow before confirmation", async t => {
  const f = await fixture(t); for (let i = 0; i < 251; i++) await writeFile(join(f.root, "u" + i), "small");
  await assert.rejects(f.service.reviewScanner("personal", input(f)), /256-file bound/); assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0);
});

test("automatic history preparation retains explicit depth and shallow coverage gaps", async t => {
  const f = await fixture(t), limited = await f.service.reviewScanner("personal", { ...input(f), historyDepth: 1, includeIndex: false });
  assert.equal(limited.preparation.historyStopping.kind, "depth"); assert.ok(limited.preparation.historyGaps.includes("history_depth_limited"));
  await writeFile(join(f.root, ".git/shallow"), (await f.run("rev-parse", "HEAD")).trim() + "\n");
  const shallow = await f.service.reviewScanner("personal", input(f)); assert.equal(shallow.preparation.historyShallow, true); assert.equal(shallow.preparation.historyStopping.kind, "shallow"); assert.ok(shallow.preparation.historyGaps.includes("shallow_history_boundary")); assert.equal(shallow.preparation.securityCoverageComplete, false);
});

for (const drift of ["index", "worktree", "HEAD", "account", "selection"]) test(`automatic history preparation refuses ${drift} drift after witnessing`, async t => {
  const f = await fixture(t); let active = true;
  const inspection = { ...f.inspection, async historyInputs(...args) {
    const report = await f.inspection.historyInputs(...args);
    if (drift === "account") await f.store.update("personal", "synthetic-account-drift", s => { s.codingSessions[0].accountFingerprint = "b".repeat(64); });
    else if (drift === "selection") active = false;
    else { await writeFile(join(f.root, "task.txt"), "changed after witness\n"); if (drift !== "worktree") await f.run("add", "task.txt"); if (drift === "HEAD") await f.run("-c", "commit.gpgsign=false", "commit", "-m", "synthetic drift"); }
    return report;
  } };
  const service = createTaskAuthority({ store: f.store, inspection, now: f.now, executionActions: connectedExecutionActions("linux"), isActive: async () => active, checkNative: async () => {} }); f.onCleanup(() => service.close());
  await assert.rejects(service.reviewScanner("personal", input(f)), /changed|Select this workspace/); assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0);
});

test("automatic history preparation retains the smaller Windows budget for repeated version bytes", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  for (const name of ["a.txt", "b.txt"]) await writeFile(join(f.root, name), "x".repeat(82000)); await f.run("add", "a.txt", "b.txt"); await f.run("-c", "commit.gpgsign=false", "commit", "-m", "synthetic large versions"); await f.run("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "synthetic unchanged versions");
  if (process.platform === "win32") { await assert.rejects(f.service.reviewScanner("personal", input(f)), /Windows 320 KiB/); assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0); }
  else { const review = await f.service.reviewScanner("personal", input(f)); assert.ok(review.preparation.historyInputs.reduce((sum, row) => sum + row.size, 0) > 320 * 1024); }
});

for (const windows of [false, true]) test(`automatic history preparation composes with separately reviewed ${windows ? "Windows guest-double" : "Linux"} historical-only secret scanning`, { skip: !windows && process.platform !== "linux" }, async t => {
  const options = { action: "shield_codebase_audit", clean: true, historyInputs: true }, f = windows ? await windowsExecutionFixture(t, { ...options, shield: true }) : await repositoryShieldFixture(t, options);
  await f.service.revoke("personal", f.proposed.authorityId);
  const before = await readFile(join(f.root, ".git/index")), worktree = await readFile(join(f.root, "app.js")), head = await f.run("rev-parse", "HEAD"), prepared = await f.service.reviewScanner("personal", input(f));
  const expected = f.sample.request.files.filter(row => row.source?.kind === "git-history"); assert.equal(expected.length, 2); assert.deepEqual(prepared.preparation.historyInputs.filter(row => row.source.path === "app.js"), expected);
  const grant = await f.service.issue("personal", { ...issueInput(prepared), token: prepared.confirmation.token }), proposal = { ...f.proposed, authorityId: grant.id }, review = await f.execution.review("personal", proposal), request = { requestId: proposal.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", request);
  assert.equal(result.status, "failed"); assert.ok(result.data.shieldReport.findings.some(row => row.path.startsWith(".switchyard-history/"))); assert.equal(result.data.shieldReport.completeness, "incomplete"); assert.equal((await f.execution.apply("personal", request)).receiptId, result.receiptId);
  const state = await f.store.snapshot("personal");
  if (windows) { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
  else { assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
  assert.deepEqual(await readFile(join(f.root, ".git/index")), before); assert.deepEqual(await readFile(join(f.root, "app.js")), worktree); assert.equal(await f.run("rev-parse", "HEAD"), head);
});
