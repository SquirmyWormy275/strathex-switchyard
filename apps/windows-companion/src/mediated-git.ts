/**
 * Concrete, local-only implementation of the candidate Git broker's
 * `local_commit` handler.  It is deliberately narrow: push, PR creation,
 * merge, and Direct Main stay unavailable until their separately gated broker
 * adapters and acceptance evidence exist.
 *
 * The handler never uses a shell or the caller's Git index.  It validates the
 * target again while holding a host-private lock, stages only exact
 * task-owned paths in a temporary index, and disables repository hooks so a
 * commit cannot become an arbitrary repository-script execution path.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  canonicalRepositoryPath,
  type BrokerOutcome,
  type GitRequest
} from "../../../packages/control-plane/src/brokers.ts";
import { redactText } from "../../../packages/control-plane/src/redaction.ts";

export interface LocalGitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface LocalGitRunner {
  run(args: readonly string[], options: Readonly<{ cwd: string; environment?: Readonly<Record<string, string>> }>): Promise<LocalGitResult>;
}

/** Fixed-argv runner: no request field is ever interpreted as shell syntax. */
export class SpawnLocalGitRunner implements LocalGitRunner {
  private readonly candidates: readonly string[];
  constructor(candidates: readonly string[] = ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\bin\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"]) {
    if (!candidates.length || candidates.some((candidate) => !isAbsolute(candidate) || !candidate.toLowerCase().endsWith("git.exe"))) throw new Error("Local Git mediation requires fixed absolute Git executable candidates.");
    this.candidates = [...candidates];
  }
  async run(args: readonly string[], options: Readonly<{ cwd: string; environment?: Readonly<Record<string, string>> }>): Promise<LocalGitResult> {
    const executable = await this.resolveExecutable();
    const environment = options.environment ?? {};
    if (Object.keys(environment).some((key) => key !== "GIT_INDEX_FILE") || Object.values(environment).some((value) => /[\r\n\0]/.test(value))) throw new Error("Local Git mediation rejected an unknown or unsafe environment override.");
    return new Promise((resolveResult, reject) => {
      const child = spawn(executable, [...args], {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        // Inspection commands must never opportunistically refresh the
        // caller's index.  Required locks for actual index writes still work;
        // this only disables Git's optional index writes.
        env: {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          WINDIR: process.env.WINDIR ?? "C:\\Windows",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "Never",
          GIT_CONFIG_NOSYSTEM: "1",
          LC_ALL: "C",
          ...environment
        }
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      const collect = (destination: Buffer[]) => (chunk: Buffer) => {
        // Git diagnostics are data only.  Bound them before redaction so a
        // hostile hook/error cannot consume companion memory.
        const remaining = 64 * 1024 - outputBytes;
        if (remaining <= 0) return;
        const captured = chunk.subarray(0, remaining);
        destination.push(captured);
        outputBytes += captured.length;
      };
      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));
      child.once("error", reject);
      child.once("close", (exitCode) => resolveResult({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      }));
    });
  }

  private async resolveExecutable(): Promise<string> {
    for (const candidate of this.candidates) {
      try {
        const metadata = await stat(candidate);
        if (metadata.isFile()) return realpath(candidate);
      } catch { /* try next fixed host path */ }
    }
    throw new Error("A trusted absolute Git executable is unavailable.");
  }
}

export interface MediatedGitHandlerOptions {
  /** Host-owned state outside the repository; temp indices and locks live here. */
  readonly stateDirectory: string;
  readonly runner?: LocalGitRunner;
  readonly now?: () => number;
  readonly lockTimeoutMs?: number;
}

interface HeldLock {
  readonly filePath: string;
  release(): Promise<void>;
}

/**
 * A real Git index lock, held only while the companion needs to reconcile the
 * selected worktree's shared index after committing from its private index.
 * Git itself honours this lock, so a normal concurrent `git add` fails rather
 * than being silently overwritten by the broker's reconciliation step.
 */
interface HeldSharedIndexLock {
  readonly indexPath: string;
  readonly lockPath: string;
  replaceWith(privateIndex: string): Promise<void>;
  release(): Promise<void>;
}

/**
 * This handler is registered behind `InMemoryGitBroker`, whose permit,
 * containment, ownership, cancellation, and effect-guard checks run before
 * it.  The repeated guard calls below close the remaining gap between that
 * broker check and the actual Git ref mutation.
 */
