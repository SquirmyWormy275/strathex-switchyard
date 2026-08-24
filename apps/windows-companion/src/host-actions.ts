import { createHash } from "node:crypto";

import type { AdapterOutcome, AdapterRequest, CommandAdapter } from "../../../packages/control-plane/src/adapters.ts";
import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { HostActionCompletionPayload } from "./bridge.ts";
import type { HostActionCompletionRecord, HostActionCoordinator } from "./service.ts";

export const localHostActionKinds = [
  "show_handoff_queue", "toggle_handoff_routing", "show_blocker_queue", "show_done_queue",
  "open_external_url", "create_claude_terminal", "create_codex_terminal", "focus_vscode",
  "new_vscode_window", "focus_external_terminal", "focus_integrated_terminal", "open_compound_palette",
  "switch_voice_provider", "show_voice_session_picker", "show_pipeline_failure_trace", "start_vscode_debug", "configure_python_venv"
] as const;

export type LocalHostActionKind = (typeof localHostActionKinds)[number];

export interface HostActionIntent {
  readonly version: 1;
  readonly id: string;
  readonly operationId: string;
  readonly commandAction: CommandAction;
  readonly hostAction: LocalHostActionKind;
  readonly targetSnapshotId?: string;
  readonly workspaceRoot?: string;
  readonly url?: string;
  readonly debugConfiguration?: string;
  readonly pythonInterpreter?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

type HostActionEvent =
  | { readonly version: 1; readonly event: "queued"; readonly intent: HostActionIntent }
  | { readonly version: 1; readonly event: "settled"; readonly record: HostActionCompletionRecord }
  | { readonly version: 1; readonly event: "cancelled"; readonly hostActionId: string; readonly operationId: string; readonly reason: string; readonly at: string };

export interface DurableHostActionQueueOptions {
  readonly now?: () => Date;
  readonly lifetimeMs?: number;
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

  constructor(store: ProtectedJsonStore, options: DurableHostActionQueueOptions = {}) {
    this.store = store;
    this.now = options.now ?? (() => new Date());
    this.lifetimeMs = options.lifetimeMs ?? 30_000;
    if (!Number.isSafeInteger(this.lifetimeMs) || this.lifetimeMs < 1_000 || this.lifetimeMs > 5 * 60_000) {
      throw new Error("The host-action acknowledgement lifetime is outside safe bounds.");
    }
  }

