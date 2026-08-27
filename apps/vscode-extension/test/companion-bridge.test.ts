import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  forwardedHostAction,
  forwardedWorkflowResult,
  JsonLineCompanionBridge,
  type ExtensionManagedSession,
  type JsonLineTransport
} from "../src/companion-bridge.ts";
import {
  automationManifestReviewScopeDigest,
  automationMutationScopeDigest,
  createAutomationOperationManifest,
  type AutomationOperationProposal
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";

const automationDigest = (character: string): string => character.repeat(64);
const reviewedMutation = (path: string, mutation: "create" | "update" | "replace", beforeDigest: string | null, text: string) => {
  const bytes = Buffer.from(text, "utf8");
  return {
    path, mutation, beforeDigest, afterDigest: createHash("sha256").update(bytes).digest("hex"),
    content: { encoding: "base64" as const, byteLength: bytes.length, data: bytes.toString("base64") }
  };
};
const captureMutation = reviewedMutation("docs/solutions/boundary.md", "create", null, "# Boundary\n");
const refreshMutation = reviewedMutation("docs/solutions/current.md", "update", automationDigest("5"), "# Current\n");
const lfgMutation = reviewedMutation("apps/companion/src/main.ts", "replace", automationDigest("6"), "export const ready = true;\n");
const repairMutation = reviewedMutation("apps/companion/src/main.ts", "update", automationDigest("7"), "export const repaired = true;\n");
const automationProposals: Readonly<Record<AutomationOperationProposal["kind"], AutomationOperationProposal>> = {
  compound_capture: {
    kind: "compound_capture", solvedProblemEvidenceDigest: automationDigest("2"), verifiedOutcomeEvidenceDigest: automationDigest("3"),
    nonTrivialRationale: "The verified boundary is reusable.",
    documents: [captureMutation],
    instructionFileMutation: { kind: "none" }
  },
  compound_refresh: {
    kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [refreshMutation],
    commit: { planned: false }
  },
  lfg: {
    kind: "lfg", requirementsSources: [{ path: "docs/requirements.md", digest: automationDigest("7") }], approvedScopePaths: ["apps/companion/src/main.ts"],
    mutations: [lfgMutation], effectPlan: [
      { order: 0, kind: "plan", scopeDigest: automationDigest("1") }, { order: 1, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([lfgMutation]) },
      { order: 2, kind: "simplify", scopeDigest: automationDigest("2") }, { order: 3, kind: "review", scopeDigest: automationDigest("3") },
      { order: 4, kind: "test", scopeDigest: automationDigest("4") }, { order: 5, kind: "git_commit", scopeDigest: automationDigest("5") },
      { order: 6, kind: "git_push", scopeDigest: automationDigest("6") }, { order: 7, kind: "pull_request", scopeDigest: automationDigest("7") },
      { order: 8, kind: "ci_watch", scopeDigest: automationDigest("8") }
    ], authorizedActions: ["filesystem_mutation", "git_commit", "git_push", "pull_request", "ci_watch"], deployAuthorized: false
  },
  repair_mission: {
    kind: "repair_mission", failingGateId: "gate-typecheck", reproductionCommandDigest: automationDigest("8"),
    approvedScopePaths: ["apps/companion/src/main.ts"], mutations: [repairMutation], affectedChecks: ["test:main"], fullChecks: ["test", "typecheck"],
    testEnvironment: { id: "test-environment-1", digest: automationDigest("9"), egress: "deny", databaseName: "b122_test_1" },
    effectPlan: [
      { order: 0, kind: "sandbox_bind", scopeDigest: automationDigest("9") }, { order: 1, kind: "reproduce", scopeDigest: automationDigest("8") },
      { order: 2, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([repairMutation]) },
      { order: 3, kind: "test_affected", scopeDigest: automationDigest("a") }, { order: 4, kind: "test_full", scopeDigest: automationDigest("b") },
      { order: 5, kind: "review_diff", scopeDigest: automationDigest("c") }
    ],
    pushAuthorized: false, mergeAuthorized: false, deployAuthorized: false, hostedRerunAuthorized: false, productionDataAuthorized: false
  }
};

function automationReview(action: AutomationOperationProposal["kind"]) {
  const manifest = createAutomationOperationManifest({
    repositoryRoot: "C:\\isolated\\repo", targetSnapshotId: automationDigest("1"), sessionId: "provider-session", authorityId: "authority-automation",
    taskId: "task-automation", planRevision: "plan-automation", provider: "codex",
    createdAt: "2026-08-26T12:00:00.000Z", expiresAt: "2026-08-26T12:05:00.000Z"
  }, automationProposals[action]);
  return { action, manifest, reviewScopeDigest: automationManifestReviewScopeDigest(manifest) } as const;
}

function reanchorStatus(state: "pending_confirmation" | "recorded") {
  const requestId = `reanchor:${"a".repeat(64)}`;
  const operationId = `reanchor-operation:${"b".repeat(64)}`;
  const oldTargetSnapshotId = "c".repeat(64);
  const newTargetSnapshotId = "d".repeat(64);
  const report = {
    summary: "Provider reread the exact protected context and remains stopped.",
    discrepancies: ["The reviewed target changed."],
    risks: ["The provider remains stopped."],
    questions: ["Should the revised task boundary be accepted?"],
    result: "reanchored_without_resume" as const
  };
  const status = {
    schema: "sxsy-b122.installed-reanchor-status" as const,
    version: 1 as const,
    requestId,
    operationId,
    sessionId: "session-reanchor",
    authorityId: "authority-existing",
    oldTargetSnapshotId,
    newTargetSnapshotId,
    state,
    summary: state === "recorded" ? report.summary : "Read-only Re-anchor preview.",
    discrepancies: [...report.discrepancies],
    risks: [...report.risks],
    questions: [...report.questions],
    confirmationScopeDigest: "e".repeat(64),
    confirmationExpiresAt: "2026-08-26T12:02:00.000Z"
  };
  if (state !== "recorded") return status;
  return {
    ...status,
    receipt: {
      version: 1 as const,
      id: `reanchor-receipt:${"f".repeat(64)}`,
      requestId,
      operationId,
      oldTargetSnapshotId,
      newTargetSnapshotId,
      sessionId: status.sessionId,
      authorityId: status.authorityId,
      previewDigest: "1".repeat(64),
      confirmationDigest: "2".repeat(64),
      confirmationScopeDigest: status.confirmationScopeDigest,
      externalEffectId: "provider-effect-1",
      acknowledgementDigest: "3".repeat(64),
      artifactDigest: "4".repeat(64),
      rereadEvidence: {
        contextDigest: "5".repeat(64),
        authorityDigest: "6".repeat(64),
        instructionDigests: ["7".repeat(64)],
        planDigest: "8".repeat(64),
        documentationDigests: ["9".repeat(64)],
        currentWorkDigest: "a".repeat(64),
        inspectedTargetSnapshotId: newTargetSnapshotId
      },
      report,
      sessionRebindOutcome: "rebound" as const,
      resultingBindingDigest: "b".repeat(64),
      resumed: false as const,
      evidenceDigest: "c".repeat(64),
      result: "reanchored_without_resume" as const,
      createdAt: "2026-08-26T12:01:00.000Z"
    }
  };
}

test("the Re-anchor bridge uses only dedicated closed routes and exact-parses the no-resume report", async () => {
  const seen: Array<{ method: string; payload: unknown }> = [];
  const final = reanchorStatus("recorded");
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload: unknown };
      seen.push({ method: request.method, payload: request.payload });
      const result = request.method === "reanchor.authority.list"
        ? { authorities: [{ id: "authority-existing", issuedBy: "TEST\\Reviewer", expiresAt: "2026-08-26T12:10:00.000Z" }] }
        : request.method === "reanchor.hardware.begin"
          ? { reanchor: reanchorStatus("pending_confirmation"), dispatchReceiptId: `hardware-dispatch:${"f".repeat(64)}` }
        : { reanchor: request.method === "reanchor.begin" ? reanchorStatus("pending_confirmation") : final };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result });
    }
  }, "reanchor-vscode");

  const authorities = await bridge.listReanchorAuthorities("session-reanchor");
  assert.ok(authorities.ok && authorities.value.length === 1);
  const begun = await bridge.beginReanchor({ sessionId: "session-reanchor", authorityId: "authority-existing", reason: "Reread the exact protected context." });
  assert.ok(begun.ok && begun.value.state === "pending_confirmation");
  const claim = {
    signalId: `hardware-signal:${"1".repeat(64)}`, claimToken: "claim-token-reanchor", deviceId: "device-one", connectionEpoch: 1, bootNonce: 1, counter: 1,
    control: "REANCHOR" as const, modifier: "normal" as const, acceptedAt: "2026-08-26T12:00:00.000Z", claimedAt: "2026-08-26T12:00:01.000Z", attempt: 1,
    windowSessionId: "window-one", workspaceRoots: ["C:/isolated/repo"]
  };
  const hardwareBegun = await bridge.beginHardwareReanchor(claim, { sessionId: "session-reanchor", authorityId: "authority-existing", reason: "Reread the exact protected context." });
  assert.ok(hardwareBegun.ok && hardwareBegun.value.dispatchReceiptId === `hardware-dispatch:${"f".repeat(64)}`);
  const confirmed = await bridge.confirmReanchor(`reanchor:${"a".repeat(64)}`);
  assert.ok(confirmed.ok && confirmed.value.receipt?.result === "reanchored_without_resume" && confirmed.value.receipt.resumed === false);
  const inspected = await bridge.getReanchor(`reanchor:${"a".repeat(64)}`);
  assert.ok(inspected.ok && inspected.value.state === "recorded");

  assert.deepEqual(seen.map(({ method }) => method), ["reanchor.authority.list", "reanchor.begin", "reanchor.hardware.begin", "reanchor.confirm-apply", "reanchor.get"]);
  assert.deepEqual(seen.map(({ payload }) => payload), [
    { sessionId: "session-reanchor" },
    { sessionId: "session-reanchor", authorityId: "authority-existing", reason: "Reread the exact protected context." },
    { signalId: claim.signalId, claimToken: claim.claimToken, windowSessionId: claim.windowSessionId, workspaceRoots: claim.workspaceRoots, sessionId: "session-reanchor", authorityId: "authority-existing", reason: "Reread the exact protected context." },
    { requestId: `reanchor:${"a".repeat(64)}` },
    { requestId: `reanchor:${"a".repeat(64)}` }
  ]);
  assert.equal(JSON.stringify(seen).includes("confirmationToken"), false);
  assert.equal(JSON.stringify(seen).includes("TargetSnapshot"), false);
});

