import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
import { portableProfile } from "./workspace.mjs";
import { plan } from "./test-support/copilot-fixture.mjs";

async function fixture(fn) {
  await browserSurfaceFixture(async c => {
    const previousWindow = globalThis.window, originalFetch = globalThis.fetch;
    globalThis.window = new EventTarget();
    const main = { inert: false };
    c.document.querySelector = selector => { assert.equal(selector, ".app-main"); return main; };
    // EventTarget dispatch does not join promises returned by listeners. Keep
    // this fixture's document and HTTP host alive until its Suite handlers have
    // finished, including refreshes emitted while an interaction is settling.
    const pending = new Set();
    for (const [target, types] of [[c.document, ["switchyard-local-connected", "switchyard-refresh-request"]], [c.$("compartment-picker"), ["change"]], [c.$("retry-workspace-connection"), ["click"]]]) {
      const add = target.addEventListener.bind(target);
      target.addEventListener = (type, listener, options) => add(type, types.includes(type) ? function (event) {
        const result = listener.call(this, event);
        if (result?.then) {
          pending.add(result);
          result.then(() => pending.delete(result), () => pending.delete(result));
        }
        return result;
      } : listener, options);
    }
    await c.store.initialize("work", "work");
    let profile = portableProfile(plan, "personal-draft", "Personal draft", (await c.store.snapshot("personal")).workflow);
    const original = structuredClone(profile), messages = [];
    try {
      const { mountSuite } = await import("./suite-ui.mjs");
      const ui = mountSuite({ getProfile: () => profile, loadProfile(value) { profile = value; }, previewProposal() {}, notify(message) { messages.push(message); }, saved() {}, onPolicy() {}, onWorkflow() {}, download() {} });
      await until(() => /Private workspace connected/.test(c.$("suite-status").textContent) && !c.$("retry-workspace-connection").disabled);
      await fn({ ...c, ui, main, original, originalFetch, messages, profile: () => profile, edit: value => { profile = value; } });
      await Promise.all(c.responses.map(row => row.response));
    } finally {
      try { while (pending.size) await Promise.all([...pending]); }
      finally { globalThis.fetch = originalFetch; globalThis.window = previousWindow; }
    }
  });
}

test("reconnection cannot move an unsaved Personal layout into another window's selected Work workspace", () => fixture(async c => {
  const before = await c.store.snapshot("work");
  await c.suite.handle("/api/suite/compartment/select", { compartment: "work" });
  c.document.dispatchEvent(new Event("switchyard-local-connected"));
  await until(() => !c.$("retry-workspace-connection").disabled);
  assert.equal(c.$("compartment-picker").value, "personal");
  assert.equal(c.$("workspace-connection-recovery").hidden, false);
  assert.match(c.$("workspace-connection-error").textContent, /workspace menu/);
  assert.deepEqual(c.profile(), c.original);
  assert.equal(c.calls.filter(row => row.path.endsWith("/profile/save")).length, 0);
  assert.deepEqual((await c.store.snapshot("work")).profile, before.profile);
  c.change("compartment-picker", "work");
  await until(() => !c.main.inert && c.calls.some(row => row.path.endsWith("/compartment/select")));
  assert.equal(c.profile(), null);
  assert.equal(c.$("workspace-connection-recovery").hidden, true);
  assert.deepEqual((await c.store.snapshot("personal")).profile, c.original);
  assert.equal((await c.store.snapshot("work")).profile, null);
}));

test("an acknowledged workspace switch with a failed snapshot cannot save the previous layout into its destination", () => fixture(async c => {
  let fail = true;
  globalThis.fetch = async (path, options) => {
    if (fail && path === "/api/suite/snapshot" && JSON.parse(options.body).compartment === "work") throw Error("Synthetic selected-workspace read failure");
    return c.originalFetch(path, options);
  };
  c.change("compartment-picker", "work");
  await until(() => !c.main.inert && c.messages.some(message => /selected-workspace read failure/.test(message)));
  assert.equal(await c.store.selection(), "work");
  assert.equal(c.profile(), null);
  assert.equal(c.$("save-workspace").disabled, true);
  assert.equal(c.$("workspace-connection-recovery").hidden, false);
  assert.equal(c.$("workflow-name").value, "");
  assert.equal(c.$("workflow-steps").value, "");
  assert.equal(c.$("workflow-roles").value, "");
  assert.equal(c.$("saved-profile").options.length, 0);
  await c.ui.persist();
  assert.deepEqual((await c.store.snapshot("personal")).profile, c.original);
  assert.equal((await c.store.snapshot("work")).profile, null);
  assert(c.calls.filter(row => row.path.endsWith("/profile/save")).every(row => row.body.compartment === "personal"));
  fail = false; c.click("retry-workspace-connection");
  await until(() => c.$("workspace-connection-recovery").hidden && !c.$("retry-workspace-connection").disabled);
  assert.equal(c.$("compartment-picker").value, "work");
  assert.equal(c.profile(), null);
}));

