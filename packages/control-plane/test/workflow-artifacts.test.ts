import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import type { AuthorityGrant, ManagedSession } from "../src/contracts.ts";
import { HandoffPackageStore } from "../src/context-packages.ts";
import { ProtectedJsonStore, sha256, stableJson } from "../src/store.ts";
import {
  DurableWorkflowPreparationCoordinator,
  planApprovalReviewScopeDigest,
  WorkflowArtifactStore,
  WorkflowCoordinatorContextStore,
  parseWorkflowProviderResponse,
  type CoordinatorEvidenceBundle,
  type ExistingPlanBinding,
  type WorkflowArtifact,
  type WorkflowArtifactInput,
  type WorkflowArtifactPayload
} from "../src/workflow-artifacts.ts";

async function store(context: TestContext): Promise<ProtectedJsonStore> {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-workflow-artifacts-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  return new ProtectedJsonStore({ filePath: join(folder, "journal.jsonl") });
}

function existingPlan(): ExistingPlanBinding {
  const material = {
    revision: "plan-7", originSessionId: "planner-session", taskId: "task-1", objective: "Finish the reviewed integration",
    steps: [{ id: "step-1", summary: "Implement exact route", ownedFiles: ["src/safe.ts"], dependencies: [], status: "approved" as const }],
    decisions: ["Use typed authenticated IPC."]
  };
  return { digest: sha256(stableJson(material)), ...material };
}

function evidence(): CoordinatorEvidenceBundle {
  const plan = existingPlan();
  const material = {
    instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context" as const, summary: "Original accepted instructions." }],
    plan,
    documentation: [{ id: "spec", digest: "2".repeat(64), source: "repository" as const, summary: "Accepted B122 specification." }],
    diff: { id: "diff", digest: "3".repeat(64), source: "target_snapshot" as const, summary: "Current exact Git diff." },
    files: [{ id: "src-safe", digest: "4".repeat(64), source: "repository" as const, summary: "Changed and relevant file evidence." }],
    tests: [{ id: "test-receipt", digest: "5".repeat(64), source: "receipt" as const, summary: "Isolated test receipt.", status: "passed" as const }]
  };
  return { contextDigest: sha256(stableJson(material)), ...material };
}

function base(action: WorkflowArtifactInput["action"], payload: WorkflowArtifactPayload): WorkflowArtifactInput {
  return { id: `artifact-${action}`, action, repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), sessionId: "session-1", taskId: "task-1", planRevision: "plan-7", payload };
}

function decisionPayload(mode: "one" | "packet" = "one"): Extract<WorkflowArtifactPayload, { kind: "decision" }> {
  const decisions = mode === "one"
    ? [{ id: "decision-1", question: "Which safe integration should we ship?", context: "Choose for the exact reviewed target." }]
    : [{ id: "decision-1", question: "Which safe integration?", context: "Exact target." }, { id: "decision-2", question: "Which rollout?", context: "Same reviewed plan." }];
  return { kind: "decision", mode, decisions, evidence: evidence(), providerMayChoose: false };
}

function submittedResponse(artifact: WorkflowArtifact, result: unknown) {
  return {
    schema: "sxsy-b122.workflow-result", version: 1, artifactId: artifact.id, artifactDigest: artifact.digest,
    operationId: artifact.operationId, action: artifact.action, status: "completed", effectDisposition: "committed",
    summary: "The exact workflow completed.", externalId: `external-${artifact.id}`, result
  };
}

