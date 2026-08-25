import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import type { CredentialAdapterPort, CredentialLease } from "./durable-credentials.ts";

export type CouncilHostedResourceKind = "port" | "cache" | "temp" | "database" | "credential_scope";
export type CouncilResourceHostCapability =
  | "held-loopback-port"
  | "disposable-cache-directory"
  | "disposable-temp-directory"
  | "sqlite-database"
  | "session-fenced-credential-capability";

export interface CouncilCredentialVaultIssueRequest {
  readonly reference: string;
  readonly repositoryRoot: string;
  readonly epochId: string;
  readonly sessionId: string;
  readonly leaseId: string;
  readonly fence: number;
  readonly fenceDigest: string;
}

/**
 * This identifier is not a bearer secret. Redemption additionally requires
 * the exact host-held epoch/session/lease/fence binding.
 */
export interface CouncilCredentialCapabilityBinding {
  readonly id: string;
  readonly expiresAt: number;
}

export interface CouncilCredentialVaultCapabilityPort {
  issue(request: CouncilCredentialVaultIssueRequest): Promise<CouncilCredentialCapabilityBinding>;
  assertCurrent(binding: CouncilCredentialCapabilityBinding, request: CouncilCredentialVaultIssueRequest): Promise<boolean>;
  revoke(binding: CouncilCredentialCapabilityBinding, request: CouncilCredentialVaultIssueRequest): Promise<void>;
}

export interface CouncilResourceHostLease {
  readonly id: string;
  readonly kind: CouncilHostedResourceKind | "branch" | "worktree";
  readonly declaration?: string;
  readonly localPath?: string;
  readonly fence: number;
  readonly status: "active" | "released";
}

export interface CouncilResourceHostRequest {
  readonly epochId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly stateRoot: string;
  readonly sessionId: string;
  readonly worktreeRoot: string;
  readonly branch: string;
  readonly head: string;
  readonly leases: readonly CouncilResourceHostLease[];
}

export interface CouncilHostedResourceBinding {
  readonly leaseId: string;
  readonly kind: CouncilHostedResourceKind;
  readonly fence: number;
  readonly declaration: string;
  readonly bindingType: "loopback-listener" | "directory" | "sqlite" | "opaque-credential-capability";
  /** Port number, canonical local path, or a non-bearer opaque capability identifier. */
  readonly value: string;
  readonly environmentName: string;
  readonly credentialExpiresAt?: number;
}

export interface CouncilResourceHostBinding {
  readonly schema: "sxsy-b122.council-resource-host";
  readonly version: 1;
  readonly epochId: string;
  readonly sessionId: string;
  readonly fenceDigest: string;
  readonly capabilities: readonly CouncilResourceHostCapability[];
  readonly resources: readonly CouncilHostedResourceBinding[];
  readonly environment: Readonly<Record<string, string>>;
  readonly digest: string;
}

export interface CouncilResourceHostPort {
  materialize(request: CouncilResourceHostRequest): Promise<CouncilResourceHostBinding>;
  assertCurrent(request: CouncilResourceHostRequest, binding: CouncilResourceHostBinding): Promise<void>;
  recover(request: CouncilResourceHostRequest, binding: CouncilResourceHostBinding): Promise<void>;
  preflightCleanup(request: CouncilResourceHostRequest, binding?: CouncilResourceHostBinding): Promise<void>;
  cleanup(request: CouncilResourceHostRequest, binding?: CouncilResourceHostBinding): Promise<void>;
}

export interface CouncilResourceHostOptions {
  readonly stateRoot: string;
  readonly credentials?: CouncilCredentialVaultCapabilityPort;
}

const markerName = ".sxsy-b122-council-resource.json";
const digestPattern = /^[a-f0-9]{64}$/;
const capabilityIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;

export class CouncilResourceHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouncilResourceHostError";
  }
}

/**
 * Owns the non-Git resources behind a durable Council assignment. In-memory
 * handles are always checked against the persisted binding; restart recovery
 * reopens only exact host-owned resources and never silently remints a
 * credential capability.
 */
export class CouncilResourceHost implements CouncilResourceHostPort {
  private readonly stateRoot: string;
  private readonly credentials?: CouncilCredentialVaultCapabilityPort;
  private readonly ports = new Map<string, Server>();
  private readonly databases = new Map<string, DatabaseSync>();
  private readonly liveBindings = new Map<string, CouncilResourceHostBinding>();

