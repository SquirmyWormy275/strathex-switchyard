import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { reanchorApplyArtifactDigest, reanchorRequiredRereads, type ReanchorApplyRequest } from "../../../packages/control-plane/src/reanchor.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { createAutomationIntent, type AutomationEnvelope } from "../../../packages/control-plane/src/automation-protocol.ts";
import {
  automationManifestReviewScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { canonicalWorkflowArtifact, planApprovalReviewScopeDigest } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import {
  DeterministicProviderGatewayBackend,
  LocalProviderCommandGateway,
  ProviderGatewayRouteRouter,
  type ProviderGatewayBackend,
  type ProviderGatewayCommand,
  type ProviderGatewayCommandResult
} from "../src/provider-gateway.ts";

const targetId = "a".repeat(64);
const otherTargetId = "b".repeat(64);
const automationContent = (value: string) => ({
  afterDigest: sha256(value),
  content: { encoding: "base64" as const, byteLength: Buffer.byteLength(value, "utf8"), data: Buffer.from(value, "utf8").toString("base64") }
});

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

function reviewedAutomationEnvelope(
  operationId = "automation-operation-capture",
  times: Readonly<{ createdAt: string; expiresAt: string; confirmedAt: string; approvalExpiresAt: string }> = {
    createdAt: "2026-08-24T11:59:00.000Z",
    expiresAt: "2026-08-24T12:09:00.000Z",
    confirmedAt: "2026-08-24T11:59:59.000Z",
    approvalExpiresAt: "2026-08-24T12:08:00.000Z"
  }
): AutomationEnvelope {
  const target = {
    id: targetId,
    repositoryRoot: "C:\\repo",
    branch: "feat/automation",
    head: "d".repeat(40),
    policyVersion: "policy-v1",
    trackedManifest: "e".repeat(64),
    untrackedManifest: "f".repeat(64)
  } as const;
  const session = {
    id: "codex-session",
    provider: "codex",
    surface: "vscode_terminal",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    taskId: "task-1",
    planRevision: "plan-1",
    plannedFiles: ["src/index.ts"]
  } as const;
  const manifest = createAutomationOperationManifest({
    repositoryRoot: target.repositoryRoot,
    targetSnapshotId: target.id,
    sessionId: session.id,
    authorityId: "authority-automation",
    taskId: session.taskId,
    planRevision: session.planRevision,
    provider: session.provider,
    createdAt: times.createdAt,
    expiresAt: times.expiresAt
  }, {
    kind: "compound_capture",
    solvedProblemEvidenceDigest: "1".repeat(64),
    verifiedOutcomeEvidenceDigest: "2".repeat(64),
    nonTrivialRationale: "The exact reviewed provider-gateway result is reusable.",
    documents: [{ path: "docs/solutions/provider-gateway.md", mutation: "create", beforeDigest: null, ...automationContent("# Provider gateway capture\n") }],
    instructionFileMutation: { kind: "none" }
  });
  const approval = createAutomationManifestApproval({
    manifest,
    confirmationToken: `confirm-${operationId}`,
    confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
    confirmedAt: times.confirmedAt,
    expiresAt: times.approvalExpiresAt
  });
  const intent = createAutomationIntent("compound_capture", {
    digest: approval.confirmationDigest,
    scopeDigest: approval.reviewScopeDigest
  }, undefined, { manifest, approval });
  return {
    schema: "sxsy-b122.compound-capture-request",
    version: 1,
    action: "compound_capture",
    operationId,
    target,
    session,
    authorityId: "authority-automation",
    manifest,
    approval,
    intent
  };
}

function reanchorEnvelope(): ReanchorApplyRequest {
  const makeTarget = (head: string): TargetSnapshot => {
    const material = {
      repositoryRoot: "C:\\repo", canonicalRemote: "https://github.com/example/reanchor.git",
      branch: "feature/reanchor", upstream: "origin/feature/reanchor", head,
      indexTree: `tree-${head}`, trackedManifest: `tracked-${head}`, untrackedManifest: "untracked-clean",
      submodules: {}, policyVersion: "policy-v1", environmentFingerprint: "environment-v1",
      completeness: "complete" as const, reasons: [] as readonly string[]
    };
    return { id: targetSnapshotDigest(material), ...material, capturedAt: "2026-08-24T12:00:00.000Z" };
  };
  const oldTarget = makeTarget("old-head");
  const newTarget = makeTarget("new-head");
  const exactSession: ManagedSession = {
    ...providerSession(), targetSnapshotId: oldTarget.id, plannedFiles: ["src/index.ts"],
    metadata: {
      "sxsy-b122.providerHandshake": "exact-route-v1",
      "sxsy-b122.providerHandshakeTarget": oldTarget.id
    }
  };
  const authority: AuthorityGrant = {
    id: "authority-reanchor", repositoryRoot: oldTarget.repositoryRoot, sessionId: exactSession.id,
    taskId: exactSession.taskId!, planRevision: exactSession.planRevision!, allowedActions: ["reanchor"], prohibitedActions: [],
    issuedAt: "2026-08-24T11:55:00.000Z", expiresAt: "2099-08-24T12:00:00.000Z", issuedBy: "TEST\\Reviewer"
  };
  const planMaterial = {
    revision: exactSession.planRevision!, originSessionId: exactSession.id, taskId: exactSession.taskId!, objective: "Reread exact context.",
    steps: [{ id: "step-one", summary: "Inspect current work.", ownedFiles: ["src/index.ts"], dependencies: [], status: "approved" as const }],
    decisions: ["Never automatically resume."],
    expectedTargetTransition: { beforeTargetSnapshotId: oldTarget.id, expectedAfterTargetSnapshotId: oldTarget.id, expectation: "unchanged" as const }
  };
  const evidenceMaterial = {
    instructions: [{ id: "instructions", digest: sha256("instructions"), source: "protected_context" as const, summary: "Original instructions." }],
    plan: { digest: sha256(stableJson(planMaterial)), ...planMaterial },
    documentation: [{ id: "documentation", digest: sha256("documentation"), source: "repository" as const, summary: "Project documentation." }],
    diff: { id: "diff", digest: sha256("diff"), source: "target_snapshot" as const, summary: "Current diff." },
    files: [{ id: "file", digest: sha256("file"), source: "repository" as const, summary: "Current file." }],
    tests: [{ id: "test", digest: sha256("test"), source: "receipt" as const, summary: "Current test.", status: "passed" as const }]
  };
  const contextEvidence = { contextDigest: sha256(stableJson(evidenceMaterial)), ...evidenceMaterial };
  const rereadEvidence = {
    contextDigest: contextEvidence.contextDigest, authorityDigest: sha256(stableJson(authority)),
    instructionDigests: contextEvidence.instructions.map((item) => item.digest), planDigest: contextEvidence.plan.digest,
    documentationDigests: contextEvidence.documentation.map((item) => item.digest),
    currentWorkDigest: sha256(stableJson({
      diffDigest: contextEvidence.diff.digest, fileDigests: contextEvidence.files.map((item) => item.digest),
      testDigests: contextEvidence.tests.map((item) => item.digest), newTarget
    })), inspectedTargetSnapshotId: newTarget.id
  };
  const material = {
    version: 1 as const, requestId: `reanchor:${"1".repeat(64)}`, operationId: `reanchor-operation:${sha256(`reanchor:${"1".repeat(64)}`)}`,
    oldTargetSnapshotId: oldTarget.id, newTargetSnapshotId: newTarget.id, sessionId: exactSession.id, authorityId: authority.id,
    reason: "Reread the protected task and inspect exact current work.", previewDigest: "2".repeat(64), confirmationDigest: "3".repeat(64),
    confirmationScopeDigest: "4".repeat(64), provider: "codex" as const, session: exactSession,
    repositoryRoot: oldTarget.repositoryRoot, taskId: exactSession.taskId!, planRevision: exactSession.planRevision!,
    plannedFiles: [...exactSession.plannedFiles], authority, oldTarget, newTarget, contextEvidence,
    requiredRereads: reanchorRequiredRereads, rereadEvidence, cooperativeStopRequested: true as const, resumeAuthorized: false as const
  };
  return { ...material, artifactDigest: reanchorApplyArtifactDigest(material) };
}

function workflowBody(operationId = "operation-proof-1", digestOverride?: string): string {
  const planMaterial = { revision: "plan-1", originSessionId: "codex-session", taskId: "task-1", objective: "Verify gateway", steps: [{ id: "step-1", summary: "Verify", ownedFiles: ["src/index.ts"], dependencies: [], status: "approved" as const }], decisions: [] as string[], expectedTargetTransition: { beforeTargetSnapshotId: targetId, expectedAfterTargetSnapshotId: targetId, expectation: "unchanged" as const } };
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

function adversarialChildBody(setup: Awaited<ReturnType<typeof fixture>>, operationId: string, expectedAdapterId = setup.codex.dispatchIdentity.adapterId): string {
  const source = providerSession("codex");
  const independent = providerSession("claude");
  const effect = (session: ManagedSession, authorityId: string, identity: Readonly<{ adapterId: string; moduleSha256: string }>) => {
    const authority = { id: authorityId, repositoryRoot: "C:\\repo", sessionId: session.id, taskId: "task-1", planRevision: "plan-1", allowedActions: ["proof_adversarial"], prohibitedActions: [] as string[], expiresAt: "2099-08-24T00:00:00.000Z", issuedAt: "2026-08-24T00:00:00.000Z", issuedBy: "test" };
    const normalizedSession = { ...session, metadata: {} };
    const material = { role: "proof_backend" as const, provider: session.provider as "claude" | "codex", session: normalizedSession, authority, adapterId: identity.adapterId, adapterVersion: session.adapterVersion, moduleSha256: identity.moduleSha256, providerContextDigest: sha256(`context-${session.provider}`) };
    return { ...material, bindingDigest: sha256(stableJson(material)) };
  };
  const sourceEffect = effect(source, "authority-proof-codex", { ...setup.codex.dispatchIdentity, adapterId: expectedAdapterId });
  const independentEffect = effect(independent, "authority-proof-claude", setup.claude.dispatchIdentity);
  const original = JSON.parse(workflowBody()) as { artifact: { payload: { evidence: unknown } } };
  const payload = { kind: "proof" as const, evidence: original.artifact.payload.evidence, claims: ["claim"], requiredBackends: ["codex", "claude"], independentBackendRequired: true, providerEffects: [sourceEffect, independentEffect] };
  const artifact = canonicalWorkflowArtifact({ id: "artifact-proof-adversarial", action: "proof_adversarial", repositoryRoot: "C:\\repo", targetSnapshotId: targetId, sessionId: source.id, taskId: "task-1", planRevision: "plan-1", authorityId: sourceEffect.authority.id, coordinatorContextDigest: "f".repeat(64), coordinatorContextRevision: 7, payload: payload as never });
  return JSON.stringify({
    schema: "sxsy-b122.workflow-command", version: 1, action: "proof_adversarial", operationId,
    authorityId: sourceEffect.authority.id,
    target: { id: targetId, repositoryRoot: "C:\\repo", policyVersion: "policy-v1", trackedManifest: "d".repeat(64), untrackedManifest: "e".repeat(64) },
    session: { id: source.id, provider: source.provider, surface: source.surface, capabilities: source.capabilities, taskId: source.taskId, planRevision: source.planRevision, plannedFiles: source.plannedFiles },
    child: { role: sourceEffect.role, bindingDigest: sourceEffect.bindingDigest },
    artifact: { id: artifact.immutable.id, digest: artifact.digest, sessionId: source.id, operationId: "parent-proof-adversarial", taskId: "task-1", planRevision: "plan-1", authorityId: sourceEffect.authority.id, coordinatorContextDigest: "f".repeat(64), coordinatorContextRevision: 7, payload, executionAuthorized: false }
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
  assert.equal(first.outcome, "passed", first.detail);
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

test("provider gateway bound reconciliation requires exact immutable action, target, root, and effect disposition", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession());
  const binding = (operationId: string) => ({ operationId, action: "proof" as const, targetSnapshotId: targetId, repositoryRoot: "C:\\repo", sessionId: "codex-session", authorityId: "authority-proof" });

  assert.equal((await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-bound-committed") })).outcome, "passed");
  assert.deepEqual(await setup.client.observeBoundOperation(binding("operation-bound-committed")), {
    state: "terminal", ...binding("operation-bound-committed"), status: "completed", effectDisposition: "committed",
    summary: "The exact provider gateway operation has durable committed effect truth."
  });

  setup.codex.setNextCommandStatus("failed");
  assert.equal((await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-bound-failed") })).outcome, "passed");
  assert.deepEqual(await setup.client.observeBoundOperation(binding("operation-bound-failed")), {
    state: "terminal", ...binding("operation-bound-failed"), status: "failed", effectDisposition: "not_started",
    summary: "The exact provider gateway operation has durable failed effect truth."
  });

  setup.codex.setNextCommandStatus("cancelled");
  assert.equal((await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-bound-cancelled") })).outcome, "passed");
  assert.deepEqual(await setup.client.observeBoundOperation(binding("operation-bound-cancelled")), {
    state: "terminal", ...binding("operation-bound-cancelled"), status: "failed", effectDisposition: "not_started",
    summary: "The exact provider gateway operation has durable failed effect truth."
  });

  setup.codex.setNextCommandStatus("running");
  assert.equal((await setup.client.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: workflowBody("operation-bound-ambiguous") })).outcome, "passed");
  assert.equal((await setup.client.observeBoundOperation(binding("operation-bound-ambiguous"))).state, "active");

  assert.equal((await setup.client.observeBoundOperation({ ...binding("operation-bound-committed"), action: "plan_expander" })).state, "active");
  assert.equal((await setup.client.observeBoundOperation({ ...binding("operation-bound-committed"), targetSnapshotId: otherTargetId })).state, "active");
  assert.equal((await setup.client.observeBoundOperation({ ...binding("operation-bound-committed"), repositoryRoot: "C:\\other" })).state, "active");
  assert.equal((await setup.client.observeBoundOperation({ ...binding("operation-bound-committed"), sessionId: "substituted-session" })).state, "active");
  assert.equal((await setup.client.observeBoundOperation({ ...binding("operation-bound-committed"), authorityId: "substituted-authority" })).state, "active");
  assert.equal((await setup.client.observeBoundOperation(binding("operation-bound-missing"))).state, "not_owner");
});

test("legacy or inconsistent provider terminal records remain active and ambiguous", async (context) => {
  const setup = await fixture(context);
  const legacy = (operationId: string, state: "committed" | "failed", effectDisposition?: "not_started") => ({
    operationId,
    externalId: operationId,
    routeId: "provider.proof",
    provider: "codex",
    sessionId: "codex-session",
    repositoryRoot: "C:\\repo",
    targetSnapshotId: targetId,
    action: "proof",
    requestDigest: "1".repeat(64),
    state,
    ...(effectDisposition ? { effectDisposition } : {}),
    cancellationAcknowledged: false,
    updatedAt: "2026-08-24T12:00:01.000Z"
  });
  await setup.store.append("provider-gateway.operation", { operation: legacy("operation-legacy-missing", "failed") });
  await setup.store.append("provider-gateway.operation", { operation: legacy("operation-inconsistent", "committed", "not_started") });
  await setup.store.append("provider-gateway.operation", { operation: { ...legacy("operation-proved-cancelled", "failed", "not_started"), authorityId: "authority-proof", state: "cancelled" } });
  await setup.store.append("provider-gateway.operation", { operation: { ...legacy("operation-conflicting-record", "failed", "not_started"), authorityId: "authority-proof" } });
  await setup.store.append("provider-gateway.operation", { operation: {
    ...legacy("operation-conflicting-record", "failed", "not_started"), routeId: "provider.plan_expander",
    action: "plan_expander", authorityId: "authority-plan", requestDigest: "2".repeat(64)
  } });
  const restarted = new LocalProviderCommandGateway({
    store: setup.store,
    sessions: setup.sessions,
    authenticationToken: "7".repeat(64),
    backends: [setup.codex],
    now: () => "2026-08-24T12:01:00.000Z"
  }).connect("7".repeat(64));
  for (const operationId of ["operation-legacy-missing", "operation-inconsistent", "operation-conflicting-record"]) {
    const observed = await restarted.observeBoundOperation({ operationId, action: "proof", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", sessionId: "codex-session", authorityId: "authority-proof" });
    assert.equal(observed.state, "active");
    if (observed.state === "active") assert.equal(observed.effectDisposition, "ambiguous");
  }
  assert.deepEqual(await restarted.observeBoundOperation({ operationId: "operation-proved-cancelled", action: "proof", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", sessionId: "codex-session", authorityId: "authority-proof" }), {
    state: "terminal", operationId: "operation-proved-cancelled", action: "proof", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", sessionId: "codex-session", authorityId: "authority-proof",
    status: "cancelled", effectDisposition: "not_started", summary: "The exact provider gateway operation has durable cancelled effect truth."
  });
});

test("legacy automation effect records are recovery-only and never reenter provider backends", async (context) => {
  const setup = await fixture(context);
  class RecoveryProbeBackend extends DeterministicProviderGatewayBackend {
    observeCalls = 0;
    cancellationCalls = 0;
    override async observeOperation(
      request: Parameters<ProviderGatewayBackend["observeOperation"]>[0]
    ) {
      this.observeCalls += 1;
      return super.observeOperation(request);
    }
    override async cancelOperation(
      request: Parameters<ProviderGatewayBackend["cancelOperation"]>[0]
    ) {
      this.cancellationCalls += 1;
      return super.cancelOperation(request);
    }
  }
  const backend = new RecoveryProbeBackend("codex");
  await setup.store.append("provider-gateway.operation", { operation: {
    operationId: "legacy-automation-effect",
    externalId: "legacy-automation-effect",
    routeId: "automation.compound_capture",
    provider: "codex",
    sessionId: "codex-session",
    repositoryRoot: "C:\\repo",
    targetSnapshotId: targetId,
    action: "compound_capture",
    authorityId: "authority-automation",
    requestDigest: "1".repeat(64),
    state: "submitted",
    cancellationAcknowledged: false,
    updatedAt: "2026-08-24T12:00:01.000Z"
  } });
  const client = new LocalProviderCommandGateway({
    store: setup.store,
    sessions: setup.sessions,
    authenticationToken: "9".repeat(64),
    backends: [backend],
    now: () => "2026-08-24T12:01:00.000Z"
  }).connect("9".repeat(64));

  const observed = await client.observeOperation("legacy-automation-effect");
  assert.equal(observed.settled, false);
  assert.match(observed.summary, /host-local|manual recovery|legacy automation/i);
  const bound = await client.observeBoundOperation({
    operationId: "legacy-automation-effect", action: "compound_capture", targetSnapshotId: targetId,
    repositoryRoot: "C:\\repo", sessionId: "codex-session", authorityId: "authority-automation"
  });
  assert.equal(bound.state, "active");
  assert.equal(await client.cancelByOperation("legacy-automation-effect", "operator requested recovery"), 0);
  assert.equal(backend.observeCalls, 0);
  assert.equal(backend.cancellationCalls, 0);
});

test("dedicated local Re-anchor rereads protected context, reports without resume, and is exact-request idempotent", async (context) => {
  const setup = await fixture(context);
  const input = reanchorEnvelope();
  await setup.sessions.upsert(input.session);
  const body = JSON.stringify({ schema: "sxsy-b122.provider-reanchor-request", ...input });
  const [first, duplicate] = await Promise.all([
    setup.client.request({ routeId: "provider.reanchor.codex", repositoryRoot: input.repositoryRoot, body }),
    setup.client.request({ routeId: "provider.reanchor.codex", repositoryRoot: input.repositoryRoot, body })
  ]);
  assert.equal(first.outcome, "passed", first.detail);
  assert.deepEqual(duplicate.body, first.body);
  assert.equal(setup.codex.reanchorCalls, 1);
  const acknowledgement = JSON.parse(Buffer.from(first.body!).toString("utf8")) as Record<string, unknown>;
  assert.equal(acknowledgement.schema, "sxsy-b122.reanchor-acknowledgement");
  assert.equal(acknowledgement.artifactDigest, input.artifactDigest);
  assert.equal((acknowledgement.report as Record<string, unknown>).result, "reanchored_without_resume");
  assert.equal(acknowledgement.resumed, false);
  const observed = await setup.client.request({ routeId: "provider.observe-reanchor.codex", repositoryRoot: input.repositoryRoot, body });
  assert.equal(observed.outcome, "passed");
  assert.deepEqual(observed.body, first.body);
  assert.equal(setup.codex.reanchorCalls, 1, "observation must never replay the Re-anchor effect");

  const substituted = JSON.parse(body) as Record<string, unknown>;
  substituted.confirmationScopeDigest = "0".repeat(64);
  assert.equal((await setup.client.request({ routeId: "provider.reanchor.codex", repositoryRoot: input.repositoryRoot, body: JSON.stringify(substituted) })).outcome, "blocked");
  assert.equal((await setup.client.request({ routeId: "provider.observe-reanchor.codex", repositoryRoot: input.repositoryRoot, body: JSON.stringify(substituted) })).outcome, "blocked");
  assert.equal((await setup.client.request({ routeId: "provider.reanchor", repositoryRoot: input.repositoryRoot, body })).outcome, "blocked");
  assert.equal(setup.codex.reanchorCalls, 1);
});

test("workflow child commands enforce the immutable provider profile and return one singleton child result", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession("codex"));
  const accepted = await setup.client.request({ routeId: "provider.proof_adversarial", repositoryRoot: "C:\\repo", body: adversarialChildBody(setup, "child-proof-codex-1") });
  assert.equal(accepted.outcome, "passed");
  const response = JSON.parse(Buffer.from(accepted.body!).toString("utf8")) as Record<string, unknown>;
  assert.equal(response.schema, "sxsy-b122.workflow-child-result");
  assert.equal(response.childOperationId, "child-proof-codex-1");
  assert.equal(response.parentOperationId, "parent-proof-adversarial");
  assert.equal(response.adapterId, setup.codex.dispatchIdentity.adapterId);
  assert.equal((response.result as { kind: string }).kind, "proof_backend");

  const aliased = await setup.client.request({ routeId: "provider.proof_adversarial", repositoryRoot: "C:\\repo", body: adversarialChildBody(setup, "child-proof-codex-alias", "untrusted-alias") });
  assert.notEqual(aliased.outcome, "passed", "a provider label cannot alias a different host adapter profile");
  assert.equal(setup.codex.commandCalls, 1, "profile aliases must be rejected before any backend effect");
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
  assert.equal(queueObservation.settled, false);
  assert.match(queueObservation.summary, /not the prior effect disposition|no terminal state/i);
  const wrongSession = await setup.client.observeProviderOperation({
    operationId: "operation-running-1",
    action: "proof",
    sessionId: "substituted-session",
    provider: "codex",
    authorityId: "authority-proof",
    repositoryRoot: "C:\\repo",
    routeId: "provider.proof",
    externalId: "operation-running-1",
    targetSnapshotId: targetId
  });
  assert.equal(wrongSession?.outcome, "unresolved");
  assert.match(wrongSession?.note ?? "", /binding changed/i);
  const recoveryObservation = await setup.client.observeProviderOperation({
    operationId: "operation-running-1",
    action: "proof",
    sessionId: "codex-session",
    provider: "codex",
    authorityId: "authority-proof",
    repositoryRoot: "C:\\repo",
    routeId: "provider.proof",
    externalId: "operation-running-1",
    targetSnapshotId: targetId
  });
  assert.equal(recoveryObservation?.outcome, "unresolved");
  assert.equal(recoveryObservation?.effectDisposition, "ambiguous");
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

test("local provider gateway refuses reviewed automation effect routes before backend entry", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession());
  const envelope = reviewedAutomationEnvelope();

  const response = await setup.client.request({
    routeId: "automation.compound_capture",
    repositoryRoot: "C:\\repo",
    body: JSON.stringify(envelope)
  });
  assert.equal(response.outcome, "blocked", response.detail);
  assert.equal(response.effectDisposition, "not_started");
  assert.match(response.detail, /host-local|proposal-only|automation effect/i);
  assert.equal(setup.codex.commandCalls, 0);
});

test("automation gateway rejects omitted or substituted review artifacts before provider execution", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession());
  const exact = reviewedAutomationEnvelope("automation-operation-adversarial");
  const { manifest: _manifest, ...withoutManifest } = exact;
  const { approval: _approval, ...withoutApproval } = exact;
  const substitutedApproval = {
    ...exact,
    approval: { ...exact.approval, confirmationDigest: "0".repeat(64) }
  };
  const substitutedIntent = {
    ...exact,
    intent: {
      ...exact.intent,
      binding: { ...exact.intent.binding, proposalDigest: "0".repeat(64) }
    }
  };

  for (const body of [withoutManifest, withoutApproval, substitutedApproval, substitutedIntent]) {
    const result = await setup.client.request({
      routeId: "automation.compound_capture",
      repositoryRoot: "C:\\repo",
      body: JSON.stringify(body)
    });
    assert.equal(result.outcome, "blocked", result.detail);
  }
  assert.equal(setup.codex.commandCalls, 0);
});

test("automation gateway rejects future or expired reviewed lifetimes before provider execution", async (context) => {
  const setup = await fixture(context);
  await setup.sessions.upsert(providerSession());
  const expired = reviewedAutomationEnvelope("automation-operation-expired", {
    createdAt: "2026-08-24T11:40:00.000Z",
    expiresAt: "2026-08-24T11:50:00.000Z",
    confirmedAt: "2026-08-24T11:41:00.000Z",
    approvalExpiresAt: "2026-08-24T11:49:00.000Z"
  });
  const future = reviewedAutomationEnvelope("automation-operation-future", {
    createdAt: "2026-08-24T12:05:00.000Z",
    expiresAt: "2026-08-24T12:15:00.000Z",
    confirmedAt: "2026-08-24T12:06:00.000Z",
    approvalExpiresAt: "2026-08-24T12:14:00.000Z"
  });
  for (const envelope of [expired, future]) {
    const result = await setup.client.request({
      routeId: "automation.compound_capture",
      repositoryRoot: "C:\\repo",
      body: JSON.stringify(envelope)
    });
    assert.equal(result.outcome, "blocked", result.detail);
  }
  assert.equal(setup.codex.commandCalls, 0);
});

test("automation effect route cannot reach even a substituting provider backend", async (context) => {
  class SubstitutingBackend extends DeterministicProviderGatewayBackend {
    override async execute(request: ProviderGatewayCommand): Promise<ProviderGatewayCommandResult> {
      const response = await super.execute(request);
      if (request.kind !== "automation") return response;
      return { ...response, manifestDigest: "0".repeat(64) } as ProviderGatewayCommandResult;
    }
  }
  const root = await mkdtemp(join(tmpdir(), "b122-provider-gateway-substitution-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const store = new ProtectedJsonStore({ filePath: join(root, "protected.jsonl") });
  const sessions = new SessionRegistry(store);
  const backend = new SubstitutingBackend("codex");
  const client = new LocalProviderCommandGateway({
    store,
    sessions,
    authenticationToken: "8".repeat(64),
    backends: [backend],
    now: () => "2026-08-24T12:00:00.000Z"
  }).connect("8".repeat(64));
  await sessions.upsert(providerSession());

  const result = await client.request({
    routeId: "automation.compound_capture",
    repositoryRoot: "C:\\repo",
    body: JSON.stringify(reviewedAutomationEnvelope("automation-operation-substituted-result"))
  });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.effectDisposition, "not_started");
  assert.match(result.detail, /host-local|proposal-only|automation effect/i);
  assert.equal(backend.commandCalls, 0);
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

  const proposal = await router.request({
    routeId: "automation.proposal.compound_capture",
    repositoryRoot: "C:\\repo",
    body: "{}"
  });
  assert.equal(proposal.detail, "explicit configured fallback");
  assert.equal(fallbackCalls, 1, "read-only automation proposals must reach the configured provider transport");

  const automation = await router.request({
    routeId: "automation.compound_capture",
    repositoryRoot: "C:\\repo",
    body: JSON.stringify(reviewedAutomationEnvelope("automation-router-refusal"))
  });
  assert.equal(automation.outcome, "blocked");
  assert.equal(automation.effectDisposition, "not_started");
  assert.equal(fallbackCalls, 1, "automation effects must never fall through to a configured provider transport");
  assert.equal(router.recoveryExternalId({ routeId: "automation.compound_capture", operationId: "automation-router-refusal", provider: "generic" }), undefined);

  const genericBody = workflowBody("operation-router-generic").replace('"provider":"codex"', '"provider":"generic"');
  assert.equal((await router.request({ routeId: "provider.proof", repositoryRoot: "C:\\repo", body: genericBody })).detail, "explicit configured fallback");
  assert.equal(fallbackCalls, 2);
});
