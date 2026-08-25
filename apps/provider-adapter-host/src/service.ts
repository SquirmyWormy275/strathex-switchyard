import { createHash, timingSafeEqual } from "node:crypto";

import type { Capability, ManagedSession, SessionStatus } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { sha256, stableJson, type ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  LocalProviderCommandGateway,
  type AuthenticatedProviderGatewayClient,
  type ProviderGatewayProvider
} from "../../windows-companion/src/provider-gateway.ts";
import type { ProviderAdapterBackend } from "./backends.ts";
import {
  councilEventKind,
  councilKey,
  readCouncilPhases,
  type CouncilPhase,
  type ProviderCouncilAcknowledgement,
  type ProviderCouncilCleanupAcknowledgement,
  type ProviderCouncilCleanupRequest,
  type ProviderCouncilHostedResource,
  type ProviderCouncilLease,
  type ProviderCouncilRequest,
  type ProviderCouncilResourceHost,
  type SavedCouncilPhase
} from "./state.ts";

const maximumRequestBytes = 64 * 1024;
const providerOperationKind = "provider-gateway.operation";
const councilCleanupKind = "provider-host.council-cleanup";

export interface ProviderHostRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
}

export interface ProviderHostResponse {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly afterResponse?: () => void;
}

export interface ProviderAdapterHostServiceOptions {
  readonly authenticationToken: string;
  readonly store: ProtectedJsonStore;
  readonly backends: readonly ProviderAdapterBackend[];
  readonly now?: () => string;
  readonly lifecycle?: Readonly<{
    nonce: string;
    processId: number;
    configurationSha256: string;
    requestShutdown(): void;
  }>;
}

export interface ProviderHostReconciliationReceipt {
  readonly operationsInspected: number;
  readonly operationsSettled: number;
  readonly councilsInspected: number;
  readonly councilsSettled: number;
}

/** Authenticated exact-route provider service. It never derives a route, target, credential, or provider from repository text. */
export class ProviderAdapterHostService {
  private readonly tokenDigest: Buffer;
  private readonly gatewayToken: string;
  private readonly store: ProtectedJsonStore;
  private readonly sessions: SessionRegistry;
  private readonly gateway: AuthenticatedProviderGatewayClient;
  private readonly backends: ReadonlyMap<ProviderGatewayProvider, ProviderAdapterBackend>;
  private readonly now: () => string;
  private readonly lifecycle?: ProviderAdapterHostServiceOptions["lifecycle"];
  private readonly inFlightCouncilCleanups = new Map<string, Readonly<{ requestDigest: string; result: Promise<ProviderHostResponse> }>>();

  constructor(options: ProviderAdapterHostServiceOptions) {
    if (!/^[a-f0-9]{64}$/.test(options.authenticationToken)) throw new Error("The provider host authentication token must be exactly 256 canonical bits.");
    if (!options.store.hasAuthenticatedProtection) throw new Error("The provider adapter host requires authenticated durable state.");
    const backends = new Map<ProviderGatewayProvider, ProviderAdapterBackend>();
    for (const backend of options.backends) {
      if (backends.has(backend.provider)) throw new Error(`Duplicate provider adapter backend: ${backend.provider}`);
      backends.set(backend.provider, backend);
    }
    if (!backends.size) throw new Error("At least one exact provider adapter backend is required.");
    this.gatewayToken = options.authenticationToken;
    this.tokenDigest = createHash("sha256").update(options.authenticationToken, "ascii").digest();
    this.store = options.store;
    this.sessions = new SessionRegistry(options.store, { clock: options.now });
    this.now = options.now ?? (() => new Date().toISOString());
    this.backends = backends;
    if (options.lifecycle && (!digest(options.lifecycle.nonce) || !Number.isSafeInteger(options.lifecycle.processId) || options.lifecycle.processId < 1 || !digest(options.lifecycle.configurationSha256))) throw new Error("The provider-host lifecycle identity is invalid.");
    this.lifecycle = options.lifecycle;
    this.gateway = new LocalProviderCommandGateway({
      store: options.store,
      sessions: this.sessions,
      authenticationToken: this.gatewayToken,
      backends: [...backends.values()],
      now: this.now
    }).connect(this.gatewayToken);
  }

