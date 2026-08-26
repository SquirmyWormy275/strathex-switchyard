import { createHash } from "node:crypto";

import type { AdapterOutcome, AdapterRequest, CommandAdapter } from "../../../packages/control-plane/src/adapters.ts";
import type { ProtectedReceipt } from "../../../packages/control-plane/src/contracts.ts";
import { createDurableAbortControl, type DurableAbortControl } from "../../../packages/control-plane/src/execution-cancellation.ts";
import { redactText, untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import type { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { DynamicConfiguredNetworkClient } from "./remote-adapters.ts";
import { configuredGitRepository, type ConfiguredGitHostIdentity } from "./remote-git.ts";

export interface PipelineGitHostResolver { resolve(repositoryRoot: string): Promise<ConfiguredGitHostIdentity>; }

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
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly runId?: string;
  readonly jobId?: string;
}

interface PipelineObservation {
  readonly oid: string;
  readonly state: string | null;
  readonly contexts: readonly PipelineContext[];
}

export interface PipelineFailureCursor { select(targetSnapshotId: string, orderedFailureFingerprints: readonly string[]): Promise<number>; }

export interface PipelineFailurePresentationQueue {
  enqueue(request: AdapterRequest, plan: Readonly<{ hostAction: "show_pipeline_failure_trace" }>): Promise<Readonly<{
    id: string;
    hostAction: "show_pipeline_failure_trace";
    expiresAt: string;
    workspaceRoot?: string;
  }>>;
}

/**
 * Couples exact-head failure evidence to the durable VS Code acknowledgement
 * boundary. Returning the evidence alone is not presentation: the installed
 * extension must receive, render, and settle this exact host action.
 */
export class PipelineFailurePresentationAdapter implements CommandAdapter {
  readonly id = "pipeline-failure-presentation-v1";
  readonly kind = "vscode" as const;
  constructor(private readonly evidence: CommandAdapter, private readonly queue: PipelineFailurePresentationQueue) {}

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    if (request.definition.action !== "pipeline_failure_trace") return { status: "unavailable", summary: "The failure presentation adapter handles only the exact Pipeline Alt action.", effectDisposition: "not_started" };
    const observed = await this.evidence.execute(request);
    if (observed.status !== "completed") return observed;
    if (!validFailurePresentation(observed.data, request.target?.head)) {
      return { status: "failed", summary: "The hosted pipeline adapter returned malformed exact-head failure evidence; no presentation was queued.", effectDisposition: observed.effectDisposition ?? "ambiguous" };
    }
    let intent;
    try { intent = await this.queue.enqueue(request, { hostAction: "show_pipeline_failure_trace" }); }
    catch { return { status: "failed", summary: "The exact failure evidence could not be durably queued for presentation.", effectDisposition: "ambiguous" }; }
    return {
      status: "running",
      summary: "The exact-head failure evidence is awaiting an authenticated VS Code presentation acknowledgement.",
      effectDisposition: observed.effectDisposition,
      data: {
        ...observed.data,
        hostActionId: intent.id,
        hostActionKind: intent.hostAction,
        hostActionExpiresAt: intent.expiresAt,
        ...(intent.workspaceRoot ? { hostActionWorkspaceRoot: intent.workspaceRoot } : {})
      }
    };
  }
}

interface PipelineFailureCursorEvent { readonly version: 1; readonly targetSnapshotId: string; readonly seriesDigest: string; readonly index: number; readonly selectedAt: string; }

/** Protected restart-durable repeat cursor. A changed failure set starts again at the first item. */
export class DurablePipelineFailureCursor implements PipelineFailureCursor {
  constructor(private readonly store: ProtectedJsonStore, private readonly now: () => Date = () => new Date()) {}
  async select(targetSnapshotId: string, orderedFailureFingerprints: readonly string[]): Promise<number> {
    if (!orderedFailureFingerprints.length || orderedFailureFingerprints.length > 50 || !targetSnapshotId || targetSnapshotId.length > 512) throw new Error("A bounded exact failure series is required.");
    const seriesDigest = digest(JSON.stringify(orderedFailureFingerprints));
    return this.store.transaction(async (transaction) => {
      const events = (await transaction.readEntries<PipelineFailureCursorEvent>()).filter((entry) => entry.kind === "pipeline_failure_cursor").map((entry) => entry.payload).filter(validCursorEvent);
      const prior = [...events].reverse().find((event) => event.targetSnapshotId === targetSnapshotId);
      const index = prior?.seriesDigest === seriesDigest ? (prior.index + 1) % orderedFailureFingerprints.length : 0;
      await transaction.append("pipeline_failure_cursor", { version: 1, targetSnapshotId, seriesDigest, index, selectedAt: this.now().toISOString() });
      return index;
    });
  }
}

