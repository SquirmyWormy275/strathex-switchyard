import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { connectedExecutionActions } from "./repository-execution-actions.mjs";
import { createTaskAuthority } from "./task-authority.mjs";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
const input = f => ({ taskId: f.task.id, action: "shield_codebase_audit", planRevision: "automatic-index-1", includeIndex: true });
const issueInput = r => Object.fromEntries(["taskId", "planRevision", "paths", "classifications", "actions", "lifetimeMinutes"].map(k => [k, r.scope[k]]));

test("automatic index preparation derives exact staged metadata alongside current paths without source disclosure", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  await mkdir(join(f.root, "nested")); await writeFile(join(f.root, "nested/source.txt"), "NEVER_RETURN_STAGED_TEXT\n"); await f.run("add", "nested/source.txt"); await writeFile(join(f.root, "nested/source.txt"), "different worktree\n");
  const original = await readFile(join(f.root, ".git/index"));
  const suite = createSuite({ store: f.store, taskAuthority: f.service, agents: { close: async () => {} }, coding: { close: async () => {} } }); f.onCleanup(() => suite.close());
  const token = "I".repeat(43), server = createStudioServer({ suite, token, discover: async () => ({}) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); f.onCleanup(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`, api = authenticated => fetch(origin + "/api/suite/coding/authority/scanner-review", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input(f)) });
  assert.equal((await api(false)).status, 401); assert.equal(f.counters().calls, 0);
  const response = await api(true), review = await response.json(); assert.equal(response.status, 200, JSON.stringify(review));
  assert.equal(review.preparation.policy, "bounded-current-and-index/v1"); assert.match(review.preparation.indexTree, /^[a-f0-9]{40}$/); assert.equal(review.preparation.indexTree, review.scope.targetSnapshot.indexTree);
  assert.equal(review.preparation.indexInputs.length, 3); assert.equal(review.preparation.scanPerformed, false); assert.equal(review.preparation.authorityGranted, false);
  assert.ok(review.scope.paths.every(path => !path.startsWith(".switchyard-index/"))); assert.deepEqual(review.scope.actions, ["shield_codebase_audit"]);
  const staged = review.preparation.indexInputs.find(f => f.source.path === "nested/source.txt");
  assert.equal(staged.path, ".switchyard-index/nested/source.txt"); assert.equal(staged.source.objectId, (await f.run("rev-parse", ":nested/source.txt")).trim()); assert.equal(staged.source.kind, "git-index");
  assert.equal(JSON.stringify(review).includes("NEVER_RETURN_STAGED_TEXT"), false); assert.deepEqual(await readFile(join(f.root, ".git/index")), original);
  const grant = await f.service.issue("personal", { ...issueInput(review), token: review.confirmation.token }); assert.ok(grant.id);
  const plain = await f.service.reviewScanner("personal", { ...input(f), includeIndex: false }); assert.equal(plain.preparation.policy, "bounded-current-files/v1"); assert.equal(Object.hasOwn(plain.preparation, "indexInputs"), false);
  assert.deepEqual(await readFile(join(f.root, ".git/index")), original);
});

test("automatic index preparation rejects malformed flags before queries and oversized selections without approval", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  for (const includeIndex of [null, "true", 1, {}, []]) await assert.rejects(f.service.reviewScanner("personal", { ...input(f), includeIndex }));
  assert.equal(f.counters().calls, 0);
  for (let i = 0; i < 63; i++) await writeFile(join(f.root, "f" + i), "small"); await f.run("add", "--all");
  await assert.rejects(f.service.reviewScanner("personal", input(f)), /1.64|bounded|64/);
  const state = await f.store.snapshot("personal"); assert.equal(state.confirmationJournal?.length ?? 0, 0); assert.equal(state.taskAuthorities?.length ?? 0, 0);
});

test("a different witnessed index cannot acquire confirmation even when HEAD and the later snapshot return unchanged", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  const inspection = { ...f.inspection, async indexInputs(...args) { const report = await f.inspection.indexInputs(...args); return { ...report, rows: report.rows.map((r, i) => i ? r : { ...r, objectId: "a".repeat(r.objectId.length) }) }; } };
  const service = createTaskAuthority({ store: f.store, inspection, now: f.now, executionActions: connectedExecutionActions("linux"), checkNative: async () => {} }); f.onCleanup(() => service.close());
  await assert.rejects(service.reviewScanner("personal", input(f)), /index.*tree|tree.*index/);
  assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0);
});

for (const drift of ["index", "worktree", "HEAD", "account", "selection"]) test(`automatic index preparation refuses ${drift} drift after witnessing without confirmation`, async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") }); let active = true;
  const inspection = { ...f.inspection, async indexInputs(...args) {
    const report = await f.inspection.indexInputs(...args);
    if (drift === "account") await f.store.update("personal", "synthetic-account-drift", s => { s.codingSessions[0].accountFingerprint = "b".repeat(64); });
    else if (drift === "selection") active = false;
    else { await writeFile(join(f.root, "task.txt"), "changed after witness\n"); if (drift !== "worktree") await f.run("add", "task.txt"); if (drift === "HEAD") await f.run("-c", "commit.gpgsign=false", "commit", "-m", "synthetic drift"); }
    return report;
  } };
  const service = createTaskAuthority({ store: f.store, inspection, now: f.now, executionActions: connectedExecutionActions("linux"), isActive: async () => active, checkNative: async () => {} }); f.onCleanup(() => service.close());
  await assert.rejects(service.reviewScanner("personal", input(f)), /changed|Select this workspace/);
  assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0);
});

test("combined current and staged file bounds refuse overflow before index bytes are read", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") }); let reads = 0;
  for (let i = 0; i < 254; i++) await writeFile(join(f.root, "u" + i), "small");
  const service = createTaskAuthority({ store: f.store, inspection: { ...f.inspection, async indexInputs() { reads++; throw Error("must not read"); } }, now: f.now, executionActions: connectedExecutionActions("linux"), checkNative: async () => {} }); f.onCleanup(() => service.close());
  await assert.rejects(service.reviewScanner("personal", input(f)), /256-file bound/); assert.equal(reads, 0);
  assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0);
});

test("automatic index preparation retains the smaller native Windows byte budget", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  for (const name of ["a.txt", "b.txt"]) await writeFile(join(f.root, name), "x".repeat(160 * 1024)); await f.run("add", "a.txt", "b.txt");
  if (process.platform === "win32") { await assert.rejects(f.service.reviewScanner("personal", input(f)), /Windows 320 KiB/); assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0); }
  else { const review = await f.service.reviewScanner("personal", input(f)); assert.ok(review.preparation.indexInputs.reduce((sum, row) => sum + row.size, 0) > 320 * 1024); }
});

for (const windows of [false, true]) test(`automatic index preparation composes with separately reviewed ${windows ? "Windows guest-double" : "Linux"} staged-only secret scanning`, { skip: !windows && process.platform !== "linux" }, async t => {
  const f = windows ? await windowsExecutionFixture(t, { action: "shield_codebase_audit", shield: true, clean: true, stagedIndex: true }) : await repositoryShieldFixture(t, { action: "shield_codebase_audit", clean: true, stagedIndex: true });
  await f.service.revoke("personal", f.proposed.authorityId);
  const before = await readFile(join(f.root, ".git/index")), worktree = await readFile(join(f.root, "app.js")), head = await f.run("rev-parse", "HEAD");
  const prepared = await f.service.reviewScanner("personal", input(f));
  const expected = f.sample.request.files.find(row => row.source?.kind === "git-index");
  assert.ok(expected); assert.deepEqual(prepared.preparation.indexInputs.find(row => row.source.path === "app.js"), expected);
  const grant = await f.service.issue("personal", { ...issueInput(prepared), token: prepared.confirmation.token }), proposal = { ...f.proposed, authorityId: grant.id };
  const review = await f.execution.review("personal", proposal), request = { requestId: proposal.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", request);
  assert.equal(result.status, "failed"); assert.ok(result.data.shieldReport.findings.some(row => row.path === ".switchyard-index/app.js")); assert.equal(result.data.shieldReport.completeness, "incomplete");
  assert.equal((await f.execution.apply("personal", request)).receiptId, result.receiptId);
  const state = await f.store.snapshot("personal");
  if (windows) { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
  else { assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
  assert.deepEqual(await readFile(join(f.root, ".git/index")), before); assert.deepEqual(await readFile(join(f.root, "app.js")), worktree); assert.equal(await f.run("rev-parse", "HEAD"), head);
});
