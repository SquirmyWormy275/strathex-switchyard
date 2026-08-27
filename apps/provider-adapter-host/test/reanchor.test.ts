import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import {
  reanchorApplyArtifactDigest,
  reanchorRequiredRereads,
  type ReanchorProviderRereadEvidence
} from "../../../packages/control-plane/src/reanchor.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import {
  CodexProviderAdapterBackend,
  FixtureProviderRuntimePort,
  providerReanchorArtifactBinding,
  type ProviderRuntimePort,
  type ProviderRuntimeReanchorRequest
} from "../src/backends.ts";
import { signProviderDispatchLease } from "../src/dispatch-lease.ts";
import { ProviderAdapterHostService } from "../src/service.ts";
import { createProviderHostStore } from "../src/state.ts";

const token = "a".repeat(64);
const leaseKey = "c".repeat(64);
const fixedNow = "2026-08-25T12:00:00.000Z";
const hostIdentity = {
  configurationSha256: "1".repeat(64),
  lifecycleNonceSha256: "2".repeat(64),
  tlsSpkiSha256: "3".repeat(64)
} as const;

function target(change: Partial<Omit<TargetSnapshot, "id">> = {}): TargetSnapshot {
  const value = {
    repositoryRoot: "C:\\repo",
    canonicalRemote: "https://github.com/acme/repo.git",
    branch: "feature/provider-host",
    defaultBranch: "main",
    upstream: "origin/feature/provider-host",
    head: "d".repeat(40),
    indexTree: "1".repeat(40),
    trackedManifest: "e".repeat(64),
    untrackedManifest: "f".repeat(64),
    submodules: {},
    policyVersion: "policy-v1",
    environmentFingerprint: "2".repeat(64),
    capturedAt: fixedNow,
    completeness: "complete" as const,
    reasons: [],
    ...change
  };
  return { ...value, id: targetSnapshotDigest(value) };
}

const oldTarget = target();
const newTarget = target({
  branch: "feature/reanchored",
  upstream: "origin/feature/reanchored",
  head: "9".repeat(40),
  indexTree: "8".repeat(40),
  trackedManifest: "7".repeat(64),
  capturedAt: "2026-08-25T12:00:01.000Z"
});

const authority: AuthorityGrant = {
  id: "authority-provider-host",
  repositoryRoot: "C:\\repo",
  sessionId: "codex-session",
  taskId: "task-provider-host",
  planRevision: "plan-1",
  allowedActions: ["reanchor"],
  prohibitedActions: [],
  issuedAt: "2026-08-25T11:59:00.000Z",
  expiresAt: "2099-08-25T12:00:00.000Z",
  issuedBy: "current-user:test"
};

const managedSession: ManagedSession = {
  id: "codex-session",
  provider: "codex",
  surface: "bridge",
  capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running",
  workspaceRoot: "C:\\repo",
  targetSnapshotId: oldTarget.id,
  taskId: "task-provider-host",
  planRevision: "plan-1",
  plannedFiles: ["src/example.ts"],
  lastHeartbeat: fixedNow,
  adapterVersion: "codex-fixture-provider-host-v1",
  metadata: {
    "sxsy-b122.providerHandshake": "exact-route-v1",
    "sxsy-b122.providerHandshakeTarget": oldTarget.id,
    "sxsy-b122.resources": JSON.stringify(["port:4100"]),
    "sxsy-b122.dependencies": JSON.stringify([]),
    "sxsy-b122.diffDigest": sha256("")
  }
};

