import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  containmentIncidentReviewDigest,
  type ContainmentRemediationBinding,
  type ContainmentIncidentRecord,
  type DurableContainmentIncidentCoordinator
} from "../../../packages/control-plane/src/containment-incidents.ts";
import { jsonClone, sha256, stableJson, type JournalEntry, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";

const effectKind = "containment.history-remediation.saved.v2";
const digestPattern = /^[a-f0-9]{64}$/;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const shaPattern = /^[a-f0-9]{40,64}$/;
const maximumOutputBytes = 1024 * 1024;
const maximumCommits = 2_048;
const maximumRefs = 256;
const maximumWorktrees = 32;
const maximumMessageBytes = 64 * 1024;
const malformedLockGraceMilliseconds = 5 * 60 * 1_000;

export interface ContainmentHistoryTarget {
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly branch: string;
  readonly head: string;
  readonly completeness: "complete";
}

export interface ContainmentHistoryTargetResolver {
  resolve(sessionId: string): Promise<ContainmentHistoryTarget | undefined>;
}

export interface ContainmentHistoryGitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ContainmentHistoryGitRunner {
  run(args: readonly string[], options: Readonly<{
    cwd: string;
    environment?: Readonly<Record<string, string>>;
    stdin?: string;
  }>): Promise<ContainmentHistoryGitResult>;
}

export interface ContainmentHistoryRemediationRequest {
  readonly sessionId: string;
  readonly expectedIncidentId: string;
  readonly expectedIncidentDigest: string;
  readonly permitId: string;
  readonly relativePaths: readonly string[];
  readonly remediatedFindingIds: readonly string[];
}

export interface ContainmentHistoryRemediationResult {
  readonly operationId: string;
  readonly incidentId: string;
  readonly permitId: string;
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly oldHead: string;
  readonly newHead: string;
  readonly backupBundlePath: string;
  readonly backupBundleSha256: string;
  readonly incidentDigest: string;
  readonly updatedRefs: readonly ContainmentHistoryRefUpdate[];
  readonly strippedTagSignatures: number;
  readonly status: "completed";
}

export interface ContainmentHistoryRefUpdate {
  readonly refName: string;
  readonly kind: "head" | "tag";
  readonly oldObject: string;
  readonly newObject: string;
  readonly oldPeeledCommit: string | null;
  readonly newPeeledCommit: string | null;
}

interface ContainmentHistoryWorktreeBinding {
  readonly path: string;
  readonly branchRef: string;
  readonly oldHead: string;
  readonly newHead: string;
}

interface HistoryEffectRecord {
  readonly version: 2;
  readonly operationId: string;
  readonly sessionId: string;
  readonly incidentId: string;
  readonly incidentDigest: string;
  readonly permitId: string;
  readonly fenceEpoch: number;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly relativePaths: readonly string[];
  readonly findingIds: readonly string[];
  readonly oldHead: string;
  readonly newHead: string;
  readonly backupBundlePath: string;
  readonly backupBundleSha256: string;
  readonly namespaceRefs: readonly LocalRefInventory[];
  readonly updatedRefs: readonly ContainmentHistoryRefUpdate[];
  readonly worktrees: readonly ContainmentHistoryWorktreeBinding[];
  readonly strippedTagSignatures: number;
  readonly operator: string;
  readonly startedAt: string;
  readonly status: "prepared" | "ref_updated" | "receipted";
  readonly updatedAt: string;
}

interface HistoryEffectSaved { readonly record: HistoryEffectRecord; }

interface LocalRefInventory {
  readonly refName: string;
  readonly kind: "head" | "tag";
  readonly object: string;
  readonly objectType: "commit" | "tag" | "tree" | "blob";
  readonly peeledObject?: string;
  readonly peeledType?: "commit" | "tag" | "tree" | "blob";
}

interface RewritePlan {
  readonly updatedRefs: readonly ContainmentHistoryRefUpdate[];
  readonly oldCommitRoots: readonly string[];
  readonly newCommitRoots: readonly string[];
  readonly strippedTagSignatures: number;
}

export interface ContainmentHistoryRemediationOptions {
  readonly store: ProtectedJsonStore;
  readonly stateDirectory: string;
  readonly incidents: Pick<DurableContainmentIncidentCoordinator, "get" | "assertRemediationPermit" | "recordRemediation">;
  readonly presence: WindowsUserPresenceRunner;
  readonly targets: ContainmentHistoryTargetResolver;
  readonly git?: ContainmentHistoryGitRunner;
  readonly now?: () => Date;
}

/**
 * Rewrites every affected local branch and tag in one compare-and-swap ref
 * transaction, never a remote-tracking ref. A verified Git bundle containing
 * the exact old local ref namespace is written outside the repository before
 * any ref moves. Registered branch worktrees are preserved byte-for-byte and
 * rechecked around the effect.
 */
export class AttestedContainmentHistoryRemediator {
  private readonly store: ProtectedJsonStore;
  private readonly stateDirectory: string;
  private readonly incidents: ContainmentHistoryRemediationOptions["incidents"];
  private readonly presence: WindowsUserPresenceRunner;
  private readonly targets: ContainmentHistoryTargetResolver;
  private readonly git: ContainmentHistoryGitRunner;
  private readonly now: () => Date;

  constructor(options: ContainmentHistoryRemediationOptions) {
    this.store = options.store;
    this.stateDirectory = resolve(options.stateDirectory);
    this.incidents = options.incidents;
    this.presence = options.presence;
    this.targets = options.targets;
    this.git = options.git ?? new SpawnContainmentHistoryGitRunner();
    this.now = options.now ?? (() => new Date());
  }

  async execute(input: ContainmentHistoryRemediationRequest): Promise<ContainmentHistoryRemediationResult> {
    const request = validateRequest(input);
    const target = await this.requireTarget(request.sessionId);
    await mkdir(this.stateDirectory, { recursive: true, mode: 0o700 });
    const root = await this.canonicalRoot(target.repositoryRoot);
    const paths = exactPaths(request.relativePaths);
    const operationId = `containment-history:${sha256(stableJson({
      incidentId: request.expectedIncidentId,
      permitId: request.permitId,
      repositoryRoot: root.toLowerCase()
    }))}`;
    const operationKey = operationId.slice("containment-history:".length);
    const lock = await acquireLock(join(this.stateDirectory, "history-remediation", `${operationKey}.lock`));
    try {
      const existing = await this.effect(operationId);
      if (existing) return this.reconcile(existing, request);
      const incident = await this.incidents.get(request.expectedIncidentId);
      if (!incident || containmentIncidentReviewDigest(incident) !== request.expectedIncidentDigest) throw new Error("The containment incident changed after history-remediation review.");
      if ((await realpath(incident.repositoryRoot)).toLowerCase() !== root.toLowerCase()) throw new Error("The containment incident is bound to a different canonical repository root.");
      const binding: ContainmentRemediationBinding = {
        permitId: request.permitId,
        incidentId: request.expectedIncidentId,
        fenceEpoch: incident.fenceEpoch,
        action: "rewrite_local_history",
        relativePaths: paths,
        remediatedFindingIds: exactReferences(request.remediatedFindingIds, "history finding")
      };
      await this.incidents.assertRemediationPermit(binding);
      this.assertHistoryFindings(incident, binding.remediatedFindingIds, paths);
      const repository = await this.assertRepositoryPreconditions(root, target);
      const operationDirectory = join(this.stateDirectory, "history-remediation", operationKey);
      await mkdir(operationDirectory, { recursive: true, mode: 0o700 });
      const backupBundlePath = join(operationDirectory, "before.bundle");
      const privateIndex = join(operationDirectory, "rewrite.index");
      const backup = await this.ensureBackup(root, repository.refs, backupBundlePath);
      let plan: RewritePlan;
      try { plan = await this.rewriteLocalRefs(root, repository.refs, paths, privateIndex); }
      finally { await rm(privateIndex, { force: true }).catch(() => undefined); }
      const tipChanges = await this.assertOnlyReviewedPathsChangedForPlan(root, plan.updatedRefs, paths);
      await this.assertReviewedPathsAbsentFromHistory(root, plan.newCommitRoots, paths);
      const reviewed = await this.incidents.get(request.expectedIncidentId);
      if (!reviewed || containmentIncidentReviewDigest(reviewed) !== request.expectedIncidentDigest) throw new Error("The containment incident changed before the protected history-remediation effect was prepared.");
      await this.incidents.assertRemediationPermit(binding);
      const currentRef = `refs/heads/${target.branch}`;
      const currentUpdate = plan.updatedRefs.find((candidate) => candidate.refName === currentRef);
      const newHead = currentUpdate?.newObject ?? target.head;
      const worktrees = repository.worktrees.map((worktree) => ({
        ...worktree,
        newHead: plan.updatedRefs.find((candidate) => candidate.refName === worktree.branchRef)?.newObject ?? worktree.oldHead
      }));
      const previewDigest = sha256(stableJson({ backup, newHead, oldHead: target.head, paths, refUpdates: plan.updatedRefs, strippedTagSignatures: plan.strippedTagSignatures, tipChanges, worktrees }));
      const presence = await this.presence.verify(`Approve B122 rewrite ${plan.updatedRefs.length} local ref(s); current ${target.head.slice(0, 10)}>${newHead.slice(0, 10)}; purge ${paths.length} path(s); strip ${plan.strippedTagSignatures} tag signature(s); scope ${previewDigest}; no remote.`);
      if (!presence.verified || !presence.operator?.trim()) throw new Error("Current-user presence did not approve the exact prepared local history rewrite.");
      const startedAt = timestamp(this.now());
      const prepared: HistoryEffectRecord = {
        version: 2,
        operationId,
        sessionId: request.sessionId,
        incidentId: request.expectedIncidentId,
        incidentDigest: request.expectedIncidentDigest,
        permitId: request.permitId,
        fenceEpoch: incident.fenceEpoch,
        targetSnapshotId: target.targetSnapshotId,
        repositoryRoot: root,
        branch: target.branch,
        relativePaths: paths,
        findingIds: binding.remediatedFindingIds,
        oldHead: target.head,
        newHead,
        backupBundlePath,
        backupBundleSha256: backup,
        namespaceRefs: repository.refs,
        updatedRefs: plan.updatedRefs,
        worktrees,
        strippedTagSignatures: plan.strippedTagSignatures,
        operator: boundedText(presence.operator, "history remediation operator", 160),
        startedAt,
        status: "prepared",
        updatedAt: startedAt
      };
      await this.save(prepared);
      return this.reconcile(prepared, request);
    } finally {
      await lock.release();
    }
  }

  private async reconcile(record: HistoryEffectRecord, request: ContainmentHistoryRemediationRequest): Promise<ContainmentHistoryRemediationResult> {
    assertSameRequest(record, request);
    const target = await this.requireTarget(request.sessionId);
    const root = await this.canonicalRoot(target.repositoryRoot);
    if (root.toLowerCase() !== record.repositoryRoot.toLowerCase() || target.branch !== record.branch) throw new Error("The local history-remediation target changed during reconciliation.");
    const refState = await this.refDisposition(root, record.updatedRefs);
    if (record.status === "receipted") {
      if (refState !== "new") throw new Error("A completed local history-remediation receipt no longer matches the exact local ref namespace.");
      const incident = await this.requireRecordedReceipt(record, remediationEvidenceDigest(record));
      return result(record, containmentIncidentReviewDigest(incident));
    }
    if (target.head !== record.oldHead && target.head !== record.newHead) throw new Error("The local branch moved outside the exact prepared history rewrite; manual reconciliation is required.");
    if (refState === "other" || refState === "mixed") throw new Error("The local ref namespace moved partially or outside the exact prepared history rewrite; manual reconciliation is required.");
    if (refState === "old") {
      if (record.status !== "prepared") throw new Error("A started local history-remediation effect reverted to its old refs; manual reconciliation is required.");
      if (target.head !== record.oldHead) throw new Error("The current local branch disagrees with the prepared old ref namespace.");
      if (target.targetSnapshotId !== record.targetSnapshotId) throw new Error("The local history-remediation TargetSnapshot changed before the ref effect.");
      await this.assertPreparedRepositoryState(root, target, record);
      await this.assertBackup(record);
      await this.assertOnlyReviewedPathsChangedForPlan(root, record.updatedRefs, record.relativePaths);
      await this.assertReviewedPathsAbsentFromHistory(root, namespaceCommitRoots(completedNamespace(record.namespaceRefs, record.updatedRefs)), record.relativePaths);
      const currentIncident = await this.incidents.get(record.incidentId);
      if (!currentIncident || containmentIncidentReviewDigest(currentIncident) !== record.incidentDigest) throw new Error("The containment incident changed before the local history ref effect.");
      await this.incidents.assertRemediationPermit(remediationBinding(record));
      await this.commitRefUpdates(root, record.namespaceRefs, record.updatedRefs);
    }
    if (await this.refDisposition(root, record.updatedRefs) !== "new") throw new Error("The local history rewrite ref transaction is ambiguous.");
    await this.assertCompletedNamespace(root, record);
    const afterRef = await this.currentTarget(root, record.branch);
    if (afterRef.head !== record.newHead) throw new Error("The current local branch does not match the completed local ref transaction.");
    if (record.status === "prepared") {
      await this.assertPostRefWorktreesSafe(record.worktrees, record.relativePaths);
      record = { ...record, status: "ref_updated", updatedAt: timestamp(this.now()) };
      await this.save(record);
    }
    const evidenceDigest = remediationEvidenceDigest(record);
    let incident = await this.existingRecordedReceipt(record, evidenceDigest);
    incident ??= await this.incidents.recordRemediation({
      permitId: record.permitId,
      incidentId: record.incidentId,
      action: "rewrite_local_history",
      relativePaths: record.relativePaths,
      remediatedFindingIds: record.findingIds,
      evidenceDigest,
      effectStartedAt: record.startedAt
    });
    const receipted = { ...record, status: "receipted" as const, updatedAt: timestamp(this.now()) };
    await this.save(receipted);
    return result(receipted, containmentIncidentReviewDigest(incident));
  }

  private async rewriteLocalRefs(root: string, refs: readonly LocalRefInventory[], paths: readonly string[], privateIndex: string): Promise<RewritePlan> {
    const oldCommitRoots = uniqueShas(refs.map(refCommitRoot).filter((value): value is string => !!value));
    if (!oldCommitRoots.length) throw new Error("Local history remediation found no commit-bearing local branch or tag refs.");
    const history = await this.git.run(["rev-list", "--reverse", "--topo-order", "--parents", ...oldCommitRoots, "--"], { cwd: root });
    if (history.exitCode !== 0) throw new Error("The bounded local commit graph could not be read.");
    const rows = history.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (!rows.length || rows.length > maximumCommits) throw new Error("The local branch/tag history is empty or exceeds the bounded local rewrite limit.");
    const mapped = new Map<string, string>();
    for (const row of rows) {
      const ids = row.trim().split(/\s+/);
      const commit = exactSha(ids.shift() ?? "", "history commit");
      const parents = ids.map((id) => exactSha(id, "history parent"));
      const metadata = await this.commitMetadata(root, commit);
      await requireGit(this.git, ["read-tree", metadata.tree], { cwd: root, environment: { GIT_INDEX_FILE: privateIndex } }, "read the exact history tree");
      await requireGit(this.git, ["update-index", "--force-remove", "--", ...paths], { cwd: root, environment: { GIT_INDEX_FILE: privateIndex } }, "remove the exact reviewed paths from the private history index");
      const written = await requireGit(this.git, ["write-tree"], { cwd: root, environment: { GIT_INDEX_FILE: privateIndex } }, "write the private remediated tree");
      const tree = exactSha(written.stdout.trim(), "rewritten tree");
      const mappedParents = parents.map((parent) => mapped.get(parent) ?? parent);
      if (tree === metadata.tree && mappedParents.every((parent, index) => parent === parents[index])) {
        mapped.set(commit, commit);
        continue;
      }
      const created = await requireGit(this.git, ["commit-tree", tree, ...mappedParents.flatMap((parent) => ["-p", parent]), "-F", "-"], {
        cwd: root,
        stdin: metadata.message,
        environment: {
          GIT_AUTHOR_NAME: metadata.authorName,
          GIT_AUTHOR_EMAIL: metadata.authorEmail,
          GIT_AUTHOR_DATE: metadata.authorDate,
          GIT_COMMITTER_NAME: metadata.committerName,
          GIT_COMMITTER_EMAIL: metadata.committerEmail,
          GIT_COMMITTER_DATE: metadata.committerDate
        }
      }, "create the deterministic remediated commit");
      mapped.set(commit, exactSha(created.stdout.trim(), "rewritten commit"));
    }
    const tagMap = new Map<string, string>();
    const signatureCounter = { count: 0 };
    const updatedRefs: ContainmentHistoryRefUpdate[] = [];
    for (const ref of refs) {
      let newObject = ref.object;
      if (ref.objectType === "commit") newObject = mapped.get(ref.object) ?? ref.object;
      else if (ref.objectType === "tag") newObject = await this.rewriteTagObject(root, ref.object, mapped, tagMap, signatureCounter);
      if (newObject === ref.object) continue;
      const oldPeeledCommit = refCommitRoot(ref);
      const newPeeledCommit = oldPeeledCommit ? mapped.get(oldPeeledCommit) ?? oldPeeledCommit : null;
      updatedRefs.push({
        refName: ref.refName,
        kind: ref.kind,
        oldObject: ref.object,
        newObject,
        oldPeeledCommit,
        newPeeledCommit
      });
    }
    updatedRefs.sort((left, right) => left.refName.localeCompare(right.refName));
    if (!updatedRefs.length) throw new Error("The exact reviewed paths were not reachable from any local branch or tag history.");
    const newCommitRoots = uniqueShas(oldCommitRoots.map((rootCommit) => mapped.get(rootCommit) ?? rootCommit));
    return { updatedRefs, oldCommitRoots, newCommitRoots, strippedTagSignatures: signatureCounter.count };
  }

  private async rewriteTagObject(
    root: string,
    object: string,
    commits: ReadonlyMap<string, string>,
    tags: Map<string, string>,
    signatures: { count: number }
  ): Promise<string> {
    const cached = tags.get(object);
    if (cached) return cached;
    const raw = await requireGit(this.git, ["cat-file", "tag", object], { cwd: root }, "read an annotated local tag");
    if (Buffer.byteLength(raw.stdout, "utf8") > maximumMessageBytes) throw new Error("An annotated local tag exceeds the bounded rewrite limit.");
    const parsed = parseTagObject(raw.stdout);
    let rewrittenTarget = parsed.object;
    if (parsed.type === "commit") rewrittenTarget = commits.get(parsed.object) ?? parsed.object;
    else if (parsed.type === "tag") rewrittenTarget = await this.rewriteTagObject(root, parsed.object, commits, tags, signatures);
    if (rewrittenTarget === parsed.object) {
      tags.set(object, object);
      return object;
    }
    const stripped = stripTagSignature(parsed.body);
    if (stripped.removed) signatures.count += 1;
    const rewritten = `object ${rewrittenTarget}\ntype ${parsed.type}\n${parsed.restHeaders.join("\n")}\n\n${stripped.body}`;
    const created = await requireGit(this.git, ["hash-object", "-t", "tag", "-w", "--stdin"], { cwd: root, stdin: rewritten }, "create the remediated annotated tag");
    const newObject = exactSha(created.stdout.trim(), "rewritten annotated tag");
    tags.set(object, newObject);
    return newObject;
  }

  private async commitMetadata(root: string, commit: string): Promise<Readonly<{
    tree: string; authorName: string; authorEmail: string; authorDate: string;
    committerName: string; committerEmail: string; committerDate: string; message: string;
  }>> {
    const format = "%T%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B";
    const inspected = await requireGit(this.git, ["show", "-s", "--no-show-signature", `--format=${format}`, commit], { cwd: root }, "read bounded commit metadata");
    const fields = inspected.stdout.split("\0");
    if (fields.length !== 8) throw new Error("The local commit metadata is malformed or exceeds its bound.");
    const [tree, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, message] = fields as [string, string, string, string, string, string, string, string];
    if (Buffer.byteLength(message, "utf8") > maximumMessageBytes) throw new Error("A local commit message exceeds the bounded rewrite limit.");
    return {
      tree: exactSha(tree, "commit tree"),
      authorName: gitIdentity(authorName, "author name"), authorEmail: gitIdentity(authorEmail, "author email"), authorDate: gitDate(authorDate),
      committerName: gitIdentity(committerName, "committer name"), committerEmail: gitIdentity(committerEmail, "committer email"), committerDate: gitDate(committerDate),
      message
    };
  }

  private async assertRepositoryPreconditions(root: string, target: ContainmentHistoryTarget): Promise<Readonly<{ refs: readonly LocalRefInventory[]; worktrees: readonly ContainmentHistoryWorktreeBinding[] }>> {
    const topLevel = await requireGit(this.git, ["rev-parse", "--show-toplevel"], { cwd: root }, "verify the exact repository root");
    if ((await realpath(topLevel.stdout.trim())).toLowerCase() !== root.toLowerCase()) throw new Error("Local history remediation requires the exact canonical Git repository root.");
    const shallow = await requireGit(this.git, ["rev-parse", "--is-shallow-repository"], { cwd: root }, "inspect repository history completeness");
    if (shallow.stdout.trim() !== "false") throw new Error("Local history remediation refuses an incomplete shallow repository graph.");
    const observed = await this.currentTarget(root, target.branch);
    if (observed.head !== target.head) throw new Error("The local branch head changed before history remediation.");
    const refs = await this.localRefs(root);
    const currentRef = refs.find((ref) => ref.refName === `refs/heads/${target.branch}`);
    if (!currentRef || currentRef.objectType !== "commit" || currentRef.object !== target.head) throw new Error("The complete local ref namespace disagrees with the reviewed current branch.");
    const worktrees = await this.worktrees(root, refs);
    return { refs, worktrees };
  }

  private async assertPreparedRepositoryState(root: string, target: ContainmentHistoryTarget, record: HistoryEffectRecord): Promise<void> {
    const current = await this.assertRepositoryPreconditions(root, target);
    if (!sameRefNamespace(current.refs, record.namespaceRefs)) throw new Error("The local branch/tag namespace changed after history-remediation review.");
    if (!sameWorktrees(current.worktrees, record.worktrees, "old")) throw new Error("A registered local worktree changed after history-remediation review.");
  }

  private async localRefs(root: string): Promise<readonly LocalRefInventory[]> {
    const format = "%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)";
    const listed = await requireGit(this.git, ["for-each-ref", `--format=${format}`, "refs/heads", "refs/tags"], { cwd: root }, "inspect the complete local branch/tag namespace");
    if (Buffer.byteLength(listed.stdout, "utf8") > maximumOutputBytes) throw new Error("The local branch/tag namespace exceeds its bounded output limit.");
    const lines = listed.stdout.split(/\r?\n/).filter(Boolean);
    if (!lines.length || lines.length > maximumRefs) throw new Error("The local branch/tag namespace is empty or exceeds its bounded ref limit.");
    const refs = lines.map((line): LocalRefInventory => {
      const fields = line.split("\0");
      if (fields.length !== 5) throw new Error("The local branch/tag namespace response is malformed.");
      const [rawName, rawObject, rawType, rawPeeled, rawPeeledType] = fields as [string, string, string, string, string];
      const refName = localRefName(rawName);
      const kind = refName.startsWith("refs/heads/") ? "head" as const : "tag" as const;
      const objectType = gitObjectType(rawType, "local ref object");
      if (kind === "head" && objectType !== "commit") throw new Error("A local branch does not resolve to a commit object.");
      const peeledObject = rawPeeled ? exactSha(rawPeeled, "peeled local tag") : undefined;
      const peeledType = rawPeeledType ? gitObjectType(rawPeeledType, "peeled local tag") : undefined;
      if ((peeledObject && !peeledType) || (!peeledObject && peeledType) || (kind === "head" && (peeledObject || peeledType))) throw new Error("The local ref peel response is inconsistent.");
      return { refName, kind, object: exactSha(rawObject, "local ref object"), objectType, ...(peeledObject ? { peeledObject, peeledType } : {}) };
    }).sort((left, right) => left.refName.localeCompare(right.refName));
    if (new Set(refs.map((ref) => ref.refName)).size !== refs.length) throw new Error("The local branch/tag namespace contains duplicate refs.");
    return refs;
  }

  private async worktrees(root: string, refs: readonly LocalRefInventory[], allowedDirtyPaths?: readonly string[]): Promise<readonly ContainmentHistoryWorktreeBinding[]> {
    const listed = await requireGit(this.git, ["worktree", "list", "--porcelain", "-z"], { cwd: root }, "inspect registered worktrees");
    const parsed = parseWorktrees(listed.stdout);
    if (!parsed.length || parsed.length > maximumWorktrees) throw new Error("The registered worktree set is empty or exceeds its bounded limit.");
    const byRef = new Map(refs.filter((ref) => ref.kind === "head").map((ref) => [ref.refName, ref]));
    const reviewed = allowedDirtyPaths ? new Set(allowedDirtyPaths) : undefined;
    const result: ContainmentHistoryWorktreeBinding[] = [];
    for (const item of parsed) {
      if (!item.branchRef) throw new Error("Local history remediation requires every registered worktree to be attached to a local branch.");
      const branchRef = localHeadRefName(item.branchRef);
      const ref = byRef.get(branchRef);
      if (!ref || ref.object !== item.head) throw new Error("A registered worktree HEAD disagrees with its exact local branch ref.");
      const path = await realpath(absolutePath(item.path, "registered worktree"));
      const status = await requireGit(this.git, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--"], { cwd: path }, "inspect a registered worktree without changing bytes");
      const dirty = porcelainPaths(status.stdout);
      if (!reviewed && dirty.length) throw new Error("Local history remediation requires every registered index and worktree to be completely clean.");
      if (reviewed && dirty.some((candidate) => !reviewed.has(candidate))) throw new Error("A registered worktree changed outside the exact reviewed paths; no worktree bytes were reset.");
      result.push({ path, branchRef, oldHead: item.head, newHead: item.head });
    }
    result.sort((left, right) => left.path.toLowerCase().localeCompare(right.path.toLowerCase()));
    if (!result.some((item) => item.path.toLowerCase() === root.toLowerCase())) throw new Error("The canonical repository root is not a registered worktree.");
    return result;
  }

  private async currentTarget(root: string, expectedBranch: string): Promise<Readonly<{ branch: string; head: string }>> {
    const branch = await requireGit(this.git, ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: root }, "read the current local branch");
    const head = await requireGit(this.git, ["rev-parse", "--verify", "HEAD"], { cwd: root }, "read the current local head");
    const exactBranch = branchName(branch.stdout.trim());
    if (exactBranch !== expectedBranch) throw new Error("The current local branch changed after review.");
    return { branch: exactBranch, head: exactSha(head.stdout.trim(), "current head") };
  }

  private async assertOnlyReviewedPathsChangedForPlan(root: string, updates: readonly ContainmentHistoryRefUpdate[], paths: readonly string[]): Promise<readonly string[]> {
    const allChanged: string[] = [];
    const reviewed = new Set(paths);
    for (const update of updates) {
      const oldCommit = update.oldPeeledCommit ?? (update.kind === "head" ? update.oldObject : undefined);
      const newCommit = update.newPeeledCommit ?? (update.kind === "head" ? update.newObject : undefined);
      if (!oldCommit || !newCommit) continue;
      const diff = await requireGit(this.git, ["diff", "--name-only", "-z", "--no-renames", oldCommit, newCommit, "--"], { cwd: root }, "compare an exact rewritten local ref tip tree");
      allChanged.push(...diff.stdout.split("\0").filter(Boolean).map(exactPath));
    }
    const changed = [...new Set(allChanged)].sort((left, right) => left.localeCompare(right));
    if (changed.some((path) => !reviewed.has(path))) throw new Error("The prepared history rewrite changes paths outside the exact reviewed finding set.");
    return changed;
  }

  private async assertReviewedPathsAbsentFromHistory(root: string, newRoots: readonly string[], paths: readonly string[]): Promise<void> {
    if (!newRoots.length) throw new Error("The prepared remediated local ref namespace has no commit roots.");
    const reachable = await requireGit(this.git, ["rev-list", "--max-count=1", ...newRoots, "--", ...paths], { cwd: root }, "verify the remediated local branch/tag path history");
    if (reachable.stdout.trim()) throw new Error("A reviewed path remains reachable from the prepared local branch/tag history.");
  }

  private async assertPostRefWorktreesSafe(expected: readonly ContainmentHistoryWorktreeBinding[], paths: readonly string[]): Promise<void> {
    const refs = await this.localRefs(expected[0]!.path);
    const observed = await this.worktrees(expected[0]!.path, refs, paths);
    if (!sameWorktrees(observed, expected, "new")) throw new Error("The registered worktree set changed across the protected local ref transaction.");
  }

  private async refDisposition(root: string, updates: readonly ContainmentHistoryRefUpdate[]): Promise<"old" | "new" | "mixed" | "other"> {
    const refs = new Map((await this.localRefs(root)).map((ref) => [ref.refName, ref.object]));
    let old = 0;
    let next = 0;
    for (const update of updates) {
      const current = refs.get(update.refName);
      if (current === update.oldObject) old += 1;
      else if (current === update.newObject) next += 1;
      else return "other";
    }
    if (old === updates.length) return "old";
    if (next === updates.length) return "new";
    return "mixed";
  }

  private async commitRefUpdates(root: string, namespace: readonly LocalRefInventory[], updates: readonly ContainmentHistoryRefUpdate[]): Promise<void> {
    const byName = new Map(updates.map((update) => [update.refName, update]));
    const commands = ["start"];
    for (const ref of namespace) {
      const update = byName.get(ref.refName);
      commands.push(update ? `update ${update.refName} ${update.newObject} ${update.oldObject}` : `verify ${ref.refName} ${ref.object}`);
    }
    commands.push("prepare", "commit", "");
    const result = await this.git.run(["update-ref", "--stdin"], { cwd: root, stdin: commands.join("\n") });
    if (result.exitCode !== 0) throw new Error("The complete local branch/tag ref transaction did not commit atomically.");
  }

  private async assertCompletedNamespace(root: string, record: HistoryEffectRecord): Promise<void> {
    const expected = completedNamespace(record.namespaceRefs, record.updatedRefs);
    const current = await this.localRefs(root);
    if (!sameRefNamespace(current, expected)) throw new Error("The complete local branch/tag namespace changed during the protected ref transaction.");
  }

  private async ensureBackup(root: string, refs: readonly LocalRefInventory[], bundlePath: string): Promise<string> {
    try {
      const metadata = await lstat(bundlePath);
      if (!metadata.isFile()) throw new Error("The prepared history backup is not a regular file.");
    } catch {
      const created = await this.git.run(["bundle", "create", bundlePath, "--branches", "--tags"], { cwd: root });
      if (created.exitCode !== 0) throw new Error("The recoverable local history backup bundle could not be created.");
    }
    const verified = await this.git.run(["bundle", "verify", bundlePath], { cwd: root });
    if (verified.exitCode !== 0) throw new Error("The recoverable local history backup bundle did not verify.");
    await this.assertBundleContains(root, bundlePath, refs);
    return fileSha256(bundlePath);
  }

  private async assertBackup(record: HistoryEffectRecord): Promise<void> {
    const metadata = await lstat(record.backupBundlePath);
    if (!metadata.isFile() || await fileSha256(record.backupBundlePath) !== record.backupBundleSha256) throw new Error("The prepared recovery bundle changed before the local history ref effect.");
    const verified = await this.git.run(["bundle", "verify", record.backupBundlePath], { cwd: record.repositoryRoot });
    if (verified.exitCode !== 0) throw new Error("The prepared recovery bundle is no longer verifiable.");
    await this.assertBundleContains(record.repositoryRoot, record.backupBundlePath, record.namespaceRefs);
  }

  private async assertBundleContains(root: string, bundlePath: string, expectedRefs: readonly LocalRefInventory[]): Promise<void> {
    const listed = await this.git.run(["bundle", "list-heads", bundlePath], { cwd: root });
    if (listed.exitCode !== 0) throw new Error("The recoverable local history backup ref inventory is unavailable.");
    const heads = new Map(listed.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const separator = line.indexOf(" ");
      if (separator < 1) throw new Error("The recoverable local history backup ref inventory is malformed.");
      return [line.slice(separator + 1).trim(), exactSha(line.slice(0, separator), "backup ref object")] as const;
    }));
    for (const ref of expectedRefs) {
      if (refCommitRoot(ref) && heads.get(ref.refName) !== ref.object) throw new Error("The recoverable local history backup does not contain an exact reviewed local branch/tag ref.");
    }
  }

  private assertHistoryFindings(incident: Awaited<ReturnType<ContainmentHistoryRemediationOptions["incidents"]["get"]>>, findingIds: readonly string[], paths: readonly string[]): void {
    if (!incident) throw new Error("The exact containment incident is unavailable.");
    const historyFindings = new Map(incident.steps.find((step) => step.name === "history")?.result?.findings.map((finding) => [finding.id, finding]) ?? []);
    if (!findingIds.length || findingIds.some((id) => !historyFindings.has(id))) throw new Error("Local history remediation may cover only exact current history findings.");
    const byPath = new Map<string, string>();
    for (const id of findingIds) {
      const path = exactPath(historyFindings.get(id)!.relativePath);
      const prior = byPath.get(path.toLowerCase());
      if (prior && prior !== path) throw new Error("History findings disagree on the exact case-sensitive Git path.");
      byPath.set(path.toLowerCase(), path);
    }
    const findingPaths = [...byPath.values()].sort((left, right) => left.localeCompare(right));
    if (!sameStrings(findingPaths, paths)) throw new Error("The local history remediation paths changed their exact finding binding.");
  }

  private async requireTarget(sessionId: string): Promise<ContainmentHistoryTarget> {
    const target = await this.targets.resolve(sessionId);
    if (!target || target.completeness !== "complete") throw new Error("Local history remediation requires one complete current TargetSnapshot.");
    return {
      repositoryRoot: absolutePath(target.repositoryRoot, "history remediation repository"),
      targetSnapshotId: boundedReference(target.targetSnapshotId, "history remediation target snapshot"),
      branch: branchName(target.branch),
      head: exactSha(target.head, "history remediation head"),
      completeness: "complete"
    };
  }

  private async canonicalRoot(input: string): Promise<string> {
    const root = await realpath(input);
    const state = await realpath(this.stateDirectory);
    const metadata = await stat(root);
    if (!metadata.isDirectory()) throw new Error("The history-remediation repository root is unavailable.");
    const relativeState = relative(root, state);
    if (relativeState === "" || (!relativeState.startsWith(`..${sep}`) && relativeState !== ".." && !isAbsolute(relativeState))) throw new Error("The history-remediation state directory must be outside the repository.");
    return root;
  }

  private async effect(operationId: string): Promise<HistoryEffectRecord | undefined> {
    let current: HistoryEffectRecord | undefined;
    for (const entry of await this.store.readEntries()) {
      if (entry.kind !== effectKind) continue;
      const record = validateEffect((entry as JournalEntry<unknown>).payload).record;
      if (record.operationId === operationId) current = record;
    }
    return current ? jsonClone(current) : undefined;
  }

  private async save(record: HistoryEffectRecord): Promise<void> {
    await this.store.append<HistoryEffectSaved>(effectKind, { record: validateEffect({ record }).record });
  }

  private async existingRecordedReceipt(record: HistoryEffectRecord, evidenceDigest: string): Promise<ContainmentIncidentRecord | undefined> {
    const incident = await this.incidents.get(record.incidentId);
    if (!incident) throw new Error("The protected containment incident disappeared during history-remediation reconciliation.");
    const receipt = incident.receipts.find((candidate) => candidate.permitId === record.permitId);
    if (!receipt) return undefined;
    if (receipt.action !== "rewrite_local_history" || receipt.evidenceDigest !== evidenceDigest
      || !sameStrings(receipt.relativePaths, record.relativePaths) || !sameStrings(receipt.remediatedFindingIds, record.findingIds)) {
      throw new Error("The consumed history-remediation permit has a conflicting protected receipt.");
    }
    return incident;
  }

  private async requireRecordedReceipt(record: HistoryEffectRecord, evidenceDigest: string): Promise<ContainmentIncidentRecord> {
    const incident = await this.existingRecordedReceipt(record, evidenceDigest);
    if (!incident) throw new Error("The completed history-remediation effect is missing its protected incident receipt.");
    return incident;
  }
}

