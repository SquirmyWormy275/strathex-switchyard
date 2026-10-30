/** Bounded local thread status and explicit thread creation through the current-user Codex App Server. */
const { createHash, randomBytes } = require("node:crypto");
const { mkdir, lstat, open, readFile, readdir, stat } = require("node:fs/promises");
const { constants } = require("node:fs");
const { homedir, platform, userInfo } = require("node:os");
const { isAbsolute, join } = require("node:path");
const { request } = require("node:http");

const maxBytes = 1024 * 1024;
const defaultDeadlineMs = 8_000;
const maxBindings = 64;
const threadListRequest = Object.freeze({ id: 2, method: "thread/list", params: { limit: 25, sortKey: "recency_at", sourceKinds: ["cli", "vscode", "appServer", "unknown"] } });

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

async function requestCodexDaemon(socketPath, command, parseResult, { deadlineMs = defaultDeadlineMs, afterResult } = {}) {
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
    let parsedResult;
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
      if (error) {
        if (typeof parsedResult?.threadId === "string") error.createdThreadId = parsedResult.threadId;
        reject(error);
      } else resolve(result);
    }
    function send(value) { connection.write(encodeFrame(value)); }
    function message(data) {
      let value;
      try { value = JSON.parse(data.toString("utf8")); } catch { finish(new Error("Codex daemon returned malformed JSON.")); return; }
      if (phase === "initialize" && value.id === 1) {
        if (value.error || !value.result) { finish(new Error("Codex daemon initialization was unavailable.")); return; }
        phase = "list";
        send({ method: "initialized", params: {} });
        send(command);
      } else if (phase === "list" && value.id === 2) {
        if (value.error) { finish(new Error("Codex daemon request was unavailable.")); return; }
        try {
          parsedResult = parseResult(value.result);
          if (afterResult) {
            const followup = afterResult(parsedResult);
            if (!followup || followup.id !== 3) throw new Error("Codex daemon follow-up request was invalid.");
            phase = "followup";
            send(followup);
          } else finish(undefined, parsedResult);
        }
        catch (error) { finish(error); }
      } else if (phase === "followup" && value.id === 3) {
        if (value.error) { finish(new Error("Codex did not persist the task-bound thread.")); return; }
        finish(undefined, parsedResult);
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
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "sxsy_local_codex_integration", title: "Switchyard local Codex integration", version: "0.1.0" } } });
      if (head.length) accept(head);
    });
    upgrade.on("response", (response) => { response.resume(); finish(new Error("Codex daemon did not accept a WebSocket connection.")); });
    upgrade.on("error", () => finish(new Error("Codex daemon socket could not be opened.")));
    upgrade.on("close", () => { if (!upgraded && !settled) finish(new Error("Codex daemon closed the transport before upgrade.")); });
    upgrade.end();
  });
}

async function readCodexDaemonThreads(socketPath, options = {}) {
  return requestCodexDaemon(socketPath, threadListRequest, (result) => Object.freeze(normalizeThreadList(result)), options);
}

async function readExactCodexDaemonThread(socketPath, threadId, options = {}) {
  if (typeof threadId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) throw new Error("Codex thread ID is invalid.");
  if (options.expectedRepositoryRoot !== undefined && (typeof options.expectedRepositoryRoot !== "string" || !isAbsolute(options.expectedRepositoryRoot) || /[\0\r\n]/.test(options.expectedRepositoryRoot) || options.expectedRepositoryRoot.length > 4096)) throw new Error("The expected Codex repository root is invalid.");
  return requestCodexDaemon(socketPath, { id: 2, method: "thread/read", params: { threadId, includeTurns: false } }, (result) => {
    if (result?.thread?.id !== threadId) throw new Error("Codex returned a different exact thread identity.");
    if (options.expectedRepositoryRoot !== undefined && result.thread.cwd !== options.expectedRepositoryRoot) throw new Error("The exact Codex thread belongs to a different or unverified repository root.");
    return Object.freeze({ ...normalizeThreadList({ data: [result.thread] })[0], ...(options.expectedRepositoryRoot === undefined ? {} : { repositoryRoot: options.expectedRepositoryRoot }) });
  }, options);
}

async function readCodexDaemonAccount(socketPath, options = {}) {
  return requestCodexDaemon(socketPath, { id: 2, method: "account/read", params: { refreshToken: false } }, (result) => {
    const account = result?.account;
    if (account == null) return Object.freeze({ type: "unavailable", fingerprint: null, organizationVerified: false });
    if (!["chatgpt", "apiKey", "amazonBedrock", "gcp"].includes(account.type)) throw new Error("The Codex runtime account contract is unsupported.");
    // An email fingerprint identifies this local login, never its organization.
    // The API-key contract provides no account ID, so it cannot be guessed.
    const identified = account.type === "chatgpt" && typeof account.email === "string" && account.email.length > 0 && account.email.length <= 320 && !/[\0\r\n]/.test(account.email);
    return Object.freeze({ type: account.type, fingerprint: identified ? createHash("sha256").update(JSON.stringify([account.type, account.email.trim().toLowerCase()])).digest("hex") : null, organizationVerified: false });
  }, options);
}