test("the Re-anchor bridge rejects malformed reports and any resumed final receipt", async () => {
  const valid = reanchorStatus("recorded") as ReturnType<typeof reanchorStatus> & { receipt: Record<string, unknown> };
  let response: unknown = { ...valid, receipt: { ...valid.receipt, report: { ...(valid.receipt.report as object), extra: true } } };
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: { reanchor: response } });
    }
  }, "reanchor-negative");

  assert.equal((await bridge.confirmReanchor(`reanchor:${"a".repeat(64)}`)).ok, false);
  response = { ...valid, receipt: { ...valid.receipt, resumed: true } };
  assert.equal((await bridge.confirmReanchor(`reanchor:${"a".repeat(64)}`)).ok, false);
  response = { ...valid, receipt: { ...valid.receipt, report: { ...(valid.receipt.report as object), result: "stopped_without_reread" } } };
  assert.equal((await bridge.confirmReanchor(`reanchor:${"a".repeat(64)}`)).ok, false);
});

const session: ExtensionManagedSession = {
  id: "vscode-window-1",
  provider: "generic",
  surface: "vscode_window",
  capabilities: ["registered"],
  status: "unknown",
  workspaceRoot: "C:/isolated/repo",
  plannedFiles: [],
  lastHeartbeat: "2026-08-23T00:00:00.000Z",
  adapterVersion: "test",
  metadata: {}
};

function readyContainmentIncident(repositoryRoot: string, fenceEpoch: number, activationOperationId: string) {
  const id = `containment-incident:${"a".repeat(64)}`;
  return {
    version: 1 as const, id, repositoryRoot, fenceEpoch, activationOperationId, reason: "reviewed incident",
    createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:02.000Z", status: "ready_for_release" as const,
    assessment: { generation: 1, purpose: "initial" as const, targetSnapshotId: "snapshot-containment", basedOnFindingIds: [], basedOnReceiptIds: [], credentialRotationRequired: false, startedAt: "2026-08-25T00:00:00.000Z" },
    steps: (["working_tree", "history", "remote"] as const).map((step) => ({
      name: step, operationId: `assessment-${step}`, externalId: `external-${step}`, status: "completed" as const,
      attempts: 1, updatedAt: "2026-08-25T00:00:01.000Z",
      result: { schema: "sxsy-b122.containment-assessment-result" as const, version: 1 as const, incidentId: id, repositoryRoot, fenceEpoch, step, operationId: `assessment-${step}`, externalId: `external-${step}`, effectDisposition: "committed" as const, status: "passed" as const, exposure: "none" as const, summary: "No exposure found.", findings: [] }
    })),
    permits: [], receipts: [],
    rotation: { disposition: "not_required" as const, evidenceReference: "reviewed", evidenceDigest: "b".repeat(64), reviewedAt: "2026-08-25T00:00:02.000Z" }
  };
}

test("the VS Code JSON-lines client sends bounded companion methods and preserves matching responses", async () => {
  const seen: Array<{ id: string; method: string; payload: unknown }> = [];
  const transport: JsonLineTransport = {
    async request(line) {
      const request = JSON.parse(line) as { version: number; id: string; method: string; payload: unknown };
      seen.push({ id: request.id, method: request.method, payload: request.payload });
      if (request.method === "command.dispatch") {
        return JSON.stringify({ version: 1, id: request.id, ok: true, result: { command: { status: "unavailable", summary: "No mediated execution broker is attached." } } });
      }
      if (request.method === "command.prepare") {
        return JSON.stringify({ version: 1, id: request.id, ok: true, result: { preparation: { status: "prepared", summary: "Exact scope prepared.", authorityId: "authority" } } });
      }
      if (request.method === "git.review.submit") {
        return JSON.stringify({ version: 1, id: request.id, ok: true, result: { review: { status: "approved", summary: "Exact Git mutation reviewed." } } });
      }
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: (request.payload as { session: ExtensionManagedSession }).session });
    }
  };
  const bridge = new JsonLineCompanionBridge(transport, "isolated-vscode");

  const registered = await bridge.registerSession(session);
  assert.equal(registered.ok, true);
  if (registered.ok) assert.equal(registered.value.id, session.id);

  const prepared = await bridge.prepareCommand({ control: "RUN", modifier: "normal", sessionId: session.id, reason: "operator requested run" });
  assert.equal(prepared.ok, true);
  if (prepared.ok) assert.equal(prepared.value.authorityId, "authority");

  const reviewed = await bridge.reviewGitMutation({ action: "local_commit", sessionId: session.id, mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe" } });
  assert.equal(reviewed.ok, true);
  if (reviewed.ok) assert.equal(reviewed.value.status, "approved");

  const dispatched = await bridge.dispatch({ control: "RUN", modifier: "normal", sessionId: session.id });
  assert.equal(dispatched.ok, true);
  if (dispatched.ok) assert.equal(dispatched.value.status, "unavailable");
  assert.deepEqual(seen.map((entry) => entry.method), ["session.register", "command.prepare", "git.review.submit", "command.dispatch"]);
  assert.equal(seen.every((entry) => entry.id.startsWith("isolated-vscode-")), true);
});

