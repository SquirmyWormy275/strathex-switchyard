import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentService } from "./agents.mjs";
import { claudeAccount, readClaudeDesignLogin } from "./claude-account.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { newPlan, parseBoardProfile } from "./model.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

const plan = () => newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic", layout: "one", keys: [{ id: "one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" }] }));
const response = { reply: "Synthetic reviewed process", summary: "Review", actions: [], steps: ["Review evidence"], roles: ["Reviewer"] };
function metadataCommand(spawnProcess, settings = {}) {
  return async (exe, args, options) => {
    await options.onGuardianReady({ schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 1234, birth: "1", containment: process.platform === "win32" ? "windows-job" : "owned-linux-session" });
    const print = args.includes("-p"), child = spawnProcess(exe, args, { cwd: options.cwd, shell: false, windowsHide: true, stdio: [print ? "pipe" : "ignore", "pipe", "ignore"], env: options.env }); options.onGuardianChild(child);
    let stdout = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", b => { stdout += b; });
    const closed = new Promise(resolve => child.once("close", resolve)), abort = () => child.kill(); options.signal.addEventListener("abort", abort, { once: true }); if (options.signal.aborted) abort();
    if (print) { child.stdin.on("error", () => {}); child.stdin.end(options.inputText); }
    try { const exitCode = await closed; return { status: exitCode === 0 ? "completed" : "failed", exitCode, stdout, stderr: "", treeExitVerified: print ? settings.designTreeExitVerified !== false : true, inputDelivered: true }; }
    finally { options.signal.removeEventListener("abort", abort); }
  };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-claude-design-")), keys = new Map(), calls = [], children = [];
  const store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => keys.set(`${c}:${p}`, v) } });
  await store.initialize("personal"); await store.initialize("company", "work");
  await store.update("personal", "synthetic-mode", (s) => { s.mode = "personal-companion"; });
  const settings = { version: "2.1.308 (Claude Code)", login: { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "synthetic@example.invalid", orgId: "synthetic-org" }, afterDesign: () => {}, beforeSpawn: () => {}, wrongSession: false, delayAuth: false, delayDesign: false, guardianVerified: true };
  const spawnProcess = (_, args, options) => {
    calls.push({ args, options }); settings.beforeSpawn(args);
    const design = args.includes("-p"), value = args[0] === "--version" ? settings.version : args[0] === "auth" ? JSON.stringify(settings.login) : JSON.stringify({ type: "result", subtype: "success", is_error: false, permission_denials: [], session_id: settings.wrongSession ? randomUUID() : args[args.indexOf(args.includes("--resume") ? "--resume" : "--session-id") + 1], structured_output: response });
    const child = spawn(process.execPath, ["-e", `const s=JSON.parse(process.argv[1]);const reply=()=>{if(s.delay)setTimeout(()=>process.stdout.write(s.value),30000);else process.stdout.write(s.value)};if(s.design){process.stdin.resume();process.stdin.on('end',reply)}else reply()`, JSON.stringify({ design, delay: args[0] === "auth" && settings.delayAuth || design && settings.delayDesign, value })], options);
    children.push(child); if (design) settings.afterDesign(); return child;
  };
  const options = { store, runtimeRoot: join(root, "runtime"), resolveCli: async () => "/synthetic/claude", command: metadataCommand(spawnProcess, settings), guardianStopped: async () => settings.guardianVerified };
  const agents = createAgentService(options);
  const design = (conversationId) => agents.design({ compartment: "personal", provider: "claude-code", message: "Synthetic text only", plan: plan(), conversationId });
  try { await fn({ store, agents, settings, calls, design, root, spawnProcess, options }); }
  finally { settings.guardianVerified = true; await agents.close(); for (const child of children) await stopOwnedChild(child); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
test("native Claude design verifies first-party login, exact resume and stable account scope without inheriting provider keys", () => fixture(async ({ store, agents, settings, calls, design }) => {
  await assert.rejects(agents.design({ compartment: "company", provider: "claude-code", message: "Denied", plan: plan() }), /prohibited/); assert.equal(calls.length, 0);
  const first = await design(), saved = (await store.snapshot("personal")).conversations[0];
  assert.equal(saved.accountFingerprint, claudeAccount(settings.login)); assert.equal(saved.sessionId, first.sessionId);
  const second = await design(first.conversationId); assert.equal(second.sessionId, first.sessionId);
  const submits = calls.filter((c) => c.args.includes("-p")); assert.equal(submits.length, 2); assert.ok(submits[1].args.includes("--resume"));
  for (const { args, options } of calls) { assert.equal(options.shell, false); assert.equal(options.env.ANTHROPIC_API_KEY, undefined); assert.equal(options.env.ANTHROPIC_BASE_URL, undefined); if (args.includes("-p")) { assert.equal(args[args.indexOf("--tools") + 1], ""); assert.ok(args.includes("--strict-mcp-config")); } }
  const original = structuredClone((await store.snapshot("personal")).conversations[0].proposal);
  settings.login.email = "changed@example.invalid";
  await assert.rejects(design(first.conversationId), /verified binding/); await assert.rejects(agents.resume("personal", first.conversationId), /account changed/);
  assert.equal(calls.filter((c) => c.args.includes("-p")).length, 2); assert.deepEqual((await store.snapshot("personal")).conversations[0].proposal, original);
}));
test("a changed post-turn account or unexpected native session cannot retain an assistant reply or reroute its original identity", () => fixture(async ({ store, settings, calls, design }) => {
  settings.wrongSession = true; await assert.rejects(design(), /different native session/);
  const first = (await store.snapshot("personal")).conversations[0]; assert.equal(first.messages.some((m) => m.role === "assistant"), false); assert.equal(first.sessionId, calls.find((c) => c.args.includes("--session-id")).args.at(-1));
  settings.wrongSession = false; settings.afterDesign = () => { settings.login.orgId = "changed-org"; };
  await assert.rejects(design(), /login changed before retaining/);
  assert.equal((await store.snapshot("personal")).conversations.some((c) => c.messages.some((m) => m.role === "assistant")), false);
}));
test("legacy Claude context and unsupported versions or alternate authentication cannot reach a model request", () => fixture(async ({ store, settings, calls, design }) => {
  await store.update("personal", "synthetic-legacy", (s) => { s.conversations = [{ id: "legacy", provider: "claude-code", sessionId: randomUUID(), updatedAt: Date.now(), messages: [{ role: "user", text: "Preserved context" }] }]; });
  await assert.rejects(design("legacy"), /verified binding/);
  settings.version = "2.1.309 (Claude Code)"; const before = calls.length; await assert.rejects(design(), /reviewed native version/); assert.equal(calls.slice(before).some((c) => c.args[0] === "auth"), false);
  settings.version = "2.1.308 (Claude Code)"; settings.login.authMethod = "api_key"; await assert.rejects(design(), /supported first-party/);
  assert.equal(calls.some((c) => c.args.includes("-p")), false);
}));
test("workspace stop terminates an owned login probe before any native design process can start", () => fixture(async ({ agents, settings, calls, design }) => {
  let entered; const ready = new Promise((r) => { entered = r; }); settings.delayAuth = true; settings.beforeSpawn = (args) => { if (args[0] === "auth") entered(); };
  const pending = design(), rejected = assert.rejects(pending, /stopped|bounded contract/); await ready;
  assert.equal((await agents.stopCompartment("personal")).stopped, true); await rejected;
  assert.equal(calls.some((c) => c.args.includes("-p")), false);
}));
test("an unconfirmed Claude login probe exit retains its exact owned guardian client for quarantine", () => fixture(async ({ root, spawnProcess }) => {
  let observed;
  const base = metadataCommand(spawnProcess), command = async (...args) => ({ ...await base(...args), treeExitVerified: false });
  await assert.rejects(readClaudeDesignLogin("/synthetic/claude", root, { command, onClient: (client) => { observed = client; }, guardianStopped: async () => false, stopChild: async () => ({ stopped: false }) }), (e) => /probe.*exit/.test(e.message) && e.ownedClient === observed);
}));

test("designer commits each exact guardian before input and retains verified exit across full-board continuation", () => fixture(async ({ store, options, calls }) => {
  const scopes = [], supervisor = createAgentService({ ...options, command: async (exe, args, control) => options.command(exe, args, { ...control, onGuardianReady: async frame => {
    await control.onGuardianReady(frame);
    if (args.includes("-p")) { const saved = (await store.snapshot("personal")).conversations.find(c => c.sessionId === args.at(-1)); assert.equal(saved.ownedRuntime.id, frame.id); assert.equal(saved.ownedRuntimeStoppedVerified, false); assert.ok(Buffer.byteLength(control.inputText) > 12000); scopes.push(saved.ownedRuntime); }
  } }) });
  const full = newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic full keyboard", layout: "manual", keys: Array.from({ length: 160 }, (_, i) => ({ id: `key-${i}`, label: "A", matrix: [Math.floor(i / 32), i % 32], x: i % 32, y: Math.floor(i / 32), baseKeycode: "KC_A" })) }));
  try {
    const first = await supervisor.design({ compartment: "personal", provider: "claude-code", message: "Synthetic full-board request", plan: full });
    const second = await supervisor.design({ compartment: "personal", provider: "claude-code", conversationId: first.conversationId, message: "Synthetic continuation", plan: full });
    assert.equal(second.sessionId, first.sessionId); assert.notEqual(scopes[0].id, scopes[1].id); assert.deepEqual(second.ownedRuntime, scopes[1]); assert.equal(second.ownedRuntimeStoppedVerified, true);
    const saved = (await store.snapshot("personal")).conversations.find(c => c.id === second.conversationId); assert.equal(saved.ownedRuntimeStoppedVerified, true); assert.deepEqual(saved.ownedRuntime, scopes[1]);
    assert.ok(calls.filter(c => c.args.includes("-p")).every(c => !c.args.includes("Synthetic full-board request")));
  } finally { await supervisor.close(); }
}));
test("cancel stops the exact designer guardian and cannot retain its late model response", () => fixture(async ({ agents, settings, design, store }) => {
  let entered; const reached = new Promise(r => { entered = r; }); settings.delayDesign = true; settings.beforeSpawn = args => { if (args.includes("-p")) entered(); };
  const pending = design(), rejected = assert.rejects(pending, /verified proposal|Cancellation/); await reached;
  const saved = (await store.snapshot("personal")).conversations[0]; assert.equal(saved.ownedRuntimeStoppedVerified, false);
  assert.equal((await agents.cancel("personal", saved.id)).status, "cancellation-requested"); await rejected;
  const after = (await store.snapshot("personal")).conversations[0]; assert.equal(after.ownedRuntimeStoppedVerified, true); assert.equal(after.messages.some(m => m.role === "assistant"), false);
}));
test("unverified designer ownership survives retention and restart and blocks provider replacement until exact exit", () => fixture(async ({ store, settings, options, design, calls }) => {
  settings.designTreeExitVerified = false; settings.guardianVerified = false;
  await assert.rejects(design(), /process exit|verify.*exit|verified.*exit/);
  const first = (await store.snapshot("personal")).conversations[0]; assert.equal(first.ownedRuntimeStoppedVerified, false);
  await store.update("personal", "synthetic-expired-design", s => { s.conversations[0].updatedAt = Date.now() - 90 * 86400000; }); assert.equal((await store.snapshot("personal")).conversations[0].id, first.id);
  const restarted = createAgentService(options), count = calls.length;
  try {
    await assert.rejects(restarted.design({ compartment: "personal", provider: "codex", message: "No fallback", plan: plan() }), /design guardian.*not verified exit/); assert.equal(calls.length, count);
    settings.guardianVerified = true; settings.designTreeExitVerified = true;
    assert.equal((await restarted.design({ compartment: "personal", provider: "claude-code", message: "New explicit design after verified exit", plan: plan() })).reply, response.reply);
  } finally { settings.guardianVerified = true; await restarted.close(); }
}));
test("oversized saved designer context rejects before any native request and does not reserve the workspace busy slot", () => fixture(async ({ store, settings, design, calls }) => {
  await store.update("personal", "synthetic-oversized-context", s => { s.conversations = [{ id: "large", provider: "claude-code", sessionId: randomUUID(), accountFingerprint: claudeAccount(settings.login), updatedAt: Date.now(), messages: Array.from({ length: 12 }, () => ({ role: "user", text: "界".repeat(20000) })) }]; });
  await assert.rejects(design("large"), /exceeds 512 KiB/); assert.equal(calls.length, 0);
  assert.equal((await design()).reply, response.reply);
}));
