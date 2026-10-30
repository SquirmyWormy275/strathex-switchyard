import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claudeAccount } from "./claude-account.mjs";
import { createClaudeSubmissions } from "./claude-submissions.mjs";
import { createCodexSubmissions } from "./codex-submissions.mjs";
import { repositoryIdentity } from "./coding-task-identity.mjs";
import { scopeHash } from "./confirmations.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-claude-text-")), repositoryRoot = join(root, "repo"), keys = new Map(), calls = [], children = [];
  await mkdir(join(repositoryRoot, ".git"), { recursive: true });
  const login = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "synthetic@example.invalid", orgId: "synthetic-org" };
  const task = { schema: "switchyard-coding-session/v1", id: randomUUID(), provider: "claude-code", status: "registered", label: "Synthetic stopped task", sessionId: randomUUID(), backgroundId: "1234abcd", startedAt: Date.now(), launchPolicy: "tools-disabled/plan", repositoryRoot, repositoryIdentity: await repositoryIdentity(repositoryRoot), accountFingerprint: claudeAccount(login) };
  const store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => keys.set(`${c}:${p}`, v) } });
  await store.initialize("personal"); await store.initialize("company", "work"); await store.update("personal", "synthetic-task", (s) => { s.mode = "personal-companion"; s.codingSessions = [task]; });
  const settings = { login, version: "2.1.308 (Claude Code)", row: { id: task.backgroundId, cwd: repositoryRoot, kind: "background", state: "stopped", startedAt: task.startedAt, sessionId: task.sessionId }, wrongSession: false, denied: false, delay: false, stderr: "", emptyOutput: false, exitCode: 0, guardianVerified: true, afterPrint: () => {}, beforePrint: () => {} };
  const spawnProcess = (_, args, options) => {
    calls.push({ args, options }); const print = args.includes("-p");
    const value = args[0] === "--version" ? settings.version : args[0] === "auth" ? JSON.stringify(settings.login) : args[0] === "agents" ? JSON.stringify([settings.row]) : JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: settings.wrongSession ? randomUUID() : task.sessionId, result: "Ready", permission_denials: settings.denied ? [{ synthetic: "denied" }] : [] });
    const child = spawn(process.execPath, ["-e", `const s=JSON.parse(process.argv[1]);if(s.print){process.stdin.resume();process.stdin.on('end',()=>{if(s.stderr)process.stderr.write(s.stderr);process.exitCode=s.exitCode;if(s.delay)setTimeout(()=>process.stdout.write(s.value),30000);else process.stdout.write(s.value)})}else process.stdout.write(s.value)`, JSON.stringify({ value: print && settings.emptyOutput ? "" : value, print, delay: settings.delay, stderr: print ? settings.stderr : "", exitCode: print ? settings.exitCode : 0 })], options);
    children.push(child); if (print) { settings.beforePrint(); settings.afterPrint(); } return child;
  };
  const command = async (executable, args, options) => {
    const child = spawnProcess(executable, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ["pipe", "pipe", "pipe"] }); options.onGuardianChild(child);
    const scope = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: child.pid, birth: "1", containment: process.platform === "win32" ? "windows-job" : "owned-linux-session" };
    const aborted = () => child.kill(); options.signal.addEventListener("abort", aborted, { once: true });
    let stdout = "", stderr = ""; child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8"); child.stdout.on("data", b => { stdout += b; }); child.stderr.on("data", b => { stderr += b; });
    const closed = new Promise(resolve => child.once("close", code => resolve(code))); child.stdin.on("error", () => {});
    try { await options.onGuardianReady(scope); if (options.signal.aborted) { child.kill(); throw new Error("Cancellation requested for the synthetic owned command"); } child.stdin.end(options.inputText); const exitCode = await closed; return { stdout, stderr, exitCode, status: exitCode === 0 ? "completed" : "failed", treeExitVerified: true, inputDelivered: true }; }
    finally { options.signal.removeEventListener("abort", aborted); }
  };
  const guardianStopped = async () => settings.guardianVerified;
  const options = { store, resolveCli: async () => "/synthetic/claude", spawnProcess, command, guardianStopped }, service = createClaudeSubmissions(options), input = { taskId: task.id, text: "Synthetic reviewed native text" };
  const review = () => service.review("personal", input), submit = (review, extra = {}) => service.submit("personal", { ...input, requestId: randomUUID(), token: review.confirmation.token, ...extra });
  try { await fn({ root, store, service, options, task, settings, calls, children, input, review, submit }); }
  finally { await service.close(); for (const child of children) await stopOwnedChild(child); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
test("stopped owned Claude text uses the exact native UUID and account without inventing turn acknowledgements", () => fixture(async ({ root, store, service, options, calls, input, review, submit }) => {
  const approval = await review(); assert.equal(approval.modelPromptSubmitted, false); assert.equal(calls.some((c) => c.args.includes("-p")), false);
  const requestId = randomUUID(), result = await submit(approval, { requestId }); assert.equal(result.reply, "Ready"); assert.equal(result.provider, "claude-code"); assert.equal(result.turnId, null); assert.equal(result.nativeTurnIdSupported, false); assert.equal(result.nativeSessionVerified, true); assert.equal(result.taskCompletionVerified, false);
  assert.equal(result.ownedRuntime.schema, "switchyard-runtime-command/v1"); assert.equal(result.ownedRuntimeStoppedVerified, true); assert.notEqual(result.ownedRuntime.id, result.sessionId);
  const restarted = createClaudeSubmissions(options); try { assert.equal((await restarted.submit("personal", { ...input, requestId, token: approval.confirmation.token })).duplicatePrevented, true); } finally { await restarted.close(); }
  assert.equal(calls.filter((c) => c.args.includes("-p")).length, 1);
  const print = calls.find((c) => c.args.includes("-p")); assert.equal(print.options.shell, false); assert.equal(print.options.env.ANTHROPIC_API_KEY, undefined); assert.equal(print.options.env.ANTHROPIC_BASE_URL, undefined); assert.ok(print.args.includes("--safe-mode") && print.args.includes("--strict-mcp-config")); assert.equal(print.args[print.args.indexOf("--permission-mode") + 1], "plan"); assert.equal(print.args[print.args.indexOf("--tools") + 1], "");
  const sealed = await readFile(join(root, "state/personal.sealed.json"), "utf8"); assert.equal(sealed.includes(input.text), false); assert.equal(sealed.includes(approval.confirmation.token), false); assert.equal((await store.snapshot("personal")).codingTurns.length, 1);
}));
test("unapproved policy, live sessions, alternate authentication and changed accounts cannot receive Claude task text", () => fixture(async ({ store, service, task, settings, calls, input, review, submit }) => {
  await assert.rejects(service.review("company", input), /prohibited/); assert.equal(calls.length, 0);
  settings.row.state = "working"; await assert.rejects(review(), /separate reviewed stop/); settings.row.state = "stopped";
  settings.login.authMethod = "api_key"; await assert.rejects(review(), /supported first-party/); settings.login.authMethod = "claude.ai";
  const approval = await review(); settings.login.orgId = "changed-org"; await assert.rejects(submit(approval), /account changed/); settings.login.orgId = "synthetic-org";
  settings.version = "2.1.309 (Claude Code)"; await assert.rejects(review(), /reviewed native version/); settings.version = "2.1.308 (Claude Code)";
  await store.update("personal", "synthetic-external", (s) => { delete s.codingSessions[0].launchPolicy; }); await assert.rejects(review(), /created by Switchyard/);
  assert.equal(calls.some((c) => c.args.includes("-p")), false); assert.equal((await store.snapshot("personal")).codingSessions[0].sessionId, task.sessionId);
}));
test("wrong-session replies, permission denials and post-turn account changes remain unconfirmed without a saved reply", async () => {
  for (const change of ["session", "denial", "login"]) await fixture(async ({ store, settings, review, submit }) => {
    const approval = await review(); settings.wrongSession = change === "session"; settings.denied = change === "denial";
    if (change === "login") settings.afterPrint = () => { settings.login.email = "changed@example.invalid"; };
    await assert.rejects(submit(approval), /native session|account changed/);
    const saved = (await store.snapshot("personal")).codingTurns[0]; assert.equal(saved.status, "outcome-unconfirmed"); assert.equal(saved.reply, null); assert.equal(saved.turnId, null);
    if (change !== "login") { assert.equal(saved.nativeResultSummary.schema, "switchyard-claude-result-shape/v1"); assert.equal(saved.nativeResultSummary.exactSessionMatched, change !== "session"); assert.match(saved.observedSessionId, /^[a-f0-9-]{36}$/); assert.equal(JSON.stringify(saved.nativeResultSummary).includes("Ready"), false); }
  });
});
test("keyboard-only shutdown stops the owned Claude print and retains uncertainty for local outcome review", () => fixture(async ({ store, service, settings, children, input, review, submit }) => {
  let entered; const ready = new Promise((r) => { entered = r; }); settings.delay = true; settings.beforePrint = entered;
  const approval = await review(), pending = submit(approval), rejected = assert.rejects(pending, /Cancellation|native session|stopped/); await ready;
  const suite = createSuite({ store, claudeSubmissions: service, claudeCoding: { stopCompartment: async () => { assert.ok(children.every((c) => c.exitCode !== null || c.signalCode !== null)); return { stopped: true }; }, close: async () => {} }, agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) } });
  try { await suite.handle("/api/suite/mode", { compartment: "personal", mode: "keyboard-only" }); await rejected; const turn = (await store.snapshot("personal")).codingTurns[0]; assert.equal(turn.status, "outcome-unconfirmed"); assert.equal(turn.reply, null); const outcome = await suite.handle("/api/suite/coding/claude/turns/outcome/review", { compartment: "personal", id: turn.id }); assert.equal(outcome.modelPromptSubmitted, false); await assert.rejects(service.review("personal", input), /keyboard-only/i); } finally { await suite.close(); }
}));
test("native providers cannot consume or delete each other's protected text records or request IDs", () => fixture(async ({ store, service, input, review, submit }) => {
  const id = randomUUID(); await store.update("personal", "synthetic-codex-history", (s) => { s.codingTurns = [{ id, provider: "codex", taskId: input.taskId, promptSha256: scopeHash(input.text), status: "provider-turn-completed", updatedAt: Date.now() }]; });
  assert.deepEqual(await service.list("personal"), []); await assert.rejects(service.remove("personal", id), /Only completed/); await assert.rejects(service.reviewOutcome("personal", id), /unresolved saved outcome/); await assert.rejects(submit(await review(), { requestId: id }), /different reviewed text/);
  const codex = createCodexSubmissions({ store }); try { assert.equal((await codex.list("personal")).length, 1); } finally { await codex.close(); }
}));