export class SpawnContainmentHistoryGitRunner implements ContainmentHistoryGitRunner {
  constructor(private readonly candidates: readonly string[] = [
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files\\Git\\bin\\git.exe",
    "C:\\Program Files (x86)\\Git\\cmd\\git.exe"
  ]) {
    if (!candidates.length || candidates.some((candidate) => !isAbsolute(candidate) || !candidate.toLowerCase().endsWith("git.exe"))) throw new Error("History remediation requires fixed absolute Git executable candidates.");
  }

  async run(args: readonly string[], options: Readonly<{ cwd: string; environment?: Readonly<Record<string, string>>; stdin?: string }>): Promise<ContainmentHistoryGitResult> {
    const executable = await this.executable();
    if (args.some((arg) => typeof arg !== "string" || /[\r\n\0]/.test(arg))) throw new Error("History remediation rejected an unsafe Git argument.");
    const environment = options.environment ?? {};
    const allowed = new Set(["GIT_INDEX_FILE", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_DATE", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_COMMITTER_DATE"]);
    if (Object.entries(environment).some(([key, value]) => !allowed.has(key) || !value || value.length > 4_096 || /[\r\n\0]/.test(value))) throw new Error("History remediation rejected an unknown or unsafe Git environment override.");
    if (options.stdin !== undefined && (Buffer.byteLength(options.stdin, "utf8") > maximumMessageBytes || options.stdin.includes("\0"))) throw new Error("History remediation rejected unsafe Git stdin.");
    return new Promise((resolveResult, rejectResult) => {
      const child = spawn(executable, [...args], {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
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
      let bytes = 0;
      let overflow = false;
      const collect = (destination: Buffer[]) => (chunk: Buffer) => {
        const remaining = maximumOutputBytes - bytes;
        if (remaining <= 0) { overflow = true; return; }
        const captured = chunk.subarray(0, remaining);
        destination.push(captured);
        bytes += captured.length;
        if (captured.length !== chunk.length) overflow = true;
      };
      child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
      child.once("error", rejectResult);
      child.once("close", (code) => {
        if (overflow) return rejectResult(new Error("History remediation Git output exceeded its bound."));
        resolveResult({ exitCode: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
      });
      child.stdin.end(options.stdin ?? "", "utf8");
    });
  }

  private async executable(): Promise<string> {
    for (const candidate of this.candidates) {
      try { if ((await stat(candidate)).isFile()) return realpath(candidate); } catch { /* try the next fixed path */ }
    }
    throw new Error("A trusted absolute Git executable is unavailable for local history remediation.");
  }
}

async function requireGit(git: ContainmentHistoryGitRunner, args: readonly string[], options: Parameters<ContainmentHistoryGitRunner["run"]>[1], label: string): Promise<ContainmentHistoryGitResult> {
  const result = await git.run(args, options);
  if (result.exitCode !== 0) throw new Error(`History remediation could not ${label}.`);
  return result;
}

async function acquireLock(path: string): Promise<Readonly<{ release(): Promise<void> }>> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(stableJson({ pid: process.pid, token, version: 1 }), "utf8");
      await handle.sync();
      return { async release() { await handle.close(); await rm(path, { force: true }); } };
    } catch (error) {
      if (!nodeError(error, "EEXIST")) throw error;
      if (!await staleLock(path)) throw new Error("Another exact local history-remediation operation is active.");
      const tombstone = `${path}.stale-${randomUUID()}`;
      try { await rename(path, tombstone); }
      catch { throw new Error("Another exact local history-remediation operation is active."); }
      await rm(tombstone, { force: true });
    }
  }
  throw new Error("The stale local history-remediation lock could not be recovered safely.");
}

async function staleLock(path: string): Promise<boolean> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, "utf8")); }
  catch {
    const metadata = await lstat(path);
    return Date.now() - metadata.mtimeMs >= malformedLockGraceMilliseconds;
  }
  if (!record(parsed) || parsed.version !== 1 || !Number.isSafeInteger(parsed.pid) || Number(parsed.pid) < 1
    || typeof parsed.token !== "string" || !/^[a-f0-9-]{36}$/i.test(parsed.token)) return false;
  return !processExists(Number(parsed.pid));
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return nodeError(error, "EPERM"); }
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveDone, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk)); stream.once("error", reject); stream.once("end", resolveDone);
  });
  return hash.digest("hex");
}

