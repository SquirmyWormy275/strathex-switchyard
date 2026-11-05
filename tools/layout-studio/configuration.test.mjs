import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, chmod } from "node:fs/promises";
import { tmpdir, homedir, userInfo } from "node:os";
import { join } from "node:path";
import { newPlan, parseBoardProfile } from "./model.mjs";
import { portableProfile, importProfile, proposalContext, reviewProposal, compileConnection } from "./workspace.mjs";
import { snapshotChoices, importVialSnapshot } from "./vial-snapshot.mjs";
import { createHostBridge, discoverHost, nativeChatgptWindow, focusNativeChatgpt } from "./host.mjs";
import { createStudioServer } from "./serve.mjs";

function plan() {
  const p = newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic keyboard", layout: "two-keys", controller: "unknown", keys: [
    { id: "one", label: "First", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_F1" },
    { id: "two", label: "Second", matrix: [0, 1], x: 1, y: 0, baseKeycode: "KC_C" }
  ] }));
  p.actions.push({ id: "summon", label: "Show ChatGPT", family: "routing", consequence: "navigation", confirmation: false, frequencyPerDay: 0, secondsSaved: 0, binding: { keyId: "one", modifier: "gui_alt" } });
  return p;
}

function chatgptFocusFixture() {
  const process = { pid: 123, uid: userInfo().uid, executable: join(homedir(), ".local/lib/chatgpt-visible-voice/native/ChatGPT"), state: "S", startTicks: "12345" };
  const window = { pid: process.pid, address: "0x123", initialClass: "chatgpt", mapped: true, hidden: false, floating: false }, windows = [window], calls = [];
  let dispatch = () => {}, active = () => ({ pid: process.pid, address: window.address });
  const hypr = async (...args) => { calls.push(args); if (args[0] === "clients") return JSON.stringify(windows); if (args[0] === "dispatch") { dispatch(); return "ok\n"; } if (args[0] === "activewindow") return JSON.stringify(active()); throw Error("Unexpected native target command"); };
  return { process, window, windows, calls, hypr, readProcess: async pid => { assert.equal(pid, 123); return structuredClone(process); }, onDispatch: callback => { dispatch = callback; }, active: callback => { active = callback; } };
}

test("native ChatGPT focus uses its exact repaired main-window address and process birth without prompting or resuming", async () => {
  const f = chatgptFocusFixture(); f.windows.push({ ...f.window, address: "0x456", floating: true }); let checks = 0;
  const result = await focusNativeChatgpt(f.hypr, { readProcess: f.readProcess, assertCurrent: async () => { checks++; } });
  assert.equal(checks, 3); assert.equal(result.windowFocusVerified, true); assert.equal(result.taskResumptionVerified, false); assert.equal(result.accountVerified, false); assert.equal(result.modelPromptSubmitted, false);
  assert.deepEqual(f.calls.filter(call => call[0] === "dispatch"), [["dispatch", 'hl.dsp.focus({ window = "address:0x123" })']]);
});

test("native ChatGPT focus refuses foreign executables or owners, hidden windows, overlays and malformed addresses", async () => {
  for (const change of [f => { f.process.uid++; }, f => { f.process.executable = "/usr/lib/chatgpt/ChatGPT"; }, f => { f.process.state = "Z"; }, f => { f.process.startTicks = "0"; }, f => { f.window.hidden = true; }, f => { delete f.window.hidden; }, f => { f.window.mapped = false; }, f => { f.window.floating = true; }, f => { f.window.address = '0x123" }); arbitrary'; }]) {
    const f = chatgptFocusFixture(); change(f); await assert.rejects(focusNativeChatgpt(f.hypr, { readProcess: f.readProcess }), /one native ChatGPT main window/); assert.equal(f.calls.some(call => call[0] === "dispatch"), false);
  }
  for (const extra of [{ hidden: false, mapped: true }, { hidden: true, mapped: true }, { hidden: false, mapped: false }]) { const f = chatgptFocusFixture(); f.windows.push({ ...f.window, address: "0x456", ...extra }); await assert.rejects(nativeChatgptWindow(f.hypr, f.readProcess), /one native ChatGPT main window/); }
});

