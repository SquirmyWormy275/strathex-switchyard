import { isAbsolute } from "node:path";
import { realpath } from "node:fs/promises";

import { assignmentFor, controls, type Control, type Modifier } from "../../../packages/protocol/src/b122.ts";
import { commandActionIds, commandFor, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { GitMutation } from "../../../packages/control-plane/src/brokers.ts";
import type { HandoffPackage, HandoffPackageStore } from "../../../packages/control-plane/src/context-packages.ts";
import type { WorkflowArtifact, WorkflowArtifactAction, WorkflowArtifactPayload, WorkflowArtifactStore, WorkflowPreparationCoordinator, WorkflowPreparationIntent } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import type { VoiceBinding, VoiceConsent, VoiceCoordinator } from "../../../packages/control-plane/src/voice.ts";
import type { GitReviewResult, GitReviewWorkspace } from "./git-review.ts";
import type { RuntimePinCoordinator } from "./runtime-provisioning.ts";
import type { SandboxInstallationCoordinator } from "./sandbox-installation.ts";
import type { CredentialProvisioningCoordinator, NetworkPolicyCoordinator } from "./host-provisioning.ts";
import type { ProviderHandshakeCoordinator } from "./remote-adapters.ts";
import type { CouncilResourceBrokerPort } from "./council-resource-broker.ts";
import type { AttestedContainmentReleaseCoordinator } from "./containment-release.ts";
import type { DurableHardwareSignalInbox, HardwareSignalClaim, HardwareSignalClaimBinding, HardwareSignalCompletionOutcome } from "./hardware-signal-queue.ts";
import type { RawHidInstallationCoordinator, RawHidSupervisorStatus } from "./raw-hid-installation.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";
import type { GateEvidence } from "../../../packages/control-plane/src/acceptance-evidence.ts";
import type { WorkflowContextReview } from "../../../packages/control-plane/src/runtime.ts";
import type { AcceptanceAdministration, HighConsequenceActivation, InstalledAcceptanceTrust } from "./acceptance-administration.ts";
import type { InstalledScannerFixture, InstalledScannerFixtureTrust, ScannerFixtureAdministration } from "./scanner-fixtures.ts";
import { providerIds, type AttestedProviderDesktopRegistry, type ProviderId, type ProviderInstallation } from "./provider-desktop.ts";
import type {
  AuditEvent,
  Capability,
  CommandRequest,
  CommandResult,
  ManagedSession,
  SessionStatus
} from "../../../packages/control-plane/src/contracts.ts";
import {
  companionBridgeVersion,
  isRecord,
  type CompanionError,
  type CompanionRequest,
  type CompanionResponse,
  type DispatchPayload,
  type CommandPreparationPayload,
  type ConfirmationRequestPayload,
  type HostActionAuthorizationPayload,
  type HostActionCompletionPayload,
  type GitReviewPayload,
  type GitReviewInspectPayload,
  type RuntimePinInstallPayload,
  type RuntimePinRevokePayload,
  type SandboxInstallPayload,
  type SandboxRevokePayload,
  type CredentialProvisionPayload,
  type CredentialRevokePayload,
  type NetworkPolicyInstallPayload,
  type CouncilPortProxyPayload,
  type CouncilCredentialNetworkPayload,
  type AdministrationSourcePayload,
  type AcceptanceTrustRevokePayload,
  type AcceptanceEvidenceInvalidatePayload,
  type AcceptanceActivationPayload,
  type AcceptanceActivationRevokePayload,
  type ScannerTrustRevokePayload,
  type ScannerFixtureRevokePayload,
  type ProviderDesktopReferencePayload,
  type ProviderHandshakePayload,
  type ContainmentInspectionPayload,
  type ContainmentReleasePayload,
  type RawHidInstallPayload,
  type HardwareSignalBindingPayload,
  type HardwareSignalClaimPayload,
  type HardwareSignalPreparationPayload,
  type HardwareSignalDispatchPayload,
  type HardwareSignalCompletionPayload,
  type OperationCancellationPayload,
  type HandoffCreatePayload,
  type HandoffReferencePayload,
  type HandoffRoutingPayload,
  type WorkflowPreparePayload,
  type WorkflowCancelPayload,
  type VoiceConsentPayload,
  type VoiceStartPayload,
  type VoiceSwitchPayload,
  type VoiceBindingPayload,
  type VoiceReferencePayload,
  type SessionAdoptionPayload,
  type SessionHeartbeatPayload,
  type SessionRegistrationPayload,
  type SessionStatusPayload
} from "./bridge.ts";

/**
 * A mediator can be attached after it has a verified execution boundary.  The
 * default service deliberately has no executor, so a local JSON request can
 * never become a shell, Git, credential, network, or prompt operation.
 */
export interface MediatedCommandExecutor {
  execute(request: CommandRequest): Promise<CommandResult> | CommandResult;
}

/** Optional runtime capability; a transport cannot fabricate this route. */
export interface CancellableMediatedCommandExecutor extends MediatedCommandExecutor {
  cancelOperation(operationId: string, reason: string): Promise<CommandResult> | CommandResult;
}

export interface ConfirmationCapableMediatedCommandExecutor extends MediatedCommandExecutor {
  requestConfirmation(request: Readonly<{ action: CommandAction; sessionId?: string; authorityId?: string; reason: string }>): Promise<Readonly<{ status: string; summary: string; token?: string; expiresAt?: string }>>;
}

export interface CommandPreparationCapableMediatedCommandExecutor extends MediatedCommandExecutor {
  prepareCommand(request: Readonly<{ action: CommandAction; sessionId?: string; reason: string; reviewScopeDigest?: string }>): Promise<Readonly<{ status: "prepared" | "blocked" | "unavailable" | "incomplete"; summary: string; session?: ManagedSession; authorityId?: string; confirmationToken?: string; confirmationScopeDigest?: string; confirmationExpiresAt?: string; workflowReview?: WorkflowContextReview }>>;
}

export interface HostActionCompletionRecord {
  readonly hostActionId: string;
  readonly operationId: string;
  readonly action: CommandAction;
  readonly targetSnapshotId?: string;
  readonly status: "completed" | "failed" | "incomplete";
  readonly summary: string;
  /** Host-action idempotency evidence; deliberately not eligible for gate receipts. */
  readonly completionDigest?: string;
  readonly completedAt: string;
}

export interface VoiceRuntimeCoordinator {
  open(bindingId: string): Promise<void>;
  switchProvider(bindingId: string, input: Readonly<{ consentId: string; voiceSessionId: string }>): Promise<VoiceBinding>;
  bindManagedSession(bindingId: string, managedSessionId: string): Promise<VoiceBinding>;
  mute(bindingId: string): Promise<VoiceBinding>;
  resume(bindingId: string): Promise<VoiceBinding>;
  interrupt(bindingId: string, reason: string): Promise<VoiceBinding>;
  end(bindingId: string): Promise<VoiceBinding>;
  deleteTranscript(bindingId: string): Promise<VoiceBinding>;
}

export interface HostActionCoordinator {
  authorize(payload: HostActionAuthorizationPayload): Promise<Readonly<{ hostActionId: string; authorizationToken: string; expiresAt: string; selectionId?: string; url?: string }>>;
  settle(payload: HostActionCompletionPayload): Promise<HostActionCompletionRecord>;
}

export interface GitMutationReviewCoordinator {
  inspect(sessionId: string): Promise<GitReviewWorkspace>;
  review(payload: GitReviewPayload): Promise<GitReviewResult>;
}

export interface ExternalCompletionCapableMediatedCommandExecutor extends MediatedCommandExecutor {
  completeExternalOperation(record: HostActionCompletionRecord): Promise<CommandResult>;
}

export interface CompanionServiceOptions {
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly executor?: MediatedCommandExecutor;
  readonly hostActions?: HostActionCoordinator;
  readonly gitReviews?: GitMutationReviewCoordinator;
  readonly runtimePins?: RuntimePinCoordinator;
  readonly sandboxInstallations?: SandboxInstallationCoordinator;
  readonly credentialProvisioning?: CredentialProvisioningCoordinator;
  readonly networkPolicyProvisioning?: NetworkPolicyCoordinator;
  readonly councilResources?: CouncilResourceBrokerPort;
  readonly acceptanceAdministration?: Pick<AcceptanceAdministration, "installTrustPolicy" | "listTrust" | "revokeTrust" | "importEvidence" | "listEvidence" | "invalidateEvidence" | "activate" | "listActivations" | "revokeActivation">;
  readonly scannerAdministration?: ScannerFixtureAdministration;
  readonly providerDesktopRegistry?: Pick<AttestedProviderDesktopRegistry, "install" | "list" | "revoke">;
  readonly providerHandshakes?: ProviderHandshakeCoordinator;
  readonly containmentRelease?: AttestedContainmentReleaseCoordinator;
  readonly rawHidInstallations?: RawHidInstallationCoordinator;
  readonly rawHidSupervisor?: Readonly<{ startConfigured(): Promise<RawHidSupervisorStatus>; stop(): Promise<void>; status(): RawHidSupervisorStatus }>;
  readonly hardwareSignals?: DurableHardwareSignalInbox;
  readonly handoffs?: HandoffPackageStore;
  readonly workflowArtifacts?: WorkflowArtifactStore;
  readonly workflowCoordinator?: WorkflowPreparationCoordinator;
  readonly voice?: VoiceCoordinator;
  readonly voiceRuntime?: VoiceRuntimeCoordinator;
  readonly voicePresence?: WindowsUserPresenceRunner;
  readonly canonicalizeHostPath?: (value: string) => Promise<string>;
  /**
   * Only a trusted adapter handshake may provide this callback.  A plain
   * JSON-lines registration is deliberately normalized to Registered.
   */
  readonly verifyCapabilities?: (session: ManagedSession) => readonly Capability[];
}

/**
 * Companion-facing session and intent service. It is a real local control
 * plane endpoint, but intentionally not an execution boundary on its own.
 * Persistent stores, receipts, and brokers attach through the executor rather
 * than by making this transport trust client-provided state.
 */
export class CompanionService {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly adoptionKeys = new Map<string, string>();
  private readonly audit: AuditEvent[] = [];
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly executor?: MediatedCommandExecutor;
  private readonly hostActions?: HostActionCoordinator;
  private readonly gitReviews?: GitMutationReviewCoordinator;
  private readonly runtimePins?: RuntimePinCoordinator;
  private readonly sandboxInstallations?: SandboxInstallationCoordinator;
  private readonly credentialProvisioning?: CredentialProvisioningCoordinator;
  private readonly networkPolicyProvisioning?: NetworkPolicyCoordinator;
  private readonly councilResources?: CouncilResourceBrokerPort;
  private readonly acceptanceAdministration?: CompanionServiceOptions["acceptanceAdministration"];
  private readonly scannerAdministration?: ScannerFixtureAdministration;
  private readonly providerDesktopRegistry?: CompanionServiceOptions["providerDesktopRegistry"];
  private readonly providerHandshakes?: ProviderHandshakeCoordinator;
  private readonly containmentRelease?: AttestedContainmentReleaseCoordinator;
  private readonly rawHidInstallations?: RawHidInstallationCoordinator;
  private readonly rawHidSupervisor?: Readonly<{ startConfigured(): Promise<RawHidSupervisorStatus>; stop(): Promise<void>; status(): RawHidSupervisorStatus }>;
  private readonly hardwareSignals?: DurableHardwareSignalInbox;
  private readonly handoffs?: HandoffPackageStore;
  private readonly workflowArtifacts?: WorkflowArtifactStore;
  private readonly workflowCoordinator?: WorkflowPreparationCoordinator;
  private readonly voice?: VoiceCoordinator;
  private readonly voiceRuntime?: VoiceRuntimeCoordinator;
  private readonly voicePresence?: WindowsUserPresenceRunner;
  private readonly canonicalizeHostPath: (value: string) => Promise<string>;
  private readonly verifyCapabilities?: (session: ManagedSession) => readonly Capability[];

  constructor(options: CompanionServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => `audit-${crypto.randomUUID()}`);
    this.executor = options.executor;
    this.hostActions = options.hostActions;
    this.gitReviews = options.gitReviews;
    this.runtimePins = options.runtimePins;
    this.sandboxInstallations = options.sandboxInstallations;
    this.credentialProvisioning = options.credentialProvisioning;
    this.networkPolicyProvisioning = options.networkPolicyProvisioning;
    this.councilResources = options.councilResources;
    this.acceptanceAdministration = options.acceptanceAdministration;
    this.scannerAdministration = options.scannerAdministration;
    this.providerDesktopRegistry = options.providerDesktopRegistry;
    this.providerHandshakes = options.providerHandshakes;
    this.containmentRelease = options.containmentRelease;
    this.rawHidInstallations = options.rawHidInstallations;
    this.rawHidSupervisor = options.rawHidSupervisor;
    this.hardwareSignals = options.hardwareSignals;
    this.handoffs = options.handoffs;
    this.workflowArtifacts = options.workflowArtifacts;
    this.workflowCoordinator = options.workflowCoordinator;
    this.voice = options.voice;
    this.voiceRuntime = options.voiceRuntime;
    this.voicePresence = options.voicePresence;
    this.canonicalizeHostPath = options.canonicalizeHostPath ?? realpath;
    this.verifyCapabilities = options.verifyCapabilities;
  }

  async handle(request: CompanionRequest): Promise<CompanionResponse> {
    if (request.version !== companionBridgeVersion) {
      return this.failure(request.id, "unsupported_version", "Unsupported SXSY-B122 companion protocol version.");
    }

    try {
      switch (request.method) {
        case "ping":
          return this.success(request.id, { state: "ready", version: companionBridgeVersion });
        case "session.register":
        case "terminal.register":
        case "debug.register":
          return this.success(request.id, this.register(this.requireRegistration(request.payload)));
        case "session.adopt":
        case "terminal.adopt":
          return this.success(request.id, this.adopt(this.requireAdoption(request.payload)));
        case "session.status":
          return this.success(request.id, this.setStatus(this.requireStatus(request.payload)));
        case "session.heartbeat":
          return this.success(request.id, this.heartbeat(this.requireHeartbeat(request.payload)));
        case "session.list":
          return this.success(request.id, this.listSessions());
        case "command.dispatch":
          return this.success(request.id, { command: await this.dispatch(this.requireDispatch(request.payload)) });
        case "operation.cancel":
          return this.success(request.id, { command: await this.cancelOperation(this.requireCancellation(request.payload)) });
        case "command.prepare":
          return this.success(request.id, { preparation: await this.prepareCommand(this.requireCommandPreparation(request.payload)) });
        case "confirmation.request":
          return this.success(request.id, { confirmation: await this.requestConfirmation(this.requireConfirmation(request.payload)) });
        case "git.review.submit":
          return this.success(request.id, { review: await this.reviewGitMutation(this.requireGitReview(request.payload)) });
        case "git.review.inspect":
          return this.success(request.id, { workspace: await this.inspectGitReview(this.requireGitReviewInspect(request.payload)) });
        case "runtime.pin.install":
          return this.success(request.id, { pin: await this.installRuntimePin(this.requireRuntimePinInstall(request.payload)) });
        case "runtime.pin.list":
          return this.success(request.id, { pins: await this.listRuntimePins(request.payload) });
        case "runtime.pin.revoke":
          return this.success(request.id, { pin: await this.revokeRuntimePin(this.requireRuntimePinRevoke(request.payload)) });
        case "sandbox.install":
          return this.success(request.id, { installation: await this.installSandbox(this.requireSandboxInstall(request.payload)) });
        case "sandbox.list":
          return this.success(request.id, { installations: await this.listSandboxes(request.payload) });
        case "sandbox.revoke":
          return this.success(request.id, { installation: await this.revokeSandbox(this.requireSandboxRevoke(request.payload)) });
        case "credential.provision":
          return this.success(request.id, { credential: await this.provisionCredential(this.requireCredentialProvision(request.payload)) });
        case "credential.list":
          return this.success(request.id, { credentials: await this.listCredentials(request.payload) });
        case "credential.revoke":
          return this.success(request.id, { revoked: await this.revokeCredential(this.requireCredentialRevoke(request.payload)) });
        case "network-policy.install":
          return this.success(request.id, { policy: await this.installNetworkPolicy(this.requireNetworkPolicyInstall(request.payload)) });
        case "network-policy.current":
          return this.success(request.id, { policy: await this.currentNetworkPolicy(request.payload) });
        case "network-policy.revoke":
          return this.success(request.id, { policy: await this.revokeNetworkPolicy(request.payload) });
        case "council.port-proxy.activate":
          return this.success(request.id, { receipt: await this.activateCouncilPortProxy(this.requireCouncilPortProxy(request.payload)) });
        case "council.credential-network.execute":
          return this.success(request.id, { receipt: await this.executeCouncilCredentialNetwork(this.requireCouncilCredentialNetwork(request.payload)) });
        case "acceptance.trust.install": return this.success(request.id, { trust: await this.installAcceptanceTrust(this.requireAdministrationSource(request.payload, "Acceptance trust installation")) });
        case "acceptance.trust.list": return this.success(request.id, { trust: await this.listAcceptanceTrust(request.payload) });
        case "acceptance.trust.revoke": return this.success(request.id, { trust: await this.revokeAcceptanceTrust(this.requireAcceptanceTrustRevoke(request.payload)) });
        case "acceptance.evidence.import": return this.success(request.id, { evidence: await this.importAcceptanceEvidence(this.requireAdministrationSource(request.payload, "Acceptance evidence import")) });
        case "acceptance.evidence.list": return this.success(request.id, { evidence: await this.listAcceptanceEvidence(request.payload) });
        case "acceptance.evidence.invalidate": return this.success(request.id, { invalidated: await this.invalidateAcceptanceEvidence(this.requireAcceptanceEvidenceInvalidate(request.payload)) });
        case "acceptance.activation.activate": return this.success(request.id, { activation: await this.activateHighConsequence(this.requireAcceptanceActivation(request.payload)) });
        case "acceptance.activation.list": return this.success(request.id, { activations: await this.listHighConsequenceActivations(request.payload) });
        case "acceptance.activation.revoke": return this.success(request.id, { revoked: await this.revokeHighConsequenceActivation(this.requireAcceptanceActivationRevoke(request.payload)) });
        case "scanner.trust.install": return this.success(request.id, { trust: await this.installScannerTrust(this.requireAdministrationSource(request.payload, "Scanner trust installation")) });
        case "scanner.trust.list": return this.success(request.id, { trust: await this.listScannerTrust(request.payload) });
        case "scanner.trust.revoke": return this.success(request.id, { revoked: await this.revokeScannerTrust(this.requireScannerTrustRevoke(request.payload)) });
        case "scanner.fixture.install": return this.success(request.id, { fixture: await this.installScannerFixture(this.requireAdministrationSource(request.payload, "Scanner fixture installation")) });
        case "scanner.fixture.list": return this.success(request.id, { fixtures: await this.listScannerFixtures(request.payload) });
        case "scanner.fixture.revoke": return this.success(request.id, { revoked: await this.revokeScannerFixture(this.requireScannerFixtureRevoke(request.payload)) });
        case "provider-desktop.install": return this.success(request.id, { installation: await this.installProviderDesktop(this.requireProviderDesktopReference(request.payload)) });
        case "provider-desktop.list": return this.success(request.id, { installations: await this.listProviderDesktops(request.payload) });
        case "provider-desktop.revoke": return this.success(request.id, { installation: await this.revokeProviderDesktop(this.requireProviderDesktopReference(request.payload)) });
        case "provider.handshake":
          return this.success(request.id, await this.providerHandshake(this.requireProviderHandshake(request.payload)));
        case "containment.inspect":
          return this.success(request.id, { containment: await this.inspectContainment(this.requireContainmentInspection(request.payload)) });
        case "containment.release":
          return this.success(request.id, { command: await this.releaseContainment(this.requireContainmentRelease(request.payload)) });
        case "raw-hid.install":
          return this.success(request.id, await this.installRawHid(this.requireRawHidInstall(request.payload)));
        case "raw-hid.list":
          return this.success(request.id, { installations: await this.listRawHid(request.payload) });
        case "raw-hid.revoke":
          return this.success(request.id, { installation: await this.revokeRawHid(request.payload) });
        case "raw-hid.status":
          return this.success(request.id, await this.rawHidStatus(request.payload));
        case "hardware-signal.claim":
          return this.success(request.id, { claim: await this.claimHardwareSignal(this.requireHardwareSignalClaim(request.payload)) });
        case "hardware-signal.prepare":
          return this.success(request.id, await this.prepareHardwareSignal(this.requireHardwareSignalPreparation(request.payload)));
        case "hardware-signal.dispatch":
          return this.success(request.id, await this.dispatchHardwareSignal(this.requireHardwareSignalDispatch(request.payload)));
        case "hardware-signal.complete":
          return this.success(request.id, { completion: await this.completeHardwareSignal(this.requireHardwareSignalCompletion(request.payload)) });
        case "host-action.authorize":
          return this.success(request.id, { authorization: await this.authorizeHostAction(this.requireHostActionAuthorization(request.payload)) });
        case "host-action.complete":
          return this.success(request.id, { command: await this.completeHostAction(this.requireHostActionCompletion(request.payload)) });
        case "handoff.create": return this.success(request.id, { handoff: await this.createHandoff(this.requireHandoffCreate(request.payload)) });
        case "handoff.list": return this.success(request.id, { handoffs: await this.listHandoffs(request.payload) });
        case "handoff.acknowledge": return this.success(request.id, { handoff: await this.acknowledgeHandoff(this.requireHandoffReference(request.payload, true)) });
        case "handoff.cancel": return this.success(request.id, { handoff: await this.cancelHandoff(this.requireHandoffReference(request.payload, false)) });
        case "handoff.archive": return this.success(request.id, { handoff: await this.archiveHandoff(this.requireHandoffReference(request.payload, false)) });
        case "handoff.routing.get": return this.success(request.id, { routing: await this.handoffRouting(request.payload) });
        case "handoff.routing.set": return this.success(request.id, { routing: await this.setHandoffRouting(this.requireHandoffRouting(request.payload)) });
        case "workflow.prepare": return this.success(request.id, { artifact: await this.prepareWorkflowArtifact(this.requireWorkflowPrepare(request.payload)) });
        case "workflow.cancel": return this.success(request.id, { artifact: await this.cancelWorkflowArtifact(this.requireWorkflowCancel(request.payload)) });
        case "workflow.list": return this.success(request.id, { artifacts: await this.listWorkflowArtifacts(request.payload) });
        case "voice.consent": return this.success(request.id, { consent: await this.grantVoiceConsent(this.requireVoiceConsent(request.payload)) });
        case "voice.start": return this.success(request.id, { binding: await this.startVoice(this.requireVoiceStart(request.payload)) });
        case "voice.current": return this.success(request.id, { binding: await this.currentVoice(request.payload) });
        case "voice.switch": return this.success(request.id, { binding: await this.switchVoice(this.requireVoiceSwitch(request.payload)) });
        case "voice.bind": return this.success(request.id, { binding: await this.bindVoice(this.requireVoiceBinding(request.payload)) });
        case "voice.mute": return this.success(request.id, { binding: await this.muteVoice(this.requireVoiceReference(request.payload, false)) });
        case "voice.resume": return this.success(request.id, { binding: await this.resumeVoice(this.requireVoiceReference(request.payload, false)) });
        case "voice.interrupt": return this.success(request.id, { binding: await this.interruptVoice(this.requireVoiceReference(request.payload, true)) });
        case "voice.end": return this.success(request.id, { binding: await this.endVoice(this.requireVoiceReference(request.payload, false)) });
        case "voice.transcript.delete": return this.success(request.id, { binding: await this.deleteVoiceTranscript(this.requireVoiceReference(request.payload, false)) });
        default:
          return this.failure(request.id, "unknown_method", "Unknown SXSY-B122 companion method.");
      }
    } catch (error) {
      if (error instanceof CompanionServiceError) return this.failure(request.id, error.code, error.message);
      // Never send a stack, input, terminal output, or secret-bearing error across the bridge.
      return this.failure(request.id, "invalid_request", "The local companion rejected this request.");
    }
  }

  listSessions(): readonly ManagedSession[] {
    return [...this.sessions.values()].map((session) => cloneSession(session));
  }

  /**
   * Restores a session only from the host-owned protected registry during
   * companion startup. JSON-lines clients never call this method and cannot
   * preserve or invent a capability by re-registering a known ID.
   */
  installTrustedSession(session: ManagedSession): void {
    const trusted = cloneSession(session);
    if (!trusted.capabilities.includes("registered")) {
      throw new CompanionServiceError("capability_denied", "A restored session must have a verified Registered capability.");
    }
    this.sessions.set(trusted.id, trusted);
    const adoptionKey = trusted.metadata["sxsy-b122.adoptionKey"];
    if (adoptionKey) this.adoptionKeys.set(adoptionKey, trusted.id);
  }

  listAuditEvents(): readonly AuditEvent[] {
    return this.audit.map((event) => ({ ...event }));
  }

  private register(payload: SessionRegistrationPayload): ManagedSession {
    const incoming = parseManagedSession(payload.session);
    const existing = this.sessions.get(incoming.id);
    const verifiedCapabilities = this.verifyCapabilities
      ? normalizeCapabilities(this.verifyCapabilities(incoming))
      : ["registered"] as const;
    const capabilities: readonly Capability[] = verifiedCapabilities.includes("registered")
      ? verifiedCapabilities
      : ["registered", ...verifiedCapabilities] as readonly Capability[];
    const previousMetadata = existing?.metadata ?? {};
    const metadata = {
      ...previousMetadata,
      ...incoming.metadata,
      "sxsy-b122.registration": "registered"
    };
    const next: ManagedSession = {
      ...incoming,
      capabilities,
      // A JSON caller may identify a surface but cannot assert that it is
      // observable, controllable, mediated, running, blocked, or finished.
      // Re-registration deliberately resets rather than retaining a prior
      // trusted capability by a known session ID.
      status: "unknown",
      lastHeartbeat: this.now(),
      metadata
    };
    this.sessions.set(next.id, next);
    this.record("session.register", "completed", `Registered ${next.surface} session without implying mediation.`, next.id);
    return cloneSession(next);
  }

  private adopt(payload: SessionAdoptionPayload): ManagedSession {
    const session = this.requireSession(payload.sessionId);
    const existingAdoption = this.adoptionKeys.get(payload.adoptionKey);
    const reservedKey = session.metadata["sxsy-b122.adoptionKey"];
    if ((existingAdoption && existingAdoption !== session.id)
      || session.metadata["sxsy-b122.adoptedAt"]
      || (reservedKey && reservedKey !== payload.adoptionKey)) {
      throw new CompanionServiceError("already_adopted", "This terminal has already been adopted; its capabilities were not changed.");
    }
    const next: ManagedSession = {
      ...session,
      provider: payload.provider,
      // Adoption is only naming/binding. It must never manufacture a provider
      // handshake, heartbeat, authority grant, or mediated capability.
      capabilities: session.capabilities,
      status: session.status,
      lastHeartbeat: this.now(),
      metadata: {
        ...session.metadata,
        "sxsy-b122.adoptionKey": payload.adoptionKey,
        "sxsy-b122.adoptedAt": this.now()
      }
    };
    this.adoptionKeys.set(payload.adoptionKey, session.id);
    this.sessions.set(session.id, next);
    this.record("session.adopt", "completed", "Adopted a terminal as Registered only; no capability was elevated.", session.id);
    return cloneSession(next);
  }

  private setStatus(payload: SessionStatusPayload): ManagedSession {
    const session = this.requireSession(payload.sessionId);
    if (session.metadata["sxsy-b122.providerHandshake"] === "exact-route-v1") throw new CompanionServiceError("capability_denied", "Provider status is host-observed through its exact adapter boundary; an extension request cannot replace it.");
    if ((payload.status === "verified_blocked" || payload.status === "verified_finished") && !session.capabilities.includes("observable")) {
      throw new CompanionServiceError("capability_denied", "Verified blocked or finished status requires an Observable adapter signal.");
    }
    const next: ManagedSession = { ...session, status: payload.status, lastHeartbeat: this.now() };
    this.sessions.set(session.id, next);
    this.record("session.status", "completed", `Recorded session status as ${payload.status}.`, session.id);
    return cloneSession(next);
  }

  private heartbeat(payload: SessionHeartbeatPayload): ManagedSession {
    const session = this.requireSession(payload.sessionId);
    if (session.metadata["sxsy-b122.providerHandshake"] === "exact-route-v1") throw new CompanionServiceError("capability_denied", "Provider liveness is host-observed through its exact adapter boundary; an extension heartbeat cannot extend it.");
    const hostNow = Date.parse(this.now()); const at = payload.at ?? new Date(hostNow).toISOString(); const observed = Date.parse(at);
    if (!Number.isFinite(hostNow) || !Number.isFinite(observed) || observed < Date.parse(session.lastHeartbeat) || observed > hostNow + 30_000) throw new CompanionServiceError("invalid_request", "The session heartbeat is invalid, out of order, or too far in the future.");
    const next: ManagedSession = { ...session, lastHeartbeat: at };
    this.sessions.set(session.id, next);
    this.record("session.heartbeat", "completed", "Recorded a session heartbeat.", session.id);
    return cloneSession(next);
  }

  private async dispatch(payload: DispatchPayload): Promise<CommandResult> {
    const assignment = assignmentFor(payload.control, payload.modifier);
    if (!assignment) {
      const result: CommandResult = {
        status: "unavailable",
        summary: "This B122 chord is intentionally unassigned and was not routed."
      };
      this.record("command.dispatch", result.status, result.summary, payload.sessionId);
      return result;
    }

    if (!this.executor) {
      const result: CommandResult = {
        status: assignment.capability === "disabled_pending_gates" ? "blocked" : "unavailable",
        summary: assignment.capability === "disabled_pending_gates"
          ? "This high-consequence B122 control remains disabled until the durable policy executor evaluates its acceptance gates."
          : "No durable policy executor is attached; this command was not reported as completed and no host action was requested."
      };
      this.record("command.dispatch", result.status, result.summary, payload.sessionId);
      return result;
    }

    // Every settled assignment, including route-only UI/navigation work, must
    // cross the durable executor. Missing adapters remain unavailable instead
    // of becoming false-green transport acknowledgements.
    const request: CommandRequest = {
      assignment,
      control: payload.control,
      modifier: payload.modifier,
      sessionId: payload.sessionId,
      authorityId: payload.authorityId,
      confirmationToken: payload.confirmationToken,
      confirmationScopeDigest: payload.confirmationScopeDigest,
      input: payload.input
    };
    const result = await this.executor.execute(request);
    this.record("command.dispatch", result.status, result.summary, payload.sessionId, result.operationId);
    return result;
  }

  private async cancelOperation(payload: OperationCancellationPayload): Promise<CommandResult> {
    if (!isCancellableExecutor(this.executor)) {
      const result: CommandResult = { status: "unavailable", summary: "No verified mediated operation-control adapter is attached; no cancellation was sent.", operationId: payload.operationId };
      this.record("operation.cancel", result.status, result.summary, undefined, payload.operationId);
      return result;
    }
    const result = await this.executor.cancelOperation(payload.operationId, payload.reason);
    this.record("operation.cancel", result.status, result.summary, undefined, payload.operationId);
    return result;
  }

  private async requestConfirmation(payload: ConfirmationRequestPayload): Promise<Readonly<{ status: string; summary: string; token?: string; expiresAt?: string }>> {
    if (!isConfirmationCapableExecutor(this.executor)) {
      return { status: "unavailable", summary: "No trusted companion-UI confirmation attestor is attached; no confirmation token was issued." };
    }
    return this.executor.requestConfirmation(payload);
  }

  private async prepareCommand(payload: CommandPreparationPayload): Promise<Readonly<{ status: "prepared" | "blocked" | "unavailable" | "incomplete"; summary: string; session?: ManagedSession; authorityId?: string; confirmationToken?: string; confirmationScopeDigest?: string; confirmationExpiresAt?: string; workflowReview?: WorkflowContextReview }>> {
    if (!isCommandPreparationExecutor(this.executor)) return { status: "unavailable", summary: "No durable command-preparation boundary is attached." };
    const definition = commandFor(payload.control, payload.modifier);
    if (!definition) return { status: "blocked", summary: "The chord is intentionally unassigned and cannot be prepared." };
    const result = await this.executor.prepareCommand({ action: definition.action, ...(payload.sessionId ? { sessionId: payload.sessionId } : {}), reason: payload.reason, ...(payload.reviewScopeDigest ? { reviewScopeDigest: payload.reviewScopeDigest } : {}) });
    if (result.session) this.installTrustedSession(result.session);
    this.record("command.prepare", result.status === "prepared" ? "completed" : result.status, result.summary, payload.sessionId);
    return result;
  }

  private async completeHostAction(payload: HostActionCompletionPayload): Promise<CommandResult> {
    if (!this.hostActions || !isExternalCompletionExecutor(this.executor)) {
      return { status: "unavailable", summary: "No durable host-action settlement boundary is attached; the acknowledgement was not accepted." };
    }
    const record = await this.hostActions.settle(payload);
    const result = await this.executor.completeExternalOperation(record);
    this.record("host-action.complete", result.status, result.summary, undefined, result.operationId);
    return result;
  }

  private async authorizeHostAction(payload: HostActionAuthorizationPayload): Promise<Readonly<{ hostActionId: string; authorizationToken: string; expiresAt: string; selectionId?: string; url?: string }>> {
    if (!this.hostActions) throw new CompanionServiceError("companion_unavailable", "No durable final host-action authorization boundary is attached.");
    const authorization = await this.hostActions.authorize(payload);
    this.record("host-action.authorize", "completed", "Authorized one exact queued host action after final host revalidation.", undefined, authorization.hostActionId);
    return { hostActionId: authorization.hostActionId, authorizationToken: authorization.authorizationToken, expiresAt: authorization.expiresAt, ...(authorization.selectionId ? { selectionId: authorization.selectionId } : {}), ...(authorization.url ? { url: authorization.url } : {}) };
  }

  private async reviewGitMutation(payload: GitReviewPayload): Promise<GitReviewResult> {
    if (!this.gitReviews) return { status: "unavailable", summary: "No trusted current-user Git review boundary is attached." };
    const result = await this.gitReviews.review(payload);
    if (result.session) this.installTrustedSession(result.session);
    this.record("git.review.submit", result.status === "approved" ? "completed" : result.status, result.summary, payload.sessionId);
    return result;
  }

  private async inspectGitReview(payload: GitReviewInspectPayload): Promise<GitReviewWorkspace> {
    if (!this.gitReviews) throw new CompanionServiceError("companion_unavailable", "No trusted Git review inspector is attached.");
    const workspace = await this.gitReviews.inspect(payload.sessionId);
    this.record("git.review.inspect", "completed", "Inspected the exact host-observed Git review target.", payload.sessionId, workspace.targetSnapshotId);
    return workspace;
  }

  private async createHandoff(payload: HandoffCreatePayload): Promise<HandoffPackage> {
    if (!this.handoffs) throw new CompanionServiceError("capability_denied", "No durable Handoff package store is attached.");
    const session = this.requireSession(payload.sessionId);
    if (!session.workspaceRoot || !session.targetSnapshotId || !session.taskId || !session.planRevision) throw new CompanionServiceError("capability_denied", "Handoff requires a managed session bound to an exact target, task, and plan revision.");
    if (payload.recipientSessionId) {
      const recipient = this.requireSession(payload.recipientSessionId);
      if (recipient.targetSnapshotId !== session.targetSnapshotId || normalizeHostPath(recipient.workspaceRoot ?? "") !== normalizeHostPath(session.workspaceRoot)) throw new CompanionServiceError("capability_denied", "Handoff recipient is not bound to the exact same target.");
    }
    const handoff = await this.handoffs.create({
      repositoryRoot: session.workspaceRoot, targetSnapshotId: session.targetSnapshotId, taskId: session.taskId, planRevision: session.planRevision,
      ...(payload.authorityId ? { authorityId: payload.authorityId } : {}), plan: payload.plan, decisions: payload.decisions,
      documentation: payload.documentation, references: payload.references, constraints: payload.constraints, openQuestions: payload.openQuestions,
      nextActions: payload.nextActions, ...(payload.recipientSessionId ? { recipientSessionId: payload.recipientSessionId } : {}), ...(payload.routing ? { routing: payload.routing } : {})
    });
    this.record("handoff.create", "completed", "Created one immutable non-executing Handoff context package.", session.id);
    return handoff;
  }

  private async listHandoffs(payload: unknown): Promise<readonly HandoffPackage[]> { requireEmptyPayload(payload, "Handoff listing"); if (!this.handoffs) throw new CompanionServiceError("capability_denied", "No durable Handoff package store is attached."); return this.handoffs.list(); }
  private async acknowledgeHandoff(payload: HandoffReferencePayload): Promise<HandoffPackage> { if (!this.handoffs || !payload.recipientSessionId) throw new CompanionServiceError("capability_denied", "Handoff acknowledgement requires the durable store and exact recipient."); this.requireSession(payload.recipientSessionId); return this.handoffs.acknowledge(payload.handoffId, payload.recipientSessionId); }
  private async cancelHandoff(payload: HandoffReferencePayload): Promise<HandoffPackage> { if (!this.handoffs) throw new CompanionServiceError("capability_denied", "No durable Handoff package store is attached."); return this.handoffs.cancel(payload.handoffId); }
  private async archiveHandoff(payload: HandoffReferencePayload): Promise<HandoffPackage> { if (!this.handoffs) throw new CompanionServiceError("capability_denied", "No durable Handoff package store is attached."); return this.handoffs.archive(payload.handoffId); }
  private async handoffRouting(payload: unknown) { requireEmptyPayload(payload, "Handoff routing read"); if (!this.handoffs) throw new CompanionServiceError("capability_denied", "No durable Handoff package store is attached."); return this.handoffs.routingDefault(); }
  private async setHandoffRouting(payload: HandoffRoutingPayload) { if (!this.handoffs) throw new CompanionServiceError("capability_denied", "No durable Handoff package store is attached."); return this.handoffs.setRoutingDefault(payload.routing); }

  private async prepareWorkflowArtifact(payload: WorkflowPreparePayload): Promise<WorkflowArtifact> {
    if (!this.workflowArtifacts) throw new CompanionServiceError("capability_denied", "No durable typed workflow artifact store is attached.");
    const session = this.requireSession(payload.sessionId);
    if (!session.workspaceRoot || !session.targetSnapshotId) throw new CompanionServiceError("capability_denied", "Workflow preparation requires an exact managed-session target.");
    let workflowPayload: WorkflowArtifactPayload;
    let coordinatorBinding: Readonly<{ authorityId: string; coordinatorContextDigest?: string; coordinatorContextRevision?: number }>;
    if (payload.action === "bind_voice_session") {
      if (payload.intent.kind !== "none") throw new CompanionServiceError("invalid_request", "Voice binding accepts no client-authored workflow fields.");
      const active = this.voice ? await this.voice.active() : undefined;
      const consent = active && this.voice ? await this.voice.getConsent(active.consentId) : undefined;
      if (!consent || !active || active.managedSessionId !== session.id || active.targetSnapshotId !== session.targetSnapshotId || normalizeHostPath(active.repositoryRoot) !== normalizeHostPath(session.workspaceRoot)) throw new CompanionServiceError("capability_denied", "Voice workflow binding does not match the active protected consent, context, and managed session.");
      workflowPayload = { kind: "voice_binding", voiceSessionId: active.voiceSessionId, provider: active.provider, contextPackageId: active.contextPackageId, consentId: active.consentId };
      coordinatorBinding = { authorityId: payload.authorityId };
    } else {
      if (!this.workflowCoordinator) throw new CompanionServiceError("capability_denied", "No protected workflow preparation coordinator is attached; client-authored plans, evidence, options, and authority are rejected.");
      const prepared = await this.workflowCoordinator.prepare({ action: payload.action, session, authorityId: payload.authorityId, intent: payload.intent });
      workflowPayload = prepared.payload;
      coordinatorBinding = {
        authorityId: prepared.authorityId,
        coordinatorContextDigest: prepared.coordinatorContextDigest,
        coordinatorContextRevision: prepared.coordinatorContextRevision
      };
    }
    if ((payload.action === "handoff" || payload.action === "handoff_queue" || payload.action === "handoff_immediate") && workflowPayload.kind === "handoff") {
      const handoff = this.handoffs ? await this.handoffs.get(workflowPayload.packageId) : undefined;
      if (!handoff || handoff.repositoryRoot !== session.workspaceRoot || handoff.targetSnapshotId !== session.targetSnapshotId) throw new CompanionServiceError("capability_denied", "The workflow Handoff package is missing or bound to another target.");
      if (handoff.recipientSessionId !== workflowPayload.recipientSessionId || handoff.authorityId !== workflowPayload.authorityId || handoff.planRevision !== session.planRevision || handoff.taskId !== session.taskId) throw new CompanionServiceError("capability_denied", "The coordinator Handoff package changed its exact recipient, authority, task, or plan binding.");
    }
    return this.workflowArtifacts.create({ action: payload.action, repositoryRoot: session.workspaceRoot, targetSnapshotId: session.targetSnapshotId, sessionId: session.id, ...(session.taskId ? { taskId: session.taskId } : {}), ...(session.planRevision ? { planRevision: session.planRevision } : {}), ...coordinatorBinding, payload: workflowPayload });
  }

  private async listWorkflowArtifacts(payload: unknown): Promise<readonly WorkflowArtifact[]> { requireEmptyPayload(payload, "Workflow artifact listing"); if (!this.workflowArtifacts) throw new CompanionServiceError("capability_denied", "No durable typed workflow artifact store is attached."); return this.workflowArtifacts.list(); }
  private async cancelWorkflowArtifact(payload: WorkflowCancelPayload): Promise<WorkflowArtifact> { if (!this.workflowArtifacts) throw new CompanionServiceError("capability_denied", "No durable typed workflow artifact store is attached."); this.requireSession(payload.sessionId); return this.workflowArtifacts.cancelPrepared(payload); }

  private async grantVoiceConsent(payload: VoiceConsentPayload): Promise<VoiceConsent> {
    if (!this.voice || !this.voicePresence || !this.handoffs) throw new CompanionServiceError("capability_denied", "Voice requires durable context, privacy state, and current-user presence.");
    const handoff = await this.handoffs.get(payload.handoffId);
    if (!handoff || handoff.status === "cancelled" || handoff.status === "archived") throw new CompanionServiceError("not_found", "Voice consent requires a current immutable Handoff context package.");
    const presence = await this.voicePresence.verify(`Start or switch SXSY-B122 voice for ${payload.provider} using context ${handoff.id} with transcripts ${payload.transcript}.`);
    if (!presence.verified || !presence.operator) throw new CompanionServiceError("capability_denied", "Current-user presence did not approve voice access.");
    const expiresAt = new Date(Date.parse(this.now()) + payload.expiresInMinutes * 60_000).toISOString();
    return this.voice.grantConsent({ repositoryRoot: handoff.repositoryRoot, targetSnapshotId: handoff.targetSnapshotId, contextPackageId: handoff.id, contextDigest: handoff.digest, provider: payload.provider, operatorPresenceId: presence.operator, transcript: payload.transcript, retentionMinutes: payload.retentionMinutes, expiresAt });
  }

  private async startVoice(payload: VoiceStartPayload): Promise<VoiceBinding> {
    if (!this.voice) throw new CompanionServiceError("capability_denied", "No durable voice coordinator is attached.");
    const consent = await this.voice.getConsent(payload.consentId);
    if (!consent) throw new CompanionServiceError("not_found", "Voice consent was not found.");
    if (this.voiceRuntime && !payload.managedSessionId) throw new CompanionServiceError("capability_denied", "The installed two-way voice runtime requires one explicitly selected exact managed session.");
    if (payload.managedSessionId) this.assertVoiceSessionScope(this.requireSession(payload.managedSessionId), consent.repositoryRoot, consent.targetSnapshotId);
    const binding = await this.voice.start(payload);
    if (payload.managedSessionId && this.voiceRuntime) {
      try { await this.voiceRuntime.open(binding.id); }
      catch (error) { await this.voice.end(binding.id).catch(() => undefined); throw voiceServiceFailure(error); }
    }
    return (await this.voice.getBinding(binding.id)) ?? binding;
  }
  private async currentVoice(payload: unknown): Promise<VoiceBinding | undefined> { requireEmptyPayload(payload, "Voice current binding"); if (!this.voice) throw new CompanionServiceError("capability_denied", "No durable voice coordinator is attached."); return this.voice.active(); }
  private async switchVoice(payload: VoiceSwitchPayload): Promise<VoiceBinding> { if (!this.voice) throw new CompanionServiceError("capability_denied", "No durable voice coordinator is attached."); try { return this.voiceRuntime ? await this.voiceRuntime.switchProvider(payload.bindingId, { consentId: payload.consentId, voiceSessionId: payload.voiceSessionId }) : await this.voice.switchProvider(payload.bindingId, { consentId: payload.consentId, voiceSessionId: payload.voiceSessionId }); } catch (error) { throw voiceServiceFailure(error); } }
  private async bindVoice(payload: VoiceBindingPayload): Promise<VoiceBinding> { if (!this.voice) throw new CompanionServiceError("capability_denied", "No durable voice coordinator is attached."); const binding = await this.voice.getBinding(payload.bindingId); if (!binding) throw new CompanionServiceError("not_found", "Voice binding was not found."); this.assertVoiceSessionScope(this.requireSession(payload.managedSessionId), binding.repositoryRoot, binding.targetSnapshotId); try { return this.voiceRuntime ? await this.voiceRuntime.bindManagedSession(payload.bindingId, payload.managedSessionId) : await this.voice.bindManagedSession(payload.bindingId, payload.managedSessionId); } catch (error) { throw voiceServiceFailure(error); } }
  private async muteVoice(payload: VoiceReferencePayload): Promise<VoiceBinding> { if (!this.voice) throw new CompanionServiceError("capability_denied", "No durable voice coordinator is attached."); try { return this.voiceRuntime ? await this.voiceRuntime.mute(payload.bindingId) : await this.voice.mute(payload.bindingId); } catch (error) { throw voiceServiceFailure(error); } }
  private async resumeVoice(payload: VoiceReferencePayload): Promise<VoiceBinding> { if (!this.voice) throw new CompanionServiceError("capability_denied", "No durable voice coordinator is attached."); try { return this.voiceRuntime ? await this.voiceRuntime.resume(payload.bindingId) : await this.voice.resume(payload.bindingId); } catch (error) { throw voiceServiceFailure(error); } }
  private async interruptVoice(payload: VoiceReferencePayload): Promise<VoiceBinding> { if (!this.voice || !payload.reason) throw new CompanionServiceError("invalid_request", "Voice interruption requires a bounded reason."); try { return this.voiceRuntime ? await this.voiceRuntime.interrupt(payload.bindingId, payload.reason) : await this.voice.interrupt(payload.bindingId, payload.reason); } catch (error) { throw voiceServiceFailure(error); } }
  private async endVoice(payload: VoiceReferencePayload): Promise<VoiceBinding> { if (!this.voice) throw new CompanionServiceError("capability_denied", "No durable voice coordinator is attached."); try { return this.voiceRuntime ? await this.voiceRuntime.end(payload.bindingId) : await this.voice.end(payload.bindingId); } catch (error) { throw voiceServiceFailure(error); } }
  private async deleteVoiceTranscript(payload: VoiceReferencePayload): Promise<VoiceBinding> { if (!this.voice) throw new CompanionServiceError("capability_denied", "No durable voice coordinator is attached."); try { return this.voiceRuntime ? await this.voiceRuntime.deleteTranscript(payload.bindingId) : await this.voice.deleteTranscript(payload.bindingId); } catch (error) { throw voiceServiceFailure(error); } }

  private assertVoiceSessionScope(session: ManagedSession, repositoryRoot: string, targetSnapshotId: string): void {
    if (session.targetSnapshotId !== targetSnapshotId || normalizeHostPath(session.workspaceRoot ?? "") !== normalizeHostPath(repositoryRoot)) throw new CompanionServiceError("capability_denied", "Voice can bind only to a managed session on the exact consent target.");
  }

  private async installRuntimePin(payload: RuntimePinInstallPayload) {
    if (!this.runtimePins) throw new CompanionServiceError("capability_denied", "No trusted runtime provisioning boundary is attached.");
    const pin = await this.runtimePins.install(payload);
    this.record("runtime.pin.install", "completed", "Installed one current-user-attested repository runtime digest.");
    return pin;
  }

  private async listRuntimePins(payload: unknown) {
    if (payload !== undefined && (!isRecord(payload) || Object.keys(payload).length !== 0)) throw new CompanionServiceError("invalid_request", "Runtime pin listing accepts no client options.");
    if (!this.runtimePins) throw new CompanionServiceError("capability_denied", "No trusted runtime provisioning boundary is attached.");
    return this.runtimePins.list();
  }

  private async revokeRuntimePin(payload: RuntimePinRevokePayload) {
    if (!this.runtimePins) throw new CompanionServiceError("capability_denied", "No trusted runtime provisioning boundary is attached.");
    const pin = await this.runtimePins.revoke(payload.repositoryRoot);
    this.record("runtime.pin.revoke", "completed", "Revoked one current-user-attested repository runtime digest.");
    return pin;
  }

  private requireRuntimePinInstall(payload: unknown): RuntimePinInstallPayload {
    if (!isRecord(payload) || !exactKeys(payload, ["repositoryRoot", "manifestPath"])
      || !boundedHostPath(payload.repositoryRoot) || !boundedHostPath(payload.manifestPath)) {
      throw new CompanionServiceError("invalid_request", "Runtime pin installation requires only bounded absolute repository and manifest paths.");
    }
    return { repositoryRoot: payload.repositoryRoot, manifestPath: payload.manifestPath };
  }

  private requireRuntimePinRevoke(payload: unknown): RuntimePinRevokePayload {
    if (!isRecord(payload) || !exactKeys(payload, ["repositoryRoot"]) || !boundedHostPath(payload.repositoryRoot)) {
      throw new CompanionServiceError("invalid_request", "Runtime pin revocation requires one bounded absolute repository path.");
    }
    return { repositoryRoot: payload.repositoryRoot };
  }

  private async installSandbox(payload: SandboxInstallPayload) {
    if (!this.sandboxInstallations) throw new CompanionServiceError("capability_denied", "No trusted Windows Sandbox installation boundary is attached.");
    const installation = await this.sandboxInstallations.install(payload);
    this.record("sandbox.install", "completed", "Installed one current-user-attested Windows Sandbox catalog and helper pin.");
    return installation;
  }

  private async listSandboxes(payload: unknown) {
    if (payload !== undefined && (!isRecord(payload) || Object.keys(payload).length !== 0)) throw new CompanionServiceError("invalid_request", "Windows Sandbox listing accepts no client options.");
    if (!this.sandboxInstallations) throw new CompanionServiceError("capability_denied", "No trusted Windows Sandbox installation boundary is attached.");
    return this.sandboxInstallations.list();
  }

  private async revokeSandbox(payload: SandboxRevokePayload) {
    if (!this.sandboxInstallations) throw new CompanionServiceError("capability_denied", "No trusted Windows Sandbox installation boundary is attached.");
    const installation = await this.sandboxInstallations.revoke(payload.repositoryRoot);
    this.record("sandbox.revoke", "completed", "Revoked one current-user-attested Windows Sandbox installation.");
    return installation;
  }

  private requireSandboxInstall(payload: unknown): SandboxInstallPayload {
    if (!isRecord(payload) || !exactKeys(payload, ["repositoryRoot", "catalogPath"]) || !boundedHostPath(payload.repositoryRoot) || !boundedHostPath(payload.catalogPath)) {
      throw new CompanionServiceError("invalid_request", "Windows Sandbox installation requires only bounded absolute repository and catalog paths.");
    }
    return { repositoryRoot: payload.repositoryRoot, catalogPath: payload.catalogPath };
  }

  private requireSandboxRevoke(payload: unknown): SandboxRevokePayload {
    if (!isRecord(payload) || !exactKeys(payload, ["repositoryRoot"]) || !boundedHostPath(payload.repositoryRoot)) throw new CompanionServiceError("invalid_request", "Windows Sandbox revocation requires one bounded absolute repository path.");
    return { repositoryRoot: payload.repositoryRoot };
  }

  private async provisionCredential(payload: CredentialProvisionPayload) {
    if (!this.credentialProvisioning) throw new CompanionServiceError("capability_denied", "No trusted credential provisioning boundary is attached.");
    const credential = await this.credentialProvisioning.provision(payload);
    const exactScopes = credential.scopes.map((scope) => `${scope.repositoryRoot}=>${scope.adapterId}/${scope.purpose}`).join("; ");
    this.record("credential.provision", "completed", `Provisioned one DPAPI-sealed credential reference for exact scopes: ${exactScopes}.`);
    return credential;
  }

  private async listCredentials(payload: unknown) {
    requireEmptyPayload(payload, "Credential listing");
    if (!this.credentialProvisioning) throw new CompanionServiceError("capability_denied", "No trusted credential provisioning boundary is attached.");
    return this.credentialProvisioning.list();
  }

  private async revokeCredential(payload: CredentialRevokePayload): Promise<boolean> {
    if (!this.credentialProvisioning) throw new CompanionServiceError("capability_denied", "No trusted credential provisioning boundary is attached.");
    const revoked = await this.credentialProvisioning.revoke(payload.reference, payload.reason);
    this.record("credential.revoke", revoked ? "completed" : "unavailable", revoked ? "Revoked the selected credential reference." : "The selected live credential reference was not found.");
    return revoked;
  }

  private async installNetworkPolicy(payload: NetworkPolicyInstallPayload) {
    if (!this.networkPolicyProvisioning) throw new CompanionServiceError("capability_denied", "No trusted network-policy provisioning boundary is attached.");
    const policy = await this.networkPolicyProvisioning.install(payload.sourcePath);
    this.record("network-policy.install", "completed", "Installed one current-user-attested exact-route HTTPS policy.");
    return policy;
  }

  private async currentNetworkPolicy(payload: unknown) { requireEmptyPayload(payload, "Network policy inspection"); if (!this.networkPolicyProvisioning) throw new CompanionServiceError("capability_denied", "No trusted network-policy provisioning boundary is attached."); return this.networkPolicyProvisioning.current(); }
  private async revokeNetworkPolicy(payload: unknown) { requireEmptyPayload(payload, "Network policy revocation"); if (!this.networkPolicyProvisioning) throw new CompanionServiceError("capability_denied", "No trusted network-policy provisioning boundary is attached."); const policy = await this.networkPolicyProvisioning.revoke(); this.record("network-policy.revoke", "completed", "Revoked the active exact-route HTTPS policy."); return policy; }

  private acceptanceAdmin() { if (!this.acceptanceAdministration) throw new CompanionServiceError("capability_denied", "No current-user acceptance-evidence administration boundary is installed."); return this.acceptanceAdministration; }
  private scannerAdmin() { if (!this.scannerAdministration) throw new CompanionServiceError("capability_denied", "No current-user signed scanner-fixture administration boundary is installed."); return this.scannerAdministration; }
  private async installAcceptanceTrust(payload: AdministrationSourcePayload): Promise<InstalledAcceptanceTrust> { const value = await this.acceptanceAdmin().installTrustPolicy(payload.sourcePath); this.record("acceptance.trust.install", "completed", "Installed one current-user-approved acceptance authority."); return value; }
  private async listAcceptanceTrust(payload: unknown): Promise<readonly InstalledAcceptanceTrust[]> { requireEmptyPayload(payload, "Acceptance trust listing"); return this.acceptanceAdmin().listTrust(); }
  private async revokeAcceptanceTrust(payload: AcceptanceTrustRevokePayload): Promise<InstalledAcceptanceTrust> { const value = await this.acceptanceAdmin().revokeTrust(payload.authorityId, payload.keyId, payload.reason); this.record("acceptance.trust.revoke", "completed", "Revoked one current-user-approved acceptance authority."); return value; }
  private async importAcceptanceEvidence(payload: AdministrationSourcePayload): Promise<GateEvidence> { const value = await this.acceptanceAdmin().importEvidence(payload.sourcePath); this.record("acceptance.evidence.import", "completed", "Imported one independently signed acceptance-evidence package."); return value; }
  private async listAcceptanceEvidence(payload: unknown): Promise<readonly GateEvidence[]> { requireEmptyPayload(payload, "Acceptance evidence listing"); return this.acceptanceAdmin().listEvidence(); }
  private async invalidateAcceptanceEvidence(payload: AcceptanceEvidenceInvalidatePayload): Promise<true> { await this.acceptanceAdmin().invalidateEvidence(payload.evidenceId, payload.reason); this.record("acceptance.evidence.invalidate", "completed", "Invalidated one selected acceptance-evidence record."); return true; }
  private async activateHighConsequence(payload: AcceptanceActivationPayload): Promise<HighConsequenceActivation> { const value = await this.acceptanceAdmin().activate(payload.action, payload.targetSnapshotId, payload.expiresAt); this.record("acceptance.activation.activate", "completed", "Activated one high-consequence action for one exact target and expiry."); return value; }
  private async listHighConsequenceActivations(payload: unknown): Promise<readonly HighConsequenceActivation[]> { requireEmptyPayload(payload, "High-consequence activation listing"); return this.acceptanceAdmin().listActivations(); }
  private async revokeHighConsequenceActivation(payload: AcceptanceActivationRevokePayload): Promise<true> { await this.acceptanceAdmin().revokeActivation(payload.activationId, payload.reason); this.record("acceptance.activation.revoke", "completed", "Revoked one selected high-consequence activation."); return true; }
  private async installScannerTrust(payload: AdministrationSourcePayload): Promise<InstalledScannerFixtureTrust> { const value = await this.scannerAdmin().installTrust(payload.sourcePath); this.record("scanner.trust.install", "completed", "Installed one current-user-approved scanner-fixture authority."); return value; }
  private async listScannerTrust(payload: unknown): Promise<readonly InstalledScannerFixtureTrust[]> { requireEmptyPayload(payload, "Scanner trust listing"); return this.scannerAdmin().listTrust(); }
  private async revokeScannerTrust(payload: ScannerTrustRevokePayload): Promise<true> { await this.scannerAdmin().revokeTrust(payload.authorityId, payload.keyId, payload.reason); this.record("scanner.trust.revoke", "completed", "Revoked one selected scanner-fixture authority."); return true; }
  private async installScannerFixture(payload: AdministrationSourcePayload): Promise<InstalledScannerFixture> { const value = await this.scannerAdmin().installFixture(payload.sourcePath); this.record("scanner.fixture.install", "completed", "Installed one current-user-approved signed scanner/advisory fixture."); return value; }
  private async listScannerFixtures(payload: unknown): Promise<readonly InstalledScannerFixture[]> { requireEmptyPayload(payload, "Scanner fixture listing"); return this.scannerAdmin().listFixtures(); }
  private async revokeScannerFixture(payload: ScannerFixtureRevokePayload): Promise<true> { await this.scannerAdmin().revokeFixture(payload.fixtureId, payload.reason); this.record("scanner.fixture.revoke", "completed", "Revoked one selected scanner/advisory fixture."); return true; }

  private providerDesktopAdmin() { if (!this.providerDesktopRegistry) throw new CompanionServiceError("capability_denied", "No fixed-path current-user provider installation registry is attached."); return this.providerDesktopRegistry; }
  private async installProviderDesktop(payload: ProviderDesktopReferencePayload): Promise<ProviderInstallation> { const value = await this.providerDesktopAdmin().install(payload.provider); this.record("provider-desktop.install", "completed", "Installed one current-user-approved fixed provider executable identity."); return value; }
  private async listProviderDesktops(payload: unknown): Promise<readonly ProviderInstallation[]> { requireEmptyPayload(payload, "Provider desktop listing"); return this.providerDesktopAdmin().list(); }
  private async revokeProviderDesktop(payload: ProviderDesktopReferencePayload): Promise<ProviderInstallation> { const value = await this.providerDesktopAdmin().revoke(payload.provider); this.record("provider-desktop.revoke", "completed", "Revoked one fixed provider executable identity."); return value; }

  private async providerHandshake(payload: ProviderHandshakePayload): Promise<ManagedSession> {
    if (!this.providerHandshakes) throw new CompanionServiceError("capability_denied", "No configured provider handshake boundary is attached.");
    const session = this.requireSession(payload.sessionId);
    if (session.workspaceRoot && normalizeHostPath(session.workspaceRoot) !== normalizeHostPath(payload.repositoryRoot)) throw new CompanionServiceError("capability_denied", "The selected provider session is bound to a different repository root.");
    const trusted = await this.providerHandshakes.handshake({ session, repositoryRoot: payload.repositoryRoot });
    this.installTrustedSession(trusted);
    this.record("provider.handshake", "completed", "Installed exact-target adapter-proven session capabilities.", trusted.id);
    return cloneSession(trusted);
  }

  private async releaseContainment(payload: ContainmentReleasePayload): Promise<CommandResult> {
    if (!this.containmentRelease) throw new CompanionServiceError("capability_denied", "No host-attested containment-release boundary is attached.");
    const result = await this.containmentRelease.release(payload);
    this.record("containment.release", result.status, result.summary, payload.sessionId);
    return result;
  }

  private async inspectContainment(payload: ContainmentInspectionPayload) {
    if (!this.containmentRelease) throw new CompanionServiceError("capability_denied", "No durable containment inspection boundary is attached.");
    const result = await this.containmentRelease.inspect(payload.sessionId);
    if (!result) throw new CompanionServiceError("not_found", "No exact active containment fence exists for this protected session target.");
    return result;
  }

  private requireCredentialProvision(payload: unknown): CredentialProvisionPayload {
    if (!isRecord(payload) || !allowedExactKeys(payload, ["reference", "scopes", "sealedSecret"], ["replaceExisting"])
      || !credentialIdentifier(payload.reference) || !Array.isArray(payload.scopes) || payload.scopes.length < 1 || payload.scopes.length > 16
      || typeof payload.sealedSecret !== "string" || !payload.sealedSecret || payload.sealedSecret.length > 256 * 1024
      || (payload.replaceExisting !== undefined && typeof payload.replaceExisting !== "boolean")) {
      throw new CompanionServiceError("invalid_request", "Credential provisioning requires only a bounded reference, 1-16 exact repository/adapter/purpose scope triples, and a DPAPI-sealed secret.");
    }
    const scopes = payload.scopes.map((scope) => {
      if (!isRecord(scope) || !exactKeys(scope, ["repositoryRoot", "adapterId", "purpose"])
        || !boundedHostPath(scope.repositoryRoot) || !credentialIdentifier(scope.adapterId) || !credentialIdentifier(scope.purpose)) {
        throw new CompanionServiceError("invalid_request", "Each credential scope must be one exact repositoryRoot, adapterId, and purpose triple.");
      }
      return { repositoryRoot: scope.repositoryRoot, adapterId: scope.adapterId, purpose: scope.purpose };
    });
    const identities = scopes.map((scope) => `${normalizeHostPath(scope.repositoryRoot)}\0${scope.adapterId}\0${scope.purpose}`);
    if (new Set(identities).size !== identities.length) throw new CompanionServiceError("invalid_request", "Credential scope triples must be unique.");
    return { reference: payload.reference, scopes, sealedSecret: payload.sealedSecret, ...(payload.replaceExisting === true ? { replaceExisting: true } : {}) };
  }

  private requireCredentialRevoke(payload: unknown): CredentialRevokePayload { if (!isRecord(payload) || !exactKeys(payload, ["reference", "reason"]) || typeof payload.reference !== "string" || typeof payload.reason !== "string") throw new CompanionServiceError("invalid_request", "Credential revocation requires exact reference and reason fields."); return { reference: payload.reference, reason: payload.reason }; }
  private requireNetworkPolicyInstall(payload: unknown): NetworkPolicyInstallPayload { if (!isRecord(payload) || !exactKeys(payload, ["sourcePath"]) || !boundedHostPath(payload.sourcePath)) throw new CompanionServiceError("invalid_request", "Network policy installation requires one bounded absolute source path."); return { sourcePath: payload.sourcePath }; }
  private requireCouncilPortProxy(payload: unknown): CouncilPortProxyPayload {
    const keys = ["epochId", "sessionId", "targetSnapshotId", "leaseId", "operationId", "fenceDigest", "resourceHostDigest", "expectedPort", "backendPipePath", "backendProof"];
    if (!isRecord(payload) || !exactKeys(payload, keys) || !keys.every((key) => typeof payload[key] === "string" && (payload[key] as string).length > 0 && (payload[key] as string).length <= 512 && !/[\r\n\0]/.test(payload[key] as string))) {
      throw new CompanionServiceError("invalid_request", "Council port-proxy activation requires only exact epoch, session, target, lease, operation, and local backend-pipe fields.");
    }
    return payload as unknown as CouncilPortProxyPayload;
  }
  private requireCouncilCredentialNetwork(payload: unknown): CouncilCredentialNetworkPayload {
    const required = ["epochId", "sessionId", "targetSnapshotId", "leaseId", "operationId", "fenceDigest", "resourceHostDigest", "capabilityId", "routeId"];
    if (!isRecord(payload) || !exactKeys(payload, required)
      || !required.every((key) => typeof payload[key] === "string" && (payload[key] as string).length > 0 && (payload[key] as string).length <= 256 && !/[\r\n\0]/.test(payload[key] as string))) {
      throw new CompanionServiceError("invalid_request", "Council credentialed network execution requires only exact bounded broker fields.");
    }
    return payload as unknown as CouncilCredentialNetworkPayload;
  }
  private async activateCouncilPortProxy(payload: CouncilPortProxyPayload) {
    if (!this.councilResources) throw new CompanionServiceError("capability_denied", "No installed Council resource broker is attached.");
    return this.councilResources.activatePortProxy(payload);
  }
  private async executeCouncilCredentialNetwork(payload: CouncilCredentialNetworkPayload) {
    if (!this.councilResources) throw new CompanionServiceError("capability_denied", "No installed Council resource broker is attached.");
    return this.councilResources.credentialNetwork(payload);
  }
  private requireAdministrationSource(payload: unknown, label: string): AdministrationSourcePayload { if (!isRecord(payload) || !exactKeys(payload, ["sourcePath"]) || !boundedHostPath(payload.sourcePath)) throw new CompanionServiceError("invalid_request", `${label} requires one bounded absolute source path.`); return { sourcePath: payload.sourcePath }; }
  private requireAcceptanceTrustRevoke(payload: unknown): AcceptanceTrustRevokePayload { if (!isRecord(payload) || !exactKeys(payload, ["authorityId", "keyId", "reason"]) || !boundedIdentifier(payload.authorityId) || typeof payload.keyId !== "string" || !/^[a-f0-9]{64}$/.test(payload.keyId) || !boundedReason(payload.reason)) throw new CompanionServiceError("invalid_request", "Acceptance trust revocation requires exact authority, key, and reason fields."); return { authorityId: payload.authorityId, keyId: payload.keyId, reason: payload.reason }; }
  private requireAcceptanceEvidenceInvalidate(payload: unknown): AcceptanceEvidenceInvalidatePayload { if (!isRecord(payload) || !exactKeys(payload, ["evidenceId", "reason"]) || !boundedIdentifier(payload.evidenceId) || !boundedReason(payload.reason)) throw new CompanionServiceError("invalid_request", "Acceptance evidence invalidation requires one exact evidence ID and bounded reason."); return { evidenceId: payload.evidenceId, reason: payload.reason }; }
  private requireAcceptanceActivation(payload: unknown): AcceptanceActivationPayload { if (!isRecord(payload) || !exactKeys(payload, ["action", "targetSnapshotId", "expiresAt"]) || typeof payload.action !== "string" || !commandActionIds.includes(payload.action as CommandAction) || !boundedIdentifier(payload.targetSnapshotId) || typeof payload.expiresAt !== "string" || !Number.isFinite(Date.parse(payload.expiresAt))) throw new CompanionServiceError("invalid_request", "High-consequence activation requires one catalog action, exact target snapshot, and ISO expiry."); return { action: payload.action as CommandAction, targetSnapshotId: payload.targetSnapshotId, expiresAt: payload.expiresAt }; }
  private requireAcceptanceActivationRevoke(payload: unknown): AcceptanceActivationRevokePayload { if (!isRecord(payload) || !exactKeys(payload, ["activationId", "reason"]) || !boundedIdentifier(payload.activationId) || !boundedReason(payload.reason)) throw new CompanionServiceError("invalid_request", "High-consequence activation revocation requires one exact activation ID and bounded reason."); return { activationId: payload.activationId, reason: payload.reason }; }
  private requireScannerTrustRevoke(payload: unknown): ScannerTrustRevokePayload { if (!isRecord(payload) || !exactKeys(payload, ["authorityId", "keyId", "reason"]) || !boundedIdentifier(payload.authorityId) || typeof payload.keyId !== "string" || !/^[a-f0-9]{64}$/.test(payload.keyId) || !boundedReason(payload.reason)) throw new CompanionServiceError("invalid_request", "Scanner trust revocation requires exact authority, key, and reason fields."); return { authorityId: payload.authorityId, keyId: payload.keyId, reason: payload.reason }; }
  private requireScannerFixtureRevoke(payload: unknown): ScannerFixtureRevokePayload { if (!isRecord(payload) || !exactKeys(payload, ["fixtureId", "reason"]) || !boundedIdentifier(payload.fixtureId) || !boundedReason(payload.reason)) throw new CompanionServiceError("invalid_request", "Scanner fixture revocation requires one exact fixture ID and bounded reason."); return { fixtureId: payload.fixtureId, reason: payload.reason }; }
  private requireProviderDesktopReference(payload: unknown): ProviderDesktopReferencePayload { if (!isRecord(payload) || !exactKeys(payload, ["provider"]) || typeof payload.provider !== "string" || !(providerIds as readonly string[]).includes(payload.provider)) throw new CompanionServiceError("invalid_request", "Provider installation administration accepts only one compiled provider identity."); return { provider: payload.provider as ProviderId }; }
  private requireProviderHandshake(payload: unknown): ProviderHandshakePayload { if (!isRecord(payload) || !exactKeys(payload, ["sessionId", "repositoryRoot"]) || typeof payload.sessionId !== "string" || !payload.sessionId.trim() || payload.sessionId.length > 256 || !boundedHostPath(payload.repositoryRoot)) throw new CompanionServiceError("invalid_request", "Provider handshake requires one existing session ID and exact absolute repository root."); return { sessionId: payload.sessionId, repositoryRoot: payload.repositoryRoot }; }
  private requireContainmentInspection(payload: unknown): ContainmentInspectionPayload {
    if (!isRecord(payload) || !exactKeys(payload, ["sessionId"]) || typeof payload.sessionId !== "string" || !payload.sessionId.trim()
      || payload.sessionId.length > 256 || /[\r\n\0]/.test(payload.sessionId)) {
      throw new CompanionServiceError("invalid_request", "Containment inspection requires one exact bounded protected session ID.");
    }
    return { sessionId: payload.sessionId.trim() };
  }

  private requireContainmentRelease(payload: unknown): ContainmentReleasePayload {
    if (!isRecord(payload) || !exactKeys(payload, ["sessionId", "reason", "incidentStatus", "expectedFenceEpoch", "expectedActivationOperationId"])
      || typeof payload.sessionId !== "string" || !payload.sessionId.trim() || payload.sessionId.length > 256 || /[\r\n\0]/.test(payload.sessionId)
      || typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 2_048 || /[\0]/.test(payload.reason)
      || (payload.incidentStatus !== "rotation_complete" && payload.incidentStatus !== "not_required")
      || !Number.isSafeInteger(payload.expectedFenceEpoch) || Number(payload.expectedFenceEpoch) < 1
      || typeof payload.expectedActivationOperationId !== "string" || !payload.expectedActivationOperationId.trim()
      || payload.expectedActivationOperationId.length > 256 || /[\r\n\0]/.test(payload.expectedActivationOperationId)) {
      throw new CompanionServiceError("invalid_request", "Containment release requires one exact session, reviewed fence epoch and activation operation, bounded incident reason, and completed-or-not-required credential rotation status.");
    }
    return {
      sessionId: payload.sessionId.trim(),
      reason: payload.reason.trim(),
      incidentStatus: payload.incidentStatus,
      expectedFenceEpoch: Number(payload.expectedFenceEpoch),
      expectedActivationOperationId: payload.expectedActivationOperationId.trim()
    };
  }

  private async installRawHid(payload: RawHidInstallPayload) {
    if (!this.rawHidInstallations || !this.rawHidSupervisor) throw new CompanionServiceError("capability_denied", "No trusted Raw-HID provisioning boundary is attached.");
    // A changed tuple or helper pin is never made durable while the prior
    // generation can still emit signals under the old installation identity.
    await this.rawHidSupervisor.stop();
    const installation = await this.rawHidInstallations.install(payload);
    const supervisor = await this.rawHidSupervisor.startConfigured();
    this.record("raw-hid.install", "completed", "Installed one current-user-attested exact B122 Raw-HID tuple and fixed helper pin.");
    return { installation, supervisor };
  }

  private async listRawHid(payload: unknown) {
    requireEmptyPayload(payload, "Raw-HID installation listing");
    if (!this.rawHidInstallations) throw new CompanionServiceError("capability_denied", "No trusted Raw-HID provisioning boundary is attached.");
    return this.rawHidInstallations.list();
  }

  private async revokeRawHid(payload: unknown) {
    requireEmptyPayload(payload, "Raw-HID revocation");
    if (!this.rawHidInstallations || !this.rawHidSupervisor) throw new CompanionServiceError("capability_denied", "No trusted Raw-HID provisioning boundary is attached.");
    await this.rawHidSupervisor.stop();
    const installation = await this.rawHidInstallations.revoke();
    this.record("raw-hid.revoke", "completed", "Revoked the current-user-attested B122 Raw-HID tuple and stopped its helper generation.");
    return installation;
  }

  private async rawHidStatus(payload: unknown) {
    requireEmptyPayload(payload, "Raw-HID status");
    if (!this.rawHidInstallations || !this.rawHidSupervisor || !this.hardwareSignals) throw new CompanionServiceError("capability_denied", "No complete trusted Raw-HID runtime boundary is attached.");
    return { supervisor: this.rawHidSupervisor.status(), inbox: await this.hardwareSignals.status(), installations: await this.rawHidInstallations.list() };
  }

  private async claimHardwareSignal(payload: HardwareSignalClaimPayload): Promise<HardwareSignalClaim | undefined> {
    if (!this.hardwareSignals) throw new CompanionServiceError("capability_denied", "No durable hardware signal inbox is attached.");
    const binding = await this.requireFocusedWindowBinding(payload);
    return this.hardwareSignals.claim(binding);
  }

  private async prepareHardwareSignal(payload: HardwareSignalPreparationPayload) {
    if (!this.hardwareSignals) throw new CompanionServiceError("capability_denied", "No durable hardware signal inbox is attached.");
    const claim = await this.hardwareSignals.resolveLiveClaim(payload);
    const sessionId = payload.sessionId ?? claim.windowSessionId;
    await this.assertHardwareDispatchSession(claim, sessionId);
    const preparation = await this.prepareCommand({ control: claim.control, modifier: claim.modifier, sessionId, reason: payload.reason, ...(payload.reviewScopeDigest ? { reviewScopeDigest: payload.reviewScopeDigest } : {}) });
    if (preparation.status === "prepared") return { preparation };
    // Plan Approval is deliberately a two-phase host ceremony.  The first
    // preparation returns the exact provider-observed review packet without
    // issuing authority or confirmation.  Keep the durable hardware claim
    // live so the same canonical signal can be prepared again only after the
    // trusted UI echoes that exact review scope.  Recording a disposition here
    // would consume the signal before the reviewed second phase could occur.
    if (preparation.status === "incomplete" && preparation.workflowReview) return { preparation };
    const assignment = assignmentFor(claim.control, claim.modifier);
    if (!assignment) throw new CompanionServiceError("capability_denied", "The claimed hardware chord no longer has a settled canonical assignment.");
    const disposition = await this.hardwareSignals.recordDispatch({
      signalId: claim.signalId,
      claimToken: claim.claimToken,
      windowSessionId: claim.windowSessionId,
      workspaceRoots: claim.workspaceRoots,
      handler: assignment.handler,
      resultStatus: `preparation:${preparation.status}`
    });
    return { preparation, dispositionReceiptId: disposition.dispatchReceiptId };
  }

  private async dispatchHardwareSignal(payload: HardwareSignalDispatchPayload) {
    if (!this.hardwareSignals) throw new CompanionServiceError("capability_denied", "No durable hardware signal inbox is attached.");
    const claim = await this.hardwareSignals.resolveLiveClaim(payload);
    const sessionId = payload.sessionId ?? claim.windowSessionId;
    await this.assertHardwareDispatchSession(claim, sessionId);
    const assignment = assignmentFor(claim.control, claim.modifier);
    if (!assignment) throw new CompanionServiceError("capability_denied", "The claimed hardware chord no longer has a settled canonical assignment.");
    // Persist the exact canonical handler before the executor may cause an
    // effect. A concurrent client can no longer requeue this claim as if
    // dispatch had not begun.
    const dispatch = await this.hardwareSignals.recordDispatch({
      signalId: claim.signalId,
      claimToken: claim.claimToken,
      windowSessionId: claim.windowSessionId,
      workspaceRoots: claim.workspaceRoots,
      handler: assignment.handler,
      resultStatus: "dispatching"
    });
    const command = await this.dispatch({
      control: claim.control,
      modifier: claim.modifier,
      sessionId,
      authorityId: payload.authorityId,
      confirmationToken: payload.confirmationToken,
      confirmationScopeDigest: payload.confirmationScopeDigest,
      input: payload.input
    });
    this.record("hardware-signal.dispatch", command.status, `Dispatched the server-resolved ${assignment.handler} hardware assignment.`, sessionId, command.operationId);
    return { command, dispatchReceiptId: dispatch.dispatchReceiptId };
  }

  private async completeHardwareSignal(payload: HardwareSignalCompletionPayload) {
    if (!this.hardwareSignals) throw new CompanionServiceError("capability_denied", "No durable hardware signal inbox is attached.");
    const claim = await this.hardwareSignals.resolveLiveClaim(payload);
    if (payload.dispatchSessionId) await this.assertHardwareDispatchSession(claim, payload.dispatchSessionId);
    const completionRoot = payload.repositoryRoot ? await this.canonicalizeHostPath(payload.repositoryRoot) : undefined;
    if (completionRoot && !claim.workspaceRoots.some((root) => normalizeHostPath(root) === normalizeHostPath(completionRoot))) {
      throw new CompanionServiceError("capability_denied", "The hardware completion repository is outside its exact focused-window workspace binding.");
    }
    const completion = await this.hardwareSignals.complete({ ...payload, ...(completionRoot ? { repositoryRoot: completionRoot } : {}) });
    this.record("hardware-signal.complete", payload.outcome === "handled" ? "completed" : payload.outcome === "failed_before_dispatch" ? "failed" : "incomplete", payload.summary, payload.dispatchSessionId);
    return completion;
  }

  private requireRawHidInstall(payload: unknown): RawHidInstallPayload {
    if (!isRecord(payload) || !allowedExactKeys(payload, ["vendorId", "productId", "usagePage", "usage"], ["serialNumber"])
      || !uint16(payload.vendorId) || !uint16(payload.productId) || !uint16(payload.usagePage) || !uint16(payload.usage)
      || (payload.serialNumber !== undefined && (typeof payload.serialNumber !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(payload.serialNumber)))) {
      throw new CompanionServiceError("invalid_request", "Raw-HID installation accepts only one exact uint16 VID/PID/usage tuple and optional bounded serial number; helper path, digest, map, and protocol are host-owned.");
    }
    return { vendorId: payload.vendorId, productId: payload.productId, usagePage: payload.usagePage, usage: payload.usage, ...(typeof payload.serialNumber === "string" ? { serialNumber: payload.serialNumber } : {}) };
  }

  private requireHardwareSignalClaim(payload: unknown): HardwareSignalClaimPayload {
    if (!isRecord(payload) || !exactKeys(payload, ["windowSessionId", "workspaceRoots", "focused"]) || payload.focused !== true) throw new CompanionServiceError("invalid_request", "Hardware signal claim requires one explicitly focused VS Code window and its exact workspace roots.");
    const binding = parseHardwareBinding(payload);
    return { ...binding, focused: true };
  }

  private requireHardwareSignalPreparation(payload: unknown): HardwareSignalPreparationPayload {
    if (!isRecord(payload) || !allowedExactKeys(payload, ["signalId", "claimToken", "windowSessionId", "workspaceRoots", "reason"], ["sessionId", "reviewScopeDigest"])
      || typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 512
      || (payload.sessionId !== undefined && !boundedReferenceValue(payload.sessionId))
      || (payload.reviewScopeDigest !== undefined && (typeof payload.reviewScopeDigest !== "string" || !/^[a-f0-9]{64}$/.test(payload.reviewScopeDigest)))) throw new CompanionServiceError("invalid_request", "Hardware signal preparation requires an exact live claim, optional bound session, bounded reason, and only a host-issued Plan Approval review digest.");
    return { ...parseHardwareClaimReference(payload), reason: payload.reason, ...(typeof payload.sessionId === "string" ? { sessionId: payload.sessionId } : {}), ...(typeof payload.reviewScopeDigest === "string" ? { reviewScopeDigest: payload.reviewScopeDigest } : {}) };
  }

  private requireHardwareSignalDispatch(payload: unknown): HardwareSignalDispatchPayload {
    if (!isRecord(payload) || !allowedExactKeys(payload, ["signalId", "claimToken", "windowSessionId", "workspaceRoots"], ["sessionId", "authorityId", "confirmationToken", "confirmationScopeDigest", "input"])
      || (payload.sessionId !== undefined && !boundedReferenceValue(payload.sessionId))) throw new CompanionServiceError("invalid_request", "Hardware signal dispatch accepts only an exact live claim and host-issued mediation references; the chord is server-resolved.");
    return {
      ...parseHardwareClaimReference(payload),
      ...(typeof payload.sessionId === "string" ? { sessionId: payload.sessionId } : {}),
      authorityId: optionalReference(payload.authorityId, "authority ID"),
      confirmationToken: optionalReference(payload.confirmationToken, "confirmation token"),
      confirmationScopeDigest: optionalDigest(payload.confirmationScopeDigest, "confirmation scope digest"),
      input: parseInput(payload.input)
    };
  }

  private requireHardwareSignalCompletion(payload: unknown): HardwareSignalCompletionPayload {
    if (!isRecord(payload) || !allowedExactKeys(payload, ["signalId", "claimToken", "windowSessionId", "workspaceRoots", "outcome", "summary"], ["dispatchReceiptId", "dispatchSessionId", "repositoryRoot"])
      || !hardwareCompletionOutcome(payload.outcome) || typeof payload.summary !== "string" || !payload.summary.trim() || payload.summary.length > 512
      || (payload.dispatchReceiptId !== undefined && (typeof payload.dispatchReceiptId !== "string" || !/^hardware-dispatch:[a-f0-9]{64}$/.test(payload.dispatchReceiptId)))
      || (payload.dispatchSessionId !== undefined && !boundedReferenceValue(payload.dispatchSessionId))
      || (payload.repositoryRoot !== undefined && !boundedHostPath(payload.repositoryRoot))) throw new CompanionServiceError("invalid_request", "Hardware signal completion requires an exact live claim, bounded outcome, and server-issued dispatch receipt when handled.");
    return { ...parseHardwareClaimReference(payload), outcome: payload.outcome, summary: payload.summary, ...(typeof payload.dispatchReceiptId === "string" ? { dispatchReceiptId: payload.dispatchReceiptId } : {}), ...(typeof payload.dispatchSessionId === "string" ? { dispatchSessionId: payload.dispatchSessionId } : {}), ...(typeof payload.repositoryRoot === "string" ? { repositoryRoot: payload.repositoryRoot } : {}) };
  }

  private async requireFocusedWindowBinding(payload: HardwareSignalClaimPayload): Promise<HardwareSignalClaimBinding> {
    const session = this.requireSession(payload.windowSessionId);
    if (session.surface !== "vscode_window" || session.metadata["sxsy-b122.kind"] !== "window" || !session.capabilities.includes("registered") || session.status === "stale" || session.status === "unreachable") {
      throw new CompanionServiceError("capability_denied", "Hardware signals may be claimed only by a current Registered VS Code window session.");
    }
    let registeredRoots: unknown;
    try { registeredRoots = JSON.parse(session.metadata["sxsy-b122.workspaceRoots"] ?? "null"); } catch { registeredRoots = undefined; }
    if (!Array.isArray(registeredRoots) || registeredRoots.length < 1 || !registeredRoots.every((root) => typeof root === "string" && boundedHostPath(root))) throw new CompanionServiceError("capability_denied", "The focused VS Code window has no valid Registered workspace-root record.");
    const [canonicalRegistered, canonicalClaimed] = await Promise.all([
      Promise.all(registeredRoots.map((root) => this.canonicalizeHostPath(root))),
      Promise.all(payload.workspaceRoots.map((root) => this.canonicalizeHostPath(root)))
    ]);
    if (new Set(canonicalClaimed.map(normalizeHostPath)).size !== canonicalClaimed.length || !sameHostRoots(canonicalRegistered, canonicalClaimed)) throw new CompanionServiceError("capability_denied", "The focused VS Code window workspace binding does not match its canonical Registered host record.");
    return { windowSessionId: payload.windowSessionId, workspaceRoots: canonicalClaimed };
  }

  private async assertHardwareDispatchSession(claim: HardwareSignalClaim, sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    if (!session.capabilities.includes("registered") || session.status === "stale" || session.status === "unreachable") {
      throw new CompanionServiceError("capability_denied", "The selected hardware dispatch session is no longer a current Registered session.");
    }
    if (sessionId === claim.windowSessionId) {
      let registeredRoots: unknown;
      try { registeredRoots = JSON.parse(session.metadata["sxsy-b122.workspaceRoots"] ?? "null"); } catch { registeredRoots = undefined; }
      if (session.surface !== "vscode_window" || session.metadata["sxsy-b122.kind"] !== "window" || !Array.isArray(registeredRoots)
        || registeredRoots.length < 1 || !registeredRoots.every((root) => typeof root === "string" && boundedHostPath(root))) {
        throw new CompanionServiceError("capability_denied", "The focused hardware window session no longer has its exact Registered workspace binding.");
      }
      const canonicalRoots = await Promise.all(registeredRoots.map((root) => this.canonicalizeHostPath(root as string)));
      if (!sameHostRoots(canonicalRoots, claim.workspaceRoots)) {
        throw new CompanionServiceError("capability_denied", "The focused hardware window workspace binding changed after claim.");
      }
      return;
    }
    const sessionRoot = session.workspaceRoot ? await this.canonicalizeHostPath(session.workspaceRoot) : undefined;
    if (!sessionRoot || !claim.workspaceRoots.some((root) => normalizeHostPath(root) === normalizeHostPath(sessionRoot))) {
      throw new CompanionServiceError("capability_denied", "The selected hardware dispatch session is outside the exact focused-window workspace binding.");
    }
  }

  private requireRegistration(payload: unknown): SessionRegistrationPayload {
    if (!isRecord(payload) || !isRecord(payload.session)) throw new CompanionServiceError("invalid_request", "A session registration requires a session record.");
    return { session: payload.session as unknown as ManagedSession };
  }

  private requireAdoption(payload: unknown): SessionAdoptionPayload {
    if (!isRecord(payload) || typeof payload.sessionId !== "string" || typeof payload.adoptionKey !== "string" || !isTerminalProvider(payload.provider)) {
      throw new CompanionServiceError("invalid_request", "A terminal adoption requires a session ID, stable adoption key, and known provider.");
    }
    return { sessionId: payload.sessionId, adoptionKey: payload.adoptionKey, provider: payload.provider };
  }

  private requireStatus(payload: unknown): SessionStatusPayload {
    if (!isRecord(payload) || typeof payload.sessionId !== "string" || !isSessionStatus(payload.status)) {
      throw new CompanionServiceError("invalid_request", "A session status update requires a known session ID and status.");
    }
    return { sessionId: payload.sessionId, status: payload.status };
  }

  private requireHeartbeat(payload: unknown): SessionHeartbeatPayload {
    if (!isRecord(payload) || typeof payload.sessionId !== "string" || (payload.at !== undefined && typeof payload.at !== "string")) {
      throw new CompanionServiceError("invalid_request", "A heartbeat requires a known session ID and optional timestamp.");
    }
    return { sessionId: payload.sessionId, at: payload.at };
  }

  private requireDispatch(payload: unknown): DispatchPayload {
    if (!isRecord(payload) || !allowedExactKeys(payload, ["control", "modifier"], ["sessionId", "authorityId", "confirmationToken", "confirmationScopeDigest", "input"])
      || !isControl(payload.control) || !isModifier(payload.modifier)) {
      throw new CompanionServiceError("invalid_request", "A command dispatch requires a canonical B122 control and modifier.");
    }
    if (payload.sessionId !== undefined && typeof payload.sessionId !== "string") {
      throw new CompanionServiceError("invalid_request", "A command dispatch session ID must be a string.");
    }
    return {
      control: payload.control,
      modifier: payload.modifier,
      sessionId: payload.sessionId,
      authorityId: optionalReference(payload.authorityId, "authority ID"),
      confirmationToken: optionalReference(payload.confirmationToken, "confirmation token"),
      confirmationScopeDigest: optionalDigest(payload.confirmationScopeDigest, "confirmation scope digest"),
      input: parseInput(payload.input)
    };
  }

  private requireCancellation(payload: unknown): OperationCancellationPayload {
    if (!isRecord(payload) || typeof payload.operationId !== "string" || typeof payload.reason !== "string" || !payload.operationId.trim() || !payload.reason.trim() || payload.operationId.length > 256 || payload.reason.length > 512) {
      throw new CompanionServiceError("invalid_request", "An operation cancellation requires bounded operation ID and reason values.");
    }
    return { operationId: payload.operationId, reason: payload.reason };
  }

  private requireConfirmation(payload: unknown): ConfirmationRequestPayload {
    if (!isRecord(payload) || typeof payload.action !== "string" || !(commandActionIds as readonly string[]).includes(payload.action)
      || typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 512
      || (payload.sessionId !== undefined && typeof payload.sessionId !== "string")
      || (payload.authorityId !== undefined && typeof payload.authorityId !== "string")) {
      throw new CompanionServiceError("invalid_request", "A confirmation request requires a known action, bounded reason, and optional opaque session/authority references.");
    }
    return { action: payload.action as CommandAction, reason: payload.reason, ...(payload.sessionId ? { sessionId: payload.sessionId } : {}), ...(payload.authorityId ? { authorityId: payload.authorityId } : {}) };
  }

  private requireCommandPreparation(payload: unknown): CommandPreparationPayload {
    if (!isRecord(payload) || !allowedExactKeys(payload, ["control", "modifier", "reason"], ["sessionId", "reviewScopeDigest"]) || !isControl(payload.control) || !isModifier(payload.modifier)
      || typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 512
      || (payload.sessionId !== undefined && typeof payload.sessionId !== "string")
      || (payload.reviewScopeDigest !== undefined && (typeof payload.reviewScopeDigest !== "string" || !/^[a-f0-9]{64}$/.test(payload.reviewScopeDigest)))) {
      throw new CompanionServiceError("invalid_request", "Command preparation requires a canonical chord, bounded host reason, and optional exact session ID.");
    }
    return { control: payload.control, modifier: payload.modifier, reason: payload.reason, ...(payload.sessionId ? { sessionId: payload.sessionId } : {}), ...(typeof payload.reviewScopeDigest === "string" ? { reviewScopeDigest: payload.reviewScopeDigest } : {}) };
  }

  private requireHostActionCompletion(payload: unknown): HostActionCompletionPayload {
    if (!isRecord(payload)
      || typeof payload.hostActionId !== "string" || !/^host-action:[a-f0-9]{64}$/.test(payload.hostActionId)
      || typeof payload.succeeded !== "boolean"
      || (payload.effectDisposition !== undefined && !["not_started", "committed", "ambiguous"].includes(payload.effectDisposition as string))
      || (payload.succeeded === true && payload.effectDisposition !== undefined && payload.effectDisposition !== "committed")
      || (payload.succeeded === false && payload.effectDisposition === "committed")
      || typeof payload.summary !== "string" || !payload.summary.trim() || payload.summary.length > 512
      || typeof payload.adapterVersion !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(payload.adapterVersion)
      || Object.keys(payload).some((key) => !["hostActionId", "succeeded", "effectDisposition", "summary", "adapterVersion", "authorizationToken"].includes(key))) {
      throw new CompanionServiceError("invalid_request", "A host-action acknowledgement requires an exact durable ID, outcome, bounded summary, and adapter version.");
    }
    if (payload.authorizationToken !== undefined && (typeof payload.authorizationToken !== "string" || !/^host-action-auth:[a-f0-9]{64}$/.test(payload.authorizationToken))) {
      throw new CompanionServiceError("invalid_request", "The host-action completion authorization token is malformed.");
    }
    const effectDisposition = (payload.effectDisposition ?? (payload.succeeded ? "committed" : "not_started")) as "not_started" | "committed" | "ambiguous";
    return { hostActionId: payload.hostActionId, succeeded: payload.succeeded, effectDisposition, summary: payload.summary, adapterVersion: payload.adapterVersion, ...(payload.authorizationToken ? { authorizationToken: payload.authorizationToken } : {}) };
  }

  private requireHostActionAuthorization(payload: unknown): HostActionAuthorizationPayload {
    if (!isRecord(payload)
      || typeof payload.hostActionId !== "string" || !/^host-action:[a-f0-9]{64}$/.test(payload.hostActionId)
      || typeof payload.adapterVersion !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(payload.adapterVersion)
      || (payload.selectionId !== undefined && (typeof payload.selectionId !== "string" || !/^(?:pull|run):[A-Za-z0-9._:-]{1,128}$/.test(payload.selectionId)))
      || Object.keys(payload).some((key) => key !== "hostActionId" && key !== "adapterVersion" && key !== "selectionId")) {
      throw new CompanionServiceError("invalid_request", "Host-action authorization requires an exact durable ID and adapter version.");
    }
    return { hostActionId: payload.hostActionId, adapterVersion: payload.adapterVersion, ...(typeof payload.selectionId === "string" ? { selectionId: payload.selectionId } : {}) };
  }

  private requireGitReview(payload: unknown): GitReviewPayload {
    if (!isRecord(payload) || !isGitReviewAction(payload.action) || typeof payload.sessionId !== "string" || !payload.sessionId.trim() || payload.sessionId.length > 256) {
      throw new CompanionServiceError("invalid_request", "Git review requires an exact action and managed session ID.");
    }
    return { action: payload.action, sessionId: payload.sessionId, mutation: parseGitMutation(payload.mutation) };
  }

  private requireGitReviewInspect(payload: unknown): GitReviewInspectPayload {
    if (!isRecord(payload) || !boundedReferenceValue(payload.sessionId) || Object.keys(payload).length !== 1) {
      throw new CompanionServiceError("invalid_request", "Git review inspection requires one exact managed session ID.");
    }
    return { sessionId: payload.sessionId };
  }

  private requireHandoffCreate(payload: unknown): HandoffCreatePayload {
    const required = ["sessionId", "plan", "decisions", "documentation", "references", "constraints", "openQuestions", "nextActions"];
    if (!isRecord(payload) || !allowedExactKeys(payload, required, ["recipientSessionId", "routing", "authorityId"]) || !boundedReferenceValue(payload.sessionId)
      || typeof payload.plan !== "string" || !payload.plan.trim() || payload.plan.length > 16_384 || /\0/.test(payload.plan)
      || (payload.recipientSessionId !== undefined && !boundedReferenceValue(payload.recipientSessionId))
      || (payload.authorityId !== undefined && !boundedReferenceValue(payload.authorityId))
      || (payload.routing !== undefined && payload.routing !== "queue" && payload.routing !== "immediate")) throw new CompanionServiceError("invalid_request", "Handoff creation requires exact bounded context fields and one managed source session.");
    return { sessionId: payload.sessionId, plan: payload.plan, decisions: boundedStringList(payload.decisions, "handoff decision"), documentation: boundedStringList(payload.documentation, "handoff documentation"), references: boundedStringList(payload.references, "handoff reference"), constraints: boundedStringList(payload.constraints, "handoff constraint"), openQuestions: boundedStringList(payload.openQuestions, "handoff open question"), nextActions: boundedStringList(payload.nextActions, "handoff next action"), ...(typeof payload.recipientSessionId === "string" ? { recipientSessionId: payload.recipientSessionId } : {}), ...(payload.routing === "queue" || payload.routing === "immediate" ? { routing: payload.routing } : {}), ...(typeof payload.authorityId === "string" ? { authorityId: payload.authorityId } : {}) };
  }

  private requireHandoffReference(payload: unknown, recipientRequired: boolean): HandoffReferencePayload {
    if (!isRecord(payload) || !allowedExactKeys(payload, ["handoffId", ...(recipientRequired ? ["recipientSessionId"] : [])], recipientRequired ? [] : ["recipientSessionId"]) || !boundedReferenceValue(payload.handoffId) || (payload.recipientSessionId !== undefined && !boundedReferenceValue(payload.recipientSessionId))) throw new CompanionServiceError("invalid_request", "Handoff request requires an exact package ID and, for acknowledgement, exact recipient session.");
    return { handoffId: payload.handoffId, ...(typeof payload.recipientSessionId === "string" ? { recipientSessionId: payload.recipientSessionId } : {}) };
  }
  private requireHandoffRouting(payload: unknown): HandoffRoutingPayload { if (!isRecord(payload) || !exactKeys(payload, ["routing"]) || (payload.routing !== "queue" && payload.routing !== "immediate")) throw new CompanionServiceError("invalid_request", "Handoff routing must be exactly queue or immediate."); return { routing: payload.routing }; }

  private requireWorkflowPrepare(payload: unknown): WorkflowPreparePayload {
    if (!isRecord(payload) || !exactKeys(payload, ["action", "sessionId", "authorityId", "intent"]) || !workflowArtifactAction(payload.action) || !boundedReferenceValue(payload.sessionId) || !boundedReferenceValue(payload.authorityId)) throw new CompanionServiceError("invalid_request", "Workflow preparation requires an exact supported action, managed session, host-issued authority, and bounded intent.");
    return { action: payload.action, sessionId: payload.sessionId, authorityId: payload.authorityId, intent: workflowPreparationIntent(payload.intent) };
  }

  private requireWorkflowCancel(payload: unknown): WorkflowCancelPayload {
    if (!isRecord(payload) || !exactKeys(payload, ["artifactId", "sessionId", "authorityId"])
      || !boundedReferenceValue(payload.artifactId) || !boundedReferenceValue(payload.sessionId) || !boundedReferenceValue(payload.authorityId)) {
      throw new CompanionServiceError("invalid_request", "Workflow cancellation requires one exact prepared artifact, managed session, and host-issued authority.");
    }
    return { artifactId: payload.artifactId, sessionId: payload.sessionId, authorityId: payload.authorityId };
  }

  private requireVoiceConsent(payload: unknown): VoiceConsentPayload {
    if (!isRecord(payload) || !exactKeys(payload, ["handoffId", "provider", "transcript", "retentionMinutes", "expiresInMinutes"]) || !boundedReferenceValue(payload.handoffId)
      || (payload.provider !== "claude" && payload.provider !== "chatgpt" && payload.provider !== "system") || (payload.transcript !== "off" && payload.transcript !== "redacted")
      || !Number.isInteger(payload.retentionMinutes) || (payload.retentionMinutes as number) < 0 || (payload.retentionMinutes as number) > 1_440
      || !Number.isInteger(payload.expiresInMinutes) || (payload.expiresInMinutes as number) < 1 || (payload.expiresInMinutes as number) > 60) throw new CompanionServiceError("invalid_request", "Voice consent requires one Handoff, provider, privacy policy, bounded retention, and a short expiry.");
    return { handoffId: payload.handoffId, provider: payload.provider, transcript: payload.transcript, retentionMinutes: payload.retentionMinutes as number, expiresInMinutes: payload.expiresInMinutes as number };
  }
  private requireVoiceStart(payload: unknown): VoiceStartPayload { if (!isRecord(payload) || !allowedExactKeys(payload, ["consentId", "voiceSessionId"], ["managedSessionId"]) || !boundedReferenceValue(payload.consentId) || !boundedReferenceValue(payload.voiceSessionId) || (payload.managedSessionId !== undefined && !boundedReferenceValue(payload.managedSessionId))) throw new CompanionServiceError("invalid_request", "Voice start requires exact consent and voice-session IDs."); return { consentId: payload.consentId, voiceSessionId: payload.voiceSessionId, ...(typeof payload.managedSessionId === "string" ? { managedSessionId: payload.managedSessionId } : {}) }; }
  private requireVoiceSwitch(payload: unknown): VoiceSwitchPayload { if (!isRecord(payload) || !exactKeys(payload, ["bindingId", "consentId", "voiceSessionId"]) || !boundedReferenceValue(payload.bindingId) || !boundedReferenceValue(payload.consentId) || !boundedReferenceValue(payload.voiceSessionId)) throw new CompanionServiceError("invalid_request", "Voice switch requires exact binding, consent, and voice-session IDs."); return { bindingId: payload.bindingId, consentId: payload.consentId, voiceSessionId: payload.voiceSessionId }; }
  private requireVoiceBinding(payload: unknown): VoiceBindingPayload { if (!isRecord(payload) || !exactKeys(payload, ["bindingId", "managedSessionId"]) || !boundedReferenceValue(payload.bindingId) || !boundedReferenceValue(payload.managedSessionId)) throw new CompanionServiceError("invalid_request", "Voice binding requires exact voice and managed-session IDs."); return { bindingId: payload.bindingId, managedSessionId: payload.managedSessionId }; }
  private requireVoiceReference(payload: unknown, reasonRequired: boolean): VoiceReferencePayload { if (!isRecord(payload) || !allowedExactKeys(payload, ["bindingId", ...(reasonRequired ? ["reason"] : [])], reasonRequired ? [] : ["reason"]) || !boundedReferenceValue(payload.bindingId) || (payload.reason !== undefined && !boundedReferenceValue(payload.reason))) throw new CompanionServiceError("invalid_request", "Voice request requires an exact binding ID and bounded reason where applicable."); return { bindingId: payload.bindingId, ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}) }; }

  private requireSession(id: string): ManagedSession {
    const session = this.sessions.get(id);
    if (!session) throw new CompanionServiceError("not_found", "The requested managed session is not registered with this companion.");
    return session;
  }

  private record(action: string, status: AuditEvent["status"], detail: string, sessionId?: string, operationId?: string): void {
    this.audit.push({
      id: this.idFactory(),
      action,
      status,
      operationId,
      at: this.now(),
      detail: sessionId ? `${detail} Session: ${sessionId}.` : detail
    });
  }

  private success(id: string, result: unknown): CompanionResponse {
    return { version: companionBridgeVersion, id, ok: true, result };
  }

  private failure(id: string, code: CompanionError["code"], message: string): CompanionResponse {
    return { version: companionBridgeVersion, id, ok: false, error: { code, message } };
  }
}

