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
  /** Shared across VS Code windows; repeat gestures use it to remain cross-window. */
  readonly globalState?: MementoLike;
}

export interface WorkspaceFolderLike {
  readonly uri: { readonly fsPath: string };
  readonly name?: string;
}

export interface TerminalLike {
  readonly name: string;
  readonly creationOptions?: { readonly name?: string };
  /** VS Code resolves this only after the terminal host process exists. */
  readonly processId?: PromiseLike<number | undefined>;
  show(preserveFocus?: boolean): void;
  sendText?(text: string, addNewLine?: boolean): void;
}

export interface TerminalOptionsLike { readonly name: string; readonly cwd?: string; readonly env?: Readonly<Record<string, string | null | undefined>>; readonly shellPath?: string; readonly shellArgs?: readonly string[]; }

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
  readonly workspaceFolder?: WorkspaceFolderLike;
}

export interface QuickPickItemLike {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
}

export interface UriLike { readonly fsPath: string; }

export interface VscodeLike {
  readonly commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): DisposableLike;
    executeCommand?(command: string, ...args: unknown[]): PromiseLike<unknown>;
  };
  readonly window: {
    readonly state: { readonly focused: boolean };
    readonly terminals: readonly TerminalLike[];
    readonly activeTerminal?: TerminalLike;
    createTerminal(options: TerminalOptionsLike): TerminalLike;
    showInformationMessage(message: string): PromiseLike<string | undefined>;
    showWarningMessage(message: string): PromiseLike<string | undefined>;
    showQuickPick<T extends string | QuickPickItemLike>(items: readonly T[], options?: { readonly placeHolder?: string }): PromiseLike<T | undefined>;
    showInputBox?(options?: { readonly prompt?: string; readonly placeHolder?: string; readonly value?: string; readonly password?: boolean; validateInput?(value: string): string | undefined | null | PromiseLike<string | undefined | null> }): PromiseLike<string | undefined>;
    showOpenDialog?(options?: { readonly canSelectFiles?: boolean; readonly canSelectFolders?: boolean; readonly canSelectMany?: boolean; readonly openLabel?: string; readonly filters?: Readonly<Record<string, readonly string[]>> }): PromiseLike<readonly UriLike[] | undefined>;
    onDidOpenTerminal(listener: (terminal: TerminalLike) => unknown): DisposableLike;
    onDidCloseTerminal(listener: (terminal: TerminalLike) => unknown): DisposableLike;
    onDidChangeWindowState(listener: (state: { readonly focused: boolean }) => unknown): DisposableLike;
  };
  readonly workspace: {
    readonly workspaceFolders: readonly WorkspaceFolderLike[] | undefined;
    getConfiguration(section?: string, scope?: unknown): { get<T>(key: string): T | undefined; update?(key: string, value: unknown, target?: boolean | number | null): PromiseLike<void>; };
    onDidChangeWorkspaceFolders(listener: () => unknown): DisposableLike;
  };
  readonly debug: {
    readonly activeDebugSession?: DebugSessionLike;
    startDebugging(folder: WorkspaceFolderLike | undefined, configuration: string | DebugConfigurationLike, options?: { readonly noDebug?: boolean }): PromiseLike<boolean>;
    stopDebugging(session?: DebugSessionLike): PromiseLike<boolean>;
    onDidStartDebugSession(listener: (session: DebugSessionLike) => unknown): DisposableLike;
    onDidTerminateDebugSession(listener: (session: DebugSessionLike) => unknown): DisposableLike;
  };
}
