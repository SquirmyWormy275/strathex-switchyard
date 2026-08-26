import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProviderDispatchLeaseAuthority } from "../../provider-adapter-host/src/dispatch-lease.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, type JournalAuthenticator, sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { DurableCredentialReferenceVault, type CredentialAdapterPort, type CredentialLease, type CredentialLeaseRequest } from "../src/durable-credentials.ts";
import {
  CredentialBackedProviderDispatchLeaseIssuer,
  DurableProviderDispatchProfileRegistry,
  PinnedProviderDispatchLeaseProfileSource,
  providerDispatchProfileIdentityDigest,
  type ProviderDispatchLeaseFinalCurrent,
  type ProviderDispatchLeaseProfile,
  type ProviderHostLifecycleIdentitySource
} from "../src/provider-dispatch-lease.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";

const key = "7".repeat(64);
const repositoryRoot = "C:\\b122\\dispatch-lease-repository";
const dispatchCredentialReference = `b122-provider-dispatch-lease-${"d".repeat(32)}`;
const bearerCredentialReference = `b122-provider-bearer-${"c".repeat(32)}`;
const now = "2026-08-25T18:00:00.000Z";
const profileIdentity = {
  schema: "sxsy-b122.provider-host-dispatch-profile",
  version: 1,
  generation: 1,
  expectedPriorConfigurationSha256: null,
  expectedPriorProfileDigest: null,
  repositoryRoot,
  configurationPath: "C:\\Users\\operator\\AppData\\Local\\STRATHEX\\switchyard\\provider-host\\provider-host.json",
  configurationSha256: "1".repeat(64),
  tlsSpkiSha256: "2".repeat(64),
  bearerCredentialReference,
  dispatchLeaseCredentialReference: dispatchCredentialReference,
  providers: [
    { provider: "claude", adapterId: "sxsy-b122.module.claude", moduleSha256: "3".repeat(64) },
    { provider: "codex", adapterId: "sxsy-b122.module.codex", moduleSha256: "4".repeat(64) }
  ]
} as const;
const profile: ProviderDispatchLeaseProfile = { ...profileIdentity, profileDigest: providerDispatchProfileIdentityDigest(profileIdentity) };

test("credential-backed issuer signs one <=60s exact lease after two final-current barriers and one key redemption", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-lease-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const store = authenticatedStore(join(root, "journal.jsonl"));
  const registry = new DurableProviderDispatchProfileRegistry(store);
  await registry.install(profile);
  const lifecycle: ProviderHostLifecycleIdentitySource = {
    async current(input) {
      assert.equal(input.configurationPath, profile.configurationPath);
      return {
        configurationPath: profile.configurationPath,
        configurationSha256: profile.configurationSha256,
        lifecycleNonceSha256: "5".repeat(64),
        tlsSpkiSha256: profile.tlsSpkiSha256
      };
    }
  };
  const profiles = new PinnedProviderDispatchLeaseProfileSource(registry, lifecycle);
  const credentials = new SingleRedemptionCredential(key);
  const checks: string[] = [];
  const finalCurrent: ProviderDispatchLeaseFinalCurrent = {
    async assertCurrent(binding) {
      checks.push(binding.operationId);
      assert.equal(binding.target.id, target.id);
      assert.equal(binding.authority.id, authority.id);
      assert.equal(binding.session.id, session.id);
      assert.deepEqual(binding.host, {
        configurationSha256: profile.configurationSha256,
        lifecycleNonceSha256: "5".repeat(64),
        tlsSpkiSha256: profile.tlsSpkiSha256
      });
      return { allowed: true, reason: "exact binding remains current" };
    }
  };
  const issuer = new CredentialBackedProviderDispatchLeaseIssuer({
    credentials,
    profiles,
    finalCurrent,
    now: () => new Date(now),
    ttlMs: 30_000,
    idFactory: () => "lease-1",
    nonceFactory: () => "6".repeat(64)
  });
  const lease = await issuer.issue({
    routeId: "provider.plan_approval",
    action: "plan_approval",
    operationId: "operation-1",
    target,
    session,
    authority,
    artifact,
    confirmation,
    containment: { status: "clear", bindingDigest: "9".repeat(64), fenceEpoch: 11, activationOperationId: null }
  });

  assert.equal(credentials.redemptions, 1);
  assert.deepEqual(checks, ["operation-1", "operation-1"]);
  assert.equal(Date.parse(lease.expiresAt) - Date.parse(lease.issuedAt), 30_000);
  assert.equal(lease.authority.grantDigest, sha256(stableJson(authority)));
  assert.equal(lease.target.canonicalRemote, null);
  assert.equal(lease.target.defaultBranch, "main");
  assert.equal(lease.target.detached, false);
  assert.deepEqual(lease.artifact, artifact);
  assert.deepEqual(lease.confirmation, confirmation);

  const authorityVerifier = new ProviderDispatchLeaseAuthority({
    authenticationKey: key,
    store,
    host: lease.host,
    now: () => now
  });
  await authorityVerifier.consume(lease, {
    provider: "codex",
    routeId: "provider.plan_approval",
    action: "plan_approval",
    operationId: "operation-1",
    authorityId: authority.id,
    target,
    session: lease.session,
    artifact,
    confirmation,
    module: lease.module
  });
  await assert.rejects(() => authorityVerifier.consume(lease, {
    provider: "codex", routeId: "provider.plan_approval", action: "plan_approval", operationId: "operation-1",
    authorityId: authority.id, target, session: lease.session, artifact, confirmation, module: lease.module
  }), /already consumed|replay/i);
});

