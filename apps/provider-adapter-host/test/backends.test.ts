import assert from "node:assert/strict";
import test from "node:test";

import { automationIntentLeaseArtifact, createAutomationIntent } from "../../../packages/control-plane/src/automation-protocol.ts";
import {
  automationManifestReviewScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest,
  type AutomationManifestAction
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import {
  createAutomationProposalResponse,
  type AutomationProposalRequest
} from "../../../packages/control-plane/src/automation-proposal-protocol.ts";
import type { AuthorityGrant, ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { canonicalWorkflowArtifact, planApprovalReviewScopeDigest, type WorkflowProviderEffectBinding } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import type { ProviderGatewayAutomationCommand, ProviderGatewayCommandResult, ProviderGatewayOperationObservationRequest, ProviderGatewayWorkflowCommand } from "../../windows-companion/src/provider-gateway.ts";
import {
  ConfiguredProviderMediatedEffectHostPort,
  CodexProviderAdapterBackend,
  FixtureProviderRuntimePort,
  type ProviderMediatedEffectBinding,
  type ProviderMediatedFinalCurrentDecision,
  type ProviderRuntimePort
} from "../src/backends.ts";
import { signProviderDispatchLease, type ProviderDispatchLease } from "../src/dispatch-lease.ts";

const targetId = "a".repeat(64);
const mediatedTargetMaterial = {
  repositoryRoot: "C:\\repo", canonicalRemote: "https://github.com/acme/project.git", branch: "feat/mediated", defaultBranch: "main",
  detached: false, upstream: "origin/feat/mediated", head: "b".repeat(40), indexTree: "c".repeat(40), trackedManifest: "d".repeat(64),
  untrackedManifest: "e".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "f".repeat(64), completeness: "complete" as const, reasons: [] as string[]
};
const mediatedTargetId = sha256(stableJson(mediatedTargetMaterial));
const moduleIdentity = { adapterId: "test.module.codex", moduleSha256: "7".repeat(64) };
const configurationSha256 = "8".repeat(64);
const driverModuleSha256 = "4".repeat(64);
const decisionAt = "2026-08-26T12:00:01.000Z";
const automationContent = (value: string) => ({
  afterDigest: sha256(value),
  content: { encoding: "base64" as const, byteLength: Buffer.byteLength(value, "utf8"), data: Buffer.from(value, "utf8").toString("base64") }
});

function finalCurrentDecision(binding: ProviderMediatedEffectBinding, change: Readonly<Record<string, unknown>> = {}): ProviderMediatedFinalCurrentDecision {
  const material = {
    schema: "sxsy-b122.provider-mediated-final-current-decision" as const, version: 1 as const,
    authorizationId: binding.authorizationId, leaseId: binding.leaseId, operationId: binding.operationId, action: binding.action,
    sessionId: binding.sessionId, authorityId: binding.authorityId, targetSnapshotId: binding.targetSnapshotId,
    repositoryRoot: binding.repositoryRoot, containmentBindingDigest: binding.containmentBindingDigest,
    containmentFenceEpoch: binding.containmentFenceEpoch, challengeNonce: "a".repeat(64), allowed: true as const,
    decidedAt: decisionAt, expiresAt: "2026-08-26T12:00:06.000Z", ...change
  };
  return { ...material, decisionDigest: sha256(stableJson(material)) } as ProviderMediatedFinalCurrentDecision;
}

function mediatedCommand(operationId: string, authorityId = "authority-mediated"): ProviderGatewayAutomationCommand {
  const manifest = createAutomationOperationManifest({
    repositoryRoot: "C:\\repo", targetSnapshotId: mediatedTargetId, sessionId: "codex-mediated", authorityId,
    taskId: "task-mediated", planRevision: "plan-mediated", provider: "codex",
    createdAt: "2026-08-26T11:59:00.000Z", expiresAt: "2026-08-26T12:10:00.000Z"
  }, {
    kind: "compound_capture", solvedProblemEvidenceDigest: "1".repeat(64), verifiedOutcomeEvidenceDigest: "2".repeat(64),
    nonTrivialRationale: "The fixture captures one exact reviewed provider-host result.",
    documents: [{ path: "docs/solutions/mediated-capture.md", mutation: "create", beforeDigest: null, ...automationContent("# Mediated capture\n") }],
    instructionFileMutation: { kind: "none" }
  });
  const approval = createAutomationManifestApproval({
    manifest, confirmationToken: `confirm-${operationId}`,
    confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
    confirmedAt: "2026-08-26T12:00:00.000Z", expiresAt: "2026-08-26T12:09:00.000Z"
  });
  return {
    kind: "automation", routeId: "automation.compound_capture", operationId, externalId: operationId, action: "compound_capture",
    repositoryRoot: "C:\\repo", targetSnapshotId: mediatedTargetId, sessionId: "codex-mediated", authorityId, provider: "codex",
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

function consumedLease(command: ProviderGatewayAutomationCommand, leaseId = `lease-${command.operationId}`): ProviderDispatchLease {
  const now = "2026-08-26T12:00:00.000Z";
  return signProviderDispatchLease({
    schema: "sxsy-b122.provider-dispatch-lease", version: 1, leaseId, nonce: sha256(leaseId), issuedAt: now, expiresAt: "2026-08-26T12:00:30.000Z",
    authority: { id: command.authorityId, grantDigest: "1".repeat(64), scopeDigest: "2".repeat(64), expiresAt: "2026-08-26T13:00:00.000Z" },
    target: { id: mediatedTargetId, ...mediatedTargetMaterial, capturedAt: now },
    session: { id: command.sessionId, provider: "codex", taskId: "task-mediated", planRevision: "plan-mediated", adapterVersion: "codex-fixture-provider-host-v1" },
    dispatch: { routeId: command.routeId, action: command.action, operationId: command.operationId },
    artifact: automationIntentLeaseArtifact(command.intent.binding),
    confirmation: { digest: command.intent.binding.confirmationDigest, scopeDigest: command.intent.binding.reviewScopeDigest },
    containment: { status: "clear", bindingDigest: "3".repeat(64), fenceEpoch: 4, activationOperationId: null },
    host: { configurationSha256, lifecycleNonceSha256: "5".repeat(64), tlsSpkiSha256: "6".repeat(64) }, module: moduleIdentity
  }, "9".repeat(64));
}

function mediatedResult(command: ProviderGatewayAutomationCommand): ProviderGatewayCommandResult {
  return {
    schema: "sxsy-b122.compound-capture-result", version: 1, action: "compound_capture", status: "completed", effectDisposition: "committed",
    summary: "The host-owned closed effect port completed the exact mediated request.", externalId: command.externalId,
    manifestId: command.intent.binding.manifestId, manifestDigest: command.intent.binding.manifestDigest,
    approvalId: command.intent.binding.approvalId, reviewScopeDigest: command.intent.binding.reviewScopeDigest,
    proposalDigest: command.intent.binding.proposalDigest,
    result: { kind: "compound_capture", captureId: `capture-${command.operationId}`, learningDigest: "a".repeat(64), verifiedProblemDigest: "b".repeat(64), documents: ["docs/solutions/mediated-capture.md"] }
  };
}

function mediatedWorkflowCommand(operationId: string, authorityId = "authority-mediated"): ProviderGatewayWorkflowCommand {
  const planMaterial = {
    revision: "plan-mediated",
    originSessionId: "codex-mediated",
    taskId: "task-mediated",
    objective: "Verify the host-owned provider workflow effect boundary.",
    steps: [{ id: "step-mediated", summary: "Approve the exact plan", ownedFiles: ["src/example.ts"], dependencies: [] as string[], status: "approved" as const }],
    decisions: [] as string[],
    expectedTargetTransition: { beforeTargetSnapshotId: mediatedTargetId, expectedAfterTargetSnapshotId: mediatedTargetId, expectation: "unchanged" as const }
  };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const coordinatorContextDigest = "6".repeat(64);
  const coordinatorContextRevision = 2;
  const providerContextDigest = "5".repeat(64);
  const confirmationDigest = sha256("mediated-provider-workflow-confirmation");
  const confirmationScopeDigest = planApprovalReviewScopeDigest({
    sessionId: "codex-mediated", targetSnapshotId: mediatedTargetId, repositoryRoot: "C:\\repo",
    taskId: plan.taskId, planRevision: plan.revision, planDigest: plan.digest,
    originSessionId: plan.originSessionId, providerContextDigest, sourceRevision: coordinatorContextRevision
  });
  const payload = {
    kind: "plan" as const, mode: "approve" as const, plan, executorSessionId: "codex-mediated",
    authorityId, confirmationDigest, confirmationScopeDigest, providerContextDigest, executeOnce: true as const
  };
  const artifact = canonicalWorkflowArtifact({
    id: `artifact-${operationId}`, action: "plan_approval", repositoryRoot: "C:\\repo",
    targetSnapshotId: mediatedTargetId, sessionId: "codex-mediated", taskId: plan.taskId,
    planRevision: plan.revision, authorityId, coordinatorContextDigest, coordinatorContextRevision, payload
  });
  return {
    kind: "workflow", routeId: "provider.plan_approval", operationId, externalId: operationId,
    action: "plan_approval", repositoryRoot: "C:\\repo", targetSnapshotId: mediatedTargetId,
    sessionId: "codex-mediated", authorityId, provider: "codex",
    artifact: {
      id: artifact.immutable.id, digest: artifact.digest, taskId: plan.taskId, planRevision: plan.revision,
      authorityId, coordinatorContextDigest, coordinatorContextRevision, payload
    },
    executionAuthorization: {
      executionAuthorized: true, executeOnce: true, currentUserConfirmed: true,
      confirmationDigest, confirmationScopeDigest, operationId, artifactId: artifact.immutable.id,
      artifactDigest: artifact.digest, targetSnapshotId: mediatedTargetId, sessionId: "codex-mediated",
      authorityId, planDigest: plan.digest, planRevision: plan.revision, originSessionId: plan.originSessionId
    }
  };
}

function consumedWorkflowLease(command: ProviderGatewayWorkflowCommand, leaseId = `lease-${command.operationId}`): ProviderDispatchLease {
  const now = "2026-08-26T12:00:00.000Z";
  return signProviderDispatchLease({
    schema: "sxsy-b122.provider-dispatch-lease", version: 1, leaseId, nonce: sha256(leaseId), issuedAt: now, expiresAt: "2026-08-26T12:00:30.000Z",
    authority: { id: command.authorityId, grantDigest: "1".repeat(64), scopeDigest: "2".repeat(64), expiresAt: "2026-08-26T13:00:00.000Z" },
    target: { id: mediatedTargetId, ...mediatedTargetMaterial, capturedAt: now },
    session: { id: command.sessionId, provider: "codex", taskId: "task-mediated", planRevision: "plan-mediated", adapterVersion: "codex-fixture-provider-host-v1" },
    dispatch: { routeId: command.routeId, action: command.action, operationId: command.operationId },
    artifact: {
      id: command.artifact.id,
      digest: command.artifact.digest,
      coordinatorContextDigest: command.artifact.coordinatorContextDigest ?? null,
      coordinatorContextRevision: command.artifact.coordinatorContextRevision ?? null
    },
    confirmation: { digest: command.executionAuthorization!.confirmationDigest, scopeDigest: command.executionAuthorization!.confirmationScopeDigest },
    containment: { status: "clear", bindingDigest: "3".repeat(64), fenceEpoch: 4, activationOperationId: null },
    host: { configurationSha256, lifecycleNonceSha256: "5".repeat(64), tlsSpkiSha256: "6".repeat(64) }, module: moduleIdentity
  }, "9".repeat(64));
}

function externalModulePort(source: FixtureProviderRuntimePort, directCalls: { value: number }): ProviderRuntimePort {
  return {
    provider: "codex",
    handshake: source.handshake.bind(source),
    async execute() { directCalls.value += 1; throw new Error("the external module execute path must not own mediated effects"); },
    observeSession: source.observeSession.bind(source), observeWorkflowContext: source.observeWorkflowContext.bind(source),
    reanchor: source.reanchor.bind(source), observeReanchor: source.observeReanchor.bind(source),
    observeOperation: source.observeOperation.bind(source), cancelOperation: source.cancelOperation.bind(source),
    council: source.council.bind(source), observeCouncil: source.observeCouncil.bind(source), shutdown: source.shutdown.bind(source),
    async prepareMediatedEffect(request, binding) {
      return { schema: "sxsy-b122.provider-mediated-effect-intent", version: 1, authorizationId: binding.authorizationId, requestDigest: sha256(stableJson(request)), operation: "execute_exact_request" };
    },
    async prepareMediatedCouncilEffect(request, binding) {
      return { schema: "sxsy-b122.provider-mediated-council-intent", version: 1, authorizationId: binding.authorizationId, requestDigest: sha256(stableJson(request)), operation: "acknowledge_exact_phase" };
    }
  };
}

function proposalRequest(action: AutomationManifestAction, change: Readonly<Record<string, unknown>> = {}): AutomationProposalRequest {
  return {
    schema: "sxsy-b122.automation-proposal-request",
    version: 1,
    requestId: `proposal-${action}`,
    action,
    target: {
      id: targetId, repositoryRoot: "C:\\repo", canonicalRemote: null, branch: "feat/test", defaultBranch: "main",
      head: "b".repeat(40), indexTree: "c".repeat(40), trackedManifest: "d".repeat(64), untrackedManifest: "e".repeat(64),
      submodules: {}, policyVersion: "test-policy", environmentFingerprint: "f".repeat(64),
      capturedAt: "2026-08-26T12:00:00.000Z", completeness: "complete"
    },
    session: {
      id: "codex-session", provider: "codex", surface: "vscode_terminal",
      capabilities: ["registered", "observable", "controllable", "mediated"], status: "running",
      workspaceRoot: "C:\\repo", targetSnapshotId: targetId, taskId: "task-provider-host", planRevision: "plan-1",
      plannedFiles: ["src/example.ts"], adapterVersion: "codex-fixture-provider-host-v1"
    },
    authorityId: "authority-automation-proposal",
    effectAuthorized: false,
    ...change
  } as AutomationProposalRequest;
}

test("provider backend obtains deterministic no-effect review proposals for every automation action", async () => {
  const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const backend = new CodexProviderAdapterBackend(port);
  await backend.handshake({ sessionId: "codex-session", provider: "codex", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40) }, new AbortController().signal);

  for (const action of ["compound_capture", "compound_refresh", "lfg", "repair_mission"] as const) {
    const response = await backend.proposeAutomation(proposalRequest(action), new AbortController().signal);
    assert.equal(response.status, "completed");
    assert.equal(response.action, action);
    assert.equal(response.proposal?.kind, action);
    assert.equal(response.effectDisposition, "not_started");
    assert.match(response.proposalDigest ?? "", /^[a-f0-9]{64}$/);
  }
  assert.equal(port.executeCalls, 0, "proposal observation never enters the effect executor");
});

test("provider backend fails unavailable without a proposal port and rejects churn, substitution, and effect claims", async () => {
  const unavailablePort = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  Object.defineProperty(unavailablePort, "proposeAutomation", { value: undefined, configurable: true });
  const unavailable = new CodexProviderAdapterBackend(unavailablePort);
  await unavailable.handshake({ sessionId: "codex-session", provider: "codex", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40) }, new AbortController().signal);
  assert.equal((await unavailable.proposeAutomation(proposalRequest("compound_capture"), new AbortController().signal)).status, "unavailable");

  const churnedPort = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const churned = new CodexProviderAdapterBackend(churnedPort);
  await churned.handshake({ sessionId: "codex-session", provider: "codex", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40) }, new AbortController().signal);
  const original = churnedPort.proposeAutomation.bind(churnedPort);
  churnedPort.proposeAutomation = async (request, signal) => {
    const response = await original(request, signal);
    churnedPort.setSessionTarget(request.session.id, "9".repeat(64));
    return response;
  };
  await assert.rejects(() => churned.proposeAutomation(proposalRequest("compound_refresh"), new AbortController().signal), /after|target|session.*changed/i);

  const forgedPort = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const forged = new CodexProviderAdapterBackend(forgedPort);
  await forged.handshake({ sessionId: "codex-session", provider: "codex", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40) }, new AbortController().signal);
  forgedPort.proposeAutomation = async (request) => createAutomationProposalResponse({
    requestId: request.requestId,
    action: request.action === "lfg" ? "repair_mission" : "lfg",
    status: "unavailable",
    summary: "Forged cross-action response."
  }) as never;
  await assert.rejects(() => forged.proposeAutomation(proposalRequest("lfg"), new AbortController().signal), /action|request/i);

  forgedPort.proposeAutomation = async (request) => ({
    ...createAutomationProposalResponse({ requestId: request.requestId, action: request.action, status: "unavailable", summary: "No effect." }),
    effectDisposition: "committed"
  }) as never;
  await assert.rejects(() => forged.proposeAutomation(proposalRequest("repair_mission"), new AbortController().signal), /effect|disposition/i);
});

