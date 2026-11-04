import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryGitBroker, type EffectGuard } from "../../../packages/control-plane/src/brokers.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { InMemoryContainmentManager } from "../../../packages/control-plane/src/containment.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { GitCliInspector } from "../../../packages/control-plane/src/git-inspector.ts";
import { PolicyEngine } from "../../../packages/control-plane/src/policy.ts";
import { TargetSnapshotFactory, type SnapshotCaptureOptions } from "../../../packages/control-plane/src/snapshot.ts";
import { LocalMediatedGitHandler, SpawnLocalGitRunner, type LocalGitRunner } from "../src/mediated-git.ts";
import type { ChildOperationLease, ChildOperationOutcome, ChildOperationSaga, ChildOperationStart } from "../../../packages/control-plane/src/operations.ts";

class RecordingChildSaga implements ChildOperationSaga {
  readonly events: Array<Readonly<{ kind: string; value?: unknown }>> = [];
  async begin(input: ChildOperationStart): Promise<ChildOperationLease> { this.events.push({ kind: "begin", value: input }); return { operationId: "local-child", parentOperationId: "operation-safe", action: input.action, targetSnapshotId: "target", existing: false, state: "prepared", mayExecute: true }; }
  async markExecuting(lease: ChildOperationLease) { this.events.push({ kind: "executing", value: lease.operationId }); }
  async markExternalCommitted(_lease: ChildOperationLease, details?: Readonly<Record<string, string>>) { this.events.push({ kind: "external", value: details }); }
  async markCancelling() { throw new Error("not used"); }
  async markCompensating() { throw new Error("not used"); }
  async settle(_lease: ChildOperationLease, outcome: ChildOperationOutcome, details?: Readonly<Record<string, string>>) { this.events.push({ kind: `settle:${outcome}`, value: details }); }
}

async function command(cwd: string, ...args: string[]): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string; readonly stdoutBytes: Buffer }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(args[0]!, args.slice(1), { cwd, shell: false, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (value: Buffer) => stdout.push(value));
    child.stderr.on("data", (value: Buffer) => stderr.push(value));
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stdoutBytes: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}

