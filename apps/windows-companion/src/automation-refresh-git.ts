import { createHash } from "node:crypto";

import { canonicalRepositoryPath, type AutomationRequest, type BrokerOutcome, type EffectGuard, type GitRequest } from "../../../packages/control-plane/src/brokers.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { parseAutomationEnvelope, type AutomationEnvelope } from "../../../packages/control-plane/src/automation-protocol.ts";
import { sessionBindingDigest } from "../../../packages/control-plane/src/session-registry.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import type { AutomationChildEffectPort, AutomationChildEffectResult, AutomationEffectGuardPort } from "./automation-effect-executor.ts";
import type { AutomationRepairEnvironment } from "./automation-child-effects.ts";
import type { CheckpointGitRunner } from "./local-checkpoints.ts";

export interface InstalledAutomationRefreshGitCommitPortOptions {
  readonly request: AutomationRequest;
  readonly envelope: AutomationEnvelope;
  readonly sessions: Readonly<{ get(id: string): Promise<ManagedSession | undefined> }>;
  readonly targets: Readonly<{ get(id: string): Promise<TargetSnapshot | undefined> }>;
  readonly guard: AutomationEffectGuardPort;
  readonly commitObserver: AutomationRefreshGitCommitObserver;
  readonly handler: Readonly<{ execute(request: GitRequest): Promise<BrokerOutcome> }>;
}

type RefreshProposal = Extract<AutomationEnvelope["manifest"]["proposal"], { kind: "compound_refresh" }>;

export interface AutomationRefreshGitCommitObservation {
  readonly outcome: "not_started" | "committed" | "recovery_required";
  readonly observedHead: string | null;
  readonly observedTree: string | null;
  readonly observationDigest: string;
  readonly reason: string;
}

export interface AutomationRefreshGitCommitObserver {
  observe(input: Readonly<{
    repositoryRoot: string;
    expectedParentHead: string;
    expectedMessage: string;
    expectedMessageDigest: string;
    expectedMutations: RefreshProposal["mutations"];
  }>): Promise<AutomationRefreshGitCommitObservation>;
}

export interface InstalledAutomationRefreshGitChildInput {
  readonly child: Readonly<{ order: number; kind: "git_commit"; scopeDigest: string }>;
  readonly envelope: AutomationEnvelope;
  readonly currentTargetSnapshotId: string;
  readonly repairEnvironment: AutomationRepairEnvironment | null;
}

export interface InstalledAutomationRefreshGitCommitObserverOptions {
  readonly git: CheckpointGitRunner;
  readonly canonicalizeRoot: (repositoryRoot: string) => Promise<string>;
}

/**
 * Fixed-reader recovery probe for the exact reviewed Refresh commit. It never
 * calls a mutation command: the commit object, parent/tree, changed path set,
 * before/after blobs, shared index, worktree, and final ref are all observed.
 */
export class InstalledAutomationRefreshGitCommitObserver implements AutomationRefreshGitCommitObserver {
  constructor(private readonly options: InstalledAutomationRefreshGitCommitObserverOptions) {}

