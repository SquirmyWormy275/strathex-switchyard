import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, connect } from "node:net";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createWindowsTerminalProcessProbe, inspectWindowsTerminalSocket, windowsTerminalPeerQuery, windowsTerminalPeerResult } from "./windows-terminal-process.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

const input = () => ({ processId: 321, expectedBirth: "133000000000000001", image: { path: "C:\\Reviewed\\codex.exe", sha256: "a".repeat(64), device: "0", inode: "9007199254740993", size: "512" }, connection: { localAddress: "127.0.0.1", localPort: 50001, remoteAddress: "127.0.0.1", remotePort: 50002 } });
const query = () => ({ schema: "switchyard-editor-terminal-peer-query/v1", requestId: randomUUID(), ...input() });
const proof = r => ({ schema: "switchyard-editor-terminal-peer-result/v1", requestId: r.requestId, processId: r.processId, birth: r.expectedBirth, image: { ...r.image }, connection: { ...r.connection }, connectionVerified: true,
  currentUserVerified: true, currentSessionVerified: true, processAccessMask: 0x101000, tokenAccessMask: 8, processTerminated: false, windowFocused: false, taskAttached: false, accountVerified: false });

test("peer queries require an already observed birth and one exact IPv4 loopback tuple", () => {
  const original = query(), selected = windowsTerminalPeerQuery(original); original.connection.localPort++;
  assert.equal(selected.connection.localPort, 50001); assert.ok(Object.isFrozen(selected.connection));
  for (const change of [{ expectedBirth: null }, { expectedBirth: "0" }, { schema: "switchyard-editor-terminal-process-query/v1" }, { discoverPid: true }]) assert.throws(() => windowsTerminalPeerQuery({ ...query(), ...change }));
  for (const change of [{ localAddress: "localhost" }, { remoteAddress: "::1" }, { remoteAddress: "127.0.0.2" }, { localAddress: "0.0.0.0" }, { localPort: 0 }, { remotePort: 1023 }, { remotePort: 65536 }, { localPort: "50001" }, { remotePort: 50001 }, { localPort: 50001.5 }, { transport: "udp" }]) assert.throws(() => windowsTerminalPeerQuery({ ...query(), connection: { ...input().connection, ...change } }));
  for (const key of Object.keys(query())) { const value = query(); delete value[key]; assert.throws(() => windowsTerminalPeerQuery(value)); }
});

test("peer replies cannot substitute either endpoint, process proof, access or attachment claims", () => {
  const request = query(), value = proof(request); assert.deepEqual(windowsTerminalPeerResult(value, request), value);
  for (const change of [{ connectionVerified: false }, { processId: 322 }, { birth: "133000000000000002" }, { tokenAccessMask: 10 }, { taskAttached: true }, { schema: "switchyard-editor-terminal-process-result/v1" }, { rawTable: [] }]) assert.throws(() => windowsTerminalPeerResult({ ...value, ...change }, request));
  for (const change of [{ localPort: 50003 }, { remotePort: 50004 }, { localAddress: "127.0.0.2" }, { remoteAddress: "127.0.0.2" }, { pid: 321 }]) assert.throws(() => windowsTerminalPeerResult({ ...value, connection: { ...value.connection, ...change } }, request));
  for (const key of Object.keys(value)) { const changed = { ...value }; delete changed[key]; assert.throws(() => windowsTerminalPeerResult(changed, request)); }
});

test("peer inspection shares original process-helper ownership and refuses substituted proof or stale context", async t => {
  const scopes = []; let calls = 0, checks = 0, changeProof = false, active = true;
  const service = createWindowsTerminalProcessProbe({ platform: "win32", helper: async () => ({ path: process.execPath, sha256: "b".repeat(64) }),
    command: async (_, args, options) => {
      calls++; assert.deepEqual(args, ["--editor-terminal-peer-v1"]); assert.equal(options.timeout, 10000); assert.equal(options.maxOutputBytes, 16384); assert.equal(options.captureStderrBytes, 0); assert.equal(options.expectedExecutableSha256, "b".repeat(64));
      const scope = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 1234, birth: "1", containment: "windows-job" }; scopes.push(scope); await options.onGuardianReady(scope);
      const result = proof(JSON.parse(options.inputText)); if (changeProof) result.connection.localPort++;
      return { status: "completed", exitCode: 0, treeExitVerified: true, inputDelivered: true, stdout: JSON.stringify(result) };
    }, guardianStopped: async scope => { assert.deepEqual(scope, scopes.find(s => s.id === scope.id)); return true; } });
  t.after(() => service.close());
  const context = { signal: new AbortController().signal, assertCurrent: async () => { checks++; assert.ok(active); } };
  const result = await service.inspectPeer(input(), context); assert.equal(result.connectionVerified, true); assert.equal(result.taskAttached, false); assert.ok(checks >= 4);
  changeProof = true; await assert.rejects(service.inspectPeer(input(), context)); assert.equal(calls, 2);
  active = false; await assert.rejects(service.inspectPeer(input(), context)); assert.equal(calls, 2);
});

