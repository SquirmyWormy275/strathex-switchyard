import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { claudeHookMetadata, claudeHookInputBytes, claudeHookRecipe, recordClaudeHook } from "./claude-hook-observation.mjs";
import { claudeHookMain } from "../../integrations/claude-hook.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { reviewDesignObservations } from "./design-observations.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

const id = "ac730133-f745-42b2-9ab0-949c33e3ecf6", nativeId = "synthetic-native-session";
const observation = overrides => ({ id, status: "recording", sources: ["claude-hook-events"], exclusions: [], events: [], createdAt: 1, recordingSince: 1, recordingGeneration: "original", updatedAt: 1, ...overrides });
const state = overrides => ({ id: "personal", policy: "personal", mode: "personal-companion", observations: [observation()], accounts: [], ...overrides });
const raw = (name, fields = {}) => JSON.stringify({ session_id: nativeId, hook_event_name: name, prompt: "PRIVATE_PROMPT", transcript_path: "/PRIVATE_TRANSCRIPT", cwd: "/PRIVATE_DIRECTORY", last_assistant_message: "PRIVATE_REPLY", tool_input: { command: "PRIVATE_COMMAND" }, ...fields });
function fixture(overrides = {}) {
  let value = state(overrides), writes = 0, selected = "personal", before = async () => {};
  const store = { selection: async () => selected, snapshot: async () => structuredClone(value), update: async (_id, op, fn, permission) => {
    assert.equal(op, "claude-hook-observation"); assert.deepEqual(permission, { provider: "claude-code", operation: "record" });
    await before(value); const draft = structuredClone(value), result = await fn(draft); value = draft; writes++; return result;
  } };
  return { store, get value() { return value; }, get writes() { return writes; }, before(fn) { before = fn; }, select(id) { selected = id; },
    run: (name = "UserPromptSubmit", args = {}) => recordClaudeHook({ store, compartment: "personal", observationId: id, expectedSessionId: nativeId, raw: raw(name), at: 20, now: () => 30, ...args }) };
}

test("Claude hooks project only fixed status fields and ignore other sessions and nested agents", () => {
  for (const [name, fields, status] of [["SessionStart", { source: "resume" }, "ready"], ["UserPromptSubmit", {}, "busy"], ["Notification", { notification_type: "permission_prompt" }, "waiting-on-approval"], ["Notification", { notification_type: "idle_prompt" }, "waiting-for-input"], ["Stop", { background_tasks: [{ command: "PRIVATE" }] }, "provider-turn-finished"], ["StopFailure", { error_details: "PRIVATE" }, "failed"], ["SessionEnd", { reason: "logout" }, "stopped"]]) {
    assert.deepEqual(claudeHookMetadata(raw(name, fields), nativeId), { event: name, status });
  }
  for (const [name, fields] of [["SessionStart", { source: "foreign" }], ["Notification", { notification_type: "auth_success" }], ["PreToolUse", {}], ["TaskCompleted", {}], ["__proto__", {}], ["Stop", { agent_id: "nested" }], ["Stop", { session_id: "other" }]]) assert.equal(claudeHookMetadata(raw(name, fields), nativeId), null);
  for (const value of ["{", "[]", "null", " ".repeat(claudeHookInputBytes + 1)]) assert.throws(() => claudeHookMetadata(value, nativeId));
  assert.throws(() => claudeHookMetadata(raw("Stop"), "bad/session"));
});

test("hook status retains a distinct private correlation, no content and no completion claim", async () => {
  const f = fixture(); assert.equal((await f.run()).recorded, 1);
  assert.equal((await f.run("Stop", { at: 21 })).recorded, 1);
  const events = f.value.observations[0].events;
  assert.equal(new Set(events.map(e => e.subjectDigest)).size, 1); assert.match(events[0].subjectDigest, /^[a-f0-9]{64}$/);
  assert(events.every(e => e.provenance === "unverified-local-claude-hook" && e.timeBasis === "hook-process-invocation" && !e.nativeIdentityVerified && !e.taskCompletionVerified && !e.timeSavingMeasured));
  assert(!JSON.stringify(events).includes("PRIVATE")); assert(!JSON.stringify(events).includes(nativeId));
  assert.equal(events[1].status, "provider-turn-finished");
});

