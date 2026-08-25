import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { SpawnLocalGitRunner, type LocalGitRunner } from "../src/mediated-git.ts";
import {
  CouncilWorkspaceIsolationManager,
  LoopbackCouncilPortAvailabilityProbe,
  type CouncilIsolationPrepareRequest,
  type CouncilPortAvailabilityProbe
} from "../src/council-workspace-isolation.ts";
import {
  CouncilResourceHost,
  VaultBackedCouncilCredentialCapabilityPort,
  type CouncilCredentialCapabilityBinding,
  type CouncilCredentialVaultCapabilityPort,
  type CouncilCredentialVaultIssueRequest
} from "../src/council-resource-host.ts";
import type { CredentialAdapterPort } from "../src/durable-credentials.ts";

const at = "2026-08-24T12:00:00.000Z";
const headPattern = /^[a-f0-9]{40}$/;

async function git(runner: LocalGitRunner, cwd: string, args: readonly string[]): Promise<string> {
  const result = await runner.run(args, { cwd });
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolveListen); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

class FakeCredentialVaultPort implements CouncilCredentialVaultCapabilityPort {
  readonly active = new Map<string, CouncilCredentialVaultIssueRequest>();
  readonly revoked: string[] = [];
  async issue(request: CouncilCredentialVaultIssueRequest): Promise<CouncilCredentialCapabilityBinding> {
    const id = `opaque-${request.sessionId}-${request.fence}-${request.reference}`;
    this.active.set(id, { ...request });
    return { id, expiresAt: Date.parse(at) + 60_000 };
  }
  async assertCurrent(binding: CouncilCredentialCapabilityBinding, request: CouncilCredentialVaultIssueRequest): Promise<boolean> {
    const active = this.active.get(binding.id);
    return active !== undefined && JSON.stringify(active) === JSON.stringify(request);
  }
  async revoke(binding: CouncilCredentialCapabilityBinding): Promise<void> { this.active.delete(binding.id); this.revoked.push(binding.id); }
}

async function fixture(): Promise<Readonly<{ base: string; repositoryRoot: string; stateRoot: string; store: ProtectedJsonStore; runner: LocalGitRunner; credentials: FakeCredentialVaultPort; request: CouncilIsolationPrepareRequest }>> {
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
  const credentials = new FakeCredentialVaultPort();
  const [firstPort, secondPort] = await Promise.all([availablePort(), availablePort()]);
  assert.notEqual(firstPort, secondPort);
  return {
    base, repositoryRoot: await realpath(repositoryRoot), stateRoot, store, runner, credentials,
    request: {
      epochId: "epoch-one",
      targetSnapshotId: "a".repeat(64),
      repositoryRoot: await realpath(repositoryRoot),
      targetHead: head,
      defaultBranch: "main",
      assignments: [
        { sessionId: "agent-one", paths: ["src/one.ts"], resources: [`port:${firstPort}`, "cache:npm", "temp:build", "database:test", "credential-scope:github-read"] },
        { sessionId: "agent-two", paths: ["src/two.ts"], resources: [`port:${secondPort}`, "cache:pnpm", "temp:test", "database:integration", "credential-scope:provider-read"] }
      ]
    }
  };
}

const portsAvailable: CouncilPortAvailabilityProbe = { async available() { return true; } };

