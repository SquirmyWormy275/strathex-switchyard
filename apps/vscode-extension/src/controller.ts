import { delimiter, dirname, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { chordCommands, chordFor, type B122Control, type B122Modifier, type ChordCommand } from "./commands.ts";
import {
  forwardedHostAction,
  forwardedWorkflowOutcome,
  type ExtensionCompanionBridge,
  type ExtensionManagedSession,
  type ExtensionProvider,
  type ExtensionHandoffPackage,
  type ExtensionWorkflowAction,
  type ExtensionWorkflowArtifact,
  type ExtensionWorkflowPreparationIntent,
  type ExtensionWorkflowProviderResult,
  type ExtensionVoiceBinding,
  type ExtensionVoiceProvider,
  type CredentialProvisionScope,
  type HardwareSignalClaim,
  type ForwardedCommand,
  type ForwardedCommandResult,
  type ForwardedHostAction,
  type ForwardedHostActionAuthorization,
  type LocalHostAction,
  type ManagedTerminalProfileSummary,
  type ProviderDesktopId,
  type ReviewedGitMutation
} from "./companion-bridge.ts";
import type {
  DebugConfigurationLike,
  DebugSessionLike,
  ExtensionContextLike,
  QuickPickItemLike,
  TerminalLike,
  VscodeLike
} from "./vscode-like.ts";

const windowStateKey = "sxsy-b122.managedWindow";
const selectedTargetStateKey = "sxsy-b122.selectedGitTarget";
const vscodeRepeatStateKey = "sxsy-b122.vscodeRepeat";
const voiceRepeatStateKey = "sxsy-b122.voiceRepeat";
const pipelineFailureCursorStateKey = "sxsy-b122.pipelineFailureCursor";
const highConsequenceActions = ["council_automatic", "pr_merge", "direct_main", "lfg", "repair_mission", "emergency_containment", "full_sandbox", "rebuild_full_sandbox", "quarantine", "containment_release"] as const;
const providerDesktopIds = ["claude_desktop", "chatgpt_desktop", "claude_code", "codex"] as const satisfies readonly ProviderDesktopId[];

interface StoredWindowState {
  readonly id: string;
  readonly lifecycle: "registered" | "pending_companion";
  readonly workspaceRoots: readonly string[];
  readonly updatedAt: string;
}

interface TrackedTerminal {
  readonly sessionId: string;
  readonly adoptionKey: string;
  adopted: boolean;
  session: ExtensionManagedSession;
}

export interface ManagedSessionControllerOptions {
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly extensionVersion?: string;
  /** Optional built-in Git adapter; an absent adapter is recorded as unknown. */
  readonly resolveGitRoots?: () => Promise<readonly GitRootRegistration[]>;
  /** Real activation wires VS Code's URI API; tests inject a deterministic boundary. */
  readonly openExternal?: (url: string) => Promise<boolean>;
  /** Fixed VS Code commands only; B122 input never selects a command string. */
  readonly executeCommand?: (command: string) => Promise<void>;
  /** DPAPI CurrentUser sealing owned by the installed extension host. */
  readonly sealSecret?: (cleartext: Uint8Array) => Promise<string>;
  /** Local Registered-session liveness only; provider proof is host-observed. */
  readonly heartbeatIntervalMs?: number;
  /** Bounded helper/process health window. Tests may shorten it, never disable it. */
  readonly managedTerminalHealthMs?: number;
  /** Exact child-start receipt seam; production uses a one-shot local named pipe. */
  readonly managedTerminalReceiptFactory?: ManagedTerminalReceiptFactory;
  /** Consecutive normal-press gesture window; bounded because firmware repeat timing is not yet accepted. */
  readonly repeatWindowMs?: number;
}

export interface ManagedTerminalLaunchReceipt {
  readonly provider: "claude_code" | "codex";
  readonly processId: number;
  readonly canonicalExecutablePath: string;
  readonly canonicalWorkspaceRoot: string;
}
export interface ManagedTerminalReceiptReservation {
  readonly pipeName: string;
  readonly token: string;
  wait(): Promise<ManagedTerminalLaunchReceipt>;
  dispose(): Promise<void>;
}
export type ManagedTerminalReceiptFactory = (input: Readonly<{ provider: "claude_code" | "codex"; canonicalExecutablePath: string; canonicalWorkspaceRoot: string }>) => Promise<ManagedTerminalReceiptReservation>;

export interface GitRootRegistration {
  readonly gitRoot: string;
  readonly branch?: string;
  readonly worktree?: string;
  readonly canonicalRemote?: string;
  readonly changedPaths?: readonly string[];
}

/**
 * Owns only VS Code-visible identity and lifecycle. It never infers agent
 * state from a terminal's appearance and never upgrades a terminal beyond
 * Registered without the companion's verified adapter/broker handshake.
 */
export class ManagedSessionController {
  private readonly vscode: VscodeLike;
  private readonly context: ExtensionContextLike;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly extensionVersion: string;
  private readonly resolveGitRoots: () => Promise<readonly GitRootRegistration[]>;
  private readonly openExternal: (url: string) => Promise<boolean>;
  private readonly executeCommand: (command: string) => Promise<void>;
  private readonly sealSecret?: (cleartext: Uint8Array) => Promise<string>;
  private readonly heartbeatIntervalMs: number;
  private readonly managedTerminalHealthMs: number;
  private readonly managedTerminalReceiptFactory: ManagedTerminalReceiptFactory;
  private readonly repeatWindowMs: number;
  private readonly terminalRecords = new WeakMap<TerminalLike, TrackedTerminal>();
  private readonly closedTerminals = new WeakSet<TerminalLike>();
  private readonly terminalBySessionId = new Map<string, TrackedTerminal>();
  private readonly debugSessionIds = new WeakMap<DebugSessionLike, string>();
  private readonly sessions = new Map<string, ExtensionManagedSession>();
  private started = false;
  private windowSessionId?: string;
  private gitRoots: readonly GitRootRegistration[] = [];
  private bridge: ExtensionCompanionBridge;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private hardwareSignalTimer?: ReturnType<typeof setTimeout>;
  private hardwareSignalInFlight = false;
  private sessionHeartbeatTimer?: ReturnType<typeof setTimeout>;
  private sessionHeartbeatInFlight = false;
  private readonly observedNotificationStatus = new Map<string, ExtensionManagedSession["status"]>();
  private readonly deferredHostCommands = new Map<string, string>();

  constructor(vscode: VscodeLike, context: ExtensionContextLike, bridge: ExtensionCompanionBridge, options: ManagedSessionControllerOptions = {}) {
    this.vscode = vscode;
    this.context = context;
    this.bridge = bridge;
    this.now = options.now ?? (() => new Date().toISOString());
    let counter = 0;
    this.idFactory = options.idFactory ?? (() => `vscode-${Date.now().toString(36)}-${++counter}`);
    this.extensionVersion = options.extensionVersion ?? "0.2.0";
    this.resolveGitRoots = options.resolveGitRoots ?? (async () => []);
    this.openExternal = options.openExternal ?? (async () => false);
    this.executeCommand = options.executeCommand ?? (async (command) => {
      if (!this.vscode.commands.executeCommand) throw new Error("The VS Code host command boundary is unavailable.");
      await this.vscode.commands.executeCommand(command);
    });
    this.sealSecret = options.sealSecret;
    this.heartbeatIntervalMs = boundedHeartbeatInterval(options.heartbeatIntervalMs ?? 30_000);
    this.managedTerminalHealthMs = boundedManagedTerminalHealth(options.managedTerminalHealthMs ?? 500);
    this.managedTerminalReceiptFactory = options.managedTerminalReceiptFactory ?? reserveManagedTerminalReceipt;
    this.repeatWindowMs = boundedRepeatWindow(options.repeatWindowMs ?? 1_500);
  }

  /** Allows a reviewed local transport to be attached after activation. */
  attachBridge(bridge: ExtensionCompanionBridge): void {
    this.bridge = bridge;
    this.scheduleReconnect(0);
  }

  stop(): void {
    this.stopReconnect();
    if (this.sessionHeartbeatTimer) clearTimeout(this.sessionHeartbeatTimer);
    this.sessionHeartbeatTimer = undefined;
    this.sessionHeartbeatInFlight = false;
    if (this.hardwareSignalTimer) clearTimeout(this.hardwareSignalTimer);
    this.hardwareSignalTimer = undefined;
    this.hardwareSignalInFlight = false;
    this.started = false;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.registerCommands();
    this.context.subscriptions.push(
      this.vscode.window.onDidOpenTerminal((terminal) => { void this.registerTerminal(terminal); }),
      this.vscode.window.onDidCloseTerminal((terminal) => { this.closedTerminals.add(terminal); void this.markTerminalClosed(terminal); }),
      this.vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.refreshWorkspaceRegistration(); }),
      this.vscode.debug.onDidStartDebugSession((session) => { void this.registerDebugSession(session); }),
      this.vscode.debug.onDidTerminateDebugSession((session) => { void this.markDebugSessionEnded(session); }),
      this.vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) this.scheduleHardwareSignalPoll(0);
        else if (this.hardwareSignalTimer) { clearTimeout(this.hardwareSignalTimer); this.hardwareSignalTimer = undefined; }
      })
    );

    await this.refreshWorkspaceRegistration();
    for (const terminal of this.vscode.window.terminals) await this.registerTerminal(terminal);
    await this.registerDebugConfigurations();
    await this.refreshSessionNotifications();
    this.scheduleSessionHeartbeat();
    this.scheduleHardwareSignalPoll(0);
  }

  /** Test and operator-visible snapshot; it never claims mediation on its own. */
  listKnownSessions(): readonly ExtensionManagedSession[] {
    return [...this.sessions.values()].map((session) => ({
      ...session,
      capabilities: [...session.capabilities],
      plannedFiles: [...session.plannedFiles],
      metadata: { ...session.metadata }
    }));
  }

  private registerCommands(): void {
    this.context.subscriptions.push(
      this.vscode.commands.registerCommand("sxsy-b122.registerManagedSession", async () => {
        await this.refreshWorkspaceRegistration();
        await this.vscode.window.showInformationMessage("SXSY-B122 refreshed this VS Code window's Registered session record. Registered is not Mediated.");
      }),
      this.vscode.commands.registerCommand("sxsy-b122.adoptTerminal", async (argument: unknown) => {
        await this.adoptTerminal(argument);
      }),
      this.vscode.commands.registerCommand("sxsy-b122.refreshManagedRegistry", async () => {
        await this.refreshWorkspaceRegistration();
        for (const terminal of this.vscode.window.terminals) await this.registerTerminal(terminal);
        await this.registerDebugConfigurations();
      }),
      this.vscode.commands.registerCommand("sxsy-b122.showManagedSessions", async () => {
        const summary = this.listKnownSessions().map((session) => `${session.provider}/${session.surface}: ${session.status}`).join("; ") || "No VS Code sessions registered.";
        await this.vscode.window.showInformationMessage(`SXSY-B122 session registry: ${summary}`);
      }),
      this.vscode.commands.registerCommand("sxsy-b122.showQuickReference", async () => {
        await this.showQuickReference();
      }),
      this.vscode.commands.registerCommand("sxsy-b122.connectProviderAdapter", async () => {
        await this.connectProviderAdapter();
      }),
      this.vscode.commands.registerCommand("sxsy-b122.installRepositoryRuntime", async () => {
        await this.installRepositoryRuntime();
      }),
      this.vscode.commands.registerCommand("sxsy-b122.listRepositoryRuntimes", async () => {
        await this.listRepositoryRuntimes();
      }),
      this.vscode.commands.registerCommand("sxsy-b122.revokeRepositoryRuntime", async () => {
        await this.revokeRepositoryRuntime();
      }),
      this.vscode.commands.registerCommand("sxsy-b122.installWindowsSandbox", async () => {
        await this.installWindowsSandbox();
      }),
      this.vscode.commands.registerCommand("sxsy-b122.listWindowsSandboxes", async () => {
        await this.listWindowsSandboxes();
      }),
      this.vscode.commands.registerCommand("sxsy-b122.revokeWindowsSandbox", async () => {
        await this.revokeWindowsSandbox();
      }),
      this.vscode.commands.registerCommand("sxsy-b122.provisionCredential", async () => { await this.provisionCredential(); }),
      this.vscode.commands.registerCommand("sxsy-b122.listCredentials", async () => { await this.listCredentials(); }),
      this.vscode.commands.registerCommand("sxsy-b122.revokeCredential", async () => { await this.revokeCredential(); }),
      this.vscode.commands.registerCommand("sxsy-b122.installNetworkPolicy", async () => { await this.installNetworkPolicy(); }),
      this.vscode.commands.registerCommand("sxsy-b122.showNetworkPolicy", async () => { await this.showNetworkPolicy(); }),
      this.vscode.commands.registerCommand("sxsy-b122.revokeNetworkPolicy", async () => { await this.revokeNetworkPolicy(); }),
      this.vscode.commands.registerCommand("sxsy-b122.manageAcceptanceEvidence", async () => { await this.manageAcceptanceEvidence(); }),
      this.vscode.commands.registerCommand("sxsy-b122.manageScannerFixtures", async () => { await this.manageScannerFixtures(); }),
      this.vscode.commands.registerCommand("sxsy-b122.manageProviderApplications", async () => { await this.manageProviderApplications(); }),
      this.vscode.commands.registerCommand("sxsy-b122.releaseContainment", async () => { await this.releaseContainment(); }),
      this.vscode.commands.registerCommand("sxsy-b122.installRawHid", async () => { await this.installRawHid(); }),
      this.vscode.commands.registerCommand("sxsy-b122.listRawHid", async () => { await this.listRawHid(); }),
      this.vscode.commands.registerCommand("sxsy-b122.showRawHidStatus", async () => { await this.showRawHidStatus(); }),
      this.vscode.commands.registerCommand("sxsy-b122.revokeRawHid", async () => { await this.revokeRawHid(); }),
      this.vscode.commands.registerCommand("sxsy-b122.dispatch", async (argument: unknown) => {
        const command = parseChordArgument(argument);
        if (!command) {
          await this.vscode.window.showWarningMessage("SXSY-B122 cannot route that command because its control or modifier is not a settled assignment.");
          return;
        }
        await this.dispatchChord(command, parseInputArgument(argument));
      }),
      // Retained for compatibility with the baseline command. It cannot turn
      // arbitrary UI text into a companion action.
      this.vscode.commands.registerCommand("sxsy-b122.showIntent", async (intent: unknown) => {
        const detail = typeof intent === "string" ? intent : "No canonical B122 intent was supplied.";
        await this.vscode.window.showWarningMessage(`SXSY-B122 preview: ${detail}`);
      })
    );

    for (const command of chordCommands) {
      this.context.subscriptions.push(this.vscode.commands.registerCommand(command.command, async (argument: unknown) => {
        await this.dispatchChord(command, parseInputArgument(argument));
      }));
    }
  }

  /**
   * Refreshes the protected registry and emits only status-transition
   * notifications. The heartbeat loop calls this in the background; keeping a
   * public deterministic seam lets the installed command surface and tests
   * refresh it without inventing terminal-derived state.
   */
  async refreshSessionNotifications(): Promise<void> {
    const listed = await this.bridge.listSessions();
    if (!listed.ok) return;
    const currentIds = new Set(listed.value.map((session) => session.id));
    for (const session of listed.value) {
      const prior = this.observedNotificationStatus.get(session.id);
      this.sessions.set(session.id, session);
      this.observedNotificationStatus.set(session.id, session.status);
      if (prior === session.status) continue;
      if (session.status === "verified_blocked") {
        await this.vscode.window.showWarningMessage(`SXSY-B122: ${session.provider} session ${session.id} is Blocked and ready in the verified blocker queue.`);
      } else if (session.status === "verified_finished") {
        await this.vscode.window.showInformationMessage(`SXSY-B122: ${session.provider} session ${session.id} is Finished and ready in the verified done queue.`);
      }
    }
    for (const sessionId of this.observedNotificationStatus.keys()) if (!currentIds.has(sessionId)) this.observedNotificationStatus.delete(sessionId);
  }

  private async showQuickReference(): Promise<void> {
    const items = chordCommands.map((command) => ({
      label: `${controlLabel(command.control)} · ${modifierLabel(command.modifier)} — ${command.title.replace("SXSY-B122: ", "")}`,
      description: "Read-only settled assignment; this overlay never dispatches the command."
    }));
    await this.vscode.window.showQuickPick(items, { placeHolder: `Search the read-only SXSY-B122 quick reference (${items.length} settled chords)` });
  }

  private async manageAcceptanceEvidence(): Promise<void> {
    const operation = await this.vscode.window.showQuickPick([
      "Install acceptance authority", "Show acceptance authorities", "Revoke acceptance authority",
      "Import signed acceptance evidence", "Show acceptance evidence", "Invalidate acceptance evidence",
      "Activate high-consequence action", "Show high-consequence activations", "Revoke high-consequence activation"
    ] as const, { placeHolder: "Manage independently signed B122 acceptance evidence" });
    if (!operation) return;
    try {
      if (operation === "Install acceptance authority" || operation === "Import signed acceptance evidence") {
        const sourcePath = await this.pickReviewedJson(operation);
        if (!sourcePath) return;
        if (operation === "Install acceptance authority") {
          const result = await this.bridge.installAcceptanceTrust(sourcePath);
          if (!result.ok) throw new Error(result.message);
          await this.vscode.window.showInformationMessage(`Installed acceptance authority ${result.value.authorityId}.`);
        } else {
          const result = await this.bridge.importAcceptanceEvidence(sourcePath);
          if (!result.ok) throw new Error(result.message);
          await this.vscode.window.showInformationMessage(`Imported signed evidence ${result.value.id} for gate ${result.value.gate}.`);
        }
        return;
      }
      if (operation === "Show acceptance authorities") {
        const result = await this.bridge.listAcceptanceTrust(); if (!result.ok) throw new Error(result.message);
        await this.vscode.window.showInformationMessage(`Acceptance authorities: ${result.value.length ? result.value.map((item) => `${item.authorityId} ${item.status}`).join("; ") : "none installed"}.`); return;
      }
      if (operation === "Revoke acceptance authority") {
        const listed = await this.bridge.listAcceptanceTrust(); if (!listed.ok) throw new Error(listed.message);
        const active = listed.value.filter((item) => item.status === "active"); const selected = await this.pickRecord(active, (item) => item.authorityId, (item) => item.keyId.slice(0, 16), "Choose the exact authority to revoke"); if (!selected) return;
        const reason = await this.adminReason("Why must this acceptance authority be revoked?"); if (!reason) return;
        const result = await this.bridge.revokeAcceptanceTrust(selected.authorityId, selected.keyId, reason); if (!result.ok) throw new Error(result.message);
        await this.vscode.window.showInformationMessage(`Revoked acceptance authority ${selected.authorityId}.`); return;
      }
      if (operation === "Show acceptance evidence") {
        const result = await this.bridge.listAcceptanceEvidence(); if (!result.ok) throw new Error(result.message);
        await this.vscode.window.showInformationMessage(`Acceptance evidence: ${result.value.length ? result.value.map((item) => `${item.id} gate ${item.gate} ${item.invalidatedAt ? "invalidated" : item.status}`).join("; ") : "none imported"}.`); return;
      }
      if (operation === "Invalidate acceptance evidence") {
        const listed = await this.bridge.listAcceptanceEvidence(); if (!listed.ok) throw new Error(listed.message);
        const selected = await this.pickRecord(listed.value.filter((item) => !item.invalidatedAt), (item) => item.id, (item) => `gate ${item.gate} ${item.status}`, "Choose the exact evidence record to invalidate"); if (!selected) return;
        const reason = await this.adminReason("Why must this acceptance evidence be invalidated?"); if (!reason) return;
        const result = await this.bridge.invalidateAcceptanceEvidence(selected.id, reason); if (!result.ok) throw new Error(result.message);
        await this.vscode.window.showInformationMessage(`Invalidated acceptance evidence ${selected.id}.`); return;
      }
      if (operation === "Activate high-consequence action") {
        const action = await this.vscode.window.showQuickPick(highConsequenceActions, { placeHolder: "Choose one exact high-consequence action" }); if (!action) return;
        const session = await this.showSessionQueue("all", "Choose the exact target for this bounded activation", (item) => !!item.targetSnapshotId); if (!session?.targetSnapshotId) return;
        const duration = await this.vscode.window.showQuickPick(["10 minutes", "30 minutes", "1 hour"] as const, { placeHolder: "Choose a short activation lifetime" }); if (!duration) return;
        const milliseconds = duration === "10 minutes" ? 600_000 : duration === "30 minutes" ? 1_800_000 : 3_600_000;
        const result = await this.bridge.activateHighConsequence(action, session.targetSnapshotId, new Date(Date.parse(this.now()) + milliseconds).toISOString()); if (!result.ok) throw new Error(result.message);
        await this.vscode.window.showInformationMessage(`Activated ${action} only for target ${session.targetSnapshotId.slice(0, 12)}… until ${result.value.expiresAt}.`); return;
      }
      if (operation === "Show high-consequence activations") {
        const result = await this.bridge.listHighConsequenceActivations(); if (!result.ok) throw new Error(result.message);
        await this.vscode.window.showInformationMessage(`High-consequence activations: ${result.value.length ? result.value.map((item) => `${item.action} ${item.status} until ${item.expiresAt}`).join("; ") : "none"}.`); return;
      }
      const listed = await this.bridge.listHighConsequenceActivations(); if (!listed.ok) throw new Error(listed.message);
      const selected = await this.pickRecord(listed.value.filter((item) => item.status === "active"), (item) => item.action, (item) => item.id, "Choose the exact activation to revoke"); if (!selected) return;
      const reason = await this.adminReason("Why must this activation be revoked?"); if (!reason) return;
      const result = await this.bridge.revokeHighConsequenceActivation(selected.id, reason); if (!result.ok) throw new Error(result.message);
      await this.vscode.window.showInformationMessage(`Revoked high-consequence activation ${selected.id}.`);
    } catch (error) { await this.vscode.window.showWarningMessage(`SXSY-B122 acceptance administration stopped: ${error instanceof Error ? error.message : "trusted host administration unavailable"}`); }
  }

  private async manageScannerFixtures(): Promise<void> {
    const operation = await this.vscode.window.showQuickPick(["Install scanner authority", "Show scanner authorities", "Revoke scanner authority", "Install signed scanner/advisory fixture", "Show scanner/advisory fixtures", "Revoke scanner/advisory fixture"] as const, { placeHolder: "Manage signed scanner and advisory fixtures" });
    if (!operation) return;
    try {
      if (operation === "Install scanner authority" || operation === "Install signed scanner/advisory fixture") {
        const sourcePath = await this.pickReviewedJson(operation); if (!sourcePath) return;
        if (operation === "Install scanner authority") {
          const result = await this.bridge.installScannerTrust(sourcePath);
          if (!result.ok) throw new Error(result.message);
          await this.vscode.window.showInformationMessage(`Installed scanner authority ${result.value.authorityId}.`);
        } else {
          const result = await this.bridge.installScannerFixture(sourcePath);
          if (!result.ok) throw new Error(result.message);
          await this.vscode.window.showInformationMessage(`Installed signed ${result.value.kind} fixture ${result.value.id}.`);
        }
        return;
      }
      if (operation === "Show scanner authorities") {
        const result = await this.bridge.listScannerTrust(); if (!result.ok) throw new Error(result.message);
        await this.vscode.window.showInformationMessage(`Scanner authorities: ${result.value.length ? result.value.map((item) => `${item.authorityId} ${item.status}`).join("; ") : "none installed"}.`); return;
      }
      if (operation === "Revoke scanner authority") {
        const listed = await this.bridge.listScannerTrust(); if (!listed.ok) throw new Error(listed.message);
        const selected = await this.pickRecord(listed.value.filter((item) => item.status === "active"), (item) => item.authorityId, (item) => item.keyId.slice(0, 16), "Choose the exact scanner authority to revoke"); if (!selected) return;
        const reason = await this.adminReason("Why must this scanner authority be revoked?"); if (!reason) return;
        const result = await this.bridge.revokeScannerTrust(selected.authorityId, selected.keyId, reason); if (!result.ok) throw new Error(result.message);
        await this.vscode.window.showInformationMessage(`Revoked scanner authority ${selected.authorityId}.`); return;
      }
      if (operation === "Show scanner/advisory fixtures") {
        const result = await this.bridge.listScannerFixtures(); if (!result.ok) throw new Error(result.message);
        await this.vscode.window.showInformationMessage(`Signed fixtures: ${result.value.length ? result.value.map((item) => `${item.id} ${item.kind} ${item.status}`).join("; ") : "none installed"}.`); return;
      }
      const listed = await this.bridge.listScannerFixtures(); if (!listed.ok) throw new Error(listed.message);
      const selected = await this.pickRecord(listed.value.filter((item) => item.status === "active"), (item) => item.id, (item) => item.kind, "Choose the exact signed fixture to revoke"); if (!selected) return;
      const reason = await this.adminReason("Why must this signed fixture be revoked?"); if (!reason) return;
      const result = await this.bridge.revokeScannerFixture(selected.id, reason); if (!result.ok) throw new Error(result.message);
      await this.vscode.window.showInformationMessage(`Revoked signed fixture ${selected.id}.`);
    } catch (error) { await this.vscode.window.showWarningMessage(`SXSY-B122 scanner administration stopped: ${error instanceof Error ? error.message : "trusted host administration unavailable"}`); }
  }

  private async manageProviderApplications(): Promise<void> {
    const operation = await this.vscode.window.showQuickPick(["Install provider application", "Show provider applications", "Revoke provider application"] as const, { placeHolder: "Manage fixed-path provider executables" });
    if (!operation) return;
    try {
      const listed = await this.bridge.listProviderDesktops();
      if (!listed.ok) throw new Error(listed.message);
      if (operation === "Show provider applications") {
        await this.vscode.window.showInformationMessage(`Provider applications: ${listed.value.length ? listed.value.map((item) => `${providerLabel(item.provider)} ${item.status} ${item.identity.executableSha256.slice(0, 12)}…`).join("; ") : "none installed"}.`);
        return;
      }
      const candidates = operation === "Install provider application"
        ? providerDesktopIds.filter((provider) => !listed.value.some((item) => item.provider === provider && item.status === "active"))
        : listed.value.filter((item) => item.status === "active").map((item) => item.provider);
      const selectedLabel = await this.vscode.window.showQuickPick(candidates.map(providerLabel), { placeHolder: operation === "Install provider application" ? "Choose one bootstrap-fixed executable to attest" : "Choose one exact installed provider to revoke" });
      const provider = selectedLabel ? candidates.find((candidate) => providerLabel(candidate) === selectedLabel) : undefined;
      if (!provider) return;
      const result = operation === "Install provider application" ? await this.bridge.installProviderDesktop(provider) : await this.bridge.revokeProviderDesktop(provider);
      if (!result.ok) throw new Error(result.message);
      await this.vscode.window.showInformationMessage(`${operation === "Install provider application" ? "Installed" : "Revoked"} ${providerLabel(provider)} at its fixed host path.`);
    } catch (error) { await this.vscode.window.showWarningMessage(`SXSY-B122 provider administration stopped: ${error instanceof Error ? error.message : "trusted provider registry unavailable"}`); }
  }

  private async pickReviewedJson(openLabel: string): Promise<string | undefined> { const selected = await this.vscode.window.showOpenDialog?.({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel, filters: { "Signed JSON document": ["json"] } }); return selected?.length === 1 ? selected[0]?.fsPath : undefined; }
  private adminReason(prompt: string): Promise<string | undefined> { return Promise.resolve(this.vscode.window.showInputBox?.({ prompt, validateInput: (value) => value.trim() && value.length <= 2_048 && !/\0/.test(value) ? undefined : "Enter a bounded non-empty reason." })); }
  private async pickRecord<T>(values: readonly T[], label: (value: T) => string, description: (value: T) => string, placeHolder: string): Promise<T | undefined> { if (!values.length) { await this.vscode.window.showInformationMessage("No matching active records are available."); return undefined; } const items = values.map((value) => ({ label: label(value), description: description(value) })); const selected = await this.vscode.window.showQuickPick(items, { placeHolder }); return selected ? values[items.indexOf(selected)] : undefined; }

  private async installRepositoryRuntime(): Promise<void> {
    const root = await this.chooseGitRoot("Choose the exact Git root for this verified runtime manifest");
    if (!root) return;
    const selected = await this.vscode.window.showOpenDialog?.({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Review Runtime Manifest",
      filters: { "SXSY-B122 runtime manifest": ["json"] }
    });
    const manifestPath = selected?.length === 1 ? selected[0]?.fsPath : undefined;
    if (!manifestPath) {
      await this.vscode.window.showWarningMessage("SXSY-B122 runtime installation was cancelled; no manifest was pinned.");
      return;
    }
    const result = await this.bridge.installRuntimePin(root.gitRoot, manifestPath);
    if (!result.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 runtime was not installed: ${result.message}`);
      return;
    }
    await this.vscode.window.showInformationMessage(`SXSY-B122 installed the current-user-attested runtime digest ${result.value.expectedSha256.slice(0, 12)}… for the selected Git root.`);
  }

  private async connectProviderAdapter(): Promise<void> {
    if (!this.sessions.size) await this.refreshWorkspaceRegistration();
    const candidates = [...this.sessions.values()].filter((session) => session.capabilities.includes("registered") && session.status !== "unreachable" && session.status !== "stale");
    if (!candidates.length) { await this.vscode.window.showWarningMessage("SXSY-B122 has no current Registered session available for a provider handshake."); return; }
    const items = candidates.map((session) => ({ label: `${session.provider}: ${session.id}`, description: session.workspaceRoot ?? session.surface }));
    const picked = await this.vscode.window.showQuickPick(items, { placeHolder: "Choose the exact Registered session to connect through its configured provider route" });
    const session = picked ? candidates[items.indexOf(picked)] : undefined;
    if (!session) return;
    let root = session.workspaceRoot ? this.gitRoots.find((candidate) => normalizePath(candidate.gitRoot) === normalizePath(session.workspaceRoot!)) : undefined;
    root ??= await this.chooseGitRoot("Choose the exact Git target for this provider handshake");
    if (!root) return;
    const result = await this.bridge.providerHandshake(session.id, root.gitRoot);
    if (!result.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 provider handshake was not installed: ${result.message}`); return; }
    this.sessions.set(result.value.id, result.value);
    await this.vscode.window.showInformationMessage(`SXSY-B122 connected ${result.value.provider} with adapter-proven ${result.value.capabilities.join(", ")} capabilities for the exact selected target.`);
  }

  private async listRepositoryRuntimes(): Promise<void> {
    const result = await this.bridge.listRuntimePins();
    if (!result.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 runtime registry unavailable: ${result.message}`);
      return;
    }
    const active = result.value.filter((pin) => pin.status === "active");
    const summary = active.length
      ? active.map((pin) => `${pin.canonicalRepositoryRoot} (${pin.expectedSha256.slice(0, 12)}…)`).join("; ")
      : "No active repository runtime manifests are installed.";
    await this.vscode.window.showInformationMessage(`SXSY-B122 runtime registry: ${summary}`);
  }

  private async revokeRepositoryRuntime(): Promise<void> {
    const result = await this.bridge.listRuntimePins();
    if (!result.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 runtime registry unavailable: ${result.message}`);
      return;
    }
    const active = result.value.filter((pin) => pin.status === "active");
    if (!active.length) {
      await this.vscode.window.showInformationMessage("SXSY-B122 has no active repository runtime manifest to revoke.");
      return;
    }
    const items = active.map((pin) => ({ label: pin.canonicalRepositoryRoot, description: pin.expectedSha256.slice(0, 16) }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder: "Choose the exact repository runtime pin to revoke" });
    const pin = selected ? active[items.indexOf(selected)] : undefined;
    if (!pin) return;
    const revoked = await this.bridge.revokeRuntimePin(pin.canonicalRepositoryRoot);
    if (!revoked.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 runtime pin was not revoked: ${revoked.message}`);
      return;
    }
    await this.vscode.window.showInformationMessage("SXSY-B122 revoked the selected current-user-attested repository runtime pin.");
  }

  private async chooseGitRoot(placeHolder: string): Promise<GitRootRegistration | undefined> {
    if (!this.gitRoots.length) await this.refreshWorkspaceRegistration();
    if (this.gitRoots.length === 1) return this.gitRoots[0];
    if (!this.gitRoots.length) {
      await this.vscode.window.showWarningMessage("SXSY-B122 found no structured Git root in this VS Code window.");
      return undefined;
    }
    const items = this.gitRoots.map((root) => ({ label: root.gitRoot, description: root.branch ?? "unknown branch" }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder });
    return selected ? this.gitRoots[items.indexOf(selected)] : undefined;
  }

  private async installWindowsSandbox(): Promise<void> {
    const root = await this.chooseGitRoot("Choose the exact Git root for this Windows Sandbox recipe catalog");
    if (!root) return;
    const selected = await this.vscode.window.showOpenDialog?.({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: "Review Sandbox Catalog", filters: { "SXSY-B122 sandbox catalog": ["json"] } });
    const catalogPath = selected?.length === 1 ? selected[0]?.fsPath : undefined;
    if (!catalogPath) {
      await this.vscode.window.showWarningMessage("SXSY-B122 Windows Sandbox installation was cancelled; no catalog or helper was pinned.");
      return;
    }
    const result = await this.bridge.installSandbox(root.gitRoot, catalogPath);
    if (!result.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 Windows Sandbox was not installed: ${result.message}`);
      return;
    }
    await this.vscode.window.showInformationMessage(`SXSY-B122 installed the attested Windows Sandbox catalog ${result.value.catalogSha256.slice(0, 12)}… and packaged helper ${result.value.helperSha256.slice(0, 12)}….`);
  }

  private async listWindowsSandboxes(): Promise<void> {
    const result = await this.bridge.listSandboxes();
    if (!result.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 Windows Sandbox registry unavailable: ${result.message}`);
      return;
    }
    const active = result.value.filter((pin) => pin.status === "active");
    await this.vscode.window.showInformationMessage(`SXSY-B122 Windows Sandbox registry: ${active.length ? active.map((pin) => pin.canonicalRepositoryRoot).join("; ") : "No active OS-enforced sandbox installations."}`);
  }

  private async revokeWindowsSandbox(): Promise<void> {
    const result = await this.bridge.listSandboxes();
    if (!result.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 Windows Sandbox registry unavailable: ${result.message}`);
      return;
    }
    const active = result.value.filter((pin) => pin.status === "active");
    if (!active.length) {
      await this.vscode.window.showInformationMessage("SXSY-B122 has no active Windows Sandbox installation to revoke.");
      return;
    }
    const items = active.map((pin) => ({ label: pin.canonicalRepositoryRoot, description: pin.catalogSha256.slice(0, 16) }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder: "Choose the exact Windows Sandbox installation to revoke" });
    const pin = selected ? active[items.indexOf(selected)] : undefined;
    if (!pin) return;
    const revoked = await this.bridge.revokeSandbox(pin.canonicalRepositoryRoot);
    if (!revoked.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 Windows Sandbox was not revoked: ${revoked.message}`);
    else await this.vscode.window.showInformationMessage("SXSY-B122 revoked the selected Windows Sandbox installation.");
  }

  private async provisionCredential(): Promise<void> {
    const root = await this.chooseGitRoot("Choose the exact Git root for this credential reference");
    const input = this.vscode.window.showInputBox;
    if (!root || !input || !this.sealSecret) { if (root) await this.vscode.window.showWarningMessage("SXSY-B122 credential provisioning requires the installed Windows DPAPI host."); return; }
    const reference = await input({ prompt: "Credential reference name", value: "github-token", validateInput: (value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? undefined : "Use a bounded reference name." });
    const scopesText = reference ? await input({
      prompt: `Exact adapter/purpose scopes for ${root.gitRoot} (comma-separated)`,
      value: "configured-network/provider-api",
      validateInput: (value) => parseCredentialScopePairs(value, root.gitRoot) ? undefined : "Enter 1-16 unique adapterId/purpose pairs."
    }) : undefined;
    const scopes = scopesText ? parseCredentialScopePairs(scopesText, root.gitRoot) : undefined;
    const secretText = scopes ? await input({ prompt: "Credential value (sealed with Windows DPAPI before local transport)", password: true, validateInput: (value) => value.length > 0 && Buffer.byteLength(value, "utf8") <= 64 * 1024 ? undefined : "Enter a non-empty value up to 64 KiB." }) : undefined;
    if (!reference || !scopes || !secretText) return;
    const bytes = Buffer.from(secretText, "utf8");
    let sealedSecret: string;
    try { sealedSecret = await this.sealSecret(bytes); } catch { await this.vscode.window.showWarningMessage("SXSY-B122 could not seal the credential with Windows DPAPI; nothing was sent."); return; } finally { bytes.fill(0); }
    const existing = await this.bridge.listCredentials();
    const replaceExisting = existing.ok && existing.value.some((item) => item.reference === reference && !item.revokedAt);
    const result = await this.bridge.provisionCredential({ reference, scopes, sealedSecret, ...(replaceExisting ? { replaceExisting: true } : {}) });
    if (!result.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 credential was not provisioned: ${result.message}`);
    else await this.vscode.window.showInformationMessage(`SXSY-B122 provisioned DPAPI-sealed reference ${result.value.reference} generation ${result.value.generation} for exact scopes ${result.value.scopes.map((scope) => `${scope.repositoryRoot}=>${scope.adapterId}/${scope.purpose}`).join("; ")}.`);
  }

  private async listCredentials(): Promise<void> {
    const result = await this.bridge.listCredentials();
    if (!result.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 credential registry unavailable: ${result.message}`); return; }
    await this.vscode.window.showInformationMessage(`SXSY-B122 credential registry: ${result.value.length ? result.value.map((item) => `${item.reference} g${item.generation}${item.revokedAt ? " revoked" : ""}`).join("; ") : "No credential references."}`);
  }

  private async revokeCredential(): Promise<void> {
    const listed = await this.bridge.listCredentials();
    if (!listed.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 credential registry unavailable: ${listed.message}`); return; }
    const active = listed.value.filter((item) => !item.revokedAt);
    const selected = await this.vscode.window.showQuickPick(active.map((item) => item.reference), { placeHolder: "Choose the credential reference to revoke" });
    if (!selected) return;
    const result = await this.bridge.revokeCredential(selected, "Revoked from the installed VS Code credential registry.");
    if (!result.ok || !result.value) await this.vscode.window.showWarningMessage(`SXSY-B122 credential was not revoked: ${result.ok ? "reference not found" : result.message}`);
    else await this.vscode.window.showInformationMessage("SXSY-B122 revoked the selected credential reference and its outstanding leases.");
  }

  private async installNetworkPolicy(): Promise<void> {
    const selected = await this.vscode.window.showOpenDialog?.({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: "Review HTTPS Route Policy", filters: { "SXSY-B122 network policy": ["json"] } });
    const sourcePath = selected?.length === 1 ? selected[0]?.fsPath : undefined;
    if (!sourcePath) return;
    const result = await this.bridge.installNetworkPolicy(sourcePath);
    if (!result.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 network policy was not installed: ${result.message}`);
    else await this.vscode.window.showInformationMessage(`SXSY-B122 installed the attested exact-route HTTPS policy ${result.value.sha256.slice(0, 12)}….`);
  }

  private async showNetworkPolicy(): Promise<void> { const result = await this.bridge.currentNetworkPolicy(); if (!result.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 network policy registry unavailable: ${result.message}`); else await this.vscode.window.showInformationMessage(`SXSY-B122 network policy: ${result.value?.status === "active" ? `active ${result.value.sha256.slice(0, 12)}…` : "no active policy"}`); }
  private async revokeNetworkPolicy(): Promise<void> { const result = await this.bridge.revokeNetworkPolicy(); if (!result.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 network policy was not revoked: ${result.message}`); else await this.vscode.window.showInformationMessage("SXSY-B122 revoked the active exact-route HTTPS policy."); }

  private async installRawHid(): Promise<void> {
    const input = this.vscode.window.showInputBox;
    if (!input) { await this.vscode.window.showWarningMessage("SXSY-B122 Raw-HID provisioning requires the installed VS Code input boundary."); return; }
    const labels = ["USB vendor ID", "USB product ID", "HID usage page", "HID usage"] as const;
    const values: number[] = [];
    for (const label of labels) {
      const text = await input({ prompt: `Enter the exact ${label} (decimal or 0x-prefixed hexadecimal)`, validateInput: validateUint16Text });
      if (text === undefined) return;
      const parsed = parseUint16Text(text);
      if (parsed === undefined) return;
      values.push(parsed);
    }
    const serialNumber = await input({ prompt: "Enter the exact device serial number, or leave empty only for an otherwise unambiguous tuple", validateInput: (value) => !value || /^[A-Za-z0-9._-]{1,128}$/.test(value) ? undefined : "Use 1-128 letters, digits, dot, underscore, or hyphen." });
    if (serialNumber === undefined) return;
    const identity = { vendorId: values[0]!, productId: values[1]!, usagePage: values[2]!, usage: values[3]!, ...(serialNumber ? { serialNumber } : {}) };
    const result = await this.bridge.installRawHid(identity);
    if (!result.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 Raw-HID was not installed: ${result.message}`); return; }
    await this.vscode.window.showInformationMessage(`SXSY-B122 installed exact Raw-HID tuple ${formatUint16(identity.vendorId)}:${formatUint16(identity.productId)} ${formatUint16(identity.usagePage)}:${formatUint16(identity.usage)} with fixed helper ${result.value.installation.helperSha256.slice(0, 12)}….`);
  }

  private async listRawHid(): Promise<void> {
    const result = await this.bridge.listRawHid();
    if (!result.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 Raw-HID registry unavailable: ${result.message}`); return; }
    await this.vscode.window.showInformationMessage(`SXSY-B122 Raw-HID registry: ${result.value.length ? result.value.map((pin) => `${formatUint16(pin.identity.vendorId)}:${formatUint16(pin.identity.productId)} ${pin.status}`).join("; ") : "No installation."}`);
  }

  private async showRawHidStatus(): Promise<void> {
    const result = await this.bridge.rawHidStatus();
    if (!result.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 Raw-HID status unavailable: ${result.message}`); return; }
    await this.vscode.window.showInformationMessage(`SXSY-B122 Raw-HID ${result.value.supervisor.state}; pending ${result.value.inbox.pending}, reconciliation ${result.value.inbox.needsReconciliation}.`);
  }

  private async revokeRawHid(): Promise<void> {
    const result = await this.bridge.revokeRawHid();
    if (!result.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 Raw-HID was not revoked: ${result.message}`); return; }
    await this.vscode.window.showInformationMessage("SXSY-B122 revoked the active Raw-HID pin and stopped its helper generation.");
  }

  private async releaseContainment(): Promise<void> {
    let session: ExtensionManagedSession | undefined;
    try { session = await this.showSessionQueue("all", "Choose the exact contained repository session"); }
    catch (error) { await this.vscode.window.showWarningMessage(`SXSY-B122 containment release stopped: ${error instanceof Error ? error.message : "session selection unavailable"}`); return; }
    if (!session?.workspaceRoot) { await this.vscode.window.showWarningMessage("SXSY-B122 containment release requires an exact repository-bound managed session."); return; }
    const reason = await this.vscode.window.showInputBox?.({ prompt: "Record the incident review and why containment may be released", validateInput: (value) => value.trim() && value.length <= 2_048 && !/\0/.test(value) ? undefined : "Enter a bounded non-empty incident-review reason." });
    if (!reason) return;
    const rotation = await this.vscode.window.showQuickPick(["Credential rotation complete", "Credential rotation not required"] as const, { placeHolder: "Confirm credential-rotation disposition before Windows reauthentication" });
    if (!rotation) return;
    const result = await this.bridge.releaseContainment({ sessionId: session.id, reason, incidentStatus: rotation === "Credential rotation complete" ? "rotation_complete" : "not_required" });
    if (!result.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 containment release unavailable: ${result.message}`); return; }
    const show = result.value.status === "completed" ? this.vscode.window.showInformationMessage.bind(this.vscode.window) : this.vscode.window.showWarningMessage.bind(this.vscode.window);
    await show(`SXSY-B122 containment release ${result.value.status}: ${result.value.summary}`);
  }

  private async refreshWorkspaceRegistration(): Promise<void> {
    this.gitRoots = await this.resolveGitRoots();
    const stored = this.context.workspaceState.get<StoredWindowState>(windowStateKey);
    const sessionId = this.windowSessionId ?? stored?.id ?? this.idFactory();
    this.windowSessionId = sessionId;
    const session = this.makeSession(sessionId, "generic", "vscode_window", "unknown", {
      "sxsy-b122.kind": "window",
      "sxsy-b122.workspaceRoots": JSON.stringify(this.workspaceRoots()),
      "sxsy-b122.gitRootCount": String(this.gitRoots.length),
      "sxsy-b122.gitRoots": this.gitRoots.length ? "registered separately" : "unavailable"
    });
    const result = await this.bridge.registerSession(session);
    const registered = result.ok ? result.value : session;
    this.sessions.set(sessionId, registered);
    await this.context.workspaceState.update(windowStateKey, {
      id: sessionId,
      lifecycle: result.ok ? "registered" : "pending_companion",
      workspaceRoots: this.workspaceRoots(),
      updatedAt: this.now()
    } satisfies StoredWindowState);
    if (result.ok) this.stopReconnect(); else this.scheduleReconnect();
    await this.registerGitRootSessions();
  }

  private scheduleReconnect(delayMs = 1_000): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.bridge.health().then((health) => health.ok ? this.refreshWorkspaceRegistration() : undefined).catch(() => undefined).finally(() => {
        if (!this.reconnectTimer) this.scheduleReconnect();
      });
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private async registerGitRootSessions(): Promise<void> {
    const windowId = this.windowSessionId;
    if (!windowId) return;
    for (const [index, root] of this.gitRoots.entries()) {
      const id = `${windowId}:git-root:${index}`;
      const session = this.makeSession(id, "generic", "vscode_window", "unknown", {
        "sxsy-b122.kind": "git-root",
        "sxsy-b122.gitRoot": root.gitRoot,
        "sxsy-b122.branch": root.branch ?? "unknown",
        "sxsy-b122.worktree": root.worktree ?? root.gitRoot,
        "sxsy-b122.canonicalRemote": root.canonicalRemote ?? "unknown"
      }, root.gitRoot);
      const result = await this.bridge.registerSession(session);
      this.sessions.set(id, result.ok ? result.value : session);
    }
  }

  private async registerTerminal(terminal: TerminalLike): Promise<TrackedTerminal> {
    const known = this.terminalRecords.get(terminal);
    if (known) return known;
    const sessionId = this.idFactory();
    const adoptionKey = `terminal:${sessionId}`;
    const session = this.makeSession(sessionId, "generic", "vscode_terminal", "unknown", {
      "sxsy-b122.kind": "terminal",
      "sxsy-b122.terminalName": terminal.name,
      "sxsy-b122.adoptionKey": adoptionKey
    });
    const result = await this.bridge.registerSession(session, "terminal");
    const record: TrackedTerminal = {
      sessionId,
      adoptionKey,
      adopted: false,
      session: result.ok ? result.value : session
    };
    this.terminalRecords.set(terminal, record);
    this.terminalBySessionId.set(sessionId, record);
    this.sessions.set(sessionId, record.session);
    return record;
  }

  private async markTerminalClosed(terminal: TerminalLike): Promise<void> {
    const record = this.terminalRecords.get(terminal);
    if (!record) return;
    const closed: ExtensionManagedSession = { ...record.session, status: "unreachable", lastHeartbeat: this.now() };
    record.session = closed;
    this.sessions.set(record.sessionId, closed);
    await this.bridge.updateStatus(record.sessionId, "unreachable");
  }

  private async adoptTerminal(argument: unknown): Promise<void> {
    const terminal = await this.resolveTerminal(argument);
    if (!terminal) return;
    const record = await this.registerTerminal(terminal);
    if (record.adopted) {
      await this.vscode.window.showWarningMessage("SXSY-B122: this terminal has already been adopted. Its capability set remains unchanged.");
      return;
    }
    const requestedProvider = parseProviderArgument(argument);
    const provider = requestedProvider ?? await this.pickProvider();
    if (!provider) {
      await this.vscode.window.showWarningMessage("SXSY-B122 terminal adoption was cancelled; no provider or capability was inferred.");
      return;
    }
    const result = await this.bridge.adoptTerminal(record.sessionId, record.adoptionKey, provider);
    if (!result.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 terminal adoption unavailable: ${result.message}`);
      return;
    }
    record.adopted = true;
    record.session = result.value;
    this.sessions.set(record.sessionId, result.value);
    await this.vscode.window.showInformationMessage(`SXSY-B122 adopted ${terminal.name} as a Registered ${provider} terminal. It is not Mediated.`);
  }

  private async resolveTerminal(argument: unknown): Promise<TerminalLike | undefined> {
    const requestedName = isRecord(argument) && typeof argument.terminalName === "string" ? argument.terminalName : undefined;
    const candidates = requestedName ? this.vscode.window.terminals.filter((terminal) => terminal.name === requestedName) : this.vscode.window.terminals;
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length) {
      await this.vscode.window.showWarningMessage("SXSY-B122 cannot adopt a terminal because no unique terminal is available.");
      return undefined;
    }
    const items = candidates.map((terminal, index) => ({ label: terminal.name, description: `Terminal ${index + 1}` }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder: "Choose one terminal to adopt once" });
    return selected ? candidates[items.indexOf(selected)] : undefined;
  }

  private async pickProvider(): Promise<Exclude<ExtensionProvider, "voice"> | undefined> {
    const selected = await this.vscode.window.showQuickPick(["claude", "codex", "generic"] as const, { placeHolder: "Identify the terminal provider without changing its capabilities" });
    return selected;
  }

  private async registerDebugConfigurations(): Promise<void> {
    const configurations = this.debugConfigurations();
    for (const [index, configuration] of configurations.entries()) {
      const name = configuration.name ?? `configuration-${index + 1}`;
      const sessionId = `${this.windowSessionId ?? "vscode"}:debug-configuration:${index}`;
      if (this.sessions.has(sessionId)) continue;
      const session = this.makeSession(sessionId, "generic", "vscode_window", "unknown", {
        "sxsy-b122.kind": "debug-configuration",
        "sxsy-b122.debugConfiguration": name
      });
      const result = await this.bridge.registerSession(session, "debug");
      this.sessions.set(sessionId, result.ok ? result.value : session);
    }
  }

  private async registerDebugSession(debugSession: DebugSessionLike): Promise<void> {
    const sessionId = this.debugSessionIds.get(debugSession) ?? `${this.windowSessionId ?? "vscode"}:debug-session:${debugSession.id ?? this.idFactory()}`;
    this.debugSessionIds.set(debugSession, sessionId);
    const session = this.makeSession(sessionId, "generic", "vscode_window", "running", {
      "sxsy-b122.kind": "debug-session",
      "sxsy-b122.debugName": debugSession.name,
      "sxsy-b122.debugConfiguration": debugSession.configuration?.name ?? "unnamed"
    });
    const result = await this.bridge.registerSession(session, "debug");
    this.sessions.set(sessionId, result.ok ? result.value : session);
  }

  private async markDebugSessionEnded(debugSession: DebugSessionLike): Promise<void> {
    const sessionId = this.debugSessionIds.get(debugSession);
    if (!sessionId) return;
    const current = this.sessions.get(sessionId);
    if (!current) return;
    const ended: ExtensionManagedSession = { ...current, status: "unreachable", lastHeartbeat: this.now() };
    this.sessions.set(sessionId, ended);
    await this.bridge.updateStatus(sessionId, "unreachable");
  }

  /** Physical claims use this exact UI/policy path; only the bridge call differs. */
  async dispatchChord(command: ChordCommand, input?: Readonly<Record<string, string>>, hardwareClaim?: HardwareSignalClaim): Promise<void> {
    const selectedSession = await this.resolveDispatchSession(command);
    if (selectedSession === null) {
      await this.vscode.window.showWarningMessage("SXSY-B122 stopped because no exact managed target was selected.");
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "No exact managed target was selected; no preparation or dispatch request was sent.");
      return;
    }
    const reason = `Operator requested ${command.title} through the installed SXSY-B122 extension.`;
    const hardwarePreparation = hardwareClaim ? await this.bridge.prepareHardwareSignal(hardwareClaim, selectedSession, reason) : undefined;
    const regularPreparation = hardwareClaim ? undefined : await this.bridge.prepareCommand({ control: command.control, modifier: command.modifier, ...(selectedSession ? { sessionId: selectedSession } : {}), reason });
    const preparationFailure = hardwarePreparation && !hardwarePreparation.ok ? hardwarePreparation : regularPreparation && !regularPreparation.ok ? regularPreparation : undefined;
    if (preparationFailure) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 preparation unavailable: ${preparationFailure.message}`);
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Command preparation failed before any dispatch request was sent.", undefined, selectedSession);
      return;
    }
    const preparation = hardwarePreparation?.ok ? hardwarePreparation.value.preparation : regularPreparation?.ok ? regularPreparation.value : undefined;
    if (!preparation) {
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", "The extension could not prove a canonical preparation result.", undefined, selectedSession);
      return;
    }
    if (preparation.status !== "prepared") {
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${preparation.status}: ${preparation.summary}`);
      if (hardwareClaim) {
        const dispositionReceiptId = hardwarePreparation?.ok ? hardwarePreparation.value.dispositionReceiptId : undefined;
        await this.finishHardwareSignal(hardwareClaim, dispositionReceiptId ? "handled" : "needs_reconciliation", `Canonical preparation returned ${preparation.status}: ${preparation.summary}`.slice(0, 512), dispositionReceiptId, selectedSession);
      }
      return;
    }
    if (preparation.session) this.sessions.set(preparation.session.id, preparation.session);
    if (selectedSession && !await this.reviewGitMutation(command, selectedSession)) {
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "The exact Git mutation review did not approve dispatch.", undefined, selectedSession);
      return;
    }
    const preparedWorkflow = await this.prepareWorkflowForCommand(command, selectedSession, preparation.authorityId, preparation.confirmationToken);
    if (!preparedWorkflow) {
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "The typed provider workflow artifact was not prepared for dispatch.", undefined, selectedSession);
      return;
    }
    const forwarded: ForwardedCommand = {
      control: command.control,
      modifier: command.modifier,
      ...(selectedSession ? { sessionId: selectedSession } : {}),
      ...(preparation.authorityId ? { authorityId: preparation.authorityId } : {}),
      ...(preparation.confirmationToken ? { confirmationToken: preparation.confirmationToken } : {}),
      input
    };
    const hardwareDispatch = hardwareClaim ? await this.bridge.dispatchHardwareSignal(hardwareClaim, { ...(forwarded.sessionId ? { sessionId: forwarded.sessionId } : {}), ...(forwarded.authorityId ? { authorityId: forwarded.authorityId } : {}), ...(forwarded.confirmationToken ? { confirmationToken: forwarded.confirmationToken } : {}), ...(forwarded.input ? { input: forwarded.input } : {}) }) : undefined;
    const regularDispatch = hardwareClaim ? undefined : await this.bridge.dispatch(forwarded);
    const dispatchFailure = hardwareDispatch && !hardwareDispatch.ok ? hardwareDispatch : regularDispatch && !regularDispatch.ok ? regularDispatch : undefined;
    if (dispatchFailure) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${command.title.replace("SXSY-B122: ", "")} unavailable: ${dispatchFailure.message}`);
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", "The hardware dispatch transport failed after dispatch may have begun.", undefined, selectedSession);
      return;
    }
    const result = hardwareDispatch?.ok ? hardwareDispatch.value.command : regularDispatch?.ok ? regularDispatch.value : undefined;
    const dispatchReceiptId = hardwareDispatch?.ok ? hardwareDispatch.value.dispatchReceiptId : undefined;
    if (!result) {
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", "The extension could not prove a canonical dispatch result.", dispatchReceiptId, selectedSession);
      return;
    }

    const workflowOutcome = forwardedWorkflowOutcome(result);
    const attemptedWorkflowOutcome = result.data?.workflowResult !== undefined || result.data?.resultKind !== undefined;
    if (attemptedWorkflowOutcome && !workflowOutcome) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected malformed protected workflow-result data from the companion.");
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", "The canonical dispatch returned malformed workflow-result data and the extension rejected it.", dispatchReceiptId, selectedSession);
      return;
    }
    if (workflowOutcome && (preparedWorkflow === true
      || workflowOutcome.artifactId !== preparedWorkflow.id
      || workflowOutcome.artifactDigest !== preparedWorkflow.digest
      || workflowOutcome.workflowResult.kind !== expectedWorkflowResultKind(preparedWorkflow.action))) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected a protected workflow result that did not match the exact prepared artifact and action.");
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", "The canonical workflow result changed its prepared artifact or action binding and the extension rejected it.", dispatchReceiptId, selectedSession);
      return;
    }

    const action = forwardedHostAction(result);
    const attemptedHostAction = result.data?.hostActionId !== undefined || result.data?.hostActionKind !== undefined || result.data?.localAction !== undefined;
    if (attemptedHostAction && !action) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected malformed host-action data from the companion.");
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", "The canonical dispatch returned malformed host-action data and the extension rejected it.", dispatchReceiptId, selectedSession);
      return;
    }
    const expected = expectedLocalAction(command);
    if (action && !isExpectedLocalAction(command, action.kind, expected)) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected an unexpected local host action from the companion.");
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", "The canonical dispatch returned an unexpected host action and the extension rejected it.", dispatchReceiptId, selectedSession);
      return;
    }
    const pipelineStatusPresented = command.control === "PIPELINE" && command.modifier === "normal"
      ? await this.presentPipelineStatus(result, selectedSession)
      : false;
    let workflowResultPresented = false;
    if (result.status === "blocked" || result.status === "unavailable" || result.status === "incomplete" || result.status === "failed") {
      if (workflowOutcome) {
        try { await this.presentWorkflowResult(workflowOutcome.workflowResult); workflowResultPresented = true; }
        catch { await this.vscode.window.showWarningMessage("SXSY-B122 received a protected workflow result, but VS Code could not open its bounded read-only result view."); }
      }
      if (!pipelineStatusPresented) await this.vscode.window.showWarningMessage(`SXSY-B122 ${result.status}: ${result.summary}`);
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", `Canonical dispatch returned ${result.status}: ${result.summary}`.slice(0, 512), dispatchReceiptId, selectedSession);
      return;
    }
    if (action) {
      if (result.status !== "running") {
        await this.vscode.window.showWarningMessage("SXSY-B122 rejected a host action that was not bound to a running durable operation.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", "The canonical dispatch returned a host action without a running durable operation.", dispatchReceiptId, selectedSession);
        return;
      }
      let succeeded = false;
      let effectDisposition: "not_started" | "committed" | "ambiguous" = "not_started";
      let summary = "The VS Code host action failed before completion.";
      let authorizationToken: string | undefined;
      let preparedManagedTerminal: PreparedManagedTerminal | undefined;
      try {
        if (Date.parse(action.expiresAt) <= Date.parse(this.now())) throw new Error("The host-action acknowledgement deadline elapsed.");
        const selectionId = action.kind === "select_github_navigation" ? await this.selectGitHubNavigationCandidate(action) : undefined;
        if (action.kind === "select_github_navigation" && !selectionId) throw new Error("GitHub navigation selection was cancelled; no destination was opened.");
        if (action.kind === "create_claude_terminal" || action.kind === "create_codex_terminal") {
          preparedManagedTerminal = await this.prepareManagedAgentTerminal(action.managedTerminalProfile, action.kind === "create_claude_terminal" ? "claude_code" : "codex", action.workspaceRoot);
        }
        const expectedUrl = action.kind === "open_external_url" ? action.url : undefined;
        const authorization = await this.bridge.authorizeHostAction(action.id, this.extensionVersion, selectionId, expectedUrl);
        if (!authorization.ok) throw new Error(`The companion refused the final host-action barrier: ${authorization.message}`);
        if (authorization.value.hostActionId !== action.id || Date.parse(authorization.value.expiresAt) <= Date.parse(this.now())) throw new Error("The final host-action authorization is mismatched or expired.");
        authorizationToken = authorization.value.authorizationToken;
        summary = await this.executeLocalHostAction(action, command, authorization.value, result, preparedManagedTerminal);
        succeeded = true;
        effectDisposition = "committed";
      } catch (error) {
        summary = error instanceof Error && error.message ? error.message : summary;
        if (error instanceof HostEffectError) effectDisposition = error.effectDisposition;
        if (preparedManagedTerminal && effectDisposition === "not_started") await this.bridge.updateStatus(preparedManagedTerminal.sessionId, "unreachable").catch(() => undefined);
      }
      const completion = await this.bridge.completeHostAction(action.id, succeeded, summary.slice(0, 512), this.extensionVersion, authorizationToken, effectDisposition);
      if (!completion.ok) {
        this.deferredHostCommands.delete(action.id);
        await this.vscode.window.showWarningMessage(`SXSY-B122 host action requires reconciliation: ${completion.message}`);
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", "The local host action may have occurred but durable settlement failed.", dispatchReceiptId, selectedSession);
        return;
      }
      const show = completion.value.status === "completed" ? this.vscode.window.showInformationMessage.bind(this.vscode.window) : this.vscode.window.showWarningMessage.bind(this.vscode.window);
      await show(`SXSY-B122 ${completion.value.status}: ${completion.value.summary}`);
      const deferredCommand = this.deferredHostCommands.get(action.id);
      this.deferredHostCommands.delete(action.id);
      if (completion.value.status === "completed" && deferredCommand) {
        try { await this.executeCommand(deferredCommand); }
        catch { await this.vscode.window.showWarningMessage("SXSY-B122 completed the Compound palette selection, but VS Code could not start its canonical reviewed command."); }
      }
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", `Canonical dispatch and host action settled as ${completion.value.status}.`, dispatchReceiptId, selectedSession);
      return;
    }
    if (preparedWorkflow !== true && result.status === "completed") {
      try { await this.completeWorkflowNavigation(preparedWorkflow); }
      catch (error) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 workflow completed but its exact local focus/result delivery failed: ${error instanceof Error ? error.message : "host navigation unavailable"}`);
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", "Provider workflow completed but exact local result delivery requires reconciliation.", dispatchReceiptId, selectedSession);
        return;
      }
    }
    if (workflowOutcome && !workflowResultPresented) {
      try { await this.presentWorkflowResult(workflowOutcome.workflowResult); workflowResultPresented = true; }
      catch (error) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 received a protected workflow result, but VS Code could not open its bounded read-only result view: ${error instanceof Error ? error.message : "result view unavailable"}`);
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", "The provider workflow returned a durable result but exact local result delivery failed.", dispatchReceiptId, selectedSession);
        return;
      }
    }
    if (!pipelineStatusPresented && !workflowResultPresented) await this.vscode.window.showInformationMessage(`SXSY-B122: ${result.summary}`);
    if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", `Canonical dispatch returned ${result.status}: ${result.summary}`.slice(0, 512), dispatchReceiptId, selectedSession);
  }

  private stopReconnect(): void { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }

  private scheduleSessionHeartbeat(delayMs = this.heartbeatIntervalMs): void {
    if (!this.started || this.sessionHeartbeatTimer || this.sessionHeartbeatInFlight) return;
    this.sessionHeartbeatTimer = setTimeout(() => {
      this.sessionHeartbeatTimer = undefined;
      void this.heartbeatLocalSessions();
    }, delayMs);
    this.sessionHeartbeatTimer.unref?.();
  }

  private async heartbeatLocalSessions(): Promise<void> {
    if (!this.started || this.sessionHeartbeatInFlight) return;
    this.sessionHeartbeatInFlight = true;
    try {
      const at = this.now();
      const localSessions = [...this.sessions.values()].filter((session) =>
        session.metadata["sxsy-b122.providerHandshake"] !== "exact-route-v1"
        && session.status !== "unreachable" && session.status !== "stale");
      for (const session of localSessions) {
        const result = await this.bridge.heartbeat(session.id, at);
        if (result.ok) this.sessions.set(result.value.id, result.value);
      }
      await this.refreshSessionNotifications();
    } finally {
      this.sessionHeartbeatInFlight = false;
      this.scheduleSessionHeartbeat();
    }
  }

  private scheduleHardwareSignalPoll(delayMs = 250): void {
    if (!this.started || !this.vscode.window.state.focused || this.hardwareSignalTimer || this.hardwareSignalInFlight || !this.windowSessionId || this.workspaceRoots().length < 1) return;
    this.hardwareSignalTimer = setTimeout(() => {
      this.hardwareSignalTimer = undefined;
      void this.pollHardwareSignal();
    }, delayMs);
    this.hardwareSignalTimer.unref?.();
  }

  private async pollHardwareSignal(): Promise<void> {
    if (!this.started || !this.vscode.window.state.focused || this.hardwareSignalInFlight || !this.windowSessionId) return;
    const workspaceRoots = this.workspaceRoots();
    if (!workspaceRoots.length) return;
    this.hardwareSignalInFlight = true;
    try {
      const claimResult = await this.bridge.claimHardwareSignal({ windowSessionId: this.windowSessionId, workspaceRoots, focused: true });
      if (!claimResult.ok || !claimResult.value) return;
      const claim = claimResult.value;
      if (!this.vscode.window.state.focused || !sameRootList(this.workspaceRoots(), workspaceRoots)) {
        await this.finishHardwareSignal(claim, "failed_before_dispatch", "The VS Code window lost focus or changed workspace binding before hardware preparation began.");
        return;
      }
      const command = chordFor(claim.control, claim.modifier);
      if (!command || claim.windowSessionId !== this.windowSessionId || !sameRootList(claim.workspaceRoots, workspaceRoots)) {
        await this.vscode.window.showWarningMessage("SXSY-B122 rejected a hardware signal claim that was not bound to this exact focused window and canonical assignment.");
        return;
      }
      await this.dispatchChord(command, undefined, claim);
    } finally {
      this.hardwareSignalInFlight = false;
      this.scheduleHardwareSignalPoll();
    }
  }

  private async finishHardwareSignal(claim: HardwareSignalClaim, outcome: "handled" | "failed_before_dispatch" | "needs_reconciliation", summary: string, dispatchReceiptId?: string, dispatchSessionId?: string): Promise<void> {
    const session = dispatchSessionId ? this.sessions.get(dispatchSessionId) : undefined;
    const completion = await this.bridge.completeHardwareSignal(claim, {
      outcome,
      summary,
      ...(dispatchReceiptId ? { dispatchReceiptId } : {}),
      ...(dispatchSessionId ? { dispatchSessionId } : {}),
      ...(session?.workspaceRoot ? { repositoryRoot: session.workspaceRoot } : {})
    });
    if (!completion.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 hardware signal requires reconciliation: ${completion.message}`);
  }

  private async reviewGitMutation(command: ChordCommand, sessionId: string): Promise<boolean> {
    const action = gitReviewAction(command);
    if (!action) return true;
    const input = this.vscode.window.showInputBox;
    if (!input) {
      await this.vscode.window.showWarningMessage("SXSY-B122 Git review is unavailable because this VS Code host cannot collect bounded review fields.");
      return false;
    }
    const session = this.sessions.get(sessionId);
    const root = this.gitRoots.find((candidate) => session?.workspaceRoot && samePath(candidate.gitRoot, session.workspaceRoot));
    if (!session || !root) {
      await this.vscode.window.showWarningMessage("SXSY-B122 Git review stopped because the exact Git-root session is unavailable.");
      return false;
    }
    const inspected = await this.bridge.inspectGitReview(sessionId);
    if (!inspected.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 Git inspection unavailable: ${inspected.message}`);
      return false;
    }
    if (!samePath(inspected.value.repositoryRoot, root.gitRoot)) {
      await this.vscode.window.showWarningMessage("SXSY-B122 Git review stopped because the host-observed repository changed.");
      return false;
    }
    const git = inspected.value;
    let mutation: ReviewedGitMutation | undefined;
    if (action === "local_commit") {
      const available = [...new Set(git.changedPaths)].filter((path) => path && !path.includes(","));
      if (!available.length) {
        await this.vscode.window.showWarningMessage("SXSY-B122 found no structured changed-file list for a local commit; it will not infer paths from terminal text.");
        return false;
      }
      const selection = await input({
        prompt: "Review the exact changed files to include (comma-separated repository paths)",
        value: available.join(", "),
        validateInput: (value) => {
          const selected = splitReviewedPaths(value);
          return selected.length && selected.every((path) => available.includes(path)) ? undefined : "Choose only paths from the current structured Git change list.";
        }
      });
      if (!selection) return false;
      const paths = splitReviewedPaths(selection);
      if (!paths.length || paths.some((path) => !available.includes(path))) return false;
      const message = await input({ prompt: "Enter the exact local commit message", validateInput: (value) => value.trim() && value.length <= 120 && !/[\r\n\0]/.test(value) ? undefined : "Use one non-empty line of at most 120 characters." });
      if (!message) return false;
      let featureBranch: string | undefined;
      if (git.detached || (git.branch !== undefined && git.branch === git.defaultBranch)) {
        featureBranch = await input({ prompt: "Review the new feature branch (this press creates it, then a fresh press commits against the new target)", validateInput: (value) => validBranchInput(value) ?? (git.defaultBranch === value ? "Choose a non-default feature branch." : undefined) });
        if (!featureBranch) return false;
      }
      mutation = { kind: "local_commit", paths, message, ...(featureBranch ? { featureBranch } : {}) };
    } else if (action === "pr_upsert") {
      if (!git.branch) return false;
      const baseBranch = await input({ prompt: "Review the pull request base branch", ...(git.defaultBranch ? { value: git.defaultBranch } : {}), validateInput: validBranchInput });
      if (!baseBranch) return false;
      const title = await input({ prompt: "Review the pull request title", value: `B122 reviewed changes from ${git.branch}`, validateInput: (value) => value.trim() && value.length <= 256 && !/[\r\n\0]/.test(value) ? undefined : "Use one non-empty line of at most 256 characters." });
      if (!title) return false;
      const body = await input({ prompt: "Review the pull request description (one bounded line; empty is allowed)", value: "Created through the SXSY-B122 reviewed Git mediator.", validateInput: (value) => value.length <= 16_384 && !/\0/.test(value) ? undefined : "Use at most 16384 characters without NUL bytes." });
      if (body === undefined) return false;
      mutation = { kind: "pr_upsert", headBranch: git.branch, baseBranch, title, body };
    } else if (action === "pr_merge") {
      const pullRequestText = await input({ prompt: "Enter the exact pull request number", validateInput: (value) => /^[1-9][0-9]{0,9}$/.test(value) ? undefined : "Enter a positive pull request number." });
      const head = pullRequestText ? await input({ prompt: "Enter the exact 40-character reviewed head SHA", validateInput: (value) => /^[a-f0-9]{40}$/i.test(value) ? undefined : "Enter the exact 40-character SHA." }) : undefined;
      const baseBranch = head ? await input({ prompt: "Enter the exact reviewed base branch", ...(git.defaultBranch ? { value: git.defaultBranch } : {}), validateInput: validBranchInput }) : undefined;
      if (!pullRequestText || !head || !baseBranch) return false;
      mutation = { kind: "merge_pr", pullRequest: Number(pullRequestText), head, baseBranch };
    } else {
      if (!git.branch || !git.defaultBranch || git.branch !== git.defaultBranch) {
        await this.vscode.window.showWarningMessage("SXSY-B122 Direct Main requires the exact host-observed current default branch.");
        return false;
      }
      const validationReceiptId = await input({ prompt: "Enter the exact Release Shield validation receipt ID", validateInput: (value) => /^receipt:[A-Za-z0-9._:-]{1,200}$/.test(value) ? undefined : "Enter a receipt ID beginning with receipt:." });
      if (!validationReceiptId) return false;
      mutation = { kind: "direct_main", branch: git.branch, validationReceiptId };
    }
    const reviewed = await this.bridge.reviewGitMutation({ action, sessionId, mutation });
    if (!reviewed.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 Git review unavailable: ${reviewed.message}`);
      return false;
    }
    if (reviewed.value.status !== "approved") {
      await this.vscode.window.showWarningMessage(`SXSY-B122 Git review ${reviewed.value.status}: ${reviewed.value.summary}`);
      return false;
    }
    if (reviewed.value.session) this.sessions.set(reviewed.value.session.id, reviewed.value.session);
    return true;
  }

  private async prepareWorkflowForCommand(command: ChordCommand, sessionId: string | undefined, authorityId: string | undefined, confirmationToken: string | undefined): Promise<true | ExtensionWorkflowArtifact | false> {
    const action = workflowActionForCommand(command);
    if (!action) return true;
    if (!sessionId || !authorityId) {
      await this.vscode.window.showWarningMessage("SXSY-B122 stopped because this provider workflow requires one exact managed session and host-issued authority.");
      return false;
    }
    const session = this.sessions.get(sessionId);
    if (!session?.workspaceRoot || !session.targetSnapshotId) {
      await this.vscode.window.showWarningMessage("SXSY-B122 stopped because the selected session is not bound to a current exact target. Connect its provider adapter first.");
      return false;
    }
    if (action === "bind_voice_session" && !await this.bindVoiceToExactWorkflowSession(session)) return false;
    const listed = await this.bridge.listWorkflows();
    if (!listed.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 workflow registry unavailable: ${listed.message}`);
      return false;
    }
    const pending = listed.value.filter((artifact) => artifact.action === action && artifact.sessionId === session.id && artifact.targetSnapshotId === session.targetSnapshotId && artifact.status === "prepared");
    if (pending.length > 1) {
      await this.vscode.window.showWarningMessage("SXSY-B122 found multiple prepared artifacts for this exact workflow. Cancel the queued operation before trying again; nothing was dispatched.");
      return false;
    }
    if (pending.length === 1) {
      if (action === "plan_approval") {
        const payload = pending[0]!.payload;
        const confirmationMatches = !!confirmationToken && payload.kind === "plan" && payload.mode === "approve"
          && payload.confirmationDigest === createHash("sha256").update(confirmationToken, "utf8").digest("hex");
        if (!confirmationMatches) {
          await this.vscode.window.showWarningMessage("SXSY-B122 stopped because the existing prepared Plan Approval is bound to a different one-time current-user confirmation. Cancel or reconcile that artifact before trying again.");
          return false;
        }
      }
      await this.vscode.window.showInformationMessage(`SXSY-B122 reused the exact prepared ${action} artifact ${pending[0]!.id}; it still grants no execution authority.`);
      return pending[0]!;
    }

    let intent: ExtensionWorkflowPreparationIntent | undefined;
    try { intent = await this.collectWorkflowIntent(action, session, confirmationToken); }
    catch (error) { await this.vscode.window.showWarningMessage(`SXSY-B122 workflow preparation stopped: ${error instanceof Error ? error.message : "reviewed input was unavailable"}`); return false; }
    if (!intent) return false;
    const prepared = await this.bridge.prepareWorkflow({ action, sessionId: session.id, authorityId, intent });
    if (!prepared.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 could not prepare the typed ${action} artifact: ${prepared.message}`);
      return false;
    }
    await this.vscode.window.showInformationMessage(`SXSY-B122 prepared immutable ${action} artifact ${prepared.value.id} (${prepared.value.digest.slice(0, 12)}…). It does not grant authority by itself.`);
    return prepared.value;
  }

  private async collectWorkflowIntent(action: ExtensionWorkflowAction, session: ExtensionManagedSession, confirmationToken: string | undefined): Promise<ExtensionWorkflowPreparationIntent | undefined> {
    const input = this.vscode.window.showInputBox;
    if (action === "option_provider") {
      if (!input) { await this.vscode.window.showWarningMessage("SXSY-B122 cannot collect the one bounded decision question in this VS Code host."); return undefined; }
      const question = await this.reviewedText("Review the exact decision question", "Which safe implementation should be selected?");
      const context = question ? await this.reviewedText("Add bounded context for this decision (the provider will generate options)", session.taskId ? `Task ${session.taskId}, plan ${session.planRevision ?? "unbound"}` : "Current exact selected target") : undefined;
      return question && context ? { kind: "decision", question, context } : undefined;
    }
    if (action === "plan_approval") {
      if (!confirmationToken) { await this.vscode.window.showWarningMessage("Plan Approval stopped because the companion did not issue exact current-user confirmation for this plan execution."); return undefined; }
      return { kind: "plan_approval", confirmationToken };
    }
    if (action === "handoff" || action === "handoff_queue" || action === "handoff_immediate") {
      if (!session.taskId || !session.planRevision) { await this.vscode.window.showWarningMessage("Handoff requires the selected session to carry an exact task and plan revision."); return undefined; }
      const recipient = await this.showSessionQueue("all", "Choose the exact Handoff recipient", (candidate) => candidate.id !== session.id && candidate.workspaceRoot !== undefined && samePath(candidate.workspaceRoot, session.workspaceRoot!) && candidate.targetSnapshotId === session.targetSnapshotId);
      if (!recipient) return undefined;
      const route = action === "handoff_queue" ? "queue" : "immediate";
      return { kind: "handoff", recipientSessionId: recipient.id, route };
    }
    if (action === "authority_broadcast") {
      if (!input) { await this.vscode.window.showWarningMessage("SXSY-B122 cannot collect the reviewed authority broadcast recipients in this VS Code host."); return undefined; }
      const recipients = await this.reviewedList("Review exact recipient session IDs for individualized protected packets (comma-separated)", [session.id]);
      if (!recipients || recipients.some((id) => !this.sessions.has(id))) { await this.vscode.window.showWarningMessage("Authority broadcast requires only exact known managed-session IDs."); return undefined; }
      return { kind: "authority_broadcast", recipientSessionIds: recipients };
    }
    return { kind: "none" };
  }

  private async completeWorkflowNavigation(artifact: ExtensionWorkflowArtifact): Promise<void> {
    const refreshed = await this.bridge.listSessions();
    if (!refreshed.ok) throw new Error(`Protected managed-session registry is unavailable: ${refreshed.message}`);
    for (const session of refreshed.value) this.sessions.set(session.id, session);
    const payload = artifact.payload;
    if (payload.kind === "focus") {
      if (typeof payload.selectedSessionId !== "string" || (payload.expectedStatus !== "verified_blocked" && payload.expectedStatus !== "verified_finished") || typeof payload.reason !== "string") throw new Error("The protected focus artifact is malformed.");
      const selected = this.sessions.get(payload.selectedSessionId);
      if (!selected || selected.status !== payload.expectedStatus || selected.targetSnapshotId !== artifact.targetSnapshotId) throw new Error("The selected session no longer has the exact verified status and target.");
      await this.focusManagedSession(selected);
      await this.vscode.window.showInformationMessage(`${payload.expectedStatus === "verified_blocked" ? "Blocked" : "Finished"} result: ${payload.reason}`);
      return;
    }
    if (payload.kind === "handoff" && payload.route === "immediate") {
      if (typeof payload.packageId !== "string" || typeof payload.recipientSessionId !== "string") throw new Error("The protected immediate Handoff artifact is malformed.");
      const recipient = this.sessions.get(payload.recipientSessionId);
      if (!recipient || recipient.targetSnapshotId !== artifact.targetSnapshotId) throw new Error("The exact Handoff recipient is no longer bound to the package target.");
      const acknowledged = await this.bridge.acknowledgeHandoff(payload.packageId, recipient.id);
      if (!acknowledged.ok) throw new Error(`The immutable Handoff package was not durably acknowledged: ${acknowledged.message}`);
      await this.focusManagedSession(recipient);
    }
  }

  private async presentWorkflowResult(result: ExtensionWorkflowProviderResult): Promise<void> {
    const presentation = workflowResultPresentation(result);
    await this.vscode.window.showInformationMessage(`SXSY-B122 ${presentation.summary}`);
    await this.vscode.window.showQuickPick(presentation.items, { placeHolder: presentation.placeHolder });
  }

  private async reviewedText(prompt: string, value?: string): Promise<string | undefined> {
    const input = this.vscode.window.showInputBox;
    if (!input) return undefined;
    return input({ prompt, ...(value ? { value } : {}), validateInput: (candidate) => candidate.trim() && candidate.length <= 16_384 && !/\0/.test(candidate) ? undefined : "Use bounded non-empty text without NUL bytes." });
  }

  private async reviewedList(prompt: string, defaults: readonly string[], emptyAllowed = false): Promise<readonly string[] | undefined> {
    const input = this.vscode.window.showInputBox;
    if (!input) return undefined;
    const value = await input({ prompt, value: defaults.join(", "), validateInput: (candidate) => {
      const parsed = commaList(candidate);
      if (!emptyAllowed && parsed.length === 0) return "Enter at least one reviewed item.";
      return parsed.length <= 512 && parsed.every((item) => item.length <= 16_384 && !/\0/.test(item)) ? undefined : "Use at most 512 bounded comma-separated items.";
    } });
    return value === undefined ? undefined : commaList(value);
  }

  private async executeLocalHostAction(action: ForwardedHostAction, command: ChordCommand, authorization: ForwardedHostActionAuthorization, result: ForwardedCommandResult, preparedManagedTerminal?: PreparedManagedTerminal): Promise<string> {
    this.requireLiveHostAuthorization(authorization);
    switch (action.kind) {
      case "show_handoff_queue":
        return this.openHandoffQueue();
      case "toggle_handoff_routing": {
        const current = await this.bridge.handoffRouting();
        if (!current.ok) throw new Error(`Durable Handoff routing is unavailable: ${current.message}`);
        const next = current.value === "queue" ? "immediate" : "queue";
        const updated = await this.bridge.setHandoffRouting(next);
        if (!updated.ok) throw new Error(`Durable Handoff routing was not changed: ${updated.message}`);
        return `Handoff routing default changed to ${updated.value}.`;
      }
      case "show_blocker_queue":
        await this.showSessionQueue("verified_blocked", "Verified blocked sessions");
        return "Opened the verified blocker queue.";
      case "show_done_queue":
        await this.showSessionQueue("verified_finished", "Verified finished sessions");
        return "Opened the verified finished queue.";
      case "open_external_url": {
        if (!action.url || !authorization.url || authorization.url !== action.url) throw new Error("The final authorization did not rebind the exact dispatch URL.");
        if (!trustedExternalUrl(authorization.url)) throw new Error("The companion authorized an untrusted external URL.");
        if (!await this.openExternal(authorization.url)) throw new Error("VS Code did not confirm opening the trusted external URL.");
        return "Opened the verified external destination.";
      }
      case "select_github_navigation": {
        if (!authorization.selectionId || !authorization.url || !action.githubCandidates?.some((candidate) => candidate.id === authorization.selectionId)) throw new Error("The companion did not bind the authorization to the selected GitHub candidate.");
        if (!trustedExternalUrl(authorization.url)) throw new Error("The companion authorized an untrusted GitHub destination.");
        if (!await this.openExternal(authorization.url)) throw new Error("VS Code did not confirm opening the selected GitHub destination.");
        return `Opened the exact selected GitHub destination ${authorization.selectionId}.`;
      }
      case "create_claude_terminal":
        await this.createManagedAgentTerminal(preparedManagedTerminal, "claude_code", authorization.expiresAt);
        return "Created the exact current-user-approved Claude Code terminal and registered its identity.";
      case "create_codex_terminal":
        await this.createManagedAgentTerminal(preparedManagedTerminal, "codex", authorization.expiresAt);
        return "Created the exact current-user-approved Codex terminal and registered its identity.";
      case "start_vscode_debug": {
        if (!action.workspaceRoot || !action.debugConfiguration) throw new Error("The companion did not bind debug to an exact workspace and launch configuration.");
        const workspaceRoot = action.workspaceRoot;
        const debugConfiguration = action.debugConfiguration;
        const folder = (this.vscode.workspace.workspaceFolders ?? []).find((candidate) => samePath(candidate.uri.fsPath, workspaceRoot));
        if (!folder) throw new Error("The exact debug workspace is not open in this VS Code host.");
        const matches = this.debugConfigurations().filter((configuration) => configuration.name === debugConfiguration);
        if (matches.length !== 1) throw new Error("The exact verified debug configuration is missing or ambiguous in this VS Code host.");
        if (!await this.vscode.debug.startDebugging(folder, debugConfiguration, { noDebug: false })) throw new Error("VS Code refused to start the exact verified debug configuration.");
        return `Started VS Code debug configuration ${debugConfiguration}.`;
      }
      case "configure_python_venv": {
        if (!action.workspaceRoot || !action.pythonInterpreter) throw new Error("The companion did not bind the Python environment to an exact workspace and interpreter.");
        const workspaceRoot = action.workspaceRoot;
        const interpreter = action.pythonInterpreter;
        if (!samePath(resolve(workspaceRoot, ".venv", "Scripts", "python.exe"), interpreter)) throw new Error("The companion supplied a Python interpreter outside the exact repo-local .venv boundary.");
        const folder = (this.vscode.workspace.workspaceFolders ?? []).find((candidate) => samePath(candidate.uri.fsPath, workspaceRoot));
        if (!folder) throw new Error("The exact Python workspace is not open in this VS Code host.");
        const python = this.vscode.workspace.getConfiguration("python", folder.uri);
        if (!python.update) throw new Error("This VS Code host cannot persist an exact workspace-folder interpreter selection.");
        await python.update("defaultInterpreterPath", interpreter, 3);
        const scripts = dirname(interpreter);
        const inheritedPath = process.env.Path ?? process.env.PATH ?? "";
        const terminal = this.vscode.window.createTerminal({ name: "SXSY-B122 .venv", cwd: workspaceRoot, env: { VIRTUAL_ENV: dirname(scripts), PATH: inheritedPath ? `${scripts}${delimiter}${inheritedPath}` : scripts } });
        terminal.show();
        await this.registerTerminal(terminal);
        return "Selected the exact repo-local Python interpreter and opened a terminal with that environment activated.";
      }
      case "focus_vscode":
        return this.focusOrCycleVscode();
      case "new_vscode_window":
        await this.executeCommand("workbench.action.newWindow");
        return "Opened a new VS Code window.";
      case "focus_external_terminal":
        await this.executeCommand("workbench.action.terminal.openNativeConsole");
        return "Opened the configured external terminal.";
      case "focus_integrated_terminal":
        await this.focusIntegratedTerminal();
        return "Focused the integrated VS Code terminal.";
      case "open_compound_palette":
        return this.openCompoundPalette(action.id, action.workspaceRoot);
      case "show_voice_center":
        return this.openVoiceCenter();
      case "switch_voice_provider": {
        return this.switchDurableVoiceProvider();
      }
      case "show_voice_session_picker":
        return this.bindDurableVoiceSession();
      case "show_pipeline_failure_trace":
        return this.presentPipelineFailureTrace(result);
    }
  }

  private async selectGitHubNavigationCandidate(action: ForwardedHostAction): Promise<string | undefined> {
    const candidates = action.githubCandidates;
    if (!candidates?.length) throw new Error("The companion did not provide an exact bounded GitHub candidate set.");
    const items = candidates.map((candidate) => ({ label: candidate.label, description: candidate.description }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder: "Choose one exact current GitHub destination" });
    return selected ? candidates[items.indexOf(selected)]?.id : undefined;
  }

  private async openHandoffQueue(): Promise<string> {
    const handoff = await this.selectHandoff("Choose one durable Handoff package", (candidate) => candidate.status !== "cancelled" && candidate.status !== "archived");
    if (!handoff) throw new Error("Handoff selection was cancelled.");
    const recipient = handoff.recipientSessionId ? this.sessions.get(handoff.recipientSessionId) : await this.showSessionQueue("all", "Choose the exact Handoff recipient", (session) => session.workspaceRoot !== undefined && samePath(session.workspaceRoot, handoff.repositoryRoot) && session.targetSnapshotId === handoff.targetSnapshotId);
    if (!recipient || recipient.workspaceRoot === undefined || !samePath(recipient.workspaceRoot, handoff.repositoryRoot) || recipient.targetSnapshotId !== handoff.targetSnapshotId) throw new Error("The Handoff recipient is missing or no longer bound to the exact package target.");
    if (handoff.status !== "acknowledged") {
      const acknowledged = await this.bridge.acknowledgeHandoff(handoff.id, recipient.id);
      if (!acknowledged.ok) throw new Error(`The durable Handoff was not acknowledged: ${acknowledged.message}`);
    }
    await this.focusManagedSession(recipient);
    return `Acknowledged Handoff ${handoff.id} and focused its exact managed recipient.`;
  }

  private async selectHandoff(placeHolder: string, predicate: (candidate: ExtensionHandoffPackage) => boolean = () => true): Promise<ExtensionHandoffPackage | undefined> {
    const listed = await this.bridge.listHandoffs();
    if (!listed.ok) throw new Error(`Durable Handoff registry unavailable: ${listed.message}`);
    const candidates = listed.value.filter(predicate);
    if (!candidates.length) throw new Error("No matching durable Handoff packages are available.");
    const items = candidates.map((handoff) => ({ label: `${handoff.taskId}: ${handoff.id}`, description: `${handoff.status} / ${handoff.digest.slice(0, 12)}…` }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder });
    return selected ? candidates[items.indexOf(selected)] : undefined;
  }

  private async focusManagedSession(session: ExtensionManagedSession): Promise<void> {
    if (session.surface === "vscode_terminal") {
      const terminal = this.vscode.window.terminals.find((candidate) => this.terminalRecords.get(candidate)?.sessionId === session.id);
      if (!terminal) throw new Error("The exact managed terminal is no longer open in this VS Code window.");
      terminal.show();
      return;
    }
    if (session.surface === "vscode_window") { await this.executeCommand("workbench.action.focusActiveEditorGroup"); return; }
    throw new Error("This installed VS Code host cannot safely focus that non-VS-Code provider surface.");
  }

  private async openVoiceCenter(): Promise<string> {
    const now = Date.parse(this.now());
    if (!Number.isFinite(now)) throw new Error("The trusted host clock is unavailable for the Voice Center gesture.");
    const state = this.context.globalState ?? this.context.workspaceState;
    const prior = state.get<Readonly<{ version: 1; pressedAt: number }>>(voiceRepeatStateKey);
    const repeated = prior?.version === 1 && Number.isFinite(prior.pressedAt) && now >= prior.pressedAt && now - prior.pressedAt <= this.repeatWindowMs;
    await state.update(voiceRepeatStateKey, { version: 1, pressedAt: now });

    const current = await this.bridge.currentVoice();
    if (!current.ok) throw new Error(`Durable voice state unavailable: ${current.message}`);
    const binding = current.value;
    if (!binding || binding.status === "ended") return this.openOrStartVoice();

    if (repeated) {
      const changed = binding.status === "active" ? await this.bridge.muteVoice(binding.id) : await this.bridge.resumeVoice(binding.id);
      if (!changed.ok) throw new Error(`Voice could not ${binding.status === "active" ? "mute" : "resume"}: ${changed.message}`);
      return `Native ${changed.value.provider} voice runtime is ${changed.value.status}; immutable context ${changed.value.contextPackageId} remains bound.`;
    }

    const choices = [
      "Focus current managed voice session",
      ...(binding.status === "active" ? ["Mute voice conversation"] : ["Resume voice conversation"]),
      "Switch voice provider",
      "Bind exact managed session",
      "End voice conversation",
      ...(binding.transcript === "redacted" ? ["Delete retained transcript"] : [])
    ] as const;
    const selected = await this.vscode.window.showQuickPick(choices, { placeHolder: `Native Voice Center — ${binding.provider} / ${binding.status} / ${binding.contextPackageId}` });
    if (!selected) throw new Error("Voice Center selection was cancelled.");
    if (selected === "Focus current managed voice session") return this.ensureNativeVoiceSession(binding, "focused");
    if (selected === "Mute voice conversation") {
      const muted = await this.bridge.muteVoice(binding.id);
      if (!muted.ok) throw new Error(`Voice could not mute: ${muted.message}`);
      return `Native ${muted.value.provider} voice runtime is muted; immutable context ${muted.value.contextPackageId} remains bound.`;
    }
    if (selected === "Resume voice conversation") {
      const resumed = await this.bridge.resumeVoice(binding.id);
      if (!resumed.ok) throw new Error(`Voice could not resume: ${resumed.message}`);
      return this.ensureNativeVoiceSession(resumed.value, "focused");
    }
    if (selected === "Switch voice provider") return this.switchDurableVoiceProvider();
    if (selected === "Bind exact managed session") return this.bindDurableVoiceSession();
    if (selected === "End voice conversation") {
      const ended = await this.bridge.endVoice(binding.id);
      if (!ended.ok) throw new Error(`Voice could not end: ${ended.message}`);
      return `Native ${ended.value.provider} voice conversation ended for immutable context ${ended.value.contextPackageId}.`;
    }
    const deleted = await this.bridge.deleteVoiceTranscript(binding.id);
    if (!deleted.ok) throw new Error(`Retained voice transcript could not be deleted: ${deleted.message}`);
    return `Native ${deleted.value.provider} voice transcript was deleted for immutable context ${deleted.value.contextPackageId}.`;
  }

  private async openOrStartVoice(): Promise<string> {
    const current = await this.bridge.currentVoice();
    if (!current.ok) throw new Error(`Durable voice state unavailable: ${current.message}`);
    let binding = current.value;
    if (binding && binding.status !== "ended") {
      if (binding.status === "muted" || binding.status === "interrupted") {
        const resumed = await this.bridge.resumeVoice(binding.id);
        if (!resumed.ok) throw new Error(`Voice could not resume: ${resumed.message}`);
        binding = resumed.value;
      }
    } else {
      const handoff = await this.selectHandoff("Choose the immutable Handoff context for voice", (candidate) => candidate.status !== "cancelled" && candidate.status !== "archived");
      if (!handoff) throw new Error("Voice context selection was cancelled.");
      const provider = await this.pickVoiceProvider();
      if (!provider) throw new Error("Voice provider selection was cancelled.");
      const privacy = await this.pickVoicePrivacy();
      if (!privacy) throw new Error("Voice privacy selection was cancelled.");
      const consent = await this.bridge.grantVoiceConsent({ handoffId: handoff.id, provider, ...privacy, expiresInMinutes: 15 });
      if (!consent.ok) throw new Error(`Current-user voice consent was not granted: ${consent.message}`);
      const recipient = await this.showSessionQueue("all", "Choose the single exact managed session for native voice", (candidate) => candidate.workspaceRoot !== undefined
        && samePath(candidate.workspaceRoot, handoff.repositoryRoot)
        && candidate.targetSnapshotId === handoff.targetSnapshotId
        && (candidate.surface === "vscode_terminal" || candidate.surface === "vscode_window")
        && (!handoff.recipientSessionId || candidate.id === handoff.recipientSessionId));
      if (!recipient) throw new Error("Voice managed-session selection was cancelled.");
      const started = await this.bridge.startVoice({ consentId: consent.value.id, voiceSessionId: `voice-${this.idFactory()}`, managedSessionId: recipient.id });
      if (!started.ok) throw new Error(`Durable voice binding was not started: ${started.message}`);
      binding = started.value;
    }
    return this.ensureNativeVoiceSession(binding, "started");
  }

  private async switchDurableVoiceProvider(): Promise<string> {
    const current = await this.bridge.currentVoice();
    if (!current.ok || !current.value || current.value.status === "ended") throw new Error("No current durable voice binding is available to switch.");
    const provider = await this.pickVoiceProvider(current.value.provider);
    if (!provider) throw new Error("Voice provider selection was cancelled.");
    const handoff = await this.selectHandoff("Confirm the immutable context retained during the provider switch", (candidate) => candidate.id === current.value!.contextPackageId && candidate.digest === current.value!.contextDigest);
    if (!handoff) throw new Error("The immutable voice context is no longer available.");
    const privacy = await this.pickVoicePrivacy();
    if (!privacy) throw new Error("Voice privacy selection was cancelled.");
    const consent = await this.bridge.grantVoiceConsent({ handoffId: handoff.id, provider, ...privacy, expiresInMinutes: 15 });
    if (!consent.ok) throw new Error(`Fresh current-user voice consent was not granted: ${consent.message}`);
    const switched = await this.bridge.switchVoice({ bindingId: current.value.id, consentId: consent.value.id, voiceSessionId: `voice-${this.idFactory()}` });
    if (!switched.ok) throw new Error(`Voice provider was not switched: ${switched.message}`);
    return this.ensureNativeVoiceSession(switched.value, "switched");
  }

  private async ensureNativeVoiceSession(binding: ExtensionVoiceBinding, verb: "started" | "switched" | "focused"): Promise<string> {
    const current = await this.bridge.listSessions();
    if (!current.ok) throw new Error(`Native voice ${verb}, but the protected managed-session registry is unavailable: ${current.message}`);
    for (const session of current.value) this.sessions.set(session.id, session);
    const matchesBinding = (candidate: ExtensionManagedSession): boolean => candidate.workspaceRoot !== undefined
      && samePath(candidate.workspaceRoot, binding.repositoryRoot)
      && candidate.targetSnapshotId === binding.targetSnapshotId
      && (candidate.surface === "vscode_terminal" || candidate.surface === "vscode_window");
    let session = binding.managedSessionId ? this.sessions.get(binding.managedSessionId) : undefined;
    if (!session || !matchesBinding(session)) {
      try {
        session = await this.pickKnownSessionQueue("all", "Native voice is active — bind its single exact managed session", matchesBinding);
      } catch (error) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 native ${binding.provider} voice is ${binding.status} but unbound. Use Voice Shift+Alt when an exact VS Code managed session is registered. ${error instanceof Error ? error.message : "Exact session picker unavailable."}`);
        return `Native ${binding.provider} voice runtime ${verb} with immutable context ${binding.contextPackageId}, but it remains unbound to a VS Code managed session.`;
      }
      if (!session) return `Native ${binding.provider} voice runtime ${verb} but remains unbound to a VS Code managed session.`;
      const bound = await this.bridge.bindVoice(binding.id, session.id);
      if (!bound.ok) throw new Error(`Native voice ${verb}, but binding the selected exact managed session failed: ${bound.message}`);
      binding = bound.value;
    }
    await this.focusManagedSession(session);
    return `Native ${binding.provider} voice runtime ${verb} and is ${binding.status}, bound to exact managed session ${session.id} with immutable context ${binding.contextPackageId}; transcript policy is ${binding.transcript}.`;
  }

  private async bindDurableVoiceSession(): Promise<string> {
    const current = await this.bridge.currentVoice();
    if (!current.ok || !current.value || current.value.status === "ended") throw new Error("No current durable voice binding is available.");
    const session = await this.showSessionQueue("all", "Choose the single exact managed session for native voice", (candidate) => candidate.workspaceRoot !== undefined && samePath(candidate.workspaceRoot, current.value!.repositoryRoot) && candidate.targetSnapshotId === current.value!.targetSnapshotId && (candidate.surface === "vscode_terminal" || candidate.surface === "vscode_window"));
    if (!session) throw new Error("Voice session selection was cancelled.");
    const bound = await this.bridge.bindVoice(current.value.id, session.id);
    if (!bound.ok) throw new Error(`Voice was not bound to the selected session: ${bound.message}`);
    await this.focusManagedSession(session);
    return `Bound voice ${bound.value.id} to the single exact managed session ${session.id}.`;
  }

  /** Alt Voice binds the already-selected focused agent before its protected workflow artifact is prepared. */
  private async bindVoiceToExactWorkflowSession(session: ExtensionManagedSession): Promise<boolean> {
    if ((session.provider !== "claude" && session.provider !== "codex")
      || (session.surface !== "vscode_terminal" && session.surface !== "vscode_window")
      || session.status === "stale" || session.status === "unreachable" || session.status === "unknown") {
      await this.vscode.window.showWarningMessage("SXSY-B122 Alt Voice requires the currently focused, reachable managed Claude or Codex VS Code session.");
      return false;
    }
    const current = await this.bridge.currentVoice();
    if (!current.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 could not read the protected voice binding: ${current.message}`);
      return false;
    }
    if (!current.value || current.value.status === "ended") {
      await this.vscode.window.showWarningMessage("SXSY-B122 Alt Voice requires one current durable voice conversation.");
      return false;
    }
    if (!samePath(current.value.repositoryRoot, session.workspaceRoot!) || current.value.targetSnapshotId !== session.targetSnapshotId) {
      await this.vscode.window.showWarningMessage("SXSY-B122 stopped because the focused managed session does not match the voice conversation's exact repository and TargetSnapshot.");
      return false;
    }
    let binding = current.value;
    if (binding.managedSessionId !== session.id) {
      const bound = await this.bridge.bindVoice(binding.id, session.id);
      if (!bound.ok) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 could not bind voice to the focused managed session: ${bound.message}`);
        return false;
      }
      binding = bound.value;
    }
    if (binding.id !== current.value.id || binding.managedSessionId !== session.id
      || binding.status === "ended" || !samePath(binding.repositoryRoot, session.workspaceRoot!)
      || binding.targetSnapshotId !== session.targetSnapshotId) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected a voice binding that changed its exact conversation, managed session, repository, target, or lifecycle state.");
      return false;
    }
    return true;
  }

  private async pickVoiceProvider(exclude?: ExtensionVoiceProvider): Promise<ExtensionVoiceProvider | undefined> {
    const providers = (["chatgpt", "claude"] as const).filter((provider) => provider !== exclude);
    return this.vscode.window.showQuickPick(providers, { placeHolder: "Choose the reviewed voice provider" });
  }

  private async pickVoicePrivacy(): Promise<Readonly<{ transcript: "off" | "redacted"; retentionMinutes: number }> | undefined> {
    const selected = await this.vscode.window.showQuickPick(["Transcripts off (recommended)", "Redacted transcript for 30 minutes"] as const, { placeHolder: "Choose the voice privacy boundary" });
    if (selected === "Transcripts off (recommended)") return { transcript: "off", retentionMinutes: 0 };
    if (selected === "Redacted transcript for 30 minutes") return { transcript: "redacted", retentionMinutes: 30 };
    return undefined;
  }

  private async showSessionQueue(status: ExtensionManagedSession["status"] | "all", placeHolder: string, predicate: (session: ExtensionManagedSession) => boolean = () => true): Promise<ExtensionManagedSession | undefined> {
    const current = await this.bridge.listSessions();
    if (!current.ok) throw new Error(`The protected managed-session registry is unavailable: ${current.message}`);
    for (const session of current.value) this.sessions.set(session.id, session);
    return this.pickKnownSessionQueue(status, placeHolder, predicate);
  }

  private async pickKnownSessionQueue(status: ExtensionManagedSession["status"] | "all", placeHolder: string, predicate: (session: ExtensionManagedSession) => boolean): Promise<ExtensionManagedSession | undefined> {
    const candidates = [...this.sessions.values()].filter((session) => (status === "all" || session.status === status) && predicate(session));
    if (!candidates.length) throw new Error(status === "all" ? "No managed sessions are registered." : `No ${status.replace("verified_", "verified ")} sessions are available.`);
    const items = candidates.map((session) => ({ label: `${session.provider}: ${session.id}`, description: `${session.surface} / ${session.status}` }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder });
    if (!selected) throw new Error("Session selection was cancelled.");
    return candidates[items.indexOf(selected)];
  }

  private async focusOrCycleVscode(): Promise<string> {
    const now = Date.parse(this.now());
    if (!Number.isFinite(now)) throw new Error("The trusted host clock is unavailable for the VS Code repeat gesture.");
    const state = this.context.globalState ?? this.context.workspaceState;
    const prior = state.get<Readonly<{ version: 1; pressedAt: number }>>(vscodeRepeatStateKey);
    const repeated = prior?.version === 1 && Number.isFinite(prior.pressedAt) && now >= prior.pressedAt && now - prior.pressedAt <= this.repeatWindowMs;
    if (repeated) {
      await this.executeCommand("workbench.action.switchWindow");
      await this.executeCommand("workbench.action.quickOpenNavigateNextInViewPicker");
      await this.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
    } else {
      await this.executeCommand("workbench.action.focusActiveEditorGroup");
    }
    await state.update(vscodeRepeatStateKey, { version: 1, pressedAt: now });
    return repeated ? "Cycled to the next open VS Code window." : "Focused the last-used VS Code window.";
  }

  private async openCompoundPalette(hostActionId: string, workspaceRoot: string | undefined): Promise<string> {
    if (!workspaceRoot) throw new Error("The Compound palette is not bound to an exact repository root.");
    const folder = (this.vscode.workspace.workspaceFolders ?? []).find((candidate) => samePath(candidate.uri.fsPath, workspaceRoot));
    if (!folder) throw new Error("The exact Compound repository is no longer open in this VS Code window.");
    const target = this.gitRoots.find((root) => samePath(root.gitRoot, workspaceRoot));
    const branch = target?.branch ?? "unknown branch";
    const choices = [
      { label: "Capture — ce-compound", description: "Capture one solved, verified problem as durable project learning.", command: "sxsy-b122.chord.compound.normal" },
      { label: "Refresh — ce-compound-refresh", description: "Mutating learning audit; the canonical route previews scope and requires review.", command: "sxsy-b122.chord.compound.shift" },
      { label: "Full Loop — lfg", description: "High-consequence plan-to-PR loop; acceptance gates and wrapper confirmation remain mandatory.", command: "sxsy-b122.chord.compound.shift_alt" }
    ] as const;
    const items = choices.map(({ label, description }) => ({ label, description }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder: `Compound workflows for ${workspaceRoot} on ${branch}` });
    if (!selected) return `Opened the repository-bound Compound workflow palette for ${branch}; no workflow was selected.`;
    const choice = choices[items.indexOf(selected)];
    if (!choice) throw new Error("The Compound workflow selection is no longer valid.");
    this.deferredHostCommands.set(hostActionId, choice.command);
    return `Selected ${choice.label} from the repository-bound palette for ${branch}; its canonical B122 command will start only after this host action is durably acknowledged.`;
  }

  private async presentPipelineStatus(result: ForwardedCommandResult, selectedSessionId: string | undefined): Promise<boolean> {
    const view = pipelineStatusView(result);
    const session = selectedSessionId ? this.sessions.get(selectedSessionId) : undefined;
    const branch = safeOverlayText(session?.metadata["sxsy-b122.branch"] ?? "unknown branch", 160);
    const targetKey = session?.targetSnapshotId ?? session?.workspaceRoot ?? selectedSessionId ?? "unbound";
    let selectedFailure: PipelineFailureView | undefined;
    let selectedIndex = 0;
    if (view.failures.length) {
      const seriesDigest = createHash("sha256").update(JSON.stringify(view.failures)).digest("hex");
      const state = this.context.globalState ?? this.context.workspaceState;
      const prior = state.get<Readonly<{ version: 1; targetKey: string; seriesDigest: string; index: number }>>(pipelineFailureCursorStateKey);
      selectedIndex = prior?.version === 1 && prior.targetKey === targetKey && prior.seriesDigest === seriesDigest
        ? (prior.index + 1) % view.failures.length
        : 0;
      await state.update(pipelineFailureCursorStateKey, { version: 1, targetKey, seriesDigest, index: selectedIndex });
      selectedFailure = view.failures[selectedIndex];
    }
    const hosted = `${view.hostedState}${view.head ? ` at ${view.head.slice(0, 12)}…` : ""}`;
    const localReceipt = view.latestLocalReceipt
      ? `; local ${view.latestLocalReceipt.action}=${view.latestLocalReceipt.result} (${view.latestLocalReceipt.completeness})`
      : `; local ${view.localStatus}`;
    const failure = selectedFailure
      ? `. Failure ${selectedIndex + 1} of ${view.failures.length}: ${selectedFailure.name}=${selectedFailure.outcome}${selectedFailure.summary ? ` — ${selectedFailure.summary}` : ""}. Press Pipeline again to cycle failures; Alt Pipeline opens the bounded diagnosis.`
      : ". No failing gate was reported for this exact observation. Shift Pipeline runs the declared isolated local gate; Alt Pipeline opens a bounded diagnosis only when a failure exists.";
    const message = safeOverlayText(`SXSY-B122 Pipeline ${branch}: hosted ${hosted}${localReceipt}${failure}`, 1_024);
    if (view.failures.length || ["FAILURE", "ERROR"].includes(view.hostedState) || result.status !== "completed") await this.vscode.window.showWarningMessage(message);
    else await this.vscode.window.showInformationMessage(message);
    return true;
  }

  private async presentPipelineFailureTrace(result: ForwardedCommandResult): Promise<string> {
    const trace = pipelineFailureTraceView(result);
    if (!trace) throw new Error("The companion did not return the selected exact-head failure excerpt and bounded diagnosis.");
    const outcome = trace.selectedFailure.conclusion ?? trace.selectedFailure.state;
    const items: readonly QuickPickItemLike[] = [
      workflowResultItem(`${trace.selectedFailure.name}: ${outcome}`, `Failure ${trace.selectedIndex + 1} of ${trace.failureCount} / ${trace.head.slice(0, 12)}…`, trace.logExcerpt),
      workflowResultItem("Bounded diagnosis", trace.repeatAvailable ? "Press Alt Pipeline again for the next failed context" : "Single failed context", trace.diagnosis),
      ...(trace.selectedFailure.summary && trace.selectedFailure.summary !== trace.logExcerpt
        ? [workflowResultItem("Provider summary", trace.selectedFailure.kind, trace.selectedFailure.summary)]
        : [])
    ];
    await this.vscode.window.showQuickPick(items, { placeHolder: `Failure ${trace.selectedIndex + 1} of ${trace.failureCount} for exact head ${trace.head.slice(0, 12)}… — read-only evidence` });
    return `Presented protected failure ${trace.selectedIndex + 1} of ${trace.failureCount} for exact head ${trace.head.slice(0, 12)}… with its bounded excerpt and diagnosis.`;
  }

  private async prepareManagedAgentTerminal(profile: ManagedTerminalProfileSummary | undefined, expectedProvider: "claude_code" | "codex", workspaceRoot: string | undefined): Promise<PreparedManagedTerminal> {
    if (!profile || profile.provider !== expectedProvider || profile.shell !== false || profile.args.length !== 0 || profile.requiresFinalIdentityVerification !== true || Date.parse(profile.validUntil) <= Date.parse(this.now())) throw new Error("The companion did not provide a live exact managed-terminal executable profile.");
    if (!workspaceRoot) throw new Error("The managed-terminal host action is not bound to an exact workspace root.");
    const requestedRoot = resolve(workspaceRoot);
    const folder = (this.vscode.workspace.workspaceFolders ?? []).find((candidate) => samePath(resolve(candidate.uri.fsPath), requestedRoot));
    if (!folder) throw new Error("The exact managed-terminal workspace is no longer open in this VS Code host.");
    const rootLink = await lstat(requestedRoot);
    if (!rootLink.isDirectory() || rootLink.isSymbolicLink()) throw new Error("The exact managed-terminal workspace is absent or linked.");
    const canonicalRoot = await realpath(requestedRoot);
    const canonicalFolder = await realpath(resolve(folder.uri.fsPath));
    if (!samePath(canonicalRoot, canonicalFolder)) throw new Error("The managed-terminal workspace identity changed before creation.");
    const rootIdentity = await stat(canonicalRoot);
    const rootExactIdentity = await exactFilesystemIdentity(canonicalRoot);
    if (!rootIdentity.isDirectory()) throw new Error("The managed-terminal workspace is not a directory.");
    const configured = resolve(profile.canonicalExecutablePath);
    const link = await lstat(configured);
    if (!link.isFile() || link.isSymbolicLink() || link.size <= 0 || link.size > 2 * 1024 * 1024 * 1024) throw new Error("The managed-terminal provider is absent, linked, or outside its bounded executable size.");
    const canonical = await realpath(configured);
    if (!samePath(canonical, configured)) throw new Error("The managed-terminal provider path resolves through an unexpected filesystem alias.");
    const before = await stat(canonical);
    const beforeExact = await exactFilesystemIdentity(canonical);
    const digest = await sha256File(canonical);
    const after = await stat(canonical);
    const afterExact = await exactFilesystemIdentity(canonical);
    if (digest !== profile.executableSha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs || beforeExact.device !== afterExact.device || beforeExact.inode !== afterExact.inode
      || after.size !== profile.executableSize || after.mtimeMs !== profile.executableModifiedMs || afterExact.device !== profile.executableDevice || afterExact.inode !== profile.executableInode
      || Date.parse(profile.validUntil) <= Date.parse(this.now())) throw new Error("The managed-terminal provider identity changed before VS Code creation.");
    const configuredLauncher = resolve(profile.canonicalLauncherPath);
    const launcherLink = await lstat(configuredLauncher);
    if (!launcherLink.isFile() || launcherLink.isSymbolicLink() || launcherLink.size <= 0 || launcherLink.size > 256 * 1024 * 1024) throw new Error("The fixed managed-terminal launcher is absent, linked, or outside its bounded executable size.");
    const canonicalLauncher = await realpath(configuredLauncher);
    if (!samePath(canonicalLauncher, configuredLauncher)) throw new Error("The fixed managed-terminal launcher resolves through an unexpected filesystem alias.");
    const launcherBefore = await stat(canonicalLauncher);
    const launcherBeforeExact = await exactFilesystemIdentity(canonicalLauncher);
    const launcherDigest = await sha256File(canonicalLauncher);
    const launcherAfter = await stat(canonicalLauncher);
    const launcherAfterExact = await exactFilesystemIdentity(canonicalLauncher);
    if (launcherDigest !== profile.launcherSha256 || launcherBefore.size !== launcherAfter.size || launcherBefore.mtimeMs !== launcherAfter.mtimeMs
      || launcherBeforeExact.device !== launcherAfterExact.device || launcherBeforeExact.inode !== launcherAfterExact.inode) throw new Error("The fixed managed-terminal launcher identity changed before VS Code creation.");
    const sessionId = this.idFactory();
    const adoptionKey = `terminal:${sessionId}`;
    const pending = this.makeSession(sessionId, "generic", "vscode_terminal", "unknown", {
      "sxsy-b122.kind": "terminal",
      "sxsy-b122.terminalName": profile.profileName,
      "sxsy-b122.adoptionKey": adoptionKey,
      "sxsy-b122.providerInstallation": profile.installationId
    }, canonicalRoot);
    const registered = await this.bridge.registerSession(pending, "terminal");
    if (!registered.ok) throw new Error(`The exact managed-terminal identity could not be reserved before creation: ${registered.message}`);
    return {
      profile,
      expectedProvider,
      canonicalRoot,
      rootDevice: rootExactIdentity.device,
      rootInode: rootExactIdentity.inode,
      canonicalExecutablePath: canonical,
      executableSize: after.size,
      executableModifiedMs: after.mtimeMs,
      executableDevice: afterExact.device,
      executableInode: afterExact.inode,
      canonicalLauncherPath: canonicalLauncher,
      launcherSize: launcherAfter.size,
      launcherModifiedMs: launcherAfter.mtimeMs,
      launcherDevice: launcherAfterExact.device,
      launcherInode: launcherAfterExact.inode,
      sessionId,
      adoptionKey,
      registeredSession: registered.value
    };
  }

  private async createManagedAgentTerminal(prepared: PreparedManagedTerminal | undefined, expectedProvider: "claude_code" | "codex", authorizationExpiresAt: string): Promise<void> {
    if (!prepared || prepared.expectedProvider !== expectedProvider || prepared.profile.provider !== expectedProvider) throw new Error("The managed-terminal provider preflight is missing or bound to another provider.");
    this.requireLiveHostAuthorization({ expiresAt: authorizationExpiresAt });
    if (Date.parse(prepared.profile.validUntil) <= Date.parse(this.now())) throw new Error("The managed-terminal executable profile expired before creation.");
    const rootLink = await lstat(prepared.canonicalRoot);
    const currentRoot = await realpath(prepared.canonicalRoot);
    const rootIdentity = await stat(currentRoot);
    const rootExactIdentity = await exactFilesystemIdentity(currentRoot);
    if (!rootLink.isDirectory() || rootLink.isSymbolicLink() || !samePath(currentRoot, prepared.canonicalRoot)
      || !rootIdentity.isDirectory() || rootExactIdentity.device !== prepared.rootDevice || rootExactIdentity.inode !== prepared.rootInode) throw new Error("The managed-terminal workspace identity changed after final authorization.");
    const executableLink = await lstat(prepared.canonicalExecutablePath);
    const currentExecutable = await realpath(prepared.canonicalExecutablePath);
    const executableIdentity = await stat(currentExecutable);
    const executableExactIdentity = await exactFilesystemIdentity(currentExecutable);
    if (!executableLink.isFile() || executableLink.isSymbolicLink() || !samePath(currentExecutable, prepared.canonicalExecutablePath)
      || executableIdentity.size !== prepared.executableSize || executableIdentity.mtimeMs !== prepared.executableModifiedMs
      || executableExactIdentity.device !== prepared.executableDevice || executableExactIdentity.inode !== prepared.executableInode) throw new Error("The managed-terminal provider identity changed after final authorization.");
    const launcherLink = await lstat(prepared.canonicalLauncherPath);
    const currentLauncher = await realpath(prepared.canonicalLauncherPath);
    const launcherIdentity = await stat(currentLauncher);
    const launcherExactIdentity = await exactFilesystemIdentity(currentLauncher);
    if (!launcherLink.isFile() || launcherLink.isSymbolicLink() || !samePath(currentLauncher, prepared.canonicalLauncherPath)
      || launcherIdentity.size !== prepared.launcherSize || launcherIdentity.mtimeMs !== prepared.launcherModifiedMs
      || launcherExactIdentity.device !== prepared.launcherDevice || launcherExactIdentity.inode !== prepared.launcherInode) throw new Error("The fixed managed-terminal launcher identity changed after final authorization.");
    this.requireLiveHostAuthorization({ expiresAt: authorizationExpiresAt });
    const receiptReservation = await this.managedTerminalReceiptFactory({ provider: expectedProvider, canonicalExecutablePath: prepared.canonicalExecutablePath, canonicalWorkspaceRoot: prepared.canonicalRoot });
    const descriptor = Buffer.from(JSON.stringify({
      schema: "sxsy-b122.managed-terminal-launch",
      version: 1,
      provider: expectedProvider,
      identity: {
        canonicalExecutablePath: prepared.canonicalExecutablePath,
        executableSha256: prepared.profile.executableSha256,
        signerSubject: prepared.profile.signerSubject,
        signerThumbprint: prepared.profile.signerThumbprint,
        productIdentity: prepared.profile.productIdentity,
        size: prepared.executableSize,
        modifiedMs: prepared.executableModifiedMs,
        device: prepared.executableDevice,
        inode: prepared.executableInode
      },
      workspace: { canonicalPath: prepared.canonicalRoot, device: prepared.rootDevice, inode: prepared.rootInode },
      receipt: { pipeName: receiptReservation.pipeName, token: receiptReservation.token }
    }), "utf8").toString("base64url");
    if (descriptor.length > 16_384) {
      await receiptReservation.dispose();
      throw new Error("The exact managed-terminal launch descriptor is oversized.");
    }
    let terminal: TerminalLike;
    try {
      terminal = this.vscode.window.createTerminal({ name: prepared.profile.profileName, cwd: prepared.canonicalRoot, shellPath: prepared.canonicalLauncherPath, shellArgs: ["--managed-terminal-v1", descriptor] });
    } catch (error) {
      await receiptReservation.dispose().catch(() => undefined);
      throw error;
    }
    const { sessionId, adoptionKey } = prepared;
    const record: TrackedTerminal = { sessionId, adoptionKey, adopted: false, session: prepared.registeredSession };
    this.terminalRecords.set(terminal, record);
    this.terminalBySessionId.set(sessionId, record);
    this.sessions.set(sessionId, prepared.registeredSession);
    try {
      terminal.show();
      const processId = terminal.processId ? await boundedPromise(Promise.resolve(terminal.processId), 5_000, "The managed-terminal launcher did not expose a process identity.") : undefined;
      if (!Number.isSafeInteger(processId) || (processId ?? 0) <= 0) throw new Error("The managed-terminal launcher did not expose a valid process identity.");
      const receipt = await boundedPromise(receiptReservation.wait(), 10_000, "The native managed-terminal launcher did not attest a started provider child.");
      if (receipt.provider !== expectedProvider || !Number.isSafeInteger(receipt.processId) || receipt.processId <= 0
        || !samePath(receipt.canonicalExecutablePath, prepared.canonicalExecutablePath) || !samePath(receipt.canonicalWorkspaceRoot, prepared.canonicalRoot)) {
        throw new Error("The native managed-terminal child-start receipt was malformed or substituted.");
      }
      await sleep(this.managedTerminalHealthMs);
      if (this.closedTerminals.has(terminal)) throw new Error("The managed-terminal launcher or provider exited before its bounded health window.");
      const adopted = await this.bridge.adoptTerminal(sessionId, adoptionKey, expectedProvider === "claude_code" ? "claude" : "codex");
      if (!adopted.ok) throw new Error(adopted.message);
      record.adopted = true;
      record.session = adopted.value;
      this.sessions.set(sessionId, adopted.value);
    } catch (error) {
      throw new HostEffectError(`The exact terminal was created but its durable Registered identity requires reconciliation: ${error instanceof Error ? error.message : "adoption unavailable"}`, "ambiguous");
    } finally { await receiptReservation.dispose().catch(() => undefined); }
  }

  private requireLiveHostAuthorization(authorization: Pick<ForwardedHostActionAuthorization, "expiresAt">): void {
    if (!Number.isFinite(Date.parse(authorization.expiresAt)) || Date.parse(authorization.expiresAt) <= Date.parse(this.now())) throw new Error("The one-time host-action authorization expired before the local effect.");
  }

  private async focusIntegratedTerminal(): Promise<void> {
    const terminal = this.vscode.window.activeTerminal ?? this.vscode.window.terminals[0] ?? this.vscode.window.createTerminal({ name: "SXSY-B122 Terminal" });
    terminal.show();
    await this.registerTerminal(terminal);
  }

  private debugConfigurations(): readonly DebugConfigurationLike[] {
    const raw = this.vscode.workspace.getConfiguration("launch").get<unknown>("configurations");
    return Array.isArray(raw) ? raw.filter(isDebugConfiguration) : [];
  }

  private makeSession(
    id: string,
    provider: ExtensionProvider,
    surface: ExtensionManagedSession["surface"],
    status: ExtensionManagedSession["status"],
    metadata: Readonly<Record<string, string>>,
    workspaceRootOverride?: string
  ): ExtensionManagedSession {
    const roots = this.workspaceRoots();
    return {
      id,
      provider,
      surface,
      capabilities: ["registered"],
      status,
      workspaceRoot: workspaceRootOverride ?? (roots.length === 1 ? roots[0] : undefined),
      plannedFiles: [],
      lastHeartbeat: this.now(),
      adapterVersion: this.extensionVersion,
      metadata
    };
  }

  private activeSessionId(): string | undefined {
    const terminal = this.vscode.window.activeTerminal;
    return terminal ? this.terminalRecords.get(terminal)?.sessionId ?? this.windowSessionId : this.windowSessionId;
  }

  private async resolveDispatchSession(command: ChordCommand): Promise<string | null | undefined> {
    if (command.control === "VOICE" && command.modifier === "alt") {
      const active = this.activeSessionId();
      const session = active ? this.sessions.get(active) : undefined;
      return session?.workspaceRoot && session.targetSnapshotId
        && (session.provider === "claude" || session.provider === "codex")
        && (session.surface === "vscode_terminal" || session.surface === "vscode_window")
        ? session.id
        : null;
    }
    if (!requiresExactTarget(command)) return this.activeSessionId();
    const candidates = [...this.sessions.values()].filter((session) => session.metadata["sxsy-b122.kind"] === "git-root" && !!session.workspaceRoot);
    if (candidates.length === 0) return this.activeSessionId();
    if (candidates.length === 1) return candidates[0]!.id;
    const stored = this.context.workspaceState.get<string>(selectedTargetStateKey);
    if (stored && candidates.some((session) => session.id === stored)) return stored;
    const items = candidates.map((session) => ({ label: session.workspaceRoot!, description: session.metadata["sxsy-b122.branch"] ?? "unknown branch", detail: session.id }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder: `Choose one exact Git target for ${command.title.replace("SXSY-B122: ", "")}` });
    if (!selected) return null;
    const session = candidates[items.indexOf(selected)];
    if (!session) return null;
    await this.context.workspaceState.update(selectedTargetStateKey, session.id);
    return session.id;
  }

  private workspaceRoots(): readonly string[] {
    return (this.vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  }
}