async function requireCommand(cwd: string, ...args: string[]): Promise<string> {
  const result = await command(cwd, ...args);
  if (result.code !== 0) throw new Error(`${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

interface Fixture {
  readonly root: string;
  readonly state: string;
  readonly captureOptions: SnapshotCaptureOptions;
  readonly factory: TargetSnapshotFactory;
  capture(): Promise<TargetSnapshot>;
  dispose(): Promise<void>;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-mediated-git-"));
  const state = await mkdtemp(join(tmpdir(), "sxsy-b122-mediated-state-"));
  const remote = await mkdtemp(join(tmpdir(), "sxsy-b122-mediated-remote-"));
  await requireCommand(root, "git", "init");
  await requireCommand(root, "git", "config", "user.email", "tests@example.invalid");
  await requireCommand(root, "git", "config", "user.name", "SXSY isolated test");
  await writeFile(join(root, "src-safe.ts"), "export const value = 'initial';\n", "utf8");
  await requireCommand(root, "git", "add", "src-safe.ts");
  await requireCommand(root, "git", "commit", "-m", "initial");
  await requireCommand(root, "git", "branch", "-M", "main");
  await requireCommand(remote, "git", "init", "--bare");
  await requireCommand(remote, "git", "symbolic-ref", "HEAD", "refs/heads/main");
  await requireCommand(root, "git", "remote", "add", "origin", remote);
  await requireCommand(root, "git", "push", "-u", "origin", "main");
  await requireCommand(root, "git", "remote", "set-head", "origin", "-a");
  await requireCommand(root, "git", "checkout", "-b", "feature/mediated-git");
  await requireCommand(root, "git", "push", "-u", "origin", "feature/mediated-git");
  const factory = new TargetSnapshotFactory(new GitCliInspector({
    classifyUntracked: () => "included",
    classifyIgnored: () => "excluded"
  }));
  const captureOptions: SnapshotCaptureOptions = {
    targetHint: root,
    policyVersion: "isolated-mediated-git-v1",
    environment: { toolVersions: { git: "isolated-test" } },
    requireCanonicalRemote: true,
    requireBranch: true
  };
  return {
    root,
    state,
    factory,
    captureOptions,
    capture: () => factory.capture(captureOptions),
    dispose: async () => {
      // Git for Windows can briefly retain a directory handle after its child
      // process exits.  These are test-owned mkdtemp paths; retrying keeps
      // cleanup isolated without ever touching a user worktree.
      await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
      await rm(state, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
      await rm(remote, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
    }
  };
}

function effectGuard(fixture: Fixture, policy: "current" | "fail-final" = "current"): EffectGuard {
  let calls = 0;
  return {
    assertCurrent: async ({ target }) => {
      calls += 1;
      if (policy === "fail-final" && calls >= 4) return { allowed: false, reason: "Synthetic final target change." };
      const result = await fixture.factory.revalidate(target, fixture.captureOptions);
      return result.current
        ? { allowed: true, reason: "Isolated snapshot remains current." }
        : { allowed: false, reason: "Isolated snapshot changed." };
    }
  };
}

function session(target: TargetSnapshot): ManagedSession {
  return {
    id: "managed-session", provider: "generic", surface: "vscode_terminal",
    capabilities: ["registered", "observable", "controllable", "mediated"], status: "running",
    workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-safe", planRevision: "plan-safe",
    plannedFiles: ["src-safe.ts"], lastHeartbeat: new Date().toISOString(), adapterVersion: "isolated", metadata: {}
  };
}

function grant(target: TargetSnapshot): AuthorityGrant {
  return {
    id: "authority-safe", repositoryRoot: target.repositoryRoot, sessionId: "managed-session", taskId: "task-safe", planRevision: "plan-safe",
    allowedActions: ["local_commit"], prohibitedActions: [], issuedAt: "2026-08-23T12:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z", issuedBy: "isolated-review"
  };
}

function permittedRequest(target: TargetSnapshot, guard: EffectGuard, ownedPaths: readonly string[] = ["src-safe.ts"]) {
  const definition = commandForAction("local_commit");
  const selected = { ...session(target), plannedFiles: ownedPaths };
  const authority = grant(target);
  const policy = new PolicyEngine({ version: "isolated-mediated-git-v1" });
  const confirmation = policy.createConfirmation({
    action: definition.action, targetSnapshotId: target.id, sessionId: selected.id, authorityId: authority.id,
    reason: "isolated reviewed local commit", reauthenticated: true
  });
  const permit = policy.issuePermit({ definition, target, session: selected, authority, operationId: "operation-safe", confirmationToken: confirmation.token }).permit;
  assert.ok(permit);
  return {
    policy,
    request: {
      action: "local_commit" as const,
      operationId: "operation-safe",
      target,
      session: selected,
      authority,
      permit,
      effectGuard: guard,
      mutation: { kind: "local_commit" as const, paths: ownedPaths, message: "reviewed isolated change" }
    }
  };
}

test("mediated local commit uses an exact task-owned private index and reconciles the shared index to its committed tree", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "export const value = 'reviewed';\n", "utf8");
    const target = await isolated.capture();
    assert.equal(target.completeness, "complete", target.reasons.join(" "));
    const { policy, request } = permittedRequest(target, effectGuard(isolated));
    const broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", (input) => new LocalMediatedGitHandler({ stateDirectory: isolated.state }).execute(input));
    const before = await requireCommand(isolated.root, "git", "rev-parse", "HEAD");
    const saga = new RecordingChildSaga();
    const result = await broker.execute({ ...request, childSaga: saga });
    assert.equal(result.status, "completed", result.summary);
    const after = await requireCommand(isolated.root, "git", "rev-parse", "HEAD");
    assert.notEqual(after, before);
    assert.equal(
      await requireCommand(isolated.root, "git", "write-tree"),
      await requireCommand(isolated.root, "git", "rev-parse", "HEAD^{tree}"),
      "shared index is atomically reconciled to the committed tree"
    );
    assert.equal((await command(isolated.root, "git", "diff", "--cached", "--quiet", "--exit-code")).code, 0, "shared index has no phantom staged change");
    assert.equal((await command(isolated.root, "git", "status", "--porcelain")).stdout.trim(), "");
    const begun = saga.events.find((event) => event.kind === "begin")?.value as ChildOperationStart;
    assert.equal(begun.action, "git.local-commit");
    assert.equal(begun.details?.repositoryRoot, await realpath(isolated.root));
    assert.equal(begun.details?.beforeHead, before);
    assert.equal(begun.details?.expectedTree, await requireCommand(isolated.root, "git", "rev-parse", "HEAD^{tree}"));
    assert.equal((saga.events.find((event) => event.kind === "external")?.value as Record<string, string>).postHead, after);
    assert.equal(saga.events.at(-1)?.kind, "settle:completed");
  } finally {
    await isolated.dispose();
  }
});

test("default-branch review creates a hook-disabled feature branch and requires a fresh target before committing", async () => {
  const isolated = await fixture();
  try {
    await requireCommand(isolated.root, "git", "branch", "-f", "main", "HEAD");
    await requireCommand(isolated.root, "git", "switch", "main");
    await writeFile(join(isolated.root, "src-safe.ts"), "export const value = 'reviewed from main';\n", "utf8");
    const target = await isolated.capture();
    assert.equal(target.branch, "main");
    assert.equal(target.completeness, "complete", target.reasons.join(" "));
    const first = permittedRequest(target, effectGuard(isolated));
    const firstBroker = new InMemoryGitBroker(first.policy);
    const handler = new LocalMediatedGitHandler({ stateDirectory: isolated.state });
    firstBroker.register("local_commit", (input) => handler.execute(input));
    const saga = new RecordingChildSaga();
    const branched = await firstBroker.execute({ ...first.request, childSaga: saga, mutation: { ...first.request.mutation, featureBranch: "feature/reviewed-from-main" } });
    assert.equal(branched.status, "incomplete", branched.summary);
    const branchChild = saga.events.find((event) => event.kind === "begin")?.value as ChildOperationStart;
    assert.equal(branchChild.action, "git.feature-branch");
    assert.equal(branchChild.details?.beforeHead, target.head);
    assert.equal(branchChild.details?.featureBranch, "feature/reviewed-from-main");
    assert.equal(saga.events.at(-1)?.kind, "settle:completed");
    assert.equal(await requireCommand(isolated.root, "git", "branch", "--show-current"), "feature/reviewed-from-main");
    assert.equal(await requireCommand(isolated.root, "git", "rev-parse", "HEAD"), target.head);

    const freshTarget = await isolated.capture();
    assert.equal(freshTarget.completeness, "complete", freshTarget.reasons.join(" "));
    const second = permittedRequest(freshTarget, effectGuard(isolated));
    const secondBroker = new InMemoryGitBroker(second.policy);
    secondBroker.register("local_commit", (input) => handler.execute(input));
    const committed = await secondBroker.execute(second.request);
    assert.equal(committed.status, "completed", committed.summary);
    assert.notEqual(await requireCommand(isolated.root, "git", "rev-parse", "HEAD"), target.head);
  } finally {
    await isolated.dispose();
  }
});

test("detached-HEAD review creates an exact feature branch before any commit and requires a fresh target", async () => {
  const isolated = await fixture();
  try {
    await requireCommand(isolated.root, "git", "checkout", "--detach", "HEAD");
    await writeFile(join(isolated.root, "src-safe.ts"), "export const value = 'reviewed from detached';\n", "utf8");
    const target = await isolated.capture();
    assert.equal(target.branch, undefined);
    assert.equal(target.detached, true);
    assert.equal(target.defaultBranch, "main");
    assert.equal(target.completeness, "complete", target.reasons.join(" "));
    const first = permittedRequest(target, effectGuard(isolated));
    const broker = new InMemoryGitBroker(first.policy);
    broker.register("local_commit", (input) => new LocalMediatedGitHandler({ stateDirectory: isolated.state }).execute(input));
    const branched = await broker.execute({ ...first.request, mutation: { ...first.request.mutation, featureBranch: "feature/reviewed-from-detached" } });
    assert.equal(branched.status, "incomplete", branched.summary);
    assert.equal(await requireCommand(isolated.root, "git", "branch", "--show-current"), "feature/reviewed-from-detached");
    assert.equal(await requireCommand(isolated.root, "git", "rev-parse", "HEAD"), target.head);
  } finally {
    await isolated.dispose();
  }
});

test("mediated local commit rejects unowned paths, a dirty shared index, containment, and a final target change", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "export const value = 'reviewed';\n", "utf8");
    const target = await isolated.capture();
    const handler = new LocalMediatedGitHandler({ stateDirectory: isolated.state });

    const unowned = permittedRequest(target, effectGuard(isolated));
    const unownedBroker = new InMemoryGitBroker(unowned.policy);
    let handlerCalls = 0;
    unownedBroker.register("local_commit", async (input) => { handlerCalls += 1; return handler.execute(input); });
    const rejected = await unownedBroker.execute({ ...unowned.request, mutation: { kind: "local_commit", paths: ["../outside.txt"], message: "no" } });
    assert.equal(rejected.status, "blocked");
    assert.equal(handlerCalls, 0);

    const contained = permittedRequest(target, effectGuard(isolated));
    const containment = new InMemoryContainmentManager();
    containment.activate({ repositoryRoot: target.repositoryRoot, operationId: "incident", reason: "isolated containment" });
    const containedBroker = new InMemoryGitBroker(contained.policy, containment);
    containedBroker.register("local_commit", (input) => handler.execute(input));
    assert.equal((await containedBroker.execute(contained.request)).status, "blocked");

    const finalChange = permittedRequest(target, effectGuard(isolated, "fail-final"));
    const finalBroker = new InMemoryGitBroker(finalChange.policy);
    finalBroker.register("local_commit", (input) => handler.execute(input));
    const finalResult = await finalBroker.execute(finalChange.request);
    assert.equal(finalResult.status, "incomplete", finalResult.summary);

    await writeFile(join(isolated.root, "other.txt"), "unrelated\n", "utf8");
    await requireCommand(isolated.root, "git", "add", "other.txt");
    const stagedTarget = await isolated.capture();
    const dirtyIndex = permittedRequest(stagedTarget, effectGuard(isolated));
    const dirtyBroker = new InMemoryGitBroker(dirtyIndex.policy);
    dirtyBroker.register("local_commit", (input) => handler.execute(input));
    assert.equal((await dirtyBroker.execute(dirtyIndex.request)).status, "blocked");
  } finally {
    await isolated.dispose();
  }
});


const shellQuote = (value: string) => "'" + value.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";

test("raw commit mediation bypasses repository clean/process/diff/textconv/fsmonitor commands and hooks", async () => {
  const isolated = await fixture();
  try {
    const marker = join(isolated.state, "must-not-run"), script = join(isolated.state, "tripwire.cjs");
    await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected');process.stdout.write('unreviewed')`);
    await writeFile(join(isolated.root, ".gitattributes"), "src-safe.ts filter=tripwire diff=tripwire\n");
    await requireCommand(isolated.root, "git", "add", ".gitattributes"); await requireCommand(isolated.root, "git", "commit", "-m", "synthetic attributes");
    const program = `${shellQuote(process.execPath)} ${shellQuote(script)}`;
    for (const key of ["filter.tripwire.clean", "filter.tripwire.process", "diff.tripwire.command", "diff.tripwire.textconv", "core.fsmonitor"]) await requireCommand(isolated.root, "git", "config", key, program);
    await requireCommand(isolated.root, "git", "config", "filter.tripwire.required", "true"); await requireCommand(isolated.root, "git", "config", "diff.tripwire.trustExitCode", "true");
    for (const name of ["pre-commit", "post-commit", "reference-transaction"]) await writeFile(join(isolated.root, ".git/hooks", name), `#!/bin/sh\nprintf unexpected > ${shellQuote(marker)}\nexit 0\n`, { mode: 0o755 });
    const content = "export const value = 'literal reviewed bytes';\n"; await writeFile(join(isolated.root, "src-safe.ts"), content);
    const target = await isolated.capture(); assert.equal(target.completeness, "complete", target.reasons.join(" "));
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.status, "completed", outcome.summary);
    assert.equal(await requireCommand(isolated.root, "git", "show", "HEAD:src-safe.ts"), content.trim());
    await assert.rejects(access(marker), { code: "ENOENT" });
  } finally { await isolated.dispose(); }
});

