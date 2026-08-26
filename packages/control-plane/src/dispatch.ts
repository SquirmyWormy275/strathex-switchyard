import { randomUUID } from "node:crypto";
import type { AdapterRegistry, AdapterOutcome } from "./adapters.ts";
import type {
  AutomationRequest,
  BrokerOutcome,
  AutomationBroker,
  ExecutionBroker,
  ExecutionRecipe,
  GitBroker,
  GitMutation,
  IsolationRuntime,
  TestEnvironment,
  TestEnvironmentOutcome,
  TestEnvironmentBroker,
  EffectGuard
} from "./brokers.ts";
import { commandFor, commandForAction, type CommandAction, type CommandDefinition } from "./command-catalog.ts";
import type { ContainmentActivation, ContainmentRecord, ContainmentReleaseRequest, ContainmentReleaseResult, IncidentStatus } from "./containment.ts";
import type { AuthorityGrant, CommandRequest, CommandResult, CommandStatus, EffectDisposition, ManagedSession, TargetSnapshot } from "./contracts.ts";
import type { ChildOperationLease, ChildOperationSaga } from "./operations.ts";
import type { CouncilRecommendation } from "./council.ts";
import { PolicyEngine, type PolicyDecision, type PolicyPermit } from "./policy.ts";
import { untrustedSummary } from "./redaction.ts";
import type { ExecutionControl } from "./execution-control.ts";
import type { RepositoryRecipe } from "./recipes.ts";
import { sha256 } from "./store.ts";

export interface SessionLookup { get(id: string): ManagedSession | undefined; }
export interface AuthorityLookup { get(id: string): AuthorityGrant | undefined; }
/** Host-runtime context that cannot be supplied through the public command payload. */
export interface TrustedDispatchContext { readonly confirmationDigest?: string; readonly confirmationScopeDigest?: string; }
export interface ExecutionRecipeFactory {
  /** Must resolve a companion-approved declarative recipe, never raw request input. */
  create(definition: CommandDefinition, target: TargetSnapshot): ExecutionRecipe | undefined;
}
export interface GitMutationFactory {
  /** Must return a typed, companion-UI-reviewed mutation; dispatcher never parses `CommandRequest.input`. */
  create(definition: CommandDefinition, target: TargetSnapshot, session?: ManagedSession): GitMutation | undefined;
}
export interface RepositoryRecipeLookup { forTarget(target: TargetSnapshot): RepositoryRecipe | undefined; }
export interface CouncilExecutor {
  execute(request: Readonly<{ action: "council_report" | "council_automatic" | "council_recommend"; operationId: string; target: TargetSnapshot; session?: ManagedSession; authority?: AuthorityGrant; permit: PolicyPermit; executionControl?: ExecutionControl; effectGuard?: EffectGuard; childSaga?: ChildOperationSaga }>): Promise<BrokerOutcome>;
  approveRecommendation?(request: Readonly<{
    recommendationId: string;
    recommendationDigest: string;
    approvalOperationId: string;
    target: TargetSnapshot;
    session?: ManagedSession;
  }>): Promise<CouncilRecommendation>;
}
type MaybePromise<T> = T | Promise<T>;
/** Both the in-memory harness and ProtectedJsonStore implementation satisfy this boundary. */
export interface ContainmentManager {
  activate(request: ContainmentActivation): MaybePromise<ContainmentRecord>;
  check(repositoryRoot: string, channel: "git" | "credential" | "network" | "deployment" | "execution" | "test_environment" | "automation" | "isolation" | "council" | "adapter" | "local_remediation"): MaybePromise<{ readonly allowed: boolean; readonly reason: string }>;
  release(request: ContainmentReleaseRequest): MaybePromise<ContainmentReleaseResult>;
}

