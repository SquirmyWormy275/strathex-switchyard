import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { GitCliInspector } from "../../../packages/control-plane/src/git-inspector.ts";
import { TargetSnapshotFactory } from "../../../packages/control-plane/src/snapshot.ts";
import { WorkspaceSnapshotResolver } from "../../../packages/control-plane/src/snapshot-resolver.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import type { AutomationOperationProposal } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { createDurableWindowsCompanion } from "../src/bootstrap.ts";
import { ProtectedStoreAutomationEffectJournal } from "../src/automation-effect-executor.ts";

// Real effect boundaries use wall-clock deadlines. Keep this fixture's stable
// governance clock current instead of issuing permanently expired permits.
const now = new Date().toISOString();
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const environment = { toolVersions: { node: process.version, git: "installed-test" } } as const;
const authenticator: JournalAuthenticator = {
  provider: "installed-automation-e2e",
  async seal(value) { return `test:${value}`; },
  async verify(value, tag) { return tag === `test:${value}`; }
};

async function git(root: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolveRun, reject) => {
    const child = spawn("git", [...args], { cwd: root, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRun(stdout.trim()) : reject(new Error(stderr || `git ${args[0]} failed`)));
  });
}

async function target(root: string) {
  return new TargetSnapshotFactory(new GitCliInspector({
    classifyUntracked: () => "included",
    classifyIgnored: () => "included"
  }), { clock: () => now }).capture({
    targetHint: root,
    policyVersion: "b122-e2e-v1",
    environment,
    requireCanonicalRemote: true,
    requireBranch: true
  });
}

