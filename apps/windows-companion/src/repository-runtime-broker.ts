/** Control-plane broker for exact, host-pinned repository runtimes. */
import { createHash } from "node:crypto";

import type { AdapterRequest } from "../../../packages/control-plane/src/adapters.ts";
import type { BrokerOutcome, ContainmentGuard, ExecutionBroker, ExecutionRecipe, ExecutionRequest, IsolationRequest } from "../../../packages/control-plane/src/brokers.ts";
import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { createDurableAbortControl } from "../../../packages/control-plane/src/execution-cancellation.ts";
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

export interface RepositoryRecipeCoverage {
  readonly dimension: string;
  readonly status: "covered" | "unavailable";
  readonly fixtureId?: string;
}

/** Trusted host inputs only; recipe stdout and repository files cannot populate this binding. */
export interface RepositoryRecipeEvidenceBinding {
  readonly manifestSha256: string;
  readonly helperSha256: string;
  readonly helperVersion: string;
  readonly resultSha256: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly scannerFixtureIds: readonly string[];
  readonly advisoryFixtureIds: readonly string[];
  readonly coverage: readonly RepositoryRecipeCoverage[];
  readonly policyVersion: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface RepositoryRecipeEvidenceEnvelope {
  readonly schema: "sxsy-b122.repository-recipe-evidence";
  readonly version: 1;
  readonly operationId: string;
  readonly action: string;
  readonly recipeId: string;
  readonly targetSnapshotId: string;
  readonly targetSnapshotSha256: string;
  readonly policyVersion: string;
  readonly manifestSha256: string;
  readonly helperSha256: string;
  readonly helperVersion: string;
  readonly resultSha256: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly scannerFixtureIds: readonly string[];
  readonly advisoryFixtureIds: readonly string[];
  readonly coverage: readonly RepositoryRecipeCoverage[];
  readonly output: Readonly<{ sha256: string; bytes: number; truncated: boolean }>;
  readonly completeness: "complete" | "incomplete";
  readonly unavailableDimensions: readonly string[];
  readonly outcome: "passed" | "failed" | "incomplete";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly evidenceSha256: string;
}

const evidenceSchema = "sxsy-b122.repository-recipe-evidence" as const;
const digestPattern = /^[a-f0-9]{64}$/;
const coverageByAction: Readonly<Record<string, readonly string[]>> = {
  pipeline_local_gate: ["correctness", "isolation", "production_data", "ambient_credentials"],
  pipeline_clean_reproduction: ["correctness", "reproduction", "isolation", "production_data", "ambient_credentials"],
  shield_change_scan: ["secrets", "pii", "security_defects"],
  shield_codebase_audit: ["secrets", "history", "insecure_paths", "permissions", "infrastructure"],
  shield_supply_chain: ["vulnerabilities", "licenses", "provenance", "sbom"],
  release_shield: ["secrets", "pii", "security_defects", "history", "insecure_paths", "permissions", "infrastructure", "vulnerabilities", "licenses", "provenance", "sbom", "isolation"]
};

export function createRepositoryRecipeEvidence(
  request: ExecutionRequest,
  result: RepositoryRuntimeResult,
  binding: RepositoryRecipeEvidenceBinding,
  now = Date.now()
): RepositoryRecipeEvidenceEnvelope {
  const required = coverageByAction[request.action] ?? [];
  const unavailable = new Set<string>();
  const coverage = [...binding.coverage].map((entry) => ({ ...entry })).sort((left, right) => left.dimension.localeCompare(right.dimension));
  const seen = new Set<string>();
  for (const entry of coverage) {
    if (!entry.dimension.trim() || seen.has(entry.dimension) || entry.status === "unavailable" || entry.status === "covered" && !entry.fixtureId?.trim()) unavailable.add(entry.dimension || "invalid_coverage");
    seen.add(entry.dimension);
  }
  for (const dimension of required) if (!seen.has(dimension) || coverage.find((entry) => entry.dimension === dimension)?.status !== "covered") unavailable.add(dimension);
  if (required.length === 0) unavailable.add("unsupported_recipe_evidence");
  if (request.target.completeness !== "complete") unavailable.add("target_snapshot");
  if (result.status !== "completed" || result.exitCode !== undefined && result.exitCode !== 0) unavailable.add("result");
  if (result.outputTruncated) unavailable.add("output_truncated");
  if (binding.policyVersion !== request.target.policyVersion) unavailable.add("policy_version");
  if (![binding.manifestSha256, binding.helperSha256, binding.resultSha256].every((value) => digestPattern.test(value))) unavailable.add("attestation_digest");
  if (!binding.helperVersion.trim()) unavailable.add("helper_version");
  if (Object.keys(binding.toolVersions).length === 0 || Object.values(binding.toolVersions).some((value) => !value.trim())) unavailable.add("tool_versions");
  const security = request.action.startsWith("shield_") || request.action === "release_shield";
  const advisory = request.action === "shield_supply_chain" || request.action === "release_shield";
  if (security && binding.scannerFixtureIds.length === 0) unavailable.add("scanner_freshness");
  if (advisory && binding.advisoryFixtureIds.length === 0) unavailable.add("advisory_freshness");
  const created = Date.parse(binding.createdAt);
  const expires = Date.parse(binding.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= now || expires <= created) unavailable.add("fixture_freshness");
  const outputText = result.output ?? "";
  const base = {
    schema: evidenceSchema,
    version: 1 as const,
    operationId: request.operationId,
    action: request.action,
    recipeId: request.recipe.id,
    targetSnapshotId: request.target.id,
    targetSnapshotSha256: sha256Canonical(request.target),
    policyVersion: binding.policyVersion,
    manifestSha256: binding.manifestSha256,
    helperSha256: binding.helperSha256,
    helperVersion: binding.helperVersion,
    resultSha256: binding.resultSha256,
    toolVersions: sortedRecord(binding.toolVersions),
    scannerFixtureIds: [...binding.scannerFixtureIds].sort(),
    advisoryFixtureIds: [...binding.advisoryFixtureIds].sort(),
    coverage,
    output: { sha256: createHash("sha256").update(outputText).digest("hex"), bytes: Buffer.byteLength(outputText, "utf8"), truncated: result.outputTruncated ?? false },
    completeness: unavailable.size === 0 ? "complete" as const : "incomplete" as const,
    unavailableDimensions: [...unavailable].sort(),
    outcome: result.status !== "completed" ? "failed" as const : unavailable.size === 0 ? "passed" as const : "incomplete" as const,
    createdAt: binding.createdAt,
    expiresAt: binding.expiresAt
  };
  return { ...base, evidenceSha256: sha256Canonical(base) };
}

export function verifyRepositoryRecipeEvidence(
  envelope: RepositoryRecipeEvidenceEnvelope,
  request: ExecutionRequest,
  binding: RepositoryRecipeEvidenceBinding,
  now = Date.now()
): Readonly<{ valid: boolean; reason: string }> {
  const created = Date.parse(envelope.createdAt);
  const expires = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= now || expires <= created) return { valid: false, reason: "Repository recipe evidence is expired or future-dated." };
  const { evidenceSha256, ...base } = envelope;
  if (!digestPattern.test(evidenceSha256) || sha256Canonical(base) !== evidenceSha256) return { valid: false, reason: "Repository recipe evidence digest is invalid or tampered." };
  const expectedBinding = canonicalString({
    operationId: request.operationId,
    action: request.action,
    recipeId: request.recipe.id,
    targetSnapshotId: request.target.id,
    targetSnapshotSha256: sha256Canonical(request.target),
    policyVersion: binding.policyVersion,
    manifestSha256: binding.manifestSha256,
    helperSha256: binding.helperSha256,
    helperVersion: binding.helperVersion,
    resultSha256: binding.resultSha256,
    toolVersions: sortedRecord(binding.toolVersions),
    scannerFixtureIds: [...binding.scannerFixtureIds].sort(),
    advisoryFixtureIds: [...binding.advisoryFixtureIds].sort(),
    coverage: [...binding.coverage].map((entry) => ({ ...entry })).sort((left, right) => left.dimension.localeCompare(right.dimension)),
    createdAt: binding.createdAt,
    expiresAt: binding.expiresAt
  });
  const actualBinding = canonicalString({
    operationId: envelope.operationId,
    action: envelope.action,
    recipeId: envelope.recipeId,
    targetSnapshotId: envelope.targetSnapshotId,
    targetSnapshotSha256: envelope.targetSnapshotSha256,
    policyVersion: envelope.policyVersion,
    manifestSha256: envelope.manifestSha256,
    helperSha256: envelope.helperSha256,
    helperVersion: envelope.helperVersion,
    resultSha256: envelope.resultSha256,
    toolVersions: envelope.toolVersions,
    scannerFixtureIds: envelope.scannerFixtureIds,
    advisoryFixtureIds: envelope.advisoryFixtureIds,
    coverage: envelope.coverage,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt
  });
  return expectedBinding === actualBinding
    ? { valid: true, reason: "Repository recipe evidence is current and exactly bound." }
    : { valid: false, reason: "Repository recipe evidence does not match the exact trusted host binding." };
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
    const operationControl = await createDurableAbortControl(request.executionControl, { fallbackDeadline: request.permit.expiresAt });
    const initialAbort = operationControl.reason();
    if (initialAbort) {
      operationControl.dispose();
      return initialAbort === "deadline"
        ? { status: "timed_out", summary: "The repository runtime deadline expired while checking durable cancellation.", effectDisposition: "not_started" }
        : initialAbort === "cancelled"
          ? { status: "cancelled", summary: "The repository runtime observed cancellation before execution.", effectDisposition: "not_started" }
          : { status: "unavailable", summary: "The repository runtime could not verify durable cancellation state before execution.", effectDisposition: "not_started" };
    }
    try {
      if (!request.effectGuard) return { status: "blocked", summary: "The repository runtime requires an exact dispatch-bound final effect guard." };
      const admissionFence = this.containment ? await this.containment.check(request.target.repositoryRoot, "execution") : undefined;
      if (admissionFence && !admissionFence.allowed) return { status: "blocked", summary: admissionFence.reason };

      let runtime: RepositoryRuntime;
      try { runtime = await this.runtimes.resolve(request.target.repositoryRoot); }
      catch (error) { return { status: "unavailable", summary: untrustedSummary((error as Error).message) }; }

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
      const result = await runtime.execute(action as RepositoryRuntimeAction, { operationId: request.operationId, signal: operationControl.signal, effectGuard });
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
    } finally { operationControl.dispose(); }
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
    const outcome = await this.sandbox.runRecipe({
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
    if (outcome.status === "completed" && !boundHostReceipt(outcome.data?.receiptEvidenceEnvelope, request, "passed", "complete")) {
      return { status: "incomplete", summary: "The OS sandbox recipe ran, but no exact host-authenticated completion evidence was attached.", effectDisposition: "not_started" };
    }
    if (outcome.status === "incomplete" && outcome.data?.receiptEvidenceEnvelope !== undefined
      && !boundHostReceipt(outcome.data.receiptEvidenceEnvelope, request, "incomplete", "incomplete")) {
      return { status: "incomplete", summary: "The OS sandbox recipe returned malformed or cross-bound incomplete evidence.", effectDisposition: "not_started" };
    }
    return outcome;
  }
}

function boundHostReceipt(value: unknown, request: ExecutionRequest, outcome: "passed" | "incomplete", completeness: "complete" | "incomplete"): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema === "sxsy-b122.host-receipt-evidence"
    && record.version === 1
    && record.producer === "repository-runtime"
    && record.action === request.action
    && record.operationId === request.operationId
    && record.targetSnapshotId === request.target.id
    && record.policyVersion === request.target.policyVersion
    && record.outcome === outcome
    && record.completeness === completeness
    && typeof record.evidenceDigest === "string" && digestPattern.test(record.evidenceDigest)
    && typeof record.authenticationTag === "string" && digestPattern.test(record.authenticationTag);
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

function sortedRecord(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalString(value)).digest("hex");
}

function canonicalString(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalString).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalString(item)}`).join(",")}}`;
}
