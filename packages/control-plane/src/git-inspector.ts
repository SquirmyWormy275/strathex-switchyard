import { createHash } from "node:crypto";
import { lstat, open, realpath, stat, type FileHandle } from "node:fs/promises";
import { constants, type BigIntStats } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

import { trackedMissingFileDigest, type GitInspection, type GitInspector, type ManifestFile } from "./snapshot.ts";

export interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A narrow dependency so tests can run with no Git repository and no shell. */
export interface GitCommandRunner {
  run(args: readonly string[], workingDirectory?: string): Promise<GitCommandResult>;
}

export interface FileDigestReader {
  digest(repositoryRoot: string, relativePath: string): Promise<string>;
  state(repositoryRoot: string, relativePath: string): Promise<"regular_file" | "missing">;
}

export type UntrackedClassification = "included" | "excluded" | "unknown";

export interface GitCliInspectorOptions {
  readonly runner?: GitCommandRunner;
  readonly digestReader?: FileDigestReader;
  readonly classifyUntracked?: (relativePath: string) => UntrackedClassification;
  /**
   * Every ignored input receives an explicit policy decision. The safe default
   * is unknown so a present ignored config file makes a consequential snapshot
   * incomplete rather than silently invisible.
   */
  readonly classifyIgnored?: (relativePath: string) => UntrackedClassification;
}

/**
 * Uses `spawn` with a fixed Git executable and literal argv vectors. It never
 * invokes a shell, accepts command text from a key press, or performs a Git
 * mutation. The only write-tree query creates no ref or worktree change.
 */
export class NodeGitCommandRunner implements GitCommandRunner {
  private readonly candidates: readonly string[];

  constructor(candidates: readonly string[] = process.platform === "win32" ? [
    "C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\bin\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"
  ] : ["/usr/bin/git"]) {
    if (!candidates.length || candidates.some((candidate) => !isAbsolute(candidate) || !["git", "git.exe"].includes(basename(candidate).toLowerCase()))) {
      throw new Error("Target inspection requires fixed absolute Git executable candidates.");
    }
    this.candidates = [...candidates];
  }

  async run(args: readonly string[], workingDirectory?: string): Promise<GitCommandResult> {
    const executable = await this.fixedExecutable();
    return new Promise((resolveResult, reject) => {
      const child = spawn(executable, [...args], {
        cwd: workingDirectory,
        shell: false,
        windowsHide: true,
        env: {
          ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", WINDIR: process.env.WINDIR ?? "C:\\Windows" } : { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_GLOBAL: "/dev/null" }),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          LC_ALL: "C"
        }
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (exitCode) => resolveResult({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      }));
    });
  }

  private async fixedExecutable(): Promise<string> {
    for (const candidate of this.candidates) {
      try {
        if ((await stat(candidate)).isFile()) return realpath(candidate);
      } catch { /* continue */ }
    }
    throw new Error("A trusted absolute Git executable is unavailable for target inspection.");
  }
}

interface DirectoryStamp { readonly path: string; readonly dev: bigint; readonly ino: bigint; }
interface OpenRepositoryFile { readonly handle: FileHandle; readonly root: string; readonly path: string; readonly parents: readonly DirectoryStamp[]; readonly metadata: BigIntStats; }

/** Descriptor-bound, bounded hashing. Parent links cannot escape a task's root. */
export class NodeFileDigestReader implements FileDigestReader {
  private readonly maxFileBytes: number;
  private readonly openFile: typeof open;
  constructor(options: { readonly maxFileBytes?: number; readonly openFile?: typeof open } = {}) {
    this.maxFileBytes = options.maxFileBytes ?? 32 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes < 1 || this.maxFileBytes > 128 * 1024 * 1024) throw new Error("Choose a bounded repository digest size.");
    this.openFile = options.openFile ?? open;
  }

  async digest(repositoryRoot: string, relativePath: string): Promise<string> {
    const file = await this.openVerified(repositoryRoot, relativePath);
    try {
      if (file.metadata.size > BigInt(this.maxFileBytes)) throw new Error("Repository file exceeds the bounded digest size.");
      const hash = createHash("sha256"), buffer = Buffer.alloc(65536); let position = 0;
      while (true) {
        const { bytesRead } = await file.handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        if (position > this.maxFileBytes) throw new Error("Repository file exceeds the bounded digest size.");
        hash.update(buffer.subarray(0, bytesRead));
      }
      const after = await file.handle.stat({ bigint: true });
      if (!sameFile(file.metadata, after) || after.size !== BigInt(position)) throw new Error("Repository file changed during hashing.");
      await this.assertCurrent(file, after);
      return `sha256:${hash.digest("hex")}`;
    } finally { await file.handle.close(); }
  }

