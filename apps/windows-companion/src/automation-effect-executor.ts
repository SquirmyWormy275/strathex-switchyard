import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import {
  canonicalAutomationRepositoryPath,
  parseAutomationManifestApproval,
  parseAutomationOperationManifest,
  automationMutationScopeDigest,
  type AutomationEffectChild,
  type AutomationEffectChildKind,
  type AutomationExactContent,
  type AutomationManifestApproval,
  type AutomationManifestContext,
  type AutomationOperationManifest,
  type AutomationPathMutation
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import {
  createAutomationAcceptedTargetTransitionEvidence,
  createAutomationActualDeltaEvidence,
  parseAutomationEnvelope,
  type AutomationAcceptedTargetTransitionEvidence,
  type AutomationActualDeltaEvidence,
  type AutomationActualMutationDelta,
  type AutomationEnvelope
} from "../../../packages/control-plane/src/automation-protocol.ts";
import { assertAutomationManifestCurrent } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { AutomationRequest, BrokerConfirmation, TestEnvironment } from "../../../packages/control-plane/src/brokers.ts";
import type { PolicyPermit } from "../../../packages/control-plane/src/policy.ts";
import { type JsonValue, ProtectedJsonStore, sha256, stableJson } from "../../../packages/control-plane/src/store.ts";

type ExecutableMutation = Readonly<{
  path: string;
  mutation: AutomationPathMutation["mutation"];
  beforeDigest: string | null;
  afterDigest: string | null;
  content: AutomationExactContent | null;
}>;

export interface AutomationInstructionFileConsent {
  readonly path: string;
  readonly approvalId: string;
  readonly confirmationDigest: string;
}

export interface AutomationEffectRecoveryBinding {
  readonly schema: "sxsy-b122.automation-effect-recovery-binding";
  readonly version: 1;
  readonly envelope: AutomationEnvelope;
  readonly request: Readonly<{
    action: AutomationEnvelope["action"];
    operationId: string;
    target: TargetSnapshot;
    session: ManagedSession;
    authority: AuthorityGrant;
    permit: PolicyPermit;
    confirmation: BrokerConfirmation;
    executionControl: Readonly<{ operationId: string; budgetClaimId: string | null; deadline: string }>;
    testEnvironment: TestEnvironment | null;
    reviewedManifest: AutomationOperationManifest;
    manifestApproval: AutomationManifestApproval;
  }>;
  readonly instructionFileConsent: AutomationInstructionFileConsent | null;
  readonly digest: string;
}

/** Captures only serializable, protected admission material; no callback or provider capability is persisted. */
export function createAutomationEffectRecoveryBinding(request: AutomationRequest, value: AutomationEnvelope): AutomationEffectRecoveryBinding {
  const envelope = parseAutomationEnvelope(value);
  if (!request.session || !request.authority || !request.permit || !request.confirmation || !request.executionControl
    || !request.reviewedManifest || !request.manifestApproval || !request.effectGuard) {
    throw new Error("Automation recovery requires one exact admitted request binding before the first effect.");
  }
  if (request.action !== envelope.action || request.operationId !== envelope.operationId
    || stableJson(request.reviewedManifest) !== stableJson(envelope.manifest)
    || stableJson(request.manifestApproval) !== stableJson(envelope.approval)) {
    throw new Error("The automation recovery request changed its reviewed envelope binding.");
  }
  const instructionFileConsent = instructionConsentForEnvelope(envelope);
  const content = {
    schema: "sxsy-b122.automation-effect-recovery-binding" as const,
    version: 1 as const,
    envelope,
    request: {
      action: request.action,
      operationId: request.operationId,
      target: request.target,
      session: request.session,
      authority: request.authority,
      permit: request.permit,
      confirmation: request.confirmation,
      executionControl: {
        operationId: request.executionControl.operationId,
        budgetClaimId: request.executionControl.budgetClaimId ?? null,
        deadline: request.executionControl.deadline
      },
      testEnvironment: request.testEnvironment ?? null,
      reviewedManifest: request.reviewedManifest,
      manifestApproval: request.manifestApproval
    },
    instructionFileConsent
  };
  return parseAutomationEffectRecoveryBinding({ ...content, digest: sha256(stableJson(content)) });
}

export interface AutomationEffectGuardPort {
  assertCurrent(input: Readonly<{
    envelope: AutomationEnvelope;
    boundary: "before_operation" | "before_path" | "before_child" | "before_rollback" | "before_child_compensation";
    /** The latest host-observed and durably accepted in-flight target. */
    expectedTargetSnapshotId: string;
    path?: string;
    child?: AutomationEffectChild;
  }>): Promise<void>;
}

export type AutomationTargetTransitionPhase =
  | Readonly<{ kind: "filesystem"; direction: "apply" | "rollback"; path: string }>
  | Readonly<{ kind: "child"; direction: "execute" | "compensate"; order: number; childKind: NonFilesystemChildKind }>;

export interface AutomationInFlightTargetTransition {
  readonly transitionId: string;
  readonly phase: AutomationTargetTransitionPhase;
  readonly expectation: "changed" | "unchanged";
  readonly fromTargetSnapshotId: string;
  readonly toTargetSnapshotId: string | null;
  readonly expectedEffectEvidenceDigest: string;
  readonly hostObservationDigest: string | null;
  readonly status: "pending" | "accepted";
}

export interface AutomationTargetTransitionPort {
  /**
   * This port must host-observe the exact effect described by `phase`, reject
   * unrelated target churn, and atomically/idempotently accept the resulting
   * target for `transitionId`.  Echo fields are checked by the executor.
   */
  captureAndAccept(input: Readonly<{
    transitionId: string;
    operationId: string;
    action: AutomationEnvelope["action"];
    envelope: AutomationEnvelope;
    repositoryRoot: string;
    previousTargetSnapshotId: string;
    manifestId: string;
    phase: AutomationTargetTransitionPhase;
    expectation: "changed" | "unchanged";
    expectedEffectEvidenceDigest: string;
  }>): Promise<Readonly<{
    accepted: true;
    transitionId: string;
    fromTargetSnapshotId: string;
    toTargetSnapshotId: string;
    observedEffectEvidenceDigest: string;
    hostObservationDigest: string;
  }>>;
}

export interface AutomationHighConsequenceAuthorizationPort {
  authorize(input: Readonly<{
    action: "lfg" | "repair_mission";
    manifestId: string;
    approvalId: string;
    targetSnapshotId: string;
  }>): Promise<Readonly<{ authorized: true; acceptanceEvidenceDigest: string }>>;
}

type NonFilesystemChildKind = Exclude<AutomationEffectChildKind, "filesystem_mutation">;
export interface AutomationChildEffectResult {
  /** Exact in-flight target against which the child performed its own guard. */
  readonly sourceTargetSnapshotId: string;
  readonly scopeDigest: string;
  readonly evidenceDigest: string;
  readonly effectDisposition: "committed" | "not_started" | "compensated";
  readonly compensationToken: string | null;
}
export interface AutomationChildEffectPort<K extends NonFilesystemChildKind = NonFilesystemChildKind> {
  execute(input: Readonly<{
    child: Readonly<AutomationEffectChild & { kind: K }>;
    envelope: AutomationEnvelope;
    currentTargetSnapshotId: string;
    repairEnvironment: Readonly<{ id: string; digest: string; egress: "deny"; databaseName: string }> | null;
  }>): Promise<AutomationChildEffectResult>;
  /** Observation-only settlement for a durably ambiguous prior call; it must never replay the child effect. */
  recover?(input: Readonly<{
    child: Readonly<AutomationEffectChild & { kind: K }>;
    envelope: AutomationEnvelope;
    currentTargetSnapshotId: string;
    repairEnvironment: Readonly<{ id: string; digest: string; egress: "deny"; databaseName: string }> | null;
  }>): Promise<AutomationChildEffectResult | undefined>;
  compensate?(input: Readonly<{
    child: Readonly<AutomationEffectChild & { kind: K }>;
    envelope: AutomationEnvelope;
    currentTargetSnapshotId: string;
    compensationToken: string;
  }>): Promise<Readonly<{ compensated: true; sourceTargetSnapshotId: string; evidenceDigest: string }>>;
}
export type AutomationChildEffectPorts = Readonly<{ [K in NonFilesystemChildKind]?: AutomationChildEffectPort<K> }>;

export interface AutomationFilesystemRecovery {
  readonly path: string;
  readonly mutation: AutomationPathMutation["mutation"];
  readonly beforeDigest: string | null;
  readonly afterDigest: string | null;
  readonly beforeContentBase64: string | null;
  readonly beforeByteLength: number;
  readonly beforeMode: number | null;
  /** Deterministic same-directory staging path, journaled before it is created. */
  readonly stagingPath: string | null;
}

export interface AutomationFilesystemApplyResult {
  readonly delta: AutomationActualMutationDelta;
  readonly recovery: AutomationFilesystemRecovery;
}

export interface AutomationFilesystemPort {
  canonicalizeRoot(repositoryRoot: string): Promise<string>;
  apply(input: Readonly<{
    canonicalRoot: string;
    operationId: string;
    mutation: ExecutableMutation;
    /** Authenticated recovery already persisted by an interrupted attempt. */
    existingRecovery?: AutomationFilesystemRecovery;
    recordRecovery(recovery: AutomationFilesystemRecovery): Promise<void>;
  }>): Promise<AutomationFilesystemApplyResult>;
  rollback(input: Readonly<{ canonicalRoot: string; operationId: string; recovery: AutomationFilesystemRecovery }>): Promise<AutomationActualMutationDelta>;
}

export interface AutomationChildReceipt {
  readonly order: number;
  readonly kind: NonFilesystemChildKind;
  readonly scopeDigest: string;
  readonly evidenceDigest: string;
  readonly effectDisposition: AutomationChildEffectResult["effectDisposition"] | "ambiguous";
  readonly compensationToken: string | null;
  readonly compensatedEvidenceDigest: string | null;
}

export interface AutomationEffectReceipt {
  readonly schema: "sxsy-b122.automation-effect-receipt";
  readonly version: 1;
  readonly operationId: string;
  readonly action: AutomationEnvelope["action"];
  readonly manifestId: string;
  readonly manifestDigest: string;
  readonly proposalDigest: string;
  readonly status: "committed" | "compensated" | "recovery_required";
  readonly actualDelta: AutomationActualDeltaEvidence | null;
  readonly targetTransition: AutomationAcceptedTargetTransitionEvidence | null;
  readonly targetTransitionChain: readonly AutomationInFlightTargetTransition[];
  readonly children: readonly AutomationChildReceipt[];
  readonly rolledBackPaths: readonly string[];
  readonly errors: readonly string[];
  readonly digest: string;
}

export interface AutomationEffectJournalState {
  readonly schema: "sxsy-b122.automation-effect-journal-state";
  readonly version: 1;
  readonly revision: number;
  readonly operationId: string;
  readonly requestDigest: string;
  readonly action: AutomationEnvelope["action"];
  readonly status: "applying" | "transitioning" | "compensating" | "committed" | "compensated" | "recovery_required";
  readonly canonicalRoot: string;
  readonly currentTargetSnapshotId: string;
  readonly targetTransitionChain: readonly AutomationInFlightTargetTransition[];
  readonly applied: readonly AutomationFilesystemRecovery[];
  readonly deltas: readonly AutomationActualMutationDelta[];
  readonly children: readonly AutomationChildReceipt[];
  readonly rolledBackPaths: readonly string[];
  readonly actualDelta: AutomationActualDeltaEvidence | null;
  readonly targetTransition: AutomationAcceptedTargetTransitionEvidence | null;
  readonly receipt: AutomationEffectReceipt | null;
  readonly errors: readonly string[];
  /** Present for installed operations; legacy/test states without it remain manual-recovery only. */
  readonly recoveryBinding?: AutomationEffectRecoveryBinding;
  readonly updatedAt: string;
}

export interface AutomationEffectJournal {
  load(operationId: string): Promise<AutomationEffectJournalState | undefined>;
  save(state: AutomationEffectJournalState): Promise<void>;
  listRecoverable?(): Promise<readonly AutomationEffectJournalState[]>;
}

export class ProtectedStoreAutomationEffectJournal implements AutomationEffectJournal {
  static readonly entryKind = "b122.automation-effect-state";

  constructor(private readonly store: ProtectedJsonStore) {
    if (!store.hasAuthenticatedProtection) throw new Error("Automation effects require an authenticated protected journal.");
  }

  async load(operationId: string): Promise<AutomationEffectJournalState | undefined> {
    const entries = await this.store.readEntries<JsonValue>();
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]!;
      if (entry.kind !== ProtectedStoreAutomationEffectJournal.entryKind || !record(entry.payload)
        || entry.payload.operationId !== operationId) continue;
      return parseJournalState(entry.payload);
    }
    return undefined;
  }

  async save(state: AutomationEffectJournalState): Promise<void> {
    const exact = parseJournalState(state);
    await this.store.transaction(async (transaction) => {
      const entries = await transaction.readEntries<JsonValue>();
      let prior: AutomationEffectJournalState | undefined;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]!;
        if (entry.kind === ProtectedStoreAutomationEffectJournal.entryKind && record(entry.payload)
          && entry.payload.operationId === exact.operationId) {
          prior = parseJournalState(entry.payload);
          break;
        }
      }
      if ((!prior && exact.revision !== 1) || (prior && (exact.requestDigest !== prior.requestDigest || exact.revision !== prior.revision + 1))) {
        throw new Error("The automation effect journal revision or idempotency binding changed.");
      }
      await transaction.append(ProtectedStoreAutomationEffectJournal.entryKind, exact as unknown as JsonValue);
    });
  }

  async listRecoverable(): Promise<readonly AutomationEffectJournalState[]> {
    const entries = await this.store.readEntries<JsonValue>();
    const latest = new Map<string, AutomationEffectJournalState>();
    for (const entry of entries) {
      if (entry.kind !== ProtectedStoreAutomationEffectJournal.entryKind || !record(entry.payload)) continue;
      const state = parseJournalState(entry.payload);
      latest.set(state.operationId, state);
    }
    return [...latest.values()]
      .filter((state) => !!state.recoveryBinding)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.operationId.localeCompare(right.operationId));
  }
}

