import type { DisposableLike, VscodeLike, WorkspaceFolderLike } from "./vscode-like.ts";
import { createEditorCommandSession, type EditorCommandSession, type EditorConnectionResult, type PreparedEditorConnection } from "./studio-editor-command-session.ts";

export const studioEditorCommands = Object.freeze({ browse: "switchyard.showSavedTasks", connect: "switchyard.connectSavedTask", return: "switchyard.returnToConnectedTask" });
type Connection = { session: EditorCommandSession; prepared: PreparedEditorConnection; label: string; compartment: string; folder: WorkspaceFolderLike; epoch: number };

/** Owns only explicitly selected editor connections; startup performs no I/O. */
export class StudioEditorCommands {
  private closed = false;
  private busy = false;
  private epoch = 0;
  private focusEpoch = 0;
  private readonly abort = new AbortController();
  private readonly disposables: DisposableLike[] = [];
  private readonly sessions = new Set<EditorCommandSession>();
  private readonly connections: Connection[] = [];
  private readonly pending = new Set<Promise<unknown>>();
  private closing?: Promise<void>;
  constructor(private readonly host: VscodeLike, private readonly factory: (host: VscodeLike, current: () => void) => EditorCommandSession = createEditorCommandSession) {
    for (const [kind, command] of Object.entries(studioEditorCommands)) this.disposables.push(host.commands.registerCommand(command, (...args) => this.command(kind, args)));
    this.disposables.push(host.workspace.onDidChangeWorkspaceFolders(() => { this.epoch++; }));
    this.disposables.push(host.window.onDidChangeWindowState(state => { if (!state.focused) this.focusEpoch++; }));
  }
  private current(epoch: number, focusEpoch?: number, folder?: WorkspaceFolderLike): void {
    if (this.closed || this.epoch !== epoch || !this.host.window.state.focused || focusEpoch !== undefined && this.focusEpoch !== focusEpoch || folder && !this.host.workspace.workspaceFolders?.includes(folder)) throw Error("The editor window or project changed. Choose the saved task again.");
  }
  private async wait<T>(work: PromiseLike<T>): Promise<T> {
    let cancel = () => {};
    const stopped = new Promise<never>((_, reject) => { cancel = () => reject(Error("The editor command was closed.")); this.abort.signal.addEventListener("abort", cancel, { once: true }); if (this.abort.signal.aborted) cancel(); });
    try { return await Promise.race([work, stopped]); } finally { this.abort.signal.removeEventListener("abort", cancel); }
  }
  private command(kind: string, args: unknown[]): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (args.length) return Promise.reject(Error("Choose this command directly; task identities cannot be supplied by command arguments."));
    if (this.busy) return Promise.resolve();
    this.busy = true;
    const work = this.execute(kind).catch(async error => { if (!this.closed) await this.wait(this.host.window.showWarningMessage(error instanceof Error ? error.message : "The saved editor task is unavailable.")); }).finally(() => { this.busy = false; });
    this.pending.add(work); void work.then(() => this.pending.delete(work), () => this.pending.delete(work)); return work;
  }
  private report(result: EditorConnectionResult): PromiseLike<string | undefined> {
    const opening = result.focusVerified ? "The exact owned terminal is focused." : "The terminal focus was not verified.";
    return this.host.window.showInformationMessage(`${opening} ${result.protocolAcknowledgementObserved ? "Its Switchyard connection is acknowledged." : "Connection acknowledgement is unverified."} Native task attachment and completion are not verified. No model prompt was submitted.`);
  }
  private async execute(kind: string): Promise<void> {
    const epoch = this.epoch, focusEpoch = this.focusEpoch; this.current(epoch, focusEpoch);
    if (kind === "return") {
      const candidates = this.connections.filter(c => c.epoch === epoch && this.host.workspace.workspaceFolders?.includes(c.folder));
      if (!candidates.length) { await this.wait(this.host.window.showInformationMessage("No Switchyard terminal connection is owned by this editor window. Use Connect Saved Task first.")); return; }
      const items = candidates.map(connection => ({ label: connection.label, description: connection.compartment, detail: connection.folder.uri.fsPath, connection }));
      const selected = await this.wait(this.host.window.showQuickPick(items, { placeHolder: "Return to an existing owned terminal" })); this.current(epoch, focusEpoch);
      if (!selected) return; if (!items.includes(selected)) throw Error("Choose an original listed connection.");
      const result = await selected.connection.prepared.focus(); this.current(epoch, focusEpoch, selected.connection.folder); await this.wait(this.report(result)); return;
    }
    let retained = false, folder: WorkspaceFolderLike | undefined;
    const current = () => this.current(epoch, retained ? undefined : focusEpoch, folder);
    const session = this.factory(this.host, current); this.sessions.add(session);
    try {
      const inventory = await session.projects(); current();
      if (!inventory.projects.length) { await this.wait(this.host.window.showInformationMessage("No eligible saved Codex tasks are available in Switchyard's selected workspace. Load a task deliberately in Switchyard first; this command starts none.")); return; }
      const projects = inventory.projects.map(project => ({ label: project.repositoryRoot, description: `${project.taskCount} saved ${project.taskCount === 1 ? "task" : "tasks"} · ${inventory.compartment}`, project }));
      const project = await this.wait(this.host.window.showQuickPick(projects, { placeHolder: "Choose a saved project; listing does not inspect or resume a native task" })); current();
      if (!project) return; if (!projects.includes(project)) throw Error("Choose an original listed project.");
      const choices = await session.choices(project.project.repositoryRoot); current();
      if (choices.compartment !== inventory.compartment || choices.repositoryRoot !== project.project.repositoryRoot) throw Error("The Switchyard workspace changed. Refresh its saved projects.");
      if (!choices.choices.length) { await this.wait(this.host.window.showInformationMessage("That project's saved tasks are no longer eligible. Refresh after deliberately loading the intended task in Switchyard.")); return; }
      const tasks = choices.choices.map(choice => ({ label: choice.label, description: choices.compartment, detail: `${project.project.repositoryRoot} · loaded ${new Date(choice.loadedAt).toLocaleString()}`, choice }));
      const task = await this.wait(this.host.window.showQuickPick(tasks, { placeHolder: kind === "browse" ? "Saved task metadata only; selection performs no action" : "Choose the exact task to review for a terminal connection" })); current();
      if (!task || kind === "browse") return; if (!tasks.includes(task)) throw Error("Choose an original listed task.");
      const matches = this.host.workspace.workspaceFolders?.filter(row => row.uri.scheme === "file" && row.uri.fsPath === project.project.repositoryRoot) ?? [];
      if (matches.length !== 1) throw Error("Open that exact local project in this editor window before connecting its task.");
      folder = matches[0]; current();
      const prepared = await this.wait(session.prepare({ compartment: choices.compartment, ownerRequestId: task.choice.ownerRequestId, loadRequestId: task.choice.loadRequestId }, project.project.repositoryRoot, task.choice.taskId)); current();
      if (!prepared) return;
      if (prepared.repositoryRoot !== project.project.repositoryRoot || prepared.taskId !== task.choice.taskId) throw Error("The reviewed task differs from the chosen task.");
      const confirm = { label: "Open this reviewed terminal", description: `${task.label} · ${choices.compartment}`, detail: `${prepared.repositoryRoot} · ${prepared.permissions}. ${prepared.reason} No model prompt is submitted.` };
      const answer = await this.wait(this.host.window.showQuickPick([{ label: "Cancel", description: "Keep the current workspace" }, confirm], { placeHolder: "Review before opening a terminal for this exact saved task" })); current();
      if (answer !== confirm) return;
      const result = await prepared.launch(); current();
      retained = true; this.connections.push({ session, prepared, label: task.label, compartment: choices.compartment, folder: folder!, epoch });
      await this.wait(this.report(result));
    } finally { if (!retained) { await session.close(); this.sessions.delete(session); } }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.epoch++; this.abort.abort();
    for (const disposable of this.disposables.splice(0)) { try { disposable.dispose(); } catch { /* generation fence remains authoritative */ } }
    return this.closing = (async () => {
      await Promise.allSettled([...this.pending]);
      const results = await Promise.allSettled([...this.sessions].map(session => session.close()));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed.length) throw new AggregateError(failed.map(r => r.reason), "Some editor connections could not verify retirement.");
      this.sessions.clear(); this.connections.length = 0;
    })();
  }
}
