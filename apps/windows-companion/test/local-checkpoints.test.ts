import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { CheckpointCaptureRequest } from "../../../packages/control-plane/src/runtime.ts";
import { LocalCheckpointCapture, LocalRecoveryArtifactVerifier, type CheckpointGitRunner } from "../src/local-checkpoints.ts";

async function fixture(context: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-checkpoint-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const requestedRepositoryRoot = join(folder, "repo");
  const stateDirectory = join(folder, "state");
  await mkdir(join(requestedRepositoryRoot, "src"), { recursive: true });
  // Windows may expose the temp directory through an 8.3 alias. TargetSnapshot
  // roots are host-canonical, so make the fixture match production capture.
  const repositoryRoot = await realpath(requestedRepositoryRoot);
  await writeFile(join(repositoryRoot, "src", "work.txt"), "operator work\n", "utf8");
  return { folder, repositoryRoot, stateDirectory };
}

function request(repositoryRoot: string): CheckpointCaptureRequest {
  const target: TargetSnapshot = {
    id: "a".repeat(64), repositoryRoot, branch: "feature/checkpoint", head: "b".repeat(40), indexTree: "c".repeat(40),
    trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "policy-1",
    environmentFingerprint: "environment", capturedAt: "2026-08-24T12:00:00.000Z", completeness: "complete", reasons: []
  };
  const session: ManagedSession = {
    id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running", workspaceRoot: repositoryRoot, targetSnapshotId: target.id, taskId: "task-1", planRevision: "plan-1",
    plannedFiles: ["src/work.txt"], lastHeartbeat: "2026-08-24T12:00:00.000Z", adapterVersion: "test", metadata: {}
  };
  return { definition: { action: "local_commit", title: "Scoped local commit" } as CheckpointCaptureRequest["definition"], operationId: "operation-1", workflow: "consequential_git", target, session };
}

class FakeGit implements CheckpointGitRunner {
  readonly calls: readonly string[][] = [] as string[][];
  head = "b".repeat(40);
  async run(args: readonly string[]): Promise<Readonly<{ exitCode: number; stdout: Uint8Array; stderr: string }>> {
    (this.calls as string[][]).push([...args]);
    if (args[0] === "rev-parse") return { exitCode: 0, stdout: Buffer.from(`${this.head}\n`), stderr: "" };
    if (args[0] === "diff") return { exitCode: 0, stdout: Buffer.from("binary-safe patch\n"), stderr: "" };
    return { exitCode: 1, stdout: Buffer.alloc(0), stderr: "unexpected command" };
  }
}

test("captures host-owned immutable recovery artifacts and verifies every digest before risky work", async (context) => {
  const { repositoryRoot, stateDirectory } = await fixture(context);
  const git = new FakeGit();
  const capture = new LocalCheckpointCapture({ stateDirectory, git });
  const captured = await capture.capture(request(repositoryRoot));
  assert.ok(captured);
  assert.match(captured.reason, /before scoped local commit/i);
  assert.equal(captured.artifacts.some((artifact) => artifact.kind === "patch"), true);
  assert.equal(captured.artifacts.some((artifact) => artifact.kind === "workspace_manifest"), true);
  assert.equal(captured.artifacts.some((artifact) => artifact.id.includes("planned")), true);
  assert.deepEqual(captured.recovery.artifactIds, captured.artifacts.map((artifact) => artifact.id));
  assert.match(captured.recovery.steps.join(" "), /manual/i);
  const verifier = new LocalRecoveryArtifactVerifier(stateDirectory);
  for (const artifact of captured.artifacts) {
    const result = await verifier.verify(artifact);
    assert.equal(result.available, true);
    assert.equal(result.sha256, artifact.sha256);
  }
  assert.deepEqual(git.calls.map((args) => args[0]), ["rev-parse", "diff", "rev-parse"]);
});

test("rejects non-task-owned traversal and a target HEAD change during capture", async (context) => {
  const { repositoryRoot, stateDirectory } = await fixture(context);
  const traversal = request(repositoryRoot);
  const unsafeSession = { ...traversal.session!, plannedFiles: ["../secret.txt"] };
  const git = new FakeGit();
  const capture = new LocalCheckpointCapture({ stateDirectory, git });
  await assert.rejects(() => capture.capture({ ...traversal, session: unsafeSession }), /planned|path|repository/i);

  let probes = 0;
  const changingGit: CheckpointGitRunner = {
    async run(args) {
      if (args[0] === "diff") return { exitCode: 0, stdout: Buffer.from("patch"), stderr: "" };
      probes += 1;
      return { exitCode: 0, stdout: Buffer.from(`${probes === 1 ? "b".repeat(40) : "d".repeat(40)}\n`), stderr: "" };
    }
  };
  await assert.rejects(() => new LocalCheckpointCapture({ stateDirectory, git: changingGit }).capture(request(repositoryRoot)), /changed|head/i);
});

test("read-only verification detects artifact tamper and refuses references outside host checkpoint state", async (context) => {
  const { repositoryRoot, stateDirectory, folder } = await fixture(context);
  const captured = await new LocalCheckpointCapture({ stateDirectory, git: new FakeGit() }).capture(request(repositoryRoot));
  assert.ok(captured);
  const artifact = captured.artifacts[0]!;
  await writeFile(artifact.reference, "tampered", "utf8");
  const verifier = new LocalRecoveryArtifactVerifier(stateDirectory);
  const mismatch = await verifier.verify(artifact);
  assert.equal(mismatch.available, true);
  assert.notEqual(mismatch.sha256, artifact.sha256);

  const outside = join(folder, "outside.txt");
  await writeFile(outside, "outside", "utf8");
  const denied = await verifier.verify({ ...artifact, reference: outside });
  assert.equal(denied.available, false);
  assert.match(denied.detail ?? "", /outside|host-owned/i);
  assert.equal((await readFile(outside, "utf8")), "outside");
});
