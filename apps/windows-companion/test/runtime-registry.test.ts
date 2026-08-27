import assert from "node:assert/strict";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { computeRepositoryRuntimeManifestDigest, RepositoryRuntime, type RepositoryProcessSupervisor } from "../src/repository-runtime.ts";
import { DurableRepositoryRuntimeRegistry } from "../src/runtime-registry.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "b122-runtime-registry-"));
  const manifestPath = join(root, "runtime.json");
  const manifest = JSON.stringify({
    schema: "sxsy-b122.repository-runtime",
    version: 1,
    repositoryRoot: root,
    allowedHttpsUrls: [],
    recipes: {
      run_target: {
        kind: "process",
        executable: process.execPath,
        args: ["--version"],
        cwd: ".",
        environment: {},
        lifecycle: "managed",
        isolation: "repository",
        timeoutMs: 5_000,
        maxOutputBytes: 8_192
      }
    }
  });
  await writeFile(manifestPath, manifest, "utf8");
  const store = new ProtectedJsonStore({ filePath: join(root, "protected.jsonl") });
  return { root, manifestPath, manifest, store };
}

test("durable runtime pins are verified before install and resolve by canonical repository identity", async () => {
  const { root, manifestPath, manifest, store } = await fixture();
  const registry = new DurableRepositoryRuntimeRegistry(store);

  const installed = await registry.install({
    repositoryRoot: root,
    manifestPath,
    expectedSha256: computeRepositoryRuntimeManifestDigest(manifest),
    attestation: { method: "windows-user-presence", at: new Date().toISOString() }
  });

  assert.equal(installed.canonicalRepositoryRoot, await realpath(root));
  assert.equal(installed.status, "active");
  assert.ok(await registry.resolve(root) instanceof RepositoryRuntime);
  assert.equal((await registry.list()).length, 1);
  assert.deepEqual(await registry.recoverManagedProcesses(), []);
});

test("changed manifests and revoked pins fail closed", async () => {
  const { root, manifestPath, manifest, store } = await fixture();
  const registry = new DurableRepositoryRuntimeRegistry(store);
  await registry.install({
    repositoryRoot: root,
    manifestPath,
    expectedSha256: computeRepositoryRuntimeManifestDigest(manifest),
    attestation: { method: "windows-user-presence", at: new Date().toISOString() }
  });

  await writeFile(manifestPath, `${manifest}\n`, "utf8");
  await assert.rejects(() => registry.resolve(root), /digest/i);

  await writeFile(manifestPath, manifest, "utf8");
  await registry.revoke(root, { method: "windows-user-presence", at: new Date().toISOString() });
  await assert.rejects(() => registry.resolve(root), /no active.*pin/i);
  assert.equal((await registry.list())[0]?.status, "revoked");
});

test("runtime pin installation rejects missing operator presence and root mismatch", async () => {
  const { root, manifestPath, manifest, store } = await fixture();
  const other = await mkdtemp(join(tmpdir(), "b122-runtime-other-"));
  const registry = new DurableRepositoryRuntimeRegistry(store);

  await assert.rejects(() => registry.install({
    repositoryRoot: root,
    manifestPath,
    expectedSha256: computeRepositoryRuntimeManifestDigest(manifest),
    attestation: { method: "none", at: new Date().toISOString() }
  }), /user-presence/i);

  await assert.rejects(() => registry.install({
    repositoryRoot: other,
    manifestPath,
    expectedSha256: computeRepositoryRuntimeManifestDigest(manifest),
    attestation: { method: "windows-user-presence", at: new Date().toISOString() }
  }), /root/i);
});

