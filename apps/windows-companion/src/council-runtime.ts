import { resolve } from "node:path";

import type { BrokerOutcome } from "../../../packages/control-plane/src/brokers.ts";
import type { GateEvidenceLedger } from "../../../packages/control-plane/src/acceptance-evidence.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { CouncilExecutor } from "../../../packages/control-plane/src/dispatch.ts";
import { CouncilCoordinator, type CouncilEpoch, type CouncilParticipant, type CouncilRecommendation, type CouncilReportArtifact } from "../../../packages/control-plane/src/council.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import type { ProviderCommandTransport } from "./remote-adapters.ts";
import type { CouncilIsolationEffectControl, CouncilIsolationPlan, CouncilIsolationPrepareRequest, CouncilWorkspaceBinding } from "./council-workspace-isolation.ts";
import { createDurableAbortControl, type DurableAbortControl } from "./execution-cancellation.ts";

type CouncilRequest = Parameters<CouncilExecutor["execute"]>[0];
type CouncilPhase = "pause" | "assignment" | "resume";

export interface CouncilWorkspaceIsolator {
  prepare(input: CouncilIsolationPrepareRequest, control?: CouncilIsolationEffectControl): Promise<CouncilIsolationPlan>;
  assertCurrent(epochId: string): Promise<CouncilIsolationPlan>;
  cleanup(epochId: string): Promise<CouncilIsolationPlan>;
  cleanupOwned(epochId: string, expectedRepositoryRoot: string): Promise<CouncilIsolationPlan | undefined>;
}

export interface CouncilAutomaticAcceptanceGate {
  /** Independent acceptance evidence is host-owned; the executor never self-accepts. */
  accepted(request: CouncilRequest): Promise<boolean>;
}

export interface CouncilAssignmentResourceVerifier {
  /** Proves every assigned host resource is usable without changing the plan. */
  assertPlanOperational(plan: CouncilIsolationPlan): Promise<void>;
}

/** Reads only independently attested, current-target evidence from the protected gate ledger. */
export class LedgerCouncilAutomaticAcceptanceGate implements CouncilAutomaticAcceptanceGate {
  constructor(private readonly evidence: GateEvidenceLedger) {}
  async accepted(request: CouncilRequest): Promise<boolean> {
    for (const gate of commandForAction("council_automatic").acceptanceGates) {
      if ((await this.evidence.statusFor(gate, request.target.id)).status !== "passed") return false;
    }
    return true;
  }
}

export interface DurableConfiguredCouncilOptions {
  readonly isolation?: CouncilWorkspaceIsolator;
  readonly automaticGate?: CouncilAutomaticAcceptanceGate;
  readonly resources?: CouncilAssignmentResourceVerifier;
}

/** Durable multi-session Council with exact-route provider acknowledgements for every automatic phase. */
export class DurableConfiguredCouncilExecutor implements CouncilExecutor {
  private readonly council: CouncilCoordinator;
  private readonly sessions: SessionRegistry;
  private readonly network?: ProviderCommandTransport;
  private readonly now: () => number;
  private readonly isolation?: CouncilWorkspaceIsolator;
  private readonly automaticGate?: CouncilAutomaticAcceptanceGate;
  private readonly resources?: CouncilAssignmentResourceVerifier;
  private readonly activeExecutions = new Map<string, Set<ActiveCouncilExecution>>();
  constructor(council: CouncilCoordinator, sessions: SessionRegistry, network?: ProviderCommandTransport, now: () => number = Date.now, options: DurableConfiguredCouncilOptions = {}) { this.council = council; this.sessions = sessions; this.network = network; this.now = now; this.isolation = options.isolation; this.automaticGate = options.automaticGate; this.resources = options.resources; }