export interface CommandOperationLease {
  readonly operationId: string;
  readonly existing: boolean;
  readonly existingStatus?: CommandStatus;
}
export interface CommandOperationCoordinator {
  claim(input: Readonly<{ action: CommandAction; targetSnapshotId?: string; sessionId?: string }>): Promise<CommandOperationLease>;
  settle(lease: CommandOperationLease, status: CommandStatus): Promise<void>;
}

/** Optional durable lifecycle used by OperationSagaStore-backed coordinators. */
export interface DurableDispatchLifecycle extends CommandOperationCoordinator {
  markExecuting(lease: CommandOperationLease): Promise<void>;
  recordResult(lease: CommandOperationLease, result: Readonly<{
    action: string;
    targetSnapshotId?: string;
    authorityId?: string;
    status: CommandStatus;
    summary: string;
    effectDisposition?: EffectDisposition;
    policyVersion?: string;
    evidenceDigest?: string;
    toolVersions?: Readonly<Record<string, string>>;
    expiresAt?: string;
  }>): Promise<Readonly<{ receiptId?: string }>>;
}

/** A receipt is issued only when a trusted evidence producer provides all fields. */
export interface DispatchReceiptEvidence {
  readonly policyVersion: string;
  readonly evidenceDigest: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly expiresAt?: string;
}
export interface DispatchReceiptEvidenceFactory {
  forResult(definition: CommandDefinition, result: CommandResult, target: TargetSnapshot | undefined): DispatchReceiptEvidence | undefined;
}

/**
 * A host-owned admission and result-observation seam for durable controls
 * such as checkpoints, budgets, cancellation, and provider reconciliation.
 * It receives typed catalog state only; raw keyboard input remains data.
 */
export interface DispatchGovernanceRequest {
  readonly definition: CommandDefinition;
  readonly request: CommandRequest;
  readonly operationId: string;
  readonly target?: TargetSnapshot;
  readonly session?: ManagedSession;
  readonly authority?: AuthorityGrant;
}

export interface DispatchGovernanceAdmission {
  readonly allowed: boolean;
  /** A governance failure must never be converted into an execution attempt. */
  readonly status?: "blocked" | "unavailable" | "incomplete";
  readonly summary: string;
  /** Opaque durable state, owned only by the governance implementation. */
  readonly token?: string;
  /** Bound deadline/cancel signal passed only to a registered adapter/broker. */
  readonly executionControl?: ExecutionControl;
  /** Rechecked by every broker/adapter immediately before its own effect. */
  readonly effectGuard?: EffectGuard;
}

export interface DispatchGovernance {
  admit(input: DispatchGovernanceRequest): Promise<DispatchGovernanceAdmission>;
  /**
   * Observe a result after the adapter returns. A governance implementation
   * can retain an ambiguous action as `running` for reconciliation instead of
   * allowing a blind retry after its own durable write fails.
   */
  observeResult(input: DispatchGovernanceRequest, admission: DispatchGovernanceAdmission, result: CommandResult): Promise<CommandResult | undefined>;
}

/** Lightweight bridge until the protected OperationSagaStore is attached by the host. */
export class InMemoryCommandOperationCoordinator implements CommandOperationCoordinator {
  private readonly active = new Map<string, CommandOperationLease>();

  async claim(input: Readonly<{ action: CommandAction; targetSnapshotId?: string; sessionId?: string }>): Promise<CommandOperationLease> {
    const key = `${input.action}:${input.targetSnapshotId ?? "none"}:${input.sessionId ?? "none"}`;
    const previous = this.active.get(key);
    if (previous) return { ...previous, existing: true, existingStatus: "running" };
    const lease: CommandOperationLease = { operationId: `op-${randomUUID()}`, existing: false };
    this.active.set(key, lease);
    return lease;
  }

  async settle(lease: CommandOperationLease, status: CommandStatus): Promise<void> {
    if (["queued", "running", "awaiting_input", "awaiting_confirmation", "cancelling"].includes(status)) return;
    for (const [key, active] of this.active) if (active.operationId === lease.operationId) this.active.delete(key);
  }
}

