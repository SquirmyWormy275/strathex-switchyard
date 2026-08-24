import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { CompositePipelineStatusAdapter, ConfiguredGitHubPipelineAdapter, DurablePipelineFailureCursor } from "../src/pipeline-adapters.ts";
import { configuredGitHostFromPolicy } from "../src/remote-git.ts";
import type { DynamicConfiguredNetworkClient } from "../src/remote-adapters.ts";

const target: TargetSnapshot = {
  id: "target-pipeline",
  repositoryRoot: "C:\\repo",
  branch: "feature/pipeline",
  head: "a".repeat(40),
  indexTree: "b".repeat(40),
  trackedManifest: "c".repeat(64),
  untrackedManifest: "d".repeat(64),
  canonicalRemote: "https://github.com/acme/project.git",
  submodules: {},
  policyVersion: "test",
  environmentFingerprint: "e".repeat(64),
  capturedAt: "2026-08-24T00:00:00.000Z",
  completeness: "complete",
  reasons: []
};

function request(action: "pipeline_status" | "pipeline_failure_trace") {
  return {
    definition: { action } as never,
    operationId: `operation-${action}`,
    target,
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } }
  };
}

const host = configuredGitHostFromPolicy({ version: 1, proxy: "direct", routes: [
  { id: "github.graphql", method: "POST", url: "https://api.github.com/graphql", redirects: "deny" },
  { id: "github.repository", method: "HEAD", url: "https://github.com/acme/project", redirects: "deny" },
  { id: "git.receive-pack.advertise", method: "GET", url: "https://github.com/acme/project.git/info/refs?service=git-receive-pack", redirects: "deny" },
  { id: "git.receive-pack", method: "POST", url: "https://github.com/acme/project.git/git-receive-pack", redirects: "deny" }
] });
const hostResolver = { async resolve() { return host; } };

