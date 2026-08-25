import type { Capability, EffectDisposition, SessionStatus } from "../../../packages/control-plane/src/contracts.ts";
import { parseWorkflowProviderResponse, type WorkflowArtifact, type WorkflowProviderResult } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import type {
  ProviderGatewayBackend,
  ProviderGatewayCancellationAcknowledgement,
  ProviderGatewayCancellationRequest,
  ProviderGatewayCommand,
  ProviderGatewayCommandResult,
  ProviderGatewayHandshakeRequest,
  ProviderGatewayHandshakeResult,
  ProviderGatewayOperationObservation,
  ProviderGatewayOperationObservationRequest,
  ProviderGatewayProvider,
  ProviderGatewaySessionObservation,
  ProviderGatewaySessionObservationRequest,
  ProviderGatewayRemoteResult
} from "../../windows-companion/src/provider-gateway.ts";
import type { ProviderCouncilAcknowledgement, ProviderCouncilCleanupRequest, ProviderCouncilRequest } from "./state.ts";

export interface ProviderRuntimeSessionObservation extends ProviderGatewaySessionObservation {
  readonly repositoryRoot: string;
}

/**
 * Proprietary-provider boundary. A Claude or Codex connector implements this
 * interface in an operator-installed, digest-pinned module. Provider text is
 * data only; the host owns all target, idempotency, and transport decisions.
 */
