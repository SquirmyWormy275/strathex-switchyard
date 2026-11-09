import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { createAgentService } from "./agents.mjs";
import { withBrowserSurface, browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";

async function fixture(fn, provider = "codex") {
  const root = await mkdtemp(join(tmpdir(), "switchyard-conversation-ui-")), keys = new Map(), nativeCalls = [];
  const store = createSuiteStore({ root, secrets: { get: async (id, purpose) => keys.get(id + purpose), set: async (id, purpose, value) => keys.set(id + purpose, value) } });
  let fingerprint = "a".repeat(64);
  const agents = createAgentService({ store, runtimeRoot: join(root, "runtime"), resolveCli: async () => "/synthetic/native", resolveMcp: async () => [],
    readClaudeLogin: async () => { nativeCalls.push("account-read"); return { fingerprint }; },
    codexFactory: () => ({ closed: false, accountFingerprint: fingerprint, initialize: async () => {}, close() { this.closed = true; }, async recheckAccount() { nativeCalls.push("account-read"); if (this.accountFingerprint !== fingerprint) throw Error("Synthetic native account changed"); }, async request(method, input) { nativeCalls.push(method); assert.equal(method, "thread/read"); return { thread: { id: input.threadId, status: { type: "idle" } } }; } }) });
  const suite = createSuite({ store, agents, voice: { discovery: async () => ({ available: false }) } });
  try {
    await suite.handle("/api/suite/bootstrap"); await suite.handle("/api/suite/mode", { mode: "personal-companion" }); await store.initialize("work", "work");
    await store.update("personal", "synthetic-conversations", s => { s.conversations = [
      { id: "legacy", provider, sessionId: randomUUID(), status: "complete", updatedAt: Date.now(), messages: [{ role: "user", text: "Original saved context" }], proposal: { synthetic: "retained proposal" } },
      { id: "bound", provider, sessionId: randomUUID(), status: "complete", accountFingerprint: fingerprint, updatedAt: Date.now(), messages: [{ role: "assistant", text: "Bound conversation only" }] }
    ]; });
    await withBrowserSurface({ store, suite, root }, async c => {
      c.$("conversation-provider").value = provider;
      const { mountConversations } = await import("./conversation-ui.mjs"); const ui = mountConversations({ notify() {}, refresh: c.refresh }); await c.refresh();
      await fn({ ...c, ui, nativeCalls, changeAccount: () => { fingerprint = "b".repeat(64); } });
    });
  } finally { await suite.close(); await rm(root, { recursive: true, force: true }); }
}
async function review(c) { c.change("saved-conversation", "legacy"); c.click("review-conversation-binding"); await until(() => c.$("conversation-binding-dialog").open && !c.$("confirm-conversation-binding").disabled); }
async function bind(c) { c.click("confirm-conversation-binding"); c.$("confirm-conversation-binding").dispatchEvent(new Event("click")); await c.responses.findLast(r => r.path.endsWith("binding/bind")).response; await until(() => !c.$("saved-conversation").disabled); }

test("saved history selection is local, exact and preserves separate unsent drafts", () => fixture(async c => {
  assert.equal(c.calls.length, 0); assert.equal(c.nativeCalls.length, 0); assert.equal(c.$("conversation-history").children.length, 0);
  c.$("design-message").value = "New conversation draft"; c.change("saved-conversation", "legacy");
  assert.equal(c.ui.id(), "legacy"); assert.equal(c.$("conversation-history").children[0].children[1].textContent, "Original saved context"); assert.equal(c.$("send-design").disabled, true);
  c.$("design-message").value = "Legacy draft"; c.change("saved-conversation", "bound"); assert.equal(c.$("design-message").value, ""); assert.equal(c.$("conversation-history").children[0].children[1].textContent, "Bound conversation only");
  c.change("saved-conversation", "legacy"); assert.equal(c.$("design-message").value, "Legacy draft"); c.click("new-design-conversation"); assert.equal(c.$("design-message").value, "New conversation draft"); assert.equal(c.calls.length, 0); assert.equal(c.nativeCalls.length, 0);
}));

test("both native providers require exact legacy context review and separate one-use account binding", async () => {
  for (const provider of ["codex", "claude-code"]) await fixture(async c => {
    await review(c); assert.match(c.$("conversation-binding-summary").textContent, /Original saved context/); assert.match(c.$("conversation-binding-summary").textContent, /retained proposal/); assert.ok(c.$("conversation-binding-summary").textContent.includes("a".repeat(64)));
    assert.equal((await c.store.snapshot("personal")).conversations[0].accountFingerprint, undefined);
    c.click("cancel-conversation-binding"); assert.equal(c.$("confirm-conversation-binding").disabled, true); await new Promise(r => setImmediate(r));
    await review(c); await bind(c); const row = (await c.store.snapshot("personal")).conversations[0];
    assert.equal(row.accountFingerprint, "a".repeat(64)); assert.equal(row.originalAccountVerified, false); assert.equal(row.messages[0].text, "Original saved context"); assert.equal(c.calls.filter(r => r.path.endsWith("binding/bind")).length, 1);
    assert.equal(c.nativeCalls.every(call => call === "account-read"), true); assert.equal(c.$("review-conversation-binding").disabled, true); assert.equal(c.$("send-design").disabled, false);
  }, provider);
});

test("a changed native account refuses the reviewed binding without changing context or sending a message", () => fixture(async c => {
  await review(c); c.changeAccount(); await bind(c);
  assert.equal((await c.store.snapshot("personal")).conversations[0].accountFingerprint, undefined); assert.match(c.$("design-status").textContent, /unconfirmed.*account changed/); assert.equal(c.nativeCalls.every(call => call === "account-read"), true);
}));

test("a lost successful binding reply reads back saved state without retrying or claiming original identity", () => fixture(async c => {
  await review(c); const original = globalThis.fetch;
  globalThis.fetch = async (path, input) => { const response = await original(path, input); if (path.endsWith("binding/bind")) { await response.text(); throw Error("Synthetic lost binding reply"); } return response; };
  try { await bind(c); } finally { globalThis.fetch = original; }
  assert.match(c.$("design-status").textContent, /unconfirmed/); assert.equal(c.$("review-conversation-binding").disabled, true); assert.equal(c.calls.filter(r => r.path.endsWith("binding/bind")).length, 1); assert.equal((await c.store.snapshot("personal")).conversations[0].originalAccountVerified, false);
}));

test("late account review cannot reopen approval or carry a Personal draft into Work", () => fixture(async c => {
  c.change("saved-conversation", "legacy"); c.$("design-message").value = "Private Personal draft"; const original = globalThis.fetch; let release;
  globalThis.fetch = async (path, input) => { const response = await original(path, input); if (path.endsWith("binding/review")) await new Promise(r => { release = r; }); return response; };
  try {
    c.click("review-conversation-binding"); await until(() => typeof release === "function"); c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.$("conversation-provider").value = "microsoft-365-copilot";
    c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") })); release(); await until(() => !c.$("saved-conversation").disabled);
    assert.equal(c.$("conversation-binding-dialog").open, false); assert.equal(c.$("conversation-binding-summary").textContent, ""); assert.equal(c.$("design-message").value, ""); assert.equal(c.$("send-design").disabled, true); assert.equal(c.$("review-conversation-binding").disabled, true);
  } finally { release?.(); globalThis.fetch = original; }
}));

test("explicit native status reads the exact bound thread; keyboard-only browsing never queries a provider", () => fixture(async c => {
  c.change("saved-conversation", "bound"); c.click("observe-conversation"); await until(() => /not verified task completion/.test(c.$("design-status").textContent) && !c.$("observe-conversation").disabled);
  assert.deepEqual(c.nativeCalls, ["account-read", "thread/read"]); assert.equal(c.calls.filter(r => r.path.endsWith("design/status"))[0].body.conversationId, "bound");
  await c.store.update("personal", "synthetic-keyboard-only", s => { s.mode = "keyboard-only"; }); await c.refresh(); assert.equal(c.$("observe-conversation").disabled, true); assert.equal(c.$("send-design").disabled, true);
  c.change("saved-conversation", "legacy"); assert.equal(c.$("review-conversation-binding").disabled, true); assert.equal(c.$("conversation-history").children.length, 1); assert.deepEqual(c.nativeCalls, ["account-read", "thread/read"]);
}));

test("late design completion and cancellation stay with their original workspace and draft", () => fixture(async c => {
  c.change("saved-conversation", "bound"); c.$("design-message").value = "Original pending draft"; const pending = c.ui.begin();
  assert.equal(c.$("design-message").disabled, true); assert.equal(c.ui.cancellation().conversationId, "bound");
  c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.$("conversation-provider").value = "microsoft-365-copilot";
  c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") }));
  assert.equal(c.ui.accepted(pending, "late-old-conversation"), false); assert.throws(() => c.ui.cancellation(), /exact pending/); c.ui.failed(pending, Error("Late old-workspace reply")); c.ui.finish();
  assert.equal(c.$("design-message").value, ""); assert.equal(c.$("saved-conversation").value, ""); assert.doesNotMatch(c.$("design-status").textContent, /Late old-workspace/);
  c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.$("conversation-provider").value = "codex"; await c.refresh(); c.change("saved-conversation", "bound"); assert.equal(c.$("design-message").value, "Original pending draft"); assert.equal(c.calls.length, 0);
}));

async function designer(fn, design) {
  let context;
  await browserSurfaceFixture(async c => {
    context = c; const previousWindow = globalThis.window; globalThis.window = new EventTarget();
    const { portableProfile } = await import("./workspace.mjs"), { plan } = await import("./test-support/copilot-fixture.mjs");
    let profile = portableProfile(plan, "conversation-ui", "Synthetic design", (await c.store.snapshot("personal")).workflow); await c.store.saveProfile("personal", profile);
    await c.store.update("personal", "synthetic-design-history", s => { s.conversations = [{ id: "saved", provider: "codex", sessionId: "synthetic-thread", accountFingerprint: "a".repeat(64), status: "complete", messages: [{ role: "user", text: "Earlier design context" }], updatedAt: Date.now() }]; });
    try {
      const { mountSuite } = await import("./suite-ui.mjs"); mountSuite({ getProfile: () => profile, loadProfile: p => { profile = p; }, previewProposal() {}, notify() {}, saved() {}, onPolicy() {}, onWorkflow() {}, download() {} });
      await until(() => /Private workspace connected/.test(c.$("suite-status").textContent)); await fn(c);
    } finally { globalThis.window = previousWindow; }
  }, { agents: { discovery: async () => [], close: async () => {}, design: request => design(context, request) } });
}
function submit(c) { c.$("design-form").dispatchEvent(new Event("submit", { cancelable: true })); }
test("the actual designer submits the selected conversation exactly once and retains its identity", async () => {
  const requests = [];
  await designer(async c => {
    c.change("saved-conversation", "saved"); c.$("design-message").value = "Refine this exact design"; submit(c); submit(c);
    await until(() => /Synthetic continued design/.test(c.$("design-status").textContent) && !c.$("send-design").disabled);
    assert.equal(requests.length, 1); assert.equal(requests[0].conversationId, "saved"); assert.equal(requests[0].provider, "codex"); assert.equal(c.$("saved-conversation").value, "saved"); assert.equal(c.$("design-message").value, "");
  }, async (c, request) => { requests.push(request); return { conversationId: "saved", reply: "Synthetic continued design", workflow: (await c.store.snapshot("personal")).workflow, proposal: null }; });
});

test("a lost designer reply preserves the draft and blocks another send until deliberate context selection", async () => {
  const requests = [];
  await designer(async c => {
    const original = globalThis.fetch;
    globalThis.fetch = async (path, input) => { const response = await original(path, input); if (path === "/api/suite/design") { await response.text(); throw Error("Synthetic lost design reply"); } return response; };
    try {
      c.$("design-message").value = "Preserve my draft"; submit(c); await until(() => /Reply unconfirmed/.test(c.$("design-status").textContent) && !c.$("refresh-conversations").disabled);
      assert.equal(c.$("send-design").disabled, true); submit(c); assert.equal(c.$("design-message").value, "Preserve my draft");
      c.click("refresh-conversations"); await until(() => c.$("saved-conversation").options.some(o => o.value === "new-result") && !c.$("refresh-conversations").disabled);
      assert.equal(c.$("send-design").disabled, true); c.change("saved-conversation", "new-result"); assert.equal(c.$("send-design").disabled, false); assert.equal(c.$("conversation-history").children[1].children[1].textContent, "Retained synthetic answer"); assert.equal(requests.length, 1);
    } finally { globalThis.fetch = original; }
  }, async (c, request) => { requests.push(request); await c.store.update("personal", "synthetic-successful-reply", s => { s.conversations.push({ id: "new-result", provider: "codex", sessionId: "synthetic-new-thread", accountFingerprint: "a".repeat(64), status: "complete", updatedAt: Date.now(), messages: [{ role: "user", text: request.message }, { role: "assistant", text: "Retained synthetic answer" }] }); }); return { conversationId: "new-result", reply: "Retained synthetic answer", workflow: (await c.store.snapshot("personal")).workflow, proposal: null }; });
});