export interface LocalAutomationEffectExecutorOptions {
  readonly filesystem?: AutomationFilesystemPort;
  readonly journal: AutomationEffectJournal;
  readonly guard: AutomationEffectGuardPort;
  readonly targetTransition: AutomationTargetTransitionPort;
  readonly childPorts?: AutomationChildEffectPorts;
  readonly highConsequenceAuthorization?: AutomationHighConsequenceAuthorizationPort;
  readonly recoveryBinding?: AutomationEffectRecoveryBinding;
  readonly clock?: () => string;
}

export class AutomationEffectExecutionError extends Error {
  constructor(message: string, readonly receipt: AutomationEffectReceipt | null = null) {
    super(message);
    this.name = "AutomationEffectExecutionError";
  }
}

/**
 * Executes only exact bytes already present in the reviewed manifest. Provider
 * output is never interpreted as a patch, command, credential, or environment.
 */
export class LocalAutomationEffectExecutor {
  private readonly filesystem: AutomationFilesystemPort;
  private readonly clock: () => string;

  constructor(private readonly options: LocalAutomationEffectExecutorOptions) {
    this.filesystem = options.filesystem ?? new NodeAutomationFilesystemPort();
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async execute(input: Readonly<{
    envelope: AutomationEnvelope;
    currentManifestContext: AutomationManifestContext;
    instructionFileConsent?: AutomationInstructionFileConsent;
  }>): Promise<AutomationEffectReceipt> {
    const envelope = parseAutomationEnvelope(input.envelope);
    const manifest = parseAutomationOperationManifest(envelope.manifest);
    const requestDigest = sha256(stableJson({
      schema: "sxsy-b122.automation-effect-request-binding",
      version: 1,
      operationId: envelope.operationId,
      manifestId: manifest.id,
      manifestDigest: manifest.digest,
      approvalId: envelope.approval.id,
      confirmationDigest: envelope.approval.confirmationDigest
    }));
    const mutations = exactMutations(envelope, input.instructionFileConsent);
    const plan = effectPlan(envelope);
    this.preflightChildPorts(plan);
    const recoveryBinding = this.options.recoveryBinding ? parseAutomationEffectRecoveryBinding(this.options.recoveryBinding) : undefined;
    if (recoveryBinding && (stableJson(recoveryBinding.envelope) !== stableJson(envelope)
      || stableJson(recoveryBinding.instructionFileConsent) !== stableJson(input.instructionFileConsent ?? null))) {
      throw new AutomationEffectExecutionError("The installed automation recovery binding changed before execution.");
    }
    const prior = await this.options.journal.load(envelope.operationId);
    let state: AutomationEffectJournalState;
    if (prior) {
      if (prior.requestDigest !== requestDigest || prior.action !== envelope.action) {
        throw new AutomationEffectExecutionError("The automation operation id was reused for a different reviewed request.");
      }
      if (prior.recoveryBinding && (!recoveryBinding || stableJson(prior.recoveryBinding) !== stableJson(recoveryBinding))) {
        throw new AutomationEffectExecutionError("The authenticated automation recovery binding is absent or changed.");
      }
      if (prior.status === "committed" && prior.receipt) return prior.receipt;
      if ((prior.status === "compensated" || prior.status === "recovery_required") && !pendingTransition(prior)) {
        throw new AutomationEffectExecutionError(`The automation operation is already ${prior.status}.`, prior.receipt);
      }
      state = prior;
      if (state.status === "compensating") {
        const recovery = await this.compensate(state, envelope, [...state.errors]);
        return recovery.receipt;
      }
      if (pendingTransition(state)) {
        state = await this.resumePendingTransition(state, envelope);
        state = await this.persist(state, { status: "applying", receipt: null, errors: [] });
      }
    } else {
      assertAutomationManifestCurrent(manifest, input.currentManifestContext, this.clock());
      await this.options.guard.assertCurrent({
        envelope,
        boundary: "before_operation",
        expectedTargetSnapshotId: manifest.targetSnapshotId
      });
      await this.authorizeHighConsequence(envelope);
      const canonicalRoot = await this.filesystem.canonicalizeRoot(manifest.repositoryRoot);
      state = {
        schema: "sxsy-b122.automation-effect-journal-state",
        version: 1,
        revision: 1,
        operationId: envelope.operationId,
        requestDigest,
        action: envelope.action,
        status: "applying",
        canonicalRoot,
        currentTargetSnapshotId: manifest.targetSnapshotId,
        targetTransitionChain: [],
        applied: [],
        deltas: [],
        children: [],
        rolledBackPaths: [],
        actualDelta: null,
        targetTransition: null,
        receipt: null,
        errors: [],
        ...(recoveryBinding ? { recoveryBinding } : {}),
        updatedAt: this.clock()
      };
      await this.options.journal.save(state);
    }
    try {
      if (plan.length === 0) state = await this.applyMutations(state, mutations, envelope);
      else {
        for (const child of plan) {
          if (child.kind === "filesystem_mutation") state = await this.applyMutations(state, mutations, envelope);
          else state = await this.executeChild(state, child as AutomationEffectChild & { kind: NonFilesystemChildKind }, envelope);
        }
      }
      const actualDelta = createAutomationActualDeltaEvidence({
        operationId: envelope.operationId,
        manifestId: manifest.id,
        manifestDigest: manifest.digest,
        proposalDigest: envelope.intent.binding.proposalDigest,
        fromTargetSnapshotId: manifest.targetSnapshotId,
        mutations: state.deltas
      });
      if (state.currentTargetSnapshotId === manifest.targetSnapshotId) throw new Error("The mutating automation operation produced no accepted TargetSnapshot change.");
      const targetTransition = createAutomationAcceptedTargetTransitionEvidence({
        operationId: envelope.operationId,
        manifestId: manifest.id,
        fromTargetSnapshotId: manifest.targetSnapshotId,
        toTargetSnapshotId: state.currentTargetSnapshotId,
        actualDeltaDigest: actualDelta.digest,
        hostObservationDigest: targetChainObservationDigest(state.targetTransitionChain),
        accepted: true
      });
      const receipt = createReceipt(envelope, "committed", actualDelta, targetTransition, state.targetTransitionChain, state.children, state.rolledBackPaths, []);
      await this.persist(state, { status: "committed", actualDelta, targetTransition, receipt });
      return receipt;
    } catch (error) {
      const errors = [boundedError(error)];
      const durable = await this.options.journal.load(envelope.operationId);
      const recoveryState = durable && durable.requestDigest === requestDigest ? durable : state;
      if (pendingTransition(recoveryState)) {
        const actualDelta = recoveryState.deltas.length ? actualDeltaFor(envelope, recoveryState.deltas) : null;
        const receipt = createReceipt(envelope, "recovery_required", actualDelta, null, recoveryState.targetTransitionChain, recoveryState.children, recoveryState.rolledBackPaths, errors);
        await this.persist(recoveryState, { status: "recovery_required", actualDelta, receipt, errors });
        throw new AutomationEffectExecutionError(`Automation target transition is durably pending and must be idempotently resumed: ${errors[0]}`, receipt);
      }
      const compensating = recoveryState.status === "compensating"
        ? recoveryState
        : await this.persist(recoveryState, { status: "compensating", errors: [...errors] });
      const recovery = await this.compensate(compensating, envelope, [...errors]);
      throw new AutomationEffectExecutionError(`Automation effect execution failed: ${errors[0]}`, recovery.receipt);
    }
  }

  private async authorizeHighConsequence(envelope: AutomationEnvelope): Promise<void> {
    if (envelope.action !== "lfg" && envelope.action !== "repair_mission") return;
    if (!this.options.highConsequenceAuthorization) throw new Error(`${envelope.action} is gate-disabled without independent acceptance authorization.`);
    const result = await this.options.highConsequenceAuthorization.authorize({
      action: envelope.action,
      manifestId: envelope.manifest.id,
      approvalId: envelope.approval.id,
      targetSnapshotId: envelope.manifest.targetSnapshotId
    });
    if (result.authorized !== true || !digest(result.acceptanceEvidenceDigest)) throw new Error(`${envelope.action} lacks exact acceptance-gate evidence.`);
  }

  private preflightChildPorts(plan: readonly AutomationEffectChild[]): void {
    for (const child of plan) {
      if (child.kind !== "filesystem_mutation" && !this.options.childPorts?.[child.kind]) {
        throw new Error(`The typed ${child.kind} automation child port is unavailable.`);
      }
    }
  }

  private async applyMutations(state: AutomationEffectJournalState, mutations: readonly ExecutableMutation[], envelope: AutomationEnvelope): Promise<AutomationEffectJournalState> {
    let next = state;
    for (let index = 0; index < mutations.length; index += 1) {
      const mutation = mutations[index]!;
      const existing = next.deltas[index];
      if (existing) {
        assertDeltaMatches(existing, mutation);
        const transition = transitionForPhase(next, { kind: "filesystem", direction: "apply", path: mutation.path });
        if (!transition) {
          next = await this.advanceTarget(next, envelope, { kind: "filesystem", direction: "apply", path: mutation.path }, "changed", effectEvidenceDigest({ delta: existing }));
          continue;
        }
        if (transition.status === "pending") next = await this.acceptPendingTransition(next, transition, envelope);
        continue;
      }
      await this.options.guard.assertCurrent({
        envelope,
        boundary: "before_path",
        expectedTargetSnapshotId: next.currentTargetSnapshotId,
        path: mutation.path
      });
      await this.authorizeHighConsequence(envelope);
      const existingRecovery = next.applied.find((entry) => entry.path === mutation.path);
      let recoveryRecorded = existingRecovery !== undefined;
      const result = await this.filesystem.apply({
        canonicalRoot: next.canonicalRoot,
        operationId: envelope.operationId,
        mutation,
        ...(existingRecovery ? { existingRecovery } : {}),
        recordRecovery: async (recovery) => {
          if (recovery.path !== mutation.path || recovery.mutation !== mutation.mutation
            || recovery.beforeDigest !== mutation.beforeDigest || recovery.afterDigest !== mutation.afterDigest) {
            throw new Error(`The durable recovery record for ${mutation.path} changed or was repeated.`);
          }
          if (recoveryRecorded) {
            if (!existingRecovery || stableJson(existingRecovery) !== stableJson(recovery)) throw new Error(`The durable recovery record for ${mutation.path} changed.`);
            return;
          }
          next = await this.persist(next, { applied: [...next.applied, recovery] });
          recoveryRecorded = true;
        }
      });
      if (!recoveryRecorded) throw new Error(`The filesystem port did not durably record recovery before mutating ${mutation.path}.`);
      assertDeltaMatches(result.delta, mutation);
      next = await this.persist(next, { deltas: [...next.deltas, result.delta] });
      next = await this.advanceTarget(next, envelope, { kind: "filesystem", direction: "apply", path: mutation.path }, "changed", effectEvidenceDigest({ delta: result.delta }));
    }
    return next;
  }

  private async executeChild(
    state: AutomationEffectJournalState,
    child: AutomationEffectChild & { kind: NonFilesystemChildKind },
    envelope: AutomationEnvelope
  ): Promise<AutomationEffectJournalState> {
    const port = this.options.childPorts?.[child.kind] as AutomationChildEffectPort | undefined;
    const existing = state.children.find((entry) => entry.order === child.order && entry.kind === child.kind);
    if (existing) {
      if (existing.effectDisposition === "ambiguous") {
        if (!port?.recover) throw new Error(`The typed ${child.kind} automation child has an ambiguous durable execution and no exact observation recovery port.`);
        const proposal = envelope.manifest.proposal;
        const repairEnvironment = proposal.kind === "repair_mission" ? proposal.testEnvironment : null;
        await this.options.guard.assertCurrent({
          envelope,
          boundary: "before_child",
          expectedTargetSnapshotId: state.currentTargetSnapshotId,
          child
        });
        const recovered = await port.recover({ child, envelope, currentTargetSnapshotId: state.currentTargetSnapshotId, repairEnvironment });
        if (!recovered) throw new Error(`The typed ${child.kind} automation child remains ambiguous after exact observation.`);
        assertChildResult(recovered, state.currentTargetSnapshotId, child);
        const settled = await this.persist(state, {
          children: state.children.map((entry) => entry.order === child.order ? childReceipt(child, recovered) : entry)
        });
        if ((envelope.action === "lfg" || envelope.action === "repair_mission") && recovered.effectDisposition !== "committed") {
          throw new Error(`The required ${envelope.action} ${child.kind} child did not commit its exact reviewed effect.`);
        }
        if (requiredRefreshCommit(envelope, child) && recovered.effectDisposition !== "committed") {
          throw new Error("The exact reviewed Compound Refresh commit could not be proven by observation; the operation remains unresolved.");
        }
        const expectation = recovered.effectDisposition === "committed" && child.kind === "git_commit" ? "changed" : "unchanged";
        return this.advanceTarget(settled, envelope, { kind: "child", direction: "execute", order: child.order, childKind: child.kind }, expectation,
          effectEvidenceDigest({ child, result: recovered }));
      }
      if ((envelope.action === "lfg" || envelope.action === "repair_mission") && existing.effectDisposition !== "committed") {
        throw new Error(`The required ${envelope.action} ${child.kind} child did not commit its exact reviewed effect.`);
      }
      if (requiredRefreshCommit(envelope, child) && existing.effectDisposition !== "committed") {
        throw new Error("The exact reviewed Compound Refresh commit did not start; the filesystem changes must be compensated.");
      }
      const transition = transitionForPhase(state, { kind: "child", direction: "execute", order: child.order, childKind: child.kind });
      if (!transition) {
        const result: AutomationChildEffectResult = {
          sourceTargetSnapshotId: state.currentTargetSnapshotId,
          scopeDigest: existing.scopeDigest,
          evidenceDigest: existing.evidenceDigest,
          effectDisposition: existing.effectDisposition,
          compensationToken: existing.compensationToken
        };
        const expectation = result.effectDisposition === "committed" && child.kind === "git_commit" ? "changed" : "unchanged";
        return this.advanceTarget(state, envelope, { kind: "child", direction: "execute", order: child.order, childKind: child.kind }, expectation,
          effectEvidenceDigest({ child, result }));
      }
      return transition.status === "pending" ? this.acceptPendingTransition(state, transition, envelope) : state;
    }
    if (!port) throw new Error(`The typed ${child.kind} automation child port disappeared.`);
    const proposal = envelope.manifest.proposal;
    const repairEnvironment = proposal.kind === "repair_mission" ? proposal.testEnvironment : null;
    const pending: AutomationChildReceipt = {
      order: child.order,
      kind: child.kind,
      scopeDigest: child.scopeDigest,
      evidenceDigest: child.scopeDigest,
      effectDisposition: "ambiguous",
      compensationToken: null,
      compensatedEvidenceDigest: null
    };
    await this.options.guard.assertCurrent({
      envelope,
      boundary: "before_child",
      expectedTargetSnapshotId: state.currentTargetSnapshotId,
      child
    });
    await this.authorizeHighConsequence(envelope);
    const pendingState = await this.persist(state, { children: [...state.children, pending] });
    const result = await port.execute({ child, envelope, currentTargetSnapshotId: pendingState.currentTargetSnapshotId, repairEnvironment });
    assertChildResult(result, pendingState.currentTargetSnapshotId, child);
    const settled = await this.persist(pendingState, {
      children: pendingState.children.map((entry) => entry.order === child.order ? childReceipt(child, result) : entry)
    });
    if ((envelope.action === "lfg" || envelope.action === "repair_mission") && result.effectDisposition !== "committed") {
      throw new Error(`The required ${envelope.action} ${child.kind} child did not commit its exact reviewed effect.`);
    }
    if (requiredRefreshCommit(envelope, child) && result.effectDisposition !== "committed") {
      throw new Error("The exact reviewed Compound Refresh commit did not start; the filesystem changes must be compensated.");
    }
    const expectation = result.effectDisposition === "committed" && child.kind === "git_commit" ? "changed" : "unchanged";
    return this.advanceTarget(settled, envelope, { kind: "child", direction: "execute", order: child.order, childKind: child.kind }, expectation,
      effectEvidenceDigest({ child, result }));
  }

  private async advanceTarget(
    state: AutomationEffectJournalState,
    envelope: AutomationEnvelope,
    phase: AutomationTargetTransitionPhase,
    expectation: "changed" | "unchanged",
    expectedEffectEvidenceDigest: string
  ): Promise<AutomationEffectJournalState> {
    if (pendingTransition(state)) throw new Error("A prior in-flight target transition must settle before another effect boundary.");
    const transitionId = sha256(stableJson({
      schema: "sxsy-b122.automation-in-flight-transition-id",
      version: 1,
      operationId: envelope.operationId,
      manifestId: envelope.manifest.id,
      fromTargetSnapshotId: state.currentTargetSnapshotId,
      phase,
      expectation,
      expectedEffectEvidenceDigest
    }));
    const transition: AutomationInFlightTargetTransition = deepFreeze({
      transitionId,
      phase,
      expectation,
      fromTargetSnapshotId: state.currentTargetSnapshotId,
      toTargetSnapshotId: null,
      expectedEffectEvidenceDigest,
      hostObservationDigest: null,
      status: "pending"
    });
    const pending = await this.persist(state, { targetTransitionChain: [...state.targetTransitionChain, transition] });
    return this.acceptPendingTransition(pending, transition, envelope);
  }

  private async resumePendingTransition(state: AutomationEffectJournalState, envelope: AutomationEnvelope): Promise<AutomationEffectJournalState> {
    const pending = pendingTransition(state);
    if (!pending) return state;
    return this.acceptPendingTransition(state, pending, envelope);
  }

  private async acceptPendingTransition(
    state: AutomationEffectJournalState,
    transition: AutomationInFlightTargetTransition,
    envelope: AutomationEnvelope
  ): Promise<AutomationEffectJournalState> {
    if (transition.status !== "pending" || transition.fromTargetSnapshotId !== state.currentTargetSnapshotId) {
      throw new Error("The durable in-flight target transition source changed.");
    }
    const observed = await this.options.targetTransition.captureAndAccept({
      transitionId: transition.transitionId,
      operationId: envelope.operationId,
      action: envelope.action,
      envelope,
      repositoryRoot: state.canonicalRoot,
      previousTargetSnapshotId: transition.fromTargetSnapshotId,
      manifestId: envelope.manifest.id,
      phase: transition.phase,
      expectation: transition.expectation,
      expectedEffectEvidenceDigest: transition.expectedEffectEvidenceDigest
    });
    if (observed.accepted !== true || observed.transitionId !== transition.transitionId
      || observed.fromTargetSnapshotId !== transition.fromTargetSnapshotId
      || observed.observedEffectEvidenceDigest !== transition.expectedEffectEvidenceDigest
      || !digest(observed.toTargetSnapshotId) || !digest(observed.hostObservationDigest)
      || (transition.expectation === "changed" && observed.toTargetSnapshotId === transition.fromTargetSnapshotId)
      || (transition.expectation === "unchanged" && observed.toTargetSnapshotId !== transition.fromTargetSnapshotId)) {
      throw new Error("The host-observed in-flight target transition contradicted its exact effect boundary.");
    }
    const accepted: AutomationInFlightTargetTransition = deepFreeze({
      ...transition,
      toTargetSnapshotId: observed.toTargetSnapshotId,
      hostObservationDigest: observed.hostObservationDigest,
      status: "accepted"
    });
    return this.persist(state, {
      currentTargetSnapshotId: observed.toTargetSnapshotId,
      targetTransitionChain: state.targetTransitionChain.map((entry) => entry.transitionId === transition.transitionId ? accepted : entry)
    });
  }

  private async compensate(state: AutomationEffectJournalState, envelope: AutomationEnvelope, errors: string[]): Promise<Readonly<{ state: AutomationEffectJournalState; receipt: AutomationEffectReceipt }>> {
    let recoverable = true;
    let next = state;
    if (pendingTransition(next)) {
      recoverable = false;
      errors.push("A pending host target transition must be reconciled before compensation can safely continue.");
    }
    for (let index = next.children.length - 1; recoverable && index >= 0; index -= 1) {
      const childReceipt = next.children[index]!;
      if (childReceipt.effectDisposition === "ambiguous") {
        recoverable = false;
        errors.push(`Ambiguous ${childReceipt.kind} child requires durable external reconciliation.`);
        continue;
      }
      const child = effectPlan(envelope).find((entry) => entry.order === childReceipt.order && entry.kind === childReceipt.kind) as AutomationEffectChild & { kind: NonFilesystemChildKind } | undefined;
      if (childReceipt.effectDisposition === "compensated") {
        if (!child || !childReceipt.compensatedEvidenceDigest) {
          recoverable = false;
          errors.push(`Compensated ${childReceipt.kind} child lacks exact durable recovery evidence.`);
          continue;
        }
        try {
          const phase = { kind: "child", direction: "compensate", order: child.order, childKind: child.kind } as const;
          const transition = transitionForPhase(next, phase);
          if (!transition) {
            next = await this.advanceTarget(next, envelope, phase, child.kind === "git_commit" ? "changed" : "unchanged",
              effectEvidenceDigest({ child, compensation: { compensated: true, sourceTargetSnapshotId: next.currentTargetSnapshotId, evidenceDigest: childReceipt.compensatedEvidenceDigest } }));
          } else if (transition.status === "pending") next = await this.acceptPendingTransition(next, transition, envelope);
        } catch (error) {
          recoverable = false;
          errors.push(`Failed to reconcile compensated ${childReceipt.kind}: ${boundedError(error)}`);
        }
        continue;
      }
      if (childReceipt.effectDisposition !== "committed") continue;
      const port = child ? this.options.childPorts?.[child.kind] as AutomationChildEffectPort | undefined : undefined;
      if (!child || !port?.compensate || !childReceipt.compensationToken) {
        recoverable = false;
        errors.push(`Committed ${childReceipt.kind} child requires external recovery.`);
        continue;
      }
      try {
        await this.options.guard.assertCurrent({
          envelope,
          boundary: "before_child_compensation",
          expectedTargetSnapshotId: next.currentTargetSnapshotId,
          child
        });
        const result = await port.compensate({ child, envelope, currentTargetSnapshotId: next.currentTargetSnapshotId, compensationToken: childReceipt.compensationToken });
        if (result.compensated !== true || result.sourceTargetSnapshotId !== next.currentTargetSnapshotId || !digest(result.evidenceDigest)) {
          throw new Error("invalid compensation evidence");
        }
        const compensated = { ...childReceipt, effectDisposition: "compensated" as const, compensatedEvidenceDigest: result.evidenceDigest };
        next = await this.persist(next, { children: next.children.map((entry, childIndex) => childIndex === index ? compensated : entry) });
        const expectation = child.kind === "git_commit" ? "changed" : "unchanged";
        next = await this.advanceTarget(next, envelope, { kind: "child", direction: "compensate", order: child.order, childKind: child.kind }, expectation,
          effectEvidenceDigest({ child, compensation: result }));
      } catch (error) {
        recoverable = false;
        errors.push(`Failed to compensate ${childReceipt.kind}: ${boundedError(error)}`);
      }
    }
    for (let index = next.applied.length - 1; recoverable && index >= 0; index -= 1) {
      const recovery = next.applied[index]!;
      if (next.rolledBackPaths.includes(recovery.path)) {
        try {
          const phase = { kind: "filesystem", direction: "rollback", path: recovery.path } as const;
          const transition = transitionForPhase(next, phase);
          if (!transition) {
            const delta = rollbackDelta(recovery);
            next = await this.advanceTarget(next, envelope, phase, "changed", effectEvidenceDigest({ rollbackDelta: delta }));
          } else if (transition.status === "pending") next = await this.acceptPendingTransition(next, transition, envelope);
        } catch (error) {
          recoverable = false;
          errors.push(`Failed to reconcile rolled-back ${recovery.path}: ${boundedError(error)}`);
        }
        continue;
      }
      try {
        await this.options.guard.assertCurrent({
          envelope,
          boundary: "before_rollback",
          expectedTargetSnapshotId: next.currentTargetSnapshotId,
          path: recovery.path
        });
        const delta = await this.filesystem.rollback({ canonicalRoot: next.canonicalRoot, operationId: envelope.operationId, recovery });
        assertRollbackDeltaMatches(delta, recovery);
        next = await this.persist(next, { rolledBackPaths: [...next.rolledBackPaths, recovery.path] });
        next = await this.advanceTarget(next, envelope, { kind: "filesystem", direction: "rollback", path: recovery.path }, "changed",
          effectEvidenceDigest({ rollbackDelta: delta }));
      } catch (error) {
        recoverable = false;
        errors.push(`Failed to roll back ${recovery.path}: ${boundedError(error)}`);
      }
    }
    if (recoverable && next.currentTargetSnapshotId !== envelope.manifest.targetSnapshotId) {
      recoverable = false;
      errors.push("Compensation did not return the durable session to the exact reviewed source TargetSnapshot.");
    }
    const status = recoverable ? "compensated" as const : "recovery_required" as const;
    const actualDelta = next.deltas.length > 0 ? actualDeltaFor(envelope, next.deltas) : null;
    const receipt = createReceipt(envelope, status, actualDelta, null, next.targetTransitionChain, next.children, next.rolledBackPaths, errors);
    next = await this.persist(next, { status, errors, actualDelta, receipt });
    return { state: next, receipt };
  }

  private async persist(state: AutomationEffectJournalState, patch: Partial<AutomationEffectJournalState>): Promise<AutomationEffectJournalState> {
    const next = parseJournalState({ ...state, ...patch, revision: state.revision + 1, updatedAt: this.clock() });
    await this.options.journal.save(next);
    return next;
  }
}

export interface NodeAutomationFilesystemPortOptions {
  /** Test/diagnostic hook used to prove the final identity guard rejects substitution. */
  readonly beforeFinalMutationBoundary?: (absolutePath: string) => Promise<void>;
}

export class NodeAutomationFilesystemPort implements AutomationFilesystemPort {
  constructor(private readonly options: NodeAutomationFilesystemPortOptions = {}) {}

