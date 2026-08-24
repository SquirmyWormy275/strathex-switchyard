/**
 * Narrow VS Code-shaped surface used by the controller. Keeping it separate
 * from the real module makes lifecycle and routing tests run without starting
 * VS Code, while `extension.ts` passes the real API unchanged.
 */
export interface DisposableLike { dispose(): unknown; }

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface ExtensionContextLike {
  readonly subscriptions: DisposableLike[];
  readonly workspaceState: MementoLike;
}

export interface WorkspaceFolderLike {
  readonly uri: { readonly fsPath: string };
  readonly name?: string;
}

export interface TerminalLike {
  readonly name: string;
  readonly creationOptions?: { readonly name?: string };
  show(preserveFocus?: boolean): void;
  sendText?(text: string, addNewLine?: boolean): void;
}

export interface TerminalOptionsLike { readonly name: string; }

export interface DebugConfigurationLike {
  readonly name?: string;
  readonly type?: string;
  readonly request?: string;
  readonly [key: string]: unknown;
}

export interface DebugSessionLike {
  readonly id?: string;
  readonly name: string;
  readonly configuration?: DebugConfigurationLike;
}

export interface QuickPickItemLike {
  readonly label: string;
  readonly description?: string;
}

export interface VscodeLike {
  readonly commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): DisposableLike;
    executeCommand?(command: string, ...args: unknown[]): PromiseLike<unknown>;
  };
  readonly window: {
    readonly terminals: readonly TerminalLike[];
    readonly activeTerminal?: TerminalLike;
    createTerminal(options: TerminalOptionsLike): TerminalLike;
    showInformationMessage(message: string): PromiseLike<string | undefined>;
    showWarningMessage(message: string): PromiseLike<string | undefined>;
    showQuickPick<T extends string | QuickPickItemLike>(items: readonly T[], options?: { readonly placeHolder?: string }): PromiseLike<T | undefined>;
    showInputBox?(options?: { readonly prompt?: string; readonly placeHolder?: string; readonly value?: string; readonly password?: boolean; validateInput?(value: string): string | undefined | null | PromiseLike<string | undefined | null> }): PromiseLike<string | undefined>;
    onDidOpenTerminal(listener: (terminal: TerminalLike) => unknown): DisposableLike;
    onDidCloseTerminal(listener: (terminal: TerminalLike) => unknown): DisposableLike;
  };
  readonly workspace: {
    readonly workspaceFolders: readonly WorkspaceFolderLike[] | undefined;
    getConfiguration(section?: string): { get<T>(key: string): T | undefined; };
    onDidChangeWorkspaceFolders(listener: () => unknown): DisposableLike;
  };
  readonly debug: {
    onDidStartDebugSession(listener: (session: DebugSessionLike) => unknown): DisposableLike;
    onDidTerminateDebugSession(listener: (session: DebugSessionLike) => unknown): DisposableLike;
  };
}
