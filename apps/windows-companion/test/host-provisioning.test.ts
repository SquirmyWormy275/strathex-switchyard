import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore, sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { companionBridgeVersion } from "../src/bridge.ts";
import { InstalledCouncilResourceBroker, type CouncilConfiguredNetworkFactory } from "../src/council-resource-broker.ts";
import { CouncilResourceHost, VaultBackedCouncilCredentialCapabilityPort, type CouncilResourceHostBinding, type CouncilResourceHostRequest } from "../src/council-resource-host.ts";
import type { CouncilIsolationPlan, CouncilResourceLease, CouncilWorkspaceBinding } from "../src/council-workspace-isolation.ts";
import { DurableCredentialReferenceVault } from "../src/durable-credentials.ts";
import { AttestedCredentialProvisioningCoordinator, AttestedNetworkPolicyCoordinator, DurableNetworkPolicyRegistry } from "../src/host-provisioning.ts";
import { CompanionService } from "../src/service.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";

class TrackingProvisioningProtector extends FakeUserSecretProtector {
  readonly opened: Uint8Array[] = [];
  override async open(sealed: string): Promise<Uint8Array> {
    const value = await super.open(sealed);
    this.opened.push(value);
    return value;
  }
}

test("credential provisioning attests and durably records only the exact submitted scope triples", async () => {
  const root = await mkdtemp(join(tmpdir(), "b122-host-provision-"));
  const protector = new TrackingProvisioningProtector();
  const store = new ProtectedJsonStore({ filePath: join(root, "journal.jsonl") });
  const vault = new DurableCredentialReferenceVault(store, protector, { async check() { return { allowed: true, reason: "test" }; } });
  const prompts: string[] = [];
  const coordinator = new AttestedCredentialProvisioningCoordinator(vault, protector, { async verify(prompt) { prompts.push(prompt); return { verified: true, operator: "HOST\\operator" }; } });
  const clear = Buffer.from("secret-value", "utf8");
  const sealedSecret = await protector.seal(clear);
  clear.fill(0);
  const scopes = [
    { repositoryRoot: root, adapterId: "configured-network", purpose: "provider-api" },
    { repositoryRoot: root, adapterId: "council-resource-host", purpose: "council-session" }
  ] as const;
  const summary = await coordinator.provision({ reference: "provider-read", scopes, sealedSecret });
  assert.equal(protector.opened.length, 1);
  assert.equal(protector.opened[0]?.every((byte) => byte === 0), true);
  const expectedRoot = process.platform === "win32" ? root.replaceAll("\\", "/").toLowerCase() : root.replaceAll("\\", "/");
  assert.equal(summary.reference, "provider-read");
  assert.deepEqual(summary.scopes, scopes.map((scope) => ({ ...scope, repositoryRoot: expectedRoot })));
  assert.match(prompts[0]!, /configured-network\/provider-api/);
  assert.match(prompts[0]!, /council-resource-host\/council-session/);
  assert.equal(prompts[0]!.includes(expectedRoot), true);
  const durableReceipt = JSON.stringify(await store.readEntries());
  assert.equal(durableReceipt.includes("secret-value"), false);
  assert.equal(durableReceipt.includes("configured-network"), true);
  assert.equal(durableReceipt.includes("provider-api"), true);
  assert.equal(durableReceipt.includes("council-resource-host"), true);
  assert.equal(durableReceipt.includes("council-session"), true);
  await assert.rejects(coordinator.provision({ reference: "extra-field", scopes, sealedSecret, unexpected: true } as never), /fields/i);
  await assert.rejects(coordinator.provision({ reference: "extra-scope-field", scopes: [{ ...scopes[0], inferred: true }], sealedSecret } as never), /scope/i);
  assert.equal(prompts.length, 1);

  const service = new CompanionService({ credentialProvisioning: coordinator });
  const legacy = await service.handle({
    version: companionBridgeVersion,
    id: "legacy-purpose-only",
    method: "credential.provision",
    payload: { reference: "legacy", repositoryRoot: root, purposes: ["provider-api"], sealedSecret }
  });
  assert.equal(legacy.ok, false);
  assert.equal(legacy.error?.code, "invalid_request");
  assert.equal(prompts.length, 1);
});

