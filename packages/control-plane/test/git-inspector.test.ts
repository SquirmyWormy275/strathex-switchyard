import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, open, readFile, readdir, rename, rm, symlink, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { GitCliInspector, NodeGitCommandRunner, NodeFileDigestReader, type GitCommandResult, type GitCommandRunner, type FileDigestReader } from "../src/git-inspector.ts";
import { gitIndexTreeFromListing, gitIndexTreeFromEntries } from "../src/git-index-tree.ts";

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

test("independent metadata overlaps in bounded groups after root discovery and before the final index witness", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = []; let active = 0, peak = 0, finished = 0, indexReads = 0;
  const runner: GitCommandRunner = { async run(args, cwd) {
    const key = args.join(" "); calls.push(key);
    if (key === "rev-parse --show-toplevel") { assert.equal(calls.length, 1); return result("C:/work/example\n"); }
    assert.equal(cwd, "C:/work/example");
    if (key === "ls-files --stage -z" && ++indexReads === 2) {
      assert.equal(finished, 10); assert.equal(active, 0); return result("");
    }
    active++; peak = Math.max(peak, active);
    try { await gate; return result(key === "rev-parse HEAD" ? "a".repeat(40) : ""); }
    finally { active--; finished++; }
  } };
  const pending = new GitCliInspector({ runner, digestReader: new FakeDigests() }).inspect();
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(active, 4); assert.equal(calls.length, 5);
  } finally { release(); await pending; }
  assert.equal(peak, 4); assert.equal(finished, 10); assert.equal(indexReads, 2);
  assert.equal(calls.includes("submodule status --recursive"), false);
});

test("a metadata failure joins every started sibling before rejecting and does not start another group", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = new Error("first metadata failure"), second = new Error("second metadata failure"), calls: string[] = [];
  let settled = false, active = 0;
  const runner: GitCommandRunner = { async run(args) {
    const key = args.join(" "); calls.push(key);
    if (key === "rev-parse --show-toplevel") return result("C:/work/example\n");
    if (key === "remote get-url origin") throw first;
    if (key === "branch --show-current") throw second;
    active++;
    try { await gate; return result(""); } finally { active--; }
  } };
  const pending = new GitCliInspector({ runner, digestReader: new FakeDigests() }).inspect().then(
    () => { settled = true; throw Error("A failed query produced a snapshot"); },
    error => { settled = true; return error; }
  );
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false); assert.equal(active, 2); assert.equal(calls.length, 5);
  } finally { release(); assert.equal(await pending, first); }
  assert.equal(active, 0); assert.equal(calls.length, 5);
});

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
    "rev-parse HEAD": result("a".repeat(40) + "\n"),
    "ls-files --stage -z": result("100644 " + "b".repeat(40) + " 0\tsrc/a.ts\0" + "100644 " + "b".repeat(40) + " 0\tsrc/b.ts\0"),
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
  assert.equal(runner.calls.includes("write-tree"), false);
});

test("read-only index trees match real Git while preserving cold index caches and object databases", async t => {
  const parent = await mkdtemp(join(tmpdir(), "switchyard-readonly-tree-")); t.after(() => rm(parent, { recursive: true, force: true }));
  const git = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git";
  for (const format of ["sha1", "sha256"] as const) {
    const root = join(parent, format); await mkdir(root);
    const run = (...args: string[]) => execFileSync(git, args, { cwd: root, timeout: 10000, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0" } });
    run("init", "-b", "main", "--object-format=" + format); run("config", "user.name", "Synthetic"); run("config", "user.email", "synthetic@example.invalid");
    await writeFile(join(root, "base"), "base\n"); run("add", "base"); run("-c", "commit.gpgsign=false", "commit", "-m", "synthetic base");
    for (const path of ["foo.bar", "foo/child", "foo0", "foo/sub/empty", "Zebra", "é/child", "Ω", "executable"]) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), path.endsWith("empty") ? "" : "exact " + path + "\n"); }
    run("add", "--all"); run("update-index", "--chmod=+x", "executable");
    // Mode-only metadata covers links without creating a live filesystem link.
    run("update-index", "--add", "--cacheinfo", "120000," + run("rev-parse", "HEAD:base").trim() + ",link");
    run("update-index", "--add", "--cacheinfo", "160000," + run("rev-parse", "HEAD").trim() + ",module");
    await writeFile(join(root, ".gitmodules"), '[submodule "module"]\n\tpath = module\n\turl = https://example.invalid/synthetic.git\n');
    async function objects() {
      const rows: string[] = [];
      const walk = async (directory: string, prefix = ""): Promise<void> => { for (const item of await readdir(directory, { withFileTypes: true })) { const name = prefix + item.name; if (item.isDirectory()) await walk(join(directory, item.name), name + "/"); else { assert.equal(item.isFile(), true); rows.push(name + ":" + createHash("sha256").update(await readFile(join(directory, item.name))).digest("hex")); } } };
      await walk(join(root, ".git/objects")); return rows.sort();
    }
    for (const empty of [false, true]) {
      if (empty) run("read-tree", "--empty");
      const before = await readFile(join(root, ".git/index")), beforeObjects = await objects();
      const native = new NodeGitCommandRunner([git]), calls: string[] = [];
      const inspected = await new GitCliInspector({ runner: { async run(args, cwd) { calls.push(args.join(" ")); return native.run(args, cwd); } }, digestReader: new FakeDigests() }).inspect(root);
      assert.equal(calls.includes("submodule status --recursive"), !empty);
      if (empty) assert.deepEqual(inspected.submodules, {});
      else assert.match(inspected.submodules?.module ?? "", /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
      assert.ok(inspected.indexTree); assert.deepEqual(await readFile(join(root, ".git/index")), before); assert.deepEqual(await objects(), beforeObjects);
      assert.equal(inspected.indexTree, run("write-tree").trim());
      assert.equal(inspected.indexTree, gitIndexTreeFromListing(run("ls-files", "--stage", "-z"), run("rev-parse", "HEAD").trim()));
    }
  }
});

