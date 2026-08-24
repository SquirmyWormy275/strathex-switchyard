import type { AdapterOutcome, AdapterRequest, CommandAdapter } from "../../../packages/control-plane/src/adapters.ts";
import type { ProtectedReceipt } from "../../../packages/control-plane/src/contracts.ts";
import { untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import type { DynamicConfiguredNetworkClient } from "./remote-adapters.ts";

export interface PipelineReceiptReader { list(): Promise<readonly ProtectedReceipt[]>; }

/**
 * Keeps the live local observation and the exact-head hosted observation as
 * separate evidence. A hosted outage can never erase a local failure or turn
 * local success into a claim that CI passed.
 */
export class CompositePipelineStatusAdapter implements CommandAdapter {
  readonly id = "composite-pipeline-status-v1";
  readonly kind = "generic" as const;
  private readonly local: CommandAdapter;
  private readonly hosted: CommandAdapter;

  constructor(local: CommandAdapter, hosted: CommandAdapter) { this.local = local; this.hosted = hosted; }

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    if (request.definition.action !== "pipeline_status") return { status: "unavailable", summary: "The composite pipeline adapter handles status only.", effectDisposition: "not_started" };
    const local = await this.local.execute(request);
    if (["blocked", "cancelled", "timed_out"].includes(local.status)) return { ...local, data: { local: observationData(local), hosted: { status: "not_requested" }, completeness: "blocked_before_hosted" } };
    const hosted = await this.hosted.execute(request);
    const data = { local: observationData(local), hosted: observationData(hosted), completeness: local.status === "completed" && hosted.status === "completed" ? "local_and_hosted" : "partial" };
    if (local.status === "failed") return { status: "failed", summary: `Local pipeline inspection failed; hosted observation was ${hosted.status}.`, effectDisposition: combineDisposition(local, hosted), data };
    if (hosted.status !== "completed") return { status: "unavailable", summary: `Local status was ${local.status}; hosted exact-head status was ${hosted.status}. Local evidence is not hosted CI evidence.`, effectDisposition: combineDisposition(local, hosted), data };
    if (local.status !== "completed") return { status: "unavailable", summary: `Hosted exact-head status was observed, but local status was ${local.status}; the observations remain separate.`, effectDisposition: combineDisposition(local, hosted), data };
    return { status: "completed", summary: "Observed both live local repository status and exact-head hosted pipeline status as separate evidence.", effectDisposition: combineDisposition(local, hosted), data };
  }
}

interface PipelineContext {
  readonly kind: "check" | "status";
  readonly name: string;
  readonly state: string;
  readonly conclusion?: string;
  readonly url?: string;
  readonly summary?: string;
}

interface PipelineObservation {
  readonly oid: string;
  readonly state: string | null;
  readonly contexts: readonly PipelineContext[];
}

/** Exact-head GitHub CI observer. It has no mutation, rerun, or repair route. */
export class ConfiguredGitHubPipelineAdapter implements CommandAdapter {
  readonly id = "configured-github-pipeline-v1";
  readonly kind = "generic" as const;
  private readonly network: DynamicConfiguredNetworkClient;
  private readonly receipts: PipelineReceiptReader;

