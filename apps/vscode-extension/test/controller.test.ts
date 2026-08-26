import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  type CredentialProvisionScope,
  type CredentialReferenceSummary,
  type InstalledNetworkPolicy,
  type AcceptanceTrustSummary,
  type AcceptanceEvidenceSummary,
  type HighConsequenceActivationSummary,
  type ScannerTrustSummary,
  type ScannerFixtureSummary,
  type ProviderDesktopId,
  type ProviderInstallationSummary,
  type RawHidDeviceIdentity,
  type RawHidInstallationPin,
  type RawHidRuntimeStatus,
  type ContainmentInspectionSummary,
  type HardwareSignalClaim,
  type HardwareSignalDispatchResult,
  type HardwareSignalPreparationResult,
  type HardwareSignalCompletionResult,
  type ExtensionHandoffPackage,
  type ExtensionWorkflowAction,
  type ExtensionWorkflowArtifact,
  type ExtensionWorkflowPreparationIntent,
  type ExtensionWorkflowProviderResult,
  type ExtensionVoiceProvider,
  type ExtensionVoiceConsent,
  type ExtensionVoiceBinding,
  type ExtensionHostActionClaim,
  type HostActionClaimReference,
  UnavailableExtensionCompanionBridge
} from "../src/companion-bridge.ts";
import { deactivateManagedExtension, exactExtensionPackageVersion, ManagedSessionController, workflowResultPresentation } from "../src/controller.ts";
import { chordFor, type B122Control, type B122Modifier } from "../src/commands.ts";
import type { DebugConfigurationLike, DebugSessionLike, DisposableLike, ExtensionContextLike, QuickPickItemLike, TerminalLike, VscodeLike, WorkspaceFolderLike } from "../src/vscode-like.ts";

