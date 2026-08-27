import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { AutomationRequest, GitRequest } from "../../../packages/control-plane/src/brokers.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import {
  automationManifestReviewScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { createAutomationIntent, type AutomationEnvelope } from "../../../packages/control-plane/src/automation-protocol.ts";
import { sessionBindingDigest } from "../../../packages/control-plane/src/session-registry.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import type { CheckpointGitRunner } from "../src/local-checkpoints.ts";
import { InstalledAutomationRefreshGitCommitObserver, InstalledAutomationRefreshGitCommitPort } from "../src/automation-refresh-git.ts";

const d = (value: string) => createHash("sha256").update(value).digest("hex");
const root = process.platform === "win32" ? "C:\\work\\repo" : "/work/repo";
const sourceTargetId = d("reviewed-target");
const target: TargetSnapshot = {
  id: d("target"), repositoryRoot: root, canonicalRemote: "https://example.invalid/repo.git", branch: "feat/refresh", defaultBranch: "main",
  head: d("head"), indexTree: d("tree"), trackedManifest: d("tracked"), untrackedManifest: d("untracked"), submodules: {},
  policyVersion: "b122-v1", environmentFingerprint: d("environment"), capturedAt: "2026-08-26T12:00:00.000Z", completeness: "complete", reasons: []
};
const session: ManagedSession = {
  id: "session-refresh", provider: "codex", surface: "vscode_window", status: "running", capabilities: ["registered", "observable", "controllable", "mediated"],
  taskId: "task-refresh", planRevision: "plan-refresh", plannedFiles: ["docs/learning.md"], workspaceRoot: root,
  targetSnapshotId: target.id, lastHeartbeat: "2026-08-26T12:00:00.000Z", adapterVersion: "test", metadata: {}
};
const sourceSession: ManagedSession = { ...session, targetSnapshotId: sourceTargetId };
const authority: AuthorityGrant = {
  id: "authority-refresh", repositoryRoot: root, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
  allowedActions: ["compound_refresh"], prohibitedActions: [], issuedAt: "2026-08-26T11:59:00.000Z", expiresAt: "2026-08-26T12:30:00.000Z", issuedBy: "TEST\\operator"
};
const message = "Refresh durable learning";
const child = { order: 1, kind: "git_commit" as const, scopeDigest: d(message) };
const proposal = {
  kind: "compound_refresh" as const,
  audit: ["drift", "overlap", "supersession", "contradiction"] as const,
  mutations: [{ path: "docs/learning.md", mutation: "update" as const, beforeDigest: d("before"), afterDigest: d("after"), content: { encoding: "base64" as const, data: Buffer.from("after", "utf8").toString("base64"), byteLength: 5 } }],
  commit: { planned: true as const, message, messageDigest: d(message) }
};
const manifest = createAutomationOperationManifest({
  repositoryRoot: root, targetSnapshotId: sourceTargetId, sessionId: session.id, authorityId: authority.id,
  taskId: session.taskId!, planRevision: session.planRevision!, provider: "codex",
  createdAt: "2026-08-26T12:00:00.000Z", expiresAt: "2026-08-26T12:10:00.000Z"
}, proposal);
const approval = createAutomationManifestApproval({
  manifest,
  confirmationToken: "review-token",
  confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
  confirmedAt: "2026-08-26T12:01:00.000Z",
  expiresAt: "2026-08-26T12:09:00.000Z"
});
const intent = createAutomationIntent("compound_refresh", { digest: approval.confirmationDigest, scopeDigest: approval.reviewScopeDigest }, undefined, { manifest, approval });
const envelope: AutomationEnvelope = {
  schema: "sxsy-b122.compound-refresh-request", version: 1, action: "compound_refresh", operationId: "operation-refresh",
  target: { id: sourceTargetId, repositoryRoot: root, branch: target.branch, head: d("reviewed-head"), policyVersion: target.policyVersion, trackedManifest: d("reviewed-tracked"), untrackedManifest: d("reviewed-untracked") },
  session: { id: session.id, provider: session.provider, surface: session.surface, capabilities: session.capabilities, taskId: session.taskId!, planRevision: session.planRevision!, plannedFiles: session.plannedFiles },
  authorityId: authority.id, manifest, approval, intent
};

function request(): AutomationRequest {
  return {
    action: "compound_refresh", operationId: envelope.operationId, target: { ...target, id: sourceTargetId }, session: sourceSession, authority,
    permit: { id: "permit-refresh", action: "compound_refresh", operationId: envelope.operationId, targetSnapshotId: sourceTargetId, sessionId: session.id, authorityId: authority.id, expiresAt: "2026-08-26T12:10:00.000Z" },
    executionControl: { operationId: envelope.operationId, deadline: "2026-08-26T12:10:00.000Z", isCancellationRequested: async () => false },
    effectGuard: { assertCurrent: async () => ({ allowed: true, reason: "current" }) },
    confirmation: { currentUserConfirmed: true, action: "compound_refresh", targetSnapshotId: sourceTargetId, sessionId: session.id, authorityId: authority.id, confirmationDigest: approval.confirmationDigest, confirmationScopeDigest: approval.reviewScopeDigest },
    reviewedManifest: manifest, manifestApproval: approval
  };
}

