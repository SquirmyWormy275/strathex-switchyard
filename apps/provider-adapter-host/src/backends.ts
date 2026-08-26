import type { Capability, EffectDisposition, SessionStatus } from "../../../packages/control-plane/src/contracts.ts";
import { commandActionIds, commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { redactText } from "../../../packages/control-plane/src/redaction.ts";
import {
  parseWorkflowProviderResponse,
  type AuthorityPendingRequest,
  type CoordinatorEvidenceBundle,
  type ExistingPlanBinding,
  type PendingDecision,
  type PlanStepArtifact,
  type WorkflowArtifact,
  type WorkflowEvidenceReference,
  type WorkflowProviderResult,
  type WorkflowTestEvidence
} from "../../../packages/control-plane/src/workflow-artifacts.ts";
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

export interface ProviderRuntimeWorkflowContextRequest {
  readonly sessionId: string;
  readonly provider: ProviderGatewayProvider;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly head: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly requestNonce: string;
}

/** Provider-observed data only. This schema deliberately has no authority, permission, credential, command, or executable field. */
export interface ProviderRuntimeWorkflowContextObservation extends ProviderRuntimeWorkflowContextRequest {
  readonly contextId: string;
  readonly sourceRevision: number;
  readonly plannedFiles: readonly string[];
  readonly resources: readonly string[];
  readonly dependencies: readonly string[];
  readonly diffDigest: string;
  readonly evidence: CoordinatorEvidenceBundle;
  readonly pendingDecisions: readonly PendingDecision[];
  readonly pendingRequest: AuthorityPendingRequest | null;
}

export interface ProviderAdapterIdentity {
  readonly adapterId: string;
  readonly moduleSha256: string;
  readonly observationDeadlineMs?: number;
}

export interface ProviderWorkflowContextObservation extends ProviderRuntimeWorkflowContextObservation {
  readonly adapter: Readonly<{ id: string; version: string; moduleSha256: string }>;
  readonly contextDigest: string;
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
  observeWorkflowContext(request: ProviderRuntimeWorkflowContextRequest, signal: AbortSignal): Promise<ProviderRuntimeWorkflowContextObservation>;
  observeOperation(request: ProviderGatewayOperationObservationRequest, signal: AbortSignal): Promise<ProviderGatewayOperationObservation>;
  cancelOperation(request: ProviderGatewayCancellationRequest, signal: AbortSignal): Promise<ProviderGatewayCancellationAcknowledgement>;
  council(request: ProviderCouncilRequest, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement>;
  observeCouncil(request: ProviderCouncilRequest, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement | undefined>;
  /** Typed, bounded host shutdown. Modules must close every owned handle and descendant before resolving. */
  shutdown(signal: AbortSignal): Promise<void>;
  cleanupCouncilResources?(request: ProviderCouncilCleanupRequest, signal: AbortSignal): Promise<void>;
  abortCouncilAssignment?(request: ProviderCouncilRequest, signal: AbortSignal): Promise<void>;
}

abstract class ExactProviderAdapterBackend implements ProviderGatewayBackend {
  readonly boundary = "local-only" as const;
  readonly provider: ProviderGatewayProvider;
  readonly dispatchIdentity: Readonly<{ adapterId: string; moduleSha256: string }>;
  protected readonly port: ProviderRuntimePort;
  private readonly mediationAttestedForTests: boolean;
  private readonly adapterIdentity: Readonly<{ id: string; moduleSha256: string }>;
  private readonly observationDeadlineMs: number;

  protected constructor(provider: ProviderGatewayProvider, port: ProviderRuntimePort, identity?: ProviderAdapterIdentity) {
    if (port.provider !== provider) throw new Error(`The ${provider} provider runtime port identity is inconsistent.`);
    this.provider = provider;
    this.port = port;
    // The repository-owned effectful fixture is never package-configurable;
    // it exists solely to prove the typed adapter contract in isolated tests.
    // A digest-pinned third-party Node module is part of the broad TCB and may
    // not self-assert the host's Mediated capability.
    this.mediationAttestedForTests = port instanceof FixtureProviderRuntimePort && port.diagnosticOnly === false;
    const fixtureIdentity = port instanceof FixtureProviderRuntimePort
      ? { adapterId: `sxsy-b122.fixture.${provider}`, moduleSha256: sha256(`sxsy-b122.fixture.${provider}.v1`) }
      : undefined;
    const selected = identity ?? fixtureIdentity;
    if (!selected || !safeAdapterId(selected.adapterId) || !digest(selected.moduleSha256)) {
      throw new Error("The provider backend requires one host-owned adapter identity and module digest.");
    }
    this.adapterIdentity = Object.freeze({ id: selected.adapterId, moduleSha256: selected.moduleSha256 });
    this.dispatchIdentity = Object.freeze({ adapterId: selected.adapterId, moduleSha256: selected.moduleSha256 });
    this.observationDeadlineMs = boundedDeadline(identity?.observationDeadlineMs ?? 10_000);
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
    const requiredCapabilities = providerEffectCapabilityFloor(request.kind, request.action);
    const expectedRoute = `${request.kind === "workflow" ? "provider" : "automation"}.${request.action}`;
    if (request.routeId !== expectedRoute) throw new Error("The provider effect route does not match its exact catalog action.");
    const exactSession = sessionRequest(request);
    const before = await this.port.observeSession(exactSession, signal);
    requireExecutionSession(before, exactSession, this.mediationAttestedForTests, requiredCapabilities, "before");
    const response = await this.port.execute(request, signal);
    const after = await this.port.observeSession(exactSession, signal);
    requireExecutionSession(after, exactSession, this.mediationAttestedForTests, requiredCapabilities, "after");
    if (before.adapterVersion !== after.adapterVersion) throw new Error("The provider adapter identity changed during execution.");
    validateCommandResponse(request, response);
    return response;
  }

  async observeSession(request: ProviderGatewaySessionObservationRequest, signal: AbortSignal): Promise<ProviderGatewaySessionObservation> {
    this.exactProvider(request.provider);
    const observed = await this.port.observeSession(request, signal);
    requireSessionBinding(observed, request);
    const { repositoryRoot: _repositoryRoot, ...gatewayObservation } = observed;
    return { ...gatewayObservation, capabilities: truthfulCapabilities(gatewayObservation.capabilities, this.mediationAttestedForTests) };
  }

  async observeWorkflowContext(request: ProviderRuntimeWorkflowContextRequest, signal: AbortSignal): Promise<ProviderWorkflowContextObservation> {
    this.exactProvider(request.provider);
    validateWorkflowContextRequest(request);
    const boundary = new ObservationBoundary(signal, this.observationDeadlineMs);
    try {
      const sessionRequestValue: ProviderGatewaySessionObservationRequest = {
        sessionId: request.sessionId,
        provider: request.provider,
        targetSnapshotId: request.targetSnapshotId,
        repositoryRoot: request.repositoryRoot
      };
      const before = await boundary.wait(this.port.observeSession(sessionRequestValue, boundary.signal));
      requireWorkflowSession(before, sessionRequestValue);
      const raw = await boundary.wait(this.port.observeWorkflowContext(request, boundary.signal));
      const observation = validateWorkflowContextObservation(raw, request);
      const after = await boundary.wait(this.port.observeSession(sessionRequestValue, boundary.signal));
      requireWorkflowSession(after, sessionRequestValue);
      if (before.adapterVersion !== after.adapterVersion) throw new Error("The provider adapter identity changed during workflow-context observation.");
      const adapter = Object.freeze({ id: this.adapterIdentity.id, version: after.adapterVersion, moduleSha256: this.adapterIdentity.moduleSha256 });
      const { requestNonce: _requestNonce, ...source } = observation;
      const contextMaterial = Object.freeze({ ...source, adapter });
      return Object.freeze({ ...observation, adapter, contextDigest: sha256(stableJson(contextMaterial)) });
    } finally {
      boundary.dispose();
    }
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
      if (request.phase === "assignment") await this.port.abortCouncilAssignment?.(request, signal).catch(() => undefined);
      throw error;
    }
  }

  async observeCouncil(request: ProviderCouncilRequest, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement | undefined> {
    const acknowledgement = await this.port.observeCouncil(request, signal);
    if (acknowledgement) requireCouncilAcknowledgement(acknowledgement, request);
    return acknowledgement;
  }

  async cleanupCouncilResources(request: ProviderCouncilCleanupRequest, signal: AbortSignal): Promise<void> {
    if (!this.port.cleanupCouncilResources) throw new Error("The provider runtime has no Council resource cleanup boundary.");
    await this.port.cleanupCouncilResources(request, signal);
  }

  private exactProvider(provider: ProviderGatewayProvider): void {
    if (provider !== this.provider) throw new Error("The provider runtime changed identity.");
  }
}

const capabilityOrder = ["registered", "observable", "controllable", "mediated"] as const satisfies readonly Capability[];

/**
 * Derive the provider-host capability floor from the closed 65-command
 * catalog. Mediated is hierarchical and therefore requires all four host-
 * truthful capabilities; advisory actions retain their smaller exact floor.
 */
export function providerEffectCapabilityFloor(kind: "workflow" | "automation", action: unknown): readonly Capability[] {
  if (!commandAction(action)) throw new Error(`The provider ${kind} action is not in the closed command catalog.`);
  const definition = commandForAction(action);
  const expectedExecutor = kind === "workflow" ? "agent" : "automation";
  if (definition.executor !== expectedExecutor) throw new Error(`The provider ${kind} action has the wrong catalog executor.`);

  const required = new Set<Capability>(["registered"]);
  for (const capability of definition.requiresCapabilities) {
    required.add("registered");
    if (capability === "observable") required.add("observable");
    if (capability === "controllable") required.add("controllable");
    if (capability === "mediated") {
      required.add("observable");
      required.add("controllable");
      required.add("mediated");
    }
  }
  return Object.freeze(capabilityOrder.filter((capability) => required.has(capability)));
}

export class ClaudeProviderAdapterBackend extends ExactProviderAdapterBackend {
  constructor(port: ProviderRuntimePort, identity?: ProviderAdapterIdentity) { super("claude", port, identity); }
}

export class CodexProviderAdapterBackend extends ExactProviderAdapterBackend {
  constructor(port: ProviderRuntimePort, identity?: ProviderAdapterIdentity) { super("codex", port, identity); }
}

export type ProviderAdapterBackend = ClaudeProviderAdapterBackend | CodexProviderAdapterBackend;

/** Credential-free deterministic runtime used only for loopback diagnostics and tests. */
export class FixtureProviderRuntimePort implements ProviderRuntimePort {
  readonly provider: ProviderGatewayProvider;
  readonly diagnosticOnly: boolean;
  executeCalls = 0;
  readonly councilPhases: string[] = [];
  private readonly sessions = new Map<string, {
    repositoryRoot: string;
    targetSnapshotId: string;
    branch: string;
    head: string;
    taskId: string;
    planRevision: string;
    plannedFiles: readonly string[];
    resources: readonly string[];
    dependencies: readonly string[];
    diffDigest: string;
    status: SessionStatus;
    capabilities: readonly Capability[];
  }>();
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
    const taskId = "task-provider-host";
    const planRevision = "plan-1";
    const plannedFiles = ["src/example.ts"];
    const resources = ["port:4100"];
    const dependencies: readonly string[] = [];
    const diffDigest = sha256("");
    this.sessions.set(request.sessionId, {
      repositoryRoot: request.repositoryRoot,
      targetSnapshotId: request.targetSnapshotId,
      branch: request.branch ?? "fixture-detached",
      head: request.head ?? "0".repeat(40),
      taskId,
      planRevision,
      plannedFiles,
      resources,
      dependencies,
      diffDigest,
      status: this.diagnosticOnly ? "unknown" : "running",
      capabilities
    });
    if (this.diagnosticOnly) return {
      capabilities: [], status: "unknown", adapterVersion: `${this.provider}-fixture-provider-host-v1`,
      plannedFiles: [], resources: [], dependencies: [], diffDigest
    };
    return {
      capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running",
      adapterVersion: `${this.provider}-fixture-provider-host-v1`,
      taskId,
      planRevision,
      plannedFiles,
      resources,
      dependencies,
      diffDigest
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

  async observeWorkflowContext(request: ProviderRuntimeWorkflowContextRequest, _signal: AbortSignal): Promise<ProviderRuntimeWorkflowContextObservation> {
    const session = this.sessions.get(request.sessionId);
    if (!session || session.repositoryRoot !== request.repositoryRoot || session.targetSnapshotId !== request.targetSnapshotId
      || session.branch !== request.branch || session.head !== request.head || session.taskId !== request.taskId
      || session.planRevision !== request.planRevision) throw new Error("The fixture workflow context is no longer exact.");
    const evidence = fixtureCoordinatorEvidence(request);
    return {
      ...request,
      contextId: `fixture-context:${request.sessionId}`,
      sourceRevision: 1,
      plannedFiles: session.plannedFiles,
      resources: session.resources,
      dependencies: session.dependencies,
      diffDigest: session.diffDigest,
      evidence,
      pendingDecisions: [{ id: "decision-1", question: "Choose the exact bounded option.", context: "The protected workflow requires one operator decision." }],
      pendingRequest: { requestId: "pending-1", targetSnapshotId: request.targetSnapshotId, planRevision: request.planRevision, planDigest: evidence.plan.digest, action: "proof" }
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

function fixtureCoordinatorEvidence(request: ProviderRuntimeWorkflowContextRequest): CoordinatorEvidenceBundle {
  const planMaterial = {
    revision: request.planRevision,
    originSessionId: request.sessionId,
    taskId: request.taskId,
    objective: "Execute the exact protected plan.",
    steps: [{ id: "step-1", summary: "Inspect the target.", ownedFiles: ["src/example.ts"], dependencies: [], status: "approved" as const }],
    decisions: ["Use the exact target snapshot."]
  };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const material = {
    instructions: [{ id: "instructions-1", digest: "1".repeat(64), source: "protected_context" as const, summary: "Use protected instructions." }],
    plan,
    documentation: [{ id: "documentation-1", digest: "2".repeat(64), source: "repository" as const, summary: "Read the repository documentation." }],
    diff: { id: "diff-1", digest: sha256(""), source: "target_snapshot" as const, summary: "Inspect the exact diff." },
    files: [{ id: "file-1", digest: "4".repeat(64), source: "repository" as const, summary: "Inspect the exact file." }],
    tests: [{ id: "test-1", digest: "5".repeat(64), source: "receipt" as const, summary: "Use the test receipt.", status: "passed" as const }]
  };
  return { contextDigest: sha256(stableJson(material)), ...material };
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

function requireExecutionSession(
  observed: ProviderRuntimeSessionObservation,
  request: ProviderGatewaySessionObservationRequest,
  mediationAttested: boolean,
  requiredCapabilities: readonly Capability[],
  when: "before" | "after"
): void {
  requireSessionBinding(observed, request);
  const capabilities = truthfulCapabilities(observed.capabilities, mediationAttested);
  if (observed.status !== "running" || !safeAdapterVersion(observed.adapterVersion)
    || !requiredCapabilities.every((capability) => capabilities.includes(capability))) {
    throw new Error(`Provider execution requires one fresh, running exact session with ${requiredCapabilities.join(", ")} ${when} dispatch.`);
  }
}

function requireWorkflowSession(observed: ProviderRuntimeSessionObservation, request: ProviderGatewaySessionObservationRequest): void {
  requireSessionBinding(observed, request);
  if (!observed.capabilities.includes("registered") || !observed.capabilities.includes("observable")
    || observed.status === "unreachable" || observed.status === "stale" || observed.status === "unknown"
    || !safeAdapterVersion(observed.adapterVersion)) {
    throw new Error("Workflow-context observation requires one fresh exact Observable provider session.");
  }
}

function validateWorkflowContextRequest(value: ProviderRuntimeWorkflowContextRequest): void {
  if (!safeIdentifier(value.sessionId) || (value.provider !== "claude" && value.provider !== "codex")
    || !digest(value.targetSnapshotId) || !absoluteRoot(value.repositoryRoot) || !safeBranch(value.branch)
    || !sha40(value.head) || !boundedIdentity(value.taskId) || !boundedIdentity(value.planRevision)
    || !digest(value.requestNonce)) throw new Error("The provider workflow-context request binding is invalid.");
}

function validateWorkflowContextObservation(value: ProviderRuntimeWorkflowContextObservation, request: ProviderRuntimeWorkflowContextRequest): ProviderRuntimeWorkflowContextObservation {
  if (!record(value) || !exactKeys(value, [
    "sessionId", "provider", "targetSnapshotId", "repositoryRoot", "branch", "head", "taskId", "planRevision", "requestNonce",
    "contextId", "sourceRevision", "plannedFiles", "resources", "dependencies", "diffDigest", "evidence", "pendingDecisions", "pendingRequest"
  ])) throw new Error("The provider workflow-context observation has an inexact top-level schema.");
  if (value.sessionId !== request.sessionId || value.provider !== request.provider || value.targetSnapshotId !== request.targetSnapshotId
    || rootKey(value.repositoryRoot) !== rootKey(request.repositoryRoot) || value.branch !== request.branch || value.head !== request.head
    || value.taskId !== request.taskId || value.planRevision !== request.planRevision || value.requestNonce !== request.requestNonce) {
    throw new Error("The provider workflow-context observation changed its exact request binding.");
  }
  if (!safeIdentifier(value.contextId) || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1
    || !digest(value.diffDigest) || !relativePathList(value.plannedFiles, 512) || !boundedStringList(value.resources, 128, 256)
    || !boundedStringList(value.dependencies, 512, 512)) throw new Error("The provider workflow-context observation has malformed bounded fields.");
  const evidence = normalizeCoordinatorEvidence(value.evidence, request);
  const pendingDecisions = normalizePendingDecisions(value.pendingDecisions);
  const pendingRequest = normalizePendingRequest(value.pendingRequest, request, evidence.plan.digest);
  const planned = new Set(value.plannedFiles.map(pathKey));
  const planFiles = new Set(evidence.plan.steps.flatMap((step) => step.ownedFiles).map(pathKey));
  if (planned.size !== planFiles.size || [...planned].some((entry) => !planFiles.has(entry)) || value.diffDigest !== evidence.diff.digest) {
    throw new Error("The provider workflow-context evidence changed its exact planned-file or diff binding.");
  }
  const normalized = Object.freeze({
    ...value,
    plannedFiles: Object.freeze([...value.plannedFiles]),
    resources: Object.freeze([...value.resources]),
    dependencies: Object.freeze([...value.dependencies]),
    evidence,
    pendingDecisions,
    pendingRequest
  });
  if (Buffer.byteLength(stableJson(normalized), "utf8") > 64 * 1024) throw new Error("The provider workflow-context observation is oversized.");
  return normalized;
}

function normalizeCoordinatorEvidence(value: unknown, request: ProviderRuntimeWorkflowContextRequest): CoordinatorEvidenceBundle {
  if (!record(value) || !exactKeys(value, ["contextDigest", "instructions", "plan", "documentation", "diff", "files", "tests"]) || !digest(value.contextDigest)) {
    throw new Error("The provider workflow-context evidence bundle is malformed.");
  }
  const instructions = evidenceReferenceList(value.instructions, 1, 64, false);
  const plan = normalizePlan(value.plan, request);
  const documentation = evidenceReferenceList(value.documentation, 1, 256, false);
  const diff = normalizeEvidenceReference(value.diff, false);
  const files = evidenceReferenceList(value.files, 1, 512, false);
  const tests = evidenceReferenceList(value.tests, 1, 256, true) as readonly WorkflowTestEvidence[];
  const material = { instructions, plan, documentation, diff, files, tests };
  if (sha256(stableJson(material)) !== value.contextDigest) throw new Error("The provider workflow-context evidence digest is invalid.");
  return Object.freeze({ contextDigest: value.contextDigest, ...material });
}

function normalizePlan(value: unknown, request: ProviderRuntimeWorkflowContextRequest): ExistingPlanBinding {
  if (!record(value) || !exactKeys(value, ["digest", "revision", "originSessionId", "taskId", "objective", "steps", "decisions"])
    || !digest(value.digest) || value.revision !== request.planRevision || value.originSessionId !== request.sessionId
    || value.taskId !== request.taskId || !safeText(value.objective, 16_384) || !Array.isArray(value.steps)
    || value.steps.length < 1 || value.steps.length > 256 || !Array.isArray(value.decisions) || value.decisions.length > 512) {
    throw new Error("The provider workflow-context plan binding is malformed or inconsistent.");
  }
  const steps: PlanStepArtifact[] = value.steps.map((step) => {
    if (!record(step) || !exactKeys(step, ["id", "summary", "ownedFiles", "dependencies", "status"]) || !safeIdentifier(step.id)
      || !safeText(step.summary, 16_384) || !relativePathList(step.ownedFiles, 512) || !identifierList(step.dependencies, 256)
      || (step.status !== "proposed" && step.status !== "approved" && step.status !== "completed" && step.status !== "blocked")) {
      throw new Error("The provider workflow-context plan step is malformed.");
    }
    return Object.freeze({ id: step.id, summary: step.summary.trim(), ownedFiles: Object.freeze([...step.ownedFiles]), dependencies: Object.freeze([...step.dependencies]), status: step.status });
  });
  if (new Set(steps.map((step) => step.id)).size !== steps.length) throw new Error("The provider workflow-context plan step IDs are duplicated.");
  const known = new Set(steps.map((step) => step.id));
  if (steps.some((step) => step.dependencies.some((dependency) => dependency === step.id || !known.has(dependency)))) throw new Error("The provider workflow-context plan dependencies are inconsistent.");
  if (!value.decisions.every((entry) => safeText(entry, 16_384)) || new Set(value.decisions).size !== value.decisions.length) throw new Error("The provider workflow-context plan decisions are malformed.");
  const normalized = Object.freeze({
    digest: value.digest,
    revision: value.revision,
    originSessionId: value.originSessionId,
    taskId: value.taskId,
    objective: value.objective.trim(),
    steps: Object.freeze(steps),
    decisions: Object.freeze(value.decisions.map((entry) => (entry as string).trim()))
  });
  const { digest: _digest, ...material } = normalized;
  if (sha256(stableJson(material)) !== normalized.digest) throw new Error("The provider workflow-context plan digest is invalid.");
  return normalized;
}

function evidenceReferenceList(value: unknown, minimum: number, maximum: number, testEvidence: boolean): readonly (WorkflowEvidenceReference | WorkflowTestEvidence)[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error("A provider workflow-context evidence list is incomplete or unbounded.");
  const normalized = value.map((entry) => normalizeEvidenceReference(entry, testEvidence));
  if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length) throw new Error("Provider workflow-context evidence IDs are duplicated.");
  return Object.freeze(normalized);
}

function normalizeEvidenceReference(value: unknown, testEvidence: boolean): WorkflowEvidenceReference | WorkflowTestEvidence {
  const keys = testEvidence ? ["id", "digest", "source", "summary", "status"] : ["id", "digest", "source", "summary"];
  if (!record(value) || !exactKeys(value, keys) || !safeIdentifier(value.id) || !digest(value.digest)
    || (value.source !== "protected_context" && value.source !== "repository" && value.source !== "target_snapshot" && value.source !== "receipt")
    || !safeText(value.summary, 16_384) || (testEvidence && value.status !== "passed" && value.status !== "failed" && value.status !== "unavailable"
      && value.status !== "incomplete" && value.status !== "assumed" && value.status !== "not_run")) {
    throw new Error("A provider workflow-context evidence reference is malformed.");
  }
  const base = { id: value.id, digest: value.digest, source: value.source, summary: value.summary.trim() } as WorkflowEvidenceReference;
  return testEvidence ? Object.freeze({ ...base, status: value.status as WorkflowTestEvidence["status"] }) : Object.freeze(base);
}

function normalizePendingDecisions(value: unknown): readonly PendingDecision[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error("The provider workflow-context pending decisions are unbounded.");
  const decisions = value.map((entry) => {
    if (!record(entry) || !exactKeys(entry, ["id", "question", "context"]) || !safeIdentifier(entry.id)
      || !safeText(entry.question, 4_096) || !safeText(entry.context, 16_384)) throw new Error("A provider workflow-context pending decision is malformed.");
    return Object.freeze({ id: entry.id, question: entry.question.trim(), context: entry.context.trim() });
  });
  if (new Set(decisions.map((entry) => entry.id)).size !== decisions.length) throw new Error("Provider workflow-context pending decision IDs are duplicated.");
  return Object.freeze(decisions);
}

function normalizePendingRequest(value: unknown, request: ProviderRuntimeWorkflowContextRequest, planDigest: string): AuthorityPendingRequest | null {
  if (value === null) return null;
  if (!record(value) || !exactKeys(value, ["requestId", "targetSnapshotId", "planRevision", "planDigest", "action"])
    || !safeIdentifier(value.requestId) || value.targetSnapshotId !== request.targetSnapshotId || value.planRevision !== request.planRevision
    || value.planDigest !== planDigest || !commandAction(value.action)) throw new Error("The provider workflow-context pending request is malformed or inconsistently bound.");
  return Object.freeze({ requestId: value.requestId, targetSnapshotId: value.targetSnapshotId, planRevision: value.planRevision, planDigest: value.planDigest, action: value.action });
}

class ObservationBoundary {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly deadlineAt: number;
  private readonly caller?: AbortSignal;
  private readonly onCallerAbort: () => void;

  constructor(caller: AbortSignal, timeoutMs: number) {
    this.signal = this.controller.signal;
    this.deadlineAt = Date.now() + timeoutMs;
    this.caller = caller;
    this.onCallerAbort = () => this.controller.abort();
    if (caller.aborted) this.controller.abort();
    else caller.addEventListener("abort", this.onCallerAbort, { once: true });
    this.timer = setTimeout(() => this.controller.abort(), timeoutMs);
    this.timer.unref?.();
  }

  wait<T>(pending: Promise<T>): Promise<T> {
    // Both callbacks stay attached after an abort so a hostile/buggy module's
    // late resolution or rejection cannot become an unhandled settlement.
    pending.then(() => undefined, () => undefined);
    if (this.signal.aborted) return Promise.reject(new Error("Provider workflow-context observation was cancelled or exceeded its deadline."));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => { cleanup(); reject(new Error("Provider workflow-context observation was cancelled or exceeded its deadline.")); };
      const cleanup = () => this.signal.removeEventListener("abort", onAbort);
      this.signal.addEventListener("abort", onAbort, { once: true });
      pending.then((result) => {
        cleanup();
        if (Date.now() >= this.deadlineAt) { this.controller.abort(); reject(new Error("Provider workflow-context observation was cancelled or exceeded its deadline.")); }
        else resolve(result);
      }, (error) => { cleanup(); reject(error); });
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.caller?.removeEventListener("abort", this.onCallerAbort);
    this.controller.abort();
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
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  const allowed = new Set(keys);
  return actual.length === keys.length && actual.every((key) => allowed.has(key)) && keys.every((key) => Object.hasOwn(value, key));
}
function safeIdentifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value); }
function boundedIdentity(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value); }
function safeAdapterId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function safeAdapterVersion(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_.+-]{1,80}$/.test(value); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function sha40(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
function absoluteRoot(value: unknown): value is string { return typeof value === "string" && value.length <= 4_096 && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && !/[\0\r\n]/.test(value); }
function safeBranch(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\0\r\n~^:?*\\\[]/.test(value); }
function boundedStringList(value: unknown, maximumItems: number, maximumLength: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= maximumItems && new Set(value).size === value.length
    && value.every((entry) => typeof entry === "string" && entry.trim().length > 0 && entry.length <= maximumLength && !/[\0\r\n]/.test(entry));
}
function safeText(value: unknown, maximumLength: number): value is string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > maximumLength || value.includes("\0")) return false;
  return redactText(value.trim()) === value.trim();
}
function commandAction(value: unknown): value is CommandAction { return typeof value === "string" && (commandActionIds as readonly string[]).includes(value); }
function identifierList(value: unknown, maximumItems: number): value is readonly string[] { return Array.isArray(value) && value.length <= maximumItems && new Set(value).size === value.length && value.every(safeIdentifier); }
function relativePathList(value: unknown, maximumItems: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= maximumItems && new Set(value.map(pathKey)).size === value.length && value.every((entry) => {
    if (typeof entry !== "string" || entry.length < 1 || entry.length > 512 || /[\0\r\n]/.test(entry) || /^(?:[A-Za-z]:[\\/]|\\\\|[\\/])/.test(entry)) return false;
    const segments = entry.replaceAll("\\", "/").split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  });
}
function pathKey(value: unknown): string { return typeof value === "string" ? value.replaceAll("\\", "/").toLowerCase() : ""; }
function boundedDeadline(value: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) throw new Error("The provider workflow-context observation deadline is invalid."); return value; }
