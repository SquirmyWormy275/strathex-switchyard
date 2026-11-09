import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { createCodingSessions } from "./coding-sessions.mjs";
import { createClaudeCoding, claudeAccount } from "./claude-coding.mjs";
import { createReviewedTaskText } from "./reviewed-task-text.mjs";
import { withBrowserSurface, until } from "./test-support/browser-ui.mjs";

// Real encrypted state, directory identities, HTTP and review lifecycle. Native
// account/task transport is an explicit double; provider contracts have separate tests.
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-task-ui-")), repositoryRoot = join(root, "project"), keys = new Map(), calls = [];
  await mkdir(join(repositoryRoot, ".git"), { recursive: true });
  const store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (id, purpose) => keys.get(id + purpose), set: async (id, purpose, value) => keys.set(id + purpose, value) } });
  const login = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "synthetic@example.invalid", orgId: "synthetic-org" };
  const settings = { fingerprint: "a".repeat(64), fail: false, hold: false };
  const daemon = { account: async () => ({ type: "chatgpt", fingerprint: settings.fingerprint }), read: async (id, repositoryRoot) => ({ id, repositoryRoot, observation: "idle" }), close: async () => {}, stopCompartment: async () => ({ stopped: true }) };
  const coding = createCodingSessions({ store, resolveCli: async () => "/synthetic/codex", daemon, taskDriverFactory: () => ({ account: daemon.account, async start(_root, _label, _c, options) { await options.beforeEffect(); calls.push("create-codex"); return { threadId: randomUUID() }; }, close: async () => [{ stopped: true }] }) });
  const claudeCoding = createClaudeCoding({ store, resolveCli: async () => "/synthetic/claude", run: async (_exe, args) => { calls.push(args[0]); if (args[0] === "--version") return "2.1.319 (Claude Code)"; if (args[0] === "auth") return JSON.stringify(login); if (args[0] === "agents") return "[]"; throw Error("No native launch permitted"); } });
  const makeText = provider => createReviewedTaskText({ store, adapter: {
    provider, nativeVersion: provider === "codex" ? "0.167.0" : "2.1.319", launchPolicy: provider === "codex" ? "read-only/on-request" : "tools-disabled/plan", permissions: "synthetic native tools disabled",
    submitAction: provider === "codex" ? "submit_codex_text" : "submit_claude_text", resolveAction: provider === "codex" ? "resolve_codex_text" : "resolve_claude_text", reviewReason: "Review the exact synthetic account, directory and text.", recoveryReason: "Resume only the original synthetic requested UUID.",
    validateTask(t) { assert.equal(t.nativeTransport, provider === "codex" ? "owned-stdio" : "owned-print"); },
    canRecoverTask: t => provider === "claude-code" && t.status === "creation-uncertain" && t.nativeIdentityVerified === false,
    validateRecovery(t, state) { if (!t.creationOutcomeReviewedAt || state.codingTurns.some(r => r.taskId === t.id && r.status === "outcome-unconfirmed")) throw Error("Review the original uncertainty first"); },
    recordUnconfirmed(t) { if (provider === "claude-code" && t.nativeIdentityVerified === false) t.status = "creation-uncertain"; },
    recordOutcomeReview(t) { if (provider === "claude-code") t.creationOutcomeReviewedAt = Date.now(); },
    acceptResult(t) { if (provider === "claude-code") { t.nativeIdentityVerified = true; t.status = "registered"; } },
    async openTask({ task }) {
      calls.push("review-native-" + provider); if (task.accountFingerprint !== (provider === "codex" ? settings.fingerprint : claudeAccount(login))) throw Error("Synthetic account changed");
      return { prepareTurn: async () => {}, async runTurn({ recovery, signal, onStarted }) {
        calls.push(recovery ? "resume-only" : "text-" + provider); await onStarted("synthetic-turn");
        if (settings.fail) throw Error("Synthetic uncertain native delivery");
        if (settings.hold) await new Promise((resolve, reject) => { if (signal.aborted) reject(Error("Synthetic cancelled")); else signal.addEventListener("abort", () => reject(Error("Synthetic cancelled")), { once: true }); });
        return { text: "Synthetic retained reply", nativeStatus: "completed", nativeSessionVerified: true, nativeTurnIdSupported: true, turnId: "synthetic-turn" };
      } };
    }
  } });
  const suite = createSuite({ store, coding, claudeCoding, codexSubmissions: makeText("codex"), claudeSubmissions: makeText("claude-code"), agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) } });
  try {
    await suite.handle("/api/suite/bootstrap"); await suite.handle("/api/suite/mode", { mode: "personal-companion" }); await store.initialize("work", "work");
    await withBrowserSurface({ store, suite, root }, async c => { const { mountTasks } = await import("./task-ui.mjs"); mountTasks({ notify() {}, refresh: c.refresh }); await c.refresh(); await fn({ ...c, repositoryRoot, nativeCalls: calls, settings }); });
  } finally { await suite.close(); await rm(root, { recursive: true, force: true }); }
}
async function confirm(c, suffix) { c.click("confirm-task-operation"); c.$("confirm-task-operation").dispatchEvent(new Event("click")); await c.responses.findLast(r => r.path.endsWith(suffix)).response; await until(() => !c.$("task-provider").disabled); }
async function create(c, provider = "codex") { c.change("task-provider", provider); c.change("task-label", "Synthetic selected project"); c.change("task-root", c.repositoryRoot); c.click("review-task-connection"); await confirm(c, provider === "codex" ? "/codex/create" : "/text/create"); return (await c.store.snapshot("personal")).codingSessions.at(-1); }
async function reviewText(c, text = "Review this precise message") { c.change("task-text", text); c.click("review-task-text"); await until(() => c.$("task-operation-dialog").open && !c.$("confirm-task-operation").disabled); }

