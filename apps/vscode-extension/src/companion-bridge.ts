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
  readonly operationId?: string;
  readonly effectDisposition?: "not_started" | "committed" | "ambiguous";
  readonly data?: Readonly<Record<string, unknown>>;
}

export type LocalHostAction =
  | "show_handoff_queue" | "toggle_handoff_routing" | "show_blocker_queue" | "show_done_queue"
  | "open_external_url" | "create_claude_terminal" | "create_codex_terminal" | "focus_vscode"
  | "new_vscode_window" | "focus_external_terminal" | "focus_integrated_terminal" | "open_compound_palette"
  | "show_voice_center" | "switch_voice_provider" | "show_voice_session_picker" | "show_pipeline_failure_trace" | "start_vscode_debug" | "configure_python_venv" | "select_github_navigation";

export interface GitHubNavigationCandidate { readonly id: string; readonly label: string; readonly description: string; readonly url: string; }

export interface ForwardedHostAction {
  readonly id: string;
  readonly kind: LocalHostAction;
  readonly expiresAt: string;
  readonly url?: string;
  readonly workspaceRoot?: string;
  readonly debugConfiguration?: string;
  readonly pythonInterpreter?: string;
  readonly githubCandidates?: readonly GitHubNavigationCandidate[];
  readonly managedTerminalProfile?: ManagedTerminalProfileSummary;
}