test("Option Provider sends only one user question and requires exactly five provider options plus one recommendation", async (context) => {
  const protectedStore = await store(context);
  const artifacts = new WorkflowArtifactStore(protectedStore);
  const created = await artifacts.create(base("option_provider", decisionPayload()));
  const submitted = await artifacts.claimForDispatch({ action: "option_provider", targetSnapshotId: created.targetSnapshotId, sessionId: created.sessionId, operationId: "operation-1" });
  assert.ok(submitted);
  const options = Array.from({ length: 5 }, (_, index) => ({ id: `option-${index + 1}`, label: `Option ${index + 1}`, tradeoffs: [`tradeoff-${index + 1}`], risks: [`risk-${index + 1}`] }));
  const result = { kind: "decision", decisionPacketId: "packet-1", decisions: [{ decisionId: "decision-1", options, recommendationId: "option-2" }], userSelectionRequired: true };
  const response = parseWorkflowProviderResponse(submittedResponse(submitted, result), submitted);
  assert.equal(response.result.kind, "decision");
  const acknowledged = await artifacts.acknowledge(response);
  assert.deepEqual(acknowledged.providerResult, result);
  assert.equal(acknowledged.providerSummary, "The exact workflow completed.");
  const afterRestart = await new WorkflowArtifactStore(protectedStore).get(acknowledged.id);
  assert.deepEqual(afterRestart?.providerResult, result, "the substantive provider answer must survive restart");
  assert.throws(() => parseWorkflowProviderResponse(submittedResponse(submitted, { ...result, decisions: [{ ...result.decisions[0], options: options.slice(0, 4) }] }), submitted), /exactly five/i);
  assert.throws(() => parseWorkflowProviderResponse(submittedResponse(submitted, { ...result, userSelectionRequired: false }), submitted), /invalid/i);
  await assert.rejects(() => artifacts.create(base("option_packet", { ...decisionPayload("one"), mode: "packet" })), /multi-decision/i);
});

test("prepared workflow artifacts bind exact authority and monotonic coordinator context and remain explicitly cancellable after churn", async (context) => {
  const journal = await store(context);
  const contexts = new WorkflowCoordinatorContextStore(journal, { clock: () => "2026-08-24T12:00:00.000Z" });
  const artifacts = new WorkflowArtifactStore(journal, { clock: () => "2026-08-24T12:00:01.000Z" });
  const context1 = await contexts.record({
    sessionId: "session-1", repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), authorityId: "authority-1", sourceRevision: 1,
    evidence: evidence(), pendingDecisions: [{ id: "decision-1", question: "First?", context: "Exact target." }]
  });
  const created = await artifacts.create({
    ...base("option_provider", decisionPayload()), authorityId: "authority-1",
    coordinatorContextDigest: context1.digest, coordinatorContextRevision: context1.sourceRevision
  });
  await assert.rejects(() => artifacts.create({
    ...base("option_provider", { ...decisionPayload(), decisions: [{ id: "decision-2", question: "Replacement?", context: "Changed." }] }),
    id: "artifact-replacement", authorityId: "authority-1", coordinatorContextDigest: context1.digest, coordinatorContextRevision: 1
  }), /cancel it explicitly/i);
  assert.equal(await artifacts.claimForDispatch({ action: created.action, targetSnapshotId: created.targetSnapshotId, sessionId: created.sessionId, operationId: "wrong-authority-op", authorityId: "authority-other" }), undefined);

  await assert.rejects(() => contexts.record({
    sessionId: "session-1", repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), authorityId: "authority-1", sourceRevision: 1,
    evidence: evidence(), pendingDecisions: [{ id: "decision-changed", question: "Drift?", context: "Same revision." }]
  }), /without a monotonic (?:provider )?source revision/i);
  const context2 = await contexts.record({
    sessionId: "session-1", repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), authorityId: "authority-1", sourceRevision: 2,
    evidence: evidence(), pendingDecisions: [{ id: "decision-2", question: "Replacement?", context: "New provider revision." }]
  });
  await assert.rejects(() => contexts.record({
    sessionId: "session-1", repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), authorityId: "authority-1", sourceRevision: 1,
    evidence: evidence(), pendingDecisions: []
  }), /cannot roll back/i);
  await assert.rejects(() => artifacts.claimForDispatch({ action: created.action, targetSnapshotId: created.targetSnapshotId, sessionId: created.sessionId, operationId: "stale-op", authorityId: "authority-1" }), /stale/i);
  await assert.rejects(() => artifacts.cancelPrepared({ artifactId: created.id, sessionId: created.sessionId, authorityId: "authority-other" }), /exact session and authority/i);
  assert.equal((await artifacts.cancelPrepared({ artifactId: created.id, sessionId: created.sessionId, authorityId: "authority-1" })).status, "cancelled");

  const replacement = await artifacts.create({
    ...base("option_provider", { ...decisionPayload(), decisions: [{ id: "decision-2", question: "Replacement?", context: "New provider revision." }] }),
    id: "artifact-replacement", authorityId: "authority-1", coordinatorContextDigest: context2.digest, coordinatorContextRevision: context2.sourceRevision
  });
  const submitted = await artifacts.claimForDispatch({ action: replacement.action, targetSnapshotId: replacement.targetSnapshotId, sessionId: replacement.sessionId, operationId: "current-op", authorityId: "authority-1" });
  assert.equal(submitted?.id, replacement.id);
  assert.equal((await artifacts.assertDispatchBinding({ artifactId: replacement.id, artifactDigest: replacement.digest, action: replacement.action, targetSnapshotId: replacement.targetSnapshotId, sessionId: replacement.sessionId, operationId: "current-op", authorityId: "authority-1" })).id, replacement.id);
  await contexts.record({
    sessionId: "session-1", repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), authorityId: "authority-1", sourceRevision: 3,
    evidence: evidence(), pendingDecisions: [{ id: "decision-3", question: "Newest?", context: "Final provider revision." }]
  });
  await assert.rejects(() => artifacts.assertDispatchBinding({ artifactId: replacement.id, artifactDigest: replacement.digest, action: replacement.action, targetSnapshotId: replacement.targetSnapshotId, sessionId: replacement.sessionId, operationId: "current-op", authorityId: "authority-1" }), /context|changed/i);
});