test("Plan Approval preparation exact-parses the protected review packet and echoes only its reviewed scope", async () => {
  const boundSession = { ...session, provider: "codex" as const, targetSnapshotId: "1".repeat(64), taskId: "task-plan", planRevision: "revision-plan" };
  const workflowReview = {
    action: "plan_approval",
    sessionId: boundSession.id,
    targetSnapshotId: boundSession.targetSnapshotId,
    repositoryRoot: boundSession.workspaceRoot,
    provider: "codex",
    contextId: "provider-context-1",
    observedAt: "2026-08-25T00:00:00.000Z",
    adapter: { id: "configured-provider-host", version: "1.2.3", moduleSha256: "2".repeat(64) },
    plan: {
      digest: "3".repeat(64), revision: boundSession.planRevision, originSessionId: "origin-session", taskId: boundSession.taskId,
      objective: "Execute only the immutable reviewed plan.",
      steps: [{ id: "step-1", summary: "Review and execute.", ownedFiles: ["src/plan.ts"], dependencies: [], status: "approved" }],
      decisions: ["Keep the protected target unchanged."],
      expectedTargetTransition: { beforeTargetSnapshotId: boundSession.targetSnapshotId, expectedAfterTargetSnapshotId: boundSession.targetSnapshotId, expectation: "unchanged" }
    },
    scopeDigest: "4".repeat(64),
    summary: "Exact provider-observed plan scope.",
    providerContextDigest: "5".repeat(64),
    sourceRevision: 3
  } as const;
  let final = false;
  let corrupt = false;
  const seen: unknown[] = [];
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; payload: unknown };
      seen.push(request.payload);
      const preparation = final
        ? { status: "prepared", summary: "Confirmed unchanged review.", session: boundSession, authorityId: "authority-plan", confirmationToken: "confirmation-plan", confirmationScopeDigest: workflowReview.scopeDigest }
        : { status: "incomplete", summary: "Review required.", session: boundSession, workflowReview: corrupt ? { ...workflowReview, extra: true } : workflowReview };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: { preparation } });
    }
  }, "plan-review-vscode");

  const first = await bridge.prepareCommand({ control: "PLAN_APPROVAL", modifier: "normal", sessionId: boundSession.id, reason: "Review exact plan" });
  assert.ok(first.ok && first.value.workflowReview?.scopeDigest === workflowReview.scopeDigest);
  final = true;
  const second = await bridge.prepareCommand({ control: "PLAN_APPROVAL", modifier: "normal", sessionId: boundSession.id, reason: "Review exact plan", reviewScopeDigest: workflowReview.scopeDigest });
  assert.ok(second.ok && second.value.confirmationScopeDigest === workflowReview.scopeDigest);
  assert.equal((seen[1] as { reviewScopeDigest?: string }).reviewScopeDigest, workflowReview.scopeDigest);
  final = false;
  corrupt = true;
  assert.equal((await bridge.prepareCommand({ control: "PLAN_APPROVAL", modifier: "normal", sessionId: boundSession.id, reason: "Review exact plan" })).ok, false);
  corrupt = false;
  const transitioned = { ...workflowReview, plan: { ...workflowReview.plan, expectedTargetTransition: { ...workflowReview.plan.expectedTargetTransition, expectedAfterTargetSnapshotId: "9".repeat(64) } } };
  const tampered = new JsonLineCompanionBridge({ async request(line) { const request = JSON.parse(line) as { id: string }; return JSON.stringify({ version: 1, id: request.id, ok: true, result: { preparation: { status: "incomplete", summary: "tampered", session: boundSession, workflowReview: transitioned } } }); } }, "plan-transition-tamper");
  assert.equal((await tampered.prepareCommand({ control: "PLAN_APPROVAL", modifier: "normal", sessionId: boundSession.id, reason: "Review exact plan" })).ok, false);
});

test("automation preparation recomputes every manifest digest and review scope for all four protected actions", async () => {
  const providerSession: ExtensionManagedSession = {
    ...session, id: "provider-session", provider: "codex", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running",
    workspaceRoot: "C:\\isolated\\repo", targetSnapshotId: automationDigest("1"), taskId: "task-automation", planRevision: "plan-automation"
  };
  let prepared: unknown;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: { preparation: prepared } });
    }
  }, "automation-review-vscode");

  for (const action of ["compound_capture", "compound_refresh", "lfg", "repair_mission"] as const) {
    const review = automationReview(action);
    prepared = { status: "incomplete", summary: "Review exact immutable automation manifest.", session: providerSession, authorityId: "authority-automation", automationReview: review };
    const result = await bridge.prepareCommand({ control: action === "repair_mission" ? "PIPELINE" : "COMPOUND", modifier: action === "compound_capture" ? "normal" : "shift", sessionId: providerSession.id, reason: "review" });
    assert.ok(result.ok && result.value.automationReview?.action === action, action);
  }

  const exact = automationReview("repair_mission");
  for (const changed of [
    { ...exact, manifest: { ...exact.manifest, digest: automationDigest("a"), id: `automation-manifest:${automationDigest("a")}` } },
    { ...exact, reviewScopeDigest: automationDigest("b") },
    { ...exact, manifest: { ...exact.manifest, proposal: { ...exact.manifest.proposal, extra: true } } },
    { ...exact, manifest: { ...exact.manifest, sessionId: "substituted-session" } }
  ]) {
    prepared = { status: "incomplete", summary: "malicious substitution", session: providerSession, authorityId: "authority-automation", automationReview: changed };
    assert.equal((await bridge.prepareCommand({ control: "PIPELINE", modifier: "ctrl_shift_alt", sessionId: providerSession.id, reason: "review" })).ok, false);
  }
});

test("debug-stop preparation carries the effect only in phase one and dispatch carries only the provider source", async () => {
  const providerSession: ExtensionManagedSession = {
    ...session, id: "provider-source", provider: "codex", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running",
    targetSnapshotId: automationDigest("1"), taskId: "task-debug", planRevision: "plan-debug"
  };
  const review = {
    schema: "sxsy-b122.debug-stop-review" as const, version: 1 as const, action: "stop_managed_run" as const,
    bindingId: `debug-stop:${automationDigest("2")}`, bindingDigest: automationDigest("3"), reviewScopeDigest: automationDigest("4"),
    sourceSessionId: providerSession.id, authorityId: "authority-debug", targetSnapshotId: providerSession.targetSnapshotId!, repositoryRoot: providerSession.workspaceRoot!,
    originOperationId: "operation-debug", effectKind: "debug_session", debugSessionId: "debug-1", debugBindingId: "debug-binding-1", debugConfiguration: "Launch test", managedProcessId: null,
    createdAt: "2026-08-26T12:00:00.000Z", expiresAt: "2026-08-26T12:05:00.000Z"
  };
  const seen: Array<{ method: string; payload: Record<string, unknown> }> = [];
  let phase = 0;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload: Record<string, unknown> };
      seen.push({ method: request.method, payload: request.payload });
      phase += 1;
      const result = request.method === "command.dispatch"
        ? { command: { status: "completed", summary: "Exact stop dispatched." } }
        : { preparation: phase === 1
            ? { status: "incomplete", summary: "Review exact split binding.", session: providerSession, authorityId: "authority-debug", debugStopReview: review }
            : { status: "prepared", summary: "Exact split binding confirmed.", session: providerSession, authorityId: "authority-debug", confirmationToken: "confirmation-debug", confirmationScopeDigest: review.reviewScopeDigest, confirmationExpiresAt: "2026-08-26T12:04:00.000Z" } };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result });
    }
  }, "debug-stop-vscode");

  assert.equal((await bridge.prepareCommand({ control: "RUN", modifier: "alt", sessionId: providerSession.id, effectSessionId: "debug-effect", reason: "stop" })).ok, true);
  assert.equal((await bridge.prepareCommand({ control: "RUN", modifier: "alt", sessionId: providerSession.id, reason: "stop", reviewScopeDigest: review.reviewScopeDigest, reviewArtifactId: review.bindingId, reviewArtifactDigest: review.bindingDigest })).ok, true);
  assert.equal((await bridge.dispatch({ control: "RUN", modifier: "alt", sessionId: providerSession.id, authorityId: "authority-debug", confirmationToken: "confirmation-debug", confirmationScopeDigest: review.reviewScopeDigest })).ok, true);
  assert.equal(seen[0]?.payload.effectSessionId, "debug-effect");
  assert.equal(Object.hasOwn(seen[1]!.payload, "effectSessionId"), false);
  assert.equal(Object.hasOwn(seen[2]!.payload, "effectSessionId"), false);
  assert.deepEqual(seen.map(({ method }) => method), ["command.prepare", "command.prepare", "command.dispatch"]);
});

test("stop-debug host effects require the exact public effect and protected binding while other actions forbid both", () => {
  const base = {
    hostActionId: `host-action:${automationDigest("c")}`, hostActionKind: "stop_vscode_debug", hostActionExpiresAt: "2026-08-26T12:05:00.000Z",
    hostActionWorkspaceRoot: "C:\\isolated\\repo", hostActionDebugConfiguration: "Launch test", hostActionDebugSessionId: "debug-1",
    hostActionDebugEffectSessionId: "debug-effect", hostActionDebugBindingId: "debug-binding-1", hostActionDebugOriginOperationId: "operation-debug"
  } as const;
  assert.equal(forwardedHostAction({ status: "running", summary: "stop", data: base })?.debugEffectSessionId, "debug-effect");
  for (const missing of ["hostActionDebugEffectSessionId", "hostActionDebugBindingId"] as const) {
    const data = { ...base } as Record<string, unknown>;
    delete data[missing];
    assert.equal(forwardedHostAction({ status: "running", summary: "stop", data }), undefined);
  }
  assert.equal(forwardedHostAction({ status: "running", summary: "start", data: { ...base, hostActionKind: "start_vscode_debug", hostActionDebugSessionId: undefined } }), undefined);
  assert.equal(forwardedHostAction({ status: "running", summary: "terminal", data: { hostActionId: base.hostActionId, hostActionKind: "focus_integrated_terminal", hostActionExpiresAt: base.hostActionExpiresAt, hostActionDebugEffectSessionId: "debug-effect", hostActionDebugBindingId: "debug-binding-1" } }), undefined);
});