export class LocalMediatedGitHandler {
  private readonly stateDirectory: string;
  private readonly runner: LocalGitRunner;
  private readonly now: () => number;
  private readonly lockTimeoutMs: number;

  constructor(options: MediatedGitHandlerOptions) {
    this.stateDirectory = resolve(options.stateDirectory);
    this.runner = options.runner ?? new SpawnLocalGitRunner();
    this.now = options.now ?? Date.now;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
  }

  async execute(request: GitRequest): Promise<BrokerOutcome> {
    if (request.mutation.kind !== "local_commit") {
      return { status: "unavailable", summary: `${request.mutation.kind} has no enabled local B122 Git adapter.` };
    }
    if (!request.effectGuard) {
      return { status: "unavailable", summary: "Local Git mediation requires a host-owned final TargetSnapshot guard." };
    }
    if (!request.target.head || !request.target.indexTree || !request.target.branch) {
      return { status: "incomplete", summary: "Local Git mediation requires a complete TargetSnapshot with branch, HEAD, and index tree." };
    }
    const defaultBranch = isDefaultBranch(request.target.branch);
    if (defaultBranch && (!request.mutation.featureBranch || !validFeatureBranch(request.mutation.featureBranch))) {
      return { status: "blocked", summary: "A default-branch local commit requires one exact reviewed non-default feature branch." };
    }
    if (!defaultBranch && request.mutation.featureBranch !== undefined) {
      return { status: "blocked", summary: "A feature-branch local commit must not carry a branch-creation request." };
    }

    const initial = await currentEffect(request);
    if (initial) return initial;

    let root: string;
    try {
      root = await this.verifyRepositoryRoot(request.target.repositoryRoot);
    } catch (error) {
      return { status: "blocked", summary: redactText(errorMessage(error, "The verified repository root is unavailable.")) };
    }
    const paths = await this.verifyOwnedFiles(root, request.mutation.paths);
    if ("outcome" in paths) return paths.outcome;

    let lock: HeldLock | undefined;
    let sharedIndexLock: HeldSharedIndexLock | undefined;
    let temporaryIndex: string | undefined;
    let temporaryInspectionIndex: string | undefined;
    let temporaryHooks: string | undefined;
    try {
      lock = await this.acquireLock(root);
      // Revalidate while the companion-held worktree lock is active.  A
      // second process that changes the repository now makes the request
      // fail closed rather than creating a commit from stale authority.
      const locked = await currentEffect(request);
      if (locked) return locked;
      const precondition = await this.verifyGitPreconditions(root, request);
      if (precondition) return precondition;

      const operationDirectory = join(this.stateDirectory, "git-operations", request.operationId);
      await mkdir(operationDirectory, { recursive: true, mode: 0o700 });
      temporaryIndex = join(operationDirectory, `index-${randomUUID()}`);
      temporaryHooks = join(operationDirectory, `hooks-${randomUUID()}`);
      await mkdir(temporaryHooks, { recursive: true, mode: 0o700 });

      if (defaultBranch) {
        const final = await currentEffect(request);
        if (final) return final;
        const beforeBranch = await this.verifyGitPreconditions(root, request);
        if (beforeBranch) return beforeBranch;
        const featureBranch = request.mutation.featureBranch!;
        const switched = await this.runner.run(["-c", `core.hooksPath=${temporaryHooks}`, "switch", "-c", featureBranch, request.target.head], { cwd: root });
        const [observedBranch, observedHead, observedIndex] = await Promise.all([
          this.currentBranch(root).catch(() => undefined),
          this.currentHead(root).catch(() => undefined),
          this.currentIndexTree(root).catch(() => undefined)
        ]);
        if (switched.exitCode === 0 && observedBranch === featureBranch && observedHead === request.target.head && observedIndex === request.target.indexTree) {
          return {
            status: "incomplete",
            summary: "Created and switched to the exact reviewed feature branch without committing. Capture the new target and review the local commit again.",
            data: { featureBranch, beforeHead: request.target.head, commitCreated: false, freshReviewRequired: true }
          };
        }
        const branchRef = await this.runner.run(["show-ref", "--verify", "--hash", `refs/heads/${featureBranch}`], { cwd: root }).catch(() => undefined);
        if (observedBranch !== request.target.branch || observedHead !== request.target.head || branchRef?.exitCode === 0) {
          return { status: "incomplete", summary: "Feature-branch creation did not settle to one exact state; repository reconciliation is required before retry." };
        }
        return failedGit("The reviewed feature branch could not be created; the observed branch and HEAD remained unchanged.", switched);
      }

      const environment = { GIT_INDEX_FILE: temporaryIndex };

      const readTree = await this.runner.run(["read-tree", request.target.indexTree], { cwd: root, environment });
      if (readTree.exitCode !== 0) return failedGit("The broker could not construct a private index from the reviewed target.", readTree);
      const stage = await this.runner.run(["add", "-A", "--", ...paths.paths], { cwd: root, environment });
      if (stage.exitCode !== 0) return failedGit("The broker could not stage only the reviewed task-owned paths.", stage);
      const exact = await this.verifyPrivateIndex(root, environment, paths.canonical);
      if (exact) return exact;

      // The final effect guard is intentionally after temporary staging.  The
      // private index does not alter the selected repository, so a changed
      // target is still observable and blocks the ref update.
      const final = await currentEffect(request);
      if (final) return final;
      const beforeCommit = await this.verifyGitPreconditions(root, request);
      if (beforeCommit) return beforeCommit;

      // Hold Git's real index lock only after the last TargetSnapshot check.
      // The reviewed content is already frozen in the private index, so the
      // lock cannot make revalidation observe a synthetic change.  Copying
      // the shared index into another private file lets us verify that no
      // normal Git writer slipped in immediately before the lock was taken.
      sharedIndexLock = await this.acquireSharedIndexLock(root);
      temporaryInspectionIndex = join(operationDirectory, `shared-index-${randomUUID()}`);
      await copyFile(sharedIndexLock.indexPath, temporaryInspectionIndex);
      const indexLockedPrecondition = await this.verifyGitPreconditions(root, request, { GIT_INDEX_FILE: temporaryInspectionIndex });
      if (indexLockedPrecondition) return indexLockedPrecondition;
      const commit = await this.runner.run([
        "-c", `core.hooksPath=${temporaryHooks}`,
        "-c", "commit.gpgSign=false",
        "commit", "--no-verify", "-m", request.mutation.message
      ], { cwd: root, environment });
      if (commit.exitCode === 0) {
        const postHead = await this.currentHead(root);
        const committedTree = await this.currentHeadTree(root);
        const privateTree = await this.currentIndexTree(root, environment);
        if (privateTree !== committedTree) {
          return {
            status: "incomplete",
            summary: "Git advanced HEAD but the private reviewed index no longer matches the committed tree; reconciliation is required."
          };
        }
        try {
          await sharedIndexLock.replaceWith(temporaryIndex);
          sharedIndexLock = undefined;
        } catch (error) {
          return {
            status: "incomplete",
            summary: redactText(`Git advanced HEAD but the shared index could not be reconciled safely: ${errorMessage(error, "unknown index error")}`)
          };
        }
        return {
          status: "completed",
          summary: "Scoped local commit completed through a private index after final target revalidation and shared-index reconciliation.",
          data: { beforeHead: request.target.head, postHead, privateIndex: true, sharedIndexReconciled: true, stagedPaths: [...paths.paths] }
        };
      }

      const observedHead = await this.currentHead(root).catch(() => undefined);
      if (observedHead && observedHead !== request.target.head) {
        return {
          status: "incomplete",
          summary: "Git reported an error after the target HEAD changed; the commit outcome is ambiguous and requires reconciliation.",
          data: { beforeHead: request.target.head, observedHead }
        };
      }
      return failedGit("The reviewed local commit was rejected without changing the observed target HEAD.", commit);
    } catch (error) {
      return { status: "unavailable", summary: redactText(errorMessage(error, "The local Git broker failed before it could determine an outcome.")) };
    } finally {
      if (temporaryIndex) {
        await rm(temporaryIndex, { force: true }).catch(() => undefined);
        await rm(`${temporaryIndex}.lock`, { force: true }).catch(() => undefined);
      }
      if (temporaryInspectionIndex) {
        await rm(temporaryInspectionIndex, { force: true }).catch(() => undefined);
        await rm(`${temporaryInspectionIndex}.lock`, { force: true }).catch(() => undefined);
      }
      if (temporaryHooks) await rm(temporaryHooks, { recursive: true, force: true }).catch(() => undefined);
      if (sharedIndexLock) await sharedIndexLock.release().catch(() => undefined);
      if (lock) await lock.release().catch(() => undefined);
    }
  }

