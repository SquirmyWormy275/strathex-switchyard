import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowArtifact, WorkflowArtifactAction, WorkflowChildProviderResponse, WorkflowProviderEffectBinding, WorkflowProviderResponse } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import type { AdapterRequest } from "../../../packages/control-plane/src/adapters.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { automationRequestSchema, automationResultSchema } from "../../../packages/control-plane/src/automation-protocol.ts";
import { AttestedProviderHandshakeCoordinator, ConfiguredProviderCommandAdapter, DynamicConfiguredNetworkClient, createConfiguredAutomationBroker } from "../src/remote-adapters.ts";

const providerTargetId = "a".repeat(64);
function proofEvidence() {
  const planMaterial = { revision: "plan-1", originSessionId: "session-1", taskId: "task-1", objective: "Verify the provider route.", steps: [{ id: "step-1", summary: "Verify", ownedFiles: ["src/safe.ts"], dependencies: [], status: "approved" as const }], decisions: [] as string[] };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const material = { instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context" as const, summary: "Instructions" }], plan, documentation: [{ id: "documentation", digest: "5".repeat(64), source: "repository" as const, summary: "Documentation" }], diff: { id: "diff", digest: "2".repeat(64), source: "target_snapshot" as const, summary: "Diff" }, files: [{ id: "file", digest: "3".repeat(64), source: "repository" as const, summary: "File" }], tests: [{ id: "receipt", digest: "4".repeat(64), source: "receipt" as const, summary: "Test", status: "passed" as const }] };
  return { contextDigest: sha256(stableJson(material)), ...material };
}
function proofArtifact(): WorkflowArtifact {
  return {
    id: "artifact-proof-1", action: "proof", repositoryRoot: "C:\\repo", targetSnapshotId: providerTargetId,
    sessionId: "session-1", taskId: "task-1", planRevision: "plan-1",
    payload: { kind: "proof", evidence: proofEvidence(), claims: ["claim"], requiredBackends: ["local"], independentBackendRequired: false },
    digest: "b".repeat(64), status: "submitted", operationId: "operation-1", executionAuthorized: false,
    createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z"
  };
}

function providerEffect(role: WorkflowProviderEffectBinding["role"], provider: "claude" | "codex", sessionId: string, authorityId: string, marker: string): WorkflowProviderEffectBinding {
  const session = { id: sessionId, provider, surface: "vscode_terminal" as const, capabilities: ["registered", "observable", "controllable", "mediated"] as const, status: "running" as const, workspaceRoot: "C:\\repo", targetSnapshotId: providerTargetId, taskId: "task-1", planRevision: "plan-1", plannedFiles: [] as string[], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: `${marker}-v1`, metadata: {} };
  const authority = { id: authorityId, repositoryRoot: "C:\\repo", sessionId, taskId: "task-1", planRevision: "plan-1", allowedActions: role === "proof_backend" ? ["proof_adversarial"] : ["authority_broadcast"], prohibitedActions: [] as string[], expiresAt: "2099-08-24T00:00:00.000Z", issuedAt: "2026-08-24T00:00:00.000Z", issuedBy: "test" };
  const material = { role, provider, session, authority, adapterId: `adapter-${marker}`, adapterVersion: `${marker}-v1`, moduleSha256: sha256(`module-${marker}`), providerContextDigest: sha256(`context-${marker}`) };
  return { ...material, bindingDigest: sha256(stableJson(material)) };
}

function adversarialArtifact(): WorkflowArtifact {
  const effects = [providerEffect("proof_backend", "codex", "session-1", "authority-proof", "codex"), providerEffect("proof_backend", "claude", "session-claude", "authority-claude", "claude")];
  return {
    ...proofArtifact(), id: "artifact-proof-adversarial", action: "proof_adversarial", operationId: "operation-proof-adversarial", authorityId: "authority-proof",
    payload: { kind: "proof", evidence: proofEvidence(), claims: ["claim"], requiredBackends: ["codex", "claude"], independentBackendRequired: true, providerEffects: effects }
  };
}

function broadcastArtifact(): WorkflowArtifact {
  const effects = [providerEffect("authority_recipient", "codex", "recipient-1", "grant-1", "recipient-1"), providerEffect("authority_recipient", "codex", "recipient-2", "grant-2", "recipient-2")];
  const packets = effects.map((effect, index) => ({ recipientSessionId: effect.session.id, grantId: effect.authority.id, actions: ["proof" as const, "authority_broadcast" as const], prohibitions: [] as const, expiresAt: effect.authority.expiresAt, pendingRequest: { requestId: `request-${index + 1}`, targetSnapshotId: providerTargetId, planRevision: "plan-1", planDigest: proofEvidence().plan.digest, action: "proof" as const }, matchDigest: sha256(`recipient-match-${index + 1}`), providerEffect: effect }));
  return {
    ...proofArtifact(), id: "artifact-authority-broadcast", action: "authority_broadcast", operationId: "operation-authority-broadcast", authorityId: "authority-proof",
    payload: { kind: "authority", mode: "broadcast", packets, acknowledgementRequired: true }
  };
}
function planApprovalArtifact(): WorkflowArtifact {
  const plan = proofEvidence().plan;
  return {
    id: "artifact-plan-1", action: "plan_approval", repositoryRoot: "C:\\repo", targetSnapshotId: providerTargetId,
    sessionId: "session-1", taskId: plan.taskId, planRevision: plan.revision,
    payload: { kind: "plan", mode: "approve", plan, executorSessionId: "session-1", authorityId: "authority-plan", confirmationDigest: "9".repeat(64), confirmationScopeDigest: "7".repeat(64), providerContextDigest: "6".repeat(64), executeOnce: true },
    digest: "8".repeat(64), status: "submitted", operationId: "operation-plan-1", executionAuthorized: false,
    createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z"
  };
}
function providerRequest(untrustedInput?: Readonly<Record<string, string>>, childSaga?: unknown) {
  return {
    definition: { action: "proof" }, operationId: "operation-1",
    target: { id: providerTargetId, repositoryRoot: "C:\\repo", policyVersion: "v1", digest: "d" },
    session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", taskId: "task-1", planRevision: "plan-1", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "v1", metadata: {} },
    authority: { id: "authority-proof" },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    ...(childSaga ? { childSaga } : {}),
    ...(untrustedInput ? { untrustedInput } : {})
  } as never;
}

test("configured provider adapter dispatches and acknowledges only an exact typed workflow artifact", async () => {
  const requests: unknown[] = [];
  const childEvents: Array<readonly [string, unknown]> = [];
  const artifact = proofArtifact();
  let acknowledged: WorkflowProviderResponse | undefined;
  const adapter = new ConfiguredProviderCommandAdapter({
    async request(input: unknown) {
      requests.push(input);
      return { outcome: "passed", routeId: "provider.proof", detail: "ok", effectDisposition: "ambiguous", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.workflow-result", version: 1, artifactId: artifact.id, artifactDigest: artifact.digest, operationId: artifact.operationId, action: "proof", status: "completed", summary: "Provider returned durable proof.", effectDisposition: "committed", externalId: "provider-proof-1", result: { kind: "proof", verifiedClaims: ["claim"], evidenceReferences: ["receipt:1"], backendResults: [{ backend: "local", status: "passed" }] } })) };
    }
  } as unknown as DynamicConfiguredNetworkClient, {
    async claimForDispatch(input: Readonly<{ action: WorkflowArtifactAction; targetSnapshotId: string; sessionId: string; operationId: string; authorityId: string }>) { assert.deepEqual(input, { action: "proof", targetSnapshotId: providerTargetId, sessionId: "session-1", operationId: "operation-1", authorityId: "authority-proof" }); return artifact; },
    async assertDispatchBinding(input) { assert.deepEqual(input, { artifactId: artifact.id, artifactDigest: artifact.digest, action: "proof", targetSnapshotId: providerTargetId, sessionId: "session-1", operationId: "operation-1", authorityId: "authority-proof" }); return artifact; },
    async acknowledge(response) { acknowledged = response; return { ...artifact, status: "acknowledged", providerExternalId: response.externalId }; }
  });
  const childSaga = {
    async begin(input: unknown) { childEvents.push(["begin", input]); return { id: "child-provider-1", mayExecute: true }; },
    async markExecuting(input: unknown) { childEvents.push(["executing", input]); },
    async markExternalCommitted(_input: unknown, details: unknown) { childEvents.push(["external", details]); },
    async markCompensating(input: unknown) { childEvents.push(["compensating", input]); },
    async settle(_input: unknown, state: unknown, details: unknown) { childEvents.push([String(state), details]); }
  };
  const outcome = await adapter.execute(providerRequest({ injectedPrompt: "must-not-cross-boundary" }, childSaga));
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.effectDisposition, "committed");
  assert.deepEqual(outcome.data?.workflowResult, {
    kind: "proof",
    verifiedClaims: ["claim"],
    evidenceReferences: ["receipt:1"],
    backendResults: [{ backend: "local", status: "passed" }]
  });
  assert.equal(outcome.data?.artifactId, artifact.id);
  assert.equal(acknowledged?.artifactId, artifact.id);
  assert.equal(requests.length, 1);
  const document = JSON.parse(String((requests[0] as { body: string }).body)) as Record<string, unknown>;
  assert.equal(document.schema, "sxsy-b122.workflow-command");
  assert.equal(document.authorityId, "authority-proof");
  assert.equal("input" in document, false);
  assert.deepEqual(document.artifact, { id: artifact.id, digest: artifact.digest, taskId: "task-1", planRevision: "plan-1", payload: artifact.payload, executionAuthorized: false });
  const started = childEvents.find(([kind]) => kind === "begin")?.[1] as { action: string; details: Record<string, string> };
  assert.equal(started.action, "provider.proof");
  assert.deepEqual(started.details, { repositoryRoot: "C:\\repo", routeId: "provider.proof", targetSnapshotId: providerTargetId, artifactId: artifact.id, artifactDigest: artifact.digest });
  assert.deepEqual(childEvents.find(([kind]) => kind === "external")?.[1], { artifactId: artifact.id, routeId: "provider.proof", externalId: "provider-proof-1" });
  assert.equal(childEvents.some(([kind]) => kind === "completed"), true);
});

test("Shift Proof dispatches two independent durable provider children and retries aggregation without replay", async () => {
  let artifact = adversarialArtifact();
  const requests: Array<{ body: string; trustedDispatch: { session: { provider: string } } }> = [];
  const childStates = new Map<string, "recorded">();
  let failFirstAggregate = true;
  let acknowledged: WorkflowProviderResponse | undefined;
  const artifacts = {
    async claimForDispatch() { return artifact; }, async assertDispatchBinding() { return artifact; },
    async recordChildResult(response: WorkflowChildProviderResponse) {
      const existing = artifact.childResults ?? [];
      if (!existing.some((entry) => entry.bindingDigest === response.bindingDigest)) artifact = { ...artifact, childResults: [...existing, response] };
      return artifact;
    },
    async acknowledge(response: WorkflowProviderResponse) {
      if (failFirstAggregate) { failFirstAggregate = false; throw new Error("simulated aggregate journal interruption"); }
      acknowledged = response; return { ...artifact, status: "acknowledged" as const };
    }
  };
  const saga = {
    async begin(input: { idempotencyScope: string }) {
      const prior = childStates.has(input.idempotencyScope);
      return { operationId: `child:${input.idempotencyScope.slice(-16)}`, parentOperationId: artifact.operationId!, action: "provider.proof_adversarial", targetSnapshotId: providerTargetId, existing: prior, state: prior ? "recorded" as const : "prepared" as const, mayExecute: !prior };
    },
    async markExecuting() {}, async markExternalCommitted() {}, async markCancelling() {}, async markCompensating() {},
    async settle(_lease: unknown, state: string, details: { bindingDigest?: string }) { if (state === "completed" && details.bindingDigest) childStates.set(details.bindingDigest, "recorded"); }
  };
  // Key the test double by the exact idempotency scope used by the adapter.
  saga.settle = async (_lease: unknown, state: string, details: { idempotencyScope?: string; bindingDigest?: string }) => { if (state === "completed" && details.idempotencyScope) childStates.set(details.idempotencyScope, "recorded"); };
  const network = {
    async request(input: { body: string; trustedDispatch: { session: { provider: "claude" | "codex" } } }) {
      requests.push(input);
      const document = JSON.parse(input.body) as { operationId: string; child: { role: "proof_backend"; bindingDigest: string }; artifact: { operationId: string } };
      const effect = (artifact.payload.kind === "proof" ? artifact.payload.providerEffects : [])!.find((candidate) => candidate.bindingDigest === document.child.bindingDigest)!;
      return { outcome: "passed" as const, routeId: "provider.proof_adversarial", detail: "ok", effectDisposition: "ambiguous" as const, body: Buffer.from(JSON.stringify({
        schema: "sxsy-b122.workflow-child-result", version: 1, artifactId: artifact.id, artifactDigest: artifact.digest,
        parentOperationId: artifact.operationId, childOperationId: document.operationId, action: artifact.action,
        role: "proof_backend", bindingDigest: effect.bindingDigest, provider: effect.provider, adapterId: effect.adapterId, moduleSha256: effect.moduleSha256,
        status: "completed", effectDisposition: "committed", summary: `${effect.provider} completed an independent proof.`, externalId: `external-${effect.provider}`,
        result: { kind: "proof_backend", backend: effect.provider, status: "passed", verifiedClaims: ["claim"], evidenceReferences: [`receipt:${effect.provider}`] }
      })) };
    }
  };
  const request = { ...(providerRequest(undefined, saga) as unknown as Record<string, unknown>), definition: { action: "proof_adversarial" }, operationId: artifact.operationId, confirmation: { currentUserConfirmed: true, confirmationDigest: "9".repeat(64), confirmationScopeDigest: "8".repeat(64), action: "proof_adversarial", targetSnapshotId: providerTargetId, sessionId: "session-1", authorityId: "authority-proof" } } as unknown as AdapterRequest;
  const first = await new ConfiguredProviderCommandAdapter(network as never, artifacts).execute(request);
  assert.equal(first.status, "failed", "the interrupted aggregate acknowledgement must not erase two committed child truths");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((entry) => entry.trustedDispatch.session.provider).sort(), ["claude", "codex"]);
  assert.equal(new Set(requests.map((entry) => JSON.parse(entry.body).operationId)).size, 2);
  const beforeRetry = requests.length;
  const second = await new ConfiguredProviderCommandAdapter(network as never, artifacts).execute(request);
  assert.equal(second.status, "completed");
  assert.equal(requests.length, beforeRetry, "durably recorded provider children must never be replayed to repair aggregation");
  assert.deepEqual(acknowledged?.result.kind === "proof" ? acknowledged.result.backendResults : [], [{ backend: "codex", status: "passed" }, { backend: "claude", status: "passed" }]);
});