  constructor(options: CouncilResourceHostOptions) {
    if (!isAbsolute(options.stateRoot)) throw new CouncilResourceHostError("Council resource host state root must be absolute.");
    this.stateRoot = resolve(options.stateRoot);
    this.credentials = options.credentials;
  }

  async materialize(requestInput: CouncilResourceHostRequest): Promise<CouncilResourceHostBinding> {
    const request = await this.normalizedRequest(requestInput);
    const key = bindingKey(request);
    const existing = this.liveBindings.get(key);
    if (existing) {
      await this.assertCurrent(request, existing);
      return cloneBinding(existing);
    }

    const resources: CouncilHostedResourceBinding[] = [];
    try {
      const hosted = request.leases.filter(isHostedLease).sort((left, right) => left.id.localeCompare(right.id));
      for (let index = 0; index < hosted.length; index += 1) {
        const lease = hosted[index]!;
        const environmentName = environmentNameFor(lease.kind, index);
        if (lease.kind === "port") {
          const port = exactPort(lease);
          this.ports.set(lease.id, await holdPort(port));
          resources.push(resourceBinding(lease, "loopback-listener", String(port), environmentName));
          continue;
        }
        if (lease.kind === "credential_scope") {
          if (!this.credentials) throw new CouncilResourceHostError("Council credential capability vault is unavailable; the assignment was not materialized.");
          const issue = credentialIssue(request, lease);
          const capability = validateCapability(await this.credentials.issue(issue));
          resources.push({ ...resourceBinding(lease, "opaque-credential-capability", capability.id, environmentName), credentialExpiresAt: capability.expiresAt });
          continue;
        }
        const directory = await this.materializeDirectory(request, lease);
        if (lease.kind === "database") {
          const databasePath = join(directory, "resource.sqlite");
          const database = createDatabase(databasePath, request, lease);
          await chmod(databasePath, 0o600).catch(() => undefined);
          this.databases.set(lease.id, database);
          resources.push(resourceBinding(lease, "sqlite", databasePath, environmentName));
        } else {
          resources.push(resourceBinding(lease, "directory", directory, environmentName));
        }
      }
      const binding = signedBinding(request, resources);
      this.liveBindings.set(key, binding);
      await this.assertCurrent(request, binding);
      return cloneBinding(binding);
    } catch (error) {
      await this.cleanupPartial(request, resources).catch(() => undefined);
      throw error instanceof CouncilResourceHostError ? error : new CouncilResourceHostError(error instanceof Error ? error.message.slice(0, 512) : "Council resource host could not materialize every exact resource.");
    }
  }

  async assertCurrent(requestInput: CouncilResourceHostRequest, bindingInput: CouncilResourceHostBinding): Promise<void> {
    const request = await this.normalizedRequest(requestInput);
    const binding = validatedBinding(bindingInput, request);
    const expected = request.leases.filter(isHostedLease).sort((left, right) => left.id.localeCompare(right.id));
    if (binding.resources.length !== expected.length) throw new CouncilResourceHostError("Council resource host binding omitted or added a resource lease.");
    for (let index = 0; index < binding.resources.length; index += 1) {
      const resource = binding.resources[index]!;
      const lease = expected[index]!;
      if (resource.leaseId !== lease.id || resource.kind !== lease.kind || resource.fence !== lease.fence || resource.declaration !== lease.declaration
        || resource.environmentName !== environmentNameFor(lease.kind, index) || resource.bindingType !== bindingTypeFor(lease.kind)) {
        throw new CouncilResourceHostError("Council resource host binding changed its exact lease, order, type, environment, or fence.");
      }
      if (resource.kind === "port") {
        const server = this.ports.get(resource.leaseId);
        const address = server?.address();
        if (!server?.listening || !address || typeof address === "string" || address.address !== "127.0.0.1" || address.port !== Number(resource.value)) {
          throw new CouncilResourceHostError("Council loopback port is no longer held by its exact fenced resource host.");
        }
      } else if (resource.kind === "credential_scope") {
        if (!this.credentials || resource.credentialExpiresAt === undefined) throw new CouncilResourceHostError("Council credential capability is unavailable after its exact assignment.");
        const capability = { id: resource.value, expiresAt: resource.credentialExpiresAt };
        if (!await this.credentials.assertCurrent(capability, credentialIssue(request, lease))) throw new CouncilResourceHostError("Council credential capability is not current for its exact session fence.");
      } else {
        await this.assertDirectory(request, lease, resource.value);
        if (resource.kind === "database") this.assertDatabase(request, lease, resource.value);
      }
    }
    if (stableJson(binding) !== stableJson(signedBinding(request, binding.resources))) throw new CouncilResourceHostError("Council resource host exposed environment or capability data outside its exact binding.");
    this.liveBindings.set(bindingKey(request), cloneBinding(binding));
  }

