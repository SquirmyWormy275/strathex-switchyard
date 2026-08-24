import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { DurableCredentialReferenceVault } from "../src/durable-credentials.ts";
import { AttestedCredentialProvisioningCoordinator, AttestedNetworkPolicyCoordinator, DurableNetworkPolicyRegistry } from "../src/host-provisioning.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";

test("credential provisioning opens only a DPAPI-style sealed input and stores a purpose-scoped reference", async () => {
  const root = await mkdtemp(join(tmpdir(), "b122-host-provision-"));
  const protector = new FakeUserSecretProtector();
  const store = new ProtectedJsonStore({ filePath: join(root, "journal.jsonl") });
  const vault = new DurableCredentialReferenceVault(store, protector, { async check() { return { allowed: true, reason: "test" }; } });
  const coordinator = new AttestedCredentialProvisioningCoordinator(vault, protector, { async verify() { return { verified: true, operator: "HOST\\operator" }; } });
  const clear = Buffer.from("secret-value", "utf8");
  const sealedSecret = await protector.seal(clear);
  clear.fill(0);
  const summary = await coordinator.provision({ reference: "github-token", repositoryRoot: root, purposes: ["github-api"], sealedSecret });
  assert.equal(summary.reference, "github-token");
  assert.deepEqual(summary.scopes.map((scope) => [scope.adapterId, scope.purpose]), [["configured-network", "github-api"]]);
  assert.equal(JSON.stringify(await store.readEntries()).includes("secret-value"), false);
});

test("network policy installation is atomic, attested, and digest-rechecked on every resolve", async () => {
  const root = await mkdtemp(join(tmpdir(), "b122-network-provision-"));
  const source = join(root, "source.json");
  const installed = join(root, "installed", "network-policy.json");
  const policy = { version: 1, proxy: "direct", routes: [{ id: "github.graphql", method: "POST", url: "https://api.github.com/graphql", staticHeaders: { accept: "application/vnd.github+json" }, timeoutMs: 10_000, maxRequestBytes: 262_144, maxResponseBytes: 524_288, redirects: "deny" }] };
  await writeFile(source, JSON.stringify(policy), "utf8");
  const now = "2026-08-24T12:00:00.000Z";
  const registry = new DurableNetworkPolicyRegistry(new ProtectedJsonStore({ filePath: join(root, "journal.jsonl") }), installed, () => now);
  const coordinator = new AttestedNetworkPolicyCoordinator(registry, { async verify() { return { verified: true, operator: "HOST\\operator" }; } }, () => new Date(now));
  const pin = await coordinator.install(source);
  assert.equal(pin.status, "active");
  assert.equal((await registry.resolve()).routes[0]?.id, "github.graphql");
  await writeFile(installed, JSON.stringify({ ...policy, routes: [] }), "utf8");
  await assert.rejects(() => registry.resolve(), /changed/i);
});
