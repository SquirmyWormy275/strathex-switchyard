import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { createCredentialProcessRunner } from "./credential-process.mjs";

function fixture(options = {}) {
  const children = []; let killed;
  const killRequested = new Promise(resolve => { killed = resolve; });
  const run = createCredentialProcessRunner({
    spawnProcess: (executable, args, settings) => {
      assert.equal(executable, "synthetic-helper"); assert.deepEqual(args, ["lookup"]);
      assert.deepEqual(settings, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const child = new EventEmitter();
      Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, kill: () => { killed(); return true; } });
      children.push(child); return child;
    }, ...options
  });
  const close = (child, code = 0, signal = null) => { child.exitCode = code; child.signalCode = signal; child.emit("close", code, signal); };
  return { run: (input = "", timeout = 10000) => run("synthetic-helper", ["lookup"], input, timeout), children, close, killRequested };
}
async function started(f, input = "", timeout) {
  const pending = f.run(input, timeout); pending.catch(() => {}); await new Promise(resolve => setImmediate(resolve));
  return { pending, child: f.children.at(-1) };
}

test("credential results require closed stdout and preserve exact input, trimmed output and nonzero status", async () => {
  const f = fixture(), { pending, child } = await started(f, "SYNTHETIC_PRIVATE_INPUT"); let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  assert.equal(child.stdin.read().toString(), "SYNTHETIC_PRIVATE_INPUT");
  child.stdout.write(" synthetic-secret \n"); child.stderr.write("warning");
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  f.close(child); assert.deepEqual(await pending, { code: 0, text: "synthetic-secret", stderrBytes: 7 });
  const next = await started(f); f.close(next.child, 1); assert.deepEqual(await next.pending, { code: 1, text: "", stderrBytes: 0 });
});

test("credential timeout joins exact child exit and discards late secret output", async () => {
  const f = fixture(), { pending, child } = await started(f, "", 10); let settled = false;
  const rejected = assert.rejects(pending, error => { assert.equal(error.message, "The platform credential store timed out."); return true; });
  pending.catch(() => { settled = true; }); await f.killRequested; assert.equal(settled, false);
  child.stdout.write("LATE_PRIVATE_SECRET"); f.close(child); await rejected;
});

test("the original credential output ceiling is exact and overflow still joins retirement", async () => {
  const f = fixture(); const exact = await started(f); exact.child.stdout.write("x".repeat(32768)); f.close(exact.child); assert.equal((await exact.pending).text.length, 32768);
  const overflow = await started(f), rejected = assert.rejects(overflow.pending, /response exceeded its bound/);
  overflow.child.stdout.write("x".repeat(32769)); await f.killRequested; f.close(overflow.child); await rejected;
});

test("unconfirmed or throwing credential retirement blocks new workers until the exact original close", async () => {
  for (const throwing of [false, true]) {
    const stopped = [], f = fixture({ stopChild: async child => { stopped.push(child); if (throwing) throw Error("PRIVATE_STOP_DETAILS"); return { stopped: false }; } });
    const { pending, child } = await started(f, "", 5);
    await assert.rejects(pending, { code: "CREDENTIAL_PROCESS_EXIT_UNCONFIRMED" });
    await assert.rejects(f.run(), { code: "CREDENTIAL_PROCESS_EXIT_UNCONFIRMED" });
    assert.equal(f.children.length, 1); assert.deepEqual(stopped, [child, child]);
    f.close(child, 1);
    const next = await started(f); assert.equal(f.children.length, 2); next.child.stdout.write("new-secret"); f.close(next.child); assert.equal((await next.pending).text, "new-secret");
  }
});

test("signals and missing exit status never become a successful credential response", async () => {
  for (const [code, signal] of [[null, "SIGTERM"], [null, null], [-1, null]]) {
    const f = fixture(), { pending, child } = await started(f), rejected = assert.rejects(pending, /without a verified status/);
    child.stdout.write("PARTIAL_PRIVATE_SECRET"); f.close(child, code, signal); await rejected;
  }
});

test("a concurrent credential request joins pending retirement before refusing an unconfirmed predecessor", async () => {
  let release, stopping; const entered = new Promise(resolve => { stopping = resolve; });
  let stops = 0;
  const f = fixture({ stopChild: () => { stops++; stopping(); return new Promise(resolve => { release = resolve; }); } });
  const first = await started(f, "", 5), firstRejected = assert.rejects(first.pending, { code: "CREDENTIAL_PROCESS_EXIT_UNCONFIRMED" });
  await entered;
  const second = f.run(), secondRejected = assert.rejects(second, { code: "CREDENTIAL_PROCESS_EXIT_UNCONFIRMED" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 1); assert.equal(f.children.length, 1);
  release({ stopped: false }); await Promise.all([firstRejected, secondRejected]);
  f.close(first.child);
  const third = await started(f); f.close(third.child); await third.pending;
  assert.equal(f.children.length, 2);
});

test("spawn, input and later process errors expose no native diagnostics and await exact retirement", async () => {
  const unavailable = createCredentialProcessRunner({ spawnProcess: () => { throw Error("PRIVATE_SPAWN_DETAIL"); } });
  await assert.rejects(unavailable("synthetic", [], ""), error => { assert.equal(error.message, "The platform credential store is unavailable."); return true; });
  for (const source of ["stdin", "process"]) {
    const f = fixture(), { pending, child } = await started(f), rejected = assert.rejects(pending, error => { assert.equal(error.message.includes("PRIVATE"), false); return true; });
    (source === "stdin" ? child.stdin : child).emit("error", Error("PRIVATE_NATIVE_DETAILS")); await f.killRequested;
    child.emit("error", Error("PRIVATE_TERMINATION_DETAILS")); f.close(child, 1); await rejected;
  }
});

test("an observed close wins a racing unconfirmed stop result without stranding credential access", async () => {
  let f; f = fixture({ stopChild: async child => { f.close(child, 1); return { stopped: false }; } });
  const first = await started(f, "", 5); await assert.rejects(first.pending, /timed out/);
  const next = await started(f); f.close(next.child); assert.deepEqual(await next.pending, { code: 0, text: "", stderrBytes: 0 });
});

test("invalid credential deadlines refuse before any worker starts", async () => {
  const f = fixture(); for (const bound of [0, -1, 10001, NaN, "10000"]) await assert.rejects(f.run("", bound), /original bounded deadline/);
  assert.equal(f.children.length, 0);
});

test("actual controlled credential workers return only after exit and independently retire on timeout", async () => {
  const children = [], run = createCredentialProcessRunner({ spawnProcess: (...args) => { const child = spawn(...args); children.push(child); return child; } });
  try {
    const result = await run(process.execPath, ["-e", 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>process.stdout.write(s));'], "synthetic input");
    assert.equal(result.text, "synthetic input"); assert.equal(children[0].exitCode, 0);
    await assert.rejects(run(process.execPath, ["-e", 'process.stdin.resume();process.stdout.write("PARTIAL_SYNTHETIC_SECRET");setInterval(()=>{},1000);'], "", 1000), /timed out/);
    assert.ok(children[1].exitCode !== null || children[1].signalCode !== null);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
