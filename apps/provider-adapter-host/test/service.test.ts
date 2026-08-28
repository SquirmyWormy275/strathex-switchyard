import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import {
  automationEffectLeaseArtifact,
  automationRequestSchema,
  createAutomationIntent,
  parseAutomationEnvelope
} from "../../../packages/control-plane/src/automation-protocol.ts";
import {
  automationManifestReviewScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest,
  type AutomationManifestAction
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import type { AutomationProposalRequest } from "../../../packages/control-plane/src/automation-proposal-protocol.ts";
import { canonicalWorkflowArtifact, planApprovalReviewScopeDigest } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import {
  ClaudeProviderAdapterBackend,
  ConfiguredProviderMediatedEffectHostPort,
  CodexProviderAdapterBackend,
  FixtureProviderRuntimePort,
  providerEffectCapabilityFloor,
  type ProviderMediatedEffectBinding,
  type ProviderMediatedFinalCurrentDecision,
  type ProviderRuntimePort
} from "../src/backends.ts";
import type { ProviderGatewayCommand } from "../../windows-companion/src/provider-gateway.ts";
import { signProviderDispatchLease } from "../src/dispatch-lease.ts";
import { ProviderAdapterHostService } from "../src/service.ts";
import { createProviderHostStore } from "../src/state.ts";
import type { ProviderCouncilCleanupRequest } from "../src/state.ts";

const token = "a".repeat(64);
const leaseKey = "c".repeat(64);
const fixedNow = "2026-08-25T12:00:00.000Z";
const automationContent = (value: string) => ({
  afterDigest: sha256(value),
  content: { encoding: "base64" as const, byteLength: Buffer.byteLength(value, "utf8"), data: Buffer.from(value, "utf8").toString("base64") }
});
const hostIdentity = { configurationSha256: "1".repeat(64), lifecycleNonceSha256: "2".repeat(64), tlsSpkiSha256: "3".repeat(64) } as const;
const targetIdentity = {
  repositoryRoot: "C:\\repo", canonicalRemote: "https://github.com/acme/repo.git", branch: "feature/provider-host",
  defaultBranch: "main", upstream: "origin/feature/provider-host", head: "d".repeat(40), indexTree: "1".repeat(40),
  trackedManifest: "e".repeat(64), untrackedManifest: "f".repeat(64), submodules: {}, policyVersion: "policy-v1",
  environmentFingerprint: "2".repeat(64), completeness: "complete", reasons: []
} as const;
const fullTarget = { id: targetSnapshotDigest(targetIdentity), ...targetIdentity, detached: false, capturedAt: fixedNow } as const;
const target = fullTarget.id;
const changedTarget = "c".repeat(64);
let leaseSequence = 0;
const dispatchLeaseOptions = { authenticationKey: leaseKey, host: hostIdentity } as const;

function mediatedFinalDecision(binding: ProviderMediatedEffectBinding): ProviderMediatedFinalCurrentDecision {
  const material = {
    schema: "sxsy-b122.provider-mediated-final-current-decision" as const, version: 1 as const,
    authorizationId: binding.authorizationId, leaseId: binding.leaseId, operationId: binding.operationId, action: binding.action,
    sessionId: binding.sessionId, authorityId: binding.authorityId, targetSnapshotId: binding.targetSnapshotId,
    repositoryRoot: binding.repositoryRoot, containmentBindingDigest: binding.containmentBindingDigest,
    containmentFenceEpoch: binding.containmentFenceEpoch, challengeNonce: "4".repeat(64), allowed: true as const,
    decidedAt: fixedNow, expiresAt: "2026-08-25T12:00:05.000Z"
  };
  return { ...material, decisionDigest: sha256(stableJson(material)) };
}

async function fixture(context: test.TestContext, codex = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true }), operationDeadlineMs = 10_000) {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-host-"));
  context.after(async () => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = createProviderHostStore(join(directory, "provider-host.jsonl"), token);
  const claude = new FixtureProviderRuntimePort("claude", { effectfulTestOnly: true });
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store,
    backends: [new ClaudeProviderAdapterBackend(claude), new CodexProviderAdapterBackend(codex)],
    dispatchLease: dispatchLeaseOptions,
    operationDeadlineMs,
    now: () => fixedNow
  });
  return { directory, store, claude, codex, service };
}

function request(path: string, body?: unknown, authorization = `Bearer ${token}`, method = "POST", attachLease = true) {
  const council = /^\/v1\/b122\/council\/(?:claude|codex)$/.test(path);
  const effectBody = council && body && typeof body === "object" && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), authorityId: "authority-provider-host", operationId: `council:${String((body as Record<string, unknown>).epochId)}:${String((body as Record<string, unknown>).phase)}` }
    : body;
  const document = attachLease && effectPath(path) && effectBody && typeof effectBody === "object" && !Array.isArray(effectBody) && !Object.hasOwn(effectBody, "dispatchLease")
    ? { ...(effectBody as Record<string, unknown>), dispatchLease: dispatchLease(path, effectBody as Record<string, unknown>) }
    : effectBody;
  return { method, path, headers: { authorization }, ...(document === undefined ? {} : { body: JSON.stringify(document) }) };
}

function effectPath(path: string): boolean { return /^\/v1\/b122\/(?:command\/|automation\/|council\/(?:claude|codex)$)/.test(path); }

function requiredSignal(value: AbortSignal | undefined): AbortSignal {
  assert.ok(value, "the provider-host boundary must supply one exact cancellation signal");
  return value;
}

function dispatchLease(
  path: string,
  body: Record<string, unknown>,
  nonce = sha256(`lease-${++leaseSequence}`),
  module = { adapterId: `sxsy-b122.fixture.${path.endsWith("/claude") || (body.session as { provider?: string } | undefined)?.provider === "claude" ? "claude" : "codex"}`, moduleSha256: sha256(`sxsy-b122.fixture.${path.endsWith("/claude") || (body.session as { provider?: string } | undefined)?.provider === "claude" ? "claude" : "codex"}.v1`) },
  adapterVersion?: string
) {
  const provider = path.endsWith("/claude") || (body.session as { provider?: string } | undefined)?.provider === "claude" ? "claude" : "codex";
  const council = body.schema === "sxsy-b122.council-phase";
  const action = council ? `council_${String(body.phase)}` : String(body.action);
  const routeId = council ? `council.${provider}` : path.includes("/automation/") ? `automation.${action}` : `provider.${action}`;
  const operationId = council ? `council:${String(body.epochId)}:${String(body.phase)}` : String(body.operationId);
  const artifactValue = body.artifact as Record<string, unknown> | undefined;
  const authorization = body.executionAuthorization as Record<string, unknown> | undefined;
  const reviewedAutomation = body.manifest && body.approval ? parseAutomationEnvelope(body) : undefined;
  return signProviderDispatchLease({
    schema: "sxsy-b122.provider-dispatch-lease", version: 1,
    leaseId: `lease-${nonce.slice(0, 24)}`, nonce, issuedAt: fixedNow, expiresAt: "2026-08-25T12:00:30.000Z",
    authority: { id: typeof body.authorityId === "string" ? body.authorityId : "authority-provider-host", grantDigest: "4".repeat(64), scopeDigest: "5".repeat(64), expiresAt: "2026-08-25T12:01:00.000Z" },
    target: fullTarget,
    session: {
      id: council ? String(body.sessionId) : String((body.session as Record<string, unknown>).id), provider,
      taskId: council ? "task-provider-host" : ((body.session as Record<string, unknown>).taskId as string | undefined) ?? null,
      planRevision: council ? "plan-1" : ((body.session as Record<string, unknown>).planRevision as string | undefined) ?? null,
      adapterVersion: adapterVersion ?? `${provider}-fixture-provider-host-v1`
    },
    dispatch: { routeId, action, operationId },
    artifact: reviewedAutomation ? automationEffectLeaseArtifact(reviewedAutomation) : artifactValue ? {
      id: String(artifactValue.id), digest: String(artifactValue.digest),
      coordinatorContextDigest: typeof artifactValue.coordinatorContextDigest === "string" ? artifactValue.coordinatorContextDigest : null,
      coordinatorContextRevision: typeof artifactValue.coordinatorContextRevision === "number" ? artifactValue.coordinatorContextRevision : null
    } : council && body.phase !== "pause" ? {
      id: String(body.epochId), digest: String(body.assignmentDigest), coordinatorContextDigest: null, coordinatorContextRevision: null
    } : null,
    confirmation: reviewedAutomation
      ? { digest: reviewedAutomation.approval.confirmationDigest, scopeDigest: reviewedAutomation.approval.reviewScopeDigest }
      : authorization ? { digest: String(authorization.confirmationDigest), scopeDigest: String(authorization.confirmationScopeDigest) } : null,
    containment: { status: "clear", bindingDigest: "6".repeat(64), fenceEpoch: 1, activationOperationId: null },
    host: hostIdentity,
    module
  }, leaseKey);
}

function handshake(provider: "claude" | "codex" = "codex", snapshot = target) {
  return {
    schema: "sxsy-b122.provider-handshake-request",
    version: 1,
    sessionId: `${provider}-session`,
    provider,
    targetSnapshotId: snapshot,
    repositoryRoot: "C:\\repo",
    branch: "feature/provider-host",
    head: "d".repeat(40),
    requestedAt: "2026-08-25T12:00:00.000Z"
  };
}

function automation(operationId = "operation-automation-1", snapshot = target, approvalExpiresAt = "2026-08-25T12:09:00.000Z") {
  const manifest = createAutomationOperationManifest({
    repositoryRoot: "C:\\repo", targetSnapshotId: snapshot, sessionId: "codex-session", authorityId: "authority-provider-host",
    taskId: "task-provider-host", planRevision: "plan-1", provider: "codex",
    createdAt: "2026-08-25T11:59:00.000Z", expiresAt: "2026-08-25T12:10:00.000Z"
  }, {
    kind: "compound_capture", solvedProblemEvidenceDigest: "1".repeat(64), verifiedOutcomeEvidenceDigest: "2".repeat(64),
    nonTrivialRationale: "The provider-host fixture captures one exact reviewed protocol result.",
    documents: [{ path: "docs/solutions/provider-host-capture.md", mutation: "create", beforeDigest: null, ...automationContent("# Provider host capture\n") }],
    instructionFileMutation: { kind: "none" }
  });
  const approval = createAutomationManifestApproval({
    manifest, confirmationToken: `confirmation-${operationId}`,
    confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
    confirmedAt: "2026-08-25T11:59:30.000Z", expiresAt: approvalExpiresAt
  });
  return {
    schema: automationRequestSchema("compound_capture"),
    version: 1,
    action: "compound_capture" as const,
    operationId,
    target: {
      id: snapshot,
      repositoryRoot: "C:\\repo",
      branch: "feature/provider-host",
      head: "d".repeat(40),
      policyVersion: "policy-v1",
      trackedManifest: "e".repeat(64),
      untrackedManifest: "f".repeat(64)
    },
    session: {
      id: "codex-session",
      provider: "codex",
      surface: "vscode_terminal",
      capabilities: ["registered", "observable", "controllable", "mediated"],
      taskId: "task-provider-host",
      planRevision: "plan-1",
      plannedFiles: ["src/example.ts"]
    },
    authorityId: "authority-provider-host",
    manifest,
    approval,
    intent: createAutomationIntent(
      "compound_capture",
      { digest: approval.confirmationDigest, scopeDigest: approval.reviewScopeDigest },
      undefined,
      { manifest, approval }
    )
  };
}