  async execute(request: CouncilRequest): Promise<BrokerOutcome> {
    const participants = await this.participants(request);
    if (!participants.length) return { status: "unavailable", summary: "Council found no fresh Observable session bound to the exact TargetSnapshot.", effectDisposition: "not_started" };
    if (request.action === "council_report") {
      try {
        const report = await this.council.createReport({ repositoryRoot: request.target.repositoryRoot, targetSnapshotId: request.target.id, participants });
        return reportOutcome(report, "Collected a durable Council report from every fresh exact-target Observable session.");
      } catch (error) {
        return { status: "blocked", summary: untrustedSummary(error instanceof Error ? error.message : "Council report detail could not be bounded and persisted."), effectDisposition: "not_started" };
      }
    }
    if (request.action === "council_recommend") {
      try {
        const prepared = await this.council.prepareRecommendation({ repositoryRoot: request.target.repositoryRoot, targetSnapshotId: request.target.id, participants }, request.operationId);
        return { status: "completed", summary: "Durably prepared one exact-target Council recommendation for a separate exact-digest operator review; no participant was resumed or mutated.", effectDisposition: "committed", data: recommendationOutcome(prepared) };
      } catch (error) {
        return { status: "blocked", summary: untrustedSummary(error instanceof Error ? error.message : "Council recommendation could not be prepared."), effectDisposition: "not_started" };
      }
    }
    if (!this.network) return { status: "unavailable", summary: "Automatic Council requires configured exact-route provider adapters.", effectDisposition: "not_started" };
    if (!this.automaticGate || !await this.automaticGate.accepted(request)) return { status: "unavailable", summary: "Automatic Council is gate-disabled until independent worktree, resource-isolation, mediation, and failure-injection acceptance evidence is installed.", effectDisposition: "not_started" };
    if (!this.isolation) return { status: "unavailable", summary: "Automatic Council requires the installed durable worktree and resource-isolation host.", effectDisposition: "not_started" };
    if (participants.length < 2) return { status: "blocked", summary: "Automatic Council requires at least two fresh mediated participants on the exact target.", effectDisposition: "not_started" };
    if (!participants.every((participant) => participant.capabilities.includes("mediated") && participant.capabilities.includes("controllable") && participant.status === "running")) return { status: "blocked", summary: "Automatic Council requires every participant to be fresh, running, Controllable, and Mediated.", effectDisposition: "not_started" };
    if (!request.target.head) return { status: "blocked", summary: "Automatic Council requires an exact Git HEAD in the verified TargetSnapshot.", effectDisposition: "not_started" };
    const defaultBranch = await this.exactDefaultBranch(request.target.defaultBranch, participants);
    if (!defaultBranch) return { status: "blocked", summary: "Automatic Council requires one exact host-observed default branch identity consistent with every participant claim.", effectDisposition: "not_started" };
    let epoch;
    try { epoch = await this.council.beginAutomatic({ repositoryRoot: request.target.repositoryRoot, targetSnapshotId: request.target.id, participants }); }
    catch (error) { return { status: "blocked", summary: untrustedSummary(error instanceof Error ? error.message : "Council automatic preconditions failed."), effectDisposition: "not_started" }; }
    let isolationPlan: CouncilIsolationPlan | undefined;
    let isolationAttempted = false;
    let externalEffectMayHaveCommitted = false;
    let durableControl: DurableAbortControl | undefined;
    let activeExecution: ActiveCouncilExecution | undefined;
    try {
      activeExecution = this.beginActiveExecution(request.target.repositoryRoot, epoch.id);
      durableControl = await operationSignal(request);
      const control = combinedControl(durableControl, activeExecution.controller.signal);
      await this.assertEffectCurrent(request, control);
      for (const participant of participants) {
        await this.phase(request, control, epoch.id, participant, "pause");
        externalEffectMayHaveCommitted = true;
        await this.council.acknowledgePause(epoch.id, participant.id);
      }
      isolationAttempted = true;
      isolationPlan = await this.prepareIsolation(request, control, epoch.id, participants, defaultBranch);
      externalEffectMayHaveCommitted = true;
      for (const participant of participants) {
        const binding = await this.currentBinding(epoch.id, participant.id, requiredBinding(isolationPlan, participant.id));
        await this.council.assign(epoch.id, participant.id, participant.plannedFiles, participant.resources, binding.assignmentDigest, binding.resourceHost!.digest);
        await this.phase(request, control, epoch.id, participant, "assignment", binding);
        externalEffectMayHaveCommitted = true;
        await this.council.acknowledgeAssignment(epoch.id, participant.id, binding.assignmentDigest);
      }
      if (!this.resources) throw new Error("Automatic Council requires the installed host resource broker before any participant may resume.");
      isolationPlan = await this.isolation.assertCurrent(epoch.id);
      await this.assertEffectCurrent(request, control);
      await this.resources.assertPlanOperational(isolationPlan);
      await this.assertEffectCurrent(request, control);
      isolationPlan = await this.isolation.assertCurrent(epoch.id);
      await this.council.beginResume(epoch.id);
      for (const participant of participants) {
        const binding = requiredBinding(isolationPlan, participant.id);
        await this.phase(request, control, epoch.id, participant, "resume", binding);
        externalEffectMayHaveCommitted = true;
        await this.council.acknowledgeResume(epoch.id, participant.id, binding.assignmentDigest);
      }
      await this.assertEffectCurrent(request, control);
      isolationPlan = await this.isolation.assertCurrent(epoch.id);
      await this.resources.assertPlanOperational(isolationPlan);
      await this.assertEffectCurrent(request, control);
      isolationPlan = await this.isolation.assertCurrent(epoch.id);
      const active = await this.council.activate(epoch.id);
      await this.assertEffectCurrent(request, control);
      return { status: "completed", summary: "All exact-target mediated participants acknowledged pause, disjoint host-isolated assignments, and resume through configured provider routes.", effectDisposition: "committed", data: { epochId: active.id, isolationDigest: isolationPlan.digest, participants: participants.length, status: active.status } };
    } catch (error) {
      externalEffectMayHaveCommitted ||= error instanceof CouncilEffectBoundaryError && error.effectMayHaveCommitted;
      const aborted = await this.council.abort(
        epoch.id,
        error instanceof Error ? error.message : "A Council provider acknowledgement failed.",
        { cleanupRequired: isolationAttempted }
      ).catch(() => undefined);
      if (isolationAttempted) await this.isolation.cleanupOwned(epoch.id, request.target.repositoryRoot).catch(() => undefined);
      return { status: "incomplete", summary: untrustedSummary(error instanceof Error ? error.message : "Automatic Council stopped without complete acknowledgements."), effectDisposition: externalEffectMayHaveCommitted ? "ambiguous" : "not_started", data: { epochId: epoch.id, status: aborted?.status ?? "abort_pending" } };
    } finally {
      durableControl?.dispose();
      activeExecution?.finish();
    }
  }

