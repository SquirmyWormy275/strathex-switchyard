import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { AttestedSandboxInstallationCoordinator, DurableSandboxInstallationRegistry } from "../src/sandbox-installation.ts";

async function fixture(approved = true) {
  const root = await mkdtemp(join(tmpdir(), "b122-sandbox-install-"));
  const tools = join(root, "host-tools");
  const repository = join(root, "repository");
  await Promise.all([mkdir(tools), mkdir(repository)]);
  const helperPath = join(tools, "b122-sandbox-worker.exe");
  const catalogPath = join(repository, "sandbox-catalog.json");
  await writeFile(helperPath, "fixed helper", "utf8");
  await writeFile(catalogPath, JSON.stringify({ schema: "sxsy-b122.windows-sandbox-catalog", version: 1, recipes: [{ id: "full_sandbox", executable: "C:\\tools\\runner.exe", executableSha256: "a".repeat(64), arguments: [], workingRoot: "work", workingDirectory: ".", environment: {}, timeoutMs: 1000, maxOutputBytes: 1024, artifacts: [] }] }), "utf8");
  const now = "2026-08-24T12:00:00.000Z";
  const registry = new DurableSandboxInstallationRegistry(new ProtectedJsonStore({ filePath: join(root, "journal.jsonl") }), helperPath, () => now);
  const coordinator = new AttestedSandboxInstallationCoordinator(registry, helperPath, { async verify() { return approved ? { verified: true, operator: "HOST\\operator" } : { verified: false }; } }, () => new Date(now));
  return { root, repository, helperPath, catalogPath, registry, coordinator };
}

test("sandbox installation durably binds exact catalog and fixed helper bytes", async () => {
  const setup = await fixture();
  const installed = await setup.coordinator.install({ repositoryRoot: setup.repository, catalogPath: setup.catalogPath });
  assert.equal(installed.status, "active");
  assert.match(installed.catalogSha256, /^[a-f0-9]{64}$/);
  assert.match(installed.helperSha256, /^[a-f0-9]{64}$/);
  assert.equal((await setup.registry.resolve(setup.repository)).status, "active");
  await writeFile(setup.helperPath, "changed helper", "utf8");
  await assert.rejects(() => setup.registry.resolve(setup.repository), /helper changed/i);
});

test("sandbox installation rejects absent presence and catalogs outside the selected repository", async () => {
  const denied = await fixture(false);
  await assert.rejects(() => denied.coordinator.install({ repositoryRoot: denied.repository, catalogPath: denied.catalogPath }), /presence/i);
  const allowed = await fixture(true);
  await assert.rejects(() => allowed.coordinator.install({ repositoryRoot: allowed.repository, catalogPath: allowed.helperPath }), /catalog|schema|inside/i);
  assert.equal((await denied.registry.list()).length, 0);
});