test("new binary files cross the private blob pipe unchanged and remain non-executable", async () => {
  const isolated = await fixture();
  try {
    const bytes = Buffer.alloc(1025); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    await writeFile(join(isolated.root, "new.bin"), bytes);
    const target = await isolated.capture(), { policy, request } = permittedRequest(target, effectGuard(isolated), ["new.bin"]), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.status, "completed", outcome.summary);
    assert.deepEqual((await command(isolated.root, "git", "show", "HEAD:new.bin")).stdoutBytes, bytes);
    assert.match(await requireCommand(isolated.root, "git", "ls-tree", "HEAD", "new.bin"), /^100644 blob /);
  } finally { await isolated.dispose(); }
});

test("a file changed between its manifest witness and private byte read cannot be committed", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "approved bytes\n"); const target = await isolated.capture();
    const delegate = new SpawnLocalGitRunner(); let changed = false;
    const runner: LocalGitRunner = { async run(args, options) { if (!changed && args.includes("--stage")) { changed = true; await writeFile(join(isolated.root, "src-safe.ts"), "unreviewed bytes\n"); } return delegate.run(args, options); } };
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state, runner }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.effectDisposition, "not_started", outcome.summary); assert.equal(changed, true);
    assert.equal(await requireCommand(isolated.root, "git", "rev-parse", "HEAD"), target.head);
    assert.equal(await readFile(join(isolated.root, "src-safe.ts"), "utf8"), "unreviewed bytes\n");
  } finally { await isolated.dispose(); }
});

