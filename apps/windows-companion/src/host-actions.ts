import { createHash, randomBytes } from "node:crypto";

import type { AdapterOutcome, AdapterRequest, CommandAdapter } from "../../../packages/control-plane/src/adapters.ts";
import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { HostActionAuthorizationPayload, HostActionClaimPayload, HostActionCompletionPayload } from "./bridge.ts";
import type { HostActionCompletionRecord, HostActionCoordinator } from "./service.ts";
import type { GitHubNavigationCandidate, GitHubNavigationPage, GitHubNavigationResolver } from "./github-navigation.ts";
import type { ManagedTerminalProfile } from "./provider-desktop.ts";
import type { RepositoryExecutableIdentity } from "./repository-runtime.ts";

export const localHostActionKinds = [
  "show_handoff_queue", "toggle_handoff_routing", "show_blocker_queue", "show_done_queue",
  "open_external_url", "create_claude_terminal", "create_codex_terminal", "focus_vscode",
  "new_vscode_window", "focus_external_terminal", "focus_integrated_terminal", "open_compound_palette",
  "show_voice_center", "switch_voice_provider", "show_voice_session_picker", "show_pipeline_failure_trace", "start_vscode_debug", "configure_python_venv",
  "stop_vscode_debug", "select_github_navigation"
] as const;

export type LocalHostActionKind = (typeof localHostActionKinds)[number];

/** Actions that can only be delivered by the installed VS Code UI host. */
export const extensionClaimableHostActionKinds = ["show_voice_center"] as const satisfies readonly LocalHostActionKind[];
export type ExtensionClaimableHostActionKind = (typeof extensionClaimableHostActionKinds)[number];

export interface HostActionIntent {
  readonly version: 1;
  readonly id: string;
  readonly operationId: string;
  readonly commandAction: CommandAction;
  readonly hostAction: LocalHostActionKind;
  readonly targetSnapshotId?: string;
  readonly sessionId?: string;
  readonly workspaceRoot?: string;
  readonly url?: string;
  readonly debugConfiguration?: string;
  readonly debugSessionId?: string;
  /** Protected companion-recovered effect session; distinct from authority-source sessionId. */
  readonly debugEffectSessionId?: string;
  readonly debugEffectSessionBindingDigest?: string;
  readonly debugSourceSessionBindingDigest?: string;
  readonly debugBindingId?: string;
  readonly debugOriginOperationId?: string;
  readonly pythonInterpreter?: string;
  readonly pythonInterpreterIdentity?: RepositoryExecutableIdentity;
  readonly githubCandidates?: readonly GitHubNavigationCandidate[];
  readonly managedTerminalProfile?: ManagedTerminalProfile;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface HostActionAuthorization {
  readonly version: 1;
  readonly hostActionId: string;
  readonly operationId: string;
  readonly authorizationToken: string;
  readonly adapterVersion: string;
  readonly authorizedAt: string;
  readonly expiresAt: string;
  readonly selectionId?: string;
  readonly url?: string;
  readonly claimId?: string;
  readonly windowSessionId?: string;
}

export interface HostActionClaim {
  readonly version: 1;
  readonly claimId: string;
  readonly claimToken: string;
  readonly hostActionId: string;
  readonly operationId: string;
  readonly commandAction: CommandAction;
  readonly hostActionKind: ExtensionClaimableHostActionKind;
  readonly targetSnapshotId?: string;
  readonly sessionId?: string;
  readonly workspaceRoot?: string;
  readonly windowSessionId: string;
  readonly adapterVersion: string;
  readonly capabilities: readonly ExtensionClaimableHostActionKind[];
  readonly claimedAt: string;
  readonly expiresAt: string;
  readonly actionExpiresAt: string;
}

export interface HostActionPlan {
  readonly hostAction: LocalHostActionKind;
  readonly url?: string;
  readonly debugConfiguration?: string;
  readonly debugSessionId?: string;
  readonly debugEffectSessionId?: string;
  readonly debugEffectSessionBindingDigest?: string;
  readonly debugSourceSessionBindingDigest?: string;
  readonly debugBindingId?: string;
  readonly debugOriginOperationId?: string;
  readonly pythonInterpreter?: string;
  readonly pythonInterpreterIdentity?: RepositoryExecutableIdentity;
  readonly githubCandidates?: readonly GitHubNavigationCandidate[];
  readonly managedTerminalProfile?: ManagedTerminalProfile;
}

export interface HostActionFinalAuthorizer {
  authorize(intent: HostActionIntent): Promise<Readonly<{ allowed: boolean; reason: string }>>;
}

type HostActionEvent =
  | { readonly version: 1; readonly event: "queued"; readonly intent: HostActionIntent }
  | { readonly version: 1; readonly event: "claimed"; readonly claim: HostActionClaim }
  | { readonly version: 1; readonly event: "authorized"; readonly authorization: HostActionAuthorization }
  | { readonly version: 1; readonly event: "settled"; readonly record: HostActionCompletionRecord }
  | { readonly version: 1; readonly event: "cancelled"; readonly hostActionId: string; readonly operationId: string; readonly reason: string; readonly at: string };

export interface DurableHostActionQueueOptions {
  readonly now?: () => Date;
  readonly lifetimeMs?: number;
  readonly authorizationLifetimeMs?: number;
  readonly claimLifetimeMs?: number;
  readonly claimTokenFactory?: () => string;
  readonly finalAuthorizer?: HostActionFinalAuthorizer;
}

/**
 * Durable two-phase boundary for effects owned by the installed VS Code host.
 * Dispatch records an exact, typed intent and remains Running. Only a later
 * authenticated host acknowledgement can settle the same durable operation.
 */
export class DurableHostActionQueue implements HostActionCoordinator {
  private readonly store: ProtectedJsonStore;
  private readonly now: () => Date;
  private readonly lifetimeMs: number;
  private readonly authorizationLifetimeMs: number;
  private readonly claimLifetimeMs: number;
  private readonly claimTokenFactory: () => string;
  private readonly finalAuthorizer?: HostActionFinalAuthorizer;