test("stderr-only native refusal retains structural categories and flag names without copying sensitive diagnostic text", () => fixture(async ({ store, settings, review, submit }) => {
  const approval = await review(); settings.emptyOutput = true; settings.exitCode = 1; settings.stderr = "Error: --resume requires using attach for this session. Token=validation-only-secret";
  await assert.rejects(submit(approval), /native session/);
  const turn = (await store.snapshot("personal")).codingTurns[0], summary = turn.nativeResultSummary;
  assert.equal(summary.parsed, false); assert.equal(summary.stdoutBytes, 0); assert.equal(summary.stderrBytes, Buffer.byteLength(settings.stderr)); assert.equal(summary.exitCode, 1); assert.deepEqual(summary.referencedFlags, ["--resume"]); assert.ok(summary.stderrCategories.includes("session-in-use"));
  assert.equal(JSON.stringify(summary).includes("validation-only-secret"), false); assert.equal(turn.reply, null);
}));

test("a reserved print task uses its requested UUID once, then resumes only the verified native conversation", () => fixture(async ({ store, task, settings, calls, review, submit }) => {
  await store.update("personal", "synthetic-local-reservation", (s) => { Object.assign(s.codingSessions[0], { nativeTransport: "owned-print", backgroundId: null, nativeIdentityVerified: false }); });
  settings.row.sessionId = randomUUID();
  const first = await review(); assert.equal(first.scope.nativeIdentityVerified, false);
  const result = await submit(first); assert.equal(result.sessionId, task.sessionId);
  const created = (await store.snapshot("personal")).codingSessions[0]; assert.equal(created.nativeIdentityVerified, true); assert.equal(created.sessionId, task.sessionId);
  const second = await review(); assert.equal(second.scope.nativeIdentityVerified, true); await submit(second);
  const prints = calls.filter((c) => c.args.includes("-p")); assert.equal(prints.length, 2); assert.equal(prints[0].args.at(-2), "--session-id"); assert.equal(prints[1].args.at(-2), "--resume"); assert.equal(prints[0].args.at(-1), task.sessionId); assert.equal(prints[1].args.at(-1), task.sessionId);
}));