test("Authority Broadcast creates one durable child per exact recipient and rejects a cross-recipient acknowledgement", async () => {
  let artifact = broadcastArtifact();
  const requests: Array<{ body: string; trustedDispatch: { session: { id: string }; authority: { id: string } } }> = [];
  let acknowledgements = 0;
  const begun = new Map<string, number>();
  const saga = {
    async begin(input: { idempotencyScope: string }) { begun.set(input.idempotencyScope, (begun.get(input.idempotencyScope) ?? 0) + 1); return { operationId: `child-broadcast-${begun.size}`, parentOperationId: artifact.operationId!, action: "provider.authority_broadcast.codex", targetSnapshotId: providerTargetId, existing: false, state: "prepared" as const, mayExecute: true }; },
    async markExecuting() {}, async markExternalCommitted() {}, async markCancelling() {}, async markCompensating() {}, async settle() {}
  };
  let corruptRecipient = false;
  const network = {
    async request(input: { body: string; trustedDispatch: { session: { id: string }; authority: { id: string } } }) {
      requests.push(input);
      const document = JSON.parse(input.body) as { operationId: string; child: { bindingDigest: string } };
      const packet = artifact.payload.kind === "authority" ? artifact.payload.packets.find((candidate) => candidate.providerEffect?.bindingDigest === document.child.bindingDigest)! : undefined;
      const effect = packet!.providerEffect!;
      return { outcome: "passed" as const, routeId: "provider.authority_broadcast", detail: "ok", effectDisposition: "ambiguous" as const, body: Buffer.from(JSON.stringify({
        schema: "sxsy-b122.workflow-child-result", version: 1, artifactId: artifact.id, artifactDigest: artifact.digest,
        parentOperationId: artifact.operationId, childOperationId: document.operationId, action: artifact.action,
        role: "authority_recipient", bindingDigest: effect.bindingDigest, provider: effect.provider, adapterId: effect.adapterId, moduleSha256: effect.moduleSha256,
        status: "completed", effectDisposition: "committed", summary: "Recipient acknowledged its exact packet.", externalId: `ack-${packet!.recipientSessionId}`,
        result: { kind: "authority_recipient", recipientSessionId: packet!.recipientSessionId, grantId: corruptRecipient && packet!.recipientSessionId === "recipient-2" ? "grant-1" : packet!.grantId, matchDigest: packet!.matchDigest, acknowledged: true }
      })) };
    }
  };
  const artifacts = {
    async claimForDispatch() { return artifact; }, async assertDispatchBinding() { return artifact; },
    async recordChildResult(response: WorkflowChildProviderResponse) { artifact = { ...artifact, childResults: [...(artifact.childResults ?? []), response] }; return artifact; },
    async acknowledge() { acknowledgements += 1; return { ...artifact, status: "acknowledged" as const }; }
  };
  const request = { ...(providerRequest(undefined, saga) as unknown as Record<string, unknown>), definition: { action: "authority_broadcast" }, operationId: artifact.operationId, confirmation: { currentUserConfirmed: true, confirmationDigest: "9".repeat(64), confirmationScopeDigest: "8".repeat(64), action: "authority_broadcast", targetSnapshotId: providerTargetId, sessionId: "session-1", authorityId: "authority-proof" } } as unknown as AdapterRequest;
  const completed = await new ConfiguredProviderCommandAdapter(network as never, artifacts).execute(request);
  assert.equal(completed.status, "completed");
  assert.equal(acknowledgements, 1);
  assert.deepEqual(requests.map((entry) => [entry.trustedDispatch.session.id, entry.trustedDispatch.authority.id]), [["recipient-1", "grant-1"], ["recipient-2", "grant-2"]]);

  artifact = { ...broadcastArtifact(), id: "artifact-authority-broadcast-corrupt", digest: "c".repeat(64), operationId: "operation-authority-broadcast-corrupt" };
  corruptRecipient = true; acknowledgements = 0; requests.length = 0; begun.clear();
  const corruptRequest = { ...(request as unknown as Record<string, unknown>), operationId: artifact.operationId } as unknown as AdapterRequest;
  const refused = await new ConfiguredProviderCommandAdapter(network as never, artifacts).execute(corruptRequest);
  assert.equal(refused.status, "failed");
  assert.equal(refused.effectDisposition, "ambiguous");
  assert.equal(acknowledgements, 0);
  assert.equal(artifact.childResults?.length, 1, "the first recipient truth remains durable while the wrong second acknowledgement is rejected");
});

