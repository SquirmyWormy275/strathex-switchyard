import type { AutomationRequest, PermitVerifier } from "../../../packages/control-plane/src/brokers.ts";
import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { AuthorityGrant, ManagedSession, OperationRecord, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import {
  canonicalWorktreeManifest,
  targetSnapshotDigest,
  targetSnapshotIdentity,
  TargetSnapshotFactory,
  type CanonicalManifestFile,
  type GitInspection,
  type GitInspector,
  type SnapshotCaptureOptions
} from "../../../packages/control-plane/src/snapshot.ts";
import { sessionBindingDigest } from "../../../packages/control-plane/src/session-registry.ts";
import { jsonClone, ProtectedJsonStore, sha256, stableJson, type JsonValue } from "../../../packages/control-plane/src/store.ts";
import { parseAutomationEnvelope, type AutomationEnvelope } from "../../../packages/control-plane/src/automation-protocol.ts";
import type { AutomationEffectChild, AutomationPathMutation } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import {
  ProtectedStoreAutomationEffectJournal,
  type AutomationEffectGuardPort,
  type AutomationEffectJournalState,
  type AutomationTargetTransitionPhase,
  type AutomationTargetTransitionPort
} from "./automation-effect-executor.ts";
import type { EffectTargetTransitionPort } from "./effect-target-transition.ts";
import { installedAutomationRefreshGitEvidenceDigest } from "./automation-refresh-git.ts";

const stateEntryKind = "b122.automation-installed-runtime-state";
const digestPattern = /^[a-f0-9]{64}$/u;

export interface AutomationObservedFile extends CanonicalManifestFile {
  readonly manifest: "tracked" | "untracked";
}

export interface AutomationHostTargetObservation {
  readonly schema: "sxsy-b122.automation-host-target-observation";
  readonly version: 1;
  readonly snapshot: TargetSnapshot;
  readonly files: readonly AutomationObservedFile[];
  readonly digest: string;
}

export interface AutomationHostTargetObserver {
  observe(input: Readonly<{
    action: AutomationEnvelope["action"];
    repositoryRoot: string;
    session: ManagedSession;
  }>): Promise<AutomationHostTargetObservation>;
}

export interface GitAutomationHostTargetObserverOptions {
  readonly inspector: GitInspector;
  readonly captureOptionsFor: (input: Readonly<{
    action: AutomationEnvelope["action"];
    repositoryRoot: string;
    session: ManagedSession;
  }>) => Omit<SnapshotCaptureOptions, "targetHint">;
  readonly clock?: () => string;
}

/**
 * Captures one snapshot and its exact canonical file inventory from the same
 * read-only Git inspection. A separate TargetResolver remains mandatory at
 * the final-current boundary so this inventory adapter is never its own trust
 * witness.
 */
export class GitAutomationHostTargetObserver implements AutomationHostTargetObserver {
  constructor(private readonly options: GitAutomationHostTargetObserverOptions) {}

  async observe(input: Readonly<{ action: AutomationEnvelope["action"]; repositoryRoot: string; session: ManagedSession }>): Promise<AutomationHostTargetObservation> {
    const inspection = await this.options.inspector.inspect(input.repositoryRoot);
    const oneShot: GitInspector = { inspect: async () => jsonClone(inspection) };
    const snapshot = await new TargetSnapshotFactory(oneShot, { ...(this.options.clock ? { clock: this.options.clock } : {}) }).capture({
      ...this.options.captureOptionsFor(input),
      targetHint: input.repositoryRoot
    });
    return automationHostTargetObservation(snapshot, inspection);
  }
}

export interface AutomationInstalledContainmentBinding {
  readonly status: "clear";
  readonly bindingDigest: string;
  readonly fenceEpoch: number;
  readonly activationOperationId: null;
}

export interface InstalledAutomationEffectRuntimeOptions {
  readonly store: ProtectedJsonStore;
  readonly request: AutomationRequest;
  readonly envelope: AutomationEnvelope;
  readonly operations: Readonly<{ get(id: string): Promise<OperationRecord | undefined> }>;
  readonly sessions: Readonly<{ get(id: string): Promise<ManagedSession | undefined> }>;
  readonly authorities: Readonly<{ get(id: string): Promise<AuthorityGrant | undefined> }>;
  readonly policy: PermitVerifier;
  readonly containment: Readonly<{ currentClear(repositoryRoot: string): Promise<AutomationInstalledContainmentBinding> }>;
  readonly targetResolver: TargetResolver;
  readonly targetObserver: AutomationHostTargetObserver;
  readonly targetTransitions: EffectTargetTransitionPort;
  readonly now?: () => Date;
}

interface AcceptedRuntimeTransition {
  readonly transitionId: string;
  readonly phase: AutomationTargetTransitionPhase;
  readonly expectation: "changed" | "unchanged";
  readonly fromTargetSnapshotId: string;
  readonly toTargetSnapshotId: string;
  readonly effectEvidenceDigest: string;
  readonly hostObservationDigest: string;
}

interface InstalledRuntimeState {
  readonly schema: "sxsy-b122.automation-installed-runtime-state";
  readonly version: 1;
  readonly revision: number;
  readonly operationId: string;
  readonly action: AutomationEnvelope["action"];
  readonly requestDigest: string;
  readonly sourceTarget: TargetSnapshot;
  readonly sourceSession: ManagedSession;
  readonly sourceSessionBindingDigest: string;
  readonly sourceAuthority: AuthorityGrant;
  readonly sourceObservation: AutomationHostTargetObservation;
  readonly currentTarget: TargetSnapshot;
  readonly currentSession: ManagedSession;
  readonly currentObservation: AutomationHostTargetObservation;
  readonly containment: AutomationInstalledContainmentBinding;
  readonly executionDeadline: string;
  readonly transitions: readonly AcceptedRuntimeTransition[];
  readonly updatedAt: string;
  readonly stateDigest: string;
}

/**
 * Request-bound production guard and transition pair. The provider never
 * receives either port. Every accepted in-flight target is independently
 * resolved, inventory-observed, and compare-and-swapped onto the exact
 * authenticated managed session.
 */
export class InstalledAutomationEffectRuntime {
  readonly guard: AutomationEffectGuardPort;
  readonly targetTransition: AutomationTargetTransitionPort;
  private readonly envelope: AutomationEnvelope;
  private readonly requestDigest: string;
  private readonly now: () => Date;

  constructor(private readonly options: InstalledAutomationEffectRuntimeOptions) {
    if (!options.store.hasAuthenticatedProtection) throw new Error("Installed automation target transitions require authenticated protected state.");
    this.envelope = parseAutomationEnvelope(options.envelope);
    assertRequestBinding(options.request, this.envelope);
    if (!options.request.session || !options.request.authority || !options.request.permit || !options.request.executionControl || !options.request.effectGuard) {
      throw new Error("Installed automation requires the exact session, authority, permit, execution control, and admission effect guard.");
    }
    if (options.request.executionControl.operationId !== this.envelope.operationId) throw new Error("Automation execution control changed its exact operation binding.");
    this.now = options.now ?? (() => new Date());
    this.requestDigest = requestBindingDigest(options.request, this.envelope);
    this.guard = Object.freeze({ assertCurrent: (input: Parameters<AutomationEffectGuardPort["assertCurrent"]>[0]) => this.assertCurrent(input) });
    this.targetTransition = Object.freeze({ captureAndAccept: (input: Parameters<AutomationTargetTransitionPort["captureAndAccept"]>[0]) => this.captureAndAccept(input) });
  }

  private async assertCurrent(input: Parameters<AutomationEffectGuardPort["assertCurrent"]>[0]): Promise<void> {
    const envelope = parseAutomationEnvelope(input.envelope);
    if (stableJson(envelope) !== stableJson(this.envelope) || envelope.operationId !== this.options.request.operationId
      || input.expectedTargetSnapshotId !== input.envelope.manifest.targetSnapshotId && !digestPattern.test(input.expectedTargetSnapshotId)) {
      throw new Error("The automation final-current request changed its exact reviewed envelope or target identity.");
    }
    assertBoundaryScope(envelope, input);
    const stored = await this.loadState();
    if (!stored) {
      if (input.boundary !== "before_operation" || input.expectedTargetSnapshotId !== envelope.manifest.targetSnapshotId) {
        throw new Error("Automation runtime source state must be authenticated before any child effect boundary.");
      }
      await this.assertAdmissionGuard();
      const containment = await this.readContainment();
      const sourceSession = this.options.request.session!;
      const sourceTarget = this.options.request.target;
      await this.assertGovernance(undefined, containment);
      const observed = await this.observeCurrent(sourceSession, sourceTarget);
      const state = withStateDigest({
        schema: "sxsy-b122.automation-installed-runtime-state",
        version: 1,
        revision: 1,
        operationId: envelope.operationId,
        action: envelope.action,
        requestDigest: this.requestDigest,
        sourceTarget: jsonClone(sourceTarget),
        sourceSession: jsonClone(sourceSession),
        sourceSessionBindingDigest: sessionBindingDigest(sourceSession),
        sourceAuthority: jsonClone(this.options.request.authority!),
        sourceObservation: observed,
        currentTarget: jsonClone(sourceTarget),
        currentSession: jsonClone(sourceSession),
        currentObservation: observed,
        containment,
        executionDeadline: this.options.request.executionControl!.deadline,
        transitions: [],
        updatedAt: this.timestamp()
      });
      await this.saveInitial(state);
      return;
    }
    this.assertStoredBinding(stored, input.expectedTargetSnapshotId);
    await this.assertGovernance(stored, stored.containment);
    await this.observeCurrent(stored.currentSession, stored.currentTarget, stored.currentObservation);
  }

  private async captureAndAccept(input: Parameters<AutomationTargetTransitionPort["captureAndAccept"]>[0]): Promise<Awaited<ReturnType<AutomationTargetTransitionPort["captureAndAccept"]>>> {
    const envelope = parseAutomationEnvelope(input.envelope);
    assertTransitionRequest(input, envelope, this.envelope);
    let state = await this.requireState();
    const replay = state.transitions.find((entry) => entry.transitionId === input.transitionId);
    if (replay) {
      this.assertStoredBinding(state, state.currentTarget.id);
      if (replay.fromTargetSnapshotId !== input.previousTargetSnapshotId
        || replay.expectation !== input.expectation
        || replay.effectEvidenceDigest !== input.expectedEffectEvidenceDigest
        || stableJson(replay.phase) !== stableJson(input.phase)) {
        throw new Error("The accepted automation transition id was replayed with a different source, phase, expectation, or effect digest.");
      }
      return transitionOutput(replay);
    }
    this.assertStoredBinding(state, input.previousTargetSnapshotId);
    await this.assertGovernance(state, state.containment, input.transitionId);

    const effectEvidence = await this.reconstructEffectEvidence(input, state);
    const effectEvidenceDigest = effectEvidence.boundaryDigest;
    if (effectEvidenceDigest !== input.expectedEffectEvidenceDigest) {
      throw new Error("The automation transition effect digest is forged or contradicts the authenticated effect journal.");
    }
    const after = parseObservation(await this.options.targetObserver.observe({
      action: envelope.action,
      repositoryRoot: state.currentTarget.repositoryRoot,
      session: state.currentSession
    }));
    proveObservedTransition(state.currentObservation, after, input.phase, input.expectation, envelope);
    if (input.expectation === "changed" && isRefreshGitExecutePhase(envelope, input.phase)) {
      if (!effectEvidence.childEvidenceDigest || !after.snapshot.head) {
        throw new Error("The exact committed Refresh Git evidence or host-observed HEAD is absent; recovery is required.");
      }
      const observedEvidenceDigest = installedAutomationRefreshGitEvidenceDigest({
        envelope,
        sourceTarget: state.currentTarget,
        session: state.currentSession,
        postHead: after.snapshot.head
      });
      if (observedEvidenceDigest !== effectEvidence.childEvidenceDigest) {
        throw new Error("The host-observed Refresh HEAD does not match the exact committed Git evidence; recovery is required.");
      }
    }

    const accepted = await this.options.targetTransitions.captureAndAccept({
      action: envelope.action as CommandAction,
      operationId: input.transitionId,
      previousTarget: state.currentTarget,
      session: state.currentSession,
      expectedTargetSnapshotId: after.snapshot.id,
      allowUnchanged: input.expectation === "unchanged"
    });
    if (accepted.target.id !== after.snapshot.id || !sameTargetIdentity(accepted.target, after.snapshot)
      || accepted.session.id !== state.currentSession.id || accepted.session.targetSnapshotId !== accepted.target.id
      || (input.expectation === "changed" && accepted.status !== "transitioned" && accepted.status !== "already_transitioned")
      || (input.expectation === "unchanged" && accepted.status !== "unchanged")) {
      throw new Error("The durable target compare-and-swap contradicted the independently observed transition.");
    }
    const hostObservationDigest = sha256(stableJson({
      schema: "sxsy-b122.automation-host-transition-observation",
      version: 1,
      transitionId: input.transitionId,
      operationId: input.operationId,
      phase: input.phase,
      expectation: input.expectation,
      fromTargetSnapshotId: state.currentTarget.id,
      toTargetSnapshotId: accepted.target.id,
      effectEvidenceDigest,
      beforeObservationDigest: state.currentObservation.digest,
      afterObservationDigest: after.digest
    }));
    const transition: AcceptedRuntimeTransition = Object.freeze({
      transitionId: input.transitionId,
      phase: jsonClone(input.phase),
      expectation: input.expectation,
      fromTargetSnapshotId: state.currentTarget.id,
      toTargetSnapshotId: accepted.target.id,
      effectEvidenceDigest,
      hostObservationDigest
    });
    const next = withStateDigest({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      currentTarget: jsonClone(accepted.target),
      currentSession: jsonClone(accepted.session),
      currentObservation: after,
      transitions: [...state.transitions, transition],
      updatedAt: this.timestamp()
    });
    try { await this.saveNext(state, next); }
    catch (error) {
      state = await this.requireState();
      const recovered = state.transitions.find((entry) => entry.transitionId === input.transitionId);
      if (!recovered || stableJson(recovered) !== stableJson(transition)) throw error;
      return transitionOutput(recovered);
    }
    return transitionOutput(transition);
  }

  private async assertAdmissionGuard(): Promise<void> {
    const result = await this.options.request.effectGuard!.assertCurrent({
      action: this.options.request.action,
      operationId: this.options.request.operationId,
      target: this.options.request.target,
      session: this.options.request.session,
      authority: this.options.request.authority
    });
    if (!result.allowed) throw new Error(`The installed automation admission guard rejected the request: ${result.reason}`);
  }

  private async assertGovernance(
    state: InstalledRuntimeState | undefined,
    expectedContainment: AutomationInstalledContainmentBinding,
    pendingTransitionId?: string
  ): Promise<void> {
    const request = this.options.request;
    const now = this.now();
    if (!Number.isFinite(now.getTime())) throw new Error("The installed automation clock is invalid.");
    const operation = await this.options.operations.get(request.operationId);
    if (!operation || operation.state !== "executing" || operation.action !== request.action
      || operation.targetSnapshotId !== request.target.id) throw new Error("The durable automation operation is absent, changed, or no longer executing.");
    if (!this.options.policy.verifyPermit(request.permit, {
      action: request.action,
      operationId: request.operationId,
      targetSnapshotId: request.target.id,
      sessionId: request.session!.id,
      authorityId: request.authority!.id
    })) throw new Error("The exact automation policy permit is absent, expired, or changed.");
    const control = request.executionControl!;
    if (control.operationId !== request.operationId || control.deadline !== (state?.executionDeadline ?? control.deadline)
      || !Number.isFinite(Date.parse(control.deadline)) || Date.parse(control.deadline) <= now.getTime()) {
      throw new Error("The automation execution deadline elapsed or changed.");
    }
    let cancelled: boolean;
    try { cancelled = await control.isCancellationRequested(); }
    catch { throw new Error("The automation cancellation state is unavailable."); }
    if (cancelled) throw new Error("The automation operation was cancelled before an effect boundary.");
    if (now.getTime() < Date.parse(this.envelope.manifest.createdAt)
      || now.getTime() >= Date.parse(this.envelope.manifest.expiresAt)
      || now.getTime() >= Date.parse(this.envelope.approval.expiresAt)) {
      throw new Error("The reviewed automation manifest or approval is not currently valid.");
    }
    const session = await this.options.sessions.get(request.session!.id);
    const expectedSession = state?.currentSession ?? request.session!;
    const exactSession = !!session && stableJson(session) === stableJson(expectedSession)
      && sessionBindingDigest(session) === sessionBindingDigest(expectedSession);
    const lostResponseReplay = !!session && !!state && !!pendingTransitionId
      && sessionMatchesLostTransitionResponse(session, expectedSession, pendingTransitionId, this.envelope.action);
    if (!session || (!exactSession && !lostResponseReplay)
      || !session.workspaceRoot || !sameRoot(session.workspaceRoot, request.target.repositoryRoot)
      || session.status === "stale" || session.status === "unreachable" || session.status === "unknown") {
      throw new Error("The exact authenticated automation session changed or became ineligible.");
    }
    const authority = await this.options.authorities.get(request.authority!.id);
    if (!authority || stableJson(authority) !== stableJson(state?.sourceAuthority ?? request.authority!) || authority.revokedAt
      || !Number.isFinite(Date.parse(authority.issuedAt)) || Date.parse(authority.issuedAt) > now.getTime()
      || !Number.isFinite(Date.parse(authority.expiresAt)) || Date.parse(authority.expiresAt) <= now.getTime()
      || !sameRoot(authority.repositoryRoot, request.target.repositoryRoot)
      || authority.sessionId !== session.id || authority.taskId !== session.taskId || authority.planRevision !== session.planRevision
      || authority.prohibitedActions.includes(request.action) || !authority.allowedActions.includes(request.action)) {
      throw new Error("The exact automation authority changed, expired, or no longer permits this action.");
    }
    const containment = await this.readContainment();
    if (stableJson(containment) !== stableJson(expectedContainment)) throw new Error("The exact clear containment epoch changed.");
  }

  private async observeCurrent(session: ManagedSession, expectedTarget: TargetSnapshot, expectedObservation?: AutomationHostTargetObservation): Promise<AutomationHostTargetObservation> {
    const resolved = await this.options.targetResolver.resolve({ definition: commandForAction(this.envelope.action), session });
    if (!resolved || resolved.completeness !== "complete" || resolved.reasons.length !== 0
      || !sameTargetIdentity(resolved, expectedTarget) || !sameRoot(resolved.repositoryRoot, expectedTarget.repositoryRoot)) {
      throw new Error("The trusted target resolver no longer observes the exact accepted automation target.");
    }
    const observed = parseObservation(await this.options.targetObserver.observe({
      action: this.envelope.action,
      repositoryRoot: expectedTarget.repositoryRoot,
      session
    }));
    if (!sameTargetIdentity(observed.snapshot, expectedTarget)) throw new Error("The independent host inventory no longer matches the exact accepted automation target.");
    if (expectedObservation && observed.digest !== expectedObservation.digest) throw new Error("The independent host inventory changed before an automation effect boundary.");
    return observed;
  }

  private async reconstructEffectEvidence(
    input: Parameters<AutomationTargetTransitionPort["captureAndAccept"]>[0],
    state: InstalledRuntimeState
  ): Promise<AuthenticatedEffectEvidence> {
    const journal = await new ProtectedStoreAutomationEffectJournal(this.options.store).load(input.operationId);
    if (!journal || journal.action !== input.action || journal.currentTargetSnapshotId !== state.currentTarget.id) {
      throw new Error("The authenticated automation effect journal is absent or changed at the target transition.");
    }
    const pending = journal.targetTransitionChain.filter((entry) => entry.status === "pending");
    if (pending.length !== 1 || pending[0]!.transitionId !== input.transitionId
      || pending[0]!.fromTargetSnapshotId !== input.previousTargetSnapshotId
      || stableJson(pending[0]!.phase) !== stableJson(input.phase)
      || pending[0]!.expectation !== input.expectation
      || pending[0]!.expectedEffectEvidenceDigest !== input.expectedEffectEvidenceDigest) {
      throw new Error("The requested target transition is not the one authenticated pending executor boundary.");
    }
    return effectEvidenceFromJournal(journal, input.phase, state.currentTarget.id, this.envelope);
  }

  private assertStoredBinding(state: InstalledRuntimeState, expectedTargetSnapshotId: string): void {
    if (state.operationId !== this.envelope.operationId || state.action !== this.envelope.action
      || state.requestDigest !== this.requestDigest || state.currentTarget.id !== expectedTargetSnapshotId
      || state.currentSession.targetSnapshotId !== state.currentTarget.id
      || state.sourceTarget.id !== this.options.request.target.id
      || state.sourceSessionBindingDigest !== sessionBindingDigest(state.sourceSession)) {
      throw new Error("The authenticated automation runtime source or in-flight target binding changed.");
    }
  }

  private async readContainment(): Promise<AutomationInstalledContainmentBinding> {
    const value = await this.options.containment.currentClear(this.options.request.target.repositoryRoot);
    if (value.status !== "clear" || value.activationOperationId !== null || !digestPattern.test(value.bindingDigest)
      || !Number.isSafeInteger(value.fenceEpoch) || value.fenceEpoch < 0) throw new Error("Automation requires one exact clear containment binding.");
    return Object.freeze({ ...value });
  }

  private async loadState(): Promise<InstalledRuntimeState | undefined> {
    const entries = await this.options.store.readEntries<JsonValue>();
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]!;
      if (entry.kind !== stateEntryKind || !record(entry.payload) || entry.payload.operationId !== this.envelope.operationId) continue;
      return parseState(entry.payload);
    }
    return undefined;
  }

  private async requireState(): Promise<InstalledRuntimeState> {
    const state = await this.loadState();
    if (!state) throw new Error("The authenticated automation runtime source binding is absent.");
    return state;
  }

  private async saveInitial(state: InstalledRuntimeState): Promise<void> {
    await this.options.store.transaction(async (transaction) => {
      const entries = await transaction.readEntries<JsonValue>();
      const existing = latestState(entries, state.operationId);
      if (existing) {
        if (existing.requestDigest !== state.requestDigest || existing.stateDigest !== state.stateDigest) throw new Error("The automation runtime operation was already bound to different source state.");
        return;
      }
      await transaction.append(stateEntryKind, state as unknown as JsonValue);
    });
  }

  private async saveNext(prior: InstalledRuntimeState, next: InstalledRuntimeState): Promise<void> {
    await this.options.store.transaction(async (transaction) => {
      const current = latestState(await transaction.readEntries<JsonValue>(), prior.operationId);
      if (!current || current.stateDigest !== prior.stateDigest || next.revision !== prior.revision + 1) {
        throw new Error("The automation runtime target transition lost its authenticated state compare-and-swap.");
      }
      await transaction.append(stateEntryKind, next as unknown as JsonValue);
    });
  }

  private timestamp(): string {
    const value = this.now();
    if (!Number.isFinite(value.getTime())) throw new Error("The installed automation clock is invalid.");
    return value.toISOString();
  }
}

