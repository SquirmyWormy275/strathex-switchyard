import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chmod, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { codexDesignConfig } from "./agents.mjs";
import { createPinnedCodexUnixClient } from "./codex-unix-transport.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

const native = { skip: process.platform !== "linux" ? "Pinned Unix peer credentials require Linux" : false };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function birth(pid) { try { const text = await readFile(`/proc/${pid}/stat`, "utf8"), fields = text.slice(text.lastIndexOf(")") + 2).split(" "); return { value: fields[19], zombie: fields[0] === "Z" }; } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return null; throw error; } }
async function waitFor(fn) { const end = Date.now() + 5000; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error("The exact owned bridge checkpoint did not settle."); }
function frame(payload, { opcode = 1, final = true } = {}) { const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload)); return Buffer.concat([bytes.length < 126 ? Buffer.from([(final ? 128 : 0) | opcode, bytes.length]) : bytes.length < 65536 ? Buffer.from([(final ? 128 : 0) | opcode, 126, bytes.length >> 8, bytes.length & 255]) : (() => { const header = Buffer.alloc(10); header[0] = (final ? 128 : 0) | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(bytes.length), 2); return header; })(), bytes]); }
async function fixture(t, mode) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-codex-unix-")), path = join(root, "s"), sockets = new Set(), clients = [], owners = [], messages = [], pongs = [];
  const server = createServer(); let upgrades = 0;
  server.on("upgrade", (request, socket) => {
    upgrades++; sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error", () => {});
    const key = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${mode === "accept" ? "invalid" : key}\r\n\r\n`);
    let incoming = Buffer.alloc(0);
    socket.on("data", chunk => {
      incoming = Buffer.concat([incoming, chunk]);
      while (incoming.length >= 2) {
        assert.ok(incoming[1] & 128, "Every client WebSocket frame is masked"); let size = incoming[1] & 127, offset = 2;
        if (size === 126) { if (incoming.length < 4) return; size = incoming.readUInt16BE(2); offset = 4; }
        if (size === 127) { if (incoming.length < 10) return; size = Number(incoming.readBigUInt64BE(2)); offset = 10; }
        if (incoming.length < offset + 4 + size) return;
        const opcode = incoming[0] & 15, mask = incoming.subarray(offset, offset + 4), bytes = Buffer.from(incoming.subarray(offset + 4, offset + 4 + size)); incoming = incoming.subarray(offset + 4 + size);
        for (let i = 0; i < bytes.length; i++) bytes[i] ^= mask[i % 4];
        if (opcode === 10) { pongs.push(bytes.toString()); continue; }
        assert.equal(opcode, 1); const message = JSON.parse(bytes.toString()); messages.push(message);
        if (message.method === "initialize") {
          if (mode === "binary") socket.write(frame(Buffer.from("PRIVATE_UNSUPPORTED"), { opcode: 2 }));
          else if (mode === "reserved") socket.write(Buffer.from([0xc1, 2, 123, 125]));
          else if (mode === "masked") socket.write(Buffer.from([0x81, 0x80, 0, 0, 0, 0]));
          else if (mode === "oversized") { const header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(1048577n, 2); socket.write(header); }
          else if (mode === "continuation") socket.write(frame(Buffer.from("{}"), { opcode: 0 }));
          else socket.write(frame({ id: message.id, result: { userAgent: `${message.params.clientInfo.name}/0.166.0 (synthetic)` } }));
        } else if (message.method === "config/read") socket.write(frame({ id: message.id, result: { config: { ...codexDesignConfig(), mcp_servers: {} } } }));
        else if (message.method === "account/read") socket.write(frame({ id: message.id, result: { account: { type: "chatgpt", email: "synthetic@example.invalid" } } }));
        else if (message.method === "fixture/echo") {
          const payload = Buffer.from(JSON.stringify({ id: message.id, result: message.params })), split = Math.floor(payload.length / 2);
          socket.write(frame(payload.subarray(0, split), { final: false })); socket.write(frame(Buffer.from("fixed-ping"), { opcode: 9 })); socket.write(frame(payload.subarray(split), { opcode: 0 }));
        }
      }
    });
  });
  await new Promise(resolve => server.listen(path, resolve)); await chmod(path, 0o600);
  const socket = await lstat(path), binding = { socketPath: path, socketDevice: String(socket.dev), socketInode: String(socket.ino), peerPid: process.pid, peerBirth: (await birth(process.pid)).value, peerExecutableSha256: sha(await readFile(process.execPath)) };
  t.after(async () => { for (const owner of owners) { await stopOwnedChild(owner); } for (const client of clients) { client.close(); assert.equal((await stopOwnedChild(client.child)).stopped, true); } for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true }); });
  return { root, binding, messages, pongs, owners, upgrades: () => upgrades, client(change = {}) { const client = createPinnedCodexUnixClient(process.execPath, root, [], { ...binding, ...change }); clients.push(client); return client; }, send(value) { for (const socket of sockets) socket.write(frame(value)); } };
}

test("pinned transport refuses missing, network, aliased or malformed peer identities before a child can start", () => {
  const valid = { socketPath: "/private/s", socketDevice: "1", socketInode: "2", peerPid: 10, peerBirth: "100", peerExecutableSha256: "a".repeat(64) };
  for (const value of [null, {}, { ...valid, extra: true }, ...[{ socketPath: "ws://127.0.0.1:1" }, { socketPath: "/private/../s" }, { peerPid: 0 }, { peerBirth: 100 }, { peerExecutableSha256: "unknown" }, { socketInode: 1 }].map(change => ({ ...valid, ...change }))]) assert.throws(() => createPinnedCodexUnixClient("/fixed/codex", "/private", [], value), /socket|identity|peer|transport|owned Linux/);
});
test("real Unix peer credentials and pinned bytes carry restricted metadata plus large Unicode/fragmented messages and exact ping payloads", native, async t => {
  const f = await fixture(t), client = f.client(); await client.initialize(); assert.equal(client.restrictionsVerified, true); assert.equal(client.nativeVersion, "0.166.0"); await client.recheckAccount();
  const text = "日本語🙂\n".repeat(12000); assert.deepEqual(await client.request("fixture/echo", { text }), { text }); await waitFor(() => f.pongs.includes("fixed-ping"));
  assert.equal(f.upgrades(), 1); assert.equal(f.messages.some(m => m.method?.startsWith("thread/") || m.method?.startsWith("turn/")), false);
});
test("native account notifications cross the bridge and invalidate pinned requests without rebinding or replay", native, async t => {
  const f = await fixture(t), client = f.client(); await client.initialize(); const fingerprint = client.accountFingerprint;
  const result = client.request("fixture/wait", {}).catch(error => error); await waitFor(() => f.messages.some(m => m.method === "fixture/wait"));
  f.send({ method: "account/updated", params: { authMode: "chatgpt" } }); const failure = await result;
  assert.equal(failure.code, "ACCOUNT_UNCONFIRMED"); assert.equal(client.closed, true); assert.equal(client.restrictionsVerified, false); assert.equal(client.accountFingerprint, fingerprint); assert.equal(f.upgrades(), 1);
});
test("server tool approval requests remain denied across the streaming carrier", native, async t => {
  const f = await fixture(t), client = f.client(); await client.initialize();
  f.send({ id: 999, method: "item/commandExecution/requestApproval", params: { command: "PRIVATE_NEVER_EXECUTE" } });
  await waitFor(() => f.messages.some(m => m.id === 999)); assert.deepEqual(f.messages.find(m => m.id === 999), { id: 999, result: { decision: "cancel" } }); assert.equal(client.restrictionsVerified, true);
});
test("wrong kernel peer PID, birth, executable digest or socket inode sends no handshake or provider request", native, async t => {
  for (const change of [{ peerPid: process.pid + 1 }, { peerBirth: "1" }, { peerExecutableSha256: "0".repeat(64) }, { socketInode: "1" }]) { const f = await fixture(t), client = f.client(change); await assert.rejects(client.initialize(), /disconnected|closed/); assert.equal(f.upgrades(), 0); assert.deepEqual(f.messages, []); }
});
test("bad handshake, unsupported frames and excessive declared lengths close the connection without interpreting private data", native, async t => {
  for (const mode of ["accept", "binary", "reserved", "masked", "oversized", "continuation"]) { const f = await fixture(t, mode), client = f.client(); await assert.rejects(client.initialize(), /disconnected|closed/); assert.equal(client.closed, true); assert.equal(client.restrictionsVerified, undefined); assert.equal(f.messages.some(m => m.method === "account/read"), false); }
});
test("abrupt owner loss independently exits the direct bridge without leaving a provider process or global daemon", native, async t => {
  const f = await fixture(t), wrapper = `import{createPinnedCodexUnixClient}from${JSON.stringify(new URL("./codex-unix-transport.mjs", import.meta.url).href)};let text="";for await(const b of process.stdin)text+=b;const r=JSON.parse(text),c=createPinnedCodexUnixClient(process.execPath,r.root,[],r.binding);await c.initialize();console.log(JSON.stringify({pid:c.child.pid}));`;
  const owner = spawn(process.execPath, ["--input-type=module", "-e", wrapper], { stdio: ["pipe", "pipe", "ignore"] }); f.owners.push(owner); let output = ""; owner.stdout.on("data", bytes => { output += bytes; }); owner.stdin.end(JSON.stringify({ root: f.root, binding: f.binding }));
  const pid = await waitFor(() => { try { return JSON.parse(output).pid; } catch { return false; } }), original = await birth(pid); assert.ok(original && !original.zombie);
  const exited = new Promise(resolve => owner.once("close", resolve)); owner.kill("SIGKILL"); await exited;
  await waitFor(async () => { const current = await birth(pid); return !current || current.value === original.value && current.zombie; }); assert.equal(f.upgrades(), 1);
});
