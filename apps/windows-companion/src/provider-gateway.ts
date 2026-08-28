import { createHash, timingSafeEqual } from "node:crypto";

import type {
  Capability,
  EffectDisposition,
  ManagedSession,
  SessionStatus
} from "../../../packages/control-plane/src/contracts.ts";
import { exactHostAbsoluteRoot, hostRootKey } from "../../../packages/control-plane/src/host-path.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import {
  canonicalReanchorApplyRequest,
  canonicalReanchorProviderAcknowledgement,
  type ReanchorApplyRequest,
  type ReanchorProviderAcknowledgement
} from "../../../packages/control-plane/src/reanchor.ts";
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
import type { AutomationAction, AutomationIntent, AutomationProviderResult } from "../../../packages/control-plane/src/automation-protocol.ts";
import type { AutomationManifestApproval, AutomationOperationManifest } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import type { OperationControllerObservation, OperationReconciliationBinding } from "../../../packages/control-plane/src/runtime.ts";

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
  readonly authorityId: string;
  readonly provider: ProviderGatewayProvider;
  readonly manifest: AutomationOperationManifest;
  readonly approval: AutomationManifestApproval;
  readonly intent: AutomationIntent;
}

export interface ProviderGatewayReanchorCommand {
  readonly kind: "reanchor";
  readonly routeId: string;
  readonly operationId: string;
  readonly externalId: string;
  readonly action: "reanchor";
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly provider: ProviderGatewayProvider;
  readonly request: ReanchorApplyRequest;
}

export type ProviderGatewayCommand = ProviderGatewayWorkflowCommand | ProviderGatewayAutomationCommand;
type LocalProviderGatewayCommand = ProviderGatewayWorkflowCommand | ProviderGatewayReanchorCommand;

export type ProviderGatewayRemoteResult = AutomationProviderResult;

export type ProviderGatewayCommandResult = WorkflowProviderResponse | WorkflowChildProviderResponse | ProviderGatewayRemoteResult;
type LocalProviderGatewayCommandResult = ProviderGatewayCommandResult | ReanchorProviderAcknowledgement;
export type ProviderGatewayOperationOutcome = "committed" | "failed" | "cancelled" | "unresolved";

export interface ProviderGatewayOperationObservationRequest {
  readonly operationId: string;
  readonly externalId: string;
  readonly routeId: string;
  readonly action: CommandAction;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
}

export interface ProviderGatewayOperationObservation extends ProviderGatewayOperationObservationRequest {
  readonly outcome: ProviderGatewayOperationOutcome;
  readonly effectDisposition: EffectDisposition;
  readonly summary: string;
}

export interface ProviderGatewayCancellationRequest extends ProviderGatewayOperationObservationRequest {
  readonly reason: string;
}

export interface ProviderGatewayCancellationAcknowledgement extends ProviderGatewayOperationObservationRequest {
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
  reanchor(request: ReanchorApplyRequest, signal: AbortSignal): Promise<ReanchorProviderAcknowledgement>;
  observeReanchor(request: ReanchorApplyRequest, signal: AbortSignal): Promise<ReanchorProviderAcknowledgement | undefined>;
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
  /** Missing only in legacy records, which remain reconciliation-only. */
  readonly action?: CommandAction;
  /** Missing only in legacy records, which remain reconciliation-only. */
  readonly authorityId?: string;
  readonly requestDigest: string;
  readonly state: "submitted" | ProviderGatewayOperationOutcome;
  /** Missing only in legacy/in-flight records; never inferred from status. */
  readonly effectDisposition?: EffectDisposition;
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
  readonly effectDisposition?: EffectDisposition;
  readonly note: string;
  readonly details?: Readonly<Record<string, string>>;
}

