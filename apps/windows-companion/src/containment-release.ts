import type { CommandResult } from "../../../packages/control-plane/src/contracts.ts";
import type { RuntimeCommandPreparationResult, RuntimeContainmentReleaseRequest } from "../../../packages/control-plane/src/runtime.ts";
import { containmentReleaseScopeDigest, type ContainmentRecord } from "../../../packages/control-plane/src/containment.ts";
import {
  containmentIncidentReviewDigest,
  type ContainmentIncidentRecord,
  type ContainmentRemediationAction,
  type ContainmentRemediationPermit
} from "../../../packages/control-plane/src/containment-incidents.ts";

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
  readonly incident: ContainmentIncidentRecord;
  readonly incidentDigest: string;
}

export interface ContainmentReleaseInspector {
  inspect(sessionId: string): Promise<Readonly<{ fence: ContainmentRecord; incident: ContainmentIncidentRecord }> | undefined>;
  assess?(input: Readonly<{ sessionId: string; incidentId: string; expectedIncidentDigest: string }>): Promise<void>;
  issuePermit?(input: Readonly<{ sessionId: string; incidentId: string; expectedIncidentDigest: string; action: ContainmentRemediationAction; relativePaths: readonly string[]; expiresAt: string }>): Promise<ContainmentRemediationPermit>;
  recordRotation?(input: Readonly<{ sessionId: string; incidentId: string; expectedIncidentDigest: string; disposition: "complete" | "not_required"; evidenceReference: string; evidenceDigest: string }>): Promise<void>;
}

/** Converts one explicit admin UI request into a presence-attested, one-use release. */
export class AttestedContainmentReleaseCoordinator {
  constructor(private readonly runtime: ContainmentReleaseRuntime, private readonly inspector: ContainmentReleaseInspector) {}

  async inspect(sessionId: string): Promise<ContainmentInspectionSummary | undefined> {
    const normalized = sessionId.trim();
    if (!normalized || normalized.length > 256 || /[\r\n\0]/.test(normalized)) return undefined;
    const inspected = await this.inspector.inspect(normalized);
    const record = inspected?.fence;
    const incident = inspected?.incident;
    if (!record?.active || !Number.isSafeInteger(record.fenceEpoch) || record.fenceEpoch < 1 || !record.activatedByOperationId
      || !record.hookStates || record.hookStates.length !== 2 || !record.incidentId || !incident
      || incident.id !== record.incidentId || incident.repositoryRoot.replaceAll("\\", "/").toLowerCase() !== record.repositoryRoot.replaceAll("\\", "/").toLowerCase()
      || incident.fenceEpoch !== record.fenceEpoch || incident.activationOperationId !== record.activatedByOperationId || incident.status === "released") return undefined;
    return {
      sessionId: normalized,
      repositoryRoot: record.repositoryRoot,
      active: true,
      fenceEpoch: record.fenceEpoch,
      activatedByOperationId: record.activatedByOperationId,
      hookStates: record.hookStates.map((state) => ({ ...state })),
      hookFailures: [...(record.hookFailures ?? [])],
      uncontrolledPaths: [...record.uncontrolledPaths],
      incident,
      incidentDigest: containmentIncidentReviewDigest(incident)
    };
  }

  async reassess(input: Readonly<{ sessionId: string; expectedIncidentId: string; expectedIncidentDigest: string }>): Promise<ContainmentInspectionSummary> {
    if (!this.inspector.assess) throw new Error("No installed containment assessment boundary is attached.");
    await this.requireExactInspection(input);
    await this.inspector.assess({ sessionId: input.sessionId, incidentId: input.expectedIncidentId, expectedIncidentDigest: input.expectedIncidentDigest });
    const updated = await this.inspect(input.sessionId);
    if (!updated || updated.incident.id !== input.expectedIncidentId) throw new Error("The containment incident changed during assessment.");
    return updated;
  }

  async issueRemediationPermit(input: Readonly<{
    sessionId: string;
    expectedIncidentId: string;
    expectedIncidentDigest: string;
    action: ContainmentRemediationAction;
    relativePaths: readonly string[];
    expiresAt: string;
  }>): Promise<Readonly<{ permit: ContainmentRemediationPermit; containment: ContainmentInspectionSummary }>> {
    if (!this.inspector.issuePermit) throw new Error("No installed containment remediation-review boundary is attached.");
    await this.requireExactInspection(input);
    const permit = await this.inspector.issuePermit({
      sessionId: input.sessionId,
      incidentId: input.expectedIncidentId,
      expectedIncidentDigest: input.expectedIncidentDigest,
      action: input.action,
      relativePaths: input.relativePaths,
      expiresAt: input.expiresAt
    });
    const containment = await this.inspect(input.sessionId);
    if (!containment || containment.incident.id !== input.expectedIncidentId || permit.incidentId !== input.expectedIncidentId
      || permit.fenceEpoch !== containment.fenceEpoch || permit.action !== input.action) throw new Error("The containment remediation permit changed its exact reviewed binding.");
    return { permit, containment };
  }

