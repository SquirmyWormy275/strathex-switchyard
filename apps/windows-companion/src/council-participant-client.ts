import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, realpath, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { AuthenticatedPipeClient, loadPipeConfiguration, type AuthenticatedPipeConfiguration } from "./authenticated-pipe.ts";
import { companionBridgeVersion, type CompanionResponse } from "./bridge.ts";
import type { CouncilCredentialOperationReceipt } from "./council-resource-host.ts";
import type { CouncilPortProxyReceipt } from "./council-resource-broker.ts";
import { WindowsDpapiCurrentUserProtector, type UserSecretProtector } from "./windows-secret.ts";

const digestPattern = /^[a-f0-9]{64}$/;
const identityPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;

export interface CouncilParticipantEnvironment {
  readonly [name: string]: string | undefined;
}

export interface InstalledCouncilParticipantClientOptions {
  readonly configuration: AuthenticatedPipeConfiguration;
  readonly protector: UserSecretProtector;
  readonly stateDirectory: string;
  readonly environment: CouncilParticipantEnvironment;
  /** Exact digest supplied by the parsed Council request; avoids self-referential environment hashing. */
  readonly resourceHostDigest?: string;
}

export interface CouncilParticipantPortProxyHandle {
  readonly receipt: CouncilPortProxyReceipt;
  close(): Promise<void>;
}

/**
 * Participant-side half of the Council resource boundary. The participant
 * receives only public resource identities. Every request is re-authorized by
 * the companion against its protected epoch/lease plan.
 */
export class InstalledCouncilParticipantClient {
  private readonly transport: AuthenticatedPipeClient;
  private readonly stateDirectory: string;
  private readonly environment: Readonly<Record<string, string>>;
  private readonly epochId: string;
  private readonly sessionId: string;
  private readonly targetSnapshotId: string;
  private readonly fenceDigest: string;
  private readonly resourceHostDigest: string;

  constructor(options: InstalledCouncilParticipantClientOptions) {
    if (!isAbsolute(options.stateDirectory)) throw new Error("Council participant state root must be absolute.");
    this.stateDirectory = resolve(options.stateDirectory);
    this.environment = boundedEnvironment(options.environment);
    this.epochId = requiredIdentity(this.environment.SXSY_COUNCIL_EPOCH_ID, "Council epoch");
    this.sessionId = requiredIdentity(this.environment.SXSY_COUNCIL_SESSION_ID, "Council session");
    this.targetSnapshotId = requiredDigest(this.environment.SXSY_COUNCIL_TARGET_SNAPSHOT_ID, "Council TargetSnapshot");
    this.fenceDigest = requiredDigest(this.environment.SXSY_COUNCIL_RESOURCE_FENCE_DIGEST, "Council resource fence");
    this.resourceHostDigest = requiredDigest(options.resourceHostDigest ?? this.environment.SXSY_COUNCIL_RESOURCE_HOST_DIGEST, "Council resource-host binding");
    this.transport = new AuthenticatedPipeClient(options.configuration, options.protector);
  }

  async openPortProxy(input: Readonly<{
    leaseId: string;
    portEnvironmentName?: string;
    onConnection(socket: Socket): void;
  }>): Promise<CouncilParticipantPortProxyHandle> {
    const leaseId = requiredIdentity(input.leaseId, "Council port lease");
    const portEnvironmentName = resourceEnvironmentName(input.portEnvironmentName, "PORT", this.environment);
    const expectedPort = exactPort(this.environment[portEnvironmentName]);
    const operationId = operationIdentity("port", this.bindingMaterial(), { leaseId, expectedPort, portEnvironmentName });
    const backendPipePath = await this.backendPipePath(operationId);
    const backendProof = randomBytes(32);
    const backendBinding = {
      epochId: this.epochId,
      sessionId: this.sessionId,
      targetSnapshotId: this.targetSnapshotId,
      leaseId,
      operationId,
      fenceDigest: this.fenceDigest,
      resourceHostDigest: this.resourceHostDigest
    };
    const sockets = new Set<Socket>();
    let server: Server | undefined;
    try {
      server = createServer((socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        socket.once("error", () => socket.destroy());
        void proveBackend(socket, backendBinding, backendProof).then(() => {
          try { input.onConnection(socket); }
          catch { socket.destroy(); }
        }, () => socket.destroy());
      });
      await listen(server, backendPipePath);
      const response = await this.transport.request({
        version: companionBridgeVersion,
        id: operationId,
        method: "council.port-proxy.activate",
        payload: {
          epochId: this.epochId,
          sessionId: this.sessionId,
          targetSnapshotId: this.targetSnapshotId,
          leaseId,
          operationId,
          fenceDigest: this.fenceDigest,
          resourceHostDigest: this.resourceHostDigest,
          expectedPort,
          backendPipePath,
          backendProof: backendProof.toString("hex")
        }
      });
      const receipt = exactPortReceipt(response, {
        epochId: this.epochId,
        sessionId: this.sessionId,
        targetSnapshotId: this.targetSnapshotId,
        leaseId,
        operationId
      });
      let closed = false;
      return {
        receipt,
        close: async () => {
          if (closed) return;
          closed = true;
          for (const socket of sockets) socket.destroy();
          sockets.clear();
          await closeServer(server);
          if (process.platform !== "win32") await unlink(backendPipePath).catch(() => undefined);
        }
      };
    } catch (error) {
      for (const socket of sockets) socket.destroy();
      await closeServer(server).catch(() => undefined);
      if (process.platform !== "win32") await unlink(backendPipePath).catch(() => undefined);
      throw safeClientError(error);
    }
  }

