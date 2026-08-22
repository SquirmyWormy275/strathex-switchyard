declare module "vscode" {
  export interface Disposable { dispose(): unknown; }
  export interface ExtensionContext { subscriptions: Disposable[]; workspaceState: Memento; }
  export interface Memento { update(key: string, value: unknown): Thenable<void>; }
  export const commands: { registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable; };
  export const window: { showInformationMessage(message: string): Thenable<string | undefined>; showWarningMessage(message: string): Thenable<string | undefined>; };
  export const workspace: { workspaceFolders: readonly { uri: { fsPath: string } }[] | undefined; };
}
