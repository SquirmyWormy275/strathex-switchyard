import type { BrokerOutcome } from "../../../packages/control-plane/src/brokers.ts";
import type { GateEvidenceLedger } from "../../../packages/control-plane/src/acceptance-evidence.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { CouncilExecutor } from "../../../packages/control-plane/src/dispatch.ts";
import { CouncilCoordinator, type CouncilParticipant } from "../../../packages/control-plane/src/council.ts";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import type { DynamicConfiguredNetworkClient } from "./remote-adapters.ts";
import type { CouncilIsolationPlan, CouncilIsolationPrepareRequest, CouncilWorkspaceBinding } from "./council-workspace-isolation.ts";

type CouncilRequest = Parameters<CouncilExecutor["execute"]>[0];
type CouncilPhase = "pause" | "assignment" | "resume";

export interface CouncilWorkspaceIsolator {
  prepare(input: CouncilIsolationPrepareRequest): Promise<CouncilIsolationPlan>;
  assertCurrent(epochId: string): Promise<CouncilIsolationPlan>;
  cleanup(epochId: string): Promise<CouncilIsolationPlan>;
}

export interface CouncilAutomaticAcceptanceGate {
  /** Independent acceptance evidence is host-owned; the executor never self-accepts. */
  accepted(request: CouncilRequest): Promise<boolean>;
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
}

/** Durable multi-session Council with exact-route provider acknowledgements for every automatic phase. */
export class DurableConfiguredCouncilExecutor implements CouncilExecutor {
  private readonly council: CouncilCoordinator;
  private readonly sessions: SessionRegistry;
  private readonly network?: DynamicConfiguredNetworkClient;
  private readonly now: () => number;
  private readonly isolation?: CouncilWorkspaceIsolator;
  private readonly automaticGate?: CouncilAutomaticAcceptanceGate;
  constructor(council: CouncilCoordinator, sessions: SessionRegistry, network?: DynamicConfiguredNetworkClient, now: () => number = Date.now, options: DurableConfiguredCouncilOptions = {}) { this.council = council; this.sessions = sessions; this.network = network; this.now = now; this.isolation = options.isolation; this.automaticGate = options.automaticGate; }