test("an uncertain first Claude creation keeps its requested identity and cannot create or fork again after outcome review", () => fixture(async ({ store, service, settings, calls, input, review, submit }) => {
  await store.update("personal", "synthetic-local-reservation", (s) => { Object.assign(s.codingSessions[0], { nativeTransport: "owned-print", backgroundId: null, nativeIdentityVerified: false }); });
  settings.row.sessionId = randomUUID(); settings.wrongSession = true;
  const approval = await review(); await assert.rejects(submit(approval), /native session/);
  const state = await store.snapshot("personal"); assert.equal(state.codingSessions[0].status, "creation-uncertain"); assert.equal(state.codingSessions[0].nativeIdentityVerified, false); assert.equal(state.codingTurns[0].reply, null);
  const outcome = await service.reviewOutcome("personal", state.codingTurns[0].id); await service.resolveOutcome("personal", { id: state.codingTurns[0].id, token: outcome.confirmation.token });
  settings.wrongSession = false; await assert.rejects(service.review("personal", input), /uncertain tasks/); assert.equal(calls.filter((c) => c.args.includes("-p")).length, 1);
}));

test("a live native client blocks a reserved or verified print task before input reaches a model", () => fixture(async ({ store, settings, task, calls, review }) => {
  await store.update("personal", "synthetic-local-reservation", (s) => { Object.assign(s.codingSessions[0], { nativeTransport: "owned-print", backgroundId: null, nativeIdentityVerified: true }); });
  settings.row.sessionId = task.sessionId; settings.row.pid = 12345; settings.row.status = "idle"; settings.row.state = "blocked";
  await assert.rejects(review(), /live native client/); assert.equal(calls.some((c) => c.args.includes("-p")), false);
}));