test("voice binding artifacts preserve exact ChatGPT and system provider identities", async (context) => {
  const protectedStore = await store(context);
  const artifacts = new WorkflowArtifactStore(protectedStore);
  const chatgpt = await artifacts.create(base("bind_voice_session", {
    kind: "voice_binding", voiceSessionId: "voice-chatgpt", provider: "chatgpt", contextPackageId: "handoff-1", consentId: "consent-chatgpt"
  }));
  const system = await artifacts.create({ ...base("bind_voice_session", {
    kind: "voice_binding", voiceSessionId: "voice-system", provider: "system", contextPackageId: "handoff-1", consentId: "consent-system"
  }), id: "artifact-bind-voice-system", sessionId: "session-2" });
  assert.equal(chatgpt.payload.kind === "voice_binding" ? chatgpt.payload.provider : undefined, "chatgpt");
  assert.equal(system.payload.kind === "voice_binding" ? system.payload.provider : undefined, "system");
  assert.equal((await new WorkflowArtifactStore(protectedStore).get(chatgpt.id))?.payload.kind === "voice_binding"
    ? ((await new WorkflowArtifactStore(protectedStore).get(chatgpt.id))!.payload as Extract<WorkflowArtifactPayload, { kind: "voice_binding" }>).provider
    : undefined, "chatgpt");
  await assert.rejects(() => artifacts.create({ ...base("bind_voice_session", {
    kind: "voice_binding", voiceSessionId: "voice-fallback", provider: "generic", contextPackageId: "handoff-1", consentId: "consent-fallback"
  } as unknown as WorkflowArtifactPayload), id: "artifact-bind-voice-fallback" }), /voice provider/i);
});

test("Plan Expander accepts exactly fifteen unique ordered alternatives for the bound existing plan", async (context) => {
  const artifacts = new WorkflowArtifactStore(await store(context));
  const created = await artifacts.create(base("plan_expander", { kind: "plan", mode: "expand", plan: existingPlan(), evidence: evidence() }));
  const submitted = await artifacts.claimForDispatch({ action: created.action, targetSnapshotId: created.targetSnapshotId, sessionId: created.sessionId, operationId: "operation-expand" });
  assert.ok(submitted);
  const alternatives = Array.from({ length: 15 }, (_, index) => ({ rank: index + 1, id: `alternative-${index + 1}`, summary: `Approach ${index + 1}`, rationale: `Rationale ${index + 1}`, risks: [] }));
  const result = { kind: "plan", mode: "expanded", planDigest: existingPlan().digest, alternatives };
  parseWorkflowProviderResponse(submittedResponse(submitted, result), submitted);
  assert.throws(() => parseWorkflowProviderResponse(submittedResponse(submitted, { ...result, alternatives: alternatives.slice(0, 14) }), submitted), /invalid/i);
  assert.throws(() => parseWorkflowProviderResponse(submittedResponse(submitted, { ...result, alternatives: alternatives.map((entry, index) => index === 1 ? { ...entry, rank: 1 } : entry) }), submitted), /fifteen|ranked/i);
});