test("provider adapter and configured effect-driver ports reject automation execute, observe, and cancel while proposals remain available", async () => {
  const source = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const directCalls = { value: 0 };
  let driverExecuteCalls = 0;
  let driverObserveCalls = 0;
  let driverCancelCalls = 0;
  const mediated = new ConfiguredProviderMediatedEffectHostPort({
    configurationSha256,
    provider: "codex",
    ...moduleIdentity,
    driverModuleSha256,
    credential: Buffer.from("provider-secret", "utf8"),
    now: () => new Date("2026-08-26T12:00:02.000Z"),
    guard: { async assertCurrent(binding) { return finalCurrentDecision(binding); } },
    driver: {
      async executeCommand(input) {
        driverExecuteCalls += 1;
        if (input.command.kind !== "automation") throw new Error("unexpected command");
        return mediatedResult(input.command);
      },
      async executeCouncil() { throw new Error("not used"); },
      async observeCommand(input) {
        driverObserveCalls += 1;
        return { ...input, outcome: "unresolved", effectDisposition: "ambiguous", summary: "Legacy automation observation must be unreachable." };
      },
      async cancelCommand(input) {
        driverCancelCalls += 1;
        return { ...input, accepted: true, summary: "Legacy automation cancellation must be unreachable." };
      }
    }
  });
  const backend = new CodexProviderAdapterBackend(externalModulePort(source, directCalls), moduleIdentity, mediated);
  await backend.handshake({
    sessionId: "codex-mediated", provider: "codex", targetSnapshotId: mediatedTargetId,
    repositoryRoot: "C:\\repo", branch: "feat/mediated", head: mediatedTargetMaterial.head
  }, new AbortController().signal);

  const command = mediatedCommand("operation-provider-automation-disabled");
  assert.throws(
    () => backend.authorizeConsumedDispatchLease(consumedLease(command)),
    /proposal-only|companion-owned|automation.*disabled/i
  );
  await assert.rejects(() => backend.execute(command, new AbortController().signal), /proposal-only|companion-owned|automation.*disabled/i);
  const exact = {
    operationId: command.operationId, externalId: command.externalId, routeId: command.routeId, action: command.action,
    sessionId: command.sessionId, authorityId: command.authorityId,
    targetSnapshotId: command.targetSnapshotId, repositoryRoot: command.repositoryRoot
  };
  await assert.rejects(() => backend.observeOperation(exact, new AbortController().signal), /manual recovery|proposal-only|automation.*disabled/i);
  await assert.rejects(() => backend.cancelOperation({ ...exact, reason: "operator cancellation" }, new AbortController().signal), /manual recovery|proposal-only|automation.*disabled/i);
  assert.deepEqual(
    { direct: directCalls.value, execute: driverExecuteCalls, observe: driverObserveCalls, cancel: driverCancelCalls },
    { direct: 0, execute: 0, observe: 0, cancel: 0 }
  );

  const proposalSource = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const proposalBackend = new CodexProviderAdapterBackend(proposalSource);
  await proposalBackend.handshake({
    sessionId: "codex-session", provider: "codex", targetSnapshotId: targetId,
    repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40)
  }, new AbortController().signal);
  const proposal = await proposalBackend.proposeAutomation(proposalRequest("compound_capture"), new AbortController().signal);
  assert.equal(proposal.status, "completed");
  mediated.close();
});