test("restart preserves an interrupted first-creation UUID even after the saved outcome is deliberately reviewed", () => fixture(async ({ store, service, task, review, calls }) => {
  const id = randomUUID(); await store.update("personal", "synthetic-interrupted-creation", (s) => { Object.assign(s.codingSessions[0], { nativeTransport: "owned-print", backgroundId: null, nativeIdentityVerified: false }); s.codingTurns = [{ id, taskId: task.id, provider: "claude-code", sessionId: task.sessionId, status: "submitting", updatedAt: Date.now() }]; });
  const suite = createSuite({ store, agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) } });
  try { await suite.handle("/api/suite/snapshot", { compartment: "personal" }); const state = await store.snapshot("personal"); assert.equal(state.codingSessions[0].status, "creation-uncertain"); assert.equal(state.codingTurns[0].status, "outcome-unconfirmed"); const outcome = await service.reviewOutcome("personal", id); await service.resolveOutcome("personal", { id, token: outcome.confirmation.token }); await assert.rejects(review(), /uncertain tasks/); assert.equal(calls.some((c) => c.args.includes("-p")), false); } finally { await suite.close(); }
}));

test("saved guardian uncertainty survives outcome review, retention and restart and blocks provider replacement until exact exit", () => fixture(async ({ store, service, settings, options, task, calls, review }) => {
  const id = randomUUID(), scope = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: process.platform === "win32" ? "windows-job" : "owned-linux-session" };
  await store.update("personal", "synthetic-saved-guardian", (s) => { s.codingTurns = [{ id, provider: "claude-code", taskId: task.id, sessionId: task.sessionId, status: "reviewed-unconfirmed", updatedAt: Date.now()-40*86400000, ownedRuntime: scope, ownedRuntimeStoppedVerified: false }]; });
  await store.update("personal", "synthetic-retention-pass", () => {}); assert.equal((await store.snapshot("personal")).codingTurns.length, 1);
  settings.guardianVerified = false; calls.length = 0;
  const restarted = createClaudeSubmissions(options);
  try { await assert.rejects(restarted.review("personal", { taskId: task.id, text: "Synthetic" }), /guardian has not verified exit/); await assert.rejects(service.remove("personal", id), /verified owned process exit/); await assert.rejects(restarted.stopCompartment("personal"), /guardian has not verified exit/); assert.equal(calls.length, 0); }
  finally { settings.guardianVerified = true; await restarted.close(); }
  await review(); assert.equal(calls.some(c => c.args.includes("-p")), false);
}));