export interface ForwardedHostActionAuthorization {
  readonly hostActionId: string;
  readonly authorizationToken: string;
  readonly expiresAt: string;
  readonly selectionId?: string;
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

export interface CredentialProvisionScope { readonly repositoryRoot: string; readonly adapterId: string; readonly purpose: string; }
export interface CredentialReferenceSummary { readonly reference: string; readonly protectorProvider: string; readonly generation: number; readonly createdAt: string; readonly updatedAt: string; readonly scopes: readonly CredentialProvisionScope[]; readonly revokedAt?: string; readonly revocationReason?: string; }
export interface InstalledNetworkPolicy { readonly filePath: string; readonly sha256: string; readonly installedAt: string; readonly status: "active" | "revoked"; }
export interface AcceptanceTrustSummary { readonly authorityId: string; readonly keyId: string; readonly allowedGates: readonly number[]; readonly expiresAt: string; readonly installedAt: string; readonly installedBy: string; readonly status: "active" | "revoked"; }
export interface AcceptanceEvidenceSummary { readonly id: string; readonly gate: number; readonly status: "passed" | "failed" | "unavailable" | "incomplete"; readonly targetSnapshotId?: string; readonly operationId?: string; readonly evidenceDigest: string; readonly policyVersion: string; readonly evaluatedBy: string; readonly evaluatedAt: string; readonly expiresAt?: string; readonly rationale: string; readonly invalidatedAt?: string; readonly invalidatedReason?: string; }
export interface HighConsequenceActivationSummary { readonly id: string; readonly action: string; readonly targetSnapshotId: string; readonly policyVersion: string; readonly gateEvidenceIds: readonly string[]; readonly activatedAt: string; readonly expiresAt: string; readonly activatedBy: string; readonly status: "active" | "revoked"; }
export interface ScannerTrustSummary { readonly authorityId: string; readonly keyId: string; readonly allowedKinds: readonly ("scanner" | "advisory")[]; readonly expiresAt: string; readonly installedAt: string; readonly installedBy: string; readonly status: "active" | "revoked"; }
export interface ScannerFixtureSummary { readonly id: string; readonly kind: "scanner" | "advisory"; readonly packageRoot: string; readonly manifestSha256: string; readonly installedAt: string; readonly installedBy: string; readonly status: "active" | "revoked"; }
export type ProviderDesktopId = "claude_desktop" | "chatgpt_desktop" | "claude_code" | "codex";
export interface ProviderProductIdentitySummary { readonly productId: string; readonly displayName: string; readonly publisher: string; readonly role: "desktop" | "managed_terminal"; }
export interface ProviderExecutableIdentitySummary { readonly canonicalExecutablePath: string; readonly executableSha256: string; readonly signerSubject: string; readonly signerThumbprint: string; readonly productIdentity: ProviderProductIdentitySummary; readonly size: number; readonly modifiedMs: number; readonly device: string; readonly inode: string; }
export interface ProviderInstallationSummary { readonly provider: ProviderDesktopId; readonly installationId: string; readonly catalogDigest: string; readonly identity: ProviderExecutableIdentitySummary; readonly operator: string; readonly installedAt: string; readonly statusAt: string; readonly status: "active" | "stale" | "revoked"; }
export interface ManagedTerminalProfileSummary { readonly provider: "claude_code" | "codex"; readonly profileName: string; readonly canonicalLauncherPath: string; readonly launcherSha256: string; readonly launcherProtocolVersion: 1; readonly canonicalExecutablePath: string; readonly executableSha256: string; readonly signerSubject: string; readonly signerThumbprint: string; readonly executableSize: number; readonly executableModifiedMs: number; readonly executableDevice: string; readonly executableInode: string; readonly productIdentity: ProviderProductIdentitySummary; readonly args: readonly string[]; readonly shell: false; readonly installationId: string; readonly catalogDigest: string; readonly issuedAt: string; readonly validUntil: string; readonly requiresFinalIdentityVerification: true; }
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
export type ExtensionWorkflowProviderResult =
  | { readonly kind: "anchor"; readonly anchorDigest: string; readonly discrepancies: readonly string[]; readonly questions: readonly string[]; readonly resumed: false }
  | { readonly kind: "proof"; readonly verifiedClaims: readonly string[]; readonly evidenceReferences: readonly string[]; readonly backendResults: readonly { readonly backend: string; readonly status: "passed" | "failed" | "unavailable" }[] }
  | { readonly kind: "decision"; readonly decisionPacketId: string; readonly decisions: readonly { readonly decisionId: string; readonly options: readonly { readonly id: string; readonly label: string; readonly tradeoffs: readonly string[]; readonly risks: readonly string[] }[]; readonly recommendationId: string }[]; readonly userSelectionRequired: true }
  | { readonly kind: "plan"; readonly mode: "expanded"; readonly planDigest: string; readonly alternatives: readonly { readonly rank: number; readonly id: string; readonly summary: string; readonly rationale: string; readonly risks: readonly string[] }[] }
  | { readonly kind: "plan"; readonly mode: "execution_ack"; readonly planDigest: string; readonly planRevision: string; readonly originSessionId: string; readonly executorSessionId: string; readonly authorityId: string; readonly acknowledgementId: string; readonly executionStarted: true }
  | { readonly kind: "handoff"; readonly packageId: string; readonly recipientSessionId: string; readonly acknowledged: boolean }
  | { readonly kind: "focus"; readonly selectedSessionId: string; readonly status: "verified_blocked" | "verified_finished"; readonly queueCycleId: string; readonly resultDelivered: true }
  | { readonly kind: "authority"; readonly acknowledgements: readonly { readonly recipientSessionId: string; readonly grantId: string; readonly matchDigest: string; readonly acknowledged: true }[] }
  | { readonly kind: "voice_binding"; readonly bindingId: string; readonly active: boolean };
export interface ForwardedWorkflowOutcome {
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly resultKind: ExtensionWorkflowProviderResult["kind"];
  readonly workflowResult: ExtensionWorkflowProviderResult;
  readonly providerSummary: string;
  readonly externalId?: string;
}
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
  provisionCredential(input: Readonly<{ reference: string; scopes: readonly CredentialProvisionScope[]; sealedSecret: string; replaceExisting?: boolean }>): Promise<BridgeResult<CredentialReferenceSummary>>;
  listCredentials(): Promise<BridgeResult<readonly CredentialReferenceSummary[]>>;
  revokeCredential(reference: string, reason: string): Promise<BridgeResult<boolean>>;
  installNetworkPolicy(sourcePath: string): Promise<BridgeResult<InstalledNetworkPolicy>>;
  currentNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy | undefined>>;
  revokeNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy>>;
  installAcceptanceTrust(sourcePath: string): Promise<BridgeResult<AcceptanceTrustSummary>>;
  listAcceptanceTrust(): Promise<BridgeResult<readonly AcceptanceTrustSummary[]>>;
  revokeAcceptanceTrust(authorityId: string, keyId: string, reason: string): Promise<BridgeResult<AcceptanceTrustSummary>>;
  importAcceptanceEvidence(sourcePath: string): Promise<BridgeResult<AcceptanceEvidenceSummary>>;
  listAcceptanceEvidence(): Promise<BridgeResult<readonly AcceptanceEvidenceSummary[]>>;
  invalidateAcceptanceEvidence(evidenceId: string, reason: string): Promise<BridgeResult<boolean>>;
  activateHighConsequence(action: string, targetSnapshotId: string, expiresAt: string): Promise<BridgeResult<HighConsequenceActivationSummary>>;
  listHighConsequenceActivations(): Promise<BridgeResult<readonly HighConsequenceActivationSummary[]>>;
  revokeHighConsequenceActivation(activationId: string, reason: string): Promise<BridgeResult<boolean>>;
  installScannerTrust(sourcePath: string): Promise<BridgeResult<ScannerTrustSummary>>;
  listScannerTrust(): Promise<BridgeResult<readonly ScannerTrustSummary[]>>;
  revokeScannerTrust(authorityId: string, keyId: string, reason: string): Promise<BridgeResult<boolean>>;
  installScannerFixture(sourcePath: string): Promise<BridgeResult<ScannerFixtureSummary>>;
  listScannerFixtures(): Promise<BridgeResult<readonly ScannerFixtureSummary[]>>;
  revokeScannerFixture(fixtureId: string, reason: string): Promise<BridgeResult<boolean>>;
  installProviderDesktop(provider: ProviderDesktopId): Promise<BridgeResult<ProviderInstallationSummary>>;
  listProviderDesktops(): Promise<BridgeResult<readonly ProviderInstallationSummary[]>>;
  revokeProviderDesktop(provider: ProviderDesktopId): Promise<BridgeResult<ProviderInstallationSummary>>;
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
  authorizeHostAction(hostActionId: string, adapterVersion: string, selectionId?: string, expectedUrl?: string): Promise<BridgeResult<ForwardedHostActionAuthorization>>;
  completeHostAction(hostActionId: string, succeeded: boolean, summary: string, adapterVersion: string, authorizationToken?: string, effectDisposition?: "not_started" | "committed" | "ambiguous"): Promise<BridgeResult<ForwardedCommandResult>>;
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
    const result = await this.call<unknown>("command.dispatch", command);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["command"]) || !isForwardedCommandResult(result.value.command)) return invalidResponse();
    return { ok: true, value: result.value.command };
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

  async provisionCredential(input: Readonly<{ reference: string; scopes: readonly CredentialProvisionScope[]; sealedSecret: string; replaceExisting?: boolean }>): Promise<BridgeResult<CredentialReferenceSummary>> {
    const result = await this.call<unknown>("credential.provision", input);
    if (!result.ok) return result;
    const credential = isRecord(result.value) && exactKeys(result.value, ["credential"]) ? result.value.credential : undefined;
    if (!isCredentialReferenceSummary(credential) || credential.reference !== input.reference || !sameCredentialScopes(credential.scopes, input.scopes)) return invalidResponse();
    return { ok: true, value: credential };
  }
  async listCredentials(): Promise<BridgeResult<readonly CredentialReferenceSummary[]>> {
    const result = await this.call<unknown>("credential.list", undefined);
    if (!result.ok) return result;
    const credentials = isRecord(result.value) && exactKeys(result.value, ["credentials"]) ? result.value.credentials : undefined;
    return Array.isArray(credentials) && credentials.length <= 1_024 && credentials.every(isCredentialReferenceSummary) ? { ok: true, value: credentials } : invalidResponse();
  }
  async revokeCredential(reference: string, reason: string): Promise<BridgeResult<boolean>> { const result = await this.call<{ revoked: boolean }>("credential.revoke", { reference, reason }); return result.ok ? { ok: true, value: result.value.revoked } : result; }
  async installNetworkPolicy(sourcePath: string): Promise<BridgeResult<InstalledNetworkPolicy>> { const result = await this.call<{ policy: InstalledNetworkPolicy }>("network-policy.install", { sourcePath }); return result.ok ? { ok: true, value: result.value.policy } : result; }
  async currentNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy | undefined>> { const result = await this.call<{ policy?: InstalledNetworkPolicy }>("network-policy.current", undefined); return result.ok ? { ok: true, value: result.value.policy } : result; }
  async revokeNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy>> { const result = await this.call<{ policy: InstalledNetworkPolicy }>("network-policy.revoke", undefined); return result.ok ? { ok: true, value: result.value.policy } : result; }
  installAcceptanceTrust(sourcePath: string): Promise<BridgeResult<AcceptanceTrustSummary>> { return this.adminItem("acceptance.trust.install", { sourcePath }, "trust", isAcceptanceTrust); }
  listAcceptanceTrust(): Promise<BridgeResult<readonly AcceptanceTrustSummary[]>> { return this.adminList("acceptance.trust.list", "trust", isAcceptanceTrust); }
  revokeAcceptanceTrust(authorityId: string, keyId: string, reason: string): Promise<BridgeResult<AcceptanceTrustSummary>> { return this.adminItem("acceptance.trust.revoke", { authorityId, keyId, reason }, "trust", isAcceptanceTrust); }
  importAcceptanceEvidence(sourcePath: string): Promise<BridgeResult<AcceptanceEvidenceSummary>> { return this.adminItem("acceptance.evidence.import", { sourcePath }, "evidence", isAcceptanceEvidence); }
  listAcceptanceEvidence(): Promise<BridgeResult<readonly AcceptanceEvidenceSummary[]>> { return this.adminList("acceptance.evidence.list", "evidence", isAcceptanceEvidence); }
  async invalidateAcceptanceEvidence(evidenceId: string, reason: string): Promise<BridgeResult<boolean>> { return this.adminBoolean("acceptance.evidence.invalidate", { evidenceId, reason }, "invalidated"); }
  activateHighConsequence(action: string, targetSnapshotId: string, expiresAt: string): Promise<BridgeResult<HighConsequenceActivationSummary>> { return this.adminItem("acceptance.activation.activate", { action, targetSnapshotId, expiresAt }, "activation", isHighConsequenceActivation); }
  listHighConsequenceActivations(): Promise<BridgeResult<readonly HighConsequenceActivationSummary[]>> { return this.adminList("acceptance.activation.list", "activations", isHighConsequenceActivation); }
  async revokeHighConsequenceActivation(activationId: string, reason: string): Promise<BridgeResult<boolean>> { return this.adminBoolean("acceptance.activation.revoke", { activationId, reason }, "revoked"); }
  installScannerTrust(sourcePath: string): Promise<BridgeResult<ScannerTrustSummary>> { return this.adminItem("scanner.trust.install", { sourcePath }, "trust", isScannerTrust); }
  listScannerTrust(): Promise<BridgeResult<readonly ScannerTrustSummary[]>> { return this.adminList("scanner.trust.list", "trust", isScannerTrust); }
  async revokeScannerTrust(authorityId: string, keyId: string, reason: string): Promise<BridgeResult<boolean>> { return this.adminBoolean("scanner.trust.revoke", { authorityId, keyId, reason }, "revoked"); }
  installScannerFixture(sourcePath: string): Promise<BridgeResult<ScannerFixtureSummary>> { return this.adminItem("scanner.fixture.install", { sourcePath }, "fixture", isScannerFixture); }
  listScannerFixtures(): Promise<BridgeResult<readonly ScannerFixtureSummary[]>> { return this.adminList("scanner.fixture.list", "fixtures", isScannerFixture); }
  async revokeScannerFixture(fixtureId: string, reason: string): Promise<BridgeResult<boolean>> { return this.adminBoolean("scanner.fixture.revoke", { fixtureId, reason }, "revoked"); }
  async installProviderDesktop(provider: ProviderDesktopId): Promise<BridgeResult<ProviderInstallationSummary>> {
    const result = await this.adminItem("provider-desktop.install", { provider }, "installation", isProviderInstallation);
    return result.ok && result.value.provider !== provider ? invalidResponse() : result;
  }
  async listProviderDesktops(): Promise<BridgeResult<readonly ProviderInstallationSummary[]>> {
    const result = await this.adminList("provider-desktop.list", "installations", isProviderInstallation);
    if (!result.ok) return result;
    if (result.value.length > 4 || new Set(result.value.map((item) => item.provider)).size !== result.value.length) return invalidResponse();
    return result;
  }
  async revokeProviderDesktop(provider: ProviderDesktopId): Promise<BridgeResult<ProviderInstallationSummary>> {
    const result = await this.adminItem("provider-desktop.revoke", { provider }, "installation", isProviderInstallation);
    return result.ok && result.value.provider !== provider ? invalidResponse() : result;
  }
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

  async authorizeHostAction(hostActionId: string, adapterVersion: string, selectionId?: string, expectedUrl?: string): Promise<BridgeResult<ForwardedHostActionAuthorization>> {
    const result = await this.call<unknown>("host-action.authorize", { hostActionId, adapterVersion, ...(selectionId ? { selectionId } : {}) });
    if (!result.ok) return result;
    const authorization = isRecord(result.value) ? result.value.authorization : undefined;
    if (!isRecord(authorization) || !allowedExactKeys(authorization, ["hostActionId", "authorizationToken", "expiresAt"], ["selectionId", "url"])
      || authorization.hostActionId !== hostActionId
      || typeof authorization.authorizationToken !== "string" || !/^host-action-auth:[a-f0-9]{64}$/.test(authorization.authorizationToken)
      || typeof authorization.expiresAt !== "string" || !Number.isFinite(Date.parse(authorization.expiresAt))
      || (expectedUrl !== undefined && !trustedHostActionUrl(expectedUrl))
      || (selectionId === undefined && authorization.selectionId !== undefined)
      || (selectionId === undefined && expectedUrl === undefined && authorization.url !== undefined)
      || (selectionId === undefined && expectedUrl !== undefined && authorization.url !== expectedUrl)
      || (selectionId !== undefined && (authorization.selectionId !== selectionId || typeof authorization.url !== "string" || !trustedHttpsUrl(authorization.url)))) return invalidResponse();
    return { ok: true, value: { hostActionId, authorizationToken: authorization.authorizationToken, expiresAt: authorization.expiresAt, ...(selectionId ? { selectionId, url: authorization.url as string } : {}), ...(selectionId === undefined && expectedUrl !== undefined ? { url: authorization.url as string } : {}) } };
  }

  async completeHostAction(hostActionId: string, succeeded: boolean, summary: string, adapterVersion: string, authorizationToken?: string, effectDisposition?: "not_started" | "committed" | "ambiguous"): Promise<BridgeResult<ForwardedCommandResult>> {
    const result = await this.call<unknown>("host-action.complete", { hostActionId, succeeded, summary, adapterVersion, ...(authorizationToken ? { authorizationToken } : {}), ...(effectDisposition ? { effectDisposition } : {}) });
    if (!result.ok) return result;
    if (!isRecord(result.value) || !exactKeys(result.value, ["command"]) || !isForwardedCommandResult(result.value.command)) return invalidResponse();
    return { ok: true, value: result.value.command };
  }

  private async adminItem<T>(method: string, payload: unknown, key: string, validator: (value: unknown) => value is T): Promise<BridgeResult<T>> {
    const result = await this.call<unknown>(method, payload); if (!result.ok) return result;
    const value = isRecord(result.value) && exactKeys(result.value, [key]) ? result.value[key] : undefined; return validator(value) ? { ok: true, value } : invalidResponse();
  }
  private async adminList<T>(method: string, key: string, validator: (value: unknown) => value is T): Promise<BridgeResult<readonly T[]>> {
    const result = await this.call<unknown>(method, undefined); if (!result.ok) return result;
    const value = isRecord(result.value) && exactKeys(result.value, [key]) ? result.value[key] : undefined; return Array.isArray(value) && value.length <= 4_096 && value.every(validator) ? { ok: true, value } : invalidResponse();
  }
  private async adminBoolean(method: string, payload: unknown, key: string): Promise<BridgeResult<boolean>> {
    const result = await this.call<unknown>(method, payload); if (!result.ok) return result;
    const value = isRecord(result.value) && exactKeys(result.value, [key]) ? result.value[key] : undefined; return value === true ? { ok: true, value: true } : invalidResponse();
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
  installAcceptanceTrust(): Promise<BridgeResult<AcceptanceTrustSummary>> { return this.unavailable(); }
  listAcceptanceTrust(): Promise<BridgeResult<readonly AcceptanceTrustSummary[]>> { return this.unavailable(); }
  revokeAcceptanceTrust(): Promise<BridgeResult<AcceptanceTrustSummary>> { return this.unavailable(); }
  importAcceptanceEvidence(): Promise<BridgeResult<AcceptanceEvidenceSummary>> { return this.unavailable(); }
  listAcceptanceEvidence(): Promise<BridgeResult<readonly AcceptanceEvidenceSummary[]>> { return this.unavailable(); }
  invalidateAcceptanceEvidence(): Promise<BridgeResult<boolean>> { return this.unavailable(); }
  activateHighConsequence(): Promise<BridgeResult<HighConsequenceActivationSummary>> { return this.unavailable(); }
  listHighConsequenceActivations(): Promise<BridgeResult<readonly HighConsequenceActivationSummary[]>> { return this.unavailable(); }
  revokeHighConsequenceActivation(): Promise<BridgeResult<boolean>> { return this.unavailable(); }
  installScannerTrust(): Promise<BridgeResult<ScannerTrustSummary>> { return this.unavailable(); }
  listScannerTrust(): Promise<BridgeResult<readonly ScannerTrustSummary[]>> { return this.unavailable(); }
  revokeScannerTrust(): Promise<BridgeResult<boolean>> { return this.unavailable(); }
  installScannerFixture(): Promise<BridgeResult<ScannerFixtureSummary>> { return this.unavailable(); }
  listScannerFixtures(): Promise<BridgeResult<readonly ScannerFixtureSummary[]>> { return this.unavailable(); }
  revokeScannerFixture(): Promise<BridgeResult<boolean>> { return this.unavailable(); }
  installProviderDesktop(): Promise<BridgeResult<ProviderInstallationSummary>> { return this.unavailable(); }
  listProviderDesktops(): Promise<BridgeResult<readonly ProviderInstallationSummary[]>> { return this.unavailable(); }
  revokeProviderDesktop(): Promise<BridgeResult<ProviderInstallationSummary>> { return this.unavailable(); }
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

export function forwardedWorkflowOutcome(result: ForwardedCommandResult): ForwardedWorkflowOutcome | undefined {
  return isWorkflowOutcomeData(result.data) ? result.data : undefined;
}

export function forwardedWorkflowResult(result: ForwardedCommandResult): ExtensionWorkflowProviderResult | undefined {
  return forwardedWorkflowOutcome(result)?.workflowResult;
}

export function forwardedHostAction(result: ForwardedCommandResult): ForwardedHostAction | undefined {
  const id = result.data?.hostActionId;
  const kind = result.data?.hostActionKind;
  const expiresAt = result.data?.hostActionExpiresAt;
  const url = result.data?.hostActionUrl;
  const workspaceRoot = result.data?.hostActionWorkspaceRoot;
  const debugConfiguration = result.data?.hostActionDebugConfiguration;
  const pythonInterpreter = result.data?.hostActionPythonInterpreter;
  const githubCandidates = result.data?.githubCandidates;
  const managedTerminalProfile = result.data?.managedTerminalProfile;
  if (typeof id !== "string" || !/^host-action:[a-f0-9]{64}$/.test(id)
    || typeof kind !== "string" || !isLocalHostAction(kind)
    || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))
    || (url !== undefined && typeof url !== "string")
    || (workspaceRoot !== undefined && (typeof workspaceRoot !== "string" || workspaceRoot.length > 4_096 || /[\r\n\0]/.test(workspaceRoot)))
    || (debugConfiguration !== undefined && (typeof debugConfiguration !== "string" || !debugConfiguration.trim() || debugConfiguration.length > 256 || /[\r\n\0]/.test(debugConfiguration)))
    || (pythonInterpreter !== undefined && (typeof pythonInterpreter !== "string" || pythonInterpreter.length > 4_096 || /[\r\n\0]/.test(pythonInterpreter)))
    || (kind === "select_github_navigation" ? !isGitHubCandidates(githubCandidates) || url !== undefined : githubCandidates !== undefined)
    || (kind === "create_claude_terminal" || kind === "create_codex_terminal"
      ? !isManagedTerminalProfile(managedTerminalProfile, kind === "create_claude_terminal" ? "claude_code" : "codex")
      : managedTerminalProfile !== undefined)) return undefined;
  return { id, kind, expiresAt, ...(typeof url === "string" ? { url } : {}), ...(typeof workspaceRoot === "string" ? { workspaceRoot } : {}), ...(typeof debugConfiguration === "string" ? { debugConfiguration } : {}), ...(typeof pythonInterpreter === "string" ? { pythonInterpreter } : {}), ...(isGitHubCandidates(githubCandidates) ? { githubCandidates } : {}), ...(isManagedTerminalProfile(managedTerminalProfile) ? { managedTerminalProfile } : {}) };
}

