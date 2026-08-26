import { createHash, timingSafeEqual } from "node:crypto";

import type {
  Capability,
  EffectDisposition,
  ManagedSession,
  SessionStatus
} from "../../../packages/control-plane/src/contracts.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import {
  sha256,
  stableJson,
  type JournalEntry,
  type ProtectedJsonStore
} from "../../../packages/control-plane/src/store.ts";
import {
  canonicalWorkflowArtifact,
  parseWorkflowChildProviderResponse,
  planApprovalReviewScopeDigest,
  workflowProviderEffect,
  type WorkflowArtifact,
  type WorkflowArtifactImmutable,
  type WorkflowArtifactAction,
  type WorkflowArtifactPayload,
  type WorkflowChildProviderResponse,
  type WorkflowProviderEffectBinding,
  type WorkflowProviderEffectRole,
  type WorkflowProviderResponse,
  type WorkflowProviderResult
} from "../../../packages/control-plane/src/workflow-artifacts.ts";
import type { ConfiguredNetworkResult } from "./configured-network.ts";
import { commandActionIds, commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { automationResultSchema, parseAutomationEnvelope, parseAutomationProviderResult, type AutomationAction, type AutomationIntent, type AutomationProviderResult, type AutomationProviderResultPayload } from "../../../packages/control-plane/src/automation-protocol.ts";

const maximumBodyBytes = 64 * 1024;
const maximumText = 4_096;
const gatewayEventKind = "provider-gateway.operation";
const gatewayClockKind = "provider-gateway.clock";

export type ProviderGatewayProvider = Extract<ManagedSession["provider"], "claude" | "codex">;
export type ProviderGatewayBoundary = "local-only" | "authorized-external";

export interface ProviderGatewayRouteRequest {
  readonly routeId: string;
  readonly repositoryRoot: string;
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
}

export interface ProviderGatewayRecoveryIdentityRequest {
  readonly routeId: string;
  readonly operationId: string;
  readonly provider: ManagedSession["provider"];
}

export interface ProviderGatewayHandshakeRequest {
  readonly sessionId: string;
  readonly provider: ProviderGatewayProvider;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly branch?: string;
  readonly head?: string;
}

export interface ProviderGatewayHandshakeResult {
  readonly capabilities: readonly Capability[];
  readonly status: SessionStatus;
  readonly adapterVersion: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  readonly plannedFiles: readonly string[];
  readonly resources: readonly string[];
  readonly dependencies: readonly string[];
  readonly diffDigest: string;
}

export interface ProviderGatewaySessionObservationRequest {
  readonly sessionId: string;
  readonly provider: ProviderGatewayProvider;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
}

export interface ProviderGatewaySessionObservation {
  readonly sessionId: string;
  readonly provider: ProviderGatewayProvider;
  readonly targetSnapshotId: string;
  readonly status: SessionStatus;
  readonly capabilities: readonly Capability[];
  readonly adapterVersion: string;
}

export interface ProviderGatewayWorkflowCommand {
  readonly kind: "workflow";
  readonly routeId: string;
  readonly operationId: string;
  readonly externalId: string;
  readonly action: WorkflowArtifactAction;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly provider: ProviderGatewayProvider;
  readonly artifact: Readonly<{
    id: string;
    digest: string;
    sessionId?: string;
    operationId?: string;
    taskId?: string;
    planRevision?: string;
    authorityId?: string;
    coordinatorContextDigest?: string;
    coordinatorContextRevision?: number;
    payload: WorkflowArtifactPayload;
  }>;
  readonly child?: Readonly<{
    role: WorkflowProviderEffectRole;
    bindingDigest: string;
    effect: WorkflowProviderEffectBinding;
    parentOperationId: string;
  }>;
  readonly executionAuthorization?: Readonly<{
    executionAuthorized: true;
    executeOnce: true;
    currentUserConfirmed: true;
    confirmationDigest: string;
    confirmationScopeDigest: string;
    operationId: string;
    artifactId: string;
    artifactDigest: string;
    targetSnapshotId: string;
    sessionId: string;
    authorityId: string;
    planDigest: string;
    planRevision: string;
    originSessionId: string;
  }>;
}

export interface ProviderGatewayAutomationCommand {
  readonly kind: "automation";
  readonly routeId: string;
  readonly operationId: string;
  readonly externalId: string;
  readonly action: AutomationAction;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly sessionId: string;
  readonly provider: ProviderGatewayProvider;
  readonly intent: AutomationIntent;
}

export type ProviderGatewayCommand = ProviderGatewayWorkflowCommand | ProviderGatewayAutomationCommand;

export type ProviderGatewayRemoteResult = AutomationProviderResult;

export type ProviderGatewayCommandResult = WorkflowProviderResponse | WorkflowChildProviderResponse | ProviderGatewayRemoteResult;
export type ProviderGatewayOperationOutcome = "committed" | "failed" | "cancelled" | "unresolved";

export interface ProviderGatewayOperationObservationRequest {
  readonly operationId: string;
  readonly externalId: string;
  readonly routeId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
}

export interface ProviderGatewayOperationObservation {
  readonly operationId: string;
  readonly externalId: string;
  readonly routeId: string;
  readonly targetSnapshotId: string;
  readonly outcome: ProviderGatewayOperationOutcome;
  readonly summary: string;
}

export interface ProviderGatewayCancellationRequest extends ProviderGatewayOperationObservationRequest {
  readonly reason: string;
}

export interface ProviderGatewayCancellationAcknowledgement {
  readonly operationId: string;
  readonly externalId: string;
  readonly targetSnapshotId: string;
  readonly accepted: boolean;
  readonly summary: string;
}

/** Trusted host adapter. Repository/provider text never constructs one. */
export interface ProviderGatewayBackend {
  readonly provider: ProviderGatewayProvider;
  readonly boundary: ProviderGatewayBoundary;
  readonly dispatchIdentity: Readonly<{ adapterId: string; moduleSha256: string }>;
  handshake(request: ProviderGatewayHandshakeRequest, signal: AbortSignal): Promise<ProviderGatewayHandshakeResult>;
  execute(request: ProviderGatewayCommand, signal: AbortSignal): Promise<ProviderGatewayCommandResult>;
  observeSession(request: ProviderGatewaySessionObservationRequest, signal: AbortSignal): Promise<ProviderGatewaySessionObservation>;
  observeOperation(request: ProviderGatewayOperationObservationRequest, signal: AbortSignal): Promise<ProviderGatewayOperationObservation>;
  cancelOperation(request: ProviderGatewayCancellationRequest, signal: AbortSignal): Promise<ProviderGatewayCancellationAcknowledgement>;
}

interface SavedGatewayOperation {
  readonly operationId: string;
  readonly externalId: string;
  readonly routeId: string;
  readonly provider: ProviderGatewayProvider;
  readonly sessionId: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly requestDigest: string;
  readonly state: "submitted" | ProviderGatewayOperationOutcome;
  readonly responseBody?: string;
  readonly cancellationAcknowledged: boolean;
  readonly updatedAt: string;
}

export interface LocalProviderCommandGatewayOptions {
  readonly store: ProtectedJsonStore;
  readonly sessions: SessionRegistry;
  readonly authenticationToken: string;
  readonly backends: readonly ProviderGatewayBackend[];
  readonly authorizedExternalProviders?: readonly ProviderGatewayProvider[];
  readonly now?: () => string;
  readonly automaticRefreshIntervalMs?: number;
}

export interface ProviderGatewayRecoveryObservation {
  readonly outcome: ProviderGatewayOperationOutcome;
  readonly note: string;
  readonly details?: Readonly<Record<string, string>>;
}

export interface AuthenticatedProviderGatewayClient {
  request(input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult>;
  supportsProvider(provider: ManagedSession["provider"]): provider is ProviderGatewayProvider;
  handshakeCapabilityCeiling(provider: ManagedSession["provider"]): readonly Capability[];
  recoveryExternalId(input: ProviderGatewayRecoveryIdentityRequest): string | undefined;
  refreshSessions(force?: boolean): Promise<readonly ManagedSession[]>;
  observeSession(sessionId: string): Promise<ManagedSession>;
  cancelByOperation(operationId: string, reason: string): Promise<number>;
  cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number>;
  observeOperation(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>>;
  observeProviderOperation(input: Readonly<{ repositoryRoot: string; routeId: string; externalId: string; targetSnapshotId: string }>): Promise<ProviderGatewayRecoveryObservation | undefined>;
}

export interface ProviderGatewayFallbackTransport {
  request(input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult>;
  recoveryExternalId?(input: ProviderGatewayRecoveryIdentityRequest): string | undefined;
  handshakeCapabilityCeiling?(input: Readonly<{ routeId: string; provider: ManagedSession["provider"] }>): Promise<readonly Capability[]> | readonly Capability[];
}

/**
 * In-process installed gateway. The authenticated client is an object
 * capability minted from a 256-bit host secret; no token crosses the VS Code
 * bridge or provider payload. Automatic observation is local-only.
 */
export class LocalProviderCommandGateway {
  private readonly store: ProtectedJsonStore;
  private readonly sessions: SessionRegistry;
  private readonly tokenDigest: Buffer;
  private readonly backends = new Map<ProviderGatewayProvider, ProviderGatewayBackend>();
  private readonly authorizedExternalProviders: ReadonlySet<ProviderGatewayProvider>;
  private readonly inFlightCommands = new Map<string, Readonly<{ requestDigest: string; result: Promise<ConfiguredNetworkResult> }>>();
  private readonly inFlightCancellations = new Map<string, Promise<number>>();
  private readonly now: () => string;
  private readonly automaticRefreshIntervalMs: number;
  private lastAutomaticRefresh = Number.NEGATIVE_INFINITY;
  private lastHostTime = Number.NEGATIVE_INFINITY;
  private externalAuthorizationMissing = false;

  constructor(options: LocalProviderCommandGatewayOptions) {
    this.store = options.store;
    this.sessions = options.sessions;
    this.tokenDigest = tokenDigest(options.authenticationToken);
    this.authorizedExternalProviders = new Set(options.authorizedExternalProviders ?? []);
    this.now = options.now ?? (() => new Date().toISOString());
    this.automaticRefreshIntervalMs = boundedDuration(options.automaticRefreshIntervalMs ?? 30_000);
    for (const backend of options.backends) {
      if (this.backends.has(backend.provider)) throw new Error(`Duplicate provider gateway backend: ${backend.provider}`);
      if (backend.boundary === "authorized-external" && !this.authorizedExternalProviders.has(backend.provider)) this.externalAuthorizationMissing = true;
      this.backends.set(backend.provider, backend);
    }
  }

  connect(authenticationToken: string): AuthenticatedProviderGatewayClient {
    if (!sameToken(this.tokenDigest, authenticationToken)) throw new Error("Provider gateway authentication failed.");
    if (this.externalAuthorizationMissing) throw new Error("An external provider gateway backend lacks explicit configured authorization.");
    return new GatewayClient(this, authenticationToken);
  }

  supportsProvider(authenticationToken: string, provider: ManagedSession["provider"]): provider is ProviderGatewayProvider {
    this.authenticate(authenticationToken);
    return (provider === "claude" || provider === "codex") && this.backends.has(provider);
  }

  handshakeCapabilityCeiling(authenticationToken: string, provider: ManagedSession["provider"]): readonly Capability[] {
    this.authenticate(authenticationToken);
    const backend = provider === "claude" || provider === "codex" ? this.backends.get(provider) : undefined;
    if (!backend) return ["registered"];
    return backend.boundary === "local-only"
      ? ["registered", "observable", "controllable", "mediated"]
      : ["registered", "observable", "controllable"];
  }

  async request(authenticationToken: string, input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult> {
    this.authenticate(authenticationToken);
    const rejected = validateRouteRequest(input);
    if (rejected) return blocked(input.routeId, rejected);
    if (input.signal?.aborted) return blocked(input.routeId, "The provider gateway request was cancelled before local dispatch.");
    try {
      if (input.routeId.startsWith("provider.handshake.")) return await this.handshake(input);
      if (input.routeId.startsWith("provider.")) return await this.executeWorkflow(input);
      if (input.routeId.startsWith("automation.")) return await this.executeAutomation(input);
      return unavailable(input.routeId, "The local provider gateway does not own this fixed route.");
    } catch {
      return unavailable(input.routeId, "The local provider gateway failed closed; no provider success was inferred.", "ambiguous");
    }
  }

  recoveryExternalId(authenticationToken: string, input: ProviderGatewayRecoveryIdentityRequest): string | undefined {
    this.authenticate(authenticationToken);
    return this.supportsProvider(authenticationToken, input.provider) && safeOperationId(input.operationId) && safeRoute(input.routeId)
      ? input.operationId
      : undefined;
  }

  async refreshSessions(authenticationToken: string, force = false): Promise<readonly ManagedSession[]> {
    this.authenticate(authenticationToken);
    const now = Date.parse(this.now());
    if (!Number.isFinite(now)) throw new Error("The provider gateway host clock is invalid.");
    if (!force && now - this.lastAutomaticRefresh < this.automaticRefreshIntervalMs) return this.sessions.list();
    const candidates = (await this.sessions.list()).filter((session) => {
      const backend = providerBackend(this.backends, session.provider);
      return backend?.boundary === "local-only" && hasGatewayProof(session);
    });
    for (const session of candidates) await this.observeSessionInternal(session).catch(async () => this.downgrade(session, "unreachable"));
    this.lastAutomaticRefresh = now;
    return this.sessions.list();
  }

  async observeSession(authenticationToken: string, sessionId: string): Promise<ManagedSession> {
    this.authenticate(authenticationToken);
    const session = await this.sessions.get(safeIdentifier(sessionId, "session ID"));
    if (!session || !hasGatewayProof(session)) throw new Error("The exact provider-managed session is unavailable.");
    return this.observeSessionInternal(session).catch(async () => this.downgrade(session, "unreachable"));
  }

  async cancelByOperation(authenticationToken: string, operationId: string, reason: string): Promise<number> {
    this.authenticate(authenticationToken);
    const id = safeIdentifier(operationId, "operation ID");
    const boundedReason = safeText(reason, "cancellation reason", 1_024);
    const active = this.inFlightCancellations.get(id);
    if (active) return active;
    const result = this.cancelByOperationOnce(id, boundedReason).finally(() => {
      if (this.inFlightCancellations.get(id) === result) this.inFlightCancellations.delete(id);
    });
    this.inFlightCancellations.set(id, result);
    return result;
  }

  private async cancelByOperationOnce(id: string, boundedReason: string): Promise<number> {
    const record = (await this.operationRecords()).get(id);
    if (!record || record.cancellationAcknowledged || terminal(record.state)) return 0;
    const backend = this.backends.get(record.provider);
    if (!backend) throw new Error("The exact provider cancellation backend is unavailable.");
    const signal = new AbortController().signal;
    const acknowledgement = await backend.cancelOperation({
      operationId: record.operationId,
      externalId: record.externalId,
      routeId: record.routeId,
      targetSnapshotId: record.targetSnapshotId,
      repositoryRoot: record.repositoryRoot,
      reason: boundedReason
    }, signal);
    requireCancellationAcknowledgement(record, acknowledgement);
    if (!acknowledgement.accepted) throw new Error("The exact provider refused cancellation; the operation remains reconcilable.");
    const observed = await this.observeBackendOperation(record, backend).catch(() => undefined);
    const updated: SavedGatewayOperation = {
      ...record,
      state: observed?.outcome ?? "unresolved",
      cancellationAcknowledged: true,
      updatedAt: await this.monotonicHostTime()
    };
    await this.saveOperation(updated);
    return 1;
  }

  async cancelQueuedForRepository(authenticationToken: string, repositoryRoot: string, reason: string): Promise<number> {
    this.authenticate(authenticationToken);
    const root = safeRoot(repositoryRoot);
    let cancelled = 0;
    for (const record of (await this.operationRecords()).values()) {
      if (rootKey(record.repositoryRoot) !== rootKey(root) || terminal(record.state) || record.cancellationAcknowledged) continue;
      cancelled += await this.cancelByOperation(authenticationToken, record.operationId, reason);
    }
    return cancelled;
  }

  async observeOperation(authenticationToken: string, operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>> {
    this.authenticate(authenticationToken);
    const record = (await this.operationRecords()).get(safeIdentifier(operationId, "operation ID"));
    if (!record) return { settled: false, summary: "No exact provider gateway operation is bound to this durable operation." };
    const observed = await this.observeProviderOperation(authenticationToken, {
      repositoryRoot: record.repositoryRoot,
      routeId: record.routeId,
      externalId: record.externalId,
      targetSnapshotId: record.targetSnapshotId
    });
    if (!observed) return { settled: false, summary: "The exact operation is not owned by this provider gateway." };
    return { settled: observed.outcome !== "unresolved", summary: observed.note };
  }

  async observeProviderOperation(authenticationToken: string, input: Readonly<{ repositoryRoot: string; routeId: string; externalId: string; targetSnapshotId: string }>): Promise<ProviderGatewayRecoveryObservation | undefined> {
    this.authenticate(authenticationToken);
    const records = await this.operationRecords();
    const record = [...records.values()].find((candidate) => candidate.externalId === input.externalId);
    if (!record) return undefined;
    if (record.routeId !== input.routeId || record.targetSnapshotId !== input.targetSnapshotId || rootKey(record.repositoryRoot) !== rootKey(input.repositoryRoot)) {
      return { outcome: "unresolved", note: "The provider gateway observation binding changed; no state was inferred." };
    }
    const backend = this.backends.get(record.provider);
    if (!backend) return { outcome: "unresolved", note: "The exact provider observation backend is unavailable." };
    try {
      const observed = await this.observeBackendOperation(record, backend);
      await this.saveOperation({ ...record, state: observed.outcome, updatedAt: await this.monotonicHostTime() });
      return {
        outcome: observed.outcome,
        note: safeText(observed.summary, "provider observation summary", 512),
        details: { provider: record.provider, externalId: record.externalId }
      };
    } catch {
      const session = await this.sessions.get(record.sessionId);
      if (session) await this.downgrade(session, "unreachable");
      return { outcome: "unresolved", note: "The exact provider observation route is unavailable; no work was replayed." };
    }
  }

  private authenticate(authenticationToken: string): void {
    if (!sameToken(this.tokenDigest, authenticationToken)) throw new Error("Provider gateway authentication failed.");
    if (this.externalAuthorizationMissing) throw new Error("An external provider gateway backend lacks explicit configured authorization.");
  }

  private async handshake(input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult> {
    let request: ProviderGatewayHandshakeRequest;
    try { request = parseHandshakeCommand(parseBody(input.body), input.repositoryRoot, input.routeId); }
    catch { return blocked(input.routeId, "The local provider gateway rejected an invalid handshake envelope."); }
    const backend = this.backends.get(request.provider);
    if (!backend) return unavailable(input.routeId, `No exact local ${request.provider} provider gateway backend is installed.`);
    let response: ProviderGatewayHandshakeResult;
    try { response = await backend.handshake(request, signalFor(input)); validateHandshakeResult(response); }
    catch { return unavailable(input.routeId, "The exact provider handshake backend is unavailable or returned invalid evidence.", "ambiguous"); }
    return passed(input.routeId, {
      schema: "sxsy-b122.provider-handshake",
      version: 1,
      sessionId: request.sessionId,
      provider: request.provider,
      targetSnapshotId: request.targetSnapshotId,
      repositoryRoot: request.repositoryRoot,
      capabilities: response.capabilities,
      status: response.status,
      adapterVersion: response.adapterVersion,
      ...(response.taskId ? { taskId: response.taskId } : {}),
      ...(response.planRevision ? { planRevision: response.planRevision } : {}),
      plannedFiles: response.plannedFiles,
      resources: response.resources,
      dependencies: response.dependencies,
      diffDigest: response.diffDigest
    });
  }

  private async executeWorkflow(input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult> {
    let parsed: ProviderGatewayWorkflowCommand;
    try { parsed = parseWorkflowCommand(parseBody(input.body), input.repositoryRoot, input.routeId); }
    catch { return blocked(input.routeId, "The local provider gateway rejected an invalid workflow envelope."); }
    return this.executeCommand(input, parsed);
  }

  private async executeAutomation(input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult> {
    let parsed: ProviderGatewayAutomationCommand;
    try { parsed = parseAutomationCommand(parseBody(input.body), input.repositoryRoot, input.routeId); }
    catch { return blocked(input.routeId, "The local provider gateway rejected an invalid automation envelope."); }
    return this.executeCommand(input, parsed);
  }

  private async executeCommand(input: ProviderGatewayRouteRequest, command: ProviderGatewayCommand): Promise<ConfiguredNetworkResult> {
    const backend = this.backends.get(command.provider);
    if (!backend) return unavailable(input.routeId, `No exact local ${command.provider} provider gateway backend is installed.`);
    if (command.kind === "workflow" && command.child && (command.child.effect.adapterId !== backend.dispatchIdentity.adapterId || command.child.effect.moduleSha256 !== backend.dispatchIdentity.moduleSha256)) {
      return blocked(input.routeId, "The immutable workflow child provider profile does not match the installed host-owned backend identity.");
    }
    const session = await this.sessions.get(command.sessionId);
    if (!session || !canExecuteProviderCommand(session, command, this.now(), this.automaticRefreshIntervalMs)) {
      return blocked(input.routeId, "The exact provider session is not current, running, bound to this TargetSnapshot, and at the catalog-derived capability floor.");
    }
    const requestDigest = sha256(stableJson(command));
    const active = this.inFlightCommands.get(command.operationId);
    if (active) {
      return active.requestDigest === requestDigest
        ? active.result
        : blocked(input.routeId, "The active provider operation ID is already bound to a different exact request.");
    }
    const result = this.executeCommandOnce(input, command, backend, requestDigest).finally(() => {
      if (this.inFlightCommands.get(command.operationId)?.result === result) this.inFlightCommands.delete(command.operationId);
    });
    this.inFlightCommands.set(command.operationId, { requestDigest, result });
    return result;
  }

  private async executeCommandOnce(input: ProviderGatewayRouteRequest, command: ProviderGatewayCommand, backend: ProviderGatewayBackend, requestDigest: string): Promise<ConfiguredNetworkResult> {
    const existing = (await this.operationRecords()).get(command.operationId);
    if (existing) {
      if (existing.requestDigest !== requestDigest || existing.routeId !== command.routeId || existing.targetSnapshotId !== command.targetSnapshotId || existing.provider !== command.provider) {
        return blocked(input.routeId, "The durable provider operation ID is already bound to a different exact request.");
      }
      if (existing.responseBody) return passedEncoded(input.routeId, existing.responseBody);
      return unavailable(input.routeId, "The durable provider request may already have started; exact observation is required before retry.", "ambiguous");
    }
    const submitted: SavedGatewayOperation = {
      operationId: command.operationId,
      externalId: command.externalId,
      routeId: command.routeId,
      provider: command.provider,
      sessionId: command.sessionId,
      repositoryRoot: command.repositoryRoot,
      targetSnapshotId: command.targetSnapshotId,
      requestDigest,
      state: "submitted",
      cancellationAcknowledged: false,
      updatedAt: await this.monotonicHostTime()
    };
    await this.saveOperation(submitted);
    const currentBeforeEffect = await this.sessions.get(command.sessionId);
    if (!currentBeforeEffect || !canExecuteProviderCommand(currentBeforeEffect, command, this.now(), this.automaticRefreshIntervalMs)) {
      await this.saveOperation({ ...submitted, state: "failed", updatedAt: await this.monotonicHostTime() });
      return blocked(input.routeId, "The provider session or its catalog-derived capability floor changed before the final execution boundary.");
    }
    try {
      const response = await backend.execute(command, signalFor(input));
      requireCommandResponse(command, response);
      const currentAfterEffect = await this.sessions.get(command.sessionId);
      if (!currentAfterEffect || !canExecuteProviderCommand(currentAfterEffect, command, this.now(), this.automaticRefreshIntervalMs)) {
        await this.saveOperation({ ...submitted, state: "unresolved", updatedAt: await this.monotonicHostTime() });
        return unavailable(input.routeId, "The provider session changed while the effect was in flight; the result is ambiguous and requires exact observation.", "ambiguous");
      }
      const responseBody = JSON.stringify(response);
      if (Buffer.byteLength(responseBody, "utf8") > maximumBodyBytes) throw new Error("The provider result is oversized.");
      await this.saveOperation({
        ...submitted,
        externalId: command.externalId,
        state: outcomeForResponse(response),
        responseBody,
        updatedAt: await this.monotonicHostTime()
      });
      return passedEncoded(input.routeId, responseBody);
    } catch {
      await this.saveOperation({ ...submitted, state: "unresolved", updatedAt: await this.monotonicHostTime() });
      return unavailable(input.routeId, "The provider gateway lost the exact command result; observation is required and the request was not replayed.", "ambiguous");
    }
  }

  private async observeSessionInternal(session: ManagedSession): Promise<ManagedSession> {
    const provider = providerIdentity(session.provider);
    const backend = this.backends.get(provider);
    if (!backend || !session.targetSnapshotId || !session.workspaceRoot) throw new Error("The provider session lacks an exact observation binding.");
    const response = await backend.observeSession({
      sessionId: session.id,
      provider,
      targetSnapshotId: session.targetSnapshotId,
      repositoryRoot: session.workspaceRoot
    }, new AbortController().signal);
    if (response.sessionId !== session.id || response.provider !== provider || response.targetSnapshotId !== session.targetSnapshotId) {
      return this.downgrade(session, "unknown");
    }
    const capabilities = normalizeCapabilities(response.capabilities);
    requireObservableStatus(response.status, capabilities);
    return this.sessions.upsert({
      ...session,
      capabilities,
      status: response.status,
      adapterVersion: safeAdapterVersion(response.adapterVersion),
      lastHeartbeat: await this.monotonicHostTime()
    });
  }

  private async downgrade(session: ManagedSession, status: Extract<SessionStatus, "unknown" | "unreachable">): Promise<ManagedSession> {
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(session.metadata)) {
      if (!key.startsWith("sxsy-b122.providerHandshake") && !["sxsy-b122.resources", "sxsy-b122.dependencies", "sxsy-b122.diffDigest"].includes(key)) metadata[key] = value;
    }
    metadata["sxsy-b122.providerGateway"] = "capability-proof-unavailable";
    return this.sessions.upsert({
      ...session,
      capabilities: ["registered"],
      status,
      adapterVersion: "provider-gateway-unverified-v1",
      lastHeartbeat: await this.monotonicHostTime(),
      metadata
    });
  }

  private async observeBackendOperation(record: SavedGatewayOperation, backend: ProviderGatewayBackend): Promise<ProviderGatewayOperationObservation> {
    const response = await backend.observeOperation({
      operationId: record.operationId,
      externalId: record.externalId,
      routeId: record.routeId,
      targetSnapshotId: record.targetSnapshotId,
      repositoryRoot: record.repositoryRoot
    }, new AbortController().signal);
    if (response.operationId !== record.operationId || response.externalId !== record.externalId || response.routeId !== record.routeId || response.targetSnapshotId !== record.targetSnapshotId || !operationOutcome(response.outcome)) {
      throw new Error("The provider operation observation changed its exact binding.");
    }
    safeText(response.summary, "provider operation observation", 512);
    return response;
  }

  private async operationRecords(): Promise<Map<string, SavedGatewayOperation>> {
    const result = new Map<string, SavedGatewayOperation>();
    for (const entry of await this.store.readEntries()) {
      if (entry.kind !== gatewayEventKind) continue;
      const operation = parseSavedOperation((entry.payload as { operation?: unknown } | undefined)?.operation);
      result.set(operation.operationId, operation);
    }
    return result;
  }

  private async saveOperation(operation: SavedGatewayOperation): Promise<void> {
    parseSavedOperation(operation);
    await this.store.append(gatewayEventKind, { operation });
  }

  private async monotonicHostTime(): Promise<string> {
    if (!Number.isFinite(this.lastHostTime)) {
      this.lastHostTime = maximumRecordedClock(await this.store.readEntries());
    }
    const observed = Date.parse(this.now());
    if (!Number.isFinite(observed)) throw new Error("The provider gateway host clock is invalid.");
    const next = Math.max(observed, this.lastHostTime + 1);
    this.lastHostTime = next;
    const at = new Date(next).toISOString();
    await this.store.append(gatewayClockKind, { at });
    return at;
  }
}

class GatewayClient implements AuthenticatedProviderGatewayClient {
  constructor(private readonly gateway: LocalProviderCommandGateway, private readonly token: string) {}
  request(input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult> { return this.gateway.request(this.token, input); }
  supportsProvider(provider: ManagedSession["provider"]): provider is ProviderGatewayProvider { return this.gateway.supportsProvider(this.token, provider); }
  handshakeCapabilityCeiling(provider: ManagedSession["provider"]): readonly Capability[] { return this.gateway.handshakeCapabilityCeiling(this.token, provider); }
  recoveryExternalId(input: ProviderGatewayRecoveryIdentityRequest): string | undefined { return this.gateway.recoveryExternalId(this.token, input); }
  refreshSessions(force = false): Promise<readonly ManagedSession[]> { return this.gateway.refreshSessions(this.token, force); }
  observeSession(sessionId: string): Promise<ManagedSession> { return this.gateway.observeSession(this.token, sessionId); }
  cancelByOperation(operationId: string, reason: string): Promise<number> { return this.gateway.cancelByOperation(this.token, operationId, reason); }
  cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number> { return this.gateway.cancelQueuedForRepository(this.token, repositoryRoot, reason); }
  observeOperation(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>> { return this.gateway.observeOperation(this.token, operationId); }
  observeProviderOperation(input: Readonly<{ repositoryRoot: string; routeId: string; externalId: string; targetSnapshotId: string }>): Promise<ProviderGatewayRecoveryObservation | undefined> { return this.gateway.observeProviderOperation(this.token, input); }
}

/**
 * Selects the local gateway only for an exact installed provider. A malformed
 * provider envelope is rejected locally and is never forwarded to a network
 * fallback. The fallback is already constrained by configured-network policy.
 */
export class ProviderGatewayRouteRouter implements ProviderGatewayFallbackTransport {
  constructor(private readonly gateway: AuthenticatedProviderGatewayClient, private readonly fallback: ProviderGatewayFallbackTransport) {}

  async request(input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult> {
    const hint = routeProviderHint(input);
    if (!hint.valid) return this.gateway.request(input);
    if (hint.provider && this.gateway.supportsProvider(hint.provider)) return this.gateway.request(input);
    return this.fallback.request(input);
  }

  recoveryExternalId(input: ProviderGatewayRecoveryIdentityRequest): string | undefined {
    return this.gateway.supportsProvider(input.provider)
      ? this.gateway.recoveryExternalId(input)
      : this.fallback.recoveryExternalId?.(input);
  }

  async handshakeCapabilityCeiling(input: Readonly<{ routeId: string; provider: ManagedSession["provider"] }>): Promise<readonly Capability[]> {
    if (this.gateway.supportsProvider(input.provider)) return this.gateway.handshakeCapabilityCeiling(input.provider);
    return this.fallback.handshakeCapabilityCeiling ? this.fallback.handshakeCapabilityCeiling(input) : ["registered"];
  }
}

/**
 * Deterministic provider double used only by tests and packaged diagnostics.
 * It performs no filesystem, network, process, or provider effect.
 */
export class DeterministicProviderGatewayBackend implements ProviderGatewayBackend {
  readonly provider: ProviderGatewayProvider;
  readonly boundary: ProviderGatewayBoundary;
  readonly dispatchIdentity: Readonly<{ adapterId: string; moduleSha256: string }>;
  commandCalls = 0;
  cancelCalls = 0;
  sessionObservationCalls = 0;
  private unavailableState = false;
  private nextStatus: ProviderGatewayRemoteResult["status"] = "completed";
  private readonly sessions = new Map<string, Omit<ProviderGatewaySessionObservation, "sessionId" | "provider">>();
  private readonly operations = new Map<string, ProviderGatewayOperationObservation>();
  private readonly responses = new Map<string, ProviderGatewayCommandResult>();

  constructor(provider: ProviderGatewayProvider, options: { readonly boundary?: ProviderGatewayBoundary } = {}) {
    this.provider = provider;
    this.boundary = options.boundary ?? "local-only";
    this.dispatchIdentity = Object.freeze({ adapterId: `sxsy-b122.deterministic.${provider}`, moduleSha256: sha256(`sxsy-b122.deterministic.${provider}.v1`) });
  }

  setUnavailable(value: boolean): void { this.unavailableState = value; }
  setNextCommandStatus(status: ProviderGatewayRemoteResult["status"]): void { this.nextStatus = status; }
  setSessionObservation(sessionId: string, observation: Readonly<{ targetSnapshotId: string; status: SessionStatus; capabilities: readonly Capability[]; adapterVersion?: string }>): void {
    this.sessions.set(sessionId, { ...observation, adapterVersion: observation.adapterVersion ?? `${this.provider}-deterministic-v1` });
  }

  async handshake(request: ProviderGatewayHandshakeRequest): Promise<ProviderGatewayHandshakeResult> {
    this.available();
    return {
      capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running",
      adapterVersion: `${this.provider}-deterministic-v1`,
      taskId: `task-${request.sessionId}`,
      planRevision: "deterministic-plan-v1",
      plannedFiles: [],
      resources: [],
      dependencies: [],
      diffDigest: sha256("")
    };
  }

  async execute(request: ProviderGatewayCommand): Promise<ProviderGatewayCommandResult> {
    this.available();
    const prior = this.responses.get(request.externalId);
    if (prior) return prior;
    this.commandCalls += 1;
    const status = this.nextStatus;
    this.nextStatus = "completed";
    const disposition: EffectDisposition = status === "completed" ? "committed" : status === "running" ? "ambiguous" : "not_started";
    const response: ProviderGatewayCommandResult = request.kind === "workflow"
      ? request.child
        ? deterministicWorkflowChildResult(request, status, disposition, this.dispatchIdentity)
        : {
          schema: "sxsy-b122.workflow-result",
          version: 1,
          artifactId: request.artifact.id,
          artifactDigest: request.artifact.digest,
          operationId: request.operationId,
          action: request.action,
          status: workflowStatus(status),
          effectDisposition: disposition,
          summary: `Deterministic ${this.provider} provider ${status}.`,
          externalId: request.externalId,
          result: deterministicWorkflowResult(request)
        }
      : {
          schema: automationResultSchema(request.action),
          version: 1,
          action: request.action,
          status,
          effectDisposition: disposition,
          summary: `Deterministic ${this.provider} automation ${status}.`,
          externalId: request.externalId,
          result: deterministicAutomationResult(request)
        };
    this.responses.set(request.externalId, response);
    this.operations.set(request.externalId, {
      operationId: request.operationId,
      externalId: request.externalId,
      routeId: request.routeId,
      targetSnapshotId: request.targetSnapshotId,
      outcome: status === "completed" ? "committed" : status === "running" ? "unresolved" : status === "cancelled" ? "cancelled" : "failed",
      summary: `Deterministic ${this.provider} operation is ${status}.`
    });
    return response;
  }

  async observeSession(request: ProviderGatewaySessionObservationRequest): Promise<ProviderGatewaySessionObservation> {
    this.available();
    this.sessionObservationCalls += 1;
    const configured = this.sessions.get(request.sessionId) ?? {
      targetSnapshotId: request.targetSnapshotId,
      status: "running" as const,
      capabilities: ["registered", "observable", "controllable", "mediated"] as const,
      adapterVersion: `${this.provider}-deterministic-v1`
    };
    return { sessionId: request.sessionId, provider: this.provider, ...configured };
  }

  async observeOperation(request: ProviderGatewayOperationObservationRequest): Promise<ProviderGatewayOperationObservation> {
    this.available();
    const operation = this.operations.get(request.externalId);
    if (!operation) return { ...request, outcome: "unresolved", summary: "The deterministic provider has no exact operation." };
    return { ...operation };
  }

  async cancelOperation(request: ProviderGatewayCancellationRequest): Promise<ProviderGatewayCancellationAcknowledgement> {
    this.available();
    this.cancelCalls += 1;
    const operation = this.operations.get(request.externalId);
    if (!operation || operation.operationId !== request.operationId || operation.targetSnapshotId !== request.targetSnapshotId) {
      return { operationId: request.operationId, externalId: request.externalId, targetSnapshotId: request.targetSnapshotId, accepted: false, summary: "No exact operation was found." };
    }
    this.operations.set(request.externalId, { ...operation, outcome: "cancelled", summary: "The deterministic provider reports the exact operation cancelled." });
    return { operationId: request.operationId, externalId: request.externalId, targetSnapshotId: request.targetSnapshotId, accepted: true, summary: "Cancellation acknowledged." };
  }

  private available(): void { if (this.unavailableState) throw new Error("The deterministic provider is unavailable."); }
}

function parseHandshakeCommand(value: Record<string, unknown>, repositoryRoot: string, routeId: string): ProviderGatewayHandshakeRequest {
  const providerFromRoute = routeId.slice("provider.handshake.".length);
  const provider = providerIdentity(value.provider);
  if (providerFromRoute !== provider || value.schema !== "sxsy-b122.provider-handshake-request" || value.version !== 1) throw new Error("The provider handshake route is invalid.");
  const request: ProviderGatewayHandshakeRequest = {
    sessionId: safeIdentifier(value.sessionId, "session ID"),
    provider,
    targetSnapshotId: digest(value.targetSnapshotId, "target snapshot"),
    repositoryRoot: exactRoot(value.repositoryRoot, repositoryRoot),
    ...(value.branch === undefined ? {} : { branch: safeText(value.branch, "branch", 240) }),
    ...(value.head === undefined ? {} : { head: digest40(value.head, "Git head") })
  };
  boundedJson(value);
  return request;
}

function parseWorkflowCommand(value: Record<string, unknown>, repositoryRoot: string, routeId: string): ProviderGatewayWorkflowCommand {
  if (value.schema !== "sxsy-b122.workflow-command" || value.version !== 1 || !routeId.startsWith("provider.")) throw new Error("The workflow gateway request is invalid.");
  const action = safeIdentifier(value.action, "workflow action") as WorkflowArtifactAction;
  if (routeId !== `provider.${action}`) throw new Error("The workflow route and action differ.");
  const target = object(value.target, "target");
  const session = object(value.session, "session");
  const artifact = object(value.artifact, "artifact");
  const hasChild = value.child !== undefined;
  if (!exact(value, ["schema", "version", "action", "operationId", "target", "session", "authorityId", "artifact", ...(hasChild ? ["child"] : []), ...(action === "plan_approval" ? ["executionAuthorization"] : [])])) throw new Error("The workflow gateway request contains unknown or missing fields.");
  if (!allowedExact(target, ["id", "repositoryRoot", "policyVersion", "trackedManifest", "untrackedManifest"], ["branch", "head"])) throw new Error("The workflow target binding is malformed.");
  if (!allowedExact(session, ["id", "provider", "surface", "capabilities", "plannedFiles"], ["taskId", "planRevision"])) throw new Error("The workflow session binding is malformed.");
  if (!allowedExact(artifact, ["id", "digest", "authorityId", "payload", "executionAuthorized"], ["sessionId", "operationId", "taskId", "planRevision", "coordinatorContextDigest", "coordinatorContextRevision"])) throw new Error("The workflow artifact binding is malformed.");
  if (artifact.executionAuthorized !== false) throw new Error("Provider workflow artifacts never authorize execution.");
  const operationId = safeIdentifier(value.operationId, "operation ID");
  const targetSnapshotId = digest(target.id, "target snapshot");
  const sessionId = safeIdentifier(session.id, "session ID");
  const authorityId = safeIdentifier(value.authorityId, "authority ID");
  const exactRepositoryRoot = exactRoot(target.repositoryRoot, repositoryRoot);
  const artifactId = safeIdentifier(artifact.id, "artifact ID");
  const artifactDigest = digest(artifact.digest, "artifact digest");
  const artifactAuthorityId = safeIdentifier(artifact.authorityId, "artifact authority ID");
  if (!hasChild && artifactAuthorityId !== authorityId) throw new Error("The workflow artifact authority differs from the exact mediated dispatch authority.");
  if (hasChild !== (artifact.sessionId !== undefined && artifact.operationId !== undefined)) throw new Error("A workflow child command requires the exact immutable parent session and operation binding.");
  const artifactSessionId = hasChild ? safeIdentifier(artifact.sessionId, "artifact session ID") : sessionId;
  const parentOperationId = hasChild ? safeIdentifier(artifact.operationId, "parent operation ID") : operationId;
  const hasCoordinatorDigest = artifact.coordinatorContextDigest !== undefined;
  const hasCoordinatorRevision = artifact.coordinatorContextRevision !== undefined;
  if (hasCoordinatorDigest !== hasCoordinatorRevision
    || (hasCoordinatorRevision && (!Number.isSafeInteger(artifact.coordinatorContextRevision) || (artifact.coordinatorContextRevision as number) < 1))) {
    throw new Error("The workflow artifact coordinator binding is partial or invalid.");
  }
  const canonical = canonicalWorkflowArtifact({
    id: artifactId,
    action,
    repositoryRoot: exactRepositoryRoot,
    targetSnapshotId,
    sessionId: artifactSessionId,
    ...(artifact.taskId === undefined ? {} : { taskId: safeIdentifier(artifact.taskId, "task ID") }),
    ...(artifact.planRevision === undefined ? {} : { planRevision: safeIdentifier(artifact.planRevision, "plan revision") }),
    authorityId: artifactAuthorityId,
    ...(hasCoordinatorDigest ? {
      coordinatorContextDigest: digest(artifact.coordinatorContextDigest, "coordinator context digest"),
      coordinatorContextRevision: artifact.coordinatorContextRevision as number
    } : {}),
    payload: object(artifact.payload, "workflow payload") as unknown as WorkflowArtifactPayload
  });
  if (canonical.digest !== artifactDigest) throw new Error("The workflow artifact digest does not match its exact canonical immutable content.");
  const immutable: WorkflowArtifactImmutable = canonical.immutable;
  const payload = immutable.payload;
  let child: ProviderGatewayWorkflowCommand["child"];
  if (hasChild) {
    const childValue = object(value.child, "workflow child");
    if (!exact(childValue, ["role", "bindingDigest"])) throw new Error("The workflow child binding contains unknown or missing fields.");
    const role = childValue.role === "proof_backend" || childValue.role === "authority_recipient" ? childValue.role : (() => { throw new Error("The workflow child role is invalid."); })();
    const bindingDigest = digest(childValue.bindingDigest, "workflow child binding");
    const effect = workflowProviderEffect(payload, role, bindingDigest);
    if (effect.session.id !== sessionId || effect.authority.id !== authorityId || effect.provider !== providerIdentity(session.provider)
      || session.surface !== effect.session.surface || stableJson(session.capabilities) !== stableJson(effect.session.capabilities)
      || stableJson(session.plannedFiles) !== stableJson(effect.session.plannedFiles)
      || session.taskId !== effect.session.taskId || session.planRevision !== effect.session.planRevision) {
      throw new Error("The workflow child transport session or authority differs from its immutable provider effect.");
    }
    child = { role, bindingDigest, effect, parentOperationId };
  }
  let executionAuthorization: ProviderGatewayWorkflowCommand["executionAuthorization"];
  if (action === "plan_approval") {
    const authorization = object(value.executionAuthorization, "plan execution authorization");
    if (!exact(authorization, ["executionAuthorized", "executeOnce", "currentUserConfirmed", "confirmationDigest", "confirmationScopeDigest", "operationId", "artifactId", "artifactDigest", "targetSnapshotId", "sessionId", "authorityId", "planDigest", "planRevision", "originSessionId"])
      || authorization.executionAuthorized !== true || authorization.executeOnce !== true || authorization.currentUserConfirmed !== true
      || authorization.operationId !== operationId || authorization.artifactId !== artifactId || authorization.artifactDigest !== artifactDigest
      || authorization.targetSnapshotId !== targetSnapshotId || authorization.sessionId !== sessionId
      || authorization.authorityId !== authorityId) {
      throw new Error("Plan execution authorization does not exactly bind the confirmed immutable plan dispatch.");
    }
    const approval = approvalPayload(payload);
    const plan = approval.plan;
    if (!immutable.coordinatorContextDigest || !immutable.coordinatorContextRevision) throw new Error("Plan Approval requires one exact protected coordinator-context binding.");
    const expectedScopeDigest = planApprovalReviewScopeDigest({
      sessionId,
      targetSnapshotId,
      repositoryRoot: exactRepositoryRoot,
      taskId: plan.taskId,
      planRevision: plan.revision,
      planDigest: plan.digest,
      originSessionId: plan.originSessionId,
      providerContextDigest: approval.providerContextDigest,
      sourceRevision: immutable.coordinatorContextRevision
    });
    if (approval.executorSessionId !== sessionId || approval.authorityId !== authorityId || approval.confirmationDigest !== authorization.confirmationDigest
      || approval.confirmationScopeDigest !== authorization.confirmationScopeDigest || approval.confirmationScopeDigest !== expectedScopeDigest
      || immutable.taskId !== plan.taskId || immutable.planRevision !== plan.revision || session.taskId !== plan.taskId || session.planRevision !== plan.revision) {
      throw new Error("Plan execution authorization changed the immutable task, plan, executor, authority, or current-user confirmation binding.");
    }
    if (authorization.planDigest !== plan.digest || authorization.planRevision !== plan.revision || authorization.originSessionId !== plan.originSessionId) throw new Error("Plan execution authorization changed the immutable plan binding.");
    executionAuthorization = {
      executionAuthorized: true,
      executeOnce: true,
      currentUserConfirmed: true,
      confirmationDigest: digest(authorization.confirmationDigest, "confirmation digest"),
      confirmationScopeDigest: digest(authorization.confirmationScopeDigest, "confirmation scope digest"),
      operationId,
      artifactId,
      artifactDigest,
      targetSnapshotId,
      sessionId,
      authorityId: safeIdentifier(authorization.authorityId, "authority ID"),
      planDigest: digest(authorization.planDigest, "plan digest"),
      planRevision: safeIdentifier(authorization.planRevision, "plan revision"),
      originSessionId: safeIdentifier(authorization.originSessionId, "plan origin session")
    };
  } else if (value.executionAuthorization !== undefined) {
    throw new Error("Only Plan Approval may carry a mediated execution authorization.");
  }
  boundedJson(value);
  return {
    kind: "workflow",
    routeId,
    operationId,
    externalId: operationId,
    action,
    repositoryRoot: exactRepositoryRoot,
    targetSnapshotId,
    sessionId,
    authorityId,
    provider: providerIdentity(session.provider),
    artifact: {
      id: immutable.id,
      digest: artifactDigest,
      ...(hasChild ? { sessionId: artifactSessionId, operationId: parentOperationId } : {}),
      ...(immutable.taskId === undefined ? {} : { taskId: immutable.taskId }),
      ...(immutable.planRevision === undefined ? {} : { planRevision: immutable.planRevision }),
      ...(immutable.authorityId === undefined ? {} : { authorityId: immutable.authorityId }),
      ...(immutable.coordinatorContextDigest === undefined ? {} : { coordinatorContextDigest: immutable.coordinatorContextDigest }),
      ...(immutable.coordinatorContextRevision === undefined ? {} : { coordinatorContextRevision: immutable.coordinatorContextRevision }),
      payload
    },
    ...(child ? { child } : {}),
    ...(executionAuthorization ? { executionAuthorization } : {})
  };
}

function approvalPayload(payload: WorkflowArtifactPayload): Extract<WorkflowArtifactPayload, { kind: "plan"; mode: "approve" }> {
  if (payload.kind !== "plan" || payload.mode !== "approve" || payload.executeOnce !== true) throw new Error("Plan Approval requires one exact immutable execute-once plan payload.");
  return payload;
}

function parseAutomationCommand(value: Record<string, unknown>, repositoryRoot: string, routeId: string): ProviderGatewayAutomationCommand {
  if (!routeId.startsWith("automation.")) throw new Error("The automation gateway request is invalid.");
  const parsed = parseAutomationEnvelope(value);
  if (routeId !== `automation.${parsed.action}`) throw new Error("The automation route and action differ.");
  const target = object(parsed.target, "target");
  const session = object(parsed.session, "session");
  boundedJson(value);
  return {
    kind: "automation",
    routeId,
    operationId: safeIdentifier(parsed.operationId, "operation ID"),
    externalId: safeIdentifier(parsed.operationId, "operation ID"),
    action: parsed.action,
    repositoryRoot: exactRoot(target.repositoryRoot, repositoryRoot),
    targetSnapshotId: digest(target.id, "target snapshot"),
    sessionId: safeIdentifier(session.id, "session ID"),
    provider: providerIdentity(session.provider),
    intent: parsed.intent
  };
}

function parseBody(value: string | Uint8Array | undefined): Record<string, unknown> {
  if (value === undefined) throw new Error("The provider gateway request body is missing.");
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBodyBytes) throw new Error("The provider gateway request body is invalid or oversized.");
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("The provider gateway request body is malformed."); }
  return object(parsed, "provider gateway request");
}

function routeProviderHint(input: ProviderGatewayRouteRequest): Readonly<{ valid: boolean; provider?: ManagedSession["provider"] }> {
  if (input.routeId.startsWith("provider.handshake.")) {
    const provider = input.routeId.slice("provider.handshake.".length);
    return provider === "claude" || provider === "codex" || provider === "generic" || provider === "voice"
      ? { valid: true, provider }
      : { valid: false };
  }
  if (!input.routeId.startsWith("provider.") && !input.routeId.startsWith("automation.")) return { valid: true };
  try {
    const body = parseBody(input.body);
    const session = object(body.session, "session");
    const provider = session.provider;
    return provider === "claude" || provider === "codex" || provider === "generic" || provider === "voice"
      ? { valid: true, provider }
      : { valid: false };
  } catch { return { valid: false }; }
}

function validateRouteRequest(input: ProviderGatewayRouteRequest): string | undefined {
  try { safeRoute(input.routeId); safeRoot(input.repositoryRoot); }
  catch { return "The local provider gateway rejected an invalid fixed route or repository root."; }
  return undefined;
}

function requireCommandResponse(command: ProviderGatewayCommand, response: ProviderGatewayCommandResult): void {
  boundedJson(response);
  if (response.externalId !== command.externalId || response.status === undefined || response.effectDisposition === undefined || !safeSummary(response.summary)) throw new Error("The provider response is not exact or bounded.");
  if (command.kind === "workflow") {
    if (command.child) {
      parseWorkflowChildProviderResponse(response, workflowArtifactForCommand(command), command.child.effect, command.operationId, command.child.role);
    } else {
      const workflowResponse = response as WorkflowProviderResponse;
      if (workflowResponse.schema !== "sxsy-b122.workflow-result" || workflowResponse.version !== 1 || workflowResponse.operationId !== command.operationId || workflowResponse.action !== command.action || workflowResponse.artifactId !== command.artifact.id || workflowResponse.artifactDigest !== command.artifact.digest) throw new Error("The workflow provider response changed its exact binding.");
    }
  } else parseAutomationProviderResult(response, command.action, command.externalId);
}

function workflowArtifactForCommand(command: ProviderGatewayWorkflowCommand): WorkflowArtifact {
  const now = new Date(0).toISOString();
  return {
    id: command.artifact.id, digest: command.artifact.digest, action: command.action, repositoryRoot: command.repositoryRoot,
    targetSnapshotId: command.targetSnapshotId, sessionId: command.artifact.sessionId ?? command.sessionId,
    ...(command.artifact.taskId ? { taskId: command.artifact.taskId } : {}), ...(command.artifact.planRevision ? { planRevision: command.artifact.planRevision } : {}),
    ...(command.artifact.authorityId ? { authorityId: command.artifact.authorityId } : {}), payload: command.artifact.payload,
    status: "submitted", operationId: command.child?.parentOperationId ?? command.operationId, executionAuthorized: false, createdAt: now, updatedAt: now
  };
}

function validateHandshakeResult(value: ProviderGatewayHandshakeResult): void {
  const capabilities = normalizeCapabilities(value.capabilities);
  requireObservableStatus(value.status, capabilities);
  safeAdapterVersion(value.adapterVersion);
  digest(value.diffDigest, "provider diff digest");
  boundedStringList(value.plannedFiles, 512, 512);
  boundedStringList(value.resources, 128, 256);
  boundedStringList(value.dependencies, 128, 256);
}

function requireCancellationAcknowledgement(record: SavedGatewayOperation, value: ProviderGatewayCancellationAcknowledgement): void {
  if (value.operationId !== record.operationId || value.externalId !== record.externalId || value.targetSnapshotId !== record.targetSnapshotId || typeof value.accepted !== "boolean" || !safeSummary(value.summary)) throw new Error("The provider cancellation acknowledgement changed its exact binding.");
}

function parseSavedOperation(value: unknown): SavedGatewayOperation {
  const record = object(value, "provider gateway operation");
  const state = record.state;
  if (state !== "submitted" && !operationOutcome(state)) throw new Error("The protected provider gateway operation state is invalid.");
  return {
    operationId: safeIdentifier(record.operationId, "operation ID"),
    externalId: safeIdentifier(record.externalId, "external ID"),
    routeId: safeRoute(record.routeId),
    provider: providerIdentity(record.provider),
    sessionId: safeIdentifier(record.sessionId, "session ID"),
    repositoryRoot: safeRoot(record.repositoryRoot),
    targetSnapshotId: digest(record.targetSnapshotId, "target snapshot"),
    requestDigest: digest(record.requestDigest, "request digest"),
    state,
    ...(record.responseBody === undefined ? {} : { responseBody: safeText(record.responseBody, "provider response", maximumBodyBytes) }),
    cancellationAcknowledged: boolean(record.cancellationAcknowledged, "cancellation acknowledgement"),
    updatedAt: timestamp(record.updatedAt, "operation update time")
  };
}

function maximumRecordedClock(entries: readonly JournalEntry<unknown>[]): number {
  let maximum = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (entry.kind !== gatewayClockKind) continue;
    const at = (entry.payload as { at?: unknown } | undefined)?.at;
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) throw new Error("The protected provider gateway clock record is invalid.");
    maximum = Math.max(maximum, Date.parse(at));
  }
  return maximum;
}

function deterministicWorkflowChildResult(request: ProviderGatewayWorkflowCommand, status: ProviderGatewayRemoteResult["status"], disposition: EffectDisposition, identity: Readonly<{ adapterId: string; moduleSha256: string }>): WorkflowChildProviderResponse {
  const child = request.child!;
  const terminalStatus: WorkflowChildProviderResponse["status"] = status === "completed" ? "completed" : status === "unavailable" ? "unavailable" : "failed";
  if (child.role === "proof_backend") {
    return {
      schema: "sxsy-b122.workflow-child-result", version: 1, artifactId: request.artifact.id, artifactDigest: request.artifact.digest,
      parentOperationId: child.parentOperationId, childOperationId: request.operationId, action: request.action, role: child.role,
      bindingDigest: child.bindingDigest, provider: request.provider, adapterId: identity.adapterId, moduleSha256: identity.moduleSha256,
      status: terminalStatus, effectDisposition: status === "completed" ? "committed" : disposition === "committed" ? "ambiguous" : disposition,
      summary: `Deterministic ${request.provider} independent proof ${status}.`, ...(status === "completed" ? { externalId: request.externalId } : {}),
      result: { kind: "proof_backend", backend: request.provider, status: status === "completed" ? "passed" : status === "unavailable" ? "unavailable" : "failed", verifiedClaims: status === "completed" && request.artifact.payload.kind === "proof" ? request.artifact.payload.claims : [], evidenceReferences: request.artifact.payload.kind === "proof" ? workflowEvidenceReferences(request.artifact.payload.evidence) : [] }
    };
  }
  if (status !== "completed" || request.artifact.payload.kind !== "authority") throw new Error("The deterministic authority recipient did not produce a terminal acknowledgement.");
  const packet = request.artifact.payload.packets.find((candidate) => candidate.providerEffect?.bindingDigest === child.bindingDigest);
  if (!packet) throw new Error("The deterministic authority recipient packet binding is missing.");
  return {
    schema: "sxsy-b122.workflow-child-result", version: 1, artifactId: request.artifact.id, artifactDigest: request.artifact.digest,
    parentOperationId: child.parentOperationId, childOperationId: request.operationId, action: request.action, role: child.role,
    bindingDigest: child.bindingDigest, provider: request.provider, adapterId: identity.adapterId, moduleSha256: identity.moduleSha256,
    status: "completed", effectDisposition: "committed", summary: `Deterministic ${request.provider} recipient acknowledged its exact packet.`, externalId: request.externalId,
    result: { kind: "authority_recipient", recipientSessionId: packet.recipientSessionId, grantId: packet.grantId, matchDigest: packet.matchDigest, acknowledged: true }
  };
}

function deterministicWorkflowResult(request: ProviderGatewayWorkflowCommand): WorkflowProviderResult {
  const payload = request.artifact.payload;
  switch (payload.kind) {
    case "anchor": return { kind: "anchor", anchorDigest: sha256(stableJson(payload)), discrepancies: [], questions: payload.unresolved, resumed: false };
    case "proof": return { kind: "proof", verifiedClaims: payload.claims, evidenceReferences: workflowEvidenceReferences(payload.evidence), backendResults: payload.requiredBackends.map((backend) => ({ backend, status: "passed" as const })) };
    case "decision": return {
      kind: "decision",
      decisionPacketId: `packet:${request.artifact.id}`,
      decisions: payload.decisions.map((decision) => ({
        decisionId: decision.id,
        options: Array.from({ length: 5 }, (_, index) => ({ id: `${decision.id}:option-${index + 1}`, label: `Bounded option ${index + 1}`, tradeoffs: [`Tradeoff ${index + 1}`], risks: [`Risk ${index + 1}`] })),
        recommendationId: `${decision.id}:option-1`
      })),
      userSelectionRequired: true
    };
    case "plan": return payload.mode === "expand"
      ? { kind: "plan", mode: "expanded", planDigest: payload.plan.digest, alternatives: Array.from({ length: 15 }, (_, index) => ({ rank: index + 1, id: `alternative-${index + 1}`, summary: `Creative alternative ${index + 1}`, rationale: `Distinct reviewed approach ${index + 1}.`, risks: [] })) }
      : { kind: "plan", mode: "execution_ack", planDigest: payload.plan.digest, planRevision: payload.plan.revision, originSessionId: payload.plan.originSessionId, executorSessionId: payload.executorSessionId, authorityId: payload.authorityId, acknowledgementId: `ack:${request.operationId}`, executionStarted: true };
    case "handoff": return { kind: "handoff", packageId: payload.packageId, recipientSessionId: payload.recipientSessionId ?? request.sessionId, acknowledged: true };
    case "focus": return { kind: "focus", selectedSessionId: payload.selectedSessionId, status: payload.expectedStatus, queueCycleId: payload.queueCycleId, resultDelivered: true };
    case "authority": return { kind: "authority", acknowledgements: payload.packets.map((packet) => ({ recipientSessionId: packet.recipientSessionId, grantId: packet.grantId, matchDigest: packet.matchDigest, acknowledged: true })) };
    case "voice_binding": return { kind: "voice_binding", bindingId: `binding:${request.artifact.id}`, active: true };
  }
}

function deterministicAutomationResult(request: ProviderGatewayAutomationCommand): AutomationProviderResultPayload {
  const evidence = (label: string): string => sha256(stableJson({ label, operationId: request.operationId, targetSnapshotId: request.targetSnapshotId }));
  switch (request.action) {
    case "compound_capture": return { kind: request.action, captureId: `capture:${request.operationId}`, learningDigest: evidence("learning"), verifiedProblemDigest: evidence("verified-problem"), documents: ["docs/solutions/deterministic-learning.md"] };
    case "compound_refresh": return { kind: request.action, previewDigest: evidence("refresh-preview"), affectedPaths: [], creates: 0, updates: 0, deletes: 0, mutationApplied: false };
    case "lfg": return { kind: request.action, runId: `lfg:${request.operationId}`, stages: request.intent.kind === "lfg" ? request.intent.lifecycle.map((name) => ({ name, status: "passed" as const, evidenceDigest: evidence(name) })) : [], pullRequestUrl: null, deploymentAttempted: false };
    case "repair_mission": return { kind: request.action, reproduction: { commandDigest: evidence("reproduction-command"), status: "not_reproduced", logsDigest: evidence("reproduction-logs") }, approvedScopeDigest: evidence("approved-scope"), diffDigest: sha256(""), affectedChecks: [], fullChecks: [], risks: ["Deterministic diagnostics do not modify the repository."], nextAction: "Review the diagnostic receipt before authorizing any repair.", pushAttempted: false, mergeAttempted: false, deployAttempted: false, hostedRerunAttempted: false, productionDataUsed: false };
  }
}

function workflowEvidenceReferences(evidence: Extract<WorkflowArtifactPayload, { kind: "proof" }>["evidence"]): readonly string[] {
  return [
    ...evidence.instructions.map((entry) => `${entry.id}:${entry.digest}`),
    ...evidence.documentation.map((entry) => `${entry.id}:${entry.digest}`),
    `${evidence.diff.id}:${evidence.diff.digest}`,
    ...evidence.files.map((entry) => `${entry.id}:${entry.digest}`),
    ...evidence.tests.map((entry) => `${entry.id}:${entry.digest}:${entry.status}`)
  ];
}

function outcomeForResponse(response: ProviderGatewayCommandResult): ProviderGatewayOperationOutcome {
  if (response.status === "completed" && response.effectDisposition === "committed") return "committed";
  if (response.status === "cancelled" || response.effectDisposition === "compensated") return "cancelled";
  if (response.status === "running" || response.effectDisposition === "ambiguous") return "unresolved";
  return "failed";
}

function workflowStatus(value: ProviderGatewayRemoteResult["status"]): WorkflowProviderResponse["status"] {
  return value === "cancelled" || value === "timed_out" ? "failed" : value;
}

function hasGatewayProof(session: ManagedSession): boolean {
  return (session.provider === "claude" || session.provider === "codex")
    && session.metadata["sxsy-b122.providerHandshake"] === "exact-route-v1"
    && session.metadata["sxsy-b122.providerHandshakeTarget"] === session.targetSnapshotId
    && !!session.workspaceRoot;
}

function canExecuteProviderCommand(session: ManagedSession, command: ProviderGatewayCommand, now: string, refreshIntervalMs: number): boolean {
  const observedAt = Date.parse(session.lastHeartbeat);
  const current = Date.parse(now);
  const freshnessMs = Math.max(60_000, refreshIntervalMs * 2);
  if (!(commandActionIds as readonly string[]).includes(command.action)) return false;
  const actual = new Set(session.capabilities);
  if (actual.size !== session.capabilities.length
    || (actual.has("observable") && !actual.has("registered"))
    || (actual.has("controllable") && !actual.has("registered"))
    || (actual.has("mediated") && (!actual.has("registered") || !actual.has("observable") || !actual.has("controllable")))) return false;
  const declared = commandForAction(command.action as CommandAction).requiresCapabilities;
  const required = new Set<Capability>(declared);
  if (required.has("observable") || required.has("controllable") || required.has("mediated")) required.add("registered");
  if (required.has("mediated")) { required.add("observable"); required.add("controllable"); }
  const requiredCapabilities: readonly Capability[] = ["registered", "observable", "controllable", "mediated"].filter((capability): capability is Capability => required.has(capability as Capability));
  return hasGatewayProof(session)
    && session.provider === command.provider
    && session.status === "running"
    && requiredCapabilities.every((capabilityValue) => session.capabilities.includes(capabilityValue))
    && Number.isFinite(observedAt) && Number.isFinite(current) && observedAt <= current + 30_000 && current - observedAt <= freshnessMs
    && session.targetSnapshotId === command.targetSnapshotId
    && !!session.workspaceRoot && rootKey(session.workspaceRoot) === rootKey(command.repositoryRoot)
    && (command.kind !== "workflow" || (session.taskId === command.artifact.taskId && session.planRevision === command.artifact.planRevision));
}

function providerBackend(backends: ReadonlyMap<ProviderGatewayProvider, ProviderGatewayBackend>, provider: ManagedSession["provider"]): ProviderGatewayBackend | undefined {
  return provider === "claude" || provider === "codex" ? backends.get(provider) : undefined;
}

function normalizeCapabilities(values: readonly Capability[]): readonly Capability[] {
  if (!Array.isArray(values) || values.length > 4 || !values.every(capability)) throw new Error("The provider capability observation is invalid.");
  const result = [...new Set(values)];
  if (!result.includes("registered")) throw new Error("Provider capability proof must retain Registered.");
  if (result.includes("controllable") && !result.includes("observable")) throw new Error("Controllable provider capability requires Observable.");
  if (result.includes("mediated") && (!result.includes("controllable") || !result.includes("observable"))) throw new Error("Mediated provider capability requires Observable and Controllable.");
  return result;
}

function requireObservableStatus(status: SessionStatus, capabilities: readonly Capability[]): void {
  if (!sessionStatus(status)) throw new Error("The provider session status is invalid.");
  if ((status === "verified_blocked" || status === "verified_finished") && !capabilities.includes("observable")) throw new Error("Verified provider status requires Observable capability.");
}

function boundedJson(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error("The provider gateway document is too deeply nested.");
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") { if (value.length > maximumText || /\0/.test(value)) throw new Error("The provider gateway document contains invalid text."); return; }
  if (Array.isArray(value)) { if (value.length > 512) throw new Error("The provider gateway document contains an oversized list."); for (const item of value) boundedJson(item, depth + 1); return; }
  if (!value || typeof value !== "object") throw new Error("The provider gateway document contains an unsupported value.");
  const entries = Object.entries(value);
  if (entries.length > 128) throw new Error("The provider gateway document contains too many fields.");
  for (const [key, item] of entries) { if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw new Error("The provider gateway document field is invalid."); boundedJson(item, depth + 1); }
}

function object(value: unknown, field: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} is invalid.`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function allowedExact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const allowed = new Set([...required, ...optional]); return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key)); }
function boolean(value: unknown, field: string): boolean { if (typeof value !== "boolean") throw new Error(`${field} is invalid.`); return value; }
function safeIdentifier(value: unknown, field: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) throw new Error(`${field} is invalid.`); return value; }
function safeOperationId(value: unknown): value is string { try { safeIdentifier(value, "operation ID"); return true; } catch { return false; } }
function safeRoute(value: unknown): string { if (typeof value !== "string" || !/^[a-z][a-z0-9_.-]{0,127}$/.test(value)) throw new Error("The provider gateway route is invalid."); return value; }
function safeRoot(value: unknown): string { if (typeof value !== "string" || value.length > 4_096 || !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) || /[\0\r\n]/.test(value)) throw new Error("The provider repository root is invalid."); return value; }
function exactRoot(value: unknown, expected: string): string { const root = safeRoot(value); if (rootKey(root) !== rootKey(safeRoot(expected))) throw new Error("The provider repository root changed."); return expected; }
function rootKey(value: string): string { return value.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase(); }
function digest(value: unknown, field: string): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${field} is invalid.`); return value.toLowerCase(); }
function digest40(value: unknown, field: string): string { if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) throw new Error(`${field} is invalid.`); return value.toLowerCase(); }
function safeText(value: unknown, field: string, maximum = maximumText): string { if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\0\r\n]/.test(value)) throw new Error(`${field} is invalid.`); return value.trim(); }
function safeSummary(value: unknown): value is string { try { safeText(value, "provider summary", 512); return true; } catch { return false; } }
function timestamp(value: unknown, field: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${field} is invalid.`); return value; }
function safeAdapterVersion(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(value)) throw new Error("The provider adapter version is invalid."); return value; }
function boundedStringList(values: readonly string[], maximumItems: number, maximumLength: number): void { if (!Array.isArray(values) || values.length > maximumItems || !values.every((value) => typeof value === "string" && !!value.trim() && value.length <= maximumLength && !/[\0\r\n]/.test(value))) throw new Error("The provider returned an invalid bounded list."); }
function providerIdentity(value: unknown): ProviderGatewayProvider { if (value !== "claude" && value !== "codex") throw new Error("The local provider gateway requires an exact Claude or Codex provider."); return value; }
function capability(value: unknown): value is Capability { return value === "registered" || value === "observable" || value === "controllable" || value === "mediated"; }
function sessionStatus(value: unknown): value is SessionStatus { return value === "running" || value === "verified_blocked" || value === "verified_finished" || value === "unreachable" || value === "stale" || value === "unknown"; }
function operationOutcome(value: unknown): value is ProviderGatewayOperationOutcome { return value === "committed" || value === "failed" || value === "cancelled" || value === "unresolved"; }
function terminal(value: SavedGatewayOperation["state"]): boolean { return value === "committed" || value === "failed" || value === "cancelled"; }
function boundedDuration(value: number): number { if (!Number.isSafeInteger(value) || value < 0 || value > 15 * 60_000) throw new Error("The provider gateway refresh interval is invalid."); return value; }
function signalFor(input: ProviderGatewayRouteRequest): AbortSignal { return input.signal ?? new AbortController().signal; }
function tokenDigest(value: string): Buffer { if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("The provider gateway authentication token must be 256 bits."); return createHash("sha256").update(value.toLowerCase(), "ascii").digest(); }
function sameToken(expected: Buffer, value: string): boolean { try { return timingSafeEqual(expected, tokenDigest(value)); } catch { return false; } }

function passed(routeId: string, value: unknown): ConfiguredNetworkResult { return passedEncoded(routeId, JSON.stringify(value)); }
function passedEncoded(routeId: string, value: string): ConfiguredNetworkResult { return { outcome: "passed", routeId, detail: "The authenticated local provider gateway returned an exact bounded response.", effectDisposition: "ambiguous", body: Buffer.from(value, "utf8") }; }
function blocked(routeId: string, detail: string): ConfiguredNetworkResult { return { outcome: "blocked", routeId, detail, effectDisposition: "not_started" }; }
function unavailable(routeId: string, detail: string, effectDisposition: "not_started" | "ambiguous" = "not_started"): ConfiguredNetworkResult { return { outcome: "unavailable", routeId, detail, effectDisposition }; }
