import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { codexDesignConfig } from "./agents.mjs";
import { openOwnedCodexListener } from "./codex-owned-listener.mjs";
import { createCodexUnixTasks } from "./codex-unix-tasks.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";

const native = { skip: process.platform !== "linux" ? "Owned Unix task listeners require Linux" : false };
async function fixture(t, extra = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "syut-"))), repositoryRoot = join(root, "repo"), owners = []; let permitted = true;
  await mkdir(repositoryRoot);
  const options = { root: join(root, "tasks"), runtimeRoot: root, store: { async authorize() { if (!permitted) throw Error("permission revoked"); } }, resolveCli: async () => process.execPath, resolveMcp: async () => [],
    async openListener(input) {
      await copyFile(new URL("./test-support/codex-owned-listener-fixture.cjs", import.meta.url), join(input.cwd, "app-server"));
      await writeFile(join(input.cwd, "account"), "synthetic@example.invalid");
      await writeFile(join(input.cwd, "fixture.json"), JSON.stringify({ repositoryRoot, config: { ...codexDesignConfig(), mcp_servers: {} } }));
      return openOwnedCodexListener({ ...input, onOwner(value) { owners.push(value); input.onOwner(value); } });
    }, ...extra };
  const driver = createCodexUnixTasks(options);
  t.after(async () => { const result = await driver.close(); assert.equal(result.every(value => value.stopped), true); for (const owner of owners) assert.equal((await owner.stop()).stopped, true); await rm(root, { recursive: true }); });
  return { root, repositoryRoot, owners, driver, permit(value) { permitted = value; } };
}
test("managed task retirement requires the complete listener owner instead of a child-only exit", async t => {
  let stopped = false, launches = 0;
  const owner = { closed: false, close() { this.closed = true; }, async stop() { return { stopped }; }, async connect() { return { closed: false, accountEpoch: 0, async request() { return { data: [] }; } }; } };
  const f = await fixture(t, { async openListener(input) { launches++; input.onOwner(owner); return owner; }, stopChild: async () => { throw Error("A managed listener cannot use child-only retirement"); } });
  try { assert.deepEqual(await f.driver.list("personal"), []); assert.equal((await f.driver.stopCompartment("personal")).stopped, false); await assert.rejects(f.driver.list("personal"), /No replacement/); assert.equal(launches, 1); }
  finally { stopped = true; }
});
test("task metadata, empty creation and resume use one exact owned listener with no model turn", native, async t => {
  const f = await fixture(t), account = await f.driver.account("personal"); assert.match(account.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(await f.driver.list("personal"), [{ id: "synthetic-owned-task", observation: "idle" }]);
  assert.equal((await f.driver.read("synthetic-owned-task", f.repositoryRoot, "personal")).repositoryRoot, f.repositoryRoot);
  assert.deepEqual(await f.driver.start(f.repositoryRoot, "synthetic-binding", "personal"), { threadId: "synthetic-owned-task" });
  assert.equal((await f.driver.resume("synthetic-owned-task", f.repositoryRoot, "personal")).modelPromptSubmitted, false);
  assert.equal(f.owners.length, 1); const owner = f.owners[0], scope = owner.scope; assert.ok(owner.binding);
  const calls = (await readFile(join(f.root, "tasks/personal/calls"), "utf8")).trim().split("\n"); assert.equal(calls.filter(value => value === "thread/start").length, 1); assert.equal(calls.includes("turn/start"), false);
  assert.equal((await f.driver.stopCompartment("personal")).stopped, true); assert.equal(await runtimeGuardianStopped(scope), true); assert.equal(owner.binding, null);
});
test("task shutdown during guardian admission prevents provider startup and retires the reserved owner", native, async t => {
  let entered, release; const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { onReady: async () => { entered(); await gate; } }), pending = f.driver.account("personal").catch(error => error);
  try { await ready; f.permit(false); assert.equal((await f.driver.stopCompartment("personal")).stopped, true); assert.ok(await pending instanceof Error); assert.equal(await runtimeGuardianStopped(f.owners[0].scope), true); await assert.rejects(readFile(join(f.root, "tasks/personal/started")), { code: "ENOENT" }); }
  finally { release(); }
});
test("a provider account boundary revokes the managed task connection before more metadata is admitted", native, async t => {
  const f = await fixture(t); await f.driver.account("personal"); const owner = f.owners[0], original = owner.accountFingerprint;
  await writeFile(join(f.root, "tasks/personal/account"), "changed@example.invalid");
  const until = Date.now() + 3000; while (!owner.closed && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(owner.closed, true); assert.equal(owner.accountFingerprint, original); f.permit(false); await assert.rejects(f.driver.list("personal"), /permission revoked/); assert.equal(f.owners.length, 1); assert.equal((await f.driver.stopCompartment("personal")).stopped, true);
});
test("unfamiliar owned files preserve the original task lifetime and block a replacement until exact retirement", native, async t => {
  const f = await fixture(t); await f.driver.account("personal"); const owner = f.owners[0], path = join(owner.privateOwnership.root, "preserve-fixture"); await writeFile(path, "synthetic");
  try { assert.equal((await f.driver.stopCompartment("personal")).stopped, false); await assert.rejects(f.driver.account("personal"), /No replacement/); assert.equal(f.owners.length, 1); assert.equal(await readFile(path, "utf8"), "synthetic"); }
  finally { await rm(path); assert.equal((await f.driver.stopCompartment("personal")).stopped, true); }
});
