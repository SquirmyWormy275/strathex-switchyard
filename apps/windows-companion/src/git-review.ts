/** Current-user-attested, one-use Git mutation review queue. */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";

import { canonicalRepositoryPath, type GitMutation } from "../../../packages/control-plane/src/brokers.ts";
import { commandForAction, type CommandAction, type CommandDefinition } from "../../../packages/control-plane/src/command-catalog.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { GitMutationFactory } from "../../../packages/control-plane/src/dispatch.ts";
import type { ConfirmationAttestor, TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import type { JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";

export interface GitChangeInspector { changedPaths(repositoryRoot: string): Promise<readonly string[]>; }

export type GitReviewRequest = Readonly<{
  action: "local_commit" | "pr_upsert" | "pr_merge" | "direct_main";
  sessionId: string;
  mutation: GitMutation;
}>;

export interface GitReviewResult {
  readonly status: "approved" | "blocked" | "unavailable";
  readonly summary: string;
  readonly reviewId?: string;
  readonly targetSnapshotId?: string;
  readonly expiresAt?: string;
  readonly session?: ManagedSession;
}

export interface DurableGitMutationReviewQueueOptions {
  readonly store: ProtectedJsonStore;
  readonly sessions: SessionRegistry;
  readonly targetResolver: TargetResolver;
  readonly attestor: ConfirmationAttestor;
  readonly inspector?: GitChangeInspector;
  readonly now?: () => Date;
  readonly lifetimeMs?: number;
  readonly onSessionUpdated?: (session: ManagedSession) => void;
}

interface PendingReview {
  readonly id: string;
  readonly action: GitReviewRequest["action"];
  readonly targetSnapshotId: string;
  readonly sessionId: string;
  readonly mutation: GitMutation;
  readonly expiresAt: string;
}

const actionForMutation: Readonly<Record<GitMutation["kind"], GitReviewRequest["action"]>> = {
  local_commit: "local_commit",
  pr_upsert: "pr_upsert",
  merge_pr: "pr_merge",
  direct_main: "direct_main"
};

export class DurableGitMutationReviewQueue implements GitMutationFactory {
  private readonly options: DurableGitMutationReviewQueueOptions;
  private readonly inspector: GitChangeInspector;
  private readonly now: () => Date;
  private readonly lifetimeMs: number;
  private readonly pending = new Map<string, PendingReview>();

  constructor(options: DurableGitMutationReviewQueueOptions) {
    this.options = options;
    this.inspector = options.inspector ?? new WindowsGitChangeInspector();
    this.now = options.now ?? (() => new Date());
    this.lifetimeMs = options.lifetimeMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(this.lifetimeMs) || this.lifetimeMs < 10_000 || this.lifetimeMs > 15 * 60_000) throw new Error("Git review lifetime is outside the safe bound.");
  }

  async review(request: GitReviewRequest): Promise<GitReviewResult> {
    if (actionForMutation[request.mutation.kind] !== request.action) return blocked("Git review action and typed mutation do not match.");
    const definition = commandForAction(request.action);
    if (definition.executor !== "git") return blocked("Git review was requested for a non-Git command.");
    const session = await this.options.sessions.get(request.sessionId);
    if (!session || !session.workspaceRoot || !session.taskId || !session.planRevision) return blocked("Git review requires an exact task-bound managed session.");
    let target: TargetSnapshot | undefined;
    try { target = await this.options.targetResolver.resolve({ definition, session }); }
    catch { return unavailable("The trusted target resolver could not capture the Git review target."); }
    if (!target || target.completeness !== "complete" || !target.branch || !target.head || !target.indexTree) return unavailable("Git review requires a complete current TargetSnapshot.");
    if (!samePath(session.workspaceRoot, target.repositoryRoot)) return blocked("The selected session and Git review target do not match.");
    const validation = await this.validateMutation(request.mutation, target);
    if (validation) return validation;
    let attestation: Awaited<ReturnType<ConfirmationAttestor["attest"]>>;
    try { attestation = await this.options.attestor.attest({ definition, target, session, reason: "Review the exact typed Git mutation and task-owned scope." }); }
    catch { return unavailable("Windows user-presence verification was unavailable; no Git review was queued."); }
    if (!attestation?.reauthenticated || !attestation.operator.trim()) return blocked("Current-user presence was not verified; no Git review was queued.");

    let updated = session;
    if (request.mutation.kind === "local_commit") {
      updated = await this.options.sessions.updateBinding(session.id, { plannedFiles: request.mutation.paths });
      this.options.onSessionUpdated?.(updated);
    }
    const review: PendingReview = {
      id: `git-review:${randomUUID()}`,
      action: request.action,
      targetSnapshotId: target.id,
      sessionId: session.id,
      mutation: cloneMutation(request.mutation),
      expiresAt: new Date(this.now().getTime() + this.lifetimeMs).toISOString()
    };
    try {
      await this.options.store.append("b122.git-review.approved.v1", {
        id: review.id,
        action: review.action,
        targetSnapshotId: review.targetSnapshotId,
        sessionId: review.sessionId,
        mutation: review.mutation as unknown as JsonValue,
        operator: attestation.operator.trim(),
        expiresAt: review.expiresAt
      });
    } catch { return unavailable("The protected Git review receipt could not be recorded; nothing was queued."); }
    this.pending.set(key(review.action, review.targetSnapshotId, review.sessionId), review);
    return { status: "approved", summary: "Queued one exact, current-user-attested Git mutation for one dispatch.", reviewId: review.id, targetSnapshotId: target.id, expiresAt: review.expiresAt, session: updated };
  }

  create(definition: CommandDefinition, target: TargetSnapshot, session?: ManagedSession): GitMutation | undefined {
    if (!session) return undefined;
    const reviewKey = key(definition.action, target.id, session.id);
    const review = this.pending.get(reviewKey);
    if (!review) return undefined;
    // Consume before returning so any broker failure needs a fresh, visible review.
    this.pending.delete(reviewKey);
    if (Date.parse(review.expiresAt) <= this.now().getTime()) return undefined;
    if (review.action !== definition.action || review.targetSnapshotId !== target.id || review.sessionId !== session.id) return undefined;
    if (review.mutation.kind === "local_commit") {
      const granted = new Set(session.plannedFiles.map(canonicalRepositoryPath));
      if (granted.has(undefined) || review.mutation.paths.some((path) => !granted.has(canonicalRepositoryPath(path)))) return undefined;
    }
    return cloneMutation(review.mutation);
  }

  private async validateMutation(mutation: GitMutation, target: TargetSnapshot): Promise<GitReviewResult | undefined> {
    switch (mutation.kind) {
      case "local_commit": {
        if (isDefaultBranch(target.branch!)) return blocked("Local commit review refuses the default branch.");
        if (!mutation.paths.length || mutation.paths.length > 256 || !validCommitMessage(mutation.message)) return blocked("Local commit review requires bounded task-owned paths and a safe message.");
        const normalized = mutation.paths.map(canonicalRepositoryPath);
        if (normalized.some((path) => !path) || new Set(normalized).size !== normalized.length) return blocked("Local commit review contains an unsafe or duplicate path.");
        let changed: readonly string[];
        try { changed = await this.inspector.changedPaths(target.repositoryRoot); }
        catch { return unavailable("The host could not inspect the exact Git change set."); }
        const changedSet = new Set(changed.map(canonicalRepositoryPath));
        if (changedSet.has(undefined) || normalized.some((path) => !changedSet.has(path))) return blocked("A reviewed local-commit path is absent from the exact Git change set.");
        return undefined;
      }
      case "pr_upsert":
        if (!validBranch(mutation.headBranch) || !validBranch(mutation.baseBranch) || mutation.headBranch !== target.branch || mutation.headBranch === mutation.baseBranch) return blocked("PR review does not match the exact current feature branch and base.");
        return undefined;
      case "merge_pr":
        if (!Number.isSafeInteger(mutation.pullRequest) || mutation.pullRequest <= 0 || !/^[a-f0-9]{40}$/i.test(mutation.head) || !validBranch(mutation.baseBranch)) return blocked("PR merge review requires an exact pull request, head SHA, and base branch.");
        return undefined;
      case "direct_main":
        if (!validBranch(mutation.branch) || !/^receipt:[A-Za-z0-9._:-]{1,200}$/.test(mutation.validationReceiptId)) return blocked("Direct Main review lacks an exact branch or validation receipt.");
        return undefined;
    }
  }
}

/** Fixed-candidate Windows Git inspection; never PATH search or repository command text. */
export class WindowsGitChangeInspector implements GitChangeInspector {
  private readonly candidates: readonly string[];
  constructor(candidates: readonly string[] = ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\bin\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"]) { this.candidates = candidates; }
  async changedPaths(repositoryRoot: string): Promise<readonly string[]> {
    const executable = await this.resolveExecutable();
    const root = await realpath(repositoryRoot);
    const output = await runGit(executable, root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    if (output.exitCode !== 0) throw new Error("Git change inspection failed.");
    const fields = output.stdout.split("\0");
    const paths: string[] = [];
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      if (!field) continue;
      if (field.length < 4 || field[2] !== " ") throw new Error("Git returned malformed porcelain output.");
      const status = field.slice(0, 2);
      const path = canonicalRepositoryPath(field.slice(3));
      if (!path) throw new Error("Git returned an unsafe changed path.");
      paths.push(path);
      if (/[RC]/.test(status) && fields[index + 1]) index += 1;
    }
    return [...new Set(paths)];
  }
  private async resolveExecutable(): Promise<string> {
    for (const candidate of this.candidates) {
      try { const metadata = await stat(candidate); if (metadata.isFile()) return realpath(candidate); } catch { /* next fixed candidate */ }
    }
    throw new Error("A trusted absolute Git executable is unavailable.");
  }
}

function runGit(executable: string, cwd: string, args: readonly string[]): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, [...args], { cwd, shell: false, windowsHide: true, env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => { const remaining = 256 * 1024 - bytes; if (remaining > 0) { const part = chunk.subarray(0, remaining); stdout += part.toString("utf8"); bytes += part.byteLength; } });
    child.stderr.on("data", (chunk: Buffer) => { bytes += Math.min(chunk.byteLength, Math.max(0, 256 * 1024 - bytes)); });
    child.once("error", rejectRun);
    child.once("close", (code) => resolveRun({ exitCode: code ?? 1, stdout }));
  });
}

function blocked(summary: string): GitReviewResult { return { status: "blocked", summary }; }
function unavailable(summary: string): GitReviewResult { return { status: "unavailable", summary }; }
function key(action: string, targetSnapshotId: string, sessionId: string): string { return `${action}:${targetSnapshotId}:${sessionId}`; }
function samePath(left: string, right: string): boolean { const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase(); return normalize(left) === normalize(right); }
function validCommitMessage(value: string): boolean { return !!value.trim() && value.length <= 120 && !/[\0\r\n]/.test(value); }
function validBranch(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) && !value.includes("..") && !value.endsWith("/"); }
function isDefaultBranch(value: string): boolean { return /^(main|master|trunk)$/i.test(value); }
function cloneMutation<T extends GitMutation>(mutation: T): T { return JSON.parse(JSON.stringify(mutation)) as T; }
