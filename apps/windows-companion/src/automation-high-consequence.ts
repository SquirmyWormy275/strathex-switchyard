import type { GateEvidence, GateEvidenceStatus } from "../../../packages/control-plane/src/acceptance-evidence.ts";
import { commandForAction, type AcceptanceGate } from "../../../packages/control-plane/src/command-catalog.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import type { HighConsequenceActivation } from "./acceptance-administration.ts";
import type { AutomationHighConsequenceAuthorizationPort } from "./automation-effect-executor.ts";

export interface AutomationGateEvidenceReader {
  statusFor(gate: AcceptanceGate, targetSnapshotId?: string, now?: string): Promise<Readonly<{
    status: GateEvidenceStatus;
    evidence?: GateEvidence;
  }>>;
}

export interface AutomationActivationReader {
  list(): Promise<readonly HighConsequenceActivation[]>;
}

export interface LedgerAutomationHighConsequenceAuthorizationOptions {
  readonly policyVersion: string;
  readonly evidence: AutomationGateEvidenceReader;
  readonly activations: AutomationActivationReader;
  readonly now?: () => Date;
}

/**
 * Defense-in-depth authorization immediately before a protected LFG or Repair
 * effect. Runtime policy activation alone is insufficient: every gate record
 * is re-read, target-bound, policy-bound, and matched to the one exact active
 * activation so revocation or evidence invalidation takes effect immediately.
 */
export class LedgerAutomationHighConsequenceAuthorization implements AutomationHighConsequenceAuthorizationPort {
  private readonly now: () => Date;

  constructor(private readonly options: LedgerAutomationHighConsequenceAuthorizationOptions) {
    this.now = options.now ?? (() => new Date());
    bounded(options.policyVersion, "policy version", 128);
  }

  async authorize(input: Readonly<{
    action: "lfg" | "repair_mission";
    manifestId: string;
    approvalId: string;
    targetSnapshotId: string;
  }>): Promise<Readonly<{ authorized: true; acceptanceEvidenceDigest: string }>> {
    bounded(input.manifestId, "automation manifest", 512);
    bounded(input.approvalId, "automation approval", 512);
    digest(input.targetSnapshotId, "target snapshot");
    const definition = commandForAction(input.action);
    if (!definition.highConsequence || definition.acceptanceGates.length === 0) {
      throw new Error("The selected automation action has no high-consequence acceptance contract.");
    }

    const at = this.now();
    if (!Number.isFinite(at.getTime())) throw new Error("The acceptance authorization clock is invalid.");
    const activations = (await this.options.activations.list()).filter((candidate) =>
      candidate.status === "active"
      && candidate.action === input.action
      && candidate.targetSnapshotId === input.targetSnapshotId
      && candidate.policyVersion === this.options.policyVersion
      && Number.isFinite(Date.parse(candidate.activatedAt))
      && Date.parse(candidate.activatedAt) <= at.getTime()
      && Number.isFinite(Date.parse(candidate.expiresAt))
      && Date.parse(candidate.expiresAt) > at.getTime()
    );
    if (activations.length !== 1) {
      throw new Error("Automation requires one and only one exact current high-consequence activation.");
    }
    const activation = activations[0]!;
    const requiredGates = [...definition.acceptanceGates];
    if (new Set(activation.gateEvidenceIds).size !== requiredGates.length
      || activation.gateEvidenceIds.length !== requiredGates.length) {
      throw new Error("The automation activation does not bind exactly one evidence record per required gate.");
    }

    const evidence: GateEvidence[] = [];
    for (const gate of requiredGates) {
      const current = await this.options.evidence.statusFor(gate, input.targetSnapshotId, at.toISOString());
      const item = current.evidence;
      if (current.status !== "passed" || !item || item.gate !== gate
        || item.targetSnapshotId !== input.targetSnapshotId
        || item.policyVersion !== this.options.policyVersion
        || !activation.gateEvidenceIds.includes(item.id)
        || !/^[a-f0-9]{64}$/u.test(item.evidenceDigest)) {
        throw new Error(`Acceptance gate ${gate} lacks its exact current target-bound evidence record.`);
      }
      evidence.push(item);
    }
    if (new Set(evidence.map((item) => item.id)).size !== requiredGates.length
      || evidence.some((item) => !activation.gateEvidenceIds.includes(item.id))) {
      throw new Error("The automation acceptance evidence set changed from the active gate binding.");
    }

    const acceptanceEvidenceDigest = sha256(stableJson({
      schema: "sxsy-b122.automation-high-consequence-authorization",
      version: 1,
      action: input.action,
      manifestId: input.manifestId,
      approvalId: input.approvalId,
      targetSnapshotId: input.targetSnapshotId,
      policyVersion: this.options.policyVersion,
      activation: {
        id: activation.id,
        activatedAt: activation.activatedAt,
        expiresAt: activation.expiresAt,
        gateEvidenceIds: [...activation.gateEvidenceIds]
      },
      evidence: evidence.map((item) => ({ gate: item.gate, id: item.id, evidenceDigest: item.evidenceDigest, evaluatedAt: item.evaluatedAt, expiresAt: item.expiresAt ?? null }))
    }));
    return Object.freeze({ authorized: true, acceptanceEvidenceDigest });
  }
}

function bounded(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\0\r\n]/u.test(value)) {
    throw new Error(`The ${label} is invalid.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error(`The ${label} digest is invalid.`);
  return value;
}
