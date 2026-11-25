/** Durable Microsoft delivery facts. A local record cannot undo a remote effect. */
import { randomUUID } from "node:crypto";
import { scopeHash, suiteConfirmations } from "./confirmations.mjs";

const schema = "switchyard-copilot-request/v1";
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const terminal = new Set(["completed", "not-started", "reviewed-unconfirmed"]);
const phases = ["reserved", "creating", "created", "submitting", "reply-recorded"];
const states = new Set(["reserved", "creating", "created", "submitting", ...terminal, "outcome-unconfirmed"]);
const fields = ["schema", "id", "requestId", "requestKey", "scopeDigest", "account", "clientId", "conversationId", "sessionId", "ownerId", "phase", "status", "attempted", "createdAt", "updatedAt", "responseDigest", "originalOutcome", "reviewedAt"];
function validate(row) {
  const shaped = row && typeof row === "object" && !Array.isArray(row)
    && Object.keys(row).sort().join() === fields.slice().sort().join() && row.schema === schema;
  if (!shaped) throw Error("Preserve the unfamiliar original Microsoft request record.");
  const references = uuid(row.id) && uuid(row.ownerId) && uuid(row.clientId)
    && (row.requestId === null || uuid(row.requestId))
    && typeof row.account === "string" && row.account.length === 73
    && uuid(row.account.slice(0, 36)) && row.account[36] === ":" && uuid(row.account.slice(37))
    && (row.conversationId === null || typeof row.conversationId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(row.conversationId))
    && (row.sessionId === null || uuid(row.sessionId))
    && digest(row.requestKey) && digest(row.scopeDigest)
    && (row.responseDigest === null || digest(row.responseDigest));
  const timestamps = Number.isSafeInteger(row.createdAt) && row.createdAt >= 0
    && Number.isSafeInteger(row.updatedAt) && row.updatedAt >= row.createdAt
    && (row.reviewedAt === null || Number.isSafeInteger(row.reviewedAt) && row.reviewedAt >= row.createdAt);
  const labels = phases.includes(row.phase) && states.has(row.status) && typeof row.attempted === "boolean"
    && (row.originalOutcome === null || ["not-started", "outcome-unconfirmed"].includes(row.originalOutcome));
  if (!references || !timestamps || !labels) throw Error("Preserve the unfamiliar original Microsoft request record.");

  const pending = ["reserved", "creating", "created", "submitting"].includes(row.status);
  const invalid = [
    pending && (row.phase !== row.status || row.originalOutcome !== null || row.responseDigest !== null
      || (row.status === "reserved" ? row.attempted : !row.attempted)),
    row.status === "completed" && (!row.attempted || row.phase !== "reply-recorded" || !row.responseDigest
      || row.conversationId === null || row.sessionId === null || row.originalOutcome !== null),
    row.status === "not-started" && (row.attempted || row.phase !== "reserved" || row.originalOutcome !== "not-started"),
    row.status === "outcome-unconfirmed" && (!row.attempted || row.phase === "reserved" || row.originalOutcome !== "outcome-unconfirmed"),
    row.status === "reviewed-unconfirmed" && (row.originalOutcome === null || row.reviewedAt === null
      || (row.originalOutcome === "not-started" ? row.attempted || row.phase !== "reserved" : !row.attempted || row.phase === "reserved")),
    row.status !== "reviewed-unconfirmed" && row.reviewedAt !== null,
    row.status !== "completed" && row.responseDigest !== null,
    row.phase === "reply-recorded" && row.status !== "completed",
    row.phase === "creating" && row.sessionId !== null,
    ["created", "submitting", "reply-recorded"].includes(row.phase) && row.sessionId === null
  ];
  if (invalid.some(Boolean)) throw Error("Preserve contradictory original Microsoft outcome metadata.");
  return row;
}
function inventory(state) {
  const rows = state.copilotRequests ?? []; if (!Array.isArray(rows) || rows.length > 128 || new Set(rows.map(row => row.id)).size !== rows.length) throw Error("Preserve the original Microsoft request inventory.");
  rows.forEach(validate); const explicit = rows.filter(row => row.requestId !== null).map(row => row.requestId.toLowerCase()); if (new Set(explicit).size !== explicit.length) throw Error("Preserve duplicate original Microsoft request identities."); return rows;
}
export const copilotRequestResource = (compartment, account, clientId) => scopeHash(["switchyard-copilot-request-owner/v1", compartment, account.toLowerCase(), clientId.toLowerCase()]);
export const copilotResponseDigest = row => scopeHash([row.id, row.sessionId, row.account, row.messages?.at(-1)?.text, row.proposal, row.workflow, row.limitation ?? null]);
const view = row => ({ id: row.id, requestId: row.requestId, conversationId: row.conversationId, sessionId: row.sessionId, account: row.account, phase: row.phase, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, originalOutcome: row.originalOutcome, reviewedAt: row.reviewedAt, remoteCancellationVerified: false });