test("venv host-effect parsing requires one exact interpreter path plus digest and filesystem identity", () => {
  const pythonInterpreter = "C:\\isolated\\repo\\.venv\\Scripts\\python.exe";
  const identity = { canonicalPath: pythonInterpreter, sha256: automationDigest("7"), device: "1", inode: "2", size: 42, modifiedMs: 1_777_000_000_000 };
  const base = {
    hostActionId: `host-action:${automationDigest("8")}`, hostActionKind: "configure_python_venv", hostActionExpiresAt: "2026-08-26T12:05:00.000Z",
    hostActionWorkspaceRoot: "C:\\isolated\\repo", hostActionPythonInterpreter: pythonInterpreter, hostActionPythonInterpreterIdentity: identity
  } as const;
  assert.deepEqual(forwardedHostAction({ status: "running", summary: "venv", data: base })?.pythonInterpreterIdentity, identity);
  assert.equal(forwardedHostAction({ status: "running", summary: "missing identity", data: { ...base, hostActionPythonInterpreterIdentity: undefined } }), undefined);
  assert.equal(forwardedHostAction({ status: "running", summary: "path substitution", data: { ...base, hostActionPythonInterpreterIdentity: { ...identity, canonicalPath: "C:\\isolated\\other\\python.exe" } } }), undefined);
  assert.equal(forwardedHostAction({ status: "running", summary: "digest substitution", data: { ...base, hostActionPythonInterpreterIdentity: { ...identity, sha256: "not-a-digest" } } }), undefined);
});

test("containment IPC exact-parses the active fence inspection and carries both expected release bindings", async () => {
  const seen: Array<{ method: string; payload: unknown }> = [];
  const incident = readyContainmentIncident(session.workspaceRoot!, 9, "operation-containment-9");
  const containment = {
    sessionId: session.id,
    repositoryRoot: session.workspaceRoot!,
    active: true,
    fenceEpoch: 9,
    activatedByOperationId: "operation-containment-9",
    hookStates: [
      { name: "credential_lease_revocation", status: "completed", attempts: 1, updatedAt: "2026-08-25T00:00:00.000Z" },
      { name: "queued_operation_cancellation", status: "completed", attempts: 1, updatedAt: "2026-08-25T00:00:01.000Z" }
    ],
    hookFailures: [],
    uncontrolledPaths: ["unmediated-local-user-processes"],
    incident,
    incidentDigest: "c".repeat(64)
  } as const;
  const verifiedContainment = {
    ...containment,
    incident: {
      ...incident,
      status: "remediation_required" as const,
      assessment: {
        generation: 2,
        purpose: "post_remediation" as const,
        targetSnapshotId: "snapshot-remediated",
        basedOnFindingIds: [`containment-finding:${"f".repeat(64)}`],
        basedOnReceiptIds: [`containment-remediation-receipt:${"e".repeat(64)}`],
        credentialRotationRequired: true,
        sourceIncidentDigest: containment.incidentDigest,
        startedAt: "2026-08-25T00:01:00.000Z"
      }
    },
    incidentDigest: "d".repeat(64)
  } as const;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload: unknown };
      seen.push({ method: request.method, payload: request.payload });
      const result = request.method === "containment.inspect"
        ? { containment }
        : request.method === "containment.verify"
          ? { containment: verifiedContainment }
          : request.method === "containment.history.rewrite"
            ? { remediation: {
                operationId: `containment-history:${"1".repeat(64)}`, incidentId: incident.id, permitId: `containment-remediation-permit:${"2".repeat(64)}`,
                repositoryRoot: containment.repositoryRoot, branch: "feature/contained", oldHead: "3".repeat(40), newHead: "4".repeat(40),
                backupBundlePath: "C:\\state\\history\\before.bundle", backupBundleSha256: "5".repeat(64), incidentDigest: "6".repeat(64),
                updatedRefs: [{ refName: "refs/heads/feature/contained", kind: "head", oldObject: "3".repeat(40), newObject: "4".repeat(40), oldPeeledCommit: "3".repeat(40), newPeeledCommit: "4".repeat(40) }],
                strippedTagSignatures: 0, status: "completed"
              } }
          : { command: { status: "completed", summary: "Exact containment generation released." } };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result });
    }
  }, "containment-vscode");

  const inspected = await bridge.inspectContainment(session.id);
  assert.equal(inspected.ok, true);
  if (inspected.ok) assert.equal(inspected.value.fenceEpoch, 9);
  const verified = await bridge.verifyContainmentRemediation({ sessionId: session.id, expectedIncidentId: incident.id, expectedIncidentDigest: containment.incidentDigest });
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(verified.value.incident.assessment.generation, 2);
  const historyRequest = {
    sessionId: session.id, expectedIncidentId: incident.id, expectedIncidentDigest: containment.incidentDigest,
    permitId: `containment-remediation-permit:${"2".repeat(64)}`, relativePaths: ["config/local.env"], remediatedFindingIds: [`containment-finding:${"f".repeat(64)}`]
  };
  const rewritten = await bridge.rewriteContainmentHistory(historyRequest);
  assert.equal(rewritten.ok, true);
  if (rewritten.ok) assert.equal(rewritten.value.newHead, "4".repeat(40));
  const request = {
    sessionId: session.id,
    reason: "Reviewed exact active containment generation.",
    expectedFenceEpoch: 9,
    expectedActivationOperationId: "operation-containment-9",
    expectedIncidentId: incident.id,
    expectedIncidentDigest: containment.incidentDigest
  };
  const released = await bridge.releaseContainment(request);
  assert.equal(released.ok, true);
  assert.deepEqual(seen, [
    { method: "containment.inspect", payload: { sessionId: session.id } },
    { method: "containment.verify", payload: { sessionId: session.id, expectedIncidentId: incident.id, expectedIncidentDigest: containment.incidentDigest } },
    { method: "containment.history.rewrite", payload: historyRequest },
    { method: "containment.release", payload: request }
  ]);
});

test("containment IPC rejects a mismatched session, incomplete hook inventory, or response extras", async () => {
  const incident = readyContainmentIncident(session.workspaceRoot!, 3, "operation-containment-3");
  const valid = {
    sessionId: session.id,
    repositoryRoot: session.workspaceRoot!,
    active: true,
    fenceEpoch: 3,
    activatedByOperationId: "operation-containment-3",
    hookStates: [
      { name: "credential_lease_revocation", status: "completed", attempts: 1, updatedAt: "2026-08-25T00:00:00.000Z" },
      { name: "queued_operation_cancellation", status: "completed", attempts: 1, updatedAt: "2026-08-25T00:00:01.000Z" }
    ],
    hookFailures: [],
    uncontrolledPaths: [],
    incident,
    incidentDigest: "c".repeat(64)
  };
  const invalid = [
    { ...valid, sessionId: "different-session" },
    { ...valid, hookStates: valid.hookStates.slice(0, 1) },
    { ...valid, unreviewedExtra: true }
  ];
  for (const containment of invalid) {
    const bridge = new JsonLineCompanionBridge({
      async request(line) {
        const request = JSON.parse(line) as { id: string };
        return JSON.stringify({ version: 1, id: request.id, ok: true, result: { containment } });
      }
    }, "invalid-containment");
    const result = await bridge.inspectContainment(session.id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_response");
  }
});

test("signed remote-evidence bridge carries only incident/file selections and exact-parses host-derived identities", async () => {
  const seen: Array<{ method: string; payload: unknown }> = [];
  const trust = {
    schema: "sxsy-b122.containment-remote-trust-policy", version: 1, purpose: "containment-remote-assessment",
    authorityId: "independent-remote-auditor", keyId: "6".repeat(64), publicKeyPem: "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----",
    expiresAt: "2026-08-25T12:30:00.000Z", installedAt: "2026-08-25T12:00:00.000Z", installedBy: "TEST\\Security", status: "active"
  } as const;
  const challenge = {
    id: `containment-remote-challenge:${"7".repeat(64)}`, incidentId: `containment-incident:${"8".repeat(64)}`,
    generation: 2, targetSnapshotId: `target:${"9".repeat(64)}`,
    configuredRemotes: [{ name: "origin", canonicalIdentity: "https://github.com/example/switchyard.git" }],
    issuedAt: "2026-08-25T12:00:00.000Z", expiresAt: "2026-08-25T12:10:00.000Z", status: "active",
    challengePath: "C:\\state\\containment-remote\\challenge.json"
  } as const;
  const evidence = {
    evidenceId: `containment-remote-evidence:${"a".repeat(64)}`, challengeId: challenge.id,
    documentSha256: "b".repeat(64), expiresAt: "2026-08-25T12:08:00.000Z", status: "available"
  } as const;
  let corruptChallenge = false;
  const bridge = new JsonLineCompanionBridge({ async request(line) {
    const request = JSON.parse(line) as { id: string; method: string; payload: unknown };
    seen.push({ method: request.method, payload: request.payload });
    const result = request.method === "containment.remote.trust.install" || request.method === "containment.remote.trust.revoke"
      ? { trust: request.method.endsWith("revoke") ? { ...trust, status: "revoked", revokedAt: "2026-08-25T12:01:00.000Z" } : trust }
      : request.method === "containment.remote.trust.list" ? { trust: [trust] }
        : request.method === "containment.remote.challenge.issue" ? { challenge: corruptChallenge ? { ...challenge, refs: [] } : challenge }
          : request.method === "containment.remote.challenge.list" ? { challenges: [challenge] }
            : request.method === "containment.remote.evidence.import" ? { evidence }
              : { evidence: [evidence] };
    return JSON.stringify({ version: 1, id: request.id, ok: true, result });
  } }, "containment-remote-vscode");

  const exact = { sessionId: session.id, expectedIncidentId: challenge.incidentId, expectedIncidentDigest: "c".repeat(64) } as const;
  assert.equal((await bridge.installContainmentRemoteTrust("C:\\reviewed\\trust.json")).ok, true);
  assert.equal((await bridge.listContainmentRemoteTrust()).ok, true);
  assert.equal((await bridge.issueContainmentRemoteChallenge({ ...exact, expiresAt: challenge.expiresAt })).ok, true);
  assert.equal((await bridge.listContainmentRemoteChallenges()).ok, true);
  assert.equal((await bridge.importContainmentRemoteEvidence({ ...exact, sourcePath: "C:\\reviewed\\evidence.json" })).ok, true);
  assert.equal((await bridge.listContainmentRemoteEvidence()).ok, true);
  assert.equal((await bridge.revokeContainmentRemoteTrust(trust.authorityId, trust.keyId, "reviewed revocation")).ok, true);
  assert.deepEqual(seen[2], { method: "containment.remote.challenge.issue", payload: { ...exact, expiresAt: challenge.expiresAt } });
  assert.deepEqual(seen[4], { method: "containment.remote.evidence.import", payload: { ...exact, sourcePath: "C:\\reviewed\\evidence.json" } });
  assert.equal(JSON.stringify([seen[2], seen[4]]).includes("configuredRemotes"), false);
  assert.equal(JSON.stringify([seen[2], seen[4]]).includes("refs"), false);

  corruptChallenge = true;
  const rejected = await bridge.issueContainmentRemoteChallenge({ ...exact, expiresAt: challenge.expiresAt });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "invalid_response");
});

