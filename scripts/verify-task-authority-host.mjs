#!/usr/bin/env node
/** Installed synthetic authority proof; preserves definitions and never prints the private URL. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const source = new URL("../", import.meta.url);
const { applicationStateRoot } = await import(new URL("deployment/suite/application.mjs", source));
const { privateDirectory, privateRead, privateWrite } = await import(new URL("tools/layout-studio/private-fs.mjs", source));
const { createSuiteStore } = await import(new URL("tools/layout-studio/suite-store.mjs", source));
const { runtimeGuardianStopped } = await import(new URL("tools/layout-studio/runtime-command.mjs", source));
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage: node scripts/verify-task-authority-host.mjs --synthetic (installed Linux pilot; creates one empty native task, no model prompt or repository commit)");
const execute = promisify(execFile), store = createSuiteStore(), compartment = "authority-validation", taskId = randomUUID();
const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"), stage = join(directory, `task-authority-${randomUUID()}`), repositoryRoot = join(stage, "repository"), checks = [];
const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1]; assert.ok(token && url.hostname === "127.0.0.1" && url.protocol === "http:");
async function api(path, body = {}, expected = 200, authenticated = true) {
 const r = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(150000) });
 const value = await r.json(); assert.equal(r.status, expected, `Installed ${path}: ${typeof value.error === "string" ? value.error.slice(0,400) : "unexpected status"}`); return value;
}
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex"), definitions = s => digest([s.profile, s.workflow, s.roleBindings ?? [], s.mode]);
const selection = await store.selection(), selectedBefore = await api("snapshot", { compartment: selection });
assert.equal(selectedBefore.observations.some(o => o.status === "recording") || selectedBefore.voice.some(v => v.status === "recording"), false, "Do not interrupt a current recording to run this proof.");
const personal = definitions(await api("snapshot", { compartment: "personal" }));
await api("compartment/create", { compartment, policy: "personal" }); const baseline = await store.snapshot(compartment); assert.equal(baseline.mode, "keyboard-only");
assert.equal((baseline.repositoryProbes ?? []).some(p => p.stoppedVerified !== true), false);
await privateDirectory(repositoryRoot);
const git = async (...args) => (await execute("/usr/bin/git", args, { cwd: repositoryRoot, env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, timeout: 10000 })).stdout;
await git("init", "-b", "main"); await git("config", "user.name", "Synthetic acceptance"); await git("config", "user.email", "synthetic@example.invalid");
await writeFile(join(repositoryRoot, "task.txt"), "synthetic baseline\n"); await git("add", "task.txt"); await git("-c", "commit.gpgsign=false", "commit", "-m", "synthetic baseline");
await git("remote", "add", "origin", "https://github.com/example/synthetic-authority.git"); await git("update-ref", "refs/remotes/origin/main", "HEAD"); await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"); await git("switch", "-c", "feature/synthetic-authority");
await writeFile(join(repositoryRoot, "task.txt"), "synthetic reviewed contents\n"); const head = await git("rev-parse", "HEAD"), branch = await git("branch", "--show-current");
const evidence = { schema: "switchyard-installed-task-authority/v1", at: new Date().toISOString(), checks, modelPromptsSubmitted: 0, repositoryCommittedBySuite: false, nativePermissionsChanged: false, frontendVisualAcceptance: false };
let failure, grantId, nativeSession;
try {
 await api("compartment/select", { compartment }); await api("mode", { compartment, mode: "personal-companion" });
 const task = await api("coding/codex/create", { compartment, requestId: taskId, repositoryRoot, label: "Synthetic exact authority check" }); assert.ok(task.sessionId && task.repositoryIdentity); assert.equal(task.modelPromptSubmitted, false); nativeSession = task.sessionId;
 checks.push("normal API created an exact native account/directory-bound empty Codex task without prompting");
 const proposed = { compartment, taskId, planRevision: "synthetic-plan-1", paths: ["task.txt"], lifetimeMinutes: 5 };
 const review = await api("coding/authority/review", proposed); assert.equal(review.scope.targetSnapshot.completeness, "complete"); assert.equal(review.scope.repositoryRoot, repositoryRoot); assert.equal(review.scope.sessionId, task.sessionId); assert.deepEqual(review.scope.allowedActions, ["local_commit"]);
 checks.push("installed review captured actual Git contents under protected native guardians");
 const grant = await api("coding/authority/issue", { ...proposed, token: review.confirmation.token }); grantId = grant.id; assert.equal(grant.grant.taskId, taskId); assert.equal(grant.nativePermissionsChanged, false); assert.equal(grant.localCommitExecutionImplemented, true);
 assert.equal((await api("coding/authority/revalidate", { compartment, id: grant.id })).allowed, true);
 checks.push("one-use approval issued the exact protected authority and a fresh snapshot revalidated");
 await api("coding/authority/issue", { ...proposed, token: review.confirmation.token }, 409); await api("coding/authority/review", proposed, 401, false);
 checks.push("consumed approval and unauthenticated authority review were rejected");
 await writeFile(join(repositoryRoot, "task.txt"), "synthetic edit after authority\n"); assert.equal((await api("coding/authority/revalidate", { compartment, id: grant.id })).allowed, false);
 await api("coding/authority/revoke", { compartment, id: grant.id }); assert.equal((await api("coding/authority/revalidate", { compartment, id: grant.id })).allowed, false);
 checks.push("changed worktree invalidated authority and explicit revocation prevented reuse");
 const state = await store.snapshot(compartment), probes = state.repositoryProbes.filter(p => p.taskId === taskId); assert.ok(probes.length >= 8); assert.ok(probes.every(p => p.stoppedVerified));
 for (const p of probes) assert.equal(await runtimeGuardianStopped(p.ownedRuntime), true);
 evidence.independentlyStoppedRetainedGuardians = probes.length;
 assert.equal(await git("rev-parse", "HEAD"), head); assert.equal(await git("branch", "--show-current"), branch);
 checks.push("retained native guardians independently verified exited; HEAD and branch remained unchanged");
} catch (e) { failure = e; evidence.failure = e.message; }
finally {
 try {
  await api("mode", { compartment, mode: "keyboard-only" });
  if (await store.selection() === compartment) await api("compartment/select", { compartment: selection });
  const s = await store.snapshot(compartment);
  assert.equal((s.repositoryProbes ?? []).some(p => p.taskId === taskId && p.stoppedVerified !== true), false);
  if (!failure) {
   await store.update(compartment, "synthetic-authority-cleanup", state => {
    const authorityIds = new Set((state.taskAuthorities ?? []).filter(r => r.taskId === taskId).map(r => r.id));
    const confirmations = new Set((state.confirmationJournal ?? []).filter(e => e.kind === "confirmation.issued" && e.payload.confirmation.sessionId === nativeSession).map(e => e.payload.confirmation.id));
    state.taskAuthorities = (state.taskAuthorities ?? []).filter(r => r.taskId !== taskId);
    state.taskAuthorityJournal = (state.taskAuthorityJournal ?? []).filter(e => !authorityIds.has(e.payload.grant?.id ?? e.payload.authorityId));
    state.repositoryProbes = (state.repositoryProbes ?? []).filter(p => p.taskId !== taskId);
    state.confirmationJournal = (state.confirmationJournal ?? []).filter(e => !confirmations.has(e.payload.confirmation?.id ?? e.payload.confirmationId));
    state.codingSessions = (state.codingSessions ?? []).filter(t => t.id !== taskId);
   });
   await rm(stage, { recursive: true, force: true }); evidence.privateStagingRemoved = true;
  }
  assert.equal(definitions(await api("snapshot", { compartment: "personal" })), personal); assert.equal(definitions(await api("snapshot", { compartment })), definitions(baseline)); assert.equal(await store.selection(), selection); assert.equal(JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))).url, endpoint.url);
  checks.push("keyboard-only cleanup restored workspace selection and preserved definitions and private link");
 } catch (e) { failure ??= e; evidence.cleanupFailure = e.message; }
}
evidence.nativeHistory = nativeSession ? "one empty native task retained by installed CLI; no model prompt" : "no native task returned";
const path = join(directory, `installed-task-authority-${Date.now()}.json`); await privateWrite(path, JSON.stringify(evidence, null, 2)+"\n");
console.log(JSON.stringify({ receipt: path, checks: checks.length, privateStagingRemoved: evidence.privateStagingRemoved ?? false, nativePermissionsChanged: false, modelPromptsSubmitted: 0, failure: failure?.message ?? null })); if (failure) throw failure;