function automationProposal(action: AutomationManifestAction, change: Readonly<Record<string, unknown>> = {}): AutomationProposalRequest {
  return {
    schema: "sxsy-b122.automation-proposal-request",
    version: 1,
    requestId: `proposal-${action}`,
    action,
    target: {
      id: target, repositoryRoot: "C:\\repo", canonicalRemote: targetIdentity.canonicalRemote,
      branch: targetIdentity.branch, defaultBranch: targetIdentity.defaultBranch, head: targetIdentity.head,
      indexTree: targetIdentity.indexTree, trackedManifest: targetIdentity.trackedManifest,
      untrackedManifest: targetIdentity.untrackedManifest, submodules: {}, policyVersion: targetIdentity.policyVersion,
      environmentFingerprint: targetIdentity.environmentFingerprint, capturedAt: fixedNow, completeness: "complete"
    },
    session: {
      id: "codex-session", provider: "codex", surface: "bridge",
      capabilities: ["registered", "observable", "controllable", "mediated"], status: "running",
      workspaceRoot: "C:\\repo", targetSnapshotId: target, taskId: "task-provider-host", planRevision: "plan-1",
      plannedFiles: ["src/example.ts"], adapterVersion: "codex-fixture-provider-host-v1"
    },
    authorityId: "authority-automation-proposal",
    effectAuthorized: false,
    ...change
  } as AutomationProposalRequest;
}

function operationObservation(operationId: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schema: "sxsy-b122.provider-operation-observe", version: 1,
    operationId, externalId: operationId, routeId: "automation.compound_capture",
    action: "compound_capture", sessionId: "codex-session", provider: "codex",
    authorityId: "authority-provider-host", targetSnapshotId: target, repositoryRoot: "C:\\repo",
    ...overrides
  };
}

function operationCancellation(operationId: string, reason = "operator cancelled", overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schema: "sxsy-b122.provider-operation-cancel", version: 1,
    operationId, externalId: operationId, routeId: "automation.compound_capture",
    action: "compound_capture", sessionId: "codex-session", provider: "codex",
    authorityId: "authority-provider-host", targetSnapshotId: target, repositoryRoot: "C:\\repo", reason,
    ...overrides
  };
}

function workflowOperationObservation(operationId: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return operationObservation(operationId, { routeId: "provider.proof", action: "proof", ...overrides });
}

function workflowOperationCancellation(operationId: string, reason = "operator cancelled", overrides: Readonly<Record<string, unknown>> = {}) {
  return operationCancellation(operationId, reason, { routeId: "provider.proof", action: "proof", ...overrides });
}

function existingPlan() {
  const planMaterial = {
    revision: "plan-1",
    originSessionId: "codex-session",
    taskId: "task-provider-host",
    objective: "Verify provider host",
    steps: [{ id: "step-1", summary: "Verify", ownedFiles: ["src/example.ts"], dependencies: [] as string[], status: "approved" as const }],
    decisions: [] as string[],
    expectedTargetTransition: { beforeTargetSnapshotId: target, expectedAfterTargetSnapshotId: target, expectation: "unchanged" as const }
  };
  return { digest: sha256(stableJson(planMaterial)), ...planMaterial };
}

function coordinatorEvidence() {
  const plan = existingPlan();
  const evidenceMaterial = {
    instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context" as const, summary: "Instructions" }],
    plan,
    documentation: [{ id: "documentation", digest: "2".repeat(64), source: "repository" as const, summary: "Documentation" }],
    diff: { id: "diff", digest: "3".repeat(64), source: "target_snapshot" as const, summary: "Diff" },
    files: [{ id: "file", digest: "4".repeat(64), source: "repository" as const, summary: "File" }],
    tests: [{ id: "receipt", digest: "5".repeat(64), source: "receipt" as const, summary: "Test", status: "passed" as const }]
  };
  return { contextDigest: sha256(stableJson(evidenceMaterial)), ...evidenceMaterial };
}

function workflow(operationId = "operation-proof-1") {
  const payload = {
    kind: "proof" as const,
    evidence: coordinatorEvidence(),
    claims: ["The host returned exact evidence."],
    requiredBackends: ["fixture"],
    independentBackendRequired: false
  };
  const coordinatorContextDigest = "7".repeat(64);
  const coordinatorContextRevision = 3;
  const canonical = canonicalWorkflowArtifact({
    id: "artifact-proof-1", action: "proof", repositoryRoot: "C:\\repo", targetSnapshotId: target,
    sessionId: "codex-session", taskId: "task-provider-host", planRevision: "plan-1",
    authorityId: "authority-provider-host", coordinatorContextDigest, coordinatorContextRevision, payload
  });
  return {
    schema: "sxsy-b122.workflow-command",
    version: 1,
    action: "proof",
    operationId,
    authorityId: "authority-provider-host",
    target: automation(operationId).target,
    session: automation(operationId).session,
    artifact: {
      id: "artifact-proof-1",
      digest: canonical.digest,
      taskId: "task-provider-host",
      planRevision: "plan-1",
      authorityId: "authority-provider-host",
      coordinatorContextDigest,
      coordinatorContextRevision,
      payload,
      executionAuthorized: false
    }
  };
}

function authorityWorkflow(action: "authority_refresh" | "authority_broadcast", operationId: string) {
  const plan = existingPlan();
  const pendingRequest = {
    requestId: `pending-${action}`,
    targetSnapshotId: target,
    planRevision: plan.revision,
    planDigest: plan.digest,
    action: "proof" as const
  };
  const session = {
    id: "codex-session",
    provider: "codex" as const,
    surface: "vscode_terminal" as const,
    capabilities: ["registered", "observable", "controllable", "mediated"] as const,
    status: "verified_blocked" as const,
    workspaceRoot: "C:\\repo",
    targetSnapshotId: target,
    taskId: plan.taskId,
    planRevision: plan.revision,
    plannedFiles: ["src/example.ts"],
    lastHeartbeat: fixedNow,
    adapterVersion: "codex-fixture-provider-host-v1",
    metadata: {}
  };
  const authority = {
    id: "authority-provider-host",
    repositoryRoot: "C:\\repo",
    sessionId: session.id,
    taskId: plan.taskId,
    planRevision: plan.revision,
    allowedActions: ["proof", action] as const,
    prohibitedActions: [] as const,
    issuedAt: "2026-08-25T11:00:00.000Z",
    expiresAt: "2026-08-25T13:00:00.000Z",
    issuedBy: "test-current-user"
  };
  const providerEffectMaterial = {
    role: "authority_recipient" as const,
    provider: "codex" as const,
    session,
    authority,
    adapterId: "sxsy-b122.fixture.codex",
    adapterVersion: session.adapterVersion,
    moduleSha256: sha256("sxsy-b122.fixture.codex.v1"),
    providerContextDigest: "8".repeat(64)
  };
  const providerEffect = { ...providerEffectMaterial, bindingDigest: sha256(stableJson(providerEffectMaterial)) };
  const packetMaterial = {
    recipientSessionId: session.id,
    grantId: authority.id,
    actions: authority.allowedActions,
    prohibitions: authority.prohibitedActions,
    expiresAt: authority.expiresAt,
    pendingRequest,
    ...(action === "authority_broadcast" ? { providerEffect } : {})
  };
  const packet = { ...packetMaterial, matchDigest: sha256(stableJson(packetMaterial)) };
  const payload = {
    kind: "authority" as const,
    mode: action === "authority_refresh" ? "refresh" as const : "broadcast" as const,
    packets: [packet],
    acknowledgementRequired: true as const
  };
  const coordinatorContextDigest = "7".repeat(64);
  const coordinatorContextRevision = 3;
  const artifactId = `artifact-${action}`;
  const canonical = canonicalWorkflowArtifact({
    id: artifactId,
    action,
    repositoryRoot: "C:\\repo",
    targetSnapshotId: target,
    sessionId: session.id,
    taskId: plan.taskId,
    planRevision: plan.revision,
    authorityId: authority.id,
    coordinatorContextDigest,
    coordinatorContextRevision,
    payload
  });
  return {
    schema: "sxsy-b122.workflow-command",
    version: 1,
    action,
    operationId,
    authorityId: authority.id,
    target: automation(operationId).target,
    session: automation(operationId).session,
    artifact: {
      id: artifactId,
      digest: canonical.digest,
      taskId: plan.taskId,
      planRevision: plan.revision,
      authorityId: authority.id,
      coordinatorContextDigest,
      coordinatorContextRevision,
      payload,
      executionAuthorized: false
    }
  };
}

