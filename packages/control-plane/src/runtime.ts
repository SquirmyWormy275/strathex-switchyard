import { AdapterRegistry } from "./adapters.ts";
import { GateEvidenceLedger } from "./acceptance-evidence.ts";
import { AuthorityLedger } from "./authority.ts";
import { DurableBudgetManager, type BudgetConfiguration, type CommandBudget } from "./budgets.ts";
import { CheckpointLedger, type CheckpointArtifact, type CheckpointWorkflow, type RecoveryArtifactVerifier, type RecoveryGuideInput } from "./checkpoints.ts";
import { commandActionIds, commandFor, commandForAction, type CommandAction, type CommandDefinition } from "./command-catalog.ts";
import { DurableConfirmationLedger } from "./confirmations.ts";
import type { AuthorityGrant, CommandRequest, CommandResult, ManagedSession, TargetSnapshot } from "./contracts.ts";
import {
  CommandDispatcher,
  type CommandDispatcherDependencies,
  type DispatchGovernance,
  type DispatchGovernanceAdmission,
  type DispatchGovernanceRequest,
  type DispatchReceiptEvidenceFactory
} from "./dispatch.ts";
import { DurableOperationCoordinator, NoReplayOperationRecovery, OperationSagaStore, type OperationReconciler, type ReconciliationResult } from "./operations.ts";
import { ExecutionControlRegistry, type ExecutionControl, type OperationControlAdapter } from "./execution-control.ts";
import type { EffectGuard } from "./brokers.ts";
import { PolicyEngine } from "./policy.ts";
import { ReceiptLedger } from "./receipts.ts";
import { SessionRegistry } from "./session-registry.ts";
import { TargetSnapshotLedger } from "./snapshot-ledger.ts";
import { ProtectedJsonStore } from "./store.ts";

export interface TargetResolver {
  /** Resolve a target only from trusted host/session identity; never from command input. */
  resolve(input: Readonly<{ definition: CommandDefinition; session?: ManagedSession }>): Promise<TargetSnapshot | undefined>;
}

export interface RuntimeDispatcherContext {
  readonly policy: PolicyEngine;
  readonly sessions: SessionRegistry;
  readonly authorities: AuthorityLedger;
  readonly operationCoordinator: DurableOperationCoordinator;
  readonly receiptEvidence?: DispatchReceiptEvidenceFactory;
}

/** A trusted host captures only preservation references and digests, never a recovery executor. */
export interface CheckpointCaptureRequest {
  readonly definition: CommandDefinition;
  readonly operationId: string;
  readonly workflow: CheckpointWorkflow;
  readonly target: TargetSnapshot;
  readonly session?: ManagedSession;
}

export interface CheckpointCaptureResult {
  readonly reason: string;
  readonly artifacts: readonly CheckpointArtifact[];
  readonly recovery: RecoveryGuideInput;
}

export interface CheckpointCaptureAdapter {
  capture(input: CheckpointCaptureRequest): Promise<CheckpointCaptureResult | undefined>;
}

export interface TargetSnapshotRevalidationRequest {
  readonly definition: CommandDefinition;
  readonly target: TargetSnapshot;
  readonly session?: ManagedSession;
}

/** A target may be re-read only through a trusted host/session resolver. */
export interface TargetSnapshotRevalidator {
  revalidate(input: TargetSnapshotRevalidationRequest): Promise<boolean>;
}

export interface ConfirmationAttestationRequest {
  readonly definition: CommandDefinition;
  readonly target?: TargetSnapshot;
  readonly session?: ManagedSession;
  readonly authority?: AuthorityGrant;
  readonly reason: string;
}

/**
 * A host-only hook for an actual companion UI reauthentication ceremony. A
 * JSON-lines or extension payload never supplies this result directly.
 */
export interface ConfirmationAttestor {
  attest(input: ConfirmationAttestationRequest): Promise<Readonly<{ reauthenticated: boolean; operator: string }> | undefined>;
}

export interface RuntimeConfirmationRequest {
  readonly action: CommandAction;
  readonly sessionId?: string;
  readonly authorityId?: string;
  readonly reason: string;
}

export interface RuntimeConfirmationResult {
  readonly status: "issued" | "blocked" | "unavailable" | "incomplete";
  readonly summary: string;
  readonly token?: string;
  readonly expiresAt?: string;
}

export interface ExternalOperationCompletion {
  readonly operationId: string;
  readonly action: CommandAction;
  readonly targetSnapshotId?: string;
  readonly status: "completed" | "failed" | "cancelled" | "incomplete";
  readonly summary: string;
  readonly evidenceDigest?: string;
  readonly toolVersions?: Readonly<Record<string, string>>;
}

