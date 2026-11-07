/** Fixed runtime metadata from an already authorized owned turn; no subscription or provider request. */
import { appendAgentObservation } from "./agent-observation.mjs";
import { observationAcceptsEventAt } from "./workflow.mjs";

export function codexRuntimeStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort().join();
  if (keys === "type") { const fixed = { notLoaded: "not-observed", idle: "idle", systemError: "error" }; return typeof value.type === "string" && Object.hasOwn(fixed, value.type) ? fixed[value.type] : null; }
  if (keys !== "activeFlags,type" || value.type !== "active" || !Array.isArray(value.activeFlags)
    || value.activeFlags.length > 1 || value.activeFlags.some(flag => flag !== "waitingOnApproval")) return null;
  return value.activeFlags.length ? "waiting-on-approval" : "active";
}

const eligible = (session, at) => session.status === "recording" && session.sources?.includes("agent-events")
  && !session.exclusions?.includes("codex") && Array.isArray(session.events) && observationAcceptsEventAt(session, at);
export async function recordCodexRuntimeStatus({ store, compartment, subjectId, status, at, assertCurrentState }) {
  if (!["not-observed", "idle", "error", "active", "waiting-on-approval"].includes(status) || !Number.isSafeInteger(at) || at < 0) throw Error("Invalid closed runtime observation.");
  const before = await store.snapshot(compartment, { provider: "codex" }); assertCurrentState(before);
  if (before.policy !== "personal" || before.mode !== "personal-companion") return 0;
  const sessions = new Map((before.observations ?? []).filter(session => eligible(session, at))
    .map(session => [session.id, JSON.stringify([session.createdAt, session.recordingSince])]));
  if (!sessions.size) return 0;
  return store.update(compartment, "codex-runtime-observation", state => {
    assertCurrentState(state);
    // A newly created/resumed recording cannot inherit an older queued event.
    const observations = (state.observations ?? []).filter(session => sessions.get(session.id) === JSON.stringify([session.createdAt, session.recordingSince]));
    return appendAgentObservation({ ...state, observations }, { provider: "codex", subjectId, phase: "runtime-status-observed", status, at });
  }, { provider: "codex" });
}
