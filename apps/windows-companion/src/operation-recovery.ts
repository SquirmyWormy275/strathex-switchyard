import type { OperationRecord } from "../../../packages/control-plane/src/contracts.ts";
import type { OperationReconciler, ReconciliationDecision } from "../../../packages/control-plane/src/operations.ts";
import { hostActionCommandActions } from "./host-actions.ts";
import type { CheckpointGitRunner } from "./local-checkpoints.ts";
import type { DynamicConfiguredNetworkClient } from "./remote-adapters.ts";
import { configuredGitHostFromPolicy, configuredGitRemoteMatchesPolicy, parseAdvertisement } from "./remote-git.ts";
import type { ConfiguredNetworkPolicy } from "./configured-network.ts";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

export type InstalledObservationOutcome = "committed" | "not_started" | "failed" | "cancelled" | "unresolved";
export interface InstalledOperationObservation {
  readonly outcome: InstalledObservationOutcome;
  readonly note: string;
  readonly details?: Readonly<Record<string, string>>;
}

export interface InstalledOperationObservationPort {
  localGit(input: Readonly<{ repositoryRoot: string; beforeHead: string; expectedTree: string }>): Promise<InstalledOperationObservation>;
  remoteRef(input: Readonly<{ repositoryRoot: string; remote: string; ref: string; expectedHead: string }>): Promise<InstalledOperationObservation>;
  pullRequest(input: Readonly<{ repositoryRoot: string; owner: string; name: string; headOwner: string; headName: string; number?: number; headBranch?: string; baseBranch: string; expectedHead: string; expectedState: "OPEN" | "MERGED" }>): Promise<InstalledOperationObservation>;
  provider(input: Readonly<{ repositoryRoot: string; routeId: string; externalId: string; targetSnapshotId: string }>): Promise<InstalledOperationObservation>;
  council(input: Readonly<{ epochId: string; phase: "pause" | "assignment" | "resume"; sessionId: string; targetSnapshotId: string }>): Promise<InstalledOperationObservation>;
  hostAction(input: Readonly<{ operationId: string; action: string }>): Promise<InstalledOperationObservation>;
}

const hostActions = new Set<string>(hostActionCommandActions);

/**
 * Routes only read-only observations for the already durable operation. It
 * never calls a mutation broker, creates a new operation, or guesses from a
 * user-visible status.
 */
export class HostOwnedOperationReconciler implements OperationReconciler {
  constructor(private readonly observations: InstalledOperationObservationPort) {}

  async reconcile(operation: OperationRecord): Promise<ReconciliationDecision> {
    const observed = await this.observe(operation);
    if (!observed) return { note: recognized(operation.action)
      ? "The protected operation lacks an exact observation binding; it remains ambiguous and was not replayed."
      : "No read-only observation adapter is registered for this operation; it remains ambiguous and was not replayed." };
    return decision(observed);
  }

