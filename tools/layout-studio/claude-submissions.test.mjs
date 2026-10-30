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
  const settings = { login, version: "2.1.308 (Claude Code)", row: { id: task.backgroundId, cwd: repositoryRoot, kind: "background", state: "stopped", startedAt: task.startedAt, sessionId: task.sessionId }, wrongSession: false, denied: false, delay: false, stderr: "", emptyOutput: false, exitCode: 0, afterPrint: () => {}, beforePrint: () => {} };
  const spawnProcess = (_, args, options) => {
    calls.push({ args, options }); const print = args.includes("-p");
    const value = args[0] === "--version" ? settings.version : args[0] === "auth" ? JSON.stringify(settings.login) : args[0] === "agents" ? JSON.stringify([settings.row]) : JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: settings.wrongSession ? randomUUID() : task.sessionId, result: "Ready", permission_denials: settings.denied ? [{ synthetic: "denied" }] : [] });
    const child = spawn(process.execPath, ["-e", `const s=JSON.parse(process.argv[1]);if(s.print){process.stdin.resume();process.stdin.on('end',()=>{if(s.stderr)process.stderr.write(s.stderr);process.exitCode=s.exitCode;if(s.delay)setTimeout(()=>process.stdout.write(s.value),30000);else process.stdout.write(s.value)})}else process.stdout.write(s.value)`, JSON.stringify({ value: print && settings.emptyOutput ? "" : value, print, delay: settings.delay, stderr: print ? settings.stderr : "", exitCode: print ? settings.exitCode : 0 })], options);
    children.push(child); if (print) { settings.beforePrint(); settings.afterPrint(); } return child;
  };
  const options = { store, resolveCli: async () => "/synthetic/claude", spawnProcess }, service = createClaudeSubmissions(options), input = { taskId: task.id, text: "Synthetic reviewed native text" };
  const review = () => service.review("personal", input), submit = (review, extra = {}) => service.submit("personal", { ...input, requestId: randomUUID(), token: review.confirmation.token, ...extra });
  try { await fn({ root, store, service, options, task, settings, calls, children, input, review, submit }); }
  finally { await service.close(); for (const child of children) await stopOwnedChild(child); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
test("stopped owned Claude text uses the exact native UUID and account without inventing turn acknowledgements", () => fixture(async ({ root, store, service, options, calls, input, review, submit }) => {
  const approval = await review(); assert.equal(approval.modelPromptSubmitted, false); assert.equal(calls.some((c) => c.args.includes("-p")), false);
  const requestId = randomUUID(), result = await submit(approval, { requestId }); assert.equal(result.reply, "Ready"); assert.equal(result.provider, "claude-code"); assert.equal(result.turnId, null); assert.equal(result.nativeTurnIdSupported, false); assert.equal(result.nativeSessionVerified, true); assert.equal(result.taskCompletionVerified, false);
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
