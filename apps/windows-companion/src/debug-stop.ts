import { randomUUID } from "node:crypto";

import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { BrokerConfirmation } from "../../../packages/control-plane/src/brokers.ts";
import type { AuthorityGrant, ManagedSession, OperationRecord, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import { sessionBindingDigest, type SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import {
  jsonClone,
  sha256,
  stableJson,
  type JournalEntry,
  type ProtectedJsonStore
} from "../../../packages/control-plane/src/store.ts";

const preparedEvent = "b122.debug-stop.binding-prepared.v1";
const consumedEvent = "b122.debug-stop.binding-consumed.v1";
const bindingLifetimeMs = 2 * 60_000;
const action = "stop_managed_run" as const;
const digestPattern = /^[a-f0-9]{64}$/;

export interface DebugStopBinding {
  readonly schema: "sxsy-b122.debug-stop-binding";
  readonly version: 1;
  readonly id: string;
  readonly action: typeof action;
  readonly sourceSessionId: string;
  readonly sourceSessionBindingDigest: string;
  /** Protected preparation material. Never accepted on claim or dispatch. */
  readonly effectSessionId: string;
  readonly effectSessionBindingDigest: string;
  readonly authorityId: string;
  readonly authorityDigest: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly originOperationId: string;
  readonly originOperationDigest: string;
  readonly effectKind: "debug_session" | "managed_run";
  readonly debugSessionId: string | null;
  readonly debugBindingId: string | null;
  readonly debugConfiguration: string | null;
  readonly managedProcessId: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly reviewScopeDigest: string;
}

export interface PreparedDebugStopBinding {
  readonly binding: DebugStopBinding;
  readonly reviewScopeDigest: string;
}

/** Exact read-only packet presented by the installed trusted UI. */
export interface DebugStopReview {
  readonly schema: "sxsy-b122.debug-stop-review";
  readonly version: 1;
  readonly action: typeof action;
  readonly bindingId: string;
  readonly bindingDigest: string;
  readonly reviewScopeDigest: string;
  readonly sourceSessionId: string;
  readonly authorityId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly originOperationId: string;
  readonly effectKind: "debug_session" | "managed_run";
  readonly debugSessionId: string | null;
  readonly debugBindingId: string | null;
  readonly debugConfiguration: string | null;
  readonly managedProcessId: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ClaimedDebugStopBinding {
  readonly binding: DebugStopBinding;
  readonly sourceSession: ManagedSession;
  readonly effectSession: ManagedSession;
}

export interface DurableDebugStopBindingStoreOptions {
  readonly store: ProtectedJsonStore;
  readonly sessions: SessionRegistry;
  readonly targetResolver: TargetResolver;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

interface PreparedPayload { readonly binding: DebugStopBinding }
interface ConsumedPayload { readonly bindingId: string; readonly reviewScopeDigest: string; readonly consumedAt: string }

export class DebugStopBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebugStopBindingError";
  }
}

/**
 * Durable split binding for Alt-Run. The selected provider session remains the
 * sole authority source. The debug-effect session is retained behind this
 * authenticated host boundary and can only be recovered by consuming the
 * exact reviewed binding once.
 */
export class DurableDebugStopBindingStore {
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly options: DurableDebugStopBindingStoreOptions) {
    if (!options.store.hasAuthenticatedProtection) {
      throw new DebugStopBindingError("Debug-stop bindings require authenticated protected-store protection.");
    }
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async prepare(input: Readonly<{
    sourceSessionId: string;
    effectSessionId: string;
    authorityId: string;
  }>): Promise<PreparedDebugStopBinding> {
    assertExactKeys(input, ["sourceSessionId", "effectSessionId", "authorityId"], "debug-stop preparation");
    const sourceSessionId = boundedReference(input.sourceSessionId, "source session id");
    const effectSessionId = boundedReference(input.effectSessionId, "effect session id");
    const authorityId = boundedReference(input.authorityId, "authority id");
    if (sourceSessionId === effectSessionId) throw new DebugStopBindingError("The source provider session and debug-effect session must be distinct.");

    const sourceForResolution = await this.options.sessions.get(sourceSessionId);
    if (!sourceForResolution) throw new DebugStopBindingError("The exact source provider session is absent.");
    const target = await this.resolveCurrentTarget(sourceForResolution);
    const createdAt = this.now().toISOString();

    return this.options.store.transaction(async (transaction) => {
      const entries = await transaction.readEntries();
      const state = protectedState(entries);
      const current = validateCurrentBinding({
        state,
        sourceSessionId,
        effectSessionId,
        authorityId,
        target,
        now: createdAt,
        expectedResolvedSourceDigest: sessionBindingDigest(sourceForResolution)
      });
      const authorityExpiry = Date.parse(current.authority.expiresAt);
      const expiresAtMs = Math.min(Date.parse(createdAt) + bindingLifetimeMs, authorityExpiry);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.parse(createdAt)) {
        throw new DebugStopBindingError("The exact authority expires before a debug-stop review can be bound.");
      }
      const nonce = boundedReference(this.idFactory(), "debug-stop binding nonce");
      const immutable = {
        action,
        sourceSessionId: current.source.id,
        sourceSessionBindingDigest: sessionBindingDigest(current.source),
        effectSessionId: current.effect.id,
        effectSessionBindingDigest: sessionBindingDigest(current.effect),
        authorityId: current.authority.id,
        authorityDigest: sha256(stableJson(current.authority)),
        targetSnapshotId: target.id,
        repositoryRoot: target.repositoryRoot,
        originOperationId: current.origin.id,
        originOperationDigest: originBindingDigest(current.origin),
        effectKind: current.effectIdentity.effectKind,
        debugSessionId: current.effectIdentity.debugSessionId,
        debugBindingId: current.effectIdentity.debugBindingId,
        debugConfiguration: current.effectIdentity.debugConfiguration,
        managedProcessId: current.effectIdentity.managedProcessId,
        createdAt,
        expiresAt: new Date(expiresAtMs).toISOString()
      } as const;
      const id = `debug-stop:${sha256(stableJson({ ...immutable, nonce }))}`;
      const reviewScopeDigest = debugStopReviewScopeDigest({ id, ...immutable });
      const binding: DebugStopBinding = {
        schema: "sxsy-b122.debug-stop-binding",
        version: 1,
        id,
        ...immutable,
        reviewScopeDigest
      };
      const existing = state.bindings.get(binding.id);
      if (existing && stableJson(existing) !== stableJson(binding)) {
        throw new DebugStopBindingError("A durable debug-stop binding id was reused with different immutable material.");
      }
      if (!existing) await transaction.append<PreparedPayload>(preparedEvent, { binding });
      return { binding: jsonClone(binding), reviewScopeDigest };
    });
  }

  async claim(input: Readonly<{
    bindingId: string;
    reviewScopeDigest: string;
    sourceSessionId: string;
    authorityId: string;
    target: TargetSnapshot;
  }>): Promise<ClaimedDebugStopBinding> {
    assertExactKeys(input, ["bindingId", "reviewScopeDigest", "sourceSessionId", "authorityId", "target"], "debug-stop claim");
    const bindingId = boundedReference(input.bindingId, "debug-stop binding id", 160);
    const reviewScopeDigest = exactDigest(input.reviewScopeDigest, "review scope digest");
    const sourceSessionId = boundedReference(input.sourceSessionId, "source session id");
    const authorityId = boundedReference(input.authorityId, "authority id");
    validateTarget(input.target);
    const sourceForResolution = await this.options.sessions.get(sourceSessionId);
    if (!sourceForResolution) throw new DebugStopBindingError("The exact source provider session is absent.");
    const target = await this.resolveCurrentTarget(sourceForResolution);
    if (stableJson(target) !== stableJson(input.target)) {
      throw new DebugStopBindingError("The current target changed after debug-stop review.");
    }
    const claimedAt = this.now().toISOString();

    return this.options.store.transaction(async (transaction) => {
      const state = protectedState(await transaction.readEntries());
      const binding = state.bindings.get(bindingId);
      if (!binding || binding.reviewScopeDigest !== reviewScopeDigest
        || debugStopReviewScopeDigest(binding) !== reviewScopeDigest) {
        throw new DebugStopBindingError("The debug-stop binding or review scope is absent, changed, or forged.");
      }
      if (binding.sourceSessionId !== sourceSessionId || binding.authorityId !== authorityId) {
        throw new DebugStopBindingError("The debug-stop source session or authority binding was substituted.");
      }
      if (state.consumed.has(binding.id)) throw new DebugStopBindingError("The debug-stop binding was already consumed; replay is forbidden.");
      if (Date.parse(binding.expiresAt) <= Date.parse(claimedAt)) throw new DebugStopBindingError("The debug-stop binding expired before claim.");
      if (binding.targetSnapshotId !== target.id || !sameRoot(binding.repositoryRoot, target.repositoryRoot)) {
        throw new DebugStopBindingError("The current target changed after debug-stop review.");
      }
      const current = validateCurrentBinding({
        state,
        sourceSessionId,
        effectSessionId: binding.effectSessionId,
        authorityId,
        target,
        now: claimedAt,
        expectedResolvedSourceDigest: sessionBindingDigest(sourceForResolution)
      });
      if (sessionBindingDigest(current.source) !== binding.sourceSessionBindingDigest
        || sessionBindingDigest(current.effect) !== binding.effectSessionBindingDigest
        || sha256(stableJson(current.authority)) !== binding.authorityDigest
        || originBindingDigest(current.origin) !== binding.originOperationDigest
        || current.origin.id !== binding.originOperationId
        || !sameEffectIdentity(current.effectIdentity, binding)) {
        throw new DebugStopBindingError("The protected source, effect, origin, or authority binding changed after review.");
      }
      await transaction.append<ConsumedPayload>(consumedEvent, {
        bindingId: binding.id,
        reviewScopeDigest,
        consumedAt: claimedAt
      });
      return {
        binding: jsonClone(binding),
        sourceSession: jsonClone(current.source),
        effectSession: jsonClone(current.effect)
      };
    });
  }

  /** Re-reads the protected binding for a second-phase UI acknowledgement. */
  async inspect(input: Readonly<{
    bindingId: string;
    bindingDigest: string;
    reviewScopeDigest: string;
    sourceSessionId: string;
  }>): Promise<DebugStopReview | undefined> {
    assertExactKeys(input, ["bindingId", "bindingDigest", "reviewScopeDigest", "sourceSessionId"], "debug-stop inspection");
    const bindingId = boundedReference(input.bindingId, "debug-stop binding id", 160);
    const bindingDigest = exactDigest(input.bindingDigest, "debug-stop binding digest");
    const reviewScopeDigest = exactDigest(input.reviewScopeDigest, "review scope digest");
    const sourceSessionId = boundedReference(input.sourceSessionId, "source session id");
    const sourceForResolution = await this.options.sessions.get(sourceSessionId);
    if (!sourceForResolution) return undefined;
    const target = await this.resolveCurrentTarget(sourceForResolution);
    const inspectedAt = this.now().toISOString();
    return this.options.store.transaction(async (transaction) => {
      const state = protectedState(await transaction.readEntries());
      const binding = state.bindings.get(bindingId);
      if (!binding || binding.sourceSessionId !== sourceSessionId
        || binding.reviewScopeDigest !== reviewScopeDigest
        || debugStopReviewScopeDigest(binding) !== reviewScopeDigest
        || debugStopBindingDigest(binding) !== bindingDigest
        || state.consumed.has(binding.id) || Date.parse(binding.expiresAt) <= Date.parse(inspectedAt)
        || binding.targetSnapshotId !== target.id || !sameRoot(binding.repositoryRoot, target.repositoryRoot)) return undefined;
      const current = validateCurrentBinding({
        state,
        sourceSessionId,
        effectSessionId: binding.effectSessionId,
        authorityId: binding.authorityId,
        target,
        now: inspectedAt,
        expectedResolvedSourceDigest: sessionBindingDigest(sourceForResolution)
      });
      if (sessionBindingDigest(current.source) !== binding.sourceSessionBindingDigest
        || sessionBindingDigest(current.effect) !== binding.effectSessionBindingDigest
        || sha256(stableJson(current.authority)) !== binding.authorityDigest
        || originBindingDigest(current.origin) !== binding.originOperationDigest) return undefined;
      return debugStopReview(binding);
    });
  }

  /**
   * Dispatcher seam: the caller cannot submit an effect-session identifier.
   * The reviewed scope locates the hidden protected binding exactly once.
   */
  async consume(input: Readonly<{
    action: typeof action;
    target: TargetSnapshot;
    session: ManagedSession;
    authority: AuthorityGrant;
    confirmation: BrokerConfirmation;
  }>): Promise<Readonly<{ effectSession: ManagedSession }> | undefined> {
    assertExactKeys(input, ["action", "target", "session", "authority", "confirmation"], "debug-stop dispatch consumption");
    if (input.action !== action || !input.confirmation.currentUserConfirmed
      || input.confirmation.action !== action || !input.confirmation.confirmationScopeDigest
      || input.confirmation.targetSnapshotId !== input.target.id
      || input.confirmation.sessionId !== input.session.id
      || input.confirmation.authorityId !== input.authority.id) return undefined;
    const scope = exactDigest(input.confirmation.confirmationScopeDigest, "review scope digest");
    let candidates: DebugStopBinding[];
    try {
      const state = protectedState(await this.options.store.readEntries());
      candidates = [...state.bindings.values()].filter((binding) => binding.reviewScopeDigest === scope
        && binding.sourceSessionId === input.session.id && binding.authorityId === input.authority.id
        && binding.targetSnapshotId === input.target.id && !state.consumed.has(binding.id));
    } catch { return undefined; }
    if (candidates.length !== 1) return undefined;
    try {
      const claimed = await this.claim({
        bindingId: candidates[0]!.id,
        reviewScopeDigest: scope,
        sourceSessionId: input.session.id,
        authorityId: input.authority.id,
        target: input.target
      });
      return { effectSession: claimed.effectSession };
    } catch { return undefined; }
  }

  private async resolveCurrentTarget(source: ManagedSession): Promise<TargetSnapshot> {
    validateSource(source);
    const target = await this.options.targetResolver.resolve({ definition: commandForAction(action), session: source });
    if (!target) throw new DebugStopBindingError("The current target is unavailable for debug-stop review.");
    validateTarget(target);
    if (source.targetSnapshotId !== target.id || !source.workspaceRoot || !sameRoot(source.workspaceRoot, target.repositoryRoot)) {
      throw new DebugStopBindingError("The source provider session no longer binds the current exact target.");
    }
    return target;
  }
}

function debugStopReviewScopeDigest(binding: Omit<DebugStopBinding, "schema" | "version" | "reviewScopeDigest"> | DebugStopBinding): string {
  return sha256(stableJson({
    action: binding.action,
    authorityDigest: binding.authorityDigest,
    authorityId: binding.authorityId,
    debugBindingId: binding.debugBindingId,
    debugConfiguration: binding.debugConfiguration,
    debugSessionId: binding.debugSessionId,
    effectKind: binding.effectKind,
    effectSessionBindingDigest: binding.effectSessionBindingDigest,
    effectSessionId: binding.effectSessionId,
    expiresAt: binding.expiresAt,
    id: binding.id,
    originOperationDigest: binding.originOperationDigest,
    originOperationId: binding.originOperationId,
    managedProcessId: binding.managedProcessId,
    repositoryRoot: binding.repositoryRoot,
    sourceSessionBindingDigest: binding.sourceSessionBindingDigest,
    sourceSessionId: binding.sourceSessionId,
    targetSnapshotId: binding.targetSnapshotId
  }));
}

export function debugStopBindingDigest(binding: DebugStopBinding): string {
  return sha256(stableJson(binding));
}

export function debugStopReview(binding: DebugStopBinding): DebugStopReview {
  return jsonClone({
    schema: "sxsy-b122.debug-stop-review",
    version: 1,
    action,
    bindingId: binding.id,
    bindingDigest: debugStopBindingDigest(binding),
    reviewScopeDigest: binding.reviewScopeDigest,
    sourceSessionId: binding.sourceSessionId,
    authorityId: binding.authorityId,
    targetSnapshotId: binding.targetSnapshotId,
    repositoryRoot: binding.repositoryRoot,
    originOperationId: binding.originOperationId,
    effectKind: binding.effectKind,
    debugSessionId: binding.debugSessionId,
    debugBindingId: binding.debugBindingId,
    debugConfiguration: binding.debugConfiguration,
    managedProcessId: binding.managedProcessId,
    createdAt: binding.createdAt,
    expiresAt: binding.expiresAt
  });
}

/** Dynamic lifecycle state may advance safely; these fields may never rebind. */
function originBindingDigest(operation: OperationRecord): string {
  return sha256(stableJson({
    action: operation.action,
    authorityId: operation.details.authorityId ?? null,
    createdAt: operation.createdAt,
    id: operation.id,
    idempotencyKey: operation.idempotencyKey,
    parentId: operation.parentId ?? null,
    sessionId: operation.details.sessionId ?? null,
    targetSnapshotId: operation.targetSnapshotId
  }));
}

interface ProtectedState {
  readonly sessions: ReadonlyMap<string, ManagedSession>;
  readonly authorities: ReadonlyMap<string, AuthorityGrant>;
  readonly revokedAuthorities: ReadonlySet<string>;
  readonly operations: ReadonlyMap<string, OperationRecord>;
  readonly bindings: ReadonlyMap<string, DebugStopBinding>;
  readonly consumed: ReadonlySet<string>;
}

function protectedState(entries: readonly JournalEntry<unknown>[]): ProtectedState {
  const sessions = new Map<string, ManagedSession>();
  const authorities = new Map<string, AuthorityGrant>();
  const revokedAuthorities = new Set<string>();
  const operations = new Map<string, OperationRecord>();
  const bindings = new Map<string, DebugStopBinding>();
  const consumed = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "session.registered" || entry.kind === "session.updated") {
      const session = (entry.payload as { session?: ManagedSession } | undefined)?.session;
      if (!session || typeof session.id !== "string") throw new DebugStopBindingError("A protected session record is malformed.");
      sessions.set(session.id, jsonClone(session));
    } else if (entry.kind === "authority.issued") {
      const authority = (entry.payload as { grant?: AuthorityGrant } | undefined)?.grant;
      if (!authority || typeof authority.id !== "string") throw new DebugStopBindingError("A protected authority record is malformed.");
      authorities.set(authority.id, jsonClone(authority));
    } else if (entry.kind === "authority.revoked") {
      const authorityId = (entry.payload as { authorityId?: unknown } | undefined)?.authorityId;
      if (typeof authorityId !== "string") throw new DebugStopBindingError("A protected authority revocation is malformed.");
      revokedAuthorities.add(authorityId);
    } else if (entry.kind === "operation.created" || entry.kind === "operation.updated") {
      const operation = (entry.payload as { operation?: OperationRecord } | undefined)?.operation;
      if (!operation || typeof operation.id !== "string") throw new DebugStopBindingError("A protected operation record is malformed.");
      operations.set(operation.id, jsonClone(operation));
    } else if (entry.kind === preparedEvent) {
      const binding = parseBinding((entry.payload as Partial<PreparedPayload> | undefined)?.binding);
      const existing = bindings.get(binding.id);
      if (existing && stableJson(existing) !== stableJson(binding)) throw new DebugStopBindingError("A protected debug-stop binding id has conflicting material.");
      bindings.set(binding.id, binding);
    } else if (entry.kind === consumedEvent) {
      const payload = entry.payload as Partial<ConsumedPayload> | undefined;
      if (!payload || typeof payload.bindingId !== "string" || !digestPattern.test(String(payload.reviewScopeDigest))
        || typeof payload.consumedAt !== "string" || !Number.isFinite(Date.parse(payload.consumedAt))) {
        throw new DebugStopBindingError("A protected debug-stop consumption record is malformed.");
      }
      consumed.add(payload.bindingId);
    }
  }
  return { sessions, authorities, revokedAuthorities, operations, bindings, consumed };
}

