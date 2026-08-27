import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  signProviderDispatchLease,
  type ProviderDispatchLease,
  type ProviderDispatchLeaseArtifactBinding,
  type ProviderDispatchLeaseHostIdentity,
  type ProviderDispatchLeaseModuleIdentity,
  type ProviderDispatchLeaseUnsigned
} from "../../provider-adapter-host/src/dispatch-lease.ts";
import { commandActionIds, commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { AuthorityGrant, Capability, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { sha256, stableJson, type JournalEntry, type ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { CredentialAdapterPort, CredentialReferenceSummary } from "./durable-credentials.ts";
import type { ConfiguredNetworkPolicy } from "./configured-network.ts";
import type { DurableNetworkPolicyRegistry } from "./host-provisioning.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";
import type { DurableContainmentManager } from "../../../packages/control-plane/src/containment.ts";
import type { ProviderCommandTransport, ProviderCommandTransportRequest } from "./remote-adapters.ts";
import type { EffectGuard } from "../../../packages/control-plane/src/brokers.ts";

const profileInstalledKind = "provider-host.dispatch-profile-installed";
const maximumLeaseTtlMs = 60_000;
const defaultLeaseTtlMs = 30_000;
const credentialPurpose = "provider-dispatch-lease";

export interface ProviderDispatchLeaseProfile {
  readonly schema: "sxsy-b122.provider-host-dispatch-profile";
  readonly version: 1;
  readonly generation: number;
  readonly expectedPriorConfigurationSha256: string | null;
  readonly expectedPriorProfileDigest: string | null;
  readonly repositoryRoot: string;
  readonly configurationPath: string;
  readonly configurationSha256: string;
  readonly tlsSpkiSha256: string;
  readonly bearerCredentialReference: string;
  readonly dispatchLeaseCredentialReference: string;
  readonly profileDigest: string;
  readonly providers: readonly (Readonly<{ provider: "claude" | "codex" }> & ProviderDispatchLeaseModuleIdentity)[];
}

export interface ProviderHostLifecycleIdentity {
  readonly configurationPath: string;
  readonly configurationSha256: string;
  readonly lifecycleNonceSha256: string;
  readonly tlsSpkiSha256: string;
}

export interface ProviderHostLifecycleIdentitySource {
  current(input: Readonly<{
    repositoryRoot: string;
    provider: "claude" | "codex";
    configurationPath: string;
    signal?: AbortSignal;
  }>): Promise<ProviderHostLifecycleIdentity>;
}

export interface ProviderDispatchLeaseResolvedProfile {
  readonly host: ProviderDispatchLeaseHostIdentity;
  readonly module: ProviderDispatchLeaseModuleIdentity;
  readonly credentialReference: string;
}

export interface ProviderDispatchLeaseProfileSource {
  current(input: Readonly<{
    repositoryRoot: string;
    provider: "claude" | "codex";
    signal?: AbortSignal;
  }>): Promise<ProviderDispatchLeaseResolvedProfile>;
}

export class DurableProviderDispatchProfileRegistry {
  private readonly store: ProtectedJsonStore;

  constructor(store: ProtectedJsonStore) {
    if (!store.hasAuthenticatedProtection) throw new Error("Provider dispatch profiles require authenticated durable state.");
    this.store = store;
  }

  async install(value: ProviderDispatchLeaseProfile): Promise<ProviderDispatchLeaseProfile> {
    const profile = parseProfile(value);
    return this.store.transaction(async (transaction) => {
      const state = replayProfileState(await transaction.readEntries());
      const root = canonicalRoot(profile.repositoryRoot);
      const existing = state.profiles.get(root);
      if (existing) {
        if (stableJson(existing) === stableJson(profile)) return existing;
        requireProfileTransition(existing, profile);
      } else if (profile.generation !== 1 || profile.expectedPriorConfigurationSha256 !== null || profile.expectedPriorProfileDigest !== null) {
        throw new Error("The first authenticated provider dispatch profile must start at generation 1 without an expected prior profile.");
      }
      for (const reference of [profile.bearerCredentialReference, profile.dispatchLeaseCredentialReference]) {
        const owner = state.referenceOwners.get(reference);
        if (owner !== undefined && owner !== root) {
          throw new Error("A provider-host credential reference is already bound to another repository profile.");
        }
      }
      await transaction.append(profileInstalledKind, profile);
      return profile;
    });
  }

  async current(repositoryRoot: string): Promise<ProviderDispatchLeaseProfile | undefined> {
    return replayProfileState(await this.store.readEntries()).profiles.get(canonicalRoot(repositoryRoot));
  }
}

export interface ProviderDispatchProfileCredentialDirectory {
  listReferences(): Promise<readonly CredentialReferenceSummary[]>;
}

/**
 * Installs a profile only after the independently attested repository policy,
 * both opaque credential roles, and every provider-host route agree exactly.
 * The source policy is re-digested and the installed copy is re-resolved at
 * the final boundary, so a caller cannot pair a valid profile with another
 * repository's route or a replaced provisioning file.
 */
export class AttestedProviderDispatchProfileCoordinator {
  private readonly profiles: DurableProviderDispatchProfileRegistry;
  private readonly networkPolicies: DurableNetworkPolicyRegistry;
  private readonly credentials: ProviderDispatchProfileCredentialDirectory;
  private readonly presence: WindowsUserPresenceRunner;

  constructor(options: Readonly<{
    profiles: DurableProviderDispatchProfileRegistry;
    networkPolicies: DurableNetworkPolicyRegistry;
    credentials: ProviderDispatchProfileCredentialDirectory;
    presence: WindowsUserPresenceRunner;
  }>) {
    this.profiles = options.profiles;
    this.networkPolicies = options.networkPolicies;
    this.credentials = options.credentials;
    this.presence = options.presence;
  }

  async install(value: ProviderDispatchLeaseProfile, networkPolicyPath: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<ProviderDispatchLeaseProfile> {
    aborted(options.signal);
    const profile = parseProfile(value);
    await this.assertProvisioningBinding(profile, networkPolicyPath, options.signal);
    const approval = await this.presence.verify(`Install the exact provider-host dispatch profile for ${profile.repositoryRoot}.`);
    if (!approval.verified || !approval.operator?.trim()) throw new Error("Current-user presence did not approve provider dispatch-profile installation.");
    aborted(options.signal);
    await this.assertProvisioningBinding(profile, networkPolicyPath, options.signal);
    aborted(options.signal);
    return this.profiles.install(profile);
  }

  current(repositoryRoot: string): Promise<ProviderDispatchLeaseProfile | undefined> {
    return this.profiles.current(repositoryRoot);
  }

  private async assertProvisioningBinding(profile: ProviderDispatchLeaseProfile, networkPolicyPath: string, signal?: AbortSignal): Promise<void> {
    aborted(signal);
    if (!windowsAbsolute(networkPolicyPath)) throw new Error("Provider dispatch-profile installation requires one absolute network-policy source path.");
    const current = await this.networkPolicies.current(profile.repositoryRoot);
    if (!current || current.status !== "active" || !current.repositoryRoot || !sameRoot(current.repositoryRoot, profile.repositoryRoot)) {
      throw new Error("No active exact-repository network policy exists for this provider dispatch profile.");
    }
    const sourceBytes = await readFile(canonicalWindowsPath(networkPolicyPath));
    if (createHash("sha256").update(sourceBytes).digest("hex") !== current.sha256) throw new Error("The selected provider-host network policy does not match the current attested repository policy.");
    const policy = await this.networkPolicies.resolve(profile.repositoryRoot);
    requireProviderHostPolicy(profile, policy);
    const references = await this.credentials.listReferences();
    requireCredentialReference(references, profile.bearerCredentialReference, profile.repositoryRoot, "configured-network", "provider-api");
    requireCredentialReference(references, profile.dispatchLeaseCredentialReference, profile.repositoryRoot, "provider-dispatch-lease-issuer", credentialPurpose);
    aborted(signal);
  }
}

/**
 * Combines an immutable, authenticated profile with the exact running host
 * lifecycle identity. A stale configuration, TLS identity, or process epoch
 * cannot be used to mint a dispatch capability.
 */
export class PinnedProviderDispatchLeaseProfileSource implements ProviderDispatchLeaseProfileSource {
  private readonly profiles: DurableProviderDispatchProfileRegistry;
  private readonly lifecycle: ProviderHostLifecycleIdentitySource;

  constructor(profiles: DurableProviderDispatchProfileRegistry, lifecycle: ProviderHostLifecycleIdentitySource) {
    this.profiles = profiles;
    this.lifecycle = lifecycle;
  }

  async current(input: Readonly<{ repositoryRoot: string; provider: "claude" | "codex"; signal?: AbortSignal }>): Promise<ProviderDispatchLeaseResolvedProfile> {
    aborted(input.signal);
    const profile = await this.profiles.current(input.repositoryRoot);
    if (!profile) throw new Error("No immutable provider dispatch profile is installed for this repository.");
    const module = profile.providers.find((candidate) => candidate.provider === input.provider);
    if (!module) throw new Error("The immutable provider dispatch profile does not contain this provider module.");
    const lifecycle = await this.lifecycle.current({
      repositoryRoot: profile.repositoryRoot,
      provider: input.provider,
      configurationPath: profile.configurationPath,
      ...(input.signal ? { signal: input.signal } : {})
    });
    aborted(input.signal);
    if (lifecycle.configurationPath !== profile.configurationPath
      || lifecycle.configurationSha256 !== profile.configurationSha256
      || lifecycle.tlsSpkiSha256 !== profile.tlsSpkiSha256
      || !digest(lifecycle.lifecycleNonceSha256)) {
      throw new Error("The running provider-host configuration or TLS identity changed from its immutable pin.");
    }
    return Object.freeze({
      host: Object.freeze({
        configurationSha256: profile.configurationSha256,
        lifecycleNonceSha256: lifecycle.lifecycleNonceSha256,
        tlsSpkiSha256: profile.tlsSpkiSha256
      }),
      module: Object.freeze({ adapterId: module.adapterId, moduleSha256: module.moduleSha256 }),
      credentialReference: profile.dispatchLeaseCredentialReference
    });
  }
}

export class ConfiguredProviderHostLifecycleIdentitySource implements ProviderHostLifecycleIdentitySource {
  private readonly network: ProviderCommandTransport;
  private readonly policies: DurableNetworkPolicyRegistry;
  constructor(network: ProviderCommandTransport, policies: DurableNetworkPolicyRegistry) { this.network = network; this.policies = policies; }

  async current(input: Readonly<{ repositoryRoot: string; provider: "claude" | "codex"; configurationPath: string; signal?: AbortSignal }>): Promise<ProviderHostLifecycleIdentity> {
    aborted(input.signal);
    const policy = await this.policies.resolve(input.repositoryRoot);
    const route = policy.routes.find((candidate) => candidate.id === "provider.health");
    if (!route || route.boundary !== "provider-host-loopback" || !digest(route.tlsSpkiSha256)) throw new Error("The current repository policy has no exact pinned provider-host health route.");
    const result = await this.network.request({ routeId: "provider.health", repositoryRoot: input.repositoryRoot, ...(input.signal ? { signal: input.signal } : {}) });
    if (result.outcome !== "passed" || result.status !== 200 || !result.body) throw new Error("The pinned provider host did not return authenticated lifecycle health.");
    let value: unknown;
    try { value = JSON.parse(Buffer.from(result.body).toString("utf8")); }
    catch { throw new Error("The pinned provider host returned malformed lifecycle health."); }
    if (!record(value) || !exact(value, ["schema", "version", "status", "adapterVersion", "providers", "authenticatedState", "lifecycleNonceSha256", "processId", "configurationSha256"])
      || value.schema !== "sxsy-b122.provider-host-health" || value.version !== 1 || value.status !== "ready" || value.authenticatedState !== true
      || !Array.isArray(value.providers) || !value.providers.includes(input.provider) || !value.providers.every((provider) => provider === "claude" || provider === "codex")
      || !Number.isSafeInteger(value.processId) || (value.processId as number) < 1 || !digest(value.lifecycleNonceSha256) || !digest(value.configurationSha256)) {
      throw new Error("The pinned provider-host lifecycle health binding is invalid.");
    }
    aborted(input.signal);
    return Object.freeze({ configurationPath: canonicalWindowsPath(input.configurationPath), configurationSha256: value.configurationSha256, lifecycleNonceSha256: value.lifecycleNonceSha256, tlsSpkiSha256: route.tlsSpkiSha256 });
  }
}

export interface ProviderDispatchLeaseCurrentBinding {
  readonly action: string;
  readonly guardAction: CommandAction;
  readonly operationId: string;
  readonly guardOperationId: string;
  readonly routeId: string;
  readonly target: TargetSnapshot;
  readonly session: ManagedSession;
  readonly authority: AuthorityGrant;
  readonly artifact: ProviderDispatchLeaseArtifactBinding | null;
  readonly confirmation: Readonly<{ digest: string; scopeDigest: string }> | null;
  readonly containment: ProviderDispatchLeaseUnsigned["containment"];
  readonly host: ProviderDispatchLeaseHostIdentity;
  readonly module: ProviderDispatchLeaseModuleIdentity;
  readonly credentialReference: string;
  readonly effectGuard: EffectGuard;
}

export interface ProviderDispatchLeaseFinalCurrent {
  assertCurrent(binding: ProviderDispatchLeaseCurrentBinding): Promise<Readonly<{ allowed: boolean; reason: string }>>;
}

export interface ProviderDispatchLeaseIssueRequest {
  readonly routeId: string;
  readonly action: string;
  readonly guardAction: CommandAction;
  readonly operationId: string;
  readonly guardOperationId: string;
  readonly target: TargetSnapshot;
  readonly session: ManagedSession;
  readonly authority: AuthorityGrant;
  readonly artifact: ProviderDispatchLeaseArtifactBinding | null;
  readonly confirmation: Readonly<{ digest: string; scopeDigest: string }> | null;
  readonly containment: ProviderDispatchLeaseUnsigned["containment"];
  readonly effectGuard: EffectGuard;
  readonly signal?: AbortSignal;
}

export interface CredentialBackedProviderDispatchLeaseIssuerOptions {
  readonly credentials: CredentialAdapterPort;
  readonly profiles: ProviderDispatchLeaseProfileSource;
  readonly finalCurrent: ProviderDispatchLeaseFinalCurrent;
  readonly now?: () => Date;
  readonly ttlMs?: number;
  readonly idFactory?: () => string;
  readonly nonceFactory?: () => string;
  readonly issuanceTimeoutMs?: number;
  readonly mediatedFinalCurrent?: Readonly<{
    armFromIssuedLease(input: Readonly<{
      lease: ProviderDispatchLease;
      target: TargetSnapshot;
      session: ManagedSession;
      authority: AuthorityGrant;
      guardOperationId: string;
      guardAction: CommandAction;
    }>): Promise<Readonly<{ authorizationId: string }>>;
  }>;
}

/**
 * Mints one short-lived, single-host dispatch capability. The HMAC key is
 * obtained through one scoped vault redemption and never leaves its callback.
 */
export class CredentialBackedProviderDispatchLeaseIssuer {
  private readonly credentials: CredentialAdapterPort;
  private readonly profiles: ProviderDispatchLeaseProfileSource;
  private readonly finalCurrent: ProviderDispatchLeaseFinalCurrent;
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly idFactory: () => string;
  private readonly nonceFactory: () => string;
  private readonly issuanceTimeoutMs: number;
  private readonly mediatedFinalCurrent?: CredentialBackedProviderDispatchLeaseIssuerOptions["mediatedFinalCurrent"];

  constructor(options: CredentialBackedProviderDispatchLeaseIssuerOptions) {
    this.credentials = options.credentials;
    this.profiles = options.profiles;
    this.finalCurrent = options.finalCurrent;
    this.now = options.now ?? (() => new Date());
    this.ttlMs = boundedTtl(options.ttlMs ?? defaultLeaseTtlMs);
    this.idFactory = options.idFactory ?? randomUUID;
    this.nonceFactory = options.nonceFactory ?? (() => randomBytes(32).toString("hex"));
    this.issuanceTimeoutMs = boundedTtl(options.issuanceTimeoutMs ?? 10_000);
    this.mediatedFinalCurrent = options.mediatedFinalCurrent;
  }

  async issue(request: ProviderDispatchLeaseIssueRequest): Promise<ProviderDispatchLease> {
    const boundary = new IssuanceBoundary(request.signal, this.issuanceTimeoutMs);
    try {
      aborted(boundary.signal);
      validateDispatchBinding(request, this.now());
      const provider = request.session.provider as "claude" | "codex";
      const resolved = await boundary.wait(this.profiles.current({
        repositoryRoot: request.target.repositoryRoot,
        provider,
        signal: boundary.signal
      }));
      const binding = currentBinding(request, resolved);
      await boundary.wait(requireCurrent(this.finalCurrent, binding));
      aborted(boundary.signal);
      return await boundary.wait(this.credentials.withCredential({
        reference: resolved.credentialReference,
        repositoryRoot: request.target.repositoryRoot,
        purpose: credentialPurpose,
        ttlMs: maximumLeaseTtlMs
      }, async (cleartext) => {
        aborted(boundary.signal);
        if (!keyBytes(cleartext)) throw new Error("The protected provider dispatch-lease key is not exactly 256 canonical bits.");
        await boundary.wait(requireCurrent(this.finalCurrent, binding));
        aborted(boundary.signal);
        const issuedAt = exactNow(this.now());
        const authorityExpiry = Date.parse(request.authority.expiresAt);
        const expiresAtMs = Math.min(issuedAt.getTime() + this.ttlMs, authorityExpiry);
        if (expiresAtMs <= issuedAt.getTime()) throw new Error("The provider dispatch-lease authority expired before issuance.");
        const keyCopy = Buffer.from(cleartext);
        try {
          const unsigned: ProviderDispatchLeaseUnsigned = {
          schema: "sxsy-b122.provider-dispatch-lease",
          version: 1,
          leaseId: this.idFactory(),
          nonce: this.nonceFactory(),
          issuedAt: issuedAt.toISOString(),
          expiresAt: new Date(expiresAtMs).toISOString(),
          authority: {
            id: request.authority.id,
            grantDigest: sha256(stableJson(request.authority)),
            scopeDigest: authorityScopeDigest(request),
            expiresAt: request.authority.expiresAt
          },
          target: fullTarget(request.target),
          session: {
            id: request.session.id,
            provider,
            taskId: request.session.taskId ?? null,
            planRevision: request.session.planRevision ?? null,
            adapterVersion: request.session.adapterVersion
          },
          dispatch: { routeId: request.routeId, action: request.action, operationId: request.operationId },
          artifact: request.artifact,
          confirmation: request.confirmation,
          containment: request.containment,
          host: resolved.host,
          module: resolved.module
          };
          const lease = signProviderDispatchLease(unsigned, keyCopy.toString("ascii"));
          if (this.mediatedFinalCurrent && commandForAction(request.guardAction).requiresCapabilities.includes("mediated")) {
            await boundary.wait(this.mediatedFinalCurrent.armFromIssuedLease({
              lease,
              target: request.target,
              session: request.session,
              authority: request.authority,
              guardOperationId: request.guardOperationId,
              guardAction: request.guardAction
            }));
          }
          return lease;
        } finally { keyCopy.fill(0); }
      }));
    } finally { boundary.dispose(); }
  }
}

export class DurableProviderDispatchContainmentSource {
  private readonly containment: Pick<DurableContainmentManager, "get">;
  constructor(containment: Pick<DurableContainmentManager, "get">) { this.containment = containment; }

  async currentClear(repositoryRoot: string): Promise<ProviderDispatchLeaseUnsigned["containment"]> {
    const record = await this.containment.get(repositoryRoot);
    if (record?.active) throw new Error(`Containment fence ${record.fenceEpoch} blocks provider dispatch.`);
    const fenceEpoch = record?.fenceEpoch ?? 0;
    const material = { repositoryRoot: canonicalRoot(repositoryRoot), status: "clear", fenceEpoch, activationOperationId: null } as const;
    return Object.freeze({ status: "clear", bindingDigest: sha256(stableJson(material)), fenceEpoch, activationOperationId: null });
  }
}

export class InstalledProviderDispatchFinalCurrent implements ProviderDispatchLeaseFinalCurrent {
  private readonly operations: Readonly<{ get(id: string): Promise<Readonly<{ action: string; targetSnapshotId: string; state: string }> | undefined> }>;
  private readonly sessions: Readonly<{ get(id: string): Promise<ManagedSession | undefined> }>;
  private readonly authorities: Readonly<{ get(id: string): Promise<AuthorityGrant | undefined> }>;
  private readonly profiles: ProviderDispatchLeaseProfileSource;
  private readonly containment: DurableProviderDispatchContainmentSource;
  private readonly reanchor?: ProviderDispatchLeaseFinalCurrent;

  constructor(options: Readonly<{
    operations: InstalledProviderDispatchFinalCurrent["operations"];
    sessions: InstalledProviderDispatchFinalCurrent["sessions"];
    authorities: InstalledProviderDispatchFinalCurrent["authorities"];
    profiles: ProviderDispatchLeaseProfileSource;
    containment: DurableProviderDispatchContainmentSource;
    /** Dedicated durable Re-anchor lifecycle verifier; never used for generic operations. */
    reanchor?: ProviderDispatchLeaseFinalCurrent;
  }>) {
    this.operations = options.operations;
    this.sessions = options.sessions;
    this.authorities = options.authorities;
    this.profiles = options.profiles;
    this.containment = options.containment;
    this.reanchor = options.reanchor;
  }

  async assertCurrent(binding: ProviderDispatchLeaseCurrentBinding): Promise<Readonly<{ allowed: boolean; reason: string }>> {
    try {
      if (binding.action === "reanchor") {
        if (!this.reanchor) return { allowed: false, reason: "The dedicated durable Re-anchor lifecycle verifier is unavailable." };
        const reanchor = await this.reanchor.assertCurrent(binding);
        if (!reanchor.allowed) return reanchor;
      } else {
        const operation = await this.operations.get(binding.guardOperationId);
        if (!operation || operation.state !== "executing" || operation.action !== binding.guardAction || operation.targetSnapshotId !== binding.target.id) {
          return { allowed: false, reason: "The durable provider operation is absent, changed, or no longer executing." };
        }
      }
      const session = await this.sessions.get(binding.session.id);
      if (!session || !sameProviderSession(session, binding.session, binding.target, binding.guardAction)) {
        return { allowed: false, reason: "The exact managed provider session changed before dispatch." };
      }
      const authority = await this.authorities.get(binding.authority.id);
      if (!authority || stableJson(authority) !== stableJson(binding.authority)) {
        return { allowed: false, reason: "The exact provider authority changed before dispatch." };
      }
      const profile = await this.profiles.current({ repositoryRoot: binding.target.repositoryRoot, provider: binding.session.provider as "claude" | "codex" });
      if (stableJson(profile.host) !== stableJson(binding.host) || stableJson(profile.module) !== stableJson(binding.module)
        || profile.credentialReference !== binding.credentialReference) {
        return { allowed: false, reason: "The provider-host lifecycle, module, or dispatch credential profile changed before dispatch." };
      }
      const containment = await this.containment.currentClear(binding.target.repositoryRoot);
      if (stableJson(containment) !== stableJson(binding.containment)) {
        return { allowed: false, reason: "The containment epoch changed before provider dispatch." };
      }
      const current = await binding.effectGuard.assertCurrent({
        action: binding.guardAction,
        operationId: binding.guardOperationId,
        target: binding.target,
        session: binding.session,
        authority: binding.authority
      });
      return current.allowed ? { allowed: true, reason: "The exact provider dispatch binding remains current." } : current;
    } catch {
      return { allowed: false, reason: "The exact provider dispatch binding could not be revalidated." };
    }
  }
}

/** Adds a freshly minted lease to the exact typed JSON envelope at the last transport boundary. */
export class LeaseInjectingProviderCommandTransport implements ProviderCommandTransport {
  private readonly underlying: ProviderCommandTransport;
  private readonly issuer: CredentialBackedProviderDispatchLeaseIssuer;
  private readonly containment: DurableProviderDispatchContainmentSource;

  constructor(underlying: ProviderCommandTransport, issuer: CredentialBackedProviderDispatchLeaseIssuer, containment: DurableProviderDispatchContainmentSource) {
    this.underlying = underlying;
    this.issuer = issuer;
    this.containment = containment;
  }

  recoveryExternalId(input: Readonly<{ routeId: string; operationId: string; provider: ManagedSession["provider"] }>): string | undefined {
    if (input.routeId.startsWith("automation.")) return undefined;
    return this.underlying.recoveryExternalId?.(input);
  }

  handshakeCapabilityCeiling(input: Readonly<{ routeId: string; provider: ManagedSession["provider"]; repositoryRoot: string }>): Promise<readonly Capability[]> | readonly Capability[] {
    return this.underlying.handshakeCapabilityCeiling?.(input) ?? ["registered"];
  }

  async request(input: ProviderCommandTransportRequest) {
    if (input.routeId.startsWith("automation.proposal.")) {
      if (input.trustedDispatch) throw new Error("Automation proposal routes cannot carry a trusted effect dispatch binding.");
      return this.underlying.request(input);
    }
    if (input.routeId.startsWith("automation.")) {
      throw new Error("Automation effect routes are proposal-only at the provider boundary; reviewed effects execute only through the host-local broker.");
    }
    const effectRoute = providerEffectRoute(input.routeId);
    if (!effectRoute) {
      if (input.trustedDispatch) throw new Error("A trusted provider dispatch binding was supplied to a non-effect route.");
      return this.underlying.request(input);
    }
    const binding = input.trustedDispatch;
    if (!binding) throw new Error("Provider-host effect routes require one trusted companion dispatch binding.");
    if (!sameRoot(input.repositoryRoot, binding.target.repositoryRoot)) throw new Error("The provider transport repository does not match the trusted TargetSnapshot.");
    const routeId = councilLeaseRoute(input.routeId, binding.session.provider, binding.action);
    const document = parseDispatchDocument(input.body);
    if (Object.hasOwn(document, "dispatchLease")) throw new Error("The provider request body cannot supply its own dispatch lease.");
    const containment = await this.containment.currentClear(binding.target.repositoryRoot);
    const lease = await this.issuer.issue({
      routeId,
      action: binding.action,
      guardAction: binding.guardAction,
      operationId: binding.operationId,
      guardOperationId: binding.guardOperationId,
      target: binding.target,
      session: binding.session,
      authority: binding.authority,
      artifact: binding.artifact,
      confirmation: binding.confirmation,
      containment,
      effectGuard: binding.effectGuard,
      ...(input.signal ? { signal: input.signal } : {})
    });
    const final = await binding.effectGuard.assertCurrent({
      action: binding.guardAction,
      operationId: binding.guardOperationId,
      target: binding.target,
      session: binding.session,
      authority: binding.authority
    });
    if (!final.allowed) throw new Error(safeReason(final.reason));
    return this.underlying.request({
      routeId: input.routeId,
      repositoryRoot: input.repositoryRoot,
      body: JSON.stringify({ ...document, dispatchLease: lease }),
      ...(input.pathParameters ? { pathParameters: input.pathParameters } : {}),
      ...(input.signal ? { signal: input.signal } : {})
    });
  }
}

function validateDispatchBinding(request: ProviderDispatchLeaseIssueRequest, now: Date): void {
  if (!Number.isFinite(now.getTime())) throw new Error("The provider dispatch-lease clock is invalid.");
  if (request.session.provider !== "claude" && request.session.provider !== "codex") throw new Error("Provider dispatch requires one exact Claude or Codex session.");
  if (request.target.completeness !== "complete" || targetSnapshotDigest(request.target) !== request.target.id) throw new Error("Provider dispatch requires one complete canonical TargetSnapshot.");
  if (!request.session.workspaceRoot || !sameRoot(request.session.workspaceRoot, request.target.repositoryRoot)
    || request.session.targetSnapshotId !== request.target.id) throw new Error("The provider session does not match the exact target.");
  const authorityAction = requireDispatchProtocolBinding(request);
  const authorityScopeMatches = authorityAction === "council_automatic"
    ? request.authority.sessionId === undefined && request.authority.taskId === undefined && request.authority.planRevision === undefined
    : request.authority.sessionId === request.session.id && request.authority.taskId === request.session.taskId && request.authority.planRevision === request.session.planRevision;
  if (!sameRoot(request.authority.repositoryRoot, request.target.repositoryRoot) || !authorityScopeMatches) {
    throw new Error(authorityAction === "council_automatic"
      ? "Automatic Council provider phases require one exact repository-scoped authority independent of every participant session, task, and plan."
      : "The provider authority does not match the exact target, session, task, and plan.");
  }
  const authorityIssuedAt = Date.parse(request.authority.issuedAt);
  const authorityExpiresAt = Date.parse(request.authority.expiresAt);
  if (request.authority.revokedAt || !Number.isFinite(authorityIssuedAt) || !Number.isFinite(authorityExpiresAt)
    || authorityIssuedAt > now.getTime() || authorityExpiresAt <= now.getTime()) throw new Error("The provider authority is revoked, future-issued, or expired.");
  if (!identifier(request.routeId, 128) || !identifier(request.action) || !identifier(request.operationId) || !identifier(request.guardOperationId)) throw new Error("The provider dispatch route, action, or operation ID is invalid.");
  if (request.guardAction !== authorityAction) throw new Error("The provider dispatch effect guard is not bound to the exact authority action.");
  if (authorityAction !== "council_automatic" && request.guardOperationId !== request.operationId) throw new Error("A provider or automation dispatch cannot change its guarded operation identity.");
  if (!request.authority.allowedActions.includes(authorityAction) || request.authority.prohibitedActions.includes(authorityAction)) {
    throw new Error("The provider authority does not allow this exact action.");
  }
  if (request.artifact && ((request.artifact.coordinatorContextDigest === null) !== (request.artifact.coordinatorContextRevision === null))) {
    throw new Error("The provider dispatch artifact context binding is incomplete.");
  }
}

function providerEffectRoute(routeId: string): boolean {
  if (/^provider\.council\.(claude|codex)$/u.test(routeId)) return true;
  if (/^provider\.reanchor\.(claude|codex)$/u.test(routeId)) return true;
  for (const action of commandActionIds) {
    const executor = commandForAction(action).executor;
    if (executor === "agent" && routeId === `provider.${action}`) return true;
  }
  return false;
}
function councilLeaseRoute(networkRouteId: string, provider: ManagedSession["provider"], action: string): string {
  if (networkRouteId !== `provider.council.${provider}`) return networkRouteId;
  if (provider !== "claude" && provider !== "codex" || !/^council_(pause|assignment|resume)$/u.test(action)) {
    throw new Error("The automatic Council network route lacks one exact provider and phase binding.");
  }
  return `council.${provider}`;
}
function parseDispatchDocument(body: string | Uint8Array | undefined): Record<string, unknown> {
  if (body === undefined) throw new Error("Provider-host effect dispatch requires one typed JSON request body.");
  let value: unknown;
  try { value = JSON.parse(typeof body === "string" ? body : Buffer.from(body).toString("utf8")); }
  catch { throw new Error("Provider-host effect dispatch requires one valid JSON object body."); }
  if (!record(value)) throw new Error("Provider-host effect dispatch requires one JSON object body.");
  return value;
}
function sameProviderSession(current: ManagedSession, expected: ManagedSession, target: TargetSnapshot, action: CommandAction): boolean {
  const expectedStatusAllowed = expected.status === "running"
    || ((action === "authority_refresh" || action === "authority_broadcast") && expected.status === "verified_blocked");
  return expectedStatusAllowed && current.status === expected.status
    && current.id === expected.id && current.provider === expected.provider && current.surface === expected.surface
    && stableJson(current.capabilities) === stableJson(expected.capabilities)
    && current.workspaceRoot !== undefined && sameRoot(current.workspaceRoot, target.repositoryRoot)
    && current.targetSnapshotId === target.id && current.taskId === expected.taskId
    && current.planRevision === expected.planRevision && current.adapterVersion === expected.adapterVersion;
}

function currentBinding(request: ProviderDispatchLeaseIssueRequest, resolved: ProviderDispatchLeaseResolvedProfile): ProviderDispatchLeaseCurrentBinding {
  return Object.freeze({
    action: request.action,
    guardAction: request.guardAction,
    operationId: request.operationId,
    guardOperationId: request.guardOperationId,
    routeId: request.routeId,
    target: request.target,
    session: request.session,
    authority: request.authority,
    artifact: request.artifact,
    confirmation: request.confirmation,
    containment: request.containment,
    host: resolved.host,
    module: resolved.module,
    credentialReference: resolved.credentialReference,
    effectGuard: request.effectGuard
  });
}

async function requireCurrent(guard: ProviderDispatchLeaseFinalCurrent, binding: ProviderDispatchLeaseCurrentBinding): Promise<void> {
  const result = await guard.assertCurrent(binding);
  if (!result.allowed) throw new Error(safeReason(result.reason));
}

function authorityScopeDigest(request: ProviderDispatchLeaseIssueRequest): string {
  return sha256(stableJson({
    authorityId: request.authority.id,
    repositoryRoot: request.target.repositoryRoot,
    targetSnapshotId: request.target.id,
    sessionId: request.session.id,
    taskId: request.session.taskId ?? null,
    planRevision: request.session.planRevision ?? null,
    routeId: request.routeId,
    action: request.action,
    operationId: request.operationId
  }));
}

function fullTarget(target: TargetSnapshot): ProviderDispatchLeaseUnsigned["target"] {
  return {
    id: target.id,
    repositoryRoot: target.repositoryRoot,
    canonicalRemote: target.canonicalRemote ?? null,
    branch: target.branch ?? null,
    defaultBranch: target.defaultBranch ?? null,
    detached: target.detached ?? false,
    upstream: target.upstream ?? null,
    head: target.head ?? null,
    indexTree: target.indexTree ?? null,
    trackedManifest: target.trackedManifest,
    untrackedManifest: target.untrackedManifest,
    submodules: target.submodules,
    policyVersion: target.policyVersion,
    environmentFingerprint: target.environmentFingerprint,
    capturedAt: target.capturedAt,
    completeness: target.completeness,
    reasons: target.reasons
  };
}

function parseProfile(value: unknown): ProviderDispatchLeaseProfile {
  if (!record(value) || !exact(value, ["schema", "version", "generation", "expectedPriorConfigurationSha256", "expectedPriorProfileDigest", "repositoryRoot", "configurationPath", "configurationSha256", "tlsSpkiSha256", "bearerCredentialReference", "dispatchLeaseCredentialReference", "profileDigest", "providers"])
    || value.schema !== "sxsy-b122.provider-host-dispatch-profile" || value.version !== 1
    || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1 || !nullableDigest(value.expectedPriorConfigurationSha256) || !nullableDigest(value.expectedPriorProfileDigest)
    || !windowsAbsolute(value.repositoryRoot) || !windowsAbsolute(value.configurationPath)
    || !digest(value.configurationSha256) || !digest(value.tlsSpkiSha256)
    || typeof value.bearerCredentialReference !== "string" || !/^b122-provider-bearer-[a-f0-9]{32,64}$/.test(value.bearerCredentialReference)
    || typeof value.dispatchLeaseCredentialReference !== "string" || !/^b122-provider-dispatch-lease-[a-f0-9]{32,64}$/.test(value.dispatchLeaseCredentialReference) || !digest(value.profileDigest)
    || !Array.isArray(value.providers) || value.providers.length < 1 || value.providers.length > 2) {
    throw new Error("The immutable provider dispatch profile is invalid.");
  }
  const seen = new Set<string>();
  const providers = value.providers.map((entry) => {
    if (!record(entry) || !exact(entry, ["provider", "adapterId", "moduleSha256"])
      || (entry.provider !== "claude" && entry.provider !== "codex") || seen.has(entry.provider)
      || !identifier(entry.adapterId, 128) || !digest(entry.moduleSha256)) throw new Error("The immutable provider dispatch module profile is invalid.");
    seen.add(entry.provider);
    return Object.freeze({ provider: entry.provider, adapterId: entry.adapterId, moduleSha256: entry.moduleSha256 });
  }).sort((left, right) => left.provider.localeCompare(right.provider));
  const parsed = {
    schema: "sxsy-b122.provider-host-dispatch-profile",
    version: 1,
    generation: value.generation as number,
    expectedPriorConfigurationSha256: value.expectedPriorConfigurationSha256 as string | null,
    expectedPriorProfileDigest: value.expectedPriorProfileDigest as string | null,
    repositoryRoot: canonicalRoot(value.repositoryRoot),
    configurationPath: canonicalWindowsPath(value.configurationPath),
    configurationSha256: value.configurationSha256,
    tlsSpkiSha256: value.tlsSpkiSha256,
    bearerCredentialReference: value.bearerCredentialReference,
    dispatchLeaseCredentialReference: value.dispatchLeaseCredentialReference,
    profileDigest: value.profileDigest,
    providers: Object.freeze(providers)
  } as const;
  if (providerDispatchProfileIdentityDigest(parsed) !== parsed.profileDigest) throw new Error("The authenticated provider dispatch profile identity digest is invalid.");
  return Object.freeze(parsed);
}

function replayProfileState(entries: readonly JournalEntry<unknown>[]): Readonly<{
  profiles: Map<string, ProviderDispatchLeaseProfile>;
  referenceOwners: Map<string, string>;
}> {
  const profiles = new Map<string, ProviderDispatchLeaseProfile>();
  const referenceOwners = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind !== profileInstalledKind) continue;
    const profile = parseProfile(entry.payload);
    const root = canonicalRoot(profile.repositoryRoot);
    const existing = profiles.get(root);
    if (existing) {
      if (stableJson(existing) === stableJson(profile)) continue;
      requireProfileTransition(existing, profile);
    } else if (profile.generation !== 1 || profile.expectedPriorConfigurationSha256 !== null || profile.expectedPriorProfileDigest !== null) {
      throw new Error("The authenticated provider dispatch profile journal starts with an invalid generation.");
    }
    for (const reference of [profile.bearerCredentialReference, profile.dispatchLeaseCredentialReference]) {
      const owner = referenceOwners.get(reference);
      if (owner !== undefined && owner !== root) {
        throw new Error("The authenticated provider dispatch profile journal reuses one provider-host credential reference across repositories.");
      }
      referenceOwners.set(reference, root);
    }
    profiles.set(root, profile);
  }
  return { profiles, referenceOwners };
}

function exactNow(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new Error("The provider dispatch-lease clock is invalid.");
  return new Date(now.getTime());
}
function requireProfileTransition(current: ProviderDispatchLeaseProfile, next: ProviderDispatchLeaseProfile): void {
  if (next.generation !== current.generation + 1 || next.expectedPriorConfigurationSha256 !== current.configurationSha256
    || next.expectedPriorProfileDigest !== current.profileDigest) {
    throw new Error("Provider dispatch profile rotation requires the next generation and exact expected prior configuration and profile digest.");
  }
}
export function providerDispatchProfileIdentityDigest(profile: Readonly<{
  repositoryRoot: string;
  configurationPath: string;
  configurationSha256: string;
  tlsSpkiSha256: string;
  bearerCredentialReference: string;
  dispatchLeaseCredentialReference: string;
  providers: readonly (Readonly<{ provider: "claude" | "codex" }> & ProviderDispatchLeaseModuleIdentity)[];
}>): string {
  const providerMaterial = [...profile.providers].sort((left, right) => left.provider.localeCompare(right.provider))
    .map((entry) => `${entry.provider}\0${entry.adapterId}\0${entry.moduleSha256}\0`).join("");
  return sha256(`sxsy-b122.provider-host-dispatch-profile\0v1\0${profilePath(profile.repositoryRoot)}\0${profilePath(profile.configurationPath)}\0${profile.configurationSha256}\0${profile.tlsSpkiSha256}\0${profile.bearerCredentialReference}\0${profile.dispatchLeaseCredentialReference}\0${providerMaterial}`);
}
function requireDispatchProtocolBinding(request: ProviderDispatchLeaseIssueRequest): CommandAction {
  if (request.routeId.startsWith("automation.")) {
    throw new Error("Automation effect routes are proposal-only at the provider boundary; reviewed effects execute only through the host-local broker.");
  }
  if (request.action === "council_pause" || request.action === "council_assignment" || request.action === "council_resume") {
    const phase = request.action.slice("council_".length) as "pause" | "assignment" | "resume";
    const operation = /^council:([A-Za-z0-9][A-Za-z0-9._-]{0,127}):(pause|assignment|resume)$/u.exec(request.operationId);
    if (request.routeId !== `council.${request.session.provider}` || !operation || operation[2] !== phase) {
      throw new Error("The automatic Council dispatch route, provider, epoch operation, or phase is inconsistent.");
    }
    if (request.confirmation !== null) throw new Error("Synthetic automatic Council host phases cannot carry an independent confirmation.");
    if (phase === "pause") {
      if (request.artifact !== null) throw new Error("Council pause cannot carry an assignment artifact.");
    } else if (!request.artifact || request.artifact.id !== operation[1]
      || request.artifact.coordinatorContextDigest !== null || request.artifact.coordinatorContextRevision !== null) {
      throw new Error("Council assignment and resume require the exact epoch assignment artifact without a coordinator context pair.");
    }
    requireCatalogCapabilityFloor(request.session, "council_automatic");
    return "council_automatic";
  }
  if (!(commandActionIds as readonly string[]).includes(request.action)) throw new Error("Provider dispatch action is absent from the host-owned command catalog.");
  const action = request.action as CommandAction;
  const definition = commandForAction(action);
  if (action === "reanchor") {
    const requestId = request.artifact?.id;
    if (request.routeId !== `provider.reanchor.${request.session.provider}` || (request.session.provider !== "claude" && request.session.provider !== "codex")
      || !request.artifact || typeof requestId !== "string" || !/^reanchor:[a-f0-9]{64}$/u.test(requestId)
      || request.operationId !== `reanchor-operation:${sha256(requestId)}`
      || request.artifact.coordinatorContextDigest !== null || request.artifact.coordinatorContextRevision !== null
      || request.confirmation === null) {
      throw new Error("Re-anchor requires its exact dedicated provider route, deterministic operation, reviewed artifact, and confirmation binding.");
    }
  } else if (request.routeId === `provider.${action}`) {
    if (definition.executor !== "agent" || request.artifact === null) {
      throw new Error("The provider workflow route requires one exact agent action and workflow artifact.");
    }
  } else {
    throw new Error("The provider dispatch route does not exactly match its host-owned action protocol.");
  }
  if (definition.requiresConfirmation && request.confirmation === null) {
    throw new Error("The provider workflow action requires an exact reviewed confirmation binding.");
  }
  if (!definition.requiresConfirmation && request.confirmation !== null) {
    throw new Error("The provider dispatch action cannot carry an unrelated confirmation binding.");
  }
  requireCatalogCapabilityFloor(request.session, action);
  return action;
}
function requireCatalogCapabilityFloor(session: ManagedSession, action: CommandAction): void {
  const actual = new Set(session.capabilities);
  if (actual.size !== session.capabilities.length
    || (actual.has("observable") && !actual.has("registered"))
    || (actual.has("controllable") && !actual.has("registered"))
    || (actual.has("mediated") && (!actual.has("registered") || !actual.has("observable") || !actual.has("controllable")))) {
    throw new Error("The provider capability hierarchy is invalid; Observable and Controllable require Registered, and Mediated requires all four levels.");
  }
  const declared = commandForAction(action).requiresCapabilities;
  const required = new Set<Capability>(declared);
  if (required.has("observable") || required.has("controllable") || required.has("mediated")) required.add("registered");
  if (required.has("mediated")) { required.add("observable"); required.add("controllable"); }
  const ordered: readonly Capability[] = ["registered", "observable", "controllable", "mediated"];
  const floor = ordered.filter((capability) => required.has(capability));
  if (session.status !== "running" || !floor.every((capability) => actual.has(capability))) {
    throw new Error(`Provider dispatch requires a running session at the exact ${floor.join(", ") || "catalog"} capability floor.`);
  }
}
function requireProviderHostPolicy(profile: ProviderDispatchLeaseProfile, policy: ConfiguredNetworkPolicy): void {
  const expected = new Set<string>(["provider.health", "provider.reconcile"]);
  for (const action of commandActionIds) {
    if (action === "reanchor") continue;
    const executor = commandForAction(action).executor;
    if (executor === "agent") expected.add(`provider.${action}`);
  }
  for (const entry of profile.providers) {
    expected.add(`provider.reanchor.${entry.provider}`);
    for (const prefix of ["handshake", "council", "council-cleanup", "observe-session", "observe-workflow-context", "observe-operation", "observe-reanchor", "cancel"] as const) {
      expected.add(`provider.${prefix}.${entry.provider}`);
    }
  }
  const routes = new Map(policy.routes.map((route) => [route.id, route]));
  for (const routeId of expected) {
    const route = routes.get(routeId);
    if (!route) throw new Error(`The attested provider-host network policy is missing exact route ${routeId}.`);
    requireProviderHostRoute(profile, route);
  }
  for (const route of policy.routes) {
    if (route.id.startsWith("automation.") && !route.id.startsWith("automation.proposal.")) {
      throw new Error(`The attested provider-host network policy exposes forbidden automation effect route ${route.id}.`);
    }
    if (route.boundary === "provider-host-loopback") requireProviderHostRoute(profile, route);
  }
}
function requireProviderHostRoute(profile: ProviderDispatchLeaseProfile, route: ConfiguredNetworkPolicy["routes"][number]): void {
  if (route.boundary !== "provider-host-loopback" || route.tlsSpkiSha256 !== profile.tlsSpkiSha256
    || route.credential?.reference !== profile.bearerCredentialReference || route.credential.purpose !== "provider-api"
    || route.credential.header.toLowerCase() !== "authorization" || route.credential.prefix !== "Bearer ") {
    throw new Error(`Provider-host route ${route.id} is not bound to the exact loopback TLS and bearer-credential profile.`);
  }
}
function requireCredentialReference(references: readonly CredentialReferenceSummary[], reference: string, repositoryRoot: string, adapterId: string, purpose: string): void {
  const current = references.find((entry) => entry.reference === reference);
  if (!current || current.revokedAt || current.scopes.length !== 1) throw new Error("The provider dispatch profile requires one current exact-scope credential reference per key role.");
  const scope = current.scopes[0]!;
  if (!sameRoot(scope.repositoryRoot, repositoryRoot) || scope.adapterId !== adapterId || scope.purpose !== purpose) {
    throw new Error("A provider dispatch-profile credential reference has the wrong repository, adapter, or purpose scope.");
  }
}
class IssuanceBoundary {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly parent?: AbortSignal;
  private readonly parentListener: () => void;
  private timedOut = false;
  constructor(parent: AbortSignal | undefined, timeoutMs: number) {
    this.signal = this.controller.signal;
    this.parent = parent;
    this.parentListener = () => this.controller.abort("cancelled");
    if (parent?.aborted) this.controller.abort("cancelled");
    else parent?.addEventListener("abort", this.parentListener, { once: true });
    this.timer = setTimeout(() => { this.timedOut = true; this.controller.abort("deadline"); }, timeoutMs);
  }
  wait<T>(promise: Promise<T>): Promise<T> {
    if (this.signal.aborted) return Promise.reject(this.error());
    return new Promise<T>((resolveWait, rejectWait) => {
      const cancelled = (): void => { cleanup(); rejectWait(this.error()); };
      const cleanup = (): void => this.signal.removeEventListener("abort", cancelled);
      this.signal.addEventListener("abort", cancelled, { once: true });
      promise.then((value) => { cleanup(); resolveWait(value); }, (error: unknown) => { cleanup(); rejectWait(error); });
    });
  }
  dispose(): void { clearTimeout(this.timer); this.parent?.removeEventListener("abort", this.parentListener); }
  private error(): Error { return new Error(this.timedOut ? "Provider dispatch-lease issuance timed out at its bounded deadline." : "Provider dispatch-lease issuance was cancelled."); }
}
function boundedTtl(value: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > maximumLeaseTtlMs) throw new Error("Provider dispatch-lease TTL must be 1-60,000ms."); return value; }
function aborted(signal: AbortSignal | undefined): void { if (signal?.aborted) throw new Error("Provider dispatch-lease issuance was cancelled."); }
function keyBytes(value: Uint8Array): boolean { return value.byteLength === 64 && [...value].every((byte) => (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)); }
function safeReason(value: string): string { return typeof value === "string" && value.trim() && value.length <= 512 && !/[\0\r\n]/.test(value) ? value : "The provider dispatch binding is no longer current."; }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function nullableDigest(value: unknown): value is string | null { return value === null || digest(value); }
function identifier(value: unknown, maximum = 256): value is string { return typeof value === "string" && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function windowsAbsolute(value: unknown): value is string { return typeof value === "string" && value.length <= 4_096 && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && !/[\0\r\n]/.test(value); }
function canonicalWindowsPath(value: string): string { return value.replaceAll("/", "\\").replace(/\\+$/u, ""); }
function profilePath(value: string): string { return canonicalWindowsPath(value).toLowerCase(); }
function canonicalRoot(value: string): string { const normalized = windowsAbsolute(value) ? canonicalWindowsPath(value) : resolve(value); return process.platform === "win32" ? normalized.toLowerCase() : normalized; }
function sameRoot(left: string, right: string): boolean { return canonicalRoot(left) === canonicalRoot(right); }