  constructor(store: ProtectedJsonStore, options: DurableHostActionQueueOptions = {}) {
    this.store = store;
    this.now = options.now ?? (() => new Date());
    this.lifetimeMs = options.lifetimeMs ?? 30_000;
    this.authorizationLifetimeMs = options.authorizationLifetimeMs ?? 5_000;
    this.claimLifetimeMs = options.claimLifetimeMs ?? 5_000;
    this.claimTokenFactory = options.claimTokenFactory ?? (() => randomBytes(32).toString("base64url"));
    this.finalAuthorizer = options.finalAuthorizer;
    if (!Number.isSafeInteger(this.lifetimeMs) || this.lifetimeMs < 1_000 || this.lifetimeMs > 5 * 60_000) {
      throw new Error("The host-action acknowledgement lifetime is outside safe bounds.");
    }
    if (!Number.isSafeInteger(this.authorizationLifetimeMs) || this.authorizationLifetimeMs < 500 || this.authorizationLifetimeMs > this.lifetimeMs) {
      throw new Error("The host-action authorization lifetime is outside safe bounds.");
    }
    if (!Number.isSafeInteger(this.claimLifetimeMs) || this.claimLifetimeMs < 500 || this.claimLifetimeMs > this.lifetimeMs) {
      throw new Error("The host-action claim lifetime is outside safe bounds.");
    }
  }

