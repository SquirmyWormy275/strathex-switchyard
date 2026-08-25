import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore, sha256, stableJson, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { AuthenticatedPipeClient, AuthenticatedPipeServer, createPipeConfiguration } from "../src/authenticated-pipe.ts";
import { InstalledCouncilParticipantClient } from "../src/council-participant-client.ts";
import { createDurableWindowsCompanion } from "../src/bootstrap.ts";
import {
  InstalledCouncilResourceBroker,
  type CouncilConfiguredNetworkFactory
} from "../src/council-resource-broker.ts";
import {
  CouncilResourceHost,
  CouncilResourceHostError,
  VaultBackedCouncilCredentialCapabilityPort,
  type CouncilCredentialOperationPort,
  type CouncilResourceHostRequest
} from "../src/council-resource-host.ts";
import type { CredentialAdapterPort } from "../src/durable-credentials.ts";
import { CompanionService } from "../src/service.ts";
import type { CouncilIsolationPlan, CouncilResourceLease, CouncilWorkspaceBinding } from "../src/council-workspace-isolation.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";

const isolatedAuthenticator: JournalAuthenticator = {
  provider: "isolated-council-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

function git(root: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("git", [...args], { cwd: root, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", rejectRun);
    child.once("close", (code) => code === 0 ? resolveRun(stdout.trim()) : rejectRun(new Error(stderr || `git ${args[0]} failed`)));
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function fixture(): Promise<Readonly<{ base: string; stateDirectory: string; stateRoot: string; request: CouncilResourceHostRequest }>> {
  const base = await mkdtemp(join(tmpdir(), "b122-council-resource-broker-"));
  const stateDirectory = join(base, "state");
  const stateRoot = join(stateDirectory, "council-isolation");
  const repositoryRoot = join(base, "repository");
  const worktreeRoot = join(stateRoot, "worktree");
  await mkdir(stateRoot, { recursive: true });
  await mkdir(repositoryRoot);
  await mkdir(worktreeRoot);
  const canonicalStateRoot = await realpath(stateRoot);
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const port = await freePort();
  return {
    base,
    stateDirectory,
    stateRoot: canonicalStateRoot,
    request: {
      epochId: "epoch-one",
      targetSnapshotId: "a".repeat(64),
      repositoryRoot: canonicalRepositoryRoot,
      stateRoot: canonicalStateRoot,
      sessionId: "agent-one",
      worktreeRoot,
      branch: "sxsy-b122/council/epoch-one/agent-one",
      head: "b".repeat(40),
      leases: [
        { id: "port-lease", kind: "port", declaration: `port:${port}`, fence: 7, status: "active" },
        { id: "credential-lease", kind: "credential_scope", declaration: "credential-scope:provider-read@provider.health", fence: 11, status: "active" }
      ]
    }
  };
}

function planFor(request: CouncilResourceHostRequest, resourceHost: Awaited<ReturnType<CouncilResourceHost["materialize"]>>): CouncilIsolationPlan {
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

function connect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("error", reject);
    socket.once("connect", () => { socket.removeListener("error", reject); resolve(socket); });
  });
}

function oneChunk(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    socket.once("data", resolve);
    socket.once("error", reject);
  });
}

function oneLine(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer): void => {
      value += chunk.toString("utf8");
      const newline = value.indexOf("\n");
      if (newline < 0) return;
      socket.removeListener("data", onData);
      resolve(value.slice(0, newline));
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.once("close", () => { if (!value.includes("\n")) reject(new Error("socket closed before a line")); });
  });
}

