import assert from "node:assert/strict";
import test from "node:test";

import { GitCliInspector, NodeGitCommandRunner, type GitCommandResult, type GitCommandRunner, type FileDigestReader } from "../src/git-inspector.ts";

class ScriptedRunner implements GitCommandRunner {
  readonly calls: string[] = [];
  private readonly responses: Readonly<Record<string, GitCommandResult>>;

  constructor(responses: Readonly<Record<string, GitCommandResult>>) {
    this.responses = responses;
  }

  async run(args: readonly string[]): Promise<GitCommandResult> {
    const key = args.join(" ");
    this.calls.push(key);
    return this.responses[key] ?? { exitCode: 1, stdout: "", stderr: "not configured" };
  }
}

class FakeDigests implements FileDigestReader {
  async digest(_repositoryRoot: string, relativePath: string): Promise<string> {
    if (relativePath === "unknown.bin") throw new Error("unreadable");
    return `sha256:${relativePath}`;
  }

  async state(_repositoryRoot: string, relativePath: string): Promise<"regular_file" | "missing"> {
    return relativePath === "deleted.txt" ? "missing" : "regular_file";
  }
}

const result = (stdout: string): GitCommandResult => ({ exitCode: 0, stdout, stderr: "" });

test("default Git command runner accepts only fixed absolute Git identities", () => {
  assert.throws(() => new NodeGitCommandRunner(["git"]), /fixed absolute/i);
  assert.throws(() => new NodeGitCommandRunner(["C:\\tools\\not-git.cmd"]), /fixed absolute/i);
  assert.doesNotThrow(() => new NodeGitCommandRunner([process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git"]));
});

test("read-only Git inspector uses fixed argument vectors and classifies every untracked input", async () => {
  const runner = new ScriptedRunner({
    "rev-parse --show-toplevel": result("C:/work/example\n"),
    "remote get-url origin": result("https://github.com/example/repo.git\n"),
    "branch --show-current": result("feature/safe\n"),
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": result("origin/main\n"),
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": result("origin/feature/safe\n"),
    "rev-parse HEAD": result("abc123\n"),
    "write-tree": result("tree123\n"),
    "ls-files -z": result("src/a.ts\0src/b.ts\0"),
    "ls-files --deleted -z": result(""),
    "ls-files --others --exclude-standard -z": result("scratch.txt\0"),
    "ls-files --others --ignored --exclude-standard -z": result(".env.local\0"),
    "submodule status --recursive": result("")
  });
  const inspector = new GitCliInspector({
    runner,
    digestReader: new FakeDigests(),
    classifyUntracked: (path) => path === "scratch.txt" ? "excluded" : "unknown",
    classifyIgnored: (path) => path === ".env.local" ? "excluded" : "unknown"
  });
  const inspection = await inspector.inspect("C:/work/example");
  assert.equal(inspection.repositoryRoot, "C:/work/example");
  assert.equal(inspection.defaultBranch, "main");
  assert.equal(inspection.detached, undefined);
  assert.equal(inspection.trackedFiles?.length, 2);
  assert.deepEqual(inspection.untrackedFiles, [{ path: "scratch.txt", digest: "sha256:scratch.txt", classification: "excluded", source: "untracked" }]);
  assert.deepEqual(inspection.ignoredFiles, [{ path: ".env.local", digest: "sha256:.env.local", classification: "excluded", source: "ignored" }]);
  assert.deepEqual(inspection.issues, []);
  assert.ok(runner.calls.every((call) => !/[;&|`$]/.test(call)));
});

test("read-only Git inspector degrades an unreadable or unclassified file to an incomplete snapshot input", async () => {
  const runner = new ScriptedRunner({
    "rev-parse --show-toplevel": result("C:/work/example\n"),
    "remote get-url origin": result("https://github.com/example/repo.git\n"),
    "branch --show-current": result("feature/safe\n"),
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": result("origin/main\n"),
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": result("origin/feature/safe\n"),
    "rev-parse HEAD": result("abc123\n"),
    "write-tree": result("tree123\n"),
    "ls-files -z": result("src/a.ts\0"),
    "ls-files --deleted -z": result(""),
    "ls-files --others --exclude-standard -z": result("unknown.bin\0"),
    "ls-files --others --ignored --exclude-standard -z": result(".env.local\0"),
    "submodule status --recursive": result("")
  });
  const inspection = await new GitCliInspector({ runner, digestReader: new FakeDigests() }).inspect("C:/work/example");
  assert.equal(inspection.untrackedFiles?.[0]?.classification, "unknown");
  assert.equal(inspection.untrackedFiles?.[0]?.digest, undefined);
  assert.match(inspection.issues?.join(" ") ?? "", /unable to hash/i);
  assert.equal(inspection.ignoredFiles?.[0]?.classification, "unknown");
});

test("read-only Git inspector distinguishes a detached HEAD from an unavailable branch observation", async () => {
  const runner = new ScriptedRunner({
    "rev-parse --show-toplevel": result("C:/work/example\n"),
    "remote get-url origin": result("https://github.com/example/repo.git\n"),
    "branch --show-current": result("\n"),
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": result("origin/trunk\n"),
    "rev-parse HEAD": result("abc123\n"),
    "write-tree": result("tree123\n"),
    "ls-files -z": result(""),
    "ls-files --deleted -z": result(""),
    "ls-files --others --exclude-standard -z": result(""),
    "ls-files --others --ignored --exclude-standard -z": result(""),
    "submodule status --recursive": result("")
  });
  const inspection = await new GitCliInspector({ runner, digestReader: new FakeDigests() }).inspect("C:/work/example");
  assert.equal(inspection.branch, undefined);
  assert.equal(inspection.detached, true);
  assert.equal(inspection.defaultBranch, "trunk");
  assert.equal(inspection.issues?.some((issue) => /branch/i.test(issue)), false);
});

test("read-only Git inspector positively represents a tracked worktree deletion without weakening unrelated unreadable files", async () => {
  const runner = new ScriptedRunner({
    "rev-parse --show-toplevel": result("C:/work/example\n"),
    "remote get-url origin": result("https://github.com/example/repo.git\n"),
    "branch --show-current": result("feature/safe\n"),
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": result("origin/main\n"),
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": result("origin/feature/safe\n"),
    "rev-parse HEAD": result("abc123\n"),
    "write-tree": result("tree123\n"),
    "ls-files -z": result("deleted.txt\0unknown.bin\0"),
    "ls-files --deleted -z": result("deleted.txt\0"),
    "ls-files --others --exclude-standard -z": result(""),
    "ls-files --others --ignored --exclude-standard -z": result(""),
    "submodule status --recursive": result("")
  });
  const inspection = await new GitCliInspector({ runner, digestReader: new FakeDigests() }).inspect("C:/work/example");
  assert.deepEqual(inspection.trackedFiles?.[0], {
    path: "deleted.txt",
    digest: inspection.trackedFiles?.[0]?.digest,
    state: "tracked_missing"
  });
  assert.match(inspection.trackedFiles?.[0]?.digest ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.equal(inspection.trackedFiles?.[1]?.path, "unknown.bin");
  assert.equal(inspection.trackedFiles?.[1]?.digest, undefined);
  assert.match(inspection.issues?.join(" ") ?? "", /unable to hash tracked file unknown\.bin/i);
});
