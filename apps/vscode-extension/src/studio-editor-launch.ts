import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { codexTerminalResumeArguments } from "./codex-terminal.ts";
import { revealExactTerminal } from "./terminal-focus.ts";
import type { StudioEditorRequest, StudioEditorReview, StudioEditorSelection, StudioEditorTarget, StudioTaskClient } from "./studio-task-client.ts";
import type { TerminalLike, VscodeLike } from "./vscode-like.ts";

type Client = Pick<StudioTaskClient, "editorTarget" | "reviewEditor" | "issueEditor" | "consumeEditor" | "close">;
type Host = Pick<VscodeLike, "window" | "workspace">;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = (s: BigIntStats) => [s.dev, s.ino, s.size, s.uid, s.mode, s.mtimeNs, s.ctimeNs].join(":");
function requireCurrent(value: unknown): asserts value { if (!value) throw Error("The original reviewed editor launch is no longer current."); }
interface Prepared {
  readonly selection: StudioEditorRequest; readonly review: StudioEditorReview;
  readonly targetDigest: string; readonly executable: string; readonly executableIdentity: string;
  attempted: boolean; createCalled: boolean; terminal?: TerminalLike; focusVerified: boolean;
}
export interface StudioEditorLaunchObservation {
  readonly requestId: string; readonly launchAttempted: boolean; readonly terminalCreationRequested: boolean;
  readonly terminalObjectReturned: boolean; readonly focusVerified: boolean;
  readonly nativeTaskLoaded: false; readonly ideAttached: false; readonly modelPromptSubmitted: false; readonly completionVerified: false;
}

