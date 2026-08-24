import * as vscode from "vscode";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";

type Provider = "claude" | "codex" | "generic";
type SessionStatus = "running" | "verified_blocked" | "verified_finished" | "unreachable" | "stale" | "unknown";
interface CapabilitySet { registered: boolean; observable: boolean; controllable: boolean; mediated: boolean; }
interface ManagedSessionRecord {
  readonly id: string; readonly provider: Provider; readonly terminalName?: string; readonly terminalProcessId?: number; readonly workspaceRoots: readonly string[];
  readonly registeredAt: string; readonly updatedAt: string; readonly capability: CapabilitySet; readonly status: SessionStatus; readonly selected: boolean;
}
const sessionsKey = "sxsy-b122.managedSessions";
const companionKey = "sxsy-b122.companion";
interface CompanionConnection { path: string; token: string; }
const workspaceRoots = (): readonly string[] => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath).sort();
const sessionId = (provider: Provider, terminalName?: string, terminalProcessId?: number): string => `${provider}:${terminalProcessId ?? terminalName ?? "window"}:${workspaceRoots().join("|")}`;
const sessions = (context: vscode.ExtensionContext): ManagedSessionRecord[] => context.workspaceState.get<ManagedSessionRecord[]>(sessionsKey, []);
async function save(context: vscode.ExtensionContext, values: readonly ManagedSessionRecord[]): Promise<void> { await context.workspaceState.update(sessionsKey, values); }
async function register(context: vscode.ExtensionContext, provider: Provider, terminal?: vscode.Terminal): Promise<ManagedSessionRecord> {
  const terminalProcessId = terminal ? await terminal.processId : undefined; const id = sessionId(provider, terminal?.name, terminalProcessId); const now = new Date().toISOString();
  const record: ManagedSessionRecord = { id, provider, terminalName: terminal?.name, terminalProcessId, workspaceRoots: workspaceRoots(), registeredAt: now, updatedAt: now,
    capability: { registered: true, observable: false, controllable: false, mediated: false }, status: "unknown", selected: true };
  const rest = sessions(context).filter((item) => item.id !== id).map((item) => ({ ...item, selected: false })); await save(context, [...rest, record]);
  await syncRegistration(context, record); return record;
}
async function choose(context: vscode.ExtensionContext): Promise<ManagedSessionRecord | undefined> {
  const current = sessions(context); const choice = await vscode.window.showQuickPick(current.map((item) => ({ label: item.id, description: `${item.status}; ${capabilityLabel(item.capability)}`, detail: item.workspaceRoots.join(", ") })), { placeHolder: "Select a verified managed session" });
  if (!choice) return undefined; const selected = current.find((item) => item.id === choice.label); if (!selected) return undefined;
  await save(context, current.map((item) => ({ ...item, selected: item.id === selected.id, updatedAt: item.id === selected.id ? new Date().toISOString() : item.updatedAt }))); return selected;
}
const capabilityLabel = (capability: CapabilitySet): string => capability.mediated ? "Mediated" : capability.controllable ? "Controllable (not Mediated)" : capability.observable ? "Observable (not Mediated)" : "Registered only";
const companion = (context: vscode.ExtensionContext): CompanionConnection | undefined => context.globalState.get<CompanionConnection | undefined>(companionKey, undefined);
async function callCompanion(context: vscode.ExtensionContext, method: string, params?: unknown): Promise<unknown> {
  const connection = companion(context); if (!connection?.path || !connection.token) throw new Error("The local companion is not configured. Configure its local IPC path and token first.");
  return new Promise((resolve, reject) => {
    const socket = connect(connection.path); let response = "";
    socket.once("error", () => reject(new Error("The local companion is unavailable; no action was sent.")));
    socket.on("data", (chunk: Buffer) => { response += chunk.toString(); if (response.includes("\n")) { socket.end(); const decoded = JSON.parse(response) as { ok: boolean; result?: unknown; error?: string }; decoded.ok ? resolve(decoded.result) : reject(new Error(decoded.error ?? "Companion rejected the request.")); } });
    socket.once("connect", () => socket.write(`${JSON.stringify({ id: randomUUID(), token: connection.token, method, params })}\n`));
  });
}
async function syncRegistration(context: vscode.ExtensionContext, record: ManagedSessionRecord): Promise<void> {
  const root = record.workspaceRoots[0]; if (!root || !companion(context)) return;
  try { await callCompanion(context, "register-vscode", { id: record.id, provider: record.provider, terminalName: record.terminalName, terminalProcessId: record.terminalProcessId, workspaceRoot: root }); } catch { /* Local registration remains useful when the companion is offline or the workspace is not a Git repository. */ }
}
async function invoke(context: vscode.ExtensionContext, record: ManagedSessionRecord, control: string, modifier: string): Promise<void> {
  const result = await callCompanion(context, "invoke", { control, modifier, sessionId: record.id }); await vscode.window.showInformationMessage(`SXSY-B122 ${control}/${modifier}: ${JSON.stringify(result)}`);
}

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
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.configureCompanion", async () => {
    const path = await vscode.window.showInputBox({ prompt: "SXSY-B122 local companion IPC path" }); if (!path) return;
    const token = await vscode.window.showInputBox({ prompt: "SXSY-B122 local companion IPC token", password: true }); if (!token) return;
    await context.globalState.update(companionKey, { path, token }); await vscode.window.showInformationMessage("SXSY-B122 local companion configuration saved in VS Code extension state.");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.showCompanionHealth", async () => {
    try { await vscode.window.showInformationMessage(`SXSY-B122 companion: ${JSON.stringify(await callCompanion(context, "health"))}`); } catch (error) { await vscode.window.showWarningMessage((error as Error).message); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.invokeControl", async () => {
    const record = await choose(context); if (!record) return;
    let actions: readonly { control: string; modifier: string; summary: string }[];
    try { actions = (await callCompanion(context, "assignments")) as readonly { control: string; modifier: string; summary: string }[]; } catch (error) { await vscode.window.showWarningMessage((error as Error).message); return; }
    const action = await vscode.window.showQuickPick(actions.map((item) => ({ label: item.control, description: item.modifier, detail: item.summary })), { placeHolder: "Invoke a B122 control through the local companion" }); if (!action) return;
    try { await invoke(context, record, action.label, action.description ?? "normal"); } catch (error) { await vscode.window.showWarningMessage((error as Error).message); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.showBlockedAgents", async () => {
    try { const found = (await callCompanion(context, "sessions")) as readonly { status?: string; id?: string }[]; await vscode.window.showInformationMessage(`SXSY-B122 blocked: ${found.filter((item) => item.status === "verified_blocked").map((item) => item.id).join(", ") || "none"}`); } catch (error) { await vscode.window.showWarningMessage((error as Error).message); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.showFinishedAgents", async () => {
    try { const found = (await callCompanion(context, "sessions")) as readonly { status?: string; id?: string }[]; await vscode.window.showInformationMessage(`SXSY-B122 finished: ${found.filter((item) => item.status === "verified_finished").map((item) => item.id).join(", ") || "none"}`); } catch (error) { await vscode.window.showWarningMessage((error as Error).message); }
  }));
  context.subscriptions.push(vscode.window.onDidCloseTerminal(async (terminal) => {
    const now = new Date().toISOString(); await save(context, sessions(context).map((item) => item.terminalName === terminal.name ? { ...item, status: "unreachable", selected: false, updatedAt: now } : item));
  }));
}

export function deactivate(): void {
  // Session metadata is retained by VS Code. This extension starts no shell hooks, broker, or background worker.
}