test("automation effect bindings and forged echoes remain unreachable behind the proposal-only provider boundary", async () => {
  const source = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const backend = new CodexProviderAdapterBackend(source);
  await backend.handshake({
    sessionId: "codex-mediated", provider: "codex", targetSnapshotId: mediatedTargetId,
    repositoryRoot: "C:\\repo", branch: "feat/mediated", head: "b".repeat(40)
  }, new AbortController().signal);
  const exact = mediatedCommand("operation-review-binding");
  const substitutions = [
    { ...exact, repositoryRoot: "C:\\other" },
    { ...exact, targetSnapshotId: "0".repeat(64) },
    { ...exact, sessionId: "other-session" },
    { ...exact, authorityId: "other-authority" },
    { ...exact, provider: "claude" as const },
    { ...exact, action: "lfg" as const, routeId: "automation.lfg" },
    { ...exact, intent: { ...exact.intent, proposal: { ...exact.intent.proposal, documents: [{ path: "docs/other.md", mutation: "create", afterDigest: "4".repeat(64) }] } } }
  ];
  for (const substituted of substitutions) {
    await assert.rejects(() => backend.execute(substituted as never, new AbortController().signal), /binding|manifest|proposal|provider|action|automation.*disabled|companion-owned/i);
  }
  assert.equal(source.executeCalls, 0, "no substituted reviewed request reaches the provider module or effect fixture");

  class ForgedEchoPort extends FixtureProviderRuntimePort {
    override async execute(request: ProviderGatewayWorkflowCommand | ProviderGatewayAutomationCommand) {
      const result = await super.execute(request);
      return request.kind === "automation" ? { ...result, approvalId: "automation-approval:forged" } as never : result;
    }
  }
  const forgedPort = new ForgedEchoPort("codex", { effectfulTestOnly: true });
  const forgedBackend = new CodexProviderAdapterBackend(forgedPort);
  await forgedBackend.handshake({
    sessionId: "codex-mediated", provider: "codex", targetSnapshotId: mediatedTargetId,
    repositoryRoot: "C:\\repo", branch: "feat/mediated", head: "b".repeat(40)
  }, new AbortController().signal);
  await assert.rejects(
    () => forgedBackend.execute(mediatedCommand("operation-forged-echo"), new AbortController().signal),
    /binding|approval|response|automation.*disabled|companion-owned/i
  );
  assert.equal(forgedPort.executeCalls, 0, "a provider-owned automation effect cannot start, so no forged echo can become a false success");
});