test("a refused pre-switch save preserves the unsaved layout and never changes the selected workspace", () => fixture(async c => {
  await c.store.saveProfile("personal", c.original);
  const edited = { ...c.original, name: "Unsent Personal edits" }; c.edit(edited);
  globalThis.fetch = async (path, options) => {
    if (path.endsWith("/profile/save")) throw Error("Synthetic pre-switch save failure");
    return c.originalFetch(path, options);
  };
  c.change("compartment-picker", "work");
  await until(() => !c.main.inert && c.messages.some(message => /pre-switch save failure/.test(message)));
  assert.equal(await c.store.selection(), "personal");
  assert.equal(c.$("compartment-picker").value, "personal");
  assert.deepEqual(c.profile(), edited);
  assert.equal(c.calls.some(row => row.path.endsWith("/compartment/select")), false);
  assert.deepEqual((await c.store.snapshot("personal")).profile, c.original);
  assert.equal((await c.store.snapshot("work")).profile, null);
}));

test("a lost selection acknowledgement retains the old layout and does not replay selection during retry", () => fixture(async c => {
  let lose = true;
  globalThis.fetch = async (path, options) => {
    const response = await c.originalFetch(path, options);
    if (lose && path.endsWith("/compartment/select")) { await response.text(); throw Error("Synthetic lost selection acknowledgement"); }
    return response;
  };
  c.change("compartment-picker", "work");
  await until(() => !c.main.inert && c.messages.some(message => /lost selection acknowledgement/.test(message)));
  assert.equal(await c.store.selection(), "work");
  assert.equal(c.$("compartment-picker").value, "personal");
  assert.deepEqual(c.profile(), c.original);
  c.document.dispatchEvent(new Event("switchyard-local-connected"));
  await until(() => !c.$("retry-workspace-connection").disabled);
  assert.equal(c.$("workspace-connection-recovery").hidden, false);
  assert.equal(c.calls.filter(row => row.path.endsWith("/compartment/select")).length, 1);
  assert.deepEqual((await c.store.snapshot("personal")).profile, c.original);
  assert.equal((await c.store.snapshot("work")).profile, null);
  lose = false; c.change("compartment-picker", "work");
  await until(() => !c.main.inert && c.calls.filter(row => row.path.endsWith("/compartment/select")).length === 2);
  assert.equal(c.profile(), null);
  assert.equal(c.$("workspace-connection-recovery").hidden, true);
}));

test("an unread destination retains its identity when a later draft and another window's selection arrive", () => fixture(async c => {
  let fail = true;
  globalThis.fetch = async (path, options) => {
    if (fail && path === "/api/suite/snapshot" && JSON.parse(options.body).compartment === "work") throw Error("Synthetic pending Work read");
    return c.originalFetch(path, options);
  };
  c.change("compartment-picker", "work");
  await until(() => !c.main.inert && c.messages.some(message => /pending Work read/.test(message)));
  const draft = portableProfile(plan, "work-draft", "Unsent Work draft", (await c.store.snapshot("work")).workflow);
  c.edit(draft);
  await c.suite.handle("/api/suite/compartment/select", { compartment: "personal" });
  c.click("retry-workspace-connection");
  await until(() => !c.$("retry-workspace-connection").disabled);
  assert.equal(c.$("compartment-picker").value, "work");
  assert.equal(c.$("compartment-picker").disabled, false);
  assert.deepEqual(c.profile(), draft);
  assert.match(c.$("workspace-connection-error").textContent, /workspace menu/);
  assert.deepEqual((await c.store.snapshot("personal")).profile, c.original);
  fail = false; c.change("compartment-picker", "personal");
  await until(() => !c.main.inert && c.calls.filter(row => row.path.endsWith("/compartment/select")).length === 2);
  assert.deepEqual((await c.store.snapshot("work")).profile, draft);
  assert.deepEqual(c.profile(), c.original);
  assert.equal(c.$("workspace-connection-recovery").hidden, true);
}));
