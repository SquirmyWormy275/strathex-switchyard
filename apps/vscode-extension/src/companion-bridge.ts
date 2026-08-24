import { chordFor, type B122Control, type B122Modifier } from "./commands.ts";

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

export interface ForwardedHostActionAuthorization {
  readonly hostActionId: string;
  readonly authorizationToken: string;
  readonly expiresAt: string;
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

export interface GitReviewWorkspace {
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly branch?: string;
  readonly defaultBranch?: string;
  readonly detached: boolean;
  readonly changedPaths: readonly string[];
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
export interface RawHidDeviceIdentity { readonly vendorId: number; readonly productId: number; readonly usagePage: number; readonly usage: number; readonly serialNumber?: string; }
export interface RawHidInstallationPin { readonly identity: RawHidDeviceIdentity; readonly helperPath: string; readonly helperSha256: string; readonly protocolVersion: number; readonly mapFingerprint: string; readonly installedAt: string; readonly status: "active" | "revoked"; }
export interface RawHidRuntimeStatus { readonly supervisor: { readonly state: "unprovisioned" | "starting" | "running" | "retrying" | "stopped" | "unavailable"; readonly generation: number; readonly detail: string }; readonly inbox: { readonly pending: number; readonly claimed: number; readonly completed: number; readonly needsReconciliation: number }; readonly installations: readonly RawHidInstallationPin[]; }
export interface HardwareSignalClaim { readonly signalId: string; readonly claimToken: string; readonly deviceId: string; readonly connectionEpoch: number; readonly bootNonce: number; readonly counter: number; readonly control: B122Control; readonly modifier: B122Modifier; readonly acceptedAt: string; readonly claimedAt: string; readonly attempt: number; readonly windowSessionId: string; readonly workspaceRoots: readonly string[]; }
export interface HardwareSignalDispatchResult { readonly command: ForwardedCommandResult; readonly dispatchReceiptId: string; }
export interface HardwareSignalPreparationResult { readonly preparation: PreparedCommand; readonly dispositionReceiptId?: string; }
export interface HardwareSignalCompletionResult { readonly signalId: string; readonly outcome: "handled" | "failed_before_dispatch" | "needs_reconciliation"; }
export interface ExtensionHandoffPackage { readonly id: string; readonly digest: string; readonly repositoryRoot: string; readonly targetSnapshotId: string; readonly taskId: string; readonly planRevision: string; readonly recipientSessionId?: string; readonly status: "queued" | "immediate_focus_requested" | "acknowledged" | "cancelled" | "archived"; readonly executionAuthorized: false; }
export type ExtensionWorkflowAction = "reanchor" | "proof" | "proof_adversarial" | "option_provider" | "option_packet" | "plan_expander" | "plan_approval" | "handoff" | "handoff_queue" | "handoff_immediate" | "focus_blocked_agent" | "focus_finished_agent" | "authority_refresh" | "authority_broadcast" | "bind_voice_session";
export type ExtensionWorkflowPreparationIntent =
  | { readonly kind: "none" }
  | { readonly kind: "decision"; readonly question: string; readonly context: string }
  | { readonly kind: "handoff"; readonly recipientSessionId: string; readonly route: "queue" | "immediate" }
  | { readonly kind: "authority_broadcast"; readonly recipientSessionIds: readonly string[] }
  | { readonly kind: "plan_approval"; readonly confirmationToken: string };
export interface ExtensionWorkflowArtifact { readonly id: string; readonly digest: string; readonly action: ExtensionWorkflowAction; readonly targetSnapshotId: string; readonly sessionId: string; readonly payload: Readonly<Record<string, unknown>>; readonly status: "prepared" | "submitted" | "cancelling" | "acknowledged" | "rejected" | "cancelled"; readonly executionAuthorized: false; }
export type ExtensionVoiceProvider = "claude" | "chatgpt" | "system";
export interface ExtensionVoiceConsent { readonly id: string; readonly contextPackageId: string; readonly contextDigest: string; readonly provider: ExtensionVoiceProvider; readonly transcript: "off" | "redacted"; readonly retentionMinutes: number; readonly expiresAt: string; }
export interface ExtensionVoiceBinding { readonly id: string; readonly consentId: string; readonly voiceSessionId: string; readonly managedSessionId?: string; readonly repositoryRoot: string; readonly targetSnapshotId: string; readonly contextPackageId: string; readonly contextDigest: string; readonly provider: ExtensionVoiceProvider; readonly transcript: "off" | "redacted"; readonly retentionMinutes: number; readonly status: "active" | "muted" | "interrupted" | "ended"; readonly transcriptDeletedAt?: string; }

export type BridgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface ExtensionCompanionBridge {
  health(): Promise<BridgeResult<Readonly<{ status?: string }>>>;
  listSessions(): Promise<BridgeResult<readonly ExtensionManagedSession[]>>;
  registerSession(session: ExtensionManagedSession, kind?: "session" | "terminal" | "debug"): Promise<BridgeResult<ExtensionManagedSession>>;
  adoptTerminal(sessionId: string, adoptionKey: string, provider: Exclude<ExtensionProvider, "voice">): Promise<BridgeResult<ExtensionManagedSession>>;
  updateStatus(sessionId: string, status: ExtensionSessionStatus): Promise<BridgeResult<ExtensionManagedSession>>;
  heartbeat(sessionId: string, at?: string): Promise<BridgeResult<ExtensionManagedSession>>;
  prepareCommand(command: Readonly<{ control: B122Control; modifier: B122Modifier; sessionId?: string; reason: string }>): Promise<BridgeResult<PreparedCommand>>;
  inspectGitReview(sessionId: string): Promise<BridgeResult<GitReviewWorkspace>>;
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
  releaseContainment(input: Readonly<{ sessionId: string; reason: string; incidentStatus: "rotation_complete" | "not_required" }>): Promise<BridgeResult<ForwardedCommandResult>>;
  installRawHid(identity: RawHidDeviceIdentity): Promise<BridgeResult<Readonly<{ installation: RawHidInstallationPin; supervisor: RawHidRuntimeStatus["supervisor"] }>>>;
  listRawHid(): Promise<BridgeResult<readonly RawHidInstallationPin[]>>;
  revokeRawHid(): Promise<BridgeResult<RawHidInstallationPin>>;
  rawHidStatus(): Promise<BridgeResult<RawHidRuntimeStatus>>;
  claimHardwareSignal(binding: Readonly<{ windowSessionId: string; workspaceRoots: readonly string[]; focused: true }>): Promise<BridgeResult<HardwareSignalClaim | undefined>>;
  prepareHardwareSignal(claim: HardwareSignalClaim, sessionId: string | undefined, reason: string): Promise<BridgeResult<HardwareSignalPreparationResult>>;
  dispatchHardwareSignal(claim: HardwareSignalClaim, command: Omit<ForwardedCommand, "control" | "modifier">): Promise<BridgeResult<HardwareSignalDispatchResult>>;
  completeHardwareSignal(claim: HardwareSignalClaim, completion: Readonly<{ outcome: "handled" | "failed_before_dispatch" | "needs_reconciliation"; summary: string; dispatchReceiptId?: string; dispatchSessionId?: string; repositoryRoot?: string }>): Promise<BridgeResult<HardwareSignalCompletionResult>>;
  createHandoff(input: Readonly<{ sessionId: string; recipientSessionId?: string; routing?: "queue" | "immediate"; authorityId?: string; plan: string; decisions: readonly string[]; documentation: readonly string[]; references: readonly string[]; constraints: readonly string[]; openQuestions: readonly string[]; nextActions: readonly string[] }>): Promise<BridgeResult<ExtensionHandoffPackage>>;
  listHandoffs(): Promise<BridgeResult<readonly ExtensionHandoffPackage[]>>;
  acknowledgeHandoff(handoffId: string, recipientSessionId: string): Promise<BridgeResult<ExtensionHandoffPackage>>;
  cancelHandoff(handoffId: string): Promise<BridgeResult<ExtensionHandoffPackage>>;
  archiveHandoff(handoffId: string): Promise<BridgeResult<ExtensionHandoffPackage>>;
  handoffRouting(): Promise<BridgeResult<"queue" | "immediate">>;
  setHandoffRouting(routing: "queue" | "immediate"): Promise<BridgeResult<"queue" | "immediate">>;
  prepareWorkflow(input: Readonly<{ action: ExtensionWorkflowAction; sessionId: string; authorityId: string; intent: ExtensionWorkflowPreparationIntent }>): Promise<BridgeResult<ExtensionWorkflowArtifact>>;
  listWorkflows(): Promise<BridgeResult<readonly ExtensionWorkflowArtifact[]>>;
  grantVoiceConsent(input: Readonly<{ handoffId: string; provider: ExtensionVoiceProvider; transcript: "off" | "redacted"; retentionMinutes: number; expiresInMinutes: number }>): Promise<BridgeResult<ExtensionVoiceConsent>>;
  startVoice(input: Readonly<{ consentId: string; voiceSessionId: string; managedSessionId?: string }>): Promise<BridgeResult<ExtensionVoiceBinding>>;
  currentVoice(): Promise<BridgeResult<ExtensionVoiceBinding | undefined>>;
  switchVoice(input: Readonly<{ bindingId: string; consentId: string; voiceSessionId: string }>): Promise<BridgeResult<ExtensionVoiceBinding>>;
  bindVoice(bindingId: string, managedSessionId: string): Promise<BridgeResult<ExtensionVoiceBinding>>;
  muteVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>>;
  resumeVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>>;
  interruptVoice(bindingId: string, reason: string): Promise<BridgeResult<ExtensionVoiceBinding>>;
  endVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>>;
  deleteVoiceTranscript(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>>;
  dispatch(command: ForwardedCommand): Promise<BridgeResult<ForwardedCommandResult>>;
  authorizeHostAction(hostActionId: string, adapterVersion: string): Promise<BridgeResult<ForwardedHostActionAuthorization>>;
  completeHostAction(hostActionId: string, succeeded: boolean, summary: string, adapterVersion: string, authorizationToken?: string): Promise<BridgeResult<ForwardedCommandResult>>;
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

  async listSessions(): Promise<BridgeResult<readonly ExtensionManagedSession[]>> {
    const result = await this.call<unknown>("session.list", undefined);
    if (!result.ok) return result;
    if (!Array.isArray(result.value) || result.value.length > 4_096 || !result.value.every(isExtensionManagedSession)) return invalidResponse();
    return { ok: true, value: result.value };
  }

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

  async releaseContainment(input: Readonly<{ sessionId: string; reason: string; incidentStatus: "rotation_complete" | "not_required" }>): Promise<BridgeResult<ForwardedCommandResult>> {
    const result = await this.call<unknown>("containment.release", input);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["command"]) || !isForwardedCommandResult(result.value.command)) return invalidResponse();
    return { ok: true, value: result.value.command };
  }