const planMaterial = {
  revision: "plan-1",
  originSessionId: "codex-session",
  taskId: "task-provider-host",
  objective: "Re-anchor the exact managed task.",
  steps: [{ id: "step-1", summary: "Inspect existing changes.", ownedFiles: ["src/example.ts"], dependencies: [] as string[], status: "approved" as const }],
  decisions: ["Do not resume automatically."],
  expectedTargetTransition: { beforeTargetSnapshotId: oldTarget.id, expectedAfterTargetSnapshotId: oldTarget.id, expectation: "unchanged" as const }
};
const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
const evidenceMaterial = {
  instructions: [{ id: "instructions-1", digest: "1".repeat(64), source: "protected_context" as const, summary: "Original instructions." }],
  plan,
  documentation: [{ id: "docs-1", digest: "2".repeat(64), source: "repository" as const, summary: "Project documentation." }],
  diff: { id: "diff-1", digest: "3".repeat(64), source: "target_snapshot" as const, summary: "Current diff." },
  files: [{ id: "file-1", digest: "4".repeat(64), source: "repository" as const, summary: "Current work." }],
  tests: [{ id: "test-1", digest: "5".repeat(64), source: "receipt" as const, summary: "Current test evidence.", status: "passed" as const }]
};
const contextEvidence = { contextDigest: sha256(stableJson(evidenceMaterial)), ...evidenceMaterial };
const rereadEvidence: ReanchorProviderRereadEvidence = {
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

function reanchorRequest(operationId = "reanchor-operation:fixture"): ProviderRuntimeReanchorRequest {
  const material = {
    version: 1,
    provider: "codex",
    requestId: "reanchor:" + "4".repeat(64),
    operationId,
    sessionId: "codex-session",
    authorityId: "authority-provider-host",
    repositoryRoot: "C:\\repo",
    oldTargetSnapshotId: oldTarget.id,
    newTargetSnapshotId: newTarget.id,
    reason: "Re-read the protected brief and report the exact drift.",
    previewDigest: "5".repeat(64),
    confirmationDigest: "6".repeat(64),
    session: managedSession,
    taskId: "task-provider-host",
    planRevision: "plan-1",
    plannedFiles: ["src/example.ts"],
    authority,
    oldTarget,
    newTarget,
    contextEvidence,
    requiredRereads: reanchorRequiredRereads,
    rereadEvidence,
    confirmationScopeDigest: "7".repeat(64),
    cooperativeStopRequested: true,
    resumeAuthorized: false
  } as const;
  return {
    schema: "sxsy-b122.provider-reanchor-request",
    ...material,
    artifactDigest: reanchorApplyArtifactDigest(material)
  };
}

function rebindRequest(
  request: ProviderRuntimeReanchorRequest,
  change: Partial<ProviderRuntimeReanchorRequest>
): ProviderRuntimeReanchorRequest {
  const changed = { ...request, ...change };
  const { schema: _schema, artifactDigest: _artifactDigest, ...applyMaterial } = changed;
  return { ...changed, artifactDigest: reanchorApplyArtifactDigest(applyMaterial) };
}

let leaseSequence = 0;
function dispatchLease(input: ProviderRuntimeReanchorRequest, routeId = "provider.reanchor.codex") {
  const artifact = providerReanchorArtifactBinding(input);
  const nonce = sha256(`reanchor-lease-${++leaseSequence}`);
  return signProviderDispatchLease({
    schema: "sxsy-b122.provider-dispatch-lease",
    version: 1,
    leaseId: `reanchor-lease-${nonce.slice(0, 24)}`,
    nonce,
    issuedAt: fixedNow,
    expiresAt: "2026-08-25T12:00:30.000Z",
    authority: {
      id: input.authorityId,
      grantDigest: "a".repeat(64),
      scopeDigest: "b".repeat(64),
      expiresAt: "2026-08-25T12:01:00.000Z"
    },
    target: {
      ...input.oldTarget,
      canonicalRemote: input.oldTarget.canonicalRemote ?? null,
      branch: input.oldTarget.branch ?? null,
      defaultBranch: input.oldTarget.defaultBranch ?? null,
      detached: input.oldTarget.detached ?? false,
      upstream: input.oldTarget.upstream ?? null,
      head: input.oldTarget.head ?? null,
      indexTree: input.oldTarget.indexTree ?? null
    },
    session: {
      id: input.sessionId,
      provider: input.provider,
      taskId: "task-provider-host",
      planRevision: "plan-1",
      adapterVersion: "codex-fixture-provider-host-v1"
    },
    dispatch: { routeId, action: "reanchor", operationId: input.operationId },
    artifact,
    confirmation: { digest: input.confirmationDigest, scopeDigest: input.confirmationScopeDigest },
    containment: { status: "clear", bindingDigest: "c".repeat(64), fenceEpoch: 3, activationOperationId: null },
    host: hostIdentity,
    module: {
      adapterId: "sxsy-b122.fixture.codex",
      moduleSha256: sha256("sxsy-b122.fixture.codex.v1")
    }
  }, leaseKey);
}

function httpRequest(path: string, body: unknown, authorization = `Bearer ${token}`) {
  return { method: "POST", path, headers: { authorization }, body: JSON.stringify(body) };
}

async function createFixture(
  context: test.TestContext,
  port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true }),
  stateFile?: string
) {
  const directory = stateFile ? undefined : await mkdtemp(join(tmpdir(), "b122-provider-reanchor-"));
  if (directory) context.after(async () => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = createProviderHostStore(stateFile ?? join(directory!, "state.jsonl"), token);
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store,
    backends: [new CodexProviderAdapterBackend(port)],
    dispatchLease: { authenticationKey: leaseKey, host: hostIdentity },
    now: () => fixedNow
  });
  await service.handle(httpRequest("/v1/b122/handshake/codex", {
    schema: "sxsy-b122.provider-handshake-request",
    version: 1,
    sessionId: "codex-session",
    provider: "codex",
    targetSnapshotId: oldTarget.id,
    repositoryRoot: oldTarget.repositoryRoot,
    branch: oldTarget.branch,
    head: oldTarget.head
  }));
  return { directory, store, port, service };
}

