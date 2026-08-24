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
  UnavailableExtensionCompanionBridge
} from "../src/companion-bridge.ts";
import { ManagedSessionController } from "../src/controller.ts";
import type { B122Control, B122Modifier } from "../src/commands.ts";
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
  readonly terminals: FakeTerminal[];
  activeTerminal?: FakeTerminal;
  workspaceFolders: WorkspaceFolderLike[];
  debugConfigurations: DebugConfigurationLike[] = [{ name: "Launch test", type: "node", request: "launch" }];
  private readonly openListeners: Array<(terminal: TerminalLike) => unknown> = [];
  private readonly closeListeners: Array<(terminal: TerminalLike) => unknown> = [];
  private readonly workspaceListeners: Array<() => unknown> = [];
  private readonly debugStartListeners: Array<(session: DebugSessionLike) => unknown> = [];
  private readonly debugStopListeners: Array<(session: DebugSessionLike) => unknown> = [];
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
        get terminals(): readonly TerminalLike[] { return self.terminals; },
        get activeTerminal(): TerminalLike | undefined { return self.activeTerminal; },
        createTerminal(options): TerminalLike {
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
        onDidCloseTerminal(listener): DisposableLike { self.closeListeners.push(listener); return new FakeDisposable(); }
      },
      workspace: {
        get workspaceFolders(): readonly WorkspaceFolderLike[] { return self.workspaceFolders; },
        getConfiguration(): { get<T>(key: string): T | undefined } {
          return { get: <T>(key: string): T | undefined => key === "configurations" ? self.debugConfigurations as T : undefined };
        },
        onDidChangeWorkspaceFolders(listener): DisposableLike { self.workspaceListeners.push(listener); return new FakeDisposable(); }
      },
      debug: {
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
  choose(value: string): void { this.quickPickValues.push(value); }
  input(value: string): void { this.inputValues.push(value); }
}

class FakeBridge implements ExtensionCompanionBridge {
  readonly registered: ExtensionManagedSession[] = [];
  readonly adopted: Array<{ sessionId: string; adoptionKey: string; provider: Exclude<ExtensionProvider, "voice"> }> = [];
  readonly statuses: Array<{ sessionId: string; status: ExtensionSessionStatus }> = [];
  readonly dispatched: ForwardedCommand[] = [];
  readonly completedHostActions: Array<{ id: string; succeeded: boolean; summary: string; adapterVersion: string }> = [];
  readonly prepared: Array<{ control: string; modifier: string; sessionId?: string; reason: string }> = [];
  readonly gitReviews: Array<{ action: "local_commit" | "pr_upsert" | "pr_merge" | "direct_main"; sessionId: string; mutation: ReviewedGitMutation }> = [];
  nextDispatch?: ForwardedCommandResult;
  nextPreparation?: PreparedCommand;

  async health(): Promise<BridgeResult<Readonly<{ status?: string }>>> { return { ok: true, value: { status: "healthy" } }; }
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
  async heartbeat(session: string): Promise<BridgeResult<ExtensionManagedSession>> {
    const existing = this.registered.find((record) => record.id === session);
    return existing ? { ok: true, value: existing } : { ok: false, code: "not_found", message: "missing" };
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
    return existing ? { ok: true, value: { ...existing, workspaceRoot: repositoryRoot, capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", adapterVersion: "fake-provider" } } : { ok: false, code: "not_found", message: "missing" };
  }
  async completeHostAction(id: string, succeeded: boolean, summary: string, adapterVersion: string): Promise<BridgeResult<ForwardedCommandResult>> {
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
  const controller = new ManagedSessionController(vscode.api, new FakeContext(), bridge, { now: () => "2026-08-23T00:00:00.000Z", idFactory: sequenceFactory() });
  await controller.start();

  await vscode.invoke("sxsy-b122.chord.claude.alt");
  assert.equal(bridge.dispatched.at(-1)?.control, "CLAUDE");
  assert.equal(vscode.createdTerminals.length, 1);
  assert.deepEqual(vscode.createdTerminals[0].sent, ["claude"]);
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

  bridge.nextDispatch = { status: "blocked", summary: "Acceptance evidence is incomplete." };
  await vscode.invoke("sxsy-b122.chord.pipeline.ctrl_shift_alt");
  assert.match(vscode.warnings.at(-1) ?? "", /blocked/i);
  assert.equal(vscode.createdTerminals.length, 1);
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