  async canonicalizeRoot(repositoryRoot: string): Promise<string> {
    if (!isAbsolute(repositoryRoot)) throw new Error("The automation repository root must be absolute.");
    const root = await realpath(repositoryRoot);
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("The automation repository root is not one canonical directory.");
    return resolve(root);
  }

  async apply(input: Readonly<{
    canonicalRoot: string;
    operationId: string;
    mutation: ExecutableMutation;
    existingRecovery?: AutomationFilesystemRecovery;
    recordRecovery(recovery: AutomationFilesystemRecovery): Promise<void>;
  }>): Promise<AutomationFilesystemApplyResult> {
    const root = await this.assertCanonicalRoot(input.canonicalRoot);
    const path = requiredCanonicalPath(input.mutation.path);
    const absolutePath = await this.containedPath(root, path);
    const ancestorChain = await this.captureAncestorChain(root, absolutePath);
    const before = await this.readFileState(root, absolutePath);
    if (input.existingRecovery) {
      this.assertExistingRecovery(input.existingRecovery, input.mutation, root, absolutePath, input.operationId);
      if (before.digest === input.existingRecovery.afterDigest) {
        if (input.existingRecovery.stagingPath) {
          const stagingAbsolute = await this.containedPath(root, requiredCanonicalPath(input.existingRecovery.stagingPath));
          await unlink(stagingAbsolute).catch((error) => { if (!nodeError(error, "ENOENT")) throw error; });
        }
        return { delta: forwardDelta(input.mutation), recovery: input.existingRecovery };
      }
      if (input.existingRecovery.stagingPath) {
        const stagingAbsolute = await this.containedPath(root, requiredCanonicalPath(input.existingRecovery.stagingPath));
        const staged = await this.readFileState(root, stagingAbsolute);
        if (staged.exists && staged.digest !== input.existingRecovery.afterDigest) throw new Error(`The interrupted automation staging bytes for ${path} changed.`);
        if (staged.exists) await unlink(stagingAbsolute);
      }
    }
    assertReviewedBefore(before, input.mutation);
    const bytes = input.mutation.content ? decodeReviewedContent(input.mutation.content, input.mutation.afterDigest) : null;
    const stagingAbsolutePath = bytes ? this.stagingPath(absolutePath, input.operationId) : null;
    const stagingRepositoryPath = stagingAbsolutePath ? relative(root, stagingAbsolutePath).replaceAll("\\", "/") : null;
    const recovery: AutomationFilesystemRecovery = {
      path,
      mutation: input.mutation.mutation,
      beforeDigest: before.digest,
      afterDigest: input.mutation.afterDigest,
      beforeContentBase64: before.bytes?.toString("base64") ?? null,
      beforeByteLength: before.bytes?.length ?? 0,
      beforeMode: before.mode,
      stagingPath: stagingRepositoryPath
    };
    if (input.existingRecovery) {
      if (stableJson(input.existingRecovery) !== stableJson(recovery)) throw new Error(`The authenticated automation recovery record for ${path} changed.`);
    } else {
      await input.recordRecovery(recovery);
    }
    let staged = false;
    try {
      if (bytes && stagingAbsolutePath) {
        await this.stage(stagingAbsolutePath, bytes, before.mode ?? 0o600);
        staged = true;
      }
      await this.options.beforeFinalMutationBoundary?.(absolutePath);
      await this.assertAncestorChain(ancestorChain);
      const finalBefore = await this.readFileState(root, absolutePath);
      if (!sameFileState(before, finalBefore)) throw new Error(`The automation path ${path} was substituted before the final mutation boundary.`);
      if (input.mutation.mutation === "delete") await unlink(absolutePath);
      else {
        if (!stagingAbsolutePath || !staged) throw new Error(`The reviewed bytes for ${path} disappeared before the mutation boundary.`);
        await rename(stagingAbsolutePath, absolutePath);
        staged = false;
      }
      await this.assertAncestorChain(ancestorChain);
      const after = await this.readFileState(root, absolutePath);
      assertReviewedAfter(after, input.mutation);
      return {
        delta: {
          path,
          mutation: input.mutation.mutation,
          beforeDigest: before.digest,
          afterDigest: after.digest,
          byteLength: after.bytes?.length ?? 0,
          status: "applied"
        },
        recovery: { ...recovery, afterDigest: after.digest }
      };
    } finally {
      if (staged && stagingAbsolutePath) await unlink(stagingAbsolutePath).catch(() => undefined);
    }
  }

