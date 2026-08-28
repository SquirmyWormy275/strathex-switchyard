import { createHash, timingSafeEqual } from "node:crypto";
import { exactHostAbsoluteRoot, hostRootKey } from "../../../packages/control-plane/src/host-path.ts";

import type { Capability, EffectDisposition, ManagedSession, SessionStatus } from "../../../packages/control-plane/src/contracts.ts";
import { commandActionIds, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { sha256, stableJson, type ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { AutomationManifestAction } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import {
  createAutomationProposalResponse,
  parseAutomationProposalRequest,
  parseAutomationProposalResponse,
  type AutomationProposalRequest,
  type AutomationProposalResponse
} from "../../../packages/control-plane/src/automation-proposal-protocol.ts";
import {
  LocalProviderCommandGateway,
  type AuthenticatedProviderGatewayClient,
  type ProviderGatewayProvider
} from "../../windows-companion/src/provider-gateway.ts";
import {
  providerEffectCapabilityFloor,
  providerReanchorArtifactBinding,
  type ProviderAdapterBackend,
  type ProviderRuntimeReanchorAcknowledgement,
  type ProviderRuntimeReanchorRequest,
  type ProviderRuntimeWorkflowContextRequest,
  type ProviderWorkflowContextObservation
} from "./backends.ts";
import {
  ProviderDispatchLeaseAuthority,
  ProviderDispatchLeaseReplayError,
  type ProviderDispatchLeaseArtifactBinding,
  type ProviderDispatchLeaseExpectation,
  type ProviderDispatchLeaseHostIdentity,
  type ProviderDispatchLeaseSessionBinding,
  type ProviderDispatchLeaseTarget
} from "./dispatch-lease.ts";
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
const maximumResponseBytes = 64 * 1024;
const providerOperationKind = "provider-gateway.operation";
const councilCleanupKind = "provider-host.council-cleanup";
const workflowContextObservationKind = "provider-host.workflow-context-observation";
const reanchorOperationKind = "provider-host.reanchor-operation";
const maximumOperationDeadlineMs = 60_000;
const maximumReanchorHeartbeatAgeMs = 5 * 60_000;

export interface ProviderHostRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
  /** Listener-owned state; never deserialized from HTTP. */
  readonly effectProgress?: ProviderHostEffectProgress;
}

export interface ProviderHostEffectProgress {
  markAmbiguous(): void;
  disposition(): "not_started" | "ambiguous";
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
  readonly operationDeadlineMs?: number;
  readonly dispatchLease: Readonly<{
    authenticationKey: string;
    host: ProviderDispatchLeaseHostIdentity;
  }>;
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
  private readonly operationDeadlineMs: number;
  private readonly dispatchLeases: ProviderDispatchLeaseAuthority;
  private readonly inFlightCancellations = new Map<string, Readonly<{ requestDigest: string; result: Promise<ProviderHostResponse> }>>();
  private readonly inFlightCouncilCleanups = new Map<string, Readonly<{ requestDigest: string; result: Promise<ProviderHostResponse> }>>();

  constructor(options: ProviderAdapterHostServiceOptions) {
    if (!/^[a-f0-9]{64}$/.test(options.authenticationToken)) throw new Error("The provider host authentication token must be exactly 256 canonical bits.");
    if (options.dispatchLease.authenticationKey === options.authenticationToken) throw new Error("The provider dispatch-lease authentication key must be independent from the HTTP bearer token.");
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
    this.operationDeadlineMs = boundedOperationDeadline(options.operationDeadlineMs ?? 10_000);
    this.backends = backends;
    if (options.lifecycle && (!digest(options.lifecycle.nonce) || !Number.isSafeInteger(options.lifecycle.processId) || options.lifecycle.processId < 1 || !digest(options.lifecycle.configurationSha256))) throw new Error("The provider-host lifecycle identity is invalid.");
    if (options.lifecycle && (options.dispatchLease.host.configurationSha256 !== options.lifecycle.configurationSha256
      || options.dispatchLease.host.lifecycleNonceSha256 !== sha256(options.lifecycle.nonce))) {
      throw new Error("The provider dispatch-lease host identity does not match the exact running lifecycle.");
    }
    this.lifecycle = options.lifecycle;
    this.dispatchLeases = new ProviderDispatchLeaseAuthority({
      authenticationKey: options.dispatchLease.authenticationKey,
      store: options.store,
      host: options.dispatchLease.host,
      now: this.now
    });
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
    const progress = input.effectProgress ?? createEffectProgress();
    const boundary = new ProviderOperationBoundary(input.signal, this.operationDeadlineMs);
    try {
      if (input.method === "GET" && input.path === "/v1/b122/health" && input.body === undefined) return this.health();
      if (input.method !== "POST") return errorResponse(405, "The provider host route requires an exact method.");
      if (input.path === "/v1/b122/lifecycle/shutdown") return this.shutdown(input.body);
      const handshakeMatch = /^\/v1\/b122\/handshake\/(claude|codex)$/.exec(input.path);
      if (handshakeMatch) return await boundary.wait(this.handshake(handshakeMatch[1] as ProviderGatewayProvider, input.body, boundary.signal));
      const reanchorMatch = /^\/v1\/b122\/reanchor\/(claude|codex)$/.exec(input.path);
      if (reanchorMatch) return await boundary.wait(this.reanchor(reanchorMatch[1] as ProviderGatewayProvider, input.body, boundary, progress));
      const commandMatch = /^\/v1\/b122\/command\/([a-z][a-z0-9_]*)$/.exec(input.path);
      if (commandMatch?.[1] === "reanchor") return errorResponse(409, "Re-anchor requires its dedicated exact dual-target route; generic workflow dispatch is forbidden.");
      if (commandMatch) return await boundary.wait(this.gatewayRequest(`provider.${commandMatch[1]}`, input.body, boundary, progress));
      const automationProposalMatch = /^\/v1\/b122\/automation-proposal\/(compound_capture|compound_refresh|lfg|repair_mission)$/.exec(input.path);
      if (automationProposalMatch) return await boundary.wait(this.automationProposal(automationProposalMatch[1] as AutomationManifestAction, input.body, boundary));
      const automationMatch = /^\/v1\/b122\/automation\/([a-z][a-z0-9_]*)$/.exec(input.path);
      if (automationMatch) return providerAutomationEffectDisabled();
      const councilMatch = /^\/v1\/b122\/council\/(claude|codex)$/.exec(input.path);
      if (councilMatch) return await boundary.wait(this.council(councilMatch[1] as ProviderGatewayProvider, input.body, boundary.signal, progress));
      const councilCleanupMatch = /^\/v1\/b122\/council\/cleanup\/(claude|codex)$/.exec(input.path);
      if (councilCleanupMatch) return await this.cleanupCouncil(councilCleanupMatch[1] as ProviderGatewayProvider, input.body, boundary, progress);
      const sessionMatch = /^\/v1\/b122\/observe\/session\/(claude|codex)$/.exec(input.path);
      if (sessionMatch) return await boundary.wait(this.observeSession(sessionMatch[1] as ProviderGatewayProvider, input.body, boundary));
      const reanchorObservationMatch = /^\/v1\/b122\/observe\/reanchor\/(claude|codex)$/.exec(input.path);
      if (reanchorObservationMatch) {
        return await boundary.wait(this.observeReanchor(
          reanchorObservationMatch[1] as ProviderGatewayProvider,
          input.body,
          boundary
        ));
      }
      const workflowContextMatch = /^\/v1\/b122\/observe\/workflow-context\/(claude|codex)$/.exec(input.path);
      if (workflowContextMatch) return await boundary.wait(this.observeWorkflowContext(workflowContextMatch[1] as ProviderGatewayProvider, input.body, boundary.signal));
      const operationMatch = /^\/v1\/b122\/observe\/operation\/(claude|codex)$/.exec(input.path);
      if (operationMatch) return await boundary.wait(this.observeOperation(operationMatch[1] as ProviderGatewayProvider, input.body, boundary));
      const cancelMatch = /^\/v1\/b122\/cancel\/(claude|codex)$/.exec(input.path);
      if (cancelMatch) return await boundary.wait(this.cancel(cancelMatch[1] as ProviderGatewayProvider, input.body, boundary, progress));
      if (input.path === "/v1/b122/reconcile") return response(200, { schema: "sxsy-b122.provider-host-reconciliation", version: 1, ...(await this.reconcileWithin(boundary)) });
      return errorResponse(404, "No exact provider host route matches this request.");
    } catch (error) {
      if (progress.disposition() === "ambiguous") return errorResponse(503, safeError(error), "ambiguous");
      if (error instanceof CouncilConflictError) return errorResponse(409, safeError(error));
      if (error instanceof CouncilUnresolvedError) return errorResponse(503, safeError(error), "ambiguous");
      if (error instanceof WorkflowContextConflictError) return errorResponse(409, safeError(error));
      if (error instanceof ReanchorConflictError) return errorResponse(409, safeError(error));
      if (error instanceof DispatchLeaseConflictError) return errorResponse(409, safeError(error));
      if (error instanceof ProviderOperationBoundaryError) return errorResponse(408, safeError(error), progress.disposition());
      return errorResponse(progress.disposition() === "ambiguous" ? 503 : 400, safeError(error), progress.disposition());
    } finally {
      boundary.dispose();
    }
  }

  async reconcile(signal?: AbortSignal): Promise<ProviderHostReconciliationReceipt> {
    const boundary = new ProviderOperationBoundary(signal, this.operationDeadlineMs);
    try { return await this.reconcileWithin(boundary); }
    finally { boundary.dispose(); }
  }

  private async reconcileWithin(boundary: ProviderOperationBoundary): Promise<ProviderHostReconciliationReceipt> {
    const entries = await boundary.wait(this.store.readEntries());
    const latestOperations = new Map<string, SavedProviderOperation>();
    const conflictedOperations = new Set<string>();
    for (const entry of entries) {
      if (entry.kind !== providerOperationKind || !record(entry.payload) || !record(entry.payload.operation)) continue;
      const operation = parseSavedProviderOperation(entry.payload.operation);
      const prior = latestOperations.get(operation.operationId);
      if (prior && !sameSavedProviderIdentity(prior, operation)) conflictedOperations.add(operation.operationId);
      latestOperations.set(operation.operationId, operation);
    }
    const uncertainOperations = [...latestOperations.values()].filter((operation) => !conflictedOperations.has(operation.operationId)
      && (operation.state === "submitted" || operation.state === "unresolved"));
    let operationsSettled = 0;
    for (const operation of uncertainOperations) {
      if (!completeProviderOperationIdentity(operation)) continue;
      if (providerAutomationEffectRoute(operation.routeId)) {
        await this.retireProviderAutomationOperation(operation, boundary);
        continue;
      }
      const backend = this.backends.get(operation.provider);
      if (!backend) continue;
      const observed = await this.observeBackendOperation(operation, backend, boundary).catch(() => undefined);
      if (!observed) continue;
      const updated = { ...operation, state: observed.outcome, effectDisposition: observed.effectDisposition, updatedAt: this.timestamp() };
      await boundary.wait(this.saveProviderOperation(updated));
      if (trustedProviderTerminal(updated)) operationsSettled += 1;
    }

    const latestReanchors = new Map<string, SavedReanchorOperation>();
    for (const entry of entries) {
      if (entry.kind !== reanchorOperationKind || !record(entry.payload) || !record(entry.payload.operation)) continue;
      const operation = parseSavedReanchorOperation(entry.payload.operation);
      latestReanchors.set(`${operation.provider}:${operation.request.operationId}`, operation);
    }
    const uncertainReanchors = [...latestReanchors.values()].filter((operation) => operation.state === "submitted" || operation.state === "unresolved");
    let reanchorsSettled = 0;
    for (const operation of uncertainReanchors) {
      const backend = this.backends.get(operation.provider);
      if (!backend || !await this.currentReanchorSession(operation)) continue;
      const acknowledgement = await boundary.wait(backend.observeReanchor(operation.request, boundary.signal)).catch(() => undefined);
      if (!acknowledgement) continue;
      await this.recordReanchoredSession(operation, backend, boundary);
      await boundary.wait(this.saveReanchorOperation({ ...operation, state: "acknowledged", acknowledgement, updatedAt: this.timestamp() }));
      reanchorsSettled += 1;
    }

    const councils = await boundary.wait(readCouncilPhases(this.store));
    const uncertainCouncils = [...councils.values()].filter((entry) => entry.state === "submitted" || entry.state === "unresolved");
    let councilsSettled = 0;
    for (const saved of uncertainCouncils) {
      const backend = this.backends.get(saved.provider);
      if (!backend) continue;
      const session = await boundary.wait(this.sessions.get(saved.request.sessionId));
      if (!session?.workspaceRoot || !await this.refreshExactSession(saved.request.sessionId, saved.provider, saved.request.targetSnapshotId, session.workspaceRoot, boundary)) continue;
      const acknowledgement = await boundary.wait(backend.observeCouncil(saved.request, boundary.signal)).catch(() => undefined);
      if (!acknowledgement) continue;
      await boundary.wait(this.saveCouncil({ ...saved, state: "acknowledged", acknowledgement, updatedAt: this.timestamp() }));
      councilsSettled += 1;
    }
    return {
      operationsInspected: uncertainOperations.length + uncertainReanchors.length,
      operationsSettled: operationsSettled + reanchorsSettled,
      councilsInspected: uncertainCouncils.length,
      councilsSettled
    };
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

  private async gatewayRequest(routeId: string, body: string | Uint8Array | undefined, boundary: ProviderOperationBoundary, progress: ProviderHostEffectProgress): Promise<ProviderHostResponse> {
    if (providerAutomationEffectRoute(routeId)) return providerAutomationEffectDisabled();
    const signal = boundary.signal;
    const document = parseBody(body);
    const target = record(document.target) ? document.target : undefined;
    if (!target || !absoluteRoot(target.repositoryRoot)) return errorResponse(400, "The provider command lacks an exact absolute repository root.");
    const session = record(document.session) ? document.session : undefined;
    if (!session || (session.provider !== "claude" && session.provider !== "codex") || !safeIdentifier(session.id)
      || !safeIdentifier(document.action) || !safeIdentifier(document.operationId) || !safeIdentifier(document.authorityId)
      || routeId !== `provider.${document.action}`) {
      return errorResponse(400, "The provider command lacks an exact dispatch identity.");
    }
    const lease = document.dispatchLease;
    if (lease === undefined) return errorResponse(400, "The provider effect requires one exact companion dispatch lease.");
    const { dispatchLease: _dispatchLease, ...forwarded } = document;
    const requiredCapabilities = providerEffectCapabilityFloor("workflow", document.action);
    const backend = this.backends.get(session.provider);
    if (!backend) return errorResponse(503, "The exact provider backend is unavailable.");
    const current = await this.refreshExactSession(session.id, session.provider, String(target.id), target.repositoryRoot, boundary, false);
    const authorityRecovery = document.action === "authority_refresh" || document.action === "authority_broadcast";
    const statusAllowed = current?.status === "running" || (authorityRecovery && current?.status === "verified_blocked");
    if (!current || !statusAllowed || !requiredCapabilities.every((capability) => current.capabilities.includes(capability))) {
      return errorResponse(409, `The exact provider session is not current, ${authorityRecovery ? "running or verified-blocked" : "running"}, or is missing its ${requiredCapabilities.join(", ")} capability floor.`);
    }
    const expectation = gatewayLeaseExpectation(routeId, document, current, backend.dispatchIdentity);
    let consumedLease;
    try { consumedLease = await this.dispatchLeases.consume(lease, expectation, { signal, onCommitStart: () => progress.markAmbiguous() }); }
    catch (error) {
      if (error instanceof ProviderDispatchLeaseReplayError) progress.markAmbiguous();
      if (dispatchLeaseConflict(error)) throw new DispatchLeaseConflictError();
      throw error;
    }
    if (requiredCapabilities.includes("mediated")) backend.authorizeConsumedDispatchLease(consumedLease);
    progress.markAmbiguous();
    const mapped = mapGatewayResult(await this.gateway.request({ routeId, repositoryRoot: target.repositoryRoot, body: encode(forwarded), signal }));
    return mapped.status === 200 ? mapped : ambiguousResponse(mapped);
  }

  private async automationProposal(
    action: AutomationManifestAction,
    body: string | Uint8Array | undefined,
    boundary: ProviderOperationBoundary
  ): Promise<ProviderHostResponse> {
    let request: AutomationProposalRequest;
    try { request = parseAutomationProposalRequest(parseBody(body), action); }
    catch { return errorResponse(400, "The automation proposal request is malformed, open-ended, or contains effect authority."); }
    const provider = request.session.provider;
    if (provider !== "claude" && provider !== "codex") {
      return errorResponse(409, "Automation proposal observation requires one exact configured provider session.");
    }
    const current = await this.exactSession(request.session.id, provider, request.target.id, request.target.repositoryRoot);
    if (!current || !automationProposalSessionMatches(current, request)) {
      return errorResponse(409, "The automation proposal request changed its exact protected session, provider, target, task, plan, or adapter binding.");
    }
    const refreshed = await this.refreshExactSession(request.session.id, provider, request.target.id, request.target.repositoryRoot, boundary);
    if (!refreshed || !automationProposalSessionMatches(refreshed, request)) {
      return errorResponse(409, "The automation proposal session is no longer exact, running, and Mediated.");
    }
    const backend = this.backends.get(provider);
    if (!backend) return automationProposalHttp(createAutomationProposalResponse({
      requestId: request.requestId,
      action,
      status: "unavailable",
      summary: "The exact provider proposal backend is unavailable."
    }));
    try {
      const result = parseAutomationProposalResponse(
        await boundary.wait(backend.proposeAutomation(request, boundary.signal)),
        request.requestId,
        action
      );
      return automationProposalHttp(result);
    } catch {
      return automationProposalHttp(createAutomationProposalResponse({
        requestId: request.requestId,
        action,
        status: "unavailable",
        summary: "The exact provider proposal observation failed closed without starting an effect."
      }));
    }
  }

  private async reanchor(
    provider: ProviderGatewayProvider,
    body: string | Uint8Array | undefined,
    boundary: ProviderOperationBoundary,
    progress: ProviderHostEffectProgress
  ): Promise<ProviderHostResponse> {
    const document = parseBody(body);
    if (document.dispatchLease === undefined) return errorResponse(400, "The provider Re-anchor effect requires one exact companion dispatch lease.");
    const { dispatchLease, ...requestDocument } = document;
    const request = parseProviderReanchorRequest(requestDocument, provider);
    const decisionAt = Date.parse(this.timestamp());
    if (request.authority.revokedAt !== undefined || Date.parse(request.authority.issuedAt) > decisionAt || Date.parse(request.authority.expiresAt) <= decisionAt) {
      return errorResponse(409, "The exact provider Re-anchor authority is not currently active.");
    }
    if (await this.findReanchorOperation(provider, request.operationId)) {
      progress.markAmbiguous();
      throw new ReanchorConflictError("The Re-anchor operation may already have started and must only be observed.");
    }
    const protectedSession = await this.exactSession(request.sessionId, provider, request.oldTargetSnapshotId, request.repositoryRoot);
    if (!protectedSession || !reanchorRequestSessionMatches(protectedSession, request, decisionAt)) {
      return errorResponse(409, "The provider Re-anchor packet does not match the full protected ManagedSession.");
    }
    const current = await this.refreshExactSession(request.sessionId, provider, request.oldTargetSnapshotId, request.repositoryRoot, boundary);
    if (!current || !current.capabilities.includes("registered") || !current.capabilities.includes("controllable")
      || current.status === "stale" || current.status === "unreachable" || current.status === "unknown"
      || !reanchorRequestSessionMatches(current, request, decisionAt)) {
      return errorResponse(409, "The exact provider Re-anchor session is not current, live, and Controllable.");
    }
    const backend = this.backends.get(provider);
    if (!backend) return errorResponse(503, "The exact provider Re-anchor backend is unavailable.");
    const artifact = providerReanchorArtifactBinding(request);
    const sessionBinding = leaseSession(current, provider);
    const expectation: ProviderDispatchLeaseExpectation = {
      provider,
      routeId: `provider.reanchor.${provider}`,
      action: "reanchor",
      operationId: request.operationId,
      authorityId: request.authorityId,
      target: {
        id: request.oldTarget.id,
        repositoryRoot: request.oldTarget.repositoryRoot,
        branch: request.oldTarget.branch ?? null,
        head: request.oldTarget.head ?? null,
        trackedManifest: request.oldTarget.trackedManifest,
        untrackedManifest: request.oldTarget.untrackedManifest,
        policyVersion: request.oldTarget.policyVersion
      },
      session: sessionBinding,
      artifact,
      confirmation: { digest: request.confirmationDigest, scopeDigest: request.confirmationScopeDigest },
      module: backend.dispatchIdentity
    };
    try {
      await this.dispatchLeases.consume(dispatchLease, expectation, { signal: boundary.signal, onCommitStart: () => progress.markAmbiguous() });
    } catch (error) {
      if (error instanceof ProviderDispatchLeaseReplayError) progress.markAmbiguous();
      if (dispatchLeaseConflict(error)) throw new DispatchLeaseConflictError();
      throw error;
    }
    progress.markAmbiguous();
    const requestDigest = sha256(stableJson(request));
    const operation: SavedReanchorOperation = {
      provider,
      requestDigest,
      request,
      session: sessionBinding,
      state: "submitted",
      updatedAt: this.timestamp()
    };
    await this.claimReanchorOperation(operation);

    // The signed artifact is recomputed at the final effect boundary and the
    // protected session is reread after lease consumption. Any target or
    // session churn burns the one-shot lease and remains safely ambiguous.
    const finalSession = await this.currentReanchorSession(operation);
    if (stableJson(providerReanchorArtifactBinding(request)) !== stableJson(artifact)
      || !finalSession || finalSession.targetSnapshotId !== request.oldTargetSnapshotId
      || !reanchorRequestSessionMatches(finalSession, request, Date.parse(this.timestamp()))) {
      await this.saveReanchorOperation({ ...operation, state: "unresolved", updatedAt: this.timestamp() });
      throw new ReanchorConflictError("The trusted Re-anchor target or protected session changed at the final effect boundary.");
    }
    let acknowledgement: ProviderRuntimeReanchorAcknowledgement;
    try {
      acknowledgement = await boundary.wait(backend.reanchor(request, boundary.signal));
      await this.recordReanchoredSession(operation, backend, boundary);
      await this.saveReanchorOperation({ ...operation, state: "acknowledged", acknowledgement, updatedAt: this.timestamp() });
    } catch {
      await this.saveReanchorOperation({ ...operation, state: "unresolved", updatedAt: this.timestamp() }).catch(() => undefined);
      return errorResponse(503, "The provider Re-anchor acknowledgement is ambiguous and requires observation; the effect will not be replayed.", "ambiguous");
    }
    return response(200, acknowledgement as unknown as Readonly<Record<string, unknown>>);
  }

  private async observeSession(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined, boundary: ProviderOperationBoundary): Promise<ProviderHostResponse> {
    const document = exactOperationDocument(parseBody(body), "sxsy-b122.provider-session-observe", "session");
    const current = await this.exactSession(document.sessionId, provider, document.targetSnapshotId, document.repositoryRoot);
    if (!current) return errorResponse(409, "The requested provider session binding is no longer current.");
    const observed = await this.refreshExactSession(document.sessionId, provider, document.targetSnapshotId, document.repositoryRoot, boundary);
    if (!observed) return errorResponse(409, "The requested provider session could not be refreshed under its exact binding.");
    return response(200, {
      schema: "sxsy-b122.provider-session-observation", version: 1,
      sessionId: observed.id, provider, targetSnapshotId: observed.targetSnapshotId,
      repositoryRoot: observed.workspaceRoot, status: observed.status, capabilities: observed.capabilities,
      adapterVersion: observed.adapterVersion
    });
  }

  private async observeReanchor(
    provider: ProviderGatewayProvider,
    body: string | Uint8Array | undefined,
    boundary: ProviderOperationBoundary
  ): Promise<ProviderHostResponse> {
    const request = parseProviderReanchorRequest(parseBody(body), provider);
    const operation = await this.findReanchorOperation(provider, request.operationId);
    if (!operation || operation.requestDigest !== sha256(stableJson(request))
      || stableJson(operation.request) !== stableJson(request)) {
      return errorResponse(409, "No protected provider Re-anchor operation matches this exact observation request.");
    }
    if (operation.state === "acknowledged" && operation.acknowledgement) {
      return response(200, operation.acknowledgement as unknown as Readonly<Record<string, unknown>>);
    }
    const current = await this.currentReanchorSession(operation);
    const backend = this.backends.get(provider);
    if (!current || !backend) {
      return errorResponse(503, "The exact provider Re-anchor operation cannot currently be observed.", "ambiguous");
    }
    const acknowledgement = await boundary.wait(backend.observeReanchor(request, boundary.signal)).catch(() => undefined);
    if (!acknowledgement) {
      return errorResponse(503, "The provider has no trustworthy acknowledgement for this exact Re-anchor operation.", "ambiguous");
    }
    try {
      await this.recordReanchoredSession(operation, backend, boundary);
      await this.saveReanchorOperation({
        ...operation,
        state: "acknowledged",
        acknowledgement,
        updatedAt: this.timestamp()
      });
    } catch {
      return errorResponse(503, "The exact Re-anchor acknowledgement could not be durably recorded.", "ambiguous");
    }
    return response(200, acknowledgement as unknown as Readonly<Record<string, unknown>>);
  }

  private async observeWorkflowContext(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined, signal?: AbortSignal): Promise<ProviderHostResponse> {
    const request = parseWorkflowContextRequest(parseBody(body), provider);
    const current = await this.exactSession(request.sessionId, provider, request.targetSnapshotId, request.repositoryRoot);
    if (!current || current.taskId !== request.taskId || current.planRevision !== request.planRevision) {
      return errorResponse(409, "The requested workflow context no longer matches the exact managed session, target, task, and plan.");
    }
    const backend = this.backends.get(provider);
    if (!backend) return errorResponse(503, `No ${provider} provider backend is installed.`);
    const observation = await backend.observeWorkflowContext(request, signal ?? new AbortController().signal);
    const after = await this.exactSession(request.sessionId, provider, request.targetSnapshotId, request.repositoryRoot);
    if (!after || after.taskId !== request.taskId || after.planRevision !== request.planRevision) {
      return errorResponse(409, "The exact managed workflow context changed during provider observation.");
    }
    await this.recordWorkflowContextObservation(observation);
    const unsigned = Object.freeze({
      schema: "sxsy-b122.provider-workflow-context-observation" as const,
      version: 1 as const,
      ...observation,
      observedAt: this.timestamp()
    });
    const envelope = Object.freeze({ ...unsigned, envelopeDigest: sha256(stableJson(unsigned)) });
    if (Buffer.byteLength(stableJson(envelope), "utf8") > maximumResponseBytes) throw new Error("The provider workflow-context observation response is oversized.");
    return response(200, envelope);
  }

  private async observeOperation(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined, boundary: ProviderOperationBoundary): Promise<ProviderHostResponse> {
    const document = exactOperationDocument(parseBody(body), "sxsy-b122.provider-operation-observe", "operation");
    if (document.provider !== provider) return errorResponse(409, "The provider operation route and body identities differ.");
    const current = await this.exactSession(document.sessionId, provider, document.targetSnapshotId, document.repositoryRoot);
    if (!current) return errorResponse(409, "The requested provider operation session binding is no longer current.");
    const durable = await this.exactDurableOperation(document, provider);
    if (!durable) return errorResponse(404, "No exact durable provider operation matches the complete requested identity.");
    if (providerAutomationEffectRoute(durable.routeId)) return providerAutomationLegacyRecoveryRequired();
    const backend = this.backends.get(provider);
    if (!backend) return errorResponse(503, "The exact provider operation backend is unavailable.");
    const observed = await this.observeBackendOperation(durable, backend, boundary);
    await this.saveProviderOperation({ ...durable, state: observed.outcome, effectDisposition: observed.effectDisposition, updatedAt: this.timestamp() });
    return response(200, {
      schema: "sxsy-b122.provider-operation-observation", version: 1,
      operationId: document.operationId!, externalId: document.externalId!, routeId: document.routeId!,
      action: document.action!, sessionId: document.sessionId, provider, authorityId: document.authorityId!,
      targetSnapshotId: document.targetSnapshotId, repositoryRoot: document.repositoryRoot,
      outcome: observed.outcome, effectDisposition: observed.effectDisposition, summary: observed.summary
    });
  }

  private async cancel(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined, boundary: ProviderOperationBoundary, progress: ProviderHostEffectProgress): Promise<ProviderHostResponse> {
    const value = parseBody(body);
    const document = exactOperationDocument(value, "sxsy-b122.provider-operation-cancel", "cancel");
    if (document.provider !== provider) return errorResponse(409, "The provider cancellation route and body identities differ.");
    if (!safeSummary(value.reason, 1_024)) throw new Error("The provider cancellation reason is invalid.");
    if (providerAutomationEffectRoute(document.routeId ?? "")) {
      const current = await this.exactSession(document.sessionId, provider, document.targetSnapshotId, document.repositoryRoot);
      if (!current) return errorResponse(409, "The requested provider cancellation session binding is no longer current.");
      const durable = await this.exactDurableOperation(document, provider);
      if (!durable) return errorResponse(404, "No exact durable provider operation matches the complete requested identity.");
      return providerAutomationLegacyRecoveryRequired();
    }
    const current = await this.refreshExactSession(document.sessionId, provider, document.targetSnapshotId, document.repositoryRoot, boundary);
    if (!current) return errorResponse(409, "The requested provider cancellation session binding is no longer current.");
    const durable = await this.exactDurableOperation(document, provider);
    if (!durable) return errorResponse(404, "No exact durable provider operation matches the complete requested identity.");
    if (durable.cancellationAcknowledged || terminalProviderOperation(durable.state)) return response(409, {
      schema: "sxsy-b122.provider-cancellation-ack", version: 1, operationId: document.operationId,
      externalId: document.externalId, routeId: document.routeId, action: document.action,
      sessionId: document.sessionId, provider, authorityId: document.authorityId,
      targetSnapshotId: document.targetSnapshotId, repositoryRoot: document.repositoryRoot,
      accepted: false, summary: "The operation was already terminal or cancelled."
    });
    const backend = this.backends.get(provider);
    if (!backend) return errorResponse(503, "The exact provider cancellation backend is unavailable.");
    const cancellationKey = `${provider}:${durable.operationId}`;
    const requestDigest = sha256(stableJson({ provider, ...document, reason: value.reason }));
    const active = this.inFlightCancellations.get(cancellationKey);
    if (active) {
      if (active.requestDigest !== requestDigest) return errorResponse(409, "The active provider cancellation identity is bound to another exact request.");
      progress.markAmbiguous();
      return boundary.wait(active.result);
    }
    const result = this.cancelOnce(backend, durable, value.reason, boundary, progress).finally(() => {
      if (this.inFlightCancellations.get(cancellationKey)?.result === result) this.inFlightCancellations.delete(cancellationKey);
    });
    this.inFlightCancellations.set(cancellationKey, { requestDigest, result });
    return result;
  }

  private async cancelOnce(backend: ProviderAdapterBackend, durable: SavedProviderOperation, reason: string, boundary: ProviderOperationBoundary, progress: ProviderHostEffectProgress): Promise<ProviderHostResponse> {
    if (providerAutomationEffectRoute(durable.routeId)) throw new Error("Provider-owned automation cancellation is disabled and requires companion-owned manual recovery.");
    progress.markAmbiguous();
    const acknowledgement = await boundary.wait(backend.cancelOperation({
      operationId: durable.operationId, externalId: durable.externalId, routeId: durable.routeId,
      action: requiredOperationAction(durable), sessionId: durable.sessionId, authorityId: requiredOperationAuthority(durable),
      targetSnapshotId: durable.targetSnapshotId, repositoryRoot: durable.repositoryRoot, reason
    }, boundary.signal));
    if (!sameProviderBinding(acknowledgement, durable)
      || acknowledgement.accepted !== true || !safeSummary(acknowledgement.summary, 512)) {
      throw new Error("The provider cancellation acknowledgement changed its exact binding or refused cancellation.");
    }
    const acknowledged: SavedProviderOperation = { ...durable, state: "unresolved", effectDisposition: "ambiguous", cancellationAcknowledged: true, updatedAt: this.timestamp() };
    await this.saveProviderOperation(acknowledged);
    const observed = await this.observeBackendOperation(acknowledged, backend, boundary).catch(() => undefined);
    if (observed) await this.saveProviderOperation({ ...acknowledged, state: observed.outcome, effectDisposition: observed.effectDisposition, updatedAt: this.timestamp() });
    return response(200, {
      schema: "sxsy-b122.provider-cancellation-ack", version: 1, operationId: durable.operationId,
      externalId: durable.externalId, routeId: durable.routeId, action: requiredOperationAction(durable),
      sessionId: durable.sessionId, provider: durable.provider, authorityId: requiredOperationAuthority(durable),
      targetSnapshotId: durable.targetSnapshotId, repositoryRoot: durable.repositoryRoot, accepted: true,
      summary: "The exact provider operation cancellation was acknowledged."
    });
  }

  private async council(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined, signal: AbortSignal, progress: ProviderHostEffectProgress): Promise<ProviderHostResponse> {
    const document = parseBody(body);
    if (!safeIdentifier(document.authorityId) || !safeIdentifier(document.operationId) || document.dispatchLease === undefined) {
      return errorResponse(400, "The Council effect requires exact authority, operation, and companion dispatch-lease bindings.");
    }
    const { authorityId, operationId, dispatchLease, ...councilDocument } = document;
    const request = parseCouncil(councilDocument);
    const expectedOperationId = `council:${request.epochId}:${request.phase}`;
    if (operationId !== expectedOperationId) return errorResponse(409, "The Council operation identity does not match its exact epoch and phase.");
    const current = await this.sessions.get(request.sessionId);
    if (!current || current.provider !== provider || current.targetSnapshotId !== request.targetSnapshotId || !current.workspaceRoot
      || rootKey(current.workspaceRoot) !== rootKey(request.repositoryRoot)) {
      return errorResponse(409, "The Council provider session and target are no longer current.");
    }
    const backend = this.backends.get(provider);
    if (!backend) return errorResponse(503, `No ${provider} provider backend is installed.`);
    const artifact = request.phase === "pause" ? null : {
      id: request.epochId, digest: request.assignmentDigest!, coordinatorContextDigest: null, coordinatorContextRevision: null
    } as const;
    const expectation: ProviderDispatchLeaseExpectation = {
      provider, routeId: `council.${provider}`, action: `council_${request.phase}`, operationId: expectedOperationId,
      authorityId, target: { id: request.targetSnapshotId, repositoryRoot: request.repositoryRoot },
      session: leaseSession(current, provider), artifact, confirmation: null, module: backend.dispatchIdentity
    };
    // Reject prerequisites that prove the Council phase cannot start before
    // consuming its one-shot effect identity. The transactional check below is
    // repeated after lease consumption to close concurrent phase churn.
    requireCouncilOrder(await readCouncilPhases(this.store), request);
    let consumedLease;
    try { consumedLease = await this.dispatchLeases.consume(dispatchLease, expectation, { signal, onCommitStart: () => progress.markAmbiguous() }); }
    catch (error) {
      if (error instanceof ProviderDispatchLeaseReplayError) progress.markAmbiguous();
      if (dispatchLeaseConflict(error)) throw new DispatchLeaseConflictError();
      throw error;
    }
    backend.authorizeConsumedDispatchLease(consumedLease);
    progress.markAmbiguous();
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
    const submitted: SavedCouncilPhase = { key, provider, requestDigest, request, state: "submitted", updatedAt: this.timestamp() };
    try {
      const acknowledgement = await backend.council(request, signal);
      await this.saveCouncil({ ...submitted, state: "acknowledged", acknowledgement, updatedAt: this.timestamp() });
      return response(200, acknowledgement as unknown as Readonly<Record<string, unknown>>);
    } catch {
      await this.saveCouncil({ ...submitted, state: "unresolved", updatedAt: this.timestamp() });
      return errorResponse(503, "The Council acknowledgement is ambiguous and must be observed before retry.", "ambiguous");
    }
  }

  private async cleanupCouncil(provider: ProviderGatewayProvider, body: string | Uint8Array | undefined, boundary: ProviderOperationBoundary, progress: ProviderHostEffectProgress): Promise<ProviderHostResponse> {
    const request = parseCouncilCleanup(parseBody(body));
    const cleanupKey = `${provider}:${request.epochId}:${request.sessionId}:${request.resourceHostDigest}`;
    const requestDigest = sha256(stableJson(request));
    const active = this.inFlightCouncilCleanups.get(cleanupKey);
    if (active) {
      if (active.requestDigest !== requestDigest) return errorResponse(409, "The active Council cleanup identity is bound to another exact request.");
      progress.markAmbiguous();
      return boundary.wait(active.result);
    }
    const result = this.cleanupCouncilOnce(provider, request, cleanupKey, requestDigest, boundary, progress).finally(() => {
      if (this.inFlightCouncilCleanups.get(cleanupKey)?.result === result) this.inFlightCouncilCleanups.delete(cleanupKey);
    });
    this.inFlightCouncilCleanups.set(cleanupKey, { requestDigest, result });
    return result;
  }

  private async cleanupCouncilOnce(provider: ProviderGatewayProvider, request: ProviderCouncilCleanupRequest, cleanupKey: string, requestDigest: string, boundary: ProviderOperationBoundary, progress: ProviderHostEffectProgress): Promise<ProviderHostResponse> {
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
    progress.markAmbiguous();
    try { await boundary.wait(backend.cleanupCouncilResources(request, boundary.signal)); }
    catch { await this.store.append(councilCleanupKind, { key: cleanupKey, provider, requestDigest, request, state: "unresolved", updatedAt: this.timestamp() }); return errorResponse(503, "The exact Council cleanup remains pending and will be retried idempotently.", "ambiguous"); }
    const acknowledgement: ProviderCouncilCleanupAcknowledgement = { ...request, schema: "sxsy-b122.council-resource-cleanup-ack", closed: true };
    await this.store.append(councilCleanupKind, { key: cleanupKey, provider, requestDigest, request, state: "acknowledged", acknowledgement, updatedAt: this.timestamp() });
    return response(200, acknowledgement as unknown as Readonly<Record<string, unknown>>);
  }

  private async exactSession(sessionId: string, provider: ProviderGatewayProvider, targetSnapshotId: string, repositoryRoot: string): Promise<ManagedSession | undefined> {
    const session = await this.sessions.get(sessionId);
    return session && session.provider === provider && session.targetSnapshotId === targetSnapshotId && session.workspaceRoot && rootKey(session.workspaceRoot) === rootKey(repositoryRoot) ? session : undefined;
  }

  private async refreshExactSession(sessionId: string, provider: ProviderGatewayProvider, targetSnapshotId: string, repositoryRoot: string, boundary: ProviderOperationBoundary, requireObservable = true): Promise<ManagedSession | undefined> {
    const current = await this.exactSession(sessionId, provider, targetSnapshotId, repositoryRoot);
    const backend = this.backends.get(provider);
    if (!current || !backend) return undefined;
    let observed: Awaited<ReturnType<ProviderAdapterBackend["observeSession"]>> | undefined;
    try { observed = await boundary.wait(backend.observeSession({ sessionId, provider, targetSnapshotId, repositoryRoot }, boundary.signal)); }
    catch (error) { if (error instanceof ProviderOperationBoundaryError) throw error; return undefined; }
    if (!observed || observed.sessionId !== sessionId || observed.provider !== provider || observed.targetSnapshotId !== targetSnapshotId
      || (requireObservable && !observed.capabilities.includes("observable")) || !safeAdapterVersion(observed.adapterVersion)) return undefined;
    return this.sessions.upsert({
      ...current,
      capabilities: observed.capabilities,
      status: observed.status,
      adapterVersion: observed.adapterVersion,
      lastHeartbeat: this.timestamp()
    });
  }

  private async exactDurableOperation(document: ExactOperationDocument, provider: ProviderGatewayProvider): Promise<SavedProviderOperation | undefined> {
    let latest: SavedProviderOperation | undefined;
    let conflicted = false;
    for (const entry of await this.store.readEntries()) {
      if (entry.kind !== providerOperationKind || !record(entry.payload) || !record(entry.payload.operation)) continue;
      const parsed = parseSavedProviderOperation(entry.payload.operation);
      if (parsed.operationId !== document.operationId) continue;
      if (latest && !sameSavedProviderIdentity(latest, parsed)) conflicted = true;
      latest = parsed;
    }
    return !conflicted && latest && completeProviderOperationIdentity(latest)
      && latest.operationId === document.operationId && latest.externalId === document.externalId
      && latest.routeId === document.routeId && latest.sessionId === document.sessionId && latest.provider === provider
      && latest.action === document.action && latest.authorityId === document.authorityId && document.provider === provider
      && latest.targetSnapshotId === document.targetSnapshotId && typeof latest.repositoryRoot === "string"
      && rootKey(latest.repositoryRoot) === rootKey(document.repositoryRoot) ? latest : undefined;
  }

  private async claimReanchorOperation(operation: SavedReanchorOperation): Promise<void> {
    await this.store.transaction(async (transaction) => {
      for (const entry of await transaction.readEntries()) {
        if (entry.kind !== reanchorOperationKind || !record(entry.payload) || !record(entry.payload.operation)) continue;
        const existing = parseSavedReanchorOperation(entry.payload.operation);
        if (existing.provider !== operation.provider || existing.request.operationId !== operation.request.operationId) continue;
        if (existing.requestDigest !== operation.requestDigest) throw new ReanchorConflictError("The Re-anchor operation identity is bound to another exact request.");
        throw new ReanchorConflictError("The Re-anchor operation may already have started and must only be observed.");
      }
      await transaction.append(reanchorOperationKind, { operation });
    });
  }

  private async findReanchorOperation(
    provider: ProviderGatewayProvider,
    operationId: string
  ): Promise<SavedReanchorOperation | undefined> {
    let latest: SavedReanchorOperation | undefined;
    for (const entry of await this.store.readEntries()) {
      if (entry.kind !== reanchorOperationKind || !record(entry.payload) || !record(entry.payload.operation)) continue;
      const operation = parseSavedReanchorOperation(entry.payload.operation);
      if (operation.provider === provider && operation.request.operationId === operationId) latest = operation;
    }
    return latest;
  }

  private async saveReanchorOperation(operation: SavedReanchorOperation): Promise<void> {
    parseSavedReanchorOperation(operation);
    await this.store.append(reanchorOperationKind, { operation });
  }

  private async currentReanchorSession(operation: SavedReanchorOperation): Promise<ManagedSession | undefined> {
    const current = await this.sessions.get(operation.request.sessionId);
    if (!current || current.provider !== operation.provider || !current.workspaceRoot
      || rootKey(current.workspaceRoot) !== rootKey(operation.request.repositoryRoot)
      || (current.targetSnapshotId !== operation.request.oldTargetSnapshotId && current.targetSnapshotId !== operation.request.newTargetSnapshotId)
      || stableJson(leaseSession(current, operation.provider)) !== stableJson(operation.session)) return undefined;
    return current;
  }

  private async recordReanchoredSession(operation: SavedReanchorOperation, backend: ProviderAdapterBackend, boundary: ProviderOperationBoundary): Promise<void> {
    const current = await this.currentReanchorSession(operation);
    if (!current) throw new ReanchorConflictError("The protected Re-anchor session changed before its exact no-resume binding could be recorded.");
    const observed = await boundary.wait(backend.observeSession({
      sessionId: operation.request.sessionId,
      provider: operation.provider,
      targetSnapshotId: operation.request.newTargetSnapshotId,
      repositoryRoot: operation.request.repositoryRoot
    }, boundary.signal));
    if (observed.status === "running" || observed.status === "stale" || observed.status === "unreachable" || observed.status === "unknown"
      || !observed.capabilities.includes("registered") || !observed.capabilities.includes("controllable")) {
      throw new ReanchorConflictError("The provider did not prove the exact Re-anchor session stopped without resuming.");
    }
    await this.sessions.upsert({
      ...current,
      targetSnapshotId: operation.request.newTargetSnapshotId,
      status: observed.status,
      capabilities: observed.capabilities,
      adapterVersion: observed.adapterVersion,
      metadata: {
        ...current.metadata,
        "sxsy-b122.reanchor.operationId": operation.request.operationId,
        "sxsy-b122.reanchor.oldTargetSnapshotId": operation.request.oldTargetSnapshotId,
        "sxsy-b122.reanchor.newTargetSnapshotId": operation.request.newTargetSnapshotId,
        "sxsy-b122.reanchor.resumeAuthorized": "false"
      },
      lastHeartbeat: this.timestamp()
    });
  }

  private async observeBackendOperation(operation: SavedProviderOperation, backend: ProviderAdapterBackend, boundary: ProviderOperationBoundary) {
    if (providerAutomationEffectRoute(operation.routeId)) throw new Error("Provider-owned automation observation is disabled and requires companion-owned manual recovery.");
    const observed = await boundary.wait(backend.observeOperation({
      operationId: operation.operationId,
      externalId: operation.externalId,
      routeId: operation.routeId,
      action: requiredOperationAction(operation),
      sessionId: operation.sessionId,
      authorityId: requiredOperationAuthority(operation),
      targetSnapshotId: operation.targetSnapshotId,
      repositoryRoot: operation.repositoryRoot
    }, boundary.signal));
    if (!sameProviderBinding(observed, operation) || !providerOperationOutcome(observed.outcome)
      || !effectDisposition(observed.effectDisposition) || !consistentProviderEffect(observed.outcome, observed.effectDisposition)
      || !safeSummary(observed.summary, 512)) {
      throw new Error("The provider operation observation changed its exact durable binding.");
    }
    return observed;
  }

  private async saveProviderOperation(operation: SavedProviderOperation): Promise<void> {
    parseSavedProviderOperation(operation);
    await this.store.append(providerOperationKind, { operation });
  }

  private async retireProviderAutomationOperation(operation: SavedProviderOperation, boundary: ProviderOperationBoundary): Promise<void> {
    const responseBody = stableJson({
      schema: "sxsy-b122.provider-automation-retirement",
      version: 1,
      status: "manual_recovery_required",
      operationId: operation.operationId,
      routeId: operation.routeId,
      effectDisposition: "ambiguous",
      summary: "The legacy provider-owned automation operation is quarantined; only the companion-owned automation journal may recover it."
    });
    if (operation.state === "unresolved" && operation.effectDisposition === "ambiguous" && operation.responseBody === responseBody) return;
    await boundary.wait(this.saveProviderOperation({
      ...operation,
      state: "unresolved",
      effectDisposition: "ambiguous",
      responseBody,
      updatedAt: this.timestamp()
    }));
  }

  private async recordWorkflowContextObservation(observation: ProviderWorkflowContextObservation): Promise<void> {
    const key = workflowContextKey(observation);
    await this.store.transaction(async (transaction) => {
      let latest: Readonly<{ sourceRevision: number; contextDigest: string }> | undefined;
      for (const entry of await transaction.readEntries()) {
        if (entry.kind !== workflowContextObservationKind) continue;
        if (!record(entry.payload) || entry.payload.key !== key || !Number.isSafeInteger(entry.payload.sourceRevision)
          || (entry.payload.sourceRevision as number) < 1 || !digest(entry.payload.contextDigest)) {
          if (record(entry.payload) && entry.payload.key !== key) continue;
          throw new Error("The protected provider workflow-context journal is malformed.");
        }
        latest = { sourceRevision: entry.payload.sourceRevision as number, contextDigest: entry.payload.contextDigest };
      }
      if (latest && observation.sourceRevision < latest.sourceRevision) {
        throw new WorkflowContextConflictError("The provider workflow-context source revision moved backward.");
      }
      if (latest && observation.sourceRevision === latest.sourceRevision) {
        if (observation.contextDigest !== latest.contextDigest) throw new WorkflowContextConflictError("One provider workflow-context source revision changed content.");
        return;
      }
      await transaction.append(workflowContextObservationKind, {
        key,
        sessionId: observation.sessionId,
        provider: observation.provider,
        targetSnapshotId: observation.targetSnapshotId,
        repositoryRoot: observation.repositoryRoot,
        taskId: observation.taskId,
        planRevision: observation.planRevision,
        sourceRevision: observation.sourceRevision,
        contextDigest: observation.contextDigest,
        recordedAt: this.timestamp()
      });
    });
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

interface ExactOperationDocument { readonly sessionId: string; readonly targetSnapshotId: string; readonly repositoryRoot: string; readonly provider?: ProviderGatewayProvider; readonly operationId?: string; readonly externalId?: string; readonly routeId?: string; readonly action?: CommandAction; readonly authorityId?: string; }
interface SavedProviderOperation {
  readonly operationId: string;
  readonly externalId: string;
  readonly routeId: string;
  readonly provider: ProviderGatewayProvider;
  readonly sessionId: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  /** Missing only in legacy records; legacy records cannot prove terminal truth. */
  readonly action?: CommandAction;
  /** Missing only in legacy records; legacy records cannot prove terminal truth. */
  readonly authorityId?: string;
  readonly requestDigest: string;
  readonly state: "submitted" | "committed" | "failed" | "cancelled" | "unresolved";
  /** Missing only in legacy records; never inferred from status. */
  readonly effectDisposition?: EffectDisposition;
  readonly responseBody?: string;
  readonly cancellationAcknowledged: boolean;
  readonly updatedAt: string;
}

interface SavedReanchorOperation {
  readonly provider: ProviderGatewayProvider;
  readonly requestDigest: string;
  readonly request: ProviderRuntimeReanchorRequest;
  readonly session: ProviderDispatchLeaseSessionBinding;
  readonly state: "submitted" | "unresolved" | "acknowledged";
  readonly acknowledgement?: ProviderRuntimeReanchorAcknowledgement;
  readonly updatedAt: string;
}

function parseSavedProviderOperation(value: unknown): SavedProviderOperation {
  if (!record(value) || !allowedKeys(value,
    ["operationId", "externalId", "routeId", "provider", "sessionId", "repositoryRoot", "targetSnapshotId", "requestDigest", "state", "cancellationAcknowledged", "updatedAt"],
    ["action", "authorityId", "effectDisposition", "responseBody"])
    || !safeIdentifier(value.operationId) || !safeIdentifier(value.externalId) || !safeRoute(value.routeId)
    || (value.provider !== "claude" && value.provider !== "codex") || !safeIdentifier(value.sessionId) || !absoluteRoot(value.repositoryRoot)
    || !digest(value.targetSnapshotId) || !digest(value.requestDigest) || !providerOperationState(value.state)
    || (value.action !== undefined && !commandAction(value.action)) || (value.authorityId !== undefined && !safeIdentifier(value.authorityId))
    || (value.effectDisposition !== undefined && !effectDisposition(value.effectDisposition))
    || !savedProviderEffectConsistent(value.state, value.effectDisposition)
    || typeof value.cancellationAcknowledged !== "boolean" || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
    || (value.responseBody !== undefined && (typeof value.responseBody !== "string" || Buffer.byteLength(value.responseBody, "utf8") > maximumResponseBytes))) {
    throw new Error("The protected provider operation journal is malformed.");
  }
  return value as unknown as SavedProviderOperation;
}

function parseSavedReanchorOperation(value: unknown): SavedReanchorOperation {
  if (!record(value) || !allowedKeys(value,
    ["provider", "requestDigest", "request", "session", "state", "updatedAt"],
    ["acknowledgement"])
    || (value.provider !== "claude" && value.provider !== "codex") || !digest(value.requestDigest)
    || !record(value.request) || !record(value.session)
    || (value.state !== "submitted" && value.state !== "unresolved" && value.state !== "acknowledged")
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error("The protected provider Re-anchor journal is malformed.");
  }
  const request = parseProviderReanchorRequest(value.request, value.provider);
  const session = parseSavedReanchorSession(value.session, value.provider, request.sessionId);
  let acknowledgement: ProviderRuntimeReanchorAcknowledgement | undefined;
  if (value.acknowledgement !== undefined) {
    acknowledgement = parseSavedReanchorAcknowledgement(value.acknowledgement, request);
  }
  if ((value.state === "acknowledged") !== (acknowledgement !== undefined)) {
    throw new Error("The protected provider Re-anchor acknowledgement state is inconsistent.");
  }
  return {
    provider: value.provider,
    requestDigest: value.requestDigest,
    request,
    session,
    state: value.state,
    ...(acknowledgement ? { acknowledgement } : {}),
    updatedAt: value.updatedAt
  };
}

function parseSavedReanchorSession(value: Record<string, unknown>, provider: ProviderGatewayProvider, sessionId: string): ProviderDispatchLeaseSessionBinding {
  if (!exactKeys(value, ["id", "provider", "taskId", "planRevision", "adapterVersion"])
    || value.id !== sessionId || value.provider !== provider
    || (value.taskId !== null && !safeIdentifier(value.taskId))
    || (value.planRevision !== null && !safeIdentifier(value.planRevision))
    || !safeAdapterVersion(value.adapterVersion)) {
    throw new Error("The protected provider Re-anchor session binding is malformed.");
  }
  return {
    id: value.id,
    provider,
    taskId: value.taskId as string | null,
    planRevision: value.planRevision as string | null,
    adapterVersion: value.adapterVersion as string
  };
}

function parseSavedReanchorAcknowledgement(value: unknown, request: ProviderRuntimeReanchorRequest): ProviderRuntimeReanchorAcknowledgement {
  if (!record(value) || !exactKeys(value, [
    "schema", "version", "requestId", "operationId", "externalEffectId", "sessionId", "authorityId",
    "oldTargetSnapshotId", "newTargetSnapshotId", "cooperativeStopAcknowledged", "resumed", "artifactDigest", "rereadEvidence", "report"
  ]) || value.schema !== "sxsy-b122.reanchor-acknowledgement" || value.version !== 1
    || value.requestId !== request.requestId || value.operationId !== request.operationId || !safeIdentifier(value.externalEffectId)
    || value.sessionId !== request.sessionId || value.authorityId !== request.authorityId
    || value.oldTargetSnapshotId !== request.oldTargetSnapshotId || value.newTargetSnapshotId !== request.newTargetSnapshotId
    || value.cooperativeStopAcknowledged !== true || value.resumed !== false || value.artifactDigest !== request.artifactDigest
    || stableJson(value.rereadEvidence) !== stableJson(request.rereadEvidence) || !record(value.report)
    || !exactKeys(value.report, ["summary", "discrepancies", "risks", "questions", "result"])
    || !safeSummary(value.report.summary, 512) || !boundedReportList(value.report.discrepancies)
    || !boundedReportList(value.report.risks) || !boundedReportList(value.report.questions)
    || value.report.result !== "reanchored_without_resume") {
    throw new Error("The protected provider Re-anchor acknowledgement is malformed or changed its exact binding.");
  }
  return value as unknown as ProviderRuntimeReanchorAcknowledgement;
}

function providerOperationState(value: unknown): value is SavedProviderOperation["state"] { return value === "submitted" || providerOperationOutcome(value); }
function providerOperationOutcome(value: unknown): value is Exclude<SavedProviderOperation["state"], "submitted"> { return value === "committed" || value === "failed" || value === "cancelled" || value === "unresolved"; }
function terminalProviderOperation(value: SavedProviderOperation["state"]): boolean { return value === "committed" || value === "failed" || value === "cancelled"; }
function commandAction(value: unknown): value is CommandAction { return typeof value === "string" && (commandActionIds as readonly string[]).includes(value); }
function effectDisposition(value: unknown): value is EffectDisposition { return value === "not_started" || value === "committed" || value === "ambiguous" || value === "compensated"; }
function savedProviderEffectConsistent(state: unknown, disposition: unknown): boolean {
  if (disposition === undefined) return true;
  if (state === "submitted" || state === "unresolved") return disposition === "ambiguous";
  return consistentProviderEffect(state, disposition);
}
function consistentProviderEffect(outcome: unknown, disposition: unknown): boolean {
  if (outcome === "unresolved") return disposition === "ambiguous";
  if (outcome === "committed") return disposition === "committed";
  return (outcome === "failed" || outcome === "cancelled") && (disposition === "not_started" || disposition === "committed" || disposition === "compensated");
}
function completeProviderOperationIdentity(operation: SavedProviderOperation): operation is SavedProviderOperation & Readonly<{ action: CommandAction; authorityId: string }> {
  return operation.action !== undefined && operation.authorityId !== undefined
    && providerRouteMatchesAction(operation.routeId, operation.action, operation.provider);
}
function trustedProviderTerminal(operation: SavedProviderOperation): boolean {
  return completeProviderOperationIdentity(operation) && terminalProviderOperation(operation.state)
    && operation.effectDisposition !== undefined && operation.effectDisposition !== "ambiguous"
    && consistentProviderEffect(operation.state, operation.effectDisposition);
}
function requiredOperationAction(operation: SavedProviderOperation): CommandAction {
  if (!operation.action) throw new Error("The legacy provider operation lacks an exact action binding.");
  return operation.action;
}
function requiredOperationAuthority(operation: SavedProviderOperation): string {
  if (!operation.authorityId) throw new Error("The legacy provider operation lacks an exact authority binding.");
  return operation.authorityId;
}
function sameProviderBinding(
  observed: Readonly<{ operationId: string; externalId: string; routeId: string; action: CommandAction; sessionId: string; authorityId: string; targetSnapshotId: string; repositoryRoot: string }>,
  operation: SavedProviderOperation
): boolean {
  return observed.operationId === operation.operationId && observed.externalId === operation.externalId && observed.routeId === operation.routeId
    && observed.action === operation.action && observed.sessionId === operation.sessionId && observed.authorityId === operation.authorityId
    && observed.targetSnapshotId === operation.targetSnapshotId && rootKey(observed.repositoryRoot) === rootKey(operation.repositoryRoot);
}
function sameSavedProviderIdentity(left: SavedProviderOperation, right: SavedProviderOperation): boolean {
  return left.operationId === right.operationId && left.externalId === right.externalId && left.routeId === right.routeId
    && left.action === right.action && left.provider === right.provider && left.sessionId === right.sessionId
    && left.authorityId === right.authorityId && left.targetSnapshotId === right.targetSnapshotId
    && rootKey(left.repositoryRoot) === rootKey(right.repositoryRoot) && left.requestDigest === right.requestDigest;
}
function providerRouteMatchesAction(routeId: string, action: CommandAction, provider: ProviderGatewayProvider): boolean {
  return routeId === `automation.${action}` || routeId === `provider.${action}` || (action === "reanchor" && routeId === `provider.reanchor.${provider}`);
}

function providerAutomationEffectRoute(routeId: string): boolean {
  return /^automation\.[a-z][a-z0-9_]*$/u.test(routeId);
}

function providerAutomationEffectDisabled(): ProviderHostResponse {
  return errorResponse(410, "The provider host is proposal-only for automation; effects are companion-owned and this route is permanently disabled.");
}

function providerAutomationLegacyRecoveryRequired(): ProviderHostResponse {
  return errorResponse(410, "The legacy provider-owned automation operation requires companion-owned manual recovery; provider observation and cancellation are disabled.");
}

function gatewayLeaseExpectation(
  routeId: string,
  document: Record<string, unknown>,
  current: ManagedSession,
  module: Readonly<{ adapterId: string; moduleSha256: string }>
): ProviderDispatchLeaseExpectation {
  const target = document.target as Record<string, unknown>;
  const session = document.session as Record<string, unknown>;
  if (!allowedKeys(target, ["id", "repositoryRoot", "policyVersion", "trackedManifest", "untrackedManifest"], ["branch", "head"])
    || !allowedKeys(session, ["id", "provider", "surface", "capabilities", "plannedFiles"], ["taskId", "planRevision"])
    || !digest(target.id) || !absoluteRoot(target.repositoryRoot) || !safeBoundedText(target.policyVersion, 256)
    || !safeBoundedText(target.trackedManifest, 512) || !safeBoundedText(target.untrackedManifest, 512)
    || (target.branch !== undefined && !safeBranch(target.branch)) || (target.head !== undefined && !safeBoundedText(target.head, 256))) {
    throw new Error("The provider effect target or session binding is malformed.");
  }
  const expectedTask = session.taskId === undefined ? null : safeIdentifier(session.taskId) ? session.taskId : undefined;
  const expectedPlan = session.planRevision === undefined ? null : safeIdentifier(session.planRevision) ? session.planRevision : undefined;
  if (expectedTask === undefined || expectedPlan === undefined || (current.taskId ?? null) !== expectedTask || (current.planRevision ?? null) !== expectedPlan) {
    throw new Error("The provider effect task or plan binding is no longer current.");
  }
  const sessionBinding = leaseSession(current, session.provider as ProviderGatewayProvider);
  let artifact: ProviderDispatchLeaseArtifactBinding | null = null;
  if (document.schema === "sxsy-b122.workflow-command") {
    if (!record(document.artifact)) throw new Error("The provider workflow artifact binding is missing.");
    const value = document.artifact;
    if (!safeIdentifier(value.id) || !digest(value.digest)) throw new Error("The provider workflow artifact binding is invalid.");
    const contextDigest = value.coordinatorContextDigest === undefined ? null : digest(value.coordinatorContextDigest) ? value.coordinatorContextDigest : undefined;
    const contextRevision = value.coordinatorContextRevision === undefined ? null : Number.isSafeInteger(value.coordinatorContextRevision) && (value.coordinatorContextRevision as number) >= 1 ? value.coordinatorContextRevision as number : undefined;
    if (contextDigest === undefined || contextRevision === undefined || ((contextDigest === null) !== (contextRevision === null))) throw new Error("The provider workflow coordinator binding is partial or invalid.");
    artifact = { id: value.id, digest: value.digest, coordinatorContextDigest: contextDigest, coordinatorContextRevision: contextRevision };
  } else if (document.artifact !== undefined || document.executionAuthorization !== undefined) {
    throw new Error("Only a workflow command may carry artifact or confirmation material.");
  }
  let confirmation: Readonly<{ digest: string; scopeDigest: string }> | null = null;
  if (document.executionAuthorization !== undefined) {
    if (!record(document.executionAuthorization) || !digest(document.executionAuthorization.confirmationDigest) || !digest(document.executionAuthorization.confirmationScopeDigest)) throw new Error("The provider workflow confirmation binding is invalid.");
    confirmation = { digest: document.executionAuthorization.confirmationDigest, scopeDigest: document.executionAuthorization.confirmationScopeDigest };
  }
  return {
    provider: session.provider as ProviderGatewayProvider,
    routeId, action: document.action as string, operationId: document.operationId as string,
    authorityId: document.authorityId as string,
    target: {
      id: target.id, repositoryRoot: target.repositoryRoot,
      ...(target.branch === undefined ? {} : { branch: target.branch as string }),
      ...(target.head === undefined ? {} : { head: target.head as string }),
      trackedManifest: target.trackedManifest, untrackedManifest: target.untrackedManifest, policyVersion: target.policyVersion
    },
    session: sessionBinding, artifact, confirmation, module
  };
}

function leaseSession(session: ManagedSession, provider: ProviderGatewayProvider): ProviderDispatchLeaseSessionBinding {
  if (session.provider !== provider || !safeAdapterVersion(session.adapterVersion)) throw new Error("The provider dispatch-lease session identity is invalid.");
  return {
    id: session.id,
    provider,
    taskId: session.taskId ?? null,
    planRevision: session.planRevision ?? null,
    adapterVersion: session.adapterVersion
  };
}

function reanchorRequestSessionMatches(current: ManagedSession, request: ProviderRuntimeReanchorRequest, decisionAt: number): boolean {
  const claimed = request.session;
  const heartbeat = Date.parse(claimed.lastHeartbeat);
  const protectedHeartbeat = Date.parse(current.lastHeartbeat);
  return Number.isFinite(decisionAt) && Number.isFinite(heartbeat) && Number.isFinite(protectedHeartbeat)
    && heartbeat <= decisionAt && decisionAt - heartbeat <= maximumReanchorHeartbeatAgeMs
    && Math.abs(protectedHeartbeat - heartbeat) <= maximumReanchorHeartbeatAgeMs
    && claimed.id === current.id && claimed.id === request.sessionId
    && claimed.provider === current.provider && claimed.provider === request.provider
    && claimed.workspaceRoot !== undefined && current.workspaceRoot !== undefined
    && rootKey(claimed.workspaceRoot) === rootKey(current.workspaceRoot)
    && rootKey(claimed.workspaceRoot) === rootKey(request.repositoryRoot)
    && claimed.targetSnapshotId === current.targetSnapshotId && claimed.targetSnapshotId === request.oldTargetSnapshotId
    && claimed.taskId === current.taskId && claimed.taskId === request.taskId
    && claimed.planRevision === current.planRevision && claimed.planRevision === request.planRevision
    && stableJson(claimed.plannedFiles) === stableJson(current.plannedFiles)
    && stableJson(claimed.plannedFiles) === stableJson(request.plannedFiles)
    && stableJson(claimed.capabilities) === stableJson(current.capabilities)
    && claimed.status === current.status
    && claimed.adapterVersion === current.adapterVersion
    && claimed.metadata["sxsy-b122.providerHandshake"] === "exact-route-v1"
    && claimed.metadata["sxsy-b122.providerHandshakeTarget"] === request.oldTargetSnapshotId;
}

function parseWorkflowContextRequest(value: Record<string, unknown>, provider: ProviderGatewayProvider): ProviderRuntimeWorkflowContextRequest {
  if (!exactKeys(value, ["schema", "version", "sessionId", "provider", "targetSnapshotId", "repositoryRoot", "branch", "head", "taskId", "planRevision", "requestNonce"])
    || value.schema !== "sxsy-b122.provider-workflow-context-observe" || value.version !== 1 || value.provider !== provider
    || !safeIdentifier(value.sessionId) || !digest(value.targetSnapshotId) || !absoluteRoot(value.repositoryRoot)
    || !safeBranch(value.branch) || !sha40(value.head) || !boundedIdentity(value.taskId) || !boundedIdentity(value.planRevision)
    || !digest(value.requestNonce)) throw new Error("The provider workflow-context observation envelope is invalid.");
  return {
    sessionId: value.sessionId,
    provider,
    targetSnapshotId: value.targetSnapshotId,
    repositoryRoot: value.repositoryRoot,
    branch: value.branch,
    head: value.head,
    taskId: value.taskId,
    planRevision: value.planRevision,
    requestNonce: value.requestNonce
  };
}

function parseProviderReanchorRequest(value: Record<string, unknown>, provider: ProviderGatewayProvider): ProviderRuntimeReanchorRequest {
  if (value.provider !== provider) throw new Error("The provider Re-anchor route and body identities differ.");
  const request = value as unknown as ProviderRuntimeReanchorRequest;
  providerReanchorArtifactBinding(request);
  return JSON.parse(stableJson(request)) as ProviderRuntimeReanchorRequest;
}

function exactOperationDocument(value: Record<string, unknown>, schema: string, kind: "session" | "operation" | "cancel"): ExactOperationDocument {
  if (value.schema !== schema || value.version !== 1 || !safeIdentifier(value.sessionId) || !digest(value.targetSnapshotId) || !absoluteRoot(value.repositoryRoot)) throw new Error("The provider observation envelope is invalid.");
  const operation = kind !== "session";
  const keys = operation
    ? ["schema", "version", "operationId", "externalId", "routeId", "action", "sessionId", "provider", "authorityId", "targetSnapshotId", "repositoryRoot", ...(kind === "cancel" ? ["reason"] : [])]
    : ["schema", "version", "sessionId", "targetSnapshotId", "repositoryRoot"];
  if (!exactKeys(value, keys) || (operation && (!safeIdentifier(value.operationId) || !safeIdentifier(value.externalId) || !safeRoute(value.routeId)
    || !commandAction(value.action) || !safeIdentifier(value.authorityId) || (value.provider !== "claude" && value.provider !== "codex")
    || !providerRouteMatchesAction(value.routeId as string, value.action as CommandAction, value.provider as ProviderGatewayProvider)))) {
    throw new Error("The provider operation identity is invalid.");
  }
  return {
    sessionId: value.sessionId, targetSnapshotId: value.targetSnapshotId, repositoryRoot: value.repositoryRoot,
    ...(operation ? {
      operationId: value.operationId as string, externalId: value.externalId as string, routeId: value.routeId as string,
      action: value.action as CommandAction, provider: value.provider as ProviderGatewayProvider, authorityId: value.authorityId as string
    } : {})
  };
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
class WorkflowContextConflictError extends Error {}
class ReanchorConflictError extends Error {}
class DispatchLeaseConflictError extends Error {}
class ProviderOperationBoundaryError extends Error {}

function mapGatewayResult(result: Awaited<ReturnType<AuthenticatedProviderGatewayClient["request"]>>): ProviderHostResponse {
  if (result.outcome === "passed" && result.body) {
    try { return response(200, JSON.parse(Buffer.from(result.body).toString("utf8")) as Record<string, unknown>); }
    catch { return errorResponse(502, "The local provider gateway returned malformed response data.", "ambiguous"); }
  }
  const status = result.outcome === "blocked" ? 409 : result.outcome === "unavailable" ? 503 : 502;
  return errorResponse(status, result.detail, result.effectDisposition);
}

function automationProposalSessionMatches(session: ManagedSession, request: AutomationProposalRequest): boolean {
  return session.id === request.session.id && session.provider === request.session.provider
    && session.surface === request.session.surface && session.status === "running"
    && !!session.workspaceRoot && rootKey(session.workspaceRoot) === rootKey(request.target.repositoryRoot)
    && session.targetSnapshotId === request.target.id && session.taskId === request.session.taskId
    && session.planRevision === request.session.planRevision && session.adapterVersion === request.session.adapterVersion
    && stableJson([...session.capabilities].sort()) === stableJson([...request.session.capabilities].sort())
    && stableJson(session.plannedFiles) === stableJson(request.session.plannedFiles);
}

function automationProposalHttp(result: AutomationProposalResponse): ProviderHostResponse {
  const status = result.status === "completed" ? 200 : result.status === "blocked" ? 409 : 503;
  return response(status, result as unknown as Readonly<Record<string, unknown>>);
}

function ambiguousResponse(value: ProviderHostResponse): ProviderHostResponse {
  return response(value.status === 409 ? 503 : value.status, { ...value.body, effectDisposition: "ambiguous" });
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
  if (error instanceof WorkflowContextConflictError) return "The provider workflow context conflicts with its durable monotonic source binding.";
  if (error instanceof ReanchorConflictError) return "The provider Re-anchor conflicts with its exact durable target, session, or operation binding.";
  if (error instanceof DispatchLeaseConflictError) return "The provider dispatch lease was replayed or does not match the exact effect binding.";
  if (error instanceof ProviderOperationBoundaryError) return "The provider-host operation was cancelled or exceeded its fixed deadline.";
  return "The provider runtime or request boundary failed closed.";
}
function bodyLength(value: string | Uint8Array | undefined): number { return value === undefined ? 0 : typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  const allowed = new Set(keys);
  return actual.length === keys.length && actual.every((key) => allowed.has(key)) && keys.every((key) => Object.hasOwn(value, key));
}
function allowedKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const allowed = new Set([...required, ...optional]); return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key)); }
function safeIdentifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value); }
function safeRoute(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9_.-]{0,127}$/.test(value); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function sha40(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
function absoluteRoot(value: unknown): value is string { return exactHostAbsoluteRoot(value); }
function safeBranch(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\0\r\n~^:?*\\\[]/.test(value); }
function safeSummary(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value); }
function safeBoundedText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value); }
function boundedIdentity(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value); }
function opaqueCouncilCapability(value: unknown): value is string { return typeof value === "string" && /^council-capability:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function boundedList(value: unknown, maximumItems: number, maximumLength: number): readonly string[] { if (!Array.isArray(value) || value.length > maximumItems || !value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= maximumLength && !/[\0\r\n]/.test(entry))) throw new Error("A Council bounded declaration list is invalid."); return [...new Set(value)]; }
function leaseList(value: unknown): value is readonly ProviderCouncilLease[] { return Array.isArray(value) && value.length <= 128 && value.every((entry) => record(entry) && exactKeys(entry, ["kind", "resource", "fence"]) && safeIdentifier(entry.kind) && safeBoundedText(entry.resource, 4_096) && Number.isSafeInteger(entry.fence) && (entry.fence as number) >= 1); }
function stringList(value: unknown): readonly string[] { return boundedList(value, 512, 512); }
function boundedReportList(value: unknown): value is readonly string[] { return Array.isArray(value) && value.length <= 64 && value.every((entry) => safeSummary(entry, 512)); }
function capabilities(value: unknown): readonly Capability[] { const list = stringList(value); if (!list.every((entry): entry is Capability => entry === "registered" || entry === "observable" || entry === "controllable" || entry === "mediated")) throw new Error("The provider capabilities are invalid."); return list; }
function sessionStatus(value: unknown): SessionStatus { if (value !== "running" && value !== "verified_blocked" && value !== "verified_finished" && value !== "unreachable" && value !== "stale" && value !== "unknown") throw new Error("The provider status is invalid."); return value; }
function safeAdapterVersion(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(value)) throw new Error("The provider adapter version is invalid."); return value; }
function rootKey(value: string): string { return hostRootKey(value); }
function workflowContextKey(value: Pick<ProviderWorkflowContextObservation, "provider" | "sessionId" | "targetSnapshotId" | "repositoryRoot" | "taskId" | "planRevision">): string {
  return sha256(stableJson({ provider: value.provider, sessionId: value.sessionId, targetSnapshotId: value.targetSnapshotId, repositoryRoot: rootKey(value.repositoryRoot), taskId: value.taskId, planRevision: value.planRevision }));
}

