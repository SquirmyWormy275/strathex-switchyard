import assert from "node:assert/strict";
import test from "node:test";

import { operatorSessionItems } from "../src/operator-status.ts";
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