test("host-owned mediation consumes one exact dispatch authorization without exposing credentials to the module", async () => {
  const source = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const directCalls = { value: 0 };
  let driverCalls = 0;
  const mediated = new ConfiguredProviderMediatedEffectHostPort({
    configurationSha256, provider: "codex", ...moduleIdentity, driverModuleSha256, credential: Buffer.from("provider-secret", "utf8"),
    now: () => new Date("2026-08-26T12:00:02.000Z"),
    guard: { async assertCurrent(binding) { assert.equal(binding.containmentBindingDigest, "3".repeat(64)); return finalCurrentDecision(binding); } },
    driver: {
      async executeCommand(input, credential) {
        driverCalls += 1;
        assert.equal(Buffer.from(credential).toString("utf8"), "provider-secret");
        assert.equal(input.intent.authorizationId, input.authorization.authorizationId);
        assert.equal(input.authorization.finalCurrentDecisionDigest.length, 64);
        if (input.command.kind !== "workflow") throw new Error("expected exact provider workflow command");
        return source.execute(input.command);
      },
      async executeCouncil() { throw new Error("not used"); }
    }
  });
  const backend = new CodexProviderAdapterBackend(externalModulePort(source, directCalls), moduleIdentity, mediated);
  assert.equal(mediated.attestation.driverModuleSha256, driverModuleSha256);
  await backend.handshake({ sessionId: "codex-mediated", provider: "codex", targetSnapshotId: mediatedTargetId, repositoryRoot: "C:\\repo", branch: "feat/mediated", head: mediatedTargetMaterial.head }, new AbortController().signal);

  const command = mediatedWorkflowCommand("operation-mediated-1");
  backend.authorizeConsumedDispatchLease(consumedWorkflowLease(command));
  const result = await backend.execute(command, new AbortController().signal);
  assert.equal(result.status, "completed");
  assert.equal(directCalls.value, 0, "the module execute method never receives a Mediated effect");
  assert.equal(driverCalls, 1);
  await assert.rejects(() => backend.execute(command, new AbortController().signal), /one-use|authorization|consumed/i);
  assert.throws(() => backend.authorizeConsumedDispatchLease(consumedWorkflowLease(command)), /one-use|replay|consumed/i);
  assert.equal(driverCalls, 1);
  mediated.close();
});