test("a competing branch update wins its own CAS and is never overwritten by a reviewed local commit", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "approved bytes\n"); const target = await isolated.capture();
    const delegate = new SpawnLocalGitRunner(); let rival: string | undefined;
    const runner: LocalGitRunner = { async run(args, options) {
      if (!rival && args.includes("update-ref")) {
        const object = await delegate.run(["-c", "commit.gpgSign=false", "commit-tree", target.indexTree!, "-p", target.head!, "-m", "synthetic concurrent actor"], options); assert.equal(object.exitCode, 0); rival = object.stdout.trim();
        const update = await delegate.run(["update-ref", `refs/heads/${target.branch}`, rival, target.head!], options); assert.equal(update.exitCode, 0);
      }
      return delegate.run(args, options);
    } };
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state, runner }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.status, "incomplete"); assert.ok(rival);
    assert.equal(await requireCommand(isolated.root, "git", "rev-parse", "HEAD"), rival);
  } finally { await isolated.dispose(); }
});


test("feature-branch creation uses an expected-HEAD transaction without checkout filters", async () => {
  const isolated = await fixture();
  try {
    await requireCommand(isolated.root, "git", "checkout", "main");
    await writeFile(join(isolated.root, ".gitattributes"), "src-safe.ts filter=tripwire\n");
    await requireCommand(isolated.root, "git", "add", ".gitattributes"); await requireCommand(isolated.root, "git", "commit", "-m", "synthetic attributes");
    const marker = join(isolated.state, "must-not-run"), script = join(isolated.state, "tripwire.cjs");
    await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected');process.stdout.write('unreviewed')`);
    const program = `${shellQuote(process.execPath)} ${shellQuote(script)}`;
    await requireCommand(isolated.root, "git", "config", "filter.tripwire.clean", program); await requireCommand(isolated.root, "git", "config", "filter.tripwire.required", "true");
    await writeFile(join(isolated.root, "src-safe.ts"), "approved dirty worktree\n");
    const target = await isolated.capture(), { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state }).execute(input));
    const outcome = await broker.execute({ ...request, mutation: { ...request.mutation, featureBranch: "feature/raw-branch" } });
    assert.equal(outcome.status, "incomplete", outcome.summary); assert.equal(outcome.data?.freshReviewRequired, true);
    assert.equal(await requireCommand(isolated.root, "git", "branch", "--show-current"), "feature/raw-branch"); assert.equal(await requireCommand(isolated.root, "git", "rev-parse", "HEAD"), target.head);
    await assert.rejects(access(marker), { code: "ENOENT" });
  } finally { await isolated.dispose(); }
});

