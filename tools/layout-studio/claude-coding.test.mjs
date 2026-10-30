import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, realpath, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createClaudeCoding, claudeAccount, claudeInventory } from "./claude-coding.mjs";
import { createSuite } from "./suite.mjs";

async function fixture(fn) {
  const temp = await mkdtemp(join(tmpdir(), "switchyard-claude-")), root = await realpath(temp), repositoryRoot = join(root, "repo"), stateRoot = join(root, "state"), keys = new Map(), calls = [], rows = [];
  await mkdir(join(repositoryRoot, ".git"), { recursive: true });
  const store = createSuiteStore({ root: stateRoot, secrets: { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => { keys.set(`${c}:${p}`, v); } } });
  await store.initialize("personal"); await store.initialize("other"); await store.initialize("company", "work");
  for (const c of ["personal", "other"]) await store.update(c, "mode-select", (s) => { s.mode = "personal-companion"; });
  let login = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "synthetic@example.invalid", orgId: "synthetic-org" }, clock = Date.now(), count = 0, failInventory = false, omitIdentity = false, failStop = false, failTrust = false, beforeFocus = () => {}, focusEffects = 0;
  const run = async (_, args, options) => {
    calls.push([...args]);
    if (args[0] === "--version") return "2.1.308 (Claude Code)\n";
    if (args[0] === "auth") return JSON.stringify(login);
    if (args[0] === "agents") { if (failInventory) { failInventory = false; throw new Error("Synthetic inventory interruption"); } return JSON.stringify(rows); }
    if (args[0] === "--background") { if (failTrust) throw Object.assign(new Error("Synthetic native workspace trust rejection"), { code: "CLAUDE_WORKSPACE_TRUST_REQUIRED", noEffectVerified: true }); const id = (++count).toString(16).padStart(8, "0"), row = { id, cwd: options.cwd, kind: "background", state: "blocked", startedAt: clock, pid: 12345 + count, status: "idle", sessionId: randomUUID(), name: "private provider name never imported" }; rows.push(row); return omitIdentity ? "Synthetic unexpected CLI output" : `backgrounded · ${id} · switchyard\n`; }
    if (args[0] === "stop") { if (failStop) throw new Error("Synthetic uncertain stop"); const row = rows.find((r) => r.id === args[1]); assert.ok(row); row.state = "stopped"; row.startedAt -= 37; delete row.pid; delete row.status; return "stopped\n"; }
    throw new Error("Unexpected native CLI operation");
  };
  const windows = { focus: async ({ verifySession }) => { beforeFocus(); await verifySession(); focusEffects++; await verifySession(); return { effect: "exact-interactive-session-focused", windowFocusVerified: true, taskResumptionVerified: false, modelPromptSubmitted: false }; } };
  const options = { store, run, windows, platform: "linux", resolveCli: async () => "/synthetic/native/claude", now: () => clock }, service = createClaudeCoding(options);
  const input = () => ({ requestId: randomUUID(), repositoryRoot, label: "Local label never sent to provider" });
  try { await fn({ root, repositoryRoot, stateRoot, rows, store, service, options, calls, input, changeAccount: () => { login = { ...login, email: "changed@example.invalid" }; }, failInventory: () => { failInventory = true; }, omitIdentity: () => { omitIdentity = true; }, failStop: () => { failStop = true; }, rejectTrust: () => { failTrust = true; }, advance: (n) => { clock += n; }, beforeFocus: (fn) => { beforeFocus = fn; }, focusEffects: () => focusEffects }); }
  finally { await service.close(); await rm(root, { recursive: true, force: true }); }
}

