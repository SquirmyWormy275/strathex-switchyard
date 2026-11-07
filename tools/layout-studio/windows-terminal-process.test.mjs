import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { windowsTerminalProcessQuery, windowsTerminalProcessResult, createWindowsTerminalProcessProbe } from "./windows-terminal-process.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

const image = () => ({ path: "C:\\Program Files\\Reviewed\\codex.exe", sha256: "a".repeat(64), device: "0", inode: "9007199254740993", size: "512" });
const input = () => ({ processId: 321, expectedBirth: null, image: image() });
const query = () => ({ schema: "switchyard-editor-terminal-process-query/v1", requestId: randomUUID(), ...input() });
const proof = request => ({ schema: "switchyard-editor-terminal-process-result/v1", requestId: request.requestId, processId: request.processId, birth: request.expectedBirth ?? "133000000000000001", image: { ...request.image },
  currentUserVerified: true, currentSessionVerified: true, processAccessMask: 0x101000, tokenAccessMask: 8, processTerminated: false, windowFocused: false, taskAttached: false, accountVerified: false });

test("Windows terminal queries retain exact 64-bit image/birth identities and refuse ambiguous targets before native access", () => {
  const value = query(), selected = windowsTerminalProcessQuery(value); assert.deepEqual(selected, value); assert.ok(Object.isFrozen(selected.image));
  value.image.path = "C:\\Changed.exe"; assert.equal(selected.image.path, image().path);
  for (const change of [{ processId: 0 }, { processId: "321" }, { processId: 0x80000000 }, { processId: 1.5 }, { expectedBirth: "0" }, { expectedBirth: "01" }, { expectedBirth: "18446744073709551616" }, { expectedBirth: 1 }, { requestId: "00000000-0000-0000-0000-000000000000" }, { command: "NEVER_EXECUTE" }]) assert.throws(() => windowsTerminalProcessQuery({ ...query(), ...change }));
  for (const path of ["C:relative.exe", "\\\\server\\share\\a.exe", "\\\\?\\C:\\a.exe", "C:\\x\\..\\a.exe", "C:\\x\\a.exe:stream", "C:\\x\\a. ", "C:\\x\\NUL.exe", "C:\\x\\a?.exe", "C:/x/a.exe", "C:\\x\\"]) assert.throws(() => windowsTerminalProcessQuery({ ...query(), image: { ...image(), path } }));
  for (const change of [{ device: "4294967296" }, { inode: "0" }, { inode: 9007199254740992 }, { size: "0" }, { size: "536870913" }, { size: "01" }, { sha256: "A".repeat(64) }, { extra: true }]) assert.throws(() => windowsTerminalProcessQuery({ ...query(), image: { ...image(), ...change } }));
  for (const key of Object.keys(query())) { const value = query(); delete value[key]; assert.throws(() => windowsTerminalProcessQuery(value)); }
  assert.equal(windowsTerminalProcessQuery({ ...query(), expectedBirth: "18446744073709551615", image: { ...image(), inode: "18446744073709551615", size: "536870912" } }).image.inode, "18446744073709551615");
});

test("a terminal response cannot substitute the process, image, user/session or access mask or claim attachment", () => {
  const request = { ...query(), expectedBirth: "133000000000000001" }, value = proof(request);
  assert.deepEqual(windowsTerminalProcessResult(value, request), value);
  for (const change of [{ requestId: randomUUID() }, { processId: 322 }, { birth: "133000000000000002" }, { image: { ...image(), inode: "9007199254740992" } }, { image: { ...image(), path: image().path.toLowerCase() } }, { currentUserVerified: false }, { currentSessionVerified: false }, { processAccessMask: 0x1fffff }, { tokenAccessMask: 10 }, { processTerminated: true }, { windowFocused: true }, { taskAttached: true }, { accountVerified: true }, { raw: "NEVER_RETAIN" }]) assert.throws(() => windowsTerminalProcessResult({ ...value, ...change }, request));
  for (const key of Object.keys(value)) { const changed = { ...value }; delete changed[key]; assert.throws(() => windowsTerminalProcessResult(changed, request)); }
});