function validateCurrentBinding(input: Readonly<{
  state: ProtectedState;
  sourceSessionId: string;
  effectSessionId: string;
  authorityId: string;
  target: TargetSnapshot;
  now: string;
  expectedResolvedSourceDigest: string;
}>): Readonly<{
  source: ManagedSession;
  effect: ManagedSession;
  authority: AuthorityGrant;
  origin: OperationRecord;
  effectIdentity: StopEffectIdentity;
}> {
  const source = input.state.sessions.get(input.sourceSessionId);
  if (!source) throw new DebugStopBindingError("The exact source provider session is absent.");
  validateSource(source);
  if (sessionBindingDigest(source) !== input.expectedResolvedSourceDigest
    || source.targetSnapshotId !== input.target.id || !source.workspaceRoot || !sameRoot(source.workspaceRoot, input.target.repositoryRoot)) {
    throw new DebugStopBindingError("The source provider session binding changed during target resolution.");
  }

  const effect = input.state.sessions.get(input.effectSessionId);
  if (!effect) throw new DebugStopBindingError("The exact managed effect session is absent.");
  const effectIdentity = validateEffect(effect, source, input.target);
  assertUnambiguousEffect(input.state.sessions, effect, effectIdentity);

  const origin = input.state.operations.get(effectIdentity.originOperationId);
  if (!origin || origin.action !== effectIdentity.originAction) {
    throw new DebugStopBindingError(`The managed effect does not name one exact durable ${effectIdentity.originAction} origin operation.`);
  }
  if (origin.targetSnapshotId !== input.target.id || origin.details.sessionId !== source.id) {
    throw new DebugStopBindingError("The debug origin operation changed its exact source or target binding.");
  }
  // The authenticated VS Code debug-session registration is itself the exact
  // host acknowledgement that the effect exists. Its parent operation may
  // still be Executing while that acknowledgement is reconciled into a final
  // receipt; Prepared and cancellation/failure states are never sufficient.
  if (!(["executing", "external_committed", "recorded"] as const).includes(origin.state as "executing" | "external_committed" | "recorded")) {
    throw new DebugStopBindingError("The debug origin operation is not active or durably committed for this exact debug effect.");
  }

  const authority = input.state.authorities.get(input.authorityId);
  if (!authority) throw new DebugStopBindingError("The exact debug-stop authority is absent.");
  if (input.state.revokedAuthorities.has(authority.id) || authority.revokedAt) {
    throw new DebugStopBindingError("The exact debug-stop authority was revoked.");
  }
  if (Date.parse(authority.expiresAt) <= Date.parse(input.now)) throw new DebugStopBindingError("The exact debug-stop authority expired.");
  if (!sameRoot(authority.repositoryRoot, input.target.repositoryRoot)
    || authority.sessionId !== source.id || authority.taskId !== source.taskId || authority.planRevision !== source.planRevision) {
    throw new DebugStopBindingError("The authority is not scoped to the exact debug-stop source, task, plan, and repository.");
  }
  if (!authority.allowedActions.includes(action) || authority.prohibitedActions.includes(action)) {
    throw new DebugStopBindingError("The authority does not permit the exact stop_managed_run action.");
  }
  return { source, effect, authority, origin, effectIdentity };
}