  async handle(input: ProviderHostRequest): Promise<ProviderHostResponse> {
    if (!this.authenticated(input.headers.authorization)) return response(401, { schema: "sxsy-b122.provider-host-error", version: 1, status: "unauthorized", summary: "Provider host authentication failed.", effectDisposition: "not_started" });
    if (bodyLength(input.body) > maximumRequestBytes) return errorResponse(413, "The provider host request exceeded its fixed input cap.");
    try {
      if (input.method === "GET" && input.path === "/v1/b122/health" && input.body === undefined) return this.health();
      if (input.method !== "POST") return errorResponse(405, "The provider host route requires an exact method.");
      if (input.path === "/v1/b122/lifecycle/shutdown") return this.shutdown(input.body);
      const handshakeMatch = /^\/v1\/b122\/handshake\/(claude|codex)$/.exec(input.path);
      if (handshakeMatch) return await this.handshake(handshakeMatch[1] as ProviderGatewayProvider, input.body, input.signal);
      const commandMatch = /^\/v1\/b122\/command\/([a-z][a-z0-9_]*)$/.exec(input.path);
      if (commandMatch) return await this.gatewayRequest(`provider.${commandMatch[1]}`, input.body, input.signal);
      const automationMatch = /^\/v1\/b122\/automation\/([a-z][a-z0-9_]*)$/.exec(input.path);
      if (automationMatch) return await this.gatewayRequest(`automation.${automationMatch[1]}`, input.body, input.signal);
      const councilMatch = /^\/v1\/b122\/council\/(claude|codex)$/.exec(input.path);
      if (councilMatch) return await this.council(councilMatch[1] as ProviderGatewayProvider, input.body, input.signal);
      const councilCleanupMatch = /^\/v1\/b122\/council\/cleanup\/(claude|codex)$/.exec(input.path);
      if (councilCleanupMatch) return await this.cleanupCouncil(councilCleanupMatch[1] as ProviderGatewayProvider, input.body);
      const sessionMatch = /^\/v1\/b122\/observe\/session\/(claude|codex)$/.exec(input.path);
      if (sessionMatch) return await this.observeSession(sessionMatch[1] as ProviderGatewayProvider, input.body);
      const operationMatch = /^\/v1\/b122\/observe\/operation\/(claude|codex)$/.exec(input.path);
      if (operationMatch) return await this.observeOperation(operationMatch[1] as ProviderGatewayProvider, input.body);
      const cancelMatch = /^\/v1\/b122\/cancel\/(claude|codex)$/.exec(input.path);
      if (cancelMatch) return await this.cancel(cancelMatch[1] as ProviderGatewayProvider, input.body);
      if (input.path === "/v1/b122/reconcile") return response(200, { schema: "sxsy-b122.provider-host-reconciliation", version: 1, ...(await this.reconcile()) });
      return errorResponse(404, "No exact provider host route matches this request.");
    } catch (error) {
      if (error instanceof CouncilConflictError) return errorResponse(409, safeError(error));
      if (error instanceof CouncilUnresolvedError) return errorResponse(503, safeError(error), "ambiguous");
      return errorResponse(400, safeError(error));
    }
  }

  async reconcile(): Promise<ProviderHostReconciliationReceipt> {
    const entries = await this.store.readEntries();
    const latestOperations = new Map<string, { operationId: string; state: string }>();
    for (const entry of entries) {
      if (entry.kind !== providerOperationKind || !record(entry.payload) || !record(entry.payload.operation)) continue;
      const operation = entry.payload.operation;
      if (safeIdentifier(operation.operationId) && typeof operation.state === "string") latestOperations.set(operation.operationId, { operationId: operation.operationId, state: operation.state });
    }
    const uncertainOperations = [...latestOperations.values()].filter((operation) => operation.state === "submitted" || operation.state === "unresolved");
    let operationsSettled = 0;
    for (const operation of uncertainOperations) {
      const observed = await this.gateway.observeOperation(operation.operationId);
      if (observed.settled) operationsSettled += 1;
    }

    const councils = await readCouncilPhases(this.store);
    const uncertainCouncils = [...councils.values()].filter((entry) => entry.state === "submitted" || entry.state === "unresolved");
    let councilsSettled = 0;
    for (const saved of uncertainCouncils) {
      const backend = this.backends.get(saved.provider);
      if (!backend) continue;
      const session = await this.sessions.get(saved.request.sessionId);
      if (!session?.workspaceRoot || !await this.refreshExactSession(saved.request.sessionId, saved.provider, saved.request.targetSnapshotId, session.workspaceRoot)) continue;
      const acknowledgement = await backend.observeCouncil(saved.request, new AbortController().signal).catch(() => undefined);
      if (!acknowledgement) continue;
      await this.saveCouncil({ ...saved, state: "acknowledged", acknowledgement, updatedAt: this.timestamp() });
      councilsSettled += 1;
    }
    return { operationsInspected: uncertainOperations.length, operationsSettled, councilsInspected: uncertainCouncils.length, councilsSettled };
  }

  private health(): ProviderHostResponse {
    return response(200, {
      schema: "sxsy-b122.provider-host-health", version: 1, status: "ready",
      adapterVersion: "sxsy-b122-provider-host-v1", providers: [...this.backends.keys()].sort(),
      authenticatedState: true,
      ...(this.lifecycle ? { lifecycleNonceSha256: sha256(this.lifecycle.nonce), processId: this.lifecycle.processId, configurationSha256: this.lifecycle.configurationSha256 } : {})
    });
  }