test("native ChatGPT PID reuse and workspace-policy revocation refuse before focus", async () => {
  const f = chatgptFocusFixture(); let checks = 0;
  await assert.rejects(focusNativeChatgpt(f.hypr, { readProcess: f.readProcess, assertCurrent: async () => { if (++checks === 2) f.process.startTicks = "98765"; } }), /changed before focus/);
  assert.equal(f.calls.some(call => call[0] === "dispatch"), false);
  const next = chatgptFocusFixture();
  await assert.rejects(focusNativeChatgpt(next.hypr, { readProcess: next.readProcess, assertCurrent: async () => { throw Error("Selected workspace policy revoked"); } }), /workspace policy revoked/);
  assert.equal(next.calls.length, 0);
});

test("native ChatGPT focus cannot upgrade wrong-window readback, process replacement or post-effect policy refusal", async () => {
  const f = chatgptFocusFixture(); f.active(() => ({ pid: 123, address: "0x456" })); await assert.rejects(focusNativeChatgpt(f.hypr, { readProcess: f.readProcess }), /not verified after focus/);
  const changed = chatgptFocusFixture(); changed.onDispatch(() => { changed.process.startTicks = "98765"; }); await assert.rejects(focusNativeChatgpt(changed.hypr, { readProcess: changed.readProcess }), /not verified after focus/);
  const revoked = chatgptFocusFixture(); let checks = 0;
  await assert.rejects(focusNativeChatgpt(revoked.hypr, { readProcess: revoked.readProcess, assertCurrent: async () => { if (++checks === 3) throw Error("Policy changed after effect"); } }), /Policy changed after effect/);
  assert.equal(revoked.calls.filter(call => call[0] === "dispatch").length, 1);
});

test("portable profile migrates legacy plans, excludes environment connections, and rejects future versions", () => {
  const p = plan(); p.localBindings = { credential: "never-portable", path: "/private" };
  const migrated = importProfile(p);
  assert.equal(migrated.schema, "switchyard-profile/v1");
  assert.equal(JSON.stringify(migrated).includes("never-portable"), false);
  assert.deepEqual(importProfile(JSON.parse(JSON.stringify(migrated))), migrated);
  assert.throws(() => importProfile({ ...migrated, schema: "switchyard-profile/v9" }), /Keep the original/);
  assert.equal(p.actions[0].binding.keyId, "one");
});

test("assistant proposal and direct edits share one model with stale, malicious, and typing-conflict rejection", () => {
  const p = plan();
  const proposal = { ...proposalContext(p), summary: "Put the same control on the second key", operations: [{ type: "move-action", actionId: "summon", keyId: "two", modifier: "gui_alt" }] };
  const adopted = reviewProposal(proposal, p).plan;
  assert.equal(adopted.actions[0].binding.keyId, "two");
  assert.equal(p.actions[0].binding.keyId, "one");
  assert.throws(() => reviewProposal(proposal, adopted), /earlier plan/);
  assert.throws(() => reviewProposal({ ...proposal, operations: [{ type: "exec", command: "untrusted" }] }, p), /outside/);
  assert.throws(() => reviewProposal({ ...proposal, operations: [{ type: "move-action", actionId: "summon", keyId: "two", modifier: "none" }] }, p), /replace ordinary/);
  assert.throws(() => reviewProposal({ ...proposal, operations: [{ type: "move-action", actionId: "summon", keyId: "wrong-board", modifier: "gui_alt" }] }, p), /does not name/);
  assert.throws(() => reviewProposal({ ...proposal, operations: Array(65).fill(proposal.operations[0]) }, p), /count/);
});

