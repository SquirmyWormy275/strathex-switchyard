import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
      sessionsStarted: 1, sessionsCompleted: 1, events: 2,
      byKind: {
        resume: { count: 1, retriesOrBlocked: 0, totalDurationMs: 1200, averageFriction: 2 },
        status: { count: 1, retriesOrBlocked: 1, totalDurationMs: 800, averageFriction: 4 }
      }
    });
    const content = await readFile(join(directory, "events.jsonl"), "utf8");
    assert.doesNotMatch(content, /prompt|clipboard|repositoryRoot|windowTitle/);
    if (process.platform !== "win32") assert.equal((await stat(join(directory, "events.jsonl"))).mode & 0o777, 0o600);
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