  async recover(requestInput: CouncilResourceHostRequest, bindingInput: CouncilResourceHostBinding): Promise<void> {
    const request = await this.normalizedRequest(requestInput);
    const binding = validatedBinding(bindingInput, request);
    try {
      await this.assertCurrent(request, binding);
      return;
    } catch {
      // A new process has no handles. Close any partial local state before one
      // exact re-acquisition attempt. Credential capabilities are never reminted.
      await this.closeHandles(request);
    }
    const acquiredPorts: string[] = [];
    const openedDatabases: string[] = [];
    try {
      for (const resource of binding.resources) {
        const lease = requiredLease(request, resource);
        if (resource.kind === "port") {
          this.ports.set(resource.leaseId, await holdPort(Number(resource.value)));
          acquiredPorts.push(resource.leaseId);
        } else if (resource.kind === "credential_scope") {
          if (!this.credentials || resource.credentialExpiresAt === undefined
            || !await this.credentials.assertCurrent({ id: resource.value, expiresAt: resource.credentialExpiresAt }, credentialIssue(request, lease))) {
            throw new CouncilResourceHostError("Council restart could not prove the prior session-fenced credential capability; it was not reminted.");
          }
        } else {
          await this.assertDirectory(request, lease, resource.value);
          if (resource.kind === "database") {
            const database = new DatabaseSync(resource.value);
            this.databases.set(resource.leaseId, database);
            openedDatabases.push(resource.leaseId);
            this.assertDatabase(request, lease, resource.value);
          }
        }
      }
      this.liveBindings.set(bindingKey(request), cloneBinding(binding));
      await this.assertCurrent(request, binding);
    } catch (error) {
      for (const id of acquiredPorts) await closeServer(this.ports.get(id)).catch(() => undefined).finally(() => this.ports.delete(id));
      for (const id of openedDatabases) { this.databases.get(id)?.close(); this.databases.delete(id); }
      throw error instanceof CouncilResourceHostError ? error : new CouncilResourceHostError("Council restart resource reconciliation failed closed.");
    }
  }

  async preflightCleanup(requestInput: CouncilResourceHostRequest, binding?: CouncilResourceHostBinding): Promise<void> {
    const request = await this.normalizedRequest(requestInput);
    if (binding) validatedBinding(binding, request);
    for (const lease of request.leases.filter(isHostedLease)) {
      if (lease.kind === "port") {
        const held = this.ports.get(lease.id);
        if (held?.listening) {
          const address = held.address();
          if (!address || typeof address === "string" || address.address !== "127.0.0.1" || address.port !== exactPort(lease)) throw new CouncilResourceHostError("Council cleanup port handle changed identity.");
        } else {
          // A restarted host may have no prior handle. One exclusive bind proves
          // no other process stole the assignment before it is released.
          const probe = await holdPort(exactPort(lease));
          await closeServer(probe);
        }
        continue;
      }
      if (lease.kind === "credential_scope" && binding && !this.credentials) throw new CouncilResourceHostError("Council cleanup cannot revoke its opaque credential capability without the injected vault port.");
      if (!lease.localPath) continue;
      if (!await exists(lease.localPath)) continue;
      await this.assertOwnedDirectory(request, lease);
    }
  }

  async cleanup(requestInput: CouncilResourceHostRequest, binding?: CouncilResourceHostBinding): Promise<void> {
    const request = await this.normalizedRequest(requestInput);
    if (binding) validatedBinding(binding, request);
    await this.preflightCleanup(request, binding);
    await this.closeHandles(request);
    if (binding) {
      for (const resource of binding.resources.filter((candidate) => candidate.kind === "credential_scope")) {
        const lease = requiredLease(request, resource);
        if (this.credentials && resource.credentialExpiresAt !== undefined) {
          await this.credentials.revoke({ id: resource.value, expiresAt: resource.credentialExpiresAt }, credentialIssue(request, lease));
        }
      }
    }
    for (const lease of request.leases.filter(isHostedLease)) {
      if (lease.localPath && await exists(lease.localPath)) await rm(lease.localPath, { recursive: true, force: false });
    }
    this.liveBindings.delete(bindingKey(request));
  }