  async observe(input: Parameters<AutomationRefreshGitCommitObserver["observe"]>[0]): Promise<AutomationRefreshGitCommitObservation> {
    let observedHead: string | null = null;
    let observedTree: string | null = null;
    try {
      const canonicalRoot = await this.options.canonicalizeRoot(input.repositoryRoot);
      if (!sameRoot(canonicalRoot, input.repositoryRoot)) return recoveryObservation("The repository root no longer resolves to the exact reviewed canonical root.");
      if (!gitObjectId(input.expectedParentHead) || !digest(input.expectedMessageDigest)
        || sha256(input.expectedMessage) !== input.expectedMessageDigest || !input.expectedMutations.length) {
        return recoveryObservation("The reviewed Refresh commit parent, message, or mutation evidence is malformed.");
      }
      const mutations = input.expectedMutations.map((mutation) => {
        const path = canonicalRepositoryPath(mutation.path);
        if (!path || path !== mutation.path) throw new Error("The reviewed Refresh commit contains a non-canonical path.");
        return { mutation, path };
      });
      if (new Set(mutations.map(({ path }) => path)).size !== mutations.length) return recoveryObservation("The reviewed Refresh commit repeats a canonical path.");

      observedHead = await this.readObjectId(["rev-parse", "--verify", "HEAD"], canonicalRoot);
      if (observedHead === input.expectedParentHead) {
        return commitObservation("not_started", observedHead, null, "HEAD still equals the exact reviewed parent.", {
          expectedParentHead: input.expectedParentHead,
          expectedMessageDigest: input.expectedMessageDigest,
          expectedPaths: mutations.map(({ path }) => path)
        });
      }

      const commit = await this.readCommit(observedHead, canonicalRoot);
      observedTree = commit.tree;
      if (commit.parents.length !== 1 || commit.parents[0] !== input.expectedParentHead) {
        return recoveryObservation("The observed commit does not have the exact reviewed parent.", observedHead, observedTree);
      }
      if (commit.message !== `${input.expectedMessage}\n`) {
        return recoveryObservation("The observed commit message changed from the exact reviewed message.", observedHead, observedTree);
      }

      const changedPaths = await this.readChangedPaths(input.expectedParentHead, observedHead, canonicalRoot);
      const expectedPaths = [...mutations.map(({ path }) => path)].sort();
      if (stableJson(changedPaths) !== stableJson(expectedPaths)) {
        return recoveryObservation("The observed commit changed a path set outside the exact reviewed mutations.", observedHead, observedTree);
      }

      const blobEvidence: Array<Readonly<Record<string, unknown>>> = [];
      for (const { mutation, path } of mutations) {
        const before = await this.readTreeEntry(input.expectedParentHead, path, canonicalRoot);
        const after = await this.readTreeEntry(observedHead, path, canonicalRoot);
        if (mutation.mutation === "create") {
          if (before || !after || after.type !== "blob" || after.mode !== "100644" || mutation.beforeDigest !== null || !mutation.afterDigest || !mutation.content) {
            return recoveryObservation(`The observed create tree entry for ${path} changed from review.`, observedHead, observedTree);
          }
        } else if (mutation.mutation === "delete") {
          if (!before || before.type !== "blob" || after || !mutation.beforeDigest || mutation.afterDigest !== null || mutation.content !== null) {
            return recoveryObservation(`The observed delete tree entry for ${path} changed from review.`, observedHead, observedTree);
          }
        } else if (!before || !after || before.type !== "blob" || after.type !== "blob" || before.mode !== after.mode
          || !mutation.beforeDigest || !mutation.afterDigest || !mutation.content) {
          return recoveryObservation(`The observed update tree entry for ${path} changed type or mode.`, observedHead, observedTree);
        }
        if (before && mutation.beforeDigest && await this.readBlobDigest(before.objectId, canonicalRoot, mutation.beforeDigest) !== mutation.beforeDigest) {
          return recoveryObservation(`The observed parent blob for ${path} changed from the reviewed before digest.`, observedHead, observedTree);
        }
        if (after && mutation.afterDigest && await this.readBlobDigest(after.objectId, canonicalRoot, mutation.afterDigest) !== mutation.afterDigest) {
          return recoveryObservation(`The observed commit blob for ${path} changed from the reviewed after digest.`, observedHead, observedTree);
        }
        blobEvidence.push({ path, beforeObjectId: before?.objectId ?? null, afterObjectId: after?.objectId ?? null, beforeDigest: mutation.beforeDigest, afterDigest: mutation.afterDigest, beforeMode: before?.mode ?? null, afterMode: after?.mode ?? null });
      }

      const [indexClean, worktreeClean] = await Promise.all([
        this.options.git.run(["diff", "--cached", "--quiet", "--exit-code", observedHead, "--"], canonicalRoot, 1),
        this.options.git.run(["diff", "--quiet", "--exit-code", observedHead, "--", ...expectedPaths], canonicalRoot, 1)
      ]);
      if (indexClean.exitCode !== 0) return recoveryObservation("The shared Git index does not equal the exact observed commit tree.", observedHead, observedTree);
      if (worktreeClean.exitCode !== 0) return recoveryObservation("The reviewed worktree paths do not equal the exact observed commit tree.", observedHead, observedTree);
      const finalHead = await this.readObjectId(["rev-parse", "--verify", "HEAD"], canonicalRoot);
      if (finalHead !== observedHead) return recoveryObservation("HEAD changed during the exact read-only Refresh commit observation.", finalHead, observedTree);

      return commitObservation("committed", observedHead, observedTree, "The exact reviewed Refresh commit is already present and must not be replayed.", {
        expectedParentHead: input.expectedParentHead,
        expectedMessageDigest: input.expectedMessageDigest,
        expectedPaths,
        blobEvidence
      });
    } catch {
      return recoveryObservation("The exact read-only Refresh commit observation was unavailable or malformed.", observedHead, observedTree);
    }
  }

