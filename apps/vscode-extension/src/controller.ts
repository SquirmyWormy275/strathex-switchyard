import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createReadStream, readFileSync } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { chordCommands, chordFor, type B122Control, type B122Modifier, type ChordCommand } from "./commands.ts";
import { codexLocalThreadItems, operatorSessionItems, type CodexLocalThreadObservation } from "./operator-status.ts";
import { commandFor } from "../../../packages/control-plane/src/command-catalog.ts";
import { authorityBroadcastReviewScopeDigest, type WorkflowArtifact } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import {
  forwardedHostAction,
  forwardedWorkflowOutcome,
  type ExtensionCompanionBridge,
  type ContainmentInspectionSummary,
  type ExtensionCapability,
  type ExtensionManagedSession,
  type ExtensionProvider,
  type ExtensionReanchorAuthority,
  type ExtensionReanchorStatus,
  type ExtensionHandoffPackage,
  type ExtensionWorkflowAction,
  type ExtensionWorkflowArtifact,
  type ExtensionWorkflowPreparationIntent,
  type ExtensionWorkflowProviderResult,
  type ExtensionVoiceBinding,
  type ExtensionVoiceProvider,
  type ExtensionHostActionClaim,
  type HostActionClaimReference,
  type CredentialProvisionScope,
  type HardwareSignalClaim,
  type ForwardedCommand,
  type ForwardedCommandResult,
  type ForwardedHostAction,
  type ForwardedHostActionAuthorization,
  type LocalHostAction,
  type ManagedTerminalProfileSummary,
  type RepositoryExecutableIdentitySummary,
  type AutomationManifestAction,
  type AutomationManifestReview,
  type DebugStopReview,
  type PlanApprovalWorkflowReview,
  type ProviderDesktopId,
  type ReviewedGitMutation
} from "./companion-bridge.ts";
import type {
  DebugConfigurationLike,
  DebugSessionLike,
  DisposableLike,
  ExtensionContextLike,
  QuickPickItemLike,
  TerminalLike,
  VscodeLike
} from "./vscode-like.ts";

const acceptedExtensionPackageNames = new Set([
  "@strathex/switchyard-vscode",
  "strathex-switchyard-b122"
]);

/** Validate the reviewed source identity or the release builder's VSIX name. */
export function exactExtensionPackageVersion(extensionPath: string): string {
  if (typeof extensionPath !== "string" || !isAbsolute(extensionPath)) {
    throw new Error("The installed SXSY-B122 VS Code package root is invalid.");
  }
  let packageJson: { readonly name?: unknown; readonly publisher?: unknown; readonly main?: unknown; readonly version?: unknown };
  try {
    packageJson = JSON.parse(readFileSync(join(extensionPath, "package.json"), "utf8")) as typeof packageJson;
  } catch {
    throw new Error("The installed SXSY-B122 VS Code package identity is unreadable.");
  }
  if (
    typeof packageJson.name !== "string"
    || !acceptedExtensionPackageNames.has(packageJson.name)
    || packageJson.publisher !== "SquirmyWormy275"
    || packageJson.main !== "./dist/apps/vscode-extension/src/extension.js"
    || typeof packageJson.version !== "string"
    || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(packageJson.version)
  ) {
    throw new Error("The installed SXSY-B122 VS Code package identity is invalid.");
  }
  return packageJson.version;
}

const windowStateKey = "sxsy-b122.managedWindow";
const selectedTargetStateKey = "sxsy-b122.selectedGitTarget";
const voiceRepeatStateKey = "sxsy-b122.voiceRepeat";
const debugBindingStateKey = "sxsy-b122.debugBindings.v1";
const highConsequenceActions = ["council_automatic", "pr_merge", "direct_main", "lfg", "repair_mission", "emergency_containment", "full_sandbox", "rebuild_full_sandbox", "quarantine", "containment_release"] as const;
const providerDesktopIds = ["claude_desktop", "chatgpt_desktop", "claude_code", "codex"] as const satisfies readonly ProviderDesktopId[];
const extensionHostActionCapabilities = ["show_voice_center"] as const;

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

interface StoredDebugBinding {
  readonly version: 1;
  readonly bindingId: string;
  readonly originOperationId: string;
  readonly originSessionId: string;
  readonly workspaceRoot: string;
  readonly configuration: string;
  readonly targetSnapshotId?: string;
  readonly startedAt: string;
  readonly status: "starting" | "running" | "stopping";
  readonly debugSessionId?: string;
  readonly managedSessionId?: string;
}

interface ManagedStopSelection {
  readonly effectKind: "debug_session" | "managed_run";
  readonly effect: ExtensionManagedSession;
  readonly origin: ExtensionManagedSession;
  readonly originOperationId: string;
  readonly workspaceRoot: string;
  readonly binding?: StoredDebugBinding;
  readonly debugSessionId?: string;
  readonly debugBindingId?: string;
  readonly debugConfiguration?: string;
  readonly managedProcessId?: string;
}

interface PendingDebugStart {
  readonly bindingId: string;
  readonly promise: Promise<StoredDebugBinding>;
  resolve(binding: StoredDebugBinding): void;
  reject(error: Error): void;
}

interface PendingDebugStop {
  readonly debugSessionId: string;
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

export interface ManagedSessionControllerOptions {
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly extensionVersion?: string;
  /** Optional built-in Git adapter; an absent adapter is recorded as unknown. */
  readonly resolveGitRoots?: () => Promise<readonly GitRootRegistration[]>;
  /** Optional read-only local Codex daemon observation; never changes companion capability. */
  readonly observeCodexThreads?: () => Promise<readonly CodexLocalThreadObservation[]>;
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
  /** Bound for observing the exact VS Code debug start/termination event. */
  readonly debugLifecycleTimeoutMs?: number;
  /** Bounded poll for extension-owned durable host actions such as Voice Center. */
  readonly hostActionPollIntervalMs?: number;
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

interface ProviderSelectionRequirement {
  readonly capabilities: readonly ExtensionCapability[];
  readonly statuses: readonly ExtensionManagedSession["status"][];
}

interface ProviderSelectionBinding {
  readonly id: string;
  readonly provider: "claude" | "codex";
  readonly status: ExtensionManagedSession["status"];
  readonly workspaceRoot: string;
  readonly targetSnapshotId: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  readonly capabilities: readonly ExtensionCapability[];
  readonly adapterVersion: string;
  readonly handshake: string;
  readonly handshakeTarget: string;
}

interface AuthorityPacketReview {
  readonly recipientSessionId: string;
  readonly grantId: string;
  readonly matchDigest: string;
  readonly expiresAt: string;
  readonly pendingRequest: Readonly<{ requestId: string; targetSnapshotId: string; planRevision: string; planDigest: string; action: string }>;
  readonly provider: "claude" | "codex";
  readonly taskId: string;
  readonly planRevision: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly adapterVersion: string;
  readonly bindingDigest: string;
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
  private readonly observeCodexThreads: () => Promise<readonly CodexLocalThreadObservation[]>;
  private readonly openExternal: (url: string) => Promise<boolean>;
  private readonly executeCommand: (command: string) => Promise<void>;
  private readonly sealSecret?: (cleartext: Uint8Array) => Promise<string>;
  private readonly heartbeatIntervalMs: number;
  private readonly managedTerminalHealthMs: number;
  private readonly managedTerminalReceiptFactory: ManagedTerminalReceiptFactory;
  private readonly repeatWindowMs: number;
  private readonly debugLifecycleTimeoutMs: number;
  private readonly hostActionPollIntervalMs: number;
  private readonly terminalRecords = new WeakMap<TerminalLike, TrackedTerminal>();
  private readonly closedTerminals = new WeakSet<TerminalLike>();
  private readonly terminalBySessionId = new Map<string, TrackedTerminal>();
  private readonly debugSessionIds = new WeakMap<DebugSessionLike, string>();
  private readonly debugSessionObjects = new Map<string, DebugSessionLike>();
  private readonly debugBindings = new Map<string, StoredDebugBinding>();
  private readonly pendingDebugStarts = new Map<string, PendingDebugStart>();
  private readonly pendingDebugStops = new Map<string, PendingDebugStop>();
  private readonly sessions = new Map<string, ExtensionManagedSession>();
  private started = false;
  private windowSessionId?: string;
  private gitRoots: readonly GitRootRegistration[] = [];
  private rawBridge: ExtensionCompanionBridge;
  private bridge: ExtensionCompanionBridge;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private hardwareSignalTimer?: ReturnType<typeof setTimeout>;
  private hardwareSignalInFlight = false;
  private hardwareSignalTask?: Promise<void>;
  private hostActionTimer?: ReturnType<typeof setTimeout>;
  private hostActionInFlight = false;
  private hostActionTask?: Promise<void>;
  private hostActionClaimTail: Promise<void> = Promise.resolve();
  private voiceCommandInFlight = 0;
  private sessionHeartbeatTimer?: ReturnType<typeof setTimeout>;
  private sessionHeartbeatInFlight = false;
  private sessionHeartbeatTask?: Promise<void>;
  private startTask?: Promise<void>;
  private reconnectTask?: Promise<boolean>;
  private lifecycleGeneration = 0;
  private acceptingAdmissions = false;
  private readonly admissionContext = new AsyncLocalStorage<number>();
  private readonly admittedTasks = new Set<Promise<unknown>>();
  private readonly lifecycleDisposables: DisposableLike[] = [];
  private readonly observedNotificationStatus = new Map<string, ExtensionManagedSession["status"]>();
  private readonly deferredHostCommands = new Map<string, string>();
  /** One terminal settlement attempt per claimed physical signal, including exceptional exits. */
  private readonly hardwareTerminalAttempts = new Set<string>();

  constructor(vscode: VscodeLike, context: ExtensionContextLike, bridge: ExtensionCompanionBridge, options: ManagedSessionControllerOptions = {}) {
    this.vscode = vscode;
    this.context = context;
    this.rawBridge = bridge;
    this.bridge = this.guardBridge(bridge);
    this.now = options.now ?? (() => new Date().toISOString());
    let counter = 0;
    this.idFactory = options.idFactory ?? (() => `vscode-${Date.now().toString(36)}-${++counter}`);
    this.extensionVersion = boundedAdapterVersion(options.extensionVersion ?? "unpackaged-test");
    this.resolveGitRoots = options.resolveGitRoots ?? (async () => []);
    this.observeCodexThreads = options.observeCodexThreads ?? (async () => []);
    const openExternal = options.openExternal ?? (async () => false);
    this.openExternal = async (url) => { this.assertAdmissionActive(); return openExternal(url); };
    const executeCommand = options.executeCommand ?? (async (command: string) => {
      if (!this.vscode.commands.executeCommand) throw new Error("The VS Code host command boundary is unavailable.");
      await this.vscode.commands.executeCommand(command);
    });
    this.executeCommand = async (command) => { this.assertAdmissionActive(); await executeCommand(command); };
    this.sealSecret = options.sealSecret ? async (cleartext) => { this.assertAdmissionActive(); return options.sealSecret!(cleartext); } : undefined;
    this.heartbeatIntervalMs = boundedHeartbeatInterval(options.heartbeatIntervalMs ?? 30_000);
    this.managedTerminalHealthMs = boundedManagedTerminalHealth(options.managedTerminalHealthMs ?? 500);
    this.managedTerminalReceiptFactory = options.managedTerminalReceiptFactory ?? reserveManagedTerminalReceipt;
    this.repeatWindowMs = boundedRepeatWindow(options.repeatWindowMs ?? 1_500);
    this.debugLifecycleTimeoutMs = boundedDebugLifecycleTimeout(options.debugLifecycleTimeoutMs ?? 5_000);
    this.hostActionPollIntervalMs = boundedHostActionPollInterval(options.hostActionPollIntervalMs ?? 250);
  }

  /** Allows a reviewed local transport to be attached after activation. */
  attachBridge(bridge: ExtensionCompanionBridge): void {
    this.rawBridge = bridge;
    this.bridge = this.guardBridge(bridge);
    this.scheduleReconnect(0);
  }

  async stop(): Promise<void> {
    this.acceptingAdmissions = false;
    this.started = false;
    this.lifecycleGeneration += 1;
    for (const disposable of this.lifecycleDisposables.splice(0)) {
      try { disposable.dispose(); } catch { /* disposal is best effort; the generation fence is authoritative */ }
    }
    this.stopReconnect();
    if (this.sessionHeartbeatTimer) clearTimeout(this.sessionHeartbeatTimer);
    this.sessionHeartbeatTimer = undefined;
    if (this.hardwareSignalTimer) clearTimeout(this.hardwareSignalTimer);
    this.hardwareSignalTimer = undefined;
    if (this.hostActionTimer) clearTimeout(this.hostActionTimer);
    this.hostActionTimer = undefined;
    for (const pending of this.pendingDebugStarts.values()) pending.reject(new Error("VS Code deactivated before the exact debug start event settled."));
    for (const pending of this.pendingDebugStops.values()) pending.reject(new Error("VS Code deactivated before the exact debug termination event settled."));
    const tasks: Promise<unknown>[] = [];
    for (const task of [this.startTask, this.reconnectTask, this.sessionHeartbeatTask, this.hardwareSignalTask, this.hostActionTask, ...this.admittedTasks]) if (task) tasks.push(task);
    await Promise.allSettled(tasks);
  }

  start(): Promise<void> {
    if (this.started) return this.startTask ?? Promise.resolve();
    this.started = true;
    this.acceptingAdmissions = true;
    this.lifecycleGeneration += 1;
    const generation = this.lifecycleGeneration;
    this.registerCommands();
    this.ownLifecycleDisposables(
      this.vscode.window.onDidOpenTerminal((terminal) => this.scheduleLifecycleEvent((admittedGeneration) => this.registerTerminal(terminal, admittedGeneration))),
      this.vscode.window.onDidCloseTerminal((terminal) => this.scheduleLifecycleEvent((admittedGeneration) => { this.closedTerminals.add(terminal); return this.markTerminalClosed(terminal, admittedGeneration); })),
      this.vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleLifecycleEvent((admittedGeneration) => this.refreshWorkspaceRegistration(admittedGeneration).then(() => undefined))),
      this.vscode.debug.onDidStartDebugSession((session) => this.scheduleLifecycleEvent((admittedGeneration) => this.registerDebugSession(session, admittedGeneration))),
      this.vscode.debug.onDidTerminateDebugSession((session) => this.scheduleLifecycleEvent((admittedGeneration) => this.markDebugSessionEnded(session, admittedGeneration))),
      this.vscode.window.onDidChangeWindowState((state) => {
        if (!this.started || !this.acceptingAdmissions) return;
        if (state.focused) { this.scheduleHardwareSignalPoll(0); this.scheduleHostActionPoll(0); }
        else {
          if (this.hardwareSignalTimer) { clearTimeout(this.hardwareSignalTimer); this.hardwareSignalTimer = undefined; }
          if (this.hostActionTimer) { clearTimeout(this.hostActionTimer); this.hostActionTimer = undefined; }
        }
      })
    );

    const task = this.runInGeneration(generation, () => this.initializeStartedGeneration(generation));
    this.startTask = task;
    const clear = () => { if (this.startTask === task) this.startTask = undefined; };
    void task.then(clear, clear);
    return task;
  }

  private async initializeStartedGeneration(generation: number): Promise<void> {
    await this.refreshWorkspaceRegistration(generation);
    if (!this.isActiveGeneration(generation)) return;
    for (const terminal of this.vscode.window.terminals) {
      await this.registerTerminal(terminal, generation);
      if (!this.isActiveGeneration(generation)) return;
    }
    await this.registerDebugConfigurations(generation);
    if (!this.isActiveGeneration(generation)) return;
    await this.recoverDebugBindings(generation);
    if (!this.isActiveGeneration(generation)) return;
    await this.refreshSessionNotifications(generation);
    if (!this.isActiveGeneration(generation)) return;
    this.scheduleSessionHeartbeat();
    this.scheduleHardwareSignalPoll(0);
    this.scheduleHostActionPoll(0);
  }

  private isActiveGeneration(generation: number): boolean {
    return this.started && this.acceptingAdmissions && this.lifecycleGeneration === generation;
  }

  private assertAdmissionActive(): void {
    const generation = this.admissionContext.getStore();
    if (generation !== undefined && !this.isActiveGeneration(generation)) throw new Error("The SXSY-B122 extension lifecycle stopped before this effect boundary.");
  }

  private runInGeneration<T>(generation: number, work: () => Promise<T>): Promise<T> {
    return this.admissionContext.run(generation, async () => { this.assertAdmissionActive(); return work(); });
  }

  private admitLifecycleTask<T>(work: (generation: number) => Promise<T>): Promise<T> {
    const generation = this.lifecycleGeneration;
    if (!this.isActiveGeneration(generation)) return Promise.reject(new Error("The SXSY-B122 extension is stopping and cannot admit another operation."));
    const task = Promise.resolve().then(() => this.runInGeneration(generation, () => work(generation)));
    this.admittedTasks.add(task);
    const clear = () => { this.admittedTasks.delete(task); };
    void task.then(clear, clear);
    return task;
  }

  private ownLifecycleDisposables(...disposables: DisposableLike[]): void {
    this.lifecycleDisposables.push(...disposables);
    this.context.subscriptions.push(...disposables);
  }

  private scheduleLifecycleEvent(work: (generation: number) => Promise<unknown>): Promise<void> {
    return this.admitLifecycleTask(work).then(() => undefined, () => undefined);
  }

  private registerAdmittedCommand(command: string, callback: (argument: unknown, generation: number) => Promise<void>): DisposableLike {
    return this.vscode.commands.registerCommand(command, (argument: unknown) => this.admitLifecycleTask((generation) => callback(argument, generation)));
  }

