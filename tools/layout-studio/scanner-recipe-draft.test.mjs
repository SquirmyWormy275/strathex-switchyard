import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { scannerFixture } from "./test-support/shield-scanner-fixture.mjs";
import { createTaskAuthority } from "./task-authority.mjs";
import { createScannerFixtures } from "./scanner-fixtures.mjs";
import { createScannerAuthority, signScannerFixture } from "../../scripts/b122-scanner-fixture.mjs";
import { connectedExecutionActions } from "./repository-execution-actions.mjs";
import { createRepositoryExecution } from "./repository-execution.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const input = f => ({ taskId: f.task.id, action: "shield_codebase_audit", planRevision: "draft-1", scannerFixtureId: "synthetic-scanner", advisoryFixtureId: "synthetic-advisory" });
async function fixture(t, overrides = {}) {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  const feeds = createScannerFixtures({ store: f.store, stateDirectory: join(f.stage, "feeds"), now: f.now }); f.onCleanup(() => feeds.close());
  const perform = async (action, body) => { const r = await feeds.review("personal", { requestId: randomUUID(), action, ...body }); const result = await feeds.apply("personal", { requestId: r.review.requestId, token: r.confirmation.token }); assert.equal(result.status, "completed"); };
  const signing = await createScannerAuthority({ outputDirectory: join(f.stage, "signing"), authorityId: "draft-test", allowedKinds: ["scanner", "advisory"], expiresAt: new Date(f.now() + 86400000).toISOString() });
  await perform("install-trust", { policy: JSON.parse(await readFile(signing.trustPolicyPath, "utf8")) });
  const sample = scannerFixture({ advisory: [] });
  for (const [kind, feed] of [["scanner", sample.request.scanner], ["advisory", sample.request.advisory]]) {
    const contentPath = join(f.stage, kind + ".json"); await writeFile(contentPath, sample.content.get(feed.path));
    const outputDirectory = join(f.stage, kind + "-signed");
    await signScannerFixture({ ...signing, contentPath, outputDirectory, id: feed.id, kind, feedVersion: "synthetic-v1", toolName: "switchyard-baseline-scanner", toolVersion: "1", generatedAt: new Date(f.now() - 1000).toISOString(), expiresAt: new Date(f.now() + 3600000).toISOString(), maximumAgeSeconds: 7200 });
    await perform("install-fixture", { manifestPath: join(outputDirectory, "manifest.json") });
  }
  const service = createTaskAuthority({ store: f.store, inspection: f.inspection, now: f.now, executionActions: connectedExecutionActions("linux"), checkNative: async () => {}, readScannerSources: (c, i) => feeds.readSources(c, i), resolveScannerFixtures: (c, i) => feeds.resolve(c, i), ...overrides });
  f.onCleanup(() => service.close());
  return { ...f, feeds, perform, service };
}