  private shutdown(body: string | Uint8Array | undefined): ProviderHostResponse {
    if (!this.lifecycle) return errorResponse(503, "The provider host has no installed lifecycle controller.");
    const value = parseBody(body);
    if (!exactKeys(value, ["schema", "version", "lifecycleNonce", "expectedProcessId", "configurationSha256"])
      || value.schema !== "sxsy-b122.provider-host-shutdown" || value.version !== 1 || value.lifecycleNonce !== this.lifecycle.nonce
      || value.expectedProcessId !== this.lifecycle.processId || value.configurationSha256 !== this.lifecycle.configurationSha256) {
      return errorResponse(409, "The provider-host shutdown identity does not match the exact running lifecycle.");
    }
    return {
      status: 200,
      body: { schema: "sxsy-b122.provider-host-shutdown-ack", version: 1, accepted: true, processId: this.lifecycle.processId, lifecycleNonceSha256: sha256(this.lifecycle.nonce), configurationSha256: this.lifecycle.configurationSha256 },
      afterResponse: this.lifecycle.requestShutdown
    };
  }

  private async handshake(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined, signal?: AbortSignal): Promise<ProviderHostResponse> {
    const document = parseBody(body);
    if (document.schema !== "sxsy-b122.provider-handshake-request" || document.version !== 1 || document.provider !== provider
      || !allowedKeys(document, ["schema", "version", "sessionId", "provider", "targetSnapshotId", "repositoryRoot"], ["branch", "head", "requestedAt"])
      || !safeIdentifier(document.sessionId) || !digest(document.targetSnapshotId) || !absoluteRoot(document.repositoryRoot)) {
      return errorResponse(400, "The provider handshake envelope is invalid.");
    }
    const result = await this.gateway.request({ routeId: `provider.handshake.${provider}`, repositoryRoot: document.repositoryRoot, body: encode(document), ...(signal ? { signal } : {}) });
    const mapped = mapGatewayResult(result);
    if (mapped.status !== 200) return mapped;
    const handshake = mapped.body;
    await this.sessions.upsert({
      id: document.sessionId,
      provider,
      surface: "bridge",
      capabilities: capabilities(handshake.capabilities),
      status: sessionStatus(handshake.status),
      workspaceRoot: document.repositoryRoot,
      targetSnapshotId: document.targetSnapshotId,
      ...(safeIdentifier(handshake.taskId) ? { taskId: handshake.taskId } : {}),
      ...(safeIdentifier(handshake.planRevision) ? { planRevision: handshake.planRevision } : {}),
      plannedFiles: stringList(handshake.plannedFiles),
      adapterVersion: safeAdapterVersion(handshake.adapterVersion),
      metadata: {
        "sxsy-b122.providerHandshake": "exact-route-v1",
        "sxsy-b122.providerHandshakeTarget": document.targetSnapshotId,
        "sxsy-b122.resources": JSON.stringify(stringList(handshake.resources)),
        "sxsy-b122.dependencies": JSON.stringify(stringList(handshake.dependencies)),
        "sxsy-b122.diffDigest": digest(handshake.diffDigest) ? handshake.diffDigest : sha256("")
      },
      lastHeartbeat: this.timestamp()
    });
    return mapped;
  }

  private async gatewayRequest(routeId: string, body: string | Uint8Array | undefined, signal?: AbortSignal): Promise<ProviderHostResponse> {
    const document = parseBody(body);
    const target = record(document.target) ? document.target : undefined;
    if (!target || !absoluteRoot(target.repositoryRoot)) return errorResponse(400, "The provider command lacks an exact absolute repository root.");
    return mapGatewayResult(await this.gateway.request({ routeId, repositoryRoot: target.repositoryRoot, body: encode(document), ...(signal ? { signal } : {}) }));
  }

  private async observeSession(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined): Promise<ProviderHostResponse> {
    const document = exactOperationDocument(parseBody(body), "sxsy-b122.provider-session-observe", "session");
    const current = await this.exactSession(document.sessionId, provider, document.targetSnapshotId, document.repositoryRoot);
    if (!current) return errorResponse(409, "The requested provider session binding is no longer current.");
    const observed = await this.gateway.observeSession(document.sessionId);
    return response(200, {
      schema: "sxsy-b122.provider-session-observation", version: 1,
      sessionId: observed.id, provider, targetSnapshotId: observed.targetSnapshotId,
      repositoryRoot: observed.workspaceRoot, status: observed.status, capabilities: observed.capabilities,
      adapterVersion: observed.adapterVersion
    });
  }

  private async observeOperation(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined): Promise<ProviderHostResponse> {
    const document = exactOperationDocument(parseBody(body), "sxsy-b122.provider-operation-observe", "operation");
    const current = await this.exactSession(document.sessionId, provider, document.targetSnapshotId, document.repositoryRoot);
    if (!current) return errorResponse(409, "The requested provider operation session binding is no longer current.");
    if (!await this.exactDurableOperation(document, provider)) return errorResponse(404, "No exact durable provider operation matches the complete requested identity.");
    const observed = await this.gateway.observeProviderOperation({ repositoryRoot: document.repositoryRoot, routeId: document.routeId!, externalId: document.externalId!, targetSnapshotId: document.targetSnapshotId });
    if (!observed) return errorResponse(404, "No exact provider operation exists.");
    return response(200, {
      schema: "sxsy-b122.provider-operation-observation", version: 1,
      operationId: document.operationId!, externalId: document.externalId!, routeId: document.routeId!,
      sessionId: document.sessionId, provider, targetSnapshotId: document.targetSnapshotId,
      repositoryRoot: document.repositoryRoot, outcome: observed.outcome, summary: observed.note
    });
  }

