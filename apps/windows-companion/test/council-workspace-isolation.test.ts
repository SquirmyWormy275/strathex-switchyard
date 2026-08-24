import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { SpawnLocalGitRunner, type LocalGitRunner } from "../src/mediated-git.ts";
import {
  CouncilWorkspaceIsolationManager,
  LoopbackCouncilPortAvailabilityProbe,
  type CouncilIsolationPrepareRequest,
  type CouncilPortAvailabilityProbe
} from "../src/council-workspace-isolation.ts";

const at = "2026-08-24T12:00:00.000Z";
const headPattern = /^[a-f0-9]{40}$/;

async function git(runner: LocalGitRunner, cwd: string, args: readonly string[]): Promise<string> {
  const result = await runner.run(args, { cwd });
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function fixture(): Promise<Readonly<{ base: string; repositoryRoot: string; stateRoot: string; store: ProtectedJsonStore; runner: LocalGitRunner; request: CouncilIsolationPrepareRequest }>> {
  const base = await mkdtemp(join(tmpdir(), "b122-council-isolation-"));
  const repositoryRoot = join(base, "repository");
  const stateRoot = join(base, "host-state");
  const runner = new SpawnLocalGitRunner();
  await git(runner, base, ["init", "--initial-branch=feature/base", repositoryRoot]);
  await git(runner, repositoryRoot, ["config", "user.email", "council-test@example.invalid"]);
  await git(runner, repositoryRoot, ["config", "user.name", "Council Test"]);
  await writeFile(join(repositoryRoot, "README.md"), "isolated fixture\n", "utf8");
  await git(runner, repositoryRoot, ["add", "--", "README.md"]);
  await git(runner, repositoryRoot, ["-c", "core.hooksPath=NUL", "commit", "-m", "fixture"]);
  await git(runner, repositoryRoot, ["branch", "main"]);
  const head = await git(runner, repositoryRoot, ["rev-parse", "HEAD"]);
  assert.match(head, headPattern);
  const store = new ProtectedJsonStore({ filePath: join(base, "protected-journal.jsonl"), clock: () => at });
  return {
    base, repositoryRoot: await realpath(repositoryRoot), stateRoot, store, runner,
    request: {
      epochId: "epoch-one",
      targetSnapshotId: "a".repeat(64),
      repositoryRoot: await realpath(repositoryRoot),
      targetHead: head,
      defaultBranch: "main",
      assignments: [
        { sessionId: "agent-one", paths: ["src/one.ts"], resources: ["port:45101", "cache:npm", "temp:build", "database:test", "credential-scope:github-read"] },
        { sessionId: "agent-two", paths: ["src/two.ts"], resources: ["port:45102", "cache:pnpm", "temp:test", "database:integration", "credential-scope:provider-read"] }
      ]
    }
  };
}

const portsAvailable: CouncilPortAvailabilityProbe = { async available() { return true; } };

test("installed Council port probe rejects an occupied loopback port", async () => {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolveListen); });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    assert.equal(await new LoopbackCouncilPortAvailabilityProbe().available(address.port), false);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

test("Council allocates exact non-default worktrees and collision-free scoped resources", async () => {
  const context = await fixture();
  try {
    const manager = new CouncilWorkspaceIsolationManager(context.store, {
      stateRoot: context.stateRoot, git: context.runner, ports: portsAvailable, clock: () => at
    });
    const plan = await manager.prepare(context.request);
    assert.equal(plan.status, "prepared");
    assert.equal(plan.executionAuthorized, false);
    assert.equal(plan.bindings.length, 2);
    assert.equal(new Set(plan.bindings.map((binding) => binding.branch)).size, 2);
    assert.equal(new Set(plan.bindings.flatMap((binding) => binding.leases.map((lease) => lease.resource))).size, plan.bindings.flatMap((binding) => binding.leases).length);
    for (const binding of plan.bindings) {
      assert.notEqual(binding.branch, context.request.defaultBranch);
      assert.equal(await git(context.runner, binding.worktreeRoot, ["rev-parse", "HEAD"]), context.request.targetHead);
      assert.equal(await git(context.runner, binding.worktreeRoot, ["branch", "--show-current"]), binding.branch);
      assert.equal(await git(context.runner, binding.worktreeRoot, ["status", "--porcelain=v1"]), "");
      assert.match(binding.assignmentDigest, /^[a-f0-9]{64}$/);
      assert.deepEqual(new Set(binding.leases.map((lease) => lease.kind)), new Set(["branch", "worktree", "port", "cache", "temp", "database", "credential_scope"]));
    }

    const repeated = await manager.prepare(context.request);
    assert.equal(repeated.digest, plan.digest);

    await assert.rejects(manager.prepare({ ...context.request, epochId: "epoch-two" }), /lease|fenced|collision/i);
    const cleaned = await manager.cleanup(plan.epochId);
    assert.equal(cleaned.status, "cleaned");
    for (const binding of plan.bindings) await assert.rejects(realpath(binding.worktreeRoot));
  } finally {
    await rm(context.base, { recursive: true, force: true });
  }
});