function fixture(t, options = {}) {
  const scopes = [], calls = []; let exited = true;
  const command = async (exe, args, config) => {
    calls.push({ exe, args, config }); const request = JSON.parse(config.inputText);
    assert.deepEqual(args, ["--editor-terminal-process-v1"]); assert.equal(config.expectedExecutableSha256, "b".repeat(64));
    const scope = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: "windows-job" }; scopes.push(scope);
    await config.onGuardianReady(scope); await options.afterReady?.();
    return { status: "completed", exitCode: 0, treeExitVerified: true, inputDelivered: true, stdout: JSON.stringify(options.proof ? options.proof(proof(request)) : proof(request)) };
  };
  const service = createWindowsTerminalProcessProbe({ platform: "win32", helper: async () => ({ path: process.execPath, sha256: "b".repeat(64) }), command, guardianStopped: async scope => { assert.deepEqual(scope, scopes.find(row => row.id === scope.id)); return exited; },
    ...(options.onIntent ? { onIntent: options.onIntent } : {}), ...(options.onOwner ? { onOwner: options.onOwner } : {}), ...(options.onRetired ? { onRetired: options.onRetired } : {}), ...(options.onNotStarted ? { onNotStarted: options.onNotStarted } : {}) });
  t.after(async () => { exited = true; assert.equal((await service.close()).stoppedVerified, true); });
  return { service, calls, context: { signal: new AbortController().signal, assertCurrent: async () => {} }, exited: v => { exited = v; } };
}

test("the native probe rechecks context and independently retires its helper before returning metadata", async t => {
  const f = fixture(t); let checks = 0;
  const first = await f.service.inspect(input(), { ...f.context, assertCurrent: async () => { checks++; } });
  assert.ok(checks >= 4); assert.equal(first.processId, 321); assert.equal(first.taskAttached, false); assert.equal(first.accountVerified, false);
  const second = await f.service.inspect({ ...input(), expectedBirth: first.birth }, f.context);
  assert.notEqual(first.requestId, second.requestId); assert.equal(second.birth, first.birth); assert.equal(f.calls.length, 2);
  assert.equal((await f.service.close()).targetProcessTerminated, false);
  assert.throws(() => f.service.inspect(input(), f.context));
});

test("changed context, proof substitution and uncertain exit cannot return evidence or replace an original helper", async t => {
  const wrong = fixture(t, { proof: p => ({ ...p, tokenAccessMask: 10 }) }); await assert.rejects(wrong.service.inspect(input(), wrong.context));
  const stale = fixture(t, { afterReady: async () => { active = false; } }); let active = true;
  await assert.rejects(stale.service.inspect(input(), { ...stale.context, assertCurrent: async () => { assert.ok(active); } }));
  const unknown = fixture(t); unknown.exited(false);
  await assert.rejects(unknown.service.inspect(input(), unknown.context));
  assert.throws(() => unknown.service.inspect(input(), unknown.context)); assert.equal(unknown.calls.length, 1);
  unknown.exited(true); assert.equal((await unknown.service.close()).stoppedVerified, true);
});

test("a synchronous context callback cannot re-enter the reserved process probe", async t => {
  const f = fixture(t); let checked = false;
  const observed = await f.service.inspect(input(), { ...f.context, assertCurrent: () => {
    if (!checked) { checked = true; assert.throws(() => f.service.inspect(input(), f.context)); assert.equal(f.calls.length, 0); }
  } });
  assert.ok(checked); assert.equal(observed.processId, 321); assert.equal(f.calls.length, 1);
});

test("Windows query ownership is retained before worker acknowledgement and retirement reports the same original helper", async t => {
  const records=[],f=fixture(t,{onIntent:async value=>records.push(['intent',value]),onOwner:async value=>{records.push(['owner',structuredClone(value)]);value.helper.sha256='changed callback copy';},afterReady:async()=>{assert.equal(records.length,2);},onRetired:async value=>records.push(['retired',value])});
  await f.service.inspect(input(),f.context);assert.deepEqual(records.map(r=>r[0]),['intent','owner','retired']);assert.deepEqual(records[1][1],records[2][1]);assert.equal(records[0][1].requestId,records[1][1].requestId);
  const owner=records[1][1];assert.equal(owner.schema,'switchyard-windows-query-owner/v1');assert.equal(owner.role,'process');assert.equal(owner.scope.containment,'windows-job');assert.equal(owner.helper.sha256,'b'.repeat(64));
  assert.deepEqual(Object.keys(owner).sort(),['helper','requestId','role','schema','scope']);
});

test('a held Windows query startup intent is retained before any command and can verify that no helper started',async t=>{
  let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r),records=[];
  const f=fixture(t,{onIntent:async intent=>{records.push(['intent',intent]);enter();await held;},onNotStarted:async intent=>records.push(['not-started',intent])}),abort=new AbortController();
  const pending=f.service.inspect(input(),{...f.context,signal:abort.signal}),refused=assert.rejects(pending);await entered;assert.equal(f.calls.length,0);abort.abort();let closed=false;const closing=f.service.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);
  release();await refused;await closing;assert.equal(f.calls.length,0);assert.deepEqual(records.map(r=>r[0]),['intent','not-started']);assert.deepEqual(records[0][1],records[1][1]);
});