function planApprovalWorkflow(operationId = "operation-plan-approval-1") {
  const plan = existingPlan();
  const authorityId = "authority-provider-host";
  const coordinatorContextDigest = "7".repeat(64);
  const coordinatorContextRevision = 3;
  const providerContextDigest = "8".repeat(64);
  const confirmationDigest = sha256("provider-host-current-user-confirmation");
  const confirmationScopeDigest = planApprovalReviewScopeDigest({
    sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo",
    taskId: plan.taskId, planRevision: plan.revision, planDigest: plan.digest,
    originSessionId: plan.originSessionId, providerContextDigest, sourceRevision: coordinatorContextRevision
  });
  const payload = {
    kind: "plan" as const,
    mode: "approve" as const,
    plan,
    executorSessionId: "codex-session",
    authorityId,
    confirmationDigest,
    confirmationScopeDigest,
    providerContextDigest,
    executeOnce: true as const
  };
  const canonical = canonicalWorkflowArtifact({
    id: "artifact-plan-approval-1", action: "plan_approval", repositoryRoot: "C:\\repo", targetSnapshotId: target,
    sessionId: "codex-session", taskId: plan.taskId, planRevision: plan.revision, authorityId,
    coordinatorContextDigest, coordinatorContextRevision, payload
  });
  return {
    schema: "sxsy-b122.workflow-command",
    version: 1,
    action: "plan_approval",
    operationId,
    authorityId,
    target: automation(operationId).target,
    session: automation(operationId).session,
    artifact: {
      id: "artifact-plan-approval-1", digest: canonical.digest, taskId: plan.taskId, planRevision: plan.revision,
      authorityId, coordinatorContextDigest, coordinatorContextRevision, payload, executionAuthorized: false
    },
    executionAuthorization: {
      executionAuthorized: true, executeOnce: true, currentUserConfirmed: true,
      confirmationDigest, confirmationScopeDigest, operationId,
      artifactId: "artifact-plan-approval-1", artifactDigest: canonical.digest,
      targetSnapshotId: target, sessionId: "codex-session", authorityId,
      planDigest: plan.digest, planRevision: plan.revision, originSessionId: plan.originSessionId
    }
  };
}

function backendAutomationCommand(operationId: string) {
  const body = automation(operationId);
  return {
    kind: "automation" as const,
    routeId: "automation.compound_capture",
    operationId,
    externalId: operationId,
    action: "compound_capture" as const,
    repositoryRoot: "C:\\repo",
    targetSnapshotId: target,
    sessionId: "codex-session",
    authorityId: "authority-provider-host",
    provider: "codex" as const,
    manifest: body.manifest,
    approval: body.approval,
    intent: body.intent
  };
}

function backendWorkflowCommand(action: "proof" | "plan_approval", operationId: string): ProviderGatewayCommand {
  const body = action === "proof" ? workflow(operationId) : planApprovalWorkflow(operationId);
  const executionAuthorization = "executionAuthorization" in body ? body.executionAuthorization : undefined;
  return {
    kind: "workflow",
    routeId: `provider.${action}`,
    operationId,
    externalId: operationId,
    action,
    repositoryRoot: body.target.repositoryRoot,
    targetSnapshotId: body.target.id,
    sessionId: body.session.id,
    provider: body.session.provider,
    authorityId: body.authorityId,
    artifact: body.artifact,
    ...(executionAuthorization ? { executionAuthorization } : {})
  } as ProviderGatewayCommand;
}

function councilResourceHost(fenceDigest = "8".repeat(64), epochId = "epoch-1") {
  const resource = { leaseId: "lease-1", kind: "port", fence: 1, declaration: "port:4100", bindingType: "loopback-listener", value: "4100", environmentName: "SXSY_COUNCIL_PORT_1" };
  const unsigned = {
    schema: "sxsy-b122.council-resource-host", version: 1, epochId, sessionId: "codex-session",
    fenceDigest, capabilities: ["held-loopback-port"], resources: [resource],
    environment: {
      SXSY_COUNCIL_EPOCH_ID: epochId, SXSY_COUNCIL_SESSION_ID: "codex-session",
      SXSY_COUNCIL_TARGET_SNAPSHOT_ID: target, SXSY_COUNCIL_WORKTREE_ROOT: "C:\\worktree",
      SXSY_COUNCIL_BRANCH: `council/${epochId}`, SXSY_COUNCIL_HEAD: "d".repeat(40),
      SXSY_COUNCIL_RESOURCE_FENCE_DIGEST: fenceDigest, SXSY_COUNCIL_PORT_1: "4100"
    }
  };
  return { ...unsigned, digest: sha256(stableJson(unsigned)) };
}

function councilCredentialResourceHost(value: string) {
  const resource = {
    leaseId: "credential-lease-1", kind: "credential_scope", fence: 1,
    declaration: "credential:codex-current-user", bindingType: "opaque-credential-capability",
    value, environmentName: "SXSY_COUNCIL_CREDENTIAL_CAPABILITY_ID_1", credentialExpiresAt: 1_800_000_000_000
  };
  const unsigned = {
    schema: "sxsy-b122.council-resource-host", version: 1, epochId: "epoch-1", sessionId: "codex-session",
    fenceDigest: "8".repeat(64), capabilities: ["session-fenced-credential-capability"], resources: [resource],
    environment: {
      SXSY_COUNCIL_EPOCH_ID: "epoch-1", SXSY_COUNCIL_SESSION_ID: "codex-session",
      SXSY_COUNCIL_TARGET_SNAPSHOT_ID: target, SXSY_COUNCIL_WORKTREE_ROOT: "C:\\worktree",
      SXSY_COUNCIL_BRANCH: "council/epoch-1", SXSY_COUNCIL_HEAD: "d".repeat(40),
      SXSY_COUNCIL_RESOURCE_FENCE_DIGEST: "8".repeat(64), SXSY_COUNCIL_CREDENTIAL_CAPABILITY_ID_1: value
    }
  };
  return { ...unsigned, digest: sha256(stableJson(unsigned)) };
}

test("authenticated health, handshake, provider workflows, and proposal-only automation use exact bindings", async (context) => {
  const { service, codex } = await fixture(context);
  assert.equal((await service.handle(request("/v1/b122/health", undefined, "Bearer wrong", "GET"))).status, 401);
  const health = await service.handle(request("/v1/b122/health", undefined, undefined, "GET"));
  assert.equal(health.status, 200);
  assert.equal((health.body as { schema: string }).schema, "sxsy-b122.provider-host-health");

  const connected = await service.handle(request("/v1/b122/handshake/codex", handshake()));
  assert.equal(connected.status, 200);
  assert.deepEqual((connected.body as { capabilities: string[] }).capabilities, ["registered", "observable", "controllable", "mediated"]);

  const proof = await service.handle(request("/v1/b122/command/proof", workflow()));
  assert.equal(proof.status, 200);
  assert.equal((proof.body as { schema: string }).schema, "sxsy-b122.workflow-result");
  assert.equal((proof.body as { result: { kind: string } }).result.kind, "proof");

  const approved = await service.handle(request("/v1/b122/command/plan_approval", planApprovalWorkflow()));
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.deepEqual(
    { kind: (approved.body as { result: { kind: string; mode: string } }).result.kind, mode: (approved.body as { result: { kind: string; mode: string } }).result.mode },
    { kind: "plan", mode: "execution_ack" }
  );

  const automationBody = automation();
  const automated = await service.handle(request("/v1/b122/automation/compound_capture", automationBody));
  assert.equal(automated.status, 410, JSON.stringify(automated.body));
  assert.equal(automated.body.effectDisposition, "not_started");
  assert.match(String(automated.body.summary), /proposal-only|companion-owned/i);
  assert.equal(codex.executeCalls, 2);
});

test("disabled provider automation effects reject every reviewed or substituted envelope before lease consumption", async (context) => {
  const { service, codex, store } = await fixture(context);
  assert.equal((await service.handle(request("/v1/b122/handshake/codex", handshake()))).status, 200);
  const exact = automation("operation-reviewed-effect");
  const exactLease = dispatchLease("/v1/b122/automation/compound_capture", exact, sha256("reviewed-effect"));

  const open = await service.handle(request(
    "/v1/b122/automation/compound_capture",
    { ...exact, unreviewedArguments: ["--force"], dispatchLease: exactLease }
  ));
  assert.equal(open.status, 410);

  const otherApproval = automation("operation-other-approval");
  const crossApproved = await service.handle(request(
    "/v1/b122/automation/compound_capture",
    { ...exact, approval: otherApproval.approval, intent: otherApproval.intent, dispatchLease: exactLease }
  ));
  assert.equal(crossApproved.status, 410);

  const scopeSubstituted = await service.handle(request(
    "/v1/b122/automation/compound_capture",
    {
      ...exact,
      intent: {
        ...exact.intent,
        proposal: {
          ...exact.intent.proposal,
          documents: [{ path: "docs/solutions/substituted.md", mutation: "create", afterDigest: "4".repeat(64) }]
        }
      },
      dispatchLease: exactLease
    }
  ));
  assert.equal(scopeSubstituted.status, 410);

  const expired = automation("operation-expired-approval", target, "2026-08-25T11:59:50.000Z");
  const expiredResult = await service.handle(request("/v1/b122/automation/compound_capture", expired));
  assert.equal(expiredResult.status, 410);
  assert.equal(codex.executeCalls, 0);
  assert.equal((await store.readEntries()).some((entry) => entry.kind === "provider-host.dispatch-lease-consumed"), false);
});

test("authenticated automation-proposal routes return bounded review material without a lease or effect", async (context) => {
  const { service, codex, store } = await fixture(context);
  await service.handle(request("/v1/b122/handshake/codex", handshake()));
  let ambiguousMarks = 0;
  for (const action of ["compound_capture", "compound_refresh", "lfg", "repair_mission"] as const) {
    const result = await service.handle({
      ...request(`/v1/b122/automation-proposal/${action}`, automationProposal(action)),
      effectProgress: { markAmbiguous() { ambiguousMarks += 1; }, disposition() { return ambiguousMarks ? "ambiguous" as const : "not_started" as const; } }
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.schema, "sxsy-b122.automation-proposal-response");
    assert.equal(result.body.action, action);
    assert.equal(result.body.effectDisposition, "not_started");
    assert.equal((result.body.proposal as { kind: string }).kind, action);
  }
  assert.equal(ambiguousMarks, 0, "review proposal progress can never become ambiguous");
  assert.equal(codex.executeCalls, 0, "the effect executor is not reachable from proposal routes");
  assert.equal((await store.readEntries()).some((entry) => entry.kind === "provider-host.dispatch-lease-consumed"), false);
});

test("automation-proposal route rejects open fields and cross-action, provider, target, session, and effect substitution", async (context) => {
  const { service, codex } = await fixture(context);
  await service.handle(request("/v1/b122/handshake/codex", handshake()));
  const exact = automationProposal("compound_capture");

  const extra = await service.handle(request("/v1/b122/automation-proposal/compound_capture", { ...exact, dispatchLease: { forged: true } }));
  assert.equal(extra.status, 400);
  assert.equal(extra.body.effectDisposition, "not_started");

  const crossAction = await service.handle(request("/v1/b122/automation-proposal/lfg", exact));
  assert.equal(crossAction.status, 400);
  const effectClaim = await service.handle(request("/v1/b122/automation-proposal/compound_capture", { ...exact, effectAuthorized: true }));
  assert.equal(effectClaim.status, 400);

  const wrongProvider = automationProposal("compound_capture", { session: { ...exact.session, provider: "claude" } });
  assert.equal((await service.handle(request("/v1/b122/automation-proposal/compound_capture", wrongProvider))).status, 409);

  const changedTargetId = "9".repeat(64);
  const wrongTarget = automationProposal("compound_capture", {
    target: { ...exact.target, id: changedTargetId },
    session: { ...exact.session, targetSnapshotId: changedTargetId }
  });
  assert.equal((await service.handle(request("/v1/b122/automation-proposal/compound_capture", wrongTarget))).status, 409);

  const wrongSession = automationProposal("compound_capture", { session: { ...exact.session, id: "other-session" } });
  assert.equal((await service.handle(request("/v1/b122/automation-proposal/compound_capture", wrongSession))).status, 409);

  codex.setSessionObservation("codex-session", { status: "verified_blocked" });
  const churned = await service.handle(request("/v1/b122/automation-proposal/compound_capture", exact));
  assert.equal(churned.status, 409);
  assert.equal(churned.body.effectDisposition, "not_started");
  assert.equal(codex.executeCalls, 0);
});

test("automation-proposal absence is explicitly unavailable and never ambiguous", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-proposal-unavailable-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  Object.defineProperty(port, "proposeAutomation", { value: undefined, configurable: true });
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(directory, "state.jsonl"), token),
    backends: [new CodexProviderAdapterBackend(port)],
    dispatchLease: dispatchLeaseOptions,
    now: () => fixedNow
  });
  await service.handle(request("/v1/b122/handshake/codex", handshake()));
  let ambiguous = false;
  const unavailable = await service.handle({
    ...request("/v1/b122/automation-proposal/compound_capture", automationProposal("compound_capture")),
    effectProgress: { markAmbiguous() { ambiguous = true; }, disposition() { return ambiguous ? "ambiguous" : "not_started"; } }
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.status, "unavailable");
  assert.equal(unavailable.body.effectDisposition, "not_started");
  assert.equal(ambiguous, false);
});

