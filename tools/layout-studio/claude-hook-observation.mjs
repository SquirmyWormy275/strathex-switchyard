/** Local, explicitly selected Claude hook metadata. No native task authority. */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { observationAcceptsEventAt } from "./workflow.mjs";

export const claudeHookSource = "claude-hook-events";
export const claudeHookInputBytes = 256 * 1024;
const identity = /^[A-Za-z0-9_.:-]{1,128}$/;
const observationIdentity = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function claudeHookRecipe(state, { observationId, expectedSessionId }) {
  if (typeof observationId !== "string" || !observationIdentity.test(observationId) || typeof expectedSessionId !== "string" || !identity.test(expectedSessionId)) throw Error("Choose one exact Claude session and observation destination.");
  const matches = (state.observations ?? []).filter(o => o.id === observationId);
  if (state.policy !== "personal" || state.mode !== "personal-companion" || matches.length !== 1
      || !["recording", "paused"].includes(matches[0].status) || !matches[0].sources?.includes(claudeHookSource) || matches[0].exclusions?.includes("claude")) throw Error("Start or select a Personal observation with Claude hooks explicitly enabled.");
  const command = { type: "command", command: process.execPath,
    args: [fileURLToPath(new URL("../../integrations/claude-hook.mjs", import.meta.url)), "--workspace", state.id, "--observation", observationId, "--session", expectedSessionId],
    timeout: 10, onFailure: "continue" };
  return { schema: "switchyard-claude-hook-recipe/v1", observationId, expectedSessionId,
    settings: { hooks: Object.fromEntries(["SessionStart", "UserPromptSubmit", "Notification", "Stop", "StopFailure", "SessionEnd"].map(name => [name,
      [{ ...(name === "Notification" ? { matcher: "permission_prompt|idle_prompt" } : {}), hooks: [structuredClone(command)] }]])) },
    configured: false, nativeIdentityVerified: false, providerCommandSent: false,
    boundary: "Review and merge these entries with your existing Claude Code hooks. This preview writes no settings. It records only this session's self-reported status in the selected observation; pause, stop, deletion and workspace changes still apply. No prompts, tool inputs or transcripts are saved. Native hook invocation and identity remain unverified." };
}

/** Discard all text, paths, tool inputs, account hints and nested agent reports. */
export function claudeHookMetadata(raw, expectedSessionId) {
  if (typeof expectedSessionId !== "string" || !identity.test(expectedSessionId)) throw Error("Choose one exact Claude session identity.");
  if (typeof raw !== "string" || Buffer.byteLength(raw) > claudeHookInputBytes) throw Error("The hook input exceeds its bound.");
  let input; try { input = JSON.parse(raw); } catch { throw Error("The hook input is not a JSON object."); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("The hook input is not a JSON object.");
  if (input.session_id !== expectedSessionId || Object.hasOwn(input, "agent_id")) return null;
  let status;
  switch (input.hook_event_name) {
    case "SessionStart": if (!["startup", "resume", "clear", "compact", "fork"].includes(input.source)) return null; status = "ready"; break;
    case "UserPromptSubmit": status = "busy"; break;
    case "Notification": status = input.notification_type === "permission_prompt" ? "waiting-on-approval" : input.notification_type === "idle_prompt" ? "waiting-for-input" : null; break;
    case "Stop": status = "provider-turn-finished"; break;
    case "StopFailure": status = "failed"; break;
    case "SessionEnd": status = "stopped"; break;
    default: return null;
  }
  return status ? { event: input.hook_event_name, status } : null;
}

/** The invocation time is captured before stdin/credential/lease waits. It is
 * not a vendor occurrence timestamp and never replaces an earlier consent. */
export async function recordClaudeHook({ store, compartment, observationId, expectedSessionId, raw, at, now = () => Date.now() }) {
  if (typeof compartment !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(compartment) || typeof observationId !== "string" || !observationIdentity.test(observationId)) throw Error("Choose an exact workspace and observation session.");
  if (!Number.isSafeInteger(at) || at < 0 || at > now() || now() - at > 30000) throw Error("The hook invocation is stale or invalid; no event was replayed.");
  const metadata = claudeHookMetadata(raw, expectedSessionId);
  if (!metadata) return { recorded: 0, reason: "unsupported-or-different-session" };
  const eligible = state => {
    const rows = (state.observations ?? []).filter(o => o.id === observationId);
    const o = rows.length === 1 ? rows[0] : null;
    return state.id === compartment && state.policy === "personal" && state.mode === "personal-companion"
      && o?.status === "recording" && o.sources?.includes(claudeHookSource) && !o.exclusions?.includes("claude")
      && Array.isArray(o.events) && typeof o.recordingGeneration === "string" && o.recordingGeneration
      && observationAcceptsEventAt(o, at) && at > o.recordingSince ? o : null;
  };
  if (await store.selection() !== compartment) return { recorded: 0, reason: "workspace-not-selected" };
  const original = eligible(await store.snapshot(compartment));
  if (!original) return { recorded: 0, reason: "not-consented" };
  const generation = JSON.stringify([original.id, original.createdAt, original.recordingSince, original.recordingGeneration]);
  const subjectDigest = createHash("sha256").update(JSON.stringify(["switchyard-claude-hook-subject/v1", compartment, expectedSessionId])).digest("hex");
  return store.update(compartment, "claude-hook-observation", async state => {
    const current = eligible(state);
    if (!current || generation !== JSON.stringify([current.id, current.createdAt, current.recordingSince, current.recordingGeneration])
        || await store.selection() !== compartment || at > now() || now() - at > 30000) return { recorded: 0, reason: "consent-changed-or-stale" };
    if (current.events.length >= 2000) { current.status = "paused"; current.limitReached = true; return { recorded: 0, reason: "capacity" }; }
    const previous = current.events.findLast(e => e.provenance === "unverified-local-claude-hook" && e.subjectDigest === subjectDigest);
    if (previous && (at <= previous.at || previous.status === metadata.status && previous.hookEvent === metadata.event)) return { recorded: 0, reason: "duplicate-or-out-of-order" };
    current.events.push({ kind: "status", provider: "claude-code", phase: "hook-status-reported", hookEvent: metadata.event,
      status: metadata.status, subjectDigest, provenance: "unverified-local-claude-hook", at, timeBasis: "hook-process-invocation",
      nativeIdentityVerified: false, taskCompletionVerified: false, timeSavingMeasured: false });
    current.updatedAt = Math.max(current.updatedAt ?? at, at);
    return { recorded: 1, taskCompletionVerified: false, nativeIdentityVerified: false };
  }, { provider: "claude-code", operation: "record" });
}
