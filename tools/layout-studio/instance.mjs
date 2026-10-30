/** Mutual local-instance authentication without disclosing the browser access token. */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { request as httpRequest } from "node:http";
const routes = { probe: "/instance/v1/probe", stop: "/instance/v1/stop" };
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
export function createInstanceGateway({ token, identity, onStop, now = () => Date.now() }) {
  if (!validIdentity(identity) || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof onStop !== "function") throw new Error("A private application identity and owned stop handler are required.");
  let stopping = false;
  return async (req, res, origin) => {
    const operation = Object.keys(routes).find((k) => routes[k] === req.url);
    const reject = () => { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Local instance authentication or scope was rejected." })); };
    if (!operation || req.method !== "POST" || req.headers.origin || req.headers["content-type"] !== "application/json") { reject(); return; }
    try {
      const chunks = []; let length = 0;
      for await (const b of req) { length += b.length; if (length > 2048) throw new Error(); chunks.push(b); }
      const raw = Buffer.concat(chunks), supplied = req.headers["x-switchyard-instance-request"];
      if (!same(supplied, mac(token, "REQUEST", req.url, raw))) throw new Error();
      const v = JSON.parse(raw.toString("utf8"));
      if (JSON.stringify(Object.keys(v).sort()) !== JSON.stringify(["at", "build", "instanceId", "nonce", "operation", "schema"]) || v.schema !== schema || v.operation !== operation || v.instanceId !== identity.id || v.build !== identity.build || !/^[A-Za-z0-9_-]{43}$/.test(v.nonce) || !Number.isSafeInteger(v.at) || Math.abs(now() - v.at) > 10000) throw new Error();
      const response = JSON.stringify({ schema, operation, nonce: v.nonce, instanceId: identity.id, build: identity.build, pid: process.pid, origin, status: operation === "stop" || stopping ? "stopping" : "ready" });
      res.writeHead(200, { "Content-Type": "application/json", "X-Switchyard-Instance-Response": mac(token, "RESPONSE-200", req.url, response) });
      if (operation === "stop" && !stopping) { stopping = true; res.once("finish", () => { void Promise.resolve().then(onStop).catch(() => {}); }); }
      res.end(response);
    } catch { reject(); }
  };
}
export async function requestInstance(endpoint, { operation = "probe", now = () => Date.now(), timeoutMs = 1500 } = {}) {
  const { url, token, identity } = endpointIdentity(endpoint), route = routes[operation];
  if (!route || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error("Unsupported instance request.");
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
