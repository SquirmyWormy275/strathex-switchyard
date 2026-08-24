declare module "vscode" {
  export interface Disposable { dispose(): unknown; }
  export interface ExtensionContext { subscriptions: Disposable[]; workspaceState: Memento; }
  export interface Memento { get<T>(key: string, defaultValue?: T): T; update(key: string, value: unknown): Thenable<void>; }
  export const commands: { registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable; };
  export interface Terminal { name: string; processId: Thenable<number | undefined>; show(preserveFocus?: boolean): void; dispose(): void; }
  export interface TerminalOptions { name?: string; cwd?: string; shellPath?: string; shellArgs?: readonly string[]; }
  export const window: { activeTerminal: Terminal | undefined; terminals: readonly Terminal[]; showInformationMessage(message: string): Thenable<string | undefined>; showWarningMessage(message: string): Thenable<string | undefined>; showQuickPick(items: readonly QuickPickItem[], options?: { placeHolder?: string }): Thenable<QuickPickItem | undefined>; createTerminal(options?: TerminalOptions): Terminal; onDidCloseTerminal(listener: (terminal: Terminal) => unknown): Disposable; };
  export interface QuickPickItem { label: string; description?: string; detail?: string; }
  export const workspace: { workspaceFolders: readonly { uri: { fsPath: string } }[] | undefined; };
}
