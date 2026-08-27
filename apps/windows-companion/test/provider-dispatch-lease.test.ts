import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProviderDispatchLeaseAuthority } from "../../provider-adapter-host/src/dispatch-lease.ts";
import { createLoopbackTlsFixture } from "../../provider-adapter-host/test/support/tls-fixture.ts";
import { commandActionIds, commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import {
  automationEffectLeaseArtifact,
  createAutomationIntent,
  type AutomationEnvelope
} from "../../../packages/control-plane/src/automation-protocol.ts";
import {
  automationManifestReviewScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, type JournalAuthenticator, sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { DurableCredentialReferenceVault, type CredentialAdapterPort, type CredentialLease, type CredentialLeaseRequest } from "../src/durable-credentials.ts";
import {
  CredentialBackedProviderDispatchLeaseIssuer,
  AttestedProviderDispatchProfileCoordinator,
  DurableProviderDispatchContainmentSource,
  DurableProviderDispatchProfileRegistry,
  InstalledProviderDispatchFinalCurrent,
  LeaseInjectingProviderCommandTransport,
  PinnedProviderDispatchLeaseProfileSource,
  providerDispatchProfileIdentityDigest,
  type ProviderDispatchLeaseFinalCurrent,
  type ProviderDispatchLeaseProfile,
  type ProviderHostLifecycleIdentitySource
} from "../src/provider-dispatch-lease.ts";
import type { ProviderCommandTransportRequest } from "../src/remote-adapters.ts";
import { DurableNetworkPolicyRegistry } from "../src/host-provisioning.ts";
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

function reviewedAutomationEnvelope(operationId = "automation-operation-capture"): AutomationEnvelope {
  const captureBytes = Buffer.from("# Dispatch lease capture\n", "utf8");
  const publicSession = {
    id: session.id,
    provider: "codex",
    surface: session.surface,
    capabilities: session.capabilities,
    taskId: session.taskId!,
    planRevision: session.planRevision!,
    plannedFiles: session.plannedFiles
  } as const;
  const publicTarget = {
    id: target.id,
    repositoryRoot,
    policyVersion: target.policyVersion,
    trackedManifest: "a".repeat(64),
    untrackedManifest: "b".repeat(64)
  } as const;
  const manifest = createAutomationOperationManifest({
    repositoryRoot,
    targetSnapshotId: target.id,
    sessionId: session.id,
    authorityId: "authority-automation",
    taskId: session.taskId!,
    planRevision: session.planRevision!,
    provider: "codex",
    createdAt: "2026-08-25T18:00:00.000Z",
    expiresAt: "2026-08-25T18:10:00.000Z"
  }, {
    kind: "compound_capture",
    solvedProblemEvidenceDigest: "1".repeat(64),
    verifiedOutcomeEvidenceDigest: "2".repeat(64),
    nonTrivialRationale: "The exact reviewed lease-bound result is reusable.",
    documents: [{
      path: "docs/solutions/dispatch-lease.md", mutation: "create", beforeDigest: null,
      afterDigest: sha256(captureBytes.toString("utf8")),
      content: { encoding: "base64", byteLength: captureBytes.length, data: captureBytes.toString("base64") }
    }],
    instructionFileMutation: { kind: "none" }
  });
  const approval = createAutomationManifestApproval({
    manifest,
    confirmationToken: `confirm-${operationId}`,
    confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
    confirmedAt: "2026-08-25T18:00:01.000Z",
    expiresAt: "2026-08-25T18:09:00.000Z"
  });
  const intent = createAutomationIntent("compound_capture", {
    digest: approval.confirmationDigest,
    scopeDigest: approval.reviewScopeDigest
  }, undefined, { manifest, approval });
  return {
    schema: "sxsy-b122.compound-capture-request",
    version: 1,
    action: "compound_capture",
    operationId,
    target: publicTarget,
    session: publicSession,
    authorityId: "authority-automation",
    manifest,
    approval,
    intent
  };
}

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
  const armed: unknown[] = [];
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
    nonceFactory: () => "6".repeat(64),
    mediatedFinalCurrent: {
      async armFromIssuedLease(input) {
        armed.push(input);
        return { authorizationId: "armed-authorization" };
      }
    }
  });
  const lease = await issuer.issue({
    routeId: "provider.plan_approval",
    action: "plan_approval",
    guardAction: "plan_approval",
    operationId: "operation-1",
    guardOperationId: "operation-1",
    target,
    session,
    authority,
    artifact,
    confirmation,
    containment: { status: "clear", bindingDigest: "9".repeat(64), fenceEpoch: 11, activationOperationId: null },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } }
  });

  assert.equal(credentials.redemptions, 1);
  assert.equal(armed.length, 1);
  assert.deepEqual(armed[0], { lease, target, session, authority, guardOperationId: "operation-1", guardAction: "plan_approval" });
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