  /** Test/restart hook: imitates process handle loss without durable cleanup. */
  async shutdownForRestart(): Promise<void> {
    for (const server of this.ports.values()) await closeServer(server).catch(() => undefined);
    for (const database of this.databases.values()) database.close();
    this.ports.clear();
    this.databases.clear();
    this.liveBindings.clear();
  }

  private async normalizedRequest(input: CouncilResourceHostRequest): Promise<CouncilResourceHostRequest> {
    await mkdir(this.stateRoot, { recursive: true, mode: 0o700 });
    const canonicalState = await canonicalDirectory(this.stateRoot, "Council resource state root");
    const requestedState = await canonicalDirectory(input.stateRoot, "Council requested resource state root");
    if (!samePath(canonicalState, requestedState)) throw new CouncilResourceHostError("Council resource request is bound to a different host state root.");
    const repositoryRoot = await canonicalDirectory(input.repositoryRoot, "Council resource repository");
    if (!samePath(repositoryRoot, input.repositoryRoot) || inside(repositoryRoot, canonicalState) || inside(canonicalState, repositoryRoot)) throw new CouncilResourceHostError("Council resource state must be outside the exact repository.");
    if (!digestPattern.test(input.targetSnapshotId) || !input.epochId || !input.sessionId) throw new CouncilResourceHostError("Council resource request lacks an exact epoch, session, or TargetSnapshot.");
    for (const lease of input.leases) {
      if (!lease.id || !Number.isSafeInteger(lease.fence) || lease.fence < 1 || lease.status !== "active") throw new CouncilResourceHostError("Council resource lease lacks an active positive durable fence.");
      if (isHostedLease(lease) && !lease.declaration) throw new CouncilResourceHostError("Council hosted resource lacks its exact declaration.");
      if (lease.localPath && (!isAbsolute(lease.localPath) || !inside(canonicalState, lease.localPath))) throw new CouncilResourceHostError("Council resource path left the exact host-owned state root.");
    }
    return { ...input, repositoryRoot, stateRoot: canonicalState, leases: input.leases.map((lease) => ({ ...lease })) };
  }