class CompanionServiceError extends Error {
  readonly code: CompanionError["code"];

  constructor(code: CompanionError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const statusValues = ["running", "verified_blocked", "verified_finished", "unreachable", "stale", "unknown"] as const;
const capabilityValues = ["registered", "observable", "controllable", "mediated"] as const;
const modifierValues = ["normal", "shift", "alt", "shift_alt", "ctrl", "ctrl_shift", "ctrl_alt", "ctrl_shift_alt"] as const;

function parseManagedSession(value: unknown): ManagedSession {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || !isProvider(value.provider) || !isSurface(value.surface)) {
    throw new CompanionServiceError("invalid_request", "A session must include a non-empty ID, provider, and supported surface.");
  }
  if (!Array.isArray(value.capabilities) || !value.capabilities.every(isCapability) || !isSessionStatus(value.status)) {
    throw new CompanionServiceError("invalid_request", "A session must include a valid capability set and status.");
  }
  if (!Array.isArray(value.plannedFiles) || !value.plannedFiles.every((file) => typeof file === "string") || typeof value.lastHeartbeat !== "string" || typeof value.adapterVersion !== "string") {
    throw new CompanionServiceError("invalid_request", "A session must include planned files, heartbeat, and adapter version.");
  }
  const metadata = parseStringRecord(value.metadata);
  return {
    id: value.id,
    provider: value.provider,
    surface: value.surface,
    capabilities: normalizeCapabilities(value.capabilities),
    status: value.status,
    workspaceRoot: optionalString(value.workspaceRoot),
    targetSnapshotId: optionalString(value.targetSnapshotId),
    taskId: optionalString(value.taskId),
    planRevision: optionalString(value.planRevision),
    plannedFiles: value.plannedFiles,
    lastHeartbeat: value.lastHeartbeat,
    adapterVersion: value.adapterVersion,
    metadata
  };
}

function parseInput(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).length > 20) {
    throw new CompanionServiceError("invalid_request", "Command input must be a bounded map of named string values.");
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) || typeof item !== "string" || item.length > 512) {
      throw new CompanionServiceError("invalid_request", "Command input contains an invalid name or value.");
    }
    result[key] = item;
  }
  return result;
}

function parseStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) throw new CompanionServiceError("invalid_request", "Session metadata must be a string map.");
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || item.length > 512) throw new CompanionServiceError("invalid_request", "Session metadata values must be bounded strings.");
    result[key] = item;
  }
  return result;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new CompanionServiceError("invalid_request", "Optional session fields must be strings.");
  return value;
}

function optionalReference(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\r\n\0]/.test(value)) {
    throw new CompanionServiceError("invalid_request", `A command dispatch ${label} must be a bounded opaque reference.`);
  }
  return value;
}

function optionalDigest(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new CompanionServiceError("invalid_request", `A command dispatch ${label} must be one exact lowercase SHA-256 digest.`);
  }
  return value;
}

function normalizeCapabilities(values: readonly Capability[]): readonly Capability[] {
  return [...new Set(values.filter(isCapability))];
}

function cloneSession(session: ManagedSession): ManagedSession {
  return {
    ...session,
    capabilities: [...session.capabilities],
    plannedFiles: [...session.plannedFiles],
    metadata: { ...session.metadata }
  };
}

function isCancellableExecutor(value: MediatedCommandExecutor | undefined): value is CancellableMediatedCommandExecutor {
  return !!value && typeof (value as Partial<CancellableMediatedCommandExecutor>).cancelOperation === "function";
}