test("task creation requires a concrete local review and creates exactly one empty Codex task", () => fixture(async c => {
  assert.equal(c.calls.length, 0); assert.equal(c.nativeCalls.length, 0); c.change("task-label", "Synthetic selected project"); c.change("task-root", c.repositoryRoot); c.click("review-task-connection");
  assert.equal(c.calls.length, 0); assert.match(c.$("task-operation-summary").textContent, /create one empty native thread/); assert.ok(c.$("task-operation-summary").textContent.includes(c.repositoryRoot));
  c.click("cancel-task-operation"); await new Promise(r => setImmediate(r)); assert.equal((await c.store.snapshot("personal")).codingSessions, undefined);
  const task = await create(c); assert.equal(task.status, "registered"); assert.equal(task.nativeTransport, "owned-stdio"); assert.equal(c.$("coding-task").value, task.id); assert.deepEqual(c.nativeCalls, ["create-codex"]); assert.equal(c.calls.filter(r => r.path.endsWith("/codex/create")).length, 1);
}));

test("Claude text reservation stays local until separately reviewed text verifies its native identity", () => fixture(async c => {
  const task = await create(c, "claude-code"); assert.equal(task.nativeIdentityVerified, false); assert.equal(task.backgroundId, null); assert.match(c.$("task-status").textContent, /Only a local requested identity/);
  assert.equal(c.nativeCalls.some(call => call.startsWith("text-") || call === "--background"), false);
  await reviewText(c); assert.ok(c.$("task-operation-summary").textContent.includes(task.sessionId)); assert.match(c.$("task-operation-summary").textContent, /2.1.319/);
  await confirm(c, "/turns/submit"); const saved = await c.store.snapshot("personal"); assert.equal(saved.codingSessions[0].nativeIdentityVerified, true); assert.equal(saved.codingTurns[0].taskCompletionVerified, false); assert.match(c.$("task-turn-content").textContent, /Synthetic retained reply/); assert.equal(c.nativeCalls.filter(v => v === "text-claude-code").length, 1);
}));