function isLocalHostAction(value: string): value is LocalHostAction {
  return [
    "show_handoff_queue", "toggle_handoff_routing", "show_blocker_queue", "show_done_queue",
    "open_external_url", "create_claude_terminal", "create_codex_terminal", "focus_vscode",
    "new_vscode_window", "focus_external_terminal", "focus_integrated_terminal", "open_compound_palette",
    "show_voice_center", "switch_voice_provider", "show_voice_session_picker", "show_pipeline_failure_trace", "start_vscode_debug", "configure_python_venv", "select_github_navigation"
  ].includes(value);
}

function isGitHubCandidates(value: unknown): value is readonly GitHubNavigationCandidate[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return false;
  const ids = new Set<string>();
  return value.every((candidate) => isRecord(candidate) && exactKeys(candidate, ["id", "label", "description", "url"])
    && typeof candidate.id === "string" && /^(?:pull|run):[A-Za-z0-9._:-]{1,128}$/.test(candidate.id) && !ids.has(candidate.id) && !!ids.add(candidate.id)
    && typeof candidate.label === "string" && !!candidate.label.trim() && candidate.label.length <= 160 && !/[\r\n\0]/.test(candidate.label)
    && typeof candidate.description === "string" && !!candidate.description.trim() && candidate.description.length <= 512 && !/[\r\n\0]/.test(candidate.description)
    && typeof candidate.url === "string" && trustedHttpsUrl(candidate.url));
}

