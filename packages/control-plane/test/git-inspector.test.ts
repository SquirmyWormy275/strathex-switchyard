import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, open, readFile, rename, rm, symlink, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GitCliInspector, NodeGitCommandRunner, NodeFileDigestReader, type GitCommandResult, type GitCommandRunner, type FileDigestReader } from "../src/git-inspector.ts";

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


async function digestFixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-digest-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "repository"), outside = join(directory, "outside");
  await mkdir(root); await mkdir(outside);
  return { directory, root, outside };
}

test("repository digests hash actual files, preserve missing state and reject parent junction escape", async (t) => {
  const { root, outside } = await digestFixture(t), reader = new NodeFileDigestReader();
  const bytes = Buffer.from("approved task input\n");
  await writeFile(join(root, "input.txt"), bytes);
  await writeFile(join(outside, "private.txt"), "must never enter the snapshot");
  await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(await reader.digest(root, "input.txt"), `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  assert.equal(await reader.state(root, "input.txt"), "regular_file");
  assert.equal(await reader.state(root, "absent/input.txt"), "missing");
  for (const operation of [() => reader.digest(root, "linked/private.txt"), () => reader.state(root, "linked/private.txt")]) {
    await assert.rejects(operation, /parent must be a real directory/i);
  }
  await assert.rejects(reader.digest(root, "../outside/private.txt"), /escapes/i);
  await assert.rejects(reader.state(root, ""), /escapes/i);
});

test("repository digest byte limits are enforced on actual files and exact-limit input remains valid", async (t) => {
  const { root } = await digestFixture(t), reader = new NodeFileDigestReader({ maxFileBytes: 64 });
  await writeFile(join(root, "exact.bin"), Buffer.alloc(64, 7));
  await writeFile(join(root, "large.bin"), Buffer.alloc(65, 7));
  assert.match(await reader.digest(root, "exact.bin"), /^sha256:[a-f0-9]{64}$/);
  const captured = await reader.read(root, "exact.bin"); assert.deepEqual(captured.bytes, Buffer.alloc(64, 7)); assert.equal(captured.digest, await reader.digest(root, "exact.bin"));
  await writeFile(join(root, "binary.bin"), Buffer.from([0, 255, 128, 10, 13]));
  assert.deepEqual((await reader.read(root, "binary.bin")).bytes, Buffer.from([0, 255, 128, 10, 13]));
  await assert.rejects(reader.digest(root, "large.bin"), /bounded digest size/i);
  await assert.rejects(reader.read(root, "large.bin"), /bounded digest size/i);
  for (const maxFileBytes of [0, -1, NaN, 1.5, 128 * 1024 * 1024 + 1]) {
    assert.throws(() => new NodeFileDigestReader({ maxFileBytes }), /bounded/i);
  }
});

test("a parent replaced after descriptor acquisition is rejected before reading and the descriptor closes", async (t) => {
  const { root } = await digestFixture(t), parent = join(root, "inputs");
  await mkdir(parent); await writeFile(join(parent, "task.txt"), "original");
  let acquired: FileHandle | undefined, reads = 0, renamePrevented = false;
  const openFile: typeof open = async (path, flags, mode) => {
    const handle = await open(path, flags, mode); acquired = handle;
    const originalRead = handle.read.bind(handle);
    handle.read = (async (buffer: Buffer, offset: number, length: number, position: number) => {
      reads++; return originalRead(buffer, offset, length, position);
    }) as FileHandle["read"];
    try { await rename(parent, join(root, "moved")); }
    catch (error) {
      // Windows can deny the rename while the child descriptor is held.
      // Prove that this OS-enforced boundary retained the original input.
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") { renamePrevented = true; return handle; }
      await handle.close(); throw error;
    }
    await mkdir(parent); await writeFile(join(parent, "task.txt"), "replacement");
    return handle;
  };
  const captured = new NodeFileDigestReader({ openFile }).digest(root, "inputs/task.txt");
  if (process.platform === "win32") {
    const outcome = await captured.then(value => ({ value }), error => ({ error }));
    if (renamePrevented) {
      assert.ok("value" in outcome); assert.equal(outcome.value, "sha256:" + createHash("sha256").update("original").digest("hex"));
      assert.equal(await readFile(join(parent, "task.txt"), "utf8"), "original");
      await assert.rejects(lstat(join(root, "moved")), { code: "ENOENT" }); assert.ok(reads > 0);
    } else { assert.ok("error" in outcome); assert.match(String(outcome.error), /parent changed/i); assert.equal(reads, 0); }
  } else { await assert.rejects(captured, /parent changed/i); assert.equal(reads, 0); }
  assert.equal(acquired?.fd, -1);
});

test("a named file replaced after descriptor acquisition cannot be hashed as the approved path", async (t) => {
  const { root } = await digestFixture(t), path = join(root, "task.txt");
  await writeFile(path, "original"); let acquired: FileHandle | undefined;
  const openFile: typeof open = async (name, flags, mode) => {
    const handle = await open(name, flags, mode); acquired = handle;
    await rename(path, join(root, "old.txt")); await writeFile(path, "replacement");
    return handle;
  };
  await assert.rejects(new NodeFileDigestReader({ openFile }).digest(root, "task.txt"), /file changed/i);
  assert.equal(acquired?.fd, -1);
});

test("content modified during descriptor hashing is rejected and the descriptor closes", async (t) => {
  const { root } = await digestFixture(t), path = join(root, "task.txt");
  await writeFile(path, Buffer.alloc(65537, 4)); let acquired: FileHandle | undefined, changed = false;
  const openFile: typeof open = async (name, flags, mode) => {
    const handle = await open(name, flags, mode); acquired = handle;
    const originalRead = handle.read.bind(handle);
    handle.read = (async (buffer: Buffer, offset: number, length: number, position: number) => {
      const result = await originalRead(buffer, offset, length, position);
      if (!changed) { changed = true; await writeFile(path, Buffer.alloc(65538, 5)); }
      return result;
    }) as FileHandle["read"];
    return handle;
  };
  await assert.rejects(new NodeFileDigestReader({ openFile }).digest(root, "task.txt"), /file changed during hashing/i);
  assert.equal(changed, true); assert.equal(acquired?.fd, -1);
});


test("NUL Git filenames with literal backslashes cannot alias another tracked path", async () => {
  const runner = new ScriptedRunner({
    "rev-parse --show-toplevel": result("C:/work/example\n"),
    "ls-files -z": result("src\\secret.txt\0src/safe.txt\0"),
    "ls-files --deleted -z": result(""),
    "ls-files --others --exclude-standard -z": result(""),
    "ls-files --others --ignored --exclude-standard -z": result("")
  });
  const actual = await new GitCliInspector({ runner, digestReader: new FakeDigests() }).inspect("C:/work/example");
  assert.deepEqual(actual.trackedFiles, [{ path: "src/safe.txt", digest: "sha256:src/safe.txt" }]);
  assert.match(actual.issues?.join(" ") ?? "", /ambiguous backslash filename/i);
});

test("native Git metadata refuses invalid UTF-8 filenames before they can alias a Unicode path", { skip: process.platform !== "linux" ? "Unix byte-path behavior is exercised on native Linux" : false }, async t => {
  const { root } = await digestFixture(t);
  execFileSync("/usr/bin/git", ["init", root], { env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, stdio: "ignore" });
  await writeFile(Buffer.concat([Buffer.from(root + "/"), Buffer.from([255]), Buffer.from(".txt")]), "invalid byte name");
  await writeFile(join(root, "\ufffd.txt"), "different Unicode file");
  await assert.rejects(new NodeGitCommandRunner().run(["ls-files", "--others", "-z"], root), /valid UTF-8/i);
});