  async prepareCommand(command: Readonly<{ control: B122Control; modifier: B122Modifier; sessionId?: string; reason: string }>): Promise<BridgeResult<PreparedCommand>> {
    const result = await this.call<{ preparation: PreparedCommand }>("command.prepare", command);
    return result.ok ? { ok: true, value: result.value.preparation } : result;
  }

  async reviewGitMutation(request: Readonly<{ action: "local_commit" | "pr_upsert" | "pr_merge" | "direct_main"; sessionId: string; mutation: ReviewedGitMutation }>): Promise<BridgeResult<GitReviewResult>> {
    const result = await this.call<{ review: GitReviewResult }>("git.review.submit", request);
    return result.ok ? { ok: true, value: result.value.review } : result;
  }

  async inspectGitReview(sessionId: string): Promise<BridgeResult<GitReviewWorkspace>> {
    const result = await this.call<unknown>("git.review.inspect", { sessionId });
    if (!result.ok) return result;
    const workspace = isRecord(result.value) ? result.value.workspace : undefined;
    if (!isRecord(workspace) || !allowedExactKeys(workspace, ["repositoryRoot", "targetSnapshotId", "detached", "changedPaths"], ["branch", "defaultBranch"])
      || typeof workspace.repositoryRoot !== "string" || !workspace.repositoryRoot || workspace.repositoryRoot.length > 4_096 || /[\r\n\0]/.test(workspace.repositoryRoot)
      || typeof workspace.targetSnapshotId !== "string" || !workspace.targetSnapshotId
      || typeof workspace.detached !== "boolean"
      || (workspace.branch !== undefined && (typeof workspace.branch !== "string" || !safeBranch(workspace.branch)))
      || (workspace.defaultBranch !== undefined && (typeof workspace.defaultBranch !== "string" || !safeBranch(workspace.defaultBranch)))
      || (workspace.detached === true && workspace.branch !== undefined)
      || !Array.isArray(workspace.changedPaths) || workspace.changedPaths.length > 4_096 || !workspace.changedPaths.every((path) => typeof path === "string" && path.length > 0 && path.length <= 4_096 && !/[\r\n\0]/.test(path))) return invalidResponse();
    return { ok: true, value: { repositoryRoot: workspace.repositoryRoot, targetSnapshotId: workspace.targetSnapshotId, detached: workspace.detached, changedPaths: workspace.changedPaths as string[], ...(typeof workspace.branch === "string" ? { branch: workspace.branch } : {}), ...(typeof workspace.defaultBranch === "string" ? { defaultBranch: workspace.defaultBranch } : {}) } };
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

  async installRawHid(identity: RawHidDeviceIdentity): Promise<BridgeResult<Readonly<{ installation: RawHidInstallationPin; supervisor: RawHidRuntimeStatus["supervisor"] }>>> {
    const result = await this.call<unknown>("raw-hid.install", identity);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["installation", "supervisor"]) || !isRawHidPin(result.value.installation) || !isRawHidSupervisorStatus(result.value.supervisor)
      || !sameRawHidIdentity(result.value.installation.identity, identity) || result.value.installation.status !== "active") return invalidResponse();
    return { ok: true, value: { installation: result.value.installation, supervisor: result.value.supervisor } };
  }

