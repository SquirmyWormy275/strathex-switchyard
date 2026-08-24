import type { CommandResult } from "../../../packages/control-plane/src/contracts.ts";
import type { RuntimeCommandPreparationResult, RuntimeContainmentReleaseRequest } from "../../../packages/control-plane/src/runtime.ts";
import type { IncidentStatus } from "../../../packages/control-plane/src/containment.ts";

export interface ContainmentReleaseRuntime {
  prepareCommand(request: Readonly<{ action: "containment_release"; sessionId: string; reason: string }>): Promise<RuntimeCommandPreparationResult>;
  releaseContainment(request: RuntimeContainmentReleaseRequest): Promise<CommandResult>;
}

/** Converts one explicit admin UI request into a presence-attested, one-use release. */
export class AttestedContainmentReleaseCoordinator {
  constructor(private readonly runtime: ContainmentReleaseRuntime) {}

  async release(input: Readonly<{ sessionId: string; reason: string; incidentStatus: IncidentStatus }>): Promise<CommandResult> {
    const reason = input.reason.trim();
    if (!reason || reason.length > 2_048 || /\0/.test(reason)) return { status: "blocked", summary: "Containment release requires a bounded incident-review reason." };
    if (input.incidentStatus === "rotation_pending") return { status: "blocked", summary: "Containment release requires credential rotation completion or an explicit not-required finding." };
    const prepared = await this.runtime.prepareCommand({ action: "containment_release", sessionId: input.sessionId, reason });
    if (prepared.status !== "prepared") return { status: prepared.status, summary: prepared.summary };
    if (!prepared.authorityId || !prepared.confirmationToken) return { status: "unavailable", summary: "Containment release preparation omitted its exact protected authority or one-time confirmation." };
    return this.runtime.releaseContainment({
      sessionId: input.sessionId,
      authorityId: prepared.authorityId,
      confirmationToken: prepared.confirmationToken,
      reason,
      incidentStatus: input.incidentStatus
    });
  }
}