  private guardBridge(bridge: ExtensionCompanionBridge): ExtensionCompanionBridge {
    return new Proxy(bridge, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== "function") return value;
        return (...args: readonly unknown[]) => { this.assertAdmissionActive(); return Reflect.apply(value, target, args); };
      }
    }) as ExtensionCompanionBridge;
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
    this.ownLifecycleDisposables(
      this.registerAdmittedCommand("sxsy-b122.registerManagedSession", async () => {
        await this.refreshWorkspaceRegistration();
        await this.vscode.window.showInformationMessage("SXSY-B122 refreshed this VS Code window's Registered session record. Registered is not Mediated.");
      }),
      this.registerAdmittedCommand("sxsy-b122.adoptTerminal", async (argument: unknown) => {
        await this.adoptTerminal(argument);
      }),
      this.registerAdmittedCommand("sxsy-b122.refreshManagedRegistry", async () => {
        await this.refreshWorkspaceRegistration();
        for (const terminal of this.vscode.window.terminals) await this.registerTerminal(terminal);
        await this.registerDebugConfigurations();
      }),
      this.registerAdmittedCommand("sxsy-b122.showManagedSessions", async () => {
        const [listed, codex] = await Promise.all([
          this.bridge.listSessions(),
          this.observeCodexThreads().catch(() => [] as readonly CodexLocalThreadObservation[])
        ]);
        const items = [
          ...(listed.ok ? operatorSessionItems(listed.value) : []),
          ...codexLocalThreadItems(codex)
        ];
        if (!listed.ok && !items.length) {
          await this.vscode.window.showWarningMessage(`SXSY-B122 operator status is unavailable: ${listed.message}`);
          return;
        }
        if (!items.length) {
          await this.vscode.window.showInformationMessage("SXSY-B122 has no authenticated managed sessions. Desktop windows and idle terminals are not inferred.");
          return;
        }
        await this.vscode.window.showQuickPick(items, { placeHolder: "Managed sessions and unbound local Codex runtime; selecting a row performs no action" });
      }),
      this.registerAdmittedCommand("sxsy-b122.showQuickReference", async () => {
        await this.showQuickReference();
      }),
      this.registerAdmittedCommand("sxsy-b122.connectProviderAdapter", async () => {
        await this.connectProviderAdapter();
      }),
      this.registerAdmittedCommand("sxsy-b122.installRepositoryRuntime", async () => {
        await this.installRepositoryRuntime();
      }),
      this.registerAdmittedCommand("sxsy-b122.listRepositoryRuntimes", async () => {
        await this.listRepositoryRuntimes();
      }),
      this.registerAdmittedCommand("sxsy-b122.revokeRepositoryRuntime", async () => {
        await this.revokeRepositoryRuntime();
      }),
      this.registerAdmittedCommand("sxsy-b122.installWindowsSandbox", async () => {
        await this.installWindowsSandbox();
      }),
      this.registerAdmittedCommand("sxsy-b122.listWindowsSandboxes", async () => {
        await this.listWindowsSandboxes();
      }),
      this.registerAdmittedCommand("sxsy-b122.revokeWindowsSandbox", async () => {
        await this.revokeWindowsSandbox();
      }),
      this.registerAdmittedCommand("sxsy-b122.provisionCredential", async () => { await this.provisionCredential(); }),
      this.registerAdmittedCommand("sxsy-b122.listCredentials", async () => { await this.listCredentials(); }),
      this.registerAdmittedCommand("sxsy-b122.revokeCredential", async () => { await this.revokeCredential(); }),
      this.registerAdmittedCommand("sxsy-b122.installNetworkPolicy", async () => { await this.installNetworkPolicy(); }),
      this.registerAdmittedCommand("sxsy-b122.showNetworkPolicy", async () => { await this.showNetworkPolicy(); }),
      this.registerAdmittedCommand("sxsy-b122.revokeNetworkPolicy", async () => { await this.revokeNetworkPolicy(); }),
      this.registerAdmittedCommand("sxsy-b122.manageAcceptanceEvidence", async () => { await this.manageAcceptanceEvidence(); }),
      this.registerAdmittedCommand("sxsy-b122.manageScannerFixtures", async () => { await this.manageScannerFixtures(); }),
      this.registerAdmittedCommand("sxsy-b122.manageProviderApplications", async () => { await this.manageProviderApplications(); }),
      this.registerAdmittedCommand("sxsy-b122.releaseContainment", async () => { await this.releaseContainment(); }),
      this.registerAdmittedCommand("sxsy-b122.installRawHid", async () => { await this.installRawHid(); }),
      this.registerAdmittedCommand("sxsy-b122.listRawHid", async () => { await this.listRawHid(); }),
      this.registerAdmittedCommand("sxsy-b122.showRawHidStatus", async () => { await this.showRawHidStatus(); }),
      this.registerAdmittedCommand("sxsy-b122.revokeRawHid", async () => { await this.revokeRawHid(); }),
      this.registerAdmittedCommand("sxsy-b122.dispatch", async (argument: unknown) => {
        const command = parseChordArgument(argument);
        if (!command) {
          await this.vscode.window.showWarningMessage("SXSY-B122 cannot route that command because its control or modifier is not a settled assignment.");
          return;
        }
        await this.dispatchChord(command, parseInputArgument(argument));
      }),
      // Retained for compatibility with the baseline command. It cannot turn
      // arbitrary UI text into a companion action.
      this.registerAdmittedCommand("sxsy-b122.showIntent", async (intent: unknown) => {
        const detail = typeof intent === "string" ? intent : "No canonical B122 intent was supplied.";
        await this.vscode.window.showWarningMessage(`SXSY-B122 preview: ${detail}`);
      })
    );

    for (const command of chordCommands) {
      this.ownLifecycleDisposables(this.registerAdmittedCommand(command.command, async (argument: unknown) => {
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
  async refreshSessionNotifications(generation?: number): Promise<void> {
    const listed = await this.bridge.listSessions();
    if (generation !== undefined && !this.isActiveGeneration(generation)) return;
    if (!listed.ok) return;
    const currentIds = this.reconcileCurrentSessions(listed.value);
    for (const session of listed.value) {
      const prior = this.observedNotificationStatus.get(session.id);
      this.observedNotificationStatus.set(session.id, session.status);
      if (prior === session.status) continue;
      if (session.status === "verified_blocked") {
        await this.vscode.window.showWarningMessage(`SXSY-B122: ${session.provider} session ${session.id} is Blocked and ready in the verified blocker queue.`);
      } else if (session.status === "verified_finished") {
        await this.vscode.window.showInformationMessage(`SXSY-B122: ${session.provider} session ${session.id} is Finished and ready in the verified done queue.`);
      }
      if (generation !== undefined && !this.isActiveGeneration(generation)) return;
    }
    for (const sessionId of this.observedNotificationStatus.keys()) if (!currentIds.has(sessionId)) this.observedNotificationStatus.delete(sessionId);
  }

  private reconcileCurrentSessions(current: readonly ExtensionManagedSession[]): ReadonlySet<string> {
    const currentIds = new Set(current.map((session) => session.id));
    for (const sessionId of this.sessions.keys()) if (!currentIds.has(sessionId)) this.sessions.delete(sessionId);
    for (const session of current) this.sessions.set(session.id, session);
    return currentIds;
  }

  private async showQuickReference(): Promise<void> {
    const target = this.quickReferenceTarget();
    const items = chordCommands.map((command) => {
      const policy = quickReferencePolicy(command);
      const targetDescription = policy.requiresTarget ? target : "No target required";
      return {
        label: `${quickReferenceBank(command.control)} · ${controlLabel(command.control)} · ${modifierLabel(command.modifier)} — ${command.title.replace("SXSY-B122: ", "")}`,
        description: `${targetDescription}; read-only settled assignment`,
        detail: `Consequence: ${policy.consequence}. Capability: ${policy.capability}. Gates: ${policy.gates.length ? policy.gates.join(", ") : "none"}. Confirmation: ${policy.confirmation ? "required" : "not required"}. Selecting this row never dispatches.`
      };
    });
    await this.vscode.window.showQuickPick(items, { placeHolder: `Search the read-only SXSY-B122 quick reference (${items.length} settled chords)` });
  }

  private quickReferenceTarget(): string {
    if (this.gitRoots.length === 0) return "No exact target";
    if (this.gitRoots.length === 1) return `Exact target ${this.gitRoots[0]!.gitRoot}`;
    const stored = this.context.workspaceState.get<string>(selectedTargetStateKey);
    const selected = stored ? this.sessions.get(stored) : undefined;
    return selected?.workspaceRoot && this.gitRoots.some((root) => samePath(root.gitRoot, selected.workspaceRoot!))
      ? `Exact target ${selected.workspaceRoot}`
      : `Ambiguous target (${this.gitRoots.length} open Git roots)`;
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
    const current = await this.bridge.listSessions();
    if (!current.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 provider registry unavailable: ${current.message}`); return; }
    this.reconcileCurrentSessions(current.value);
    const candidates = [...this.sessions.values()].filter((session) => (session.provider === "claude" || session.provider === "codex")
      && session.capabilities.includes("registered") && session.status !== "unreachable" && session.status !== "stale");
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
    if (!root || !input || !this.sealSecret) { if (root) await this.vscode.window.showWarningMessage("SXSY-B122 credential provisioning requires the installed host secret protector."); return; }
    const reference = await input({ prompt: "Credential reference name", value: "github-token", validateInput: (value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? undefined : "Use a bounded reference name." });
    const scopesText = reference ? await input({
      prompt: `Exact adapter/purpose scopes for ${root.gitRoot} (comma-separated)`,
      value: "configured-network/provider-api",
      validateInput: (value) => parseCredentialScopePairs(value, root.gitRoot) ? undefined : "Enter 1-16 unique adapterId/purpose pairs."
    }) : undefined;
    const scopes = scopesText ? parseCredentialScopePairs(scopesText, root.gitRoot) : undefined;
    const secretText = scopes ? await input({ prompt: "Credential value (sealed by the host before local transport)", password: true, validateInput: (value) => value.length > 0 && Buffer.byteLength(value, "utf8") <= 64 * 1024 ? undefined : "Enter a non-empty value up to 64 KiB." }) : undefined;
    if (!reference || !scopes || !secretText) return;
    const bytes = Buffer.from(secretText, "utf8");
    let sealedSecret: string;
    try { sealedSecret = await this.sealSecret(bytes); } catch { await this.vscode.window.showWarningMessage("SXSY-B122 could not seal the credential with the host secret protector; nothing was sent."); return; } finally { bytes.fill(0); }
    const existing = await this.bridge.listCredentials();
    const replaceExisting = existing.ok && existing.value.some((item) => item.reference === reference && !item.revokedAt);
    const result = await this.bridge.provisionCredential({ reference, scopes, sealedSecret, ...(replaceExisting ? { replaceExisting: true } : {}) });
    if (!result.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 credential was not provisioned: ${result.message}`);
    else await this.vscode.window.showInformationMessage(`SXSY-B122 provisioned host-sealed reference ${result.value.reference} generation ${result.value.generation} for exact scopes ${result.value.scopes.map((scope) => `${scope.repositoryRoot}=>${scope.adapterId}/${scope.purpose}`).join("; ")}.`);
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
    const root = await this.chooseGitRoot("Choose the exact Git root for this HTTPS route policy");
    if (!root) return;
    const selected = await this.vscode.window.showOpenDialog?.({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: "Review HTTPS Route Policy", filters: { "SXSY-B122 network policy": ["json"] } });
    const sourcePath = selected?.length === 1 ? selected[0]?.fsPath : undefined;
    if (!sourcePath) return;
    const result = await this.bridge.installNetworkPolicy(root.gitRoot, sourcePath);
    if (!result.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 network policy was not installed: ${result.message}`);
    else await this.vscode.window.showInformationMessage(`SXSY-B122 installed the attested exact-route HTTPS policy ${result.value.sha256.slice(0, 12)}… for ${root.gitRoot}.`);
  }

  private async showNetworkPolicy(): Promise<void> { const root = await this.chooseGitRoot("Choose the exact Git root whose HTTPS route policy should be shown"); if (!root) return; const result = await this.bridge.currentNetworkPolicy(root.gitRoot); if (!result.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 network policy registry unavailable: ${result.message}`); else await this.vscode.window.showInformationMessage(`SXSY-B122 network policy for ${root.gitRoot}: ${result.value?.status === "active" ? `active ${result.value.sha256.slice(0, 12)}…` : "no active policy"}`); }
  private async revokeNetworkPolicy(): Promise<void> { const root = await this.chooseGitRoot("Choose the exact Git root whose HTTPS route policy should be revoked"); if (!root) return; const result = await this.bridge.revokeNetworkPolicy(root.gitRoot); if (!result.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 network policy was not revoked: ${result.message}`); else await this.vscode.window.showInformationMessage(`SXSY-B122 revoked the exact-route HTTPS policy for ${root.gitRoot}.`); }

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
    const inspected = await this.bridge.inspectContainment(session.id);
    if (!inspected.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 containment inspection unavailable: ${inspected.message}`); return; }
    const containment = inspected.value;
    if (containment.sessionId !== session.id || !samePath(containment.repositoryRoot, session.workspaceRoot)) {
      await this.vscode.window.showWarningMessage("SXSY-B122 refused a containment inspection bound to a different session or repository.");
      return;
    }
    const hookSummary = containment.hookStates.map((hook) => `${hook.name}=${hook.status} (attempts ${hook.attempts})`).join("; ");
    const exposureSummary = containment.uncontrolledPaths.length ? containment.uncontrolledPaths.join(", ") : "none declared";
    const failureSummary = containment.hookFailures.length ? containment.hookFailures.join("; ") : "none";
    const assessmentSummary = containment.incident.steps.map((step) => `${step.name}=${step.result?.status ?? step.status}`).join("; ");
    const findingSummary = containment.incident.steps.flatMap((step) => step.result?.findings ?? []).map((finding) => `${finding.id} (${finding.relativePath})`).join(", ") || "none";
    await this.vscode.window.showInformationMessage(`SXSY-B122 containment inspection: active fence ${containment.fenceEpoch}, activation ${containment.activatedByOperationId}, incident ${containment.incident.status}; assessment ${assessmentSummary}; findings ${findingSummary}; hooks ${hookSummary}; hook failures ${failureSummary}; uncontrolled exposure ${exposureSummary}.`);
    if (containment.hookStates.some((hook) => hook.status !== "completed") || containment.hookFailures.length) {
      await this.vscode.window.showWarningMessage("SXSY-B122 containment release is unavailable until every exact revocation/cancellation hook is complete without a retained failure.");
      return;
    }
    if (containment.incident.status === "assessing" || containment.incident.status === "assessment_incomplete") {
      const remoteStep = containment.incident.steps.find((step) => step.name === "remote");
      const remotePending = !!remoteStep && (remoteStep.status !== "completed" || remoteStep.result?.status === "incomplete" || remoteStep.result?.status === "unavailable");
      const reassessLabel = `Reassess exact incident ${containment.incident.id}`;
      const remoteActions = remotePending ? [
        { label: "Install signed remote-evidence authority", description: "Current-user presence; reviewed purpose-scoped public-key policy only" },
        { label: "Issue offline signed remote-evidence challenge", description: "Host derives the exact current target and every configured remote endpoint" },
        { label: "Import signed remote evidence and resume exact assessment", description: "Current-user presence; exact challenge, namespace, target, and incident binding" },
        { label: "Show signed remote-evidence status", description: "List installed trust, issued challenges, and imported evidence" },
        { label: "Revoke signed remote-evidence authority", description: "Current-user presence; containment remains active" }
      ] : [];
      const choice = await this.vscode.window.showQuickPick([
        ...remoteActions,
        { label: reassessLabel, description: "Read-only local Git assessment; network and secret-value output remain disabled" }
      ], { placeHolder: remotePending ? "Remote assessment needs a signed complete-namespace offline proof" : "Containment assessment is incomplete; explicitly retry only this exact durable incident" });
      if (!choice) return;
      if (choice.label !== reassessLabel) {
        await this.manageContainmentRemoteEvidence(choice.label, session, containment);
        return;
      }
      const reassessed = await this.bridge.reassessContainment({ sessionId: session.id, expectedIncidentId: containment.incident.id, expectedIncidentDigest: containment.incidentDigest });
      if (!reassessed.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 containment reassessment unavailable: ${reassessed.message}`); return; }
      await this.vscode.window.showInformationMessage(`SXSY-B122 containment reassessment is now ${reassessed.value.incident.status}; review the exact incident again before any next step.`);
      return;
    }
    if (containment.incident.status === "remediation_required") {
      const remediated = new Set(containment.incident.receipts.flatMap((receipt) => receipt.remediatedFindingIds));
      const pending = containment.incident.steps.flatMap((step) => (step.result?.findings ?? []).filter((finding) => !remediated.has(finding.id)).map((finding) => ({ step: step.name, finding })));
      const workingTree = pending.filter((item) => item.step === "working_tree");
      if (workingTree.length) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 containment still requires exact local remediation commits for: ${workingTree.map(({ finding }) => `${finding.id} (${finding.relativePath})`).join(", ")}. Use the local-commit chord; it will request a one-time no-egress permit for only those working-tree findings.`);
        return;
      }
      const history = pending.filter((item) => item.step === "history");
      if (history.length) {
        const paths = [...new Set(history.map(({ finding }) => finding.relativePath))].sort((left, right) => left.localeCompare(right));
        const findingIds = history.map(({ finding }) => finding.id).sort((left, right) => left.localeCompare(right));
        const reviewLabel = `Prepare local branch/tag history rewrite for ${paths.length} path(s)`;
        const review = await this.vscode.window.showQuickPick([{
          label: reviewLabel,
          description: "Creates a verified external bundle; never contacts or rewrites a remote",
          detail: `This removes each exact reviewed path from every commit reachable from all local branches and tags: ${paths.join(", ")}. Invalidated annotated-tag signatures are stripped and counted.`
        }], { placeHolder: "Destructive local-history review: remote refs remain fenced and the native prompt shows the complete prepared local-ref scope" });
        if (!review || review.label !== reviewLabel) return;
        const expiresAt = new Date(Date.parse(this.now()) + 10 * 60_000).toISOString();
        const issued = await this.bridge.issueContainmentPermit({
          sessionId: session.id,
          expectedIncidentId: containment.incident.id,
          expectedIncidentDigest: containment.incidentDigest,
          action: "rewrite_local_history",
          relativePaths: paths,
          expiresAt
        });
        if (!issued.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 local-history permit unavailable: ${issued.message}`); return; }
        const finalLabel = `Rewrite local branch/tag history under permit ${issued.value.permit.id}`;
        const finalReview = await this.vscode.window.showQuickPick([{
          label: finalLabel,
          description: `Expires ${issued.value.permit.expiresAt}`,
          detail: `Exact paths ${paths.join(", ")}; findings ${findingIds.join(", ")}. Windows presence will show the host-prepared ref count, current old/new heads, stripped-signature count, and exact preview digest.`
        }], { placeHolder: "Final VS Code review before the host prepares one atomic local branch/tag transaction and asks for Windows presence" });
        if (!finalReview || finalReview.label !== finalLabel) return;
        const rewritten = await this.bridge.rewriteContainmentHistory({
          sessionId: session.id,
          expectedIncidentId: containment.incident.id,
          expectedIncidentDigest: issued.value.containment.incidentDigest,
          permitId: issued.value.permit.id,
          relativePaths: paths,
          remediatedFindingIds: findingIds
        });
        if (!rewritten.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 local-history rewrite unavailable: ${rewritten.message}`); return; }
        if (!samePath(rewritten.value.repositoryRoot, containment.repositoryRoot)) {
          await this.vscode.window.showWarningMessage("SXSY-B122 refused a local-history result bound to another repository.");
          return;
        }
        await this.vscode.window.showInformationMessage(`SXSY-B122 atomically rewrote ${rewritten.value.updatedRefs.length} reviewed local branch/tag ref(s). Current branch ${rewritten.value.branch}: ${rewritten.value.oldHead} to ${rewritten.value.newHead}. Stripped invalidated tag signatures: ${rewritten.value.strippedTagSignatures}. Recovery bundle: ${rewritten.value.backupBundlePath} (SHA-256 ${rewritten.value.backupBundleSha256}). Remote refs were not changed; review and run containment verification again.`);
        return;
      }
      const remote = pending.filter((item) => item.step === "remote");
      if (remote.length) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 remote containment findings require the signed offline remote-evidence workflow; local history controls will not alter remote refs: ${remote.map(({ finding }) => `${finding.id} (${finding.relativePath})`).join(", ")}.`);
        return;
      }
      const receiptIds = containment.incident.receipts.map((receipt) => receipt.id).sort((left, right) => left.localeCompare(right));
      const verifiedReceiptIds = [...containment.incident.assessment.basedOnReceiptIds].sort((left, right) => left.localeCompare(right));
      const needsPostRemediationVerification = receiptIds.length > 0
        && (containment.incident.assessment.purpose !== "post_remediation"
          || receiptIds.length !== verifiedReceiptIds.length
          || receiptIds.some((id, index) => id !== verifiedReceiptIds[index]));
      if (needsPostRemediationVerification) {
        const label = `Verify remediation for ${containment.incident.id}`;
        const choice = await this.vscode.window.showQuickPick([{ label, description: "Start a fresh no-egress working-tree, history, and remote assessment generation" }], { placeHolder: "Receipts prove effects ran; a clean post-remediation assessment is still required" });
        if (!choice || choice.label !== label) return;
        const verified = await this.bridge.verifyContainmentRemediation({ sessionId: session.id, expectedIncidentId: containment.incident.id, expectedIncidentDigest: containment.incidentDigest });
        if (!verified.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 post-remediation verification unavailable: ${verified.message}`); return; }
        await this.vscode.window.showInformationMessage(`SXSY-B122 post-remediation assessment generation ${verified.value.incident.assessment.generation} is ${verified.value.incident.status}; review the exact incident again before any rotation or release step.`);
        return;
      }
      const credentialFinding = containment.incident.assessment.credentialRotationRequired
        || containment.incident.steps.some((step) => step.result?.findings.some((finding) => finding.credentialRelated));
      const dispositionChoice = await this.vscode.window.showQuickPick(credentialFinding
        ? [{ label: "Credential rotation completed", description: "Credential-related findings cannot be marked not-required" }]
        : [{ label: "Credential rotation completed", description: "Record externally completed rotation evidence" }, { label: "Credential rotation not required", description: "Valid only because no credential-related finding exists" }],
      { placeHolder: "Record the exact credential-rotation disposition for this incident" });
      if (!dispositionChoice) return;
      const disposition = dispositionChoice.label === "Credential rotation completed" ? "complete" as const : "not_required" as const;
      const evidenceReference = await this.vscode.window.showInputBox?.({ prompt: "Enter the bounded ticket, receipt, or review reference for this rotation disposition", validateInput: (value) => value.trim() && value.length <= 512 && !/[\r\n\0]/.test(value) ? undefined : "Enter one non-empty line of at most 512 characters." });
      if (!evidenceReference) return;
      const evidenceDigest = createHash("sha256").update(JSON.stringify({ disposition, evidenceReference: evidenceReference.trim(), incidentId: containment.incident.id }), "utf8").digest("hex");
      const review = await this.vscode.window.showQuickPick([{ label: `Record rotation review for ${containment.incident.id}`, description: disposition, detail: `Evidence digest ${evidenceDigest}` }], { placeHolder: "Final exact incident evidence review" });
      if (!review || review.label !== `Record rotation review for ${containment.incident.id}`) return;
      const recorded = await this.bridge.recordContainmentRotation({ sessionId: session.id, expectedIncidentId: containment.incident.id, expectedIncidentDigest: containment.incidentDigest, disposition, evidenceReference: evidenceReference.trim(), evidenceDigest });
      if (!recorded.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 containment rotation review unavailable: ${recorded.message}`); return; }
      await this.vscode.window.showInformationMessage(`SXSY-B122 recorded the exact incident rotation review; durable incident status is now ${recorded.value.incident.status}.`);
      return;
    }
    if (containment.incident.status !== "ready_for_release") {
      await this.vscode.window.showWarningMessage(`SXSY-B122 containment release is unavailable: durable incident ${containment.incident.id} is ${containment.incident.status}.`);
      return;
    }
    const reason = await this.vscode.window.showInputBox?.({ prompt: "Record the incident review and why containment may be released", validateInput: (value) => value.trim() && value.length <= 2_048 && !/\0/.test(value) ? undefined : "Enter a bounded non-empty incident-review reason." });
    if (!reason) return;
    const finalLabel = `Release exact containment fence ${containment.fenceEpoch}`;
    const finalConfirmation = await this.vscode.window.showQuickPick([{
      label: finalLabel,
      description: `Activation ${containment.activatedByOperationId}`,
      detail: `Incident ${containment.incident.id}; digest ${containment.incidentDigest}; hooks ${hookSummary}; uncontrolled exposure ${exposureSummary}.`
    }], { placeHolder: "Final review before the one-time current-user containment-release confirmation" });
    if (!finalConfirmation || finalConfirmation.label !== finalLabel) return;
    const result = await this.bridge.releaseContainment({
      sessionId: session.id,
      reason,
      expectedFenceEpoch: containment.fenceEpoch,
      expectedActivationOperationId: containment.activatedByOperationId,
      expectedIncidentId: containment.incident.id,
      expectedIncidentDigest: containment.incidentDigest
    });
    if (!result.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 containment release unavailable: ${result.message}`); return; }
    const show = result.value.status === "completed" ? this.vscode.window.showInformationMessage.bind(this.vscode.window) : this.vscode.window.showWarningMessage.bind(this.vscode.window);
    await show(`SXSY-B122 containment release ${result.value.status}: ${result.value.summary}`);
  }

  private async manageContainmentRemoteEvidence(action: string, session: ExtensionManagedSession, containment: ContainmentInspectionSummary): Promise<void> {
    if (action === "Install signed remote-evidence authority") {
      const sourcePath = await this.pickReviewedJson("Install reviewed remote-evidence trust policy");
      if (!sourcePath) return;
      const installed = await this.bridge.installContainmentRemoteTrust(sourcePath);
      if (!installed.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 remote-evidence authority was not installed: ${installed.message}`); return; }
      await this.vscode.window.showInformationMessage(`SXSY-B122 installed purpose-scoped remote-evidence authority ${installed.value.authorityId} (${installed.value.keyId.slice(0, 12)}…) until ${installed.value.expiresAt}.`);
      return;
    }
    if (action === "Issue offline signed remote-evidence challenge") {
      const issued = await this.bridge.issueContainmentRemoteChallenge({
        sessionId: session.id,
        expectedIncidentId: containment.incident.id,
        expectedIncidentDigest: containment.incidentDigest,
        expiresAt: new Date(Date.parse(this.now()) + 10 * 60_000).toISOString()
      });
      if (!issued.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 remote-evidence challenge was not issued: ${issued.message}`); return; }
      const endpoints = issued.value.configuredRemotes.map((remote) => `${remote.name}=${remote.canonicalIdentity}`).join("; ");
      await this.vscode.window.showInformationMessage(`SXSY-B122 wrote exact offline challenge ${issued.value.id} to ${issued.value.challengePath}. It covers ${issued.value.configuredRemotes.length} host-derived endpoint(s): ${endpoints}.`);
      return;
    }
    if (action === "Import signed remote evidence and resume exact assessment") {
      const sourcePath = await this.pickReviewedJson("Import reviewed signed remote evidence");
      if (!sourcePath) return;
      const imported = await this.bridge.importContainmentRemoteEvidence({
        sessionId: session.id,
        expectedIncidentId: containment.incident.id,
        expectedIncidentDigest: containment.incidentDigest,
        sourcePath
      });
      if (!imported.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 signed remote evidence was not imported: ${imported.message}`); return; }
      const reassessed = await this.bridge.reassessContainment({ sessionId: session.id, expectedIncidentId: containment.incident.id, expectedIncidentDigest: containment.incidentDigest });
      if (!reassessed.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 imported ${imported.value.evidenceId}, but exact assessment reconciliation remained unavailable: ${reassessed.message}`); return; }
      await this.vscode.window.showInformationMessage(`SXSY-B122 consumed signed evidence ${imported.value.evidenceId}; durable incident status is now ${reassessed.value.incident.status}. Review the incident again before release.`);
      return;
    }
    if (action === "Show signed remote-evidence status") {
      const [trust, challenges, evidence] = await Promise.all([
        this.bridge.listContainmentRemoteTrust(),
        this.bridge.listContainmentRemoteChallenges(),
        this.bridge.listContainmentRemoteEvidence()
      ]);
      if (!trust.ok || !challenges.ok || !evidence.ok) {
        const message = !trust.ok ? trust.message : !challenges.ok ? challenges.message : !evidence.ok ? evidence.message : "unknown status error";
        await this.vscode.window.showWarningMessage(`SXSY-B122 remote-evidence status unavailable: ${message}`);
        return;
      }
      await this.vscode.window.showInformationMessage(`SXSY-B122 remote evidence: trust ${trust.value.map((item) => `${item.authorityId}:${item.status}`).join(", ") || "none"}; challenges ${challenges.value.map((item) => `${item.id}:${item.status}`).join(", ") || "none"}; evidence ${evidence.value.map((item) => `${item.evidenceId}:${item.status}`).join(", ") || "none"}.`);
      return;
    }
    if (action === "Revoke signed remote-evidence authority") {
      const listed = await this.bridge.listContainmentRemoteTrust();
      if (!listed.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 remote-evidence trust registry unavailable: ${listed.message}`); return; }
      const active = listed.value.filter((item) => item.status === "active");
      const selected = await this.vscode.window.showQuickPick(active.map((item) => ({ label: item.authorityId, description: item.keyId, detail: `Expires ${item.expiresAt}` })), { placeHolder: "Choose the exact active remote-evidence authority to revoke" });
      if (!selected) return;
      const trust = active.find((item) => item.authorityId === selected.label && item.keyId === selected.description);
      if (!trust) { await this.vscode.window.showWarningMessage("SXSY-B122 refused a changed remote-evidence authority selection."); return; }
      const reason = await this.vscode.window.showInputBox?.({ prompt: "Record why this remote-evidence authority is being revoked", validateInput: (value) => value.trim() && value.length <= 512 && !/[\r\n\0]/.test(value) ? undefined : "Enter one non-empty line of at most 512 characters." });
      if (!reason) return;
      const revoked = await this.bridge.revokeContainmentRemoteTrust(trust.authorityId, trust.keyId, reason.trim());
      if (!revoked.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 remote-evidence authority was not revoked: ${revoked.message}`); return; }
      await this.vscode.window.showInformationMessage(`SXSY-B122 revoked remote-evidence authority ${revoked.value.authorityId}; containment remains active.`);
    }
  }

  private async refreshWorkspaceRegistration(generation = this.lifecycleGeneration): Promise<boolean> {
    const gitRoots = await this.resolveGitRoots();
    if (!this.isActiveGeneration(generation)) return false;
    this.gitRoots = gitRoots;
    const stored = this.context.workspaceState.get<StoredWindowState>(windowStateKey);
    const sessionId = this.windowSessionId ?? stored?.id ?? this.idFactory();
    this.windowSessionId = sessionId;
    const session = this.makeSession(sessionId, "generic", "vscode_window", "unknown", {
      "sxsy-b122.kind": "window",
      "sxsy-b122.extensionVersion": this.extensionVersion,
      "sxsy-b122.hostActionCapabilities": JSON.stringify(extensionHostActionCapabilities),
      "sxsy-b122.workspaceRoots": JSON.stringify(this.workspaceRoots()),
      "sxsy-b122.gitRootCount": String(this.gitRoots.length),
      "sxsy-b122.gitRoots": this.gitRoots.length ? "registered separately" : "unavailable"
    });
    const result = await this.bridge.registerSession(session);
    if (!this.isActiveGeneration(generation)) return false;
    const registered = result.ok ? result.value : session;
    this.sessions.set(sessionId, registered);
    await this.context.workspaceState.update(windowStateKey, {
      id: sessionId,
      lifecycle: result.ok ? "registered" : "pending_companion",
      workspaceRoots: this.workspaceRoots(),
      updatedAt: this.now()
    } satisfies StoredWindowState);
    if (!this.isActiveGeneration(generation)) return false;
    if (result.ok) this.stopReconnect(); else this.scheduleReconnect();
    await this.registerGitRootSessions(generation);
    return result.ok && this.isActiveGeneration(generation);
  }

  private scheduleReconnect(delayMs = 1_000): void {
    if (!this.started || this.reconnectTimer || this.reconnectTask) return;
    const generation = this.lifecycleGeneration;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.isActiveGeneration(generation)) return;
      const task = this.reconnectGeneration(generation);
      this.reconnectTask = task;
      const clear = () => { if (this.reconnectTask === task) this.reconnectTask = undefined; };
      void task.then(
        (connected) => { clear(); if (this.isActiveGeneration(generation) && !connected) this.scheduleReconnect(); },
        () => { clear(); if (this.isActiveGeneration(generation)) this.scheduleReconnect(); }
      );
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private async reconnectGeneration(generation: number): Promise<boolean> {
    try {
      const health = await this.bridge.health();
      if (!this.isActiveGeneration(generation)) return false;
      return health.ok ? this.refreshWorkspaceRegistration(generation) : false;
    } catch {
      // The reviewed reconnect loop treats transport failures as unavailable.
      return false;
    }
  }

  private async registerGitRootSessions(generation?: number): Promise<void> {
    const windowId = this.windowSessionId;
    if (!windowId) return;
    for (const [index, root] of this.gitRoots.entries()) {
      if (generation !== undefined && !this.isActiveGeneration(generation)) return;
      const id = `${windowId}:git-root:${index}`;
      const session = this.makeSession(id, "generic", "vscode_window", "unknown", {
        "sxsy-b122.kind": "git-root",
        "sxsy-b122.gitRoot": root.gitRoot,
        "sxsy-b122.branch": root.branch ?? "unknown",
        "sxsy-b122.worktree": root.worktree ?? root.gitRoot,
        "sxsy-b122.canonicalRemote": root.canonicalRemote ?? "unknown"
      }, root.gitRoot);
      const result = await this.bridge.registerSession(session);
      if (generation !== undefined && !this.isActiveGeneration(generation)) return;
      this.sessions.set(id, result.ok ? result.value : session);
    }
  }

  private async registerTerminal(terminal: TerminalLike, generation?: number, workspaceRootOverride?: string): Promise<TrackedTerminal> {
    const known = this.terminalRecords.get(terminal);
    if (known) {
      if (workspaceRootOverride && (!known.session.workspaceRoot || !samePath(known.session.workspaceRoot, workspaceRootOverride))) {
        throw new Error("The existing terminal registration is not bound to the requested exact workspace root.");
      }
      return known;
    }
    const sessionId = this.idFactory();
    const adoptionKey = `terminal:${sessionId}`;
    const session = this.makeSession(sessionId, "generic", "vscode_terminal", "unknown", {
      "sxsy-b122.kind": "terminal",
      "sxsy-b122.terminalName": terminal.name,
      "sxsy-b122.adoptionKey": adoptionKey
    }, workspaceRootOverride);
    const result = await this.bridge.registerSession(session, "terminal");
    const record: TrackedTerminal = {
      sessionId,
      adoptionKey,
      adopted: false,
      session: result.ok ? result.value : session
    };
    if (generation !== undefined && !this.isActiveGeneration(generation)) return record;
    this.terminalRecords.set(terminal, record);
    this.terminalBySessionId.set(sessionId, record);
    this.sessions.set(sessionId, record.session);
    return record;
  }

  private async markTerminalClosed(terminal: TerminalLike, generation?: number): Promise<void> {
    const record = this.terminalRecords.get(terminal);
    if (!record) return;
    const closed: ExtensionManagedSession = { ...record.session, status: "unreachable", lastHeartbeat: this.now() };
    await this.bridge.updateStatus(record.sessionId, "unreachable");
    if (generation !== undefined && !this.isActiveGeneration(generation)) return;
    record.session = closed;
    this.sessions.set(record.sessionId, closed);
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

  private async registerDebugConfigurations(generation?: number): Promise<void> {
    const configurations = this.debugConfigurations();
    for (const [index, configuration] of configurations.entries()) {
      if (generation !== undefined && !this.isActiveGeneration(generation)) return;
      const name = configuration.name ?? `configuration-${index + 1}`;
      const sessionId = `${this.windowSessionId ?? "vscode"}:debug-configuration:${index}`;
      if (this.sessions.has(sessionId)) continue;
      const session = this.makeSession(sessionId, "generic", "vscode_window", "unknown", {
        "sxsy-b122.kind": "debug-configuration",
        "sxsy-b122.debugConfiguration": name
      });
      const result = await this.bridge.registerSession(session, "debug");
      if (generation !== undefined && !this.isActiveGeneration(generation)) return;
      this.sessions.set(sessionId, result.ok ? result.value : session);
    }
  }

  private async registerDebugSession(debugSession: DebugSessionLike, generation?: number): Promise<void> {
    const binding = this.bindingForDebugSession(debugSession);
    const sessionId = binding?.managedSessionId ?? this.debugSessionIds.get(debugSession) ?? `${this.windowSessionId ?? "vscode"}:debug-session:${debugSession.id ?? this.idFactory()}`;
    let session = this.makeSession(sessionId, "generic", "vscode_window", "running", {
      "sxsy-b122.kind": "debug-session",
      "sxsy-b122.debugName": debugSession.name,
      "sxsy-b122.debugConfiguration": debugSession.configuration?.name ?? "unnamed",
      ...(binding ? {
        "sxsy-b122.debugSessionId": exactDebugReference(debugSession.id, "VS Code debug session ID"),
        "sxsy-b122.debugOriginOperationId": binding.originOperationId,
        "sxsy-b122.debugOriginSessionId": binding.originSessionId,
        "sxsy-b122.debugWorkspaceRoot": binding.workspaceRoot,
        "sxsy-b122.debugBindingId": binding.bindingId
      } : {})
    }, binding?.workspaceRoot ?? debugSession.workspaceFolder?.uri.fsPath);
    if (binding?.targetSnapshotId) session = { ...session, targetSnapshotId: binding.targetSnapshotId };
    const result = await this.bridge.registerSession(session, "debug");
    if (generation !== undefined && !this.isActiveGeneration(generation)) return;
    if (!result.ok && binding) {
      this.pendingDebugStarts.get(binding.bindingId)?.reject(new Error(`The exact started debug session could not be registered: ${result.message}`));
      return;
    }
    this.debugSessionIds.set(debugSession, sessionId);
    if (debugSession.id) this.debugSessionObjects.set(debugSession.id, debugSession);
    this.sessions.set(sessionId, result.ok ? result.value : session);
    if (binding && debugSession.id) {
      const running: StoredDebugBinding = { ...binding, status: "running", debugSessionId: debugSession.id, managedSessionId: sessionId };
      this.debugBindings.set(binding.bindingId, running);
      await this.persistDebugBindings();
      this.pendingDebugStarts.get(binding.bindingId)?.resolve(running);
    }
  }

  private async markDebugSessionEnded(debugSession: DebugSessionLike, generation?: number): Promise<void> {
    const sessionId = this.debugSessionIds.get(debugSession);
    const debugSessionId = debugSession.id;
    const binding = debugSessionId ? [...this.debugBindings.values()].find((candidate) => candidate.debugSessionId === debugSessionId) : undefined;
    if (binding) {
      this.debugBindings.delete(binding.bindingId);
      await this.persistDebugBindings();
    }
    if (debugSessionId) this.debugSessionObjects.delete(debugSessionId);
    if (!sessionId) {
      if (debugSessionId) this.pendingDebugStops.get(debugSessionId)?.resolve();
      return;
    }
    const current = this.sessions.get(sessionId);
    if (!current) {
      if (debugSessionId) this.pendingDebugStops.get(debugSessionId)?.resolve();
      return;
    }
    const ended: ExtensionManagedSession = { ...current, status: "unreachable", lastHeartbeat: this.now() };
    const updated = await this.bridge.updateStatus(sessionId, "unreachable");
    if (generation !== undefined && !this.isActiveGeneration(generation)) return;
    this.sessions.set(sessionId, ended);
    if (debugSessionId) {
      if (updated.ok) this.pendingDebugStops.get(debugSessionId)?.resolve();
      else this.pendingDebugStops.get(debugSessionId)?.reject(new Error(`The exact debug session ended, but its durable managed-session status was not reconciled: ${updated.message}`));
    }
  }

  private bindingForDebugSession(debugSession: DebugSessionLike): StoredDebugBinding | undefined {
    const debugSessionId = debugSession.id;
    if (debugSessionId) {
      const exact = [...this.debugBindings.values()].find((candidate) => candidate.debugSessionId === debugSessionId);
      if (exact) return exact;
    }
    const configuration = debugSession.configuration?.name;
    const workspaceRoot = debugSession.workspaceFolder?.uri.fsPath;
    if (!configuration || !workspaceRoot) return undefined;
    const candidates = [...this.debugBindings.values()].filter((candidate) => candidate.status === "starting"
      && candidate.configuration === configuration && samePath(candidate.workspaceRoot, workspaceRoot));
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  private async persistDebugBindings(): Promise<void> {
    const records = [...this.debugBindings.values()];
    if (records.length > 64 || records.some((record) => !isStoredDebugBinding(record))) throw new Error("The durable VS Code debug-binding registry is malformed or unbounded.");
    await (this.context.globalState ?? this.context.workspaceState).update(debugBindingStateKey, records);
  }

  private async recoverDebugBindings(generation: number): Promise<void> {
    const raw = (this.context.globalState ?? this.context.workspaceState).get<unknown>(debugBindingStateKey);
    if (raw === undefined) return;
    if (!Array.isArray(raw) || raw.length > 64 || !raw.every(isStoredDebugBinding)) {
      await this.vscode.window.showWarningMessage("SXSY-B122 ignored a malformed durable debug-binding registry; no debug session was stopped or adopted.");
      return;
    }
    for (const binding of raw) this.debugBindings.set(binding.bindingId, binding);
    const active = this.vscode.debug.activeDebugSession;
    if (!active || !this.isActiveGeneration(generation)) return;
    const binding = this.bindingForDebugSession(active);
    if (!binding) return;
    await this.registerDebugSession(active, generation);
  }

  /** Physical claims use this exact UI/policy path; only the bridge call differs. */
  async dispatchChord(command: ChordCommand, input?: Readonly<Record<string, string>>, hardwareClaim?: HardwareSignalClaim): Promise<void> {
    const execute = async (): Promise<void> => {
      if (!hardwareClaim) return this.dispatchChordCore(command, input);
      this.hardwareTerminalAttempts.delete(hardwareClaim.signalId);
      try {
        await this.dispatchChordCore(command, input, hardwareClaim);
      } catch (error) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 physical dispatch stopped unexpectedly: ${error instanceof Error ? error.message : "unknown extension failure"}`);
      } finally {
        if (!this.hardwareTerminalAttempts.has(hardwareClaim.signalId)) {
          await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", "The claimed physical command exited without a canonical second-phase disposition; reconciliation is required before replay.");
        }
        this.hardwareTerminalAttempts.delete(hardwareClaim.signalId);
      }
    };
    if (command.control !== "VOICE") return execute();
    this.voiceCommandInFlight += 1;
    try { await execute(); }
    finally {
      this.voiceCommandInFlight -= 1;
      if (this.started && this.vscode.window.state.focused) this.scheduleHostActionPoll(0);
    }
  }

  private async dispatchChordCore(command: ChordCommand, input?: Readonly<Record<string, string>>, hardwareClaim?: HardwareSignalClaim): Promise<void> {
    const selectedEffectSession = await this.resolveDispatchSession(command);
    if (selectedEffectSession === null) {
      await this.vscode.window.showWarningMessage("SXSY-B122 stopped because no exact managed target was selected.");
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "No exact managed target was selected; no preparation or dispatch request was sent.");
      return;
    }
    const providerRequirement = providerSelectionRequirement(command);
    const providerSourceSessionId = selectedEffectSession ? this.providerSourceSessionId(command, selectedEffectSession) : undefined;
    const debugEffectSessionId = command.control === "RUN" && command.modifier === "alt" ? selectedEffectSession : undefined;
    // From this point onward `selectedSession` is deliberately the authority,
    // dispatch, receipt, and hardware-completion session. The debug effect is
    // retained only in the preparation-only variable above.
    const selectedSession = providerSourceSessionId ?? selectedEffectSession;
    const dispatchSessionId = selectedSession;
    const providerBinding = providerRequirement && providerSourceSessionId
      ? providerSelectionBinding(this.sessions.get(providerSourceSessionId), providerRequirement)
      : undefined;
    if (providerRequirement && !providerBinding) {
      await this.vscode.window.showWarningMessage("SXSY-B122 stopped because the selected provider session no longer has its exact catalog-derived identity and capability floor.");
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "The selected provider session binding was not exact before preparation.", undefined, selectedSession);
      return;
    }
    const reason = `Operator requested ${command.title} through the installed SXSY-B122 extension.`;
    if (command.control === "REANCHOR" && command.modifier === "normal") {
      const outcome = await this.runDedicatedReanchor(selectedSession, reason, hardwareClaim);
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, outcome.outcome, outcome.summary, outcome.dispatchReceiptId, selectedSession);
      return;
    }
    let hardwarePreparation = hardwareClaim ? await this.bridge.prepareHardwareSignal(hardwareClaim, dispatchSessionId, reason, undefined, undefined, undefined, debugEffectSessionId) : undefined;
    let regularPreparation = hardwareClaim ? undefined : await this.bridge.prepareCommand({
      control: command.control,
      modifier: command.modifier,
      ...(dispatchSessionId ? { sessionId: dispatchSessionId } : {}),
      ...(debugEffectSessionId ? { effectSessionId: debugEffectSessionId } : {}),
      reason
    });
    let preparationFailure = hardwarePreparation && !hardwarePreparation.ok ? hardwarePreparation : regularPreparation && !regularPreparation.ok ? regularPreparation : undefined;
    if (preparationFailure) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 preparation unavailable: ${preparationFailure.message}`);
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Command preparation failed before any dispatch request was sent.", undefined, selectedSession);
      return;
    }
    let preparation = hardwarePreparation?.ok ? hardwarePreparation.value.preparation : regularPreparation?.ok ? regularPreparation.value : undefined;
    if (!preparation) {
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", "The extension could not prove a canonical preparation result.", undefined, selectedSession);
      return;
    }
    // A canonical terminal refusal is authoritative even for commands that
    // normally enter a second protected review phase.  In particular, a
    // physical high-consequence command can arrive here with a companion
    // disposition receipt; do not reinterpret that refusal as a malformed
    // review packet or discard the receipt that closes the hardware claim.
    if (preparation.status !== "prepared" && preparation.status !== "incomplete") {
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${preparation.status}: ${preparation.summary}`);
      if (hardwareClaim) {
        const dispositionReceiptId = hardwarePreparation?.ok ? hardwarePreparation.value.dispositionReceiptId : undefined;
        await this.finishHardwareSignal(
          hardwareClaim,
          dispositionReceiptId ? "handled" : "needs_reconciliation",
          `Canonical preparation returned ${preparation.status}: ${preparation.summary}`.slice(0, 512),
          dispositionReceiptId,
          selectedSession
        );
      }
      return;
    }
    const workflowAction = workflowActionForCommand(command);
    const automationAction = automationManifestActionForCommand(command);
    if (automationAction) {
      const review = preparation.automationReview;
      const returnedBinding = providerRequirement ? providerSelectionBinding(preparation.session, providerRequirement) : undefined;
      if (preparation.status !== "incomplete" || !review || !preparation.session || !preparation.authorityId
        || preparation.confirmationToken || preparation.confirmationScopeDigest || preparation.workflowReview || preparation.debugStopReview
        || !dispatchSessionId || preparation.session.id !== dispatchSessionId
        || review.action !== automationAction || review.manifest.action !== automationAction
        || review.manifest.sessionId !== dispatchSessionId || review.manifest.authorityId !== preparation.authorityId
        || review.manifest.targetSnapshotId !== preparation.session.targetSnapshotId
        || review.manifest.taskId !== preparation.session.taskId || review.manifest.planRevision !== preparation.session.planRevision
        || !preparation.session.workspaceRoot || !samePath(review.manifest.repositoryRoot, preparation.session.workspaceRoot)
        || review.manifest.provider !== preparation.session.provider
        || (providerRequirement && (!providerBinding || !returnedBinding || !sameProviderSelectionBinding(returnedBinding, providerBinding)))) {
        await this.vscode.window.showWarningMessage("Automation stopped because initial preparation did not return one exact unconfirmed protected manifest bound to the current provider session, authority, target, task, and plan.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Automation preparation returned no exact reviewable protected manifest.", undefined, dispatchSessionId);
        return;
      }
      const reviewedScope = await this.presentAutomationManifestReview(review);
      if (!reviewedScope) {
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "The operator cancelled the exact automation manifest review; no dispatch was sent.", undefined, dispatchSessionId);
        return;
      }
      hardwarePreparation = hardwareClaim ? await this.bridge.prepareHardwareSignal(
        hardwareClaim, dispatchSessionId, reason, reviewedScope, review.manifest.id, review.manifest.digest
      ) : undefined;
      regularPreparation = hardwareClaim ? undefined : await this.bridge.prepareCommand({
        control: command.control,
        modifier: command.modifier,
        sessionId: dispatchSessionId,
        reason,
        reviewScopeDigest: reviewedScope,
        reviewArtifactId: review.manifest.id,
        reviewArtifactDigest: review.manifest.digest
      });
      preparationFailure = hardwarePreparation && !hardwarePreparation.ok ? hardwarePreparation : regularPreparation && !regularPreparation.ok ? regularPreparation : undefined;
      if (preparationFailure) {
        await this.vscode.window.showWarningMessage(`Reviewed automation preparation unavailable: ${preparationFailure.message}`);
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Reviewed automation preparation failed before dispatch.", undefined, dispatchSessionId);
        return;
      }
      const reviewedPreparation = hardwarePreparation?.ok ? hardwarePreparation.value.preparation : regularPreparation?.ok ? regularPreparation.value : undefined;
      if (reviewedPreparation && reviewedPreparation.status !== "prepared" && reviewedPreparation.status !== "incomplete") {
        await this.vscode.window.showWarningMessage(`SXSY-B122 ${reviewedPreparation.status}: ${reviewedPreparation.summary}`);
        if (hardwareClaim) {
          const dispositionReceiptId = hardwarePreparation?.ok ? hardwarePreparation.value.dispositionReceiptId : undefined;
          await this.finishHardwareSignal(hardwareClaim, dispositionReceiptId ? "handled" : "needs_reconciliation", `Reviewed automation preparation returned ${reviewedPreparation.status}: ${reviewedPreparation.summary}`.slice(0, 512), dispositionReceiptId, dispatchSessionId);
        }
        return;
      }
      const reviewedProviderBinding = reviewedPreparation && providerRequirement ? providerSelectionBinding(reviewedPreparation.session, providerRequirement) : undefined;
      if (!reviewedPreparation || reviewedPreparation.status !== "prepared" || !reviewedPreparation.confirmationToken
        || reviewedPreparation.confirmationScopeDigest !== reviewedScope || reviewedPreparation.authorityId !== review.manifest.authorityId
        || !reviewedPreparation.confirmationExpiresAt || Date.parse(reviewedPreparation.confirmationExpiresAt) <= Date.parse(this.now())
        || reviewedPreparation.session?.id !== dispatchSessionId || reviewedPreparation.automationReview || reviewedPreparation.debugStopReview || reviewedPreparation.workflowReview
        || (providerRequirement && (!providerBinding || !reviewedProviderBinding || !sameProviderSelectionBinding(reviewedProviderBinding, providerBinding)))) {
        await this.vscode.window.showWarningMessage("Automation stopped because final preparation changed or omitted the exact reviewed manifest session, authority, provider, or confirmation scope.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Final automation preparation changed or omitted the reviewed scope binding.", undefined, dispatchSessionId);
        return;
      }
      preparation = reviewedPreparation;
    } else if (command.control === "RUN" && command.modifier === "alt") {
      const review = preparation.debugStopReview;
      const selectedEffect = debugEffectSessionId ? this.currentManagedStopSelection(debugEffectSessionId, dispatchSessionId) : undefined;
      const returnedBinding = providerRequirement ? providerSelectionBinding(preparation.session, providerRequirement) : undefined;
      if (preparation.status !== "incomplete" || !review || !preparation.session || !preparation.authorityId
        || preparation.confirmationToken || preparation.confirmationScopeDigest || preparation.workflowReview || preparation.automationReview
        || !dispatchSessionId || !debugEffectSessionId || dispatchSessionId === debugEffectSessionId
        || preparation.session.id !== dispatchSessionId || review.sourceSessionId !== dispatchSessionId || review.authorityId !== preparation.authorityId
        || !selectedEffect || !sameManagedStopReviewSelection(review, selectedEffect)
        || (providerRequirement && (!providerBinding || !returnedBinding || !sameProviderSelectionBinding(returnedBinding, providerBinding)))) {
        await this.vscode.window.showWarningMessage("Debug stop halted because initial preparation did not return the exact protected provider-authority/debug-effect/origin binding.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Debug-stop preparation returned no exact reviewable split binding.", undefined, dispatchSessionId);
        return;
      }
      const reviewedScope = await this.presentDebugStopReview(review);
      if (!reviewedScope) {
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "The operator cancelled the exact debug-stop review; no dispatch was sent.", undefined, dispatchSessionId);
        return;
      }
      hardwarePreparation = hardwareClaim ? await this.bridge.prepareHardwareSignal(
        hardwareClaim, dispatchSessionId, reason, reviewedScope, review.bindingId, review.bindingDigest
      ) : undefined;
      regularPreparation = hardwareClaim ? undefined : await this.bridge.prepareCommand({
        control: command.control,
        modifier: command.modifier,
        sessionId: dispatchSessionId,
        reason,
        reviewScopeDigest: reviewedScope,
        reviewArtifactId: review.bindingId,
        reviewArtifactDigest: review.bindingDigest
      });
      preparationFailure = hardwarePreparation && !hardwarePreparation.ok ? hardwarePreparation : regularPreparation && !regularPreparation.ok ? regularPreparation : undefined;
      if (preparationFailure) {
        await this.vscode.window.showWarningMessage(`Reviewed debug-stop preparation unavailable: ${preparationFailure.message}`);
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Reviewed debug-stop preparation failed before dispatch.", undefined, dispatchSessionId);
        return;
      }
      const reviewedPreparation = hardwarePreparation?.ok ? hardwarePreparation.value.preparation : regularPreparation?.ok ? regularPreparation.value : undefined;
      if (reviewedPreparation && reviewedPreparation.status !== "prepared" && reviewedPreparation.status !== "incomplete") {
        await this.vscode.window.showWarningMessage(`SXSY-B122 ${reviewedPreparation.status}: ${reviewedPreparation.summary}`);
        if (hardwareClaim) {
          const dispositionReceiptId = hardwarePreparation?.ok ? hardwarePreparation.value.dispositionReceiptId : undefined;
          await this.finishHardwareSignal(hardwareClaim, dispositionReceiptId ? "handled" : "needs_reconciliation", `Reviewed managed-run stop preparation returned ${reviewedPreparation.status}: ${reviewedPreparation.summary}`.slice(0, 512), dispositionReceiptId, dispatchSessionId);
        }
        return;
      }
      const reviewedProviderBinding = reviewedPreparation && providerRequirement ? providerSelectionBinding(reviewedPreparation.session, providerRequirement) : undefined;
      const finalEffectSelection = debugEffectSessionId ? this.currentManagedStopSelection(debugEffectSessionId, dispatchSessionId) : undefined;
      if (!reviewedPreparation || reviewedPreparation.status !== "prepared" || !reviewedPreparation.confirmationToken
        || reviewedPreparation.confirmationScopeDigest !== reviewedScope || reviewedPreparation.authorityId !== review.authorityId
        || !reviewedPreparation.confirmationExpiresAt || Date.parse(reviewedPreparation.confirmationExpiresAt) <= Date.parse(this.now())
        || reviewedPreparation.session?.id !== dispatchSessionId || reviewedPreparation.automationReview || reviewedPreparation.debugStopReview || reviewedPreparation.workflowReview
        || !finalEffectSelection || !sameManagedStopReviewSelection(review, finalEffectSelection)
        || finalEffectSelection.effect.id !== selectedEffect.effect.id || finalEffectSelection.origin.id !== selectedEffect.origin.id
        || (providerRequirement && (!providerBinding || !reviewedProviderBinding || !sameProviderSelectionBinding(reviewedProviderBinding, providerBinding)))) {
        await this.vscode.window.showWarningMessage("Debug stop halted because final preparation changed or omitted the exact reviewed provider authority, split binding, or confirmation scope.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Final debug-stop preparation changed or omitted the reviewed scope binding.", undefined, dispatchSessionId);
        return;
      }
      preparation = reviewedPreparation;
    } else if (workflowAction === "plan_approval") {
      if (preparation.status !== "incomplete" || !preparation.workflowReview || !preparation.session) {
        await this.vscode.window.showWarningMessage("Plan Approval stopped because command preparation did not return the required unconfirmed protected plan-review packet.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Plan Approval preparation did not return a reviewable exact protected plan before dispatch.", undefined, selectedSession);
        return;
      }
      const reviewScopeDigest = await this.presentPlanApprovalReview(preparation.workflowReview, preparation.session);
      if (!reviewScopeDigest) {
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "The operator cancelled or rejected the exact protected Plan Approval review before dispatch.", undefined, selectedSession);
        return;
      }
      hardwarePreparation = hardwareClaim ? await this.bridge.prepareHardwareSignal(hardwareClaim, selectedSession, reason, reviewScopeDigest) : undefined;
      regularPreparation = hardwareClaim ? undefined : await this.bridge.prepareCommand({ control: command.control, modifier: command.modifier, ...(selectedSession ? { sessionId: selectedSession } : {}), reason, reviewScopeDigest });
      preparationFailure = hardwarePreparation && !hardwarePreparation.ok ? hardwarePreparation : regularPreparation && !regularPreparation.ok ? regularPreparation : undefined;
      if (preparationFailure) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 reviewed Plan Approval unavailable: ${preparationFailure.message}`);
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Reviewed Plan Approval preparation failed before dispatch.", undefined, selectedSession);
        return;
      }
      preparation = hardwarePreparation?.ok ? hardwarePreparation.value.preparation : regularPreparation?.ok ? regularPreparation.value : undefined;
      if (!preparation) {
        await this.vscode.window.showWarningMessage("SXSY-B122 rejected an absent reviewed Plan Approval preparation result.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Reviewed Plan Approval returned no canonical preparation result.", undefined, selectedSession);
        return;
      }
      if (preparation.status !== "prepared") {
        await this.vscode.window.showWarningMessage(`SXSY-B122 ${preparation.status}: ${preparation.summary}`);
        if (hardwareClaim) {
          const dispositionReceiptId = hardwarePreparation?.ok ? hardwarePreparation.value.dispositionReceiptId : undefined;
          await this.finishHardwareSignal(hardwareClaim, dispositionReceiptId ? "handled" : "failed_before_dispatch", `Reviewed Plan Approval preparation returned ${preparation.status}: ${preparation.summary}`.slice(0, 512), dispositionReceiptId, selectedSession);
        }
        return;
      }
      if (preparation.workflowReview || preparation.confirmationScopeDigest !== reviewScopeDigest || !preparation.confirmationToken) {
        await this.vscode.window.showWarningMessage("Plan Approval stopped because final preparation did not bind one confirmation token to the exact reviewed plan scope.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Final Plan Approval preparation changed or omitted the reviewed scope binding.", undefined, selectedSession);
        return;
      }
    } else if (workflowAction === "authority_broadcast") {
      const returnedBinding = providerRequirement ? providerSelectionBinding(preparation.session, providerRequirement) : undefined;
      if (preparation.status !== "incomplete" || !selectedSession || !preparation.authorityId || preparation.confirmationToken || preparation.confirmationScopeDigest
        || !providerBinding || !returnedBinding || returnedBinding.id !== selectedSession || !sameProviderSelectionBinding(returnedBinding, providerBinding)) {
        await this.vscode.window.showWarningMessage("Shift Authority stopped because initial preparation did not return the exact unconfirmed provider session and authority context.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Initial Authority Broadcast preparation changed or prematurely confirmed its protected provider binding.", undefined, selectedSession);
        return;
      }
    } else if (preparation.status !== "prepared") {
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${preparation.status}: ${preparation.summary}`);
      if (hardwareClaim) {
        const dispositionReceiptId = hardwarePreparation?.ok ? hardwarePreparation.value.dispositionReceiptId : undefined;
        await this.finishHardwareSignal(hardwareClaim, dispositionReceiptId ? "handled" : "needs_reconciliation", `Canonical preparation returned ${preparation.status}: ${preparation.summary}`.slice(0, 512), dispositionReceiptId, selectedSession);
      }
      return;
    }
    if (preparation.session) this.sessions.set(preparation.session.id, preparation.session);
    if (dispatchSessionId && !await this.reviewGitMutation(command, dispatchSessionId)) {
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "The exact Git mutation review did not approve dispatch.", undefined, selectedSession);
      return;
    }
    const preparedWorkflow = await this.prepareWorkflowForCommand(command, dispatchSessionId, preparation.authorityId, preparation.confirmationToken, preparation.confirmationScopeDigest);
    if (!preparedWorkflow) {
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "The typed provider workflow artifact was not prepared for dispatch.", undefined, selectedSession);
      return;
    }
    if (workflowAction === "authority_broadcast") {
      if (preparedWorkflow === true) {
        await this.vscode.window.showWarningMessage("Shift Authority stopped because no exact immutable broadcast artifact was returned for packet review.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Shift Authority returned no exact immutable broadcast artifact; no second-phase confirmation or dispatch was sent.", undefined, selectedSession);
        return;
      }
      const reviewScopeDigest = await this.presentAuthorityBroadcastReview(preparedWorkflow);
      if (!reviewScopeDigest) {
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "The operator cancelled the exact Authority Broadcast packet review; the prepared artifact remains reconcilable.", undefined, selectedSession);
        return;
      }
      hardwarePreparation = hardwareClaim ? await this.bridge.prepareHardwareSignal(
        hardwareClaim,
        selectedSession,
        reason,
        reviewScopeDigest,
        preparedWorkflow.id,
        preparedWorkflow.digest
      ) : undefined;
      const reviewedRequest = {
        control: command.control,
        modifier: command.modifier,
        ...(selectedSession ? { sessionId: selectedSession } : {}),
        reason,
        reviewScopeDigest,
        reviewArtifactId: preparedWorkflow.id,
        reviewArtifactDigest: preparedWorkflow.digest
      };
      regularPreparation = hardwareClaim ? undefined : await this.bridge.prepareCommand(reviewedRequest);
      preparationFailure = hardwarePreparation && !hardwarePreparation.ok ? hardwarePreparation : regularPreparation && !regularPreparation.ok ? regularPreparation : undefined;
      if (preparationFailure) {
        await this.vscode.window.showWarningMessage(`Shift Authority fresh packet confirmation unavailable: ${preparationFailure.message}`);
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Shift Authority second-phase preparation transport failed before dispatch.", undefined, selectedSession);
        return;
      }
      const reviewedPreparation = hardwarePreparation?.ok ? hardwarePreparation.value.preparation : regularPreparation?.ok ? regularPreparation.value : undefined;
      if (reviewedPreparation && reviewedPreparation.status !== "prepared" && reviewedPreparation.status !== "incomplete") {
        await this.vscode.window.showWarningMessage(`SXSY-B122 ${reviewedPreparation.status}: ${reviewedPreparation.summary}`);
        if (hardwareClaim) {
          const dispositionReceiptId = hardwarePreparation?.ok ? hardwarePreparation.value.dispositionReceiptId : undefined;
          await this.finishHardwareSignal(hardwareClaim, dispositionReceiptId ? "handled" : "needs_reconciliation", `Reviewed Authority Broadcast preparation returned ${reviewedPreparation.status}: ${reviewedPreparation.summary}`.slice(0, 512), dispositionReceiptId, selectedSession);
        }
        return;
      }
      const reviewedProviderBinding = reviewedPreparation && providerRequirement
        ? providerSelectionBinding(reviewedPreparation.session, providerRequirement)
        : undefined;
      if (!reviewedPreparation || reviewedPreparation.status !== "prepared" || reviewedPreparation.authorityId !== preparedWorkflow.authorityId
        || reviewedPreparation.confirmationScopeDigest !== reviewScopeDigest || !reviewedPreparation.confirmationToken
        || !selectedSession || reviewedPreparation.session?.id !== selectedSession || !providerBinding || !reviewedProviderBinding
        || !sameProviderSelectionBinding(reviewedProviderBinding, providerBinding)) {
        await this.vscode.window.showWarningMessage("Shift Authority stopped because fresh confirmation changed or omitted the exact artifact authority, session, or packet-review scope.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "Shift Authority final binding changed or omitted the exact reviewed artifact, authority, session, or scope; no dispatch was sent.", undefined, selectedSession);
        return;
      }
      preparation = reviewedPreparation;
      this.sessions.set(reviewedPreparation.session.id, reviewedPreparation.session);
    }
    if (providerBinding && !await this.revalidateProviderSelection(command, providerBinding)) {
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "failed_before_dispatch", "The exact provider session changed after preparation and before dispatch.", undefined, selectedSession);
      return;
    }
    const forwarded: ForwardedCommand = {
      control: command.control,
      modifier: command.modifier,
      ...(dispatchSessionId ? { sessionId: dispatchSessionId } : {}),
      ...(preparation.authorityId ? { authorityId: preparation.authorityId } : {}),
      ...(preparation.confirmationToken ? { confirmationToken: preparation.confirmationToken } : {}),
      ...(preparation.confirmationScopeDigest ? { confirmationScopeDigest: preparation.confirmationScopeDigest } : {}),
      input
    };
    const hardwareDispatch = hardwareClaim ? await this.bridge.dispatchHardwareSignal(hardwareClaim, { ...(forwarded.sessionId ? { sessionId: forwarded.sessionId } : {}), ...(forwarded.authorityId ? { authorityId: forwarded.authorityId } : {}), ...(forwarded.confirmationToken ? { confirmationToken: forwarded.confirmationToken } : {}), ...(forwarded.confirmationScopeDigest ? { confirmationScopeDigest: forwarded.confirmationScopeDigest } : {}), ...(forwarded.input ? { input: forwarded.input } : {}) }) : undefined;
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
    if (command.control === "RUN" && command.modifier === "alt" && debugEffectSessionId && dispatchSessionId
      && result.status === "completed" && result.effectDisposition === "committed") {
      const selectedStop = this.currentManagedStopSelection(debugEffectSessionId, dispatchSessionId);
      if (selectedStop?.effectKind === "managed_run") {
        const retirementError = await this.retireCommittedManagedRunEffect(result, selectedStop);
        if (retirementError) {
          await this.vscode.window.showWarningMessage(`SXSY-B122 managed Run stop requires reconciliation: ${retirementError}`);
          if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", retirementError.slice(0, 512), dispatchReceiptId, selectedSession);
          return;
        }
      }
    }
    const attemptedManagedRun = result.data?.managedRun !== undefined || result.data?.managedProcessId !== undefined;
    if (command.control === "RUN" && command.modifier === "normal" && attemptedManagedRun) {
      if (!dispatchSessionId || !await this.registerManagedRunEffect(result, dispatchSessionId)) {
        await this.vscode.window.showWarningMessage("SXSY-B122 rejected a malformed, substituted, or unbound managed Run child identity; Alt Run will not be allowed to target it.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", "The canonical Run dispatch returned an invalid managed-child binding and the extension rejected it.", dispatchReceiptId, selectedSession);
        return;
      }
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
    const councilResultPresented = result.status === "completed" && command.control === "COUNCIL" && (command.modifier === "normal" || command.modifier === "alt")
      ? await this.presentCouncilResult(command.modifier, result, selectedSession)
      : false;
    let workflowResultPresented = false;
    if (result.status === "blocked" || result.status === "unavailable" || result.status === "incomplete" || result.status === "failed") {
      if (workflowOutcome) {
        try { await this.presentWorkflowResult(workflowOutcome.workflowResult); workflowResultPresented = true; }
        catch { await this.vscode.window.showWarningMessage("SXSY-B122 received a protected workflow result, but VS Code could not open its bounded read-only result view."); }
      }
      if (!pipelineStatusPresented && !councilResultPresented) await this.vscode.window.showWarningMessage(`SXSY-B122 ${result.status}: ${result.summary}`);
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", `Canonical dispatch returned ${result.status}: ${result.summary}`.slice(0, 512), dispatchReceiptId, selectedSession);
      return;
    }
    if (action) {
      if (result.status !== "running") {
        await this.vscode.window.showWarningMessage("SXSY-B122 rejected a host action that was not bound to a running durable operation.");
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", "The canonical dispatch returned a host action without a running durable operation.", dispatchReceiptId, selectedSession);
        return;
      }
      if (action.kind === "show_voice_center") {
        const delivery = await this.claimAndDeliverExpectedVoiceAction(action.id, result.operationId, command);
        if (!delivery.settled) {
          await this.vscode.window.showWarningMessage(`SXSY-B122 Voice host action requires reconciliation: ${delivery.summary}`);
          if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", delivery.summary.slice(0, 512), dispatchReceiptId, selectedSession);
          return;
        }
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", delivery.summary.slice(0, 512), dispatchReceiptId, selectedSession);
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
        this.assertAdmissionActive();
        authorizationToken = authorization.value.authorizationToken;
        summary = await this.executeLocalHostAction(action, command, authorization.value, result, preparedManagedTerminal, dispatchSessionId);
        succeeded = true;
        effectDisposition = "committed";
      } catch (error) {
        summary = error instanceof Error && error.message ? error.message : summary;
        if (error instanceof HostEffectError) effectDisposition = error.effectDisposition;
        else if (authorizationToken) effectDisposition = "ambiguous";
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
    const handoffPayload = preparedWorkflow !== true && preparedWorkflow.payload.kind === "handoff" ? preparedWorkflow.payload : undefined;
    const expectedHandoffAcknowledgement = handoffPayload?.route === "immediate";
    if (result.status === "completed" && handoffPayload && (workflowOutcome?.workflowResult.kind !== "handoff"
      || workflowOutcome.workflowResult.acknowledged !== expectedHandoffAcknowledgement
      || workflowOutcome.workflowResult.packageId !== handoffPayload.packageId
      || workflowOutcome.workflowResult.recipientSessionId !== handoffPayload.recipientSessionId)) {
      const route = handoffPayload.route === "immediate" ? "immediate" : "queued";
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${route === "immediate" ? "Alt/immediate" : "queued"} Handoff requires reconciliation because the completed dispatch did not carry the exact provider acknowledgement state; the package route remains immutable and no recipient was acknowledged or focused.`);
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", `${route} Handoff completed without the exact provider acknowledgement state; the recipient was not acknowledged or focused.`, dispatchReceiptId, selectedSession);
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
    if (!pipelineStatusPresented && !councilResultPresented && !workflowResultPresented) await this.vscode.window.showInformationMessage(`SXSY-B122: ${result.summary}`);
    if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", `Canonical dispatch returned ${result.status}: ${result.summary}`.slice(0, 512), dispatchReceiptId, selectedSession);
  }

  private async runDedicatedReanchor(selectedSession: string | undefined, reason: string, hardwareClaim?: HardwareSignalClaim): Promise<ReanchorUiOutcome> {
    if (!selectedSession) {
      const summary = "Re-anchor requires one exact managed session; no authority, confirmation, or provider request was sent.";
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
      return { outcome: "failed_before_dispatch", summary };
    }
    const listed = await this.bridge.listReanchorAuthorities(selectedSession);
    if (!listed.ok) {
      const summary = `Eligible Re-anchor authority lookup failed: ${listed.message}`.slice(0, 512);
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
      return { outcome: "failed_before_dispatch", summary };
    }
    if (!validReanchorAuthorities(listed.value)) {
      const summary = "The companion returned a malformed or unbounded eligible Re-anchor authority list; no request was begun.";
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
      return { outcome: "failed_before_dispatch", summary };
    }
    if (listed.value.length === 0) {
      const summary = "No eligible existing Re-anchor authority is bound to this exact managed session; the extension will not create or broaden one.";
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
      return { outcome: "failed_before_dispatch", summary };
    }
    let authority: ExtensionReanchorAuthority | undefined = listed.value.length === 1 ? listed.value[0] : undefined;
    if (!authority) {
      const items = listed.value.map((item) => ({ label: item.id, description: `Issued by ${item.issuedBy}`, detail: `Existing exact grant; expires ${item.expiresAt}` }));
      const selected = await this.vscode.window.showQuickPick(items, { placeHolder: "Choose one eligible existing Re-anchor authority; this does not create or refresh a grant" });
      if (!selected) {
        const summary = "Re-anchor authority selection was cancelled; no request, confirmation, provider effect, or resume occurred.";
        await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
        return { outcome: "failed_before_dispatch", summary };
      }
      authority = listed.value[items.indexOf(selected)];
      if (!authority) {
        const summary = "The selected Re-anchor authority changed before use; no request was begun.";
        await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
        return { outcome: "failed_before_dispatch", summary };
      }
    }

    const beginInput = { sessionId: selectedSession, authorityId: authority.id, reason };
    const hardwareBegin = hardwareClaim ? await this.bridge.beginHardwareReanchor(hardwareClaim, beginInput) : undefined;
    const regularBegin = hardwareClaim ? undefined : await this.bridge.beginReanchor(beginInput);
    const beginFailure = hardwareBegin && !hardwareBegin.ok ? hardwareBegin : regularBegin && !regularBegin.ok ? regularBegin : undefined;
    if (beginFailure) {
      const summary = `Dedicated Re-anchor preview failed: ${beginFailure.message}`.slice(0, 512);
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
      return { outcome: hardwareClaim ? "needs_reconciliation" : "failed_before_dispatch", summary };
    }
    const preview = hardwareBegin?.ok ? hardwareBegin.value.reanchor : regularBegin?.ok ? regularBegin.value : undefined;
    const hardwareDispatchReceiptId = hardwareBegin?.ok ? hardwareBegin.value.dispatchReceiptId : undefined;
    if (!preview) {
      const summary = "The dedicated Re-anchor begin route returned no exact preview; no confirmation was sent.";
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
      return { outcome: hardwareClaim ? "needs_reconciliation" : "failed_before_dispatch", summary, ...(hardwareDispatchReceiptId ? { dispatchReceiptId: hardwareDispatchReceiptId } : {}) };
    }
    if (!validReanchorPreview(preview, selectedSession, authority.id, this.now())) {
      const summary = "The dedicated Re-anchor preview changed its exact session, authority, target, scope, or review structure; no confirmation or provider effect was sent.";
      await this.vscode.window.showWarningMessage(`SXSY-B122 rejected the malformed Re-anchor preview. ${summary}`);
      return { outcome: hardwareClaim ? "needs_reconciliation" : "failed_before_dispatch", summary, ...(hardwareDispatchReceiptId ? { dispatchReceiptId: hardwareDispatchReceiptId } : {}) };
    }
    await this.presentReanchorPreview(preview);
    const confirmationLabel = "Confirm exact Re-anchor without resuming";
    const showModal = this.vscode.window.showWarningMessage as unknown as (
      message: string,
      options: Readonly<{ modal: true; detail: string }>,
      ...items: readonly string[]
    ) => PromiseLike<string | undefined>;
    const decision = await showModal.call(
      this.vscode.window,
      `Confirm Re-anchor from ${preview.oldTargetSnapshotId.slice(0, 12)}… to ${preview.newTargetSnapshotId.slice(0, 12)}…?`,
      { modal: true, detail: `Exact reviewed scope ${preview.confirmationScopeDigest}. The managed provider will cooperatively stop, reread protected context, report discrepancies and questions, and will not resume.` },
      confirmationLabel,
      "Cancel"
    );
    if (decision !== confirmationLabel) {
      const summary = "Re-anchor was cancelled after read-only preview; no confirmation or provider effect occurred, and no resume or rollback occurred.";
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
      return { outcome: hardwareDispatchReceiptId ? "handled" : "failed_before_dispatch", summary, ...(hardwareDispatchReceiptId ? { dispatchReceiptId: hardwareDispatchReceiptId } : {}) };
    }

    const completed = await this.bridge.confirmReanchor(preview.requestId);
    if (!completed.ok) {
      const summary = `Re-anchor confirmation may require reconciliation: ${completed.message}`.slice(0, 512);
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
      return { outcome: "needs_reconciliation", summary, ...(hardwareDispatchReceiptId ? { dispatchReceiptId: hardwareDispatchReceiptId } : {}) };
    }
    if (!validRecordedReanchor(completed.value, preview)) {
      const summary = "The extension rejected a malformed Re-anchor final report or a receipt that did not prove the exact no-resume transition.";
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${summary}`);
      return { outcome: "needs_reconciliation", summary, ...(hardwareDispatchReceiptId ? { dispatchReceiptId: hardwareDispatchReceiptId } : {}) };
    }
    await this.presentReanchorReport(completed.value);
    const summary = `Re-anchor ${completed.value.receipt.result}: ${completed.value.receipt.report.summary} The managed provider remains stopped.`.slice(0, 512);
    await this.vscode.window.showInformationMessage(`SXSY-B122 ${summary}`);
    return { outcome: "handled", summary, ...(hardwareDispatchReceiptId ? { dispatchReceiptId: hardwareDispatchReceiptId } : {}) };
  }

  private async presentReanchorPreview(preview: ExtensionReanchorStatus): Promise<void> {
    const items: QuickPickItemLike[] = [
      { label: "Reviewed transition summary", description: "Read-only; no confirmation", detail: safeOverlayText(preview.summary ?? "No preview summary returned.", 1_024) },
      { label: "Old TargetSnapshot", description: preview.oldTargetSnapshotId, detail: "Protected currently-bound target" },
      { label: "Proposed new TargetSnapshot", description: preview.newTargetSnapshotId, detail: "Host-derived complete target; not caller-selected" }
    ];
    preview.discrepancies?.forEach((item, index) => items.push({ label: `Discrepancy ${index + 1}`, description: "Review before confirmation", detail: safeOverlayText(item, 1_024) }));
    preview.risks?.forEach((item, index) => items.push({ label: `Risk ${index + 1}`, description: "Provider remains stopped", detail: safeOverlayText(item, 1_024) }));
    preview.questions?.forEach((item, index) => items.push({ label: `Question ${index + 1}`, description: "No answer is inferred", detail: safeOverlayText(item, 1_024) }));
    await this.vscode.window.showQuickPick(items, { placeHolder: `Read-only Re-anchor preview for exact scope ${preview.confirmationScopeDigest}; selecting an item does not confirm` });
  }

  private async presentReanchorReport(status: ExtensionReanchorStatus & { readonly receipt: NonNullable<ExtensionReanchorStatus["receipt"]> }): Promise<void> {
    const report = status.receipt.report;
    const items: QuickPickItemLike[] = [
      { label: "Post-stop summary", description: report.result, detail: safeOverlayText(report.summary, 1_024) },
      { label: "Provider lifecycle", description: "Stopped; automatic resume forbidden", detail: `Receipt ${status.receipt.id}; exact new target ${status.newTargetSnapshotId}` }
    ];
    report.discrepancies.forEach((item, index) => items.push({ label: `Discrepancy ${index + 1}`, description: "Provider reread result", detail: safeOverlayText(item, 1_024) }));
    report.risks.forEach((item, index) => items.push({ label: `Risk ${index + 1}`, description: "Provider reread result", detail: safeOverlayText(item, 1_024) }));
    report.questions.forEach((item, index) => items.push({ label: `Question ${index + 1}`, description: "Requires a separate operator decision", detail: safeOverlayText(item, 1_024) }));
    await this.vscode.window.showQuickPick(items, { placeHolder: `Read-only post-stop provider report — ${report.result}; no resume or rollback action is available here` });
  }

  private stopReconnect(): void { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }

  private scheduleSessionHeartbeat(delayMs = this.heartbeatIntervalMs): void {
    if (!this.started || this.sessionHeartbeatTimer || this.sessionHeartbeatInFlight) return;
    this.sessionHeartbeatTimer = setTimeout(() => {
      this.sessionHeartbeatTimer = undefined;
      const task = this.heartbeatLocalSessions();
      this.sessionHeartbeatTask = task;
      const clear = () => { if (this.sessionHeartbeatTask === task) this.sessionHeartbeatTask = undefined; };
      void task.then(clear, clear);
    }, delayMs);
    this.sessionHeartbeatTimer.unref?.();
  }

  private async heartbeatLocalSessions(): Promise<void> {
    if (!this.started || this.sessionHeartbeatInFlight) return;
    const generation = this.lifecycleGeneration;
    this.sessionHeartbeatInFlight = true;
    try {
      const at = this.now();
      const localSessions = [...this.sessions.values()].filter((session) =>
        session.metadata["sxsy-b122.providerHandshake"] !== "exact-route-v1"
        && session.status !== "unreachable" && session.status !== "stale");
      for (const session of localSessions) {
        const result = await this.bridge.heartbeat(session.id, at);
        if (!this.started || generation !== this.lifecycleGeneration) return;
        if (result.ok) this.sessions.set(result.value.id, result.value);
      }
      if (!this.started || generation !== this.lifecycleGeneration) return;
      await this.refreshSessionNotifications();
    } finally {
      this.sessionHeartbeatInFlight = false;
      if (this.started && generation === this.lifecycleGeneration) this.scheduleSessionHeartbeat();
    }
  }

  private scheduleHostActionPoll(delayMs = this.hostActionPollIntervalMs): void {
    if (!this.started || !this.vscode.window.state.focused || this.hostActionTimer || this.hostActionInFlight || this.voiceCommandInFlight > 0 || !this.windowSessionId) return;
    this.hostActionTimer = setTimeout(() => {
      this.hostActionTimer = undefined;
      const task = this.pollHostAction();
      this.hostActionTask = task;
      const clear = () => { if (this.hostActionTask === task) this.hostActionTask = undefined; };
      void task.then(clear, clear);
    }, delayMs);
    this.hostActionTimer.unref?.();
  }

  private async pollHostAction(): Promise<void> {
    if (!this.started || !this.vscode.window.state.focused || this.hostActionInFlight || this.voiceCommandInFlight > 0 || !this.windowSessionId) return;
    const generation = this.lifecycleGeneration;
    await this.withHostActionClaimLock(async () => {
      const claim = await this.claimNextVoiceAction(generation);
      if (claim) await this.runInGeneration(generation, () => this.deliverClaimedVoiceCenter(claim, generation));
    });
    if (this.started && generation === this.lifecycleGeneration) this.scheduleHostActionPoll();
  }

  private async claimAndDeliverExpectedVoiceAction(hostActionId: string, operationId: string | undefined, command: ChordCommand): Promise<Readonly<{ settled: boolean; summary: string }>> {
    if (!operationId) return { settled: false, summary: "The durable Voice dispatch omitted its exact operation identity." };
    return this.withHostActionClaimLock(async () => {
      const generation = this.lifecycleGeneration;
      for (let attempt = 0; attempt < 64; attempt += 1) {
        const claim = await this.claimNextVoiceAction(generation);
        if (!claim) return { settled: false, summary: "No exact authenticated Voice host-action claim was available for the durable dispatch." };
        if (claim.hostActionId === hostActionId) {
          if (claim.operationId !== operationId || voiceChordForClaim(claim)?.control !== command.control || voiceChordForClaim(claim)?.modifier !== command.modifier) {
            await this.bridge.completeHostAction(claim.hostActionId, false, "The claimed Voice action changed its exact operation or canonical modifier binding.", this.extensionVersion, undefined, "not_started", {
              claimId: claim.claimId, claimToken: claim.claimToken, windowSessionId: claim.windowSessionId
            });
            return { settled: false, summary: "The claimed Voice action changed its exact operation or canonical modifier binding." };
          }
          return this.deliverClaimedVoiceCenter(claim, generation);
        }
        await this.deliverClaimedVoiceCenter(claim, generation);
      }
      return { settled: false, summary: "The bounded Voice claim queue did not yield the exact dispatched host action." };
    });
  }

  private async withHostActionClaimLock<T>(work: () => Promise<T>): Promise<T> {
    const prior = this.hostActionClaimTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.hostActionClaimTail = prior.then(() => current, () => current);
    await prior.catch(() => undefined);
    this.hostActionInFlight = true;
    try { return await work(); }
    finally { this.hostActionInFlight = false; release(); }
  }

  private async claimNextVoiceAction(generation: number): Promise<ExtensionHostActionClaim | undefined> {
    const windowSessionId = this.windowSessionId;
    if (!this.started || generation !== this.lifecycleGeneration || !windowSessionId || !this.vscode.window.state.focused) return undefined;
    const workspaceRoots = this.workspaceRoots();
    const claimed = await this.bridge.claimHostAction({
      windowSessionId,
      workspaceRoots,
      adapterVersion: this.extensionVersion,
      capabilities: extensionHostActionCapabilities,
      focused: true
    });
    if (!claimed.ok || !claimed.value) return undefined;
    const claim = claimed.value;
    if (!this.validVoiceHostActionClaim(claim, generation, windowSessionId, workspaceRoots)) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected a Voice host-action claim that changed its exact Registered window, repository, target, source session, or canonical modifier binding.");
      return undefined;
    }
    return claim;
  }

  private validVoiceHostActionClaim(claim: ExtensionHostActionClaim, generation: number, windowSessionId: string, workspaceRoots: readonly string[]): boolean {
    if (!this.started || generation !== this.lifecycleGeneration || !this.vscode.window.state.focused || this.windowSessionId !== windowSessionId
      || claim.windowSessionId !== windowSessionId || claim.adapterVersion !== this.extensionVersion || claim.hostActionKind !== "show_voice_center"
      || claim.capabilities.length !== 1 || claim.capabilities[0] !== "show_voice_center" || !voiceChordForClaim(claim)) return false;
    if (claim.workspaceRoot === undefined) return claim.targetSnapshotId === undefined && claim.sessionId === undefined
      && (claim.commandAction === "open_voice" || claim.commandAction === "switch_voice_provider");
    if (!workspaceRoots.some((root) => samePath(root, claim.workspaceRoot!)) || !claim.targetSnapshotId || !claim.sessionId) return false;
    const source = this.sessions.get(claim.sessionId);
    return !!source?.workspaceRoot && samePath(source.workspaceRoot, claim.workspaceRoot)
      && source.targetSnapshotId === claim.targetSnapshotId;
  }

  private async deliverClaimedVoiceCenter(claim: ExtensionHostActionClaim, generation: number): Promise<Readonly<{ settled: boolean; summary: string }>> {
    const reference: HostActionClaimReference = { claimId: claim.claimId, claimToken: claim.claimToken, windowSessionId: claim.windowSessionId };
    const action: ForwardedHostAction = { id: claim.hostActionId, kind: "show_voice_center", expiresAt: claim.actionExpiresAt, ...(claim.workspaceRoot ? { workspaceRoot: claim.workspaceRoot } : {}) };
    const command = voiceChordForClaim(claim);
    if (!command) return { settled: false, summary: "The claimed Voice command has no canonical chord assignment." };
    let succeeded = false;
    let effectDisposition: "not_started" | "committed" | "ambiguous" = "not_started";
    let summary = "The extension stopped before opening the native Voice Center.";
    let authorizationToken: string | undefined;
    try {
      const now = Date.parse(this.now());
      if (!Number.isFinite(now) || Date.parse(claim.expiresAt) <= now || Date.parse(claim.actionExpiresAt) <= now) throw new Error("The durable Voice Center claim expired before final authorization.");
      if (!this.validVoiceHostActionClaim(claim, generation, claim.windowSessionId, this.workspaceRoots())) throw new Error("The exact claimed VS Code window, target, or source session is no longer active and focused.");
      const authorization = await this.bridge.authorizeHostAction(claim.hostActionId, this.extensionVersion, undefined, undefined, reference);
      if (!authorization.ok) throw new Error(`The companion refused the claimed Voice Center effect: ${authorization.message}`);
      if (authorization.value.hostActionId !== claim.hostActionId || Date.parse(authorization.value.expiresAt) <= Date.parse(this.now())) throw new Error("The claimed Voice Center authorization is mismatched or expired.");
      authorizationToken = authorization.value.authorizationToken;
      if (!this.validVoiceHostActionClaim(claim, generation, claim.windowSessionId, this.workspaceRoots())) throw new Error("The claimed VS Code window, target, or source session changed at the final Voice effect boundary.");
      summary = await this.executeLocalHostAction(action, command, authorization.value, {
        status: "running",
        summary: "The durable Voice command is awaiting exact extension settlement.",
        operationId: claim.operationId
      }, undefined, claim.sessionId);
      succeeded = true;
      effectDisposition = "committed";
    } catch (error) {
      summary = error instanceof Error && error.message ? error.message : summary;
      effectDisposition = authorizationToken ? "ambiguous" : "not_started";
    }
    const completionBridge = this.started && generation === this.lifecycleGeneration ? this.bridge : this.rawBridge;
    const completion = await completionBridge.completeHostAction(
      claim.hostActionId,
      succeeded,
      summary.slice(0, 512),
      this.extensionVersion,
      authorizationToken,
      effectDisposition,
      reference
    );
    if (!completion.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 claimed Voice Center requires reconciliation: ${completion.message}`);
      return { settled: false, summary: `Durable Voice settlement failed after the host effect boundary: ${completion.message}` };
    }
    const show = completion.value.status === "completed" ? this.vscode.window.showInformationMessage.bind(this.vscode.window) : this.vscode.window.showWarningMessage.bind(this.vscode.window);
    await show(`SXSY-B122 ${completion.value.status}: ${completion.value.summary}`);
    return { settled: true, summary: `Durable Voice ${claim.commandAction} settled as ${completion.value.status}: ${completion.value.summary}`.slice(0, 512) };
  }

  private scheduleHardwareSignalPoll(delayMs = 250): void {
    if (!this.started || !this.vscode.window.state.focused || this.hardwareSignalTimer || this.hardwareSignalInFlight || !this.windowSessionId || this.workspaceRoots().length < 1) return;
    this.hardwareSignalTimer = setTimeout(() => {
      this.hardwareSignalTimer = undefined;
      const task = this.pollHardwareSignal();
      this.hardwareSignalTask = task;
      const clear = () => { if (this.hardwareSignalTask === task) this.hardwareSignalTask = undefined; };
      void task.then(clear, clear);
    }, delayMs);
    this.hardwareSignalTimer.unref?.();
  }

  private async pollHardwareSignal(): Promise<void> {
    if (!this.started || !this.vscode.window.state.focused || this.hardwareSignalInFlight || !this.windowSessionId) return;
    const generation = this.lifecycleGeneration;
    const workspaceRoots = this.workspaceRoots();
    if (!workspaceRoots.length) return;
    this.hardwareSignalInFlight = true;
    try {
      const claimResult = await this.bridge.claimHardwareSignal({ windowSessionId: this.windowSessionId, workspaceRoots, focused: true });
      if (!claimResult.ok || !claimResult.value) return;
      const claim = claimResult.value;
      if (!this.started || generation !== this.lifecycleGeneration) {
        await this.finishHardwareSignal(claim, "failed_before_dispatch", "The VS Code extension stopped after claiming this hardware signal and before dispatch.");
        return;
      }
      if (!this.vscode.window.state.focused || !sameRootList(this.workspaceRoots(), workspaceRoots)) {
        await this.finishHardwareSignal(claim, "failed_before_dispatch", "The VS Code window lost focus or changed workspace binding before hardware preparation began.");
        return;
      }
      const command = chordFor(claim.control, claim.modifier);
      if (!command || claim.windowSessionId !== this.windowSessionId || !sameRootList(claim.workspaceRoots, workspaceRoots)) {
        await this.vscode.window.showWarningMessage("SXSY-B122 rejected a hardware signal claim that was not bound to this exact focused window and canonical assignment.");
        await this.finishHardwareSignal(claim, "failed_before_dispatch", "The hardware claim changed its exact window, workspace-root set, or canonical chord before preparation.");
        return;
      }
      await this.dispatchChord(command, undefined, claim);
    } finally {
      this.hardwareSignalInFlight = false;
      if (this.started && generation === this.lifecycleGeneration) this.scheduleHardwareSignalPoll();
    }
  }

  private async finishHardwareSignal(claim: HardwareSignalClaim, outcome: "handled" | "failed_before_dispatch" | "needs_reconciliation", summary: string, dispatchReceiptId?: string, dispatchSessionId?: string): Promise<void> {
    this.hardwareTerminalAttempts.add(claim.signalId);
    const session = dispatchSessionId ? this.sessions.get(dispatchSessionId) : undefined;
    const completionBridge = outcome === "failed_before_dispatch" && !this.started ? this.rawBridge : this.bridge;
    const completion = await completionBridge.completeHardwareSignal(claim, {
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
      let containmentRemediation: Extract<ReviewedGitMutation, { kind: "local_commit" }>["containmentRemediation"];
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
      const containment = await this.bridge.inspectContainment(sessionId);
      if (containment.ok) {
        if (containment.value.incident.status !== "remediation_required") {
          await this.vscode.window.showWarningMessage(`SXSY-B122 local commit remains fenced while containment incident ${containment.value.incident.id} is ${containment.value.incident.status}; inspect the incident workflow first.`);
          return false;
        }
        const remediated = new Set(containment.value.incident.receipts.flatMap((receipt) => receipt.remediatedFindingIds));
        const pendingByPath = containment.value.incident.steps.flatMap((step) => (step.result?.findings ?? []).map((finding) => ({ step: step.name, finding })))
          .filter(({ finding }) => !remediated.has(finding.id));
        const selected = pendingByPath.filter(({ finding }) => paths.some((path) => samePath(path, finding.relativePath)));
        if (!selected.length || paths.some((path) => !selected.some(({ finding }) => samePath(path, finding.relativePath)))) {
          await this.vscode.window.showWarningMessage("SXSY-B122 containment remediation commits may include only exact currently unremediated finding paths.");
          return false;
        }
        if (selected.some(({ step }) => step !== "working_tree")) {
          await this.vscode.window.showWarningMessage("SXSY-B122 local commit cannot claim a history or remote-tracking rewrite; use the dedicated containment history-remediation workflow.");
          return false;
        }
        const actionChoice = await this.vscode.window.showQuickPick([
          { label: "Remove exposed value", description: "Commit the reviewed redacted-value removal on only these finding paths" },
          { label: "Add ignore rule", description: "Commit the reviewed ignore-rule remediation on only these finding paths" }
        ], { placeHolder: `Issue one five-minute no-egress permit for ${selected.length} exact finding(s)` });
        if (!actionChoice) return false;
        const remediationAction = actionChoice.label === "Remove exposed value" ? "remove_exposed_value" as const : "add_ignore_rule" as const;
        const expiresAt = new Date(Date.parse(this.now()) + 5 * 60_000).toISOString();
        const issued = await this.bridge.issueContainmentPermit({
          sessionId,
          expectedIncidentId: containment.value.incident.id,
          expectedIncidentDigest: containment.value.incidentDigest,
          action: remediationAction,
          relativePaths: paths,
          expiresAt
        });
        if (!issued.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 containment remediation permit unavailable: ${issued.message}`); return false; }
        containmentRemediation = {
          permitId: issued.value.permit.id,
          incidentId: issued.value.permit.incidentId,
          fenceEpoch: issued.value.permit.fenceEpoch,
          action: issued.value.permit.action,
          remediatedFindingIds: selected.map(({ finding }) => finding.id)
        };
      }
      const message = await input({ prompt: "Enter the exact local commit message", validateInput: (value) => value.trim() && value.length <= 120 && !/[\r\n\0]/.test(value) ? undefined : "Use one non-empty line of at most 120 characters." });
      if (!message) return false;
      let featureBranch: string | undefined;
      if (git.detached || (git.branch !== undefined && git.branch === git.defaultBranch)) {
        featureBranch = await input({ prompt: "Review the new feature branch (this press creates it, then a fresh press commits against the new target)", validateInput: (value) => validBranchInput(value) ?? (git.defaultBranch === value ? "Choose a non-default feature branch." : undefined) });
        if (!featureBranch) return false;
      }
      mutation = { kind: "local_commit", paths, message, ...(featureBranch ? { featureBranch } : {}), ...(containmentRemediation ? { containmentRemediation } : {}) };
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

  private async presentPlanApprovalReview(review: PlanApprovalWorkflowReview, session: ExtensionManagedSession): Promise<string | undefined> {
    if (review.sessionId !== session.id || review.targetSnapshotId !== session.targetSnapshotId || !session.workspaceRoot
      || !samePath(review.repositoryRoot, session.workspaceRoot) || review.provider !== session.provider
      || review.plan.taskId !== session.taskId || review.plan.revision !== session.planRevision
      || review.plan.expectedTargetTransition.beforeTargetSnapshotId !== review.targetSnapshotId
      || ((review.plan.expectedTargetTransition.expectation === "unchanged") !== (review.plan.expectedTargetTransition.expectedAfterTargetSnapshotId === review.targetSnapshotId))) {
      await this.vscode.window.showWarningMessage("Plan Approval stopped because the protected review packet changed its exact session, target, repository, provider, task, or plan binding.");
      return undefined;
    }
    const approveLabel = `Approve exact protected scope ${review.scopeDigest}`;
    const cancelLabel = "Cancel Plan Approval";
    const items: QuickPickItemLike[] = [
      {
        label: `Objective • plan ${review.plan.revision}`,
        description: review.plan.objective,
        detail: `Plan digest ${review.plan.digest}; task ${review.plan.taskId}; origin session ${review.plan.originSessionId}`
      },
      ...review.plan.steps.map((step, index) => ({
        label: `Step ${index + 1} • ${step.id} • ${step.status}`,
        description: step.summary,
        detail: `Owned files: ${step.ownedFiles.length ? step.ownedFiles.join(" | ") : "(none)"}; dependencies: ${step.dependencies.length ? step.dependencies.join(" | ") : "(none)"}`
      })),
      {
        label: `Expected target transition • ${review.plan.expectedTargetTransition.expectation}`,
        description: `${review.plan.expectedTargetTransition.beforeTargetSnapshotId.slice(0, 12)}… → ${review.plan.expectedTargetTransition.expectedAfterTargetSnapshotId.slice(0, 12)}…`,
        detail: `Before ${review.plan.expectedTargetTransition.beforeTargetSnapshotId}; expected after ${review.plan.expectedTargetTransition.expectedAfterTargetSnapshotId}. This exact transition is immutable plan material and the provider acknowledgement must match it after execution.`
      },
      ...(review.plan.decisions.length
        ? review.plan.decisions.map((decision, index) => ({ label: `Decision ${index + 1}`, description: decision, detail: `Bound to plan ${review.plan.digest}` }))
        : [{ label: "Decisions", description: "(none)", detail: `Bound to plan ${review.plan.digest}` }]),
      {
        label: `Provider provenance • ${review.provider}`,
        description: `${review.contextId} observed ${review.observedAt}; source revision ${review.sourceRevision}`,
        detail: `Provider-context digest ${review.providerContextDigest}; ${review.summary}`
      },
      {
        label: `Adapter provenance • ${review.adapter.id}@${review.adapter.version}`,
        description: review.adapter.moduleSha256,
        detail: "Exact installed adapter module SHA-256 returned by the protected companion."
      },
      {
        label: `Target • ${review.targetSnapshotId}`,
        description: review.repositoryRoot,
        detail: `Session ${review.sessionId}; provider ${review.provider}`
      },
      {
        label: `Protected review scope • ${review.scopeDigest}`,
        description: review.scopeDigest,
        detail: "The full digest below must remain unchanged through confirmation, workflow preparation, and dispatch."
      },
      {
        label: approveLabel,
        description: `Plan ${review.plan.digest}`,
        detail: `Approve only this exact immutable plan and protected scope ${review.scopeDigest}. The companion will reobserve it before issuing one confirmation.`
      },
      {
        label: cancelLabel,
        description: "No authority, confirmation token, workflow artifact, or dispatch",
        detail: `Keep protected scope ${review.scopeDigest} unapproved.`
      }
    ];
    const selected = await this.vscode.window.showQuickPick(items, {
      placeHolder: `Review the entire immutable plan and provenance. Select only Approve exact scope or Cancel. Scope ${review.scopeDigest}`
    });
    if (selected?.label === approveLabel) return review.scopeDigest;
    await this.vscode.window.showInformationMessage(`SXSY-B122 did not approve protected plan scope ${review.scopeDigest}; no confirmation or dispatch was requested.`);
    return undefined;
  }

  private async presentAutomationManifestReview(review: AutomationManifestReview): Promise<string | undefined> {
    const manifest = review.manifest;
    if (manifest.action !== review.action || Date.parse(manifest.expiresAt) <= Date.parse(this.now())) {
      await this.vscode.window.showWarningMessage("Automation stopped because its exact protected manifest changed action or expired before review.");
      return undefined;
    }
    const instructionFileEdit = automationInstructionFileEdit(manifest.action, manifest.proposal);
    const approveLabel = instructionFileEdit
      ? "Approve exact compound_capture manifest and instruction-file edit"
      : `Approve exact ${manifest.action} manifest`;
    const proposal = JSON.stringify(manifest.proposal);
    const proposalChunks = exactUiChunks(proposal, 1_024).map((chunk, index, chunks) => ({
      label: `Exact proposal JSON • segment ${index + 1}/${chunks.length}`,
      description: `Characters ${index * 1_024 + 1}-${index * 1_024 + chunk.length} of ${proposal.length}`,
      detail: chunk
    }));
    const selected = await this.vscode.window.showQuickPick([
      {
        label: `Action • ${manifest.action}`,
        description: `Manifest ${manifest.id}`,
        detail: `Digest ${manifest.digest}; protected review scope ${review.reviewScopeDigest}`
      },
      {
        label: `Target • ${manifest.targetSnapshotId}`,
        description: manifest.repositoryRoot,
        detail: `Session ${manifest.sessionId}; authority ${manifest.authorityId}; provider ${manifest.provider}`
      },
      {
        label: `Task • ${manifest.taskId} / plan ${manifest.planRevision}`,
        description: `${manifest.createdAt} through ${manifest.expiresAt}`,
        detail: "Any target, task, plan, provider, session, authority, lifetime, or proposal change invalidates this review."
      },
      ...proposalChunks,
      ...(instructionFileEdit ? [{
        label: `Instruction-file edit • ${instructionFileEdit.path}`,
        description: `${instructionFileEdit.beforeDigest} → ${instructionFileEdit.afterDigest}`,
        detail: `High-impact instruction mutation: selecting the approval row explicitly consents to editing exactly ${instructionFileEdit.path}, from exact before digest ${instructionFileEdit.beforeDigest} to exact after digest ${instructionFileEdit.afterDigest}.`
      }] : []),
      {
        label: approveLabel,
        description: review.reviewScopeDigest,
        detail: instructionFileEdit
          ? `Explicitly consent to the exact instruction-file edit ${instructionFileEdit.path} (${instructionFileEdit.beforeDigest} → ${instructionFileEdit.afterDigest}) and request one current-user reauthentication bound only to this immutable ${proposal.length}-character manifest proposal.`
          : `Request one current-user reauthentication bound only to this immutable ${proposal.length}-character manifest proposal. The provider proposal remains inert until the matching dispatch consumes it once.`
      },
      {
        label: "Cancel automation review",
        description: "No confirmation or dispatch",
        detail: `Keep manifest ${manifest.id} unapproved.`
      }
    ], { placeHolder: `Review every field of ${manifest.action}; select only the exact approval row to continue` });
    if (selected?.label === approveLabel) return review.reviewScopeDigest;
    await this.vscode.window.showInformationMessage(`SXSY-B122 did not approve automation manifest ${manifest.id}; no confirmation or dispatch was requested.`);
    return undefined;
  }

  private async presentDebugStopReview(review: DebugStopReview): Promise<string | undefined> {
    if (Date.parse(review.expiresAt) <= Date.parse(this.now())) {
      await this.vscode.window.showWarningMessage("Debug stop halted because its exact protected split binding expired before review.");
      return undefined;
    }
    const approveLabel = review.effectKind === "debug_session"
      ? `Stop exact debug session ${review.debugSessionId}`
      : `Stop exact managed Run process ${review.managedProcessId}`;
    const effectRow: QuickPickItemLike = review.effectKind === "debug_session"
      ? {
          label: `Debug effect • ${review.debugSessionId}`,
          description: review.debugConfiguration ?? "invalid debug configuration",
          detail: `Protected debug binding ${review.debugBindingId}; repository ${review.repositoryRoot}`
        }
      : {
          label: `Managed Run effect • ${review.managedProcessId}`,
          description: `Origin operation ${review.originOperationId}`,
          detail: `Exact pinned-runtime child for repository ${review.repositoryRoot}`
        };
    const selected = await this.vscode.window.showQuickPick([
      effectRow,
      {
        label: `Provider authority source • ${review.sourceSessionId}`,
        description: `Authority ${review.authorityId}`,
        detail: `Target ${review.targetSnapshotId}; originating managed operation ${review.originOperationId}`
      },
      {
        label: `Protected split binding • ${review.bindingId}`,
        description: review.bindingDigest,
        detail: `Review scope ${review.reviewScopeDigest}; created ${review.createdAt}; valid through ${review.expiresAt}`
      },
      {
        label: approveLabel,
        description: review.reviewScopeDigest,
        detail: "Request one current-user reauthentication. Dispatch carries the provider authority session only; the companion recovers this exact managed effect from protected state once."
      },
      {
        label: "Cancel managed stop",
        description: "Leave the exact managed effect running",
        detail: "No confirmation, dispatch, or VS Code stop request will be sent."
      }
    ], { placeHolder: "Review the exact provider-authority/debug-effect split binding before requesting stop" });
    if (selected?.label === approveLabel) return review.reviewScopeDigest;
    await this.vscode.window.showInformationMessage(`SXSY-B122 left ${review.effectKind === "debug_session" ? `debug session ${review.debugSessionId}` : `managed Run process ${review.managedProcessId}`} running; no confirmation or dispatch was requested.`);
    return undefined;
  }

  private async presentCouncilResult(modifier: "normal" | "alt", result: ForwardedCommandResult, selectedSessionId: string | undefined): Promise<boolean> {
    const selected = selectedSessionId ? this.sessions.get(selectedSessionId) : undefined;
    if (modifier === "normal") {
      const report = councilReportView(result.data);
      if (!report || !selected?.workspaceRoot || report.targetSnapshotId !== selected.targetSnapshotId || !samePath(report.repositoryRoot, selected.workspaceRoot)) {
        await this.vscode.window.showWarningMessage("SXSY-B122 rejected a malformed or target-substituted durable Council report.");
        return true;
      }
      const items: QuickPickItemLike[] = [
        {
          label: `Report ${report.reportId}`,
          description: `${report.atomic ? "Atomic-capable" : "Advisory only"} • collected ${report.collectedAt}`,
          detail: `Digest ${report.reportDigest}; target ${report.targetSnapshotId}; execution authority: none.`
        },
        ...report.participantDetails.map((participant) => ({
          label: `Participant ${participant.id} • ${participant.provider} • ${participant.status}`,
          description: `Capabilities: ${participant.capabilities.join(" | ")}`,
          detail: `Files: ${councilList(participant.plannedFiles)}. Resources: ${councilList(participant.resources)}. Dependencies: ${councilList(participant.dependencies)}. Diff: ${participant.diffDigest}.`
        })),
        ...councilConflictItems("Path conflict", report.pathConflicts),
        ...councilConflictItems("Resource conflict", report.resourceConflicts),
        ...councilConflictItems("Dependency conflict", report.dependencyConflicts)
      ];
      if (!report.pathConflicts.length && !report.resourceConflicts.length && !report.dependencyConflicts.length) {
        items.push({ label: "Conflicts", description: "None in the exact collected declarations", detail: "No path, resource, or dependency overlap was present in this immutable report." });
      }
      await this.vscode.window.showQuickPick(items, { placeHolder: `Exact read-only Council report ${report.reportDigest}; selecting an item does not approve or execute it` });
      return true;
    }

    const recommendation = councilRecommendationView(result.data);
    if (!recommendation || !selected?.workspaceRoot || recommendation.targetSnapshotId !== selected.targetSnapshotId || !samePath(recommendation.repositoryRoot, selected.workspaceRoot)) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected a malformed or target-substituted Council recommendation artifact.");
      return true;
    }
    const approveLabel = `Approve exact recommendation ${recommendation.recommendationDigest}`;
    const cancelLabel = "Leave recommendation prepared without approval";
    const items: QuickPickItemLike[] = [
      {
        label: `Recommendation ${recommendation.recommendationId}`,
        description: `${recommendation.ready ? "Ready for acknowledgement" : "Not ready"} • ${recommendation.participantSessionIds.length} participants`,
        detail: `Recommendation ${recommendation.recommendationDigest}; report ${recommendation.reportId} / ${recommendation.reportDigest}; target ${recommendation.targetSnapshotId}.`
      },
      ...Object.values(recommendation.assignments).map((assignment) => ({
        label: `Assignment ${assignment.sessionId}`,
        description: `Files: ${councilList(assignment.paths)}`,
        detail: `Resources: ${councilList(assignment.resources)}. This recommendation grants no execution authority.`
      })),
      ...(recommendation.ready ? [{ label: approveLabel, description: "Distinct second exact-digest acknowledgement", detail: "A separate authenticated companion call will reobserve the target and participants. It cannot execute the recommendation." }] : []),
      { label: cancelLabel, description: "No approval call", detail: "The immutable recommendation remains prepared and non-executing." }
    ];
    const picked = await this.vscode.window.showQuickPick(items, { placeHolder: `Separate exact-digest Council review for ${recommendation.recommendationDigest}; preparation alone never approves or executes` });
    if (!recommendation.ready || picked?.label !== approveLabel) {
      await this.vscode.window.showInformationMessage(`SXSY-B122 left Council recommendation ${recommendation.recommendationId} prepared without approval or execution authority.`);
      return true;
    }
    const approvalOperationId = `council-review:${this.idFactory()}`;
    const approved = await this.bridge.approveCouncilRecommendation({
      recommendationId: recommendation.recommendationId,
      recommendationDigest: recommendation.recommendationDigest,
      approvalOperationId,
      repositoryRoot: recommendation.repositoryRoot,
      targetSnapshotId: recommendation.targetSnapshotId,
      ...(selectedSessionId ? { sessionId: selectedSessionId } : {})
    });
    if (!approved.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 Council recommendation approval stopped: ${approved.message}`);
      return true;
    }
    await this.vscode.window.showInformationMessage(`SXSY-B122 approved exact Council recommendation ${approved.value.id}; it carries no execution authority.`);
    return true;
  }

  private async prepareWorkflowForCommand(command: ChordCommand, sessionId: string | undefined, authorityId: string | undefined, confirmationToken: string | undefined, confirmationScopeDigest: string | undefined): Promise<true | ExtensionWorkflowArtifact | false> {
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
    const listed = await this.bridge.listWorkflows();
    if (!listed.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 workflow registry unavailable: ${listed.message}`);
      return false;
    }
    const pending = listed.value.filter((artifact) => artifact.action === action && artifact.sessionId === session.id
      && artifact.targetSnapshotId === session.targetSnapshotId && samePath(artifact.repositoryRoot, session.workspaceRoot!) && artifact.status === "prepared");
    if (pending.length > 1) {
      await this.cancelPreparedWorkflowSelection(pending, "Multiple legacy prepared artifacts block this exact workflow");
      return false;
    }
    if (pending.length === 1) {
      const existing = pending[0]!;
      if (existing.authorityId !== authorityId) {
        await this.cancelPreparedWorkflowSelection([existing], "The existing prepared artifact is bound to a different exact authority and must be explicitly cancelled before replacement");
        return false;
      }
      if (action === "plan_approval") {
        const payload = existing.payload;
        const confirmationMatches = !!confirmationToken && !!confirmationScopeDigest && payload.kind === "plan" && payload.mode === "approve"
          && payload.confirmationDigest === createHash("sha256").update(confirmationToken, "utf8").digest("hex")
          && payload.confirmationScopeDigest === confirmationScopeDigest;
        if (!confirmationMatches) {
          await this.cancelPreparedWorkflowSelection([existing], "The existing Plan Approval is bound to a different one-time confirmation or protected plan review scope and must be explicitly cancelled before replacement");
          return false;
        }
      }
      await this.vscode.window.showInformationMessage(`SXSY-B122 reused the exact prepared ${action} artifact ${existing.id}; it still grants no execution authority.`);
      return existing;
    }

    let intent: ExtensionWorkflowPreparationIntent | undefined;
    try { intent = await this.collectWorkflowIntent(action, session, confirmationToken, confirmationScopeDigest); }
    catch (error) { await this.vscode.window.showWarningMessage(`SXSY-B122 workflow preparation stopped: ${error instanceof Error ? error.message : "reviewed input was unavailable"}`); return false; }
    if (!intent) return false;
    const prepared = await this.bridge.prepareWorkflow({ action, sessionId: session.id, authorityId, intent });
    if (!prepared.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 could not prepare the typed ${action} artifact: ${prepared.message}`);
      return false;
    }
    if (!isRecord(prepared.value) || typeof prepared.value.id !== "string" || typeof prepared.value.digest !== "string") {
      await this.vscode.window.showWarningMessage(`SXSY-B122 received no exact immutable ${action} artifact from the typed preparation route.`);
      return action === "authority_broadcast" ? true : false;
    }
    await this.vscode.window.showInformationMessage(`SXSY-B122 prepared immutable ${action} artifact ${prepared.value.id} (${prepared.value.digest.slice(0, 12)}…). It does not grant authority by itself.`);
    return prepared.value;
  }

  private async cancelPreparedWorkflowSelection(artifacts: readonly ExtensionWorkflowArtifact[], reason: string): Promise<void> {
    const candidates = artifacts.filter((artifact) => artifact.status === "prepared" && !!artifact.authorityId);
    if (!candidates.length) {
      await this.vscode.window.showWarningMessage(`${reason}. No exact cancellable prepared artifact was returned; nothing was changed.`);
      return;
    }
    const items = candidates.map((artifact) => ({
      label: `${artifact.action}: ${artifact.id}`,
      description: `${artifact.digest} / authority ${artifact.authorityId}`,
      detail: `Session ${artifact.sessionId}; target ${artifact.targetSnapshotId}; repository ${artifact.repositoryRoot}; prepared ${artifact.createdAt}`
    }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder: `${reason}. Choose one exact prepared artifact to review for cancellation.` });
    const artifact = selected ? candidates[items.indexOf(selected)] : undefined;
    if (!artifact) {
      await this.vscode.window.showWarningMessage("SXSY-B122 kept every prepared workflow artifact; no replacement was prepared or dispatched.");
      return;
    }
    const confirmation = await this.vscode.window.showQuickPick([
      { label: `Cancel exact artifact ${artifact.id}`, description: `${artifact.action} / ${artifact.digest}`, detail: `Session ${artifact.sessionId}; authority ${artifact.authorityId}; target ${artifact.targetSnapshotId}` },
      { label: "Keep this prepared artifact", description: "No workflow state changes", detail: "Return without cancellation, preparation, or dispatch." }
    ], { placeHolder: "Final confirmation: cancel only the exact selected prepared artifact?" });
    if (!confirmation || confirmation.label !== `Cancel exact artifact ${artifact.id}`) {
      await this.vscode.window.showInformationMessage(`SXSY-B122 kept prepared artifact ${artifact.id}; no replacement was prepared or dispatched.`);
      return;
    }
    const cancelled = await this.bridge.cancelWorkflow({ artifactId: artifact.id, sessionId: artifact.sessionId, authorityId: artifact.authorityId });
    if (!cancelled.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 could not cancel exact prepared artifact ${artifact.id}: ${cancelled.message}`);
      return;
    }
    const value = cancelled.value;
    if (value.digest !== artifact.digest || value.action !== artifact.action || value.targetSnapshotId !== artifact.targetSnapshotId
      || !samePath(value.repositoryRoot, artifact.repositoryRoot) || value.status !== "cancelled") {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected a workflow-cancellation receipt that changed the selected immutable artifact binding.");
      return;
    }
    await this.vscode.window.showInformationMessage(`SXSY-B122 cancelled exact prepared ${artifact.action} artifact ${artifact.id}. Press the chord again to prepare a replacement.`);
  }

  private async collectWorkflowIntent(action: ExtensionWorkflowAction, session: ExtensionManagedSession, confirmationToken: string | undefined, confirmationScopeDigest: string | undefined): Promise<ExtensionWorkflowPreparationIntent | undefined> {
    const input = this.vscode.window.showInputBox;
    if (action === "option_provider") {
      if (!input) { await this.vscode.window.showWarningMessage("SXSY-B122 cannot collect the one bounded decision question in this VS Code host."); return undefined; }
      const question = await this.reviewedText("Review the exact decision question", "Which safe implementation should be selected?");
      const context = question ? await this.reviewedText("Add bounded context for this decision (the provider will generate options)", session.taskId ? `Task ${session.taskId}, plan ${session.planRevision ?? "unbound"}` : "Current exact selected target") : undefined;
      return question && context ? { kind: "decision", question, context } : undefined;
    }
    if (action === "plan_approval") {
      if (!confirmationToken) { await this.vscode.window.showWarningMessage("Plan Approval stopped because the companion did not issue exact current-user confirmation for this plan execution."); return undefined; }
      if (!confirmationScopeDigest) { await this.vscode.window.showWarningMessage("Plan Approval stopped because the companion did not bind confirmation to the exact protected plan review scope."); return undefined; }
      return { kind: "plan_approval", confirmationToken, confirmationScopeDigest };
    }
    if (action === "handoff" || action === "handoff_queue" || action === "handoff_immediate") {
      if (!session.taskId || !session.planRevision) { await this.vscode.window.showWarningMessage("Handoff requires the selected session to carry an exact task and plan revision."); return undefined; }
      const recipient = await this.showSessionQueue("all", "Choose the exact Handoff recipient", (candidate) => candidate.id !== session.id && candidate.workspaceRoot !== undefined && samePath(candidate.workspaceRoot, session.workspaceRoot!) && candidate.targetSnapshotId === session.targetSnapshotId);
      if (!recipient) return undefined;
      const route = action === "handoff" ? "default" : action === "handoff_queue" ? "queue" : "immediate";
      return { kind: "handoff", recipientSessionId: recipient.id, route };
    }
    if (action === "authority_broadcast") {
      return this.collectAuthorityBroadcastIntent(session);
    }
    return { kind: "none" };
  }

  private async collectAuthorityBroadcastIntent(source: ExtensionManagedSession): Promise<ExtensionWorkflowPreparationIntent | undefined> {
    const current = await this.bridge.listSessions();
    if (!current.ok) { await this.vscode.window.showWarningMessage(`Authority Broadcast session registry unavailable: ${current.message}`); return undefined; }
    this.reconcileCurrentSessions(current.value);
    const requirement: ProviderSelectionRequirement = { capabilities: ["registered", "observable", "controllable"], statuses: ["verified_blocked"] };
    const candidates = [...this.sessions.values()].filter((candidate) => {
      const binding = providerSelectionBinding(candidate, requirement);
      return !!binding && !!source.workspaceRoot && !!source.targetSnapshotId
        && samePath(binding.workspaceRoot, source.workspaceRoot) && binding.targetSnapshotId === source.targetSnapshotId;
    });
    if (candidates.length < 1 || candidates.length > 64) {
      await this.vscode.window.showWarningMessage(candidates.length ? "Authority Broadcast stopped because the protected blocked-recipient set exceeds 64 sessions." : "Authority Broadcast requires at least one exact verified-blocked Claude or Codex recipient on this repository and TargetSnapshot.");
      return undefined;
    }
    let selected = candidates;
    while (true) {
      const items: QuickPickItemLike[] = [
        { label: "Use exact recipient set", description: `${selected.length} individualized protected packet(s)`, detail: "Prepare immutable packets for this exact set; no provider message is sent yet." },
        { label: "Edit exact recipient set", description: "Review bounded managed-session IDs", detail: "Unknown, duplicate, non-blocked, cross-target, or under-capability sessions are rejected." },
        { label: "Cancel without preparing", description: "No artifact, confirmation, or provider message", detail: "Return without changing protected workflow state." },
        ...selected.map((candidate) => ({
          label: `${candidate.provider}: ${candidate.id}`,
          description: `${candidate.status} / task ${candidate.taskId ?? "unbound"} / plan ${candidate.planRevision ?? "unbound"}`,
          detail: `Exact target ${candidate.targetSnapshotId}; repository ${candidate.workspaceRoot}`
        }))
      ];
      const choice = await this.vscode.window.showQuickPick(items, { placeHolder: "Review protected blocked recipients before immutable Authority Broadcast packet preparation" });
      if (!choice || choice.label === "Cancel without preparing") {
        await this.vscode.window.showInformationMessage("SXSY-B122 cancelled Authority Broadcast recipient review; no artifact, confirmation, or provider message was created.");
        return undefined;
      }
      if (choice.label === "Use exact recipient set") return { kind: "authority_broadcast", recipientSessionIds: selected.map((candidate) => candidate.id) };
      if (choice.label !== "Edit exact recipient set") continue;
      const raw = await this.vscode.window.showInputBox?.({ prompt: "Edit exact verified-blocked recipient session IDs (comma-separated)", value: selected.map((candidate) => candidate.id).join(", ") });
      if (raw === undefined) {
        await this.vscode.window.showInformationMessage("SXSY-B122 cancelled Authority Broadcast recipient editing; no artifact, confirmation, or provider message was created.");
        return undefined;
      }
      const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
      if (ids.length < 1 || ids.length > 64 || new Set(ids).size !== ids.length) {
        await this.vscode.window.showWarningMessage("Authority Broadcast recipient editing rejected an empty, unbounded, or duplicate recipient set.");
        return undefined;
      }
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const edited = ids.map((id) => byId.get(id));
      if (edited.some((candidate) => !candidate)) {
        await this.vscode.window.showWarningMessage("Authority Broadcast recipient editing included an unknown or ineligible session; every recipient must remain exact, verified blocked, same-target, and catalog-qualified.");
        return undefined;
      }
      selected = edited as ExtensionManagedSession[];
    }
  }

  private async presentAuthorityBroadcastReview(artifact: ExtensionWorkflowArtifact): Promise<string | undefined> {
    let packets: readonly AuthorityPacketReview[];
    try { packets = authorityPacketReviews(artifact); }
    catch (error) {
      await this.vscode.window.showWarningMessage(`Shift Authority rejected a malformed protected packet artifact: ${error instanceof Error ? error.message : "invalid packet binding"}`);
      return undefined;
    }
    const current = await this.bridge.listSessions();
    if (!current.ok) { await this.vscode.window.showWarningMessage(`Shift Authority could not revalidate exact packet recipients: ${current.message}`); return undefined; }
    this.reconcileCurrentSessions(current.value);
    for (const packet of packets) {
      const session = this.sessions.get(packet.recipientSessionId);
      const requirement: ProviderSelectionRequirement = { capabilities: ["registered", "observable", "controllable"], statuses: ["verified_blocked"] };
      const binding = providerSelectionBinding(session, requirement);
      if (!binding || binding.provider !== packet.provider || !samePath(binding.workspaceRoot, packet.repositoryRoot)
        || binding.targetSnapshotId !== packet.targetSnapshotId || binding.taskId !== packet.taskId
        || binding.planRevision !== packet.planRevision || binding.adapterVersion !== packet.adapterVersion) {
        await this.vscode.window.showWarningMessage("Shift Authority stopped because an exact recipient status, target, task, plan, provider, capability, or adapter binding changed after packet preparation.");
        return undefined;
      }
    }
    const scopeDigest = authorityBroadcastReviewScopeDigest(artifact as unknown as WorkflowArtifact);
    const packetItems = packets.map((packet) => ({
      label: `${packet.provider}: ${packet.recipientSessionId}`,
      description: `task ${packet.taskId} / plan ${packet.planRevision} / verified blocked`,
      detail: `Pending ${packet.pendingRequest.action} request ${packet.pendingRequest.requestId}; target ${packet.targetSnapshotId}; plan digest ${packet.pendingRequest.planDigest}; grant ${packet.grantId}; packet ${packet.matchDigest}`
    }));
    const accepted = await this.vscode.window.showQuickPick([
      { label: "Accept exact packet review", description: scopeDigest, detail: "Request one fresh confirmation bound to this immutable artifact and ordered recipient/packet digest set." },
      { label: "Keep prepared artifact for reconciliation", description: artifact.id, detail: "Do not request confirmation and do not send any provider message." },
      ...packetItems
    ], { placeHolder: `Review ${packetItems.length} immutable Authority Broadcast packets, then choose whether to request fresh exact-scope confirmation; no packet has been sent` });
    if (!accepted || accepted.label !== "Accept exact packet review") {
      await this.vscode.window.showInformationMessage(`SXSY-B122 kept prepared Authority Broadcast artifact ${artifact.id} for reconciliation; no fresh confirmation or provider message was sent.`);
      return undefined;
    }
    return scopeDigest;
  }

  private async revalidateProviderSelection(command: ChordCommand, expected: ProviderSelectionBinding): Promise<boolean> {
    const requirement = providerSelectionRequirement(command);
    if (!requirement) return true;
    const current = await this.bridge.listSessions();
    if (!current.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 could not revalidate the exact provider session: ${current.message}`); return false; }
    this.reconcileCurrentSessions(current.value);
    const observed = providerSelectionBinding(this.sessions.get(expected.id), requirement);
    if (!observed || !sameProviderSelectionBinding(observed, expected)) {
      await this.vscode.window.showWarningMessage("SXSY-B122 stopped because the exact provider session changed, became stale, or fell below its catalog capability floor after preparation.");
      return false;
    }
    return true;
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

  private async executeLocalHostAction(action: ForwardedHostAction, command: ChordCommand, authorization: ForwardedHostActionAuthorization, result: ForwardedCommandResult, preparedManagedTerminal?: PreparedManagedTerminal, originSessionId?: string): Promise<string> {
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
        if (!action.workspaceRoot) throw new Error("The blocker queue is not bound to an exact repository root.");
        await this.showSessionQueue("verified_blocked", `Verified blocked sessions for ${action.workspaceRoot}`, (session) => !!session.workspaceRoot && samePath(session.workspaceRoot, action.workspaceRoot!));
        return `Opened the verified blocker queue for ${action.workspaceRoot}.`;
      case "show_done_queue":
        if (!action.workspaceRoot) throw new Error("The finished queue is not bound to an exact repository root.");
        await this.showSessionQueue("verified_finished", `Verified finished sessions for ${action.workspaceRoot}`, (session) => !!session.workspaceRoot && samePath(session.workspaceRoot, action.workspaceRoot!));
        return `Opened the verified finished queue for ${action.workspaceRoot}.`;
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
        return this.startBoundDebugSession(action, result, originSessionId);
      }
      case "stop_vscode_debug": {
        return this.stopBoundDebugSession(action, originSessionId);
      }
      case "configure_python_venv": {
        if (!action.workspaceRoot || !action.pythonInterpreter || !action.pythonInterpreterIdentity) throw new Error("The companion did not bind the Python environment to an exact workspace and protected interpreter identity.");
        const workspaceRoot = action.workspaceRoot;
        const interpreter = action.pythonInterpreter;
        const allowedInterpreters = [resolve(workspaceRoot, ".venv", "Scripts", "python.exe"), resolve(workspaceRoot, ".venv", "bin", "python")];
        if (!allowedInterpreters.some((candidate) => samePath(candidate, interpreter))) throw new Error("The companion supplied a Python interpreter outside the exact repo-local .venv boundary.");
        if (!samePath(action.pythonInterpreterIdentity.canonicalPath, interpreter)) throw new Error("The protected Python interpreter identity changed its canonical path.");
        const folder = (this.vscode.workspace.workspaceFolders ?? []).find((candidate) => samePath(candidate.uri.fsPath, workspaceRoot));
        if (!folder) throw new Error("The exact Python workspace is not open in this VS Code host.");
        const python = this.vscode.workspace.getConfiguration("python", folder.uri);
        if (!python.update) throw new Error("This VS Code host cannot persist an exact workspace-folder interpreter selection.");
        await this.assertPythonInterpreterIdentity(interpreter, action.pythonInterpreterIdentity);
        await python.update("defaultInterpreterPath", interpreter, 3);
        this.assertAdmissionActive();
        await this.assertPythonInterpreterIdentity(interpreter, action.pythonInterpreterIdentity);
        this.assertAdmissionActive();
        const scripts = dirname(interpreter);
        const inheritedPath = process.env.Path ?? process.env.PATH ?? "";
        const terminal = this.vscode.window.createTerminal({ name: "SXSY-B122 .venv", cwd: workspaceRoot, env: { VIRTUAL_ENV: dirname(scripts), PATH: inheritedPath ? `${scripts}${delimiter}${inheritedPath}` : scripts } });
        terminal.show();
        await this.registerTerminal(terminal, undefined, workspaceRoot);
        return "Selected the exact repo-local Python interpreter and opened a terminal with that environment activated.";
      }
      case "new_vscode_window":
        await this.executeCommand("workbench.action.newWindow");
        return "Opened a new VS Code window.";
      case "focus_integrated_terminal":
        if (!action.workspaceRoot) throw new Error("The integrated-terminal action is not bound to an exact workspace root.");
        await this.focusIntegratedTerminal(action.workspaceRoot);
        return `Focused the integrated VS Code terminal for ${action.workspaceRoot}.`;
      case "open_compound_palette":
        return this.openCompoundPalette(action.id, action.workspaceRoot);
      case "show_voice_center":
        if (command.control !== "VOICE") throw new Error("The Voice Center host action is not bound to a canonical Voice chord.");
        if (command.modifier === "normal") return this.openVoiceCenter();
        if (command.modifier === "shift") return this.switchDurableVoiceProvider();
        if (command.modifier === "alt") {
          const requirement = providerSelectionRequirement(command);
          const expected = originSessionId && requirement ? providerSelectionBinding(this.sessions.get(originSessionId), requirement) : undefined;
          if (!originSessionId || !expected) throw new Error("Alt Voice no longer has its exact current provider source session.");
          const outcome = await this.runDedicatedVoiceBinding(originSessionId, expected);
          if (outcome.outcome === "needs_reconciliation") throw new HostEffectError(outcome.summary, "ambiguous");
          if (outcome.outcome !== "handled") throw new Error(outcome.summary);
          return outcome.summary;
        }
        if (command.modifier === "shift_alt") return this.bindDurableVoiceSession(action.workspaceRoot, originSessionId);
        throw new Error("The claimed Voice modifier is not assigned to the durable Voice Center lifecycle.");
      case "switch_voice_provider": {
        return this.switchDurableVoiceProvider();
      }
      case "show_voice_session_picker":
        return this.bindDurableVoiceSession();
      case "show_pipeline_failure_trace":
        return this.presentPipelineFailureTrace(result);
    }
    throw new Error(`The installed VS Code extension does not claim the companion-owned ${action.kind} host action.`);
  }

  private async assertPythonInterpreterIdentity(interpreter: string, expected: RepositoryExecutableIdentitySummary): Promise<void> {
    const requested = resolve(interpreter);
    const link = await lstat(requested);
    if (!link.isFile() || link.isSymbolicLink() || link.size <= 0 || link.size > 2 * 1024 * 1024 * 1024) throw new Error("The repo-local Python interpreter is absent, linked/reparsed, or outside its bounded size.");
    const canonical = await realpath(requested);
    if (!samePath(canonical, requested) || !samePath(canonical, expected.canonicalPath)) throw new Error("The repo-local Python interpreter resolved through a substituted filesystem path.");
    const before = await stat(canonical);
    const beforeIdentity = await exactFilesystemIdentity(canonical);
    const digest = await sha256File(canonical);
    const after = await stat(canonical);
    const afterIdentity = await exactFilesystemIdentity(canonical);
    if (!before.isFile() || !after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || beforeIdentity.device !== afterIdentity.device || beforeIdentity.inode !== afterIdentity.inode
      || digest !== expected.sha256 || after.size !== expected.size || after.mtimeMs !== expected.modifiedMs
      || afterIdentity.device !== expected.device || afterIdentity.inode !== expected.inode) {
      throw new Error("The repo-local Python interpreter changed path, content, file identity, size, or modification time at the final host-effect boundary.");
    }
  }

  private async startBoundDebugSession(action: ForwardedHostAction, result: ForwardedCommandResult, originSessionId: string | undefined): Promise<string> {
    if (!action.workspaceRoot || !action.debugConfiguration || !result.operationId || !originSessionId) throw new Error("The companion did not bind debug to an exact operation, session, workspace, and launch configuration.");
    const workspaceRoot = action.workspaceRoot;
    const debugConfiguration = action.debugConfiguration;
    const operationId = exactDebugReference(result.operationId, "debug origin operation ID");
    const originSession = this.sessions.get(originSessionId);
    if (!originSession?.workspaceRoot || !samePath(originSession.workspaceRoot, workspaceRoot)) throw new Error("The debug host action changed its exact originating managed session or workspace.");
    const folder = (this.vscode.workspace.workspaceFolders ?? []).find((candidate) => samePath(candidate.uri.fsPath, workspaceRoot));
    if (!folder) throw new Error("The exact debug workspace is not open in this VS Code host.");
    const matches = this.debugConfigurations().filter((configuration) => configuration.name === debugConfiguration);
    if (matches.length !== 1) throw new Error("The exact verified debug configuration is missing or ambiguous in this VS Code host.");
    const prior = [...this.debugBindings.values()].find((candidate) => candidate.originOperationId === operationId);
    if (prior) {
      if (prior.originSessionId !== originSessionId || !samePath(prior.workspaceRoot, workspaceRoot) || prior.configuration !== debugConfiguration) throw new Error("The debug origin operation is already bound to a different exact host effect.");
      if (prior.status === "running" && prior.debugSessionId && this.debugSessionObjects.has(prior.debugSessionId)) return `VS Code debug configuration ${prior.configuration} is already bound to operation ${operationId}.`;
      throw new HostEffectError("The exact debug origin operation has an unresolved durable start; no second debug session was launched.", "ambiguous");
    }
    if ([...this.debugBindings.values()].some((candidate) => candidate.status !== "stopping" && candidate.configuration === debugConfiguration && samePath(candidate.workspaceRoot, workspaceRoot))) {
      throw new Error("An exact debug session with the same workspace and configuration is already active or unresolved.");
    }
    const binding: StoredDebugBinding = {
      version: 1,
      bindingId: action.id,
      originOperationId: operationId,
      originSessionId,
      workspaceRoot,
      configuration: debugConfiguration,
      ...(originSession.targetSnapshotId ? { targetSnapshotId: originSession.targetSnapshotId } : {}),
      startedAt: this.now(),
      status: "starting"
    };
    this.debugBindings.set(binding.bindingId, binding);
    await this.persistDebugBindings();
    const pending = createPendingDebugStart(binding.bindingId);
    this.pendingDebugStarts.set(binding.bindingId, pending);
    let started = false;
    try {
      this.assertAdmissionActive();
      started = await this.vscode.debug.startDebugging(folder, action.debugConfiguration, { noDebug: false });
      if (!started) {
        this.debugBindings.delete(binding.bindingId);
        await this.persistDebugBindings();
        throw new Error("VS Code refused to start the exact verified debug configuration.");
      }
      const running = await boundedPromise(pending.promise, this.debugLifecycleTimeoutMs, "VS Code did not publish the exact started debug-session identity within the bounded window.");
      return `Started and durably bound VS Code debug configuration ${running.configuration} to operation ${running.originOperationId}.`;
    } catch (error) {
      if (started && this.debugBindings.has(binding.bindingId) && !(error instanceof HostEffectError)) throw new HostEffectError(error instanceof Error ? error.message : "The started debug session requires reconciliation.", "ambiguous");
      throw error;
    } finally {
      this.pendingDebugStarts.delete(binding.bindingId);
    }
  }

  private async registerManagedRunEffect(result: ForwardedCommandResult, sourceSessionId: string): Promise<boolean> {
    const source = this.sessions.get(sourceSessionId);
    const raw = result.data?.managedRun;
    const managedProcessId = result.data?.managedProcessId;
    if (result.status !== "running" || !source?.workspaceRoot || !source.targetSnapshotId || !isRecord(raw)
      || !exactRecordKeys(raw, ["version", "kind", "managedProcessId", "originOperationId", "originSessionId", "workspaceRoot", "targetSnapshotId"])
      || raw.version !== 1 || raw.kind !== "managed-run" || typeof managedProcessId !== "string"
      || typeof raw.managedProcessId !== "string" || raw.managedProcessId !== managedProcessId || !/^managed:[a-f0-9]{64}$/.test(raw.managedProcessId)
      || typeof raw.originOperationId !== "string" || raw.originOperationId !== result.operationId
      || typeof raw.originSessionId !== "string" || raw.originSessionId !== sourceSessionId
      || typeof raw.workspaceRoot !== "string" || !samePath(raw.workspaceRoot, source.workspaceRoot)
      || typeof raw.targetSnapshotId !== "string" || raw.targetSnapshotId !== source.targetSnapshotId) return false;
    const id = `managed-run-effect:${createHash("sha256").update(raw.managedProcessId).digest("hex")}`;
    const effect: ExtensionManagedSession = {
      id,
      provider: "generic",
      surface: "vscode_window",
      capabilities: ["registered"],
      status: "running",
      workspaceRoot: source.workspaceRoot,
      targetSnapshotId: source.targetSnapshotId,
      plannedFiles: [],
      lastHeartbeat: this.now(),
      adapterVersion: this.extensionVersion,
      metadata: {
        "sxsy-b122.kind": "managed-run",
        "sxsy-b122.managedProcessId": raw.managedProcessId,
        "sxsy-b122.runOriginOperationId": raw.originOperationId,
        "sxsy-b122.runOriginSessionId": raw.originSessionId,
        "sxsy-b122.runWorkspaceRoot": raw.workspaceRoot
      }
    };
    const existing = this.sessions.get(id);
    if (existing) return sameManagedRunEffect(existing, effect);
    const registered = await this.bridge.registerSession(effect);
    if (!registered.ok || !sameManagedRunEffect(registered.value, effect)) return false;
    this.sessions.set(id, registered.value);
    return true;
  }

  private async retireCommittedManagedRunEffect(result: ForwardedCommandResult, selected: ManagedStopSelection): Promise<string | undefined> {
    if (selected.effectKind !== "managed_run" || !selected.managedProcessId) return "The completed stop was no longer bound to one exact durable managed Run effect.";
    const data = result.data;
    if (!data || data.managedRunEffectSessionId !== selected.effect.id
      || data.managedProcessId !== selected.managedProcessId
      || data.managedRunOriginOperationId !== selected.originOperationId) {
      return "The completed stop response changed or omitted the exact managed child, effect session, or origin operation identity; the effect remains reconciliation-visible.";
    }
    const expected: ExtensionManagedSession = { ...selected.effect, status: "verified_finished" };
    const updated = await this.bridge.updateStatus(selected.effect.id, "verified_finished");
    if (!updated.ok || !sameManagedRunEffect(updated.value, expected)) {
      return "The managed child reported a committed stop, but its exact durable effect session could not be retired; reconciliation is required before replay.";
    }
    this.sessions.set(updated.value.id, updated.value);
    return undefined;
  }

  private async stopBoundDebugSession(action: ForwardedHostAction, providerSourceSessionId: string | undefined): Promise<string> {
    if (!action.workspaceRoot || !action.debugConfiguration || !action.debugSessionId || !action.debugEffectSessionId
      || !action.debugBindingId || !action.debugOriginOperationId || !providerSourceSessionId
      || action.debugEffectSessionId === providerSourceSessionId) throw new Error("The companion did not bind debug stop to distinct exact provider-source and debug-effect sessions, origin operation, binding, workspace, and configuration.");
    const binding = [...this.debugBindings.values()].find((candidate) => candidate.debugSessionId === action.debugSessionId);
    if (!binding || binding.status !== "running" || binding.managedSessionId !== action.debugEffectSessionId
      || binding.originSessionId !== providerSourceSessionId || binding.bindingId !== action.debugBindingId
      || binding.originOperationId !== action.debugOriginOperationId || binding.configuration !== action.debugConfiguration
      || !samePath(binding.workspaceRoot, action.workspaceRoot)) throw new Error("The requested VS Code debug session is absent, stale, ambiguous, or bound to a different origin.");
    const debugSession = this.debugSessionObjects.get(action.debugSessionId)
      ?? (this.vscode.debug.activeDebugSession?.id === action.debugSessionId ? this.vscode.debug.activeDebugSession : undefined);
    if (!debugSession) throw new Error("The exact durable debug identity is not active in this VS Code host.");
    const stopping: StoredDebugBinding = { ...binding, status: "stopping" };
    this.debugBindings.set(binding.bindingId, stopping);
    await this.persistDebugBindings();
    const pending = createPendingDebugStop(action.debugSessionId);
    this.pendingDebugStops.set(action.debugSessionId, pending);
    let accepted = false;
    try {
      this.assertAdmissionActive();
      accepted = await this.vscode.debug.stopDebugging(debugSession);
      if (!accepted) {
        this.debugBindings.set(binding.bindingId, binding);
        await this.persistDebugBindings();
        throw new Error("VS Code refused to stop the exact bound debug session.");
      }
      await boundedPromise(pending.promise, this.debugLifecycleTimeoutMs, "VS Code accepted debug stop but did not publish exact termination within the bounded window.");
      return `Stopped exact VS Code debug session ${action.debugSessionId} from operation ${action.debugOriginOperationId}.`;
    } catch (error) {
      if (accepted && this.debugBindings.has(binding.bindingId)) throw new HostEffectError(error instanceof Error ? error.message : "The debug stop requires reconciliation.", "ambiguous");
      throw error;
    } finally {
      this.pendingDebugStops.delete(action.debugSessionId);
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
    this.reconcileCurrentSessions(current.value);
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

  private async bindDurableVoiceSession(expectedWorkspaceRoot?: string, expectedSessionId?: string): Promise<string> {
    const current = await this.bridge.currentVoice();
    if (!current.ok || !current.value || current.value.status === "ended") throw new Error("No current durable voice binding is available.");
    if (expectedWorkspaceRoot && !samePath(current.value.repositoryRoot, expectedWorkspaceRoot)) throw new Error("The active voice conversation changed its exact repository before session selection.");
    const exactSource = expectedSessionId ? this.sessions.get(expectedSessionId) : undefined;
    if (expectedSessionId && (!exactSource?.workspaceRoot || !samePath(exactSource.workspaceRoot, current.value.repositoryRoot) || exactSource.targetSnapshotId !== current.value.targetSnapshotId)) throw new Error("The durable Voice picker changed its exact source TargetSnapshot before selection.");
    const session = await this.showSessionQueue("all", "Choose the single exact managed session for native voice", (candidate) => candidate.workspaceRoot !== undefined && samePath(candidate.workspaceRoot, current.value!.repositoryRoot) && candidate.targetSnapshotId === current.value!.targetSnapshotId && (candidate.surface === "vscode_terminal" || candidate.surface === "vscode_window"));
    if (!session) throw new Error("Voice session selection was cancelled.");
    const bound = await this.bridge.bindVoice(current.value.id, session.id);
    if (!bound.ok) throw new Error(`Voice was not bound to the selected session: ${bound.message}`);
    await this.focusManagedSession(session);
    return `Bound voice ${bound.value.id} to the single exact managed session ${session.id}.`;
  }

  /** Alt Voice effect body; invoked only inside the canonical authorized durable host-action lifecycle. */
  private async runDedicatedVoiceBinding(sessionId: string, expectedSession: ProviderSelectionBinding): Promise<ReanchorUiOutcome> {
    const session = this.sessions.get(sessionId);
    if (!session || (session.surface !== "vscode_terminal" && session.surface !== "vscode_window")) {
      await this.vscode.window.showWarningMessage("SXSY-B122 Alt Voice requires one exact running managed Claude or Codex VS Code session.");
      return { outcome: "failed_before_dispatch", summary: "The selected provider session was not an eligible VS Code voice-binding target; no bind was requested." };
    }
    const current = await this.bridge.currentVoice();
    if (!current.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 could not read the protected voice binding: ${current.message}`);
      return { outcome: "failed_before_dispatch", summary: "The protected voice binding could not be read; no bind was requested." };
    }
    if (!current.value || current.value.status !== "active") {
      await this.vscode.window.showWarningMessage("SXSY-B122 Alt Voice requires one active durable voice conversation; muted, interrupted, or ended voice state is not rebound.");
      return { outcome: "failed_before_dispatch", summary: "The durable voice conversation was not active; no bind was requested." };
    }
    if (!samePath(current.value.repositoryRoot, session.workspaceRoot!) || current.value.targetSnapshotId !== session.targetSnapshotId) {
      await this.vscode.window.showWarningMessage("SXSY-B122 stopped because the focused managed session does not match the voice conversation's exact repository and TargetSnapshot.");
      return { outcome: "failed_before_dispatch", summary: "The voice conversation and selected provider session had different exact targets; no bind was requested." };
    }
    const review = await this.vscode.window.showQuickPick([
      {
        label: "Bind active voice to exact selected session",
        description: safeOverlayText(`${expectedSession.provider}: ${sessionId}`, 240),
        detail: safeOverlayText(`Voice ${current.value.voiceSessionId}; consent ${current.value.consentId}; context ${current.value.contextPackageId}; target ${current.value.targetSnapshotId}; prior session ${current.value.managedSessionId ?? "unbound"}.`, 640)
      },
      {
        label: "Cancel without rebinding voice",
        description: "Preserve the prior durable binding",
        detail: "No bind request, generic workflow preparation, or command dispatch will be sent."
      }
    ], { placeHolder: "Review the exact active voice, consent, context, target, provider, and selected managed session before one bind-and-ack request" });
    if (!review || review.label !== "Bind active voice to exact selected session") {
      await this.vscode.window.showInformationMessage("SXSY-B122 cancelled Alt Voice before mutation; the prior durable voice binding remains the only trusted state.");
      return { outcome: "failed_before_dispatch", summary: "Alt Voice was cancelled before the exact bind request; the prior binding was preserved." };
    }
    const refreshed = await this.bridge.listSessions();
    if (!refreshed.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 could not revalidate the exact Alt Voice provider session before binding: ${refreshed.message}`);
      return { outcome: "failed_before_dispatch", summary: "The exact provider session could not be revalidated; no bind was requested." };
    }
    this.reconcileCurrentSessions(refreshed.value);
    const observedSession = providerSelectionBinding(this.sessions.get(sessionId), providerSelectionRequirement(chordFor("VOICE", "alt")!)!);
    if (!observedSession || !sameProviderSelectionBinding(observedSession, expectedSession)) {
      await this.vscode.window.showWarningMessage("SXSY-B122 Alt Voice stopped because the selected provider session changed status, target, task, plan, adapter, handshake, or capability before binding.");
      return { outcome: "failed_before_dispatch", summary: "The selected provider session changed before the voice bind; no mutation was requested." };
    }
    const before = current.value;
    const bound = await this.bridge.bindVoice(before.id, sessionId);
    if (!bound.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 Alt Voice bind acknowledgement is unavailable and the prior binding remains the only trusted state: ${bound.message}`);
      return { outcome: "needs_reconciliation", summary: "The exact voice bind request may have begun but no trustworthy acknowledgement was returned." };
    }
    const binding = bound.value;
    if (binding.id !== before.id || binding.consentId !== before.consentId || binding.voiceSessionId !== before.voiceSessionId
      || binding.contextPackageId !== before.contextPackageId || binding.contextDigest !== before.contextDigest
      || binding.provider !== before.provider || binding.transcript !== before.transcript || binding.retentionMinutes !== before.retentionMinutes
      || binding.managedSessionId !== sessionId || binding.status !== "active"
      || !samePath(binding.repositoryRoot, before.repositoryRoot) || binding.targetSnapshotId !== before.targetSnapshotId
      || !samePath(binding.repositoryRoot, expectedSession.workspaceRoot) || binding.targetSnapshotId !== expectedSession.targetSnapshotId) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected a voice bind acknowledgement that changed or substituted its active conversation, consent, context, provider, selected session, repository, or target; reconciliation is required.");
      return { outcome: "needs_reconciliation", summary: "The voice bind acknowledgement was substituted or inconsistent; the resulting binding is untrusted." };
    }
    await this.vscode.window.showInformationMessage(`SXSY-B122 bound active voice ${binding.voiceSessionId} to exact ${expectedSession.provider} session ${sessionId}; consent ${binding.consentId}, provider ${binding.provider}, repository, and TargetSnapshot were acknowledged unchanged.`);
    return { outcome: "handled", summary: `Active voice was bound and acknowledged for exact managed session ${sessionId}.` };
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
    this.reconcileCurrentSessions(current.value);
    return this.pickKnownSessionQueue(status, placeHolder, predicate);
  }

  private async pickKnownSessionQueue(status: ExtensionManagedSession["status"] | "all", placeHolder: string, predicate: (session: ExtensionManagedSession) => boolean): Promise<ExtensionManagedSession | undefined> {
    const candidates = [...this.sessions.values()].filter((session) => (status === "all" || session.status === status) && predicate(session));
    if (!candidates.length) throw new Error(status === "all" ? "No managed sessions are registered." : `No ${status.replace("verified_", "verified ")} sessions are available.`);
    const items = candidates.map((session) => {
      const statusReason = session.status === "verified_blocked" ? session.metadata["sxsy-b122.statusReason"] : undefined;
      return {
        label: `${session.provider}: ${session.id}`,
        description: `${session.surface} / ${session.status}`,
        ...(typeof statusReason === "string" && statusReason.trim() ? { detail: safeOverlayText(statusReason, 512) } : {})
      };
    });
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder });
    if (!selected) throw new Error("Session selection was cancelled.");
    return candidates[items.indexOf(selected)];
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
    const selectedIndex = view.selectedIndex ?? 0;
    const selectedFailure = view.selectedIndex === undefined ? undefined : view.failures[view.selectedIndex];
    const hosted = `${view.hostedState}${view.head ? ` at ${view.head.slice(0, 12)}…` : ""}`;
    const localReceipt = view.latestLocalReceipt
      ? `; local ${view.latestLocalReceipt.action}=${view.latestLocalReceipt.result} (${view.latestLocalReceipt.completeness}${view.localReceiptState === "mixed" ? "; receipt ledger mixed" : ""})`
      : view.localReceiptState === "stale"
        ? `; local receipt ledger stale (not current); local status ${view.localStatus}`
        : view.localReceiptState === "absent"
          ? `; local receipts absent; local status ${view.localStatus}`
          : view.localReceiptState === "mixed"
            ? `; local receipt ledger mixed with no valid current receipt; local status ${view.localStatus}`
            : view.localReceiptState === "current"
              ? `; local receipt ledger reported current but no valid current receipt; local status ${view.localStatus}`
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
    this.assertAdmissionActive();
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
      this.assertAdmissionActive();
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

  private async focusIntegratedTerminal(workspaceRoot: string): Promise<void> {
    const requestedRoot = resolve(workspaceRoot);
    if (!(this.vscode.workspace.workspaceFolders ?? []).some((folder) => samePath(resolve(folder.uri.fsPath), requestedRoot))) {
      throw new Error("The exact integrated-terminal workspace is no longer open in this VS Code window.");
    }
    const eligible = this.vscode.window.terminals.filter((terminal) => {
      const record = this.terminalRecords.get(terminal);
      return !!record?.session.workspaceRoot && samePath(record.session.workspaceRoot, requestedRoot);
    });
    let terminal = this.vscode.window.activeTerminal && eligible.includes(this.vscode.window.activeTerminal)
      ? this.vscode.window.activeTerminal
      : eligible.length === 1
        ? eligible[0]
        : undefined;
    if (!terminal && eligible.length > 1) {
      const items = eligible.map((candidate, index) => ({ label: candidate.name, description: `Exact ${requestedRoot} terminal ${index + 1}` }));
      const selected = await this.vscode.window.showQuickPick(items, { placeHolder: `Choose one integrated terminal bound to ${requestedRoot}` });
      if (!selected) throw new Error("Exact integrated-terminal selection was cancelled.");
      terminal = eligible[items.indexOf(selected)];
    }
    terminal ??= this.vscode.window.createTerminal({ name: "SXSY-B122 Terminal", cwd: requestedRoot });
    terminal.show();
    await this.registerTerminal(terminal, undefined, requestedRoot);
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

  private providerSourceSessionId(command: ChordCommand, selectedSessionId: string): string {
    if (command.control !== "RUN" || command.modifier !== "alt") return selectedSessionId;
    const selected = this.sessions.get(selectedSessionId);
    if (selected?.metadata["sxsy-b122.kind"] === "managed-run") {
      return selected.metadata["sxsy-b122.runOriginSessionId"] ?? selectedSessionId;
    }
    const sources = [...this.debugBindings.values()].filter((binding) => binding.status === "running"
      && binding.managedSessionId === selectedSessionId && !!binding.debugSessionId
      && this.debugSessionObjects.has(binding.debugSessionId));
    return sources.length === 1 ? sources[0]!.originSessionId : selectedSessionId;
  }

  private currentManagedStopSelection(effectSessionId: string, sourceSessionId: string | undefined): ManagedStopSelection | undefined {
    if (!sourceSessionId || effectSessionId === sourceSessionId) return undefined;
    const effect = this.sessions.get(effectSessionId);
    const origin = this.sessions.get(sourceSessionId);
    if (!effect || !origin || effect.status !== "running" || !effect.workspaceRoot || !origin.workspaceRoot
      || !samePath(effect.workspaceRoot, origin.workspaceRoot) || effect.targetSnapshotId !== origin.targetSnapshotId) return undefined;
    if (effect.metadata["sxsy-b122.kind"] === "managed-run") {
      const managedProcessId = effect.metadata["sxsy-b122.managedProcessId"];
      const originOperationId = effect.metadata["sxsy-b122.runOriginOperationId"];
      if (!managedProcessId || !/^managed:[a-f0-9]{64}$/.test(managedProcessId) || !originOperationId
        || effect.metadata["sxsy-b122.runOriginSessionId"] !== sourceSessionId
        || !effect.metadata["sxsy-b122.runWorkspaceRoot"] || !samePath(effect.metadata["sxsy-b122.runWorkspaceRoot"]!, effect.workspaceRoot)) return undefined;
      return { effectKind: "managed_run", effect, origin, originOperationId, workspaceRoot: effect.workspaceRoot, managedProcessId };
    }
    const candidates = [...this.debugBindings.values()].filter((binding) => binding.status === "running"
      && binding.managedSessionId === effectSessionId && binding.originSessionId === sourceSessionId
      && !!binding.debugSessionId && this.debugSessionObjects.has(binding.debugSessionId));
    if (candidates.length !== 1) return undefined;
    const binding = candidates[0]!;
    if (!binding.debugSessionId
      || effect.metadata["sxsy-b122.kind"] !== "debug-session"
      || effect.metadata["sxsy-b122.debugOriginSessionId"] !== sourceSessionId
      || effect.metadata["sxsy-b122.debugOriginOperationId"] !== binding.originOperationId
      || effect.metadata["sxsy-b122.debugSessionId"] !== binding.debugSessionId
      || effect.metadata["sxsy-b122.debugBindingId"] !== binding.bindingId
      || !effect.workspaceRoot || !origin.workspaceRoot || !samePath(effect.workspaceRoot, binding.workspaceRoot)
      || !samePath(origin.workspaceRoot, binding.workspaceRoot)
      || (binding.targetSnapshotId !== undefined && origin.targetSnapshotId !== binding.targetSnapshotId)
      || (effect.targetSnapshotId !== undefined && effect.targetSnapshotId !== origin.targetSnapshotId)) return undefined;
    return {
      effectKind: "debug_session", binding, effect, origin, originOperationId: binding.originOperationId,
      workspaceRoot: binding.workspaceRoot, debugSessionId: binding.debugSessionId,
      debugBindingId: binding.bindingId, debugConfiguration: binding.configuration
    };
  }

  private async resolveDispatchSession(command: ChordCommand): Promise<string | null | undefined> {
    const requirement = providerSelectionRequirement(command);
    if (requirement) {
      const current = await this.bridge.listSessions();
      if (!current.ok) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 could not read the current provider-managed session catalog: ${current.message}`);
        return null;
      }
      this.reconcileCurrentSessions(current.value);
      const roots = new Set(this.gitRoots.map((root) => normalizePath(root.gitRoot)));
      if (command.control === "RUN" && command.modifier === "alt") {
        const debugCandidates: ManagedStopSelection[] = [...this.debugBindings.values()].flatMap((binding) => {
          if (binding.status !== "running" || !binding.debugSessionId || !binding.managedSessionId
            || !this.debugSessionObjects.has(binding.debugSessionId)) return [];
          const debugSession = this.sessions.get(binding.managedSessionId);
          const origin = providerSelectionBinding(this.sessions.get(binding.originSessionId), requirement);
          if (!debugSession || debugSession.status !== "running" || debugSession.metadata["sxsy-b122.kind"] !== "debug-session"
            || debugSession.metadata["sxsy-b122.debugOriginSessionId"] !== binding.originSessionId
            || debugSession.metadata["sxsy-b122.debugOriginOperationId"] !== binding.originOperationId
            || debugSession.metadata["sxsy-b122.debugSessionId"] !== binding.debugSessionId
            || !debugSession.workspaceRoot || !samePath(debugSession.workspaceRoot, binding.workspaceRoot)
            || !origin || !roots.has(normalizePath(origin.workspaceRoot)) || !samePath(origin.workspaceRoot, binding.workspaceRoot)
            || (binding.targetSnapshotId !== undefined && origin.targetSnapshotId !== binding.targetSnapshotId)
            || (debugSession.targetSnapshotId !== undefined && debugSession.targetSnapshotId !== origin.targetSnapshotId)) return [];
          return [{
            effectKind: "debug_session", binding, effect: debugSession, origin: this.sessions.get(origin.id)!,
            originOperationId: binding.originOperationId, workspaceRoot: binding.workspaceRoot,
            debugSessionId: binding.debugSessionId, debugBindingId: binding.bindingId, debugConfiguration: binding.configuration
          }];
        });
        const managedCandidates: ManagedStopSelection[] = [...this.sessions.values()].flatMap((effect) => {
          if (effect.status !== "running" || effect.metadata["sxsy-b122.kind"] !== "managed-run") return [];
          const sourceId = effect.metadata["sxsy-b122.runOriginSessionId"];
          const source = sourceId ? providerSelectionBinding(this.sessions.get(sourceId), requirement) : undefined;
          const selected = source ? this.currentManagedStopSelection(effect.id, source.id) : undefined;
          return selected && selected.effectKind === "managed_run" && roots.has(normalizePath(selected.workspaceRoot)) ? [selected] : [];
        });
        const candidates = [...debugCandidates, ...managedCandidates];
        if (candidates.length === 0) return null;
        if (candidates.length > 64 || new Set(candidates.map((candidate) => candidate.effect.id)).size !== candidates.length) {
          await this.vscode.window.showWarningMessage("SXSY-B122 stopped because the exact durable managed-effect set is unbounded or duplicated; no provider source or effect was substituted.");
          return null;
        }
        if (candidates.length === 1) return candidates[0]!.effect.id;
        const items = candidates.map((candidate) => ({
          label: `${candidate.effectKind === "debug_session" ? candidate.debugConfiguration : candidate.managedProcessId} — ${candidate.workspaceRoot}`,
          description: `${candidate.effectKind === "debug_session" ? `Debug ${candidate.debugSessionId}` : `Managed Run ${candidate.managedProcessId}`} / ${candidate.origin.provider}: ${candidate.origin.id}`,
          detail: `Exact target ${candidate.origin.targetSnapshotId}; running effect from provider operation ${candidate.originOperationId}`
        }));
        const selected = await this.vscode.window.showQuickPick(items, { placeHolder: "Choose one exact running durable debug or managed Run effect; its exact provider-managed origin is revalidated separately" });
        return selected ? candidates[items.indexOf(selected)]?.effect.id ?? null : null;
      }
      const candidates = [...this.sessions.values()].filter((session) => {
        const binding = providerSelectionBinding(session, requirement);
        return !!binding && roots.has(normalizePath(binding.workspaceRoot));
      });
      if (candidates.length === 0) return null;
      const active = this.activeSessionId();
      if (active && candidates.some((candidate) => candidate.id === active)) return active;
      if (command.control === "AUTHORITY_REFRESH") {
        const running = candidates.filter((candidate) => candidate.status === "running");
        if (running.length === 1) return running[0]!.id;
      }
      if (candidates.length === 1) return candidates[0]!.id;
      if (candidates.length > 64) {
        await this.vscode.window.showWarningMessage("SXSY-B122 stopped because the exact provider-managed session set is unbounded; no generic window or Git-root session was substituted.");
        return null;
      }
      const items = candidates.map((session) => ({
        label: `${session.provider}: ${session.id}`,
        description: session.workspaceRoot!,
        detail: `Exact target ${session.targetSnapshotId}; ${session.status}; ${requirement.capabilities.join(" + ")}`
      }));
      const selected = await this.vscode.window.showQuickPick(items, { placeHolder: `Choose one exact provider-managed session for ${command.title.replace("SXSY-B122: ", "")}; generic window and Git-root sessions are ineligible` });
      if (!selected) return null;
      return candidates[items.indexOf(selected)]?.id ?? null;
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

function boundedAdapterVersion(value: string): string {
  if (!/^[A-Za-z0-9_.+-]{1,80}$/.test(value)) throw new Error("The VS Code adapter package version is invalid.");
  return value;
}

function exactUiChunks(value: string, maximum: number): readonly string[] {
  if (!value || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4_096) throw new Error("The exact review content cannot be rendered safely.");
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += maximum) chunks.push(value.slice(offset, offset + maximum));
  return chunks;
}