  private async cancel(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined): Promise<ProviderHostResponse> {
    const value = parseBody(body);
    const document = exactOperationDocument(value, "sxsy-b122.provider-operation-cancel", "cancel");
    if (!safeSummary(value.reason, 1_024)) throw new Error("The provider cancellation reason is invalid.");
    const current = await this.refreshExactSession(document.sessionId, provider, document.targetSnapshotId, document.repositoryRoot);
    if (!current) return errorResponse(409, "The requested provider cancellation session binding is no longer current.");
    if (!await this.exactDurableOperation(document, provider)) return errorResponse(404, "No exact durable provider operation matches the complete requested identity.");
    const before = await this.gateway.observeProviderOperation({ repositoryRoot: document.repositoryRoot, routeId: document.routeId!, externalId: document.externalId!, targetSnapshotId: document.targetSnapshotId });
    if (!before) return errorResponse(404, "No exact provider operation exists.");
    const cancelled = await this.gateway.cancelByOperation(document.operationId!, value.reason);
    return response(cancelled === 1 ? 200 : 409, {
      schema: "sxsy-b122.provider-cancellation-ack", version: 1, operationId: document.operationId,
      externalId: document.externalId, sessionId: document.sessionId, provider,
      targetSnapshotId: document.targetSnapshotId, accepted: cancelled === 1,
      summary: cancelled === 1 ? "The exact provider operation cancellation was acknowledged." : "The operation was already terminal or cancelled."
    });
  }

  private async council(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined, signal?: AbortSignal): Promise<ProviderHostResponse> {
    const request = parseCouncil(parseBody(body));
    const current = await this.sessions.get(request.sessionId);
    if (!current || current.provider !== provider || current.targetSnapshotId !== request.targetSnapshotId || !current.workspaceRoot
      || rootKey(current.workspaceRoot) !== rootKey(request.repositoryRoot)) {
      return errorResponse(409, "The Council provider session and target are no longer current.");
    }
    const requestDigest = sha256(stableJson(request));
    const key = councilKey(request);
    let replay: ProviderCouncilAcknowledgement | undefined;
    let shouldDispatch = false;
    await this.store.transaction(async (transaction) => {
      const states = await readCouncilPhases(transaction);
      const existing = states.get(key);
      if (existing) {
        if (existing.requestDigest !== requestDigest || existing.provider !== provider) throw new CouncilConflictError("The durable Council phase identity is bound to a different exact request.");
        if (existing.state === "acknowledged" && existing.acknowledgement) replay = existing.acknowledgement;
        else throw new CouncilUnresolvedError("The Council phase may already have started and requires observation before retry.");
        return;
      }
      requireCouncilOrder(states, request);
      const submitted: SavedCouncilPhase = { key, provider, requestDigest, request, state: "submitted", updatedAt: this.timestamp() };
      await transaction.append(councilEventKind, { ...submitted });
      shouldDispatch = true;
    });
    if (replay) return response(200, replay as unknown as Readonly<Record<string, unknown>>);
    if (!shouldDispatch) throw new CouncilUnresolvedError("The Council phase was not dispatchable.");
    const backend = this.backends.get(provider);
    if (!backend) return errorResponse(503, `No ${provider} provider backend is installed.`);
    const submitted: SavedCouncilPhase = { key, provider, requestDigest, request, state: "submitted", updatedAt: this.timestamp() };
    try {
      const acknowledgement = await backend.council(request, signal ?? new AbortController().signal);
      await this.saveCouncil({ ...submitted, state: "acknowledged", acknowledgement, updatedAt: this.timestamp() });
      return response(200, acknowledgement as unknown as Readonly<Record<string, unknown>>);
    } catch {
      await this.saveCouncil({ ...submitted, state: "unresolved", updatedAt: this.timestamp() });
      return errorResponse(503, "The Council acknowledgement is ambiguous and must be observed before retry.", "ambiguous");
    }
  }

  private async cleanupCouncil(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined): Promise<ProviderHostResponse> {
    const request = parseCouncilCleanup(parseBody(body));
    const cleanupKey = `${provider}:${request.epochId}:${request.sessionId}:${request.resourceHostDigest}`;
    const requestDigest = sha256(stableJson(request));
    const active = this.inFlightCouncilCleanups.get(cleanupKey);
    if (active) return active.requestDigest === requestDigest
      ? active.result
      : errorResponse(409, "The active Council cleanup identity is bound to another exact request.");
    const result = this.cleanupCouncilOnce(provider, request, cleanupKey, requestDigest).finally(() => {
      if (this.inFlightCouncilCleanups.get(cleanupKey)?.result === result) this.inFlightCouncilCleanups.delete(cleanupKey);
    });
    this.inFlightCouncilCleanups.set(cleanupKey, { requestDigest, result });
    return result;
  }

