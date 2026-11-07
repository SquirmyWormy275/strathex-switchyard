import test from "node:test";
import assert from "node:assert/strict";
import { codexAccountFingerprint } from "./agents.mjs";
import { createCodexEditorProtocol } from "./codex-editor-protocol.mjs";

const account = { type: "chatgpt", email: "synthetic@example.invalid" }, target = { sessionId: "11111111-1111-4111-8111-111111111111", repositoryRoot: "/synthetic/repository", accountFingerprint: codexAccountFingerprint(account) };
const read = id => ({ id, method: "account/read", params: { refreshToken: false } });
const reply = (id, value = account) => ({ id, result: { account: value } });
const resume = (id = 2) => ({ id, method: "thread/resume", params: { threadId: target.sessionId, cwd: target.repositoryRoot, sandbox: "read-only", approvalPolicy: "on-request", excludeTurns: true } });
const resumed = (id = 2) => ({ id, result: { thread: { id: target.sessionId, cwd: target.repositoryRoot, status: { type: "idle" } }, cwd: target.repositoryRoot, sandbox: { type: "readOnly" }, approvalPolicy: "on-request", modelProvider: "openai" } });
function before(w) { assert.equal(w.client(read(1)), true); assert.equal(w.server(reply(1)), true); }
function loaded(w) { before(w); assert.equal(w.client(resume()), true); assert.equal(w.server(resumed()), true); }
function acknowledged(w) { loaded(w); assert.equal(w.client(read(3)), true); assert.equal(w.server(reply(3)), true); assert.equal(w.observation().protocolAcknowledged, true); }

test("one stream requires matching accounts around the exact resume reply and grants no terminal or task authority", () => {
  const w = createCodexEditorProtocol(target); before(w); assert.equal(w.observation().protocolAcknowledged, false);
  assert.equal(w.client(resume()), true); assert.equal(w.observation().protocolAcknowledged, false);
  assert.equal(w.server(resumed()), true); assert.equal(w.observation().protocolAcknowledged, false);
  assert.equal(w.client(read(3)), true); assert.equal(w.server(reply(3)), true);
  const evidence = w.observation(); assert.equal(evidence.protocolAcknowledged, true); assert.ok(Object.isFrozen(evidence));
  for (const field of ["transportPeerVerified", "terminalProcessVerified", "ideAttached", "authorityGranted", "completionVerified"]) assert.equal(evidence[field], false);
  const text = JSON.stringify(evidence); for (const secret of [account.email, target.sessionId, target.repositoryRoot, target.accountFingerprint]) assert.equal(text.includes(secret), false);
});
test("wrong original target, permission, history override or native response cannot acknowledge a different task", () => {
  for (const change of [{ threadId: "22222222-2222-4222-8222-222222222222" }, { cwd: "/other" }, { sandbox: "workspace-write" }, { approvalPolicy: "never" }, { path: "/private" }, { history: [] }, { developerInstructions: "PRIVATE" }, { excludeTurns: "true" }]) {
    const w = createCodexEditorProtocol(target); before(w); const m = resume(); Object.assign(m.params, change); assert.equal(w.client(m), false); assert.equal(w.observation().reason, "resume-target-or-permissions");
  }
  for (const mutate of [r => { r.thread.id = "other"; }, r => { r.thread.cwd = "/other"; }, r => { r.cwd = "/other"; }, r => { r.sandbox.type = "workspaceWrite"; }, r => { r.approvalPolicy = "never"; }, r => { r.modelProvider = "other"; }, r => { r.thread.status.type = "notLoaded"; }, r => { delete r.thread; }]) {
    const w = createCodexEditorProtocol(target); before(w); w.client(resume()); const m = resumed(); mutate(m.result); assert.equal(w.server(m), false); assert.equal(w.observation().protocolAcknowledged, false);
  }
  const w = createCodexEditorProtocol(target); before(w); w.client(resume()); const m = resumed(); m.result.thread.status.type = "active"; assert.equal(w.server(m), true);
});
test("an account request sent before the resume acknowledgement cannot stand in for the after sample", () => {
  const early = createCodexEditorProtocol(target); assert.equal(early.client(resume()), false);
  const pending = createCodexEditorProtocol(target); before(pending); pending.client(read("pending")); assert.equal(pending.client(resume()), false);
  const w = createCodexEditorProtocol(target); before(w); w.client(resume()); w.client(read(3)); w.server(resumed()); w.server(reply(3));
  assert.equal(w.observation().accountAfterVerified, false); assert.equal(w.observation().protocolAcknowledged, false);
  w.client(read(4)); w.client(read(5)); w.server(reply(4)); assert.equal(w.observation().protocolAcknowledged, false); w.server(reply(5)); assert.equal(w.observation().protocolAcknowledged, true);
});
test("account boundaries, mismatches, refreshes and native errors permanently invalidate a witness", () => {
  for (const value of [null, { type: "apiKey" }, { ...account, email: "changed@example.invalid" }]) {
    const w = createCodexEditorProtocol(target); loaded(w); w.client(read(3)); assert.equal(w.server(reply(3, value)), false); assert.equal(w.observation().protocolAcknowledged, false);
  }
  for (const m of [{ method: "account/updated", params: {} }, { method: "account/login/completed", params: { success: true } }]) {
    const w = createCodexEditorProtocol(target); acknowledged(w); assert.equal(w.server(m), false); w.close(); assert.equal(w.observation().reason, "account-boundary"); assert.equal(w.client(read(4)), false);
  }
  for (const phase of ["account", "resume"]) {
    const w = createCodexEditorProtocol(target); if (phase === "resume") { before(w); w.client(resume()); } else w.client(read(1));
    assert.equal(w.server({ id: phase === "resume" ? 2 : 1, error: { message: "PRIVATE native rejection" } }), false); assert.equal(JSON.stringify(w.observation()).includes("PRIVATE"), false);
  }
  for (const params of [{}, { refreshToken: true }, { refreshToken: false, login: true }]) { const w = createCodexEditorProtocol(target); assert.equal(w.client({ ...read(1), params }), false); }
});
test("replay, unmatched replies, typed IDs and bounded request inventory are enforced without storing private messages", () => {
  const replay = createCodexEditorProtocol(target); before(replay); assert.equal(replay.client(read(1)), false);
  const typed = createCodexEditorProtocol(target); typed.client(read(1)); assert.equal(typed.server(reply("1")), false);
  const duplicate = createCodexEditorProtocol(target); loaded(duplicate); assert.equal(duplicate.client(resume(4)), false);
  const pending = createCodexEditorProtocol(target); for (let id = 0; id < 128; id++) assert.equal(pending.client({ id, method: "config/read", params: {} }), true); assert.equal(pending.client(read(128)), false);
  const history = createCodexEditorProtocol(target); for (let id = 0; id < 4096; id++) { assert.equal(history.client({ id, method: "config/read", params: {} }), true); assert.equal(history.server({ id, result: {} }), true); } assert.equal(history.client(read(4096)), false);
});
test("a fresh pending account read withdraws acknowledgement until its matching reply; closure never retains live acceptance", () => {
  const w = createCodexEditorProtocol(target); acknowledged(w); w.client(read(4)); assert.equal(w.observation().protocolAcknowledged, false); w.server(reply(4)); assert.equal(w.observation().protocolAcknowledged, true);
  w.close(); assert.equal(w.observation().stage, "closed"); assert.equal(w.observation().protocolAcknowledged, false); assert.equal(w.server(reply(4)), false);
});
test("task or login effects invalidate even notification-shaped attempts; ordinary notifications and server requests prove nothing", () => {
  for (const method of ["turn/start", "turn/steer", "thread/start", "thread/fork", "thread/rollback", "account/login/start", "account/logout"]) for (const withId of [true, false]) {
    const w = createCodexEditorProtocol(target); assert.equal(w.client({ ...(withId ? { id: 8 } : {}), method, params: {} }), false);
  }
  for (const method of ["thread/resume", "account/read"]) { const w = createCodexEditorProtocol(target); assert.equal(w.client({ method, params: {} }), false); }
  const w = createCodexEditorProtocol(target); for (const m of [{ method: "account/rateLimits/updated", params: {} }, { method: "account/login/completed", params: { success: false } }, { id: 44, method: "item/commandExecution/requestApproval", params: {} }]) assert.equal(w.server(m), true);
  assert.equal(w.client({ id: 44, result: { decision: "cancel" } }), true); assert.equal(w.observation().protocolAcknowledged, false);
});
test("malformed and oversized frames refuse with fixed reasons; targets are copied and closed", () => {
  for (const input of [null, {}, { ...target, command: "PRIVATE" }, { ...target, repositoryRoot: "/repo/../other" }, { ...target, sessionId: "--last" }, { ...target, accountFingerprint: "unknown" }]) assert.throws(() => createCodexEditorProtocol(input));
  for (const message of [null, [], {}, { id: null, result: {} }, { id: "bad\n", result: {} }, { id: 1, result: {}, error: {} }, { id: 1, method: "account/read", result: {} }, { method: "a\nb" }, { method: "initialized", params: { text: "x".repeat(1048576) } }, { id: 1n, result: {} }]) for (const side of ["client", "server"]) {
    const w = createCodexEditorProtocol(target); assert.equal(w[side](message), false); assert.equal(w.observation().reason, "invalid-" + side + "-frame");
  }
  const input = { ...target }, w = createCodexEditorProtocol(input); input.sessionId = "other"; acknowledged(w);
});

