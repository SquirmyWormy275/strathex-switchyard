import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { connect } from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { openWindowsEditorIngress } from "./windows-editor-ingress.mjs";
import { createWindowsTerminalProcessProbe } from "./windows-terminal-process.mjs";
import { editorServerFrame } from "./editor-websocket-frames.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const peer = () => ({ processId: 321, expectedBirth: "133000000000000001", image: { path: "C:\\Reviewed\\codex.exe", sha256: "a".repeat(64), device: "0", inode: "1", size: "512" } });
function clientFrame(value) {
  const bytes = Buffer.from(JSON.stringify(value)), frame = editorServerFrame(1, bytes), n = frame.length - bytes.length, header = Buffer.from(frame.subarray(0, n)), body = Buffer.from(bytes), mask = Buffer.from([3, 5, 7, 11]); header[1] |= 128;
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4]; return Buffer.concat([header, mask, body]);
}
async function fixture(t, options = {}) {
  const messages = [], ownership = [], received = deferred(); let probes = 0, stopped = false;
  const probe = { inspectPeer: async (selected, context) => {
    probes++; await context.assertCurrent(); await options.probe?.(selected);
    return { schema: "switchyard-editor-terminal-peer-result/v1", requestId: randomUUID(), processId: selected.processId, birth: selected.expectedBirth, image: { ...selected.image }, connection: { ...selected.connection }, connectionVerified: true, currentUserVerified: true, currentSessionVerified: true, processAccessMask: 0x101000, tokenAccessMask: 8, processTerminated: false, windowFocused: false, taskAttached: false, accountVerified: false };
  }, close: async () => { stopped = true; return { stoppedVerified: true }; } };
  const owner = await openWindowsEditorIngress({ requestId: randomUUID(), platform: "win32", probeFactory: () => probe, signal: new AbortController().signal,
    assertCurrent: options.assertCurrent ?? (async () => {}), onOwnership: async row => { ownership.push(row); }, onMessage: async value => { await options.onMessage?.(value); messages.push(value); received.resolve(); } });
  t.after(() => owner.stop());
  return { owner, messages, ownership, received, probes: () => probes, stopped: () => stopped };
}
async function client(t, owner, change = {}) {
  const endpoint = owner.privateEndpoint, url = new URL(endpoint.url), socket = connect({ host: "127.0.0.1", port: Number(url.port) });
  let bytes = Buffer.alloc(0), ended = false, waiting = deferred();
  socket.on("data", b => { bytes = Buffer.concat([bytes, b]); assert.ok(bytes.length <= 2 * 1048576); waiting.resolve(); });
  socket.on("error", () => { ended = true; waiting.resolve(); }); socket.on("close", () => { ended = true; waiting.resolve(); });
  t.after(() => socket.destroy()); await once(socket, "connect", { signal: AbortSignal.timeout(5000) });
  const wait = async () => { if (ended) throw Error("closed"); const active = waiting.promise; let timer; try { await Promise.race([active, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("read timeout")), 5000); })]); } finally { clearTimeout(timer); } waiting = deferred(); };
  const take = async n => { while (bytes.length < n) await wait(); const value = Buffer.from(bytes.subarray(0, n)); bytes = bytes.subarray(n); return value; };
  const key = Buffer.alloc(16, 7).toString("base64"), headers = { Host: url.host, Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13", Authorization: "Bearer " + endpoint.authToken, ...change };
  socket.write("GET / HTTP/1.1\r\n" + Object.entries(headers).map(([k, v]) => k + ": " + v).join("\r\n") + "\r\n\r\n");
  return { socket, async handshake() {
    while (!bytes.includes("\r\n\r\n")) await wait(); const text = (await take(bytes.indexOf("\r\n\r\n") + 4)).toString(); assert.match(text, /^HTTP\/1.1 101 /); assert.ok(text.includes(createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64"))); return text;
  }, async frame() { const h = await take(2); assert.equal(h[0], 0x81); assert.equal(h[1] & 0x80, 0); let n = h[1]; if (n === 126) n = (await take(2)).readUInt16BE(); else if (n === 127) n = Number((await take(8)).readBigUInt64BE()); assert.ok(n <= 1048576); return JSON.parse((await take(n)).toString()); } };
}

test("a real authenticated loopback exchange pins one peer and rechecks it for both message directions", async t => {
  const f = await fixture(t), pin = f.owner.pinPeer(peer()), c = await client(t, f.owner); await c.handshake(); const observed = await pin;
  assert.equal(observed.peerVerified, true); assert.equal(observed.ideAttached, false); assert.equal(observed.protocolAcknowledged, false);
  c.socket.write(clientFrame({ id: 1, method: "initialize" })); await f.received.promise;
  assert.deepEqual(f.messages, [{ id: 1, method: "initialize" }]); await f.owner.send({ id: 1, result: { ready: true } }); assert.deepEqual(await c.frame(), { id: 1, result: { ready: true } });
  assert.equal(f.probes(), 3); assert.throws(() => f.owner.pinPeer(peer()));
  const duplicate = connect({ host: "127.0.0.1", port: Number(new URL(f.owner.privateEndpoint.url).port) }); t.after(() => duplicate.destroy());
  await assert.rejects(once(duplicate, "connect", { signal: AbortSignal.timeout(5000) }));
  const token = f.owner.privateEndpoint.authToken; assert.equal(JSON.stringify(f.ownership).includes(token), false);
  assert.equal((await f.owner.stop()).helperExitVerified, true); assert.equal(f.stopped(), true); assert.equal(f.owner.observation().peerVerified, false);
  assert.equal(new Set(f.ownership.map(o => o.capabilitySha256)).size, 1); assert.throws(() => f.owner.privateEndpoint);
});

test("wrong capability or browser Origin retires the original listener before native peer observation", async t => {
  for (const change of [{ Authorization: "Bearer " + "x".repeat(43) }, { Origin: "https://example.invalid" }, { Host: "localhost" }, { "Sec-WebSocket-Extensions": "permessage-deflate" }]) {
    const f = await fixture(t), pin = assert.rejects(f.owner.pinPeer(peer())), c = await client(t, f.owner, change); await assert.rejects(c.handshake()); await pin; await f.owner.stop(); assert.equal(f.probes(), 0); assert.deepEqual(f.messages, []);
  }
});

test("changed peer evidence refuses the next message and closes the one-use connection", async t => {
  let allowed = true; const f = await fixture(t, { probe: () => { assert.ok(allowed); } }), pin = f.owner.pinPeer(peer()), c = await client(t, f.owner); await c.handshake(); await pin;
  allowed = false; c.socket.write(clientFrame({ id: 2, method: "NEVER_FORWARD" })); await f.owner.whenClosed; await f.owner.stop(); assert.deepEqual(f.messages, []); assert.equal(f.probes(), 2);
});

test("malformed or unmasked client frames close without forwarding any message", async t => {
  for (const payload of [editorServerFrame(1, Buffer.from('{}')), Buffer.from([0xc1, 0x80, 0, 0, 0, 0])]) {
    const f = await fixture(t), pin = f.owner.pinPeer(peer()), c = await client(t, f.owner); await c.handshake(); await pin;
    c.socket.write(payload); await f.owner.whenClosed; await f.owner.stop(); assert.deepEqual(f.messages, []); assert.equal(f.probes(), 1);
  }
});

test("stop aborts the socket and joins a pending consumer before accepting retirement", async t => {
  const entered = deferred(), held = deferred();
  const f = await fixture(t, { onMessage: async () => { entered.resolve(); await held.promise; } }), pin = f.owner.pinPeer(peer()), c = await client(t, f.owner); await c.handshake(); await pin;
  c.socket.write(clientFrame({ id: 1 })); await entered.promise; let stopped = false; const stopping = f.owner.stop().then(() => { stopped = true; });
  await new Promise(r => setImmediate(r)); assert.equal(stopped, false); held.resolve(); await stopping; assert.equal(stopped, true);
});

test("an unconfirmed native helper exit cannot become accepted carrier retirement", async () => {
  const states = [];
  const owner = await openWindowsEditorIngress({ requestId: randomUUID(), platform: "win32", signal: new AbortController().signal,
    assertCurrent: async () => {}, onMessage: async () => {}, onOwnership: async row => { states.push(row); },
    probeFactory: () => ({ close: async () => ({ stoppedVerified: false }) }) });
  await assert.rejects(owner.stop()); assert.equal(owner.closed, true); assert.equal(owner.privateOwnership.listenerClosed, true);
  assert.equal(states.some(row => row.phase === "stopped"), false); await assert.rejects(owner.stop());
});

test("actual Windows carrier authenticates an owned Node peer and completes a JSON round trip", { skip: process.platform !== "win32" }, async t => {
  const executable = await realpath(process.execPath), info = await lstat(executable, { bigint: true }), sha = b => createHash("sha256").update(b).digest("hex");
  const image = { path: executable, sha256: sha(await readFile(executable)), device: String(info.dev), inode: String(info.ino), size: String(info.size) };
  const helper = resolve("runtime/hotkeys/Switchyard.Hotkeys.exe"), helperSha256 = sha(await readFile(helper)), makeProbe = (callbacks={}) => createWindowsTerminalProcessProbe({ ...callbacks, helper: async () => ({ path: helper, sha256: helperSha256 }) });
  const query = makeProbe(), received = deferred(), queryRecords=[]; let owner, child;
  t.after(async () => { try { await owner?.stop(); await query.close(); } finally { if (child) assert.equal((await stopOwnedChild(child)).stopped, true); } });
  owner = await openWindowsEditorIngress({ requestId: randomUUID(), probeFactory: makeProbe, signal: new AbortController().signal, assertCurrent: async () => {}, onOwnership: async () => {},
    onQueryOwner:async value=>queryRecords.push(['owner',value]),onQueryRetired:async value=>queryRecords.push(['retired',value]),
    onMessage: async m => { assert.deepEqual(m, { id: 1 }); await owner.send({ id: 1, result: true }); received.resolve(); } });
  const endpoint = owner.privateEndpoint;
  const program = 'const net=require("node:net"),url=new URL(process.env.SWITCHYARD_TEST_URL),s=net.connect({host:"127.0.0.1",port:Number(url.port)});let b=Buffer.alloc(0),up=false;s.on("error",()=>process.exit(3));s.on("connect",()=>s.write("GET / HTTP/1.1\\r\\nHost: "+url.host+"\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Version: 13\\r\\nSec-WebSocket-Key: BwcHBwcHBwcHBwcHBwcHBw==\\r\\nAuthorization: Bearer "+process.env.SWITCHYARD_TEST_TOKEN+"\\r\\n\\r\\n"));s.on("data",x=>{b=Buffer.concat([b,x]);if(!up){const n=b.indexOf("\\r\\n\\r\\n");if(n<0)return;if(!b.toString().startsWith("HTTP/1.1 101 "))process.exit(4);up=true;b=b.subarray(n+4);const p=Buffer.from(JSON.stringify({id:1})),mask=Buffer.from([1,2,3,4]);for(let i=0;i<p.length;i++)p[i]^=mask[i%4];s.write(Buffer.concat([Buffer.from([129,128+p.length]),mask,p]));}if(up&&b.length>=2&&b.length>=2+b[1]){const v=JSON.parse(b.subarray(2,2+b[1]).toString());if(v.id!==1||v.result!==true)process.exit(5);b=b.subarray(2+b[1]);process.stdout.write("roundtrip\\n");}});setInterval(()=>{},1000);';
  child = spawn(executable, ["-e", program], { env: { ...process.env, SWITCHYARD_TEST_URL: endpoint.url, SWITCHYARD_TEST_TOKEN: endpoint.authToken }, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const completed = once(child.stdout, "data", { signal: AbortSignal.timeout(15000) });
  const observed = await query.inspect({ processId: child.pid, expectedBirth: null, image }, { assertCurrent: async () => {}, signal: new AbortController().signal });
  assert.equal((await owner.pinPeer({ processId: child.pid, expectedBirth: observed.birth, image })).peerVerified, true);
  await received.promise; assert.equal((await completed)[0].toString(), "roundtrip\n"); assert.equal(owner.observation().ideAttached, false);
  await owner.stop();assert.ok(queryRecords.length>=6);assert.equal(queryRecords.length%2,0);
  for(let i=0;i<queryRecords.length;i+=2){assert.equal(queryRecords[i][0],'owner');assert.equal(queryRecords[i+1][0],'retired');assert.deepEqual(queryRecords[i][1],queryRecords[i+1][1]);assert.equal(queryRecords[i][1].helper.sha256,helperSha256);}
  assert.equal(JSON.stringify(queryRecords).includes(endpoint.authToken),false);
});