/** Owns one client and exact Terminal object per reviewed request. No command registration or native attachment claim. */
export class StudioEditorLauncher {
  private readonly editorId = randomUUID();
  private readonly reviews = new Map<StudioEditorReview, Prepared>();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  private readonly options: Readonly<{ client: Client; host: Host; executable: string; assertCurrent: (target: StudioEditorTarget) => void | Promise<void> }>;
  constructor(options: { client: Client; host: Host; executable: string; assertCurrent: (target: StudioEditorTarget) => void | Promise<void> }) {
    requireCurrent(isAbsolute(options.executable) && normalize(options.executable) === options.executable && typeof options.assertCurrent === "function");
    this.options = Object.freeze({ ...options });
  }
  private track<T>(fn: () => Promise<T>): Promise<T> {
    const operation = fn(); this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation)); return operation;
  }
  private focused(target: StudioEditorTarget): void {
    requireCurrent(process.platform === "linux" && !this.closed && this.options.host.window.state.focused);
    requireCurrent(this.options.host.workspace.workspaceFolders?.some(folder => folder.uri.fsPath === target.repositoryRoot));
  }
  private async current(target: StudioEditorTarget, prepared?: Prepared): Promise<void> {
    this.focused(target); await this.options.assertCurrent(target); this.focused(target);
    const root = await lstat(target.repositoryRoot, { bigint: true });
    requireCurrent(root.isDirectory() && !root.isSymbolicLink() && String(root.dev) === target.repositoryIdentity.device && String(root.ino) === target.repositoryIdentity.inode && await realpath(target.repositoryRoot) === target.repositoryRoot);
    const socket = await lstat(target.endpoint.socketPath, { bigint: true });
    requireCurrent(socket.isSocket() && !socket.isSymbolicLink() && String(socket.dev) === target.endpoint.socketDevice && String(socket.ino) === target.endpoint.socketInode && socket.uid === BigInt(process.getuid!()) && !(socket.mode & 0o077n) && await realpath(target.endpoint.socketPath) === target.endpoint.socketPath);
    if (prepared) {
      requireCurrent(await realpath(this.options.executable) === prepared.executable);
      const image = await lstat(prepared.executable, { bigint: true }); requireCurrent(image.isFile() && !image.isSymbolicLink() && identity(image) === prepared.executableIdentity);
    }
    this.focused(target);
  }
  private async image(target: StudioEditorTarget): Promise<{ executable: string; executableIdentity: string }> {
    const executable = await realpath(this.options.executable), file = await open(executable, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await file.stat({ bigint: true });
      requireCurrent(before.isFile() && before.size > 0n && before.size <= 512n * 1024n * 1024n && (before.mode & 0o111n) && !(before.mode & 0o022n) && (before.uid === 0n || before.uid === BigInt(process.getuid!())));
      const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024); let bytes = 0;
      for (;;) { this.focused(target); const read = await file.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break; bytes += read.bytesRead; requireCurrent(bytes <= Number(before.size)); hash.update(buffer.subarray(0, read.bytesRead)); }
      requireCurrent(bytes === Number(before.size) && hash.digest("hex") === target.endpoint.peerExecutableSha256 && identity(await file.stat({ bigint: true })) === identity(before));
      requireCurrent(identity(await lstat(executable, { bigint: true })) === identity(before) && await realpath(this.options.executable) === executable);
      return { executable, executableIdentity: identity(before) };
    } finally { await file.close(); }
  }
  review(input: StudioEditorSelection): Promise<StudioEditorReview> {
    // The client validates this copied closed selection before any I/O.
    const selected = Object.freeze({ ...input });
    return this.track(async () => {
      requireCurrent(!this.closed && this.reviews.size < 64);
      const observed = await this.options.client.editorTarget(selected); await this.current(observed.target);
      const image = await this.image(observed.target), selection = Object.freeze({ ...selected, requestId: randomUUID(), editorId: this.editorId });
      const review = await this.options.client.reviewEditor(selection);
      requireCurrent(digest(review.target) === observed.targetDigest);
      const prepared: Prepared = { selection, review, targetDigest: observed.targetDigest, ...image, attempted: false, createCalled: false, focusVerified: false };
      await this.current(review.target, prepared); requireCurrent(this.reviews.size < 64);
      this.reviews.set(review, prepared); return review;
    });
  }
  launch(review: StudioEditorReview): Promise<StudioEditorLaunchObservation> {
    return this.track(async () => {
      const p = this.reviews.get(review); requireCurrent(!this.closed && p && !p.attempted);
      // Reserve synchronously before the first await. Lost replies, exceptions
      // and partial VS Code creation never make this review reusable.
      p.attempted = true;
      await this.current(review.target, p);
      const issued = await this.options.client.issueEditor({ ...p.selection, token: review.confirmation.token });
      requireCurrent(issued.status === "issued" && !issued.duplicatePrevented && !issued.terminalLaunchAuthorized && issued.permit && issued.targetDigest === p.targetDigest);
      await this.current(review.target, p);
      const consumed = await this.options.client.consumeEditor({ ...p.selection, permit: issued.permit });
      requireCurrent(consumed.status === "consumed" && consumed.terminalLaunchAuthorized && !consumed.duplicatePrevented && consumed.target && consumed.targetDigest === p.targetDigest && digest(consumed.target) === p.targetDigest && consumed.expiresAt);
      const receivedAt = Date.now(), timely = () => requireCurrent(Date.now() >= receivedAt && Date.now() < consumed.expiresAt!);
      const current = async () => { timely(); await this.current(review.target, p); timely(); };
      await current();
      const shellArgs = codexTerminalResumeArguments(review.target.sessionId, review.target.repositoryRoot, review.target.endpoint.socketPath);
      this.focused(review.target); p.createCalled = true;
      p.terminal = this.options.host.window.createTerminal({ name: "Switchyard · Codex task", cwd: review.target.repositoryRoot, shellPath: p.executable, shellArgs });
      requireCurrent(p.terminal);
      // Keep this exact object even if focus or a later context check fails.
      await revealExactTerminal(this.options.host.window, p.terminal, current);
      p.focusVerified = true; return this.observation(review);
    });
  }
  focus(review: StudioEditorReview): Promise<StudioEditorLaunchObservation> {
    return this.track(async () => {
      const p = this.reviews.get(review); requireCurrent(!this.closed && p?.terminal && p.createCalled);
      p.focusVerified = false;
      // Returning to an existing object creates no new launch permission and
      // never recreates a closed/ambiguous terminal. Reobserve the original
      // idle owner/account/task before revealing its retained object.
      const current = async () => {
        await this.current(review.target, p);
        requireCurrent(this.options.host.window.terminals.includes(p.terminal!));
        const { compartment, ownerRequestId, loadRequestId } = p.selection;
        const observed = await this.options.client.editorTarget({ compartment, ownerRequestId, loadRequestId });
        requireCurrent(observed.targetDigest === p.targetDigest && digest(observed.target) === p.targetDigest);
        await this.current(review.target, p);
      };
      await revealExactTerminal(this.options.host.window, p.terminal, current);
      p.focusVerified = true; return this.observation(review);
    });
  }
  observation(review: StudioEditorReview): StudioEditorLaunchObservation {
    const p = this.reviews.get(review); requireCurrent(p);
    return Object.freeze({ requestId: p.selection.requestId, launchAttempted: p.attempted, terminalCreationRequested: p.createCalled, terminalObjectReturned: Boolean(p.terminal), focusVerified: p.focusVerified, nativeTaskLoaded: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false });
  }
  async close(): Promise<void> { this.closed = true; this.options.client.close(); await Promise.allSettled([...this.pending]); }
}