interface AutomationInstructionFileEditView {
  readonly kind: "edit_existing";
  readonly path: string;
  readonly beforeDigest: string;
  readonly afterDigest: string;
}

function automationInstructionFileEdit(action: AutomationManifestAction, proposal: Readonly<Record<string, unknown>>): AutomationInstructionFileEditView | undefined {
  if (action !== "compound_capture" || proposal.kind !== "compound_capture" || !isRecord(proposal.instructionFileMutation)) return undefined;
  const mutation = proposal.instructionFileMutation;
  if (!exactRecordKeys(mutation, ["kind", "path", "beforeDigest", "afterDigest", "content"]) || mutation.kind !== "edit_existing"
    || typeof mutation.path !== "string" || !mutation.path || mutation.path.length > 4_096 || /[\r\n\0]/.test(mutation.path)
    || typeof mutation.beforeDigest !== "string" || !/^[a-f0-9]{64}$/.test(mutation.beforeDigest)
    || typeof mutation.afterDigest !== "string" || !/^[a-f0-9]{64}$/.test(mutation.afterDigest)
    || mutation.beforeDigest === mutation.afterDigest) return undefined;
  return { kind: "edit_existing", path: mutation.path, beforeDigest: mutation.beforeDigest, afterDigest: mutation.afterDigest };
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

interface ReanchorUiOutcome {
  readonly outcome: "handled" | "failed_before_dispatch" | "needs_reconciliation";
  readonly summary: string;
  readonly dispatchReceiptId?: string;
}

function validReanchorAuthorities(value: readonly ExtensionReanchorAuthority[]): boolean {
  if (!Array.isArray(value) || value.length > 32) return false;
  const ids = new Set<string>();
  for (const authority of value) {
    if (!authority || !reanchorReference(authority.id) || !reanchorLine(authority.issuedBy, 256)
      || !Number.isFinite(Date.parse(authority.expiresAt)) || ids.has(authority.id)) return false;
    ids.add(authority.id);
  }
  return true;
}

function validReanchorPreview(status: ExtensionReanchorStatus, sessionId: string, authorityId: string, now: string): boolean {
  return status.schema === "sxsy-b122.installed-reanchor-status" && status.version === 1 && status.state === "pending_confirmation"
    && /^reanchor:[a-f0-9]{64}$/.test(status.requestId) && reanchorReference(status.operationId)
    && status.sessionId === sessionId && status.authorityId === authorityId
    && /^[a-f0-9]{64}$/.test(status.oldTargetSnapshotId) && /^[a-f0-9]{64}$/.test(status.newTargetSnapshotId)
    && typeof status.confirmationScopeDigest === "string" && /^[a-f0-9]{64}$/.test(status.confirmationScopeDigest)
    && typeof status.confirmationExpiresAt === "string" && Number.isFinite(Date.parse(status.confirmationExpiresAt))
    && Date.parse(status.confirmationExpiresAt) > Date.parse(now)
    && reanchorList(status.discrepancies) && reanchorList(status.risks) && reanchorList(status.questions)
    && status.receipt === undefined;
}

function validRecordedReanchor(
  status: ExtensionReanchorStatus,
  preview: ExtensionReanchorStatus
): status is ExtensionReanchorStatus & { readonly receipt: NonNullable<ExtensionReanchorStatus["receipt"]> } {
  const receipt = status.receipt;
  if (status.schema !== "sxsy-b122.installed-reanchor-status" || status.version !== 1 || status.state !== "recorded" || !receipt
    || status.requestId !== preview.requestId || status.operationId !== preview.operationId
    || status.sessionId !== preview.sessionId || status.authorityId !== preview.authorityId
    || status.oldTargetSnapshotId !== preview.oldTargetSnapshotId || status.newTargetSnapshotId !== preview.newTargetSnapshotId
    || receipt.requestId !== status.requestId || receipt.operationId !== status.operationId
    || receipt.sessionId !== status.sessionId || receipt.authorityId !== status.authorityId
    || receipt.oldTargetSnapshotId !== status.oldTargetSnapshotId || receipt.newTargetSnapshotId !== status.newTargetSnapshotId
    || receipt.confirmationScopeDigest !== preview.confirmationScopeDigest
    || receipt.resumed !== false || receipt.result !== "reanchored_without_resume"
    || receipt.report.result !== "reanchored_without_resume"
    || receipt.rereadEvidence.inspectedTargetSnapshotId !== status.newTargetSnapshotId) return false;
  return reanchorLine(receipt.report.summary, 1_024) && reanchorList(receipt.report.discrepancies)
    && reanchorList(receipt.report.risks) && reanchorList(receipt.report.questions);
}

function reanchorReference(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value);
}

