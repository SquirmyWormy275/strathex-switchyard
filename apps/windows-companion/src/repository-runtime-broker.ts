/** Control-plane broker for exact, host-pinned repository runtimes. */
import { createHash } from "node:crypto";

import type { AdapterRequest } from "../../../packages/control-plane/src/adapters.ts";
import type { BrokerOutcome, ContainmentGuard, ExecutionBroker, ExecutionRecipe, ExecutionRequest, IsolationRequest } from "../../../packages/control-plane/src/brokers.ts";
import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import {
  repositoryProcessActions,
  type RepositoryRuntime,
  type RepositoryRuntimeAction,
  type RepositoryRuntimeResult,
  type RuntimeEffectGuard
} from "./repository-runtime.ts";
import type { DurableHostActionQueue } from "./host-actions.ts";

const recipePrefix = "sxsy-b122.repository-runtime:";
const markerExecutable = "@sxsy-b122/host-pinned-runtime";
const actions = new Set<CommandAction>([...repositoryProcessActions, "stop_managed_run"]);
const sandboxRequiredActions = new Set<RepositoryRuntimeAction>(["pipeline_local_gate", "pipeline_clean_reproduction", "shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"]);

export interface RepositoryRuntimeResolver {
  resolve(repositoryRoot: string): Promise<RepositoryRuntime>;
}
export interface SandboxRepositoryRecipeRunner { runRecipe(request: IsolationRequest, recipeId: string): Promise<BrokerOutcome>; }
export interface RepositoryRuntimeExecutionBrokerOptions {
  readonly containment?: ContainmentGuard;
  readonly hostActions?: Pick<DurableHostActionQueue, "enqueue">;
}

export function repositoryRuntimeExecutionRecipe(action: RepositoryRuntimeAction, target: TargetSnapshot): ExecutionRecipe {
  return {
    id: `${recipePrefix}${action}`,
    executable: markerExecutable,
    args: [],
    workingDirectory: target.repositoryRoot,
    environment: {}
  };
}

/**
 * Repository command text never crosses this boundary. The declarative recipe
 * is only an exact action marker; the executable, arguments, environment, and
 * lifecycle come exclusively from the operator-attested host pin.
 */
export class RepositoryRuntimeExecutionBroker implements ExecutionBroker {
  private readonly runtimes: RepositoryRuntimeResolver;
  private readonly containment?: ContainmentGuard;
  private readonly hostActions?: Pick<DurableHostActionQueue, "enqueue">;

  constructor(runtimes: RepositoryRuntimeResolver, options: RepositoryRuntimeExecutionBrokerOptions = {}) {
    this.runtimes = runtimes;
    this.containment = options.containment;
    this.hostActions = options.hostActions;
  }

