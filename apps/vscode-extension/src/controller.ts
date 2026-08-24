import { chordCommands, chordFor, type B122Control, type B122Modifier, type ChordCommand } from "./commands.ts";
import {
  forwardedHostAction,
  type ExtensionCompanionBridge,
  type ExtensionManagedSession,
  type ExtensionProvider,
  type ForwardedCommand,
  type ForwardedHostAction,
  type LocalHostAction,
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
}

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
  private readonly terminalRecords = new WeakMap<TerminalLike, TrackedTerminal>();
  private readonly terminalBySessionId = new Map<string, TrackedTerminal>();
  private readonly debugSessionIds = new WeakMap<DebugSessionLike, string>();
  private readonly sessions = new Map<string, ExtensionManagedSession>();
  private started = false;
  private windowSessionId?: string;
  private gitRoots: readonly GitRootRegistration[] = [];
  private bridge: ExtensionCompanionBridge;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

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
  }

  /** Allows a reviewed local transport to be attached after activation. */
  attachBridge(bridge: ExtensionCompanionBridge): void {
    this.bridge = bridge;
    this.scheduleReconnect(0);
  }

  stop(): void { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.registerCommands();
    this.context.subscriptions.push(
      this.vscode.window.onDidOpenTerminal((terminal) => { void this.registerTerminal(terminal); }),
      this.vscode.window.onDidCloseTerminal((terminal) => { void this.markTerminalClosed(terminal); }),
      this.vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.refreshWorkspaceRegistration(); }),
      this.vscode.debug.onDidStartDebugSession((session) => { void this.registerDebugSession(session); }),
      this.vscode.debug.onDidTerminateDebugSession((session) => { void this.markDebugSessionEnded(session); })
    );

    await this.refreshWorkspaceRegistration();
    for (const terminal of this.vscode.window.terminals) await this.registerTerminal(terminal);
    await this.registerDebugConfigurations();
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
      this.vscode.commands.registerCommand("sxsy-b122.dispatch", async (argument: unknown) => {
        const command = parseChordArgument(argument);
        if (!command) {
          await this.vscode.window.showWarningMessage("SXSY-B122 cannot route that command because its control or modifier is not a settled assignment.");
          return;
        }
        await this.dispatch(command, parseInputArgument(argument));
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
        await this.dispatch(command, parseInputArgument(argument));
      }));
    }
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
    if (result.ok) this.stop(); else this.scheduleReconnect();
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

  private async dispatch(command: ChordCommand, input?: Readonly<Record<string, string>>): Promise<void> {
    const selectedSession = await this.resolveDispatchSession(command);
    if (selectedSession === null) {
      await this.vscode.window.showWarningMessage("SXSY-B122 stopped because no exact managed target was selected.");
      return;
    }
    const preparation = await this.bridge.prepareCommand({
      control: command.control,
      modifier: command.modifier,
      ...(selectedSession ? { sessionId: selectedSession } : {}),
      reason: `Operator requested ${command.title} through the installed SXSY-B122 extension.`
    });
    if (!preparation.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 preparation unavailable: ${preparation.message}`);
      return;
    }
    if (preparation.value.status !== "prepared") {
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${preparation.value.status}: ${preparation.value.summary}`);
      return;
    }
    if (preparation.value.session) this.sessions.set(preparation.value.session.id, preparation.value.session);
    if (selectedSession && !await this.reviewGitMutation(command, selectedSession)) return;
    const forwarded: ForwardedCommand = {
      control: command.control,
      modifier: command.modifier,
      ...(selectedSession ? { sessionId: selectedSession } : {}),
      ...(preparation.value.authorityId ? { authorityId: preparation.value.authorityId } : {}),
      ...(preparation.value.confirmationToken ? { confirmationToken: preparation.value.confirmationToken } : {}),
      input
    };
    const result = await this.bridge.dispatch(forwarded);
    if (!result.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${command.title.replace("SXSY-B122: ", "")} unavailable: ${result.message}`);
      return;
    }

    const action = forwardedHostAction(result.value);
    const attemptedHostAction = result.value.data?.hostActionId !== undefined || result.value.data?.hostActionKind !== undefined || result.value.data?.localAction !== undefined;
    if (attemptedHostAction && !action) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected malformed host-action data from the companion.");
      return;
    }
    const expected = expectedLocalAction(command);
    if (action && action.kind !== expected) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected an unexpected local host action from the companion.");
      return;
    }
    if (result.value.status === "blocked" || result.value.status === "unavailable" || result.value.status === "incomplete" || result.value.status === "failed") {
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${result.value.status}: ${result.value.summary}`);
      return;
    }
    if (action) {
      if (result.value.status !== "running") {
        await this.vscode.window.showWarningMessage("SXSY-B122 rejected a host action that was not bound to a running durable operation.");
        return;
      }
      let succeeded = false;
      let summary = "The VS Code host action failed before completion.";
      try {
        if (Date.parse(action.expiresAt) <= Date.parse(this.now())) throw new Error("The host-action acknowledgement deadline elapsed.");
        summary = await this.executeLocalHostAction(action);
        succeeded = true;
      } catch (error) {
        summary = error instanceof Error && error.message ? error.message : summary;
      }
      const completion = await this.bridge.completeHostAction(action.id, succeeded, summary.slice(0, 512), this.extensionVersion);
      if (!completion.ok) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 host action requires reconciliation: ${completion.message}`);
        return;
      }
      const show = completion.value.status === "completed" ? this.vscode.window.showInformationMessage.bind(this.vscode.window) : this.vscode.window.showWarningMessage.bind(this.vscode.window);
      await show(`SXSY-B122 ${completion.value.status}: ${completion.value.summary}`);
      return;
    }
    await this.vscode.window.showInformationMessage(`SXSY-B122: ${result.value.summary}`);
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
    let mutation: ReviewedGitMutation | undefined;
    if (action === "local_commit") {
      const available = [...new Set(root.changedPaths ?? [])].filter((path) => path && !path.includes(","));
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
      mutation = { kind: "local_commit", paths, message };
    } else if (action === "pr_upsert") {
      if (!root.branch) return false;
      const baseBranch = await input({ prompt: "Review the pull request base branch", value: "main", validateInput: validBranchInput });
      if (!baseBranch) return false;
      mutation = { kind: "pr_upsert", headBranch: root.branch, baseBranch };
    } else if (action === "pr_merge") {
      const pullRequestText = await input({ prompt: "Enter the exact pull request number", validateInput: (value) => /^[1-9][0-9]{0,9}$/.test(value) ? undefined : "Enter a positive pull request number." });
      const head = pullRequestText ? await input({ prompt: "Enter the exact 40-character reviewed head SHA", validateInput: (value) => /^[a-f0-9]{40}$/i.test(value) ? undefined : "Enter the exact 40-character SHA." }) : undefined;
      const baseBranch = head ? await input({ prompt: "Enter the exact reviewed base branch", value: "main", validateInput: validBranchInput }) : undefined;
      if (!pullRequestText || !head || !baseBranch) return false;
      mutation = { kind: "merge_pr", pullRequest: Number(pullRequestText), head, baseBranch };
    } else {
      if (!root.branch) return false;
      const validationReceiptId = await input({ prompt: "Enter the exact Release Shield validation receipt ID", validateInput: (value) => /^receipt:[A-Za-z0-9._:-]{1,200}$/.test(value) ? undefined : "Enter a receipt ID beginning with receipt:." });
      if (!validationReceiptId) return false;
      mutation = { kind: "direct_main", branch: root.branch, validationReceiptId };
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

  private async executeLocalHostAction(action: ForwardedHostAction): Promise<string> {
    switch (action.kind) {
      case "show_handoff_queue":
        await this.showSessionQueue("all", "Choose a managed session for the handoff queue");
        return "Opened the managed handoff queue.";
      case "toggle_handoff_routing": {
        const key = "sxsy-b122.handoffRoutingAlternate";
        const enabled = this.context.workspaceState.get<boolean>(key) === true;
        await this.context.workspaceState.update(key, !enabled);
        return `Handoff routing default changed to ${enabled ? "primary" : "alternate"}.`;
      }
      case "show_blocker_queue":
        await this.showSessionQueue("verified_blocked", "Verified blocked sessions");
        return "Opened the verified blocker queue.";
      case "show_done_queue":
        await this.showSessionQueue("verified_finished", "Verified finished sessions");
        return "Opened the verified finished queue.";
      case "open_external_url": {
        if (!action.url || !trustedExternalUrl(action.url)) throw new Error("The companion supplied an untrusted external URL.");
        if (!await this.openExternal(action.url)) throw new Error("VS Code did not confirm opening the trusted external URL.");
        return "Opened the verified external destination.";
      }
      case "create_claude_terminal":
        await this.createManagedAgentTerminal("SXSY-B122 Claude Code", "claude");
        return "Created the managed Claude terminal and registered its identity.";
      case "create_codex_terminal":
        await this.createManagedAgentTerminal("SXSY-B122 Codex", "codex");
        return "Created the managed Codex terminal and registered its identity.";
      case "focus_vscode":
        await this.executeCommand("workbench.action.focusActiveEditorGroup");
        return "Focused the active VS Code editor group.";
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
        await this.executeCommand("workbench.action.showCommands");
        return "Opened the VS Code command palette for installed Compound commands.";
      case "switch_voice_provider": {
        const provider = await this.vscode.window.showQuickPick(["chatgpt", "claude", "system"] as const, { placeHolder: "Choose the active voice provider" });
        if (!provider) throw new Error("Voice provider selection was cancelled.");
        await this.context.workspaceState.update("sxsy-b122.voiceProvider", provider);
        return `Selected ${provider} as the voice provider.`;
      }
      case "show_voice_session_picker":
        await this.showSessionQueue("all", "Choose the single session to bind to voice");
        return "Opened the single-target voice session picker.";
      case "show_pipeline_failure_trace":
        await this.executeCommand("workbench.action.output.toggleOutput");
        return "Opened the VS Code output surface for the pipeline failure trace.";
    }
  }

  private async showSessionQueue(status: ExtensionManagedSession["status"] | "all", placeHolder: string): Promise<void> {
    const candidates = [...this.sessions.values()].filter((session) => status === "all" || session.status === status);
    if (!candidates.length) throw new Error(status === "all" ? "No managed sessions are registered." : `No ${status.replace("verified_", "verified ")} sessions are available.`);
    const items = candidates.map((session) => ({ label: `${session.provider}: ${session.id}`, description: `${session.surface} / ${session.status}` }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder });
    if (!selected) throw new Error("Session selection was cancelled.");
  }

  private async createManagedAgentTerminal(name: string, executable: "claude" | "codex"): Promise<void> {
    const terminal = this.vscode.window.createTerminal({ name });
    terminal.show();
    // Fixed, local executable names only. No repository text, provider output,
    // task packet, prompt, credential, or command argument is injected here.
    terminal.sendText?.(executable, true);
    await this.registerTerminal(terminal);
    await this.vscode.window.showWarningMessage(`SXSY-B122 opened ${name} as Registered only. The terminal is not Mediated and its agent activity remains outside enforcement.`);
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

function expectedLocalAction(command: ChordCommand): LocalHostAction | undefined {
  const key = `${command.control}:${command.modifier}`;
  const actions: Readonly<Record<string, LocalHostAction>> = {
    "HANDOFF:alt": "show_handoff_queue", "HANDOFF:shift_alt": "toggle_handoff_routing",
    "FIND_BLOCKED_AGENT:shift": "show_blocker_queue", "FIND_FINISHED_AGENT:shift": "show_done_queue",
    "CLAUDE:normal": "open_external_url", "CLAUDE:shift": "open_external_url", "CLAUDE:alt": "create_claude_terminal",
    "CHATGPT:normal": "open_external_url", "CHATGPT:shift": "open_external_url", "CHATGPT:alt": "create_codex_terminal",
    "VSCODE:normal": "focus_vscode", "VSCODE:shift": "new_vscode_window",
    "TERMINAL:normal": "focus_external_terminal", "TERMINAL:shift": "focus_integrated_terminal",
    "GITHUB:normal": "open_external_url", "GITHUB:shift": "open_external_url", "GITHUB:alt": "open_external_url", "GITHUB:shift_alt": "open_external_url",
    "COMPOUND:alt": "open_compound_palette", "VOICE:normal": "open_external_url", "VOICE:shift": "switch_voice_provider",
    "VOICE:shift_alt": "show_voice_session_picker", "PIPELINE:alt": "show_pipeline_failure_trace"
  };
  return actions[key];
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
    return url.protocol === "https:" && ["github.com", "claude.ai", "chatgpt.com"].includes(url.hostname) && !url.username && !url.password;
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

function validBranchInput(value: string): string | undefined {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) && !value.includes("..") && !value.endsWith("/") ? undefined : "Enter a valid exact branch name.";
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
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
