import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { ProtectedJsonStore, sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { canonicalWorkflowArtifact, planApprovalReviewScopeDigest } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import {
  DeterministicProviderGatewayBackend,
  LocalProviderCommandGateway,
  ProviderGatewayRouteRouter,
  type ProviderGatewayBackend
} from "../src/provider-gateway.ts";

const targetId = "a".repeat(64);
const otherTargetId = "b".repeat(64);

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-gateway-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const store = new ProtectedJsonStore({ filePath: join(root, "protected.jsonl") });
  const sessions = new SessionRegistry(store);
  const claude = new DeterministicProviderGatewayBackend("claude");
  const codex = new DeterministicProviderGatewayBackend("codex");
  const clockValues = [
    "2026-08-24T12:00:00.000Z",
    "2026-08-24T12:00:01.000Z",
    "2026-08-24T12:00:02.000Z",
    "2026-08-24T12:00:03.000Z",
    "2026-08-24T12:00:04.000Z",
    "2026-08-24T12:00:05.000Z"
  ];
  let clockIndex = 0;
  const gateway = new LocalProviderCommandGateway({
    store,
    sessions,
    authenticationToken: "1".repeat(64),
    backends: [claude, codex],
    now: () => clockValues[Math.min(clockIndex++, clockValues.length - 1)]!
  });
  return { root, store, sessions, claude, codex, gateway, client: gateway.connect("1".repeat(64)) };
}

function providerSession(provider: "claude" | "codex" = "codex"): ManagedSession {
  return {
    id: `${provider}-session`,
    provider,
    surface: "vscode_terminal",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running",
    workspaceRoot: "C:\\repo",
    targetSnapshotId: targetId,
    taskId: "task-1",
    planRevision: "plan-1",
    plannedFiles: ["src/index.ts"],
    lastHeartbeat: "2026-08-24T11:59:59.000Z",
    adapterVersion: `${provider}-adapter-1`,
    metadata: {
      "sxsy-b122.providerHandshake": "exact-route-v1",
      "sxsy-b122.providerHandshakeTarget": targetId
    }
  };
}

