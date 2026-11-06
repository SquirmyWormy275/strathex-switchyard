import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, symlink, readFile, readdir, writeFile, rename, link } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { createKeylessLeasePool } from "./keyless-lease-pool.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { withStateLock, windowsLockRequest, canonicalWindowsLockPath } from "./state-lock.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
import { applicationEnvironment } from "../../deployment/suite/application.mjs";

test("the Windows kernel-lock wire preserves literal Unicode paths and refuses injection, invalid identities and oversized input", () => {
  const path = 'C:\\Users\\Synthetic user\\私用\\literal\t$() `";.lock';
  for (const trace of [false, true]) for (const nonBlocking of [false, true]) {
    const wire = windowsLockRequest({ path, parentPid: 2147483647, trace, nonBlocking });
    assert.equal(wire.endsWith("\n"), true); assert.equal(wire.split("\n").length, 2);
    const [schema, parent, traced, nonblock, encoded] = wire.trimEnd().split("\t");
    assert.equal(schema, "SXSY-LOCK/1"); assert.equal(parent, "2147483647"); assert.equal(traced, trace ? "1" : "0"); assert.equal(nonblock, nonBlocking ? "1" : "0");
    assert.equal(Buffer.from(encoded, "base64").toString("utf8"), path); assert.equal(wire.includes("literal"), false);
  }
  const good = { path: "C:\\private\\personal.lock", parentPid: 1 };
  for (const changed of [{ path: "" }, { path: "x\n1" }, { path: "x\r1" }, { path: "x\u00001" }, { path: "x\ud800" }, { path: "界".repeat(5462) }, { parentPid: 0 }, { parentPid: 2147483648 }, { parentPid: 1.5 }, { parentPid: "1" }, { trace: 1 }, { nonBlocking: "false" }]) assert.throws(() => windowsLockRequest({ ...good, ...changed }));
  assert.ok(windowsLockRequest({ ...good, path: "x".repeat(16384) }).length < 22000);
});

const lockStats = patch => ({ dev: 9n, ino: 9007199254740992n, nlink: 1n, isFile: () => true, isSymbolicLink: () => false, ...patch });
test("Windows short-name spelling resolves to the same exact file before the native canonical-path request", async () => {
  const path = "C:\\Users\\SYNTH~1\\Temp\\personal.lock", canonical = "C:\\Users\\Synthetic user\\Temp\\personal.lock", calls = [];
  const ports = { readStats: async (path, options) => { calls.push(path); assert.deepEqual(options, { bigint: true }); return lockStats(); }, resolvePath: async value => { assert.equal(value, path); return canonical; } };
  assert.equal(await canonicalWindowsLockPath(path, ports), canonical);
  assert.deepEqual(calls, [path, canonical]);
  const wire = windowsLockRequest({ path: canonical, parentPid: 42 });
  assert.equal(Buffer.from(wire.trimEnd().split("\t")[4], "base64").toString("utf8"), canonical);
});
test("Windows lock path resolution refuses alternate drives, namespaces and changed file identities", async () => {
  const path = "C:\\private\\personal.lock";
  for (const canonical of ["D:\\private\\personal.lock", "\\\\server\\share\\personal.lock", "\\\\?\\C:\\private\\personal.lock", "C:\\private\\..\\personal.lock", "C:\\private\\personal.lock:stream"]) {
    await assert.rejects(canonicalWindowsLockPath(path, { readStats: async () => lockStats(), resolvePath: async () => canonical }));
  }
  for (const patch of [{ ino: 9007199254740993n }, { dev: 10n }, { nlink: 2n }, { isFile: () => false }, { isSymbolicLink: () => true }]) {
    let reads = 0;
    await assert.rejects(canonicalWindowsLockPath(path, { readStats: async () => lockStats(++reads === 2 ? patch : {}), resolvePath: async () => path }));
    assert.equal(reads, 2);
  }
});
test("Windows lock aliases cannot turn an original link or invalid path into an ordinary target", async () => {
  let resolutions = 0;
  const resolvePath = async () => { resolutions++; return "C:\\private\\personal.lock"; };
  for (const path of ["relative", "C:relative", "C:\\private\\.\\personal.lock", "C:\\private\\personal.lock\n"]) await assert.rejects(canonicalWindowsLockPath(path, { readStats: async () => { throw Error("unexpected lookup"); }, resolvePath }));
  for (const patch of [{ nlink: 2n }, { isFile: () => false }, { isSymbolicLink: () => true }]) await assert.rejects(canonicalWindowsLockPath("C:\\private\\personal.lock", { readStats: async () => lockStats(patch), resolvePath }));
  assert.equal(resolutions, 0);
});