interface PreparedManagedTerminal {
  readonly profile: ManagedTerminalProfileSummary;
  readonly expectedProvider: "claude_code" | "codex";
  readonly canonicalRoot: string;
  readonly rootDevice: string;
  readonly rootInode: string;
  readonly canonicalExecutablePath: string;
  readonly executableSize: number;
  readonly executableModifiedMs: number;
  readonly executableDevice: string;
  readonly executableInode: string;
  readonly canonicalLauncherPath: string;
  readonly launcherSize: number;
  readonly launcherModifiedMs: number;
  readonly launcherDevice: string;
  readonly launcherInode: string;
  readonly sessionId: string;
  readonly adoptionKey: string;
  readonly registeredSession: ExtensionManagedSession;
}

class HostEffectError extends Error {
  readonly effectDisposition: "committed" | "ambiguous";
  constructor(message: string, effectDisposition: "committed" | "ambiguous") { super(message); this.effectDisposition = effectDisposition; }
}

function workflowActionForCommand(command: ChordCommand): ExtensionWorkflowAction | undefined {
  const value = workflowCommandActions[`${command.control}:${command.modifier}`];
  return value;
}

const workflowCommandActions: Readonly<Record<string, ExtensionWorkflowAction>> = {
  "REANCHOR:normal": "reanchor", "PROOF:normal": "proof", "PROOF:shift": "proof_adversarial",
  "OPTION_PROVIDER:normal": "option_provider", "OPTION_PROVIDER:shift": "option_packet", "PLAN_EXPANDER:normal": "plan_expander", "PLAN_APPROVAL:normal": "plan_approval",
  "HANDOFF:normal": "handoff", "HANDOFF:shift": "handoff_queue", "HANDOFF:alt": "handoff_immediate", "FIND_BLOCKED_AGENT:normal": "focus_blocked_agent", "FIND_FINISHED_AGENT:normal": "focus_finished_agent",
  "AUTHORITY_REFRESH:normal": "authority_refresh", "AUTHORITY_REFRESH:shift": "authority_broadcast", "VOICE:alt": "bind_voice_session"
};