test("host-owned mediation rejects binding substitution and a failed final-current containment decision before credential use", async () => {
  const source = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const directCalls = { value: 0 };
  let driverCalls = 0;
  const mediated = new ConfiguredProviderMediatedEffectHostPort({
    configurationSha256, provider: "codex", ...moduleIdentity, driverModuleSha256, credential: Buffer.from("provider-secret", "utf8"),
    now: () => new Date("2026-08-26T12:00:02.000Z"),
    guard: { async assertCurrent() { throw new Error("The final-current containment callback denied the effect."); } },
    driver: {
      async executeCommand() { driverCalls += 1; throw new Error("must not run"); },
      async executeCouncil() { driverCalls += 1; throw new Error("must not run"); }
    }
  });
  const backend = new CodexProviderAdapterBackend(externalModulePort(source, directCalls), moduleIdentity, mediated);
  await backend.handshake({ sessionId: "codex-mediated", provider: "codex", targetSnapshotId: mediatedTargetId, repositoryRoot: "C:\\repo" }, new AbortController().signal);

  const substituted = mediatedWorkflowCommand("operation-mediated-substitution", "authority-substituted");
  backend.authorizeConsumedDispatchLease(consumedWorkflowLease(mediatedWorkflowCommand(substituted.operationId)));
  await assert.rejects(() => backend.execute(substituted, new AbortController().signal), /authorization.*binding|exact.*binding/i);
  assert.equal(driverCalls, 0);

  const denied = mediatedWorkflowCommand("operation-mediated-denied");
  backend.authorizeConsumedDispatchLease(consumedWorkflowLease(denied));
  await assert.rejects(() => backend.execute(denied, new AbortController().signal), /final-current|containment/i);
  assert.equal(driverCalls, 0, "no protected credential crosses the denied final-effect boundary");
  assert.equal(directCalls.value, 0);
  mediated.close();
});

