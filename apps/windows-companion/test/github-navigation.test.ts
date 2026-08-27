import assert from "node:assert/strict";
import test from "node:test";

import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { ConfiguredGitHubNavigationResolver } from "../src/github-navigation.ts";
import { configuredGitHostFromPolicy } from "../src/remote-git.ts";
import type { DynamicConfiguredNetworkClient } from "../src/remote-adapters.ts";

const head = "a".repeat(40);
const target: TargetSnapshot = {
  id: "target-github-navigation", repositoryRoot: "C:\\repo", canonicalRemote: "https://github.com/contributor/project.git",
  branch: "feature/exact", head, indexTree: "b".repeat(40), trackedManifest: "c".repeat(64), untrackedManifest: "d".repeat(64),
  submodules: {}, policyVersion: "policy", environmentFingerprint: "e".repeat(64), capturedAt: "2026-08-24T00:00:00.000Z", completeness: "complete", reasons: []
};

const policy = {
  version: 1 as const, proxy: "direct" as const, routes: [
    { id: "github.graphql", method: "POST", url: "https://api.github.com/graphql", redirects: "deny" as const },
    { id: "github.repository", method: "HEAD", url: "https://github.com/acme/project", redirects: "deny" as const },
    { id: "git.receive-pack.advertise", method: "GET", url: "https://github.com/contributor/project.git/info/refs?service=git-receive-pack", redirects: "deny" as const },
    { id: "git.receive-pack", method: "POST", url: "https://github.com/contributor/project.git/git-receive-pack", redirects: "deny" as const }
  ]
};

function request(action: "github_home" | "github_pr" | "github_issues" | "github_actions", allowed = true) {
  return {
    definition: commandForAction(action), operationId: `operation-${action}`, target,
    effectGuard: { async assertCurrent() { return { allowed, reason: allowed ? "current" : "TargetSnapshot changed." }; } }
  };
}

test("repository home and issues navigation require the installed exact host identity", async () => {
  const navigation = resolver([]);
  assert.deepEqual(await navigation.resolve(request("github_home"), "home"), { kind: "open", url: "https://github.com/contributor/project", summary: "Resolved the exact installed workspace repository home." });
  assert.deepEqual(await navigation.resolve(request("github_issues"), "issues"), { kind: "open", url: "https://github.com/contributor/project/issues", summary: "Resolved the exact installed workspace repository issues list." });
});

test("GitHub navigation bounds unavailable initial and in-flight cancellation reads", async () => {
  let initialReads = 0;
  const initialStarted = Date.now();
  const initial = await resolver([]).resolve({
    ...request("github_home"),
    executionControl: {
      operationId: "operation-github_home",
      deadline: new Date(Date.now() + 40).toISOString(),
      async isCancellationRequested() { initialReads += 1; return new Promise<boolean>(() => undefined); }
    }
  }, "home");
  assert.equal(initial.kind, "blocked");
  assert.equal(initialReads, 1);
  assert.ok(Date.now() - initialStarted < 1_000);

  let reads = 0;
  let networkCalls = 0;
  const navigation = new ConfiguredGitHubNavigationResolver({ async request(input: { signal: AbortSignal }) {
    networkCalls += 1;
    if (!input.signal.aborted) await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
    return { outcome: "failed", routeId: "github.graphql", detail: "aborted", effectDisposition: "ambiguous" };
  } } as unknown as DynamicConfiguredNetworkClient, { async resolve() { return configuredGitHostFromPolicy(policy); } });
  const interrupted = await navigation.resolve({
    ...request("github_pr"),
    executionControl: {
      operationId: "operation-github_pr",
      deadline: new Date(Date.now() + 180).toISOString(),
      async isCancellationRequested() {
        reads += 1;
        if (reads <= 2) return false;
        return new Promise<boolean>(() => undefined);
      }
    }
  }, "pr");
  assert.equal(interrupted.kind, "blocked");
  assert.equal(reads, 3);
  assert.equal(networkCalls, 1);
});

function resolver(responses: unknown[], calls: Array<{ query: string; variables: Record<string, unknown> }> = []) {
  const network = { async request(input: { routeId: string; body?: Uint8Array }) {
    assert.equal(input.routeId, "github.graphql");
    const parsed = JSON.parse(Buffer.from(input.body ?? []).toString("utf8")) as { query: string; variables: Record<string, unknown> };
    calls.push(parsed);
    return { outcome: "passed", routeId: input.routeId, detail: "ok", effectDisposition: "ambiguous", body: Buffer.from(JSON.stringify({ data: responses.shift() })) };
  } } as unknown as DynamicConfiguredNetworkClient;
  return new ConfiguredGitHubNavigationResolver(network, { async resolve() { return configuredGitHostFromPolicy(policy); } });
}