  private assertExistingRecovery(
    recovery: AutomationFilesystemRecovery,
    mutation: ExecutableMutation,
    root: string,
    absolutePath: string,
    operationId: string
  ): void {
    const expectedStaging = mutation.content
      ? relative(root, this.stagingPath(absolutePath, operationId)).replaceAll("\\", "/")
      : null;
    if (recovery.path !== mutation.path || recovery.mutation !== mutation.mutation
      || recovery.beforeDigest !== mutation.beforeDigest || recovery.afterDigest !== mutation.afterDigest
      || recovery.stagingPath !== expectedStaging || !Number.isSafeInteger(recovery.beforeByteLength) || recovery.beforeByteLength < 0
      || (recovery.beforeDigest === null && (recovery.beforeContentBase64 !== null || recovery.beforeByteLength !== 0))
      || (recovery.beforeDigest !== null && (recovery.beforeContentBase64 === null
        || Buffer.from(recovery.beforeContentBase64, "base64").toString("base64") !== recovery.beforeContentBase64
        || Buffer.from(recovery.beforeContentBase64, "base64").length !== recovery.beforeByteLength
        || hashBytes(Buffer.from(recovery.beforeContentBase64, "base64")) !== recovery.beforeDigest))) {
      throw new Error(`The authenticated automation recovery record for ${mutation.path} is malformed or cross-bound.`);
    }
  }