function boundedHeartbeatInterval(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 5 * 60_000) throw new Error("The local session heartbeat interval is invalid.");
  return value;
}
function boundedManagedTerminalHealth(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 5_000) throw new Error("The managed-terminal health interval is invalid.");
  return value;
}
function boundedRepeatWindow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 250 || value > 5_000) throw new Error("The repeat-gesture interval is invalid.");
  return value;
}
async function boundedPromise<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
async function sleep(milliseconds: number): Promise<void> { await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)); }
async function reserveManagedTerminalReceipt(input: Readonly<{ provider: "claude_code" | "codex"; canonicalExecutablePath: string; canonicalWorkspaceRoot: string }>): Promise<ManagedTerminalReceiptReservation> {
  if (process.platform !== "win32") throw new Error("The native managed-terminal receipt boundary requires Windows.");
  const pipeName = `sxsy-b122-managed-${randomBytes(20).toString("hex")}`;
  const pipePath = `\\\\.\\pipe\\${pipeName}`;
  const token = randomBytes(32).toString("hex");
  let settle!: (value: ManagedTerminalLaunchReceipt) => void;
  let reject!: (error: Error) => void;
  let settled = false;
  let connected = false;
  const sockets = new Set<import("node:net").Socket>();
  const receipt = new Promise<ManagedTerminalLaunchReceipt>((resolveReceipt, rejectReceipt) => { settle = resolveReceipt; reject = rejectReceipt; });
  receipt.catch(() => undefined);
  const fail = (message: string): void => {
    if (settled) return;
    settled = true;
    reject(new Error(message));
    for (const socket of sockets) socket.destroy();
  };
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    if (connected) { socket.destroy(); return fail("More than one process connected to the one-shot managed-terminal receipt pipe."); }
    connected = true;
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > 4_096) return fail("The managed-terminal child-start receipt was oversized.");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      if (buffer.slice(newline + 1).trim()) return fail("The managed-terminal launcher emitted more than one receipt.");
      let value: unknown;
      try { value = JSON.parse(buffer.slice(0, newline).replace(/\r$/, "")); }
      catch { return fail("The managed-terminal launcher emitted invalid receipt JSON."); }
      const keys = isRecord(value) ? Object.keys(value).sort() : [];
      if (!isRecord(value) || keys.join("|") !== "canonicalExecutablePath|canonicalWorkspaceRoot|processId|provider|schema|token|version"
        || value.schema !== "sxsy-b122.managed-terminal-started" || value.version !== 1 || value.token !== token
        || value.provider !== input.provider || !Number.isSafeInteger(value.processId) || (value.processId as number) <= 0
        || typeof value.canonicalExecutablePath !== "string" || !samePath(value.canonicalExecutablePath, input.canonicalExecutablePath)
        || typeof value.canonicalWorkspaceRoot !== "string" || !samePath(value.canonicalWorkspaceRoot, input.canonicalWorkspaceRoot)) {
        return fail("The managed-terminal launcher emitted a malformed or substituted child-start receipt.");
      }
      settled = true;
      settle({ provider: input.provider, processId: value.processId as number, canonicalExecutablePath: value.canonicalExecutablePath, canonicalWorkspaceRoot: value.canonicalWorkspaceRoot });
      socket.end();
    });
    socket.once("error", () => fail("The managed-terminal child-start receipt pipe failed."));
    socket.once("end", () => { if (!settled) fail("The managed-terminal launcher closed before a complete child-start receipt."); });
  });
  server.once("error", () => fail("The managed-terminal child-start receipt pipe could not be created."));
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("listening", resolveListen);
    server.once("error", rejectListen);
    server.listen(pipePath);
  });
  return {
    pipeName,
    token,
    wait: async () => receipt,
    dispose: async () => {
      if (!settled) fail("The managed-terminal child-start receipt reservation was closed.");
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose())).catch(() => undefined);
    }
  };
}
function providerLabel(provider: ProviderDesktopId): string { return ({ claude_desktop: "Claude Desktop", chatgpt_desktop: "ChatGPT Desktop", claude_code: "Claude Code", codex: "Codex" } as const)[provider]; }
function commaList(value: string): readonly string[] { return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]; }