  constructor(network: DynamicConfiguredNetworkClient, receipts: PipelineReceiptReader) { this.network = network; this.receipts = receipts; }

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    if ((request.definition.action !== "pipeline_status" && request.definition.action !== "pipeline_failure_trace") || !request.operationId || !request.target?.head || !request.target.canonicalRemote) {
      return { status: "unavailable", summary: "Hosted pipeline inspection requires an exact durable operation, target HEAD, and canonical remote.", effectDisposition: "not_started" };
    }
    const repository = githubRepository(request.target.canonicalRemote);
    if (!repository) return { status: "blocked", summary: "Hosted pipeline inspection supports only the exact selected github.com repository.", effectDisposition: "not_started" };
    if (!request.effectGuard) return { status: "blocked", summary: "Hosted pipeline inspection requires a final target guard.", effectDisposition: "not_started" };
    if (request.executionControl && (Date.parse(request.executionControl.deadline) <= Date.now() || await request.executionControl.isCancellationRequested())) {
      return { status: Date.parse(request.executionControl.deadline) <= Date.now() ? "timed_out" : "cancelled", summary: "Hosted pipeline inspection stopped before its network effect.", effectDisposition: "not_started" };
    }
    const current = await request.effectGuard.assertCurrent({ action: request.definition.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
    if (!current.allowed) return { status: "blocked", summary: current.reason, effectDisposition: "not_started" };

    const control = abortControl(request);
    let response;
    try {
      response = await this.network.request({
        routeId: "github.graphql",
        repositoryRoot: request.target.repositoryRoot,
        signal: control.signal,
        body: JSON.stringify({
          query: "query B122Pipeline($owner:String!,$name:String!,$oid:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$oid){... on Commit{oid statusCheckRollup{state contexts(first:50){nodes{__typename ... on CheckRun{name status conclusion detailsUrl title summary text} ... on StatusContext{context state targetUrl description}}}}}}}}",
          variables: { owner: repository.owner, name: repository.name, oid: request.target.head }
        })
      });
    } finally { control.dispose(); }
    if (response.outcome !== "passed" || !response.body) return { status: response.outcome === "blocked" ? "blocked" : response.outcome === "unavailable" ? "unavailable" : "failed", summary: untrustedSummary(response.detail), effectDisposition: response.effectDisposition };
    let observation: PipelineObservation;
    try { observation = parseObservation(response.body, request.target.head); }
    catch { return { status: "failed", summary: "GitHub returned an invalid exact-head pipeline response; no state was inferred.", effectDisposition: "ambiguous" }; }

    const local = (await this.receipts.list())
      .filter((receipt) => receipt.targetSnapshotId === request.target!.id && ["pipeline_local_gate", "pipeline_clean_reproduction", "release_shield"].includes(receipt.action))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 8)
      .map((receipt) => ({ action: receipt.action, result: receipt.result, completeness: receipt.completeness, createdAt: receipt.createdAt, expired: !!receipt.expiresAt && Date.parse(receipt.expiresAt) <= Date.now(), invalidated: !!receipt.invalidatedBy }));
    if (request.definition.action === "pipeline_status") {
      const state = observation.state ?? "NONE";
      const failing = observation.contexts.filter(failedContext);
      return {
        status: "completed",
        summary: state === "NONE" ? `No hosted check rollup exists for exact head ${observation.oid}; ${local.length} protected local receipt(s) are available.` : `Exact head ${observation.oid} has hosted pipeline state ${state}, ${failing.length} failing context(s), and ${local.length} protected local receipt(s).`,
        effectDisposition: "committed",
        data: { head: observation.oid, hostedState: state, failingCount: failing.length, contexts: observation.contexts, localReceipts: local }
      };
    }
    const failures = observation.contexts.filter(failedContext);
    if (!failures.length) return { status: "unavailable", summary: "No failed hosted context exists on the exact target head; no failure was invented.", effectDisposition: "committed" };
    return {
      status: "completed",
      summary: `Read ${failures.length} failed exact-head context(s) without editing files: ${failures.map((item) => `${item.name}=${item.conclusion ?? item.state}`).join(", ").slice(0, 420)}`,
      effectDisposition: "committed",
      data: { head: observation.oid, failures }
    };
  }
}

function parseObservation(bytes: Uint8Array, expectedHead: string): PipelineObservation {
  const root: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!record(root) || Object.keys(root).length !== 1 || !record(root.data)) throw new Error("invalid envelope");
  const repository = requiredRecord(root.data, "repository");
  const object = requiredRecord(repository, "object");
  if (object.oid !== expectedHead || !/^[a-f0-9]{40}$/i.test(String(object.oid))) throw new Error("wrong head");
  const rollup = object.statusCheckRollup;
  if (rollup === null) return { oid: expectedHead, state: null, contexts: [] };
  if (!record(rollup) || !["SUCCESS", "FAILURE", "PENDING", "ERROR", "EXPECTED"].includes(String(rollup.state)) || !record(rollup.contexts) || !Array.isArray(rollup.contexts.nodes) || rollup.contexts.nodes.length > 50) throw new Error("invalid rollup");
  const contexts = rollup.contexts.nodes.map(parseContext);
  return { oid: expectedHead, state: String(rollup.state), contexts };
}

