import { createHash } from "node:crypto";
import { readlink, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { StudioTaskClient, type StudioEditorSelection } from "./studio-task-client.ts";
import { StudioWindowsTaskClient } from "./studio-windows-task-client.ts";
import { StudioWindowsNative } from "./studio-windows-native.ts";
import { StudioEditorLauncher } from "./studio-editor-launch.ts";
import { StudioWindowsEditorLauncher } from "./studio-windows-editor-launch.ts";
import type { StudioEditorChoices, StudioEditorProjects } from "./studio-editor-choices.ts";
import type { VscodeLike } from "./vscode-like.ts";

export interface EditorConnectionResult {
  readonly focusVerified: boolean; readonly protocolAcknowledgementObserved: boolean;
  readonly nativeTaskLoaded: false; readonly ideAttached: false; readonly modelPromptSubmitted: false;
}
export interface PreparedEditorConnection {
  readonly repositoryRoot: string; readonly taskId: string; readonly permissions: string; readonly reason: string;
  launch(): Promise<EditorConnectionResult>;
  focus(): Promise<EditorConnectionResult>;
}
export interface EditorCommandSession {
  projects(): Promise<StudioEditorProjects>;
  choices(repositoryRoot: string): Promise<StudioEditorChoices>;
  prepare(selection: StudioEditorSelection, repositoryRoot: string, taskId: string): Promise<PreparedEditorConnection | undefined>;
  close(): Promise<void>;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const requireValue = (value: unknown): void => { if (!value) throw Error("The original selected editor task changed. Start a fresh review."); };

/** Commands select only saved identities. This factory retains the existing signed
 * clients and launchers; it adds no transport, process search or runtime fallback. */
export function createEditorCommandSession(host: VscodeLike, assertTargetCurrent: () => void): EditorCommandSession {
  let retired = false, closing: Promise<void> | undefined;
  let launcher: StudioEditorLauncher | StudioWindowsEditorLauncher | undefined;
  const currentInstance = () => requireValue(!retired);
  const native = process.platform === "win32" ? new StudioWindowsNative({
    endpointPath: join(process.env.XDG_STATE_HOME || process.env.LOCALAPPDATA || join(homedir(), "AppData/Local"), "strathex-switchyard/application/endpoint.json"),
    assertCurrent: currentInstance
  }) : undefined;
  if (process.platform !== "linux" && process.platform !== "win32") throw Error("Saved editor connections are available on Linux and Windows.");
  const client = native ? new StudioWindowsTaskClient({ readEndpoint: () => native.readEndpoint(), assertCurrent: currentInstance }) : new StudioTaskClient({ assertCurrent: currentInstance });
  async function close(): Promise<void> {
    return closing ??= (async () => {
      const errors: unknown[] = [];
      try { await launcher?.close(); } catch (error) { errors.push(error); }
      // Retirement exchanges keep their original bounded client lifetime.
      retired = true; client.close();
      try { await native?.close(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "The editor connection could not verify complete retirement. Its original records remain retained.");
    })();
  }
  return {
    projects: () => client.editorProjects(), choices: root => client.editorChoices(root), close,
    async prepare(selection, repositoryRoot, taskId) {
      requireValue(!launcher && !retired); assertTargetCurrent();
      const observed = await client.editorTarget(selection); assertTargetCurrent();
      requireValue(observed.target.repositoryRoot === repositoryRoot && observed.target.taskId === taskId);
      const expected = digest(observed.target), current = (target: unknown) => { assertTargetCurrent(); requireValue(digest(target) === expected); };
      let executable: string;
      if (process.platform === "linux") {
        // Inspect exactly the authenticated owner's PID, never enumerate processes.
        executable = await readlink(`/proc/${observed.target.endpoint.peerPid}/exe`); assertTargetCurrent();
        requireValue(await realpath(executable) === executable);
      } else {
        if (!host.window.showOpenDialog) throw Error("This editor cannot select the installed native Codex executable.");
        const files = await host.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: "Review installed native Codex", filters: { "Native executable": ["exe"] } });
        assertTargetCurrent(); if (!files?.length) return undefined;
        requireValue(files.length === 1); executable = await realpath(files[0]!.fsPath); assertTargetCurrent();
      }
      if (client instanceof StudioTaskClient) {
        const owned = new StudioEditorLauncher({ client, host, executable, assertCurrent: current }); launcher = owned;
        const review = await owned.review(selection); assertTargetCurrent();
        return Object.freeze({ repositoryRoot, taskId, permissions: review.target.permissions, reason: review.confirmation.record.reason, launch: () => owned.launch(review), focus: () => owned.focus(review) });
      }
      const owned = new StudioWindowsEditorLauncher({ client, native: native!, host, executable, assertCurrent: current }); launcher = owned;
      const review = await owned.review(selection); assertTargetCurrent();
      return Object.freeze({ repositoryRoot, taskId, permissions: review.target.permissions, reason: review.confirmation.record.reason, launch: () => owned.launch(review), focus: () => owned.focus(review) });
    }
  };
}
