import assert from "node:assert/strict";
import test from "node:test";
import {
  type BridgeResult,
  type ExtensionCompanionBridge,
  type ExtensionManagedSession,
  type ExtensionProvider,
  type ExtensionSessionStatus,
  type ForwardedCommand,
  type ForwardedCommandResult,
  type LocalHostAction,
  type PreparedCommand,
  type GitReviewResult,
  type ReviewedGitMutation,
  type RepositoryRuntimePin,
  type SandboxInstallationPin,
  type CredentialReferenceSummary,
  type InstalledNetworkPolicy,
  type RawHidDeviceIdentity,
  type RawHidInstallationPin,
  type RawHidRuntimeStatus,
  type HardwareSignalClaim,
  type HardwareSignalDispatchResult,
  type HardwareSignalPreparationResult,
  type HardwareSignalCompletionResult,
  type ExtensionHandoffPackage,
  type ExtensionWorkflowAction,
  type ExtensionWorkflowArtifact,
  type ExtensionVoiceProvider,
  type ExtensionVoiceConsent,
  type ExtensionVoiceBinding,
  UnavailableExtensionCompanionBridge
} from "../src/companion-bridge.ts";
import { ManagedSessionController } from "../src/controller.ts";
import { chordFor, type B122Control, type B122Modifier } from "../src/commands.ts";
import type { DebugConfigurationLike, DebugSessionLike, DisposableLike, ExtensionContextLike, QuickPickItemLike, TerminalLike, VscodeLike, WorkspaceFolderLike } from "../src/vscode-like.ts";

class FakeDisposable implements DisposableLike { dispose(): void {} }

class FakeTerminal implements TerminalLike {
  readonly sent: string[] = [];
  shown = 0;
  readonly name: string;
  constructor(name: string) { this.name = name; }
  show(): void { this.shown += 1; }
  sendText(text: string): void { this.sent.push(text); }
}

class FakeContext implements ExtensionContextLike {
  readonly subscriptions: DisposableLike[] = [];
  readonly values = new Map<string, unknown>();
  readonly workspaceState = {
    get: <T>(key: string): T | undefined => this.values.get(key) as T | undefined,
    update: async (key: string, value: unknown): Promise<void> => { this.values.set(key, value); }
  };
}

class FakeVscode {
  readonly commandCallbacks = new Map<string, (...args: unknown[]) => unknown>();
  readonly executedCommands: string[] = [];
  readonly information: string[] = [];
  readonly warnings: string[] = [];
  readonly createdTerminals: FakeTerminal[] = [];
  readonly started: Array<{ folder: WorkspaceFolderLike | undefined; configuration: DebugConfigurationLike; noDebug?: boolean }> = [];
  readonly stopped: DebugSessionLike[] = [];
  readonly configurationUpdates: Array<{ section: string; key: string; value: unknown; target?: boolean | number | null }> = [];
  readonly terminalOptions: Array<{ name: string; cwd?: string; env?: Readonly<Record<string, string | null | undefined>> }> = [];
  readonly terminals: FakeTerminal[];
  activeTerminal?: FakeTerminal;
  workspaceFolders: WorkspaceFolderLike[];
  debugConfigurations: DebugConfigurationLike[] = [{ name: "Launch test", type: "node", request: "launch" }];
  focused = true;
  private readonly openListeners: Array<(terminal: TerminalLike) => unknown> = [];
  private readonly closeListeners: Array<(terminal: TerminalLike) => unknown> = [];
  private readonly workspaceListeners: Array<() => unknown> = [];
  private readonly debugStartListeners: Array<(session: DebugSessionLike) => unknown> = [];
  private readonly debugStopListeners: Array<(session: DebugSessionLike) => unknown> = [];
  private readonly focusListeners: Array<(state: { readonly focused: boolean }) => unknown> = [];
  private readonly quickPickValues: string[] = [];
  private readonly inputValues: string[] = [];
  readonly api: VscodeLike;

  constructor(terminalNames = ["Manual terminal"], workspaceRoots = ["C:\\repo"]) {
    this.terminals = terminalNames.map((name) => new FakeTerminal(name));
    this.activeTerminal = this.terminals[0];
    this.workspaceFolders = workspaceRoots.map((fsPath) => ({ uri: { fsPath } }));
    const self = this;
    this.api = {
      commands: {
        registerCommand(command, callback): DisposableLike {
          self.commandCallbacks.set(command, callback);
          return new FakeDisposable();
        },
        async executeCommand(command): Promise<void> { self.executedCommands.push(command); }
      },
      window: {
        get state(): { readonly focused: boolean } { return { focused: self.focused }; },
        get terminals(): readonly TerminalLike[] { return self.terminals; },
        get activeTerminal(): TerminalLike | undefined { return self.activeTerminal; },
        createTerminal(options): TerminalLike {
          self.terminalOptions.push(options);
          const terminal = new FakeTerminal(options.name);
          self.createdTerminals.push(terminal);
          self.terminals.push(terminal);
          self.activeTerminal = terminal;
          return terminal;
        },
        async showInformationMessage(message): Promise<string | undefined> { self.information.push(message); return undefined; },
        async showWarningMessage(message): Promise<string | undefined> { self.warnings.push(message); return undefined; },
        async showQuickPick<T extends string | QuickPickItemLike>(items: readonly T[]): Promise<T | undefined> {
          const wanted = self.quickPickValues.shift();
          if (!wanted) return undefined;
          return items.find((item) => typeof item === "string" ? item === wanted : item.label === wanted);
        },
        async showInputBox(): Promise<string | undefined> { return self.inputValues.shift(); },
        onDidOpenTerminal(listener): DisposableLike { self.openListeners.push(listener); return new FakeDisposable(); },
        onDidCloseTerminal(listener): DisposableLike { self.closeListeners.push(listener); return new FakeDisposable(); },
        onDidChangeWindowState(listener): DisposableLike { self.focusListeners.push(listener); return new FakeDisposable(); }
      },
      workspace: {
        get workspaceFolders(): readonly WorkspaceFolderLike[] { return self.workspaceFolders; },
        getConfiguration(section = ""): { get<T>(key: string): T | undefined; update(key: string, value: unknown, target?: boolean | number | null): Promise<void> } {
          return {
            get: <T>(key: string): T | undefined => section === "launch" && key === "configurations" ? self.debugConfigurations as T : undefined,
            update: async (key, value, target) => { self.configurationUpdates.push({ section, key, value, ...(target !== undefined ? { target } : {}) }); }
          };
        },
        onDidChangeWorkspaceFolders(listener): DisposableLike { self.workspaceListeners.push(listener); return new FakeDisposable(); }
      },
      debug: {
        async startDebugging(folder, configuration, options): Promise<boolean> { self.started.push({ folder, configuration: typeof configuration === "string" ? { name: configuration } : configuration, noDebug: options?.noDebug }); return true; },
        onDidStartDebugSession(listener): DisposableLike { self.debugStartListeners.push(listener); return new FakeDisposable(); },
        onDidTerminateDebugSession(listener): DisposableLike { self.debugStopListeners.push(listener); return new FakeDisposable(); }
      }
    };
  }