  private async verifyRepositoryRoot(expected: string): Promise<string> {
    const observed = await this.runner.run(["rev-parse", "--show-toplevel"], { cwd: expected });
    if (observed.exitCode !== 0 || !observed.stdout.trim()) throw new Error("The selected workspace is not a readable Git worktree.");
    const root = await realpath(observed.stdout.trim());
    const trusted = await realpath(expected);
    if (!samePath(root, trusted)) throw new Error("The selected Git worktree does not match the protected TargetSnapshot root.");
    return root;
  }

  private async verifyOwnedFiles(root: string, requested: readonly string[]): Promise<{ readonly paths: readonly string[]; readonly canonical: ReadonlySet<string> } | { readonly outcome: BrokerOutcome }> {
    const paths: string[] = [];
    const canonical = new Set<string>();
    for (const requestedPath of requested) {
      const normalized = canonicalRepositoryPath(requestedPath);
      if (!normalized) return { outcome: { status: "blocked", summary: "The Git handler received an unsafe task-owned path." } };
      if (canonical.has(normalized)) return { outcome: { status: "blocked", summary: "The Git handler received duplicate task-owned paths." } };
      const candidate = resolve(root, normalized);
      const relation = relative(root, candidate);
      if (!relation || relation === ".." || relation.startsWith(`..${sep}`)) {
        return { outcome: { status: "blocked", summary: "A task-owned path resolves outside the verified repository root." } };
      }
      try {
        const metadata = await lstat(candidate);
        if (metadata.isSymbolicLink()) return { outcome: { status: "blocked", summary: "The Git handler refuses a task-owned symlink path." } };
      } catch {
        // Deleted tracked paths are valid reviewed commit inputs.  Git itself
        // checks that `add -A -- <path>` can resolve the deletion in the
        // private index; no new path is inferred here.
      }
      canonical.add(normalized);
      paths.push(normalized);
    }
    return { paths, canonical };
  }