test("packaged default composition executes one reviewed Refresh through host-local bytes, private-index Git, and accepted target transitions", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ia-"));
  const repository = join(directory, "repository");
  const state = join(directory, "state");
  await mkdir(join(repository, "docs"), { recursive: true });
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.email", "b122-test@example.invalid"]);
  await git(repository, ["config", "user.name", "B122 Installed Test"]);
  await writeFile(join(repository, "docs", "learning.md"), "before\n", "utf8");
  await git(repository, ["add", "--", "docs/learning.md"]);
  await git(repository, ["commit", "-m", "Initial learning"]);
  await git(repository, ["remote", "add", "origin", "https://example.invalid/strathex-switchyard.git"]);
  await git(repository, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await git(repository, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  await git(repository, ["switch", "-c", "feat/automation-e2e"]);

  const reviewedTarget = await target(repository);
  assert.equal(reviewedTarget.completeness, "complete", reviewedTarget.reasons.join("; "));
  const store = new ProtectedJsonStore({ filePath: join(state, "protected.jsonl"), authenticator, clock: () => now });
  const targetResolver = new WorkspaceSnapshotResolver(new TargetSnapshotFactory(new GitCliInspector({
    classifyUntracked: () => "included",
    classifyIgnored: () => "included"
  }), { clock: () => now }), { policyVersion: "b122-e2e-v1", environmentFor: () => environment });
  const companion = createDurableWindowsCompanion({
    store,
    policyVersion: "b122-e2e-v1",
    localStateDirectory: state,
    localGitStateDirectory: state,
    targetResolver,
    snapshotEnvironmentFor: () => environment,
    runtime: {
      now: () => new Date(now),
      confirmationAttestor: { attest: async () => ({ reauthenticated: true, operator: "installed-test-operator" }) }
    }
  });
  const session = await companion.registerTrustedSession({
    id: "installed-automation-session",
    provider: "codex",
    surface: "vscode_window",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running",
    workspaceRoot: reviewedTarget.repositoryRoot,
    targetSnapshotId: reviewedTarget.id,
    taskId: "installed-automation-task",
    planRevision: "installed-automation-plan",
    plannedFiles: ["docs/learning.md"],
    lastHeartbeat: now,
    adapterVersion: "installed-test",
    metadata: {}
  });
  const authority = await companion.executor.authorities.issue({
    repositoryRoot: reviewedTarget.repositoryRoot,
    sessionId: session.id,
    taskId: session.taskId,
    planRevision: session.planRevision,
    allowedActions: ["compound_refresh"],
    prohibitedActions: [],
    expiresAt: new Date(Date.parse(now) + 20 * 60_000).toISOString(),
    issuedBy: "TEST\\operator"
  });
  const durableSession = await companion.sessions.get(session.id);
  assert.ok(durableSession);
  assert.equal(durableSession.targetSnapshotId, reviewedTarget.id, JSON.stringify(durableSession));
  const beforeReview = await targetResolver.resolve({ definition: commandForAction("compound_refresh"), session: durableSession });
  assert.equal(beforeReview?.id, durableSession.targetSnapshotId, JSON.stringify({ durableSession, reviewedTarget, beforeReview }));
  const beforeReviewAgain = await targetResolver.resolve({ definition: commandForAction("compound_refresh"), session: durableSession });
  assert.equal(beforeReviewAgain?.id, durableSession.targetSnapshotId, JSON.stringify({ durableSession, beforeReview, beforeReviewAgain }));
  const message = "Refresh durable learning";
  const after = Buffer.from("after\n", "utf8");
  const proposal: AutomationOperationProposal = {
    kind: "compound_refresh",
    audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [{
      path: "docs/learning.md",
      mutation: "update",
      beforeDigest: hash("before\n"),
      afterDigest: hash(after),
      content: { encoding: "base64", data: after.toString("base64"), byteLength: after.length }
    }],
    commit: { planned: true, message, messageDigest: hash(message) }
  };
  const prepared = await companion.automationManifestReviews.prepare({
    action: "compound_refresh",
    sessionId: session.id,
    authorityId: authority.id,
    proposal
  });
  assert.equal(prepared.status, "prepared", prepared.summary);
  assert.ok(prepared.manifest && prepared.reviewScopeDigest);
  const confirmation = await companion.executor.requestConfirmation({
    action: "compound_refresh",
    sessionId: session.id,
    authorityId: authority.id,
    reason: "Apply the exact reviewed learning refresh and local commit.",
    confirmationScopeDigest: prepared.reviewScopeDigest
  });
  assert.equal(confirmation.status, "issued", confirmation.summary);
  assert.ok(confirmation.token && confirmation.expiresAt);
  const approved = await companion.automationManifestReviews.approve({
    manifestId: prepared.manifest.id,
    manifestDigest: prepared.manifest.digest,
    reviewScopeDigest: prepared.reviewScopeDigest,
    confirmationToken: confirmation.token,
    confirmationExpiresAt: confirmation.expiresAt
  });
  assert.equal(approved.status, "approved", approved.summary);
  const assignment = commandForAction("compound_refresh").assignment!;
  const result = await companion.executor.execute({
    assignment,
    control: assignment.control,
    modifier: assignment.modifier,
    sessionId: session.id,
    authorityId: authority.id,
    confirmationToken: confirmation.token,
    confirmationScopeDigest: prepared.reviewScopeDigest
  });
  // Include only this synthetic fixture's journal errors when a native effect
  // fails; the public broker response intentionally omits private diagnostics.
  const diagnostic = result.status === "completed" || !result.operationId ? null
    : (await new ProtectedStoreAutomationEffectJournal(store).load(result.operationId))?.errors;
  assert.equal(result.status, "completed", JSON.stringify({ result, errors: diagnostic }));
  assert.equal(await readFile(join(repository, "docs", "learning.md"), "utf8"), "after\n");
  assert.equal(await git(repository, ["log", "-1", "--pretty=%s"]), message);
  assert.equal(await git(repository, ["status", "--porcelain"]), "");
  const finalTarget = await target(repository);
  const finalSession = await companion.sessions.get(session.id);
  assert.notEqual(finalTarget.id, reviewedTarget.id);
  assert.equal(finalSession?.targetSnapshotId, finalTarget.id);
});