  async execute(request: ExecutionRequest): Promise<BrokerOutcome> {
    const action = request.action;
    if (!actions.has(action)) return { status: "blocked", summary: "The command action is not supported by the host-pinned repository runtime." };
    if (!exactMarker(request, action as RepositoryRuntimeAction)) {
      return { status: "blocked", summary: "The execution recipe does not exactly bind the requested host-pinned runtime action." };
    }
    if (!request.permit || Date.parse(request.permit.expiresAt) <= Date.now()) {
      return { status: "blocked", summary: "The repository runtime rejected an absent or expired durable policy permit." };
    }
    if (request.executionControl) {
      if (Date.parse(request.executionControl.deadline) <= Date.now()) return { status: "timed_out", summary: "The repository runtime deadline expired before execution." };
      if (await request.executionControl.isCancellationRequested()) return { status: "cancelled", summary: "The repository runtime observed cancellation before execution." };
    }
    if (!request.effectGuard) return { status: "blocked", summary: "The repository runtime requires an exact dispatch-bound final effect guard." };
    const admissionFence = this.containment ? await this.containment.check(request.target.repositoryRoot, "execution") : undefined;
    if (admissionFence && !admissionFence.allowed) return { status: "blocked", summary: admissionFence.reason };

    let runtime: RepositoryRuntime;
    try { runtime = await this.runtimes.resolve(request.target.repositoryRoot); }
    catch (error) { return { status: "unavailable", summary: untrustedSummary((error as Error).message) }; }

    const controller = new AbortController();
    const cleanup = this.bindCancellation(request, controller);
    const effectGuard: RuntimeEffectGuard = {
      check: async (_runtimeAction, repositoryRoot) => {
        if (!samePath(repositoryRoot, request.target.repositoryRoot)) return { allowed: false, reason: "The pinned runtime repository no longer matches the protected target." };
        const fence = this.containment ? await this.containment.check(request.target.repositoryRoot, "execution") : undefined;
        if (fence && !fence.allowed) return { allowed: false, reason: fence.reason };
        return request.effectGuard!.assertCurrent({
          action: request.action,
          operationId: request.operationId,
          target: request.target,
          ...(request.session ? { session: request.session } : {}),
          ...(request.authority ? { authority: request.authority } : {})
        });
      }
    };
    try {
      const result = await runtime.execute(action as RepositoryRuntimeAction, { signal: controller.signal, effectGuard });
      if (action === "debug_target" && result.status === "running" && result.debugConfiguration && this.hostActions) {
        return this.queueVerifiedDebug(request, result.debugConfiguration);
      }
      if ((action === "venv" || action === "rebuild_venv") && result.status === "completed" && result.pythonInterpreter && this.hostActions) {
        return this.queueVerifiedPythonEnvironment(request, result.pythonInterpreter, result);
      }
      if (action === "launch_web_app" && result.status === "running" && result.url && this.hostActions) {
        return this.queueVerifiedWebOpen(request, runtime, result);
      }
      return mapResult(result);
    } catch (error) {
      return { status: "failed", summary: `The verified repository runtime failed safely: ${untrustedSummary((error as Error).message)}` };
    } finally { cleanup(); }
  }

