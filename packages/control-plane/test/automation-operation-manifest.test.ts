import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertAutomationManifestCurrent,
  automationManifestReviewScopeDigest,
  automationMutationScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest,
  parseAutomationManifestApproval,
  parseAutomationOperationManifest,
  type AutomationManifestContext,
  type AutomationOperationProposal
} from "../src/automation-operation-manifest.ts";

const digest = (character: string): string => character.repeat(64);
const textDigest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const exactContent = (value: string) => {
  const bytes = Buffer.from(value, "utf8");
  return {
    afterDigest: createHash("sha256").update(bytes).digest("hex"),
    content: { encoding: "base64" as const, byteLength: bytes.length, data: bytes.toString("base64") }
  };
};
const captureDocument = { path: "docs/solutions/boundary.md", mutation: "create" as const, beforeDigest: null, ...exactContent("# Boundary\n") };
const refreshDocument = { path: "docs/solutions/current.md", mutation: "update" as const, beforeDigest: digest("8"), ...exactContent("# Current\n") };
const lfgMutation = { path: "apps/companion/src/main.ts", mutation: "replace" as const, beforeDigest: digest("b"), ...exactContent("export const ready = true;\n") };
const repairMutation = { path: "apps/companion/src/main.ts", mutation: "update" as const, beforeDigest: digest("c"), ...exactContent("export const repaired = true;\n") };
const context: AutomationManifestContext = {
  repositoryRoot: "C:\\work\\repository",
  targetSnapshotId: digest("1"),
  sessionId: "session-1",
  authorityId: "authority-1",
  taskId: "task-1",
  planRevision: "plan-1",
  provider: "codex",
  createdAt: "2026-08-26T12:00:00.000Z",
  expiresAt: "2026-08-26T12:05:00.000Z"
};

const proposals: Readonly<Record<AutomationOperationProposal["kind"], AutomationOperationProposal>> = {
  compound_capture: {
    kind: "compound_capture",
    solvedProblemEvidenceDigest: digest("2"),
    verifiedOutcomeEvidenceDigest: digest("3"),
    nonTrivialRationale: "The verified fix establishes a reusable project-specific boundary.",
    documents: [captureDocument],
    instructionFileMutation: {
      kind: "edit_existing",
      path: "AGENTS.md",
      beforeDigest: digest("5"),
      ...exactContent("# Agent instructions\n")
    }
  },
  compound_refresh: {
    kind: "compound_refresh",
    audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [
      { path: "docs/solutions/old.md", mutation: "delete", beforeDigest: digest("7"), afterDigest: null, content: null },
      refreshDocument
    ],
    commit: { planned: true, messageDigest: textDigest("Refresh durable learning"), message: "Refresh durable learning" }
  },
  lfg: {
    kind: "lfg",
    requirementsSources: [{ path: "docs/requirements.md", digest: digest("b") }],
    approvedScopePaths: ["apps/companion/src/main.ts", "apps/companion/test/main.test.ts"],
    mutations: [lfgMutation],
    effectPlan: [
      { order: 0, kind: "plan", scopeDigest: digest("1") },
      { order: 1, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([lfgMutation]) },
      { order: 2, kind: "simplify", scopeDigest: digest("2") },
      { order: 3, kind: "review", scopeDigest: digest("3") },
      { order: 4, kind: "test", scopeDigest: digest("4") },
      { order: 5, kind: "git_commit", scopeDigest: digest("5") },
      { order: 6, kind: "git_push", scopeDigest: digest("6") },
      { order: 7, kind: "pull_request", scopeDigest: digest("7") },
      { order: 8, kind: "ci_watch", scopeDigest: digest("8") }
    ],
    authorizedActions: ["filesystem_mutation", "git_commit", "git_push", "pull_request", "ci_watch"],
    deployAuthorized: false
  },
  repair_mission: {
    kind: "repair_mission",
    failingGateId: "gate-typecheck",
    reproductionCommandDigest: digest("c"),
    approvedScopePaths: ["apps/companion/src/main.ts"],
    mutations: [repairMutation],
    affectedChecks: ["test:main"],
    fullChecks: ["test", "typecheck"],
    testEnvironment: { id: "test-environment-1", digest: digest("d"), egress: "deny", databaseName: "b122_test_1" },
    effectPlan: [
      { order: 0, kind: "sandbox_bind", scopeDigest: digest("d") },
      { order: 1, kind: "reproduce", scopeDigest: digest("c") },
      { order: 2, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([repairMutation]) },
      { order: 3, kind: "test_affected", scopeDigest: digest("e") },
      { order: 4, kind: "test_full", scopeDigest: digest("f") },
      { order: 5, kind: "review_diff", scopeDigest: digest("0") }
    ],
    pushAuthorized: false,
    mergeAuthorized: false,
    deployAuthorized: false,
    hostedRerunAuthorized: false,
    productionDataAuthorized: false
  }
};

