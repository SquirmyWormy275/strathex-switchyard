import test from "node:test";
import assert from "node:assert/strict";
import { createSuite } from "./suite.mjs";
import { createCopilot } from "./copilot.mjs";
import { copilotFixture, tenantId, clientId, accountId, plan } from "./test-support/copilot-fixture.mjs";
import { withBrowserSurface, until } from "./test-support/browser-ui.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
async function fixture(t, fn, options = {}) {
  let clock = Date.now(), token = "pending", hook = async () => {}, network = [];
  const f = await copilotFixture(t, { now: () => clock, fetcher: async (url, request) => {
    network.push(url); await hook(url, request);
    if (url.endsWith("/devicecode")) return json({ device_code: "SYNTHETIC_DEVICE", user_code: "EXAMPLE", verification_uri: "https://microsoft.com/devicelogin", interval: 5, expires_in: 900 });
    if (url.endsWith("/token")) return token === "connected" ? json({ access_token: "SYNTHETIC_NEW_ACCESS", refresh_token: "SYNTHETIC_NEW_REFRESH", expires_in: 3600 }) : json({ error: token === "slow" ? "slow_down" : "authorization_pending" }, 400);
    if (url.includes("/me?")) return json({ id: accountId, displayName: "Synthetic approved account" });
    throw Error("Synthetic lost Microsoft acknowledgement");
  } });
  const suite = createSuite({ store: f.store, copilotFactory: input => createCopilot({ ...input, now: () => clock, fetcher: f.transport }), agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  try {
    await suite.handle("/api/suite/bootstrap"); await suite.handle("/api/suite/compartment/select", { compartment: "work" });
    await withBrowserSurface({ store: f.store, suite, root: "synthetic-copilot-ui" }, async c => {
      const refresh = async () => c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") }));
      const context = { ...c, refresh, network, setToken: value => { token = value; }, advance: ms => { clock += ms; }, hook: value => { hook = value; } };
      if (!options.fullSuite) { const { mountCopilot } = await import("./copilot-ui.mjs"); mountCopilot({ notify() {}, refresh }); await refresh(); }
      await fn(context);
    });
  } finally { await suite.close(); }
}
async function start(c) {
  c.change("copilot-tenant", tenantId); c.change("copilot-client", clientId); c.$("copilot-approved").checked = true; c.$("copilot-approved").dispatchEvent(new Event("change"));
  c.click("connect-copilot"); c.$("connect-copilot").dispatchEvent(new Event("click"));
  await until(() => !c.$("check-copilot-login").disabled);
}
async function uncertain(c) {
  await assert.rejects(c.suite.handle("/api/suite/design", { compartment: "work", provider: "microsoft-365-copilot", message: "Synthetic request", plan }), /lost Microsoft acknowledgement/);
  c.click("refresh-copilot-requests"); await until(() => !c.$("review-copilot-outcome").disabled);
}
async function review(c) { c.click("review-copilot-outcome"); await until(() => c.$("copilot-outcome-dialog").open && !c.$("confirm-copilot-outcome").disabled); }
async function settle(c, suffix, check) { await c.responses.findLast(r => r.path.endsWith(suffix)).response; await until(check); }

test("sign-in is explicit, stays in its workspace and checks only when requested", t => fixture(t, async c => {
  assert.equal(c.calls.length, 0); assert.equal(c.network.length, 0); assert.equal(c.$("connect-copilot").disabled, true);
  await start(c); assert.equal(c.network.length, 1); assert.equal(c.calls.filter(r => r.path.endsWith("/login")).length, 1); assert.match(c.$("copilot-status").textContent, /No automatic polling/);
  c.click("check-copilot-login"); await settle(c, "/poll", () => !c.$("check-copilot-login").disabled); assert.equal(c.network.length, 1);
  c.advance(6000); c.setToken("slow"); c.click("check-copilot-login"); await settle(c, "/poll", () => !c.$("check-copilot-login").disabled); assert.match(c.$("copilot-status").textContent, /after 10 seconds/);
  c.advance(11000); c.setToken("connected"); c.click("check-copilot-login"); await settle(c, "/poll", () => /Synthetic approved account/.test(c.$("copilot-account-detail").textContent) && c.$("check-copilot-login").disabled);
  assert.equal(c.network.length, 4); assert.equal((await c.store.snapshot("work")).copilotAccount.account, tenantId + ":" + accountId); assert.equal(c.$("copilot-approved").checked, false);
}));

test("stopping during credential verification aborts only the exact sign-in and preserves the prior credential", t => fixture(t, async c => {
  const previous = await c.store.credential("work", "m365-token", undefined, { provider: "microsoft-365-copilot" });
  await start(c); c.advance(6000); c.setToken("connected"); let signal;
  c.hook(async (url, request) => { if (url.includes("/me?")) { signal = request.signal; await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); } });
  c.click("check-copilot-login"); await until(() => !!signal); c.click("cancel-copilot-login");
  await settle(c, "/login/cancel", () => /Local sign-in stopped/.test(c.$("copilot-status").textContent) && c.$("check-copilot-login").disabled);
  assert.equal(signal.aborted, true); assert.match(c.$("copilot-status").textContent, /settlement: verified/); assert.equal(await c.store.credential("work", "m365-token", undefined, { provider: "microsoft-365-copilot" }), previous);
  assert.equal((await c.store.snapshot("work")).copilotAccount, undefined); assert.equal(c.calls.filter(r => r.path.endsWith("/login/cancel")).length, 1);
}));

test("another workspace cannot cancel or consume the original device-code session", t => fixture(t, async c => {
  const login = await c.suite.handle("/api/suite/copilot/login", { compartment: "work", tenantId, clientId, approved: true });
  await assert.rejects(c.suite.handle("/api/suite/copilot/login/cancel", { compartment: "personal", loginId: login.loginId }), /not|pending/);
  await assert.rejects(c.suite.handle("/api/suite/copilot/poll", { compartment: "personal", loginId: login.loginId }), /not pending/);
  c.advance(6000); c.setToken("connected"); assert.equal((await c.suite.handle("/api/suite/copilot/poll", { compartment: "work", loginId: login.loginId })).status, "connected");
  assert.equal((await c.store.snapshot("work")).copilotAccount.account, tenantId + ":" + accountId);
}));

test("a late sign-in response cannot populate another workspace or schedule any polling", t => fixture(t, async c => {
  const original = globalThis.fetch; let release;
  globalThis.fetch = async (path, input) => { const response = await original(path, input); if (path.endsWith("/login")) await new Promise(r => { release = r; }); return response; };
  try {
    c.change("copilot-tenant", tenantId); c.change("copilot-client", clientId); c.$("copilot-approved").checked = true; c.$("copilot-approved").dispatchEvent(new Event("change")); c.click("connect-copilot");
    await until(() => !!release); c.document.dispatchEvent(new Event("switchyard-workspace-changing")); await c.suite.handle("/api/suite/compartment/select", { compartment: "personal" });
    c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("personal") })); release(); await new Promise(r => setImmediate(r));
    assert.equal(c.$("copilot-tenant").value, ""); assert.equal(c.$("check-copilot-login").disabled, true); assert.doesNotMatch(c.$("copilot-status").textContent, /EXAMPLE/); assert.equal(c.calls.filter(r => r.path.endsWith("/poll")).length, 0); assert.equal(c.network.length, 1);
  } finally { release?.(); globalThis.fetch = original; }
}));