test("Plan Approval binds the immutable originating plan, current session, authority and confirmation and acknowledges execution once", async (context) => {
  const artifacts = new WorkflowArtifactStore(await store(context));
  const payload = { kind: "plan" as const, mode: "approve" as const, plan: existingPlan(), executorSessionId: "session-1", authorityId: "authority-1", confirmationDigest: "c".repeat(64), confirmationScopeDigest: "d".repeat(64), providerContextDigest: "e".repeat(64), executeOnce: true as const };
  const created = await artifacts.create(base("plan_approval", payload));
  await assert.rejects(() => artifacts.create({ ...base("plan_approval", { ...payload, executorSessionId: "other-session" }), id: "wrong-executor" }), /selected executor session/i);
  const { digest: _digest, ...planMaterial } = existingPlan();
  const proposedMaterial = { ...planMaterial, steps: planMaterial.steps.map((step) => ({ ...step, status: "proposed" as const })) };
  const proposedPlan = { ...proposedMaterial, digest: sha256(stableJson(proposedMaterial)) };
  await assert.rejects(() => artifacts.create({ ...base("plan_approval", { ...payload, plan: proposedPlan }), id: "unapproved-plan" }), /approved plan steps/i);
  const submitted = await artifacts.claimForDispatch({ action: created.action, targetSnapshotId: created.targetSnapshotId, sessionId: created.sessionId, operationId: "operation-plan" });
  assert.ok(submitted);
  const result = { kind: "plan", mode: "execution_ack", planDigest: payload.plan.digest, planRevision: payload.plan.revision, originSessionId: payload.plan.originSessionId, executorSessionId: payload.executorSessionId, authorityId: payload.authorityId, acknowledgementId: "ack-plan-1", executionStarted: true };
  const response = parseWorkflowProviderResponse(submittedResponse(submitted, result), submitted);
  assert.equal(response.result.kind === "plan" && response.result.mode === "execution_ack" ? response.result.originSessionId : undefined, "planner-session");
  const acknowledged = await artifacts.acknowledge(response);
  assert.equal(acknowledged.status, "acknowledged");
  assert.deepEqual(acknowledged.providerResult, result);
  assert.deepEqual((await artifacts.acknowledge(response)).providerResult, result);
  assert.equal((await artifacts.claimForDispatch({ action: created.action, targetSnapshotId: created.targetSnapshotId, sessionId: created.sessionId, operationId: "operation-plan-2" })), undefined);
});

test("Re-anchor and Proof carry coordinator-owned plan, docs, diff, files and classified tests and never auto-resume", async (context) => {
  const artifacts = new WorkflowArtifactStore(await store(context));
  const anchor = await artifacts.create(base("reanchor", { kind: "anchor", evidence: evidence(), cooperativeStopRequested: true, resumeAuthorized: false, unresolved: [] }));
  assert.equal((anchor.payload as { resumeAuthorized: boolean }).resumeAuthorized, false);
  await assert.rejects(() => artifacts.create({ ...base("reanchor", { kind: "anchor", evidence: evidence(), cooperativeStopRequested: true, resumeAuthorized: true as false, unresolved: [] }), id: "bad-anchor" }), /resume/i);
  const adversarial = await artifacts.create(base("proof_adversarial", { kind: "proof", evidence: evidence(), claims: ["Exact plan is satisfied."], requiredBackends: ["codex", "claude"], independentBackendRequired: true }));
  await assert.rejects(() => artifacts.create({ ...base("proof_adversarial", { kind: "proof", evidence: evidence(), claims: ["claim"], requiredBackends: ["codex"], independentBackendRequired: false }), id: "bad-proof" }), /independent/i);
  const submitted = await artifacts.claimForDispatch({ action: adversarial.action, targetSnapshotId: adversarial.targetSnapshotId, sessionId: adversarial.sessionId, operationId: "operation-adversarial" });
  assert.ok(submitted);
  assert.throws(() => parseWorkflowProviderResponse(submittedResponse(submitted, { kind: "proof", verifiedClaims: [], evidenceReferences: [], backendResults: [{ backend: "codex", status: "passed" }] }), submitted), /required backend/i);
});