  async rollback(input: Readonly<{ canonicalRoot: string; operationId: string; recovery: AutomationFilesystemRecovery }>): Promise<AutomationActualMutationDelta> {
    const root = await this.assertCanonicalRoot(input.canonicalRoot);
    const path = requiredCanonicalPath(input.recovery.path);
    const absolutePath = await this.containedPath(root, path);
    const ancestorChain = await this.captureAncestorChain(root, absolutePath);
    if (input.recovery.stagingPath) {
      const stagingPath = requiredCanonicalPath(input.recovery.stagingPath);
      const stagingAbsolute = await this.containedPath(root, stagingPath);
      const staged = await this.readFileState(root, stagingAbsolute);
      if (staged.exists) await unlink(stagingAbsolute);
    }
    const current = await this.readFileState(root, absolutePath);
    const delta = rollbackDelta(input.recovery);
    if (current.digest === input.recovery.beforeDigest) return delta;
    if (current.digest !== input.recovery.afterDigest) throw new Error(`The automation rollback target ${path} changed after the attempted effect.`);
    if (input.recovery.beforeDigest === null) {
      if (!current.exists) throw new Error(`The created automation path ${path} already disappeared before rollback.`);
      await this.assertAncestorChain(ancestorChain);
      await unlink(absolutePath);
      await this.assertAncestorChain(ancestorChain);
      const deleted = await this.readFileState(root, absolutePath);
      if (deleted.exists) throw new Error(`The automation rollback for ${path} did not remove the exact created path.`);
      return delta;
    }
    if (input.recovery.beforeContentBase64 === null) throw new Error(`The automation rollback bytes for ${path} are unavailable.`);
    const bytes = Buffer.from(input.recovery.beforeContentBase64, "base64");
    if (bytes.length !== input.recovery.beforeByteLength || hashBytes(bytes) !== input.recovery.beforeDigest) {
      throw new Error(`The protected automation rollback bytes for ${path} failed integrity validation.`);
    }
    const staging = this.stagingPath(absolutePath, `${input.operationId}-rollback`);
    await this.stage(staging, bytes, input.recovery.beforeMode ?? 0o600);
    try {
      await this.assertAncestorChain(ancestorChain);
      const finalCurrent = await this.readFileState(root, absolutePath);
      if (!sameFileState(current, finalCurrent)) throw new Error(`The automation rollback path ${path} was substituted.`);
      await rename(staging, absolutePath);
      await this.assertAncestorChain(ancestorChain);
    } catch (error) {
      await unlink(staging).catch(() => undefined);
      throw error;
    }
    const restored = await this.readFileState(root, absolutePath);
    if (restored.digest !== input.recovery.beforeDigest) throw new Error(`The automation rollback for ${path} did not restore the exact before digest.`);
    return delta;
  }

