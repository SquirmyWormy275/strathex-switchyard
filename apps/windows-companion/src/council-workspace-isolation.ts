import { createServer } from "node:net";
import { lstat, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { canonicalRepositoryPath } from "../../../packages/control-plane/src/brokers.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore, sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { SpawnLocalGitRunner, type LocalGitRunner } from "./mediated-git.ts";
import {
  CouncilResourceHost,
  CouncilResourceHostError,
  type CouncilResourceHostBinding,
  type CouncilResourceHostPort,
  type CouncilResourceHostRequest
} from "./council-resource-host.ts";

export type CouncilIsolationStatus = "reserved" | "materializing" | "prepared" | "cleanup_pending" | "cleaned" | "manual_cleanup_required";
export type CouncilResourceLeaseKind = "branch" | "worktree" | "port" | "cache" | "temp" | "database" | "credential_scope";

export interface CouncilIsolationAssignmentRequest {
  readonly sessionId: string;
  readonly paths: readonly string[];
  readonly resources: readonly string[];
}

export interface CouncilIsolationPrepareRequest {
  readonly epochId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly targetHead: string;
  /** Host-observed canonical default branch name. It is never guessed. */
  readonly defaultBranch: string;
  readonly assignments: readonly CouncilIsolationAssignmentRequest[];
}

/** Host-owned cancellation and final-current barrier for isolation effects. */
export interface CouncilIsolationEffectControl {
  readonly signal: AbortSignal;
  assertCurrent(): Promise<void>;
  /** Called synchronously immediately before a materializing external mutation. */
  markExternalEffect?(): void;
}

export interface CouncilResourceLease {
  readonly id: string;
  readonly epochId: string;
  readonly sessionId: string;
  readonly kind: CouncilResourceLeaseKind;
  /** The collision key. Credential scopes are opaque identifiers, never secrets. */
  readonly resource: string;
  readonly declaration?: string;
  readonly localPath?: string;
  readonly fence: number;
  readonly acquiredAt: string;
  readonly status: "active" | "released";
  readonly releasedAt?: string;
}

export interface CouncilWorkspaceBinding {
  readonly sessionId: string;
  readonly paths: readonly string[];
  readonly declarations: readonly string[];
  readonly worktreeRoot: string;
  readonly branch: string;
  readonly head: string;
  readonly leases: readonly CouncilResourceLease[];
  /** Exact public resource binding; contains paths/ports/opaque handles, never credential values. */
  readonly resourceHost?: CouncilResourceHostBinding;
  readonly assignmentDigest: string;
}

export interface CouncilIsolationPlan {
  readonly epochId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly targetHead: string;
  readonly defaultBranch: string;
  readonly stateRoot: string;
  readonly bindings: readonly CouncilWorkspaceBinding[];
  readonly status: CouncilIsolationStatus;
  readonly executionAuthorized: false;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly failureReason?: string;
  readonly digest: string;
}

interface CouncilIsolationSavedEvent { readonly plan: CouncilIsolationPlan; }

export interface CouncilPortAvailabilityProbe { available(port: number): Promise<boolean>; }

/** Probes the actual loopback namespace. The durable Council lease separately fences other Council epochs. */
export class LoopbackCouncilPortAvailabilityProbe implements CouncilPortAvailabilityProbe {
  async available(port: number): Promise<boolean> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return false;
    return new Promise((resolveAvailable) => {
      const server = createServer();
      server.unref();
      server.once("error", () => resolveAvailable(false));
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => resolveAvailable(true)));
    });
  }
}

export class CouncilIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouncilIsolationError";
  }
}

export interface CouncilWorkspaceIsolationOptions {
  readonly stateRoot: string;
  readonly git?: LocalGitRunner;
  readonly ports?: CouncilPortAvailabilityProbe;
  readonly resourceHost?: CouncilResourceHostPort;
  readonly clock?: () => string;
}

const savedKind = "council.isolation.saved";
const activeStatuses = new Set<CouncilIsolationStatus>(["reserved", "materializing", "prepared", "cleanup_pending", "manual_cleanup_required"]);
const digestPattern = /^[a-f0-9]{64}$/;
const gitDigestPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const markerName = ".sxsy-b122-council-scope.json";

/**
 * Host-side Council isolation machinery. Worktree and lease intent is durably
 * reserved before Git is touched. A process restart reconciles the exact
 * external state or compensates it; it never repeats `git worktree add`.
 */
export class CouncilWorkspaceIsolationManager {
  private readonly store: ProtectedJsonStore;
  private readonly configuredStateRoot: string;
  private readonly git: LocalGitRunner;
  private readonly ports: CouncilPortAvailabilityProbe;
  private readonly resourceHost: CouncilResourceHostPort;
  private readonly clock: () => string;

