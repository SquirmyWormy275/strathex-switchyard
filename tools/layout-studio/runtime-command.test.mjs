import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { runtimeEnvironment } from "./runtime-setup.mjs";

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
test("Windows runtime guardian accepts standard x86 program-directory coordinates without admitting arbitrary environment names", { skip: process.platform !== "win32" ? "Native Windows environment block" : skip }, async () => {
  const env = { ...options.env, "ProgramFiles(x86)": "C:\\Program Files (x86)", "CommonProgramFiles(x86)": "C:\\Program Files (x86)\\Common Files" };
  const code = "process.stdout.write(JSON.stringify([process.env['ProgramFiles(x86)'],process.env['CommonProgramFiles(x86)']]))";
  assert.deepEqual(JSON.parse(await runRuntimeCommand(process.execPath, ["-e", code], { ...options, env })), [env["ProgramFiles(x86)"], env["CommonProgramFiles(x86)"]]);
  await assert.rejects(runRuntimeCommand(process.execPath, ["-e", "process.stdout.write('must-not-start')"], { ...options, env: { ...env, "Invalid(Name)": "rejected" } }));
});
test("runtime guardian reports a verified nonzero exit without returning sensitive stderr", { skip }, async () => {
  await assert.rejects(runRuntimeCommand(process.execPath, ["-e", "process.stderr.write('synthetic-secret');process.exit(17)"], options), (error) => { assert.match(error.message, /failed/); assert.ok(!error.message.includes("synthetic-secret")); assert.notEqual(error.code, "RUNTIME_STOP_UNCONFIRMED"); return true; });
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
  const wrapper = `import {runRuntimeCommand} from ${JSON.stringify(new URL("./runtime-command.mjs", import.meta.url).href)};import {runtimeEnvironment} from ${JSON.stringify(new URL("./runtime-setup.mjs", import.meta.url).href)};import {writeFile} from 'node:fs/promises';await runRuntimeCommand(process.execPath,['-e',${JSON.stringify(code)}],{...${JSON.stringify(windowsHelper ? { windowsHelper } : {})},env:runtimeEnvironment(),onGuardianReady:f=>writeFile(${JSON.stringify(guardian)},String(f.guardianPid))});`;
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