  private async readObjectId(args: readonly string[], root: string): Promise<string> {
    const result = await this.options.git.run(args, root, 256);
    const value = ascii(result.stdout);
    if (result.exitCode !== 0 || !gitObjectId(value)) throw new Error("Git object identity is unavailable.");
    return value;
  }

  private async readCommit(head: string, root: string): Promise<Readonly<{ tree: string; parents: readonly string[]; message: string }>> {
    const result = await this.options.git.run(["cat-file", "commit", head], root, 64 * 1024);
    if (result.exitCode !== 0) throw new Error("Git commit evidence is unavailable.");
    const bytes = Buffer.from(result.stdout);
    const delimiter = bytes.indexOf(Buffer.from("\n\n", "ascii"));
    if (delimiter < 1) throw new Error("Git commit evidence is malformed.");
    const headers = decodeUtf8(bytes.subarray(0, delimiter)).split("\n");
    const trees = headers.filter((line) => line.startsWith("tree ")).map((line) => line.slice(5));
    const parents = headers.filter((line) => line.startsWith("parent ")).map((line) => line.slice(7));
    if (trees.length !== 1 || !gitObjectId(trees[0]) || parents.some((parent) => !gitObjectId(parent))) throw new Error("Git commit parent/tree evidence is malformed.");
    return Object.freeze({ tree: trees[0]!, parents: Object.freeze(parents), message: decodeUtf8(bytes.subarray(delimiter + 2)) });
  }

  private async readChangedPaths(parent: string, head: string, root: string): Promise<readonly string[]> {
    const result = await this.options.git.run(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", parent, head, "--"], root, 1024 * 1024);
    if (result.exitCode !== 0) throw new Error("Git changed-path evidence is unavailable.");
    const paths = decodeUtf8(Buffer.from(result.stdout)).split("\0").filter(Boolean).map((value) => canonicalRepositoryPath(value));
    if (paths.some((path) => !path) || new Set(paths).size !== paths.length) throw new Error("Git changed-path evidence is non-canonical.");
    return Object.freeze((paths as string[]).sort());
  }

  private async readTreeEntry(commit: string, path: string, root: string): Promise<Readonly<{ mode: string; type: string; objectId: string }> | undefined> {
    const result = await this.options.git.run(["ls-tree", "-z", "--full-tree", commit, "--", path], root, 4096 + Buffer.byteLength(path));
    if (result.exitCode !== 0) throw new Error("Git tree entry evidence is unavailable.");
    const output = decodeUtf8(Buffer.from(result.stdout));
    if (!output) return undefined;
    const entries = output.split("\0").filter(Boolean);
    if (entries.length !== 1) throw new Error("Git tree entry evidence is ambiguous.");
    const separator = entries[0]!.indexOf("\t");
    const metadata = separator > 0 ? entries[0]!.slice(0, separator).split(" ") : [];
    const observedPath = separator > 0 ? canonicalRepositoryPath(entries[0]!.slice(separator + 1)) : undefined;
    if (metadata.length !== 3 || !/^[0-7]{6}$/u.test(metadata[0]!) || !gitObjectId(metadata[2]) || observedPath !== path) throw new Error("Git tree entry evidence is malformed.");
    return Object.freeze({ mode: metadata[0]!, type: metadata[1]!, objectId: metadata[2]! });
  }

  private async readBlobDigest(objectId: string, root: string, expectedDigest: string): Promise<string> {
    if (!digest(expectedDigest)) throw new Error("The reviewed blob digest is malformed.");
    const result = await this.options.git.run(["cat-file", "blob", objectId], root, 64 * 1024 * 1024);
    if (result.exitCode !== 0) throw new Error("Git blob evidence is unavailable.");
    return createHash("sha256").update(result.stdout).digest("hex");
  }
}

export function installedAutomationRefreshGitEvidenceDigest(input: Readonly<{
  envelope: AutomationEnvelope;
  sourceTarget: TargetSnapshot;
  session: ManagedSession;
  postHead: string;
}>): string {
  const envelope = parseAutomationEnvelope(input.envelope);
  const proposal = envelope.manifest.proposal;
  if (envelope.action !== "compound_refresh" || proposal.kind !== "compound_refresh" || !proposal.commit.planned
    || !digest(input.sourceTarget.id) || !gitObjectId(input.sourceTarget.head) || !gitObjectId(input.postHead)
    || input.sourceTarget.head === input.postHead || input.session.targetSnapshotId !== input.sourceTarget.id
    || !sameRoot(input.sourceTarget.repositoryRoot, envelope.manifest.repositoryRoot)
    || !sameRoot(input.session.workspaceRoot, input.sourceTarget.repositoryRoot)
    || input.session.id !== envelope.manifest.sessionId || input.session.taskId !== envelope.manifest.taskId
    || input.session.planRevision !== envelope.manifest.planRevision) {
    throw new Error("The installed Refresh Git evidence lost its exact reviewed envelope, session, target, or before/after HEAD binding.");
  }
  return sha256(stableJson({
    schema: "sxsy-b122.installed-refresh-git-evidence",
    version: 1,
    operationId: refreshGitOperationId(envelope, input.sourceTarget.id),
    manifestId: envelope.manifest.id,
    targetSnapshotId: input.sourceTarget.id,
    sessionBindingDigest: sessionBindingDigest(input.session),
    beforeHead: input.sourceTarget.head,
    postHead: input.postHead,
    paths: proposal.mutations.map((mutation) => mutation.path),
    messageDigest: proposal.commit.messageDigest
  }));
}

/**
 * Routes a reviewed Compound Refresh commit to the local private-index Git
 * mediator. The provider supplies exact proposal bytes only; it never sees a
 * Git capability, executable, credential, or effect result transport.
 */
export class InstalledAutomationRefreshGitCommitPort implements AutomationChildEffectPort<"git_commit"> {
  private readonly envelope: AutomationEnvelope;