  async listRawHid(): Promise<BridgeResult<readonly RawHidInstallationPin[]>> {
    const result = await this.call<unknown>("raw-hid.list", undefined);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["installations"]) || !Array.isArray(result.value.installations) || !result.value.installations.every(isRawHidPin)) return invalidResponse();
    return { ok: true, value: result.value.installations };
  }

  async revokeRawHid(): Promise<BridgeResult<RawHidInstallationPin>> {
    const result = await this.call<unknown>("raw-hid.revoke", undefined);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["installation"]) || !isRawHidPin(result.value.installation) || result.value.installation.status !== "revoked") return invalidResponse();
    return { ok: true, value: result.value.installation };
  }

  async rawHidStatus(): Promise<BridgeResult<RawHidRuntimeStatus>> {
    const result = await this.call<unknown>("raw-hid.status", undefined);
    if (!result.ok) return result;
    if (!isRawHidRuntimeStatus(result.value)) return invalidResponse();
    return { ok: true, value: result.value };
  }

  async claimHardwareSignal(binding: Readonly<{ windowSessionId: string; workspaceRoots: readonly string[]; focused: true }>): Promise<BridgeResult<HardwareSignalClaim | undefined>> {
    const result = await this.call<unknown>("hardware-signal.claim", binding);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !allowedExactKeys(result.value, [], ["claim"])) return invalidResponse();
    if (result.value.claim === undefined) return { ok: true, value: undefined };
    if (!isHardwareSignalClaim(result.value.claim) || result.value.claim.windowSessionId !== binding.windowSessionId || !sameRoots(result.value.claim.workspaceRoots, binding.workspaceRoots)) return invalidResponse();
    return { ok: true, value: result.value.claim };
  }

  async prepareHardwareSignal(claim: HardwareSignalClaim, sessionId: string | undefined, reason: string): Promise<BridgeResult<HardwareSignalPreparationResult>> {
    const result = await this.call<unknown>("hardware-signal.prepare", hardwareClaimPayload(claim, { ...(sessionId ? { sessionId } : {}), reason }));
    if (!result.ok) return result;
    if (!isRecord(result.value) || !allowedExactKeys(result.value, ["preparation"], ["dispositionReceiptId"]) || !isPreparedCommand(result.value.preparation)
      || (result.value.dispositionReceiptId !== undefined && !isHardwareDispatchReceipt(result.value.dispositionReceiptId))
      || (result.value.preparation.status === "prepared" ? result.value.dispositionReceiptId !== undefined : result.value.dispositionReceiptId === undefined)) return invalidResponse();
    return { ok: true, value: { preparation: result.value.preparation, ...(typeof result.value.dispositionReceiptId === "string" ? { dispositionReceiptId: result.value.dispositionReceiptId } : {}) } };
  }

  async dispatchHardwareSignal(claim: HardwareSignalClaim, command: Omit<ForwardedCommand, "control" | "modifier">): Promise<BridgeResult<HardwareSignalDispatchResult>> {
    const result = await this.call<unknown>("hardware-signal.dispatch", hardwareClaimPayload(claim, command));
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["command", "dispatchReceiptId"]) || !isForwardedCommandResult(result.value.command) || !isHardwareDispatchReceipt(result.value.dispatchReceiptId)) return invalidResponse();
    return { ok: true, value: { command: result.value.command, dispatchReceiptId: result.value.dispatchReceiptId } };
  }

  async completeHardwareSignal(claim: HardwareSignalClaim, completion: Readonly<{ outcome: "handled" | "failed_before_dispatch" | "needs_reconciliation"; summary: string; dispatchReceiptId?: string; dispatchSessionId?: string; repositoryRoot?: string }>): Promise<BridgeResult<HardwareSignalCompletionResult>> {
    const result = await this.call<unknown>("hardware-signal.complete", hardwareClaimPayload(claim, completion));
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["completion"]) || !isHardwareSignalCompletion(result.value.completion)
      || result.value.completion.signalId !== claim.signalId || result.value.completion.outcome !== completion.outcome) return invalidResponse();
    return { ok: true, value: result.value.completion };
  }

  async createHandoff(input: Readonly<{ sessionId: string; recipientSessionId?: string; routing?: "queue" | "immediate"; authorityId?: string; plan: string; decisions: readonly string[]; documentation: readonly string[]; references: readonly string[]; constraints: readonly string[]; openQuestions: readonly string[]; nextActions: readonly string[] }>): Promise<BridgeResult<ExtensionHandoffPackage>> {
    return this.handoffResult("handoff.create", input);
  }

  async listHandoffs(): Promise<BridgeResult<readonly ExtensionHandoffPackage[]>> {
    const result = await this.call<unknown>("handoff.list", undefined);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["handoffs"]) || !Array.isArray(result.value.handoffs) || !result.value.handoffs.every(isExtensionHandoffPackage)) return invalidResponse();
    return { ok: true, value: result.value.handoffs };
  }

  acknowledgeHandoff(handoffId: string, recipientSessionId: string): Promise<BridgeResult<ExtensionHandoffPackage>> { return this.handoffResult("handoff.acknowledge", { handoffId, recipientSessionId }); }
  cancelHandoff(handoffId: string): Promise<BridgeResult<ExtensionHandoffPackage>> { return this.handoffResult("handoff.cancel", { handoffId }); }
  archiveHandoff(handoffId: string): Promise<BridgeResult<ExtensionHandoffPackage>> { return this.handoffResult("handoff.archive", { handoffId }); }

  async handoffRouting(): Promise<BridgeResult<"queue" | "immediate">> {
    return this.routingResult("handoff.routing.get", undefined);
  }

  async setHandoffRouting(routing: "queue" | "immediate"): Promise<BridgeResult<"queue" | "immediate">> {
    return this.routingResult("handoff.routing.set", { routing });
  }

  async prepareWorkflow(input: Readonly<{ action: ExtensionWorkflowAction; sessionId: string; authorityId: string; intent: ExtensionWorkflowPreparationIntent }>): Promise<BridgeResult<ExtensionWorkflowArtifact>> {
    const result = await this.call<unknown>("workflow.prepare", input);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["artifact"]) || !isExtensionWorkflowArtifact(result.value.artifact)) return invalidResponse();
    return { ok: true, value: result.value.artifact };
  }

  async listWorkflows(): Promise<BridgeResult<readonly ExtensionWorkflowArtifact[]>> {
    const result = await this.call<unknown>("workflow.list", undefined);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["artifacts"]) || !Array.isArray(result.value.artifacts) || !result.value.artifacts.every(isExtensionWorkflowArtifact)) return invalidResponse();
    return { ok: true, value: result.value.artifacts };
  }

  async grantVoiceConsent(input: Readonly<{ handoffId: string; provider: ExtensionVoiceProvider; transcript: "off" | "redacted"; retentionMinutes: number; expiresInMinutes: number }>): Promise<BridgeResult<ExtensionVoiceConsent>> {
    const result = await this.call<unknown>("voice.consent", input);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["consent"]) || !isExtensionVoiceConsent(result.value.consent)) return invalidResponse();
    return { ok: true, value: result.value.consent };
  }

  startVoice(input: Readonly<{ consentId: string; voiceSessionId: string; managedSessionId?: string }>): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceBindingResult("voice.start", input); }

  async currentVoice(): Promise<BridgeResult<ExtensionVoiceBinding | undefined>> {
    const result = await this.call<unknown>("voice.current", undefined);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !allowedExactKeys(result.value, [], ["binding"]) || (result.value.binding !== undefined && !isExtensionVoiceBinding(result.value.binding))) return invalidResponse();
    return { ok: true, value: result.value.binding };
  }

  switchVoice(input: Readonly<{ bindingId: string; consentId: string; voiceSessionId: string }>): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceBindingResult("voice.switch", input); }
  bindVoice(bindingId: string, managedSessionId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceBindingResult("voice.bind", { bindingId, managedSessionId }); }
  muteVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceBindingResult("voice.mute", { bindingId }); }
  resumeVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceBindingResult("voice.resume", { bindingId }); }
  interruptVoice(bindingId: string, reason: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceBindingResult("voice.interrupt", { bindingId, reason }); }
  endVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceBindingResult("voice.end", { bindingId }); }
  deleteVoiceTranscript(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceBindingResult("voice.transcript.delete", { bindingId }); }

  async authorizeHostAction(hostActionId: string, adapterVersion: string): Promise<BridgeResult<ForwardedHostActionAuthorization>> {
    const result = await this.call<unknown>("host-action.authorize", { hostActionId, adapterVersion });
    if (!result.ok) return result;
    const authorization = isRecord(result.value) ? result.value.authorization : undefined;
    if (!isRecord(authorization) || !exactKeys(authorization, ["hostActionId", "authorizationToken", "expiresAt"])
      || authorization.hostActionId !== hostActionId
      || typeof authorization.authorizationToken !== "string" || !/^host-action-auth:[a-f0-9]{64}$/.test(authorization.authorizationToken)
      || typeof authorization.expiresAt !== "string" || !Number.isFinite(Date.parse(authorization.expiresAt))) return invalidResponse();
    return { ok: true, value: { hostActionId, authorizationToken: authorization.authorizationToken, expiresAt: authorization.expiresAt } };
  }

  async completeHostAction(hostActionId: string, succeeded: boolean, summary: string, adapterVersion: string, authorizationToken?: string): Promise<BridgeResult<ForwardedCommandResult>> {
    const result = await this.call<{ command: ForwardedCommandResult }>("host-action.complete", { hostActionId, succeeded, summary, adapterVersion, ...(authorizationToken ? { authorizationToken } : {}) });
    return result.ok ? { ok: true, value: result.value.command } : result;
  }

  private async handoffResult(method: string, payload: unknown): Promise<BridgeResult<ExtensionHandoffPackage>> {
    const result = await this.call<unknown>(method, payload);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["handoff"]) || !isExtensionHandoffPackage(result.value.handoff)) return invalidResponse();
    return { ok: true, value: result.value.handoff };
  }

  private async routingResult(method: string, payload: unknown): Promise<BridgeResult<"queue" | "immediate">> {
    const result = await this.call<unknown>(method, payload);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["routing"]) || (result.value.routing !== "queue" && result.value.routing !== "immediate")) return invalidResponse();
    return { ok: true, value: result.value.routing };
  }

  private async voiceBindingResult(method: string, payload: unknown): Promise<BridgeResult<ExtensionVoiceBinding>> {
    const result = await this.call<unknown>(method, payload);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["binding"]) || !isExtensionVoiceBinding(result.value.binding)) return invalidResponse();
    return { ok: true, value: result.value.binding };
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
  listSessions(): Promise<BridgeResult<readonly ExtensionManagedSession[]>> { return this.unavailable(); }
  registerSession(): Promise<BridgeResult<ExtensionManagedSession>> { return this.unavailable(); }
  adoptTerminal(): Promise<BridgeResult<ExtensionManagedSession>> { return this.unavailable(); }
  updateStatus(): Promise<BridgeResult<ExtensionManagedSession>> { return this.unavailable(); }
  heartbeat(): Promise<BridgeResult<ExtensionManagedSession>> { return this.unavailable(); }
  prepareCommand(): Promise<BridgeResult<PreparedCommand>> { return this.unavailable(); }
  inspectGitReview(): Promise<BridgeResult<GitReviewWorkspace>> { return this.unavailable(); }
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
  releaseContainment(): Promise<BridgeResult<ForwardedCommandResult>> { return this.unavailable(); }
  installRawHid(): Promise<BridgeResult<Readonly<{ installation: RawHidInstallationPin; supervisor: RawHidRuntimeStatus["supervisor"] }>>> { return this.unavailable(); }
  listRawHid(): Promise<BridgeResult<readonly RawHidInstallationPin[]>> { return this.unavailable(); }
  revokeRawHid(): Promise<BridgeResult<RawHidInstallationPin>> { return this.unavailable(); }
  rawHidStatus(): Promise<BridgeResult<RawHidRuntimeStatus>> { return this.unavailable(); }
  claimHardwareSignal(): Promise<BridgeResult<HardwareSignalClaim | undefined>> { return this.unavailable(); }
  prepareHardwareSignal(): Promise<BridgeResult<HardwareSignalPreparationResult>> { return this.unavailable(); }
  dispatchHardwareSignal(): Promise<BridgeResult<HardwareSignalDispatchResult>> { return this.unavailable(); }
  completeHardwareSignal(): Promise<BridgeResult<HardwareSignalCompletionResult>> { return this.unavailable(); }
  createHandoff(): Promise<BridgeResult<ExtensionHandoffPackage>> { return this.unavailable(); }
  listHandoffs(): Promise<BridgeResult<readonly ExtensionHandoffPackage[]>> { return this.unavailable(); }
  acknowledgeHandoff(): Promise<BridgeResult<ExtensionHandoffPackage>> { return this.unavailable(); }
  cancelHandoff(): Promise<BridgeResult<ExtensionHandoffPackage>> { return this.unavailable(); }
  archiveHandoff(): Promise<BridgeResult<ExtensionHandoffPackage>> { return this.unavailable(); }
  handoffRouting(): Promise<BridgeResult<"queue" | "immediate">> { return this.unavailable(); }
  setHandoffRouting(): Promise<BridgeResult<"queue" | "immediate">> { return this.unavailable(); }
  prepareWorkflow(): Promise<BridgeResult<ExtensionWorkflowArtifact>> { return this.unavailable(); }
  listWorkflows(): Promise<BridgeResult<readonly ExtensionWorkflowArtifact[]>> { return this.unavailable(); }
  grantVoiceConsent(): Promise<BridgeResult<ExtensionVoiceConsent>> { return this.unavailable(); }
  startVoice(): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.unavailable(); }
  currentVoice(): Promise<BridgeResult<ExtensionVoiceBinding | undefined>> { return this.unavailable(); }
  switchVoice(): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.unavailable(); }
  bindVoice(): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.unavailable(); }
  muteVoice(): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.unavailable(); }
  resumeVoice(): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.unavailable(); }
  interruptVoice(): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.unavailable(); }
  endVoice(): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.unavailable(); }
  deleteVoiceTranscript(): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.unavailable(); }
  dispatch(): Promise<BridgeResult<ForwardedCommandResult>> { return this.unavailable(); }
  authorizeHostAction(): Promise<BridgeResult<ForwardedHostActionAuthorization>> { return this.unavailable(); }
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