test("configured provider adapter never acknowledges malformed provider output", async () => {
  const artifact = proofArtifact();
  let acknowledgements = 0;
  const adapter = new ConfiguredProviderCommandAdapter({ async request() { return { outcome: "passed", routeId: "provider.proof", detail: "ok", effectDisposition: "ambiguous", body: Buffer.from("{}") }; } } as unknown as DynamicConfiguredNetworkClient, {
    async claimForDispatch() { return artifact; }, async assertDispatchBinding() { return artifact; }, async acknowledge() { acknowledgements += 1; return artifact; }
  });
  const outcome = await adapter.execute(providerRequest());
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.effectDisposition, "ambiguous");
  assert.equal(acknowledgements, 0);
});

test("configured provider preserves a committed child but refuses acknowledgement after post-effect target churn", async () => {
  const artifact = proofArtifact();
  const childEvents: string[] = [];
  let guardChecks = 0;
  let acknowledgements = 0;
  const adapter = new ConfiguredProviderCommandAdapter({
    async request() {
      return { outcome: "passed", routeId: "provider.proof", detail: "ok", effectDisposition: "committed", body: Buffer.from(JSON.stringify({
        schema: "sxsy-b122.workflow-result", version: 1, artifactId: artifact.id, artifactDigest: artifact.digest,
        operationId: artifact.operationId, action: "proof", status: "completed", effectDisposition: "committed",
        summary: "The provider committed the exact proof.", externalId: "provider-post-effect-1",
        result: { kind: "proof", verifiedClaims: ["claim"], evidenceReferences: ["receipt:1"], backendResults: [{ backend: "local", status: "passed" }] }
      })) };
    }
  } as unknown as DynamicConfiguredNetworkClient, {
    async claimForDispatch() { return artifact; }, async assertDispatchBinding() { return artifact; },
    async acknowledge() { acknowledgements += 1; return artifact; }
  });
  const outcome = await adapter.execute({
    ...(providerRequest() as unknown as Record<string, unknown>),
    effectGuard: { async assertCurrent() { guardChecks += 1; return guardChecks < 3 ? { allowed: true, reason: "current" } : { allowed: false, reason: "target changed after provider effect" }; } },
    childSaga: {
      async begin() { return { id: "child-post-effect", mayExecute: true }; },
      async markExecuting() { childEvents.push("executing"); },
      async markExternalCommitted() { childEvents.push("external"); },
      async markCompensating() { childEvents.push("compensating"); },
      async settle(_child: unknown, state: string) { childEvents.push(state); }
    }
  } as unknown as AdapterRequest);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.effectDisposition, "committed");
  assert.equal(acknowledgements, 0);
  assert.deepEqual(childEvents, ["executing", "external", "ambiguous"]);
});