export function automationHostTargetObservation(snapshotValue: TargetSnapshot, inspection: GitInspection): AutomationHostTargetObservation {
  const snapshot = jsonClone(snapshotValue);
  const tracked = canonicalWorktreeManifest(inspection.trackedFiles, "tracked");
  const untracked = canonicalWorktreeManifest([
    ...(inspection.untrackedFiles ?? []).map((entry) => ({ ...entry, source: entry.source ?? "untracked" as const })),
    ...(inspection.ignoredFiles ?? []).map((entry) => ({ ...entry, source: "ignored" as const }))
  ], "untracked");
  if (snapshot.completeness !== "complete" || snapshot.reasons.length !== 0 || targetSnapshotDigest(snapshot) !== snapshot.id
    || (inspection.issues?.length ?? 0) !== 0 || tracked.reasons.length !== 0 || untracked.reasons.length !== 0
    || snapshot.trackedManifest !== tracked.digest || snapshot.untrackedManifest !== untracked.digest
    || !inspection.repositoryRoot || !sameRoot(inspection.repositoryRoot, snapshot.repositoryRoot)) {
    throw new Error("The host target inventory is incomplete, unreadable, or inconsistent with its canonical TargetSnapshot.");
  }
  const files: AutomationObservedFile[] = [
    ...tracked.files.map((entry) => ({ ...entry, manifest: "tracked" as const })),
    ...untracked.files.map((entry) => ({ ...entry, manifest: "untracked" as const }))
  ].sort((left, right) => left.path.localeCompare(right.path) || left.manifest.localeCompare(right.manifest));
  if (new Set(files.map((entry) => entry.path)).size !== files.length) throw new Error("The host target inventory repeats a path across tracked and untracked manifests.");
  const material = {
    schema: "sxsy-b122.automation-host-target-observation" as const,
    version: 1 as const,
    targetIdentity: targetSnapshotIdentity(snapshot),
    files
  };
  return Object.freeze({ schema: material.schema, version: 1, snapshot, files: Object.freeze(files), digest: sha256(stableJson(material)) });
}