export interface CommandDispatcherDependencies {
  readonly policy: PolicyEngine;
  readonly sessions?: SessionLookup;
  readonly authorities?: AuthorityLookup;
  readonly adapters?: AdapterRegistry;
  readonly execution?: ExecutionBroker;
  readonly git?: GitBroker;
  readonly testEnvironment?: TestEnvironmentBroker;
  readonly automation?: AutomationBroker;
  readonly isolation?: IsolationRuntime;
  readonly containment?: ContainmentManager;
  readonly council?: CouncilExecutor;
  readonly recipes?: RepositoryRecipeLookup;
  readonly executionRecipeFactory?: ExecutionRecipeFactory;
  readonly gitMutationFactory?: GitMutationFactory;
  readonly operations?: CommandOperationCoordinator;
  readonly receiptEvidence?: DispatchReceiptEvidenceFactory;
  readonly governance?: DispatchGovernance;
}

export interface ContainmentReleaseCommandRequest {
  readonly targetSnapshot: TargetSnapshot;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly confirmationToken: string;
  /** Obtained only from the companion-UI incident-review and reauth flow. */
  readonly review: Readonly<{
    reauthenticated: boolean;
    reason: string;
    incidentStatus: IncidentStatus;
    expectedFenceEpoch: number;
    expectedActivationOperationId: string;
  }>;
}

/**
 * CommandDispatcher is the sole command/chord dispatch point. It maps a
 * canonical protocol assignment to a catalog entry, applies policy, mints a
 * short-lived broker permit, and then delegates only to an explicit adapter.
 * It never interprets raw input as a shell command, target, authority, or
 * mutation payload.
 */
export class CommandDispatcher {
  private readonly operations: CommandOperationCoordinator;
  private readonly dependencies: CommandDispatcherDependencies;

  constructor(dependencies: CommandDispatcherDependencies) {
    this.dependencies = dependencies;
    this.operations = dependencies.operations ?? new InMemoryCommandOperationCoordinator();
  }