test("Council keeps the leased port while an exact one-shot activation installs a usable host-owned proxy", async () => {
  const context = await fixture();
  const backend = createServer((socket) => socket.pipe(socket));
  let thief: ReturnType<typeof createServer> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { backend.once("error", reject); backend.listen(0, "127.0.0.1", resolve); });
    const backendAddress = backend.address();
    assert.ok(backendAddress && typeof backendAddress !== "string");
    const host = new CouncilResourceHost({ stateRoot: context.stateRoot });
    const binding = await host.materialize({ ...context.request, leases: [context.request.leases[0]!] });
    await host.activatePortProxy({ ...context.request, leases: [context.request.leases[0]!] }, binding, {
      leaseId: "port-lease",
      activationId: "operation-port-proxy",
      connectBackend: () => connect(backendAddress.port)
    });

    const leasedPort = Number(context.request.leases[0]!.declaration!.slice("port:".length));
    const client = await connect(leasedPort);
    client.write("fenced-through-host");
    assert.equal((await oneChunk(client)).toString("utf8"), "fenced-through-host");
    client.destroy();

    await host.activatePortProxy({ ...context.request, leases: [context.request.leases[0]!] }, binding, {
      leaseId: "port-lease",
      activationId: "operation-port-proxy",
      connectBackend: () => { throw new Error("idempotent replay must not replace the installed backend"); }
    });
    await assert.rejects(host.activatePortProxy({ ...context.request, leases: [context.request.leases[0]!] }, binding, {
      leaseId: "port-lease",
      activationId: "different-operation",
      connectBackend: () => connect(backendAddress.port)
    }), /already activated|replay|operation/i);
    await assert.rejects(host.activatePortProxy({ ...context.request, sessionId: "stolen-session", leases: [context.request.leases[0]!] }, binding, {
      leaseId: "port-lease",
      activationId: "operation-port-proxy",
      connectBackend: () => connect(backendAddress.port)
    }), /session|binding|fence/i);

    thief = createServer();
    await assert.rejects(new Promise<void>((resolve, reject) => {
      thief!.once("error", reject);
      thief!.listen(leasedPort, "127.0.0.1", resolve);
    }), /EADDRINUSE|address.*use/i);

    await host.assertOperational({ ...context.request, leases: [context.request.leases[0]!] }, binding);
    await new Promise<void>((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()));
    await assert.rejects(host.assertOperational({ ...context.request, leases: [context.request.leases[0]!] }, binding), /backend|proxy|operational|unavailable/i);
    await host.cleanup({ ...context.request, leases: [context.request.leases[0]!] }, binding);
    const reusable = createServer();
    await new Promise<void>((resolve, reject) => { reusable.once("error", reject); reusable.listen(leasedPort, "127.0.0.1", resolve); });
    await new Promise<void>((resolve, reject) => reusable.close((error) => error ? reject(error) : resolve()));
  } finally {
    if (thief?.listening) await new Promise<void>((resolve) => thief!.close(() => resolve()));
    if (backend.listening) await new Promise<void>((resolve) => backend.close(() => resolve()));
    await rm(context.base, { recursive: true, force: true });
  }
});

test("Council credential use is host-only, exact-target fenced, single-use, and replay-safe", async () => {
  const context = await fixture();
  const secret = Buffer.from("credential-secret-never-returned", "utf8");
  let redemptions = 0;
  const adapter: CredentialAdapterPort = {
    async acquireLease() { return { id: "vault-lease", expiresAt: Date.now() + 60_000 }; },
    async redeem(_lease, consume) { redemptions += 1; return consume(new Uint8Array(secret)); },
    async withCredential(request, consume) { return this.redeem(await this.acquireLease(request), consume); }
  };
  const credentials = new VaultBackedCouncilCredentialCapabilityPort(adapter, () => "credential-capability-id");
  const host = new CouncilResourceHost({ stateRoot: context.stateRoot, credentials });
  const request = { ...context.request, leases: [context.request.leases[1]!] };
  try {
    const binding = await host.materialize(request);
    const observed: string[] = [];
    const operation: CouncilCredentialOperationPort = {
      async perform(input, cleartext) {
        observed.push(`${input.epochId}:${input.sessionId}:${input.leaseId}:${input.fence}:${input.operationId}:${Buffer.from(cleartext).toString("utf8")}`);
        return { outcome: "passed", summary: "Exact provider-read operation completed." };
      }
    };
    const receipt = await host.performCredentialOperation(request, binding, { leaseId: "credential-lease", operationId: "credential-operation-one" }, operation);
    assert.equal(receipt.outcome, "passed");
    assert.match(receipt.digest, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(receipt).includes("credential-secret"), false);
    assert.deepEqual(observed, [`epoch-one:agent-one:credential-lease:11:credential-operation-one:${secret.toString("utf8")}`]);
    await host.assertCurrent(request, binding);

    const replayed = await host.performCredentialOperation(request, binding, { leaseId: "credential-lease", operationId: "credential-operation-one" }, {
      async perform() { throw new Error("idempotent replay must not redeem or execute again"); }
    });
    assert.deepEqual(replayed, receipt);
    assert.equal(redemptions, 1);
    await assert.rejects(host.performCredentialOperation(request, binding, { leaseId: "credential-lease", operationId: "credential-operation-two" }, operation), /expired|revoked|single-use|capability|host-only broker|operation failed/i);
    await assert.rejects(host.performCredentialOperation({ ...request, targetSnapshotId: "c".repeat(64) }, binding, { leaseId: "credential-lease", operationId: "credential-operation-three" }, operation), /target|binding|fence/i);
    await assert.rejects(host.performCredentialOperation({ ...request, sessionId: "agent-two" }, binding, { leaseId: "credential-lease", operationId: "credential-operation-four" }, operation), /session|binding|fence/i);
    await host.cleanup(request, binding);
    await assert.rejects(host.performCredentialOperation(request, binding, { leaseId: "credential-lease", operationId: "credential-operation-one" }, operation), /current|clean|released|binding|capability/i);
  } finally {
    secret.fill(0);
    await host.shutdownForRestart();
    await rm(context.base, { recursive: true, force: true });
  }
});