function safeBranch(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(value)
    && !value.startsWith("-") && !value.endsWith("/") && !value.includes("..") && !value.includes("@{");
}

function hardwareClaimPayload(claim: HardwareSignalClaim, extra: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    signalId: claim.signalId,
    claimToken: claim.claimToken,
    windowSessionId: claim.windowSessionId,
    workspaceRoots: claim.workspaceRoots,
    ...extra
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse<T>(): BridgeResult<T> {
  return { ok: false, code: "invalid_response", message: "The local companion returned a value outside the strict SXSY-B122 schema." };
}

function isExtensionManagedSession(value: unknown): value is ExtensionManagedSession {
  const required = ["id", "provider", "surface", "capabilities", "status", "plannedFiles", "lastHeartbeat", "adapterVersion", "metadata"];
  if (!isRecord(value) || !allowedExactKeys(value, required, ["workspaceRoot", "targetSnapshotId", "taskId", "planRevision"])
    || !reference(value.id) || !["claude", "codex", "generic", "voice"].includes(value.provider as string)
    || !["vscode_terminal", "vscode_window", "desktop", "browser", "bridge"].includes(value.surface as string)
    || !Array.isArray(value.capabilities) || value.capabilities.length < 1 || value.capabilities.length > 4
    || !value.capabilities.includes("registered") || new Set(value.capabilities).size !== value.capabilities.length
    || !value.capabilities.every((capability) => ["registered", "observable", "controllable", "mediated"].includes(capability as string))
    || !["running", "verified_blocked", "verified_finished", "unreachable", "stale", "unknown"].includes(value.status as string)
    || !Array.isArray(value.plannedFiles) || value.plannedFiles.length > 4_096 || !value.plannedFiles.every(pathText)
    || !timeText(value.lastHeartbeat) || !reference(value.adapterVersion)
    || !isRecord(value.metadata) || Object.keys(value.metadata).length > 256
    || !Object.entries(value.metadata).every(([key, item]) => reference(key) && typeof item === "string" && item.length <= 16_384 && !item.includes("\0"))
    || (value.workspaceRoot !== undefined && !pathText(value.workspaceRoot))
    || ![value.targetSnapshotId, value.taskId, value.planRevision].every((item) => item === undefined || reference(item))) return false;
  return true;
}

function isExtensionHandoffPackage(value: unknown): value is ExtensionHandoffPackage {
  const required = ["id", "digest", "repositoryRoot", "targetSnapshotId", "taskId", "planRevision", "plan", "decisions", "documentation", "references", "constraints", "openQuestions", "nextActions", "status", "executionAuthorized", "createdAt", "updatedAt"];
  if (!isRecord(value) || !allowedExactKeys(value, required, ["authorityId", "recipientSessionId", "acknowledgedAt"])
    || !reference(value.id) || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)
    || !pathText(value.repositoryRoot) || !reference(value.targetSnapshotId) || !reference(value.taskId) || !reference(value.planRevision)
    || !contentText(value.plan, 16_384) || ![value.decisions, value.documentation, value.references, value.constraints, value.openQuestions, value.nextActions].every(contentList)
    || !["queued", "immediate_focus_requested", "acknowledged", "cancelled", "archived"].includes(value.status as string)
    || value.executionAuthorized !== false || !timeText(value.createdAt) || !timeText(value.updatedAt)
    || ![value.authorityId, value.recipientSessionId].every((item) => item === undefined || reference(item))
    || (value.acknowledgedAt !== undefined && !timeText(value.acknowledgedAt))) return false;
  return true;
}