test("effect routes require one exact single-use companion dispatch lease and classify post-consume failure as ambiguous", async (context) => {
  const { service, codex, store } = await fixture(context);
  await service.handle(request("/v1/b122/handshake/codex", handshake()));

  const missing = await service.handle(request("/v1/b122/automation/compound_capture", automation("operation-no-lease"), undefined, "POST", false));
  assert.equal(missing.status, 410);
  assert.equal((missing.body as { effectDisposition: string }).effectDisposition, "not_started");
  assert.equal(codex.executeCalls, 0);
  const missingCommand = await service.handle(request("/v1/b122/command/proof", workflow("operation-command-no-lease"), undefined, "POST", false));
  assert.equal(missingCommand.status, 400);
  assert.equal((missingCommand.body as { effectDisposition: string }).effectDisposition, "not_started");
  assert.equal(codex.executeCalls, 0);
  const missingCouncil = await service.handle(request("/v1/b122/council/codex", {
    schema: "sxsy-b122.council-phase", version: 1, epochId: "epoch-no-lease", phase: "pause",
    sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo"
  }, undefined, "POST", false));
  assert.equal(missingCouncil.status, 400);
  assert.equal((missingCouncil.body as { effectDisposition: string }).effectDisposition, "not_started");
  assert.deepEqual(codex.councilPhases, []);

  const body = workflow("operation-single-use");
  const signed = dispatchLease("/v1/b122/command/proof", body, "7".repeat(64));
  const exactRequest = request("/v1/b122/command/proof", { ...body, dispatchLease: signed });
  assert.equal((await service.handle(exactRequest)).status, 200);
  assert.equal(codex.executeCalls, 1);
  const replay = await service.handle(exactRequest);
  assert.equal(replay.status, 503);
  assert.equal((replay.body as { effectDisposition: string }).effectDisposition, "ambiguous");
  assert.equal(codex.executeCalls, 1);

  const freshLeaseReplay = await service.handle(request("/v1/b122/command/proof", body));
  assert.equal(freshLeaseReplay.status, 503);
  assert.equal((freshLeaseReplay.body as { effectDisposition: string }).effectDisposition, "ambiguous");
  assert.equal(codex.executeCalls, 1);

  const crossBoundBody = workflow("operation-cross-bound");
  const exactActionLease = dispatchLease("/v1/b122/command/proof", crossBoundBody, "8".repeat(64));
  const { authenticationTag: _authenticationTag, ...unsignedWrongActionLease } = exactActionLease;
  const wrongActionLease = signProviderDispatchLease({
    ...unsignedWrongActionLease,
    dispatch: { ...unsignedWrongActionLease.dispatch, routeId: "provider.other_action", action: "other_action" }
  }, leaseKey);
  const crossBound = await service.handle(request("/v1/b122/command/proof", { ...crossBoundBody, dispatchLease: wrongActionLease }));
  assert.equal(crossBound.status, 409);
  assert.equal(codex.executeCalls, 1);

  codex.malformedNextResponse();
  const malformedBody = workflow("operation-post-consume-malformed");
  const malformed = await service.handle(request("/v1/b122/command/proof", malformedBody));
  assert.equal(malformed.status, 503);
  assert.equal((malformed.body as { effectDisposition: string }).effectDisposition, "ambiguous");
  assert.equal(codex.executeCalls, 2);
  assert.ok((await store.readEntries()).some((entry) => entry.kind === "provider-host.dispatch-lease-consumed"));
});

test("authenticated graceful shutdown is fenced to the exact lifecycle nonce, process, and configuration", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-shutdown-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  let shutdowns = 0;
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(directory, "state.jsonl"), token),
    backends: [new CodexProviderAdapterBackend(new FixtureProviderRuntimePort("codex"))],
    dispatchLease: { authenticationKey: leaseKey, host: { configurationSha256: "8".repeat(64), lifecycleNonceSha256: sha256("9".repeat(64)), tlsSpkiSha256: "3".repeat(64) } },
    lifecycle: { nonce: "9".repeat(64), processId: 4242, configurationSha256: "8".repeat(64), requestShutdown: () => { shutdowns += 1; } }
  });
  const health = await service.handle(request("/v1/b122/health", undefined, undefined, "GET"));
  assert.deepEqual({ processId: health.body.processId, lifecycleNonceSha256: health.body.lifecycleNonceSha256, configurationSha256: health.body.configurationSha256 }, { processId: 4242, lifecycleNonceSha256: sha256("9".repeat(64)), configurationSha256: "8".repeat(64) });
  const body = { schema: "sxsy-b122.provider-host-shutdown", version: 1, lifecycleNonce: "9".repeat(64), expectedProcessId: 4242, configurationSha256: "8".repeat(64) };
  assert.equal((await service.handle(request("/v1/b122/lifecycle/shutdown", { ...body, lifecycleNonce: "7".repeat(64) }))).status, 409);
  assert.equal(shutdowns, 0);
  const accepted = await service.handle(request("/v1/b122/lifecycle/shutdown", body));
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.accepted, true);
  assert.equal(shutdowns, 0, "shutdown starts only after the HTTP response has been flushed");
  accepted.afterResponse?.();
  assert.equal(shutdowns, 1);
});

test("a digest-pinned module cannot self-assert the host Mediated capability", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-capability-cap-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const source = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const dishonest = {
    provider: "codex",
    handshake: source.handshake.bind(source), execute: source.execute.bind(source), observeSession: source.observeSession.bind(source),
    observeWorkflowContext: source.observeWorkflowContext.bind(source),
    reanchor: source.reanchor.bind(source), observeReanchor: source.observeReanchor.bind(source),
    observeOperation: source.observeOperation.bind(source), cancelOperation: source.cancelOperation.bind(source),
    council: source.council.bind(source), observeCouncil: source.observeCouncil.bind(source), shutdown: source.shutdown.bind(source)
  } as ProviderRuntimePort;
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(directory, "state.jsonl"), "f".repeat(64)),
    backends: [new CodexProviderAdapterBackend(dishonest, { adapterId: "test.module.codex", moduleSha256: "e".repeat(64) })],
    dispatchLease: dispatchLeaseOptions
  });
  const connected = await service.handle(request("/v1/b122/handshake/codex", handshake()));
  assert.equal(connected.status, 200);
  assert.deepEqual((connected.body as { capabilities: string[] }).capabilities, ["registered", "observable", "controllable"]);

  const controller = new AbortController();
  const externalBackend = new CodexProviderAdapterBackend(dishonest, { adapterId: "test.module.codex", moduleSha256: "e".repeat(64) });
  await externalBackend.handshake(handshake(), controller.signal);
  const advisory = await externalBackend.execute(backendWorkflowCommand("proof", "operation-unattested-proof"), controller.signal);
  assert.equal((advisory as { action: string }).action, "proof");
  assert.equal(source.executeCalls, 1, "an Observable advisory action remains reachable through a digest-pinned module");
  await assert.rejects(
    externalBackend.execute(backendWorkflowCommand("plan_approval", "operation-unattested-plan"), controller.signal),
    /Mediated|capabilit/i
  );
  await assert.rejects(
    externalBackend.execute(backendAutomationCommand("operation-unattested-automation"), controller.signal),
    /automation.*disabled|companion-owned|proposal-only/i
  );
  assert.equal(source.executeCalls, 1, "Mediated actions must not reach an externally attested module");
  const blockedCouncil = await service.handle(request("/v1/b122/council/codex", {
    schema: "sxsy-b122.council-phase", version: 1, epochId: "unattested", phase: "pause",
    sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo"
  }));
  assert.equal(blockedCouncil.status, 400);
  assert.deepEqual(source.councilPhases, []);
});