function isAcceptanceTrust(value: unknown): value is AcceptanceTrustSummary {
  return isRecord(value) && exactKeys(value, ["schema", "version", "authorityId", "keyId", "publicKeyPem", "allowedGates", "expiresAt", "installedAt", "installedBy", "status"])
    && value.schema === "sxsy-b122.acceptance-trust-policy" && value.version === 1 && reference(value.authorityId) && digestText(value.keyId)
    && contentText(value.publicKeyPem, 16_384) && Array.isArray(value.allowedGates) && value.allowedGates.length > 0 && value.allowedGates.length <= 27
    && new Set(value.allowedGates).size === value.allowedGates.length && value.allowedGates.every((gate) => Number.isInteger(gate) && gate >= 1 && gate <= 27)
    && timeText(value.expiresAt) && timeText(value.installedAt) && contentText(value.installedBy, 160) && (value.status === "active" || value.status === "revoked");
}

function isAcceptanceEvidence(value: unknown): value is AcceptanceEvidenceSummary {
  return isRecord(value) && allowedExactKeys(value, ["id", "gate", "status", "evidenceDigest", "policyVersion", "evaluatedBy", "evaluatedAt", "rationale"], ["targetSnapshotId", "operationId", "evidenceReference", "expiresAt", "invalidatedAt", "invalidatedReason"])
    && reference(value.id) && Number.isInteger(value.gate) && Number(value.gate) >= 1 && Number(value.gate) <= 27
    && ["passed", "failed", "unavailable", "incomplete"].includes(value.status as string) && contentText(value.evidenceDigest, 512)
    && reference(value.policyVersion) && contentText(value.evaluatedBy, 160) && timeText(value.evaluatedAt) && contentText(value.rationale, 4_096)
    && [value.targetSnapshotId, value.operationId].every((item) => item === undefined || reference(item))
    && (value.evidenceReference === undefined || pathText(value.evidenceReference))
    && [value.expiresAt, value.invalidatedAt].every((item) => item === undefined || timeText(item))
    && (value.invalidatedReason === undefined || contentText(value.invalidatedReason, 2_048));
}

