import { randomBytes, randomUUID } from "node:crypto";
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
import type { CredentialAdapterPort } from "./durable-credentials.ts";

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

export interface ProviderDispatchLeaseCurrentBinding {
  readonly action: string;
  readonly operationId: string;
  readonly routeId: string;
  readonly target: TargetSnapshot;
  readonly session: ManagedSession;
  readonly authority: AuthorityGrant;
  readonly artifact: ProviderDispatchLeaseArtifactBinding | null;
  readonly confirmation: Readonly<{ digest: string; scopeDigest: string }> | null;
  readonly containment: ProviderDispatchLeaseUnsigned["containment"];
  readonly host: ProviderDispatchLeaseHostIdentity;
  readonly module: ProviderDispatchLeaseModuleIdentity;
}

export interface ProviderDispatchLeaseFinalCurrent {
  assertCurrent(binding: ProviderDispatchLeaseCurrentBinding): Promise<Readonly<{ allowed: boolean; reason: string }>>;
}

export interface ProviderDispatchLeaseIssueRequest {
  readonly routeId: string;
  readonly action: string;
  readonly operationId: string;
  readonly target: TargetSnapshot;
  readonly session: ManagedSession;
  readonly authority: AuthorityGrant;
  readonly artifact: ProviderDispatchLeaseArtifactBinding | null;
  readonly confirmation: Readonly<{ digest: string; scopeDigest: string }> | null;
  readonly containment: ProviderDispatchLeaseUnsigned["containment"];
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

  constructor(options: CredentialBackedProviderDispatchLeaseIssuerOptions) {
    this.credentials = options.credentials;
    this.profiles = options.profiles;
    this.finalCurrent = options.finalCurrent;
    this.now = options.now ?? (() => new Date());
    this.ttlMs = boundedTtl(options.ttlMs ?? defaultLeaseTtlMs);
    this.idFactory = options.idFactory ?? randomUUID;
    this.nonceFactory = options.nonceFactory ?? (() => randomBytes(32).toString("hex"));
    this.issuanceTimeoutMs = boundedTtl(options.issuanceTimeoutMs ?? 10_000);
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
          return signProviderDispatchLease(unsigned, keyCopy.toString("ascii"));
        } finally { keyCopy.fill(0); }
      }));
    } finally { boundary.dispose(); }
  }
}

function validateDispatchBinding(request: ProviderDispatchLeaseIssueRequest, now: Date): void {
  if (!Number.isFinite(now.getTime())) throw new Error("The provider dispatch-lease clock is invalid.");
  if (request.session.provider !== "claude" && request.session.provider !== "codex") throw new Error("Provider dispatch requires one exact Claude or Codex session.");
  if (request.target.completeness !== "complete" || targetSnapshotDigest(request.target) !== request.target.id) throw new Error("Provider dispatch requires one complete canonical TargetSnapshot.");
  if (!request.session.workspaceRoot || !sameRoot(request.session.workspaceRoot, request.target.repositoryRoot)
    || request.session.targetSnapshotId !== request.target.id) throw new Error("The provider session does not match the exact target.");
  if (!sameRoot(request.authority.repositoryRoot, request.target.repositoryRoot)
    || request.authority.sessionId !== request.session.id
    || request.authority.taskId !== request.session.taskId
    || request.authority.planRevision !== request.session.planRevision) {
    throw new Error("The provider authority does not match the exact target, session, task, and plan.");
  }
  const authorityIssuedAt = Date.parse(request.authority.issuedAt);
  const authorityExpiresAt = Date.parse(request.authority.expiresAt);
  if (request.authority.revokedAt || !Number.isFinite(authorityIssuedAt) || !Number.isFinite(authorityExpiresAt)
    || authorityIssuedAt > now.getTime() || authorityExpiresAt <= now.getTime()) throw new Error("The provider authority is revoked, future-issued, or expired.");
  if (!identifier(request.routeId, 128) || !identifier(request.action) || !identifier(request.operationId)) throw new Error("The provider dispatch route, action, or operation ID is invalid.");
  const authorityAction = requireDispatchProtocolBinding(request);
  if (!request.authority.allowedActions.includes(authorityAction) || request.authority.prohibitedActions.includes(authorityAction)) {
    throw new Error("The provider authority does not allow this exact action.");
  }
  if (request.artifact && ((request.artifact.coordinatorContextDigest === null) !== (request.artifact.coordinatorContextRevision === null))) {
    throw new Error("The provider dispatch artifact context binding is incomplete.");
  }
}

function currentBinding(request: ProviderDispatchLeaseIssueRequest, resolved: ProviderDispatchLeaseResolvedProfile): ProviderDispatchLeaseCurrentBinding {
  return Object.freeze({
    action: request.action,
    operationId: request.operationId,
    routeId: request.routeId,
    target: request.target,
    session: request.session,
    authority: request.authority,
    artifact: request.artifact,
    confirmation: request.confirmation,
    containment: request.containment,
    host: resolved.host,
    module: resolved.module
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
  if (request.routeId === `provider.${action}`) {
    if (definition.executor !== "agent" || request.artifact === null) {
      throw new Error("The provider workflow route requires one exact agent action and workflow artifact.");
    }
  } else if (request.routeId === `automation.${action}`) {
    if (definition.executor !== "automation" || request.artifact !== null || request.confirmation !== null) {
      throw new Error("The automation route requires one exact automation action without workflow artifact or confirmation bindings.");
    }
  } else {
    throw new Error("The provider dispatch route does not exactly match its host-owned action protocol.");
  }
  if (definition.requiresConfirmation && request.confirmation === null) {
    throw new Error("The provider workflow action requires an exact reviewed confirmation binding.");
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