async function resumeExactCodexDaemonThread(socketPath, threadId, repositoryRoot, options = {}) {
  if (typeof threadId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(threadId) || typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot) || repositoryRoot.length > 4096 || /[\0\r\n]/.test(repositoryRoot)) throw new Error("An exact thread and repository root are required for Codex resume.");
  return requestCodexDaemon(socketPath, { id: 2, method: "thread/resume", params: { threadId, excludeTurns: true, sandbox: "read-only", approvalPolicy: "on-request" } }, (result) => {
    if (result?.thread?.id !== threadId || result.thread.cwd !== repositoryRoot || result.cwd !== repositoryRoot || result.sandbox?.type !== "readOnly" || result.approvalPolicy !== "on-request") throw new Error("Codex resume did not verify the exact directory/thread and read-only permissions.");
    return Object.freeze({ ...normalizeThreadList({ data: [result.thread] })[0], repositoryRoot, permissions: "read-only/on-request", modelPromptSubmitted: false });
  }, options);
}

async function startCodexDaemonThread(socketPath, repositoryRoot, taskId, options = {}) {
  if (typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot) || /[\0\r\n]/.test(repositoryRoot) || repositoryRoot.length > 4096) {
    throw new Error("Codex thread requires an exact absolute repository root.");
  }
  if (typeof taskId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(taskId)) throw new Error("Codex thread requires a bounded task ID.");
  return requestCodexDaemon(socketPath, {
    id: 2, method: "thread/start", params: { cwd: repositoryRoot, serviceName: "strathex-switchyard", ...(options.readOnly ? { sandbox: "read-only", approvalPolicy: "on-request" } : {}) }
  }, (result) => {
    const thread = result?.thread;
    if (!thread || typeof thread.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(thread.id)
      || (thread.cwd !== undefined && thread.cwd !== repositoryRoot)) {
      throw new Error("Codex did not return an exact started thread identity.");
    }
    return Object.freeze({ threadId: thread.id });
  }, {
    ...options,
    afterResult: ({ threadId }) => ({
      id: 3, method: "thread/inject_items", params: {
        threadId,
        items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: `Switchyard task binding: ${taskId}. No user request has been submitted. Await the operator's instructions.` }] }]
      }
    })
  });
}

function exactBinding(value) {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== ["createdAt", "repositoryRoot", "sessionId", "targetSnapshotId", "taskId", "threadId"].join(",")) {
    throw new Error("The local Codex thread binding is malformed.");
  }
  if (![value.threadId, value.taskId, value.sessionId].every((item) => typeof item === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(item))
    || typeof value.repositoryRoot !== "string" || !isAbsolute(value.repositoryRoot) || /[\0\r\n]/.test(value.repositoryRoot) || value.repositoryRoot.length > 4096
    || (value.targetSnapshotId !== null && (typeof value.targetSnapshotId !== "string" || !/^[a-f0-9]{64}$/.test(value.targetSnapshotId)))
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error("The local Codex thread binding is invalid.");
  }
  return Object.freeze({ threadId: value.threadId, taskId: value.taskId, sessionId: value.sessionId,
    repositoryRoot: value.repositoryRoot, targetSnapshotId: value.targetSnapshotId, createdAt: value.createdAt });
}

function defaultBindingDirectory() {
  const state = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  if (!isAbsolute(state) || /[\0\r\n]/.test(state)) throw new Error("The local Codex binding state root is invalid.");
  return join(state, "strathex-switchyard", "codex-bound-threads");
}

async function privateDirectory(directory, create) {
  if (typeof directory !== "string" || !isAbsolute(directory) || /[\0\r\n]/.test(directory)) throw new Error("Codex binding directory must be absolute.");
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const details = await lstat(directory);
  if (!details.isDirectory() || details.uid !== userInfo().uid || (details.mode & 0o077) !== 0) throw new Error("Codex binding directory is not private to the current user.");
}

async function persistBoundCodexThread(value, directory = defaultBindingDirectory()) {
  const binding = exactBinding(value);
  await privateDirectory(directory, true);
  const names = await readdir(directory);
  if (names.filter((name) => name.endsWith(".json")).length >= maxBindings) throw new Error("The local Codex binding limit is reached.");
  const path = join(directory, `${binding.threadId}.json`);
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(binding)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  return binding;
}

async function readBoundCodexThreads(directory = defaultBindingDirectory()) {
  try { await privateDirectory(directory, false); }
  catch (error) { if (error?.code === "ENOENT") return Object.freeze([]); throw error; }
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  if (names.length > maxBindings) throw new Error("The local Codex binding store exceeded its bounded entry count.");
  const result = [];
  for (const name of names) {
    if (!/^[A-Za-z0-9_-]{1,128}\.json$/.test(name)) throw new Error("The local Codex binding filename is invalid.");
    const path = join(directory, name);
    const details = await lstat(path);
    if (!details.isFile() || details.uid !== userInfo().uid || (details.mode & 0o077) !== 0 || details.size > 8_192) throw new Error("The local Codex binding file is not private and bounded.");
    const binding = exactBinding(JSON.parse(await readFile(path, "utf8")));
    if (`${binding.threadId}.json` !== name) throw new Error("The local Codex binding filename and thread identity differ.");
    result.push(binding);
  }
  return Object.freeze(result);
}

module.exports = { readCodexDaemonThreads, readExactCodexDaemonThread, readCodexDaemonAccount, resumeExactCodexDaemonThread, startCodexDaemonThread, persistBoundCodexThread, readBoundCodexThreads };
