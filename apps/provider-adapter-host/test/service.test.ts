import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { canonicalWorkflowArtifact, planApprovalReviewScopeDigest } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import {
  ClaudeProviderAdapterBackend,
  CodexProviderAdapterBackend,
  FixtureProviderRuntimePort,
  type ProviderRuntimePort
} from "../src/backends.ts";
import { ProviderAdapterHostService } from "../src/service.ts";
import { createProviderHostStore } from "../src/state.ts";
import type { ProviderCouncilCleanupRequest } from "../src/state.ts";

const token = "a".repeat(64);
const target = "b".repeat(64);
const changedTarget = "c".repeat(64);

async function fixture(context: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-host-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const store = createProviderHostStore(join(directory, "provider-host.jsonl"), token);
  const claude = new FixtureProviderRuntimePort("claude", { effectfulTestOnly: true });
  const codex = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store,
    backends: [new ClaudeProviderAdapterBackend(claude), new CodexProviderAdapterBackend(codex)]
  });
  return { directory, store, claude, codex, service };
}

function request(path: string, body?: unknown, authorization = `Bearer ${token}`, method = "POST") {
  return { method, path, headers: { authorization }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
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

function automation(operationId = "operation-automation-1", snapshot = target) {
  return {
    schema: "sxsy-b122.remote-automation",
    version: 1,
    action: "compound_capture",
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
    authorityId: "authority-provider-host"
  };
}

function existingPlan() {
  const planMaterial = {
    revision: "plan-1",
    originSessionId: "codex-session",
    taskId: "task-provider-host",
    objective: "Verify provider host",
    steps: [{ id: "step-1", summary: "Verify", ownedFiles: ["src/example.ts"], dependencies: [] as string[], status: "approved" as const }],
    decisions: [] as string[]
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
  return {
    kind: "automation" as const,
    routeId: "automation.compound_capture",
    operationId,
    externalId: operationId,
    action: "compound_capture",
    repositoryRoot: "C:\\repo",
    targetSnapshotId: target,
    sessionId: "codex-session",
    provider: "codex" as const
  };
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

test("authenticated health, handshake, workflow, and automation routes use exact provider bindings", async (context) => {
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

  const automated = await service.handle(request("/v1/b122/automation/compound_capture", automation()));
  assert.equal(automated.status, 200);
  assert.equal((automated.body as { schema: string }).schema, "sxsy-b122.remote-result");
  assert.equal(codex.executeCalls, 3);
});

test("authenticated graceful shutdown is fenced to the exact lifecycle nonce, process, and configuration", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-shutdown-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  let shutdowns = 0;
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(directory, "state.jsonl"), token),
    backends: [new CodexProviderAdapterBackend(new FixtureProviderRuntimePort("codex"))],
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
    observeOperation: source.observeOperation.bind(source), cancelOperation: source.cancelOperation.bind(source),
    council: source.council.bind(source), observeCouncil: source.observeCouncil.bind(source), shutdown: source.shutdown.bind(source)
  } as ProviderRuntimePort;
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(directory, "state.jsonl"), "f".repeat(64)),
    backends: [new CodexProviderAdapterBackend(dishonest, { adapterId: "test.module.codex", moduleSha256: "e".repeat(64) })]
  });
  const connected = await service.handle(request("/v1/b122/handshake/codex", handshake()));
  assert.equal(connected.status, 200);
  assert.deepEqual((connected.body as { capabilities: string[] }).capabilities, ["registered", "observable", "controllable"]);
  const blockedCouncil = await service.handle(request("/v1/b122/council/codex", {
    schema: "sxsy-b122.council-phase", version: 1, epochId: "unattested", phase: "pause",
    sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo"
  }));
  assert.equal(blockedCouncil.status, 503);
  assert.deepEqual(source.councilPhases, []);
});

test("provider execution requires a fresh host-attested Mediated session before calling the module", async (context) => {
  const controller = new AbortController();
  const externalSource = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const externalModule = {
    provider: "codex",
    handshake: externalSource.handshake.bind(externalSource), execute: externalSource.execute.bind(externalSource),
    observeSession: externalSource.observeSession.bind(externalSource), observeWorkflowContext: externalSource.observeWorkflowContext.bind(externalSource),
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
    externalBackend.execute(backendAutomationCommand("operation-external-module"), controller.signal),
    /fresh, running, Controllable, and Mediated/
  );
  assert.equal(externalSource.executeCalls, 0);

  for (const status of ["stale", "unreachable"] as const) {
    await context.test(`rejects ${status}`, async () => {
      const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
      const backend = new CodexProviderAdapterBackend(port);
      await backend.handshake(handshake(), controller.signal);
      port.setSessionObservation("codex-session", { status });
      await assert.rejects(
        backend.execute(backendAutomationCommand(`operation-${status}`), controller.signal),
        /fresh, running, Controllable, and Mediated/
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
        backend.execute(backendAutomationCommand(`operation-capability-${capabilities.length}-${capabilities[0]}`), controller.signal),
        /fresh, running, Controllable, and Mediated/
      );
      assert.equal(port.executeCalls, 0);
    });
  }
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
    backend.execute(backendAutomationCommand("operation-post-execution-stale"), controller.signal),
    /fresh, running, Controllable, and Mediated/
  );
  assert.equal(port.executeCalls, 1);
});