export interface DeadlineSchedule {
  cancel(): void;
}

/** Injectable only for host integration and deterministic tests; no scheduler retries work. */
export interface DeadlineScheduler {
  schedule(delayMs: number, callback: () => void): DeadlineSchedule;
}

const systemDeadlineScheduler: DeadlineScheduler = {
  schedule(delayMs, callback) {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  }
};

export interface DurableMediatedExecutorOptions {
  readonly store: ProtectedJsonStore;
  readonly sessions?: SessionRegistry;
  readonly authorities?: AuthorityLedger;
  readonly gateEvidence?: GateEvidenceLedger;
  readonly snapshots?: TargetSnapshotLedger;
  readonly checkpoints?: CheckpointLedger;
  readonly checkpointCapture?: CheckpointCaptureAdapter;
  /**
   * Read-only verification of each captured recovery artifact.  Risky work is
   * unavailable when the host cannot prove the preservation reference still
   * resolves to the recorded digest immediately before dispatch.
   */
  readonly checkpointVerifier?: RecoveryArtifactVerifier;
  readonly confirmations?: DurableConfirmationLedger;
  /** Omit to fail closed: no confirmation/reauthentication token can be minted. */
  readonly confirmationAttestor?: ConfirmationAttestor;
  /** Optional host process/provider control. Omission leaves timeout/cancel work visibly unresolved. */
  readonly operationControl?: OperationControlAdapter;
  /** Action-specific observation adapters used only during no-replay startup recovery. */
  readonly operationReconcilers?: Readonly<Record<string, OperationReconciler>>;
  readonly deadlineScheduler?: DeadlineScheduler;
  readonly budgets?: DurableBudgetManager;
  /** Optional host-owned policy. Omission gets a conservative local configuration. */
  readonly budgetConfiguration?: BudgetConfiguration;
  readonly policyVersion: string;
  readonly targetResolver: TargetResolver;
  /** Empty by default; a high-consequence action must be enabled explicitly in host policy. */
  readonly enabledHighConsequenceActions?: readonly CommandAction[];
  readonly now?: () => Date;
  /**
   * Builds fresh broker/adapter dependencies for the same policy instance that
   * minted the permit. It prevents a stale or unrelated policy from being
   * accidentally supplied to a broker.
   */
  readonly dependencies?: (context: RuntimeDispatcherContext) => Omit<CommandDispatcherDependencies, "policy" | "sessions" | "authorities" | "operations" | "receiptEvidence" | "governance">;
  readonly receiptEvidence?: DispatchReceiptEvidenceFactory;
}

/**
 * The real software-only mediation seam. It loads sessions and authority from
 * protected ledgers, captures a trusted target through an injected resolver,
 * converts protected gate evidence to policy input, then dispatches through a
 * durable operation coordinator. It never turns a keyboard/bridge payload,
 * repository text, or provider output into authority.
 */
export class DurableMediatedExecutor {
  readonly sessions: SessionRegistry;
  readonly authorities: AuthorityLedger;
  readonly gateEvidence: GateEvidenceLedger;
  readonly snapshots: TargetSnapshotLedger;
  readonly checkpoints: CheckpointLedger;
  readonly confirmations: DurableConfirmationLedger;
  readonly budgets: DurableBudgetManager;
  readonly operations: OperationSagaStore;
  readonly receipts: ReceiptLedger;
  readonly operationCoordinator: DurableOperationCoordinator;
  readonly recovery: NoReplayOperationRecovery;
  private readonly options: DurableMediatedExecutorOptions;
  private readonly now: () => Date;
  private readonly executionControls = new ExecutionControlRegistry();

  constructor(options: DurableMediatedExecutorOptions) {
    this.options = options;
    this.sessions = options.sessions ?? new SessionRegistry(options.store);
    this.authorities = options.authorities ?? new AuthorityLedger(options.store);
    this.gateEvidence = options.gateEvidence ?? new GateEvidenceLedger(options.store);
    this.snapshots = options.snapshots ?? new TargetSnapshotLedger(options.store);
    this.checkpoints = options.checkpoints ?? new CheckpointLedger(options.store);
    this.confirmations = options.confirmations ?? new DurableConfirmationLedger(options.store, { clock: () => this.now().toISOString() });
    this.budgets = options.budgets ?? new DurableBudgetManager(options.store);
    this.operations = new OperationSagaStore(options.store);
    this.receipts = new ReceiptLedger(options.store);
    this.operationCoordinator = new DurableOperationCoordinator(this.operations, this.receipts);
    this.recovery = new NoReplayOperationRecovery(this.operations);
    for (const [action, reconciler] of Object.entries(options.operationReconcilers ?? {})) this.recovery.register(action, reconciler);
    this.now = options.now ?? (() => new Date());
  }