export interface WorkflowResultPresentation {
  readonly summary: string;
  readonly placeHolder: string;
  readonly items: readonly QuickPickItemLike[];
}

export function workflowResultPresentation(result: ExtensionWorkflowProviderResult): WorkflowResultPresentation {
  const readOnly = "Read-only protected result — selecting an item does not approve or execute it";
  switch (result.kind) {
    case "anchor": {
      const items: QuickPickItemLike[] = [{ label: "Anchor digest", description: result.anchorDigest.slice(0, 16), detail: "Automatic resume remained disabled." }];
      result.discrepancies.forEach((item, index) => items.push(workflowResultItem(`Discrepancy ${index + 1}`, "Review against accepted context", item)));
      result.questions.forEach((item, index) => items.push(workflowResultItem(`Question ${index + 1}`, "Operator answer required", item)));
      return { summary: `Re-anchor result: ${result.discrepancies.length} discrepancies and ${result.questions.length} questions; automatic resume remains disabled.`, placeHolder: readOnly, items: boundedWorkflowResultItems(items) };
    }
    case "proof": {
      const items: QuickPickItemLike[] = result.backendResults.map((backend) => workflowResultItem(`Backend: ${backend.backend}`, backend.status, `Protected backend outcome: ${backend.status}.`));
      result.verifiedClaims.forEach((claim, index) => items.push(workflowResultItem(`Verified claim ${index + 1}`, "Provider-verified", claim)));
      result.evidenceReferences.forEach((reference, index) => items.push(workflowResultItem(`Evidence ${index + 1}`, "Protected reference", reference)));
      if (!items.length) items.push(workflowResultItem("No proof evidence returned", "Incomplete protected result", "No verified claims, evidence references, or backend outcomes were present."));
      const failed = result.backendResults.filter((backend) => backend.status !== "passed").length;
      return { summary: `Proof result: ${result.verifiedClaims.length} verified claims, ${result.evidenceReferences.length} evidence references, ${failed} non-passing backends.`, placeHolder: readOnly, items: boundedWorkflowResultItems(items) };
    }
    case "decision": {
      const items: QuickPickItemLike[] = [];
      for (const decision of result.decisions) {
        for (const option of decision.options) {
          const recommended = option.id === decision.recommendationId;
          const tradeoffs = workflowResultList(option.tradeoffs, "None reported");
          const risks = workflowResultList(option.risks, "None reported");
          items.push(workflowResultItem(`${recommended ? "Recommended" : "Option"}: ${option.label}`, `${decision.decisionId} / ${option.id} / read-only`, `Tradeoffs: ${tradeoffs}. Risks: ${risks}.`));
        }
      }
      return { summary: `Decision result ${safeOverlayText(result.decisionPacketId, 96)}: ${result.decisions.length} decisions require explicit user selection.`, placeHolder: readOnly, items: boundedWorkflowResultItems(items) };
    }
    case "plan": {
      if (result.mode === "expanded") {
        const items = result.alternatives.map((alternative) => workflowResultItem(`#${String(alternative.rank).padStart(2, "0")} ${alternative.summary}`, alternative.id, `${alternative.rationale}. Risks: ${workflowResultList(alternative.risks, "None reported")}.`));
        return { summary: "Plan expansion result: exactly 15 ranked alternatives are available for review.", placeHolder: readOnly, items };
      }
      return {
        summary: `Plan execution acknowledgement ${safeOverlayText(result.acknowledgementId, 96)} is durable; execution started in ${safeOverlayText(result.executorSessionId, 96)}.`,
        placeHolder: readOnly,
        items: [workflowResultItem("Execution acknowledgement", `${result.planRevision} / ${result.executorSessionId}`, `Origin: ${result.originSessionId}. Authority: ${result.authorityId}. Plan: ${result.planDigest}.`)]
      };
    }
    case "handoff":
      return { summary: `Handoff result: package ${safeOverlayText(result.packageId, 96)} is ${result.acknowledged ? "acknowledged" : "queued"}.`, placeHolder: readOnly, items: [workflowResultItem("Handoff package", result.acknowledged ? "Acknowledged" : "Not yet acknowledged", `Recipient: ${result.recipientSessionId}.`)] };
    case "focus":
      return { summary: `Focus result delivered for ${safeOverlayText(result.selectedSessionId, 96)} with ${result.status.replace("verified_", "verified ")}.`, placeHolder: readOnly, items: [workflowResultItem("Focused managed session", result.status.replace("verified_", "verified "), `Queue cycle: ${result.queueCycleId}. Result delivered: yes.`)] };
    case "authority": {
      const items = result.acknowledgements.map((acknowledgement) => workflowResultItem(`Recipient: ${acknowledgement.recipientSessionId}`, `Grant ${acknowledgement.grantId} acknowledged`, `Exact match digest: ${acknowledgement.matchDigest}.`));
      return { summary: `Authority result: ${items.length} individualized acknowledgements were durably returned.`, placeHolder: readOnly, items };
    }
    case "voice_binding":
      return { summary: `Native voice binding ${safeOverlayText(result.bindingId, 96)} is ${result.active ? "active" : "inactive"}.`, placeHolder: readOnly, items: [workflowResultItem("Native voice binding", result.active ? "Active" : "Inactive", `Binding ID: ${result.bindingId}.`)] };
  }
}