  private async verifyGitPreconditions(root: string, request: GitRequest, indexEnvironment?: Readonly<Record<string, string>>): Promise<BrokerOutcome | undefined> {
    const [head, branch, indexTree, staged] = await Promise.all([
      this.currentHead(root),
      this.currentBranch(root),
      this.currentIndexTree(root, indexEnvironment),
      this.runner.run(["diff", "--cached", "--quiet", "--exit-code"], { cwd: root, ...(indexEnvironment ? { environment: indexEnvironment } : {}) })
    ]);
    if (head !== request.target.head || branch !== request.target.branch || indexTree !== request.target.indexTree) {
      return { status: "incomplete", summary: "The repository HEAD, branch, or default index changed after target capture; no Git mutation was started." };
    }
    if (staged.exitCode === 1) {
      return { status: "blocked", summary: "The default Git index has staged changes; local mediation requires an untouched shared index." };
    }
    if (staged.exitCode !== 0) return failedGit("The broker could not inspect the default Git index.", staged);
    return undefined;
  }

  private async verifyPrivateIndex(root: string, environment: Readonly<Record<string, string>>, expected: ReadonlySet<string>): Promise<BrokerOutcome | undefined> {
    const result = await this.runner.run(["diff", "--cached", "--name-only", "-z"], { cwd: root, environment });
    if (result.exitCode !== 0) return failedGit("The broker could not inspect its private index.", result);
    const actual = result.stdout.split("\0").filter(Boolean).map((path) => canonicalRepositoryPath(path));
    if (actual.some((path) => !path) || actual.length !== expected.size || actual.some((path) => !expected.has(path!))) {
      return { status: "blocked", summary: "The private Git index contains paths outside the exact reviewed task-owned set." };
    }
    return undefined;
  }

  private async currentHead(root: string): Promise<string> {
    const result = await this.runner.run(["rev-parse", "HEAD"], { cwd: root });
    if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error("Git HEAD is unavailable.");
    return result.stdout.trim();
  }

