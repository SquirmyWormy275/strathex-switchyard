import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LinuxBubblewrapIsolationRuntime, type BubblewrapProbeRunner } from "../src/linux-isolation.ts";

function request(root: string) {
  return {
    operationId: "op-linux-sandbox",
    action: "full_sandbox" as const,
    target: { id: "target-linux", repositoryRoot: root, branch: "feature", head: "a".repeat(40), trackedManifest: "b".repeat(64), untrackedManifest: "c".repeat(64), submodules: {}, policyVersion: "b122-local-v1", environmentFingerprint: "d".repeat(64), capturedAt: new Date().toISOString(), completeness: "complete" as const, reasons: [] },
    profile: "full_sandbox" as const,
    permit: { id: "permit-linux", operationId: "op-linux-sandbox", action: "full_sandbox" as const, targetSnapshotId: "target-linux", policyVersion: "b122-local-v1", issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), authorityId: "authority", authorityVersion: 1, sessionId: "session", signature: "test" }
  };
}

test("Linux isolation proves a deny-network Bubblewrap namespace bound to the exact repository", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-bwrap-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  const calls: Parameters<BubblewrapProbeRunner>[0][] = [];
  const runner: BubblewrapProbeRunner = async (input) => { calls.push(input); return { exitCode: 0, stdout: "sxsy-b122-linux-sandbox-ok\n", stderr: "" }; };
  const runtime = new LinuxBubblewrapIsolationRuntime({ executable: "/usr/bin/bwrap", runner });
  const outcome = await runtime.start(request(await realpath(root)));
  assert.equal(outcome.status, "completed");
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.args.includes("--unshare-net"));
  assert.ok(calls[0]!.args.includes("--die-with-parent"));
  assert.ok(calls[0]!.args.includes(await realpath(root)));
});

test("Linux isolation fails closed when Bubblewrap is absent or the target changes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-bwrap-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const canonicalRoot = await realpath(root);
  const unavailable = new LinuxBubblewrapIsolationRuntime({ executable: "/usr/bin/bwrap", runner: async () => { throw new Error("ENOENT"); } });
  assert.equal((await unavailable.start(request(canonicalRoot))).status, "unavailable");
  const changed = new LinuxBubblewrapIsolationRuntime({ executable: "/usr/bin/bwrap", canonicalize: async () => `${root}-changed`, runner: async () => ({ exitCode: 0, stdout: "sxsy-b122-linux-sandbox-ok\n", stderr: "" }) });
  assert.equal((await changed.start(request(root))).status, "blocked");
});

test("installed Bubblewrap creates the real deny-network namespace", { skip: process.platform !== "linux" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-bwrap-real-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const runtime = new LinuxBubblewrapIsolationRuntime();
  const outcome = await runtime.start(request(await realpath(root)));
  if (outcome.status === "unavailable") { context.skip(outcome.summary); return; }
  assert.equal(outcome.status, "completed", outcome.summary);
  assert.deepEqual(outcome.data, { backend: "bubblewrap", network: "deny", repository: "read-only", profile: "full_sandbox" });
});
