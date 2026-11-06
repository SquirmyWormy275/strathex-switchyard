import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createKeylessLeasePool, stateLockFailureEvidence } from "./keyless-lease-pool.mjs";

// Real independently exited children double only the closed lock protocol.
// Actual Windows kernel locking is exercised separately by state-lock tests.
const helper = `import{createInterface}from"node:readline";const mode=process.argv[1];let sequence=0,held=false,busy=true;
process.stderr.write("lease-en");process.stderr.write("tered\\r\\nPRIVATE_ACCOUNT_AND_PATH\\n"+"X".repeat(1024)+"lease-owner-found\\nlease-input-read\\n");
if(mode==="bad-ready")console.log("UNEXPECTED");else if(mode==="oversized")console.log("X".repeat(257));else if(mode!=="drop-ready")console.log("READY");
const input=createInterface({input:process.stdin});input.on("line",line=>{let match;if((match=/^ACQUIRE ([1-9][0-9]*) ([01])$/.exec(line))){if(held||Number(match[1])!==++sequence)process.exit(4);if(mode==="die-on-acquire")process.exit(5);if(mode==="drop-acquire")return;if(mode==="busy-first"&&busy){busy=false;console.log("BUSY "+sequence);return;}held=true;console.log("LOCKED "+sequence);}else if(line==="RELEASE "+sequence&&held){held=false;if(mode==="drop-release")return;console.log("RELEASED "+(mode==="stale-release"?0:sequence));}else process.exit(6);});`;
function fixture(t, mode = "normal", options = {}) {
  const children = [], wire = [];
  const pool = createKeylessLeasePool({ idleMs: 100, timeoutMs: 5000, ...options, spawnWorker(key) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", helper, mode], { stdio: ["pipe", "pipe", "pipe"] });
    const write = child.stdin.write.bind(child.stdin); child.stdin.write = (value, ...args) => { wire.push(String(value)); return write(value, ...args); };
    children.push({ key, child, closed: once(child, "close") }); return child;
  } });
  t.after(async () => { await pool.close(); await Promise.all(children.map(c => c.closed)); assert.ok(children.every(c => c.child.exitCode !== null || c.child.signalCode !== null)); });
  return { pool, children, wire };
}

test("each transaction releases its lease while one keyless helper serves successive requests without receiving protected content", async t => {
  const { pool, children, wire } = fixture(t);
  assert.equal(await pool.withLease("fixed-private-lock", lease => { lease.assert(); return "PRIVATE_STATE_AND_KEY"; }), "PRIVATE_STATE_AND_KEY");
  await pool.withLease("fixed-private-lock", lease => lease.assert());
  assert.equal(children.length, 1); assert.deepEqual(wire, ["ACQUIRE 1 0\n", "RELEASE 1\n", "ACQUIRE 2 0\n", "RELEASE 2\n"]);
  assert.equal(wire.join("").includes("PRIVATE_"), false);
});

test("concurrent mutations of one path serialize and nonblocking nested probes refuse immediately without losing the current lease", async t => {
  const { pool, children } = fixture(t), order = []; let active = 0;
  await Promise.all(Array.from({ length: 8 }, (_, i) => pool.withLease("one", async lease => {
    assert.equal(++active, 1); order.push(i);
    await assert.rejects(pool.withLease("one", () => assert.fail("busy callback"), { nonBlocking: true }), e => e.code === "STATE_LOCK_BUSY");
    lease.assert(); active--;
  })));
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7]); assert.equal(children.length, 1);
});

test("distinct pinned paths can nest without sharing lease identity or inheriting another path's authority", async t => {
  const { pool, children } = fixture(t); let old;
  await pool.withLease("outer", async lease => { old = lease; await pool.withLease("inner", inner => { lease.assert(); inner.assert(); }); lease.assert(); });
  assert.throws(() => old.assert(), /lost/); assert.deepEqual(children.map(c => c.key), ["outer", "inner"]);
});

test("callback and progress failures still release the kernel-protocol lease and do not poison a later transaction", async t => {
  const { pool, children, wire } = fixture(t);
  await assert.rejects(pool.withLease("one", () => { throw Error("Synthetic callback failure"); }), /callback failure/);
  await assert.rejects(pool.withLease("one", () => assert.fail("progress callback must refuse first"), { onProgress: () => { throw Error("Synthetic progress failure"); } }), /progress failure/);
  await pool.withLease("one", lease => lease.assert()); assert.equal(children.length, 1); assert.equal(wire.filter(l => l.startsWith("RELEASE ")).length, 3);
});

test("busy native probes retain the helper and never invoke a protected callback", async t => {
  const { pool, children } = fixture(t, "busy-first");
  await assert.rejects(pool.withLease("one", () => assert.fail("native busy callback"), { nonBlocking: true }), e => e.code === "STATE_LOCK_BUSY");
  await pool.withLease("one", lease => lease.assert()); assert.equal(children.length, 1);
});

test("unexpected, oversized or lost acquisition replies fail closed without entering a state mutation", async t => {
  for (const mode of ["bad-ready", "oversized", "die-on-acquire"]) { const { pool } = fixture(t, mode); await assert.rejects(pool.withLease("one", () => assert.fail("unconfirmed lease")), /unavailable/); }
});