test("an unchanged validated index without gitlinks avoids recursive submodule startup", async () => {
  const listing = "100644 " + "b".repeat(40) + " 0\tsrc/a.ts\0";
  const runner = new ScriptedRunner({
    "rev-parse --show-toplevel": result("C:/work/example\n"),
    "rev-parse HEAD": result("a".repeat(40) + "\n"),
    "ls-files --stage -z": result(listing)
  });
  const inspected = await new GitCliInspector({ runner, digestReader: new FakeDigests() }).inspect();
  assert.deepEqual(inspected.submodules, {});
  assert.equal(runner.calls.includes("submodule status --recursive"), false);
  assert.equal(runner.calls.filter(call => call === "ls-files --stage -z").length, 2);
  assert.equal(inspected.issues?.some(issue => /submodule|index tree changed/.test(issue)), false);
});

test("changed or unavailable final index cannot certify the absence of submodules", async () => {
  const listing = "100644 " + "b".repeat(40) + " 0\tsrc/a.ts\0";
  for (const final of [result(listing + "160000 " + "c".repeat(40) + " 0\tmodule\0"), { exitCode: 1, stdout: "", stderr: "unavailable" }]) {
    let reads = 0;
    const runner = new ScriptedRunner({ "rev-parse --show-toplevel": result("C:/work/example\n"), "rev-parse HEAD": result("a".repeat(40) + "\n") });
    const run = runner.run.bind(runner);
    runner.run = async args => args.join(" ") === "ls-files --stage -z" ? (++reads === 1 ? result(listing) : final) : run(args);
    const inspected = await new GitCliInspector({ runner, digestReader: new FakeDigests() }).inspect();
    assert.equal(reads, 2);
    assert.match(inspected.issues?.join(" ") ?? "", /index tree changed or became unavailable/i);
  }
});

test("gitlinks and invalid index metadata retain the recursive submodule query", async () => {
  for (const listing of ["160000 " + "c".repeat(40) + " 0\tmodule\0", "truncated", "100644 " + "b".repeat(40) + " 1\tunmerged\0"]) {
    const runner = new ScriptedRunner({
      "rev-parse --show-toplevel": result("C:/work/example\n"), "rev-parse HEAD": result("a".repeat(40) + "\n"),
      "ls-files --stage -z": result(listing), "submodule status --recursive": result("-" + "c".repeat(40) + " module\n")
    });
    const inspected = await new GitCliInspector({ runner, digestReader: new FakeDigests() }).inspect();
    assert.equal(runner.calls.filter(call => call === "submodule status --recursive").length, 1);
    assert.equal(Object.keys(inspected.submodules ?? {}).length, 1);
    if (!listing.startsWith("160000")) assert.match(inspected.issues?.join(" ") ?? "", /index tree metadata is unavailable/i);
  }
});

test("read-only index metadata refuses unmerged, sparse, colliding, truncated and oversized trees", () => {
  const head = "a".repeat(40), entry = (path: string) => ({ path, objectId: "b".repeat(40), mode: "100644" }), row = "100644 " + "b".repeat(40) + " 0\ta\0";
  for (const listing of [row.slice(0, -1), row + row, row.replace(" 0\t", " 1\t"), row.replace("100644", "040000"), row.replace("b".repeat(40), "0".repeat(40)), row.replace("\ta", "\t../a"), row.repeat(4097), "x".repeat(262145)]) assert.throws(() => gitIndexTreeFromListing(listing, head));
  for (const paths of [["a", "a/b"], ["a/b", "a"], ["a", "a"], ["bad\ud800"]]) assert.throws(() => gitIndexTreeFromEntries(paths.map(entry), "sha1"));
  assert.throws(() => gitIndexTreeFromEntries([entry("A/one"), entry("a/two")], "sha1", true));
  assert.throws(() => gitIndexTreeFromEntries([entry("a")], "sha256")); assert.throws(() => gitIndexTreeFromEntries(Array.from({ length: 4097 }, (_, i) => entry("p" + i)), "sha1"));
  assert.throws(() => gitIndexTreeFromListing("", "unverified-format"));
  assert.equal(gitIndexTreeFromListing("", head), "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
});

test("read-only Git inspector degrades an unreadable or unclassified file to an incomplete snapshot input", async () => {
  const runner = new ScriptedRunner({
    "rev-parse --show-toplevel": result("C:/work/example\n"),
    "remote get-url origin": result("https://github.com/example/repo.git\n"),
    "branch --show-current": result("feature/safe\n"),
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": result("origin/main\n"),
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": result("origin/feature/safe\n"),
    "rev-parse HEAD": result("a".repeat(40) + "\n"),
    "ls-files --stage -z": result("100644 " + "b".repeat(40) + " 0\tsrc/a.ts\0"),
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
    "rev-parse HEAD": result("a".repeat(40) + "\n"),
    "ls-files --stage -z": result(""),
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
    "rev-parse HEAD": result("a".repeat(40) + "\n"),
    "ls-files --stage -z": result("100644 " + "b".repeat(40) + " 0\tdeleted.txt\0" + "100644 " + "b".repeat(40) + " 0\tunknown.bin\0"),
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