test("an unconfirmed native Git exit retains its exact indices and shared lock for recovery", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "approved bytes\n"); const target = await isolated.capture(), delegate = new SpawnLocalGitRunner();
    const runner: LocalGitRunner = { async run(args, options) { if (args.includes("update-ref")) throw Object.assign(new Error("Synthetic native exit unconfirmed"), { code: "RUNTIME_STOP_UNCONFIRMED" }); return delegate.run(args, options); } };
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state, runner }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.effectDisposition, "ambiguous"); assert.equal(outcome.data?.recoveryStatePreserved, true);
    await access(join(isolated.root, ".git/index.lock")); assert.equal(await requireCommand(isolated.root, "git", "rev-parse", "HEAD"), target.head);
  } finally { await isolated.dispose(); }
});

test("a readback failure after a verified reference update retains exact transaction recovery files", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "approved bytes\n"); const target = await isolated.capture(), delegate = new SpawnLocalGitRunner(); let advanced = false;
    const runner: LocalGitRunner = { async run(args, options) { if (advanced && args[0] === "rev-parse" && args[1] === "HEAD") throw new Error("Synthetic unavailable HEAD readback"); const result = await delegate.run(args, options); if (args.includes("update-ref") && result.exitCode === 0) advanced = true; return result; } };
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state, runner }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.effectDisposition, "ambiguous"); assert.equal(outcome.data?.recoveryStatePreserved, true);
    assert.notEqual(await requireCommand(isolated.root, "git", "rev-parse", "HEAD"), target.head); await access(join(isolated.root, ".git/index.lock"));
    assert.ok((await readdir(join(isolated.state, "git-operations"))).length); assert.ok((await readdir(join(isolated.state, "git-locks"))).length);
  } finally { await isolated.dispose(); }
});


