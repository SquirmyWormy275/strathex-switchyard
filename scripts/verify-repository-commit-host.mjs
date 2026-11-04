#!/usr/bin/env node
/** Explicit installed Linux proof: one empty native task and one disposable local commit; zero model prompts. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationStateRoot } from "../deployment/suite/application.mjs";
import { privateDirectory, privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage: node scripts/verify-repository-commit-host.mjs --synthetic (installed Linux pilot; one empty native task, no model prompt; commits only its new disposable repository)");
const execute = promisify(execFile), store = createSuiteStore(), compartment = "authority-validation", taskId = randomUUID(), requestId = randomUUID();
const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"), stage = join(directory, `repository-commit-${randomUUID()}`), repositoryRoot = join(stage, "repository"), checks = [];
const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1]; assert.ok(token && url.hostname === "127.0.0.1" && url.protocol === "http:");
async function api(path, body = {}, expected = 200, authenticated = true) {
  const r = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const value = await r.json(); assert.equal(r.status, expected, `Installed ${path}: ${typeof value.error === "string" ? value.error.slice(0, 400) : "unexpected status"}`); return value;
}
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex"), definitions = s => digest([s.profile, s.workflow, s.roleBindings ?? [], s.mode]);
const selection = await store.selection(), selected = await api("snapshot", { compartment: selection });
assert.equal(selected.observations.some(o => o.status === "recording") || selected.voice.some(v => v.status === "recording"), false, "Do not interrupt a recording for this proof.");
const personal = definitions(await api("snapshot", { compartment: "personal" })); await api("compartment/create", { compartment, policy: "personal" });
const baseline = await store.snapshot(compartment); assert.equal(baseline.mode, "keyboard-only");
const effectFields = ["repositoryEffectJournal", "repositoryEffectCheckpoints", "repositoryEffects", "repositoryCommitReviews"];
assert.equal(effectFields.some(field => (baseline[field] ?? []).length > 0), false, "Preserve any previous effect/recovery evidence before running this disposable proof.");
assert.equal((baseline.repositoryProbes ?? []).some(p => !p.stoppedVerified), false);
await privateDirectory(repositoryRoot);
const git = async (...args) => (await execute("/usr/bin/git", args, { cwd: repositoryRoot, env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, timeout: 10000 })).stdout;
await git("init", "-b", "main"); await git("config", "user.name", "Synthetic base"); await git("config", "user.email", "synthetic@example.invalid");
await writeFile(join(repositoryRoot, "task.bin"), "before\n"); await writeFile(join(repositoryRoot, "unowned.txt"), "keep in base\n"); await git("add", "task.bin", "unowned.txt"); await git("-c", "commit.gpgSign=false", "commit", "-m", "synthetic baseline");
await git("remote", "add", "origin", "https://github.com/example/synthetic-installed-commit.git"); await git("update-ref", "refs/remotes/origin/main", "HEAD"); await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"); await git("switch", "-c", "feature/synthetic-commit");
const binary = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256)); await writeFile(join(repositoryRoot, "task.bin"), binary); await writeFile(join(repositoryRoot, "unowned.txt"), "unowned working change\n");
const beforeHead = await git("rev-parse", "HEAD"), evidence = { schema: "switchyard-installed-reviewed-local-commit/v1", at: new Date().toISOString(), checks, modelPromptsSubmitted: 0, nativePermissionsChanged: false, codingTaskCompletionVerified: false, repositoryScope: "new disposable synthetic repository only", recoveryApplyImplemented: false, frontendVisualAcceptance: false };
let failure, nativeSession, operationId;
try {
  await api("compartment/select", { compartment }); await api("mode", { compartment, mode: "personal-companion" });
  const task = await api("coding/codex/create", { compartment, requestId: taskId, repositoryRoot, label: "Synthetic reviewed commit acceptance" }); nativeSession = task.sessionId; assert.ok(nativeSession && task.repositoryIdentity); assert.equal(task.modelPromptSubmitted, false);
  checks.push("normal installed API created one exact account/directory-bound empty Codex task without prompting");
  const proposed = { compartment, taskId, planRevision: "synthetic-local-commit-1", paths: ["task.bin"], lifetimeMinutes: 5 }, authorityReview = await api("coding/authority/review", proposed), authority = await api("coding/authority/issue", { ...proposed, token: authorityReview.confirmation.token });
  assert.equal(authority.localCommitExecutionImplemented, true); assert.equal(authority.nativePermissionsChanged, false);
  checks.push("existing separate one-use task approval issued exact local-commit authority");
  const message = "Synthetic installed exact binary commit", author = { name: "Synthetic installed commit", email: "synthetic@example.invalid" };
  const review = await api("coding/commits/review", { compartment, requestId, authorityId: authority.id, message, author }); assert.deepEqual(review.review.author, author); assert.equal(review.review.message, message); assert.deepEqual(review.review.paths, ["task.bin"]); assert.equal(review.review.files[0].digest, "sha256:" + createHash("sha256").update(binary).digest("hex"));
  await api("coding/commits/review", { compartment, requestId: randomUUID(), authorityId: authority.id, message, author }, 401, false); await api("coding/commits/execute", { compartment, requestId, token: randomUUID() }, 409);
  checks.push("separate effect review bound exact files/digests/message/author and rejected unauthenticated or mismatched approval");
  const request = { compartment, requestId, token: review.confirmation.token }, outcome = await api("coding/commits/execute", request); assert.equal(outcome.status, "completed", outcome.summary); assert.equal(outcome.effectDisposition, "committed"); assert.equal(outcome.replayed, false); assert.equal(outcome.providerTaskCompletionVerified, false); operationId = outcome.operationId;
  const committed = await git("rev-parse", "HEAD"); assert.notEqual(committed, beforeHead);
  const blob = await execute("/usr/bin/git", ["show", "HEAD:task.bin"], { cwd: repositoryRoot, encoding: "buffer", timeout: 10000 }); assert.deepEqual(blob.stdout, binary); assert.equal(await git("show", "HEAD:unowned.txt"), "keep in base\n"); assert.equal(await readFile(join(repositoryRoot, "unowned.txt"), "utf8"), "unowned working change\n"); assert.equal(await git("diff", "--cached", "--name-only"), ""); assert.equal(await git("show", "-s", "--format=%an <%ae>"), "Synthetic installed commit <synthetic@example.invalid>\n");
  checks.push("normal installed commit preserved every binary byte, explicit author, unowned edit and reconciled shared index");
  const state = await store.snapshot(compartment), effect = state.repositoryEffects.find(r => r.id === operationId); assert.equal(effect.status, "settled"); assert.ok(effect.commands.length > 20);
  for (const command of effect.commands) { assert.equal(command.stoppedVerified, true); assert.equal(await runtimeGuardianStopped(command.ownedRuntime), true); }
  evidence.independentlyStoppedGitGuardians = effect.commands.length;
  const replay = await api("coding/commits/execute", request); assert.equal(replay.replayed, true); assert.equal(replay.operationId, operationId); assert.equal(replay.receiptId, outcome.receiptId); assert.equal(await git("rev-parse", "HEAD"), committed); assert.equal((await store.snapshot(compartment)).repositoryEffects.find(r => r.id === operationId).commands.length, effect.commands.length);
  checks.push("durable duplicate request returned the same operation/receipt without another commit or native command");
  const observed = await api("coding/repository-effects/inspect", { compartment, id: operationId }); assert.equal(observed.recommendation, "settled"); assert.equal(observed.nativeOwnersStoppedVerified, true); assert.equal(observed.observed.metadata.head + "\n", committed); assert.equal(observed.repositoryWritten, false); assert.equal(observed.referenceMutationReplayed, false);
  const probes = (await store.snapshot(compartment)).repositoryProbes.filter(p => p.taskId === taskId); for (const probe of probes) assert.equal(await runtimeGuardianStopped(probe.ownedRuntime), true); evidence.independentlyStoppedRetainedInspectionGuardians = probes.length;
  assert.equal((await api("coding/authority/revalidate", { compartment, id: authority.id })).allowed, false);
  checks.push("normal recovery observer independently verified exit and exact final HEAD without replay; old authority target became stale");
} catch (error) { failure = error; evidence.failure = error.message; }
finally {
  try {
    await api("mode", { compartment, mode: "keyboard-only" }); if (await store.selection() === compartment) await api("compartment/select", { compartment: selection });
    const state = await store.snapshot(compartment); assert.equal((state.repositoryProbes ?? []).some(p => p.taskId === taskId && !p.stoppedVerified), false);
    for (const probe of (state.repositoryProbes ?? []).filter(p => p.taskId === taskId)) assert.equal(await runtimeGuardianStopped(probe.ownedRuntime), true);
    for (const effect of state.repositoryEffects ?? []) for (const command of effect.commands) assert.equal(await runtimeGuardianStopped(command.ownedRuntime), true);
    if (!failure) {
      const exact = digest(effectFields.map(field => state[field] ?? null));
      await store.update(compartment, "synthetic-installed-commit-cleanup", s => {
        assert.equal(digest(effectFields.map(field => s[field] ?? null)), exact, "Preserve concurrent effect journal changes.");
        assert.equal(s.repositoryEffects.length, 1); assert.equal(s.repositoryEffects[0].id, operationId); assert.equal(s.repositoryCommitReviews.length, 1); assert.equal(s.repositoryCommitReviews[0].requestId, requestId);
        for (const field of effectFields) { if (baseline[field] === undefined) delete s[field]; else s[field] = structuredClone(baseline[field]); }
        const authorities = new Set((s.taskAuthorities ?? []).filter(r => r.taskId === taskId).map(r => r.id)), confirmations = new Set((s.confirmationJournal ?? []).filter(e => e.kind === "confirmation.issued" && e.payload.confirmation.sessionId === nativeSession).map(e => e.payload.confirmation.id));
        s.taskAuthorities = (s.taskAuthorities ?? []).filter(r => r.taskId !== taskId); s.taskAuthorityJournal = (s.taskAuthorityJournal ?? []).filter(e => !authorities.has(e.payload.grant?.id ?? e.payload.authorityId)); s.confirmationJournal = (s.confirmationJournal ?? []).filter(e => !confirmations.has(e.payload.confirmation?.id ?? e.payload.confirmationId)); s.repositoryProbes = (s.repositoryProbes ?? []).filter(p => p.taskId !== taskId); s.codingSessions = (s.codingSessions ?? []).filter(t => t.id !== taskId);
      });
      await rm(stage, { recursive: true, force: true }); evidence.privateStagingRemoved = true;
    }
    assert.equal(definitions(await api("snapshot", { compartment: "personal" })), personal); assert.equal(definitions(await api("snapshot", { compartment })), definitions(baseline)); assert.equal(await store.selection(), selection); assert.equal(JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))).url, endpoint.url);
    checks.push("keyboard-only cleanup restored selection, definitions and private link while preserving native empty-task history");
  } catch (error) { failure ??= error; evidence.cleanupFailure = error.message; }
}
const receipt = join(directory, `installed-repository-commit-${Date.now()}.json`); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt, checks: checks.length, independentlyStoppedGitGuardians: evidence.independentlyStoppedGitGuardians ?? 0, privateStagingRemoved: evidence.privateStagingRemoved ?? false, modelPromptsSubmitted: 0, failure: failure?.message ?? null })); if (failure) throw failure;