test("deliberate first-creation recovery resumes only the original UUID after outcome review and cannot reuse ordinary request identities", () => fixture(async ({ store, service, settings, task, calls, input, review, submit }) => {
  await store.update("personal", "synthetic-local-reservation", (s) => { Object.assign(s.codingSessions[0], { nativeTransport: "owned-print", backgroundId: null, nativeIdentityVerified: false }); }); settings.row.sessionId = randomUUID(); settings.wrongSession = true;
  await assert.rejects(submit(await review()), /native session/);
  await assert.rejects(service.reviewRecovery("personal", input), /previous uncertain outcome/);
  const previous = (await store.snapshot("personal")).codingTurns[0], outcome = await service.reviewOutcome("personal", previous.id); await service.resolveOutcome("personal", { id: previous.id, token: outcome.confirmation.token });
  await assert.rejects(review(), /uncertain tasks/);
  const approval = await service.reviewRecovery("personal", input); assert.equal(approval.scope.operation, "recover-exact-native-session"); assert.equal(approval.scope.nativeIdentityVerified, false); assert.equal(approval.modelPromptSubmitted, false);
  const request = { ...input, requestId: randomUUID(), token: approval.confirmation.token }; await assert.rejects(service.submit("personal", request), /uncertain tasks/);
  settings.wrongSession = false; const result = await service.submitRecovery("personal", request); assert.equal(result.sessionId, task.sessionId); assert.equal(result.operation, "recover-exact-native-session"); assert.equal(result.reply, "Ready"); assert.equal(result.ownedRuntimeStoppedVerified, true);
  assert.equal((await service.submitRecovery("personal", request)).duplicatePrevented, true); await assert.rejects(service.submit("personal", request), /different reviewed text/);
  const saved = (await store.snapshot("personal")).codingSessions[0]; assert.equal(saved.nativeIdentityVerified, true); assert.equal(saved.status, "registered"); assert.equal(saved.sessionId, task.sessionId);
  const prints = calls.filter(c => c.args.includes("-p")); assert.equal(prints.length, 2); assert.equal(prints[0].args.at(-2), "--session-id"); assert.equal(prints[1].args.at(-2), "--resume"); assert.equal(prints[1].args.at(-1), task.sessionId);
  await assert.rejects(service.reviewRecovery("personal", input), /does not have an uncertain first creation/);
}));

test("missing native history during explicit recovery preserves uncertainty without ever selecting a new conversation", () => fixture(async ({ store, service, settings, task, calls, input }) => {
  await store.update("personal", "synthetic-reviewed-unknown", (s) => { Object.assign(s.codingSessions[0], { nativeTransport: "owned-print", backgroundId: null, nativeIdentityVerified: false, status: "creation-uncertain", creationOutcomeReviewedAt: Date.now() }); }); settings.row.sessionId = randomUUID(); settings.emptyOutput = true; settings.exitCode = 1; settings.stderr = "No conversation found with this session ID";
  const suite = createSuite({ store, claudeSubmissions: service, agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) } });
  try {
    const approval = await suite.handle("/api/suite/coding/claude/turns/recovery/review", { compartment: "personal", ...input });
    await assert.rejects(suite.handle("/api/suite/coding/claude/turns/recovery/submit", { compartment: "personal", ...input, requestId: randomUUID(), token: approval.confirmation.token }), /native session/);
    const state = await store.snapshot("personal"); assert.equal(state.codingSessions[0].status, "creation-uncertain"); assert.equal(state.codingSessions[0].sessionId, task.sessionId); assert.equal(state.codingSessions[0].nativeIdentityVerified, false); assert.equal(state.codingTurns[0].status, "outcome-unconfirmed"); assert.equal(state.codingTurns[0].reply, null); assert.ok(state.codingTurns[0].nativeResultSummary.stderrCategories.includes("session-unavailable"));
    const prints = calls.filter(c => c.args.includes("-p")); assert.equal(prints.length, 1); assert.equal(prints[0].args.at(-2), "--resume"); assert.equal(prints[0].args.includes("--session-id"), false); await assert.rejects(service.reviewRecovery("personal", input), /previous uncertain outcome/);
  } finally { await suite.close(); }
}));