function isConfirmationCapableExecutor(value: MediatedCommandExecutor | undefined): value is ConfirmationCapableMediatedCommandExecutor {
  return !!value && typeof (value as Partial<ConfirmationCapableMediatedCommandExecutor>).requestConfirmation === "function";
}

function voiceServiceFailure(error: unknown): CompanionServiceError {
  if (error instanceof CompanionServiceError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "deletion_incomplete") return new CompanionServiceError("companion_unavailable", "Local voice transcript keys were destroyed, but external provider deletion could not be confirmed.");
  if (code === "provider_unavailable" || code === "deadline" || code === "cancelled") return new CompanionServiceError("companion_unavailable", "The exact configured voice runtime is unavailable or did not complete within its bounded lifecycle.");
  return new CompanionServiceError("capability_denied", "The voice request no longer matches its exact consent, provider, target, and managed-session binding.");
}

function parseGitMutation(value: unknown): GitMutation {
  if (!isRecord(value) || typeof value.kind !== "string") throw new CompanionServiceError("invalid_request", "Git review requires a typed mutation record.");
  switch (value.kind) {
    case "local_commit":
      exactMutationKeys(value, ["kind", "paths", "message", ...(value.featureBranch === undefined ? [] : ["featureBranch"])]);
      if (!Array.isArray(value.paths) || !value.paths.length || value.paths.length > 256 || !value.paths.every((path) => typeof path === "string" && path.length <= 512)
        || typeof value.message !== "string" || !value.message.trim() || value.message.length > 120
        || (value.featureBranch !== undefined && typeof value.featureBranch !== "string")) throw new CompanionServiceError("invalid_request", "Local commit review requires bounded paths, message, and optional feature branch.");
      return { kind: "local_commit", paths: value.paths, message: value.message, ...(typeof value.featureBranch === "string" ? { featureBranch: value.featureBranch } : {}) };
    case "pr_upsert":
      exactMutationKeys(value, ["kind", "headBranch", "baseBranch", "title", "body"]);
      if (typeof value.headBranch !== "string" || typeof value.baseBranch !== "string"
        || typeof value.title !== "string" || !value.title.trim() || value.title.length > 256 || /[\r\n\0]/.test(value.title)
        || typeof value.body !== "string" || value.body.length > 16_384 || /\0/.test(value.body)) {
        throw new CompanionServiceError("invalid_request", "PR review requires exact bounded head, base, title, and body fields.");
      }
      return { kind: "pr_upsert", headBranch: value.headBranch, baseBranch: value.baseBranch, title: value.title, body: value.body };
    case "merge_pr":
      exactMutationKeys(value, ["kind", "pullRequest", "head", "baseBranch"]);
      if (!Number.isSafeInteger(value.pullRequest) || typeof value.head !== "string" || typeof value.baseBranch !== "string") throw new CompanionServiceError("invalid_request", "PR merge review requires exact pull request, head, and base values.");
      return { kind: "merge_pr", pullRequest: value.pullRequest as number, head: value.head, baseBranch: value.baseBranch };
    case "direct_main":
      exactMutationKeys(value, ["kind", "branch", "validationReceiptId"]);
      if (typeof value.branch !== "string" || typeof value.validationReceiptId !== "string") throw new CompanionServiceError("invalid_request", "Direct Main review requires an exact branch and validation receipt.");
      return { kind: "direct_main", branch: value.branch, validationReceiptId: value.validationReceiptId };
    default:
      throw new CompanionServiceError("invalid_request", "Git review mutation kind is unknown.");
  }
}

function exactMutationKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some((key) => !(key in value))) throw new CompanionServiceError("invalid_request", "Git review mutation contains an unknown or missing field.");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function allowedExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key));
}

function requireEmptyPayload(payload: unknown, label: string): void {
  if (payload !== undefined && (!isRecord(payload) || Object.keys(payload).length !== 0)) throw new CompanionServiceError("invalid_request", `${label} accepts no client options.`);
}

function boundedHostPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\r\n\0]/.test(value)
    && (isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value));
}

function credentialIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function parseHardwareBinding(value: Record<string, unknown>): HardwareSignalClaimBinding {
  if (!boundedReferenceValue(value.windowSessionId) || !Array.isArray(value.workspaceRoots) || value.workspaceRoots.length < 1 || value.workspaceRoots.length > 32
    || !value.workspaceRoots.every((root) => boundedHostPath(root)) || new Set(value.workspaceRoots.map((root) => normalizeHostPath(root as string))).size !== value.workspaceRoots.length) {
    throw new CompanionServiceError("invalid_request", "Hardware signal binding requires one exact window session and at least one unique absolute workspace root.");
  }
  return { windowSessionId: value.windowSessionId, workspaceRoots: value.workspaceRoots as string[] };
}

function parseHardwareClaimReference(value: Record<string, unknown>): HardwareSignalBindingPayload {
  const binding = parseHardwareBinding(value);
  if (typeof value.signalId !== "string" || !/^hardware-signal:[a-f0-9]{64}$/.test(value.signalId)
    || typeof value.claimToken !== "string" || !/^[A-Za-z0-9_-]{8,256}$/.test(value.claimToken)) {
    throw new CompanionServiceError("invalid_request", "Hardware signal request requires an exact durable signal ID and opaque live claim token.");
  }
  return { signalId: value.signalId, claimToken: value.claimToken, ...binding };
}