  constructor(store: ProtectedJsonStore, options: CouncilWorkspaceIsolationOptions) {
    if (!isAbsolute(options.stateRoot)) throw new CouncilIsolationError("Council state root must be an absolute host-owned path.");
    this.store = store;
    this.configuredStateRoot = resolve(options.stateRoot);
    this.git = options.git ?? new SpawnLocalGitRunner();
    this.ports = options.ports ?? new LoopbackCouncilPortAvailabilityProbe();
    this.resourceHost = options.resourceHost ?? new CouncilResourceHost({ stateRoot: this.configuredStateRoot });
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async get(epochId: string): Promise<CouncilIsolationPlan | undefined> {
    const plan = planMap(await this.store.readEntries()).get(bounded(epochId, "Council epoch ID"));
    return plan ? clonePlan(plan) : undefined;
  }

  /** Returns the latest authenticated state for every durable isolation epoch. */
  async list(): Promise<readonly CouncilIsolationPlan[]> {
    return [...planMap(await this.store.readEntries()).values()]
      .sort((left, right) => left.epochId.localeCompare(right.epochId))
      .map(clonePlan);
  }

  /** Reserves every branch, worktree, and resource collision key before any Git mutation. */
  async reserve(input: CouncilIsolationPrepareRequest, control?: CouncilIsolationEffectControl): Promise<CouncilIsolationPlan> {
    await assertEffectCurrent(control);
    const normalized = await this.normalizeRequest(input, control);
    await assertEffectCurrent(control);
    const desired = this.desiredPlan(normalized);
    const reserved = await this.store.transaction(async (transaction) => {
      const plans = planMap(await transaction.readEntries());
      const existing = plans.get(desired.epochId);
      if (existing) {
        if (!sameIntent(existing, desired)) throw new CouncilIsolationError("Council epoch ID is already bound to a different target or isolation intent.");
        return clonePlan(existing);
      }
      const active = [...plans.values()].filter((plan) => activeStatuses.has(plan.status));
      const occupied = new Map<string, CouncilResourceLease>();
      for (const plan of active) for (const binding of plan.bindings) for (const lease of binding.leases) if (lease.status === "active") occupied.set(leaseKey(lease), lease);
      for (const binding of desired.bindings) {
        for (const lease of binding.leases) {
          const conflict = occupied.get(leaseKey(lease));
          if (conflict) throw new CouncilIsolationError(`Council resource lease is fenced by epoch ${conflict.epochId}: ${lease.kind}.`);
        }
      }
      const historical = [...plans.values()].flatMap((plan) => plan.bindings).flatMap((binding) => binding.leases);
      const withFences = desired.bindings.map((binding) => withAssignmentDigest({
        ...binding,
        leases: binding.leases.map((lease) => ({ ...lease, fence: 1 + Math.max(0, ...historical.filter((candidate) => leaseKey(candidate) === leaseKey(lease)).map((candidate) => candidate.fence)) }))
      }, desired));
      const reserved = withPlanDigest({ ...desired, bindings: withFences });
      await transaction.append<CouncilIsolationSavedEvent>(savedKind, { plan: reserved });
      return clonePlan(reserved);
    });
    await assertEffectCurrent(control);
    return reserved;
  }

  async prepare(input: CouncilIsolationPrepareRequest, control?: CouncilIsolationEffectControl): Promise<CouncilIsolationPlan> {
    const reserved = await this.reserve(input, control);
    if (reserved.status === "prepared") return reserved;
    if (reserved.status !== "reserved") throw new CouncilIsolationError("Council isolation has prior external state and must be recovered without replay.");
    return this.materialize(reserved.epochId, control);
  }

  /** Materialization is intentionally private to the single reserve->prepare call path. */
  private async materialize(epochId: string, control?: CouncilIsolationEffectControl): Promise<CouncilIsolationPlan> {
    await assertEffectCurrent(control);
    let plan = await this.mutate(epochId, (current) => {
      if (current.status === "prepared") return current;
      if (current.status !== "reserved") throw new CouncilIsolationError("Council isolation materialization cannot be replayed; run recovery.");
      return { ...current, status: "materializing" };
    });
    const externallyMaterialized = new Map<string, CouncilResourceHostBinding>();
    try {
      await guardedEffect(control, () => this.assertPortsAvailable(plan));
      for (const binding of plan.bindings) {
        await guardedEffect(control, () => this.assertBranchAndPathUnused(plan, binding));
        await guardedMutation(control, () => mkdir(resolve(binding.worktreeRoot, ".."), { recursive: true, mode: 0o700 }));
        const added = await guardedMutation(control, () => this.runGit(["worktree", "add", "-b", binding.branch, binding.worktreeRoot, plan.targetHead], plan.repositoryRoot));
        if (added.exitCode !== 0) throw new CouncilIsolationError("Git could not create the exact Council worktree on its reserved branch.");
        await guardedEffect(control, () => this.verifyWorktree(plan, binding, true));
      }
      for (const binding of plan.bindings) {
        const resourceHost = await guardedMutation(control, () => this.resourceHost.materialize(resourceRequest(plan, binding)));
        externallyMaterialized.set(binding.sessionId, resourceHost);
        plan = await this.mutate(plan.epochId, (current) => ({
          ...current,
          bindings: current.bindings.map((candidate) => candidate.sessionId === binding.sessionId
            ? withAssignmentDigest({ ...candidate, resourceHost }, current)
            : candidate)
        }));
      }
      await guardedEffect(control, () => this.verifyMaterialized(plan, true));
      await assertEffectCurrent(control);
      const prepared = await this.mutate(plan.epochId, (current) => {
        if (current.status !== "materializing") throw new CouncilIsolationError("Council isolation state changed during materialization.");
        const { failureReason: _failureReason, ...withoutFailure } = current;
        return { ...withoutFailure, status: "prepared" };
      });
      await assertEffectCurrent(control);
      return prepared;
    } catch (error) {
      const reason = controlledReason(error, "Council isolation could not prove exact independent host resources.");
      for (const binding of plan.bindings) {
        const resourceHost = externallyMaterialized.get(binding.sessionId) ?? binding.resourceHost;
        if (resourceHost) await this.resourceHost.cleanup(resourceRequest(plan, binding), resourceHost).catch(() => undefined);
      }
      await this.mutate(plan.epochId, (current) => ({ ...current, status: "cleanup_pending", failureReason: reason })).catch(() => undefined);
      await this.cleanup(plan.epochId).catch(() => undefined);
      throw error instanceof CouncilIsolationError ? error : new CouncilIsolationError(reason);
    }
  }

  /** Verifies every exact allocation immediately before assignment or resume. */
  async assertCurrent(epochId: string): Promise<CouncilIsolationPlan> {
    const plan = await this.requirePlan(epochId);
    if (plan.status !== "prepared") throw new CouncilIsolationError("Council isolation is not in the prepared state.");
    await this.verifyMaterialized(plan, true);
    return plan;
  }

  /**
   * Restart recovery observes only. If all external state exactly matches it
   * records success; otherwise it compensates clean coordinator-owned state.
   * It never creates a missing worktree or resource scope.
   */
  async recover(epochId: string): Promise<CouncilIsolationPlan> {
    const plan = await this.requirePlan(epochId);
    if (plan.status === "cleaned" || plan.status === "manual_cleanup_required") return plan;
    if (plan.status === "prepared") {
      try {
        for (const binding of plan.bindings) {
          if (!binding.resourceHost) throw new CouncilIsolationError("Council recovery found a legacy assignment without a real resource-host binding.");
          await this.resourceHost.recover(resourceRequest(plan, binding), binding.resourceHost);
        }
        await this.verifyMaterialized(plan, true);
        return plan;
      } catch (error) {
        await this.mutate(plan.epochId, (current) => ({
          ...current,
          status: "cleanup_pending",
          failureReason: controlledReason(error, "Council recovery could not prove the prepared external isolation state.")
        }));
        return this.cleanup(plan.epochId);
      }
    }
    for (const binding of plan.bindings) {
      if (!binding.resourceHost) continue;
      await this.resourceHost.recover(resourceRequest(plan, binding), binding.resourceHost).catch(() => undefined);
    }
    const exact = await this.materializedExactly(plan).catch(() => false);
    if (exact) return this.mutate(plan.epochId, (current) => {
      const { failureReason: _failureReason, ...withoutFailure } = current;
      return { ...withoutFailure, status: "prepared" };
    });
    await this.mutate(plan.epochId, (current) => ({ ...current, status: "cleanup_pending", failureReason: "Council recovery found partial external state; compensation was required without replay." }));
    return this.cleanup(plan.epochId);
  }

  /**
   * Reconciles every nonterminal epoch at companion startup. Recovery observes
   * exact host state and compensates only coordinator-owned clean resources; it
   * never repeats a Git worktree creation or provider assignment.
   */
  async recoverPending(): Promise<readonly CouncilIsolationPlan[]> {
    const recovered: CouncilIsolationPlan[] = [];
    for (const plan of await this.list()) {
      if (plan.status === "cleaned" || plan.status === "manual_cleanup_required") continue;
      recovered.push(await this.recover(plan.epochId));
    }
    return recovered;
  }

  /** Removes only exact, clean, unadvanced coordinator-owned worktrees and unused scopes. */
  async cleanup(epochId: string): Promise<CouncilIsolationPlan> {
    let plan = await this.requirePlan(epochId);
    if (plan.status === "cleaned" || plan.status === "manual_cleanup_required") return plan;
    plan = await this.mutate(epochId, (current) => ({ ...current, status: "cleanup_pending" }));
    for (const binding of plan.bindings) {
      if (!binding.resourceHost) continue;
      try { await this.resourceHost.preflightCleanup(resourceRequest(plan, binding), binding.resourceHost); }
      catch {
        return this.mutate(epochId, (current) => ({ ...current, status: "manual_cleanup_required", failureReason: "Council preserved a hosted resource whose exact ownership or fence could not be proven; manual cleanup is required." }));
      }
    }
    const unsafe = await this.cleanupPreflight(plan);
    if (unsafe) {
      // Disposable non-Git resources are independently owned. Revoke/close
      // them even when participant Git work must be preserved for inspection.
      for (const binding of plan.bindings) if (binding.resourceHost) await this.resourceHost.cleanup(resourceRequest(plan, binding), binding.resourceHost).catch(() => undefined);
      return this.mutate(epochId, (current) => ({ ...current, status: "manual_cleanup_required", failureReason: unsafe }));
    }
    try {
      for (const binding of [...plan.bindings].reverse()) {
        if (binding.resourceHost) await this.resourceHost.cleanup(resourceRequest(plan, binding), binding.resourceHost);
        if (await exists(binding.worktreeRoot)) {
          const removed = await this.runGit(["worktree", "remove", binding.worktreeRoot], plan.repositoryRoot);
          if (removed.exitCode !== 0) throw new CouncilIsolationError("Git refused cleanup of an exact clean Council worktree.");
        }
        const ref = `refs/heads/${binding.branch}`;
        const present = await this.runGit(["show-ref", "--verify", "--quiet", ref], plan.repositoryRoot);
        if (present.exitCode === 0) {
          const observed = (await this.gitText(["rev-parse", ref], plan.repositoryRoot, "Council cleanup branch identity")).toLowerCase();
          if (observed !== plan.targetHead) throw new CouncilIsolationError("Council preserved an advanced branch during cleanup.");
          const deleted = await this.runGit(["update-ref", "-d", ref, plan.targetHead], plan.repositoryRoot);
          if (deleted.exitCode !== 0) throw new CouncilIsolationError("Git refused atomic cleanup of an exact Council branch reference.");
        } else if (present.exitCode !== 1) throw new CouncilIsolationError("Council could not prove whether its cleanup branch still exists.");
        // Legacy pre-resource-host plans used marker-only directories. Preserve
        // their exact cleanup path without treating them as real isolation.
        if (!binding.resourceHost) for (const lease of binding.leases) if (lease.localPath && lease.kind !== "worktree" && await exists(lease.localPath)) await rm(lease.localPath, { recursive: true, force: false });
      }
      const releasedAt = this.clock();
      return this.mutate(epochId, (current) => {
        const { failureReason: _failureReason, ...withoutFailure } = current;
        return {
        ...withoutFailure,
        status: "cleaned",
        bindings: current.bindings.map((binding) => withAssignmentDigest({
          ...binding,
          leases: binding.leases.map((lease) => ({ ...lease, status: "released", releasedAt }))
        }, current))
      }; });
    } catch (error) {
      return this.mutate(epochId, (current) => ({ ...current, status: "manual_cleanup_required", failureReason: controlledReason(error, "Council cleanup stopped to preserve external work.") }));
    }
  }

  /**
   * Cancellation/recovery cleanup that cannot be redirected to a different
   * repository by an epoch-id collision or caller substitution. A missing
   * plan means no local isolation effect was durably reserved.
   */
  async cleanupOwned(epochId: string, expectedRepositoryRoot: string): Promise<CouncilIsolationPlan | undefined> {
    const plan = await this.get(epochId);
    if (!plan) return undefined;
    if (!samePath(plan.repositoryRoot, expectedRepositoryRoot)) {
      throw new CouncilIsolationError("Council cleanup refused a changed exact repository binding.");
    }
    return this.cleanup(epochId);
  }

  private async normalizeRequest(input: CouncilIsolationPrepareRequest, control?: CouncilIsolationEffectControl): Promise<CouncilIsolationPrepareRequest & { readonly repositoryRoot: string; readonly stateRoot: string }> {
    const epochId = bounded(input.epochId, "Council epoch ID");
    const targetSnapshotId = bounded(input.targetSnapshotId, "TargetSnapshot ID");
    if (!digestPattern.test(targetSnapshotId)) throw new CouncilIsolationError("Council isolation requires an exact SHA-256 TargetSnapshot ID.");
    const targetHead = input.targetHead.trim().toLowerCase();
    if (!gitDigestPattern.test(targetHead)) throw new CouncilIsolationError("Council isolation requires an exact Git object ID.");
    const defaultBranch = normalizedBranch(input.defaultBranch, "default branch");
    if (!input.assignments.length) throw new CouncilIsolationError("Council isolation requires at least one explicit assignment.");
    const repositoryRoot = await guardedEffect(control, () => canonicalDirectory(input.repositoryRoot, "Council repository"));
    if (!samePath(repositoryRoot, input.repositoryRoot)) throw new CouncilIsolationError("Council repository input is not its exact canonical path.");
    if (inside(repositoryRoot, this.configuredStateRoot) || inside(this.configuredStateRoot, repositoryRoot)) throw new CouncilIsolationError("Council state root must be outside the verified repository.");
    await guardedMutation(control, () => mkdir(this.configuredStateRoot, { recursive: true, mode: 0o700 }));
    const stateRoot = await guardedEffect(control, () => canonicalDirectory(this.configuredStateRoot, "Council state root"));
    if (inside(repositoryRoot, stateRoot) || inside(stateRoot, repositoryRoot)) throw new CouncilIsolationError("Council state root must be outside the verified repository.");
    const gitRoot = await guardedEffect(control, () => this.gitText(["rev-parse", "--show-toplevel"], repositoryRoot, "Git worktree capability"));
    if (!samePath(await guardedEffect(control, () => canonicalDirectory(gitRoot, "Git root")), repositoryRoot)) throw new CouncilIsolationError("Council repository is not the exact canonical Git root.");
    if ((await guardedEffect(control, () => this.gitText(["rev-parse", "HEAD"], repositoryRoot, "Git HEAD"))).toLowerCase() !== targetHead) throw new CouncilIsolationError("Council repository HEAD no longer matches the exact TargetSnapshot.");
    await guardedEffect(control, () => this.gitText(["worktree", "list", "--porcelain"], repositoryRoot, "Git worktree capability"));
    await guardedEffect(control, () => this.assertSafeCheckoutConfiguration(repositoryRoot));
    const defaultRef = await guardedEffect(control, () => this.runGit(["show-ref", "--verify", "--quiet", `refs/heads/${defaultBranch}`], repositoryRoot));
    const remoteDefaultRef = defaultRef.exitCode === 0 ? defaultRef : await guardedEffect(control, () => this.runGit(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${defaultBranch}`], repositoryRoot));
    if (defaultRef.exitCode !== 0 && remoteDefaultRef.exitCode !== 0) throw new CouncilIsolationError("Council cannot prove the host-observed default branch identity.");

    const assignments = input.assignments.map((assignment) => normalizeAssignment(assignment));
    if (new Set(assignments.map((assignment) => assignment.sessionId)).size !== assignments.length) throw new CouncilIsolationError("Council isolation session IDs must be unique.");
    const declarations = assignments.flatMap((assignment) => assignment.resources.map((resource) => `${resourceKind(resource)}:${resource.toLowerCase()}`));
    if (new Set(declarations).size !== declarations.length) throw new CouncilIsolationError("Council resource declarations collide across assignments.");
    return { epochId, targetSnapshotId, repositoryRoot, targetHead, defaultBranch, assignments, stateRoot };
  }

  private desiredPlan(input: CouncilIsolationPrepareRequest & { readonly repositoryRoot: string; readonly stateRoot: string }): CouncilIsolationPlan {
    const now = this.clock();
    const epochKey = sha256(input.epochId).slice(0, 20);
    const bindings = input.assignments.map((assignment) => {
      const sessionKey = sha256(assignment.sessionId).slice(0, 20);
      const worktreeRoot = resolve(input.stateRoot, "council-worktrees", epochKey, sessionKey);
      const branch = `sxsy-b122/council/${epochKey.slice(0, 12)}/${sessionKey.slice(0, 12)}`;
      if (branch.toLowerCase() === input.defaultBranch.toLowerCase()) throw new CouncilIsolationError("Council worktrees must use non-default branches.");
      const baseLeases: Omit<CouncilResourceLease, "fence">[] = [
        leaseBase(input.epochId, assignment.sessionId, "branch", `branch:${branch}`, undefined, undefined, now),
        leaseBase(input.epochId, assignment.sessionId, "worktree", `worktree:${worktreeRoot}`, undefined, worktreeRoot, now)
      ];
      for (const declaration of assignment.resources) {
        const kind = resourceKind(declaration);
        const value = declaration.slice(declaration.indexOf(":") + 1);
        if (kind === "port") baseLeases.push(leaseBase(input.epochId, assignment.sessionId, kind, `port:${value}`, declaration, undefined, now));
        else if (kind === "credential_scope") baseLeases.push(leaseBase(input.epochId, assignment.sessionId, kind, `credential-scope:${epochKey}:${sessionKey}:${sha256(declaration).slice(0, 20)}`, declaration, undefined, now));
        else {
          const localPath = resolve(input.stateRoot, "council-scopes", epochKey, sessionKey, kind, sha256(declaration).slice(0, 20));
          baseLeases.push(leaseBase(input.epochId, assignment.sessionId, kind, `${kind}:${localPath}`, declaration, localPath, now));
        }
      }
      return withAssignmentDigest({ sessionId: assignment.sessionId, paths: assignment.paths, declarations: assignment.resources, worktreeRoot, branch, head: input.targetHead, leases: baseLeases.map((lease) => ({ ...lease, fence: 0 })), assignmentDigest: "" }, input);
    }).sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    return withPlanDigest({ epochId: input.epochId, targetSnapshotId: input.targetSnapshotId, repositoryRoot: input.repositoryRoot, targetHead: input.targetHead, defaultBranch: input.defaultBranch, stateRoot: input.stateRoot, bindings, status: "reserved", executionAuthorized: false, createdAt: now, updatedAt: now, digest: "" });
  }

  private async assertPortsAvailable(plan: CouncilIsolationPlan): Promise<void> {
    for (const lease of plan.bindings.flatMap((binding) => binding.leases).filter((candidate) => candidate.kind === "port")) {
      const port = Number(lease.resource.slice("port:".length));
      if (!await this.ports.available(port)) throw new CouncilIsolationError(`Council could not prove that loopback port ${port} is available for its exact lease.`);
    }
  }

  private async assertBranchAndPathUnused(plan: CouncilIsolationPlan, binding: CouncilWorkspaceBinding): Promise<void> {
    const checked = await this.runGit(["check-ref-format", "--branch", binding.branch], plan.repositoryRoot);
    if (checked.exitCode !== 0) throw new CouncilIsolationError("Council generated branch is not a valid exact Git branch name.");
    const branch = await this.runGit(["show-ref", "--verify", "--quiet", `refs/heads/${binding.branch}`], plan.repositoryRoot);
    if (branch.exitCode === 0) throw new CouncilIsolationError("Council branch lease collides with an existing local branch.");
    if (branch.exitCode !== 1) throw new CouncilIsolationError("Council could not prove that its reserved branch is unused.");
    if (await exists(binding.worktreeRoot)) throw new CouncilIsolationError("Council worktree lease collides with an existing path.");
  }

  private async verifyMaterialized(plan: CouncilIsolationPlan, requireClean: boolean): Promise<void> {
    for (const binding of plan.bindings) {
      await this.verifyWorktree(plan, binding, requireClean);
      if (!binding.resourceHost) throw new CouncilIsolationError("Council assignment has no exact durable resource-host binding.");
      await this.resourceHost.assertCurrent(resourceRequest(plan, binding), binding.resourceHost);
    }
  }

  private async materializedExactly(plan: CouncilIsolationPlan): Promise<boolean> {
    try { await this.verifyMaterialized(plan, true); return true; } catch { return false; }
  }

  private async verifyWorktree(plan: CouncilIsolationPlan, binding: CouncilWorkspaceBinding, requireClean: boolean): Promise<void> {
    const canonical = await canonicalDirectory(binding.worktreeRoot, "Council worktree");
    if (!samePath(canonical, binding.worktreeRoot) || !inside(plan.stateRoot, canonical)) throw new CouncilIsolationError("Council worktree is no longer an exact host-owned path.");
    const root = await this.gitText(["rev-parse", "--show-toplevel"], canonical, "Council worktree root");
    if (!samePath(await canonicalDirectory(root, "Council Git root"), canonical)) throw new CouncilIsolationError("Council worktree Git root does not match its durable binding.");
    const branch = await this.gitText(["branch", "--show-current"], canonical, "Council worktree branch");
    if (branch !== binding.branch || branch.toLowerCase() === plan.defaultBranch.toLowerCase()) throw new CouncilIsolationError("Council worktree is not on its exact non-default branch.");
    const head = (await this.gitText(["rev-parse", "HEAD"], canonical, "Council worktree HEAD")).toLowerCase();
    if (head !== binding.head) throw new CouncilIsolationError("Council worktree HEAD advanced or changed from its exact assignment base.");
    if (requireClean && (await this.gitText(["status", "--porcelain=v1", "--untracked-files=all"], canonical, "Council worktree status")) !== "") throw new CouncilIsolationError("Council worktree became dirty before the coordination epoch activated.");
  }

  private async cleanupPreflight(plan: CouncilIsolationPlan): Promise<string | undefined> {
    for (const binding of plan.bindings) {
      if (await exists(binding.worktreeRoot)) {
        try { await this.verifyWorktree(plan, binding, true); }
        catch { return `Council preserved dirty, advanced, or mismatched worktree state for ${binding.sessionId}; manual cleanup is required.`; }
      }
      const ref = `refs/heads/${binding.branch}`;
      const present = await this.runGit(["show-ref", "--verify", "--quiet", ref], plan.repositoryRoot);
      if (present.exitCode === 0) {
        try {
          if ((await this.gitText(["rev-parse", ref], plan.repositoryRoot, "Council cleanup branch identity")).toLowerCase() !== plan.targetHead) return `Council preserved advanced branch state for ${binding.sessionId}; manual cleanup is required.`;
        } catch { return `Council could not prove the cleanup branch identity for ${binding.sessionId}; manual cleanup is required.`; }
      } else if (present.exitCode !== 1) return `Council could not prove whether the cleanup branch exists for ${binding.sessionId}; manual cleanup is required.`;
      if (!binding.resourceHost) {
        for (const lease of binding.leases) {
          if (!lease.localPath || lease.kind === "worktree" || !await exists(lease.localPath)) continue;
          try {
            const canonical = await canonicalDirectory(lease.localPath, `Council ${lease.kind} cleanup scope`);
            if (!samePath(canonical, lease.localPath) || !inside(plan.stateRoot, canonical)) return "Council preserved a resource scope whose canonical path changed; manual cleanup is required.";
            const entries = await readdir(canonical);
            if (entries.length !== 1 || entries[0] !== markerName) return "Council preserved a legacy resource scope containing participant data; manual cleanup is required.";
            const marker = await readMarker(canonical);
            if (marker.epochId !== plan.epochId || marker.sessionId !== binding.sessionId || marker.leaseId !== lease.id || marker.assignmentDigest !== binding.assignmentDigest) return "Council preserved a resource scope with a mismatched ownership marker; manual cleanup is required.";
          } catch { return "Council could not prove ownership of a resource scope; manual cleanup is required."; }
        }
      }
    }
    return undefined;
  }

  private async requirePlan(epochId: string): Promise<CouncilIsolationPlan> {
    const plan = await this.get(epochId);
    if (!plan) throw new CouncilIsolationError(`Unknown Council isolation epoch: ${bounded(epochId, "Council epoch ID")}`);
    return plan;
  }

  private async mutate(epochId: string, mutation: (plan: CouncilIsolationPlan) => Omit<CouncilIsolationPlan, "digest" | "updatedAt"> | CouncilIsolationPlan): Promise<CouncilIsolationPlan> {
    return this.store.transaction(async (transaction) => {
      const current = planMap(await transaction.readEntries()).get(bounded(epochId, "Council epoch ID"));
      if (!current) throw new CouncilIsolationError(`Unknown Council isolation epoch: ${epochId}`);
      const changed = mutation(clonePlan(current));
      const saved = withPlanDigest({ ...changed, updatedAt: this.clock(), digest: "" });
      await transaction.append<CouncilIsolationSavedEvent>(savedKind, { plan: saved });
      return clonePlan(saved);
    });
  }

  private async gitText(args: readonly string[], cwd: string, capability: string): Promise<string> {
    const result = await this.runGit(args, cwd);
    if (result.exitCode !== 0) throw new CouncilIsolationError(`${capability} could not be proven by the installed fixed-argv Git host.`);
    return result.stdout.trim();
  }

  private runGit(args: readonly string[], cwd: string): ReturnType<LocalGitRunner["run"]> {
    return this.git.run(["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", ...args], { cwd });
  }

  private async assertSafeCheckoutConfiguration(repositoryRoot: string): Promise<void> {
    for (const pattern of ["^filter\\.", "^core\\.sparse[Cc]heckout"]) {
      const configured = await this.runGit(["config", "--local", "--name-only", "--get-regexp", pattern], repositoryRoot);
      if (configured.exitCode === 0) throw new CouncilIsolationError("Council cannot safely materialize a worktree while repository-local checkout filters or sparse-checkout settings are configured.");
      if (configured.exitCode !== 1) throw new CouncilIsolationError("Council could not prove that repository-local checkout configuration is safe.");
    }
  }
}

function planMap(entries: readonly JournalEntry<unknown>[]): Map<string, CouncilIsolationPlan> {
  const plans = new Map<string, CouncilIsolationPlan>();
  for (const entry of entries) {
    if (entry.kind !== savedKind) continue;
    const plan = (entry.payload as CouncilIsolationSavedEvent | undefined)?.plan;
    if (!plan || typeof plan.epochId !== "string" || plan.executionAuthorized !== false || !digestPattern.test(plan.digest) || isolationPlanDigest(plan) !== plan.digest) throw new CouncilIsolationError("Protected Council isolation record is malformed or has an invalid digest.");
    plans.set(plan.epochId, clonePlan(plan));
  }
  return plans;
}

export function isolationPlanDigest(plan: Omit<CouncilIsolationPlan, "digest"> | CouncilIsolationPlan): string {
  const { digest: _digest, ...unsigned } = plan as CouncilIsolationPlan;
  return sha256(stableJson(unsigned));
}

function withPlanDigest<T extends Omit<CouncilIsolationPlan, "digest"> & { readonly digest?: string }>(plan: T): CouncilIsolationPlan {
  const { digest: _digest, ...unsigned } = plan;
  return { ...unsigned, digest: isolationPlanDigest(unsigned as Omit<CouncilIsolationPlan, "digest">) } as CouncilIsolationPlan;
}

function assignmentDigest(binding: Omit<CouncilWorkspaceBinding, "assignmentDigest"> | CouncilWorkspaceBinding, plan: Pick<CouncilIsolationPlan, "epochId" | "targetSnapshotId" | "repositoryRoot"> | Pick<CouncilIsolationPrepareRequest, "epochId" | "targetSnapshotId" | "repositoryRoot">): string {
  const { assignmentDigest: _digest, ...unsigned } = binding as CouncilWorkspaceBinding;
  return sha256(stableJson({ epochId: plan.epochId, targetSnapshotId: plan.targetSnapshotId, repositoryRoot: plan.repositoryRoot, ...unsigned }));
}

function withAssignmentDigest(binding: CouncilWorkspaceBinding, plan: Pick<CouncilIsolationPlan, "epochId" | "targetSnapshotId" | "repositoryRoot"> | Pick<CouncilIsolationPrepareRequest, "epochId" | "targetSnapshotId" | "repositoryRoot">): CouncilWorkspaceBinding {
  return { ...binding, assignmentDigest: assignmentDigest(binding, plan) };
}

function resourceRequest(plan: CouncilIsolationPlan, binding: CouncilWorkspaceBinding): CouncilResourceHostRequest {
  return {
    epochId: plan.epochId,
    targetSnapshotId: plan.targetSnapshotId,
    repositoryRoot: plan.repositoryRoot,
    stateRoot: plan.stateRoot,
    sessionId: binding.sessionId,
    worktreeRoot: binding.worktreeRoot,
    branch: binding.branch,
    head: binding.head,
    leases: binding.leases.map((lease) => ({
      id: lease.id,
      kind: lease.kind,
      ...(lease.declaration ? { declaration: lease.declaration } : {}),
      ...(lease.localPath ? { localPath: lease.localPath } : {}),
      fence: lease.fence,
      status: lease.status
    }))
  };
}

function clonePlan(plan: CouncilIsolationPlan): CouncilIsolationPlan { return jsonClone(plan); }

function sameIntent(left: CouncilIsolationPlan, right: CouncilIsolationPlan): boolean {
  return stableJson({ targetSnapshotId: left.targetSnapshotId, repositoryRoot: left.repositoryRoot, targetHead: left.targetHead, defaultBranch: left.defaultBranch, stateRoot: left.stateRoot, bindings: left.bindings.map(intentBinding) })
    === stableJson({ targetSnapshotId: right.targetSnapshotId, repositoryRoot: right.repositoryRoot, targetHead: right.targetHead, defaultBranch: right.defaultBranch, stateRoot: right.stateRoot, bindings: right.bindings.map(intentBinding) });
}

function intentBinding(binding: CouncilWorkspaceBinding): unknown { return { sessionId: binding.sessionId, paths: binding.paths, declarations: binding.declarations, worktreeRoot: binding.worktreeRoot, branch: binding.branch, head: binding.head }; }

function leaseBase(epochId: string, sessionId: string, kind: CouncilResourceLeaseKind, resource: string, declaration: string | undefined, localPath: string | undefined, acquiredAt: string): Omit<CouncilResourceLease, "fence"> {
  return { id: sha256(stableJson({ epochId, sessionId, kind, resource })).slice(0, 32), epochId, sessionId, kind, resource, ...(declaration ? { declaration } : {}), ...(localPath ? { localPath } : {}), acquiredAt, status: "active" };
}

function leaseKey(lease: Pick<CouncilResourceLease, "kind" | "resource" | "localPath">): string {
  if (lease.kind === "port" || lease.kind === "credential_scope" || lease.kind === "branch") return `${lease.kind}:${lease.resource.toLowerCase()}`;
  const path = lease.localPath ?? lease.resource.slice(lease.resource.indexOf(":") + 1);
  return `${lease.kind}:${resolve(path).toLowerCase()}`;
}

function normalizeAssignment(input: CouncilIsolationAssignmentRequest): CouncilIsolationAssignmentRequest {
  const sessionId = bounded(input.sessionId, "Council session ID");
  const paths = [...new Set(input.paths.map((path) => {
    const canonical = canonicalRepositoryPath(path);
    if (!canonical) throw new CouncilIsolationError("Council assignment contains a path outside the canonical repository namespace.");
    return canonical;
  }))].sort();
  if (!paths.length) throw new CouncilIsolationError("Council assignment requires at least one exact task-owned path.");
  const resources = [...new Set(input.resources.map(normalizedResource))].sort();
  return { sessionId, paths, resources };
}

function normalizedResource(value: string): string {
  const normalized = bounded(value, "Council resource declaration");
  const kind = resourceKind(normalized);
  const payload = normalized.slice(normalized.indexOf(":") + 1).trim();
  if (!payload || /[\r\n\0]/.test(payload) || payload.length > 128) throw new CouncilIsolationError("Council resource declaration has an invalid scope value.");
  if (kind === "port") {
    const port = Number(payload);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || String(port) !== payload) throw new CouncilIsolationError("Council port declaration must be an exact unprivileged TCP port.");
  } else if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(payload) || payload.includes("..")) throw new CouncilIsolationError("Council resource scope contains unsafe characters or traversal.");
  return `${kind === "credential_scope" ? "credential-scope" : kind}:${payload}`;
}

function resourceKind(value: string): Exclude<CouncilResourceLeaseKind, "branch" | "worktree"> {
  const prefix = value.slice(0, value.indexOf(":"));
  if (prefix === "port" || prefix === "cache" || prefix === "temp" || prefix === "database") return prefix;
  if (prefix === "credential" || prefix === "credential-scope") return "credential_scope";
  throw new CouncilIsolationError("Council resource kind is unsupported; only port, cache, temp, database, and credential-scope leases are accepted.");
}

function normalizedBranch(value: string, field: string): string {
  const branch = bounded(value, field).replace(/^refs\/heads\//, "");
  if (!branch || branch.startsWith("-") || branch.endsWith("/") || branch.includes("..") || branch.includes("@{") || /[\s~^:?*\\\[]/.test(branch)) throw new CouncilIsolationError(`Council ${field} is not an exact safe Git branch name.`);
  return branch;
}

function bounded(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\r\n\0]/.test(normalized)) throw new CouncilIsolationError(`${field} must be a bounded non-empty value.`);
  return normalized;
}

function samePath(left: string, right: string): boolean { return resolve(left).replace(/[\\/]+$/, "").toLowerCase() === resolve(right).replace(/[\\/]+$/, "").toLowerCase(); }

async function assertEffectCurrent(control?: CouncilIsolationEffectControl): Promise<void> {
  if (!control) return;
  if (control.signal.aborted) throw new CouncilIsolationError("Council isolation was cancelled before its external effect boundary.");
  await control.assertCurrent();
  if (control.signal.aborted) throw new CouncilIsolationError("Council isolation was cancelled at its external effect boundary.");
}

async function guardedEffect<T>(control: CouncilIsolationEffectControl | undefined, effect: () => Promise<T>): Promise<T> {
  await assertEffectCurrent(control);
  const result = await effect();
  await assertEffectCurrent(control);
  return result;
}

async function guardedMutation<T>(control: CouncilIsolationEffectControl | undefined, effect: () => Promise<T>): Promise<T> {
  await assertEffectCurrent(control);
  control?.markExternalEffect?.();
  const result = await effect();
  await assertEffectCurrent(control);
  return result;
}
function inside(parent: string, candidate: string): boolean { const rel = relative(resolve(parent), resolve(candidate)); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); }

async function canonicalDirectory(path: string, field: string): Promise<string> {
  const canonical = await realpath(resolve(path)).catch(() => { throw new CouncilIsolationError(`${field} is unavailable or cannot be canonicalized.`); });
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new CouncilIsolationError(`${field} is not a directory.`);
  return canonical;
}

async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (error) { return isNodeError(error, "ENOENT") ? false : Promise.reject(error); } }
function isNodeError(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code; }

async function readMarker(directory: string): Promise<Readonly<{ epochId: string; sessionId: string; leaseId: string; assignmentDigest: string }>> {
  const value: unknown = JSON.parse(await readFile(join(directory, markerName), "utf8"));
  if (!record(value) || value.schema !== "sxsy-b122.council-scope" || value.version !== 1 || typeof value.epochId !== "string" || typeof value.sessionId !== "string" || typeof value.leaseId !== "string" || typeof value.assignmentDigest !== "string" || Object.keys(value).length !== 6) throw new CouncilIsolationError("Council resource scope marker is malformed.");
  return { epochId: value.epochId, sessionId: value.sessionId, leaseId: value.leaseId, assignmentDigest: value.assignmentDigest };
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function controlledReason(error: unknown, fallback: string): string { return error instanceof CouncilIsolationError || error instanceof CouncilResourceHostError ? error.message.slice(0, 512) : fallback; }
