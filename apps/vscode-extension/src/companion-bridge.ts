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
  | "switch_voice_provider" | "show_voice_session_picker" | "show_pipeline_failure_trace" | "start_vscode_debug" | "configure_python_venv";

export interface ForwardedHostAction {
  readonly id: string;
  readonly kind: LocalHostAction;
  readonly expiresAt: string;
  readonly url?: string;
  readonly workspaceRoot?: string;
  readonly debugConfiguration?: string;
  readonly pythonInterpreter?: string;
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
  | { readonly kind: "local_commit"; readonly paths: readonly string[]; readonly message: string; readonly featureBranch?: string }
  | { readonly kind: "pr_upsert"; readonly headBranch: string; readonly baseBranch: string; readonly title: string; readonly body: string }
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

export interface RepositoryRuntimePin {
  readonly canonicalRepositoryRoot: string;
  readonly manifestPath: string;
  readonly expectedSha256: string;
  readonly installedAt: string;
  readonly status: "active" | "revoked";
}

export interface SandboxInstallationPin {
  readonly canonicalRepositoryRoot: string;
  readonly catalogPath: string;
  readonly catalogSha256: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly installedAt: string;
  readonly status: "active" | "revoked";
}

export interface CredentialReferenceSummary { readonly reference: string; readonly protectorProvider: string; readonly generation: number; readonly createdAt: string; readonly updatedAt: string; readonly scopes: readonly { readonly repositoryRoot: string; readonly adapterId: string; readonly purpose: string }[]; readonly revokedAt?: string; }
export interface InstalledNetworkPolicy { readonly filePath: string; readonly sha256: string; readonly installedAt: string; readonly status: "active" | "revoked"; }

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
  installRuntimePin(repositoryRoot: string, manifestPath: string): Promise<BridgeResult<RepositoryRuntimePin>>;
  listRuntimePins(): Promise<BridgeResult<readonly RepositoryRuntimePin[]>>;
  revokeRuntimePin(repositoryRoot: string): Promise<BridgeResult<RepositoryRuntimePin>>;
  installSandbox(repositoryRoot: string, catalogPath: string): Promise<BridgeResult<SandboxInstallationPin>>;
  listSandboxes(): Promise<BridgeResult<readonly SandboxInstallationPin[]>>;
  revokeSandbox(repositoryRoot: string): Promise<BridgeResult<SandboxInstallationPin>>;
  provisionCredential(input: Readonly<{ reference: string; repositoryRoot: string; purposes: readonly string[]; sealedSecret: string; replaceExisting?: boolean }>): Promise<BridgeResult<CredentialReferenceSummary>>;
  listCredentials(): Promise<BridgeResult<readonly CredentialReferenceSummary[]>>;
  revokeCredential(reference: string, reason: string): Promise<BridgeResult<boolean>>;
  installNetworkPolicy(sourcePath: string): Promise<BridgeResult<InstalledNetworkPolicy>>;
  currentNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy | undefined>>;
  revokeNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy>>;
  providerHandshake(sessionId: string, repositoryRoot: string): Promise<BridgeResult<ExtensionManagedSession>>;
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

  async installRuntimePin(repositoryRoot: string, manifestPath: string): Promise<BridgeResult<RepositoryRuntimePin>> {
    const result = await this.call<{ pin: RepositoryRuntimePin }>("runtime.pin.install", { repositoryRoot, manifestPath });
    return result.ok ? { ok: true, value: result.value.pin } : result;
  }

  async listRuntimePins(): Promise<BridgeResult<readonly RepositoryRuntimePin[]>> {
    const result = await this.call<{ pins: readonly RepositoryRuntimePin[] }>("runtime.pin.list", undefined);
    return result.ok ? { ok: true, value: result.value.pins } : result;
  }

  async revokeRuntimePin(repositoryRoot: string): Promise<BridgeResult<RepositoryRuntimePin>> {
    const result = await this.call<{ pin: RepositoryRuntimePin }>("runtime.pin.revoke", { repositoryRoot });
    return result.ok ? { ok: true, value: result.value.pin } : result;
  }

  async installSandbox(repositoryRoot: string, catalogPath: string): Promise<BridgeResult<SandboxInstallationPin>> {
    const result = await this.call<{ installation: SandboxInstallationPin }>("sandbox.install", { repositoryRoot, catalogPath });
    return result.ok ? { ok: true, value: result.value.installation } : result;
  }

  async listSandboxes(): Promise<BridgeResult<readonly SandboxInstallationPin[]>> {
    const result = await this.call<{ installations: readonly SandboxInstallationPin[] }>("sandbox.list", undefined);
    return result.ok ? { ok: true, value: result.value.installations } : result;
  }

  async revokeSandbox(repositoryRoot: string): Promise<BridgeResult<SandboxInstallationPin>> {
    const result = await this.call<{ installation: SandboxInstallationPin }>("sandbox.revoke", { repositoryRoot });
    return result.ok ? { ok: true, value: result.value.installation } : result;
  }