function workflowResultItem(label: string, description?: string, detail?: string): QuickPickItemLike {
  return {
    label: safeOverlayText(label, 160),
    ...(description ? { description: safeOverlayText(description, 240) } : {}),
    ...(detail ? { detail: safeOverlayText(detail, 640) } : {})
  };
}

function workflowResultList(items: readonly string[], fallback: string): string {
  return items.length ? safeOverlayText(items.map((item) => safeOverlayText(item, 160)).join("; "), 560) : fallback;
}

function boundedWorkflowResultItems(items: readonly QuickPickItemLike[]): readonly QuickPickItemLike[] {
  if (items.length <= 512) return items;
  return [...items.slice(0, 511), workflowResultItem(`${items.length - 511} additional protected items omitted`, "Bounded UI limit", "The durable result remains stored; this read-only VS Code surface displays at most 512 entries at once.")];
}

function expectedWorkflowResultKind(action: ExtensionWorkflowAction): ExtensionWorkflowProviderResult["kind"] {
  if (action === "reanchor") return "anchor";
  if (action === "proof" || action === "proof_adversarial") return "proof";
  if (action === "option_provider" || action === "option_packet") return "decision";
  if (action === "plan_expander" || action === "plan_approval") return "plan";
  if (action === "handoff" || action === "handoff_queue" || action === "handoff_immediate") return "handoff";
  if (action === "focus_blocked_agent" || action === "focus_finished_agent") return "focus";
  if (action === "authority_refresh" || action === "authority_broadcast") return "authority";
  return "voice_binding";
}

