import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { companionBridgeVersion } from "../src/bridge.ts";
import { createDurableWindowsCompanion } from "../src/bootstrap.ts";

const targetMaterial = {
  repositoryRoot: "C:/safe/repo", canonicalRemote: "https://github.com/example/safe.git", branch: "feature/safe",
  head: "abc", indexTree: "tree", trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "policy-1",
  environmentFingerprint: "env", completeness: "complete" as const, reasons: [] as readonly string[]
};
const target: TargetSnapshot = {
  id: targetSnapshotDigest(targetMaterial), ...targetMaterial, capturedAt: "2026-08-23T12:00:00.000Z"
};

const isolatedAuthenticator: JournalAuthenticator = {
  provider: "isolated-test-authenticator",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

test("bootstrap wires a protected registry and durable executor while a missing authority remains fail-closed", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-bootstrap-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const companion = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator: isolatedAuthenticator }), policyVersion: "policy-1",
    targetResolver: { resolve: async () => target }
  });
  await companion.registerTrustedSession({
    id: "trusted", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task", planRevision: "plan",
    plannedFiles: [], lastHeartbeat: "2026-08-23T12:00:00.000Z", adapterVersion: "trusted", metadata: {}
  });
  const response = await companion.endpoint.handle({
    version: companionBridgeVersion, id: "proof", method: "command.dispatch", payload: { control: "PROOF", modifier: "normal", sessionId: "trusted" }
  });
  assert.equal(response.ok, true);
  assert.equal((response.result as { command: { status: string } }).command.status, "blocked");
  assert.equal((await companion.endpoint.listSessions()).length, 1);
});

test("bootstrap rejects a hash-chain-only store outside the isolated test override", () => {
  assert.throws(() => createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: "C:/isolated/unsafe.jsonl" }),
    policyVersion: "policy-1",
    targetResolver: { resolve: async () => target }
  }), /host-backed journal authenticator/i);
});
