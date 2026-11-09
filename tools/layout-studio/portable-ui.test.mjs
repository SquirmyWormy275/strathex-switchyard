import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
import { portableProfile } from "./workspace.mjs";
import { parseBoardProfile, newPlan } from "./model.mjs";
import { recommendedWorkflow } from "./catalog.mjs";
import { createPortablePackage, parsePortablePackage } from "./portable-package.mjs";

function profile(id = "original", name = "Synthetic saved layout") {
  const plan = newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic keyboard", layout: "one-key", keys: [{ id: "one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" }] }));
  plan.actions = [{ id: "task-status", label: "Check progress", family: "review", consequence: "read_only", confirmation: false, frequencyPerDay: 0, secondsSaved: 0, binding: { keyId: "one", modifier: "gui_ctrl" } }];
  return portableProfile(plan, id, name, recommendedWorkflow());
}
const portableFixture = fn => browserSurfaceFixture(async context => {
  let current = profile(); const downloads = [], notices = [];
  await context.store.saveProfile("personal", current);
  const { mountPortable } = await import("./portable-ui.mjs");
  const ui = mountPortable({ getProfile: () => current, persist: async () => {}, refresh: context.refresh, loadProfile: value => { current = value; }, download: (...args) => downloads.push(args), notify: message => notices.push(message) });
  await context.refresh();
  await fn({ ...context, ui, downloads, notices, current: () => current });
});

test("portable import presents concrete changes before clearing local bindings and keeps local mode", () => portableFixture(async ({ ui, $, click, store, current, calls }) => {
  const candidate = createPortablePackage(profile("incoming", "Incoming keyboard"), { modePreference: "keyboard-only", intentAssignments: [{ actionId: "task-status", roleId: "builder", intent: "status" }] });
  const before = await store.snapshot("personal");
  await ui.reviewImport(candidate);
  assert.equal($("portable-import-dialog").open, true); assert.match($("portable-import-effects").textContent, /1 local control connections will be cleared/);
  assert.equal((await store.snapshot("personal")).profile.id, "original");
  assert.equal(calls.some(call => call.path.endsWith("/import")), false);
  click("confirm-profile-import"); await until(() => /Imported Incoming/.test($("portability-status").textContent));
  const after = await store.snapshot("personal"); assert.equal(current().id, "incoming"); assert.deepEqual(after.roleBindings, []);
  assert.equal(after.mode, before.mode); assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.deviceSnapshots, before.deviceSnapshots);
}));

test("a stale import refuses the original review and leaves the edited workflow and binding intact", () => portableFixture(async ({ ui, $, click, store }) => {
  await ui.reviewImport(createPortablePackage(profile("incoming")));
  await store.saveWorkflow("personal", { ...recommendedWorkflow(), name: "Changed after review" });
  const before = await store.snapshot("personal");
  click("confirm-profile-import"); await until(() => /Review this exact profile/.test($("portability-status").textContent));
  const after = await store.snapshot("personal"); assert.deepEqual(after.profile, before.profile); assert.deepEqual(after.workflow, before.workflow); assert.deepEqual(after.roleBindings, before.roleBindings);
  assert.equal($("confirm-profile-import").disabled, true);
}));

test("unknown profile versions preserve saved definitions without opening an adoption review", () => portableFixture(async ({ ui, $, store, calls }) => {
  const before = await store.snapshot("personal"); await ui.reviewImport({ schema: "switchyard-profile/v99", name: "Future" });
  assert.match($("portability-status").textContent, /Keep the original/); assert.equal($("portable-import-dialog").open, false);
  assert.deepEqual(await store.snapshot("personal"), before); assert.equal(calls.some(call => call.path.endsWith("/import")), false);
}));

test("reviewed v2 export retains chosen portable meanings and excludes local agent identities", () => portableFixture(async ({ $, click, downloads, store }) => {
  click("export-json"); await until(() => $("portable-export-dialog").open && !$("download-portable-profile").disabled);
  assert.equal(downloads.length, 0); click("portable-recommended-meanings");
  $("portable-mode").value = "personal-companion";
  click("download-portable-profile"); await until(() => downloads.length === 1);
  const exported = parsePortablePackage(JSON.parse(downloads[0][1]));
  assert.deepEqual(exported.intentAssignments, [{ actionId: "task-status", roleId: "builder", intent: "status" }]); assert.equal(exported.assumptions.modePreference, "personal-companion");
  assert.equal(downloads[0][2], "application/json");
  for (const binding of (await store.snapshot("personal")).roleBindings) assert.equal(downloads[0][1].includes(binding.sessionId), false);
}));

test("changed saved definitions stop an export reviewed against the old layout", () => portableFixture(async ({ $, click, downloads, store }) => {
  click("export-json"); await until(() => $("portable-export-dialog").open && !$("download-portable-profile").disabled);
  await store.saveProfile("personal", profile("different", "Different layout"));
  click("download-portable-profile"); await until(() => /saved layout changed/.test($("portability-status").textContent));
  assert.equal(downloads.length, 0);
}));

test("print export verifies the backend content digest and honors Work export policy", () => portableFixture(async ({ $, click, downloads, store, document, calls }) => {
  $("legend-format").value = "review-html"; $("legend-labels").children[0].children[0].value = "Progress"; click("export-legends"); await until(() => downloads.length === 1);
  assert.equal(downloads[0][2], "text/html"); assert.match(downloads[0][1], /Check progress/); assert.match(downloads[0][1], /Print label: Progress/); assert.match($("legend-status").textContent, /15 mm/);
  await store.initialize("work", "work"); await store.saveProfile("work", profile());
  document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await store.snapshot("work") }));
  assert.equal($("export-json").disabled, true); assert.equal($("export-profile-settings").disabled, true); assert.equal($("export-legends").disabled, true);
  assert.equal(calls.filter(call => call.path.endsWith("/legends/export")).length, 1);
}));