  private async materializeDirectory(request: CouncilResourceHostRequest, lease: CouncilResourceHostLease): Promise<string> {
    if (!lease.localPath) throw new CouncilResourceHostError(`Council ${lease.kind} resource lacks a host-owned local path.`);
    await mkdir(dirname(lease.localPath), { recursive: true, mode: 0o700 });
    await mkdir(lease.localPath, { recursive: false, mode: 0o700 });
    const canonical = await canonicalDirectory(lease.localPath, `Council ${lease.kind} resource`);
    if (!samePath(canonical, lease.localPath) || !inside(request.stateRoot, canonical)) throw new CouncilResourceHostError("Council disposable resource changed canonical identity.");
    const marker = resourceMarker(request, lease);
    await writeFile(join(canonical, markerName), stableJson(marker), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(canonical, 0o700).catch(() => undefined);
    return canonical;
  }

  private async assertOwnedDirectory(request: CouncilResourceHostRequest, lease: CouncilResourceHostLease): Promise<string> {
    if (!lease.localPath) throw new CouncilResourceHostError(`Council ${lease.kind} resource lacks a cleanup path.`);
    const canonical = await canonicalDirectory(lease.localPath, `Council ${lease.kind} resource`);
    if (!samePath(canonical, lease.localPath) || !inside(request.stateRoot, canonical)) throw new CouncilResourceHostError("Council disposable resource path was replaced or escaped its state root.");
    const observed: unknown = JSON.parse(await readFile(join(canonical, markerName), "utf8"));
    if (stableJson(observed) !== stableJson(resourceMarker(request, lease))) throw new CouncilResourceHostError("Council resource ownership marker or fence changed.");
    return canonical;
  }

  private async assertDirectory(request: CouncilResourceHostRequest, lease: CouncilResourceHostLease, value: string): Promise<void> {
    const directory = await this.assertOwnedDirectory(request, lease);
    const expected = lease.kind === "database" ? join(directory, "resource.sqlite") : directory;
    if (!samePath(value, expected)) throw new CouncilResourceHostError("Council resource binding path changed from its exact lease.");
  }

  private assertDatabase(request: CouncilResourceHostRequest, lease: CouncilResourceHostLease, databasePath: string): void {
    let database = this.databases.get(lease.id);
    if (!database) throw new CouncilResourceHostError("Council SQLite resource is not held by this resource host process.");
    const row = database.prepare("SELECT epoch_id, session_id, lease_id, fence, fence_digest FROM sxsy_council_binding").get() as Record<string, unknown> | undefined;
    const expected = { epoch_id: request.epochId, session_id: request.sessionId, lease_id: lease.id, fence: lease.fence, fence_digest: fenceDigest(request) };
    if (!row || stableJson(row) !== stableJson(expected) || !samePath(databasePath, join(lease.localPath!, "resource.sqlite"))) throw new CouncilResourceHostError("Council SQLite resource metadata does not match its exact session fence.");
  }

  private async closeHandles(request: CouncilResourceHostRequest): Promise<void> {
    for (const lease of request.leases.filter(isHostedLease)) {
      if (lease.kind === "port") await closeServer(this.ports.get(lease.id)).catch(() => undefined).finally(() => this.ports.delete(lease.id));
      if (lease.kind === "database") { this.databases.get(lease.id)?.close(); this.databases.delete(lease.id); }
    }
  }

  private async cleanupPartial(request: CouncilResourceHostRequest, resources: readonly CouncilHostedResourceBinding[]): Promise<void> {
    await this.closeHandles(request);
    for (const resource of resources.filter((candidate) => candidate.kind === "credential_scope")) {
      const lease = requiredLease(request, resource);
      if (this.credentials && resource.credentialExpiresAt !== undefined) await this.credentials.revoke({ id: resource.value, expiresAt: resource.credentialExpiresAt }, credentialIssue(request, lease)).catch(() => undefined);
    }
    for (const lease of request.leases.filter(isHostedLease)) if (lease.localPath && await exists(lease.localPath)) {
      await this.assertOwnedDirectory(request, lease).then(() => rm(lease.localPath!, { recursive: true, force: false })).catch(() => undefined);
    }
  }
}

interface ActiveVaultCapability {
  readonly publicBinding: CouncilCredentialCapabilityBinding;
  readonly vaultLease: CredentialLease;
  readonly requestDigest: string;
}

/** Adapts the existing DPAPI-backed vault without exposing its redeemable lease. */
export class VaultBackedCouncilCredentialCapabilityPort implements CouncilCredentialVaultCapabilityPort {
  private readonly active = new Map<string, ActiveVaultCapability>();
  constructor(
    private readonly adapter: CredentialAdapterPort,
    private readonly idFactory: () => string = randomUUID
  ) {}

  async issue(request: CouncilCredentialVaultIssueRequest): Promise<CouncilCredentialCapabilityBinding> {
    const vaultLease = await this.adapter.acquireLease({ reference: request.reference, repositoryRoot: request.repositoryRoot, purpose: "council-session", ttlMs: 60_000 });
    const id = `council-capability:${this.idFactory()}`;
    if (!capabilityIdPattern.test(id)) throw new CouncilResourceHostError("Council credential vault returned an invalid opaque capability identity.");
    const publicBinding = Object.freeze({ id, expiresAt: vaultLease.expiresAt });
    this.active.set(id, { publicBinding, vaultLease, requestDigest: sha256(stableJson(request)) });
    return publicBinding;
  }

  async assertCurrent(binding: CouncilCredentialCapabilityBinding, request: CouncilCredentialVaultIssueRequest): Promise<boolean> {
    const active = this.active.get(binding.id);
    return active !== undefined
      && active.publicBinding.expiresAt === binding.expiresAt
      && active.publicBinding.expiresAt > Date.now()
      && active.requestDigest === sha256(stableJson(request));
  }

  async revoke(binding: CouncilCredentialCapabilityBinding, request: CouncilCredentialVaultIssueRequest): Promise<void> {
    const active = this.active.get(binding.id);
    if (active && active.publicBinding.expiresAt === binding.expiresAt && active.requestDigest === sha256(stableJson(request))) this.active.delete(binding.id);
  }