function reanchorLine(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\r\n\0]/.test(value);
}

function reanchorList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 128 && value.every((item) => reanchorLine(item, 1_024));
}

class HostEffectError extends Error {
  readonly effectDisposition: "committed" | "ambiguous";
  constructor(message: string, effectDisposition: "committed" | "ambiguous") { super(message); this.effectDisposition = effectDisposition; }
}

function workflowActionForCommand(command: ChordCommand): ExtensionWorkflowAction | undefined {
  const value = workflowCommandActions[`${command.control}:${command.modifier}`];
  return value;
}

function automationManifestActionForCommand(command: ChordCommand): AutomationManifestAction | undefined {
  const action = commandFor(command.control, command.modifier)?.action;
  return action === "compound_capture" || action === "compound_refresh" || action === "lfg" || action === "repair_mission"
    ? action
    : undefined;
}

const workflowCommandActions: Readonly<Record<string, ExtensionWorkflowAction>> = {
  "PROOF:normal": "proof", "PROOF:shift": "proof_adversarial",
  "OPTION_PROVIDER:normal": "option_provider", "OPTION_PROVIDER:shift": "option_packet", "PLAN_EXPANDER:normal": "plan_expander", "PLAN_APPROVAL:normal": "plan_approval",
  "HANDOFF:normal": "handoff", "HANDOFF:shift": "handoff_queue", "HANDOFF:alt": "handoff_immediate", "FIND_BLOCKED_AGENT:normal": "focus_blocked_agent", "FIND_FINISHED_AGENT:normal": "focus_finished_agent",
  "AUTHORITY_REFRESH:normal": "authority_refresh", "AUTHORITY_REFRESH:shift": "authority_broadcast"
};

