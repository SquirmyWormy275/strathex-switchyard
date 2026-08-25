import assert from "node:assert/strict";
import test from "node:test";

import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { ConfiguredProviderHostClient, type ConfiguredProviderOperationIdentity } from "../src/configured-provider-host.ts";
import type { ProviderCommandTransport } from "../src/remote-adapters.ts";

const target = "b".repeat(64);
const repositoryRoot = "C:\\repo";
const session: ManagedSession = {
  id: "codex-session", provider: "codex", surface: "bridge", capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running", workspaceRoot: repositoryRoot, targetSnapshotId: target, plannedFiles: [],
  taskId: "task-provider-host", planRevision: "plan-1",
  adapterVersion: "codex-live-v1", lastHeartbeat: "2026-08-25T12:00:00.000Z",
  metadata: { "sxsy-b122.providerHandshake": "exact-route-v1", "sxsy-b122.providerHandshakeTarget": target }
};
const operation: ConfiguredProviderOperationIdentity = {
  operationId: "operation-1", externalId: "operation-1", routeId: "provider.proof", sessionId: session.id,
  provider: "codex", targetSnapshotId: target, repositoryRoot
};

test("configured provider-host client uses exact observe, cancel, and reconcile routes", async () => {
  const routes: string[] = [];
  const transport: ProviderCommandTransport = { async request(input) {
    routes.push(input.routeId);
    const body = input.body ? JSON.parse(Buffer.from(input.body).toString("utf8")) as Record<string, unknown> : {};
    if (input.routeId === "provider.observe-session.codex") return passed(input.routeId, { schema: "sxsy-b122.provider-session-observation", version: 1, sessionId: session.id, provider: "codex", targetSnapshotId: target, repositoryRoot, status: "verified_finished", capabilities: ["registered", "observable"], adapterVersion: "codex-live-v2" });
    if (input.routeId === "provider.observe-operation.codex") return passed(input.routeId, { schema: "sxsy-b122.provider-operation-observation", version: 1, operationId: body.operationId, externalId: body.externalId, routeId: body.routeId, sessionId: body.sessionId, provider: body.provider, targetSnapshotId: body.targetSnapshotId, repositoryRoot: body.repositoryRoot, outcome: "committed", summary: "Observed exact committed effect." });
    if (input.routeId === "provider.cancel.codex") return passed(input.routeId, { schema: "sxsy-b122.provider-cancellation-ack", version: 1, operationId: operation.operationId, externalId: operation.externalId, sessionId: operation.sessionId, provider: operation.provider, targetSnapshotId: target, accepted: true, summary: "Cancellation acknowledged." });
    return passed(input.routeId, { schema: "sxsy-b122.provider-host-reconciliation", version: 1, operationsInspected: 1, operationsSettled: 1, councilsInspected: 0, councilsSettled: 0 });
  } };
  const client = new ConfiguredProviderHostClient(transport, () => "2026-08-25T12:01:00.000Z");
  assert.equal(client.recoveryExternalId({ routeId: operation.routeId, operationId: operation.operationId, provider: "codex" }), operation.operationId);
  const refreshed = await client.refreshSession(session);
  assert.equal(refreshed.status, "verified_finished");
  assert.deepEqual(refreshed.capabilities, ["registered", "observable"]);
  assert.equal((await client.observeOperation(operation)).outcome, "committed");
  assert.equal((await client.cancelOperation(operation, "operator cancellation")).accepted, true);
  assert.equal((await client.reconcile(repositoryRoot)).operationsSettled, 1);
  assert.deepEqual(routes, ["provider.observe-session.codex", "provider.observe-operation.codex", "provider.cancel.codex", "provider.reconcile"]);
});

test("configured provider-host client rejects target churn, unsupported providers, and malformed exact evidence", async () => {
  const client = new ConfiguredProviderHostClient({ async request(input) { return passed(input.routeId, { schema: "sxsy-b122.provider-session-observation", version: 1, sessionId: session.id, provider: "codex", targetSnapshotId: "0".repeat(64), repositoryRoot, status: "running", capabilities: ["registered", "observable"], adapterVersion: "codex-live-v1" }); } });
  await assert.rejects(() => client.refreshSession(session), /malformed|bound/i);
  const unsupported = { ...session, provider: "generic" as const };
  await assert.rejects(() => client.refreshSession(unsupported), /Claude|Codex/i);
  assert.equal(client.recoveryExternalId({ routeId: "provider.proof", operationId: operation.operationId, provider: "generic" }), undefined);
  await assert.rejects(() => client.observeOperation({ ...operation, repositoryRoot: "relative" }), /identity/i);
});