  private async cleanupCouncilOnce(provider: ProviderGatewayProvider, request: ProviderCouncilCleanupRequest, cleanupKey: string, requestDigest: string): Promise<ProviderHostResponse> {
    let replay: ProviderCouncilCleanupAcknowledgement | undefined;
    let conflict: string | undefined;
    await this.store.transaction(async (transaction) => {
      for (const entry of await transaction.readEntries()) {
        if (entry.kind !== councilCleanupKind || !record(entry.payload) || entry.payload.key !== cleanupKey) continue;
        if (entry.payload.requestDigest !== requestDigest) { conflict = "The durable Council cleanup identity is bound to another exact request."; return; }
        if (entry.payload.state === "acknowledged" && record(entry.payload.acknowledgement)) replay = entry.payload.acknowledgement as unknown as ProviderCouncilCleanupAcknowledgement;
      }
      if (replay || conflict) return;
      const states = await readCouncilPhases(transaction);
      const assignment = states.get(`${request.epochId}:${request.sessionId}:assignment`);
      if (assignment?.state !== "acknowledged" || assignment.provider !== provider || assignment.request.targetSnapshotId !== request.targetSnapshotId
        || assignment.request.resourceHost?.digest !== request.resourceHostDigest) { conflict = "The Council cleanup request does not match one acknowledged resource-host assignment."; return; }
      if (request.outcome === "completed") {
        const resume = states.get(`${request.epochId}:${request.sessionId}:resume`);
        if (resume?.state !== "acknowledged" || resume.provider !== provider || resume.request.targetSnapshotId !== request.targetSnapshotId
          || resume.request.resourceHost?.digest !== request.resourceHostDigest) { conflict = "Completed Council cleanup requires the exact acknowledged resume binding."; return; }
      }
      await transaction.append(councilCleanupKind, { key: cleanupKey, provider, requestDigest, request, state: "submitted", updatedAt: this.timestamp() });
    });
    if (conflict) return errorResponse(409, conflict);
    if (replay) return response(200, replay as unknown as Readonly<Record<string, unknown>>);
    const backend = this.backends.get(provider);
    if (!backend) return errorResponse(503, "The exact Council cleanup backend is unavailable.");
    try { await backend.cleanupCouncilResources(request); }
    catch { await this.store.append(councilCleanupKind, { key: cleanupKey, provider, requestDigest, request, state: "unresolved", updatedAt: this.timestamp() }); return errorResponse(503, "The exact Council cleanup remains pending and will be retried idempotently.", "ambiguous"); }
    const acknowledgement: ProviderCouncilCleanupAcknowledgement = { ...request, schema: "sxsy-b122.council-resource-cleanup-ack", closed: true };
    await this.store.append(councilCleanupKind, { key: cleanupKey, provider, requestDigest, request, state: "acknowledged", acknowledgement, updatedAt: this.timestamp() });
    return response(200, acknowledgement as unknown as Readonly<Record<string, unknown>>);
  }

  private async exactSession(sessionId: string, provider: ProviderGatewayProvider, targetSnapshotId: string, repositoryRoot: string): Promise<ManagedSession | undefined> {
    const session = await this.sessions.get(sessionId);
    return session && session.provider === provider && session.targetSnapshotId === targetSnapshotId && session.workspaceRoot && rootKey(session.workspaceRoot) === rootKey(repositoryRoot) ? session : undefined;
  }

  private async refreshExactSession(sessionId: string, provider: ProviderGatewayProvider, targetSnapshotId: string, repositoryRoot: string): Promise<ManagedSession | undefined> {
    if (!await this.exactSession(sessionId, provider, targetSnapshotId, repositoryRoot)) return undefined;
    const observed = await this.gateway.observeSession(sessionId).catch(() => undefined);
    return observed && observed.provider === provider && observed.targetSnapshotId === targetSnapshotId && observed.workspaceRoot
      && rootKey(observed.workspaceRoot) === rootKey(repositoryRoot) && observed.capabilities.includes("observable")
      && observed.metadata["sxsy-b122.providerHandshake"] === "exact-route-v1"
      ? observed : undefined;
  }

  private async exactDurableOperation(document: ExactOperationDocument, provider: ProviderGatewayProvider): Promise<boolean> {
    let latest: Record<string, unknown> | undefined;
    for (const entry of await this.store.readEntries()) {
      if (entry.kind !== providerOperationKind || !record(entry.payload) || !record(entry.payload.operation)) continue;
      if (entry.payload.operation.operationId === document.operationId) latest = entry.payload.operation;
    }
    return !!latest && latest.operationId === document.operationId && latest.externalId === document.externalId
      && latest.routeId === document.routeId && latest.sessionId === document.sessionId && latest.provider === provider
      && latest.targetSnapshotId === document.targetSnapshotId && typeof latest.repositoryRoot === "string"
      && rootKey(latest.repositoryRoot) === rootKey(document.repositoryRoot);
  }

  private async saveCouncil(saved: SavedCouncilPhase): Promise<void> { await this.store.append(councilEventKind, { ...saved }); }
  private timestamp(): string { const value = this.now(); if (!Number.isFinite(Date.parse(value))) throw new Error("The provider host clock is invalid."); return value; }
  private authenticated(value: string | undefined): boolean {
    if (!value?.startsWith("Bearer ")) return false;
    const token = value.slice("Bearer ".length);
    if (!/^[a-f0-9]{64}$/.test(token)) return false;
    return timingSafeEqual(this.tokenDigest, createHash("sha256").update(token, "ascii").digest());
  }
}

