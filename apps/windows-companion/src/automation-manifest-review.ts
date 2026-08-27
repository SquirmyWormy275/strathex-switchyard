import type { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import type { BrokerConfirmation } from "../../../packages/control-plane/src/brokers.ts";
import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { stableJson, type JournalEntry, type ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  assertAutomationManifestCurrent,
  automationManifestReviewScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest,
  parseAutomationManifestApproval,
  parseAutomationOperationManifest,
  type AutomationManifestAction,
  type AutomationManifestApproval,
  type AutomationOperationManifest,
  type AutomationOperationProposal
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";

const preparedEvent = "b122.automation-manifest.prepared.v1";
const approvedEvent = "b122.automation-manifest.approved.v1";
const consumedEvent = "b122.automation-manifest.consumed.v1";
const manifestLifetimeMs = 5 * 60_000;
const minimumLifetimeMs = 10_000;

type ReviewStatus = "prepared" | "approved" | "blocked" | "unavailable";

export interface AutomationManifestReviewQueueOptions {
  readonly store: ProtectedJsonStore;
  readonly sessions: SessionRegistry;
  readonly authorities: AuthorityLedger;
  readonly targetResolver: TargetResolver;
  readonly now?: () => Date;
}

export interface AutomationManifestPrepareResult {
  readonly status: Extract<ReviewStatus, "prepared" | "blocked" | "unavailable">;
  readonly summary: string;
  readonly manifest?: AutomationOperationManifest;
  readonly reviewScopeDigest?: string;
}

export interface AutomationManifestApproveResult {
  readonly status: Extract<ReviewStatus, "approved" | "blocked" | "unavailable">;
  readonly summary: string;
  readonly approval?: AutomationManifestApproval;
}

export interface ConsumedAutomationManifest {
  readonly manifest: AutomationOperationManifest;
  readonly approval: AutomationManifestApproval;
}

export interface AutomationManifestReviewPacket {
  readonly manifest: AutomationOperationManifest;
  readonly reviewScopeDigest: string;
}

interface PreparedPayload { readonly manifest: AutomationOperationManifest }
interface ApprovedPayload { readonly approval: AutomationManifestApproval }
interface ConsumedPayload {
  readonly manifestId: string;
  readonly approvalId: string;
  readonly confirmationDigest: string;
  readonly consumedAt: string;
}

/**
 * Protected two-phase review for the four automation commands. A proposal is
 * inert until the exact current user reviews its immutable manifest, and one
 * matching dispatcher confirmation consumes that approval exactly once.
 */
export class DurableAutomationManifestReviewQueue {
  private readonly now: () => Date;

  constructor(private readonly options: AutomationManifestReviewQueueOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async prepare(input: Readonly<{
    action: AutomationManifestAction;
    sessionId: string;
    authorityId: string;
    proposal: AutomationOperationProposal;
  }>): Promise<AutomationManifestPrepareResult> {
    let current: CurrentBinding | undefined;
    try {
      current = await this.resolveCurrent(input.action, input.sessionId, input.authorityId);
    } catch (error) {
      return unavailable(error, "Automation review preparation could not read its protected current binding.");
    }
    if (current.outcome) return current.outcome;

    const now = this.now().toISOString();
    const authorityExpiry = Date.parse(current.authority.expiresAt);
    const expiresAtMs = Math.min(Date.parse(now) + manifestLifetimeMs, authorityExpiry);
    if (expiresAtMs - Date.parse(now) < minimumLifetimeMs) {
      return { status: "blocked", summary: "The exact automation authority expires too soon to complete a safe review." };
    }

    let manifest: AutomationOperationManifest;
    try {
      if (input.proposal.kind !== input.action) {
        return { status: "blocked", summary: "The automation proposal kind does not match the selected command." };
      }
      manifest = createAutomationOperationManifest({
        repositoryRoot: current.target.repositoryRoot,
        targetSnapshotId: current.target.id,
        sessionId: current.session.id,
        authorityId: current.authority.id,
        taskId: current.session.taskId!,
        planRevision: current.session.planRevision!,
        provider: current.session.provider,
        createdAt: now,
        expiresAt: new Date(expiresAtMs).toISOString()
      }, input.proposal);
      await this.options.store.append<PreparedPayload>(preparedEvent, { manifest });
    } catch (error) {
      return blocked(error, "The automation proposal could not be converted into an exact review manifest.");
    }
    return {
      status: "prepared",
      summary: "The exact automation manifest is ready for current-user review; no automation effect has started.",
      manifest,
      reviewScopeDigest: automationManifestReviewScopeDigest(manifest)
    };
  }

  async approve(input: Readonly<{
    manifestId: string;
    manifestDigest: string;
    reviewScopeDigest: string;
    confirmationToken: string;
    confirmationExpiresAt: string;
  }>): Promise<AutomationManifestApproveResult> {
    let manifest: AutomationOperationManifest | undefined;
    try {
      manifest = preparedManifests(await this.options.store.readEntries()).get(input.manifestId);
    } catch (error) {
      return unavailable(error, "The protected automation review history is unavailable or invalid.");
    }
    if (!manifest || manifest.digest !== input.manifestDigest
      || automationManifestReviewScopeDigest(manifest) !== input.reviewScopeDigest) {
      return { status: "blocked", summary: "The reviewed automation artifact id, digest, or scope is not exact." };
    }

    let current: CurrentBinding | undefined;
    try {
      current = await this.resolveCurrent(manifest.action, manifest.sessionId, manifest.authorityId);
    } catch (error) {
      return unavailable(error, "Automation approval could not re-read its protected current binding.");
    }
    if (current.outcome) return { status: current.outcome.status, summary: current.outcome.summary };
    try {
      assertAutomationManifestCurrent(manifest, manifestContext(current, manifest), this.now().toISOString());
    } catch (error) {
      return blocked(error, "The automation manifest is no longer current.");
    }

    let proposed: AutomationManifestApproval;
    try {
      proposed = createAutomationManifestApproval({
        manifest,
        confirmationToken: input.confirmationToken,
        confirmationScopeDigest: input.reviewScopeDigest,
        confirmedAt: this.now().toISOString(),
        expiresAt: input.confirmationExpiresAt
      });
    } catch (error) {
      return blocked(error, "The exact automation approval was invalid.");
    }

    try {
      const approval = await this.options.store.transaction(async (transaction) => {
        const entries = await transaction.readEntries();
        const exactManifest = preparedManifests(entries).get(input.manifestId);
        if (!exactManifest || stableJson(exactManifest) !== stableJson(manifest)) return undefined;
        const consumed = consumedApprovals(entries);
        const existing = approvals(entries, preparedManifests(entries)).find((candidate) => candidate.manifestId === manifest.id);
        if (existing) return !consumed.has(existing.id) && stableJson(existing) === stableJson(proposed) ? existing : undefined;
        await transaction.append<ApprovedPayload>(approvedEvent, { approval: proposed });
        return proposed;
      });
      if (!approval) return { status: "blocked", summary: "The automation manifest was already approved differently, consumed, or changed during review." };
      return { status: "approved", summary: "The exact automation manifest was approved once and remains inert until matching dispatch.", approval };
    } catch (error) {
      return unavailable(error, "The protected automation approval could not be recorded.");
    }
  }

  /** Re-reads an exact unconsumed prepared manifest after trusted UI review. */
  async inspect(input: Readonly<{
    manifestId: string;
    manifestDigest: string;
    reviewScopeDigest: string;
    sessionId: string;
  }>): Promise<AutomationManifestReviewPacket | undefined> {
    let manifest: AutomationOperationManifest | undefined;
    let entries: readonly JournalEntry<unknown>[];
    try {
      entries = await this.options.store.readEntries();
      manifest = preparedManifests(entries).get(input.manifestId);
    } catch { return undefined; }
    if (!manifest || manifest.digest !== input.manifestDigest || manifest.sessionId !== input.sessionId
      || automationManifestReviewScopeDigest(manifest) !== input.reviewScopeDigest
      || approvals(entries, preparedManifests(entries)).some((approval) => approval.manifestId === manifest!.id)
      || Date.parse(manifest.expiresAt) <= this.now().getTime()) return undefined;
    let current: CurrentBinding | undefined;
    try { current = await this.resolveCurrent(manifest.action, manifest.sessionId, manifest.authorityId); }
    catch { return undefined; }
    if (current.outcome) return undefined;
    try { assertAutomationManifestCurrent(manifest, manifestContext(current, manifest), this.now().toISOString()); }
    catch { return undefined; }
    return { manifest, reviewScopeDigest: input.reviewScopeDigest };
  }

  async consume(input: Readonly<{
    action: AutomationManifestAction;
    target: TargetSnapshot;
    session: ManagedSession;
    authority: AuthorityGrant;
    confirmation: BrokerConfirmation;
  }>): Promise<ConsumedAutomationManifest | undefined> {
    if (!exactConfirmation(input)) return undefined;

    let current: CurrentBinding | undefined;
    try {
      current = await this.resolveCurrent(input.action, input.session.id, input.authority.id);
    } catch {
      return undefined;
    }
    if (current.outcome || !sameTarget(current.target, input.target)
      || stableJson(current.session) !== stableJson(input.session)
      || stableJson(current.authority) !== stableJson(input.authority)) return undefined;

    const now = this.now().toISOString();
    try {
      return await this.options.store.transaction(async (transaction) => {
        const entries = await transaction.readEntries();
        if (!protectedActorsStillCurrent(entries, input.session, input.authority)) return undefined;
        const manifests = preparedManifests(entries);
        const candidates = approvals(entries, manifests);
        const consumed = consumedApprovals(entries);
        const approval = candidates.find((candidate) => candidate.action === input.action
          && candidate.confirmationDigest === input.confirmation.confirmationDigest
          && candidate.reviewScopeDigest === input.confirmation.confirmationScopeDigest
          && candidate.targetSnapshotId === input.target.id
          && candidate.sessionId === input.session.id
          && candidate.authorityId === input.authority.id);
        if (!approval || consumed.has(approval.id) || Date.parse(approval.expiresAt) <= Date.parse(now)) return undefined;
        const manifest = manifests.get(approval.manifestId);
        if (!manifest) return undefined;
        assertAutomationManifestCurrent(manifest, manifestContext(current, manifest), now);
        await transaction.append<ConsumedPayload>(consumedEvent, {
          manifestId: manifest.id,
          approvalId: approval.id,
          confirmationDigest: approval.confirmationDigest,
          consumedAt: now
        });
        return { manifest, approval };
      });
    } catch {
      return undefined;
    }
  }

  /** Proves startup recovery is continuing the one exact already-consumed review, never consuming or minting a new approval. */
  async wasConsumed(input: Readonly<{
    manifest: AutomationOperationManifest;
    approval: AutomationManifestApproval;
  }>): Promise<boolean> {
    try {
      const manifest = parseAutomationOperationManifest(input.manifest);
      const approval = parseAutomationManifestApproval(input.approval, manifest);
      const entries = await this.options.store.readEntries();
      const storedManifest = preparedManifests(entries).get(manifest.id);
      const storedApproval = approvals(entries, preparedManifests(entries)).find((candidate) => candidate.id === approval.id);
      if (!storedManifest || !storedApproval || stableJson(storedManifest) !== stableJson(manifest)
        || stableJson(storedApproval) !== stableJson(approval)) return false;
      return entries.some((entry) => {
        if (entry.kind !== consumedEvent || !entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload)) return false;
        const payload = entry.payload as Record<string, unknown>;
        return payload.manifestId === manifest.id && payload.approvalId === approval.id
          && payload.confirmationDigest === approval.confirmationDigest && typeof payload.consumedAt === "string";
      });
    } catch {
      return false;
    }
  }

  private async resolveCurrent(action: AutomationManifestAction, sessionId: string, authorityId: string): Promise<CurrentBinding> {
    const definition = commandForAction(action as CommandAction);
    if (definition.executor !== "automation") return { outcome: { status: "blocked", summary: "The selected command is not an automation operation." } };
    const session = await this.options.sessions.get(sessionId);
    if (!session || session.status !== "running" || !session.capabilities.includes("mediated")) {
      return { outcome: { status: "blocked", summary: "Automation review requires the exact running mediated session." } };
    }
    if (!session.workspaceRoot || !session.targetSnapshotId || !session.taskId || !session.planRevision) {
      return { outcome: { status: "blocked", summary: "The managed session lacks an exact repository, target, task, or plan binding." } };
    }
    const target = await this.options.targetResolver.resolve({ definition, session });
    if (!target || target.completeness !== "complete") {
      return { outcome: { status: "unavailable", summary: "A complete current TargetSnapshot is unavailable for automation review." } };
    }
    if (target.id !== session.targetSnapshotId || !sameRoot(target.repositoryRoot, session.workspaceRoot)) {
      return { outcome: { status: "blocked", summary: "The automation target changed or no longer matches the managed session." } };
    }
    const decision = await this.options.authorities.evaluate({
      authorityId,
      repositoryRoot: target.repositoryRoot,
      sessionId: session.id,
      taskId: session.taskId,
      planRevision: session.planRevision,
      action,
      now: this.now().toISOString()
    });
    if (!decision.allowed || !decision.grant) {
      return { outcome: { status: "blocked", summary: decision.reason } };
    }
    return { session, target, authority: decision.grant };
  }
}

type FailureOutcome = Readonly<{ status: "blocked" | "unavailable"; summary: string }>;
type CurrentBinding =
  | Readonly<{ outcome: FailureOutcome; session?: never; target?: never; authority?: never }>
  | Readonly<{ outcome?: never; session: ManagedSession; target: TargetSnapshot; authority: AuthorityGrant }>;

function manifestContext(current: Exclude<CurrentBinding, { outcome: FailureOutcome }>, manifest: AutomationOperationManifest) {
  return {
    repositoryRoot: current.target.repositoryRoot,
    targetSnapshotId: current.target.id,
    sessionId: current.session.id,
    authorityId: current.authority.id,
    taskId: current.session.taskId!,
    planRevision: current.session.planRevision!,
    provider: current.session.provider,
    createdAt: manifest.createdAt,
    expiresAt: manifest.expiresAt
  };
}

function preparedManifests(entries: readonly JournalEntry<unknown>[]): Map<string, AutomationOperationManifest> {
  const result = new Map<string, AutomationOperationManifest>();
  for (const entry of entries) {
    if (entry.kind !== preparedEvent) continue;
    const value = (entry.payload as Partial<PreparedPayload> | undefined)?.manifest;
    const manifest = parseAutomationOperationManifest(value);
    const previous = result.get(manifest.id);
    if (previous && stableJson(previous) !== stableJson(manifest)) throw new Error("A protected automation manifest id was reused with different content.");
    result.set(manifest.id, manifest);
  }
  return result;
}

function approvals(entries: readonly JournalEntry<unknown>[], manifests: ReadonlyMap<string, AutomationOperationManifest>): AutomationManifestApproval[] {
  const result: AutomationManifestApproval[] = [];
  for (const entry of entries) {
    if (entry.kind !== approvedEvent) continue;
    const value = (entry.payload as Partial<ApprovedPayload> | undefined)?.approval;
    if (!value || typeof value.manifestId !== "string") throw new Error("A protected automation approval record is malformed.");
    const manifest = manifests.get(value.manifestId);
    if (!manifest) throw new Error("A protected automation approval references an absent manifest.");
    result.push(parseAutomationManifestApproval(value, manifest));
  }
  return result;
}

function consumedApprovals(entries: readonly JournalEntry<unknown>[]): Set<string> {
  const result = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== consumedEvent) continue;
    const payload = entry.payload as Partial<ConsumedPayload> | undefined;
    if (!payload || typeof payload.approvalId !== "string" || typeof payload.manifestId !== "string"
      || typeof payload.confirmationDigest !== "string" || typeof payload.consumedAt !== "string") {
      throw new Error("A protected automation consumption record is malformed.");
    }
    result.add(payload.approvalId);
  }
  return result;
}