test("issuer fails closed before redemption on cancellation, stale binding, invalid authority, or an overlong lease", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-lease-deny-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const store = authenticatedStore(join(root, "journal.jsonl"));
  const registry = new DurableProviderDispatchProfileRegistry(store);
  await registry.install(profile);
  const profiles = new PinnedProviderDispatchLeaseProfileSource(registry, {
    async current() { return { configurationPath: profile.configurationPath, configurationSha256: profile.configurationSha256, lifecycleNonceSha256: "5".repeat(64), tlsSpkiSha256: profile.tlsSpkiSha256 }; }
  });
  const cancelledCredentials = new SingleRedemptionCredential(key);
  const cancelled = new AbortController();
  cancelled.abort("containment");
  const allow: ProviderDispatchLeaseFinalCurrent = { async assertCurrent() { return { allowed: true, reason: "current" }; } };
  const cancelledIssuer = new CredentialBackedProviderDispatchLeaseIssuer({ credentials: cancelledCredentials, profiles, finalCurrent: allow, now: () => new Date(now) });
  await assert.rejects(() => cancelledIssuer.issue(baseIssue(cancelled.signal)), /cancel/i);
  assert.equal(cancelledCredentials.redemptions, 0);

  const staleCredentials = new SingleRedemptionCredential(key);
  const staleIssuer = new CredentialBackedProviderDispatchLeaseIssuer({
    credentials: staleCredentials,
    profiles,
    finalCurrent: { async assertCurrent() { return { allowed: false, reason: "Target snapshot changed." }; } },
    now: () => new Date(now)
  });
  await assert.rejects(() => staleIssuer.issue(baseIssue()), /Target snapshot changed/);
  assert.equal(staleCredentials.redemptions, 0);

  const invalidCredentials = new SingleRedemptionCredential(key);
  const invalidIssuer = new CredentialBackedProviderDispatchLeaseIssuer({ credentials: invalidCredentials, profiles, finalCurrent: allow, now: () => new Date(now) });
  await assert.rejects(() => invalidIssuer.issue({ ...baseIssue(), authority: { ...authority, repositoryRoot: "C:\\other" } }), /authority.*target/i);
  assert.equal(invalidCredentials.redemptions, 0);
  await assert.rejects(() => invalidIssuer.issue({ ...baseIssue(), session: { ...session, capabilities: ["mediated"] } }), /hierarchy|registered.*observable.*controllable.*mediated/i);
  assert.equal(invalidCredentials.redemptions, 0);
  assert.throws(() => new CredentialBackedProviderDispatchLeaseIssuer({ credentials: invalidCredentials, profiles, finalCurrent: allow, ttlMs: 60_001 }), /60/i);
});