function workflowBody(operationId = "operation-proof-1", digestOverride?: string): string {
  const planMaterial = { revision: "plan-1", originSessionId: "codex-session", taskId: "task-1", objective: "Verify gateway", steps: [{ id: "step-1", summary: "Verify", ownedFiles: ["src/index.ts"], dependencies: [], status: "approved" as const }], decisions: [] as string[] };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const evidenceMaterial = { instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context" as const, summary: "Instructions" }], plan, documentation: [{ id: "documentation", digest: "5".repeat(64), source: "repository" as const, summary: "Documentation" }], diff: { id: "diff", digest: "2".repeat(64), source: "target_snapshot" as const, summary: "Diff" }, files: [{ id: "file", digest: "3".repeat(64), source: "repository" as const, summary: "File" }], tests: [{ id: "receipt", digest: "4".repeat(64), source: "receipt" as const, summary: "Test", status: "passed" as const }] };
  const payload = {
    kind: "proof" as const,
    evidence: { contextDigest: sha256(stableJson(evidenceMaterial)), ...evidenceMaterial },
    claims: ["claim"],
    requiredBackends: ["local"],
    independentBackendRequired: false
  };
  const immutable = canonicalWorkflowArtifact({
    id: "artifact-proof-1", action: "proof", repositoryRoot: "C:\\repo", targetSnapshotId: targetId,
    sessionId: "codex-session", taskId: "task-1", planRevision: "plan-1", authorityId: "authority-proof",
    coordinatorContextDigest: "f".repeat(64), coordinatorContextRevision: 7, payload
  });
  return JSON.stringify({
    schema: "sxsy-b122.workflow-command",
    version: 1,
    action: "proof",
    operationId,
    authorityId: "authority-proof",
    target: {
      id: targetId,
      repositoryRoot: "C:\\repo",
      policyVersion: "policy-v1",
      trackedManifest: "d".repeat(64),
      untrackedManifest: "e".repeat(64)
    },
    session: {
      id: "codex-session",
      provider: "codex",
      surface: "vscode_terminal",
      capabilities: ["registered", "observable", "controllable", "mediated"],
      taskId: "task-1",
      planRevision: "plan-1",
      plannedFiles: ["src/index.ts"]
    },
    artifact: {
      id: "artifact-proof-1",
      digest: digestOverride ?? immutable.digest,
      taskId: "task-1",
      planRevision: "plan-1",
      authorityId: "authority-proof",
      coordinatorContextDigest: "f".repeat(64),
      coordinatorContextRevision: 7,
      payload,
      executionAuthorized: false
    }
  });
}

function planApprovalBody(operationId = "operation-plan-1", includeAuthorization = true): string {
  const value = JSON.parse(workflowBody(operationId)) as Record<string, unknown>;
  const artifact = value.artifact as Record<string, unknown>;
  const proof = artifact.payload as { evidence: { plan: Record<string, unknown> } };
  const plan = proof.evidence.plan;
  value.action = "plan_approval";
  value.authorityId = "authority-plan";
  artifact.id = "artifact-plan-1";
  artifact.authorityId = "authority-plan";
  const providerContextDigest = "6".repeat(64);
  const confirmationScopeDigest = planApprovalReviewScopeDigest({
    sessionId: "codex-session", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", taskId: String(plan.taskId),
    planRevision: String(plan.revision), planDigest: String(plan.digest), originSessionId: String(plan.originSessionId),
    providerContextDigest, sourceRevision: Number(artifact.coordinatorContextRevision)
  });
  artifact.payload = { kind: "plan", mode: "approve", plan, executorSessionId: "codex-session", authorityId: "authority-plan", confirmationDigest: "9".repeat(64), confirmationScopeDigest, providerContextDigest, executeOnce: true };
  artifact.digest = canonicalWorkflowArtifact({
    id: String(artifact.id), action: "plan_approval", repositoryRoot: "C:\\repo", targetSnapshotId: targetId,
    sessionId: "codex-session", taskId: "task-1", planRevision: "plan-1", authorityId: "authority-plan",
    coordinatorContextDigest: String(artifact.coordinatorContextDigest), coordinatorContextRevision: Number(artifact.coordinatorContextRevision),
    payload: artifact.payload as never
  }).digest;
  if (includeAuthorization) value.executionAuthorization = {
    executionAuthorized: true, executeOnce: true, currentUserConfirmed: true, confirmationDigest: "9".repeat(64), confirmationScopeDigest, operationId, artifactId: artifact.id, artifactDigest: artifact.digest,
    targetSnapshotId: targetId, sessionId: "codex-session", authorityId: "authority-plan", planDigest: plan.digest, planRevision: plan.revision, originSessionId: plan.originSessionId
  };
  return JSON.stringify(value);
}

test("gateway authentication is an exact local capability and external backends need explicit authorization", async (context) => {
  const setup = await fixture(context);
  assert.throws(() => setup.gateway.connect("2".repeat(64)), /authentication/i);

  const external = new DeterministicProviderGatewayBackend("codex", { boundary: "authorized-external" });
  const rejected = new LocalProviderCommandGateway({
    store: setup.store,
    sessions: setup.sessions,
    authenticationToken: "3".repeat(64),
    backends: [external]
  });
  assert.throws(() => rejected.connect("3".repeat(64)), /explicit.*authorization|external/i);
});

test("workflow commands are exact-target and idempotent across duplicate delivery", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession());

  const [first, duplicate] = await Promise.all([
    setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody() }),
    setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody() })
  ]);
  assert.equal(first.outcome, "passed");
  assert.deepEqual(duplicate.body, first.body);
  assert.equal(setup.codex.commandCalls, 1);
  assert.equal(setup.client.recoveryExternalId({ routeId: "provider.proof", operationId: "operation-proof-1", provider: "codex" }), "operation-proof-1");

  const conflict = await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-proof-1", "f".repeat(64)) });
  assert.equal(conflict.outcome, "blocked");
  assert.equal(setup.codex.commandCalls, 1);

  await setup.sessions.upsert({ ...providerSession(), targetSnapshotId: otherTargetId });
  const stale = await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-stale-target") });
  assert.equal(stale.outcome, "blocked");
  assert.equal(setup.codex.commandCalls, 1);
});