test("installed Refresh Git port dispatches only exact reviewed paths and message against the accepted current target", async () => {
  let actual: GitRequest | undefined;
  let guardCalls = 0;
  let observations = 0;
  const postHead = d("post-head");
  const port = new InstalledAutomationRefreshGitCommitPort({
    request: request(), envelope,
    sessions: { get: async () => session }, targets: { get: async () => target },
    commitObserver: { observe: async () => ++observations === 1 ? notStartedObservation() : committedObservation(postHead) },
    guard: { assertCurrent: async (input) => { guardCalls += 1; assert.equal(input.expectedTargetSnapshotId, target.id); } },
    handler: { execute: async (input) => { actual = input; await input.effectGuard!.assertCurrent({ action: input.action, operationId: input.operationId, target: input.target, session: input.session, authority: input.authority }); return { status: "completed", summary: "committed", effectDisposition: "committed", data: { beforeHead: target.head, postHead } }; } }
  });
  const result = await port.execute({ child, envelope, currentTargetSnapshotId: target.id, repairEnvironment: null });
  assert.equal(result.effectDisposition, "committed");
  assert.equal(result.compensationToken, null);
  assert.deepEqual(actual?.mutation, { kind: "local_commit", paths: ["docs/learning.md"], message });
  assert.equal(actual?.target.id, target.id);
  assert.equal(actual?.session?.targetSnapshotId, target.id);
  assert.equal(guardCalls, 1);
  assert.equal(observations, 2);
  assert.equal(result.evidenceDigest, expectedRefreshGitEvidenceDigest(postHead));
});

test("installed Refresh Git port returns not_started only when the mediated Git handler proves no effect began", async () => {
  const port = new InstalledAutomationRefreshGitCommitPort({
    request: request(), envelope,
    sessions: { get: async () => session }, targets: { get: async () => target },
    commitObserver: { observe: async () => notStartedObservation() },
    guard: { assertCurrent: async () => undefined },
    handler: { execute: async () => ({ status: "blocked", summary: "default branch", effectDisposition: "not_started" }) }
  });
  const result = await port.execute({ child, envelope, currentTargetSnapshotId: target.id, repairEnvironment: null });
  assert.equal(result.effectDisposition, "not_started");
  assert.equal(result.compensationToken, null);
});

test("installed Refresh Git port treats an indeterminate Git outcome as ambiguous instead of claiming a safe refusal", async () => {
  const port = new InstalledAutomationRefreshGitCommitPort({
    request: request(), envelope,
    sessions: { get: async () => session }, targets: { get: async () => target },
    commitObserver: { observe: async () => notStartedObservation() },
    guard: { assertCurrent: async () => undefined },
    handler: { execute: async () => ({ status: "incomplete", summary: "HEAD changed", effectDisposition: "ambiguous" }) }
  });
  await assert.rejects(port.execute({ child, envelope, currentTargetSnapshotId: target.id, repairEnvironment: null }), /ambiguous|recovery/i);
});

test("installed Refresh Git port settles an exact already-created commit without replaying the Git handler", async () => {
  const postHead = d("post-head-after-crash");
  let handlerCalls = 0;
  const port = new InstalledAutomationRefreshGitCommitPort({
    request: request(), envelope,
    sessions: { get: async () => session }, targets: { get: async () => target },
    commitObserver: { observe: async () => committedObservation(postHead) },
    guard: { assertCurrent: async () => undefined },
    handler: { execute: async () => { handlerCalls += 1; throw new Error("the commit handler must not replay"); } }
  });

  const result = await port.recover({ child, envelope, currentTargetSnapshotId: target.id, repairEnvironment: null });
  assert.equal(handlerCalls, 0);
  assert.equal(result.effectDisposition, "committed");
  assert.equal(result.evidenceDigest, expectedRefreshGitEvidenceDigest(postHead));
});

test("installed Refresh Git port requires exact recovery instead of replaying when the observed commit mismatches review", async () => {
  let handlerCalls = 0;
  const port = new InstalledAutomationRefreshGitCommitPort({
    request: request(), envelope,
    sessions: { get: async () => session }, targets: { get: async () => target },
    commitObserver: { observe: async () => recoveryObservation("The observed commit message changed.") },
    guard: { assertCurrent: async () => undefined },
    handler: { execute: async () => { handlerCalls += 1; return { status: "completed", summary: "unexpected", effectDisposition: "committed" }; } }
  });

  await assert.rejects(port.recover({ child, envelope, currentTargetSnapshotId: target.id, repairEnvironment: null }), /message changed|recovery/i);
  assert.equal(handlerCalls, 0);
});