test("configured provider adapter revalidates the exact artifact and protected context at the final network boundary", async () => {
  const artifact = proofArtifact();
  let requests = 0;
  let finalChecks = 0;
  const adapter = new ConfiguredProviderCommandAdapter({
    async request() { requests += 1; throw new Error("stale workflow must not reach the network"); }
  } as unknown as DynamicConfiguredNetworkClient, {
    async claimForDispatch() { return artifact; },
    async assertDispatchBinding() { finalChecks += 1; throw new Error("coordinator source revision advanced"); },
    async acknowledge() { throw new Error("stale workflow must not acknowledge"); }
  });

  const outcome = await adapter.execute(providerRequest());
  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.effectDisposition, "not_started");
  assert.equal(finalChecks, 1);
  assert.equal(requests, 0);
});

test("Plan Approval sends execution authorization only from dispatcher-proven current-user confirmation", async () => {
  const artifact = planApprovalArtifact();
  const requests: Array<{ body: string }> = [];
  const network = {
    async request(input: { body: string }) {
      requests.push(input);
      return { outcome: "passed", routeId: "provider.plan_approval", detail: "ok", effectDisposition: "ambiguous", body: Buffer.from(JSON.stringify({
        schema: "sxsy-b122.workflow-result", version: 1, artifactId: artifact.id, artifactDigest: artifact.digest, operationId: artifact.operationId,
        action: "plan_approval", status: "completed", effectDisposition: "committed", summary: "The exact plan execution was acknowledged.", externalId: "provider-plan-1",
        result: { kind: "plan", mode: "execution_ack", planDigest: artifact.payload.kind === "plan" ? artifact.payload.plan.digest : "", planRevision: "plan-1", originSessionId: "session-1", executorSessionId: "session-1", authorityId: "authority-plan", acknowledgementId: "ack-plan-1", executionStarted: true }
      })) };
    }
  } as unknown as DynamicConfiguredNetworkClient;
  const artifacts = { async claimForDispatch() { return artifact; }, async assertDispatchBinding() { return artifact; }, async acknowledge() { return { ...artifact, status: "acknowledged" as const }; } };
  const adapter = new ConfiguredProviderCommandAdapter(network, artifacts);
  const base = {
    definition: { action: "plan_approval" }, operationId: "operation-plan-1",
    target: { id: providerTargetId, repositoryRoot: "C:\\repo", policyVersion: "v1", digest: "d" },
    session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", taskId: "task-1", planRevision: "plan-1", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "v1", metadata: {} },
    authority: { id: "authority-plan" },
    confirmation: { currentUserConfirmed: true, confirmationDigest: "9".repeat(64), confirmationScopeDigest: "7".repeat(64), action: "plan_approval", targetSnapshotId: providerTargetId, sessionId: "session-1", authorityId: "authority-plan" },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } }
  } as unknown as AdapterRequest;

  assert.equal((await adapter.execute(base)).status, "completed");
  const document = JSON.parse(requests[0]!.body) as { executionAuthorization: unknown };
  assert.deepEqual(document.executionAuthorization, {
    executionAuthorized: true, executeOnce: true, currentUserConfirmed: true, confirmationDigest: "9".repeat(64), confirmationScopeDigest: "7".repeat(64), operationId: "operation-plan-1", artifactId: artifact.id, artifactDigest: artifact.digest,
    targetSnapshotId: providerTargetId, sessionId: "session-1", authorityId: "authority-plan", planDigest: proofEvidence().plan.digest, planRevision: "plan-1", originSessionId: "session-1"
  });

  const refused = await new ConfiguredProviderCommandAdapter(network, artifacts).execute({ ...base, confirmation: undefined } as never);
  assert.equal(refused.status, "blocked");
  const mismatchedConfirmation = await new ConfiguredProviderCommandAdapter(network, artifacts).execute({ ...base, confirmation: { ...base.confirmation!, confirmationDigest: "7".repeat(64) } } as never);
  assert.equal(mismatchedConfirmation.status, "blocked");
  const mismatchedScope = await new ConfiguredProviderCommandAdapter(network, artifacts).execute({ ...base, confirmation: { ...base.confirmation!, confirmationScopeDigest: "6".repeat(64) } } as never);
  assert.equal(mismatchedScope.status, "blocked");
  assert.equal(requests.length, 1);
});