  async enqueue(request: AdapterRequest, plan: Readonly<HostActionPlan>): Promise<HostActionIntent> {
    if (!request.operationId) throw new Error("A durable operation ID is required before a host action can be queued.");
    if (plan.hostAction === "start_vscode_debug") {
      if (!plan.debugConfiguration || plan.debugSessionId !== undefined || plan.debugEffectSessionId !== undefined || plan.debugEffectSessionBindingDigest !== undefined || plan.debugSourceSessionBindingDigest !== undefined || plan.debugBindingId !== undefined || plan.debugOriginOperationId !== undefined) throw new Error("VS Code debug start requires one exact configuration and no preselected session identity.");
    } else if (plan.hostAction === "stop_vscode_debug") {
      if (!plan.debugConfiguration || !plan.debugSessionId || !plan.debugEffectSessionId || !plan.debugEffectSessionBindingDigest || !plan.debugSourceSessionBindingDigest || !plan.debugBindingId || !plan.debugOriginOperationId) throw new Error("VS Code debug stop requires one exact configuration, debug identity, protected source/effect session bindings, debug binding, and origin operation.");
      if (!/^[a-f0-9]{64}$/.test(plan.debugEffectSessionBindingDigest) || !/^[a-f0-9]{64}$/.test(plan.debugSourceSessionBindingDigest)) throw new Error("VS Code debug stop session-binding digests are invalid.");
    } else if (plan.debugConfiguration !== undefined || plan.debugSessionId !== undefined || plan.debugEffectSessionId !== undefined || plan.debugEffectSessionBindingDigest !== undefined || plan.debugSourceSessionBindingDigest !== undefined || plan.debugBindingId !== undefined || plan.debugOriginOperationId !== undefined) {
      throw new Error("Only the exact VS Code debug host actions may carry debug identity fields.");
    }
    const pythonInterpreterIdentity = plan.pythonInterpreterIdentity ? validateRepositoryExecutableIdentity(plan.pythonInterpreterIdentity) : undefined;
    if (plan.hostAction === "configure_python_venv") {
      if (!plan.pythonInterpreter || !pythonInterpreterIdentity || normalizePath(plan.pythonInterpreter) !== normalizePath(pythonInterpreterIdentity.canonicalPath)) {
        throw new Error("VS Code Python configuration requires one exact interpreter and protected executable identity.");
      }
    } else if (plan.pythonInterpreter !== undefined || pythonInterpreterIdentity !== undefined) {
      throw new Error("Only the exact Python-environment host action may carry interpreter identity fields.");
    }
    const now = this.now();
    const intent: HostActionIntent = {
      version: 1,
      id: `host-action:${digest(`${request.operationId}:${request.definition.action}`)}`,
      operationId: request.operationId,
      commandAction: request.definition.action,
      hostAction: plan.hostAction,
      ...(request.target ? { targetSnapshotId: request.target.id } : {}),
      ...(request.session ? { sessionId: request.session.id } : {}),
      ...(request.target ? { workspaceRoot: request.target.repositoryRoot } : {}),
      ...(plan.url ? { url: plan.url } : {}),
      ...(plan.debugConfiguration ? { debugConfiguration: boundedDebugReference(plan.debugConfiguration, "VS Code debug configuration") } : {}),
      ...(plan.debugSessionId ? { debugSessionId: boundedDebugReference(plan.debugSessionId, "VS Code debug session ID") } : {}),
      ...(plan.debugEffectSessionId ? { debugEffectSessionId: boundedDebugReference(plan.debugEffectSessionId, "VS Code debug effect managed-session ID") } : {}),
      ...(plan.debugEffectSessionBindingDigest ? { debugEffectSessionBindingDigest: plan.debugEffectSessionBindingDigest } : {}),
      ...(plan.debugSourceSessionBindingDigest ? { debugSourceSessionBindingDigest: plan.debugSourceSessionBindingDigest } : {}),
      ...(plan.debugBindingId ? { debugBindingId: boundedDebugReference(plan.debugBindingId, "VS Code debug binding ID") } : {}),
      ...(plan.debugOriginOperationId ? { debugOriginOperationId: boundedDebugReference(plan.debugOriginOperationId, "VS Code debug origin operation ID") } : {}),
      ...(plan.pythonInterpreter ? { pythonInterpreter: plan.pythonInterpreter } : {}),
      ...(pythonInterpreterIdentity ? { pythonInterpreterIdentity } : {}),
      ...(plan.githubCandidates ? { githubCandidates: validateGitHubCandidates(plan.githubCandidates) } : {}),
      ...(plan.managedTerminalProfile ? { managedTerminalProfile: validateManagedTerminalProfile(plan.managedTerminalProfile, plan.hostAction) } : {}),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.lifetimeMs).toISOString()
    };
    return this.store.transaction(async (transaction) => {
      const events = (await transaction.readEntries<HostActionEvent>()).filter((entry) => entry.kind === "host_action").map((entry) => entry.payload);
      const existing = events.find((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued" && event.intent.id === intent.id)?.intent;
      if (existing) {
        if (existing.operationId !== intent.operationId || existing.commandAction !== intent.commandAction || existing.hostAction !== intent.hostAction
          || existing.targetSnapshotId !== intent.targetSnapshotId || existing.workspaceRoot !== intent.workspaceRoot
          || existing.sessionId !== intent.sessionId
          || existing.url !== intent.url || existing.debugConfiguration !== intent.debugConfiguration || existing.debugSessionId !== intent.debugSessionId
          || existing.debugEffectSessionId !== intent.debugEffectSessionId
          || existing.debugEffectSessionBindingDigest !== intent.debugEffectSessionBindingDigest
          || existing.debugSourceSessionBindingDigest !== intent.debugSourceSessionBindingDigest
          || existing.debugBindingId !== intent.debugBindingId
          || existing.debugOriginOperationId !== intent.debugOriginOperationId || existing.pythonInterpreter !== intent.pythonInterpreter
          || JSON.stringify(existing.pythonInterpreterIdentity) !== JSON.stringify(intent.pythonInterpreterIdentity)
          || JSON.stringify(existing.githubCandidates) !== JSON.stringify(intent.githubCandidates)
          || JSON.stringify(existing.managedTerminalProfile) !== JSON.stringify(intent.managedTerminalProfile)) {
          throw new Error("The durable host-action ID is already bound to different intent data.");
        }
        return existing;
      }
      await transaction.append<HostActionEvent>("host_action", { version: 1, event: "queued", intent });
      return intent;
    });
  }

  /**
   * Atomically assigns one extension-owned UI action to one exact registered
   * window binding. A durable claim is never reissued, even after lease expiry:
   * losing the response is ambiguous and therefore reconciliation-only.
   */
  async claim(payload: HostActionClaimPayload): Promise<HostActionClaim | undefined> {
    const binding = exactClaimBinding(payload);
    const now = this.now();
    return this.store.transaction(async (transaction) => {
      const events = (await transaction.readEntries<HostActionEvent>()).filter((entry) => entry.kind === "host_action").map((entry) => entry.payload);
      const settled = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "settled" }> => event.event === "settled").map((event) => event.record.hostActionId));
      const cancelled = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "cancelled" }> => event.event === "cancelled").map((event) => event.hostActionId));
      const claimed = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "claimed" }> => event.event === "claimed").map((event) => event.claim.hostActionId));
      const authorized = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "authorized" }> => event.event === "authorized").map((event) => event.authorization.hostActionId));
      const intent = events
        .filter((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued")
        .map((event) => event.intent)
        .filter((candidate) => isExtensionClaimable(candidate.hostAction) && binding.capabilities.includes(candidate.hostAction)
          && (candidate.workspaceRoot === undefined || binding.workspaceRoots.some((root) => normalizePath(root) === normalizePath(candidate.workspaceRoot!)))
          && Date.parse(candidate.expiresAt) > now.getTime() && !settled.has(candidate.id) && !cancelled.has(candidate.id)
          && !claimed.has(candidate.id) && !authorized.has(candidate.id))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
      if (!intent) return undefined;
      if (!isExtensionClaimable(intent.hostAction)) throw new Error("The selected extension host action changed its closed capability mapping.");
      const claimedAt = now.toISOString();
      const claim: HostActionClaim = {
        version: 1,
        claimId: `host-action-claim:${digest(`${intent.id}:${binding.windowSessionId}:${binding.adapterVersion}:${binding.capabilities.join(",")}`)}`,
        claimToken: boundedClaimToken(this.claimTokenFactory()),
        hostActionId: intent.id,
        operationId: intent.operationId,
        commandAction: intent.commandAction,
        hostActionKind: intent.hostAction,
        ...(intent.targetSnapshotId ? { targetSnapshotId: intent.targetSnapshotId } : {}),
        ...(intent.sessionId ? { sessionId: intent.sessionId } : {}),
        ...(intent.workspaceRoot ? { workspaceRoot: intent.workspaceRoot } : {}),
        windowSessionId: binding.windowSessionId,
        adapterVersion: binding.adapterVersion,
        capabilities: [...binding.capabilities],
        claimedAt,
        expiresAt: new Date(Math.min(Date.parse(intent.expiresAt), now.getTime() + this.claimLifetimeMs)).toISOString(),
        actionExpiresAt: intent.expiresAt
      };
      await transaction.append<HostActionEvent>("host_action", { version: 1, event: "claimed", claim });
      return claim;
    });
  }

  /**
   * Issues one short-lived, single-effect authorization only after the trusted
   * host revalidates the exact queued target immediately before the VS Code
   * effect. An authorization is never reissued after an ambiguous response.
   */
  async authorize(payload: HostActionAuthorizationPayload): Promise<HostActionAuthorization> {
    if (!this.finalAuthorizer) throw new Error("No trusted final host-action authorizer is installed.");
    const adapterVersion = boundedVersion(payload.adapterVersion);
    const hostActionId = exactHostActionId(payload.hostActionId);
    const events = await this.events();
    const intent = pendingIntent(events, hostActionId, this.now());
    const claim = claimFor(events, hostActionId);
    assertClaimReference(payload, claim, this.now());
    const selected = selectGitHubCandidate(intent, payload.selectionId);
    if (events.some((event): event is Extract<HostActionEvent, { event: "authorized" }> => event.event === "authorized" && event.authorization.hostActionId === hostActionId)) {
      throw new Error("The host action was already authorized; its outcome requires reconciliation and cannot be replayed.");
    }
    const decision = await this.finalAuthorizer.authorize(intent);
    if (!decision.allowed) throw new Error(boundedSummary(decision.reason));
    const now = this.now();
    const authorization: HostActionAuthorization = {
      version: 1,
      hostActionId: intent.id,
      operationId: intent.operationId,
      authorizationToken: `host-action-auth:${randomBytes(32).toString("hex")}`,
      adapterVersion,
      authorizedAt: now.toISOString(),
      expiresAt: new Date(Math.min(Date.parse(intent.expiresAt), now.getTime() + this.authorizationLifetimeMs)).toISOString(),
      ...(selected
        ? { selectionId: selected.id, url: selected.url }
        : intent.hostAction === "open_external_url"
          ? { url: exactAuthorizedUrl(intent.url) }
          : {}),
      ...(claim ? { claimId: claim.claimId, windowSessionId: claim.windowSessionId } : {})
    };
    return this.store.transaction(async (transaction) => {
      const current = (await transaction.readEntries<HostActionEvent>()).filter((entry) => entry.kind === "host_action").map((entry) => entry.payload);
      const exactIntent = pendingIntent(current, hostActionId, this.now());
      if (!sameIntent(exactIntent, intent)) throw new Error("The durable host-action intent changed during final authorization.");
      assertClaimReference(payload, claimFor(current, hostActionId), this.now());
      if (current.some((event): event is Extract<HostActionEvent, { event: "authorized" }> => event.event === "authorized" && event.authorization.hostActionId === hostActionId)) {
        throw new Error("The host action was already authorized; its outcome requires reconciliation and cannot be replayed.");
      }
      await transaction.append<HostActionEvent>("host_action", { version: 1, event: "authorized", authorization });
      return authorization;
    });
  }

  async settle(payload: HostActionCompletionPayload): Promise<HostActionCompletionRecord> {
    return this.store.transaction(async (transaction) => {
      const events = (await transaction.readEntries<HostActionEvent>()).filter((entry) => entry.kind === "host_action").map((entry) => entry.payload);
      const queued = events.find((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued" && event.intent.id === payload.hostActionId)?.intent;
      if (!queued) throw new Error("The host-action acknowledgement does not match a durable queued intent.");
      if (events.some((event): event is Extract<HostActionEvent, { event: "cancelled" }> => event.event === "cancelled" && event.hostActionId === payload.hostActionId)) {
        throw new Error("A cancelled host action cannot be acknowledged as completed.");
      }
      const authorization = events.find((event): event is Extract<HostActionEvent, { event: "authorized" }> => event.event === "authorized" && event.authorization.hostActionId === payload.hostActionId)?.authorization;
      const claim = claimFor(events, payload.hostActionId);
      assertClaimReference(payload, claim);
      if (payload.succeeded && !authorization) throw new Error("A successful host action requires a trusted final-effect authorization.");
      if (payload.authorizationToken !== undefined) {
        if (!authorization || authorization.authorizationToken !== payload.authorizationToken || authorization.adapterVersion !== boundedVersion(payload.adapterVersion)) {
          throw new Error("The host-action completion does not match its exact final-effect authorization.");
        }
      } else if (payload.succeeded) throw new Error("A successful host action is missing its one-time authorization token.");
      if (authorization && (authorization.claimId !== claim?.claimId || authorization.windowSessionId !== claim?.windowSessionId)) {
        throw new Error("The host-action authorization changed its exact extension claim binding.");
      }
      const priorEvent = events.find((event): event is Extract<HostActionEvent, { event: "settled" }> => event.event === "settled" && event.record.hostActionId === payload.hostActionId)?.record;
      const prior = priorEvent ? safeCompletion(priorEvent, queued) : undefined;
      if (priorEvent && !prior) throw new Error("The protected host-action completion does not match its exact durable intent.");
      const now = this.now();
      const intentExpired = Date.parse(queued.expiresAt) <= now.getTime();
      const authorizationExpired = authorization !== undefined && Date.parse(authorization.expiresAt) <= now.getTime();
      const ambiguous = payload.effectDisposition === "ambiguous" || (payload.succeeded && authorizationExpired);
      const record: HostActionCompletionRecord = {
        hostActionId: queued.id,
        operationId: queued.operationId,
        action: queued.commandAction,
        ...(queued.targetSnapshotId ? { targetSnapshotId: queued.targetSnapshotId } : {}),
        status: ambiguous ? "incomplete" : intentExpired ? "failed" : payload.succeeded ? "completed" : "failed",
        summary: authorizationExpired && payload.succeeded
          ? "The host reported an effect after its one-time authorization expired; reconciliation is required and completion was not accepted."
          : intentExpired
            ? "The authenticated host acknowledgement arrived after the bounded action deadline."
            : boundedSummary(payload.summary),
        completionDigest: digest(JSON.stringify({ id: queued.id, action: queued.commandAction, succeeded: !intentExpired && !ambiguous && payload.succeeded, effectDisposition: payload.effectDisposition ?? (payload.succeeded ? "committed" : "not_started"), adapterVersion: boundedVersion(payload.adapterVersion), authorization: authorization ? digest(authorization.authorizationToken) : "none" })),
        completedAt: now.toISOString()
      };
      if (prior) {
        if (prior.status !== record.status || prior.summary !== record.summary
          || (prior.completionDigest !== undefined && prior.completionDigest !== record.completionDigest)) {
          throw new Error("A settled host action cannot be acknowledged with a different outcome.");
        }
        return prior;
      }
      await transaction.append<HostActionEvent>("host_action", { version: 1, event: "settled", record });
      return record;
    });
  }

  async listPending(): Promise<readonly HostActionIntent[]> {
    const events = (await this.store.readEntries<HostActionEvent>()).filter((entry) => entry.kind === "host_action").map((entry) => entry.payload);
    const settled = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "settled" }> => event.event === "settled").map((event) => event.record.hostActionId));
    const cancelled = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "cancelled" }> => event.event === "cancelled").map((event) => event.hostActionId));
    return events.filter((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued" && !settled.has(event.intent.id) && !cancelled.has(event.intent.id)).map((event) => event.intent);
  }

  /** Returns durable authenticated completions for idempotent restart recovery. */
  async listSettled(): Promise<readonly HostActionCompletionRecord[]> {
    const events = (await this.store.readEntries<HostActionEvent>())
      .filter((entry) => entry.kind === "host_action")
      .map((entry) => entry.payload);
    const queued = new Map(events.filter((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued").map((event) => [event.intent.id, event.intent]));
    const records = new Map<string, HostActionCompletionRecord>();
    for (const event of events) {
      if (event.event === "settled" && !records.has(event.record.hostActionId)) {
        const intent = queued.get(event.record.hostActionId);
        const completion = intent ? safeCompletion(event.record, intent) : undefined;
        if (completion) records.set(event.record.hostActionId, completion);
      }
    }
    return [...records.values()];
  }

  /** Cancels only durable intents already bound to this exact operation. */
  async cancelPendingByOperation(operationId: string, reason: string): Promise<number> {
    const exactOperation = boundedReference(operationId, "host-action operation ID");
    const exactReason = boundedSummary(reason);
    return this.store.transaction(async (transaction) => {
      const events = (await transaction.readEntries<HostActionEvent>()).filter((entry) => entry.kind === "host_action").map((entry) => entry.payload);
      const settled = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "settled" }> => event.event === "settled").map((event) => event.record.hostActionId));
      const cancelled = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "cancelled" }> => event.event === "cancelled").map((event) => event.hostActionId));
      const authorized = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "authorized" }> => event.event === "authorized").map((event) => event.authorization.hostActionId));
      const pending = events.filter((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued"
        && event.intent.operationId === exactOperation && !settled.has(event.intent.id) && !cancelled.has(event.intent.id) && !authorized.has(event.intent.id));
      for (const event of pending) {
        await transaction.append<HostActionEvent>("host_action", {
          version: 1, event: "cancelled", hostActionId: event.intent.id, operationId: exactOperation, reason: exactReason, at: this.now().toISOString()
        });
      }
      return pending.length;
    });
  }

  /** Cancels only queued intents already bound to this exact repository root. */
  async cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number> {
    const exactRoot = normalizePath(repositoryRoot);
    const exactReason = boundedSummary(reason);
    return this.store.transaction(async (transaction) => {
      const events = (await transaction.readEntries<HostActionEvent>()).filter((entry) => entry.kind === "host_action").map((entry) => entry.payload);
      const settled = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "settled" }> => event.event === "settled").map((event) => event.record.hostActionId));
      const cancelled = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "cancelled" }> => event.event === "cancelled").map((event) => event.hostActionId));
      const authorized = new Set(events.filter((event): event is Extract<HostActionEvent, { event: "authorized" }> => event.event === "authorized").map((event) => event.authorization.hostActionId));
      const pending = events.filter((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued"
        && event.intent.workspaceRoot !== undefined && normalizePath(event.intent.workspaceRoot) === exactRoot
        && !settled.has(event.intent.id) && !cancelled.has(event.intent.id) && !authorized.has(event.intent.id));
      for (const event of pending) await transaction.append<HostActionEvent>("host_action", {
        version: 1, event: "cancelled", hostActionId: event.intent.id, operationId: event.intent.operationId, reason: exactReason, at: this.now().toISOString()
      });
      return pending.length;
    });
  }

  /** Read-only observation used by startup reconciliation; it never executes an intent. */
  async observeOperation(
    operationId: string,
    action?: string,
    targetSnapshotId?: string,
    repositoryRoot?: string
  ): Promise<Readonly<{
    outcome: "committed" | "failed" | "cancelled" | "unresolved";
    note: string;
    binding?: Readonly<{ action: CommandAction; targetSnapshotId?: string; repositoryRoot?: string }>;
  }>> {
    const exactOperation = boundedReference(operationId, "host-action operation ID");
    const exactAction = action === undefined ? undefined : boundedReference(action, "host-action command action");
    const exactTarget = targetSnapshotId === undefined ? undefined : boundedReference(targetSnapshotId, "host-action target snapshot ID");
    const exactRoot = repositoryRoot === undefined ? undefined : normalizePath(repositoryRoot);
    if ((exactTarget === undefined) !== (exactRoot === undefined)) throw new Error("The host-action target binding is partial.");
    const events = (await this.store.readEntries<HostActionEvent>()).filter((entry) => entry.kind === "host_action").map((entry) => entry.payload);
    const queued = events.find((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued"
      && event.intent.operationId === exactOperation && (exactAction === undefined || event.intent.commandAction === exactAction)
      && (exactTarget === undefined || (event.intent.targetSnapshotId === exactTarget && event.intent.workspaceRoot !== undefined && normalizePath(event.intent.workspaceRoot) === exactRoot)))?.intent;
    if (!queued) return { outcome: "unresolved", note: "No exact durable host-action intent was observed; nothing was replayed." };
    const binding = {
      action: queued.commandAction,
      ...(queued.targetSnapshotId ? { targetSnapshotId: queued.targetSnapshotId } : {}),
      ...(queued.workspaceRoot ? { repositoryRoot: queued.workspaceRoot } : {})
    };
    const completedEvent = events.find((event): event is Extract<HostActionEvent, { event: "settled" }> => event.event === "settled" && event.record.hostActionId === queued.id)?.record;
    const completed = completedEvent ? safeCompletion(completedEvent, queued) : undefined;
    if (completed) return completed.status === "completed"
      ? { outcome: "committed", note: "The authenticated host completion is durable for the exact operation.", binding }
      : completed.status === "incomplete"
        ? { outcome: "unresolved", note: "The authenticated host reported a possibly committed effect that requires reconciliation and must not be replayed.", binding }
        : { outcome: "failed", note: "The authenticated host reported failure for the exact operation.", binding };
    if (events.some((event): event is Extract<HostActionEvent, { event: "authorized" }> => event.event === "authorized" && event.authorization.hostActionId === queued.id)) {
      return {
        outcome: "unresolved",
        note: "The exact durable host action was authorized and may have started; only authenticated settlement can establish terminal effect truth.",
        binding
      };
    }
    if (events.some((event): event is Extract<HostActionEvent, { event: "cancelled" }> => event.event === "cancelled" && event.hostActionId === queued.id)) {
      return { outcome: "cancelled", note: "The exact durable host action was cancelled before authenticated completion.", binding };
    }
    return { outcome: "unresolved", note: "The exact durable host action remains queued; no host effect was inferred or replayed.", binding };
  }

  private async events(): Promise<readonly HostActionEvent[]> {
    return (await this.store.readEntries<HostActionEvent>())
      .filter((entry) => entry.kind === "host_action")
      .map((entry) => entry.payload);
  }
}

