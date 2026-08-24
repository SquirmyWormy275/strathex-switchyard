import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { ProtectedJsonStore } from "../src/store.ts";
import {
  WorkflowArtifactStore,
  parseWorkflowProviderResponse,
  type WorkflowArtifactInput
} from "../src/workflow-artifacts.ts";

async function store(context: TestContext): Promise<ProtectedJsonStore> {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-workflow-artifacts-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  return new ProtectedJsonStore({ filePath: join(folder, "journal.jsonl") });
}

function base(action: WorkflowArtifactInput["action"], payload: WorkflowArtifactInput["payload"]): WorkflowArtifactInput {
  return {
    id: `artifact-${action}`,
    action,
    repositoryRoot: "C:\\repo",
    targetSnapshotId: "a".repeat(64),
    sessionId: "session-1",
    taskId: "task-1",
    planRevision: "plan-7",
    payload
  } as WorkflowArtifactInput;
}

test("durably claims one exact five-option decision artifact for one provider operation", async (context) => {
  const journal = await store(context);
  const artifacts = new WorkflowArtifactStore(journal, { clock: () => "2026-08-24T12:00:00.000Z" });
  const input = base("option_provider", {
    kind: "decision",
    question: "Which safe integration should we ship?",
    options: Array.from({ length: 5 }, (_, index) => ({ id: `option-${index + 1}`, label: `Option ${index + 1}`, tradeoffs: [`tradeoff-${index + 1}`], risks: [`risk-${index + 1}`] })),
    recommendationId: "option-2"
  });
  const created = await artifacts.create(input);
  assert.equal(created.status, "prepared");
  assert.match(created.digest, /^[a-f0-9]{64}$/);

  const claimed = await artifacts.claimForDispatch({ action: "option_provider", targetSnapshotId: created.targetSnapshotId, sessionId: created.sessionId, operationId: "operation-1" });
  assert.equal(claimed?.id, created.id);
  assert.equal(claimed?.operationId, "operation-1");
  assert.equal(await artifacts.claimForDispatch({ action: "option_provider", targetSnapshotId: created.targetSnapshotId, sessionId: created.sessionId, operationId: "operation-2" }), undefined);

  const restarted = new WorkflowArtifactStore(journal);
  assert.equal((await restarted.get(created.id))?.operationId, "operation-1");
  const decision = input.payload as Extract<WorkflowArtifactInput["payload"], { kind: "decision" }>;
  await assert.rejects(() => restarted.create(base("option_packet", { ...decision, options: decision.options.slice(0, 4) })), /exactly five/i);
});

test("plan execution requires an explicit approved revision and immutable owned-file steps", async (context) => {
  const artifacts = new WorkflowArtifactStore(await store(context));
  const plan = {
    kind: "plan" as const,
    objective: "Finish the reviewed integration",
    steps: [{ id: "step-1", summary: "Implement exact route", ownedFiles: ["src/safe.ts"], dependencies: [], status: "approved" as const }],
    approved: false,
    approvedBy: "",
    approvedAt: ""
  };
  await assert.rejects(() => artifacts.create(base("plan_approval", plan)), /approved/i);
  const approved = await artifacts.create(base("plan_approval", { ...plan, approved: true, approvedBy: "operator", approvedAt: "2026-08-24T12:00:00.000Z" }));
  assert.equal(approved.action, "plan_approval");
  await assert.rejects(() => artifacts.create(base("plan_expander", { ...plan, steps: [{ ...plan.steps[0], ownedFiles: ["../escape.ts"] }] })), /owned file/i);
});

test("provider response is exact, artifact-bound, and action-schema validated before acknowledgement", async (context) => {
  const artifacts = new WorkflowArtifactStore(await store(context));
  const artifact = await artifacts.create(base("proof", {
    kind: "proof",
    claims: ["The local test passed."],
    evidenceReferences: ["receipt:123"],
    requiredBackends: ["local"]
  }));
  const submitted = await artifacts.claimForDispatch({ action: "proof", targetSnapshotId: artifact.targetSnapshotId, sessionId: artifact.sessionId, operationId: "operation-proof" });
  assert.ok(submitted);
  const response = parseWorkflowProviderResponse({
    schema: "sxsy-b122.workflow-result",
    version: 1,
    artifactId: submitted.id,
    artifactDigest: submitted.digest,
    operationId: "operation-proof",
    action: "proof",
    status: "completed",
    effectDisposition: "committed",
    summary: "Provider verified the cited evidence.",
    externalId: "provider-proof-1",
    result: { kind: "proof", verifiedClaims: ["The local test passed."], evidenceReferences: ["receipt:123"], backendResults: [{ backend: "local", status: "passed" }] }
  }, submitted);
  assert.equal(response.effectDisposition, "committed");
  const acknowledged = await artifacts.acknowledge(response);
  assert.equal(acknowledged.status, "acknowledged");

  assert.throws(() => parseWorkflowProviderResponse({ ...response, artifactDigest: "f".repeat(64) }, submitted), /digest/i);
  assert.throws(() => parseWorkflowProviderResponse({ ...response, result: { kind: "decision", selectedOptionId: "option-1" } }, submitted), /result/i);
});

test("handoff, authority, focus, and voice bindings retain typed non-executing intent", async (context) => {
  const artifacts = new WorkflowArtifactStore(await store(context));
  const inputs: WorkflowArtifactInput[] = [
    base("handoff_queue", { kind: "handoff", packageId: "handoff-1", route: "queue", recipientSessionId: "session-2" }),
    base("authority_broadcast", { kind: "authority", grantId: "grant-1", actions: ["proof"], recipientSessionIds: ["session-2"] }),
    base("focus_blocked_agent", { kind: "focus", selectedSessionId: "session-2", expectedStatus: "verified_blocked" }),
    base("bind_voice_session", { kind: "voice_binding", voiceSessionId: "voice-1", provider: "codex", contextPackageId: "handoff-1", consentId: "consent-1" })
  ];
  for (const input of inputs) {
    const created = await artifacts.create(input);
    assert.equal(created.executionAuthorized, false);
  }
});

test("provider queue cancellation is durable, operation-bound, and preserves ambiguous in-flight state", async (context) => {
  const artifacts = new WorkflowArtifactStore(await store(context), { clock: () => "2026-08-24T12:00:00.000Z" });
  const prepared = await artifacts.create(base("proof", { kind: "proof", claims: ["claim"], evidenceReferences: ["receipt:1"], requiredBackends: ["local"] }));
  const submittedInput = base("reanchor", { kind: "anchor", contextSummary: "Exact context", anchors: ["target"], unresolved: [] });
  const submitted = await artifacts.create({ ...submittedInput, id: "artifact-submitted" });
  await artifacts.claimForDispatch({ action: "reanchor", targetSnapshotId: submitted.targetSnapshotId, sessionId: submitted.sessionId, operationId: "operation-submitted" });

  const observed = await artifacts.observeOperation("operation-submitted");
  assert.equal(observed?.id, submitted.id);
  assert.equal((await artifacts.cancelByOperation("operation-submitted"))?.status, "cancelling");
  assert.equal((await artifacts.observeOperation("operation-submitted"))?.status, "cancelling");

  const cancelled = await artifacts.cancelQueuedForRepository("c:/REPO/");
  assert.deepEqual(cancelled.map((artifact) => [artifact.id, artifact.status]).sort(), [[prepared.id, "cancelled"], [submitted.id, "cancelling"]].sort());
  assert.equal((await artifacts.get(prepared.id))?.status, "cancelled");
  assert.equal(await artifacts.cancelByOperation("unknown-operation"), undefined);
});
