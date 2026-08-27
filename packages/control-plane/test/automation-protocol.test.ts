import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  automationEffectLeaseArtifact,
  createAutomationAcceptedTargetTransitionEvidence,
  createAutomationActualDeltaEvidence,
  createAutomationIntent,
  parseAutomationEnvelope,
  parseAutomationProviderResult,
  type AutomationAction,
  type AutomationProviderResultPayload
} from "../src/automation-protocol.ts";
import {
  automationManifestReviewScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest,
  automationMutationScopeDigest,
  type AutomationManifestApproval,
  type AutomationOperationManifest,
  type AutomationOperationProposal
} from "../src/automation-operation-manifest.ts";

const confirmationToken = "review-token";
const exactContent = (value: string) => {
  const bytes = Buffer.from(value, "utf8");
  return {
    afterDigest: createHash("sha256").update(bytes).digest("hex"),
    content: { encoding: "base64" as const, byteLength: bytes.length, data: bytes.toString("base64") }
  };
};
const captureMutation = { path: "docs/solutions/example.md", mutation: "create" as const, beforeDigest: null, ...exactContent("# Captured\n") };
const refreshMutation = { path: "docs/solutions/example.md", mutation: "update" as const, beforeDigest: "3".repeat(64), ...exactContent("# Refreshed\n") };
const lfgMutation = { path: "src/example.ts", mutation: "replace" as const, beforeDigest: "4".repeat(64), ...exactContent("export const value = 1;\n") };
const repairMutation = { path: "src/example.ts", mutation: "update" as const, beforeDigest: "6".repeat(64), ...exactContent("export const value = 2;\n") };
const target = {
  id: "c".repeat(64), repositoryRoot: "C:\\repo", branch: "feat/automation", head: "d".repeat(40),
  policyVersion: "policy-v1", trackedManifest: "e".repeat(64), untrackedManifest: "f".repeat(64)
} as const;
const session = {
  id: "session-1", provider: "codex", surface: "vscode_terminal",
  capabilities: ["registered", "observable", "controllable", "mediated"],
  taskId: "task-1", planRevision: "plan-1", plannedFiles: ["src/example.ts"]
} as const;
const context = {
  repositoryRoot: target.repositoryRoot, targetSnapshotId: target.id, sessionId: session.id,
  authorityId: "authority-1", taskId: session.taskId, planRevision: session.planRevision, provider: session.provider,
  createdAt: "2026-08-26T12:00:00.000Z", expiresAt: "2026-08-26T12:10:00.000Z"
} as const;

const proposals: Readonly<Record<AutomationAction, AutomationOperationProposal>> = {
  compound_capture: {
    kind: "compound_capture", solvedProblemEvidenceDigest: "1".repeat(64), verifiedOutcomeEvidenceDigest: "2".repeat(64),
    nonTrivialRationale: "This reviewed capture records a reusable verified outcome.",
    documents: [captureMutation],
    instructionFileMutation: { kind: "none" }
  },
  compound_refresh: {
    kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [refreshMutation],
    commit: { planned: false }
  },
  lfg: {
    kind: "lfg", requirementsSources: [{ path: "docs/requirements.md", digest: "5".repeat(64) }],
    approvedScopePaths: ["src/example.ts"],
    mutations: [lfgMutation],
    effectPlan: [
      { order: 0, kind: "plan", scopeDigest: "1".repeat(64) },
      { order: 1, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([lfgMutation]) },
      { order: 2, kind: "simplify", scopeDigest: "2".repeat(64) },
      { order: 3, kind: "review", scopeDigest: "3".repeat(64) },
      { order: 4, kind: "test", scopeDigest: "4".repeat(64) },
      { order: 5, kind: "git_commit", scopeDigest: "5".repeat(64) },
      { order: 6, kind: "git_push", scopeDigest: "6".repeat(64) },
      { order: 7, kind: "pull_request", scopeDigest: "7".repeat(64) },
      { order: 8, kind: "ci_watch", scopeDigest: "8".repeat(64) }
    ],
    authorizedActions: ["filesystem_mutation", "git_commit", "git_push", "pull_request", "ci_watch"], deployAuthorized: false
  },
  repair_mission: {
    kind: "repair_mission", failingGateId: "gate-1", reproductionCommandDigest: "6".repeat(64),
    approvedScopePaths: ["src/example.ts"], mutations: [repairMutation], affectedChecks: ["targeted-check"], fullChecks: ["full-check"],
    testEnvironment: { id: "environment-1", digest: "7".repeat(64), egress: "deny", databaseName: "b122_test_1" },
    effectPlan: [
      { order: 0, kind: "sandbox_bind", scopeDigest: "7".repeat(64) },
      { order: 1, kind: "reproduce", scopeDigest: "6".repeat(64) },
      { order: 2, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([repairMutation]) },
      { order: 3, kind: "test_affected", scopeDigest: "8".repeat(64) },
      { order: 4, kind: "test_full", scopeDigest: "9".repeat(64) },
      { order: 5, kind: "review_diff", scopeDigest: "a".repeat(64) }
    ],
    pushAuthorized: false, mergeAuthorized: false, deployAuthorized: false, hostedRerunAuthorized: false, productionDataAuthorized: false
  }
};