test("connecting an existing exact native session preserves its original runtime without claiming text or attachment", () => fixture(async c => {
  c.change("task-connection-kind", "bind"); c.change("task-label", "Existing task"); c.change("task-root", c.repositoryRoot); c.change("task-session", "exact-existing-thread"); c.click("review-task-connection"); assert.equal(c.calls.length, 0);
  await confirm(c, "/bind"); const task = (await c.store.snapshot("personal")).codingSessions[0]; assert.equal(task.sessionId, "exact-existing-thread"); assert.equal(task.nativeTransport, undefined); c.change("task-text", "No implicit authority"); assert.equal(c.$("review-task-text").disabled, true); assert.deepEqual(c.nativeCalls, []);
}));

test("text changes invalidate approval and changed native account refuses before submission", () => fixture(async c => {
  await create(c); await reviewText(c); c.change("task-text", "Changed draft"); assert.equal(c.$("task-operation-dialog").open, false); assert.equal(c.$("confirm-task-operation").disabled, true);
  await new Promise(r => setImmediate(r)); await reviewText(c, "Changed draft"); c.settings.fingerprint = "b".repeat(64); await confirm(c, "/turns/submit"); assert.match(c.$("task-status").textContent, /account changed/); assert.equal(c.$("task-text").value, "Changed draft"); assert.equal(c.nativeCalls.some(v => v.startsWith("text-")), false); assert.equal((await c.store.snapshot("personal")).codingTurns, undefined);
}));

test("a lost successful text reply reads retained history without resubmission", () => fixture(async c => {
  await create(c); await reviewText(c); const original = globalThis.fetch;
  globalThis.fetch = async (path, input) => { const response = await original(path, input); if (path.endsWith("/turns/submit")) { await response.text(); throw Error("Synthetic lost HTTP reply"); } return response; };
  try { await confirm(c, "/turns/submit"); } finally { globalThis.fetch = original; }
  assert.match(c.$("task-status").textContent, /Result unconfirmed/); assert.match(c.$("task-turn-content").textContent, /Synthetic retained reply/); assert.equal(c.$("task-text").value, "Review this precise message");
  c.click("refresh-coding-tasks"); await until(() => !c.$("refresh-coding-tasks").disabled); assert.equal(c.nativeCalls.filter(v => v === "text-codex").length, 1); assert.equal((await c.store.snapshot("personal")).codingTurns.length, 1);
}));

test("lost creation acknowledgement retains its stable request identity without another native creation", () => fixture(async c => {
  const original = globalThis.fetch;
  globalThis.fetch = async (path, input) => { const response = await original(path, input); if (path.endsWith("/codex/create")) { await response.text(); throw Error("Synthetic lost creation reply"); } return response; };
  let task; try { task = await create(c); } finally { globalThis.fetch = original; }
  assert.match(c.$("task-status").textContent, /Result unconfirmed/); assert.ok(c.$("task-status").textContent.includes(task.id)); assert.equal(c.$("coding-task").value, task.id);
  c.click("refresh-coding-tasks"); await until(() => !c.$("refresh-coding-tasks").disabled); assert.equal(c.nativeCalls.filter(v => v === "create-codex").length, 1); assert.equal((await c.store.snapshot("personal")).codingSessions.length, 1);
}));

test("UTF-8 text size is checked before contacting the native task", () => fixture(async c => {
  await create(c); c.change("task-text", "🙂".repeat(3001)); const before = c.calls.length; c.click("review-task-text"); await until(() => !c.$("task-provider").disabled);
  assert.match(c.$("task-status").textContent, /12000 UTF-8 bytes/); assert.equal(c.calls.length, before); assert.deepEqual(c.nativeCalls, ["create-codex"]); assert.equal(c.$("task-operation-dialog").open, false);
}));

