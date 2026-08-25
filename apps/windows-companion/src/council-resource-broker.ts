import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { connect, type Socket } from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import {
  createDirectConfiguredNetworkBroker,
  type ConfiguredHttpsNetworkBroker,
  type ConfiguredNetworkPolicy,
  type NetworkContainmentFence
} from "./configured-network.ts";
import type { CredentialAdapterPort, CredentialLease } from "./durable-credentials.ts";
import type { DurableNetworkPolicyRegistry } from "./host-provisioning.ts";
import {
  CouncilResourceHost,
  CouncilResourceHostError,
  type CouncilCredentialOperationReceipt,
  type CouncilResourceHostRequest
} from "./council-resource-host.ts";
import type { CouncilIsolationPlan, CouncilWorkspaceBinding, CouncilWorkspaceIsolationManager } from "./council-workspace-isolation.ts";

export interface CouncilPortProxyRequest {
  readonly epochId: string;
  readonly sessionId: string;
  readonly targetSnapshotId: string;
  readonly leaseId: string;
  readonly operationId: string;
  readonly fenceDigest: string;
  readonly resourceHostDigest: string;
  readonly expectedPort: string;
  readonly backendPipePath: string;
  readonly backendProof: string;
}

export interface CouncilPortProxyReceipt {
  readonly schema: "sxsy-b122.council-port-proxy";
  readonly version: 1;
  readonly epochId: string;
  readonly sessionId: string;
  readonly targetSnapshotId: string;
  readonly leaseId: string;
  readonly operationId: string;
  readonly status: "active";
  readonly digest: string;
}

export interface CouncilCredentialNetworkRequest {
  readonly epochId: string;
  readonly sessionId: string;
  readonly targetSnapshotId: string;
  readonly leaseId: string;
  readonly operationId: string;
  readonly fenceDigest: string;
  readonly resourceHostDigest: string;
  readonly capabilityId: string;
  readonly routeId: string;
}

export interface CouncilResourceBrokerPort {
  activatePortProxy(input: CouncilPortProxyRequest): Promise<CouncilPortProxyReceipt>;
  credentialNetwork(input: CouncilCredentialNetworkRequest): Promise<CouncilCredentialOperationReceipt>;
  shutdownForRestart(): Promise<void>;
}

export type CouncilConfiguredNetworkFactory = (
  policy: ConfiguredNetworkPolicy,
  containment: NetworkContainmentFence,
  credentials: CredentialAdapterPort
) => Pick<ConfiguredHttpsNetworkBroker, "request">;

/**
 * Production-reachable Council resource boundary. Its caller arrives through
 * the companion's mutually authenticated pipe; this class independently
 * re-derives the protected plan and exact resource-host fence before use.
 */
export class InstalledCouncilResourceBroker implements CouncilResourceBrokerPort {
  constructor(
    private readonly isolation: Pick<CouncilWorkspaceIsolationManager, "assertCurrent">,
    private readonly host: CouncilResourceHost,
    private readonly networkPolicies: Pick<DurableNetworkPolicyRegistry, "resolve">,
    private readonly containment: NetworkContainmentFence,
    private readonly networkFactory: CouncilConfiguredNetworkFactory = createDirectConfiguredNetworkBroker
  ) {}