  /** Separate read-review acknowledgement; it never dispatches or grants execution. */
  async approveRecommendation(input: Readonly<{
    recommendationId: string;
    recommendationDigest: string;
    approvalOperationId: string;
    target: TargetSnapshot;
    session?: ManagedSession;
  }>): Promise<CouncilRecommendation> {
    const participants = await this.participants({
      action: "council_recommend",
      operationId: input.approvalOperationId,
      target: input.target,
      ...(input.session ? { session: input.session } : {}),
      permit: {} as CouncilRequest["permit"]
    });
    if (!participants.length) throw new Error("Council recommendation approval found no fresh exact-target Observable participant.");
    return this.council.approveRecommendation({
      recommendationId: input.recommendationId,
      recommendationDigest: input.recommendationDigest,
      approvalOperationId: input.approvalOperationId,
      repositoryRoot: input.target.repositoryRoot,
      targetSnapshotId: input.target.id,
      participants
    });
  }

  /** Aborts and joins only live transports for one repository, then fences its durable epochs for cleanup. */
  async cancelRepository(repositoryRoot: string, reason: string): Promise<readonly CouncilEpoch[]> {
    const key = repositoryKey(repositoryRoot);
    const active = [...(this.activeExecutions.get(key) ?? [])];
    for (const execution of active) execution.controller.abort();
    await Promise.allSettled(active.map((execution) => execution.done));
    const cancelled = new Map<string, CouncilEpoch>();
    for (const execution of active) {
      const epoch = await this.council.get(execution.epochId);
      if (epoch) cancelled.set(epoch.id, epoch);
    }
    for (const epoch of await this.council.listOngoing()) {
      if (repositoryKey(epoch.repositoryRoot) !== key) continue;
      let current = await this.council.abort(epoch.id, reason, { cleanupRequired: true });
      const local = this.isolation
        ? await this.isolation.cleanupOwned(epoch.id, epoch.repositoryRoot).then(() => true, () => false)
        : false;
      const remote = Object.values(current.assignments).some((assignment) => assignment.resourceHostDigest !== undefined);
      if (current.status === "abort_pending" && local && !remote) current = await this.council.settleAbort(current.id);
      cancelled.set(current.id, current);
    }
    return [...cancelled.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  private async participants(request: CouncilRequest): Promise<readonly CouncilParticipant[]> {
    const durable = await this.sessions.list();
    const byId = new Map(durable.map((session) => [session.id, session]));
    if (request.session && !byId.has(request.session.id)) byId.set(request.session.id, request.session);
    const result: CouncilParticipant[] = [];
    for (const session of byId.values()) {
      if (session.targetSnapshotId !== request.target.id || !session.workspaceRoot || repositoryKey(session.workspaceRoot) !== repositoryKey(request.target.repositoryRoot)
        || !session.capabilities.includes("observable") || session.status === "stale" || session.status === "unreachable") continue;
      if (this.now() - Date.parse(session.lastHeartbeat) > 5 * 60_000) continue;
      result.push({
        id: session.id,
        provider: session.provider,
        targetSnapshotId: request.target.id,
        status: session.status,
        capabilities: session.capabilities,
        lastHeartbeat: session.lastHeartbeat,
        plannedFiles: session.plannedFiles,
        resources: declarations(session, "sxsy-b122.resources"),
        dependencies: declarations(session, "sxsy-b122.dependencies"),
        diffDigest: trustedDiff(session) ?? `${request.target.trackedManifest}:${request.target.untrackedManifest}`
      });
    }
    return result.sort((left, right) => left.id.localeCompare(right.id));
  }

  private async phase(request: CouncilRequest, control: DurableAbortControl, epochId: string, participant: CouncilParticipant, phase: CouncilPhase, binding?: CouncilWorkspaceBinding): Promise<void> {
    const session = await this.sessions.get(participant.id);
    if (!session || session.metadata["sxsy-b122.providerHandshake"] !== "exact-route-v1") throw new Error(`Council participant ${participant.id} lacks an exact-route provider handshake.`);
    const child = request.childSaga ? await request.childSaga.begin({ action: `council.${phase}`, idempotencyScope: `${epochId}:${participant.id}:${phase}`, details: { epochId, phase, sessionId: participant.id, target: request.target.id } }) : undefined;
    if (child && !child.mayExecute) throw new Error(`Council ${phase} for ${participant.id} requires reconciliation and was not replayed.`);
    if (child) await request.childSaga!.markExecuting(child);
    let effectMayHaveCommitted = false;
    try {
      if (phase !== "pause" && !binding) throw new Error(`Council ${phase} has no exact durable isolation binding for ${participant.id}.`);
      if (binding) binding = await this.currentBinding(epochId, participant.id, binding);
      await this.assertEffectCurrent(request, control, session);
      if (binding) binding = await this.currentBinding(epochId, participant.id, binding);
      effectMayHaveCommitted = true;
      const response = await this.network!.request({ routeId: `provider.council.${session.provider}`, repositoryRoot: request.target.repositoryRoot, body: JSON.stringify({ schema: "sxsy-b122.council-phase", version: 1, epochId, phase, sessionId: session.id, targetSnapshotId: request.target.id, repositoryRoot: request.target.repositoryRoot, ...(phase === "assignment" ? { paths: participant.plannedFiles, resources: participant.resources } : {}), ...(binding ? { assignmentDigest: binding.assignmentDigest, worktreeRoot: binding.worktreeRoot, branch: binding.branch, head: binding.head, leases: binding.leases.map((lease) => ({ kind: lease.kind, resource: lease.resource, fence: lease.fence })), resourceHost: binding.resourceHost } : {}) }), signal: control.signal });
      if (child) await request.childSaga!.markExternalCommitted(child, { responseReceived: "true" });
      await this.assertEffectCurrent(request, control, session);
      if (binding) binding = await this.currentBinding(epochId, participant.id, binding);
      const acknowledgement = parseAcknowledgement(response.body, response.outcome, { epochId, phase, sessionId: session.id, targetSnapshotId: request.target.id, ...(binding ? { assignmentDigest: binding.assignmentDigest, resourceHostDigest: binding.resourceHost!.digest } : {}) });
      if (!acknowledgement) throw new Error(`Council ${phase} was not acknowledged by ${participant.id}.`);
      if (child) {
        const evidence = { acknowledged: "true", ...(binding ? { assignmentDigest: binding.assignmentDigest, resourceHostDigest: binding.resourceHost!.digest } : {}) };
        await request.childSaga!.settle(child, "completed", evidence);
      }
    } catch (error) {
      if (child) await request.childSaga!.settle(child, effectMayHaveCommitted ? "ambiguous" : control.signal.aborted ? "cancelled" : "failed", { acknowledged: effectMayHaveCommitted ? "unknown" : "false" }).catch(() => undefined);
      throw new CouncilEffectBoundaryError(error, effectMayHaveCommitted);
    }
  }

  private async currentBinding(epochId: string, sessionId: string, expected: CouncilWorkspaceBinding): Promise<CouncilWorkspaceBinding> {
    const refreshed = requiredBinding(await this.isolation!.assertCurrent(epochId), sessionId);
    if (!expected.resourceHost || !refreshed.resourceHost || refreshed.assignmentDigest !== expected.assignmentDigest || refreshed.resourceHost.digest !== expected.resourceHost.digest) {
      throw new Error(`Council isolation binding changed before the provider effect for ${sessionId}.`);
    }
    return refreshed;
  }

  private async exactDefaultBranch(observed: string | undefined, participants: readonly CouncilParticipant[]): Promise<string | undefined> {
    const branch = observed?.trim().replace(/^refs\/heads\//, "");
    if (!branch || branch.length > 240 || branch.startsWith("-") || branch.endsWith("/") || branch.includes("..") || branch.includes("@{") || /[\s~^:?*\\\[]/.test(branch)) return undefined;
    for (const participant of participants) {
      const session = await this.sessions.get(participant.id);
      const claimed = session?.metadata["sxsy-b122.defaultBranch"]?.trim().replace(/^refs\/heads\//, "");
      if (claimed !== undefined && claimed !== branch) return undefined;
    }
    return branch;
  }

  private async prepareIsolation(request: CouncilRequest, control: DurableAbortControl, epochId: string, participants: readonly CouncilParticipant[], defaultBranch: string): Promise<CouncilIsolationPlan> {
    const child = request.childSaga ? await request.childSaga.begin({ action: "council.isolation", idempotencyScope: epochId, details: { epochId, targetSnapshotId: request.target.id, participantCount: String(participants.length) } }) : undefined;
    if (child && !child.mayExecute) throw new Error("Council isolation has prior external state and requires reconciliation without replay.");
    if (child) await request.childSaga!.markExecuting(child);
    let plan: CouncilIsolationPlan | undefined;
    let effectMayHaveCommitted = false;
    try {
      await this.assertEffectCurrent(request, control);
      plan = await this.isolation!.prepare(
        { epochId, targetSnapshotId: request.target.id, repositoryRoot: request.target.repositoryRoot, targetHead: request.target.head!, defaultBranch, assignments: participants.map((participant) => ({ sessionId: participant.id, paths: participant.plannedFiles, resources: participant.resources })) },
        {
          signal: control.signal,
          assertCurrent: () => this.assertEffectCurrent(request, control),
          markExternalEffect: () => { effectMayHaveCommitted = true; }
        }
      );
      effectMayHaveCommitted = true;
      if (child) await request.childSaga!.markExternalCommitted(child, { isolationDigest: plan.digest });
      await this.assertEffectCurrent(request, control);
      if (plan.status !== "prepared" || plan.executionAuthorized !== false) throw new Error("Council isolation host did not return an exact non-authorizing prepared plan.");
      if (child) await request.childSaga!.settle(child, "completed", { isolationDigest: plan.digest });
      return plan;
    } catch (error) {
      if (effectMayHaveCommitted) await this.isolation!.cleanupOwned(epochId, request.target.repositoryRoot).catch(() => undefined);
      if (child) await request.childSaga!.settle(child, effectMayHaveCommitted ? "ambiguous" : control.signal.aborted ? "cancelled" : "failed", { isolationState: effectMayHaveCommitted ? "unknown" : "not_started" }).catch(() => undefined);
      throw new CouncilEffectBoundaryError(error, effectMayHaveCommitted);
    }
  }

  private async assertEffectCurrent(request: CouncilRequest, control: DurableAbortControl, session?: ManagedSession): Promise<void> {
    if (control.signal.aborted) throw cancellationError(control);
    const current = request.effectGuard
      ? await request.effectGuard.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(session ? { session } : request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) })
      : { allowed: false, reason: "Council has no final effect guard." };
    if (!current.allowed) throw new Error(current.reason);
    if (control.signal.aborted) throw cancellationError(control);
  }

  private beginActiveExecution(repositoryRoot: string, epochId: string): ActiveCouncilExecution {
    const key = repositoryKey(repositoryRoot);
    const controller = new AbortController();
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const execution: ActiveCouncilExecution = {
      controller,
      done,
      epochId,
      finish: () => {
        const current = this.activeExecutions.get(key);
        current?.delete(execution);
        if (current?.size === 0) this.activeExecutions.delete(key);
        resolveDone();
      }
    };
    const current = this.activeExecutions.get(key) ?? new Set<ActiveCouncilExecution>();
    current.add(execution);
    this.activeExecutions.set(key, current);
    return execution;
  }
}

function reportOutcome(report: CouncilReportArtifact, summary: string): BrokerOutcome {
  return {
    status: "completed",
    summary,
    effectDisposition: "committed",
    data: {
      reportId: report.id,
      reportDigest: report.digest,
      repositoryRoot: report.repositoryRoot,
      targetSnapshotId: report.targetSnapshotId,
      collectedAt: report.collectedAt,
      participants: report.participants.length,
      participantDetails: report.participants,
      atomic: report.atomic,
      pathConflicts: report.pathConflicts,
      resourceConflicts: report.resourceConflicts,
      dependencyConflicts: report.dependencyConflicts,
      executionAuthorized: false
    }
  };
}
function recommendationOutcome(value: CouncilRecommendation): Readonly<Record<string, unknown>> {
  return {
    recommendationId: value.id,
    recommendationDigest: value.digest,
    reportId: value.reportId,
    reportDigest: value.reportDigest,
    repositoryRoot: value.repositoryRoot,
    targetSnapshotId: value.targetSnapshotId,
    participantSessionIds: value.participantSessionIds,
    assignments: value.assignments,
    ready: value.ready,
    status: value.status,
    createdAt: value.createdAt,
    executionAuthorized: false
  };
}
function declarations(session: ManagedSession, key: string): readonly string[] { const raw = session.metadata[key]; if (!raw) return []; try { const value: unknown = JSON.parse(raw); return Array.isArray(value) && value.length <= 128 && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 256 && !/[\r\n\0]/.test(item)) ? [...new Set(value)] : []; } catch { return []; } }
function trustedDiff(session: ManagedSession): string | undefined { const value = session.metadata["sxsy-b122.diffDigest"]; return value && /^[a-f0-9]{64}$/i.test(value) ? value : undefined; }
function parseAcknowledgement(body: Uint8Array | undefined, outcome: string, expected: Readonly<{ epochId: string; phase: CouncilPhase; sessionId: string; targetSnapshotId: string; assignmentDigest?: string; resourceHostDigest?: string }>): boolean { if (outcome !== "passed" || !body) return false; let value: unknown; try { value = JSON.parse(Buffer.from(body).toString("utf8")); } catch { return false; } const expectedKeys = expected.assignmentDigest ? 9 : 7; if (!record(value) || Object.keys(value).length !== expectedKeys || value.schema !== "sxsy-b122.council-ack" || value.version !== 1 || value.epochId !== expected.epochId || value.phase !== expected.phase || value.sessionId !== expected.sessionId || value.targetSnapshotId !== expected.targetSnapshotId || value.accepted !== true || (expected.assignmentDigest !== undefined && value.assignmentDigest !== expected.assignmentDigest) || (expected.resourceHostDigest !== undefined && value.resourceHostDigest !== expected.resourceHostDigest)) return false; return true; }
async function operationSignal(request: CouncilRequest): Promise<DurableAbortControl> { return createDurableAbortControl(request.executionControl); }
interface ActiveCouncilExecution { readonly controller: AbortController; readonly done: Promise<void>; readonly epochId: string; finish(): void; }
class CouncilEffectBoundaryError extends Error {
  readonly effectMayHaveCommitted: boolean;
  constructor(cause: unknown, effectMayHaveCommitted: boolean) {
    super(cause instanceof Error ? cause.message : "Council effect boundary failed.", { cause });
    this.name = "CouncilEffectBoundaryError";
    this.effectMayHaveCommitted = effectMayHaveCommitted;
  }
}
function cancellationError(control: DurableAbortControl): Error { return new Error(control.reason() === "unavailable" ? "Automatic Council could not verify durable cancellation state." : "Automatic Council was cancelled or exceeded its durable deadline."); }
function combinedControl(durable: DurableAbortControl, repositorySignal: AbortSignal): DurableAbortControl {
  const signal = AbortSignal.any([durable.signal, repositorySignal]);
  return { signal, reason: () => durable.reason() ?? (repositorySignal.aborted ? "cancelled" : undefined), dispose() {} };
}
function repositoryKey(value: string): string { return resolve(value.trim()).replace(/[\\/]+$/, "").toLowerCase(); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requiredBinding(plan: CouncilIsolationPlan, sessionId: string): CouncilWorkspaceBinding { const binding = plan.bindings.find((candidate) => candidate.sessionId === sessionId); if (!binding) throw new Error(`Council isolation plan omitted participant ${sessionId}.`); if (!binding.resourceHost || !/^[a-f0-9]{64}$/.test(binding.resourceHost.digest)) throw new Error(`Council isolation plan omitted the exact resource-host binding for ${sessionId}.`); return binding; }
