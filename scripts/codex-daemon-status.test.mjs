import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readCodexDaemonThreads, readExactCodexDaemonThread, startCodexDaemonThread, persistBoundCodexThread, readBoundCodexThreads } = require("../apps/vscode-extension/src/codex-daemon-status.cjs");

function textFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  return Buffer.concat([payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]), payload]);
}

test("live daemon observer performs only handshake and bounded thread/list", { skip: process.platform === "win32" ? "Unix Codex control socket is Linux-only" : false }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-codex-daemon-"));
  const path = join(directory, "control.sock");
  const methods = [];
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
        else if (message.method === "thread/start") socket.write(textFrame({ id: 2, result: { thread: { id: "created-thread", cwd: message.params.cwd } } }));
        else if (message.method === "thread/read") socket.write(textFrame({ id: 2, result: { thread: { id: message.params.threadId, status: { type: "idle" } } } }));
        else if (message.method === "thread/inject_items") {
          assert.equal(message.params.threadId, "created-thread");
          assert.match(message.params.items[0].content[0].text, /task-7.*No user request/);
          socket.write(textFrame({ id: 3, result: {} }));
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