  async dispatch(request: CommandRequest, trusted: TrustedDispatchContext = {}): Promise<CommandResult> {
    const definition = commandFor(request.control, request.modifier);
    if (!definition || definition.assignment !== request.assignment) {
      return { status: "blocked", summary: "Command assignment mismatch or intentionally unassigned chord; no action was routed." };
    }
    const context = this.resolveContext(definition, request);
    if (context.error) return context.error;
    // Check static policy before allocating a durable generation, but mint the
    // one-use permit only after the operation ID exists. A permit is therefore
    // inseparable from exactly one saga.
    const preliminary = this.dependencies.policy.authorize({
      definition,
      target: request.targetSnapshot,
      session: context.session,
      authority: context.authority,
      confirmationToken: request.confirmationToken,
      untrustedInput: request.input
    });
    if (preliminary.status !== "allowed") return policyResult(preliminary);

    const lease = await this.operations.claim({ action: definition.action, targetSnapshotId: request.targetSnapshot?.id, sessionId: context.session?.id });
    if (lease.existing) {
      return { status: lease.existingStatus ?? "running", summary: "An identical operation is already active; focused its current status.", operationId: lease.operationId };
    }
    const lifecycle = durableLifecycle(this.operations);
    const permission = this.dependencies.policy.issuePermit({
      definition,
      operationId: lease.operationId,
      target: request.targetSnapshot,
      session: context.session,
      authority: context.authority,
      confirmationToken: request.confirmationToken,
      untrustedInput: request.input
    });
    if (permission.status !== "allowed" || !permission.permit) {
      const result = { ...policyResult(permission), operationId: lease.operationId };
      try {
        await this.recordLifecycle(lifecycle, lease, definition, result, request.targetSnapshot, context.authority);
        await this.operations.settle(lease, result.status);
      } catch {
        return { status: "unavailable", summary: "The refused command could not be durably recorded; no action was started.", operationId: lease.operationId };
      }
      return result;
    }
    const governanceRequest: DispatchGovernanceRequest = {
      definition,
      request,
      operationId: lease.operationId,
      ...(request.targetSnapshot ? { target: request.targetSnapshot } : {}),
      ...(context.session ? { session: context.session } : {}),
      ...(context.authority ? { authority: context.authority } : {})
    };
    let governanceAdmission: DispatchGovernanceAdmission | undefined;
    let result: CommandResult;
    try {
      governanceAdmission = this.dependencies.governance
        ? await this.dependencies.governance.admit(governanceRequest)
        : { allowed: true, summary: "No additional dispatch governance is configured." };
      if (!governanceAdmission.allowed) {
        result = {
          status: governanceAdmission.status ?? "unavailable",
          summary: governanceAdmission.summary,
          operationId: lease.operationId
        };
      } else {
        await lifecycle?.markExecuting(lease);
        result = await this.execute(definition, request, context.session, context.authority, permission.permit, lease, governanceAdmission.executionControl, governanceAdmission.effectGuard, trusted.confirmationDigest, trusted.confirmationScopeDigest);
      }
    } catch (error) {
      const label = governanceAdmission ? "Command adapter" : "Dispatch governance";
      result = { status: governanceAdmission ? "failed" : "unavailable", summary: `${label} failed safely: ${untrustedSummary(String(error))}`, operationId: lease.operationId };
    } finally {
      this.dependencies.policy.releasePermit(permission.permit);
    }
    try {
      if (governanceAdmission?.allowed && this.dependencies.governance) {
        try {
          const governed = await this.dependencies.governance.observeResult(governanceRequest, governanceAdmission, result);
          if (governed) result = { ...governed, operationId: lease.operationId };
        } catch (error) {
          // The broker may already have accepted the action. Keep this durable
          // operation active for a reconciler rather than declaring it failed
          // and enabling a repeated key press to start an unsafe replay.
          result = {
            status: "running",
            summary: `Post-execution governance could not be durably recorded; reconciliation is required before retry: ${untrustedSummary(String(error))}`,
            operationId: lease.operationId
          };
        }
      }
      const recorded = await this.recordLifecycle(lifecycle, lease, definition, result, request.targetSnapshot, context.authority);
      if (recorded.receiptId) result = { ...result, receiptId: recorded.receiptId };
      await this.operations.settle(lease, result.status);
    } catch (error) {
      // A broker result may be externally committed while protected recording
      // fails. Preserve the durable saga for reconciliation; do not retry.
      return {
        status: "failed",
        summary: `The action result could not be durably recorded; reconciliation is required before retry: ${untrustedSummary(String(error))}`,
        operationId: lease.operationId
      };
    }
    return result;
  }