function parseObservation(value: AutomationHostTargetObservation): AutomationHostTargetObservation {
  if (!value || value.schema !== "sxsy-b122.automation-host-target-observation" || value.version !== 1
    || !digestPattern.test(value.digest) || !Array.isArray(value.files)
    || value.snapshot.completeness !== "complete" || value.snapshot.reasons.length !== 0
    || targetSnapshotDigest(value.snapshot) !== value.snapshot.id) throw new Error("The host target observation is malformed or incomplete.");
  const files = value.files.map((entry) => ({ ...entry }));
  if (new Set(files.map((entry) => entry.path)).size !== files.length) throw new Error("The host target observation repeats a file path.");
  const tracked = canonicalWorktreeManifest(files.filter((entry) => entry.manifest === "tracked").map(({ manifest: _manifest, ...entry }) => entry), "tracked");
  const untracked = canonicalWorktreeManifest(files.filter((entry) => entry.manifest === "untracked").map(({ manifest: _manifest, ...entry }) => entry), "untracked");
  const canonicalFiles: AutomationObservedFile[] = [
    ...tracked.files.map((entry) => ({ ...entry, manifest: "tracked" as const })),
    ...untracked.files.map((entry) => ({ ...entry, manifest: "untracked" as const }))
  ].sort((left, right) => left.path.localeCompare(right.path) || left.manifest.localeCompare(right.manifest));
  if (tracked.reasons.length || untracked.reasons.length || tracked.digest !== value.snapshot.trackedManifest
    || untracked.digest !== value.snapshot.untrackedManifest || stableJson(canonicalFiles) !== stableJson(files)) {
    throw new Error("The host target observation file inventory is non-canonical or contradicts its TargetSnapshot manifests.");
  }
  const expected = sha256(stableJson({
    schema: value.schema,
    version: 1,
    targetIdentity: targetSnapshotIdentity(value.snapshot),
    files
  }));
  if (expected !== value.digest) throw new Error("The host target observation digest changed.");
  return Object.freeze({ ...jsonClone(value), files: Object.freeze(files) });
}

