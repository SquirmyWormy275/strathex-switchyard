import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { companionBridgeVersion } from "../src/bridge.ts";
import { createDurableWindowsCompanion } from "../src/bootstrap.ts";
import { DurableHostActionAdapter, DurableHostActionQueue } from "../src/host-actions.ts";

const authenticator: JournalAuthenticator = {
  provider: "isolated-host-action-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

const target: TargetSnapshot = {
  id: "target-host-action", repositoryRoot: "C:/isolated/repo", canonicalRemote: "git@github.com:acme/switchyard.git",
  branch: "feature/host-actions", head: "head", indexTree: "tree", trackedManifest: "tracked", untrackedManifest: "untracked",
  submodules: {}, policyVersion: "policy-host", environmentFingerprint: "environment", capturedAt: "2026-08-23T00:00:00.000Z",
  completeness: "complete", reasons: []
};

test("GitHub host action derives only a trusted canonical URL and is durably idempotent", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-actions-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  let tick = 0;
  const queue = new DurableHostActionQueue(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }), {
    now: () => new Date(`2026-08-23T00:00:0${tick++}.000Z`)
  });
  const adapter = new DurableHostActionAdapter(queue);
  const request = { definition: commandForAction("github_pr"), operationId: "operation-github", target };
  const first = await adapter.execute(request);
  const second = await adapter.execute(request);
  assert.equal(first.status, "running");
  assert.deepEqual(second.data, first.data);
  assert.equal(first.data?.hostActionUrl, "https://github.com/acme/switchyard/pulls?q=is%3Apr+is%3Aopen+head%3Afeature%2Fhost-actions");
  assert.equal((await queue.listPending()).length, 1);
});

test("installed dispatch stays running until the authenticated host acknowledgement durably settles it", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-integration-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator });
  const companion = createDurableWindowsCompanion({
    store,
    policyVersion: "policy-host",
    localStateDirectory: directory,
    targetResolver: { resolve: async () => undefined }
  });
  const dispatch = await companion.endpoint.handle({ version: companionBridgeVersion, id: "open-claude", method: "command.dispatch", payload: { control: "CLAUDE", modifier: "normal" } });
  assert.equal(dispatch.ok, true);
  const command = (dispatch.result as { command: { status: string; operationId?: string; data?: Record<string, unknown> } }).command;
  assert.equal(command.status, "running");
  assert.match(String(command.data?.hostActionId), /^host-action:[a-f0-9]{64}$/);
  assert.equal((await companion.hostActions.listPending()).length, 1);

  const completed = await companion.endpoint.handle({
    version: companionBridgeVersion,
    id: "ack-claude",
    method: "host-action.complete",
    payload: { hostActionId: command.data!.hostActionId, succeeded: true, summary: "VS Code opened the trusted Claude destination.", adapterVersion: "test-extension-1" }
  });
  assert.equal(completed.ok, true);
  const result = (completed.result as { command: { status: string; operationId?: string } }).command;
  assert.equal(result.status, "completed");
  assert.equal(result.operationId, command.operationId);
  assert.equal((await companion.hostActions.listPending()).length, 0);
  assert.equal((await companion.executor.operations.get(command.operationId!))?.state, "recorded");
});

test("an unknown or conflicting host acknowledgement cannot finalize an operation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-reject-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const companion = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }),
    policyVersion: "policy-host",
    localStateDirectory: directory,
    targetResolver: { resolve: async () => undefined }
  });
  const response = await companion.endpoint.handle({
    version: companionBridgeVersion,
    id: "unknown-ack",
    method: "host-action.complete",
    payload: { hostActionId: `host-action:${"0".repeat(64)}`, succeeded: true, summary: "fabricated", adapterVersion: "test-extension-1" }
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "invalid_request");
});
