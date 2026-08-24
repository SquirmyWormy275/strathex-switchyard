import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { LocalMediatedGitHandler } from "../src/mediated-git.ts";

async function command(cwd: string, ...args: string[]): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(args[0]!, args.slice(1), { cwd, shell: false, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (value: Buffer) => stdout.push(value));
    child.stderr.on("data", (value: Buffer) => stderr.push(value));
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
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
  await requireCommand(root, "git", "checkout", "-b", "feature/mediated-git");
  await requireCommand(remote, "git", "init", "--bare");
  await requireCommand(root, "git", "remote", "add", "origin", remote);
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

function permittedRequest(target: TargetSnapshot, guard: EffectGuard) {
  const definition = commandForAction("local_commit");
  const selected = session(target);
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
      mutation: { kind: "local_commit" as const, paths: ["src-safe.ts"], message: "reviewed isolated change" }
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
    const result = await broker.execute(request);
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
    const branched = await firstBroker.execute({ ...first.request, mutation: { ...first.request.mutation, featureBranch: "feature/reviewed-from-main" } });
    assert.equal(branched.status, "incomplete", branched.summary);
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
