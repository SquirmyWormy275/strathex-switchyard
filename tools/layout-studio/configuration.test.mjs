import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtemp, readFile, writeFile, readdir, rm, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPlan, parseBoardProfile } from "./model.mjs";
import { portableProfile, importProfile, proposalContext, reviewProposal, compileConnection } from "./workspace.mjs";
import { snapshotChoices, importVialSnapshot } from "./vial-snapshot.mjs";
import { createHostBridge, discoverHost } from "./host.mjs";
import { createStudioServer } from "./serve.mjs";

function plan() {
  const p = newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic keyboard", layout: "two-keys", controller: "unknown", keys: [
    { id: "one", label: "First", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_F1" },
    { id: "two", label: "Second", matrix: [0, 1], x: 1, y: 0, baseKeycode: "KC_C" }
  ] }));
  p.actions.push({ id: "summon", label: "Show ChatGPT", family: "routing", consequence: "navigation", confirmation: false, frequencyPerDay: 0, secondsSaved: 0, binding: { keyId: "one", modifier: "gui_alt" } });
  return p;
}

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
    let extra = [], failReload = false, wrongReadback = false, clock = Date.now();
    const hypr = async (...args) => {
      if (args[0] === "configerrors") return "";
      if (args[0] === "reload") { if (failReload) { failReload = false; throw new Error("Synthetic reload failure"); } return "ok\n"; }
      if (args[0] === "repl") return "function\n";
      if (args[0] === "eval" && /^__strathex_switchyard_[a-f0-9]{32} = nil$/.test(args[1])) return "ok\n";
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
  await t.test("discovery can report disconnected hardware without opening any HID device", () => fixture(async ({ directory }) => {
    const evidence = await discoverHost(async () => { throw new Error("Synthetic absent compositor"); }, directory);
    assert.equal(evidence.keyboard.status, "disconnected");
    assert.equal(evidence.chatgpt.status, "unavailable");
    assert.equal(evidence.shortcuts, false);
  }));
});