  async execute(request: CommandRequest): Promise<CommandResult> {
    const definition = commandFor(request.control, request.modifier);
    if (!definition || definition.assignment !== request.assignment) {
      return { status: "blocked", summary: "Command assignment mismatch or intentionally unassigned chord; no durable action was started." };
    }
    const session = request.sessionId ? await this.sessions.get(request.sessionId) : undefined;
    if (request.sessionId && !session) {
      return this.auditWithoutOperation(definition, { status: "unavailable", summary: "Selected session is absent from the protected managed-session registry." });
    }
    let target: TargetSnapshot | undefined;
    if (definition.requiresTarget) {
      target = await this.resolveTarget(definition, session);
      if (!target) return this.auditWithoutOperation(definition, { status: "unavailable", summary: "The trusted target resolver could not identify an exact workspace target." });
      try {
        target = await this.snapshots.record(target);
      } catch {
        return this.auditWithoutOperation(definition, { status: "unavailable", summary: "The trusted TargetSnapshot could not be durably validated and recorded; no action was started." });
      }
    }
    let authority: AuthorityGrant | undefined;
    if (definition.requiresAuthority) {
      const decision = await this.authorities.evaluate({
        authorityId: request.authorityId,
        repositoryRoot: target?.repositoryRoot ?? "<unresolved>",
        ...(session?.id ? { sessionId: session.id } : {}),
        ...(session?.taskId ? { taskId: session.taskId } : {}),
        ...(session?.planRevision ? { planRevision: session.planRevision } : {}),
        action: definition.action,
        now: this.now().toISOString()
      });
      if (!decision.allowed || !decision.grant) {
        return this.auditWithoutOperation(definition, { status: "blocked", summary: decision.reason }, target);
      }
      authority = decision.grant;
    }
    const policy = await this.createPolicy(target);
    let confirmationToken = request.confirmationToken;
    if (definition.requiresConfirmation && confirmationToken) {
      // Check all non-confirmation policy conditions first. This avoids
      // burning a one-time confirmation for a gate/authority failure.
      const preliminary = policy.authorize({ definition, target, session, authority });
      if (preliminary.status !== "awaiting_confirmation") {
        return this.auditWithoutOperation(definition, { status: policyStatus(preliminary.status), summary: preliminary.reason }, target);
      }
      const consumed = await this.confirmations.consume({
        token: confirmationToken,
        action: definition.action,
        ...(target ? { targetSnapshotId: target.id } : {}),
        ...(session ? { sessionId: session.id } : {}),
        ...(authority ? { authorityId: authority.id } : {})
      });
      if (!consumed.allowed || !consumed.record) {
        return this.auditWithoutOperation(definition, { status: "blocked", summary: consumed.reason }, target);
      }
      // PolicyEngine remains a short-lived permit issuer. The durable ledger
      // has already atomically consumed the user-visible token; this ephemeral
      // record only carries the exact attestation into one dispatch call.
      confirmationToken = policy.createConfirmation({
        action: definition.action,
        ...(target ? { targetSnapshotId: target.id } : {}),
        ...(session ? { sessionId: session.id } : {}),
        ...(authority ? { authorityId: authority.id } : {}),
        reason: consumed.record.reason,
        reauthenticated: consumed.record.reauthenticated
      }).token;
    }
    const context: RuntimeDispatcherContext = {
      policy,
      sessions: this.sessions,
      authorities: this.authorities,
      operationCoordinator: this.operationCoordinator,
      receiptEvidence: this.options.receiptEvidence
    };
    const configured = this.options.dependencies?.(context) ?? { adapters: new AdapterRegistry() };
    const governance = new DurableRuntimeGovernance({
      budgets: this.budgets,
       checkpoints: this.checkpoints,
       checkpointCapture: this.options.checkpointCapture,
       checkpointVerifier: this.options.checkpointVerifier,
      policyVersion: this.options.policyVersion,
       revalidator: {
        revalidate: async ({ definition: candidate, target: expected, session: selectedSession }) => {
          const actual = await this.resolveTarget(candidate, selectedSession);
          if (!actual) return false;
          const recorded = await this.snapshots.record(actual);
          return recorded.completeness === "complete" && recorded.id === expected.id;
        }
       },
       controls: this.executionControls,
       operationControl: this.options.operationControl,
       operationCoordinator: this.operationCoordinator,
       now: this.now,
       deadlineScheduler: this.options.deadlineScheduler ?? systemDeadlineScheduler,
      ...(this.options.budgetConfiguration ? { budgetConfiguration: this.options.budgetConfiguration } : {})
    });
    const dispatcher = new CommandDispatcher({
      ...configured,
      policy,
      sessions: { get: (id) => id === session?.id ? session : undefined },
      authorities: { get: (id) => id === authority?.id ? authority : undefined },
      operations: this.operationCoordinator,
      governance,
      ...(this.options.receiptEvidence ? { receiptEvidence: this.options.receiptEvidence } : {})
    });
    // An arbitrary optional authority ID must not change a non-authority
    // command's context. For authority-bearing commands, only the ledger's
    // freshly evaluated grant is forwarded to the dispatcher.
    const { authorityId: _untrustedAuthorityId, confirmationToken: _untrustedConfirmationToken, ...withoutAuthorityReference } = request;
    const result = await dispatcher.dispatch({
      ...withoutAuthorityReference,
      ...(target ? { targetSnapshot: target } : {}),
      ...(authority ? { authorityId: authority.id } : {}),
      ...(confirmationToken ? { confirmationToken } : {})
    });
    return result.operationId ? result : this.auditWithoutOperation(definition, result, target);
  }