function reviewed(action: AutomationAction): Readonly<{ manifest: AutomationOperationManifest; approval: AutomationManifestApproval }> {
  const manifest = createAutomationOperationManifest(context, proposals[action]!);
  return {
    manifest,
    approval: createAutomationManifestApproval({
      manifest, confirmationToken, confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
      confirmedAt: "2026-08-26T12:01:00.000Z", expiresAt: "2026-08-26T12:09:00.000Z"
    })
  };
}

function envelope(action: AutomationAction) {
  const review = reviewed(action);
  const confirmation = { digest: review.approval.confirmationDigest, scopeDigest: review.approval.reviewScopeDigest };
  const repairProposal = proposals.repair_mission as Extract<AutomationOperationProposal, { kind: "repair_mission" }>;
  const repairEnvironment = action === "repair_mission" ? repairProposal.testEnvironment : undefined;
  const intent = createAutomationIntent(action, confirmation, repairEnvironment, review);
  return {
    schema: `sxsy-b122.${action.replaceAll("_", "-")}-request`, version: 1, action,
    operationId: `operation-${action}`, target, session, authorityId: context.authorityId,
    manifest: review.manifest, approval: review.approval, intent
  } as const;
}

function result(action: AutomationAction): AutomationProviderResultPayload {
  if (action === "compound_capture") return { kind: action, captureId: "capture-1", learningDigest: "8".repeat(64), verifiedProblemDigest: "9".repeat(64), documents: ["docs/solutions/example.md"] };
  if (action === "compound_refresh") return { kind: action, previewDigest: "a".repeat(64), affectedPaths: ["docs/solutions/example.md"], creates: 0, updates: 1, deletes: 0, mutationApplied: false };
  if (action === "lfg") return { kind: action, runId: "run-1", stages: [{ name: "test", status: "passed", evidenceDigest: "b".repeat(64) }], pullRequestUrl: null, deploymentAttempted: false };
  return {
    kind: action, reproduction: { commandDigest: "c".repeat(64), status: "reproduced", logsDigest: "d".repeat(64) },
    approvedScopeDigest: "e".repeat(64), diffDigest: "f".repeat(64), affectedChecks: ["targeted-check"], fullChecks: ["full-check"],
    risks: [], nextAction: "Review the exact contained diff.", pushAttempted: false, mergeAttempted: false,
    deployAttempted: false, hostedRerunAttempted: false, productionDataUsed: false
  };
}

test("each mutating automation envelope carries one exact reviewed manifest, approval, and closed intent binding", () => {
  for (const action of ["compound_capture", "compound_refresh", "lfg", "repair_mission"] as const) {
    const parsed = parseAutomationEnvelope(envelope(action));
    assert.equal(parsed.action, action);
    assert.equal(parsed.intent.kind, action);
    assert.deepEqual(parsed.intent.proposal, parsed.manifest.proposal);
    assert.equal(parsed.intent.binding.manifestId, parsed.manifest.id);
    assert.equal(parsed.intent.binding.manifestDigest, parsed.manifest.digest);
    assert.equal(parsed.intent.binding.approvalId, parsed.approval.id);
    assert.equal(parsed.intent.binding.reviewScopeDigest, parsed.approval.reviewScopeDigest);
    assert.equal(parsed.intent.binding.confirmationDigest, parsed.approval.confirmationDigest);
    assert.equal(parsed.intent.binding.proposalDigest.length, 64);
    assert.equal(parsed.intent.binding.scopeDigest.length, 64);
    assert.deepEqual(automationEffectLeaseArtifact(parsed), automationEffectLeaseArtifact(parseAutomationEnvelope(JSON.parse(JSON.stringify(parsed)))));
  }
});