  private async observe(operation: OperationRecord): Promise<InstalledOperationObservation | undefined> {
    const details = operation.details;
    if (operation.action === "git.local-commit") {
      const repositoryRoot = detail(details, "repositoryRoot"); const beforeHead = oid(details.beforeHead); const expectedTree = oid(details.expectedTree);
      return repositoryRoot && beforeHead && expectedTree ? this.observations.localGit({ repositoryRoot, beforeHead, expectedTree }) : undefined;
    }
    if (operation.action === "git.push-reviewed-head" || operation.action === "git.direct-main") {
      const repositoryRoot = detail(details, "repositoryRoot"); const remote = detail(details, "remote"); const ref = gitRef(details.ref); const expectedHead = oid(details.expectedHead);
      return repositoryRoot && remote && ref && expectedHead ? this.observations.remoteRef({ repositoryRoot, remote, ref, expectedHead }) : undefined;
    }
    if (operation.action === "github.pr-upsert") {
      const repositoryRoot = detail(details, "repositoryRoot"); const owner = slug(details.owner); const name = slug(details.name); const headOwner = slug(details.headOwner); const headName = slug(details.headName); const headBranch = branch(details.headBranch); const baseBranch = branch(details.baseBranch);
      const expectedHead = oid(details.expectedHead); const expectedState = prState(details.expectedState);
      return repositoryRoot && owner && name && headOwner && headName && headBranch && baseBranch && expectedHead && expectedState
        ? this.observations.pullRequest({ repositoryRoot, owner, name, headOwner, headName, headBranch, baseBranch, expectedHead, expectedState }) : undefined;
    }
    if (operation.action === "github.pr-merge") {
      const repositoryRoot = detail(details, "repositoryRoot"); const owner = slug(details.owner); const name = slug(details.name); const headOwner = slug(details.headOwner); const headName = slug(details.headName); const pullRequest = positiveInteger(details.pullRequest); const baseBranch = branch(details.baseBranch);
      const expectedHead = oid(details.expectedHead); const expectedState = prState(details.expectedState);
      return repositoryRoot && owner && name && headOwner && headName && pullRequest && baseBranch && expectedHead && expectedState
        ? this.observations.pullRequest({ repositoryRoot, owner, name, headOwner, headName, number: pullRequest, baseBranch, expectedHead, expectedState }) : undefined;
    }
    if (operation.action.startsWith("provider.")) {
      const repositoryRoot = detail(details, "repositoryRoot"); const routeId = detail(details, "routeId"); const externalId = detail(details, "externalId"); const targetSnapshotId = detail(details, "targetSnapshotId");
      return repositoryRoot && routeId && externalId && targetSnapshotId ? this.observations.provider({ repositoryRoot, routeId, externalId, targetSnapshotId }) : undefined;
    }
    if (operation.action === "council.pause" || operation.action === "council.assignment" || operation.action === "council.resume") {
      const epochId = detail(details, "epochId"); const phase = councilPhase(details.phase); const sessionId = detail(details, "sessionId"); const targetSnapshotId = detail(details, "target");
      return epochId && phase && sessionId && targetSnapshotId ? this.observations.council({ epochId, phase, sessionId, targetSnapshotId }) : undefined;
    }
    if (hostActions.has(operation.action) && !operation.parentId) return this.observations.hostAction({ operationId: operation.id, action: operation.action });
    return undefined;
  }
}

export interface InstalledReadOnlyObservationOptions {
  readonly git: CheckpointGitRunner;
  readonly network?: Pick<DynamicConfiguredNetworkClient, "request">;
  readonly networkPolicy?: Readonly<{ resolve(): Promise<ConfiguredNetworkPolicy> }>;
  readonly council?: Readonly<{ get(id: string): Promise<Readonly<{ status: string; targetSnapshotId: string; pauseAcknowledgedSessionIds: readonly string[]; assignmentAcknowledgedSessionIds: readonly string[] }> | undefined> }>;
  readonly hostActions?: Readonly<{ observeOperation(operationId: string, action?: string): Promise<Readonly<{ outcome: "committed" | "failed" | "cancelled" | "unresolved"; note: string }>> }>;
  readonly canonicalRepositoryRoot?: (repositoryRoot: string) => Promise<string>;
}

/** Concrete installed read-only probes. No method invokes a mutation route. */
export class InstalledReadOnlyObservationPort implements InstalledOperationObservationPort {
  constructor(private readonly options: InstalledReadOnlyObservationOptions) {}

