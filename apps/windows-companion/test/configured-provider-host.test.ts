import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import {
  reanchorApplyArtifactDigest,
  reanchorRequiredRereads,
  type ReanchorApplyRequest
} from "../../../packages/control-plane/src/reanchor.ts";
import { ProtectedJsonStore, sha256, stableJson, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import {
  ConfiguredProviderHostClient,
  ConfiguredProviderReanchorApplyPort,
  DurableConfiguredProviderOperationControl,
  type ConfiguredProviderOperationIdentity
} from "../src/configured-provider-host.ts";
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
  provider: "codex", action: "proof", authorityId: "authority-provider-host", targetSnapshotId: target, repositoryRoot
};
const isolatedAuthenticator: JournalAuthenticator = {
  provider: "isolated-provider-operation-test",
  async seal(hash) { return `sealed:${hash}`; },
  async verify(hash, tag) { return tag === `sealed:${hash}`; }
};

test("configured provider Re-anchor uses only the dedicated route and exact reviewed artifact binding", async () => {
  const input = reanchorRequest();
  const routes: string[] = [];
  let body: Record<string, unknown> | undefined;
  let trusted: Record<string, unknown> | undefined;
  const guardedTargets: string[] = [];
  const port = new ConfiguredProviderReanchorApplyPort({ async request(request) {
    routes.push(request.routeId);
    body = JSON.parse(Buffer.from(request.body!).toString("utf8")) as Record<string, unknown>;
    trusted = request.trustedDispatch as unknown as Record<string, unknown>;
    return passed(request.routeId, reanchorAcknowledgement(input));
  } }, { async assertCurrent(request) {
    guardedTargets.push(request.target.id);
    return { allowed: true, reason: "The exact old and new targets are current." };
  } });

  const result = await port.apply(input);
  assert.equal(result.disposition, "committed");
  assert.deepEqual(routes, ["provider.reanchor.codex"]);
  assert.equal(body?.schema, "sxsy-b122.provider-reanchor-request");
  assert.equal(body?.artifactDigest, input.artifactDigest);
  assert.equal((body?.contextEvidence as Record<string, unknown>).contextDigest, input.contextEvidence.contextDigest);
  assert.equal((trusted?.artifact as Record<string, unknown>).digest, input.artifactDigest);
  assert.equal((trusted?.confirmation as Record<string, unknown>).scopeDigest, input.confirmationScopeDigest);
  assert.deepEqual(guardedTargets, [input.oldTarget.id, input.newTarget.id]);
});

test("configured provider Re-anchor rejects artifact substitution, final target denial, and stop-only acknowledgements before success", async () => {
  const input = reanchorRequest();
  let calls = 0;
  const transport: ProviderCommandTransport = { async request(request) {
    calls += 1;
    return passed(request.routeId, {
      schema: "sxsy-b122.reanchor-acknowledgement", version: 1,
      requestId: input.requestId, operationId: input.operationId,
      externalEffectId: "provider-effect-stop-only", sessionId: input.sessionId,
      authorityId: input.authorityId, oldTargetSnapshotId: input.oldTargetSnapshotId,
      newTargetSnapshotId: input.newTargetSnapshotId, cooperativeStopAcknowledged: true, resumed: false
    });
  } };
  const allowed = { async assertCurrent() { return { allowed: true, reason: "Current." }; } };
  assert.equal((await new ConfiguredProviderReanchorApplyPort(transport, allowed).apply({ ...input, artifactDigest: "0".repeat(64) })).disposition, "not_started");
  assert.equal(calls, 0);

  const denied = new ConfiguredProviderReanchorApplyPort(transport, { async assertCurrent(request) {
    return request.target.id === input.newTarget.id
      ? { allowed: false, reason: "The new target changed." }
      : { allowed: true, reason: "Current." };
  } });
  assert.equal((await denied.apply(input)).disposition, "not_started");
  assert.equal(calls, 0);

  await assert.rejects(() => new ConfiguredProviderReanchorApplyPort(transport, allowed).apply(input), /acknowledgement|reread|report|malformed/i);
  assert.equal(calls, 1);
});

