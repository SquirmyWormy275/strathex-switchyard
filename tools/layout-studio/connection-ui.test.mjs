import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";

test("cancelled and replaced-workspace shortcut reviews discard their target and change list", () => browserSurfaceFixture(async ({ $, change, click, document, store }) => {
  const { connectWorkspace } = await import("./connection.mjs");
  const calls = [], plan = { profile: { evidence: "saved-snapshot" }, actions: [{ id: "progress", label: "Check progress" }] };
  connectWorkspace({ getPlan: () => plan, notify() {}, request: async (path, body) => {
    calls.push({ path, body });
    if (path === "/api/discovery") return { synthetic: true, shortcuts: true, platform: "synthetic", hostLayouts: ["US"], checkedAt: new Date().toISOString(), keyboard: { status: "saved", message: "Fixture" }, chatgpt: { status: "unavailable" } };
    if (path === "/api/transactions") return [];
    if (path === "/api/review") return { reviewId: "synthetic-review", shortcut: "SUPER CTRL 2", label: "synthetic target", changes: ["PRIVATE SYNTHETIC SHORTCUT CHANGE"] };
    throw Error("No host mutation is available in this fixture");
  } });
  document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await store.snapshot("personal") }));
  change("connection-action", "progress"); change("connection-role-target", "0");
  for (const action of ["cancel", "workspace"]) {
    await until(() => !$("review-connection").disabled); click("review-connection");
    await until(() => $("host-review-dialog").open && !$("apply-connection").disabled);
    assert.match($("host-review-title").textContent, /Operator/);
    assert.equal($("host-review-changes").children[0].textContent, "PRIVATE SYNTHETIC SHORTCUT CHANGE");
    if (action === "cancel") click("cancel-connection");
    else document.dispatchEvent(new Event("switchyard-workspace-changing"));
    await until(() => $("host-review-title").textContent === "" && $("host-review-changes").children.length === 0);
    assert.equal($("host-review-dialog").open, false); assert.equal($("apply-connection").disabled, true);
  }
  assert.equal(calls.some(c => c.path === "/api/apply"), false);
}));

test("role shortcut review uses the selected named control and discards a late old-workspace review", () => browserSurfaceFixture(async ({ $, change, click, document, store }) => {
  const { connectWorkspace } = await import("./connection.mjs");
  const plan = { profile: { evidence: "saved-snapshot" }, actions: [{ id: "progress", label: "Check progress" }] };
  let resolveReview; const calls = [];
  $("connection-implementation").value = "switchyard.role/v1";
  connectWorkspace({ getPlan: () => plan, notify() {}, request: async (path, body) => {
    calls.push({ path, body });
    if (path === "/api/discovery") return { synthetic: true, shortcuts: true, platform: "synthetic", hostLayouts: ["US"], checkedAt: new Date().toISOString(), keyboard: { status: "saved", message: "Fixture" }, chatgpt: { status: "unavailable" } };
    if (path === "/api/transactions") return [];
    if (path === "/api/review") return new Promise(resolve => { resolveReview = resolve; });
    throw Error("No host mutation is available in this fixture");
  } });
  document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await store.snapshot("personal") }));
  change("connection-action", "progress"); change("connection-role-target", "0");
  await until(() => !$("review-connection").disabled); click("review-connection");
  const sent = calls.find(c => c.path === "/api/review"); assert.equal(sent.body.implementation, "switchyard.role/v1"); assert.deepEqual(sent.body.target, { roleId: "operator", intent: "status" });
  document.dispatchEvent(new Event("switchyard-workspace-changing"));
  resolveReview({ reviewId: "old-review", shortcut: "SUPER CTRL 2", label: "old target", changes: ["old review"] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal($("host-review-dialog").open, false); assert.equal($("apply-connection").disabled, true);
  assert.equal(calls.some(c => c.path === "/api/apply"), false);
}));

test("a source-reference layout cannot enable host shortcut review", () => browserSurfaceFixture(async ({ $, change, document, store }) => {
  const { connectWorkspace } = await import("./connection.mjs");
  $("connection-implementation").value = "switchyard.role/v1";
  let discovered = false;
  connectWorkspace({ getPlan: () => ({ profile: { evidence: "source-reference" }, actions: [{ id: "progress", label: "Check progress" }] }), notify() {}, request: async path => {
    if (path === "/api/discovery") return { shortcuts: true, platform: "synthetic", hostLayouts: ["US"], checkedAt: new Date().toISOString(), keyboard: { status: "reference", message: "Fixture" }, chatgpt: { status: "focusable" } };
    if (path === "/api/transactions") { discovered = true; return []; }
    throw Error("Reference layouts cannot reach host review");
  } });
  document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await store.snapshot("personal") }));
  change("connection-action", "progress"); change("connection-role-target", "0");
  await until(() => discovered); assert.equal($("review-connection").disabled, true);
}));

test("Windows Claude Desktop shortcut selection requires its saved identity and sends only the exact navigation implementation", () => browserSurfaceFixture(async ({ $, change, click, document, store }) => {
  const { connectWorkspace } = await import("./connection.mjs");
  const calls = [], plan = { profile: { evidence: "saved-snapshot" }, actions: [{ id: "summon", label: "Return to my app" }] };
  connectWorkspace({ getPlan: () => plan, notify() {}, request: async (path, body) => {
    calls.push({ path, body });
    if (path === "/api/discovery") return { shortcuts: true, platform: "win32", hostLayouts: ["US"], checkedAt: new Date().toISOString(), keyboard: { status: "saved", message: "Fixture" }, chatgpt: { status: "unavailable" } };
    if (path === "/api/transactions") return [];
    if (path === "/api/review") return { reviewId: "synthetic-navigation", shortcut: "SUPER CTRL F1", label: "Show Claude Desktop", changes: ["Synthetic shortcut review"] };
    throw Error("No host mutation is available in this fixture");
  } });
  document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await store.snapshot("personal") }));
  await until(() => [...$("connection-implementation").options].some(o => o.value === "native-claude-desktop.focus/v1"));
  change("connection-action", "summon"); change("connection-implementation", "native-claude-desktop.focus/v1");
  assert.equal($("review-connection").disabled, true);
  await store.update("personal", "synthetic-reviewed-image", s => { s.nativeWindowsClaude = { identity: { executableSha256: "a".repeat(64) } }; });
  document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await store.snapshot("personal") }));
  await until(() => !$("review-connection").disabled); click("review-connection");
  await until(() => $("host-review-dialog").open);
  assert.equal(calls.find(row => row.path === "/api/review").body.implementation, "native-claude-desktop.focus/v1");
  assert.match($("connection-description").textContent, /Claude Desktop/);
  assert.equal(calls.some(row => row.path === "/api/apply"), false);
  await store.update("personal", "synthetic-keyboard-only", s => { s.mode = "keyboard-only"; });
  document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await store.snapshot("personal") }));
  assert.equal($("host-review-dialog").open, false); assert.equal($("review-connection").disabled, true);
}));