class FirstPipelineFailureCursor implements PipelineFailureCursor { async select(): Promise<number> { return 0; } }

/** Exact-head GitHub CI observer. It has no mutation, rerun, or repair route. */
export class ConfiguredGitHubPipelineAdapter implements CommandAdapter {
  readonly id = "configured-github-pipeline-v1";
  readonly kind = "generic" as const;
  private readonly network: DynamicConfiguredNetworkClient;
  private readonly receipts: PipelineReceiptReader;
  private readonly hosts: PipelineGitHostResolver;
  private readonly cursor: PipelineFailureCursor;

  constructor(network: DynamicConfiguredNetworkClient, receipts: PipelineReceiptReader, hosts: PipelineGitHostResolver, cursor: PipelineFailureCursor = new FirstPipelineFailureCursor()) { this.network = network; this.receipts = receipts; this.hosts = hosts; this.cursor = cursor; }

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    if ((request.definition.action !== "pipeline_status" && request.definition.action !== "pipeline_failure_trace") || !request.operationId || !request.target?.head || !request.target.canonicalRemote) {
      return { status: "unavailable", summary: "Hosted pipeline inspection requires an exact durable operation, target HEAD, and canonical remote.", effectDisposition: "not_started" };
    }
    let host: ConfiguredGitHostIdentity;
    try { host = await this.hosts.resolve(request.target.repositoryRoot); exactHost(host.host); }
    catch { return { status: "unavailable", summary: "Hosted pipeline inspection requires one exact configured GitHub host.", effectDisposition: "not_started" }; }
    const repository = configuredGitRepository(request.target.canonicalRemote, host);
    if (!repository || repository.owner.toLowerCase() !== host.headOwner.toLowerCase() || repository.name.toLowerCase() !== host.headName.toLowerCase()) return { status: "blocked", summary: "Hosted pipeline inspection requires the canonical remote to match the exact configured GitHub head repository.", effectDisposition: "not_started" };
    if (!request.effectGuard) return { status: "blocked", summary: "Hosted pipeline inspection requires a final target guard.", effectDisposition: "not_started" };
    const current = await request.effectGuard.assertCurrent({ action: request.definition.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
    if (!current.allowed) return { status: "blocked", summary: current.reason, effectDisposition: "not_started" };

    const control = await createDurableAbortControl(request.executionControl, { fallbackDeadline: new Date(Date.now() + 30_000).toISOString() });
    const preflight = cancellationOutcome(control, "Hosted pipeline inspection stopped before its network effect.", "not_started");
    if (preflight) { control.dispose(); return preflight; }
    let response;
    try {
      response = await this.network.request({
        routeId: "github.graphql",
        repositoryRoot: request.target.repositoryRoot,
        signal: control.signal,
        body: JSON.stringify({
          query: "query B122Pipeline($owner:String!,$name:String!,$oid:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$oid){... on Commit{oid statusCheckRollup{state contexts(first:50){nodes{__typename ... on CheckRun{name status conclusion detailsUrl title summary text startedAt completedAt} ... on StatusContext{context state targetUrl description}}}}}}}}",
          variables: { owner: repository.owner, name: repository.name, oid: request.target.head }
        })
      });
    } finally { control.dispose(); }
    const interrupted = cancellationOutcome(control, "Hosted pipeline inspection stopped while its network effect was in flight.", response?.effectDisposition ?? "ambiguous");
    if (interrupted) return interrupted;
    if (response.outcome !== "passed" || !response.body) return { status: response.outcome === "blocked" ? "blocked" : response.outcome === "unavailable" ? "unavailable" : "failed", summary: untrustedSummary(response.detail), effectDisposition: response.effectDisposition };
    let observation: PipelineObservation;
    try { observation = parseObservation(response.body, request.target.head, host.host, repository.owner, repository.name); }
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
    let selectedIndex: number;
    try { selectedIndex = await this.cursor.select(request.target.id, failures.map(failureFingerprint)); }
    catch { return { status: "failed", summary: "The protected failure-trace cursor could not be advanced; no failure identity was guessed.", effectDisposition: "ambiguous" }; }
    const selected = failures[selectedIndex];
    if (!selected) return { status: "failed", summary: "The protected failure-trace cursor selected an invalid bounded identity.", effectDisposition: "ambiguous" };
    let logExcerpt = selected.summary ?? "The provider supplied no bounded check output for this failed context.";
    let logSource: "actions-job-log" | "check-output" = "check-output";
    if (selected.kind === "check" && selected.jobId) {
      const logGuard = await request.effectGuard.assertCurrent({ action: request.definition.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
      if (!logGuard.allowed) return { status: "blocked", summary: logGuard.reason, effectDisposition: "not_started" };
      const logControl = await createDurableAbortControl(request.executionControl, { fallbackDeadline: new Date(Date.now() + 30_000).toISOString() });
      const logPreflight = cancellationOutcome(logControl, "Hosted failure-log retrieval stopped before its network effect.", "not_started");
      if (logPreflight) { logControl.dispose(); return logPreflight; }
      let logResponse;
      try {
        logResponse = await this.network.request({ routeId: "github.actions-job-log", repositoryRoot: request.target.repositoryRoot, pathParameters: { jobId: selected.jobId }, signal: logControl.signal });
      } finally { logControl.dispose(); }
      const logInterrupted = cancellationOutcome(logControl, "Hosted failure-log retrieval stopped while its network effect was in flight.", logResponse?.effectDisposition ?? "ambiguous");
      if (logInterrupted) return logInterrupted;
      if (logResponse.outcome !== "passed" || !logResponse.body) {
        return { status: logResponse.outcome === "blocked" ? "blocked" : "unavailable", summary: `Selected exact-head Actions job ${selected.jobId} log is unavailable: ${untrustedSummary(logResponse.detail)}`, effectDisposition: logResponse.effectDisposition, data: { head: observation.oid, selectedIndex, failureCount: failures.length, repeatAvailable: failures.length > 1, selectedFailure: selected } };
      }
      try { logExcerpt = sanitizedHostedLog(logResponse.body); }
      catch { return { status: "failed", summary: "The selected Actions job returned an invalid or oversized text log; no excerpt was displayed.", effectDisposition: "ambiguous" }; }
      const afterLog = await request.effectGuard.assertCurrent({ action: request.definition.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
      if (!afterLog.allowed) return { status: "blocked", summary: "The exact target changed while the selected hosted log was being read; the downloaded output was discarded.", effectDisposition: "ambiguous" };
      logSource = "actions-job-log";
    }
    const diagnosis = diagnoseFailure(selected, logExcerpt);
    return {
      status: "completed",
      summary: `Failure ${selectedIndex + 1} of ${failures.length}: ${selected.name}=${selected.conclusion ?? selected.state}. ${diagnosis}`.slice(0, 512),
      effectDisposition: "committed",
      data: { head: observation.oid, selectedIndex, failureCount: failures.length, repeatAvailable: failures.length > 1, selectedFailure: selected, logExcerpt, logSource, diagnosis }
    };
  }
}

function parseObservation(bytes: Uint8Array, expectedHead: string, host: string, owner: string, name: string): PipelineObservation {
  const root: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!record(root) || Object.keys(root).length !== 1 || !record(root.data)) throw new Error("invalid envelope");
  const repository = requiredRecord(root.data, "repository");
  const object = requiredRecord(repository, "object");
  if (object.oid !== expectedHead || !/^[a-f0-9]{40}$/i.test(String(object.oid))) throw new Error("wrong head");
  const rollup = object.statusCheckRollup;
  if (rollup === null) return { oid: expectedHead, state: null, contexts: [] };
  if (!record(rollup) || !["SUCCESS", "FAILURE", "PENDING", "ERROR", "EXPECTED"].includes(String(rollup.state)) || !record(rollup.contexts) || !Array.isArray(rollup.contexts.nodes) || rollup.contexts.nodes.length > 50) throw new Error("invalid rollup");
  const contexts = rollup.contexts.nodes.map((value) => parseContext(value, host, owner, name));
  return { oid: expectedHead, state: String(rollup.state), contexts };
}

function parseContext(value: unknown, host: string, owner: string, name: string): PipelineContext {
  if (!record(value)) throw new Error("invalid context");
  if (value.__typename === "CheckRun") {
    if (typeof value.name !== "string" || !bounded(value.name, 256) || !["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED", "COMPLETED"].includes(String(value.status))
      || (value.conclusion !== null && !["ACTION_REQUIRED", "CANCELLED", "FAILURE", "NEUTRAL", "SKIPPED", "STALE", "STARTUP_FAILURE", "SUCCESS", "TIMED_OUT"].includes(String(value.conclusion)))) throw new Error("invalid check run");
    const runIdentity = typeof value.detailsUrl === "string" ? exactRunIdentity(value.detailsUrl, host, owner, name) : undefined;
    return {
      kind: "check", name: value.name, state: String(value.status), ...(typeof value.conclusion === "string" ? { conclusion: value.conclusion } : {}),
      ...(safeUrl(value.detailsUrl, host, owner, name) ? { url: exactRunUrl(value.detailsUrl as string, host, owner, name) ?? value.detailsUrl as string } : {}),
      ...(runIdentity ? { runId: runIdentity.runId, ...(runIdentity.jobId ? { jobId: runIdentity.jobId } : {}) } : {}),
      ...(boundedNullable(value.summary, 4_096) || boundedNullable(value.text, 4_096) || boundedNullable(value.title, 512) ? { summary: boundedSummary([value.title, value.summary, value.text]) } : {}),
      ...(validTimestamp(value.startedAt) ? { startedAt: value.startedAt } : {}), ...(validTimestamp(value.completedAt) ? { completedAt: value.completedAt } : {})
    };
  }
  if (value.__typename === "StatusContext") {
    if (typeof value.context !== "string" || !bounded(value.context, 256) || !["ERROR", "EXPECTED", "FAILURE", "PENDING", "SUCCESS"].includes(String(value.state))) throw new Error("invalid status context");
    return { kind: "status", name: value.context, state: String(value.state), ...(safeUrl(value.targetUrl, host, owner, name) ? { url: value.targetUrl as string } : {}), ...(boundedNullable(value.description, 4_096) ? { summary: untrustedSummary(value.description as string) } : {}) };
  }
  throw new Error("unknown context type");
}

function failedContext(value: PipelineContext): boolean { return ["ERROR", "FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED", "STARTUP_FAILURE", "STALE"].includes(value.conclusion ?? value.state); }
function requiredRecord(value: Record<string, unknown>, key: string): Record<string, unknown> { const result = value[key]; if (!record(result)) throw new Error("missing record"); return result; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: string, maximum: number): boolean { return !!value.trim() && value.length <= maximum && !/[\r\n\0]/.test(value); }
function boundedNullable(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length <= maximum && !/\0/.test(value); }
function boundedSummary(values: readonly unknown[]): string { return untrustedSummary(values.filter((value): value is string => typeof value === "string" && !!value.trim()).join(" | ").slice(0, 4_096)); }
function safeUrl(value: unknown, host: string, owner: string, name: string): value is string { try { if (typeof value !== "string" || value.length > 2_048) return false; const url = new URL(value); return url.protocol === "https:" && url.hostname.toLowerCase() === host && !url.username && !url.password && !url.hash && url.pathname.toLowerCase().startsWith(`/${owner}/${name}/`.toLowerCase()); } catch { return false; } }
function exactRunUrl(value: string, host: string, owner: string, name: string): string | undefined { try { const url = new URL(value); if (!safeUrl(value, host, owner, name) || url.search) return undefined; const prefix = `/${owner}/${name}/actions/runs/`; if (!url.pathname.toLowerCase().startsWith(prefix.toLowerCase())) return undefined; const match = /^(\d{1,20})(?:\/job\/\d{1,20})?\/?$/.exec(url.pathname.slice(prefix.length)); return match ? `https://${host}/${owner}/${name}/actions/runs/${match[1]}` : undefined; } catch { return undefined; } }
function exactRunIdentity(value: string, host: string, owner: string, name: string): Readonly<{ runId: string; jobId?: string }> | undefined { try { const url = new URL(value); if (!safeUrl(value, host, owner, name) || url.search) return undefined; const prefix = `/${owner}/${name}/actions/runs/`; if (!url.pathname.toLowerCase().startsWith(prefix.toLowerCase())) return undefined; const match = /^([1-9]\d{0,19})(?:\/job\/([1-9]\d{0,19}))?\/?$/.exec(url.pathname.slice(prefix.length)); return match ? { runId: match[1]!, ...(match[2] ? { jobId: match[2] } : {}) } : undefined; } catch { return undefined; } }
function validTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function failureFingerprint(value: PipelineContext): string { return digest(JSON.stringify({ kind: value.kind, name: value.name, state: value.state, conclusion: value.conclusion ?? null, url: value.url ?? null, runId: value.runId ?? null, jobId: value.jobId ?? null, summary: value.summary ?? null })); }
function sanitizedHostedLog(bytes: Uint8Array): string {
  if (bytes.byteLength < 1 || bytes.byteLength > 8 * 1024 * 1024) throw new Error("hosted log size is invalid");
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (decoded.includes("\0")) throw new Error("hosted log contains a null byte");
  const normalized = redactText(decoded.replaceAll("\r\n", "\n").replaceAll("\r", "\n")).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "�");
  const excerpt = normalized.slice(0, 64 * 1024);
  if (!excerpt.trim()) throw new Error("hosted log is empty");
  return excerpt;
}
function diagnoseFailure(value: PipelineContext, excerpt: string): string {
  const source = `${value.name} ${value.conclusion ?? value.state} ${excerpt}`.toLowerCase();
  if (/timed?\s*out|timeout|deadline/.test(source)) return "The hosted gate exhausted its time budget; reproduce the exact command with the declared local gate before considering a retry.";
  if (/assert|expected|received|test\s+fail|\bfail(?:ed|ure)?\b/.test(source)) return "The bounded output indicates a test assertion failure; inspect the named failing test and exact target diff without editing automatically.";
  if (/cannot find|module not found|dependency|lockfile|package/.test(source)) return "The bounded output indicates a dependency or lockfile resolution failure; reproduce from the pinned clean environment.";
  if (/lint|format|style|typecheck|type error/.test(source)) return "The bounded output indicates a static-analysis gate failure; run the repository-declared local gate against the exact head.";
  return "The provider confirms a failed exact-head context, but the bounded output is insufficient for a narrower diagnosis.";
}
function validCursorEvent(value: PipelineFailureCursorEvent): boolean { return value?.version === 1 && typeof value.targetSnapshotId === "string" && value.targetSnapshotId.length <= 512 && /^[a-f0-9]{64}$/.test(value.seriesDigest) && Number.isSafeInteger(value.index) && value.index >= 0 && validTimestamp(value.selectedAt); }
function validFailurePresentation(value: Readonly<Record<string, unknown>> | undefined, expectedHead: string | undefined): boolean {
  if (!value || !expectedHead || value.head !== expectedHead || typeof value.selectedIndex !== "number" || !Number.isSafeInteger(value.selectedIndex) || value.selectedIndex < 0
    || typeof value.failureCount !== "number" || !Number.isSafeInteger(value.failureCount) || value.failureCount < 1 || value.failureCount > 50 || value.selectedIndex >= value.failureCount
    || typeof value.repeatAvailable !== "boolean" || value.repeatAvailable !== (value.failureCount > 1)
    || !record(value.selectedFailure) || !["check", "status"].includes(String(value.selectedFailure.kind))
    || typeof value.selectedFailure.name !== "string" || !bounded(value.selectedFailure.name, 256)
    || typeof value.selectedFailure.state !== "string" || !bounded(value.selectedFailure.state, 64)
    || (value.selectedFailure.conclusion !== undefined && (typeof value.selectedFailure.conclusion !== "string" || !bounded(value.selectedFailure.conclusion, 64)))
    || typeof value.logExcerpt !== "string" || !value.logExcerpt.trim() || value.logExcerpt.length > 64 * 1024 || value.logExcerpt.includes("\0")
    || !["actions-job-log", "check-output"].includes(String(value.logSource))
    || typeof value.diagnosis !== "string" || !value.diagnosis.trim() || value.diagnosis.length > 512 || value.diagnosis.includes("\0")) return false;
  return true;
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function exactHost(value: string): string { const host = value.toLowerCase(); if (host.startsWith(".") || host.endsWith(".") || !host.includes(".") || host.split(".").some((label) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) throw new Error("invalid GitHub host"); return host; }
function cancellationOutcome(control: DurableAbortControl, summary: string, effectDisposition: NonNullable<AdapterOutcome["effectDisposition"]>): AdapterOutcome | undefined {
  const reason = control.reason();
  if (!reason) return undefined;
  return {
    status: reason === "deadline" ? "timed_out" : reason === "cancelled" ? "cancelled" : "unavailable",
    summary,
    effectDisposition
  };
}
function observationData(outcome: AdapterOutcome): Readonly<Record<string, unknown>> { return { status: outcome.status, summary: outcome.summary, effectDisposition: outcome.effectDisposition ?? "ambiguous", data: outcome.data ?? {} }; }
function combineDisposition(left: AdapterOutcome, right: AdapterOutcome): NonNullable<AdapterOutcome["effectDisposition"]> {
  const values = [left.effectDisposition, right.effectDisposition];
  if (values.includes("ambiguous") || values.includes(undefined)) return "ambiguous";
  if (values.includes("committed")) return "committed";
  if (values.includes("compensated")) return "compensated";
  return "not_started";
}