function validateRequest(value: ContainmentHistoryRemediationRequest): ContainmentHistoryRemediationRequest {
  return {
    sessionId: boundedReference(value.sessionId, "history remediation session"),
    expectedIncidentId: /^containment-incident:[a-f0-9]{64}$/.test(value.expectedIncidentId) ? value.expectedIncidentId : fail("The history-remediation incident ID is invalid."),
    expectedIncidentDigest: digest(value.expectedIncidentDigest, "history-remediation incident"),
    permitId: /^containment-remediation-permit:[a-f0-9]{64}$/.test(value.permitId) ? value.permitId : fail("The history-remediation permit ID is invalid."),
    relativePaths: exactPaths(value.relativePaths),
    remediatedFindingIds: exactReferences(value.remediatedFindingIds, "history finding")
  };
}

function validateEffect(value: unknown): HistoryEffectSaved {
  if (!record(value) || !record(value.record)) throw new Error("The protected local history-remediation effect is malformed.");
  const item = value.record;
  const keys = ["version", "operationId", "sessionId", "incidentId", "incidentDigest", "permitId", "fenceEpoch", "targetSnapshotId", "repositoryRoot", "branch", "relativePaths", "findingIds", "oldHead", "newHead", "backupBundlePath", "backupBundleSha256", "namespaceRefs", "updatedRefs", "worktrees", "strippedTagSignatures", "operator", "startedAt", "status", "updatedAt"];
  if (Object.keys(item).sort().join(",") !== keys.sort().join(",") || item.version !== 2 || !Number.isSafeInteger(item.fenceEpoch) || Number(item.fenceEpoch) < 1
    || !["prepared", "ref_updated", "receipted"].includes(String(item.status))) throw new Error("The protected local history-remediation effect schema is invalid.");
  const parsed: HistoryEffectRecord = {
    version: 2,
    operationId: boundedReference(item.operationId, "history operation"), sessionId: boundedReference(item.sessionId, "history session"),
    incidentId: /^containment-incident:[a-f0-9]{64}$/.test(String(item.incidentId)) ? String(item.incidentId) : fail("The protected history incident is invalid."),
    incidentDigest: digest(item.incidentDigest, "protected history incident"),
    permitId: /^containment-remediation-permit:[a-f0-9]{64}$/.test(String(item.permitId)) ? String(item.permitId) : fail("The protected history permit is invalid."),
    fenceEpoch: Number(item.fenceEpoch), targetSnapshotId: boundedReference(item.targetSnapshotId, "history target snapshot"),
    repositoryRoot: absolutePath(item.repositoryRoot, "history repository"), branch: branchName(item.branch),
    relativePaths: exactPaths(item.relativePaths as readonly string[]), findingIds: exactReferences(item.findingIds as readonly string[], "history finding"),
    oldHead: exactSha(item.oldHead, "history old head"), newHead: exactSha(item.newHead, "history new head"),
    backupBundlePath: absolutePath(item.backupBundlePath, "history backup bundle"), backupBundleSha256: digest(item.backupBundleSha256, "history backup bundle"),
    namespaceRefs: validateNamespaceRefs(item.namespaceRefs), updatedRefs: validateRefUpdates(item.updatedRefs), worktrees: validateWorktreeBindings(item.worktrees),
    strippedTagSignatures: safeCount(item.strippedTagSignatures, "stripped tag signature"),
    operator: boundedText(item.operator, "history operator", 160), startedAt: timestamp(new Date(String(item.startedAt))),
    status: item.status as HistoryEffectRecord["status"], updatedAt: timestamp(new Date(String(item.updatedAt)))
  };
  assertEffectConsistency(parsed);
  return { record: parsed };
}