test("configured provider-host client requests and validates one exact non-authorizing workflow context", async () => {
  let observedBody: Record<string, unknown> | undefined;
  const transport: ProviderCommandTransport = { async request(input) {
    assert.equal(input.routeId, "provider.observe-workflow-context.codex");
    observedBody = JSON.parse(Buffer.from(input.body!).toString("utf8")) as Record<string, unknown>;
    return passed(input.routeId, workflowContextResponse(observedBody, 11));
  } };
  const client = new ConfiguredProviderHostClient(transport, () => "2026-08-25T12:01:00.000Z", {
    nonceFactory: () => "1".repeat(64),
    observationDeadlineMs: 250
  });
  const result = await client.observeWorkflowContext({
    session,
    target: { id: target, repositoryRoot, branch: "feature/provider-host", head: "d".repeat(40) }
  });
  assert.deepEqual(observedBody, {
    schema: "sxsy-b122.provider-workflow-context-observe", version: 1,
    sessionId: session.id, provider: "codex", targetSnapshotId: target, repositoryRoot,
    branch: "feature/provider-host", head: "d".repeat(40), taskId: "task-provider-host",
    planRevision: "plan-1", requestNonce: "1".repeat(64)
  });
  assert.equal(result.sourceRevision, 11);
  assert.equal(result.requestNonce, "1".repeat(64));
  assert.equal(result.adapter.moduleSha256, "c".repeat(64));
  assert.equal(result.evidence.plan.taskId, "task-provider-host");
  assert.equal(result.evidence.instructions.length, 1);
  assert.equal(result.evidence.documentation.length, 1);
  assert.equal(result.evidence.files.length, 1);
  assert.equal(result.evidence.tests[0]?.status, "passed");
  assert.deepEqual(result.pendingDecisions, [{ id: "decision-1", question: "Choose the exact bounded option.", context: "The protected workflow requires one operator decision." }]);
  assert.deepEqual(result.pendingRequest, { requestId: "pending-1", targetSnapshotId: target, planRevision: "plan-1", planDigest: result.evidence.plan.digest, action: "proof" });
  assert.equal(/authority|permission|credential|executable|command/i.test(JSON.stringify(result)), false);
});

test("configured provider-host client rejects rollback, nonce drift, extra authority, and target drift", async () => {
  let revision = 4;
  let mutate: (value: Record<string, unknown>) => Record<string, unknown> = (value) => value;
  let nonce = 0;
  const client = new ConfiguredProviderHostClient({ async request(input) {
    const body = JSON.parse(Buffer.from(input.body!).toString("utf8")) as Record<string, unknown>;
    return passed(input.routeId, mutate(workflowContextResponse(body, revision)));
  } }, undefined, { nonceFactory: () => `${++nonce}`.padStart(64, "0"), observationDeadlineMs: 250 });
  const input = { session, target: { id: target, repositoryRoot, branch: "feature/provider-host", head: "d".repeat(40) } } as const;
  await client.observeWorkflowContext(input);
  revision = 3;
  await assert.rejects(() => client.observeWorkflowContext(input), /revision|rollback|bound/i);

  revision = 5;
  mutate = (value) => ({ ...value, requestNonce: "f".repeat(64) });
  await assert.rejects(() => client.observeWorkflowContext(input), /malformed|bound|nonce/i);

  mutate = (value) => ({ ...value, authorityId: "provider-selected-authority" });
  await assert.rejects(() => client.observeWorkflowContext(input), /malformed|bound/i);

  mutate = (value) => ({ ...value, targetSnapshotId: "0".repeat(64) });
  await assert.rejects(() => client.observeWorkflowContext(input), /malformed|bound/i);

  mutate = (value) => ({ ...value, evidence: { ...(value.evidence as Record<string, unknown>), permission: "provider-added" } });
  await assert.rejects(() => client.observeWorkflowContext(input), /malformed|bound/i);

  mutate = (value) => ({ ...value, pendingRequest: { ...(value.pendingRequest as Record<string, unknown>), planDigest: "0".repeat(64) } });
  await assert.rejects(() => client.observeWorkflowContext(input), /malformed|bound/i);
});

