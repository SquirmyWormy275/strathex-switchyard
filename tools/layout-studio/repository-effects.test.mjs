import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { repositoryIdentity } from "./coding-task-identity.mjs";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { createRepositoryEffectCommands } from "./repository-effect-commands.mjs";
import { createRepositoryEffectCheckpoints } from "./repository-effect-checkpoints.mjs";
import { fixedGitExecutable } from "./repository-inspection.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
import { DurableMediatedExecutor } from "../../packages/control-plane/src/runtime.ts";
import { InMemoryGitBroker } from "../../packages/control-plane/src/brokers.ts";
import { GitCliInspector } from "../../packages/control-plane/src/git-inspector.ts";
import { TargetSnapshotFactory } from "../../packages/control-plane/src/snapshot.ts";
import { commandForAction } from "../../packages/control-plane/src/command-catalog.ts";
import { LocalMediatedGitHandler } from "../../apps/windows-companion/src/mediated-git.ts";
const exec = promisify(execFile);
async function fixture(t) {
  const stage = await mkdtemp(join(tmpdir(), "switchyard-effect-"));
  t.after(() => rm(stage, { recursive: true, force: true }));
  const root = await realpath(stage), keys = new Map(), store = createSuiteStore({ root: join(root, "private"), secrets: { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => { keys.set(`${c}:${p}`, v); } } });
  await store.initialize("personal"); await store.initialize("work", "work");
  await store.update("personal", "fixture", s => { s.mode = "personal-companion"; });
  return { root, store, journal: repositoryEffectJournal(store, "personal", { provider: "codex" }) };
}
test("suite effect journals use authenticated compartments, atomic rollback and a verified chain without plaintext files", async t => {
  const { root, store, journal } = await fixture(t);
  const entry = await journal.append("test.effect", { private: "synthetic-private-effect" });
  assert.equal(entry.sequence, 1); assert.equal(journal.hasAuthenticatedProtection, true); assert.equal(await journal.verifyChain(), true);
  await assert.rejects(journal.transaction(async tx => { await tx.append("test.rollback", { value: "never saved" }); throw new Error("Synthetic rollback"); }), /rollback/);
  assert.equal((await journal.readEntries()).length, 1);
  await assert.rejects(journal.append("test.invalid", { value: undefined }), /JSON/);
  assert.equal((await repositoryEffectJournal(store, "work").readEntries()).length, 0);
  assert.equal((await readFile(join(root, "private/personal.sealed.json"), "utf8")).includes("synthetic-private-effect"), false);
  await store.update("personal", "synthetic-corruption", s => { s.repositoryEffectJournal[0].payload.private = "changed"; });
  await assert.rejects(journal.readEntries(), /chain did not verify/);
});
test("repository effect admission rejects unsafe authors and absent cross-process leases before starting a process", async t => {
  const { root, store } = await fixture(t); let calls = 0;
  const service = createRepositoryEffectCommands({ store, stateDirectory: join(root, "effects"), command: async () => { calls++; throw new Error("Unexpected native process"); } });
  const options = { operationId: randomUUID(), bindingDigest: "a".repeat(64), authorize: async () => {}, task: { provider: "codex" }, author: { name: "Unsafe\nName", email: "synthetic@example.invalid" } };
  await assert.rejects(service.execute("personal", options, async () => {}), /author name/); assert.equal(calls, 0); await service.close();
  const noLease = createRepositoryEffectCommands({ store: { ...store, withResourceLock: undefined }, stateDirectory: join(root, "effects") });
  await assert.rejects(noLease.execute("personal", { ...options, author: { name: "Synthetic", email: "synthetic@example.invalid" } }, async () => {}), /resource lease/); await noLease.close();
});
test("the durable suite runtime commits exact binary bytes through independently stopped native Git guardians", { skip: process.platform !== "linux" ? "Native Linux guardian journey; native Windows transport has its own helper lane" : false }, async t => {
  const { root, store, journal } = await fixture(t), repositoryRoot = join(root, "repository"); await mkdir(repositoryRoot);
  const git = await fixedGitExecutable(), run = async (...args) => (await exec(git, args, { cwd: repositoryRoot, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
  await run("init", "-b", "main"); await run("config", "user.name", "Synthetic base"); await run("config", "user.email", "base@example.invalid");
  await writeFile(join(repositoryRoot, "task.bin"), "before"); await writeFile(join(repositoryRoot, "unowned.txt"), "keep"); await run("add", "."); await run("-c", "commit.gpgSign=false", "commit", "-m", "synthetic base");
  await run("remote", "add", "origin", "https://github.com/example/synthetic.git"); await run("update-ref", "refs/remotes/origin/main", "HEAD"); await run("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"); await run("switch", "-c", "feature/effect");
  const content = Buffer.from([0, 255, 128, 10, 13, 42]); await writeFile(join(repositoryRoot, "task.bin"), content); await writeFile(join(repositoryRoot, "unowned.txt"), "outside owned scope");
  const factory = new TargetSnapshotFactory(new GitCliInspector()), capture = () => factory.capture({ targetHint: repositoryRoot, policyVersion: "synthetic-native-effect/v1", environment: { toolVersions: { git: "native" } } });
  const target = await capture(), task = { id: randomUUID(), provider: "codex", repositoryRoot, repositoryIdentity: await repositoryIdentity(repositoryRoot) }, bindingDigest = createHash("sha256").update("synthetic-reviewed-effect").digest("hex"), stateDirectory = join(root, "effects");
  const service = createRepositoryEffectCommands({ store, stateDirectory }); t.after(() => service.close());
  let authorized = true, activeRequest;
  const checkpointPorts = createRepositoryEffectCheckpoints({ store, compartment: "personal", task, authorize: async () => { if (!authorized) throw new Error("Synthetic authority revoked"); } });
  const captureCheckpoint = checkpointPorts.checkpointCapture.capture;
  checkpointPorts.checkpointCapture.capture = async input => { try { return await captureCheckpoint(input); } catch (e) { t.diagnostic(e.stack); throw e; } };
  const runtime = new DurableMediatedExecutor({ store: journal, policyVersion: "synthetic-native-effect/v1", targetResolver: { resolve: capture },
    ...checkpointPorts,
    dependencies: context => { const git = new InMemoryGitBroker(context.policy); git.register("local_commit", request => { activeRequest = request; return service.execute("personal", { task, operationId: request.operationId, bindingDigest, author: { name: "Reviewed synthetic author", email: "reviewed@example.invalid" }, authorize: async () => { if (!authorized) throw new Error("Synthetic authority revoked"); } }, ports => new LocalMediatedGitHandler(ports).execute(request)); }); return { git, gitMutationFactory: { create: () => ({ kind: "local_commit", paths: ["task.bin"], message: "exact synthetic native commit" }) } }; }
  });
  const session = await runtime.sessions.register({ id: randomUUID(), provider: "generic", surface: "bridge", capabilities: ["registered", "mediated"], status: "running", workspaceRoot: repositoryRoot, targetSnapshotId: target.id, taskId: task.id, planRevision: "synthetic-plan", plannedFiles: ["task.bin"], adapterVersion: "suite-host-test", metadata: { meaning: "host repository broker context; no provider lifecycle claim" } });
  const authority = await runtime.authorities.issue({ repositoryRoot, sessionId: session.id, taskId: task.id, planRevision: session.planRevision, allowedActions: ["local_commit"], prohibitedActions: ["pr_upsert", "pr_merge", "run_target"], expiresAt: new Date(Date.now() + 300000).toISOString(), issuedBy: "synthetic-host-review" });
  const confirmation = await runtime.confirmations.issue({ action: "local_commit", targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id, reason: "Reviewed exact binary, paths, message and author", scopeDigest: bindingDigest, reauthenticated: false });
  const assignment = commandForAction("local_commit").assignment, request = { assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id, confirmationToken: confirmation.token, confirmationScopeDigest: bindingDigest };
  const outcome = await runtime.execute(request); assert.equal(outcome.status, "completed", JSON.stringify(outcome)); assert.equal(outcome.effectDisposition, "committed");
  assert.notEqual(await run("rev-parse", "HEAD"), target.head);
  const blob = await exec(git, ["show", "HEAD:task.bin"], { cwd: repositoryRoot, encoding: "buffer" }); assert.deepEqual(blob.stdout, content);
  assert.equal(await run("show", "HEAD:unowned.txt"), "keep"); assert.equal(await run("show", "-s", "--format=%an <%ae>"), "Reviewed synthetic author <reviewed@example.invalid>");
  assert.equal(await run("diff", "--cached", "--name-only"), ""); assert.equal(await readFile(join(repositoryRoot, "unowned.txt"), "utf8"), "outside owned scope");
  const record = (await store.snapshot("personal")).repositoryEffects[0]; assert.equal(record.status, "settled"); assert.equal(record.commands.length > 20, true); assert.equal(record.commands.every(c => c.stoppedVerified), true);
  for (const native of record.commands) assert.equal(await runtimeGuardianStopped(native.ownedRuntime), true);
  assert.equal(record.preservation.sharedIndex.originalIndexSha256.length, 64); assert.equal(record.commands.filter(c => c.referenceIntent).length, 1); assert.equal(record.commands.find(c => c.referenceIntent).referenceIntent.arguments.includes(target.head), true);
  const checkpoint = (await store.snapshot("personal")).repositoryEffectCheckpoints[0];
  assert.equal(checkpoint.recovery.indexSha256, record.preservation.sharedIndex.originalIndexSha256);
  const artifact = { reference: `suite-index-checkpoint:${record.id}` };
  assert.equal((await checkpointPorts.checkpointVerifier.verify(artifact)).available, true);
  await assert.rejects(access(record.scratch), { code: "ENOENT" }); await assert.rejects(access(join(repositoryRoot, ".git/index.lock")), { code: "ENOENT" });
  assert.equal((await runtime.execute(request)).status, "blocked");
  authorized = false; await assert.rejects(service.execute("personal", { task, operationId: randomUUID(), bindingDigest, author: record.author, authorize: async () => { throw new Error("Revoked"); } }, async () => {}), /revoked/i);
  assert.ok(activeRequest.childSaga); assert.ok((await journal.readEntries()).some(e => e.kind === "operation.updated")); assert.equal((await readFile(join(root, "private/personal.sealed.json"), "utf8")).includes("exact synthetic native commit"), false);
  await store.update("personal", "synthetic-checkpoint-corruption", s => { s.repositoryEffectCheckpoints[0].recovery.indexBase64 = "Y2hhbmdlZA=="; });
  assert.equal((await checkpointPorts.checkpointVerifier.verify(artifact)).available, false);
});
test("unknown native Git exit retains its protected scope across restart and blocks replacement without replay", async t => {
  const { root, store } = await fixture(t), repositoryRoot = join(root, "repository"); await mkdir(join(repositoryRoot, ".git"), { recursive: true });
  const task = { id: randomUUID(), provider: "codex", repositoryRoot, repositoryIdentity: await repositoryIdentity(repositoryRoot) }, operationId = randomUUID(), stateDirectory = join(root, "effects");
  let calls = 0, independentlyStopped = false;
  const command = async (_executable, _args, options) => {
    calls++; const scope = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: process.platform === "linux" ? "owned-linux-session" : "windows-job" };
    await options.onGuardianReady(scope);
    assert.equal((await store.snapshot("personal")).repositoryEffects[0].commands[0].stoppedVerified, false);
    return { status: "completed", exitCode: 0, stdout: "", inputDelivered: true, treeExitVerified: false };
  };
  const options = { task, operationId, bindingDigest: "a".repeat(64), author: { name: "Synthetic", email: "synthetic@example.invalid" }, authorize: async () => {} };
  const create = () => createRepositoryEffectCommands({ store, stateDirectory, command, resolveGit: async () => "/synthetic/git", guardianStopped: async () => independentlyStopped });
  const first = create();
  await assert.rejects(first.execute("personal", options, async ({ runner }) => runner.run(["rev-parse", "HEAD"], { cwd: repositoryRoot })), { code: "RUNTIME_STOP_UNCONFIRMED" });
  const record = (await store.snapshot("personal")).repositoryEffects[0]; assert.equal(record.status, "recovery-required"); assert.equal(record.commands[0].stoppedVerified, false); await access(record.scratch); await first.close();
  const resumed = create();
  await assert.rejects(resumed.execute("personal", { ...options, operationId: randomUUID() }, async () => {}), /not independently verified exit/); assert.equal(calls, 1);
  independentlyStopped = true;
  await assert.rejects(resumed.execute("personal", { ...options, operationId: randomUUID() }, async () => {}), /explicit no-replay reconciliation/); assert.equal(calls, 1);
  assert.equal((await store.snapshot("personal")).repositoryEffects[0].commands[0].stoppedVerified, true); await access(record.scratch); await resumed.close();
});
test("repository effect cancellation discards late command results and records independently verified exit", async t => {
  const { root, store } = await fixture(t), repositoryRoot = join(root, "repository"); await mkdir(join(repositoryRoot, ".git"), { recursive: true });
  const task = { id: randomUUID(), provider: "codex", repositoryRoot, repositoryIdentity: await repositoryIdentity(repositoryRoot) }, stateDirectory = join(root, "effects");
  let ready; const acknowledged = new Promise(resolve => { ready = resolve; });
  const command = async (_executable, _args, options) => {
    await options.onGuardianReady({ schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: process.platform === "linux" ? "owned-linux-session" : "windows-job" }); ready();
    await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener("abort", resolve, { once: true }); });
    return { status: "completed", exitCode: 0, stdout: "late result", inputDelivered: true, treeExitVerified: true };
  };
  const service = createRepositoryEffectCommands({ store, stateDirectory, command, resolveGit: async () => "/synthetic/git", guardianStopped: async () => true });
  const pending = service.execute("personal", { task, operationId: randomUUID(), bindingDigest: "a".repeat(64), author: { name: "Synthetic", email: "synthetic@example.invalid" }, authorize: async () => {} }, async ({ runner }) => runner.run(["rev-parse", "HEAD"], { cwd: repositoryRoot })).then(() => { throw new Error("Cancelled native output was accepted"); }, e => e);
  await acknowledged; assert.equal((await service.stopCompartment("personal")).stopped, true); assert.match((await pending).message, /stopped/);
  const record = (await store.snapshot("personal")).repositoryEffects[0]; assert.equal(record.status, "recovery-required"); assert.equal(record.commands[0].stoppedVerified, true); await service.close();
});