  private async queueVerifiedPythonEnvironment(request: ExecutionRequest, interpreter: string, result: RepositoryRuntimeResult): Promise<BrokerOutcome> {
    if (!samePath(interpreter, `${request.target.repositoryRoot}\\.venv\\Scripts\\python.exe`)) return { status: "blocked", summary: "The runtime produced a Python interpreter outside the exact repo-local .venv boundary." };
    const fence = this.containment ? await this.containment.check(request.target.repositoryRoot, "adapter") : undefined;
    if (fence && !fence.allowed) return { status: "blocked", summary: fence.reason };
    const current = await request.effectGuard!.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
    if (!current.allowed) return { status: "incomplete", summary: current.reason };
    try {
      const intent = await this.hostActions!.enqueue({
        definition: commandForAction(request.action), operationId: request.operationId, target: request.target,
        ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}),
        ...(request.executionControl ? { executionControl: request.executionControl } : {}), effectGuard: request.effectGuard
      }, { hostAction: "configure_python_venv", pythonInterpreter: interpreter });
      const mapped = mapResult(result);
      return { status: "running", summary: "The repo-local Python environment is ready; exact VS Code selection and terminal creation await authenticated host acknowledgement.", data: { ...(mapped.data ?? {}), hostActionId: intent.id, hostActionKind: intent.hostAction, hostActionExpiresAt: intent.expiresAt, hostActionWorkspaceRoot: intent.workspaceRoot, hostActionPythonInterpreter: intent.pythonInterpreter } };
    } catch {
      return { status: "failed", summary: "The verified Python environment could not be durably queued for the authenticated VS Code host." };
    }
  }

  private async queueVerifiedDebug(request: ExecutionRequest, configuration: string): Promise<BrokerOutcome> {
    if (!configuration.trim() || configuration.length > 256 || /[\r\n\0]/.test(configuration)) return { status: "blocked", summary: "The verified runtime returned an invalid VS Code debug configuration." };
    const fence = this.containment ? await this.containment.check(request.target.repositoryRoot, "adapter") : undefined;
    if (fence && !fence.allowed) return { status: "blocked", summary: fence.reason };
    const current = await request.effectGuard!.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
    if (!current.allowed) return { status: "incomplete", summary: current.reason };
    try {
      const intent = await this.hostActions!.enqueue({
        definition: commandForAction(request.action), operationId: request.operationId, target: request.target,
        ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}),
        ...(request.executionControl ? { executionControl: request.executionControl } : {}), effectGuard: request.effectGuard
      }, { hostAction: "start_vscode_debug", debugConfiguration: configuration });
      return {
        status: "running",
        summary: "Starting the exact verified launch configuration awaits an authenticated VS Code acknowledgement.",
        data: {
          hostActionId: intent.id,
          hostActionKind: intent.hostAction,
          hostActionExpiresAt: intent.expiresAt,
          hostActionWorkspaceRoot: intent.workspaceRoot,
          hostActionDebugConfiguration: intent.debugConfiguration
        }
      };
    } catch {
      return { status: "failed", summary: "The verified debug configuration could not be durably queued for the authenticated VS Code host." };
    }
  }

  private async queueVerifiedWebOpen(request: ExecutionRequest, runtime: RepositoryRuntime, result: RepositoryRuntimeResult): Promise<BrokerOutcome> {
    const cleanup = async (): Promise<void> => {
      if (result.managedProcessId) await runtime.terminateManagedForContainment(result.managedProcessId).catch(() => false);
    };
    if (!result.url || !trustedRuntimeUrl(result.url)) {
      await cleanup();
      return { status: "blocked", summary: "The verified web runtime returned a host URL outside the exact HTTPS or loopback boundary; its managed child was stopped." };
    }
    const fence = this.containment ? await this.containment.check(request.target.repositoryRoot, "adapter") : undefined;
    if (fence && !fence.allowed) {
      await cleanup();
      return { status: "blocked", summary: `${fence.reason} The managed web child was stopped before any host action was queued.` };
    }
    const current = await request.effectGuard!.assertCurrent({
      action: request.action,
      operationId: request.operationId,
      target: request.target,
      ...(request.session ? { session: request.session } : {}),
      ...(request.authority ? { authority: request.authority } : {})
    });
    if (!current.allowed) {
      await cleanup();
      return { status: "incomplete", summary: `${current.reason} The managed web child was stopped before any host action was queued.` };
    }
    try {
      const adapterRequest: AdapterRequest = {
        definition: commandForAction(request.action),
        operationId: request.operationId,
        target: request.target,
        ...(request.session ? { session: request.session } : {}),
        ...(request.authority ? { authority: request.authority } : {}),
        ...(request.executionControl ? { executionControl: request.executionControl } : {}),
        effectGuard: request.effectGuard
      };
      const intent = await this.hostActions!.enqueue(adapterRequest, { hostAction: "open_external_url", url: result.url });
      const mapped = mapResult(result);
      return {
        status: "running",
        summary: "The managed web application passed its health probe; opening its exact URL awaits an authenticated VS Code acknowledgement.",
        data: {
          ...(mapped.data ?? {}),
          hostActionId: intent.id,
          hostActionKind: intent.hostAction,
          hostActionExpiresAt: intent.expiresAt,
          hostActionUrl: intent.url
        }
      };
    } catch {
      await cleanup();
      return { status: "failed", summary: "The verified web runtime could not durably queue its authenticated host action; its managed child was stopped." };
    }
  }

  private bindCancellation(request: ExecutionRequest, controller: AbortController): () => void {
    const deadline = request.executionControl ? Date.parse(request.executionControl.deadline) : Date.parse(request.permit!.expiresAt);
    const deadlineTimer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    const cancellationTimer = request.executionControl ? setInterval(() => {
      void request.executionControl!.isCancellationRequested().then((cancelled) => { if (cancelled) controller.abort(); }).catch(() => controller.abort());
    }, 100) : undefined;
    deadlineTimer.unref?.();
    cancellationTimer?.unref?.();
    return () => { clearTimeout(deadlineTimer); if (cancellationTimer) clearInterval(cancellationTimer); };
  }
}