test("Windows targets require an explicit local drive contract and preserve exact path spelling around resume", () => {
  const repositoryRoot = 'C:\\Reviewed Projects\\repository', selected = { ...target, repositoryRoot };
  assert.throws(() => createCodexEditorProtocol(selected));
  assert.throws(() => createCodexEditorProtocol(target, { platform: 'win32' }));
  for (const path of ['C:relative', '\\\\server\\share\\repo', '\\\\?\\C:\\repo', 'C:/repo', 'C:\\repo\\..\\other', 'C:\\repo\\', 'C:\\repo.', 'C:\\repo ', 'C:\\NUL.txt', 'C:\\repo:stream', 'C:\\repo\\LPT1', 'C:\\bad\ud800', '/repository']) {
    assert.throws(() => createCodexEditorProtocol({ ...target, repositoryRoot: path }, { platform: 'win32' }));
  }
  for (const replyPath of [repositoryRoot, 'c:\\Reviewed Projects\\repository', 'C:\\Reviewed Projects\\other']) {
    const w = createCodexEditorProtocol(selected, { platform: 'win32' }); before(w);
    const request = resume(), response = resumed(); request.params.cwd = repositoryRoot; response.result.cwd = response.result.thread.cwd = replyPath;
    assert.equal(w.client(request), true); assert.equal(w.server(response), replyPath === repositoryRoot);
    if (replyPath === repositoryRoot) { w.client(read(3)); w.server(reply(3)); assert.equal(w.observation().protocolAcknowledged, true); }
    else assert.equal(w.observation().protocolAcknowledged, false);
  }
});