test("the authenticated service arms one consumed lease for the host-owned mediated effect port", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-mediated-service-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const source = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  let directCalls = 0;
  let driverCalls = 0;
  const modulePort: ProviderRuntimePort = {
    provider: "codex", handshake: source.handshake.bind(source),
    async execute() { directCalls += 1; throw new Error("module execute must not own mediated effects"); },
    observeSession: source.observeSession.bind(source), observeWorkflowContext: source.observeWorkflowContext.bind(source),
    reanchor: source.reanchor.bind(source), observeReanchor: source.observeReanchor.bind(source),
    observeOperation: source.observeOperation.bind(source), cancelOperation: source.cancelOperation.bind(source),
    council: source.council.bind(source), observeCouncil: source.observeCouncil.bind(source), shutdown: source.shutdown.bind(source),
    async prepareMediatedEffect(command, binding) { return { schema: "sxsy-b122.provider-mediated-effect-intent", version: 1, authorizationId: binding.authorizationId, requestDigest: sha256(stableJson(command)), operation: "execute_exact_request" }; },
    async prepareMediatedCouncilEffect(council, binding) { return { schema: "sxsy-b122.provider-mediated-council-intent", version: 1, authorizationId: binding.authorizationId, requestDigest: sha256(stableJson(council)), operation: "acknowledge_exact_phase" }; }
  };
  const identity = { adapterId: "test.module.codex", moduleSha256: "7".repeat(64) };
  const mediated = new ConfiguredProviderMediatedEffectHostPort({
    configurationSha256: hostIdentity.configurationSha256, provider: "codex", ...identity,
    driverModuleSha256: "4".repeat(64), credential: Buffer.from("provider-secret"),
    now: () => new Date(fixedNow),
    guard: { async assertCurrent(binding) { return mediatedFinalDecision(binding); } },
    driver: {
      async executeCommand(input, credential) {
        driverCalls += 1;
        assert.equal(Buffer.from(credential).toString("utf8"), "provider-secret");
        if (input.command.kind !== "workflow") throw new Error("expected exact provider workflow command");
        return source.execute(input.command);
      },
      async executeCouncil() { throw new Error("not used"); }
    }
  });
  const backend = new CodexProviderAdapterBackend(modulePort, identity, mediated);
  const service = new ProviderAdapterHostService({
    authenticationToken: token, store: createProviderHostStore(join(directory, "state.jsonl"), token), backends: [backend],
    dispatchLease: dispatchLeaseOptions, now: () => fixedNow
  });
  assert.equal((await service.handle(request("/v1/b122/handshake/codex", handshake()))).status, 200);
  const body = planApprovalWorkflow("operation-host-mediated");
  const lease = dispatchLease("/v1/b122/command/plan_approval", body, sha256("host-mediated"), identity);
  const effect = await service.handle(request("/v1/b122/command/plan_approval", { ...body, dispatchLease: lease }, `Bearer ${token}`, "POST", false));
  assert.equal(effect.status, 200);
  assert.equal(driverCalls, 1);
  assert.equal(directCalls, 0);
  const replay = await service.handle(request("/v1/b122/command/plan_approval", { ...body, dispatchLease: lease }, `Bearer ${token}`, "POST", false));
  assert.notEqual(replay.status, 200);
  assert.equal(replay.body.effectDisposition, "ambiguous");
  assert.equal(driverCalls, 1);
  mediated.close();
});

test("Council arms only the exact committed phase lease for the host-owned mediated effect port", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-mediated-council-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const store = createProviderHostStore(join(directory, "state.jsonl"), token);
  const source = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  let directCalls = 0;
  const driverPhases: string[] = [];
  const modulePort: ProviderRuntimePort = {
    provider: "codex",
    handshake: source.handshake.bind(source),
    execute: source.execute.bind(source),
    observeSession: source.observeSession.bind(source),
    observeWorkflowContext: source.observeWorkflowContext.bind(source),
    reanchor: source.reanchor.bind(source),
    observeReanchor: source.observeReanchor.bind(source),
    observeOperation: source.observeOperation.bind(source),
    cancelOperation: source.cancelOperation.bind(source),
    async council() { directCalls += 1; throw new Error("module council must not own mediated effects"); },
    observeCouncil: source.observeCouncil.bind(source),
    shutdown: source.shutdown.bind(source),
    async prepareMediatedEffect(command, binding) {
      return { schema: "sxsy-b122.provider-mediated-effect-intent", version: 1, authorizationId: binding.authorizationId, requestDigest: sha256(stableJson(command)), operation: "execute_exact_request" };
    },
    async prepareMediatedCouncilEffect(council, binding) {
      return { schema: "sxsy-b122.provider-mediated-council-intent", version: 1, authorizationId: binding.authorizationId, requestDigest: sha256(stableJson(council)), operation: "acknowledge_exact_phase" };
    }
  };
  const identity = { adapterId: "test.module.codex", moduleSha256: "7".repeat(64) };
  const mediated = new ConfiguredProviderMediatedEffectHostPort({
    configurationSha256: hostIdentity.configurationSha256,
    provider: "codex",
    ...identity,
    driverModuleSha256: "4".repeat(64),
    credential: Buffer.from("provider-secret"),
    now: () => new Date(fixedNow),
    guard: { async assertCurrent(binding) { return mediatedFinalDecision(binding); } },
    driver: {
      async executeCommand() { throw new Error("not used"); },
      async executeCouncil(input, credential) {
        assert.equal(Buffer.from(credential).toString("utf8"), "provider-secret");
        assert.equal(
          (await store.readEntries()).some((entry) => entry.kind === "provider-host.dispatch-lease-consumed"),
          true,
          "the host effect port must be armed only after the exact lease commit"
        );
        driverPhases.push(input.request.phase);
        return {
          schema: "sxsy-b122.council-ack",
          version: 1,
          epochId: input.request.epochId,
          phase: input.request.phase,
          sessionId: input.request.sessionId,
          targetSnapshotId: input.request.targetSnapshotId,
          accepted: true,
          ...(input.request.assignmentDigest
            ? { assignmentDigest: input.request.assignmentDigest, resourceHostDigest: input.request.resourceHost!.digest }
            : {})
        };
      }
    }
  });
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store,
    backends: [new CodexProviderAdapterBackend(modulePort, identity, mediated)],
    dispatchLease: dispatchLeaseOptions,
    now: () => fixedNow
  });
  assert.equal((await service.handle(request("/v1/b122/handshake/codex", handshake()))).status, 200);

  const base = {
    schema: "sxsy-b122.council-phase",
    version: 1,
    epochId: "epoch-mediated-council",
    sessionId: "codex-session",
    targetSnapshotId: target,
    repositoryRoot: "C:\\repo"
  } as const;
  const substitutedPause = { ...base, epochId: "epoch-mediated-substitution", phase: "pause" } as const;
  const wrongPhaseLease = dispatchLease(
    "/v1/b122/council/codex",
    { ...substitutedPause, phase: "assignment", assignmentDigest: "7".repeat(64) },
    sha256("mediated-council-wrong-phase"),
    identity
  );
  const substitution = await service.handle(request(
    "/v1/b122/council/codex",
    { ...substitutedPause, dispatchLease: wrongPhaseLease },
    `Bearer ${token}`,
    "POST",
    false
  ));
  assert.notEqual(substitution.status, 200);
  assert.deepEqual(driverPhases, []);

  const pause = { ...base, phase: "pause" } as const;
  const pauseLease = dispatchLease("/v1/b122/council/codex", pause, sha256("mediated-council-pause"), identity);
  const paused = await service.handle(request("/v1/b122/council/codex", { ...pause, dispatchLease: pauseLease }, `Bearer ${token}`, "POST", false));
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  const replay = await service.handle(request("/v1/b122/council/codex", { ...pause, dispatchLease: pauseLease }, `Bearer ${token}`, "POST", false));
  assert.notEqual(replay.status, 200);
  assert.equal(replay.body.effectDisposition, "ambiguous");
  assert.deepEqual(driverPhases, ["pause"]);

  const resourceHost = councilResourceHost(undefined, base.epochId);
  const binding = {
    assignmentDigest: "7".repeat(64),
    worktreeRoot: "C:\\worktree",
    branch: `council/${base.epochId}`,
    head: "d".repeat(40),
    leases: [{ kind: "port", resource: "port:4100", fence: 1 }],
    resourceHost
  } as const;
  const assignment = { ...base, phase: "assignment", paths: ["src/example.ts"], resources: ["port:4100"], ...binding } as const;
  const assignmentLease = dispatchLease("/v1/b122/council/codex", assignment, sha256("mediated-council-assignment"), identity);
  const assigned = await service.handle(request("/v1/b122/council/codex", { ...assignment, dispatchLease: assignmentLease }, `Bearer ${token}`, "POST", false));
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  const resume = { ...base, phase: "resume", ...binding } as const;
  const resumeLease = dispatchLease("/v1/b122/council/codex", resume, sha256("mediated-council-resume"), identity);
  const resumed = await service.handle(request("/v1/b122/council/codex", { ...resume, dispatchLease: resumeLease }, `Bearer ${token}`, "POST", false));
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.deepEqual(driverPhases, ["pause", "assignment", "resume"]);
  assert.equal(directCalls, 0);
  mediated.close();
});

test("provider execution enforces the exact host-derived capability floor before calling the module", async (context) => {
  for (const action of ["handoff", "handoff_queue", "handoff_immediate", "bind_voice_session"] as const) {
    assert.deepEqual(providerEffectCapabilityFloor("workflow", action), ["registered"], action);
  }
  for (const action of ["proof", "proof_adversarial", "focus_blocked_agent", "focus_finished_agent"] as const) {
    assert.deepEqual(providerEffectCapabilityFloor("workflow", action), ["registered", "observable"], action);
  }
  for (const action of ["reanchor", "option_provider", "option_packet", "plan_expander", "authority_refresh", "authority_broadcast"] as const) {
    assert.deepEqual(providerEffectCapabilityFloor("workflow", action), ["registered", "controllable"], action);
  }
  assert.deepEqual(providerEffectCapabilityFloor("workflow", "plan_approval"), ["registered", "observable", "controllable", "mediated"]);
  for (const action of ["compound_capture", "compound_refresh", "lfg", "repair_mission"] as const) {
    assert.throws(() => providerEffectCapabilityFloor("automation", action), /proposal-only|automation.*disabled/i, action);
  }
  assert.throws(() => providerEffectCapabilityFloor("workflow", "compound_capture"), /executor|workflow/i);
  assert.throws(() => providerEffectCapabilityFloor("automation", "proof"), /executor|automation/i);

  const controller = new AbortController();
  const externalSource = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const externalModule = {
    provider: "codex",
    handshake: externalSource.handshake.bind(externalSource), execute: externalSource.execute.bind(externalSource),
    observeSession: externalSource.observeSession.bind(externalSource), observeWorkflowContext: externalSource.observeWorkflowContext.bind(externalSource),
    reanchor: externalSource.reanchor.bind(externalSource), observeReanchor: externalSource.observeReanchor.bind(externalSource),
    observeOperation: externalSource.observeOperation.bind(externalSource), cancelOperation: externalSource.cancelOperation.bind(externalSource),
    council: externalSource.council.bind(externalSource), observeCouncil: externalSource.observeCouncil.bind(externalSource),
    shutdown: externalSource.shutdown.bind(externalSource)
  } as ProviderRuntimePort;
  const externalBackend = new CodexProviderAdapterBackend(externalModule, {
    adapterId: "test.module.codex",
    moduleSha256: "e".repeat(64)
  });
  await externalBackend.handshake(handshake(), controller.signal);
  await assert.rejects(
    externalBackend.execute(backendWorkflowCommand("plan_approval", "operation-external-module"), controller.signal),
    /fresh, running.*registered.*mediated/i
  );
  assert.equal(externalSource.executeCalls, 0);

  for (const status of ["stale", "unreachable"] as const) {
    await context.test(`rejects ${status}`, async () => {
      const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
      const backend = new CodexProviderAdapterBackend(port);
      await backend.handshake(handshake(), controller.signal);
      port.setSessionObservation("codex-session", { status });
      await assert.rejects(
        backend.execute(backendWorkflowCommand("plan_approval", `operation-${status}`), controller.signal),
        /fresh, running.*registered.*mediated/i
      );
      assert.equal(port.executeCalls, 0);
    });
  }

  for (const capabilities of [
    ["observable", "controllable", "mediated"],
    ["registered", "controllable", "mediated"],
    ["registered", "observable", "mediated"],
    ["registered", "observable", "controllable"]
  ] as const) {
    await context.test(`rejects capabilities ${capabilities.join(",")}`, async () => {
      const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
      const backend = new CodexProviderAdapterBackend(port);
      await backend.handshake(handshake(), controller.signal);
      port.setSessionObservation("codex-session", { capabilities });
      await assert.rejects(
        backend.execute(backendWorkflowCommand("plan_approval", `operation-capability-${capabilities.length}-${capabilities[0]}`), controller.signal),
        /fresh, running.*registered.*mediated/i
      );
      assert.equal(port.executeCalls, 0);
    });
  }
});