test("helper loss invalidates an active lease before publishing and does not silently rerun the callback", async t => {
  const { pool, children } = fixture(t); let calls = 0, published = false;
  await assert.rejects(pool.withLease("one", async lease => { calls++; const child = children[0]; child.child.kill(); await child.closed; lease.assert(); published = true; }), /lost/);
  assert.equal(calls, 1); assert.equal(published, false);
});

test("wrong or absent release acknowledgements preserve the uncertain result as failure with no replay", async t => {
  for (const mode of ["stale-release", "drop-release"]) { const { pool } = fixture(t, mode); let calls = 0; await assert.rejects(pool.withLease("one", () => { calls++; }), /unavailable|timed out/); assert.equal(calls, 1); }
});

test("idle workers exit independently, later explicit requests create fresh helpers, and shutdown refuses new ingress", async t => {
  const { pool, children } = fixture(t, "normal", { idleMs: 10 });
  await pool.withLease("one", lease => lease.assert()); await children[0].closed;
  await pool.withLease("one", lease => lease.assert()); assert.equal(children.length, 2);
  await pool.close(); await assert.rejects(pool.withLease("one", () => assert.fail("shutdown ingress")), /unavailable/);
});

test("worker capacity refuses another path without disturbing a held lease and configuration cannot extend its bounds", async t => {
  const { pool, children } = fixture(t, "normal", { maxWorkers: 1 });
  await pool.withLease("one", async lease => { await assert.rejects(pool.withLease("two", () => assert.fail("over-capacity callback")), /unavailable/); lease.assert(); });
  assert.equal(children.length, 1);
  for (const invalid of [{ idleMs: 2001 }, { idleMs: 0 }, { timeoutMs: 15001 }, { timeoutMs: NaN }, { maxWorkers: 65 }, { maxWorkers: 0 }]) assert.throws(() => createKeylessLeasePool({ spawnWorker: () => {}, ...invalid }), /configuration/);
});

test("bounded timeout diagnostics distinguish startup, acquisition and release without exposing native stderr or replaying a callback", async t => {
  for (const [mode, phase, calls] of [["drop-ready", "worker-startup", 0], ["drop-acquire", "lease-acquire", 0], ["drop-release", "lease-release", 1]]) {
    const { pool, children } = fixture(t, mode, { timeoutMs: 1000 }); let invoked = 0;
    await assert.rejects(pool.withLease("PRIVATE_LOCK_PATH", () => { invoked++; }), error => {
      assert.equal(error.code, "STATE_LOCK_TIMEOUT"); assert.equal(error.lockPhase, phase); assert.equal(error.workerProgress, "lease-input-read");
      assert.equal(error.stateLockFailure.kind, "timeout"); assert.equal(error.stateLockFailure.phase, phase);
      assert.ok(error.message.includes(phase)); assert.equal(/PRIVATE|XXXX|lease-owner-found/.test(error.message), false); return true;
    });
    assert.equal(invoked, calls); await children[0].closed;
    assert.equal(children.length, 1, "A failed transaction never creates a replacement helper");
  }
});

test("child exit and malformed lock replies retain fixed failure facts without stdout, stderr or paths", async t => {
  for (const [mode, kind, phase, exitCode] of [["die-on-acquire", "child-exit", "lease-acquire", 5], ["bad-ready", "invalid-reply", "worker-startup", null], ["oversized", "output-bound", "worker-startup", null], ["stale-release", "invalid-reply", "lease-release", null]]) {
    const { pool } = fixture(t, mode);
    await assert.rejects(pool.withLease("PRIVATE_LOCK_PATH", () => {}), error => {
      assert.equal(error.code, "STATE_LOCK_UNAVAILABLE");
      const evidence = stateLockFailureEvidence(error.stateLockFailure);
      assert.ok(evidence); assert.equal(evidence.kind, kind); assert.equal(evidence.phase, phase); assert.equal(evidence.exitCode, exitCode);
      assert.equal(/PRIVATE|UNEXPECTED|XXXX/.test(JSON.stringify(evidence)), false); return true;
    });
  }
});

test("state lock failure projection refuses private and malformed fields without granting a lease", () => {
  const value = { schema: "switchyard-state-lock-failure/v1", kind: "child-exit", phase: "worker-startup", progress: "not-observed", exitCode: 3221225794, signal: null, spawnCode: null };
  assert.deepEqual(stateLockFailureEvidence(value), value); assert.notEqual(stateLockFailureEvidence(value), value);
  for (const extra of [{ path: "PRIVATE" }, { kind: "PRIVATE" }, { phase: "PRIVATE" }, { progress: "PRIVATE" }, { signal: "PRIVATE" }, { spawnCode: "PRIVATE" }, { exitCode: 4294967296 }, { exitCode: -2147483649 }, { exitCode: 0.1 }, { exitCode: "5" }, { schema: "wrong" }]) assert.equal(stateLockFailureEvidence({ ...value, ...extra }), undefined);
});
