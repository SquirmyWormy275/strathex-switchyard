import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
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

function workflow(operationId = "operation-proof-1") {
  const planMaterial = {
    revision: "plan-1",
    originSessionId: "codex-session",
    taskId: "task-provider-host",
    objective: "Verify provider host",
    steps: [{ id: "step-1", summary: "Verify", ownedFiles: ["src/example.ts"], dependencies: [], status: "approved" }],
    decisions: []
  };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const evidenceMaterial = {
    instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context", summary: "Instructions" }],
    plan,
    documentation: [{ id: "documentation", digest: "2".repeat(64), source: "repository", summary: "Documentation" }],
    diff: { id: "diff", digest: "3".repeat(64), source: "target_snapshot", summary: "Diff" },
    files: [{ id: "file", digest: "4".repeat(64), source: "repository", summary: "File" }],
    tests: [{ id: "receipt", digest: "5".repeat(64), source: "receipt", summary: "Test", status: "passed" }]
  };
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
      digest: "6".repeat(64),
      taskId: "task-provider-host",
      planRevision: "plan-1",
      payload: {
        kind: "proof",
        evidence: { contextDigest: sha256(stableJson(evidenceMaterial)), ...evidenceMaterial },
        claims: ["The host returned exact evidence."],
        requiredBackends: ["fixture"],
        independentBackendRequired: false
      },
      executionAuthorized: false
    }
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

  const automated = await service.handle(request("/v1/b122/automation/compound_capture", automation()));
  assert.equal(automated.status, 200);
  assert.equal((automated.body as { schema: string }).schema, "sxsy-b122.remote-result");
  assert.equal(codex.executeCalls, 2);
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