interface PipelineFailureView { readonly name: string; readonly outcome: string; readonly summary?: string; }
interface PipelineLocalReceiptView { readonly action: string; readonly result: string; readonly completeness: string; }
interface PipelineFailureTraceView {
  readonly head: string;
  readonly selectedIndex: number;
  readonly failureCount: number;
  readonly repeatAvailable: boolean;
  readonly selectedFailure: Readonly<{ kind: "check" | "status"; name: string; state: string; conclusion?: string; summary?: string }>;
  readonly logExcerpt: string;
  readonly diagnosis: string;
}
interface PipelineStatusView {
  readonly hostedState: string;
  readonly head?: string;
  readonly localStatus: string;
  readonly failures: readonly PipelineFailureView[];
  readonly latestLocalReceipt?: PipelineLocalReceiptView;
}

function pipelineStatusView(result: ForwardedCommandResult): PipelineStatusView {
  const envelope = isRecord(result.data) ? result.data : {};
  const localEnvelope = isRecord(envelope.local) ? envelope.local : undefined;
  const hostedEnvelope = isRecord(envelope.hosted) ? envelope.hosted : undefined;
  const hosted = hostedEnvelope && isRecord(hostedEnvelope.data) ? hostedEnvelope.data : envelope;
  const localStatus = safeOverlayText(
    typeof localEnvelope?.status === "string" ? localEnvelope.status : typeof envelope.clean === "boolean" ? (envelope.clean ? "clean" : "dirty") : result.status,
    80
  );
  const hostedState = safeOverlayText(
    typeof hosted.hostedState === "string" ? hosted.hostedState : typeof hostedEnvelope?.status === "string" ? hostedEnvelope.status : "not configured",
    80
  );
  const head = typeof hosted.head === "string" && /^[a-f0-9]{40,64}$/i.test(hosted.head) ? hosted.head : undefined;
  const contexts = Array.isArray(hosted.contexts) && hosted.contexts.length <= 50 ? hosted.contexts : [];
  const failedOutcomes = new Set(["ERROR", "FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED", "STARTUP_FAILURE", "STALE"]);
  const failures: PipelineFailureView[] = [];
  for (const context of contexts) {
    if (!isRecord(context) || typeof context.name !== "string" || context.name.length > 256) continue;
    const rawOutcome = typeof context.conclusion === "string" ? context.conclusion : typeof context.state === "string" ? context.state : "UNKNOWN";
    const outcome = safeOverlayText(rawOutcome.toUpperCase(), 80);
    if (!failedOutcomes.has(outcome)) continue;
    const summary = typeof context.summary === "string" ? safeOverlayText(context.summary, 240) : undefined;
    failures.push({ name: safeOverlayText(context.name, 160), outcome, ...(summary ? { summary } : {}) });
  }
  const receipts = Array.isArray(hosted.localReceipts) && hosted.localReceipts.length <= 50 ? hosted.localReceipts : [];
  const latest = receipts.find((receipt): receipt is Record<string, unknown> => isRecord(receipt)
    && typeof receipt.action === "string" && typeof receipt.result === "string" && typeof receipt.completeness === "string");
  const latestLocalReceipt = latest ? {
    action: safeOverlayText(latest.action as string, 80),
    result: safeOverlayText(latest.result as string, 80),
    completeness: safeOverlayText(latest.completeness as string, 80)
  } : undefined;
  return { hostedState, ...(head ? { head } : {}), localStatus, failures, ...(latestLocalReceipt ? { latestLocalReceipt } : {}) };
}