export class DurableHostActionAdapter implements CommandAdapter {
  readonly id = "durable-vscode-host-actions";
  readonly kind = "vscode" as const;
  private readonly queue: DurableHostActionQueue;
  private readonly github?: GitHubNavigationResolver;

  constructor(queue: DurableHostActionQueue, github?: GitHubNavigationResolver) { this.queue = queue; this.github = github; }

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    let plan: Readonly<HostActionPlan> | undefined;
    const githubPage = navigationPage(request.definition.action);
    if (githubPage) {
      if (!this.github) return { status: "unavailable", summary: "Exact GitHub navigation requires an installed authenticated GitHub route; no search URL was guessed.", effectDisposition: "not_started" };
      const resolved = await this.github.resolve(request, githubPage);
      if (resolved.kind === "picker") plan = { hostAction: "select_github_navigation", githubCandidates: resolved.candidates };
      else if (resolved.kind !== "open") return { status: resolved.kind === "blocked" ? "blocked" : resolved.kind === "unavailable" ? "unavailable" : "failed", summary: resolved.summary, effectDisposition: resolved.kind === "failed" ? "ambiguous" : "not_started" };
      else plan = { hostAction: "open_external_url", url: resolved.url };
    } else plan = hostActionPlan(request);
    if (!plan) return { status: "unavailable", summary: `No installed host action is configured for ${request.definition.title}.` };
    const intent = await this.queue.enqueue(request, plan);
    return {
      status: "running",
      summary: "The durable host action is awaiting an authenticated VS Code execution acknowledgement.",
      data: {
        hostActionId: intent.id,
        hostActionKind: intent.hostAction,
        hostActionExpiresAt: intent.expiresAt,
        ...(intent.workspaceRoot ? { hostActionWorkspaceRoot: intent.workspaceRoot } : {}),
        ...(intent.url ? { hostActionUrl: intent.url } : {}),
        ...(intent.debugConfiguration ? { hostActionDebugConfiguration: intent.debugConfiguration } : {}),
        ...(intent.debugSessionId ? { hostActionDebugSessionId: intent.debugSessionId } : {}),
        ...(intent.debugEffectSessionId ? { hostActionDebugEffectSessionId: intent.debugEffectSessionId } : {}),
        ...(intent.debugBindingId ? { hostActionDebugBindingId: intent.debugBindingId } : {}),
        ...(intent.debugOriginOperationId ? { hostActionDebugOriginOperationId: intent.debugOriginOperationId } : {}),
        ...(intent.pythonInterpreter ? { hostActionPythonInterpreter: intent.pythonInterpreter } : {}),
        ...(intent.pythonInterpreterIdentity ? { hostActionPythonInterpreterIdentity: intent.pythonInterpreterIdentity } : {}),
        ...(intent.githubCandidates ? { githubCandidates: intent.githubCandidates } : {}),
        ...(intent.managedTerminalProfile ? { managedTerminalProfile: intent.managedTerminalProfile } : {})
      }
    };
  }
}