test("Council credential broker redacts a trusted consumer failure", async () => {
  const context = await fixture();
  const adapter: CredentialAdapterPort = {
    async acquireLease() { return { id: "vault-lease", expiresAt: Date.now() + 60_000 }; },
    async redeem(_lease, consume) { return consume(new TextEncoder().encode("do-not-leak")); },
    async withCredential(request, consume) { return this.redeem(await this.acquireLease(request), consume); }
  };
  const host = new CouncilResourceHost({ stateRoot: context.stateRoot, credentials: new VaultBackedCouncilCredentialCapabilityPort(adapter) });
  const request = { ...context.request, leases: [context.request.leases[1]!] };
  try {
    const binding = await host.materialize(request);
    await assert.rejects(host.performCredentialOperation(request, binding, { leaseId: "credential-lease", operationId: "credential-failure" }, {
      async perform(_input, cleartext) { throw new Error(`provider logged ${Buffer.from(cleartext).toString("utf8")}`); }
    }), (error: unknown) => {
      assert.ok(error instanceof CouncilResourceHostError);
      assert.equal(error.message.includes("do-not-leak"), false);
      assert.match(error.message, /credential operation failed/i);
      return true;
    });
  } finally {
    await host.shutdownForRestart();
    await rm(context.base, { recursive: true, force: true });
  }
});

