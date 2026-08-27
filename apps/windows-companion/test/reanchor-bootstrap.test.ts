import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, sha256, stableJson, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import type { CoordinatorEvidenceBundle } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { companionBridgeVersion } from "../src/bridge.ts";
import { createDurableWindowsCompanion } from "../src/bootstrap.ts";
import { DeterministicProviderGatewayBackend } from "../src/provider-gateway.ts";

const authenticator: JournalAuthenticator = {
  provider: "isolated-reanchor-bootstrap",
  async seal(hash) { return `isolated:${hash}`; },
  async verify(hash, tag) { return tag === `isolated:${hash}`; }
};

function snapshot(head: string, trackedManifest: string, capturedAt: string): TargetSnapshot {
  const material = {
    repositoryRoot: "C:/safe/reanchor-bootstrap",
    canonicalRemote: "https://github.com/example/reanchor.git",
    branch: "feature/reanchor",
    head,
    indexTree: `tree-${head}`,
    trackedManifest,
    untrackedManifest: "untracked",
    submodules: {},
    policyVersion: "policy-1",
    environmentFingerprint: "environment",
    completeness: "complete" as const,
    reasons: [] as readonly string[]
  };
  return { id: targetSnapshotDigest(material), ...material, capturedAt };
}

function evidence(sessionId: string, taskId: string, planRevision: string, targetSnapshotId: string): CoordinatorEvidenceBundle {
  const planMaterial = {
    revision: planRevision,
    originSessionId: sessionId,
    taskId,
    objective: "Reread the accepted context and inspect the current work before reporting.",
    steps: [{ id: "step-1", summary: "Inspect current work", ownedFiles: ["src/reanchor.ts"], dependencies: [], status: "approved" as const }],
    decisions: ["Re-anchor never resumes automatically."],
    expectedTargetTransition: { beforeTargetSnapshotId: targetSnapshotId, expectedAfterTargetSnapshotId: targetSnapshotId, expectation: "unchanged" as const }
  };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const material = {
    instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context" as const, summary: "Accepted instructions" }],
    plan,
    documentation: [{ id: "design", digest: "2".repeat(64), source: "repository" as const, summary: "Accepted design" }],
    diff: { id: "diff", digest: "3".repeat(64), source: "target_snapshot" as const, summary: "Current diff" },
    files: [{ id: "source", digest: "4".repeat(64), source: "repository" as const, summary: "Current source" }],
    tests: [{ id: "tests", digest: "5".repeat(64), source: "receipt" as const, summary: "Current tests", status: "passed" as const }]
  };
  return { contextDigest: sha256(stableJson(material)), ...material };
}

test("installed bootstrap exposes the dedicated Re-anchor lifecycle and reaches the provider without weakening either target", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-reanchor-bootstrap-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const oldTarget = snapshot("old-head", "tracked-old", "2026-08-26T10:00:00.000Z");
  const newTarget = snapshot("new-head", "tracked-new", "2026-08-26T10:01:00.000Z");
  const backend = new DeterministicProviderGatewayBackend("codex");
  const companion = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator }),
    policyVersion: "policy-1",
    localStateDirectory: folder,
    targetResolver: { resolve: async () => newTarget },
    providerGatewayBackends: [backend],
    runtimePinPresence: {
      async verify() { return { verified: true, operator: "Current User", method: "windows-user-presence" }; }
    }
  });
  await companion.executor.snapshots.record(oldTarget);
  const session = await companion.registerTrustedSession({
    id: "reanchor-session",
    provider: "codex",
    surface: "vscode_terminal",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running",
    workspaceRoot: oldTarget.repositoryRoot,
    targetSnapshotId: oldTarget.id,
    taskId: "task-1",
    planRevision: "plan-1",
    plannedFiles: ["src/reanchor.ts"],
    lastHeartbeat: new Date().toISOString(),
    adapterVersion: "reanchor-bootstrap-test",
    metadata: {
      "sxsy-b122.providerHandshake": "exact-route-v1",
      "sxsy-b122.providerHandshakeTarget": oldTarget.id
    }
  });
  const authority = await companion.executor.authorities.issue({
    repositoryRoot: oldTarget.repositoryRoot,
    sessionId: session.id,
    taskId: session.taskId,
    planRevision: session.planRevision,
    allowedActions: ["reanchor"],
    prohibitedActions: [],
    expiresAt: "2099-01-01T00:00:00.000Z",
    issuedBy: "Current User"
  });
  await companion.registerTrustedWorkflowContext({
    sessionId: session.id,
    repositoryRoot: oldTarget.repositoryRoot,
    targetSnapshotId: oldTarget.id,
    authorityId: authority.id,
    sourceRevision: 1,
    evidence: evidence(session.id, session.taskId!, session.planRevision!, oldTarget.id),
    pendingDecisions: [{ id: "decision-1", question: "Should a later resume be separately authorized?", context: "The current lifecycle ends stopped." }]
  });

  await companion.endpoint.ready();
  const eligible = await companion.endpoint.handle({
    version: companionBridgeVersion,
    id: "eligible",
    method: "reanchor.authority.list",
    payload: { sessionId: session.id }
  });
  assert.equal(eligible.ok, true, JSON.stringify(eligible));
  assert.deepEqual((eligible.result as { authorities: readonly { id: string }[] }).authorities.map((item) => item.id), [authority.id]);

  const begun = await companion.endpoint.handle({
    version: companionBridgeVersion,
    id: "begin",
    method: "reanchor.begin",
    payload: { sessionId: session.id, authorityId: authority.id, reason: "The repository changed while the provider session was active." }
  });
  assert.equal(begun.ok, true, JSON.stringify(begun));
  const requestId = (begun.result as { reanchor: { requestId: string; state: string } }).reanchor.requestId;
  assert.equal((begun.result as { reanchor: { state: string } }).reanchor.state, "pending_confirmation");

  const applied = await companion.endpoint.handle({
    version: companionBridgeVersion,
    id: "apply",
    method: "reanchor.confirm-apply",
    payload: { requestId }
  });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const status = (applied.result as { reanchor: { state: string; receipt?: { result: string; resumed: boolean }; discrepancies?: readonly string[] } }).reanchor;
  assert.equal(status.state, "recorded");
  assert.equal(status.receipt?.result, "reanchored_without_resume");
  assert.equal(status.receipt?.resumed, false);
  assert.ok(status.discrepancies?.length);
  assert.equal(backend.reanchorCalls, 1);
  const rebound = await companion.sessions.get(session.id);
  assert.equal(rebound?.targetSnapshotId, newTarget.id);
  assert.equal(rebound?.status, "unknown");
  assert.equal(rebound?.metadata["sxsy-b122.reanchor.resumeAuthorized"], "false");
});
