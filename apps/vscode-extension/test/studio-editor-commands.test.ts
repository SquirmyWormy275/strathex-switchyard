import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { StudioEditorCommands, studioEditorCommands } from "../src/studio-editor-commands.ts";
import type { VscodeLike, QuickPickItemLike, WorkspaceFolderLike } from "../src/vscode-like.ts";
import type { EditorCommandSession } from "../src/studio-editor-command-session.ts";

const id = "12345678-1234-1234-1234-123456789abc";
const root = process.platform === "win32" ? "C:\\project" : "/project";
const choice = { ownerRequestId: id, loadRequestId: id, taskId: id, label: "Review the release", loadedAt: 1 };
const flags = { complete: true, nativeObserved: false, authorityGranted: false, freshReviewRequired: true } as const;
function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>(), workspaceListeners = new Set<() => void>(), focusListeners = new Set<(state: { focused: boolean }) => void>();
  const folder: WorkspaceFolderLike = { uri: { scheme: "file", fsPath: root } };
  const folders = [folder], messages: string[] = [], warnings: string[] = [], counts = { created: 0, projects: 0, choices: 0, prepared: 0, launched: 0, focused: 0, closed: 0 };
  const selection: Array<(items: readonly QuickPickItemLike[]) => QuickPickItemLike | undefined | Promise<QuickPickItemLike | undefined>> = [];
  let picked: unknown, choicesCompartment = "personal", closeFails = false;
  let prepareWait = async () => {};
  const host = {
    commands: { registerCommand(name: string, callback: (...args: unknown[]) => unknown) { handlers.set(name, callback); return { dispose() { handlers.delete(name); } }; } },
    window: { state: { focused: true }, async showInformationMessage(message: string) { messages.push(message); }, async showWarningMessage(message: string) { warnings.push(message); },
      async showQuickPick(items: readonly QuickPickItemLike[]) { return selection.shift()?.(items); },
      onDidChangeWindowState(callback: (state: { focused: boolean }) => void) { focusListeners.add(callback); return { dispose() { focusListeners.delete(callback); } }; } },
    workspace: { workspaceFolders: folders, onDidChangeWorkspaceFolders(callback: () => void) { workspaceListeners.add(callback); return { dispose() { workspaceListeners.delete(callback); } }; } }
  } as unknown as VscodeLike;
  const result = { focusVerified: true, protocolAcknowledgementObserved: true, nativeTaskLoaded: false, ideAttached: false, modelPromptSubmitted: false } as const;
  const factory = (_host: VscodeLike, current: () => void): EditorCommandSession => {
    counts.created++; let closed = false;
    return {
      async projects() { counts.projects++; return { schema: "switchyard-editor-project-choices/v1", compartment: "personal", projects: [{ repositoryRoot: root, taskCount: 1 }], ...flags }; },
      async choices(repositoryRoot) { counts.choices++; assert.equal(repositoryRoot, root); return { schema: "switchyard-editor-task-choices/v1", compartment: choicesCompartment, repositoryRoot, choices: [choice], ...flags }; },
      async prepare(s, repositoryRoot, taskId) { current(); await prepareWait(); current(); counts.prepared++; picked = s; return { repositoryRoot, taskId, permissions: "read-only/on-request", reason: "Open only this exact saved task", async launch() { current(); counts.launched++; return result; }, async focus() { current(); counts.focused++; return result; } }; },
      async close() { if (!closed) counts.closed++; closed = true; if (closeFails) throw Error("synthetic retirement refusal"); }
    };
  };
  const commands = new StudioEditorCommands(host, factory);
  return { commands, counts, messages, warnings, handlers, selection, folders, host, picked: () => picked, failClose: () => { closeFails = true; }, holdPrepare: (wait: () => Promise<void>) => { prepareWait = wait; }, changeCompartment: () => { choicesCompartment = "work"; },
    workspaceChanged() { workspaceListeners.forEach(fn => fn()); }, blurAndReturn() { focusListeners.forEach(fn => fn({ focused: false })); focusListeners.forEach(fn => fn({ focused: true })); },
    async run(kind: keyof typeof studioEditorCommands) { await handlers.get(studioEditorCommands[kind])!(); } };
}
const first = (items: readonly QuickPickItemLike[]) => items[0];
const last = (items: readonly QuickPickItemLike[]) => items.at(-1);