export function createCopilotRequests({ store, ownerId = randomUUID(), now = () => Date.now(), isActive = async () => true } = {}) {
  if (!uuid(ownerId)) throw Error("Microsoft requests require one exact local owner identity.");
  const assertOwned = (state, id, status) => { const row = inventory(state).find(row => row.id === id); if (!row || row.ownerId !== ownerId || row.status !== status) throw Error("The original Microsoft request owner or delivery phase changed."); return row; };
  const update = (c, id, action, assertCurrent, fn) => store.update(c, action, state => {
    assertCurrent(); const row = inventory(state).find(row => row.id === id);
    if (!row || row.ownerId !== ownerId) throw Error("The original Microsoft request owner changed.");
    const value = fn(row, state); if (value !== false) row.updatedAt = Math.max(row.updatedAt, now()); validate(row); return value;
  });
  async function idle(c, row, fn) {
    if (!await isActive(c)) throw Error("Select this exact workspace before reviewing its saved Microsoft outcome.");
    const result = await store.tryWithResourceLock("copilot-request", copilotRequestResource(c, row.account, row.clientId), async lease => { lease.assert(); if (!await isActive(c)) throw Error("The selected Microsoft review workspace changed."); const value = await fn(); lease.assert(); if (!await isActive(c)) throw Error("The selected Microsoft review workspace changed."); return value; });
    if (!result.acquired) throw Error("The original Microsoft request owner has not settled. Stop it and wait; no outcome was resolved.");
    return result.value;
  }
  const reviewScope = (c, row, state) => ({ action: "resolve_copilot_request", targetSnapshotId: scopeHash([schema, c, row.id]), scopeDigest: scopeHash([row, state.policy, state.mode, state.accounts]) });
  return {
    assertOwned,
    async assertCurrent(c, id, status) { assertOwned(await store.snapshot(c), id, status); },
    async assertAvailable(c, account) { if (inventory(await store.snapshot(c)).some(row => row.account.toLowerCase() === account.toLowerCase() && !terminal.has(row.status))) throw Error("A Microsoft request for this account has an unresolved outcome. Review the original request before another delivery."); },
    async reserve(c, input, assertCurrent) {
      const { account, clientId, conversationId, sessionId, scopeDigest, requestId = null } = input;
      if (!digest(scopeDigest) || requestId !== null && !uuid(requestId)) throw Error("Bind one exact Microsoft request and payload digest.");
      const normalizedId = requestId?.toLowerCase() ?? null, requestKey = scopeHash([schema, account.toLowerCase(), clientId.toLowerCase(), normalizedId ?? scopeDigest]);
      return store.update(c, "m365-request-reserve", state => {
        assertCurrent(); const rows = inventory(state), current = now();
        const previous = rows.find(row => row.requestKey === requestKey && (normalizedId !== null || !terminal.has(row.status) || row.status === "completed" && current - row.createdAt <= 300000));
        if (previous) {
          if (previous.scopeDigest !== scopeDigest) throw Error("The original Microsoft request ID names different content. It was not replayed.");
          if (previous.status !== "completed") throw Error("The original Microsoft request is pending or unconfirmed. Inspect and separately review its outcome; no automatic retry was sent.");
          return { row: structuredClone(previous), reused: true };
        }
        const tombstones = state.copilotRequestTombstones ?? {};
        if (!tombstones || typeof tombstones !== "object" || Array.isArray(tombstones) || Object.keys(tombstones).length > 4096 || Object.entries(tombstones).some(([id, hash]) => !uuid(id) || !digest(hash))) throw Error("Preserve the original Microsoft request tombstones.");
        if (normalizedId && Object.hasOwn(tombstones, normalizedId)) throw Error("The original Microsoft request is retired; its identity cannot be reused or submitted again.");
        if (rows.some(row => row.account.toLowerCase() === account.toLowerCase() && !terminal.has(row.status))) throw Error("A Microsoft request for this account has an unresolved outcome. Review the original request before another delivery.");
        const kept = [...rows.filter(row => !terminal.has(row.status)), ...rows.filter(row => terminal.has(row.status)).slice(-64)];
        if (kept.length >= 128 || normalizedId && Object.keys(tombstones).length >= 4096) throw Error("The bounded Microsoft request inventory is full. Original outcomes were preserved.");
        const row = validate({ schema, id: randomUUID(), requestId: normalizedId, requestKey, scopeDigest, account, clientId, conversationId, sessionId, ownerId, phase: "reserved", status: "reserved", attempted: false, createdAt: current, updatedAt: current, responseDigest: null, originalOutcome: null, reviewedAt: null });
        state.copilotRequests = [...kept, row]; state.copilotRequestTombstones = tombstones; if (normalizedId) tombstones[normalizedId] = requestKey;
        return { row: structuredClone(row), reused: false };
      }, { provider: "microsoft-365-copilot", account });
    },
    enter(c, id, phase, assertCurrent) {
      if (!["creating", "submitting"].includes(phase)) throw Error("Microsoft delivery accepts only a fixed external phase.");
      return update(c, id, "m365-request-delivery", assertCurrent, row => {
        if (phase === "creating" ? row.status !== "reserved" || row.sessionId !== null : !["reserved", "created"].includes(row.status) || !uuid(row.sessionId)) throw Error("The original Microsoft delivery phase changed; it cannot be replayed.");
        row.attempted = true; row.phase = phase; row.status = phase;
      });
    },
    created(c, id, sessionId, assertCurrent) {
      if (!uuid(sessionId)) throw Error("The remote Microsoft conversation identity did not verify.");
      return update(c, id, "m365-request-created", assertCurrent, row => { if (row.status !== "creating" || row.sessionId !== null) throw Error("The original Microsoft creation was already observed or changed."); row.sessionId = sessionId; row.phase = "created"; row.status = "created"; });
    },
    complete(c, id, conversation, assertCurrent) {
      return update(c, id, "m365-request-completed", assertCurrent, (row, state) => {
        const saved = state.conversations.find(saved => saved.id === conversation.id);
        if (row.status !== "submitting" || !saved || row.conversationId !== saved.id || saved.lastCopilotRequestId !== id || saved.account !== row.account || saved.sessionId !== row.sessionId || copilotResponseDigest(saved) !== copilotResponseDigest(conversation)) throw Error("The exact Microsoft response was not durably recorded.");
        row.conversationId = saved.id; row.responseDigest = copilotResponseDigest(saved); row.phase = "reply-recorded"; row.status = "completed";
      });
    },
    fail(c, id) { return update(c, id, "m365-request-unconfirmed", () => {}, row => { if (terminal.has(row.status)) return false; row.status = row.attempted ? "outcome-unconfirmed" : "not-started"; row.originalOutcome = row.status; }); },
    async list(c) { return inventory(await store.snapshot(c)).map(view); },
    async review(c, id) {
      if (!uuid(id)) throw Error("Choose one exact saved Microsoft request.");
      const initial = inventory(await store.snapshot(c)).find(row => row.id === id); if (!initial || terminal.has(initial.status)) throw Error("This Microsoft outcome does not require review.");
      return idle(c, initial, async () => {
        const state = await store.snapshot(c), row = inventory(state).find(row => row.id === id); if (!row || terminal.has(row.status)) throw Error("The original Microsoft outcome changed.");
        const confirmation = await suiteConfirmations(store, c, undefined, now).issue({ ...reviewScope(c, row, state), reason: "Acknowledge this original uncertain Microsoft outcome locally. This does not cancel remote processing, undo effects, replay a request or verify completion. Any later design submission is a separate deliberate request.", reauthenticated: false });
        return { status: "requires-confirmation", request: view(row), confirmation, modelPromptSubmitted: false };
      });
    },
    async resolve(c, input) {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["id", "token", "compartment"].includes(key))) throw Error("Resolve only the exact original Microsoft request and one-use token.");
      const { id, token } = input;
      if (!uuid(id) || !uuid(token)) throw Error("Use the exact one-use approval for this saved Microsoft outcome.");
      const initial = inventory(await store.snapshot(c)).find(row => row.id === id); if (!initial || terminal.has(initial.status)) throw Error("This Microsoft outcome is unavailable or already reviewed.");
      return idle(c, initial, async () => {
        const state = await store.snapshot(c), row = inventory(state).find(row => row.id === id); if (!row || terminal.has(row.status)) throw Error("The original Microsoft outcome changed.");
        const scope = reviewScope(c, row, state), decision = await suiteConfirmations(store, c, undefined, now).consume({ ...scope, token }); if (!decision.allowed) throw Error(decision.reason);
        return store.update(c, "m365-request-outcome-reviewed", saved => {
          const current = inventory(saved).find(row => row.id === id);
          if (!current || scopeHash([current, saved.policy, saved.mode, saved.accounts]) !== scope.scopeDigest) throw Error("The reviewed Microsoft outcome or policy changed; original state was preserved.");
          current.originalOutcome ??= current.attempted ? "outcome-unconfirmed" : "not-started"; current.status = "reviewed-unconfirmed"; current.reviewedAt = Math.max(current.updatedAt, now()); current.updatedAt = current.reviewedAt; validate(current); return { ...view(current), modelPromptSubmitted: false };
        });
      });
    }
  };
}
