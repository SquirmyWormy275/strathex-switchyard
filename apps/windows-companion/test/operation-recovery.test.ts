import assert from "node:assert/strict";
import test from "node:test";

import type { OperationRecord } from "../../../packages/control-plane/src/contracts.ts";
import { createExactProviderRecoveryRouter, HostOwnedOperationReconciler, InstalledReadOnlyObservationPort, type InstalledOperationObservationPort } from "../src/operation-recovery.ts";
import type { CheckpointGitRunner } from "../src/local-checkpoints.ts";
import type { DynamicConfiguredNetworkClient } from "../src/remote-adapters.ts";

const operation = (action: string, details: Readonly<Record<string, string>>, parentId: string | null = "parent-1"): OperationRecord => ({
  id: `operation-${action}`, ...(parentId ? { parentId } : {}), idempotencyKey: `scope-${action}`, action, targetSnapshotId: "snapshot-1", state: "executing",
  createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-08-24T12:00:01.000Z", childIds: [], details
});

const providerBinding = (overrides: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> => ({
  repositoryRoot: "C:\\repo",
  routeId: "provider.proof",
  externalId: "external-1",
  targetSnapshotId: "snapshot-1",
  providerOperationId: "provider-operation-1",
  providerAction: "proof",
  sessionId: "session-1",
  provider: "codex",
  authorityId: "authority-1",
  ...overrides
});

class Observations implements InstalledOperationObservationPort {
  readonly calls: string[] = [];
  result: "committed" | "failed" | "cancelled" | "unresolved" = "committed";
  async localGit(input: Parameters<InstalledOperationObservationPort["localGit"]>[0]) { this.calls.push(`local:${input.repositoryRoot}:${input.beforeHead}:${input.expectedTree}`); return { outcome: this.result, note: "read-only local observation", details: { observedHead: "b".repeat(40) } } as const; }
  async remoteRef(input: Parameters<InstalledOperationObservationPort["remoteRef"]>[0]) { this.calls.push(`ref:${input.remote}:${input.ref}:${input.expectedHead}`); return { outcome: this.result, note: "read-only remote ref observation" } as const; }
  async pullRequest(input: Parameters<InstalledOperationObservationPort["pullRequest"]>[0]) { this.calls.push(`pr:${input.owner}/${input.name}:${input.number ?? input.headBranch}:${input.expectedState}`); return { outcome: this.result, note: "read-only PR observation" } as const; }
  async provider(input: Parameters<InstalledOperationObservationPort["provider"]>[0]) { this.calls.push(`provider:${input.operationId}:${input.action}:${input.sessionId}:${input.authorityId}:${input.repositoryRoot}:${input.routeId}:${input.externalId}`); return { outcome: this.result, note: "read-only provider observation" } as const; }
  async council(input: Parameters<InstalledOperationObservationPort["council"]>[0]) { this.calls.push(`council:${input.epochId}:${input.phase}:${input.sessionId}`); return { outcome: this.result, note: "read-only Council observation" } as const; }
  async hostAction(input: Parameters<InstalledOperationObservationPort["hostAction"]>[0]) { this.calls.push(`host:${input.operationId}:${input.action}`); return { outcome: this.result, note: "read-only host observation" } as const; }
  async providerDesktop(input: Readonly<{ operationId: string; action: string }>) { this.calls.push(`provider-desktop:${input.operationId}:${input.action}`); return { outcome: this.result, note: "read-only provider desktop effect observation" } as const; }
}

test("read-only recovery routes exact immutable bindings and records a verified child without invoking effects", async () => {
  const observations = new Observations();
  const reconciler = new HostOwnedOperationReconciler(observations);
  const local = await reconciler.reconcile(operation("git.local-commit", { repositoryRoot: "C:\\repo", beforeHead: "a".repeat(40), expectedTree: "c".repeat(40) }));
  assert.deepEqual(local, { state: "recorded", note: "read-only local observation", details: { observedHead: "b".repeat(40), reconciliation: "read-only-observation" } });
  await reconciler.reconcile(operation("git.push-reviewed-head", { repositoryRoot: "C:\\repo", remote: "https://github.com/acme/repo.git", ref: "refs/heads/feat/a", expectedHead: "d".repeat(40) }));
  await reconciler.reconcile(operation("github.pr-upsert", { repositoryRoot: "C:\\repo", owner: "acme", name: "repo", headOwner: "acme", headName: "repo", headBranch: "feat/a", baseBranch: "main", expectedHead: "d".repeat(40), expectedState: "OPEN" }));
  await reconciler.reconcile(operation("github.pr-merge", { repositoryRoot: "C:\\repo", owner: "acme", name: "repo", headOwner: "acme", headName: "repo", pullRequest: "17", baseBranch: "main", expectedHead: "d".repeat(40), expectedState: "MERGED" }));
  await reconciler.reconcile(operation("provider.artifact", providerBinding({ routeId: "provider.repair" })));
  await reconciler.reconcile(operation("council.pause", { epochId: "epoch-1", phase: "pause", sessionId: "session-1", target: "snapshot-1" }));
  await reconciler.reconcile(operation("open_claude", {}, null));
  await reconciler.reconcile(operation("open_managed_codex_terminal", {}, null));
  assert.deepEqual(observations.calls, [
    `local:C:\\repo:${"a".repeat(40)}:${"c".repeat(40)}`,
    `ref:https://github.com/acme/repo.git:refs/heads/feat/a:${"d".repeat(40)}`,
    "pr:acme/repo:feat/a:OPEN", "pr:acme/repo:17:MERGED", "provider:provider-operation-1:proof:session-1:authority-1:C:\\repo:provider.repair:external-1",
    "council:epoch-1:pause:session-1", "provider-desktop:operation-open_claude:open_claude",
    "host:operation-open_managed_codex_terminal:open_managed_codex_terminal"
  ]);
});

test("unresolved or malformed recovery evidence stays ambiguous and never replays", async () => {
  const observations = new Observations(); observations.result = "unresolved";
  const reconciler = new HostOwnedOperationReconciler(observations);
  assert.deepEqual(await reconciler.reconcile(operation("git.push-reviewed-head", { remote: "https://github.com/acme/repo.git" })), {
    note: "The protected operation lacks an exact observation binding; it remains ambiguous and was not replayed."
  });
  assert.deepEqual(await reconciler.reconcile(operation("unknown.composite", {})), {
    note: "No read-only observation adapter is registered for this operation; it remains ambiguous and was not replayed."
  });
  const beforeLegacyAutomation = observations.calls.length;
  assert.deepEqual(await reconciler.reconcile(operation("automation.compound_capture", providerBinding({ routeId: "automation.compound_capture", providerAction: "compound_capture" }))), {
    note: "No read-only observation adapter is registered for this operation; it remains ambiguous and was not replayed."
  });
  assert.equal(observations.calls.length, beforeLegacyAutomation, "legacy provider-owned automation must never reach a provider observation route");
  assert.deepEqual(await reconciler.reconcile(operation("provider.artifact", providerBinding({ routeId: "provider.repair" }))), {
    note: "read-only provider observation", details: { reconciliation: "read-only-observation" }
  });
  const beforeMissingIdentity = observations.calls.length;
  assert.deepEqual(await reconciler.reconcile(operation("provider.artifact", providerBinding({ sessionId: "" }))), {
    note: "The protected operation lacks an exact observation binding; it remains ambiguous and was not replayed."
  });
  assert.equal(observations.calls.length, beforeMissingIdentity, "a partial provider identity must not reach any observer");
});

test("observed failure and cancellation settle only the existing generation", async () => {
  const observations = new Observations(); const reconciler = new HostOwnedOperationReconciler(observations);
  observations.result = "failed";
  assert.equal((await reconciler.reconcile(operation("open_chatgpt", {}, null))).state, "failed");
  observations.result = "cancelled";
  assert.equal((await reconciler.reconcile(operation("open_chatgpt", {}, null))).state, "cancelled");
});

test("installed observation port proves local HEAD/tree and remote ref only through read-only probes", async () => {
  const head = "b".repeat(40); const before = "a".repeat(40); const tree = "c".repeat(40);
  const git: CheckpointGitRunner = { async run(args) { const command = args.join(" "); return { exitCode: 0, stdout: Buffer.from(command.includes("%P") ? before : command.includes("%T") ? tree : head), stderr: "" }; } };
  const pkt = (value: string): Buffer => { const body = Buffer.from(value); return Buffer.concat([Buffer.from((body.length + 4).toString(16).padStart(4, "0")), body]); };
  const advertisement = Buffer.concat([pkt("# service=git-receive-pack\n"), Buffer.from("0000"), pkt(`${head} HEAD\0report-status\n`), pkt(`${head} refs/heads/feat/a\n`), Buffer.from("0000")]);
  const network = { async request(input: { routeId: string }) { assert.equal(input.routeId, "git.receive-pack.advertise"); return { outcome: "passed", routeId: input.routeId, detail: "observed", effectDisposition: "ambiguous", body: advertisement }; } } as unknown as DynamicConfiguredNetworkClient;
  const port = new InstalledReadOnlyObservationPort({ git, network, canonicalRepositoryRoot: async (root) => root });
  assert.equal((await port.localGit({ repositoryRoot: "C:\\repo", beforeHead: before, expectedTree: tree })).outcome, "committed");
  assert.equal((await port.remoteRef({ repositoryRoot: "C:\\repo", remote: "https://github.com/acme/repo.git", ref: "refs/heads/feat/a", expectedHead: head })).outcome, "committed");
});

test("local Git recovery refuses a merge or multi-parent commit even when its first parent and tree match", async () => {
  const head = "b".repeat(40); const before = "a".repeat(40); const tree = "c".repeat(40); const otherParent = "d".repeat(40);
  const git: CheckpointGitRunner = { async run(args) { const command = args.join(" "); return { exitCode: 0, stdout: Buffer.from(command.includes("%P") ? `${before} ${otherParent}` : command.includes("%T") ? tree : head), stderr: "" }; } };
  const port = new InstalledReadOnlyObservationPort({ git, canonicalRepositoryRoot: async (root) => root });
  assert.equal((await port.localGit({ repositoryRoot: "C:\\repo", beforeHead: before, expectedTree: tree })).outcome, "unresolved");
});

test("installed Git recovery refuses a configured route bound to another repository before observation", async () => {
  let requested = false;
  const network = { async request() { requested = true; throw new Error("must not request wrong route"); } } as unknown as DynamicConfiguredNetworkClient;
  const networkPolicy = { async resolve() { return { version: 1 as const, proxy: "direct" as const, routes: [
    { id: "github.graphql", method: "POST", url: "https://ghe.example.test/api/graphql", redirects: "deny" as const },
    { id: "git.receive-pack.advertise", method: "GET", url: "https://ghe.example.test/acme/other.git/info/refs?service=git-receive-pack", redirects: "deny" as const },
    { id: "git.receive-pack", method: "POST", url: "https://ghe.example.test/acme/other.git/git-receive-pack", redirects: "deny" as const }
  ] }; } };
  const git: CheckpointGitRunner = { async run() { return { exitCode: 1, stdout: Buffer.alloc(0), stderr: "unused" }; } };
  const port = new InstalledReadOnlyObservationPort({ git, network, networkPolicy, canonicalRepositoryRoot: async (root) => root });
  assert.equal((await port.remoteRef({ repositoryRoot: "C:\\repo", remote: "https://ghe.example.test/acme/project.git", ref: "refs/heads/main", expectedHead: "a".repeat(40) })).outcome, "unresolved");
  assert.equal((await port.pullRequest({ repositoryRoot: "C:\\repo", owner: "acme", name: "project", headOwner: "acme", headName: "project", number: 7, baseBranch: "main", expectedHead: "a".repeat(40), expectedState: "MERGED" })).outcome, "unresolved");
  assert.equal(requested, false);
});

test("installed PR recovery binds a fork head repository separately from the exact base repository", async () => {
  const head = "a".repeat(40); let requests = 0;
  const network = { async request(input: { routeId: string }) { requests += 1; assert.equal(input.routeId, "github.graphql"); return { outcome: "passed", routeId: input.routeId, detail: "read", body: Buffer.from(JSON.stringify({ data: { repository: { pullRequest: { number: 7, headRefOid: head, headRepository: { nameWithOwner: "contributor/project" }, baseRefName: "main", state: "MERGED" } } } })) }; } } as unknown as DynamicConfiguredNetworkClient;
  const networkPolicy = { async resolve() { return { version: 1 as const, proxy: "direct" as const, routes: [
    { id: "github.graphql", method: "POST", url: "https://api.github.com/graphql", redirects: "deny" as const },
    { id: "github.repository", method: "HEAD", url: "https://github.com/acme/project", redirects: "deny" as const },
    { id: "git.receive-pack.advertise", method: "GET", url: "https://github.com/contributor/project.git/info/refs?service=git-receive-pack", redirects: "deny" as const },
    { id: "git.receive-pack", method: "POST", url: "https://github.com/contributor/project.git/git-receive-pack", redirects: "deny" as const }
  ] }; } };
  const git: CheckpointGitRunner = { async run() { return { exitCode: 1, stdout: Buffer.alloc(0), stderr: "unused" }; } };
  const port = new InstalledReadOnlyObservationPort({ git, network, networkPolicy, canonicalRepositoryRoot: async (root) => root });
  assert.equal((await port.pullRequest({ repositoryRoot: "C:\\repo", owner: "acme", name: "project", headOwner: "contributor", headName: "project", number: 7, baseBranch: "main", expectedHead: head, expectedState: "MERGED" })).outcome, "committed");
  assert.equal((await port.pullRequest({ repositoryRoot: "C:\\repo", owner: "acme", name: "project", headOwner: "attacker", headName: "project", number: 7, baseBranch: "main", expectedHead: head, expectedState: "MERGED" })).outcome, "unresolved");
  assert.equal(requests, 1, "a mismatched fork identity is rejected before GraphQL observation");
});

test("installed PR and Council observers require exact typed identities and never mutate", async () => {
  const head = "b".repeat(40);
  const calls: string[] = [];
  const network = { async request(input: { routeId: string; repositoryRoot: string }) {
    calls.push(`${input.routeId}:${input.repositoryRoot}`);
    return { outcome: "passed", routeId: input.routeId, detail: "read", body: Buffer.from(JSON.stringify({ data: { repository: { pullRequest: { number: 7, headRefOid: head, headRepository: { nameWithOwner: "acme/project" }, baseRefName: "main", state: "MERGED" } } } })) };
  } } as unknown as DynamicConfiguredNetworkClient;
  const networkPolicy = { async resolve() { return { version: 1 as const, proxy: "direct" as const, routes: [
    { id: "github.graphql", method: "POST", url: "https://ghe.example.test/api/graphql", redirects: "deny" as const },
    { id: "git.receive-pack.advertise", method: "GET", url: "https://ghe.example.test/acme/project.git/info/refs?service=git-receive-pack", redirects: "deny" as const },
    { id: "git.receive-pack", method: "POST", url: "https://ghe.example.test/acme/project.git/git-receive-pack", redirects: "deny" as const }
  ] }; } };
  const git: CheckpointGitRunner = { async run() { return { exitCode: 1, stdout: Buffer.alloc(0), stderr: "unused" }; } };
  const council = { async get() { return { status: "awaiting_assignment_acknowledgements", targetSnapshotId: "snapshot-1", pauseAcknowledgedSessionIds: ["session-1"], assignmentAcknowledgedSessionIds: [] }; } };
  const port = new InstalledReadOnlyObservationPort({ git, network, networkPolicy, council, canonicalRepositoryRoot: async (root) => root });
  assert.equal((await port.pullRequest({ repositoryRoot: "C:\\repo", owner: "acme", name: "project", headOwner: "acme", headName: "project", number: 7, baseBranch: "main", expectedHead: head, expectedState: "MERGED" })).outcome, "committed");
  assert.equal((await port.provider({ operationId: "provider-operation-7", action: "proof", sessionId: "session-1", provider: "codex", authorityId: "authority-1", repositoryRoot: "C:\\repo", routeId: "provider.proof", externalId: "provider-7", targetSnapshotId: "snapshot-1" })).outcome, "unresolved");
  assert.equal((await port.council({ epochId: "epoch-1", phase: "pause", sessionId: "session-1", targetSnapshotId: "snapshot-1" })).outcome, "committed");
  assert.deepEqual(calls, ["github.graphql:C:\\repo"], "provider recovery must not use an unauthenticated network fallback");
});

test("recovery refuses a canonical repository-root change before any Git or network probe", async () => {
  let probed = false;
  const git: CheckpointGitRunner = { async run() { probed = true; return { exitCode: 0, stdout: Buffer.from("a".repeat(40)), stderr: "" }; } };
  const network = { async request() { probed = true; throw new Error("must not run"); } } as unknown as DynamicConfiguredNetworkClient;
  const port = new InstalledReadOnlyObservationPort({ git, network, canonicalRepositoryRoot: async () => "C:\\redirected" });
  assert.equal((await port.localGit({ repositoryRoot: "C:\\repo", beforeHead: "a".repeat(40), expectedTree: "b".repeat(40) })).outcome, "unresolved");
  assert.equal((await port.provider({ operationId: "provider-operation", action: "proof", sessionId: "session-1", provider: "codex", authorityId: "authority-1", repositoryRoot: "C:\\repo", routeId: "provider.proof", externalId: "external", targetSnapshotId: "snapshot" })).outcome, "unresolved");
  assert.equal(probed, false);
});

test("installed recovery prefers the authenticated local provider gateway and never duplicates a network observation", async () => {
  let localCalls = 0;
  let networkCalls = 0;
  const git: CheckpointGitRunner = { async run() { return { exitCode: 1, stdout: Buffer.alloc(0), stderr: "unused" }; } };
  const providerOperations = {
    async observeProviderOperation(input: { operationId: string; action: string; sessionId: string; provider: string; authorityId: string; externalId: string; targetSnapshotId: string }) {
      localCalls += 1;
      assert.equal(input.operationId, "provider-operation-1");
      assert.equal(input.action, "proof");
      assert.equal(input.sessionId, "session-1");
      assert.equal(input.provider, "codex");
      assert.equal(input.authorityId, "authority-1");
      assert.equal(input.externalId, "operation-provider-1");
      assert.equal(input.targetSnapshotId, "snapshot-1");
      return { outcome: "committed" as const, note: "The authenticated local gateway observed the exact operation.", details: { provider: "codex" } };
    }
  };
  const network = { async request() { networkCalls += 1; throw new Error("must not duplicate local observation"); } } as unknown as DynamicConfiguredNetworkClient;
  const port = new InstalledReadOnlyObservationPort({ git, providerOperations, network, canonicalRepositoryRoot: async (root) => root });
  assert.deepEqual(await port.provider({ operationId: "provider-operation-1", action: "proof", sessionId: "session-1", provider: "codex", authorityId: "authority-1", repositoryRoot: "C:\\repo", routeId: "provider.proof", externalId: "operation-provider-1", targetSnapshotId: "snapshot-1" }), {
    outcome: "committed",
    note: "The authenticated local gateway observed the exact operation.",
    details: { provider: "codex" }
  });
  assert.equal(localCalls, 1);
  assert.equal(networkCalls, 0);
});

test("provider recovery selects exactly one durable controller from the protected provider identity", async () => {
  const calls: string[] = [];
  const local = {
    supportsProvider(provider: string) { return provider === "codex"; },
    async observeProviderOperation(input: { provider: string }) { calls.push(`local:${input.provider}`); return { outcome: "committed" as const, note: "local" }; }
  };
  const configured = {
    async observeProviderOperation(input: { provider: string }) { calls.push(`configured:${input.provider}`); return { outcome: "failed" as const, note: "configured" }; }
  };
  const router = createExactProviderRecoveryRouter({ local: local as never, configured: configured as never });
  const binding = { operationId: "provider-operation", action: "proof" as const, sessionId: "session-1", authorityId: "authority-1", repositoryRoot: "C:\\repo", routeId: "provider.proof", externalId: "external-1", targetSnapshotId: "snapshot-1" };
  assert.equal((await router.observeProviderOperation({ ...binding, provider: "codex" }))?.outcome, "committed");
  assert.equal((await router.observeProviderOperation({ ...binding, provider: "claude" }))?.outcome, "failed");
  assert.deepEqual(calls, ["local:codex", "configured:claude"]);
});