/** Sends every pipeline/security recipe through the installed OS sandbox; ordinary run/debug recipes retain the host-pinned runtime. */
export class SandboxedRepositoryExecutionBroker implements ExecutionBroker {
  private readonly host: RepositoryRuntimeExecutionBroker;
  private readonly sandbox: SandboxRepositoryRecipeRunner;
  private readonly containment?: ContainmentGuard;
  constructor(runtimes: RepositoryRuntimeResolver, sandbox: SandboxRepositoryRecipeRunner, options: RepositoryRuntimeExecutionBrokerOptions = {}) {
    this.host = new RepositoryRuntimeExecutionBroker(runtimes, options);
    this.sandbox = sandbox;
    this.containment = options.containment;
  }
  async execute(request: ExecutionRequest): Promise<BrokerOutcome> {
    if (!sandboxRequiredActions.has(request.action as RepositoryRuntimeAction)) return this.host.execute(request);
    if (!exactMarker(request, request.action as RepositoryRuntimeAction)) return { status: "blocked", summary: "The sandboxed repository recipe marker does not exactly bind the requested action." };
    if (!request.effectGuard) return { status: "blocked", summary: "Sandboxed repository validation requires an exact final effect guard." };
    const fence = this.containment ? await this.containment.check(request.target.repositoryRoot, "execution") : undefined;
    if (fence && !fence.allowed) return { status: "blocked", summary: fence.reason };
    return this.sandbox.runRecipe({
      action: request.action,
      operationId: request.operationId,
      target: request.target,
      ...(request.session ? { session: request.session } : {}),
      ...(request.authority ? { authority: request.authority } : {}),
      ...(request.permit ? { permit: request.permit } : {}),
      ...(request.executionControl ? { executionControl: request.executionControl } : {}),
      effectGuard: request.effectGuard,
      profile: "full_sandbox"
    }, request.action);
  }
}

function exactMarker(request: ExecutionRequest, action: RepositoryRuntimeAction): boolean {
  const expected = repositoryRuntimeExecutionRecipe(action, request.target);
  const environment = request.recipe.environment;
  const sanitizedIsolationMarker = environment.NODE_ENV === "test"
    && environment.SXSY_TEST_MODE === "1"
    && environment.SXSY_NETWORK === "deny"
    && Object.keys(environment).length === 3;
  const environmentMatches = Object.keys(environment).length === 0 || sanitizedIsolationMarker;
  return request.recipe.id === expected.id
    && request.recipe.executable === expected.executable
    && request.recipe.args.length === 0
    && environmentMatches
    && samePath(request.recipe.workingDirectory, expected.workingDirectory);
}

function mapResult(result: RepositoryRuntimeResult): BrokerOutcome {
  const data: Record<string, unknown> = {};
  if (result.managedProcessId) data.managedProcessId = result.managedProcessId;
  if (result.pid !== undefined) data.pid = result.pid;
  if (result.exitCode !== undefined) data.exitCode = result.exitCode;
  if (result.url) data.url = result.url;
  if (result.output !== undefined) {
    data.outputSha256 = createHash("sha256").update(result.output).digest("hex");
    data.outputBytes = Buffer.byteLength(result.output, "utf8");
    data.outputTruncated = result.outputTruncated ?? false;
  }
  return { status: result.status, summary: untrustedSummary(result.summary), ...(Object.keys(data).length ? { data } : {}) };
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
  const [a, b] = [normalize(left), normalize(right)];
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function trustedRuntimeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || !url.hostname) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch { return false; }
}
