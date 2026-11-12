import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NativeHidTransport } from "./devices.mjs";
import { localVoice } from "./voice.mjs";

function childFixture(reply) {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
  child.stdin.write = text => queueMicrotask(() => reply(child, JSON.parse(text)));
  child.stdin.end = () => {};
  child.kill = () => { child.exitCode = 0; queueMicrotask(() => child.emit("close", 0)); return true; };
  return child;
}
test("closing HID transport during version resolution prevents a late interpreter launch", async () => {
  let release, launches = 0;
  const transport = new NativeHidTransport({ runtimeResolver: () => new Promise(resolve => { release = resolve; }), spawnProcess: () => { launches++; throw new Error("Unexpected launch"); } });
  const pending = assert.rejects(transport.request("list"), /startup was cancelled/);
  await transport.close(); release({ python: "/selected/python" }); await pending; assert.equal(launches, 0);
});
test("HID transport uses the selected interpreter in isolated no-bytecode mode and verifies owned child exit", async () => {
  let seen;
  const child = childFixture((process, request) => process.stdout.emit("data", JSON.stringify({ id: request.id, result: [] }) + "\n"));
  const transport = new NativeHidTransport({ runtimeResolver: async () => ({ python: "/selected/python" }), spawnProcess: (exe, args, options) => { seen = { exe, args, options }; return child; } });
  assert.deepEqual(await transport.request("list"), []); assert.equal(seen.exe, "/selected/python"); assert.deepEqual(seen.args.slice(0, 2), ["-I", "-B"]); assert.equal(seen.options.shell, false); assert.equal((await transport.close()).stopped, true);
});
test("voice uses the selected model/interpreter and cannot start after closure during discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-voice-version-")), python = join(root, "python"), model = join(root, "model");
  await mkdir(model); await writeFile(python, "synthetic"); await writeFile(join(model, "model.bin"), "synthetic");
  let seen, launches = 0;
  try {
    const voice = localVoice({ runtime: root, runtimeResolver: async () => ({ python, model }), spawnProcess: (exe, args) => { launches++; seen = { exe, args }; return childFixture(process => { process.stdout.emit("data", JSON.stringify({ text: "synthetic note" })); process.exitCode = 0; process.emit("close", 0); }); } });
    assert.equal((await voice.transcribe("YXVkaW8=", { compartment: "fixture" })).text, "synthetic note"); assert.equal(seen.exe, python); assert.equal(seen.args.at(-1), model); assert.deepEqual(seen.args.slice(0, 2), ["-I", "-B"]); await voice.close();
    let release;
    const blocked = localVoice({ runtimeResolver: () => new Promise(resolve => { release = resolve; }), spawnProcess: () => { launches++; throw new Error("Unexpected late launch"); } });
    const pending = assert.rejects(blocked.transcribe("YXVkaW8="), /unavailable|stopped/); await blocked.close(); release({ python, model }); await pending; assert.equal(launches, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