test("automation envelope rejects missing, open, and cross-bound manifest approval or protected context before an effect", () => {
  const exact = envelope("repair_mission");
  const { manifest: _manifest, ...withoutManifest } = exact;
  const { approval: _approval, ...withoutApproval } = exact;
  assert.throws(() => parseAutomationEnvelope(withoutManifest), /manifest|request/i);
  assert.throws(() => parseAutomationEnvelope(withoutApproval), /approval|request/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, dispatchLease: {} }), /schema|field|request/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, action: "lfg", schema: "sxsy-b122.lfg-request" }), /action|manifest|intent/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, target: { ...exact.target, repositoryRoot: "C:\\other" } }), /repository|target|manifest/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, target: { ...exact.target, id: "0".repeat(64) } }), /target|manifest/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, session: { ...exact.session, id: "session-2" } }), /session|manifest/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, session: { ...exact.session, provider: "claude" } }), /provider|manifest/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, session: { ...exact.session, taskId: "task-2" } }), /task|manifest/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, session: { ...exact.session, planRevision: "plan-2" } }), /plan|manifest/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, authorityId: "authority-2" }), /authority|manifest/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, intent: { ...exact.intent, confirmation: { ...exact.intent.confirmation, digest: "0".repeat(64) } } }), /confirmation|approval|binding/i);
  assert.throws(() => parseAutomationEnvelope({ ...exact, intent: { ...exact.intent, proposal: { ...exact.intent.proposal, approvedScopePaths: ["src/other.ts"] } } }), /proposal|scope|manifest|intent/i);
  const repairIntent = exact.intent as Extract<typeof exact.intent, { kind: "repair_mission" }>;
  assert.throws(() => parseAutomationEnvelope({ ...exact, intent: { ...repairIntent, testEnvironment: { ...repairIntent.testEnvironment, digest: "0".repeat(64) } } }), /environment|proposal|scope|intent/i);
});

test("provider results echo the exact reviewed artifact correlation and reject cross-binding or omitted echoes", () => {
  for (const action of ["compound_capture", "compound_refresh", "lfg", "repair_mission"] as const) {
    const request = parseAutomationEnvelope(envelope(action));
    const binding = request.intent.binding;
    const value = {
      schema: `sxsy-b122.${action.replaceAll("_", "-")}-result`, version: 1, action, status: "completed",
      effectDisposition: action === "compound_refresh" ? "not_started" : "committed", summary: "bounded", externalId: `operation-${action}`,
      manifestId: binding.manifestId, manifestDigest: binding.manifestDigest, approvalId: binding.approvalId,
      reviewScopeDigest: binding.reviewScopeDigest, proposalDigest: binding.proposalDigest, result: result(action)
    } as const;
    const parsed = parseAutomationProviderResult(value, action, value.externalId, binding);
    assert.equal(parsed.manifestId, request.manifest.id);
    assert.equal(parsed.approvalId, request.approval.id);
    const { approvalId: _approvalId, ...missing } = value;
    assert.throws(() => parseAutomationProviderResult(missing, action, value.externalId, binding), /schema|binding|approval/i);
    assert.throws(() => parseAutomationProviderResult({ ...value, manifestDigest: "0".repeat(64) }, action, value.externalId, binding), /binding|manifest/i);
    assert.throws(() => parseAutomationProviderResult({ ...value, proposalDigest: "0".repeat(64) }, action, value.externalId, binding), /binding|proposal/i);
    assert.throws(() => parseAutomationProviderResult({ ...value, replay: true }, action, value.externalId, binding), /schema|binding/i);
  }
});

