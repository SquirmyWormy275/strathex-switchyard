/** Opt-in metadata only. An observed provider status never proves task completion. */
import { createHash } from "node:crypto";
import { observationAcceptsEventAt } from "./workflow.mjs";
import { agentIntents } from "../../integrations/agent-protocol.mjs";

const providers = new Set(["codex", "claude-code", "custom-agent"]);
const phases = new Set(["request-reserved", "identity-bound", "outcome-unconfirmed", "status-observed", "runtime-status-observed", "read-only-resume-observed", "owned-stop-observed", "adapter-status-observed", "design-request-reserved", "design-reply-recorded", "design-request-failed", "text-request-reserved", "text-identity-bound", "text-reply-recorded", "text-outcome-unconfirmed", "text-request-failed", "text-outcome-reviewed"]);
const statuses = new Set(["active", "idle", "waiting-on-approval", "not-observed", "unreachable", "unknown", "waiting-for-input", "running", "stopped", "done", "error", "failed", "ready", "busy", "waiting", "blocked", "reserved-locally", "provider-turn-finished"]);
const commandPhases = new Map([
  ["adapter-command-queued", ["reserved-locally"]], ["adapter-command-claimed", ["running"]],
  ["adapter-command-acknowledged", ["done", "failed", "stopped"]], ["adapter-command-retired", ["stopped", "unknown"]],
  ["adapter-command-outcome-reviewed", ["unknown"]]
]);

export function appendAgentObservation(state, { provider, subjectId, phase, status, intent, at }) {
  const commandPhase = commandPhases.has(phase);
  if (phase === "runtime-status-observed" && provider !== "codex") return 0;
  if (!providers.has(provider) || !phases.has(phase) && !commandPhase || typeof subjectId !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/.test(subjectId) || !Number.isSafeInteger(at) || at < 0) return 0;
  if (provider === "custom-agent" ? phase !== "adapter-status-observed" && !commandPhase : phase === "adapter-status-observed" || commandPhase) return 0;
  if (commandPhase && (!agentIntents.includes(intent) || !commandPhases.get(phase).includes(status))) return 0;
  if (state.policy !== "personal" || state.mode !== "personal-companion") return 0;
  const category = provider === "codex" ? "codex" : provider === "claude-code" ? "claude" : "other";
  const subjectDigest = createHash("sha256").update(JSON.stringify([commandPhase ? "switchyard-observed-agent-command/v1" : "switchyard-observed-agent/v1", state.id, provider, subjectId])).digest("hex");
  const observedStatus = statuses.has(status) ? status : "unknown";
  const provenance = phase === "adapter-status-observed" || phase === "adapter-command-acknowledged" ? "authenticated-agent-self-report" : phase === "runtime-status-observed" ? "native-provider-runtime-notification" : phase === "status-observed" ? "native-provider-status-observation" : "switchyard-local-lifecycle";
  let recorded = 0;
  for (const observation of state.observations ?? []) {
    if (observation.status !== "recording" || !observation.sources?.includes("agent-events") || observation.exclusions?.includes(category) || !Array.isArray(observation.events) || !observationAcceptsEventAt(observation, at)) continue;
    if (observation.events.length >= 2000) { observation.status = "paused"; observation.limitReached = true; continue; }
    const previous = observation.events.findLast(event => event?.provider === provider && event.subjectDigest === subjectDigest && event.phase === phase);
    if (previous && (at < previous.at || commandPhase || ["status-observed", "runtime-status-observed", "adapter-status-observed"].includes(phase) && previous.status === observedStatus)) continue;
    observation.events.push({ kind: "status", provider, phase, status: observedStatus, ...(commandPhase ? { intent } : {}), subjectDigest, provenance, at, taskCompletionVerified: false, timeSavingMeasured: false });
    observation.updatedAt = Math.max(observation.updatedAt ?? at, at); recorded++;
  }
  return recorded;
}