function providerSelectionRequirement(command: ChordCommand): ProviderSelectionRequirement | undefined {
  const key = `${command.control}:${command.modifier}`;
  const definition = commandFor(command.control, command.modifier);
  if (!definition) throw new Error(`The canonical command catalog is missing ${key}.`);
  const capabilities = catalogCapabilityFloor(definition.requiresCapabilities);
  // A registered-only *agent* command still needs a real provider source.
  // Handoff deliberately has the weakest provider capability floor because it
  // prepares an inert immutable packet before any provider effect, but its
  // task/plan authority can never come from a Git-root pseudo-session. Adapter
  // commands such as creating a new managed terminal remain target/UI routes.
  const registeredOnly = capabilities.length === 1 && capabilities[0] === "registered";
  if (capabilities.length === 0 || (registeredOnly && definition.executor !== "agent")) return undefined;
  const statuses: readonly ExtensionManagedSession["status"][] = definition.action === "authority_refresh"
    ? ["running", "verified_blocked"]
    : ["running"];
  return { capabilities, statuses };
}

function catalogCapabilityFloor(required: readonly ExtensionCapability[]): readonly ExtensionCapability[] {
  if (required.includes("mediated")) return ["registered", "observable", "controllable", "mediated"];
  if (required.includes("controllable")) return required.includes("observable")
    ? ["registered", "observable", "controllable"]
    : ["registered", "controllable"];
  if (required.includes("observable")) return ["registered", "observable"];
  return required.includes("registered") ? ["registered"] : [];
}

