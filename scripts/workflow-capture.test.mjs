import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

import { surfaceForClass } from "./workflow-monitor.mjs";

const script = fileURLToPath(new URL("./workflow-capture.mjs", import.meta.url));

test("local baseline records bounded metadata and summarizes completed sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-workflow-study-"));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", env: { ...process.env, SXSY_WORKFLOW_STUDY_DIR: directory }
  });
  try {
    assert.equal(run("start", "linux", "task_1").status, 0);
    assert.equal(run("event", "resume", "codex", "keyboard", "success", "1200", "2", "user").status, 0);
    assert.equal(run("event", "status", "codex", "palette", "blocked", "800", "4", "none").status, 0);
    assert.equal(run("end").status, 0);
    const report = run("report");
    assert.equal(report.status, 0);
    assert.deepEqual(JSON.parse(report.stdout), {
      sessionsStarted: 1, sessionsCompleted: 1, events: 2, focusIntervals: 0, focusDurationMs: {},
      byKind: {
        resume: { count: 1, retriesOrBlocked: 0, totalDurationMs: 1200, averageFriction: 2 },
        status: { count: 1, retriesOrBlocked: 1, totalDurationMs: 800, averageFriction: 4 }
      }
    });
    const content = await readFile(join(directory, "events.jsonl"), "utf8");
    assert.match(run("path").stdout, /Size: [1-9][0-9]* \/ 10485760 bytes/);
    assert.doesNotMatch(content, /prompt|clipboard|repositoryRoot|windowTitle/);
    if (process.platform !== "win32") assert.equal((await stat(join(directory, "events.jsonl"))).mode & 0o777, 0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("recorder stops at 10 MiB and leaves room to end the active session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-workflow-study-"));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", env: { ...process.env, SXSY_WORKFLOW_STUDY_DIR: directory }
  });
  try {
    assert.equal(run("start", "linux").status, 0);
    const handle = await open(join(directory, "events.jsonl"), "r+");
    try { await handle.truncate(10 * 1024 * 1024 - 1024); } finally { await handle.close(); }
    const denied = run("event", "resume", "codex", "keyboard", "success", "100", "1", "user");
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /10 MiB cap/);
    assert.equal(run("end").status, 0);
    assert.ok((await stat(join(directory, "events.jsonl"))).size <= 10 * 1024 * 1024);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("baseline refuses arbitrary content, invalid evidence, and overlapping sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-workflow-study-"));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", env: { ...process.env, SXSY_WORKFLOW_STUDY_DIR: directory }
  });
  try {
    assert.equal(run("start", "linux", "customer/repo").status, 1);
    assert.equal(run("start", "linux").status, 0);
    assert.equal(run("start", "windows").status, 1);
    assert.equal(run("event", "other", "other", "keyboard", "success", "10", "1", "verified").status, 1);
    assert.equal(run("event", "other", "other", "keyboard", "success", "10", "1", "none", "secret").status, 1);
    assert.equal(run("end").status, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("one toggle starts and the next toggle ends the same Linux study session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-workflow-study-"));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", env: { ...process.env, SXSY_WORKFLOW_STUDY_DIR: directory }
  });
  try {
    assert.match(run("toggle").stdout, /^Started local workflow session /);
    assert.match(run("status").stdout, /^Active:/);
    assert.match(run("toggle").stdout, /^Ended local workflow session /);
    assert.match(run("status").stdout, /^No workflow session is active/);
    assert.deepEqual(JSON.parse(run("report").stdout), { sessionsStarted: 1, sessionsCompleted: 1, events: 0, focusIntervals: 0, focusDurationMs: {}, byKind: {} });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("foreground monitor reduces application classes to closed categories", () => {
  assert.equal(surfaceForClass("foot"), "terminal");
  assert.equal(surfaceForClass("Code"), "vscode");
  assert.equal(surfaceForClass("ChatGPT"), "chatgpt");
  assert.equal(surfaceForClass("brave-browser"), "browser");
  assert.equal(surfaceForClass("customer-project-secret"), "other");
});

if (process.platform === "linux") test("foreground monitor flushes only a category and duration when stopped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-workflow-study-"));
  const environment = { ...process.env, SXSY_WORKFLOW_STUDY_DIR: directory };
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: environment });
  try {
    assert.equal(run("start", "linux").status, 0);
    const child = spawn(process.execPath, [fileURLToPath(new URL("./workflow-monitor.mjs", import.meta.url))], { env: environment, stdio: "ignore" });
    const exited = once(child, "exit");
    await new Promise((resolve) => setTimeout(resolve, 400));
    child.kill("SIGTERM");
    await exited;
    assert.equal(run("end").status, 0);
    const report = JSON.parse(run("report").stdout);
    assert.equal(report.focusIntervals, 1);
    assert.ok(Object.values(report.focusDurationMs).some((duration) => duration > 0));
    const content = await readFile(join(directory, "events.jsonl"), "utf8");
    assert.doesNotMatch(content, /windowTitle|initialClass|customer-project-secret/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
