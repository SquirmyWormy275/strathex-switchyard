/** Node SDK: an application explicitly enrolls, emits events, and handles bounded intents. */
import { createHmac } from "node:crypto";
export function switchyardAgent({ baseUrl, compartment, agentId, token, initialSequence = 0, onSequence = () => {} }) {
  const base = new URL(baseUrl);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) || base.username || base.password || base.pathname !== "/") throw new Error("The SDK requires the enrolled loopback workspace URL.");
  let sequence = initialSequence, pending = Promise.resolve();
  function send(path, fields) {
    const operation = pending.catch(() => {}).then(async () => {
      const body = { schema: "switchyard-agent-message/v1", compartment, agentId, sequence: ++sequence, at: Date.now(), ...fields }, text = JSON.stringify(body);
      onSequence(sequence);
      const signature = createHmac("sha256", token).update(text).digest("hex");
      const r = await fetch(new URL(path, base), { method: "POST", headers: { "Content-Type": "application/json", "X-Switchyard-Signature": signature }, body: text, redirect: "error", signal: AbortSignal.timeout(15000) });
      const value = await r.json(); if (!r.ok) throw new Error(value.error ?? "Switchyard refused the agent request."); return value;
    });
    pending = operation; return operation;
  }
  return { publish: (sessionId, status) => send("/agent/v1/event", { event: { sessionId, status } }), poll: () => send("/agent/v1/poll", {}), acknowledge: (commandId, outcome) => send("/agent/v1/ack", { commandId, outcome }) };
}
