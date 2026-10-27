/** Read-only live status from an already-running, same-user Codex App Server. */
const { createHash, randomBytes } = require("node:crypto");
const { stat } = require("node:fs/promises");
const { platform, userInfo } = require("node:os");
const { isAbsolute } = require("node:path");
const { request } = require("node:http");

const maxBytes = 1024 * 1024;
const defaultDeadlineMs = 8_000;
const threadListRequest = Object.freeze({ id: 2, method: "thread/list", params: { limit: 25, sortKey: "recency_at", sourceKinds: ["cli", "vscode", "appServer"] } });

function normalizeThreadList(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.data) || value.data.length > 25) throw new Error("Codex returned an invalid bounded thread list.");
  return value.data.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id)) throw new Error("Codex returned an invalid thread identity.");
    const status = entry.status;
    let observation = "unknown";
    if (status?.type === "notLoaded") observation = "not-observed";
    else if (status?.type === "idle") observation = "idle";
    else if (status?.type === "systemError") observation = "error";
    else if (status?.type === "active") observation = Array.isArray(status.activeFlags) && status.activeFlags.includes("waitingOnApproval") ? "waiting-on-approval" : "active";
    return Object.freeze({ id: entry.id, observation });
  });
}

function encodeFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length > 65_535) throw new Error("Codex request exceeds the bounded frame size.");
  const mask = randomBytes(4);
  const header = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length, ...mask])
    : Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 0xff, ...mask]);
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([header, masked]);
}

async function readCodexDaemonThreads(socketPath, { deadlineMs = defaultDeadlineMs } = {}) {
  if (platform() === "win32") throw new Error("The local Codex Unix socket is unavailable on Windows.");
  if (typeof socketPath !== "string" || !isAbsolute(socketPath) || /[\0\r\n]/.test(socketPath)) throw new Error("Codex socket path must be absolute.");
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 30_000) throw new Error("Codex observation deadline is invalid.");
  const socket = await stat(socketPath);
  if (!socket.isSocket() || socket.uid !== userInfo().uid || (socket.mode & 0o077) !== 0) throw new Error("Codex socket is not a private current-user socket.");
  const key = randomBytes(16).toString("base64");
  return new Promise((resolve, reject) => {
    let settled = false;
    let upgraded = false;
    let phase = "initialize";
    let received = Buffer.alloc(0);
    let connection;
    const timeout = setTimeout(() => finish(new Error("Codex daemon observation timed out.")), deadlineMs);
    const upgrade = request({
      socketPath, path: "/", method: "GET",
      headers: { Host: "localhost", Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13" }
    });
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      connection?.destroy();
      upgrade.destroy();
      if (error) reject(error); else resolve(result);
    }
    function send(value) { connection.write(encodeFrame(value)); }
    function message(data) {
      let value;
      try { value = JSON.parse(data.toString("utf8")); } catch { finish(new Error("Codex daemon returned malformed JSON.")); return; }
      if (phase === "initialize" && value.id === 1) {
        if (value.error || !value.result) { finish(new Error("Codex daemon initialization was unavailable.")); return; }
        phase = "list";
        send({ method: "initialized", params: {} });
        send(threadListRequest);
      } else if (phase === "list" && value.id === 2) {
        if (value.error) { finish(new Error("Codex daemon thread listing was unavailable.")); return; }
        try { finish(undefined, Object.freeze(normalizeThreadList(value.result))); }
        catch (error) { finish(error); }
      }
    }
    function accept(chunk) {
      if (settled) return;
      received = Buffer.concat([received, chunk]);
      if (received.length > maxBytes) { finish(new Error("Codex daemon response exceeded the bounded size.")); return; }
      while (received.length >= 2) {
        const first = received[0];
        const second = received[1];
        const opcode = first & 0x0f;
        if ((first & 0x70) !== 0 || (first & 0x80) === 0 || (second & 0x80) !== 0) { finish(new Error("Codex daemon returned an unsupported WebSocket frame.")); return; }
        let size = second & 0x7f;
        let offset = 2;
        if (size === 126) { if (received.length < 4) return; size = received.readUInt16BE(2); offset = 4; }
        if (size === 127 || size > maxBytes) { finish(new Error("Codex daemon frame exceeded the bounded size.")); return; }
        if (received.length < offset + size) return;
        const data = received.subarray(offset, offset + size);
        received = received.subarray(offset + size);
        if (opcode === 0x8) { finish(new Error("Codex daemon closed before the thread list arrived.")); return; }
        if (opcode === 0x9) { connection.write(Buffer.from([0x8a, 0x80, ...randomBytes(4)])); continue; }
        if (opcode === 0x1) message(data);
        else if (opcode !== 0xa) { finish(new Error("Codex daemon returned an unsupported WebSocket message.")); return; }
        if (settled) return;
      }
    }
    upgrade.on("upgrade", (response, socket, head) => {
      const expected = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      if (response.statusCode !== 101 || response.headers["sec-websocket-accept"] !== expected) { socket.destroy(); finish(new Error("Codex daemon WebSocket handshake failed.")); return; }
      upgraded = true;
      connection = socket;
      socket.on("data", accept);
      socket.on("error", () => finish(new Error("Codex daemon connection failed.")));
      socket.on("close", () => { if (!settled) finish(new Error("Codex daemon disconnected before the thread list arrived.")); });
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "sxsy_readonly_live_status", title: "Switchyard read-only live status", version: "0.1.0" } } });
      if (head.length) accept(head);
    });
    upgrade.on("response", (response) => { response.resume(); finish(new Error("Codex daemon did not accept a WebSocket connection.")); });
    upgrade.on("error", () => finish(new Error("Codex daemon socket could not be opened.")));
    upgrade.on("close", () => { if (!upgraded && !settled) finish(new Error("Codex daemon closed the transport before upgrade.")); });
    upgrade.end();
  });
}

module.exports = { readCodexDaemonThreads };
