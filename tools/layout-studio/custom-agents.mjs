/** Scoped event/action bridge. No plugin code or commands are loaded in the suite. */
import { createHmac, timingSafeEqual, randomBytes, randomUUID } from "node:crypto";

export const agentIntents = ["summon", "resume", "review", "handoff", "status", "cancel"];
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
export function createCustomAgents({ store, now = () => Date.now() }) {
  async function authenticate(body, signature) {
    if (!body || body.schema !== "switchyard-agent-message/v1" || !idPattern.test(body.compartment) || !idPattern.test(body.agentId) || !Number.isSafeInteger(body.sequence) || body.sequence < 1 || !Number.isSafeInteger(body.at) || Math.abs(now() - body.at) > 30000) throw new Error("Agent message identity, sequence or freshness is invalid.");
    await store.authorize(body.compartment, { provider: "custom-agent" });
    const token = await store.credential(body.compartment, `agent-${body.agentId}`, undefined, { provider: "custom-agent" });
    if (!token) throw new Error("This agent is not enrolled.");
    const expected = createHmac("sha256", token).update(JSON.stringify(body)).digest("hex"), supplied = Buffer.from(String(signature ?? ""));
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, Buffer.from(expected))) throw new Error("Agent message authentication failed.");
    return store.update(body.compartment, "agent-authenticated-request", (s) => { const a = s.agents.find((a) => a.id === body.agentId); if (!a || body.sequence <= a.sequence) throw new Error("Agent message was replayed or is out of order."); a.sequence = body.sequence; return a; }, { provider: "custom-agent" });
  }
  return {
    async enroll(compartment, { id, name, capabilities }) {
      await store.authorize(compartment, { provider: "custom-agent" });
      if (!idPattern.test(id) || id.length > 36 || typeof name !== "string" || !name.trim() || name.length > 100 || !Array.isArray(capabilities) || !capabilities.length || capabilities.some((c) => !agentIntents.includes(c))) throw new Error("Choose a bounded agent identity and supported intent capabilities.");
      return store.update(compartment, "agent-enroll", async (s) => {
        if (s.agents.some((a) => a.id === id)) throw new Error("That agent is already enrolled. Reuse its private credential or deliberately remove it before replacing it.");
        if (s.agents.length >= 32) throw new Error("Agent enrollment limit reached.");
        const token = randomBytes(32).toString("base64url");
        await store.credential(compartment, `agent-${id}`, token, { provider: "custom-agent" });
        s.agents.push({ id, name: name.trim(), capabilities: [...new Set(capabilities)], sequence: 0, lastSeen: null, sessionId: null, reportedStatus: "unknown", commands: [] });
        return { schema: "switchyard-agent-enrollment/v1", compartment, agentId: id, token, contract: "HMAC-SHA256 over exact JSON body; monotonic sequence; 30-second freshness" };
      }, { provider: "custom-agent" });
    },
    async message(path, body, signature) {
      await authenticate(body, signature);
      return store.update(body.compartment, "agent-message", (s) => {
        const a = s.agents.find((a) => a.id === body.agentId);
        if (path === "/agent/v1/event") {
          const event = body.event;
          if (!event || typeof event.sessionId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(event.sessionId) || !["ready", "busy", "waiting", "idle", "failed", "stopped"].includes(event.status)) throw new Error("The agent event is outside the versioned contract.");
          a.lastSeen = now(); a.sessionId = event.sessionId; a.reportedStatus = event.status; a.provenance = "authenticated adapter self-report; not verified task completion";
          for (const o of s.observations) if (o.status === "recording" && o.sources.includes("agent-events")) o.events.push({ kind: "status", provenance: "authenticated-agent-self-report", at: now() });
          return { accepted: true, provenance: a.provenance };
        }
        if (path === "/agent/v1/poll") {
          a.lastSeen = now();
          const next = a.commands.find((c) => c.status === "queued" && c.sessionId === a.sessionId);
          if (!next) return { command: null };
          next.status = "claimed"; next.claimedAt = now();
          return { command: { id: next.id, intent: next.intent, sessionId: next.sessionId, content: next.content ?? null }, replay: "claimed commands are never automatically re-delivered" };
        }
        if (path === "/agent/v1/ack") {
          const command = a.commands.find((c) => c.id === body.commandId);
          if (!command || command.status !== "claimed" || command.sessionId !== a.sessionId || !["completed", "failed", "cancelled"].includes(body.outcome)) throw new Error("The command acknowledgement has no exact active claim.");
          command.status = body.outcome; command.finishedAt = now(); command.provenance = "agent acknowledgement; external task outcome unverified";
          return { accepted: true, provenance: command.provenance };
        }
        throw new Error("Unknown agent route.");
      }, { provider: "custom-agent" });
    },
    async dispatch(compartment, { agentId, intent, sessionId, content }) {
      await store.authorize(compartment, { provider: "custom-agent" });
      if (!agentIntents.includes(intent) || content != null && (typeof content !== "string" || content.length > 12000)) throw new Error("Agent intent or reviewed content is invalid.");
      return store.update(compartment, "agent-intent", (s) => {
        const a = s.agents.find((a) => a.id === agentId);
        if (!a || !a.capabilities.includes(intent)) throw new Error("This agent does not expose the requested capability. No fallback action was selected.");
        if (!a.lastSeen || now() - a.lastSeen > 30000 || a.sessionId !== sessionId || a.reportedStatus === "stopped") throw new Error("This exact agent session is absent or stale. Reconnect it before dispatching.");
        if (a.commands.some((c) => c.intent === intent && c.sessionId === sessionId && ["queued", "claimed"].includes(c.status))) throw new Error("That exact intent is already pending; a duplicate was not launched.");
        const command = { id: randomUUID(), intent, sessionId, status: "queued", createdAt: now(), ...(intent === "handoff" && content ? { content } : {}) };
        a.commands = [...a.commands.slice(-63), command];
        return { commandId: command.id, status: command.status, provenance: "queued for an authenticated exact-session adapter; completion unverified" };
      }, { provider: "custom-agent" });
    }
  };
}