  private async currentBranch(root: string): Promise<string> {
    const result = await this.runner.run(["branch", "--show-current"], { cwd: root });
    if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error("Git branch is unavailable.");
    return result.stdout.trim();
  }

  private async currentIndexTree(root: string, environment?: Readonly<Record<string, string>>): Promise<string> {
    const result = await this.runner.run(["write-tree"], { cwd: root, ...(environment ? { environment } : {}) });
    if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error("Git index tree is unavailable.");
    return result.stdout.trim();
  }

  private async currentHeadTree(root: string): Promise<string> {
    const result = await this.runner.run(["rev-parse", "HEAD^{tree}"], { cwd: root });
    if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error("Git HEAD tree is unavailable.");
    return result.stdout.trim();
  }

  private async acquireLock(root: string): Promise<HeldLock> {
    const directory = join(this.stateDirectory, "git-locks");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const safeName = basename(root).replace(/[^A-Za-z0-9._-]/g, "_");
    const filePath = join(directory, `${safeName}-${Buffer.from(root).toString("base64url").slice(0, 32)}.lock`);
    const deadline = this.now() + this.lockTimeoutMs;
    while (true) {
      try {
        const handle = await open(filePath, "wx", 0o600);
        await handle.writeFile(`${process.pid}:${this.now()}\n`, "utf8");
        await handle.close();
        return { filePath, release: async () => { await rm(filePath, { force: true }); } };
      } catch (error) {
        if (!isAlreadyExists(error) || this.now() >= deadline) throw new Error("Another mediated Git operation is active for this worktree.");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
    }
  }

  private async acquireSharedIndexLock(root: string): Promise<HeldSharedIndexLock> {
    const indexPath = await this.sharedIndexPath(root);
    const lockPath = `${indexPath}.lock`;
    const deadline = this.now() + this.lockTimeoutMs;
    while (true) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        await handle.close();
        return {
          indexPath,
          lockPath,
          replaceWith: async (privateIndex) => {
            await copyFile(privateIndex, lockPath);
            await rename(lockPath, indexPath);
          },
          release: async () => { await rm(lockPath, { force: true }); }
        };
      } catch (error) {
        if (!isAlreadyExists(error) || this.now() >= deadline) {
          throw new Error("The shared Git index is busy; no mediated commit was started.");
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
    }
  }

  private async sharedIndexPath(root: string): Promise<string> {
    const [index, gitDirectory] = await Promise.all([
      this.runner.run(["rev-parse", "--git-path", "index"], { cwd: root }),
      this.runner.run(["rev-parse", "--absolute-git-dir"], { cwd: root })
    ]);
    if (index.exitCode !== 0 || !index.stdout.trim() || gitDirectory.exitCode !== 0 || !gitDirectory.stdout.trim()) {
      throw new Error("The shared Git index location is unavailable.");
    }
    const indexPath = resolve(root, index.stdout.trim());
    const trustedGitDirectory = await realpath(gitDirectory.stdout.trim());
    const indexDirectory = await realpath(dirname(indexPath));
    const relation = relative(trustedGitDirectory, indexDirectory);
    if (relation === ".." || relation.startsWith(`..${sep}`)) {
      throw new Error("The shared Git index escapes the verified Git directory.");
    }
    return indexPath;
  }
}

async function currentEffect(request: GitRequest): Promise<BrokerOutcome | undefined> {
  const result = await request.effectGuard!.assertCurrent({
    action: request.action,
    operationId: request.operationId,
    target: request.target,
    ...(request.session ? { session: request.session } : {}),
    ...(request.authority ? { authority: request.authority } : {})
  });
  return result.allowed ? undefined : { status: "incomplete", summary: result.reason };
}

function isDefaultBranch(branch: string): boolean {
  return /^(main|master|trunk)$/i.test(branch);
}

function validFeatureBranch(branch: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch)
    && !branch.includes("..") && !branch.endsWith("/") && !branch.startsWith("-") && !isDefaultBranch(branch);
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function failedGit(prefix: string, result: LocalGitResult): BrokerOutcome {
  const detail = (result.stderr || result.stdout || `exit ${result.exitCode}`).trim();
  return { status: "failed", summary: `${prefix} ${redactText(detail).slice(0, 360)}` };
}