test("configured provider Re-anchor resolves a lost effect response through exact observation without replay", async () => {
  const input = reanchorRequest();
  const routes: string[] = [];
  const trusted: unknown[] = [];
  const port = new ConfiguredProviderReanchorApplyPort({ async request(request) {
    routes.push(request.routeId);
    trusted.push(request.trustedDispatch);
    if (request.routeId === "provider.reanchor.codex") {
      return { outcome: "unavailable", routeId: request.routeId, detail: "effect response lost", effectDisposition: "ambiguous" };
    }
    assert.equal(request.routeId, "provider.observe-reanchor.codex");
    return passed(request.routeId, reanchorAcknowledgement(input));
  } }, { async assertCurrent() { return { allowed: true, reason: "Current." }; } });
  assert.equal((await port.apply(input)).disposition, "committed");
  assert.deepEqual(routes, ["provider.reanchor.codex", "provider.observe-reanchor.codex"]);
  assert.notEqual(trusted[0], undefined);
  assert.equal(trusted[1], undefined, "observation cannot receive a new dispatch lease or effect authority");
});

test("configured provider-host client uses exact observe, cancel, and reconcile routes", async () => {
  const routes: string[] = [];
  const transport: ProviderCommandTransport = { async request(input) {
    routes.push(input.routeId);
    const body = input.body ? JSON.parse(Buffer.from(input.body).toString("utf8")) as Record<string, unknown> : {};
    if (input.routeId === "provider.observe-session.codex") return passed(input.routeId, { schema: "sxsy-b122.provider-session-observation", version: 1, sessionId: session.id, provider: "codex", targetSnapshotId: target, repositoryRoot, status: "verified_finished", capabilities: ["registered", "observable"], adapterVersion: "codex-live-v2" });
    if (input.routeId === "provider.observe-operation.codex") return passed(input.routeId, { schema: "sxsy-b122.provider-operation-observation", version: 1, operationId: body.operationId, externalId: body.externalId, routeId: body.routeId, sessionId: body.sessionId, provider: body.provider, action: body.action, authorityId: body.authorityId, targetSnapshotId: body.targetSnapshotId, repositoryRoot: body.repositoryRoot, outcome: "committed", effectDisposition: "committed", summary: "Observed exact committed effect." });
    if (input.routeId === "provider.cancel.codex") return passed(input.routeId, { schema: "sxsy-b122.provider-cancellation-ack", version: 1, ...operation, accepted: true, summary: "Cancellation acknowledged." });
    return passed(input.routeId, { schema: "sxsy-b122.provider-host-reconciliation", version: 1, operationsInspected: 1, operationsSettled: 1, councilsInspected: 0, councilsSettled: 0 });
  } };
  const client = new ConfiguredProviderHostClient(transport, () => "2026-08-25T12:01:00.000Z");
  assert.equal(client.recoveryExternalId({ routeId: operation.routeId, operationId: operation.operationId, provider: "codex" }), operation.operationId);
  assert.equal(client.recoveryExternalId({ routeId: "automation.compound_capture", operationId: "legacy-automation", provider: "codex" }), undefined);
  await assert.rejects(() => client.observeOperation({
    ...operation, operationId: "legacy-automation", externalId: "legacy-automation",
    routeId: "automation.compound_capture", action: "compound_capture"
  }), /identity/i);
  assert.deepEqual(routes, [], "legacy automation identities must be rejected before provider observation");
  const refreshed = await client.refreshSession(session);
  assert.equal(refreshed.status, "verified_finished");
  assert.deepEqual(refreshed.capabilities, ["registered", "observable"]);
  const observedOperation = await client.observeOperation(operation);
  assert.equal(observedOperation.outcome, "committed");
  assert.equal(observedOperation.effectDisposition, "committed");
  assert.equal((await client.cancelOperation(operation, "operator cancellation")).accepted, true);
  assert.equal((await client.reconcile(repositoryRoot)).operationsSettled, 1);
  assert.deepEqual(routes, ["provider.observe-session.codex", "provider.observe-operation.codex", "provider.cancel.codex", "provider.reconcile"]);
});