  async localGit(input: Readonly<{ repositoryRoot: string; beforeHead: string; expectedTree: string }>): Promise<InstalledOperationObservation> {
    try {
      const repositoryRoot = await this.exactRepositoryRoot(input.repositoryRoot);
      if (!repositoryRoot) return unresolved("The protected local Git repository root no longer resolves to its exact canonical path.");
      const [head, parents, tree] = await Promise.all([
        this.options.git.run(["rev-parse", "--verify", "HEAD"], repositoryRoot, 256),
        this.options.git.run(["show", "-s", "--format=%P", "HEAD"], repositoryRoot, 512),
        this.options.git.run(["show", "-s", "--format=%T", "HEAD"], repositoryRoot, 256)
      ]);
      if ([head, parents, tree].some((result) => result.exitCode !== 0)) return unresolved("Fixed Git could not read the exact local commit state.");
      const observedHead = ascii(head.stdout); const observedParents = ascii(parents.stdout).split(/\s+/).filter(Boolean); const observedTree = ascii(tree.stdout);
      if (observedHead === input.beforeHead) return { outcome: "not_started", note: "The local HEAD still equals the exact pre-effect head." };
      if (oid(observedHead) && observedParents.length === 1 && observedParents[0] === input.beforeHead && observedTree === input.expectedTree) return { outcome: "committed", note: "Read-only Git observation verified one exact child commit and reviewed tree.", details: { observedHead, observedTree } };
      return unresolved("Local HEAD/tree/parent no longer proves the exact reviewed commit.");
    } catch { return unresolved("Fixed Git local observation was unavailable."); }
  }

  async remoteRef(input: Readonly<{ repositoryRoot: string; remote: string; ref: string; expectedHead: string }>): Promise<InstalledOperationObservation> {
    if (!this.options.network) return unresolved("No configured read-only remote-ref route is installed.");
    try {
      const repositoryRoot = await this.exactRepositoryRoot(input.repositoryRoot);
      if (!repositoryRoot) return unresolved("The protected remote-ref repository root no longer resolves to its exact canonical path.");
      if (this.options.networkPolicy && !configuredGitRemoteMatchesPolicy(input.remote, await this.options.networkPolicy.resolve())) {
        return unresolved("The installed Git observation route is not bound to the protected canonical remote.");
      }
      const response = await this.options.network.request({ routeId: "git.receive-pack.advertise", repositoryRoot });
      if (response.outcome !== "passed" || !response.body) return unresolved("The configured remote-ref observation was unavailable.");
      const observed = parseAdvertisement(response.body).refs.get(input.ref);
      if (observed === input.expectedHead) return { outcome: "committed", note: "The exact configured remote ref points to the reviewed head.", details: { observedHead: observed } };
      return observed === undefined ? { outcome: "not_started", note: "The exact configured remote ref is absent." } : unresolved("The remote ref points to another head; no mutation was replayed.");
    } catch { return unresolved("The configured remote-ref observation failed safely."); }
  }

  async pullRequest(input: Readonly<{ repositoryRoot: string; owner: string; name: string; headOwner: string; headName: string; number?: number; headBranch?: string; baseBranch: string; expectedHead: string; expectedState: "OPEN" | "MERGED" }>): Promise<InstalledOperationObservation> {
    if (!this.options.network) return unresolved("No configured read-only pull-request route is installed.");
    const query = input.number === undefined
      ? "query B122RecoveryPull($owner:String!,$name:String!,$head:String!,$base:String!){repository(owner:$owner,name:$name){pullRequests(first:20,headRefName:$head,baseRefName:$base){nodes{number headRefOid headRepository{nameWithOwner} baseRefName state}}}}"
      : "query B122RecoveryPullNumber($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number headRefOid headRepository{nameWithOwner} baseRefName state}}}";
    try {
      const repositoryRoot = await this.exactRepositoryRoot(input.repositoryRoot);
      if (!repositoryRoot) return unresolved("The protected pull-request repository root no longer resolves to its exact canonical path.");
      if (this.options.networkPolicy) {
        const identity = configuredGitHostFromPolicy(await this.options.networkPolicy.resolve());
        if (identity.owner.toLowerCase() !== input.owner.toLowerCase() || identity.name.toLowerCase() !== input.name.toLowerCase()) {
          return unresolved("The installed GraphQL observation route is not bound to the protected repository identity.");
        }
      }
      const response = await this.options.network.request({ routeId: "github.graphql", repositoryRoot, body: JSON.stringify({ query, variables: { owner: input.owner, name: input.name, ...(input.number ? { number: input.number } : { head: input.headBranch, base: input.baseBranch }) } }) });
      if (response.outcome !== "passed" || !response.body) return unresolved("The configured pull-request observation was unavailable.");
      const parsed = JSON.parse(Buffer.from(response.body).toString("utf8")) as unknown;
      const candidates = pullRecords(parsed, input.number === undefined).filter((pull) => pull.headRepository.toLowerCase() === `${input.headOwner}/${input.headName}`.toLowerCase());
      if (candidates.length !== 1) return candidates.length === 0 ? { outcome: "not_started", note: "No exact pull request identity was observed." } : unresolved("Multiple pull requests matched the exact identity; no state was inferred.");
      const pull = candidates[0]!;
      return pull.head === input.expectedHead && pull.base === input.baseBranch && pull.state === input.expectedState
        ? { outcome: "committed", note: "Read-only GraphQL observation verified the exact pull request identity and state.", details: { pullRequest: String(pull.number), state: pull.state } }
        : unresolved("The pull request identity or state differs from the protected operation binding.");
    } catch { return unresolved("The configured pull-request observation failed safely."); }
  }

