import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import type { RepositoryProcessStartRequest, RepositoryProcessSupervisor, RepositorySupervisedProcess } from "../../windows-companion/src/repository-runtime.ts";
import { LinuxBubblewrapRepositoryProcessSupervisor, LinuxDisposableExecutionRootProvider, LinuxHostValidatedRepositoryRecipeRunner } from "../src/linux-repository-runtime.ts";

test("Linux disposable repository roots are private copies and are removed on release", { skip: process.platform !== "linux" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-roots-")); context.after(async () => rm(root, { recursive: true, force: true }));
  const repository = join(root, "repository"); const state = join(root, "state");
  const { mkdir } = await import("node:fs/promises"); await mkdir(repository); await mkdir(state, { mode: 0o700 }); await writeFile(join(repository, "tracked.txt"), "exact");
  const lease = await new LinuxDisposableExecutionRootProvider(state).prepare({ action: "pipeline_local_gate", repositoryRoot: repository, isolation: "disposable" });
  assert.notEqual(lease.root, await realpath(repository)); assert.equal(await readFile(join(lease.root, "tracked.txt"), "utf8"), "exact");
  assert.deepEqual(lease.protections, { productionData: "denied", ambientCredentials: "denied" });
  await lease.release(); await assert.rejects(() => access(lease.root));
});

test("Linux repository security recipes are compiled into a deny-network Bubblewrap request", { skip: process.platform !== "linux" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-bwrap-runtime-")); context.after(async () => rm(root, { recursive: true, force: true }));
  let captured: RepositoryProcessStartRequest | undefined;
  const handle: RepositorySupervisedProcess = { supervisorId: `managed:${"1".repeat(64)}`, action: "shield_change_scan", operationId: "operation", targetSnapshotId: "a".repeat(64), pid: 7, startedAt: new Date().toISOString(), stdout: Readable.from([]), stderr: Readable.from([]), recovered: false, async wait() { return { code: 0, signal: null, terminalEvidence: "trusted" }; }, async isAlive() { return false; }, async terminateTree() {} };
  const inner: RepositoryProcessSupervisor = { async start(request) { captured = request; return handle; }, async recover() { return []; }, async observeOperation(request) { return { state: "not_owner", operationId: request.operationId, summary: "none" }; } };
  const executable = await realpath(process.execPath);
  const request: RepositoryProcessStartRequest = { action: "shield_change_scan", operationId: "operation", targetSnapshotId: "a".repeat(64), repositoryRoot: root, executionRoot: root, isolation: "repository", manifestSha256: "b".repeat(64), executable, executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"), args: ["--version"], cwd: root, environment: { LANG: "C" }, lifecycle: "foreground", timeoutMs: 10_000, maxOutputBytes: 4096 };
  assert.equal(await new LinuxBubblewrapRepositoryProcessSupervisor(inner).start(request), handle);
  assert.equal(captured?.executable, "/usr/bin/bwrap"); assert.equal(captured?.args.includes("--unshare-net"), true); assert.equal(captured?.args.includes("--clearenv"), true); assert.equal(captured?.args.includes("--ro-bind"), true);
  assert.deepEqual(captured?.environment, { PATH: "/usr/bin:/bin" });
});

test("Linux typed pipeline evidence is converted only after the exact pinned Bubblewrap runtime completes", { skip: process.platform !== "linux" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-evidence-")); context.after(async () => rm(root, { recursive: true, force: true }));
  const target = { id: "a".repeat(64), repositoryRoot: await realpath(root), branch: "feature", head: "b".repeat(40), indexTree: "c".repeat(40), trackedManifest: "d".repeat(64), untrackedManifest: "e".repeat(64), canonicalRemote: "https://github.com/example/repo.git", submodules: {}, policyVersion: "b122-linux-v1", environmentFingerprint: "f".repeat(64), capturedAt: "2026-08-27T00:00:00.000Z", completeness: "complete" as const, reasons: [] };
  const output = JSON.stringify({ schema: "sxsy-b122.linux-repository-recipe-result", version: 1, coverage: ["correctness", "isolation", "production_data", "ambient_credentials"].map((dimension) => ({ dimension, status: "covered", fixtureId: `runtime:${dimension}` })), scannerFixtureIds: [], advisoryFixtureIds: [] });
  let issued = false;
  const runtimes = { async resolve() { return { async execute() { return { status: "completed" as const, summary: "passed", effectDisposition: "committed" as const, exitCode: 0, output, outputTruncated: false }; } }; }, async list() { return [{ canonicalRepositoryRoot: target.repositoryRoot, expectedSha256: "c".repeat(64), status: "active" as const }]; } };
  const issuer = { issue() { throw new Error("not scanner"); }, issueRepositoryRecipeEvidence() { issued = true; return {} as never; } };
  const runner = new LinuxHostValidatedRepositoryRecipeRunner(runtimes as never, issuer, { async resolve() { return []; } }, () => new Date());
  const result = await runner.runRecipe({ action: "pipeline_local_gate", operationId: "operation", target, profile: "full_sandbox", effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } }, "pipeline_local_gate");
  assert.equal(result.status, "completed"); assert.equal(issued, true);
});
