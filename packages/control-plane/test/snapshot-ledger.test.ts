import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TargetSnapshot } from "../src/contracts.ts";
import { TargetSnapshotLedger } from "../src/snapshot-ledger.ts";
import { TargetSnapshotFactory, targetSnapshotDigest, type GitInspector } from "../src/snapshot.ts";
import { ProtectedJsonStore } from "../src/store.ts";

function snapshot(): TargetSnapshot {
  const material = {
    repositoryRoot: "C:/safe/repo", canonicalRemote: "https://github.com/example/safe.git", branch: "feature/safe", upstream: "origin/feature/safe",
    head: "abc", indexTree: "tree", trackedManifest: "tracked", untrackedManifest: "untracked", submodules: { "vendor/tool": "def" },
    policyVersion: "policy-1", environmentFingerprint: "environment", completeness: "complete" as const, reasons: [] as readonly string[]
  };
  return { id: targetSnapshotDigest(material), ...material, capturedAt: "2026-08-23T12:00:00.000Z" };
}

test("target snapshots are protected, idempotent, and recoverable by their exact content ID", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-snapshot-ledger-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl") });
  const ledger = new TargetSnapshotLedger(store);
  const saved = await ledger.record(snapshot());
  assert.equal(saved.id, snapshot().id);
  const repeated = await ledger.record(snapshot());
  assert.equal(repeated.id, saved.id);
  assert.equal((await new TargetSnapshotLedger(store).get(saved.id))?.repositoryRoot, "C:/safe/repo");
  assert.equal((await ledger.list()).length, 1);
});

test("target snapshot ledger preserves default-branch and detached-HEAD identity fields", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-snapshot-ledger-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const ledger = new TargetSnapshotLedger(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl") }));
  const branchBoundMaterial = {
    repositoryRoot: "C:/safe/repo", canonicalRemote: "https://github.com/example/safe.git", branch: "feature/safe",
    defaultBranch: "main", upstream: "origin/feature/safe", head: "abc", indexTree: "tree", trackedManifest: "tracked",
    untrackedManifest: "untracked", submodules: {}, policyVersion: "policy-1", environmentFingerprint: "environment",
    completeness: "complete" as const, reasons: [] as readonly string[]
  };
  const branchBound: TargetSnapshot = {
    id: targetSnapshotDigest(branchBoundMaterial), ...branchBoundMaterial, capturedAt: "2026-08-23T12:00:00.000Z"
  };
  const detachedMaterial = {
    repositoryRoot: "C:/safe/repo", canonicalRemote: "https://github.com/example/safe.git", defaultBranch: "main",
    detached: true as const, head: "def", indexTree: "tree", trackedManifest: "tracked", untrackedManifest: "untracked",
    submodules: {}, policyVersion: "policy-1", environmentFingerprint: "environment", completeness: "complete" as const,
    reasons: [] as readonly string[]
  };
  const detached: TargetSnapshot = {
    id: targetSnapshotDigest(detachedMaterial), ...detachedMaterial, capturedAt: "2026-08-23T12:00:01.000Z"
  };

  await ledger.record(branchBound);
  await ledger.record(detached);

  assert.equal((await ledger.get(branchBound.id))?.defaultBranch, "main");
  assert.equal((await ledger.get(detached.id))?.detached, true);
});

test("target snapshot ledger rejects a wrong digest and hash-chain tampering", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-snapshot-ledger-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "protected.jsonl");
  const store = new ProtectedJsonStore({ filePath: path });
  const ledger = new TargetSnapshotLedger(store);
  await assert.rejects(ledger.record({ ...snapshot(), id: "wrong" }), /digest/i);
  await ledger.record(snapshot());
  const raw = await readFile(path, "utf8");
  await writeFile(path, raw.replace("feature/safe", "main"), "utf8");
  await assert.rejects(new TargetSnapshotLedger(new ProtectedJsonStore({ filePath: path })).list(), /hash mismatch|chain breaks|digest/i);
});

test("an inspector failure is recorded as a durable incomplete snapshot rather than discarded", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-snapshot-ledger-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const factory = new TargetSnapshotFactory({
    inspect: async () => { throw new Error("isolated fake inspector failure"); }
  } satisfies GitInspector, { clock: () => "2026-08-23T12:00:00.000Z" });
  const failed = await factory.capture({
    policyVersion: "policy-1",
    targetHint: "C:/safe/repo",
    environment: { toolVersions: { git: "test" } }
  });
  assert.equal(failed.completeness, "incomplete");
  const ledger = new TargetSnapshotLedger(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl") }));
  assert.equal((await ledger.record(failed)).id, failed.id);
  assert.equal((await ledger.get(failed.id))?.completeness, "incomplete");
});