test("only Authority recovery actions may use one exact verified-blocked provider session", async (context) => {
  const { service, codex } = await fixture(context);
  assert.equal((await service.handle(request("/v1/b122/handshake/codex", handshake()))).status, 200);
  codex.setSessionObservation("codex-session", { status: "verified_blocked" });

  const refreshed = await service.handle(request(
    "/v1/b122/command/authority_refresh",
    authorityWorkflow("authority_refresh", "operation-authority-refresh-blocked")
  ));
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  const broadcast = await service.handle(request(
    "/v1/b122/command/authority_broadcast",
    authorityWorkflow("authority_broadcast", "operation-authority-broadcast-blocked")
  ));
  assert.equal(broadcast.status, 200, JSON.stringify(broadcast.body));
  assert.equal(codex.executeCalls, 2);

  const ordinary = await service.handle(request("/v1/b122/command/proof", workflow("operation-proof-blocked")));
  assert.equal(ordinary.status, 409);
  assert.equal(codex.executeCalls, 2, "ordinary provider work must remain running-only");

  for (const status of ["verified_finished", "unreachable", "stale", "unknown"] as const) {
    codex.setSessionObservation("codex-session", { status });
    const denied = await service.handle(request(
      "/v1/b122/command/authority_refresh",
      authorityWorkflow("authority_refresh", `operation-authority-${status}`)
    ));
    assert.equal(denied.status, 409, status);
    assert.equal(codex.executeCalls, 2, status);
  }

  codex.setSessionObservation("codex-session", { status: "verified_blocked", targetSnapshotId: changedTarget });
  const substituted = await service.handle(request(
    "/v1/b122/command/authority_refresh",
    authorityWorkflow("authority_refresh", "operation-authority-target-substitution")
  ));
  assert.equal(substituted.status, 409);
  assert.equal(codex.executeCalls, 2);
});

test("provider execution rechecks the exact session after the module returns", async () => {
  class PostExecutionStalePort extends FixtureProviderRuntimePort {
    constructor() { super("codex", { effectfulTestOnly: true }); }
    override async execute(request: Parameters<ProviderRuntimePort["execute"]>[0]) {
      const response = await super.execute(request);
      this.setSessionObservation(request.sessionId, { status: "stale" });
      return response;
    }
  }
  const controller = new AbortController();
  const port = new PostExecutionStalePort();
  const backend = new CodexProviderAdapterBackend(port);
  await backend.handshake(handshake(), controller.signal);
  await assert.rejects(
    backend.execute(backendWorkflowCommand("plan_approval", "operation-post-execution-stale"), controller.signal),
    /fresh, running.*registered.*mediated/i
  );
  assert.equal(port.executeCalls, 1);
});

test("operation IDs are restart-durable, single-dispatch, and conflict-safe", async (context) => {
  const setup = await fixture(context);
  await setup.service.handle(request("/v1/b122/handshake/codex", handshake()));
  const first = await setup.service.handle(request("/v1/b122/command/proof", workflow()));
  const duplicate = await setup.service.handle(request("/v1/b122/command/proof", workflow()));
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 503);
  assert.equal((duplicate.body as { effectDisposition: string }).effectDisposition, "ambiguous");
  assert.equal(setup.codex.executeCalls, 1);

  const exactConflict = workflow();
  const conflicting = {
    ...exactConflict,
    target: { ...exactConflict.target, id: changedTarget },
    dispatchLease: dispatchLease("/v1/b122/command/proof", exactConflict)
  };
  assert.notEqual((await setup.service.handle(request("/v1/b122/command/proof", conflicting))).status, 200);
  assert.equal(setup.codex.executeCalls, 1);

  const restarted = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(setup.directory, "provider-host.jsonl"), token),
    backends: [new ClaudeProviderAdapterBackend(setup.claude), new CodexProviderAdapterBackend(setup.codex)],
    dispatchLease: dispatchLeaseOptions,
    now: () => fixedNow
  });
  const afterRestart = await restarted.handle(request("/v1/b122/command/proof", workflow()));
  assert.equal(afterRestart.status, 503);
  assert.equal((afterRestart.body as { effectDisposition: string }).effectDisposition, "ambiguous");
  const observed = await restarted.handle(request("/v1/b122/observe/operation/codex", workflowOperationObservation("operation-proof-1")));
  assert.equal(observed.status, 200);
  assert.equal((observed.body as { outcome: string }).outcome, "committed");
  assert.equal(setup.codex.executeCalls, 1);
});

test("operation observation and cancellation require and return the complete action, session, authority, target, provider, and root binding", async (context) => {
  const { service, codex, store } = await fixture(context);
  await service.handle(request("/v1/b122/handshake/codex", handshake()));
  codex.setNextStatus("running");
  assert.equal((await service.handle(request("/v1/b122/command/proof", workflow("operation-exact-transport")))).status, 200);

  const identity = workflowOperationObservation("operation-exact-transport");
  const observed = await service.handle(request("/v1/b122/observe/operation/codex", identity));
  assert.equal(observed.status, 200, JSON.stringify(observed.body));
  assert.deepEqual(observed.body, {
    schema: "sxsy-b122.provider-operation-observation", version: 1,
    operationId: "operation-exact-transport", externalId: "operation-exact-transport",
    routeId: "provider.proof", action: "proof", sessionId: "codex-session",
    provider: "codex", authorityId: "authority-provider-host", targetSnapshotId: target,
    repositoryRoot: "C:\\repo", outcome: "unresolved", effectDisposition: "ambiguous",
    summary: "Fixture codex operation is running."
  });

  for (const malformed of [
    (() => { const { action: _action, ...rest } = identity; return rest; })(),
    (() => { const { authorityId: _authority, ...rest } = identity; return rest; })(),
    { ...identity, action: "plan_expander" },
    { ...identity, authorityId: "authority-confused" },
    { ...identity, provider: "claude" },
    { ...identity, repositoryRoot: "C:\\other" }
  ]) {
    const result = await service.handle(request("/v1/b122/observe/operation/codex", malformed));
    assert.notEqual(result.status, 200, JSON.stringify(malformed));
  }

  const cancelled = await service.handle(request("/v1/b122/cancel/codex", workflowOperationCancellation("operation-exact-transport")));
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.deepEqual(cancelled.body, {
    schema: "sxsy-b122.provider-cancellation-ack", version: 1,
    operationId: "operation-exact-transport", externalId: "operation-exact-transport",
    routeId: "provider.proof", action: "proof", sessionId: "codex-session",
    provider: "codex", authorityId: "authority-provider-host", targetSnapshotId: target,
    repositoryRoot: "C:\\repo", accepted: true,
    summary: "The exact provider operation cancellation was acknowledged."
  });

  codex.setNextStatus("running");
  assert.equal((await service.handle(request("/v1/b122/command/proof", workflow("operation-conflicting-journal")))).status, 200);
  const operationEntries = await store.readEntries();
  const original = [...operationEntries].reverse().find((entry) => entry.kind === "provider-gateway.operation"
    && (entry.payload as { operation?: { operationId?: string } }).operation?.operationId === "operation-conflicting-journal");
  assert.ok(original);
  const originalOperation = (original.payload as { operation: Record<string, unknown> }).operation;
  await store.append("provider-gateway.operation", {
    operation: {
      ...originalOperation, routeId: "provider.plan_expander", action: "plan_expander",
      requestDigest: "9".repeat(64), state: "unresolved", effectDisposition: "ambiguous"
    }
  });
  const conflict = await service.handle(request("/v1/b122/observe/operation/codex", workflowOperationObservation("operation-conflicting-journal")));
  assert.equal(conflict.status, 404, "conflicting protected identities must remain ambiguous rather than selecting a terminal owner");
  assert.equal((await service.reconcile()).operationsSettled, 0);
});

test("target churn and malformed provider output fail closed without a false success", async (context) => {
  const { service, codex } = await fixture(context);
  await service.handle(request("/v1/b122/handshake/codex", handshake()));
  codex.setSessionTarget("codex-session", changedTarget);
  const churned = await service.handle(request("/v1/b122/command/proof", workflow("operation-churn")));
  assert.equal(churned.status, 409);
  assert.equal((churned.body as { effectDisposition: string }).effectDisposition, "not_started");
  assert.equal(codex.executeCalls, 0);

  codex.setSessionTarget("codex-session", target);
  codex.malformedNextResponse();
  const malformed = await service.handle(request("/v1/b122/command/proof", workflow("operation-malformed")));
  assert.equal(malformed.status, 503);
  assert.equal((malformed.body as { effectDisposition: string }).effectDisposition, "ambiguous");
});