test("Council recommendation approval exact-parses the immutable digest binding and rejects forged authority", async () => {
  const input = {
    recommendationId: "recommendation-1", recommendationDigest: "a".repeat(64), approvalOperationId: "council-review:vscode-1",
    repositoryRoot: "C:/isolated/repo", targetSnapshotId: "c".repeat(64), sessionId: session.id
  };
  let corrupt: "none" | "authority" | "assignment" = "none";
  const seen: unknown[] = [];
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload: unknown };
      seen.push({ method: request.method, payload: request.payload });
      const recommendation = {
        id: input.recommendationId, digest: input.recommendationDigest, reportId: `council-report:${"b".repeat(64)}`, reportDigest: "b".repeat(64),
        repositoryRoot: input.repositoryRoot, targetSnapshotId: input.targetSnapshotId, participantSessionIds: [session.id],
        assignments: corrupt === "assignment"
          ? { substituted: { sessionId: "substituted", paths: ["src/safe.ts"], resources: ["port:45100"] } }
          : { [session.id]: { sessionId: session.id, paths: ["src/safe.ts"], resources: ["port:45100"] } },
        reviewScopeDigest: "d".repeat(64), preparationOperationId: "operation-prepare", ready: true, status: "approved",
        approvalOperationId: input.approvalOperationId, executionAuthorized: corrupt === "authority", createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:01:00.000Z"
      };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: { recommendation } });
    }
  }, "council-review-vscode");

  const approved = await bridge.approveCouncilRecommendation(input);
  assert.ok(approved.ok && approved.value.status === "approved" && approved.value.executionAuthorized === false);
  assert.deepEqual(seen[0], { method: "council.recommendation.approve", payload: input });
  corrupt = "authority";
  const forged = await bridge.approveCouncilRecommendation(input);
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.code, "invalid_response");
  corrupt = "assignment";
  const crossParticipant = await bridge.approveCouncilRecommendation(input);
  assert.equal(crossParticipant.ok, false);
  if (!crossParticipant.ok) assert.equal(crossParticipant.code, "invalid_response");
});

test("credential IPC carries exact scope triples and rejects a broadened durable receipt", async () => {
  const scopes = [
    { repositoryRoot: "C:/isolated/repo", adapterId: "configured-network", purpose: "provider-api" },
    { repositoryRoot: "C:/isolated/repo", adapterId: "council-resource-host", purpose: "council-session" }
  ] as const;
  const seen: unknown[] = [];
  let broaden = false;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload: unknown };
      assert.equal(request.method, "credential.provision");
      seen.push(request.payload);
      return JSON.stringify({
        version: 1,
        id: request.id,
        ok: true,
        result: {
          credential: {
            reference: "provider-read",
            protectorProvider: "windows-dpapi-current-user",
            generation: 1,
            createdAt: "2026-08-25T00:00:00.000Z",
            updatedAt: "2026-08-25T00:00:00.000Z",
            scopes: broaden ? [...scopes, { repositoryRoot: "C:/other/repo", adapterId: "configured-network", purpose: "provider-api" }] : scopes
          }
        }
      });
    }
  }, "credential-vscode");
  const input = { reference: "provider-read", scopes, sealedSecret: "dpapi-current-user-envelope" } as const;
  const accepted = await bridge.provisionCredential(input);
  assert.equal(accepted.ok, true);
  assert.deepEqual(seen[0], input);
  assert.equal(JSON.stringify(seen[0]).includes("cleartext"), false);
  broaden = true;
  const rejected = await bridge.provisionCredential(input);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "invalid_response");
});

test("malformed or mismatched local-companion replies fail closed in the extension bridge", async () => {
  const malformed = new JsonLineCompanionBridge({ request: async () => "not json" });
  const malformedResult = await malformed.dispatch({ control: "RUN", modifier: "normal" });
  assert.equal(malformedResult.ok, false);
  if (!malformedResult.ok) assert.equal(malformedResult.code, "invalid_response");

  const mismatched = new JsonLineCompanionBridge({
    request: async () => JSON.stringify({ version: 1, id: "other-request", ok: true, result: {} })
  });
  const mismatchedResult = await mismatched.dispatch({ control: "RUN", modifier: "normal" });
  assert.equal(mismatchedResult.ok, false);
  if (!mismatchedResult.ok) assert.equal(mismatchedResult.code, "invalid_response");
});

test("managed-session listing accepts only the strict protected-registry shape", async () => {
  let malformed = false;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload?: Record<string, unknown> };
      assert.equal(request.method, "session.list");
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: malformed ? [{ ...session, capabilities: ["registered", "fabricated"] }] : [session] });
    }
  });
  const accepted = await bridge.listSessions();
  assert.equal(accepted.ok, true);
  malformed = true;
  const rejected = await bridge.listSessions();
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "invalid_response");
});

test("non-picker URL authorization accepts only an exact URL rebound by the companion", async () => {
  const hostActionId = `host-action:${"a".repeat(64)}`;
  let malformed = false;
  const expectedUrl = "http://127.0.0.1:4317/";
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload: unknown };
      assert.equal(request.method, "host-action.authorize");
      assert.deepEqual(request.payload, { hostActionId, adapterVersion: "extension-1" });
      const authorization = malformed
        ? { hostActionId, authorizationToken: `host-action-auth:${"b".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z", url: "http://127.0.0.1:4318/" }
        : { hostActionId, authorizationToken: `host-action-auth:${"b".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z", url: expectedUrl };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: { authorization } });
    }
  });
  const accepted = await bridge.authorizeHostAction(hostActionId, "extension-1", undefined, expectedUrl);
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.value.url, expectedUrl);
  malformed = true;
  const rejected = await bridge.authorizeHostAction(hostActionId, "extension-1", undefined, expectedUrl);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "invalid_response");
});

test("GitHub picker authorization binds one exact requested candidate and companion-selected URL", async () => {
  const hostActionId = `host-action:${"c".repeat(64)}`;
  let corrupt = false;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload: unknown };
      assert.equal(request.method, "host-action.authorize");
      assert.deepEqual(request.payload, { hostActionId, adapterVersion: "extension-1", selectionId: "pull:3" });
      const authorization = corrupt
        ? { hostActionId, authorizationToken: `host-action-auth:${"d".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z", selectionId: "pull:2", url: "https://evil.invalid/" }
        : { hostActionId, authorizationToken: `host-action-auth:${"d".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z", selectionId: "pull:3", url: "https://github.com/acme/project/pull/3" };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: { authorization } });
    }
  });
  const accepted = await bridge.authorizeHostAction(hostActionId, "extension-1", "pull:3");
  assert.equal(accepted.ok, true);
  corrupt = true;
  const rejected = await bridge.authorizeHostAction(hostActionId, "extension-1", "pull:3");
  assert.equal(rejected.ok, false);
});