function isExtensionWorkflowArtifact(value: unknown): value is ExtensionWorkflowArtifact {
  const required = ["action", "repositoryRoot", "targetSnapshotId", "sessionId", "payload", "id", "digest", "status", "executionAuthorized", "createdAt", "updatedAt"];
  if (!isRecord(value) || !allowedExactKeys(value, required, ["taskId", "planRevision", "operationId", "providerExternalId"])
    || !workflowAction(value.action) || !pathText(value.repositoryRoot) || !reference(value.targetSnapshotId) || !reference(value.sessionId)
    || !isRecord(value.payload) || !reference(value.id) || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)
    || !["prepared", "submitted", "cancelling", "acknowledged", "rejected", "cancelled"].includes(value.status as string)
    || value.executionAuthorized !== false || !timeText(value.createdAt) || !timeText(value.updatedAt)
    || ![value.taskId, value.planRevision, value.operationId, value.providerExternalId].every((item) => item === undefined || reference(item))) return false;
  return true;
}

function isExtensionVoiceConsent(value: unknown): value is ExtensionVoiceConsent {
  if (!isRecord(value) || !exactKeys(value, ["id", "repositoryRoot", "targetSnapshotId", "contextPackageId", "contextDigest", "provider", "operatorPresenceId", "transcript", "retentionMinutes", "grantedAt", "expiresAt"])
    || !reference(value.id) || !pathText(value.repositoryRoot) || !reference(value.targetSnapshotId) || !reference(value.contextPackageId)
    || typeof value.contextDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.contextDigest) || !voiceProvider(value.provider)
    || !reference(value.operatorPresenceId) || (value.transcript !== "off" && value.transcript !== "redacted")
    || !Number.isSafeInteger(value.retentionMinutes) || (value.retentionMinutes as number) < 0 || (value.retentionMinutes as number) > 1_440
    || !timeText(value.grantedAt) || !timeText(value.expiresAt)) return false;
  return true;
}

