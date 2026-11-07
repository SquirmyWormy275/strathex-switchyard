/** Mutual local-instance authentication without disclosing the browser access token. */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { request as httpRequest } from "node:http";
import { windowsTerminalProcessQuery } from "./windows-terminal-process.mjs";
import { physicalIntentDispatch } from "./physical-intent-contract.mjs";
const routes = { editorChoices: "/instance/v1/editor-choices", physicalIntent: "/instance/v1/physical-intent", probe: "/instance/v1/probe", stop: "/instance/v1/stop", editorTarget: "/instance/v1/editor-target", editorReview: "/instance/v1/editor-review", editorIssue: "/instance/v1/editor-issue", editorConsume: "/instance/v1/editor-consume", editorReturnTarget: "/instance/v1/editor-return-target" };
const editorActions = { editorReview: "review", editorIssue: "issue", editorConsume: "consume", editorReturnTarget: "return-target" };
const connectionActions = { editorConnectionOpen: "open", editorConnectionPeer: "pin-peer", editorConnectionObserve: "observe", editorConnectionStop: "stop", editorConnectionRecover: "recover" };
for (const [operation, action] of Object.entries(connectionActions)) routes[operation] = "/instance/v1/editor-connection-" + action;
const schema = "switchyard-instance/v1";
const mac = (token, direction, route, raw) => createHmac("sha256", token).update(`SWITCHYARD-INSTANCE-V1\n${direction}\nPOST\n${route}\n`).update(raw).digest("hex");
const same = (a, b) => typeof a === "string" && typeof b === "string" && /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
function validIdentity(v) { return v && /^[a-f0-9-]{36}$/.test(v.id) && /^[a-f0-9]{64}$/.test(v.build); }
export function newInstanceIdentity(build) { const v = { id: randomUUID(), build }; if (!validIdentity(v)) throw new Error("An exact suite build is required."); return v; }
export function endpointIdentity(endpoint) {
  const url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
  if (endpoint.schema !== "switchyard-active-endpoint/v1" || !validIdentity(endpoint.instance) || !Number.isSafeInteger(endpoint.pid) || endpoint.pid < 1 || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.username || url.password || !token || +url.port < 1024 || +url.port > 65535) throw new Error("This endpoint has no supported authenticated application identity. Preserve the existing instance for inspection.");
  return { url, token, identity: endpoint.instance };
}
export function createInstanceGateway({ token, identity, onStop, onEditorChoices, onEditorTarget, onEditorAuthorization, onEditorConnection, onPhysicalIntent, now = () => Date.now() }) {
  if (!validIdentity(identity) || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof onStop !== "function") throw new Error("A private application identity and owned stop handler are required.");
  let stopping = false;
  const physicalNonces = new Map();
  let physicalClock = null;
  return async (req, res, origin) => {
    const operation = Object.keys(routes).find((k) => routes[k] === req.url);
    const reject = () => { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Local instance authentication or scope was rejected." })); };
    if (!operation || req.method !== "POST" || req.headers.origin || req.headers["content-type"] !== "application/json") { reject(); return; }
    try {
      const chunks = []; let length = 0;
      for await (const b of req) { length += b.length; if (length > (["editorConnectionPeer", "editorChoices"].includes(operation) ? 8192 : 2048)) throw new Error(); chunks.push(b); }
      const raw = Buffer.concat(chunks), supplied = req.headers["x-switchyard-instance-request"];
      if (!same(supplied, mac(token, "REQUEST", req.url, raw))) throw new Error();
      const v = JSON.parse(raw.toString("utf8"));
      const authorization = Object.hasOwn(editorActions, operation), returning = operation === "editorReturnTarget", connection = Object.hasOwn(connectionActions, operation), physical = operation === "physicalIntent";
      const expected = ["at", "build", "instanceId", "nonce", "operation", "schema", ...(operation === "editorChoices" || operation === "editorTarget" || authorization || connection || physical ? ["selection"] : []), ...(physical ? ["pid"] : [])].sort();
      if (JSON.stringify(Object.keys(v).sort()) !== JSON.stringify(expected) || v.schema !== schema || v.operation !== operation || v.instanceId !== identity.id || v.build !== identity.build || !/^[A-Za-z0-9_-]{43}$/.test(v.nonce) || !Number.isSafeInteger(v.at) || Math.abs(now() - v.at) > 10000) throw new Error();
      let targetObservation, editorAuthorization, editorConnection, intentDispatch, editorChoices;
      if (physical) {
        if (stopping || typeof onPhysicalIntent !== "function" || v.pid !== process.pid) throw new Error();
        const selection = physicalIntentDispatch(v.selection), at = now();
        // A clock rollback must not revive a request whose nonce was pruned.
        if (!Number.isSafeInteger(at) || Math.abs(at - v.at) > 10000 || physicalClock !== null && at < physicalClock) throw new Error();
        physicalClock = at;
        for (const [nonce, expires] of physicalNonces) if (expires < at) physicalNonces.delete(nonce);
        if (physicalNonces.has(v.nonce) || physicalNonces.size >= 1024) throw new Error();
        // Reserve before the effect. A lost reply cannot replay the same signed
        // invocation during its freshness window, even while it is still pending.
        physicalNonces.set(v.nonce, v.at + 10000);
        try { intentDispatch = { requestId: selection.requestId, status: "accepted", result: await onPhysicalIntent(selection) }; }
        catch { intentDispatch = { requestId: selection.requestId, status: "not-confirmed" }; }
        if (stopping) throw new Error();
      }
      if (operation === "editorChoices") {
        const s = v.selection;
        if (stopping || typeof onEditorChoices !== "function" || !s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).join() !== "repositoryRoot" || typeof s.repositoryRoot !== "string" || !s.repositoryRoot || Buffer.byteLength(s.repositoryRoot) > 4096 || /[\x00-\x1f\x7f]/.test(s.repositoryRoot)) throw new Error();
        editorChoices = await onEditorChoices(Object.freeze({ repositoryRoot: s.repositoryRoot }));
        if (stopping) throw new Error();
      }
      if (operation === "editorTarget") {
        const s = v.selection;
        if (stopping || typeof onEditorTarget !== "function" || !s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).sort().join() !== "compartment,loadRequestId,ownerRequestId" || typeof s.compartment !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(s.compartment) || ![s.ownerRequestId, s.loadRequestId].every(id => typeof id === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))) throw new Error();
        targetObservation = await onEditorTarget(Object.freeze({ ...s }));
        if (stopping) throw new Error();
      }
      if (authorization) {
        const s = v.selection, ids = ["ownerRequestId", "loadRequestId", "requestId", "editorId", ...(operation === "editorIssue" ? ["token"] : operation === "editorConsume" ? ["permit"] : [])];
        if (stopping || typeof onEditorAuthorization !== "function" || !s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).sort().join() !== ["compartment", ...ids].sort().join() || typeof s.compartment !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(s.compartment) || !ids.every(key => typeof s[key] === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s[key]))) throw new Error();
        const result = await onEditorAuthorization(editorActions[operation], Object.freeze({ ...s }));
        if (returning) targetObservation = result; else editorAuthorization = result;
        if (stopping) throw new Error();
      }
      if (connection) {
        const s = v.selection, ids = ["ownerRequestId", "loadRequestId", "requestId", "editorId"], pin = operation === "editorConnectionPeer";
        if (stopping || typeof onEditorConnection !== "function" || !s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).sort().join() !== ["compartment", ...ids, ...(pin ? ["peer"] : [])].sort().join() || typeof s.compartment !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(s.compartment) || !ids.every(key => typeof s[key] === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s[key]))) throw new Error();
        if (pin) {
          const p = s.peer;
          if (p && typeof p === "object" && !Array.isArray(p) && Object.keys(p).sort().join() === "expectedBirth,image,processId") {
            if (p.expectedBirth === null) throw new Error();
            const checked = windowsTerminalProcessQuery({ schema: "switchyard-editor-terminal-process-query/v1", requestId: s.requestId, ...p });
            s.peer = Object.freeze({ processId: checked.processId, expectedBirth: checked.expectedBirth, image: checked.image });
          } else {
          if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== "birth,executable,executableSha256,pid" || !Number.isSafeInteger(p.pid) || p.pid < 1 || p.pid > 2147483647 || typeof p.birth !== "string" || !/^[1-9][0-9]{0,19}$/.test(p.birth) || typeof p.executable !== "string" || !p.executable.startsWith("/") || Buffer.byteLength(p.executable) > 4096 || /[\\\x00-\x1f\x7f]/.test(p.executable) || typeof p.executableSha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.executableSha256)) throw new Error();
          Object.freeze(p);
          }
        }
        editorConnection = await onEditorConnection(connectionActions[operation], Object.freeze({ ...s }));
        if (stopping) throw new Error();
      }
      const response = JSON.stringify({ schema, operation, nonce: v.nonce, instanceId: identity.id, build: identity.build, pid: process.pid, origin, status: operation === "stop" || stopping ? "stopping" : "ready", ...(operation === "editorTarget" || returning ? { targetObservation } : {}), ...(authorization && !returning ? { editorAuthorization } : {}), ...(connection ? { editorConnection } : {}), ...(physical ? { intentDispatch } : {}), ...(operation === "editorChoices" ? { editorChoices } : {}) });
      if (Buffer.byteLength(response) > (physical ? 256 * 1024 : 32768)) throw new Error();
      res.writeHead(200, { "Content-Type": "application/json", "X-Switchyard-Instance-Response": mac(token, "RESPONSE-200", req.url, response) });
      if (operation === "stop" && !stopping) { stopping = true; res.once("finish", () => { void Promise.resolve().then(onStop).catch(() => {}); }); }
      res.end(response);
    } catch { reject(); }
  };
}
export async function requestInstance(endpoint, { operation = "probe", now = () => Date.now(), timeoutMs = 1500 } = {}) {
  const { url, token, identity } = endpointIdentity(endpoint), route = routes[operation];
  if (!["probe", "stop"].includes(operation) || !route || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error("Unsupported instance request.");
  const nonce = randomBytes(32).toString("base64url"), raw = JSON.stringify({ schema, operation, nonce, at: now(), instanceId: identity.id, build: identity.build });
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(new URL(route, url.origin), { method: "POST", agent: false, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(raw), "X-Switchyard-Instance-Request": mac(token, "REQUEST", route, raw) } }, (res) => {
      const chunks = []; let length = 0;
      res.on("data", (b) => { length += b.length; if (length > 4096) res.destroy(new Error("Local instance response exceeded its bound.")); else chunks.push(b); });
      res.once("error", reject); res.once("end", () => resolve({ status: res.statusCode, signature: res.headers["x-switchyard-instance-response"], raw: Buffer.concat(chunks).toString("utf8") }));
    });
    const timer = setTimeout(() => req.destroy(new Error("The saved local instance did not answer within its bound.")), timeoutMs);
    req.once("close", () => clearTimeout(timer)); req.once("error", reject); req.end(raw);
  });
  if (response.status !== 200 || !same(response.signature, mac(token, "RESPONSE-200", route, response.raw))) throw new Error("The saved endpoint did not authenticate itself. Its access token was not disclosed.");
  const result = JSON.parse(response.raw);
  if (JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(["build", "instanceId", "nonce", "operation", "origin", "pid", "schema", "status"]) || result.schema !== schema || result.operation !== operation || result.nonce !== nonce || result.instanceId !== identity.id || result.build !== identity.build || result.pid !== endpoint.pid || result.origin !== url.origin || !["ready", "stopping"].includes(result.status) || operation === "stop" && result.status !== "stopping") throw new Error("The local instance response did not match its exact request and saved identity.");
  return { authenticated: true, ...result };
}