function proveObservedTransition(
  beforeValue: AutomationHostTargetObservation,
  afterValue: AutomationHostTargetObservation,
  phase: AutomationTargetTransitionPhase,
  expectation: "changed" | "unchanged",
  envelope: AutomationEnvelope
): void {
  const before = parseObservation(beforeValue);
  const after = parseObservation(afterValue);
  if (expectation === "unchanged") {
    if (before.snapshot.id !== after.snapshot.id || before.digest !== after.digest) throw new Error("A non-mutating automation child changed the exact host target.");
    return;
  }
  if (before.snapshot.id === after.snapshot.id) throw new Error("The reviewed mutating automation boundary produced no host-observed target change.");
  if (phase.kind === "filesystem") {
    const mutation = mutationForPhase(envelope, phase.path);
    proveFilesystemDelta(before, after, mutation, phase.direction);
    return;
  }
  if (phase.kind === "child" && phase.childKind === "git_commit") {
    proveGitCommitDelta(before, after);
    return;
  }
  throw new Error("Only an exact filesystem boundary or reviewed Git commit may change the automation target.");
}

function proveFilesystemDelta(before: AutomationHostTargetObservation, after: AutomationHostTargetObservation, mutation: AutomationPathMutation, direction: "apply" | "rollback"): void {
  const beforeFiles = fileMap(before.files);
  const afterFiles = fileMap(after.files);
  const paths = new Set([...beforeFiles.keys(), ...afterFiles.keys()]);
  for (const path of paths) {
    if (path === mutation.path) continue;
    if (stableJson(beforeFiles.get(path) ?? null) !== stableJson(afterFiles.get(path) ?? null)) {
      throw new Error(`Unrelated target churn changed ${path} during the reviewed filesystem transition.`);
    }
  }
  const wantedBefore = direction === "apply" ? mutation.beforeDigest! : mutation.afterDigest!;
  const wantedAfter = direction === "apply" ? mutation.afterDigest! : mutation.beforeDigest!;
  if (observedContentDigest(beforeFiles.get(mutation.path)) !== wantedBefore
    || observedContentDigest(afterFiles.get(mutation.path)) !== wantedAfter) {
    throw new Error(`The host-observed ${direction} bytes for ${mutation.path} do not match the reviewed before/after digest.`);
  }
  assertSnapshotPreserved(before.snapshot, after.snapshot, new Set(["trackedManifest", "untrackedManifest"]));
}