  /** Host-only redemption; the opaque public identifier is insufficient without the exact fence binding. */
  async withCredential<T>(binding: CouncilCredentialCapabilityBinding, request: CouncilCredentialVaultIssueRequest, consume: (cleartext: Uint8Array) => Promise<T>): Promise<T> {
    if (!await this.assertCurrent(binding, request)) throw new CouncilResourceHostError("Council credential capability is expired, revoked, or bound to another session fence.");
    const active = this.active.get(binding.id)!;
    this.active.delete(binding.id);
    return this.adapter.redeem(active.vaultLease, consume);
  }
}

function signedBinding(request: CouncilResourceHostRequest, resources: readonly CouncilHostedResourceBinding[]): CouncilResourceHostBinding {
  const capabilities = [...new Set(resources.map((resource): CouncilResourceHostCapability => {
    if (resource.kind === "port") return "held-loopback-port";
    if (resource.kind === "cache") return "disposable-cache-directory";
    if (resource.kind === "temp") return "disposable-temp-directory";
    if (resource.kind === "database") return "sqlite-database";
    return "session-fenced-credential-capability";
  }))].sort();
  const environment: Record<string, string> = {
    SXSY_COUNCIL_EPOCH_ID: request.epochId,
    SXSY_COUNCIL_SESSION_ID: request.sessionId,
    SXSY_COUNCIL_TARGET_SNAPSHOT_ID: request.targetSnapshotId,
    SXSY_COUNCIL_WORKTREE_ROOT: request.worktreeRoot,
    SXSY_COUNCIL_BRANCH: request.branch,
    SXSY_COUNCIL_HEAD: request.head,
    SXSY_COUNCIL_RESOURCE_FENCE_DIGEST: fenceDigest(request)
  };
  for (const resource of resources) environment[resource.environmentName] = resource.value;
  const unsigned = {
    schema: "sxsy-b122.council-resource-host" as const,
    version: 1 as const,
    epochId: request.epochId,
    sessionId: request.sessionId,
    fenceDigest: fenceDigest(request),
    capabilities,
    resources: resources.map((resource) => ({ ...resource })),
    environment
  };
  return { ...unsigned, digest: sha256(stableJson(unsigned)) };
}

function validatedBinding(binding: CouncilResourceHostBinding, request: CouncilResourceHostRequest): CouncilResourceHostBinding {
  if (binding.schema !== "sxsy-b122.council-resource-host" || binding.version !== 1 || binding.epochId !== request.epochId || binding.sessionId !== request.sessionId
    || binding.fenceDigest !== fenceDigest(request) || !digestPattern.test(binding.digest)) throw new CouncilResourceHostError("Council resource host binding does not match its exact epoch/session fence.");
  const { digest: _digest, ...unsigned } = binding;
  if (sha256(stableJson(unsigned)) !== binding.digest) throw new CouncilResourceHostError("Council resource host binding digest is invalid.");
  if (!Array.isArray(binding.resources) || !Array.isArray(binding.capabilities) || !record(binding.environment)) throw new CouncilResourceHostError("Council resource host binding is malformed.");
  return cloneBinding(binding);
}

function createDatabase(path: string, request: CouncilResourceHostRequest, lease: CouncilResourceHostLease): DatabaseSync {
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE sxsy_council_binding(epoch_id TEXT NOT NULL, session_id TEXT NOT NULL, lease_id TEXT NOT NULL, fence INTEGER NOT NULL, fence_digest TEXT NOT NULL); BEGIN IMMEDIATE;");
    database.prepare("INSERT INTO sxsy_council_binding(epoch_id, session_id, lease_id, fence, fence_digest) VALUES (?, ?, ?, ?, ?)").run(request.epochId, request.sessionId, lease.id, lease.fence, fenceDigest(request));
    database.exec("COMMIT;");
    return database;
  } catch (error) {
    try { database.exec("ROLLBACK;"); } catch { /* no active transaction */ }
    database.close();
    throw error;
  }
}

function resourceMarker(request: CouncilResourceHostRequest, lease: CouncilResourceHostLease): unknown {
  return { schema: "sxsy-b122.council-resource", version: 1, epochId: request.epochId, sessionId: request.sessionId, leaseId: lease.id, kind: lease.kind, fence: lease.fence, fenceDigest: fenceDigest(request) };
}

function credentialIssue(request: CouncilResourceHostRequest, lease: CouncilResourceHostLease): CouncilCredentialVaultIssueRequest {
  return {
    reference: lease.declaration!.slice(lease.declaration!.indexOf(":") + 1),
    repositoryRoot: request.repositoryRoot,
    epochId: request.epochId,
    sessionId: request.sessionId,
    leaseId: lease.id,
    fence: lease.fence,
    fenceDigest: fenceDigest(request)
  };
}