function providerSelectionBinding(session: ExtensionManagedSession | undefined, requirement: ProviderSelectionRequirement): ProviderSelectionBinding | undefined {
  if (!session || (session.provider !== "claude" && session.provider !== "codex") || !requirement.statuses.includes(session.status)
    || session.metadata["sxsy-b122.kind"] === "git-root"
    || !exactUiReference(session.id) || !exactUiPath(session.workspaceRoot) || !exactUiReference(session.targetSnapshotId)
    || !exactUiReference(session.adapterVersion) || session.metadata["sxsy-b122.providerHandshake"] !== "exact-route-v1"
    || session.metadata["sxsy-b122.providerHandshakeTarget"] !== session.targetSnapshotId
    || requirement.capabilities.some((capability) => !session.capabilities.includes(capability))
    || session.capabilities.length > 4 || new Set(session.capabilities).size !== session.capabilities.length
    || session.capabilities.some((capability) => !["registered", "observable", "controllable", "mediated"].includes(capability))) return undefined;
  return {
    id: session.id,
    provider: session.provider,
    status: session.status,
    workspaceRoot: session.workspaceRoot!,
    targetSnapshotId: session.targetSnapshotId!,
    ...(session.taskId ? { taskId: session.taskId } : {}),
    ...(session.planRevision ? { planRevision: session.planRevision } : {}),
    capabilities: [...session.capabilities].sort(),
    adapterVersion: session.adapterVersion,
    handshake: session.metadata["sxsy-b122.providerHandshake"],
    handshakeTarget: session.metadata["sxsy-b122.providerHandshakeTarget"]
  };
}