  async provider(input: Readonly<{ repositoryRoot: string; routeId: string; externalId: string; targetSnapshotId: string }>): Promise<InstalledOperationObservation> {
    if (!this.options.network) return unresolved("No configured provider observation route is installed.");
    try {
      const repositoryRoot = await this.exactRepositoryRoot(input.repositoryRoot);
      if (!repositoryRoot) return unresolved("The protected provider repository root no longer resolves to its exact canonical path.");
      const response = await this.options.network.request({ routeId: `${input.routeId}.observe`, repositoryRoot, body: JSON.stringify({ schema: "sxsy-b122.operation-observation-request", version: 1, externalId: input.externalId, targetSnapshotId: input.targetSnapshotId }) });
      if (response.outcome !== "passed" || !response.body) return unresolved("The configured provider observation was unavailable.");
      const value = JSON.parse(Buffer.from(response.body).toString("utf8")) as unknown;
      if (!plain(value) || value.schema !== "sxsy-b122.operation-observation" || value.version !== 1 || value.externalId !== input.externalId || value.targetSnapshotId !== input.targetSnapshotId || !["committed", "failed", "cancelled", "unresolved"].includes(String(value.outcome))) return unresolved("The provider observation envelope did not bind the exact external operation.");
      return { outcome: value.outcome as InstalledObservationOutcome, note: "The configured provider returned an exact read-only operation observation." };
    } catch { return unresolved("The configured provider observation failed safely."); }
  }

  async council(input: Readonly<{ epochId: string; phase: "pause" | "assignment" | "resume"; sessionId: string; targetSnapshotId: string }>): Promise<InstalledOperationObservation> {
    const epoch = await this.options.council?.get(input.epochId).catch(() => undefined);
    if (!epoch || epoch.targetSnapshotId !== input.targetSnapshotId) return unresolved("The exact Council epoch was unavailable.");
    const committed = input.phase === "pause" ? epoch.pauseAcknowledgedSessionIds.includes(input.sessionId)
      : input.phase === "assignment" ? epoch.assignmentAcknowledgedSessionIds.includes(input.sessionId)
      : epoch.status === "active" || epoch.status === "completed";
    if (committed) return { outcome: "committed", note: "The durable Council ledger verifies the exact phase acknowledgement." };
    return epoch.status === "aborted" ? { outcome: "failed", note: "The durable Council epoch was aborted." } : unresolved("The Council phase remains unacknowledged and was not replayed.");
  }

  async hostAction(input: Readonly<{ operationId: string; action: string }>): Promise<InstalledOperationObservation> {
    return this.options.hostActions?.observeOperation(input.operationId, input.action) ?? unresolved("No durable host-action observer is installed.");
  }

  private async exactRepositoryRoot(repositoryRoot: string): Promise<string | undefined> {
    const observed = await (this.options.canonicalRepositoryRoot ?? realpath)(resolve(repositoryRoot));
    return pathKey(observed) === pathKey(repositoryRoot) ? observed : undefined;
  }
}