test("Re-anchor lease is bound to the dedicated provider route, deterministic request operation, reviewed artifact, and one-use confirmation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-reanchor-lease-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const registry = new DurableProviderDispatchProfileRegistry(authenticatedStore(join(root, "journal.jsonl")));
  await registry.install(profile);
  const profiles = new PinnedProviderDispatchLeaseProfileSource(registry, {
    async current() { return { configurationPath: profile.configurationPath, configurationSha256: profile.configurationSha256, lifecycleNonceSha256: "5".repeat(64), tlsSpkiSha256: profile.tlsSpkiSha256 }; }
  });
  const credentials = new SingleRedemptionCredential(key);
  const issuer = new CredentialBackedProviderDispatchLeaseIssuer({
    credentials, profiles, finalCurrent: { async assertCurrent() { return { allowed: true, reason: "both exact targets are current" }; } }, now: () => new Date(now)
  });
  const requestId = `reanchor:${"a".repeat(64)}`;
  const operationId = `reanchor-operation:${sha256(requestId)}`;
  const reanchor = {
    ...baseIssue(), routeId: "provider.reanchor.codex", action: "reanchor", guardAction: "reanchor" as const,
    operationId, guardOperationId: operationId,
    authority: { ...authority, allowedActions: ["reanchor"] },
    artifact: { id: requestId, digest: "d".repeat(64), coordinatorContextDigest: null, coordinatorContextRevision: null },
    confirmation: { digest: "e".repeat(64), scopeDigest: "f".repeat(64) }
  };
  const lease = await issuer.issue(reanchor);
  assert.deepEqual(lease.dispatch, { routeId: "provider.reanchor.codex", action: "reanchor", operationId });
  assert.equal(lease.artifact?.id, requestId);
  assert.equal(credentials.redemptions, 1);
  await assert.rejects(() => issuer.issue({ ...reanchor, routeId: "provider.reanchor" }), /dedicated|route|protocol/i);
  await assert.rejects(() => issuer.issue({ ...reanchor, artifact: { ...reanchor.artifact, id: `reanchor:${"b".repeat(64)}` } }), /artifact|operation|binding/i);
  assert.equal(credentials.redemptions, 1, "route/artifact substitution must fail before key redemption");
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
    guardAction: "proof",
    operationId: "proof-operation",
    guardOperationId: "proof-operation",
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
    guardAction: "proof",
    operationId: "proof-bad-hierarchy",
    guardOperationId: "proof-bad-hierarchy",
    session: { ...advisorySession, capabilities: ["observable"] },
    authority: advisoryAuthority,
    confirmation: null
  }), /hierarchy|registered/i);
  assert.equal(credentials.redemptions, 1);
});