function isHighConsequenceActivation(value: unknown): value is HighConsequenceActivationSummary {
  return isRecord(value) && exactKeys(value, ["id", "action", "targetSnapshotId", "policyVersion", "gateEvidenceIds", "activatedAt", "expiresAt", "activatedBy", "status"])
    && reference(value.id) && reference(value.action) && reference(value.targetSnapshotId) && reference(value.policyVersion)
    && Array.isArray(value.gateEvidenceIds) && value.gateEvidenceIds.length > 0 && value.gateEvidenceIds.length <= 27 && new Set(value.gateEvidenceIds).size === value.gateEvidenceIds.length && value.gateEvidenceIds.every(reference)
    && timeText(value.activatedAt) && timeText(value.expiresAt) && contentText(value.activatedBy, 160) && (value.status === "active" || value.status === "revoked");
}

function isScannerTrust(value: unknown): value is ScannerTrustSummary {
  return isRecord(value) && exactKeys(value, ["schema", "version", "authorityId", "keyId", "publicKeyPem", "allowedKinds", "expiresAt", "installedAt", "installedBy", "status"])
    && value.schema === "sxsy-b122.scanner-fixture-trust" && value.version === 1 && reference(value.authorityId) && digestText(value.keyId) && contentText(value.publicKeyPem, 16_384)
    && Array.isArray(value.allowedKinds) && value.allowedKinds.length > 0 && value.allowedKinds.length <= 2 && new Set(value.allowedKinds).size === value.allowedKinds.length && value.allowedKinds.every((kind) => kind === "scanner" || kind === "advisory")
    && timeText(value.expiresAt) && timeText(value.installedAt) && contentText(value.installedBy, 160) && (value.status === "active" || value.status === "revoked");
}