  /** Containment release has no chord. It is companion-UI/re-auth only. */
  async dispatchContainmentRelease(request: ContainmentReleaseCommandRequest): Promise<CommandResult> {
    const definition = commandForAction("containment_release");
    const session = this.dependencies.sessions?.get(request.sessionId);
    const authority = this.dependencies.authorities?.get(request.authorityId);
    if (!session) return { status: "unavailable", summary: "Containment release requires a verified selected session." };
    if (!authority) return { status: "blocked", summary: "Containment release requires a current authority grant." };
    const preliminary = this.dependencies.policy.authorize({ definition, target: request.targetSnapshot, session, authority, confirmationToken: request.confirmationToken });
    if (preliminary.status !== "allowed") return policyResult(preliminary);
    const lease = await this.operations.claim({ action: definition.action, targetSnapshotId: request.targetSnapshot.id, sessionId: session.id });
    if (lease.existing) return { status: lease.existingStatus ?? "running", summary: "An identical containment-release operation is already active; focused its current status.", operationId: lease.operationId };
    const lifecycle = durableLifecycle(this.operations);
    const permission = this.dependencies.policy.issuePermit({ definition, operationId: lease.operationId, target: request.targetSnapshot, session, authority, confirmationToken: request.confirmationToken });
    if (permission.status !== "allowed" || !permission.permit) {
      const result = { ...policyResult(permission), operationId: lease.operationId };
      try {
        await this.recordLifecycle(lifecycle, lease, definition, result, request.targetSnapshot, authority);
        await this.operations.settle(lease, result.status);
      } catch {
        return { status: "unavailable", summary: "The refused containment-release command could not be durably recorded; no action was started.", operationId: lease.operationId };
      }
      return result;
    }
    let result: CommandResult;
    try {
      await lifecycle?.markExecuting(lease);
      if (!this.dependencies.containment) {
        result = { status: "unavailable", summary: "No durable containment manager is configured.", operationId: lease.operationId };
      } else {
        const release = await this.dependencies.containment.release({ repositoryRoot: request.targetSnapshot.repositoryRoot, ...request.review });
        result = { status: release.status === "released" ? "completed" : release.status, summary: release.reason, operationId: lease.operationId };
      }
    } catch (error) {
      result = { status: "failed", summary: `Containment release adapter failed safely: ${untrustedSummary(String(error))}`, operationId: lease.operationId };
    } finally {
      this.dependencies.policy.releasePermit(permission.permit);
    }
    try {
      const recorded = await this.recordLifecycle(lifecycle, lease, definition, result!, request.targetSnapshot, authority);
      if (recorded.receiptId) result = { ...result!, receiptId: recorded.receiptId };
      await this.operations.settle(lease, result!.status);
    } catch (error) {
      return { status: "failed", summary: `Containment release result needs durable reconciliation: ${untrustedSummary(String(error))}`, operationId: lease.operationId };
    }
    return result!;
  }

  private resolveContext(definition: CommandDefinition, request: CommandRequest): { session?: ManagedSession; authority?: AuthorityGrant; error?: CommandResult } {
    const session = request.sessionId ? this.dependencies.sessions?.get(request.sessionId) : undefined;
    if (request.sessionId && !session) return { error: { status: "unavailable", summary: "Selected session is not registered; companion will not guess a replacement." } };
    const authority = request.authorityId ? this.dependencies.authorities?.get(request.authorityId) : undefined;
    if (request.authorityId && !authority) return { error: { status: "blocked", summary: "Requested authority grant is unavailable or untrusted." } };
    // Policy evaluates missing session/authority requirements after this lookup.
    void definition;
    return { session, authority };
  }