  async state(repositoryRoot: string, relativePath: string): Promise<"regular_file" | "missing"> {
    try { const file = await this.openVerified(repositoryRoot, relativePath); await file.handle.close(); return "regular_file"; }
    catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return "missing"; throw error; }
  }

  private async openVerified(repositoryRoot: string, relativePath: string): Promise<OpenRepositoryFile> {
    const root = await realpath(resolve(repositoryRoot)), path = resolve(root, relativePath), relation = relative(root, path);
    if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new Error("Path escapes the verified repository root.");
    const parents: DirectoryStamp[] = [];
    const parentParts = relative(root, dirname(path)).split(sep).filter(Boolean); let current = root;
    for (const part of ["", ...parentParts]) {
      if (part) current = resolve(current, part);
      const metadata = await lstat(current, { bigint: true });
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("Repository parent must be a real directory without symbolic links.");
      parents.push({ path: current, dev: metadata.dev, ino: metadata.ino });
    }
    const named = await lstat(path, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink()) throw new Error("Path is not a regular repository file.");
    const handle = await this.openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const metadata = await handle.stat({ bigint: true }), file = { handle, root, path, parents, metadata };
      await this.assertCurrent(file, metadata); return file;
    } catch (error) { await handle.close(); throw error; }
  }

  private async assertCurrent(file: OpenRepositoryFile, metadata: BigIntStats): Promise<void> {
    if (!metadata.isFile()) throw new Error("Path is not a regular repository file.");
    for (const parent of file.parents) {
      const observed = await lstat(parent.path, { bigint: true });
      if (!observed.isDirectory() || observed.isSymbolicLink() || observed.dev !== parent.dev || observed.ino !== parent.ino) throw new Error("Repository parent changed during file inspection.");
    }
    const named = await lstat(file.path, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || !sameFile(metadata, named)) throw new Error("Repository file changed during inspection.");
    const relation = relative(file.root, await realpath(file.path));
    if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new Error("Path escapes the verified repository root.");
  }
}
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function cleanOutput(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

function nulPaths(value: string): readonly string[] {
  return value.split("\0").filter(Boolean);
}

function parseSubmodules(value: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^[-+U ]?([0-9a-f]{7,64})\s+([^\s]+)/i);
    if (match) result[match[2]!.replaceAll("\\", "/")] = match[1]!;
  }
  return result;
}

function shortFailure(label: string, result: GitCommandResult): string {
  const detail = cleanOutput(result.stderr) ?? `exit ${result.exitCode}`;
  return `Git ${label} is unavailable (${detail.slice(0, 180)}).`;
}

/**
 * Read-only target discovery for the Windows companion. Failed Git commands
 * and unreadable worktree inputs become snapshot issues; they never cause the
 * caller to guess a repository, branch, untracked-file policy, or remote.
 */
export class GitCliInspector implements GitInspector {
  private readonly runner: GitCommandRunner;
  private readonly digestReader: FileDigestReader;
  private readonly classifyUntracked: (relativePath: string) => UntrackedClassification;
  private readonly classifyIgnored: (relativePath: string) => UntrackedClassification;

  constructor(options: GitCliInspectorOptions = {}) {
    this.runner = options.runner ?? new NodeGitCommandRunner();
    this.digestReader = options.digestReader ?? new NodeFileDigestReader();
    this.classifyUntracked = options.classifyUntracked ?? (() => "unknown");
    this.classifyIgnored = options.classifyIgnored ?? (() => "unknown");
  }

