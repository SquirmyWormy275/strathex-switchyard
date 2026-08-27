import type { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import type { CommandAction, CommandDefinition } from "../../../packages/control-plane/src/command-catalog.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { TargetResolver, WorkflowContextPreparationPort } from "../../../packages/control-plane/src/runtime.ts";
import type { WorkflowContextReview } from "../../../packages/control-plane/src/runtime.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { planApprovalReviewScopeDigest, type WorkflowCoordinatorContext, type WorkflowCoordinatorContextStore } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import type { ConfiguredProviderHostClient, ConfiguredProviderWorkflowContextObservation } from "./configured-provider-host.ts";

export interface InstalledWorkflowContextPreparationOptions {
  readonly provider: Pick<ConfiguredProviderHostClient, "observeWorkflowContext">;
  readonly contexts: WorkflowCoordinatorContextStore;
  readonly authorities: AuthorityLedger;
  readonly sessions: Pick<SessionRegistry, "get">;
  readonly targets: TargetResolver;
  readonly now?: () => Date;
  readonly authorityTtlMs?: number;
}

/**
 * Installed, host-owned bridge from provider-observed workflow data to the
 * protected coordinator ledger. Provider evidence remains non-authorizing:
 * only this class can select/reuse a local grant, and it rechecks the exact
 * durable session and TargetSnapshot before and after recording the binding.
 */
export class InstalledWorkflowContextPreparationCoordinator implements WorkflowContextPreparationPort {
  private readonly options: InstalledWorkflowContextPreparationOptions;
  private readonly now: () => Date;
  private readonly authorityTtlMs: number;

  constructor(options: InstalledWorkflowContextPreparationOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.authorityTtlMs = options.authorityTtlMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(this.authorityTtlMs) || this.authorityTtlMs <= 0) throw new Error("Workflow authority TTL must be a positive safe integer.");
  }

  async review(input: Readonly<{ definition: CommandDefinition; target: TargetSnapshot; session: ManagedSession }>): Promise<WorkflowContextReview> {
    requireWorkflowScope(input);
    if (input.definition.action !== "plan_approval") throw new Error("Only Plan Approval uses the protected exact-plan review scope.");
    await this.assertCurrent(input.definition, input.session, input.target);
    const observation = await this.observe(input.session, input.target);
    requireObservation(observation, input.session, input.target);
    await this.assertCurrent(input.definition, input.session, input.target);
    return {
      action: "plan_approval",
      sessionId: input.session.id,
      targetSnapshotId: input.target.id,
      repositoryRoot: input.target.repositoryRoot,
      provider: observation.provider,
      contextId: observation.contextId,
      observedAt: observation.observedAt,
      adapter: observation.adapter,
      plan: observation.evidence.plan,
      scopeDigest: planReviewScopeDigest(input.session, input.target, observation),
      providerContextDigest: observation.contextDigest,
      sourceRevision: observation.sourceRevision,
      summary: planReviewSummary(observation)
    };
  }

  async prepare(input: Readonly<{ definition: CommandDefinition; target: TargetSnapshot; session: ManagedSession; operator: string; review?: WorkflowContextReview }>): Promise<AuthorityGrant> {
    requireWorkflowInput(input);
    await this.assertCurrent(input.definition, input.session, input.target);
    const observation = await this.observe(input.session, input.target);
    requireObservation(observation, input.session, input.target);
    await this.assertCurrent(input.definition, input.session, input.target);
    if (input.definition.action === "plan_approval") {
      const expectedScope = planReviewScopeDigest(input.session, input.target, observation);
      if (!input.review || input.review.scopeDigest !== expectedScope || input.review.providerContextDigest !== observation.contextDigest
        || input.review.sourceRevision !== observation.sourceRevision) {
        throw new Error("The exact approved plan changed after review and before authority/confirmation binding.");
      }
    }

    const previous = await this.options.contexts.current(input.session.id, input.target.id);
    let authority: AuthorityGrant | undefined;
    let issued = false;
    if (input.definition.action === "authority_refresh" || input.definition.action === "authority_broadcast") {
      authority = await this.existingManagementAuthority(input.definition.action, previous, observation, input.session, input.target);
    } else if (sameObservedContext(previous, observation)) {
      authority = await this.currentAuthority(previous!, input.definition.action, input.session, input.target);
    }
    if (!authority) {
      authority = await this.options.authorities.issue({
        repositoryRoot: input.target.repositoryRoot,
        sessionId: input.session.id,
        taskId: input.session.taskId,
        planRevision: input.session.planRevision,
        allowedActions: exactWorkflowActions(input.definition.action),
        prohibitedActions: [],
        expiresAt: new Date(this.now().getTime() + this.authorityTtlMs).toISOString(),
        issuedBy: input.operator.trim()
      });
      issued = true;
    }

    const unchanged = previous && previous.authorityId === authority.id && sameObservedContext(previous, observation)
      && previous.sourceRevision === observation.sourceRevision;
    if (!unchanged) {
      try {
        await this.options.contexts.record({
          sessionId: input.session.id,
          repositoryRoot: input.target.repositoryRoot,
          targetSnapshotId: input.target.id,
          authorityId: authority.id,
          sourceRevision: observation.sourceRevision,
          provenance: {
            provider: observation.provider,
            contextId: observation.contextId,
            observedAt: observation.observedAt,
            adapterId: observation.adapter.id,
            adapterVersion: observation.adapter.version,
            moduleSha256: observation.adapter.moduleSha256,
            providerContextDigest: observation.contextDigest,
            envelopeDigest: observation.envelopeDigest
          },
          evidence: observation.evidence,
          pendingDecisions: observation.pendingDecisions,
          ...(observation.pendingRequest ? { pendingRequest: observation.pendingRequest } : {})
        });
      } catch (error) {
        if (issued) await this.revoke(authority.id, "Workflow context could not be recorded after local authority issuance.");
        throw error;
      }
    }

    try {
      await this.assertCurrent(input.definition, input.session, input.target);
    } catch (error) {
      if (issued) await this.revoke(authority.id, "The exact workflow target changed before preparation completed.");
      throw error;
    }
    return authority;
  }

  private observe(session: ManagedSession, target: TargetSnapshot): Promise<ConfiguredProviderWorkflowContextObservation> {
    return this.options.provider.observeWorkflowContext({
      session,
      target: { id: target.id, repositoryRoot: target.repositoryRoot, branch: target.branch!, head: target.head! }
    });
  }

  private async existingManagementAuthority(action: Extract<CommandAction, "authority_refresh" | "authority_broadcast">, previous: WorkflowCoordinatorContext | undefined, observation: ConfiguredProviderWorkflowContextObservation, session: ManagedSession, target: TargetSnapshot): Promise<AuthorityGrant> {
    if (!previous || !sameObservedContext(previous, observation)) throw new Error("Authority replay requires an existing protected context for the exact current provider observation; no fresh authority was minted.");
    const authority = await this.currentAuthority(previous, action, session, target);
    if (!authority) throw new Error("Authority replay requires an existing protected authority that allows this exact management action; no fresh authority was minted.");
    if (action === "authority_refresh") {
      const pending = observation.pendingRequest;
      if (!pending || !authority.allowedActions.includes(pending.action) || authority.prohibitedActions.includes(pending.action)) {
        throw new Error("Authority Refresh stopped because the provider pending action is not allowed by the existing protected authority; no fresh authority was minted.");
      }
    }
    return authority;
  }

  private async currentAuthority(context: WorkflowCoordinatorContext, action: CommandAction, session: ManagedSession, target: TargetSnapshot): Promise<AuthorityGrant | undefined> {
    const decision = await this.options.authorities.evaluate({
      authorityId: context.authorityId,
      repositoryRoot: target.repositoryRoot,
      sessionId: session.id,
      taskId: session.taskId,
      planRevision: session.planRevision,
      action,
      now: this.now().toISOString()
    });
    return decision.allowed ? decision.grant : undefined;
  }

  private async assertCurrent(definition: CommandDefinition, expectedSession: ManagedSession, expectedTarget: TargetSnapshot): Promise<void> {
    const currentSession = await this.options.sessions.get(expectedSession.id);
    if (!currentSession || currentSession.provider !== expectedSession.provider || currentSession.status === "stale" || currentSession.status === "unreachable" || currentSession.status === "unknown"
      || currentSession.targetSnapshotId !== expectedTarget.id || currentSession.taskId !== expectedSession.taskId || currentSession.planRevision !== expectedSession.planRevision
      || !sameRoot(currentSession.workspaceRoot, expectedTarget.repositoryRoot)) throw new Error("The protected managed session changed during workflow-context preparation.");
    const currentTarget = await this.options.targets.resolve({ definition, session: currentSession });
    if (!currentTarget || currentTarget.completeness !== "complete" || currentTarget.id !== expectedTarget.id
      || currentTarget.branch !== expectedTarget.branch || currentTarget.head !== expectedTarget.head
      || !sameRoot(currentTarget.repositoryRoot, expectedTarget.repositoryRoot)) throw new Error("The exact workflow target changed during workflow-context preparation.");
  }

  private async revoke(authorityId: string, reason: string): Promise<void> {
    try { await this.options.authorities.revoke(authorityId, reason); } catch { /* fail closed: the caller still receives no usable result */ }
  }
}