  constructor(private readonly options: InstalledAutomationRefreshGitCommitPortOptions) {
    this.envelope = parseAutomationEnvelope(options.envelope);
    if (this.envelope.action !== "compound_refresh" || this.envelope.manifest.proposal.kind !== "compound_refresh"
      || !this.envelope.manifest.proposal.commit.planned) {
      throw new Error("The installed Refresh Git port requires one exact reviewed planned Compound Refresh commit.");
    }
    if (options.request.action !== "compound_refresh" || options.request.operationId !== this.envelope.operationId
      || !options.request.session || !options.request.authority || !options.request.permit || !options.request.executionControl
      || !options.request.effectGuard || options.request.target.id !== this.envelope.manifest.targetSnapshotId) {
      throw new Error("The installed Refresh Git port lost its exact mediated operation, target, session, authority, or execution binding.");
    }
  }

  async execute(input: InstalledAutomationRefreshGitChildInput): Promise<AutomationChildEffectResult> {
    const context = await this.loadContext(input);
    const reviewedCommit = plannedCommit(context.proposal);
    const prior = await this.observeCommit(context);
    if (prior.outcome === "committed") return this.committedResult(context, prior.observedHead!);
    if (prior.outcome === "recovery_required") throw new Error(`The reviewed Refresh commit requires exact recovery before any Git replay: ${prior.reason}`);

    let outcome: BrokerOutcome;
    try {
      outcome = await this.options.handler.execute({
        action: "local_commit",
        operationId: context.operationId,
        target: context.target,
        session: context.session,
        authority: context.authority,
        permit: this.options.request.permit,
        executionControl: this.options.request.executionControl,
        effectGuard: this.gitEffectGuard({ envelope: context.envelope, child: input.child, operationId: context.operationId, target: context.target, session: context.session, authority: context.authority }),
        mutation: {
          kind: "local_commit",
          paths: context.proposal.mutations.map((mutation) => mutation.path),
          message: reviewedCommit.message
        }
      });
    } catch {
      const observed = await this.observeCommit(context);
      if (observed.outcome === "committed") return this.committedResult(context, observed.observedHead!);
      throw new Error(`The mediated Refresh commit response was lost and exact observation could not prove the reviewed commit; recovery is required. ${observed.reason}`);
    }

    const observed = await this.observeCommit(context);
    if (observed.outcome === "committed") {
      const claimedPostHead = text(outcome.data?.postHead);
      const claimedBeforeHead = text(outcome.data?.beforeHead);
      if (outcome.effectDisposition === "committed" && (claimedBeforeHead !== context.target.head || claimedPostHead !== observed.observedHead)) {
        throw new Error("The mediated Refresh commit claim contradicts the exact read-only commit observation; recovery is required.");
      }
      return this.committedResult(context, observed.observedHead!);
    }
    if (observed.outcome === "recovery_required") {
      throw new Error(`The mediated Refresh commit left an inexact Git state; recovery is required. ${observed.reason}`);
    }
    if (outcome.effectDisposition === "not_started") {
      return Object.freeze({
        sourceTargetSnapshotId: context.target.id,
        scopeDigest: input.child.scopeDigest,
        evidenceDigest: sha256(stableJson({
          schema: "sxsy-b122.installed-refresh-git-not-started",
          version: 1,
          operationId: context.operationId,
          manifestId: context.envelope.manifest.id,
          targetSnapshotId: context.target.id,
          status: outcome.status,
          summary: outcome.summary
        })),
        effectDisposition: "not_started",
        compensationToken: null
      });
    }
    throw new Error("The mediated Refresh commit outcome is ambiguous or may have changed Git state; exact recovery is required.");
  }

