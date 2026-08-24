import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { AttestedRuntimePinCoordinator } from "../src/runtime-provisioning.ts";
import { DurableRepositoryRuntimeRegistry } from "../src/runtime-registry.ts";

async function fixture(verified = true) {
  const root = await mkdtemp(join(tmpdir(), "b122-runtime-provision-"));
  const manifestPath = join(root, "runtime.json");
  await writeFile(manifestPath, JSON.stringify({
    schema: "sxsy-b122.repository-runtime",
    version: 1,
    repositoryRoot: root,
    allowedHttpsUrls: [],
    recipes: {}
  }), "utf8");
  const registry = new DurableRepositoryRuntimeRegistry(new ProtectedJsonStore({ filePath: join(root, "journal.jsonl") }), { now: () => "2026-08-24T12:00:00.000Z" });
  const prompts: string[] = [];
  const coordinator = new AttestedRuntimePinCoordinator(registry, {
    async verify(prompt) { prompts.push(prompt); return verified ? { verified: true, operator: "HOST\\operator" } : { verified: false }; }
  }, () => new Date("2026-08-24T12:00:00.000Z"));
  return { root, manifestPath, registry, coordinator, prompts };
}

test("runtime provisioning computes the host digest and requires current-user presence", async () => {
  const { root, manifestPath, coordinator, prompts } = await fixture();
  const pin = await coordinator.install({ repositoryRoot: root, manifestPath });
  assert.equal(pin.status, "active");
  assert.match(pin.expectedSha256, /^[a-f0-9]{64}$/);
  assert.equal(prompts.length, 1);
  assert.equal((await coordinator.list()).length, 1);
  assert.equal((await coordinator.revoke(root)).status, "revoked");
});

test("runtime provisioning cannot accept client-supplied approval or a relative path", async () => {
  const denied = await fixture(false);
  await assert.rejects(() => denied.coordinator.install({ repositoryRoot: denied.root, manifestPath: denied.manifestPath }), /presence/i);
  await assert.rejects(() => denied.coordinator.install({ repositoryRoot: denied.root, manifestPath: "runtime.json" }), /absolute/i);
  assert.equal((await denied.registry.list()).length, 0);
});