  async credentialNetwork(input: Readonly<{
    leaseId: string;
    credentialEnvironmentName?: string;
    routeId: "provider.health";
  }>): Promise<CouncilCredentialOperationReceipt> {
    const leaseId = requiredIdentity(input.leaseId, "Council credential lease");
    const environmentName = resourceEnvironmentName(input.credentialEnvironmentName, "CREDENTIAL_CAPABILITY_ID", this.environment);
    const capabilityId = requiredIdentity(this.environment[environmentName], "Council opaque credential capability");
    if (input.routeId !== "provider.health") throw new Error("Council participant credential access permits only the fixed provider health operation.");
    const operationId = operationIdentity("credential", this.bindingMaterial(), { leaseId, capabilityId, routeId: input.routeId, environmentName });
    const response = await this.transport.request({
      version: companionBridgeVersion,
      id: operationId,
      method: "council.credential-network.execute",
      payload: {
        epochId: this.epochId,
        sessionId: this.sessionId,
        targetSnapshotId: this.targetSnapshotId,
        leaseId,
        operationId,
        fenceDigest: this.fenceDigest,
        resourceHostDigest: this.resourceHostDigest,
        capabilityId,
        routeId: input.routeId
      }
    });
    return exactCredentialReceipt(response, {
      epochId: this.epochId,
      sessionId: this.sessionId,
      targetSnapshotId: this.targetSnapshotId,
      leaseId,
      operationId
    });
  }

  private bindingMaterial(): Readonly<Record<string, string>> {
    return {
      epochId: this.epochId,
      sessionId: this.sessionId,
      targetSnapshotId: this.targetSnapshotId,
      fenceDigest: this.fenceDigest,
      resourceHostDigest: this.resourceHostDigest
    };
  }

  private async backendPipePath(operationId: string): Promise<string> {
    const suffix = createHash("sha256").update(operationId).digest("hex").slice(0, 40);
    if (process.platform === "win32") return `\\\\.\\pipe\\sxsy-b122-council-backend-${suffix}`;
    const root = join(this.stateDirectory, "council-isolation");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const canonicalRoot = await realpath(root);
    const candidate = resolve(canonicalRoot, `sxsy-b122-council-backend-${suffix}.sock`);
    if (!inside(canonicalRoot, candidate)) throw new Error("Council backend socket escaped the installed state root.");
    await unlink(candidate).catch(() => undefined);
    return candidate;
  }
}

/** Loads only the install-owned sealed endpoint record from one canonical state root. */
export async function loadInstalledCouncilParticipantClient(
  stateDirectoryInput: string,
  environment: CouncilParticipantEnvironment = process.env,
  protector: UserSecretProtector = new WindowsDpapiCurrentUserProtector()
): Promise<InstalledCouncilParticipantClient> {
  if (!isAbsolute(stateDirectoryInput)) throw new Error("The installed Council participant state root must be absolute.");
  const stateDirectory = await realpath(resolve(stateDirectoryInput));
  const configurationPath = resolve(stateDirectory, "authenticated-pipe.json");
  if (!inside(stateDirectory, configurationPath)) throw new Error("The Council endpoint record escaped the installed state root.");
  const configuration = await loadPipeConfiguration(configurationPath);
  return new InstalledCouncilParticipantClient({ configuration, protector, stateDirectory, environment });
}

function exactPortReceipt(response: CompanionResponse, expected: Readonly<{ epochId: string; sessionId: string; targetSnapshotId: string; leaseId: string; operationId: string }>): CouncilPortProxyReceipt {
  const receipt = responseReceipt(response);
  if (receipt.schema !== "sxsy-b122.council-port-proxy" || receipt.version !== 1 || receipt.status !== "active"
    || receipt.epochId !== expected.epochId || receipt.sessionId !== expected.sessionId || receipt.targetSnapshotId !== expected.targetSnapshotId
    || receipt.leaseId !== expected.leaseId || receipt.operationId !== expected.operationId || !validDigest(receipt.digest)) throw rejected();
  const { digest, ...unsigned } = receipt;
  if (sha256(stableJson(unsigned)) !== digest) throw rejected();
  return Object.freeze({ ...receipt }) as unknown as CouncilPortProxyReceipt;
}