test("durable coordinator generates option requests, cycles verified queues, and replays only an exactly matching pending authority request", async (context) => {
  const journal = await store(context);
  const contexts = new WorkflowCoordinatorContextStore(journal, { clock: () => "2026-08-24T12:00:00.000Z" });
  const source = managedSession("session-1", "running");
  const blocked1 = managedSession("blocked-1", "verified_blocked");
  const blocked2 = managedSession("blocked-2", "verified_blocked");
  const authority = authorityGrant("authority-1", "session-1", ["option_provider", "focus_blocked_agent", "authority_refresh", "plan_approval"]);
  const provenance = { provider: "codex" as const, contextId: "context-1", observedAt: "2026-08-24T12:00:00.000Z", adapterId: "provider-context", adapterVersion: "1.0.0", moduleSha256: "6".repeat(64), providerContextDigest: "7".repeat(64), envelopeDigest: "8".repeat(64) };
  await contexts.record({ sessionId: source.id, repositoryRoot: source.workspaceRoot!, targetSnapshotId: source.targetSnapshotId!, authorityId: authority.id, sourceRevision: 1, provenance, evidence: evidence(), pendingDecisions: [{ id: "pending-1", question: "Decision one?", context: "Context one." }, { id: "pending-2", question: "Decision two?", context: "Context two." }], pendingRequest: { requestId: "request-1", targetSnapshotId: source.targetSnapshotId!, planRevision: "plan-7", planDigest: existingPlan().digest, action: "option_provider" } });
  const sessions = new Map([source, blocked1, blocked2].map((session) => [session.id, session]));
  const coordinator = new DurableWorkflowPreparationCoordinator(contexts, { list: async () => [...sessions.values()], get: async (id) => sessions.get(id) }, { get: async (id) => id === authority.id ? authority : undefined });
  const decision = (await coordinator.prepare({ action: "option_provider", session: source, authorityId: authority.id, intent: { kind: "decision", question: "User question?", context: "User context only." } })).payload;
  assert.deepEqual(Object.keys((decision as Extract<WorkflowArtifactPayload, { kind: "decision" }>).decisions[0]!).sort(), ["context", "id", "question"]);
  const scope = planApprovalReviewScopeDigest({ sessionId: source.id, targetSnapshotId: source.targetSnapshotId!, repositoryRoot: source.workspaceRoot!, taskId: existingPlan().taskId, planRevision: existingPlan().revision, planDigest: existingPlan().digest, originSessionId: existingPlan().originSessionId, providerContextDigest: provenance.providerContextDigest, sourceRevision: 1 });
  await assert.rejects(() => coordinator.prepare({ action: "plan_approval", session: source, authorityId: authority.id, intent: { kind: "plan_approval", confirmationToken: "confirmation-1", confirmationScopeDigest: "9".repeat(64) } }), /exact protected plan/i);
  const approval = (await coordinator.prepare({ action: "plan_approval", session: source, authorityId: authority.id, intent: { kind: "plan_approval", confirmationToken: "confirmation-1", confirmationScopeDigest: scope } })).payload as Extract<WorkflowArtifactPayload, { kind: "plan"; mode: "approve" }>;
  assert.equal(approval.confirmationScopeDigest, scope);
  assert.equal(approval.confirmationDigest, sha256("confirmation-1"));
  const first = (await coordinator.prepare({ action: "focus_blocked_agent", session: source, authorityId: authority.id, intent: { kind: "none" } })).payload as Extract<WorkflowArtifactPayload, { kind: "focus" }>;
  sessions.set(blocked1.id, { ...blocked1, lastHeartbeat: "2026-08-24T12:00:01.000Z" });
  sessions.set(blocked2.id, { ...blocked2, lastHeartbeat: "2026-08-24T12:00:01.000Z" });
  const second = (await coordinator.prepare({ action: "focus_blocked_agent", session: source, authorityId: authority.id, intent: { kind: "none" } })).payload as Extract<WorkflowArtifactPayload, { kind: "focus" }>;
  assert.notEqual(first.selectedSessionId, second.selectedSessionId);
  const refresh = (await coordinator.prepare({ action: "authority_refresh", session: source, authorityId: authority.id, intent: { kind: "none" } })).payload as Extract<WorkflowArtifactPayload, { kind: "authority" }>;
  assert.equal(refresh.packets[0]?.pendingRequest.action, "option_provider");
  assert.match(refresh.packets[0]!.matchDigest, /^[a-f0-9]{64}$/);
});