export const hostActionCommandActions: readonly CommandAction[] = [
  "handoff_immediate", "handoff_routing_default", "blocker_queue", "done_queue",
  "focus_vscode", "new_vscode", "focus_terminal", "focus_vscode_terminal",
  "github_home", "github_pr", "github_issues", "github_actions", "compound_palette", "open_voice",
  "switch_voice_provider", "bind_voice_session", "voice_session_picker", "pipeline_failure_trace"
];

function hostActionPlan(request: AdapterRequest): Readonly<{ hostAction: LocalHostActionKind; url?: string; debugConfiguration?: string; pythonInterpreter?: string }> | undefined {
  switch (request.definition.action) {
    case "handoff_immediate": return { hostAction: "show_handoff_queue" };
    case "handoff_routing_default": return { hostAction: "toggle_handoff_routing" };
    case "blocker_queue": return { hostAction: "show_blocker_queue" };
    case "done_queue": return { hostAction: "show_done_queue" };
    case "focus_vscode": return { hostAction: "focus_vscode" };
    case "new_vscode": return { hostAction: "new_vscode_window" };
    case "focus_terminal": return { hostAction: "focus_external_terminal" };
    case "focus_vscode_terminal": return { hostAction: "focus_integrated_terminal" };
    case "github_home": return undefined;
    case "github_pr": return undefined;
    case "github_issues": return undefined;
    case "github_actions": return undefined;
    case "compound_palette": return { hostAction: "open_compound_palette" };
    case "open_voice":
    case "switch_voice_provider":
    case "bind_voice_session":
    case "voice_session_picker": return { hostAction: "show_voice_center" };
    case "pipeline_failure_trace": return { hostAction: "show_pipeline_failure_trace" };
    default: return undefined;
  }
}