  async activatePortProxy(input: CouncilPortProxyRequest): Promise<CouncilPortProxyReceipt> {
    const { plan, binding } = await this.binding(input);
    const resourceHost = requiredHost(binding);
    exactHostFence(input, resourceHost);
    const portResource = resourceHost.resources.find((resource) => resource.leaseId === input.leaseId && resource.kind === "port");
    if (!portResource || portResource.value !== input.expectedPort) throw new CouncilResourceHostError("Council port proxy changed its exact assigned port identity.");
    const backendPipePath = exactBackendPipe(input.backendPipePath, plan.stateRoot);
    const operationId = identity(input.operationId, "Council port operation ID");
    if (!samePath(backendPipePath, expectedBackendPipe(operationId, plan.stateRoot))) {
      throw new CouncilResourceHostError("Council backend pipe changed its exact operation-bound identity.");
    }
    const backendProof = exactBackendProof(input.backendProof);
    const backendBinding: CouncilBackendBinding = {
      epochId: plan.epochId,
      sessionId: binding.sessionId,
      targetSnapshotId: plan.targetSnapshotId,
      leaseId: input.leaseId,
      operationId,
      fenceDigest: resourceHost.fenceDigest,
      resourceHostDigest: resourceHost.digest
    };
    await this.host.activatePortProxy(resourceRequest(plan, binding), resourceHost, {
      leaseId: identity(input.leaseId, "Council port lease ID"),
      activationId: operationId,
      connectBackend: () => connectBackend(backendPipePath, backendProof, backendBinding)
    });
    const unsigned = {
      schema: "sxsy-b122.council-port-proxy" as const,
      version: 1 as const,
      epochId: plan.epochId,
      sessionId: binding.sessionId,
      targetSnapshotId: plan.targetSnapshotId,
      leaseId: input.leaseId,
      operationId,
      status: "active" as const
    };
    return { ...unsigned, digest: sha256(stableJson(unsigned)) };
  }

  async credentialNetwork(input: CouncilCredentialNetworkRequest): Promise<CouncilCredentialOperationReceipt> {
    const { plan, binding } = await this.binding(input);
    const resourceHost = requiredHost(binding);
    exactHostFence(input, resourceHost);
    const credentialResource = resourceHost.resources.find((resource) => resource.leaseId === input.leaseId && resource.kind === "credential_scope");
    if (!credentialResource || credentialResource.value !== input.capabilityId) throw new CouncilResourceHostError("Council credential request changed its exact opaque capability identity.");
    const lease = binding.leases.find((candidate) => candidate.id === input.leaseId && candidate.kind === "credential_scope");
    const scope = exactCredentialRoute(input.routeId, lease?.declaration);
    const policy = await this.networkPolicies.resolve();
    const route = policy.routes.find((candidate) => candidate.id === scope.routeId);
    if (!route || route.method !== "GET" || route.pathParameter || route.redirects !== "deny" || !route.credential
      || route.credential.reference !== scope.reference || route.credential.purpose !== "provider-api") {
      throw new CouncilResourceHostError("Council credential route is not the exact fixed provider-health credential scope.");
    }
    return this.host.performCredentialOperation(
      resourceRequest(plan, binding),
      resourceHost,
      { leaseId: identity(input.leaseId, "Council credential lease ID"), operationId: identity(input.operationId, "Council credential operation ID") },
      {
        perform: async (credentialInput, cleartext) => {
          if (credentialInput.credentialReference !== scope.reference) throw new CouncilResourceHostError("Council credential reference changed after its exact route was authorized.");
          const credentials = oneCredential(credentialInput.credentialReference, credentialInput.repositoryRoot, route.credential!.purpose, cleartext);
          const result = await this.networkFactory(policy, this.containment, credentials).request({
            routeId: scope.routeId,
            repositoryRoot: credentialInput.repositoryRoot
          });
          return {
            outcome: result.outcome === "passed" ? "passed" as const : "failed" as const,
            summary: result.detail.slice(0, 512)
          };
        }
      }
    );
  }

  async assertPlanOperational(plan: CouncilIsolationPlan): Promise<void> {
    if (plan.status !== "prepared") throw new CouncilResourceHostError("Council active isolation plan is no longer prepared.");
    for (const binding of plan.bindings) await this.host.assertOperational(resourceRequest(plan, binding), requiredHost(binding));
  }

  /** Releases process-owned listeners/sockets without changing durable epoch state. */
  async shutdownForRestart(): Promise<void> {
    await this.host.shutdownForRestart();
  }

  private async binding(input: Pick<CouncilPortProxyRequest, "epochId" | "sessionId" | "targetSnapshotId">): Promise<Readonly<{ plan: CouncilIsolationPlan; binding: CouncilWorkspaceBinding }>> {
    const epochId = identity(input.epochId, "Council epoch ID");
    const sessionId = identity(input.sessionId, "Council session ID");
    const plan = await this.isolation.assertCurrent(epochId);
    if (plan.targetSnapshotId !== input.targetSnapshotId) throw new CouncilResourceHostError("Council resource request changed its exact TargetSnapshot.");
    const binding = plan.bindings.find((candidate) => candidate.sessionId === sessionId);
    if (!binding) throw new CouncilResourceHostError("Council resource request is not bound to the exact participant session.");
    return { plan, binding };
  }
}