function protectedActorsStillCurrent(entries: readonly JournalEntry<unknown>[], session: ManagedSession, authority: AuthorityGrant): boolean {
  let storedSession: ManagedSession | undefined;
  let storedAuthority: AuthorityGrant | undefined;
  let revoked = false;
  for (const entry of entries) {
    if (entry.kind === "session.registered" || entry.kind === "session.updated") {
      const candidate = (entry.payload as { session?: ManagedSession } | undefined)?.session;
      if (!candidate || typeof candidate.id !== "string") throw new Error("A protected session record is malformed.");
      if (candidate.id === session.id) storedSession = candidate;
    }
    if (entry.kind === "authority.issued") {
      const candidate = (entry.payload as { grant?: AuthorityGrant } | undefined)?.grant;
      if (!candidate || typeof candidate.id !== "string") throw new Error("A protected authority record is malformed.");
      if (candidate.id === authority.id) { storedAuthority = candidate; revoked = false; }
    }
    if (entry.kind === "authority.revoked") {
      const candidate = entry.payload as { authorityId?: string } | undefined;
      if (!candidate || typeof candidate.authorityId !== "string") throw new Error("A protected authority revocation is malformed.");
      if (candidate.authorityId === authority.id) revoked = true;
    }
  }
  return !revoked && !!storedSession && !!storedAuthority
    && stableJson(storedSession) === stableJson(session)
    && stableJson(storedAuthority) === stableJson(authority);
}

function exactConfirmation(input: Readonly<{
  action: AutomationManifestAction;
  target: TargetSnapshot;
  session: ManagedSession;
  authority: AuthorityGrant;
  confirmation: BrokerConfirmation;
}>): boolean {
  const confirmation = input.confirmation;
  return confirmation.currentUserConfirmed === true
    && confirmation.action === input.action
    && confirmation.targetSnapshotId === input.target.id
    && confirmation.sessionId === input.session.id
    && confirmation.authorityId === input.authority.id
    && typeof confirmation.confirmationDigest === "string"
    && typeof confirmation.confirmationScopeDigest === "string";
}

function sameTarget(left: TargetSnapshot, right: TargetSnapshot): boolean { return stableJson(left) === stableJson(right); }
function sameRoot(left: string, right: string): boolean { return left.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase() === right.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase(); }
function detail(error: unknown): string { return error instanceof Error ? error.message : "Unknown protected-boundary failure."; }
function blocked(error: unknown, prefix: string): FailureOutcome {
  return { status: "blocked", summary: `${prefix} ${detail(error)}` };
}
function unavailable(error: unknown, prefix: string): FailureOutcome {
  return { status: "unavailable", summary: `${prefix} ${detail(error)}` };
}