test("reviewed source and extracted VSIX package identities share exact release version", async () => {
  const root = await mkdtemp(join(tmpdir(), "b122-vsix-identity-"));
  try {
    const writeIdentity = async (name: string, publisher = "SquirmyWormy275", main = "./dist/extension.js") => {
      await writeFile(join(root, "package.json"), JSON.stringify({ name, publisher, main, version: "1.2.3-test.4" }), "utf8");
    };
    await writeIdentity("@strathex/switchyard-vscode");
    assert.equal(exactExtensionPackageVersion(root), "1.2.3-test.4");
    await writeIdentity("strathex-switchyard-b122");
    assert.equal(exactExtensionPackageVersion(root), "1.2.3-test.4");

    await writeIdentity("strathex-switchyard-b122", "attacker");
    assert.throws(() => exactExtensionPackageVersion(root), /identity is invalid/);
    await writeIdentity("strathex-switchyard-b122", "SquirmyWormy275", "./attacker.js");
    assert.throws(() => exactExtensionPackageVersion(root), /identity is invalid/);
    await writeIdentity("lookalike");
    assert.throws(() => exactExtensionPackageVersion(root), /identity is invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class FakeDisposable implements DisposableLike { dispose(): void {} }

function fakeProviderInstallation(provider: ProviderDesktopId, status: "active" | "revoked"): ProviderInstallationSummary {
  const managed = provider === "claude_code" || provider === "codex";
  const identity = provider === "claude_desktop"
    ? { productId: "anthropic.claude-desktop", displayName: "Claude Desktop", publisher: "Anthropic, PBC" }
    : provider === "chatgpt_desktop"
      ? { productId: "openai.chatgpt-desktop", displayName: "ChatGPT Desktop", publisher: "OpenAI, L.L.C." }
      : provider === "claude_code"
        ? { productId: "anthropic.claude-code", displayName: "Claude Code", publisher: "Anthropic, PBC" }
        : { productId: "openai.codex", displayName: "Codex", publisher: "OpenAI, L.L.C." };
  return {
    provider,
    installationId: `provider-install:${provider}`,
    catalogDigest: "b".repeat(64),
    identity: {
      canonicalExecutablePath: `C:\\Program Files\\SXSY\\${provider}.exe`,
      executableSha256: "a".repeat(64),
      signerSubject: "CN=Isolated Provider Test",
      signerThumbprint: "a".repeat(40),
      productIdentity: {
        ...identity,
        role: managed ? "managed_terminal" : "desktop"
      },
      size: 1,
      modifiedMs: 1,
      device: "1",
      inode: "1"
    },
    operator: "Current User",
    installedAt: "2026-08-24T00:00:00.000Z",
    statusAt: "2026-08-24T00:00:00.000Z",
    status
  };
}

function readyContainmentIncident(repositoryRoot: string, fenceEpoch: number, activationOperationId: string): ContainmentInspectionSummary["incident"] {
  const id = `containment-incident:${"a".repeat(64)}`;
  return {
    version: 1, id, repositoryRoot, fenceEpoch, activationOperationId, reason: "reviewed incident",
    createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:02.000Z", status: "ready_for_release",
    assessment: { generation: 1, purpose: "initial", targetSnapshotId: "snapshot-containment", basedOnFindingIds: [], basedOnReceiptIds: [], credentialRotationRequired: false, startedAt: "2026-08-25T00:00:00.000Z" },
    steps: (["working_tree", "history", "remote"] as const).map((step) => ({
      name: step, operationId: `assessment-${step}`, externalId: `external-${step}`, status: "completed" as const,
      attempts: 1, updatedAt: "2026-08-25T00:00:01.000Z",
      result: { schema: "sxsy-b122.containment-assessment-result" as const, version: 1 as const, incidentId: id, repositoryRoot, fenceEpoch, step, operationId: `assessment-${step}`, externalId: `external-${step}`, effectDisposition: "committed" as const, status: "passed" as const, exposure: "none" as const, summary: "No exposure found.", findings: [] }
    })),
    permits: [], receipts: [],
    rotation: { disposition: "not_required", evidenceReference: "reviewed", evidenceDigest: "b".repeat(64), reviewedAt: "2026-08-25T00:00:02.000Z" }
  };
}

class FakeTerminal implements TerminalLike {
  readonly sent: string[] = [];
  shown = 0;
  readonly name: string;
  readonly processId: PromiseLike<number | undefined> = Promise.resolve(4242);
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
  readonly globalState = this.workspaceState;
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
  readonly terminalOptions: Array<{ name: string; cwd?: string; env?: Readonly<Record<string, string | null | undefined>>; shellPath?: string; shellArgs?: readonly string[] }> = [];
  readonly inputPrompts: string[] = [];
  readonly quickPickSurfaces: Array<{ readonly items: readonly (string | QuickPickItemLike)[]; readonly placeHolder?: string }> = [];
  readonly terminals: FakeTerminal[];
  activeTerminal?: FakeTerminal;
  workspaceFolders: WorkspaceFolderLike[];
  debugConfigurations: DebugConfigurationLike[] = [{ name: "Launch test", type: "node", request: "launch" }];
  activeDebugSession?: DebugSessionLike;
  publishDebugStart = true;
  publishDebugStop = true;
  focused = true;
  private readonly openListeners: Array<(terminal: TerminalLike) => unknown> = [];
  private readonly closeListeners: Array<(terminal: TerminalLike) => unknown> = [];
  private readonly workspaceListeners: Array<() => unknown> = [];
  private readonly debugStartListeners: Array<(session: DebugSessionLike) => unknown> = [];
  private readonly debugStopListeners: Array<(session: DebugSessionLike) => unknown> = [];
  private readonly focusListeners: Array<(state: { readonly focused: boolean }) => unknown> = [];
  private readonly quickPickValues: string[] = [];
  private readonly inputValues: string[] = [];
  private readonly openDialogPaths: string[] = [];
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
        async showQuickPick<T extends string | QuickPickItemLike>(items: readonly T[], options?: { readonly placeHolder?: string }): Promise<T | undefined> {
          self.quickPickSurfaces.push({ items, ...(options?.placeHolder ? { placeHolder: options.placeHolder } : {}) });
          const wanted = self.quickPickValues.shift();
          if (!wanted) return undefined;
          return items.find((item) => typeof item === "string" ? item === wanted : item.label === wanted);
        },
        async showInputBox(options): Promise<string | undefined> { self.inputPrompts.push(options?.prompt ?? ""); return self.inputValues.shift(); },
        async showOpenDialog(): Promise<readonly { fsPath: string }[] | undefined> { const path = self.openDialogPaths.shift(); return path ? [{ fsPath: path }] : undefined; },
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
        get activeDebugSession(): DebugSessionLike | undefined { return self.activeDebugSession; },
        async startDebugging(folder, configuration, options): Promise<boolean> {
          const exactConfiguration = typeof configuration === "string" ? { name: configuration } : configuration;
          self.started.push({ folder, configuration: exactConfiguration, noDebug: options?.noDebug });
          const session: DebugSessionLike = { id: `debug-${self.started.length}`, name: exactConfiguration.name ?? `Debug ${self.started.length}`, configuration: exactConfiguration, ...(folder ? { workspaceFolder: folder } : {}) };
          self.activeDebugSession = session;
          if (self.publishDebugStart) for (const listener of self.debugStartListeners) await listener(session);
          return true;
        },
        async stopDebugging(session): Promise<boolean> {
          if (!session) return false;
          self.stopped.push(session);
          if (self.publishDebugStop) {
            for (const listener of self.debugStopListeners) await listener(session);
            if (self.activeDebugSession === session) self.activeDebugSession = undefined;
          }
          return true;
        },
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
  async fireDebugStart(session: DebugSessionLike): Promise<void> { this.activeDebugSession = session; for (const listener of this.debugStartListeners) await listener(session); }
  async fireDebugStop(session: DebugSessionLike): Promise<void> { for (const listener of this.debugStopListeners) await listener(session); if (this.activeDebugSession === session) this.activeDebugSession = undefined; }
  async fireFocus(focused: boolean): Promise<void> { this.focused = focused; for (const listener of this.focusListeners) await listener({ focused }); }
  choose(value: string): void { this.quickPickValues.push(value); }
  input(value: string): void { this.inputValues.push(value); }
  file(value: string): void { this.openDialogPaths.push(value); }
}

class FakeBridge implements ExtensionCompanionBridge {
  readonly registered: ExtensionManagedSession[] = [];
  readonly heartbeats: Array<{ sessionId: string; at?: string }> = [];
  listedSessions?: readonly ExtensionManagedSession[];
  readonly adopted: Array<{ sessionId: string; adoptionKey: string; provider: Exclude<ExtensionProvider, "voice"> }> = [];
  readonly statuses: Array<{ sessionId: string; status: ExtensionSessionStatus }> = [];
  readonly dispatched: ForwardedCommand[] = [];
  readonly completedHostActions: Array<{ id: string; succeeded: boolean; summary: string; adapterVersion: string; effectDisposition?: "not_started" | "committed" | "ambiguous"; claimId?: string }> = [];
  readonly authorizedHostActions: Array<{ id: string; adapterVersion: string; selectionId?: string; claimId?: string }> = [];
  readonly hostActionClaims: ExtensionHostActionClaim[] = [];
  readonly hostActionClaimBindings: Array<{ windowSessionId: string; adapterVersion: string; capabilities: readonly ["show_voice_center"]; focused: true }> = [];
  readonly prepared: Array<{ control: string; modifier: string; sessionId?: string; reason: string; reviewScopeDigest?: string }> = [];
  readonly gitReviews: Array<{ action: "local_commit" | "pr_upsert" | "pr_merge" | "direct_main"; sessionId: string; mutation: ReviewedGitMutation }> = [];
  readonly hardwarePrepared: HardwareSignalClaim[] = [];
  readonly hardwarePreparationReviewScopes: Array<string | undefined> = [];
  readonly hardwareDispatched: HardwareSignalClaim[] = [];
  readonly hardwareDispatchCommands: Array<Omit<ForwardedCommand, "control" | "modifier">> = [];
  readonly hardwareCompleted: Array<{ claim: HardwareSignalClaim; outcome: string; dispatchReceiptId?: string }> = [];
  readonly hardwareClaims: HardwareSignalClaim[] = [];
  readonly hardwareClaimBindings: Array<{ windowSessionId: string; workspaceRoots: readonly string[]; focused: true }> = [];
  authorizationUrlOverride?: string;
  readonly rawHidInstallRequests: RawHidDeviceIdentity[] = [];
  readonly acceptanceTrustInstallRequests: string[] = [];
  readonly scannerFixtureInstallRequests: string[] = [];
  readonly providerInstallRequests: ProviderDesktopId[] = [];
  readonly providerRevokeRequests: ProviderDesktopId[] = [];
  readonly credentialProvisionRequests: Array<{ reference: string; scopes: readonly CredentialProvisionScope[]; sealedSecret: string; replaceExisting?: boolean }> = [];
  readonly containmentReleaseRequests: Array<{ sessionId: string; reason: string; expectedFenceEpoch: number; expectedActivationOperationId: string; expectedIncidentId: string; expectedIncidentDigest: string }> = [];
  readonly containmentVerificationRequests: Array<{ sessionId: string; expectedIncidentId: string; expectedIncidentDigest: string }> = [];
  readonly councilRecommendationApprovals: Array<{ recommendationId: string; recommendationDigest: string; approvalOperationId: string; repositoryRoot: string; targetSnapshotId: string; sessionId?: string }> = [];
  readonly acknowledgedHandoffs: Array<{ handoffId: string; recipientSessionId: string }> = [];
  readonly workflowPrepared: Array<{ action: ExtensionWorkflowAction; sessionId: string; authorityId: string; intent: ExtensionWorkflowPreparationIntent }> = [];
  readonly workflowCancelled: Array<{ artifactId: string; sessionId: string; authorityId: string }> = [];
  readonly voiceBindingSequence: string[] = [];
  readonly voiceBinds: Array<{ bindingId: string; managedSessionId: string }> = [];
  readonly voiceStarts: Array<{ consentId: string; voiceSessionId: string; managedSessionId?: string }> = [];
  readonly voiceSwitches: Array<{ bindingId: string; consentId: string; voiceSessionId: string }> = [];
  readonly voiceMutes: string[] = [];
  readonly voiceResumes: string[] = [];
  readonly voiceEnds: string[] = [];
  nextWorkflowArtifact?: ExtensionWorkflowArtifact;
  listedWorkflows?: readonly ExtensionWorkflowArtifact[];
  listedHandoffs?: readonly ExtensionHandoffPackage[];
  currentVoiceValue?: ExtensionVoiceBinding;
  nextDispatch?: ForwardedCommandResult;
  nextPreparation?: PreparedCommand;
  readonly preparationSequence: PreparedCommand[] = [];
  hardwareClaimGate?: Promise<void>;
  listedProviderDesktops?: readonly ProviderInstallationSummary[];
  onHardwareClaim?: () => void;
  registerGate?: Promise<void>;
  healthGate?: Promise<void>;
  authorizeGate?: Promise<void>;
  healthCalls = 0;
  registerCalls = 0;
  registerFailure = false;
  containmentInspection?: ContainmentInspectionSummary;
  containmentVerificationResult?: ContainmentInspectionSummary;
  completeHostActionFailure?: string;

  async health(): Promise<BridgeResult<Readonly<{ status?: string }>>> { this.healthCalls += 1; await this.healthGate; return { ok: true, value: { status: "healthy" } }; }
  async listSessions(): Promise<BridgeResult<readonly ExtensionManagedSession[]>> { return { ok: true, value: this.listedSessions ?? this.registered }; }
  async registerSession(session: ExtensionManagedSession): Promise<BridgeResult<ExtensionManagedSession>> {
    this.registerCalls += 1;
    await this.registerGate;
    if (this.registerFailure) return { ok: false, code: "unavailable", message: "offline" };
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
  async prepareCommand(command: { control: B122Control; modifier: B122Modifier; sessionId?: string; reason: string; reviewScopeDigest?: string }): Promise<BridgeResult<PreparedCommand>> {
    this.prepared.push(command);
    return { ok: true, value: this.preparationSequence.shift() ?? this.nextPreparation ?? { status: "prepared", summary: "Prepared by fake companion.", authorityId: "authority-test", confirmationToken: "confirmation-test" } };
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
  async provisionCredential(input: { reference: string; scopes: readonly CredentialProvisionScope[]; sealedSecret: string; replaceExisting?: boolean }): Promise<BridgeResult<CredentialReferenceSummary>> { this.credentialProvisionRequests.push(input); return { ok: true, value: { reference: input.reference, protectorProvider: "fake", generation: 1, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z", scopes: input.scopes } }; }
  async listCredentials(): Promise<BridgeResult<readonly CredentialReferenceSummary[]>> { return { ok: true, value: [] }; }
  async revokeCredential(): Promise<BridgeResult<boolean>> { return { ok: true, value: true }; }
  async installNetworkPolicy(repositoryRoot: string, sourcePath: string): Promise<BridgeResult<InstalledNetworkPolicy>> { return { ok: true, value: { repositoryRoot, filePath: sourcePath, sha256: "a".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", status: "active" } }; }
  async currentNetworkPolicy(_repositoryRoot: string): Promise<BridgeResult<InstalledNetworkPolicy | undefined>> { return { ok: true, value: undefined }; }
  async revokeNetworkPolicy(repositoryRoot: string): Promise<BridgeResult<InstalledNetworkPolicy>> { return { ok: true, value: { repositoryRoot, filePath: "C:\\state\\network-policy.json", sha256: "a".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", status: "revoked" } }; }
  async providerHandshake(sessionId: string, repositoryRoot: string): Promise<BridgeResult<ExtensionManagedSession>> {
    const existing = this.registered.find((session) => session.id === sessionId);
    if (!existing) return { ok: false, code: "not_found", message: "missing" };
    const connected: ExtensionManagedSession = { ...existing, workspaceRoot: repositoryRoot, capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", adapterVersion: "fake-provider", metadata: { ...existing.metadata, "sxsy-b122.providerHandshake": "exact-route-v1" } };
    this.registered.splice(this.registered.indexOf(existing), 1, connected);
    return { ok: true, value: connected };
  }
  async inspectContainment(sessionId: string): Promise<BridgeResult<ContainmentInspectionSummary>> {
    const configured = this.containmentInspection;
    if (!configured || configured.sessionId !== sessionId) return { ok: false, code: "not_found", message: "No active containment record exists for this session." };
    return { ok: true, value: configured };
  }
  async reassessContainment(input: { sessionId: string; expectedIncidentId: string; expectedIncidentDigest: string }): Promise<BridgeResult<ContainmentInspectionSummary>> {
    return this.inspectContainment(input.sessionId);
  }
  async verifyContainmentRemediation(input: { sessionId: string; expectedIncidentId: string; expectedIncidentDigest: string }): Promise<BridgeResult<ContainmentInspectionSummary>> {
    this.containmentVerificationRequests.push(input);
    return this.containmentVerificationResult
      ? { ok: true, value: this.containmentVerificationResult }
      : this.inspectContainment(input.sessionId);
  }
  async issueContainmentPermit(input: { sessionId: string; expectedIncidentId: string; expectedIncidentDigest: string; action: "remove_exposed_value" | "rewrite_local_history" | "add_ignore_rule"; relativePaths: readonly string[]; expiresAt: string }) {
    const inspected = await this.inspectContainment(input.sessionId);
    if (!inspected.ok) return inspected;
    return { ok: true as const, value: { permit: { id: `containment-remediation-permit:${"d".repeat(64)}`, incidentId: input.expectedIncidentId, fenceEpoch: inspected.value.fenceEpoch, action: input.action, relativePaths: input.relativePaths, reviewedBy: "fake-current-user", issuedAt: "2026-08-25T00:00:03.000Z", expiresAt: input.expiresAt, networkAllowed: false as const, credentialAccessAllowed: false as const }, containment: inspected.value } };
  }
  async recordContainmentRotation(input: { sessionId: string; expectedIncidentId: string; expectedIncidentDigest: string; disposition: "complete" | "not_required"; evidenceReference: string; evidenceDigest: string }): Promise<BridgeResult<ContainmentInspectionSummary>> {
    return this.inspectContainment(input.sessionId);
  }
  async releaseContainment(input: { sessionId: string; reason: string; expectedFenceEpoch: number; expectedActivationOperationId: string; expectedIncidentId: string; expectedIncidentDigest: string }): Promise<BridgeResult<ForwardedCommandResult>> {
    this.containmentReleaseRequests.push(input);
    return { ok: true, value: { status: "completed", summary: "Authenticated containment release recorded." } };
  }
  async approveCouncilRecommendation(input: { recommendationId: string; recommendationDigest: string; approvalOperationId: string; repositoryRoot: string; targetSnapshotId: string; sessionId?: string }) {
    this.councilRecommendationApprovals.push(input);
    return { ok: true as const, value: {
      id: input.recommendationId, digest: input.recommendationDigest, reportId: `council-report:${"b".repeat(64)}`, reportDigest: "b".repeat(64),
      repositoryRoot: input.repositoryRoot, targetSnapshotId: input.targetSnapshotId, participantSessionIds: [input.sessionId ?? "session-one"],
      assignments: { [input.sessionId ?? "session-one"]: { sessionId: input.sessionId ?? "session-one", paths: [], resources: [] } },
      reviewScopeDigest: "d".repeat(64), preparationOperationId: "operation-prepare", ready: true, status: "approved" as const, approvalOperationId: input.approvalOperationId, executionAuthorized: false as const,
      createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:01:00.000Z"
    } };
  }
  async installRawHid(identity: RawHidDeviceIdentity): Promise<BridgeResult<Readonly<{ installation: RawHidInstallationPin; supervisor: RawHidRuntimeStatus["supervisor"] }>>> {
    this.rawHidInstallRequests.push(identity);
    return { ok: true, value: { installation: { identity, helperPath: "C:\\host\\strathex-b122-hid-helper.exe", helperSha256: "a".repeat(64), protocolVersion: 1, mapFingerprint: "0123456789abcdef", installedAt: "2026-08-24T00:00:00.000Z", status: "active" }, supervisor: { state: "running", generation: 1, detail: "ready" } } };
  }
  async listRawHid(): Promise<BridgeResult<readonly RawHidInstallationPin[]>> { return { ok: true, value: [] }; }
  async revokeRawHid(): Promise<BridgeResult<RawHidInstallationPin>> { return { ok: false, code: "not_found", message: "none" }; }
  async rawHidStatus(): Promise<BridgeResult<RawHidRuntimeStatus>> { return { ok: true, value: { supervisor: { state: "unprovisioned", generation: 0, detail: "none" }, inbox: { pending: 0, claimed: 0, completed: 0, needsReconciliation: 0 }, installations: [] } }; }
  async claimHardwareSignal(binding: { windowSessionId: string; workspaceRoots: readonly string[]; focused: true }): Promise<BridgeResult<HardwareSignalClaim | undefined>> { this.hardwareClaimBindings.push(binding); this.onHardwareClaim?.(); await this.hardwareClaimGate; return { ok: true, value: this.hardwareClaims.shift() }; }
  async prepareHardwareSignal(claim: HardwareSignalClaim, _sessionId?: string, _reason?: string, reviewScopeDigest?: string): Promise<BridgeResult<HardwareSignalPreparationResult>> {
    this.hardwarePrepared.push(claim);
    this.hardwarePreparationReviewScopes.push(reviewScopeDigest);
    const preparation = this.preparationSequence.shift() ?? this.nextPreparation ?? { status: "prepared" as const, summary: "Prepared by fake companion.", authorityId: "authority-test", confirmationToken: "confirmation-test" };
    return { ok: true, value: { preparation, ...(preparation.status === "prepared" || preparation.workflowReview ? {} : { dispositionReceiptId: `hardware-dispatch:${"d".repeat(64)}` }) } };
  }
  async dispatchHardwareSignal(claim: HardwareSignalClaim, command: Omit<ForwardedCommand, "control" | "modifier">): Promise<BridgeResult<HardwareSignalDispatchResult>> {
    this.hardwareDispatched.push(claim);
    this.hardwareDispatchCommands.push(command);
    return { ok: true, value: { command: this.nextDispatch ?? { status: "completed", summary: "Routed by fake companion." }, dispatchReceiptId: `hardware-dispatch:${"e".repeat(64)}` } };
  }
  async completeHardwareSignal(claim: HardwareSignalClaim, completion: { outcome: "handled" | "failed_before_dispatch" | "needs_reconciliation"; dispatchReceiptId?: string }): Promise<BridgeResult<HardwareSignalCompletionResult>> {
    this.hardwareCompleted.push({ claim, outcome: completion.outcome, ...(completion.dispatchReceiptId ? { dispatchReceiptId: completion.dispatchReceiptId } : {}) });
    return { ok: true, value: { signalId: claim.signalId, outcome: completion.outcome } };
  }
  async claimHostAction(binding: { windowSessionId: string; adapterVersion: string; capabilities: readonly ["show_voice_center"]; focused: true }): Promise<BridgeResult<ExtensionHostActionClaim | undefined>> {
    this.hostActionClaimBindings.push(binding);
    return { ok: true, value: this.hostActionClaims.shift() };
  }
  async createHandoff(input: { sessionId: string; recipientSessionId?: string; routing?: "queue" | "immediate" }): Promise<BridgeResult<ExtensionHandoffPackage>> {
    const session = this.registered.find((value) => value.id === input.sessionId);
    if (!session?.workspaceRoot || !session.targetSnapshotId || !session.taskId || !session.planRevision) return { ok: false, code: "not_found", message: "missing" };
    return { ok: true, value: { id: "handoff-test", digest: "a".repeat(64), repositoryRoot: session.workspaceRoot, targetSnapshotId: session.targetSnapshotId, taskId: session.taskId, planRevision: session.planRevision, ...(input.recipientSessionId ? { recipientSessionId: input.recipientSessionId } : {}), status: input.routing === "immediate" ? "immediate_focus_requested" : "queued", executionAuthorized: false } };
  }
  async listHandoffs(): Promise<BridgeResult<readonly ExtensionHandoffPackage[]>> { return { ok: true, value: this.listedHandoffs ?? [] }; }
  async acknowledgeHandoff(handoffId: string, recipientSessionId: string): Promise<BridgeResult<ExtensionHandoffPackage>> {
    this.acknowledgedHandoffs.push({ handoffId, recipientSessionId });
    const session = (this.listedSessions ?? this.registered).find((candidate) => candidate.id === recipientSessionId);
    if (!session?.workspaceRoot || !session.targetSnapshotId || !session.taskId || !session.planRevision) return { ok: false, code: "not_found", message: "missing" };
    return { ok: true, value: { id: handoffId, digest: "a".repeat(64), repositoryRoot: session.workspaceRoot, targetSnapshotId: session.targetSnapshotId, taskId: session.taskId, planRevision: session.planRevision, recipientSessionId, status: "acknowledged", executionAuthorized: false } };
  }
  async cancelHandoff(): Promise<BridgeResult<ExtensionHandoffPackage>> { return { ok: false, code: "not_found", message: "missing" }; }
  async archiveHandoff(): Promise<BridgeResult<ExtensionHandoffPackage>> { return { ok: false, code: "not_found", message: "missing" }; }
  async handoffRouting(): Promise<BridgeResult<"queue" | "immediate">> { return { ok: true, value: "queue" }; }
  async setHandoffRouting(routing: "queue" | "immediate"): Promise<BridgeResult<"queue" | "immediate">> { return { ok: true, value: routing }; }
  async prepareWorkflow(input: { action: ExtensionWorkflowAction; sessionId: string; authorityId: string; intent: ExtensionWorkflowPreparationIntent }): Promise<BridgeResult<ExtensionWorkflowArtifact>> {
    if (input.action === "bind_voice_session") this.voiceBindingSequence.push("prepare");
    this.workflowPrepared.push(input);
    if (this.nextWorkflowArtifact) return { ok: true, value: this.nextWorkflowArtifact };
    const session = this.registered.find((candidate) => candidate.id === input.sessionId);
    return { ok: true, value: {
      id: "workflow-test", digest: "b".repeat(64), action: input.action, repositoryRoot: session?.workspaceRoot ?? "C:\\repo",
      targetSnapshotId: session?.targetSnapshotId ?? "snapshot-test", sessionId: input.sessionId, authorityId: input.authorityId,
      payload: { kind: "test" }, status: "prepared", executionAuthorized: false,
      createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z"
    } };
  }
  async cancelWorkflow(input: { artifactId: string; sessionId: string; authorityId: string }): Promise<BridgeResult<ExtensionWorkflowArtifact>> {
    this.workflowCancelled.push(input);
    const artifact = (this.listedWorkflows ?? []).find((candidate) => candidate.id === input.artifactId);
    return artifact ? { ok: true, value: { ...artifact, status: "cancelled", updatedAt: "2026-08-25T00:00:01.000Z" } } : { ok: false, code: "not_found", message: "missing" };
  }
  async listWorkflows(): Promise<BridgeResult<readonly ExtensionWorkflowArtifact[]>> { return { ok: true, value: this.listedWorkflows ?? [] }; }
  async grantVoiceConsent(input: { handoffId: string; provider: ExtensionVoiceProvider; transcript: "off" | "redacted"; retentionMinutes: number }): Promise<BridgeResult<ExtensionVoiceConsent>> { this.lastVoiceProvider = input.provider; return { ok: true, value: { id: "voice-consent-test", contextPackageId: input.handoffId, contextDigest: "c".repeat(64), provider: input.provider, transcript: input.transcript, retentionMinutes: input.retentionMinutes, expiresAt: "2099-01-01T00:00:00.000Z" } }; }
  private lastVoiceProvider: ExtensionVoiceProvider = "claude";
  async startVoice(input: { consentId: string; voiceSessionId: string; managedSessionId?: string }): Promise<BridgeResult<ExtensionVoiceBinding>> { this.voiceStarts.push(input); this.currentVoiceValue = { id: "voice-binding-test", consentId: input.consentId, voiceSessionId: input.voiceSessionId, ...(input.managedSessionId ? { managedSessionId: input.managedSessionId } : {}), repositoryRoot: "C:\\repo", targetSnapshotId: "snapshot-test", contextPackageId: "handoff-test", contextDigest: "c".repeat(64), provider: this.lastVoiceProvider, transcript: "off", retentionMinutes: 0, status: "active" }; return { ok: true, value: this.currentVoiceValue }; }
  async currentVoice(): Promise<BridgeResult<ExtensionVoiceBinding | undefined>> { return { ok: true, value: this.currentVoiceValue }; }
  async switchVoice(input: { bindingId: string; consentId: string; voiceSessionId: string }): Promise<BridgeResult<ExtensionVoiceBinding>> { this.voiceSwitches.push(input); this.currentVoiceValue = { id: input.bindingId, consentId: input.consentId, voiceSessionId: input.voiceSessionId, repositoryRoot: "C:\\repo", targetSnapshotId: "snapshot-test", contextPackageId: "handoff-test", contextDigest: "c".repeat(64), provider: this.lastVoiceProvider, transcript: "off", retentionMinutes: 0, status: "active" }; return { ok: true, value: this.currentVoiceValue }; }
  async bindVoice(bindingId: string, managedSessionId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { this.voiceBindingSequence.push("bind"); this.voiceBinds.push({ bindingId, managedSessionId }); this.currentVoiceValue = { id: bindingId, consentId: "voice-consent-test", voiceSessionId: "voice-session-test", managedSessionId, repositoryRoot: "C:\\repo", targetSnapshotId: "snapshot-test", contextPackageId: "handoff-test", contextDigest: "c".repeat(64), provider: this.lastVoiceProvider, transcript: "off", retentionMinutes: 0, status: "active" }; return { ok: true, value: this.currentVoiceValue }; }
  async muteVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { this.voiceMutes.push(bindingId); return this.voiceState(bindingId, "muted"); }
  async resumeVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { this.voiceResumes.push(bindingId); return this.voiceState(bindingId, "active"); }
  async interruptVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceState(bindingId, "interrupted"); }
  async endVoice(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { this.voiceEnds.push(bindingId); return this.voiceState(bindingId, "ended"); }
  async deleteVoiceTranscript(bindingId: string): Promise<BridgeResult<ExtensionVoiceBinding>> { return this.voiceState(bindingId, "ended"); }
  async installAcceptanceTrust(sourcePath: string): Promise<BridgeResult<AcceptanceTrustSummary>> { this.acceptanceTrustInstallRequests.push(sourcePath); return { ok: true, value: { authorityId: "independent-lab", keyId: "a".repeat(64), allowedGates: [8], expiresAt: "2099-01-01T00:00:00.000Z", installedAt: "2026-08-24T00:00:00.000Z", installedBy: "reviewer", status: "active" } }; }
  async listAcceptanceTrust(): Promise<BridgeResult<readonly AcceptanceTrustSummary[]>> { return { ok: true, value: [] }; }
  async revokeAcceptanceTrust(): Promise<BridgeResult<AcceptanceTrustSummary>> { return { ok: false, code: "unavailable", message: "not configured" }; }
  async importAcceptanceEvidence(): Promise<BridgeResult<AcceptanceEvidenceSummary>> { return { ok: false, code: "unavailable", message: "not configured" }; }
  async listAcceptanceEvidence(): Promise<BridgeResult<readonly AcceptanceEvidenceSummary[]>> { return { ok: true, value: [] }; }
  async invalidateAcceptanceEvidence(): Promise<BridgeResult<boolean>> { return { ok: true, value: true }; }
  async activateHighConsequence(): Promise<BridgeResult<HighConsequenceActivationSummary>> { return { ok: false, code: "unavailable", message: "not configured" }; }
  async listHighConsequenceActivations(): Promise<BridgeResult<readonly HighConsequenceActivationSummary[]>> { return { ok: true, value: [] }; }
  async revokeHighConsequenceActivation(): Promise<BridgeResult<boolean>> { return { ok: true, value: true }; }
  async installScannerTrust(): Promise<BridgeResult<ScannerTrustSummary>> { return { ok: false, code: "unavailable", message: "not configured" }; }
  async listScannerTrust(): Promise<BridgeResult<readonly ScannerTrustSummary[]>> { return { ok: true, value: [] }; }
  async revokeScannerTrust(): Promise<BridgeResult<boolean>> { return { ok: true, value: true }; }
  async installScannerFixture(sourcePath: string): Promise<BridgeResult<ScannerFixtureSummary>> { this.scannerFixtureInstallRequests.push(sourcePath); return { ok: true, value: { id: "scanner-feed", kind: "scanner", packageRoot: "C:\\state\\scanner-feed", manifestSha256: "b".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", installedBy: "reviewer", status: "active" } }; }
  async listScannerFixtures(): Promise<BridgeResult<readonly ScannerFixtureSummary[]>> { return { ok: true, value: [] }; }
  async revokeScannerFixture(): Promise<BridgeResult<boolean>> { return { ok: true, value: true }; }
  async installProviderDesktop(provider: ProviderDesktopId): Promise<BridgeResult<ProviderInstallationSummary>> { this.providerInstallRequests.push(provider); return { ok: true, value: fakeProviderInstallation(provider, "active") }; }
  async listProviderDesktops(): Promise<BridgeResult<readonly ProviderInstallationSummary[]>> { return { ok: true, value: this.listedProviderDesktops ?? [] }; }
  async revokeProviderDesktop(provider: ProviderDesktopId): Promise<BridgeResult<ProviderInstallationSummary>> { this.providerRevokeRequests.push(provider); return { ok: true, value: fakeProviderInstallation(provider, "revoked") }; }
  private async voiceState(bindingId: string, status: ExtensionVoiceBinding["status"]): Promise<BridgeResult<ExtensionVoiceBinding>> { this.currentVoiceValue = { id: bindingId, consentId: "voice-consent-test", voiceSessionId: "voice-session-test", repositoryRoot: "C:\\repo", targetSnapshotId: "snapshot-test", contextPackageId: "handoff-test", contextDigest: "c".repeat(64), provider: "claude", transcript: "off", retentionMinutes: 0, status }; return { ok: true, value: this.currentVoiceValue }; }
  async authorizeHostAction(id: string, adapterVersion: string, selectionId?: string, expectedUrl?: string, claim?: HostActionClaimReference) {
    this.authorizedHostActions.push({ id, adapterVersion, ...(selectionId ? { selectionId } : {}), ...(claim ? { claimId: claim.claimId } : {}) });
    await this.authorizeGate;
    const url = selectionId ? `https://github.com/acme/project/pull/${selectionId.split(":")[1]}` : this.authorizationUrlOverride ?? expectedUrl;
    return { ok: true, value: { hostActionId: id, authorizationToken: `host-action-auth:${"f".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z", ...(selectionId ? { selectionId } : {}), ...(url ? { url } : {}) } } as const;
  }
  async completeHostAction(id: string, succeeded: boolean, summary: string, adapterVersion: string, _authorizationToken?: string, effectDisposition?: "not_started" | "committed" | "ambiguous", claim?: HostActionClaimReference): Promise<BridgeResult<ForwardedCommandResult>> {
    this.completedHostActions.push({ id, succeeded, summary, adapterVersion, ...(effectDisposition ? { effectDisposition } : {}), ...(claim ? { claimId: claim.claimId } : {}) });
    if (this.completeHostActionFailure) {
      const message = this.completeHostActionFailure;
      this.completeHostActionFailure = undefined;
      return { ok: false, code: "unavailable", message };
    }
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

test("credential provisioning sends only operator-entered exact adapter/purpose triples for the selected repository", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  let openedSecret = "";
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/credential-scope" }],
    sealSecret: async (cleartext) => { openedSecret = Buffer.from(cleartext).toString("utf8"); return "dpapi-current-user-envelope"; }
  });
  await controller.start();
  vscode.input("provider-read");
  vscode.input("configured-network/provider-api,council-resource-host/council-session");
  vscode.input("cleartext-never-forwarded");
  await vscode.invoke("sxsy-b122.provisionCredential");

  assert.equal(openedSecret, "cleartext-never-forwarded");
  assert.deepEqual(bridge.credentialProvisionRequests, [{
    reference: "provider-read",
    scopes: [
      { repositoryRoot: "C:\\repo", adapterId: "configured-network", purpose: "provider-api" },
      { repositoryRoot: "C:\\repo", adapterId: "council-resource-host", purpose: "council-session" }
    ],
    sealedSecret: "dpapi-current-user-envelope"
  }]);
  assert.equal(JSON.stringify(bridge.credentialProvisionRequests).includes("cleartext-never-forwarded"), false);
  assert.match(vscode.inputPrompts[1]!, /C:\\repo/);
  assert.match(vscode.information.at(-1) ?? "", /configured-network\/provider-api/);
  assert.match(vscode.information.at(-1) ?? "", /council-resource-host\/council-session/);
  controller.stop();
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

test("signed acceptance and scanner administration are reachable only through reviewed files and companion ports", async () => {
  const vscode = new FakeVscode();
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory() });
  await controller.start();
  assert.equal(vscode.commandCallbacks.has("sxsy-b122.manageAcceptanceEvidence"), true);
  assert.equal(vscode.commandCallbacks.has("sxsy-b122.manageScannerFixtures"), true);

  vscode.choose("Install acceptance authority");
  vscode.file("C:\\reviewed\\acceptance-trust.json");
  await vscode.invoke("sxsy-b122.manageAcceptanceEvidence");
  vscode.choose("Install signed scanner/advisory fixture");
  vscode.file("C:\\reviewed\\scanner-fixture.json");
  await vscode.invoke("sxsy-b122.manageScannerFixtures");

  assert.deepEqual(bridge.acceptanceTrustInstallRequests, ["C:\\reviewed\\acceptance-trust.json"]);
  assert.deepEqual(bridge.scannerFixtureInstallRequests, ["C:\\reviewed\\scanner-fixture.json"]);
  assert.equal(vscode.information.some((message) => message.includes("independent-lab")), true);
  assert.equal(vscode.information.some((message) => message.includes("scanner-feed")), true);
});

test("provider administration selects only a compiled provider identity and never collects an executable path", async () => {
  const vscode = new FakeVscode();
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory() });
  await controller.start();
  assert.equal(vscode.commandCallbacks.has("sxsy-b122.manageProviderApplications"), true);

  vscode.choose("Install provider application");
  vscode.choose("Codex");
  await vscode.invoke("sxsy-b122.manageProviderApplications");
  assert.deepEqual(bridge.providerInstallRequests, ["codex"]);
  assert.equal(vscode.inputPrompts.length, 0);
  assert.equal(vscode.information.some((message) => /installed codex at its fixed host path/i.test(message)), true);

  bridge.listedProviderDesktops = [fakeProviderInstallation("codex", "active")];
  vscode.choose("Revoke provider application");
  vscode.choose("Codex");
  await vscode.invoke("sxsy-b122.manageProviderApplications");
  assert.deepEqual(bridge.providerRevokeRequests, ["codex"]);
  assert.equal(vscode.inputPrompts.length, 0);
});

test("containment release presents and rebinds the exact active fence, activation, hooks, rotation, and exposure", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/contained" }]
  });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const incident = readyContainmentIncident("C:\\repo", 17, "operation-containment-17");
  bridge.containmentInspection = {
    sessionId: target.id,
    repositoryRoot: "C:\\repo",
    active: true,
    fenceEpoch: 17,
    activatedByOperationId: "operation-containment-17",
    hookStates: [
      { name: "credential_lease_revocation", status: "completed", attempts: 1, updatedAt: "2026-08-25T00:00:00.000Z" },
      { name: "queued_operation_cancellation", status: "completed", attempts: 2, updatedAt: "2026-08-25T00:00:01.000Z" }
    ],
    hookFailures: [],
    uncontrolledPaths: ["unmediated-local-user-processes"],
    incident,
    incidentDigest: "c".repeat(64)
  };
  vscode.choose(`${target.provider}: ${target.id}`);
  vscode.input("Reviewed incident and reconciled every managed effect.");
  vscode.choose("Release exact containment fence 17");
  await vscode.invoke("sxsy-b122.releaseContainment");

  assert.deepEqual(bridge.containmentReleaseRequests, [{
    sessionId: target.id,
    reason: "Reviewed incident and reconciled every managed effect.",
    expectedFenceEpoch: 17,
    expectedActivationOperationId: "operation-containment-17",
    expectedIncidentId: incident.id,
    expectedIncidentDigest: "c".repeat(64)
  }]);
  const inspection = vscode.information.find((message) => message.includes("containment inspection")) ?? "";
  assert.match(inspection, /active fence 17/);
  assert.match(inspection, /operation-containment-17/);
  assert.match(inspection, /credential_lease_revocation=completed/);
  assert.match(inspection, /queued_operation_cancellation=completed/);
  assert.match(inspection, /unmediated-local-user-processes/);
  const final = vscode.quickPickSurfaces.find((surface) => surface.placeHolder?.includes("Final review"));
  assert.match(JSON.stringify(final), /containment-incident/);
  assert.match(JSON.stringify(final), /operation-containment-17/);
  assert.match(JSON.stringify(final), /unmediated-local-user-processes/);
});

test("containment workflow requires a fresh post-remediation generation before rotation or release", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/contained" }]
  });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const base = readyContainmentIncident("C:\\repo", 19, "operation-containment-19");
  const finding = { id: `containment-finding:${"f".repeat(64)}`, relativePath: "config/local.env", credentialRelated: true };
  const receiptId = `containment-remediation-receipt:${"e".repeat(64)}`;
  const incident = {
    ...base,
    status: "remediation_required" as const,
    rotation: undefined,
    steps: base.steps.map((step) => step.name === "working_tree"
      ? { ...step, result: { ...step.result!, status: "failed" as const, exposure: "found" as const, findings: [finding] } }
      : step),
    receipts: [{
      id: receiptId,
      permitId: `containment-remediation-permit:${"d".repeat(64)}`,
      incidentId: base.id,
      fenceEpoch: 19,
      action: "remove_exposed_value" as const,
      relativePaths: [finding.relativePath],
      remediatedFindingIds: [finding.id],
      evidenceDigest: "a".repeat(64),
      recordedAt: "2026-08-25T00:00:03.000Z"
    }]
  };
  bridge.containmentInspection = {
    sessionId: target.id, repositoryRoot: "C:\\repo", active: true, fenceEpoch: 19,
    activatedByOperationId: "operation-containment-19",
    hookStates: [
      { name: "credential_lease_revocation", status: "completed", attempts: 1, updatedAt: "2026-08-25T00:00:00.000Z" },
      { name: "queued_operation_cancellation", status: "completed", attempts: 1, updatedAt: "2026-08-25T00:00:01.000Z" }
    ],
    hookFailures: [], uncontrolledPaths: [], incident, incidentDigest: "c".repeat(64)
  };
  bridge.containmentVerificationResult = {
    ...bridge.containmentInspection,
    incident: {
      ...incident,
      status: "remediation_required",
      assessment: {
        generation: 2,
        purpose: "post_remediation",
        targetSnapshotId: "snapshot-remediated",
        basedOnFindingIds: [finding.id],
        basedOnReceiptIds: [receiptId],
        credentialRotationRequired: true,
        sourceIncidentDigest: "c".repeat(64),
        startedAt: "2026-08-25T00:01:00.000Z"
      },
      steps: incident.steps.map((step) => ({ ...step, result: { ...step.result!, status: "passed" as const, exposure: "none" as const, findings: [] } }))
    },
    incidentDigest: "b".repeat(64)
  };

  vscode.choose(`${target.provider}: ${target.id}`);
  vscode.choose(`Verify remediation for ${incident.id}`);
  await vscode.invoke("sxsy-b122.releaseContainment");

  assert.deepEqual(bridge.containmentVerificationRequests, [{ sessionId: target.id, expectedIncidentId: incident.id, expectedIncidentDigest: "c".repeat(64) }]);
  assert.equal(bridge.containmentReleaseRequests.length, 0);
  assert.equal(vscode.information.some((message) => message.includes("assessment generation 2")), true);
});

test("containment release stops before confirmation when the inspected active fence has an incomplete hook", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/contained" }]
  });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const incident = readyContainmentIncident(target.workspaceRoot!, 18, "operation-containment-18");
  bridge.containmentInspection = {
    sessionId: target.id,
    repositoryRoot: target.workspaceRoot!,
    active: true,
    fenceEpoch: 18,
    activatedByOperationId: "operation-containment-18",
    hookStates: [
      { name: "credential_lease_revocation", status: "completed", attempts: 1, updatedAt: "2026-08-25T00:00:00.000Z" },
      { name: "queued_operation_cancellation", status: "failed", attempts: 2, updatedAt: "2026-08-25T00:00:01.000Z", failure: "queue reconciliation unavailable" }
    ],
    hookFailures: ["queue reconciliation unavailable"],
    uncontrolledPaths: [],
    incident,
    incidentDigest: "c".repeat(64)
  };
  vscode.choose(`${target.provider}: ${target.id}`);
  await vscode.invoke("sxsy-b122.releaseContainment");

  assert.equal(bridge.containmentReleaseRequests.length, 0);
  assert.match(vscode.warnings.at(-1) ?? "", /every exact revocation\/cancellation hook is complete/i);
  assert.equal(vscode.inputPrompts.length, 0);
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
  bridge.nextPreparation = { status: "prepared", summary: "Exact workflow prepared.", authorityId: "authority-test", session: { ...target, targetSnapshotId: "snapshot-test", taskId: "task-test", planRevision: "plan-test" } };
  const command = chordFor("PROOF", "normal");
  assert.ok(command);
  await controller.dispatchChord(command);

  assert.equal(bridge.workflowPrepared.length, 1);
  assert.deepEqual(bridge.workflowPrepared[0], {
    action: "proof", sessionId: target.id, authorityId: "authority-test", intent: { kind: "none" }
  });
  assert.equal(bridge.dispatched.length, 1);
});

test("Council Normal presents bounded exact participant and conflict detail instead of counts", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/council-report" }] });
  await controller.start();
  const selected = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  bridge.nextPreparation = { status: "prepared", summary: "Council report prepared.", session: { ...selected, targetSnapshotId: "a".repeat(64) } };
  bridge.nextDispatch = { status: "completed", summary: "Council report persisted.", data: {
    reportId: `council-report:${"b".repeat(64)}`, reportDigest: "b".repeat(64), repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64),
    collectedAt: "2026-08-25T00:00:00.000Z", participants: 2, atomic: false, executionAuthorized: false,
    participantDetails: [
      { id: "agent-one", provider: "codex", targetSnapshotId: "a".repeat(64), status: "running", capabilities: ["registered", "observable"], lastHeartbeat: "2026-08-25T00:00:00.000Z", plannedFiles: ["src/shared.ts"], resources: ["port:45100"], dependencies: ["task:prior"], diffDigest: "c".repeat(64) },
      { id: "agent-two", provider: "claude", targetSnapshotId: "a".repeat(64), status: "verified_blocked", capabilities: ["registered", "observable"], lastHeartbeat: "2026-08-25T00:00:00.000Z", plannedFiles: ["src/shared.ts"], resources: ["port:45100"], dependencies: ["task:prior"], diffDigest: "d".repeat(64) }
    ],
    pathConflicts: [{ resource: "src/shared.ts", participants: ["agent-one", "agent-two"] }],
    resourceConflicts: [{ resource: "port:45100", participants: ["agent-one", "agent-two"] }],
    dependencyConflicts: [{ resource: "task:prior", participants: ["agent-one", "agent-two"] }]
  } };

  await vscode.invoke("sxsy-b122.chord.council.normal");
  const surface = vscode.quickPickSurfaces.at(-1);
  assert.match(surface?.placeHolder ?? "", /exact.*read-only Council report/i);
  const rendered = JSON.stringify(surface?.items ?? []);
  assert.match(rendered, /src\/shared\.ts/);
  assert.match(rendered, /port:45100/);
  assert.match(rendered, /task:prior/);
  assert.match(rendered, /agent-one/);
  assert.match(rendered, /agent-two/);
  assert.equal(bridge.councilRecommendationApprovals.length, 0);
});

test("Council Alt prepares then requires a distinct exact-digest VS Code approval call with no execution authority", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/council-recommend" }] });
  await controller.start();
  const selected = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  bridge.nextPreparation = { status: "prepared", summary: "Council recommendation prepared.", confirmationToken: "confirmation-review", session: { ...selected, targetSnapshotId: "a".repeat(64) } };
  bridge.nextDispatch = { status: "completed", summary: "Recommendation prepared for review.", data: {
    recommendationId: "recommendation-1", recommendationDigest: "c".repeat(64), reportId: `council-report:${"b".repeat(64)}`, reportDigest: "b".repeat(64),
    repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), participantSessionIds: [selected.id],
    assignments: { [selected.id]: { sessionId: selected.id, paths: ["src/safe.ts"], resources: ["port:45100"] } },
    ready: true, status: "prepared", createdAt: "2026-08-25T00:00:00.000Z", executionAuthorized: false
  } };
  vscode.choose(`Approve exact recommendation ${"c".repeat(64)}`);

  await vscode.invoke("sxsy-b122.chord.council.alt");

  assert.equal(bridge.dispatched.length, 1);
  assert.equal(bridge.councilRecommendationApprovals.length, 1);
  assert.deepEqual(bridge.councilRecommendationApprovals[0], {
    recommendationId: "recommendation-1", recommendationDigest: "c".repeat(64), approvalOperationId: "council-review:id-2",
    repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), sessionId: selected.id
  });
  assert.match(vscode.quickPickSurfaces.at(-1)?.placeHolder ?? "", /separate.*exact-digest/i);
  assert.match(vscode.information.at(-1) ?? "", /approved.*no execution authority/i);
});

test("completed provider workflows render the exact artifact-bound durable result and reject substituted artifacts", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/workflow-result" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const boundTarget = { ...target, targetSnapshotId: "a".repeat(64), taskId: "task-result", planRevision: "plan-result" };
  const artifact: ExtensionWorkflowArtifact = {
    id: "workflow-proof-result", digest: "b".repeat(64), action: "proof", repositoryRoot: "C:\\repo", targetSnapshotId: boundTarget.targetSnapshotId,
    sessionId: boundTarget.id, authorityId: "authority-result", payload: { kind: "proof" }, status: "prepared", executionAuthorized: false,
    createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z"
  };
  const workflowResult: ExtensionWorkflowProviderResult = { kind: "proof", verifiedClaims: ["The target is exact."], evidenceReferences: ["receipt:proof"], backendResults: [{ backend: "local", status: "passed" }] };
  bridge.nextPreparation = { status: "prepared", summary: "Exact workflow prepared.", authorityId: "authority-result", session: boundTarget };
  bridge.nextWorkflowArtifact = artifact;
  bridge.nextDispatch = { status: "completed", summary: "Protected Proof complete.", data: { artifactId: artifact.id, artifactDigest: artifact.digest, resultKind: workflowResult.kind, workflowResult, providerSummary: "Protected Proof complete.", externalId: "provider-proof-1" } };

  await vscode.invoke("sxsy-b122.chord.proof.normal");
  assert.match(vscode.information.at(-1) ?? "", /proof result/i);
  assert.match(vscode.quickPickSurfaces.at(-1)?.placeHolder ?? "", /read-only.*does not approve/i);
  assert.equal(vscode.quickPickSurfaces.at(-1)?.items.some((item) => typeof item !== "string" && item.detail?.includes("The target is exact.")), true);

  const surfacesBefore = vscode.quickPickSurfaces.length;
  bridge.nextDispatch = { ...bridge.nextDispatch, data: { ...bridge.nextDispatch.data, artifactId: "substituted-artifact" } };
  await vscode.invoke("sxsy-b122.chord.proof.normal");
  assert.equal(vscode.quickPickSurfaces.length, surfacesBefore);
  assert.match(vscode.warnings.at(-1) ?? "", /did not match the exact prepared artifact/i);
});

test("Option Provider collects only one question and context while the provider owns five-option generation", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/options" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  bridge.nextPreparation = { status: "prepared", summary: "Exact decision prepared.", authorityId: "authority-test", session: { ...target, targetSnapshotId: "a".repeat(64), taskId: "task-test", planRevision: "plan-test" } };
  vscode.input("Which implementation should we use?");
  vscode.input("The exact target must remain fail closed.");

  await vscode.invoke("sxsy-b122.chord.option_provider.normal");

  assert.deepEqual(bridge.workflowPrepared.at(-1), {
    action: "option_provider",
    sessionId: target.id,
    authorityId: "authority-test",
    intent: { kind: "decision", question: "Which implementation should we use?", context: "The exact target must remain fail closed." }
  });
  assert.equal(vscode.inputPrompts.length, 2);
  assert.equal(vscode.inputPrompts.some((prompt) => /five options|recommendation/i.test(prompt)), false);
});

function exactPlanReview(session: ExtensionManagedSession, scopeDigest = "5".repeat(64)): NonNullable<PreparedCommand["workflowReview"]> {
  return {
    action: "plan_approval",
    sessionId: session.id,
    targetSnapshotId: session.targetSnapshotId!,
    repositoryRoot: session.workspaceRoot!,
    provider: session.provider as "claude" | "codex",
    contextId: "provider-context-7",
    observedAt: "2026-08-25T00:00:00.000Z",
    adapter: { id: "configured-provider-host", version: "1.2.3", moduleSha256: "a".repeat(64) },
    plan: {
      digest: "b".repeat(64), revision: session.planRevision!, originSessionId: "origin-plan-session", taskId: session.taskId!,
      objective: "Ship the exact reviewed Plan Approval change without broadening authority.",
      steps: [
        { id: "step-review", summary: "Review the immutable plan.", ownedFiles: ["src/review.ts"], dependencies: [], status: "approved" },
        { id: "step-dispatch", summary: "Dispatch only the reviewed scope.", ownedFiles: ["src/dispatch.ts"], dependencies: ["step-review"], status: "proposed" }
      ],
      decisions: ["Use the exact provider-observed plan revision."]
    },
    scopeDigest,
    summary: "Provider-observed plan revision 7 is bound to the current target.",
    providerContextDigest: "c".repeat(64),
    sourceRevision: 7
  };
}

test("Plan Approval presents the full protected plan then forwards one exact reviewed confirmation without inventing a plan", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/plan" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const confirmationScopeDigest = "5".repeat(64);
  const bound = { ...target, provider: "codex" as const, targetSnapshotId: "b".repeat(64), taskId: "task-plan", planRevision: "revision-7" };
  const workflowReview = exactPlanReview(bound, confirmationScopeDigest);
  bridge.preparationSequence.push(
    { status: "incomplete", summary: "Review the exact protected plan.", session: bound, workflowReview },
    { status: "prepared", summary: "Current user confirmed the unchanged bound plan.", authorityId: "authority-plan", confirmationToken: "confirmation-plan", confirmationScopeDigest, session: bound }
  );
  vscode.choose(`Approve exact protected scope ${confirmationScopeDigest}`);

  await vscode.invoke("sxsy-b122.chord.plan_approval.normal");

  assert.deepEqual(bridge.prepared.map((item) => item.reviewScopeDigest), [undefined, confirmationScopeDigest]);
  assert.deepEqual(bridge.workflowPrepared.at(-1), {
    action: "plan_approval",
    sessionId: target.id,
    authorityId: "authority-plan",
    intent: { kind: "plan_approval", confirmationToken: "confirmation-plan", confirmationScopeDigest }
  });
  assert.equal(vscode.inputPrompts.length, 0);
  assert.equal(bridge.dispatched.at(-1)?.confirmationToken, "confirmation-plan");
  assert.equal(bridge.dispatched.at(-1)?.confirmationScopeDigest, confirmationScopeDigest);
  const reviewSurface = vscode.quickPickSurfaces.find((surface) => surface.placeHolder?.includes(confirmationScopeDigest));
  assert.ok(reviewSurface);
  const reviewText = reviewSurface.items.map((item) => typeof item === "string" ? item : [item.label, item.description, item.detail].filter(Boolean).join("\n")).join("\n");
  for (const expected of [workflowReview.plan.objective, "step-review", "src/review.ts", "step-dispatch", "step-review", workflowReview.plan.decisions[0]!, "configured-provider-host@1.2.3", workflowReview.adapter.moduleSha256, workflowReview.providerContextDigest, workflowReview.targetSnapshotId, workflowReview.repositoryRoot, confirmationScopeDigest]) {
    assert.equal(reviewText.includes(expected), true, `protected plan review UI omitted ${expected}`);
  }
});

test("Plan Approval cancel returns before a second preparation, confirmation, workflow artifact, or dispatch", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/plan" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const bound = { ...target, provider: "claude" as const, targetSnapshotId: "b".repeat(64), taskId: "task-plan", planRevision: "revision-7" };
  bridge.preparationSequence.push({ status: "incomplete", summary: "Review the exact protected plan.", session: bound, workflowReview: exactPlanReview(bound) });
  vscode.choose("Cancel Plan Approval");

  await vscode.invoke("sxsy-b122.chord.plan_approval.normal");

  assert.equal(bridge.prepared.length, 1);
  assert.equal(bridge.workflowPrepared.length, 0);
  assert.equal(bridge.dispatched.length, 0);
  assert.match(vscode.information.at(-1) ?? "", /did not approve.*no confirmation or dispatch/i);
});

test("Plan Approval blocks when the protected review changes between presentation and confirmation", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/plan" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const bound = { ...target, provider: "codex" as const, targetSnapshotId: "b".repeat(64), taskId: "task-plan", planRevision: "revision-7" };
  const review = exactPlanReview(bound);
  bridge.preparationSequence.push(
    { status: "incomplete", summary: "Review the exact protected plan.", session: bound, workflowReview: review },
    { status: "blocked", summary: "The protected plan changed before confirmation." }
  );
  vscode.choose(`Approve exact protected scope ${review.scopeDigest}`);

  await vscode.invoke("sxsy-b122.chord.plan_approval.normal");

  assert.deepEqual(bridge.prepared.map((item) => item.reviewScopeDigest), [undefined, review.scopeDigest]);
  assert.equal(bridge.workflowPrepared.length, 0);
  assert.equal(bridge.dispatched.length, 0);
  assert.match(vscode.warnings.at(-1) ?? "", /protected plan changed/i);
});

test("Plan Approval refuses reuse when the token matches but the protected review scope changed", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/plan" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const bound = { ...target, provider: "codex" as const, targetSnapshotId: "b".repeat(64), taskId: "task-plan", planRevision: "revision-7" };
  const confirmationToken = "same-confirmation";
  const workflowReview = exactPlanReview(bound, "4".repeat(64));
  bridge.preparationSequence.push(
    { status: "incomplete", summary: "Review the exact protected plan.", session: bound, workflowReview },
    { status: "prepared", summary: "Fresh exact protected plan review.", authorityId: "authority-plan", confirmationToken, confirmationScopeDigest: workflowReview.scopeDigest, session: bound }
  );
  bridge.listedWorkflows = [{
    id: "stale-scope-plan", digest: "7".repeat(64), action: "plan_approval", repositoryRoot: "C:\\repo", targetSnapshotId: bound.targetSnapshotId!,
    sessionId: bound.id, authorityId: "authority-plan", payload: { kind: "plan", mode: "approve", confirmationDigest: createHash("sha256").update(confirmationToken, "utf8").digest("hex"), confirmationScopeDigest: "3".repeat(64) },
    status: "prepared", executionAuthorized: false, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z"
  }];
  vscode.choose(`Approve exact protected scope ${workflowReview.scopeDigest}`);

  await vscode.invoke("sxsy-b122.chord.plan_approval.normal");

  assert.equal(bridge.workflowPrepared.length, 0);
  assert.equal(bridge.dispatched.length, 0);
  assert.match(vscode.quickPickSurfaces.at(-1)?.placeHolder ?? "", /different.*protected plan review scope/i);
});

test("Plan Approval explicitly cancels an exact artifact bound to a different one-time confirmation before replacement", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/plan" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const bound = { ...target, provider: "codex" as const, targetSnapshotId: "b".repeat(64), taskId: "task-plan", planRevision: "revision-7" };
  const workflowReview = exactPlanReview(bound);
  bridge.preparationSequence.push(
    { status: "incomplete", summary: "Review the exact protected plan.", session: bound, workflowReview },
    { status: "prepared", summary: "Fresh current-user confirmation.", authorityId: "authority-plan", confirmationToken: "fresh-confirmation", confirmationScopeDigest: workflowReview.scopeDigest, session: bound }
  );
  bridge.listedWorkflows = [{
    id: "stale-plan", digest: "7".repeat(64), action: "plan_approval", repositoryRoot: "C:\\repo", targetSnapshotId: bound.targetSnapshotId!,
    sessionId: bound.id, authorityId: "authority-plan", payload: { kind: "plan", mode: "approve", confirmationDigest: "6".repeat(64) },
    status: "prepared", executionAuthorized: false, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z"
  }];
  vscode.choose(`Approve exact protected scope ${workflowReview.scopeDigest}`);
  vscode.choose("plan_approval: stale-plan");
  vscode.choose("Cancel exact artifact stale-plan");

  await vscode.invoke("sxsy-b122.chord.plan_approval.normal");

  assert.equal(bridge.workflowPrepared.length, 0);
  assert.equal(bridge.dispatched.length, 0);
  assert.deepEqual(bridge.workflowCancelled, [{ artifactId: "stale-plan", sessionId: bound.id, authorityId: "authority-plan" }]);
  assert.match(vscode.information.at(-1) ?? "", /cancelled exact prepared plan_approval artifact stale-plan/i);
});

test("multiple legacy prepared workflows present exact identities and cancel only the selected artifact", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/workflow-cancel" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const bound = { ...target, targetSnapshotId: "c".repeat(64), taskId: "task-proof", planRevision: "revision-proof" };
  bridge.nextPreparation = { status: "prepared", summary: "Exact workflow prepared.", authorityId: "authority-current", session: bound };
  const legacy = (id: string, digest: string, authorityId: string): ExtensionWorkflowArtifact => ({
    id, digest, action: "proof", repositoryRoot: "C:\\repo", targetSnapshotId: bound.targetSnapshotId!, sessionId: bound.id, authorityId,
    payload: { kind: "proof" }, status: "prepared", executionAuthorized: false,
    createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z"
  });
  bridge.listedWorkflows = [legacy("legacy-proof-1", "1".repeat(64), "authority-legacy-1"), legacy("legacy-proof-2", "2".repeat(64), "authority-legacy-2")];
  vscode.choose("proof: legacy-proof-2");
  vscode.choose("Cancel exact artifact legacy-proof-2");

  await vscode.invoke("sxsy-b122.chord.proof.normal");

  assert.deepEqual(bridge.workflowCancelled, [{ artifactId: "legacy-proof-2", sessionId: bound.id, authorityId: "authority-legacy-2" }]);
  assert.equal(bridge.workflowPrepared.length, 0);
  assert.equal(bridge.dispatched.length, 0);
  const selection = vscode.quickPickSurfaces.at(-2);
  assert.match(selection?.placeHolder ?? "", /multiple legacy prepared artifacts/i);
  assert.equal(selection?.items.some((item) => typeof item !== "string" && item.description?.includes("2".repeat(64)) && item.detail?.includes(bound.targetSnapshotId!)), true);
});

test("Handoff normal delegates to the durable routing default while Alt remains explicitly immediate", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/handoff" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const source = { ...target, targetSnapshotId: "c".repeat(64), taskId: "task-handoff", planRevision: "revision-3", capabilities: ["registered", "observable", "controllable", "mediated"] as const };
  const recipient: ExtensionManagedSession = { ...source, id: "recipient-1", provider: "codex", surface: "vscode_window", metadata: { "sxsy-b122.kind": "recipient" } };
  bridge.listedSessions = [source, recipient];
  bridge.nextPreparation = { status: "prepared", summary: "Exact Handoff prepared.", authorityId: "authority-handoff", session: source };
  bridge.nextWorkflowArtifact = {
    id: "workflow-handoff", digest: "d".repeat(64), action: "handoff", repositoryRoot: "C:\\repo", targetSnapshotId: source.targetSnapshotId!,
    sessionId: source.id, authorityId: "authority-handoff", payload: { kind: "handoff", packageId: "handoff-default", route: "queue", sourceSessionId: source.id, recipientSessionId: recipient.id, authorityId: "authority-handoff" },
    status: "prepared", executionAuthorized: false, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z"
  };

  vscode.choose(`codex: ${recipient.id}`);
  await vscode.invoke("sxsy-b122.chord.handoff.normal");
  bridge.nextWorkflowArtifact = { ...bridge.nextWorkflowArtifact, action: "handoff_immediate", payload: { ...bridge.nextWorkflowArtifact.payload, packageId: "handoff-immediate", route: "immediate" } as never };
  vscode.choose(`codex: ${recipient.id}`);
  await vscode.invoke("sxsy-b122.chord.handoff.alt");

  assert.deepEqual(bridge.workflowPrepared.map(({ action, intent }) => ({ action, intent })), [
    { action: "handoff", intent: { kind: "handoff", recipientSessionId: recipient.id, route: "default" } },
    { action: "handoff_immediate", intent: { kind: "handoff", recipientSessionId: recipient.id, route: "immediate" } }
  ]);
  assert.deepEqual(bridge.acknowledgedHandoffs, [
    { handoffId: "handoff-immediate", recipientSessionId: recipient.id }
  ]);
  assert.equal(vscode.executedCommands.filter((command) => command === "workbench.action.focusActiveEditorGroup").length, 1);
});

test("Find Blocked delivers the protected result and repeated presses focus the next exact session", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/focus" }] });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const source = { ...target, targetSnapshotId: "e".repeat(64), taskId: "task-focus", planRevision: "revision-2", capabilities: ["registered", "observable", "controllable", "mediated"] as const };
  const blocked = ["blocked-1", "blocked-2"].map((id, index): ExtensionManagedSession => ({ ...source, id, surface: "vscode_window", status: "verified_blocked", metadata: { "sxsy-b122.statusReason": `Blocked reason ${index + 1}` } }));
  bridge.listedSessions = [source, ...blocked];
  bridge.nextPreparation = { status: "prepared", summary: "Exact focus prepared.", authorityId: "authority-focus", session: source };
  const artifact = (selected: ExtensionManagedSession, index: number): ExtensionWorkflowArtifact => ({
    id: `workflow-focus-${index}`, digest: String(index + 1).repeat(64), action: "focus_blocked_agent", repositoryRoot: "C:\\repo", targetSnapshotId: source.targetSnapshotId!,
    sessionId: source.id, authorityId: "authority-focus", payload: { kind: "focus", selectedSessionId: selected.id, expectedStatus: "verified_blocked", queueCycleId: `cycle-${index}`, cycleIndex: index, cycleSize: 2, reason: selected.metadata["sxsy-b122.statusReason"] },
    status: "prepared", executionAuthorized: false, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z"
  });

  bridge.nextWorkflowArtifact = artifact(blocked[0]!, 0);
  await vscode.invoke("sxsy-b122.chord.find_blocked_agent.normal");
  bridge.nextWorkflowArtifact = artifact(blocked[1]!, 1);
  await vscode.invoke("sxsy-b122.chord.find_blocked_agent.normal");

  assert.deepEqual(bridge.workflowPrepared.map((item) => item.intent), [{ kind: "none" }, { kind: "none" }]);
  assert.equal(vscode.executedCommands.filter((command) => command === "workbench.action.focusActiveEditorGroup").length, 2);
  assert.equal(vscode.information.some((message) => message.includes("Blocked reason 1")), true);
  assert.equal(vscode.information.some((message) => message.includes("Blocked reason 2")), true);
});

test("workflow result presentation covers every protected provider result without turning choices into approval", () => {
  const alternatives = Array.from({ length: 15 }, (_, index) => ({ rank: index + 1, id: `alternative-${index + 1}`, summary: `Alternative ${index + 1}`, rationale: `Rationale ${index + 1}`, risks: index === 0 ? ["token=must-not-render"] : [] }));
  const results: readonly ExtensionWorkflowProviderResult[] = [
    { kind: "anchor", anchorDigest: "a".repeat(64), discrepancies: ["secret=must-not-render"], questions: ["What changed?"], resumed: false },
    { kind: "proof", verifiedClaims: ["Claim verified."], evidenceReferences: ["receipt:proof-1"], backendResults: [{ backend: "independent", status: "passed" }] },
    { kind: "decision", decisionPacketId: "decision-packet-1", decisions: [{ decisionId: "decision-1", options: [
      { id: "option-1", label: "Conservative", tradeoffs: ["Slower"], risks: ["Delay"] },
      { id: "option-2", label: "Fast", tradeoffs: ["Less evidence"], risks: ["Rework"] }
    ], recommendationId: "option-1" }], userSelectionRequired: true },
    { kind: "plan", mode: "expanded", planDigest: "b".repeat(64), alternatives },
    { kind: "plan", mode: "execution_ack", planDigest: "b".repeat(64), planRevision: "revision-1", originSessionId: "origin-1", executorSessionId: "executor-1", authorityId: "authority-1", acknowledgementId: "ack-1", executionStarted: true },
    { kind: "handoff", packageId: "handoff-1", recipientSessionId: "recipient-1", acknowledged: true },
    { kind: "focus", selectedSessionId: "session-1", status: "verified_finished", queueCycleId: "cycle-1", resultDelivered: true },
    { kind: "authority", acknowledgements: [{ recipientSessionId: "recipient-1", grantId: "grant-1", matchDigest: "c".repeat(64), acknowledged: true }] },
    { kind: "voice_binding", bindingId: "binding-1", active: true }
  ];

  const presentations = results.map(workflowResultPresentation);
  assert.equal(presentations.length, 9);
  assert.equal(presentations.every((presentation) => presentation.items.length > 0), true);
  assert.equal(presentations.flatMap((presentation) => presentation.items).every((item) => item.label.length <= 160 && (item.description?.length ?? 0) <= 240 && (item.detail?.length ?? 0) <= 640), true);
  assert.equal(JSON.stringify(presentations).includes("must-not-render"), false);
  assert.match(presentations[2]!.placeHolder, /read-only.*does not approve/i);
  assert.equal(presentations[3]!.items.length, 15);
  assert.match(presentations[4]!.summary, /execution acknowledgement/i);
});

test("native voice start and provider switch bind an exact managed session without opening provider web pages", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const opened: string[] = [];
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/voice" }],
    openExternal: async (url) => { opened.push(url); return true; }
  });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const exactTarget: ExtensionManagedSession = { ...target, targetSnapshotId: "snapshot-test", taskId: "task-voice", planRevision: "revision-voice", status: "running" };
  bridge.listedSessions = [exactTarget];
  bridge.listedHandoffs = [{ id: "handoff-test", digest: "c".repeat(64), repositoryRoot: "C:\\repo", targetSnapshotId: "snapshot-test", taskId: "task-voice", planRevision: "revision-voice", status: "queued", executionAuthorized: false }];
  bridge.nextDispatch = { status: "running", summary: "Native voice start awaits host acknowledgement.", data: { hostActionId: `host-action:${"1".repeat(64)}`, hostActionKind: "show_voice_center", hostActionExpiresAt: "2099-01-01T00:00:00.000Z" } };

  vscode.choose("task-voice: handoff-test");
  vscode.choose("claude");
  vscode.choose("Transcripts off (recommended)");
  vscode.choose(`${exactTarget.provider}: ${exactTarget.id}`);
  await vscode.invoke("sxsy-b122.chord.voice.normal");

  bridge.nextDispatch = { status: "running", summary: "Native voice switch awaits host acknowledgement.", data: { hostActionId: `host-action:${"2".repeat(64)}`, hostActionKind: "switch_voice_provider", hostActionExpiresAt: "2099-01-01T00:00:00.000Z" } };
  vscode.choose("chatgpt");
  vscode.choose("task-voice: handoff-test");
  vscode.choose("Transcripts off (recommended)");
  vscode.choose(`${exactTarget.provider}: ${exactTarget.id}`);
  await vscode.invoke("sxsy-b122.chord.voice.shift");

  assert.equal(bridge.voiceStarts.length, 1);
  assert.equal(bridge.voiceStarts[0]?.managedSessionId, exactTarget.id);
  assert.equal(bridge.voiceSwitches.length, 1);
  assert.deepEqual(bridge.voiceBinds.map((binding) => binding.managedSessionId), [exactTarget.id]);
  assert.deepEqual(opened, []);
  assert.equal(bridge.completedHostActions.every((completion) => completion.succeeded && /native.*runtime/i.test(completion.summary)), true);
});

test("repeated Voice Center presses toggle mute and resume while a reviewed center action can end", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const context = new FakeContext();
  let now = Date.parse("2026-08-24T12:00:00.000Z");
  const controller = new ManagedSessionController(vscode.api, context, bridge, {
    now: () => new Date(now).toISOString(),
    idFactory: sequenceFactory(),
    repeatWindowMs: 1_500,
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/voice-center" }]
  });
  await controller.start();
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const exactTarget: ExtensionManagedSession = { ...target, targetSnapshotId: "snapshot-test", taskId: "task-voice", planRevision: "revision-voice", status: "running" };
  bridge.listedSessions = [exactTarget];
  bridge.currentVoiceValue = { id: "voice-binding-test", consentId: "voice-consent-test", voiceSessionId: "voice-session-test", managedSessionId: exactTarget.id, repositoryRoot: "C:\\repo", targetSnapshotId: "snapshot-test", contextPackageId: "handoff-test", contextDigest: "c".repeat(64), provider: "claude", transcript: "off", retentionMinutes: 0, status: "active" };

  bridge.nextDispatch = { status: "running", summary: "Voice Center awaits host acknowledgement.", data: { hostActionId: `host-action:${"3".repeat(64)}`, hostActionKind: "show_voice_center", hostActionExpiresAt: "2099-01-01T00:00:00.000Z" } };
  vscode.choose("Focus current managed voice session");
  await vscode.invoke("sxsy-b122.chord.voice.normal");

  now += 500;
  bridge.nextDispatch = { status: "running", summary: "Voice Center awaits host acknowledgement.", data: { hostActionId: `host-action:${"4".repeat(64)}`, hostActionKind: "show_voice_center", hostActionExpiresAt: "2099-01-01T00:00:00.000Z" } };
  await vscode.invoke("sxsy-b122.chord.voice.normal");
  now += 500;
  bridge.nextDispatch = { status: "running", summary: "Voice Center awaits host acknowledgement.", data: { hostActionId: `host-action:${"5".repeat(64)}`, hostActionKind: "show_voice_center", hostActionExpiresAt: "2099-01-01T00:00:00.000Z" } };
  await vscode.invoke("sxsy-b122.chord.voice.normal");

  now += 2_000;
  bridge.nextDispatch = { status: "running", summary: "Voice Center awaits host acknowledgement.", data: { hostActionId: `host-action:${"6".repeat(64)}`, hostActionKind: "show_voice_center", hostActionExpiresAt: "2099-01-01T00:00:00.000Z" } };
  vscode.choose("End voice conversation");
  await vscode.invoke("sxsy-b122.chord.voice.normal");

  assert.deepEqual(bridge.voiceMutes, ["voice-binding-test"]);
  assert.deepEqual(bridge.voiceResumes, ["voice-binding-test"]);
  assert.deepEqual(bridge.voiceEnds, ["voice-binding-test"]);
  assert.equal(vscode.quickPickSurfaces.some((surface) => surface.placeHolder?.includes("Native Voice Center")), true);
});

test("Alt Voice binds the active exact managed agent before protected workflow preparation", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const activeTerminal = new FakeTerminal("Focused Codex");
  vscode.terminals.push(activeTerminal);
  vscode.activeTerminal = activeTerminal;
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/voice-bind" }]
  });
  await controller.start();
  const registered = bridge.registered.find((session) => session.surface === "vscode_terminal" && session.metadata["sxsy-b122.terminalName"] === "Focused Codex")!;
  const exactManaged: ExtensionManagedSession = {
    ...registered,
    provider: "codex",
    status: "running",
    targetSnapshotId: "snapshot-test",
    taskId: "task-voice",
    planRevision: "revision-voice"
  };
  bridge.registered.splice(bridge.registered.indexOf(registered), 1, exactManaged);
  await vscode.invoke("sxsy-b122.adoptTerminal", { terminalName: "Focused Codex", provider: "codex" });
  bridge.currentVoiceValue = {
    id: "voice-binding-test",
    consentId: "voice-consent-test",
    voiceSessionId: "voice-session-test",
    repositoryRoot: "C:\\repo",
    targetSnapshotId: "snapshot-test",
    contextPackageId: "handoff-test",
    contextDigest: "c".repeat(64),
    provider: "claude",
    transcript: "off",
    retentionMinutes: 0,
    status: "active"
  };

  await vscode.invoke("sxsy-b122.chord.voice.alt");

  assert.deepEqual(bridge.voiceBinds, [{ bindingId: "voice-binding-test", managedSessionId: exactManaged.id }]);
  assert.deepEqual(bridge.voiceBindingSequence, ["bind", "prepare"]);
  assert.equal(bridge.workflowPrepared.at(-1)?.action, "bind_voice_session");
  assert.equal(bridge.dispatched.at(-1)?.sessionId, exactManaged.id);

  const dispatched = bridge.dispatched.length;
  bridge.currentVoiceValue = { ...bridge.currentVoiceValue!, targetSnapshotId: "different-snapshot", managedSessionId: undefined };
  await vscode.invoke("sxsy-b122.chord.voice.alt");
  assert.equal(bridge.voiceBinds.length, 1);
  assert.equal(bridge.workflowPrepared.length, 1);
  assert.equal(bridge.dispatched.length, dispatched);
  assert.match(vscode.warnings.at(-1) ?? "", /exact repository and TargetSnapshot/i);
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

test("refuses a dispatch URL that is not rebound by the final durable authorization", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const opened: string[] = [];
  bridge.authorizationUrlOverride = "http://127.0.0.1:4318/";
  bridge.nextDispatch = {
    status: "running",
    summary: "The verified web process awaits its exact host effect.",
    data: {
      hostActionId: `host-action:${"9".repeat(64)}`,
      hostActionKind: "open_external_url",
      hostActionExpiresAt: "2099-01-01T00:00:00.000Z",
      hostActionUrl: "http://127.0.0.1:4317/"
    }
  };
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    now: () => "2026-08-23T00:00:00.000Z",
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/review", changedPaths: [] }],
    openExternal: async (url) => { opened.push(url); return true; }
  });
  await controller.start();

  await vscode.invoke("sxsy-b122.chord.run.shift_alt");

  assert.deepEqual(opened, []);
  assert.equal(bridge.completedHostActions.at(-1)?.succeeded, false);
  assert.match(bridge.completedHostActions.at(-1)?.summary ?? "", /mismatch|rebound|authorization/i);
});

test("ambiguous GitHub navigation selects and authorizes one exact companion candidate", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const opened: string[] = [];
  const id = `host-action:${"8".repeat(64)}`;
  bridge.nextDispatch = { status: "running", summary: "Choose one exact current PR.", data: {
    hostActionId: id,
    hostActionKind: "select_github_navigation",
    hostActionExpiresAt: "2099-01-01T00:00:00.000Z",
    githubCandidates: [
      { id: "pull:2", label: "PR #2", description: "to main", url: "https://github.com/acme/project/pull/2" },
      { id: "pull:3", label: "PR #3", description: "to release", url: "https://github.com/acme/project/pull/3" }
    ]
  } };
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    now: () => "2026-08-23T00:00:00.000Z", idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/review", canonicalRemote: "https://github.com/acme/project.git" }],
    openExternal: async (url) => { opened.push(url); return true; }
  });
  await controller.start();
  vscode.choose("PR #3");
  await vscode.invoke("sxsy-b122.chord.github.shift");
  assert.deepEqual(bridge.authorizedHostActions.at(-1), { id, adapterVersion: "unpackaged-test", selectionId: "pull:3" });
  assert.deepEqual(opened, ["https://github.com/acme/project/pull/3"]);
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

test("forwards Run/Debug to the companion and performs only safe local host actions", async (context) => {
  const providerRoot = await mkdtemp(join(tmpdir(), "sxsy-vscode-provider-"));
  context.after(async () => { await rm(providerRoot, { recursive: true, force: true }); });
  const configuredProvider = join(providerRoot, "claude-code.exe");
  const configuredLauncher = join(providerRoot, "sxsy-b122-provider-desktop-helper.exe");
  const providerBytes = Buffer.from("test-only managed provider executable identity");
  const launcherBytes = Buffer.from("test-only fixed managed terminal launcher");
  await writeFile(configuredProvider, providerBytes);
  await writeFile(configuredLauncher, launcherBytes);
  const providerPath = await realpath(configuredProvider);
  const launcherPath = await realpath(configuredLauncher);
  const providerWorkspace = await realpath(providerRoot);
  const providerSha256 = createHash("sha256").update(providerBytes).digest("hex");
  const launcherSha256 = createHash("sha256").update(launcherBytes).digest("hex");
  const providerMetadata = await stat(providerPath);
  const providerExactMetadata = await stat(providerPath, { bigint: true });
  const vscode = new FakeVscode([], [providerWorkspace, "C:\\repo"]);
  const bridge = new FakeBridge();
  const opened: string[] = [];
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    now: () => "2026-08-23T00:00:00.000Z",
    idFactory: sequenceFactory(),
    managedTerminalHealthMs: 10,
    managedTerminalReceiptFactory: async (input) => ({
      pipeName: "sxsy-b122-managed-test",
      token: "d".repeat(64),
      async wait() { return { ...input, processId: 4243 }; },
      async dispose() {}
    }),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/debug-binding" }],
    openExternal: async (url) => { opened.push(url); return true; }
  });
  await controller.start();

  bridge.nextDispatch = { status: "running", summary: "Approved Claude Code profile awaits host acknowledgement.", data: {
    hostActionId: `host-action:${"c".repeat(64)}`,
    hostActionKind: "create_claude_terminal",
    hostActionExpiresAt: "2026-08-23T00:00:20.000Z",
    hostActionWorkspaceRoot: providerWorkspace,
    managedTerminalProfile: {
      provider: "claude_code", profileName: "SXSY-B122 Claude Code", canonicalLauncherPath: launcherPath,
      launcherSha256, launcherProtocolVersion: 1, canonicalExecutablePath: providerPath,
      executableSha256: providerSha256, signerSubject: "CN=Isolated Provider Test", signerThumbprint: "a".repeat(40), executableSize: providerMetadata.size, executableModifiedMs: providerMetadata.mtimeMs,
      executableDevice: providerExactMetadata.dev.toString(10), executableInode: providerExactMetadata.ino.toString(10),
      productIdentity: { productId: "anthropic.claude-code", displayName: "Claude Code", publisher: "Anthropic, PBC", role: "managed_terminal" },
      args: [], shell: false, installationId: "provider-install:claude-code", catalogDigest: "b".repeat(64),
      issuedAt: "2026-08-23T00:00:00.000Z", validUntil: "2026-08-23T00:00:20.000Z", requiresFinalIdentityVerification: true
    }
  } };
  await vscode.invoke("sxsy-b122.chord.claude.alt");
  assert.equal(bridge.dispatched.at(-1)?.control, "CLAUDE");
  assert.equal(vscode.createdTerminals.length, 1, vscode.warnings.join(" | "));
  assert.deepEqual(vscode.createdTerminals[0].sent, []);
  assert.equal(vscode.terminalOptions.at(-1)?.shellPath, launcherPath);
  assert.equal(vscode.terminalOptions.at(-1)?.shellArgs?.[0], "--managed-terminal-v1");
  assert.match(vscode.terminalOptions.at(-1)?.shellArgs?.[1] ?? "", /^[A-Za-z0-9_-]+$/);
  assert.equal(vscode.terminalOptions.at(-1)?.cwd, providerWorkspace);
  assert.equal(bridge.adopted.at(-1)?.provider, "claude");
  assert.equal(bridge.registered.find((session) => session.id === bridge.adopted.at(-1)?.sessionId)?.workspaceRoot, providerWorkspace);
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

  bridge.nextDispatch = { status: "running", summary: "Verified debugger awaits host acknowledgement.", operationId: "operation-debug-1", data: { hostActionId: `host-action:${"e".repeat(64)}`, hostActionKind: "start_vscode_debug", hostActionExpiresAt: "2099-01-01T00:00:00.000Z", hostActionWorkspaceRoot: "C:\\repo", hostActionDebugConfiguration: "Launch test" } };
  await vscode.invoke("sxsy-b122.chord.run.shift");
  assert.equal(vscode.started.length, 1);
  assert.equal(vscode.started[0]?.configuration.name, "Launch test");
  assert.equal(vscode.started[0]?.noDebug, false);
  const boundDebugSession = bridge.registered.find((session) => session.metadata["sxsy-b122.debugOriginOperationId"] === "operation-debug-1" && session.workspaceRoot === "C:\\repo");
  assert.ok(boundDebugSession);
  bridge.nextDispatch = { status: "running", summary: "Exact debug stop awaits host acknowledgement.", operationId: "operation-debug-stop-1", data: {
    hostActionId: `host-action:${"f".repeat(64)}`, hostActionKind: "stop_vscode_debug", hostActionExpiresAt: "2099-01-01T00:00:00.000Z",
    hostActionWorkspaceRoot: "C:\\repo", hostActionDebugConfiguration: "Launch test", hostActionDebugSessionId: "debug-1", hostActionDebugOriginOperationId: "operation-debug-1"
  } };
  await vscode.invoke("sxsy-b122.chord.run.alt");
  assert.equal(bridge.dispatched.at(-1)?.sessionId, boundDebugSession.id);
  assert.equal(vscode.stopped.at(-1)?.id, "debug-1");
  assert.equal(bridge.completedHostActions.at(-1)?.succeeded, true);

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

test("durable debug binding survives a lost start acknowledgement and extension restart before exact Alt-Run stop", async () => {
  const context = new FakeContext();
  const firstVscode = new FakeVscode();
  const firstBridge = new FakeBridge();
  const firstController = new ManagedSessionController(firstVscode.api, context, firstBridge, {
    now: () => "2026-08-25T00:00:00.000Z",
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/debug-recovery" }]
  });
  await firstController.start();
  firstBridge.nextDispatch = { status: "running", summary: "Verified debug start awaits host acknowledgement.", operationId: "operation-debug-recovery", data: {
    hostActionId: `host-action:${"7".repeat(64)}`, hostActionKind: "start_vscode_debug", hostActionExpiresAt: "2099-01-01T00:00:00.000Z",
    hostActionWorkspaceRoot: "C:\\repo", hostActionDebugConfiguration: "Launch test"
  } };
  firstBridge.completeHostActionFailure = "simulated lost durable completion acknowledgement";
  await firstVscode.invoke("sxsy-b122.chord.run.shift");
  assert.equal(firstVscode.started.length, 1);
  assert.match(firstVscode.warnings.at(-1) ?? "", /requires reconciliation/i);
  const durable = context.values.get("sxsy-b122.debugBindings.v1") as Array<Record<string, unknown>>;
  assert.equal(durable.length, 1);
  assert.equal(durable[0]?.status, "running");
  assert.equal(durable[0]?.originOperationId, "operation-debug-recovery");
  const exactDebug = firstVscode.activeDebugSession;
  assert.equal(exactDebug?.id, "debug-1");
  await firstController.stop();

  const restartedVscode = new FakeVscode();
  restartedVscode.activeDebugSession = exactDebug;
  const restartedBridge = new FakeBridge();
  const restartedController = new ManagedSessionController(restartedVscode.api, context, restartedBridge, {
    now: () => "2026-08-25T00:01:00.000Z",
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/debug-recovery" }]
  });
  await restartedController.start();
  const recovered = restartedBridge.registered.find((session) => session.metadata["sxsy-b122.debugOriginOperationId"] === "operation-debug-recovery");
  assert.ok(recovered);
  restartedBridge.nextDispatch = { status: "running", summary: "Recovered exact debug stop awaits host acknowledgement.", operationId: "operation-debug-recovery-stop", data: {
    hostActionId: `host-action:${"8".repeat(64)}`, hostActionKind: "stop_vscode_debug", hostActionExpiresAt: "2099-01-01T00:00:00.000Z",
    hostActionWorkspaceRoot: "C:\\repo", hostActionDebugConfiguration: "Launch test", hostActionDebugSessionId: "debug-1", hostActionDebugOriginOperationId: "operation-debug-recovery"
  } };
  await restartedVscode.invoke("sxsy-b122.chord.run.alt");
  assert.equal(restartedBridge.dispatched.at(-1)?.sessionId, recovered.id);
  assert.equal(restartedVscode.stopped.at(-1)?.id, "debug-1");
  assert.equal((context.values.get("sxsy-b122.debugBindings.v1") as unknown[]).length, 0);
  await restartedController.stop();
});

test("Alt-Run selects one exact durable debug session and retains ambiguous stop state when termination is not observed", async () => {
  const context = new FakeContext();
  const vscode = new FakeVscode();
  vscode.debugConfigurations = [
    { name: "Launch A", type: "node", request: "launch" },
    { name: "Launch B", type: "node", request: "launch" }
  ];
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, context, bridge, {
    now: () => "2026-08-25T00:00:00.000Z",
    idFactory: sequenceFactory(),
    debugLifecycleTimeoutMs: 50,
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/debug-ambiguity" }]
  });
  await controller.start();
  bridge.nextDispatch = { status: "running", summary: "Debug A awaits host acknowledgement.", operationId: "operation-debug-a", data: {
    hostActionId: `host-action:${"9".repeat(64)}`, hostActionKind: "start_vscode_debug", hostActionExpiresAt: "2099-01-01T00:00:00.000Z",
    hostActionWorkspaceRoot: "C:\\repo", hostActionDebugConfiguration: "Launch A"
  } };
  await vscode.invoke("sxsy-b122.chord.run.shift");
  bridge.nextDispatch = { status: "running", summary: "Debug B awaits host acknowledgement.", operationId: "operation-debug-b", data: {
    hostActionId: `host-action:${"a".repeat(64)}`, hostActionKind: "start_vscode_debug", hostActionExpiresAt: "2099-01-01T00:00:00.000Z",
    hostActionWorkspaceRoot: "C:\\repo", hostActionDebugConfiguration: "Launch B"
  } };
  await vscode.invoke("sxsy-b122.chord.run.shift");
  assert.deepEqual(vscode.started.map((entry) => entry.configuration.name), ["Launch A", "Launch B"]);
  const selected = bridge.registered.find((session) => session.metadata["sxsy-b122.debugOriginOperationId"] === "operation-debug-b");
  assert.ok(selected);
  vscode.choose("Launch B — C:\\repo");
  vscode.publishDebugStop = false;
  bridge.nextDispatch = { status: "running", summary: "Exact Debug B stop awaits host acknowledgement.", operationId: "operation-debug-b-stop", data: {
    hostActionId: `host-action:${"b".repeat(64)}`, hostActionKind: "stop_vscode_debug", hostActionExpiresAt: "2099-01-01T00:00:00.000Z",
    hostActionWorkspaceRoot: "C:\\repo", hostActionDebugConfiguration: "Launch B", hostActionDebugSessionId: "debug-2", hostActionDebugOriginOperationId: "operation-debug-b"
  } };
  await vscode.invoke("sxsy-b122.chord.run.alt");
  assert.equal(bridge.dispatched.at(-1)?.sessionId, selected.id);
  assert.equal(vscode.stopped.at(-1)?.id, "debug-2");
  assert.equal(bridge.completedHostActions.at(-1)?.succeeded, false);
  assert.equal(bridge.completedHostActions.at(-1)?.effectDisposition, "ambiguous");
  const durable = context.values.get("sxsy-b122.debugBindings.v1") as Array<Record<string, unknown>>;
  assert.equal(durable.find((entry) => entry.originOperationId === "operation-debug-b")?.status, "stopping");
  assert.equal(durable.find((entry) => entry.originOperationId === "operation-debug-a")?.status, "running");
  await controller.stop();
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
  const opened: string[] = [];
  bridge.nextDispatch = { status: "running", summary: "bad response", data: { hostActionId: `host-action:${"b".repeat(64)}`, hostActionKind: "create_codex_terminal", hostActionExpiresAt: "2099-01-01T00:00:00.000Z" } };
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), openExternal: async (url) => { opened.push(url); return true; } });
  await controller.start();
  await vscode.invoke("sxsy-b122.chord.claude.alt");
  assert.equal(vscode.createdTerminals.length, 0);
  assert.match(vscode.warnings.at(-1) ?? "", /malformed host-action/i);

  bridge.nextDispatch = { status: "running", summary: "stale provider fallback", data: { hostActionId: `host-action:${"c".repeat(64)}`, hostActionKind: "open_external_url", hostActionExpiresAt: "2099-01-01T00:00:00.000Z", hostActionUrl: "https://claude.example.invalid/" } };
  await vscode.invoke("sxsy-b122.chord.claude.normal");
  bridge.nextDispatch = { status: "running", summary: "stale provider fallback", data: { hostActionId: `host-action:${"d".repeat(64)}`, hostActionKind: "open_external_url", hostActionExpiresAt: "2099-01-01T00:00:00.000Z", hostActionUrl: "https://chatgpt.example.invalid/" } };
  await vscode.invoke("sxsy-b122.chord.chatgpt.shift");
  assert.deepEqual(opened, []);
  assert.match(vscode.warnings.at(-1) ?? "", /unexpected local host action/i);
});

test("a targetless physical Voice claim opens the real Voice Center and settles through the exact extension lease", async () => {
  const vscode = new FakeVscode([], []);
  const bridge = new FakeBridge();
  bridge.currentVoiceValue = {
    id: "voice-binding-physical",
    consentId: "voice-consent-physical",
    voiceSessionId: "voice-session-physical",
    repositoryRoot: "C:\\repo",
    targetSnapshotId: "snapshot-physical",
    contextPackageId: "handoff-physical",
    contextDigest: "c".repeat(64),
    provider: "claude",
    transcript: "off",
    retentionMinutes: 0,
    status: "active"
  };
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    now: () => "2026-08-25T12:00:00.100Z",
    idFactory: sequenceFactory(),
    extensionVersion: "1.2.3",
    hostActionPollIntervalMs: 10
  });
  await controller.start();
  const window = controller.listKnownSessions().find((candidate) => candidate.metadata["sxsy-b122.kind"] === "window")!;
  assert.equal(window.metadata["sxsy-b122.extensionVersion"], "1.2.3");
  assert.equal(window.metadata["sxsy-b122.hostActionCapabilities"], JSON.stringify(["show_voice_center"]));
  bridge.hostActionClaims.push({
    version: 1,
    claimId: `host-action-claim:${"a".repeat(64)}`,
    claimToken: "controller-voice-claim-token",
    hostActionId: `host-action:${"b".repeat(64)}`,
    operationId: "operation-physical-voice",
    commandAction: "open_voice",
    hostActionKind: "show_voice_center",
    windowSessionId: window.id,
    adapterVersion: "1.2.3",
    capabilities: ["show_voice_center"],
    claimedAt: "2026-08-25T12:00:00.000Z",
    expiresAt: "2026-08-25T12:00:05.000Z",
    actionExpiresAt: "2026-08-25T12:00:30.000Z"
  });
  vscode.choose("Mute voice conversation");
  for (let attempt = 0; attempt < 50 && bridge.completedHostActions.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(bridge.hostActionClaimBindings.some((binding) => binding.windowSessionId === window.id && binding.adapterVersion === "1.2.3"), true);
  assert.deepEqual(bridge.voiceMutes, ["voice-binding-physical"]);
  assert.deepEqual(bridge.authorizedHostActions.at(-1), { id: `host-action:${"b".repeat(64)}`, adapterVersion: "1.2.3", claimId: `host-action-claim:${"a".repeat(64)}` });
  assert.equal(bridge.completedHostActions.at(-1)?.succeeded, true);
  assert.equal(bridge.completedHostActions.at(-1)?.effectDisposition, "committed");
  assert.equal(bridge.completedHostActions.at(-1)?.claimId, `host-action-claim:${"a".repeat(64)}`);
  assert.equal(bridge.dispatched.length, 0, "the extension must not fabricate a second command dispatch for a companion-queued physical Voice action");
  await controller.stop();
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

test("hardware Plan Approval forwards the exact companion-issued token and protected review scope", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/hardware-plan" }] });
  await controller.start();
  const window = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "window")!;
  const target = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "git-root")!;
  const confirmationScopeDigest = "8".repeat(64);
  const bound = { ...target, provider: "codex" as const, targetSnapshotId: "9".repeat(64), taskId: "task-hardware-plan", planRevision: "revision-hardware-plan" };
  const workflowReview = exactPlanReview(bound, confirmationScopeDigest);
  bridge.preparationSequence.push(
    { status: "incomplete", summary: "Review the exact protected hardware plan.", session: bound, workflowReview },
    { status: "prepared", summary: "Exact protected plan reviewed.", authorityId: "authority-hardware-plan", confirmationToken: "confirmation-hardware-plan", confirmationScopeDigest, session: bound }
  );
  vscode.choose(`Approve exact protected scope ${confirmationScopeDigest}`);
  const claim: HardwareSignalClaim = { signalId: `hardware-signal:${"7".repeat(64)}`, claimToken: "claim-token-hardware-plan", deviceId: "6".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 8, control: "PLAN_APPROVAL", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: window.id, workspaceRoots: ["C:\\repo"] };
  const command = chordFor(claim.control, claim.modifier);
  assert.ok(command);

  await controller.dispatchChord(command, undefined, claim);

  assert.deepEqual(bridge.workflowPrepared.at(-1)?.intent, { kind: "plan_approval", confirmationToken: "confirmation-hardware-plan", confirmationScopeDigest });
  assert.deepEqual(bridge.hardwarePreparationReviewScopes, [undefined, confirmationScopeDigest]);
  assert.equal(bridge.hardwareDispatchCommands.at(-1)?.confirmationToken, "confirmation-hardware-plan");
  assert.equal(bridge.hardwareDispatchCommands.at(-1)?.confirmationScopeDigest, confirmationScopeDigest);
  assert.equal(bridge.dispatched.length, 0);
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

test("deactivation drains a deferred hardware claim and returns it before dispatch", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  let releaseClaim!: () => void;
  bridge.hardwareClaimGate = new Promise<void>((resolve) => { releaseClaim = resolve; });
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/hardware" }] });
  await controller.start();
  const window = controller.listKnownSessions().find((session) => session.metadata["sxsy-b122.kind"] === "window")!;
  bridge.hardwareClaims.push({ signalId: `hardware-signal:${"3".repeat(64)}`, claimToken: "claim-token-deactivate", deviceId: "4".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 7, control: "PROOF", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: window.id, workspaceRoots: ["C:\\repo"] });
  for (let attempt = 0; attempt < 20 && bridge.hardwareClaimBindings.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(bridge.hardwareClaimBindings.length, 1);
  const stopped = controller.stop();
  releaseClaim();
  await stopped;
  assert.equal(bridge.hardwarePrepared.length, 0);
  assert.equal(bridge.hardwareDispatched.length, 0);
  assert.equal(bridge.hardwareCompleted.length, 1);
  assert.equal(bridge.hardwareCompleted[0]?.outcome, "failed_before_dispatch");
});

test("extension lifecycle disposes its DPAPI reader only after controller drain and even on drain failure", async () => {
  const events: string[] = [];
  await deactivateManagedExtension(
    { async stop() { events.push("drain:start"); await Promise.resolve(); events.push("drain:end"); } },
    { async dispose() { events.push("reader:dispose"); } }
  );
  assert.deepEqual(events, ["drain:start", "drain:end", "reader:dispose"]);

  events.length = 0;
  await assert.rejects(() => deactivateManagedExtension(
    { async stop() { events.push("drain:failed"); throw new Error("drain failed"); } },
    { async dispose() { events.push("reader:dispose"); } }
  ), /drain failed/);
  assert.deepEqual(events, ["drain:failed", "reader:dispose"]);
});

test("stop drains deferred initial registration and fences every later startup mutation", async () => {
  const vscode = new FakeVscode(["Deferred terminal"], ["C:\\repo"]);
  const context = new FakeContext();
  const bridge = new FakeBridge();
  let releaseRegistration!: () => void;
  bridge.registerGate = new Promise<void>((resolve) => { releaseRegistration = resolve; });
  const controller = new ManagedSessionController(vscode.api, context, bridge, {
    idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/deactivate" }]
  });

  const starting = controller.start();
  for (let attempt = 0; attempt < 40 && bridge.registerCalls === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(bridge.registerCalls, 1, "startup did not reach the deferred registration boundary");
  let stopped = false;
  const stopping = controller.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stopped, false, "stop returned before the admitted startup registration drained");
  releaseRegistration();
  await Promise.all([starting, stopping]);

  assert.deepEqual(controller.listKnownSessions(), []);
  assert.equal(context.values.size, 0, "a stopped generation mutated durable VS Code workspace state");
  assert.equal(bridge.registerCalls, 1, "the stopped generation continued to terminal/debug/Git registrations");
});

test("stop drains in-flight reconnect health and prevents post-stop registration or reschedule", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), new FakeBridge(), {
    idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/reconnect" }]
  });
  await controller.start();

  const reconnectBridge = new FakeBridge();
  let releaseHealth!: () => void;
  reconnectBridge.healthGate = new Promise<void>((resolve) => { releaseHealth = resolve; });
  controller.attachBridge(reconnectBridge);
  for (let attempt = 0; attempt < 40 && reconnectBridge.healthCalls === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(reconnectBridge.healthCalls, 1, "the immediate reconnect probe did not begin");
  let stopped = false;
  const stopping = controller.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stopped, false, "stop returned while reconnect health was still admitted");
  releaseHealth();
  await stopping;
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(reconnectBridge.registerCalls, 0, "a stopped reconnect generation reached registration");
  assert.equal(reconnectBridge.healthCalls, 1, "a stopped reconnect generation rescheduled itself");
});

test("stop drains an admitted terminal event and fences its post-await registry mutation", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory() });
  await controller.start();
  const baseline = controller.listKnownSessions().length;
  let releaseRegistration!: () => void;
  bridge.registerGate = new Promise<void>((resolve) => { releaseRegistration = resolve; });
  const terminal = new FakeTerminal("Deferred event terminal");
  const priorRegisterCalls = bridge.registerCalls;
  const firing = vscode.fireOpen(terminal);
  for (let attempt = 0; attempt < 40 && bridge.registerCalls <= priorRegisterCalls; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(bridge.registerCalls, priorRegisterCalls + 1, "terminal event did not reach its deferred bridge boundary");
  let stopped = false;
  const stopping = controller.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stopped, false, "stop returned while a terminal event remained admitted");
  releaseRegistration();
  await Promise.allSettled([firing, stopping]);
  assert.equal(controller.listKnownSessions().length, baseline, "a stopped terminal event mutated the session registry after its await");
});

test("stop drains deferred workspace and debug events without post-stop session mutation", async () => {
  for (const eventKind of ["workspace", "debug"] as const) {
    const vscode = new FakeVscode([], ["C:\\repo"]);
    const bridge = new FakeBridge();
    const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
      idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/event-stop" }]
    });
    await controller.start();
    const baseline = controller.listKnownSessions().length;
    let releaseRegistration!: () => void;
    bridge.registerGate = new Promise<void>((resolve) => { releaseRegistration = resolve; });
    const priorRegisterCalls = bridge.registerCalls;
    const firing = eventKind === "workspace"
      ? vscode.fireWorkspaceChange()
      : vscode.fireDebugStart({ id: "deferred-debug", name: "Deferred debug", configuration: { name: "Launch test" } });
    for (let attempt = 0; attempt < 40 && bridge.registerCalls <= priorRegisterCalls; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(bridge.registerCalls, priorRegisterCalls + 1, `${eventKind} event did not reach its deferred bridge boundary`);
    let stopped = false;
    const stopping = controller.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(stopped, false, `stop returned while the ${eventKind} event remained admitted`);
    releaseRegistration();
    await Promise.allSettled([firing, stopping]);
    assert.equal(controller.listKnownSessions().length, baseline, `a stopped ${eventKind} event mutated the session registry`);
  }
});

test("stop drains credential sealing and fences the later credential bridge effect", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  let releaseSeal!: () => void;
  let sealStarted = false;
  const sealGate = new Promise<void>((resolve) => { releaseSeal = resolve; });
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    idFactory: sequenceFactory(),
    resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/credential-stop" }],
    sealSecret: async () => { sealStarted = true; await sealGate; return "sealed-after-stop"; }
  });
  await controller.start();
  vscode.choose("C:\\repo");
  vscode.input("github-token");
  vscode.input("configured-network/provider-api");
  vscode.input("must-not-cross-after-stop");
  const command = vscode.invoke("sxsy-b122.provisionCredential");
  for (let attempt = 0; attempt < 40 && !sealStarted; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sealStarted, true, "credential command did not reach its deferred DPAPI boundary");
  let stopped = false;
  const stopping = controller.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stopped, false, "stop returned while credential sealing remained admitted");
  releaseSeal();
  await Promise.allSettled([command, stopping]);
  assert.deepEqual(bridge.credentialProvisionRequests, [], "a credential command crossed the bridge after stop began");
});

test("stop drains final host authorization and fences the later VS Code host effect", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  bridge.nextDispatch = { status: "running", summary: "Focus awaits final authorization.", data: {
    hostActionId: `host-action:${"9".repeat(64)}`, hostActionKind: "focus_vscode", hostActionExpiresAt: "2099-01-01T00:00:00.000Z"
  } };
  let releaseAuthorization!: () => void;
  bridge.authorizeGate = new Promise<void>((resolve) => { releaseAuthorization = resolve; });
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory() });
  await controller.start();
  const command = vscode.invoke("sxsy-b122.chord.vscode.normal");
  for (let attempt = 0; attempt < 40 && bridge.authorizedHostActions.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(bridge.authorizedHostActions.length, 1, "dispatch did not reach its deferred final host authorization");
  let stopped = false;
  const stopping = controller.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stopped, false, "stop returned while a final host authorization remained admitted");
  releaseAuthorization();
  await Promise.allSettled([command, stopping]);
  assert.deepEqual(vscode.executedCommands, [], "a VS Code host effect ran after stop began");
});

test("repeated normal VS Code presses focus once then cycle the next open window", async () => {
  let clock = Date.parse("2026-08-24T10:00:00.000Z");
  const vscode = new FakeVscode();
  const bridge = new FakeBridge();
  bridge.nextDispatch = { status: "running", summary: "VS Code focus awaits host acknowledgement.", data: {
    hostActionId: `host-action:${"7".repeat(64)}`, hostActionKind: "focus_vscode", hostActionExpiresAt: "2099-01-01T00:00:00.000Z"
  } };
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    now: () => new Date(clock).toISOString(), idFactory: sequenceFactory(), repeatWindowMs: 1_500
  });
  await controller.start();

  await vscode.invoke("sxsy-b122.chord.vscode.normal");
  assert.deepEqual(vscode.executedCommands, ["workbench.action.focusActiveEditorGroup"]);

  clock += 500;
  await vscode.invoke("sxsy-b122.chord.vscode.normal");
  assert.deepEqual(vscode.executedCommands.slice(-3), [
    "workbench.action.switchWindow",
    "workbench.action.quickOpenNavigateNextInViewPicker",
    "workbench.action.acceptSelectedQuickOpenItem"
  ]);

  clock += 2_000;
  await vscode.invoke("sxsy-b122.chord.vscode.normal");
  assert.equal(vscode.executedCommands.at(-1), "workbench.action.focusActiveEditorGroup");
  controller.stop();
});

test("normal Pipeline presents live local and hosted evidence and cycles failing gates on repeat", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  bridge.nextDispatch = {
    status: "completed",
    summary: "Observed local and hosted pipeline evidence.",
    data: {
      local: { status: "completed", summary: "The exact local Git worktree is clean.", effectDisposition: "committed", data: { clean: true } },
      hosted: { status: "completed", summary: "Exact-head CI observed.", effectDisposition: "committed", data: {
        head: "a".repeat(40), hostedState: "FAILURE",
        contexts: [
          { kind: "check", name: "unit-tests", state: "COMPLETED", conclusion: "FAILURE", summary: "Two tests failed." },
          { kind: "check", name: "lint", state: "COMPLETED", conclusion: "ACTION_REQUIRED", summary: "Formatting differs." },
          { kind: "check", name: "build", state: "COMPLETED", conclusion: "SUCCESS" }
        ],
        localReceipts: [{ action: "pipeline_local_gate", result: "failed", completeness: "complete", createdAt: "2026-08-24T09:00:00.000Z", expired: false, invalidated: false }]
      } },
      completeness: "local_and_hosted"
    }
  };
  const context = new FakeContext();
  const controller = new ManagedSessionController(vscode.api, context, bridge, {
    idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/ux" }]
  });
  await controller.start();

  await vscode.invoke("sxsy-b122.chord.pipeline.normal");
  assert.match(vscode.warnings.at(-1) ?? "", /feature\/ux.*hosted FAILURE/i);
  assert.match(vscode.warnings.at(-1) ?? "", /Failure 1 of 2: unit-tests=FAILURE/i);
  assert.match(vscode.warnings.at(-1) ?? "", /local pipeline_local_gate=failed/i);
  assert.match(vscode.warnings.at(-1) ?? "", /press Pipeline again.*Alt Pipeline/i);

  await vscode.invoke("sxsy-b122.chord.pipeline.normal");
  assert.match(vscode.warnings.at(-1) ?? "", /Failure 2 of 2: lint=ACTION_REQUIRED/i);
  controller.stop();
});

test("Alt Pipeline renders the selected exact-head failure excerpt and diagnosis instead of a generic output panel", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  bridge.nextDispatch = { status: "running", summary: "Protected failure trace awaits host acknowledgement.", data: {
    hostActionId: `host-action:${"8".repeat(64)}`, hostActionKind: "show_pipeline_failure_trace", hostActionExpiresAt: "2099-01-01T00:00:00.000Z",
    head: "a".repeat(40), selectedIndex: 0, failureCount: 2, repeatAvailable: true,
    selectedFailure: { kind: "check", name: "unit-tests", state: "COMPLETED", conclusion: "FAILURE", summary: "Expected 2 but received 3." },
    logExcerpt: "AssertionError: Expected 2 but received 3. token=must-not-render",
    diagnosis: "The bounded output indicates a test assertion failure; inspect the named failing test."
  } };
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/trace" }] });
  await controller.start();

  await vscode.invoke("sxsy-b122.chord.pipeline.alt");

  const surface = vscode.quickPickSurfaces.at(-1);
  assert.match(surface?.placeHolder ?? "", /failure 1 of 2.*exact head/i);
  assert.equal(JSON.stringify(surface?.items).includes("Expected 2 but received 3"), true);
  assert.equal(JSON.stringify(surface?.items).includes("must-not-render"), false);
  assert.equal(JSON.stringify(surface?.items).includes("test assertion failure"), true);
  assert.equal(vscode.executedCommands.includes("workbench.action.output.toggleOutput"), false);
  controller.stop();
});

test("Compound palette is repository-bound and routes only canonical Compound chord commands", async () => {
  const vscode = new FakeVscode([], ["C:\\repo"]);
  const bridge = new FakeBridge();
  bridge.nextDispatch = { status: "running", summary: "Compound palette awaits host acknowledgement.", data: {
    hostActionId: `host-action:${"8".repeat(64)}`, hostActionKind: "open_compound_palette", hostActionExpiresAt: "2099-01-01T00:00:00.000Z", hostActionWorkspaceRoot: "C:\\repo"
  } };
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, {
    idFactory: sequenceFactory(), resolveGitRoots: async () => [{ gitRoot: "C:\\repo", branch: "feature/compound" }]
  });
  await controller.start();
  vscode.choose("Capture — ce-compound");
  await vscode.invoke("sxsy-b122.chord.compound.alt");

  assert.match(vscode.quickPickSurfaces.at(-1)?.placeHolder ?? "", /C:\\repo.*feature\/compound/i);
  assert.deepEqual(vscode.executedCommands.at(-1), "sxsy-b122.chord.compound.normal");
  assert.equal(vscode.executedCommands.includes("workbench.action.showCommands"), false);
  assert.equal(bridge.completedHostActions.at(-1)?.succeeded, true);
  controller.stop();
});

test("quick-reference command opens a searchable read-only overlay for all 65 settled chords", async () => {
  const vscode = new FakeVscode();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), new FakeBridge(), { idFactory: sequenceFactory() });
  await controller.start();
  await vscode.invoke("sxsy-b122.showQuickReference");

  const overlay = vscode.quickPickSurfaces.at(-1);
  assert.equal(overlay?.items.length, 65);
  assert.match(overlay?.placeHolder ?? "", /search.*read-only.*65/i);
  const labels = (overlay?.items ?? []).map((item) => typeof item === "string" ? item : item.label);
  assert.equal(labels.includes("Pipeline · Normal — Pipeline Status"), true);
  assert.equal(labels.includes("Sandbox · Ctrl+Shift+Alt — Quarantine"), true);
  assert.equal(vscode.executedCommands.length, 0);
  controller.stop();
});

test("background registry refresh notifies each verified Blocked and Finished transition once", async () => {
  const vscode = new FakeVscode();
  const bridge = new FakeBridge();
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { idFactory: sequenceFactory() });
  await controller.start();
  const seed = bridge.registered[0]!;
  const blocked = { ...seed, id: "provider-blocked", provider: "claude" as const, status: "verified_blocked" as const };
  const finished = { ...seed, id: "provider-finished", provider: "codex" as const, status: "verified_finished" as const };
  bridge.listedSessions = [blocked, finished];

  await controller.refreshSessionNotifications();
  await controller.refreshSessionNotifications();
  assert.equal(vscode.warnings.filter((message) => /provider-blocked.*Blocked/i.test(message)).length, 1);
  assert.equal(vscode.information.filter((message) => /provider-finished.*Finished/i.test(message)).length, 1);

  bridge.listedSessions = [{ ...blocked, status: "running" }, finished];
  await controller.refreshSessionNotifications();
  bridge.listedSessions = [blocked, finished];
  await controller.refreshSessionNotifications();
  assert.equal(vscode.warnings.filter((message) => /provider-blocked.*Blocked/i.test(message)).length, 2);
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
