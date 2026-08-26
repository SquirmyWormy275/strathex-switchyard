import { createHmac, timingSafeEqual } from "node:crypto";

import { sha256, stableJson, type ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";

export const providerDispatchLeaseEventKind = "provider-host.dispatch-lease-consumed";
const maximumLeaseLifetimeMs = 60_000;
const maximumClockAgeMs = 5 * 60_000;

export interface ProviderDispatchLeaseHostIdentity {
  readonly configurationSha256: string;
  readonly lifecycleNonceSha256: string;
  readonly tlsSpkiSha256: string;
}

export interface ProviderDispatchLeaseModuleIdentity {
  readonly adapterId: string;
  readonly moduleSha256: string;
}

/** Closed, full TargetSnapshot binding. Nullable fields preserve exact absence. */
export interface ProviderDispatchLeaseTarget {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly canonicalRemote: string | null;
  readonly branch: string | null;
  readonly defaultBranch: string | null;
  readonly detached: boolean;
  readonly upstream: string | null;
  readonly head: string | null;
  readonly indexTree: string | null;
  readonly trackedManifest: string;
  readonly untrackedManifest: string;
  readonly submodules: Readonly<Record<string, string>>;
  readonly policyVersion: string;
  readonly environmentFingerprint: string;
  readonly capturedAt: string;
  readonly completeness: "complete" | "incomplete";
  readonly reasons: readonly string[];
}

export interface ProviderDispatchLeaseSessionBinding {
  readonly id: string;
  readonly provider: "claude" | "codex";
  readonly taskId: string | null;
  readonly planRevision: string | null;
  readonly adapterVersion: string;
}

export interface ProviderDispatchLeaseArtifactBinding {
  readonly id: string;
  readonly digest: string;
  readonly coordinatorContextDigest: string | null;
  readonly coordinatorContextRevision: number | null;
}

export interface ProviderDispatchLeaseUnsigned {
  readonly schema: "sxsy-b122.provider-dispatch-lease";
  readonly version: 1;
  readonly leaseId: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authority: Readonly<{ id: string; grantDigest: string; scopeDigest: string; expiresAt: string }>;
  readonly target: ProviderDispatchLeaseTarget;
  readonly session: ProviderDispatchLeaseSessionBinding;
  readonly dispatch: Readonly<{ routeId: string; action: string; operationId: string }>;
  readonly artifact: ProviderDispatchLeaseArtifactBinding | null;
  readonly confirmation: Readonly<{ digest: string; scopeDigest: string }> | null;
  readonly containment: Readonly<{ status: "clear"; bindingDigest: string; fenceEpoch: number; activationOperationId: null }>;
  readonly host: ProviderDispatchLeaseHostIdentity;
  readonly module: ProviderDispatchLeaseModuleIdentity;
}

export interface ProviderDispatchLease extends ProviderDispatchLeaseUnsigned {
  readonly authenticationTag: string;
}

export interface ProviderDispatchLeaseExpectation {
  readonly provider: "claude" | "codex";
  readonly routeId: string;
  readonly action: string;
  readonly operationId: string;
  readonly authorityId: string;
  readonly target: Readonly<{
    id: string;
    repositoryRoot: string;
    branch?: string | null;
    head?: string | null;
    trackedManifest?: string;
    untrackedManifest?: string;
    policyVersion?: string;
  }>;
  readonly session: ProviderDispatchLeaseSessionBinding;
  readonly artifact: ProviderDispatchLeaseArtifactBinding | null;
  readonly confirmation: Readonly<{ digest: string; scopeDigest: string }> | null;
  readonly module: ProviderDispatchLeaseModuleIdentity;
}

export interface ProviderDispatchLeaseAuthorityOptions {
  readonly authenticationKey: string;
  readonly store: ProtectedJsonStore;
  readonly host: ProviderDispatchLeaseHostIdentity;
  readonly now?: () => string;
}

export interface ProviderDispatchLeaseConsumeOptions {
  readonly signal?: AbortSignal;
  /** Called only after replay checks and immediately before the durable append. */
  readonly onCommitStart?: () => void;
}

/**
 * Host-side verifier and single-use durable consumer. The key is independent
 * from both the HTTP bearer and the journal authenticator.
 */
export class ProviderDispatchLeaseAuthority {
  private readonly key: Buffer;
  private readonly store: ProtectedJsonStore;
  private readonly host: ProviderDispatchLeaseHostIdentity;
  private readonly now: () => string;

  constructor(options: ProviderDispatchLeaseAuthorityOptions) {
    if (!digest(options.authenticationKey)) throw new Error("The provider dispatch-lease authentication key must be exactly 256 canonical bits.");
    if (!options.store.hasAuthenticatedProtection) throw new Error("Provider dispatch-lease consumption requires authenticated durable state.");
    this.key = createHmac("sha256", Buffer.from(options.authenticationKey, "ascii"))
      .update("sxsy-b122.provider-dispatch-lease.authentication.v1\0", "utf8").digest();
    this.store = options.store;
    this.host = parseHost(options.host);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async consume(value: unknown, expected: ProviderDispatchLeaseExpectation, options: ProviderDispatchLeaseConsumeOptions = {}): Promise<ProviderDispatchLease> {
    const lease = parseProviderDispatchLease(value);
    const unsigned = unsignedLease(lease);
    const actual = Buffer.from(lease.authenticationTag, "hex");
    const wanted = Buffer.from(authenticationTag(unsigned, this.key), "hex");
    if (actual.byteLength !== wanted.byteLength || !timingSafeEqual(actual, wanted)) throw new Error("Provider dispatch-lease authentication failed.");
    requireValidity(lease, this.timestamp());
    requireExactBinding(lease, expected, this.host);
    if (options.signal?.aborted) throw new Error("Provider dispatch-lease consumption was cancelled before its durable decision.");
    const leaseDigest = sha256(stableJson(unsigned));
    await this.store.transaction(async (transaction) => {
      for (const entry of await transaction.readEntries()) {
        if (entry.kind !== providerDispatchLeaseEventKind) continue;
        const saved = parseConsumption(entry.payload);
        if (saved.leaseId === lease.leaseId || saved.nonce === lease.nonce) throw new Error("The provider dispatch lease was already consumed; replay is forbidden.");
      }
      if (options.signal?.aborted) throw new Error("Provider dispatch-lease consumption was cancelled before its durable decision.");
      options.onCommitStart?.();
      await transaction.append(providerDispatchLeaseEventKind, {
        schema: "sxsy-b122.provider-dispatch-lease-consumption", version: 1,
        leaseId: lease.leaseId, nonce: lease.nonce, leaseDigest,
        provider: expected.provider, routeId: expected.routeId, operationId: expected.operationId,
        consumedAt: this.timestamp()
      });
    });
    return lease;
  }

  private timestamp(): string {
    const value = this.now();
    if (!timestamp(value)) throw new Error("The provider dispatch-lease clock is invalid.");
    return value;
  }
}

export function signProviderDispatchLease(value: ProviderDispatchLeaseUnsigned, authenticationKey: string): ProviderDispatchLease {
  if (!digest(authenticationKey)) throw new Error("The provider dispatch-lease authentication key must be exactly 256 canonical bits.");
  const unsigned = parseUnsignedProviderDispatchLease(value);
  const key = createHmac("sha256", Buffer.from(authenticationKey, "ascii"))
    .update("sxsy-b122.provider-dispatch-lease.authentication.v1\0", "utf8").digest();
  try { return Object.freeze({ ...unsigned, authenticationTag: authenticationTag(unsigned, key) }); }
  finally { key.fill(0); }
}

export function parseProviderDispatchLease(value: unknown): ProviderDispatchLease {
  if (!record(value) || !exactKeys(value, [...unsignedLeaseKeys, "authenticationTag"]) || !digest(value.authenticationTag)) {
    throw new Error("The provider dispatch-lease schema or authentication field is invalid.");
  }
  const { authenticationTag, ...unsigned } = value;
  return Object.freeze({ ...parseUnsignedProviderDispatchLease(unsigned), authenticationTag });
}

function parseUnsignedProviderDispatchLease(value: unknown): ProviderDispatchLeaseUnsigned {
  if (!record(value) || !exactKeys(value, unsignedLeaseKeys)
    || value.schema !== "sxsy-b122.provider-dispatch-lease" || value.version !== 1
    || !safeIdentifier(value.leaseId) || !digest(value.nonce) || !timestamp(value.issuedAt) || !timestamp(value.expiresAt)) {
    throw new Error("The provider dispatch-lease schema is invalid or contains an unexpected field.");
  }
  const authority = parseAuthority(value.authority);
  const target = parseTarget(value.target);
  const session = parseSession(value.session);
  const dispatch = parseDispatch(value.dispatch);
  const artifact = value.artifact === null ? null : parseArtifact(value.artifact);
  const confirmation = value.confirmation === null ? null : parseConfirmation(value.confirmation);
  const containment = parseContainment(value.containment);
  const host = parseHost(value.host);
  const module = parseModule(value.module);
  return Object.freeze({
    schema: "sxsy-b122.provider-dispatch-lease", version: 1,
    leaseId: value.leaseId, nonce: value.nonce, issuedAt: value.issuedAt, expiresAt: value.expiresAt,
    authority, target, session, dispatch, artifact, confirmation, containment, host, module
  });
}

const unsignedLeaseKeys = [
  "schema", "version", "leaseId", "nonce", "issuedAt", "expiresAt", "authority", "target", "session",
  "dispatch", "artifact", "confirmation", "containment", "host", "module"
] as const;

function parseAuthority(value: unknown): ProviderDispatchLeaseUnsigned["authority"] {
  if (!record(value) || !exactKeys(value, ["id", "grantDigest", "scopeDigest", "expiresAt"])
    || !safeIdentifier(value.id) || !digest(value.grantDigest) || !digest(value.scopeDigest) || !timestamp(value.expiresAt)) throw new Error("The provider dispatch-lease authority binding is invalid.");
  return Object.freeze({ id: value.id, grantDigest: value.grantDigest, scopeDigest: value.scopeDigest, expiresAt: value.expiresAt });
}

function parseTarget(value: unknown): ProviderDispatchLeaseTarget {
  const keys = ["id", "repositoryRoot", "canonicalRemote", "branch", "defaultBranch", "detached", "upstream", "head", "indexTree", "trackedManifest", "untrackedManifest", "submodules", "policyVersion", "environmentFingerprint", "capturedAt", "completeness", "reasons"];
  if (!record(value) || !exactKeys(value, keys) || !digest(value.id) || !absoluteRoot(value.repositoryRoot)
    || !nullableBounded(value.canonicalRemote, 2_048) || !nullableBounded(value.branch, 240) || !nullableBounded(value.defaultBranch, 240)
    || typeof value.detached !== "boolean" || !nullableBounded(value.upstream, 512) || !nullableBounded(value.head, 256) || !nullableBounded(value.indexTree, 256)
    || !bounded(value.trackedManifest, 512) || !bounded(value.untrackedManifest, 512) || !submodules(value.submodules)
    || !bounded(value.policyVersion, 256) || !bounded(value.environmentFingerprint, 512) || !timestamp(value.capturedAt)
    || (value.completeness !== "complete" && value.completeness !== "incomplete") || !boundedList(value.reasons, 64, 512)) {
    throw new Error("The provider dispatch-lease full target binding is invalid.");
  }
  const target = Object.freeze({
    id: value.id, repositoryRoot: value.repositoryRoot, canonicalRemote: value.canonicalRemote, branch: value.branch,
    defaultBranch: value.defaultBranch, detached: value.detached, upstream: value.upstream, head: value.head, indexTree: value.indexTree,
    trackedManifest: value.trackedManifest, untrackedManifest: value.untrackedManifest,
    submodules: Object.freeze({ ...value.submodules } as Record<string, string>), policyVersion: value.policyVersion,
    environmentFingerprint: value.environmentFingerprint, capturedAt: value.capturedAt, completeness: value.completeness,
    reasons: Object.freeze([...(value.reasons as string[])])
  }) as ProviderDispatchLeaseTarget;
  const identity = {
    repositoryRoot: target.repositoryRoot,
    canonicalRemote: target.canonicalRemote,
    branch: target.branch,
    defaultBranch: target.defaultBranch,
    detached: target.detached,
    upstream: target.upstream,
    head: target.head,
    indexTree: target.indexTree,
    trackedManifest: target.trackedManifest, untrackedManifest: target.untrackedManifest, submodules: target.submodules,
    policyVersion: target.policyVersion, environmentFingerprint: target.environmentFingerprint,
    completeness: target.completeness, reasons: target.reasons
  };
  if (sha256(stableJson(identity)) !== target.id) throw new Error("The provider dispatch-lease target ID does not bind its full canonical TargetSnapshot.");
  return target;
}

function parseSession(value: unknown): ProviderDispatchLeaseSessionBinding {
  if (!record(value) || !exactKeys(value, ["id", "provider", "taskId", "planRevision", "adapterVersion"])
    || !safeIdentifier(value.id) || (value.provider !== "claude" && value.provider !== "codex")
    || !nullableIdentifier(value.taskId) || !nullableIdentifier(value.planRevision) || !adapterVersion(value.adapterVersion)) throw new Error("The provider dispatch-lease session binding is invalid.");
  return Object.freeze({ id: value.id, provider: value.provider, taskId: value.taskId, planRevision: value.planRevision, adapterVersion: value.adapterVersion });
}

function parseDispatch(value: unknown): ProviderDispatchLeaseUnsigned["dispatch"] {
  if (!record(value) || !exactKeys(value, ["routeId", "action", "operationId"]) || !safeRoute(value.routeId) || !safeIdentifier(value.action) || !safeIdentifier(value.operationId)) throw new Error("The provider dispatch-lease route binding is invalid.");
  return Object.freeze({ routeId: value.routeId, action: value.action, operationId: value.operationId });
}

function parseArtifact(value: unknown): ProviderDispatchLeaseArtifactBinding {
  if (!record(value) || !exactKeys(value, ["id", "digest", "coordinatorContextDigest", "coordinatorContextRevision"])
    || !safeIdentifier(value.id) || !digest(value.digest) || !nullableDigest(value.coordinatorContextDigest)
    || !nullablePositiveInteger(value.coordinatorContextRevision) || ((value.coordinatorContextDigest === null) !== (value.coordinatorContextRevision === null))) throw new Error("The provider dispatch-lease artifact binding is invalid.");
  return Object.freeze({ id: value.id, digest: value.digest, coordinatorContextDigest: value.coordinatorContextDigest, coordinatorContextRevision: value.coordinatorContextRevision });
}

function parseConfirmation(value: unknown): NonNullable<ProviderDispatchLeaseUnsigned["confirmation"]> {
  if (!record(value) || !exactKeys(value, ["digest", "scopeDigest"]) || !digest(value.digest) || !digest(value.scopeDigest)) throw new Error("The provider dispatch-lease confirmation binding is invalid.");
  return Object.freeze({ digest: value.digest, scopeDigest: value.scopeDigest });
}

function parseContainment(value: unknown): ProviderDispatchLeaseUnsigned["containment"] {
  if (!record(value) || !exactKeys(value, ["status", "bindingDigest", "fenceEpoch", "activationOperationId"])
    || value.status !== "clear" || !digest(value.bindingDigest) || !Number.isSafeInteger(value.fenceEpoch) || (value.fenceEpoch as number) < 0
    || value.activationOperationId !== null) throw new Error("The provider dispatch-lease containment binding is invalid or not clear.");
  return Object.freeze({ status: "clear", bindingDigest: value.bindingDigest, fenceEpoch: value.fenceEpoch as number, activationOperationId: null });
}

function parseHost(value: unknown): ProviderDispatchLeaseHostIdentity {
  if (!record(value) || !exactKeys(value, ["configurationSha256", "lifecycleNonceSha256", "tlsSpkiSha256"])
    || !digest(value.configurationSha256) || !digest(value.lifecycleNonceSha256) || !digest(value.tlsSpkiSha256)) throw new Error("The provider dispatch-lease host identity is invalid.");
  return Object.freeze({ configurationSha256: value.configurationSha256, lifecycleNonceSha256: value.lifecycleNonceSha256, tlsSpkiSha256: value.tlsSpkiSha256 });
}

function parseModule(value: unknown): ProviderDispatchLeaseModuleIdentity {
  if (!record(value) || !exactKeys(value, ["adapterId", "moduleSha256"]) || !adapterId(value.adapterId) || !digest(value.moduleSha256)) throw new Error("The provider dispatch-lease module identity is invalid.");
  return Object.freeze({ adapterId: value.adapterId, moduleSha256: value.moduleSha256 });
}

function requireValidity(lease: ProviderDispatchLeaseUnsigned, nowText: string): void {
  const now = Date.parse(nowText);
  const issued = Date.parse(lease.issuedAt);
  const expires = Date.parse(lease.expiresAt);
  const authorityExpires = Date.parse(lease.authority.expiresAt);
  if (issued > now || expires <= now || expires <= issued || expires - issued > maximumLeaseLifetimeMs
    || now - issued > maximumClockAgeMs || authorityExpires < expires || authorityExpires <= now) {
    throw new Error("The provider dispatch lease is expired, future-issued, or outside its fixed validity window.");
  }
}

function requireExactBinding(lease: ProviderDispatchLeaseUnsigned, expected: ProviderDispatchLeaseExpectation, host: ProviderDispatchLeaseHostIdentity): void {
  const exact = lease.session.provider === expected.provider
    && lease.dispatch.routeId === expected.routeId && lease.dispatch.action === expected.action && lease.dispatch.operationId === expected.operationId
    && lease.authority.id === expected.authorityId
    && sameRoot(lease.target.repositoryRoot, expected.target.repositoryRoot) && lease.target.id === expected.target.id
    && (expected.target.branch === undefined || lease.target.branch === expected.target.branch)
    && (expected.target.head === undefined || lease.target.head === expected.target.head)
    && (expected.target.trackedManifest === undefined || lease.target.trackedManifest === expected.target.trackedManifest)
    && (expected.target.untrackedManifest === undefined || lease.target.untrackedManifest === expected.target.untrackedManifest)
    && (expected.target.policyVersion === undefined || lease.target.policyVersion === expected.target.policyVersion)
    && stableJson(lease.session) === stableJson(expected.session)
    && stableJson(lease.artifact) === stableJson(expected.artifact)
    && stableJson(lease.confirmation) === stableJson(expected.confirmation)
    && stableJson(lease.host) === stableJson(host)
    && stableJson(lease.module) === stableJson(expected.module);
  if (!exact) throw new Error("The provider dispatch lease does not match the exact authority, target, session, route, artifact, confirmation, host, or module binding.");
}

function parseConsumption(value: unknown): Readonly<{ leaseId: string; nonce: string }> {
  if (!record(value) || !exactKeys(value, ["schema", "version", "leaseId", "nonce", "leaseDigest", "provider", "routeId", "operationId", "consumedAt"])
    || value.schema !== "sxsy-b122.provider-dispatch-lease-consumption" || value.version !== 1 || !safeIdentifier(value.leaseId)
    || !digest(value.nonce) || !digest(value.leaseDigest) || (value.provider !== "claude" && value.provider !== "codex")
    || !safeRoute(value.routeId) || !safeIdentifier(value.operationId) || !timestamp(value.consumedAt)) throw new Error("The protected provider dispatch-lease journal is malformed.");
  return { leaseId: value.leaseId, nonce: value.nonce };
}

function unsignedLease(value: ProviderDispatchLease): ProviderDispatchLeaseUnsigned {
  const { authenticationTag: _authenticationTag, ...unsigned } = value;
  return unsigned;
}
function authenticationTag(value: ProviderDispatchLeaseUnsigned, key: Buffer): string { return createHmac("sha256", key).update(stableJson(value), "utf8").digest("hex"); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value); const allowed = new Set(keys); return actual.length === keys.length && actual.every((key) => allowed.has(key)) && keys.every((key) => Object.hasOwn(value, key)); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function nullableDigest(value: unknown): value is string | null { return value === null || digest(value); }
function safeIdentifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value); }
function nullableIdentifier(value: unknown): value is string | null { return value === null || safeIdentifier(value); }
function safeRoute(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9_.-]{0,127}$/.test(value); }
function adapterId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function adapterVersion(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_.+-]{1,80}$/.test(value); }
function absoluteRoot(value: unknown): value is string { return typeof value === "string" && value.length <= 4_096 && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && !/[\0\r\n]/.test(value); }
function bounded(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value); }
function nullableBounded(value: unknown, maximum: number): value is string | null { return value === null || bounded(value, maximum); }
function boundedList(value: unknown, maximumItems: number, maximumLength: number): value is readonly string[] { return Array.isArray(value) && value.length <= maximumItems && value.every((entry) => bounded(entry, maximumLength)); }
function submodules(value: unknown): value is Readonly<Record<string, string>> { return record(value) && Object.keys(value).length <= 128 && Object.entries(value).every(([path, revision]) => bounded(path, 512) && bounded(revision, 256)); }
function timestamp(value: unknown): value is string { return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function nullablePositiveInteger(value: unknown): value is number | null { return value === null || (Number.isSafeInteger(value) && (value as number) >= 1); }
function sameRoot(left: string, right: string): boolean { return left.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase() === right.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase(); }
