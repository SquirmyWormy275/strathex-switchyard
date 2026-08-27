import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  parseProviderDispatchLease,
  type ProviderDispatchLease,
  type ProviderDispatchLeaseUnsigned
} from "../../provider-adapter-host/src/dispatch-lease.ts";
import type { AuthorityGrant, ManagedSession, OperationRecord, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { jsonClone, sha256, stableJson, type JournalEntry, type ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { AuthenticatedPipeClient, loadPipeConfiguration, type AuthenticatedPipeConfiguration } from "./authenticated-pipe.ts";
import { companionBridgeVersion, type CompanionResponse } from "./bridge.ts";
import { WindowsDpapiCurrentUserProtector, type UserSecretProtector } from "./windows-secret.ts";

const armedKind = "provider-mediated.final-current-armed";
const consumedKind = "provider-mediated.final-current-consumed";
const maximumDecisionLifetimeMs = 10_000;
const defaultDeadlineMs = 5_000;
const digestPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export interface ProviderMediatedFinalCurrentRequest {
  readonly schema: "sxsy-b122.provider-mediated-final-current-request";
  readonly version: 1;
  readonly authorizationId: string;
  readonly configurationSha256: string;
  readonly provider: "claude" | "codex";
  readonly adapterId: string;
  readonly moduleSha256: string;
  readonly leaseId: string;
  readonly leaseDigest: string;
  readonly operationId: string;
  readonly action: string;
  readonly routeId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly containmentBindingDigest: string;
  readonly containmentFenceEpoch: number;
  readonly challengeNonce: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export interface ProviderMediatedFinalCurrentDecision {
  readonly schema: "sxsy-b122.provider-mediated-final-current-decision";
  readonly version: 1;
  readonly authorizationId: string;
  readonly leaseId: string;
  readonly operationId: string;
  readonly action: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly containmentBindingDigest: string;
  readonly containmentFenceEpoch: number;
  readonly challengeNonce: string;
  readonly allowed: true;
  readonly decidedAt: string;
  readonly expiresAt: string;
  readonly decisionDigest: string;
}

export interface ProviderMediatedEffectBinding {
  readonly schema: "sxsy-b122.provider-mediated-effect-binding";
  readonly version: 1;
  readonly authorizationId: string;
  readonly configurationSha256: string;
  readonly provider: "claude" | "codex";
  readonly adapterId: string;
  readonly moduleSha256: string;
  readonly leaseId: string;
  readonly leaseDigest: string;
  readonly operationId: string;
  readonly action: string;
  readonly routeId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly containmentBindingDigest: string;
  readonly containmentFenceEpoch: number;
}

type ClearContainmentBinding = Readonly<{
  status: "clear";
  bindingDigest: string;
  fenceEpoch: number;
  activationOperationId: null;
}>;

interface ArmedAuthorization {
  readonly binding: ProviderMediatedEffectBinding;
  readonly guardAction: string;
  readonly guardOperationId: string;
  readonly target: TargetSnapshot;
  readonly session: ManagedSession;
  readonly authority: AuthorityGrant;
  readonly armedAt: string;
}

interface ArmedEvent { readonly authorization: ArmedAuthorization; }
interface ConsumedEvent {
  readonly authorizationId: string;
  readonly leaseId: string;
  readonly challengeNonce: string;
  readonly requestDigest: string;
  readonly consumedAt: string;
}

export interface DurableProviderMediatedFinalCurrentOptions {
  readonly store: ProtectedJsonStore;
  readonly operations: Pick<{ get(id: string): Promise<OperationRecord | undefined> }, "get">;
  readonly sessions: Pick<{ get(id: string): Promise<ManagedSession | undefined> }, "get">;
  readonly authorities: Pick<{ get(id: string): Promise<AuthorityGrant | undefined> }, "get">;
  readonly targets: Readonly<{
    current(input: Readonly<{ action: string; session: ManagedSession; target: TargetSnapshot; signal: AbortSignal }>): Promise<TargetSnapshot | undefined>;
  }>;
  readonly containment: Readonly<{ currentClear(repositoryRoot: string): Promise<ClearContainmentBinding> }>;
  readonly now?: () => Date;
  readonly deadlineMs?: number;
}

/**
 * Companion-owned last-effect barrier. `armFromIssuedLease` is host-internal:
 * it is called only with the exact lease returned by the signed lease issuer,
 * never with data received over IPC or from a provider module.
 */
export class DurableProviderMediatedFinalCurrent {
  private readonly options: DurableProviderMediatedFinalCurrentOptions;
  private readonly now: () => Date;
  private readonly deadlineMs: number;

  constructor(options: DurableProviderMediatedFinalCurrentOptions) {
    if (!options.store.hasAuthenticatedProtection) throw new Error("Provider mediated final-current authorization requires authenticated durable state.");
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.deadlineMs = boundedLifetime(options.deadlineMs ?? defaultDeadlineMs, "provider mediated final-current deadline");
  }

  async armFromIssuedLease(input: Readonly<{
    lease: ProviderDispatchLease;
    target: TargetSnapshot;
    session: ManagedSession;
    authority: AuthorityGrant;
    guardAction: string;
    guardOperationId: string;
  }>): Promise<Readonly<{ authorizationId: string }>> {
    const lease = parseProviderDispatchLease(input.lease);
    const binding = mediationBinding(lease);
    requireArmBinding(binding, lease, input.target, input.session, input.authority, input.guardAction, input.guardOperationId, this.timestamp());
    const authorization: ArmedAuthorization = Object.freeze({
      binding,
      guardAction: input.guardAction,
      guardOperationId: input.guardOperationId,
      target: jsonClone(input.target),
      session: jsonClone(input.session),
      authority: jsonClone(input.authority),
      armedAt: this.timestamp()
    });
    await this.options.store.transaction(async (transaction) => {
      const state = authorizationState(await transaction.readEntries());
      const prior = state.armed.get(binding.authorizationId);
      if (prior) {
        if (stableJson(prior) !== stableJson(authorization)) throw new Error("The provider mediation authorization identity was already armed with another exact lease binding.");
        return;
      }
      if ([...state.armed.values()].some((item) => item.binding.leaseId === binding.leaseId)) {
        throw new Error("The provider dispatch lease was already armed under another mediation authorization.");
      }
      await transaction.append<ArmedEvent>(armedKind, { authorization });
    });
    return Object.freeze({ authorizationId: binding.authorizationId });
  }

  /** Backward-compatible narrow spelling used only by focused integration tests. */
  arm(input: Readonly<{ lease: ProviderDispatchLease; target: TargetSnapshot; session: ManagedSession; authority: AuthorityGrant; guardAction: string; guardOperationId: string }>) {
    return this.armFromIssuedLease(input);
  }

  async decide(value: unknown, signal?: AbortSignal): Promise<ProviderMediatedFinalCurrentDecision> {
    const boundary = new FinalCurrentBoundary(signal, this.deadlineMs);
    try {
      const request = parseRequest(value, this.now());
      boundary.assertActive();
      const authorization = await boundary.wait(this.readArmed(request));
      await boundary.wait(this.assertCurrent(authorization, request, boundary.signal));
      await boundary.wait(this.consume(authorization, request));
      boundary.assertActive();
      await boundary.wait(this.assertCurrent(authorization, request, boundary.signal));
      boundary.assertActive();
      const decidedAt = this.timestamp();
      if (Date.parse(decidedAt) >= Date.parse(request.expiresAt)) throw new Error("The provider mediated final-current request expired before its decision was issued.");
      const material = Object.freeze({
        schema: "sxsy-b122.provider-mediated-final-current-decision" as const,
        version: 1 as const,
        authorizationId: request.authorizationId,
        leaseId: request.leaseId,
        operationId: request.operationId,
        action: request.action,
        sessionId: request.sessionId,
        authorityId: request.authorityId,
        targetSnapshotId: request.targetSnapshotId,
        repositoryRoot: request.repositoryRoot,
        containmentBindingDigest: request.containmentBindingDigest,
        containmentFenceEpoch: request.containmentFenceEpoch,
        challengeNonce: request.challengeNonce,
        allowed: true as const,
        decidedAt,
        expiresAt: request.expiresAt
      });
      return Object.freeze({ ...material, decisionDigest: sha256(stableJson(material)) });
    } finally { boundary.dispose(); }
  }

  private async readArmed(request: ProviderMediatedFinalCurrentRequest): Promise<ArmedAuthorization> {
    const state = authorizationState(await this.options.store.readEntries());
    const authorization = state.armed.get(request.authorizationId);
    if (!authorization || !sameRequestBinding(request, authorization.binding)) {
      throw new Error("The provider mediation authorization is unarmed, forged, or bound to another exact dispatch lease.");
    }
    if (state.consumed.some((item) => item.authorizationId === request.authorizationId || item.leaseId === request.leaseId || item.challengeNonce === request.challengeNonce)) {
      throw new Error("The provider mediation authorization, dispatch lease, or challenge was already consumed; replay is forbidden.");
    }
    return authorization;
  }

  private async consume(authorization: ArmedAuthorization, request: ProviderMediatedFinalCurrentRequest): Promise<void> {
    await this.options.store.transaction(async (transaction) => {
      const state = authorizationState(await transaction.readEntries());
      const current = state.armed.get(request.authorizationId);
      if (!current || stableJson(current) !== stableJson(authorization) || !sameRequestBinding(request, current.binding)) {
        throw new Error("The provider mediation authorization changed before its durable consume boundary.");
      }
      if (state.consumed.some((item) => item.authorizationId === request.authorizationId || item.leaseId === request.leaseId || item.challengeNonce === request.challengeNonce)) {
        throw new Error("The provider mediation authorization, dispatch lease, or challenge was already consumed; replay is forbidden.");
      }
      await transaction.append<ConsumedEvent>(consumedKind, {
        authorizationId: request.authorizationId,
        leaseId: request.leaseId,
        challengeNonce: request.challengeNonce,
        requestDigest: sha256(stableJson(request)),
        consumedAt: this.timestamp()
      });
    });
  }

  private async assertCurrent(authorization: ArmedAuthorization, request: ProviderMediatedFinalCurrentRequest, signal: AbortSignal): Promise<void> {
    if (!sameRequestBinding(request, authorization.binding)) throw new Error("The provider mediated request changed its exact authorization binding.");
    const operation = await this.options.operations.get(authorization.guardOperationId);
    if (!operation || operation.state !== "executing" || operation.action !== authorization.guardAction || operation.targetSnapshotId !== request.targetSnapshotId) {
      throw new Error("The durable provider operation is absent, changed, or no longer executing.");
    }
    const session = await this.options.sessions.get(request.sessionId);
    if (!session || stableJson(session) !== stableJson(authorization.session) || !eligibleSession(session, request.action)
      || !session.workspaceRoot || !sameRoot(session.workspaceRoot, request.repositoryRoot)
      || session.targetSnapshotId !== request.targetSnapshotId) {
      throw new Error("The exact managed provider session changed before the mediated effect.");
    }
    const authority = await this.options.authorities.get(request.authorityId);
    if (!authority || stableJson(authority) !== stableJson(authorization.authority)
      || authority.revokedAt || Date.parse(authority.expiresAt) <= this.now().getTime()
      || !sameRoot(authority.repositoryRoot, request.repositoryRoot)
      || !authorityScopeMatches(authority, session, authorization.guardAction)
      || authority.prohibitedActions.includes(authorization.guardAction) || !authority.allowedActions.includes(authorization.guardAction)) {
      throw new Error("The exact provider authority changed, expired, or no longer permits this action.");
    }
    const target = await this.options.targets.current({ action: authorization.guardAction, session, target: authorization.target, signal });
    if (!target || targetSnapshotDigest(target) !== target.id || stableJson(target) !== stableJson(authorization.target)
      || target.id !== request.targetSnapshotId || !sameRoot(target.repositoryRoot, request.repositoryRoot)) {
      throw new Error("The exact current TargetSnapshot changed before the mediated effect.");
    }
    const containment = await this.options.containment.currentClear(request.repositoryRoot);
    if (containment.status !== "clear" || containment.activationOperationId !== null
      || containment.bindingDigest !== request.containmentBindingDigest || containment.fenceEpoch !== request.containmentFenceEpoch
      || stableJson(containment) !== stableJson({
        status: "clear", bindingDigest: authorization.binding.containmentBindingDigest,
        fenceEpoch: authorization.binding.containmentFenceEpoch, activationOperationId: null
      })) {
      throw new Error("The exact clear containment binding changed before the mediated effect.");
    }
  }

  private timestamp(): string {
    const now = this.now();
    if (!Number.isFinite(now.getTime())) throw new Error("The provider mediated final-current clock is invalid.");
    return now.toISOString();
  }
}

export interface InstalledProviderMediatedFinalCurrentClientOptions {
  readonly configuration: AuthenticatedPipeConfiguration;
  readonly protector: UserSecretProtector;
  readonly now?: () => Date;
  readonly requestLifetimeMs?: number;
  readonly challengeFactory?: () => string;
}

/** Provider-host-only client. A proprietary provider module never receives this object, endpoint metadata, or DPAPI token. */
export class InstalledProviderMediatedFinalCurrentClient {
  private readonly transport: AuthenticatedPipeClient;
  private readonly now: () => Date;
  private readonly requestLifetimeMs: number;
  private readonly challengeFactory: () => string;

  constructor(options: InstalledProviderMediatedFinalCurrentClientOptions) {
    this.transport = new AuthenticatedPipeClient(options.configuration, options.protector, { timeoutMs: defaultDeadlineMs });
    this.now = options.now ?? (() => new Date());
    this.requestLifetimeMs = boundedLifetime(options.requestLifetimeMs ?? defaultDeadlineMs, "provider mediated callback lifetime");
    this.challengeFactory = options.challengeFactory ?? (() => randomBytes(32).toString("hex"));
  }

  async assertCurrent(bindingValue: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderMediatedFinalCurrentDecision> {
    const binding = parseEffectBinding(bindingValue);
    if (signal.aborted) throw new Error("The provider mediated final-current callback was cancelled.");
    const requestedAt = exactDate(this.now(), "provider mediated callback clock");
    const { schema: _bindingSchema, version: _bindingVersion, ...exactBinding } = binding;
    const request: ProviderMediatedFinalCurrentRequest = Object.freeze({
      schema: "sxsy-b122.provider-mediated-final-current-request",
      version: 1,
      ...exactBinding,
      challengeNonce: digest(this.challengeFactory(), "provider mediated callback challenge"),
      requestedAt: requestedAt.toISOString(),
      expiresAt: new Date(requestedAt.getTime() + this.requestLifetimeMs).toISOString()
    });
    const response = await abortable(this.transport.request({
      version: companionBridgeVersion,
      id: `provider-final-current-${request.authorizationId.slice(0, 32)}-${request.challengeNonce.slice(0, 16)}`,
      method: "provider-mediated.final-current",
      payload: request
    }), signal);
    return parseDecision(response, request, this.now());
  }
}

/** Loads only the install-owned sealed endpoint record from one canonical state root. */
export async function loadInstalledProviderMediatedFinalCurrentClient(
  stateDirectoryInput: string,
  protector: UserSecretProtector = new WindowsDpapiCurrentUserProtector()
): Promise<InstalledProviderMediatedFinalCurrentClient> {
  if (!isAbsolute(stateDirectoryInput)) throw new Error("The installed provider callback state root must be absolute.");
  const stateDirectory = await realpath(resolve(stateDirectoryInput));
  const configurationPath = resolve(stateDirectory, "authenticated-pipe.json");
  if (!inside(stateDirectory, configurationPath)) throw new Error("The provider callback endpoint record escaped the installed state root.");
  return new InstalledProviderMediatedFinalCurrentClient({ configuration: await loadPipeConfiguration(configurationPath), protector });
}

function mediationBinding(lease: ProviderDispatchLease): ProviderMediatedEffectBinding {
  const { authenticationTag: _authenticationTag, ...unsigned } = lease;
  const material = Object.freeze({
    schema: "sxsy-b122.provider-mediated-effect-binding" as const,
    version: 1 as const,
    configurationSha256: lease.host.configurationSha256,
    provider: lease.session.provider,
    adapterId: lease.module.adapterId,
    moduleSha256: lease.module.moduleSha256,
    leaseId: lease.leaseId,
    leaseDigest: sha256(stableJson(unsigned)),
    operationId: lease.dispatch.operationId,
    action: lease.dispatch.action,
    routeId: lease.dispatch.routeId,
    sessionId: lease.session.id,
    authorityId: lease.authority.id,
    targetSnapshotId: lease.target.id,
    repositoryRoot: lease.target.repositoryRoot,
    containmentBindingDigest: lease.containment.bindingDigest,
    containmentFenceEpoch: lease.containment.fenceEpoch
  });
  return Object.freeze({ ...material, authorizationId: sha256(stableJson(material)) });
}

function requireArmBinding(
  binding: ProviderMediatedEffectBinding,
  lease: ProviderDispatchLease,
  target: TargetSnapshot,
  session: ManagedSession,
  authority: AuthorityGrant,
  guardAction: string,
  guardOperationId: string,
  now: string
): void {
  requireGuardBinding(binding, guardAction, guardOperationId);
  if (target.completeness !== "complete" || targetSnapshotDigest(target) !== target.id || !sameLeaseTarget(lease, target)) throw new Error("The issued provider lease does not bind the exact complete TargetSnapshot.");
  if (session.id !== lease.session.id || session.provider !== lease.session.provider || session.adapterVersion !== lease.session.adapterVersion
    || (session.taskId ?? null) !== lease.session.taskId || (session.planRevision ?? null) !== lease.session.planRevision
    || !session.workspaceRoot || !sameRoot(session.workspaceRoot, target.repositoryRoot) || session.targetSnapshotId !== target.id || !eligibleSession(session, binding.action)) {
    throw new Error("The issued provider lease does not bind the exact eligible managed session.");
  }
  if (authority.id !== lease.authority.id || sha256(stableJson(authority)) !== lease.authority.grantDigest || authority.revokedAt
    || Date.parse(authority.expiresAt) <= Date.parse(now) || !sameRoot(authority.repositoryRoot, target.repositoryRoot)
    || !authorityScopeMatches(authority, session, guardAction)
    || authority.prohibitedActions.includes(guardAction) || !authority.allowedActions.includes(guardAction)) {
    throw new Error("The issued provider lease does not bind one current exact authority grant.");
  }
  if (lease.containment.status !== "clear" || lease.containment.activationOperationId !== null) throw new Error("The issued provider lease is not bound to clear containment.");
}

function requireGuardBinding(binding: ProviderMediatedEffectBinding, guardAction: string, guardOperationId: string): void {
  if (!identifier(guardAction) || !identifier(guardOperationId)) throw new Error("The provider mediation guard action or operation identity is invalid.");
  const council = /^council_(pause|assignment|resume)$/u.exec(binding.action);
  if (!council) {
    if (guardAction !== binding.action || guardOperationId !== binding.operationId) {
      throw new Error("A non-Council provider mediation authorization cannot change its exact guard action or operation.");
    }
    return;
  }
  const operation = /^council:([A-Za-z0-9][A-Za-z0-9._-]{0,127}):(pause|assignment|resume)$/u.exec(binding.operationId);
  if (guardAction !== "council_automatic" || !operation || operation[2] !== council[1]
    || binding.routeId !== `council.${binding.provider}`) {
    throw new Error("The automatic Council provider phase does not match its closed parent guard, epoch operation, route, and phase.");
  }
}

function authorityScopeMatches(authority: AuthorityGrant, session: ManagedSession, guardAction: string): boolean {
  return guardAction === "council_automatic"
    ? authority.sessionId === undefined && authority.taskId === undefined && authority.planRevision === undefined
    : authority.sessionId === session.id && authority.taskId === session.taskId && authority.planRevision === session.planRevision;
}

function parseRequest(value: unknown, now: Date): ProviderMediatedFinalCurrentRequest {
  const keys = [
    "schema", "version", "authorizationId", "configurationSha256", "provider", "adapterId", "moduleSha256", "leaseId", "leaseDigest",
    "operationId", "action", "routeId", "sessionId", "authorityId", "targetSnapshotId", "repositoryRoot", "containmentBindingDigest",
    "containmentFenceEpoch", "challengeNonce", "requestedAt", "expiresAt"
  ];
  if (!record(value) || !exactKeys(value, keys) || value.schema !== "sxsy-b122.provider-mediated-final-current-request" || value.version !== 1) {
    throw new Error("The provider mediated final-current request schema contains an unknown or missing field.");
  }
  const binding = parseEffectBinding({
    schema: "sxsy-b122.provider-mediated-effect-binding", version: 1,
    authorizationId: value.authorizationId, configurationSha256: value.configurationSha256, provider: value.provider,
    adapterId: value.adapterId, moduleSha256: value.moduleSha256, leaseId: value.leaseId, leaseDigest: value.leaseDigest,
    operationId: value.operationId, action: value.action, routeId: value.routeId, sessionId: value.sessionId,
    authorityId: value.authorityId, targetSnapshotId: value.targetSnapshotId, repositoryRoot: value.repositoryRoot,
    containmentBindingDigest: value.containmentBindingDigest, containmentFenceEpoch: value.containmentFenceEpoch
  });
  const challengeNonce = digest(value.challengeNonce, "provider mediated final-current challenge");
  const requestedAt = timestamp(value.requestedAt, "provider mediated final-current request time");
  const expiresAt = timestamp(value.expiresAt, "provider mediated final-current expiry");
  if (!Number.isFinite(now.getTime()) || requestedAt > now.getTime() || expiresAt <= now.getTime() || expiresAt <= requestedAt
    || expiresAt - requestedAt > maximumDecisionLifetimeMs || now.getTime() - requestedAt > maximumDecisionLifetimeMs) {
    throw new Error("The provider mediated final-current request is expired, future-issued, or outside its fixed validity window.");
  }
  const { schema: _bindingSchema, version: _bindingVersion, ...exactBinding } = binding;
  return Object.freeze({
    schema: "sxsy-b122.provider-mediated-final-current-request", version: 1,
    ...exactBinding, challengeNonce, requestedAt: new Date(requestedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString()
  });
}

function parseEffectBinding(value: unknown): ProviderMediatedEffectBinding {
  const keys = [
    "schema", "version", "authorizationId", "configurationSha256", "provider", "adapterId", "moduleSha256", "leaseId", "leaseDigest",
    "operationId", "action", "routeId", "sessionId", "authorityId", "targetSnapshotId", "repositoryRoot", "containmentBindingDigest", "containmentFenceEpoch"
  ];
  if (!record(value) || !exactKeys(value, keys) || value.schema !== "sxsy-b122.provider-mediated-effect-binding" || value.version !== 1
    || !digestPattern.test(String(value.authorizationId)) || !digestPattern.test(String(value.configurationSha256))
    || (value.provider !== "claude" && value.provider !== "codex") || !adapterId(value.adapterId) || !digestPattern.test(String(value.moduleSha256))
    || !identifier(value.leaseId) || !digestPattern.test(String(value.leaseDigest)) || !identifier(value.operationId) || !identifier(value.action)
    || !/^(?:provider|automation|council)\.[a-z0-9_.-]+$/u.test(String(value.routeId)) || !identifier(value.sessionId) || !identifier(value.authorityId)
    || !digestPattern.test(String(value.targetSnapshotId)) || !absoluteRoot(value.repositoryRoot) || !digestPattern.test(String(value.containmentBindingDigest))
    || !Number.isSafeInteger(value.containmentFenceEpoch) || Number(value.containmentFenceEpoch) < 0) {
    throw new Error("The provider mediated effect binding is malformed or unbounded.");
  }
  const { authorizationId, ...material } = value as unknown as ProviderMediatedEffectBinding;
  if (sha256(stableJson(material)) !== authorizationId) throw new Error("The provider mediated effect authorization digest is invalid.");
  return Object.freeze({ ...(value as unknown as ProviderMediatedEffectBinding) });
}

function parseDecision(response: CompanionResponse, request: ProviderMediatedFinalCurrentRequest, now: Date): ProviderMediatedFinalCurrentDecision {
  if (!response.ok || !record(response.result) || !record(response.result.decision)) throw new Error("The authenticated companion denied provider mediated final-current authorization.");
  const value = response.result.decision;
  const keys = [
    "schema", "version", "authorizationId", "leaseId", "operationId", "action", "sessionId", "authorityId", "targetSnapshotId", "repositoryRoot",
    "containmentBindingDigest", "containmentFenceEpoch", "challengeNonce", "allowed", "decidedAt", "expiresAt", "decisionDigest"
  ];
  if (!exactKeys(value, keys) || value.schema !== "sxsy-b122.provider-mediated-final-current-decision" || value.version !== 1 || value.allowed !== true
    || !digestPattern.test(String(value.decisionDigest))) throw new Error("The companion returned a malformed provider mediated final-current decision.");
  for (const key of ["authorizationId", "leaseId", "operationId", "action", "sessionId", "authorityId", "targetSnapshotId", "repositoryRoot", "containmentBindingDigest", "containmentFenceEpoch", "challengeNonce", "expiresAt"] as const) {
    if (value[key] !== request[key]) throw new Error("The companion provider mediated final-current decision changed its exact binding.");
  }
  const decidedAt = timestamp(value.decidedAt, "provider mediated final-current decision time");
  const expiresAt = timestamp(value.expiresAt, "provider mediated final-current decision expiry");
  if (!Number.isFinite(now.getTime()) || decidedAt > now.getTime() || expiresAt <= now.getTime() || expiresAt <= decidedAt
    || expiresAt - decidedAt > maximumDecisionLifetimeMs) throw new Error("The companion provider mediated final-current decision is stale or outside its fixed lifetime.");
  const { decisionDigest, ...material } = value;
  if (sha256(stableJson(material)) !== decisionDigest) throw new Error("The companion provider mediated final-current decision digest is invalid.");
  return Object.freeze({ ...(value as unknown as ProviderMediatedFinalCurrentDecision) });
}

function authorizationState(entries: readonly JournalEntry<unknown>[]): Readonly<{ armed: Map<string, ArmedAuthorization>; consumed: ConsumedEvent[] }> {
  const armed = new Map<string, ArmedAuthorization>();
  const consumed: ConsumedEvent[] = [];
  for (const entry of entries) {
    if (entry.kind === armedKind) {
      const payload = entry.payload as ArmedEvent;
      if (!payload?.authorization || !digestPattern.test(payload.authorization.binding?.authorizationId ?? "")) throw new Error("Protected provider mediation authorization state is malformed.");
      armed.set(payload.authorization.binding.authorizationId, jsonClone(payload.authorization));
    }
    if (entry.kind === consumedKind) {
      const payload = entry.payload as ConsumedEvent;
      if (!payload || !digestPattern.test(payload.authorizationId) || !identifier(payload.leaseId) || !digestPattern.test(payload.challengeNonce)
        || !digestPattern.test(payload.requestDigest) || !Number.isFinite(Date.parse(payload.consumedAt))) throw new Error("Protected provider mediation replay state is malformed.");
      consumed.push(jsonClone(payload));
    }
  }
  return { armed, consumed };
}

function sameRequestBinding(request: ProviderMediatedFinalCurrentRequest, binding: ProviderMediatedEffectBinding): boolean {
  const { schema: _schema, version: _version, challengeNonce: _challenge, requestedAt: _requested, expiresAt: _expires, ...material } = request;
  return stableJson({ schema: "sxsy-b122.provider-mediated-effect-binding", version: 1, ...material }) === stableJson(binding);
}

function eligibleSession(session: ManagedSession, action: string): boolean {
  const status = session.status === "running" || ((action === "authority_refresh" || action === "authority_broadcast") && session.status === "verified_blocked");
  return status && session.capabilities.includes("registered") && session.capabilities.includes("mediated");
}

function sameLeaseTarget(lease: ProviderDispatchLeaseUnsigned, target: TargetSnapshot): boolean {
  const material = {
    id: target.id, repositoryRoot: target.repositoryRoot, canonicalRemote: target.canonicalRemote ?? null, branch: target.branch ?? null,
    defaultBranch: target.defaultBranch ?? null, detached: target.detached === true, upstream: target.upstream ?? null,
    head: target.head ?? null, indexTree: target.indexTree ?? null, trackedManifest: target.trackedManifest,
    untrackedManifest: target.untrackedManifest, submodules: target.submodules, policyVersion: target.policyVersion,
    environmentFingerprint: target.environmentFingerprint, capturedAt: target.capturedAt,
    completeness: target.completeness, reasons: target.reasons
  };
  return stableJson(lease.target) === stableJson(material);
}

class FinalCurrentBoundary {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly caller?: AbortSignal;
  private readonly abortFromCaller = (): void => this.controller.abort();
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(caller: AbortSignal | undefined, deadlineMs: number) {
    this.caller = caller;
    if (caller?.aborted) this.controller.abort();
    else caller?.addEventListener("abort", this.abortFromCaller, { once: true });
    this.timer = setTimeout(() => this.controller.abort(), deadlineMs);
    this.signal = this.controller.signal;
  }

  assertActive(): void { if (this.signal.aborted) throw new Error("The provider mediated final-current request was cancelled or exceeded its deadline."); }
  async wait<T>(promise: Promise<T>): Promise<T> {
    this.assertActive();
    return abortable(promise, this.signal);
  }
  dispose(): void { clearTimeout(this.timer); this.caller?.removeEventListener("abort", this.abortFromCaller); this.controller.abort(); }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("The provider mediated final-current request was cancelled or exceeded its deadline."));
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const abort = (): void => { cleanup(); rejectPromise(new Error("The provider mediated final-current request was cancelled or exceeded its deadline.")); };
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    void promise.then((value) => { cleanup(); resolvePromise(value); }, (error) => { cleanup(); rejectPromise(error); });
  });
}

function boundedLifetime(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumDecisionLifetimeMs) throw new Error(`${label} must be between 1 and ${maximumDecisionLifetimeMs} milliseconds.`);
  return value;
}
function exactDate(value: Date, label: string): Date { if (!Number.isFinite(value.getTime())) throw new Error(`${label} is invalid.`); return value; }
function timestamp(value: unknown, label: string): number { const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN; if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid.`); return parsed; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(`${label} must be one lowercase SHA-256 digest.`); return value; }
function identifier(value: unknown): value is string { return typeof value === "string" && identifierPattern.test(value); }
function adapterId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function absoluteRoot(value: unknown): value is string { return typeof value === "string" && value.length > 2 && value.length <= 4_096 && !/[\r\n\0]/.test(value) && (isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)); }
function sameRoot(left: string, right: string): boolean { return normalizeRoot(left) === normalizeRoot(right); }
function normalizeRoot(value: string): string { return value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase(); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value); return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function inside(root: string, candidate: string): boolean { const path = relative(root, candidate); return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path)); }