function proveGitCommitDelta(before: AutomationHostTargetObservation, after: AutomationHostTargetObservation): void {
  if (!before.snapshot.head || !after.snapshot.head || before.snapshot.head === after.snapshot.head) {
    throw new Error("The reviewed Git commit did not produce one exact changed commit identity.");
  }
  if (before.digest === after.digest) throw new Error("The Git commit observation failed to bind its changed TargetSnapshot identity.");
  assertSnapshotPreserved(before.snapshot, after.snapshot, new Set(["head", "indexTree"]));
  if (stableJson(before.files) !== stableJson(after.files)) throw new Error("The Git commit changed the reviewed worktree manifests.");
}

function assertSnapshotPreserved(before: TargetSnapshot, after: TargetSnapshot, allowed: ReadonlySet<string>): void {
  const left = targetSnapshotIdentity(before) as Record<string, unknown>;
  const right = targetSnapshotIdentity(after) as Record<string, unknown>;
  for (const key of Object.keys(left)) {
    if (allowed.has(key)) continue;
    if (stableJson(left[key]) !== stableJson(right[key])) throw new Error(`Unrelated target churn changed ${key} during the reviewed transition.`);
  }
}

interface AuthenticatedEffectEvidence {
  readonly boundaryDigest: string;
  readonly childEvidenceDigest: string | null;
}