  /**
   * Explicit operator cancellation by durable operation ID. This records
   * cancellation intent first, tells only a configured operation controller,
   * and never guesses a process/PID or issues a shell kill command.
   */
  async cancelOperation(operationId: string, reason: string): Promise<CommandResult> {
    const claims = (await this.budgets.list()).filter((claim) => claim.operationId === operationId && ["claimed", "running", "cancelling", "timed_out"].includes(claim.state));
    if (claims.length === 0) return { status: "unavailable", summary: "No unresolved durable budget claim exists for this operation; no cancellation was sent.", operationId };
    try {
      for (const claim of claims) await this.budgets.requestCancellation(claim.id, reason);
    } catch {
      return { status: "unavailable", summary: "Cancellation intent could not be durably recorded; no cancellation was sent.", operationId };
    }
    try { await this.operationCoordinator.requestCancellation(operationId, reason); } catch {
      return { status: "unavailable", summary: "Budget cancellation intent was recorded, but the durable operation could not be marked cancelling; no host cancellation was sent.", operationId };
    }
    this.executionControls.request(operationId, reason);
    if (!this.options.operationControl) {
      return { status: "cancelling", summary: "Cancellation intent is durable, but no host operation-control adapter is configured; reconciliation is required and no process was guessed.", operationId };
    }
    try {
      const outcome = await this.options.operationControl.cancel({ operationId, reason });
      return {
        status: outcome.accepted ? "cancelling" : "unavailable",
        summary: outcome.summary,
        operationId
      };
    } catch {
      return { status: "cancelling", summary: "Cancellation intent is durable, but the host adapter did not confirm delivery; reconciliation is required.", operationId };
    }
  }

  /**
   * Finalizes a two-phase external host action without replaying it. The
   * operation/action/target binding comes from the protected journal, not the
   * bridge acknowledgement, and repeated identical completion is idempotent.
   */
  async completeExternalOperation(completion: ExternalOperationCompletion): Promise<CommandResult> {
    const operation = await this.operations.get(completion.operationId);
    if (!operation) return { status: "unavailable", summary: "The durable external operation is unavailable and was not fabricated.", operationId: completion.operationId };
    if (operation.action !== completion.action) return { status: "blocked", summary: "The external acknowledgement action does not match its durable operation.", operationId: operation.id };
    const targetSnapshotId = operation.targetSnapshotId.startsWith("<no-target:") ? undefined : operation.targetSnapshotId;
    if (completion.targetSnapshotId && completion.targetSnapshotId !== targetSnapshotId) {
      return { status: "blocked", summary: "The external acknowledgement target does not match its durable operation.", operationId: operation.id };
    }
    const lease = { operationId: operation.id, existing: false } as const;
    try {
      const recorded = await this.operationCoordinator.recordResult(lease, {
        action: completion.action,
        ...(targetSnapshotId ? { targetSnapshotId } : {}),
        status: completion.status,
        summary: completion.summary,
        ...(targetSnapshotId && completion.evidenceDigest && completion.toolVersions ? {
          policyVersion: this.options.policyVersion,
          evidenceDigest: completion.evidenceDigest,
          toolVersions: completion.toolVersions
        } : {})
      });
      return { status: completion.status, summary: completion.summary, operationId: operation.id, ...(recorded.receiptId ? { receiptId: recorded.receiptId } : {}) };
    } catch {
      return { status: "incomplete", summary: "The external effect was acknowledged, but its durable final result requires reconciliation.", operationId: operation.id };
    }
  }