function isExtensionVoiceBinding(value: unknown): value is ExtensionVoiceBinding {
  const required = ["id", "consentId", "voiceSessionId", "repositoryRoot", "targetSnapshotId", "contextPackageId", "contextDigest", "provider", "transcript", "retentionMinutes", "status", "createdAt", "updatedAt"];
  if (!isRecord(value) || !allowedExactKeys(value, required, ["managedSessionId", "endedAt", "interruptionReason", "transcriptDeletedAt"])
    || !reference(value.id) || !reference(value.consentId) || !reference(value.voiceSessionId) || !pathText(value.repositoryRoot)
    || !reference(value.targetSnapshotId) || !reference(value.contextPackageId) || typeof value.contextDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.contextDigest)
    || !voiceProvider(value.provider) || (value.transcript !== "off" && value.transcript !== "redacted")
    || !Number.isSafeInteger(value.retentionMinutes) || (value.retentionMinutes as number) < 0 || (value.retentionMinutes as number) > 1_440
    || !["active", "muted", "interrupted", "ended"].includes(value.status as string) || !timeText(value.createdAt) || !timeText(value.updatedAt)
    || (value.managedSessionId !== undefined && !reference(value.managedSessionId))
    || ![value.endedAt, value.transcriptDeletedAt].every((item) => item === undefined || timeText(item))
    || (value.interruptionReason !== undefined && !contentText(value.interruptionReason, 512))) return false;
  return true;
}

