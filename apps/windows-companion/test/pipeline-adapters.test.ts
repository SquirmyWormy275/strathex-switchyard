import assert from "node:assert/strict";
import test from "node:test";

import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { CompositePipelineStatusAdapter, ConfiguredGitHubPipelineAdapter } from "../src/pipeline-adapters.ts";
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
  });

  const status = await adapter.execute(request("pipeline_status"));
  assert.equal(status.status, "completed");
  assert.equal(status.data?.head, target.head);
  assert.equal(status.data?.hostedState, "FAILURE");
  assert.equal(status.data?.failingCount, 1);
  assert.equal((status.data?.localReceipts as readonly unknown[]).length, 1);

  const trace = await adapter.execute(request("pipeline_failure_trace"));
  assert.equal(trace.status, "completed");
  assert.match(trace.summary, /unit=FAILURE/);
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
  const adapter = new ConfiguredGitHubPipelineAdapter(network, { async list() { return []; } });
  const wrongHead = await adapter.execute(request("pipeline_status"));
  assert.equal(wrongHead.status, "failed");

  const stale = await adapter.execute({ ...request("pipeline_status"), effectGuard: { async assertCurrent() { return { allowed: false, reason: "target changed" }; } } });
  assert.equal(stale.status, "blocked");
  assert.equal(calls, 1);
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
