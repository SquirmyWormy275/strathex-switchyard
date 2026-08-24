/** Concrete, conservative host composition for the installed companion. */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { AdapterRegistry, type AdapterOutcome, type AdapterRequest, type CommandAdapter } from "../../../packages/control-plane/src/adapters.ts";
import { InMemoryGitBroker, type AutomationBroker, type AutomationRequest, type BrokerOutcome, type GitRequest, type IsolationRuntime, type IsolationRequest, type TestEnvironmentBroker, type TestEnvironmentRequest, type TestEnvironmentOutcome } from "../../../packages/control-plane/src/brokers.ts";
import { DurableContainmentManager } from "../../../packages/control-plane/src/containment.ts";
import { CouncilCoordinator } from "../../../packages/control-plane/src/council.ts";
import type { CommandDispatcherDependencies, GitMutationFactory } from "../../../packages/control-plane/src/dispatch.ts";
import type { RuntimeDispatcherContext } from "../../../packages/control-plane/src/runtime.ts";
import { commandForAction, type CommandDefinition } from "../../../packages/control-plane/src/command-catalog.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { RepositoryRecipe } from "../../../packages/control-plane/src/recipes.ts";
import type { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { ReceiptLedger } from "../../../packages/control-plane/src/receipts.ts";
import { WorkflowArtifactStore } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { FilesystemBroker, LocalSandboxBroker, RawHidLoopbackTransport, ScannerFeedBroker, defaultRepositoryPolicy } from "./local-runtime.ts";
import { LocalMediatedGitHandler, SpawnLocalGitRunner, type LocalGitRunner } from "./mediated-git.ts";
import { DurableHostActionAdapter, DurableHostActionQueue, hostActionCommandActions } from "./host-actions.ts";
import { DurableCredentialReferenceVault } from "./durable-credentials.ts";
import { createDirectConfiguredNetworkBroker, type ConfiguredHttpsNetworkBroker, type ConfiguredNetworkPolicy } from "./configured-network.ts";
import type { UserSecretProtector } from "./windows-secret.ts";
import { DurableRepositoryRuntimeRegistry } from "./runtime-registry.ts";
import { repositoryProcessActions, type RepositoryExecutionRootProvider, type RepositoryRuntimeAction } from "./repository-runtime.ts";
import { RepositoryRuntimeExecutionBroker, SandboxedRepositoryExecutionBroker, repositoryRuntimeExecutionRecipe, type SandboxRepositoryRecipeRunner } from "./repository-runtime-broker.ts";
import type { DurableNetworkPolicyRegistry } from "./host-provisioning.ts";
import { ConfiguredProviderCommandAdapter, DynamicConfiguredNetworkClient, createConfiguredAutomationBroker, providerCommandActions, type ProviderCommandTransport } from "./remote-adapters.ts";
import { ConfiguredGitHubGraphqlPort, ConfiguredGitSmartHttpPusher, ConfiguredRemoteGitHandler, configuredGitHostFromPolicy } from "./remote-git.ts";
import { DurableConfiguredCouncilExecutor, type CouncilAutomaticAcceptanceGate } from "./council-runtime.ts";
import type { CouncilWorkspaceIsolationManager } from "./council-workspace-isolation.ts";
import { CompositePipelineStatusAdapter, ConfiguredGitHubPipelineAdapter, DurablePipelineFailureCursor } from "./pipeline-adapters.ts";
import { ConfiguredGitHubNavigationResolver } from "./github-navigation.ts";

const scannerFixture = createHash("sha256").update(JSON.stringify("")).digest("hex");
function permit(request: Readonly<{ permit?: { readonly expiresAt: string }; executionControl?: { readonly deadline: string; isCancellationRequested(): Promise<boolean> } }>): BrokerOutcome | undefined {
  if (!request.permit || Date.parse(request.permit.expiresAt) <= Date.now()) return { status: "blocked", summary: "The local broker rejected an absent or expired durable permit.", effectDisposition: "not_started" };
  if (request.executionControl && Date.parse(request.executionControl.deadline) <= Date.now()) return { status: "timed_out", summary: "The local broker rejected an expired execution deadline.", effectDisposition: "not_started" };
  return undefined;
}

class LocalIsolatedTestEnvironmentBroker implements TestEnvironmentBroker {
  async prepare(request: TestEnvironmentRequest): Promise<TestEnvironmentOutcome> {
    const denied = permit(request); if (denied) return denied;
    const filesystem = new FilesystemBroker(defaultRepositoryPolicy(request.target.repositoryRoot));
    let root: string; try { root = await filesystem.canonical(request.target.repositoryRoot); } catch { return { status: "blocked", summary: "The verified target is outside the local filesystem allowlist." }; }
    let recipeRoot: string; try { recipeRoot = await filesystem.canonical(request.recipe.repositoryRoot); } catch { return { status: "blocked", summary: "The declared test recipe root is outside the local filesystem allowlist." }; }
    const normalized = (value: string) => value.replaceAll("\\", "/").replace(/^\/\/\?\//, "").replace(/\/+$/, "").toLowerCase();
    if (normalized(root) !== normalized(recipeRoot)) return { status: "blocked", summary: "The declared test recipe does not bind to the exact canonical target root." };
    if (Object.entries(request.sourceEnvironment).some(([key, value]) => /(secret|token|password|credential|api[_-]?key)/i.test(key) || (value !== undefined && /production|postgres(?:ql)?:\/\//i.test(value)))) return { status: "blocked", summary: "The isolated test broker rejected an ambient secret or production-looking input." };
    const id = `isolation-required:${request.operationId}`;
    return { status: "completed", summary: "Prepared a sanitized isolation requirement; the pinned runtime must still attest an OS-enforced disposable root before execution.", environment: { id, tempRoot: id, databaseName: `sxsy_test_${request.operationId}`, egress: "deny", environment: { NODE_ENV: "test", SXSY_TEST_MODE: "1", SXSY_NETWORK: "deny" } } };
  }
}

class LocalFailClosedAutomationBroker implements AutomationBroker { async execute(request: AutomationRequest): Promise<BrokerOutcome> { return permit(request) ?? { status: "unavailable", summary: "No local provider automation adapter is installed; no prompt, workflow, credential, or network request was submitted.", effectDisposition: "not_started" }; } }
class LocalFailClosedIsolationRuntime implements IsolationRuntime {
  async start(request: IsolationRequest): Promise<BrokerOutcome> { return permit(request) ?? { status: "unavailable", summary: `${request.profile} requires the installed OS-enforced sandbox backend; no weaker copy-based sandbox was started.`, effectDisposition: "not_started" }; }
}
export class LocalPipelineStatusAdapter implements CommandAdapter {
  readonly id = "local-pipeline-status"; readonly kind = "generic" as const;
  private readonly git: LocalGitRunner;
  constructor(git: LocalGitRunner = new SpawnLocalGitRunner()) { this.git = git; }
  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    if (!request.target) return { status: "unavailable", summary: "Pipeline status requires an exact target.", effectDisposition: "not_started" };
    try { await new FilesystemBroker(defaultRepositoryPolicy(request.target.repositoryRoot)).canonical(request.target.repositoryRoot); } catch { return { status: "blocked", summary: "Pipeline status target is outside the local filesystem allowlist.", effectDisposition: "not_started" }; }
    if (request.effectGuard) { const current = await request.effectGuard.assertCurrent({ action: request.definition.action, operationId: request.operationId ?? "pipeline-status", target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) }); if (!current.allowed) return { status: "blocked", summary: current.reason, effectDisposition: "not_started" }; }
    try {
      const checked = await this.git.run(["status", "--porcelain=v1", "--branch"], { cwd: request.target.repositoryRoot });
      return { status: checked.exitCode === 0 ? "completed" : "failed", summary: checked.exitCode === 0 ? "Inspected pipeline target status with the fixed absolute Git host." : "The fixed Git status inspection failed.", effectDisposition: "committed", data: { broker: "canonical-filesystem+fixed-git", clean: checked.exitCode === 0 && !checked.stdout.split(/\r?\n/).some((line) => line && !line.startsWith("##")) } };
    } catch { return { status: "unavailable", summary: "The trusted absolute Git host is unavailable for pipeline status.", effectDisposition: "not_started" }; }
  }
}

export interface DefaultLocalComposition {
  readonly filesystem: "canonical-allowlist"; readonly credentials: DurableCredentialReferenceVault; readonly network: ConfiguredHttpsNetworkBroker; readonly scanner: ScannerFeedBroker; readonly rawHid: RawHidLoopbackTransport; readonly sandbox: LocalSandboxBroker; readonly containment: DurableContainmentManager; readonly council: CouncilCoordinator; readonly hostActions: DurableHostActionQueue; readonly repositoryRuntimes: DurableRepositoryRuntimeRegistry; readonly workflowArtifacts: WorkflowArtifactStore;
}
export interface DefaultLocalCompositionOptions {
  readonly localGitStateDirectory?: string;
  readonly localGitMutationFactory?: GitMutationFactory;
  readonly hostActions?: DurableHostActionQueue;
  readonly credentialProtector: UserSecretProtector;
  readonly networkPolicy?: ConfiguredNetworkPolicy;
  readonly repositoryExecutionRoots?: RepositoryExecutionRootProvider;
  readonly repositoryRuntimes?: DurableRepositoryRuntimeRegistry;
  readonly isolationRuntime?: IsolationRuntime;
  readonly repositorySandbox?: SandboxRepositoryRecipeRunner;
  readonly containmentManager?: DurableContainmentManager;
  readonly credentialVault?: DurableCredentialReferenceVault;
  readonly networkPolicyRegistry?: DurableNetworkPolicyRegistry;
  readonly councilIsolation?: CouncilWorkspaceIsolationManager;
  readonly councilAutomaticGate?: CouncilAutomaticAcceptanceGate;
  /** Authenticated local gateway with an explicitly configured-network fallback. */
  readonly providerTransport?: ProviderCommandTransport;
}
export function createDefaultLocalComposition(context: RuntimeDispatcherContext, store: ProtectedJsonStore, stateDirectory: string = dirname(store.filePath), options: DefaultLocalCompositionOptions): { readonly dependencies: Omit<CommandDispatcherDependencies, "policy" | "sessions" | "authorities" | "operations" | "receiptEvidence" | "governance">; readonly components: DefaultLocalComposition } {
  let credentials: DurableCredentialReferenceVault | undefined = options.credentialVault;
  const containment = options.containmentManager ?? new DurableContainmentManager(store, {
    revokeCredentialLeases: async ({ repositoryRoot }) => {
      if (!credentials) throw new Error("The durable credential vault is unavailable during containment.");
      await credentials.revokeRepositoryLeases(repositoryRoot);
    }
  });
  credentials ??= new DurableCredentialReferenceVault(store, options.credentialProtector, containment);
  const network = createDirectConfiguredNetworkBroker(
    options.networkPolicy ?? { version: 1, proxy: "direct", routes: [] },
    containment,
    credentials.createAdapter("configured-network")
  );
  const scanner = new ScannerFeedBroker(scannerFixture); const rawHid = new RawHidLoopbackTransport(); const sandbox = new LocalSandboxBroker(join(stateDirectory, "sandboxes")); const council = new CouncilCoordinator(store);
  const workflowArtifacts = new WorkflowArtifactStore(store);
  const repositoryRuntimes = options.repositoryRuntimes ?? new DurableRepositoryRuntimeRegistry(store, { ...(options.repositoryExecutionRoots ? { executionRoots: options.repositoryExecutionRoots } : {}) });
  const adapters = new AdapterRegistry(containment); adapters.register("pipeline_status", new LocalPipelineStatusAdapter());
  const dynamicNetwork = options.networkPolicyRegistry ? new DynamicConfiguredNetworkClient({ registry: options.networkPolicyRegistry, containment, credentials: credentials.createAdapter("configured-network") }) : undefined;
  const providerTransport = options.providerTransport ?? dynamicNetwork;
  if (providerTransport) {
    const provider = new ConfiguredProviderCommandAdapter(providerTransport, workflowArtifacts);
    for (const action of providerCommandActions) adapters.register(action, provider);
  }
  const hostActions = options.hostActions ?? new DurableHostActionQueue(store);
  const configuredGitHost = options.networkPolicyRegistry ? { resolve: async () => configuredGitHostFromPolicy(await options.networkPolicyRegistry!.resolve()) } : undefined;
  const hostActionAdapter = new DurableHostActionAdapter(hostActions, dynamicNetwork && configuredGitHost ? new ConfiguredGitHubNavigationResolver(dynamicNetwork, configuredGitHost) : undefined);
  for (const action of hostActionCommandActions) adapters.register(action, hostActionAdapter);
  if (dynamicNetwork) {
    const pipeline = new ConfiguredGitHubPipelineAdapter(dynamicNetwork, new ReceiptLedger(store), configuredGitHost!, new DurablePipelineFailureCursor(store));
    adapters.register("pipeline_status", new CompositePipelineStatusAdapter(new LocalPipelineStatusAdapter(), pipeline));
    adapters.register("pipeline_failure_trace", pipeline);
  }
  const git = new InMemoryGitBroker(context.policy, containment);
  if (options.localGitStateDirectory) {
    const localGit = new LocalMediatedGitHandler({ stateDirectory: options.localGitStateDirectory });
    git.register("local_commit", (request) => localGit.execute(request));
  }
  if (dynamicNetwork) {
    const receiptLedger = new ReceiptLedger(store);
    const directMainReceipts = { async verify(receiptId: string, targetSnapshotId: string) { const receipt = await receiptLedger.get(receiptId); return !!receipt && receipt.action === "release_shield" && await receiptLedger.isFresh(receipt, targetSnapshotId); } };
    const pullRequestHost = { async open(request: GitRequest, url: string): Promise<BrokerOutcome> {
        const fence = await containment.check(request.target.repositoryRoot, "adapter");
        if (!fence.allowed) return { status: "blocked", summary: fence.reason };
        const current = await request.effectGuard?.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
        if (!current?.allowed) return { status: "incomplete", summary: current?.reason ?? "The PR status host action lacks a final target guard." };
        const intent = await hostActions.enqueue({
          definition: commandForAction(request.action), operationId: request.operationId, target: request.target,
          ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}),
          ...(request.executionControl ? { executionControl: request.executionControl } : {}), ...(request.effectGuard ? { effectGuard: request.effectGuard } : {})
        }, { hostAction: "open_external_url", url });
        return { status: "running", summary: "The exact PR is verified; opening its status awaits an authenticated VS Code acknowledgement.", data: { hostActionId: intent.id, hostActionKind: intent.hostAction, hostActionExpiresAt: intent.expiresAt, hostActionUrl: intent.url } };
      } };
    const executeRemoteGit = async (request: GitRequest) => {
      try {
        const host = configuredGitHostFromPolicy(await options.networkPolicyRegistry!.resolve());
        return new ConfiguredRemoteGitHandler(
          new ConfiguredGitSmartHttpPusher(dynamicNetwork, host),
          new ConfiguredGitHubGraphqlPort(dynamicNetwork, host),
          host,
          directMainReceipts,
          pullRequestHost
        ).execute(request);
      } catch {
        return { status: "unavailable" as const, summary: "Remote Git requires one active exact-host GitHub or GitHub Enterprise route set.", effectDisposition: "not_started" as const };
      }
    };
    git.register("pr_upsert", executeRemoteGit);
    git.register("merge_pr", executeRemoteGit);
    git.register("direct_main", executeRemoteGit);
  }
  const recipeFor = (target: { readonly repositoryRoot: string }): RepositoryRecipe => ({ version: "b122-local-fixed-v1", repositoryRoot: target.repositoryRoot, gates: [{ name: "b122.local.git-diff-check", executable: "git", args: ["diff", "--check"], timeoutMs: 30_000 }], productionHostPatterns: ["production", "postgres://", "postgresql://"], allowedDevelopmentHosts: ["localhost", "127.0.0.1", "::1"], environmentAllowlist: [] });
  const runtimeActions = new Set<RepositoryRuntimeAction>([...repositoryProcessActions, "stop_managed_run"]);
  const executionOptions = { containment, hostActions };
  return { components: { filesystem: "canonical-allowlist", credentials, network, scanner, rawHid, sandbox, containment, council, hostActions, repositoryRuntimes, workflowArtifacts }, dependencies: { adapters, execution: options.repositorySandbox ? new SandboxedRepositoryExecutionBroker(repositoryRuntimes, options.repositorySandbox, executionOptions) : new RepositoryRuntimeExecutionBroker(repositoryRuntimes, executionOptions), git, testEnvironment: new LocalIsolatedTestEnvironmentBroker(), automation: providerTransport ? createConfiguredAutomationBroker(context.policy, containment, providerTransport) : new LocalFailClosedAutomationBroker(), isolation: options.isolationRuntime ?? new LocalFailClosedIsolationRuntime(), containment, council: new DurableConfiguredCouncilExecutor(council, context.sessions, dynamicNetwork, Date.now, { ...(options.councilIsolation ? { isolation: options.councilIsolation } : {}), ...(options.councilAutomaticGate ? { automaticGate: options.councilAutomaticGate } : {}) }), recipes: { forTarget: (target) => recipeFor(target) }, executionRecipeFactory: { create: (definition: CommandDefinition, target: TargetSnapshot) => runtimeActions.has(definition.action as RepositoryRuntimeAction) ? repositoryRuntimeExecutionRecipe(definition.action as RepositoryRuntimeAction, target) : undefined }, ...(options.localGitMutationFactory ? { gitMutationFactory: options.localGitMutationFactory } : {}) } };
}