  /**
   * Startup/recovery sweep observes expired work and asks an optional host
   * controller to probe it. It never replays a broker action.
   */
  async reconcileBudgetedOperations(): Promise<ReadonlyArray<Readonly<{ operationId: string; status: "timed_out" | "running" | "cancelling"; summary: string }>>> {
    await this.budgets.expireDue(this.now().toISOString());
    const active = (await this.budgets.list()).filter((claim) => ["running", "cancelling", "timed_out"].includes(claim.state));
    const seen = new Set<string>();
    const results: Array<Readonly<{ operationId: string; status: "timed_out" | "running" | "cancelling"; summary: string }>> = [];
    for (const claim of active) {
      if (seen.has(claim.operationId)) continue;
      seen.add(claim.operationId);
      const status = claim.state === "timed_out" ? "timed_out" : claim.state === "cancelling" ? "cancelling" : "running";
      if (claim.state === "timed_out") this.executionControls.request(claim.operationId, "Durable budget deadline elapsed.");
      if (!this.options.operationControl?.reconcile) {
        results.push({ operationId: claim.operationId, status, summary: "No host reconciliation probe is configured; operation remains unresolved and was not replayed." });
        continue;
      }
      try {
        const observed = await this.options.operationControl.reconcile(claim.operationId);
        results.push({ operationId: claim.operationId, status, summary: observed.summary });
      } catch {
        results.push({ operationId: claim.operationId, status, summary: "Host reconciliation probe failed; operation remains unresolved and was not replayed." });
      }
    }
    return results;
  }

  /** Recovery entry point for companion startup. It observes durable state and never replays a side effect. */
  async recoverAfterRestart(): Promise<Readonly<{ operations: readonly ReconciliationResult[]; budgets: ReadonlyArray<Readonly<{ operationId: string; status: "timed_out" | "running" | "cancelling"; summary: string }>> }>> {
    const operations = await this.recovery.recoverPending();
    const budgets = await this.reconcileBudgetedOperations();
    return { operations, budgets };
  }

  /**
   * Requests one protected, exact-scope confirmation token through a host UI
   * attestor. This method is deliberately separate from keyboard dispatch so
   * an input packet can never self-attest reauthentication.
   */
  async requestConfirmation(request: RuntimeConfirmationRequest): Promise<RuntimeConfirmationResult> {
    const definition = commandForAction(request.action);
    if (!definition.requiresConfirmation) return { status: "blocked", summary: `${definition.title} does not use a confirmation token.` };
    if (!this.options.confirmationAttestor) return { status: "unavailable", summary: "No trusted companion-UI reauthentication attestor is configured." };
    const session = request.sessionId ? await this.sessions.get(request.sessionId) : undefined;
    if (request.sessionId && !session) return { status: "unavailable", summary: "The selected session is absent from the protected registry." };
    let target: TargetSnapshot | undefined;
    if (definition.requiresTarget) {
      target = await this.resolveTarget(definition, session);
      if (!target) return { status: "unavailable", summary: "The trusted target resolver could not identify an exact workspace target." };
      try { target = await this.snapshots.record(target); } catch { return { status: "unavailable", summary: "The TargetSnapshot could not be durably recorded for confirmation." }; }
      if (definition.requiresCompleteTargetSnapshot && target.completeness !== "complete") {
        return { status: "incomplete", summary: "This confirmation requires a complete TargetSnapshot." };
      }
    }
    let authority: AuthorityGrant | undefined;
    if (definition.requiresAuthority) {
      const decision = await this.authorities.evaluate({
        authorityId: request.authorityId,
        repositoryRoot: target?.repositoryRoot ?? "<unresolved>",
        ...(session?.id ? { sessionId: session.id } : {}),
        ...(session?.taskId ? { taskId: session.taskId } : {}),
        ...(session?.planRevision ? { planRevision: session.planRevision } : {}),
        action: definition.action,
        now: this.now().toISOString()
      });
      if (!decision.allowed || !decision.grant) return { status: "blocked", summary: decision.reason };
      authority = decision.grant;
    }
    const policy = await this.createPolicy(target);
    const preliminary = policy.authorize({ definition, target, session, authority });
    if (preliminary.status !== "awaiting_confirmation") {
      return { status: policyStatus(preliminary.status), summary: preliminary.reason };
    }
    let attestation: Readonly<{ reauthenticated: boolean; operator: string }> | undefined;
    try {
      attestation = await this.options.confirmationAttestor.attest({ definition, ...(target ? { target } : {}), ...(session ? { session } : {}), ...(authority ? { authority } : {}), reason: request.reason });
    } catch {
      return { status: "unavailable", summary: "The companion-UI reauthentication ceremony could not be completed." };
    }
    if (!attestation?.reauthenticated || !attestation.operator.trim()) return { status: "blocked", summary: "The companion UI did not provide a current reauthentication attestation." };
    try {
      const issued = await this.confirmations.issue({
        action: definition.action,
        ...(target ? { targetSnapshotId: target.id } : {}),
        ...(session ? { sessionId: session.id } : {}),
        ...(authority ? { authorityId: authority.id } : {}),
        reason: `${request.reason} (attested by ${attestation.operator.trim()})`,
        reauthenticated: true
      });
      return { status: "issued", summary: "A protected one-time confirmation was issued for this exact action.", token: issued.token, expiresAt: issued.record.expiresAt };
    } catch {
      return { status: "unavailable", summary: "The confirmation could not be durably recorded; no token was issued." };
    }
  }

