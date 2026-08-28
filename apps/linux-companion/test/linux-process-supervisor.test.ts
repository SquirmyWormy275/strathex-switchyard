import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { FakeUserSecretProtector, SecretProtectorJournalAuthenticator } from "../../windows-companion/src/windows-secret.ts";
import { LinuxProcessGroupSupervisor } from "../src/linux-process-supervisor.ts";

test("Linux process supervisor binds, observes, and terminates an exact process group", { skip: process.platform !== "linux" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-process-")); context.after(async () => rm(root, { recursive: true, force: true }));
  const executable = await realpath(process.execPath); const executableSha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
  const store = new ProtectedJsonStore({ filePath: join(root, "audit.jsonl"), authenticator: new SecretProtectorJournalAuthenticator(new FakeUserSecretProtector()), requireAuthenticatedProtection: true });
  const supervisor = new LinuxProcessGroupSupervisor(store);
  const request = { action: "run_target" as const, operationId: "linux-process-op", targetSnapshotId: "a".repeat(64), repositoryRoot: root, manifestSha256: "b".repeat(64), executable, executableSha256, args: ["-e", "process.stdout.write('ready');setInterval(()=>{},1000)"], cwd: root, environment: { PATH: "/usr/bin:/bin" }, lifecycle: "managed" as const, timeoutMs: 60_000, maxOutputBytes: 4096 };
  const processHandle = await supervisor.start(request);
  context.after(async () => { if (await processHandle.isAlive()) await processHandle.terminateTree(1_000, 1_000); await processHandle.wait().catch(() => undefined); });
  assert.equal(await processHandle.isAlive(), true);
  const active = await supervisor.observeOperation({ action: request.action, operationId: request.operationId, targetSnapshotId: request.targetSnapshotId, repositoryRoot: root, manifestSha256: request.manifestSha256 });
  assert.equal(active.state, "active");
  await processHandle.terminateTree(1_000, 1_000);
  const terminal = await processHandle.wait();
  assert.notEqual(terminal.signal, null);
  assert.equal(await processHandle.isAlive(), false);
});

test("Linux process supervisor reserves one operation before concurrent launch", { skip: process.platform !== "linux" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-process-race-")); context.after(async () => rm(root, { recursive: true, force: true }));
  const executable = await realpath(process.execPath); const executableSha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
  const store = new ProtectedJsonStore({ filePath: join(root, "audit.jsonl"), authenticator: new SecretProtectorJournalAuthenticator(new FakeUserSecretProtector()), requireAuthenticatedProtection: true });
  const supervisor = new LinuxProcessGroupSupervisor(store);
  const request = { action: "run_target" as const, operationId: "linux-process-race", targetSnapshotId: "c".repeat(64), repositoryRoot: root, manifestSha256: "d".repeat(64), executable, executableSha256, args: ["-e", "setInterval(()=>{},1000)"], cwd: root, environment: { PATH: "/usr/bin:/bin" }, lifecycle: "managed" as const, timeoutMs: 60_000, maxOutputBytes: 4096 };
  const attempts = await Promise.allSettled([supervisor.start(request), supervisor.start(request)]);
  const started = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof supervisor.start>>> => attempt.status === "fulfilled");
  context.after(async () => { for (const attempt of started) { if (await attempt.value.isAlive()) await attempt.value.terminateTree(1_000, 1_000); await attempt.value.wait().catch(() => undefined); } });
  assert.equal(started.length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
  await started[0]!.value.terminateTree(1_000, 1_000);
  await started[0]!.value.wait();
});

test("Linux process supervisor persists and enforces the operation deadline", { skip: process.platform !== "linux" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-process-deadline-")); context.after(async () => rm(root, { recursive: true, force: true }));
  const executable = await realpath(process.execPath); const executableSha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
  const store = new ProtectedJsonStore({ filePath: join(root, "audit.jsonl"), authenticator: new SecretProtectorJournalAuthenticator(new FakeUserSecretProtector()), requireAuthenticatedProtection: true });
  const supervisor = new LinuxProcessGroupSupervisor(store);
  const request = { action: "run_target" as const, operationId: "linux-process-deadline", targetSnapshotId: "e".repeat(64), repositoryRoot: root, manifestSha256: "f".repeat(64), executable, executableSha256, args: ["-e", "setInterval(()=>{},1000)"], cwd: root, environment: { PATH: "/usr/bin:/bin" }, lifecycle: "managed" as const, timeoutMs: 250, maxOutputBytes: 4096 };
  const processHandle = await supervisor.start(request);
  context.after(async () => { if (await processHandle.isAlive()) await processHandle.terminateTree(1_000, 1_000); await processHandle.wait().catch(() => undefined); });
  const terminal = await processHandle.wait();
  assert.notEqual(terminal.signal, null);
  assert.equal(await processHandle.isAlive(), false);
  const observed = await supervisor.observeOperation({ action: request.action, operationId: request.operationId, targetSnapshotId: request.targetSnapshotId, repositoryRoot: root, manifestSha256: request.manifestSha256 });
  assert.equal(observed.state, "terminal");
});
