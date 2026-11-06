import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, lstat, mkdtemp, readFile, rm, writeFile, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { codexDesignConfig } from "./agents.mjs";
import { openOwnedCodexListener, retireStoppedCodexListener } from "./codex-owned-listener.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
const native = { skip: process.platform !== "linux" ? "Persistent Unix listeners require Linux" : false };
async function gone(pid) { try { const text = await readFile(`/proc/${pid}/stat`, "utf8"); return text.slice(text.lastIndexOf(")") + 2).split(" ")[0] === "Z"; } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return true; throw error; } }
async function waitFor(fn) { const end = Date.now() + 5000; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error("The exact owned listener checkpoint did not settle."); }
async function absent(path) { try { await lstat(path); return false; } catch (error) { if (error.code === "ENOENT") return true; throw error; } }
async function fixture(t, settings = {}) {
  const root = await mkdtemp(join(tmpdir(), "sylo-")), owners = [], wrappers = [];
  await copyFile(new URL("./test-support/codex-owned-listener-fixture.cjs", import.meta.url), join(root, "app-server"));
  await writeFile(join(root, "account"), "synthetic@example.invalid");
  await writeFile(join(root, "fixture.json"), JSON.stringify({ config: { ...codexDesignConfig(), mcp_servers: {} }, ...settings }));
  t.after(async () => { for (const wrapper of wrappers) assert.equal((await stopOwnedChild(wrapper)).stopped, true); for (const owner of owners) assert.equal((await owner.stop()).stopped, true); await rm(root, { recursive: true }); });
  return { root, owners, wrappers, async open(options = {}) { return openOwnedCodexListener({ executable: process.execPath, cwd: root, runtimeRoot: root, onOwner: owner => { owners.push(owner); }, ...options }); } };
}
test("an incomplete listener request cannot create an owner or choose another platform fallback", async () => { let owners = 0; await assert.rejects(openOwnedCodexListener({ onOwner: () => { owners++; } })); assert.equal(owners, 0); });
test("provider startup refuses repository, project configuration or instruction markers before reserving an owner", native, async t => {
  for (const marker of [".git", ".codex", "AGENTS.md"]) { const f = await fixture(t); await writeFile(join(f.root, marker), "synthetic project marker"); await assert.rejects(f.open(), /neutral private provider startup/); assert.equal(f.owners.length, 0); assert.equal(await absent(join(f.root, "started")), true); }
});
test("persistent provider lifetime pins account across connections, prunes exited bridges and retires only its original scope", native, async t => {
  const f = await fixture(t), owner = await f.open(); assert.equal(owner.binding, null);
  const first = await owner.connect(), second = await owner.connect(); assert.ok(owner.binding); assert.equal(first.accountFingerprint, second.accountFingerprint); assert.equal(owner.accountFingerprint, first.accountFingerprint);
  assert.deepEqual(await first.request("fixture/echo", { value: "metadata only" }), { value: "metadata only" }); first.close(); const third = await owner.connect(); assert.equal(third.accountFingerprint, second.accountFingerprint);
  const scope = owner.scope, ownership = owner.privateOwnership; await assert.rejects(retireStoppedCodexListener(scope, ownership)); assert.equal(await absent(ownership.root), false);
  assert.equal((await owner.stop()).stopped, true); assert.equal((await owner.stop()).stopped, true); assert.equal(await absent(ownership.root), true); assert.equal(owner.binding, null); assert.equal(second.closed, true); assert.equal(third.closed, true); assert.equal(await runtimeGuardianStopped(scope), true);
});
test("fresh admission and a committed guardian callback precede every native start", native, async t => {
  const f = await fixture(t); let admissions = 0, committed = false;
  const owner = await f.open({ authorize: async () => { admissions++; }, onReady: async scope => { assert.equal(scope.containment, "owned-linux-session"); assert.equal(await absent(join(f.root, "started")), true); committed = true; } });
  assert.equal(committed, true); assert.ok(admissions >= 4); assert.equal(await absent(join(f.root, "started")), false); await owner.connect(); assert.ok(admissions >= 6);
});
test("editor endpoint inspection refuses a replaced alias even while its original metadata bridge remains connected", native, async t => {
  const f = await fixture(t), owner = await f.open(); await assert.rejects(owner.inspectBinding());
  const client = await owner.connect(), original = await owner.inspectBinding(); assert.deepEqual(original, owner.binding);
  const { endpoint, socketPath } = owner.privateOwnership, saved = endpoint + "-original";
  await rename(endpoint, saved);
  try {
    await symlink(socketPath, endpoint);
    assert.deepEqual(await client.request("fixture/echo", { value: "still original connection" }), { value: "still original connection" });
    await assert.rejects(owner.inspectBinding(), /original owned Codex listener identity/);
  } finally { await rm(endpoint); await rename(saved, endpoint); }
  assert.deepEqual(await owner.inspectBinding(), original); assert.equal((await owner.stop()).stopped, true); await assert.rejects(owner.inspectBinding(), /closed/);
});
test("a listening socket is not ready until its exact delayed alias has been published", native, async t => {
  const f = await fixture(t, { aliasDelayMs: 150 }), owner = await f.open();
  assert.equal((await lstat(owner.privateOwnership.endpoint)).isSymbolicLink(), true);
  await owner.connect(); assert.ok(owner.binding); assert.equal((await owner.stop()).stopped, true);
  assert.equal(await runtimeGuardianStopped(owner.scope), true); assert.equal(await absent(owner.privateOwnership.root), true);
});
test("stopping while the startup acknowledgement is pending prevents the provider effect and still independently retires its guardian", native, async t => {
  const f = await fixture(t); let entered, release; const ready = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  const pending = f.open({ onReady: async () => { entered(); await held; } }).catch(error => error); await ready; const owner = f.owners[0], scope = owner.scope;
  assert.equal((await owner.stop()).stopped, true); release(); assert.ok(await pending instanceof Error); assert.equal(await absent(join(f.root, "started")), true); assert.equal(await runtimeGuardianStopped(scope), true);
});
test("an account boundary closes every bridge and the native listener without replacing the pinned account", native, async t => {
  const f = await fixture(t), owner = await f.open(), first = await owner.connect(), second = await owner.connect(), fingerprint = owner.accountFingerprint;
  await writeFile(join(f.root, "account"), "changed@example.invalid"); await waitFor(() => owner.closed);
  assert.equal(owner.accountFingerprint, fingerprint); assert.equal(owner.binding, null); assert.equal(first.closed, true); assert.equal(second.closed, true); await assert.rejects(owner.connect(), error => error.code === "ACCOUNT_UNCONFIRMED"); assert.equal((await owner.stop()).stopped, true);
});
test("unfamiliar private entries prevent directory retirement and remain intact until the exact owner explicitly removes its own injected fixture", native, async t => {
  const f = await fixture(t), owner = await f.open(); await owner.connect(); const ownership = owner.privateOwnership, unknown = join(ownership.root, "preserve-unknown"); await writeFile(unknown, "SYNTHETIC_PRESERVE");
  assert.equal((await owner.stop()).stopped, false); assert.equal(await readFile(unknown, "utf8"), "SYNTHETIC_PRESERVE"); assert.equal(await runtimeGuardianStopped(owner.scope), true);
  await rm(unknown); assert.equal((await owner.stop()).stopped, true); assert.equal(await absent(ownership.root), true);
});
test("an unsafe effective configuration cannot expose an attachable binding or leave its native lifetime running", native, async t => {
  const config = { ...codexDesignConfig(), mcp_servers: {} }; config.features.shell_tool = true;
  const f = await fixture(t, { config }), owner = await f.open(); await assert.rejects(owner.connect(), /restricted design configuration/); assert.equal(owner.binding, null); assert.equal(owner.closed, true); assert.equal((await owner.stop()).stopped, true);
  assert.equal((await readFile(join(f.root, "calls"), "utf8")).includes("account/read"), false);
});
test("parent loss contains native descendants in another process group and saved identities permit exact retirement after independent session exit", native, async t => {
  const f = await fixture(t, { spawnChild: true });
  const code = `import{openOwnedCodexListener}from${JSON.stringify(new URL("./codex-owned-listener.mjs", import.meta.url).href)};let text="";for await(const b of process.stdin)text+=b;const r=JSON.parse(text),o=await openOwnedCodexListener({executable:process.execPath,cwd:r.root,runtimeRoot:r.root});const c=await o.connect();console.log(JSON.stringify({scope:o.scope,ownership:o.privateOwnership,peer:o.binding,bridgePid:c.child.pid}));`;
  const wrapper = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["pipe", "pipe", "ignore"] }); f.wrappers.push(wrapper); let output = ""; wrapper.stdout.on("data", bytes => { output += bytes; }); wrapper.stdin.end(JSON.stringify({ root: f.root }));
  const value = await waitFor(() => { try { return JSON.parse(output); } catch { return false; } });
  const descendant = await waitFor(async () => { try { return Number(await readFile(join(f.root, "child.pid"), "utf8")); } catch (error) { if (error.code === "ENOENT") return false; throw error; } });
  const exited = new Promise(resolve => wrapper.once("close", resolve)); wrapper.kill("SIGKILL"); await exited;
  for (const pid of [value.scope.guardianPid, value.peer.peerPid, value.bridgePid, descendant]) await waitFor(() => gone(pid));
  assert.equal(await runtimeGuardianStopped(value.scope), true); assert.equal((await retireStoppedCodexListener(value.scope, value.ownership)).stopped, true); assert.equal(await absent(value.ownership.root), true);
});
