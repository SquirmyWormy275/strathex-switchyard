import assert from "node:assert/strict";
import test from "node:test";

import { codexLocalThreadItems, operatorSessionItems } from "../src/operator-status.ts";
import type { ExtensionManagedSession } from "../src/companion-bridge.ts";

function session(overrides: Partial<ExtensionManagedSession>): ExtensionManagedSession {
  return {
    id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered"],
    status: "unknown", plannedFiles: [], lastHeartbeat: "2026-10-26T00:00:00.000Z",
    adapterVersion: "fixture", metadata: {}, ...overrides
  };
}

test("operator view never upgrades registered-only desktop status from a claimed result", () => {
  const items = operatorSessionItems([session({ surface: "desktop", status: "verified_finished" })]);
  assert.equal(items.length, 1);
  assert.match(items[0]!.label, /unknown/);
  assert.doesNotMatch(items[0]!.label, /finished/);
  assert.match(items[0]!.detail ?? "", /Registered only/);
});

test("operator view prioritizes verified blockers and preserves exact task and target identity", () => {
  const items = operatorSessionItems([
    session({ id: "running", capabilities: ["registered", "observable"], status: "running" }),
    session({ id: "blocked", provider: "claude", capabilities: ["registered", "observable", "controllable"],
      status: "verified_blocked", taskId: "task-7", planRevision: "plan-2", workspaceRoot: "/work/project",
      targetSnapshotId: "a".repeat(64) })
  ]);
  assert.match(items[0]!.label, /claude · verified blocked/);
  assert.match(items[0]!.detail ?? "", /Session blocked.*task task-7.*plan plan-2.*repository \/work\/project.*target a{64}.*Controllable/);
  assert.match(items[1]!.label, /running/);
});

test("local Codex runtime rows disclose their unbound status without becoming managed sessions", () => {
  const items = codexLocalThreadItems([{ id: "stored", observation: "not-observed" }, { id: "thread-7", observation: "waiting-on-approval" }]);
  assert.equal(items.length, 1);
  assert.match(items[0]!.label, /waiting-on-approval \(unbound\)/);
  assert.match(items[0]!.detail ?? "", /Thread thread-7.*no Switchyard task.*no verified session capability/);
});

test("exact local binding joins only its own Codex thread and keeps target uncertainty visible", () => {
  const binding = { threadId: "thread-own", taskId: "task-1", sessionId: "codex-thread:thread-own", repositoryRoot: "/repo", targetSnapshotId: null, createdAt: "2026-10-27T00:00:00.000Z" };
  const items = codexLocalThreadItems([
    { id: "thread-other", observation: "active" }, { id: "thread-own", observation: "waiting-on-approval" }
  ], [binding]);
  assert.match(items[0]!.label, /waiting-on-approval \(task-bound\)/);
  assert.match(items[0]!.detail ?? "", /task task-1.*repository \/repo.*target unverified.*no verified session capability/);
  assert.match(items[1]!.label, /active \(unbound\)/);
});
