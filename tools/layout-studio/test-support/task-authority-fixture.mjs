import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "../suite-store.mjs";
import { repositoryIdentity } from "../coding-task-identity.mjs";
import { createRepositoryInspection, fixedGitExecutable } from "../repository-inspection.mjs";
import { createTaskAuthority } from "../task-authority.mjs";
const execute = promisify(execFile);
export async function authorityFixture(t, { executionActions = [] } = {}) {
  const stage = await mkdtemp(join(tmpdir(), "switchyard-authority-"));
  let serviceToClose;
  const cleanup = []; t.after(async () => { const results = await Promise.allSettled([...cleanup.map(fn => fn()), serviceToClose?.close()]); const failure = results.find(r => r.status === "rejected"); if (failure) throw failure.reason; await rm(stage, { recursive: true, force: true }); });
  await mkdir(join(stage, "repository")); const root = await realpath(join(stage, "repository"));
  const git = await fixedGitExecutable();
  const run = async (...args) => (await execute(git, args, { cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0" }, timeout: 10000 })).stdout;
  await run("init", "-b", "main"); await run("config", "user.name", "Synthetic verification"); await run("config", "user.email", "synthetic@example.invalid");
  await writeFile(join(root, "task.txt"), "before\n"); await writeFile(join(root, ".gitignore"), "cache.txt\n");
  await run("add", "task.txt", ".gitignore"); await run("-c", "commit.gpgsign=false", "commit", "-m", "synthetic base");
  await run("remote", "add", "origin", "https://github.com/example/synthetic.git");
  await run("update-ref", "refs/remotes/origin/main", "HEAD"); await run("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"); await run("switch", "-c", "feature/task");
  await writeFile(join(root, "task.txt"), "reviewed\n");
  const keys = new Map(), secrets = { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => { keys.set(`${c}:${p}`, v); } };
  let time = Date.now(); const now = () => time;
  const store = createSuiteStore({ root: join(stage, "private"), secrets, clock: now });
  await store.initialize("personal"); await store.initialize("work", "work");
  const task = { schema: "switchyard-coding-session/v1", id: randomUUID(), provider: "codex", sessionId: "synthetic-session", nativeTransport: "owned-stdio", repositoryRoot: root, repositoryIdentity: await repositoryIdentity(root), accountFingerprint: "a".repeat(64), status: "registered", launchPolicy: "read-only/on-request" };
  await store.update("personal", "fixture", s => { s.mode = "personal-companion"; s.codingSessions = [task]; });
  let calls = 0, active = true, nativeChecks = 0;
  const command = async (executable, args, options) => {
    calls++; assert.equal(executable, git); assert.ok(args.includes("core.fsmonitor=false")); assert.equal(options.env.GIT_ALLOW_PROTOCOL, ""); assert.equal(options.env.GIT_CONFIG_NOSYSTEM, "1");
    const frame = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: process.platform === "linux" ? "owned-linux-session" : "windows-job" };
    await options.onGuardianReady(frame);
    const p = (await store.snapshot("personal")).repositoryProbes.find(p => p.ownedRuntime.id === frame.id); assert.equal(p.stoppedVerified, false);
    try { const result = await execute(executable, args, { cwd: options.cwd, env: options.env, timeout: options.timeout, maxBuffer: options.maxOutputBytes, signal: options.signal }); return { ...result, status: "completed", exitCode: 0, inputDelivered: true, treeExitVerified: true }; }
    catch (e) { if (e.code === "ABORT_ERR" || !Number.isInteger(e.code)) throw e; return { status: "failed", exitCode: e.code, stdout: e.stdout, stderr: e.stderr, inputDelivered: true, treeExitVerified: true }; }
  };
  const inspection = createRepositoryInspection({ store, command, guardianStopped: async () => true, now });
  const service = createTaskAuthority({ store, inspection, now, executionActions, isActive: async () => active, checkNative: async (_c, t) => { nativeChecks++; assert.equal(t.sessionId, task.sessionId); } });
  serviceToClose = service;
  const proposed = { taskId: task.id, planRevision: "plan-1", paths: ["task.txt"], lifetimeMinutes: 15 };
  return { stage, root, store, task, service, inspection, proposed, command, now, run, advance: n => { time += n; }, counters: () => ({ calls, nativeChecks }), setActive: v => { active = v; }, onCleanup: fn => cleanup.push(fn) };
}

