import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { AutomationRequest, ContainmentGuard, PermitVerifier } from "../../../packages/control-plane/src/brokers.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import {
  createAutomationManifestApproval,
  automationManifestReviewScopeDigest,
  createAutomationOperationManifest,
  type AutomationOperationProposal
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import type { AutomationEffectReceipt } from "../src/automation-effect-executor.ts";
import { createHostLocalAutomationBroker } from "../src/local-automation-broker.ts";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const root = "C:\\b122-local-automation-test";
const target: TargetSnapshot = {
  id: digest("target"), repositoryRoot: root, branch: "feat/test", head: "1".repeat(40), indexTree: "2".repeat(40),
  trackedManifest: digest("tracked"), untrackedManifest: digest("untracked"), submodules: {}, policyVersion: "b122-test-v1",
  environmentFingerprint: digest("environment"), capturedAt: "2026-08-26T00:00:00.000Z", completeness: "complete", reasons: []
};
const session: ManagedSession = {
  id: "session-local-automation", provider: "codex", surface: "vscode_window", capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running", workspaceRoot: root, targetSnapshotId: target.id, taskId: "task-local-automation", planRevision: "plan-v1",
  plannedFiles: ["docs/learning.md", "AGENTS.md"], lastHeartbeat: "2026-08-26T00:00:00.000Z", adapterVersion: "test", metadata: {}
};
const authority: AuthorityGrant = {
  id: "authority-local-automation", repositoryRoot: root, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
  allowedActions: ["compound_capture"], prohibitedActions: [], issuedAt: "2026-08-26T00:00:00.000Z", expiresAt: "2026-08-26T00:20:00.000Z", issuedBy: "test"
};
const exactContent = (value: string) => {
  const bytes = Buffer.from(value, "utf8");
  return { afterDigest: digest(value), content: { encoding: "base64" as const, byteLength: bytes.byteLength, data: bytes.toString("base64") } };
};
const proposal: AutomationOperationProposal = {
  kind: "compound_capture",
  solvedProblemEvidenceDigest: digest("problem"),
  verifiedOutcomeEvidenceDigest: digest("outcome"),
  nonTrivialRationale: "A verified project-specific learning belongs in durable documentation.",
  documents: [{ path: "docs/learning.md", mutation: "create", beforeDigest: null, ...exactContent("# Learning\n") }],
  instructionFileMutation: { kind: "edit_existing", path: "AGENTS.md", beforeDigest: digest("before\n"), ...exactContent("after\n") }
};
const manifest = createAutomationOperationManifest({
  repositoryRoot: root, targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id,
  taskId: session.taskId!, planRevision: session.planRevision!, provider: session.provider,
  createdAt: "2026-08-26T00:00:00.000Z", expiresAt: "2026-08-26T00:10:00.000Z"
}, proposal);
const confirmationToken = "local-automation-confirmation";
const approval = createAutomationManifestApproval({
  manifest,
  confirmationToken,
  confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
  confirmedAt: "2026-08-26T00:01:00.000Z",
  expiresAt: "2026-08-26T00:06:00.000Z"
});

const policy: PermitVerifier = { verifyPermit: () => true };
const containment: ContainmentGuard = { check: async () => ({ allowed: true, reason: "clear" }) };

function request(): AutomationRequest {
  return {
    action: "compound_capture", operationId: "operation-local-automation", target, session, authority,
    permit: {} as never,
    confirmation: {
      currentUserConfirmed: true,
      confirmationDigest: approval.confirmationDigest,
      confirmationScopeDigest: approval.reviewScopeDigest,
      action: "compound_capture",
      targetSnapshotId: target.id,
      sessionId: session.id,
      authorityId: authority.id
    },
    effectGuard: { assertCurrent: async () => ({ allowed: true, reason: "current" }) },
    reviewedManifest: manifest,
    manifestApproval: approval
  };
}

function receipt(status: AutomationEffectReceipt["status"]): AutomationEffectReceipt {
  return {
    schema: "sxsy-b122.automation-effect-receipt", version: 1, operationId: "operation-local-automation", action: "compound_capture",
    manifestId: manifest.id, manifestDigest: manifest.digest, proposalDigest: digest(JSON.stringify(proposal)), status,
    actualDelta: null, targetTransition: null, targetTransitionChain: [], children: [], rolledBackPaths: [], errors: [], digest: digest(status)
  };
}

test("host-local automation builds the exact reviewed envelope and maps a committed receipt", async () => {
  let observed: unknown;
  const broker = createHostLocalAutomationBroker(policy, containment, {
    createExecutor() {
      return { async execute(input) { observed = input; return receipt("committed"); } };
    }
  });
  const outcome = await broker.execute(request());
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.effectDisposition, "committed");
  assert.equal(outcome.data?.manifestId, manifest.id);
  const input = observed as { envelope: { manifest: { id: string } }; currentManifestContext: { targetSnapshotId: string }; instructionFileConsent?: { path: string; approvalId: string; confirmationDigest: string } };
  assert.equal(input.envelope.manifest.id, manifest.id);
  assert.equal(input.currentManifestContext.targetSnapshotId, target.id);
  assert.deepEqual(input.instructionFileConsent, { path: "agents.md", approvalId: approval.id, confirmationDigest: approval.confirmationDigest });
});

test("host-local automation maps compensated and recovery-required receipts without claiming success", async () => {
  for (const [status, effectDisposition] of [["compensated", "compensated"], ["recovery_required", "ambiguous"]] as const) {
    const broker = createHostLocalAutomationBroker(policy, containment, { createExecutor: () => ({ execute: async () => receipt(status) }) });
    const outcome = await broker.execute(request());
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.effectDisposition, effectDisposition);
  }
});

test("host-local automation rejects absent exact review or stale final-current state before constructing an executor", async () => {
  let factories = 0;
  const broker = createHostLocalAutomationBroker(policy, containment, { createExecutor: () => { factories += 1; return { execute: async () => receipt("committed") }; } });
  const missing = { ...request(), reviewedManifest: undefined };
  assert.equal((await broker.execute(missing)).status, "blocked");
  const stale = { ...request(), effectGuard: { assertCurrent: async () => ({ allowed: false, reason: "stale target" }) } };
  const staleResult = await broker.execute(stale);
  assert.equal(staleResult.status, "incomplete");
  assert.match(staleResult.summary, /stale target/i);
  assert.equal(factories, 0);
});