test("Council recovery probes partial external state and cleans it without replaying worktree creation", async () => {
  const context = await fixture();
  try {
    const manager = new CouncilWorkspaceIsolationManager(context.store, {
      stateRoot: context.stateRoot, git: context.runner, ports: portsAvailable, clock: () => at
    });
    const reserved = await manager.reserve(context.request);
    const first = reserved.bindings[0]!;
    await git(context.runner, context.repositoryRoot, ["worktree", "add", "-b", first.branch, first.worktreeRoot, context.request.targetHead]);

    const recovered = await manager.recover(reserved.epochId);
    assert.equal(recovered.status, "cleaned", recovered.failureReason);
    await assert.rejects(realpath(first.worktreeRoot));
    const branches = await git(context.runner, context.repositoryRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
    assert.equal(branches.split(/\r?\n/).includes(first.branch), false);
  } finally {
    await rm(context.base, { recursive: true, force: true });
  }
});

test("Council recovery preserves dirty or advanced work and requires manual cleanup", async () => {
  const context = await fixture();
  try {
    const request = { ...context.request, assignments: [context.request.assignments[0]!] };
    const manager = new CouncilWorkspaceIsolationManager(context.store, {
      stateRoot: context.stateRoot, git: context.runner, ports: portsAvailable, clock: () => at
    });
    const reserved = await manager.reserve(request);
    const binding = reserved.bindings[0]!;
    await git(context.runner, context.repositoryRoot, ["worktree", "add", "-b", binding.branch, binding.worktreeRoot, request.targetHead]);
    await writeFile(join(binding.worktreeRoot, "uncommitted.txt"), "preserve me\n", "utf8");

    const recovered = await manager.recover(reserved.epochId);
    assert.equal(recovered.status, "manual_cleanup_required");
    assert.equal(await realpath(binding.worktreeRoot), binding.worktreeRoot);
    assert.match(recovered.failureReason ?? "", /dirty|preserve|manual/i);
  } finally {
    await rm(context.base, { recursive: true, force: true });
  }
});

test("Council startup recovery enumerates durable epochs and never resumes an invalid prepared plan", async () => {
  const context = await fixture();
  try {
    const request = { ...context.request, assignments: [context.request.assignments[0]!] };
    const manager = new CouncilWorkspaceIsolationManager(context.store, {
      stateRoot: context.stateRoot, git: context.runner, ports: portsAvailable, clock: () => at
    });
    const prepared = await manager.prepare(request);
    const binding = prepared.bindings[0]!;
    await writeFile(join(binding.worktreeRoot, "unexpected.txt"), "preserve on restart\n", "utf8");

    const recovered = await manager.recoverPending();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.epochId, prepared.epochId);
    assert.equal(recovered[0]?.status, "manual_cleanup_required");
    assert.equal(await realpath(binding.worktreeRoot), binding.worktreeRoot);

    const listed = await manager.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.status, "manual_cleanup_required");
    assert.equal((await manager.recoverPending()).length, 0);
  } finally {
    await rm(context.base, { recursive: true, force: true });
  }
});

test("Council fails closed on unproven ports, unknown resource kinds, or an unsafe state root", async () => {
  const context = await fixture();
  try {
    const unavailablePorts: CouncilPortAvailabilityProbe = { async available() { return false; } };
    const manager = new CouncilWorkspaceIsolationManager(context.store, {
      stateRoot: context.stateRoot, git: context.runner, ports: unavailablePorts, clock: () => at
    });
    await assert.rejects(manager.prepare({ ...context.request, assignments: [context.request.assignments[0]!] }), /port.*unavailable|prove.*port/i);

    const unknown = new CouncilWorkspaceIsolationManager(new ProtectedJsonStore({ filePath: join(context.base, "unknown.jsonl") }), {
      stateRoot: join(context.base, "other-state"), git: context.runner, ports: portsAvailable
    });
    await assert.rejects(unknown.reserve({ ...context.request, epochId: "unknown-kind", assignments: [{ ...context.request.assignments[0]!, resources: ["mystery:shared"] }] }), /resource kind/i);

    const unsafe = new CouncilWorkspaceIsolationManager(new ProtectedJsonStore({ filePath: join(context.base, "unsafe.jsonl") }), {
      stateRoot: join(context.repositoryRoot, ".council"), git: context.runner, ports: portsAvailable
    });
    await assert.rejects(unsafe.reserve({ ...context.request, epochId: "unsafe-root", assignments: [context.request.assignments[0]!] }), /outside.*repository|state root/i);

    await git(context.runner, context.repositoryRoot, ["config", "filter.untrusted.smudge", "ignored-filter-command"]);
    const filtered = new CouncilWorkspaceIsolationManager(new ProtectedJsonStore({ filePath: join(context.base, "filtered.jsonl") }), {
      stateRoot: join(context.base, "filtered-state"), git: context.runner, ports: portsAvailable
    });
    await assert.rejects(filtered.reserve({ ...context.request, epochId: "filtered-checkout", assignments: [context.request.assignments[0]!] }), /checkout filters|safely materialize/i);
  } finally {
    await rm(context.base, { recursive: true, force: true });
  }
});