test("issuer closes provider and automatic Council routes while refusing automation effects before credential redemption", async (context) => {
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
  const councilAuthority: AuthorityGrant = {
    id: "authority-council-repository",
    repositoryRoot,
    allowedActions: ["council_automatic"],
    prohibitedActions: [],
    expiresAt: authority.expiresAt,
    issuedAt: authority.issuedAt,
    issuedBy: authority.issuedBy
  };
  const councilLease = await issuer.issue({
    ...baseIssue(),
    routeId: "council.codex",
    action: "council_pause",
    guardAction: "council_automatic",
    operationId: "council:epoch-1:pause",
    guardOperationId: "council-parent-operation",
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
    guardAction: "council_automatic",
    operationId: "council:epoch-1:assignment",
    guardOperationId: "council-parent-operation",
    authority: councilAuthority,
    artifact: assignmentArtifact,
    confirmation: null
  });
  assert.deepEqual(assignmentLease.artifact, assignmentArtifact);
  const automationArtifact = { id: "automation-approval-capture", digest: "1".repeat(64), coordinatorContextDigest: null, coordinatorContextRevision: null } as const;
  const rejected = [
    { ...baseIssue(), routeId: "automation.compound_capture", action: "compound_capture", guardAction: "compound_capture" as const, operationId: "automation-operation", guardOperationId: "automation-operation", authority: { ...authority, allowedActions: ["compound_capture"] }, artifact: automationArtifact, confirmation },
    { ...baseIssue(), routeId: "automation.lfg", action: "lfg", guardAction: "lfg" as const, operationId: "automation-lfg-operation", guardOperationId: "automation-lfg-operation", authority: { ...authority, allowedActions: ["lfg"] }, artifact: { id: "automation-approval-lfg", digest: "2".repeat(64), coordinatorContextDigest: null, coordinatorContextRevision: null }, confirmation },
    { ...baseIssue(), routeId: "automation.proof", action: "proof", authority: { ...authority, allowedActions: ["proof"] } },
    { ...baseIssue(), routeId: "provider.compound_capture", action: "compound_capture", authority: { ...authority, allowedActions: ["compound_capture"] }, artifact: automationArtifact, confirmation },
    { ...baseIssue(), routeId: "automation.compound_capture", action: "compound_capture", authority: { ...authority, allowedActions: ["compound_capture"] }, artifact: automationArtifact, confirmation: null },
    { ...baseIssue(), routeId: "council.claude", action: "council_pause", operationId: "council:epoch-1:pause", authority: councilAuthority, artifact: null, confirmation: null },
    { ...baseIssue(), routeId: "council.codex", action: "council_pause", operationId: "council:epoch-1:resume", authority: councilAuthority, artifact: null, confirmation: null },
    { ...baseIssue(), routeId: "council.codex", action: "council_pause", guardAction: "council_automatic" as const, guardOperationId: "council-parent-operation", operationId: "council:epoch-1:pause", authority: { ...authority, allowedActions: ["council_automatic"] }, artifact: null, confirmation: null },
    { ...baseIssue(), routeId: "council.codex", action: "council_pause", operationId: "council:epoch-1:pause", authority: { ...authority, allowedActions: ["council_pause"] }, artifact: null, confirmation: null },
    { ...baseIssue(), routeId: "council.codex", action: "council_assignment", operationId: "council:epoch-1:assignment", authority: councilAuthority, artifact: null, confirmation: null }
  ];
  for (const request of rejected) await assert.rejects(() => issuer.issue(request), /route|Council|authority|artifact|protocol|confirmation|guard|host-local|proposal-only/i);
  assert.equal(credentials.redemptions, 2);
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

test("last-boundary transport injects only a companion-minted lease and rechecks the effect guard", async () => {
  const issued: unknown[] = [];
  const forwarded: ProviderCommandTransportRequest[] = [];
  const issuer = {
    async issue(request: unknown) {
      issued.push(request);
      return { schema: "sxsy-b122.provider-dispatch-lease", version: 1, leaseId: "lease-from-companion" };
    }
  } as unknown as CredentialBackedProviderDispatchLeaseIssuer;
  const transport = new LeaseInjectingProviderCommandTransport({
    async request(input) {
      forwarded.push(input);
      return { outcome: "passed", routeId: input.routeId, detail: "fixture", effectDisposition: "ambiguous", body: Buffer.from("{}") };
    }
  }, issuer, new DurableProviderDispatchContainmentSource({ async get() { return undefined; } }));
  let guardChecks = 0;
  const trustedDispatch = {
    action: "plan_approval",
    guardAction: "plan_approval",
    operationId: "operation-1",
    guardOperationId: "operation-1",
    target,
    session,
    authority,
    artifact,
    confirmation,
    effectGuard: { async assertCurrent() { guardChecks += 1; return { allowed: true, reason: "current" }; } }
  } as const;
  await transport.request({
    routeId: "provider.plan_approval",
    repositoryRoot,
    body: JSON.stringify({ schema: "fixture", version: 1 }),
    trustedDispatch
  });
  assert.equal(issued.length, 1);
  assert.equal(guardChecks, 1);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0]!.trustedDispatch, undefined);
  assert.equal(JSON.parse(forwarded[0]!.body as string).dispatchLease.leaseId, "lease-from-companion");
  await assert.rejects(() => transport.request({ routeId: "provider.plan_approval", repositoryRoot, body: "{}" }), /trusted companion dispatch/i);
  await assert.rejects(() => transport.request({ routeId: "provider.plan_approval", repositoryRoot, body: JSON.stringify({ dispatchLease: {} }), trustedDispatch }), /own dispatch lease/i);
  await assert.rejects(() => transport.request({ routeId: "provider.health", repositoryRoot, body: "{}", trustedDispatch }), /non-effect route/i);
});

