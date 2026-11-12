import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { connectedExecutionActions } from "./repository-execution-actions.mjs";
import { createTaskAuthority } from "./task-authority.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";

const input = f => ({ taskId: f.task.id, action: "shield_codebase_audit", planRevision: "automatic-files-1" });
const issueInput = review => Object.fromEntries(["taskId", "planRevision", "paths", "classifications", "actions", "lifetimeMinutes"].map(key => [key, review.scope[key]]));

test("automatic scanner review binds complete current files and explicit generated-tree exclusions through authenticated HTTP", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") }), secret = "SYNTHETIC_PRIVATE_INPUT";
  await writeFile(join(f.root, ".gitignore"), "cache.txt\n.env\nnode_modules/\n");
  await writeFile(join(f.root, ".env"), secret); await writeFile(join(f.root, "new.js"), "synthetic source");
  await mkdir(join(f.root, "node_modules")); await writeFile(join(f.root, "node_modules/.env"), "excluded synthetic content");
  const before = await f.run("status", "--porcelain=v1", "--untracked-files=all"), index = await readFile(join(f.root, ".git/index")), head = await f.run("rev-parse", "HEAD");
  const suite = createSuite({ store: f.store, taskAuthority: f.service, agents: { close: async () => {} }, coding: { close: async () => {} } }); f.onCleanup(() => suite.close());
  const token = "R".repeat(43), server = createStudioServer({ suite, token, discover: async () => ({}) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); f.onCleanup(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`, api = (body, authenticated = true) => fetch(origin + "/api/suite/coding/authority/scanner-review", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await api(input(f), false)).status, 401); assert.equal(f.counters().calls, 0);
  const response = await api(input(f)), review = await response.json(); assert.equal(response.status, 200, JSON.stringify(review));
  assert.equal(review.status, "requires-confirmation"); assert.deepEqual(review.scope.paths, [".env", ".gitignore", "new.js", "task.txt"]);
  assert.deepEqual(review.scope.classifications, { includedUntracked: ["new.js"], excludedUntracked: [], includedIgnored: [".env"], excludedIgnored: [], excludedIgnoredTrees: ["node_modules"] });
  assert.equal(review.scope.targetSnapshot.completeness, "complete"); assert.equal(review.preparation.fileCount, 4); assert.equal(review.preparation.excludedTreeCount, 1);
  for (const field of ["scanPerformed", "authorityGranted", "securityCoverageComplete"]) assert.equal(review.preparation[field], false);
  assert.equal(JSON.stringify(review).includes(secret), false); assert.equal((await f.service.list("personal")).length, 0);
  const exact = issueInput(review); await assert.rejects(f.service.issue("personal", { ...exact, actions: ["local_commit"], token: review.confirmation.token }), /read-only inputs/);
  const grant = await f.service.issue("personal", { ...exact, token: review.confirmation.token });
  assert.equal((await f.service.resolve("personal", grant.id, "shield_codebase_audit")).files.ignored.find(row => row.path === ".env").classification, "included");
  await assert.rejects(f.service.issue("personal", { ...exact, token: review.confirmation.token }), /consum|used/);
  await assert.rejects(f.service.resolve("personal", grant.id, "run_target"));
  await writeFile(join(f.root, ".env"), "changed"); assert.equal((await f.service.revalidate("personal", grant.id)).allowed, false); await writeFile(join(f.root, ".env"), secret);
  assert.equal(await f.run("status", "--porcelain=v1", "--untracked-files=all"), before); assert.deepEqual(await readFile(join(f.root, ".git/index")), index); assert.equal(await f.run("rev-parse", "HEAD"), head);
  const state = await f.store.snapshot("personal"); assert.equal(state.repositoryExecutions?.length ?? 0, 0);
  for (const probe of state.repositoryProbes) { assert.equal(probe.stoppedVerified, true); assert.equal(probe.scratchCleanupPending, false); await assert.rejects(access(probe.scratch), { code: "ENOENT" }); }
});

test("automatic scanner review rejects imported choices before queries and leaves unknown ignored paths unclassified", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  for (const extra of [{ action: "run_target" }, { action: "local_commit" }, { paths: ["task.txt"] }, { classifications: {} }, { token: "imported" }, { approved: true }, { compartment: "work" }, { planRevision: "" }, { lifetimeMinutes: 61 }]) await assert.rejects(f.service.reviewScanner("personal", { ...input(f), ...extra }));
  assert.equal(f.counters().calls, 0);
  await writeFile(join(f.root, "cache.txt"), "unknown ignored content");
  await assert.rejects(f.service.reviewScanner("personal", input(f)), /explicit classification/);
  assert.equal((await f.service.list("personal")).length, 0); assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, 0);
  assert.equal(await readFile(join(f.root, "cache.txt"), "utf8"), "unknown ignored content");
});

test("automatic scanner review refuses file, revision or account drift between listing and witnessed capture", async t => {
  for (const fault of ["new-tracked-file", "account-drift", "revision-drift", "missing-tracked-file"]) {
    const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
    const inspection = { ...f.inspection, async scannerInputs(...args) {
      const report = await f.inspection.scannerInputs(...args);
      if (fault === "new-tracked-file") { await writeFile(join(f.root, "arrived.txt"), "newly tracked source"); await f.run("add", "arrived.txt"); }
      else if (fault === "revision-drift") await f.run("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Synthetic revision drift");
      else if (fault === "missing-tracked-file") await rm(join(f.root, "task.txt"));
      else await f.store.update("personal", "synthetic-account-drift", state => { state.accounts.push("different-account"); });
      return report;
    } };
    const service = createTaskAuthority({ store: f.store, inspection, now: f.now, executionActions: connectedExecutionActions("linux"), checkNative: async () => {} }); f.onCleanup(() => service.close());
    await assert.rejects(service.reviewScanner("personal", input(f)), /changed|scope|missing/);
    const state = await f.store.snapshot("personal"); assert.equal(state.taskAuthorities?.length ?? 0, 0); assert.equal(state.confirmationJournal?.length ?? 0, 0);
    assert.ok(state.repositoryProbes.every(probe => probe.stoppedVerified && !probe.scratchCleanupPending));
    if (fault === "new-tracked-file") assert.match(await f.run("ls-files", "--stage", "--", "arrived.txt"), /arrived.txt/);
  }
});

for (const platform of ["linux", "windows-guest-double"]) test(`automatic scanner authority composes with separately reviewed ${platform} execution and retains incomplete coverage`, { skip: platform === "linux" && process.platform !== "linux" }, async t => {
  const options = { action: "shield_codebase_audit", ignoredSecrets: true, ignoredBuildTree: true };
  const f = platform === "linux" ? await repositoryShieldFixture(t, options) : await windowsExecutionFixture(t, { ...options, shield: true });
  await f.service.revoke("personal", f.proposed.authorityId);
  const before = await f.run("status", "--porcelain=v1", "--untracked-files=all"), head = await f.run("rev-parse", "HEAD"), index = await readFile(join(f.root, ".git/index"));
  const reviewed = await f.service.reviewScanner("personal", input(f));
  assert.ok(reviewed.scope.paths.includes(".env")); assert.deepEqual(reviewed.scope.classifications.excludedIgnoredTrees, ["node_modules"]);
  const grant = await f.service.issue("personal", { ...issueInput(reviewed), token: reviewed.confirmation.token });
  const proposed = { ...f.proposed, authorityId: grant.id }, executionReview = await f.execution.review("personal", proposed);
  const effect = { requestId: proposed.requestId, token: executionReview.confirmation.token }, result = await f.execution.apply("personal", effect);
  assert.equal(result.status, "failed", JSON.stringify(result)); assert.ok(result.receiptId); assert.equal(result.providerTaskCompletionVerified, false);
  assert.ok(result.data.shieldReport.findings.some(finding => finding.path === ".env")); assert.equal(result.data.shieldReport.completeness, "incomplete");
  assert.equal(result.data.receiptEvidenceEnvelope.completeness, "incomplete"); assert.equal((await f.execution.apply("personal", effect)).receiptId, result.receiptId);
  const state = await f.store.snapshot("personal");
  if (platform === "linux") { assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutions[0].result.exitCode, 0); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
  else { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
  assert.equal(await f.run("status", "--porcelain=v1", "--untracked-files=all"), before); assert.equal(await f.run("rev-parse", "HEAD"), head); assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
});
