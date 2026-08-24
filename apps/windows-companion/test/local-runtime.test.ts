import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  captureLiveTargetSnapshot, createReviewApproval,
  FilesystemBroker, LocalControlExecutionBroker, LocalProcessProviderAdapter, LocalRepositoryBroker, LocalSandboxBroker, LocalTestEnvironmentBroker, validateReviewApproval
} from "../src/local-runtime.ts";
import type { ManagedSession } from "../src/control-plane.ts";

async function command(directory: string, ...args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => { const child = spawn(args[0], args.slice(1), { cwd: directory, shell: false }); child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${args.join(" ")} failed`))); });
}
async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-local-repo-"));
  await command(directory, "git", "init"); await command(directory, "git", "config", "user.email", "tests@example.invalid"); await command(directory, "git", "config", "user.name", "SXSY Test");
  await writeFile(join(directory, "README.md"), "safe\n", "utf8"); await command(directory, "git", "add", "README.md"); await command(directory, "git", "commit", "-m", "initial"); await command(directory, "git", "checkout", "-b", "feature/test"); return directory;
}

test("legacy local Git helper retains read-only snapshots and refuses all direct mutations", async () => {
  const directory = await repository();
  try {
    const target = await captureLiveTargetSnapshot(directory); const broker = new LocalRepositoryBroker(directory);
    assert.equal((await broker.status(target)).branch.length > 0, true);
    const approval = createReviewApproval("COMMIT:normal", target, "test");
    assert.equal(validateReviewApproval(approval, "COMMIT:normal", target), undefined);
    assert.equal((await broker.commit(target, "", approval)).outcome, "blocked");
    await writeFile(join(directory, "README.md"), "changed\n", "utf8");
    assert.match((await broker.revalidate(target))!, /no longer matches/i);
    assert.equal((await broker.commit(target, "reviewed", approval)).outcome, "blocked");
    await command(directory, "git", "add", "README.md"); const reviewedTarget = await captureLiveTargetSnapshot(directory);
    assert.equal((await broker.commit(reviewedTarget, "without approval")).outcome, "blocked");
    assert.equal((await broker.commit(reviewedTarget, "reviewed", createReviewApproval("COMMIT:normal", reviewedTarget, "test"))).outcome, "blocked");
    await writeFile(join(directory, "README.md"), "dirty-one\n", "utf8"); const dirtyTarget = await captureLiveTargetSnapshot(directory);
    await writeFile(join(directory, "README.md"), "dirty-two\n", "utf8"); assert.match((await broker.revalidate(dirtyTarget))!, /no longer matches/i);
    await writeFile(join(directory, "untracked.txt"), "one\n", "utf8"); const untrackedTarget = await captureLiveTargetSnapshot(directory);
    await writeFile(join(directory, "untracked.txt"), "two\n", "utf8"); assert.match((await broker.revalidate(untrackedTarget))!, /no longer matches/i);
    await command(directory, "git", "add", "README.md"); const staged = await broker.status(await captureLiveTargetSnapshot(directory)); assert.match(staged.diff, /dirty-two/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("filesystem, isolated-test, and sandbox brokers contain local state", async () => {
  const directory = await repository(); const state = await mkdtemp(join(tmpdir(), "sxsy-state-"));
  try {
    const files = new FilesystemBroker({ allowedRoots: [directory], directMain: "deny", push: "deny" });
    await files.write(join(directory, "nested", "note.txt"), "allowed"); assert.equal(await files.read(join(directory, "nested", "note.txt")), "allowed");
    await assert.rejects(files.read(join(state, "outside.txt")), /allowlist/i);
    const recipe = new LocalTestEnvironmentBroker({ command: process.execPath, args: ["-e", "process.exit(process.env.SXSY_AUDIT_SECRET ? 1 : 0)"], productionDenyPatterns: [/prod\.example/i] });
    const target = await captureLiveTargetSnapshot(directory); const original = process.env.SXSY_AUDIT_SECRET; process.env.SXSY_AUDIT_SECRET = "must-not-leak";
    try { assert.equal((await recipe.run(target)).outcome, "passed"); } finally { if (original === undefined) delete process.env.SXSY_AUDIT_SECRET; else process.env.SXSY_AUDIT_SECRET = original; }
    const unsafe = new LocalTestEnvironmentBroker({ command: process.execPath, args: [], environment: { DATABASE_URL: "https://prod.example/db" }, productionDenyPatterns: [/prod\.example/i] });
    assert.equal((await unsafe.prepare(target)).available, false);
    const sandboxes = new LocalSandboxBroker(state); const lease = await sandboxes.create(target, true); assert.equal((await sandboxes.reconcile()).length, 1);
    assert.equal((await sandboxes.release(lease, undefined, target)).outcome, "blocked");
    assert.equal((await sandboxes.release(lease, createReviewApproval("SANDBOX:release", target, "test"), target)).outcome, "passed");
  } finally { await rm(directory, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); }
});

test("named local controls use concrete broker paths and inspect staged changes", async () => {
  const directory = await repository();
  try {
    const target = await captureLiveTargetSnapshot(directory);
    const session: ManagedSession = { id: "local-agent", provider: "generic", adapterVersion: "test", surface: "test", windowId: "window", target, plannedFiles: [], capability: { registered: true, observable: true, controllable: true, mediated: true }, status: "running", lastHeartbeat: Date.now() };
    const provider = new LocalProcessProviderAdapter("generic", [session]);
    const execution = new LocalControlExecutionBroker(new LocalRepositoryBroker(directory), new LocalTestEnvironmentBroker(), provider);
    assert.equal((await execution.execute("REANCHOR:normal", target, { control: "REANCHOR", modifier: "normal", sessionId: session.id })).outcome, "passed");
    assert.deepEqual(provider.calls, [`pause:${session.id}`]);
    await writeFile(join(directory, "README.md"), "token=staged-secret\n", "utf8"); await command(directory, "git", "add", "README.md");
    const stagedTarget = await captureLiveTargetSnapshot(directory);
    assert.equal((await execution.execute("SHIELD:normal", stagedTarget, { control: "SHIELD", modifier: "normal", sessionId: session.id })).outcome, "failed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