test("activation registers the commands without opening a client; browsing remains metadata only", async () => {
  const f = fixture(); try {
    assert.equal(f.counts.created, 0); f.selection.push(first, first); await f.run("browse");
    assert.deepEqual(f.counts, { created: 1, projects: 1, choices: 1, prepared: 0, launched: 0, focused: 0, closed: 1 }); assert.deepEqual(f.warnings, []);
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    for (const command of Object.values(studioEditorCommands)) { assert.ok(manifest.activationEvents.includes("onCommand:" + command)); assert.ok(manifest.contributes.commands.some((row: { command: string }) => row.command === command)); }
  } finally { await f.commands.close(); }
});

test("the exact task is reviewed before launch and Return reuses its owned terminal", async () => {
  const f = fixture(); try {
    f.selection.push(first, first, items => { assert.equal(f.counts.launched, 0); assert.equal(items[0]!.label, "Cancel"); assert.match(items.at(-1)!.detail!, /read-only\/on-request/); return items.at(-1); }); await f.run("connect");
    assert.deepEqual(f.picked(), { compartment: "personal", ownerRequestId: id, loadRequestId: id }); assert.equal(f.counts.launched, 1); assert.equal(f.counts.closed, 0);
    assert.match(f.messages.at(-1)!, /attachment and completion are not verified/);
    f.blurAndReturn(); f.selection.push(first); await f.run("return"); assert.equal(f.counts.focused, 1); assert.equal(f.counts.launched, 1); assert.deepEqual(f.warnings, []);
  } finally { await f.commands.close(); } assert.equal(f.counts.closed, 1);
});

test("cancelling each picker performs no launch and retires its client", async () => {
  for (const steps of [[() => undefined], [first, () => undefined], [first, first, first]]) {
    const f = fixture(); try { f.selection.push(...steps); await f.run("connect"); assert.equal(f.counts.launched, 0); assert.equal(f.counts.closed, 1); assert.deepEqual(f.warnings, []); } finally { await f.commands.close(); }
  }
});

test("changed window generation, substituted rows and changed workspace refuse before launch", async () => {
  for (const change of ["window", "project", "row", "compartment", "folder"]) {
    const f = fixture(); try {
      if (change === "compartment") f.changeCompartment();
      if (change === "folder") f.folders.splice(0);
      f.selection.push(first, items => { if (change === "window") f.blurAndReturn(); if (change === "project") f.workspaceChanged(); return change === "row" ? { ...items[0]! } : items[0]; }, last);
      await f.run("connect"); assert.equal(f.counts.launched, 0); assert.equal(f.counts.closed, 1); assert.equal(f.warnings.length, 1);
    } finally { await f.commands.close(); }
  }
});

test("deactivation retires the client while an unresolved picker cannot launch late", async () => {
  const f = fixture(); let resolve!: (value: QuickPickItemLike | undefined) => void, entered!: () => void, items: readonly QuickPickItemLike[] = [];
  const ready = new Promise<void>(r => { entered = r; });
  f.selection.push(rows => { items = rows; entered(); return new Promise(r => { resolve = r; }); });
  const command = f.run("connect"); await ready; await f.commands.close(); await command;
  resolve(items[0]); await new Promise(r => setImmediate(r)); assert.equal(f.counts.closed, 1); assert.equal(f.counts.launched, 0); assert.equal(f.handlers.size, 0);
});

test("uncertain retirement stays an error and command arguments cannot supply task identities", async () => {
  const f = fixture();
  await assert.rejects(async () => f.handlers.get(studioEditorCommands.connect)!({ taskId: id }), /cannot be supplied/); assert.equal(f.counts.created, 0);
  f.selection.push(first, first, last); await f.run("connect"); f.failClose(); await assert.rejects(f.commands.close(), /could not verify retirement/); assert.equal(f.counts.closed, 1);
});


test("deactivation does not wait on an executable picker and a late selection cannot prepare a launch", async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  f.holdPrepare(async () => { entered(); await gate; }); f.selection.push(first, first, last);
  const command = f.run("connect"); await ready;
  try { await f.commands.close(); await command; assert.equal(f.counts.closed, 1); }
  finally { release(); }
  await new Promise(r => setImmediate(r)); assert.equal(f.counts.prepared, 0); assert.equal(f.counts.launched, 0);
});
