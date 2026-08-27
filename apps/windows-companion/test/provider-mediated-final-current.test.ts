import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  signProviderDispatchLease,
  type ProviderDispatchLease,
  type ProviderDispatchLeaseUnsigned
} from "../../provider-adapter-host/src/dispatch-lease.ts";
import type { AuthorityGrant, ManagedSession, OperationRecord, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, sha256, stableJson, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { AuthenticatedPipeServer, createPipeConfiguration, savePipeConfiguration } from "../src/authenticated-pipe.ts";
import { CompanionService } from "../src/service.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";
import {
  DurableProviderMediatedFinalCurrent,
  InstalledProviderMediatedFinalCurrentClient,
  loadInstalledProviderMediatedFinalCurrentClient,
  type ProviderMediatedEffectBinding,
  type ProviderMediatedFinalCurrentRequest
} from "../src/provider-mediated-final-current.ts";

const nowText = "2026-08-26T17:00:00.000Z";
const repositoryRoot = "C:\\b122\\mediated-final-current";
const authenticator: JournalAuthenticator = {
  provider: "provider-mediated-final-current-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

test("authenticated provider callback returns one digest-bound receipt only after every live binding remains exact", async (context) => {
  const fixture = await createFixture(context);
  const request = fixture.request();
  const decision = await fixture.boundary.decide(request);

  assert.deepEqual(Object.keys(decision), [
    "schema", "version", "authorizationId", "leaseId", "operationId", "action", "sessionId", "authorityId",
    "targetSnapshotId", "repositoryRoot", "containmentBindingDigest", "containmentFenceEpoch", "challengeNonce",
    "allowed", "decidedAt", "expiresAt", "decisionDigest"
  ]);
  assert.equal(decision.schema, "sxsy-b122.provider-mediated-final-current-decision");
  assert.equal(decision.allowed, true);
  assert.equal(decision.expiresAt, request.expiresAt);
  const { decisionDigest, ...material } = decision;
  assert.equal(decisionDigest, sha256(stableJson(material)));
  assert.doesNotMatch(stableJson(decision), /credential|authenticationTag|token/i);

  await assert.rejects(() => fixture.restart().decide(request), /replay|already consumed/i);
});

test("unarmed and forged provider callback authorizations fail closed", async (context) => {
  const unarmed = await createFixture(context, false);
  await assert.rejects(() => unarmed.boundary.decide(unarmed.request()), /unarmed|forged/i);

  const armed = await createFixture(context);
  const forged = { ...armed.request(), authorizationId: "e".repeat(64) };
  await assert.rejects(() => armed.boundary.decide(forged), /authorization.*digest|forged|binding/i);
});

test("host-internal Council guard binding validates the parent operation and repository authority without changing pipe schema", async (context) => {
  const fixture = await createFixture(context, true, "council");
  const request = fixture.request();
  assert.equal(request.action, "council_pause");
  assert.equal(request.operationId, "council:epoch-1:pause");
  assert.equal(Object.hasOwn(request, "guardAction"), false);
  assert.equal(Object.hasOwn(request, "guardOperationId"), false);
  const decision = await fixture.boundary.decide(request);
  assert.equal(decision.allowed, true);
  assert.equal(fixture.live.targetAction, "council_automatic");

  const ordinary = await createFixture(context);
  await assert.rejects(() => ordinary.boundary.armFromIssuedLease({
    lease: ordinary.lease,
    target: ordinary.live.target,
    session: ordinary.live.session,
    authority: ordinary.live.authority,
    guardAction: "council_automatic",
    guardOperationId: "other-operation"
  }), /non-Council|guard/i);
});

test("installed provider-host client uses only authenticated pipe configuration and returns the exact companion decision", async (context) => {
  const fixture = await createFixture(context);
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(fixture.root, protector, "provider-final-current-test");
  await savePipeConfiguration(join(fixture.root, "authenticated-pipe.json"), configuration);
  const server = new AuthenticatedPipeServer(
    configuration,
    protector,
    new CompanionService({ providerMediatedFinalCurrent: fixture.boundary })
  );
  await server.start();
  context.after(async () => { await server.stop(); });
  const loaded = await loadInstalledProviderMediatedFinalCurrentClient(fixture.root, protector);
  assert.ok(loaded instanceof InstalledProviderMediatedFinalCurrentClient);
  const client = new InstalledProviderMediatedFinalCurrentClient({
    configuration,
    protector,
    now: () => new Date(nowText),
    requestLifetimeMs: 5_000,
    challengeFactory: () => "f".repeat(64)
  });

  const decision = await client.assertCurrent(fixture.binding, new AbortController().signal);
  assert.equal(decision.allowed, true);
  assert.equal(decision.authorizationId, fixture.binding.authorizationId);
  assert.match(decision.challengeNonce, /^[a-f0-9]{64}$/);
  const { decisionDigest, ...material } = decision;
  assert.equal(decisionDigest, sha256(stableJson(material)));
});

test("provider callback enforces its own bounded deadline when a live-state source does not settle", async (context) => {
  const fixture = await createFixture(context);
  const boundary = fixture.restart({
    operations: { async get() { return new Promise<never>(() => undefined); } },
    deadlineMs: 10
  });
  await assert.rejects(() => boundary.decide(fixture.request()), /deadline|cancel/i);
});

test("provider callback rejects malformed, substituted, stale, terminal, churned, contained, expired, and cancelled requests before authorization", async (context) => {
  const scenarios: readonly Readonly<{
    name: string;
    mutate(fixture: Awaited<ReturnType<typeof createFixture>>, request: ProviderMediatedFinalCurrentRequest): void | Promise<void>;
    pattern: RegExp;
  }>[] = [
    { name: "operation", mutate: (_fixture, request) => { Object.assign(request as unknown as Record<string, unknown>, { operationId: "other-operation" }); }, pattern: /authorization|binding|operation/i },
    { name: "action", mutate: (_fixture, request) => { Object.assign(request as unknown as Record<string, unknown>, { action: "plan_approval" }); }, pattern: /authorization|binding|action/i },
    { name: "session", mutate: (_fixture, request) => { Object.assign(request as unknown as Record<string, unknown>, { sessionId: "other-session" }); }, pattern: /authorization|binding|session/i },
    { name: "authority", mutate: (_fixture, request) => { Object.assign(request as unknown as Record<string, unknown>, { authorityId: "other-authority" }); }, pattern: /authorization|binding|authority/i },
    { name: "target", mutate: (_fixture, request) => { Object.assign(request as unknown as Record<string, unknown>, { targetSnapshotId: "f".repeat(64) }); }, pattern: /authorization|binding|target/i },
    { name: "root", mutate: (_fixture, request) => { Object.assign(request as unknown as Record<string, unknown>, { repositoryRoot: "C:\\other\\repo" }); }, pattern: /authorization|binding|repository/i },
    { name: "terminal operation", mutate: (fixture) => { fixture.live.operation = { ...fixture.live.operation, state: "recorded" }; }, pattern: /operation.*executing/i },
    { name: "session churn", mutate: (fixture) => { fixture.live.session = { ...fixture.live.session, planRevision: "plan-2" }; }, pattern: /session.*changed|session.*exact/i },
    { name: "authority churn", mutate: (fixture) => { fixture.live.authority = { ...fixture.live.authority, revokedAt: nowText }; }, pattern: /authority.*changed|authority.*exact/i },
    { name: "target churn", mutate: (fixture) => { fixture.live.target = { ...fixture.live.target, head: "changed" }; }, pattern: /target.*changed|target.*exact/i },
    { name: "containment", mutate: (fixture) => { fixture.live.containment = { status: "clear", bindingDigest: "e".repeat(64), fenceEpoch: 2, activationOperationId: null }; }, pattern: /containment.*changed|containment.*exact/i },
    { name: "expired", mutate: (_fixture, request) => { Object.assign(request as unknown as Record<string, unknown>, { expiresAt: "2026-08-26T16:59:59.000Z" }); }, pattern: /expired|validity/i }
  ];

  for (const scenario of scenarios) {
    await test(scenario.name, async (nested) => {
      const fixture = await createFixture(nested);
      const request = fixture.request();
      await scenario.mutate(fixture, request);
      await assert.rejects(() => fixture.boundary.decide(request), scenario.pattern);
    });
  }

  await test("malformed unknown key", async (nested) => {
    const fixture = await createFixture(nested);
    await assert.rejects(
      () => fixture.boundary.decide({ ...fixture.request(), unexpected: true } as unknown as ProviderMediatedFinalCurrentRequest),
      /schema|unexpected|field/i
    );
  });

  await test("caller cancellation", async (nested) => {
    const fixture = await createFixture(nested);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => fixture.boundary.decide(fixture.request(), controller.signal), /cancel/i);
  });
});

async function createFixture(context: { after(callback: () => void | Promise<void>): void }, arm = true, mode: "proof" | "council" = "proof") {
  const root = await mkdtemp(join(tmpdir(), "b122-mediated-final-current-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(root, "protected.jsonl"), authenticator, requireAuthenticatedProtection: true });

  const targetMaterial: Omit<TargetSnapshot, "id"> = {
    repositoryRoot,
    canonicalRemote: "https://github.com/example/repo.git",
    branch: "feat/provider-mediation",
    defaultBranch: "main",
    upstream: "origin/feat/provider-mediation",
    head: "1".repeat(40),
    indexTree: "2".repeat(40),
    trackedManifest: "3".repeat(64),
    untrackedManifest: "4".repeat(64),
    submodules: {},
    policyVersion: "policy-1",
    environmentFingerprint: "5".repeat(64),
    capturedAt: nowText,
    completeness: "complete",
    reasons: []
  };
  const target: TargetSnapshot = { ...targetMaterial, id: targetSnapshotDigest(targetMaterial) };
  const session: ManagedSession = {
    id: "provider-session",
    provider: "claude",
    surface: "bridge",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running",
    workspaceRoot: repositoryRoot,
    targetSnapshotId: target.id,
    taskId: "task-1",
    planRevision: "plan-1",
    plannedFiles: ["src/provider.ts"],
    lastHeartbeat: nowText,
    adapterVersion: "provider-host-v1",
    metadata: { "sxsy-b122.providerHandshake": "exact-route-v1", "sxsy-b122.providerHandshakeTarget": target.id }
  };
  const dispatchAction = mode === "council" ? "council_pause" : "proof";
  const routeId = mode === "council" ? "council.claude" : "provider.proof";
  const leaseOperationId = mode === "council" ? "council:epoch-1:pause" : "operation-1";
  const guardAction = mode === "council" ? "council_automatic" : "proof";
  const guardOperationId = mode === "council" ? "council-root-operation" : leaseOperationId;
  const authority: AuthorityGrant = {
    id: "authority-1",
    repositoryRoot,
    ...(mode === "proof" ? { sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision } : {}),
    allowedActions: [guardAction],
    prohibitedActions: [],
    issuedAt: "2026-08-26T16:59:00.000Z",
    expiresAt: "2026-08-26T17:01:00.000Z",
    issuedBy: "operator"
  };
  const operation: OperationRecord = {
    id: guardOperationId,
    idempotencyKey: "idempotency-1",
    action: guardAction,
    targetSnapshotId: target.id,
    state: "executing",
    createdAt: nowText,
    updatedAt: nowText,
    childIds: [],
    details: {}
  };
  const containment = containmentFor(repositoryRoot, 1);
  const unsignedLease: ProviderDispatchLeaseUnsigned = {
    schema: "sxsy-b122.provider-dispatch-lease",
    version: 1,
    leaseId: "lease-1",
    nonce: "6".repeat(64),
    issuedAt: nowText,
    expiresAt: "2026-08-26T17:00:30.000Z",
    authority: { id: authority.id, grantDigest: sha256(stableJson(authority)), scopeDigest: "7".repeat(64), expiresAt: authority.expiresAt },
    target: {
      id: target.id, repositoryRoot, canonicalRemote: target.canonicalRemote ?? null, branch: target.branch ?? null,
      defaultBranch: target.defaultBranch ?? null, detached: target.detached === true, upstream: target.upstream ?? null,
      head: target.head ?? null, indexTree: target.indexTree ?? null, trackedManifest: target.trackedManifest,
      untrackedManifest: target.untrackedManifest, submodules: target.submodules, policyVersion: target.policyVersion,
      environmentFingerprint: target.environmentFingerprint, capturedAt: target.capturedAt,
      completeness: target.completeness, reasons: target.reasons
    },
    session: { id: session.id, provider: "claude", taskId: session.taskId ?? null, planRevision: session.planRevision ?? null, adapterVersion: session.adapterVersion },
    dispatch: { routeId, action: dispatchAction, operationId: leaseOperationId },
    artifact: null,
    confirmation: null,
    containment,
    host: { configurationSha256: "8".repeat(64), lifecycleNonceSha256: "9".repeat(64), tlsSpkiSha256: "a".repeat(64) },
    module: { adapterId: "sxsy-b122.module.claude", moduleSha256: "b".repeat(64) }
  };
  const lease: ProviderDispatchLease = signProviderDispatchLease(unsignedLease, "c".repeat(64));
  const live = { operation, session, authority, target, containment, targetAction: undefined as string | undefined };
  const boundaryOptions = {
    store,
    operations: { async get() { return live.operation; } },
    sessions: { async get() { return live.session; } },
    authorities: { async get() { return live.authority; } },
    targets: { async current(input: Readonly<{ action: string }>) { live.targetAction = input.action; return live.target; } },
    containment: { async currentClear() { return live.containment; } },
    now: () => new Date(nowText),
    deadlineMs: 1_000
  };
  const boundary = new DurableProviderMediatedFinalCurrent(boundaryOptions);
  const bindingMaterial = {
    schema: "sxsy-b122.provider-mediated-effect-binding" as const,
    version: 1 as const,
    configurationSha256: unsignedLease.host.configurationSha256,
    provider: "claude" as const,
    adapterId: unsignedLease.module.adapterId,
    moduleSha256: unsignedLease.module.moduleSha256,
    leaseId: lease.leaseId,
    leaseDigest: sha256(stableJson(unsignedLease)),
    operationId: leaseOperationId,
    action: dispatchAction,
    routeId,
    sessionId: session.id,
    authorityId: authority.id,
    targetSnapshotId: target.id,
    repositoryRoot,
    containmentBindingDigest: containment.bindingDigest,
    containmentFenceEpoch: containment.fenceEpoch
  };
  const binding: ProviderMediatedEffectBinding = Object.freeze({
    ...bindingMaterial,
    authorizationId: sha256(stableJson(bindingMaterial))
  });
  const armed = arm ? await boundary.armFromIssuedLease({ lease, target, session, authority, guardAction, guardOperationId }) : { authorizationId: binding.authorizationId };

  return {
    root,
    boundary,
    restart: (overrides: Partial<typeof boundaryOptions> = {}) => new DurableProviderMediatedFinalCurrent({ ...boundaryOptions, ...overrides }),
    binding,
    lease,
    live,
    request: (): ProviderMediatedFinalCurrentRequest => ({
      schema: "sxsy-b122.provider-mediated-final-current-request",
      version: 1,
      authorizationId: armed.authorizationId,
      configurationSha256: unsignedLease.host.configurationSha256,
      provider: "claude",
      adapterId: unsignedLease.module.adapterId,
      moduleSha256: unsignedLease.module.moduleSha256,
      leaseId: lease.leaseId,
      leaseDigest: sha256(stableJson(unsignedLease)),
      operationId: leaseOperationId,
      action: dispatchAction,
      routeId,
      sessionId: session.id,
      authorityId: authority.id,
      targetSnapshotId: target.id,
      repositoryRoot,
      containmentBindingDigest: containment.bindingDigest,
      containmentFenceEpoch: containment.fenceEpoch,
      challengeNonce: "d".repeat(64),
      requestedAt: nowText,
      expiresAt: "2026-08-26T17:00:05.000Z"
    })
  };
}

function containmentFor(root: string, fenceEpoch: number) {
  const material = { repositoryRoot: root.toLowerCase(), status: "clear", fenceEpoch, activationOperationId: null } as const;
  return { status: "clear" as const, bindingDigest: sha256(stableJson(material)), fenceEpoch, activationOperationId: null };
}