test("all mutating automation actions produce immutable exact-scope review manifests", () => {
  for (const proposal of Object.values(proposals)) {
    const manifest = createAutomationOperationManifest(context, proposal);
    assert.equal(manifest.action, proposal.kind);
    assert.match(manifest.id, /^automation-manifest:[a-f0-9]{64}$/);
    assert.match(manifest.digest, /^[a-f0-9]{64}$/);
    assert.match(automationManifestReviewScopeDigest(manifest), /^[a-f0-9]{64}$/);
    assert.deepEqual(parseAutomationOperationManifest(JSON.parse(JSON.stringify(manifest))), manifest);
    assert.ok(Object.isFrozen(manifest));
    assert.ok(Object.isFrozen(manifest.proposal));
  }
});

test("capture review permits only a separately visible edit of an existing instruction file", () => {
  const base = proposals.compound_capture as Extract<AutomationOperationProposal, { kind: "compound_capture" }>;
  const noInstructionEdit = createAutomationOperationManifest(context, { ...base, instructionFileMutation: { kind: "none" } });
  assert.equal(noInstructionEdit.proposal.kind, "compound_capture");
  assert.deepEqual((noInstructionEdit.proposal as Extract<AutomationOperationProposal, { kind: "compound_capture" }>).instructionFileMutation, { kind: "none" });
  assert.throws(() => createAutomationOperationManifest(context, {
    ...base,
    instructionFileMutation: { kind: "edit_existing", path: "../AGENTS.md", beforeDigest: digest("5"), ...exactContent("# Agent instructions\n") }
  }), /path|instruction/i);
  assert.throws(() => parseAutomationOperationManifest({
    ...noInstructionEdit,
    proposal: { ...noInstructionEdit.proposal, instructionFileMutation: { kind: "create", path: "AGENTS.md", afterDigest: digest("6") } }
  }), /instruction|manifest/i);
});

test("refresh review requires the exact destructive scope and planned commit", () => {
  const refresh = proposals.compound_refresh as Extract<AutomationOperationProposal, { kind: "compound_refresh" }>;
  assert.throws(() => createAutomationOperationManifest(context, { ...refresh, mutations: [] }), /mutation|scope/i);
  assert.throws(() => createAutomationOperationManifest(context, {
    ...refresh,
    mutations: [{ path: "docs/solutions/current.md", mutation: "update", beforeDigest: null, ...exactContent("# Current\n") }]
  }), /before|mutation/i);
  assert.throws(() => createAutomationOperationManifest(context, { ...refresh, commit: { planned: true } as never }), /commit|digest/i);
});

test("reviewed filesystem effects contain exact bounded canonical bytes and explicit before/after state", () => {
  const capture = proposals.compound_capture as Extract<AutomationOperationProposal, { kind: "compound_capture" }>;
  assert.throws(() => createAutomationOperationManifest(context, {
    ...capture,
    documents: [{ path: "docs/missing-content.md", mutation: "create", beforeDigest: null, afterDigest: digest("1") }]
  }), /content|bytes|mutation/i);
  assert.throws(() => createAutomationOperationManifest(context, {
    ...capture,
    documents: [{ ...captureDocument, afterDigest: digest("1") }]
  }), /digest|content/i);
  assert.throws(() => createAutomationOperationManifest(context, {
    ...capture,
    documents: [{ ...captureDocument, path: "docs/../escape.md" }]
  }), /path|canonical/i);
  for (const path of ["docs/result.md:secret", "docs/con.txt", "docs/trailing. ", "docs/question?.md"]) {
    assert.throws(() => createAutomationOperationManifest(context, {
      ...capture,
      documents: [{ ...captureDocument, path }]
    }), /path|safe|canonical/i);
  }
  assert.throws(() => createAutomationOperationManifest(context, {
    ...capture,
    documents: [{ ...captureDocument, content: { ...captureDocument.content, data: `${captureDocument.content.data}\n` } }]
  }), /base64|content/i);
  const tooLarge = Buffer.alloc(4 * 1024 * 1024 + 1, 1);
  assert.throws(() => createAutomationOperationManifest(context, {
    ...capture,
    documents: [{
      path: "docs/too-large.bin", mutation: "create", beforeDigest: null,
      afterDigest: createHash("sha256").update(tooLarge).digest("hex"),
      content: { encoding: "base64", byteLength: tooLarge.length, data: tooLarge.toString("base64") }
    }]
  }), /bound|bytes|content/i);
});