function sameProviderSelectionBinding(left: ProviderSelectionBinding, right: ProviderSelectionBinding): boolean {
  return left.id === right.id && left.provider === right.provider && left.status === right.status
    && samePath(left.workspaceRoot, right.workspaceRoot) && left.targetSnapshotId === right.targetSnapshotId
    && left.taskId === right.taskId && left.planRevision === right.planRevision
    && left.capabilities.length === right.capabilities.length && left.capabilities.every((capability, index) => capability === right.capabilities[index])
    && left.adapterVersion === right.adapterVersion && left.handshake === right.handshake && left.handshakeTarget === right.handshakeTarget;
}

function authorityPacketReviews(artifact: ExtensionWorkflowArtifact): readonly AuthorityPacketReview[] {
  const payload = artifact.payload;
  if (artifact.action !== "authority_broadcast" || artifact.status !== "prepared" || artifact.executionAuthorized !== false
    || !sha256Text(artifact.digest) || !exactUiReference(artifact.id) || !exactUiReference(artifact.authorityId)
    || !exactUiPath(artifact.repositoryRoot) || !sha256Text(artifact.targetSnapshotId)
    || payload.kind !== "authority" || payload.mode !== "broadcast" || payload.acknowledgementRequired !== true
    || !Array.isArray(payload.packets) || payload.packets.length < 1 || payload.packets.length > 64) {
    throw new Error("the artifact is not one exact prepared Authority Broadcast");
  }
  const reviews = payload.packets.map((raw): AuthorityPacketReview => {
    if (!isRecord(raw) || !isRecord(raw.pendingRequest) || !isRecord(raw.providerEffect)
      || !isRecord(raw.providerEffect.session) || !isRecord(raw.providerEffect.authority)
      || !Array.isArray(raw.actions) || !Array.isArray(raw.prohibitions)) throw new Error("a packet is not a protected individualized authority packet");
    const pending = raw.pendingRequest as Record<string, unknown>;
    const effect = raw.providerEffect as Record<string, unknown>;
    const session = effect.session as Record<string, unknown>;
    const authority = effect.authority as Record<string, unknown>;
    const provider = effect.provider;
    const capabilities = session.capabilities;
    if (!exactUiReference(raw.recipientSessionId) || !exactUiReference(raw.grantId) || !sha256Text(raw.matchDigest)
      || !exactUiTimestamp(raw.expiresAt) || !exactUiReference(pending.requestId) || !sha256Text(pending.targetSnapshotId)
      || !exactUiReference(pending.planRevision) || !sha256Text(pending.planDigest) || !exactUiReference(pending.action)
      || raw.actions.length < 1 || raw.actions.length > 65 || new Set(raw.actions).size !== raw.actions.length
      || raw.prohibitions.length > 65 || new Set(raw.prohibitions).size !== raw.prohibitions.length
      || !raw.actions.every(exactUiReference) || !raw.prohibitions.every(exactUiReference)
      || !raw.actions.includes(pending.action) || raw.prohibitions.includes(pending.action)
      || effect.role !== "authority_recipient" || (provider !== "claude" && provider !== "codex")
      || session.id !== raw.recipientSessionId || session.provider !== provider || session.status !== "verified_blocked"
      || !exactUiPath(session.workspaceRoot) || !sha256Text(session.targetSnapshotId) || session.targetSnapshotId !== artifact.targetSnapshotId
      || !samePath(session.workspaceRoot, artifact.repositoryRoot) || !exactUiReference(session.taskId) || !exactUiReference(session.planRevision)
      || session.planRevision !== pending.planRevision || pending.targetSnapshotId !== session.targetSnapshotId
      || !Array.isArray(capabilities) || !["registered", "observable", "controllable"].every((item) => capabilities.includes(item))
      || authority.id !== raw.grantId || !samePath(String(authority.repositoryRoot ?? ""), session.workspaceRoot)
      || authority.sessionId !== session.id || authority.taskId !== session.taskId || authority.planRevision !== session.planRevision
      || !Array.isArray(authority.allowedActions) || !authority.allowedActions.includes(pending.action)
      || !Array.isArray(authority.prohibitedActions) || authority.prohibitedActions.includes(pending.action) || authority.revokedAt !== undefined
      || authority.expiresAt !== raw.expiresAt || !exactUiReference(effect.adapterVersion) || !sha256Text(effect.bindingDigest)) {
      throw new Error("a packet changed its recipient, pending request, grant, provider, task, plan, target, status, or capability binding");
    }
    return {
      recipientSessionId: raw.recipientSessionId,
      grantId: raw.grantId,
      matchDigest: raw.matchDigest,
      expiresAt: raw.expiresAt,
      pendingRequest: { requestId: pending.requestId, targetSnapshotId: pending.targetSnapshotId, planRevision: pending.planRevision, planDigest: pending.planDigest, action: pending.action },
      provider,
      taskId: session.taskId,
      planRevision: session.planRevision,
      repositoryRoot: session.workspaceRoot,
      targetSnapshotId: session.targetSnapshotId,
      adapterVersion: effect.adapterVersion,
      bindingDigest: effect.bindingDigest
    };
  });
  if (new Set(reviews.map((packet) => packet.recipientSessionId)).size !== reviews.length) throw new Error("the protected recipient set contains a duplicate session");
  return reviews;
}