test("installed Council participant client reaches both fenced resource paths through authenticated IPC and leaves no live proxy", async () => {
  const context = await fixture();
  const secret = Buffer.from("installed-council-secret", "utf8");
  let redemptions = 0;
  let backend: Awaited<ReturnType<InstalledCouncilParticipantClient["openPortProxy"]>> | undefined;
  let pipe: AuthenticatedPipeServer | undefined;
  const credentials: CredentialAdapterPort = {
    async acquireLease() { return { id: "installed-vault-lease", expiresAt: Date.now() + 60_000 }; },
    async redeem(_lease, consume) { redemptions += 1; return consume(new Uint8Array(secret)); },
    async withCredential(request, consume) { return this.redeem(await this.acquireLease(request), consume); }
  };
  const host = new CouncilResourceHost({
    stateRoot: context.stateRoot,
    credentials: new VaultBackedCouncilCredentialCapabilityPort(credentials, () => "installed-capability")
  });
  try {
    const resourceHost = await host.materialize(context.request);
    const plan = planFor(context.request, resourceHost);
    const credentialResource = resourceHost.resources.find((resource) => resource.kind === "credential_scope");
    const portResource = resourceHost.resources.find((resource) => resource.kind === "port");
    assert.ok(credentialResource && portResource);
    const observedSecrets: string[] = [];
    let networkConstructions = 0;
    const networkFactory: CouncilConfiguredNetworkFactory = (_policy, _containment, adapter) => {
      networkConstructions += 1;
      return ({
      async request(input) {
        return adapter!.withCredential({
          reference: "provider-read",
          repositoryRoot: input.repositoryRoot,
          purpose: "provider-api"
        }, async (cleartext) => {
          observedSecrets.push(Buffer.from(cleartext).toString("utf8"));
          return {
            outcome: "passed" as const,
            routeId: input.routeId,
            detail: "Installed credential-free fixture route completed.",
            effectDisposition: "ambiguous" as const,
            status: 200,
            body: new Uint8Array()
          };
        });
      }
      });
    };
    const policy = {
      version: 1 as const,
      proxy: "direct" as const,
      routes: [{
        id: "provider.health",
        method: "GET",
        url: "https://127.0.0.1:9443/v1/b122/health",
        credential: { reference: "provider-read", purpose: "provider-api", header: "authorization", prefix: "Bearer " },
        redirects: "deny" as const
      }]
    };
    const broker = new InstalledCouncilResourceBroker(
      { async assertCurrent(epochId) { if (epochId !== plan.epochId) throw new Error("unknown epoch"); return plan; } },
      host,
      { async resolve() { return policy; } },
      { async check() { return { allowed: true, reason: "fixture uncontained" }; } },
      networkFactory
    );
    const protector = new FakeUserSecretProtector();
    const configuration = await createPipeConfiguration(context.stateDirectory, protector, `council-client-${Date.now()}`);
    pipe = new AuthenticatedPipeServer(configuration, protector, new CompanionService({ councilResources: broker }));
    await pipe.start();
    const environment = {
      SXSY_COUNCIL_EPOCH_ID: plan.epochId,
      SXSY_COUNCIL_SESSION_ID: context.request.sessionId,
      SXSY_COUNCIL_TARGET_SNAPSHOT_ID: plan.targetSnapshotId,
      SXSY_COUNCIL_RESOURCE_FENCE_DIGEST: resourceHost.fenceDigest,
      [portResource.environmentName]: portResource.value,
      [credentialResource.environmentName]: credentialResource.value
    };
    const client = new InstalledCouncilParticipantClient({ configuration, protector, stateDirectory: context.stateDirectory, environment, resourceHostDigest: resourceHost.digest });
    const stolenOperationId = "stolen-port-activation";
    const stolenSuffix = sha256(stolenOperationId).slice(0, 40);
    const stolenBackendPath = process.platform === "win32"
      ? `\\\\.\\pipe\\sxsy-b122-council-backend-${stolenSuffix}`
      : join(context.stateRoot, `sxsy-b122-council-backend-${stolenSuffix}.sock`);
    const stolenBackend = createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve, reject) => { stolenBackend.once("error", reject); stolenBackend.listen(stolenBackendPath, resolve); });
    const stolenActivation = await new AuthenticatedPipeClient(configuration, protector).request({
      version: 1,
      id: "stolen-port-activation",
      method: "council.port-proxy.activate",
      payload: {
        epochId: plan.epochId,
        sessionId: context.request.sessionId,
        targetSnapshotId: plan.targetSnapshotId,
        leaseId: "port-lease",
        operationId: stolenOperationId,
        fenceDigest: resourceHost.fenceDigest,
        resourceHostDigest: resourceHost.digest,
        expectedPort: portResource.value,
        backendPipePath: stolenBackendPath,
        backendProof: "3".repeat(64)
      }
    });
    await new Promise<void>((resolve) => stolenBackend.close(() => resolve()));
    assert.equal(stolenActivation.ok, false);
    backend = await client.openPortProxy({
      leaseId: "port-lease",
      onConnection(socket) { socket.pipe(socket); }
    });
    assert.equal(backend.receipt.status, "active");
    const leasedPort = Number(portResource.value);
    const proxied = await connect(leasedPort);
    proxied.write("installed-participant-bytes");
    assert.equal((await oneChunk(proxied)).toString("utf8"), "installed-participant-bytes");
    proxied.destroy();

    const credentialInput = {
      leaseId: "credential-lease",
      routeId: "provider.health"
    } as const;
    const rejectedRoute = await new AuthenticatedPipeClient(configuration, protector).request({
      version: 1,
      id: "council-github-route-bypass",
      method: "council.credential-network.execute",
      payload: {
        epochId: plan.epochId,
        sessionId: context.request.sessionId,
        targetSnapshotId: plan.targetSnapshotId,
        leaseId: "credential-lease",
        operationId: "council-github-route-bypass",
        fenceDigest: resourceHost.fenceDigest,
        resourceHostDigest: resourceHost.digest,
        capabilityId: credentialResource.value,
        routeId: "github.graphql"
      }
    });
    assert.equal(rejectedRoute.ok, false);
    assert.equal(redemptions, 0);
    assert.equal(networkConstructions, 0);

    const wrongPurposeBroker = new InstalledCouncilResourceBroker(
      { async assertCurrent() { return plan; } },
      host,
      { async resolve() { return { ...policy, routes: [{ ...policy.routes[0]!, credential: { ...policy.routes[0]!.credential!, purpose: "github-api" } }] }; } },
      { async check() { return { allowed: true, reason: "fixture uncontained" }; } },
      networkFactory
    );
    await assert.rejects(wrongPurposeBroker.credentialNetwork({
      epochId: plan.epochId,
      sessionId: context.request.sessionId,
      targetSnapshotId: plan.targetSnapshotId,
      leaseId: "credential-lease",
      operationId: "wrong-purpose",
      fenceDigest: resourceHost.fenceDigest,
      resourceHostDigest: resourceHost.digest,
      capabilityId: credentialResource.value,
      routeId: "provider.health"
    }), /credential scope|provider-health|route/i);
    assert.equal(redemptions, 0);
    assert.equal(networkConstructions, 0);

    const receipt = await client.credentialNetwork(credentialInput);
    assert.equal(receipt.outcome, "passed");
    assert.equal(JSON.stringify(receipt).includes(secret.toString("utf8")), false);
    assert.deepEqual(await client.credentialNetwork(credentialInput), receipt);
    assert.equal(redemptions, 1);
    assert.deepEqual(observedSecrets, [secret.toString("utf8")]);

    const substituted = new InstalledCouncilParticipantClient({
      configuration,
      protector,
      stateDirectory: context.stateDirectory,
      environment: { ...environment, SXSY_COUNCIL_TARGET_SNAPSHOT_ID: "c".repeat(64) },
      resourceHostDigest: resourceHost.digest
    });
    await assert.rejects(substituted.credentialNetwork(credentialInput), /rejected|target|binding|receipt/i);

    await backend.close();
    backend = undefined;
    await assert.rejects(broker.assertPlanOperational(plan), /backend|proxy|operational|unavailable|credential capability/i);
    await host.cleanup(context.request, resourceHost);
    const reusable = createServer();
    await new Promise<void>((resolve, reject) => { reusable.once("error", reject); reusable.listen(leasedPort, "127.0.0.1", resolve); });
    await new Promise<void>((resolve, reject) => reusable.close((error) => error ? reject(error) : resolve()));
  } finally {
    await backend?.close().catch(() => undefined);
    await pipe?.stop().catch(() => undefined);
    await host.shutdownForRestart().catch(() => undefined);
    secret.fill(0);
    await rm(context.base, { recursive: true, force: true });
  }
});