  /** Restart-only reconciliation. This method never invokes a Git mutation handler. */
  async recover(input: InstalledAutomationRefreshGitChildInput): Promise<AutomationChildEffectResult> {
    const context = await this.loadContext(input);
    const observed = await this.observeCommit(context);
    if (observed.outcome === "committed") return this.committedResult(context, observed.observedHead!);
    if (observed.outcome === "not_started") {
      throw new Error("The reviewed Refresh commit was not observed after restart; the consumed effect boundary cannot be replayed.");
    }
    throw new Error(`The reviewed Refresh commit requires exact recovery and was not replayed: ${observed.reason}`);
  }

  private async loadContext(input: InstalledAutomationRefreshGitChildInput) {
    const envelope = parseAutomationEnvelope(input.envelope);
    const proposal = envelope.manifest.proposal;
    if (stableJson(envelope) !== stableJson(this.envelope) || proposal.kind !== "compound_refresh" || !proposal.commit.planned
      || input.repairEnvironment !== null || input.child.kind !== "git_commit" || input.child.order !== 1
      || input.child.scopeDigest !== proposal.commit.messageDigest || !digest(input.currentTargetSnapshotId)) {
      throw new Error("The installed Refresh Git child changed its reviewed envelope, message, order, scope, or current target binding.");
    }

    const [session, target] = await Promise.all([
      this.options.sessions.get(envelope.manifest.sessionId),
      this.options.targets.get(input.currentTargetSnapshotId)
    ]);
    if (!session || !target || session.id !== envelope.manifest.sessionId || session.status !== "running"
      || session.targetSnapshotId !== input.currentTargetSnapshotId || target.id !== input.currentTargetSnapshotId
      || !sameRoot(session.workspaceRoot, target.repositoryRoot) || !sameRoot(target.repositoryRoot, envelope.manifest.repositoryRoot)
      || session.taskId !== envelope.manifest.taskId || session.planRevision !== envelope.manifest.planRevision) {
      throw new Error("The installed Refresh Git child could not load the exact accepted current session and TargetSnapshot.");
    }
    const authority = this.options.request.authority!;
    const operationId = refreshGitOperationId(envelope, input.currentTargetSnapshotId);
    return Object.freeze({ envelope, proposal, session, target, authority, operationId, child: input.child });
  }

  private async observeCommit(context: Awaited<ReturnType<InstalledAutomationRefreshGitCommitPort["loadContext"]>>): Promise<AutomationRefreshGitCommitObservation> {
    const reviewedCommit = plannedCommit(context.proposal);
    const observation = await this.options.commitObserver.observe({
      repositoryRoot: context.target.repositoryRoot,
      expectedParentHead: context.target.head!,
      expectedMessage: reviewedCommit.message,
      expectedMessageDigest: reviewedCommit.messageDigest,
      expectedMutations: context.proposal.mutations
    });
    if (!observation || !digest(observation.observationDigest) || !text(observation.reason)
      || (observation.observedHead !== null && !gitObjectId(observation.observedHead))
      || (observation.observedTree !== null && !gitObjectId(observation.observedTree))
      || (observation.outcome === "not_started" && (observation.observedHead !== context.target.head || observation.observedTree !== null))
      || (observation.outcome === "committed" && (observation.observedHead === context.target.head || !observation.observedTree))) {
      throw new Error("The read-only Refresh Git observation is malformed or contradicts the exact reviewed parent.");
    }
    return Object.freeze({ ...observation });
  }