function oneCredential(reference: string, repositoryRoot: string, purpose: string, cleartext: Uint8Array): CredentialAdapterPort {
  const lease: CredentialLease = { id: `council-network:${sha256(stableJson({ reference, repositoryRoot })).slice(0, 32)}`, expiresAt: Date.now() + 15_000 };
  const assertRequest = (input: Readonly<{ reference: string; repositoryRoot: string; purpose?: string }>): void => {
    if (input.reference !== reference || !samePath(input.repositoryRoot, repositoryRoot) || input.purpose !== purpose) throw new CouncilResourceHostError("Configured route requested a credential outside the exact Council session scope.");
  };
  return {
    async acquireLease(input) { assertRequest(input); return lease; },
    async redeem(input, consume) { if (input.id !== lease.id || input.expiresAt !== lease.expiresAt) throw new CouncilResourceHostError("Council configured route changed its credential lease."); return consume(cleartext); },
    async withCredential(input, consume) { assertRequest(input); return consume(cleartext); }
  };
}

function resourceRequest(plan: CouncilIsolationPlan, binding: CouncilWorkspaceBinding): CouncilResourceHostRequest {
  return {
    epochId: plan.epochId,
    targetSnapshotId: plan.targetSnapshotId,
    repositoryRoot: plan.repositoryRoot,
    stateRoot: plan.stateRoot,
    sessionId: binding.sessionId,
    worktreeRoot: binding.worktreeRoot,
    branch: binding.branch,
    head: binding.head,
    leases: binding.leases.map((lease) => ({
      id: lease.id,
      kind: lease.kind,
      ...(lease.declaration ? { declaration: lease.declaration } : {}),
      ...(lease.localPath ? { localPath: lease.localPath } : {}),
      fence: lease.fence,
      status: lease.status
    }))
  };
}

function requiredHost(binding: CouncilWorkspaceBinding) {
  if (!binding.resourceHost) throw new CouncilResourceHostError("Council resource request has no exact host binding.");
  return binding.resourceHost;
}

function exactHostFence(
  input: Readonly<{ fenceDigest: string; resourceHostDigest: string }>,
  binding: ReturnType<typeof requiredHost>
): void {
  if (!/^[a-f0-9]{64}$/.test(input.fenceDigest) || input.fenceDigest !== binding.fenceDigest
    || !/^[a-f0-9]{64}$/.test(input.resourceHostDigest) || input.resourceHostDigest !== binding.digest) {
    throw new CouncilResourceHostError("Council resource request changed its exact host fence binding.");
  }
}

interface CouncilBackendBinding {
  readonly epochId: string;
  readonly sessionId: string;
  readonly targetSnapshotId: string;
  readonly leaseId: string;
  readonly operationId: string;
  readonly fenceDigest: string;
  readonly resourceHostDigest: string;
}

function connectBackend(pipePath: string, backendProof: Uint8Array, binding: CouncilBackendBinding): Promise<Socket> {
  return new Promise((resolveConnection, rejectConnection) => {
    const socket = connect(pipePath);
    const onError = (): void => { socket.destroy(); rejectConnection(new CouncilResourceHostError("Council backend pipe is unavailable.")); };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.removeListener("error", onError);
      const challenge = {
        schema: "sxsy-b122.council-backend-challenge" as const,
        version: 1 as const,
        ...binding,
        nonce: randomBytes(32).toString("hex")
      };
      void authenticateBackend(socket, challenge, backendProof).then(() => resolveConnection(socket), () => {
        socket.destroy();
        rejectConnection(new CouncilResourceHostError("Council backend did not prove its exact activation fence."));
      });
    });
  });
}