function effectEvidenceFromJournal(
  journal: AutomationEffectJournalState,
  phase: AutomationTargetTransitionPhase,
  sourceTargetSnapshotId: string,
  envelope: AutomationEnvelope
): AuthenticatedEffectEvidence {
  if (phase.kind === "filesystem") {
    const mutation = mutationForPhase(envelope, phase.path);
    if (phase.direction === "apply") {
      const delta = journal.deltas.find((entry) => entry.path === phase.path);
      if (!delta || delta.beforeDigest !== mutation.beforeDigest || delta.afterDigest !== mutation.afterDigest) throw new Error("The authenticated filesystem delta changed from review.");
      return Object.freeze({ boundaryDigest: effectBoundaryDigest({ delta }), childEvidenceDigest: null });
    }
    const recovery = journal.applied.find((entry) => entry.path === phase.path);
    if (!recovery || !journal.rolledBackPaths.includes(phase.path)) throw new Error("The authenticated rollback evidence is absent.");
    const rollbackDelta = recovery.mutation === "create"
      ? { path: recovery.path, mutation: "delete" as const, beforeDigest: recovery.afterDigest, afterDigest: null, byteLength: 0, status: "applied" as const }
      : recovery.mutation === "delete"
        ? { path: recovery.path, mutation: "create" as const, beforeDigest: null, afterDigest: recovery.beforeDigest, byteLength: recovery.beforeByteLength, status: "applied" as const }
        : { path: recovery.path, mutation: recovery.mutation, beforeDigest: recovery.afterDigest, afterDigest: recovery.beforeDigest, byteLength: recovery.beforeByteLength, status: "applied" as const };
    return Object.freeze({ boundaryDigest: effectBoundaryDigest({ rollbackDelta }), childEvidenceDigest: null });
  }
  const child = reviewedChild(envelope, phase.order, phase.childKind);
  const receipt = journal.children.find((entry) => entry.order === child.order && entry.kind === child.kind);
  if (!receipt || receipt.scopeDigest !== child.scopeDigest || !digestPattern.test(receipt.evidenceDigest)) throw new Error("The authenticated child effect evidence is absent or changed.");
  if (phase.direction === "execute") {
    if (receipt.effectDisposition === "ambiguous") throw new Error("An ambiguous child effect cannot advance the accepted target.");
    return Object.freeze({ boundaryDigest: effectBoundaryDigest({ child, result: {
      sourceTargetSnapshotId,
      scopeDigest: receipt.scopeDigest,
      evidenceDigest: receipt.evidenceDigest,
      effectDisposition: receipt.effectDisposition,
      compensationToken: receipt.compensationToken
    } }), childEvidenceDigest: receipt.evidenceDigest });
  }
  if (receipt.effectDisposition !== "compensated" || !receipt.compensatedEvidenceDigest) throw new Error("The authenticated child compensation evidence is absent.");
  return Object.freeze({ boundaryDigest: effectBoundaryDigest({ child, compensation: {
    compensated: true,
    sourceTargetSnapshotId,
    evidenceDigest: receipt.compensatedEvidenceDigest
  } }), childEvidenceDigest: receipt.compensatedEvidenceDigest });
}