test("issuer derives the exact hierarchical capability floor from the host-owned command catalog", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-lease-floor-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const registry = new DurableProviderDispatchProfileRegistry(authenticatedStore(join(root, "journal.jsonl")));
  await registry.install(profile);
  const profiles = new PinnedProviderDispatchLeaseProfileSource(registry, {
    async current() { return { configurationPath: profile.configurationPath, configurationSha256: profile.configurationSha256, lifecycleNonceSha256: "5".repeat(64), tlsSpkiSha256: profile.tlsSpkiSha256 }; }
  });
  const credentials = new SingleRedemptionCredential(key);
  const issuer = new CredentialBackedProviderDispatchLeaseIssuer({
    credentials,
    profiles,
    finalCurrent: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    now: () => new Date(now)
  });
  const advisorySession = { ...session, capabilities: ["registered", "observable"] as const };
  const advisoryAuthority = { ...authority, allowedActions: ["proof"] };
  const lease = await issuer.issue({
    ...baseIssue(),
    routeId: "provider.proof",
    action: "proof",
    operationId: "proof-operation",
    session: advisorySession,
    authority: advisoryAuthority,
    confirmation: null
  });
  assert.equal(lease.dispatch.action, "proof");
  assert.equal(credentials.redemptions, 1);
  await assert.rejects(() => issuer.issue({
    ...baseIssue(),
    routeId: "provider.proof",
    action: "proof",
    operationId: "proof-bad-hierarchy",
    session: { ...advisorySession, capabilities: ["observable"] },
    authority: advisoryAuthority,
    confirmation: null
  }), /hierarchy|registered/i);
  assert.equal(credentials.redemptions, 1);
});

test("issuer closes provider, automation, and automatic Council protocol routes before credential redemption", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-lease-routes-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const registry = new DurableProviderDispatchProfileRegistry(authenticatedStore(join(root, "journal.jsonl")));
  await registry.install(profile);
  const credentials = new SingleRedemptionCredential(key);
  const issuer = new CredentialBackedProviderDispatchLeaseIssuer({
    credentials,
    profiles: new PinnedProviderDispatchLeaseProfileSource(registry, {
      async current() { return { configurationPath: profile.configurationPath, configurationSha256: profile.configurationSha256, lifecycleNonceSha256: "5".repeat(64), tlsSpkiSha256: profile.tlsSpkiSha256 }; }
    }),
    finalCurrent: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    now: () => new Date(now)
  });
  const councilAuthority = { ...authority, allowedActions: ["council_automatic"] };
  const councilLease = await issuer.issue({
    ...baseIssue(),
    routeId: "council.codex",
    action: "council_pause",
    operationId: "council:epoch-1:pause",
    authority: councilAuthority,
    artifact: null,
    confirmation: null
  });
  assert.deepEqual(councilLease.dispatch, {
    routeId: "council.codex",
    action: "council_pause",
    operationId: "council:epoch-1:pause"
  });
  const assignmentArtifact = { id: "epoch-1", digest: "e".repeat(64), coordinatorContextDigest: null, coordinatorContextRevision: null } as const;
  const assignmentLease = await issuer.issue({
    ...baseIssue(),
    routeId: "council.codex",
    action: "council_assignment",
    operationId: "council:epoch-1:assignment",
    authority: councilAuthority,
    artifact: assignmentArtifact,
    confirmation: null
  });
  assert.deepEqual(assignmentLease.artifact, assignmentArtifact);
  const automationLease = await issuer.issue({
    ...baseIssue(),
    routeId: "automation.compound_capture",
    action: "compound_capture",
    operationId: "automation-operation",
    authority: { ...authority, allowedActions: ["compound_capture"] },
    artifact: null,
    confirmation: null
  });
  assert.equal(automationLease.dispatch.routeId, "automation.compound_capture");
  assert.equal(credentials.redemptions, 3);

  const rejected = [
    { ...baseIssue(), routeId: "automation.proof", action: "proof", authority: { ...authority, allowedActions: ["proof"] } },
    { ...baseIssue(), routeId: "provider.compound_capture", action: "compound_capture", authority: { ...authority, allowedActions: ["compound_capture"] }, artifact: null, confirmation: null },
    { ...baseIssue(), routeId: "council.claude", action: "council_pause", operationId: "council:epoch-1:pause", authority: councilAuthority, artifact: null, confirmation: null },
    { ...baseIssue(), routeId: "council.codex", action: "council_pause", operationId: "council:epoch-1:resume", authority: councilAuthority, artifact: null, confirmation: null },
    { ...baseIssue(), routeId: "council.codex", action: "council_pause", operationId: "council:epoch-1:pause", authority: { ...authority, allowedActions: ["council_pause"] }, artifact: null, confirmation: null },
    { ...baseIssue(), routeId: "council.codex", action: "council_assignment", operationId: "council:epoch-1:assignment", authority: councilAuthority, artifact: null, confirmation: null }
  ];
  for (const request of rejected) await assert.rejects(() => issuer.issue(request), /route|Council|authority|artifact|protocol/i);
  assert.equal(credentials.redemptions, 3);
});