test("backend Re-anchor is an exact Controllable stop/report/no-resume contract", async () => {
  const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const backend = new CodexProviderAdapterBackend(port);
  await backend.handshake({
    sessionId: "codex-session",
    provider: "codex",
    targetSnapshotId: oldTarget.id,
    repositoryRoot: oldTarget.repositoryRoot,
    branch: oldTarget.branch,
    head: oldTarget.head
  }, new AbortController().signal);

  const acknowledgement = await backend.reanchor(reanchorRequest(), new AbortController().signal);
  assert.equal(acknowledgement.schema, "sxsy-b122.reanchor-acknowledgement");
  assert.equal(acknowledgement.oldTargetSnapshotId, oldTarget.id);
  assert.equal(acknowledgement.newTargetSnapshotId, newTarget.id);
  assert.equal(acknowledgement.cooperativeStopAcknowledged, true);
  assert.equal(acknowledgement.resumed, false);
  assert.equal(acknowledgement.report.result, "reanchored_without_resume");
  assert.equal(port.reanchorCalls, 1);
  const after = await port.observeSession({
    sessionId: "codex-session",
    provider: "codex",
    targetSnapshotId: newTarget.id,
    repositoryRoot: newTarget.repositoryRoot
  }, new AbortController().signal);
  assert.equal(after.status, "verified_blocked");
});

test("fixed authenticated Re-anchor route consumes one exact cross-target lease and rejects generic routing and substitution", async (context) => {
  const { service, port } = await createFixture(context);
  const exact = reanchorRequest();
  const body = { ...exact, dispatchLease: dispatchLease(exact) };

  assert.equal((await service.handle(httpRequest("/v1/b122/reanchor/codex", body, "Bearer wrong"))).status, 401);
  const generic = await service.handle(httpRequest("/v1/b122/command/reanchor", body));
  assert.equal(generic.status, 409);
  assert.match(String(generic.body.summary), /dedicated/i);
  assert.equal(port.reanchorCalls, 0);

  const missing = await service.handle(httpRequest("/v1/b122/reanchor/codex", exact));
  assert.equal(missing.status, 400);
  assert.equal(missing.body.effectDisposition, "not_started");

  const aliased = await service.handle(httpRequest("/v1/b122/reanchor/codex", {
    ...exact,
    dispatchLease: dispatchLease(exact, "reanchor.codex")
  }));
  assert.equal(aliased.status, 409);
  assert.equal(aliased.body.effectDisposition, "not_started");
  assert.equal(port.reanchorCalls, 0);

  const substitutedTarget = target({ branch: "attacker/substitution", capturedAt: "2026-08-25T12:00:02.000Z" });
  const substituted = await service.handle(httpRequest("/v1/b122/reanchor/codex", {
    ...body,
    newTargetSnapshotId: substitutedTarget.id,
    newTarget: substitutedTarget
  }));
  assert.equal(substituted.status, 400);
  assert.equal(substituted.body.effectDisposition, "not_started");
  assert.equal(port.reanchorCalls, 0);

  const completed = await service.handle(httpRequest("/v1/b122/reanchor/codex", body));
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.schema, "sxsy-b122.reanchor-acknowledgement");
  assert.equal((completed.body.report as { result: string }).result, "reanchored_without_resume");
  assert.equal(port.reanchorCalls, 1);

  const replay = await service.handle(httpRequest("/v1/b122/reanchor/codex", body));
  assert.equal(replay.status, 503);
  assert.equal(replay.body.effectDisposition, "ambiguous");
  assert.equal(port.reanchorCalls, 1);
});

