import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { DurableGitMutationReviewQueue } from "../src/git-review.ts";

const target: TargetSnapshot = {
  id: "snapshot-review",
  repositoryRoot: "C:\\repo",
  branch: "feat/review",
  head: "a".repeat(40),
  indexTree: "b".repeat(40),
  trackedManifest: "c".repeat(64),
  untrackedManifest: "d".repeat(64),
  submodules: {},
  policyVersion: "test",
  environmentFingerprint: "e".repeat(64),
  capturedAt: new Date().toISOString(),
  completeness: "complete",
  reasons: []
};

const session: ManagedSession = {
  id: "git-session",
  provider: "generic",
  surface: "vscode_window",
  capabilities: ["registered"],
  status: "unknown",
  workspaceRoot: target.repositoryRoot,
  targetSnapshotId: target.id,
  taskId: "task-review",
  planRevision: "plan-review",
  plannedFiles: [],
  lastHeartbeat: new Date().toISOString(),
  adapterVersion: "test",
  metadata: { "sxsy-b122.kind": "git-root" }
};

async function setup(attested = true, resolvedTarget: TargetSnapshot = target) {
  const root = await mkdtemp(join(tmpdir(), "b122-git-review-"));
  const store = new ProtectedJsonStore({ filePath: join(root, "journal.jsonl") });
  const sessions = new SessionRegistry(store);
  await sessions.upsert(session);
  const queue = new DurableGitMutationReviewQueue({
    store,
    sessions,
    targetResolver: { async resolve() { return resolvedTarget; } },
    attestor: { async attest() { return attested ? { reauthenticated: true, operator: "TEST\\operator" } : undefined; } },
    inspector: { async changedPaths() { return ["src/safe.ts", "README.md"]; } },
    now: () => new Date("2026-08-23T12:00:00.000Z")
  });
  return { queue, sessions, store };
}

test("reviewed local mutations are one-use, target-bound, and update the protected task-owned path grant", async () => {
  const { queue, sessions } = await setup();
  const result = await queue.review({
    action: "local_commit",
    sessionId: session.id,
    mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "feat: safe reviewed change" }
  });
  assert.equal(result.status, "approved");
  assert.deepEqual((await sessions.get(session.id))?.plannedFiles, ["src/safe.ts"]);

  const reviewedSession = await sessions.get(session.id);
  const created = queue.create(commandForAction("local_commit"), target, reviewedSession);
  assert.deepEqual(created, { kind: "local_commit", paths: ["src/safe.ts"], message: "feat: safe reviewed change" });
  assert.equal(queue.create(commandForAction("local_commit"), target, reviewedSession), undefined);
});

test("review refuses paths absent from the exact Git change set and absent user presence", async () => {
  const { queue } = await setup();
  const outside = await queue.review({
    action: "local_commit",
    sessionId: session.id,
    mutation: { kind: "local_commit", paths: ["src/not-changed.ts"], message: "safe" }
  });
  assert.equal(outside.status, "blocked");

  const noPresence = (await setup(false)).queue;
  const denied = await noPresence.review({
    action: "local_commit",
    sessionId: session.id,
    mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe" }
  });
  assert.equal(denied.status, "blocked");
});

test("default-branch review requires one exact non-default branch for a fresh-target handoff", async () => {
  const mainTarget = { ...target, id: "snapshot-main", branch: "main" };
  const { queue } = await setup(true, mainTarget);
  const missing = await queue.review({ action: "local_commit", sessionId: session.id, mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe" } });
  assert.equal(missing.status, "blocked");
  const approved = await queue.review({ action: "local_commit", sessionId: session.id, mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe", featureBranch: "feature/safe" } });
  assert.equal(approved.status, "approved");
});

test("review rejects mutation/action confusion and stale target bindings", async () => {
  const { queue } = await setup();
  const confused = await queue.review({
    action: "pr_upsert",
    sessionId: session.id,
    mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe" }
  });
  assert.equal(confused.status, "blocked");

  const approved = await queue.review({
    action: "local_commit",
    sessionId: session.id,
    mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe" }
  });
  assert.equal(approved.status, "approved");
  assert.equal(queue.create(commandForAction("local_commit"), { ...target, id: "changed" }, await (await setup()).sessions.get(session.id)), undefined);
});