test("Council phases are ordered, exact, durable, observable, and cancellable", async (context) => {
  const { service, codex, store } = await fixture(context);
  await service.handle(request("/v1/b122/handshake/codex", handshake()));
  const base = { schema: "sxsy-b122.council-phase", version: 1, epochId: "epoch-1", sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo" };
  const resourceHost = councilResourceHost();
  const early = await service.handle(request("/v1/b122/council/codex", { ...base, phase: "resume", assignmentDigest: "7".repeat(64), worktreeRoot: "C:\\worktree", branch: "council/epoch-1", head: "d".repeat(40), leases: [], resourceHost }));
  assert.equal(early.status, 409);
  assert.equal((early.body as { effectDisposition: string }).effectDisposition, "not_started");
  const pause = await service.handle(request("/v1/b122/council/codex", { ...base, phase: "pause" }));
  assert.equal(pause.status, 200);
  const secretResourceHost = councilCredentialResourceHost("sk-live-secret");
  const secretAssignment = { ...base, phase: "assignment", paths: ["src/example.ts"], resources: ["credential:codex-current-user"], assignmentDigest: "9".repeat(64), worktreeRoot: "C:\\worktree", branch: "council/epoch-1", head: "d".repeat(40), leases: [{ kind: "credential_scope", resource: "credential-scope:opaque", fence: 1 }], resourceHost: secretResourceHost };
  assert.equal((await service.handle(request("/v1/b122/council/codex", secretAssignment))).status, 400);
  assert.equal(JSON.stringify(await store.readEntries()).includes("sk-live-secret"), false);
  const assignment = { ...base, phase: "assignment", paths: ["src/example.ts"], resources: ["port:4100"], assignmentDigest: "7".repeat(64), worktreeRoot: "C:\\worktree", branch: "council/epoch-1", head: "d".repeat(40), leases: [{ kind: "port", resource: "port:4100", fence: 1 }], resourceHost };
  const assigned = await service.handle(request("/v1/b122/council/codex", assignment));
  assert.equal(assigned.status, 200);
  assert.equal((assigned.body as { resourceHostDigest: string }).resourceHostDigest, resourceHost.digest);
  const secretBearing = JSON.parse(JSON.stringify(resourceHost)) as ReturnType<typeof councilResourceHost> & { environment: Record<string, string> };
  secretBearing.environment.SXSY_COUNCIL_SECRET_VALUE = "secret-value";
  const { digest: _discardedDigest, ...secretUnsigned } = secretBearing;
  secretBearing.digest = sha256(stableJson(secretUnsigned));
  assert.equal((await service.handle(request("/v1/b122/council/codex", { ...assignment, resourceHost: secretBearing }))).status, 400);
  assert.equal(JSON.stringify(await store.readEntries()).includes("secret-value"), false);
  const staleResourceHost = councilResourceHost("9".repeat(64));
  const staleResume = { ...base, phase: "resume", assignmentDigest: "7".repeat(64), worktreeRoot: "C:\\worktree", branch: "council/epoch-1", head: "d".repeat(40), leases: assignment.leases, resourceHost: staleResourceHost };
  const staleResumeResult = await service.handle(request("/v1/b122/council/codex", staleResume));
  assert.equal(staleResumeResult.status, 409);
  assert.equal((staleResumeResult.body as { effectDisposition: string }).effectDisposition, "not_started");
  const resume = { ...base, phase: "resume", assignmentDigest: "7".repeat(64), worktreeRoot: "C:\\worktree", branch: "council/epoch-1", head: "d".repeat(40), leases: assignment.leases, resourceHost };
  assert.equal((await service.handle(request("/v1/b122/council/codex", resume))).status, 200);
  assert.deepEqual(codex.councilPhases, ["pause", "assignment", "resume"]);

  codex.setNextStatus("running");
  await service.handle(request("/v1/b122/command/proof", workflow("operation-running")));
  const confusedObservation = await service.handle(request("/v1/b122/observe/operation/codex", workflowOperationObservation("operation-confused", { externalId: "operation-running" })));
  assert.equal(confusedObservation.status, 404);
  const observed = await service.handle(request("/v1/b122/observe/operation/codex", workflowOperationObservation("operation-running")));
  assert.equal((observed.body as { outcome: string }).outcome, "unresolved");
  const cancelled = await service.handle(request("/v1/b122/cancel/codex", workflowOperationCancellation("operation-running")));
  assert.equal(cancelled.status, 200);
  assert.equal((cancelled.body as { accepted: boolean }).accepted, true);
});

test("concurrent cancellation is single-flight for one exact request and rejects a changed reason", async (context) => {
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const cancellationStarted = new Promise<void>((resolve) => { started = resolve; });
  class HeldCancellationPort extends FixtureProviderRuntimePort {
    cancelCalls = 0;
    constructor() { super("codex", { effectfulTestOnly: true }); }
    override async cancelOperation(request_: Parameters<ProviderRuntimePort["cancelOperation"]>[0], _signal?: AbortSignal): ReturnType<ProviderRuntimePort["cancelOperation"]> {
      this.cancelCalls += 1;
      started();
      await held;
      return super.cancelOperation(request_);
    }
  }

  const port = new HeldCancellationPort();
  const { service } = await fixture(context, port);
  await service.handle(request("/v1/b122/handshake/codex", handshake()));
  port.setNextStatus("running");
  assert.equal((await service.handle(request("/v1/b122/command/proof", workflow("operation-concurrent-cancel")))).status, 200);
  const cancel = workflowOperationCancellation("operation-concurrent-cancel");
  const first = service.handle(request("/v1/b122/cancel/codex", cancel));
  await cancellationStarted;
  const duplicate = service.handle(request("/v1/b122/cancel/codex", cancel));
  const conflicting = await service.handle(request("/v1/b122/cancel/codex", { ...cancel, reason: "changed cancellation reason" }));
  assert.equal(conflicting.status, 409);
  assert.equal((conflicting.body as { effectDisposition: string }).effectDisposition, "not_started");
  assert.equal(port.cancelCalls, 1);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await duplicate).status, 200);
  assert.equal(port.cancelCalls, 1);
});

test("Council refuses stale capability, status, and repository observations before and after dispatch", async (context) => {
  const { service, codex } = await fixture(context);
  await service.handle(request("/v1/b122/handshake/codex", handshake()));
  const pause = (epochId: string) => ({ schema: "sxsy-b122.council-phase", version: 1, epochId, phase: "pause", sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo" });

  codex.setSessionObservation("codex-session", { status: "unreachable" });
  assert.equal((await service.handle(request("/v1/b122/council/codex", pause("epoch-unreachable")))).status, 503);
  codex.setSessionObservation("codex-session", { status: "running", capabilities: ["registered", "observable"] });
  assert.equal((await service.handle(request("/v1/b122/council/codex", pause("epoch-unmediated")))).status, 503);
  codex.setSessionObservation("codex-session", { capabilities: ["registered", "observable", "controllable", "mediated"] });
  codex.changeSessionAfterNextCouncil({ repositoryRoot: "C:\\changed" });
  assert.equal((await service.handle(request("/v1/b122/council/codex", pause("epoch-root-churn")))).status, 503);
  assert.deepEqual(codex.councilPhases, ["pause"]);
});

test("concurrent Council cleanup claims one exact durable identity before executing the backend", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-cleanup-race-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  class CleanupFixture extends FixtureProviderRuntimePort {
    cleanupCalls = 0;
    constructor() { super("codex", { effectfulTestOnly: true }); }
    async cleanupCouncilResources(_request: ProviderCouncilCleanupRequest): Promise<void> { this.cleanupCalls += 1; await held; }
  }
  const port = new CleanupFixture();
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(directory, "state.jsonl"), "f".repeat(64)),
    backends: [new CodexProviderAdapterBackend(port)],
    dispatchLease: dispatchLeaseOptions,
    now: () => fixedNow
  });
  await service.handle(request("/v1/b122/handshake/codex", handshake()));
  const base = { schema: "sxsy-b122.council-phase", version: 1, epochId: "epoch-cleanup", sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo" };
  const host = councilResourceHost("8".repeat(64), "epoch-cleanup");
  const paused = await service.handle(request("/v1/b122/council/codex", { ...base, phase: "pause" }));
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  const binding = { assignmentDigest: "7".repeat(64), worktreeRoot: "C:\\worktree", branch: "council/epoch-cleanup", head: "d".repeat(40), leases: [], resourceHost: host };
  const assigned = await service.handle(request("/v1/b122/council/codex", { ...base, phase: "assignment", paths: ["src/example.ts"], resources: ["port:4100"], ...binding }));
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal((await service.handle(request("/v1/b122/council/codex", { ...base, phase: "resume", ...binding }))).status, 200);
  const cleanup = { schema: "sxsy-b122.council-resource-cleanup", version: 1, epochId: base.epochId, sessionId: base.sessionId, targetSnapshotId: target, resourceHostDigest: host.digest, outcome: "completed" };
  const first = service.handle(request("/v1/b122/council/cleanup/codex", cleanup));
  const duplicate = service.handle(request("/v1/b122/council/cleanup/codex", cleanup));
  const conflicting = await service.handle(request("/v1/b122/council/cleanup/codex", { ...cleanup, outcome: "aborted" }));
  assert.equal(conflicting.status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await duplicate).status, 200);
  assert.equal((await service.handle(request("/v1/b122/council/cleanup/codex", cleanup))).status, 200);
  assert.equal(port.cleanupCalls, 1);
});

test("submitted operations reconcile after restart without replay", async (context) => {
  const setup = await fixture(context);
  await setup.service.handle(request("/v1/b122/handshake/codex", handshake()));
  setup.codex.loseNextResponseAfterCommit();
  const ambiguous = await setup.service.handle(request("/v1/b122/command/proof", workflow("operation-reconcile")));
  assert.equal(ambiguous.status, 503);
  assert.equal(setup.codex.executeCalls, 1);

  const restarted = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(setup.directory, "provider-host.jsonl"), token),
    backends: [new ClaudeProviderAdapterBackend(setup.claude), new CodexProviderAdapterBackend(setup.codex)],
    dispatchLease: dispatchLeaseOptions,
    now: () => fixedNow
  });
  const receipt = await restarted.reconcile();
  assert.deepEqual(receipt, { operationsInspected: 1, operationsSettled: 1, councilsInspected: 0, councilsSettled: 0 });
  const after = await restarted.handle(request("/v1/b122/observe/operation/codex", workflowOperationObservation("operation-reconcile")));
  assert.equal((after.body as { outcome: string }).outcome, "committed");
  assert.equal(setup.codex.executeCalls, 1);
});