test("acceptance and scanner administration replies are strict and preserve host-owned identities", async () => {
  const keyId = "a".repeat(64);
  const trust = { schema: "sxsy-b122.acceptance-trust-policy", version: 1, authorityId: "lab", keyId, publicKeyPem: "PUBLIC KEY", allowedGates: [8], expiresAt: "2027-08-24T00:00:00.000Z", installedAt: "2026-08-24T00:00:00.000Z", installedBy: "reviewer", status: "active" };
  const fixture = { id: "scanner-feed", kind: "scanner", packageRoot: "C:/state/scanner-feed", manifestSha256: "b".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", installedBy: "reviewer", status: "active" };
  let corrupt = false;
  const bridge = new JsonLineCompanionBridge({ async request(line) {
    const request = JSON.parse(line) as { id: string; method: string; payload?: unknown };
    const result = request.method === "acceptance.trust.install" ? { trust: corrupt ? { ...trust, allowedGates: [0] } : trust }
      : request.method === "acceptance.trust.list" ? { trust: [trust] }
        : request.method === "scanner.fixture.install" ? { fixture }
          : request.method === "scanner.fixture.list" ? { fixtures: [fixture] }
            : { revoked: true };
    return JSON.stringify({ version: 1, id: request.id, ok: true, result });
  } }, "admin-vscode");
  const installed = await bridge.installAcceptanceTrust("C:/reviewed/trust.json");
  assert.equal(installed.ok, true);
  assert.equal((await bridge.listAcceptanceTrust()).ok, true);
  assert.equal((await bridge.installScannerFixture("C:/reviewed/scanner.json")).ok, true);
  assert.equal((await bridge.listScannerFixtures()).ok, true);
  assert.deepEqual(await bridge.revokeScannerFixture("scanner-feed", "retired"), { ok: true, value: true });
  corrupt = true;
  assert.equal((await bridge.installAcceptanceTrust("C:/reviewed/trust.json")).ok, false);
});

test("provider administration and managed-terminal host effects preserve only exact compiled identities", async () => {
  const seen: Array<{ method: string; payload?: unknown }> = [];
  const installation = {
    provider: "codex", installationId: "provider-install:codex", catalogDigest: "a".repeat(64),
    identity: {
      canonicalExecutablePath: "C:\\Program Files\\SXSY\\codex.exe", executableSha256: "b".repeat(64),
      signerSubject: "CN=Isolated Provider Test", signerThumbprint: "a".repeat(40),
      productIdentity: { productId: "openai.codex", displayName: "Codex", publisher: "OpenAI, L.L.C.", role: "managed_terminal" },
      size: 42, modifiedMs: 1, device: "3894844051", inode: "59672695062879660"
    },
    operator: "Current User", installedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:00:00.000Z", status: "active"
  } as const;
  const profile = {
    provider: "codex", profileName: "SXSY-B122 Codex", canonicalLauncherPath: "C:\\Program Files\\SXSY\\sxsy-b122-provider-desktop-helper.exe",
    launcherSha256: "c".repeat(64), launcherProtocolVersion: 1,
    canonicalExecutablePath: installation.identity.canonicalExecutablePath,
    executableSha256: installation.identity.executableSha256, signerSubject: installation.identity.signerSubject, signerThumbprint: installation.identity.signerThumbprint, executableSize: installation.identity.size,
    executableModifiedMs: installation.identity.modifiedMs, executableDevice: installation.identity.device, executableInode: installation.identity.inode,
    productIdentity: installation.identity.productIdentity,
    args: [], shell: false, installationId: installation.installationId, catalogDigest: installation.catalogDigest,
    issuedAt: "2026-08-24T00:00:00.000Z", validUntil: "2026-08-24T00:00:20.000Z", requiresFinalIdentityVerification: true
  } as const;
  let corrupt: "none" | "installation" | "wrong_provider" | "duplicates" | "profile" = "none";
  const bridge = new JsonLineCompanionBridge({ async request(line) {
    const request = JSON.parse(line) as { id: string; method: string; payload?: unknown };
    seen.push({ method: request.method, ...(request.payload !== undefined ? { payload: request.payload } : {}) });
    const returnedInstallation = corrupt === "installation"
      ? { ...installation, identity: { ...installation.identity, productIdentity: { ...installation.identity.productIdentity, productId: "substituted.product" } } }
      : corrupt === "wrong_provider"
        ? { ...installation, provider: "claude_desktop", identity: { ...installation.identity, canonicalExecutablePath: "C:\\Program Files\\SXSY\\claude.exe", productIdentity: { productId: "anthropic.claude-desktop", displayName: "Claude Desktop", publisher: "Anthropic, PBC", role: "desktop" } } }
        : installation;
    const result = request.method === "provider-desktop.install" || request.method === "provider-desktop.revoke"
      ? { installation: returnedInstallation }
      : request.method === "provider-desktop.list"
        ? { installations: corrupt === "duplicates" ? [installation, installation] : [installation] }
        : { command: { status: "running", summary: "Exact terminal pending.", data: {
            hostActionId: `host-action:${"c".repeat(64)}`, hostActionKind: "create_codex_terminal", hostActionExpiresAt: "2026-08-24T00:00:20.000Z",
            managedTerminalProfile: corrupt === "profile" ? { ...profile, profileName: "Substituted" } : profile
          } } };
    return JSON.stringify({ version: 1, id: request.id, ok: true, result });
  } }, "provider-vscode");

  assert.equal((await bridge.installProviderDesktop("codex")).ok, true);
  assert.equal((await bridge.listProviderDesktops()).ok, true);
  assert.equal((await bridge.revokeProviderDesktop("codex")).ok, true);
  assert.deepEqual(seen.slice(0, 3), [
    { method: "provider-desktop.install", payload: { provider: "codex" } },
    { method: "provider-desktop.list" },
    { method: "provider-desktop.revoke", payload: { provider: "codex" } }
  ]);

  const dispatched = await bridge.dispatch({ control: "CLAUDE", modifier: "ctrl_shift_alt" });
  assert.ok(dispatched.ok && forwardedHostAction(dispatched.value)?.managedTerminalProfile?.provider === "codex");
  corrupt = "installation";
  assert.equal((await bridge.installProviderDesktop("codex")).ok, false);
  corrupt = "wrong_provider";
  assert.equal((await bridge.installProviderDesktop("codex")).ok, false);
  corrupt = "duplicates";
  assert.equal((await bridge.listProviderDesktops()).ok, false);
  corrupt = "profile";
  const substituted = await bridge.dispatch({ control: "CLAUDE", modifier: "ctrl_shift_alt" });
  assert.ok(substituted.ok);
  if (substituted.ok) assert.equal(forwardedHostAction(substituted.value), undefined);
});

test("Voice Center claim transport is closed, exact, and carries one durable lease through authorization and settlement", async () => {
  const seen: Array<{ method: string; payload?: Record<string, unknown> }> = [];
  let corrupt = false;
  const binding = { windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"], adapterVersion: "1.2.3", capabilities: ["show_voice_center"], focused: true } as const;
  const claim = {
    version: 1,
    claimId: `host-action-claim:${"a".repeat(64)}`,
    claimToken: "extension-voice-claim-token",
    hostActionId: `host-action:${"b".repeat(64)}`,
    operationId: "operation-voice-center",
    commandAction: "open_voice",
    hostActionKind: "show_voice_center",
    windowSessionId: session.id,
    adapterVersion: "1.2.3",
    capabilities: ["show_voice_center"],
    claimedAt: "2026-08-25T12:00:00.000Z",
    expiresAt: "2026-08-25T12:00:05.000Z",
    actionExpiresAt: "2026-08-25T12:00:30.000Z"
  } as const;
  const bridge = new JsonLineCompanionBridge({ async request(line) {
    const request = JSON.parse(line) as { id: string; method: string; payload?: Record<string, unknown> };
    seen.push({ method: request.method, ...(request.payload ? { payload: request.payload } : {}) });
    const result = request.method === "host-action.claim"
      ? { claim: corrupt ? { ...claim, capabilities: ["show_voice_center", "open_external_url"] } : claim }
      : request.method === "host-action.authorize"
        ? { authorization: { hostActionId: claim.hostActionId, authorizationToken: `host-action-auth:${"c".repeat(64)}`, expiresAt: claim.expiresAt } }
        : { command: { status: "completed", summary: "Voice Center settled.", operationId: claim.operationId } };
    return JSON.stringify({ version: 1, id: request.id, ok: true, result });
  } }, "voice-bridge");

  const claimed = await bridge.claimHostAction(binding);
  assert.ok(claimed.ok && claimed.value);
  if (!claimed.ok || !claimed.value) return;
  const reference = { claimId: claimed.value.claimId, claimToken: claimed.value.claimToken, windowSessionId: claimed.value.windowSessionId };
  const authorization = await bridge.authorizeHostAction(claim.hostActionId, binding.adapterVersion, undefined, undefined, reference);
  assert.equal(authorization.ok, true);
  const completed = await bridge.completeHostAction(claim.hostActionId, true, "Opened the real Voice Center.", binding.adapterVersion, authorization.ok ? authorization.value.authorizationToken : undefined, "committed", reference);
  assert.equal(completed.ok, true);
  assert.deepEqual(seen.map((entry) => entry.method), ["host-action.claim", "host-action.authorize", "host-action.complete"]);
  assert.deepEqual(seen[0]?.payload, binding);
  for (const payload of [seen[1]?.payload, seen[2]?.payload]) {
    assert.equal(payload?.claimId, claim.claimId);
    assert.equal(payload?.claimToken, claim.claimToken);
    assert.equal(payload?.windowSessionId, claim.windowSessionId);
  }

  corrupt = true;
  const broadened = await bridge.claimHostAction(binding);
  assert.equal(broadened.ok, false);
  if (!broadened.ok) assert.equal(broadened.code, "invalid_response");
});

test("targeted Voice claim transport preserves the exact command, target, source session, and workspace root", async () => {
  const binding = { windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo", "C:/isolated/second"], adapterVersion: "1.2.3", capabilities: ["show_voice_center"], focused: true } as const;
  let commandAction: "switch_voice_provider" | "bind_voice_session" | "voice_session_picker" | "hostile" = "bind_voice_session";
  let workspaceRoot = "C:/isolated/repo";
  const bridge = new JsonLineCompanionBridge({ async request(line) {
    const request = JSON.parse(line) as { id: string };
    return JSON.stringify({ version: 1, id: request.id, ok: true, result: { claim: {
      version: 1,
      claimId: `host-action-claim:${"1".repeat(64)}`,
      claimToken: "targeted-voice-claim-token",
      hostActionId: `host-action:${"2".repeat(64)}`,
      operationId: "operation-targeted-voice",
      commandAction,
      hostActionKind: "show_voice_center",
      targetSnapshotId: "target-targeted-voice",
      sessionId: "provider-session-targeted-voice",
      workspaceRoot,
      windowSessionId: session.id,
      adapterVersion: "1.2.3",
      capabilities: ["show_voice_center"],
      claimedAt: "2026-08-25T12:00:00.000Z",
      expiresAt: "2026-08-25T12:00:05.000Z",
      actionExpiresAt: "2026-08-25T12:00:30.000Z"
    } } });
  } }, "targeted-voice-bridge");

  const exact = await bridge.claimHostAction(binding);
  assert.ok(exact.ok && exact.value);
  if (exact.ok && exact.value) {
    assert.equal(exact.value.commandAction, "bind_voice_session");
    assert.equal(exact.value.targetSnapshotId, "target-targeted-voice");
    assert.equal(exact.value.sessionId, "provider-session-targeted-voice");
    assert.equal(exact.value.workspaceRoot, "C:/isolated/repo");
  }
  workspaceRoot = "C:/isolated/other";
  assert.equal((await bridge.claimHostAction(binding)).ok, false, "a claim for a repository outside this VS Code window must be rejected");
  workspaceRoot = "C:/isolated/repo";
  commandAction = "hostile";
  assert.equal((await bridge.claimHostAction(binding)).ok, false, "the closed Voice command set must reject broadened actions");
});

test("hardware bridge never sends a client-selected chord and carries the server dispatch receipt into completion", async () => {
  const seen: Array<{ method: string; payload: Record<string, unknown> | undefined }> = [];
  const signalId = `hardware-signal:${"a".repeat(64)}`;
  const claimToken = "claim-token-bridge";
  const dispatchReceiptId = `hardware-dispatch:${"b".repeat(64)}`;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload?: Record<string, unknown> };
      seen.push({ method: request.method, payload: request.payload });
      if (request.method === "hardware-signal.claim") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { claim: { signalId, claimToken, deviceId: "c".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 3, control: "SHIELD", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"] } } });
      if (request.method === "hardware-signal.prepare") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { preparation: { status: "prepared", summary: "prepared", authorityId: "authority" } } });
      if (request.method === "hardware-signal.dispatch") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { command: { status: "completed", summary: "handled" }, dispatchReceiptId } });
      if (request.method === "hardware-signal.complete") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { completion: { signalId, outcome: "handled" } } });
      return JSON.stringify({ version: 1, id: request.id, ok: false, error: { code: "unknown_method", message: "unexpected" } });
    }
  });
  const claim = await bridge.claimHardwareSignal({ windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"], focused: true });
  assert.equal(claim.ok, true);
  assert.ok(claim.ok && claim.value);
  if (!claim.ok || !claim.value) return;
  const prepared = await bridge.prepareHardwareSignal(
    claim.value,
    session.id,
    "Focused physical chord",
    "d".repeat(64),
    "workflow-artifact-authority",
    "e".repeat(64)
  );
  assert.equal(prepared.ok, true);
  const dispatched = await bridge.dispatchHardwareSignal(claim.value, { sessionId: session.id, authorityId: "authority", confirmationToken: "confirmation", confirmationScopeDigest: "d".repeat(64) });
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) return;
  await bridge.completeHardwareSignal(claim.value, { outcome: "handled", summary: "Mediated dispatch returned.", dispatchReceiptId: dispatched.value.dispatchReceiptId, dispatchSessionId: session.id, repositoryRoot: "C:/isolated/repo" });

  const dispatchPayload = seen.find((entry) => entry.method === "hardware-signal.dispatch")?.payload;
  const preparationPayload = seen.find((entry) => entry.method === "hardware-signal.prepare")?.payload;
  assert.equal(preparationPayload?.reviewScopeDigest, "d".repeat(64));
  assert.equal(preparationPayload?.reviewArtifactId, "workflow-artifact-authority");
  assert.equal(preparationPayload?.reviewArtifactDigest, "e".repeat(64));
  assert.equal("control" in (dispatchPayload ?? {}), false);
  assert.equal("modifier" in (dispatchPayload ?? {}), false);
  assert.equal(dispatchPayload?.confirmationScopeDigest, "d".repeat(64));
  assert.equal(seen.find((entry) => entry.method === "hardware-signal.complete")?.payload?.dispatchReceiptId, dispatchReceiptId);
});