test("durable configured-provider control observes, cancels, and reconciles an exact restarted operation without redispatch", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-operation-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "protected.jsonl");
  let effectDispatches = 0;
  let observations = 0;
  let cancellations = 0;
  let reconciliations = 0;
  let cancelledIdentity: Record<string, unknown> | undefined;
  const transport: ProviderCommandTransport = { async request(input) {
    const body = input.body ? JSON.parse(Buffer.from(input.body).toString("utf8")) as Record<string, unknown> : {};
    if (input.routeId === operation.routeId) {
      effectDispatches += 1;
      return { outcome: "unavailable", routeId: input.routeId, detail: "response lost after dispatch", effectDisposition: "ambiguous" };
    }
    if (input.routeId === "provider.observe-operation.codex") {
      observations += 1;
      return passed(input.routeId, {
        ...body, schema: "sxsy-b122.provider-operation-observation", version: 1,
        outcome: "committed", effectDisposition: "committed", summary: "Observed exact committed provider effect."
      });
    }
    if (input.routeId === "provider.cancel.codex") {
      cancellations += 1;
      cancelledIdentity = body;
      return passed(input.routeId, {
        schema: "sxsy-b122.provider-cancellation-ack", version: 1,
        operationId: body.operationId, externalId: body.externalId, routeId: body.routeId,
        sessionId: body.sessionId, provider: body.provider, action: body.action,
        authorityId: body.authorityId, targetSnapshotId: body.targetSnapshotId,
        repositoryRoot: body.repositoryRoot, accepted: true, summary: "Exact cancellation accepted."
      });
    }
    if (input.routeId === "provider.reconcile") {
      reconciliations += 1;
      return passed(input.routeId, {
        schema: "sxsy-b122.provider-host-reconciliation", version: 1,
        operationsInspected: 1, operationsSettled: 1, councilsInspected: 0, councilsSettled: 0
      });
    }
    throw new Error(`unexpected route ${input.routeId}`);
  } };
  const store = new ProtectedJsonStore({ filePath, authenticator: isolatedAuthenticator });
  const first = new DurableConfiguredProviderOperationControl({
    store,
    transport,
    host: new ConfiguredProviderHostClient(transport)
  });
  const oldTarget = reanchorRequest().oldTarget;
  const authority: AuthorityGrant = {
    id: operation.authorityId, repositoryRoot, sessionId: session.id, taskId: session.taskId!, planRevision: session.planRevision!,
    allowedActions: ["proof"], prohibitedActions: [], issuedAt: "2026-08-25T11:55:00.000Z",
    expiresAt: "2026-08-25T12:10:00.000Z", issuedBy: "TEST\\Reviewer"
  };
  const trustedDispatch = {
    action: "proof" as const, guardAction: "proof" as const, operationId: operation.operationId,
    guardOperationId: operation.operationId, target: oldTarget, session, authority,
    artifact: null, confirmation: null,
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } }
  };
  assert.equal(first.recoveryExternalId({ routeId: operation.routeId, operationId: operation.operationId, provider: "codex" }), operation.externalId);
  await first.request({ routeId: operation.routeId, repositoryRoot, body: "{}", trustedDispatch });
  assert.equal(effectDispatches, 1);

  const restarted = new DurableConfiguredProviderOperationControl({
    store: new ProtectedJsonStore({ filePath, authenticator: isolatedAuthenticator }),
    transport,
    host: new ConfiguredProviderHostClient(transport)
  });
  const binding = {
    operationId: operation.operationId, action: operation.action, targetSnapshotId: operation.targetSnapshotId,
    repositoryRoot, sessionId: operation.sessionId, authorityId: operation.authorityId
  };
  const observed = await restarted.observeBoundOperation(binding);
  assert.deepEqual(observed, {
    state: "terminal", ...binding, status: "completed", effectDisposition: "committed",
    summary: "Observed exact committed provider effect."
  });
  assert.equal(effectDispatches, 1, "restart observation must never redispatch the provider effect");
  assert.equal((await restarted.observeBoundOperation({ ...binding, sessionId: "wrong-session" })).state, "not_owner");
  assert.equal((await restarted.observeBoundOperation({ ...binding, authorityId: "wrong-authority" })).state, "not_owner");
  assert.equal(observations, 1, "wrong protected identities must be rejected before provider observation");
  assert.equal(await restarted.observeProviderOperation({ ...operation, sessionId: "wrong-session" }), undefined);
  assert.equal(observations, 1, "a substituted provider-recovery identity must be rejected before host observation");
  assert.deepEqual(await restarted.observeProviderOperation(operation), {
    outcome: "committed",
    note: "Observed exact committed provider effect.",
    details: { provider: "codex", externalId: operation.externalId, effectDisposition: "committed" }
  });
  assert.equal(observations, 2);

  assert.equal(await restarted.cancelByOperation(operation.operationId, "operator cancellation"), 1);
  assert.equal(cancellations, 1);
  assert.equal(cancelledIdentity?.sessionId, operation.sessionId);
  assert.equal(cancelledIdentity?.authorityId, operation.authorityId);
  await restarted.recoverAfterRestart();
  assert.equal(reconciliations, 1);
  assert.equal(effectDispatches, 1);

  await assert.rejects(
    () => restarted.request({ routeId: operation.routeId, repositoryRoot, body: "{}", trustedDispatch: { ...trustedDispatch, session: { ...session, id: "substituted-session" } } }),
    /different|binding|conflict/i
  );
  assert.equal(effectDispatches, 1, "a conflicting durable operation identity must fail before provider dispatch");
});

