import type { B122Control, B122Modifier } from "./commands.ts";

export type ExtensionCapability = "registered" | "observable" | "controllable" | "mediated";
export type ExtensionSessionStatus = "running" | "verified_blocked" | "verified_finished" | "unreachable" | "stale" | "unknown";
export type ExtensionProvider = "claude" | "codex" | "generic" | "voice";
export type ExtensionSurface = "vscode_terminal" | "vscode_window" | "desktop" | "browser" | "bridge";
export type CommandStatus = "queued" | "running" | "awaiting_input" | "awaiting_confirmation" | "cancelling" | "completed" | "failed" | "timed_out" | "unavailable" | "incomplete" | "blocked" | "cancelled";

export interface ExtensionManagedSession {
  readonly id: string;
  readonly provider: ExtensionProvider;
  readonly surface: ExtensionSurface;
  readonly capabilities: readonly ExtensionCapability[];
  readonly status: ExtensionSessionStatus;
  readonly workspaceRoot?: string;
  readonly targetSnapshotId?: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  readonly plannedFiles: readonly string[];
  readonly lastHeartbeat: string;
  readonly adapterVersion: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ForwardedCommand {
  readonly control: B122Control;
  readonly modifier: B122Modifier;
  readonly sessionId?: string;
  readonly authorityId?: string;
  readonly confirmationToken?: string;
  readonly input?: Readonly<Record<string, string>>;
}

export interface ForwardedCommandResult {
  readonly status: CommandStatus;
  readonly summary: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export type LocalHostAction =
  | "show_handoff_queue" | "toggle_handoff_routing" | "show_blocker_queue" | "show_done_queue"
  | "open_external_url" | "create_claude_terminal" | "create_codex_terminal" | "focus_vscode"
  | "new_vscode_window" | "focus_external_terminal" | "focus_integrated_terminal" | "open_compound_palette"
  | "switch_voice_provider" | "show_voice_session_picker" | "show_pipeline_failure_trace";

export interface ForwardedHostAction {
  readonly id: string;
  readonly kind: LocalHostAction;
  readonly expiresAt: string;
  readonly url?: string;
}

export interface PreparedCommand {
  readonly status: "prepared" | "blocked" | "unavailable" | "incomplete";
  readonly summary: string;
  readonly session?: ExtensionManagedSession;
  readonly authorityId?: string;
  readonly confirmationToken?: string;
  readonly confirmationExpiresAt?: string;
}

export type ReviewedGitMutation =
  | { readonly kind: "local_commit"; readonly paths: readonly string[]; readonly message: string }
  | { readonly kind: "pr_upsert"; readonly headBranch: string; readonly baseBranch: string }
  | { readonly kind: "merge_pr"; readonly pullRequest: number; readonly head: string; readonly baseBranch: string }
  | { readonly kind: "direct_main"; readonly branch: string; readonly validationReceiptId: string };

export interface GitReviewResult {
  readonly status: "approved" | "blocked" | "unavailable";
  readonly summary: string;
  readonly reviewId?: string;
  readonly targetSnapshotId?: string;
  readonly expiresAt?: string;
  readonly session?: ExtensionManagedSession;
}

export type BridgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface ExtensionCompanionBridge {
  health(): Promise<BridgeResult<Readonly<{ status?: string }>>>;
  registerSession(session: ExtensionManagedSession, kind?: "session" | "terminal" | "debug"): Promise<BridgeResult<ExtensionManagedSession>>;
  adoptTerminal(sessionId: string, adoptionKey: string, provider: Exclude<ExtensionProvider, "voice">): Promise<BridgeResult<ExtensionManagedSession>>;
  updateStatus(sessionId: string, status: ExtensionSessionStatus): Promise<BridgeResult<ExtensionManagedSession>>;
  heartbeat(sessionId: string, at?: string): Promise<BridgeResult<ExtensionManagedSession>>;
  prepareCommand(command: Readonly<{ control: B122Control; modifier: B122Modifier; sessionId?: string; reason: string }>): Promise<BridgeResult<PreparedCommand>>;
  reviewGitMutation(request: Readonly<{ action: "local_commit" | "pr_upsert" | "pr_merge" | "direct_main"; sessionId: string; mutation: ReviewedGitMutation }>): Promise<BridgeResult<GitReviewResult>>;
  dispatch(command: ForwardedCommand): Promise<BridgeResult<ForwardedCommandResult>>;
  completeHostAction(hostActionId: string, succeeded: boolean, summary: string, adapterVersion: string): Promise<BridgeResult<ForwardedCommandResult>>;
}

/** A line round-trip owned by a deliberately started local companion process. */
export interface JsonLineTransport {
  request(line: string): Promise<string>;
}

/**
 * Concrete protocol client for the companion's JSON-lines stdio service. It
 * does not spawn a program or run a shell command; deployment supplies a
 * reviewed, local-only transport and the extension fails closed if absent.
 */
export class JsonLineCompanionBridge implements ExtensionCompanionBridge {
  private sequence = 0;
  private readonly transport: JsonLineTransport;
  private readonly idPrefix: string;

  constructor(transport: JsonLineTransport, idPrefix = "vscode") {
    this.transport = transport;
    this.idPrefix = idPrefix;
  }

  health(): Promise<BridgeResult<Readonly<{ status?: string }>>> { return this.call("ping", undefined); }

  registerSession(session: ExtensionManagedSession, kind: "session" | "terminal" | "debug" = "session"): Promise<BridgeResult<ExtensionManagedSession>> {
    const method = kind === "terminal" ? "terminal.register" : kind === "debug" ? "debug.register" : "session.register";
    return this.call(method, { session });
  }