test("Raw-HID and hardware response schemas fail closed on malformed or mismatched durable identities", async () => {
  const signalId = `hardware-signal:${"a".repeat(64)}`;
  const claimToken = "claim-token-schema";
  let responseKind: "bad-claim" | "bad-dispatch" | "bad-completion" | "bad-list" = "bad-claim";
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string };
      const result = responseKind === "bad-claim"
        ? { claim: { signalId, claimToken, deviceId: "c".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 3, control: "NOT_A_CHORD", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"] } }
        : responseKind === "bad-dispatch"
          ? { command: { status: "completed", summary: "handled" }, dispatchReceiptId: "client-forged" }
          : responseKind === "bad-completion"
            ? { completion: { signalId: `hardware-signal:${"d".repeat(64)}`, outcome: "handled" } }
            : { installations: {} };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result });
    }
  });

  const malformedClaim = await bridge.claimHardwareSignal({ windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"], focused: true });
  assert.equal(malformedClaim.ok, false);
  if (!malformedClaim.ok) assert.equal(malformedClaim.code, "invalid_response");

  const claim = { signalId, claimToken, deviceId: "c".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 3, control: "SHIELD", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"] } as const;
  responseKind = "bad-dispatch";
  const malformedDispatch = await bridge.dispatchHardwareSignal(claim, { sessionId: session.id });
  assert.equal(malformedDispatch.ok, false);
  responseKind = "bad-completion";
  const mismatchedCompletion = await bridge.completeHardwareSignal(claim, { outcome: "handled", summary: "done", dispatchReceiptId: `hardware-dispatch:${"b".repeat(64)}` });
  assert.equal(mismatchedCompletion.ok, false);
  responseKind = "bad-list";
  const malformedList = await bridge.listRawHid();
  assert.equal(malformedList.ok, false);
});

test("Handoff, typed workflow, and private voice replies are strictly validated across the installed bridge", async () => {
  const methods: string[] = [];
  const handoff = {
    id: "handoff-1", digest: "a".repeat(64), repositoryRoot: "C:/isolated/repo", targetSnapshotId: "target-1", taskId: "task-1", planRevision: "plan-1",
    plan: "Finish the exact plan.", decisions: ["Keep mediation."], documentation: ["docs/design.md"], references: ["ref-1"], constraints: ["Fail closed."], openQuestions: [], nextActions: ["Verify."],
    recipientSessionId: "recipient-1", status: "queued", executionAuthorized: false, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z"
  } as const;
  const artifact = {
    action: "handoff", repositoryRoot: handoff.repositoryRoot, targetSnapshotId: handoff.targetSnapshotId, sessionId: session.id,
    authorityId: "authority-1",
    payload: { kind: "handoff", packageId: handoff.id, route: "queue", recipientSessionId: handoff.recipientSessionId }, id: "artifact-1", digest: "b".repeat(64),
    status: "prepared", executionAuthorized: false, createdAt: "2026-08-24T00:00:01.000Z", updatedAt: "2026-08-24T00:00:01.000Z"
  } as const;
  const consent = {
    id: "consent-1", repositoryRoot: handoff.repositoryRoot, targetSnapshotId: handoff.targetSnapshotId, contextPackageId: handoff.id, contextDigest: handoff.digest,
    provider: "claude", operatorPresenceId: "presence-1", transcript: "off", retentionMinutes: 0, grantedAt: "2026-08-24T00:00:02.000Z", expiresAt: "2026-08-24T00:15:02.000Z"
  } as const;
  const binding = {
    id: "binding-1", consentId: consent.id, voiceSessionId: "voice-session-1", managedSessionId: session.id, repositoryRoot: handoff.repositoryRoot,
    targetSnapshotId: handoff.targetSnapshotId, contextPackageId: handoff.id, contextDigest: handoff.digest, provider: "claude", transcript: "off", retentionMinutes: 0,
    status: "active", createdAt: "2026-08-24T00:00:03.000Z", updatedAt: "2026-08-24T00:00:03.000Z"
  } as const;
  let corrupt = false;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string };
      methods.push(request.method);
      const result = request.method === "handoff.create" ? { handoff }
        : request.method === "handoff.list" ? { handoffs: [handoff] }
          : request.method === "handoff.routing.get" ? { routing: "queue" }
            : request.method === "workflow.prepare" ? { artifact: corrupt ? { ...artifact, executionAuthorized: true } : artifact }
              : request.method === "workflow.list" ? { artifacts: [artifact] }
                : request.method === "workflow.cancel" ? { artifact: corrupt ? { ...artifact, status: "cancelled", sessionId: "substituted-session" } : { ...artifact, status: "cancelled" } }
                : request.method === "voice.consent" ? { consent }
                  : request.method === "voice.current" ? { binding }
                    : { binding };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result });
    }
  }, "workflow-vscode");

  assert.equal((await bridge.createHandoff({ sessionId: session.id, recipientSessionId: "recipient-1", plan: handoff.plan, decisions: handoff.decisions, documentation: handoff.documentation, references: handoff.references, constraints: handoff.constraints, openQuestions: handoff.openQuestions, nextActions: handoff.nextActions })).ok, true);
  assert.equal((await bridge.listHandoffs()).ok, true);
  assert.deepEqual(await bridge.handoffRouting(), { ok: true, value: "queue" });
  assert.equal((await bridge.prepareWorkflow({ action: "handoff", sessionId: session.id, authorityId: "authority-1", intent: { kind: "handoff", recipientSessionId: "recipient-1", route: "default" } })).ok, true);
  assert.equal((await bridge.listWorkflows()).ok, true);
  const cancelled = await bridge.cancelWorkflow({ artifactId: artifact.id, sessionId: session.id, authorityId: "authority-1" });
  assert.equal(cancelled.ok, true);
  assert.equal(methods.includes("workflow.cancel"), true);
  assert.equal((await bridge.grantVoiceConsent({ handoffId: handoff.id, provider: "claude", transcript: "off", retentionMinutes: 0, expiresInMinutes: 15 })).ok, true);
  assert.equal((await bridge.startVoice({ consentId: consent.id, voiceSessionId: binding.voiceSessionId, managedSessionId: session.id })).ok, true);
  assert.equal((await bridge.currentVoice()).ok, true);
  assert.equal((await bridge.bindVoice(binding.id, session.id)).ok, true);
  assert.equal(methods.includes("voice.bind"), true);

  corrupt = true;
  const forgedAuthority = await bridge.prepareWorkflow({ action: "handoff", sessionId: session.id, authorityId: "authority-1", intent: { kind: "handoff", recipientSessionId: "recipient-1", route: "default" } });
  assert.equal(forgedAuthority.ok, false);
  if (!forgedAuthority.ok) assert.equal(forgedAuthority.code, "invalid_response");
  const substitutedCancellation = await bridge.cancelWorkflow({ artifactId: artifact.id, sessionId: session.id, authorityId: "authority-1" });
  assert.equal(substitutedCancellation.ok, false);
  if (!substitutedCancellation.ok) assert.equal(substitutedCancellation.code, "invalid_response");
});