  async execute(request: CouncilRequest): Promise<BrokerOutcome> {
    const participants = await this.participants(request);
    if (!participants.length) return { status: "unavailable", summary: "Council found no fresh Observable session bound to the exact TargetSnapshot.", effectDisposition: "not_started" };
    const report = await this.council.report({ repositoryRoot: request.target.repositoryRoot, targetSnapshotId: request.target.id, participants });
    if (request.action === "council_report") return reportOutcome(report, "Collected a durable Council report from every fresh exact-target Observable session.");
    if (request.action === "council_recommend") {
      try {
        const prepared = await this.council.prepareRecommendation({ repositoryRoot: request.target.repositoryRoot, targetSnapshotId: request.target.id, participants });
        const approved = await this.council.approveRecommendation(prepared.id, request.operationId);
        return { status: "completed", summary: "Durably prepared and approved one exact-target Council recommendation; no participant was resumed or mutated.", effectDisposition: "committed", data: { recommendationId: approved.id, recommendationDigest: approved.digest, status: approved.status, participants: approved.participantSessionIds.length, executionAuthorized: approved.executionAuthorized } };
      } catch (error) {
        return { status: "blocked", summary: untrustedSummary(error instanceof Error ? error.message : "Council recommendation could not be approved."), effectDisposition: "not_started" };
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
    try {
      for (const participant of participants) { await this.phase(request, epoch.id, participant, "pause"); await this.council.acknowledgePause(epoch.id, participant.id); }
      isolationPlan = await this.prepareIsolation(request, epoch.id, participants, defaultBranch);
      for (const participant of participants) {
        const binding = await this.currentBinding(epoch.id, participant.id, requiredBinding(isolationPlan, participant.id));
        await this.council.assign(epoch.id, participant.id, participant.plannedFiles, participant.resources, binding.assignmentDigest);
        await this.phase(request, epoch.id, participant, "assignment", binding);
        await this.council.acknowledgeAssignment(epoch.id, participant.id, binding.assignmentDigest);
      }
      await this.council.beginResume(epoch.id);
      for (const participant of participants) {
        const binding = requiredBinding(isolationPlan, participant.id);
        await this.phase(request, epoch.id, participant, "resume", binding);
        await this.council.acknowledgeResume(epoch.id, participant.id, binding.assignmentDigest);
      }
      const final = request.effectGuard ? await request.effectGuard.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) }) : { allowed: false, reason: "Council has no final activation guard." };
      if (!final.allowed) throw new Error(final.reason);
      isolationPlan = await this.isolation.assertCurrent(epoch.id);
      const active = await this.council.activate(epoch.id);
      return { status: "completed", summary: "All exact-target mediated participants acknowledged pause, disjoint host-isolated assignments, and resume through configured provider routes.", effectDisposition: "committed", data: { epochId: active.id, isolationDigest: isolationPlan.digest, participants: participants.length, status: active.status } };
    } catch (error) {
      await this.council.abort(epoch.id, error instanceof Error ? error.message : "A Council provider acknowledgement failed.").catch(() => undefined);
      if (isolationPlan) await this.isolation.cleanup(epoch.id).catch(() => undefined);
      return { status: "incomplete", summary: untrustedSummary(error instanceof Error ? error.message : "Automatic Council stopped without complete acknowledgements."), effectDisposition: "ambiguous", data: { epochId: epoch.id, status: "aborted" } };
    }
  }

  private async participants(request: CouncilRequest): Promise<readonly CouncilParticipant[]> {
    const durable = await this.sessions.list();
    const byId = new Map(durable.map((session) => [session.id, session]));
    if (request.session && !byId.has(request.session.id)) byId.set(request.session.id, request.session);
    const result: CouncilParticipant[] = [];
    for (const session of byId.values()) {
      if (session.targetSnapshotId !== request.target.id || !session.capabilities.includes("observable") || session.status === "stale" || session.status === "unreachable") continue;
      if (this.now() - Date.parse(session.lastHeartbeat) > 5 * 60_000) continue;
      result.push({
        id: session.id,
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

  private async phase(request: CouncilRequest, epochId: string, participant: CouncilParticipant, phase: CouncilPhase, binding?: CouncilWorkspaceBinding): Promise<void> {
    const session = await this.sessions.get(participant.id);
    if (!session || session.metadata["sxsy-b122.providerHandshake"] !== "exact-route-v1") throw new Error(`Council participant ${participant.id} lacks an exact-route provider handshake.`);
    if (request.executionControl && (Date.parse(request.executionControl.deadline) <= this.now() || await request.executionControl.isCancellationRequested())) throw new Error("Automatic Council was cancelled or exceeded its durable deadline.");
    const child = request.childSaga ? await request.childSaga.begin({ action: `council.${phase}`, idempotencyScope: `${epochId}:${participant.id}:${phase}`, details: { epochId, phase, sessionId: participant.id, target: request.target.id } }) : undefined;
    if (child && !child.mayExecute) throw new Error(`Council ${phase} for ${participant.id} requires reconciliation and was not replayed.`);
    if (child) await request.childSaga!.markExecuting(child);
    const control = operationSignal(request);
    try {
      if (phase !== "pause" && !binding) throw new Error(`Council ${phase} has no exact durable isolation binding for ${participant.id}.`);
      if (binding) binding = await this.currentBinding(epochId, participant.id, binding);
      const current = request.effectGuard ? await request.effectGuard.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, session, ...(request.authority ? { authority: request.authority } : {}) }) : { allowed: false, reason: "Council has no final effect guard." };
      if (!current.allowed) throw new Error(current.reason);
      if (binding) binding = await this.currentBinding(epochId, participant.id, binding);
      const response = await this.network!.request({ routeId: `provider.council.${session.provider}`, repositoryRoot: request.target.repositoryRoot, body: JSON.stringify({ schema: "sxsy-b122.council-phase", version: 1, epochId, phase, sessionId: session.id, targetSnapshotId: request.target.id, ...(phase === "assignment" ? { paths: participant.plannedFiles, resources: participant.resources } : {}), ...(binding ? { assignmentDigest: binding.assignmentDigest, worktreeRoot: binding.worktreeRoot, branch: binding.branch, head: binding.head, leases: binding.leases.map((lease) => ({ kind: lease.kind, resource: lease.resource, fence: lease.fence })), resourceHost: binding.resourceHost } : {}) }), signal: control.signal });
      if (binding) binding = await this.currentBinding(epochId, participant.id, binding);
      const acknowledgement = parseAcknowledgement(response.body, response.outcome, { epochId, phase, sessionId: session.id, targetSnapshotId: request.target.id, ...(binding ? { assignmentDigest: binding.assignmentDigest, resourceHostDigest: binding.resourceHost!.digest } : {}) });
      if (!acknowledgement) throw new Error(`Council ${phase} was not acknowledged by ${participant.id}.`);
      if (child) {
        const evidence = { acknowledged: "true", ...(binding ? { assignmentDigest: binding.assignmentDigest, resourceHostDigest: binding.resourceHost!.digest } : {}) };
        await request.childSaga!.markExternalCommitted(child, evidence);
        await request.childSaga!.settle(child, "completed", evidence);
      }
    } catch (error) {
      if (child) await request.childSaga!.settle(child, "ambiguous", { acknowledged: "unknown" }).catch(() => undefined);
      throw error;
    } finally { control.dispose(); }
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

  private async prepareIsolation(request: CouncilRequest, epochId: string, participants: readonly CouncilParticipant[], defaultBranch: string): Promise<CouncilIsolationPlan> {
    const child = request.childSaga ? await request.childSaga.begin({ action: "council.isolation", idempotencyScope: epochId, details: { epochId, targetSnapshotId: request.target.id, participantCount: String(participants.length) } }) : undefined;
    if (child && !child.mayExecute) throw new Error("Council isolation has prior external state and requires reconciliation without replay.");
    if (child) await request.childSaga!.markExecuting(child);
    let plan: CouncilIsolationPlan | undefined;
    try {
      plan = await this.isolation!.prepare({ epochId, targetSnapshotId: request.target.id, repositoryRoot: request.target.repositoryRoot, targetHead: request.target.head!, defaultBranch, assignments: participants.map((participant) => ({ sessionId: participant.id, paths: participant.plannedFiles, resources: participant.resources })) });
      if (plan.status !== "prepared" || plan.executionAuthorized !== false) throw new Error("Council isolation host did not return an exact non-authorizing prepared plan.");
      if (child) { await request.childSaga!.markExternalCommitted(child, { isolationDigest: plan.digest }); await request.childSaga!.settle(child, "completed", { isolationDigest: plan.digest }); }
      return plan;
    } catch (error) {
      if (plan) await this.isolation!.cleanup(epochId).catch(() => undefined);
      if (child) await request.childSaga!.settle(child, "ambiguous", { isolationState: "unknown" }).catch(() => undefined);
      throw error;
    }
  }
}

function reportOutcome(report: Awaited<ReturnType<CouncilCoordinator["report"]>>, summary: string): BrokerOutcome { return { status: "completed", summary, effectDisposition: "committed", data: { participants: report.participants.length, atomic: report.atomic, pathConflicts: report.pathConflicts.length, resourceConflicts: report.resourceConflicts.length, dependencyConflicts: report.dependencyConflicts.length } }; }
function declarations(session: ManagedSession, key: string): readonly string[] { const raw = session.metadata[key]; if (!raw) return []; try { const value: unknown = JSON.parse(raw); return Array.isArray(value) && value.length <= 128 && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 256 && !/[\r\n\0]/.test(item)) ? [...new Set(value)] : []; } catch { return []; } }
function trustedDiff(session: ManagedSession): string | undefined { const value = session.metadata["sxsy-b122.diffDigest"]; return value && /^[a-f0-9]{64}$/i.test(value) ? value : undefined; }
function parseAcknowledgement(body: Uint8Array | undefined, outcome: string, expected: Readonly<{ epochId: string; phase: CouncilPhase; sessionId: string; targetSnapshotId: string; assignmentDigest?: string; resourceHostDigest?: string }>): boolean { if (outcome !== "passed" || !body) return false; let value: unknown; try { value = JSON.parse(Buffer.from(body).toString("utf8")); } catch { return false; } const expectedKeys = expected.assignmentDigest ? 9 : 7; if (!record(value) || Object.keys(value).length !== expectedKeys || value.schema !== "sxsy-b122.council-ack" || value.version !== 1 || value.epochId !== expected.epochId || value.phase !== expected.phase || value.sessionId !== expected.sessionId || value.targetSnapshotId !== expected.targetSnapshotId || value.accepted !== true || (expected.assignmentDigest !== undefined && value.assignmentDigest !== expected.assignmentDigest) || (expected.resourceHostDigest !== undefined && value.resourceHostDigest !== expected.resourceHostDigest)) return false; return true; }
function operationSignal(request: CouncilRequest): { readonly signal: AbortSignal; dispose(): void } { const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let poll: ReturnType<typeof setInterval> | undefined; if (request.executionControl) { timer = setTimeout(() => controller.abort(), Math.max(0, Date.parse(request.executionControl.deadline) - Date.now())); poll = setInterval(() => { void request.executionControl!.isCancellationRequested().then((cancelled) => { if (cancelled) controller.abort(); }); }, 100); timer.unref?.(); poll.unref?.(); } return { signal: controller.signal, dispose() { if (timer) clearTimeout(timer); if (poll) clearInterval(poll); } }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requiredBinding(plan: CouncilIsolationPlan, sessionId: string): CouncilWorkspaceBinding { const binding = plan.bindings.find((candidate) => candidate.sessionId === sessionId); if (!binding) throw new Error(`Council isolation plan omitted participant ${sessionId}.`); if (!binding.resourceHost || !/^[a-f0-9]{64}$/.test(binding.resourceHost.digest)) throw new Error(`Council isolation plan omitted the exact resource-host binding for ${sessionId}.`); return binding; }