interface ExactOperationDocument { readonly sessionId: string; readonly targetSnapshotId: string; readonly repositoryRoot: string; readonly operationId?: string; readonly externalId?: string; readonly routeId?: string; }

function exactOperationDocument(value: Record<string, unknown>, schema: string, kind: "session" | "operation" | "cancel"): ExactOperationDocument {
  if (value.schema !== schema || value.version !== 1 || !safeIdentifier(value.sessionId) || !digest(value.targetSnapshotId) || !absoluteRoot(value.repositoryRoot)) throw new Error("The provider observation envelope is invalid.");
  const operation = kind !== "session";
  const keys = operation ? ["schema", "version", "operationId", "externalId", "routeId", "sessionId", "targetSnapshotId", "repositoryRoot", ...(kind === "cancel" ? ["reason"] : [])] : ["schema", "version", "sessionId", "targetSnapshotId", "repositoryRoot"];
  if (!exactKeys(value, keys) || (operation && (!safeIdentifier(value.operationId) || !safeIdentifier(value.externalId) || !safeRoute(value.routeId)))) throw new Error("The provider operation identity is invalid.");
  return { sessionId: value.sessionId, targetSnapshotId: value.targetSnapshotId, repositoryRoot: value.repositoryRoot, ...(operation ? { operationId: value.operationId as string, externalId: value.externalId as string, routeId: value.routeId as string } : {}) };
}

function parseCouncil(value: Record<string, unknown>): ProviderCouncilRequest {
  if (value.schema !== "sxsy-b122.council-phase" || value.version !== 1 || !safeIdentifier(value.epochId) || !safeIdentifier(value.sessionId) || !digest(value.targetSnapshotId)
    || !absoluteRoot(value.repositoryRoot) || (value.phase !== "pause" && value.phase !== "assignment" && value.phase !== "resume")) throw new Error("The provider Council request is invalid.");
  const phase = value.phase as CouncilPhase;
  const base = { schema: "sxsy-b122.council-phase" as const, version: 1 as const, epochId: value.epochId, phase, sessionId: value.sessionId, targetSnapshotId: value.targetSnapshotId, repositoryRoot: value.repositoryRoot };
  if (value.phase === "pause") {
    if (!exactKeys(value, ["schema", "version", "epochId", "phase", "sessionId", "targetSnapshotId", "repositoryRoot"])) throw new Error("The Council pause request has unexpected fields.");
    return base;
  }
  const required = value.phase === "assignment"
    ? ["schema", "version", "epochId", "phase", "sessionId", "targetSnapshotId", "repositoryRoot", "paths", "resources", "assignmentDigest", "worktreeRoot", "branch", "head", "leases", "resourceHost"]
    : ["schema", "version", "epochId", "phase", "sessionId", "targetSnapshotId", "repositoryRoot", "assignmentDigest", "worktreeRoot", "branch", "head", "leases", "resourceHost"];
  if (!exactKeys(value, required) || !digest(value.assignmentDigest) || !absoluteRoot(value.worktreeRoot) || !safeBranch(value.branch) || !sha40(value.head) || !leaseList(value.leases)) throw new Error("The Council isolated assignment binding is invalid.");
  const paths = value.phase === "assignment" ? boundedList(value.paths, 512, 512) : undefined;
  const resources = value.phase === "assignment" ? boundedList(value.resources, 128, 256) : undefined;
  const resourceHost = parseResourceHost(value.resourceHost, {
    epochId: value.epochId, sessionId: value.sessionId, targetSnapshotId: value.targetSnapshotId,
    worktreeRoot: value.worktreeRoot, branch: value.branch, head: value.head
  });
  return {
    ...base,
    ...(paths ? { paths } : {}), ...(resources ? { resources } : {}),
    assignmentDigest: value.assignmentDigest, worktreeRoot: value.worktreeRoot,
    branch: value.branch, head: value.head, leases: value.leases as readonly ProviderCouncilLease[], resourceHost
  };
}

function parseCouncilCleanup(value: Record<string, unknown>): ProviderCouncilCleanupRequest {
  if (!exactKeys(value, ["schema", "version", "epochId", "sessionId", "targetSnapshotId", "resourceHostDigest", "outcome"])
    || value.schema !== "sxsy-b122.council-resource-cleanup" || value.version !== 1 || !safeIdentifier(value.epochId) || !safeIdentifier(value.sessionId)
    || !digest(value.targetSnapshotId) || !digest(value.resourceHostDigest) || (value.outcome !== "completed" && value.outcome !== "aborted" && value.outcome !== "cancelled")) {
    throw new Error("The Council resource cleanup request is invalid.");
  }
  return value as unknown as ProviderCouncilCleanupRequest;
}