function validateSource(source: ManagedSession): void {
  if (source.provider !== "claude" && source.provider !== "codex") {
    throw new DebugStopBindingError("The debug-stop source must be one configured Claude or Codex provider session.");
  }
  if (source.status !== "running") throw new DebugStopBindingError("The source provider session is not running.");
  const required = new Set(commandForAction(action).requiresCapabilities);
  required.add("registered");
  if ([...required].some((capability) => !source.capabilities.includes(capability))) {
    throw new DebugStopBindingError("The source provider session lacks the exact registered mediated capability floor.");
  }
  if (!source.workspaceRoot || !source.targetSnapshotId || !source.taskId || !source.planRevision) {
    throw new DebugStopBindingError("The source provider session lacks an exact repository, target, task, or plan binding.");
  }
}

interface StopEffectIdentity {
  readonly effectKind: "debug_session" | "managed_run";
  readonly originAction: "debug_target" | "run_target";
  readonly originOperationId: string;
  readonly originSessionId: string;
  readonly workspaceRoot: string;
  readonly debugSessionId: string | null;
  readonly debugConfiguration: string | null;
  readonly debugBindingId: string | null;
  readonly managedProcessId: string | null;
}

function validateEffect(effect: ManagedSession, source: ManagedSession, target: TargetSnapshot): StopEffectIdentity {
  if (effect.id === source.id) throw new DebugStopBindingError("The source provider and managed-effect sessions must be distinct.");
  if (effect.provider !== "generic" || effect.surface !== "vscode_window") {
    throw new DebugStopBindingError("The managed effect must be an installed VS Code window session, not a provider session.");
  }
  if (effect.status !== "running" || !effect.capabilities.includes("registered")) {
    throw new DebugStopBindingError("The managed effect must remain one running registered protected session.");
  }
  if (!effect.workspaceRoot || !sameRoot(effect.workspaceRoot, target.repositoryRoot)
    || effect.targetSnapshotId !== target.id) {
    throw new DebugStopBindingError("The managed effect changed its exact repository or TargetSnapshot binding.");
  }
  const metadata = effect.metadata;
  let identity: StopEffectIdentity;
  if (metadata["sxsy-b122.kind"] === "debug-session") {
    identity = {
      effectKind: "debug_session",
      originAction: "debug_target",
      debugSessionId: boundedReference(metadata["sxsy-b122.debugSessionId"], "debug session identity"),
      originOperationId: boundedReference(metadata["sxsy-b122.debugOriginOperationId"], "debug origin operation identity"),
      originSessionId: boundedReference(metadata["sxsy-b122.debugOriginSessionId"], "debug origin source identity"),
      workspaceRoot: boundedReference(metadata["sxsy-b122.debugWorkspaceRoot"], "debug workspace root", 4_096),
      debugConfiguration: boundedReference(metadata["sxsy-b122.debugConfiguration"], "debug configuration"),
      debugBindingId: boundedReference(metadata["sxsy-b122.debugBindingId"], "debug binding identity"),
      managedProcessId: null
    };
  } else if (metadata["sxsy-b122.kind"] === "managed-run") {
    const managedProcessId = boundedReference(metadata["sxsy-b122.managedProcessId"], "managed process identity");
    if (!/^managed:[a-f0-9]{64}$/.test(managedProcessId)) {
      throw new DebugStopBindingError("The managed Run effect has an invalid protected process identity.");
    }
    identity = {
      effectKind: "managed_run",
      originAction: "run_target",
      originOperationId: boundedReference(metadata["sxsy-b122.runOriginOperationId"], "managed Run origin operation identity"),
      originSessionId: boundedReference(metadata["sxsy-b122.runOriginSessionId"], "managed Run origin source identity"),
      workspaceRoot: boundedReference(metadata["sxsy-b122.runWorkspaceRoot"], "managed Run workspace root", 4_096),
      debugSessionId: null,
      debugConfiguration: null,
      debugBindingId: null,
      managedProcessId
    };
  } else {
    throw new DebugStopBindingError("The selected effect is not a protected debug or managed Run session.");
  }
  if (identity.originSessionId !== source.id || !sameRoot(identity.workspaceRoot, target.repositoryRoot)) {
    throw new DebugStopBindingError("The managed effect changed its exact source or workspace origin.");
  }
  return identity;
}

