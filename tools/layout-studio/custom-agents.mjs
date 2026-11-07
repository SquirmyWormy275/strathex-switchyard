/** Scoped event/action bridge. No plugin code or commands are loaded in the suite. */
import { appendAgentObservation } from "./agent-observation.mjs";
import { scopeHash, suiteConfirmations } from "./confirmations.mjs";
import { randomBytes, randomUUID } from "node:crypto";
import { agentIntents, agentRoutes, agentMessageSchema, agentResponseSchema, requestMac, responseMac, sameMac } from "../../integrations/agent-protocol.mjs";

export { agentIntents };
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
export function createCustomAgents({ store, now = () => Date.now() }) {
  const epoch = a => a.credentialEpoch ?? "legacy";
  function revocationScope(state, id) {
    const a = state.agents.find(a => a.id === id);
    if (!a || a.enrollmentStatus === "revoked") throw Error("Choose an active enrolled agent to revoke.");
    const bindings = (state.roleBindings ?? []).filter(b => b.provider === "custom-agent" && b.targetId === id);
    return { a, bindings, confirmation: { action: "revoke_custom_agent", targetSnapshotId: scopeHash([state.id, id, epoch(a)]),
      scopeDigest: scopeHash([state.policy, state.mode, id, epoch(a), a.sessionId, a.capabilities, a.commands.map(c => [c.id, c.status]), bindings]) } };
  }
  function retireCommands(state, a, provenance) {
    for (const command of a.commands) if (["queued", "claimed"].includes(command.status)) {
      command.status = command.status === "queued" ? "cancelled-before-claim" : "uncertain-session-ended";
      command.provenance = provenance;
      appendAgentObservation(state, { provider: "custom-agent", subjectId: command.id, phase: "adapter-command-retired", status: command.status === "cancelled-before-claim" ? "stopped" : "unknown", intent: command.intent, at: now() });
    }
  }
  function outcomeScope(state, agentId, commandId) {
    const a = state.agents.find(a => a.id === agentId), command = a?.commands.find(c => c.id === commandId);
    if (!command || command.status !== "uncertain-session-ended") throw Error("Choose an exact uncertain claim from a retired agent session. Active or acknowledged commands cannot be cleared by this review.");
    return { command, confirmation: { action: "review_custom_agent_outcome", targetSnapshotId: scopeHash([state.id, agentId, commandId]),
      scopeDigest: scopeHash([state.policy, state.mode, epoch(a), a.enrollmentStatus ?? "active", a.sessionId, command]) } };
  }
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
        const existing = s.agents.find(a => a.id === id);
        if (existing && existing.enrollmentStatus !== "revoked") throw new Error("That agent is already enrolled. Review and revoke its authorization before replacing it.");
        if (!existing && s.agents.length >= 32) throw new Error("Agent enrollment limit reached.");
        const token = randomBytes(32).toString("base64url");
        await store.credential(compartment, `agent-${id}`, token, { provider: "custom-agent" });
        const enrolled = { id, name: name.trim(), protocolVersion: 2, credentialEpoch: randomUUID(), enrollmentStatus: "active", capabilities: [...new Set(capabilities)], sequence: 0, lastSeen: null, sessionId: null, reportedStatus: "unknown" };
        if (existing) Object.assign(existing, enrolled); else s.agents.push({ ...enrolled, commands: [] });
        return { schema: "switchyard-agent-enrollment/v2", compartment, agentId: id, token, protocolVersion: 2, contract: "Route-bound exact-body HMAC-SHA256 in both directions; exact session; atomic monotonic sequence; 30-second request freshness" };
      }, { provider: "custom-agent" });
    },
    async reviewRevoke(compartment, id) {
      await store.authorize(compartment, { provider: "custom-agent" });
      const scope = revocationScope(await store.snapshot(compartment), id);
      const confirmation = await suiteConfirmations(store, compartment, "custom-agent", now).issue({ ...scope.confirmation,
        reason: "Revoke this exact agent authorization and its role bindings. Unclaimed commands are cancelled locally; claimed work remains uncertain. This does not prove that an external process or task stopped.", reauthenticated: false });
      return { status: "requires-confirmation", confirmation, agentId: id, sessionId: scope.a.sessionId, roleBindings: scope.bindings.length,
        queued: scope.a.commands.filter(c => c.status === "queued").length, claimed: scope.a.commands.filter(c => c.status === "claimed").length, externalProcessStopped: false };
    },
    async revoke(compartment, { agentId, token }) {
      await store.authorize(compartment, { provider: "custom-agent" });
      const scope = revocationScope(await store.snapshot(compartment), agentId);
      const decision = await suiteConfirmations(store, compartment, "custom-agent", now).consume({ ...scope.confirmation, token });
      if (!decision.allowed) throw Error(decision.reason);
      return store.update(compartment, "agent-revoke", s => {
        const current = revocationScope(s, agentId);
        if (current.confirmation.scopeDigest !== scope.confirmation.scopeDigest) throw Error("The reviewed agent or its command claims changed. Review revocation again.");
        retireCommands(s, current.a, "agent authorization revoked; external task outcome unverified");
        Object.assign(current.a, { enrollmentStatus: "revoked", revokedAt: now(), sessionId: null, lastSeen: null, reportedStatus: "unknown" });
        s.roleBindings = (s.roleBindings ?? []).filter(b => b.provider !== "custom-agent" || b.targetId !== agentId);
        return { status: "revoked", agentId, externalProcessStopped: false, storedHistoryPreserved: true };
      }, { provider: "custom-agent" });
    },
    async reviewOutcome(compartment, { agentId, commandId }) {
      await store.authorize(compartment, { provider: "custom-agent" });
      const scope = outcomeScope(await store.snapshot(compartment), agentId, commandId);
      const confirmation = await suiteConfirmations(store, compartment, "custom-agent", now).issue({ ...scope.confirmation,
        reason: "Acknowledge reviewing this exact uncertain claim from a retired session. Its external outcome remains unverified. It will not be retried or cancelled, and its reviewed record becomes eligible for the existing bounded command-history retention.", reauthenticated: false });
      const { id, intent, sessionId, createdAt, claimedAt, content } = scope.command;
      return { status: "requires-confirmation", confirmation, agentId, command: { id, intent, sessionId, createdAt, claimedAt, content: content ?? null }, externalOutcomeVerified: false, commandWillBeRetried: false };
    },
    async resolveOutcome(compartment, { agentId, commandId, token }) {
      await store.authorize(compartment, { provider: "custom-agent" });
      const scope = outcomeScope(await store.snapshot(compartment), agentId, commandId);
      const decision = await suiteConfirmations(store, compartment, "custom-agent", now).consume({ ...scope.confirmation, token });
      if (!decision.allowed) throw Error(decision.reason);
      return store.update(compartment, "agent-outcome-review", s => {
        const current = outcomeScope(s, agentId, commandId);
        if (current.confirmation.scopeDigest !== scope.confirmation.scopeDigest) throw Error("The exact claim or agent enrollment changed. Review that outcome again.");
        Object.assign(current.command, { status: "reviewed-unconfirmed", outcomeReviewedAt: now(), externalOutcomeVerified: false, provenance: "operator reviewed uncertainty; external task outcome unverified; never automatically re-delivered" });
        appendAgentObservation(s, { provider: "custom-agent", subjectId: commandId, phase: "adapter-command-outcome-reviewed", status: "unknown", intent: current.command.intent, at: now() });
        return { status: "reviewed-unconfirmed", commandId, externalOutcomeVerified: false, taskCompletionVerified: false, providerCommandSent: false };
      }, { provider: "custom-agent" });
    },
    async message(path, body, signature, raw = JSON.stringify(body)) {
      if (!body || !idPattern.test(body.compartment)) throw Error("Agent v2 compartment is invalid.");
      const { token, result } = await store.update(body.compartment, "agent-message", async (s) => {
        const a = s.agents.find((a) => a.id === body.agentId);
        if (!a || a.enrollmentStatus === "revoked") throw Error("This agent is not actively enrolled.");
        const token = await authenticate(path, body, signature, raw);
        const accept = result => ({ token, result });
        if (!a || body.sequence <= a.sequence) throw new Error("Agent message was replayed or is out of order.");
        a.sequence = body.sequence;
        if (path === agentRoutes.event) {
          const event = body.event;
          if (!event || Object.keys(event).join() !== "status" || !["ready", "busy", "waiting", "idle", "failed", "stopped"].includes(event.status)) throw new Error("The agent event is outside the versioned contract.");
          if (a.sessionId === body.sessionId && a.reportedStatus === "stopped" && event.status !== "stopped") throw Error("This agent session already stopped. Publish ready with a fresh session identity before accepting new work.");
          if (a.sessionId !== body.sessionId) {
            if (event.status !== "ready") throw new Error("A new agent session must publish ready before other events.");
            retireCommands(s, a, "session identity changed; never automatically re-delivered; external outcome unverified");
          }
          if (event.status === "stopped") retireCommands(s, a, "authenticated adapter reported stopped; external process and task outcomes unverified");
          a.protocolVersion = 2; a.lastSeen = now(); a.sessionId = body.sessionId; a.reportedStatus = event.status; a.provenance = "authenticated adapter self-report; not verified task completion";
          appendAgentObservation(s, { provider: "custom-agent", subjectId: `${a.id}:${body.sessionId}`, phase: "adapter-status-observed", status: event.status, at: now() });
          return accept({ accepted: true, provenance: a.provenance });
        }
        if (path === agentRoutes.poll) {
          if (a.sessionId !== body.sessionId || a.reportedStatus === "stopped") throw new Error("That polling process no longer owns the current agent session.");
          a.lastSeen = now();
          const next = a.commands.find((c) => c.status === "queued" && c.sessionId === a.sessionId && epoch(c) === epoch(a));
          if (!next) return accept({ command: null });
          next.status = "claimed"; next.claimedAt = now();
          appendAgentObservation(s, { provider: "custom-agent", subjectId: next.id, phase: "adapter-command-claimed", status: "running", intent: next.intent, at: next.claimedAt });
          return accept({ command: { id: next.id, intent: next.intent, sessionId: next.sessionId, content: next.content ?? null }, replay: "claimed commands are never automatically re-delivered" });
        }
        if (path === agentRoutes.ack) {
          const command = a.commands.find((c) => c.id === body.commandId);
          if (!command || epoch(command) !== epoch(a) || !["claimed", "uncertain-session-ended"].includes(command.status) || command.sessionId !== body.sessionId || !["completed", "failed", "cancelled"].includes(body.outcome)) throw new Error("The command acknowledgement has no exact active claim.");
          command.status = body.outcome; command.finishedAt = now(); command.provenance = "agent acknowledgement; external task outcome unverified";
          appendAgentObservation(s, { provider: "custom-agent", subjectId: command.id, phase: "adapter-command-acknowledged", status: body.outcome === "completed" ? "done" : body.outcome === "failed" ? "failed" : "stopped", intent: command.intent, at: command.finishedAt });
          return accept({ accepted: true, provenance: command.provenance });
        }
        throw new Error("Unknown agent route.");
      }, { provider: "custom-agent" });
      const payload = { schema: agentResponseSchema, requestSequence: body.sequence, sessionId: body.sessionId, result };
      return { payload, signature: responseMac(token, path, 200, JSON.stringify(payload)) };
    },
    async dispatch(compartment, { agentId, intent, sessionId, content, credentialEpoch }, { assertCurrent = async () => {}, assertCurrentState = () => {} } = {}) {
      await store.authorize(compartment, { provider: "custom-agent" });
      if (!agentIntents.includes(intent) || content != null && (typeof content !== "string" || content.length > 12000)) throw new Error("Agent intent or reviewed content is invalid.");
      return store.update(compartment, "agent-intent", async (s) => {
        await assertCurrent();
        // The trusted role guard runs synchronously under the same state lease as enqueue.
        assertCurrentState(s);
        const a = s.agents.find((a) => a.id === agentId);
        if (a?.enrollmentStatus === "revoked" || credentialEpoch !== undefined && credentialEpoch !== epoch(a ?? {})) throw Error("This exact agent authorization was revoked or replaced. Rebind it deliberately.");
        if (!a || !a.capabilities.includes(intent)) throw new Error("This agent does not expose the requested capability. No fallback action was selected.");
        if (!a.lastSeen || now() - a.lastSeen > 30000 || a.sessionId !== sessionId || a.reportedStatus === "stopped") throw new Error("This exact agent session is absent or stale. Reconnect it before dispatching.");
        if (a.commands.some((c) => c.intent === intent && c.sessionId === sessionId && ["queued", "claimed"].includes(c.status))) throw new Error("That exact intent is already pending; a duplicate was not launched.");
        const command = { id: randomUUID(), credentialEpoch: epoch(a), intent, sessionId, status: "queued", createdAt: now(), ...(intent === "handoff" && content ? { content } : {}) };
        if (a.commands.length >= 64) {
          const removable = a.commands.findIndex((c) => !["queued", "claimed", "uncertain-session-ended"].includes(c.status));
          if (removable < 0) throw new Error("Unresolved agent command limit reached. Review those exact claims before queueing more work.");
          a.commands.splice(removable, 1);
        }
        a.commands.push(command);
        appendAgentObservation(s, { provider: "custom-agent", subjectId: command.id, phase: "adapter-command-queued", status: "reserved-locally", intent, at: command.createdAt });
        return { commandId: command.id, status: command.status, provenance: "queued for an authenticated exact-session adapter; completion unverified" };
      }, { provider: "custom-agent" });
    }
  };
}