test("Claude's actual versioned inventory distinguishes process state from task completion and ignores unrelated directory rows", () => {
  const row = { cwd: "/one", kind: "background", id: "1234abcd", startedAt: 10, pid: 12, status: "idle", sessionId: randomUUID(), state: "done", name: "not retained", prompt: "not retained" };
  const result = claudeInventory([row, { ...row, cwd: "/one/child" }], "/one");
  assert.equal(result.length, 1); assert.equal(result[0].state, "done"); assert.equal(JSON.stringify(result).includes("not retained"), false);
  assert.throws(() => claudeInventory([row, row], "/one"), /ambiguous/);
  assert.throws(() => claudeInventory([{ ...row, state: "imagined-complete" }], "/one"), /unsupported/);
  assert.throws(() => claudeAccount({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty", email: "a", orgId: "b" }), /supported first-party/);
});

test("a replacement repository cannot inherit an exact Claude task, stop review or interactive focus", () => fixture(async ({ root, repositoryRoot, service, calls, input }) => {
  const task = await service.create("personal", input()); assert.match(task.repositoryIdentity.inode, /^[1-9]\d*$/);
  await rename(repositoryRoot, join(root, "preserved-original")); await mkdir(join(repositoryRoot, ".git"), { recursive: true }); calls.length = 0;
  await assert.rejects(service.status("personal", task.id), /directory was replaced/);
  await assert.rejects(service.reviewStop("personal", task.id), /directory was replaced/);
  await assert.rejects(service.focus("personal", task.id), /directory was replaced/);
  assert.equal(calls.some((args) => args[0] === "agents" || args[0] === "stop"), false);
}));

test("a verified native workspace rejection is preserved without claiming an unknown background job or retrying it", () => fixture(async ({ store, service, calls, input, rejectTrust }) => {
  rejectTrust(); const request = input(); await assert.rejects(service.create("personal", request), /workspace gate rejected/);
  const task = (await store.snapshot("personal")).codingSessions[0]; assert.equal(task.status, "creation-rejected"); assert.equal(task.noEffectVerified, true); assert.equal(task.sessionId, null); assert.equal(task.backgroundId, null);
  assert.equal((await service.create("personal", request)).duplicatePrevented, true); assert.equal(calls.filter((args) => args[0] === "--background").length, 1); assert.equal((await service.stopCompartment("personal")).stopped, true);
}));

test("Claude creates one empty background session per durable request, preserves native identities and requires explicit current-account binding", () => fixture(async ({ service, options, store, calls, input, stateRoot, changeAccount }) => {
  assert.equal((await service.discovery("personal")).available, true);
  const request = input(), tasks = await Promise.all([service.create("personal", request), service.create("personal", request)]);
  assert.equal(calls.filter((c) => c[0] === "--background").length, 1); assert.equal(tasks.filter((t) => t.duplicatePrevented).length, 1);
  const task = tasks.find((t) => t.modelPromptSubmitted === false);
  assert.equal(task.observation.status, "waiting-for-input"); assert.equal(task.capabilities.cancellable, true); assert.equal(task.capabilities.mediated, false);
  const launch = calls.find((c) => c[0] === "--background"); assert.equal(launch.includes("--session-id"), false); assert.equal(launch.includes(request.label), false); assert.equal(launch[launch.indexOf("--tools") + 1], "");
  const restarted = createClaudeCoding(options); assert.equal((await restarted.create("personal", request)).duplicatePrevented, true);
  assert.equal(calls.filter((c) => c[0] === "--background").length, 1);
  assert.equal((await readFile(join(stateRoot, "personal.sealed.json"), "utf8")).includes(task.sessionId), false);
  changeAccount(); await assert.rejects(service.status("personal", task.id), /login changed/);
  assert.equal((await store.snapshot("personal")).codingSessions.length, 1);
}));

test("text-task reservation is durable and account-bound without claiming native creation or starting a background process", () => fixture(async ({ service, options, calls, input, store, changeAccount }) => {
  const request = input(), task = await service.createText("personal", request);
  assert.equal(task.nativeIdentityVerified, false); assert.equal(task.nativeConversationCreated, false); assert.equal(task.modelPromptSubmitted, false); assert.equal(task.capabilities.sessionIdentifiable, false); assert.equal(task.nativeTransport, "owned-print"); assert.equal(task.backgroundId, null);
  const restarted = createClaudeCoding(options); const duplicate = await restarted.createText("personal", request); assert.equal(duplicate.duplicatePrevented, true); assert.equal(duplicate.sessionId, task.sessionId);
  assert.equal((await service.status("personal", task.id)).observation.status, "reserved-locally");
  await assert.rejects(service.createText("personal", { ...request, label: "Changed target" }), /already names another/);
  assert.equal(calls.some((args) => args[0] === "--background" || args.includes("-p")), false);
  await store.update("personal", "synthetic-uncertainty", (s) => { s.codingSessions[0].status = "creation-uncertain"; }); assert.equal((await service.stopCompartment("personal")).stopped, true);
  changeAccount(); await assert.rejects(service.status("personal", task.id), /login changed/); await assert.rejects(service.createText("personal", request), /already names another/);
  await restarted.close();
}));

test("retained Claude background identities reconcile after an interrupted follow-up without another launch", () => fixture(async ({ service, calls, input, failInventory, omitIdentity }) => {
  const first = input(); failInventory(); await assert.rejects(service.create("personal", first), /Creation is uncertain/);
  const partial = (await service.list("personal"))[0]; assert.ok(partial.backgroundId); assert.equal(partial.sessionId, null);
  assert.equal((await service.status("personal", first.requestId)).status, "registered");
  const second = input(); omitIdentity(); await assert.rejects(service.create("personal", second), /Creation is uncertain/);
  await assert.rejects(service.status("personal", second.requestId), /will not guess or relaunch/);
  assert.equal((await service.create("personal", second)).duplicatePrevented, true);
  assert.equal(calls.filter((c) => c[0] === "--background").length, 2);
}));

test("Claude Work prohibition, changed roots and cross-compartment claims reject before any alternate action", () => fixture(async ({ service, store, calls, rows, input }) => {
  await assert.rejects(service.create("company", input()), /prohibited/); assert.equal(calls.length, 0);
  const task = await service.create("personal", input());
  await assert.rejects(service.bind("other", { sessionId: task.sessionId, repositoryRoot: task.repositoryRoot, label: "Cross-compartment" }), /outside this compartment/);
  rows[0].cwd += "/different"; assert.equal((await service.status("personal", task.id)).observation.status, "not-observed");
  assert.equal((await store.snapshot("personal")).codingSessions[0].sessionId, task.sessionId);
}));

test("owned Claude stop reuses exact-scope durable confirmation, rejects wrong/replayed scope, and reads back the stopped session", () => fixture(async ({ service, calls, input, rows, store, advance }) => {
  const first = await service.create("personal", input()), second = await service.create("personal", input());
  const review = await service.reviewStop("personal", first.id), token = review.confirmation.token;
  assert.equal(JSON.stringify(await store.snapshot("personal")).includes(token), false);
  await assert.rejects(service.stop("personal", { id: second.id, token }), /exact action/);
  const before = calls.filter((c) => c[0] === "stop").length;
  rows[0].pid++; await assert.rejects(service.stop("personal", { id: first.id, token }), /exact action/); rows[0].pid--;
  assert.equal(calls.filter((c) => c[0] === "stop").length, before);
  const result = await service.stop("personal", { id: first.id, token }); assert.equal(result.effect, "provider-reported-stopped"); assert.equal(result.taskCompletionVerified, false);
  await assert.rejects(service.stop("personal", { id: first.id, token }), /already been consumed/);
  const expiring = await service.reviewStop("personal", second.id); advance(300001);
  await assert.rejects(service.stop("personal", { id: second.id, token: expiring.confirmation.token }), /unknown|expired/);
}));

test("an uncertain Claude stop consumes its authority once and cannot be replayed automatically", () => fixture(async ({ service, input, failStop, calls }) => {
  const task = await service.create("personal", input()), review = await service.reviewStop("personal", task.id);
  failStop(); await assert.rejects(service.stop("personal", { id: task.id, token: review.confirmation.token }), /uncertain stop/);
  assert.equal((await service.list("personal"))[0].lastStop.status, "uncertain");
  await assert.rejects(service.stop("personal", { id: task.id, token: review.confirmation.token }), /already been consumed/);
  assert.equal(calls.filter((c) => c[0] === "stop").length, 1);
}));

test("keyboard-only cleanup stops exact owned Claude jobs while external bound sessions remain observation-only", () => fixture(async ({ service, input, rows, store, calls, repositoryRoot }) => {
  const own = await service.create("personal", input()), external = { id: "ffeeddaa", cwd: repositoryRoot, kind: "background", state: "working", startedAt: Date.now(), pid: 6789, status: "busy", sessionId: randomUUID() }; rows.push(external);
  const bound = await service.bind("personal", { sessionId: external.sessionId, repositoryRoot, label: "External task" }); assert.equal(bound.capabilities.cancellable, false);
  await assert.rejects(service.reviewStop("personal", bound.id), /External sessions are observation-only/);
  await store.update("personal", "mode-select", (s) => { s.mode = "keyboard-only"; });
  assert.equal((await service.stopCompartment("personal")).stopped, true);
  assert.equal(rows.find((r) => r.sessionId === own.sessionId).state, "stopped"); assert.equal(external.state, "working");
  assert.deepEqual(calls.filter((c) => c[0] === "stop").map((c) => c[1]), [own.backgroundId]);
}));

test("physical role status routes to the exact Claude task without substituting a configuration conversation", () => fixture(async ({ service, store, input }) => {
  const task = await service.create("personal", input()); await store.saveWorkflow("personal", { name: "Synthetic", roles: [{ id: "reviewer", label: "Reviewer" }], steps: [] });
  const suite = createSuite({ store, claudeCoding: service, agents: { discovery: async () => [], design: () => { throw new Error("Wrong conversation route"); }, close() {} }, voice: { discovery: async () => ({ available: false }) } });
  try {
    await suite.handle("/api/suite/roles/bind", { roleId: "reviewer", intent: "status", provider: "claude-code", targetKind: "coding-task", targetId: task.id });
    const r = await suite.handle("/api/suite/intent", { implementation: "switchyard.role/v1", roleId: "reviewer", intent: "status" }); assert.equal(r.sessionId, task.sessionId); assert.equal(r.observation.completionVerified, false);
    await assert.rejects(suite.handle("/api/suite/roles/bind", { roleId: "reviewer", intent: "resume", provider: "claude-code", targetKind: "coding-task", targetId: task.id }), /runtime status only/);
  } finally { await suite.close(); }
}));

test("Claude interactive summon revalidates native session identity and cannot turn a background PID into a window", () => fixture(async ({ service, rows, repositoryRoot, input, beforeFocus, focusEffects, store }) => {
  const row = { cwd: repositoryRoot, kind: "interactive", startedAt: Date.now(), pid: 6789, status: "idle", sessionId: randomUUID() }; rows.push(row);
  const task = await service.bind("personal", { sessionId: row.sessionId, repositoryRoot, label: "Interactive task" });
  const result = await service.focus("personal", task.id); assert.equal(result.sessionId, row.sessionId); assert.equal(result.windowFocusVerified, true); assert.equal(result.taskResumptionVerified, false);
  assert.equal((await service.list("personal"))[0].capabilities.focusable, true);
  const background = await service.create("personal", input());
  await assert.rejects(service.focus("personal", background.id), /Background worker PIDs/);
  const suite = createSuite({ store, claudeCoding: service, agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  try {
    await store.saveWorkflow("personal", { name: "Loop", roles: [{ id: "builder", label: "Builder" }], steps: [] });
    await suite.handle("/api/suite/roles/bind", { roleId: "builder", intent: "summon", provider: "claude-code", targetKind: "coding-task", targetId: task.id });
    const focused = await suite.handle("/api/suite/intent", { implementation: "switchyard.role/v1", roleId: "builder", intent: "summon" }); assert.equal(focused.sessionId, row.sessionId);
    const effects = focusEffects(); beforeFocus(() => { row.sessionId = randomUUID(); });
    await assert.rejects(service.focus("personal", task.id), /session changed/); assert.equal(focusEffects(), effects);
    assert.equal((await service.status("personal", task.id)).capabilities.focusable, false);
  } finally { await suite.close(); }
}));