function assertUnambiguousEffect(sessions: ReadonlyMap<string, ManagedSession>, selected: ManagedSession, identity: StopEffectIdentity): void {
  for (const candidate of sessions.values()) {
    if (candidate.id === selected.id || candidate.status !== "running") continue;
    if (identity.effectKind === "debug_session" && candidate.metadata["sxsy-b122.kind"] === "debug-session"
      && (candidate.metadata["sxsy-b122.debugSessionId"] === identity.debugSessionId
        || candidate.metadata["sxsy-b122.debugBindingId"] === identity.debugBindingId
        || candidate.metadata["sxsy-b122.debugOriginOperationId"] === identity.originOperationId)) {
      throw new DebugStopBindingError("The protected debug-effect identity is duplicated or ambiguous.");
    }
    if (identity.effectKind === "managed_run" && candidate.metadata["sxsy-b122.kind"] === "managed-run"
      && (candidate.metadata["sxsy-b122.managedProcessId"] === identity.managedProcessId
        || candidate.metadata["sxsy-b122.runOriginOperationId"] === identity.originOperationId)) {
      throw new DebugStopBindingError("The protected managed Run identity is duplicated or ambiguous.");
    }
  }
}

function sameEffectIdentity(identity: StopEffectIdentity, binding: DebugStopBinding): boolean {
  return identity.effectKind === binding.effectKind
    && identity.debugSessionId === binding.debugSessionId
    && identity.debugBindingId === binding.debugBindingId
    && identity.debugConfiguration === binding.debugConfiguration
    && identity.managedProcessId === binding.managedProcessId;
}