test("last-boundary transport refuses automation effects before lease issuance or provider forwarding", async () => {
  const issued: Parameters<CredentialBackedProviderDispatchLeaseIssuer["issue"]>[0][] = [];
  const forwarded: ProviderCommandTransportRequest[] = [];
  const issuer = {
    async issue(request: Parameters<CredentialBackedProviderDispatchLeaseIssuer["issue"]>[0]) {
      issued.push(request);
      return { schema: "sxsy-b122.provider-dispatch-lease", version: 1, leaseId: "lease-reviewed-automation" };
    }
  } as unknown as CredentialBackedProviderDispatchLeaseIssuer;
  const transport = new LeaseInjectingProviderCommandTransport({
    async request(input) {
      forwarded.push(input);
      return { outcome: "passed", routeId: input.routeId, detail: "fixture", effectDisposition: "ambiguous", body: Buffer.from("{}") };
    }
  }, issuer, new DurableProviderDispatchContainmentSource({ async get() { return undefined; } }));
  const envelope = reviewedAutomationEnvelope();
  const exactArtifact = automationEffectLeaseArtifact(envelope);
  const exactConfirmation = {
    digest: envelope.approval.confirmationDigest,
    scopeDigest: envelope.approval.reviewScopeDigest
  } as const;
  let guardChecks = 0;
  const automationAuthority: AuthorityGrant = {
    ...authority,
    id: envelope.authorityId,
    allowedActions: ["compound_capture"]
  };
  const trustedDispatch = {
    action: "compound_capture",
    guardAction: "compound_capture",
    operationId: envelope.operationId,
    guardOperationId: envelope.operationId,
    target,
    session,
    authority: automationAuthority,
    artifact: exactArtifact,
    confirmation: exactConfirmation,
    effectGuard: { async assertCurrent() { guardChecks += 1; return { allowed: true, reason: "current" }; } }
  } as const;

  await assert.rejects(() => transport.request({
    routeId: "automation.compound_capture", repositoryRoot, body: JSON.stringify(envelope), trustedDispatch
  }), /host-local|proposal-only|automation effect/i);

  const rejects = [
    { ...trustedDispatch, confirmation: { ...exactConfirmation, digest: "0".repeat(64) } },
    { ...trustedDispatch, artifact: { ...exactArtifact, digest: "0".repeat(64) } },
    { ...trustedDispatch, action: "lfg" as const, guardAction: "lfg" as const },
    { ...trustedDispatch, session: { ...session, id: "substituted-session" } },
    { ...trustedDispatch, target: { ...target, id: "0".repeat(64) } }
  ];
  for (const substituted of rejects) {
    await assert.rejects(() => transport.request({
      routeId: "automation.compound_capture",
      repositoryRoot,
      body: JSON.stringify(envelope),
      trustedDispatch: substituted
    }), /host-local|proposal-only|automation effect/i);
  }
  await assert.rejects(() => transport.request({
    routeId: "automation.compound_capture",
    repositoryRoot,
    body: JSON.stringify({ ...envelope, dispatchLease: { leaseId: "body-supplied" } }),
    trustedDispatch
  }), /host-local|proposal-only|automation effect/i);
  assert.equal(issued.length, 0, "no automation effect request may reach the lease issuer");
  assert.equal(forwarded.length, 0);
  assert.equal(guardChecks, 0);
});