test("Council backend challenge rejects a replayed proof before forwarding participant bytes", async () => {
  const context = await fixture();
  const request = { ...context.request, leases: [context.request.leases[0]!] };
  const host = new CouncilResourceHost({ stateRoot: context.stateRoot });
  const backendProof = "4".repeat(64);
  const operationId = "replayed-backend-proof";
  const backendSuffix = sha256(operationId).slice(0, 40);
  const backendPath = process.platform === "win32"
    ? `\\\\.\\pipe\\sxsy-b122-council-backend-${backendSuffix}`
    : join(context.stateRoot, `sxsy-b122-council-backend-${backendSuffix}.sock`);
  const sockets = new Set<Socket>();
  let savedProof = "";
  let connections = 0;
  const backend = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    void oneLine(socket).then((line) => {
      connections += 1;
      if (connections === 1) {
        const challenge: unknown = JSON.parse(line);
        assert.ok(challenge && typeof challenge === "object");
        savedProof = stableJson({
          schema: "sxsy-b122.council-backend-proof",
          version: 1,
          operationId,
          proof: createHmac("sha256", Buffer.from(backendProof, "hex")).update(stableJson(challenge)).digest("hex")
        });
      }
      socket.end(`${savedProof}\n`);
    }, () => socket.destroy());
  });
  try {
    const resourceHost = await host.materialize(request);
    const plan = planFor(request, resourceHost);
    const portResource = resourceHost.resources[0]!;
    const broker = new InstalledCouncilResourceBroker(
      { async assertCurrent() { return plan; } },
      host,
      { async resolve() { throw new Error("credential network is not used"); } },
      { async check() { return { allowed: true, reason: "fixture" }; } }
    );
    await new Promise<void>((resolve, reject) => { backend.once("error", reject); backend.listen(backendPath, resolve); });
    await broker.activatePortProxy({
      epochId: plan.epochId,
      sessionId: request.sessionId,
      targetSnapshotId: plan.targetSnapshotId,
      leaseId: "port-lease",
      operationId,
      fenceDigest: resourceHost.fenceDigest,
      resourceHostDigest: resourceHost.digest,
      expectedPort: portResource.value,
      backendPipePath: backendPath,
      backendProof
    });
    await assert.rejects(broker.assertPlanOperational(plan), /backend|proof|operational|unavailable/i);
    assert.equal(connections, 2);
    await broker.shutdownForRestart();
    const leasedPort = Number(portResource.value);
    const reusable = createServer();
    await new Promise<void>((resolve, reject) => { reusable.once("error", reject); reusable.listen(leasedPort, "127.0.0.1", resolve); });
    await new Promise<void>((resolve) => reusable.close(() => resolve()));
  } finally {
    for (const socket of sockets) socket.destroy();
    if (backend.listening) await new Promise<void>((resolve) => backend.close(() => resolve()));
    await host.shutdownForRestart();
    await rm(context.base, { recursive: true, force: true });
  }
});