function navigationPage(action: CommandAction): GitHubNavigationPage | undefined { return action === "github_home" ? "home" : action === "github_pr" ? "pr" : action === "github_issues" ? "issues" : action === "github_actions" ? "actions" : undefined; }

function boundedSummary(value: string): string {
  const summary = value.replace(/[\r\n\0]/g, " ").trim().slice(0, 512);
  if (!summary) throw new Error("A host-action acknowledgement requires a bounded summary.");
  return summary;
}

function boundedVersion(value: string): string {
  if (!/^[A-Za-z0-9_.+-]{1,80}$/.test(value)) throw new Error("The host adapter version is invalid.");
  return value;
}

function validateGitHubCandidates(value: readonly GitHubNavigationCandidate[]): readonly GitHubNavigationCandidate[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new Error("The GitHub navigation candidate set is absent or unbounded.");
  const ids = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || !/^(?:pull|run):[A-Za-z0-9._:-]{1,128}$/.test(candidate.id)
      || !candidate.label.trim() || candidate.label.length > 160 || /[\r\n\0]/.test(candidate.label)
      || !candidate.description.trim() || candidate.description.length > 512 || /[\r\n\0]/.test(candidate.description)
      || !trustedHttpsUrl(candidate.url) || ids.has(candidate.id)) throw new Error("The GitHub navigation candidate set is malformed or ambiguous.");
    ids.add(candidate.id);
    return { id: candidate.id, label: candidate.label, description: candidate.description, url: candidate.url };
  });
}