test("last-boundary transport forwards no-effect automation proposals without minting an effect lease", async () => {
  let issuances = 0;
  const forwarded: ProviderCommandTransportRequest[] = [];
  const transport = new LeaseInjectingProviderCommandTransport({
    async request(input) {
      forwarded.push(input);
      return { outcome: "passed", routeId: input.routeId, detail: "proposal forwarded", effectDisposition: "ambiguous", body: Buffer.from("{}") };
    }
  }, {
    async issue() {
      issuances += 1;
      throw new Error("proposal must not mint a lease");
    }
  } as unknown as CredentialBackedProviderDispatchLeaseIssuer, new DurableProviderDispatchContainmentSource({ async get() { return undefined; } }));

  const proposal = await transport.request({
    routeId: "automation.proposal.compound_refresh",
    repositoryRoot,
    body: "{}"
  });
  assert.equal(proposal.outcome, "passed");
  assert.equal(issuances, 0);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0]!.trustedDispatch, undefined);
  await assert.rejects(() => transport.request({
    routeId: "automation.proposal.compound_refresh",
    repositoryRoot,
    body: "{}",
    trustedDispatch: {} as never
  }), /proposal.*trusted effect dispatch/i);
  assert.equal(forwarded.length, 1);
});

test("installed final-current guard rejects operation, session, authority, profile, containment, or target churn", async () => {
  let operation = { action: "plan_approval", targetSnapshotId: target.id, state: "executing" };
  let currentSession = session;
  let currentAuthority = authority;
  let currentProfile = await immediateResolvedProfile().current();
  let containmentRecord: Awaited<ReturnType<DurableProviderDispatchContainmentSource["currentClear"]>> | undefined;
  const containment = new DurableProviderDispatchContainmentSource({ async get() { return containmentRecord ? { repositoryRoot, fenceEpoch: containmentRecord.fenceEpoch, active: true, activatedAt: now, activatedByOperationId: "containment-op", reason: "fixture", uncontrolledPaths: [] } : undefined; } });
  const clear = await containment.currentClear(repositoryRoot);
  const finalCurrent = new InstalledProviderDispatchFinalCurrent({
    operations: { async get() { return operation; } },
    sessions: { async get() { return currentSession; } },
    authorities: { async get() { return currentAuthority; } },
    profiles: { async current() { return currentProfile; } },
    containment
  });
  let effectChecks = 0;
  const binding = {
    action: "plan_approval",
    guardAction: "plan_approval" as const,
    operationId: "operation-1",
    guardOperationId: "operation-1",
    routeId: "provider.plan_approval",
    target,
    session,
    authority,
    artifact,
    confirmation,
    containment: clear,
    host: currentProfile.host,
    module: currentProfile.module,
    credentialReference: currentProfile.credentialReference,
    effectGuard: { async assertCurrent() { effectChecks += 1; return { allowed: true, reason: "current" }; } }
  };
  assert.equal((await finalCurrent.assertCurrent(binding)).allowed, true);
  assert.equal(effectChecks, 1);
  operation = { ...operation, state: "completed" };
  assert.equal((await finalCurrent.assertCurrent(binding)).allowed, false);
  operation = { ...operation, state: "executing" };
  currentSession = { ...session, targetSnapshotId: "f".repeat(64) };
  assert.equal((await finalCurrent.assertCurrent(binding)).allowed, false);
  currentSession = session;
  currentAuthority = { ...authority, revokedAt: now };
  assert.equal((await finalCurrent.assertCurrent(binding)).allowed, false);
  currentAuthority = authority;
  currentProfile = { ...currentProfile, host: { ...currentProfile.host, lifecycleNonceSha256: "a".repeat(64) } };
  assert.equal((await finalCurrent.assertCurrent(binding)).allowed, false);
  currentProfile = await immediateResolvedProfile().current();
  containmentRecord = clear;
  assert.equal((await finalCurrent.assertCurrent(binding)).allowed, false);
});

