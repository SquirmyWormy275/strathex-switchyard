import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile, realpath, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createSuiteStore } from "./suite-store.mjs";
import { createCodingSessions } from "./coding-sessions.mjs";
import { createSuite } from "./suite.mjs";

async function fixture(fn) {
  const temporary = await mkdtemp(join(tmpdir(), "switchyard-coding-")), root = await realpath(temporary), stateRoot = join(root, "state"), repositoryRoot = join(root, "repository"), keys = new Map(), calls = [];
  await mkdir(join(repositoryRoot, ".git"), { recursive: true });
  const store = createSuiteStore({ root: stateRoot, secrets: { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, value) => { keys.set(`${id}:${purpose}`, value); } } });
  await store.initialize("personal"); await store.initialize("other-client"); await store.initialize("company", "work");
  for (const id of ["personal", "other-client"]) await store.update(id, "mode-select", (s) => { s.mode = "personal-companion"; });
  let accountId = "a".repeat(64), providerRoot = repositoryRoot, failStart = false, failedIdentity = false, failRead = false, badResume = false, observation = "active", clock = Date.now();
  const daemon = { account: async () => { calls.push("account"); return { type: "chatgpt", fingerprint: accountId, organizationVerified: false }; }, list: async () => { calls.push("list"); return [{ id: "synthetic-thread", observation }]; }, read: async (id) => { calls.push("read"); if (failRead) throw new Error("Synthetic unavailable thread"); return { id, repositoryRoot: providerRoot, observation }; }, resume: async (id) => { calls.push("resume"); await new Promise((r) => setTimeout(r, 20)); return { id, repositoryRoot: providerRoot, observation: "idle", permissions: badResume ? "danger-full-access" : "read-only/on-request", modelPromptSubmitted: false }; }, start: async () => { calls.push("start"); if (failStart) throw Object.assign(new Error("Synthetic uncertain create"), { createdThreadId: failedIdentity ? "synthetic-created-thread" : undefined }); return { threadId: "synthetic-created-thread" }; } };
  const options = { store, daemon, platform: "linux", resolveCli: async () => "/synthetic/codex", now: () => clock }, service = createCodingSessions(options);
  try { await fn({ root, stateRoot, repositoryRoot, store, calls, service, options, account: (v) => { accountId = v; }, wrongRoot: () => { providerRoot = join(root, "wrong-root"); }, badResume: () => { badResume = true; }, failStart: (identity = false) => { failStart = true; failedIdentity = identity; }, failRead: (v) => { failRead = v; }, idle: () => { observation = "idle"; }, stale: () => { clock += 31000; } }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const existing = (repositoryRoot) => ({ sessionId: "synthetic-thread", repositoryRoot, label: "Local task label" });

test("replacing a directory at the same path cannot redirect a saved native task", () => fixture(async ({ root, repositoryRoot, service, calls, idle }) => {
  const task = await service.create("personal", { requestId: randomUUID(), repositoryRoot, label: "Synthetic owned task" });
  assert.match(task.repositoryIdentity.inode, /^[1-9]\d*$/); assert.match(task.repositoryIdentity.device, /^\d+$/);
  await rename(repositoryRoot, join(root, "preserved-original")); await mkdir(join(repositoryRoot, ".git"), { recursive: true }); calls.length = 0; idle();
  await assert.rejects(service.status("personal", task.id), /directory was replaced/); assert.equal(calls.includes("read"), false);
  await assert.rejects(service.resume("personal", task.id), /directory was replaced/); assert.equal(calls.includes("resume"), false);
  await assert.rejects(service.bind("personal", { ...existing(repositoryRoot), sessionId: task.sessionId }), /changed its working directory/);
}));

test("coding discovery distinguishes live inventory, exact bindings, staleness and task completion", () => fixture(async ({ service, repositoryRoot, store, stale, idle }) => {
  assert.equal((await service.discovery("personal")).recentThreads, 1);
  const task = await service.bind("personal", existing(repositoryRoot));
  assert.equal(task.observation.status, "active"); assert.equal(task.accountScope.organizationVerified, false); assert.equal(task.capabilities.mediated, false); assert.equal(task.capabilities.resumable, false);
  assert.equal((await service.bind("personal", existing(repositoryRoot))).duplicatePrevented, true);
  assert.equal((await store.snapshot("personal")).codingSessions.length, 1);
  stale(); assert.equal((await service.list("personal"))[0].observation.status, "stale");
  idle(); const updated = await service.status("personal", task.id); assert.equal(updated.observation.status, "idle"); assert.equal(updated.observation.completionVerified, false);
}));
test("coding bindings reject a different directory, a changed/unidentified login and prohibited Work providers before provider access", () => fixture(async ({ service, repositoryRoot, wrongRoot, account, calls }) => {
  const task = await service.bind("personal", existing(repositoryRoot)); calls.length = 0;
  await assert.rejects(service.bind("company", existing(repositoryRoot)), /prohibited/); assert.equal(calls.length, 0);
  account("b".repeat(64)); await assert.rejects(service.status("personal", task.id), /login changed/); assert.equal(calls.includes("read"), false);
  account(null); await assert.rejects(service.bind("personal", existing(repositoryRoot)), /did not identify/);
  account("a".repeat(64)); wrongRoot(); await assert.rejects(service.status("personal", task.id), /exact thread and working directory/);
}));
test("one durable request prevents duplicate empty-thread creation, including after restart and an uncertain provider response", () => fixture(async ({ service, options, repositoryRoot, calls, failStart }) => {
  const input = { requestId: randomUUID(), repositoryRoot, label: "Private label stays local" };
  const result = await Promise.all([service.create("personal", input), service.create("personal", input)]);
  assert.equal(calls.filter((c) => c === "start").length, 1); assert.ok(result.some((r) => r.duplicatePrevented)); assert.ok(result.some((r) => r.modelPromptSubmitted === false));
  const restarted = createCodingSessions(options); assert.equal((await restarted.create("personal", input)).duplicatePrevented, true);
  failStart(); const uncertain = { ...input, requestId: randomUUID() }; await assert.rejects(service.create("personal", uncertain), /Creation is uncertain/);
  const before = calls.filter((c) => c === "start").length, repeated = await restarted.create("personal", uncertain);
  assert.equal(repeated.status, "creation-uncertain"); assert.equal(calls.filter((c) => c === "start").length, before);
}));
test("a retained new thread ID can be reconciled after observation fails without creating another thread", () => fixture(async ({ service, repositoryRoot, failRead, calls }) => {
  const input = { requestId: randomUUID(), repositoryRoot, label: "Recover identity" }; failRead(true);
  await assert.rejects(service.create("personal", input), /Creation is uncertain/);
  const saved = (await service.list("personal"))[0]; assert.equal(saved.sessionId, "synthetic-created-thread");
  failRead(false); assert.equal((await service.status("personal", input.requestId)).status, "registered"); assert.equal(calls.filter((c) => c === "start").length, 1);
}));
test("a failed provider follow-up retains the already-created thread identity for exact reconciliation", () => fixture(async ({ service, repositoryRoot, failStart, calls }) => {
  const requestId = randomUUID(); failStart(true);
  await assert.rejects(service.create("personal", { requestId, repositoryRoot, label: "Partial create" }), /Creation is uncertain/);
  assert.equal((await service.list("personal"))[0].sessionId, "synthetic-created-thread");
  assert.equal((await service.status("personal", requestId)).status, "registered"); assert.equal(calls.filter((c) => c === "start").length, 1);
}));
test("only owned read-only tasks can resume; active turns are preserved, parallel requests share an acknowledgement and bad permission readback stays uncertain", () => fixture(async ({ service, repositoryRoot, store, calls, idle, badResume }) => {
  const bound = await service.bind("personal", existing(repositoryRoot));
  await assert.rejects(service.resume("personal", bound.id), /only for exact read-only/);
  const task = await service.create("personal", { requestId: randomUUID(), repositoryRoot, label: "Owned runtime" }); assert.equal(task.capabilities.resumable, true);
  await assert.rejects(service.resume("personal", task.id), /already active/); assert.equal(calls.includes("resume"), false);
  idle(); const result = await Promise.all([service.resume("personal", task.id), service.resume("personal", task.id)]);
  assert.equal(calls.filter((c) => c === "resume").length, 1); assert.ok(result.every((r) => r.effect === "runtime-resumed" && !r.modelPromptSubmitted && !r.windowFocusVerified && !r.observation.completionVerified));
  badResume(); await assert.rejects(service.resume("personal", task.id), /did not verify/);
  assert.equal((await store.snapshot("personal")).codingSessions.find((t) => t.id === task.id).lastResume.status, "uncertain");
}));
test("external session ownership is compartment-scoped, authenticated and retained through restart without plaintext session IDs", () => fixture(async ({ service, repositoryRoot, store, stateRoot }) => {
  await service.bind("personal", existing(repositoryRoot));
  await assert.rejects(service.bind("other-client", existing(repositoryRoot)), /outside this compartment/);
  const directory = join(stateRoot, "external-sessions"), files = await readdir(directory), path = join(directory, files[0]), raw = await readFile(path, "utf8");
  assert.equal(raw.includes("synthetic-thread"), false); assert.equal(raw.includes("personal"), false);
  await store.claimSession("personal", { provider: "codex", sessionId: "synthetic-thread" });
  const changed = JSON.parse(raw); changed.tag = "0".repeat(64); await writeFile(path, JSON.stringify(changed));
  await assert.rejects(store.claimSession("personal", { provider: "codex", sessionId: "synthetic-thread" }), /failed authentication/);
}));

test("the authenticated suite routes an exact coding role to runtime status and cannot reinterpret it as a configuration conversation", () => fixture(async ({ service, repositoryRoot, store }) => {
  const task = await service.bind("personal", existing(repositoryRoot));
  await store.saveWorkflow("personal", { name: "Coding loop", roles: [{ id: "builder", label: "Builder" }], steps: [] });
  const suite = createSuite({ store, coding: service, agents: { discovery: async () => [], design: () => { throw new Error("Wrong configuration route"); }, close() {} }, voice: { discovery: async () => ({ available: false }) } });
  try {
    await suite.handle("/api/suite/roles/bind", { compartment: "personal", roleId: "builder", provider: "codex", targetKind: "coding-task", targetId: task.id, intent: "status" });
    const response = await suite.handle("/api/suite/intent", { implementation: "switchyard.role/v1", roleId: "builder", intent: "status" });
    assert.equal(response.id, task.id); assert.equal(response.observation.completionVerified, false);
    assert.equal((await store.snapshot("personal")).activeConversationId, undefined);
    await assert.rejects(suite.handle("/api/suite/roles/bind", { compartment: "personal", roleId: "builder", provider: "codex", targetKind: "coding-task", targetId: task.id, intent: "resume" }), /runtime status only/);
  } finally { await suite.close(); }
}));
