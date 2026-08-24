import assert from "node:assert/strict";
import test from "node:test";

import { commandForAction } from "../src/command-catalog.ts";
import type { GitInspection, GitInspector } from "../src/snapshot.ts";
import { TargetSnapshotFactory } from "../src/snapshot.ts";
import { WorkspaceSnapshotResolver } from "../src/snapshot-resolver.ts";

class Inspector implements GitInspector {
  async inspect(): Promise<GitInspection> {
    return {
      repositoryRoot: "C:/safe/repo", canonicalRemote: "https://github.com/example/safe.git", branch: "feature/safe", upstream: "origin/feature/safe",
      head: "abc", indexTree: "tree", trackedFiles: [{ path: "src/a.ts", digest: "a" }], untrackedFiles: [], submodules: {}
    };
  }
}

test("workspace target resolver uses only a selected session root and marks missing tool evidence incomplete", async () => {
  const resolver = new WorkspaceSnapshotResolver(new TargetSnapshotFactory(new Inspector()), { policyVersion: "policy-1" });
  const definition = commandForAction("proof");
  const none = await resolver.resolve({ definition, session: undefined });
  assert.equal(none, undefined);
  const snapshot = await resolver.resolve({
    definition,
    session: {
      id: "session", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable"], status: "running",
      workspaceRoot: "C:/safe/repo", plannedFiles: [], lastHeartbeat: "2026-08-23T12:00:00.000Z", adapterVersion: "test", metadata: {}
    }
  });
  assert.equal(snapshot?.repositoryRoot, "C:/safe/repo");
  assert.equal(snapshot?.completeness, "incomplete");
  assert.match(snapshot?.reasons.join(" ") ?? "", /fingerprints/i);
});
