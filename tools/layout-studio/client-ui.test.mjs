import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
import { createClientLaunch } from "./client-launch.mjs";
async function fixture(fn, effect) {
  let service, calls = 0;
  const clientLaunch = { launch: (...args) => service.launch(...args), list: (...args) => service.list(...args), stopCompartment: (...args) => service ? service.stopCompartment(...args) : { stopped: true }, close: () => service?.close() };
  return browserSurfaceFixture(async c => {
    service = createClientLaunch({ store: c.store, stateDirectory: join(c.root, "client-fixture"), platform: "linux", isActive: async () => true, guardianStopped: async () => true, command: async (executable, args, options) => {
      calls++; assert.equal(executable, "/usr/bin/python3"); assert.deepEqual(args.slice(0, 2), ["-I", "-B"]); const request = JSON.parse(options.inputText); assert.equal(Object.keys(request).sort().join(","), "id,schema,targetSha256");
      await options.onGuardianReady({ schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: "owned-linux-session" }); await effect?.({ options, request, ...c });
      return { status: "completed", exitCode: 0, inputDelivered: true, treeExitVerified: true, stdout: JSON.stringify({ schema: "switchyard-client-portal-result/v1", id: request.id, status: "accepted", response: 0, applicationOpenedVerified: false, accountVerified: false, sessionIdentified: false }) };
    } });
    const { mountClients } = await import("./client-ui.mjs"), downloads = [], notices = [];
    mountClients({ notify: text => notices.push(text), download: (...args) => downloads.push(args) }); const before = await c.store.snapshot("personal"); await c.refresh(); await until(() => c.$("client-picker").options.length === 5);
    await fn({ ...c, before, downloads, notices, effects: () => calls });
  }, { clientLaunch });
}
async function review(c) { c.click("review-client-launch"); await until(() => c.$("client-review-dialog").open && !c.$("confirm-client-launch").disabled); }

test("distinct client metadata and exported recipes do not open applications or carry authority", () => fixture(async c => {
  assert.equal(c.effects(), 0); assert.deepEqual(await c.store.snapshot("personal"), c.before);
  assert.match(c.$("client-facts").children.map(e => e.textContent).join(" "), /Separate from Microsoft 365 Copilot/);
  c.change("client-picker", "microsoft-365-copilot-web"); assert.equal(c.$("review-client-launch").disabled, true); assert.equal(c.$("download-client-recipe").disabled, true);
  c.change("client-picker", "claude-desktop"); assert.equal(c.$("review-client-launch").disabled, true); assert.match(c.$("client-facts").children.map(e => e.textContent).join(" "), /Separate from Claude Code/);
  c.click("download-client-recipe"); await until(() => c.downloads.length === 1); const [name, content, mime] = c.downloads[0], recipe = JSON.parse(content);
  assert.equal(name, "switchyard-claude-desktop.json"); assert.equal(mime, "application/json"); assert.equal(recipe.importedAuthority, false); assert.equal(recipe.approval, "required-from-current-local-environment"); assert.equal(c.effects(), 0); assert.deepEqual(await c.store.snapshot("personal"), c.before);
}));

test("a concrete launch review can be cancelled and only one confirmed fixed request reaches the synthetic portal", () => fixture(async c => {
  await review(c); assert.match(c.$("client-review-summary").textContent, /https:\/\/github.com\/copilot/); assert.match(c.$("client-review-summary").textContent, /does not verify or change that account/); assert.equal(c.effects(), 0);
  c.click("cancel-client-launch"); await until(() => c.$("client-review-summary").textContent === ""); assert.equal(c.effects(), 0); await review(c); c.click("confirm-client-launch"); c.$("confirm-client-launch").dispatchEvent(new Event("click"));
  await until(() => c.$("client-launch-history").children.length === 1 && !c.$("review-client-launch").disabled); assert.equal(c.effects(), 1); assert.match(c.$("client-status").textContent, /opening and exact-task attachment are not verified/);
  const record = (await c.store.snapshot("personal")).clientLaunches[0]; assert.equal(record.status, "settled"); assert.equal(record.stoppedVerified, true); assert.equal(record.cleanupPending, false); assert.equal(record.result.providerAccountVerified, false); assert.equal(record.result.modelPromptSubmitted, false);
  const request = c.calls.find(row => row.path.endsWith("/integrations/launch")); assert.deepEqual(Object.keys(request.body).sort(), ["compartment", "id", "requestId"]);
}));

test("changed selection and workspace invalidate a launch review and Work exposes only Microsoft 365", () => fixture(async c => {
  await review(c); c.change("client-picker", "figma-web"); assert.equal(c.$("client-review-dialog").open, false); assert.equal(c.$("confirm-client-launch").disabled, true);
  await review(c); c.document.dispatchEvent(new Event("switchyard-workspace-changing")); await c.store.initialize("work", "work"); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") })); await until(() => c.$("client-picker").options.length === 5);
  assert.equal(c.$("client-review-summary").textContent, ""); assert.equal(c.$("client-picker").value, "microsoft-365-copilot-web"); assert.equal(c.$("review-client-launch").disabled, true); assert.equal(c.$("download-client-recipe").disabled, true); assert.equal(c.$("client-review-dialog").open, false);
  c.change("client-picker", "github-copilot-web"); assert.equal(c.$("review-client-launch").disabled, true); assert.equal(c.effects(), 0);
}));

test("an uncertain portal outcome remains visible and refresh never retries it", () => fixture(async c => {
  await review(c); c.click("confirm-client-launch"); await until(() => c.notices.some(n => /Synthetic portal disconnect/.test(n)) && !c.$("review-client-launch").disabled);
  assert.equal(c.effects(), 1); assert.match(c.$("client-launch-history").children[0].textContent, /outcome-unconfirmed/); c.click("refresh-clients"); await until(() => c.$("client-picker").options.length === 5); assert.equal(c.effects(), 1); assert.equal((await c.store.snapshot("personal")).clientLaunches[0].status, "outcome-unconfirmed");
}, async () => { throw Error("Synthetic portal disconnect"); }));

test("a late native result cannot populate another workspace's status or history", async () => {
  let release, entered = false; const waiting = new Promise(resolve => { release = resolve; });
  await fixture(async c => {
    await review(c); c.click("confirm-client-launch"); await until(() => entered);
    try { c.document.dispatchEvent(new Event("switchyard-workspace-changing")); await c.store.initialize("work", "work"); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") })); await until(() => c.$("client-picker").options.length === 5); }
    finally { release(); }
    await until(() => !c.$("refresh-clients").disabled); assert.equal(c.$("client-launch-history").children.length, 0); assert.doesNotMatch(c.$("client-status").textContent, /accepted the launch/); assert.equal(c.$("client-review-summary").textContent, ""); assert.equal(c.$("client-picker").value, "microsoft-365-copilot-web");
  }, async () => { entered = true; await waiting; });
});
