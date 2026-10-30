import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { runRestrictedCodexTurn } from "./codex-turn.mjs";
const tick = () => new Promise((r) => setImmediate(r));
function fixture({ start, stopped = true } = {}) {
  const client = new EventEmitter(), calls = []; let stops = 0;
  Object.assign(client, { closed: false, nativeVersion: "0.166.0", accountFingerprint: "a".repeat(64), recheckAccount: async () => "a".repeat(64), restrictionsVerified: true, close() { if (this.closed) return; this.closed = true; this.emit("disconnected"); }, request(method, params) { calls.push({ method, params }); return method === "turn/start" ? start?.(client) ?? Promise.resolve({ turn: { id: "turn-1" } }) : Promise.resolve({}); } });
  const stopChild = async () => { stops++; return { stopped }; };
  const run = (options = {}) => runRestrictedCodexTurn({ client, threadId: "thread-1", text: "Synthetic reviewed text", timeoutMs: 1000, stopChild, ...options });
  const message = (text, turnId = "turn-1") => client.emit("notification", { method: "item/completed", params: { threadId: "thread-1", turnId, item: { type: "agentMessage", text } } });
  const complete = (id = "turn-1", status = "completed") => client.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id, status } } });
  return { client, calls, run, message, complete, get stops() { return stops; } };
}
test("exact-turn output waits for the retained acknowledgement and ignores other same-thread turns", async () => {
  let release, entered; const gate = new Promise((r) => { release = r; }), started = new Promise((r) => { entered = r; });
  const f = fixture({ start: (client) => { client.emit("notification", { method: "item/completed", params: { threadId: "thread-1", turnId: "other-turn", item: { type: "agentMessage", text: "Foreign stale reply" } } }); return Promise.resolve({ turn: { id: "turn-1" } }); } });
  const result = f.run({ onStarted: async (id) => { assert.equal(id, "turn-1"); entered(); await gate; } }); await started;
  f.message("Ready"); f.complete("other-turn", "failed"); f.complete(); let settled = false; void result.then(() => { settled = true; }); await tick(); assert.equal(settled, false);
  release(); const actual = await result; assert.equal(actual.text, "Ready"); assert.equal(actual.taskCompletionVerified, false); assert.deepEqual(actual.messages, ["Ready"]); assert.equal(f.client.closed, false); assert.equal(f.client.listenerCount("notification"), 0);
  const request = f.calls.find((c) => c.method === "turn/start"); assert.equal(request.params.approvalPolicy, "never"); assert.equal(request.params.approvalsReviewer, "user"); assert.deepEqual(request.params.sandboxPolicy, { type: "readOnly", networkAccess: false });
});
test("known unrelated large replies cannot replace or cancel the acknowledged turn", async () => {
  const f = fixture(), result = f.run({ maxOutputBytes: 128 }); await tick(); f.message("x".repeat(1024), "other-turn"); f.complete("other-turn"); f.message("Ready"); f.complete(); assert.equal((await result).text, "Ready"); assert.equal(f.stops, 0);
});
test("failed durable binding retains the returned turn identity and stops only this owned connection", async () => {
  const f = fixture(), result = f.run({ onStarted: async () => { throw Error("Synthetic sealed-state failure"); } });
  await assert.rejects(result, (e) => e.code === "BINDING_UNCONFIRMED" && e.turnId === "turn-1" && e.stopVerified === true);
  assert.equal(f.client.closed, true); assert.equal(f.stops, 1); assert.deepEqual(f.calls.find((c) => c.method === "turn/interrupt").params, { threadId: "thread-1", turnId: "turn-1" }); assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
});
test("cancellation before acknowledgement never guesses an ID or submits an automatic replacement", async () => {
  let acknowledge; const f = fixture({ start: () => new Promise((r) => { acknowledge = r; }) }), controller = new AbortController(), result = f.run({ signal: controller.signal });
  const rejected = assert.rejects(result, (e) => e.code === "CANCELLED" && e.turnId === null && e.stopVerified === true); await tick(); controller.abort(); await rejected;
  acknowledge({ turn: { id: "late-turn" } }); await tick(); assert.equal(f.calls.some((c) => c.method === "turn/interrupt"), false); assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1); assert.equal(f.client.listenerCount("notification"), 0);
});
test("unexpected tool activity, invalid turn identity, output overflow and deadlines fail closed with honest exit evidence", async () => {
  for (const scenario of ["tool", "tool-completed", "identity", "output", "deadline"]) {
    const f = fixture({ stopped: false }), result = f.run({ timeoutMs: scenario === "deadline" ? 20 : 1000, maxOutputBytes: 128 });
    const rejected = assert.rejects(result, (e) => ["UNEXPECTED_TOOL", "INVALID_REPLY", "OUTPUT_BOUND", "TURN_TIMEOUT"].includes(e.code) && e.turnId === "turn-1" && e.stopVerified === false); await tick();
    if (scenario === "tool") f.client.emit("notification", { method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", item: { type: "commandExecution" } } });
    if (scenario === "tool-completed") f.client.emit("notification", { method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", item: { type: "fileChange" } } });
    if (scenario === "identity") f.complete(7);
    if (scenario === "output") f.message("x".repeat(129));
    await rejected;
    assert.equal(f.client.closed, true); assert.equal(f.stops, 1); assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
  }
});
test("an account change after the exact turn completes cannot retain its reply under another login", async () => {
  const f = fixture(), result = f.run(); const rejected = assert.rejects(result, (e) => e.code === "ACCOUNT_UNCONFIRMED" && e.stopVerified === true); await tick();
  f.client.recheckAccount = async () => { throw Error("Synthetic login change"); }; f.message("Not retained"); f.complete(); await rejected;
  assert.equal(f.client.closed, true); assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
});
test("generation changes block late content and a noncompleted provider turn never verifies task completion", async () => {
  let active = true; const f = fixture(), result = f.run({ checkCurrent: () => { if (!active) throw Error("Stopped generation"); } }); await tick(); active = false; f.message("Late content"); f.complete();
  await assert.rejects(result, (e) => e.code === "TURN_STOPPED" && e.stopVerified === true);
  const g = fixture(), failed = g.run(); await tick(); g.complete("turn-1", "interrupted"); await assert.rejects(failed, (e) => e.code === "TURN_INCOMPLETE" && e.nativeStatus === "interrupted"); assert.equal(g.client.closed, false);
});