function validateManagedTerminalProfile(value: ManagedTerminalProfile, hostAction: LocalHostActionKind): ManagedTerminalProfile {
  const expectedProvider = hostAction === "create_claude_terminal" ? "claude_code" : hostAction === "create_codex_terminal" ? "codex" : undefined;
  const expectedIdentity = expectedProvider === "claude_code"
    ? { productId: "anthropic.claude-code", displayName: "Claude Code", publisher: "Anthropic, PBC", profileName: "SXSY-B122 Claude Code" }
    : expectedProvider === "codex"
      ? { productId: "openai.codex", displayName: "Codex", publisher: "OpenAI, L.L.C.", profileName: "SXSY-B122 Codex" }
      : undefined;
  if (!expectedProvider || !value || value.provider !== expectedProvider || value.shell !== false || value.requiresFinalIdentityVerification !== true
    || !/^(?:[A-Za-z]:[\\/]|\/)/.test(value.canonicalLauncherPath) || !/\.exe$/i.test(value.canonicalLauncherPath)
    || value.canonicalLauncherPath.length > 4_096 || /[\0\r\n]/.test(value.canonicalLauncherPath)
    || !/^[a-f0-9]{64}$/.test(value.launcherSha256) || value.launcherProtocolVersion !== 1
    || !/^(?:[A-Za-z]:[\\/]|\/)/.test(value.canonicalExecutablePath) || !/\.exe$/i.test(value.canonicalExecutablePath)
    || value.canonicalExecutablePath.length > 4_096 || /[\0\r\n]/.test(value.canonicalExecutablePath)
    || !/^[a-f0-9]{64}$/.test(value.executableSha256) || !/^[a-f0-9]{64}$/.test(value.catalogDigest)
    || value.signerSubject.length < 3 || value.signerSubject.length > 512 || /[\0\r\n]/.test(value.signerSubject)
    || !/^[a-f0-9]{40,128}$/.test(value.signerThumbprint)
    || !Number.isSafeInteger(value.executableSize) || value.executableSize <= 0 || value.executableSize > 2 * 1024 * 1024 * 1024
    || !Number.isFinite(value.executableModifiedMs) || value.executableModifiedMs < 0
    || !decimalIdentity(value.executableDevice)
    || !decimalIdentity(value.executableInode)
    || !value.installationId || value.installationId.length > 256 || /[\0\r\n]/.test(value.installationId)
    || !Array.isArray(value.args) || value.args.length !== 0 || !expectedIdentity
    || value.profileName !== expectedIdentity.profileName || value.productIdentity.role !== "managed_terminal"
    || value.productIdentity.productId !== expectedIdentity.productId || value.productIdentity.displayName !== expectedIdentity.displayName
    || value.productIdentity.publisher !== expectedIdentity.publisher
    || !Number.isFinite(Date.parse(value.issuedAt)) || !Number.isFinite(Date.parse(value.validUntil))
    || Date.parse(value.validUntil) <= Date.parse(value.issuedAt) || Date.parse(value.validUntil) - Date.parse(value.issuedAt) > 30_000) {
    throw new Error("The managed-terminal host action profile is malformed or substituted.");
  }
  return { ...value, args: [...value.args], productIdentity: { ...value.productIdentity } };
}

function decimalIdentity(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value)) return false;
  try { return BigInt(value) <= 0xffff_ffff_ffff_ffffn; } catch { return false; }
}

function validateRepositoryExecutableIdentity(value: RepositoryExecutableIdentity): RepositoryExecutableIdentity {
  if (!value || typeof value !== "object" || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value.canonicalPath)
    || value.canonicalPath.length > 4_096 || /[\0\r\n]/.test(value.canonicalPath)
    || !/^[a-f0-9]{64}$/.test(value.sha256) || !decimalIdentity(value.device) || !decimalIdentity(value.inode)
    || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > 2 * 1024 * 1024 * 1024
    || !Number.isFinite(value.modifiedMs) || value.modifiedMs < 0) {
    throw new Error("The protected Python interpreter identity is malformed or unbounded.");
  }
  return { canonicalPath: value.canonicalPath, sha256: value.sha256, device: value.device, inode: value.inode, size: value.size, modifiedMs: value.modifiedMs };
}

function selectGitHubCandidate(intent: HostActionIntent, selectionId: string | undefined): GitHubNavigationCandidate | undefined {
  if (intent.hostAction !== "select_github_navigation") {
    if (selectionId !== undefined) throw new Error("A host-action selection was supplied for an action that has no picker.");
    return undefined;
  }
  if (typeof selectionId !== "string") throw new Error("GitHub navigation requires one exact candidate selection before authorization.");
  const selected = validateGitHubCandidates(intent.githubCandidates ?? []).find((candidate) => candidate.id === selectionId);
  if (!selected) throw new Error("The GitHub navigation selection is not in the exact durable candidate set.");
  return selected;
}

function trustedHttpsUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && url.hash === ""; }
  catch { return false; }
}