function decision(observed: InstalledOperationObservation): ReconciliationDecision {
  const details = { ...safeDetails(observed.details), reconciliation: "read-only-observation" };
  switch (observed.outcome) {
    case "committed": return { state: "recorded", note: boundedNote(observed.note), details };
    case "not_started":
    case "failed": return { state: "failed", note: boundedNote(observed.note), details };
    case "cancelled": return { state: "cancelled", note: boundedNote(observed.note), details };
    case "unresolved": return { note: boundedNote(observed.note), details };
  }
}

function recognized(action: string): boolean {
  return action === "git.local-commit" || action === "git.push-reviewed-head" || action === "git.direct-main"
    || action === "github.pr-upsert" || action === "github.pr-merge" || action.startsWith("provider.")
    || action === "council.pause" || action === "council.assignment" || action === "council.resume" || hostActions.has(action);
}
function detail(details: Readonly<Record<string, string>>, name: string): string | undefined { const value = details[name]; return value && value.length <= 2_048 && !/[\0\r\n]/.test(value) ? value : undefined; }
function oid(value: string | undefined): string | undefined { return value && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : undefined; }
function gitRef(value: string | undefined): string | undefined { return value && /^refs\/heads\/[A-Za-z0-9._\/-]{1,240}$/.test(value) && !value.includes("..") ? value : undefined; }
function branch(value: string | undefined): string | undefined { return value && /^[A-Za-z0-9._\/-]{1,240}$/.test(value) && !value.includes("..") ? value : undefined; }
function slug(value: string | undefined): string | undefined { return value && /^[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : undefined; }
function positiveInteger(value: string | undefined): number | undefined { const number = value && /^\d{1,10}$/.test(value) ? Number(value) : NaN; return Number.isSafeInteger(number) && number > 0 ? number : undefined; }
function prState(value: string | undefined): "OPEN" | "MERGED" | undefined { return value === "OPEN" || value === "MERGED" ? value : undefined; }
function councilPhase(value: string | undefined): "pause" | "assignment" | "resume" | undefined { return value === "pause" || value === "assignment" || value === "resume" ? value : undefined; }
function boundedNote(value: string): string { const note = value.replace(/[\0\r\n]/g, " ").trim().slice(0, 512); return note || "Read-only observation returned no detail; operation remains fail-closed."; }
function safeDetails(value: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> { const result: Record<string, string> = {}; for (const [key, item] of Object.entries(value ?? {})) if (/^[A-Za-z0-9_.-]{1,80}$/.test(key) && item.length <= 512 && !/[\0\r\n]/.test(item)) result[key] = item; return result; }
function ascii(value: Uint8Array): string { return Buffer.from(value).toString("ascii").trim(); }
function unresolved(note: string): InstalledOperationObservation { return { outcome: "unresolved", note }; }
function plain(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function pathKey(value: string): string { return resolve(value).replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase(); }
function pullRecords(value: unknown, list: boolean): readonly Readonly<{ number: number; head: string; headRepository: string; base: string; state: "OPEN" | "MERGED" | "CLOSED" }>[] {
  if (!plain(value) || !plain(value.data) || !plain(value.data.repository)) throw new Error("Pull-request observation envelope is malformed.");
  const raw = list
    ? plain(value.data.repository.pullRequests) && Array.isArray(value.data.repository.pullRequests.nodes) ? value.data.repository.pullRequests.nodes : undefined
    : [value.data.repository.pullRequest];
  if (!raw || raw.length > 20) throw new Error("Pull-request observation list is malformed.");
  return raw.map((candidate) => {
    if (!plain(candidate) || !Number.isSafeInteger(candidate.number) || (candidate.number as number) < 1 || !oid(candidate.headRefOid as string | undefined)
      || !plain(candidate.headRepository) || typeof candidate.headRepository.nameWithOwner !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(candidate.headRepository.nameWithOwner)
      || typeof candidate.baseRefName !== "string" || !branch(candidate.baseRefName) || (candidate.state !== "OPEN" && candidate.state !== "MERGED" && candidate.state !== "CLOSED")) throw new Error("Pull-request observation record is malformed.");
    return { number: candidate.number as number, head: candidate.headRefOid as string, headRepository: candidate.headRepository.nameWithOwner, base: candidate.baseRefName, state: candidate.state };
  });
}