test("durable workflow results preserve only the exact bounded provider-result envelope", async () => {
  const anchor = {
    kind: "anchor",
    anchorDigest: "c".repeat(64),
    discrepancies: ["The implementation differs from the accepted plan."],
    questions: ["Should the reviewed boundary remain unchanged?"],
    resumed: false
  } as const;
  let data: Record<string, unknown> = {
    artifactId: "artifact-result-1",
    artifactDigest: "d".repeat(64),
    resultKind: "anchor",
    workflowResult: anchor,
    providerSummary: "The protected Re-anchor result is ready.",
    externalId: "provider-result-1"
  };
  const bridge = new JsonLineCompanionBridge({ async request(line) {
    const request = JSON.parse(line) as { id: string; method: string };
    assert.equal(request.method, "command.dispatch");
    return JSON.stringify({ version: 1, id: request.id, ok: true, result: { command: { status: "completed", summary: "Re-anchor completed.", data } } });
  } }, "workflow-result-vscode");

  const accepted = await bridge.dispatch({ control: "REANCHOR", modifier: "normal" });
  assert.ok(accepted.ok);
  if (!accepted.ok) return;
  assert.deepEqual(forwardedWorkflowResult(accepted.value), anchor);

  const variants = [
    { kind: "proof", verifiedClaims: [], evidenceReferences: [], backendResults: [{ backend: "local", status: "passed" }] },
    { kind: "decision", decisionPacketId: "packet-1", decisions: [{ decisionId: "decision-1", options: [
      { id: "option-1", label: "One", tradeoffs: ["Tradeoff one"], risks: ["Risk one"] },
      { id: "option-2", label: "Two", tradeoffs: ["Tradeoff two"], risks: ["Risk two"] }
    ], recommendationId: "option-1" }], userSelectionRequired: true },
    { kind: "plan", mode: "expanded", planDigest: "e".repeat(64), alternatives: Array.from({ length: 15 }, (_, index) => ({ rank: index + 1, id: `alternative-${index + 1}`, summary: `Alternative ${index + 1}`, rationale: `Rationale ${index + 1}`, risks: [] })) },
    { kind: "plan", mode: "execution_ack", planDigest: "e".repeat(64), planRevision: "revision-1", originSessionId: "origin-1", executorSessionId: "executor-1", authorityId: "authority-1", acknowledgementId: "ack-1", executionStarted: true },
    { kind: "handoff", packageId: "handoff-1", recipientSessionId: "recipient-1", acknowledged: true },
    { kind: "focus", selectedSessionId: "session-1", status: "verified_blocked", queueCycleId: "cycle-1", resultDelivered: true },
    { kind: "authority", acknowledgements: [{ recipientSessionId: "recipient-1", grantId: "grant-1", matchDigest: "f".repeat(64), acknowledged: true }] },
    { kind: "voice_binding", bindingId: "binding-1", active: true }
  ] as const;
  for (const workflowResult of variants) {
    data = { ...data, resultKind: workflowResult.kind, workflowResult };
    const variant = await bridge.dispatch({ control: "REANCHOR", modifier: "normal" });
    assert.ok(variant.ok && forwardedWorkflowResult(variant.value)?.kind === workflowResult.kind);
  }

  data = { ...data, resultKind: "proof", workflowResult: anchor };
  assert.equal((await bridge.dispatch({ control: "REANCHOR", modifier: "normal" })).ok, false);
  data = { ...data, resultKind: "anchor", workflowResult: anchor, unexpected: "not allowed" };
  assert.equal((await bridge.dispatch({ control: "REANCHOR", modifier: "normal" })).ok, false);
  data = { ...data };
  delete data.unexpected;
  data.workflowResult = { ...anchor, questions: ["x".repeat(16_385)] };
  assert.equal((await bridge.dispatch({ control: "REANCHOR", modifier: "normal" })).ok, false);
  data = { ...data, workflowResult: anchor, providerSummary: "   " };
  assert.equal((await bridge.dispatch({ control: "REANCHOR", modifier: "normal" })).ok, false);
});
