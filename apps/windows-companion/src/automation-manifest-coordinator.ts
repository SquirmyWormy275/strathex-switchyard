import type { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import type { ContainmentGuard } from "../../../packages/control-plane/src/brokers.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import type { AutomationManifestAction, AutomationOperationProposal } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { DurableAutomationManifestReviewQueue, type AutomationManifestPrepareResult } from "./automation-manifest-review.ts";

export interface AutomationManifestProposalRequest {
  readonly action: AutomationManifestAction;
  readonly target: TargetSnapshot;
  readonly session: ManagedSession;
  readonly authority: AuthorityGrant;
}

/** A configured provider may observe and propose, but this port cannot approve or execute its proposal. */
export interface AutomationManifestProposalSource {
  propose(input: AutomationManifestProposalRequest): Promise<AutomationOperationProposal>;
}

export interface InstalledAutomationManifestCoordinatorOptions {
  readonly sessions: SessionRegistry;
  readonly authorities: AuthorityLedger;
  readonly targetResolver: TargetResolver;
  readonly queue: DurableAutomationManifestReviewQueue;
  readonly containment: ContainmentGuard;
  readonly source?: AutomationManifestProposalSource;
  readonly now?: () => Date;
}

/**
 * Host-side observation phase for automation. It creates only an immutable,
 * inert review artifact; approval and execution remain separate boundaries.
 */
export class InstalledAutomationManifestCoordinator {
  private readonly now: () => Date;

  constructor(private readonly options: InstalledAutomationManifestCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async prepare(input: Readonly<{
    action: AutomationManifestAction;
    sessionId: string;
    authorityId: string;
  }>): Promise<AutomationManifestPrepareResult> {
    if (!this.options.source) {
      return { status: "unavailable", summary: "No configured automation proposal source is installed; no provider was contacted." };
    }
    const definition = commandForAction(input.action);
    if (definition.executor !== "automation") return { status: "blocked", summary: "The selected action is not an automation command." };

    let session: ManagedSession | undefined;
    let target: TargetSnapshot | undefined;
    let authority: AuthorityGrant | undefined;
    try {
      session = await this.options.sessions.get(input.sessionId);
      if (!session || session.status !== "running" || !session.capabilities.includes("mediated")
        || !session.workspaceRoot || !session.targetSnapshotId || !session.taskId || !session.planRevision) {
        return { status: "blocked", summary: "Automation proposal observation requires one exact running mediated task session." };
      }
      target = await this.options.targetResolver.resolve({ definition, session });
      if (!target || target.completeness !== "complete") {
        return { status: "unavailable", summary: "Automation proposal observation requires a complete current TargetSnapshot." };
      }
      if (target.id !== session.targetSnapshotId || !sameRoot(target.repositoryRoot, session.workspaceRoot)) {
        return { status: "blocked", summary: "The automation proposal target no longer matches the protected managed session." };
      }
      const decision = await this.options.authorities.evaluate({
        authorityId: input.authorityId,
        repositoryRoot: target.repositoryRoot,
        sessionId: session.id,
        taskId: session.taskId,
        planRevision: session.planRevision,
        action: input.action,
        now: this.now().toISOString()
      });
      if (!decision.allowed || !decision.grant) return { status: "blocked", summary: decision.reason };
      authority = decision.grant;
    } catch {
      return { status: "unavailable", summary: "The protected automation proposal binding could not be resolved." };
    }

    let fence: Awaited<ReturnType<ContainmentGuard["check"]>>;
    try { fence = await this.options.containment.check(target.repositoryRoot, "automation"); }
    catch { return { status: "unavailable", summary: "The automation containment fence could not be read; no provider was contacted." }; }
    if (!fence.allowed) return { status: "blocked", summary: fence.reason };

    let proposal: AutomationOperationProposal;
    try {
      proposal = await this.options.source.propose({ action: input.action, target, session, authority });
    } catch {
      return { status: "unavailable", summary: "The configured automation provider could not produce one exact inert proposal." };
    }
    if (proposal.kind !== input.action) {
      return { status: "blocked", summary: "The configured automation provider returned a cross-action proposal." };
    }
    // The queue re-reads target, session, and authority after provider
    // observation. Any churn during observation therefore prevents storage.
    return this.options.queue.prepare({ action: input.action, sessionId: session.id, authorityId: authority.id, proposal });
  }
}

function sameRoot(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
  return normalize(left) === normalize(right);
}