function workflowAction(value: unknown): value is ExtensionWorkflowAction { return typeof value === "string" && ["reanchor", "proof", "proof_adversarial", "option_provider", "option_packet", "plan_expander", "plan_approval", "handoff", "handoff_queue", "handoff_immediate", "focus_blocked_agent", "focus_finished_agent", "authority_refresh", "authority_broadcast", "bind_voice_session"].includes(value); }
function voiceProvider(value: unknown): value is ExtensionVoiceProvider { return value === "claude" || value === "chatgpt" || value === "system"; }
function reference(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value); }
function pathText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 4_096 && !/[\r\n\0]/.test(value); }
function contentText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/\0/.test(value); }
function contentList(value: unknown): value is readonly string[] { return Array.isArray(value) && value.length <= 512 && value.every((item) => contentText(item, 16_384)); }
function timeText(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

function isRawHidPin(value: unknown): value is RawHidInstallationPin {
  if (!isRecord(value) || !exactKeys(value, ["identity", "helperPath", "helperSha256", "protocolVersion", "mapFingerprint", "installedAt", "status"])
    || !isRawHidIdentity(value.identity) || typeof value.helperPath !== "string" || !boundedText(value.helperPath, 4_096)
    || typeof value.helperSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.helperSha256)
    || !Number.isInteger(value.protocolVersion) || (value.protocolVersion as number) < 1 || (value.protocolVersion as number) > 255
    || typeof value.mapFingerprint !== "string" || !/^[a-f0-9]{16}$/.test(value.mapFingerprint)
    || typeof value.installedAt !== "string" || !Number.isFinite(Date.parse(value.installedAt))
    || (value.status !== "active" && value.status !== "revoked")) return false;
  return true;
}

function isRawHidIdentity(value: unknown): value is RawHidDeviceIdentity {
  return isRecord(value) && allowedExactKeys(value, ["vendorId", "productId", "usagePage", "usage"], ["serialNumber"])
    && uint16(value.vendorId) && uint16(value.productId) && uint16(value.usagePage) && uint16(value.usage)
    && (value.serialNumber === undefined || (typeof value.serialNumber === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value.serialNumber)));
}

