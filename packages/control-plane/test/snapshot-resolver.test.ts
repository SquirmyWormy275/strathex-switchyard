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

class LocalOnlyInspector implements GitInspector {
  async inspect(): Promise<GitInspection> {
    return {
      repositoryRoot: "C:/safe/local-only", branch: "feature/contained", head: "abc", indexTree: "tree",
      trackedFiles: [{ path: "src/a.ts", digest: "a" }], untrackedFiles: [], submodules: {}
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

test("containment captures a complete explicit zero-remote target while ordinary consequential work still requires a canonical remote", async () => {
  const session = {
    id: "session-local", provider: "codex" as const, surface: "vscode_terminal" as const,
    capabilities: ["registered", "observable", "controllable", "mediated"] as const, status: "running" as const,
    workspaceRoot: "C:/safe/local-only", plannedFiles: [], lastHeartbeat: "2026-08-25T12:00:00.000Z", adapterVersion: "test", metadata: {}
  };
  const resolver = new WorkspaceSnapshotResolver(new TargetSnapshotFactory(new LocalOnlyInspector()), {
    policyVersion: "policy-1",
    environmentFor: () => ({ toolVersions: { git: "test" } })
  });
  const containment = await resolver.resolve({ definition: commandForAction("emergency_containment"), session });
  assert.equal(containment?.completeness, "complete");
  assert.equal(containment?.canonicalRemote, undefined);
  const release = await resolver.resolve({ definition: commandForAction("containment_release"), session });
  assert.equal(release?.completeness, "complete");
  const ordinary = await resolver.resolve({ definition: commandForAction("local_commit"), session });
  assert.equal(ordinary?.completeness, "incomplete");
  assert.match(ordinary?.reasons.join(" ") ?? "", /canonical remote/i);
});