async function sockets(t) {
  const server = createServer(); let socket, client;
  t.after(async () => { socket?.destroy(); client?.destroy(); if (server.listening) await new Promise((res, rej) => server.close(error => error ? rej(error) : res())); });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const accepted = once(server, "connection", { signal: AbortSignal.timeout(5000) });
  client = connect({ host: "127.0.0.1", port: server.address().port }); const connected = once(client, "connect", { signal: AbortSignal.timeout(5000) }); [socket] = await accepted; await connected;
  return { socket, client };
}

test("a held real loopback socket supplies the tuple and remains caller-owned after inspection", async t => {
  const { socket, client } = await sockets(t), { connection: _, ...process } = input(); let checks = 0;
  const probe = { inspectPeer: async (selected, context) => {
    await context.assertCurrent(); assert.deepEqual(selected.connection, { localAddress: "127.0.0.1", localPort: client.localPort, remoteAddress: "127.0.0.1", remotePort: client.remotePort });
    return proof({ ...query(), ...selected });
  } };
  const value = await inspectWindowsTerminalSocket(probe, socket, process, { assertCurrent: async () => { checks++; }, signal: new AbortController().signal });
  assert.equal(value.connectionVerified, true); assert.ok(checks >= 3); assert.equal(socket.destroyed, false); assert.equal(client.destroyed, false);
  assert.equal(socket.listenerCount("close"), 0); assert.equal(socket.listenerCount("error"), 0);
});

test("closing the original socket aborts native observation and joins a held context callback", async t => {
  const { socket } = await sockets(t), { connection: _, ...process } = input(); let entered, release, calls = 0, observedSignal;
  const waiting = new Promise(r => { entered = r; }), held = new Promise(r => { release = r; });
  const probe = { inspectPeer: async (selected, context) => { observedSignal = context.signal; await context.assertCurrent(); return proof({ ...query(), ...selected }); } };
  let settled = false;
  const operation = assert.rejects(inspectWindowsTerminalSocket(probe, socket, process, { assertCurrent: async () => { if (++calls === 2) { entered(); await held; } }, signal: new AbortController().signal })).then(() => { settled = true; });
  await waiting; const closed = once(socket, "close"); socket.destroy(); await closed;
  assert.equal(observedSignal.aborted, true); assert.equal(settled, false); release(); await operation;
  assert.equal(socket.listenerCount("close"), 0); assert.equal(socket.listenerCount("error"), 0);
});

test("actual Windows peer evidence binds a live accepted socket to its exact client and refuses another PID or closed connection", { skip: process.platform !== "win32" }, async t => {
  const executable = await realpath(process.execPath), stat = await lstat(executable, { bigint: true }), digest = b => createHash("sha256").update(b).digest("hex");
  const image = { path: executable, sha256: digest(await readFile(executable)), device: String(stat.dev), inode: String(stat.ino), size: String(stat.size) };
  const helper = resolve("runtime/hotkeys/Switchyard.Hotkeys.exe"), helperSha256 = digest(await readFile(helper));
  const service = createWindowsTerminalProcessProbe({ helper: async () => ({ path: helper, sha256: helperSha256 }) }), server = createServer();
  let child, socket;
  t.after(async () => { try { await service.close(); } finally { socket?.destroy(); if (child) assert.equal((await stopOwnedChild(child)).stopped, true); if (server.listening) await new Promise((res, rej) => server.close(error => error ? rej(error) : res())); } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  try {
    const accepted = once(server, "connection", { signal: controller.signal });
    child = spawn(executable, ["-e", 'const s=require("node:net").connect({host:"127.0.0.1",port:Number(process.argv[1])});s.on("error",()=>process.exit(3));setInterval(()=>{},1000);', String(server.address().port)], { stdio: "ignore", windowsHide: true });
    [socket] = await accepted;
  } finally { clearTimeout(timer); }
  const context = { signal: new AbortController().signal, assertCurrent: async () => {} }, selected = { processId: child.pid, expectedBirth: null, image };
  const observed = await service.inspect(selected, context), connection = { localAddress: socket.remoteAddress, localPort: socket.remotePort, remoteAddress: socket.localAddress, remotePort: socket.localPort };
  const peer = { ...selected, expectedBirth: observed.birth, connection };
  assert.equal((await inspectWindowsTerminalSocket(service, socket, { ...selected, expectedBirth: observed.birth }, context)).connectionVerified, true);
  const parent = await service.inspect({ ...selected, processId: process.pid }, context);
  await assert.rejects(service.inspectPeer({ ...peer, processId: process.pid, expectedBirth: parent.birth }, context));
  await assert.rejects(service.inspectPeer({ ...peer, connection: { ...connection, localPort: connection.remotePort, remotePort: connection.localPort } }, context));
  const closed = once(socket, "close"); socket.destroy(); await closed;
  await assert.rejects(service.inspectPeer(peer, context));
});