test("ordinary agent consent cannot admit hooks and unselected, Work, paused or excluded observations do not write", async () => {
  for (const overrides of [{ policy: "work" }, { mode: "keyboard-only" }, { observations: [] }, ...[{ sources: ["agent-events"] }, { status: "paused" }, { status: "stopped" }, { exclusions: ["claude"] }, { recordingSince: 20 }, { recordingGeneration: undefined }, { id: "different" }].map(x => ({ observations: [observation(x)] }))]) {
    const f = fixture(overrides); assert.equal((await f.run()).recorded, 0); assert.equal(f.writes, 0);
  }
  const f = fixture(); f.select("other"); assert.equal((await f.run()).recorded, 0); assert.equal(f.writes, 0);
  const unknown = fixture(); assert.equal((await unknown.run("TaskCompleted")).recorded, 0); assert.equal(unknown.writes, 0);
});

test("hook receipt timing and scope reject stale, future, ambiguous and coerced identities", async () => {
  const f = fixture();
  for (const at of [-1, null, 1.5, "20", 31]) await assert.rejects(f.run("Stop", { at }));
  await assert.rejects(f.run("Stop", { now: () => 40000 }), /stale/);
  for (const observationId of [null, [id], "../foreign"]) await assert.rejects(f.run("Stop", { observationId }));
  assert.equal(f.writes, 0);
});

test("a queued hook cannot inherit a replacement consent generation or observation", async () => {
  for (const change of [s => { s.observations[0].recordingGeneration = "replacement"; }, s => { s.observations[0].status = "paused"; }, s => { s.observations = []; }, s => { s.mode = "keyboard-only"; }, s => { s.observations[0].sources = ["agent-events"]; }, s => { s.observations[0].exclusions = ["claude"]; }]) {
    const f = fixture(); f.before(change); assert.equal((await f.run()).recorded, 0); assert(f.value.observations.every(o => o.events.length === 0));
  }
  const f = fixture(); f.before(() => f.select("other")); assert.equal((await f.run()).recorded, 0);
  const g = fixture(); g.before(s => s.observations.push(observation({ id: "another", recordingGeneration: "new" })));
  assert.equal((await g.run()).recorded, 1); assert.equal(g.value.observations[1].events.length, 0);
});

test("duplicate and out-of-order hook reports do not inflate history and the original capacity pauses", async () => {
  const f = fixture(); await f.run(); assert.equal((await f.run("UserPromptSubmit", { at: 21 })).recorded, 0);
  assert.equal((await f.run("Stop", { at: 19 })).recorded, 0); assert.equal((await f.run("Stop")).recorded, 0);
  assert.equal((await f.run("Stop", { at: 22 })).recorded, 1);
  const capped = fixture({ observations: [observation({ events: Array.from({ length: 2000 }, () => ({ kind: "status" })) })] });
  assert.equal((await capped.run()).reason, "capacity"); assert.equal(capped.value.observations[0].events.length, 2000); assert.equal(capped.value.observations[0].status, "paused");
});

test("hook recipe uses separate executable arguments, no decision hooks or settings mutation", () => {
  const recipe = claudeHookRecipe(state(), { observationId: id, expectedSessionId: nativeId });
  assert.equal(recipe.configured, false); assert.equal(recipe.providerCommandSent, false);
  assert.deepEqual(Object.keys(recipe.settings.hooks), ["SessionStart", "UserPromptSubmit", "Notification", "Stop", "StopFailure", "SessionEnd"]);
  for (const [entry] of Object.values(recipe.settings.hooks)) {
    const [hook] = entry.hooks; assert.equal(hook.command, process.execPath); assert.equal(hook.onFailure, "continue"); assert.equal(hook.timeout, 10);
    assert.deepEqual(hook.args.slice(1), ["--workspace", "personal", "--observation", id, "--session", nativeId]); assert(!Object.hasOwn(hook, "shell"));
  }
  for (const changed of [{ policy: "work" }, { mode: "keyboard-only" }, { observations: [observation({ sources: ["agent-events"] })] }]) assert.throws(() => claudeHookRecipe(state(changed), { observationId: id, expectedSessionId: nativeId }));
});