  async invoke(command: string, ...args: unknown[]): Promise<void> {
    const callback = this.commandCallbacks.get(command);
    assert.ok(callback, `expected command ${command}`);
    await callback(...args);
  }

  async fireOpen(terminal: FakeTerminal): Promise<void> { for (const listener of this.openListeners) await listener(terminal); }
  async fireWorkspaceChange(): Promise<void> { for (const listener of this.workspaceListeners) await listener(); }
  async fireDebugStart(session: DebugSessionLike): Promise<void> { for (const listener of this.debugStartListeners) await listener(session); }
  async fireDebugStop(session: DebugSessionLike): Promise<void> { for (const listener of this.debugStopListeners) await listener(session); }
  async fireFocus(focused: boolean): Promise<void> { this.focused = focused; for (const listener of this.focusListeners) await listener({ focused }); }
  choose(value: string): void { this.quickPickValues.push(value); }
  input(value: string): void { this.inputValues.push(value); }
}

class FakeBridge implements ExtensionCompanionBridge {
  readonly registered: ExtensionManagedSession[] = [];
  readonly heartbeats: Array<{ sessionId: string; at?: string }> = [];
  listedSessions?: readonly ExtensionManagedSession[];
  readonly adopted: Array<{ sessionId: string; adoptionKey: string; provider: Exclude<ExtensionProvider, "voice"> }> = [];
  readonly statuses: Array<{ sessionId: string; status: ExtensionSessionStatus }> = [];
  readonly dispatched: ForwardedCommand[] = [];
  readonly completedHostActions: Array<{ id: string; succeeded: boolean; summary: string; adapterVersion: string }> = [];
  readonly authorizedHostActions: Array<{ id: string; adapterVersion: string }> = [];
  readonly prepared: Array<{ control: string; modifier: string; sessionId?: string; reason: string }> = [];
  readonly gitReviews: Array<{ action: "local_commit" | "pr_upsert" | "pr_merge" | "direct_main"; sessionId: string; mutation: ReviewedGitMutation }> = [];
  readonly hardwarePrepared: HardwareSignalClaim[] = [];
  readonly hardwareDispatched: HardwareSignalClaim[] = [];
  readonly hardwareCompleted: Array<{ claim: HardwareSignalClaim; outcome: string; dispatchReceiptId?: string }> = [];
  readonly hardwareClaims: HardwareSignalClaim[] = [];
  readonly hardwareClaimBindings: Array<{ windowSessionId: string; workspaceRoots: readonly string[]; focused: true }> = [];
  readonly rawHidInstallRequests: RawHidDeviceIdentity[] = [];
  readonly workflowPrepared: Array<{ action: ExtensionWorkflowAction; sessionId: string; payload: Readonly<Record<string, unknown>> }> = [];
  nextDispatch?: ForwardedCommandResult;
  nextPreparation?: PreparedCommand;
  onHardwareClaim?: () => void;

