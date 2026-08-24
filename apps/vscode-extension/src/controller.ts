import { delimiter, dirname, resolve } from "node:path";
import { chordCommands, chordFor, type B122Control, type B122Modifier, type ChordCommand } from "./commands.ts";
import {
  forwardedHostAction,
  type ExtensionCompanionBridge,
  type ExtensionManagedSession,
  type ExtensionProvider,
  type ExtensionHandoffPackage,
  type ExtensionWorkflowAction,
  type ExtensionVoiceProvider,
  type HardwareSignalClaim,
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
  /** DPAPI CurrentUser sealing owned by the installed extension host. */
  readonly sealSecret?: (cleartext: Uint8Array) => Promise<string>;
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
  private readonly sealSecret?: (cleartext: Uint8Array) => Promise<string>;
  private readonly terminalRecords = new WeakMap<TerminalLike, TrackedTerminal>();
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
  }

  /** Allows a reviewed local transport to be attached after activation. */
  attachBridge(bridge: ExtensionCompanionBridge): void {
    this.bridge = bridge;
    this.scheduleReconnect(0);
  }

  stop(): void {
    this.stopReconnect();
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
      this.vscode.window.onDidCloseTerminal((terminal) => { void this.markTerminalClosed(terminal); }),
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
    const purposesText = reference ? await input({ prompt: "Exact allowed purposes (comma-separated)", value: "github-api", validateInput: (value) => splitIdentifiers(value).length ? undefined : "Enter at least one bounded purpose." }) : undefined;
    const secretText = purposesText ? await input({ prompt: "Credential value (sealed with Windows DPAPI before local transport)", password: true, validateInput: (value) => value.length > 0 && Buffer.byteLength(value, "utf8") <= 64 * 1024 ? undefined : "Enter a non-empty value up to 64 KiB." }) : undefined;
    if (!reference || !purposesText || !secretText) return;
    const bytes = Buffer.from(secretText, "utf8");
    let sealedSecret: string;
    try { sealedSecret = await this.sealSecret(bytes); } catch { await this.vscode.window.showWarningMessage("SXSY-B122 could not seal the credential with Windows DPAPI; nothing was sent."); return; } finally { bytes.fill(0); }
    const existing = await this.bridge.listCredentials();
    const replaceExisting = existing.ok && existing.value.some((item) => item.reference === reference && !item.revokedAt);
    const result = await this.bridge.provisionCredential({ reference, repositoryRoot: root.gitRoot, purposes: splitIdentifiers(purposesText), sealedSecret, ...(replaceExisting ? { replaceExisting: true } : {}) });
    if (!result.ok) await this.vscode.window.showWarningMessage(`SXSY-B122 credential was not provisioned: ${result.message}`);
    else await this.vscode.window.showInformationMessage(`SXSY-B122 provisioned DPAPI-sealed reference ${result.value.reference} generation ${result.value.generation} for the selected root.`);
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
    if (!await this.prepareWorkflowForCommand(command, selectedSession)) {
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

    const action = forwardedHostAction(result);
    const attemptedHostAction = result.data?.hostActionId !== undefined || result.data?.hostActionKind !== undefined || result.data?.localAction !== undefined;
    if (attemptedHostAction && !action) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected malformed host-action data from the companion.");
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", "The canonical dispatch returned malformed host-action data and the extension rejected it.", dispatchReceiptId, selectedSession);
      return;
    }
    const expected = expectedLocalAction(command);
    if (action && action.kind !== expected) {
      await this.vscode.window.showWarningMessage("SXSY-B122 rejected an unexpected local host action from the companion.");
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", "The canonical dispatch returned an unexpected host action and the extension rejected it.", dispatchReceiptId, selectedSession);
      return;
    }
    if (result.status === "blocked" || result.status === "unavailable" || result.status === "incomplete" || result.status === "failed") {
      await this.vscode.window.showWarningMessage(`SXSY-B122 ${result.status}: ${result.summary}`);
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
      let summary = "The VS Code host action failed before completion.";
      let authorizationToken: string | undefined;
      try {
        if (Date.parse(action.expiresAt) <= Date.parse(this.now())) throw new Error("The host-action acknowledgement deadline elapsed.");
        const authorization = await this.bridge.authorizeHostAction(action.id, this.extensionVersion);
        if (!authorization.ok) throw new Error(`The companion refused the final host-action barrier: ${authorization.message}`);
        if (authorization.value.hostActionId !== action.id || Date.parse(authorization.value.expiresAt) <= Date.parse(this.now())) throw new Error("The final host-action authorization is mismatched or expired.");
        authorizationToken = authorization.value.authorizationToken;
        summary = await this.executeLocalHostAction(action, command);
        succeeded = true;
      } catch (error) {
        summary = error instanceof Error && error.message ? error.message : summary;
      }
      const completion = await this.bridge.completeHostAction(action.id, succeeded, summary.slice(0, 512), this.extensionVersion, authorizationToken);
      if (!completion.ok) {
        await this.vscode.window.showWarningMessage(`SXSY-B122 host action requires reconciliation: ${completion.message}`);
        if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "needs_reconciliation", "The local host action may have occurred but durable settlement failed.", dispatchReceiptId, selectedSession);
        return;
      }
      const show = completion.value.status === "completed" ? this.vscode.window.showInformationMessage.bind(this.vscode.window) : this.vscode.window.showWarningMessage.bind(this.vscode.window);
      await show(`SXSY-B122 ${completion.value.status}: ${completion.value.summary}`);
      if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", `Canonical dispatch and host action settled as ${completion.value.status}.`, dispatchReceiptId, selectedSession);
      return;
    }
    await this.vscode.window.showInformationMessage(`SXSY-B122: ${result.summary}`);
    if (hardwareClaim) await this.finishHardwareSignal(hardwareClaim, "handled", `Canonical dispatch returned ${result.status}: ${result.summary}`.slice(0, 512), dispatchReceiptId, selectedSession);
  }

  private stopReconnect(): void { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }

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

  private async prepareWorkflowForCommand(command: ChordCommand, sessionId: string | undefined): Promise<boolean> {
    const action = workflowActionForCommand(command);
    if (!action) return true;
    if (!sessionId) {
      await this.vscode.window.showWarningMessage("SXSY-B122 stopped because this provider workflow requires one exact managed session.");
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
    const pending = listed.value.filter((artifact) => artifact.action === action && artifact.sessionId === session.id && artifact.targetSnapshotId === session.targetSnapshotId && artifact.status === "prepared");
    if (pending.length > 1) {
      await this.vscode.window.showWarningMessage("SXSY-B122 found multiple prepared artifacts for this exact workflow. Cancel the queued operation before trying again; nothing was dispatched.");
      return false;
    }
    if (pending.length === 1) {
      await this.vscode.window.showInformationMessage(`SXSY-B122 reused the exact prepared ${action} artifact ${pending[0]!.id}; it still grants no execution authority.`);
      return true;
    }

    let payload: Readonly<Record<string, unknown>> | undefined;
    try { payload = await this.collectWorkflowPayload(action, session); }
    catch (error) { await this.vscode.window.showWarningMessage(`SXSY-B122 workflow preparation stopped: ${error instanceof Error ? error.message : "reviewed input was unavailable"}`); return false; }
    if (!payload) return false;
    const prepared = await this.bridge.prepareWorkflow({ action, sessionId: session.id, payload });
    if (!prepared.ok) {
      await this.vscode.window.showWarningMessage(`SXSY-B122 could not prepare the typed ${action} artifact: ${prepared.message}`);
      return false;
    }
    await this.vscode.window.showInformationMessage(`SXSY-B122 prepared immutable ${action} artifact ${prepared.value.id} (${prepared.value.digest.slice(0, 12)}…). It does not grant authority by itself.`);
    return true;
  }

  private async collectWorkflowPayload(action: ExtensionWorkflowAction, session: ExtensionManagedSession): Promise<Readonly<Record<string, unknown>> | undefined> {
    const input = this.vscode.window.showInputBox;
    if (!input) {
      await this.vscode.window.showWarningMessage("SXSY-B122 cannot prepare a typed workflow because this VS Code host cannot collect reviewed fields.");
      return undefined;
    }
    if (action === "reanchor") {
      const contextSummary = await this.reviewedText("Review the current context summary", session.taskId ? `Task ${session.taskId}, plan ${session.planRevision ?? "unbound"}` : "Current selected task and target");
      const anchors = contextSummary ? await this.reviewedList("Review the exact anchors (comma-separated)", [session.targetSnapshotId!, ...(session.taskId ? [session.taskId] : [])]) : undefined;
      const unresolved = anchors ? await this.reviewedList("List unresolved items (comma-separated; empty is allowed)", [], true) : undefined;
      return contextSummary && anchors && unresolved ? { kind: "anchor", contextSummary, anchors, unresolved } : undefined;
    }
    if (action === "proof" || action === "proof_adversarial") {
      const claims = await this.reviewedList("Review the claims that must be proven (comma-separated)", ["The current implementation satisfies the selected task and plan."]);
      const evidenceReferences = claims ? await this.reviewedList("Review exact evidence references (comma-separated)", [`target:${session.targetSnapshotId}`]) : undefined;
      const requiredBackends = evidenceReferences ? await this.reviewedList("Review required verification backends (comma-separated)", action === "proof_adversarial" ? ["claude", "codex"] : ["local"]) : undefined;
      if (!claims || !evidenceReferences || !requiredBackends) return undefined;
      if (action === "proof_adversarial" && new Set(requiredBackends).size < 2) { await this.vscode.window.showWarningMessage("Adversarial proof requires at least two distinct reviewed backends."); return undefined; }
      return { kind: "proof", claims, evidenceReferences, requiredBackends };
    }
    if (action === "option_provider" || action === "option_packet") {
      const question = await this.reviewedText("Review the exact decision question", "Which safe implementation should be selected?");
      if (!question) return undefined;
      const options: Array<{ id: string; label: string; tradeoffs: readonly string[]; risks: readonly string[] }> = [];
      for (let index = 1; index <= 5; index += 1) {
        const line = await input({ prompt: `Option ${index}: label | tradeoff | risk`, validateInput: decisionOptionValidation });
        if (!line) return undefined;
        const [label, tradeoff, risk] = line.split("|").map((value) => value.trim());
        options.push({ id: `option-${index}`, label: label!, tradeoffs: [tradeoff!], risks: [risk!] });
      }
      const items = options.map((option) => ({ label: option.id, description: option.label }));
      const selected = await this.vscode.window.showQuickPick(items, { placeHolder: "Choose the one reviewed recommendation" });
      if (!selected) return undefined;
      return { kind: "decision", question, options, recommendationId: options[items.indexOf(selected)]!.id };
    }
    if (action === "plan_expander" || action === "plan_approval") {
      const objective = await this.reviewedText("Review the exact plan objective", session.taskId ? `Complete ${session.taskId}` : "Complete the selected task");
      const summary = objective ? await this.reviewedText("Review the next plan step", session.planRevision ? `Execute plan revision ${session.planRevision}` : "Produce a reviewed implementation plan") : undefined;
      if (!objective || !summary) return undefined;
      let approved = false;
      let approvedBy: string | undefined;
      let approvedAt: string | undefined;
      if (action === "plan_approval") {
        const approval = await this.vscode.window.showQuickPick(["Approve this exact plan revision", "Cancel"] as const, { placeHolder: `Plan ${session.planRevision ?? "unbound"} remains target-bound` });
        if (approval !== "Approve this exact plan revision") return undefined;
        approvedBy = await this.reviewedText("Record the approving operator label", "current-user-presence");
        if (!approvedBy) return undefined;
        approved = true;
        approvedAt = this.now();
      }
      return { kind: "plan", objective, steps: [{ id: "step-1", summary, ownedFiles: [...session.plannedFiles], dependencies: [], status: approved ? "approved" : "proposed" }], approved, ...(approvedBy ? { approvedBy, approvedAt } : {}) };
    }
    if (action === "handoff" || action === "handoff_queue") {
      if (!session.taskId || !session.planRevision) { await this.vscode.window.showWarningMessage("Handoff requires the selected session to carry an exact task and plan revision."); return undefined; }
      const recipient = await this.showSessionQueue("all", "Choose the exact Handoff recipient", (candidate) => candidate.id !== session.id && candidate.workspaceRoot !== undefined && samePath(candidate.workspaceRoot, session.workspaceRoot!) && candidate.targetSnapshotId === session.targetSnapshotId);
      const plan = recipient ? await this.reviewedText("Review the plan transferred in this Handoff", `Continue plan ${session.planRevision}`) : undefined;
      const decisions = plan ? await this.reviewedList("Review settled decisions (comma-separated; empty is allowed)", [], true) : undefined;
      const documentation = decisions ? await this.reviewedList("Review relevant documentation paths (comma-separated; empty is allowed)", [], true) : undefined;
      const references = documentation ? await this.reviewedList("Review relevant references (comma-separated; empty is allowed)", [], true) : undefined;
      const constraints = references ? await this.reviewedList("Review constraints (comma-separated; empty is allowed)", [], true) : undefined;
      const openQuestions = constraints ? await this.reviewedList("Review open questions (comma-separated; empty is allowed)", [], true) : undefined;
      const nextActions = openQuestions ? await this.reviewedList("Review next actions in order (comma-separated)", ["Acknowledge this exact Handoff package."]) : undefined;
      if (!recipient || !plan || !decisions || !documentation || !references || !constraints || !openQuestions || !nextActions) return undefined;
      const route = action === "handoff_queue" ? "queue" : "immediate";
      const handoff = await this.bridge.createHandoff({ sessionId: session.id, recipientSessionId: recipient.id, routing: route, plan, decisions, documentation, references, constraints, openQuestions, nextActions });
      if (!handoff.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 could not create the immutable Handoff package: ${handoff.message}`); return undefined; }
      return { kind: "handoff", packageId: handoff.value.id, route, recipientSessionId: recipient.id };
    }
    if (action === "focus_blocked_agent" || action === "focus_finished_agent") {
      const expectedStatus = action === "focus_blocked_agent" ? "verified_blocked" : "verified_finished";
      const selected = await this.showSessionQueue(expectedStatus, `Choose one ${expectedStatus.replace("verified_", "verified ")} session`);
      return selected ? { kind: "focus", selectedSessionId: selected.id, expectedStatus } : undefined;
    }
    if (action === "authority_refresh" || action === "authority_broadcast") {
      const grantId = await this.reviewedText("Enter the exact existing authority grant ID");
      const actions = grantId ? await this.reviewedList("Review the authority actions to replay (comma-separated)", ["proof"]) : undefined;
      if (!grantId || !actions || actions.some((value) => !knownAuthorityAction(value))) { await this.vscode.window.showWarningMessage("Authority Refresh stopped because one or more action IDs are not canonical B122 actions."); return undefined; }
      let recipientSessionIds: readonly string[] = [];
      if (action === "authority_broadcast") {
        const recipients = await this.reviewedList("Review exact recipient session IDs (comma-separated)", [session.id]);
        if (!recipients || recipients.some((id) => !this.sessions.has(id))) { await this.vscode.window.showWarningMessage("Authority broadcast requires only exact known managed-session IDs."); return undefined; }
        recipientSessionIds = recipients;
      }
      return { kind: "authority", grantId, actions, recipientSessionIds };
    }
    const active = await this.bridge.currentVoice();
    if (!active.ok || !active.value || active.value.status === "ended") { await this.vscode.window.showWarningMessage("Bind Voice Session requires one current durable voice binding."); return undefined; }
    const bound = await this.bridge.bindVoice(active.value.id, session.id);
    if (!bound.ok) { await this.vscode.window.showWarningMessage(`SXSY-B122 voice binding failed: ${bound.message}`); return undefined; }
    return { kind: "voice_binding", voiceSessionId: bound.value.voiceSessionId, provider: workflowVoiceProvider(bound.value.provider), contextPackageId: bound.value.contextPackageId, consentId: bound.value.consentId };
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

  private async executeLocalHostAction(action: ForwardedHostAction, command: ChordCommand): Promise<string> {
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
        if (command.control === "VOICE") return this.openOrStartVoice();
        if (!action.url || !trustedExternalUrl(action.url)) throw new Error("The companion supplied an untrusted external URL.");
        if (!await this.openExternal(action.url)) throw new Error("VS Code did not confirm opening the trusted external URL.");
        return "Opened the verified external destination.";
      }
      case "create_claude_terminal":
        await this.createManagedAgentTerminal("SXSY-B122 Claude Code");
        return "Created the tagged Claude terminal and registered its identity; no unverified provider executable was launched.";
      case "create_codex_terminal":
        await this.createManagedAgentTerminal("SXSY-B122 Codex");
        return "Created the tagged Codex terminal and registered its identity; no unverified provider executable was launched.";
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
        return this.switchDurableVoiceProvider();
      }
      case "show_voice_session_picker":
        return this.bindDurableVoiceSession();
      case "show_pipeline_failure_trace":
        await this.executeCommand("workbench.action.output.toggleOutput");
        return "Opened the VS Code output surface for the pipeline failure trace.";
    }
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
      const recipient = handoff.recipientSessionId ? this.sessions.get(handoff.recipientSessionId) : undefined;
      const started = await this.bridge.startVoice({ consentId: consent.value.id, voiceSessionId: `voice-${this.idFactory()}`, ...(recipient?.targetSnapshotId === handoff.targetSnapshotId ? { managedSessionId: recipient.id } : {}) });
      if (!started.ok) throw new Error(`Durable voice binding was not started: ${started.message}`);
      binding = started.value;
    }
    const url = providerVoiceUrl(binding.provider);
    if (!url || !await this.openExternal(url)) throw new Error("The selected voice provider has no trusted installed web surface or VS Code did not confirm opening it.");
    return `Opened ${binding.provider} voice with immutable context ${binding.contextPackageId}; transcript policy is ${binding.transcript}.`;
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
    const url = providerVoiceUrl(switched.value.provider);
    if (!url || !await this.openExternal(url)) throw new Error("The selected voice provider has no trusted installed web surface or VS Code did not confirm opening it.");
    return `Switched voice to ${switched.value.provider} while retaining exact context ${switched.value.contextPackageId}.`;
  }

  private async bindDurableVoiceSession(): Promise<string> {
    const current = await this.bridge.currentVoice();
    if (!current.ok || !current.value || current.value.status === "ended") throw new Error("No current durable voice binding is available.");
    const session = await this.showSessionQueue("all", "Choose the single exact managed session for voice", (candidate) => candidate.workspaceRoot !== undefined && samePath(candidate.workspaceRoot, current.value!.repositoryRoot) && candidate.targetSnapshotId === current.value!.targetSnapshotId);
    if (!session) throw new Error("Voice session selection was cancelled.");
    const bound = await this.bridge.bindVoice(current.value.id, session.id);
    if (!bound.ok) throw new Error(`Voice was not bound to the selected session: ${bound.message}`);
    await this.focusManagedSession(session);
    return `Bound voice ${bound.value.id} to the single exact managed session ${session.id}.`;
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
    const candidates = [...this.sessions.values()].filter((session) => (status === "all" || session.status === status) && predicate(session));
    if (!candidates.length) throw new Error(status === "all" ? "No managed sessions are registered." : `No ${status.replace("verified_", "verified ")} sessions are available.`);
    const items = candidates.map((session) => ({ label: `${session.provider}: ${session.id}`, description: `${session.surface} / ${session.status}` }));
    const selected = await this.vscode.window.showQuickPick(items, { placeHolder });
    if (!selected) throw new Error("Session selection was cancelled.");
    return candidates[items.indexOf(selected)];
  }

  private async createManagedAgentTerminal(name: string): Promise<void> {
    const terminal = this.vscode.window.createTerminal({ name });
    terminal.show();
    // A bare executable name would be resolved through the user's PATH and is
    // not a trustworthy provider identity.  The extension creates and tags the
    // surface only; an installed provider must attach through the companion's
    // attested handshake before gaining Observable/Controllable/Mediated
    // capabilities.
    await this.registerTerminal(terminal);
    await this.vscode.window.showWarningMessage(`SXSY-B122 opened ${name} as Registered only and did not launch an unverified provider executable. Attach an installed provider through the companion handshake before treating it as Observable, Controllable, or Mediated.`);
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

function workflowActionForCommand(command: ChordCommand): ExtensionWorkflowAction | undefined {
  const value = workflowCommandActions[`${command.control}:${command.modifier}`];
  return value;
}

const workflowCommandActions: Readonly<Record<string, ExtensionWorkflowAction>> = {
  "REANCHOR:normal": "reanchor", "PROOF:normal": "proof", "PROOF:shift": "proof_adversarial",
  "OPTION_PROVIDER:normal": "option_provider", "OPTION_PROVIDER:shift": "option_packet", "PLAN_EXPANDER:normal": "plan_expander", "PLAN_APPROVAL:normal": "plan_approval",
  "HANDOFF:normal": "handoff", "HANDOFF:shift": "handoff_queue", "FIND_BLOCKED_AGENT:normal": "focus_blocked_agent", "FIND_FINISHED_AGENT:normal": "focus_finished_agent",
  "AUTHORITY_REFRESH:normal": "authority_refresh", "AUTHORITY_REFRESH:shift": "authority_broadcast", "VOICE:alt": "bind_voice_session"
};

const canonicalAuthorityActions = new Set([
  "reanchor", "proof", "proof_adversarial", "option_provider", "option_packet", "plan_expander", "plan_approval", "handoff", "handoff_queue", "handoff_immediate", "handoff_routing_default",
  "focus_blocked_agent", "blocker_queue", "focus_finished_agent", "done_queue", "authority_refresh", "authority_broadcast", "council_report", "council_automatic", "council_recommend",
  "open_claude", "fresh_claude", "open_managed_claude_terminal", "open_chatgpt", "fresh_chatgpt", "open_managed_codex_terminal", "focus_vscode", "new_vscode", "focus_terminal", "focus_vscode_terminal",
  "local_commit", "pr_upsert", "pr_merge", "direct_main", "github_home", "github_pr", "github_issues", "github_actions", "compound_capture", "compound_refresh", "compound_palette", "lfg",
  "run_target", "debug_target", "stop_managed_run", "launch_web_app", "open_voice", "switch_voice_provider", "bind_voice_session", "voice_session_picker", "pipeline_status", "pipeline_local_gate",
  "pipeline_failure_trace", "pipeline_clean_reproduction", "repair_mission", "shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield", "emergency_containment",
  "venv", "rebuild_venv", "full_sandbox", "rebuild_full_sandbox", "quarantine", "containment_release"
]);

function knownAuthorityAction(value: string): boolean { return canonicalAuthorityActions.has(value); }
function workflowVoiceProvider(provider: ExtensionVoiceProvider): "claude" | "codex" | "generic" { return provider === "claude" ? "claude" : provider === "chatgpt" ? "generic" : "generic"; }
function providerVoiceUrl(provider: ExtensionVoiceProvider): string | undefined { return provider === "claude" ? "https://claude.ai/new" : provider === "chatgpt" ? "https://chatgpt.com/" : undefined; }
function commaList(value: string): readonly string[] { return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]; }
function decisionOptionValidation(value: string): string | undefined { const fields = value.split("|").map((item) => item.trim()); return fields.length === 3 && fields.every((item) => item.length > 0 && item.length <= 16_384 && !/\0/.test(item)) ? undefined : "Use exactly: label | tradeoff | risk"; }

function expectedLocalAction(command: ChordCommand): LocalHostAction | undefined {
  const key = `${command.control}:${command.modifier}`;
  const actions: Readonly<Record<string, LocalHostAction>> = {
    "HANDOFF:alt": "show_handoff_queue", "HANDOFF:shift_alt": "toggle_handoff_routing",
    "FIND_BLOCKED_AGENT:shift": "show_blocker_queue", "FIND_FINISHED_AGENT:shift": "show_done_queue",
    "CLAUDE:normal": "open_external_url", "CLAUDE:shift": "open_external_url", "CLAUDE:alt": "create_claude_terminal",
    "CHATGPT:normal": "open_external_url", "CHATGPT:shift": "open_external_url", "CHATGPT:alt": "create_codex_terminal",
    "VSCODE:normal": "focus_vscode", "VSCODE:shift": "new_vscode_window",
    "TERMINAL:normal": "focus_external_terminal", "TERMINAL:shift": "focus_integrated_terminal",
    "COMMIT:shift": "open_external_url",
    "GITHUB:normal": "open_external_url", "GITHUB:shift": "open_external_url", "GITHUB:alt": "open_external_url", "GITHUB:shift_alt": "open_external_url",
    "RUN:shift": "start_vscode_debug", "RUN:shift_alt": "open_external_url", "SANDBOX:normal": "configure_python_venv", "SANDBOX:shift": "configure_python_venv", "COMPOUND:alt": "open_compound_palette", "VOICE:normal": "open_external_url", "VOICE:shift": "switch_voice_provider",
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

function splitIdentifiers(value: string): readonly string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item)))];
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