function exactAuthorizedUrl(value: string | undefined): string {
  if (typeof value !== "string") throw new Error("An external host action requires one exact durable URL before authorization.");
  try {
    const url = new URL(value);
    if (url.username || url.password || !url.hostname || url.hash) throw new Error();
    if (url.protocol === "https:") return value;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return value;
  } catch {}
  throw new Error("The durable external host-action URL is outside the exact HTTPS or loopback boundary.");
}

function exactHostActionId(value: string): string {
  if (!/^host-action:[a-f0-9]{64}$/.test(value)) throw new Error("The host-action authorization requires an exact durable ID.");
  return value;
}

function exactClaimBinding(payload: HostActionClaimPayload): Readonly<{
  windowSessionId: string;
  workspaceRoots: readonly string[];
  adapterVersion: string;
  capabilities: readonly ExtensionClaimableHostActionKind[];
}> {
  if (!payload || payload.focused !== true) throw new Error("A host-action claim requires one explicitly focused extension window.");
  const windowSessionId = boundedReference(payload.windowSessionId, "host-action extension window session ID");
  const adapterVersion = boundedVersion(payload.adapterVersion);
  if (!Array.isArray(payload.workspaceRoots) || payload.workspaceRoots.length > 32
    || !payload.workspaceRoots.every((root) => typeof root === "string" && /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(root) && root.length <= 4_096 && !/[\r\n\0]/.test(root))
    || new Set(payload.workspaceRoots.map(normalizePath)).size !== payload.workspaceRoots.length) {
    throw new Error("The extension host-action workspace-root set is malformed or ambiguous.");
  }
  if (!Array.isArray(payload.capabilities) || payload.capabilities.length !== 1 || payload.capabilities[0] !== "show_voice_center") {
    throw new Error("The extension host-action capability set is malformed or outside the closed Voice Center boundary.");
  }
  return { windowSessionId, workspaceRoots: [...payload.workspaceRoots], adapterVersion, capabilities: ["show_voice_center"] };
}

function isExtensionClaimable(value: LocalHostActionKind): value is ExtensionClaimableHostActionKind {
  return (extensionClaimableHostActionKinds as readonly string[]).includes(value);
}

function boundedClaimToken(value: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new Error("The host-action claim token is invalid.");
  return value;
}

function claimFor(events: readonly HostActionEvent[], hostActionId: string): HostActionClaim | undefined {
  const claims = events.filter((event): event is Extract<HostActionEvent, { event: "claimed" }> => event.event === "claimed" && event.claim.hostActionId === hostActionId).map((event) => event.claim);
  if (claims.length > 1) throw new Error("The protected host-action journal contains conflicting extension claims.");
  return claims[0];
}

function assertClaimReference(
  payload: Readonly<{ claimId?: string; claimToken?: string; windowSessionId?: string; adapterVersion: string }>,
  claim: HostActionClaim | undefined,
  now?: Date
): void {
  const supplied = payload.claimId !== undefined || payload.claimToken !== undefined || payload.windowSessionId !== undefined;
  if (!claim) {
    if (supplied) throw new Error("The host-action request supplied an extension claim for an unclaimed action.");
    return;
  }
  if (!supplied || payload.claimId !== claim.claimId || payload.claimToken !== claim.claimToken
    || payload.windowSessionId !== claim.windowSessionId || boundedVersion(payload.adapterVersion) !== claim.adapterVersion) {
    throw new Error("The host-action request does not match its exact durable extension claim.");
  }
  if (now && Date.parse(claim.expiresAt) <= now.getTime()) throw new Error("The host-action extension claim lease expired; reconciliation is required and the action cannot be replayed.");
}

function pendingIntent(events: readonly HostActionEvent[], hostActionId: string, now: Date): HostActionIntent {
  const queued = events.find((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued" && event.intent.id === hostActionId)?.intent;
  if (!queued) throw new Error("The host-action authorization does not match a durable queued intent.");
  if (events.some((event): event is Extract<HostActionEvent, { event: "settled" }> => event.event === "settled" && event.record.hostActionId === hostActionId)) throw new Error("A settled host action cannot be authorized again.");
  if (events.some((event): event is Extract<HostActionEvent, { event: "cancelled" }> => event.event === "cancelled" && event.hostActionId === hostActionId)) throw new Error("A cancelled host action cannot be authorized.");
  if (Date.parse(queued.expiresAt) <= now.getTime()) throw new Error("The host-action authorization deadline elapsed before the effect.");
  return queued;
}

function sameIntent(left: HostActionIntent, right: HostActionIntent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function boundedReference(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\r\n\0]/.test(value)) throw new Error(`The ${field} is invalid.`);
  return value;
}

function boundedDebugReference(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\r\n\0]/.test(value)) throw new Error(`The ${field} is invalid.`);
  return value;
}

function safeCompletion(value: HostActionCompletionRecord, intent: HostActionIntent): HostActionCompletionRecord | undefined {
  if (!value || value.hostActionId !== intent.id || value.operationId !== intent.operationId || value.action !== intent.commandAction
    || value.targetSnapshotId !== intent.targetSnapshotId || (value.status !== "completed" && value.status !== "failed" && value.status !== "incomplete")
    || typeof value.summary !== "string" || boundedSummary(value.summary) !== value.summary
    || typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt))
    || (value.completionDigest !== undefined && !/^[a-f0-9]{64}$/.test(value.completionDigest))) return undefined;
  return {
    hostActionId: intent.id,
    operationId: intent.operationId,
    action: intent.commandAction,
    ...(intent.targetSnapshotId ? { targetSnapshotId: intent.targetSnapshotId } : {}),
    status: value.status,
    summary: value.summary,
    ...(value.completionDigest ? { completionDigest: value.completionDigest } : {}),
    completedAt: value.completedAt
  };
}

function normalizePath(value: string): string {
  const bounded = boundedReference(value, "host-action repository root").replaceAll("\\", "/").replace(/\/+$/, "");
  if (!/^(?:[A-Za-z]:\/|\/|\/\/)/.test(bounded)) throw new Error("The host-action repository root must be absolute.");
  return process.platform === "win32" ? bounded.toLowerCase() : bounded;
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
