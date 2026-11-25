import test from "node:test";
import assert from "node:assert/strict";
import { parseTmuxContext } from "./native-process.mjs";
import { createTmuxTaskWindow } from "./tmux-task-window.mjs";
import { createTaskWindow } from "./task-window.mjs";

function fixture() {
  const common = { uid: 1000, state: "S", startTicks: "100", cwd: "/repo" };
  const processes = new Map([
    [10, { ...common, pid: 10, parentPid: 20, groupId: 10, foregroundGroup: 10, tty: 42, executable: "/native/claude" }],
    [20, { ...common, pid: 20, parentPid: 1, groupId: 20, foregroundGroup: -1, tty: 0, executable: "/usr/bin/tmux" }],
    [30, { ...common, pid: 30, parentPid: 40, groupId: 30, foregroundGroup: 30, tty: 84, executable: "/usr/bin/tmux" }],
    [40, { ...common, pid: 40, parentPid: 1, groupId: 40, foregroundGroup: -1, tty: 0, executable: "/usr/bin/foot" }]
  ]);
  const context = { socket: "/private/tmux/socket", serverPid: 20, pane: "%3" }, calls = [], selection = { session: "$0", window: "@1", pane: "%4" };
  const state = { socketInode: 11, hooks: "after-list-panes\nafter-switch-client\n", extraClient: false, wrongSelection: false, wrongFocus: false, directoryMode: 0o700, socketOwner: 1000, socketLink: false, paneData: undefined };
  const readProcess = async pid => { assert.ok(processes.has(pid)); return structuredClone(processes.get(pid)); };
  const stat = async path => {
    const kind = path === "/private/tmux" ? "directory" : path === context.socket ? "socket" : "tty";
    assert.ok(["/private/tmux", context.socket, "/dev/pts/1", "/dev/pts/2"].includes(path));
    return { uid: kind === "socket" ? state.socketOwner : 1000, mode: kind === "directory" ? state.directoryMode : 0o600, dev: 1, ino: kind === "socket" ? state.socketInode : 12, rdev: path === "/dev/pts/1" ? 42 : 84, isDirectory: () => kind === "directory", isSocket: () => kind === "socket", isCharacterDevice: () => kind === "tty", isSymbolicLink: () => kind === "socket" && state.socketLink };
  };
  const command = async (socket, args) => {
    assert.equal(socket, context.socket); calls.push(["tmux", ...args]);
    if (args[0] === "show-hooks") return state.hooks;
    if (args[0] === "display-message") return state.paneData ?? "20\t$0\t@2\t%3\t10\t/dev/pts/1\n";
    if (args[0] === "list-clients") { const row = `20\t30\t/dev/pts/2\t${selection.session}\t${selection.window}\t${selection.pane}\n`; return state.extraClient ? row + row : row; }
    assert.deepEqual(args, ["switch-client", "-E", "-c", "/dev/pts/2", "-t", "%3"]);
    if (!state.wrongSelection) Object.assign(selection, { session: "$0", window: "@2", pane: "%3" }); return "";
  };
  const tmux = createTmuxTaskWindow({ readProcess, stat, command, uid: 1000, readContext: async () => structuredClone(context) });
  const hypr = async (...args) => { calls.push(["hypr", ...args]); if (args[0] === "clients") return JSON.stringify([{ address: "0x40", pid: 40, mapped: true, hidden: false }]); if (args[0] === "dispatch") return "ok\n"; return JSON.stringify({ address: state.wrongFocus ? "0x99" : "0x40", pid: 40 }); };
  return { processes, context, calls, state, tmux, request: { row: { kind: "interactive", pid: 10 }, executable: "/native/claude", repositoryRoot: "/repo", verifySession: async () => {} }, options: { readProcess, tmux, hypr, uid: 1000, platform: "linux" }, inspect: () => tmux.inspect({ cli: processes.get(10), lineage: [processes.get(10)], server: processes.get(20) }) };
}
test("only bounded tmux coordinates are extracted; unrelated environment values are never decoded or returned", () => {
  const bytes = Buffer.concat([Buffer.from("PROVIDER_KEY=NEVER_COPY_SECRET\0INVALID="), Buffer.from([255]), Buffer.from("\0TMUX=/private/tmux/socket,20,0\0TMUX_PANE=%3\0")]);
  assert.deepEqual(parseTmuxContext(bytes), { socket: "/private/tmux/socket", serverPid: 20, pane: "%3" }); assert.equal(JSON.stringify(parseTmuxContext(bytes)).includes("NEVER_"), false);
  for (const text of ["TMUX=x,20,0\0TMUX_PANE=%3\0", "TMUX=/private/../socket,20,0\0TMUX_PANE=%3\0", "TMUX=/private/socket,0,0\0TMUX_PANE=%3\0", "TMUX=/private/socket,20,0\0TMUX_PANE=%3;run-shell\0", "TMUX=/private/socket,20,0\0TMUX=/other,20,0\0TMUX_PANE=%3\0", "TMUX=/private/socket,20,0\0", "TMUX=/private/socket,20,0\0TMUX_PANE=%3"]) assert.throws(() => parseTmuxContext(Buffer.from(text)));
  assert.throws(() => parseTmuxContext(Buffer.alloc(65537)));
});
test("exact pane navigation selects only native IDs and verifies process/socket/client/window readback without terminal text", async () => {
  const f = fixture(); let current = 0;
  const result = await createTaskWindow(f.options).focus({ ...f.request, verifySession: async () => { current++; } });
  assert.equal(current, 3); assert.equal(result.terminalKind, "foot+tmux"); assert.equal(result.paneFocusVerified, true); assert.equal(result.windowFocusVerified, true); assert.equal(result.taskResumptionVerified, false); assert.equal(result.modelPromptSubmitted, false);
  assert.equal(f.calls.filter(row => row[0] === "tmux" && row[1] === "switch-client").length, 1); assert.equal(f.calls.filter(row => row[0] === "hypr" && row[1] === "dispatch").length, 1); assert.equal(JSON.stringify(result).includes("/private"), false); assert.ok(f.calls.every(row => !row.includes("send-keys") && !row.includes("run-shell")));
});