function assertSameRequest(record: HistoryEffectRecord, request: ContainmentHistoryRemediationRequest): void {
  if (record.sessionId !== request.sessionId || record.incidentId !== request.expectedIncidentId || record.incidentDigest !== request.expectedIncidentDigest
    || record.permitId !== request.permitId || !sameCaseInsensitive(record.relativePaths, exactPaths(request.relativePaths))
    || !sameStrings(record.findingIds, exactReferences(request.remediatedFindingIds, "history finding"))) throw new Error("The prepared local history-remediation request changed during reconciliation.");
}

function result(record: HistoryEffectRecord, incidentDigest: string): ContainmentHistoryRemediationResult {
  return { operationId: record.operationId, incidentId: record.incidentId, permitId: record.permitId, repositoryRoot: record.repositoryRoot, branch: record.branch, oldHead: record.oldHead, newHead: record.newHead, backupBundlePath: record.backupBundlePath, backupBundleSha256: record.backupBundleSha256, incidentDigest, updatedRefs: record.updatedRefs, strippedTagSignatures: record.strippedTagSignatures, status: "completed" };
}

function remediationBinding(record: HistoryEffectRecord): ContainmentRemediationBinding {
  return {
    permitId: record.permitId,
    incidentId: record.incidentId,
    fenceEpoch: record.fenceEpoch,
    action: "rewrite_local_history",
    relativePaths: record.relativePaths,
    remediatedFindingIds: record.findingIds
  };
}

