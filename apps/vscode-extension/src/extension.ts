import * as vscode from "vscode";

interface ManagedSessionRecord {
  readonly state: "managed";
  readonly workspaceRoots: readonly string[];
  readonly registeredAt: string;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.registerManagedSession", async () => {
    const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const record: ManagedSessionRecord = { state: "managed", workspaceRoots, registeredAt: new Date().toISOString() };
    await context.workspaceState.update("sxsy-b122.managedSession", record);
    await vscode.window.showInformationMessage("SXSY-B122 registered this VS Code window as Managed. Managed is not Mediated.");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("sxsy-b122.showIntent", async (intent: unknown) => {
    const detail = typeof intent === "string" ? intent : "No routable intent supplied.";
    await vscode.window.showWarningMessage(`SXSY-B122 preview only: ${detail}`);
  }));
}

export function deactivate(): void {
  // No workers, hooks, processes, or external operations are started by this baseline.
}