test("installed read-only Refresh observer proves the exact parent, tree, message, paths, and reviewed bytes", async () => {
  const postHead = d("observed-post-head");
  const tree = d("observed-tree");
  const beforeBlob = d("observed-before-blob");
  const afterBlob = d("observed-after-blob");
  const calls: string[][] = [];
  const git: CheckpointGitRunner = {
    async run(args) {
      calls.push([...args]);
      const command = args.join(" ");
      if (command === "rev-parse --verify HEAD") return gitResult(postHead);
      if (args[0] === "cat-file" && args[1] === "commit") return gitResult(`tree ${tree}\nparent ${target.head}\nauthor Test <test@example.invalid> 1 +0000\ncommitter Test <test@example.invalid> 1 +0000\n\n${message}\n`);
      if (args[0] === "diff-tree") return gitResult("docs/learning.md\0");
      if (args[0] === "ls-tree") return gitResult(`100644 blob ${args[3] === target.head ? beforeBlob : afterBlob}\tdocs/learning.md\0`);
      if (args[0] === "cat-file" && args[1] === "blob") return gitResult(args[2] === beforeBlob ? "before" : "after");
      if (args[0] === "diff") return gitResult("");
      return { exitCode: 1, stdout: Buffer.alloc(0), stderr: "unexpected read" };
    }
  };
  const observer = new InstalledAutomationRefreshGitCommitObserver({ git, canonicalizeRoot: async (value) => value });
  const result = await observer.observe({
    repositoryRoot: root,
    expectedParentHead: target.head!,
    expectedMessage: message,
    expectedMessageDigest: d(message),
    expectedMutations: proposal.mutations
  });

  assert.equal(result.outcome, "committed", result.reason);
  assert.equal(result.observedHead, postHead);
  assert.equal(result.observedTree, tree);
  assert.match(result.observationDigest, /^[a-f0-9]{64}$/);
  assert.ok(calls.every((args) => ["rev-parse", "cat-file", "diff-tree", "ls-tree", "diff"].includes(args[0]!)));
});

test("installed read-only Refresh observer makes a same-parent commit with a changed message recovery-required", async () => {
  const postHead = d("wrong-message-post-head");
  const tree = d("wrong-message-tree");
  const git: CheckpointGitRunner = {
    async run(args) {
      if (args[0] === "rev-parse") return gitResult(postHead);
      if (args[0] === "cat-file" && args[1] === "commit") return gitResult(`tree ${tree}\nparent ${target.head}\nauthor Test <test@example.invalid> 1 +0000\ncommitter Test <test@example.invalid> 1 +0000\n\nA different message\n`);
      return { exitCode: 1, stdout: Buffer.alloc(0), stderr: "must stop after commit mismatch" };
    }
  };
  const observer = new InstalledAutomationRefreshGitCommitObserver({ git, canonicalizeRoot: async (value) => value });
  const result = await observer.observe({
    repositoryRoot: root,
    expectedParentHead: target.head!,
    expectedMessage: message,
    expectedMessageDigest: d(message),
    expectedMutations: proposal.mutations
  });

  assert.equal(result.outcome, "recovery_required");
  assert.match(result.reason, /message/i);
});

function expectedRefreshGitEvidenceDigest(postHead: string): string {
  const operationId = `automation-refresh-${sha256(stableJson({
    schema: "sxsy-b122.automation-refresh-git-operation",
    version: 1,
    operationId: envelope.operationId,
    manifestId: envelope.manifest.id,
    currentTargetSnapshotId: target.id
  })).slice(0, 48)}`;
  return sha256(stableJson({
    schema: "sxsy-b122.installed-refresh-git-evidence",
    version: 1,
    operationId,
    manifestId: envelope.manifest.id,
    targetSnapshotId: target.id,
    sessionBindingDigest: sessionBindingDigest(session),
    beforeHead: target.head,
    postHead,
    paths: proposal.mutations.map((mutation) => mutation.path),
    messageDigest: proposal.commit.messageDigest
  }));
}

function notStartedObservation() {
  return { outcome: "not_started" as const, observedHead: target.head!, observedTree: null, observationDigest: d("not-started-observation"), reason: "HEAD is unchanged." };
}

function committedObservation(postHead: string) {
  return { outcome: "committed" as const, observedHead: postHead, observedTree: d("observed-tree"), observationDigest: d(`committed:${postHead}`), reason: "Exact commit observed." };
}

function recoveryObservation(reason: string) {
  return { outcome: "recovery_required" as const, observedHead: d("mismatched-head"), observedTree: null, observationDigest: d(`recovery:${reason}`), reason };
}

function gitResult(stdout: string) {
  return { exitCode: 0, stdout: Buffer.from(stdout, "utf8"), stderr: "" };
}