function exactWorkflowActions(action: CommandAction): readonly CommandAction[] {
  return [...new Set<CommandAction>([action, "authority_refresh", "authority_broadcast"])];
}

function sameObservedContext(context: WorkflowCoordinatorContext | undefined, observation: ConfiguredProviderWorkflowContextObservation): boolean {
  return !!context?.provenance && context.sourceRevision === observation.sourceRevision
    && context.provenance.provider === observation.provider
    && context.provenance.providerContextDigest === observation.contextDigest;
}

function requireWorkflowInput(input: Readonly<{ definition: CommandDefinition; target: TargetSnapshot; session: ManagedSession; operator: string }>): void {
  requireWorkflowScope(input);
  if (!input.operator.trim()) throw new Error("Workflow-context preparation requires one verified operator.");
}

function requireWorkflowScope(input: Readonly<{ definition: CommandDefinition; target: TargetSnapshot; session: ManagedSession }>): void {
  if (input.definition.executor !== "agent" || input.definition.action === "bind_voice_session" || !input.definition.requiresAuthority) throw new Error("Only authority-bearing non-voice agent workflows use provider-context preparation.");
  if ((input.session.provider !== "claude" && input.session.provider !== "codex") || !input.session.workspaceRoot || !input.session.targetSnapshotId || !input.session.taskId || !input.session.planRevision
    || input.session.targetSnapshotId !== input.target.id || !sameRoot(input.session.workspaceRoot, input.target.repositoryRoot)
    || input.target.completeness !== "complete" || !input.target.branch || !input.target.head) {
    throw new Error("Workflow-context preparation requires one exact complete provider session, target, task, and plan.");
  }
}

