import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSuiteStore } from "./suite-store.mjs";
import { createClientLaunch } from "./client-launch.mjs";
async function fixture(t, handler) {
  const stage = await mkdtemp(join(tmpdir(), "switchyard-client-launch-")), keys = new Map(), services = [];
  const store = createSuiteStore({ root: join(stage, "state"), secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => { keys.set(c+p,v); } } });
  await store.initialize("personal"); await store.initialize("work", "work"); let calls = 0, stopped = true, active = true;
  const command = async (exe, args, options) => {
    calls++; assert.equal(exe, "/usr/bin/python3"); assert.equal(args[0], "-I"); assert.equal(args[1], "-B"); assert.equal(options.env.PYTHONPATH, undefined); assert.equal(options.inputText.includes("https:"), false);
    const request = JSON.parse(options.inputText), scope = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: process.platform === "linux" ? "owned-linux-session" : "windows-job" };
    await options.onGuardianReady(scope);
    assert.equal((await store.snapshot("personal")).clientLaunches.at(-1).ownedRuntime.id, scope.id);
    assert.equal((await store.snapshot("personal")).clientLaunches.at(-1).stoppedVerified, false);
    const value = await handler?.({ options, request, scope, store }) ?? { schema: "switchyard-client-portal-result/v1", id: request.id, status: "accepted", response: 0, applicationOpenedVerified: false, accountVerified: false, sessionIdentified: false };
    return { status: "completed", exitCode: 0, stdout: JSON.stringify(value), inputDelivered: true, treeExitVerified: true };
  };
  const create = (extra = {}) => { const service = createClientLaunch({ store, stateDirectory: join(stage, "scratch"), platform: "linux", command, guardianStopped: async () => stopped, isActive: async () => active, ...extra }); services.push(service); return service; };
  const service = create(); t.after(async () => { const results = await Promise.allSettled(services.map(s => s.close())); await rm(stage, { recursive: true, force: true }); const failure = results.find(r => r.status === "rejected"); if (failure) throw failure.reason; });
  return { stage, store, service, create, enable: () => store.update("personal", "companion", s => { s.mode = "personal-companion"; }), calls: () => calls, stopped: v => { stopped = v; }, active: v => { active = v; } };
}
const request = () => ({ id: "github-copilot-web", requestId: randomUUID() });
test("the Python launch boundary rejects raw URI, command and self-approval input before importing desktop dependencies", async () => {
  for (const extra of [{ url: "https://foreign.invalid" }, { command: "arbitrary" }, { approved: true }]) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.platform === "win32" ? "python" : "/usr/bin/python3", ["-I", "-B", fileURLToPath(new URL("./client-portal.py", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"] }); let out = "", err = "";
      child.stdout.on("data", b => { out += b; }); child.stderr.on("data", b => { err += b; }); child.stdin.on("error", () => {}); child.once("error", reject); child.once("close", code => resolve({ code, out, err }));
      child.stdin.end(JSON.stringify({ schema: "switchyard-client-portal/v1", id: "github-copilot-web", ...extra }) + "\n");
    }); assert.equal(result.code, 2); assert.equal(result.out, ""); assert.equal(result.err.includes("foreign.invalid"), false); assert.match(result.err, /did not settle/);
  }
});
test("client launch rejects unsupported platforms, arbitrary commands, unselected or keyboard-only workspaces and prohibited Work providers before native startup", async t => {
  const f = await fixture(t), input = request();
  await assert.rejects(f.service.launch("personal", { ...input, url: "https://foreign.invalid" }), /exact documented/);
  await assert.rejects(f.service.launch("personal", input), /Keyboard-only/);
  await assert.rejects(f.create({ platform: "win32" }).launch("personal", input), /unfinished/);
  await assert.rejects(f.service.launch("personal", { ...input, id: "claude-desktop" }), /unfinished/);
  await f.store.update("work", "managed", s => { s.mode = "managed-companion"; }); await assert.rejects(f.service.launch("work", input), /prohibited/);
  await f.enable(); f.active(false); await assert.rejects(f.service.launch("personal", input), /no longer selected/); assert.equal(f.calls(), 0);
});
test("portal acceptance is durable, scoped and duplicate-safe without claiming a window, account or session", async t => {
  const f = await fixture(t); await f.enable(); const input = request(), result = await f.service.launch("personal", input);
  assert.equal(result.status, "launch-requested"); assert.equal(result.providerAccountVerified, false); assert.equal(result.applicationOpenedVerified, false); assert.equal(result.sessionIdentified, false); assert.equal(result.modelPromptSubmitted, false);
  const state = await f.store.snapshot("personal"), record = state.clientLaunches[0]; assert.equal(record.status, "settled"); assert.equal(record.stoppedVerified, true); assert.equal(record.cleanupPending, false); await assert.rejects(access(record.scratch), { code: "ENOENT" });
  assert.equal((await f.service.launch("personal", input)).replayed, true); assert.equal(f.calls(), 1);
  await assert.rejects(f.service.launch("personal", { ...input, id: "figma-web" }), /different exact/); assert.equal(f.calls(), 1);
  assert.equal(JSON.stringify(await f.service.list("personal")).includes(record.scratch), false);
  assert.equal((await readFile(join(f.stage, "state/personal.sealed.json"), "utf8")).includes(input.requestId), false);
});
test("client launch shutdown rejects late portal acceptance, waits for owned exit and never closes the external browser", async t => {
  let entered; const ready = new Promise(r => { entered = r; });
  const f = await fixture(t, async ({ options }) => { entered(); await new Promise(r => { if (options.signal.aborted) r(); else options.signal.addEventListener("abort", r, { once: true }); }); }); await f.enable();
  const pending = f.service.launch("personal", request()).then(() => { throw new Error("Late launch accepted"); }, e => e); await ready;
  const stopped = await f.service.stopCompartment("personal"); assert.equal(stopped.stopped, true); assert.equal(stopped.externalApplicationClosed, false); assert.match((await pending).message, /stopped/);
  const record = (await f.store.snapshot("personal")).clientLaunches[0]; assert.equal(record.status, "outcome-unconfirmed"); assert.equal(record.stoppedVerified, true);
});
test("unknown native exit retains launch ownership across restart and cannot start another request until independently stopped", async t => {
  const f = await fixture(t); await f.enable(); f.stopped(false); const input = request();
  await assert.rejects(f.service.launch("personal", input), /verified exit/); assert.equal((await f.service.stopCompartment("personal")).stopped, false); await assert.rejects(f.service.close(), /independent exit/);
  const record = (await f.store.snapshot("personal")).clientLaunches[0]; assert.equal(record.stoppedVerified, false); await access(record.scratch);
  const resumed = f.create(); await assert.rejects(resumed.launch("personal", request()), /independently verified/); assert.equal(f.calls(), 1);
  f.stopped(true); assert.equal((await resumed.launch("personal", input)).replayed, true); assert.equal(f.calls(), 1); assert.equal((await resumed.launch("personal", request())).status, "launch-requested");
  assert.equal((await f.store.snapshot("personal")).clientLaunches.find(r => r.requestId === input.requestId).status, "outcome-unconfirmed");
});
test("changed account scope, wrong portal identity and unfamiliar scratch files are retained without inventing successful launch", async t => {
  let change = "account";
  const f = await fixture(t, async ({ options, store, request }) => {
    if (change === "account") await store.update("personal", "account-change", s => { s.taskAuthorityEpoch = 1; });
    if (change === "identity") return { schema: "switchyard-client-portal-result/v1", id: "figma-web", status: "accepted", response: 0, applicationOpenedVerified: false, accountVerified: false, sessionIdentified: false };
    if (change === "scratch") await writeFile(join(options.cwd, "foreign"), "preserve me");
  }); await f.enable();
  await assert.rejects(f.service.launch("personal", request()), /scope changed/);
  change = "identity"; await assert.rejects(f.service.launch("personal", request()), /did not verify/);
  change = "scratch"; const input = request(); assert.equal((await f.service.launch("personal", input)).status, "launch-requested"); const record = (await f.store.snapshot("personal")).clientLaunches.find(r => r.requestId === input.requestId);
  assert.equal(record.cleanupPending, true); assert.equal(await readFile(join(record.scratch, "foreign"), "utf8"), "preserve me");
});
test("two independent host instances use one kernel lease and the same request UUID starts one portal helper", async t => {
  let entered, release; const ready = new Promise(r => { entered = r; }), hold = new Promise(r => { release = r; });
  const f = await fixture(t, async () => { entered(); await hold; }); await f.enable(); const input = request(), other = f.create(), first = f.service.launch("personal", input); await ready;
  const second = other.launch("personal", input); release(); assert.equal((await first).replayed, false); assert.equal((await second).replayed, true); assert.equal(f.calls(), 1);
});
test("failed startup persistence cannot acknowledge a portal request and a lost final state write cannot replay it", async t => {
  for (const boundary of ["client-launch-native-ready", "client-launch-result"]) {
    let effects = 0; const f = await fixture(t, async () => { effects++; }); await f.enable();
    const original = f.store.update; let fail = true;
    f.store.update = async (...args) => { if (fail && args[1] === boundary) { fail = false; throw new Error("Synthetic durable launch boundary failure"); } return original(...args); };
    const input = request(); await assert.rejects(f.service.launch("personal", input), /Synthetic durable/);
    assert.equal(effects, boundary === "client-launch-native-ready" ? 0 : 1);
    assert.equal((await f.service.launch("personal", input)).replayed, true); assert.equal(f.calls(), 1); assert.equal((await f.service.stopCompartment("personal")).stopped, true);
  }
});