test("tmux selection enforces its caller's current authorization after socket validation", async () => {
  const f = fixture(), observed = await f.inspect();
  await assert.rejects(f.tmux.select(observed.witness, { assertCurrent: async () => { throw Error("Synthetic role authorization changed"); } }), /role authorization changed/);
  assert.equal(f.calls.some(call => call[1] === "switch-client"), false);
});

test("a changed role after exact pane selection prevents compositor focus and claims no successful result", async () => {
  const f = fixture();
  await assert.rejects(createTaskWindow(f.options).focus({ ...f.request, assertCurrent: async () => {
    if (f.calls.some(call => call[1] === "switch-client")) throw Error("Synthetic role authorization changed after pane selection");
  } }), /role authorization changed/);
  assert.equal(f.calls.filter(call => call[1] === "switch-client").length, 1);
  assert.equal(f.calls.some(call => call[1] === "dispatch"), false);
});
test("configured hooks refuse before any query with an after hook, without copying hook bodies or dispatching navigation", async () => {
  const f = fixture(); f.state.hooks = "after-list-panes[0] run-shell 'NEVER_EXECUTE'\n";
  await assert.rejects(f.inspect(), error => /Configured tmux hooks/.test(error.message) && !error.message.includes("NEVER_"));
  assert.ok(f.calls.every(row => row[1] === "show-hooks"));
});
test("shared clients, wrong native owner/TTY/foreground/executable and mismatched server coordinates refuse navigation", async () => {
  const changes = [f => { f.state.extraClient = true; }, f => { f.processes.get(30).uid = 2000; }, f => { f.processes.get(30).tty = 42; }, f => { f.processes.get(30).foregroundGroup = 99; }, f => { f.processes.get(30).executable = "/other/tmux"; }, f => { f.context.serverPid = 21; }, f => { f.context.pane = "%5"; }];
  for (const change of changes) { const f = fixture(); change(f); await assert.rejects(createTaskWindow(f.options).focus(f.request)); assert.equal(f.calls.some(row => row[1] === "switch-client" || row[1] === "dispatch"), false); }
});
test("process/socket drift and account revocation cannot inherit a prior pane witness or authorize a later window effect", async () => {
  for (const change of [f => { f.state.socketInode++; }, f => { f.processes.get(20).startTicks = "101"; }, f => { f.processes.get(30).startTicks = "101"; }]) {
    const f = fixture(); await assert.rejects(createTaskWindow(f.options).focus({ ...f.request, verifySession: async () => change(f) }), /changed before focus/); assert.equal(f.calls.some(row => row[1] === "switch-client" || row[1] === "dispatch"), false);
  }
  const f = fixture(); let calls = 0; await assert.rejects(createTaskWindow(f.options).focus({ ...f.request, verifySession: async () => { if (++calls === 2) throw Error("Account revoked after pane selection"); } }), /Account revoked/); assert.equal(f.calls.filter(row => row[1] === "switch-client").length, 1); assert.equal(f.calls.some(row => row[1] === "dispatch"), false);
});
test("wrong pane or compositor readback never establishes a successful focus result", async () => {
  const f = fixture(); f.state.wrongSelection = true; await assert.rejects(createTaskWindow(f.options).focus(f.request), /pane selection was not verified/); assert.equal(f.calls.some(row => row[1] === "dispatch"), false);
  const next = fixture(); next.state.wrongFocus = true; await assert.rejects(createTaskWindow(next.options).focus(next.request), /not verified after dispatch/);
});

test("unprotected/replaced socket metadata and malformed native replies cannot select a pane", async () => {
  const changes = [f => { f.state.directoryMode = 0o770; }, f => { f.state.socketOwner = 2000; }, f => { f.state.socketLink = true; }, f => { f.state.paneData = "20\t$0\t@2\t%3\t10\t/dev/pts/1\n20\t$0\t@2\t%3\t10\t/dev/pts/1\n"; }, f => { f.state.paneData = "20\t$0\t@2\t%3;run-shell\t10\t/dev/pts/1\n"; }, f => { f.state.paneData = "NEVER_COPY_SOURCE".repeat(8192); }];
  for (const change of changes) { const f = fixture(); change(f); await assert.rejects(createTaskWindow(f.options).focus(f.request)); assert.equal(f.calls.some(row => row[1] === "switch-client" || row[1] === "dispatch"), false); }
});