  async provisionCredential(input: Readonly<{ reference: string; repositoryRoot: string; purposes: readonly string[]; sealedSecret: string; replaceExisting?: boolean }>): Promise<BridgeResult<CredentialReferenceSummary>> { const result = await this.call<{ credential: CredentialReferenceSummary }>("credential.provision", input); return result.ok ? { ok: true, value: result.value.credential } : result; }
  async listCredentials(): Promise<BridgeResult<readonly CredentialReferenceSummary[]>> { const result = await this.call<{ credentials: readonly CredentialReferenceSummary[] }>("credential.list", undefined); return result.ok ? { ok: true, value: result.value.credentials } : result; }
  async revokeCredential(reference: string, reason: string): Promise<BridgeResult<boolean>> { const result = await this.call<{ revoked: boolean }>("credential.revoke", { reference, reason }); return result.ok ? { ok: true, value: result.value.revoked } : result; }
  async installNetworkPolicy(sourcePath: string): Promise<BridgeResult<InstalledNetworkPolicy>> { const result = await this.call<{ policy: InstalledNetworkPolicy }>("network-policy.install", { sourcePath }); return result.ok ? { ok: true, value: result.value.policy } : result; }
  async currentNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy | undefined>> { const result = await this.call<{ policy?: InstalledNetworkPolicy }>("network-policy.current", undefined); return result.ok ? { ok: true, value: result.value.policy } : result; }
  async revokeNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy>> { const result = await this.call<{ policy: InstalledNetworkPolicy }>("network-policy.revoke", undefined); return result.ok ? { ok: true, value: result.value.policy } : result; }
  providerHandshake(sessionId: string, repositoryRoot: string): Promise<BridgeResult<ExtensionManagedSession>> { return this.call("provider.handshake", { sessionId, repositoryRoot }); }

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
  installRuntimePin(): Promise<BridgeResult<RepositoryRuntimePin>> { return this.unavailable(); }
  listRuntimePins(): Promise<BridgeResult<readonly RepositoryRuntimePin[]>> { return this.unavailable(); }
  revokeRuntimePin(): Promise<BridgeResult<RepositoryRuntimePin>> { return this.unavailable(); }
  installSandbox(): Promise<BridgeResult<SandboxInstallationPin>> { return this.unavailable(); }
  listSandboxes(): Promise<BridgeResult<readonly SandboxInstallationPin[]>> { return this.unavailable(); }
  revokeSandbox(): Promise<BridgeResult<SandboxInstallationPin>> { return this.unavailable(); }
  provisionCredential(): Promise<BridgeResult<CredentialReferenceSummary>> { return this.unavailable(); }
  listCredentials(): Promise<BridgeResult<readonly CredentialReferenceSummary[]>> { return this.unavailable(); }
  revokeCredential(): Promise<BridgeResult<boolean>> { return this.unavailable(); }
  installNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy>> { return this.unavailable(); }
  currentNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy | undefined>> { return this.unavailable(); }
  revokeNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy>> { return this.unavailable(); }
  providerHandshake(): Promise<BridgeResult<ExtensionManagedSession>> { return this.unavailable(); }
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
  const workspaceRoot = result.data?.hostActionWorkspaceRoot;
  const debugConfiguration = result.data?.hostActionDebugConfiguration;
  const pythonInterpreter = result.data?.hostActionPythonInterpreter;
  if (typeof id !== "string" || !/^host-action:[a-f0-9]{64}$/.test(id)
    || typeof kind !== "string" || !isLocalHostAction(kind)
    || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))
    || (url !== undefined && typeof url !== "string")
    || (workspaceRoot !== undefined && (typeof workspaceRoot !== "string" || workspaceRoot.length > 4_096 || /[\r\n\0]/.test(workspaceRoot)))
    || (debugConfiguration !== undefined && (typeof debugConfiguration !== "string" || !debugConfiguration.trim() || debugConfiguration.length > 256 || /[\r\n\0]/.test(debugConfiguration)))
    || (pythonInterpreter !== undefined && (typeof pythonInterpreter !== "string" || pythonInterpreter.length > 4_096 || /[\r\n\0]/.test(pythonInterpreter)))) return undefined;
  return { id, kind, expiresAt, ...(typeof url === "string" ? { url } : {}), ...(typeof workspaceRoot === "string" ? { workspaceRoot } : {}), ...(typeof debugConfiguration === "string" ? { debugConfiguration } : {}), ...(typeof pythonInterpreter === "string" ? { pythonInterpreter } : {}) };
}

function isLocalHostAction(value: string): value is LocalHostAction {
  return [
    "show_handoff_queue", "toggle_handoff_routing", "show_blocker_queue", "show_done_queue",
    "open_external_url", "create_claude_terminal", "create_codex_terminal", "focus_vscode",
    "new_vscode_window", "focus_external_terminal", "focus_integrated_terminal", "open_compound_palette",
    "switch_voice_provider", "show_voice_session_picker", "show_pipeline_failure_trace", "start_vscode_debug", "configure_python_venv"
  ].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