test("a lost successful enrollment reply reads back the saved account without polling again", t => fixture(t, async c => {
  await start(c); c.advance(6000); c.setToken("connected"); const original = globalThis.fetch;
  globalThis.fetch = async (path, input) => { const response = await original(path, input); if (path.endsWith("/poll")) { await response.text(); throw Error("Synthetic lost enrollment reply"); } return response; };
  try { c.click("check-copilot-login"); await until(() => /Synthetic approved account/.test(c.$("copilot-account-detail").textContent) && !c.$("check-copilot-login").disabled); }
  finally { globalThis.fetch = original; }
  assert.match(c.$("copilot-status").textContent, /result unconfirmed/); assert.equal(c.calls.filter(r => r.path.endsWith("/poll")).length, 1); assert.equal(c.network.length, 3);
}));

test("local uncertainty review is separate, one-use, and available in keyboard-only mode without replay", t => fixture(t, async c => {
  await uncertain(c); const count = c.network.length;
  await c.suite.handle("/api/suite/mode", { compartment: "work", mode: "keyboard-only" }); await c.refresh();
  c.click("refresh-copilot-requests"); await until(() => !c.$("review-copilot-outcome").disabled); await review(c);
  assert.match(c.$("copilot-outcome-summary").textContent, /does not cancel remote processing/); assert.doesNotMatch(c.$("copilot-outcome-summary").textContent, /SYNTHETIC_PINNED_ACCESS|Synthetic request/);
  c.click("cancel-copilot-outcome"); await new Promise(r => setImmediate(r)); assert.equal((await c.store.snapshot("work")).copilotRequests[0].status, "outcome-unconfirmed");
  await review(c); c.click("confirm-copilot-outcome"); c.$("confirm-copilot-outcome").dispatchEvent(new Event("click"));
  await settle(c, "/requests/resolve", () => /reviewed-unconfirmed/.test(c.$("copilot-request-detail").textContent) && !c.$("refresh-copilot-requests").disabled);
  assert.equal(c.network.length, count); assert.equal(c.calls.filter(r => r.path.endsWith("/requests/resolve")).length, 1); assert.equal((await c.store.snapshot("work")).copilotRequests[0].originalOutcome, "outcome-unconfirmed"); assert.match(c.$("copilot-status").textContent, /No request was replayed/);
}));