function requireCouncilOrder(states: ReadonlyMap<string, SavedCouncilPhase>, request: ProviderCouncilRequest): void {
  if (request.phase === "pause") return;
  const pause = states.get(councilKey({ ...request, phase: "pause" }));
  if (pause?.state !== "acknowledged") throw new CouncilConflictError("Council assignment requires an acknowledged pause.");
  if (request.phase === "assignment") return;
  const assignment = states.get(councilKey({ ...request, phase: "assignment" }));
  if (assignment?.state !== "acknowledged" || assignment.request.assignmentDigest !== request.assignmentDigest
    || assignment.request.resourceHost?.digest !== request.resourceHost?.digest) throw new CouncilConflictError("Council resume requires the exact acknowledged assignment and resource-host binding.");
}

function parseResourceHost(value: unknown, expected: Readonly<{ epochId: string; sessionId: string; targetSnapshotId: string; worktreeRoot: string; branch: string; head: string }>): ProviderCouncilResourceHost {
  if (!record(value) || !exactKeys(value, ["schema", "version", "epochId", "sessionId", "fenceDigest", "capabilities", "resources", "environment", "digest"])
    || value.schema !== "sxsy-b122.council-resource-host" || value.version !== 1 || value.epochId !== expected.epochId || value.sessionId !== expected.sessionId
    || !digest(value.fenceDigest) || !digest(value.digest) || !Array.isArray(value.capabilities) || value.capabilities.length > 5 || !record(value.environment)
    || !Array.isArray(value.resources) || value.resources.length > 128) throw new Error("The Council resource-host binding is malformed.");
  const resources = value.resources.map(parseHostedResource);
  const expectedCapabilities = [...new Set(resources.map(resourceCapability))].sort();
  if (stableJson(value.capabilities) !== stableJson(expectedCapabilities)) throw new Error("The Council resource-host capabilities do not match its exact resources.");
  const expectedEnvironment: Record<string, string> = {
    SXSY_COUNCIL_EPOCH_ID: expected.epochId,
    SXSY_COUNCIL_SESSION_ID: expected.sessionId,
    SXSY_COUNCIL_TARGET_SNAPSHOT_ID: expected.targetSnapshotId,
    SXSY_COUNCIL_WORKTREE_ROOT: expected.worktreeRoot,
    SXSY_COUNCIL_BRANCH: expected.branch,
    SXSY_COUNCIL_HEAD: expected.head,
    SXSY_COUNCIL_RESOURCE_FENCE_DIGEST: value.fenceDigest
  };
  for (const resource of resources) {
    if (resource.environmentName in expectedEnvironment) throw new Error("The Council resource-host environment name is duplicated.");
    expectedEnvironment[resource.environmentName] = resource.value;
  }
  if (stableJson(value.environment) !== stableJson(expectedEnvironment)) throw new Error("The Council resource-host environment added, omitted, or changed a value.");
  const { digest: _digest, ...unsigned } = value;
  if (sha256(stableJson(unsigned)) !== value.digest) throw new Error("The Council resource-host digest is invalid.");
  return JSON.parse(stableJson(value)) as ProviderCouncilResourceHost;
}

function parseHostedResource(value: unknown): ProviderCouncilHostedResource {
  if (!record(value) || !allowedKeys(value, ["leaseId", "kind", "fence", "declaration", "bindingType", "value", "environmentName"], ["credentialExpiresAt"])
    || !safeIdentifier(value.leaseId) || !resourceKind(value.kind) || !Number.isSafeInteger(value.fence) || (value.fence as number) < 1
    || !safeBoundedText(value.declaration, 256) || !resourceBindingType(value.bindingType) || value.bindingType !== bindingTypeForResource(value.kind)
    || !safeBoundedText(value.value, 4_096) || typeof value.environmentName !== "string" || !/^SXSY_COUNCIL_[A-Z0-9_]{1,80}$/.test(value.environmentName)) {
    throw new Error("A Council hosted resource binding is malformed.");
  }
  if (value.kind === "credential_scope") {
    if (value.bindingType !== "opaque-credential-capability" || !opaqueCouncilCapability(value.value) || !Number.isSafeInteger(value.credentialExpiresAt) || (value.credentialExpiresAt as number) <= 0) throw new Error("The Council credential resource must contain only an exact opaque B122 capability identity.");
  } else if (value.credentialExpiresAt !== undefined) throw new Error("Only an opaque credential capability may carry an expiry.");
  return { leaseId: value.leaseId, kind: value.kind, fence: value.fence as number, declaration: value.declaration, bindingType: value.bindingType, value: value.value, environmentName: value.environmentName, ...(value.credentialExpiresAt === undefined ? {} : { credentialExpiresAt: value.credentialExpiresAt as number }) };
}