test("configured provider-host client bounds an ignoring transport and consumes its late rejection", async () => {
  let observedAbort = false;
  let rejectLate!: (error: Error) => void;
  const client = new ConfiguredProviderHostClient({ request(input) {
    input.signal?.addEventListener("abort", () => { observedAbort = true; }, { once: true });
    return new Promise((_resolve, reject) => { rejectLate = reject; });
  } }, undefined, { nonceFactory: () => "2".repeat(64), observationDeadlineMs: 25 });
  const started = Date.now();
  await assert.rejects(() => client.observeWorkflowContext({
    session,
    target: { id: target, repositoryRoot, branch: "feature/provider-host", head: "d".repeat(40) }
  }), /deadline|unavailable|cancel/i);
  assert.equal(observedAbort, true);
  assert.ok(Date.now() - started < 1_000);
  rejectLate(new Error("late transport secret must be consumed"));
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test("configured provider-host client rejects a response that settles after the wall-clock deadline before the timer callback runs", async () => {
  let observedAbort = false;
  const client = new ConfiguredProviderHostClient({ request(input) {
    input.signal?.addEventListener("abort", () => { observedAbort = true; }, { once: true });
    const body = JSON.parse(Buffer.from(input.body!).toString("utf8")) as Record<string, unknown>;
    return new Promise((resolve) => setTimeout(() => {
      const blockedUntil = Date.now() + 35;
      while (Date.now() < blockedUntil) { /* deterministically hold the event loop beyond the deadline */ }
      resolve(passed(input.routeId, workflowContextResponse(body, 12)));
    }, 5));
  } }, undefined, { nonceFactory: () => "3".repeat(64), observationDeadlineMs: 20 });
  await assert.rejects(() => client.observeWorkflowContext({
    session,
    target: { id: target, repositoryRoot, branch: "feature/provider-host", head: "d".repeat(40) }
  }), /deadline|cancel/i);
  assert.equal(observedAbort, true);
});

function workflowContextResponse(request: Record<string, unknown>, sourceRevision: number): Record<string, unknown> {
  const adapter = { id: "installed.module.codex", version: "codex-live-v1", moduleSha256: "c".repeat(64) };
  const planMaterial = {
    revision: request.planRevision, originSessionId: request.sessionId, taskId: request.taskId,
    objective: "Execute the exact protected plan.",
    steps: [{ id: "step-1", summary: "Inspect the target.", ownedFiles: ["src/example.ts"], dependencies: [], status: "approved" }],
    decisions: ["Use the exact target snapshot."]
  };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const evidenceMaterial = {
    instructions: [{ id: "instructions-1", digest: "1".repeat(64), source: "protected_context", summary: "Use protected instructions." }],
    plan,
    documentation: [{ id: "documentation-1", digest: "2".repeat(64), source: "repository", summary: "Read the repository documentation." }],
    diff: { id: "diff-1", digest: "e".repeat(64), source: "target_snapshot", summary: "Inspect the exact diff." },
    files: [{ id: "file-1", digest: "4".repeat(64), source: "repository", summary: "Inspect the exact file." }],
    tests: [{ id: "test-1", digest: "5".repeat(64), source: "receipt", summary: "Use the test receipt.", status: "passed" }]
  };
  const evidence = { contextDigest: sha256(stableJson(evidenceMaterial)), ...evidenceMaterial };
  const contextMaterial = {
    contextId: `context-${sourceRevision}`, sourceRevision,
    sessionId: request.sessionId, provider: request.provider, targetSnapshotId: request.targetSnapshotId,
    repositoryRoot: request.repositoryRoot, branch: request.branch, head: request.head,
    taskId: request.taskId, planRevision: request.planRevision,
    plannedFiles: ["src/example.ts"], resources: ["port:4100"], dependencies: ["task:prior"],
    diffDigest: "e".repeat(64), evidence,
    pendingDecisions: [{ id: "decision-1", question: "Choose the exact bounded option.", context: "The protected workflow requires one operator decision." }],
    pendingRequest: { requestId: "pending-1", targetSnapshotId: request.targetSnapshotId, planRevision: request.planRevision, planDigest: plan.digest, action: "proof" },
    adapter
  };
  const unsigned = {
    schema: "sxsy-b122.provider-workflow-context-observation", version: 1,
    ...contextMaterial, observedAt: "2026-08-25T12:01:00.000Z", requestNonce: request.requestNonce,
    contextDigest: sha256(stableJson(contextMaterial))
  };
  return { ...unsigned, envelopeDigest: sha256(stableJson(unsigned)) };
}

function passed(routeId: string, value: unknown) { return { outcome: "passed" as const, routeId, detail: "ok", effectDisposition: "ambiguous" as const, body: Buffer.from(JSON.stringify(value)) }; }