test("Re-anchor rejects a stale or non-Controllable protected session before consuming the effect lease", async (context) => {
  const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const { service } = await createFixture(context, port);
  port.setSessionObservation("codex-session", { capabilities: ["registered", "observable"] });
  const exact = reanchorRequest("reanchor-operation:uncontrollable");
  const blocked = await service.handle(httpRequest("/v1/b122/reanchor/codex", { ...exact, dispatchLease: dispatchLease(exact) }));
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.effectDisposition, "not_started");
  assert.equal(port.reanchorCalls, 0);
});

test("Re-anchor rejects a substituted full protected ManagedSession before the provider effect", async (context) => {
  const { service, port } = await createFixture(context);
  const exact = reanchorRequest("reanchor-operation:session-substitution");
  const substituted = rebindRequest(exact, {
    session: { ...exact.session, adapterVersion: "codex-substituted-v1" }
  });
  const blocked = await service.handle(httpRequest("/v1/b122/reanchor/codex", {
    ...substituted,
    dispatchLease: dispatchLease(substituted)
  }));
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.effectDisposition, "not_started");
  assert.equal(port.reanchorCalls, 0);
});

test("Re-anchor reports are closed, bounded, and redacted before leaving the provider backend", async () => {
  class SecretBearingPort extends FixtureProviderRuntimePort {
    constructor() { super("codex", { effectfulTestOnly: true }); }
    override async reanchor(request: ProviderRuntimeReanchorRequest) {
      const acknowledgement = await super.reanchor(request);
      return {
        ...acknowledgement,
        report: {
          summary: "token=provider-secret-value owner@example.com",
          discrepancies: ["Bearer abcdefghijklmnop"],
          risks: ["github_pat_abcdefghijk"],
          questions: ["password=hunter2"],
          result: "reanchored_without_resume" as const
        }
      };
    }
  }
  const port = new SecretBearingPort();
  const backend = new CodexProviderAdapterBackend(port);
  await backend.handshake({ sessionId: "codex-session", provider: "codex", targetSnapshotId: oldTarget.id, repositoryRoot: oldTarget.repositoryRoot }, new AbortController().signal);
  const acknowledgement = await backend.reanchor(reanchorRequest("reanchor-operation:redaction"), new AbortController().signal);
  assert.doesNotMatch(JSON.stringify(acknowledgement.report), /provider-secret|owner@example|abcdefghijklmnop|hunter2/i);
  assert.match(JSON.stringify(acknowledgement.report), /REDACTED/);
});

test("backend binds the provider observation to the protected ManagedSession adapter and capabilities", async () => {
  class SubstitutingObservationPort extends FixtureProviderRuntimePort {
    constructor() { super("codex", { effectfulTestOnly: true }); }
    override async observeSession(
      request: Parameters<ProviderRuntimePort["observeSession"]>[0],
      signal?: AbortSignal
    ) {
      const observed = await super.observeSession(request, signal);
      return { ...observed, adapterVersion: "codex-substituted-v1" };
    }
  }
  const port = new SubstitutingObservationPort();
  const backend = new CodexProviderAdapterBackend(port);
  await backend.handshake({
    sessionId: "codex-session",
    provider: "codex",
    targetSnapshotId: oldTarget.id,
    repositoryRoot: oldTarget.repositoryRoot
  }, new AbortController().signal);
  await assert.rejects(
    () => backend.reanchor(reanchorRequest("reanchor-operation:provider-session-substitution"), new AbortController().signal),
    /adapter|ManagedSession|binding/i
  );
  assert.equal(port.reanchorCalls, 0);
});

test("restart reconciliation observes an ambiguous Re-anchor acknowledgement without reapplying", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-reanchor-recovery-"));
  context.after(async () => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const stateFile = join(directory, "state.jsonl");
  const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const first = await createFixture(context, port, stateFile);
  port.loseNextReanchorResponseAfterCommit();
  const exact = reanchorRequest("reanchor-operation:recover");
  const body = { ...exact, dispatchLease: dispatchLease(exact) };
  const ambiguous = await first.service.handle(httpRequest("/v1/b122/reanchor/codex", body));
  assert.equal(ambiguous.status, 503);
  assert.equal(ambiguous.body.effectDisposition, "ambiguous");
  assert.equal(port.reanchorCalls, 1);

  const restarted = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(stateFile, token),
    backends: [new CodexProviderAdapterBackend(port)],
    dispatchLease: { authenticationKey: leaseKey, host: hostIdentity },
    now: () => fixedNow
  });
  const receipt = await restarted.reconcile();
  assert.deepEqual(receipt, { operationsInspected: 1, operationsSettled: 1, councilsInspected: 0, councilsSettled: 0 });
  assert.equal(port.reanchorCalls, 1, "recovery must only observe the exact effect");
  const replay = await restarted.handle(httpRequest("/v1/b122/reanchor/codex", body));
  assert.equal(replay.status, 503);
  assert.equal(port.reanchorCalls, 1);
});