test("closed connection compiler never accepts commands, unsafe modifiers, or unknown firmware keycodes", () => {
  assert.equal(compileConnection(plan(), "summon", "native-chatgpt.focus/v1").shortcut, "SUPER + ALT + F1");
  assert.throws(() => compileConnection(plan(), "summon", "shell"), /unavailable/);
  const p = plan(); p.actions[0].binding.modifier = "none";
  assert.throws(() => compileConnection(p, "summon", "native-chatgpt.focus/v1"), /conflicts/);
  p.actions[0].binding.modifier = "ctrl_shift";
  assert.throws(() => compileConnection(p, "summon", "native-chatgpt.focus/v1"), /Super/);
  p.actions[0].binding.modifier = "gui_alt"; p.profile = { ...p.profile, keys: p.profile.keys.map((k) => ({ ...k, baseKeycode: "VIAL_0X4250" })) };
  assert.throws(() => compileConnection(p, "summon", "native-chatgpt.focus/v1"), /cannot be guessed/);
});

test("saved Vial configuration requires explicit geometry choices and preserves actual Dvorak keycodes without serials", () => {
  const snapshot = { rows: 1, cols: 2, serial: "private-device", keymap_raw: [[[52, 4]]], definition: { name: "Synthetic F", layouts: { labels: ["Split"], keymap: [["0,0", "0,1\n\n\n0,1"]] } } };
  assert.equal(snapshotChoices(snapshot).length, 1);
  assert.throws(() => importVialSnapshot(snapshot, []), /every physical/);
  const p = importVialSnapshot(snapshot, [1]);
  assert.equal(p.keys.length, 2);
  assert.equal(p.keys[0].baseKeycode, "KC_QUOT");
  assert.equal(p.controller, "unknown");
  assert.equal(JSON.stringify(p).includes("private-device"), false);
  assert.throws(() => snapshotChoices(snapshot.definition), /definition alone/);
  assert.throws(() => importVialSnapshot({ ...snapshot, keymap_raw: [[[52]]] }, [1]), /dimensions/);
  const rotated = importVialSnapshot({ ...snapshot, definition: { ...snapshot.definition, layouts: { ...snapshot.definition.layouts, keymap: [[{ r: 15 }, "0,0"]] } } }, [1]);
  assert.equal(rotated.keys[0].rotation, 15);
  assert.throws(() => importVialSnapshot({ ...snapshot, definition: { ...snapshot.definition, layouts: { ...snapshot.definition.layouts, keymap: [[{ r: 181 }, "0,0"]] } } }, [1]), /coordinate/);
});