export interface ProviderGatewayRecoveryBinding extends ProviderGatewayOperationObservationRequest {
  readonly provider: ProviderGatewayProvider;
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
  observeBoundOperation(binding: OperationReconciliationBinding): Promise<OperationControllerObservation>;
  observeProviderOperation(input: Readonly<ProviderGatewayRecoveryBinding>): Promise<ProviderGatewayRecoveryObservation | undefined>;
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
    if (legacyAutomationEffectRoute(input.routeId)) {
      return blocked(input.routeId, "Automation effect routes are proposal-only at the provider boundary; reviewed effects execute only through the host-local broker.");
    }
    try {
      if (input.routeId.startsWith("provider.handshake.")) return await this.handshake(input);
      if (/^provider\.reanchor\.(claude|codex)$/u.test(input.routeId)) return await this.executeReanchor(input);
      if (/^provider\.observe-reanchor\.(claude|codex)$/u.test(input.routeId)) return await this.observeReanchor(input);
      if (input.routeId.startsWith("provider.")) return await this.executeWorkflow(input);
      return unavailable(input.routeId, "The local provider gateway does not own this fixed route.");
    } catch {
      return unavailable(input.routeId, "The local provider gateway failed closed; no provider success was inferred.", "ambiguous");
    }
  }

  recoveryExternalId(authenticationToken: string, input: ProviderGatewayRecoveryIdentityRequest): string | undefined {
    this.authenticate(authenticationToken);
    return input.routeId.startsWith("provider.") && this.supportsProvider(authenticationToken, input.provider)
      && safeOperationId(input.operationId) && safeRoute(input.routeId)
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
    if (legacyAutomationEffectRoute(record.routeId)) return 0;
    const backend = this.backends.get(record.provider);
    if (!backend) throw new Error("The exact provider cancellation backend is unavailable.");
    const signal = new AbortController().signal;
    const acknowledgement = await backend.cancelOperation({
      operationId: record.operationId,
      externalId: record.externalId,
      routeId: record.routeId,
      action: requireSavedAction(record),
      sessionId: record.sessionId,
      authorityId: requireSavedAuthority(record),
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
      effectDisposition: observed?.effectDisposition ?? "ambiguous",
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
    if (legacyAutomationEffectRoute(record.routeId)) {
      return { settled: false, summary: "A legacy provider automation-effect record is recovery-only; host-local manual recovery is required and no provider effect was observed or replayed." };
    }
    const observed = await this.observeProviderOperation(authenticationToken, {
      operationId: record.operationId,
      repositoryRoot: record.repositoryRoot,
      routeId: record.routeId,
      externalId: record.externalId,
      targetSnapshotId: record.targetSnapshotId,
      action: requireSavedAction(record),
      sessionId: record.sessionId,
      provider: record.provider,
      authorityId: requireSavedAuthority(record)
    });
    if (!observed) return { settled: false, summary: "The exact operation is not owned by this provider gateway." };
    return { settled: observed.outcome !== "unresolved", summary: observed.note };
  }

  async observeBoundOperation(authenticationToken: string, input: OperationReconciliationBinding): Promise<OperationControllerObservation> {
    this.authenticate(authenticationToken);
    const binding = exactGatewayReconciliationBinding(input);
    let record = (await this.operationRecords()).get(binding.operationId);
    if (!record) {
      return { state: "not_owner", operationId: binding.operationId, summary: "No exact provider gateway operation is bound to this durable operation." };
    }
    if (!gatewayRecordMatchesBinding(record, binding)) {
      return gatewayActive(binding, "The provider gateway operation does not match the exact protected action, TargetSnapshot, and repository binding.");
    }
    if (legacyAutomationEffectRoute(record.routeId)) {
      return gatewayActive(binding, "A legacy provider automation-effect record is recovery-only; the provider backend was not entered and host-local manual recovery is required.");
    }
    if (!trustedGatewayTerminal(record) && (record.state === "submitted" || record.state === "unresolved")) {
      await this.observeProviderOperation(authenticationToken, {
        operationId: record.operationId,
        repositoryRoot: record.repositoryRoot,
        routeId: record.routeId,
        externalId: record.externalId,
        targetSnapshotId: record.targetSnapshotId,
        action: requireSavedAction(record),
        sessionId: record.sessionId,
        provider: record.provider,
        authorityId: requireSavedAuthority(record)
      }).catch(() => undefined);
      record = (await this.operationRecords()).get(binding.operationId) ?? record;
      if (!gatewayRecordMatchesBinding(record, binding)) {
        return gatewayActive(binding, "The provider gateway operation binding changed during exact observation; no terminal result was accepted.");
      }
    }
    const terminalTruth = trustedGatewayTerminal(record);
    if (!terminalTruth) {
      return gatewayActive(binding, "The provider gateway lacks a complete, internally consistent durable effect disposition; the operation remains ambiguous and was not replayed.");
    }
    return {
      state: "terminal",
      ...binding,
      status: terminalTruth.status,
      effectDisposition: terminalTruth.effectDisposition,
      summary: `The exact provider gateway operation has durable ${record.state} effect truth.`
    };
  }

  async observeProviderOperation(authenticationToken: string, input: Readonly<ProviderGatewayRecoveryBinding>): Promise<ProviderGatewayRecoveryObservation | undefined> {
    this.authenticate(authenticationToken);
    const records = await this.operationRecords();
    const record = [...records.values()].find((candidate) => candidate.externalId === input.externalId);
    if (!record) return undefined;
    if (record.operationId !== input.operationId || record.routeId !== input.routeId || record.action !== input.action
      || record.sessionId !== input.sessionId || record.provider !== input.provider || record.authorityId !== input.authorityId
      || record.targetSnapshotId !== input.targetSnapshotId || rootKey(record.repositoryRoot) !== rootKey(input.repositoryRoot)) {
      return { outcome: "unresolved", note: "The provider gateway observation binding changed; no state was inferred." };
    }
    if (legacyAutomationEffectRoute(record.routeId)) {
      return { outcome: "unresolved", note: "The legacy automation effect record is recovery-only; no provider observation or replay was attempted." };
    }
    const backend = this.backends.get(record.provider);
    if (!backend) return { outcome: "unresolved", note: "The exact provider observation backend is unavailable." };
    try {
      const observed = await this.observeBackendOperation(record, backend);
      await this.saveOperation({ ...record, state: observed.outcome, effectDisposition: observed.effectDisposition, updatedAt: await this.monotonicHostTime() });
      return {
        outcome: observed.outcome,
        ...(observed.effectDisposition ? { effectDisposition: observed.effectDisposition } : {}),
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

  private async executeReanchor(input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult> {
    let parsed: ProviderGatewayReanchorCommand;
    try { parsed = parseReanchorCommand(parseBody(input.body), input.repositoryRoot, input.routeId); }
    catch { return blocked(input.routeId, "The local provider gateway rejected an invalid dedicated Re-anchor envelope."); }
    return this.executeCommand(input, parsed);
  }

  private async observeReanchor(input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult> {
    let command: ProviderGatewayReanchorCommand;
    try {
      const provider = input.routeId.slice("provider.observe-reanchor.".length);
      command = parseReanchorCommand(parseBody(input.body), input.repositoryRoot, `provider.reanchor.${provider}`);
    } catch {
      return blocked(input.routeId, "The local provider gateway rejected an invalid Re-anchor observation envelope.");
    }
    const record = (await this.operationRecords()).get(command.operationId);
    const requestDigest = sha256(stableJson(command));
    if (!record || record.provider !== command.provider || record.routeId !== command.routeId
      || record.targetSnapshotId !== command.targetSnapshotId || record.requestDigest !== requestDigest
      || rootKey(record.repositoryRoot) !== rootKey(command.repositoryRoot)) {
      return blocked(input.routeId, "No exact protected Re-anchor operation matches this observation request.");
    }
    if (record.responseBody) return passedEncoded(input.routeId, record.responseBody);
    const backend = this.backends.get(command.provider);
    if (!backend) return unavailable(input.routeId, "The exact Re-anchor observation backend is unavailable.", "ambiguous");
    try {
      const acknowledgement = await backend.observeReanchor(command.request, signalFor(input));
      if (!acknowledgement) return unavailable(input.routeId, "The provider cannot prove whether the exact Re-anchor committed.", "ambiguous");
      canonicalReanchorProviderAcknowledgement(acknowledgement, command.request);
      const responseBody = JSON.stringify(acknowledgement);
      await this.saveOperation({ ...record, state: "committed", effectDisposition: "committed", responseBody, updatedAt: await this.monotonicHostTime() });
      return passedEncoded(input.routeId, responseBody);
    } catch {
      return unavailable(input.routeId, "The exact Re-anchor observation is unavailable; the effect was not replayed.", "ambiguous");
    }
  }

  private async executeCommand(input: ProviderGatewayRouteRequest, command: LocalProviderGatewayCommand): Promise<ConfiguredNetworkResult> {
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

  private async executeCommandOnce(input: ProviderGatewayRouteRequest, command: LocalProviderGatewayCommand, backend: ProviderGatewayBackend, requestDigest: string): Promise<ConfiguredNetworkResult> {
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
      action: command.action,
      authorityId: command.authorityId,
      requestDigest,
      state: "submitted",
      cancellationAcknowledged: false,
      updatedAt: await this.monotonicHostTime()
    };
    await this.saveOperation(submitted);
    const currentBeforeEffect = await this.sessions.get(command.sessionId);
    if (!currentBeforeEffect || !canExecuteProviderCommand(currentBeforeEffect, command, this.now(), this.automaticRefreshIntervalMs)) {
      await this.saveOperation({ ...submitted, state: "failed", effectDisposition: "not_started", updatedAt: await this.monotonicHostTime() });
      return blocked(input.routeId, "The provider session or its catalog-derived capability floor changed before the final execution boundary.");
    }
    try {
      const response = command.kind === "reanchor"
        ? await backend.reanchor(command.request, signalFor(input))
        : await backend.execute(command, signalFor(input));
      requireCommandResponse(command, response);
      const currentAfterEffect = await this.sessions.get(command.sessionId);
      if (!currentAfterEffect || !canExecuteProviderCommand(currentAfterEffect, command, this.now(), this.automaticRefreshIntervalMs)) {
        await this.saveOperation({ ...submitted, state: "unresolved", effectDisposition: "ambiguous", updatedAt: await this.monotonicHostTime() });
        return unavailable(input.routeId, "The provider session changed while the effect was in flight; the result is ambiguous and requires exact observation.", "ambiguous");
      }
      const responseBody = JSON.stringify(response);
      if (Buffer.byteLength(responseBody, "utf8") > maximumBodyBytes) throw new Error("The provider result is oversized.");
      await this.saveOperation({
        ...submitted,
        externalId: command.externalId,
        state: command.kind === "reanchor" ? "committed" : outcomeForResponse(response as ProviderGatewayCommandResult),
        effectDisposition: command.kind === "reanchor" ? "committed" : (response as ProviderGatewayCommandResult).effectDisposition,
        responseBody,
        updatedAt: await this.monotonicHostTime()
      });
      return passedEncoded(input.routeId, responseBody);
    } catch {
      await this.saveOperation({ ...submitted, state: "unresolved", effectDisposition: "ambiguous", updatedAt: await this.monotonicHostTime() });
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
      action: requireSavedAction(record),
      sessionId: record.sessionId,
      authorityId: requireSavedAuthority(record),
      targetSnapshotId: record.targetSnapshotId,
      repositoryRoot: record.repositoryRoot
    }, new AbortController().signal);
    if (response.operationId !== record.operationId || response.externalId !== record.externalId || response.routeId !== record.routeId
      || response.action !== record.action || response.sessionId !== record.sessionId || response.authorityId !== record.authorityId
      || response.targetSnapshotId !== record.targetSnapshotId || rootKey(response.repositoryRoot) !== rootKey(record.repositoryRoot) || !operationOutcome(response.outcome)) {
      throw new Error("The provider operation observation changed its exact binding.");
    }
    const summary = safeText(response.summary, "provider operation observation", 512);
    const disposition = exactEffectDisposition(response.effectDisposition);
    if (!providerObservationConsistent(response.outcome, disposition)) {
      return {
        operationId: record.operationId,
        externalId: record.externalId,
        routeId: record.routeId,
        action: requireSavedAction(record),
        sessionId: record.sessionId,
        authorityId: requireSavedAuthority(record),
        targetSnapshotId: record.targetSnapshotId,
        repositoryRoot: record.repositoryRoot,
        outcome: "unresolved",
        effectDisposition: "ambiguous",
        summary: "The provider observation lacks a complete, internally consistent effect disposition; no terminal state was inferred."
      };
    }
    return { ...response, effectDisposition: disposition, summary };
  }

  private async operationRecords(): Promise<Map<string, SavedGatewayOperation>> {
    const result = new Map<string, SavedGatewayOperation>();
    const conflicted = new Set<string>();
    for (const entry of await this.store.readEntries()) {
      if (entry.kind !== gatewayEventKind) continue;
      const operation = parseSavedOperation((entry.payload as { operation?: unknown } | undefined)?.operation);
      if (conflicted.has(operation.operationId)) continue;
      const prior = result.get(operation.operationId);
      if (prior && !sameGatewayOperationIdentity(prior, operation)) {
        result.set(operation.operationId, {
          ...prior,
          action: undefined,
          authorityId: undefined,
          state: "unresolved",
          effectDisposition: "ambiguous",
          responseBody: undefined,
          cancellationAcknowledged: true,
          updatedAt: operation.updatedAt
        });
        conflicted.add(operation.operationId);
        continue;
      }
      if (prior && trustedGatewayTerminal(prior)) continue;
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
  observeBoundOperation(binding: OperationReconciliationBinding): Promise<OperationControllerObservation> { return this.gateway.observeBoundOperation(this.token, binding); }
  observeProviderOperation(input: Readonly<ProviderGatewayRecoveryBinding>): Promise<ProviderGatewayRecoveryObservation | undefined> { return this.gateway.observeProviderOperation(this.token, input); }
}

/**
 * Selects the local gateway only for an exact installed provider. A malformed
 * provider envelope is rejected locally and is never forwarded to a network
 * fallback. The fallback is already constrained by configured-network policy.
 */
export class ProviderGatewayRouteRouter implements ProviderGatewayFallbackTransport {
  constructor(private readonly gateway: AuthenticatedProviderGatewayClient, private readonly fallback: ProviderGatewayFallbackTransport) {}

  async request(input: ProviderGatewayRouteRequest): Promise<ConfiguredNetworkResult> {
    if (input.routeId.startsWith("automation.proposal.")) return this.fallback.request(input);
    if (legacyAutomationEffectRoute(input.routeId)) return this.gateway.request(input);
    const hint = routeProviderHint(input);
    if (!hint.valid) return this.gateway.request(input);
    if (hint.provider && this.gateway.supportsProvider(hint.provider)) return this.gateway.request(input);
    return this.fallback.request(input);
  }

  recoveryExternalId(input: ProviderGatewayRecoveryIdentityRequest): string | undefined {
    if (input.routeId.startsWith("automation.")) return undefined;
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
  reanchorCalls = 0;
  cancelCalls = 0;
  sessionObservationCalls = 0;
  private unavailableState = false;
  private nextStatus: ProviderGatewayRemoteResult["status"] = "completed";
  private readonly sessions = new Map<string, Omit<ProviderGatewaySessionObservation, "sessionId" | "provider">>();
  private readonly operations = new Map<string, ProviderGatewayOperationObservation>();
  private readonly responses = new Map<string, ProviderGatewayCommandResult>();
  private readonly reanchorResponses = new Map<string, ReanchorProviderAcknowledgement>();

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
    if (request.kind === "automation") throw new Error("Automation effects are host-local and cannot enter a provider backend.");
    const prior = this.responses.get(request.externalId);
    if (prior) return prior;
    this.commandCalls += 1;
    const status = this.nextStatus;
    this.nextStatus = "completed";
    const disposition: EffectDisposition = status === "completed" ? "committed" : status === "running" ? "ambiguous" : "not_started";
    const response: ProviderGatewayCommandResult = request.child
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
        };
    this.responses.set(request.externalId, response);
    this.operations.set(request.externalId, {
      operationId: request.operationId,
      externalId: request.externalId,
      routeId: request.routeId,
      action: request.action,
      sessionId: request.sessionId,
      authorityId: request.authorityId,
      targetSnapshotId: request.targetSnapshotId,
      repositoryRoot: request.repositoryRoot,
      outcome: status === "completed" ? "committed" : status === "running" ? "unresolved" : status === "cancelled" ? "cancelled" : "failed",
      effectDisposition: disposition,
      summary: `Deterministic ${this.provider} operation is ${status}.`
    });
    return response;
  }

  async reanchor(request: ReanchorApplyRequest): Promise<ReanchorProviderAcknowledgement> {
    this.available();
    const prior = this.reanchorResponses.get(request.operationId);
    if (prior) return canonicalReanchorProviderAcknowledgement(prior, request);
    this.reanchorCalls += 1;
    const response: ReanchorProviderAcknowledgement = {
      schema: "sxsy-b122.reanchor-acknowledgement",
      version: 1,
      requestId: request.requestId,
      operationId: request.operationId,
      externalEffectId: request.operationId,
      sessionId: request.sessionId,
      authorityId: request.authorityId,
      oldTargetSnapshotId: request.oldTargetSnapshotId,
      newTargetSnapshotId: request.newTargetSnapshotId,
      cooperativeStopAcknowledged: true,
      resumed: false,
      artifactDigest: request.artifactDigest,
      rereadEvidence: request.rereadEvidence,
      report: {
        summary: `Deterministic ${this.provider} stopped, reread the protected instructions, task brief and project documentation, inspected current work, and did not resume.`,
        discrepancies: [`Inspected the exact transition from ${request.oldTargetSnapshotId} to ${request.newTargetSnapshotId}.`],
        risks: ["The managed session remains stopped until a separately authorized action."],
        questions: ["Should the operator separately authorize a later resume?"],
        result: "reanchored_without_resume"
      }
    };
    this.reanchorResponses.set(request.operationId, response);
    this.operations.set(request.operationId, {
      operationId: request.operationId,
      externalId: request.operationId,
      routeId: `provider.reanchor.${request.provider}`,
      action: "reanchor",
      sessionId: request.sessionId,
      authorityId: request.authorityId,
      targetSnapshotId: request.oldTargetSnapshotId,
      repositoryRoot: request.repositoryRoot,
      outcome: "committed",
      effectDisposition: "committed",
      summary: `Deterministic ${this.provider} Re-anchor is committed without resume.`
    });
    return response;
  }

  async observeReanchor(request: ReanchorApplyRequest): Promise<ReanchorProviderAcknowledgement | undefined> {
    this.available();
    const response = this.reanchorResponses.get(request.operationId);
    return response ? canonicalReanchorProviderAcknowledgement(response, request) : undefined;
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
    if (!operation) return { ...request, outcome: "unresolved", effectDisposition: "ambiguous", summary: "The deterministic provider has no exact operation." };
    return { ...operation };
  }

  async cancelOperation(request: ProviderGatewayCancellationRequest): Promise<ProviderGatewayCancellationAcknowledgement> {
    this.available();
    this.cancelCalls += 1;
    const operation = this.operations.get(request.externalId);
    if (!operation || !sameProviderOperation(operation, request)) {
      return { ...request, accepted: false, summary: "No exact operation was found." };
    }
    this.operations.set(request.externalId, { ...operation, outcome: "unresolved", effectDisposition: "ambiguous", summary: "The deterministic provider confirms cancellation delivery but not the prior effect disposition." });
    return { ...request, accepted: true, summary: "Cancellation acknowledged." };
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

function parseReanchorCommand(value: Record<string, unknown>, repositoryRoot: string, routeId: string): ProviderGatewayReanchorCommand {
  if (value.schema !== "sxsy-b122.provider-reanchor-request") throw new Error("The dedicated Re-anchor gateway schema is invalid.");
  const unsigned = { ...value };
  delete unsigned.schema;
  const request = canonicalReanchorApplyRequest(unsigned);
  if (routeId !== `provider.reanchor.${request.provider}` || rootKey(request.repositoryRoot) !== rootKey(safeRoot(repositoryRoot))) {
    throw new Error("The dedicated Re-anchor route, provider, or repository binding changed.");
  }
  return {
    kind: "reanchor",
    routeId,
    action: "reanchor",
    operationId: request.operationId,
    externalId: request.operationId,
    repositoryRoot: request.repositoryRoot,
    targetSnapshotId: request.oldTargetSnapshotId,
    sessionId: request.sessionId,
    authorityId: request.authorityId,
    provider: request.provider,
    request
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

function requireCommandResponse(command: LocalProviderGatewayCommand, response: LocalProviderGatewayCommandResult): void {
  boundedJson(response);
  if (command.kind === "reanchor") {
    canonicalReanchorProviderAcknowledgement(response, command.request);
    return;
  }
  const standardResponse = response as ProviderGatewayCommandResult;
  if (standardResponse.externalId !== command.externalId || standardResponse.status === undefined || standardResponse.effectDisposition === undefined || !safeSummary(standardResponse.summary)) throw new Error("The provider response is not exact or bounded.");
  if (command.child) {
    parseWorkflowChildProviderResponse(standardResponse, workflowArtifactForCommand(command), command.child.effect, command.operationId, command.child.role);
  } else {
    const workflowResponse = standardResponse as WorkflowProviderResponse;
    if (workflowResponse.schema !== "sxsy-b122.workflow-result" || workflowResponse.version !== 1 || workflowResponse.operationId !== command.operationId || workflowResponse.action !== command.action || workflowResponse.artifactId !== command.artifact.id || workflowResponse.artifactDigest !== command.artifact.digest) throw new Error("The workflow provider response changed its exact binding.");
  }
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
  if (value.operationId !== record.operationId || value.externalId !== record.externalId || value.routeId !== record.routeId
    || value.action !== record.action || value.sessionId !== record.sessionId || value.authorityId !== record.authorityId
    || value.targetSnapshotId !== record.targetSnapshotId || rootKey(value.repositoryRoot) !== rootKey(record.repositoryRoot)
    || typeof value.accepted !== "boolean" || !safeSummary(value.summary)) throw new Error("The provider cancellation acknowledgement changed its exact binding.");
}

function parseSavedOperation(value: unknown): SavedGatewayOperation {
  const record = object(value, "provider gateway operation");
  if (!allowedExact(record,
    ["operationId", "externalId", "routeId", "provider", "sessionId", "repositoryRoot", "targetSnapshotId", "requestDigest", "state", "cancellationAcknowledged", "updatedAt"],
    ["action", "authorityId", "effectDisposition", "responseBody"])) {
    throw new Error("The protected provider gateway operation schema is not closed.");
  }
  const state = record.state;
  if (state !== "submitted" && !operationOutcome(state)) throw new Error("The protected provider gateway operation state is invalid.");
  const action = record.action === undefined ? undefined : exactCommandAction(record.action);
  const authorityId = record.authorityId === undefined ? undefined : safeIdentifier(record.authorityId, "authority ID");
  const effectDisposition = record.effectDisposition === undefined ? undefined : exactEffectDisposition(record.effectDisposition);
  if ((state === "submitted" || state === "unresolved") && effectDisposition !== undefined && effectDisposition !== "ambiguous") {
    throw new Error("An in-flight provider gateway operation cannot claim terminal effect disposition.");
  }
  return {
    operationId: safeIdentifier(record.operationId, "operation ID"),
    externalId: safeIdentifier(record.externalId, "external ID"),
    routeId: safeRoute(record.routeId),
    provider: providerIdentity(record.provider),
    sessionId: safeIdentifier(record.sessionId, "session ID"),
    repositoryRoot: safeRoot(record.repositoryRoot),
    targetSnapshotId: digest(record.targetSnapshotId, "target snapshot"),
    ...(action ? { action } : {}),
    ...(authorityId ? { authorityId } : {}),
    requestDigest: digest(record.requestDigest, "request digest"),
    state,
    ...(effectDisposition ? { effectDisposition } : {}),
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
      : {
          kind: "plan", mode: "execution_ack", planDigest: payload.plan.digest, planRevision: payload.plan.revision,
          originSessionId: payload.plan.originSessionId, executorSessionId: payload.executorSessionId, authorityId: payload.authorityId,
          acknowledgementId: `ack:${request.operationId}`, executionStarted: true,
          targetTransition: payload.plan.expectedTargetTransition,
          childEffects: [{
            id: `deterministic-plan-child:${request.operationId}`,
            action: "plan_execution",
            status: "running",
            effectDisposition: "committed",
            summary: "The deterministic provider accepted the exact approved plan into one observable execution child.",
            externalId: `ack:${request.operationId}`
          }]
        };
    case "handoff": return { kind: "handoff", packageId: payload.packageId, recipientSessionId: payload.recipientSessionId ?? request.sessionId, acknowledged: true };
    case "focus": return { kind: "focus", selectedSessionId: payload.selectedSessionId, status: payload.expectedStatus, queueCycleId: payload.queueCycleId, resultDelivered: true };
    case "authority": return { kind: "authority", acknowledgements: payload.packets.map((packet) => ({ recipientSessionId: packet.recipientSessionId, grantId: packet.grantId, matchDigest: packet.matchDigest, acknowledged: true })) };
    case "voice_binding": return { kind: "voice_binding", bindingId: `binding:${request.artifact.id}`, active: true };
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

function canExecuteProviderCommand(session: ManagedSession, command: LocalProviderGatewayCommand, now: string, refreshIntervalMs: number): boolean {
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
  const authorityRecovery = command.action === "authority_refresh" || command.action === "authority_broadcast";
  const statusAllowed = session.status === "running" || (authorityRecovery && session.status === "verified_blocked");
  return hasGatewayProof(session)
    && session.provider === command.provider
    && statusAllowed
    && requiredCapabilities.every((capabilityValue) => session.capabilities.includes(capabilityValue))
    && Number.isFinite(observedAt) && Number.isFinite(current) && observedAt <= current + 30_000 && current - observedAt <= freshnessMs
    && session.targetSnapshotId === command.targetSnapshotId
    && !!session.workspaceRoot && rootKey(session.workspaceRoot) === rootKey(command.repositoryRoot)
    && (command.kind !== "workflow" || (session.taskId === command.artifact.taskId && session.planRevision === command.artifact.planRevision))
    && (command.kind !== "reanchor" || (session.taskId === command.request.taskId && session.planRevision === command.request.planRevision
      && stableJson(session) === stableJson(command.request.session)));
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
function legacyAutomationEffectRoute(routeId: string): boolean { return routeId.startsWith("automation.") && !routeId.startsWith("automation.proposal."); }
function safeRoot(value: unknown): string { if (!exactHostAbsoluteRoot(value)) throw new Error("The provider repository root is invalid."); return value; }
function exactRoot(value: unknown, expected: string): string { const root = safeRoot(value); if (rootKey(root) !== rootKey(safeRoot(expected))) throw new Error("The provider repository root changed."); return expected; }
function rootKey(value: string): string { return hostRootKey(value); }
function digest(value: unknown, field: string): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${field} is invalid.`); return value.toLowerCase(); }
function digest40(value: unknown, field: string): string { if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) throw new Error(`${field} is invalid.`); return value.toLowerCase(); }
function safeText(value: unknown, field: string, maximum = maximumText): string { if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\0\r\n]/.test(value)) throw new Error(`${field} is invalid.`); return value.trim(); }
function safeSummary(value: unknown): value is string { try { safeText(value, "provider summary", 512); return true; } catch { return false; } }
function timestamp(value: unknown, field: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${field} is invalid.`); return value; }
function safeAdapterVersion(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(value)) throw new Error("The provider adapter version is invalid."); return value; }
function boundedStringList(values: readonly string[], maximumItems: number, maximumLength: number): void { if (!Array.isArray(values) || values.length > maximumItems || !values.every((value) => typeof value === "string" && !!value.trim() && value.length <= maximumLength && !/[\0\r\n]/.test(value))) throw new Error("The provider returned an invalid bounded list."); }
function providerIdentity(value: unknown): ProviderGatewayProvider { if (value !== "claude" && value !== "codex") throw new Error("The local provider gateway requires an exact Claude or Codex provider."); return value; }
function exactCommandAction(value: unknown): CommandAction {
  if (typeof value !== "string" || !(commandActionIds as readonly string[]).includes(value)) throw new Error("The provider gateway command action is invalid.");
  return value as CommandAction;
}
function exactEffectDisposition(value: unknown): EffectDisposition {
  if (value !== "not_started" && value !== "committed" && value !== "ambiguous" && value !== "compensated") throw new Error("The provider gateway effect disposition is invalid.");
  return value;
}
function capability(value: unknown): value is Capability { return value === "registered" || value === "observable" || value === "controllable" || value === "mediated"; }
function sessionStatus(value: unknown): value is SessionStatus { return value === "running" || value === "verified_blocked" || value === "verified_finished" || value === "unreachable" || value === "stale" || value === "unknown"; }
function operationOutcome(value: unknown): value is ProviderGatewayOperationOutcome { return value === "committed" || value === "failed" || value === "cancelled" || value === "unresolved"; }
function terminal(value: SavedGatewayOperation["state"]): boolean { return value === "committed" || value === "failed" || value === "cancelled"; }

function exactGatewayReconciliationBinding(input: OperationReconciliationBinding): OperationReconciliationBinding {
  const operationId = safeIdentifier(input.operationId, "operation ID");
  const action = exactCommandAction(input.action);
  if ((input.targetSnapshotId === undefined) !== (input.repositoryRoot === undefined)) throw new Error("The provider gateway reconciliation binding is partial.");
  if (!input.sessionId || !input.authorityId) throw new Error("The provider gateway reconciliation binding lacks an exact session or authority.");
  const sessionId = safeIdentifier(input.sessionId, "session ID");
  const authorityId = safeIdentifier(input.authorityId, "authority ID");
  return input.targetSnapshotId === undefined
    ? { operationId, action, sessionId, authorityId }
    : { operationId, action, targetSnapshotId: digest(input.targetSnapshotId, "target snapshot"), repositoryRoot: safeRoot(input.repositoryRoot), sessionId, authorityId };
}

function gatewayRecordMatchesBinding(record: SavedGatewayOperation, binding: OperationReconciliationBinding): boolean {
  return record.action === binding.action && record.targetSnapshotId === binding.targetSnapshotId
    && record.sessionId === binding.sessionId && record.authorityId === binding.authorityId
    && binding.repositoryRoot !== undefined && rootKey(record.repositoryRoot) === rootKey(binding.repositoryRoot);
}

function gatewayActive(binding: OperationReconciliationBinding, summary: string): Extract<OperationControllerObservation, { state: "active" }> {
  return { state: "active", ...binding, effectDisposition: "ambiguous", summary };
}

function trustedGatewayTerminal(record: SavedGatewayOperation): Readonly<{
  status: "completed" | "failed" | "cancelled";
  effectDisposition: Exclude<EffectDisposition, "ambiguous">;
}> | undefined {
  const disposition = record.effectDisposition;
  if (record.action === undefined || record.authorityId === undefined || !gatewayRouteMatchesAction(record.routeId, record.action, record.provider)
    || disposition === undefined || disposition === "ambiguous") return undefined;
  if (record.state === "committed" && disposition === "committed") return { status: "completed", effectDisposition: disposition };
  if (record.state === "failed") return { status: "failed", effectDisposition: disposition };
  if (record.state === "cancelled") return { status: "cancelled", effectDisposition: disposition };
  return undefined;
}

function providerObservationConsistent(outcome: ProviderGatewayOperationOutcome, disposition: EffectDisposition | undefined): boolean {
  if (outcome === "unresolved") return disposition === "ambiguous";
  if (outcome === "committed") return disposition === "committed";
  return disposition !== undefined && disposition !== "ambiguous";
}

function sameGatewayOperationIdentity(left: SavedGatewayOperation, right: SavedGatewayOperation): boolean {
  return left.operationId === right.operationId && left.externalId === right.externalId && left.routeId === right.routeId
    && left.provider === right.provider && left.sessionId === right.sessionId && left.requestDigest === right.requestDigest
    && left.targetSnapshotId === right.targetSnapshotId && rootKey(left.repositoryRoot) === rootKey(right.repositoryRoot)
    && left.action === right.action && left.authorityId === right.authorityId;
}
function requireSavedAction(record: SavedGatewayOperation): CommandAction { if (!record.action) throw new Error("The legacy provider operation lacks an exact action binding."); return record.action; }
function requireSavedAuthority(record: SavedGatewayOperation): string { if (!record.authorityId) throw new Error("The legacy provider operation lacks an exact authority binding."); return record.authorityId; }
function sameProviderOperation(left: ProviderGatewayOperationObservation, right: ProviderGatewayOperationObservationRequest): boolean {
  return left.operationId === right.operationId && left.externalId === right.externalId && left.routeId === right.routeId
    && left.action === right.action && left.sessionId === right.sessionId && left.authorityId === right.authorityId
    && left.targetSnapshotId === right.targetSnapshotId && rootKey(left.repositoryRoot) === rootKey(right.repositoryRoot);
}
function gatewayRouteMatchesAction(routeId: string, action: CommandAction, provider: ProviderGatewayProvider): boolean {
  return routeId === `provider.${action}` || (action === "reanchor" && routeId === `provider.reanchor.${provider}`);
}
function boundedDuration(value: number): number { if (!Number.isSafeInteger(value) || value < 0 || value > 15 * 60_000) throw new Error("The provider gateway refresh interval is invalid."); return value; }
function signalFor(input: ProviderGatewayRouteRequest): AbortSignal { return input.signal ?? new AbortController().signal; }
function tokenDigest(value: string): Buffer { if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("The provider gateway authentication token must be 256 bits."); return createHash("sha256").update(value.toLowerCase(), "ascii").digest(); }
function sameToken(expected: Buffer, value: string): boolean { try { return timingSafeEqual(expected, tokenDigest(value)); } catch { return false; } }

function passed(routeId: string, value: unknown): ConfiguredNetworkResult { return passedEncoded(routeId, JSON.stringify(value)); }
function passedEncoded(routeId: string, value: string): ConfiguredNetworkResult { return { outcome: "passed", routeId, detail: "The authenticated local provider gateway returned an exact bounded response.", effectDisposition: "ambiguous", body: Buffer.from(value, "utf8") }; }
function blocked(routeId: string, detail: string): ConfiguredNetworkResult { return { outcome: "blocked", routeId, detail, effectDisposition: "not_started" }; }
function unavailable(routeId: string, detail: string, effectDisposition: "not_started" | "ambiguous" = "not_started"): ConfiguredNetworkResult { return { outcome: "unavailable", routeId, detail, effectDisposition }; }