test("installed final-current permits only exact verified-blocked Authority recovery sessions", async () => {
  const blockedSession: ManagedSession = { ...session, status: "verified_blocked" };
  let currentSession: ManagedSession = blockedSession;
  let operation = { action: "authority_broadcast", targetSnapshotId: target.id, state: "executing" };
  const currentAuthority: AuthorityGrant = { ...authority, allowedActions: ["authority_broadcast"] };
  const currentProfile = await immediateResolvedProfile().current();
  const containment = new DurableProviderDispatchContainmentSource({ async get() { return undefined; } });
  const clear = await containment.currentClear(repositoryRoot);
  const verifier = new InstalledProviderDispatchFinalCurrent({
    operations: { async get() { return operation; } },
    sessions: { async get() { return currentSession; } },
    authorities: { async get() { return currentAuthority; } },
    profiles: { async current() { return currentProfile; } },
    containment
  });
  const binding = {
    action: "authority_broadcast",
    guardAction: "authority_broadcast" as const,
    operationId: "operation-authority-broadcast",
    guardOperationId: "operation-authority-broadcast",
    routeId: "provider.authority_broadcast",
    target,
    session: blockedSession,
    authority: currentAuthority,
    artifact,
    confirmation,
    containment: clear,
    host: currentProfile.host,
    module: currentProfile.module,
    credentialReference: currentProfile.credentialReference,
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } }
  };

  assert.equal((await verifier.assertCurrent(binding)).allowed, true);
  currentSession = { ...blockedSession, status: "running" };
  assert.equal((await verifier.assertCurrent(binding)).allowed, false, "status churn must invalidate the exact Authority binding");
  currentSession = blockedSession;
  operation = { action: "proof", targetSnapshotId: target.id, state: "executing" };
  assert.equal((await verifier.assertCurrent({
    ...binding,
    action: "proof",
    guardAction: "proof",
    operationId: "operation-proof",
    guardOperationId: "operation-proof"
  })).allowed, false, "ordinary provider work must remain running-only");
});

test("installed final-current guard delegates only dedicated Re-anchor operations to the executing lifecycle", async () => {
  let active = true;
  let reanchorChecks = 0;
  const containment = new DurableProviderDispatchContainmentSource({ async get() { return undefined; } });
  const clear = await containment.currentClear(repositoryRoot);
  const currentProfile = await immediateResolvedProfile().current();
  const verifier = new InstalledProviderDispatchFinalCurrent({
    operations: { async get() { return undefined; } },
    sessions: { async get() { return session; } },
    authorities: { async get() { return { ...authority, allowedActions: ["reanchor"] }; } },
    profiles: { async current() { return currentProfile; } },
    containment,
    reanchor: {
      async assertCurrent(binding) {
        reanchorChecks += 1;
        assert.equal(binding.action, "reanchor");
        return active
          ? { allowed: true, reason: "The exact Re-anchor lifecycle is executing." }
          : { allowed: false, reason: "The Re-anchor lifecycle is settled." };
      }
    }
  });
  const requestId = `reanchor:${"a".repeat(64)}`;
  const operationId = `reanchor-operation:${sha256(requestId)}`;
  const binding = {
    action: "reanchor",
    guardAction: "reanchor" as const,
    operationId,
    guardOperationId: operationId,
    routeId: "provider.reanchor.codex",
    target,
    session,
    authority: { ...authority, allowedActions: ["reanchor"] },
    artifact: { id: requestId, digest: "d".repeat(64), coordinatorContextDigest: null, coordinatorContextRevision: null },
    confirmation: { digest: "e".repeat(64), scopeDigest: "f".repeat(64) },
    containment: clear,
    host: currentProfile.host,
    module: currentProfile.module,
    credentialReference: currentProfile.credentialReference,
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "both exact targets remain current" }; } }
  };
  assert.equal((await verifier.assertCurrent(binding)).allowed, true);
  assert.equal(reanchorChecks, 1);
  active = false;
  assert.equal((await verifier.assertCurrent(binding)).allowed, false);
  assert.equal(reanchorChecks, 2);
});