function remediationEvidenceDigest(record: HistoryEffectRecord): string {
  return sha256(stableJson({
    backupBundleSha256: record.backupBundleSha256,
    branch: record.branch,
    newHead: record.newHead,
    oldHead: record.oldHead,
    operationId: record.operationId,
    namespaceRefs: record.namespaceRefs,
    strippedTagSignatures: record.strippedTagSignatures,
    updatedRefs: record.updatedRefs,
    worktrees: record.worktrees
  }));
}

function validateNamespaceRefs(value: unknown): readonly LocalRefInventory[] {
  if (!Array.isArray(value) || !value.length || value.length > maximumRefs) throw new Error("The protected local ref namespace is invalid.");
  const refs = value.map((item): LocalRefInventory => {
    if (!record(item)) throw new Error("A protected local ref is malformed.");
    const hasPeeled = "peeledObject" in item || "peeledType" in item;
    const keys = hasPeeled ? ["kind", "object", "objectType", "peeledObject", "peeledType", "refName"] : ["kind", "object", "objectType", "refName"];
    if (Object.keys(item).sort().join(",") !== keys.sort().join(",")) throw new Error("A protected local ref schema is malformed.");
    const refName = localRefName(item.refName);
    const kind = item.kind === "head" || item.kind === "tag" ? item.kind : fail("A protected local ref kind is invalid.");
    if ((kind === "head") !== refName.startsWith("refs/heads/")) throw new Error("A protected local ref kind disagrees with its namespace.");
    const objectType = gitObjectType(item.objectType, "protected local ref object");
    if (kind === "head" && objectType !== "commit") throw new Error("A protected local branch is not commit-bearing.");
    if (!hasPeeled) return { refName, kind, object: exactSha(item.object, "protected local ref object"), objectType };
    const peeledObject = exactSha(item.peeledObject, "protected peeled local tag");
    const peeledType = gitObjectType(item.peeledType, "protected peeled local tag");
    if (kind !== "tag" || objectType !== "tag") throw new Error("Only an annotated local tag may contain protected peel metadata.");
    return { refName, kind, object: exactSha(item.object, "protected local ref object"), objectType, peeledObject, peeledType };
  });
  if (new Set(refs.map((ref) => ref.refName)).size !== refs.length || !sameStrings(refs.map((ref) => ref.refName), [...refs].sort((left, right) => left.refName.localeCompare(right.refName)).map((ref) => ref.refName))) throw new Error("The protected local ref namespace is duplicated or not canonical.");
  return refs;
}

