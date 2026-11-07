/** One capability-authenticated loopback peer. No provider, task or account authority. */
import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createWindowsTerminalProcessProbe, inspectWindowsTerminalSocket, windowsTerminalPeerQuery } from "./windows-terminal-process.mjs";
import { createEditorClientFrames, editorJsonObject, editorServerFrame, editorMessageBytes, editorBufferBytes } from "./editor-websocket-frames.mjs";

const require = value => { if (!value) throw Error("The original Windows editor connection did not verify."); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); void promise.catch(() => {}); return { promise, resolve, reject }; };

export async function openWindowsEditorIngress({ requestId, assertCurrent, onMessage, onOwnership, signal, platform = process.platform, probeFactory = createWindowsTerminalProcessProbe,
  onQueryOwner = async () => {}, onQueryRetired = async () => {} } = {}) {
  require(platform === "win32" && typeof requestId === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId));
  require([assertCurrent, onMessage, onOwnership, probeFactory, onQueryOwner, onQueryRetired].every(f => typeof f === "function") && signal instanceof AbortSignal);
  const probe = probeFactory({ onOwner: onQueryOwner, onRetired: onQueryRetired }), controller = new AbortController(), pinned = deferred(), admitted = deferred(), ended = deferred(), listenerEnded = deferred(), socketEnded = deferred();
  const frames = createEditorClientFrames(), operations = new Set(), capability = randomBytes(32);
  const capabilitySha256 = createHash("sha256").update(capability).digest("hex");
  let closed = false, phase = "reserved", socket, socketExited = false, endpoint, selected, peerAttempted = false, candidate = false, verified = false, listening = false, stopping, failure;
  let pump = Promise.resolve(), peerChecks = Promise.resolve(), queuedBytes = 0, queuedWrites = 0, timer;
  const server = createServer({ maxHeaderSize: 16384, headersTimeout: 8000, requestTimeout: 8000, keepAliveTimeout: 1000 });
  server.maxConnections = 1; server.maxHeadersCount = 32;
  const ownership = () => Object.freeze({ schema: "switchyard-windows-editor-ingress-owner/v1", requestId, phase, hostPid: process.pid, endpoint: endpoint ?? null, listenerClosed: !server.listening, socketClosed: socketExited || !candidate, capabilitySha256 });
  const live = () => require(!closed && !failure && !signal.aborted && !controller.signal.aborted);
  const current = async () => { live(); await assertCurrent(); live(); if (socket) require(!socket.destroyed && socket.readyState === "open"); };
  const verifyPeer = () => {
    const work = peerChecks.then(async () => { await current(); const result = await inspectWindowsTerminalSocket(probe, socket, selected, { assertCurrent: current, signal: controller.signal }); await current(); require(result.connectionVerified === true); });
    peerChecks = work.catch(() => {}); return work;
  };
  const track = fn => { require(operations.size < 64); const work = Promise.resolve().then(fn); operations.add(work); void work.then(() => operations.delete(work), () => operations.delete(work)); return work; };
  function fail() { failure ??= Error("The original Windows editor connection failed."); owner.close(); }
  const write = bytes => new Promise((resolve, reject) => {
    try { live(); require(socket && verified && !socket.destroyed && socket.writableLength + bytes.length <= 2 * editorBufferBytes); socket.write(bytes, error => error ? reject(Error("The editor connection write failed.")) : resolve()); }
    catch (error) { reject(error); }
  });
  const observe = () => Object.freeze({ schema: "switchyard-windows-editor-ingress-observation/v1", requestId, phase, peerVerified: verified && !closed, protocolAcknowledged: false, ideAttached: false, authorityGranted: false, completionVerified: false });
  const owner = Object.freeze({
    get closed() { return closed; }, whenClosed: ended.promise,
    get privateOwnership() { return ownership(); },
    get privateEndpoint() { live(); require(endpoint); return Object.freeze({ url: endpoint, authToken: capability.toString("base64url") }); },
    observation: observe,
    pinPeer(input) {
      require(!peerAttempted); peerAttempted = true;
      try {
        require(input && Object.keys(input).sort().join() === "expectedBirth,image,processId");
        const parsed = windowsTerminalPeerQuery({ schema: "switchyard-editor-terminal-peer-query/v1", requestId, ...input, connection: { localAddress: "127.0.0.1", localPort: 1024, remoteAddress: "127.0.0.1", remotePort: 1025 } });
        selected = Object.freeze({ processId: parsed.processId, expectedBirth: parsed.expectedBirth, image: parsed.image });
      } catch (error) { fail(); return Promise.reject(error); }
      return track(async () => { try { await current(); phase = "peer-requested"; await onOwnership(ownership()); await current(); pinned.resolve(); await admitted.promise; await current(); return observe(); } catch (error) { fail(); throw error; } });
    },
    send(message) {
      live(); require(verified && queuedWrites < 64 && operations.size < 64);
      const bytes = Buffer.from(JSON.stringify(message)); editorJsonObject(bytes); require(bytes.length <= editorMessageBytes && queuedBytes + bytes.length <= 2 * editorMessageBytes);
      queuedWrites++; queuedBytes += bytes.length;
      return track(async () => { try { await verifyPeer(); await write(editorServerFrame(1, bytes)); await current(); } catch (error) { fail(); throw error; } finally { queuedWrites--; queuedBytes -= bytes.length; bytes.fill(0); } });
    },
    close() {
      if (closed) return; closed = true; controller.abort(); clearTimeout(timer); signal.removeEventListener("abort", fail);
      admitted.reject(failure ?? Error("The editor connection stopped.")); pinned.reject(failure ?? Error("The editor connection stopped."));
      socket?.destroy(); if (server.listening) server.close(); else if (!listening) listenerEnded.resolve(); ended.resolve();
    },
    stop() {
      if (stopping) return stopping; owner.close();
      stopping = (async () => {
        await listenerEnded.promise; if (candidate) await socketEnded.promise; await Promise.allSettled([...operations]); await pump;
        const result = await probe.close(); require(result.stoppedVerified === true && !server.listening && (!socket || socketExited));
        frames.close(); capability.fill(0); phase = "stopped"; await onOwnership(ownership());
        return { stopped: true, listenerClosed: true, socketClosed: true, helperExitVerified: true, targetProcessTerminated: false };
      })(); return stopping;
    }
  });
  server.on("close", () => listenerEnded.resolve()); server.on("error", fail); server.on("clientError", fail); server.on("request", fail);
  server.on("connection", connected => {
    if (candidate || closed) { connected.destroy(); return; }
    candidate = true; socket = connected; connected.setNoDelay(true);
    connected.once("error", fail); connected.once("close", () => { socketExited = true; socketEnded.resolve(); if (!closed) fail(); });
    // No replacement connection, even if the first one authenticates badly.
    server.close();
  });
  server.on("upgrade", (request, connected, head) => {
    connected.pause();
    void track(async () => {
      try {
        await current(); require(connected === socket && request.method === "GET" && request.url === "/" && request.httpVersion === "1.1");
        const headers = new Map(); require(request.rawHeaders.length <= 64);
        for (let i = 0; i < request.rawHeaders.length; i += 2) { const name = request.rawHeaders[i].toLowerCase(); require(!headers.has(name)); headers.set(name, request.rawHeaders[i + 1]); }
        const key = headers.get("sec-websocket-key"), authorization = headers.get("authorization"), expected = "Bearer " + capability.toString("base64url");
        require(headers.get("host") === new URL(endpoint).host && headers.get("upgrade")?.toLowerCase() === "websocket" && headers.get("connection")?.toLowerCase().split(",").map(v => v.trim()).includes("upgrade") && headers.get("sec-websocket-version") === "13");
        require(typeof key === "string" && /^[A-Za-z0-9+/]{22}==$/.test(key) && Buffer.from(key, "base64").length === 16 && Buffer.from(key, "base64").toString("base64") === key);
        require(!["origin", "sec-websocket-extensions", "sec-websocket-protocol", "content-length", "transfer-encoding", "proxy-authorization"].some(k => headers.has(k)));
        require(typeof authorization === "string" && authorization.length === expected.length && timingSafeEqual(Buffer.from(authorization), Buffer.from(expected)));
        require(head.length <= editorBufferBytes); await pinned.promise; await current();
        await verifyPeer(); verified = true; phase = "connected";
        await onOwnership(ownership()); await current();
        const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        await write(Buffer.from("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n"));
        clearTimeout(timer); admitted.resolve();
        const consume = bytes => {
          connected.pause();
          pump = pump.then(async () => {
            await current(); frames.push(bytes);
            for (let event; (event = frames.next());) {
              await current();
              if (event.kind === "message") { await verifyPeer(); await onMessage(event.message); await current(); }
              else if (event.kind === "ping") await write(editorServerFrame(10, event.payload));
              else if (event.kind === "close") { await write(editorServerFrame(8, event.payload)); owner.close(); return; }
            }
            await current(); connected.resume();
          }).catch(fail);
        };
        connected.on("data", consume); if (head.length) consume(head); else connected.resume();
      } catch { fail(); }
    }).catch(fail);
  });
  signal.addEventListener("abort", fail, { once: true }); if (signal.aborted) fail();
  try {
    await current(); await onOwnership(ownership()); await current();
    timer = setTimeout(fail, 8000);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => { server.removeListener("error", reject); listening = true; resolve(); }); });
    if (closed) { server.close(); throw Error("The editor listener was cancelled during startup."); }
    const address = server.address(); require(address?.address === "127.0.0.1" && Number.isInteger(address.port) && address.port >= 1024);
    endpoint = "ws://127.0.0.1:" + address.port + "/"; phase = "ready"; await onOwnership(ownership()); await current(); return owner;
  } catch (error) { fail(); try { await owner.stop(); } catch { error.retirementUnconfirmed = true; } throw error; }
}
