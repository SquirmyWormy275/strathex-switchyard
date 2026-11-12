/** Opt-in metadata from the protected local execution journal, never provider completion. */
import { createHash } from "node:crypto";
import { connectedExecutionActions } from "./repository-execution-actions.mjs";
import { observationAcceptsEventAt } from "./workflow.mjs";

const actions = new Set([...connectedExecutionActions("linux"), ...connectedExecutionActions("win32")]);
const adapters = new Set(["switchyard-host-execution/v1", "switchyard-windows-execution/v1"]);
const results = new Set(["passed", "failed", "unavailable", "incomplete", "not_run"]);
const commandStatuses = new Set(["queued", "running", "awaiting_input", "awaiting_confirmation", "cancelling", "completed", "failed", "timed_out", "unavailable", "incomplete", "blocked", "cancelled"]);
const identity = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);

/** Called only after appending an entry inside the existing locked AEAD transaction. */
export function appendHostActionObservation(state, domain, entry) {
  if (domain !== "execution" || state.policy !== "personal" || state.mode !== "personal-companion") return 0;
  if (!state.observations?.some(o => o.status === "recording" && o.sources?.includes("host-action-events") && Array.isArray(o.events))) return 0;
  const entries = state.repositoryExecutionJournal;
  if (!Array.isArray(entries) || entries.at(-1) !== entry) return 0;
  let operationEntry, receipt, audit, phase, status;
  if (entry.kind === "operation.created") {
    operationEntry = entry; phase = "host-action-prepared"; status = "prepared";
  } else if (entry.kind === "receipt.issued" || entry.kind === "receipt.invalidated") {
    receipt = entry.kind === "receipt.issued" ? entry.payload?.receipt : entries.findLast(e => e.sequence < entry.sequence && e.kind === "receipt.issued" && e.payload?.receipt?.id === entry.payload?.receiptId)?.payload.receipt;
    if (!receipt || !results.has(receipt.result)) return 0;
    operationEntry = entries.find(e => e.sequence < entry.sequence && e.kind === "operation.created" && e.payload?.operation?.id === receipt.operationId);
    phase = entry.kind === "receipt.issued" ? "host-action-receipt-recorded" : "host-action-receipt-invalidated";
    status = entry.kind === "receipt.issued" ? receipt.result : "invalidated";
  } else if (entry.kind === "audit.recorded") {
    audit = entry.payload?.audit;
    if (!audit || !commandStatuses.has(audit.status)) return 0;
    operationEntry = entries.find(e => e.sequence < entry.sequence && e.kind === "operation.created" && e.payload?.operation?.id === audit.operationId);
    phase = "host-action-result-recorded"; status = audit.status;
  } else return 0;
  const operation = operationEntry?.payload?.operation;
  if (!operation || operation.parentId || !identity(operation.id) || !actions.has(operation.action) || !identity(operation.details?.sessionId)) return 0;
  if (receipt && (receipt.action !== operation.action || receipt.targetSnapshotId !== operation.targetSnapshotId)) return 0;
  if (audit && (audit.action !== operation.action || audit.targetSnapshotId !== operation.targetSnapshotId)) return 0;
  // Bind to the session that existed when this operation was prepared. Later reuse
  // or provider changes must not relabel an earlier operation or its receipts.
  const session = entries.findLast(e => e.sequence < operationEntry.sequence && ["session.registered", "session.updated"].includes(e.kind) && e.payload?.session?.id === operation.details.sessionId)?.payload.session;
  const provider = session?.metadata?.nativeProvider;
  if (!session || session.provider !== "generic" || session.surface !== "bridge" || !adapters.has(session.adapterVersion) || !session.capabilities?.includes("mediated") || session.targetSnapshotId !== operation.targetSnapshotId || !["codex", "claude-code"].includes(provider)) return 0;
  const at = Date.parse(entry.at);
  if (!Number.isSafeInteger(at) || at < 0) return 0;
  const subjectDigest = createHash("sha256").update(JSON.stringify(["switchyard-observed-host-action/v1", state.id, provider, operation.id])).digest("hex");
  const category = provider === "codex" ? "codex" : "claude";
  let recorded = 0;
  for (const observation of state.observations ?? []) {
    if (observation.status !== "recording" || !observation.sources?.includes("host-action-events") || observation.exclusions?.includes(category) || !Array.isArray(observation.events) || !observationAcceptsEventAt(observation, at)) continue;
    const previous = observation.events.findLast(e => e?.subjectDigest === subjectDigest && e.phase === phase);
    if (previous && (at < previous.at || previous.status === status)) continue;
    if (observation.events.length >= 2000) { observation.status = "paused"; observation.limitReached = true; observation.updatedAt = Math.max(observation.updatedAt ?? at, at); continue; }
    observation.events.push({ kind: "status", provider, phase, status, intent: operation.action, subjectDigest, provenance: "switchyard-local-host-action", at, taskCompletionVerified: false, timeSavingMeasured: false });
    observation.updatedAt = Math.max(observation.updatedAt ?? at, at); recorded++;
  }
  return recorded;
}