export interface ProviderRuntimePort {
  readonly provider: ProviderGatewayProvider;
  readonly diagnosticOnly?: boolean;
  handshake(request: ProviderGatewayHandshakeRequest, signal: AbortSignal): Promise<ProviderGatewayHandshakeResult>;
  execute(request: ProviderGatewayCommand, signal: AbortSignal): Promise<ProviderGatewayCommandResult>;
  observeSession(request: ProviderGatewaySessionObservationRequest, signal: AbortSignal): Promise<ProviderRuntimeSessionObservation>;
  observeOperation(request: ProviderGatewayOperationObservationRequest, signal: AbortSignal): Promise<ProviderGatewayOperationObservation>;
  cancelOperation(request: ProviderGatewayCancellationRequest, signal: AbortSignal): Promise<ProviderGatewayCancellationAcknowledgement>;
  council(request: ProviderCouncilRequest, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement>;
  observeCouncil(request: ProviderCouncilRequest, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement | undefined>;
  /** Typed, bounded host shutdown. Modules must close every owned handle and descendant before resolving. */
  shutdown(signal: AbortSignal): Promise<void>;
  cleanupCouncilResources?(request: ProviderCouncilCleanupRequest): Promise<void>;
  abortCouncilAssignment?(request: ProviderCouncilRequest): Promise<void>;
}

abstract class ExactProviderAdapterBackend implements ProviderGatewayBackend {
  readonly boundary = "local-only" as const;
  readonly provider: ProviderGatewayProvider;
  protected readonly port: ProviderRuntimePort;
  private readonly mediationAttestedForTests: boolean;

  protected constructor(provider: ProviderGatewayProvider, port: ProviderRuntimePort) {
    if (port.provider !== provider) throw new Error(`The ${provider} provider runtime port identity is inconsistent.`);
    this.provider = provider;
    this.port = port;
    // The repository-owned effectful fixture is never package-configurable;
    // it exists solely to prove the typed adapter contract in isolated tests.
    // A digest-pinned third-party Node module is part of the broad TCB and may
    // not self-assert the host's Mediated capability.
    this.mediationAttestedForTests = port instanceof FixtureProviderRuntimePort && port.diagnosticOnly === false;
  }

  async handshake(request: ProviderGatewayHandshakeRequest, signal: AbortSignal): Promise<ProviderGatewayHandshakeResult> {
    this.exactProvider(request.provider);
    const result = await this.port.handshake(request, signal);
    const observed = await this.port.observeSession(request, signal);
    requireSessionBinding(observed, request);
    return { ...result, capabilities: truthfulCapabilities(result.capabilities, this.mediationAttestedForTests) };
  }

  async execute(request: ProviderGatewayCommand, signal: AbortSignal): Promise<ProviderGatewayCommandResult> {
    this.exactProvider(request.provider);
    if (this.port.diagnosticOnly === true) throw new Error("The credential-free fixture is health/protocol diagnostic only.");
    requireSessionBinding(await this.port.observeSession(sessionRequest(request), signal), sessionRequest(request));
    const response = await this.port.execute(request, signal);
    validateCommandResponse(request, response);
    requireSessionBinding(await this.port.observeSession(sessionRequest(request), signal), sessionRequest(request));
    return response;
  }

  async observeSession(request: ProviderGatewaySessionObservationRequest, signal: AbortSignal): Promise<ProviderGatewaySessionObservation> {
    this.exactProvider(request.provider);
    const observed = await this.port.observeSession(request, signal);
    requireSessionBinding(observed, request);
    const { repositoryRoot: _repositoryRoot, ...gatewayObservation } = observed;
    return { ...gatewayObservation, capabilities: truthfulCapabilities(gatewayObservation.capabilities, this.mediationAttestedForTests) };
  }

  async observeOperation(request: ProviderGatewayOperationObservationRequest, signal: AbortSignal): Promise<ProviderGatewayOperationObservation> {
    const observed = await this.port.observeOperation(request, signal);
    if (!sameOperation(observed, request)) throw new Error("The provider operation observation changed its exact binding.");
    return observed;
  }

  async cancelOperation(request: ProviderGatewayCancellationRequest, signal: AbortSignal): Promise<ProviderGatewayCancellationAcknowledgement> {
    if (this.port.diagnosticOnly === true) throw new Error("The credential-free fixture has no cancellable effects.");
    const acknowledgement = await this.port.cancelOperation(request, signal);
    if (acknowledgement.operationId !== request.operationId || acknowledgement.externalId !== request.externalId || acknowledgement.targetSnapshotId !== request.targetSnapshotId) {
      throw new Error("The provider cancellation response changed its exact binding.");
    }
    return acknowledgement;
  }

  async council(request: ProviderCouncilRequest, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement> {
    if (this.port.diagnosticOnly === true) throw new Error("The credential-free fixture cannot acknowledge Council effects.");
    if (!this.mediationAttestedForTests) throw new Error("Automatic Council requires a host-attested Mediated provider runtime.");
    try {
      const beforeRequest: ProviderGatewaySessionObservationRequest = {
        sessionId: request.sessionId,
        provider: this.provider,
        targetSnapshotId: request.targetSnapshotId,
        repositoryRoot: request.repositoryRoot
      };
      const observed = await this.port.observeSession(beforeRequest, signal);
      requireCouncilSession(observed, beforeRequest, "before");
      const acknowledgement = await this.port.council(request, signal);
      requireCouncilAcknowledgement(acknowledgement, request);
      const afterRequest = beforeRequest;
      const after = await this.port.observeSession(afterRequest, signal);
      requireCouncilSession(after, afterRequest, "after");
      return acknowledgement;
    } catch (error) {
      if (request.phase === "assignment") await this.port.abortCouncilAssignment?.(request).catch(() => undefined);
      throw error;
    }
  }

  async observeCouncil(request: ProviderCouncilRequest, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement | undefined> {
    const acknowledgement = await this.port.observeCouncil(request, signal);
    if (acknowledgement) requireCouncilAcknowledgement(acknowledgement, request);
    return acknowledgement;
  }

  async cleanupCouncilResources(request: ProviderCouncilCleanupRequest): Promise<void> {
    if (!this.port.cleanupCouncilResources) throw new Error("The provider runtime has no Council resource cleanup boundary.");
    await this.port.cleanupCouncilResources(request);
  }

  private exactProvider(provider: ProviderGatewayProvider): void {
    if (provider !== this.provider) throw new Error("The provider runtime changed identity.");
  }
}

export class ClaudeProviderAdapterBackend extends ExactProviderAdapterBackend {
  constructor(port: ProviderRuntimePort) { super("claude", port); }
}

export class CodexProviderAdapterBackend extends ExactProviderAdapterBackend {
  constructor(port: ProviderRuntimePort) { super("codex", port); }
}

export type ProviderAdapterBackend = ClaudeProviderAdapterBackend | CodexProviderAdapterBackend;

/** Credential-free deterministic runtime used only for loopback diagnostics and tests. */
export class FixtureProviderRuntimePort implements ProviderRuntimePort {
  readonly provider: ProviderGatewayProvider;
  readonly diagnosticOnly: boolean;
  executeCalls = 0;
  readonly councilPhases: string[] = [];
  private readonly sessions = new Map<string, { repositoryRoot: string; targetSnapshotId: string; status: SessionStatus; capabilities: readonly Capability[] }>();
  private readonly operations = new Map<string, ProviderGatewayOperationObservation>();
  private readonly councils = new Map<string, ProviderCouncilAcknowledgement>();
  private nextStatus: ProviderGatewayRemoteResult["status"] = "completed";
  private malformed = false;
  private loseResponse = false;
  private loseCouncilResponse = false;
  private afterCouncilObservationChange?: Partial<Readonly<{ repositoryRoot: string; targetSnapshotId: string; status: SessionStatus; capabilities: readonly Capability[] }>>;

  constructor(provider: ProviderGatewayProvider, options: Readonly<{ effectfulTestOnly?: boolean }> = {}) {
    this.provider = provider;
    this.diagnosticOnly = options.effectfulTestOnly !== true;
  }
  setNextStatus(status: ProviderGatewayRemoteResult["status"]): void { this.nextStatus = status; }
  malformedNextResponse(): void { this.malformed = true; }
  loseNextResponseAfterCommit(): void { this.loseResponse = true; }
  loseNextCouncilResponseAfterCommit(): void { this.loseCouncilResponse = true; }
  changeSessionAfterNextCouncil(change: Partial<Readonly<{ repositoryRoot: string; targetSnapshotId: string; status: SessionStatus; capabilities: readonly Capability[] }>>): void { this.afterCouncilObservationChange = change; }
  setSessionTarget(sessionId: string, targetSnapshotId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Unknown fixture session.");
    this.sessions.set(sessionId, { ...session, targetSnapshotId });
  }
  setSessionObservation(sessionId: string, change: Partial<Readonly<{ repositoryRoot: string; targetSnapshotId: string; status: SessionStatus; capabilities: readonly Capability[] }>>): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Unknown fixture session.");
    this.sessions.set(sessionId, { ...session, ...change });
  }

  async handshake(request: ProviderGatewayHandshakeRequest): Promise<ProviderGatewayHandshakeResult> {
    const capabilities: readonly Capability[] = this.diagnosticOnly ? [] : ["registered", "observable", "controllable", "mediated"];
    this.sessions.set(request.sessionId, { repositoryRoot: request.repositoryRoot, targetSnapshotId: request.targetSnapshotId, status: this.diagnosticOnly ? "unknown" : "running", capabilities });
    if (this.diagnosticOnly) return {
      capabilities: [], status: "unknown", adapterVersion: `${this.provider}-fixture-provider-host-v1`,
      plannedFiles: [], resources: [], dependencies: [], diffDigest: sha256("")
    };
    return {
      capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running",
      adapterVersion: `${this.provider}-fixture-provider-host-v1`,
      taskId: "task-provider-host",
      planRevision: "plan-1",
      plannedFiles: ["src/example.ts"],
      resources: ["port:4100"],
      dependencies: [],
      diffDigest: sha256("")
    };
  }

  async execute(request: ProviderGatewayCommand): Promise<ProviderGatewayCommandResult> {
    if (this.diagnosticOnly) throw new Error("The credential-free fixture cannot execute provider work.");
    this.executeCalls += 1;
    const status = this.nextStatus;
    this.nextStatus = "completed";
    const disposition: EffectDisposition = status === "completed" ? "committed" : status === "running" ? "ambiguous" : "not_started";
    const response: ProviderGatewayCommandResult = request.kind === "workflow"
      ? {
          schema: "sxsy-b122.workflow-result", version: 1, artifactId: request.artifact.id,
          artifactDigest: request.artifact.digest, operationId: request.operationId, action: request.action,
          status: workflowStatus(status), effectDisposition: disposition,
          summary: `Fixture ${this.provider} provider ${status}.`, externalId: request.externalId,
          result: fixtureWorkflowResult(request)
        }
      : {
          schema: "sxsy-b122.remote-result", version: 1, status, effectDisposition: disposition,
          summary: `Fixture ${this.provider} automation ${status}.`, externalId: request.externalId,
          data: { fixture: true, provider: this.provider }
        };
    this.operations.set(request.externalId, {
      operationId: request.operationId, externalId: request.externalId, routeId: request.routeId,
      targetSnapshotId: request.targetSnapshotId,
      outcome: status === "completed" ? "committed" : status === "running" ? "unresolved" : status === "cancelled" ? "cancelled" : "failed",
      summary: `Fixture ${this.provider} operation is ${status}.`
    });
    if (this.malformed) {
      this.malformed = false;
      return { ...response, externalId: "wrong-external-id" } as ProviderGatewayCommandResult;
    }
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error("Fixture response was deliberately lost after commit.");
    }
    return response;
  }

  async observeSession(request: ProviderGatewaySessionObservationRequest): Promise<ProviderRuntimeSessionObservation> {
    const session = this.sessions.get(request.sessionId);
    if (!session) throw new Error("The fixture provider session is unavailable.");
    return {
      sessionId: request.sessionId, provider: this.provider, repositoryRoot: session.repositoryRoot,
      targetSnapshotId: session.targetSnapshotId, status: session.status,
      capabilities: session.capabilities,
      adapterVersion: `${this.provider}-fixture-provider-host-v1`
    };
  }

  async observeOperation(request: ProviderGatewayOperationObservationRequest): Promise<ProviderGatewayOperationObservation> {
    return this.operations.get(request.externalId) ?? { ...request, outcome: "unresolved", summary: "No exact fixture operation exists." };
  }

  async cancelOperation(request: ProviderGatewayCancellationRequest): Promise<ProviderGatewayCancellationAcknowledgement> {
    const operation = this.operations.get(request.externalId);
    const accepted = !!operation && sameOperation(operation, request);
    if (accepted) this.operations.set(request.externalId, { ...operation!, outcome: "cancelled", summary: "Fixture operation cancelled." });
    return { operationId: request.operationId, externalId: request.externalId, targetSnapshotId: request.targetSnapshotId, accepted, summary: accepted ? "Cancellation acknowledged." : "No exact operation exists." };
  }

  async council(request: ProviderCouncilRequest): Promise<ProviderCouncilAcknowledgement> {
    if (this.diagnosticOnly) throw new Error("The credential-free fixture cannot acknowledge Council effects.");
    this.councilPhases.push(request.phase);
    const acknowledgement: ProviderCouncilAcknowledgement = {
      schema: "sxsy-b122.council-ack", version: 1, epochId: request.epochId, phase: request.phase,
      sessionId: request.sessionId, targetSnapshotId: request.targetSnapshotId, accepted: true,
      ...(request.assignmentDigest ? { assignmentDigest: request.assignmentDigest, resourceHostDigest: request.resourceHost!.digest } : {})
    };
    this.councils.set(councilRuntimeKey(request), acknowledgement);
    if (this.afterCouncilObservationChange) {
      const session = this.sessions.get(request.sessionId);
      if (!session) throw new Error("Unknown fixture Council session.");
      this.sessions.set(request.sessionId, { ...session, ...this.afterCouncilObservationChange });
      this.afterCouncilObservationChange = undefined;
    }
    if (this.loseCouncilResponse) {
      this.loseCouncilResponse = false;
      throw new Error("Fixture Council acknowledgement was deliberately lost after commit.");
    }
    return acknowledgement;
  }

  async observeCouncil(request: ProviderCouncilRequest): Promise<ProviderCouncilAcknowledgement | undefined> {
    return this.councils.get(councilRuntimeKey(request));
  }

  async shutdown(): Promise<void> {}
}

function sessionRequest(request: ProviderGatewayCommand): ProviderGatewaySessionObservationRequest {
  return { sessionId: request.sessionId, provider: request.provider, targetSnapshotId: request.targetSnapshotId, repositoryRoot: request.repositoryRoot };
}

function requireSessionBinding(observed: ProviderRuntimeSessionObservation, request: ProviderGatewaySessionObservationRequest): void {
  if (observed.sessionId !== request.sessionId || observed.provider !== request.provider || observed.targetSnapshotId !== request.targetSnapshotId
    || rootKey(observed.repositoryRoot) !== rootKey(request.repositoryRoot)) {
    throw new Error("The provider session or exact target changed.");
  }
}

function requireCouncilSession(observed: ProviderRuntimeSessionObservation, request: ProviderGatewaySessionObservationRequest, when: "before" | "after"): void {
  requireSessionBinding(observed, request);
  const capabilities = truthfulCapabilities(observed.capabilities, true);
  if (observed.status !== "running" || !["registered", "observable", "controllable", "mediated"].every((capability) => capabilities.includes(capability as Capability))) {
    throw new Error(`The Council provider session is not fresh, running, Controllable, and Mediated ${when} acknowledgement.`);
  }
}

function truthfulCapabilities(capabilities: readonly Capability[], mediationAttested: boolean): readonly Capability[] {
  return mediationAttested ? [...capabilities] : capabilities.filter((capability) => capability !== "mediated");
}

function validateCommandResponse(request: ProviderGatewayCommand, response: ProviderGatewayCommandResult): void {
  if (Buffer.byteLength(stableJson(response), "utf8") > 64 * 1024) throw new Error("The provider response is oversized.");
  if (response.externalId !== request.externalId) throw new Error("The provider response changed the external operation identity.");
  if (request.kind === "workflow") {
    const now = new Date(0).toISOString();
    const artifact: WorkflowArtifact = {
      id: request.artifact.id, digest: request.artifact.digest, action: request.action,
      repositoryRoot: request.repositoryRoot, targetSnapshotId: request.targetSnapshotId,
      sessionId: request.sessionId, ...(request.artifact.taskId ? { taskId: request.artifact.taskId } : {}),
      ...(request.artifact.planRevision ? { planRevision: request.artifact.planRevision } : {}),
      payload: request.artifact.payload, status: "submitted", operationId: request.operationId,
      executionAuthorized: false, createdAt: now, updatedAt: now
    };
    parseWorkflowProviderResponse(response, artifact);
    return;
  }
  if (response.schema !== "sxsy-b122.remote-result" || response.version !== 1 || !remoteStatus(response.status)
    || !effectDisposition(response.effectDisposition) || typeof response.summary !== "string" || response.summary.length < 1 || response.summary.length > 512) {
    throw new Error("The automation provider response is malformed.");
  }
}

function fixtureWorkflowResult(request: Extract<ProviderGatewayCommand, { kind: "workflow" }>): WorkflowProviderResult {
  const payload = request.artifact.payload;
  switch (payload.kind) {
    case "anchor": return { kind: "anchor", anchorDigest: sha256(stableJson(payload)), discrepancies: [], questions: payload.unresolved, resumed: false };
    case "proof": return { kind: "proof", verifiedClaims: payload.claims, evidenceReferences: payload.evidence.tests.map((entry) => `${entry.id}:${entry.digest}:${entry.status}`), backendResults: payload.requiredBackends.map((backend) => ({ backend, status: "passed" as const })) };
    case "decision": return { kind: "decision", decisionPacketId: `fixture:${request.artifact.id}`, decisions: payload.decisions.map((decision) => ({ decisionId: decision.id, options: Array.from({ length: 5 }, (_, index) => ({ id: `${decision.id}:${index + 1}`, label: `Fixture option ${index + 1}`, tradeoffs: [`Tradeoff ${index + 1}`], risks: [`Risk ${index + 1}`] })), recommendationId: `${decision.id}:1` })), userSelectionRequired: true };
    case "plan": return payload.mode === "expand"
      ? { kind: "plan", mode: "expanded", planDigest: payload.plan.digest, alternatives: Array.from({ length: 15 }, (_, index) => ({ rank: index + 1, id: `fixture-alternative-${index + 1}`, summary: `Fixture alternative ${index + 1}`, rationale: "Credential-free deterministic fixture output.", risks: [] })) }
      : { kind: "plan", mode: "execution_ack", planDigest: payload.plan.digest, planRevision: payload.plan.revision, originSessionId: payload.plan.originSessionId, executorSessionId: payload.executorSessionId, authorityId: payload.authorityId, acknowledgementId: `fixture:${request.operationId}`, executionStarted: true };
    case "handoff": return { kind: "handoff", packageId: payload.packageId, recipientSessionId: payload.recipientSessionId, acknowledged: true };
    case "focus": return { kind: "focus", selectedSessionId: payload.selectedSessionId, status: payload.expectedStatus, queueCycleId: payload.queueCycleId, resultDelivered: true };
    case "authority": return { kind: "authority", acknowledgements: payload.packets.map((packet) => ({ recipientSessionId: packet.recipientSessionId, grantId: packet.grantId, matchDigest: packet.matchDigest, acknowledged: true })) };
    case "voice_binding": return { kind: "voice_binding", bindingId: `fixture:${request.artifact.id}`, active: true };
  }
}

function workflowStatus(status: ProviderGatewayRemoteResult["status"]): Exclude<ProviderGatewayRemoteResult["status"], "cancelled" | "timed_out"> {
  return status === "cancelled" || status === "timed_out" ? "failed" : status;
}
function sameOperation(left: ProviderGatewayOperationObservation, right: ProviderGatewayOperationObservationRequest): boolean { return left.operationId === right.operationId && left.externalId === right.externalId && left.routeId === right.routeId && left.targetSnapshotId === right.targetSnapshotId; }
function requireCouncilAcknowledgement(value: ProviderCouncilAcknowledgement, request: ProviderCouncilRequest): void { if (value.schema !== "sxsy-b122.council-ack" || value.version !== 1 || value.epochId !== request.epochId || value.phase !== request.phase || value.sessionId !== request.sessionId || value.targetSnapshotId !== request.targetSnapshotId || value.accepted !== true || value.assignmentDigest !== request.assignmentDigest || value.resourceHostDigest !== request.resourceHost?.digest) throw new Error("The provider Council acknowledgement changed its exact binding."); }
function councilRuntimeKey(value: ProviderCouncilRequest): string { return `${value.epochId}:${value.sessionId}:${value.phase}`; }
function rootKey(value: string): string { return value.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase(); }
function remoteStatus(value: unknown): boolean { return value === "completed" || value === "unavailable" || value === "blocked" || value === "failed" || value === "awaiting_input" || value === "awaiting_confirmation" || value === "running" || value === "cancelled" || value === "timed_out"; }
function effectDisposition(value: unknown): boolean { return value === "not_started" || value === "committed" || value === "ambiguous" || value === "compensated"; }