function exactUiReference(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value);
}

function exactUiPath(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4_096 && !/[\r\n\0]/.test(value);
}

function exactUiTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function sha256Text(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

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
function boundedDebugLifecycleTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 50 || value > 30_000) throw new Error("The VS Code debug lifecycle timeout is invalid.");
  return value;
}
function boundedHostActionPollInterval(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 60_000) throw new Error("The extension host-action polling interval is invalid.");
  return value;
}
function exactDebugReference(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\r\n\0]/.test(value)) throw new Error(`The ${label} is invalid.`);
  return value;
}
function createPendingDebugStart(bindingId: string): PendingDebugStart {
  let resolvePromise!: (binding: StoredDebugBinding) => void;
  let rejectPromise!: (error: Error) => void;
  let settled = false;
  const promise = new Promise<StoredDebugBinding>((resolvePending, rejectPending) => { resolvePromise = resolvePending; rejectPromise = rejectPending; });
  promise.catch(() => undefined);
  return {
    bindingId,
    promise,
    resolve(binding) { if (!settled) { settled = true; resolvePromise(binding); } },
    reject(error) { if (!settled) { settled = true; rejectPromise(error); } }
  };
}
function createPendingDebugStop(debugSessionId: string): PendingDebugStop {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: Error) => void;
  let settled = false;
  const promise = new Promise<void>((resolvePending, rejectPending) => { resolvePromise = resolvePending; rejectPromise = rejectPending; });
  promise.catch(() => undefined);
  return {
    debugSessionId,
    promise,
    resolve() { if (!settled) { settled = true; resolvePromise(); } },
    reject(error) { if (!settled) { settled = true; rejectPromise(error); } }
  };
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

/**
 * Drain controller work before zeroizing the DPAPI reader. Reader disposal is
 * a finally action so an exceptional drain cannot strand opened token bytes.
 */
export async function deactivateManagedExtension(
  activeController: Pick<ManagedSessionController, "stop"> | undefined,
  activeSecretReader: Readonly<{ dispose(): Promise<void> }> | undefined
): Promise<void> {
  try { await activeController?.stop(); }
  finally { await activeSecretReader?.dispose(); }
}

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

interface CouncilConflictView { readonly resource: string; readonly participants: readonly string[]; }
interface CouncilParticipantView {
  readonly id: string;
  readonly provider: "claude" | "codex" | "generic" | "voice";
  readonly targetSnapshotId: string;
  readonly status: ExtensionManagedSession["status"];
  readonly capabilities: ExtensionManagedSession["capabilities"];
  readonly lastHeartbeat: string;
  readonly plannedFiles: readonly string[];
  readonly resources: readonly string[];
  readonly dependencies: readonly string[];
  readonly diffDigest: string;
}
interface CouncilReportView {
  readonly reportId: string;
  readonly reportDigest: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly collectedAt: string;
  readonly participantDetails: readonly CouncilParticipantView[];
  readonly atomic: boolean;
  readonly pathConflicts: readonly CouncilConflictView[];
  readonly resourceConflicts: readonly CouncilConflictView[];
  readonly dependencyConflicts: readonly CouncilConflictView[];
}
interface CouncilRecommendationView {
  readonly recommendationId: string;
  readonly recommendationDigest: string;
  readonly reportId: string;
  readonly reportDigest: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly participantSessionIds: readonly string[];
  readonly assignments: Readonly<Record<string, Readonly<{ sessionId: string; paths: readonly string[]; resources: readonly string[] }>>>;
  readonly ready: boolean;
  readonly createdAt: string;
}

function councilReportView(value: unknown): CouncilReportView | undefined {
  if (!isRecord(value) || !exactCouncilKeys(value, ["reportId", "reportDigest", "repositoryRoot", "targetSnapshotId", "collectedAt", "participants", "participantDetails", "atomic", "pathConflicts", "resourceConflicts", "dependencyConflicts", "executionAuthorized"])
    || typeof value.reportDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.reportDigest) || value.reportId !== `council-report:${value.reportDigest}`
    || !councilPath(value.repositoryRoot) || !councilReference(value.targetSnapshotId) || !councilTime(value.collectedAt)
    || !Number.isSafeInteger(value.participants) || Number(value.participants) < 1 || Number(value.participants) > 64
    || !Array.isArray(value.participantDetails) || value.participantDetails.length !== value.participants || !value.participantDetails.every(isCouncilParticipant)
    || !value.participantDetails.every((participant) => participant.targetSnapshotId === value.targetSnapshotId)
    || typeof value.atomic !== "boolean" || value.executionAuthorized !== false
    || !isCouncilConflicts(value.pathConflicts, value.participantDetails) || !isCouncilConflicts(value.resourceConflicts, value.participantDetails) || !isCouncilConflicts(value.dependencyConflicts, value.participantDetails)) return undefined;
  return value as unknown as CouncilReportView;
}

function councilRecommendationView(value: unknown): CouncilRecommendationView | undefined {
  if (!isRecord(value) || !exactCouncilKeys(value, ["recommendationId", "recommendationDigest", "reportId", "reportDigest", "repositoryRoot", "targetSnapshotId", "participantSessionIds", "assignments", "ready", "status", "createdAt", "executionAuthorized"])
    || !councilReference(value.recommendationId) || typeof value.recommendationDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.recommendationDigest)
    || typeof value.reportDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.reportDigest) || value.reportId !== `council-report:${value.reportDigest}`
    || !councilPath(value.repositoryRoot) || !councilReference(value.targetSnapshotId)
    || !Array.isArray(value.participantSessionIds) || value.participantSessionIds.length < 1 || value.participantSessionIds.length > 64
    || !value.participantSessionIds.every(councilReference) || new Set(value.participantSessionIds).size !== value.participantSessionIds.length
    || !isRecord(value.assignments) || Object.keys(value.assignments).length > 64
    || !Object.entries(value.assignments).every(([id, assignment]) => Array.isArray(value.participantSessionIds) && value.participantSessionIds.includes(id) && isCouncilAssignmentView(assignment, id))
    || typeof value.ready !== "boolean" || value.ready !== (Object.keys(value.assignments).length === value.participantSessionIds.length)
    || value.status !== "prepared" || !councilTime(value.createdAt) || value.executionAuthorized !== false) return undefined;
  return value as unknown as CouncilRecommendationView;
}

function isCouncilParticipant(value: unknown): value is CouncilParticipantView {
  return isRecord(value) && exactCouncilKeys(value, ["id", "provider", "targetSnapshotId", "status", "capabilities", "lastHeartbeat", "plannedFiles", "resources", "dependencies", "diffDigest"])
    && councilReference(value.id) && ["claude", "codex", "generic", "voice"].includes(String(value.provider)) && councilReference(value.targetSnapshotId)
    && ["running", "verified_blocked", "verified_finished", "unreachable", "stale", "unknown"].includes(String(value.status))
    && Array.isArray(value.capabilities) && value.capabilities.length >= 2 && value.capabilities.length <= 4
    && value.capabilities.includes("registered") && value.capabilities.includes("observable") && new Set(value.capabilities).size === value.capabilities.length
    && value.capabilities.every((capability) => ["registered", "observable", "controllable", "mediated"].includes(String(capability)))
    && councilTime(value.lastHeartbeat) && isCouncilDetailList(value.plannedFiles) && isCouncilDetailList(value.resources) && isCouncilDetailList(value.dependencies)
    && councilReference(value.diffDigest);
}

function isCouncilConflicts(value: unknown, participants: readonly CouncilParticipantView[]): value is readonly CouncilConflictView[] {
  const participantIds = new Set(participants.map((participant) => participant.id));
  return Array.isArray(value) && value.length <= 512 && value.every((conflict) => isRecord(conflict)
    && exactCouncilKeys(conflict, ["resource", "participants"]) && councilDetailText(conflict.resource)
    && Array.isArray(conflict.participants) && conflict.participants.length >= 2 && conflict.participants.length <= 64
    && conflict.participants.every((participant) => councilReference(participant) && participantIds.has(participant))
    && new Set(conflict.participants).size === conflict.participants.length);
}

function isCouncilAssignmentView(value: unknown, id: string): boolean {
  return isRecord(value) && exactCouncilKeys(value, ["sessionId", "paths", "resources"]) && value.sessionId === id
    && councilReference(value.sessionId) && isCouncilDetailList(value.paths) && isCouncilDetailList(value.resources);
}

function exactCouncilKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}
function isCouncilDetailList(value: unknown): value is readonly string[] { return Array.isArray(value) && value.length <= 128 && value.every(councilDetailText); }
function councilDetailText(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value); }
function councilReference(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value); }
function councilPath(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\r\n\0]/.test(value); }
function councilTime(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function councilList(value: readonly string[]): string { return value.length ? value.map((item) => safeOverlayText(item, 256)).join(" | ") : "(none)"; }
function councilConflictItems(label: string, conflicts: readonly CouncilConflictView[]): readonly QuickPickItemLike[] {
  return conflicts.map((conflict) => ({ label: `${label}: ${safeOverlayText(conflict.resource, 256)}`, description: conflict.participants.join(" | "), detail: `Exact overlapping declaration shared by: ${conflict.participants.join(" | ")}.` }));
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
  readonly localReceiptState?: "current" | "mixed" | "stale" | "absent";
  readonly failures: readonly PipelineFailureView[];
  readonly selectedIndex?: number;
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
  const contexts = Array.isArray(hosted.failureSeries) && hosted.failureSeries.length <= 50
    ? hosted.failureSeries
    : [];
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
  const localReceiptState = envelope.localReceiptState === "current" || envelope.localReceiptState === "mixed"
    || envelope.localReceiptState === "stale" || envelope.localReceiptState === "absent"
    ? envelope.localReceiptState
    : undefined;
  const hasTopLevelReceiptObservation = envelope.localReceipts !== undefined || localReceiptState !== undefined;
  const receipts = hasTopLevelReceiptObservation
    ? Array.isArray(envelope.localReceipts) && envelope.localReceipts.length <= 50 ? envelope.localReceipts : []
    : Array.isArray(hosted.localReceipts) && hosted.localReceipts.length <= 50 ? hosted.localReceipts : [];
  const eligibleReceipts = receipts.filter((receipt): receipt is Record<string, unknown> => isRecord(receipt)
    && typeof receipt.action === "string" && receipt.action.length <= 256
    && typeof receipt.result === "string" && receipt.result.length <= 256
    && typeof receipt.completeness === "string" && receipt.completeness.length <= 256
    && typeof receipt.createdAt === "string" && Number.isFinite(Date.parse(receipt.createdAt))
    && (hasTopLevelReceiptObservation
      ? receipt.freshness === "current" && receipt.gateFresh === true && (localReceiptState === "current" || localReceiptState === "mixed")
      : receipt.expired !== true && receipt.invalidated !== true));
  eligibleReceipts.sort((left, right) => Date.parse(right.createdAt as string) - Date.parse(left.createdAt as string));
  const latest = eligibleReceipts[0];
  const latestLocalReceipt = latest ? {
    action: safeOverlayText(latest.action as string, 80),
    result: safeOverlayText(latest.result as string, 80),
    completeness: safeOverlayText(latest.completeness as string, 80)
  } : undefined;
  const selectedIndex = Number.isSafeInteger(hosted.selectedIndex) && (hosted.selectedIndex as number) >= 0 && (hosted.selectedIndex as number) < failures.length
    ? hosted.selectedIndex as number
    : undefined;
  return { hostedState, ...(head ? { head } : {}), localStatus, ...(localReceiptState ? { localReceiptState } : {}), failures, ...(selectedIndex === undefined ? {} : { selectedIndex }), ...(latestLocalReceipt ? { latestLocalReceipt } : {}) };
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

function quickReferenceBank(control: B122Control): "Left bank" | "Upper row" {
  return (["REANCHOR", "PROOF", "OPTION_PROVIDER", "PLAN_EXPANDER", "PLAN_APPROVAL", "HANDOFF", "FIND_BLOCKED_AGENT", "FIND_FINISHED_AGENT", "AUTHORITY_REFRESH", "COUNCIL"] as const).includes(control as never)
    ? "Left bank"
    : "Upper row";
}

interface QuickReferencePolicy {
  readonly requiresTarget: boolean;
  readonly capability: "None" | "Registered" | "Observable" | "Controllable" | "Mediated" | "Coordinated";
  readonly gates: readonly number[];
  readonly confirmation: boolean;
  readonly consequence: "Low" | "Provider mediated" | "Reviewed" | "High gate-controlled";
}

function quickReferencePolicy(command: ChordCommand): QuickReferencePolicy {
  const definition = commandFor(command.control, command.modifier);
  if (!definition) throw new Error(`The canonical command catalog is missing ${command.control}:${command.modifier}.`);
  const required = definition.requiresCapabilities;
  const capability = required.includes("mediated") && required.includes("controllable") && required.includes("observable") ? "Coordinated"
    : required.includes("mediated") ? "Mediated"
      : required.includes("controllable") ? "Controllable"
        : required.includes("observable") ? "Observable"
          : required.includes("registered") ? "Registered"
            : "None";
  const consequence = definition.highConsequence ? "High gate-controlled"
    : definition.requiresConfirmation ? "Reviewed"
      : capability === "None" ? "Low" : "Provider mediated";
  return {
    requiresTarget: definition.requiresTarget,
    capability,
    gates: definition.acceptanceGates,
    confirmation: definition.requiresConfirmation,
    consequence
  };
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
    "VSCODE:shift": "new_vscode_window",
    "TERMINAL:shift": "focus_integrated_terminal",
    "COMMIT:shift": "open_external_url",
    "GITHUB:normal": "open_external_url", "GITHUB:shift": "open_external_url", "GITHUB:alt": "open_external_url", "GITHUB:shift_alt": "open_external_url",
    "RUN:shift": "start_vscode_debug", "RUN:alt": "stop_vscode_debug", "RUN:shift_alt": "open_external_url", "SANDBOX:normal": "configure_python_venv", "SANDBOX:shift": "configure_python_venv", "COMPOUND:alt": "open_compound_palette", "VOICE:normal": "show_voice_center", "VOICE:shift": "show_voice_center",
    "VOICE:alt": "show_voice_center", "VOICE:shift_alt": "show_voice_center", "PIPELINE:alt": "show_pipeline_failure_trace"
  };
  return actions[key];
}

function voiceChordForClaim(claim: ExtensionHostActionClaim): ChordCommand | undefined {
  const modifier: B122Modifier | undefined = claim.commandAction === "open_voice" ? "normal"
    : claim.commandAction === "switch_voice_provider" ? "shift"
      : claim.commandAction === "bind_voice_session" ? "alt"
        : claim.commandAction === "voice_session_picker" ? "shift_alt"
          : undefined;
  return modifier ? chordFor("VOICE", modifier) : undefined;
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

function exactRecordKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function sameManagedRunEffect(left: ExtensionManagedSession, right: ExtensionManagedSession): boolean {
  const leftMetadata = Object.entries(left.metadata).sort(([a], [b]) => a.localeCompare(b));
  const rightMetadata = Object.entries(right.metadata).sort(([a], [b]) => a.localeCompare(b));
  return left.id === right.id && left.provider === right.provider && left.surface === right.surface
    && left.status === right.status && left.workspaceRoot === right.workspaceRoot
    && left.targetSnapshotId === right.targetSnapshotId && left.lastHeartbeat === right.lastHeartbeat
    && left.adapterVersion === right.adapterVersion
    && left.capabilities.length === right.capabilities.length
    && left.capabilities.every((capability, index) => capability === right.capabilities[index])
    && left.plannedFiles.length === right.plannedFiles.length
    && left.plannedFiles.every((path, index) => path === right.plannedFiles[index])
    && JSON.stringify(leftMetadata) === JSON.stringify(rightMetadata);
}

function sameManagedStopReviewSelection(review: DebugStopReview, selection: ManagedStopSelection): boolean {
  if (review.effectKind !== selection.effectKind || review.sourceSessionId !== selection.origin.id
    || review.originOperationId !== selection.originOperationId || review.targetSnapshotId !== selection.origin.targetSnapshotId
    || !samePath(review.repositoryRoot, selection.workspaceRoot)) return false;
  if (selection.effectKind === "managed_run") {
    return review.debugSessionId === null && review.debugBindingId === null && review.debugConfiguration === null
      && review.managedProcessId === selection.managedProcessId;
  }
  return review.managedProcessId === null && review.debugSessionId === selection.debugSessionId
    && review.debugBindingId === selection.debugBindingId && review.debugConfiguration === selection.debugConfiguration;
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

function isStoredDebugBinding(value: unknown): value is StoredDebugBinding {
  if (!isRecord(value)) return false;
  const required = ["version", "bindingId", "originOperationId", "originSessionId", "workspaceRoot", "configuration", "startedAt", "status"];
  const optional = ["targetSnapshotId", "debugSessionId", "managedSessionId"];
  const keys = Object.keys(value);
  return keys.every((key) => required.includes(key) || optional.includes(key)) && required.every((key) => key in value)
    && value.version === 1
    && [value.bindingId, value.originOperationId, value.originSessionId].every((item) => typeof item === "string" && !!item.trim() && item.length <= 256 && !/[\r\n\0]/.test(item))
    && typeof value.workspaceRoot === "string" && !!value.workspaceRoot.trim() && value.workspaceRoot.length <= 4_096 && !/[\r\n\0]/.test(value.workspaceRoot)
    && typeof value.configuration === "string" && !!value.configuration.trim() && value.configuration.length <= 256 && !/[\r\n\0]/.test(value.configuration)
    && typeof value.startedAt === "string" && Number.isFinite(Date.parse(value.startedAt))
    && (value.status === "starting" || value.status === "running" || value.status === "stopping")
    && (value.targetSnapshotId === undefined || typeof value.targetSnapshotId === "string" && !!value.targetSnapshotId.trim() && value.targetSnapshotId.length <= 256 && !/[\r\n\0]/.test(value.targetSnapshotId))
    && (value.debugSessionId === undefined || typeof value.debugSessionId === "string" && !!value.debugSessionId.trim() && value.debugSessionId.length <= 256 && !/[\r\n\0]/.test(value.debugSessionId))
    && (value.managedSessionId === undefined || typeof value.managedSessionId === "string" && !!value.managedSessionId.trim() && value.managedSessionId.length <= 256 && !/[\r\n\0]/.test(value.managedSessionId))
    && (value.status === "starting" ? value.debugSessionId === undefined && value.managedSessionId === undefined : typeof value.debugSessionId === "string" && typeof value.managedSessionId === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