  private async resolveTarget(definition: CommandDefinition, session: ManagedSession | undefined): Promise<TargetSnapshot | undefined> {
    try {
      return await this.options.targetResolver.resolve({ definition, session });
    } catch {
      return undefined;
    }
  }

  private async createPolicy(target: TargetSnapshot | undefined): Promise<PolicyEngine> {
    return new PolicyEngine({
      version: this.options.policyVersion,
      gateEvidence: await this.gateEvidence.policyEvidence(target?.id, this.now().toISOString()),
      highConsequenceActions: this.options.enabledHighConsequenceActions ?? [],
      requireReauthenticationForHighConsequence: true,
      now: this.now
    });
  }

  /** Policy-denied/no-target intents are still tamper-evident audit events, without allocating an executable operation. */
  private async auditWithoutOperation(definition: CommandDefinition, result: CommandResult, target?: TargetSnapshot): Promise<CommandResult> {
    try {
      await this.receipts.audit({
        action: definition.action,
        status: result.status,
        ...(target ? { targetSnapshotId: target.id } : {}),
        detail: result.summary
      });
      return result;
    } catch {
      return { status: "unavailable", summary: "The companion could not durably record this denied or unavailable request; no action was started." };
    }
  }
}

function policyStatus(status: "allowed" | "awaiting_confirmation" | "blocked" | "unavailable" | "incomplete"): "blocked" | "unavailable" | "incomplete" {
  if (status === "incomplete") return "incomplete";
  if (status === "unavailable") return "unavailable";
  return "blocked";
}

const budgetedExecutors = new Set<CommandDefinition["executor"]>(["agent", "git", "execution", "test_environment", "security", "isolation", "council", "automation", "containment"]);

function budgetRequired(definition: CommandDefinition): boolean {
  // Plan approval can hand a mutable plan to a controlled agent even though it
  // routes through the agent adapter rather than a process broker.
  return budgetedExecutors.has(definition.executor) || definition.action === "plan_approval";
}

function checkpointWorkflow(definition: CommandDefinition): CheckpointWorkflow | undefined {
  switch (definition.action) {
    case "local_commit":
    case "pr_upsert":
    case "pr_merge":
    case "direct_main":
      return "consequential_git";
    case "rebuild_venv":
    case "full_sandbox":
    case "rebuild_full_sandbox":
    case "quarantine":
      return "environment_rebuild";
    case "council_automatic":
      return "council_repartition";
    case "repair_mission":
      return "repair_mission";
    case "plan_approval":
    case "compound_capture":
    case "compound_refresh":
    case "lfg":
      return "risky_mutation";
    default:
      return undefined;
  }
}

const conservativeBudget: CommandBudget = {
  maxConcurrent: 1,
  timeoutMs: 5 * 60_000,
  maxAttempts: 1,
  windowMs: 24 * 60 * 60_000,
  maxClaimsPerWindow: 4,
  maxCostUnitsPerWindow: 4,
  defaultCostUnits: 1
};

function defaultBudgetConfiguration(policyVersion: string): BudgetConfiguration {
  const commandClasses: Record<string, CommandBudget> = {};
  for (const action of commandActionIds) {
    const definition = commandForAction(action);
    if (budgetRequired(definition)) commandClasses[action] = { ...conservativeBudget };
  }
  return { version: `b122-local-budget-v1:${policyVersion}`, commandClasses };
}

