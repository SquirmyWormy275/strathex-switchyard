/** Concrete, conservative host composition for the installed companion. */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AdapterRegistry, type AdapterOutcome, type AdapterRequest, type CommandAdapter } from "../../../packages/control-plane/src/adapters.ts";
import type { AutomationBroker, AutomationRequest, BrokerOutcome, ExecutionBroker, ExecutionRequest, ExecutionRecipe, GitBroker, GitRequest, IsolationRuntime, IsolationRequest, TestEnvironmentBroker, TestEnvironmentRequest, TestEnvironmentOutcome } from "../../../packages/control-plane/src/brokers.ts";
import { DurableContainmentManager } from "../../../packages/control-plane/src/containment.ts";
import { CouncilCoordinator, type CouncilParticipant } from "../../../packages/control-plane/src/council.ts";
import type { CouncilExecutor, CommandDispatcherDependencies } from "../../../packages/control-plane/src/dispatch.ts";
import type { RuntimeDispatcherContext } from "../../../packages/control-plane/src/runtime.ts";
import type { CommandDefinition } from "../../../packages/control-plane/src/command-catalog.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { RepositoryRecipe } from "../../../packages/control-plane/src/recipes.ts";
import type { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { captureLiveTargetSnapshot, FilesystemBroker, LocalCredentialBroker, LocalNetworkBroker, LocalProcessBroker, LocalSandboxBroker, RawHidLoopbackTransport, ScannerFeedBroker, defaultRepositoryPolicy } from "./local-runtime.ts";

// Every default process recipe is structured and shell-free. Keep the shared
// allowlist narrow: reviewed commit summaries use hyphen/underscore words,
// rather than widening the generic process broker for arbitrary Git flags.
const processPolicy = /^[A-Za-z0-9_./:=@{}+-]+$/;
const scannerFixture = createHash("sha256").update(JSON.stringify("")).digest("hex");
function mapped(result: { readonly outcome: string; readonly detail: string }): BrokerOutcome {
  return { status: result.outcome === "passed" ? "completed" : result.outcome === "blocked" ? "blocked" : result.outcome === "unavailable" ? "unavailable" : "failed", summary: result.detail };
}
function permit(request: Readonly<{ permit?: { readonly expiresAt: string }; executionControl?: { readonly deadline: string; isCancellationRequested(): Promise<boolean> } }>): BrokerOutcome | undefined {
  if (!request.permit || Date.parse(request.permit.expiresAt) <= Date.now()) return { status: "blocked", summary: "The local broker rejected an absent or expired durable permit." };
  if (request.executionControl && Date.parse(request.executionControl.deadline) <= Date.now()) return { status: "timed_out", summary: "The local broker rejected an expired execution deadline." };
  return undefined;
}

class LocalStructuredExecutionBroker implements ExecutionBroker {
  private readonly processes: LocalProcessBroker; private readonly scanner: ScannerFeedBroker;
  constructor(processes: LocalProcessBroker, scanner: ScannerFeedBroker) { this.processes = processes; this.scanner = scanner; }
  async execute(request: ExecutionRequest): Promise<BrokerOutcome> {
    const denied = permit(request); if (denied) return denied;
    if (request.executionControl && await request.executionControl.isCancellationRequested()) return { status: "cancelled", summary: "The local execution broker observed a durable cancellation request." };
    if (request.recipe.id !== "b122.local.git-diff-check" || request.recipe.executable !== "git" || request.recipe.args.join("\u0000") !== "diff\u0000--check") return { status: "unavailable", summary: "No reviewed local execution recipe is configured; the companion will not infer a command." };
    let canonicalRoot: string;
    try { canonicalRoot = await new FilesystemBroker(defaultRepositoryPolicy(request.target.repositoryRoot)).canonical(request.target.repositoryRoot); }
    catch { return { status: "blocked", summary: "The execution target is outside the canonical local filesystem allowlist." }; }
    const feed = this.scanner.ingest("", Date.now()); if (feed.outcome !== "passed") return mapped(feed);
    return mapped(await this.processes.execute("git", request.recipe.args, canonicalRoot));
  }
}

class LocalIsolatedTestEnvironmentBroker implements TestEnvironmentBroker {
  private readonly stateDirectory: string;
  constructor(stateDirectory: string) { this.stateDirectory = stateDirectory; }
  async prepare(request: TestEnvironmentRequest): Promise<TestEnvironmentOutcome> {
    const denied = permit(request); if (denied) return denied;
    const filesystem = new FilesystemBroker(defaultRepositoryPolicy(request.target.repositoryRoot));
    let root: string; try { root = await filesystem.canonical(request.target.repositoryRoot); } catch { return { status: "blocked", summary: "The verified target is outside the local filesystem allowlist." }; }
    let recipeRoot: string; try { recipeRoot = await filesystem.canonical(request.recipe.repositoryRoot); } catch { return { status: "blocked", summary: "The declared test recipe root is outside the local filesystem allowlist." }; }
    const normalized = (value: string) => value.replaceAll("\\", "/").replace(/^\/\/\?\//, "").replace(/\/+$/, "").toLowerCase();
    if (normalized(root) !== normalized(recipeRoot)) return { status: "blocked", summary: "The declared test recipe does not bind to the exact canonical target root." };
    if (Object.entries(request.sourceEnvironment).some(([key, value]) => /(secret|token|password|credential|api[_-]?key)/i.test(key) || (value !== undefined && /production|postgres(?:ql)?:\/\//i.test(value)))) return { status: "blocked", summary: "The isolated test broker rejected an ambient secret or production-looking input." };
    const base = join(this.stateDirectory, "isolated-tests"); await mkdir(base, { recursive: true }); const tempRoot = await mkdtemp(join(base, "run-")); const id = tempRoot.split(/[\\/]/).at(-1) ?? "isolated";
    return { status: "completed", summary: "Allocated a disposable deny-egress local test environment.", environment: { id, tempRoot, databaseName: `sxsy_test_${id}`, egress: "deny", environment: { NODE_ENV: "test", SXSY_TEST_MODE: "1", SXSY_NETWORK: "deny" } } };
  }
}

/**
 * Typed, review-gated local Git workflow.  It invokes only fixed Git
 * subcommands without a shell, revalidates the protected target before the
 * first mutation, and names every irreversible provider step in the durable
 * child saga supplied by the dispatcher.
 */
class LocalReviewedGitBroker implements GitBroker {
  private readonly processes: LocalProcessBroker;
  constructor(processes: LocalProcessBroker) { this.processes = processes; }

  async execute(request: GitRequest): Promise<BrokerOutcome> {
    const denied = permit(request); if (denied) return denied;
    let root: string;
    try { root = await new FilesystemBroker(defaultRepositoryPolicy(request.target.repositoryRoot)).canonical(request.target.repositoryRoot); }
    catch { return { status: "blocked", summary: "The Git mutation target is outside the canonical local filesystem allowlist." }; }
    try {
      const live = await captureLiveTargetSnapshot(root, request.target.policyVersion);
      if (live.gitRoot.replaceAll("\\", "/").toLowerCase() !== root.replaceAll("\\", "/").toLowerCase() || live.head !== request.target.head || live.indexTree !== request.target.indexTree) {
        return { status: "blocked", summary: "Live repository state no longer matches the protected TargetSnapshot; no Git mutation was started." };
      }
    } catch { return { status: "unavailable", summary: "The companion could not revalidate the exact local Git target." }; }
    switch (request.mutation.kind) {
      case "local_commit": {
        if (!request.mutation.paths.every((path) => validRelativePath(path)) || !validCommitMessage(request.mutation.message)) return { status: "blocked", summary: "The reviewed commit package contains an unsafe path or commit message." };
        const staged = await this.step(request, "stage", root, ["add", "--", ...request.mutation.paths]);
        if (staged.status !== "completed") return staged;
        return this.step(request, "commit", root, ["commit", "-m", request.mutation.message]);
      }
      case "pr_upsert": {
        if (!validBranch(request.mutation.headBranch) || !validBranch(request.mutation.baseBranch) || request.mutation.headBranch === request.mutation.baseBranch) return { status: "blocked", summary: "The reviewed PR package contains an invalid or ambiguous branch." };
        // This is deliberately only the safe local half of PR upsert. A
        // provider-backed PR creation requires a separately configured,
        // scoped GitHub credential adapter; it is never guessed from Git.
        return this.step(request, "push-reviewed-head", root, ["push", "origin", `HEAD:refs/heads/${request.mutation.headBranch}`]);
      }
      case "merge_pr":
        return { status: "unavailable", summary: "PR merge requires the configured GitHub credential/provider adapter; no local merge or direct-main fallback was attempted." };
      case "direct_main":
        return { status: "blocked", summary: "Direct-main mutation is prohibited by the default local policy." };
    }
  }

  private async step(request: GitRequest, scope: string, root: string, args: readonly string[]): Promise<BrokerOutcome> {
    const saga = request.childSaga;
    const child = saga ? await saga.begin({ action: `git.${scope}`, idempotencyScope: `${request.mutation.kind}:${scope}`, details: { command: `git ${args[0]}` } }) : undefined;
    if (child && !child.mayExecute) return { status: "blocked", summary: "A prior Git child operation exists and requires reconciliation; it was not replayed." };
    if (child) await saga!.markExecuting(child);
    const result = await this.processes.execute("git", args, root);
    const outcome = mapped(result);
    if (child) await saga!.settle(child, outcome.status === "completed" ? "completed" : outcome.status === "blocked" ? "cancelled" : "failed", { result: outcome.status });
    return outcome;
  }
}
function validRelativePath(path: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9_.@/ -]{0,240}$/.test(path) && !path.split(/[\\/]/).includes("..") && !path.split(/[\\/]/).includes(".git"); }
function validCommitMessage(message: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9_.:@{}+-]{0,119}$/.test(message); }
function validBranch(branch: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch) && !branch.includes("..") && !branch.endsWith("/"); }
class LocalFailClosedAutomationBroker implements AutomationBroker { async execute(request: AutomationRequest): Promise<BrokerOutcome> { return permit(request) ?? { status: "unavailable", summary: "No local provider automation adapter is installed; no prompt, workflow, credential, or network request was submitted." }; } }
class LocalFailClosedIsolationRuntime implements IsolationRuntime {
  private readonly sandboxes: LocalSandboxBroker;
  constructor(sandboxes: LocalSandboxBroker) { this.sandboxes = sandboxes; }
  async start(request: IsolationRequest): Promise<BrokerOutcome> { void this.sandboxes; return permit(request) ?? { status: "unavailable", summary: `${request.profile} requires a reviewed OS-enforced sandbox backend; no weaker copy-based sandbox was started.` }; }
}
class LocalCouncilExecutor implements CouncilExecutor {
  private readonly council: CouncilCoordinator;
  constructor(council: CouncilCoordinator) { this.council = council; }
  async execute(request: Parameters<CouncilExecutor["execute"]>[0]): Promise<BrokerOutcome> {
    const denied = permit(request); if (denied) return denied;
    if (!request.session) return { status: "unavailable", summary: "Council requires a verified selected participant." };
    if (request.action !== "council_report") return { status: "unavailable", summary: "Automatic Council needs multiple live mediated participants and explicit acknowledgement; it was not started." };
    const participant: CouncilParticipant = { id: request.session.id, targetSnapshotId: request.target.id, status: request.session.status, capabilities: request.session.capabilities, lastHeartbeat: request.session.lastHeartbeat, plannedFiles: request.session.plannedFiles, resources: [], dependencies: [], diffDigest: `${request.target.trackedManifest}:${request.target.untrackedManifest}` };
    try { const report = await this.council.report({ repositoryRoot: request.target.repositoryRoot, targetSnapshotId: request.target.id, participants: [participant] }); return { status: "completed", summary: "Collected a durable one-participant Council report; automatic coordination remains unavailable without peers.", data: { participants: report.participants.length, atomic: report.atomic } }; }
    catch { return { status: "unavailable", summary: "Council participant state could not be durably validated." }; }
  }
}
class LocalPipelineStatusAdapter implements CommandAdapter {
  readonly id = "local-pipeline-status"; readonly kind = "generic" as const;
  private readonly processes: LocalProcessBroker;
  constructor(processes: LocalProcessBroker) { this.processes = processes; }
  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    if (!request.target) return { status: "unavailable", summary: "Pipeline status requires an exact target." };
    try { await new FilesystemBroker(defaultRepositoryPolicy(request.target.repositoryRoot)).canonical(request.target.repositoryRoot); } catch { return { status: "blocked", summary: "Pipeline status target is outside the local filesystem allowlist." }; }
    const checked = await this.processes.execute("git", ["status", "--porcelain=v1", "--branch"], request.target.repositoryRoot);
    return { status: checked.outcome === "passed" ? "completed" : checked.outcome === "blocked" ? "blocked" : checked.outcome === "unavailable" ? "unavailable" : "failed", summary: checked.detail, data: { broker: "filesystem+process+git" } };
  }
}

export interface DefaultLocalComposition {
  readonly filesystem: "canonical-allowlist"; readonly credentials: LocalCredentialBroker; readonly network: LocalNetworkBroker; readonly processes: LocalProcessBroker; readonly scanner: ScannerFeedBroker; readonly rawHid: RawHidLoopbackTransport; readonly sandbox: LocalSandboxBroker; readonly containment: DurableContainmentManager; readonly council: CouncilCoordinator;
}
export function createDefaultLocalComposition(context: RuntimeDispatcherContext, store: ProtectedJsonStore, stateDirectory = dirname(store.filePath)): { readonly dependencies: Omit<CommandDispatcherDependencies, "policy" | "sessions" | "authorities" | "operations" | "receiptEvidence" | "governance">; readonly components: DefaultLocalComposition } {
  void context;
  const credentials = new LocalCredentialBroker(); const network = new LocalNetworkBroker(new Set(), { send: async () => { throw new Error("No approved network transport is configured."); } }, credentials);
  const processes = new LocalProcessBroker([{ executable: "git", argumentPattern: processPolicy, timeoutMs: 30_000, outputLimit: 32_768 }]); const scanner = new ScannerFeedBroker(scannerFixture); const rawHid = new RawHidLoopbackTransport(); const sandbox = new LocalSandboxBroker(join(stateDirectory, "sandboxes")); const containment = new DurableContainmentManager(store); const council = new CouncilCoordinator(store);
  const adapters = new AdapterRegistry(); adapters.register("pipeline_status", new LocalPipelineStatusAdapter(processes));
  const recipeFor = (target: { readonly repositoryRoot: string }): RepositoryRecipe => ({ version: "b122-local-fixed-v1", repositoryRoot: target.repositoryRoot, gates: [{ name: "b122.local.git-diff-check", executable: "git", args: ["diff", "--check"], timeoutMs: 30_000 }], productionHostPatterns: ["production", "postgres://", "postgresql://"], allowedDevelopmentHosts: ["localhost", "127.0.0.1", "::1"], environmentAllowlist: [] });
  return { components: { filesystem: "canonical-allowlist", credentials, network, processes, scanner, rawHid, sandbox, containment, council }, dependencies: { adapters, execution: new LocalStructuredExecutionBroker(processes, scanner), git: new LocalReviewedGitBroker(processes), testEnvironment: new LocalIsolatedTestEnvironmentBroker(stateDirectory), automation: new LocalFailClosedAutomationBroker(), isolation: new LocalFailClosedIsolationRuntime(sandbox), containment, council: new LocalCouncilExecutor(council), recipes: { forTarget: (target) => recipeFor(target) }, executionRecipeFactory: { create: (definition: CommandDefinition, target: TargetSnapshot): ExecutionRecipe | undefined => ["shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"].includes(definition.action) ? { id: "b122.local.git-diff-check", executable: "git", args: ["diff", "--check"], workingDirectory: target.repositoryRoot, environment: {} } : undefined } } };
}