test("attested exact scopes drive real vault adapters and the Council provider.health operation without broadening", async (context) => {
  const base = await mkdtemp(join(tmpdir(), "b122-host-provision-council-"));
  context.after(async () => { await rm(base, { recursive: true, force: true }); });
  const repository = join(base, "repository");
  const stateRoot = join(base, "state", "council-isolation");
  const worktreeRoot = join(stateRoot, "worktree");
  await mkdir(repository, { recursive: true });
  await mkdir(worktreeRoot, { recursive: true });
  const canonicalRepository = await realpath(repository);
  const canonicalStateRoot = await realpath(stateRoot);
  const protector = new FakeUserSecretProtector();
  const store = new ProtectedJsonStore({ filePath: join(base, "protected-journal.jsonl") });
  const vault = new DurableCredentialReferenceVault(store, protector, { async check() { return { allowed: true, reason: "exact-scope test" }; } });
  const coordinator = new AttestedCredentialProvisioningCoordinator(vault, protector, { async verify() { return { verified: true, operator: "HOST\\operator" }; } });
  const clear = Buffer.from("provider-secret-never-emitted", "utf8");
  const sealedSecret = await protector.seal(clear);
  clear.fill(0);
  await coordinator.provision({
    reference: "provider-read",
    scopes: [
      { repositoryRoot: canonicalRepository, adapterId: "configured-network", purpose: "provider-api" },
      { repositoryRoot: canonicalRepository, adapterId: "council-resource-host", purpose: "council-session" }
    ],
    sealedSecret
  });

  const direct = vault.createAdapter("configured-network");
  assert.equal(await direct.withCredential({ reference: "provider-read", repositoryRoot: canonicalRepository, purpose: "provider-api" }, async (value) => Buffer.from(value).toString("utf8")), "provider-secret-never-emitted");
  await assert.rejects(direct.acquireLease({ reference: "provider-read", repositoryRoot: canonicalRepository, purpose: "council-session" }), /scope/i);
  await assert.rejects(vault.createAdapter("council-resource-host").acquireLease({ reference: "provider-read", repositoryRoot: canonicalRepository, purpose: "provider-api" }), /scope/i);
  await assert.rejects(vault.createAdapter("configured-network").acquireLease({ reference: "provider-read", repositoryRoot: join(base, "other-repository"), purpose: "provider-api" }), /scope/i);

  const request: CouncilResourceHostRequest = {
    epochId: "credential-epoch",
    targetSnapshotId: "a".repeat(64),
    repositoryRoot: canonicalRepository,
    stateRoot: canonicalStateRoot,
    sessionId: "credential-participant",
    worktreeRoot,
    branch: "sxsy-b122/council/credential-epoch/credential-participant",
    head: "b".repeat(40),
    leases: [{ id: "credential-lease", kind: "credential_scope", declaration: "credential-scope:provider-read@provider.health", fence: 3, status: "active" }]
  };
  const host = new CouncilResourceHost({
    stateRoot: canonicalStateRoot,
    credentials: new VaultBackedCouncilCredentialCapabilityPort(vault.createAdapter("council-resource-host"), () => "credential-capability")
  });
  const resourceHost = await host.materialize(request);
  const plan = councilPlan(request, resourceHost);
  const resource = resourceHost.resources[0]!;
  const observed: string[] = [];
  const networkFactory: CouncilConfiguredNetworkFactory = (_policy, _containment, credentials) => ({
    async request(input) {
      return credentials.withCredential({ reference: "provider-read", repositoryRoot: input.repositoryRoot, purpose: "provider-api" }, async (value) => {
        observed.push(Buffer.from(value).toString("utf8"));
        return { outcome: "passed", routeId: input.routeId, detail: "Provider health passed.", effectDisposition: "ambiguous", status: 200, body: new Uint8Array() };
      });
    }
  });
  const policy = {
    version: 1 as const,
    proxy: "direct" as const,
    routes: [{
      id: "provider.health",
      method: "GET",
      url: "https://127.0.0.1:9443/v1/b122/health",
      credential: { reference: "provider-read", purpose: "provider-api", header: "authorization", prefix: "Bearer " },
      redirects: "deny" as const,
      boundary: "provider-host-loopback" as const,
      tlsSpkiSha256: "c".repeat(64),
      tlsCaCertificatePem: "-----BEGIN CERTIFICATE-----\nQQ==\n-----END CERTIFICATE-----\n"
    }]
  };
  const broker = new InstalledCouncilResourceBroker(
    { async assertCurrent(epochId) { assert.equal(epochId, plan.epochId); return plan; } },
    host,
    { async resolve() { return policy; } },
    { async check() { return { allowed: true, reason: "exact-scope test" }; } },
    networkFactory
  );
  const receipt = await broker.credentialNetwork({
    epochId: plan.epochId,
    sessionId: request.sessionId,
    targetSnapshotId: plan.targetSnapshotId,
    leaseId: "credential-lease",
    operationId: "provider-health-operation",
    fenceDigest: resourceHost.fenceDigest,
    resourceHostDigest: resourceHost.digest,
    capabilityId: resource.value,
    routeId: "provider.health"
  });
  assert.equal(receipt.outcome, "passed");
  assert.deepEqual(observed, ["provider-secret-never-emitted"]);
  assert.equal(JSON.stringify(receipt).includes("provider-secret-never-emitted"), false);
  await host.cleanup(request, resourceHost);
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

function councilPlan(request: CouncilResourceHostRequest, resourceHost: CouncilResourceHostBinding): CouncilIsolationPlan {
  const at = "2026-08-25T12:00:00.000Z";
  const leases: CouncilResourceLease[] = request.leases.map((lease) => ({
    id: lease.id,
    epochId: request.epochId,
    sessionId: request.sessionId,
    kind: lease.kind,
    resource: lease.declaration ?? lease.localPath ?? lease.id,
    ...(lease.declaration ? { declaration: lease.declaration } : {}),
    ...(lease.localPath ? { localPath: lease.localPath } : {}),
    fence: lease.fence,
    acquiredAt: at,
    status: lease.status
  }));
  const binding: CouncilWorkspaceBinding = {
    sessionId: request.sessionId,
    paths: [],
    declarations: request.leases.flatMap((lease) => lease.declaration ? [lease.declaration] : []),
    worktreeRoot: request.worktreeRoot,
    branch: request.branch,
    head: request.head,
    leases,
    resourceHost,
    assignmentDigest: sha256(stableJson({ sessionId: request.sessionId, leases, resourceHost }))
  };
  const unsigned = {
    epochId: request.epochId,
    targetSnapshotId: request.targetSnapshotId,
    repositoryRoot: request.repositoryRoot,
    targetHead: request.head,
    defaultBranch: "main",
    stateRoot: request.stateRoot,
    bindings: [binding],
    status: "prepared" as const,
    executionAuthorized: false as const,
    createdAt: at,
    updatedAt: at
  };
  return { ...unsigned, digest: sha256(stableJson(unsigned)) };
}