test("Authority broadcast uses each recipient's protected pending request and requires exact individualized acknowledgements", async (context) => {
  const journal = await store(context);
  const contexts = new WorkflowCoordinatorContextStore(journal, { clock: () => "2026-08-24T12:00:00.000Z" });
  const source = managedSession("session-1", "running");
  const recipients = [managedSession("recipient-1", "running"), managedSession("recipient-2", "verified_blocked")];
  const sourceAuthority = authorityGrant("authority-broadcast", source.id, ["authority_broadcast"]);
  const recipientAuthorities = recipients.map((recipient, index) => authorityGrant(`authority-recipient-${index + 1}`, recipient.id, ["proof"]));
  await contexts.record({ sessionId: source.id, repositoryRoot: source.workspaceRoot!, targetSnapshotId: source.targetSnapshotId!, authorityId: sourceAuthority.id, sourceRevision: 1, evidence: evidence(), pendingDecisions: [] });
  for (let index = 0; index < recipients.length; index += 1) {
    const recipient = recipients[index]!;
    const authority = recipientAuthorities[index]!;
    await contexts.record({
      sessionId: recipient.id, repositoryRoot: recipient.workspaceRoot!, targetSnapshotId: recipient.targetSnapshotId!, authorityId: authority.id, sourceRevision: 1, evidence: evidence(), pendingDecisions: [],
      pendingRequest: { requestId: `pending-${index + 1}`, targetSnapshotId: recipient.targetSnapshotId!, planRevision: "plan-7", planDigest: existingPlan().digest, action: "proof" }
    });
  }
  const sessionMap = new Map([source, ...recipients].map((session) => [session.id, session]));
  const authorityMap = new Map([sourceAuthority, ...recipientAuthorities].map((authority) => [authority.id, authority]));
  const coordinator = new DurableWorkflowPreparationCoordinator(contexts, { list: async () => [...sessionMap.values()], get: async (id) => sessionMap.get(id) }, { get: async (id) => authorityMap.get(id) });
  const payload = (await coordinator.prepare({ action: "authority_broadcast", session: source, authorityId: sourceAuthority.id, intent: { kind: "authority_broadcast", recipientSessionIds: recipients.map((recipient) => recipient.id) } })).payload as Extract<WorkflowArtifactPayload, { kind: "authority" }>;
  assert.deepEqual(payload.packets.map((packet) => ({ recipient: packet.recipientSessionId, grant: packet.grantId, action: packet.pendingRequest.action })), [
    { recipient: "recipient-1", grant: "authority-recipient-1", action: "proof" },
    { recipient: "recipient-2", grant: "authority-recipient-2", action: "proof" }
  ]);

  const artifacts = new WorkflowArtifactStore(journal);
  const created = await artifacts.create(base("authority_broadcast", payload));
  const submitted = await artifacts.claimForDispatch({ action: created.action, targetSnapshotId: created.targetSnapshotId, sessionId: created.sessionId, operationId: "operation-authority" });
  assert.ok(submitted);
  const acknowledgements = payload.packets.map((packet) => ({ recipientSessionId: packet.recipientSessionId, grantId: packet.grantId, matchDigest: packet.matchDigest, acknowledged: true }));
  parseWorkflowProviderResponse(submittedResponse(submitted, { kind: "authority", acknowledgements }), submitted);
  assert.throws(() => parseWorkflowProviderResponse(submittedResponse(submitted, { kind: "authority", acknowledgements: [{ ...acknowledgements[0], matchDigest: "f".repeat(64) }, acknowledgements[1]] }), submitted), /exact binding/i);
});