test("registry preserves one exact rich terminal observation and does not collapse not-owner into terminal", async () => {
  const { root, manifestPath, manifest, store } = await fixture();
  const targetSnapshotId = "c".repeat(64);
  const processSupervisor: RepositoryProcessSupervisor = {
    async start() { throw new Error("not used"); },
    async recover() { return []; },
    async observeOperation(input) {
      if (input.operationId !== "operation-registry-terminal") return { state: "not_owner", operationId: input.operationId, summary: "not owned" };
      return {
        state: "terminal", operationId: input.operationId, action: input.action, targetSnapshotId: input.targetSnapshotId,
        repositoryRoot: input.repositoryRoot, status: "completed", effectDisposition: "committed", summary: "exact terminal process",
        evidenceDigest: "d".repeat(64), toolVersions: { repositorySupervisor: "registry-test-v1" }
      };
    }
  };
  const registry = new DurableRepositoryRuntimeRegistry(store, { processSupervisor });
  await registry.install({
    repositoryRoot: root,
    manifestPath,
    expectedSha256: computeRepositoryRuntimeManifestDigest(manifest),
    attestation: { method: "windows-user-presence", at: new Date().toISOString() }
  });

  const binding = { operationId: "operation-registry-terminal", action: "run_target" as const, targetSnapshotId, repositoryRoot: await realpath(root) };
  assert.deepEqual(await registry.reconcileOperation(binding), {
    state: "terminal", ...binding, status: "completed", effectDisposition: "committed", summary: "exact terminal process",
    evidenceDigest: "d".repeat(64), toolVersions: { repositorySupervisor: "registry-test-v1" }
  });
  assert.equal((await registry.reconcileOperation({ ...binding, operationId: "not-owned" })).state, "not_owner");
});

test("one poisoned runtime pin cannot block healthy recovery, cancellation, or reconciliation", async () => {
  const healthy = await fixture();
  const poisonedRoot = await mkdtemp(join(tmpdir(), "b122-runtime-poisoned-"));
  const poisonedManifestPath = join(poisonedRoot, "runtime.json");
  const poisonedManifest = JSON.stringify({ ...(JSON.parse(healthy.manifest) as Record<string, unknown>), repositoryRoot: poisonedRoot });
  await writeFile(poisonedManifestPath, poisonedManifest, "utf8");
  const recoveredRoots: string[] = [];
  const cancelledOperations: string[] = [];
  const processSupervisor: RepositoryProcessSupervisor = {
    async start() { throw new Error("not used"); },
    async recover(scope) { recoveredRoots.push(await realpath(scope.repositoryRoot)); return []; },
    async observeOperation(input) {
      return {
        state: "terminal", operationId: input.operationId, action: input.action, targetSnapshotId: input.targetSnapshotId,
        sessionId: input.sessionId, authorityId: input.authorityId, repositoryRoot: input.repositoryRoot,
        status: "completed", effectDisposition: "committed", summary: "healthy exact terminal"
      };
    }
  };
  const registry = new DurableRepositoryRuntimeRegistry(healthy.store, { processSupervisor });
  for (const input of [
    { root: healthy.root, manifestPath: healthy.manifestPath, manifest: healthy.manifest },
    { root: poisonedRoot, manifestPath: poisonedManifestPath, manifest: poisonedManifest }
  ]) {
    await registry.install({
      repositoryRoot: input.root,
      manifestPath: input.manifestPath,
      expectedSha256: computeRepositoryRuntimeManifestDigest(input.manifest),
      attestation: { method: "windows-user-presence", at: new Date().toISOString() }
    });
  }
  const healthyRuntime = await registry.resolve(healthy.root);
  const originalCancel = healthyRuntime.cancelOperation.bind(healthyRuntime);
  healthyRuntime.cancelOperation = async (operationId) => { cancelledOperations.push(operationId); return originalCancel(operationId); };
  await writeFile(poisonedManifestPath, `${poisonedManifest}\n`, "utf8");

  assert.deepEqual(await registry.recoverManagedProcesses(), [], "startup recovery must continue through every healthy pin");
  assert.deepEqual(recoveredRoots, [await realpath(healthy.root)]);
  assert.equal(await registry.cancelOperation("operation-healthy", "operator cancellation"), 0);
  assert.deepEqual(cancelledOperations, ["operation-healthy"], "healthy cancellation delivery must occur even when another pin is invalid");

  const exact = {
    operationId: "operation-healthy", action: "run_target" as const, targetSnapshotId: "a".repeat(64),
    sessionId: "session-healthy", authorityId: "authority-healthy", repositoryRoot: await realpath(healthy.root)
  };
  assert.equal((await registry.reconcileOperation(exact)).state, "terminal");
  const poisoned = await registry.reconcileOperation({ ...exact, operationId: "operation-poisoned", repositoryRoot: await realpath(poisonedRoot) });
  assert.equal(poisoned.state, "active", "the invalid target pin must remain an explicit ambiguous owner, never disappear as not-owner");
  assert.equal(poisoned.effectDisposition, "ambiguous");
  assert.match(poisoned.summary, /pin|manifest|invalid|ambiguous|could not prove/i);
});