function isScannerFixture(value: unknown): value is ScannerFixtureSummary {
  return isRecord(value) && exactKeys(value, ["id", "kind", "packageRoot", "manifestSha256", "installedAt", "installedBy", "status"])
    && reference(value.id) && (value.kind === "scanner" || value.kind === "advisory") && pathText(value.packageRoot) && digestText(value.manifestSha256)
    && timeText(value.installedAt) && contentText(value.installedBy, 160) && (value.status === "active" || value.status === "revoked");
}

function isProviderInstallation(value: unknown): value is ProviderInstallationSummary {
  if (!isRecord(value) || !exactKeys(value, ["provider", "installationId", "catalogDigest", "identity", "operator", "installedAt", "statusAt", "status"])
    || !providerDesktopId(value.provider) || !reference(value.installationId) || !digestText(value.catalogDigest)
    || !contentText(value.operator, 160) || !timeText(value.installedAt) || !timeText(value.statusAt)
    || (value.status !== "active" && value.status !== "stale" && value.status !== "revoked") || !isRecord(value.identity)
    || !exactKeys(value.identity, ["canonicalExecutablePath", "executableSha256", "signerSubject", "signerThumbprint", "productIdentity", "size", "modifiedMs", "device", "inode"])
    || !absoluteExecutable(value.identity.canonicalExecutablePath) || !digestText(value.identity.executableSha256)
    || !contentText(value.identity.signerSubject, 512) || typeof value.identity.signerThumbprint !== "string" || !/^[a-f0-9]{40,128}$/.test(value.identity.signerThumbprint)
    || !Number.isSafeInteger(value.identity.size) || (value.identity.size as number) <= 0
    || !Number.isFinite(value.identity.modifiedMs) || !uint64Decimal(value.identity.device) || !uint64Decimal(value.identity.inode)
    || !isProviderProductIdentity(value.identity.productIdentity, value.provider)) return false;
  return true;
}

function isManagedTerminalProfile(value: unknown, expectedProvider?: "claude_code" | "codex"): value is ManagedTerminalProfileSummary {
  return isRecord(value) && exactKeys(value, ["provider", "profileName", "canonicalLauncherPath", "launcherSha256", "launcherProtocolVersion", "canonicalExecutablePath", "executableSha256", "signerSubject", "signerThumbprint", "executableSize", "executableModifiedMs", "executableDevice", "executableInode", "productIdentity", "args", "shell", "installationId", "catalogDigest", "issuedAt", "validUntil", "requiresFinalIdentityVerification"])
    && (value.provider === "claude_code" || value.provider === "codex") && (expectedProvider === undefined || value.provider === expectedProvider)
    && value.profileName === (value.provider === "claude_code" ? "SXSY-B122 Claude Code" : "SXSY-B122 Codex")
    && absoluteExecutable(value.canonicalLauncherPath) && digestText(value.launcherSha256) && value.launcherProtocolVersion === 1
    && absoluteExecutable(value.canonicalExecutablePath) && digestText(value.executableSha256)
    && contentText(value.signerSubject, 512) && typeof value.signerThumbprint === "string" && /^[a-f0-9]{40,128}$/.test(value.signerThumbprint)
    && Number.isSafeInteger(value.executableSize) && (value.executableSize as number) > 0 && (value.executableSize as number) <= 2 * 1024 * 1024 * 1024
    && Number.isFinite(value.executableModifiedMs) && (value.executableModifiedMs as number) >= 0
    && uint64Decimal(value.executableDevice) && uint64Decimal(value.executableInode)
    && isProviderProductIdentity(value.productIdentity, value.provider) && value.productIdentity.role === "managed_terminal"
    && Array.isArray(value.args) && value.args.length === 0 && value.shell === false && reference(value.installationId) && digestText(value.catalogDigest)
    && timeText(value.issuedAt) && timeText(value.validUntil) && Date.parse(value.validUntil) > Date.parse(value.issuedAt)
    && Date.parse(value.validUntil) - Date.parse(value.issuedAt) <= 30_000 && value.requiresFinalIdentityVerification === true;
}