test("reviewed hook aggregates keep provenance while excluding raw identities and status details", async () => {
  const f = fixture(); await f.run(); f.value.observations[0].status = "paused";
  const review = reviewDesignObservations(f.value, "codex", [id]);
  assert.deepEqual(review.context.sessions[0].eventCounts, [{ kind: "status", provenance: "unverified-local-claude-hook", count: 1 }]);
  assert(!JSON.stringify(review.context).includes(nativeId)); assert(!JSON.stringify(review.context).includes("busy"));
  f.value.observations[0].sources = ["agent-events"]; assert.throws(() => reviewDesignObservations(f.value, "codex", [id]));
});

test("hook command validates flags and bounded stdin before local storage, never outputs model context", async () => {
  const f = fixture(), args = ["--workspace", "personal", "--observation", id, "--session", nativeId]; let errors = "";
  const options = text => ({ store: f.store, input: Readable.from([text]), errors: { write: s => { errors += s; } }, now: () => 20 });
  assert.equal(await claudeHookMain(args, options(raw("UserPromptSubmit"))), 0); assert.equal(errors, ""); assert.equal(f.writes, 1);
  for (const wrong of [[], [...args, "--root", "/PRIVATE"], ["--workspace", "../PRIVATE", ...args.slice(2)]]) assert.equal(await claudeHookMain(wrong, options(raw("Stop"))), 1);
  assert.equal(await claudeHookMain(args, options(" ".repeat(claudeHookInputBytes + 1))), 1);
  assert.equal(await claudeHookMain(args, options("{PRIVATE")), 1); assert(!errors.includes("PRIVATE")); assert.equal(f.writes, 1);
});

test("independent hook processes use actual encrypted storage and kernel leases without a provider", async t => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-claude-hooks-")), secret = Buffer.alloc(32, 7).toString("base64");
  const secrets = { get: async () => secret, set: async () => {} }, store = createSuiteStore({ root, secrets });
  const children = []; t.after(async () => { for (const child of children) if (child.exitCode === null) await stopOwnedChild(child, { reason: "synthetic hook fixture retirement" }); await rm(root, { recursive: true, force: true }); });
  await store.initialize("personal", "personal"); await store.selection("personal");
  await store.update("personal", "synthetic-setup", s => { s.mode = "personal-companion"; s.observations = [observation({ createdAt: Date.now() - 1000, recordingSince: Date.now() - 1000, updatedAt: Date.now() - 1000 })]; });
  const worker = join(root, "synthetic-hook.mjs"), moduleUrl = pathToFileURL(join(process.cwd(), "integrations/claude-hook.mjs")).href, storeUrl = pathToFileURL(join(process.cwd(), "tools/layout-studio/suite-store.mjs")).href;
  await writeFile(worker, `import {claudeHookMain} from ${JSON.stringify(moduleUrl)};import {createSuiteStore} from ${JSON.stringify(storeUrl)};const store=createSuiteStore({root:${JSON.stringify(root)},secrets:{get:async()=>${JSON.stringify(secret)},set:async()=>{}}});process.exitCode=await claudeHookMain(process.argv.slice(2),{store});`, { mode: 0o600 });
  async function run(name) {
    const child = spawn(process.execPath, [worker, "--workspace", "personal", "--observation", id, "--session", nativeId], { stdio: ["pipe", "pipe", "pipe"] }); children.push(child);
    let stdout = "", stderr = ""; child.stdout.on("data", b => { stdout += b; }); child.stderr.on("data", b => { stderr += b; });
    const closed = once(child, "close"); child.stdin.end(raw(name)); const [code, signal] = await closed; assert.equal(code, 0, stderr); assert.equal(signal, null); assert.equal(stdout, ""); assert.equal(stderr, "");
  }
  await Promise.all([run("UserPromptSubmit"), run("UserPromptSubmit")]);
  let saved = await store.snapshot("personal"); assert.equal(saved.observations[0].events.length, 1);
  await run("Stop"); saved = await store.snapshot("personal"); assert.deepEqual(saved.observations[0].events.map(e => e.status), ["busy", "provider-turn-finished"]);
  const ciphertext = await readFile(join(root, "personal.sealed.json"), "utf8"); assert(!ciphertext.includes("PRIVATE")); assert(!ciphertext.includes(nativeId)); assert(!ciphertext.includes("provider-turn-finished"));
  await store.update("personal", "synthetic-delete", s => { s.observations = []; }); const before = await readFile(join(root, "personal.sealed.json"));
  await run("SessionEnd"); assert.deepEqual(await readFile(join(root, "personal.sealed.json")), before); assert.equal((await store.snapshot("personal")).observations.length, 0);
});