  async inspect(targetHint?: string): Promise<GitInspection> {
    const issues: string[] = [];
    const rootResult = await this.runner.run(["rev-parse", "--show-toplevel"], targetHint);
    const repositoryRoot = rootResult.exitCode === 0 ? cleanOutput(rootResult.stdout) : undefined;
    if (!repositoryRoot) return { ...(targetHint ? { repositoryRoot: targetHint } : {}), issues: [shortFailure("root discovery", rootResult)] };

    const remote = await this.optional(["remote", "get-url", "origin"], repositoryRoot, "canonical remote", issues);
    const branchResult = await this.runner.run(["branch", "--show-current"], repositoryRoot);
    const branch = branchResult.exitCode === 0 ? cleanOutput(branchResult.stdout) : undefined;
    if (branchResult.exitCode !== 0) issues.push(shortFailure("branch", branchResult));
    const detached = branchResult.exitCode === 0 && !branch;
    const remoteDefault = await this.optional(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], repositoryRoot, "default branch", issues, false);
    const defaultBranch = remoteDefault?.startsWith("origin/") ? remoteDefault.slice("origin/".length) : undefined;
    if (remoteDefault && !defaultBranch) issues.push("Git default branch reference is not bound to origin.");
    const upstream = await this.optional(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repositoryRoot, "upstream", issues, false);
    const head = await this.optional(["rev-parse", "HEAD"], repositoryRoot, "HEAD", issues);
    const indexTree = await this.optional(["write-tree"], repositoryRoot, "index tree", issues);
    const tracked = await this.paths(["ls-files", "-z"], repositoryRoot, "tracked file list", issues);
    const deleted = await this.paths(["ls-files", "--deleted", "-z"], repositoryRoot, "tracked deletion list", issues);
    const trackedSet = new Set(tracked);
    for (const path of deleted) if (!trackedSet.has(path)) issues.push(`Git reported tracked deletion ${path} outside the tracked file list.`);
    const deletedSet = new Set(deleted.filter((path) => trackedSet.has(path)));
    const untracked = await this.paths(["ls-files", "--others", "--exclude-standard", "-z"], repositoryRoot, "untracked file list", issues);
    const ignored = await this.paths(["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], repositoryRoot, "ignored file list", issues);
    const submoduleResult = await this.runner.run(["submodule", "status", "--recursive"], repositoryRoot);
    const submodules = submoduleResult.exitCode === 0 ? parseSubmodules(submoduleResult.stdout) : (issues.push(shortFailure("submodule status", submoduleResult)), {});

    return {
      repositoryRoot,
      ...(remote ? { canonicalRemote: remote } : {}),
      ...(branch ? { branch } : {}),
      ...(defaultBranch ? { defaultBranch } : {}),
      ...(detached ? { detached: true as const } : {}),
      ...(upstream ? { upstream } : {}),
      ...(head ? { head } : {}),
      ...(indexTree ? { indexTree } : {}),
      trackedFiles: await this.hashFiles(repositoryRoot, tracked, undefined, issues, undefined, deletedSet),
      untrackedFiles: await this.hashFiles(repositoryRoot, untracked, this.classifyUntracked, issues, "untracked"),
      ignoredFiles: await this.hashFiles(repositoryRoot, ignored, this.classifyIgnored, issues, "ignored"),
      submodules,
      issues
    };
  }

  private async optional(args: readonly string[], cwd: string, label: string, issues: string[], required = true): Promise<string | undefined> {
    const result = await this.runner.run(args, cwd);
    if (result.exitCode !== 0) {
      if (required) issues.push(shortFailure(label, result));
      return undefined;
    }
    const value = cleanOutput(result.stdout);
    if (!value && required) issues.push(`Git ${label} is empty.`);
    return value;
  }

  private async paths(args: readonly string[], cwd: string, label: string, issues: string[]): Promise<readonly string[]> {
    const result = await this.runner.run(args, cwd);
    if (result.exitCode !== 0) {
      issues.push(shortFailure(label, result));
      return [];
    }
    const paths = nulPaths(result.stdout);
    // Git's NUL format already uses '/' on Windows. A literal Linux backslash
    // must never be reinterpreted as a different directory during hashing.
    if (paths.some((path) => path.includes("\\"))) issues.push(`Git ${label} contains an ambiguous backslash filename; snapshot is incomplete.`);
    return paths.filter((path) => !path.includes("\\"));
  }

  private async hashFiles(
    repositoryRoot: string,
    paths: readonly string[],
    classifier: ((relativePath: string) => UntrackedClassification) | undefined,
    issues: string[],
    source?: "untracked" | "ignored",
    trackedMissing: ReadonlySet<string> = new Set()
  ): Promise<readonly ManifestFile[]> {
    const output: ManifestFile[] = [];
    for (const path of paths) {
      if (trackedMissing.has(path)) {
        try {
          if (await this.digestReader.state(repositoryRoot, path) !== "missing") {
            issues.push(`Tracked deletion ${path} reappeared while the snapshot was captured.`);
            output.push({ path });
            continue;
          }
          output.push({ path, digest: trackedMissingFileDigest(path), state: "tracked_missing" });
        } catch {
          issues.push(`Unable to prove tracked deletion ${path} is exactly missing; snapshot is incomplete.`);
          output.push({ path });
        }
        continue;
      }
      try {
        const digest = await this.digestReader.digest(repositoryRoot, path);
        output.push(classifier ? { path, digest, classification: classifier(path), ...(source ? { source } : {}) } : { path, digest });
      } catch {
        issues.push(`Unable to hash ${source ?? (classifier ? "untracked" : "tracked")} file ${path}; snapshot is incomplete.`);
        output.push(classifier ? { path, classification: classifier(path), ...(source ? { source } : {}) } : { path });
      }
    }
    return output;
  }
}