function pipelineFailureTraceView(result: ForwardedCommandResult): PipelineFailureTraceView | undefined {
  const data = result.data;
  if (!isRecord(data) || typeof data.head !== "string" || !/^[a-f0-9]{40}$/i.test(data.head)
    || !Number.isSafeInteger(data.selectedIndex) || (data.selectedIndex as number) < 0
    || !Number.isSafeInteger(data.failureCount) || (data.failureCount as number) < 1 || (data.failureCount as number) > 50
    || (data.selectedIndex as number) >= (data.failureCount as number) || typeof data.repeatAvailable !== "boolean"
    || data.repeatAvailable !== ((data.failureCount as number) > 1) || !isRecord(data.selectedFailure)
    || (data.selectedFailure.kind !== "check" && data.selectedFailure.kind !== "status")
    || !pipelineTraceText(data.selectedFailure.name, 256, false) || !pipelineTraceText(data.selectedFailure.state, 64, false)
    || (data.selectedFailure.conclusion !== undefined && !pipelineTraceText(data.selectedFailure.conclusion, 64, false))
    || (data.selectedFailure.summary !== undefined && !pipelineTraceText(data.selectedFailure.summary, 4_096, true))
    || !pipelineTraceText(data.logExcerpt, 4_096, true) || !pipelineTraceText(data.diagnosis, 512, true)) return undefined;
  return {
    head: data.head,
    selectedIndex: data.selectedIndex as number,
    failureCount: data.failureCount as number,
    repeatAvailable: data.repeatAvailable,
    selectedFailure: {
      kind: data.selectedFailure.kind,
      name: data.selectedFailure.name,
      state: data.selectedFailure.state,
      ...(typeof data.selectedFailure.conclusion === "string" ? { conclusion: data.selectedFailure.conclusion } : {}),
      ...(typeof data.selectedFailure.summary === "string" ? { summary: data.selectedFailure.summary } : {})
    },
    logExcerpt: data.logExcerpt,
    diagnosis: data.diagnosis
  };
}