  private async assertCanonicalRoot(root: string): Promise<string> {
    const canonical = await this.canonicalizeRoot(root);
    if (!sameHostPath(canonical, root)) throw new Error("The automation repository root was substituted through a reparse boundary.");
    return canonical;
  }

  private async containedPath(root: string, repositoryPath: string): Promise<string> {
    const absolutePath = resolve(root, ...repositoryPath.split("/"));
    const rel = relative(root, absolutePath);
    if (!rel || rel === ".." || rel.startsWith(`..${separator()}`) || isAbsolute(rel)) throw new Error("The automation mutation escapes the canonical repository root.");
    const parent = dirname(absolutePath);
    const parentRel = relative(root, parent);
    let cursor = root;
    if (parentRel) {
      for (const segment of parentRel.split(/[\\/]/u)) {
        cursor = resolve(cursor, segment);
        const info = await lstat(cursor);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("The automation mutation crosses a symlink or reparse-point ancestor.");
        const observed = await realpath(cursor);
        if (!sameHostPath(observed, cursor)) throw new Error("The automation mutation crosses a substituted directory ancestor.");
      }
    }
    return absolutePath;
  }

  private async captureAncestorChain(root: string, absolutePath: string): Promise<readonly DirectoryIdentity[]> {
    const parent = dirname(absolutePath);
    const rel = relative(root, parent);
    if (rel === ".." || rel.startsWith(`..${separator()}`) || isAbsolute(rel)) throw new Error("The automation mutation ancestor escaped containment.");
    const paths = [root];
    let cursor = root;
    if (rel) for (const segment of rel.split(/[\\/]/u)) { cursor = resolve(cursor, segment); paths.push(cursor); }
    const identities: DirectoryIdentity[] = [];
    for (const path of paths) {
      const info = await lstat(path, { bigint: true });
      const observed = await realpath(path);
      if (!info.isDirectory() || info.isSymbolicLink() || !sameHostPath(observed, path)) {
        throw new Error("The automation mutation crosses a symlink, reparse point, or substituted directory ancestor.");
      }
      identities.push(Object.freeze({ path, identity: directoryIdentity(info) }));
    }
    return Object.freeze(identities);
  }

  private async assertAncestorChain(chain: readonly DirectoryIdentity[]): Promise<void> {
    for (const expected of chain) {
      const info = await lstat(expected.path, { bigint: true });
      const observed = await realpath(expected.path);
      if (!info.isDirectory() || info.isSymbolicLink() || !sameHostPath(observed, expected.path) || directoryIdentity(info) !== expected.identity) {
        throw new Error("An automation mutation directory ancestor was substituted at the final effect boundary.");
      }
    }
  }

  private async readFileState(root: string, absolutePath: string): Promise<FileState> {
    const rel = relative(root, absolutePath);
    if (rel === ".." || rel.startsWith(`..${separator()}`) || isAbsolute(rel)) throw new Error("The automation file observation escaped containment.");
    let info;
    try {
      info = await lstat(absolutePath, { bigint: true });
    } catch (error) {
      if (nodeError(error, "ENOENT")) return { exists: false, identity: null, digest: null, bytes: null, mode: null };
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("The automation path is not one regular non-reparse file.");
    const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const openedBefore = await handle.stat({ bigint: true });
      if (!openedBefore.isFile()) throw new Error("The automation path changed type while it was opened.");
      const bytes = await handle.readFile();
      const openedAfter = await handle.stat({ bigint: true });
      const identity = fileIdentity(openedBefore);
      if (identity !== fileIdentity(openedAfter) || identity !== fileIdentity(info)) throw new Error("The automation path changed identity while it was read.");
      return { exists: true, identity, digest: hashBytes(bytes), bytes, mode: Number(openedBefore.mode & 0o777n) };
    } finally {
      await handle.close();
    }
  }

  private stagingPath(absolutePath: string, operationId: string): string {
    const safeOperation = createHash("sha256").update(operationId, "utf8").digest("hex").slice(0, 24);
    return resolve(dirname(absolutePath), `.${basename(absolutePath)}.sxsy-b122-${safeOperation}.tmp`);
  }

