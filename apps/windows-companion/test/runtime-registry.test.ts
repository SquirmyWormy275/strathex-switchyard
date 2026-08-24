import assert from "node:assert/strict";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { computeRepositoryRuntimeManifestDigest, RepositoryRuntime } from "../src/repository-runtime.ts";
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