  adoptTerminal(sessionId: string, adoptionKey: string, provider: Exclude<ExtensionProvider, "voice">): Promise<BridgeResult<ExtensionManagedSession>> {
    return this.call("terminal.adopt", { sessionId, adoptionKey, provider });
  }

  updateStatus(sessionId: string, status: ExtensionSessionStatus): Promise<BridgeResult<ExtensionManagedSession>> {
    return this.call("session.status", { sessionId, status });
  }

  heartbeat(sessionId: string, at?: string): Promise<BridgeResult<ExtensionManagedSession>> {
    return this.call("session.heartbeat", at ? { sessionId, at } : { sessionId });
  }

  async dispatch(command: ForwardedCommand): Promise<BridgeResult<ForwardedCommandResult>> {
    const result = await this.call<{ command: ForwardedCommandResult }>("command.dispatch", command);
    return result.ok ? { ok: true, value: result.value.command } : result;
  }

  async prepareCommand(command: Readonly<{ control: B122Control; modifier: B122Modifier; sessionId?: string; reason: string }>): Promise<BridgeResult<PreparedCommand>> {
    const result = await this.call<{ preparation: PreparedCommand }>("command.prepare", command);
    return result.ok ? { ok: true, value: result.value.preparation } : result;
  }

  async reviewGitMutation(request: Readonly<{ action: "local_commit" | "pr_upsert" | "pr_merge" | "direct_main"; sessionId: string; mutation: ReviewedGitMutation }>): Promise<BridgeResult<GitReviewResult>> {
    const result = await this.call<{ review: GitReviewResult }>("git.review.submit", request);
    return result.ok ? { ok: true, value: result.value.review } : result;
  }

  async completeHostAction(hostActionId: string, succeeded: boolean, summary: string, adapterVersion: string): Promise<BridgeResult<ForwardedCommandResult>> {
    const result = await this.call<{ command: ForwardedCommandResult }>("host-action.complete", { hostActionId, succeeded, summary, adapterVersion });
    return result.ok ? { ok: true, value: result.value.command } : result;
  }

  private async call<T>(method: string, payload: unknown): Promise<BridgeResult<T>> {
    const id = `${this.idPrefix}-${++this.sequence}`;
    let line: string;
    try {
      line = await this.transport.request(JSON.stringify({ version: 1, id, method, payload }));
    } catch {
      return { ok: false, code: "companion_unavailable", message: "The local SXSY-B122 companion transport is unavailable." };
    }

    let response: unknown;
    try {
      response = JSON.parse(line) as unknown;
    } catch {
      return { ok: false, code: "invalid_response", message: "The local companion returned malformed JSON." };
    }
    if (!isRecord(response) || response.version !== 1 || response.id !== id || typeof response.ok !== "boolean") {
      return { ok: false, code: "invalid_response", message: "The local companion returned an invalid or mismatched response." };
    }
    if (!response.ok) {
      const error = isRecord(response.error) ? response.error : undefined;
      return {
        ok: false,
        code: error && typeof error.code === "string" ? error.code : "companion_error",
        message: error && typeof error.message === "string" ? error.message : "The local companion rejected the request."
      };
    }
    return { ok: true, value: response.result as T };
  }
}

/**
 * Default extension behavior. A missing companion must be visible to the
 * operator; it is never treated as a local execution approval.
 */
export class UnavailableExtensionCompanionBridge implements ExtensionCompanionBridge {
  private readonly reason: string;

  constructor(reason = "The local SXSY-B122 companion is not connected.") {
    this.reason = reason;
  }

  health(): Promise<BridgeResult<Readonly<{ status?: string }>>> { return this.unavailable(); }
  registerSession(): Promise<BridgeResult<ExtensionManagedSession>> { return this.unavailable(); }
  adoptTerminal(): Promise<BridgeResult<ExtensionManagedSession>> { return this.unavailable(); }
  updateStatus(): Promise<BridgeResult<ExtensionManagedSession>> { return this.unavailable(); }
  heartbeat(): Promise<BridgeResult<ExtensionManagedSession>> { return this.unavailable(); }
  prepareCommand(): Promise<BridgeResult<PreparedCommand>> { return this.unavailable(); }
  reviewGitMutation(): Promise<BridgeResult<GitReviewResult>> { return this.unavailable(); }
  dispatch(): Promise<BridgeResult<ForwardedCommandResult>> { return this.unavailable(); }
  completeHostAction(): Promise<BridgeResult<ForwardedCommandResult>> { return this.unavailable(); }

  private async unavailable<T>(): Promise<BridgeResult<T>> {
    return { ok: false, code: "companion_unavailable", message: this.reason };
  }
}

export function localHostAction(result: ForwardedCommandResult): LocalHostAction | undefined {
  return forwardedHostAction(result)?.kind;
}

export function forwardedHostAction(result: ForwardedCommandResult): ForwardedHostAction | undefined {
  const id = result.data?.hostActionId;
  const kind = result.data?.hostActionKind;
  const expiresAt = result.data?.hostActionExpiresAt;
  const url = result.data?.hostActionUrl;
  if (typeof id !== "string" || !/^host-action:[a-f0-9]{64}$/.test(id)
    || typeof kind !== "string" || !isLocalHostAction(kind)
    || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))
    || (url !== undefined && typeof url !== "string")) return undefined;
  return { id, kind, expiresAt, ...(typeof url === "string" ? { url } : {}) };
}

function isLocalHostAction(value: string): value is LocalHostAction {
  return [
    "show_handoff_queue", "toggle_handoff_routing", "show_blocker_queue", "show_done_queue",
    "open_external_url", "create_claude_terminal", "create_codex_terminal", "focus_vscode",
    "new_vscode_window", "focus_external_terminal", "focus_integrated_terminal", "open_compound_palette",
    "switch_voice_provider", "show_voice_session_picker", "show_pipeline_failure_trace"
  ].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