function createEffectProgress(): ProviderHostEffectProgress {
  let ambiguous = false;
  return Object.freeze({
    markAmbiguous() { ambiguous = true; },
    disposition: () => ambiguous ? "ambiguous" as const : "not_started" as const
  });
}

function dispatchLeaseConflict(error: unknown): boolean {
  return error instanceof Error && /already consumed|replay|does not match the exact .*binding/i.test(error.message);
}

class ProviderOperationBoundary {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly deadlineAt: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly caller?: AbortSignal;
  private readonly onCallerAbort: () => void;

  constructor(caller: AbortSignal | undefined, timeoutMs: number) {
    this.signal = this.controller.signal;
    this.deadlineAt = Date.now() + timeoutMs;
    this.caller = caller;
    this.onCallerAbort = () => this.controller.abort();
    if (caller?.aborted) this.controller.abort();
    else caller?.addEventListener("abort", this.onCallerAbort, { once: true });
    this.timer = setTimeout(() => this.controller.abort(), timeoutMs);
    this.timer.unref?.();
  }

  wait<T>(pending: Promise<T>): Promise<T> {
    pending.then(() => undefined, () => undefined);
    if (this.signal.aborted) return Promise.reject(new ProviderOperationBoundaryError());
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => this.signal.removeEventListener("abort", onAbort);
      const onAbort = () => { cleanup(); reject(new ProviderOperationBoundaryError()); };
      this.signal.addEventListener("abort", onAbort, { once: true });
      pending.then((value) => {
        cleanup();
        if (this.signal.aborted || Date.now() >= this.deadlineAt) {
          this.controller.abort();
          reject(new ProviderOperationBoundaryError());
        } else resolve(value);
      }, (error) => { cleanup(); reject(error); });
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.caller?.removeEventListener("abort", this.onCallerAbort);
    this.controller.abort();
  }
}

function boundedOperationDeadline(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumOperationDeadlineMs) throw new Error("The provider-host operation deadline is invalid.");
  return value;
}
