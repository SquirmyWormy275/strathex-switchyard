import type { CommandResult } from "../../../packages/control-plane/src/contracts.ts";
import type { RuntimeCommandPreparationResult, RuntimeContainmentReleaseRequest } from "../../../packages/control-plane/src/runtime.ts";
import { containmentReleaseScopeDigest, type ContainmentRecord, type IncidentStatus } from "../../../packages/control-plane/src/containment.ts";

export interface ContainmentReleaseRuntime {
  prepareCommand(request: Readonly<{ action: "containment_release"; sessionId: string; reason: string; confirmationScopeDigest: string }>): Promise<RuntimeCommandPreparationResult>;
  releaseContainment(request: RuntimeContainmentReleaseRequest): Promise<CommandResult>;
}

export interface ContainmentInspectionSummary {
  readonly sessionId: string;
  readonly repositoryRoot: string;
  readonly active: true;
  readonly fenceEpoch: number;
  readonly activatedByOperationId: string;
  readonly hookStates: NonNullable<ContainmentRecord["hookStates"]>;
  readonly hookFailures: readonly string[];
  readonly uncontrolledPaths: readonly string[];
}

export interface ContainmentReleaseInspector {
  inspect(sessionId: string): Promise<ContainmentRecord | undefined>;
}

/** Converts one explicit admin UI request into a presence-attested, one-use release. */
export class AttestedContainmentReleaseCoordinator {
  constructor(private readonly runtime: ContainmentReleaseRuntime, private readonly inspector: ContainmentReleaseInspector) {}

  async inspect(sessionId: string): Promise<ContainmentInspectionSummary | undefined> {
    const normalized = sessionId.trim();
    if (!normalized || normalized.length > 256 || /[\r\n\0]/.test(normalized)) return undefined;
    const record = await this.inspector.inspect(normalized);
    if (!record?.active || !Number.isSafeInteger(record.fenceEpoch) || record.fenceEpoch < 1 || !record.activatedByOperationId
      || !record.hookStates || record.hookStates.length !== 2) return undefined;
    return {
      sessionId: normalized,
      repositoryRoot: record.repositoryRoot,
      active: true,
      fenceEpoch: record.fenceEpoch,
      activatedByOperationId: record.activatedByOperationId,
      hookStates: record.hookStates.map((state) => ({ ...state })),
      hookFailures: [...(record.hookFailures ?? [])],
      uncontrolledPaths: [...record.uncontrolledPaths]
    };
  }

  async release(input: Readonly<{ sessionId: string; reason: string; incidentStatus: IncidentStatus; expectedFenceEpoch: number; expectedActivationOperationId: string }>): Promise<CommandResult> {
    const reason = input.reason.trim();
    if (!reason || reason.length > 2_048 || /\0/.test(reason)) return { status: "blocked", summary: "Containment release requires a bounded incident-review reason." };
    if (input.incidentStatus === "rotation_pending") return { status: "blocked", summary: "Containment release requires credential rotation completion or an explicit not-required finding." };
    let inspected: ContainmentInspectionSummary | undefined;
    let confirmationScopeDigest: string;
    try {
      inspected = await this.inspect(input.sessionId);
      confirmationScopeDigest = containmentReleaseScopeDigest(input);
    } catch {
      return { status: "unavailable", summary: "The exact active containment fence could not be inspected safely." };
    }
    if (!inspected) return { status: "unavailable", summary: "No exact active containment fence exists for this protected session target." };
    if (inspected.fenceEpoch !== input.expectedFenceEpoch || inspected.activatedByOperationId !== input.expectedActivationOperationId) {
      return { status: "blocked", summary: "Containment changed after review; inspect the exact active fence again before release." };
    }
    const prepared = await this.runtime.prepareCommand({ action: "containment_release", sessionId: input.sessionId, reason, confirmationScopeDigest });
    if (prepared.status !== "prepared") return { status: prepared.status, summary: prepared.summary };
    if (!prepared.authorityId || !prepared.confirmationToken) return { status: "unavailable", summary: "Containment release preparation omitted its exact protected authority or one-time confirmation." };
    return this.runtime.releaseContainment({
      sessionId: input.sessionId,
      authorityId: prepared.authorityId,
      confirmationToken: prepared.confirmationToken,
      reason,
      incidentStatus: input.incidentStatus,
      expectedFenceEpoch: input.expectedFenceEpoch,
      expectedActivationOperationId: input.expectedActivationOperationId
    });
  }
}