function exactCredentialReceipt(response: CompanionResponse, expected: Readonly<{ epochId: string; sessionId: string; targetSnapshotId: string; leaseId: string; operationId: string }>): CouncilCredentialOperationReceipt {
  const receipt = responseReceipt(response);
  if (receipt.schema !== "sxsy-b122.council-credential-operation" || receipt.version !== 1 || (receipt.outcome !== "passed" && receipt.outcome !== "failed")
    || receipt.epochId !== expected.epochId || receipt.sessionId !== expected.sessionId || receipt.targetSnapshotId !== expected.targetSnapshotId
    || receipt.leaseId !== expected.leaseId || receipt.operationId !== expected.operationId || !Number.isSafeInteger(receipt.fence) || (receipt.fence as number) < 1
    || typeof receipt.summary !== "string" || !receipt.summary.trim() || receipt.summary.length > 512 || /[\r\n\0]/.test(receipt.summary) || !validDigest(receipt.digest)) throw rejected();
  const { digest, ...unsigned } = receipt;
  if (sha256(stableJson(unsigned)) !== digest) throw rejected();
  return Object.freeze({ ...receipt }) as unknown as CouncilCredentialOperationReceipt;
}

function responseReceipt(response: CompanionResponse): Record<string, unknown> {
  if (!response.ok || !record(response.result) || !record(response.result.receipt)) throw rejected();
  return response.result.receipt;
}

function operationIdentity(kind: "port" | "credential", binding: Readonly<Record<string, string>>, resource: unknown): string {
  return `council-${kind}-${sha256(stableJson({ binding, resource })).slice(0, 48)}`;
}

function boundedEnvironment(input: CouncilParticipantEnvironment): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (!name.startsWith("SXSY_COUNCIL_") || value === undefined) continue;
    if (!/^[A-Z0-9_]{1,128}$/.test(name) || value.length < 1 || value.length > 4_096 || /[\r\n\0]/.test(value)) throw new Error("The protected Council participant environment is malformed.");
    result[name] = value;
  }
  return Object.freeze(result);
}

function resourceEnvironmentName(value: string | undefined, kind: "PORT" | "CREDENTIAL_CAPABILITY_ID", environment: Readonly<Record<string, string>>): string {
  const pattern = new RegExp(`^SXSY_COUNCIL_${kind}_[1-9][0-9]{0,2}$`);
  if (value !== undefined) {
    if (!pattern.test(value) || environment[value] === undefined) throw new Error("Council participant selected an invalid resource environment identity.");
    return value;
  }
  const matches = Object.keys(environment).filter((name) => pattern.test(name));
  if (matches.length !== 1) throw new Error("Council participant requires one exact resource environment identity.");
  return matches[0]!;
}

async function proveBackend(
  socket: Socket,
  expected: Readonly<{ epochId: string; sessionId: string; targetSnapshotId: string; leaseId: string; operationId: string; fenceDigest: string; resourceHostDigest: string }>,
  backendProof: Uint8Array
): Promise<void> {
  socket.setTimeout(2_000);
  const line = await readBoundedLine(socket);
  const challenge: unknown = JSON.parse(line);
  const keys = ["schema", "version", "epochId", "sessionId", "targetSnapshotId", "leaseId", "operationId", "fenceDigest", "resourceHostDigest", "nonce"];
  if (!record(challenge) || !exactKeys(challenge, keys) || challenge.schema !== "sxsy-b122.council-backend-challenge" || challenge.version !== 1
    || keys.slice(2, 9).some((key) => challenge[key] !== expected[key as keyof typeof expected])
    || typeof challenge.nonce !== "string" || !digestPattern.test(challenge.nonce)) throw new Error("Council backend challenge changed its exact activation fence.");
  const proof = createHmac("sha256", backendProof).update(stableJson(challenge)).digest("hex");
  const response = stableJson({ schema: "sxsy-b122.council-backend-proof", version: 1, operationId: expected.operationId, proof });
  await writeSocket(socket, `${response}\n`);
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
    const fail = (): void => { cleanup(); rejectLine(new Error("Council backend handshake was rejected.")); };
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

function writeSocket(socket: Socket, value: string): Promise<void> {
  return new Promise((resolveWrite, rejectWrite) => socket.write(value, (error) => error ? rejectWrite(error) : resolveWrite()));
}

function requiredIdentity(value: string | undefined, label: string): string {
  if (!value || !identityPattern.test(value)) throw new Error(`${label} identity is invalid.`);
  return value;
}

function requiredDigest(value: string | undefined, label: string): string {
  if (!value || !digestPattern.test(value)) throw new Error(`${label} digest is invalid.`);
  return value;
}

function exactPort(value: string | undefined): string {
  const port = Number(value);
  if (!value || !Number.isSafeInteger(port) || port < 1024 || port > 65_535 || String(port) !== value) throw new Error("Council participant port identity is invalid.");
  return value;
}

function listen(server: Server, pipePath: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(pipePath, () => { server.removeListener("error", rejectListen); resolveListen(); });
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function safeClientError(error: unknown): Error {
  void error;
  return new Error("The installed Council participant resource request was rejected.");
}

function rejected(): Error { return new Error("The installed Council participant resource receipt was rejected."); }
function validDigest(value: unknown): value is string { return typeof value === "string" && digestPattern.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function inside(parent: string, candidate: string): boolean { const value = relative(resolve(parent), resolve(candidate)); return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value)); }
