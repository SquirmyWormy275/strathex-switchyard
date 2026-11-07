import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { runRestrictedCodexTurn } from "./codex-turn.mjs";
const tick = () => new Promise((r) => setImmediate(r));
test("submission review follows account verification and refuses before a native prompt", async () => {
  const f = fixture(), order = [];
  f.client.recheckAccount = async () => { order.push("account"); return f.client.accountFingerprint; };
  await assert.rejects(f.run({ beforeSubmit: async () => { order.push("review"); throw Error("Synthetic source revoked"); } }), e => e.code === "SUBMISSION_BLOCKED" && e.turnId === null && e.stopVerified === true);
  assert.deepEqual(order, ["account", "review"]); assert.deepEqual(f.calls, []); assert.equal(f.stops, 1);
});
test("cancellation while a submission review awaits cannot send a late prompt", async () => {
  const f = fixture(), controller = new AbortController(); let release, entered;
  const gate = new Promise(r => { release = r; }), ready = new Promise(r => { entered = r; });
  const result = f.run({ signal: controller.signal, beforeSubmit: async () => { entered(); await gate; } });
  const rejected = assert.rejects(result, { code: "CANCELLED" }); await ready; controller.abort(); await rejected;
  release(); await tick(); assert.deepEqual(f.calls, []); assert.equal(f.stops, 1);
});
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
test("native auth boundary notifications fence a turn even when its original fingerprint is restored", async () => {
  for (const method of ["account/updated", "account/login/completed"]) {
    const f = fixture(), result = f.run(), rejected = assert.rejects(result, error => error.code === "ACCOUNT_UNCONFIRMED" && error.turnId === "turn-1" && error.stopVerified === true);
    await tick();
    f.client.emit("notification", { method, params: { authMode: null, success: true } });
    f.client.accountFingerprint = "a".repeat(64);
    f.client.emit("notification", { method: "account/updated", params: { authMode: "chatgpt" } });
    f.message("Restored-login reply must not be retained"); f.complete(); await rejected;
    assert.equal(f.client.closed, true); assert.equal(f.calls.filter(call => call.method === "turn/start").length, 1); assert.equal(f.client.listenerCount("notification"), 0);
  }
});
test("usage notifications and a cancelled login do not invalidate the pinned native account", async () => {
  const f = fixture(), result = f.run(); await tick();
  f.client.emit("notification", { method: "account/rateLimits/updated", params: { rateLimits: {} } });
  f.client.emit("notification", { method: "account/login/completed", params: { success: false, error: "Synthetic cancelled login" } });
  f.message("Ready"); f.complete(); assert.equal((await result).text, "Ready"); assert.equal(f.stops, 0);
});
test("an account notification during final native revalidation cannot be erased by a later successful read", async () => {
  const f = fixture(); let reads = 0, enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  f.client.recheckAccount = async () => { if (++reads === 2) { enter(); await gate; } return "a".repeat(64); };
  const result = f.run(), rejected = assert.rejects(result, error => error.code === "ACCOUNT_UNCONFIRMED"); await tick();
  f.message("Not retained"); f.complete(); await entered;
  f.client.emit("notification", { method: "account/updated", params: { authMode: "chatgpt" } }); release(); await rejected;
  assert.equal(f.calls.filter(call => call.method === "turn/start").length, 1); assert.equal(f.client.closed, true);
});
test("generation changes block late content and a noncompleted provider turn never verifies task completion", async () => {
  let active = true; const f = fixture(), result = f.run({ checkCurrent: () => { if (!active) throw Error("Stopped generation"); } }); await tick(); active = false; f.message("Late content"); f.complete();
  await assert.rejects(result, (e) => e.code === "TURN_STOPPED" && e.stopVerified === true);
  const g = fixture(), failed = g.run(); await tick(); g.complete("turn-1", "interrupted"); await assert.rejects(failed, (e) => e.code === "TURN_INCOMPLETE" && e.nativeStatus === "interrupted"); assert.equal(g.client.closed, false);
});