function validateTarget(target: TargetSnapshot): void {
  if (!target || target.completeness !== "complete" || targetSnapshotDigest(target) !== target.id) {
    throw new DebugStopBindingError("Debug-stop requires one complete canonical current TargetSnapshot.");
  }
  boundedReference(target.repositoryRoot, "target repository root", 4_096);
}

function parseBinding(value: unknown): DebugStopBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DebugStopBindingError("A protected debug-stop binding is malformed.");
  const binding = value as Partial<DebugStopBinding>;
  assertExactKeys(binding, [
    "schema", "version", "id", "action", "sourceSessionId", "sourceSessionBindingDigest", "effectSessionId",
    "effectSessionBindingDigest", "authorityId", "authorityDigest", "targetSnapshotId", "repositoryRoot",
    "originOperationId", "originOperationDigest", "effectKind", "debugSessionId", "debugBindingId", "debugConfiguration",
    "managedProcessId", "createdAt", "expiresAt", "reviewScopeDigest"
  ], "protected debug-stop binding");
  if (binding.schema !== "sxsy-b122.debug-stop-binding" || binding.version !== 1 || binding.action !== action
    || typeof binding.id !== "string" || !/^debug-stop:[a-f0-9]{64}$/.test(binding.id)
    || !digestPattern.test(String(binding.sourceSessionBindingDigest)) || !digestPattern.test(String(binding.effectSessionBindingDigest))
    || !digestPattern.test(String(binding.authorityDigest)) || !digestPattern.test(String(binding.targetSnapshotId))
    || !digestPattern.test(String(binding.originOperationDigest)) || !digestPattern.test(String(binding.reviewScopeDigest))
    || (binding.effectKind !== "debug_session" && binding.effectKind !== "managed_run")
    || typeof binding.createdAt !== "string" || !Number.isFinite(Date.parse(binding.createdAt))
    || typeof binding.expiresAt !== "string" || !Number.isFinite(Date.parse(binding.expiresAt))) {
    throw new DebugStopBindingError("A protected debug-stop binding contains invalid immutable material.");
  }
  for (const [label, field, limit] of [
    ["source session id", binding.sourceSessionId, 256], ["effect session id", binding.effectSessionId, 256],
    ["authority id", binding.authorityId, 256], ["repository root", binding.repositoryRoot, 4_096],
    ["origin operation id", binding.originOperationId, 256]
  ] as const) boundedReference(field, label, limit);
  if (binding.effectKind === "debug_session") {
    for (const [label, field] of [
      ["debug session id", binding.debugSessionId], ["debug binding id", binding.debugBindingId],
      ["debug configuration", binding.debugConfiguration]
    ] as const) boundedReference(field, label);
    if (binding.managedProcessId !== null) throw new DebugStopBindingError("A protected debug effect cannot bind a managed process identity.");
  } else {
    if (binding.debugSessionId !== null || binding.debugBindingId !== null || binding.debugConfiguration !== null
      || typeof binding.managedProcessId !== "string" || !/^managed:[a-f0-9]{64}$/.test(binding.managedProcessId)) {
      throw new DebugStopBindingError("A protected managed Run effect contains invalid immutable identity material.");
    }
  }
  const exact = binding as DebugStopBinding;
  if (debugStopReviewScopeDigest(exact) !== exact.reviewScopeDigest) throw new DebugStopBindingError("A protected debug-stop review scope digest is invalid.");
  return jsonClone(exact);
}

function exactDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) throw new DebugStopBindingError(`${field} must be an exact SHA-256 digest.`);
  return value;
}

function boundedReference(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\r\n\0]/u.test(value)) {
    throw new DebugStopBindingError(`${field} must be one bounded non-empty host reference.`);
  }
  return value;
}

function sameRoot(left: string, right: string): boolean {
  return normalizeRoot(left) === normalizeRoot(right);
}

function normalizeRoot(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return /^[a-z]:\//iu.test(normalized) ? normalized.toLowerCase() : normalized;
}

function assertExactKeys(value: object, keys: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new DebugStopBindingError(`${label} requires one closed exact field set.`);
  }
}