test("a replacement shared index lock is preserved after the exact reviewed commit advances HEAD", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "approved bytes\n"); const target = await isolated.capture(), delegate = new SpawnLocalGitRunner();
    const originalIndex = await readFile(join(isolated.root, ".git/index")); let replaced = false;
    const runner: LocalGitRunner = { async run(args, options) { const result = await delegate.run(args, options); if (!replaced && args.includes("update-ref") && result.exitCode === 0) { replaced = true; const path = join(isolated.root, ".git/index.lock"); await rename(path, path + ".old-owned"); await writeFile(path, "different writer lock", { mode: 0o600 }); } return result; } };
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state, runner }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.status, "incomplete", outcome.summary); assert.equal(outcome.effectDisposition, "committed"); assert.equal(outcome.data?.recoveryStatePreserved, true);
    assert.equal(await readFile(join(isolated.root, ".git/index.lock"), "utf8"), "different writer lock");
    assert.deepEqual(await readFile(join(isolated.root, ".git/index")), originalIndex);
  } finally { await isolated.dispose(); }
});

test("a replacement original index is never overwritten during shared-index reconciliation", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "approved bytes\n"); const target = await isolated.capture(), delegate = new SpawnLocalGitRunner(); let replaced = false;
    const runner: LocalGitRunner = { async run(args, options) { const result = await delegate.run(args, options); if (!replaced && args.includes("update-ref") && result.exitCode === 0) { replaced = true; const path = join(isolated.root, ".git/index"); await rename(path, path + ".old-owned"); await writeFile(path, "different index selected by another writer", { mode: 0o600 }); } return result; } };
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state, runner }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.status, "incomplete", outcome.summary); assert.equal(outcome.effectDisposition, "committed");
    assert.equal(await readFile(join(isolated.root, ".git/index"), "utf8"), "different index selected by another writer");
  } finally { await isolated.dispose(); }
});