function parseContext(value: unknown): PipelineContext {
  if (!record(value)) throw new Error("invalid context");
  if (value.__typename === "CheckRun") {
    if (typeof value.name !== "string" || !bounded(value.name, 256) || !["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED", "COMPLETED"].includes(String(value.status))
      || (value.conclusion !== null && !["ACTION_REQUIRED", "CANCELLED", "FAILURE", "NEUTRAL", "SKIPPED", "STALE", "STARTUP_FAILURE", "SUCCESS", "TIMED_OUT"].includes(String(value.conclusion)))) throw new Error("invalid check run");
    return {
      kind: "check", name: value.name, state: String(value.status), ...(typeof value.conclusion === "string" ? { conclusion: value.conclusion } : {}),
      ...(safeUrl(value.detailsUrl) ? { url: value.detailsUrl as string } : {}),
      ...(boundedNullable(value.summary, 4_096) || boundedNullable(value.text, 4_096) || boundedNullable(value.title, 512) ? { summary: boundedSummary([value.title, value.summary, value.text]) } : {})
    };
  }
  if (value.__typename === "StatusContext") {
    if (typeof value.context !== "string" || !bounded(value.context, 256) || !["ERROR", "EXPECTED", "FAILURE", "PENDING", "SUCCESS"].includes(String(value.state))) throw new Error("invalid status context");
    return { kind: "status", name: value.context, state: String(value.state), ...(safeUrl(value.targetUrl) ? { url: value.targetUrl as string } : {}), ...(boundedNullable(value.description, 4_096) ? { summary: untrustedSummary(value.description as string) } : {}) };
  }
  throw new Error("unknown context type");
}

function failedContext(value: PipelineContext): boolean { return ["ERROR", "FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED", "STARTUP_FAILURE", "STALE"].includes(value.conclusion ?? value.state); }
function githubRepository(remote: string): { readonly owner: string; readonly name: string } | undefined { const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i.exec(remote.trim()); return match ? { owner: match[1]!, name: match[2]! } : undefined; }
function requiredRecord(value: Record<string, unknown>, key: string): Record<string, unknown> { const result = value[key]; if (!record(result)) throw new Error("missing record"); return result; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: string, maximum: number): boolean { return !!value.trim() && value.length <= maximum && !/[\r\n\0]/.test(value); }
function boundedNullable(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length <= maximum && !/\0/.test(value); }
function boundedSummary(values: readonly unknown[]): string { return untrustedSummary(values.filter((value): value is string => typeof value === "string" && !!value.trim()).join(" | ").slice(0, 4_096)); }
function safeUrl(value: unknown): value is string { try { if (typeof value !== "string" || value.length > 2_048) return false; const url = new URL(value); return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password; } catch { return false; } }
function abortControl(request: AdapterRequest): { readonly signal: AbortSignal; dispose(): void } { const controller = new AbortController(); const deadline = request.executionControl ? Date.parse(request.executionControl.deadline) : Date.now() + 30_000; const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now())); timer.unref?.(); return { signal: controller.signal, dispose() { clearTimeout(timer); } }; }
function observationData(outcome: AdapterOutcome): Readonly<Record<string, unknown>> { return { status: outcome.status, summary: outcome.summary, effectDisposition: outcome.effectDisposition ?? "ambiguous", data: outcome.data ?? {} }; }
function combineDisposition(left: AdapterOutcome, right: AdapterOutcome): NonNullable<AdapterOutcome["effectDisposition"]> {
  const values = [left.effectDisposition, right.effectDisposition];
  if (values.includes("ambiguous") || values.includes(undefined)) return "ambiguous";
  if (values.includes("committed")) return "committed";
  if (values.includes("compensated")) return "compensated";
  return "not_started";
}