function isRefreshGitExecutePhase(envelope: AutomationEnvelope, phase: AutomationTargetTransitionPhase): boolean {
  return envelope.action === "compound_refresh" && envelope.manifest.proposal.kind === "compound_refresh"
    && envelope.manifest.proposal.commit.planned && phase.kind === "child" && phase.direction === "execute"
    && phase.childKind === "git_commit";
}

function effectBoundaryDigest(value: Readonly<Record<string, unknown>>): string {
  return sha256(stableJson({ schema: "sxsy-b122.automation-effect-boundary", version: 1, ...value }));
}

function reviewedChild(envelope: AutomationEnvelope, order: number, kind: AutomationEffectChild["kind"]): AutomationEffectChild {
  const proposal = envelope.manifest.proposal;
  let plan: readonly AutomationEffectChild[];
  if (proposal.kind === "compound_refresh" && proposal.commit.planned) {
    plan = [
      { order: 0, kind: "filesystem_mutation", scopeDigest: sha256(stableJson({ schema: "sxsy-b122.automation-mutation-scope", version: 1, mutations: proposal.mutations })) },
      { order: 1, kind: "git_commit", scopeDigest: proposal.commit.messageDigest }
    ];
  } else plan = proposal.kind === "lfg" || proposal.kind === "repair_mission" ? proposal.effectPlan ?? [] : [];
  const child = plan.find((entry) => entry.order === order && entry.kind === kind);
  if (!child || child.kind === "filesystem_mutation") throw new Error("The target transition names an unreviewed automation child.");
  return child;
}

function mutationForPhase(envelope: AutomationEnvelope, path: string): AutomationPathMutation {
  const proposal = envelope.manifest.proposal;
  const mutations: readonly AutomationPathMutation[] = proposal.kind === "compound_capture"
    ? [
        ...proposal.documents,
        ...(proposal.instructionFileMutation.kind === "edit_existing" ? [{
          path: proposal.instructionFileMutation.path,
          mutation: "update" as const,
          beforeDigest: proposal.instructionFileMutation.beforeDigest,
          afterDigest: proposal.instructionFileMutation.afterDigest,
          content: proposal.instructionFileMutation.content
        }] : [])
      ]
    : proposal.mutations ?? [];
  const matches = mutations.filter((entry) => entry.path === path);
  if (matches.length !== 1 || matches[0]!.beforeDigest === undefined || matches[0]!.afterDigest === undefined) {
    throw new Error("The target transition names an absent or repeated reviewed filesystem mutation.");
  }
  return matches[0]!;
}

function assertBoundaryScope(envelope: AutomationEnvelope, input: Parameters<AutomationEffectGuardPort["assertCurrent"]>[0]): void {
  if ((input.boundary === "before_path" || input.boundary === "before_rollback")) {
    if (!input.path) throw new Error("The automation filesystem boundary lacks one exact reviewed path.");
    mutationForPhase(envelope, input.path);
  }
  if ((input.boundary === "before_child" || input.boundary === "before_child_compensation")) {
    if (!input.child || input.child.kind === "filesystem_mutation") throw new Error("The automation child boundary lacks one exact typed child.");
    const child = reviewedChild(envelope, input.child.order, input.child.kind);
    if (stableJson(child) !== stableJson(input.child)) throw new Error("The automation child boundary changed its reviewed scope.");
  }
}

function assertRequestBinding(request: AutomationRequest, envelope: AutomationEnvelope): void {
  if (request.action !== envelope.action || request.operationId !== envelope.operationId || request.target.id !== envelope.manifest.targetSnapshotId
    || !sameRoot(request.target.repositoryRoot, envelope.manifest.repositoryRoot)
    || request.session?.id !== envelope.manifest.sessionId || request.authority?.id !== envelope.manifest.authorityId
    || request.session?.taskId !== envelope.manifest.taskId || request.session?.planRevision !== envelope.manifest.planRevision
    || request.session?.provider !== envelope.manifest.provider || request.target.completeness !== "complete"
    || targetSnapshotDigest(request.target) !== request.target.id) {
    throw new Error("The installed automation request changed its exact reviewed operation, target, session, authority, task, plan, or provider binding.");
  }
}