test("Plan Approval gateway rejects missing or mismatched execution authorization and durably acknowledges one exact execution", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession());

  const missing = await setup.client.request({ routeId: "provider.plan_approval", repositoryRoot: "C:\\repo", body: planApprovalBody("operation-plan-missing", false) });
  assert.equal(missing.outcome, "blocked");
  assert.equal(setup.codex.commandCalls, 0);

  const mismatched = JSON.parse(planApprovalBody("operation-plan-mismatch")) as Record<string, unknown>;
  (mismatched.executionAuthorization as Record<string, unknown>).sessionId = "other-session";
  const changed = await setup.client.request({ routeId: "provider.plan_approval", repositoryRoot: "C:\\repo", body: JSON.stringify(mismatched) });
  assert.equal(changed.outcome, "blocked");
  assert.equal(setup.codex.commandCalls, 0);

  const changedConfirmation = JSON.parse(planApprovalBody("operation-plan-confirmation-mismatch")) as Record<string, unknown>;
  (changedConfirmation.executionAuthorization as Record<string, unknown>).confirmationDigest = "7".repeat(64);
  const changedConfirmationResult = await setup.client.request({ routeId: "provider.plan_approval", repositoryRoot: "C:\\repo", body: JSON.stringify(changedConfirmation) });
  assert.equal(changedConfirmationResult.outcome, "blocked");
  assert.equal(setup.codex.commandCalls, 0);

  const changedScope = JSON.parse(planApprovalBody("operation-plan-scope-mismatch")) as Record<string, unknown>;
  (changedScope.executionAuthorization as Record<string, unknown>).confirmationScopeDigest = "7".repeat(64);
  const changedScopeResult = await setup.client.request({ routeId: "provider.plan_approval", repositoryRoot: "C:\\repo", body: JSON.stringify(changedScope) });
  assert.equal(changedScopeResult.outcome, "blocked");
  assert.equal(setup.codex.commandCalls, 0);

  const changedPlan = JSON.parse(planApprovalBody("operation-plan-content-mismatch")) as Record<string, unknown>;
  const changedPlanArtifact = changedPlan.artifact as Record<string, unknown>;
  const changedPlanPayload = changedPlanArtifact.payload as { plan: Record<string, unknown> };
  changedPlanPayload.plan.objective = "Hostile replacement objective with stale immutable digests";
  const changedPlanResult = await setup.client.request({ routeId: "provider.plan_approval", repositoryRoot: "C:\\repo", body: JSON.stringify(changedPlan) });
  assert.equal(changedPlanResult.outcome, "blocked");
  assert.equal(setup.codex.commandCalls, 0);

  const changedArtifact = JSON.parse(planApprovalBody("operation-plan-artifact-mismatch")) as Record<string, unknown>;
  const changedArtifactPayload = (changedArtifact.artifact as Record<string, unknown>).payload as Record<string, unknown>;
  changedArtifactPayload.providerContextDigest = "5".repeat(64);
  const changedArtifactResult = await setup.client.request({ routeId: "provider.plan_approval", repositoryRoot: "C:\\repo", body: JSON.stringify(changedArtifact) });
  assert.equal(changedArtifactResult.outcome, "blocked");
  assert.equal(setup.codex.commandCalls, 0);

  const accepted = await setup.client.request({ routeId: "provider.plan_approval", repositoryRoot: "C:\\repo", body: planApprovalBody() });
  assert.equal(accepted.outcome, "passed");
  assert.equal(setup.codex.commandCalls, 1);
  const result = JSON.parse(Buffer.from(accepted.body!).toString("utf8")) as { result: { mode: string; executionStarted: boolean; planDigest: string } };
  assert.deepEqual({ mode: result.result.mode, executionStarted: result.result.executionStarted }, { mode: "execution_ack", executionStarted: true });
});