  private async stage(path: string, bytes: Buffer, mode: number): Promise<void> {
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode & 0o777);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

interface FileState {
  readonly exists: boolean;
  readonly identity: string | null;
  readonly digest: string | null;
  readonly bytes: Buffer | null;
  readonly mode: number | null;
}

interface DirectoryIdentity {
  readonly path: string;
  readonly identity: string;
}

function instructionConsentForEnvelope(envelope: AutomationEnvelope): AutomationInstructionFileConsent | null {
  const proposal = envelope.manifest.proposal;
  return proposal.kind === "compound_capture" && proposal.instructionFileMutation.kind === "edit_existing"
    ? Object.freeze({
        path: proposal.instructionFileMutation.path,
        approvalId: envelope.approval.id,
        confirmationDigest: envelope.approval.confirmationDigest
      })
    : null;
}

function exactMutations(envelope: AutomationEnvelope, instructionConsent: AutomationInstructionFileConsent | undefined): readonly ExecutableMutation[] {
  const proposal = envelope.manifest.proposal;
  let mutations: readonly AutomationPathMutation[];
  if (proposal.kind === "compound_capture") {
    mutations = proposal.documents;
    if (proposal.instructionFileMutation.kind === "edit_existing") {
      const edit = proposal.instructionFileMutation;
      if (!instructionConsent || instructionConsent.path !== edit.path || instructionConsent.approvalId !== envelope.approval.id
        || instructionConsent.confirmationDigest !== envelope.approval.confirmationDigest) {
        throw new Error("The instruction-file mutation lacks its separate exact consent binding.");
      }
      mutations = [...mutations, {
        path: edit.path,
        mutation: "update",
        beforeDigest: edit.beforeDigest,
        afterDigest: edit.afterDigest,
        content: edit.content
      }];
    }
  } else if (proposal.kind === "compound_refresh") mutations = proposal.mutations;
  else mutations = proposal.mutations ?? [];
  if (mutations.length === 0) throw new Error("The reviewed automation manifest contains no executable filesystem effects.");
  return Object.freeze(mutations.map((mutation) => {
    const path = requiredCanonicalPath(mutation.path);
    if ((mutation.mutation !== "delete" && !mutation.content) || mutation.beforeDigest === undefined || mutation.afterDigest === undefined) {
      throw new Error(`The reviewed automation mutation ${path} lacks exact bytes or explicit before/after state.`);
    }
    return Object.freeze({
      path,
      mutation: mutation.mutation,
      beforeDigest: mutation.beforeDigest,
      afterDigest: mutation.afterDigest,
      content: mutation.content ?? null
    }) as ExecutableMutation;
  }));
}

function effectPlan(envelope: AutomationEnvelope): readonly AutomationEffectChild[] {
  const proposal = envelope.manifest.proposal;
  if (proposal.kind === "compound_refresh" && proposal.commit.planned) {
    return Object.freeze([
      Object.freeze({ order: 0, kind: "filesystem_mutation" as const, scopeDigest: automationMutationScopeDigest(proposal.mutations) }),
      Object.freeze({ order: 1, kind: "git_commit" as const, scopeDigest: proposal.commit.messageDigest })
    ]);
  }
  return proposal.kind === "lfg" || proposal.kind === "repair_mission" ? proposal.effectPlan ?? [] : [];
}

function requiredRefreshCommit(envelope: AutomationEnvelope, child: AutomationEffectChild): boolean {
  const proposal = envelope.manifest.proposal;
  return envelope.action === "compound_refresh" && proposal.kind === "compound_refresh" && proposal.commit.planned
    && child.kind === "git_commit" && child.order === 1 && child.scopeDigest === proposal.commit.messageDigest;
}

function assertChildResult(
  result: AutomationChildEffectResult,
  expectedTargetSnapshotId: string,
  child: AutomationEffectChild & { kind: NonFilesystemChildKind }
): void {
  if (result.sourceTargetSnapshotId !== expectedTargetSnapshotId
    || result.scopeDigest !== child.scopeDigest
    || !digest(result.evidenceDigest)
    || (result.effectDisposition !== "committed" && result.effectDisposition !== "not_started" && result.effectDisposition !== "compensated")
    || (result.compensationToken !== null && !identifier(result.compensationToken))) {
    throw new Error(`The typed ${child.kind} automation child returned malformed or cross-bound evidence.`);
  }
  if (result.effectDisposition !== "committed" && result.compensationToken !== null) {
    throw new Error(`The typed ${child.kind} automation child returned a compensation token without a committed effect.`);
  }
}

function childReceipt(
  child: AutomationEffectChild & { kind: NonFilesystemChildKind },
  result: AutomationChildEffectResult
): AutomationChildReceipt {
  return Object.freeze({
    order: child.order,
    kind: child.kind,
    scopeDigest: result.scopeDigest,
    evidenceDigest: result.evidenceDigest,
    effectDisposition: result.effectDisposition,
    compensationToken: result.compensationToken,
    compensatedEvidenceDigest: null
  });
}

function actualDeltaFor(envelope: AutomationEnvelope, mutations: readonly AutomationActualMutationDelta[]): AutomationActualDeltaEvidence {
  return createAutomationActualDeltaEvidence({
    operationId: envelope.operationId,
    manifestId: envelope.manifest.id,
    manifestDigest: envelope.manifest.digest,
    proposalDigest: envelope.intent.binding.proposalDigest,
    fromTargetSnapshotId: envelope.manifest.targetSnapshotId,
    mutations
  });
}

function effectEvidenceDigest(value: Readonly<Record<string, unknown>>): string {
  return sha256(stableJson({ schema: "sxsy-b122.automation-effect-boundary", version: 1, ...value }));
}

function sameTransitionPhase(left: AutomationTargetTransitionPhase, right: AutomationTargetTransitionPhase): boolean {
  return stableJson(left) === stableJson(right);
}

function transitionForPhase(state: AutomationEffectJournalState, phase: AutomationTargetTransitionPhase): AutomationInFlightTargetTransition | undefined {
  return state.targetTransitionChain.find((entry) => sameTransitionPhase(entry.phase, phase));
}

function pendingTransition(state: AutomationEffectJournalState): AutomationInFlightTargetTransition | undefined {
  const pending = state.targetTransitionChain.filter((entry) => entry.status === "pending");
  if (pending.length > 1) throw new Error("The protected automation journal contains multiple pending target transitions.");
  return pending[0];
}

function targetChainObservationDigest(chain: readonly AutomationInFlightTargetTransition[]): string {
  if (!chain.length || chain.some((entry) => entry.status !== "accepted" || entry.toTargetSnapshotId === null || entry.hostObservationDigest === null)) {
    throw new Error("The automation effect cannot settle without a complete accepted host target-transition chain.");
  }
  return sha256(stableJson({ schema: "sxsy-b122.automation-target-transition-chain", version: 1, chain }));
}

function assertDeltaMatches(delta: AutomationActualMutationDelta, mutation: ExecutableMutation): void {
  if (delta.path !== mutation.path || delta.mutation !== mutation.mutation
    || delta.beforeDigest !== mutation.beforeDigest || delta.afterDigest !== mutation.afterDigest
    || delta.status !== "applied") throw new Error(`The host-observed delta for ${mutation.path} changed from the reviewed mutation.`);
}

function forwardDelta(mutation: ExecutableMutation): AutomationActualMutationDelta {
  return deepFreeze({
    path: mutation.path,
    mutation: mutation.mutation,
    beforeDigest: mutation.beforeDigest,
    afterDigest: mutation.afterDigest,
    byteLength: mutation.content?.byteLength ?? 0,
    status: "applied"
  });
}

function rollbackDelta(recovery: AutomationFilesystemRecovery): AutomationActualMutationDelta {
  if (recovery.mutation === "create") {
    return deepFreeze({ path: recovery.path, mutation: "delete", beforeDigest: recovery.afterDigest, afterDigest: null, byteLength: 0, status: "applied" });
  }
  if (recovery.mutation === "delete") {
    return deepFreeze({ path: recovery.path, mutation: "create", beforeDigest: null, afterDigest: recovery.beforeDigest, byteLength: recovery.beforeByteLength, status: "applied" });
  }
  return deepFreeze({
    path: recovery.path,
    mutation: recovery.mutation,
    beforeDigest: recovery.afterDigest,
    afterDigest: recovery.beforeDigest,
    byteLength: recovery.beforeByteLength,
    status: "applied"
  });
}

function assertRollbackDeltaMatches(delta: AutomationActualMutationDelta, recovery: AutomationFilesystemRecovery): void {
  const expected = rollbackDelta(recovery);
  if (stableJson(delta) !== stableJson(expected)) throw new Error(`The host-observed rollback delta for ${recovery.path} changed.`);
}

function assertReviewedBefore(before: FileState, mutation: ExecutableMutation): void {
  if (mutation.beforeDigest === null && before.exists) throw new Error(`Automation create target ${mutation.path} already exists.`);
  if (mutation.beforeDigest !== null && (!before.exists || before.digest !== mutation.beforeDigest)) throw new Error(`Automation before digest mismatch for ${mutation.path}.`);
}

function assertReviewedAfter(after: FileState, mutation: ExecutableMutation): void {
  if (mutation.afterDigest === null && after.exists) throw new Error(`Automation delete target ${mutation.path} still exists.`);
  if (mutation.afterDigest !== null && (!after.exists || after.digest !== mutation.afterDigest)) throw new Error(`Automation after digest mismatch for ${mutation.path}.`);
}

function decodeReviewedContent(content: AutomationExactContent, afterDigest: string | null): Buffer {
  if (afterDigest === null || content.encoding !== "base64") throw new Error("The automation reviewed content is inconsistent with its after state.");
  const bytes = Buffer.from(content.data, "base64");
  if (bytes.toString("base64") !== content.data || bytes.length !== content.byteLength || hashBytes(bytes) !== afterDigest) {
    throw new Error("The automation reviewed content failed its exact byte or SHA-256 binding.");
  }
  return bytes;
}

function createReceipt(
  envelope: AutomationEnvelope,
  status: AutomationEffectReceipt["status"],
  actualDelta: AutomationActualDeltaEvidence | null,
  targetTransition: AutomationAcceptedTargetTransitionEvidence | null,
  targetTransitionChain: readonly AutomationInFlightTargetTransition[],
  children: readonly AutomationChildReceipt[],
  rolledBackPaths: readonly string[],
  errors: readonly string[]
): AutomationEffectReceipt {
  const content = {
    schema: "sxsy-b122.automation-effect-receipt" as const,
    version: 1 as const,
    operationId: envelope.operationId,
    action: envelope.action,
    manifestId: envelope.manifest.id,
    manifestDigest: envelope.manifest.digest,
    proposalDigest: envelope.intent.binding.proposalDigest,
    status,
    actualDelta,
    targetTransition,
    targetTransitionChain: targetTransitionChain.map((entry) => deepFreeze({ ...entry, phase: { ...entry.phase } })),
    children: children.map((entry) => Object.freeze({ ...entry })),
    rolledBackPaths: [...rolledBackPaths],
    errors: errors.map((entry) => boundedText(entry, 1_024))
  };
  return deepFreeze({ ...content, digest: sha256(stableJson(content)) });
}

export function parseAutomationEffectRecoveryBinding(value: unknown): AutomationEffectRecoveryBinding {
  if (!record(value) || !exactKeys(value, ["schema", "version", "envelope", "request", "instructionFileConsent", "digest"])
    || value.schema !== "sxsy-b122.automation-effect-recovery-binding" || value.version !== 1 || !digest(value.digest)) {
    throw new Error("The protected automation recovery binding is malformed.");
  }
  const envelope = parseAutomationEnvelope(value.envelope);
  const request = record(value.request) ? value.request : undefined;
  if (!request || !exactKeys(request, ["action", "operationId", "target", "session", "authority", "permit", "confirmation", "executionControl", "testEnvironment", "reviewedManifest", "manifestApproval"])) {
    throw new Error("The protected automation recovery request is malformed.");
  }
  const target = record(request.target) ? request.target : undefined;
  const session = record(request.session) ? request.session : undefined;
  const authority = record(request.authority) ? request.authority : undefined;
  const permit = record(request.permit) ? request.permit : undefined;
  const confirmation = record(request.confirmation) ? request.confirmation : undefined;
  const executionControl = record(request.executionControl) ? request.executionControl : undefined;
  const reviewedManifest = parseAutomationOperationManifest(request.reviewedManifest);
  const manifestApproval = parseAutomationManifestApproval(request.manifestApproval, reviewedManifest);
  if (!target || !session || !authority || !permit || !confirmation || !executionControl
    || request.action !== envelope.action || request.operationId !== envelope.operationId
    || target.id !== envelope.manifest.targetSnapshotId || target.repositoryRoot !== envelope.manifest.repositoryRoot
    || session.id !== envelope.manifest.sessionId || session.provider !== envelope.manifest.provider
    || session.taskId !== envelope.manifest.taskId || session.planRevision !== envelope.manifest.planRevision
    || authority.id !== envelope.manifest.authorityId
    || permit.action !== envelope.action || permit.operationId !== envelope.operationId
    || permit.targetSnapshotId !== envelope.manifest.targetSnapshotId || permit.sessionId !== envelope.manifest.sessionId
    || permit.authorityId !== envelope.manifest.authorityId || !identifier(permit.id)
    || typeof permit.expiresAt !== "string" || !Number.isFinite(Date.parse(permit.expiresAt))
    || confirmation.currentUserConfirmed !== true || confirmation.action !== envelope.action
    || confirmation.confirmationDigest !== envelope.approval.confirmationDigest
    || confirmation.confirmationScopeDigest !== envelope.approval.reviewScopeDigest
    || confirmation.targetSnapshotId !== envelope.manifest.targetSnapshotId
    || confirmation.sessionId !== envelope.manifest.sessionId || confirmation.authorityId !== envelope.manifest.authorityId
    || executionControl.operationId !== envelope.operationId
    || (executionControl.budgetClaimId !== null && !identifier(executionControl.budgetClaimId))
    || typeof executionControl.deadline !== "string" || !Number.isFinite(Date.parse(executionControl.deadline))
    || stableJson(reviewedManifest) !== stableJson(envelope.manifest)
    || stableJson(manifestApproval) !== stableJson(envelope.approval)
    || stableJson(value.instructionFileConsent) !== stableJson(instructionConsentForEnvelope(envelope))) {
    throw new Error("The protected automation recovery binding changed its exact admission scope.");
  }
  const expectedEnvironment = envelope.manifest.proposal.kind === "repair_mission" ? envelope.manifest.proposal.testEnvironment : null;
  if (stableJson(request.testEnvironment) !== stableJson(expectedEnvironment)) {
    throw new Error("The protected automation recovery test environment changed.");
  }
  const { digest: _digest, ...content } = value;
  if (sha256(stableJson(content)) !== value.digest) throw new Error("The protected automation recovery binding digest changed.");
  return deepFreeze(value as unknown as AutomationEffectRecoveryBinding);
}

function parseJournalState(value: unknown): AutomationEffectJournalState {
  if (!record(value) || value.schema !== "sxsy-b122.automation-effect-journal-state" || value.version !== 1
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !identifier(value.operationId)
    || !digest(value.requestDigest) || !action(value.action) || !journalStatus(value.status) || typeof value.canonicalRoot !== "string"
    || !digest(value.currentTargetSnapshotId) || !Array.isArray(value.targetTransitionChain)
    || !Array.isArray(value.applied) || !Array.isArray(value.deltas) || !Array.isArray(value.children) || !Array.isArray(value.rolledBackPaths)
    || !Array.isArray(value.errors) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error("The protected automation effect journal state is malformed.");
  }
  const recoveryBinding = value.recoveryBinding === undefined ? undefined : parseAutomationEffectRecoveryBinding(value.recoveryBinding);
  return deepFreeze({ ...value, ...(recoveryBinding ? { recoveryBinding } : {}) } as unknown as AutomationEffectJournalState);
}

function fileIdentity(info: Readonly<{ dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }>): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}
function directoryIdentity(info: Readonly<{ dev: bigint; ino: bigint }>): string { return `${info.dev}:${info.ino}`; }
function sameFileState(left: FileState, right: FileState): boolean {
  return left.exists === right.exists && left.identity === right.identity && left.digest === right.digest;
}
function hashBytes(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function requiredCanonicalPath(value: string): string {
  const canonical = canonicalAutomationRepositoryPath(value);
  if (!canonical || canonical !== value) throw new Error("The automation path is not one canonical repository-relative path.");
  return canonical;
}
function sameHostPath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const exact = resolve(value).replaceAll("\\", "/").replace(/\/+$/u, "");
    return process.platform === "win32" ? exact.toLowerCase() : exact;
  };
  return normalize(left) === normalize(right);
}
function separator(): string { return process.platform === "win32" ? "\\" : "/"; }
function boundedError(error: unknown): string { return boundedText(error instanceof Error ? error.message : String(error), 1_024); }
function boundedText(value: string, maximum: number): string { return value.replace(/[\0\r\n]+/gu, " ").slice(0, maximum) || "unknown error"; }
function nodeError(error: unknown, code: string): boolean { return record(error) && error.code === code; }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function identifier(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value); }
function action(value: unknown): value is AutomationEnvelope["action"] { return value === "compound_capture" || value === "compound_refresh" || value === "lfg" || value === "repair_mission"; }
function journalStatus(value: unknown): value is AutomationEffectJournalState["status"] { return value === "applying" || value === "transitioning" || value === "compensating" || value === "committed" || value === "compensated" || value === "recovery_required"; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