test("an ambiguous Council acknowledgement reconciles after restart without replay", async (context) => {
  const setup = await fixture(context);
  await setup.service.handle(request("/v1/b122/handshake/codex", handshake()));
  setup.codex.loseNextCouncilResponseAfterCommit();
  const pauseRequest = {
    schema: "sxsy-b122.council-phase", version: 1, epochId: "epoch-restart",
    phase: "pause", sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo"
  };
  const ambiguous = await setup.service.handle(request("/v1/b122/council/codex", pauseRequest));
  assert.equal(ambiguous.status, 503);
  assert.deepEqual(setup.codex.councilPhases, ["pause"]);

  const restarted = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(setup.directory, "provider-host.jsonl"), token),
    backends: [new ClaudeProviderAdapterBackend(setup.claude), new CodexProviderAdapterBackend(setup.codex)],
    dispatchLease: dispatchLeaseOptions,
    now: () => fixedNow
  });
  const receipt = await restarted.reconcile();
  assert.deepEqual(receipt, { operationsInspected: 0, operationsSettled: 0, councilsInspected: 1, councilsSettled: 1 });
  const replay = await restarted.handle(request("/v1/b122/council/codex", pauseRequest));
  assert.equal(replay.status, 503);
  assert.equal((replay.body as { effectDisposition: string }).effectDisposition, "ambiguous");
  assert.deepEqual(setup.codex.councilPhases, ["pause"]);
});

test("session refresh, operation observation, cancellation, cleanup, and restart reconciliation propagate one bounded host signal", async (context) => {
  type Mode = "observeSession" | "observeOperation" | "cancel" | "cleanup";
  class HangingBoundaryPort extends FixtureProviderRuntimePort {
    mode?: Mode;
    readonly aborted = new Set<Mode>();
    constructor() { super("codex", { effectfulTestOnly: true }); }
    private blocked(kind: Mode, signal: AbortSignal): Promise<never> {
      return new Promise((_resolve, reject) => {
        const abort = () => { this.aborted.add(kind); reject(new Error("bounded provider test operation aborted")); };
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
    }
    override observeSession(request_: Parameters<ProviderRuntimePort["observeSession"]>[0], signal?: AbortSignal): ReturnType<ProviderRuntimePort["observeSession"]> {
      return this.mode === "observeSession" ? this.blocked("observeSession", requiredSignal(signal)) : super.observeSession(request_);
    }
    override observeOperation(request_: Parameters<ProviderRuntimePort["observeOperation"]>[0], signal?: AbortSignal): ReturnType<ProviderRuntimePort["observeOperation"]> {
      return this.mode === "observeOperation" ? this.blocked("observeOperation", requiredSignal(signal)) : super.observeOperation(request_);
    }
    override cancelOperation(request_: Parameters<ProviderRuntimePort["cancelOperation"]>[0], signal?: AbortSignal): ReturnType<ProviderRuntimePort["cancelOperation"]> {
      return this.mode === "cancel" ? this.blocked("cancel", requiredSignal(signal)) : super.cancelOperation(request_);
    }
    cleanupCouncilResources(_request: ProviderCouncilCleanupRequest, signal?: AbortSignal): Promise<void> {
      return this.mode === "cleanup" ? this.blocked("cleanup", requiredSignal(signal)) : Promise.resolve();
    }
  }

  const port = new HangingBoundaryPort();
  // Keep the abort proof short, but leave enough budget for authenticated
  // journal I/O on loaded hosted runners before each deliberately hanging
  // provider call begins.
  const setup = await fixture(context, port, 1_000);
  await setup.service.handle(request("/v1/b122/handshake/codex", handshake()));

  port.mode = "observeSession";
  const sessionResult = await setup.service.handle(request("/v1/b122/observe/session/codex", {
    schema: "sxsy-b122.provider-session-observe", version: 1, sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo"
  }));
  assert.equal(sessionResult.status, 408);
  assert.equal((sessionResult.body as { effectDisposition: string }).effectDisposition, "not_started");
  assert.equal(port.aborted.has("observeSession"), true);

  port.mode = undefined;
  port.setNextStatus("running");
  assert.equal((await setup.service.handle(request("/v1/b122/command/proof", workflow("operation-bounded")))).status, 200);

  port.mode = "observeOperation";
  const operationResult = await setup.service.handle(request("/v1/b122/observe/operation/codex", workflowOperationObservation("operation-bounded")));
  assert.equal(operationResult.status, 408);
  assert.equal(port.aborted.has("observeOperation"), true);

  port.mode = "cancel";
  const cancelResult = await setup.service.handle(request("/v1/b122/cancel/codex", workflowOperationCancellation("operation-bounded", "bounded cancellation")));
  assert.equal(cancelResult.status, 503);
  assert.equal((cancelResult.body as { effectDisposition: string }).effectDisposition, "ambiguous");
  assert.equal(port.aborted.has("cancel"), true);

  port.mode = undefined;
  const base = { schema: "sxsy-b122.council-phase", version: 1, epochId: "epoch-bounded-cleanup", sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo" };
  const host = councilResourceHost("8".repeat(64), base.epochId);
  assert.equal((await setup.service.handle(request("/v1/b122/council/codex", { ...base, phase: "pause" }))).status, 200);
  const binding = { assignmentDigest: "7".repeat(64), worktreeRoot: "C:\\worktree", branch: `council/${base.epochId}`, head: "d".repeat(40), leases: [], resourceHost: host };
  assert.equal((await setup.service.handle(request("/v1/b122/council/codex", { ...base, phase: "assignment", paths: ["src/example.ts"], resources: ["port:4100"], ...binding }))).status, 200);
  assert.equal((await setup.service.handle(request("/v1/b122/council/codex", { ...base, phase: "resume", ...binding }))).status, 200);
  port.mode = "cleanup";
  const cleanupResult = await setup.service.handle(request("/v1/b122/council/cleanup/codex", {
    schema: "sxsy-b122.council-resource-cleanup", version: 1, epochId: base.epochId, sessionId: base.sessionId,
    targetSnapshotId: target, resourceHostDigest: host.digest, outcome: "completed"
  }));
  assert.equal(cleanupResult.status, 503);
  assert.equal((cleanupResult.body as { effectDisposition: string }).effectDisposition, "ambiguous");
  assert.equal(port.aborted.has("cleanup"), true);

  port.mode = "observeOperation";
  await assert.rejects(() => setup.service.reconcile());
  assert.equal(port.aborted.has("observeOperation"), true);
});

test("provider host is proposal-only for automation and never dispatches an automation effect", async (context) => {
  const { service, codex } = await fixture(context);
  assert.equal((await service.handle(request("/v1/b122/handshake/codex", handshake()))).status, 200);

  const refused = await service.handle(request(
    "/v1/b122/automation/compound_capture",
    automation("operation-provider-owned-automation-refused")
  ));
  assert.equal(refused.status, 410, JSON.stringify(refused.body));
  assert.equal(refused.body.effectDisposition, "not_started");
  assert.match(String(refused.body.summary), /proposal-only|companion-owned/i);
  assert.equal(codex.executeCalls, 0, "the provider runtime cannot own an automation effect");

  const proposal = await service.handle(request(
    "/v1/b122/automation-proposal/compound_capture",
    automationProposal("compound_capture")
  ));
  assert.equal(proposal.status, 200, JSON.stringify(proposal.body));
  assert.equal(proposal.body.schema, "sxsy-b122.automation-proposal-response");
  assert.equal(codex.executeCalls, 0, "proposal observation has no effect path");

  const providerWorkflow = await service.handle(request("/v1/b122/command/proof", workflow("operation-provider-workflow-positive")));
  assert.equal(providerWorkflow.status, 200, JSON.stringify(providerWorkflow.body));
  assert.equal(codex.executeCalls, 1, "a separately mediated provider workflow remains functional");
});

test("legacy durable automation rows are retired for manual recovery without observe or cancel effect-driver calls", async (context) => {
  class CountingLegacyPort extends FixtureProviderRuntimePort {
    observeCalls = 0;
    cancelCalls = 0;
    constructor() { super("codex", { effectfulTestOnly: true }); }
    override observeOperation(request_: Parameters<ProviderRuntimePort["observeOperation"]>[0], signal?: AbortSignal): ReturnType<ProviderRuntimePort["observeOperation"]> {
      this.observeCalls += 1;
      return super.observeOperation(request_);
    }
    override cancelOperation(request_: Parameters<ProviderRuntimePort["cancelOperation"]>[0], signal?: AbortSignal): ReturnType<ProviderRuntimePort["cancelOperation"]> {
      this.cancelCalls += 1;
      return super.cancelOperation(request_);
    }
  }

  const port = new CountingLegacyPort();
  const { service, store } = await fixture(context, port);
  assert.equal((await service.handle(request("/v1/b122/handshake/codex", handshake()))).status, 200);
  const operationId = "operation-legacy-provider-automation";
  await store.append("provider-gateway.operation", {
    operation: {
      operationId,
      externalId: operationId,
      routeId: "automation.compound_capture",
      action: "compound_capture",
      provider: "codex",
      sessionId: "codex-session",
      authorityId: "authority-provider-host",
      repositoryRoot: "C:\\repo",
      targetSnapshotId: target,
      requestDigest: sha256("legacy-provider-automation"),
      state: "unresolved",
      effectDisposition: "ambiguous",
      cancellationAcknowledged: false,
      updatedAt: fixedNow
    }
  });

  const receipt = await service.reconcile();
  assert.deepEqual(receipt, { operationsInspected: 1, operationsSettled: 0, councilsInspected: 0, councilsSettled: 0 });
  assert.deepEqual({ observeCalls: port.observeCalls, cancelCalls: port.cancelCalls }, { observeCalls: 0, cancelCalls: 0 });

  const observed = await service.handle(request("/v1/b122/observe/operation/codex", operationObservation(operationId)));
  assert.equal(observed.status, 410, JSON.stringify(observed.body));
  assert.match(String(observed.body.summary), /manual recovery|proposal-only/i);
  const cancelled = await service.handle(request("/v1/b122/cancel/codex", operationCancellation(operationId)));
  assert.equal(cancelled.status, 410, JSON.stringify(cancelled.body));
  assert.match(String(cancelled.body.summary), /manual recovery|proposal-only/i);
  assert.deepEqual({ observeCalls: port.observeCalls, cancelCalls: port.cancelCalls }, { observeCalls: 0, cancelCalls: 0 });

  const latest = [...await store.readEntries()].reverse().find((entry) => entry.kind === "provider-gateway.operation"
    && (entry.payload as { operation?: { operationId?: string } }).operation?.operationId === operationId);
  assert.match(String((latest?.payload as { operation?: { responseBody?: string } }).operation?.responseBody), /manual_recovery/);
});