function isProviderProductIdentity(value: unknown, expectedProvider?: ProviderDesktopId): value is ProviderProductIdentitySummary {
  if (!isRecord(value) || !exactKeys(value, ["productId", "displayName", "publisher", "role"])) return false;
  if (expectedProvider === undefined) return reference(value.productId) && contentText(value.displayName, 160) && contentText(value.publisher, 160) && (value.role === "desktop" || value.role === "managed_terminal");
  const expected = expectedProvider === "claude_desktop"
    ? ["anthropic.claude-desktop", "Claude Desktop", "Anthropic, PBC", "desktop"]
    : expectedProvider === "chatgpt_desktop"
      ? ["openai.chatgpt-desktop", "ChatGPT Desktop", "OpenAI, L.L.C.", "desktop"]
      : expectedProvider === "claude_code"
        ? ["anthropic.claude-code", "Claude Code", "Anthropic, PBC", "managed_terminal"]
        : ["openai.codex", "Codex", "OpenAI, L.L.C.", "managed_terminal"];
  return value.productId === expected[0] && value.displayName === expected[1] && value.publisher === expected[2] && value.role === expected[3];
}

function providerDesktopId(value: unknown): value is ProviderDesktopId { return value === "claude_desktop" || value === "chatgpt_desktop" || value === "claude_code" || value === "codex"; }
function absoluteExecutable(value: unknown): value is string { return typeof value === "string" && value.length <= 160 && /^(?:[A-Za-z]:[\\/]|\/)/.test(value) && !/^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/.test(value) && /\.exe$/i.test(value) && !/[\r\n\0]/.test(value); }

function digestText(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function uint64Decimal(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n;
}

function trustedHttpsUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && url.hash === ""; }
  catch { return false; }
}

function trustedHostActionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || !url.hostname || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch { return false; }
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

function isCredentialReferenceSummary(value: unknown): value is CredentialReferenceSummary {
  if (!isRecord(value) || !allowedExactKeys(value, ["reference", "protectorProvider", "generation", "createdAt", "updatedAt", "scopes"], ["revokedAt", "revocationReason"])
    || !credentialIdentifier(value.reference) || !reference(value.protectorProvider)
    || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1
    || !timeText(value.createdAt) || !timeText(value.updatedAt)
    || !Array.isArray(value.scopes) || value.scopes.length < 1 || value.scopes.length > 64 || !value.scopes.every(isCredentialScope)
    || (value.revokedAt !== undefined && !timeText(value.revokedAt))
    || (value.revocationReason !== undefined && !contentText(value.revocationReason, 256))
    || (value.revokedAt === undefined) !== (value.revocationReason === undefined)) return false;
  const identities = (value.scopes as CredentialProvisionScope[]).map(credentialScopeIdentity);
  return new Set(identities).size === identities.length;
}

function isCredentialScope(value: unknown): value is CredentialProvisionScope {
  return isRecord(value) && exactKeys(value, ["repositoryRoot", "adapterId", "purpose"])
    && pathText(value.repositoryRoot) && credentialIdentifier(value.adapterId) && credentialIdentifier(value.purpose);
}

function sameCredentialScopes(left: readonly CredentialProvisionScope[], right: readonly CredentialProvisionScope[]): boolean {
  return left.length === right.length && left.every((scope, index) => credentialScopeIdentity(scope) === credentialScopeIdentity(right[index]!));
}

function credentialScopeIdentity(scope: CredentialProvisionScope): string {
  return `${scope.repositoryRoot.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()}\0${scope.adapterId}\0${scope.purpose}`;
}

function credentialIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
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
  return isRecord(value) && allowedExactKeys(value, ["status", "summary"], ["operationId", "effectDisposition", "data"])
    && ["queued", "running", "awaiting_input", "awaiting_confirmation", "cancelling", "completed", "failed", "timed_out", "unavailable", "incomplete", "blocked", "cancelled"].includes(value.status as string)
    && typeof value.summary === "string" && boundedText(value.summary, 512)
    && (value.operationId === undefined || reference(value.operationId))
    && (value.effectDisposition === undefined || value.effectDisposition === "not_started" || value.effectDisposition === "committed" || value.effectDisposition === "ambiguous")
    && (value.data === undefined || (isRecord(value.data) && (!hasWorkflowOutcomeMarker(value.data) || isWorkflowOutcomeData(value.data))));
}

function hasWorkflowOutcomeMarker(value: Readonly<Record<string, unknown>>): boolean {
  return value.workflowResult !== undefined || value.resultKind !== undefined;
}

function isWorkflowOutcomeData(value: unknown): value is ForwardedWorkflowOutcome {
  if (!isRecord(value) || !allowedExactKeys(value, ["artifactId", "artifactDigest", "resultKind", "workflowResult", "providerSummary"], ["externalId"])
    || !reference(value.artifactId) || !sha256Text(value.artifactDigest) || !isWorkflowProviderResult(value.workflowResult)
    || value.resultKind !== value.workflowResult.kind || !workflowBoundedText(value.providerSummary, 1_024)
    || (value.externalId !== undefined && !workflowBoundedText(value.externalId, 256))) return false;
  return true;
}

