import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  callCompanion, captureLiveTargetSnapshot, CompanionIpcServer, createCompanionConfiguration, createReviewApproval,
  FilesystemBroker, LocalRepositoryBroker, LocalSandboxBroker, LocalTestEnvironmentBroker, validateReviewApproval
} from "../src/local-runtime.ts";

async function command(directory: string, ...args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => { const child = spawn(args[0], args.slice(1), { cwd: directory, shell: false }); child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${args.join(" ")} failed`))); });
}
async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-local-repo-"));
  await command(directory, "git", "init"); await command(directory, "git", "config", "user.email", "tests@example.invalid"); await command(directory, "git", "config", "user.name", "SXSY Test");
  await writeFile(join(directory, "README.md"), "safe\n", "utf8"); await command(directory, "git", "add", "README.md"); await command(directory, "git", "commit", "-m", "initial"); return directory;
}

test("live Git snapshots, exact-target review, and mutation policy are concrete and fail closed", async () => {
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
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("filesystem, isolated-test, and sandbox brokers contain local state", async () => {
  const directory = await repository(); const state = await mkdtemp(join(tmpdir(), "sxsy-state-"));
  try {
    const files = new FilesystemBroker({ allowedRoots: [directory], directMain: "deny", push: "deny" });
    await files.write(join(directory, "nested", "note.txt"), "allowed"); assert.equal(await files.read(join(directory, "nested", "note.txt")), "allowed");
    await assert.rejects(files.read(join(state, "outside.txt")), /allowlist/i);
    const recipe = new LocalTestEnvironmentBroker({ command: process.execPath, args: ["-e", "process.exit(0)"], productionDenyPatterns: [/prod\.example/i] });
    const target = await captureLiveTargetSnapshot(directory); assert.equal((await recipe.run(target)).outcome, "passed");
    const unsafe = new LocalTestEnvironmentBroker({ command: process.execPath, args: [], environment: { DATABASE_URL: "https://prod.example/db" }, productionDenyPatterns: [/prod\.example/i] });
    assert.equal((await unsafe.prepare(target)).available, false);
    const sandboxes = new LocalSandboxBroker(state); const lease = await sandboxes.create(target, true); assert.equal((await sandboxes.reconcile()).length, 1);
    assert.equal((await sandboxes.release(lease, undefined, target)).outcome, "blocked");
    assert.equal((await sandboxes.release(lease, createReviewApproval("SANDBOX:release", target, "test"), target)).outcome, "passed");
  } finally { await rm(directory, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); }
});

test("authenticated local IPC has a local health path", async () => {
  const state = await mkdtemp(join(tmpdir(), "sxsy-ipc-"));
  try {
    const config = await createCompanionConfiguration(state); const server = new CompanionIpcServer(config, async (method) => method === "health" ? { healthy: true } : Promise.reject(new Error("unknown")));
    await server.start(); const response = await callCompanion(config, "health"); assert.equal(response.ok, true); assert.deepEqual(response.result, { healthy: true });
    const rejected = await callCompanion({ ...config, token: "not-the-local-token" }, "health"); assert.equal(rejected.ok, false); await server.stop();
  } finally { await rm(state, { recursive: true, force: true }); }
});