test("default durable bootstrap exposes its retained Council port host through authenticated participant IPC", async () => {
  const base = await mkdtemp(join(tmpdir(), "b122-council-default-bootstrap-"));
  const repositoryRoot = join(base, "repository");
  const stateDirectory = join(base, "state");
  let pipe: AuthenticatedPipeServer | undefined;
  let backend: Awaited<ReturnType<InstalledCouncilParticipantClient["openPortProxy"]>> | undefined;
  let companion: ReturnType<typeof createDurableWindowsCompanion> | undefined;
  try {
    await mkdir(repositoryRoot);
    await git(repositoryRoot, ["init", "-b", "main"]);
    await git(repositoryRoot, ["config", "user.email", "council@example.invalid"]);
    await git(repositoryRoot, ["config", "user.name", "Council Test"]);
    await writeFile(join(repositoryRoot, "README.md"), "council\n", "utf8");
    await git(repositoryRoot, ["add", "README.md"]);
    await git(repositoryRoot, ["commit", "-m", "initial"]);
    const head = await git(repositoryRoot, ["rev-parse", "HEAD"]);
    const canonicalRepository = await realpath(repositoryRoot);
    const protector = new FakeUserSecretProtector();
    companion = createDurableWindowsCompanion({
      store: new ProtectedJsonStore({ filePath: join(stateDirectory, "protected.jsonl"), authenticator: isolatedAuthenticator }),
      policyVersion: "council-bootstrap-test",
      localStateDirectory: stateDirectory,
      credentialProtector: protector,
      targetResolver: { async resolve() { throw new Error("Council resource E2E uses the exact prepared plan only."); } }
    });
    const port = await freePort();
    const plan = await companion.councilIsolation.prepare({
      epochId: "bootstrap-council-epoch",
      targetSnapshotId: "a".repeat(64),
      repositoryRoot: canonicalRepository,
      targetHead: head,
      defaultBranch: "main",
      assignments: [{ sessionId: "bootstrap-participant", paths: ["README.md"], resources: [`port:${port}`] }]
    });
    const binding = plan.bindings[0];
    const resourceHost = binding?.resourceHost;
    const portResource = resourceHost?.resources.find((resource) => resource.kind === "port");
    const portLease = binding?.leases.find((lease) => lease.kind === "port");
    assert.ok(binding && resourceHost && portResource && portLease);
    const configuration = await createPipeConfiguration(stateDirectory, protector, `council-bootstrap-${Date.now()}`);
    pipe = new AuthenticatedPipeServer(configuration, protector, companion.endpoint);
    await pipe.start();
    const client = new InstalledCouncilParticipantClient({
      configuration,
      protector,
      stateDirectory,
      environment: {
        SXSY_COUNCIL_EPOCH_ID: plan.epochId,
        SXSY_COUNCIL_SESSION_ID: binding.sessionId,
        SXSY_COUNCIL_TARGET_SNAPSHOT_ID: plan.targetSnapshotId,
        SXSY_COUNCIL_RESOURCE_FENCE_DIGEST: resourceHost.fenceDigest,
        SXSY_COUNCIL_RESOURCE_HOST_DIGEST: resourceHost.digest,
        [portResource.environmentName]: portResource.value
      }
    });
    backend = await client.openPortProxy({
      leaseId: portLease.id,
      portEnvironmentName: portResource.environmentName,
      onConnection(socket) { socket.pipe(socket); }
    });
    const proxied = await connect(port);
    proxied.write("default-bootstrap-path");
    assert.equal((await oneChunk(proxied)).toString("utf8"), "default-bootstrap-path");
    proxied.destroy();
    await companion.councilResources.assertPlanOperational(plan);
    await backend.close();
    backend = undefined;
    await assert.rejects(companion.councilResources.assertPlanOperational(plan), /backend|proxy|operational|unavailable/i);
    const cleaned = await companion.councilIsolation.cleanup(plan.epochId);
    assert.equal(cleaned.status, "cleaned");
  } finally {
    await backend?.close().catch(() => undefined);
    await pipe?.stop().catch(() => undefined);
    await companion?.councilLifecycle.dispose().catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  }
});
