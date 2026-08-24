/** Control-plane broker for exact, host-pinned repository runtimes. */
import { createHash } from "node:crypto";

import type { BrokerOutcome, ExecutionBroker, ExecutionRecipe, ExecutionRequest } from "../../../packages/control-plane/src/brokers.ts";
import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import {
  repositoryProcessActions,
  type RepositoryRuntime,
  type RepositoryRuntimeAction,
  type RepositoryRuntimeResult,
  type RuntimeEffectGuard
} from "./repository-runtime.ts";

const recipePrefix = "sxsy-b122.repository-runtime:";
const markerExecutable = "@sxsy-b122/host-pinned-runtime";
const actions = new Set<CommandAction>([...repositoryProcessActions, "stop_managed_run"]);

export interface RepositoryRuntimeResolver {
  resolve(repositoryRoot: string): Promise<RepositoryRuntime>;
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

  constructor(runtimes: RepositoryRuntimeResolver) { this.runtimes = runtimes; }

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

    let runtime: RepositoryRuntime;
    try { runtime = await this.runtimes.resolve(request.target.repositoryRoot); }
    catch (error) { return { status: "unavailable", summary: untrustedSummary((error as Error).message) }; }

    const controller = new AbortController();
    const cleanup = this.bindCancellation(request, controller);
    const effectGuard: RuntimeEffectGuard = {
      check: async (_runtimeAction, repositoryRoot) => {
        if (!samePath(repositoryRoot, request.target.repositoryRoot)) return { allowed: false, reason: "The pinned runtime repository no longer matches the protected target." };
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
      return mapResult(result);
    } catch (error) {
      return { status: "failed", summary: `The verified repository runtime failed safely: ${untrustedSummary((error as Error).message)}` };
    } finally { cleanup(); }
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
