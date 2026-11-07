/** Explicit, source-bound observation summaries for a configuration request.
 * Recording consent alone never authorizes sending observations to a provider. */
import { scopeHash } from "./confirmations.mjs";

const kinds = ["interruption", "resume", "switch", "handoff", "status", "review", "approval", "failure", "recovery", "other"];
const categories = ["terminal", "vscode", "chatgpt", "claude", "codex", "browser", "other"];
const sources = ["deliberate", "foreground-category", "agent-events", "host-action-events", "editor-events"];
const provenance = new Map([
  ["user-marked", "deliberate"], ["authenticated-agent-self-report", "agent-events"],
  ["native-provider-status-observation", "agent-events"], ["switchyard-local-lifecycle", "agent-events"],
  ["switchyard-local-host-action", "host-action-events"], ["switchyard-editor-journal", "editor-events"]
]);
const refuse = () => { throw new Error("Choose stopped or paused observations from this personal workspace and review their exact summary for this designer. No observation context was sent."); };

export function reviewDesignObservations(state, provider, sessionIds) {
  if (state.policy !== "personal" || state.mode !== "personal-companion" || !["codex", "claude-code"].includes(provider)
      || !Array.isArray(sessionIds) || !sessionIds.length || sessionIds.length > 8 || new Set(sessionIds).size !== sessionIds.length
      || sessionIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9_.:-]{1,64}$/.test(id))) refuse();
  const selected = sessionIds.map(id => {
    const matches = (state.observations ?? []).filter(s => s.id === id);
    if (matches.length !== 1) refuse();
    const s = matches[0];
    if (!["paused", "stopped", "interrupted"].includes(s.status) || !Array.isArray(s.sources) || !s.sources.length
        || s.sources.some(source => !sources.includes(source)) || !Array.isArray(s.events) || s.events.length > 2000
        || !Array.isArray(s.exclusions) || s.exclusions.some(category => !categories.includes(category))) refuse();
    return s;
  });
  const sessions = selected.map((s, index) => {
    const counts = new Map();
    for (const event of s.events) {
      if (!event || !kinds.includes(event.kind) || !provenance.has(event.provenance) || !s.sources.includes(provenance.get(event.provenance))) refuse();
      const key = event.kind + ":" + event.provenance;
      const row = counts.get(key) ?? { kind: event.kind, provenance: event.provenance, count: 0 };
      row.count++; counts.set(key, row);
    }
    const focus = s.focusCategories ?? {};
    if (!focus || typeof focus !== "object" || Array.isArray(focus) || Object.keys(focus).some(category => !categories.includes(category)
        || !s.sources.includes("foreground-category") || s.exclusions.includes(category) || !Number.isSafeInteger(focus[category]) || focus[category] < 0)) refuse();
    return { number: index + 1, eventCounts: [...counts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => row),
      sampledCategoryMilliseconds: Object.fromEntries(Object.keys(focus).sort().map(category => [category, focus[category]])) };
  });
  const context = { schema: "switchyard-design-observations/v1", sessions,
    boundary: "Selected aggregate observations only. Category durations are sampled estimates. Marks and agent reports do not establish intent, task completion or time saved. Ask the person before proposing a process change." };
  const scope = JSON.stringify([state.id, state.policy, state.mode, state.modeSelectedAt, state.accounts, provider, sessionIds, selected]);
  if (Buffer.byteLength(scope) > 8 * 1024 * 1024) refuse();
  return { reviewId: scopeHash(["switchyard-design-observation-review/v1", scope, context]), provider, sessionIds: [...sessionIds], context,
    confirmation: "Send this exact aggregate snapshot with one design request. Raw events, timestamps, session/agent identities and content are excluded. Recording consent does not send it; deletion cannot recall an already sent request." };
}

export function reviewedDesignObservations(state, provider, review) {
  if (review === undefined) return undefined;
  if (!review || Object.keys(review).sort().join() !== "confirmed,reviewId,sessionIds" || review.confirmed !== true
      || typeof review.reviewId !== "string" || !/^[a-f0-9]{64}$/.test(review.reviewId)) refuse();
  const current = reviewDesignObservations(state, provider, review.sessionIds);
  if (review.reviewId !== current.reviewId) throw new Error("The selected observations, provider or workspace changed. Review the current summary before sending it.");
  return current.context;
}