test("attested profile installation binds the exact scoped policy, TLS identity, and two credential roles", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-profile-install-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const repository = join(root, "repository");
  const policyPath = join(root, "provider-network-policy.json");
  const tls = createLoopbackTlsFixture();
  const identity = {
    ...profileIdentity,
    repositoryRoot: repository,
    configurationPath: join(root, "provider-host.json"),
    tlsSpkiSha256: tls.tlsSpkiSha256
  } as const;
  const installProfile = { ...identity, profileDigest: providerDispatchProfileIdentityDigest(identity) } as const;
  const routeIds = new Set<string>(["provider.health", "provider.reconcile"]);
  for (const action of commandActionIds) {
    if (action === "reanchor") continue;
    const executor = commandForAction(action).executor;
    if (executor === "agent") routeIds.add(`provider.${action}`);
  }
  for (const provider of ["claude", "codex"] as const) {
    routeIds.add(`provider.reanchor.${provider}`);
    for (const prefix of ["handshake", "council", "council-cleanup", "observe-session", "observe-workflow-context", "observe-operation", "observe-reanchor", "cancel"] as const) routeIds.add(`provider.${prefix}.${provider}`);
  }
  const policy = {
    version: 1,
    proxy: "direct",
    routes: [...routeIds].sort().map((id, index) => ({
      id,
      method: id === "provider.health" ? "GET" : "POST",
      url: `https://127.0.0.1:7443/v1/fixture/${index}`,
      redirects: "deny",
      boundary: "provider-host-loopback",
      tlsSpkiSha256: tls.tlsSpkiSha256,
      tlsCaCertificatePem: tls.certificatePem,
      credential: { reference: bearerCredentialReference, purpose: "provider-api", header: "authorization", prefix: "Bearer " }
    }))
  };
  await writeFile(policyPath, JSON.stringify(policy), "utf8");
  const store = authenticatedStore(join(root, "journal.jsonl"));
  const networkPolicies = new DurableNetworkPolicyRegistry(store, join(root, "installed-network-policy.json"), () => now);
  await networkPolicies.install(repository, policyPath, now);
  const vault = new DurableCredentialReferenceVault(store, new FakeUserSecretProtector(), { async check() { return { allowed: true, reason: "fixture" }; } });
  await vault.provision({ reference: bearerCredentialReference, scopes: [{ repositoryRoot: repository, adapterId: "configured-network", purpose: "provider-api" }] }, Buffer.from("bearer"));
  await vault.provision({ reference: dispatchCredentialReference, scopes: [{ repositoryRoot: repository, adapterId: "provider-dispatch-lease-issuer", purpose: "provider-dispatch-lease" }] }, Buffer.from(key));
  let approvals = 0;
  const profiles = new DurableProviderDispatchProfileRegistry(store);
  const coordinator = new AttestedProviderDispatchProfileCoordinator({
    profiles,
    networkPolicies,
    credentials: vault,
    presence: { async verify() { approvals += 1; return { verified: true, operator: "operator" }; } }
  });
  const installed = await coordinator.install(installProfile, policyPath);
  assert.equal(installed.profileDigest, installProfile.profileDigest);
  assert.equal(approvals, 1);
  assert.equal((await profiles.current(repository))?.configurationSha256, installProfile.configurationSha256);
  const wrongPath = join(root, "wrong-network-policy.json");
  await writeFile(wrongPath, JSON.stringify({ ...policy, routes: [] }), "utf8");
  await assert.rejects(() => coordinator.install(installProfile, wrongPath), /does not match.*attested/i);
  assert.equal(approvals, 1, "invalid source binding must fail before asking for presence");
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
    guardAction: "plan_approval" as const,
    operationId: "operation-1",
    guardOperationId: "operation-1",
    target,
    session,
    authority,
    artifact,
    confirmation,
    containment: { status: "clear" as const, bindingDigest: "9".repeat(64), fenceEpoch: 11, activationOperationId: null },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
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