function validateRefUpdates(value: unknown): readonly ContainmentHistoryRefUpdate[] {
  if (!Array.isArray(value) || !value.length || value.length > maximumRefs) throw new Error("The protected local ref update plan is invalid.");
  const updates = value.map((item): ContainmentHistoryRefUpdate => {
    if (!record(item) || Object.keys(item).sort().join(",") !== ["kind", "newObject", "newPeeledCommit", "oldObject", "oldPeeledCommit", "refName"].sort().join(",")) throw new Error("A protected local ref update is malformed.");
    const refName = localRefName(item.refName);
    const kind = item.kind === "head" || item.kind === "tag" ? item.kind : fail("A protected local ref update kind is invalid.");
    if ((kind === "head") !== refName.startsWith("refs/heads/")) throw new Error("A protected local ref update kind disagrees with its namespace.");
    const oldObject = exactSha(item.oldObject, "protected old ref object");
    const newObject = exactSha(item.newObject, "protected new ref object");
    if (oldObject === newObject) throw new Error("A protected local ref update is a no-op.");
    const oldPeeledCommit = item.oldPeeledCommit === null ? null : exactSha(item.oldPeeledCommit, "protected old peeled commit");
    const newPeeledCommit = item.newPeeledCommit === null ? null : exactSha(item.newPeeledCommit, "protected new peeled commit");
    if ((oldPeeledCommit === null) !== (newPeeledCommit === null)) throw new Error("A protected local ref update has inconsistent peeled commit bindings.");
    return { refName, kind, oldObject, newObject, oldPeeledCommit, newPeeledCommit };
  });
  if (new Set(updates.map((update) => update.refName)).size !== updates.length || !sameStrings(updates.map((update) => update.refName), [...updates].sort((left, right) => left.refName.localeCompare(right.refName)).map((update) => update.refName))) throw new Error("The protected local ref update plan is duplicated or not canonical.");
  return updates;
}