test("host-owned mediation bounds a late effect driver and never accepts its settlement", async () => {
  const source = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  let releaseLateDriver!: () => void;
  const lateDriver = new Promise<void>((resolve) => { releaseLateDriver = resolve; });
  const mediated = new ConfiguredProviderMediatedEffectHostPort({
    configurationSha256, provider: "codex", ...moduleIdentity, driverModuleSha256,
    credential: Buffer.from("provider-secret", "utf8"), deadlineMs: 20,
    now: () => new Date("2026-08-26T12:00:02.000Z"),
    guard: { async assertCurrent(binding) { return finalCurrentDecision(binding); } },
    driver: {
      async executeCommand(input) {
        await lateDriver;
        if (input.command.kind !== "workflow") throw new Error("unexpected command");
        return source.execute(input.command);
      },
      async executeCouncil() { throw new Error("not used"); }
    }
  });
  const backend = new CodexProviderAdapterBackend(externalModulePort(source, { value: 0 }), moduleIdentity, mediated);
  await backend.handshake({ sessionId: "codex-mediated", provider: "codex", targetSnapshotId: mediatedTargetId, repositoryRoot: "C:\\repo" }, new AbortController().signal);
  const command = mediatedWorkflowCommand("operation-mediated-timeout");
  backend.authorizeConsumedDispatchLease(consumedWorkflowLease(command));
  const started = Date.now();
  await assert.rejects(() => backend.execute(command, new AbortController().signal), /deadline|timed out|cancelled/i);
  assert.ok(Date.now() - started < 1_000, "the host must stop waiting while the driver is still deliberately unsettled");
  releaseLateDriver();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => backend.execute(command, new AbortController().signal), /one-use|authorization|consumed/i);
  mediated.close();
});