test("durable configured-provider control passes proposal-only automation without creating an effect recovery binding", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-proposal-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const forwarded: string[] = [];
  const transport: ProviderCommandTransport = {
    async request(input) {
      forwarded.push(input.routeId);
      return { outcome: "passed", routeId: input.routeId, detail: "proposal forwarded", effectDisposition: "ambiguous", body: Buffer.from("{}") };
    }
  };
  const control = new DurableConfiguredProviderOperationControl({
    store: new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator: isolatedAuthenticator }),
    transport,
    host: new ConfiguredProviderHostClient(transport)
  });
  const proposal = await control.request({
    routeId: "automation.proposal.compound_capture",
    repositoryRoot,
    body: "{}"
  });
  assert.equal(proposal.outcome, "passed");
  assert.deepEqual(forwarded, ["automation.proposal.compound_capture"]);
  await assert.rejects(() => control.request({
    routeId: "automation.proposal.compound_capture",
    repositoryRoot,
    body: "{}",
    trustedDispatch: {} as never
  }), /proposal.*trusted effect dispatch/i);
  await assert.rejects(() => control.request({
    routeId: "automation.compound_capture",
    repositoryRoot,
    body: "{}"
  }), /host-local|proposal-only|automation effect/i);
  assert.deepEqual(forwarded, ["automation.proposal.compound_capture"]);
  assert.equal(control.recoveryExternalId({ routeId: "automation.proposal.compound_capture", operationId: "proposal", provider: "codex" }), undefined);
});

test("configured provider-host client rejects target churn, unsupported providers, and malformed exact evidence", async () => {
  const client = new ConfiguredProviderHostClient({ async request(input) { return passed(input.routeId, { schema: "sxsy-b122.provider-session-observation", version: 1, sessionId: session.id, provider: "codex", targetSnapshotId: "0".repeat(64), repositoryRoot, status: "running", capabilities: ["registered", "observable"], adapterVersion: "codex-live-v1" }); } });
  await assert.rejects(() => client.refreshSession(session), /malformed|bound/i);
  const unsupported = { ...session, provider: "generic" as const };
  await assert.rejects(() => client.refreshSession(unsupported), /Claude|Codex/i);
  assert.equal(client.recoveryExternalId({ routeId: "provider.proof", operationId: operation.operationId, provider: "generic" }), undefined);
  await assert.rejects(() => client.observeOperation({ ...operation, repositoryRoot: "relative" }), /identity/i);
});