test("configured provider adapter does not call the network without one prepared typed artifact", async () => {
  let requests = 0;
  const adapter = new ConfiguredProviderCommandAdapter({ async request() { requests += 1; throw new Error("must not dispatch"); } } as unknown as DynamicConfiguredNetworkClient, {
    async claimForDispatch() { return undefined; }, async assertDispatchBinding() { throw new Error("must not revalidate"); }, async acknowledge() { throw new Error("must not acknowledge"); }
  });
  const outcome = await adapter.execute(providerRequest());
  assert.equal(outcome.status, "awaiting_input");
  assert.equal(outcome.effectDisposition, "not_started");
  assert.equal(requests, 0);
});

test("configured provider adapter refuses a direct call without the final host effect guard", async () => {
  let requests = 0;
  const adapter = new ConfiguredProviderCommandAdapter({ async request() { requests += 1; throw new Error("must not dispatch"); } } as unknown as DynamicConfiguredNetworkClient, {
    async claimForDispatch() { throw new Error("must not claim"); }, async assertDispatchBinding() { throw new Error("must not revalidate"); }, async acknowledge() { throw new Error("must not acknowledge"); }
  });
  const outcome = await adapter.execute({ ...(providerRequest() as unknown as Record<string, unknown>), effectGuard: undefined } as unknown as AdapterRequest);
  assert.equal(outcome.status, "unavailable");
  assert.equal(outcome.effectDisposition, "not_started");
  assert.equal(requests, 0);
});