test("pipeline adapter binds GitHub status to the exact target head and protected local receipts", async () => {
  const calls: unknown[] = [];
  const adapter = new ConfiguredGitHubPipelineAdapter({
    async request(input: unknown) {
      calls.push(input);
      return {
        outcome: "passed",
        routeId: "github.graphql",
        detail: "ok",
        body: Buffer.from(JSON.stringify({
          data: {
            repository: {
              object: {
                oid: target.head,
                statusCheckRollup: {
                  state: "FAILURE",
                  contexts: {
                    nodes: [
                      { __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/acme/project/actions/runs/1", title: "Unit tests", summary: "One test failed", text: null },
                      { __typename: "StatusContext", context: "lint", state: "SUCCESS", targetUrl: "https://github.com/acme/project/actions/runs/2", description: "Lint passed" }
                    ]
                  }
                }
              }
            }
          }
        }))
      };
    }
  } as unknown as DynamicConfiguredNetworkClient, {
    async list() {
      return [{
        id: "receipt:local",
        operationId: "operation-local",
        action: "pipeline_local_gate",
        targetSnapshotId: target.id,
        result: "passed",
        completeness: "complete",
        summary: "Local gate passed.",
        evidence: {},
        toolVersions: {},
        createdAt: "2026-08-24T00:00:00.000Z"
      }] as never;
    }
  }, hostResolver);

  const status = await adapter.execute(request("pipeline_status"));
  assert.equal(status.status, "completed");
  assert.equal(status.data?.head, target.head);
  assert.equal(status.data?.hostedState, "FAILURE");
  assert.equal(status.data?.failingCount, 1);
  assert.equal((status.data?.localReceipts as readonly unknown[]).length, 1);

  const trace = await adapter.execute(request("pipeline_failure_trace"));
  assert.equal(trace.status, "completed");
  assert.match(trace.summary, /Failure 1 of 1.*unit.*test assertion/i);
  assert.equal(trace.data?.repeatAvailable, false);
  assert.equal(calls.length, 2);
});

test("pipeline adapter refuses a response for a different head and rechecks the effect guard", async () => {
  let calls = 0;
  const network = {
    async request() {
      calls += 1;
      return { outcome: "passed", routeId: "github.graphql", detail: "ok", body: Buffer.from(JSON.stringify({ data: { repository: { object: { oid: "f".repeat(40), statusCheckRollup: null } } } })) };
    }
  } as unknown as DynamicConfiguredNetworkClient;
  const adapter = new ConfiguredGitHubPipelineAdapter(network, { async list() { return []; } }, hostResolver);
  const wrongHead = await adapter.execute(request("pipeline_status"));
  assert.equal(wrongHead.status, "failed");

  const stale = await adapter.execute({ ...request("pipeline_status"), effectGuard: { async assertCurrent() { return { allowed: false, reason: "target changed" }; } } });
  assert.equal(stale.status, "blocked");
  assert.equal(calls, 1);
});

test("pipeline adapter binds remote and result URLs to the configured GitHub Enterprise host", async () => {
  const enterpriseTarget = { ...target, canonicalRemote: "ssh://git@ghe.example.test/acme/project.git" };
  const adapter = new ConfiguredGitHubPipelineAdapter({
    async request() {
      return { outcome: "passed", routeId: "github.graphql", detail: "ok", body: Buffer.from(JSON.stringify({ data: { repository: { object: { oid: enterpriseTarget.head, statusCheckRollup: { state: "FAILURE", contexts: { nodes: [
        { __typename: "CheckRun", name: "enterprise-unit", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ghe.example.test/acme/project/actions/runs/9", title: "Unit", summary: "failed", text: null }
      ] } } } } } })) };
    }
  } as unknown as DynamicConfiguredNetworkClient, { async list() { return []; } }, { async resolve() { return configuredGitHostFromPolicy({ version: 1, proxy: "direct", routes: [
    { id: "github.graphql", method: "POST", url: "https://ghe.example.test/api/graphql", redirects: "deny" },
    { id: "github.repository", method: "HEAD", url: "https://ghe.example.test/acme/project", redirects: "deny" },
    { id: "git.receive-pack.advertise", method: "GET", url: "https://ghe.example.test/acme/project.git/info/refs?service=git-receive-pack", redirects: "deny" },
    { id: "git.receive-pack", method: "POST", url: "https://ghe.example.test/acme/project.git/git-receive-pack", redirects: "deny" }
  ] }); } });
  const result = await adapter.execute({ ...request("pipeline_failure_trace"), target: enterpriseTarget });
  assert.equal(result.status, "completed");
  assert.equal((result.data?.selectedFailure as { url?: string })?.url, "https://ghe.example.test/acme/project/actions/runs/9");

  const wrongHost = await adapter.execute(request("pipeline_status"));
  assert.equal(wrongHost.status, "blocked");
});

test("failure trace retrieves bounded authenticated output, diagnoses it, and cycles durably across restart", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-pipeline-cursor-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const authenticator: JournalAuthenticator = { provider: "pipeline-test", async seal(hash) { return `test:${hash}`; }, async verify(hash, tag) { return tag === `test:${hash}`; } };
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator });
  const response = () => ({ outcome: "passed", routeId: "github.graphql", detail: "ok", body: Buffer.from(JSON.stringify({ data: { repository: { object: { oid: target.head, statusCheckRollup: { state: "FAILURE", contexts: { nodes: [
    { __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/acme/project/actions/runs/10/job/2", title: "Unit", summary: "AssertionError: expected 2 but received 3", text: "token=ghp_must_not_escape", startedAt: "2026-08-24T10:00:00.000Z", completedAt: "2026-08-24T10:01:00.000Z" },
    { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "TIMED_OUT", detailsUrl: "https://github.com/acme/project/actions/runs/11/job/3", title: "Build", summary: "Process timed out after 30 minutes", text: "x".repeat(10_000), startedAt: "2026-08-24T11:00:00.000Z", completedAt: "2026-08-24T11:30:00.000Z" }
  ] } } } } } })) });
  const network = { async request() { return response(); } } as unknown as DynamicConfiguredNetworkClient;
  const receipts = { async list() { return []; } };
  const first = await new ConfiguredGitHubPipelineAdapter(network, receipts, hostResolver, new DurablePipelineFailureCursor(store)).execute(request("pipeline_failure_trace"));
  assert.equal(first.status, "completed");
  assert.equal((first.data?.selectedFailure as { name: string }).name, "unit");
  assert.match(String(first.data?.diagnosis), /test assertion/i);
  assert.doesNotMatch(JSON.stringify(first.data), /ghp_must_not_escape/);

  const restarted = await new ConfiguredGitHubPipelineAdapter(network, receipts, hostResolver, new DurablePipelineFailureCursor(store)).execute(request("pipeline_failure_trace"));
  assert.equal((restarted.data?.selectedFailure as { name: string }).name, "build");
  assert.match(String(restarted.data?.diagnosis), /time budget/i);
  assert.ok(String(restarted.data?.logExcerpt).length <= 4_096);
  assert.equal(restarted.data?.repeatAvailable, true);
});

test("composite pipeline status preserves local evidence when hosted CI is unavailable", async () => {
  const adapter = new CompositePipelineStatusAdapter(
    { id: "local", kind: "generic", async execute() { return { status: "completed", summary: "Local diff check passed.", effectDisposition: "committed" as const, data: { clean: true } }; } },
    { id: "hosted", kind: "generic", async execute() { return { status: "unavailable", summary: "No configured hosted route.", effectDisposition: "not_started" as const }; } }
  );
  const outcome = await adapter.execute(request("pipeline_status"));
  assert.equal(outcome.status, "unavailable");
  assert.match(outcome.summary, /not hosted CI evidence/);
  assert.equal((outcome.data?.local as { status: string }).status, "completed");
  assert.equal((outcome.data?.hosted as { status: string }).status, "unavailable");
  assert.equal(outcome.data?.completeness, "partial");
});

test("composite pipeline status never lets hosted success overwrite a local inspection failure", async () => {
  const adapter = new CompositePipelineStatusAdapter(
    { id: "local", kind: "generic", async execute() { return { status: "failed", summary: "Local gate failed.", effectDisposition: "committed" as const }; } },
    { id: "hosted", kind: "generic", async execute() { return { status: "completed", summary: "Hosted checks passed.", effectDisposition: "committed" as const }; } }
  );
  const outcome = await adapter.execute(request("pipeline_status"));
  assert.equal(outcome.status, "failed");
  assert.equal((outcome.data?.local as { status: string }).status, "failed");
  assert.equal((outcome.data?.hosted as { status: string }).status, "completed");
});
