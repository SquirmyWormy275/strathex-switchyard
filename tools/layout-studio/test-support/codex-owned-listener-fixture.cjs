/** Explicit provider double, launched as Node's app-server script by the guardian. */
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto"), child = require("node:child_process");
const settings = JSON.parse(fs.readFileSync("fixture.json", "utf8"));
const endpoint = process.argv[process.argv.indexOf("--listen") + 1].slice("unix://".length);
const socketPath = path.join("/tmp", "codex-daemon-" + process.getuid(), crypto.createHash("sha256").update(endpoint).digest("hex"));
fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
const sockets = new Set(), server = http.createServer();
function frame(value) { const data = Buffer.from(JSON.stringify(value)); return Buffer.concat([data.length < 126 ? Buffer.from([129, data.length]) : Buffer.from([129, 126, data.length >> 8, data.length & 255]), data]); }
function send(value) { for (const socket of sockets) socket.write(frame(value)); }
server.on("upgrade", (request, socket) => {
  sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error", () => {});
  const accept = crypto.createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  let incoming = Buffer.alloc(0);
  socket.on("data", bytes => {
    incoming = Buffer.concat([incoming, bytes]);
    while (incoming.length >= 2) {
      if (!(incoming[1] & 128)) process.exit(4);
      let size = incoming[1] & 127, offset = 2;
      if (size === 126) { if (incoming.length < 4) return; size = incoming.readUInt16BE(2); offset = 4; }
      if (size === 127) process.exit(5);
      if (incoming.length < offset + 4 + size) return;
      const mask = incoming.subarray(offset, offset + 4), payload = Buffer.from(incoming.subarray(offset + 4, offset + 4 + size)); incoming = incoming.subarray(offset + 4 + size);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      const message = JSON.parse(payload.toString()); fs.appendFileSync("calls", message.method + "\n");
      let result;
      if (message.method === "initialize") result = { userAgent: message.params.clientInfo.name + "/0.166.0 (provider-double)" };
      if (message.method === "config/read") result = { config: settings.config };
      if (message.method === "account/read") result = { account: { type: "chatgpt", email: fs.readFileSync("account", "utf8") } };
      if (message.method === "fixture/echo") result = message.params;
      if (settings.repositoryRoot) {
        const thread = { id: message.params?.threadId || "synthetic-owned-task", cwd: settings.repositoryRoot, status: { type: "idle" }, turns: [] };
        if (message.method === "thread/list") result = { data: [thread] };
        if (message.method === "thread/read") result = { thread };
        if (["thread/start", "thread/resume"].includes(message.method)) result = { thread, cwd: settings.repositoryRoot, sandbox: { type: "readOnly" }, approvalPolicy: "on-request" };
        if (message.method === "thread/inject_items") result = {};
      }
      if (result) socket.write(frame({ id: message.id, result }));
    }
  });
});
server.listen(socketPath, () => { fs.chmodSync(socketPath, 0o600); const publish = () => fs.symlinkSync(socketPath, endpoint); if (settings.aliasDelayMs) setTimeout(publish, settings.aliasDelayMs); else publish(); fs.writeFileSync("started", String(process.pid)); });
fs.watchFile("account", { interval: 20 }, () => send({ method: "account/updated", params: { authMode: "chatgpt" } }));
if (settings.spawnChild) {
  const code = "import os,time;os.setpgid(0,0);open(" + JSON.stringify(path.join(process.cwd(), "child.pid")) + ",'w').write(str(os.getpid()));time.sleep(600)";
  child.spawn("/usr/bin/python3", ["-I", "-B", "-c", code], { stdio: "ignore" });
}
