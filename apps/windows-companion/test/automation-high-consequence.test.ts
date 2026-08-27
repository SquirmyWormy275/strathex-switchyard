import assert from "node:assert/strict";
import test from "node:test";

import type { GateEvidence } from "../../../packages/control-plane/src/acceptance-evidence.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { HighConsequenceActivation } from "../src/acceptance-administration.ts";
import { LedgerAutomationHighConsequenceAuthorization } from "../src/automation-high-consequence.ts";

const targetSnapshotId = "1".repeat(64);
const now = "2026-08-26T16:00:00.000Z";
const action = "repair_mission" as const;
const requiredGates = commandForAction(action).acceptanceGates;

function evidence(gate: (typeof requiredGates)[number]): GateEvidence {
  return {
    id: `evidence-${gate}`,
    gate,
    status: "passed",
    targetSnapshotId,
    evidenceDigest: String(gate).padStart(64, "0"),
    policyVersion: "policy-1",
    evaluatedBy: "TEST\\operator",
    evaluatedAt: "2026-08-26T15:00:00.000Z",
    expiresAt: "2026-08-26T17:00:00.000Z",
    rationale: "Fixture evidence."
  };
}

function activation(overrides: Partial<HighConsequenceActivation> = {}): HighConsequenceActivation {
  return {
    id: "activation-1",
    action,
    targetSnapshotId,
    policyVersion: "policy-1",
    gateEvidenceIds: requiredGates.map((gate) => `evidence-${gate}`),
    activatedAt: "2026-08-26T15:30:00.000Z",
    expiresAt: "2026-08-26T16:30:00.000Z",
    activatedBy: "TEST\\operator",
    status: "active",
    ...overrides
  };
}

function fixture(options: Readonly<{
  activations?: readonly HighConsequenceActivation[];
  status?: (gate: (typeof requiredGates)[number]) => Readonly<{ status: "passed" | "failed" | "incomplete"; evidence?: GateEvidence }>;
}> = {}) {
  return new LedgerAutomationHighConsequenceAuthorization({
    policyVersion: "policy-1",
    activations: { async list() { return options.activations ?? [activation()]; } },
    evidence: {
      async statusFor(gate: (typeof requiredGates)[number]) {
        return options.status?.(gate) ?? { status: "passed" as const, evidence: evidence(gate) };
      }
    },
    now: () => new Date(now)
  });
}

test("authorizes only one exact current activation backed by every current target-bound gate", async () => {
  const port = fixture();
  const first = await port.authorize({ action, manifestId: "manifest-1", approvalId: "approval-1", targetSnapshotId });
  const replay = await port.authorize({ action, manifestId: "manifest-1", approvalId: "approval-1", targetSnapshotId });
  const changed = await port.authorize({ action, manifestId: "manifest-2", approvalId: "approval-1", targetSnapshotId });
  assert.match(first.acceptanceEvidenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(replay.acceptanceEvidenceDigest, first.acceptanceEvidenceDigest);
  assert.notEqual(changed.acceptanceEvidenceDigest, first.acceptanceEvidenceDigest);
});

test("rejects absent, duplicate, revoked, expired, wrong-policy, and wrong-target activations", async () => {
  for (const activations of [
    [],
    [activation(), activation({ id: "activation-2" })],
    [activation({ status: "revoked" })],
    [activation({ expiresAt: now })],
    [activation({ policyVersion: "other" })],
    [activation({ targetSnapshotId: "2".repeat(64) })]
  ]) {
    await assert.rejects(
      () => fixture({ activations }).authorize({ action, manifestId: "manifest-1", approvalId: "approval-1", targetSnapshotId }),
      /activation|acceptance/i
    );
  }
});

test("rejects missing, failed, stale-target, policy-substituted, and activation-unbound gate evidence", async () => {
  const selectedGate = requiredGates[0]!;
  const cases = [
    () => ({ status: "failed" as const, evidence: evidence(selectedGate) }),
    () => ({ status: "incomplete" as const }),
    () => ({ status: "passed" as const, evidence: { ...evidence(selectedGate), targetSnapshotId: "2".repeat(64) } }),
    () => ({ status: "passed" as const, evidence: { ...evidence(selectedGate), policyVersion: "other" } }),
    () => ({ status: "passed" as const, evidence: { ...evidence(selectedGate), id: "substituted-evidence" } })
  ];
  for (const changed of cases) {
    const port = fixture({ status: (gate) => gate === selectedGate ? changed() : { status: "passed", evidence: evidence(gate) } });
    await assert.rejects(
      () => port.authorize({ action, manifestId: "manifest-1", approvalId: "approval-1", targetSnapshotId }),
      /evidence|gate|acceptance/i
    );
  }
});