test("authenticated draft assembly returns exact generated controls without source text, repository writes or approval", async t => {
  const f = await fixture(t), secret = "PRIVATE_SOURCE_MUST_NOT_LEAVE_DRAFT_PREPARATION";
  await writeFile(join(f.root, "task.txt"), secret);
  const before = { index: await readFile(join(f.root, ".git/index")), head: await f.run("rev-parse", "HEAD"), names: await readdir(f.root), journal: (await f.store.snapshot("personal")).confirmationJournal?.length ?? 0 };
  // Exercise the normal Suite factory wiring with a controlled native identity port.
  let service;
  const suite = createSuite({ store: f.store, fixtureAdministration: f.feeds, agents: { close: async () => {} }, coding: { status: async () => ({}), close: async () => {} }, taskAuthorityFactory: options => (service = createTaskAuthority({ ...options, inspection: f.inspection, now: f.now })) }); f.onCleanup(() => suite.close());
  const token = "D".repeat(43), server = createStudioServer({ suite, token, discover: async () => ({}) }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); f.onCleanup(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`, call = auth => fetch(origin + "/api/suite/coding/authority/scanner-draft", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input(f)) });
  assert.equal((await call(false)).status, 401); const response = await call(true), draft = await response.json(); assert.equal(response.status, 200, JSON.stringify(draft));
  assert.equal(draft.status, "draft"); assert.equal(draft.files.length, 5); assert.equal(JSON.stringify(draft).includes(secret), false);
  assert.deepEqual(draft.feeds.map(feed => [feed.id, feed.kind, feed.feedVersion]), [["synthetic-scanner", "scanner", "synthetic-v1"], ["synthetic-advisory", "advisory", "synthetic-v1"]]);
  assert.ok(draft.feeds.every(feed => /^[a-f0-9]{64}$/.test(feed.manifestSha256) && Date.parse(feed.expiresAt) > f.now() && !Object.hasOwn(feed, "packageRoot")));
  for (const key of ["sourceBytesReturned", "filesWritten", "authorityGranted", "scanPerformed", "securityCoverageComplete"]) assert.equal(draft[key], false);
  for (const file of draft.files) { assert.equal(sha(Buffer.from(file.content)), file.sha256); assert.equal(Buffer.byteLength(file.content), file.size); }
  assert.equal(draft.files.find(file => file.path.endsWith("/engine.mjs")).content, await readFile(new URL("./shield-scanner-engine.mjs", import.meta.url), "utf8"));
  assert.deepEqual(draft.request.files.map(file => file.path), [".gitignore", "task.txt"]); assert.deepEqual(draft.recipe.args, [draft.directory + "/engine.mjs", draft.directory + "/request.json"]);
  assert.deepEqual(draft.recipe.environment, { NODE_ENV: "test" }); assert.equal(draft.recipe.workspaceMode, "read-only");
  assert.equal((await service.list("personal")).length, 0); assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length ?? 0, before.journal);
  assert.deepEqual(await readFile(join(f.root, ".git/index")), before.index); assert.equal(await f.run("rev-parse", "HEAD"), before.head); assert.deepEqual(await readdir(f.root), before.names); assert.equal(await readFile(join(f.root, "task.txt"), "utf8"), secret);
});

test("draft selection rejects malformed feeds, commands and approvals before native inspection", async t => {
  const f = await fixture(t), before = f.counters().calls;
  for (const extra of [{ scannerFixtureId: "../outside" }, { advisoryFixtureId: null }, { advisoryFixtureId: "synthetic-scanner" }, { executable: "sh" }, { args: [] }, { approved: true }, { paths: ["task.txt"] }, { compartment: "work" }, { includeIndex: true, historyDepth: 2 }]) await assert.rejects(f.service.prepareScannerDraft("personal", { ...input(f), ...extra }));
  assert.equal(f.counters().calls, before);
});

for (const change of ["worktree", "index", "account", "feed-revocation", "feed-expiry"]) test(`draft assembly refuses ${change} drift after its original witnesses`, async t => {
  const f = await fixture(t); let borrowed;
  const service = createTaskAuthority({ store: f.store, inspection: f.inspection, now: f.now, executionActions: connectedExecutionActions("linux"), checkNative: async () => {}, resolveScannerFixtures: (c, i) => f.feeds.resolve(c, i), readScannerSources: async (c, i) => {
    borrowed = await f.feeds.readSources(c, i);
    if (change === "worktree") await writeFile(join(f.root, "task.txt"), "changed after witnessing");
    if (change === "index") await f.run("add", "task.txt");
    if (change === "account") await f.store.update("personal", "synthetic-account", s => { s.accounts.push("changed"); });
    if (change === "feed-revocation") await f.perform("revoke-fixture", { fixtureId: "synthetic-scanner", reason: "Synthetic draft revocation" });
    if (change === "feed-expiry") f.advance(3600001);
    return borrowed;
  } }); f.onCleanup(() => service.close());
  await assert.rejects(service.prepareScannerDraft("personal", input(f)), /changed|not actively installed|expired|freshness/);
  assert.ok(borrowed.every(item => item.bytes.every(byte => byte === 0))); assert.equal((await service.list("personal")).length, 0);
});

test("draft assembly supports scanner-only feeds and refuses source files outside the scanner byte bound", async t => {
  const f = await fixture(t), { advisoryFixtureId, ...selection } = input(f), draft = await f.service.prepareScannerDraft("personal", selection);
  assert.equal(draft.request.advisory, null); assert.equal(draft.files.length, 4);
  await writeFile(join(f.root, "task.txt"), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  await assert.rejects(f.service.prepareScannerDraft("personal", selection), /bounded digest|exceeds/);
  assert.equal((await f.service.list("personal")).length, 0);
});

test("generated controls count toward the existing authority and recipe limits", async t => {
  const f = await fixture(t);
  for (let n = 0; n < 250; n++) await writeFile(join(f.root, `file-${n}.txt`), "");
  await assert.rejects(f.service.prepareScannerDraft("personal", input(f)), /manifest or authority bound/);
  assert.equal((await f.service.list("personal")).length, 0);
});

test("drafts refuse an input whose directory depth cannot enter the execution boundary", async t => {
  const f = await fixture(t), directory = Array.from({ length: 32 }, () => "d").join("/");
  await mkdir(join(f.root, directory), { recursive: true }); await writeFile(join(f.root, directory, "file.txt"), "small but too deep");
  await assert.rejects(f.service.prepareScannerDraft("personal", input(f)), /directory-depth bound/);
  assert.equal((await f.service.list("personal")).length, 0);
});

test("draft assembly retains bounded staged and historical source descriptors independently", async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, "task.txt"), "staged only"); await f.run("add", "task.txt"); await writeFile(join(f.root, "task.txt"), "current only");
  const staged = await f.service.prepareScannerDraft("personal", { ...input(f), includeIndex: true });
  assert.equal(staged.request.files.filter(file => file.source?.kind === "git-index").length, 2);
  const historical = await f.service.prepareScannerDraft("personal", { ...input(f), historyDepth: 2 });
  assert.equal(historical.request.files.filter(file => file.source?.kind === "git-history").length, 2); assert.equal(historical.preparation.historyStopping.kind, "root");
  assert.equal(staged.request.files.find(file => file.path === "task.txt").sha256, sha(Buffer.from("current only")));
  assert.equal(staged.request.files.find(file => file.source?.path === "task.txt").sha256, sha(Buffer.from("staged only")));
});

test("materialized draft requires fresh authority and execution review before an actual Linux scan", { skip: process.platform === "win32" }, async t => {
  const f = await fixture(t); await writeFile(join(f.root, "task.txt"), "-----BEGIN PRIVATE KEY-----\nSYNTHETIC_DRAFT_ONLY_SECRET");
  const index = await readFile(join(f.root, ".git/index")), head = await f.run("rev-parse", "HEAD"), draft = await f.service.prepareScannerDraft("personal", input(f));
  await assert.rejects(f.service.review("personal", draft.authorityProposal), /task-owned|classification/);
  await mkdir(join(f.root, draft.directory)); for (const file of draft.files) await writeFile(join(f.root, file.path), file.content, { flag: "wx", mode: 0o600 });
  const review = await f.service.review("personal", draft.authorityProposal), grant = await f.service.issue("personal", { ...draft.authorityProposal, token: review.confirmation.token });
  const execution = createRepositoryExecution({ store: f.store, authority: f.service, stateDirectory: join(f.stage, "execution"), resolveScannerFixtures: (c, i) => f.feeds.resolve(c, i) }); f.onCleanup(() => execution.close());
  const proposal = { requestId: randomUUID(), authorityId: grant.id, manifestPath: draft.manifestPath, manifestSha256: draft.manifestSha256, action: draft.action }, ready = await execution.review("personal", proposal), request = { requestId: proposal.requestId, token: ready.confirmation.token }, result = await execution.apply("personal", request);
  assert.equal(result.status, "failed", JSON.stringify(result)); assert.ok(result.data.shieldReport.findings.some(row => row.path === "task.txt" && row.ruleId === "secret.private-key")); assert.equal(result.data.shieldReport.completeness, "incomplete"); assert.equal((await execution.apply("personal", request)).receiptId, result.receiptId);
  assert.deepEqual(await readFile(join(f.root, ".git/index")), index); assert.equal(await f.run("rev-parse", "HEAD"), head);
  const state = await f.store.snapshot("personal");
  assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true);
  for (const row of state.repositoryExecutionStaging) { assert.equal(row.cleanupPending, false); await assert.rejects(access(row.path), { code: "ENOENT" }); }
});
