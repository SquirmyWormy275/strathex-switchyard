import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readCodexDaemonThreads, readExactCodexDaemonThread, readCodexDaemonAccount, startCodexDaemonThread, persistBoundCodexThread, readBoundCodexThreads } = require("../apps/vscode-extension/src/codex-daemon-status.cjs");

function textFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  return Buffer.concat([payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]), payload]);
}

test("daemon inventory, exact thread scope and local login metadata keep bounded contracts and partial creation identity", { skip: process.platform === "win32" ? "Unix Codex control socket is Linux-only" : false }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-codex-daemon-"));
  const path = join(directory, "control.sock");
  const methods = [];
  let rejectInjection = false;
  const upgradedSockets = new Set();
  const server = createServer();
  server.on("upgrade", (request, socket) => {
    upgradedSockets.add(socket);
    socket.on("close", () => upgradedSockets.delete(socket));
    const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 6) {
        const size = pending[1] & 0x7f;
        const offset = size === 126 ? 8 : 6;
        const length = size === 126 ? pending.readUInt16BE(2) : size;
        if (pending.length < offset + length) return;
        const mask = pending.subarray(offset - 4, offset);
        const payload = Buffer.from(pending.subarray(offset, offset + length));
        pending = pending.subarray(offset + length);
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
        const message = JSON.parse(payload.toString("utf8"));
        methods.push(message.method);
        if (message.method === "initialize") socket.write(textFrame({ id: 1, result: { userAgent: "fixture" } }));
        else if (message.method === "thread/list") socket.write(textFrame({ id: 2, result: { data: [
          { id: "exact-active", name: "private title", status: { type: "active", activeFlags: [] } },
          { id: "exact-stored", preview: "private prompt", status: { type: "notLoaded" } }
        ], nextCursor: null } }));
        else if (message.method === "thread/start") { if (rejectInjection) { assert.equal(message.params.sandbox, "read-only"); assert.equal(message.params.approvalPolicy, "on-request"); } socket.write(textFrame({ id: 2, result: { thread: { id: "created-thread", cwd: message.params.cwd } } })); }
        else if (message.method === "thread/read") socket.write(textFrame({ id: 2, result: { thread: { id: message.params.threadId, cwd: "/exact/repository", status: { type: "idle" } } } }));
        else if (message.method === "account/read") { assert.equal(message.params.refreshToken, false); socket.write(textFrame({ id: 2, result: { account: { type: "chatgpt", email: "synthetic@example.invalid" } } })); }
        else if (message.method === "thread/inject_items") {
          assert.equal(message.params.threadId, "created-thread");
          assert.match(message.params.items[0].content[0].text, /task-7.*No user request/);
          socket.write(textFrame(rejectInjection ? { id: 3, error: { message: "Synthetic metadata persistence failure" } } : { id: 3, result: {} }));
        }
      }
    });
  });
  try {
    await new Promise((resolve) => server.listen(path, resolve));
    await chmod(path, 0o600);
    assert.deepEqual(await readCodexDaemonThreads(path), [
      { id: "exact-active", observation: "active" },
      { id: "exact-stored", observation: "not-observed" }
    ]);
    assert.deepEqual(methods, ["initialize", "initialized", "thread/list"]);
    assert.deepEqual(await startCodexDaemonThread(path, "/exact/repository", "task-7"), { threadId: "created-thread" });
    assert.deepEqual(methods, ["initialize", "initialized", "thread/list", "initialize", "initialized", "thread/start", "thread/inject_items"]);
    assert.deepEqual(await readExactCodexDaemonThread(path, "created-thread"), { id: "created-thread", observation: "idle" });
    assert.deepEqual(methods.slice(-3), ["initialize", "initialized", "thread/read"]);
    assert.equal((await readExactCodexDaemonThread(path, "created-thread", { expectedRepositoryRoot: "/exact/repository" })).repositoryRoot, "/exact/repository");
    await assert.rejects(readExactCodexDaemonThread(path, "created-thread", { expectedRepositoryRoot: "/other/repository" }), /different or unverified repository/);
    const account = await readCodexDaemonAccount(path); assert.equal(account.type, "chatgpt"); assert.match(account.fingerprint, /^[a-f0-9]{64}$/); assert.equal(account.organizationVerified, false); assert.equal(JSON.stringify(account).includes("synthetic@"), false);
    rejectInjection = true;
    await assert.rejects(startCodexDaemonThread(path, "/exact/repository", "task-7", { readOnly: true }), (error) => error.createdThreadId === "created-thread" && /did not persist/.test(error.message));
  } finally {
    for (const socket of upgradedSockets) socket.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("exact Codex thread bindings persist privately without capability claims", { skip: process.platform === "win32" ? "Private Unix file mode is Linux-only" : false }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-codex-bindings-"));
  const binding = {
    threadId: "thread-exact", taskId: "task-switchyard", sessionId: "session:thread-exact",
    repositoryRoot: "/exact/repository", targetSnapshotId: "a".repeat(64), createdAt: "2026-10-27T00:00:00.000Z"
  };
  try {
    assert.deepEqual(await persistBoundCodexThread(binding, directory), binding);
    assert.deepEqual(await readBoundCodexThreads(directory), [binding]);
    await assert.rejects(() => persistBoundCodexThread(binding, directory), /EEXIST/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
