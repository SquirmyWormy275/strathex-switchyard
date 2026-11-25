import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { codexWindowsTerminalResume, windowsEditorLocalPath } from "./codex-windows-terminal.ts";
import { revealExactTerminal } from "./terminal-focus.ts";
import { createWindowsEditorFileChecks, type WindowsEditorFileChecks, type WindowsReviewedImage } from "./studio-windows-editor-files.ts";
import { StudioWindowsNative } from "./studio-windows-native.ts";
import { StudioWindowsTaskClient } from "./studio-windows-task-client.ts";
import type { StudioEditorRequest, StudioEditorSelection } from "./studio-task-client.ts";
import type { WindowsEditorConnectionReady, WindowsEditorReview, WindowsEditorTarget, WindowsEditorPeer } from "./studio-windows-task-client.ts";
import type { TerminalLike, VscodeLike, WorkspaceFolderLike } from "./vscode-like.ts";

type Client = Pick<StudioWindowsTaskClient, "editorTarget" | "returnEditorTarget" | "reviewEditor" | "issueEditor" | "consumeEditor" | "openEditorConnection" | "pinEditorPeer" | "observeEditorConnection" | "stopEditorConnection" | "cancelPending" | "close">;
type Host = Pick<VscodeLike, "window" | "workspace">;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function requireCurrent(value: unknown): asserts value { if (!value) throw Error("The original reviewed editor launch is no longer current."); }
interface ProjectContext { readonly folder: WorkspaceFolderLike; readonly generation: number; }
interface Prepared extends WindowsReviewedImage {
  readonly selection: StudioEditorRequest; readonly review: WindowsEditorReview;
  readonly project: ProjectContext;
  readonly targetDigest: string;
  attempted: boolean; createCalled: boolean; terminal?: TerminalLike; focusVerified: boolean; process?: WindowsEditorPeer;
  connectionAttempted?: boolean; connection?: WindowsEditorConnectionReady; peerAttempted?: boolean; protocolAcknowledgementObserved?: boolean; retirement?: Promise<void>;
}

/** Production composition; deliberately does not register or execute a command. */
export function createStudioWindowsEditorLauncher(options:{host:Host;endpointPath:string;executable:string;assertInstanceCurrent:()=>void|Promise<void>;assertTargetCurrent:(target:WindowsEditorTarget)=>void|Promise<void>}):StudioWindowsEditorLauncher {
  const native=new StudioWindowsNative({endpointPath:options.endpointPath,assertCurrent:options.assertInstanceCurrent});
  const client=new StudioWindowsTaskClient({readEndpoint:()=>native.readEndpoint(),assertCurrent:options.assertInstanceCurrent});
  return new StudioWindowsEditorLauncher({client,native,host:options.host,executable:options.executable,assertCurrent:options.assertTargetCurrent});
}
export interface StudioWindowsEditorLaunchObservation {
  readonly requestId: string; readonly launchAttempted: boolean; readonly terminalCreationRequested: boolean;
  readonly terminalObjectReturned: boolean; readonly focusVerified: boolean;
  readonly nativeProcessObserved: boolean; readonly protocolAcknowledgementObserved: boolean;
  readonly nativeTaskLoaded: false; readonly ideAttached: false; readonly modelPromptSubmitted: false; readonly completionVerified: false;
}

