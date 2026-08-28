import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import type { AutomationRequest, EffectGuard, IsolationRuntime, PermitVerifier } from "../../../packages/control-plane/src/brokers.ts";
import type { CommandDispatcherDependencies, DispatchReceiptEvidenceFactory, GitMutationFactory } from "../../../packages/control-plane/src/dispatch.ts";
import { GitCliInspector } from "../../../packages/control-plane/src/git-inspector.ts";
import { DurableMediatedExecutor, type DurableMediatedExecutorOptions, type TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import { sessionBindingDigest, SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { WorkspaceSnapshotResolver } from "../../../packages/control-plane/src/snapshot-resolver.ts";
import { TargetSnapshotFactory, targetSnapshotDigest, type SnapshotEnvironment } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, stableJson, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import type { AutomationEnvelope } from "../../../packages/control-plane/src/automation-protocol.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { createDefaultLocalComposition, type DefaultLocalComposition } from "./default-composition.ts";
import { GateEvidenceLedger } from "../../../packages/control-plane/src/acceptance-evidence.ts";
import { LedgerCouncilAutomaticAcceptanceGate } from "./council-runtime.ts";
import { DurableCompanionEndpoint } from "./durable-endpoint.ts";
import { DurableHostActionQueue } from "./host-actions.ts";
import { hostActionCommandActions } from "./host-actions.ts";
import { CompanionService } from "./service.ts";
import { DurableProviderMediatedFinalCurrent } from "./provider-mediated-final-current.ts";
import type { ConfiguredNetworkPolicy } from "./configured-network.ts";
import { ConfiguredProviderHostClient, ConfiguredProviderReanchorApplyPort, DurableConfiguredProviderOperationControl } from "./configured-provider-host.ts";
import { InstalledDurableReanchorRuntime } from "./reanchor-runtime.ts";
import { InstalledWorkflowContextPreparationCoordinator } from "./workflow-context-preparation.ts";
import type { UserSecretProtector } from "./windows-secret.ts";
import { DurableGitMutationReviewQueue } from "./git-review.ts";
import { DurableRepositoryRuntimeRegistry } from "./runtime-registry.ts";
import type { RepositoryExecutionRootProvider } from "./repository-runtime.ts";
import type { SandboxRepositoryRecipeRunner } from "./repository-runtime-broker.ts";
import type { HostReceiptEvidenceIssuer } from "./receipt-evidence.ts";
import type { ScannerFixtureResolver } from "./scanner-fixtures.ts";
import { AttestedRuntimePinCoordinator } from "./runtime-provisioning.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";
import { AttestedSandboxInstallationCoordinator, DurableSandboxInstallationRegistry, InstalledWindowsSandboxIsolationRuntime } from "./sandbox-installation.ts";
import { DurableContainmentManager } from "../../../packages/control-plane/src/containment.ts";
import { containmentIncidentReviewDigest } from "../../../packages/control-plane/src/containment-incidents.ts";
import { DurableCredentialReferenceVault } from "./durable-credentials.ts";
import { AttestedCredentialProvisioningCoordinator, AttestedNetworkPolicyCoordinator, DurableNetworkPolicyRegistry } from "./host-provisioning.ts";
import { AttestedProviderHandshakeCoordinator, DynamicConfiguredNetworkClient, providerCommandActions, type ProviderCommandTransport, type ProviderHandshakeCoordinator } from "./remote-adapters.ts";
import {
  AttestedProviderDispatchProfileCoordinator,
  ConfiguredProviderHostLifecycleIdentitySource,
  CredentialBackedProviderDispatchLeaseIssuer,
  DurableProviderDispatchContainmentSource,
  DurableProviderDispatchProfileRegistry,
  InstalledProviderDispatchFinalCurrent,
  LeaseInjectingProviderCommandTransport,
  PinnedProviderDispatchLeaseProfileSource
} from "./provider-dispatch-lease.ts";
import { protocolVersion } from "../../../packages/protocol/src/b122.ts";
import { mapFingerprint } from "../../../packages/protocol/src/raw-hid.ts";
import { DurableHardwareSignalInbox } from "./hardware-signal-queue.ts";
import { CompanionHardwareSignalDispatcher } from "./hardware-signal-dispatcher.ts";
import {
  AttestedRawHidInstallationCoordinator,
  DurableRawHidInstallationRegistry,
  InstalledRawHidSupervisor,
  type RawHidTransportFactory
} from "./raw-hid-installation.ts";
import { WindowsRawHidTransport } from "./raw-hid-protocol.ts";
import { LocalCheckpointCapture, LocalRecoveryArtifactVerifier } from "./local-checkpoints.ts";
import { HardwareSignalTriggerOperationQueueControl, HostActionOperationQueueControl, InstalledOperationControl, UnavailableInstalledRepositoryProcessSupervisor, WorkflowArtifactOperationQueueControl, type ExactOperationQueueControl } from "./operation-control.ts";
import { createExactProviderRecoveryRouter, HostOwnedOperationReconciler, InstalledReadOnlyObservationPort } from "./operation-recovery.ts";
import { SpawnCheckpointGitRunner } from "./local-checkpoints.ts";
import { CouncilCoordinator } from "../../../packages/control-plane/src/council.ts";
import type { RepositoryProcessSupervisor } from "./repository-runtime.ts";
import {
  DurableWorkflowPreparationCoordinator,
  WorkflowArtifactStore,
  WorkflowCoordinatorContextStore,
  type WorkflowCoordinatorContext,
  type WorkflowCoordinatorContextInput
} from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { HandoffPackageStore } from "../../../packages/control-plane/src/context-packages.ts";
import { VoiceCoordinator } from "../../../packages/control-plane/src/voice.ts";
import { HostValidatedRepositoryRecipeRunner } from "./repository-recipe-host-evidence.ts";
import { CouncilWorkspaceIsolationManager } from "./council-workspace-isolation.ts";
import { CouncilResourceHost, VaultBackedCouncilCredentialCapabilityPort } from "./council-resource-host.ts";
import { InstalledCouncilResourceBroker } from "./council-resource-broker.ts";
import { CouncilEpochLifecycleManager } from "./council-epoch-lifecycle.ts";
import { SessionFreshnessCoordinator } from "./session-freshness.ts";
import { AttestedContainmentReleaseCoordinator } from "./containment-release.ts";
import { AttestedContainmentHistoryRemediator } from "./containment-history-remediation.ts";
import {
  LocalProviderCommandGateway,
  ProviderGatewayRouteRouter,
  type AuthenticatedProviderGatewayClient,
  type ProviderGatewayBackend,
  type ProviderGatewayProvider
} from "./provider-gateway.ts";
import { createAcceptanceAdministration, type AcceptanceAdministration } from "./acceptance-administration.ts";
import {
  DurableScannerFixtureRegistry,
  createScannerFixtureAdministration,
  type ScannerFixtureAdministration
} from "./scanner-fixtures.ts";
import {
  AttestedProviderDesktopRegistry,
  InstalledProviderDesktopLifecycle,
  NodeProviderExecutableIdentityProbe,
  createFixedProviderDesktopCatalog,
  type FixedProviderDesktopPaths,
  type ProviderDesktopProcessPort
} from "./provider-desktop.ts";
import { InstalledProviderDesktopCommandAdapter, installedProviderDesktopActions } from "./provider-desktop-adapter.ts";
import { DurableProviderDesktopEffectLedger } from "./provider-desktop-effects.ts";
import { WindowsProviderDesktopProcessPort } from "./windows-provider-process.ts";
import { HybridVoiceGateway, type VoiceAudioPort, type VoiceProviderPort } from "./voice-gateway.ts";
import { ConfiguredVoiceProviderPort } from "./configured-voice-provider.ts";
import {
  SafeUnavailableVoiceAudioPort,
  SafeUnavailableVoiceProviderPort,
  WindowsVoiceAudioPort,
  WindowsVoiceProviderPort
} from "./windows-voice-port.ts";
import { InstalledVoiceConversationRuntime } from "./voice-runtime.ts";
import { WindowsErasableVoiceTranscriptVault } from "./windows-voice-transcript-vault.ts";
import { InstalledContainmentAssessmentPort, InstalledLocalContainmentAssessmentPort } from "./containment-assessment.ts";
import { createContainmentRemoteEvidenceAdministration, DurableContainmentRemoteEvidenceRegistry } from "./containment-remote-evidence.ts";
import { InstalledContainmentRemoteCoordinator } from "./containment-remote-host.ts";
import { DurableAutomationManifestReviewQueue } from "./automation-manifest-review.ts";
import { InstalledAutomationManifestCoordinator } from "./automation-manifest-coordinator.ts";
import { ConfiguredAutomationManifestProposalSource } from "./automation-proposal-source.ts";
import { DurableDebugStopBindingStore } from "./debug-stop.ts";
import { LocalMediatedGitHandler } from "./mediated-git.ts";
import {
  AutomationEffectExecutionError,
  createAutomationEffectRecoveryBinding,
  LocalAutomationEffectExecutor,
  NodeAutomationFilesystemPort,
  ProtectedStoreAutomationEffectJournal,
  type AutomationChildEffectPort,
  type AutomationChildEffectPorts,
  type AutomationEffectReceipt
} from "./automation-effect-executor.ts";
import {
  createArtifactResolvingAutomationChildPorts,
  type AutomationChildArtifactResolver,
  type AutomationChildExecutionFence,
  type AutomationTypedChildBackends
} from "./automation-child-effects.ts";
import { GitAutomationHostTargetObserver, InstalledAutomationEffectRuntime } from "./automation-installed-runtime.ts";
import { DurableEffectTargetTransitionCoordinator } from "./effect-target-transition.ts";
import { LedgerAutomationHighConsequenceAuthorization } from "./automation-high-consequence.ts";
import { InstalledAutomationRefreshGitCommitObserver, InstalledAutomationRefreshGitCommitPort } from "./automation-refresh-git.ts";

export interface DurableWindowsCompanionOptions {
  readonly policyVersion: string;
  readonly store?: ProtectedJsonStore;
  /** Host-owned DPAPI/NCrypt/service-backed journal signer; never a key supplied by the extension. */
  readonly journalAuthenticator?: JournalAuthenticator;
  /** Test harness only. Production startup refuses hash-chain-only stores. */
  readonly allowUnprotectedStoreForTests?: boolean;
  readonly targetResolver?: TargetResolver;
  /** Omit only to fail closed: consequential snapshots then remain incomplete. */
  readonly snapshotEnvironmentFor?: (input: Parameters<NonNullable<ConstructorParameters<typeof WorkspaceSnapshotResolver>[1]["environmentFor"]>>[0]) => SnapshotEnvironment;
  readonly enabledHighConsequenceActions?: readonly CommandAction[];
  /** Durable control-plane adapters (checkpoint, confirmation, budget, cancellation, recovery) owned by the reviewed host. */
  readonly runtime?: Omit<DurableMediatedExecutorOptions, "store" | "sessions" | "policyVersion" | "targetResolver" | "enabledHighConsequenceActions" | "dependencies" | "receiptEvidence">;
  readonly dependencies?: DurableMediatedExecutorOptions["dependencies"];
  readonly receiptEvidence?: DispatchReceiptEvidenceFactory;
  /** Explicit install-state directory used by disposable local broker work. */
  readonly localStateDirectory?: string;
  /**
   * Enables the concrete local-commit handler. It still needs a reviewed
   * mutation factory; no chord can invent a commit message or path set.
   */
  readonly localGitStateDirectory?: string;
  readonly localGitMutationFactory?: GitMutationFactory;
  /** Required by the installed composition; tests may inject a fake protector. */
  readonly credentialProtector?: UserSecretProtector;
  /** Host-loaded, validated exact HTTPS routes. Empty or omitted means no outbound route. */
  readonly networkPolicy?: ConfiguredNetworkPolicy;
  /** Host-owned Windows user-presence verifier for runtime pin changes. */
  readonly runtimePinPresence?: WindowsUserPresenceRunner;
  /** Fixed-helper process supervisor used by installed repository recipes. */
  readonly repositoryProcessSupervisor?: RepositoryProcessSupervisor;
  /** Host-native repository/disposable execution roots. */
  readonly repositoryExecutionRoots?: RepositoryExecutionRootProvider;
  /** Platform-native host-evidenced repository sandbox composition. */
  readonly repositorySandboxFactory?: (input: Readonly<{
    runtimes: DurableRepositoryRuntimeRegistry;
    issuer: HostReceiptEvidenceIssuer;
    scannerFixtures: ScannerFixtureResolver;
  }>) => SandboxRepositoryRecipeRunner;
  /** Host-native isolation implementation. Linux supplies Bubblewrap here. */
  readonly hostIsolationRuntime?: IsolationRuntime;
  /** Fixed packaged b122-sandbox-worker.exe. Omit to keep OS isolation unavailable. */
  readonly sandboxHelperPath?: string;
  /** Fixed packaged strathex-b122-hid-helper.exe. Never supplied by a client. */
  readonly rawHidHelperPath?: string;
  /** Isolated tests may replace only process creation, never the pinned path or identity. */
  readonly rawHidTransportFactory?: RawHidTransportFactory;
  /** Installed Claude/Codex adapters. No provider is contacted when this is empty. */
  readonly providerGatewayBackends?: readonly ProviderGatewayBackend[];
  /** Explicit opt-in required for any backend that is not local to this host. */
  readonly authorizedExternalProviderGatewayProviders?: readonly ProviderGatewayProvider[];
  /** Host-owned fixed executable catalog; no IPC payload can add or replace a path. */
  readonly providerDesktopPaths?: FixedProviderDesktopPaths;
  /** Fixed packaged native helper identity used for desktop focus/launch. */
  readonly providerDesktopHelperPath?: string;
  readonly providerDesktopHelperSha256?: string;
  /** Isolated tests may replace only the native process boundary. */
  readonly providerDesktopProcessPort?: ProviderDesktopProcessPort;
  /** Fixed packaged native microphone/provider helper; never supplied over IPC. */
  readonly voiceHelperPath?: string;
  readonly voiceHelperSha256?: string;
  /** Isolated tests may replace the voice ports, never production IPC callers. */
  readonly voiceAudioPort?: VoiceAudioPort;
  readonly voiceProviderPorts?: readonly VoiceProviderPort[];
  /** Separately reviewed host artifacts for gate-accepted LFG/Repair typed children. */
  readonly automationChildArtifacts?: AutomationChildArtifactResolver;
  /** Host-local typed backends only; no provider route is accepted as an effect backend. */
  readonly automationChildBackends?: AutomationTypedChildBackends;
}

interface CouncilRepositoryCancellationControl {
  cancelRepository(repositoryRoot: string, reason: string): Promise<readonly Readonly<{ id: string }>[] >;
}

/**
 * Constructs the durable software-only companion. It is deliberately not an
 * installer or automatic service launcher: a reviewed host starts the local
 * stdio endpoint and supplies any real adapter/broker dependencies.
 */
export function createDurableWindowsCompanion(options: DurableWindowsCompanionOptions): {
  readonly store: ProtectedJsonStore;
  readonly sessions: SessionRegistry;
  readonly executor: DurableMediatedExecutor;
  readonly service: CompanionService;
  readonly endpoint: DurableCompanionEndpoint;
  readonly localComponents?: DefaultLocalComposition;
  readonly hostActions: DurableHostActionQueue;
  readonly gitReviews?: DurableGitMutationReviewQueue;
  readonly repositoryRuntimes: DurableRepositoryRuntimeRegistry;
  readonly runtimePins?: AttestedRuntimePinCoordinator;
  readonly sandboxInstallationRegistry?: DurableSandboxInstallationRegistry;
  readonly sandboxInstallations?: AttestedSandboxInstallationCoordinator;
  readonly credentialVault: DurableCredentialReferenceVault;
  readonly credentialProvisioning?: AttestedCredentialProvisioningCoordinator;
  readonly networkPolicyRegistry: DurableNetworkPolicyRegistry;
  readonly networkPolicyProvisioning?: AttestedNetworkPolicyCoordinator;
  readonly providerDispatchProfiles: DurableProviderDispatchProfileRegistry;
  readonly providerDispatchProfileProvisioning?: AttestedProviderDispatchProfileCoordinator;
  readonly providerHandshakes?: ProviderHandshakeCoordinator;
  readonly providerGateway: AuthenticatedProviderGatewayClient;
  readonly hardwareSignals: DurableHardwareSignalInbox;
  readonly hardwareSignalDispatcher: CompanionHardwareSignalDispatcher;
  readonly checkpointCapture: LocalCheckpointCapture | NonNullable<DurableMediatedExecutorOptions["checkpointCapture"]>;
  readonly checkpointVerifier: LocalRecoveryArtifactVerifier | NonNullable<DurableMediatedExecutorOptions["checkpointVerifier"]>;
  readonly operationControl: InstalledOperationControl;
  readonly handoffs: HandoffPackageStore;
  readonly workflowArtifacts: WorkflowArtifactStore;
  readonly workflowContexts: WorkflowCoordinatorContextStore;
  readonly voice: VoiceCoordinator;
  readonly transcriptVault: WindowsErasableVoiceTranscriptVault;
  readonly voiceGateway: HybridVoiceGateway;
  readonly voiceRuntime: InstalledVoiceConversationRuntime;
  readonly councilIsolation: CouncilWorkspaceIsolationManager;
  readonly councilResources: InstalledCouncilResourceBroker;
  readonly councilLifecycle: CouncilEpochLifecycleManager;
  readonly rawHidInstallationRegistry?: DurableRawHidInstallationRegistry;
  readonly rawHidInstallations?: AttestedRawHidInstallationCoordinator;
  readonly rawHidSupervisor?: InstalledRawHidSupervisor;
  readonly containmentHistory?: AttestedContainmentHistoryRemediator;
  readonly containmentRemote?: InstalledContainmentRemoteCoordinator;
  readonly acceptanceAdministration?: AcceptanceAdministration;
  readonly scannerFixtures: DurableScannerFixtureRegistry;
  readonly scannerAdministration?: ScannerFixtureAdministration;
  readonly providerDesktopRegistry?: AttestedProviderDesktopRegistry;
  readonly reanchor?: InstalledDurableReanchorRuntime;
  readonly automationManifestReviews: DurableAutomationManifestReviewQueue;
  readonly automationManifestCoordinator: InstalledAutomationManifestCoordinator;
  readonly debugStops: DurableDebugStopBindingStore;
  registerTrustedSession(session: ManagedSession): Promise<ManagedSession>;
  registerTrustedWorkflowContext(input: WorkflowCoordinatorContextInput): Promise<WorkflowCoordinatorContext>;
} {
  const store = options.store ?? new ProtectedJsonStore({
    ...(options.journalAuthenticator ? { authenticator: options.journalAuthenticator } : {}),
    requireAuthenticatedProtection: true
  });
  if (!options.allowUnprotectedStoreForTests && !store.hasAuthenticatedProtection) {
    throw new Error("The durable B122 companion requires a host-backed journal authenticator; unprotected hash-chain storage is rejected.");
  }
  const sessions = new SessionRegistry(store);
  const runtimeAuthorities = options.runtime?.authorities ?? new AuthorityLedger(store, {
    clock: () => (options.runtime?.now?.() ?? new Date()).toISOString()
  });
  let executor!: DurableMediatedExecutor;
  let reanchorRuntime: InstalledDurableReanchorRuntime | undefined;
  const sessionFreshness = new SessionFreshnessCoordinator(sessions);
  const providerGatewayToken = randomBytes(32).toString("hex");
  const providerGateway = new LocalProviderCommandGateway({
    store,
    sessions,
    authenticationToken: providerGatewayToken,
    backends: options.providerGatewayBackends ?? [],
    ...(options.authorizedExternalProviderGatewayProviders
      ? { authorizedExternalProviders: options.authorizedExternalProviderGatewayProviders }
      : {})
  }).connect(providerGatewayToken);
  const localStateDirectory = resolve(options.localStateDirectory ?? dirname(store.filePath));
  const councilStateRoot = resolve(localStateDirectory, "council-isolation");
  const checkpointCapture = options.runtime?.checkpointCapture ?? new LocalCheckpointCapture({ stateDirectory: localStateDirectory });
  const checkpointVerifier = options.runtime?.checkpointVerifier ?? new LocalRecoveryArtifactVerifier(localStateDirectory);
  const credentialProtector = options.credentialProtector ?? unavailableCredentialProtector;
  let containmentManager!: DurableContainmentManager;
  const repositoryRuntimes = new DurableRepositoryRuntimeRegistry(store, {
    processSupervisor: options.repositoryProcessSupervisor ?? new UnavailableInstalledRepositoryProcessSupervisor(),
    ...(options.repositoryExecutionRoots ? { executionRoots: options.repositoryExecutionRoots } : {}),
    effectGuard: {
      async check(_action, repositoryRoot) {
        if (!containmentManager) return { allowed: false, reason: "The installed containment guard is not initialized." };
        return containmentManager.check(repositoryRoot, "execution");
      }
    }
  });
  const hardwareSignals = new DurableHardwareSignalInbox(store);
  let targetResolver!: TargetResolver;
  let containmentRemote: InstalledContainmentRemoteCoordinator | undefined;
  let configuredNetwork!: DynamicConfiguredNetworkClient;
  let configuredProviderOperations: DurableConfiguredProviderOperationControl | undefined;
  const configuredProviderOperationQueue: ExactOperationQueueControl = {
    cancelByOperation: (operationId, reason) => configuredProviderOperations?.cancelByOperation(operationId, reason) ?? Promise.resolve(0),
    cancelQueuedForRepository: (repositoryRoot, reason) => configuredProviderOperations?.cancelQueuedForRepository(repositoryRoot, reason) ?? Promise.resolve(0),
    observeOperation: (operationId) => configuredProviderOperations?.observeOperation(operationId)
      ?? Promise.resolve({ settled: false, summary: "The configured-provider recovery controller is not initialized." }),
    observeBoundOperation: (binding) => configuredProviderOperations?.observeBoundOperation(binding)
      ?? Promise.resolve({ state: "not_owner", operationId: binding.operationId, summary: "The configured-provider recovery controller is not initialized." })
  };
  let providerDesktopRegistry: AttestedProviderDesktopRegistry | undefined;
  const hostActions = new DurableHostActionQueue(store, {
    finalAuthorizer: {
      async authorize(intent) {
        try {
          if (intent.workspaceRoot) {
            const containment = await containmentManager.check(intent.workspaceRoot, "adapter");
            if (!containment.allowed) return { allowed: false, reason: containment.reason };
          }
          if (intent.managedTerminalProfile) {
            if (!providerDesktopRegistry) return { allowed: false, reason: "The fixed provider installation registry is unavailable." };
            if (Date.parse(intent.managedTerminalProfile.validUntil) <= Date.now()) return { allowed: false, reason: "The managed-terminal executable authorization expired before the host effect." };
            const installed = await providerDesktopRegistry.resolve(intent.managedTerminalProfile.provider);
            const profile = intent.managedTerminalProfile;
            if (installed.installationId !== profile.installationId || installed.catalogDigest !== profile.catalogDigest
              || resolve(installed.identity.canonicalExecutablePath).toLowerCase() !== resolve(profile.canonicalExecutablePath).toLowerCase()
              || installed.identity.executableSha256 !== profile.executableSha256
              || installed.identity.productIdentity.productId !== profile.productIdentity.productId
              || installed.identity.productIdentity.publisher !== profile.productIdentity.publisher
              || installed.identity.productIdentity.role !== "managed_terminal") {
              return { allowed: false, reason: "The managed-terminal provider identity changed before final host authorization." };
            }
          }
          if (!intent.targetSnapshotId) return { allowed: true, reason: "The queued UI action has no repository effect target." };
          if (!intent.sessionId || !intent.workspaceRoot) return { allowed: false, reason: "The queued target-bound host action has no exact managed session and workspace." };
          const session = await sessions.get(intent.sessionId);
          if (!session) return { allowed: false, reason: "The exact managed session is no longer durable." };
          const actual = await targetResolver.resolve({ definition: commandForAction(intent.commandAction), session });
          if (!actual || actual.completeness !== "complete" || actual.id !== intent.targetSnapshotId || resolve(actual.repositoryRoot).toLowerCase() !== resolve(intent.workspaceRoot).toLowerCase()) {
            return { allowed: false, reason: "The exact TargetSnapshot changed before the VS Code host effect." };
          }
          if (intent.hostAction === "stop_vscode_debug") {
            if (!intent.debugSessionId || !intent.debugEffectSessionId || !intent.debugEffectSessionBindingDigest
              || !intent.debugSourceSessionBindingDigest || !intent.debugBindingId || !intent.debugOriginOperationId || !intent.debugConfiguration
              || intent.debugEffectSessionId === session.id || session.status !== "running"
              || sessionBindingDigest(session) !== intent.debugSourceSessionBindingDigest) {
              return { allowed: false, reason: "The queued debug stop lost its exact protected provider-source binding." };
            }
            const effect = await sessions.get(intent.debugEffectSessionId);
            if (!effect || effect.status !== "running" || effect.metadata["sxsy-b122.kind"] !== "debug-session"
              || sessionBindingDigest(effect) !== intent.debugEffectSessionBindingDigest
              || !effect.workspaceRoot || !sameRepositoryRoot(effect.workspaceRoot, intent.workspaceRoot)
              || effect.targetSnapshotId !== undefined && effect.targetSnapshotId !== intent.targetSnapshotId
              || effect.metadata["sxsy-b122.debugSessionId"] !== intent.debugSessionId
              || effect.metadata["sxsy-b122.debugBindingId"] !== intent.debugBindingId
              || effect.metadata["sxsy-b122.debugOriginSessionId"] !== session.id
              || effect.metadata["sxsy-b122.debugOriginOperationId"] !== intent.debugOriginOperationId
              || effect.metadata["sxsy-b122.debugConfiguration"] !== intent.debugConfiguration
              || !sameRepositoryRoot(effect.metadata["sxsy-b122.debugWorkspaceRoot"] ?? "", intent.workspaceRoot)) {
              return { allowed: false, reason: "The exact protected debug effect changed before final VS Code authorization." };
            }
          } else if (intent.debugEffectSessionId !== undefined || intent.debugEffectSessionBindingDigest !== undefined
            || intent.debugSourceSessionBindingDigest !== undefined || intent.debugBindingId !== undefined) {
            return { allowed: false, reason: "A non-stop host action carried protected debug-effect identity." };
          }
          return { allowed: true, reason: "The exact TargetSnapshot and containment boundary remain current." };
        } catch {
          return { allowed: false, reason: "The trusted host could not revalidate the exact queued effect target." };
        }
      }
    }
  });
  const workflowArtifacts = new WorkflowArtifactStore(store);
  const workflowContexts = new WorkflowCoordinatorContextStore(store);
  const handoffs = new HandoffPackageStore(store);
  const transcriptVault = new WindowsErasableVoiceTranscriptVault(join(localStateDirectory, "voice-transcripts"), credentialProtector);
  const voice = new VoiceCoordinator(store, { transcripts: transcriptVault });
  if ((options.voiceHelperPath && !options.voiceHelperSha256) || (!options.voiceHelperPath && options.voiceHelperSha256)) {
    throw new Error("The installed voice helper requires both an exact path and SHA-256 digest.");
  }
  const voiceAudio = options.voiceAudioPort ?? (options.voiceHelperPath && options.voiceHelperSha256
    ? new WindowsVoiceAudioPort({
        helperPath: options.voiceHelperPath,
        helperSha256: options.voiceHelperSha256,
        routeId: "audio.winmm.current-user"
      })
    : new SafeUnavailableVoiceAudioPort("The fixed packaged Windows microphone helper is unavailable."));
  const voiceNetwork: ProviderCommandTransport = { request: (input) => configuredNetwork.request(input) };
  const voiceProviders = options.voiceProviderPorts ?? (options.voiceHelperPath && options.voiceHelperSha256
    ? [
        new WindowsVoiceProviderPort({
          helperPath: options.voiceHelperPath,
          helperSha256: options.voiceHelperSha256,
          provider: "claude",
          routeId: "provider.claude.voice",
          authorizationReference: "credential-ref:claude-current-user"
        }),
        new WindowsVoiceProviderPort({
          helperPath: options.voiceHelperPath,
          helperSha256: options.voiceHelperSha256,
          provider: "chatgpt",
          routeId: "provider.chatgpt.voice",
          authorizationReference: "credential-ref:chatgpt-current-user"
        }),
        new SafeUnavailableVoiceProviderPort("system", "No system voice-provider route is installed.")
      ]
    : [
        new ConfiguredVoiceProviderPort("claude", voiceNetwork),
        new ConfiguredVoiceProviderPort("chatgpt", voiceNetwork),
        new SafeUnavailableVoiceProviderPort("system", "No system voice-provider route is installed.")
      ]);
  const voiceGateway = new HybridVoiceGateway({
    voice,
    contexts: handoffs,
    audio: voiceAudio,
    providers: voiceProviders,
    sessionScopeVerifier: {
      async assertCurrent(scope, context) {
        const session = await sessions.get(scope.managedSessionId);
        if (!session || !session.capabilities.includes("registered") || ["unknown", "stale", "unreachable"].includes(session.status)
          || !session.workspaceRoot || resolve(session.workspaceRoot).toLowerCase() !== resolve(scope.repositoryRoot).toLowerCase()
          || session.targetSnapshotId !== scope.targetSnapshotId || session.taskId !== context.taskId || session.planRevision !== context.planRevision) {
          throw new Error("The managed voice session is absent, stale, or changed from its exact context binding.");
        }
      }
    },
    effectGuard: {
      async assertAllowed({ scope, effect, remediation }) {
        if (remediation) {
          const cleanup = await containmentManager.check(scope.repositoryRoot, "local_cleanup");
          if (!cleanup.allowed) throw new Error(cleanup.reason);
          return;
        }
        const session = await sessions.get(scope.managedSessionId);
        if (!session || !session.workspaceRoot || resolve(session.workspaceRoot).toLowerCase() !== resolve(scope.repositoryRoot).toLowerCase()
          || session.targetSnapshotId !== scope.targetSnapshotId || !session.capabilities.includes("registered")
          || ["unknown", "stale", "unreachable"].includes(session.status)) {
          throw new Error("The exact managed voice session changed before the direct effect.");
        }
        const target = await targetResolver.resolve({ definition: commandForAction("voice_session_picker"), session });
        if (!target || target.completeness !== "complete" || target.id !== scope.targetSnapshotId
          || resolve(target.repositoryRoot).toLowerCase() !== resolve(scope.repositoryRoot).toLowerCase()) {
          throw new Error("The exact voice TargetSnapshot changed before the direct effect.");
        }
        const finalSession = await sessions.get(scope.managedSessionId);
        if (!finalSession || !finalSession.workspaceRoot || resolve(finalSession.workspaceRoot).toLowerCase() !== resolve(scope.repositoryRoot).toLowerCase()
          || finalSession.targetSnapshotId !== scope.targetSnapshotId || !finalSession.capabilities.includes("registered")
          || ["unknown", "stale", "unreachable"].includes(finalSession.status)) {
          throw new Error("The exact managed voice session changed at the final effect boundary.");
        }
        const containment = await containmentManager.check(scope.repositoryRoot, "adapter");
        if (!containment.allowed) throw new Error(containment.reason);
        if (effect.startsWith("provider_")) {
          const credential = await containmentManager.check(scope.repositoryRoot, "credential");
          if (!credential.allowed) throw new Error(credential.reason);
          const network = await containmentManager.check(scope.repositoryRoot, "network");
          if (!network.allowed) throw new Error(network.reason);
        }
      }
    }
  });
  const voiceRuntime = new InstalledVoiceConversationRuntime({ gateway: voiceGateway });
  let councilExecutorCancellation: CouncilRepositoryCancellationControl | undefined;
  let councilLifecycleCancellation: CouncilRepositoryCancellationControl | undefined;
  const operationControl = new InstalledOperationControl({
    queues: [
      new HostActionOperationQueueControl(hostActions),
      new WorkflowArtifactOperationQueueControl(workflowArtifacts),
      new HardwareSignalTriggerOperationQueueControl(hardwareSignals),
      providerGateway,
      configuredProviderOperationQueue
    ],
    processes: repositoryRuntimes,
    repositoryEffects: [
      { cancelRepository: (repositoryRoot, reason) => voiceRuntime.cancelRepository(repositoryRoot, reason) },
      {
        async cancelRepository(repositoryRoot, reason) {
          const cancelled = new Set<string>();
          for (const controller of [councilExecutorCancellation, councilLifecycleCancellation]) {
            if (!controller) continue;
            for (const epoch of await controller.cancelRepository(repositoryRoot, reason)) cancelled.add(epoch.id);
          }
          return cancelled.size;
        }
      }
    ]
  });
  let credentialVault!: DurableCredentialReferenceVault;
  const localContainmentAssessment = new InstalledLocalContainmentAssessmentPort();
  const containmentAssessment = new InstalledContainmentAssessmentPort(localContainmentAssessment, {
    execute: (request) => containmentRemote ? containmentRemote.execute(request) : localContainmentAssessment.execute(request),
    observe: (request) => containmentRemote ? containmentRemote.observe(request) : localContainmentAssessment.observe(request)
  });
  containmentManager = new DurableContainmentManager(store, {
    revokeCredentialLeases: async ({ repositoryRoot }) => credentialVault.revokeRepositoryLeases(repositoryRoot),
    cancelQueuedOperations: async (input) => { await operationControl.cancelQueuedOperations(input); }
  }, {
    incidentAssessmentPort: containmentAssessment
  });
  credentialVault = new DurableCredentialReferenceVault(store, credentialProtector, containmentManager);
  const councilResourceHost = new CouncilResourceHost({
    stateRoot: councilStateRoot,
    credentials: new VaultBackedCouncilCredentialCapabilityPort(credentialVault.createAdapter("council-resource-host"))
  });
  const councilIsolation = new CouncilWorkspaceIsolationManager(store, {
    stateRoot: councilStateRoot,
    resourceHost: councilResourceHost
  });
  const council = new CouncilCoordinator(store);
  const networkPolicyRegistry = new DurableNetworkPolicyRegistry(store, resolve(options.localStateDirectory ?? dirname(store.filePath), "network-policy.json"));
  const councilResources = new InstalledCouncilResourceBroker(councilIsolation, councilResourceHost, networkPolicyRegistry, containmentManager);
  const credentialProvisioning = options.runtimePinPresence ? new AttestedCredentialProvisioningCoordinator(credentialVault, credentialProtector, options.runtimePinPresence) : undefined;
  const networkPolicyProvisioning = options.runtimePinPresence ? new AttestedNetworkPolicyCoordinator(networkPolicyRegistry, options.runtimePinPresence) : undefined;
  const providerDispatchProfiles = new DurableProviderDispatchProfileRegistry(store);
  const providerDispatchProfileProvisioning = options.runtimePinPresence ? new AttestedProviderDispatchProfileCoordinator({
    profiles: providerDispatchProfiles,
    networkPolicies: networkPolicyRegistry,
    credentials: credentialVault,
    presence: options.runtimePinPresence
  }) : undefined;
  configuredNetwork = new DynamicConfiguredNetworkClient({
    registry: networkPolicyRegistry,
    containment: containmentManager,
    credentials: credentialVault.createAdapter("configured-network")
  });
  const providerDispatchContainment = new DurableProviderDispatchContainmentSource(containmentManager);
  const providerDispatchProfileSource = new PinnedProviderDispatchLeaseProfileSource(
    providerDispatchProfiles,
    new ConfiguredProviderHostLifecycleIdentitySource(configuredNetwork, networkPolicyRegistry)
  );
  const providerDispatchFinalCurrent = new InstalledProviderDispatchFinalCurrent({
    operations: { get: (id) => executor.operations.get(id) },
    sessions,
    authorities: runtimeAuthorities,
    profiles: providerDispatchProfileSource,
    containment: providerDispatchContainment,
    reanchor: {
      async assertCurrent(binding) {
        if (!reanchorRuntime || binding.action !== "reanchor" || !binding.artifact || !binding.confirmation) {
          return { allowed: false, reason: "The dedicated installed Re-anchor lifecycle is unavailable or incomplete." };
        }
        return reanchorRuntime.assertProviderDispatchCurrent({
          requestId: binding.artifact.id,
          operationId: binding.operationId,
          oldTarget: binding.target,
          session: binding.session,
          authority: binding.authority,
          artifactDigest: binding.artifact.digest,
          confirmationDigest: binding.confirmation.digest,
          confirmationScopeDigest: binding.confirmation.scopeDigest
        });
      }
    }
  });
  const providerMediatedFinalCurrent = new DurableProviderMediatedFinalCurrent({
    store,
    operations: { get: (id) => executor.operations.get(id) },
    sessions,
    authorities: runtimeAuthorities,
    targets: {
      async current({ action, session, signal }) {
        if (signal.aborted) throw new Error("The provider mediated target check was cancelled.");
        const current = await targetResolver.resolve({ definition: commandForAction(action as CommandAction), session });
        if (signal.aborted) throw new Error("The provider mediated target check was cancelled.");
        return current;
      }
    },
    containment: providerDispatchContainment,
    ...(options.runtime?.now ? { now: options.runtime.now } : {})
  });
  const leasedConfiguredNetwork = new LeaseInjectingProviderCommandTransport(
    configuredNetwork,
    new CredentialBackedProviderDispatchLeaseIssuer({
      credentials: credentialVault.createAdapter("provider-dispatch-lease-issuer"),
      profiles: providerDispatchProfileSource,
      finalCurrent: providerDispatchFinalCurrent,
      mediatedFinalCurrent: providerMediatedFinalCurrent,
      ...(options.runtime?.now ? { now: options.runtime.now } : {})
    }),
    providerDispatchContainment
  );
  const configuredProviderHost = new ConfiguredProviderHostClient(configuredNetwork);
  configuredProviderOperations = new DurableConfiguredProviderOperationControl({
    store,
    transport: leasedConfiguredNetwork,
    host: configuredProviderHost
  });
  const configuredProviderControl = {
    managesSession(session: ManagedSession) { return (session.provider === "claude" || session.provider === "codex") && !providerGateway.supportsProvider(session.provider); },
    managesProvider(provider: "claude" | "codex") { return !providerGateway.supportsProvider(provider); },
    reconcile: (repositoryRoot: string) => configuredProviderHost.reconcile(repositoryRoot),
    refreshSessions: (managedSessions: readonly ManagedSession[]) => configuredProviderHost.refreshSessions(managedSessions),
    cleanupCouncilResources: (input: Parameters<ConfiguredProviderHostClient["cleanupCouncilResources"]>[0]) => configuredProviderHost.cleanupCouncilResources(input)
  };
  const councilLifecycle = new CouncilEpochLifecycleManager(council, sessions, councilIsolation, {
    resources: councilResources,
    providerControl: configuredProviderControl
  });
  councilLifecycleCancellation = councilLifecycle;
  const providerTransport = new ProviderGatewayRouteRouter(providerGateway, configuredProviderOperations);
  const runtimePins = options.runtimePinPresence
    ? new AttestedRuntimePinCoordinator(repositoryRuntimes, options.runtimePinPresence)
    : undefined;
  const sandboxInstallationRegistry = options.sandboxHelperPath
    ? new DurableSandboxInstallationRegistry(store, options.sandboxHelperPath)
    : undefined;
  const sandboxInstallations = sandboxInstallationRegistry && options.runtimePinPresence && options.sandboxHelperPath
    ? new AttestedSandboxInstallationCoordinator(sandboxInstallationRegistry, options.sandboxHelperPath, options.runtimePinPresence)
    : undefined;
  const rawHidInstallationRegistry = options.rawHidHelperPath
    ? new DurableRawHidInstallationRegistry(store, {
        helperPath: options.rawHidHelperPath,
        protocolVersion,
        mapFingerprint: Buffer.from(mapFingerprint).toString("hex")
      })
    : undefined;
  const rawHidInstallations = rawHidInstallationRegistry && options.runtimePinPresence
    ? new AttestedRawHidInstallationCoordinator(rawHidInstallationRegistry, options.runtimePinPresence)
    : undefined;
  const rawHidFactory: RawHidTransportFactory | undefined = rawHidInstallationRegistry
    ? options.rawHidTransportFactory ?? {
        create(pin, events) {
          return new WindowsRawHidTransport({
            installationRoot: dirname(pin.helperPath),
            helperPath: pin.helperPath,
            helperSha256: pin.helperSha256,
            identity: pin.identity,
            onSignal: events.onSignal,
            onTransportStatus: events.onTransportStatus
          });
        }
      }
    : undefined;
  const rawHidSupervisor = rawHidInstallationRegistry && rawHidFactory
    ? new InstalledRawHidSupervisor(rawHidInstallationRegistry, hardwareSignals, rawHidFactory)
    : undefined;
  targetResolver = options.targetResolver ?? new WorkspaceSnapshotResolver(
    new TargetSnapshotFactory(new GitCliInspector({
      // The installed companion hashes every present untracked and ignored
      // regular file into the target identity.  It never silently treats an
      // ignored input as absent; unreadable/special files still make the
      // snapshot incomplete and stop consequential work.
      classifyUntracked: () => "included",
      classifyIgnored: () => "included"
    })),
    { policyVersion: options.policyVersion, ...(options.snapshotEnvironmentFor ? { environmentFor: options.snapshotEnvironmentFor } : {}) }
  );
  const automationManifestReviews = new DurableAutomationManifestReviewQueue({
    store,
    sessions,
    authorities: runtimeAuthorities,
    targetResolver,
    ...(options.runtime?.now ? { now: options.runtime.now } : {})
  });
  const automationManifestCoordinator = new InstalledAutomationManifestCoordinator({
    sessions,
    authorities: runtimeAuthorities,
    targetResolver,
    queue: automationManifestReviews,
    containment: containmentManager,
    source: new ConfiguredAutomationManifestProposalSource(providerTransport),
    ...(options.runtime?.now ? { now: options.runtime.now } : {})
  });
  const debugStops = new DurableDebugStopBindingStore({
    store,
    sessions,
    targetResolver,
    ...(options.runtime?.now ? { now: options.runtime.now } : {})
  });
  const containmentRemoteRegistry = new DurableContainmentRemoteEvidenceRegistry(store, {
    ...(options.runtime?.now ? { now: options.runtime.now } : {})
  });
  if (options.runtimePinPresence) {
    containmentRemote = new InstalledContainmentRemoteCoordinator({
      policyVersion: options.policyVersion,
      stateDirectory: join(localStateDirectory, "containment-remote"),
      incidents: containmentManager.incidents,
      sessions,
      targets: targetResolver,
      registry: containmentRemoteRegistry,
      administration: createContainmentRemoteEvidenceAdministration({
        registry: containmentRemoteRegistry,
        presence: options.runtimePinPresence,
        ...(options.runtime?.now ? { now: options.runtime.now } : {})
      }),
      ...(options.runtime?.now ? { now: options.runtime.now } : {})
    });
  }
  const providerHandshakes = options.runtimePinPresence
    ? new AttestedProviderHandshakeCoordinator(
        providerTransport,
        targetResolver,
        options.runtimePinPresence
      )
    : undefined;
  const installedWorkflowContextPreparation = new InstalledWorkflowContextPreparationCoordinator({
    provider: configuredProviderHost,
    contexts: workflowContexts,
    authorities: runtimeAuthorities,
    sessions,
    targets: targetResolver,
    ...(options.runtime?.now ? { now: options.runtime.now } : {})
  });
  const providerDesktopEffects = store.hasAuthenticatedProtection ? new DurableProviderDesktopEffectLedger(store) : undefined;
  const installedReconciler = new HostOwnedOperationReconciler(new InstalledReadOnlyObservationPort({
    git: new SpawnCheckpointGitRunner(),
    network: configuredNetwork,
    providerOperations: createExactProviderRecoveryRouter({ local: providerGateway, configured: configuredProviderOperations }),
    networkPolicy: networkPolicyRegistry,
    council,
    hostActions,
    ...(providerDesktopEffects ? { providerDesktopEffects } : {})
  }));
  const installedReconciliationActions = [
    "git.local-commit", "git.push-reviewed-head", "git.direct-main", "github.pr-upsert", "github.pr-merge",
    "council.pause", "council.assignment", "council.resume",
    ...providerCommandActions.map((action) => `provider.${action}`),
    ...installedProviderDesktopActions,
    ...hostActionCommandActions
  ];
  const operationReconcilers = {
    ...Object.fromEntries(installedReconciliationActions.map((action) => [action, installedReconciler])),
    ...(options.runtime?.operationReconcilers ?? {})
  };
  const gitReviews = options.runtime?.confirmationAttestor ? new DurableGitMutationReviewQueue({
    store,
    sessions,
    targetResolver,
    attestor: options.runtime.confirmationAttestor
  }) : undefined;
  const acceptanceAdministration = options.runtimePinPresence
    ? createAcceptanceAdministration({
        store,
        stateDirectory: localStateDirectory,
        presence: options.runtimePinPresence,
        policyVersion: options.policyVersion
      })
    : undefined;
  const scannerFixtures = new DurableScannerFixtureRegistry(store, localStateDirectory);
  const scannerAdministration = options.runtimePinPresence
    ? createScannerFixtureAdministration({
        registry: scannerFixtures,
        presence: options.runtimePinPresence
      })
    : undefined;
  const providerDesktopCatalog = options.providerDesktopPaths ? createFixedProviderDesktopCatalog(options.providerDesktopPaths) : undefined;
  providerDesktopRegistry = providerDesktopCatalog && options.runtimePinPresence
    ? new AttestedProviderDesktopRegistry({
        store,
        catalog: providerDesktopCatalog,
        identityProbe: new NodeProviderExecutableIdentityProbe(),
        presence: options.runtimePinPresence
      })
    : undefined;
  const providerDesktopProcesses = options.providerDesktopProcessPort
    ?? (options.providerDesktopHelperPath && options.providerDesktopHelperSha256
      ? new WindowsProviderDesktopProcessPort({ helperPath: options.providerDesktopHelperPath, helperSha256: options.providerDesktopHelperSha256 })
      : undefined);
  const providerDesktopAdapter = providerDesktopRegistry && providerDesktopProcesses
      ? new InstalledProviderDesktopCommandAdapter((request) => new InstalledProviderDesktopLifecycle({
        registry: providerDesktopRegistry!,
        processes: providerDesktopProcesses,
        ...(options.providerDesktopHelperPath && options.providerDesktopHelperSha256 ? { managedTerminalLauncher: {
          canonicalExecutablePath: options.providerDesktopHelperPath,
          executableSha256: options.providerDesktopHelperSha256
        } } : {}),
        effectGuard: {
          async check(input) {
            if (!request.operationId || request.operationId !== input.operationId) return { allowed: false, reason: "The provider effect is not bound to the exact durable operation." };
            const operation = await executor.operations.get(input.operationId);
            if (!operation || operation.action !== request.definition.action || operation.state !== "executing") return { allowed: false, reason: "The durable provider operation is absent, changed, or no longer executing." };
            if (!request.target) return operation.targetSnapshotId.startsWith("<no-target:")
              ? { allowed: true, reason: "The targetless desktop action remains bound to its exact durable operation." }
              : { allowed: false, reason: "The provider operation unexpectedly retained a repository target." };
            if (!request.effectGuard || operation.targetSnapshotId !== request.target.id) return { allowed: false, reason: "The provider effect lacks its exact final target guard." };
            const current = await request.effectGuard.assertCurrent({
              action: request.definition.action,
              operationId: input.operationId,
              target: request.target,
              ...(request.session ? { session: request.session } : {}),
              ...(request.authority ? { authority: request.authority } : {})
            });
            if (!current.allowed) return current;
            return containmentManager.check(request.target.repositoryRoot, "adapter");
          }
        }
      }), hostActions, providerDesktopEffects)
    : undefined;
  const gateEvidence = options.runtime?.gateEvidence ?? acceptanceAdministration?.ledger ?? new GateEvidenceLedger(store);
  const councilAutomaticGate = new LedgerCouncilAutomaticAcceptanceGate(gateEvidence);
  const automationJournal = new ProtectedStoreAutomationEffectJournal(store);
  const automationContainment = new DurableProviderDispatchContainmentSource(containmentManager);
  const automationTargetObserver = new GitAutomationHostTargetObserver({
    inspector: new GitCliInspector({ classifyUntracked: () => "included", classifyIgnored: () => "included" }),
    captureOptionsFor: ({ action, session }) => ({
      policyVersion: options.policyVersion,
      environment: options.snapshotEnvironmentFor?.({ definition: commandForAction(action), session }) ?? {},
      requireCanonicalRemote: true,
      requireBranch: true
    }),
    clock: () => (options.runtime?.now?.() ?? new Date()).toISOString()
  });
  const automationRefreshGit = new LocalMediatedGitHandler({
    stateDirectory: resolve(options.localGitStateDirectory ?? join(localStateDirectory, "git")),
    remediation: containmentManager.incidents
  });
  const automationArtifacts = options.automationChildArtifacts ?? { resolve: async () => undefined };
  const automationBackends = options.automationChildBackends ?? {};
  const automationAuthorization = new LedgerAutomationHighConsequenceAuthorization({
    policyVersion: options.policyVersion,
    evidence: gateEvidence,
    activations: acceptanceAdministration?.activations ?? { list: async () => [] },
    ...(options.runtime?.now ? { now: options.runtime.now } : {})
  });
  const createInstalledAutomationExecutor = (request: AutomationRequest, envelope: AutomationEnvelope, policy: PermitVerifier): LocalAutomationEffectExecutor => {
    const targetTransitions = new DurableEffectTargetTransitionCoordinator({
      sessions,
      targets: executor.snapshots,
      targetResolver
    });
    const runtime = new InstalledAutomationEffectRuntime({
      store,
      request,
      envelope,
      operations: executor.operations,
      sessions,
      authorities: runtimeAuthorities,
      policy,
      containment: automationContainment,
      targetResolver,
      targetObserver: automationTargetObserver,
      targetTransitions,
      ...(options.runtime?.now ? { now: options.runtime.now } : {})
    });
    const fence: AutomationChildExecutionFence = {
      assertContained: async (input) => {
        await automationContainment.currentClear(input.binding.repositoryRoot);
      },
      assertFinalCurrent: async (input) => {
        await runtime.guard.assertCurrent({
          envelope,
          boundary: "before_child",
          expectedTargetSnapshotId: input.binding.currentTargetSnapshotId,
          child: { order: input.binding.order, kind: input.binding.kind, scopeDigest: input.binding.scopeDigest }
        });
      }
    };
    const configuredChildren = createArtifactResolvingAutomationChildPorts({ artifacts: automationArtifacts, fence, backends: automationBackends });
    const automationFilesystem = new NodeAutomationFilesystemPort();
    const refreshGit = new InstalledAutomationRefreshGitCommitPort({
      request,
      envelope,
      sessions,
      targets: executor.snapshots,
      guard: runtime.guard,
      commitObserver: new InstalledAutomationRefreshGitCommitObserver({
        git: new SpawnCheckpointGitRunner(),
        canonicalizeRoot: (repositoryRoot) => automationFilesystem.canonicalizeRoot(repositoryRoot)
      }),
      handler: automationRefreshGit
    });
    const configuredGit = configuredChildren.git_commit!;
    const gitCommit: AutomationChildEffectPort<"git_commit"> = {
      execute: (input) => input.envelope.action === "compound_refresh" ? refreshGit.execute(input) : configuredGit.execute(input),
      recover: async (input) => input.envelope.action === "compound_refresh" ? refreshGit.recover(input) : configuredGit.recover?.(input),
      compensate: async (input) => {
        if (input.envelope.action === "compound_refresh") throw new Error("A committed Compound Refresh Git ref update requires exact recovery and is never guessed at by automatic reset.");
        if (!configuredGit.compensate) throw new Error("The reviewed LFG Git child has no exact compensation backend.");
        return configuredGit.compensate(input);
      }
    };
    const childPorts: AutomationChildEffectPorts = Object.freeze({ ...configuredChildren, git_commit: gitCommit });
    return new LocalAutomationEffectExecutor({
      journal: automationJournal,
      guard: runtime.guard,
      targetTransition: runtime.targetTransition,
      childPorts,
      highConsequenceAuthorization: automationAuthorization,
      recoveryBinding: createAutomationEffectRecoveryBinding(request, envelope),
      clock: () => (options.runtime?.now?.() ?? new Date()).toISOString()
    });
  };
  let localComponents: DefaultLocalComposition | undefined;
  let defaultDependencies: Omit<CommandDispatcherDependencies, "policy" | "sessions" | "authorities" | "operations" | "receiptEvidence" | "governance"> | undefined;
  const dependencies = options.dependencies ?? ((context) => {
    if (!defaultDependencies) {
      const installedSandbox: IsolationRuntime | undefined = options.hostIsolationRuntime ?? (sandboxInstallationRegistry
        ? new InstalledWindowsSandboxIsolationRuntime(sandboxInstallationRegistry, options.localStateDirectory ?? dirname(store.filePath), context.policy)
        : undefined);
      const receiptIssuer = hostReceiptEvidenceIssuer(options.receiptEvidence);
      const repositorySandbox = options.repositorySandboxFactory && receiptIssuer
        ? options.repositorySandboxFactory({ runtimes: repositoryRuntimes, issuer: receiptIssuer, scannerFixtures })
        : installedSandbox instanceof InstalledWindowsSandboxIsolationRuntime && receiptIssuer && sandboxInstallationRegistry
          ? new HostValidatedRepositoryRecipeRunner(installedSandbox, sandboxInstallationRegistry, receiptIssuer, {
            stateDirectory: options.localStateDirectory ?? dirname(store.filePath),
            scannerFixtures
          })
          : undefined;
      const composed = createDefaultLocalComposition(
        context,
        store,
        options.localStateDirectory ?? dirname(store.filePath),
        {
          ...(options.localGitStateDirectory ? { localGitStateDirectory: options.localGitStateDirectory } : {}),
          ...((options.localGitMutationFactory ?? gitReviews) ? { localGitMutationFactory: options.localGitMutationFactory ?? gitReviews } : {}),
          credentialProtector: options.credentialProtector ?? unavailableCredentialProtector,
          ...(options.networkPolicy ? { networkPolicy: options.networkPolicy } : {}),
          repositoryRuntimes,
          containmentManager,
          credentialVault,
          networkPolicyRegistry,
          providerTransport,
          councilIsolation,
          councilResources,
          councilAutomaticGate,
          ...(installedSandbox ? { isolationRuntime: installedSandbox } : {}),
          ...(repositorySandbox ? { repositorySandbox } : {}),
          ...(providerDesktopAdapter ? { providerDesktopAdapter } : {}),
          automationExecutorFactory: (request, envelope) => createInstalledAutomationExecutor(request, envelope, context.policy),
          targetResolver,
          hostActions
        }
      );
      localComponents = composed.components;
      defaultDependencies = {
        ...composed.dependencies,
        automationManifestReviews,
        debugStopReviews: debugStops
      };
      const configuredCouncil = composed.dependencies.council as Partial<CouncilRepositoryCancellationControl> | undefined;
      if (typeof configuredCouncil?.cancelRepository === "function") councilExecutorCancellation = configuredCouncil as CouncilRepositoryCancellationControl;
    }
    return defaultDependencies;
  });
  executor = new DurableMediatedExecutor({
    ...options.runtime,
    store,
    sessions,
    authorities: runtimeAuthorities,
    workflowContextPreparation: options.runtime?.workflowContextPreparation ?? installedWorkflowContextPreparation,
    gateEvidence,
    policyVersion: options.policyVersion,
    targetResolver,
    enabledHighConsequenceActions: options.enabledHighConsequenceActions,
    highConsequenceActivations: options.runtime?.highConsequenceActivations ?? acceptanceAdministration?.activations,
    checkpointCapture,
    checkpointVerifier,
    operationControl: options.runtime?.operationControl ?? operationControl,
    operationReconcilers,
    dependencies,
    receiptEvidence: options.receiptEvidence
  });
  const reanchorEffectGuard: EffectGuard = {
    async assertCurrent(input) {
      try {
        if (input.action !== "reanchor" || !input.session || !input.authority) {
          return { allowed: false, reason: "The installed Re-anchor guard requires its exact session and authority." };
        }
        const session = await sessions.get(input.session.id);
        if (!session || (session.provider !== "claude" && session.provider !== "codex")
          || session.status === "stale" || session.status === "unreachable"
          || !session.capabilities.includes("controllable")
          || sessionBindingDigest(session) !== sessionBindingDigest(input.session)) {
          return { allowed: false, reason: "The exact protected Re-anchor session binding changed." };
        }
        const authority = await runtimeAuthorities.get(input.authority.id);
        const now = options.runtime?.now?.() ?? new Date();
        if (!authority || stableJson(authority) !== stableJson(input.authority) || authority.revokedAt
          || !Number.isFinite(Date.parse(authority.issuedAt)) || Date.parse(authority.issuedAt) > now.getTime()
          || !Number.isFinite(Date.parse(authority.expiresAt)) || Date.parse(authority.expiresAt) <= now.getTime()
          || authority.sessionId !== session.id || authority.taskId !== session.taskId || authority.planRevision !== session.planRevision
          || !sameRepositoryRoot(authority.repositoryRoot, input.target.repositoryRoot)
          || !authority.allowedActions.includes("reanchor") || authority.prohibitedActions.includes("reanchor")) {
          return { allowed: false, reason: "The exact scoped Re-anchor authority changed, expired, or no longer applies." };
        }
        const storedTarget = await executor.snapshots.get(input.target.id);
        if (!storedTarget || storedTarget.completeness !== "complete" || stableJson(storedTarget) !== stableJson(input.target)
          || !sameRepositoryRoot(storedTarget.repositoryRoot, session.workspaceRoot ?? "")) {
          return { allowed: false, reason: "The protected Re-anchor target is absent, incomplete, or changed." };
        }
        const exactlyRebound = session.metadata["sxsy-b122.reanchor.newTargetSnapshotId"] === input.target.id
          && session.metadata["sxsy-b122.reanchor.resumeAuthorized"] === "false";
        const protectedOldBinding = session.targetSnapshotId === input.target.id && !exactlyRebound;
        if (!protectedOldBinding) {
          const resolved = await targetResolver.resolve({ definition: commandForAction("reanchor"), session });
          if (!resolved || resolved.completeness !== "complete" || resolved.reasons.length !== 0
            || targetSnapshotDigest(resolved) !== resolved.id || resolved.id !== input.target.id
            || !sameRepositoryRoot(resolved.repositoryRoot, session.workspaceRoot ?? "")) {
            return { allowed: false, reason: "The trusted current Re-anchor TargetSnapshot changed at the final effect boundary." };
          }
        }
        const containment = await containmentManager.check(input.target.repositoryRoot, "adapter");
        if (!containment.allowed) return containment;
        return {
          allowed: true,
          reason: protectedOldBinding
            ? "The exact protected old session target remains current."
            : "The independently resolved new Re-anchor target remains current."
        };
      } catch {
        return { allowed: false, reason: "The installed Re-anchor dual-target guard could not revalidate protected state." };
      }
    }
  };
  if (options.runtimePinPresence) {
    reanchorRuntime = new InstalledDurableReanchorRuntime({
      store,
      sessions,
      authorities: runtimeAuthorities,
      snapshots: executor.snapshots,
      targets: targetResolver,
      containment: {
        async inspect(repositoryRoot) {
          const before = await containmentManager.get(repositoryRoot);
          const decision = await containmentManager.check(repositoryRoot, "adapter");
          const after = await containmentManager.get(repositoryRoot);
          if (stableJson(before ?? null) !== stableJson(after ?? null)) {
            return { allowed: false, fenceEpoch: after?.fenceEpoch ?? 0, reason: "The containment epoch changed during Re-anchor inspection." };
          }
          return { allowed: decision.allowed, fenceEpoch: after?.fenceEpoch ?? 0, reason: decision.reason };
        }
      },
      effectGuard: reanchorEffectGuard,
      presence: options.runtimePinPresence,
      previewer: {
        async preview(input) {
          const context = await workflowContexts.current(input.session.id, input.oldTarget.id);
          if (!context || context.authorityId !== input.authority.id
            || !sameRepositoryRoot(context.repositoryRoot, input.oldTarget.repositoryRoot)
            || context.evidence.plan.originSessionId !== input.session.id
            || context.evidence.plan.taskId !== input.session.taskId
            || context.evidence.plan.revision !== input.session.planRevision) {
            throw new Error("Protected Re-anchor context, documentation, authority, task, or plan evidence is missing or stale.");
          }
          const targetChanged = input.oldTarget.id !== input.newTarget.id;
          return {
            summary: "Cooperatively stop the exact managed provider session, reread the protected instructions, task brief, authority, and project documentation, inspect current work, and return a structured report without resuming.",
            discrepancies: [targetChanged
              ? `The reviewed TargetSnapshot changed from ${input.oldTarget.id} to ${input.newTarget.id}.`
              : "The repository TargetSnapshot identity is unchanged; the protected provider context will still be reread and reconciled."],
            risks: ["The managed provider session will remain stopped and rebound to Unknown; Re-anchor never authorizes resume or rollback."],
            questions: context.pendingDecisions.length
              ? context.pendingDecisions.slice(0, 32).map((decision) => decision.question)
              : ["Should a separate later action be reviewed if the managed work is to resume?"],
            contextEvidence: context.evidence
          };
        }
      },
      applier: new ConfiguredProviderReanchorApplyPort(providerTransport, reanchorEffectGuard),
      ...(options.runtime?.now ? { clock: () => options.runtime!.now!().toISOString() } : {})
    });
  }
  const hardwareSignalDispatcher = new CompanionHardwareSignalDispatcher(hardwareSignals, executor);
  const inspectContainmentSession = async (sessionId: string) => {
      const session = await sessions.get(sessionId);
      if (!session) return undefined;
      let target;
      try { target = await targetResolver.resolve({ definition: commandForAction("containment_release"), session }); }
      catch { return undefined; }
      if (!target || target.completeness !== "complete") return undefined;
      const fence = await containmentManager.get(target.repositoryRoot);
      if (!fence?.incidentId) return undefined;
      const incident = await containmentManager.incidents.get(fence.incidentId);
      return incident ? { fence, incident } : undefined;
  };
  const containmentRelease = new AttestedContainmentReleaseCoordinator(executor, {
    inspect: inspectContainmentSession,
    validateRemoteRelease: async (input) => {
      const current = await inspectContainmentSession(input.sessionId);
      if (!current || current.incident.id !== input.incident.id
        || containmentIncidentReviewDigest(current.incident) !== input.expectedIncidentDigest) {
        throw new Error("The containment incident changed before final remote-evidence validation.");
      }
      if (!containmentRemote) throw new Error("No installed signed remote-evidence release boundary is attached.");
      await containmentRemote.validateRelease({
        sessionId: input.sessionId,
        incident: current.incident,
        expectedIncidentDigest: input.expectedIncidentDigest
      });
    },
    assess: async (input) => {
      const current = await inspectContainmentSession(input.sessionId);
      if (!current || current.incident.id !== input.incidentId || containmentIncidentReviewDigest(current.incident) !== input.expectedIncidentDigest) throw new Error("The containment incident changed after assessment review.");
      await containmentManager.assessIncident(input.incidentId, input.expectedIncidentDigest);
    },
    beginVerification: async (input) => {
      const current = await inspectContainmentSession(input.sessionId);
      if (!current || current.incident.id !== input.incidentId || containmentIncidentReviewDigest(current.incident) !== input.expectedIncidentDigest) throw new Error("The containment incident changed after remediation-verification review.");
      const session = await sessions.get(input.sessionId);
      if (!session) throw new Error("The containment remediation-verification session is unavailable.");
      const target = await targetResolver.resolve({ definition: commandForAction("containment_release"), session });
      if (!target || target.completeness !== "complete" || target.repositoryRoot.replaceAll("\\", "/").toLowerCase() !== current.incident.repositoryRoot.replaceAll("\\", "/").toLowerCase()) {
        throw new Error("The containment remediation-verification target is incomplete or changed.");
      }
      await containmentManager.incidents.beginRemediationVerification({
        incidentId: input.incidentId,
        expectedIncidentDigest: input.expectedIncidentDigest,
        targetSnapshotId: target.id
      });
    },
    issuePermit: async (input) => {
      const current = await inspectContainmentSession(input.sessionId);
      if (!current || current.incident.id !== input.incidentId || containmentIncidentReviewDigest(current.incident) !== input.expectedIncidentDigest) throw new Error("The containment incident changed after remediation review.");
      return containmentManager.incidents.issueRemediationPermit({
        incidentId: input.incidentId,
        expectedIncidentDigest: input.expectedIncidentDigest,
        action: input.action,
        relativePaths: input.relativePaths,
        expiresAt: input.expiresAt,
        reviewedBy: "authenticated-vscode-current-user"
      });
    },
    recordRotation: async (input) => {
      const current = await inspectContainmentSession(input.sessionId);
      if (!current || current.incident.id !== input.incidentId || containmentIncidentReviewDigest(current.incident) !== input.expectedIncidentDigest) throw new Error("The containment incident changed after credential-rotation review.");
      await containmentManager.incidents.recordRotationReview({
        incidentId: input.incidentId,
        expectedIncidentDigest: input.expectedIncidentDigest,
        disposition: input.disposition,
        evidenceReference: input.evidenceReference,
        evidenceDigest: input.evidenceDigest
      });
    }
  });
  const containmentHistory = options.runtimePinPresence
    ? new AttestedContainmentHistoryRemediator({
        store,
        stateDirectory: join(localStateDirectory, "containment-history"),
        incidents: containmentManager.incidents,
        presence: options.runtimePinPresence,
        targets: {
          resolve: async (sessionId) => {
            const session = await sessions.get(sessionId);
            if (!session) return undefined;
            const target = await targetResolver.resolve({ definition: commandForAction("containment_release"), session });
            if (!target || target.completeness !== "complete" || !target.branch || !target.head || target.detached) return undefined;
            return {
              repositoryRoot: target.repositoryRoot,
              targetSnapshotId: target.id,
              branch: target.branch,
              head: target.head,
              completeness: "complete" as const
            };
          }
        }
      })
    : undefined;
  const workflowCoordinator = new DurableWorkflowPreparationCoordinator(workflowContexts, sessions, executor.authorities, handoffs);
  const reanchorService = reanchorRuntime ? {
    async eligibleAuthorities(sessionId: string, signal?: AbortSignal) {
      if (signal?.aborted) throw new Error("The Re-anchor authority lookup was cancelled.");
      const session = await sessions.get(sessionId);
      if (!session || (session.provider !== "claude" && session.provider !== "codex")
        || !session.workspaceRoot || !session.targetSnapshotId || !session.taskId || !session.planRevision
        || session.status === "stale" || session.status === "unreachable"
        || !session.capabilities.includes("controllable")) return [];
      const now = options.runtime?.now?.() ?? new Date();
      const eligible = (await runtimeAuthorities.list()).filter((grant) =>
        !grant.revokedAt
        && Number.isFinite(Date.parse(grant.issuedAt)) && Date.parse(grant.issuedAt) <= now.getTime()
        && Number.isFinite(Date.parse(grant.expiresAt)) && Date.parse(grant.expiresAt) > now.getTime()
        && sameRepositoryRoot(grant.repositoryRoot, session.workspaceRoot!)
        && grant.sessionId === session.id && grant.taskId === session.taskId && grant.planRevision === session.planRevision
        && grant.allowedActions.includes("reanchor") && !grant.prohibitedActions.includes("reanchor"));
      if (signal?.aborted) throw new Error("The Re-anchor authority lookup was cancelled.");
      return eligible
        .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt) || left.id.localeCompare(right.id))
        .slice(0, 32)
        .map((grant) => ({ id: grant.id, issuedBy: grant.issuedBy, expiresAt: grant.expiresAt }));
    },
    begin: (input: Parameters<InstalledDurableReanchorRuntime["begin"]>[0]) => reanchorRuntime!.begin(input),
    confirmAndApply: (input: Parameters<InstalledDurableReanchorRuntime["confirmAndApply"]>[0]) => reanchorRuntime!.confirmAndApply(input),
    get: (requestId: string) => reanchorRuntime!.get(requestId)
  } : undefined;
  const recoverInstalledAutomation = async (): Promise<void> => {
    for (const state of await automationJournal.listRecoverable()) {
      const recovery = state.recoveryBinding;
      if (!recovery) continue;
      if (!await automationManifestReviews.wasConsumed({ manifest: recovery.request.reviewedManifest, approval: recovery.request.manifestApproval })) continue;
      const admitted = recovery.request;
      const executionControl = {
        operationId: admitted.executionControl.operationId,
        ...(admitted.executionControl.budgetClaimId ? { budgetClaimId: admitted.executionControl.budgetClaimId } : {}),
        deadline: admitted.executionControl.deadline,
        async isCancellationRequested(): Promise<boolean> {
          const operation = await executor.operations.get(admitted.operationId);
          if (!operation || operation.action !== admitted.action || operation.targetSnapshotId !== admitted.target.id
            || operation.details.sessionId !== admitted.session.id || operation.details.authorityId !== admitted.authority.id
            || operation.state !== "executing" || Date.parse(admitted.executionControl.deadline) <= (options.runtime?.now?.() ?? new Date()).getTime()) return true;
          if (!admitted.executionControl.budgetClaimId) return false;
          const claim = (await executor.budgets.list()).find((candidate) => candidate.id === admitted.executionControl.budgetClaimId);
          return !claim || claim.operationId !== admitted.operationId || claim.expiresAt !== admitted.executionControl.deadline || claim.state !== "running";
        }
      };
      const request: AutomationRequest = {
        action: admitted.action,
        operationId: admitted.operationId,
        target: admitted.target,
        session: admitted.session,
        authority: admitted.authority,
        permit: admitted.permit,
        confirmation: admitted.confirmation,
        executionControl,
        ...(admitted.testEnvironment ? { testEnvironment: admitted.testEnvironment } : {}),
        reviewedManifest: admitted.reviewedManifest,
        manifestApproval: admitted.manifestApproval,
        effectGuard: {
          async assertCurrent() {
            return { allowed: false, reason: "Startup recovery cannot replay the already-consumed admission guard; authenticated runtime state is required." };
          }
        }
      };
      const recoveryPolicy: PermitVerifier = {
        verifyPermit(permit, binding) {
          return stableJson(permit) === stableJson(admitted.permit)
            && binding.action === admitted.action && binding.operationId === admitted.operationId
            && binding.targetSnapshotId === admitted.target.id && binding.sessionId === admitted.session.id
            && binding.authorityId === admitted.authority.id;
        }
      };
      let receipt: AutomationEffectReceipt | null = null;
      try {
        receipt = await createInstalledAutomationExecutor(request, recovery.envelope, recoveryPolicy).execute({
          envelope: recovery.envelope,
          currentManifestContext: {
            repositoryRoot: recovery.envelope.manifest.repositoryRoot,
            targetSnapshotId: recovery.envelope.manifest.targetSnapshotId,
            sessionId: recovery.envelope.manifest.sessionId,
            authorityId: recovery.envelope.manifest.authorityId,
            taskId: recovery.envelope.manifest.taskId,
            planRevision: recovery.envelope.manifest.planRevision,
            provider: recovery.envelope.manifest.provider,
            createdAt: recovery.envelope.manifest.createdAt,
            expiresAt: recovery.envelope.manifest.expiresAt
          },
          ...(recovery.instructionFileConsent ? { instructionFileConsent: recovery.instructionFileConsent } : {})
        });
      } catch (error) {
        if (error instanceof AutomationEffectExecutionError) receipt = error.receipt;
      }
      if (!receipt || receipt.status === "recovery_required") continue;
      await executor.completeExternalOperation({
        operationId: admitted.operationId,
        action: admitted.action,
        targetSnapshotId: admitted.target.id,
        status: receipt.status === "committed" ? "completed" : "failed",
        effectDisposition: receipt.status === "committed" ? "committed" : "compensated",
        summary: receipt.status === "committed"
          ? "Startup recovery observed the exact durable automation completion without replay."
          : "Startup recovery durably compensated the interrupted automation operation.",
        evidenceDigest: receipt.digest,
        toolVersions: { "b122.automation-effect-executor": "1" }
      });
    }
  };
  const service = new CompanionService({ executor, hostActions, hardwareSignals, handoffs, workflowArtifacts, workflowCoordinator, voice, voiceRuntime, containmentRelease, councilResources, providerMediatedFinalCurrent, automationManifestCoordinator, automationManifestReviews, debugStops, ...(reanchorService ? { reanchor: reanchorService } : {}), ...(containmentHistory ? { containmentHistory } : {}), ...(containmentRemote ? { containmentRemote } : {}), ...(options.runtimePinPresence ? { voicePresence: options.runtimePinPresence } : {}), ...(gitReviews ? { gitReviews } : {}), ...(runtimePins ? { runtimePins } : {}), ...(sandboxInstallations ? { sandboxInstallations } : {}), ...(credentialProvisioning ? { credentialProvisioning } : {}), ...(networkPolicyProvisioning ? { networkPolicyProvisioning } : {}), ...(providerDispatchProfileProvisioning ? { providerDispatchProfiles: providerDispatchProfileProvisioning } : {}), ...(providerHandshakes ? { providerHandshakes } : {}), ...(rawHidInstallations ? { rawHidInstallations } : {}), ...(rawHidSupervisor ? { rawHidSupervisor } : {}), ...(acceptanceAdministration ? { acceptanceAdministration } : {}), ...(scannerAdministration ? { scannerAdministration } : {}), ...(providerDesktopRegistry ? { providerDesktopRegistry } : {}) });
  const endpoint = new DurableCompanionEndpoint(service, sessions, {
    refreshSessions: async () => {
      await providerGateway.refreshSessions();
      const hosted = await configuredProviderHost.refreshSessions((await sessions.list()).filter((session) => configuredProviderControl.managesSession(session)));
      for (const session of hosted) await sessions.upsert(session);
      return sessionFreshness.refresh();
    },
    startupRecovery: async () => {
      for (const completion of await hostActions.listSettled()) await executor.completeExternalOperation(completion);
      await repositoryRuntimes.recoverManagedProcesses();
      await councilIsolation.recoverPending();
      await councilLifecycle.start();
      await reanchorRuntime?.recover();
      await configuredProviderOperations?.recoverAfterRestart();
      await recoverInstalledAutomation();
      await executor.recoverAfterRestart();
      await hardwareSignals.recoverAfterRestart();
    }
  });
  return {
    store,
    sessions,
    executor,
    service,
    endpoint,
    hostActions,
    repositoryRuntimes,
    credentialVault,
    networkPolicyRegistry,
    providerDispatchProfiles,
    providerGateway,
    hardwareSignals,
    hardwareSignalDispatcher,
    checkpointCapture,
    checkpointVerifier,
    operationControl,
    handoffs,
    workflowArtifacts,
    workflowContexts,
    voice,
    transcriptVault,
    voiceGateway,
    voiceRuntime,
    councilIsolation,
    councilResources,
    councilLifecycle,
    ...(reanchorRuntime ? { reanchor: reanchorRuntime } : {}),
    automationManifestReviews,
    automationManifestCoordinator,
    debugStops,
    scannerFixtures,
    ...(acceptanceAdministration ? { acceptanceAdministration } : {}),
    ...(scannerAdministration ? { scannerAdministration } : {}),
    ...(providerDesktopRegistry ? { providerDesktopRegistry } : {}),
    ...(containmentRemote ? { containmentRemote } : {}),
    ...(gitReviews ? { gitReviews } : {}),
    ...(runtimePins ? { runtimePins } : {}),
    ...(sandboxInstallationRegistry ? { sandboxInstallationRegistry } : {}),
    ...(sandboxInstallations ? { sandboxInstallations } : {}),
    ...(credentialProvisioning ? { credentialProvisioning } : {}),
    ...(networkPolicyProvisioning ? { networkPolicyProvisioning } : {}),
    ...(providerDispatchProfileProvisioning ? { providerDispatchProfileProvisioning } : {}),
    ...(providerHandshakes ? { providerHandshakes } : {}),
    ...(rawHidInstallationRegistry ? { rawHidInstallationRegistry } : {}),
    ...(rawHidInstallations ? { rawHidInstallations } : {}),
    ...(rawHidSupervisor ? { rawHidSupervisor } : {}),
    ...(containmentHistory ? { containmentHistory } : {}),
    get localComponents() { return localComponents; },
    async registerTrustedSession(session: ManagedSession): Promise<ManagedSession> {
      await endpoint.ready();
      const persisted = await sessions.upsert(session);
      service.installTrustedSession(persisted);
      return persisted;
    },
    async registerTrustedWorkflowContext(input: WorkflowCoordinatorContextInput): Promise<WorkflowCoordinatorContext> {
      await endpoint.ready();
      return workflowContexts.record(input);
    }
  };
}

const unavailableCredentialProtector: UserSecretProtector = {
  provider: "unavailable-no-host-secret-protector",
  async seal(): Promise<string> { throw new Error("No host credential protector is configured."); },
  async open(): Promise<Uint8Array> { throw new Error("No host credential protector is configured."); }
};

function hostReceiptEvidenceIssuer(value: DispatchReceiptEvidenceFactory | undefined): HostReceiptEvidenceIssuer | undefined {
  const candidate = value as Partial<HostReceiptEvidenceIssuer> | undefined;
  return typeof candidate?.issueRepositoryRecipeEvidence === "function" ? candidate as HostReceiptEvidenceIssuer : undefined;
}

function sameRepositoryRoot(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
    return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  return !!left && !!right && normalize(left) === normalize(right);
}
