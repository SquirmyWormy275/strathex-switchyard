import test from "node:test";
import assert from "node:assert/strict";
import { appendAgentObservation } from "./agent-observation.mjs";
import { observationAcceptsEventAt } from "./workflow.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const session = changes => ({ id: "observation", status: "recording", sources: ["agent-events"], exclusions: [], events: [], updatedAt: 10, ...changes });
const state = changes => ({ id: "personal", policy: "personal", mode: "personal-companion", observations: [session()], ...changes });
const event = changes => ({ provider: "codex", subjectId: "private-native-subject", phase: "status-observed", status: "active", at: 20, ...changes });

test("agent metadata respects initial consent and the latest resumed recording interval", () => {
  for (const timing of [{ createdAt: 21 }, { createdAt: 0, recordingSince: 21 }]) {
    const s = state({ observations: [session(timing)] }), before = structuredClone(s);
    assert.equal(appendAgentObservation(s, event()), 0); assert.deepEqual(s, before);
    assert.equal(appendAgentObservation(s, event({ at: 21 })), 1);
    assert.equal(s.observations[0].events[0].at, 21);
  }
  for (const boundary of [-1, NaN, Infinity, 1.5, "20", null]) {
    assert.equal(observationAcceptsEventAt({ createdAt: boundary }, 20), false);
    assert.equal(observationAcceptsEventAt({ createdAt: 0, recordingSince: boundary }, 20), false);
  }
  assert.equal(observationAcceptsEventAt({ createdAt: 21, recordingSince: 10 }, 20), false);
  assert.equal(observationAcceptsEventAt({ createdAt: 20 }, 20), true);
});

test("the native host proof refuses absent, broader or unrecognized flags before account, workspace or process access", () => {
  const script = fileURLToPath(new URL("../../scripts/verify-agent-observation-host.mjs", import.meta.url));
  for (const args of [[], ["--synthetic"], ["--synthetic-native-metadata", "extra"], ["--synthetic-native-metadata", "--provider=claude-code"], ["--synthetic-reviewed-text-metadata", "extra"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined); assert.notEqual(result.status, 0); assert.equal(result.stdout, ""); assert.match(result.stderr, /Usage on the pilot/);
  }
});

test("recording requires the explicit agent source, personal companion mode and a non-excluded provider category", () => {
  for (const s of [state({ mode: "keyboard-only" }), state({ policy: "work", mode: "managed-companion" }), state({ observations: [session({ status: "paused" })] }), state({ observations: [session({ status: "stopped" })] }), state({ observations: [session({ sources: ["deliberate"] })] }), state({ observations: [session({ exclusions: ["codex"] })] })]) {
    const before = structuredClone(s); assert.equal(appendAgentObservation(s, event()), 0); assert.deepEqual(s, before);
  }
  for (const [provider, category] of [["claude-code", "claude"], ["custom-agent", "other"]]) { const s = state({ observations: [session({ exclusions: [category] })] }); assert.equal(appendAgentObservation(s, event({ provider, phase: provider === "custom-agent" ? "adapter-status-observed" : "status-observed" })), 0); }
});
test("metadata omits raw identities and content while retaining compartment-specific correlation and honest provenance", () => {
  const s = state(); assert.equal(appendAgentObservation(s, { ...event(), prompt: "NEVER_RETAIN", repository: "/NEVER_RETAIN", account: "NEVER_RETAIN" }), 1);
  const row = s.observations[0].events[0]; assert.equal(row.provenance, "native-provider-status-observation"); assert.equal(row.taskCompletionVerified, false); assert.equal(row.timeSavingMeasured, false); assert.match(row.subjectDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(row).includes("private-native-subject"), false); assert.equal(JSON.stringify(row).includes("NEVER_RETAIN"), false);
  const other = state({ id: "other" }); appendAgentObservation(other, event()); assert.notEqual(other.observations[0].events[0].subjectDigest, row.subjectDigest);
  const local = state(); appendAgentObservation(local, event({ phase: "request-reserved" })); assert.equal(local.observations[0].events[0].provenance, "switchyard-local-lifecycle");
  const custom = state(); appendAgentObservation(custom, event({ provider: "custom-agent", phase: "adapter-status-observed", status: "ready" })); assert.equal(custom.observations[0].events[0].provenance, "authenticated-agent-self-report");
});
test("identical status polls collapse while changed and unknown statuses remain non-authoritative metadata", () => {
  const s = state(); assert.equal(appendAgentObservation(s, event()), 1); assert.equal(appendAgentObservation(s, event({ at: 21 })), 0); assert.equal(appendAgentObservation(s, event({ status: "idle", at: 22 })), 1); assert.equal(appendAgentObservation(s, event({ status: "active", at: 21 })), 0);
  assert.equal(appendAgentObservation(s, event({ status: "NEVER_RETAIN provider text", at: 23 })), 1); assert.equal(s.observations[0].events.at(-1).status, "unknown"); assert.equal(JSON.stringify(s).includes("NEVER_RETAIN"), false);
  assert.equal(appendAgentObservation(s, event({ provider: "claude-code", status: "provider-turn-finished", at: 24 })), 1); assert.equal(s.observations[0].events.at(-1).taskCompletionVerified, false);
});
test("full observations pause without removing original events, and malformed event identities do not collect data", () => {
  const s = state({ observations: [session({ events: Array.from({ length: 2000 }, () => ({ kind: "status", provenance: "original" })) })] }), before = structuredClone(s.observations[0].events);
  assert.equal(appendAgentObservation(s, event()), 0); assert.equal(s.observations[0].status, "paused"); assert.equal(s.observations[0].limitReached, true); assert.deepEqual(s.observations[0].events, before);
  for (const changed of [{ provider: "unregistered" }, { provider: "custom-agent", phase: "identity-bound" }, { phase: "adapter-status-observed" }, { phase: "task-complete" }, { subjectId: "/private/path" }, { subjectId: "x".repeat(257) }, { at: -1 }, { at: NaN }]) { const clean = state(); assert.equal(appendAgentObservation(clean, event(changed)), 0); assert.equal(clean.observations[0].events.length, 0); }
});