  private committedResult(
    context: Awaited<ReturnType<InstalledAutomationRefreshGitCommitPort["loadContext"]>>,
    postHead: string
  ): AutomationChildEffectResult {
    return Object.freeze({
      sourceTargetSnapshotId: context.target.id,
      scopeDigest: context.child.scopeDigest,
      evidenceDigest: installedAutomationRefreshGitEvidenceDigest({ envelope: context.envelope, sourceTarget: context.target, session: context.session, postHead }),
      effectDisposition: "committed",
      // A committed ref update is deliberately not auto-reset. If the
      // post-effect observation cannot settle, authenticated recovery must
      // reconcile the exact HEAD rather than guessing at compensation.
      compensationToken: null
    });
  }

  private gitEffectGuard(input: Readonly<{
    envelope: AutomationEnvelope;
    child: Readonly<{ order: number; kind: "git_commit"; scopeDigest: string }>;
    operationId: string;
    target: TargetSnapshot;
    session: ManagedSession;
    authority: AuthorityGrant;
  }>): EffectGuard {
    return {
      assertCurrent: async (candidate) => {
        if (candidate.action !== "local_commit" || candidate.operationId !== input.operationId
          || candidate.target.id !== input.target.id || candidate.session?.id !== input.session.id
          || candidate.authority?.id !== input.authority.id) {
          return { allowed: false, reason: "The mediated Refresh Git final-current request changed its exact operation binding." };
        }
        try {
          await this.options.guard.assertCurrent({
            envelope: input.envelope,
            boundary: "before_child",
            expectedTargetSnapshotId: input.target.id,
            child: input.child
          });
          return { allowed: true, reason: "The exact reviewed Refresh target remains current." };
        } catch {
          return { allowed: false, reason: "The exact reviewed Refresh target, authority, containment, or session changed before the Git effect." };
        }
      }
    };
  }
}

function plannedCommit(proposal: RefreshProposal): Readonly<{ message: string; messageDigest: string }> {
  const commit = proposal.commit;
  if (!commit.planned || typeof commit.message !== "string" || !commit.message.trim() || !digest(commit.messageDigest)) {
    throw new Error("The reviewed Refresh commit message is unavailable or malformed.");
  }
  return Object.freeze({ message: commit.message, messageDigest: commit.messageDigest });
}

function refreshGitOperationId(envelope: AutomationEnvelope, currentTargetSnapshotId: string): string {
  return `automation-refresh-${sha256(stableJson({
    schema: "sxsy-b122.automation-refresh-git-operation",
    version: 1,
    operationId: envelope.operationId,
    manifestId: envelope.manifest.id,
    currentTargetSnapshotId
  })).slice(0, 48)}`;
}

function sameRoot(left: string | undefined, right: string): boolean {
  return typeof left === "string" && left.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase()
    === right.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
}

function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function gitObjectId(value: unknown): value is string { return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value); }
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }

function commitObservation(
  outcome: "not_started" | "committed",
  observedHead: string,
  observedTree: string | null,
  reason: string,
  evidence: Readonly<Record<string, unknown>>
): AutomationRefreshGitCommitObservation {
  return Object.freeze({
    outcome,
    observedHead,
    observedTree,
    reason,
    observationDigest: sha256(stableJson({
      schema: "sxsy-b122.automation-refresh-git-read-only-observation",
      version: 1,
      outcome,
      observedHead,
      observedTree,
      evidence
    }))
  });
}

function recoveryObservation(reason: string, observedHead: string | null = null, observedTree: string | null = null): AutomationRefreshGitCommitObservation {
  return Object.freeze({
    outcome: "recovery_required",
    observedHead,
    observedTree,
    reason,
    observationDigest: sha256(stableJson({
      schema: "sxsy-b122.automation-refresh-git-read-only-observation",
      version: 1,
      outcome: "recovery_required",
      observedHead,
      observedTree,
      reason
    }))
  });
}

function ascii(value: Uint8Array): string {
  const decoded = Buffer.from(value).toString("ascii").replace(/[\r\n]+$/u, "");
  if (!decoded || /[^\x20-\x7e]/u.test(decoded)) throw new Error("Git returned non-ASCII identity evidence.");
  return decoded;
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}