test("bridge API rejects missing auth, foreign origins, DNS rebinding, unsafe routes and oversized requests", async () => {
  let effects = 0;
  const bridge = { review: async () => ({ reviewId: "single-use" }), apply: async () => { effects++; return { status: "applied" }; }, transactions: async () => [] };
  const server = createStudioServer({ token: "test-only", bridge, discover: async () => ({ platform: "synthetic" }), suite: { authorizeConnection: async () => {}, close: async () => {} } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: "Bearer test-only", Origin: base, "Content-Type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/api/discovery`)).status, 401);
    assert.equal((await fetch(`${base}/api/discovery`, { headers: { Authorization: "Bearer wrong" } })).status, 401);
    assert.equal((await fetch(`${base}/api/apply`, { method: "POST", headers: { ...headers, Origin: "https://untrusted.example" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${base}/api/apply`, { method: "POST", headers: { Authorization: headers.Authorization, "Content-Type": "application/json" }, body: "{}" })).status, 403);
    const reboundStatus = await new Promise((resolve, reject) => {
      const req = request(`${base}/api/apply`, { method: "POST", headers: { ...headers, Host: "untrusted.example" } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject); req.end("{}");
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await fetch(`${base}/api/shell`, { method: "POST", headers, body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/api/apply`, { method: "POST", headers, body: "not-json" })).status, 400);
    assert.equal((await fetch(`${base}/api/apply`, { method: "POST", headers, body: JSON.stringify({ padding: "x".repeat(270000) }) })).status, 413);
    assert.equal(effects, 0);
    assert.equal((await fetch(`${base}/api/apply`, { method: "POST", headers, body: "{}" })).status, 200);
    assert.equal(effects, 1);
    assert.equal((await fetch(`${base}/api/discovery`, { headers })).headers.get("access-control-allow-origin"), null);
    assert.match((await fetch(base)).headers.get("content-security-policy"), /frame-ancestors 'none'/);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test("Linux host transaction faults and durable restoration", { skip: process.platform !== "linux" }, async (t) => {
  async function fixture(fn) {
    const directory = await mkdtemp(join(tmpdir(), "switchyard-configuration-"));
    const configPath = join(directory, "bindings.lua"), stateRoot = join(directory, "transactions");
    const before = "-- Original bindings; synthetic test only\n";
    await writeFile(configPath, before, { mode: 0o600 });
    let extra = [], failReload = false, wrongReadback = false, clock = Date.now(); const removedCallbacks = new Set();
    const hypr = async (...args) => {
      if (args[0] === "configerrors") return "";
      if (args[0] === "reload") { if (failReload) { failReload = false; throw new Error("Synthetic reload failure"); } return "ok\n"; }
      if (args[0] === "repl") return removedCallbacks.has(args[1].slice(5, -1)) ? "nil\n" : "function\n";
      if (args[0] === "eval" && /^__strathex_switchyard_[a-f0-9]{32} = nil$/.test(args[1])) { removedCallbacks.add(args[1].split(" ")[0]); return "ok\n"; }
      if (args[0] === "binds") {
        const text = await readFile(configPath, "utf8");
        const matches = [...text.matchAll(/^o.bind\((.*)\)$/gm)].map((m) => {
          const fields = /^("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*"), (__strathex_switchyard_[a-f0-9]{32})$/.exec(m[1]);
          if (!fields) throw new Error("Unexpected synthetic Lua binding source");
          const [shortcut, description] = JSON.parse(`[${fields[1]},${fields[2]}]`);
          const parts = shortcut.split(" + "); const key = parts.pop();
          return { key, modmask: parts.reduce((n, p) => n + ({ SUPER: 64, ALT: 8, SHIFT: 1, CTRL: 4 }[p]), 0), description, dispatcher: "__lua", arg: "123" };
        });
        return JSON.stringify([...extra, ...(wrongReadback ? [] : matches)]);
      }
      throw new Error("Unexpected compositor command in isolated test");
    };
    const options = { configPath, stateRoot, hypr, now: () => clock, verifyTarget: async () => ({}), focus: async () => ({ status: "verified" }) };
    const bridge = createHostBridge(options);
    try { await fn({ bridge, options, configPath, stateRoot, before, directory, collision: () => { extra = [{ key: "F1", modmask: 72 }]; }, failReload: () => { failReload = true; }, wrongReadback: () => { wrongReadback = true; }, expire: () => { clock += 121000; } }); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
  const review = (bridge) => bridge.review(plan(), "summon", "native-chatgpt.focus/v1");
  await t.test("apply, trial, keep, restart and exact restore", () => fixture(async ({ bridge, options, configPath, stateRoot, before }) => {
    const r = await review(bridge); const tx = await bridge.apply(r.reviewId);
    assert.equal(tx.status, "applied");
    assert.match(await readFile(configPath, "utf8"), /Show ChatGPT/);
    assert.equal(await readFile(join(stateRoot, tx.id, "bindings.lua.before"), "utf8"), before);
    await assert.rejects(bridge.keep(tx.id), /Try and verify/);
    assert.equal((await bridge.trial(tx.id)).trial, "verified");
    assert.equal((await bridge.keep(tx.id)).status, "kept");
    const restarted = createHostBridge(options);
    assert.equal((await restarted.transactions())[0].status, "kept");
    assert.equal((await restarted.restore(tx.id)).status, "restored");
    assert.equal(await readFile(configPath, "utf8"), before);
    await assert.rejects(restarted.restore(tx.id), /not active/);
  }));
  await t.test("conflicts, expired/replayed reviews and edited baseline never apply", () => fixture(async ({ bridge, configPath, before, expire, collision }) => {
    const r = await review(bridge); expire();
    await assert.rejects(bridge.apply(r.reviewId), /expired/);
    await assert.rejects(bridge.apply(r.reviewId), /already used/);
    const edited = await review(bridge);
    await writeFile(configPath, before + "-- changed after review\n");
    await assert.rejects(bridge.apply(edited.reviewId), /changed after review/);
    collision(); await assert.rejects(review(bridge), /already assigned/);
    assert.equal(await readFile(configPath, "utf8"), before + "-- changed after review\n");
  }));
  await t.test("installed shortcuts use a stable verified entry instead of a retired version path", () => fixture(async ({ options, configPath, directory }) => {
    const loader = join(directory, "application launch.mjs"), stable = createHostBridge({ ...options, intentEntry: [process.execPath, loader] });
    const tx = await stable.apply((await review(stable)).reviewId), written = await readFile(configPath, "utf8");
    assert.ok(written.includes("application launch.mjs")); assert.equal(written.includes("versions/"), false); await stable.restore(tx.id);
  }));
  await t.test("an abandoned legacy PID file cannot permanently block the kernel-owned host transaction lease", () => fixture(async ({ bridge, stateRoot }) => {
    await mkdir(stateRoot, { mode: 0o700 }); await writeFile(join(stateRoot, "transaction.lock"), "99999999", { mode: 0o600 });
    const tx = await bridge.apply((await review(bridge)).reviewId); await bridge.restore(tx.id);
    assert.equal(await readFile(join(stateRoot, "transaction.lock"), "utf8"), "99999999");
  }));
  await t.test("restoration saves a dated copy of the complete current configuration and its reason", () => fixture(async ({ bridge, stateRoot, configPath }) => {
    const tx = await bridge.apply((await review(bridge)).reviewId), current = (await readFile(configPath, "utf8")) + "-- later user edit\n"; await writeFile(configPath, current); await bridge.restore(tx.id);
    const directories = await readdir(join(stateRoot, "restorations")); assert.equal(directories.length, 1);
    const directory = join(stateRoot, "restorations", directories[0]); assert.equal(await readFile(join(directory, "bindings.lua.before"), "utf8"), current);
    const reason = JSON.parse(await readFile(join(directory, "reason.json"))); assert.equal(reason.transaction, tx.id); assert.match(reason.reason, /preserving all unrelated/);
  }));
  await t.test("failed reload restores and verifies the complete previous file", () => fixture(async ({ bridge, configPath, before, failReload }) => {
    const r = await review(bridge); failReload();
    await assert.rejects(bridge.apply(r.reviewId), /prior host configuration was restored/);
    assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal((await bridge.transactions())[0].status, "rolled-back");
  }));
  await t.test("readback mismatch rolls back rather than reporting success", () => fixture(async ({ bridge, configPath, before, wrongReadback }) => {
    const r = await review(bridge); wrongReadback();
    await assert.rejects(bridge.apply(r.reviewId), /readback does not match/);
    assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal((await bridge.transactions())[0].status, "rolled-back");
  }));
  await t.test("later unrelated edits survive restore; modified owned block stops it", () => fixture(async ({ bridge, configPath, before }) => {
    const r = await review(bridge); const tx = await bridge.apply(r.reviewId);
    await writeFile(configPath, (await readFile(configPath, "utf8")) + "-- Later unrelated edit\n");
    await bridge.restore(tx.id);
    assert.equal(await readFile(configPath, "utf8"), before + "-- Later unrelated edit\n");
    const next = await bridge.apply((await review(bridge)).reviewId);
    await writeFile(configPath, (await readFile(configPath, "utf8")).replace("Show ChatGPT", "User edited this"));
    await assert.rejects(bridge.restore(next.id), /edited or removed/);
  }));
  await t.test("backup failure and symlink state directories prevent all changes", () => fixture(async ({ bridge, stateRoot, configPath, before, directory }) => {
    const r = await review(bridge); await symlink(directory, stateRoot);
    await assert.rejects(bridge.apply(r.reviewId), /owner-controlled/);
    assert.equal(await readFile(configPath, "utf8"), before);
  }));
  await t.test("durable applying record remains recoverable after interruption", () => fixture(async ({ bridge, options, stateRoot, configPath, before }) => {
    const tx = await bridge.apply((await review(bridge)).reviewId);
    const path = join(stateRoot, tx.id, "receipt.json");
    const raw = JSON.parse(await readFile(path, "utf8")); raw.status = "applying";
    await writeFile(path, JSON.stringify(raw));
    const restarted = createHostBridge(options);
    assert.equal((await restarted.transactions())[0].status, "applying");
    await restarted.restore(tx.id);
    assert.equal(await readFile(configPath, "utf8"), before);
  }));
  const applyTwo = async bridge => {
    const first = await bridge.apply((await review(bridge)).reviewId), secondPlan = plan(); secondPlan.actions[0] = { ...secondPlan.actions[0], id: "other", label: "Second exact shortcut", binding: { keyId: "two", modifier: "gui_alt" } };
    const second = await bridge.apply((await bridge.review(secondPlan, "other", "native-chatgpt.focus/v1")).reviewId); return [first, second];
  };
  await t.test("batch uninstall restoration preserves later edits and verifies every shortcut before continuation", () => fixture(async ({ bridge, configPath, before }) => {
    await applyTwo(bridge); await writeFile(configPath, (await readFile(configPath, "utf8")) + "-- user addition\n"); let committed = false;
    const result = await bridge.restoreAll(async restored => { assert.equal(await readFile(configPath, "utf8"), before + "-- user addition\n"); assert.equal(restored.restored.length, 2); assert.ok((await bridge.transactions()).every(tx => tx.status === "restored")); committed = true; return restored; });
    assert.equal(committed, true); assert.equal(result.readbackVerified, true);
  }));
  await t.test("batch restoration preflights all owned blocks before the first mutation", () => fixture(async ({ bridge, configPath }) => {
    await applyTwo(bridge); const edited = (await readFile(configPath, "utf8")).replace("Show ChatGPT", "User replacement"); await writeFile(configPath, edited); let committed = false;
    await assert.rejects(bridge.restoreAll(() => { committed = true; }), /edited or removed/); assert.equal(committed, false); assert.equal(await readFile(configPath, "utf8"), edited); assert.equal((await bridge.transactions()).filter(tx => tx.status === "applied").length, 2);
  }));
  await t.test("forced owner loss after batch write recovers its exact journal through a fresh kernel lease", () => fixture(async ({ bridge, options, configPath, before, stateRoot }) => {
    await applyTwo(bridge);
    const program = `import{createHostBridge}from ${JSON.stringify(new URL("./host.mjs", import.meta.url).href)};await createHostBridge({...${JSON.stringify({ configPath: options.configPath, stateRoot: options.stateRoot })},afterRestoreWrite:()=>process.kill(process.pid,'SIGKILL')}).restoreAll();`;
    const signal = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ["--input-type=module", "-e", program], { shell: false, stdio: "ignore" }); child.once("error", reject); child.once("close", (code, signal) => resolve(signal)); });
    assert.equal(signal, "SIGKILL"); assert.equal(await readFile(configPath, "utf8"), before); assert.ok(await readFile(join(stateRoot, "restore-pending.json")));
    const recovered = await createHostBridge(options).restoreAll(); assert.equal(recovered.restored.length, 2); assert.equal(recovered.readbackVerified, true); await assert.rejects(readFile(join(stateRoot, "restore-pending.json")), { code: "ENOENT" });
  }));
  await t.test("interrupted batch recovery preserves an unrelated edit outside its exact recorded states", () => fixture(async ({ bridge, options, configPath, before, stateRoot }) => {
    await applyTwo(bridge); const interrupted = createHostBridge({ ...options, afterRestoreWrite: () => { throw new Error("Synthetic batch interruption"); } });
    await assert.rejects(interrupted.restoreAll(), /batch interruption/); const edited = before + "-- user edit during recovery\n"; await writeFile(configPath, edited); let committed = false;
    await assert.rejects(createHostBridge(options).restoreAll(() => { committed = true; }), /outside both recorded/); assert.equal(committed, false); assert.equal(await readFile(configPath, "utf8"), edited); assert.ok(await readFile(join(stateRoot, "restore-pending.json")));
  }));
  await t.test("discovery can report disconnected hardware without opening any HID device", () => fixture(async ({ directory }) => {
    const evidence = await discoverHost(async () => { throw new Error("Synthetic absent compositor"); }, directory);
    assert.equal(evidence.keyboard.status, "disconnected");
    assert.equal(evidence.chatgpt.status, "unavailable");
    assert.equal(evidence.shortcuts, false);
  }));
});