test("Refresh may report applied mutations only with exact companion delta evidence and an accepted target transition", () => {
  const request = parseAutomationEnvelope(envelope("compound_refresh"));
  const binding = request.intent.binding;
  const actualDelta = createAutomationActualDeltaEvidence({
    operationId: request.operationId,
    manifestId: binding.manifestId,
    manifestDigest: binding.manifestDigest,
    proposalDigest: binding.proposalDigest,
    fromTargetSnapshotId: binding.targetSnapshotId,
    mutations: [{
      path: refreshMutation.path,
      mutation: refreshMutation.mutation,
      beforeDigest: refreshMutation.beforeDigest,
      afterDigest: refreshMutation.afterDigest,
      byteLength: refreshMutation.content.byteLength,
      status: "applied"
    }]
  });
  const targetTransition = createAutomationAcceptedTargetTransitionEvidence({
    operationId: request.operationId,
    manifestId: binding.manifestId,
    fromTargetSnapshotId: binding.targetSnapshotId,
    toTargetSnapshotId: "0".repeat(64),
    actualDeltaDigest: actualDelta.digest,
    hostObservationDigest: "1".repeat(64),
    accepted: true
  });
  const value = {
    schema: "sxsy-b122.compound-refresh-result", version: 1, action: "compound_refresh", status: "completed",
    effectDisposition: "committed", summary: "reviewed refresh applied", externalId: request.operationId,
    manifestId: binding.manifestId, manifestDigest: binding.manifestDigest, approvalId: binding.approvalId,
    reviewScopeDigest: binding.reviewScopeDigest, proposalDigest: binding.proposalDigest,
    result: {
      kind: "compound_refresh", previewDigest: "a".repeat(64), affectedPaths: [refreshMutation.path],
      creates: 0, updates: 1, deletes: 0, mutationApplied: true, actualDelta, targetTransition
    }
  } as const;
  assert.equal(parseAutomationProviderResult(value, "compound_refresh", request.operationId, binding).result.mutationApplied, true);
  assert.throws(() => parseAutomationProviderResult({ ...value, result: { ...value.result, actualDelta: null } }, "compound_refresh", request.operationId, binding), /delta|evidence|mutation/i);
  assert.throws(() => parseAutomationProviderResult({ ...value, result: { ...value.result, targetTransition: { ...targetTransition, fromTargetSnapshotId: "f".repeat(64) } } }, "compound_refresh", request.operationId, binding), /transition|target|evidence/i);
  assert.throws(() => parseAutomationProviderResult({ ...value, effectDisposition: "not_started" }, "compound_refresh", request.operationId, binding), /status|disposition|mutation/i);
});

test("provider status, effect disposition, and result claims cannot contradict one another", () => {
  const request = parseAutomationEnvelope(envelope("compound_refresh"));
  const binding = request.intent.binding;
  const base = {
    schema: "sxsy-b122.compound-refresh-result", version: 1, action: "compound_refresh", status: "completed",
    effectDisposition: "not_started", summary: "preview only", externalId: request.operationId,
    manifestId: binding.manifestId, manifestDigest: binding.manifestDigest, approvalId: binding.approvalId,
    reviewScopeDigest: binding.reviewScopeDigest, proposalDigest: binding.proposalDigest,
    result: result("compound_refresh")
  } as const;
  assert.doesNotThrow(() => parseAutomationProviderResult(base, "compound_refresh", request.operationId, binding));
  assert.throws(() => parseAutomationProviderResult({ ...base, status: "running", effectDisposition: "committed" }, "compound_refresh", request.operationId, binding), /status|disposition/i);
  assert.doesNotThrow(() => parseAutomationProviderResult({ ...base, status: "running", effectDisposition: "ambiguous" }, "compound_refresh", request.operationId, binding));
  assert.throws(() => parseAutomationProviderResult({ ...base, status: "failed", effectDisposition: "committed" }, "compound_refresh", request.operationId, binding), /status|disposition/i);
  assert.throws(() => parseAutomationProviderResult({ ...base, effectDisposition: "committed" }, "compound_refresh", request.operationId, binding), /mutation|disposition/i);
  assert.throws(() => parseAutomationProviderResult({ ...base, status: "completed", effectDisposition: "ambiguous" }, "compound_refresh", request.operationId, binding), /status|disposition/i);
});

test("legacy inert or unreviewed intent construction and response shapes fail closed", () => {
  assert.throws(() => createAutomationIntent("compound_capture"), /manifest|approval|review/i);
  const exact = envelope("compound_refresh");
  assert.throws(() => parseAutomationEnvelope({
    schema: exact.schema, version: 1, action: exact.action, operationId: exact.operationId,
    target: exact.target, session: exact.session, authorityId: exact.authorityId, intent: exact.intent
  }), /manifest|approval|request/i);
  assert.throws(() => parseAutomationProviderResult({
    schema: "sxsy-b122.compound-refresh-result", version: 1, action: "compound_refresh", status: "completed",
    effectDisposition: "committed", summary: "bounded", externalId: "operation-compound_refresh", result: result("compound_refresh")
  }, "compound_refresh", "operation-compound_refresh", exact.intent.binding), /binding|manifest|approval/i);
});