test("configured provider adapter never replays cancelled, cancelling, rejected, or acknowledged queue state", async () => {
  let requests = 0;
  const network = { async request() { requests += 1; throw new Error("must not dispatch"); } } as unknown as DynamicConfiguredNetworkClient;
  for (const [status, expectedStatus, disposition] of [
    ["cancelled", "cancelled", "not_started"],
    ["cancelling", "cancelled", "not_started"],
    ["rejected", "failed", "not_started"],
    ["acknowledged", "completed", "committed"]
  ] as const) {
    const adapter = new ConfiguredProviderCommandAdapter(network, {
      async claimForDispatch() { return { ...proofArtifact(), status }; },
      async assertDispatchBinding() { throw new Error("non-dispatchable state must not revalidate"); },
      async acknowledge() { throw new Error("must not acknowledge"); }
    });
    const outcome = await adapter.execute(providerRequest());
    assert.equal(outcome.status, expectedStatus);
    assert.equal(outcome.effectDisposition, disposition);
  }
  assert.equal(requests, 0);
});

test("provider handshake elevates only an exact current target after user presence", async () => {
  const targetId = "a".repeat(64);
  const target = { id: targetId, repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40), trackedManifest: "c".repeat(64), untrackedManifest: "d".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "e".repeat(64), capturedAt: "2026-08-24T00:00:00.000Z", completeness: "complete", reasons: [] } as const;
  let resolutions = 0;
  const coordinator = new AttestedProviderHandshakeCoordinator(
    { handshakeCapabilityCeiling() { return ["registered", "observable", "controllable", "mediated"] as const; }, async request() { return { outcome: "passed", routeId: "provider.handshake.codex", detail: "ok", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.provider-handshake", version: 1, sessionId: "session-1", provider: "codex", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", adapterVersion: "codex-adapter-1", taskId: "task-1", planRevision: "plan-1", plannedFiles: ["src/index.ts"], resources: ["port:4100"], dependencies: [], diffDigest: "f".repeat(64) })) }; } } as unknown as DynamicConfiguredNetworkClient,
    { async resolve() { resolutions += 1; return target; } },
    { async verify() { return { verified: true, operator: "DOMAIN\\operator" }; } },
    () => "2026-08-24T00:00:01.000Z"
  );
  const session = await coordinator.handshake({ repositoryRoot: "C:\\repo", session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered"], status: "unknown", workspaceRoot: "C:\\repo", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "vscode", metadata: {} } });
  assert.deepEqual(session.capabilities, ["registered", "observable", "controllable", "mediated"]);
  assert.equal(session.targetSnapshotId, targetId);
  assert.equal(session.taskId, "task-1");
  assert.equal(resolutions, 2);
});