/** A signed physical effect request never sends the browser token or retries. */
export async function requestPhysicalIntent(endpoint, input, { now = () => Date.now(), timeoutMs = 125000 } = {}) {
  const selection = physicalIntentDispatch(input), { url, token, identity } = endpointIdentity(endpoint), operation = "physicalIntent", route = routes[operation];
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 125000) throw Error("Unsupported physical intent request bound.");
  const nonce = randomBytes(32).toString("base64url"), raw = JSON.stringify({ schema, operation, nonce, at: now(), instanceId: identity.id, build: identity.build, pid: endpoint.pid, selection });
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(new URL(route, url.origin), { method: "POST", agent: false, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(raw), "X-Switchyard-Instance-Request": mac(token, "REQUEST", route, raw) } }, res => {
      const chunks = []; let length = 0;
      res.on("data", b => { length += b.length; if (length > 256 * 1024) res.destroy(Error("Physical intent response exceeds its bound.")); else chunks.push(b); });
      res.once("error", reject); res.once("end", () => resolve({ status: res.statusCode, signature: res.headers["x-switchyard-instance-response"], raw: Buffer.concat(chunks).toString("utf8") }));
    });
    const timer = setTimeout(() => req.destroy(Error("Physical intent outcome was not confirmed within its bound; no retry was sent.")), timeoutMs);
    req.once("close", () => clearTimeout(timer)); req.once("error", reject); req.end(raw);
  });
  if (response.status !== 200 || !same(response.signature, mac(token, "RESPONSE-200", route, response.raw))) throw Error("The physical endpoint did not authenticate its response. Its access token was not disclosed; no retry was sent.");
  const result = JSON.parse(response.raw), expected = ["build", "instanceId", "intentDispatch", "nonce", "operation", "origin", "pid", "schema", "status"], outcome = result.intentDispatch;
  if (Object.keys(result).sort().join() !== expected.sort().join() || result.schema !== schema || result.operation !== operation || result.nonce !== nonce || result.instanceId !== identity.id || result.build !== identity.build || result.pid !== endpoint.pid || result.origin !== url.origin || result.status !== "ready" || !outcome || typeof outcome !== "object" || Array.isArray(outcome) || outcome.requestId !== selection.requestId || !["accepted", "not-confirmed"].includes(outcome.status) || Object.keys(outcome).sort().join() !== (outcome.status === "accepted" ? "requestId,result,status" : "requestId,status")) throw Error("The physical response did not match its exact invocation and saved instance.");
  if (outcome.status !== "accepted") throw Error("The active compartment did not confirm this physical intent. Review its target and policy before another deliberate action.");
  return outcome.result;
}