function assertTransitionRequest(
  input: Parameters<AutomationTargetTransitionPort["captureAndAccept"]>[0],
  envelope: AutomationEnvelope,
  expectedEnvelope: AutomationEnvelope
): void {
  if (!digestPattern.test(input.transitionId) || stableJson(envelope) !== stableJson(expectedEnvelope)
    || input.operationId !== envelope.operationId || input.action !== envelope.action
    || input.manifestId !== envelope.manifest.id || input.previousTargetSnapshotId !== input.envelope.intent.binding.targetSnapshotId && !digestPattern.test(input.previousTargetSnapshotId)
    || !sameRoot(input.repositoryRoot, envelope.manifest.repositoryRoot)
    || !digestPattern.test(input.expectedEffectEvidenceDigest)
    || (input.expectation !== "changed" && input.expectation !== "unchanged")) {
    throw new Error("The automation target transition changed its exact operation, artifact, source, root, phase, or effect binding.");
  }
}

function requestBindingDigest(request: AutomationRequest, envelope: AutomationEnvelope): string {
  return sha256(stableJson({
    schema: "sxsy-b122.automation-installed-request-binding",
    version: 1,
    envelope,
    operationId: request.operationId,
    action: request.action,
    target: request.target,
    session: request.session,
    authority: request.authority,
    permit: request.permit,
    executionControl: request.executionControl ? {
      operationId: request.executionControl.operationId,
      budgetClaimId: request.executionControl.budgetClaimId ?? null,
      deadline: request.executionControl.deadline
    } : null
  }));
}

function transitionOutput(transition: AcceptedRuntimeTransition): Awaited<ReturnType<AutomationTargetTransitionPort["captureAndAccept"]>> {
  return Object.freeze({
    accepted: true,
    transitionId: transition.transitionId,
    fromTargetSnapshotId: transition.fromTargetSnapshotId,
    toTargetSnapshotId: transition.toTargetSnapshotId,
    observedEffectEvidenceDigest: transition.effectEvidenceDigest,
    hostObservationDigest: transition.hostObservationDigest
  });
}

function fileMap(files: readonly AutomationObservedFile[]): ReadonlyMap<string, AutomationObservedFile> {
  const result = new Map<string, AutomationObservedFile>();
  for (const file of files) {
    if (result.has(file.path)) throw new Error("The target observation repeats one repository path.");
    result.set(file.path, file);
  }
  return result;
}

function observedContentDigest(file: AutomationObservedFile | undefined): string | null {
  if (!file || file.state === "tracked_missing") return null;
  const match = file.digest.match(/^sha256:([a-f0-9]{64})$/u);
  if (!match) throw new Error(`The observed file ${file.path} lacks one exact SHA-256 content digest.`);
  return match[1]!;
}

function sameTargetIdentity(left: TargetSnapshot, right: TargetSnapshot): boolean {
  return left.id === right.id && targetSnapshotDigest(left) === left.id && targetSnapshotDigest(right) === right.id
    && stableJson(targetSnapshotIdentity(left)) === stableJson(targetSnapshotIdentity(right));
}

function sessionMatchesLostTransitionResponse(
  actual: ManagedSession,
  source: ManagedSession,
  transitionId: string,
  action: AutomationEnvelope["action"]
): boolean {
  const newTarget = actual.targetSnapshotId;
  if (!newTarget || !digestPattern.test(newTarget) || newTarget === source.targetSnapshotId) return false;
  const expected: ManagedSession = {
    ...source,
    targetSnapshotId: newTarget,
    metadata: {
      ...source.metadata,
      "sxsy-b122.effectTransition.action": action,
      "sxsy-b122.effectTransition.operationId": transitionId,
      "sxsy-b122.effectTransition.oldTargetSnapshotId": source.targetSnapshotId!,
      "sxsy-b122.effectTransition.newTargetSnapshotId": newTarget
    }
  };
  return stableJson(actual) === stableJson(expected);
}

function sameRoot(left: string, right: string): boolean {
  const normalized = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
  return normalized(left) === normalized(right);
}

function withoutStateDigest(state: InstalledRuntimeState): Omit<InstalledRuntimeState, "stateDigest"> {
  const { stateDigest: _stateDigest, ...material } = state;
  return material;
}

function withStateDigest(material: Omit<InstalledRuntimeState, "stateDigest">): InstalledRuntimeState {
  return Object.freeze({ ...jsonClone(material), stateDigest: sha256(stableJson(material)) });
}

function parseState(value: Record<string, unknown>): InstalledRuntimeState {
  if (value.schema !== "sxsy-b122.automation-installed-runtime-state" || value.version !== 1
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || typeof value.operationId !== "string" || typeof value.action !== "string"
    || !digestPattern.test(String(value.requestDigest)) || !digestPattern.test(String(value.sourceSessionBindingDigest))
    || !digestPattern.test(String(value.stateDigest)) || !Array.isArray(value.transitions)) {
    throw new Error("The authenticated automation installed-runtime state is malformed.");
  }
  const state = jsonClone(value) as unknown as InstalledRuntimeState;
  const expected = sha256(stableJson(withoutStateDigest(state)));
  if (expected !== state.stateDigest) throw new Error("The authenticated automation installed-runtime state digest changed.");
  parseObservation(state.sourceObservation);
  parseObservation(state.currentObservation);
  if (!sameTargetIdentity(state.sourceTarget, state.sourceObservation.snapshot)
    || !sameTargetIdentity(state.currentTarget, state.currentObservation.snapshot)) {
    throw new Error("The authenticated automation runtime target and inventory diverged.");
  }
  return Object.freeze(state);
}

function latestState(entries: readonly { readonly kind: string; readonly payload: JsonValue }[], operationId: string): InstalledRuntimeState | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === stateEntryKind && record(entry.payload) && entry.payload.operationId === operationId) return parseState(entry.payload);
  }
  return undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