test("configured provider-host client rejects missing, conflicting, and semantically inconsistent operation evidence", async (context) => {
  const canonical = {
    schema: "sxsy-b122.provider-operation-observation", version: 1,
    ...operation, outcome: "committed", effectDisposition: "committed", summary: "Exact provider effect committed."
  } as const;
  const mutations: ReadonlyArray<readonly [string, (value: Record<string, unknown>) => Record<string, unknown>]> = [
    ["missing action", (value) => { const { action: _action, ...rest } = value; return rest; }],
    ["wrong action", (value) => ({ ...value, action: "plan_expander" })],
    ["missing authority", (value) => { const { authorityId: _authority, ...rest } = value; return rest; }],
    ["wrong authority", (value) => ({ ...value, authorityId: "authority-confused" })],
    ["missing disposition", (value) => { const { effectDisposition: _disposition, ...rest } = value; return rest; }],
    ["conflicting disposition", (value) => ({ ...value, effectDisposition: "not_started" })],
    ["wrong root", (value) => ({ ...value, repositoryRoot: "C:\\other" })]
  ];
  for (const [label, mutate] of mutations) {
    await context.test(label, async () => {
      const client = new ConfiguredProviderHostClient({ async request(input) { return passed(input.routeId, mutate({ ...canonical })); } });
      await assert.rejects(() => client.observeOperation(operation), /malformed|bound|evidence/i);
    });
  }

  const cancellationMutations: ReadonlyArray<readonly [string, (value: Record<string, unknown>) => Record<string, unknown>]> = [
    ["missing action", (value) => { const { action: _action, ...rest } = value; return rest; }],
    ["wrong authority", (value) => ({ ...value, authorityId: "authority-confused" })],
    ["wrong route", (value) => ({ ...value, routeId: "provider.plan_expander" })],
    ["wrong root", (value) => ({ ...value, repositoryRoot: "C:\\other" })]
  ];
  for (const [label, mutate] of cancellationMutations) {
    await context.test(`cancellation ${label}`, async () => {
      const canonicalAck = { schema: "sxsy-b122.provider-cancellation-ack", version: 1, ...operation, accepted: true, summary: "Exact cancellation accepted." };
      const client = new ConfiguredProviderHostClient({ async request(input) { return passed(input.routeId, mutate(canonicalAck)); } });
      await assert.rejects(() => client.cancelOperation(operation, "operator cancellation"), /malformed|bound|evidence/i);
    });
  }
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
    decisions: ["Use the exact target snapshot."],
    expectedTargetTransition: { beforeTargetSnapshotId: request.targetSnapshotId, expectedAfterTargetSnapshotId: request.targetSnapshotId, expectation: "unchanged" }
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

function reanchorRequest(): ReanchorApplyRequest {
  const oldTarget: TargetSnapshot = {
    id: target, repositoryRoot, canonicalRemote: "https://github.com/example/provider-host.git",
    branch: "feature/provider-host", upstream: "origin/feature/provider-host", head: "b".repeat(40),
    indexTree: "tree-old", trackedManifest: "tracked-old", untrackedManifest: "untracked-clean", submodules: {},
    policyVersion: "policy-v1", environmentFingerprint: "environment-v1", completeness: "complete", reasons: [],
    capturedAt: "2026-08-25T11:59:00.000Z"
  };
  const newTarget: TargetSnapshot = {
    ...oldTarget, id: "a".repeat(64), head: "a".repeat(40), indexTree: "tree-new", trackedManifest: "tracked-new",
    capturedAt: "2026-08-25T12:00:00.000Z"
  };
  const authority: AuthorityGrant = {
    id: "authority-provider-reanchor", repositoryRoot, sessionId: session.id,
    taskId: session.taskId!, planRevision: session.planRevision!, allowedActions: ["reanchor"],
    prohibitedActions: ["credential.read", "network.open"], issuedAt: "2026-08-25T11:55:00.000Z",
    expiresAt: "2026-08-25T12:10:00.000Z", issuedBy: "TEST\\Reviewer"
  };
  const planMaterial = {
    revision: session.planRevision!, originSessionId: session.id, taskId: session.taskId!,
    objective: "Reread the exact protected task brief.",
    steps: [{ id: "step-one", summary: "Inspect current work.", ownedFiles: ["src/example.ts"], dependencies: [], status: "approved" as const }],
    decisions: ["Automatic resume is forbidden."],
    expectedTargetTransition: { beforeTargetSnapshotId: oldTarget.id, expectedAfterTargetSnapshotId: oldTarget.id, expectation: "unchanged" as const }
  };
  const evidenceMaterial = {
    instructions: [{ id: "instructions-one", digest: sha256("protected instructions"), source: "protected_context" as const, summary: "Original instructions." }],
    plan: { digest: sha256(stableJson(planMaterial)), ...planMaterial },
    documentation: [{ id: "documentation-one", digest: sha256("documentation"), source: "repository" as const, summary: "Project documentation." }],
    diff: { id: "diff-one", digest: sha256("current diff"), source: "target_snapshot" as const, summary: "Current diff." },
    files: [{ id: "file-one", digest: sha256("src/example.ts"), source: "repository" as const, summary: "Current file." }],
    tests: [{ id: "test-one", digest: sha256("test receipt"), source: "receipt" as const, summary: "Current tests.", status: "passed" as const }]
  };
  const contextEvidence = { contextDigest: sha256(stableJson(evidenceMaterial)), ...evidenceMaterial };
  const rereadEvidence = {
    contextDigest: contextEvidence.contextDigest,
    authorityDigest: sha256(stableJson(authority)),
    instructionDigests: contextEvidence.instructions.map((item) => item.digest),
    planDigest: contextEvidence.plan.digest,
    documentationDigests: contextEvidence.documentation.map((item) => item.digest),
    currentWorkDigest: sha256(stableJson({
      diffDigest: contextEvidence.diff.digest,
      fileDigests: contextEvidence.files.map((item) => item.digest),
      testDigests: contextEvidence.tests.map((item) => item.digest),
      newTarget
    })),
    inspectedTargetSnapshotId: newTarget.id
  };
  const material = {
    version: 1 as const, requestId: `reanchor:${"1".repeat(64)}`, operationId: `reanchor-operation:${"2".repeat(64)}`,
    oldTargetSnapshotId: oldTarget.id, newTargetSnapshotId: newTarget.id, sessionId: session.id,
    authorityId: authority.id, reason: "Reread protected context and inspect current work.",
    previewDigest: "3".repeat(64), confirmationDigest: "4".repeat(64), confirmationScopeDigest: "5".repeat(64),
    provider: "codex" as const, session, repositoryRoot, taskId: session.taskId!, planRevision: session.planRevision!,
    plannedFiles: [...session.plannedFiles], authority, oldTarget, newTarget, contextEvidence,
    requiredRereads: reanchorRequiredRereads, rereadEvidence,
    cooperativeStopRequested: true as const, resumeAuthorized: false as const
  };
  return { ...material, artifactDigest: reanchorApplyArtifactDigest(material) };
}

function reanchorAcknowledgement(input: ReanchorApplyRequest) {
  return {
    schema: "sxsy-b122.reanchor-acknowledgement", version: 1,
    requestId: input.requestId, operationId: input.operationId, externalEffectId: "provider-effect-reanchor",
    sessionId: input.sessionId, authorityId: input.authorityId,
    oldTargetSnapshotId: input.oldTargetSnapshotId, newTargetSnapshotId: input.newTargetSnapshotId,
    cooperativeStopAcknowledged: true, resumed: false, artifactDigest: input.artifactDigest,
    rereadEvidence: input.rereadEvidence,
    report: {
      summary: "Stopped, reread the task brief and documentation, inspected current work, and reported without resuming.",
      discrepancies: ["The protected target changed."], risks: ["The session remains stopped."],
      questions: ["Should a separate authority resume it?"], result: "reanchored_without_resume"
    }
  };
}

function passed(routeId: string, value: unknown) { return { outcome: "passed" as const, routeId, detail: "ok", effectDisposition: "ambiguous" as const, body: Buffer.from(JSON.stringify(value)) }; }