test("fixed authenticated Re-anchor observation route returns only the exact durable acknowledgement without replay", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-reanchor-observe-"));
  context.after(async () => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const stateFile = join(directory, "state.jsonl");
  const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const first = await createFixture(context, port, stateFile);
  port.loseNextReanchorResponseAfterCommit();
  const exact = reanchorRequest("reanchor-operation:wire-observation");
  const ambiguous = await first.service.handle(httpRequest("/v1/b122/reanchor/codex", {
    ...exact,
    dispatchLease: dispatchLease(exact)
  }));
  assert.equal(ambiguous.status, 503);
  assert.equal(port.reanchorCalls, 1);

  const restarted = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(stateFile, token),
    backends: [new CodexProviderAdapterBackend(port)],
    dispatchLease: { authenticationKey: leaseKey, host: hostIdentity },
    now: () => fixedNow
  });
  const path = "/v1/b122/observe/reanchor/codex";
  assert.equal((await restarted.handle(httpRequest(path, exact, "Bearer wrong"))).status, 401);
  const unknown = rebindRequest(exact, { operationId: "reanchor-operation:unknown-observation" });
  assert.equal((await restarted.handle(httpRequest(path, unknown))).status, 409);

  const observed = await restarted.handle(httpRequest(path, exact));
  assert.equal(observed.status, 200, JSON.stringify(observed.body));
  assert.equal(observed.body.schema, "sxsy-b122.reanchor-acknowledgement");
  assert.equal(observed.body.operationId, exact.operationId);
  assert.equal(observed.body.artifactDigest, exact.artifactDigest);
  assert.equal((observed.body.report as { result: string }).result, "reanchored_without_resume");
  assert.equal(port.reanchorCalls, 1, "observation recovery must never reapply the provider effect");

  const repeated = await restarted.handle(httpRequest(path, exact));
  assert.deepEqual(repeated, observed, "the protected acknowledgement is idempotent observation data");
  assert.equal(port.reanchorCalls, 1);
});

test("backend rejects provider acknowledgement substitution", async () => {
  class SubstitutingPort extends FixtureProviderRuntimePort {
    constructor() { super("codex", { effectfulTestOnly: true }); }
    override async reanchor(request: ProviderRuntimeReanchorRequest) {
      const acknowledgement = await super.reanchor(request);
      return { ...acknowledgement, authorityId: "authority-substituted" };
    }
  }
  const port = new SubstitutingPort();
  const backend = new CodexProviderAdapterBackend(port);
  await backend.handshake({ sessionId: "codex-session", provider: "codex", targetSnapshotId: oldTarget.id, repositoryRoot: oldTarget.repositoryRoot }, new AbortController().signal);
  await assert.rejects(() => backend.reanchor(reanchorRequest("reanchor-operation:substitution"), new AbortController().signal), /acknowledgement|binding/i);
});

test("backend rejects a stop-only acknowledgement without exact reread and report proof", async () => {
  class StopOnlyPort extends FixtureProviderRuntimePort {
    constructor() { super("codex", { effectfulTestOnly: true }); }
    override async reanchor(request: ProviderRuntimeReanchorRequest) {
      const acknowledgement = await super.reanchor(request);
      const { artifactDigest: _artifactDigest, rereadEvidence: _rereadEvidence, report: _report, ...stopOnly } = acknowledgement;
      return stopOnly as unknown as typeof acknowledgement;
    }
  }
  const port = new StopOnlyPort();
  const backend = new CodexProviderAdapterBackend(port);
  await backend.handshake({
    sessionId: "codex-session",
    provider: "codex",
    targetSnapshotId: oldTarget.id,
    repositoryRoot: oldTarget.repositoryRoot
  }, new AbortController().signal);
  await assert.rejects(
    () => backend.reanchor(reanchorRequest("reanchor-operation:stop-only"), new AbortController().signal),
    /acknowledgement|binding/i
  );
});