test("the native Windows lease worker refuses replaced and hard-linked lock files and malformed release", { skip: process.platform !== "win32" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-native-lease-")), helper = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url));
  const workers = [], pool = createKeylessLeasePool({ spawnWorker(path) {
    const child = spawn(helper, ["--state-lease-worker"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    workers.push(child); child.stdin.write(windowsLockRequest({ path, parentPid: process.pid })); return child;
  } });
  t.after(async () => { await pool.close(); for (const child of workers) await stopOwnedChild(child); await rm(root, { recursive: true, force: true }); });
  const path = join(root, "私用 literal $() `';.lock"); await writeFile(path, "original");
  const pinned = spawn(helper, ["--state-lease-worker"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); workers.push(pinned);
  const pinnedExit = once(pinned, "close"), lines = createInterface({ input: pinned.stdout, crlfDelay: Infinity }), replies = lines[Symbol.asyncIterator]();
  pinned.stdin.on("error", () => {}); pinned.stderr.resume(); pinned.stdin.write(windowsLockRequest({ path, parentPid: process.pid }));
  assert.equal((await replies.next()).value, "READY");
  await rename(path, join(root, "original.lock")); await writeFile(path, "replacement");
  pinned.stdin.end("ACQUIRE 1 0\n"); assert.equal((await pinnedExit)[0], 2); assert.equal((await replies.next()).done, true); lines.close();
  let entered = false; assert.equal(await readFile(path, "utf8"), "replacement");
  const linked = join(root, "hard-linked.lock"); await link(path, linked);
  await assert.rejects(pool.withLease(linked, async () => { entered = true; }), /unavailable/); assert.equal(entered, false);
  const malformedPath = join(root, "malformed.lock"); await writeFile(malformedPath, "preserved");
  const child = spawn(helper, ["--state-lease-worker"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); workers.push(child);
  const exited = once(child, "close"); child.stdin.on("error", () => {});
  child.stdin.end(windowsLockRequest({ path: malformedPath, parentPid: process.pid }) + "ACQUIRE 1 0\nRELEASE 2\n");
  let output = "", diagnostic = ""; child.stdout.on("data", b => { output += b; }); child.stderr.on("data", b => { diagnostic += b; });
  const [code] = await exited; assert.equal(code, 2); assert.match(output, /LOCKED 1/); assert.doesNotMatch(output, /RELEASED/);
  assert.equal(diagnostic.trim().split(/\r?\n/).every(line => ["lease-entered", "lease-input-read"].includes(line)), true);
  await pool.withLease(malformedPath, async lease => { lease.assert(); }); assert.equal(await readFile(malformedPath, "utf8"), "preserved");
});

test("independent store instances serialize initialization and updates without replacing a compartment key or losing writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-multi-store-")), keys = new Map(); let created = 0;
  const secrets = { get: async (id, purpose) => { await new Promise((r) => setTimeout(r, 2)); return keys.get(`${id}:${purpose}`); }, set: async (id, purpose, value) => { created++; keys.set(`${id}:${purpose}`, value); } };
  const a = createSuiteStore({ root, secrets }), b = createSuiteStore({ root, secrets });
  try {
    await Promise.all([a.initialize("personal"), b.initialize("personal")]);
    assert.equal(created, 1);
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).update("personal", "concurrent-increment", (s) => { s.testCount = (s.testCount ?? 0) + 1; })));
    assert.equal((await a.snapshot("personal")).testCount, 12);
    assert.equal((await b.snapshot("personal")).audit.length, 12);
    const raw = await readFile(join(root, "personal.sealed.json"), "utf8"); assert.equal(raw.includes("testCount"), false);
    assert.deepEqual((await readdir(join(root, "locks"))).sort(), ["personal.lock"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("kernel lock releases after its owner crashes and a separate process can acquire the same lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-crash-lock-"));
  const moduleUrl = new URL("./state-lock.mjs", import.meta.url).href;
  const code = `import {withStateLock} from ${JSON.stringify(moduleUrl)}; await withStateLock(${JSON.stringify(root)}, 'personal', async () => { process.stdout.write('HELD\\n'); await new Promise(resolve => { process.stdin.on('end', resolve); process.stdin.resume(); }); });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["pipe", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Synthetic lock owner did not become ready")), 15000);
      child.on("error", (e) => { clearTimeout(timer); reject(e); }); child.stdout.on("data", (b) => { if (b.toString().includes("HELD")) { clearTimeout(timer); resolve(); } }); child.once("exit", () => { clearTimeout(timer); reject(new Error("Synthetic lock owner exited before acquiring")); });
    });
    let probed = false;
    await assert.rejects(withStateLock(root, "personal", async () => { probed = true; }, { nonBlocking: true }), error => error.code === "STATE_LOCK_BUSY");
    assert.equal(probed, false);
    const exited = once(child, "close"); child.kill("SIGKILL"); await exited;
    let entered = false; await withStateLock(root, "personal", async () => { entered = true; }); assert.equal(entered, true);
    if (process.platform === "linux") {
      await assert.rejects(withStateLock(root, "lost", async lease => {
        const children = (await readFile(`/proc/self/task/${process.pid}/children`, "utf8")).trim().split(/\s+/u).filter(Boolean), owners = [];
        for (const pid of children) {
          let args; try { args = (await readFile(`/proc/${pid}/cmdline`)).toString().split("\0"); } catch { continue; }
          if (args[0] === "/usr/bin/flock" && args.includes(join(root, "locks/lost.lock"))) owners.push(Number(pid));
        }
        assert.equal(owners.length, 1); process.kill(owners[0], "SIGTERM");
        let lost = false;
        for (let i = 0; i < 100; i++) { try { lease.assert(); } catch { lost = true; break; } await new Promise(resolve => setTimeout(resolve, 10)); }
        assert.equal(lost, true); lease.assert();
      }), /lock was lost/);
      let reacquired = false; await withStateLock(root, "lost", async lease => { lease.assert(); reacquired = true; }); assert.equal(reacquired, true);
    }
  } finally { child.stdin.end(); if (child.exitCode === null) child.kill(); await rm(root, { recursive: true, force: true }); }
});

test("a failed state transaction cannot poison another store instance or publish its uncommitted fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-store-failed-queue-")), keys = new Map();
  const secrets = { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, value) => { keys.set(`${id}:${purpose}`, value); } };
  const a = createSuiteStore({ root, secrets }), b = createSuiteStore({ root, secrets });
  try {
    await a.initialize("personal");
    const failed = a.update("personal", "synthetic-uncommitted", state => { state.uncommitted = true; throw Error("synthetic transaction refusal"); });
    const next = b.update("personal", "synthetic-next", state => { assert.equal(state.uncommitted, undefined); state.committed = true; });
    await assert.rejects(failed, /transaction refusal/); await next;
    const state = await a.snapshot("personal"); assert.equal(state.uncommitted, undefined); assert.equal(state.committed, true); assert.equal(state.audit.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("nonblocking resource probes distinguish a held kernel lease from callback failures and retain the normal owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-resource-probe-")), secrets = { get: async () => undefined, set: async () => {} };
  const a = createSuiteStore({ root, secrets }), b = createSuiteStore({ root, secrets }); let called = false;
  try {
    await a.withResourceLock("repository-execution", "synthetic-owner", async held => {
      const busy = await b.tryWithResourceLock("repository-execution", "synthetic-owner", async () => { called = true; });
      assert.deepEqual(busy, { acquired: false }); assert.equal(called, false); held.assert();
    });
    assert.deepEqual(await b.tryWithResourceLock("repository-execution", "synthetic-owner", async held => { held.assert(); return "verified"; }), { acquired: true, value: "verified" });
    await assert.rejects(b.tryWithResourceLock("repository-execution", "synthetic-owner", async () => { throw Object.assign(Error("Synthetic callback failure"), { code: "STATE_LOCK_BUSY" }); }), /callback failure/);
    await assert.rejects(b.tryWithResourceLock("unknown", "synthetic-owner", async () => {}), /Unsupported/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lock identity and symlink root are rejected before a protected mutation", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-rejected-lock-")); let entered = false;
  try {
    await assert.rejects(withStateLock(root, "../escape", async () => { entered = true; }), /identity/);
    await symlink(root, join(root, "locks"));
    await assert.rejects(withStateLock(root, "personal", async () => { entered = true; }), /ownership|permissions/);
    assert.equal(entered, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a detached owner with no console acquires the UTF-8 pipe lease and releases it on abrupt exit", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-detached-lock-")), moduleUrl = new URL("./state-lock.mjs", import.meta.url).href;
  const program = `import{withStateLock}from ${JSON.stringify(moduleUrl)};import{writeSync}from 'node:fs';await withStateLock(${JSON.stringify(root)},'detached',async()=>{writeSync(3,'HELD\\n');await new Promise(()=>{});});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", program], { env: applicationEnvironment(), detached: true, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "pipe"] });
  try {
    await new Promise((resolve, reject) => { let output = ""; const timer = setTimeout(() => reject(new Error("The detached pipe-only lock owner did not become ready.")), 18000); child.once("error", reject); child.stdio[3].on("data", (b) => { output += b; if (output === "HELD\n") { clearTimeout(timer); resolve(); } }); child.once("exit", () => { clearTimeout(timer); reject(new Error("The detached lock owner exited before ready.")); }); });
    const exited = once(child, "close"); child.kill("SIGKILL"); await exited; let acquired = false;
    await withStateLock(root, "detached", async () => { acquired = true; }); assert.equal(acquired, true);
  } finally { await stopOwnedChild(child); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