  async enqueue(request: AdapterRequest, plan: Readonly<{ hostAction: LocalHostActionKind; url?: string; debugConfiguration?: string; pythonInterpreter?: string }>): Promise<HostActionIntent> {
    if (!request.operationId) throw new Error("A durable operation ID is required before a host action can be queued.");
    const now = this.now();
    const intent: HostActionIntent = {
      version: 1,
      id: `host-action:${digest(`${request.operationId}:${request.definition.action}`)}`,
      operationId: request.operationId,
      commandAction: request.definition.action,
      hostAction: plan.hostAction,
      ...(request.target ? { targetSnapshotId: request.target.id } : {}),
      ...(request.target ? { workspaceRoot: request.target.repositoryRoot } : {}),
      ...(plan.url ? { url: plan.url } : {}),
      ...(plan.debugConfiguration ? { debugConfiguration: plan.debugConfiguration } : {}),
      ...(plan.pythonInterpreter ? { pythonInterpreter: plan.pythonInterpreter } : {}),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.lifetimeMs).toISOString()
    };
    return this.store.transaction(async (transaction) => {
      const events = (await transaction.readEntries<HostActionEvent>()).filter((entry) => entry.kind === "host_action").map((entry) => entry.payload);
      const existing = events.find((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued" && event.intent.id === intent.id)?.intent;
      if (existing) {
        if (existing.operationId !== intent.operationId || existing.commandAction !== intent.commandAction || existing.hostAction !== intent.hostAction
          || existing.targetSnapshotId !== intent.targetSnapshotId || existing.workspaceRoot !== intent.workspaceRoot
          || existing.url !== intent.url || existing.debugConfiguration !== intent.debugConfiguration || existing.pythonInterpreter !== intent.pythonInterpreter) {
          throw new Error("The durable host-action ID is already bound to different intent data.");
        }
        return existing;
      }
      await transaction.append<HostActionEvent>("host_action", { version: 1, event: "queued", intent });
      return intent;
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
      const priorEvent = events.find((event): event is Extract<HostActionEvent, { event: "settled" }> => event.event === "settled" && event.record.hostActionId === payload.hostActionId)?.record;
      const prior = priorEvent ? safeCompletion(priorEvent, queued) : undefined;
      if (priorEvent && !prior) throw new Error("The protected host-action completion does not match its exact durable intent.");
      const expired = Date.parse(queued.expiresAt) <= this.now().getTime();
      const record: HostActionCompletionRecord = {
        hostActionId: queued.id,
        operationId: queued.operationId,
        action: queued.commandAction,
        ...(queued.targetSnapshotId ? { targetSnapshotId: queued.targetSnapshotId } : {}),
        status: expired ? "failed" : payload.succeeded ? "completed" : "failed",
        summary: expired ? "The authenticated host acknowledgement arrived after the bounded action deadline." : boundedSummary(payload.summary),
        completionDigest: digest(JSON.stringify({ id: queued.id, action: queued.commandAction, succeeded: !expired && payload.succeeded, adapterVersion: boundedVersion(payload.adapterVersion) })),
        completedAt: this.now().toISOString()
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
      const pending = events.filter((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued"
        && event.intent.operationId === exactOperation && !settled.has(event.intent.id) && !cancelled.has(event.intent.id));
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
      const pending = events.filter((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued"
        && event.intent.workspaceRoot !== undefined && normalizePath(event.intent.workspaceRoot) === exactRoot
        && !settled.has(event.intent.id) && !cancelled.has(event.intent.id));
      for (const event of pending) await transaction.append<HostActionEvent>("host_action", {
        version: 1, event: "cancelled", hostActionId: event.intent.id, operationId: event.intent.operationId, reason: exactReason, at: this.now().toISOString()
      });
      return pending.length;
    });
  }

  /** Read-only observation used by startup reconciliation; it never executes an intent. */
  async observeOperation(operationId: string, action?: string): Promise<Readonly<{ outcome: "committed" | "failed" | "cancelled" | "unresolved"; note: string }>> {
    const exactOperation = boundedReference(operationId, "host-action operation ID");
    const exactAction = action === undefined ? undefined : boundedReference(action, "host-action command action");
    const events = (await this.store.readEntries<HostActionEvent>()).filter((entry) => entry.kind === "host_action").map((entry) => entry.payload);
    const queued = events.find((event): event is Extract<HostActionEvent, { event: "queued" }> => event.event === "queued"
      && event.intent.operationId === exactOperation && (exactAction === undefined || event.intent.commandAction === exactAction))?.intent;
    if (!queued) return { outcome: "unresolved", note: "No exact durable host-action intent was observed; nothing was replayed." };
    const completedEvent = events.find((event): event is Extract<HostActionEvent, { event: "settled" }> => event.event === "settled" && event.record.hostActionId === queued.id)?.record;
    const completed = completedEvent ? safeCompletion(completedEvent, queued) : undefined;
    if (completed) return completed.status === "completed"
      ? { outcome: "committed", note: "The authenticated host completion is durable for the exact operation." }
      : { outcome: "failed", note: "The authenticated host reported failure for the exact operation." };
    if (events.some((event): event is Extract<HostActionEvent, { event: "cancelled" }> => event.event === "cancelled" && event.hostActionId === queued.id)) {
      return { outcome: "cancelled", note: "The exact durable host action was cancelled before authenticated completion." };
    }
    return { outcome: "unresolved", note: "The exact durable host action remains queued; no host effect was inferred or replayed." };
  }
}

export class DurableHostActionAdapter implements CommandAdapter {
  readonly id = "durable-vscode-host-actions";
  readonly kind = "vscode" as const;
  private readonly queue: DurableHostActionQueue;

  constructor(queue: DurableHostActionQueue) { this.queue = queue; }

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    const plan = hostActionPlan(request);
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
        ...(intent.pythonInterpreter ? { hostActionPythonInterpreter: intent.pythonInterpreter } : {})
      }
    };
  }
}

export const hostActionCommandActions: readonly CommandAction[] = [
  "handoff_immediate", "handoff_routing_default", "blocker_queue", "done_queue",
  "open_claude", "fresh_claude", "open_managed_claude_terminal", "open_chatgpt", "fresh_chatgpt",
  "open_managed_codex_terminal", "focus_vscode", "new_vscode", "focus_terminal", "focus_vscode_terminal",
  "github_home", "github_pr", "github_issues", "github_actions", "compound_palette", "open_voice",
  "switch_voice_provider", "voice_session_picker", "pipeline_failure_trace"
];

function hostActionPlan(request: AdapterRequest): Readonly<{ hostAction: LocalHostActionKind; url?: string; debugConfiguration?: string; pythonInterpreter?: string }> | undefined {
  switch (request.definition.action) {
    case "handoff_immediate": return { hostAction: "show_handoff_queue" };
    case "handoff_routing_default": return { hostAction: "toggle_handoff_routing" };
    case "blocker_queue": return { hostAction: "show_blocker_queue" };
    case "done_queue": return { hostAction: "show_done_queue" };
    case "open_claude":
    case "fresh_claude": return { hostAction: "open_external_url", url: "https://claude.ai/new" };
    case "open_managed_claude_terminal": return { hostAction: "create_claude_terminal" };
    case "open_chatgpt":
    case "fresh_chatgpt": return { hostAction: "open_external_url", url: "https://chatgpt.com/" };
    case "open_managed_codex_terminal": return { hostAction: "create_codex_terminal" };
    case "focus_vscode": return { hostAction: "focus_vscode" };
    case "new_vscode": return { hostAction: "new_vscode_window" };
    case "focus_terminal": return { hostAction: "focus_external_terminal" };
    case "focus_vscode_terminal": return { hostAction: "focus_integrated_terminal" };
    case "github_home": return githubPlan(request, "home");
    case "github_pr": return githubPlan(request, "pr");
    case "github_issues": return githubPlan(request, "issues");
    case "github_actions": return githubPlan(request, "actions");
    case "compound_palette": return { hostAction: "open_compound_palette" };
    case "open_voice": return { hostAction: "open_external_url", url: "https://chatgpt.com/" };
    case "switch_voice_provider": return { hostAction: "switch_voice_provider" };
    case "voice_session_picker": return { hostAction: "show_voice_session_picker" };
    case "pipeline_failure_trace": return { hostAction: "show_pipeline_failure_trace" };
    default: return undefined;
  }
}

function githubPlan(request: AdapterRequest, page: "home" | "pr" | "issues" | "actions"): Readonly<{ hostAction: "open_external_url"; url: string }> | undefined {
  const repository = githubRepository(request.target?.canonicalRemote);
  if (!repository) return undefined;
  const base = `https://github.com/${repository.owner}/${repository.name}`;
  if (page === "home") return { hostAction: "open_external_url", url: base };
  if (page === "issues") return { hostAction: "open_external_url", url: `${base}/issues` };
  const branch = request.target?.branch;
  if (!branch) return undefined;
  return page === "pr"
    ? { hostAction: "open_external_url", url: `${base}/pulls?q=is%3Apr+is%3Aopen+head%3A${encodeURIComponent(branch)}` }
    : { hostAction: "open_external_url", url: `${base}/actions?query=branch%3A${encodeURIComponent(branch)}` };
}

function githubRepository(remote: string | undefined): Readonly<{ owner: string; name: string }> | undefined {
  if (!remote || /[\r\n\0]/.test(remote)) return undefined;
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote);
  return match ? { owner: match[1]!, name: match[2]! } : undefined;
}

function boundedSummary(value: string): string {
  const summary = value.replace(/[\r\n\0]/g, " ").trim().slice(0, 512);
  if (!summary) throw new Error("A host-action acknowledgement requires a bounded summary.");
  return summary;
}

function boundedVersion(value: string): string {
  if (!/^[A-Za-z0-9_.+-]{1,80}$/.test(value)) throw new Error("The host adapter version is invalid.");
  return value;
}

function boundedReference(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\r\n\0]/.test(value)) throw new Error(`The ${field} is invalid.`);
  return value;
}

function safeCompletion(value: HostActionCompletionRecord, intent: HostActionIntent): HostActionCompletionRecord | undefined {
  if (!value || value.hostActionId !== intent.id || value.operationId !== intent.operationId || value.action !== intent.commandAction
    || value.targetSnapshotId !== intent.targetSnapshotId || (value.status !== "completed" && value.status !== "failed")
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