test("issuer applies one bounded cancellation epoch and refuses late profile, lifecycle, final-current, or credential settlement", async (context) => {
  const credentials = new SingleRedemptionCredential(key);
  let profileSettled = false;
  const profiles = { current: async () => new Promise<never>(() => { setTimeout(() => { profileSettled = true; }, 75); }) };
  const issuer = new CredentialBackedProviderDispatchLeaseIssuer({
    credentials,
    profiles,
    finalCurrent: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    now: () => new Date(now),
    issuanceTimeoutMs: 25
  });
  const started = Date.now();
  await assert.rejects(() => issuer.issue(baseIssue()), /timed out|deadline/i);
  assert.equal(Date.now() - started < 1_000, true);
  assert.equal(credentials.redemptions, 0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(profileSettled, true);

  const root = await mkdtemp(join(tmpdir(), "b122-provider-lease-lifecycle-timeout-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const registry = new DurableProviderDispatchProfileRegistry(authenticatedStore(join(root, "journal.jsonl")));
  await registry.install(profile);
  let lifecycleSettled = false;
  const lifecycleCredentials = new SingleRedemptionCredential(key);
  const lifecycleIssuer = new CredentialBackedProviderDispatchLeaseIssuer({
    credentials: lifecycleCredentials,
    profiles: new PinnedProviderDispatchLeaseProfileSource(registry, {
      async current() {
        await new Promise((resolve) => setTimeout(resolve, 75));
        lifecycleSettled = true;
        return { configurationPath: profile.configurationPath, configurationSha256: profile.configurationSha256, lifecycleNonceSha256: "5".repeat(64), tlsSpkiSha256: profile.tlsSpkiSha256 };
      }
    }),
    finalCurrent: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    now: () => new Date(now),
    issuanceTimeoutMs: 25
  });
  await assert.rejects(() => lifecycleIssuer.issue(baseIssue()), /timed out|deadline/i);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(lifecycleSettled, true);
  assert.equal(lifecycleCredentials.redemptions, 0);

  let firstFinalSettled = false;
  const firstFinalCredentials = new SingleRedemptionCredential(key);
  const firstFinalIssuer = new CredentialBackedProviderDispatchLeaseIssuer({
    credentials: firstFinalCredentials,
    profiles: immediateResolvedProfile(),
    finalCurrent: {
      async assertCurrent() {
        await new Promise((resolve) => setTimeout(resolve, 75));
        firstFinalSettled = true;
        return { allowed: true, reason: "late current" };
      }
    },
    now: () => new Date(now),
    issuanceTimeoutMs: 25
  });
  await assert.rejects(() => firstFinalIssuer.issue(baseIssue()), /timed out|deadline/i);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(firstFinalSettled, true);
  assert.equal(firstFinalCredentials.redemptions, 0);

  let finalChecks = 0;
  const delayedCredential = new DelayedRedemptionCredential(key, dispatchCredentialReference, 75);
  const delayedIssuer = new CredentialBackedProviderDispatchLeaseIssuer({
    credentials: delayedCredential,
    profiles: { async current() { return { host: { configurationSha256: profile.configurationSha256, lifecycleNonceSha256: "5".repeat(64), tlsSpkiSha256: profile.tlsSpkiSha256 }, module: profile.providers[1]!, credentialReference: dispatchCredentialReference }; } },
    finalCurrent: { async assertCurrent() { finalChecks += 1; return { allowed: true, reason: "current" }; } },
    now: () => new Date(now),
    issuanceTimeoutMs: 25
  });
  await assert.rejects(() => delayedIssuer.issue(baseIssue()), /timed out|deadline/i);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(delayedCredential.redemptions, 1);
  assert.equal(finalChecks, 1, "late credential settlement must not cross the second final-current barrier");

  let secondFinalChecks = 0;
  let leaseIds = 0;
  const secondFinalCredentials = new SingleRedemptionCredential(key);
  const secondFinalIssuer = new CredentialBackedProviderDispatchLeaseIssuer({
    credentials: secondFinalCredentials,
    profiles: immediateResolvedProfile(),
    finalCurrent: {
      async assertCurrent() {
        secondFinalChecks += 1;
        if (secondFinalChecks === 2) await new Promise((resolve) => setTimeout(resolve, 75));
        return { allowed: true, reason: "current" };
      }
    },
    now: () => new Date(now),
    idFactory: () => { leaseIds += 1; return "late-lease"; },
    issuanceTimeoutMs: 25
  });
  await assert.rejects(() => secondFinalIssuer.issue(baseIssue()), /timed out|deadline/i);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(secondFinalChecks, 2);
  assert.equal(secondFinalCredentials.redemptions, 1);
  assert.equal(leaseIds, 0, "late second final-current settlement must not mint a lease");
});

test("authenticated profile generations support exact rotation and multiple repository-scoped credential references", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-profile-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const store = authenticatedStore(join(root, "journal.jsonl"));
  const registry = new DurableProviderDispatchProfileRegistry(store);
  await registry.install(profile);
  const unversioned = { ...profile, tlsSpkiSha256: "a".repeat(64) };
  await assert.rejects(() => registry.install({ ...unversioned, profileDigest: providerDispatchProfileIdentityDigest(unversioned) }), /generation|prior|transition/i);
  const duplicate = await registry.install(profile);
  assert.equal(duplicate.configurationSha256, profile.configurationSha256);
  const rotatedIdentity = {
    ...profile,
    generation: 2,
    expectedPriorConfigurationSha256: profile.configurationSha256,
    expectedPriorProfileDigest: profile.profileDigest,
    configurationSha256: "e".repeat(64),
    tlsSpkiSha256: "f".repeat(64),
    bearerCredentialReference: `b122-provider-bearer-${"e".repeat(32)}`,
    dispatchLeaseCredentialReference: `b122-provider-dispatch-lease-${"e".repeat(32)}`
  } as const;
  const rotated = { ...rotatedIdentity, profileDigest: providerDispatchProfileIdentityDigest(rotatedIdentity) } as const;
  await registry.install(rotated);
  assert.equal((await registry.current(repositoryRoot))?.generation, 2);
  const secondRepository = "C:\\b122\\other-repository";
  const secondIdentity = {
    ...profile,
    repositoryRoot: secondRepository,
    configurationPath: "C:\\Users\\operator\\AppData\\Local\\STRATHEX\\switchyard\\provider-host\\other\\provider-host.json",
    configurationSha256: "a".repeat(64),
    bearerCredentialReference: `b122-provider-bearer-${"a".repeat(32)}`,
    dispatchLeaseCredentialReference: `b122-provider-dispatch-lease-${"a".repeat(32)}`
  } as const;
  const second = { ...secondIdentity, profileDigest: providerDispatchProfileIdentityDigest(secondIdentity) } as const;
  const historicalBearerReuse = {
    ...second,
    bearerCredentialReference: profile.bearerCredentialReference
  } as const;
  await assert.rejects(() => registry.install({
    ...historicalBearerReuse,
    profileDigest: providerDispatchProfileIdentityDigest(historicalBearerReuse)
  }), /already bound|reuses one/i);
  const historicalDispatchReuse = {
    ...second,
    dispatchLeaseCredentialReference: profile.dispatchLeaseCredentialReference
  } as const;
  await assert.rejects(() => registry.install({
    ...historicalDispatchReuse,
    profileDigest: providerDispatchProfileIdentityDigest(historicalDispatchReuse)
  }), /already bound|reuses one/i);
  await assert.rejects(() => registry.install({
    ...second,
    bearerCredentialReference: rotated.bearerCredentialReference,
    profileDigest: providerDispatchProfileIdentityDigest({ ...second, bearerCredentialReference: rotated.bearerCredentialReference })
  }), /already bound|reuses one/i);
  await registry.install(second);
  assert.notEqual((await registry.current(repositoryRoot))?.dispatchLeaseCredentialReference, (await registry.current(secondRepository))?.dispatchLeaseCredentialReference);
  assert.notEqual((await registry.current(repositoryRoot))?.bearerCredentialReference, (await registry.current(secondRepository))?.bearerCredentialReference);
  const vault = new DurableCredentialReferenceVault(store, new FakeUserSecretProtector(), { async check() { return { allowed: true, reason: "two-repository fixture" }; } });
  for (const installed of [rotated, second]) {
    await vault.provision({ reference: installed.bearerCredentialReference, scopes: [{ repositoryRoot: installed.repositoryRoot, adapterId: "configured-network", purpose: "provider-api" }] }, Buffer.from(`bearer-${installed.generation}`));
    await vault.provision({ reference: installed.dispatchLeaseCredentialReference, scopes: [{ repositoryRoot: installed.repositoryRoot, adapterId: "provider-dispatch-lease-issuer", purpose: "provider-dispatch-lease" }] }, Buffer.from(key));
  }
  assert.deepEqual((await vault.listReferences()).map((entry) => entry.reference).sort(), [
    rotated.bearerCredentialReference,
    rotated.dispatchLeaseCredentialReference,
    second.bearerCredentialReference,
    second.dispatchLeaseCredentialReference
  ].sort());
  const source = new PinnedProviderDispatchLeaseProfileSource(registry, {
    async current() { return { configurationPath: rotated.configurationPath, configurationSha256: "b".repeat(64), lifecycleNonceSha256: "5".repeat(64), tlsSpkiSha256: rotated.tlsSpkiSha256 }; }
  });
  await assert.rejects(() => source.current({ repositoryRoot, provider: "codex" }), /configuration.*changed|pin/i);
});

const targetIdentity = {
  repositoryRoot,
  defaultBranch: "main",
  trackedManifest: "tracked-v1",
  untrackedManifest: "untracked-v1",
  submodules: Object.freeze({}),
  policyVersion: "policy-v1",
  environmentFingerprint: "windows-x64",
  completeness: "complete" as const,
  reasons: Object.freeze([] as string[])
};
const target: TargetSnapshot = {
  id: targetSnapshotDigest(targetIdentity),
  ...targetIdentity,
  capturedAt: now
};
const session: ManagedSession = {
  id: "session-1",
  provider: "codex",
  surface: "bridge",
  capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running",
  workspaceRoot: repositoryRoot,
  targetSnapshotId: target.id,
  taskId: "task-1",
  planRevision: "plan-1",
  plannedFiles: ["src/example.ts"],
  lastHeartbeat: now,
  adapterVersion: "codex-v1",
  metadata: {}
};
const authority: AuthorityGrant = {
  id: "authority-1",
  repositoryRoot,
  sessionId: session.id,
  taskId: session.taskId,
  planRevision: session.planRevision,
  allowedActions: ["plan_approval"],
  prohibitedActions: [],
  expiresAt: "2026-08-25T19:00:00.000Z",
  issuedAt: "2026-08-25T17:00:00.000Z",
  issuedBy: "operator"
};
const artifact = { id: "artifact-1", digest: "8".repeat(64), coordinatorContextDigest: "a".repeat(64), coordinatorContextRevision: 2 } as const;
const confirmation = { digest: "b".repeat(64), scopeDigest: "c".repeat(64) } as const;

function baseIssue(signal?: AbortSignal) {
  return {
    routeId: "provider.plan_approval",
    action: "plan_approval",
    operationId: "operation-1",
    target,
    session,
    authority,
    artifact,
    confirmation,
    containment: { status: "clear" as const, bindingDigest: "9".repeat(64), fenceEpoch: 11, activationOperationId: null },
    ...(signal ? { signal } : {})
  };
}

function immediateResolvedProfile() {
  return {
    async current() {
      return {
        host: { configurationSha256: profile.configurationSha256, lifecycleNonceSha256: "5".repeat(64), tlsSpkiSha256: profile.tlsSpkiSha256 },
        module: profile.providers[1]!,
        credentialReference: dispatchCredentialReference
      };
    }
  };
}

class SingleRedemptionCredential implements CredentialAdapterPort {
  redemptions = 0;
  private readonly keyText: string;
  constructor(keyText: string) { this.keyText = keyText; }
  async acquireLease(_request: CredentialLeaseRequest): Promise<CredentialLease> { throw new Error("issuer must use one scoped withCredential redemption"); }
  async redeem<T>(_lease: CredentialLease, _consume: (cleartext: Uint8Array) => Promise<T>): Promise<T> { throw new Error("issuer must use one scoped withCredential redemption"); }
  async withCredential<T>(request: CredentialLeaseRequest, consume: (cleartext: Uint8Array) => Promise<T>): Promise<T> {
    this.redemptions += 1;
    assert.equal(request.reference, dispatchCredentialReference);
    assert.equal(request.repositoryRoot, repositoryRoot);
    assert.equal(request.purpose, "provider-dispatch-lease");
    assert.equal(request.ttlMs, 60_000);
    const bytes = Buffer.from(this.keyText, "ascii");
    try { return await consume(bytes); }
    finally { bytes.fill(0); }
  }
}

class DelayedRedemptionCredential implements CredentialAdapterPort {
  redemptions = 0;
  private readonly keyText: string;
  private readonly expectedReference: string;
  private readonly delayMs: number;
  constructor(keyText: string, expectedReference: string, delayMs: number) { this.keyText = keyText; this.expectedReference = expectedReference; this.delayMs = delayMs; }
  async acquireLease(_request: CredentialLeaseRequest): Promise<CredentialLease> { throw new Error("not used"); }
  async redeem<T>(_lease: CredentialLease, _consume: (cleartext: Uint8Array) => Promise<T>): Promise<T> { throw new Error("not used"); }
  async withCredential<T>(request: CredentialLeaseRequest, consume: (cleartext: Uint8Array) => Promise<T>): Promise<T> {
    this.redemptions += 1;
    assert.equal(request.reference, this.expectedReference);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const bytes = Buffer.from(this.keyText, "ascii");
    try { return await consume(bytes); }
    finally { bytes.fill(0); }
  }
}

function authenticatedStore(filePath: string): ProtectedJsonStore {
  const authenticator: JournalAuthenticator = {
    provider: "provider-dispatch-lease-test",
    async seal(hash) { return `tag:${hash}`; },
    async verify(hash, tag) { return tag === `tag:${hash}`; }
  };
  return new ProtectedJsonStore({ filePath, authenticator, requireAuthenticatedProtection: true, clock: () => now });
}