interface DurableRuntimeGovernanceOptions {
  readonly budgets: DurableBudgetManager;
  readonly checkpoints: CheckpointLedger;
  readonly checkpointCapture?: CheckpointCaptureAdapter;
  readonly checkpointVerifier?: RecoveryArtifactVerifier;
  readonly revalidator: TargetSnapshotRevalidator;
  readonly policyVersion: string;
  readonly budgetConfiguration?: BudgetConfiguration;
  readonly controls: ExecutionControlRegistry;
  readonly operationControl?: OperationControlAdapter;
  readonly operationCoordinator: DurableOperationCoordinator;
  readonly now: () => Date;
  readonly deadlineScheduler: DeadlineScheduler;
}

/**
 * Bridges the generic dispatch seam to durable B122 state. The broker is not
 * called until the required checkpoint is bound to this operation and an
 * explicit command-class budget is running. Any write ambiguity remains
 * visible as `running` so the operation saga cannot be replayed blindly.
 */
class DurableRuntimeGovernance implements DispatchGovernance {
  private readonly options: DurableRuntimeGovernanceOptions;
  private configurationReady?: Promise<void>;
  private readonly timers = new Map<string, DeadlineSchedule>();

  constructor(options: DurableRuntimeGovernanceOptions) {
    this.options = options;
  }

  async admit(input: DispatchGovernanceRequest): Promise<DispatchGovernanceAdmission> {
    let effectGuard: EffectGuard | undefined;
    const workflow = checkpointWorkflow(input.definition);
    if (workflow) {
      if (!input.target) return { allowed: false, status: "unavailable", summary: "This risky workflow needs a durably recorded exact TargetSnapshot before a checkpoint can be captured." };
      if (!this.options.checkpointCapture) return { allowed: false, status: "unavailable", summary: "This risky workflow has no trusted checkpoint-capture adapter; no broker was called." };
      try {
        const captured = await this.options.checkpointCapture.capture({
          definition: input.definition,
          operationId: input.operationId,
          workflow,
          target: input.target,
          ...(input.session ? { session: input.session } : {})
        });
        if (!captured) return { allowed: false, status: "unavailable", summary: "The checkpoint-capture adapter did not produce immutable recovery artifacts; no broker was called." };
        const checkpoint = await this.options.checkpoints.create({
          repositoryRoot: input.target.repositoryRoot,
          targetSnapshotId: input.target.id,
          operationId: input.operationId,
          workflow,
          reason: captured.reason,
          artifacts: captured.artifacts,
          recovery: captured.recovery
        });
        await this.options.checkpoints.assertUsable(checkpoint.id, {
          repositoryRoot: input.target.repositoryRoot,
          targetSnapshotId: input.target.id,
          workflow,
          operationId: input.operationId
        });
        if (!this.options.checkpointVerifier) {
          return { allowed: false, status: "unavailable", summary: "The required checkpoint has no read-only artifact verifier; no broker was called." };
        }
        const artifacts = await this.options.checkpoints.verifyArtifacts(checkpoint.id, this.options.checkpointVerifier);
        if (artifacts.length === 0 || artifacts.some((artifact) => artifact.status !== "verified")) {
          return { allowed: false, status: "unavailable", summary: "The required checkpoint artifacts are missing, mismatched, or unavailable; no broker was called." };
        }
      } catch {
        return { allowed: false, status: "unavailable", summary: "The required checkpoint could not be durably captured and verified; no broker was called." };
      }
    }

    if (input.definition.requiresCompleteTargetSnapshot) {
      if (!input.target) return { allowed: false, status: "incomplete", summary: "This consequential workflow has no exact TargetSnapshot to revalidate immediately before broker dispatch." };
      try {
        if (!await this.options.revalidator.revalidate({ definition: input.definition, target: input.target, ...(input.session ? { session: input.session } : {}) })) {
          return { allowed: false, status: "incomplete", summary: "The TargetSnapshot changed, became incomplete, or could not be revalidated immediately before broker dispatch." };
        }
        const expectedDefinition = input.definition;
        const expectedTarget = input.target;
        const expectedSessionId = input.session?.id;
        effectGuard = {
          assertCurrent: async (effect) => {
            if (effect.action !== expectedDefinition.action || effect.target.id !== expectedTarget.id || effect.session?.id !== expectedSessionId) {
              return { allowed: false, reason: "The broker effect does not match its admitted command, target, or selected session." };
            }
            try {
              const current = await this.options.revalidator.revalidate({
                definition: expectedDefinition,
                target: expectedTarget,
                ...(input.session ? { session: input.session } : {})
              });
              return current
                ? { allowed: true, reason: "TargetSnapshot remains current immediately before the broker effect." }
                : { allowed: false, reason: "The TargetSnapshot changed after admission; the broker effect was not started." };
            } catch {
              return { allowed: false, reason: "The TargetSnapshot could not be revalidated immediately before the broker effect." };
            }
          }
        };
      } catch {
        return { allowed: false, status: "unavailable", summary: "The TargetSnapshot could not be revalidated immediately before broker dispatch; no broker was called." };
      }
    }

    if (!budgetRequired(input.definition)) return { allowed: true, summary: "This typed local route does not start a budgeted broker class.", ...(effectGuard ? { effectGuard } : {}) };
    try {
      await this.ensureBudgetConfiguration();
      const claim = await this.options.budgets.claim({
        operationId: input.operationId,
        commandClass: input.definition.action,
        ...(input.session ? { requestedBy: input.session.id } : {})
      });
      if (!claim.allowed || !claim.claim) return { allowed: false, status: "blocked", summary: `Budget admission denied: ${claim.reason}` };
      const started = await this.options.budgets.start(claim.claim.id);
      if (!started.allowed) {
        await this.options.budgets.requestCancellation(claim.claim.id, "Budget start was denied before broker invocation.");
        return { allowed: false, status: "unavailable", summary: `Budget start was not durable; no broker was called: ${started.reason}` };
      }
      const liveClaim = started.claim!;
      const executionControl = this.options.controls.bind(input.operationId, liveClaim.expiresAt, liveClaim.id);
      this.scheduleDeadline(input.operationId, liveClaim.id, liveClaim.expiresAt);
      return { allowed: true, summary: "Durable budget claim admitted before broker dispatch.", token: liveClaim.id, executionControl, ...(effectGuard ? { effectGuard } : {}) };
    } catch {
      return { allowed: false, status: "unavailable", summary: "The budget ledger is unavailable or invalid; no broker was called." };
    }
  }