test("mediated observation and cancellation stay on the exact host effect driver", async () => {
  const source = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const directCalls = { value: 0 };
  const modulePort = externalModulePort(source, directCalls);
  modulePort.observeOperation = async () => { directCalls.value += 1; throw new Error("provider module must not observe a host-mediated effect"); };
  modulePort.cancelOperation = async () => { directCalls.value += 1; throw new Error("provider module must not cancel a host-mediated effect"); };
  let observed = 0;
  let cancelled = 0;
  const mediated = new ConfiguredProviderMediatedEffectHostPort({
    configurationSha256, provider: "codex", ...moduleIdentity, driverModuleSha256,
    credential: Buffer.from("provider-secret", "utf8"),
    now: () => new Date("2026-08-26T12:00:02.000Z"),
    guard: { async assertCurrent(binding) { return finalCurrentDecision(binding); } },
    driver: {
      async executeCommand(input) { if (input.command.kind !== "workflow") throw new Error("unexpected command"); return source.execute(input.command); },
      async executeCouncil() { throw new Error("not used"); },
      async observeCommand(input, credential) {
        observed += 1;
        assert.equal(Buffer.from(credential).toString("utf8"), "provider-secret");
        return { ...input, outcome: "committed", effectDisposition: "committed", summary: "The exact mediated operation was observed." };
      },
      async cancelCommand(input, credential) {
        cancelled += 1;
        assert.equal(Buffer.from(credential).toString("utf8"), "provider-secret");
        return { ...input, accepted: true, summary: "The exact mediated operation cancellation was acknowledged." };
      },
      async observeCouncil() { throw new Error("not used"); }
    }
  });
  const backend = new CodexProviderAdapterBackend(modulePort, moduleIdentity, mediated);
  await backend.handshake({ sessionId: "codex-mediated", provider: "codex", targetSnapshotId: mediatedTargetId, repositoryRoot: "C:\\repo" }, new AbortController().signal);
  const command = mediatedWorkflowCommand("operation-mediated-observe");
  backend.authorizeConsumedDispatchLease(consumedWorkflowLease(command));
  await backend.execute(command, new AbortController().signal);
  const exact = {
    operationId: command.operationId, externalId: command.externalId, routeId: command.routeId, action: command.action,
    sessionId: command.sessionId, authorityId: command.authorityId, targetSnapshotId: command.targetSnapshotId, repositoryRoot: command.repositoryRoot
  };
  assert.equal((await backend.observeOperation(exact, new AbortController().signal)).outcome, "committed");
  assert.equal((await backend.cancelOperation({ ...exact, reason: "operator cancellation" }, new AbortController().signal)).accepted, true);
  assert.deepEqual({ observed, cancelled, direct: directCalls.value }, { observed: 1, cancelled: 1, direct: 0 });
  mediated.close();
});

test("a module cannot self-assert Mediated without the configured host effect port", async () => {
  const source = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const directCalls = { value: 0 };
  const port = { ...externalModulePort(source, directCalls), mediationAttested: true } as ProviderRuntimePort;
  const backend = new CodexProviderAdapterBackend(port, moduleIdentity);
  const handshake = await backend.handshake({ sessionId: "codex-mediated", provider: "codex", targetSnapshotId: mediatedTargetId, repositoryRoot: "C:\\repo" }, new AbortController().signal);
  assert.equal(handshake.capabilities.includes("mediated"), false);
  await assert.rejects(() => backend.execute(mediatedWorkflowCommand("operation-self-asserted"), new AbortController().signal), /Mediated|capabilit/i);
  assert.equal(directCalls.value, 0);
});

function effect(provider: "claude" | "codex", sessionId: string, authorityId: string, adapterVersion: string, adapterId: string, moduleSha256: string): WorkflowProviderEffectBinding {
  const session: ManagedSession = { id: sessionId, provider, surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: "C:\\repo", targetSnapshotId: targetId, taskId: "task-provider-host", planRevision: "plan-1", plannedFiles: ["src/example.ts"], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion, metadata: {} };
  const authority: AuthorityGrant = { id: authorityId, repositoryRoot: "C:\\repo", sessionId, taskId: session.taskId, planRevision: session.planRevision, allowedActions: ["proof_adversarial"], prohibitedActions: [], issuedAt: "2026-08-24T00:00:00.000Z", expiresAt: "2099-08-24T00:00:00.000Z", issuedBy: "test" };
  const material = { role: "proof_backend" as const, provider, session, authority, adapterId, adapterVersion, moduleSha256, providerContextDigest: sha256(`context-${provider}`) };
  return { ...material, bindingDigest: sha256(stableJson(material)) };
}