test("current-branch PR navigation resolves the exact fork head repository and never guesses from a search URL", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const navigation = resolver([{ repository: { pullRequests: { nodes: [
    { number: 17, url: "https://github.com/acme/project/pull/17", headRefName: "feature/exact", headRefOid: head, headRepository: { nameWithOwner: "contributor/project" }, baseRefName: "main", state: "OPEN", updatedAt: "2026-08-24T10:00:00.000Z" },
    { number: 18, url: "https://github.com/acme/project/pull/18", headRefName: "feature/exact", headRefOid: head, headRepository: { nameWithOwner: "attacker/project" }, baseRefName: "release", state: "OPEN", updatedAt: "2026-08-24T11:00:00.000Z" }
  ] } } }], calls);
  const result = await navigation.resolve(request("github_pr"), "pr");
  assert.deepEqual(result, { kind: "open", url: "https://github.com/acme/project/pull/17", summary: "Resolved pull request #17 for contributor/project:feature/exact into acme/project:main." });
  assert.deepEqual(calls[0]?.variables, { owner: "acme", name: "project", head: "feature/exact" });
});

test("multiple exact current-branch PR identities return a bounded picker and no guessed destination", async () => {
  const pull = (number: number, base: string, updatedAt: string) => ({ number, url: `https://github.com/acme/project/pull/${number}`, headRefName: "feature/exact", headRefOid: head, headRepository: { nameWithOwner: "contributor/project" }, baseRefName: base, state: "OPEN", updatedAt });
  const result = await resolver([{ repository: { pullRequests: { nodes: [pull(4, "release", "2026-08-24T09:00:00.000Z"), pull(3, "main", "2026-08-24T10:00:00.000Z")] } } }]).resolve(request("github_pr"), "pr");
  assert.equal(result.kind, "picker");
  if (result.kind !== "picker") return;
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["pull:3", "pull:4"]);
  assert.equal(result.candidates.every((candidate) => candidate.url.includes("/pull/")), true);
});

test("current-head Actions navigation opens one exact run or returns a bounded workflow picker", async () => {
  const one = await resolver([{ repository: { object: { oid: head, statusCheckRollup: { contexts: { nodes: [
    { __typename: "CheckRun", name: "test", detailsUrl: "https://github.com/contributor/project/actions/runs/90/job/11", startedAt: "2026-08-24T10:00:00.000Z", completedAt: null }
  ] } } } } }]).resolve(request("github_actions"), "actions");
  assert.deepEqual(one, { kind: "open", url: "https://github.com/contributor/project/actions/runs/90", summary: "Resolved the exact current-head Actions run 90 (test)." });

  const many = await resolver([{ repository: { object: { oid: head, statusCheckRollup: { contexts: { nodes: [
    { __typename: "CheckRun", name: "lint", detailsUrl: "https://github.com/contributor/project/actions/runs/91/job/12", startedAt: "2026-08-24T11:00:00.000Z", completedAt: "2026-08-24T11:02:00.000Z" },
    { __typename: "CheckRun", name: "test", detailsUrl: "https://github.com/contributor/project/actions/runs/90/job/11", startedAt: "2026-08-24T10:00:00.000Z", completedAt: "2026-08-24T10:03:00.000Z" }
  ] } } } } }]).resolve(request("github_actions"), "actions");
  assert.equal(many.kind, "picker");
  if (many.kind === "picker") assert.deepEqual(many.candidates.map((candidate) => candidate.id), ["run:91", "run:90"]);
});

test("GitHub navigation rechecks the target before the authenticated query and rejects foreign result URLs", async () => {
  let networkCalls = 0;
  const blockedNetwork = { async request() { networkCalls += 1; throw new Error("must not run"); } } as unknown as DynamicConfiguredNetworkClient;
  const blocked = await new ConfiguredGitHubNavigationResolver(blockedNetwork, { async resolve() { return configuredGitHostFromPolicy(policy); } }).resolve(request("github_pr", false), "pr");
  assert.deepEqual(blocked, { kind: "blocked", summary: "TargetSnapshot changed." });
  assert.equal(networkCalls, 0);

  const foreign = await resolver([{ repository: { pullRequests: { nodes: [
    { number: 17, url: "https://evil.example/acme/project/pull/17", headRefName: "feature/exact", headRefOid: head, headRepository: { nameWithOwner: "contributor/project" }, baseRefName: "main", state: "OPEN", updatedAt: "2026-08-24T10:00:00.000Z" }
  ] } } }]).resolve(request("github_pr"), "pr");
  assert.equal(foreign.kind, "failed");
});