function sameHostRoots(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((root, index) => normalizeHostPath(root) === normalizeHostPath(right[index]!));
}

function boundedReferenceValue(value: unknown): value is string { return typeof value === "string" && !!value.trim() && value.length <= 512 && !/[\r\n\0]/.test(value); }
function boundedIdentifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function boundedReason(value: unknown): value is string { return typeof value === "string" && !!value.trim() && value.length <= 2_048 && !/\0/.test(value); }
function boundedStringList(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.length > 512 || !value.every((item) => typeof item === "string" && item.trim() && item.length <= 16_384 && !/\0/.test(item))) throw new CompanionServiceError("invalid_request", `${label} must be a bounded string list.`); return [...new Set(value.map((item) => (item as string).trim()))]; }
function workflowArtifactAction(value: unknown): value is WorkflowArtifactAction { return typeof value === "string" && ["reanchor", "proof", "proof_adversarial", "option_provider", "option_packet", "plan_expander", "plan_approval", "handoff", "handoff_queue", "handoff_immediate", "focus_blocked_agent", "focus_finished_agent", "authority_refresh", "authority_broadcast", "bind_voice_session"].includes(value); }
function workflowPreparationIntent(value: unknown): WorkflowPreparationIntent {
  if (!isRecord(value) || typeof value.kind !== "string") throw new CompanionServiceError("invalid_request", "Workflow intent must be one exact bounded record.");
  if (value.kind === "none" && exactKeys(value, ["kind"])) return { kind: "none" };
  if (value.kind === "decision" && exactKeys(value, ["kind", "question", "context"]) && boundedWorkflowText(value.question) && boundedWorkflowText(value.context)) return { kind: "decision", question: value.question, context: value.context };
  if (value.kind === "handoff" && exactKeys(value, ["kind", "recipientSessionId", "route"]) && boundedReferenceValue(value.recipientSessionId) && (value.route === "queue" || value.route === "immediate")) return { kind: "handoff", recipientSessionId: value.recipientSessionId, route: value.route };
  if (value.kind === "authority_broadcast" && exactKeys(value, ["kind", "recipientSessionIds"]) && Array.isArray(value.recipientSessionIds) && value.recipientSessionIds.length >= 1 && value.recipientSessionIds.length <= 64 && value.recipientSessionIds.every(boundedReferenceValue)) return { kind: "authority_broadcast", recipientSessionIds: [...new Set(value.recipientSessionIds as string[])] };
  if (value.kind === "plan_approval" && exactKeys(value, ["kind", "confirmationToken", "confirmationScopeDigest"])
    && boundedReferenceValue(value.confirmationToken) && typeof value.confirmationScopeDigest === "string" && /^[a-f0-9]{64}$/.test(value.confirmationScopeDigest)) {
    return { kind: "plan_approval", confirmationToken: value.confirmationToken, confirmationScopeDigest: value.confirmationScopeDigest };
  }
  throw new CompanionServiceError("invalid_request", "Workflow intent contains unsupported or unbounded client-authored fields.");
}
function boundedWorkflowText(value: unknown): value is string { return typeof value === "string" && !!value.trim() && value.length <= 16_384 && !/\0/.test(value); }
function uint16(value: unknown): value is number { return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff; }
function hardwareCompletionOutcome(value: unknown): value is HardwareSignalCompletionOutcome { return value === "handled" || value === "failed_before_dispatch" || value === "needs_reconciliation"; }