function isWorkflowProviderResult(value: unknown): value is ExtensionWorkflowProviderResult {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "anchor":
      return exactKeys(value, ["kind", "anchorDigest", "discrepancies", "questions", "resumed"])
        && sha256Text(value.anchorDigest) && workflowTextList(value.discrepancies, true) && workflowTextList(value.questions, true) && value.resumed === false;
    case "proof": {
      if (!exactKeys(value, ["kind", "verifiedClaims", "evidenceReferences", "backendResults"])
        || !workflowTextList(value.verifiedClaims, true) || !workflowTextList(value.evidenceReferences, true)
        || !Array.isArray(value.backendResults) || value.backendResults.length < 1 || value.backendResults.length > 512) return false;
      const backends: string[] = [];
      for (const item of value.backendResults) {
        if (!isRecord(item) || !exactKeys(item, ["backend", "status"]) || !workflowBoundedText(item.backend, 128)
          || (item.status !== "passed" && item.status !== "failed" && item.status !== "unavailable")) return false;
        backends.push(item.backend);
      }
      return new Set(backends).size === backends.length;
    }
    case "decision": {
      if (!exactKeys(value, ["kind", "decisionPacketId", "decisions", "userSelectionRequired"])
        || !workflowBoundedText(value.decisionPacketId, 256) || value.userSelectionRequired !== true
        || !Array.isArray(value.decisions) || value.decisions.length < 1 || value.decisions.length > 64) return false;
      const decisionIds: string[] = [];
      for (const decision of value.decisions) {
        if (!isRecord(decision) || !exactKeys(decision, ["decisionId", "options", "recommendationId"])
          || !workflowIdentifier(decision.decisionId) || !workflowIdentifier(decision.recommendationId)
          || !Array.isArray(decision.options) || decision.options.length < 2 || decision.options.length > 15) return false;
        const optionIds: string[] = [];
        for (const option of decision.options) {
          if (!isRecord(option) || !exactKeys(option, ["id", "label", "tradeoffs", "risks"]) || !workflowIdentifier(option.id)
            || !workflowBoundedText(option.label, 16_384)
            || !workflowTextList(option.tradeoffs, false) || !workflowTextList(option.risks, false)) return false;
          optionIds.push(option.id);
        }
        if (new Set(optionIds).size !== optionIds.length || !optionIds.includes(decision.recommendationId)) return false;
        decisionIds.push(decision.decisionId);
      }
      return new Set(decisionIds).size === decisionIds.length;
    }
    case "plan": {
      if (value.mode === "expanded") {
        if (!exactKeys(value, ["kind", "mode", "planDigest", "alternatives"]) || !sha256Text(value.planDigest)
          || !Array.isArray(value.alternatives) || value.alternatives.length !== 15) return false;
        const ids: string[] = [];
        for (const [index, alternative] of value.alternatives.entries()) {
          if (!isRecord(alternative) || !exactKeys(alternative, ["rank", "id", "summary", "rationale", "risks"])
            || alternative.rank !== index + 1 || !workflowIdentifier(alternative.id)
            || !workflowBoundedText(alternative.summary, 16_384)
            || !workflowBoundedText(alternative.rationale, 16_384)
            || !workflowTextList(alternative.risks, true)) return false;
          ids.push(alternative.id);
        }
        return new Set(ids).size === ids.length;
      }
      return value.mode === "execution_ack"
        && exactKeys(value, ["kind", "mode", "planDigest", "planRevision", "originSessionId", "executorSessionId", "authorityId", "acknowledgementId", "executionStarted"])
        && sha256Text(value.planDigest) && workflowIdentifier(value.planRevision) && workflowIdentifier(value.originSessionId)
        && workflowIdentifier(value.executorSessionId) && workflowIdentifier(value.authorityId)
        && workflowBoundedText(value.acknowledgementId, 256) && value.executionStarted === true;
    }
    case "handoff":
      return exactKeys(value, ["kind", "packageId", "recipientSessionId", "acknowledged"])
        && workflowIdentifier(value.packageId) && workflowIdentifier(value.recipientSessionId) && typeof value.acknowledged === "boolean";
    case "focus":
      return exactKeys(value, ["kind", "selectedSessionId", "status", "queueCycleId", "resultDelivered"])
        && workflowIdentifier(value.selectedSessionId) && (value.status === "verified_blocked" || value.status === "verified_finished")
        && workflowIdentifier(value.queueCycleId) && value.resultDelivered === true;
    case "authority": {
      if (!exactKeys(value, ["kind", "acknowledgements"]) || !Array.isArray(value.acknowledgements)
        || value.acknowledgements.length < 1 || value.acknowledgements.length > 64) return false;
      const recipients: string[] = [];
      for (const acknowledgement of value.acknowledgements) {
        if (!isRecord(acknowledgement) || !exactKeys(acknowledgement, ["recipientSessionId", "grantId", "matchDigest", "acknowledged"])
          || !workflowIdentifier(acknowledgement.recipientSessionId) || !workflowIdentifier(acknowledgement.grantId)
          || !sha256Text(acknowledgement.matchDigest) || acknowledgement.acknowledged !== true) return false;
        recipients.push(acknowledgement.recipientSessionId);
      }
      return new Set(recipients).size === recipients.length;
    }
    case "voice_binding":
      return exactKeys(value, ["kind", "bindingId", "active"]) && workflowBoundedText(value.bindingId, 256) && typeof value.active === "boolean";
    default: return false;
  }
}

function workflowTextList(value: unknown, emptyAllowed: boolean): value is readonly string[] {
  if (!Array.isArray(value) || value.length > 512 || (!emptyAllowed && value.length === 0)
    || !value.every((item) => workflowBoundedText(item, 16_384))) return false;
  return new Set(value).size === value.length;
}

function workflowIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function workflowBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= maximum && !/[\r\n\0]/.test(value);
}

function sha256Text(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }

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