test("operation IDs are restart-durable, exact-request idempotent, and conflict-safe", async (context) => {
  const setup = await fixture(context);
  await setup.service.handle(request("/v1/b122/handshake/codex", handshake()));
  const first = await setup.service.handle(request("/v1/b122/automation/compound_capture", automation()));
  const duplicate = await setup.service.handle(request("/v1/b122/automation/compound_capture", automation()));
  assert.deepEqual(duplicate.body, first.body);
  assert.equal(setup.codex.executeCalls, 1);

  const conflicting = automation();
  conflicting.target.id = changedTarget;
  assert.equal((await setup.service.handle(request("/v1/b122/automation/compound_capture", conflicting))).status, 409);
  assert.equal(setup.codex.executeCalls, 1);

  const restarted = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(setup.directory, "provider-host.jsonl"), token),
    backends: [new ClaudeProviderAdapterBackend(setup.claude), new CodexProviderAdapterBackend(setup.codex)]
  });
  const afterRestart = await restarted.handle(request("/v1/b122/automation/compound_capture", automation()));
  assert.deepEqual(afterRestart.body, first.body);
  assert.equal(setup.codex.executeCalls, 1);
});

test("target churn and malformed provider output fail closed without a false success", async (context) => {
  const { service, codex } = await fixture(context);
  await service.handle(request("/v1/b122/handshake/codex", handshake()));
  codex.setSessionTarget("codex-session", changedTarget);
  const churned = await service.handle(request("/v1/b122/automation/compound_capture", automation("operation-churn")));
  assert.equal(churned.status, 503);
  assert.equal(codex.executeCalls, 0);

  codex.setSessionTarget("codex-session", target);
  codex.malformedNextResponse();
  const malformed = await service.handle(request("/v1/b122/automation/compound_capture", automation("operation-malformed")));
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
  assert.equal((await service.handle(request("/v1/b122/council/codex", staleResume))).status, 409);
  const resume = { ...base, phase: "resume", assignmentDigest: "7".repeat(64), worktreeRoot: "C:\\worktree", branch: "council/epoch-1", head: "d".repeat(40), leases: assignment.leases, resourceHost };
  assert.equal((await service.handle(request("/v1/b122/council/codex", resume))).status, 200);
  assert.deepEqual(codex.councilPhases, ["pause", "assignment", "resume"]);

  codex.setNextStatus("running");
  await service.handle(request("/v1/b122/automation/compound_capture", automation("operation-running")));
  const confusedObservation = await service.handle(request("/v1/b122/observe/operation/codex", { schema: "sxsy-b122.provider-operation-observe", version: 1, operationId: "operation-confused", externalId: "operation-running", routeId: "automation.compound_capture", sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo" }));
  assert.equal(confusedObservation.status, 404);
  const observed = await service.handle(request("/v1/b122/observe/operation/codex", { schema: "sxsy-b122.provider-operation-observe", version: 1, operationId: "operation-running", externalId: "operation-running", routeId: "automation.compound_capture", sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo" }));
  assert.equal((observed.body as { outcome: string }).outcome, "unresolved");
  const cancelled = await service.handle(request("/v1/b122/cancel/codex", { schema: "sxsy-b122.provider-operation-cancel", version: 1, operationId: "operation-running", externalId: "operation-running", routeId: "automation.compound_capture", sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo", reason: "operator cancelled" }));
  assert.equal(cancelled.status, 200);
  assert.equal((cancelled.body as { accepted: boolean }).accepted, true);
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
    backends: [new CodexProviderAdapterBackend(port)]
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
  const conflicting = await service.handle(request("/v1/b122/council/cleanup/codex", { ...cleanup, outcome: "aborted" }));
  assert.equal(conflicting.status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await service.handle(request("/v1/b122/council/cleanup/codex", cleanup))).status, 200);
  assert.equal(port.cleanupCalls, 1);
});

test("submitted operations reconcile after restart without replay", async (context) => {
  const setup = await fixture(context);
  await setup.service.handle(request("/v1/b122/handshake/codex", handshake()));
  setup.codex.loseNextResponseAfterCommit();
  const ambiguous = await setup.service.handle(request("/v1/b122/automation/compound_capture", automation("operation-reconcile")));
  assert.equal(ambiguous.status, 503);
  assert.equal(setup.codex.executeCalls, 1);

  const restarted = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(setup.directory, "provider-host.jsonl"), token),
    backends: [new ClaudeProviderAdapterBackend(setup.claude), new CodexProviderAdapterBackend(setup.codex)]
  });
  const receipt = await restarted.reconcile();
  assert.deepEqual(receipt, { operationsInspected: 1, operationsSettled: 1, councilsInspected: 0, councilsSettled: 0 });
  const after = await restarted.handle(request("/v1/b122/observe/operation/codex", { schema: "sxsy-b122.provider-operation-observe", version: 1, operationId: "operation-reconcile", externalId: "operation-reconcile", routeId: "automation.compound_capture", sessionId: "codex-session", targetSnapshotId: target, repositoryRoot: "C:\\repo" }));
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
    backends: [new ClaudeProviderAdapterBackend(setup.claude), new CodexProviderAdapterBackend(setup.codex)]
  });
  const receipt = await restarted.reconcile();
  assert.deepEqual(receipt, { operationsInspected: 0, operationsSettled: 0, councilsInspected: 1, councilsSettled: 1 });
  assert.equal((await restarted.handle(request("/v1/b122/council/codex", pauseRequest))).status, 200);
  assert.deepEqual(setup.codex.councilPhases, ["pause"]);
});
