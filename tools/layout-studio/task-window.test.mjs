import test from "node:test";
import assert from "node:assert/strict";
import { createTaskWindow, processStat } from "./task-window.mjs";

function fixture() {
  const common = { uid: 1000, state: "S", startTicks: "1000", groupId: 10, foregroundGroup: 10, tty: 42, cwd: "/repo" };
  const processes = new Map([[10, { ...common, pid: 10, parentPid: 20, executable: "/native/claude" }], [20, { ...common, pid: 20, parentPid: 1, executable: "/usr/bin/foot" }]]);
  const windows = [{ address: "0x10", pid: 20, mapped: true, hidden: false }], calls = []; let wrongFocus = false;
  const hypr = async (...args) => { calls.push(args); if (args[0] === "clients") return JSON.stringify(windows); if (args[0] === "dispatch") return "ok\n"; if (args[0] === "activewindow") return JSON.stringify({ address: wrongFocus ? "0x11" : "0x10", pid: 20 }); throw new Error("Unexpected compositor command"); };
  const options = { platform: "linux", uid: 1000, hypr, readProcess: async (pid) => { const value = processes.get(pid); if (!value) throw new Error("Process disappeared"); return structuredClone(value); } };
  const request = { row: { kind: "interactive", pid: 10 }, executable: "/native/claude", repositoryRoot: "/repo", verifySession: async () => {} };
  return { processes, windows, calls, options, request, wrongFocus: () => { wrongFocus = true; } };
}

test("process stat parsing handles spaces and parentheses without confusing PID/start/group fields", () => {
  const fields = ["S", "20", "10", "10", "42", "10", ...Array(13).fill("0"), "123456", "0"];
  const value = processStat(`10 (odd ) process name) ${fields.join(" ")}`, 10);
  assert.deepEqual(value, { pid: 10, state: "S", parentPid: 20, groupId: 10, tty: 42, foregroundGroup: 10, startTicks: "123456" });
  assert.throws(() => processStat(`11 (wrong pid) ${fields.join(" ")}`, 10), /identity/);
});

test("exact interactive focus verifies session twice, PID lineage and compositor readback without resumption or typing claims", async () => {
  const f = fixture(); let checks = 0;
  const r = await createTaskWindow(f.options).focus({ ...f.request, verifySession: async () => { checks++; } });
  assert.equal(checks, 2); assert.equal(r.windowFocusVerified, true); assert.equal(r.taskResumptionVerified, false); assert.equal(r.modelPromptSubmitted, false);
  assert.deepEqual(f.calls.filter((c) => c[0] === "dispatch"), [["dispatch", 'hl.dsp.focus({ window = "address:0x10" })']]);
});

test("wrong accounts/process owners, directories, executable identity and background groups cannot choose a window", async () => {
  for (const change of [{ uid: 2000 }, { cwd: "/other" }, { executable: "/fake/claude" }, { foregroundGroup: 99 }, { tty: 0 }]) {
    const f = fixture(); Object.assign(f.processes.get(10), change);
    await assert.rejects(createTaskWindow(f.options).focus(f.request), /exact Claude CLI/); assert.equal(f.calls.some((c) => c[0] === "dispatch"), false);
  }
  const f = fixture();
  await assert.rejects(createTaskWindow(f.options).focus({ ...f.request, row: { kind: "background", pid: 10 } }), /Background worker/);
  await assert.rejects(createTaskWindow({ ...f.options, platform: "win32" }).focus(f.request), /Windows.*unfinished/);
});

test("multiplexed/shared/ambiguous terminals and native PID reuse fail before focus", async () => {
  const f = fixture(); f.processes.get(20).executable = "/usr/bin/tmux";
  await assert.rejects(createTaskWindow(f.options).focus(f.request), /not a direct Foot/);
  f.processes.get(20).executable = "/usr/bin/foot"; f.windows.push({ ...f.windows[0], address: "0x11" });
  await assert.rejects(createTaskWindow(f.options).focus(f.request), /One exact mapped/);
  f.windows.pop();
  await assert.rejects(createTaskWindow(f.options).focus({ ...f.request, verifySession: async () => { f.processes.get(10).startTicks = "2000"; } }), /changed before focus/);
  assert.equal(f.calls.some((c) => c[0] === "dispatch"), false);
});

test("focus cannot turn a wrong compositor acknowledgement into an exact task result", async () => {
  const f = fixture(); f.wrongFocus();
  await assert.rejects(createTaskWindow(f.options).focus(f.request), /not verified after/);
  const next = fixture();
  await assert.rejects(createTaskWindow(next.options).focus({ ...next.request, verifySession: async () => { throw new Error("Provider session changed"); } }), /Provider session changed/);
  assert.equal(next.calls.some((c) => c[0] === "dispatch"), false);
});