test('a spawned query with no observed guardian scope cannot masquerade as an unstarted helper',async t=>{
  let child,notStarted=0;
  const service=createWindowsTerminalProcessProbe({platform:'win32',helper:async()=>({path:process.execPath,sha256:'b'.repeat(64)}),onNotStarted:async()=>{notStarted++;},
    command:async(_exe,_args,options)=>{child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});options.onGuardianChild(child);throw Error('synthetic interruption before guardian readiness');}});
  t.after(async()=>{if(child)assert.equal((await stopOwnedChild(child)).stopped,true);await assert.rejects(service.close());});
  await assert.rejects(service.inspect(input(),{assertCurrent:async()=>{},signal:new AbortController().signal}));assert.equal(notStarted,0);assert.throws(()=>service.inspect(input(),{assertCurrent:async()=>{},signal:new AbortController().signal}));await assert.rejects(service.close());
});

test("Windows query ownership callbacks remain joined during cancellation and failed retirement stays uncertain", async t => {
  let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r);let retired=false;
  const f=fixture(t,{onOwner:async()=>{enter();await held;},onRetired:async()=>{retired=true;}}),abort=new AbortController();
  const pending=f.service.inspect(input(),{...f.context,signal:abort.signal}),refused=assert.rejects(pending);await entered;abort.abort();let closed=false;const closing=f.service.close().then(()=>{closed=true;});
  await new Promise(r=>setImmediate(r));assert.equal(closed,false);release();await refused;await closing;assert.equal(retired,true);
  let fail=true;const g=fixture(t,{onRetired:async()=>{if(fail)throw Error('retirement checkpoint refused');}});await assert.rejects(g.service.inspect(input(),g.context));assert.throws(()=>g.service.inspect(input(),g.context));fail=false;await g.service.close();
  let started=false;const h=fixture(t,{onOwner:async()=>{throw Error('ownership checkpoint refused');},afterReady:async()=>{started=true;}});await assert.rejects(h.service.inspect(input(),h.context));assert.equal(started,false);await h.service.close();
});

test("cancellation joins held context reads and platform/input refusal precedes helper startup", async t => {
  let nativeCalls = 0;
  const unavailable = createWindowsTerminalProcessProbe({ platform: "linux", helper: async () => { nativeCalls++; } });
  assert.throws(() => unavailable.inspect(input(), { signal: new AbortController().signal, assertCurrent: async () => {} })); assert.equal(nativeCalls, 0); await unavailable.close();
  let enter, release; const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
  const f = fixture(t), controller = new AbortController(); let settled = false;
  const operation = assert.rejects(f.service.inspect(input(), { signal: controller.signal, assertCurrent: async () => { enter(); await held; } })).then(() => { settled = true; });
  await entered; controller.abort(); const closing = f.service.close(); await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false); release(); await operation; await closing; assert.equal(f.calls.length, 0);
});

test("actual Windows terminal query binds a synthetic process and refuses changed birth, image hash and exited PID", { skip: process.platform !== "win32" }, async t => {
  const executable = await realpath(process.execPath), stat = await lstat(executable, { bigint: true }), digest = b => createHash("sha256").update(b).digest("hex");
  const nativeImage = { path: executable, sha256: digest(await readFile(executable)), device: String(stat.dev), inode: String(stat.ino), size: String(stat.size) };
  const helper = resolve("runtime/hotkeys/Switchyard.Hotkeys.exe"), helperSha256 = digest(await readFile(helper));
  const child = spawn(executable, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  const service = createWindowsTerminalProcessProbe({ helper: async () => ({ path: helper, sha256: helperSha256 }) });
  t.after(async () => { try { await service.close(); } finally { assert.equal((await stopOwnedChild(child)).stopped, true); } });
  const context = { signal: new AbortController().signal, assertCurrent: async () => {} }, selected = { processId: child.pid, expectedBirth: null, image: nativeImage };
  const first = await service.inspect(selected, context); assert.equal(first.processId, child.pid); assert.equal(first.tokenAccessMask, 8); assert.equal(first.taskAttached, false);
  assert.equal((await service.inspect({ ...selected, expectedBirth: first.birth }, context)).birth, first.birth);
  await assert.rejects(service.inspect({ ...selected, expectedBirth: "1" }, context));
  await assert.rejects(service.inspect({ ...selected, image: { ...nativeImage, sha256: "0".repeat(64) } }, context));
  assert.equal((await stopOwnedChild(child)).stopped, true); await assert.rejects(service.inspect({ ...selected, expectedBirth: first.birth }, context));
});