  private async execute(definition: CommandDefinition, request: CommandRequest, session: ManagedSession | undefined, authority: AuthorityGrant | undefined, permit: PolicyPermit, lease: CommandOperationLease, executionControl?: ExecutionControl, effectGuard?: EffectGuard, trustedConfirmationDigest?: string, trustedConfirmationScopeDigest?: string): Promise<CommandResult> {
    const operationId = lease.operationId;
    const target = request.targetSnapshot;
    const confirmation = definition.requiresConfirmation && request.confirmationToken ? {
      currentUserConfirmed: true as const,
      confirmationDigest: trustedConfirmationDigest ?? sha256(request.confirmationToken),
      ...(trustedConfirmationScopeDigest ? { confirmationScopeDigest: trustedConfirmationScopeDigest } : {}),
      action: definition.action,
      ...(target ? { targetSnapshotId: target.id } : {}),
      ...(session ? { sessionId: session.id } : {}),
      ...(authority ? { authorityId: authority.id } : {})
    } : undefined;
    const base = target ? { action: definition.action, operationId, target, session, authority, permit, ...(confirmation ? { confirmation } : {}), ...(executionControl ? { executionControl } : {}), ...(effectGuard ? { effectGuard } : {}) } : undefined;
    switch (definition.executor) {
      case "adapter":
        return adapterResult(
          this.dependencies.adapters
            ? await this.dependencies.adapters.execute({ definition, operationId, target, session, authority, ...(confirmation ? { confirmation } : {}), ...(executionControl ? { executionControl } : {}), ...(effectGuard ? { effectGuard } : {}), untrustedInput: request.input })
            : { status: "unavailable", summary: "No verified adapter is registered for this command.", effectDisposition: "not_started" },
          operationId
        );
      case "agent":
        return this.executeComposite(definition, lease, async (childSaga) => adapterResult(
          this.dependencies.adapters
            ? await this.dependencies.adapters.execute({ definition, operationId, target, session, authority, ...(confirmation ? { confirmation } : {}), ...(executionControl ? { executionControl } : {}), ...(effectGuard ? { effectGuard } : {}), ...(childSaga ? { childSaga } : {}), untrustedInput: request.input })
            : { status: "unavailable", summary: "No verified agent adapter is registered for this command.", effectDisposition: "not_started" },
          operationId
        ));
      case "git": {
        if (!base) return unavailable("Git mediation requires a verified target.", operationId);
        if (!this.dependencies.git) return unavailable("No Git broker is configured.", operationId);
        const mutation = this.dependencies.gitMutationFactory?.create(definition, base.target, session);
        if (!mutation) return { status: "awaiting_input", summary: "A trusted companion-UI mutation review is required before Git mediation.", operationId };
        return this.executeComposite(definition, lease, async (childSaga) =>
          brokerResult(await this.dependencies.git!.execute({ ...base, mutation, ...(childSaga ? { childSaga } : {}) }), operationId)
        );
      }
      case "execution": {
        if (!base) return unavailable("Execution requires a verified target.", operationId);
        return this.executeRecipe(definition, base, operationId);
      }
      case "test_environment":
      case "security": {
        if (!base) return unavailable("Brokered validation requires a verified target.", operationId);
        const environment = await this.prepareTestEnvironment(base, operationId);
        if (environment.result) return environment.result;
        return this.executeRecipe(definition, base, operationId, environment.environment);
      }
      case "automation": {
        if (!base) return unavailable("Automation requires a verified target.", operationId);
        if (!this.dependencies.automation) return unavailable("No trusted automation broker is configured; no prompt or workflow was submitted.", operationId);
        let testEnvironment: TestEnvironment | undefined;
        if (definition.action === "repair_mission") {
          const environment = await this.prepareTestEnvironment(base, operationId);
          if (environment.result) return environment.result;
          testEnvironment = environment.environment;
        }
        return this.executeComposite(definition, lease, async (childSaga) => {
          const requestForBroker: AutomationRequest = { ...base, testEnvironment, ...(childSaga ? { childSaga } : {}) };
          return brokerResult(await this.dependencies.automation!.execute(requestForBroker), operationId);
        });
      }
      case "isolation": {
        if (!base) return unavailable("Isolation requires a verified target.", operationId);
        if (!this.dependencies.isolation) return unavailable("No proven isolation runtime is configured.", operationId);
        const profile = definition.action === "full_sandbox" ? "full_sandbox" : definition.action === "rebuild_full_sandbox" ? "rebuild_full_sandbox" : "quarantine";
        return brokerResult(await this.dependencies.isolation.start({ ...base, profile }), operationId);
      }
      case "council": {
        if (!base) return unavailable("Council requires a verified target.", operationId);
        if (!this.dependencies.council) return unavailable("No verified Council coordinator is configured; automatic coordination remains unavailable.", operationId);
        const fence = this.dependencies.containment ? await this.dependencies.containment.check(base.target.repositoryRoot, "council") : undefined;
        if (fence && !fence.allowed) return { status: "blocked", summary: fence.reason, operationId };
        const action = definition.action;
        if (action !== "council_report" && action !== "council_automatic" && action !== "council_recommend") return unavailable("Unknown Council command.", operationId);
        return this.executeComposite(definition, lease, async (childSaga) =>
          brokerResult(await this.dependencies.council!.execute({ action, operationId, target: base.target, session, authority, permit, ...(executionControl ? { executionControl } : {}), ...(effectGuard ? { effectGuard } : {}), ...(childSaga ? { childSaga } : {}) }), operationId)
        );
      }
      case "containment": {
        if (!base) return unavailable("Containment requires a verified target.", operationId);
        if (!this.dependencies.containment) return unavailable("No durable containment manager is configured.", operationId);
        const record = await this.dependencies.containment.activate({ repositoryRoot: base.target.repositoryRoot, operationId, reason: "Emergency Containment requested through authenticated B122 policy." });
        return { status: "completed", summary: `Containment fence ${record.fenceEpoch} is active for brokered egress; unmediated paths remain disclosed as uncontrolled.`, operationId, data: { fenceEpoch: record.fenceEpoch } };
      }
    }
  }

