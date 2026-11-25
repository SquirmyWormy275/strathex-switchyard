import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, access, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { repositoryIdentity } from "./coding-task-identity.mjs";
import { createRepositoryEffectRecovery } from "./repository-effect-recovery.mjs";
import { OwnedGitIndexLease, createOwnedGitFileLock, captureGitFile } from "../../apps/windows-companion/src/git-index-lease.ts";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { createRepositoryCommits } from "./repository-commits.mjs";
import { createRepositoryEffectCommands } from "./repository-effect-commands.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { OperationSagaStore } from "../../packages/control-plane/src/operations.ts";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { DurableBudgetManager } from "../../packages/control-plane/src/budgets.ts";
async function fixture(t) {
  const stage = await realpath(await mkdtemp(join(tmpdir(), "switchyard-recovery-"))), root = join(stage, "repository"), gitDirectory = join(root, ".git"), stateDirectory = join(stage, "effects"), id = randomUUID(), keys = new Map();
  const store = createSuiteStore({ root: join(stage, "private"), secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => { keys.set(c+p,v); } } }); await store.initialize("personal");
  await mkdir(gitDirectory, { recursive: true }); const indexPath = join(gitDirectory, "index"); await writeFile(indexPath, "original index");
  const operationDirectory = join(stateDirectory, "git-operations", createHash("sha256").update(id).digest("hex")); await mkdir(operationDirectory, { recursive: true }); await mkdir(join(stateDirectory, "git-locks"));
  const worktree = await createOwnedGitFileLock(join(stateDirectory, "git-locks", "fixture.lock"), "owned worktree lease"); await worktree.abandon();
  const lease = await OwnedGitIndexLease.acquire(indexPath), copy = join(operationDirectory, "copy"); await lease.copyOriginalTo(copy); const sharedIndex = lease.preservation(); await lease.abandon();
  const privateIndex = join(operationDirectory, "private"); await writeFile(privateIndex, "intended index");
  const proof = async path => { const p = await captureGitFile(path); p.bytes.fill(0); return { identity: p.identity, sha256: p.sha256 }; };
  const task = { id: randomUUID(), provider: "codex", repositoryRoot: root, repositoryIdentity: await repositoryIdentity(root) }, oldHead = "a".repeat(40), newHead = "b".repeat(40), tree = "c".repeat(40);
  const metadata = { root, gitDirectory, indexPath, branch: "feature/recovery", head: newHead, headTree: tree };
  const record = { schema: "switchyard-repository-effect/v1", id, taskId: task.id, provider: task.provider, repositoryRoot: root, repositoryIdentity: task.repositoryIdentity, gitDirectory, gitIdentity: await repositoryIdentity(gitDirectory), bindingDigest: "d".repeat(64), status: "recovery-required", outcome: { status: "incomplete", effectDisposition: "ambiguous" }, commands: [{ ownedRuntime: { id: randomUUID() }, stoppedVerified: true, referenceIntent: { arguments: ["update-ref", "--create-reflog", "-m", "Switchyard scoped local commit", "refs/heads/feature/recovery", newHead, oldHead] } }], preservation: { operationId: id, repositoryRoot: root, beforeHead: oldHead, beforeBranch: metadata.branch, expectedTree: tree, sharedIndex, worktreeLock: { path: worktree.filePath, identity: worktree.identity, contentSha256: worktree.contentSha256 }, privateIndex, privateIndexProof: await proof(privateIndex), privateIndexCopy: copy, privateIndexCopyProof: await proof(copy) } };
  await store.update("personal", "fixture", s => { s.mode = "personal-companion"; s.repositoryEffects = [record]; });
  let stopped = true, calls = 0, time = Date.now(), duringObserve;
  const inspection = { observe: async () => { calls++; await duringObserve?.(calls); return structuredClone(metadata); }, stopCompartment: async () => ({ stopped: true }), close: async () => {} };
  const recovery = createRepositoryEffectRecovery({ store, stateDirectory, inspection, guardianStopped: async () => stopped, now: () => time });
  t.after(async () => { await recovery.close(); await rm(stage, { recursive: true, force: true }); });
  return { store, root, stage, id, record, indexPath, privateIndex, copy, metadata, recovery, setStopped: v => { stopped = v; }, calls: () => calls, advance: n => { time += n; }, duringObserve: fn => { duringObserve = fn; } };
}
const request = (f, review) => ({ id: f.id, reviewId: review.review.id, token: review.confirmation.token });
test("recovery approval binds observed bytes and workspace, rejects broader fields, expired tokens and unknown native owners", async t => {
  const f = await fixture(t);
  await assert.rejects(f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true, force: true }), /exact retained/);
  f.setStopped(false); await assert.rejects(f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true }), /independently verified/); assert.equal(f.calls(), 0); f.setStopped(true);
  const review = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true });
  await assert.rejects(f.recovery.apply("personal", { ...request(f, review), token: randomUUID() }), /does not match/);
  f.advance(300001); await assert.rejects(f.recovery.apply("personal", request(f, review)), /expired/);
  const fresh = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true });
  await f.store.update("personal", "changed-account", s => { s.taskAuthorityEpoch = 1; }); await assert.rejects(f.recovery.apply("personal", request(f, fresh)), /scope changed/);
  const bytes = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true }); await writeFile(f.privateIndex, "foreign edit");
  await assert.rejects(f.recovery.apply("personal", request(f, bytes)), /scope changed/); assert.equal(await readFile(f.indexPath, "utf8"), "original index"); assert.equal(await readFile(f.privateIndex, "utf8"), "foreign edit");
});
test("approved recovery reconciles only exact owned metadata, retains the original outcome, and duplicate approval cannot rewrite it", async t => {
  const f = await fixture(t), review = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true });
  const result = await f.recovery.apply("personal", request(f, review)); assert.equal(result.status, "completed"); assert.equal(result.referenceMutationReplayed, false); assert.equal(result.originalOutcomeUnchanged, true);
  assert.equal(await readFile(f.indexPath, "utf8"), "intended index"); await assert.rejects(access(f.indexPath + ".lock"), { code: "ENOENT" }); await assert.rejects(access(f.record.preservation.worktreeLock.path), { code: "ENOENT" }); await assert.rejects(access(f.privateIndex), { code: "ENOENT" });
  const state = await f.store.snapshot("personal"); assert.deepEqual(state.repositoryEffects[0].outcome, f.record.outcome); assert.equal(state.repositoryEffects[0].status, "settled");
  const journal = repositoryEffectJournal(f.store, "personal", { domain: "recovery" }); const receipts = await new ReceiptLedger(journal).list(); assert.equal(receipts.length, 1); assert.equal(receipts[0].action, "repository_recovery");
  const duplicate = await f.recovery.apply("personal", request(f, review)); assert.equal(duplicate.replayed, true); assert.equal(duplicate.receiptId, result.receiptId); assert.equal((await new ReceiptLedger(journal).list()).length, 1);
});
test("interrupted index recovery is observed without replay and a fresh approval preserves unfamiliar private files", async t => {
  const f = await fixture(t), review = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true }), original = f.store.update;
  let fail = true; f.store.update = async (...args) => { if (fail && args[1] === "repository-recovery-readback") { fail = false; throw new Error("Synthetic crash after index replacement"); } return original(...args); };
  await assert.rejects(f.recovery.apply("personal", request(f, review)), /Synthetic crash/); assert.equal(await readFile(f.indexPath, "utf8"), "intended index"); await access(f.record.preservation.worktreeLock.path);
  const replay = await f.recovery.apply("personal", request(f, review)); assert.equal(replay.replayed, true); assert.equal(replay.status, "incomplete");
  await writeFile(join(f.stage, "effects", "git-operations", createHash("sha256").update(f.id).digest("hex"), "unfamiliar"), "preserve me");
  const fresh = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true }); assert.equal(fresh.review.observation.recommendation, "review-owned-cleanup");
  const result = await f.recovery.apply("personal", request(f, fresh)); assert.equal(result.cleanupPending, true); assert.equal(result.status, "incomplete"); assert.equal(await readFile(join(f.stage, "effects", "git-operations", createHash("sha256").update(f.id).digest("hex"), "unfamiliar"), "utf8"), "preserve me");
});
test("a reference change at the final recovery boundary preserves the original index and owned leases", async t => {
  const f = await fixture(t), review = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true });
  f.duringObserve(n => { if (n === 3) f.metadata.head = "e".repeat(40); });
  await assert.rejects(f.recovery.apply("personal", request(f, review)), /references changed/); assert.equal(await readFile(f.indexPath, "utf8"), "original index"); await access(f.indexPath + ".lock"); await access(f.record.preservation.worktreeLock.path);
});
test("private staging cleanup is opt-in and a lost final state write requires fresh approval without another index write", async t => {
  const f = await fixture(t), first = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: false });
  const result = await f.recovery.apply("personal", request(f, first)); assert.equal(result.cleanupPending, true); await access(f.privateIndex);
  const before = await captureGitFile(f.indexPath); before.bytes.fill(0);
  const next = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true }), original = f.store.update; let fail = true;
  f.store.update = async (...args) => { if (fail && args[1] === "repository-recovery-result") { fail = false; throw new Error("Synthetic lost final recovery state"); } return original(...args); };
  await assert.rejects(f.recovery.apply("personal", request(f, next)), /lost final/);
  const fresh = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true });
  const final = await f.recovery.apply("personal", request(f, fresh)); assert.equal(final.status, "completed");
  const after = await captureGitFile(f.indexPath); after.bytes.fill(0); assert.deepEqual(after.identity, before.identity); assert.deepEqual(after.stamp, before.stamp); assert.equal(after.sha256, before.sha256);
});
test("workspace stop waits for the in-flight recovery boundary and an older generation cannot replace the index", async t => {
  const f = await fixture(t), review = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true });
  let entered, release; const ready = new Promise(r => { entered = r; }), hold = new Promise(r => { release = r; });
  f.duringObserve(async n => { if (n === 3) { entered(); await hold; } });
  const apply = f.recovery.apply("personal", request(f, review)).then(() => { throw new Error("Stopped recovery succeeded"); }, e => e);
  await ready; const stopped = f.recovery.stopCompartment("personal"); release(); assert.match((await apply).message, /stopped/); assert.equal((await stopped).stopped, true);
  assert.equal(await readFile(f.indexPath, "utf8"), "original index"); await access(f.indexPath + ".lock");
});
test("the recovery execution deadline is enforced before filesystem effects and retained evidence can be freshly reviewed", async t => {
  const f = await fixture(t), review = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true });
  f.duringObserve(n => { if (n === 3) f.advance(120001); });
  await assert.rejects(f.recovery.apply("personal", request(f, review)), /deadline expired/); assert.equal(await readFile(f.indexPath, "utf8"), "original index"); await access(f.indexPath + ".lock");
  const fresh = await f.recovery.review("personal", { id: f.id, cleanupPrivateStaging: true }); assert.equal((await f.recovery.apply("personal", request(f, fresh))).status, "completed");
});
test("native post-reference failure recovers its exact index and child saga without another commit or a passing original receipt", { skip: process.platform !== "linux" ? "Native Linux fault-recovery journey; portable owned-file boundaries run on both platforms" : false }, async t => {
  const f = await authorityFixture(t), stateDirectory = join(f.stage, "effects"); let referenceUpdated = false, injected = false;
  const commands = createRepositoryEffectCommands({ store: f.store, stateDirectory, command: async (exe, args, options) => {
    const r = await runRuntimeCommand(exe, args, options);
    if (args.includes("update-ref") && r.exitCode === 0) referenceUpdated = true;
    else if (referenceUpdated && !injected && args.at(-2) === "rev-parse" && args.at(-1) === "HEAD") { injected = true; throw new Error("Synthetic lost readback after actual reference update"); }
    return r;
  } });
  const commits = createRepositoryCommits({ store: f.store, authority: f.service, stateDirectory, commands, now: f.now }), recovery = createRepositoryEffectRecovery({ store: f.store, stateDirectory });
  f.onCleanup(() => commits.close()); f.onCleanup(() => recovery.close());
  const a = await f.service.review("personal", f.proposed), grant = await f.service.issue("personal", { ...f.proposed, token: a.confirmation.token });
  const p = { requestId: randomUUID(), authorityId: grant.id, message: "Native recovery fault fixture", author: { name: "Synthetic", email: "synthetic@example.invalid" } }, review = await commits.review("personal", p), before = await f.run("rev-parse", "HEAD");
  const outcome = await commits.execute("personal", { requestId: p.requestId, token: review.confirmation.token }); assert.equal(injected, true); assert.equal(outcome.effectDisposition, "ambiguous", JSON.stringify(outcome));
  const head = await f.run("rev-parse", "HEAD"); assert.notEqual(head, before); const id = outcome.operationId, state = await f.store.snapshot("personal"), effect = state.repositoryEffects.find(r => r.id === id); assert.equal(effect.status, "recovery-required");
  for (const c of effect.commands) assert.equal(await runtimeGuardianStopped(c.ownedRuntime), true);
  const journal = repositoryEffectJournal(f.store, "personal"), originalReceipts = await new ReceiptLedger(journal).list(), operations = new OperationSagaStore(journal), unrelated = await operations.begin({ idempotencyKey: randomUUID(), action: "unrelated", targetSnapshotId: "unrelated" }); await operations.advance(unrelated.operation.id, "executing");
  const approved = await recovery.review("personal", { id, cleanupPrivateStaging: true }); assert.equal(approved.review.observation.recommendation, "review-index-reconciliation");
  const result = await recovery.apply("personal", { id, reviewId: approved.review.id, token: approved.confirmation.token }); assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(await f.run("rev-parse", "HEAD"), head); assert.equal(await f.run("diff", "--cached", "--name-only"), ""); assert.equal(await f.run("rev-list", "--count", "HEAD"), "2\n");
  assert.deepEqual(await new ReceiptLedger(journal).list(), originalReceipts); assert.equal((await operations.get(unrelated.operation.id)).state, "executing");
  const root = await operations.get(id); assert.equal(["recorded", "failed", "cancelled"].includes(root.state), true); assert.notEqual(root.details.commandStatus, "completed");
  assert.equal((await new DurableBudgetManager(journal).list()).filter(c => c.operationId === id && ["running", "claimed", "cancelling", "timed_out"].includes(c.state)).length, 0);
  assert.deepEqual((await f.store.snapshot("personal")).repositoryEffects.find(r => r.id === id).outcome, effect.outcome);
});