function validateWorktreeBindings(value: unknown): readonly ContainmentHistoryWorktreeBinding[] {
  if (!Array.isArray(value) || !value.length || value.length > maximumWorktrees) throw new Error("The protected registered-worktree set is invalid.");
  const worktrees = value.map((item): ContainmentHistoryWorktreeBinding => {
    if (!record(item) || Object.keys(item).sort().join(",") !== ["branchRef", "newHead", "oldHead", "path"].sort().join(",")) throw new Error("A protected registered-worktree binding is malformed.");
    return { path: absolutePath(item.path, "protected registered worktree"), branchRef: localHeadRefName(item.branchRef), oldHead: exactSha(item.oldHead, "protected worktree old head"), newHead: exactSha(item.newHead, "protected worktree new head") };
  });
  if (new Set(worktrees.map((item) => item.path.toLowerCase())).size !== worktrees.length || !sameStrings(worktrees.map((item) => item.path.toLowerCase()), [...worktrees].sort((left, right) => left.path.toLowerCase().localeCompare(right.path.toLowerCase())).map((item) => item.path.toLowerCase()))) throw new Error("The protected registered-worktree set is duplicated or not canonical.");
  return worktrees;
}

function assertEffectConsistency(record: HistoryEffectRecord): void {
  const namespace = new Map(record.namespaceRefs.map((ref) => [ref.refName, ref]));
  const updates = new Map(record.updatedRefs.map((update) => [update.refName, update]));
  for (const update of record.updatedRefs) {
    const original = namespace.get(update.refName);
    if (!original || original.kind !== update.kind || original.object !== update.oldObject || refCommitRoot(original) !== update.oldPeeledCommit) throw new Error("The protected local ref update is not bound to the exact old namespace.");
  }
  const currentRef = namespace.get(`refs/heads/${record.branch}`);
  if (!currentRef || currentRef.object !== record.oldHead || (updates.get(currentRef.refName)?.newObject ?? currentRef.object) !== record.newHead) throw new Error("The protected current-branch heads disagree with the local ref update plan.");
  for (const worktree of record.worktrees) {
    const original = namespace.get(worktree.branchRef);
    if (!original || original.object !== worktree.oldHead || (updates.get(worktree.branchRef)?.newObject ?? original.object) !== worktree.newHead) throw new Error("A protected worktree is not bound to the exact local ref update plan.");
  }
  if (record.strippedTagSignatures > record.updatedRefs.filter((update) => update.kind === "tag").length) throw new Error("The protected stripped-tag-signature count exceeds the reviewed tag update set.");
}

function completedNamespace(namespace: readonly LocalRefInventory[], updates: readonly ContainmentHistoryRefUpdate[]): readonly LocalRefInventory[] {
  const byName = new Map(updates.map((update) => [update.refName, update]));
  return namespace.map((ref) => {
    const update = byName.get(ref.refName);
    if (!update) return ref;
    if (ref.objectType !== "tag") return { ...ref, object: update.newObject };
    return { ...ref, object: update.newObject, ...(ref.peeledObject ? { peeledObject: update.newPeeledCommit ?? ref.peeledObject } : {}) };
  });
}

function sameRefNamespace(left: readonly LocalRefInventory[], right: readonly LocalRefInventory[]): boolean {
  return stableJson(left) === stableJson(right);
}

