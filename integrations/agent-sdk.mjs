/** Node SDK: an application explicitly enrolls, emits events, and handles bounded intents. */
import { agentIntents, agentRoutes, agentMessageSchema, agentResponseSchema, requestMac, responseMac, sameMac } from "./agent-protocol.mjs";
import { request } from "node:http";
function exchange(url, text, signature) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", agent: false, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), "X-Switchyard-Signature": signature } }, (res) => {
      const chunks = []; let bytes = 0;
      res.on("data", (chunk) => { bytes += chunk.length; if (bytes > 128 * 1024) { res.destroy(); req.destroy(new Error("Agent response exceeds its bound.")); } else chunks.push(chunk); });
      res.on("error", fail);
      res.on("aborted", () => fail(new Error("Agent response was interrupted.")));
      res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode, signature: res.headers["x-switchyard-response-signature"], raw: Buffer.concat(chunks).toString("utf8") }); });
    });
    const timer = setTimeout(() => req.destroy(new Error("Agent request timed out; its outcome is not assumed.")), 15000);
    function fail(error) { clearTimeout(timer); reject(error); }
    req.on("error", fail); req.end(text);
  });
}
export function switchyardAgent({ baseUrl, compartment, agentId, token, initialSequence = 0, onSequence = () => {} }) {
  const base = new URL(baseUrl);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) || base.username || base.password || base.pathname !== "/" || base.search || base.hash || typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || !Number.isSafeInteger(initialSequence) || initialSequence < 0) throw new Error("The SDK requires its exact enrolled loopback workspace and private credential.");
  let sequence = initialSequence, pending = Promise.resolve(), currentSession = null; const claims = new Map();
  function send(path, sessionId, fields) {
    const operation = pending.catch(() => {}).then(async () => {
      if (typeof sessionId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(sessionId) || !Number.isSafeInteger(sequence + 1)) throw new Error("Publish an exact ready session before polling or acknowledging.");
      if (path === agentRoutes.poll && claims.size >= 64) throw new Error("Resolve the SDK's existing exact claims before accepting more commands.");
      const body = { schema: agentMessageSchema, compartment, agentId, sessionId, sequence: ++sequence, at: Date.now(), ...fields }, text = JSON.stringify(body);
      onSequence(sequence);
      const signature = requestMac(token, path, text);
      const r = await exchange(new URL(path, base), text, signature), raw = r.raw;
      if (r.status !== 200) throw new Error("Switchyard did not return an accepted response. Check policy, SDK version, session and sequence; review uncertain request outcomes before retrying.");
      if (!sameMac(r.signature, responseMac(token, path, r.status, raw))) throw new Error("The local server response failed authentication; no returned action will run and the request outcome is uncertain.");
      const value = JSON.parse(raw);
      if (value.schema !== agentResponseSchema || value.requestSequence !== body.sequence || value.sessionId !== sessionId || !value.result || typeof value.result !== "object" || Array.isArray(value.result)) throw new Error("Agent response scope does not match this exact request.");
      const command = value.result.command;
      if (path === agentRoutes.poll && command !== null && (!command || typeof command.id !== "string" || !/^[a-f0-9-]{36}$/.test(command.id) || !agentIntents.includes(command.intent) || command.sessionId !== sessionId || command.content != null && (typeof command.content !== "string" || command.content.length > 12000))) throw new Error("The command is outside this exact session's supported intent contract.");
      if (path === agentRoutes.poll && command) { if (claims.size >= 64) throw new Error("Resolve the SDK's existing exact claims before accepting more commands."); claims.set(command.id, sessionId); }
      return value.result;
    });
    pending = operation; return operation;
  }
  return {
    publish: async (sessionId, status) => { const result = await send(agentRoutes.event, sessionId, { event: { status } }); currentSession = sessionId; return result; },
    poll: () => send(agentRoutes.poll, currentSession, {}),
    acknowledge: async (commandId, outcome) => { const result = await send(agentRoutes.ack, claims.get(commandId) ?? currentSession, { commandId, outcome }); claims.delete(commandId); return result; }
  };
}
