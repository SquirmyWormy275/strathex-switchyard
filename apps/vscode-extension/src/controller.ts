import { chordCommands, chordFor, type B122Control, type B122Modifier, type ChordCommand } from "./commands.ts";
import {
  localHostAction,
  type ExtensionCompanionBridge,
  type ExtensionManagedSession,
  type ExtensionProvider,
  type ForwardedCommand,
  type LocalHostAction
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
}

export interface GitRootRegistration {
  readonly gitRoot: string;
  readonly branch?: string;
  readonly worktree?: string;
  readonly canonicalRemote?: string;
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
  private readonly terminalRecords = new WeakMap<TerminalLike, TrackedTerminal>();
  private readonly terminalBySessionId = new Map<string, TrackedTerminal>();
  private readonly debugSessionIds = new WeakMap<DebugSessionLike, string>();
  private readonly sessions = new Map<string, ExtensionManagedSession>();
  private started = false;
  private windowSessionId?: string;
  private gitRoots: readonly GitRootRegistration[] = [];
  private bridge: ExtensionCompanionBridge;

  constructor(vscode: VscodeLike, context: ExtensionContextLike, bridge: ExtensionCompanionBridge, options: ManagedSessionControllerOptions = {}) {
    this.vscode = vscode;
    this.context = context;
    this.bridge = bridge;
    this.now = options.now ?? (() => new Date().toISOString());
    let counter = 0;
    this.idFactory = options.idFactory ?? (() => `vscode-${Date.now().toString(36)}-${++counter}`);
    this.extensionVersion = options.extensionVersion ?? "0.2.0";
    this.resolveGitRoots = options.resolveGitRoots ?? (async () => []);
  }

  /** Allows a reviewed local transport to be attached after activation. */
  attachBridge(bridge: ExtensionCompanionBridge): void {
    this.bridge = bridge;
  }

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
    await this.registerGitRootSessions();
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
    const forwarded: ForwardedCommand = {
      control: command.control,
      modifier: command.modifier,
      sessionId: this.activeSessionId(),
      input
    };
    const result = await this.bridge.dispatch(forwarded);
    if (!result.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${command.title.replace("SXSY-B122: ", "")} unavailable: ${result.message}`);
      return;
    }

    const requestedLocalAction = result.value.data?.localAction;
    const action = localHostAction(result.value);
    if (requestedLocalAction !== undefined && !action) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected an unrecognized local host action from the companion.");
      return;
    }
    const expected = expectedLocalAction(command);
    if (action && action !== expected) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected an unexpected local host action from the companion.");
      return;
    }
    if (result.value.status === "blocked" || result.value.status === "unavailable" || result.value.status === "incomplete" || result.value.status === "failed") {
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${result.value.status}: ${result.value.summary}`);
      return;
    }
    if (action) await this.executeLocalHostAction(action);
    await this.vscode.window.showInformationMessage(`SXSY-B122: ${result.value.summary}`);
  }

  private async executeLocalHostAction(action: LocalHostAction): Promise<void> {
    switch (action) {
      case "create_claude_terminal":
        await this.createManagedAgentTerminal("SXSY-B122 Claude Code", "claude");
        return;
      case "create_codex_terminal":
        await this.createManagedAgentTerminal("SXSY-B122 Codex", "codex");
        return;
      case "focus_integrated_terminal":
        await this.focusIntegratedTerminal();
        return;
    }
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

  private workspaceRoots(): readonly string[] {
    return (this.vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  }
}

function expectedLocalAction(command: ChordCommand): LocalHostAction | undefined {
  const key = `${command.control}:${command.modifier}`;
  const actions: Readonly<Record<string, LocalHostAction>> = {
    "CLAUDE:alt": "create_claude_terminal",
    "CHATGPT:alt": "create_codex_terminal",
    "TERMINAL:shift": "focus_integrated_terminal"
  };
  return actions[key];
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
