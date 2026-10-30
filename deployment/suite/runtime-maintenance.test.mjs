import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { privateWrite } from "../../tools/layout-studio/private-fs.mjs";
import { runtimeMaintenanceCoordinator } from "./runtime-maintenance.mjs";

async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-quiesce-")), root = join(directory, "app"), stateRoot = join(directory, "state"), runtimeRoot = join(directory, "runtime"), build = "a".repeat(64), events = [];
  let running = true, stopConfirmed = true, restartFails = false, others = [], otherBuild = false;
  const journal = join(runtimeRoot, ".maintenance/application-resume.json");
  const coordinate = runtimeMaintenanceCoordinator({ root, stateRoot, runtimeRoot,
    installed: async () => ({ current: build }), verifyBuild: async path => { assert.equal(path, join(root, "versions", build)); return { id: build }; },
    otherOwners: async pid => { events.push("inspect-other-owners"); assert.equal(pid, running ? 1234 : null); return others; },
    application: {
      status: async () => ({ status: running ? "ready" : "not-listening", pid: 1234, build: otherBuild ? "b".repeat(64) : build, origin: "http://127.0.0.1:43177" }),
      stop: async () => { events.push("stop"); if (stopConfirmed) running = false; return { stopped: stopConfirmed }; },
      launch: async (path, port) => { events.push("launch"); assert.equal(path, join(root, "versions", build)); assert.equal(port, 43177); if (restartFails) throw new Error("Synthetic restart failure"); running = true; return { status: "ready", build }; }
    }
  });
  try { await fn({ coordinate, journal, events, root, build, stopped: () => { running = false; }, stopFails: () => { stopConfirmed = false; }, restartFails: () => { restartFails = true; }, resumeWorks: () => { stopConfirmed = true; restartFails = false; }, otherOwner: () => { others = [{ pid: 9876 }]; }, wrongBuild: () => { otherBuild = true; } }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
test("runtime maintenance verifies and stops the installed owner, holds ownership, then restores its running state", () => fixture(async ({ coordinate, journal, events }) => {
  const result = await coordinate(async () => { events.push("maintain"); const value = JSON.parse(await readFile(journal, "utf8")); assert.equal(value.wasRunning, true); assert.ok(!JSON.stringify(value).includes("access=")); return "verified"; });
  assert.equal(result, "verified"); assert.deepEqual(events, ["inspect-other-owners", "stop", "maintain", "launch"]); await assert.rejects(readFile(journal), { code: "ENOENT" });
}));
test("maintenance preserves a previously stopped application without starting it", () => fixture(async ({ coordinate, journal, events, stopped }) => {
  stopped(); await coordinate(async () => { assert.equal(JSON.parse(await readFile(journal)).wasRunning, false); events.push("maintain"); }); assert.deepEqual(events, ["inspect-other-owners", "maintain"]);
}));
test("failed maintenance restores the prior running owner and propagates the original failure", () => fixture(async ({ coordinate, events, journal }) => {
  await assert.rejects(coordinate(() => { events.push("maintain"); throw new Error("Synthetic probe failure"); }), /probe failure/);
  assert.deepEqual(events, ["inspect-other-owners", "stop", "maintain", "launch"]); await assert.rejects(readFile(journal), { code: "ENOENT" });
}));
test("unconfirmed application exit preserves the resume journal and never changes optional software", () => fixture(async ({ coordinate, journal, events, stopFails }) => {
  stopFails(); await assert.rejects(coordinate(() => { events.push("unexpected-maintenance"); }), /did not verify exit/);
  assert.deepEqual(events, ["inspect-other-owners", "stop"]); assert.equal(JSON.parse(await readFile(journal)).wasRunning, true);
}));
test("recovery restores the running preference recorded before an interrupted owner stop", () => fixture(async ({ coordinate, root, build, journal, events, stopped }) => {
  stopped(); await privateWrite(journal, JSON.stringify({ schema: "switchyard-runtime-resume/v1", root, build, wasRunning: true, port: 43177 }));
  await coordinate(() => events.push("recover")); assert.deepEqual(events, ["inspect-other-owners", "recover", "launch"]); await assert.rejects(readFile(journal), { code: "ENOENT" });
}));
test("a restart failure retains recovery state; a subsequent recovery retries the ordinary launcher", () => fixture(async ({ coordinate, journal, events, restartFails, resumeWorks }) => {
  restartFails(); await assert.rejects(coordinate(() => {}), /restart failure/); assert.equal(JSON.parse(await readFile(journal)).wasRunning, true);
  resumeWorks(); await coordinate(() => events.push("recover")); assert.equal(events.at(-1), "launch"); await assert.rejects(readFile(journal), { code: "ENOENT" });
}));
test("another application build or local owner blocks maintenance without displacing it", () => fixture(async ({ coordinate, events, journal, wrongBuild }) => {
  wrongBuild(); await assert.rejects(coordinate(() => {}), /different Switchyard build/); assert.deepEqual(events, []); await assert.rejects(readFile(journal), { code: "ENOENT" });
}));
test("a second registered instance blocks optional runtime maintenance before stopping the installed owner", () => fixture(async ({ coordinate, events, journal, otherOwner }) => {
  otherOwner(); await assert.rejects(coordinate(() => {}), /Another Switchyard instance/); assert.deepEqual(events, ["inspect-other-owners"]); await assert.rejects(readFile(journal), { code: "ENOENT" });
}));