  async health(): Promise<BridgeResult<Readonly<{ status?: string }>>> { return { ok: true, value: { status: "healthy" } }; }
  async listSessions(): Promise<BridgeResult<readonly ExtensionManagedSession[]>> { return { ok: true, value: this.listedSessions ?? this.registered }; }
  async registerSession(session: ExtensionManagedSession): Promise<BridgeResult<ExtensionManagedSession>> {
    this.registered.push(session);
    return { ok: true, value: session };
  }
  async adoptTerminal(sessionId: string, adoptionKey: string, provider: Exclude<ExtensionProvider, "voice">): Promise<BridgeResult<ExtensionManagedSession>> {
    this.adopted.push({ sessionId, adoptionKey, provider });
    const existing = this.registered.find((session) => session.id === sessionId);
    assert.ok(existing);
    return { ok: true, value: { ...existing, provider, metadata: { ...existing.metadata, adopted: "true" } } };
  }
  async updateStatus(sessionId: string, status: ExtensionSessionStatus): Promise<BridgeResult<ExtensionManagedSession>> {
    this.statuses.push({ sessionId, status });
    const existing = this.registered.find((session) => session.id === sessionId);
    return existing ? { ok: true, value: { ...existing, status } } : { ok: false, code: "not_found", message: "missing" };
  }
  async heartbeat(session: string, at?: string): Promise<BridgeResult<ExtensionManagedSession>> {
    this.heartbeats.push({ sessionId: session, ...(at ? { at } : {}) });
    const existing = this.registered.find((record) => record.id === session);
    return existing ? { ok: true, value: { ...existing, lastHeartbeat: at ?? existing.lastHeartbeat } } : { ok: false, code: "not_found", message: "missing" };
  }
  async dispatch(command: ForwardedCommand): Promise<BridgeResult<ForwardedCommandResult>> {
    this.dispatched.push(command);
    if (this.nextDispatch) return { ok: true, value: this.nextDispatch };
    const action = directAction(command);
    return action
      ? { ok: true, value: { status: "running", summary: "Awaiting host acknowledgement.", data: { hostActionId: `host-action:${"a".repeat(64)}`, hostActionKind: action, hostActionExpiresAt: "2099-01-01T00:00:00.000Z" } } }
      : { ok: true, value: { status: "completed", summary: "Routed by fake companion." } };
  }
  async prepareCommand(command: { control: B122Control; modifier: B122Modifier; sessionId?: string; reason: string }): Promise<BridgeResult<PreparedCommand>> {
    this.prepared.push(command);
    return { ok: true, value: this.nextPreparation ?? { status: "prepared", summary: "Prepared by fake companion.", authorityId: "authority-test", confirmationToken: "confirmation-test" } };
  }
  async inspectGitReview(sessionId: string) {
    const session = this.registered.find((candidate) => candidate.id === sessionId);
    if (!session?.workspaceRoot) return { ok: false, code: "not_found", message: "missing" } as const;
    const branch = session.metadata["sxsy-b122.branch"];
    return { ok: true, value: { repositoryRoot: session.workspaceRoot, targetSnapshotId: session.targetSnapshotId ?? "snapshot-review", ...(branch && branch !== "unknown" ? { branch } : {}), defaultBranch: "main", detached: !branch || branch === "unknown", changedPaths: ["src/safe.ts", "README.md"] } } as const;
  }
  async reviewGitMutation(request: { action: "local_commit" | "pr_upsert" | "pr_merge" | "direct_main"; sessionId: string; mutation: ReviewedGitMutation }): Promise<BridgeResult<GitReviewResult>> {
    this.gitReviews.push(request);
    return { ok: true, value: { status: "approved", summary: "Reviewed by fake companion." } };
  }
  async installRuntimePin(repositoryRoot: string, manifestPath: string): Promise<BridgeResult<RepositoryRuntimePin>> {
    return { ok: true, value: { canonicalRepositoryRoot: repositoryRoot, manifestPath, expectedSha256: "a".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", status: "active" } };
  }
  async listRuntimePins(): Promise<BridgeResult<readonly RepositoryRuntimePin[]>> { return { ok: true, value: [] }; }
  async revokeRuntimePin(repositoryRoot: string): Promise<BridgeResult<RepositoryRuntimePin>> {
    return { ok: true, value: { canonicalRepositoryRoot: repositoryRoot, manifestPath: "runtime.json", expectedSha256: "a".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", status: "revoked" } };
  }
  async installSandbox(repositoryRoot: string, catalogPath: string): Promise<BridgeResult<SandboxInstallationPin>> {
    return { ok: true, value: { canonicalRepositoryRoot: repositoryRoot, catalogPath, catalogSha256: "a".repeat(64), helperPath: "C:\\host\\b122-sandbox-worker.exe", helperSha256: "b".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", status: "active" } };
  }
  async listSandboxes(): Promise<BridgeResult<readonly SandboxInstallationPin[]>> { return { ok: true, value: [] }; }
  async revokeSandbox(repositoryRoot: string): Promise<BridgeResult<SandboxInstallationPin>> {
    return { ok: true, value: { canonicalRepositoryRoot: repositoryRoot, catalogPath: "C:\\repo\\sandbox.json", catalogSha256: "a".repeat(64), helperPath: "C:\\host\\b122-sandbox-worker.exe", helperSha256: "b".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", status: "revoked" } };
  }
  async provisionCredential(input: { reference: string; repositoryRoot: string; purposes: readonly string[]; sealedSecret: string; replaceExisting?: boolean }): Promise<BridgeResult<CredentialReferenceSummary>> { return { ok: true, value: { reference: input.reference, protectorProvider: "fake", generation: 1, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z", scopes: input.purposes.map((purpose) => ({ repositoryRoot: input.repositoryRoot, adapterId: "configured-network", purpose })) } }; }
  async listCredentials(): Promise<BridgeResult<readonly CredentialReferenceSummary[]>> { return { ok: true, value: [] }; }
  async revokeCredential(): Promise<BridgeResult<boolean>> { return { ok: true, value: true }; }
  async installNetworkPolicy(sourcePath: string): Promise<BridgeResult<InstalledNetworkPolicy>> { return { ok: true, value: { filePath: sourcePath, sha256: "a".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", status: "active" } }; }
  async currentNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy | undefined>> { return { ok: true, value: undefined }; }
  async revokeNetworkPolicy(): Promise<BridgeResult<InstalledNetworkPolicy>> { return { ok: true, value: { filePath: "C:\\state\\network-policy.json", sha256: "a".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", status: "revoked" } }; }
  async providerHandshake(sessionId: string, repositoryRoot: string): Promise<BridgeResult<ExtensionManagedSession>> {
    const existing = this.registered.find((session) => session.id === sessionId);
    return existing ? { ok: true, value: { ...existing, workspaceRoot: repositoryRoot, capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", adapterVersion: "fake-provider", metadata: { ...existing.metadata, "sxsy-b122.providerHandshake": "exact-route-v1" } } } : { ok: false, code: "not_found", message: "missing" };
  }
  async installRawHid(identity: RawHidDeviceIdentity): Promise<BridgeResult<Readonly<{ installation: RawHidInstallationPin; supervisor: RawHidRuntimeStatus["supervisor"] }>>> {
    this.rawHidInstallRequests.push(identity);
    return { ok: true, value: { installation: { identity, helperPath: "C:\\host\\strathex-b122-hid-helper.exe", helperSha256: "a".repeat(64), protocolVersion: 1, mapFingerprint: "0123456789abcdef", installedAt: "2026-08-24T00:00:00.000Z", status: "active" }, supervisor: { state: "running", generation: 1, detail: "ready" } } };
  }
  async listRawHid(): Promise<BridgeResult<readonly RawHidInstallationPin[]>> { return { ok: true, value: [] }; }
  async revokeRawHid(): Promise<BridgeResult<RawHidInstallationPin>> { return { ok: false, code: "not_found", message: "none" }; }
  async rawHidStatus(): Promise<BridgeResult<RawHidRuntimeStatus>> { return { ok: true, value: { supervisor: { state: "unprovisioned", generation: 0, detail: "none" }, inbox: { pending: 0, claimed: 0, completed: 0, needsReconciliation: 0 }, installations: [] } }; }
  async claimHardwareSignal(binding: { windowSessionId: string; workspaceRoots: readonly string[]; focused: true }): Promise<BridgeResult<HardwareSignalClaim | undefined>> { this.hardwareClaimBindings.push(binding); this.onHardwareClaim?.(); return { ok: true, value: this.hardwareClaims.shift() }; }
  async prepareHardwareSignal(claim: HardwareSignalClaim): Promise<BridgeResult<HardwareSignalPreparationResult>> {
    this.hardwarePrepared.push(claim);
    const preparation = this.nextPreparation ?? { status: "prepared" as const, summary: "Prepared by fake companion.", authorityId: "authority-test", confirmationToken: "confirmation-test" };
    return { ok: true, value: { preparation, ...(preparation.status === "prepared" ? {} : { dispositionReceiptId: `hardware-dispatch:${"d".repeat(64)}` }) } };
  }
  async dispatchHardwareSignal(claim: HardwareSignalClaim): Promise<BridgeResult<HardwareSignalDispatchResult>> {
    this.hardwareDispatched.push(claim);
    return { ok: true, value: { command: this.nextDispatch ?? { status: "completed", summary: "Routed by fake companion." }, dispatchReceiptId: `hardware-dispatch:${"e".repeat(64)}` } };
  }
  async completeHardwareSignal(claim: HardwareSignalClaim, completion: { outcome: "handled" | "failed_before_dispatch" | "needs_reconciliation"; dispatchReceiptId?: string }): Promise<BridgeResult<HardwareSignalCompletionResult>> {
    this.hardwareCompleted.push({ claim, outcome: completion.outcome, ...(completion.dispatchReceiptId ? { dispatchReceiptId: completion.dispatchReceiptId } : {}) });
    return { ok: true, value: { signalId: claim.signalId, outcome: completion.outcome } };
  }
  async createHandoff(input: { sessionId: string; recipientSessionId?: string; routing?: "queue" | "immediate" }): Promise<BridgeResult<ExtensionHandoffPackage>> {
    const session = this.registered.find((value) => value.id === input.sessionId);
    if (!session?.workspaceRoot || !session.targetSnapshotId || !session.taskId || !session.planRevision) return { ok: false, code: "not_found", message: "missing" };
    return { ok: true, value: { id: "handoff-test", digest: "a".repeat(64), repositoryRoot: session.workspaceRoot, targetSnapshotId: session.targetSnapshotId, taskId: session.taskId, planRevision: session.planRevision, ...(input.recipientSessionId ? { recipientSessionId: input.recipientSessionId } : {}), status: input.routing === "immediate" ? "immediate_focus_requested" : "queued", executionAuthorized: false } };
  }
  async listHandoffs(): Promise<BridgeResult<readonly ExtensionHandoffPackage[]>> { return { ok: true, value: [] }; }
  async acknowledgeHandoff(): Promise<BridgeResult<ExtensionHandoffPackage>> { return { ok: false, code: "not_found", message: "missing" }; }
  async cancelHandoff(): Promise<BridgeResult<ExtensionHandoffPackage>> { return { ok: false, code: "not_found", message: "missing" }; }
  async archiveHandoff(): Promise<BridgeResult<ExtensionHandoffPackage>> { return { ok: false, code: "not_found", message: "missing" }; }
  async handoffRouting(): Promise<BridgeResult<"queue" | "immediate">> { return { ok: true, value: "queue" }; }
  async setHandoffRouting(routing: "queue" | "immediate"): Promise<BridgeResult<"queue" | "immediate">> { return { ok: true, value: routing }; }
  async prepareWorkflow(input: { action: ExtensionWorkflowAction; sessionId: string; payload: Readonly<Record<string, unknown>> }): Promise<BridgeResult<ExtensionWorkflowArtifact>> { this.workflowPrepared.push(input); return { ok: true, value: { id: "workflow-test", digest: "b".repeat(64), action: input.action, targetSnapshotId: "snapshot-test", sessionId: input.sessionId, status: "prepared", executionAuthorized: false } }; }
  async listWorkflows(): Promise<BridgeResult<readonly ExtensionWorkflowArtifact[]>> { return { ok: true, value: [] }; }
  async grantVoiceConsent(input: { handoffId: string; provider: ExtensionVoiceProvider; transcript: "off" | "redacted"; retentionMinutes: number }): Promise<BridgeResult<ExtensionVoiceConsent>> { return { ok: true, value: { id: "voice-consent-test", contextPackageId: input.handoffId, contextDigest: "c".repeat(64), provider: input.provider, transcript: input.transcript, retentionMinutes: input.retentionMinutes, expiresAt: "2099-01-01T00:00:00.000Z" } }; }
  async startVoice(input: { consentId: string; voiceSessionId: string; managedSessionId?: string }): Promise<BridgeResult<ExtensionVoiceBinding>> { return { ok: true, value: { id: "voice-binding-test", consentId: input.consentId, voiceSessionId: input.voiceSessionId, ...(input.managedSessionId ? { managedSessionId: input.managedSessionId } : {}), repositoryRoot: "C:\\repo", targetSnapshotId: "snapshot-test", contextPackageId: "handoff-test", contextDigest: "c".repeat(64), provider: "claude", transcript: "off", retentionMinutes: 0, status: "active" } }; }
  async currentVoice(): Promise<BridgeResult<ExtensionVoiceBinding | undefined>> { return { ok: true, value: undefined }; }
  async switchVoice(input: { bindingId: string; consentId: string; voiceSessionId: string }): Promise<BridgeResult<ExtensionVoiceBinding>> { return { ok: true, value: { id: input.bindingId, consentId: input.consentId, voiceSessionId: input.voiceSessionId, repositoryRoot: "C:\\repo", targetSnapshotId: "snapshot-test", contextPackageId: "handoff-test", contextDigest: "c".repeat(64), provider: "claude", transcript: "off", retentionMinutes: 0, status: "active" } }; }
  async bindVoice(bindingId: string, managedSessionId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return { ok: true, value: { id: bindingId, consentId: "voice-consent-test", voiceSessionId: "voice-session-test", managedSessionId, repositoryRoot: "C:\\repo", targetSnapshotId: "snapshot-test", contextPackageId: "handoff-test", contextDigest: "c".repeat(64), provider: "claude", transcript: "off", retentionMinutes: 0, status: "active" } }; }
  async muteVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceState(bindingId, "muted"); }
  async resumeVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceState(bindingId, "active"); }
  async interruptVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceState(bindingId, "interrupted"); }
  async endVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceState(bindingId, "ended"); }
  async deleteVoiceTranscript(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceState(bindingId, "ended"); }
  private async voiceState(bindingId: string, status: ExtensionVoiceBinding["status"]): Promise<BridgeResult<ExtensionVoiceBinding>> { return { ok: true, value: { id: bindingId, consentId: "voice-consent-test", voiceSessionId: "voice-session-test", repositoryRoot: "C:\\repo", targetSnapshotId: "snapshot-test", contextPackageId: "handoff-test", contextDigest: "c".repeat(64), provider: "claude", transcript: "off", retentionMinutes: 0, status } }; }
  async authorizeHostAction(id: string, adapterVersion: string) {
    this.authorizedHostActions.push({ id, adapterVersion });
    return { ok: true, value: { hostActionId: id, authorizationToken: `host-action-auth:${"f".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z" } } as const;
  }
  async completeHostAction(id: string, succeeded: boolean, summary: string, adapterVersion: string, _authorizationToken?: string): Promise<BridgeResult<ForwardedCommandResult>> {
    this.completedHostActions.push({ id, succeeded, summary, adapterVersion });
    return { ok: true, value: { status: succeeded ? "completed" : "failed", summary } };
  }
}

test("registers VS Code window, workspace, terminals, and debug configurations without claiming mediation", async () => {
  const vscode = new FakeVscode();
  const context = new FakeContext();
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, context, bridge, {
    now: () => "2026-08-23T00:00:00.000Z",
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/safe", canonicalRemote: "https://example.invalid/acme/repo.git" }]
  });
  await controller.start();

  assert.equal(bridge.registered.filter((session) => session.surface === "vscode_window").length >= 2, true);
  assert.equal(bridge.registered.some((session) => session.surface === "vscode_terminal"), true);
  assert.equal(bridge.registered.some((session) => session.metadata["sxsy-b122.kind"] === "git-root" && session.metadata["sxsy-b122.branch"] === "feature/safe"), true);
  assert.equal(bridge.registered.every((session) => session.capabilities.length === 1 && session.capabilities[0] === "registered"), true);
  assert.equal(bridge.registered.every((session) => !session.capabilities.includes("mediated")), true);
  assert.equal(vscode.commandCallbacks.has("sxsy-b122.chord.pipeline.ctrl_shift_alt"), true);
  assert.equal(vscode.commandCallbacks.has("sxsy-b122.chord.sandbox.ctrl_shift_alt"), true);

  await vscode.invoke("sxsy-b122.adoptTerminal", { terminalName: "Manual terminal", provider: "claude" });
  assert.equal(bridge.adopted.length, 1);
  assert.equal(bridge.adopted[0].provider, "claude");
  await vscode.invoke("sxsy-b122.adoptTerminal", { terminalName: "Manual terminal", provider: "codex" });
  assert.match(vscode.warnings.at(-1) ?? "", /already been adopted/i);
});

test("tracks terminal, workspace, and debug lifecycle events as identities rather than inferred agent completion", async () => {
  const vscode = new FakeVscode();
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { now: () => "2026-08-23T00:00:00.000Z", idFactory: sequenceFactory() });
  await controller.start();
  const countBefore = bridge.registered.length;
  const extra = new FakeTerminal("Later terminal");
  vscode.terminals.push(extra);
  await vscode.fireOpen(extra);
  assert.equal(bridge.registered.length, countBefore + 1);

  vscode.workspaceFolders = [{ uri: { fsPath: "C:\\new-repo" } }];
  await vscode.fireWorkspaceChange();
  assert.equal(bridge.registered.filter((session) => session.surface === "vscode_window").length >= 3, true);

  const debug: DebugSessionLike = { id: "debug-1", name: "Launch test", configuration: { name: "Launch test" } };
  await vscode.fireDebugStart(debug);
  await vscode.fireDebugStop(debug);
  assert.equal(bridge.registered.some((session) => session.metadata["sxsy-b122.kind"] === "debug-session"), true);
  assert.equal(bridge.statuses.some((status) => status.status === "unreachable"), true);
  assert.equal(bridge.statuses.some((status) => status.status === "verified_finished"), false);
});

test("provider connection command installs only capabilities returned by the companion handshake", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const context = new FakeContext();
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, context, bridge, { idFactory: (() => { let id = 0; return () => `session-${++id}`; })(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feat/test" }] });
  await controller.start();
  const candidate = controller.listKnownSessions()[0]!;
  vscode.choose(`${candidate.provider}: ${candidate.id}`);
  await vscode.invoke("sxsy-b122.connectProviderAdapter");
  const connected = controller.listKnownSessions().find((session) => session.id === candidate.id)!;
  assert.deepEqual(connected.capabilities, ["registered", "observable", "controllable", "mediated"]);
  assert.equal(connected.workspaceRoot, "C:\\repo");
});

test("heartbeats local extension sessions but never renews provider-observed proof", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    now: () => "2026-08-24T00:00:10.000Z",
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/liveness" }],
    heartbeatIntervalMs: 20
  });
  await controller.start();
  const provider = controller.listKnownSessions()[0]!;
  vscode.choose(`${provider.provider}: ${provider.id}`);
  await vscode.invoke("sxsy-b122.connectProviderAdapter");
  bridge.heartbeats.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 55));
  controller.stop();

  assert.equal(bridge.heartbeats.some((heartbeat) => heartbeat.sessionId === provider.id), false);
  assert.equal(bridge.heartbeats.some((heartbeat) => heartbeat.sessionId !== provider.id), true);
  assert.equal(bridge.heartbeats.every((heartbeat) => heartbeat.at === "2026-08-24T00:00:10.000Z"), true);
});

test("provider chords prepare one exact typed workflow artifact before durable dispatch", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/workflow" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  bridge.nextPreparation = { status: "prepared", summary: "Exact workflow prepared.", session: { ...target, targetSnapshotId: "snapshot-test", taskId: "task-test", planRevision: "plan-test" } };
  vscode.input("The exact implementation satisfies the accepted task.");
  vscode.input("receipt:tests");
  vscode.input("local");

  const command = chordFor("PROOF", "normal");
  assert.ok(command);
  await controller.dispatchChord(command);

  assert.equal(bridge.workflowPrepared.length, 1);
  assert.deepEqual(bridge.workflowPrepared[0], {
    action: "proof", sessionId: target.id,
    payload: { kind: "proof", claims: ["The exact implementation satisfies the accepted task."], evidenceReferences: ["receipt:tests"], requiredBackends: ["local"] }
  });
  assert.equal(bridge.dispatched.length, 1);
});

test("local commit collects an exact structured Git review before dispatch", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    now: () => "2026-08-23T00:00:00.000Z",
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/review", changedPaths: ["src/safe.ts", "README.md"] }]
  });
  await controller.start();
  vscode.input("src/safe.ts");
  vscode.input("feat: reviewed local change");

  await vscode.invoke("sxsy-b122.chord.commit.normal");

  assert.equal(bridge.gitReviews.length, 1);
  assert.deepEqual(bridge.gitReviews[0]?.mutation, { kind: "local_commit", paths: ["src/safe.ts"], message: "feat: reviewed local change" });
  assert.equal(bridge.dispatched.at(-1)?.control, "COMMIT");
});

test("PR upsert reviews title and body and opens only the companion-verified PR URL", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const opened: string[] = [];
  bridge.nextDispatch = {
    status: "running",
    summary: "The exact PR is verified.",
    data: {
      hostActionId: `host-action:${"c".repeat(64)}`,
      hostActionKind: "open_external_url",
      hostActionExpiresAt: "2099-01-01T00:00:00.000Z",
      hostActionUrl: "https://github.com/acme/project/pull/12"
    }
  };
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    now: () => "2026-08-23T00:00:00.000Z",
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/review", changedPaths: [] }],
    openExternal: async (url) => { opened.push(url); return true; }
  });
  await controller.start();
  vscode.input("main");
  vscode.input("Reviewed PR title");
  vscode.input("Reviewed PR body");

  await vscode.invoke("sxsy-b122.chord.commit.shift");

  assert.deepEqual(bridge.gitReviews.at(-1)?.mutation, { kind: "pr_upsert", headBranch: "feature/review", baseBranch: "main", title: "Reviewed PR title", body: "Reviewed PR body" });
  assert.deepEqual(opened, ["https://github.com/acme/project/pull/12"]);
  assert.equal(bridge.authorizedHostActions.at(-1)?.id, `host-action:${"c".repeat(64)}`);
  assert.equal(bridge.completedHostActions.at(-1)?.succeeded, true);
});

test("picker-or-stop selects one Git target and forwards only companion-prepared authority and confirmation", async () => {
  const vscode = new FakeVscode([], ["C:\\repo-a", "C:\\repo-b"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    now: () => "2026-08-23T00:00:00.000Z",
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [
      { gitRoot: "C:\\repo-a", branch: "feature/a" },
      { gitRoot: "C:\\repo-b", branch: "feature/b" }
    ]
  });
  await controller.start();

  vscode.choose("C:\\repo-b");
  await vscode.invoke("sxsy-b122.chord.shield.normal");
  const selected = bridge.registered.find((session) => session.workspaceRoot === "C:\\repo-b" && session.metadata["sxsy-b122.kind"] === "git-root");
  assert.ok(selected);
  assert.equal(bridge.prepared.at(-1)?.sessionId, selected.id);
  assert.equal(bridge.dispatched.at(-1)?.sessionId, selected.id);
  assert.equal(bridge.dispatched.at(-1)?.authorityId, "authority-test");
  assert.equal(bridge.dispatched.at(-1)?.confirmationToken, "confirmation-test");

  bridge.nextPreparation = { status: "blocked", summary: "User presence was denied." };
  const before = bridge.dispatched.length;
  await vscode.invoke("sxsy-b122.chord.shield.normal");
  assert.equal(bridge.dispatched.length, before);
  assert.match(vscode.warnings.at(-1) ?? "", /user presence was denied/i);
});

test("forwards Run/Debug to the companion and performs only safe local host actions", async () => {
  const vscode = new FakeVscode();
  const bridge = new FakeBridge();
  const opened: string[] = [];
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { now: () => "2026-08-23T00:00:00.000Z", idFactory: sequenceFactory(), openExternal: async (url) => { opened.push(url); return true; } });
  await controller.start();

  await vscode.invoke("sxsy-b122.chord.claude.alt");
  assert.equal(bridge.dispatched.at(-1)?.control, "CLAUDE");
  assert.equal(vscode.createdTerminals.length, 1);
  assert.deepEqual(vscode.createdTerminals[0].sent, []);
  assert.match(vscode.warnings.at(-1) ?? "", /did not launch an unverified provider executable/i);
  assert.equal(bridge.completedHostActions.at(-1)?.succeeded, true);

  bridge.nextDispatch = { status: "unavailable", summary: "No verified execution broker is attached." };
  await vscode.invoke("sxsy-b122.chord.run.normal");
  assert.equal(bridge.dispatched.at(-1)?.control, "RUN");
  assert.equal(bridge.dispatched.at(-1)?.modifier, "normal");
  assert.equal(vscode.started.length, 0);
  assert.equal(vscode.stopped.length, 0);
  assert.match(vscode.warnings.at(-1) ?? "", /unavailable/i);

  bridge.nextDispatch = { status: "completed", summary: "A malicious response attempted a deprecated host action.", data: { localAction: "start_debug" } };
  await vscode.invoke("sxsy-b122.chord.run.shift");
  assert.equal(bridge.dispatched.at(-1)?.control, "RUN");
  assert.equal(bridge.dispatched.at(-1)?.modifier, "shift");
  assert.equal(vscode.started.length, 0);
  assert.equal(vscode.stopped.length, 0);
  assert.match(vscode.warnings.at(-1) ?? "", /malformed host-action/i);

  bridge.nextDispatch = { status: "running", summary: "Verified debugger awaits host acknowledgement.", data: { hostActionId: `host-action:${"e".repeat(64)}`, hostActionKind: "start_vscode_debug", hostActionExpiresAt: "2099-01-01T00:00:00.000Z", hostActionWorkspaceRoot: "C:\\repo", hostActionDebugConfiguration: "Launch test" } };
  await vscode.invoke("sxsy-b122.chord.run.shift");
  assert.equal(vscode.started.length, 1);
  assert.equal(vscode.started[0]?.configuration.name, "Launch test");
  assert.equal(vscode.started[0]?.noDebug, false);

  bridge.nextDispatch = { status: "running", summary: "Healthy web app awaits host acknowledgement.", data: { hostActionId: `host-action:${"d".repeat(64)}`, hostActionKind: "open_external_url", hostActionExpiresAt: "2099-01-01T00:00:00.000Z", hostActionUrl: "http://127.0.0.1:4317/" } };
  await vscode.invoke("sxsy-b122.chord.run.shift_alt");
  assert.deepEqual(opened, ["http://127.0.0.1:4317/"]);
  assert.equal(bridge.completedHostActions.at(-1)?.succeeded, true);

  bridge.nextDispatch = { status: "running", summary: "Venv awaits host acknowledgement.", data: { hostActionId: `host-action:${"2".repeat(64)}`, hostActionKind: "configure_python_venv", hostActionExpiresAt: "2099-01-01T00:00:00.000Z", hostActionWorkspaceRoot: "C:\\repo", hostActionPythonInterpreter: "C:\\repo\\.venv\\Scripts\\python.exe" } };
  await vscode.invoke("sxsy-b122.chord.sandbox.normal");
  assert.deepEqual(vscode.configurationUpdates.at(-1), { section: "python", key: "defaultInterpreterPath", value: "C:\\repo\\.venv\\Scripts\\python.exe", target: 3 });
  assert.equal(vscode.terminalOptions.at(-1)?.cwd, "C:\\repo");
  assert.equal(vscode.terminalOptions.at(-1)?.env?.VIRTUAL_ENV, "C:\\repo\\.venv");

  bridge.nextDispatch = { status: "blocked", summary: "Acceptance evidence is incomplete." };
  await vscode.invoke("sxsy-b122.chord.pipeline.ctrl_shift_alt");
  assert.match(vscode.warnings.at(-1) ?? "", /blocked/i);
  assert.equal(vscode.createdTerminals.length, 2);
});

test("a disconnected or malicious companion cannot cause a host action", async () => {
  const offlineVscode = new FakeVscode();
  const offlineController = new ManagedSessionController(offlineVscode.api, new FakeContext(), new UnavailableExtensionCompanionBridge("offline"), { idFactory: sequenceFactory() });
  await offlineController.start();
  await offlineVscode.invoke("sxsy-b122.chord.run.normal");
  assert.equal(offlineVscode.started.length, 0);
  assert.match(offlineVscode.warnings.at(-1) ?? "", /offline/i);

  const vscode = new FakeVscode();
  const bridge = new FakeBridge();
  bridge.nextDispatch = { status: "running", summary: "bad response", data: { hostActionId: `host-action:${"b".repeat(64)}`, hostActionKind: "create_codex_terminal", hostActionExpiresAt: "2099-01-01T00:00:00.000Z" } };
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory() });
  await controller.start();
  await vscode.invoke("sxsy-b122.chord.claude.alt");
  assert.equal(vscode.createdTerminals.length, 0);
  assert.match(vscode.warnings.at(-1) ?? "", /unexpected local host action/i);
});

test("public hardware dispatch traverses canonical prepare, authority, dispatch, and receipt completion without a client-selected chord", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    now: () => "2026-08-24T00:00:00.000Z",
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/hardware" }]
  });
  await controller.start();
  const window = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "window")!;
  const claim: HardwareSignalClaim = { signalId: `hardware-signal:${"a".repeat(64)}`, claimToken: "claim-token-controller", deviceId: "b".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 3, control: "SHIELD", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: window.id, workspaceRoots: ["C:\\repo"] };
  const command = chordFor(claim.control, claim.modifier);
  assert.ok(command);
  await controller.dispatchChord(command, undefined, claim);

  assert.deepEqual(bridge.hardwarePrepared, [claim]);
  assert.deepEqual(bridge.hardwareDispatched, [claim]);
  assert.equal(bridge.dispatched.length, 0);
  assert.deepEqual(bridge.hardwareCompleted.map((item) => ({ outcome: item.outcome, receipt: item.dispatchReceiptId })), [{ outcome: "handled", receipt: `hardware-dispatch:${"e".repeat(64)}` }]);
});

test("hardware high-consequence preparation remains blocked and closes only with the server disposition receipt", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  bridge.nextPreparation = { status: "blocked", summary: "High-consequence acceptance gates are incomplete." };
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/hardware" }] });
  await controller.start();
  const window = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "window")!;
  const claim: HardwareSignalClaim = { signalId: `hardware-signal:${"c".repeat(64)}`, claimToken: "claim-token-high", deviceId: "d".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 4, control: "PIPELINE", modifier: "ctrl_shift_alt", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: window.id, workspaceRoots: ["C:\\repo"] };
  const command = chordFor(claim.control, claim.modifier);
  assert.ok(command);
  await controller.dispatchChord(command, undefined, claim);
  assert.equal(bridge.hardwareDispatched.length, 0);
  assert.equal(bridge.hardwareCompleted[0]?.outcome, "handled");
  assert.equal(bridge.hardwareCompleted[0]?.dispatchReceiptId, `hardware-dispatch:${"d".repeat(64)}`);
  assert.match(vscode.warnings.at(-1) ?? "", /high-consequence acceptance gates/i);
});

test("only a focused VS Code window with nonempty exact roots polls and atomically dispatches a durable hardware claim", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  vscode.focused = false;
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/hardware" }] });
  await controller.start();
  assert.equal(bridge.hardwareClaimBindings.length, 0);
  const targetSession = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  bridge.nextPreparation = { status: "prepared", summary: "Prepared by fake companion.", session: { ...targetSession, targetSnapshotId: "snapshot-test", taskId: "task-test", planRevision: "plan-test" }, authorityId: "authority-test", confirmationToken: "confirmation-test" };
  vscode.input("The selected implementation satisfies the plan.");
  vscode.input("receipt:test");
  vscode.input("local");
  const window = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "window")!;
  bridge.hardwareClaims.push({ signalId: `hardware-signal:${"f".repeat(64)}`, claimToken: "claim-token-focus", deviceId: "a".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 5, control: "PROOF", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: window.id, workspaceRoots: ["C:\\repo"] });
  await vscode.fireFocus(true);
  for (let attempt = 0; attempt < 20 && bridge.hardwareCompleted.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(bridge.hardwareClaimBindings[0], { windowSessionId: window.id, workspaceRoots: ["C:\\repo"], focused: true });
  assert.equal(bridge.hardwarePrepared.length, 1);
  assert.equal(bridge.hardwareCompleted[0]?.outcome, "handled");
  controller.stop();
});

test("focus loss during the claim round trip returns the signal before preparation", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/hardware" }] });
  await controller.start();
  const window = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "window")!;
  bridge.hardwareClaims.push({ signalId: `hardware-signal:${"1".repeat(64)}`, claimToken: "claim-token-focus-race", deviceId: "2".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 6, control: "PROOF", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: window.id, workspaceRoots: ["C:\\repo"] });
  bridge.onHardwareClaim = () => { vscode.focused = false; };
  for (let attempt = 0; attempt < 20 && bridge.hardwareCompleted.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(bridge.hardwarePrepared.length, 0);
  assert.equal(bridge.hardwareDispatched.length, 0);
  assert.equal(bridge.hardwareCompleted[0]?.outcome, "failed_before_dispatch");
  controller.stop();
});

test("Raw-HID provisioning UI collects only the exact device tuple and never a helper path or digest", async () => {
  const vscode = new FakeVscode();
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory() });
  await controller.start();
  vscode.input("0x5358");
  vscode.input("0xb122");
  vscode.input("0xff60");
  vscode.input("0x0061");
  vscode.input("B122-A");
  await vscode.invoke("sxsy-b122.installRawHid");
  assert.deepEqual(bridge.rawHidInstallRequests, [{ vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61, serialNumber: "B122-A" }]);
  assert.equal(vscode.commandCallbacks.has("sxsy-b122.showRawHidStatus"), true);
  assert.equal(vscode.commandCallbacks.has("sxsy-b122.revokeRawHid"), true);
  controller.stop();
});

function directAction(command: ForwardedCommand): LocalHostAction | undefined {
  const actions: Partial<Record<string, LocalHostAction>> = {
    "CLAUDE:alt": "create_claude_terminal",
    "CHATGPT:alt": "create_codex_terminal",
    "TERMINAL:shift": "focus_integrated_terminal"
  };
  return actions[`${command.control}:${command.modifier}`];
}

function sequenceFactory(): () => string {
  let sequence = 0;
  return () => `id-${++sequence}`;
}