  private async executeRecipe(definition: CommandDefinition, base: Readonly<{ action: CommandAction; operationId: string; target: TargetSnapshot; session?: ManagedSession; authority?: AuthorityGrant; permit: PolicyPermit; executionControl?: ExecutionControl; effectGuard?: EffectGuard }>, operationId: string, testEnvironment?: TestEnvironment): Promise<CommandResult> {
    if (!this.dependencies.execution) return unavailable("No execution broker is configured.", operationId);
    const recipe = this.dependencies.executionRecipeFactory?.create(definition, base.target);
    if (!recipe) return unavailable("No approved declarative execution recipe is configured for this command.", operationId);
    const environment = testEnvironment ? { ...testEnvironment.environment, ...recipe.environment } : recipe.environment;
    return brokerResult(await this.dependencies.execution.execute({ ...base, recipe: { ...recipe, environment } }), operationId);
  }

  /**
   * A durable composite dispatch always gets an outer child record, even when
   * a handler neglects to add its own provider-specific children. Non-success
   * outcomes remain ambiguous; this wrapper never guesses that no effect ran.
   */
  private async executeComposite(definition: CommandDefinition, lease: CommandOperationLease, invoke: (childSaga: ChildOperationSaga | undefined) => Promise<CommandResult>): Promise<CommandResult> {
    const childSaga = brokerChildSaga(this.operations, lease);
    let boundary: ChildOperationLease | undefined;
    try {
      if (childSaga) {
        boundary = await childSaga.begin({ action: `${definition.action}.composite`, idempotencyScope: "dispatch-boundary" });
        if (!boundary.mayExecute) throw new Error("A prior composite boundary exists and must be reconciled before dispatch.");
        await childSaga.markExecuting(boundary);
      }
      const result = await invoke(childSaga);
      if (childSaga && boundary) {
        // A status is not evidence of effect. A remote peer can commit and then
        // return blocked/unavailable when its response is lost. Only an
        // explicit disposition from the trusted boundary can make a retry safe.
        const disposition = result.effectDisposition ?? "ambiguous";
        if (disposition === "committed") {
          // The trusted boundary has positively identified the external
          // effect.  It is therefore terminal even when the command result is
          // intentionally incomplete (for example, creating a reviewed
          // feature branch and requiring a fresh TargetSnapshot before the
          // commit).  The parent may still record a non-green command result;
          // the child receipt prevents both replay and false ambiguity.
          await childSaga.markExternalCommitted(boundary, { brokerStatus: result.status, externalEffect: disposition });
          await childSaga.settle(boundary, "completed");
        } else if (disposition === "not_started") {
          await childSaga.settle(boundary, "failed", { brokerStatus: result.status, externalEffect: disposition });
        } else if (disposition === "compensated") {
          await childSaga.markExternalCommitted(boundary, { brokerStatus: result.status, externalEffect: "committed_before_compensation" });
          await childSaga.markCompensating(boundary);
          await childSaga.settle(boundary, "cancelled", { brokerStatus: result.status, externalEffect: disposition });
        } else {
          await childSaga.settle(boundary, "ambiguous", { brokerStatus: result.status, externalEffect: disposition });
        }
      }
      return result;
    } catch (error) {
      if (childSaga && boundary) {
        try { await childSaga.settle(boundary, "ambiguous", { brokerStatus: "threw" }); } catch { /* preserve the original safe failure */ }
      }
      throw error;
    } finally {
      closeBrokerChildSaga(childSaga);
    }
  }