test("a lost successful acknowledgement reads its durable outcome without automatically resolving again", t => fixture(t, async c => {
  await uncertain(c); await review(c); const original = globalThis.fetch;
  globalThis.fetch = async (path, input) => { const response = await original(path, input); if (path.endsWith("/requests/resolve")) { await response.text(); throw Error("Synthetic lost acknowledgement"); } return response; };
  try { c.click("confirm-copilot-outcome"); await until(() => /reviewed-unconfirmed/.test(c.$("copilot-request-detail").textContent) && !c.$("refresh-copilot-requests").disabled); }
  finally { globalThis.fetch = original; }
  assert.match(c.$("copilot-status").textContent, /Acknowledgement unconfirmed/); assert.equal(c.calls.filter(r => r.path.endsWith("/requests/resolve")).length, 1); assert.equal(c.network.length, 1);
}));

test("a policy change after review refuses resolution and retains the original uncertainty", t => fixture(t, async c => {
  await uncertain(c); await review(c); await c.store.update("work", "synthetic-policy-change", s => { s.mode = "keyboard-only"; });
  c.click("confirm-copilot-outcome"); await settle(c, "/requests/resolve", () => !c.$("refresh-copilot-requests").disabled);
  assert.equal((await c.store.snapshot("work")).copilotRequests[0].status, "outcome-unconfirmed"); assert.match(c.$("copilot-status").textContent, /unconfirmed/); assert.equal(c.network.length, 1);
}));

test("a delayed outcome review cannot reopen confirmation in another workspace", t => fixture(t, async c => {
  await uncertain(c); const original = globalThis.fetch; let release;
  globalThis.fetch = async (path, input) => { const response = await original(path, input); if (path.endsWith("/requests/review")) await new Promise(r => { release = r; }); return response; };
  try {
    c.click("review-copilot-outcome"); await until(() => !!release); c.document.dispatchEvent(new Event("switchyard-workspace-changing"));
    c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("personal") })); release(); await new Promise(r => setImmediate(r));
    assert.equal(c.$("copilot-outcome-dialog").open, false); assert.equal(c.$("copilot-outcome-summary").textContent, ""); assert.equal(c.$("copilot-request-detail").textContent.includes(tenantId), false); assert.equal(c.$("confirm-copilot-outcome").disabled, true);
  } finally { release?.(); globalThis.fetch = original; }
}));

test("the actual designer gives a lost Microsoft submission one durable UUID and never retries it", t => fixture(t, async c => {
  const previousWindow = globalThis.window; globalThis.window = new EventTarget();
  const { portableProfile } = await import("./workspace.mjs"), { mountSuite } = await import("./suite-ui.mjs");
  let profile = portableProfile(plan, "synthetic-work-design", "Synthetic work design", (await c.store.snapshot("work")).workflow); await c.store.saveProfile("work", profile);
  try {
    mountSuite({ getProfile: () => profile, loadProfile: p => { profile = p; }, previewProposal() {}, notify() {}, saved() {}, onPolicy() {}, onWorkflow() {}, download() {} });
    await until(() => /Private workspace connected/.test(c.$("suite-status").textContent)); c.$("design-message").value = "Synthetic request";
    c.$("design-form").dispatchEvent(new Event("submit", { cancelable: true })); c.$("design-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await until(() => /Reply unconfirmed/.test(c.$("design-status").textContent)); const requests = c.calls.filter(r => r.path === "/api/suite/design");
    assert.equal(requests.length, 1); assert.match(requests[0].body.requestId, /^[a-f0-9-]{36}$/); assert.equal((await c.store.snapshot("work")).copilotRequests[0].requestId, requests[0].body.requestId); assert.ok(c.$("design-status").textContent.includes(requests[0].body.requestId)); assert.equal(c.$("design-message").value, "Synthetic request"); assert.equal(c.network.length, 1);
  } finally { globalThis.window = previousWindow; }
}, { fullSuite: true }));