test("direct authenticated provider routes derive the exact hierarchical capability floor from the catalog", async (context) => {
  const setup = await fixture(context);
  const original = providerSession();
  await setup.sessions.upsert({ ...original, capabilities: ["registered", "observable"] });
  assert.equal((await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-observable") })).outcome, "passed");

  await setup.sessions.upsert({ ...original, capabilities: ["registered"] });
  assert.equal((await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-under-capability") })).outcome, "blocked");

  await setup.sessions.upsert({ ...original, status: "stale" });
  assert.equal((await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-stale") })).outcome, "blocked");

  await setup.sessions.upsert({ ...original, status: "unreachable" });
  assert.equal((await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-unreachable") })).outcome, "blocked");

  await setup.sessions.upsert({ ...original, lastHeartbeat: "2026-08-24T11:00:00.000Z" });
  assert.equal((await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-stale-heartbeat") })).outcome, "blocked");
  assert.equal(setup.codex.commandCalls, 1);
});

test("host-owned observations renew exact sessions and centrally downgrade churn or outage", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession("claude"));
  setup.claude.setSessionObservation("claude-session", {
    targetSnapshotId: targetId,
    status: "verified_blocked",
    capabilities: ["registered", "observable", "controllable", "mediated"]
  });
  await setup.client.refreshSessions(true);
  let observed = await setup.sessions.get("claude-session");
  assert.equal(observed?.status, "verified_blocked");
  assert.equal(observed?.lastHeartbeat, "2026-08-24T12:00:01.000Z");

  setup.claude.setSessionObservation("claude-session", {
    targetSnapshotId: targetId,
    status: "verified_finished",
    capabilities: ["registered", "observable", "controllable", "mediated"]
  });
  await setup.client.refreshSessions(true);
  observed = await setup.sessions.get("claude-session");
  assert.equal(observed?.status, "verified_finished");

  setup.claude.setSessionObservation("claude-session", {
    targetSnapshotId: otherTargetId,
    status: "running",
    capabilities: ["registered", "observable", "controllable", "mediated"]
  });
  await setup.client.refreshSessions(true);
  observed = await setup.sessions.get("claude-session");
  assert.equal(observed?.status, "unknown");
  assert.deepEqual(observed?.capabilities, ["registered"]);
  assert.equal(observed?.metadata["sxsy-b122.providerHandshake"], undefined);

  await setup.sessions.upsert(providerSession("claude"));
  setup.claude.setUnavailable(true);
  await setup.client.refreshSessions(true);
  observed = await setup.sessions.get("claude-session");
  assert.equal(observed?.status, "unreachable");
  assert.deepEqual(observed?.capabilities, ["registered"]);
});

test("renewable observations recover from the protected registry after restart", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession());
  setup.codex.setSessionObservation("codex-session", {
    targetSnapshotId: targetId,
    status: "verified_finished",
    capabilities: ["registered", "observable", "controllable", "mediated"]
  });

  const restarted = new LocalProviderCommandGateway({
    store: setup.store,
    sessions: new SessionRegistry(setup.store),
    authenticationToken: "4".repeat(64),
    backends: [setup.codex],
    now: () => "2026-08-24T12:01:00.000Z"
  }).connect("4".repeat(64));
  await restarted.refreshSessions(true);
  const observed = await setup.sessions.get("codex-session");
  assert.equal(observed?.status, "verified_finished");
  assert.equal(observed?.lastHeartbeat, "2026-08-24T12:01:00.000Z");
});

test("provider cancellation is acknowledged, observed, and idempotent", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession());
  setup.codex.setNextCommandStatus("running");
  const dispatched = await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-running-1") });
  assert.equal(dispatched.outcome, "passed");

  const cancellations = await Promise.all([
    setup.client.cancelByOperation("operation-running-1", "operator cancelled"),
    setup.client.cancelByOperation("operation-running-1", "operator cancelled")
  ]);
  assert.deepEqual(cancellations, [1, 1]);
  assert.equal(await setup.client.cancelByOperation("operation-running-1", "operator cancelled"), 0);
  assert.equal(setup.codex.cancelCalls, 1);
  const queueObservation = await setup.client.observeOperation("operation-running-1");
  assert.equal(queueObservation.settled, true);
  assert.match(queueObservation.summary, /cancelled/i);
  const recoveryObservation = await setup.client.observeProviderOperation({
    repositoryRoot: "C:\\repo",
    routeId: "provider.proof",
    externalId: "operation-running-1",
    targetSnapshotId: targetId
  });
  assert.equal(recoveryObservation?.outcome, "cancelled");
});

test("automatic refresh never invokes a configured external provider boundary", async (context) => {
  const setup = await fixture(context);
  const external = new DeterministicProviderGatewayBackend("codex", { boundary: "authorized-external" });
  const gateway = new LocalProviderCommandGateway({
    store: setup.store,
    sessions: setup.sessions,
    authenticationToken: "5".repeat(64),
    backends: [external],
    authorizedExternalProviders: ["codex"]
  }).connect("5".repeat(64));
  await setup.sessions.upsert(providerSession());
  await gateway.refreshSessions(false);
  assert.equal(external.sessionObservationCalls, 0);
  await gateway.observeSession("codex-session");
  assert.equal(external.sessionObservationCalls, 1);
});

test("duplicate provider registrations and malformed local requests fail closed", async (context) => {
  const setup = await fixture(context);
  const duplicate = new DeterministicProviderGatewayBackend("codex") as ProviderGatewayBackend;
  assert.throws(() => new LocalProviderCommandGateway({
    store: setup.store,
    sessions: setup.sessions,
    authenticationToken: "6".repeat(64),
    backends: [setup.codex, duplicate]
  }), /duplicate/i);

  const malformed = await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: "{}" });
  assert.equal(malformed.outcome, "blocked");
  assert.equal(setup.codex.commandCalls, 0);
});

test("route router keeps local providers local and never forwards malformed metadata", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession());
  let fallbackCalls = 0;
  const fallback = {
    async request(input: { routeId: string }) {
      fallbackCalls += 1;
      return { outcome: "unavailable" as const, routeId: input.routeId, detail: "explicit configured fallback", effectDisposition: "not_started" as const };
    }
  };
  const router = new ProviderGatewayRouteRouter(setup.client, fallback);
  assert.equal((await router.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-router-1") })).outcome, "passed");
  assert.equal(fallbackCalls, 0);

  assert.equal((await router.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: "{}" })).outcome, "blocked");
  assert.equal(fallbackCalls, 0);

  const genericBody = workflowBody("operation-router-generic").replace('"provider":"codex"', '"provider":"generic"');
  assert.equal((await router.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: genericBody })).detail, "explicit configured fallback");
  assert.equal(fallbackCalls, 1);
});
