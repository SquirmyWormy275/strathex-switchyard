import * as vscode from "vscode";

type Provider = "claude" | "codex" | "generic";
type SessionStatus = "running" | "verified_blocked" | "verified_finished" | "unreachable" | "stale" | "unknown";
interface CapabilitySet { registered: boolean; observable: boolean; controllable: boolean; mediated: boolean; }
interface ManagedSessionRecord {
  readonly id: string; readonly provider: Provider; readonly terminalName?: string; readonly terminalProcessId?: number; readonly workspaceRoots: readonly string[];
  readonly registeredAt: string; readonly updatedAt: string; readonly capability: CapabilitySet; readonly status: SessionStatus; readonly selected: boolean;
}
const sessionsKey = "sxsy-b122.managedSessions";
const workspaceRoots = (): readonly string[] => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath).sort();
const sessionId = (provider: Provider, terminalName?: string, terminalProcessId?: number): string => `${provider}:${terminalProcessId ?? terminalName ?? "window"}:${workspaceRoots().join("|")}`;
const sessions = (context: vscode.ExtensionContext): ManagedSessionRecord[] => context.workspaceState.get<ManagedSessionRecord[]>(sessionsKey, []);
async function save(context: vscode.ExtensionContext, values: readonly ManagedSessionRecord[]): Promise<void> { await context.workspaceState.update(sessionsKey, values); }
async function register(context: vscode.ExtensionContext, provider: Provider, terminal?: vscode.Terminal): Promise<ManagedSessionRecord> {
  const terminalProcessId = terminal ? await terminal.processId : undefined; const id = sessionId(provider, terminal?.name, terminalProcessId); const now = new Date().toISOString();
  const record: ManagedSessionRecord = { id, provider, terminalName: terminal?.name, terminalProcessId, workspaceRoots: workspaceRoots(), registeredAt: now, updatedAt: now,
    capability: { registered: true, observable: false, controllable: false, mediated: false }, status: "unknown", selected: true };
  const rest = sessions(context).filter((item) => item.id !== id).map((item) => ({ ...item, selected: false })); await save(context, [...rest, record]); return record;
}
async function choose(context: vscode.ExtensionContext): Promise<ManagedSessionRecord | undefined> {
  const current = sessions(context); const choice = await vscode.window.showQuickPick(current.map((item) => ({ label: item.id, description: `${item.status}; ${capabilityLabel(item.capability)}`, detail: item.workspaceRoots.join(", ") })), { placeHolder: "Select a verified managed session" });
  if (!choice) return undefined; const selected = current.find((item) => item.id === choice.label); if (!selected) return undefined;
  await save(context, current.map((item) => ({ ...item, selected: item.id === selected.id, updatedAt: item.id === selected.id ? new Date().toISOString() : item.updatedAt }))); return selected;
}
const capabilityLabel = (capability: CapabilitySet): string => capability.mediated ? "Mediated" : capability.controllable ? "Controllable (not Mediated)" : capability.observable ? "Observable (not Mediated)" : "Registered only";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.registerManagedSession", async () => {
    const record = await register(context, "generic", vscode.window.activeTerminal);
    await vscode.window.showInformationMessage(`SXSY-B122 registered ${record.id}. Registered is not Observable, Controllable, or Mediated.`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.adoptManagedTerminal", async () => {
    const terminal = vscode.window.activeTerminal; if (!terminal) { await vscode.window.showWarningMessage("SXSY-B122 cannot adopt a terminal until one is focused."); return; }
    const record = await register(context, "generic", terminal); await vscode.window.showInformationMessage(`SXSY-B122 adopted ${record.id} as Registered only. Provider handshake is required for higher capability.`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.selectManagedSession", async () => {
    const record = await choose(context); if (record) await vscode.window.showInformationMessage(`SXSY-B122 selected ${record.id}.`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.showManagedSessions", async () => {
    const records = sessions(context); const detail = records.length ? records.map((item) => `${item.selected ? "* " : ""}${item.id}: ${item.status}, ${capabilityLabel(item.capability)}`).join("\n") : "No sessions registered.";
    await vscode.window.showInformationMessage(`SXSY-B122 sessions:\n${detail}`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.createManagedAgentTerminal", async (provider: unknown) => {
    const selectedProvider: Provider = provider === "claude" || provider === "codex" ? provider : "generic";
    const terminal = vscode.window.createTerminal({ name: `SXSY managed ${selectedProvider}`, cwd: workspaceRoots()[0] }); terminal.show();
    const record = await register(context, selectedProvider, terminal); await vscode.window.showInformationMessage(`SXSY-B122 created ${record.id} as Registered only; a provider adapter must prove Observable, Controllable, or Mediated capability.`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.showIntent", async (intent: unknown) => {
    const detail = typeof intent === "string" ? intent : "No routable intent supplied.";
    await vscode.window.showWarningMessage(`SXSY-B122 visible route only: ${detail}`);
  }));
  context.subscriptions.push(vscode.window.onDidCloseTerminal(async (terminal) => {
    const now = new Date().toISOString(); await save(context, sessions(context).map((item) => item.terminalName === terminal.name ? { ...item, status: "unreachable", selected: false, updatedAt: now } : item));
  }));
}

export function deactivate(): void {
  // Session metadata is retained by VS Code. This extension starts no shell hooks, broker, or background worker.
}