  async recordRotationReview(input: Readonly<{
    sessionId: string;
    expectedIncidentId: string;
    expectedIncidentDigest: string;
    disposition: "complete" | "not_required";
    evidenceReference: string;
    evidenceDigest: string;
  }>): Promise<ContainmentInspectionSummary> {
    if (!this.inspector.recordRotation) throw new Error("No installed containment credential-rotation review boundary is attached.");
    await this.requireExactInspection(input);
    await this.inspector.recordRotation({
      sessionId: input.sessionId,
      incidentId: input.expectedIncidentId,
      expectedIncidentDigest: input.expectedIncidentDigest,
      disposition: input.disposition,
      evidenceReference: input.evidenceReference,
      evidenceDigest: input.evidenceDigest
    });
    const updated = await this.inspect(input.sessionId);
    if (!updated || updated.incident.id !== input.expectedIncidentId) throw new Error("The containment incident changed during credential-rotation review.");
    return updated;
  }

  private async requireExactInspection(input: Readonly<{ sessionId: string; expectedIncidentId: string; expectedIncidentDigest: string }>): Promise<ContainmentInspectionSummary> {
    if (!/^containment-incident:[a-f0-9]{64}$/.test(input.expectedIncidentId) || !/^[a-f0-9]{64}$/.test(input.expectedIncidentDigest)) {
      throw new Error("The containment incident review binding is malformed.");
    }
    const inspected = await this.inspect(input.sessionId);
    if (!inspected || inspected.incident.id !== input.expectedIncidentId || inspected.incidentDigest !== input.expectedIncidentDigest) {
      throw new Error("The containment incident changed after review; inspect it again.");
    }
    return inspected;
  }

  async release(input: Readonly<{ sessionId: string; reason: string; expectedFenceEpoch: number; expectedActivationOperationId: string; expectedIncidentId: string; expectedIncidentDigest: string }>): Promise<CommandResult> {
    const reason = input.reason.trim();
    if (!reason || reason.length > 2_048 || /\0/.test(reason)) return { status: "blocked", summary: "Containment release requires a bounded incident-review reason." };
    let inspected: ContainmentInspectionSummary | undefined;
    let confirmationScopeDigest: string;
    try {
      inspected = await this.inspect(input.sessionId);
      confirmationScopeDigest = containmentReleaseScopeDigest(input);
    } catch {
      return { status: "unavailable", summary: "The exact active containment fence could not be inspected safely." };
    }
    if (!inspected) return { status: "unavailable", summary: "No exact active containment fence exists for this protected session target." };
    if (inspected.fenceEpoch !== input.expectedFenceEpoch || inspected.activatedByOperationId !== input.expectedActivationOperationId
      || inspected.incident.id !== input.expectedIncidentId || inspected.incidentDigest !== input.expectedIncidentDigest) {
      return { status: "blocked", summary: "Containment changed after review; inspect the exact active fence and incident again before release." };
    }
    if (inspected.incident.status !== "ready_for_release") return { status: "blocked", summary: "The durable containment incident is not ready for release." };
    const prepared = await this.runtime.prepareCommand({ action: "containment_release", sessionId: input.sessionId, reason, confirmationScopeDigest });
    if (prepared.status !== "prepared") return { status: prepared.status, summary: prepared.summary };
    if (!prepared.authorityId || !prepared.confirmationToken) return { status: "unavailable", summary: "Containment release preparation omitted its exact protected authority or one-time confirmation." };
    return this.runtime.releaseContainment({
      sessionId: input.sessionId,
      authorityId: prepared.authorityId,
      confirmationToken: prepared.confirmationToken,
      reason,
      expectedFenceEpoch: input.expectedFenceEpoch,
      expectedActivationOperationId: input.expectedActivationOperationId,
      expectedIncidentId: input.expectedIncidentId,
      expectedIncidentDigest: input.expectedIncidentDigest
    });
  }
}