test("provider handshake refuses capability installation when target churns", async () => {
  const ids = ["a".repeat(64), "f".repeat(64)];
  let index = 0;
  const coordinator = new AttestedProviderHandshakeCoordinator(
    { handshakeCapabilityCeiling() { return ["registered", "observable", "controllable", "mediated"] as const; }, async request() { return { outcome: "passed", routeId: "provider.handshake.codex", detail: "ok", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.provider-handshake", version: 1, sessionId: "session-1", provider: "codex", targetSnapshotId: ids[0], repositoryRoot: "C:\\repo", capabilities: ["registered", "observable"], status: "running", adapterVersion: "adapter", plannedFiles: [], resources: [], dependencies: [], diffDigest: "e".repeat(64) })) }; } } as unknown as DynamicConfiguredNetworkClient,
    { async resolve() { const id = ids[Math.min(index++, 1)]!; return { id, repositoryRoot: "C:\\repo", trackedManifest: "c".repeat(64), untrackedManifest: "d".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "e".repeat(64), capturedAt: "2026-08-24T00:00:00.000Z", completeness: "complete" as const, reasons: [] }; } },
    { async verify() { return { verified: true, operator: "operator" }; } }
  );
  await assert.rejects(() => coordinator.handshake({ repositoryRoot: "C:\\repo", session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered"], status: "unknown", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "vscode", metadata: {} } }), /changed during provider handshake/);
});

test("provider handshake cannot self-assert Mediated beyond its host-derived route ceiling", async () => {
  const targetId = "a".repeat(64);
  const target = { id: targetId, repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40), trackedManifest: "c".repeat(64), untrackedManifest: "d".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "e".repeat(64), capturedAt: "2026-08-24T00:00:00.000Z", completeness: "complete", reasons: [] } as const;
  const coordinator = new AttestedProviderHandshakeCoordinator(
    {
      handshakeCapabilityCeiling() { return ["registered", "observable", "controllable"] as const; },
      async request() { return { outcome: "passed", routeId: "provider.handshake.codex", detail: "untrusted external claim", effectDisposition: "not_started" as const, body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.provider-handshake", version: 1, sessionId: "session-1", provider: "codex", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", adapterVersion: "external-adapter", plannedFiles: [], resources: [], dependencies: [], diffDigest: "f".repeat(64) })) }; }
    },
    { async resolve() { return target; } },
    { async verify() { return { verified: true, operator: "operator" }; } }
  );
  await assert.rejects(() => coordinator.handshake({ repositoryRoot: "C:\\repo", session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered"], status: "unknown", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "vscode", metadata: {} } }), /host-derived transport boundary/i);
});

test("configured automation creates one observable child saga and records the gateway recovery identity", async () => {
  const childEvents: Array<readonly [string, unknown]> = [];
  const transport = {
    recoveryExternalId(input: { operationId: string; provider: string }) {
      assert.equal(input.provider, "codex");
      return input.operationId;
    },
    async request(input: { routeId: string; body?: string }) {
      assert.equal(input.routeId, "automation.repair_mission");
      const document = JSON.parse(input.body!) as Record<string, unknown>;
      assert.equal(document.schema, automationRequestSchema("repair_mission"));
      assert.equal(document.action, "repair_mission");
      assert.deepEqual(document.intent, {
        kind: "repair_mission",
        reproduceBeforeModify: true,
        approvedScope: "exact_target_snapshot",
        testEnvironment: { id: "repair-test-environment", egress: "deny", databaseName: "b122_repair_test" },
        pushAuthorized: false,
        mergeAuthorized: false,
        deployAuthorized: false,
        hostedRerunAuthorized: false,
        productionDataAuthorized: false,
        confirmation: { digest: "9".repeat(64), scopeDigest: "8".repeat(64) }
      });
      return {
        outcome: "passed" as const,
        routeId: input.routeId,
        detail: "local gateway",
        effectDisposition: "ambiguous" as const,
        body: Buffer.from(JSON.stringify({
          schema: automationResultSchema("repair_mission"),
          version: 1,
          action: "repair_mission",
          status: "completed",
          summary: "Repair completed in the deterministic provider.",
          effectDisposition: "committed",
          externalId: "automation-operation-1",
          result: {
            kind: "repair_mission",
            reproduction: { commandDigest: "1".repeat(64), status: "reproduced", logsDigest: "2".repeat(64) },
            approvedScopeDigest: "3".repeat(64),
            diffDigest: "4".repeat(64),
            affectedChecks: ["test:affected"],
            fullChecks: ["test:full"],
            risks: [],
            nextAction: "Review the bounded repair diff.",
            pushAttempted: false,
            mergeAttempted: false,
            deployAttempted: false,
            hostedRerunAttempted: false,
            productionDataUsed: false
          }
        }))
      };
    }
  };
  const childSaga = {
    async begin(input: unknown) { childEvents.push(["begin", input]); return { operationId: "child-automation-1", mayExecute: true }; },
    async markExecuting(input: unknown) { childEvents.push(["executing", input]); },
    async markExternalCommitted(_input: unknown, details: unknown) { childEvents.push(["external", details]); },
    async markCancelling(input: unknown) { childEvents.push(["cancelling", input]); },
    async markCompensating(input: unknown) { childEvents.push(["compensating", input]); },
    async settle(_input: unknown, outcome: unknown, details: unknown) { childEvents.push([String(outcome), details]); }
  };
  const broker = createConfiguredAutomationBroker(
    { verifyPermit() { return true; } },
    { check() { return { allowed: true, reason: "clear" }; } },
    transport as never
  );
  const outcome = await broker.execute({
    action: "repair_mission",
    operationId: "automation-operation-1",
    target: { id: providerTargetId, repositoryRoot: "C:\\repo", policyVersion: "v1" } as never,
    session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "v1", metadata: {} },
    authority: { id: "authority-repair", sessionId: "session-1" } as never,
    permit: {} as never,
    confirmation: { currentUserConfirmed: true, confirmationDigest: "9".repeat(64), confirmationScopeDigest: "8".repeat(64), action: "repair_mission", targetSnapshotId: providerTargetId, sessionId: "session-1", authorityId: "authority-repair" },
    testEnvironment: { id: "repair-test-environment", tempRoot: "C:\\b122-tests\\repair-test-environment", egress: "deny", databaseName: "b122_repair_test", environment: {} },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    childSaga: childSaga as never
  });
  assert.equal(outcome.status, "completed");
  const begun = childEvents.find(([kind]) => kind === "begin")?.[1] as { action: string; details: Record<string, string> };
  assert.equal(begun.action, "automation.repair_mission");
  assert.equal(begun.details.externalId, "automation-operation-1");
  assert.equal(childEvents.some(([kind]) => kind === "external"), true);
  assert.equal(childEvents.some(([kind]) => kind === "completed"), true);
});

test("configured automation records a committed child but refuses success after post-effect target churn", async () => {
  const childEvents: string[] = [];
  let guardChecks = 0;
  const broker = createConfiguredAutomationBroker(
    { verifyPermit() { return true; } },
    { check() { return { allowed: true, reason: "clear" }; } },
    { async request(input) { return { outcome: "passed", routeId: input.routeId, detail: "ok", effectDisposition: "ambiguous", body: Buffer.from(JSON.stringify({ schema: automationResultSchema("compound_capture"), version: 1, action: "compound_capture", status: "completed", summary: "Remote automation committed.", effectDisposition: "committed", externalId: "automation-post-effect", result: { kind: "compound_capture", captureId: "capture:automation-post-effect", learningDigest: "5".repeat(64), verifiedProblemDigest: "6".repeat(64), documents: ["docs/solutions/repair.md"] } })) }; } }
  );
  const outcome = await broker.execute({
    action: "compound_capture", operationId: "automation-post-effect", target: { id: providerTargetId, repositoryRoot: "C:\\repo", policyVersion: "v1" } as never,
    session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "v1", metadata: {} },
    authority: { id: "authority-capture", sessionId: "session-1" } as never,
    permit: {} as never,
    effectGuard: { async assertCurrent() { guardChecks += 1; return guardChecks < 4 ? { allowed: true, reason: "current" } : { allowed: false, reason: "target changed after automation effect" }; } },
    childSaga: {
      async begin() { return { operationId: "child-automation-post-effect", mayExecute: true }; },
      async markExecuting() { childEvents.push("executing"); },
      async markExternalCommitted() { childEvents.push("external"); },
      async markCancelling() { childEvents.push("cancelling"); },
      async markCompensating() { childEvents.push("compensating"); },
      async settle(_child: unknown, state: string) { childEvents.push(state); }
    } as never
  });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.effectDisposition, "committed");
  assert.deepEqual(childEvents, ["executing", "external", "ambiguous"]);
});

test("configured provider routing aborts when durable cancellation polling fails", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    let checks = 0;
    let transportAborted = false;
    const adapter = new ConfiguredProviderCommandAdapter({
      async request(input: { routeId: string; signal?: AbortSignal }) {
        assert.ok(input.signal);
        return new Promise<{
          outcome: "blocked";
          routeId: string;
          detail: string;
          effectDisposition: "not_started";
        }>((resolve) => {
          const finish = (): void => {
            transportAborted = true;
            resolve({ outcome: "blocked", routeId: input.routeId, detail: "cancelled", effectDisposition: "not_started" });
          };
          if (input.signal!.aborted) finish();
          else input.signal!.addEventListener("abort", finish, { once: true });
        });
      }
    } as unknown as DynamicConfiguredNetworkClient, {
      async claimForDispatch() { return proofArtifact(); },
      async assertDispatchBinding() { return proofArtifact(); },
      async acknowledge() { throw new Error("an aborted transport must not acknowledge"); }
    });
    const startedAt = Date.now();
    const request = {
      ...(providerRequest() as unknown as Record<string, unknown>),
      executionControl: {
        deadline: new Date(Date.now() + 2_000).toISOString(),
        async isCancellationRequested() {
          checks += 1;
          if (checks === 1) return false;
          throw new Error("protected cancellation ledger unavailable");
        }
      }
    } as unknown as AdapterRequest;
    const outcome = await adapter.execute(request);
    assert.equal(outcome.status, "blocked");
    assert.equal(transportAborted, true);
    assert.ok(Date.now() - startedAt < 700, "provider transport waited for its route deadline after cancellation polling failed");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("configured provider routing bounds a never-settling initial cancellation read", async () => {
  let checks = 0;
  let requests = 0;
  const adapter = new ConfiguredProviderCommandAdapter({
    async request() { requests += 1; throw new Error("transport must not start while cancellation state is unresolved"); }
  } as unknown as DynamicConfiguredNetworkClient, {
    async claimForDispatch() { return proofArtifact(); },
    async assertDispatchBinding() { return proofArtifact(); },
    async acknowledge() { throw new Error("must not acknowledge"); }
  });
  const startedAt = Date.now();
  const outcome = await adapter.execute({
    ...(providerRequest() as unknown as Record<string, unknown>),
    executionControl: {
      operationId: "operation-1",
      deadline: new Date(Date.now() + 180).toISOString(),
      async isCancellationRequested() { checks += 1; return new Promise<boolean>(() => undefined); }
    }
  } as unknown as AdapterRequest);
  assert.equal(outcome.status, "cancelled");
  assert.equal(checks, 1);
  assert.equal(requests, 0);
  assert.ok(Date.now() - startedAt < 700, "initial cancellation state outlived the durable deadline");
});
