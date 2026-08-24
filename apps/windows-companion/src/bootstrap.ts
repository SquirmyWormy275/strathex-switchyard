import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { CommandDispatcherDependencies, DispatchReceiptEvidenceFactory, GitMutationFactory } from "../../../packages/control-plane/src/dispatch.ts";
import { GitCliInspector } from "../../../packages/control-plane/src/git-inspector.ts";
import { DurableMediatedExecutor, type DurableMediatedExecutorOptions, type TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { WorkspaceSnapshotResolver } from "../../../packages/control-plane/src/snapshot-resolver.ts";
import { TargetSnapshotFactory, type SnapshotEnvironment } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { dirname, resolve } from "node:path";
import { createDefaultLocalComposition, type DefaultLocalComposition } from "./default-composition.ts";
import { DurableCompanionEndpoint } from "./durable-endpoint.ts";
import { DurableHostActionQueue } from "./host-actions.ts";
import { CompanionService } from "./service.ts";
import type { ConfiguredNetworkPolicy } from "./configured-network.ts";
import type { UserSecretProtector } from "./windows-secret.ts";
import { DurableGitMutationReviewQueue } from "./git-review.ts";
import { DurableRepositoryRuntimeRegistry } from "./runtime-registry.ts";
import { AttestedRuntimePinCoordinator } from "./runtime-provisioning.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";
import { AttestedSandboxInstallationCoordinator, DurableSandboxInstallationRegistry, InstalledWindowsSandboxIsolationRuntime } from "./sandbox-installation.ts";
import { DurableContainmentManager } from "../../../packages/control-plane/src/containment.ts";
import { DurableCredentialReferenceVault } from "./durable-credentials.ts";
import { AttestedCredentialProvisioningCoordinator, AttestedNetworkPolicyCoordinator, DurableNetworkPolicyRegistry } from "./host-provisioning.ts";
import { AttestedProviderHandshakeCoordinator, DynamicConfiguredNetworkClient, type ProviderHandshakeCoordinator } from "./remote-adapters.ts";
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
  /** Fixed packaged b122-sandbox-worker.exe. Omit to keep OS isolation unavailable. */
  readonly sandboxHelperPath?: string;
  /** Fixed packaged strathex-b122-hid-helper.exe. Never supplied by a client. */
  readonly rawHidHelperPath?: string;
  /** Isolated tests may replace only process creation, never the pinned path or identity. */
  readonly rawHidTransportFactory?: RawHidTransportFactory;
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
  readonly hardwareSignals: DurableHardwareSignalInbox;
  readonly rawHidInstallationRegistry?: DurableRawHidInstallationRegistry;
  readonly rawHidInstallations?: AttestedRawHidInstallationCoordinator;
  readonly rawHidSupervisor?: InstalledRawHidSupervisor;
  registerTrustedSession(session: ManagedSession): Promise<ManagedSession>;
} {
  const store = options.store ?? new ProtectedJsonStore({
    ...(options.journalAuthenticator ? { authenticator: options.journalAuthenticator } : {}),
    requireAuthenticatedProtection: true
  });
  if (!options.allowUnprotectedStoreForTests && !store.hasAuthenticatedProtection) {
    throw new Error("The durable B122 companion requires a host-backed journal authenticator; unprotected hash-chain storage is rejected.");
  }
  const sessions = new SessionRegistry(store);
  const credentialProtector = options.credentialProtector ?? unavailableCredentialProtector;
  let credentialVault!: DurableCredentialReferenceVault;
  const containmentManager = new DurableContainmentManager(store, { revokeCredentialLeases: async ({ repositoryRoot }) => credentialVault.revokeRepositoryLeases(repositoryRoot) });
  credentialVault = new DurableCredentialReferenceVault(store, credentialProtector, containmentManager);
  const networkPolicyRegistry = new DurableNetworkPolicyRegistry(store, resolve(options.localStateDirectory ?? dirname(store.filePath), "network-policy.json"));
  const credentialProvisioning = options.runtimePinPresence ? new AttestedCredentialProvisioningCoordinator(credentialVault, credentialProtector, options.runtimePinPresence) : undefined;
  const networkPolicyProvisioning = options.runtimePinPresence ? new AttestedNetworkPolicyCoordinator(networkPolicyRegistry, options.runtimePinPresence) : undefined;
  const repositoryRuntimes = new DurableRepositoryRuntimeRegistry(store);
  const runtimePins = options.runtimePinPresence
    ? new AttestedRuntimePinCoordinator(repositoryRuntimes, options.runtimePinPresence)
    : undefined;
  const sandboxInstallationRegistry = options.sandboxHelperPath
    ? new DurableSandboxInstallationRegistry(store, options.sandboxHelperPath)
    : undefined;
  const sandboxInstallations = sandboxInstallationRegistry && options.runtimePinPresence && options.sandboxHelperPath
    ? new AttestedSandboxInstallationCoordinator(sandboxInstallationRegistry, options.sandboxHelperPath, options.runtimePinPresence)
    : undefined;
  const hardwareSignals = new DurableHardwareSignalInbox(store);
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
  const targetResolver = options.targetResolver ?? new WorkspaceSnapshotResolver(
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
        new DynamicConfiguredNetworkClient({ registry: networkPolicyRegistry, containment: containmentManager, credentials: credentialVault.createAdapter("configured-network") }),
        targetResolver,
        options.runtimePinPresence
      )
    : undefined;
  const hostActions = new DurableHostActionQueue(store);
  const gitReviews = options.runtime?.confirmationAttestor ? new DurableGitMutationReviewQueue({
    store,
    sessions,
    targetResolver,
    attestor: options.runtime.confirmationAttestor
  }) : undefined;
  let localComponents: DefaultLocalComposition | undefined;
  let defaultDependencies: Omit<CommandDispatcherDependencies, "policy" | "sessions" | "authorities" | "operations" | "receiptEvidence" | "governance"> | undefined;
  const dependencies = options.dependencies ?? ((context) => {
    if (!defaultDependencies) {
      const installedSandbox = sandboxInstallationRegistry
        ? new InstalledWindowsSandboxIsolationRuntime(sandboxInstallationRegistry, options.localStateDirectory ?? dirname(store.filePath), context.policy)
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
          ...(installedSandbox ? { isolationRuntime: installedSandbox, repositorySandbox: installedSandbox } : {}),
          hostActions
        }
      );
      localComponents = composed.components;
      defaultDependencies = composed.dependencies;
    }
    return defaultDependencies;
  });
  const executor = new DurableMediatedExecutor({
    ...options.runtime,
    store,
    sessions,
    policyVersion: options.policyVersion,
    targetResolver,
    enabledHighConsequenceActions: options.enabledHighConsequenceActions,
    dependencies,
    receiptEvidence: options.receiptEvidence
  });
  const service = new CompanionService({ executor, hostActions, hardwareSignals, ...(gitReviews ? { gitReviews } : {}), ...(runtimePins ? { runtimePins } : {}), ...(sandboxInstallations ? { sandboxInstallations } : {}), ...(credentialProvisioning ? { credentialProvisioning } : {}), ...(networkPolicyProvisioning ? { networkPolicyProvisioning } : {}), ...(providerHandshakes ? { providerHandshakes } : {}), ...(rawHidInstallations ? { rawHidInstallations } : {}), ...(rawHidSupervisor ? { rawHidSupervisor } : {}) });
  const endpoint = new DurableCompanionEndpoint(service, sessions, {
    startupRecovery: async () => { await executor.recoverAfterRestart(); await hardwareSignals.recoverAfterRestart(); }
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
    hardwareSignals,
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
    }
  };
}

const unavailableCredentialProtector: UserSecretProtector = {
  provider: "unavailable-no-host-secret-protector",
  async seal(): Promise<string> { throw new Error("No host credential protector is configured."); },
  async open(): Promise<Uint8Array> { throw new Error("No host credential protector is configured."); }
};
