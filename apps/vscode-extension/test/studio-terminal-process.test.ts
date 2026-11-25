import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { nativeImageIdentity, observeTerminalProcess } from "../src/studio-terminal-process.ts";
// @ts-expect-error Use the existing exact child-exit verifier.
import { stopOwnedChild } from "../../../tools/layout-studio/owned-process.mjs";

const linux = { skip: process.platform !== "linux" };
async function fixture(t: TestContext) {
  const executable = await realpath(process.execPath), child = spawn(executable, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  t.after(async () => { assert.equal((await stopOwnedChild(child)).stopped, true); });
  const controller = new AbortController(), options = { terminal: { name: "irrelevant", show() {}, processId: Promise.resolve(child.pid) }, executable, executableIdentity: nativeImageIdentity(await lstat(executable, { bigint: true })), assertCurrent: async () => {}, signal: controller.signal };
  return { child, options, controller };
}
test("exact terminal PID binds real current-user process birth and image; exited processes cannot be reobserved", linux, async t => {
  const f = await fixture(t), first = await observeTerminalProcess(f.options);
  assert.equal(first.pid, f.child.pid); assert.match(first.birth, /^[1-9][0-9]*$/); assert.ok(Object.isFrozen(first));
  assert.deepEqual(await observeTerminalProcess({ ...f.options, expected: first }), first);
  assert.equal((await stopOwnedChild(f.child)).stopped, true); await assert.rejects(observeTerminalProcess({ ...f.options, expected: first }));
});
test("invalid or substituted PIDs, birth, image and path never fall back to a matching title or ancestor", linux, async t => {
  const f = await fixture(t), first = await observeTerminalProcess(f.options), other = await fixture(t);
  for (const pid of [undefined, 0, -1, 1.5, 2147483648]) await assert.rejects(observeTerminalProcess({ ...f.options, terminal: { ...f.options.terminal, processId: Promise.resolve(pid) } }));
  for (const change of [{ executable: f.options.executable + "-foreign" }, { executableIdentity: "foreign" }, { expected: { ...first, birth: "1" } }, { expected: { ...first, pid: other.child.pid! } }]) await assert.rejects(observeTerminalProcess({ ...f.options, ...change }));
  await assert.rejects(observeTerminalProcess({ ...other.options, expected: first }));
});
test("missing process replies have bounded cancellation and timeout; invalid bounds refuse before context access", linux, async t => {
  const f = await fixture(t), terminal = { ...f.options.terminal, processId: new Promise<number>(() => {}) };
  await assert.rejects(observeTerminalProcess({ ...f.options, terminal, timeoutMs: 20 }), /cancelled|timed out/);
  const pending = assert.rejects(observeTerminalProcess({ ...f.options, terminal })); f.controller.abort(); await pending;
  for (const timeoutMs of [0, -1, 0.5, 5001, NaN]) await assert.rejects(observeTerminalProcess({ ...f.options, timeoutMs, assertCurrent: () => { assert.fail("Invalid input must refuse before context access"); } }));
});
test("shutdown joins a held context read and refuses its late result", linux, async t => {
  const f = await fixture(t); let enter!: () => void, release!: () => void, settled = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const pending = assert.rejects(observeTerminalProcess({ ...f.options, assertCurrent: async () => { enter(); await held; } })).then(() => { settled = true; });
  await entered; f.controller.abort(); await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false); release(); await pending;
});
test("exit or revoked context between kernel observations refuses a result without terminating an unrelated process", linux, async t => {
  for (const mode of ["exit", "context"]) {
    const f = await fixture(t); let reads = 0;
    await assert.rejects(observeTerminalProcess({ ...f.options, assertCurrent: async () => { if (++reads === 3) { if (mode === "exit") assert.equal((await stopOwnedChild(f.child)).stopped, true); else throw Error("Context revoked"); } } }));
  }
});
