import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { CommandDispatcherDependencies, DispatchReceiptEvidenceFactory, GitMutationFactory } from "../../../packages/control-plane/src/dispatch.ts";
import { AdapterRegistry } from "../../../packages/control-plane/src/adapters.ts";
import { InMemoryAutomationBroker, InMemoryExecutionBroker, InMemoryGitBroker, InMemoryTestEnvironmentBroker, UnavailableIsolationRuntime } from "../../../packages/control-plane/src/brokers.ts";
import { DurableContainmentManager } from "../../../packages/control-plane/src/containment.ts";
import { GitCliInspector } from "../../../packages/control-plane/src/git-inspector.ts";
import { DurableMediatedExecutor, type DurableMediatedExecutorOptions, type TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { WorkspaceSnapshotResolver } from "../../../packages/control-plane/src/snapshot-resolver.ts";
import { TargetSnapshotFactory, type SnapshotEnvironment } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { DurableCompanionEndpoint } from "./durable-endpoint.ts";
import { LocalMediatedGitHandler } from "./mediated-git.ts";
import { CompanionService } from "./service.ts";

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
  /**
   * Enables the concrete local-commit handler. It still needs a reviewed
   * mutation factory; no chord can invent a commit message or path set.
   */
  readonly localGitStateDirectory?: string;
  readonly localGitMutationFactory?: GitMutationFactory;
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
  const targetResolver = options.targetResolver ?? new WorkspaceSnapshotResolver(
    new TargetSnapshotFactory(new GitCliInspector()),
    { policyVersion: options.policyVersion, ...(options.snapshotEnvironmentFor ? { environmentFor: options.snapshotEnvironmentFor } : {}) }
  );
  const containment = new DurableContainmentManager(store);
  const localGit = options.localGitStateDirectory
    ? new LocalMediatedGitHandler({ stateDirectory: options.localGitStateDirectory })
    : undefined;
  const executor = new DurableMediatedExecutor({
    ...options.runtime,
    store,
    sessions,
    policyVersion: options.policyVersion,
    targetResolver,
    enabledHighConsequenceActions: options.enabledHighConsequenceActions,
    dependencies: options.dependencies ?? ((context) => {
      const adapters = new AdapterRegistry(containment);
      const git = new InMemoryGitBroker(context.policy, containment);
      if (localGit) git.register("local_commit", (request) => localGit.execute(request));
      return {
        adapters,
        git,
        containment,
        execution: new InMemoryExecutionBroker(context.policy, containment),
        testEnvironment: new InMemoryTestEnvironmentBroker(context.policy, containment),
        automation: new InMemoryAutomationBroker(context.policy, containment),
        isolation: new UnavailableIsolationRuntime(context.policy, containment),
        ...(options.localGitMutationFactory ? { gitMutationFactory: options.localGitMutationFactory } : {})
      };
    }),
    receiptEvidence: options.receiptEvidence
  });
  const service = new CompanionService({ executor });
  const endpoint = new DurableCompanionEndpoint(service, sessions, {
    startupRecovery: async () => { await executor.recoverAfterRestart(); }
  });
  return {
    store,
    sessions,
    executor,
    service,
    endpoint,
    async registerTrustedSession(session: ManagedSession): Promise<ManagedSession> {
      await endpoint.ready();
      const persisted = await sessions.upsert(session);
      service.installTrustedSession(persisted);
      return persisted;
    }
  };
}
