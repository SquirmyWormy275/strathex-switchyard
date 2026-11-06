/** Opt-in historical metadata from the protected editor journal, never live IDE authority. */
import { createHash } from "node:crypto";
import { observationAcceptsEventAt } from "./workflow.mjs";

const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const phases = {
  reserved: "editor-connection-reserved",
  acknowledged: "editor-protocol-acknowledged",
  stopped: "editor-resources-retired",
  uncertain: "editor-retirement-unconfirmed"
};
const retirementFields = ["upstreamExitVerified", "carrierExitVerified", "socketRemovedVerified", "directoryRemovedVerified"];

/** Runs inside the existing journal transaction; it performs no I/O or provider call. */
export function appendEditorObservation(state, row) {
  if (state.policy !== "personal" || state.mode !== "personal-companion") return 0;
  if (!state.observations?.some(o => o.status === "recording" && o.sources?.includes("editor-events"))) return 0;
  if (!row || !state.codingEditorConnections?.includes(row) || row.schema !== "switchyard-editor-connection/v1"
      || !uuid(row.requestId) || !uuid(row.editorId) || !Object.hasOwn(phases, row.status)) return 0;
  if (row.status === "acknowledged" && row.acknowledgement?.protocolAcknowledged !== true) return 0;
  if (["stopped", "uncertain"].includes(row.status)) {
    const facts = row.retirement;
    if (!facts || retirementFields.some(key => typeof facts[key] !== "boolean")
        || Object.keys(facts).some(key => ![...retirementFields, "hostExitVerified"].includes(key))
        || Object.hasOwn(facts, "hostExitVerified") && typeof facts.hostExitVerified !== "boolean"
        || (row.status === "stopped") !== Object.values(facts).every(value => value === true)) return 0;
  }
  const at = row.updatedAt ?? row.createdAt;
  if (!Number.isSafeInteger(at) || at < 0) return 0;
  const subjectDigest = createHash("sha256").update(JSON.stringify([
    "switchyard-observed-editor/v1", state.id, row.requestId, row.editorId
  ])).digest("hex");
  const phase = phases[row.status];
  let recorded = 0;
  for (const observation of state.observations ?? []) {
    if (observation.status !== "recording" || !observation.sources?.includes("editor-events") || !Array.isArray(observation.events)
        || ["codex", "vscode", "terminal"].some(category => observation.exclusions?.includes(category))
        || !observationAcceptsEventAt(observation, at)) continue;
    const previous = observation.events.findLast(event => event?.subjectDigest === subjectDigest);
    if (previous && (at < previous.at || previous.phase === phase)) continue;
    if (observation.events.length >= 2000) {
      observation.status = "paused"; observation.limitReached = true;
      observation.updatedAt = Math.max(observation.updatedAt ?? at, at); continue;
    }
    observation.events.push({
      kind: "status", provider: "codex", phase, status: row.status, subjectDigest,
      provenance: "switchyard-editor-journal", at,
      ideAttached: false, taskCompletionVerified: false, timeSavingMeasured: false
    });
    observation.updatedAt = Math.max(observation.updatedAt ?? at, at); recorded++;
  }
  return recorded;
}