function normalizeHostPath(value: string): string { return value.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase(); }

function isCommandPreparationExecutor(value: MediatedCommandExecutor | undefined): value is CommandPreparationCapableMediatedCommandExecutor {
  return !!value && typeof (value as Partial<CommandPreparationCapableMediatedCommandExecutor>).prepareCommand === "function";
}

function isExternalCompletionExecutor(value: MediatedCommandExecutor | undefined): value is ExternalCompletionCapableMediatedCommandExecutor {
  return !!value && typeof (value as Partial<ExternalCompletionCapableMediatedCommandExecutor>).completeExternalOperation === "function";
}

function isControl(value: unknown): value is Control {
  return typeof value === "string" && (controls as readonly string[]).includes(value);
}

function isModifier(value: unknown): value is Modifier {
  return typeof value === "string" && (modifierValues as readonly string[]).includes(value);
}

function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (capabilityValues as readonly string[]).includes(value);
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && (statusValues as readonly string[]).includes(value);
}

function isProvider(value: unknown): value is ManagedSession["provider"] {
  return value === "claude" || value === "codex" || value === "generic" || value === "voice";
}

function isTerminalProvider(value: unknown): value is SessionAdoptionPayload["provider"] {
  return value === "claude" || value === "codex" || value === "generic";
}

function isGitReviewAction(value: unknown): value is GitReviewPayload["action"] {
  return value === "local_commit" || value === "pr_upsert" || value === "pr_merge" || value === "direct_main";
}

function isSurface(value: unknown): value is ManagedSession["surface"] {
  return value === "vscode_terminal" || value === "vscode_window" || value === "desktop" || value === "browser" || value === "bridge";
}