  private async prepareTestEnvironment(base: Readonly<{ action: CommandAction; operationId: string; target: TargetSnapshot; session?: ManagedSession; authority?: AuthorityGrant; permit: PolicyPermit; executionControl?: ExecutionControl; effectGuard?: EffectGuard }>, operationId: string): Promise<{ environment?: TestEnvironment; result?: CommandResult }> {
    if (!this.dependencies.testEnvironment) return { result: unavailable("No test-environment broker is configured; validation will not inherit a normal shell environment.", operationId) };
    const recipe = this.dependencies.recipes?.forTarget(base.target);
    if (!recipe) return { result: unavailable("No approved repository test recipe is configured; validation cannot safely infer commands or production deny rules.", operationId) };
    const prepared: TestEnvironmentOutcome = await this.dependencies.testEnvironment.prepare({ ...base, recipe, sourceEnvironment: {} });
    if (prepared.status !== "completed" || !prepared.environment) return { result: brokerResult(prepared, operationId) };
    return { environment: prepared.environment };
  }

  private async recordLifecycle(lifecycle: DurableDispatchLifecycle | undefined, lease: CommandOperationLease, definition: CommandDefinition, result: CommandResult, target: TargetSnapshot | undefined, authority: AuthorityGrant | undefined): Promise<Readonly<{ receiptId?: string }>> {
    if (!lifecycle) return {};
    const evidence = this.dependencies.receiptEvidence?.forResult(definition, result, target);
    return lifecycle.recordResult(lease, {
      action: definition.action,
      ...(target ? { targetSnapshotId: target.id } : {}),
      ...(authority ? { authorityId: authority.id } : {}),
      status: result.status,
      summary: result.summary,
      ...(result.effectDisposition ? { effectDisposition: result.effectDisposition } : {}),
      ...(evidence ?? {})
    });
  }
}

function durableLifecycle(candidate: CommandOperationCoordinator): DurableDispatchLifecycle | undefined {
  const maybe = candidate as Partial<DurableDispatchLifecycle>;
  return typeof maybe.markExecuting === "function" && typeof maybe.recordResult === "function"
    ? maybe as DurableDispatchLifecycle
    : undefined;
}

function brokerChildSaga(candidate: CommandOperationCoordinator, lease: CommandOperationLease): ChildOperationSaga | undefined {
  const maybe = candidate as Partial<{ childSaga(lease: CommandOperationLease): ChildOperationSaga }>;
  return typeof maybe.childSaga === "function" ? maybe.childSaga(lease) : undefined;
}

function closeBrokerChildSaga(childSaga: ChildOperationSaga | undefined): void {
  const closeable = childSaga as (ChildOperationSaga & Partial<{ close(): void }>) | undefined;
  closeable?.close?.();
}

function policyResult(decision: PolicyDecision): CommandResult {
  return { status: decision.status === "allowed" ? "failed" : decision.status, summary: decision.reason, data: decision.missingGates ? { missingGates: decision.missingGates } : undefined };
}

function brokerResult(outcome: BrokerOutcome, operationId: string): CommandResult {
  return { status: outcome.status, summary: outcome.summary, effectDisposition: outcome.effectDisposition, operationId, data: outcome.data };
}

function adapterResult(outcome: AdapterOutcome, operationId: string): CommandResult {
  return { status: outcome.status, summary: outcome.summary, effectDisposition: outcome.effectDisposition, operationId, data: outcome.data };
}

function unavailable(summary: string, operationId?: string): CommandResult {
  return { status: "unavailable", summary, effectDisposition: "not_started", operationId };
}