function managerFor(context: Awaited<ReturnType<typeof fixture>>, options: { credentials?: CouncilCredentialVaultCapabilityPort; resourceHost?: CouncilResourceHost } = {}): CouncilWorkspaceIsolationManager {
  const resourceHost = options.resourceHost ?? new CouncilResourceHost({
    stateRoot: context.stateRoot,
    ...(options.credentials === undefined ? { credentials: context.credentials } : { credentials: options.credentials })
  });
  return new CouncilWorkspaceIsolationManager(context.store, {
    stateRoot: context.stateRoot, git: context.runner, ports: portsAvailable, clock: () => at, resourceHost
  });
}

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
  const manager = managerFor(context);
  try {
    const plan = await manager.prepare(context.request);
    assert.equal(plan.status, "prepared");
    assert.equal(plan.executionAuthorized, false);
    assert.equal(plan.bindings.length, 2);
    assert.equal(new Set(plan.bindings.map((binding) => binding.branch)).size, 2);
    assert.equal(new Set(plan.bindings.flatMap((binding) => binding.leases.map((lease) => lease.resource))).size, plan.bindings.flatMap((binding) => binding.leases).length);
    for (const binding of plan.bindings) {
      assert.ok(binding.resourceHost);
      assert.notEqual(binding.branch, context.request.defaultBranch);
      assert.equal(await git(context.runner, binding.worktreeRoot, ["rev-parse", "HEAD"]), context.request.targetHead);
      assert.equal(await git(context.runner, binding.worktreeRoot, ["branch", "--show-current"]), binding.branch);
      assert.equal(await git(context.runner, binding.worktreeRoot, ["status", "--porcelain=v1"]), "");
      assert.match(binding.assignmentDigest, /^[a-f0-9]{64}$/);
      assert.match(binding.resourceHost.digest, /^[a-f0-9]{64}$/);
      assert.equal(binding.resourceHost.sessionId, binding.sessionId);
      assert.equal(binding.resourceHost.environment.SXSY_COUNCIL_SESSION_ID, binding.sessionId);
      assert.deepEqual(new Set(binding.leases.map((lease) => lease.kind)), new Set(["branch", "worktree", "port", "cache", "temp", "database", "credential_scope"]));
    }

    const firstBinding = plan.bindings[0]!;
    assert.ok(firstBinding.resourceHost);
    const portLease = firstBinding.leases.find((lease) => lease.kind === "port")!;
    const held = createServer();
    await assert.rejects(new Promise<void>((resolveListen, reject) => {
      held.once("error", reject);
      held.listen({ host: "127.0.0.1", port: Number(portLease.declaration!.slice("port:".length)), exclusive: true }, resolveListen);
    }), /EADDRINUSE|address.*use/i);
    held.close();

    const database = firstBinding.resourceHost.resources.find((resource) => resource.kind === "database")!;
    const cache = firstBinding.resourceHost.resources.find((resource) => resource.kind === "cache")!;
    await writeFile(join(cache.value, "participant-cache.bin"), "disposable\n", "utf8");
    assert.equal(database.bindingType, "sqlite");
    const db = new DatabaseSync(database.value, { readOnly: true });
    try {
      const row = db.prepare("SELECT epoch_id, session_id, lease_id, fence FROM sxsy_council_binding").get() as Record<string, unknown>;
      assert.deepEqual({ ...row }, { epoch_id: plan.epochId, session_id: firstBinding.sessionId, lease_id: database.leaseId, fence: database.fence });
    } finally { db.close(); }

    const repeated = await manager.prepare(context.request);
    assert.equal(repeated.digest, plan.digest);

    await assert.rejects(manager.prepare({ ...context.request, epochId: "epoch-two" }), /lease|fenced|collision/i);
    const cleaned = await manager.cleanup(plan.epochId);
    assert.equal(cleaned.status, "cleaned");
    for (const binding of plan.bindings) await assert.rejects(realpath(binding.worktreeRoot));
    await assert.rejects(realpath(cache.value));
    assert.equal(context.credentials.active.size, 0);
    assert.equal(context.credentials.revoked.length, 2);

    const reusable = createServer();
    await new Promise<void>((resolveListen, reject) => { reusable.once("error", reject); reusable.listen({ host: "127.0.0.1", port: Number(portLease.declaration!.slice("port:".length)), exclusive: true }, resolveListen); });
    await new Promise<void>((resolveClose) => reusable.close(() => resolveClose()));
  } finally {
    await manager.cleanup(context.request.epochId).catch(() => undefined);
    await rm(context.base, { recursive: true, force: true });
  }
});

test("Council fails closed when credential capability injection is unavailable or crosses a session fence", async () => {
  const context = await fixture();
  let crossSessionManager: CouncilWorkspaceIsolationManager | undefined;
  try {
    const unavailable = new CouncilWorkspaceIsolationManager(context.store, {
      stateRoot: context.stateRoot,
      git: context.runner,
      resourceHost: new CouncilResourceHost({ stateRoot: context.stateRoot })
    });
    await assert.rejects(unavailable.prepare({ ...context.request, assignments: [context.request.assignments[0]!] }), /credential.*unavailable|vault/i);

    const store = new ProtectedJsonStore({ filePath: join(context.base, "cross-session.jsonl"), clock: () => at });
    const credentials = new FakeCredentialVaultPort();
    const manager = new CouncilWorkspaceIsolationManager(store, {
      stateRoot: join(context.base, "cross-session-state"),
      git: context.runner,
      resourceHost: new CouncilResourceHost({ stateRoot: join(context.base, "cross-session-state"), credentials })
    });
    crossSessionManager = manager;
    const request = { ...context.request, epochId: "cross-session", assignments: [context.request.assignments[0]!] };
    const prepared = await manager.prepare(request);
    const preparedHost = prepared.bindings[0]!.resourceHost;
    assert.ok(preparedHost);
    const capability = preparedHost.resources.find((resource) => resource.kind === "credential_scope")!;
    const issued = credentials.active.get(capability.value)!;
    credentials.active.set(capability.value, { ...issued, sessionId: "stolen-session" });
    await assert.rejects(manager.assertCurrent(prepared.epochId), /credential.*fence|capability.*current|resource host/i);
  } finally {
    await crossSessionManager?.cleanup("cross-session").catch(() => undefined);
    await rm(context.base, { recursive: true, force: true });
  }
});

