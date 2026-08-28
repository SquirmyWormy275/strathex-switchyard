import type { AuthorityGrant, Capability, EffectDisposition, ManagedSession, SessionStatus, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { exactPortableAbsoluteRoot, portableRootKey } from "../../../packages/control-plane/src/host-path.ts";
import { commandActionIds, commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { redactText, untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import type {
  ReanchorApplyRequest,
  ReanchorPostStopReport,
  ReanchorProviderAcknowledgement,
  ReanchorProviderRereadEvidence
} from "../../../packages/control-plane/src/reanchor.ts";
import { reanchorApplyArtifactDigest, reanchorRequiredRereads } from "../../../packages/control-plane/src/reanchor.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import {
  parseWorkflowChildProviderResponse,
  parseWorkflowProviderResponse,
  type AuthorityPendingRequest,
  type CoordinatorEvidenceBundle,
  type ExistingPlanBinding,
  type PendingDecision,
  type PlanStepArtifact,
  type WorkflowArtifact,
  type WorkflowChildProviderResponse,
  type WorkflowEvidenceReference,
  type WorkflowProviderResult,
  type WorkflowTestEvidence
} from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { canonicalCoordinatorEvidence } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import {
  automationMutationScopeDigest,
  type AutomationOperationProposal,
  type AutomationPathMutation
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import {
  createAutomationProposalResponse,
  parseAutomationProposalRequest,
  parseAutomationProposalResponse,
  type AutomationProposalRequest,
  type AutomationProposalResponse
} from "../../../packages/control-plane/src/automation-proposal-protocol.ts";
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
import { parseProviderDispatchLease, type ProviderDispatchLease, type ProviderDispatchLeaseArtifactBinding } from "./dispatch-lease.ts";

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
 * Closed provider-module input for the dedicated Re-anchor lifecycle. The
 * signed host lease binds the full old TargetSnapshot and an artifact digest
 * over this complete dual-target request before this object can reach a
 * proprietary module.
 */
export interface ProviderRuntimeReanchorRequest extends ReanchorApplyRequest {
  readonly schema: "sxsy-b122.provider-reanchor-request";
  readonly provider: ProviderGatewayProvider;
  readonly repositoryRoot: string;
  readonly oldTarget: TargetSnapshot;
  readonly newTarget: TargetSnapshot;
}

export type ProviderRuntimeReanchorAcknowledgement = ReanchorProviderAcknowledgement;

export interface ProviderMediatedEffectBinding {
  readonly schema: "sxsy-b122.provider-mediated-effect-binding";
  readonly version: 1;
  readonly authorizationId: string;
  readonly configurationSha256: string;
  readonly provider: ProviderGatewayProvider;
  readonly adapterId: string;
  readonly moduleSha256: string;
  readonly leaseId: string;
  readonly leaseDigest: string;
  readonly operationId: string;
  readonly action: string;
  readonly routeId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly containmentBindingDigest: string;
  readonly containmentFenceEpoch: number;
}

export interface ProviderMediatedEffectAuthorization extends ProviderMediatedEffectBinding {
  readonly finalCurrentDecisionDigest: string;
}

export interface ProviderMediatedFinalCurrentDecision {
  readonly schema: "sxsy-b122.provider-mediated-final-current-decision";
  readonly version: 1;
  readonly authorizationId: string;
  readonly leaseId: string;
  readonly operationId: string;
  readonly action: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly containmentBindingDigest: string;
  readonly containmentFenceEpoch: number;
  readonly challengeNonce: string;
  readonly allowed: true;
  readonly decidedAt: string;
  readonly expiresAt: string;
  readonly decisionDigest: string;
}

export interface ProviderRuntimeMediatedEffectIntent {
  readonly schema: "sxsy-b122.provider-mediated-effect-intent";
  readonly version: 1;
  readonly authorizationId: string;
  readonly requestDigest: string;
  readonly operation: "execute_exact_request";
}

export interface ProviderRuntimeMediatedCouncilIntent {
  readonly schema: "sxsy-b122.provider-mediated-council-intent";
  readonly version: 1;
  readonly authorizationId: string;
  readonly requestDigest: string;
  readonly operation: "acknowledge_exact_phase";
}

export interface ProviderMediationAttestation {
  readonly schema: "sxsy-b122.provider-mediation-attestation";
  readonly version: 1;
  readonly configurationSha256: string;
  readonly provider: ProviderGatewayProvider;
  readonly adapterId: string;
  readonly moduleSha256: string;
  readonly driverModuleSha256: string;
  readonly effectPortId: "configured-provider-effect-port-v1";
  readonly attestationDigest: string;
}

export interface ProviderMediatedEffectGuard {
  assertCurrent(binding: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderMediatedFinalCurrentDecision>;
}

export interface ProviderMediatedEffectDriver {
  executeCommand(
    input: Readonly<{
      schema: "sxsy-b122.provider-mediated-command-effect";
      version: 1;
      authorization: ProviderMediatedEffectAuthorization;
      intent: ProviderRuntimeMediatedEffectIntent;
      command: ProviderGatewayCommand;
    }>,
    credential: Uint8Array,
    signal: AbortSignal
  ): Promise<ProviderGatewayCommandResult>;
  executeCouncil(
    input: Readonly<{
      schema: "sxsy-b122.provider-mediated-council-effect";
      version: 1;
      authorization: ProviderMediatedEffectAuthorization;
      intent: ProviderRuntimeMediatedCouncilIntent;
      request: ProviderCouncilRequest;
    }>,
    credential: Uint8Array,
    signal: AbortSignal
  ): Promise<ProviderCouncilAcknowledgement>;
  observeCommand?(request: ProviderGatewayOperationObservationRequest, credential: Uint8Array, signal: AbortSignal): Promise<ProviderGatewayOperationObservation>;
  cancelCommand?(request: ProviderGatewayCancellationRequest, credential: Uint8Array, signal: AbortSignal): Promise<ProviderGatewayCancellationAcknowledgement>;
  observeCouncil?(request: ProviderCouncilRequest, credential: Uint8Array, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement | undefined>;
}

export interface ProviderMediatedEffectHostPort {
  readonly attestation: ProviderMediationAttestation;
  executeCommand(request: ProviderGatewayCommand, intent: ProviderRuntimeMediatedEffectIntent, binding: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderGatewayCommandResult>;
  executeCouncil(request: ProviderCouncilRequest, intent: ProviderRuntimeMediatedCouncilIntent, binding: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement>;
  observeCommand(request: ProviderGatewayOperationObservationRequest, signal: AbortSignal): Promise<ProviderGatewayOperationObservation>;
  cancelCommand(request: ProviderGatewayCancellationRequest, signal: AbortSignal): Promise<ProviderGatewayCancellationAcknowledgement>;
  observeCouncil(request: ProviderCouncilRequest, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement | undefined>;
  close(): void;
}

/**
 * Trusted host-owned effect port. The digest-pinned module receives only the
 * fixed intent contract; raw credential bytes cross only this closed driver
 * call after the exact one-use binding and final-current guard pass.
 */
export class ConfiguredProviderMediatedEffectHostPort implements ProviderMediatedEffectHostPort {
  readonly attestation: ProviderMediationAttestation;
  private readonly credential: Uint8Array;
  private readonly guard: ProviderMediatedEffectGuard;
  private readonly driver: ProviderMediatedEffectDriver;
  private readonly deadlineMs: number;
  private readonly now: () => Date;
  private closed = false;

  constructor(options: Readonly<{
    configurationSha256: string;
    provider: ProviderGatewayProvider;
    adapterId: string;
    moduleSha256: string;
    driverModuleSha256: string;
    credential: Uint8Array;
    guard: ProviderMediatedEffectGuard;
    driver: ProviderMediatedEffectDriver;
    deadlineMs?: number;
    now?: () => Date;
  }>) {
    if (!digest(options.configurationSha256) || !safeAdapterId(options.adapterId) || !digest(options.moduleSha256) || !digest(options.driverModuleSha256)
      || (options.provider !== "claude" && options.provider !== "codex") || options.credential.byteLength < 1 || options.credential.byteLength > 65_536) {
      throw new Error("The configured provider mediation port identity or credential is invalid.");
    }
    const material = Object.freeze({
      schema: "sxsy-b122.provider-mediation-attestation" as const, version: 1 as const,
      configurationSha256: options.configurationSha256, provider: options.provider, adapterId: options.adapterId,
      moduleSha256: options.moduleSha256, driverModuleSha256: options.driverModuleSha256,
      effectPortId: "configured-provider-effect-port-v1" as const
    });
    this.attestation = Object.freeze({ ...material, attestationDigest: sha256(stableJson(material)) });
    this.credential = new Uint8Array(options.credential);
    this.guard = options.guard;
    this.driver = options.driver;
    this.deadlineMs = boundedDeadline(options.deadlineMs ?? 60_000);
    this.now = options.now ?? (() => new Date());
  }

  async executeCommand(request: ProviderGatewayCommand, intent: ProviderRuntimeMediatedEffectIntent, binding: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderGatewayCommandResult> {
    this.assertOpen();
    requireProviderOwnedCommand(request);
    requireMediatedIntent(intent, request, binding, "command");
    const boundary = new MediatedEffectBoundary(signal, this.deadlineMs);
    let credential: Uint8Array | undefined;
    try {
      const authorization = await boundary.wait(this.finalAuthorization(binding, boundary.signal));
      credential = new Uint8Array(this.credential);
      return await boundary.wait(this.driver.executeCommand(Object.freeze({ schema: "sxsy-b122.provider-mediated-command-effect", version: 1, authorization, intent, command: request }), credential, boundary.signal));
    } finally { credential?.fill(0); boundary.dispose(); }
  }

  async executeCouncil(request: ProviderCouncilRequest, intent: ProviderRuntimeMediatedCouncilIntent, binding: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement> {
    this.assertOpen();
    requireMediatedIntent(intent, request, binding, "council");
    const boundary = new MediatedEffectBoundary(signal, this.deadlineMs);
    let credential: Uint8Array | undefined;
    try {
      const authorization = await boundary.wait(this.finalAuthorization(binding, boundary.signal));
      credential = new Uint8Array(this.credential);
      return await boundary.wait(this.driver.executeCouncil(Object.freeze({ schema: "sxsy-b122.provider-mediated-council-effect", version: 1, authorization, intent, request }), credential, boundary.signal));
    } finally { credential?.fill(0); boundary.dispose(); }
  }

  async observeCommand(request: ProviderGatewayOperationObservationRequest, signal: AbortSignal): Promise<ProviderGatewayOperationObservation> {
    requireProviderOwnedOperationRoute(request.routeId);
    if (!this.driver.observeCommand) throw new Error("The configured host effect driver has no bounded operation observation contract.");
    return this.withCredential(signal, (credential, boundedSignal) => this.driver.observeCommand!(request, credential, boundedSignal));
  }

  async cancelCommand(request: ProviderGatewayCancellationRequest, signal: AbortSignal): Promise<ProviderGatewayCancellationAcknowledgement> {
    requireProviderOwnedOperationRoute(request.routeId);
    if (!this.driver.cancelCommand) throw new Error("The configured host effect driver has no bounded cancellation contract.");
    return this.withCredential(signal, (credential, boundedSignal) => this.driver.cancelCommand!(request, credential, boundedSignal));
  }

  async observeCouncil(request: ProviderCouncilRequest, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement | undefined> {
    if (!this.driver.observeCouncil) throw new Error("The configured host effect driver has no bounded Council observation contract.");
    return this.withCredential(signal, (credential, boundedSignal) => this.driver.observeCouncil!(request, credential, boundedSignal));
  }

  close(): void { if (this.closed) return; this.closed = true; this.credential.fill(0); }

  private async finalAuthorization(binding: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderMediatedEffectAuthorization> {
    requireMediationBinding(binding, this.attestation);
    if (signal.aborted) throw new Error("The mediated provider effect was cancelled before final-current validation.");
    const decision = await this.guard.assertCurrent(binding, signal);
    requireFinalCurrentDecision(decision, binding, this.now());
    if (signal.aborted) throw new Error("The mediated provider final-current or containment decision denied the effect.");
    return Object.freeze({ ...binding, finalCurrentDecisionDigest: decision.decisionDigest });
  }

  private assertOpen(): void { if (this.closed) throw new Error("The configured provider mediation port is closed."); }

  private async withCredential<T>(signal: AbortSignal, operation: (credential: Uint8Array, signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertOpen();
    const boundary = new MediatedEffectBoundary(signal, this.deadlineMs);
    const credential = new Uint8Array(this.credential);
    try { return await boundary.wait(operation(credential, boundary.signal)); }
    finally { credential.fill(0); boundary.dispose(); }
  }
}

class MediatedEffectBoundary {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly caller: AbortSignal;
  private readonly onCallerAbort: () => void;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(caller: AbortSignal, timeoutMs: number) {
    this.signal = this.controller.signal;
    this.caller = caller;
    this.onCallerAbort = () => this.controller.abort();
    if (caller.aborted) this.controller.abort();
    else caller.addEventListener("abort", this.onCallerAbort, { once: true });
    this.timer = setTimeout(() => this.controller.abort(), timeoutMs);
    this.timer.unref?.();
  }

  wait<T>(pending: Promise<T>): Promise<T> {
    pending.then(() => undefined, () => undefined);
    if (this.signal.aborted) return Promise.reject(new Error("The host-owned provider effect was cancelled or exceeded its deadline."));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => { cleanup(); reject(new Error("The host-owned provider effect was cancelled or exceeded its deadline.")); };
      const cleanup = () => this.signal.removeEventListener("abort", onAbort);
      this.signal.addEventListener("abort", onAbort, { once: true });
      pending.then((value) => { cleanup(); this.signal.aborted ? reject(new Error("The host-owned provider effect was cancelled or exceeded its deadline.")) : resolve(value); }, (error) => { cleanup(); reject(error); });
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.caller.removeEventListener("abort", this.onCallerAbort);
    this.controller.abort();
  }
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
  /** Observation-only review material. This method receives no credential, dispatch lease, or effect port. */
  proposeAutomation?(request: AutomationProposalRequest, signal: AbortSignal): Promise<AutomationProposalResponse>;
  prepareMediatedEffect?(request: ProviderGatewayCommand, binding: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderRuntimeMediatedEffectIntent>;
  prepareMediatedCouncilEffect?(request: ProviderCouncilRequest, binding: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderRuntimeMediatedCouncilIntent>;
  observeSession(request: ProviderGatewaySessionObservationRequest, signal: AbortSignal): Promise<ProviderRuntimeSessionObservation>;
  observeWorkflowContext(request: ProviderRuntimeWorkflowContextRequest, signal: AbortSignal): Promise<ProviderRuntimeWorkflowContextObservation>;
  reanchor(request: ProviderRuntimeReanchorRequest, signal: AbortSignal): Promise<ProviderRuntimeReanchorAcknowledgement>;
  /** Observation only. Recovery must never call reanchor again. */
  observeReanchor(request: ProviderRuntimeReanchorRequest, signal: AbortSignal): Promise<ProviderRuntimeReanchorAcknowledgement | undefined>;
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
  private readonly mediationAttested: boolean;
  private readonly mediation?: ProviderMediatedEffectHostPort;
  private readonly pendingMediatedBindings = new Map<string, ProviderMediatedEffectBinding>();
  private readonly consumedMediatedAuthorizations = new Set<string>();
  private readonly adapterIdentity: Readonly<{ id: string; moduleSha256: string }>;
  private readonly observationDeadlineMs: number;

  protected constructor(provider: ProviderGatewayProvider, port: ProviderRuntimePort, identity?: ProviderAdapterIdentity, mediation?: ProviderMediatedEffectHostPort) {
    if (port.provider !== provider) throw new Error(`The ${provider} provider runtime port identity is inconsistent.`);
    this.provider = provider;
    this.port = port;
    // The repository-owned effectful fixture is never package-configurable;
    // it exists solely to prove the typed adapter contract in isolated tests.
    // A digest-pinned third-party Node module is part of the broad TCB and may
    // not self-assert the host's Mediated capability.
    const fixtureMediation = port instanceof FixtureProviderRuntimePort && port.diagnosticOnly === false;
    const fixtureIdentity = port instanceof FixtureProviderRuntimePort
      ? { adapterId: `sxsy-b122.fixture.${provider}`, moduleSha256: sha256(`sxsy-b122.fixture.${provider}.v1`) }
      : undefined;
    const selected = identity ?? fixtureIdentity;
    if (!selected || !safeAdapterId(selected.adapterId) || !digest(selected.moduleSha256)) {
      throw new Error("The provider backend requires one host-owned adapter identity and module digest.");
    }
    if (mediation) requireMediationAttestation(mediation.attestation, provider, selected);
    const configuredMediation = !!mediation && typeof port.prepareMediatedEffect === "function" && typeof port.prepareMediatedCouncilEffect === "function";
    this.mediationAttested = fixtureMediation || configuredMediation;
    this.mediation = configuredMediation ? mediation : undefined;
    this.adapterIdentity = Object.freeze({ id: selected.adapterId, moduleSha256: selected.moduleSha256 });
    this.dispatchIdentity = Object.freeze({ adapterId: selected.adapterId, moduleSha256: selected.moduleSha256 });
    this.observationDeadlineMs = boundedDeadline(identity?.observationDeadlineMs ?? 10_000);
  }

  async handshake(request: ProviderGatewayHandshakeRequest, signal: AbortSignal): Promise<ProviderGatewayHandshakeResult> {
    this.exactProvider(request.provider);
    const result = await this.port.handshake(request, signal);
    const observed = await this.port.observeSession(request, signal);
    requireSessionBinding(observed, request);
    return { ...result, capabilities: truthfulCapabilities(result.capabilities, this.mediationAttested) };
  }

  /** Called only by the host after the authenticated dispatch lease commits durably. */
  authorizeConsumedDispatchLease(value: ProviderDispatchLease): void {
    const lease = parseProviderDispatchLease(value);
    requireProviderOwnedOperationRoute(lease.dispatch.routeId);
    if (this.port instanceof FixtureProviderRuntimePort && this.port.diagnosticOnly === false) return;
    if (!this.mediation) throw new Error("The configured provider has no host-attested Mediated effect port.");
    const binding = mediationBinding(lease);
    requireMediationBinding(binding, this.mediation.attestation);
    if (this.pendingMediatedBindings.has(binding.operationId) || this.consumedMediatedAuthorizations.has(binding.authorizationId)) {
      throw new Error("The one-use provider mediation authorization was already consumed or replayed.");
    }
    this.pendingMediatedBindings.set(binding.operationId, binding);
  }

  async execute(request: ProviderGatewayCommand, signal: AbortSignal): Promise<ProviderGatewayCommandResult> {
    this.exactProvider(request.provider);
    requireProviderOwnedCommand(request);
    if (this.port.diagnosticOnly === true) throw new Error("The credential-free fixture is health/protocol diagnostic only.");
    const requiredCapabilities = providerEffectCapabilityFloor(request.kind, request.action);
    const mediated = requiredCapabilities.includes("mediated") && this.mediation ? this.takeMediatedBinding(request) : undefined;
    const expectedRoute = `${request.kind === "workflow" ? "provider" : "automation"}.${request.action}`;
    if (request.routeId !== expectedRoute) throw new Error("The provider effect route does not match its exact catalog action.");
    const exactSession = sessionRequest(request);
    const before = await this.port.observeSession(exactSession, signal);
    requireExecutionSession(before, exactSession, this.mediationAttested, requiredCapabilities, request.action, "before");
    const response = mediated
      ? await this.mediation!.executeCommand(request, await this.prepareMediatedEffect(request, mediated, signal), mediated, signal)
      : await this.port.execute(request, signal);
    const after = await this.port.observeSession(exactSession, signal);
    requireExecutionSession(after, exactSession, this.mediationAttested, requiredCapabilities, request.action, "after");
    if (before.adapterVersion !== after.adapterVersion) throw new Error("The provider adapter identity changed during execution.");
    const hostBoundResponse = request.kind === "workflow" && request.child
      ? { ...(response as WorkflowChildProviderResponse), adapterId: this.dispatchIdentity.adapterId, moduleSha256: this.dispatchIdentity.moduleSha256 }
      : response;
    validateCommandResponse(request, hostBoundResponse);
    return hostBoundResponse;
  }

  async proposeAutomation(request: AutomationProposalRequest, signal: AbortSignal): Promise<AutomationProposalResponse> {
    const exact = parseAutomationProposalRequest(request, request.action);
    if (exact.session.provider !== "claude" && exact.session.provider !== "codex") {
      throw new Error("Automation proposal observation requires one exact configured provider session.");
    }
    this.exactProvider(exact.session.provider);
    const sessionRequestValue: ProviderGatewaySessionObservationRequest = {
      sessionId: exact.session.id,
      provider: exact.session.provider,
      targetSnapshotId: exact.target.id,
      repositoryRoot: exact.target.repositoryRoot
    };
    const boundary = new ObservationBoundary(signal, this.observationDeadlineMs);
    try {
      const before = await boundary.wait(this.port.observeSession(sessionRequestValue, boundary.signal));
      requireAutomationProposalSession(before, exact, this.mediationAttested, "before");
      const raw = this.port.proposeAutomation
        ? await boundary.wait(this.port.proposeAutomation(exact, boundary.signal))
        : createAutomationProposalResponse({
          requestId: exact.requestId,
          action: exact.action,
          status: "unavailable",
          summary: "The configured provider module has no observation-only automation proposal method."
        });
      const response = parseAutomationProposalResponse(raw, exact.requestId, exact.action);
      const after = await boundary.wait(this.port.observeSession(sessionRequestValue, boundary.signal));
      requireAutomationProposalSession(after, exact, this.mediationAttested, "after");
      if (before.adapterVersion !== after.adapterVersion) {
        throw new Error("The provider adapter identity changed during automation proposal observation.");
      }
      return response;
    } finally {
      boundary.dispose();
    }
  }

  async observeSession(request: ProviderGatewaySessionObservationRequest, signal: AbortSignal): Promise<ProviderGatewaySessionObservation> {
    this.exactProvider(request.provider);
    const observed = await this.port.observeSession(request, signal);
    requireSessionBinding(observed, request);
    const { repositoryRoot: _repositoryRoot, ...gatewayObservation } = observed;
    return { ...gatewayObservation, capabilities: truthfulCapabilities(gatewayObservation.capabilities, this.mediationAttested) };
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

  async reanchor(request: ProviderRuntimeReanchorRequest, signal: AbortSignal): Promise<ProviderRuntimeReanchorAcknowledgement> {
    this.exactProvider(request.provider);
    validateReanchorRequest(request);
    if (this.port.diagnosticOnly === true) throw new Error("The credential-free fixture cannot perform Re-anchor effects.");
    const beforeRequest = reanchorSessionRequest(request, "old");
    const before = await this.port.observeSession(beforeRequest, signal);
    requireReanchorSession(before, beforeRequest, "before");
    requireReanchorManagedObservation(before, request, truthfulCapabilities(before.capabilities, this.mediationAttested));
    const acknowledgement = normalizeReanchorAcknowledgement(await this.port.reanchor(request, signal), request);
    const afterRequest = reanchorSessionRequest(request, "new");
    const after = await this.port.observeSession(afterRequest, signal);
    requireReanchorSession(after, afterRequest, "after");
    requireReanchorManagedObservation(after, request, truthfulCapabilities(after.capabilities, this.mediationAttested));
    if (after.status === "running") throw new Error("The provider resumed the managed session after Re-anchor without authority.");
    if (before.adapterVersion !== after.adapterVersion) throw new Error("The provider adapter identity changed during Re-anchor.");
    return acknowledgement;
  }

  async observeReanchor(request: ProviderRuntimeReanchorRequest, signal: AbortSignal): Promise<ProviderRuntimeReanchorAcknowledgement | undefined> {
    this.exactProvider(request.provider);
    validateReanchorRequest(request);
    const observed = await this.port.observeReanchor(request, signal);
    if (!observed) return undefined;
    const acknowledgement = normalizeReanchorAcknowledgement(observed, request);
    const afterRequest = reanchorSessionRequest(request, "new");
    const after = await this.port.observeSession(afterRequest, signal);
    requireReanchorSession(after, afterRequest, "after");
    requireReanchorManagedObservation(after, request, truthfulCapabilities(after.capabilities, this.mediationAttested));
    if (after.status === "running") throw new Error("The observed Re-anchor operation resumed the managed session without authority.");
    return acknowledgement;
  }

  async observeOperation(request: ProviderGatewayOperationObservationRequest, signal: AbortSignal): Promise<ProviderGatewayOperationObservation> {
    requireProviderOwnedOperationRoute(request.routeId);
    const observed = this.mediation && mediatedOperation(request.routeId, request.action)
      ? await this.mediation.observeCommand(request, signal)
      : await this.port.observeOperation(request, signal);
    if (!sameOperation(observed, request) || !consistentOperationEffect(observed.outcome, observed.effectDisposition)) throw new Error("The provider operation observation changed its exact binding or effect disposition.");
    return observed;
  }

  async cancelOperation(request: ProviderGatewayCancellationRequest, signal: AbortSignal): Promise<ProviderGatewayCancellationAcknowledgement> {
    requireProviderOwnedOperationRoute(request.routeId);
    if (this.port.diagnosticOnly === true) throw new Error("The credential-free fixture has no cancellable effects.");
    const acknowledgement = this.mediation && mediatedOperation(request.routeId, request.action)
      ? await this.mediation.cancelCommand(request, signal)
      : await this.port.cancelOperation(request, signal);
    if (!sameOperation(acknowledgement, request)) {
      throw new Error("The provider cancellation response changed its exact binding.");
    }
    return acknowledgement;
  }

  async council(request: ProviderCouncilRequest, signal: AbortSignal): Promise<ProviderCouncilAcknowledgement> {
    if (this.port.diagnosticOnly === true) throw new Error("The credential-free fixture cannot acknowledge Council effects.");
    if (!this.mediationAttested) throw new Error("Automatic Council requires a host-attested Mediated provider runtime.");
    const mediated = this.mediation ? this.takeCouncilMediatedBinding(request) : undefined;
    try {
      const beforeRequest: ProviderGatewaySessionObservationRequest = {
        sessionId: request.sessionId,
        provider: this.provider,
        targetSnapshotId: request.targetSnapshotId,
        repositoryRoot: request.repositoryRoot
      };
      const observed = await this.port.observeSession(beforeRequest, signal);
      requireCouncilSession(observed, beforeRequest, "before");
      const acknowledgement = mediated
        ? await this.mediation!.executeCouncil(request, await this.prepareMediatedCouncilEffect(request, mediated, signal), mediated, signal)
        : await this.port.council(request, signal);
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
    const acknowledgement = this.mediation
      ? await this.mediation.observeCouncil(request, signal)
      : await this.port.observeCouncil(request, signal);
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

  private takeMediatedBinding(request: ProviderGatewayCommand): ProviderMediatedEffectBinding {
    return this.takeExactMediatedBinding({
      provider: request.provider, operationId: request.operationId, action: request.action, routeId: request.routeId,
      sessionId: request.sessionId, authorityId: request.authorityId, targetSnapshotId: request.targetSnapshotId, repositoryRoot: request.repositoryRoot
    });
  }

  private takeCouncilMediatedBinding(request: ProviderCouncilRequest): ProviderMediatedEffectBinding {
    return this.takeExactMediatedBinding({
      provider: this.provider, operationId: `council:${request.epochId}:${request.phase}`, action: `council_${request.phase}`,
      routeId: `council.${this.provider}`, sessionId: request.sessionId, targetSnapshotId: request.targetSnapshotId,
      repositoryRoot: request.repositoryRoot
    });
  }

  private takeExactMediatedBinding(expected: Readonly<{
    provider: ProviderGatewayProvider; operationId: string; action: string; routeId: string; sessionId: string;
    authorityId?: string; targetSnapshotId: string; repositoryRoot: string;
  }>): ProviderMediatedEffectBinding {
    const binding = this.pendingMediatedBindings.get(expected.operationId);
    if (!binding) throw new Error("The Mediated effect has no one-use consumed dispatch authorization.");
    this.pendingMediatedBindings.delete(expected.operationId);
    this.consumedMediatedAuthorizations.add(binding.authorizationId);
    const exact = binding.provider === expected.provider && binding.operationId === expected.operationId && binding.action === expected.action
      && binding.routeId === expected.routeId && binding.sessionId === expected.sessionId
      && (expected.authorityId === undefined || binding.authorityId === expected.authorityId)
      && binding.targetSnapshotId === expected.targetSnapshotId && rootKey(binding.repositoryRoot) === rootKey(expected.repositoryRoot);
    if (!exact) throw new Error("The provider mediation authorization does not match the exact command binding.");
    return binding;
  }

  private async prepareMediatedEffect(request: ProviderGatewayCommand, binding: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderRuntimeMediatedEffectIntent> {
    if (!this.port.prepareMediatedEffect) throw new Error("The provider module has no closed Mediated effect-intent contract.");
    const intent = await this.port.prepareMediatedEffect(request, binding, signal);
    requireMediatedIntent(intent, request, binding, "command");
    return intent;
  }

  private async prepareMediatedCouncilEffect(request: ProviderCouncilRequest, binding: ProviderMediatedEffectBinding, signal: AbortSignal): Promise<ProviderRuntimeMediatedCouncilIntent> {
    if (!this.port.prepareMediatedCouncilEffect) throw new Error("The provider module has no closed Mediated Council-intent contract.");
    const intent = await this.port.prepareMediatedCouncilEffect(request, binding, signal);
    requireMediatedIntent(intent, request, binding, "council");
    return intent;
  }
}

function mediatedOperation(routeId: string, action: string): boolean {
  if (!commandAction(action)) return false;
  return routeId === `provider.${action}` && providerEffectCapabilityFloor("workflow", action).includes("mediated");
}

function requireProviderOwnedCommand(request: ProviderGatewayCommand): asserts request is Extract<ProviderGatewayCommand, { readonly kind: "workflow" }> {
  if (request.kind === "automation" || request.routeId.startsWith("automation.")) {
    throw new Error("Provider-owned automation effects are disabled; only companion-owned execution and provider proposal observation are allowed.");
  }
}

function requireProviderOwnedOperationRoute(routeId: string): void {
  if (routeId.startsWith("automation.")) {
    throw new Error("Provider-owned automation observation, cancellation, and dispatch authorization are disabled and require companion-owned manual recovery.");
  }
}

const capabilityOrder = ["registered", "observable", "controllable", "mediated"] as const satisfies readonly Capability[];

/**
 * Derive the provider-host capability floor from the closed 65-command
 * catalog. Mediated is hierarchical and therefore requires all four host-
 * truthful capabilities; advisory actions retain their smaller exact floor.
 */
export function providerEffectCapabilityFloor(kind: "workflow" | "automation", action: unknown): readonly Capability[] {
  if (kind === "automation") throw new Error("Provider-owned automation effects are disabled; the provider host is proposal-only for automation.");
  if (!commandAction(action)) throw new Error(`The provider ${kind} action is not in the closed command catalog.`);
  const definition = commandForAction(action);
  const expectedExecutor = "agent";
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

export function providerReanchorArtifactBinding(request: ProviderRuntimeReanchorRequest): ProviderDispatchLeaseArtifactBinding {
  validateReanchorRequest(request);
  return Object.freeze({
    id: request.requestId,
    digest: request.artifactDigest,
    coordinatorContextDigest: null,
    coordinatorContextRevision: null
  });
}

export class ClaudeProviderAdapterBackend extends ExactProviderAdapterBackend {
  constructor(port: ProviderRuntimePort, identity?: ProviderAdapterIdentity, mediation?: ProviderMediatedEffectHostPort) { super("claude", port, identity, mediation); }
}

export class CodexProviderAdapterBackend extends ExactProviderAdapterBackend {
  constructor(port: ProviderRuntimePort, identity?: ProviderAdapterIdentity, mediation?: ProviderMediatedEffectHostPort) { super("codex", port, identity, mediation); }
}

export type ProviderAdapterBackend = ClaudeProviderAdapterBackend | CodexProviderAdapterBackend;

function requireAutomationProposalSession(
  observed: ProviderRuntimeSessionObservation,
  request: AutomationProposalRequest,
  mediationAttested: boolean,
  phase: "before" | "after"
): void {
  const expectedCapabilities = [...request.session.capabilities].sort();
  const observedCapabilities = [...truthfulCapabilities(observed.capabilities, mediationAttested)].sort();
  if (observed.sessionId !== request.session.id || observed.provider !== request.session.provider
    || observed.targetSnapshotId !== request.target.id || rootKey(observed.repositoryRoot) !== rootKey(request.target.repositoryRoot)
    || observed.status !== "running" || observed.adapterVersion !== request.session.adapterVersion
    || stableJson(observedCapabilities) !== stableJson(expectedCapabilities)) {
    throw new Error(`The provider automation proposal session changed its exact provider, target, status, capability, or adapter binding ${phase} observation.`);
  }
}

function fixtureAutomationProposal(request: AutomationProposalRequest): AutomationOperationProposal {
  const digest = (label: string): string => sha256(stableJson({
    schema: "sxsy-b122.fixture-automation-proposal-evidence",
    version: 1,
    action: request.action,
    label,
    requestId: request.requestId,
    sessionId: request.session.id,
    targetSnapshotId: request.target.id
  }));
  const mutation = (path: string, kind: "create" | "update", label: string): AutomationPathMutation => {
    const bytes = Buffer.from(`B122 diagnostic fixture: ${request.action}:${label}\n`, "utf8");
    return {
      path,
      mutation: kind,
      beforeDigest: kind === "create" ? null : digest(`${label}-before`),
      afterDigest: sha256(bytes.toString("utf8")),
      content: { encoding: "base64", byteLength: bytes.length, data: bytes.toString("base64") }
    };
  };
  switch (request.action) {
    case "compound_capture": {
      const document = mutation("docs/solutions/provider-host-proposal.md", "create", "capture-document");
      return {
        kind: request.action,
        solvedProblemEvidenceDigest: digest("solved-problem"),
        verifiedOutcomeEvidenceDigest: digest("verified-outcome"),
        nonTrivialRationale: "Fixture review material records one verified provider-host protocol outcome.",
        documents: [document],
        instructionFileMutation: { kind: "none" }
      };
    }
    case "compound_refresh": {
      const document = mutation("docs/solutions/provider-host-proposal.md", "update", "refresh-document");
      return {
        kind: request.action,
        audit: ["drift", "overlap", "supersession", "contradiction"],
        mutations: [document],
        commit: { planned: false }
      };
    }
    case "lfg": {
      const filesystemMutation = mutation("src/example.ts", "update", "lfg-mutation");
      return {
        kind: request.action,
        requirementsSources: [{ path: "docs/requirements.md", digest: digest("requirements") }],
        approvedScopePaths: ["src/example.ts"],
        mutations: [filesystemMutation],
        effectPlan: [
          { order: 0, kind: "plan", scopeDigest: digest("lfg-plan") },
          { order: 1, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([filesystemMutation]) },
          { order: 2, kind: "simplify", scopeDigest: digest("lfg-simplify") },
          { order: 3, kind: "review", scopeDigest: digest("lfg-review") },
          { order: 4, kind: "test", scopeDigest: digest("lfg-test") },
          { order: 5, kind: "git_commit", scopeDigest: digest("lfg-commit") },
          { order: 6, kind: "git_push", scopeDigest: digest("lfg-push") },
          { order: 7, kind: "pull_request", scopeDigest: digest("lfg-pull-request") },
          { order: 8, kind: "ci_watch", scopeDigest: digest("lfg-ci-watch") }
        ],
        authorizedActions: ["filesystem_mutation", "git_commit", "git_push", "pull_request", "ci_watch"],
        deployAuthorized: false
      };
    }
    case "repair_mission": {
      const filesystemMutation = mutation("src/example.ts", "update", "repair-mutation");
      const testEnvironmentDigest = digest("test-environment");
      const reproductionCommandDigest = digest("reproduction-command");
      return {
        kind: request.action,
        failingGateId: "fixture-gate",
        reproductionCommandDigest,
        approvedScopePaths: ["src/example.ts"],
        mutations: [filesystemMutation],
        affectedChecks: ["fixture-targeted-check"],
        fullChecks: ["fixture-full-check"],
        testEnvironment: { id: "fixture-test-environment", digest: testEnvironmentDigest, egress: "deny", databaseName: "b122_fixture_repair" },
        effectPlan: [
          { order: 0, kind: "sandbox_bind", scopeDigest: testEnvironmentDigest },
          { order: 1, kind: "reproduce", scopeDigest: reproductionCommandDigest },
          { order: 2, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([filesystemMutation]) },
          { order: 3, kind: "test_affected", scopeDigest: digest("repair-test-affected") },
          { order: 4, kind: "test_full", scopeDigest: digest("repair-test-full") },
          { order: 5, kind: "review_diff", scopeDigest: digest("repair-review-diff") }
        ],
        pushAuthorized: false,
        mergeAuthorized: false,
        deployAuthorized: false,
        hostedRerunAuthorized: false,
        productionDataAuthorized: false
      };
    }
  }
}

/** Credential-free deterministic runtime used only for loopback diagnostics and tests. */
export class FixtureProviderRuntimePort implements ProviderRuntimePort {
  readonly provider: ProviderGatewayProvider;
  readonly diagnosticOnly: boolean;
  executeCalls = 0;
  reanchorCalls = 0;
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
  private readonly reanchors = new Map<string, ProviderRuntimeReanchorAcknowledgement>();
  private nextStatus: ProviderGatewayRemoteResult["status"] = "completed";
  private malformed = false;
  private loseResponse = false;
  private loseCouncilResponse = false;
  private loseReanchorResponse = false;
  private afterCouncilObservationChange?: Partial<Readonly<{ repositoryRoot: string; targetSnapshotId: string; status: SessionStatus; capabilities: readonly Capability[] }>>;

  constructor(provider: ProviderGatewayProvider, options: Readonly<{ effectfulTestOnly?: boolean }> = {}) {
    this.provider = provider;
    this.diagnosticOnly = options.effectfulTestOnly !== true;
  }
  setNextStatus(status: ProviderGatewayRemoteResult["status"]): void { this.nextStatus = status; }
  malformedNextResponse(): void { this.malformed = true; }
  loseNextResponseAfterCommit(): void { this.loseResponse = true; }
  loseNextCouncilResponseAfterCommit(): void { this.loseCouncilResponse = true; }
  loseNextReanchorResponseAfterCommit(): void { this.loseReanchorResponse = true; }
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
    requireProviderOwnedCommand(request);
    if (this.diagnosticOnly) throw new Error("The credential-free fixture cannot execute provider work.");
    this.executeCalls += 1;
    const status = this.nextStatus;
    this.nextStatus = "completed";
    const disposition: EffectDisposition = status === "completed" ? "committed" : status === "running" ? "ambiguous" : "not_started";
    const response: ProviderGatewayCommandResult = request.child
      ? fixtureWorkflowChildResult(request, status, disposition)
      : {
        schema: "sxsy-b122.workflow-result", version: 1, artifactId: request.artifact.id,
        artifactDigest: request.artifact.digest, operationId: request.operationId, action: request.action,
        status: workflowStatus(status), effectDisposition: disposition,
        summary: `Fixture ${this.provider} provider ${status}.`, externalId: request.externalId,
        result: fixtureWorkflowResult(request)
      };
    this.operations.set(request.externalId, {
      operationId: request.operationId, externalId: request.externalId, routeId: request.routeId,
      action: request.action, sessionId: request.sessionId, authorityId: request.authorityId,
      targetSnapshotId: request.targetSnapshotId, repositoryRoot: request.repositoryRoot,
      outcome: status === "completed" ? "committed" : status === "running" ? "unresolved" : status === "cancelled" ? "cancelled" : "failed",
      effectDisposition: disposition,
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

  async proposeAutomation(request: AutomationProposalRequest, _signal: AbortSignal): Promise<AutomationProposalResponse> {
    const exact = parseAutomationProposalRequest(request, request.action);
    const session = this.sessions.get(exact.session.id);
    if (!session || session.repositoryRoot !== exact.target.repositoryRoot || session.targetSnapshotId !== exact.target.id
      || session.taskId !== exact.session.taskId || session.planRevision !== exact.session.planRevision
      || stableJson(session.plannedFiles) !== stableJson(exact.session.plannedFiles) || session.status !== "running") {
      return createAutomationProposalResponse({
        requestId: exact.requestId,
        action: exact.action,
        status: "blocked",
        summary: "The fixture provider session changed before proposal observation."
      });
    }
    return createAutomationProposalResponse({
      requestId: exact.requestId,
      action: exact.action,
      status: "completed",
      summary: `Fixture ${this.provider} produced bounded review material without starting an effect.`,
      proposal: fixtureAutomationProposal(exact)
    });
  }

  async observeSession(request: ProviderGatewaySessionObservationRequest, _signal?: AbortSignal): Promise<ProviderRuntimeSessionObservation> {
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

  async reanchor(request: ProviderRuntimeReanchorRequest, _signal?: AbortSignal): Promise<ProviderRuntimeReanchorAcknowledgement> {
    if (this.diagnosticOnly) throw new Error("The credential-free fixture cannot perform Re-anchor effects.");
    validateReanchorRequest(request);
    const session = this.sessions.get(request.sessionId);
    if (!session || session.repositoryRoot !== request.repositoryRoot || session.targetSnapshotId !== request.oldTargetSnapshotId) {
      throw new Error("The fixture Re-anchor session is no longer bound to the exact old target.");
    }
    this.reanchorCalls += 1;
    const acknowledgement: ProviderRuntimeReanchorAcknowledgement = {
      schema: "sxsy-b122.reanchor-acknowledgement",
      version: 1,
      requestId: request.requestId,
      operationId: request.operationId,
      externalEffectId: `fixture-reanchor:${sha256(stableJson({ requestId: request.requestId, operationId: request.operationId }))}`,
      sessionId: request.sessionId,
      authorityId: request.authorityId,
      oldTargetSnapshotId: request.oldTargetSnapshotId,
      newTargetSnapshotId: request.newTargetSnapshotId,
      cooperativeStopAcknowledged: true,
      resumed: false,
      artifactDigest: request.artifactDigest,
      rereadEvidence: request.rereadEvidence,
      report: {
        summary: "The fixture provider stopped, re-read, inspected, and reported without resuming.",
        discrepancies: [],
        risks: [],
        questions: [],
        result: "reanchored_without_resume"
      }
    };
    this.reanchors.set(request.operationId, acknowledgement);
    this.sessions.set(request.sessionId, { ...session, targetSnapshotId: request.newTargetSnapshotId, status: "verified_blocked" });
    if (this.loseReanchorResponse) {
      this.loseReanchorResponse = false;
      throw new Error("Fixture Re-anchor response was deliberately lost after commit.");
    }
    return acknowledgement;
  }

  async observeReanchor(request: ProviderRuntimeReanchorRequest, _signal?: AbortSignal): Promise<ProviderRuntimeReanchorAcknowledgement | undefined> {
    return this.reanchors.get(request.operationId);
  }

  async observeOperation(request: ProviderGatewayOperationObservationRequest): Promise<ProviderGatewayOperationObservation> {
    return this.operations.get(request.externalId) ?? { ...request, outcome: "unresolved", effectDisposition: "ambiguous", summary: "No exact fixture operation exists." };
  }

  async cancelOperation(request: ProviderGatewayCancellationRequest): Promise<ProviderGatewayCancellationAcknowledgement> {
    const operation = this.operations.get(request.externalId);
    const accepted = !!operation && sameOperation(operation, request);
    if (accepted) this.operations.set(request.externalId, { ...operation!, outcome: "unresolved", effectDisposition: "ambiguous", summary: "Fixture cancellation delivery is acknowledged, but the prior effect disposition is unresolved." });
    return { ...request, accepted, summary: accepted ? "Cancellation acknowledged." : "No exact operation exists." };
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

function reanchorSessionRequest(request: ProviderRuntimeReanchorRequest, target: "old" | "new"): ProviderGatewaySessionObservationRequest {
  return {
    sessionId: request.sessionId,
    provider: request.provider,
    targetSnapshotId: target === "old" ? request.oldTargetSnapshotId : request.newTargetSnapshotId,
    repositoryRoot: request.repositoryRoot
  };
}

function fixtureCoordinatorEvidence(request: ProviderRuntimeWorkflowContextRequest): CoordinatorEvidenceBundle {
  const planMaterial = {
    revision: request.planRevision,
    originSessionId: request.sessionId,
    taskId: request.taskId,
    objective: "Execute the exact protected plan.",
    steps: [{ id: "step-1", summary: "Inspect the target.", ownedFiles: ["src/example.ts"], dependencies: [], status: "approved" as const }],
    decisions: ["Use the exact target snapshot."],
    expectedTargetTransition: {
      beforeTargetSnapshotId: request.targetSnapshotId,
      expectedAfterTargetSnapshotId: request.targetSnapshotId,
      expectation: "unchanged" as const
    }
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
  action: CommandAction,
  when: "before" | "after"
): void {
  requireSessionBinding(observed, request);
  const capabilities = truthfulCapabilities(observed.capabilities, mediationAttested);
  const authorityRecovery = action === "authority_refresh" || action === "authority_broadcast";
  const statusAllowed = observed.status === "running" || (authorityRecovery && observed.status === "verified_blocked");
  if (!statusAllowed || !safeAdapterVersion(observed.adapterVersion)
    || !requiredCapabilities.every((capability) => capabilities.includes(capability))) {
    throw new Error(`Provider execution requires one fresh, ${authorityRecovery ? "running or verified-blocked" : "running"} exact session with ${requiredCapabilities.join(", ")} ${when} dispatch.`);
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

function requireReanchorSession(observed: ProviderRuntimeSessionObservation, request: ProviderGatewaySessionObservationRequest, when: "before" | "after"): void {
  requireSessionBinding(observed, request);
  if (!safeAdapterVersion(observed.adapterVersion) || !observed.capabilities.includes("registered") || !observed.capabilities.includes("controllable")
    || observed.status === "stale" || observed.status === "unreachable" || observed.status === "unknown") {
    throw new Error(`Re-anchor requires one live exact Controllable provider session ${when} the stop/report boundary.`);
  }
}

function requireReanchorManagedObservation(
  observed: ProviderRuntimeSessionObservation,
  request: ProviderRuntimeReanchorRequest,
  hostDerivedCapabilities: readonly Capability[]
): void {
  if (observed.adapterVersion !== request.session.adapterVersion
    || stableJson(hostDerivedCapabilities) !== stableJson(request.session.capabilities)) {
    throw new Error("The provider Re-anchor observation changed the protected ManagedSession adapter or capability binding.");
  }
}

function validateReanchorRequest(value: ProviderRuntimeReanchorRequest): void {
  if (!record(value) || !exactKeys(value, [
    "schema", "version", "provider", "requestId", "operationId", "sessionId", "authorityId", "repositoryRoot",
    "oldTargetSnapshotId", "newTargetSnapshotId", "reason", "previewDigest", "confirmationDigest", "artifactDigest",
    "session", "taskId", "planRevision", "plannedFiles", "authority", "oldTarget", "newTarget", "contextEvidence",
    "requiredRereads", "rereadEvidence", "confirmationScopeDigest", "cooperativeStopRequested", "resumeAuthorized"
  ]) || value.schema !== "sxsy-b122.provider-reanchor-request" || value.version !== 1
    || (value.provider !== "claude" && value.provider !== "codex") || !safeIdentifier(value.requestId)
    || !safeIdentifier(value.operationId) || !safeIdentifier(value.sessionId) || !safeIdentifier(value.authorityId)
    || !absoluteRoot(value.repositoryRoot) || !digest(value.oldTargetSnapshotId) || !digest(value.newTargetSnapshotId)
    || value.oldTargetSnapshotId === value.newTargetSnapshotId || !safeText(value.reason, 4_096)
    || !digest(value.previewDigest) || !digest(value.confirmationDigest) || !digest(value.confirmationScopeDigest) || !digest(value.artifactDigest)
    || !safeIdentifier(value.taskId) || !safeIdentifier(value.planRevision) || !relativePathList(value.plannedFiles, 512)
    || value.cooperativeStopRequested !== true || value.resumeAuthorized !== false) {
    throw new Error("The provider Re-anchor request is malformed or open-ended.");
  }
  requireReanchorManagedSession(value.session, value);
  requireCompleteReanchorTarget(value.oldTarget, value.oldTargetSnapshotId, value.repositoryRoot, "old");
  requireCompleteReanchorTarget(value.newTarget, value.newTargetSnapshotId, value.repositoryRoot, "new");
  requireReanchorAuthority(value.authority, value);
  let contextEvidence;
  try { contextEvidence = canonicalCoordinatorEvidence(value.contextEvidence); }
  catch { throw new Error("The provider Re-anchor context evidence is malformed or inconsistent."); }
  if (stableJson(contextEvidence) !== stableJson(value.contextEvidence)
    || contextEvidence.plan.originSessionId !== value.sessionId || contextEvidence.plan.taskId !== value.taskId
    || contextEvidence.plan.revision !== value.planRevision || contextEvidence.instructions.length < 1
    || contextEvidence.documentation.length < 1 || contextEvidence.files.length < 1 || contextEvidence.tests.length < 1) {
    throw new Error("The provider Re-anchor context evidence changed its exact session, task, plan, or required source binding.");
  }
  const planned = new Set(value.plannedFiles.map(pathKey));
  const contextPlanned = new Set(contextEvidence.plan.steps.flatMap((step) => step.ownedFiles).map(pathKey));
  if (planned.size !== contextPlanned.size || [...planned].some((path) => !contextPlanned.has(path))) {
    throw new Error("The provider Re-anchor planned-file binding differs from its protected context evidence.");
  }
  if (stableJson(value.requiredRereads) !== stableJson(reanchorRequiredRereads)) {
    throw new Error("The provider Re-anchor request omitted or changed a mandatory reread.");
  }
  const expectedReread = expectedReanchorRereadEvidence(value);
  if (stableJson(value.rereadEvidence) !== stableJson(expectedReread)) {
    throw new Error("The provider Re-anchor reread evidence does not bind the exact protected context, authority, and current work.");
  }
  const { schema: _schema, artifactDigest: _artifactDigest, ...applyMaterial } = value;
  if (reanchorApplyArtifactDigest(applyMaterial) !== value.artifactDigest) {
    throw new Error("The provider Re-anchor artifact digest does not cover its exact request, targets, context, authority, preview, and confirmation.");
  }
}

function requireReanchorManagedSession(
  value: unknown,
  request: Pick<ProviderRuntimeReanchorRequest, "provider" | "sessionId" | "repositoryRoot" | "oldTargetSnapshotId" | "taskId" | "planRevision" | "plannedFiles">
): asserts value is ManagedSession {
  const required = ["id", "provider", "surface", "capabilities", "status", "plannedFiles", "lastHeartbeat", "adapterVersion", "metadata"];
  const optional = ["workspaceRoot", "targetSnapshotId", "taskId", "planRevision"];
  if (!record(value) || !allowedKeys(value, required, optional)
    || value.id !== request.sessionId || value.provider !== request.provider
    || !["vscode_terminal", "vscode_window", "desktop", "browser", "bridge"].includes(String(value.surface))
    || !Array.isArray(value.capabilities) || value.capabilities.length > 4
    || !value.capabilities.every((capability) => capability === "registered" || capability === "observable" || capability === "controllable" || capability === "mediated")
    || new Set(value.capabilities).size !== value.capabilities.length
    || !value.capabilities.includes("registered") || !value.capabilities.includes("controllable")
    || (value.status !== "running" && value.status !== "verified_blocked" && value.status !== "verified_finished")
    || value.workspaceRoot !== request.repositoryRoot || value.targetSnapshotId !== request.oldTargetSnapshotId
    || value.taskId !== request.taskId || value.planRevision !== request.planRevision
    || !relativePathList(value.plannedFiles, 512) || stableJson(value.plannedFiles) !== stableJson(request.plannedFiles)
    || !isoTimestamp(value.lastHeartbeat) || !safeAdapterVersion(value.adapterVersion)
    || !record(value.metadata) || Object.keys(value.metadata).length > 256
    || !Object.entries(value.metadata).every(([key, item]) => safeMetadataText(key, 256) && safeMetadataText(item, 16_384))
    || value.metadata["sxsy-b122.providerHandshake"] !== "exact-route-v1"
    || value.metadata["sxsy-b122.providerHandshakeTarget"] !== request.oldTargetSnapshotId) {
    throw new Error("The provider Re-anchor ManagedSession is malformed or changed its exact protected binding.");
  }
}

function requireReanchorAuthority(value: unknown, request: ProviderRuntimeReanchorRequest): asserts value is AuthorityGrant {
  if (!record(value) || !allowedAuthorityKeys(value) || value.id !== request.authorityId
    || !absoluteRoot(value.repositoryRoot) || rootKey(value.repositoryRoot) !== rootKey(request.repositoryRoot)
    || value.sessionId !== request.sessionId || value.taskId !== request.taskId || value.planRevision !== request.planRevision
    || !Array.isArray(value.allowedActions) || !value.allowedActions.every(safeIdentifier) || !value.allowedActions.includes("reanchor")
    || !Array.isArray(value.prohibitedActions) || !value.prohibitedActions.every(safeIdentifier) || value.prohibitedActions.includes("reanchor")
    || !isoTimestamp(value.issuedAt) || !isoTimestamp(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
    || value.revokedAt !== undefined || !safeText(value.issuedBy, 512)) {
    throw new Error("The provider Re-anchor authority grant is malformed, revoked, or bound to another session, task, plan, or repository.");
  }
}

function allowedAuthorityKeys(value: Record<string, unknown>): boolean {
  const required = ["id", "repositoryRoot", "allowedActions", "prohibitedActions", "expiresAt", "issuedAt", "issuedBy"];
  const optional = ["sessionId", "taskId", "planRevision", "revokedAt"];
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function expectedReanchorRereadEvidence(request: ProviderRuntimeReanchorRequest): ReanchorProviderRereadEvidence {
  return Object.freeze({
    contextDigest: request.contextEvidence.contextDigest,
    authorityDigest: sha256(stableJson(request.authority)),
    instructionDigests: Object.freeze(request.contextEvidence.instructions.map((item) => item.digest)),
    planDigest: request.contextEvidence.plan.digest,
    documentationDigests: Object.freeze(request.contextEvidence.documentation.map((item) => item.digest)),
    currentWorkDigest: sha256(stableJson({
      diffDigest: request.contextEvidence.diff.digest,
      fileDigests: request.contextEvidence.files.map((item) => item.digest),
      testDigests: request.contextEvidence.tests.map((item) => item.digest),
      newTarget: request.newTarget
    })),
    inspectedTargetSnapshotId: request.newTargetSnapshotId
  });
}

function requireCompleteReanchorTarget(value: unknown, expectedId: string, repositoryRoot: string, label: "old" | "new"): asserts value is TargetSnapshot {
  if (!record(value) || !allowedTargetKeys(value) || !digest(value.id) || value.id !== expectedId || !absoluteRoot(value.repositoryRoot)
    || rootKey(value.repositoryRoot) !== rootKey(repositoryRoot) || !safeNullableText(value.canonicalRemote, 2_048)
    || !safeNullableText(value.branch, 240) || !safeNullableText(value.defaultBranch, 240) || (value.detached !== undefined && value.detached !== true)
    || !safeNullableText(value.upstream, 512) || !safeNullableText(value.head, 256) || !safeNullableText(value.indexTree, 256)
    || !digest(value.trackedManifest) || !digest(value.untrackedManifest) || !record(value.submodules)
    || Object.keys(value.submodules).length > 128 || !Object.entries(value.submodules).every(([path, revision]) => safeText(path, 512) && safeText(revision, 256))
    || !safeText(value.policyVersion, 256) || !digest(value.environmentFingerprint) || !isoTimestamp(value.capturedAt)
    || value.completeness !== "complete" || !Array.isArray(value.reasons) || value.reasons.length !== 0
    || targetSnapshotDigest(value as unknown as Omit<TargetSnapshot, "id" | "capturedAt">) !== value.id) {
    throw new Error(`The provider Re-anchor ${label} TargetSnapshot is incomplete, malformed, or has an invalid content identity.`);
  }
}

function allowedTargetKeys(value: Record<string, unknown>): boolean {
  const required = ["id", "repositoryRoot", "trackedManifest", "untrackedManifest", "submodules", "policyVersion", "environmentFingerprint", "capturedAt", "completeness", "reasons"];
  const optional = ["canonicalRemote", "branch", "defaultBranch", "detached", "upstream", "head", "indexTree"];
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function normalizeReanchorAcknowledgement(value: unknown, request: ProviderRuntimeReanchorRequest): ProviderRuntimeReanchorAcknowledgement {
  if (!record(value) || Buffer.byteLength(stableJson(value), "utf8") > 64 * 1024 || !exactKeys(value, [
    "schema", "version", "requestId", "operationId", "externalEffectId", "sessionId", "authorityId",
    "oldTargetSnapshotId", "newTargetSnapshotId", "cooperativeStopAcknowledged", "resumed", "artifactDigest", "rereadEvidence", "report"
  ]) || value.schema !== "sxsy-b122.reanchor-acknowledgement" || value.version !== 1
    || value.requestId !== request.requestId || value.operationId !== request.operationId || !safeIdentifier(value.externalEffectId)
    || value.sessionId !== request.sessionId || value.authorityId !== request.authorityId
    || value.oldTargetSnapshotId !== request.oldTargetSnapshotId || value.newTargetSnapshotId !== request.newTargetSnapshotId
    || value.cooperativeStopAcknowledged !== true || value.resumed !== false || value.artifactDigest !== request.artifactDigest
    || stableJson(value.rereadEvidence) !== stableJson(request.rereadEvidence)) {
    throw new Error("The provider Re-anchor acknowledgement changed its exact binding.");
  }
  return Object.freeze({
    schema: "sxsy-b122.reanchor-acknowledgement",
    version: 1,
    requestId: request.requestId,
    operationId: request.operationId,
    externalEffectId: value.externalEffectId,
    sessionId: request.sessionId,
    authorityId: request.authorityId,
    oldTargetSnapshotId: request.oldTargetSnapshotId,
    newTargetSnapshotId: request.newTargetSnapshotId,
    cooperativeStopAcknowledged: true,
    resumed: false,
    artifactDigest: request.artifactDigest,
    rereadEvidence: expectedReanchorRereadEvidence(request),
    report: normalizeReanchorReport(value.report)
  });
}

function normalizeReanchorReport(value: unknown): ReanchorPostStopReport {
  if (!record(value) || !exactKeys(value, ["summary", "discrepancies", "risks", "questions", "result"])
    || value.result !== "reanchored_without_resume" || !rawReportText(value.summary)
    || !rawReportList(value.discrepancies) || !rawReportList(value.risks) || !rawReportList(value.questions)) {
    throw new Error("The provider Re-anchor report is open, malformed, or unbounded.");
  }
  return Object.freeze({
    summary: redactReanchorReportText(value.summary),
    discrepancies: Object.freeze(value.discrepancies.map(redactReanchorReportText)),
    risks: Object.freeze(value.risks.map(redactReanchorReportText)),
    questions: Object.freeze(value.questions.map(redactReanchorReportText)),
    result: "reanchored_without_resume"
  });
}

function rawReportText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4_096 && !value.includes("\0");
}

function rawReportList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64 && value.every(rawReportText);
}

function redactReanchorReportText(value: string): string {
  return untrustedSummary(value, 512).replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]");
}

function safeNullableText(value: unknown, maximumLength: number): value is string | undefined {
  return value === undefined || safeText(value, maximumLength);
}

function isoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
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
  if (!record(value) || !exactKeys(value, ["digest", "revision", "originSessionId", "taskId", "objective", "steps", "decisions", "expectedTargetTransition"])
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
  const expectedTargetTransition = normalizeReviewedTargetTransition(value.expectedTargetTransition, request.targetSnapshotId);
  const normalized = Object.freeze({
    digest: value.digest,
    revision: value.revision,
    originSessionId: value.originSessionId,
    taskId: value.taskId,
    objective: value.objective.trim(),
    steps: Object.freeze(steps),
    decisions: Object.freeze(value.decisions.map((entry) => (entry as string).trim())),
    expectedTargetTransition
  });
  const { digest: _digest, ...material } = normalized;
  if (sha256(stableJson(material)) !== normalized.digest) throw new Error("The provider workflow-context plan digest is invalid.");
  return normalized;
}

function normalizeReviewedTargetTransition(value: unknown, beforeTargetSnapshotId: string): ExistingPlanBinding["expectedTargetTransition"] {
  if (!record(value) || !exactKeys(value, ["beforeTargetSnapshotId", "expectedAfterTargetSnapshotId", "expectation"])
    || value.beforeTargetSnapshotId !== beforeTargetSnapshotId || !digest(value.expectedAfterTargetSnapshotId)
    || (value.expectation !== "unchanged" && value.expectation !== "changed")
    || ((value.expectation === "unchanged") !== (value.expectedAfterTargetSnapshotId === beforeTargetSnapshotId))) {
    throw new Error("The provider workflow-context plan has an invalid reviewed expected TargetSnapshot transition.");
  }
  return Object.freeze({ beforeTargetSnapshotId, expectedAfterTargetSnapshotId: value.expectedAfterTargetSnapshotId, expectation: value.expectation });
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

function mediationBinding(value: ProviderDispatchLease): ProviderMediatedEffectBinding {
  const lease = parseProviderDispatchLease(value);
  const { authenticationTag: _authenticationTag, ...unsigned } = lease;
  const material = Object.freeze({
    schema: "sxsy-b122.provider-mediated-effect-binding" as const,
    version: 1 as const,
    configurationSha256: lease.host.configurationSha256,
    provider: lease.session.provider,
    adapterId: lease.module.adapterId,
    moduleSha256: lease.module.moduleSha256,
    leaseId: lease.leaseId,
    leaseDigest: sha256(stableJson(unsigned)),
    operationId: lease.dispatch.operationId,
    action: lease.dispatch.action,
    routeId: lease.dispatch.routeId,
    sessionId: lease.session.id,
    authorityId: lease.authority.id,
    targetSnapshotId: lease.target.id,
    repositoryRoot: lease.target.repositoryRoot,
    containmentBindingDigest: lease.containment.bindingDigest,
    containmentFenceEpoch: lease.containment.fenceEpoch
  });
  return Object.freeze({ ...material, authorizationId: sha256(stableJson(material)) });
}

function requireMediationAttestation(value: ProviderMediationAttestation, provider: ProviderGatewayProvider, identity: ProviderAdapterIdentity): void {
  if (!record(value) || !exactKeys(value, ["schema", "version", "configurationSha256", "provider", "adapterId", "moduleSha256", "driverModuleSha256", "effectPortId", "attestationDigest"])
    || value.schema !== "sxsy-b122.provider-mediation-attestation" || value.version !== 1 || !digest(value.configurationSha256)
    || value.provider !== provider || value.adapterId !== identity.adapterId || value.moduleSha256 !== identity.moduleSha256 || !digest(value.driverModuleSha256)
    || value.effectPortId !== "configured-provider-effect-port-v1" || !digest(value.attestationDigest)) {
    throw new Error("The configured provider mediation attestation does not match the exact host, provider, or module identity.");
  }
  const { attestationDigest, ...material } = value;
  if (sha256(stableJson(material)) !== attestationDigest) throw new Error("The configured provider mediation attestation digest is invalid.");
}

function requireMediationBinding(value: ProviderMediatedEffectBinding, attestation: ProviderMediationAttestation): void {
  if (!record(value) || !exactKeys(value, [
    "schema", "version", "authorizationId", "configurationSha256", "provider", "adapterId", "moduleSha256", "leaseId", "leaseDigest",
    "operationId", "action", "routeId", "sessionId", "authorityId", "targetSnapshotId", "repositoryRoot", "containmentBindingDigest", "containmentFenceEpoch"
  ]) || value.schema !== "sxsy-b122.provider-mediated-effect-binding" || value.version !== 1 || !digest(value.authorizationId)
    || value.configurationSha256 !== attestation.configurationSha256 || value.provider !== attestation.provider
    || value.adapterId !== attestation.adapterId || value.moduleSha256 !== attestation.moduleSha256
    || !safeIdentifier(value.leaseId) || !digest(value.leaseDigest) || !safeIdentifier(value.operationId)
    || !commandAction(value.action) && !/^council_(?:pause|assignment|resume)$/u.test(value.action)
    || !/^(?:provider|automation|council)\.[a-z0-9_.-]+$/u.test(value.routeId) || !safeIdentifier(value.sessionId)
    || !safeIdentifier(value.authorityId) || !digest(value.targetSnapshotId) || !absoluteRoot(value.repositoryRoot)
    || !digest(value.containmentBindingDigest) || !Number.isSafeInteger(value.containmentFenceEpoch) || value.containmentFenceEpoch < 0) {
    throw new Error("The provider mediation authorization binding is invalid or mismatched.");
  }
  const { authorizationId, ...material } = value;
  if (sha256(stableJson(material)) !== authorizationId) throw new Error("The provider mediation authorization binding digest is invalid.");
}

function requireFinalCurrentDecision(value: ProviderMediatedFinalCurrentDecision, binding: ProviderMediatedEffectBinding, now: Date): void {
  if (!record(value) || !exactKeys(value, [
    "schema", "version", "authorizationId", "leaseId", "operationId", "action", "sessionId", "authorityId", "targetSnapshotId",
    "repositoryRoot", "containmentBindingDigest", "containmentFenceEpoch", "challengeNonce", "allowed", "decidedAt", "expiresAt", "decisionDigest"
  ]) || value.schema !== "sxsy-b122.provider-mediated-final-current-decision" || value.version !== 1 || value.allowed !== true
    || value.authorizationId !== binding.authorizationId || value.leaseId !== binding.leaseId || value.operationId !== binding.operationId
    || value.action !== binding.action || value.sessionId !== binding.sessionId || value.authorityId !== binding.authorityId
    || value.targetSnapshotId !== binding.targetSnapshotId || rootKey(value.repositoryRoot) !== rootKey(binding.repositoryRoot)
    || value.containmentBindingDigest !== binding.containmentBindingDigest || value.containmentFenceEpoch !== binding.containmentFenceEpoch
    || !digest(value.challengeNonce) || !digest(value.decisionDigest)) {
    throw new Error("The companion final-current decision changed its exact provider effect binding.");
  }
  const decidedAt = Date.parse(value.decidedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const current = now.getTime();
  if (!Number.isFinite(current) || !Number.isFinite(decidedAt) || !Number.isFinite(expiresAt)
    || decidedAt > current || expiresAt <= current || expiresAt - decidedAt > 10_000) {
    throw new Error("The companion final-current decision is stale, future-issued, or overlong.");
  }
  const { decisionDigest, ...material } = value;
  if (sha256(stableJson(material)) !== decisionDigest) throw new Error("The companion final-current decision digest is invalid.");
}

function requireMediatedIntent(
  value: ProviderRuntimeMediatedEffectIntent | ProviderRuntimeMediatedCouncilIntent,
  request: ProviderGatewayCommand | ProviderCouncilRequest,
  binding: ProviderMediatedEffectBinding,
  kind: "command" | "council"
): void {
  const expectedSchema = kind === "command" ? "sxsy-b122.provider-mediated-effect-intent" : "sxsy-b122.provider-mediated-council-intent";
  const expectedOperation = kind === "command" ? "execute_exact_request" : "acknowledge_exact_phase";
  if (!record(value) || !exactKeys(value, ["schema", "version", "authorizationId", "requestDigest", "operation"])
    || value.schema !== expectedSchema || value.version !== 1 || value.authorizationId !== binding.authorizationId
    || value.requestDigest !== sha256(stableJson(request)) || value.operation !== expectedOperation) {
    throw new Error("The provider module returned an invalid, substituted, or unbounded Mediated effect intent.");
  }
}

function validateCommandResponse(request: ProviderGatewayCommand, response: ProviderGatewayCommandResult): void {
  requireProviderOwnedCommand(request);
  if (Buffer.byteLength(stableJson(response), "utf8") > 64 * 1024) throw new Error("The provider response is oversized.");
  if (response.externalId !== request.externalId) throw new Error("The provider response changed the external operation identity.");
  const now = new Date(0).toISOString();
  const artifact: WorkflowArtifact = {
    id: request.artifact.id, digest: request.artifact.digest, action: request.action,
    repositoryRoot: request.repositoryRoot, targetSnapshotId: request.targetSnapshotId,
    sessionId: request.artifact.sessionId ?? request.sessionId, ...(request.artifact.taskId ? { taskId: request.artifact.taskId } : {}),
    ...(request.artifact.planRevision ? { planRevision: request.artifact.planRevision } : {}),
    ...(request.artifact.authorityId ? { authorityId: request.artifact.authorityId } : {}),
    payload: request.artifact.payload, status: "submitted", operationId: request.child?.parentOperationId ?? request.operationId,
    executionAuthorized: false, createdAt: now, updatedAt: now
  };
  if (request.child) parseWorkflowChildProviderResponse(response, artifact, request.child.effect, request.operationId, request.child.role);
  else parseWorkflowProviderResponse(response, artifact);
}

function fixtureWorkflowChildResult(request: Extract<ProviderGatewayCommand, { kind: "workflow" }>, status: ProviderGatewayRemoteResult["status"], disposition: EffectDisposition): WorkflowChildProviderResponse {
  const child = request.child!;
  const terminalStatus: WorkflowChildProviderResponse["status"] = status === "completed" ? "completed" : status === "unavailable" ? "unavailable" : "failed";
  if (child.role === "proof_backend") return {
    schema: "sxsy-b122.workflow-child-result", version: 1, artifactId: request.artifact.id, artifactDigest: request.artifact.digest,
    parentOperationId: child.parentOperationId, childOperationId: request.operationId, action: request.action, role: child.role,
    bindingDigest: child.bindingDigest, provider: request.provider, adapterId: child.effect.adapterId, moduleSha256: child.effect.moduleSha256,
    status: terminalStatus, effectDisposition: status === "completed" ? "committed" : disposition === "committed" ? "ambiguous" : disposition,
    summary: `Fixture ${request.provider} independent proof ${status}.`, ...(status === "completed" ? { externalId: request.externalId } : {}),
    result: { kind: "proof_backend", backend: request.provider, status: status === "completed" ? "passed" : status === "unavailable" ? "unavailable" : "failed", verifiedClaims: status === "completed" && request.artifact.payload.kind === "proof" ? request.artifact.payload.claims : [], evidenceReferences: request.artifact.payload.kind === "proof" ? request.artifact.payload.evidence.tests.map((entry) => `${entry.id}:${entry.digest}:${entry.status}`) : [] }
  };
  if (status !== "completed" || request.artifact.payload.kind !== "authority") throw new Error("The fixture authority recipient did not acknowledge its exact packet.");
  const packet = request.artifact.payload.packets.find((candidate) => candidate.providerEffect?.bindingDigest === child.bindingDigest);
  if (!packet) throw new Error("The fixture authority recipient packet binding is missing.");
  return {
    schema: "sxsy-b122.workflow-child-result", version: 1, artifactId: request.artifact.id, artifactDigest: request.artifact.digest,
    parentOperationId: child.parentOperationId, childOperationId: request.operationId, action: request.action, role: child.role,
    bindingDigest: child.bindingDigest, provider: request.provider, adapterId: child.effect.adapterId, moduleSha256: child.effect.moduleSha256,
    status: "completed", effectDisposition: "committed", summary: `Fixture ${request.provider} recipient acknowledged its exact packet.`, externalId: request.externalId,
    result: { kind: "authority_recipient", recipientSessionId: packet.recipientSessionId, grantId: packet.grantId, matchDigest: packet.matchDigest, acknowledged: true }
  };
}

function fixtureWorkflowResult(request: Extract<ProviderGatewayCommand, { kind: "workflow" }>): WorkflowProviderResult {
  const payload = request.artifact.payload;
  switch (payload.kind) {
    case "anchor": return { kind: "anchor", anchorDigest: sha256(stableJson(payload)), discrepancies: [], questions: payload.unresolved, resumed: false };
    case "proof": return { kind: "proof", verifiedClaims: payload.claims, evidenceReferences: payload.evidence.tests.map((entry) => `${entry.id}:${entry.digest}:${entry.status}`), backendResults: payload.requiredBackends.map((backend) => ({ backend, status: "passed" as const })) };
    case "decision": return { kind: "decision", decisionPacketId: `fixture:${request.artifact.id}`, decisions: payload.decisions.map((decision) => ({ decisionId: decision.id, options: Array.from({ length: 5 }, (_, index) => ({ id: `${decision.id}:${index + 1}`, label: `Fixture option ${index + 1}`, tradeoffs: [`Tradeoff ${index + 1}`], risks: [`Risk ${index + 1}`] })), recommendationId: `${decision.id}:1` })), userSelectionRequired: true };
    case "plan": return payload.mode === "expand"
      ? { kind: "plan", mode: "expanded", planDigest: payload.plan.digest, alternatives: Array.from({ length: 15 }, (_, index) => ({ rank: index + 1, id: `fixture-alternative-${index + 1}`, summary: `Fixture alternative ${index + 1}`, rationale: "Credential-free deterministic fixture output.", risks: [] })) }
      : {
          kind: "plan", mode: "execution_ack", planDigest: payload.plan.digest, planRevision: payload.plan.revision,
          originSessionId: payload.plan.originSessionId, executorSessionId: payload.executorSessionId, authorityId: payload.authorityId,
          acknowledgementId: `fixture:${request.operationId}`, executionStarted: true,
          targetTransition: payload.plan.expectedTargetTransition,
          childEffects: [{
            id: `fixture-plan-child:${request.operationId}`,
            action: "plan_execution",
            status: "running",
            effectDisposition: "committed",
            summary: "The deterministic fixture accepted the exact plan and started one observable execution child.",
            externalId: `fixture:${request.operationId}`
          }]
        };
    case "handoff": return { kind: "handoff", packageId: payload.packageId, recipientSessionId: payload.recipientSessionId, acknowledged: true };
    case "focus": return { kind: "focus", selectedSessionId: payload.selectedSessionId, status: payload.expectedStatus, queueCycleId: payload.queueCycleId, resultDelivered: true };
    case "authority": return { kind: "authority", acknowledgements: payload.packets.map((packet) => ({ recipientSessionId: packet.recipientSessionId, grantId: packet.grantId, matchDigest: packet.matchDigest, acknowledged: true })) };
    case "voice_binding": return { kind: "voice_binding", bindingId: `fixture:${request.artifact.id}`, active: true };
  }
}

function workflowStatus(status: ProviderGatewayRemoteResult["status"]): Exclude<ProviderGatewayRemoteResult["status"], "cancelled" | "timed_out"> {
  return status === "cancelled" || status === "timed_out" ? "failed" : status;
}
function sameOperation(left: ProviderGatewayOperationObservationRequest, right: ProviderGatewayOperationObservationRequest): boolean {
  return left.operationId === right.operationId && left.externalId === right.externalId && left.routeId === right.routeId
    && left.action === right.action && left.sessionId === right.sessionId && left.authorityId === right.authorityId
    && left.targetSnapshotId === right.targetSnapshotId && rootKey(left.repositoryRoot) === rootKey(right.repositoryRoot);
}
function consistentOperationEffect(outcome: ProviderGatewayOperationObservation["outcome"], disposition: EffectDisposition): boolean {
  if (outcome === "unresolved") return disposition === "ambiguous";
  if (outcome === "committed") return disposition === "committed";
  return disposition !== "ambiguous";
}
function requireCouncilAcknowledgement(value: ProviderCouncilAcknowledgement, request: ProviderCouncilRequest): void { if (value.schema !== "sxsy-b122.council-ack" || value.version !== 1 || value.epochId !== request.epochId || value.phase !== request.phase || value.sessionId !== request.sessionId || value.targetSnapshotId !== request.targetSnapshotId || value.accepted !== true || value.assignmentDigest !== request.assignmentDigest || value.resourceHostDigest !== request.resourceHost?.digest) throw new Error("The provider Council acknowledgement changed its exact binding."); }
function councilRuntimeKey(value: ProviderCouncilRequest): string { return `${value.epochId}:${value.sessionId}:${value.phase}`; }
function rootKey(value: string): string { return portableRootKey(value); }
function remoteStatus(value: unknown): boolean { return value === "completed" || value === "unavailable" || value === "blocked" || value === "failed" || value === "awaiting_input" || value === "awaiting_confirmation" || value === "running" || value === "cancelled" || value === "timed_out"; }
function effectDisposition(value: unknown): boolean { return value === "not_started" || value === "committed" || value === "ambiguous" || value === "compensated"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  const allowed = new Set(keys);
  return actual.length === keys.length && actual.every((key) => allowed.has(key)) && keys.every((key) => Object.hasOwn(value, key));
}
function allowedKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function safeIdentifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value); }
function boundedIdentity(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value); }
function safeAdapterId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function safeAdapterVersion(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_.+-]{1,80}$/.test(value); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function sha40(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
function absoluteRoot(value: unknown): value is string { return exactPortableAbsoluteRoot(value); }
function safeBranch(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\0\r\n~^:?*\\\[]/.test(value); }
function boundedStringList(value: unknown, maximumItems: number, maximumLength: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= maximumItems && new Set(value).size === value.length
    && value.every((entry) => typeof entry === "string" && entry.trim().length > 0 && entry.length <= maximumLength && !/[\0\r\n]/.test(entry));
}
function safeText(value: unknown, maximumLength: number): value is string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > maximumLength || value.includes("\0")) return false;
  return redactText(value.trim()) === value.trim();
}
function safeMetadataText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength && !/[\0\r\n]/.test(value);
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