test("the previous worktree owner cannot delete a replacement private lock during cleanup", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "approved bytes\n"); const target = await isolated.capture(), delegate = new SpawnLocalGitRunner(); let replacement: string | undefined;
    const runner: LocalGitRunner = { async run(args, options) { const result = await delegate.run(args, options); if (!replacement && args.includes("update-ref") && result.exitCode === 0) { const directory = join(isolated.state, "git-locks"), names = await readdir(directory); assert.equal(names.length, 1); replacement = join(directory, names[0]!); await rename(replacement, replacement + ".old-owned"); await writeFile(replacement, "different worktree owner", { mode: 0o600 }); } return result; } };
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state, runner }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.status, "completed", outcome.summary); assert.ok(replacement);
    assert.equal(await readFile(replacement, "utf8"), "different worktree owner");
  } finally { await isolated.dispose(); }
});

test("host preservation records exact index and lock identities before any reference update", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "approved bytes\n"); const target = await isolated.capture(), delegate = new SpawnLocalGitRunner(); let saved = false;
    const runner: LocalGitRunner = { async run(args, options) { if (args.includes("update-ref")) assert.equal(saved, true); return delegate.run(args, options); } };
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state, runner, onPreservation: async p => { assert.equal(p.beforeHead, target.head); assert.equal(p.beforeIndexTree, target.indexTree); assert.match(p.sharedIndex.originalIndexSha256, /^[a-f0-9]{64}$/); assert.match(p.sharedIndex.lockIdentity.inode, /^[0-9]+$/); assert.match(p.worktreeLock.contentSha256, /^[a-f0-9]{64}$/); await access(p.privateIndexCopy); await access(p.privateIndex!); saved = true; } }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.status, "completed", outcome.summary); assert.equal(saved, true);
  } finally { await isolated.dispose(); }
});


test("shared lock content changed in place is preserved rather than overwritten", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "approved bytes\n"); const target = await isolated.capture(), delegate = new SpawnLocalGitRunner(); let changed = false;
    const runner: LocalGitRunner = { async run(args, options) { const result = await delegate.run(args, options); if (!changed && args.includes("update-ref") && result.exitCode === 0) { changed = true; await writeFile(join(isolated.root, ".git/index.lock"), "changed in place", { mode: 0o600 }); } return result; } };
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state, runner }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.status, "incomplete"); assert.equal(outcome.effectDisposition, "committed"); assert.equal(await readFile(join(isolated.root, ".git/index.lock"), "utf8"), "changed in place");
  } finally { await isolated.dispose(); }
});

test("private lock content changed in place remains untouched during cleanup", async () => {
  const isolated = await fixture();
  try {
    await writeFile(join(isolated.root, "src-safe.ts"), "approved bytes\n"); const target = await isolated.capture(), delegate = new SpawnLocalGitRunner(); let changed: string | undefined;
    const runner: LocalGitRunner = { async run(args, options) { const result = await delegate.run(args, options); if (!changed && args.includes("update-ref") && result.exitCode === 0) { const directory = join(isolated.state, "git-locks"); changed = join(directory, (await readdir(directory))[0]!); await writeFile(changed, "changed in place", { mode: 0o600 }); } return result; } };
    const { policy, request } = permittedRequest(target, effectGuard(isolated)), broker = new InMemoryGitBroker(policy);
    broker.register("local_commit", input => new LocalMediatedGitHandler({ stateDirectory: isolated.state, runner }).execute(input));
    const outcome = await broker.execute(request); assert.equal(outcome.status, "completed", outcome.summary); assert.ok(changed); assert.equal(await readFile(changed, "utf8"), "changed in place");
  } finally { await isolated.dispose(); }
});