function resourceCapability(resource: ProviderCouncilHostedResource) {
  if (resource.kind === "port") return "held-loopback-port" as const;
  if (resource.kind === "cache") return "disposable-cache-directory" as const;
  if (resource.kind === "temp") return "disposable-temp-directory" as const;
  if (resource.kind === "database") return "sqlite-database" as const;
  return "session-fenced-credential-capability" as const;
}
function resourceKind(value: unknown): value is ProviderCouncilHostedResource["kind"] { return value === "port" || value === "cache" || value === "temp" || value === "database" || value === "credential_scope"; }
function resourceBindingType(value: unknown): value is ProviderCouncilHostedResource["bindingType"] { return value === "loopback-listener" || value === "directory" || value === "sqlite" || value === "opaque-credential-capability"; }
function bindingTypeForResource(kind: ProviderCouncilHostedResource["kind"]): ProviderCouncilHostedResource["bindingType"] { return kind === "port" ? "loopback-listener" : kind === "database" ? "sqlite" : kind === "credential_scope" ? "opaque-credential-capability" : "directory"; }

class CouncilConflictError extends Error {}
class CouncilUnresolvedError extends Error {}

function mapGatewayResult(result: Awaited<ReturnType<AuthenticatedProviderGatewayClient["request"]>>): ProviderHostResponse {
  if (result.outcome === "passed" && result.body) {
    try { return response(200, JSON.parse(Buffer.from(result.body).toString("utf8")) as Record<string, unknown>); }
    catch { return errorResponse(502, "The local provider gateway returned malformed response data.", "ambiguous"); }
  }
  const status = result.outcome === "blocked" ? 409 : result.outcome === "unavailable" ? 503 : 502;
  return errorResponse(status, result.detail, result.effectDisposition);
}

function parseBody(value: string | Uint8Array | undefined): Record<string, unknown> {
  if (value === undefined || bodyLength(value) === 0 || bodyLength(value) > maximumRequestBytes) throw new Error("The provider host request body is missing or oversized.");
  let parsed: unknown;
  try { parsed = JSON.parse(typeof value === "string" ? value : Buffer.from(value).toString("utf8")); }
  catch { throw new Error("The provider host request body is malformed JSON."); }
  if (!record(parsed)) throw new Error("The provider host request body must be an object.");
  return parsed;
}

function encode(value: unknown): string { const encoded = stableJson(value); if (Buffer.byteLength(encoded, "utf8") > maximumRequestBytes) throw new Error("The provider host request body is oversized."); return encoded; }
function response(status: number, body: Readonly<Record<string, unknown>>): ProviderHostResponse { return { status, body }; }
function errorResponse(status: number, summary: string, effectDisposition: "not_started" | "ambiguous" = "not_started"): ProviderHostResponse { return response(status, { schema: "sxsy-b122.provider-host-error", version: 1, status: status === 503 ? "unavailable" : "blocked", summary: safeSummary(summary, 512) ? summary : "The provider host failed closed.", effectDisposition }); }
function safeError(error: unknown): string {
  // Provider modules receive credentials and may throw attacker-controlled text.
  // Never reflect an arbitrary Error.message into an HTTP response or journal.
  if (error instanceof CouncilConflictError) return "The Council phase conflicts with the exact durable phase binding.";
  if (error instanceof CouncilUnresolvedError) return "The Council phase is unresolved and requires exact observation before retry.";
  return "The provider runtime or request boundary failed closed.";
}
function bodyLength(value: string | Uint8Array | undefined): number { return value === undefined ? 0 : typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function allowedKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const allowed = new Set([...required, ...optional]); return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key)); }
function safeIdentifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value); }
function safeRoute(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9_.-]{0,127}$/.test(value); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function sha40(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
function absoluteRoot(value: unknown): value is string { return typeof value === "string" && value.length <= 4_096 && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && !/[\0\r\n]/.test(value); }
function safeBranch(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\0\r\n~^:?*\\\[]/.test(value); }
function safeSummary(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value); }
function safeBoundedText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value); }
function opaqueCouncilCapability(value: unknown): value is string { return typeof value === "string" && /^council-capability:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function boundedList(value: unknown, maximumItems: number, maximumLength: number): readonly string[] { if (!Array.isArray(value) || value.length > maximumItems || !value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= maximumLength && !/[\0\r\n]/.test(entry))) throw new Error("A Council bounded declaration list is invalid."); return [...new Set(value)]; }
function leaseList(value: unknown): value is readonly ProviderCouncilLease[] { return Array.isArray(value) && value.length <= 128 && value.every((entry) => record(entry) && exactKeys(entry, ["kind", "resource", "fence"]) && safeIdentifier(entry.kind) && safeBoundedText(entry.resource, 4_096) && Number.isSafeInteger(entry.fence) && (entry.fence as number) >= 1); }
function stringList(value: unknown): readonly string[] { return boundedList(value, 512, 512); }
function capabilities(value: unknown): readonly Capability[] { const list = stringList(value); if (!list.every((entry): entry is Capability => entry === "registered" || entry === "observable" || entry === "controllable" || entry === "mediated")) throw new Error("The provider capabilities are invalid."); return list; }
function sessionStatus(value: unknown): SessionStatus { if (value !== "running" && value !== "verified_blocked" && value !== "verified_finished" && value !== "unreachable" && value !== "stale" && value !== "unknown") throw new Error("The provider status is invalid."); return value; }
function safeAdapterVersion(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(value)) throw new Error("The provider adapter version is invalid."); return value; }
function rootKey(value: string): string { return value.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase(); }
