import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, writeFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareWindowsShortcut, shortcutExecutionTimeoutMs } from "./shortcut-process.mjs";
const stages = ["script-started", "utility-loaded", "input-read", "input-decoded", "input-validated", "com-created", "shortcut-saved", "readback-verified"];
const progress = count => stages.slice(0, count).map(stage => `SXSY-SHORTCUT/1 ${stage}\r\n`).join("");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sx-shortcut-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const request = { path: join(root, "owned.lnk"), nodePath: "C:\\runtime\\node.exe", loader: "C:\\app\\launch.mjs", directory: "C:\\app" };
  const child = new EventEmitter(), stdin = new PassThrough(), stdout = new PassThrough();
  let killed; const killRequested = new Promise(resolve => { killed = resolve; });
  Object.assign(child, { stdin, stdout, exitCode: null, signalCode: null, kill: () => { killed(); return true; } });
  const close = code => { child.exitCode = code; child.emit("close", code); };
  const spawnProcess = (exe, args, options) => {
    assert.ok(exe.endsWith("powershell.exe"));
    assert.deepEqual(args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File"]);
    assert.ok(args[4].endsWith("shortcut.ps1"));
    assert.deepEqual(options, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    return child;
  };
  return { root, request, child, close, spawnProcess, killRequested };
}

test("verified shortcut bytes are returned only after the writer closes, then its exact temporary file is removed", async t => {
  assert.equal(shortcutExecutionTimeoutMs, 10000);
  const f = await fixture(t); await writeFile(f.request.path, "synthetic shortcut");
  let settled = false; const pending = prepareWindowsShortcut(f.request, { spawnProcess: f.spawnProcess });
  pending.then(() => { settled = true; }, () => { settled = true; });
  assert.equal(f.child.stdin.read().toString(), JSON.stringify(f.request));
  f.child.stdout.write("VER"); f.child.stdout.write("IFIED\r\n");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(await readFile(f.request.path, "utf8"), "synthetic shortcut");
  f.close(0); assert.equal((await pending).toString(), "synthetic shortcut");
  await assert.rejects(lstat(f.request.path), { code: "ENOENT" });
});

test("timeout joins direct-child exit before removing a shortcut written after termination was requested", async t => {
  const f = await fixture(t); let settled = false;
  const pending = prepareWindowsShortcut(f.request, { spawnProcess: f.spawnProcess, timeoutMs: 10 });
  const rejected = assert.rejects(pending, /creation timed out/); pending.catch(() => { settled = true; });
  await f.killRequested;
  assert.equal(settled, false); await writeFile(f.request.path, "late owned output");
  assert.equal(await readFile(f.request.path, "utf8"), "late owned output");
  f.close(0); await rejected;
  await assert.rejects(lstat(f.request.path), { code: "ENOENT" });
});

test("ordered native progress tolerates fragmented pipes while verified output still waits for exact exit", async t => {
  const f = await fixture(t); await writeFile(f.request.path, "synthetic native shortcut");
  let settled = false; const pending = prepareWindowsShortcut(f.request, { spawnProcess: f.spawnProcess }); pending.finally(() => { settled = true; });
  for (const byte of Buffer.from(progress(stages.length) + "VERIFIED\r\n")) f.child.stdout.write(Buffer.from([byte]));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  f.close(0); assert.equal((await pending).toString(), "synthetic native shortcut");
  await assert.rejects(lstat(f.request.path), { code: "ENOENT" });
});

test("shortcut timeout diagnostics contain only the last ordered fixed stage and never raw native output", async t => {
  for (let count = 0; count <= stages.length; count++) {
    const f = await fixture(t); await writeFile(f.request.path, "owned output");
    const pending = prepareWindowsShortcut(f.request, { spawnProcess: f.spawnProcess, timeoutMs: 10 });
    const rejected = assert.rejects(pending, error => {
      assert.equal(error.message, `Native shortcut creation timed out. Last observed stage: ${count ? stages[count - 1] : "not-observed"}.`);
      assert.equal(error.message.includes("PRIVATE_DIAGNOSTIC"), false); return true;
    });
    f.child.stdout.write(progress(count) + "SXSY-SHORTCUT/1 PRIVATE_DIAGNOSTIC\n");
    await f.killRequested; assert.equal(await readFile(f.request.path, "utf8"), "owned output");
    f.close(1); await rejected; await assert.rejects(lstat(f.request.path), { code: "ENOENT" });
  }
});

test("partial, reordered and forged progress cannot establish successful shortcut readback", async t => {
  for (const output of [progress(1), progress(2).split("\r\n").reverse().join("\r\n"), progress(stages.length) + "PRIVATE_DIAGNOSTIC\n", "SXSY-SHORTCUT/1 readback-verified\n"]) {
    const f = await fixture(t); await writeFile(f.request.path, "owned output");
    const pending = prepareWindowsShortcut(f.request, { spawnProcess: f.spawnProcess }), rejected = assert.rejects(pending, /exact readback failed/);
    f.child.stdout.write(output + "VERIFIED\n"); f.close(0); await rejected;
    await assert.rejects(lstat(f.request.path), { code: "ENOENT" });
  }
});

test("excess output cannot hide behind a VERIFIED prefix or a later successful close", async t => {
  const f = await fixture(t); await writeFile(f.request.path, "synthetic");
  const pending = prepareWindowsShortcut(f.request, { spawnProcess: f.spawnProcess });
  const rejected = assert.rejects(pending, /response exceeds its bound/);
  f.child.stdout.write("VERIFIED" + " ".repeat(1017)); await f.killRequested;
  assert.equal(await readFile(f.request.path, "utf8"), "synthetic");
  f.close(0); await rejected; await assert.rejects(lstat(f.request.path), { code: "ENOENT" });
});

test("unconfirmed termination preserves only the exact owned shortcut and makes no success claim", async t => {
  const f = await fixture(t); await writeFile(f.request.path, "retain owned evidence");
  await assert.rejects(prepareWindowsShortcut(f.request, { spawnProcess: f.spawnProcess, timeoutMs: 5, stopChild: async child => { assert.equal(child, f.child); return { stopped: false }; } }), { code: "NATIVE_SHORTCUT_EXIT_UNCONFIRMED" });
  assert.equal(await readFile(f.request.path, "utf8"), "retain owned evidence");
  f.close(1);
});

test("spawn and later process errors are bounded and cannot delete output before joined exit", async t => {
  const f = await fixture(t); await writeFile(f.request.path, "temporary");
  const pending = prepareWindowsShortcut(f.request, { spawnProcess: f.spawnProcess });
  const rejected = assert.rejects(pending, /writer could not run/);
  f.child.emit("error", Error("UNTRUSTED STARTUP DETAILS")); await f.killRequested;
  f.child.emit("error", Error("UNTRUSTED TERMINATION DETAILS"));
  assert.equal(await readFile(f.request.path, "utf8"), "temporary");
  f.close(-1); await rejected; await assert.rejects(lstat(f.request.path), { code: "ENOENT" });
});

test("missing or invalid native readback and nonzero writer exit never return shortcut bytes", async t => {
  for (const [output, code] of [["", 0], ["VERIFIED extra", 0], ["VERIFIED", 1]]) {
    const f = await fixture(t); await writeFile(f.request.path, "temporary");
    const pending = prepareWindowsShortcut(f.request, { spawnProcess: f.spawnProcess });
    const rejected = assert.rejects(pending, /exact readback failed/);
    f.child.stdout.write(output); f.close(code); await rejected;
    await assert.rejects(lstat(f.request.path), { code: "ENOENT" });
  }
});

test("oversized requests refuse before starting a writer or changing any file", async t => {
  const f = await fixture(t); await writeFile(f.request.path, "unchanged");
  await assert.rejects(prepareWindowsShortcut({ ...f.request, loader: "x".repeat(8192) }, { spawnProcess: () => { throw Error("Unexpected process start"); } }), /request exceeds its bound/);
  assert.equal(await readFile(f.request.path, "utf8"), "unchanged");
});

test("an actual controlled writer exits before its generated bytes are returned and removed", async t => {
  const f = await fixture(t); let native;
  const program = 'let input="";process.stdin.on("data",b=>input+=b);process.stdin.on("end",async()=>{const{writeFile}=await import("node:fs/promises");await writeFile(JSON.parse(input).path,"actual controlled output");process.stdout.write("VERIFIED\\n");setTimeout(()=>process.exit(0),40);});';
  const bytes = await prepareWindowsShortcut(f.request, { spawnProcess: () => native = spawn(process.execPath, ["-e", program], { shell: false, stdio: ["pipe", "pipe", "ignore"] }) });
  assert.equal(bytes.toString(), "actual controlled output"); assert.equal(native.exitCode, 0);
  await assert.rejects(lstat(f.request.path), { code: "ENOENT" });
});

test("an actual controlled hung writer is independently observed exited after timeout", async t => {
  const f = await fixture(t); let native, observed = "";
  const program = 'process.stdin.resume();process.stdout.write("WAITING");setInterval(()=>{},1000);';
  await writeFile(f.request.path, "owned output");
  await assert.rejects(prepareWindowsShortcut(f.request, { timeoutMs: 2000, spawnProcess: () => {
    native = spawn(process.execPath, ["-e", program], { shell: false, stdio: ["pipe", "pipe", "ignore"] });
    native.stdout.on("data", bytes => { observed += bytes; }); return native;
  } }), /creation timed out/);
  assert.equal(observed, "WAITING"); assert.ok(native.exitCode !== null || native.signalCode !== null);
  await assert.rejects(lstat(f.request.path), { code: "ENOENT" });
});