function sameRawHidIdentity(left: RawHidDeviceIdentity, right: RawHidDeviceIdentity): boolean {
  return left.vendorId === right.vendorId && left.productId === right.productId && left.usagePage === right.usagePage
    && left.usage === right.usage && left.serialNumber === right.serialNumber;
}

function isRawHidSupervisorStatus(value: unknown): value is RawHidRuntimeStatus["supervisor"] {
  return isRecord(value) && exactKeys(value, ["state", "generation", "detail"])
    && ["unprovisioned", "starting", "running", "retrying", "stopped", "unavailable"].includes(value.state as string)
    && Number.isSafeInteger(value.generation) && (value.generation as number) >= 0
    && typeof value.detail === "string" && boundedText(value.detail, 512);
}

function isRawHidRuntimeStatus(value: unknown): value is RawHidRuntimeStatus {
  if (!isRecord(value) || !exactKeys(value, ["supervisor", "inbox", "installations"]) || !isRawHidSupervisorStatus(value.supervisor)
    || !isRecord(value.inbox) || !exactKeys(value.inbox, ["pending", "claimed", "completed", "needsReconciliation"])
    || ![value.inbox.pending, value.inbox.claimed, value.inbox.completed, value.inbox.needsReconciliation].every((count) => Number.isSafeInteger(count) && (count as number) >= 0)
    || !Array.isArray(value.installations) || !value.installations.every(isRawHidPin)) return false;
  return true;
}

function isHardwareSignalClaim(value: unknown): value is HardwareSignalClaim {
  if (!isRecord(value) || !exactKeys(value, ["signalId", "claimToken", "deviceId", "connectionEpoch", "bootNonce", "counter", "control", "modifier", "acceptedAt", "claimedAt", "attempt", "windowSessionId", "workspaceRoots"])
    || typeof value.signalId !== "string" || !/^hardware-signal:[a-f0-9]{64}$/.test(value.signalId)
    || typeof value.claimToken !== "string" || !/^[A-Za-z0-9_-]{8,256}$/.test(value.claimToken)
    || typeof value.deviceId !== "string" || !/^[a-f0-9]{64}$/.test(value.deviceId)
    || !uint32(value.connectionEpoch) || !uint32(value.bootNonce) || !uint32(value.counter)
    || typeof value.control !== "string" || typeof value.modifier !== "string" || !chordFor(value.control as B122Control, value.modifier as B122Modifier)
    || typeof value.acceptedAt !== "string" || !Number.isFinite(Date.parse(value.acceptedAt))
    || typeof value.claimedAt !== "string" || !Number.isFinite(Date.parse(value.claimedAt))
    || !Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1
    || typeof value.windowSessionId !== "string" || !boundedText(value.windowSessionId, 512)
    || !Array.isArray(value.workspaceRoots) || value.workspaceRoots.length < 1 || value.workspaceRoots.length > 32
    || !value.workspaceRoots.every((root) => typeof root === "string" && boundedText(root, 4_096))) return false;
  return true;
}

function isPreparedCommand(value: unknown): value is PreparedCommand {
  return isRecord(value) && allowedExactKeys(value, ["status", "summary"], ["session", "authorityId", "confirmationToken", "confirmationExpiresAt"])
    && ["prepared", "blocked", "unavailable", "incomplete"].includes(value.status as string)
    && typeof value.summary === "string" && boundedText(value.summary, 512)
    && (value.session === undefined || isRecord(value.session))
    && [value.authorityId, value.confirmationToken].every((item) => item === undefined || (typeof item === "string" && boundedText(item, 512)))
    && (value.confirmationExpiresAt === undefined || (typeof value.confirmationExpiresAt === "string" && Number.isFinite(Date.parse(value.confirmationExpiresAt))));
}

function isForwardedCommandResult(value: unknown): value is ForwardedCommandResult {
  return isRecord(value) && allowedExactKeys(value, ["status", "summary"], ["data"])
    && ["queued", "running", "awaiting_input", "awaiting_confirmation", "cancelling", "completed", "failed", "timed_out", "unavailable", "incomplete", "blocked", "cancelled"].includes(value.status as string)
    && typeof value.summary === "string" && boundedText(value.summary, 512)
    && (value.data === undefined || isRecord(value.data));
}

function isHardwareSignalCompletion(value: unknown): value is HardwareSignalCompletionResult {
  return isRecord(value) && exactKeys(value, ["signalId", "outcome"])
    && typeof value.signalId === "string" && /^hardware-signal:[a-f0-9]{64}$/.test(value.signalId)
    && (value.outcome === "handled" || value.outcome === "failed_before_dispatch" || value.outcome === "needs_reconciliation");
}

function isHardwareDispatchReceipt(value: unknown): value is string {
  return typeof value === "string" && /^hardware-dispatch:[a-f0-9]{64}$/.test(value);
}

function sameRoots(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((root, index) => root.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() === right[index]!.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase());
}

function boundedText(value: string, maximum: number): boolean { return value.length > 0 && value.length <= maximum && !/[\r\n\0]/.test(value); }
function uint16(value: unknown): value is number { return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff; }
function uint32(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff; }
function exactKeys(value: Record<string, unknown>, required: readonly string[]): boolean { const keys = Object.keys(value); return keys.length === required.length && required.every((key) => key in value); }
function allowedExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const keys = Object.keys(value); const allowed = new Set([...required, ...optional]); return required.every((key) => key in value) && keys.every((key) => allowed.has(key)); }
