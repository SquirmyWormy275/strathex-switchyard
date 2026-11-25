import test from "node:test";
import assert from "node:assert/strict";
import { appendAgentObservation, captureAgentObservation } from "./agent-observation.mjs";
import { observationAcceptsEventAt } from "./workflow.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { codexRuntimeStatus, recordCodexRuntimeStatus } from "./codex-runtime-observation.mjs";

test("native runtime status accepts only fixed supported metadata and no prototype fields", () => {
  for (const [input, expected] of [[{ type: "idle" }, "idle"], [{ type: "notLoaded" }, "not-observed"], [{ type: "systemError" }, "error"], [{ type: "active", activeFlags: [] }, "active"], [{ type: "active", activeFlags: ["waitingOnApproval"] }, "waiting-on-approval"]]) assert.equal(codexRuntimeStatus(input), expected);
  for (const input of [null, [], { type: "toString" }, { type: "__proto__" }, { type: "active" }, { type: "idle", content: "NEVER_RETAIN" }, { type: "active", activeFlags: ["unknown"] }, { type: "active", activeFlags: ["waitingOnApproval", "waitingOnApproval"] }]) assert.equal(codexRuntimeStatus(input), null);
});

function runtimeFixture(changes = {}) {
  let value = state(changes), writes = 0, beforeWrite = () => {}, valid = true;
  const store = { async snapshot() { return structuredClone(value); }, async update(_id, _operation, mutation) { beforeWrite(value); const draft = structuredClone(value), result = mutation(draft); value = draft; writes++; return result; } };
  const record = (overrides = {}) => recordCodexRuntimeStatus({ store, compartment: "personal", subjectId: "private-runtime-subject", status: "active", at: 20, assertCurrentState() { if (!valid) throw Error("Original binding changed"); }, ...overrides });
  return { record, get value() { return value; }, get writes() { return writes; }, beforeWrite(fn) { beforeWrite = fn; }, invalidate() { valid = false; } };
}
test("runtime recording preserves fixed provenance, private correlation and duplicate suppression", async () => {
  const f = runtimeFixture(); assert.equal(await f.record(), 1); assert.equal(await f.record(), 0); assert.equal(await f.record({ status: "idle", at: 21 }), 1);
  const rows = f.value.observations[0].events;
  assert.deepEqual(rows.map(row => row.status), ["active", "idle"]); assert.equal(rows[0].subjectDigest, rows[1].subjectDigest);
  assert(rows.every(row => row.provenance === "native-provider-runtime-notification" && row.taskCompletionVerified === false && row.timeSavingMeasured === false));
  assert.equal(JSON.stringify(rows).includes("private-runtime-subject"), false);
});
test("runtime recording without source consent, in Work, or outside the recording interval does not write", async () => {
  for (const changes of [{ policy: "work" }, { mode: "keyboard-only" }, { observations: [] }, { observations: [session({ sources: ["deliberate"] })] }, { observations: [session({ status: "paused" })] }, { observations: [session({ exclusions: ["codex"] })] }, { observations: [session({ createdAt: 21 })] }, { observations: [session({ recordingSince: 21 })] }]) { const f = runtimeFixture(changes); assert.equal(await f.record(), 0); assert.equal(f.writes, 0); }
});
test("queued runtime metadata cannot enter a resumed or newly added recording", async () => {
  const f = runtimeFixture(); f.beforeWrite(value => { value.observations[0].recordingSince = 20; value.observations.push(session({ id: "new", createdAt: 10 })); });
  assert.equal(await f.record(), 0); assert(f.value.observations.every(row => row.events.length === 0));
  const paused = runtimeFixture(); paused.beforeWrite(value => { value.observations[0].status = "paused"; }); assert.equal(await paused.record(), 0); assert.equal(paused.value.observations[0].events.length, 0);
});
test("queued runtime metadata cannot inherit a different consent interval with identical timestamps", async () => {
  for (const initial of [undefined, "old-interval"]) {
    const f = runtimeFixture({ observations: [session({ createdAt: 10, recordingSince: 10, recordingGeneration: initial })] });
    f.beforeWrite(value => { value.observations[0].recordingGeneration = "new-interval"; });
    assert.equal(await f.record(), 0);
    assert.equal(f.value.observations[0].events.length, 0);
  }
});
test("runtime metadata at the exact renewed-consent timestamp remains ambiguous", async () => {
  const f = runtimeFixture({ observations: [session({ createdAt: 10, recordingSince: 20, recordingGeneration: "new-interval" })] });
  assert.equal(await f.record(), 0); assert.equal(f.writes, 0);
  assert.equal(await f.record({ at: 21 }), 1);
});
test("runtime binding change under the encrypted mutation refuses before storing metadata", async () => {
  const f = runtimeFixture(); f.beforeWrite(() => f.invalidate()); await assert.rejects(f.record(), /Original binding changed/); assert.equal(f.writes, 0); assert.equal(f.value.observations[0].events.length, 0);
});

const session = changes => ({ id: "observation", status: "recording", sources: ["agent-events"], exclusions: [], events: [], updatedAt: 10, ...changes });
const state = changes => ({ id: "personal", policy: "personal", mode: "personal-companion", observations: [session()], ...changes });
const event = changes => ({ provider: "codex", subjectId: "private-native-subject", phase: "status-observed", status: "active", at: 20, ...changes });
const commandEvent = changes => event({ provider: "custom-agent", subjectId: "private-command", phase: "adapter-command-queued", status: "reserved-locally", intent: "handoff", ...changes });

