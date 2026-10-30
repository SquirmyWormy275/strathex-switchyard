/** Scoped event/action bridge. No plugin code or commands are loaded in the suite. */
import { randomBytes, randomUUID } from "node:crypto";
import { agentIntents, agentRoutes, agentMessageSchema, agentResponseSchema, requestMac, responseMac, sameMac } from "../../integrations/agent-protocol.mjs";

export { agentIntents };
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
export function createCustomAgents({ store, now = () => Date.now() }) {
  async function authenticate(path, body, signature, raw) {
    const fields = { [agentRoutes.event]: ["event"], [agentRoutes.poll]: [], [agentRoutes.ack]: ["commandId", "outcome"] }[path];
    const expectedFields = ["schema", "compartment", "agentId", "sessionId", "sequence", "at", ...(fields ?? [])].sort();
    if (!fields || !body || body.schema !== agentMessageSchema || JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(expectedFields) || !idPattern.test(body.compartment) || !idPattern.test(body.agentId) || typeof body.sessionId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(body.sessionId) || !Number.isSafeInteger(body.sequence) || body.sequence < 1 || !Number.isSafeInteger(body.at) || Math.abs(now() - body.at) > 30000) throw new Error("Agent v2 route, identity, session, sequence or freshness is invalid.");
    if (typeof raw !== "string" || Buffer.byteLength(raw) > 32768 || JSON.stringify(JSON.parse(raw)) !== JSON.stringify(body)) throw new Error("Agent v2 raw body does not match its parsed message.");
    await store.authorize(body.compartment, { provider: "custom-agent" });
    const token = await store.credential(body.compartment, `agent-${body.agentId}`, undefined, { provider: "custom-agent" });
    if (!token) throw new Error("This agent is not enrolled.");
    if (!sameMac(signature, requestMac(token, path, raw))) throw new Error("Agent message authentication failed.");
    return token;
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
        s.agents.push({ id, name: name.trim(), protocolVersion: 2, capabilities: [...new Set(capabilities)], sequence: 0, lastSeen: null, sessionId: null, reportedStatus: "unknown", commands: [] });
        return { schema: "switchyard-agent-enrollment/v2", compartment, agentId: id, token, protocolVersion: 2, contract: "Route-bound exact-body HMAC-SHA256 in both directions; exact session; atomic monotonic sequence; 30-second request freshness" };
      }, { provider: "custom-agent" });
    },
    async message(path, body, signature, raw = JSON.stringify(body)) {
      const token = await authenticate(path, body, signature, raw);
      const result = await store.update(body.compartment, "agent-message", (s) => {
        const a = s.agents.find((a) => a.id === body.agentId);
        if (!a || body.sequence <= a.sequence) throw new Error("Agent message was replayed or is out of order.");
        a.sequence = body.sequence;
        if (path === agentRoutes.event) {
          const event = body.event;
          if (!event || Object.keys(event).join() !== "status" || !["ready", "busy", "waiting", "idle", "failed", "stopped"].includes(event.status)) throw new Error("The agent event is outside the versioned contract.");
          if (a.sessionId !== body.sessionId) {
            if (event.status !== "ready") throw new Error("A new agent session must publish ready before other events.");
            for (const command of a.commands) if (["queued", "claimed"].includes(command.status)) { command.status = command.status === "queued" ? "cancelled-before-claim" : "uncertain-session-ended"; command.provenance = "session identity changed; never automatically re-delivered; external outcome unverified"; }
          }
          a.protocolVersion = 2; a.lastSeen = now(); a.sessionId = body.sessionId; a.reportedStatus = event.status; a.provenance = "authenticated adapter self-report; not verified task completion";
          for (const o of s.observations) if (o.status === "recording" && o.sources.includes("agent-events")) { if (o.events.length >= 2000) { o.status = "paused"; o.limitReached = true; } else { o.events.push({ kind: "status", provenance: "authenticated-agent-self-report", at: now() }); o.updatedAt = now(); } }
          return { accepted: true, provenance: a.provenance };
        }
        if (path === agentRoutes.poll) {
          if (a.sessionId !== body.sessionId || a.reportedStatus === "stopped") throw new Error("That polling process no longer owns the current agent session.");
          a.lastSeen = now();
          const next = a.commands.find((c) => c.status === "queued" && c.sessionId === a.sessionId);
          if (!next) return { command: null };
          next.status = "claimed"; next.claimedAt = now();
          return { command: { id: next.id, intent: next.intent, sessionId: next.sessionId, content: next.content ?? null }, replay: "claimed commands are never automatically re-delivered" };
        }
        if (path === agentRoutes.ack) {
          const command = a.commands.find((c) => c.id === body.commandId);
          if (!command || !["claimed", "uncertain-session-ended"].includes(command.status) || command.sessionId !== body.sessionId || !["completed", "failed", "cancelled"].includes(body.outcome)) throw new Error("The command acknowledgement has no exact active claim.");
          command.status = body.outcome; command.finishedAt = now(); command.provenance = "agent acknowledgement; external task outcome unverified";
          return { accepted: true, provenance: command.provenance };
        }
        throw new Error("Unknown agent route.");
      }, { provider: "custom-agent" });
      const payload = { schema: agentResponseSchema, requestSequence: body.sequence, sessionId: body.sessionId, result };
      return { payload, signature: responseMac(token, path, 200, JSON.stringify(payload)) };
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
        if (a.commands.length >= 64) {
          const removable = a.commands.findIndex((c) => !["queued", "claimed", "uncertain-session-ended"].includes(c.status));
          if (removable < 0) throw new Error("Unresolved agent command limit reached. Review those exact claims before queueing more work.");
          a.commands.splice(removable, 1);
        }
        a.commands.push(command);
        return { commandId: command.id, status: command.status, provenance: "queued for an authenticated exact-session adapter; completion unverified" };
      }, { provider: "custom-agent" });
    }
  };
}