test("uncertain first Claude creation needs outcome review before exact resume-only recovery and local deletion", () => fixture(async c => {
  const task = await create(c, "claude-code"); await reviewText(c); c.settings.fail = true; await confirm(c, "/turns/submit"); assert.equal(c.$("review-task-text").disabled, true); assert.equal(c.$("review-task-turn-delete").disabled, true);
  c.click("review-task-outcome"); await until(() => c.$("task-operation-dialog").open && !c.$("confirm-task-operation").disabled); await confirm(c, "/outcome/resolve");
  assert.equal((await c.store.snapshot("personal")).codingTurns[0].status, "reviewed-unconfirmed"); assert.equal(c.nativeCalls.filter(v => v === "text-claude-code").length, 1);
  c.settings.fail = false; c.change("task-text-operation", "recovery"); await reviewText(c, "Recover only this original conversation"); assert.match(c.$("task-operation-summary").textContent, /recover-exact-native-session/); await confirm(c, "/recovery/submit");
  const s = await c.store.snapshot("personal"); assert.equal(s.codingSessions.length, 1); assert.equal(s.codingSessions[0].sessionId, task.sessionId); assert.equal(s.codingTurns[1].operation, "recover-exact-native-session"); assert.equal(c.nativeCalls.filter(v => v === "resume-only").length, 1);
  c.click("review-task-turn-delete"); assert.match(c.$("task-operation-summary").textContent, /Native provider history/); await confirm(c, "/turns/delete"); assert.equal((await c.store.snapshot("personal")).codingTurns.length, 1); assert.equal((await c.store.snapshot("personal")).codingSessions.length, 1);
}));

test("cancellation targets the active request while its submission is awaiting a reply", () => fixture(async c => {
  await create(c); await reviewText(c); c.settings.hold = true; c.click("confirm-task-operation"); await until(() => c.nativeCalls.includes("text-codex") && !c.$("cancel-task-turn").disabled);
  const submitted = c.calls.find(r => r.path.endsWith("/turns/submit")); c.click("cancel-task-turn"); await until(() => !c.$("task-provider").disabled && !c.$("cancel-task-turn").disabled);
  const cancellation = c.calls.find(r => r.path.endsWith("/turns/cancel")); assert.equal(cancellation.body.requestId, submitted.body.requestId); assert.equal((await c.store.snapshot("personal")).codingTurns[0].status, "outcome-unconfirmed"); assert.equal(c.nativeCalls.filter(v => v === "text-codex").length, 1);
}));

test("keyboard-only mode permits deliberate local outcome review without restoring native text authority", () => fixture(async c => {
  await create(c); await reviewText(c); c.settings.fail = true; await confirm(c, "/turns/submit");
  await c.store.update("personal", "synthetic-keyboard-only", s => { s.mode = "keyboard-only"; }); await c.refresh(); const before = c.nativeCalls.length;
  c.click("review-task-outcome"); await until(() => c.$("task-operation-dialog").open && !c.$("confirm-task-operation").disabled); await confirm(c, "/outcome/resolve");
  assert.equal((await c.store.snapshot("personal")).codingTurns[0].status, "reviewed-unconfirmed"); assert.equal(c.$("review-task-text").disabled, true); assert.equal(c.$("check-coding-task").disabled, true); assert.equal(c.nativeCalls.length, before);
}));

test("late review cannot reopen approval in Work and keyboard-only history grants no native effects", () => fixture(async c => {
  await create(c); const original = globalThis.fetch; let release;
  globalThis.fetch = async (path, input) => { const response = await original(path, input); if (path.endsWith("/turns/review")) await new Promise(r => { release = r; }); return response; };
  try {
    c.change("task-text", "Private Personal text"); c.click("review-task-text"); await until(() => typeof release === "function"); c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") })); release(); await new Promise(r => setImmediate(r));
    assert.equal(c.$("task-operation-dialog").open, false); assert.equal(c.$("task-text").value, ""); assert.equal(c.$("confirm-task-operation").disabled, true);
  } finally { release?.(); globalThis.fetch = original; }
  await until(() => !c.$("task-operation-dialog").open); await c.store.update("personal", "synthetic-keyboard-mode", s => { s.mode = "keyboard-only"; }); await c.refresh(); const count = c.nativeCalls.length;
  c.change("task-text", "Do not submit"); assert.equal(c.$("review-task-text").disabled, true); assert.equal(c.$("review-task-connection").disabled, true); assert.equal(c.$("check-coding-task").disabled, true); assert.equal(c.nativeCalls.length, count);
}));
