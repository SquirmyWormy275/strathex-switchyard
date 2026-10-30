import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { runtimeEnvironment } from "./runtime-setup.mjs";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { createHash } from "node:crypto";

const windowsHelper = process.env.SWITCHYARD_TEST_RUNTIME_HELPER;
const options = { env: runtimeEnvironment(), ...(windowsHelper ? { windowsHelper } : {}) };
const skip = process.platform === "win32" && !windowsHelper ? "Built native helper is tested in the subsequent Windows guardian workflow step" : false;
async function fixture(fn) { const root = await mkdtemp(join(tmpdir(), "switchyard-command-")); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }
async function waitFor(fn, ms = 8000) { const end = Date.now() + ms; do { try { const value = await fn(); if (value) return value; } catch (e) { if (e.code !== "ENOENT") throw e; } await new Promise(r => setTimeout(r, 20)); } while (Date.now() < end); throw new Error("Owned process fixture did not reach its expected state"); }
async function gone(pid) { try { process.kill(pid, 0); if (process.platform === "linux") return (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ").at(-1).startsWith("Z "); return false; } catch (e) { if (["ENOENT", "ESRCH"].includes(e.code)) return true; throw e; } }

test("runtime guardian commits readiness, preserves invocation identity and returns only bounded stdout", { skip }, () => fixture(async (root) => {
  const marker = join(root, "ran"), secret = "synthetic-private-installer-url";
  const executable = process.platform === "linux" ? join(root, "native-alias") : process.execPath;
  if (process.platform === "linux") await symlink(process.execPath, executable);
  let ready = false, scope;
  const output = await runRuntimeCommand(executable, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'yes');process.stderr.write(${JSON.stringify(secret)});process.stdout.write(JSON.stringify({value:'verified',invokedAs:process.argv0}))`], { ...options, onGuardianReady: async (frame) => { scope = frame; assert.ok(frame.guardianPid > 0); assert.equal(await runtimeGuardianStopped(frame, options), false); await assert.rejects(readFile(marker), { code: "ENOENT" }); ready = true; await new Promise(r => setTimeout(r, 50)); } });
  assert.equal(ready, true); assert.deepEqual(JSON.parse(output), { value: "verified", invokedAs: executable }); assert.equal(await readFile(marker, "utf8"), "yes"); assert.ok(!output.includes(secret));
  assert.equal(await runtimeGuardianStopped(scope, options), true);
}));
test("runtime guardian cannot execute when the durable start acknowledgement fails", { skip }, () => fixture(async (root) => {
  const marker = join(root, "ran");
  await assert.rejects(runRuntimeCommand(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'yes')`], { ...options, onGuardianReady: () => { throw new Error("synthetic disk failure"); } }), /acknowledgement/);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
}));
test("native guardian environment blocks respect platform identifiers and reject unapproved parenthesized names", { skip }, () => fixture(async (root) => {
  const env = { ...options.env, "ProgramFiles(x86)": "C:\\Program Files (x86)", "CommonProgramFiles(x86)": "C:\\Program Files (x86)\\Common Files" };
  if (process.platform !== "win32") { const marker = join(root, "must-not-start"); await assert.rejects(runRuntimeCommand(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`], { ...options, env })); await assert.rejects(readFile(marker), { code: "ENOENT" }); return; }
  const code = "process.stdout.write(JSON.stringify([process.env['ProgramFiles(x86)'],process.env['CommonProgramFiles(x86)']]))";
  assert.deepEqual(JSON.parse(await runRuntimeCommand(process.execPath, ["-e", code], { ...options, env })), [env["ProgramFiles(x86)"], env["CommonProgramFiles(x86)"]]);
  await assert.rejects(runRuntimeCommand(process.execPath, ["-e", "process.stdout.write('must-not-start')"], { ...options, env: { ...env, "Invalid(Name)": "rejected" } }));
}));
test("runtime guardian reports a verified nonzero exit without returning sensitive stderr", { skip }, async () => {
  await assert.rejects(runRuntimeCommand(process.execPath, ["-e", "process.stderr.write('synthetic-secret');process.exit(17)"], options), (error) => { assert.match(error.message, /failed/); assert.ok(!error.message.includes("synthetic-secret")); assert.notEqual(error.code, "RUNTIME_STOP_UNCONFIRMED"); return true; });
});
test("reviewed native text crosses only a bounded UTF-8 pipe after guardian readiness, with diagnostics explicitly private", { skip }, () => fixture(async (root) => {
  const marker = join(root, "ran"), inputText = "Synthetic private text: café\n" + "界".repeat(3000); let scope;
  const code = `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'yes');process.stderr.write('synthetic-diagnostic');process.stdout.write(JSON.stringify({input,argv:process.argv.slice(1)}));process.exitCode=7})`;
  const result = await runRuntimeCommand(process.execPath, ["-e", code], { ...options, inputText, captureStderrBytes: 128, detailed: true, onGuardianReady: async (frame) => { scope = frame; assert.ok(frame.capabilities.includes("bounded-stdin")); assert.equal(JSON.stringify(frame).includes(inputText), false); await assert.rejects(readFile(marker), { code: "ENOENT" }); } });
  assert.equal(result.exitCode, 7); assert.equal(result.status, "failed"); assert.equal(result.treeExitVerified, true); assert.equal(result.inputDelivered, true); assert.equal(result.stderr, "synthetic-diagnostic"); assert.deepEqual(JSON.parse(result.stdout), { input: inputText, argv: [] }); assert.equal(await runtimeGuardianStopped(scope, options), true);
}));
test("a pre-cancelled or oversized native input cannot start an owned guardian", { skip }, async () => {
  const controller = new AbortController(); controller.abort(); let started = false;
  await assert.rejects(runRuntimeCommand(process.execPath, ["--version"], { ...options, signal: controller.signal, onGuardianChild: () => { started = true; } }), /cancelled before startup/);
  await assert.rejects(runRuntimeCommand(process.execPath, ["--version"], { ...options, inputText: "界".repeat(174763), onGuardianChild: () => { started = true; } }), /bounded private input/);
  assert.equal(started, false);
});
test("a complete bounded designer context crosses the private pipe at the exact UTF-8 byte limit after readiness", { skip }, async () => {
  const inputText = "界".repeat(174762) + "é", expected = createHash("sha256").update(inputText).digest("hex"); let scope;
  assert.equal(Buffer.byteLength(inputText), 524288);
  const result = await runRuntimeCommand(process.execPath, ["-e", "let bytes=0;const hash=require('node:crypto').createHash('sha256');process.stdin.on('data',b=>{bytes+=b.length;hash.update(b)});process.stdin.on('end',()=>process.stdout.write(JSON.stringify({bytes,digest:hash.digest('hex'),argv:process.argv.slice(1)})))"], { ...options, inputText, detailed: true, maxOutputBytes: 1024, onGuardianReady: frame => { assert.ok(frame.capabilities.includes("bounded-stdin-512k")); scope = frame; } });
  assert.deepEqual(JSON.parse(result.stdout), { bytes: 524288, digest: expected, argv: [] }); assert.equal(result.inputDelivered, true); assert.equal(result.treeExitVerified, true); assert.equal(await runtimeGuardianStopped(scope, options), true);
});
test("owned text resources commit exact guardian scope before execution and durable exit before releasing ownership", { skip }, () => fixture(async (root) => {
  const resource = { clients: new Set() }, marker = join(root, "ran"); let saved, stopped = false;
  const result = await runOwnedNativeCommand({ executable: process.execPath, args: ["-e", `process.stdin.resume();process.stdin.on('end',()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'yes');process.stdout.write('Ready')})`], cwd: root, env: runtimeEnvironment(), text: "Synthetic", resource, command: (exe, args, o) => runRuntimeCommand(exe, args, { ...o, ...(windowsHelper ? { windowsHelper } : {}) }), guardianStopped: frame => runtimeGuardianStopped(frame, options),
    onReady: async frame => { saved = frame; await assert.rejects(readFile(marker), { code: "ENOENT" }); }, onStopped: async frame => { assert.deepEqual(frame, saved); assert.equal(await runtimeGuardianStopped(frame, options), true); stopped = true; } });
  assert.equal(result.stdout, "Ready"); assert.equal(stopped, true); assert.equal(resource.clients.size, 1); for (const client of resource.clients) { assert.equal(client.closed, true); assert.equal(await client.stop(), true); }
}));
test("cancelling a private input turn stops its native command and descendant under the same guardian", { skip }, () => fixture(async (root) => {
  const marker = join(root, "pids"), controller = new AbortController(); let scope;
  const code = `process.stdin.resume();process.stdin.on('end',()=>{const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)})`;
  const pending = runRuntimeCommand(process.execPath, ["-e", code], { ...options, inputText: "Synthetic", signal: controller.signal, onGuardianReady: frame => { scope = frame; } });
  const outcome = pending.catch(e => e), pids = await waitFor(async () => JSON.parse(await readFile(marker, "utf8"))); controller.abort();
  assert.match((await outcome).message, /Cancellation/);
  for (const pid of pids) await waitFor(() => gone(pid));
  await waitFor(() => runtimeGuardianStopped(scope, options));
}));
test("explicit native diagnostics remain bounded and overflow contains the owned command", { skip }, async () => {
  const r = await runRuntimeCommand(process.execPath, ["-e", "process.stderr.write('x'.repeat(100000));setInterval(()=>{},1000)"], { ...options, captureStderrBytes: 64, detailed: true });
  assert.equal(r.status, "output-limit"); assert.equal(r.treeExitVerified, true); assert.ok(Buffer.byteLength(r.stderr) <= 64);
});
test("runtime timeout contains an ignoring child and its descendant before rejecting", { skip }, () => fixture(async (root) => {
  const pidFile = join(root, "pids");
  const code = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)")}],{stdio:'inherit'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,c.pid]));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
  await assert.rejects(runRuntimeCommand(process.execPath, ["-e", code], { ...options, timeout: 1000 }), /timed out/);
  for (const pid of JSON.parse(await readFile(pidFile, "utf8"))) await waitFor(() => gone(pid));
}));
test("successful runtime command contains a leftover descendant before claiming tree exit", { skip }, () => fixture(async (root) => {
  const pidFile = join(root, "pid");
  const code = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));c.unref();process.stdout.write('done');process.exit(0)`;
  assert.equal(await runRuntimeCommand(process.execPath, ["-e", code], options), "done");
  const pid = Number(await readFile(pidFile, "utf8")); await waitFor(() => gone(pid));
}));
test("loss of the installer owner stops its guardian, command and descendant", { skip }, () => fixture(async (root) => {
  const pids = join(root, "pids"), guardian = join(root, "guardian");
  const code = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('node:fs').writeFileSync(${JSON.stringify(pids)},JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)`;
  const wrapper = `import {runRuntimeCommand} from ${JSON.stringify(new URL("./runtime-command.mjs", import.meta.url).href)};import {runtimeEnvironment} from ${JSON.stringify(new URL("./runtime-setup.mjs", import.meta.url).href)};import {writeFile} from 'node:fs/promises';await runRuntimeCommand(process.execPath,['-e',${JSON.stringify(code)}],{...${JSON.stringify(windowsHelper ? { windowsHelper } : {})},inputText:'Synthetic owner-loss pipe',env:runtimeEnvironment(),onGuardianReady:f=>writeFile(${JSON.stringify(guardian)},String(f.guardianPid))});`;
  const owner = spawn(process.execPath, ["--input-type=module", "-e", wrapper], { env: runtimeEnvironment(), stdio: "ignore" });
  try {
    const owned = await waitFor(async () => JSON.parse(await readFile(pids, "utf8"))); const guardianPid = Number(await readFile(guardian, "utf8"));
    const exited = new Promise(r => owner.once("exit", r)); owner.kill("SIGKILL"); await exited;
    for (const pid of [...owned, guardianPid]) await waitFor(() => gone(pid));
  } finally { if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL"); }
}));
test("native boundary stops the direct command after guardian loss without claiming a clean exit", { skip }, () => fixture(async (root) => {
  const marker = join(root, "pid"); let guardian;
  const operation = runRuntimeCommand(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`], { ...options, onGuardianReady: frame => { guardian = frame.guardianPid; } });
  const outcome = operation.catch(e => e);
  const pid = await waitFor(async () => Number(await readFile(marker, "utf8")));
  process.kill(guardian, "SIGKILL"); assert.equal((await outcome).code, "RUNTIME_STOP_UNCONFIRMED"); await waitFor(() => gone(pid));
}));
test("runtime guardian contains excessive output before reporting a bounded failure", { skip }, async () => {
  await assert.rejects(runRuntimeCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)"], { ...options, maxOutputBytes: 64 }), (error) => { assert.match(error.message, /output bound/); assert.notEqual(error.code, "RUNTIME_STOP_UNCONFIRMED"); return true; });
});