/** Owns one client and exact Terminal object per reviewed request. No command registration or native attachment claim. */
export class StudioWindowsEditorLauncher {
  private readonly editorId = randomUUID();
  private readonly reviews = new Map<WindowsEditorReview, Prepared>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly processAbort = new AbortController();
  private closed = false;
  private closing?: Promise<void>;
  private readonly terminalClose: { dispose(): void };
  private readonly workspaceChange: { dispose(): void };
  private projectGeneration = 0;
  private readonly options: Readonly<{ client: Client; host: Host; executable: string; assertCurrent: (target: WindowsEditorTarget) => void | Promise<void>; native: Pick<StudioWindowsNative,"observeTerminal"|"close">; files: WindowsEditorFileChecks; platform: NodeJS.Platform }>;
  constructor(options: { client: Client; host: Host; executable: string; assertCurrent: (target: WindowsEditorTarget) => void | Promise<void>; native: Pick<StudioWindowsNative,"observeTerminal"|"close">; files?: WindowsEditorFileChecks; platform?: NodeJS.Platform }) {
    requireCurrent(windowsEditorLocalPath(options.executable) && options.executable.length>3 && typeof options.assertCurrent === "function");
    this.options = Object.freeze({ ...options, files: options.files??createWindowsEditorFileChecks(), platform: options.platform??process.platform });
    this.terminalClose = options.host.window.onDidCloseTerminal(terminal => {
      for (const p of this.reviews.values()) if (p.terminal === terminal) {
        p.focusVerified = false; p.protocolAcknowledgementObserved = false;
        void this.track(() => this.retire(p)).catch(() => undefined);
      }
    });
    this.workspaceChange = options.host.workspace.onDidChangeWorkspaceFolders(() => {
      // Removing and reopening a project cannot revive an earlier review, even
      // when its pathname and on-disk identity are unchanged.
      this.projectGeneration++;
      for (const p of this.reviews.values()) {
        p.focusVerified = false; p.protocolAcknowledgementObserved = false;
        void this.track(() => this.retire(p)).catch(() => undefined);
      }
    });
  }
  private track<T>(fn: () => Promise<T>): Promise<T> {
    const operation = Promise.resolve().then(fn); this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation)); return operation;
  }
  private focused(target: WindowsEditorTarget, project?: ProjectContext): void {
    requireCurrent(this.options.platform === "win32" && !this.closed && this.options.host.window.state.focused);
    const matches = this.options.host.workspace.workspaceFolders?.filter(folder => folder.uri.fsPath === target.repositoryRoot);
    requireCurrent(matches?.length === 1 && matches[0].uri.scheme === "file");
    if (project) requireCurrent(project.generation === this.projectGeneration && matches[0] === project.folder);
  }
  private async current(target: WindowsEditorTarget, prepared?: Prepared, project = prepared?.project): Promise<void> {
    this.focused(target, project); await this.options.assertCurrent(target); this.focused(target, project);
    await this.options.files.current(target, prepared);
    requireCurrent(!prepared?.retirement);
    this.focused(target, project);
  }
  private retire(p: Prepared): Promise<void> {
    p.protocolAcknowledgementObserved = false;
    if (!p.connectionAttempted) return Promise.resolve();
    return p.retirement ??= (async () => {
      const result = await this.options.client.stopEditorConnection(p.selection);
      requireCurrent(result.stoppedVerified === true);
    })();
  }
  private async connectionAcknowledged(p: Prepared): Promise<void> {
    requireCurrent(p.connection && p.peerAttempted && !p.retirement);
    p.protocolAcknowledgementObserved = false;
    const observed = await this.options.client.observeEditorConnection(p.selection);
    requireCurrent(observed.peerVerified && observed.protocolAcknowledged);
    await this.current(p.review.target, p);
    p.protocolAcknowledgementObserved = true;
  }
  private image(target: WindowsEditorTarget, project: ProjectContext): Promise<WindowsReviewedImage> {
    return this.options.files.image(this.options.executable, target.endpoint.peerExecutableSha256, () => this.current(target, undefined, project));
  }
  review(input: StudioEditorSelection): Promise<WindowsEditorReview> {
    // The client validates this copied closed selection before any I/O.
    const selected = Object.freeze({ ...input });
    return this.track(async () => {
      requireCurrent(!this.closed && this.reviews.size < 64);
      const generation = this.projectGeneration;
      const observed = await this.options.client.editorTarget(selected);
      requireCurrent(generation === this.projectGeneration); this.focused(observed.target);
      const project = Object.freeze({ generation, folder: this.options.host.workspace.workspaceFolders!.find(folder => folder.uri.fsPath === observed.target.repositoryRoot)! });
      await this.current(observed.target, undefined, project);
      const image = await this.image(observed.target, project), selection = Object.freeze({ ...selected, requestId: randomUUID(), editorId: this.editorId });
      const review = await this.options.client.reviewEditor(selection);
      requireCurrent(digest(review.target) === observed.targetDigest);
      const prepared: Prepared = { selection, review, project, targetDigest: observed.targetDigest, ...image, attempted: false, createCalled: false, focusVerified: false };
      await this.current(review.target, prepared); requireCurrent(this.reviews.size < 64);
      this.reviews.set(review, prepared); return review;
    });
  }
  launch(review: WindowsEditorReview): Promise<StudioWindowsEditorLaunchObservation> {
    return this.track(async () => {
      const p = this.reviews.get(review); requireCurrent(!this.closed && p && !p.attempted);
      // Reserve synchronously before the first await. Lost replies, exceptions
      // and partial VS Code creation never make this review reusable.
      p.attempted = true;
      try {
      await this.current(review.target, p);
      const issued = await this.options.client.issueEditor({ ...p.selection, token: review.confirmation.token });
      requireCurrent(issued.status === "issued" && !issued.duplicatePrevented && !issued.terminalLaunchAuthorized && issued.permit && issued.targetDigest === p.targetDigest);
      await this.current(review.target, p);
      const consumed = await this.options.client.consumeEditor({ ...p.selection, permit: issued.permit });
      requireCurrent(consumed.status === "consumed" && consumed.terminalLaunchAuthorized && !consumed.duplicatePrevented && consumed.target && consumed.targetDigest === p.targetDigest && digest(consumed.target) === p.targetDigest && consumed.expiresAt);
      const receivedAt = Date.now(), timely = () => requireCurrent(Date.now() >= receivedAt && Date.now() < consumed.expiresAt!);
      const current = async () => { timely(); await this.current(review.target, p); timely(); };
      await current();
      p.connectionAttempted = true;
      const connection = await this.options.client.openEditorConnection(p.selection);
      requireCurrent("endpoint" in connection && connection.duplicatePrevented === false);
      p.connection = connection; await current();
      const { shellArgs, env } = codexWindowsTerminalResume(review.target.sessionId, review.target.repositoryRoot, connection.endpoint);
      this.focused(review.target, p.project); p.createCalled = true;
      p.terminal = this.options.host.window.createTerminal({ name: "Switchyard · Codex task", cwd: review.target.repositoryRoot, shellPath: p.executable, shellArgs, env });
      requireCurrent(p.terminal);
      // Keep this exact object even if focus or a later context check fails.
      await revealExactTerminal(this.options.host.window, p.terminal, current);
      p.focusVerified = true;
      const process = await this.processIdentity(review); await current();
      p.peerAttempted = true;
      await this.options.client.pinEditorPeer({ ...p.selection, peer: process });
      const deadline = Date.now() + 8000;
      for (;;) {
        await current(); requireCurrent(Date.now() < deadline);
        const observed = await this.options.client.observeEditorConnection(p.selection);
        await current(); requireCurrent(Date.now() < deadline);
        if (observed.peerVerified && observed.protocolAcknowledged) { p.protocolAcknowledgementObserved = true; break; }
        await delay(25, undefined, { signal: this.processAbort.signal });
      }
      return this.observation(review);
      } catch (error) {
        p.protocolAcknowledgementObserved = false;
        try { await this.retire(p); } catch { if (error instanceof Error) Object.assign(error, { editorRetirementUnconfirmed: true }); }
        throw error;
      }
    });
  }
  focus(review: WindowsEditorReview): Promise<StudioWindowsEditorLaunchObservation> {
    return this.track(async () => {
      const p = this.reviews.get(review); requireCurrent(!this.closed && p?.terminal && p.createCalled);
      p.focusVerified = false; p.protocolAcknowledgementObserved = false;
      // Returning to an existing object creates no new launch permission and
      // never recreates a closed/ambiguous terminal. Reobserve the original
      // idle or active owner/account/task with its consumed editor selection.
      const current = async () => {
        await this.current(review.target, p);
        requireCurrent(this.options.host.window.terminals.includes(p.terminal!));
        const observed = await this.options.client.returnEditorTarget(p.selection);
        requireCurrent(observed.targetDigest === p.targetDigest && digest(observed.target) === p.targetDigest);
        await this.current(review.target, p);
        await this.connectionAcknowledged(p);
      };
      await revealExactTerminal(this.options.host.window, p.terminal, current);
      p.focusVerified = true; return this.observation(review);
    });
  }
  /** Local process evidence only; the exact connection must still acknowledge its account and task. */
  processIdentity(review: WindowsEditorReview): Promise<WindowsEditorPeer> {
    return this.track(async () => {
      const p = this.reviews.get(review); requireCurrent(!this.closed && p?.terminal && p.createCalled);
      const current = async () => {
        await this.current(review.target, p); requireCurrent(this.options.host.window.terminals.includes(p.terminal!));
        const observed = await this.options.client.returnEditorTarget(p.selection);
        requireCurrent(observed.targetDigest === p.targetDigest && digest(observed.target) === p.targetDigest);
        await this.current(review.target, p); requireCurrent(this.options.host.window.terminals.includes(p.terminal!));
      };
      const observed = await this.options.native.observeTerminal({ terminal: p.terminal, image: p.image, expected: p.process, assertCurrent: current, signal: this.processAbort.signal });
      // Concurrent observations cannot replace an earlier retained process birth.
      requireCurrent(!this.closed && this.options.host.window.terminals.includes(p.terminal) && (!p.process || digest(p.process) === digest(observed))); p.process = observed; return observed;
    });
  }
  observation(review: WindowsEditorReview): StudioWindowsEditorLaunchObservation {
    const p = this.reviews.get(review); requireCurrent(p);
    return Object.freeze({ requestId: p.selection.requestId, launchAttempted: p.attempted, terminalCreationRequested: p.createCalled, terminalObjectReturned: Boolean(p.terminal), focusVerified: p.focusVerified, nativeProcessObserved: Boolean(p.process), protocolAcknowledgementObserved: p.protocolAcknowledgementObserved === true, nativeTaskLoaded: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.processAbort.abort(); this.terminalClose.dispose(); this.workspaceChange.dispose();
    this.closing = (async () => {
      // Existing signed exchanges retain their original five-second bound.
      // Cancelling them here can destroy an in-flight retirement acknowledgement
      // and turn confirmed cleanup into an unknown outcome. New work is closed;
      // join the original operations before closing the client transport.
      await Promise.allSettled([...this.pending]);
      const results = await Promise.allSettled([...this.reviews.values()].map(p => this.retire(p)));
      this.options.client.close();
      const native = await Promise.allSettled([this.options.native.close()]); results.push(...native);
      const failed = results.find(r => r.status === "rejected"); if (failed?.status === "rejected") throw failed.reason;
    })(); return this.closing;
  }
}
