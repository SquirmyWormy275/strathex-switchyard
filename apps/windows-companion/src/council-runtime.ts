import type { BrokerOutcome } from "../../../packages/control-plane/src/brokers.ts";
import type { CouncilExecutor } from "../../../packages/control-plane/src/dispatch.ts";
import { CouncilCoordinator, type CouncilParticipant } from "../../../packages/control-plane/src/council.ts";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import type { DynamicConfiguredNetworkClient } from "./remote-adapters.ts";

type CouncilRequest = Parameters<CouncilExecutor["execute"]>[0];
type CouncilPhase = "pause" | "assignment" | "resume";

/** Durable multi-session Council with exact-route provider acknowledgements for every automatic phase. */
export class DurableConfiguredCouncilExecutor implements CouncilExecutor {
  private readonly council: CouncilCoordinator;
  private readonly sessions: SessionRegistry;
  private readonly network?: DynamicConfiguredNetworkClient;
  private readonly now: () => number;
  constructor(council: CouncilCoordinator, sessions: SessionRegistry, network?: DynamicConfiguredNetworkClient, now: () => number = Date.now) { this.council = council; this.sessions = sessions; this.network = network; this.now = now; }

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
    if (participants.length < 2) return { status: "blocked", summary: "Automatic Council requires at least two fresh mediated participants on the exact target.", effectDisposition: "not_started" };
    if (!participants.every((participant) => participant.capabilities.includes("mediated") && participant.capabilities.includes("controllable") && participant.status === "running")) return { status: "blocked", summary: "Automatic Council requires every participant to be fresh, running, Controllable, and Mediated.", effectDisposition: "not_started" };
    let epoch;
    try { epoch = await this.council.beginAutomatic({ repositoryRoot: request.target.repositoryRoot, targetSnapshotId: request.target.id, participants }); }
    catch (error) { return { status: "blocked", summary: untrustedSummary(error instanceof Error ? error.message : "Council automatic preconditions failed."), effectDisposition: "not_started" }; }
    try {
      for (const participant of participants) { await this.phase(request, epoch.id, participant, "pause"); await this.council.acknowledgePause(epoch.id, participant.id); }
      for (const participant of participants) {
        await this.council.assign(epoch.id, participant.id, participant.plannedFiles, participant.resources);
        await this.phase(request, epoch.id, participant, "assignment");
        await this.council.acknowledgeAssignment(epoch.id, participant.id);
      }
      await this.council.beginResume(epoch.id);
      for (const participant of participants) {
        await this.phase(request, epoch.id, participant, "resume");
        await this.council.acknowledgeResume(epoch.id, participant.id);
      }
      const active = await this.council.activate(epoch.id);
      return { status: "completed", summary: "All exact-target mediated participants acknowledged pause, disjoint assignments, and resume through configured provider routes.", effectDisposition: "committed", data: { epochId: active.id, participants: participants.length, status: active.status } };
    } catch (error) {
      await this.council.abort(epoch.id, error instanceof Error ? error.message : "A Council provider acknowledgement failed.").catch(() => undefined);
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

  private async phase(request: CouncilRequest, epochId: string, participant: CouncilParticipant, phase: CouncilPhase): Promise<void> {
    const session = await this.sessions.get(participant.id);
    if (!session || session.metadata["sxsy-b122.providerHandshake"] !== "exact-route-v1") throw new Error(`Council participant ${participant.id} lacks an exact-route provider handshake.`);
    const current = request.effectGuard ? await request.effectGuard.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, session, ...(request.authority ? { authority: request.authority } : {}) }) : { allowed: false, reason: "Council has no final effect guard." };
    if (!current.allowed) throw new Error(current.reason);
    if (request.executionControl && (Date.parse(request.executionControl.deadline) <= this.now() || await request.executionControl.isCancellationRequested())) throw new Error("Automatic Council was cancelled or exceeded its durable deadline.");
    const child = request.childSaga ? await request.childSaga.begin({ action: `council.${phase}`, idempotencyScope: `${epochId}:${participant.id}:${phase}`, details: { sessionId: participant.id, target: request.target.id } }) : undefined;
    if (child && !child.mayExecute) throw new Error(`Council ${phase} for ${participant.id} requires reconciliation and was not replayed.`);
    if (child) await request.childSaga!.markExecuting(child);
    const control = operationSignal(request);
    try {
      const response = await this.network!.request({ routeId: `provider.council.${session.provider}`, repositoryRoot: request.target.repositoryRoot, body: JSON.stringify({ schema: "sxsy-b122.council-phase", version: 1, epochId, phase, sessionId: session.id, targetSnapshotId: request.target.id, ...(phase === "assignment" ? { paths: participant.plannedFiles, resources: participant.resources } : {}) }), signal: control.signal });
      const acknowledgement = parseAcknowledgement(response.body, response.outcome, { epochId, phase, sessionId: session.id, targetSnapshotId: request.target.id });
      if (!acknowledgement) throw new Error(`Council ${phase} was not acknowledged by ${participant.id}.`);
      if (child) { await request.childSaga!.markExternalCommitted(child, { acknowledged: "true" }); await request.childSaga!.settle(child, "completed", { acknowledged: "true" }); }
    } catch (error) {
      if (child) await request.childSaga!.settle(child, "ambiguous", { acknowledged: "unknown" }).catch(() => undefined);
      throw error;
    } finally { control.dispose(); }
  }
}

function reportOutcome(report: Awaited<ReturnType<CouncilCoordinator["report"]>>, summary: string): BrokerOutcome { return { status: "completed", summary, effectDisposition: "committed", data: { participants: report.participants.length, atomic: report.atomic, pathConflicts: report.pathConflicts.length, resourceConflicts: report.resourceConflicts.length, dependencyConflicts: report.dependencyConflicts.length } }; }
function declarations(session: ManagedSession, key: string): readonly string[] { const raw = session.metadata[key]; if (!raw) return []; try { const value: unknown = JSON.parse(raw); return Array.isArray(value) && value.length <= 128 && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 256 && !/[\r\n\0]/.test(item)) ? [...new Set(value)] : []; } catch { return []; } }
function trustedDiff(session: ManagedSession): string | undefined { const value = session.metadata["sxsy-b122.diffDigest"]; return value && /^[a-f0-9]{64}$/i.test(value) ? value : undefined; }
function parseAcknowledgement(body: Uint8Array | undefined, outcome: string, expected: Readonly<{ epochId: string; phase: CouncilPhase; sessionId: string; targetSnapshotId: string }>): boolean { if (outcome !== "passed" || !body) return false; let value: unknown; try { value = JSON.parse(Buffer.from(body).toString("utf8")); } catch { return false; } if (!record(value) || Object.keys(value).length !== 7 || value.schema !== "sxsy-b122.council-ack" || value.version !== 1 || value.epochId !== expected.epochId || value.phase !== expected.phase || value.sessionId !== expected.sessionId || value.targetSnapshotId !== expected.targetSnapshotId || value.accepted !== true) return false; return true; }
function operationSignal(request: CouncilRequest): { readonly signal: AbortSignal; dispose(): void } { const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let poll: ReturnType<typeof setInterval> | undefined; if (request.executionControl) { timer = setTimeout(() => controller.abort(), Math.max(0, Date.parse(request.executionControl.deadline) - Date.now())); poll = setInterval(() => { void request.executionControl!.isCancellationRequested().then((cancelled) => { if (cancelled) controller.abort(); }); }, 100); timer.unref?.(); poll.unref?.(); } return { signal: controller.signal, dispose() { if (timer) clearTimeout(timer); if (poll) clearInterval(poll); } }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