function sameWorktrees(observed: readonly ContainmentHistoryWorktreeBinding[], expected: readonly ContainmentHistoryWorktreeBinding[], phase: "old" | "new"): boolean {
  if (observed.length !== expected.length) return false;
  return observed.every((item, index) => item.path.toLowerCase() === expected[index]?.path.toLowerCase()
    && item.branchRef === expected[index]?.branchRef && item.oldHead === (phase === "old" ? expected[index]?.oldHead : expected[index]?.newHead));
}

function parseWorktrees(output: string): readonly Readonly<{ path: string; head: string; branchRef?: string }>[] {
  if (Buffer.byteLength(output, "utf8") > maximumOutputBytes) throw new Error("The registered-worktree inventory exceeds its bounded output limit.");
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const token of output.split("\0")) {
    if (!token) { if (block.length) { blocks.push(block); block = []; } continue; }
    block.push(token);
  }
  if (block.length) blocks.push(block);
  return blocks.map((fields) => {
    const pathField = fields.find((field) => field.startsWith("worktree "));
    const headField = fields.find((field) => field.startsWith("HEAD "));
    const branchField = fields.find((field) => field.startsWith("branch "));
    if (!pathField || !headField || fields.some((field) => field === "bare" || field.startsWith("prunable "))) throw new Error("A registered-worktree inventory record is incomplete or unsafe.");
    return { path: absolutePath(pathField.slice(9), "registered worktree"), head: exactSha(headField.slice(5), "registered worktree head"), ...(branchField ? { branchRef: localHeadRefName(branchField.slice(7)) } : {}) };
  });
}

function refCommitRoot(ref: LocalRefInventory): string | null {
  if (ref.objectType === "commit") return ref.object;
  return ref.objectType === "tag" && ref.peeledType === "commit" && ref.peeledObject ? ref.peeledObject : null;
}

function namespaceCommitRoots(refs: readonly LocalRefInventory[]): readonly string[] { return uniqueShas(refs.map(refCommitRoot).filter((value): value is string => !!value)); }

function uniqueShas(values: readonly string[]): readonly string[] { return [...new Set(values.map((value) => exactSha(value, "local commit root")))].sort(); }

function parseTagObject(value: string): Readonly<{ object: string; type: "commit" | "tag" | "tree" | "blob"; restHeaders: readonly string[]; body: string }> {
  const separator = value.indexOf("\n\n");
  if (separator < 0) throw new Error("An annotated local tag object is malformed.");
  const headers = value.slice(0, separator).split("\n");
  if (!headers[0]?.startsWith("object ") || !headers[1]?.startsWith("type ") || !headers[2]?.startsWith("tag ") || headers.some((line) => !line || /[\r\0]/.test(line))) throw new Error("An annotated local tag header is malformed.");
  const object = exactSha(headers[0].slice(7), "annotated tag target");
  const type = gitObjectType(headers[1].slice(5), "annotated tag target");
  const restHeaders = headers.slice(2);
  if (restHeaders.some((line) => line.startsWith("object ") || line.startsWith("type "))) throw new Error("An annotated local tag repeats its protected target header.");
  return { object, type, restHeaders, body: value.slice(separator + 2) };
}

function stripTagSignature(body: string): Readonly<{ body: string; removed: boolean }> {
  const marker = /(^|\n)-----BEGIN (?:PGP|SSH) SIGNATURE-----/.exec(body);
  if (!marker || marker.index === undefined) return { body, removed: false };
  return { body: body.slice(0, marker.index + (marker[1] ? 1 : 0)).replace(/\s+$/, "") + "\n", removed: true };
}

function localRefName(value: unknown): string {
  if (typeof value !== "string" || (!value.startsWith("refs/heads/") && !value.startsWith("refs/tags/")) || value.length > 1_024
    || /[\x00-\x20\x7f~^:?*\[\\]/.test(value) || value.includes("..") || value.includes("//") || value.includes("@{")
    || value.endsWith("/") || value.endsWith(".") || value.endsWith(".lock") || value.split("/").some((part) => !part || part.startsWith("."))) throw new Error("The exact local Git ref name is invalid.");
  return value;
}

function localHeadRefName(value: unknown): string { const parsed = localRefName(value); if (!parsed.startsWith("refs/heads/")) throw new Error("The registered worktree is not attached to a local branch ref."); return parsed; }
function gitObjectType(value: unknown, label: string): "commit" | "tag" | "tree" | "blob" { if (value !== "commit" && value !== "tag" && value !== "tree" && value !== "blob") throw new Error(`The Git ${label} type is invalid.`); return value; }
function safeCount(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximumRefs) throw new Error(`The ${label} count is invalid.`); return Number(value); }

function porcelainPaths(output: string): readonly string[] {
  const tokens = output.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.length < 4 || token[2] !== " ") throw new Error("The post-rewrite Git status response is malformed.");
    const status = token.slice(0, 2);
    paths.push(exactPath(token.slice(3)));
    if (status.includes("R") || status.includes("C")) {
      const original = tokens[++index];
      if (!original) throw new Error("The post-rewrite Git rename status is incomplete.");
      paths.push(exactPath(original));
    }
  }
  return paths;
}

function exactPaths(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || !values.length || values.length > 256) throw new Error("Local history remediation requires 1-256 exact paths.");
  const paths = values.map(exactPath).sort((left, right) => left.localeCompare(right));
  if (new Set(paths.map((path) => path.toLowerCase())).size !== paths.length) throw new Error("Local history-remediation paths are duplicated.");
  return paths;
}
function exactPath(value: unknown): string {
  if (typeof value !== "string") throw new Error("The local history-remediation path is invalid.");
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.length > 2_048 || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || /[\r\n\0]/.test(normalized)
    || normalized.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) throw new Error("The local history-remediation path escapes the exact repository boundary.");
  return normalized;
}
function exactReferences(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values) || !values.length || values.length > 256) throw new Error(`The ${label} references are invalid.`);
  const parsed = values.map((value) => boundedReference(value, label)).sort((left, right) => left.localeCompare(right));
  if (new Set(parsed).size !== parsed.length) throw new Error(`The ${label} references are duplicated.`);
  return parsed;
}
function sameCaseInsensitive(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value.toLowerCase() === right[index]?.toLowerCase()); }
function sameStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function boundedReference(value: unknown, label: string): string { if (typeof value !== "string" || !referencePattern.test(value)) throw new Error(`The ${label} reference is invalid.`); return value; }
function boundedText(value: unknown, label: string, maximum: number): string { if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\r\n\0]/.test(value)) throw new Error(`The ${label} is invalid.`); return value.trim(); }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(`The ${label} digest is invalid.`); return value; }
function exactSha(value: unknown, label: string): string { if (typeof value !== "string" || !shaPattern.test(value)) throw new Error(`The ${label} object ID is invalid.`); return value; }
function branchName(value: unknown): string { if (typeof value !== "string" || !value || value.length > 255 || /[\s~^:?*\[\\\0]/.test(value) || value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.includes("..") || value.includes("//") || value.endsWith(".lock")) throw new Error("The exact local branch name is invalid."); return value; }
function absolutePath(value: unknown, label: string): string { if (typeof value !== "string" || !isAbsolute(value) || value.length > 4_096 || /[\r\n\0]/.test(value)) throw new Error(`The ${label} path is invalid.`); return resolve(value); }
function gitIdentity(value: string, label: string): string { if (!value || value.length > 1_024 || /[\r\n\0]/.test(value)) throw new Error(`The Git ${label} is invalid.`); return value; }
function gitDate(value: string): string { if (!value || value.length > 128 || /[\r\n\0]/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("The Git identity date is invalid."); return value; }
function timestamp(value: Date): string { if (!Number.isFinite(value.getTime())) throw new Error("The local history-remediation timestamp is invalid."); return value.toISOString(); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function nodeError(value: unknown, code: string): boolean { return record(value) && value.code === code; }
function fail(message: string): never { throw new Error(message); }