test("captured external observation consent preserves its original time and refuses replacement or new recordings", () => {
  const fresh = () => state({ observations: [session({ createdAt: 10, recordingSince: 10, recordingGeneration: "original" })] });
  const metadata = { subjectId: "private-adapter", phase: "adapter-status-observed", status: "busy" };
  for (const mutate of [s => { s.id = "different"; }, s => { s.observations[0].recordingGeneration = "replacement"; }, s => { s.observations[0].status = "paused"; }, s => { s.observations[0].sources = ["deliberate"]; }, s => { s.observations[0].exclusions = ["other"]; }, s => { s.mode = "keyboard-only"; }]) {
    const s = fresh(), record = captureAgentObservation(s, { provider: "custom-agent", at: 20 }); mutate(s);
    assert.equal(record(s, metadata), 0); assert.equal(s.observations[0].events.length, 0);
  }
  const s = fresh(), record = captureAgentObservation(s, { provider: "custom-agent", at: 20 });
  s.observations.push(session({ id: "new-recording", createdAt: 10, recordingSince: 10, recordingGeneration: "original" }));
  assert.equal(record(s, { ...metadata, at: 99, provider: "codex" }), 1);
  assert.equal(s.observations[0].events[0].at, 20); assert.equal(s.observations[0].events[0].provider, "custom-agent");
  assert.equal(s.observations[1].events.length, 0);
  const boundary = fresh(); assert.equal(captureAgentObservation(boundary, { provider: "custom-agent", at: 10 })(boundary, metadata), 0);
  const initiallyPaused = fresh(); initiallyPaused.observations[0].status = "paused";
  const paused = captureAgentObservation(initiallyPaused, { provider: "custom-agent", at: 20 }); initiallyPaused.observations[0].status = "recording";
  assert.equal(paused(initiallyPaused, metadata), 0);
});

test("custom command history separates local bookkeeping from agent acknowledgements and keeps one private correlation", () => {
  const s = state(), phases = [["queued", "reserved-locally"], ["claimed", "running"], ["retired", "unknown"], ["acknowledged", "done"], ["outcome-reviewed", "unknown"]];
  for (const [index, [phase, status]] of phases.entries()) {
    const e = commandEvent({ phase: `adapter-command-${phase}`, status, at: 20 + index, content: "NEVER_RETAIN", token: "NEVER_RETAIN", sessionId: "NEVER_RETAIN" });
    assert.equal(appendAgentObservation(s, e), 1); assert.equal(appendAgentObservation(s, { ...e, at: e.at + 1 }), 0);
  }
  const rows = s.observations[0].events;
  assert.equal(new Set(rows.map(e => e.subjectDigest)).size, 1);
  assert.equal(rows.every(e => e.intent === "handoff" && e.kind === "status" && e.taskCompletionVerified === false && e.timeSavingMeasured === false), true);
  assert.deepEqual(rows.map(e => e.provenance), ["switchyard-local-lifecycle", "switchyard-local-lifecycle", "switchyard-local-lifecycle", "authenticated-agent-self-report", "switchyard-local-lifecycle"]);
  assert.equal(JSON.stringify(rows).includes("NEVER_RETAIN"), false); assert.equal(JSON.stringify(rows).includes("private-command"), false);
  const other = state({ id: "other" }); appendAgentObservation(other, commandEvent()); assert.notEqual(other.observations[0].events[0].subjectDigest, rows[0].subjectDigest);
  const status = state(); appendAgentObservation(status, commandEvent({ phase: "adapter-status-observed", status: "ready" }));
  assert.notEqual(status.observations[0].events[0].subjectDigest, rows[0].subjectDigest); assert.equal(Object.hasOwn(status.observations[0].events[0], "intent"), false);
});

test("custom command phases refuse unsupported providers, intents and outcome combinations", () => {
  for (const change of [{ provider: "codex" }, { provider: "claude-code" }, { intent: "execute" }, { intent: "NEVER_RETAIN" }, { status: "done" }, { phase: "adapter-command-claimed", status: "done" }, { phase: "adapter-command-acknowledged", status: "running" }, { phase: "adapter-command-retired", status: "done" }]) {
    const s = state(); assert.equal(appendAgentObservation(s, commandEvent(change)), 0); assert.equal(s.observations[0].events.length, 0);
  }
  for (const status of ["done", "failed", "stopped"]) assert.equal(appendAgentObservation(state(), commandEvent({ phase: "adapter-command-acknowledged", status })), 1);
  for (const status of ["done", "failed", "stopped", "running"]) assert.equal(appendAgentObservation(state(), commandEvent({ phase: "adapter-command-outcome-reviewed", status })), 0);
});

test("every custom command phase respects source, policy, pause, exclusion, interval and capacity fences", () => {
  for (const [phase, status] of [["queued", "reserved-locally"], ["claimed", "running"], ["retired", "stopped"], ["acknowledged", "failed"], ["outcome-reviewed", "unknown"]]) {
    const e = commandEvent({ phase: `adapter-command-${phase}`, status });
    for (const s of [state({ mode: "keyboard-only" }), state({ policy: "work", mode: "managed-companion" }), ...[{ sources: ["deliberate"] }, { status: "paused" }, { status: "stopped" }, { exclusions: ["other"] }, { createdAt: 21 }, { createdAt: 0, recordingSince: 21 }].map(change => state({ observations: [session(change)] }))]) {
      const before = structuredClone(s); assert.equal(appendAgentObservation(s, e), 0); assert.deepEqual(s, before);
    }
    const s = state({ observations: [session({ events: Array.from({ length: 2000 }, () => ({ kind: "status", provenance: "original" })) })] });
    assert.equal(appendAgentObservation(s, e), 0); assert.equal(s.observations[0].events.length, 2000); assert.equal(s.observations[0].status, "paused");
  }
});

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