  async observeResult(input: DispatchGovernanceRequest, admission: DispatchGovernanceAdmission, result: CommandResult): Promise<CommandResult | undefined> {
    if (!admission.token) return undefined;
    if (["running", "queued", "cancelling"].includes(result.status)) return undefined;
    try {
      if (["awaiting_input", "awaiting_confirmation"].includes(result.status)) {
        const cancellation = await this.options.budgets.requestCancellation(admission.token, "No broker action was started while the companion awaits operator input.");
        if (!cancellation.allowed) return this.ambiguous(result.operationId);
        const settled = await this.options.budgets.settle(admission.token, "cancelled", "No broker action was started.");
        if (settled.allowed) this.releaseControl(input.operationId, admission.token);
        return settled.allowed ? undefined : this.ambiguous(result.operationId);
      }
      const outcome = result.status === "completed" ? "completed" : result.status === "cancelled" ? "cancelled" : "failed";
      const settled = await this.options.budgets.settle(admission.token, outcome, result.summary);
      if (settled.allowed) this.releaseControl(input.operationId, admission.token);
      return settled.allowed ? undefined : this.ambiguous(result.operationId);
    } catch {
      return this.ambiguous(result.operationId);
    }
  }

  private scheduleDeadline(operationId: string, claimId: string, expiresAt: string): void {
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now());
    const timer = this.options.deadlineScheduler.schedule(delay, () => {
      void this.handleDeadline(operationId, claimId);
    });
    this.timers.set(claimId, timer);
  }

  private async handleDeadline(operationId: string, claimId: string): Promise<void> {
    this.options.controls.request(operationId, "Durable budget deadline elapsed.");
    try { await this.options.budgets.expireDue(this.options.now().toISOString()); } catch { return; }
    try { await this.options.operationCoordinator.requestCancellation(operationId, "Durable budget deadline elapsed."); } catch { return; }
    if (!this.options.operationControl) return;
    try { await this.options.operationControl.cancel({ operationId, reason: "Durable budget deadline elapsed." }); } catch { /* durable timeout remains for reconciliation */ }
    void claimId;
  }

  private releaseControl(operationId: string, claimId: string): void {
    const timer = this.timers.get(claimId);
    timer?.cancel();
    this.timers.delete(claimId);
    this.options.controls.release(operationId);
  }

  private ambiguous(operationId: string | undefined): CommandResult {
    return {
      status: "running",
      summary: "The adapter result could not be durably reconciled with its budget claim; no retry will run until an operator resolves it.",
      ...(operationId ? { operationId } : {})
    };
  }

  private async ensureBudgetConfiguration(): Promise<void> {
    if (!this.configurationReady) {
      this.configurationReady = (async () => {
        if (this.options.budgetConfiguration) {
          await this.options.budgets.configure(this.options.budgetConfiguration);
          return;
        }
        const existing = await this.options.budgets.configuration();
        if (!existing) await this.options.budgets.configure(defaultBudgetConfiguration(this.options.policyVersion));
      })();
    }
    await this.configurationReady;
  }
}