test("Handoff packages are coordinator-assembled and preserve exact source, recipient, target, plan, and authority bindings", async (context) => {
  const journal = await store(context);
  const contexts = new WorkflowCoordinatorContextStore(journal, { clock: () => "2026-08-24T12:00:00.000Z" });
  const handoffs = new HandoffPackageStore(journal, { clock: () => "2026-08-24T12:00:01.000Z", idFactory: (() => { let index = 0; return () => `handoff-${++index}`; })() });
  const source = managedSession("session-1", "running");
  const recipient = managedSession("recipient-1", "running");
  const authority = authorityGrant("authority-handoff", source.id, ["handoff", "handoff_queue", "handoff_immediate"]);
  await contexts.record({ sessionId: source.id, repositoryRoot: source.workspaceRoot!, targetSnapshotId: source.targetSnapshotId!, authorityId: authority.id, sourceRevision: 1, evidence: evidence(), pendingDecisions: [{ id: "pending-1", question: "Which migration window?", context: "Exact target only." }] });
  const sessions = new Map([source, recipient].map((session) => [session.id, session]));
  const coordinator = new DurableWorkflowPreparationCoordinator(contexts, { list: async () => [...sessions.values()], get: async (id) => sessions.get(id) }, { get: async (id) => id === authority.id ? authority : undefined }, handoffs);

  const normalQueued = (await coordinator.prepare({ action: "handoff", session: source, authorityId: authority.id, intent: { kind: "handoff", recipientSessionId: recipient.id, route: "default" } })).payload as Extract<WorkflowArtifactPayload, { kind: "handoff" }>;
  await handoffs.setRoutingDefault("immediate");
  const normalImmediate = (await coordinator.prepare({ action: "handoff", session: source, authorityId: authority.id, intent: { kind: "handoff", recipientSessionId: recipient.id, route: "default" } })).payload as Extract<WorkflowArtifactPayload, { kind: "handoff" }>;
  const immediate = (await coordinator.prepare({ action: "handoff_immediate", session: source, authorityId: authority.id, intent: { kind: "handoff", recipientSessionId: recipient.id, route: "immediate" } })).payload as Extract<WorkflowArtifactPayload, { kind: "handoff" }>;
  const queued = (await coordinator.prepare({ action: "handoff_queue", session: source, authorityId: authority.id, intent: { kind: "handoff", recipientSessionId: recipient.id, route: "queue" } })).payload as Extract<WorkflowArtifactPayload, { kind: "handoff" }>;

  assert.deepEqual([normalQueued.route, normalImmediate.route, immediate.route, queued.route], ["queue", "immediate", "immediate", "queue"]);
  for (const payload of [normalQueued, normalImmediate, immediate, queued]) {
    assert.deepEqual({ source: payload.sourceSessionId, recipient: payload.recipientSessionId, authority: payload.authorityId }, { source: source.id, recipient: recipient.id, authority: authority.id });
    const packet = await handoffs.get(payload.packageId);
    assert.ok(packet);
    assert.equal(packet.planRevision, existingPlan().revision);
    assert.equal(packet.plan, stableJson(existingPlan()));
    assert.equal(packet.references.some((reference) => reference.includes(evidence().diff.digest)), true);
  }
  sessions.set(recipient.id, { ...recipient, status: "stale" });
  await assert.rejects(() => coordinator.prepare({ action: "handoff", session: source, authorityId: authority.id, intent: { kind: "handoff", recipientSessionId: recipient.id, route: "default" } }), /current registered session/i);
});

test("provider response remains exact, external-ID bound, and cancellation is durable", async (context) => {
  const artifacts = new WorkflowArtifactStore(await store(context), { clock: () => "2026-08-24T12:00:00.000Z" });
  const prepared = await artifacts.create(base("proof", { kind: "proof", evidence: evidence(), claims: ["claim"], requiredBackends: ["codex"], independentBackendRequired: false }));
  const submitted = await artifacts.claimForDispatch({ action: "proof", targetSnapshotId: prepared.targetSnapshotId, sessionId: prepared.sessionId, operationId: "operation-proof" });
  assert.ok(submitted);
  const result = { kind: "proof", verifiedClaims: ["claim"], evidenceReferences: ["receipt:1"], backendResults: [{ backend: "codex", status: "passed" }] };
  const { externalId: _externalId, ...withoutExternalId } = submittedResponse(submitted, result);
  assert.throws(() => parseWorkflowProviderResponse(withoutExternalId, submitted), /external acknowledgement/i);
  assert.equal((await artifacts.cancelByOperation("operation-proof"))?.status, "cancelling");
  assert.equal((await artifacts.observeOperation("operation-proof"))?.status, "cancelling");
});

function managedSession(id: string, status: ManagedSession["status"]): ManagedSession {
  return { id, provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status, workspaceRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), taskId: "task-1", planRevision: "plan-7", plannedFiles: ["src/safe.ts"], lastHeartbeat: "2026-08-24T12:00:00.000Z", adapterVersion: "test", metadata: { "sxsy-b122.statusReason": `${id} result is ready.` } };
}

function authorityGrant(id: string, sessionId: string, actions: readonly string[]): AuthorityGrant {
  return { id, repositoryRoot: "C:\\repo", sessionId, taskId: "task-1", planRevision: "plan-7", allowedActions: actions, prohibitedActions: [], issuedAt: "2026-08-24T00:00:00.000Z", expiresAt: "2099-08-24T00:00:00.000Z", issuedBy: "test" };
}