function pipelineTraceText(value: unknown, maximum: number, allowNewlines: boolean): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= maximum && !value.includes("\0") && (allowNewlines || !/[\r\n]/.test(value));
}

function safeOverlayText(value: string, maximum: number): string {
  return value
    .replace(/\0/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/((?:api[_-]?key|password|secret|token)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum) || "unknown";
}

function controlLabel(control: B122Control): string {
  const labels: Readonly<Record<B122Control, string>> = {
    REANCHOR: "Re-anchor", PROOF: "Proof", OPTION_PROVIDER: "Option Provider", PLAN_EXPANDER: "Plan Expander", PLAN_APPROVAL: "Plan Approval",
    HANDOFF: "Handoff", FIND_BLOCKED_AGENT: "Find Blocked Agent", FIND_FINISHED_AGENT: "Find Finished Agent", AUTHORITY_REFRESH: "Authority Refresh", COUNCIL: "Council",
    CLAUDE: "Claude", CHATGPT: "ChatGPT", VSCODE: "VS Code", TERMINAL: "Terminal", COMMIT: "Commit", GITHUB: "GitHub", COMPOUND: "Compound",
    RUN: "Run", VOICE: "Voice", PIPELINE: "Pipeline", SHIELD: "Shield", SANDBOX: "Sandbox"
  };
  return labels[control];
}

function modifierLabel(modifier: B122Modifier): string {
  return ({ normal: "Normal", shift: "Shift", alt: "Alt", shift_alt: "Shift+Alt", ctrl: "Ctrl", ctrl_shift: "Ctrl+Shift", ctrl_alt: "Ctrl+Alt", ctrl_shift_alt: "Ctrl+Shift+Alt" } as const)[modifier];
}

function expectedLocalAction(command: ChordCommand): LocalHostAction | undefined {
  const key = `${command.control}:${command.modifier}`;
  const actions: Readonly<Record<string, LocalHostAction>> = {
    "HANDOFF:shift_alt": "toggle_handoff_routing",
    "FIND_BLOCKED_AGENT:shift": "show_blocker_queue", "FIND_FINISHED_AGENT:shift": "show_done_queue",
    "CLAUDE:alt": "create_claude_terminal", "CHATGPT:alt": "create_codex_terminal",
    "VSCODE:normal": "focus_vscode", "VSCODE:shift": "new_vscode_window",
    "TERMINAL:normal": "focus_external_terminal", "TERMINAL:shift": "focus_integrated_terminal",
    "COMMIT:shift": "open_external_url",
    "GITHUB:normal": "open_external_url", "GITHUB:shift": "open_external_url", "GITHUB:alt": "open_external_url", "GITHUB:shift_alt": "open_external_url",
    "RUN:shift": "start_vscode_debug", "RUN:shift_alt": "open_external_url", "SANDBOX:normal": "configure_python_venv", "SANDBOX:shift": "configure_python_venv", "COMPOUND:alt": "open_compound_palette", "VOICE:normal": "show_voice_center", "VOICE:shift": "switch_voice_provider",
    "VOICE:shift_alt": "show_voice_session_picker", "PIPELINE:alt": "show_pipeline_failure_trace"
  };
  return actions[key];
}

function isExpectedLocalAction(command: ChordCommand, actual: LocalHostAction, expected: LocalHostAction | undefined): boolean {
  if (actual === expected) return true;
  return command.control === "GITHUB" && expected === "open_external_url" && actual === "select_github_navigation";
}

function requiresExactTarget(command: ChordCommand): boolean {
  const noTarget = new Set([
    "CLAUDE:normal", "CLAUDE:shift", "CHATGPT:normal", "CHATGPT:shift",
    "VSCODE:normal", "VSCODE:shift", "TERMINAL:normal", "VOICE:normal", "VOICE:shift"
  ]);
  return !noTarget.has(`${command.control}:${command.modifier}`);
}

function trustedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || !url.hostname) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch { return false; }
}

function gitReviewAction(command: ChordCommand): "local_commit" | "pr_upsert" | "pr_merge" | "direct_main" | undefined {
  if (command.control !== "COMMIT") return undefined;
  if (command.modifier === "normal") return "local_commit";
  if (command.modifier === "shift") return "pr_upsert";
  if (command.modifier === "alt") return "pr_merge";
  if (command.modifier === "shift_alt") return "direct_main";
  return undefined;
}

function splitReviewedPaths(value: string): readonly string[] {
  return [...new Set(value.split(",").map((path) => path.trim().replaceAll("\\", "/")).filter(Boolean))];
}

function parseCredentialScopePairs(value: string, repositoryRoot: string): readonly CredentialProvisionScope[] | undefined {
  const pairs = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (pairs.length < 1 || pairs.length > 16) return undefined;
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const scopes: CredentialProvisionScope[] = [];
  for (const pair of pairs) {
    const separator = pair.indexOf("/");
    if (separator < 1 || separator !== pair.lastIndexOf("/")) return undefined;
    const adapterId = pair.slice(0, separator);
    const purpose = pair.slice(separator + 1);
    if (!identifier.test(adapterId) || !identifier.test(purpose)) return undefined;
    scopes.push({ repositoryRoot, adapterId, purpose });
  }
  const identities = scopes.map((scope) => `${normalizePath(scope.repositoryRoot)}\0${scope.adapterId}\0${scope.purpose}`);
  return new Set(identities).size === identities.length ? scopes : undefined;
}

function normalizePath(value: string): string { return value.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase(); }

function validBranchInput(value: string): string | undefined {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) && !value.includes("..") && !value.endsWith("/") ? undefined : "Enter a valid exact branch name.";
}

function parseUint16Text(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^(?:0x[a-f0-9]{1,4}|[0-9]{1,5})$/i.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, trimmed.toLowerCase().startsWith("0x") ? 16 : 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffff ? parsed : undefined;
}
function validateUint16Text(value: string): string | undefined { return parseUint16Text(value) === undefined ? "Enter a uint16 in decimal or 0x-prefixed hexadecimal." : undefined; }
function formatUint16(value: number): string { return value.toString(16).padStart(4, "0"); }

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => { hash.update(chunk); });
    stream.once("error", rejectHash);
    stream.once("end", resolveHash);
  });
  return hash.digest("hex");
}

async function exactFilesystemIdentity(path: string): Promise<Readonly<{ device: string; inode: string }>> {
  const identity = await stat(path, { bigint: true });
  const device = identity.dev.toString(10);
  const inode = identity.ino.toString(10);
  if (!/^(?:0|[1-9][0-9]{0,19})$/.test(device) || !/^(?:0|[1-9][0-9]{0,19})$/.test(inode)
    || identity.dev > 18_446_744_073_709_551_615n || identity.ino > 18_446_744_073_709_551_615n) {
    throw new Error("The filesystem returned an invalid exact device/inode identity.");
  }
  return { device, inode };
}

function sameRootList(left: readonly string[], right: readonly string[]): boolean {
  return left.length > 0 && left.length === right.length && left.every((root, index) => samePath(root, right[index]!));
}

function parseChordArgument(value: unknown): ChordCommand | undefined {
  if (!isRecord(value) || !isControl(value.control) || !isModifier(value.modifier)) return undefined;
  return chordFor(value.control, value.modifier);
}

function parseInputArgument(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value) || !isRecord(value.input)) return undefined;
  const input: Record<string, string> = {};
  for (const [key, item] of Object.entries(value.input)) {
    if (typeof item === "string" && /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) && item.length <= 512) input[key] = item;
  }
  return input;
}

function parseProviderArgument(value: unknown): Exclude<ExtensionProvider, "voice"> | undefined {
  if (!isRecord(value)) return undefined;
  return value.provider === "claude" || value.provider === "codex" || value.provider === "generic" ? value.provider : undefined;
}

function isControl(value: unknown): value is B122Control {
  return typeof value === "string" && [
    "REANCHOR", "PROOF", "OPTION_PROVIDER", "PLAN_EXPANDER", "PLAN_APPROVAL", "HANDOFF", "FIND_BLOCKED_AGENT", "FIND_FINISHED_AGENT", "AUTHORITY_REFRESH", "COUNCIL",
    "CLAUDE", "CHATGPT", "VSCODE", "TERMINAL", "COMMIT", "GITHUB", "COMPOUND", "RUN", "VOICE", "PIPELINE", "SHIELD", "SANDBOX"
  ].includes(value);
}

function isModifier(value: unknown): value is B122Modifier {
  return typeof value === "string" && ["normal", "shift", "alt", "shift_alt", "ctrl", "ctrl_shift", "ctrl_alt", "ctrl_shift_alt"].includes(value);
}

function isDebugConfiguration(value: unknown): value is DebugConfigurationLike {
  return isRecord(value) && (value.name === undefined || typeof value.name === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
