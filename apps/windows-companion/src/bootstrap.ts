import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import type { CommandDispatcherDependencies, DispatchReceiptEvidenceFactory, GitMutationFactory } from "../../../packages/control-plane/src/dispatch.ts";
import { GitCliInspector } from "../../../packages/control-plane/src/git-inspector.ts";
import { DurableMediatedExecutor, type DurableMediatedExecutorOptions, type TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { WorkspaceSnapshotResolver } from "../../../packages/control-plane/src/snapshot-resolver.ts";
import { TargetSnapshotFactory, type SnapshotEnvironment } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { createDefaultLocalComposition, type DefaultLocalComposition } from "./default-composition.ts";
import { GateEvidenceLedger } from "../../../packages/control-plane/src/acceptance-evidence.ts";
import { LedgerCouncilAutomaticAcceptanceGate } from "./council-runtime.ts";
import { DurableCompanionEndpoint } from "./durable-endpoint.ts";
import { DurableHostActionQueue } from "./host-actions.ts";
import { hostActionCommandActions } from "./host-actions.ts";
import { CompanionService } from "./service.ts";
import type { ConfiguredNetworkPolicy } from "./configured-network.ts";
import { ConfiguredProviderHostClient } from "./configured-provider-host.ts";
import { InstalledWorkflowContextPreparationCoordinator } from "./workflow-context-preparation.ts";
import type { UserSecretProtector } from "./windows-secret.ts";
import { DurableGitMutationReviewQueue } from "./git-review.ts";
import { DurableRepositoryRuntimeRegistry } from "./runtime-registry.ts";
import { AttestedRuntimePinCoordinator } from "./runtime-provisioning.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";
import { AttestedSandboxInstallationCoordinator, DurableSandboxInstallationRegistry, InstalledWindowsSandboxIsolationRuntime } from "./sandbox-installation.ts";
import { DurableContainmentManager } from "../../../packages/control-plane/src/containment.ts";
import { DurableCredentialReferenceVault } from "./durable-credentials.ts";
import { AttestedCredentialProvisioningCoordinator, AttestedNetworkPolicyCoordinator, DurableNetworkPolicyRegistry } from "./host-provisioning.ts";
import { AttestedProviderHandshakeCoordinator, DynamicConfiguredNetworkClient, providerCommandActions, remoteAutomationActions, type ProviderCommandTransport, type ProviderHandshakeCoordinator } from "./remote-adapters.ts";
import { protocolVersion } from "../../../packages/protocol/src/b122.ts";
import { mapFingerprint } from "../../../packages/protocol/src/raw-hid.ts";
import { DurableHardwareSignalInbox } from "./hardware-signal-queue.ts";
import {
  AttestedRawHidInstallationCoordinator,
  DurableRawHidInstallationRegistry,
  InstalledRawHidSupervisor,
  type RawHidTransportFactory
} from "./raw-hid-installation.ts";
import { WindowsRawHidTransport } from "./raw-hid-protocol.ts";
import { LocalCheckpointCapture, LocalRecoveryArtifactVerifier } from "./local-checkpoints.ts";
import { HostActionOperationQueueControl, InstalledOperationControl, UnavailableInstalledRepositoryProcessSupervisor, WorkflowArtifactOperationQueueControl } from "./operation-control.ts";
import { HostOwnedOperationReconciler, InstalledReadOnlyObservationPort } from "./operation-recovery.ts";
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
import type { HostReceiptEvidenceIssuer } from "./receipt-evidence.ts";
import { CouncilWorkspaceIsolationManager } from "./council-workspace-isolation.ts";
import { CouncilResourceHost, VaultBackedCouncilCredentialCapabilityPort } from "./council-resource-host.ts";
import { InstalledCouncilResourceBroker } from "./council-resource-broker.ts";
import { CouncilEpochLifecycleManager } from "./council-epoch-lifecycle.ts";
import { SessionFreshnessCoordinator } from "./session-freshness.ts";
import { AttestedContainmentReleaseCoordinator } from "./containment-release.ts";
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
  readonly providerHandshakes?: ProviderHandshakeCoordinator;
  readonly providerGateway: AuthenticatedProviderGatewayClient;
  readonly hardwareSignals: DurableHardwareSignalInbox;
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
  readonly acceptanceAdministration?: AcceptanceAdministration;
  readonly scannerFixtures: DurableScannerFixtureRegistry;
  readonly scannerAdministration?: ScannerFixtureAdministration;
  readonly providerDesktopRegistry?: AttestedProviderDesktopRegistry;
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
  const repositoryRuntimes = new DurableRepositoryRuntimeRegistry(store, {
    processSupervisor: options.repositoryProcessSupervisor ?? new UnavailableInstalledRepositoryProcessSupervisor()
  });
  const hardwareSignals = new DurableHardwareSignalInbox(store);
  let targetResolver!: TargetResolver;
  let containmentManager!: DurableContainmentManager;
  let configuredNetwork!: DynamicConfiguredNetworkClient;
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
          const cleanup = await containmentManager.check(scope.repositoryRoot, "local_remediation");
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
    queues: [new HostActionOperationQueueControl(hostActions), new WorkflowArtifactOperationQueueControl(workflowArtifacts), hardwareSignals, providerGateway],
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
  containmentManager = new DurableContainmentManager(store, {
    revokeCredentialLeases: async ({ repositoryRoot }) => credentialVault.revokeRepositoryLeases(repositoryRoot),
    cancelQueuedOperations: async (input) => { await operationControl.cancelQueuedOperations(input); }
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
  configuredNetwork = new DynamicConfiguredNetworkClient({
    registry: networkPolicyRegistry,
    containment: containmentManager,
    credentials: credentialVault.createAdapter("configured-network")
  });
  const configuredProviderHost = new ConfiguredProviderHostClient(configuredNetwork);
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
  const providerTransport = new ProviderGatewayRouteRouter(providerGateway, configuredNetwork);
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
  const providerHandshakes = options.runtimePinPresence
    ? new AttestedProviderHandshakeCoordinator(
        providerTransport,
        targetResolver,
        options.runtimePinPresence
      )
    : undefined;
  const runtimeAuthorities = options.runtime?.authorities ?? new AuthorityLedger(store, {
    clock: () => (options.runtime?.now?.() ?? new Date()).toISOString()
  });
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
    providerOperations: providerGateway,
    networkPolicy: networkPolicyRegistry,
    council,
    hostActions,
    ...(providerDesktopEffects ? { providerDesktopEffects } : {})
  }));
  const installedReconciliationActions = [
    "git.local-commit", "git.push-reviewed-head", "git.direct-main", "github.pr-upsert", "github.pr-merge",
    "council.pause", "council.assignment", "council.resume",
    ...providerCommandActions.map((action) => `provider.${action}`),
    ...remoteAutomationActions.map((action) => `automation.${action}`),
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
  let executor!: DurableMediatedExecutor;
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
  let localComponents: DefaultLocalComposition | undefined;
  let defaultDependencies: Omit<CommandDispatcherDependencies, "policy" | "sessions" | "authorities" | "operations" | "receiptEvidence" | "governance"> | undefined;
  const dependencies = options.dependencies ?? ((context) => {
    if (!defaultDependencies) {
      const installedSandbox = sandboxInstallationRegistry
        ? new InstalledWindowsSandboxIsolationRuntime(sandboxInstallationRegistry, options.localStateDirectory ?? dirname(store.filePath), context.policy)
        : undefined;
      const receiptIssuer = hostReceiptEvidenceIssuer(options.receiptEvidence);
      const repositorySandbox = installedSandbox && receiptIssuer && sandboxInstallationRegistry
        ? new HostValidatedRepositoryRecipeRunner(installedSandbox, sandboxInstallationRegistry, receiptIssuer, {
            stateDirectory: options.localStateDirectory ?? dirname(store.filePath),
            scannerFixtures
          })
        : installedSandbox;
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
          hostActions
        }
      );
      localComponents = composed.components;
      defaultDependencies = composed.dependencies;
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
  const containmentRelease = new AttestedContainmentReleaseCoordinator(executor, {
    inspect: async (sessionId) => {
      const session = await sessions.get(sessionId);
      if (!session) return undefined;
      let target;
      try { target = await targetResolver.resolve({ definition: commandForAction("containment_release"), session }); }
      catch { return undefined; }
      if (!target || target.completeness !== "complete") return undefined;
      return containmentManager.get(target.repositoryRoot);
    }
  });
  const workflowCoordinator = new DurableWorkflowPreparationCoordinator(workflowContexts, sessions, executor.authorities, handoffs);
  const service = new CompanionService({ executor, hostActions, hardwareSignals, handoffs, workflowArtifacts, workflowCoordinator, voice, voiceRuntime, containmentRelease, councilResources, ...(options.runtimePinPresence ? { voicePresence: options.runtimePinPresence } : {}), ...(gitReviews ? { gitReviews } : {}), ...(runtimePins ? { runtimePins } : {}), ...(sandboxInstallations ? { sandboxInstallations } : {}), ...(credentialProvisioning ? { credentialProvisioning } : {}), ...(networkPolicyProvisioning ? { networkPolicyProvisioning } : {}), ...(providerHandshakes ? { providerHandshakes } : {}), ...(rawHidInstallations ? { rawHidInstallations } : {}), ...(rawHidSupervisor ? { rawHidSupervisor } : {}), ...(acceptanceAdministration ? { acceptanceAdministration } : {}), ...(scannerAdministration ? { scannerAdministration } : {}), ...(providerDesktopRegistry ? { providerDesktopRegistry } : {}) });
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
    providerGateway,
    hardwareSignals,
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
    scannerFixtures,
    ...(acceptanceAdministration ? { acceptanceAdministration } : {}),
    ...(scannerAdministration ? { scannerAdministration } : {}),
    ...(providerDesktopRegistry ? { providerDesktopRegistry } : {}),
    ...(gitReviews ? { gitReviews } : {}),
    ...(runtimePins ? { runtimePins } : {}),
    ...(sandboxInstallationRegistry ? { sandboxInstallationRegistry } : {}),
    ...(sandboxInstallations ? { sandboxInstallations } : {}),
    ...(credentialProvisioning ? { credentialProvisioning } : {}),
    ...(networkPolicyProvisioning ? { networkPolicyProvisioning } : {}),
    ...(providerHandshakes ? { providerHandshakes } : {}),
    ...(rawHidInstallationRegistry ? { rawHidInstallationRegistry } : {}),
    ...(rawHidInstallations ? { rawHidInstallations } : {}),
    ...(rawHidSupervisor ? { rawHidSupervisor } : {}),
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