function fenceDigest(request: CouncilResourceHostRequest): string {
  return sha256(stableJson({
    epochId: request.epochId,
    targetSnapshotId: request.targetSnapshotId,
    repositoryRoot: request.repositoryRoot,
    stateRoot: request.stateRoot,
    sessionId: request.sessionId,
    worktreeRoot: request.worktreeRoot,
    branch: request.branch,
    head: request.head,
    leases: request.leases.map((lease) => ({
      id: lease.id,
      kind: lease.kind,
      ...(lease.declaration ? { declaration: lease.declaration } : {}),
      ...(lease.localPath ? { localPath: lease.localPath } : {}),
      fence: lease.fence,
      status: lease.status
    }))
  }));
}

function resourceBinding(lease: CouncilResourceHostLease, bindingType: CouncilHostedResourceBinding["bindingType"], value: string, environmentName: string): CouncilHostedResourceBinding {
  return { leaseId: lease.id, kind: lease.kind as CouncilHostedResourceKind, fence: lease.fence, declaration: lease.declaration!, bindingType, value, environmentName };
}

function environmentNameFor(kind: CouncilHostedResourceKind, index: number): string {
  return `SXSY_COUNCIL_${kind === "credential_scope" ? "CREDENTIAL_CAPABILITY_ID" : kind.toUpperCase()}_${index + 1}`;
}

function bindingTypeFor(kind: CouncilHostedResourceKind): CouncilHostedResourceBinding["bindingType"] {
  if (kind === "port") return "loopback-listener";
  if (kind === "database") return "sqlite";
  if (kind === "credential_scope") return "opaque-credential-capability";
  return "directory";
}

function bindingKey(request: Pick<CouncilResourceHostRequest, "epochId" | "sessionId">): string { return `${request.epochId}\0${request.sessionId}`; }
function isHostedLease(lease: CouncilResourceHostLease): lease is CouncilResourceHostLease & { readonly kind: CouncilHostedResourceKind } { return lease.kind !== "branch" && lease.kind !== "worktree"; }
function exactPort(lease: CouncilResourceHostLease): number {
  const value = lease.declaration?.slice((lease.declaration?.indexOf(":") ?? -1) + 1) ?? "";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || String(port) !== value) throw new CouncilResourceHostError("Council port declaration is not an exact unprivileged loopback port.");
  return port;
}

function requiredLease(request: CouncilResourceHostRequest, resource: CouncilHostedResourceBinding): CouncilResourceHostLease {
  const lease = request.leases.find((candidate) => candidate.id === resource.leaseId);
  if (!lease || !isHostedLease(lease)) throw new CouncilResourceHostError("Council resource host binding refers to an unknown lease.");
  return lease;
}

async function holdPort(port: number): Promise<Server> {
  return new Promise((resolveServer, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.unref();
    server.once("error", (error) => { server.close(); reject(new CouncilResourceHostError(`Council could not exclusively hold loopback port ${port}: ${error.message}`)); });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.removeAllListeners("error");
      server.on("error", () => { /* assertCurrent observes a lost listener */ });
      resolveServer(server);
    });
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

function validateCapability(value: CouncilCredentialCapabilityBinding): CouncilCredentialCapabilityBinding {
  if (!capabilityIdPattern.test(value.id) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) throw new CouncilResourceHostError("Council credential vault returned an invalid opaque capability binding.");
  return Object.freeze({ id: value.id, expiresAt: value.expiresAt });
}

async function canonicalDirectory(path: string, field: string): Promise<string> {
  const canonical = await realpath(resolve(path)).catch(() => { throw new CouncilResourceHostError(`${field} is unavailable or cannot be canonicalized.`); });
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new CouncilResourceHostError(`${field} is not a directory.`);
  return canonical;
}
async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (error) { return isNodeError(error, "ENOENT") ? false : Promise.reject(error); } }
function isNodeError(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code; }
function samePath(left: string, right: string): boolean { return resolve(left).replace(/[\\/]+$/, "").toLowerCase() === resolve(right).replace(/[\\/]+$/, "").toLowerCase(); }
function inside(parent: string, candidate: string): boolean { const rel = relative(resolve(parent), resolve(candidate)); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function cloneBinding(binding: CouncilResourceHostBinding): CouncilResourceHostBinding { return JSON.parse(JSON.stringify(binding)) as CouncilResourceHostBinding; }