test("vault-backed Council capabilities are opaque, session-fenced, and single-use", async () => {
  const cleartext = Buffer.from("credential-secret-that-must-not-be-serialized", "utf8");
  const adapter: CredentialAdapterPort = {
    async acquireLease() { return { id: "internal-redeemable-lease", expiresAt: Date.now() + 60_000 }; },
    async redeem(_lease, consume) { return consume(new Uint8Array(cleartext)); },
    async withCredential(request, consume) { return this.redeem(await this.acquireLease(request), consume); }
  };
  const port = new VaultBackedCouncilCredentialCapabilityPort(adapter, () => "fixed-capability-id");
  const request: CouncilCredentialVaultIssueRequest = {
    reference: "github-read", repositoryRoot: "C:\\repo", epochId: "epoch", sessionId: "agent-one",
    leaseId: "lease", fence: 7, fenceDigest: "a".repeat(64)
  };
  const capability = await port.issue(request);
  assert.equal(JSON.stringify(capability).includes("credential-secret"), false);
  assert.equal(JSON.stringify(capability).includes("internal-redeemable-lease"), false);
  assert.equal(await port.assertCurrent(capability, { ...request, sessionId: "agent-two" }), false);
  assert.equal(await port.withCredential(capability, request, async (value) => Buffer.from(value).toString("utf8")), cleartext.toString("utf8"));
  await assert.rejects(port.withCredential(capability, request, async () => "replayed"), /expired|revoked|session fence/i);
  cleartext.fill(0);
});

test("Council detects a stolen resource marker and safely reconciles held resources after restart", async () => {
  const context = await fixture();
  try {
    const noCredentialRequest = {
      ...context.request,
      assignments: [{ ...context.request.assignments[0]!, resources: context.request.assignments[0]!.resources.filter((resource) => !resource.startsWith("credential-scope:")) }]
    };
    const firstHost = new CouncilResourceHost({ stateRoot: context.stateRoot });
    const manager = managerFor(context, { resourceHost: firstHost });
    const prepared = await manager.prepare(noCredentialRequest);
    await firstHost.shutdownForRestart();

    const restarted = managerFor(context, { resourceHost: new CouncilResourceHost({ stateRoot: context.stateRoot }) });
    const [recovered] = await restarted.recoverPending();
    assert.equal(recovered?.status, "prepared");
    await restarted.assertCurrent(prepared.epochId);

    const recoveredHost = recovered!.bindings[0]!.resourceHost;
    assert.ok(recoveredHost);
    const cache = recoveredHost.resources.find((resource) => resource.kind === "cache")!;
    const markerPath = join(cache.value, ".sxsy-b122-council-resource.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
    await writeFile(markerPath, JSON.stringify({ ...marker, fence: Number(marker.fence) + 1 }), "utf8");
    await assert.rejects(restarted.assertCurrent(prepared.epochId), /marker|fence|resource host/i);
    const reconciled = await restarted.recover(prepared.epochId);
    assert.equal(reconciled.status, "manual_cleanup_required");
  } finally { await rm(context.base, { recursive: true, force: true }); }
});

test("Council restart detects loopback-port theft and never marks the stolen lease cleaned", async () => {
  const context = await fixture();
  const firstHost = new CouncilResourceHost({ stateRoot: context.stateRoot });
  let thief: ReturnType<typeof createServer> | undefined;
  try {
    const request = { ...context.request, assignments: [{ ...context.request.assignments[0]!, resources: [context.request.assignments[0]!.resources.find((resource) => resource.startsWith("port:"))!] }] };
    const manager = managerFor(context, { resourceHost: firstHost });
    const prepared = await manager.prepare(request);
    const port = Number(request.assignments[0]!.resources[0]!.slice("port:".length));
    await firstHost.shutdownForRestart();
    thief = createServer();
    await new Promise<void>((resolveListen, reject) => { thief!.once("error", reject); thief!.listen({ host: "127.0.0.1", port, exclusive: true }, resolveListen); });

    const restarted = managerFor(context, { resourceHost: new CouncilResourceHost({ stateRoot: context.stateRoot }) });
    const recovered = await restarted.recover(prepared.epochId);
    assert.equal(recovered.status, "manual_cleanup_required");
    assert.match(recovered.failureReason ?? "", /hosted resource|manual cleanup|port/i);
  } finally {
    if (thief?.listening) await new Promise<void>((resolveClose) => thief!.close(() => resolveClose()));
    await firstHost.shutdownForRestart().catch(() => undefined);
    await rm(context.base, { recursive: true, force: true });
  }
});

test("Council recovery probes partial external state and cleans it without replaying worktree creation", async () => {
  const context = await fixture();
  try {
    const manager = managerFor(context);
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
    const manager = managerFor(context);
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
    const manager = managerFor(context);
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