async function authenticateBackend(socket: Socket, challenge: Readonly<CouncilBackendBinding & { schema: "sxsy-b122.council-backend-challenge"; version: 1; nonce: string }>, backendProof: Uint8Array): Promise<void> {
  socket.setTimeout(2_000);
  socket.write(`${stableJson(challenge)}\n`);
  const response = await readBoundedLine(socket);
  const value: unknown = JSON.parse(response);
  if (!record(value) || !exactKeys(value, ["schema", "version", "operationId", "proof"])
    || value.schema !== "sxsy-b122.council-backend-proof" || value.version !== 1
    || value.operationId !== challenge.operationId || typeof value.proof !== "string" || !/^[a-f0-9]{64}$/.test(value.proof)) {
    throw new Error("invalid backend proof");
  }
  const expected = createHmac("sha256", backendProof).update(stableJson(challenge)).digest();
  const observed = Buffer.from(value.proof, "hex");
  if (observed.length !== expected.length || !timingSafeEqual(observed, expected)) throw new Error("invalid backend proof");
  socket.setTimeout(0);
}

function readBoundedLine(socket: Socket): Promise<string> {
  return new Promise((resolveLine, rejectLine) => {
    let buffered = Buffer.alloc(0);
    const cleanup = (): void => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onFailure);
      socket.removeListener("close", onClose);
      socket.removeListener("timeout", onTimeout);
    };
    const fail = (): void => { cleanup(); rejectLine(new Error("backend handshake rejected")); };
    const onFailure = (): void => fail();
    const onClose = (): void => fail();
    const onTimeout = (): void => fail();
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > 4_096) { fail(); return; }
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) return;
      if (newline !== buffered.length - 1) { fail(); return; }
      cleanup();
      resolveLine(buffered.subarray(0, newline).toString("utf8"));
    };
    socket.on("data", onData);
    socket.once("error", onFailure);
    socket.once("close", onClose);
    socket.once("timeout", onTimeout);
  });
}

function exactBackendPipe(value: string, stateRoot: string): string {
  if (process.platform === "win32") {
    if (!/^\\\\\.\\pipe\\sxsy-b122-council-backend-[a-zA-Z0-9-]{1,64}$/.test(value)) throw new CouncilResourceHostError("Council backend must be an exact local B122 named pipe.");
    return value;
  }
  if (!isAbsolute(value) || !inside(stateRoot, value) || !/sxsy-b122-council-backend-[a-zA-Z0-9-]{1,64}\.sock$/.test(value)) throw new CouncilResourceHostError("Council backend must be an exact host-state local socket.");
  return resolve(value);
}

function expectedBackendPipe(operationId: string, stateRoot: string): string {
  const suffix = sha256(operationId).slice(0, 40);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\sxsy-b122-council-backend-${suffix}`
    : resolve(stateRoot, `sxsy-b122-council-backend-${suffix}.sock`);
}

function exactBackendProof(value: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new CouncilResourceHostError("Council backend proof is invalid.");
  return Buffer.from(value, "hex");
}

function identity(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(normalized)) throw new CouncilResourceHostError(`${field} is invalid.`);
  return normalized;
}

function exactCredentialRoute(routeInput: string, declaration: string | undefined): Readonly<{ reference: string; routeId: "provider.health" }> {
  const routeId = identity(routeInput, "Council configured route ID");
  const match = /^credential-scope:([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})@([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})$/.exec(declaration ?? "");
  if (!match || match[2] !== routeId) throw new CouncilResourceHostError("Council credential lease is not bound to this exact configured route.");
  // The participant capability is intentionally narrower than generic configured
  // network access. It may prove the installed provider credential through the
  // fixed credentialed health route and can never reach Git/GitHub mutations.
  if (routeId !== "provider.health") throw new CouncilResourceHostError("Council credential capability permits only the fixed provider health operation.");
  return { reference: match[1]!, routeId };
}

function samePath(left: string, right: string): boolean { return resolve(left).replace(/[\\/]+$/, "").toLowerCase() === resolve(right).replace(/[\\/]+$/, "").toLowerCase(); }
function inside(parent: string, candidate: string): boolean { const rel = relative(resolve(parent), resolve(candidate)); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); }
function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