function evidence() {
  const planMaterial = { revision: "plan-1", originSessionId: "codex-session", taskId: "task-provider-host", objective: "Verify independent backends", steps: [{ id: "step-1", summary: "Verify", ownedFiles: ["src/example.ts"], dependencies: [], status: "approved" as const }], decisions: [] as string[], expectedTargetTransition: { beforeTargetSnapshotId: targetId, expectedAfterTargetSnapshotId: targetId, expectation: "unchanged" as const } };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const material = { instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context" as const, summary: "Instructions" }], plan, documentation: [{ id: "documentation", digest: "2".repeat(64), source: "repository" as const, summary: "Documentation" }], diff: { id: "diff", digest: "3".repeat(64), source: "target_snapshot" as const, summary: "Diff" }, files: [{ id: "file", digest: "4".repeat(64), source: "repository" as const, summary: "File" }], tests: [{ id: "test", digest: "5".repeat(64), source: "receipt" as const, summary: "Test", status: "passed" as const }] };
  return { contextDigest: sha256(stableJson(material)), ...material };
}

test("provider host stamps child results with the host-owned adapter identity and rejects profile aliases", async () => {
  const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const backend = new CodexProviderAdapterBackend(port);
  await backend.handshake({ sessionId: "codex-session", provider: "codex", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40) }, new AbortController().signal);
  const codex = effect("codex", "codex-session", "authority-codex", "codex-fixture-provider-host-v1", backend.dispatchIdentity.adapterId, backend.dispatchIdentity.moduleSha256);
  const claude = effect("claude", "claude-session", "authority-claude", "claude-v1", "independent-claude", sha256("independent-claude"));
  const payload = { kind: "proof" as const, evidence: evidence(), claims: ["claim"], requiredBackends: ["codex", "claude"], independentBackendRequired: true, providerEffects: [codex, claude] };
  const artifact = canonicalWorkflowArtifact({ id: "artifact-adversarial", action: "proof_adversarial", repositoryRoot: "C:\\repo", targetSnapshotId: targetId, sessionId: "codex-session", taskId: "task-provider-host", planRevision: "plan-1", authorityId: "authority-codex", payload });
  const command: ProviderGatewayWorkflowCommand = {
    kind: "workflow", routeId: "provider.proof_adversarial", operationId: "child-codex-1", externalId: "child-codex-1", action: "proof_adversarial",
    repositoryRoot: "C:\\repo", targetSnapshotId: targetId, sessionId: "codex-session", authorityId: "authority-codex", provider: "codex",
    artifact: { id: artifact.immutable.id, digest: artifact.digest, sessionId: "codex-session", operationId: "parent-adversarial", taskId: "task-provider-host", planRevision: "plan-1", authorityId: "authority-codex", payload },
    child: { role: "proof_backend", bindingDigest: codex.bindingDigest, effect: codex, parentOperationId: "parent-adversarial" }
  };
  const original = port.execute.bind(port);
  port.execute = async (request) => ({ ...(await original(request)), adapterId: "provider-spoof", moduleSha256: sha256("provider-spoof") }) as never;
  const response = await backend.execute(command, new AbortController().signal);
  assert.equal("adapterId" in response ? response.adapterId : undefined, backend.dispatchIdentity.adapterId);
  assert.equal("moduleSha256" in response ? response.moduleSha256 : undefined, backend.dispatchIdentity.moduleSha256);

  const aliased = effect("codex", "codex-session", "authority-codex", "codex-fixture-provider-host-v1", "untrusted-alias", sha256("untrusted-alias"));
  const aliasPayload = { ...payload, providerEffects: [aliased, claude] };
  const aliasArtifact = canonicalWorkflowArtifact({ id: "artifact-adversarial-alias", action: "proof_adversarial", repositoryRoot: "C:\\repo", targetSnapshotId: targetId, sessionId: "codex-session", taskId: "task-provider-host", planRevision: "plan-1", authorityId: "authority-codex", payload: aliasPayload });
  await assert.rejects(() => backend.execute({ ...command, operationId: "child-codex-alias", externalId: "child-codex-alias", artifact: { ...command.artifact, id: aliasArtifact.immutable.id, digest: aliasArtifact.digest, payload: aliasPayload }, child: { ...command.child!, bindingDigest: aliased.bindingDigest, effect: aliased } }, new AbortController().signal), /profile|binding|adapter/i);
});

test("provider adapter backend rejects forged operation identity, root, authority, and effect disposition", async (context) => {
  const request: ProviderGatewayOperationObservationRequest = {
    operationId: "operation-observe-1", externalId: "operation-observe-1", routeId: "provider.proof",
    action: "proof", sessionId: "codex-session", authorityId: "authority-codex",
    targetSnapshotId: targetId, repositoryRoot: "C:\\repo"
  };
  const mutations: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["authority", { authorityId: "authority-confused" }],
    ["action", { action: "plan_expander" }],
    ["session", { sessionId: "other-session" }],
    ["root", { repositoryRoot: "C:\\other" }],
    ["disposition", { outcome: "committed", effectDisposition: "not_started" }]
  ];
  for (const [label, mutation] of mutations) {
    await context.test(label, async () => {
      const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
      port.observeOperation = async (input) => ({
        ...input, outcome: "committed", effectDisposition: "committed", summary: "Forged provider observation.", ...mutation
      }) as never;
      const backend = new CodexProviderAdapterBackend(port);
      await assert.rejects(() => backend.observeOperation(request, new AbortController().signal), /binding|disposition/i);
    });
  }

  const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  port.cancelOperation = async (input) => ({ ...input, authorityId: "authority-confused", accepted: true, summary: "Forged cancellation." }) as never;
  await assert.rejects(
    () => new CodexProviderAdapterBackend(port).cancelOperation({ ...request, reason: "operator cancellation" }, new AbortController().signal),
    /binding/i
  );
});
