import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import { sessionBindingDigest, type SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import type { TargetSnapshotLedger } from "../../../packages/control-plane/src/snapshot-ledger.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";

export interface EffectTargetTransitionPort {
  captureAndAccept(input: Readonly<{
    action: CommandAction;
    operationId: string;
    previousTarget: TargetSnapshot;
    session: ManagedSession;
    expectedTargetSnapshotId?: string;
    allowUnchanged?: boolean;
  }>): Promise<EffectTargetTransitionResult>;
}

export interface EffectTargetTransitionResult {
  readonly status: "transitioned" | "already_transitioned" | "unchanged";
  readonly target: TargetSnapshot;
  readonly session: ManagedSession;
}

export interface DurableEffectTargetTransitionCoordinatorOptions {
  readonly sessions: SessionRegistry;
  readonly targets: TargetSnapshotLedger;
  readonly targetResolver: TargetResolver;
}

/**
 * Accepts a legitimate effect-produced TargetSnapshot without weakening the
 * pre-effect final-current guard. The after-snapshot is captured from trusted
 * host identity, recorded content-addressably, and compare-and-swapped onto
 * the exact durable session that authorized the operation.
 */
export class DurableEffectTargetTransitionCoordinator implements EffectTargetTransitionPort {
  constructor(private readonly options: DurableEffectTargetTransitionCoordinatorOptions) {}

  async captureAndAccept(input: Readonly<{
    action: CommandAction;
    operationId: string;
    previousTarget: TargetSnapshot;
    session: ManagedSession;
    expectedTargetSnapshotId?: string;
    allowUnchanged?: boolean;
  }>): Promise<EffectTargetTransitionResult> {
    const operationId = bounded(input.operationId, "effect transition operation", 256);
    const definition = commandForAction(input.action);
    const expectedBindingDigest = sessionBindingDigest(input.session);
    if (input.session.targetSnapshotId !== input.previousTarget.id || !input.session.workspaceRoot
      || !sameRoot(input.session.workspaceRoot, input.previousTarget.repositoryRoot)) {
      throw new Error("The effect transition source session does not bind the exact previous TargetSnapshot.");
    }
    const durableBefore = await this.options.sessions.get(input.session.id);
    if (!durableBefore) throw new Error("The effect transition source session disappeared.");
    const replayCandidate = durableBefore.metadata["sxsy-b122.effectTransition.operationId"] === operationId
      && durableBefore.metadata["sxsy-b122.effectTransition.action"] === input.action
      && durableBefore.metadata["sxsy-b122.effectTransition.oldTargetSnapshotId"] === input.previousTarget.id;
    if (!replayCandidate && sessionBindingDigest(durableBefore) !== expectedBindingDigest) {
      throw new Error("The managed session binding changed before the effect transition was captured.");
    }

    const target = await this.options.targetResolver.resolve({ definition, session: durableBefore });
    if (!target || target.completeness !== "complete" || target.reasons.length !== 0 || targetSnapshotDigest(target) !== target.id) {
      throw new Error("The host could not capture one complete canonical post-effect TargetSnapshot.");
    }
    if (!sameRoot(target.repositoryRoot, input.previousTarget.repositoryRoot)) {
      throw new Error("The post-effect TargetSnapshot changed the exact repository root.");
    }
    if (input.expectedTargetSnapshotId !== undefined && input.expectedTargetSnapshotId !== target.id) {
      throw new Error("The observed post-effect TargetSnapshot does not match the reviewed expected TargetSnapshot transition.");
    }
    await this.options.targets.record(target);

    if (target.id === input.previousTarget.id) {
      if (input.allowUnchanged === false) throw new Error("The reviewed effect required a changed TargetSnapshot but the host observed no transition.");
      const current = await this.options.sessions.get(input.session.id);
      if (!current || sessionBindingDigest(current) !== expectedBindingDigest) {
        throw new Error("The managed session binding changed while the unchanged effect target was verified.");
      }
      return { status: "unchanged", target, session: current };
    }

    const transitioned = await this.options.sessions.compareAndSwapEffectTarget({
      sessionId: input.session.id,
      expectedBindingDigest,
      oldTargetSnapshotId: input.previousTarget.id,
      newTargetSnapshotId: target.id,
      operationId,
      action: input.action
    });
    if ((transitioned.outcome !== "transitioned" && transitioned.outcome !== "already_transitioned") || !transitioned.session) {
      throw new Error(`The managed session binding changed before the post-effect target transition could be accepted: ${transitioned.reason}`);
    }
    return { status: transitioned.outcome, target, session: transitioned.session };
  }
}

function sameRoot(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function bounded(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\0\r\n]/u.test(value)) {
    throw new Error(`${label} must be one bounded durable identity.`);
  }
  return value;
}