function requireObservation(observation: ConfiguredProviderWorkflowContextObservation, session: ManagedSession, target: TargetSnapshot): void {
  if (observation.sessionId !== session.id || observation.provider !== session.provider || observation.targetSnapshotId !== target.id
    || !sameRoot(observation.repositoryRoot, target.repositoryRoot) || observation.branch !== target.branch || observation.head !== target.head
    || observation.taskId !== session.taskId || observation.planRevision !== session.planRevision
    || observation.evidence.plan.taskId !== session.taskId || observation.evidence.plan.revision !== session.planRevision
    || observation.evidence.plan.originSessionId !== session.id) throw new Error("The provider workflow-context observation changed its exact session, target, task, or plan binding.");
}

function sameRoot(left: string | undefined, right: string): boolean {
  return typeof left === "string" && left.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() === right.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function planReviewScopeDigest(session: ManagedSession, target: TargetSnapshot, observation: ConfiguredProviderWorkflowContextObservation): string {
  return planApprovalReviewScopeDigest({
    sessionId: session.id,
    targetSnapshotId: target.id,
    repositoryRoot: target.repositoryRoot,
    taskId: observation.evidence.plan.taskId,
    planRevision: observation.evidence.plan.revision,
    planDigest: observation.evidence.plan.digest,
    originSessionId: observation.evidence.plan.originSessionId,
    providerContextDigest: observation.contextDigest,
    sourceRevision: observation.sourceRevision
  });
}

function planReviewSummary(observation: ConfiguredProviderWorkflowContextObservation): string {
  const plan = observation.evidence.plan;
  const objective = plan.objective.replace(/[\r\n\0]+/g, " ").trim().slice(0, 1_024);
  const transition = plan.expectedTargetTransition;
  return `Review exact plan ${plan.revision} (${plan.digest}) from ${plan.originSessionId}: ${objective}. ${plan.steps.length} bound step(s); ${plan.decisions.length} settled decision(s). Expected TargetSnapshot transition ${transition.beforeTargetSnapshotId} -> ${transition.expectedAfterTargetSnapshotId} (${transition.expectation}).`;
}