test("lfg review binds requirements, repository scope, and the exact non-deploy wrapper", () => {
  const lfg = proposals.lfg as Extract<AutomationOperationProposal, { kind: "lfg" }>;
  assert.throws(() => createAutomationOperationManifest(context, { ...lfg, requirementsSources: [] }), /requirements/i);
  assert.throws(() => createAutomationOperationManifest(context, { ...lfg, approvedScopePaths: [] }), /scope/i);
  assert.throws(() => parseAutomationOperationManifest({
    ...createAutomationOperationManifest(context, lfg),
    proposal: { ...lfg, authorizedActions: [...lfg.authorizedActions, "deploy"], deployAuthorized: true }
  }), /lfg|manifest/i);
  assert.throws(() => createAutomationOperationManifest(context, {
    ...lfg,
    effectPlan: [lfg.effectPlan![1]!, lfg.effectPlan![0]!, ...lfg.effectPlan!.slice(2)]
  }), /order|effect plan|lfg/i);
});

test("Repair Mission review binds reproduction, approved paths, checks, and deny-egress isolation", () => {
  const repair = proposals.repair_mission as Extract<AutomationOperationProposal, { kind: "repair_mission" }>;
  assert.throws(() => createAutomationOperationManifest(context, { ...repair, approvedScopePaths: [] }), /scope/i);
  assert.throws(() => createAutomationOperationManifest(context, {
    ...repair,
    testEnvironment: { ...repair.testEnvironment, egress: "allow" as never }
  }), /egress|environment/i);
  assert.throws(() => createAutomationOperationManifest(context, { ...repair, pushAuthorized: true as never }), /repair|manifest/i);
  assert.throws(() => createAutomationOperationManifest(context, {
    ...repair,
    effectPlan: [{ ...repair.effectPlan![0]!, scopeDigest: digest("1") }, ...repair.effectPlan!.slice(1)]
  }), /sandbox|environment|effect plan/i);
});

test("approval is one exact artifact, review scope, actor binding, and bounded lifetime", () => {
  const manifest = createAutomationOperationManifest(context, proposals.lfg!);
  const approval = createAutomationManifestApproval({
    manifest,
    confirmationToken: "current-user-confirmation",
    confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
    confirmedAt: "2026-08-26T12:01:00.000Z",
    expiresAt: "2026-08-26T12:04:00.000Z"
  });
  assert.deepEqual(parseAutomationManifestApproval(JSON.parse(JSON.stringify(approval)), manifest), approval);
  assert.throws(() => createAutomationManifestApproval({
    manifest,
    confirmationToken: "current-user-confirmation",
    confirmationScopeDigest: digest("f"),
    confirmedAt: "2026-08-26T12:01:00.000Z",
    expiresAt: "2026-08-26T12:04:00.000Z"
  }), /scope/i);
  assert.throws(() => parseAutomationManifestApproval({ ...approval, authorityId: "authority-2" }, manifest), /approval/i);
});

test("final-current validation rejects target, session, authority, provider, task, plan, and expiry churn", () => {
  const manifest = createAutomationOperationManifest(context, proposals.repair_mission!);
  assert.doesNotThrow(() => assertAutomationManifestCurrent(manifest, context, "2026-08-26T12:04:59.000Z"));
  for (const [field, value] of [
    ["targetSnapshotId", digest("e")],
    ["sessionId", "session-2"],
    ["authorityId", "authority-2"],
    ["provider", "claude"],
    ["taskId", "task-2"],
    ["planRevision", "plan-2"]
  ] as const) {
    assert.throws(() => assertAutomationManifestCurrent(manifest, { ...context, [field]: value }, "2026-08-26T12:04:59.000Z"), /current|binding/i);
  }
  assert.throws(() => assertAutomationManifestCurrent(manifest, context, context.expiresAt), /expired/i);
});
