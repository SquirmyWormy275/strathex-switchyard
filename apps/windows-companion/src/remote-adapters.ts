import type { AdapterOutcome, AdapterRequest, CommandAdapter } from "../../../packages/control-plane/src/adapters.ts";
import { InMemoryAutomationBroker, type AutomationBroker, type AutomationRequest, type BrokerOutcome, type ContainmentGuard, type PermitVerifier } from "../../../packages/control-plane/src/brokers.ts";
import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { Capability, ManagedSession, SessionStatus, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { redactRecord, untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import type { TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import { parseWorkflowProviderResponse, type WorkflowArtifact, type WorkflowArtifactAction, type WorkflowArtifactStore, type WorkflowProviderResponse } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { createDirectConfiguredNetworkBroker, type ConfiguredNetworkResult, type NetworkContainmentFence } from "./configured-network.ts";
import type { CredentialAdapterPort } from "./durable-credentials.ts";
import type { DurableNetworkPolicyRegistry } from "./host-provisioning.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";
import { createDurableAbortControl, type DurableAbortControl } from "./execution-cancellation.ts";

export interface DynamicConfiguredNetworkOptions {
  readonly registry: DurableNetworkPolicyRegistry;
  readonly containment: NetworkContainmentFence;
  readonly credentials: CredentialAdapterPort;
}

export interface ProviderCommandTransport {
  request(input: Readonly<{ routeId: string; repositoryRoot: string; body?: string | Uint8Array; pathParameters?: Readonly<Record<string, string>>; signal?: AbortSignal }>): Promise<ConfiguredNetworkResult>;
  /** A host-known idempotency identity available before the provider effect. */
  recoveryExternalId?(input: Readonly<{ routeId: string; operationId: string; provider: ManagedSession["provider"] }>): string | undefined;
}

/** Re-resolves and digest-checks the attested policy immediately before each route. */
export class DynamicConfiguredNetworkClient implements ProviderCommandTransport {
  private readonly options: DynamicConfiguredNetworkOptions;
  constructor(options: DynamicConfiguredNetworkOptions) { this.options = options; }
  async request(input: Readonly<{ routeId: string; repositoryRoot: string; body?: string | Uint8Array; pathParameters?: Readonly<Record<string, string>>; signal?: AbortSignal }>): Promise<ConfiguredNetworkResult> {
    const policy = await this.options.registry.resolve();
    return createDirectConfiguredNetworkBroker(policy, this.options.containment, this.options.credentials).request(input);
  }
}

export interface ProviderHandshakeRequest {
  readonly session: ManagedSession;
  readonly repositoryRoot: string;
}

export interface ProviderHandshakeCoordinator {
  handshake(input: ProviderHandshakeRequest): Promise<ManagedSession>;
}

/**
 * Elevates a Registered record only after an operator-attested, exact-route
 * provider handshake bound to a complete TargetSnapshot. The provider result
 * is treated as a typed protocol record, never as executable instructions.
 */
export class AttestedProviderHandshakeCoordinator implements ProviderHandshakeCoordinator {
  private readonly network: ProviderCommandTransport;
  private readonly targets: TargetResolver;
  private readonly presence: WindowsUserPresenceRunner;
  private readonly now: () => string;

  constructor(network: ProviderCommandTransport, targets: TargetResolver, presence: WindowsUserPresenceRunner, now: () => string = () => new Date().toISOString()) {
    this.network = network;
    this.targets = targets;
    this.presence = presence;
    this.now = now;
  }

  async handshake(input: ProviderHandshakeRequest): Promise<ManagedSession> {
    if (!providerIdentity(input.session.provider) || !boundedAbsoluteRoot(input.repositoryRoot)) throw new Error("Provider handshake fields are invalid.");
    if (!input.session.capabilities.includes("registered")) throw new Error("Provider handshake requires an existing Registered session.");
    const definition = commandForAction("authority_refresh");
    const before = await this.targets.resolve({ definition, session: { ...input.session, workspaceRoot: input.repositoryRoot } });
    requireHandshakeTarget(before, input.repositoryRoot);
    const approval = await this.presence.verify(`Connect the selected ${input.session.provider} adapter to this exact SXSY-B122 managed session and Git target.`);
    if (!approval.verified || !approval.operator?.trim()) throw new Error("Current-user presence did not approve the provider handshake.");
    const requestedAt = this.now();
    const result = await this.network.request({
      routeId: `provider.handshake.${input.session.provider}`,
      repositoryRoot: before.repositoryRoot,
      body: JSON.stringify({
        schema: "sxsy-b122.provider-handshake-request",
        version: 1,
        sessionId: input.session.id,
        provider: input.session.provider,
        targetSnapshotId: before.id,
        repositoryRoot: before.repositoryRoot,
        branch: before.branch,
        head: before.head,
        requestedAt
      })
    });
    const response = parseProviderHandshake(result);
    if (response.sessionId !== input.session.id || response.provider !== input.session.provider || response.targetSnapshotId !== before.id || normalizeRoot(response.repositoryRoot) !== normalizeRoot(before.repositoryRoot)) throw new Error("The configured provider handshake did not bind the exact requested session and target.");
    const after = await this.targets.resolve({ definition, session: { ...input.session, workspaceRoot: input.repositoryRoot } });
    requireHandshakeTarget(after, input.repositoryRoot);
    if (after.id !== before.id) throw new Error("The target changed during provider handshake; no capability was installed.");
    const capabilities = normalizeHandshakeCapabilities(response.capabilities);
    if ((response.status === "verified_blocked" || response.status === "verified_finished") && !capabilities.includes("observable")) throw new Error("The provider status requires an Observable capability.");
    return {
      ...input.session,
      provider: response.provider,
      capabilities,
      status: response.status,
      workspaceRoot: before.repositoryRoot,
      targetSnapshotId: before.id,
      ...(response.taskId ? { taskId: response.taskId } : {}),
      ...(response.planRevision ? { planRevision: response.planRevision } : {}),
      plannedFiles: response.plannedFiles,
      lastHeartbeat: this.now(),
      adapterVersion: response.adapterVersion,
      metadata: {
        ...input.session.metadata,
        "sxsy-b122.providerHandshake": "exact-route-v1",
        "sxsy-b122.providerHandshakeTarget": before.id,
        "sxsy-b122.providerHandshakeAt": requestedAt,
        "sxsy-b122.resources": JSON.stringify(response.resources),
        "sxsy-b122.dependencies": JSON.stringify(response.dependencies),
        "sxsy-b122.diffDigest": response.diffDigest
      }
    };
  }
}

export const providerCommandActions: readonly CommandAction[] = [
  "reanchor", "proof", "proof_adversarial", "option_provider", "option_packet", "plan_expander", "plan_approval",
  "handoff", "handoff_queue", "handoff_immediate", "focus_blocked_agent", "focus_finished_agent", "authority_refresh", "authority_broadcast", "bind_voice_session"
];
export const remoteAutomationActions: readonly CommandAction[] = ["compound_capture", "compound_refresh", "lfg", "repair_mission"];

export interface WorkflowArtifactDispatchPort {
  claimForDispatch(input: Readonly<{ action: WorkflowArtifactAction; targetSnapshotId: string; sessionId: string; operationId: string }>): Promise<WorkflowArtifact | undefined>;
  acknowledge(response: WorkflowProviderResponse): Promise<WorkflowArtifact>;
}

export class ConfiguredProviderCommandAdapter implements CommandAdapter {
  readonly id = "configured-provider-v1";
  readonly kind = "provider" as const;
  private readonly network: ProviderCommandTransport;
  private readonly artifacts?: WorkflowArtifactDispatchPort;
  constructor(network: ProviderCommandTransport, artifacts?: WorkflowArtifactStore | WorkflowArtifactDispatchPort) { this.network = network; this.artifacts = artifacts; }

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    const action = providerWorkflowAction(request.definition.action);
    if (!request.operationId || !request.target || !request.session || !request.authority || !action || !this.artifacts) return { status: "unavailable", summary: "Configured provider routing requires a typed artifact store, durable operation, managed session, scoped authority, and exact target.", effectDisposition: "not_started" };
    const control = await operationAbort(request.executionControl);
    try {
      if (control.signal.aborted) return { status: "cancelled", summary: "Configured provider routing was cancelled before dispatch.", effectDisposition: "not_started" };
      if (request.effectGuard) {
        const current = await request.effectGuard.assertCurrent({ action: request.definition.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
        if (!current.allowed) return { status: "blocked", summary: current.reason, effectDisposition: "not_started" };
      }
      let artifact: WorkflowArtifact | undefined;
      try {
        artifact = await this.artifacts.claimForDispatch({ action, targetSnapshotId: request.target.id, sessionId: request.session.id, operationId: request.operationId });
      } catch {
        return { status: "blocked", summary: "The prepared provider workflow artifact is missing, ambiguous, corrupt, or bound to another operation.", effectDisposition: "not_started" };
      }
      if (!artifact) return { status: "awaiting_input", summary: "Prepare and explicitly select one typed workflow artifact before provider dispatch.", effectDisposition: "not_started" };
      if (artifact.status === "cancelled" || artifact.status === "cancelling") return { status: "cancelled", summary: "The durable provider workflow was cancelled before replay.", effectDisposition: "not_started", data: { artifactId: artifact.id, artifactDigest: artifact.digest } };
      if (artifact.status === "rejected") return { status: "failed", summary: "The durable provider workflow was previously rejected and was not replayed.", effectDisposition: "not_started", data: { artifactId: artifact.id, artifactDigest: artifact.digest } };
      if (artifact.status === "acknowledged") return { status: "completed", summary: "The durable provider workflow was already acknowledged and was not replayed.", effectDisposition: "committed", data: { artifactId: artifact.id, artifactDigest: artifact.digest, ...(artifact.providerExternalId ? { providerExternalId: artifact.providerExternalId } : {}) } };
      if (artifact.status !== "submitted") return { status: "blocked", summary: "The durable provider workflow is not in a dispatchable submitted state.", effectDisposition: "not_started", data: { artifactId: artifact.id, artifactDigest: artifact.digest } };
      if (control.signal.aborted) return { status: "cancelled", summary: "Configured provider routing was cancelled before network dispatch.", effectDisposition: "not_started", data: { artifactId: artifact.id, artifactDigest: artifact.digest } };
      const routeId = `provider.${request.definition.action}`;
      const recoveryExternalId = this.network.recoveryExternalId?.({ routeId, operationId: request.operationId, provider: request.session.provider });
      const child = request.childSaga ? await request.childSaga.begin({ action: routeId, idempotencyScope: `${artifact.id}:${routeId}`, details: { repositoryRoot: request.target.repositoryRoot, routeId, targetSnapshotId: request.target.id, artifactId: artifact.id, artifactDigest: artifact.digest, ...(recoveryExternalId ? { externalId: recoveryExternalId } : {}) } }) : undefined;
      if (child && !child.mayExecute) return { status: "failed", summary: "A prior provider effect requires exact reconciliation and was not replayed.", effectDisposition: "ambiguous", data: { artifactId: artifact.id, artifactDigest: artifact.digest } };
      if (child) await request.childSaga!.markExecuting(child);
      const finish = async (outcome: AdapterOutcome, response?: WorkflowProviderResponse): Promise<AdapterOutcome> => {
        if (!child || !request.childSaga) return outcome;
        const disposition = outcome.effectDisposition ?? "ambiguous";
        if (disposition === "not_started") await request.childSaga.settle(child, "failed", { artifactId: artifact.id, routeId });
        else if (disposition === "committed") {
          await request.childSaga.markExternalCommitted(child, { artifactId: artifact.id, routeId, ...(response?.externalId ? { externalId: response.externalId } : {}) });
          if (outcome.status === "completed") await request.childSaga.settle(child, "completed", { artifactId: artifact.id, routeId, ...(response?.externalId ? { externalId: response.externalId } : {}) });
        } else if (disposition === "compensated") {
          await request.childSaga.markCompensating(child);
          await request.childSaga.settle(child, "cancelled", { artifactId: artifact.id, routeId });
        } else await request.childSaga.settle(child, "ambiguous", { artifactId: artifact.id, routeId, ...(response?.externalId ? { externalId: response.externalId } : {}) });
        return outcome;
      };
      let body: string;
      try { body = JSON.stringify(providerDocument(request, artifact)); }
      catch { return finish({ status: "blocked", summary: "The provider workflow envelope lacks an exact trusted execution binding.", effectDisposition: "not_started", data: { artifactId: artifact.id, artifactDigest: artifact.digest } }); }
      if (request.effectGuard) {
        const current = await request.effectGuard.assertCurrent({ action: request.definition.action, operationId: request.operationId, target: request.target, session: request.session, ...(request.authority ? { authority: request.authority } : {}) });
        if (!current.allowed) return finish({ status: "blocked", summary: current.reason, effectDisposition: "not_started", data: { artifactId: artifact.id, artifactDigest: artifact.digest } });
      }
      if (control.signal.aborted) return finish({ status: "cancelled", summary: "Configured provider routing was cancelled immediately before network dispatch.", effectDisposition: "not_started", data: { artifactId: artifact.id, artifactDigest: artifact.digest } });
      let result: ConfiguredNetworkResult;
      try { result = await this.network.request({ routeId, repositoryRoot: request.target.repositoryRoot, body, signal: control.signal }); }
      catch { return finish({ status: "failed", summary: "The configured provider transport failed after dispatch may have begun; reconciliation is required.", effectDisposition: "ambiguous", data: { artifactId: artifact.id, artifactDigest: artifact.digest } }); }
      if (result.outcome !== "passed" || !result.body) return finish(adapterOutcome(result));
      let value: unknown;
      try { value = JSON.parse(Buffer.from(result.body).toString("utf8")); }
      catch { return finish({ status: "failed", summary: "The configured provider returned malformed workflow JSON; the effect remains ambiguous.", effectDisposition: "ambiguous", data: { artifactId: artifact.id, artifactDigest: artifact.digest } }); }
      let response: WorkflowProviderResponse;
      try { response = parseWorkflowProviderResponse(value, artifact); }
      catch { return finish({ status: "failed", summary: "The configured provider returned a result that did not match the exact typed artifact; the effect remains ambiguous.", effectDisposition: "ambiguous", data: { artifactId: artifact.id, artifactDigest: artifact.digest } }); }
      try { await this.artifacts.acknowledge(response); }
      catch { return finish({ status: "failed", summary: "The provider result was valid but could not be durably acknowledged; reconciliation is required.", effectDisposition: response.effectDisposition, data: workflowOutcomeData(artifact, response) }, response); }
      return finish({ status: response.status, summary: response.summary, effectDisposition: response.effectDisposition, data: workflowOutcomeData(artifact, response) }, response);
    } finally { control.dispose(); }
  }
}

export function createConfiguredAutomationBroker(policy: PermitVerifier, containment: ContainmentGuard, network: ProviderCommandTransport): AutomationBroker {
  const broker = new InMemoryAutomationBroker(policy, containment);
  for (const action of remoteAutomationActions) broker.register(action, async (request) => remoteAutomation(request, network));
  return broker;
}

async function remoteAutomation(request: AutomationRequest, network: ProviderCommandTransport): Promise<BrokerOutcome> {
  if (!request.effectGuard) return { status: "blocked", summary: "Configured automation requires a final dispatch-bound effect guard.", effectDisposition: "not_started" };
  const current = await request.effectGuard.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
  if (!current.allowed) return { status: "blocked", summary: current.reason, effectDisposition: "not_started" };
  const control = await operationAbort(request.executionControl);
  try {
    const routeId = `automation.${request.action}`;
    const recoveryExternalId = request.session ? network.recoveryExternalId?.({ routeId, operationId: request.operationId, provider: request.session.provider }) : undefined;
    const child = request.childSaga ? await request.childSaga.begin({
      action: routeId,
      idempotencyScope: `${request.operationId}:${routeId}`,
      details: {
        repositoryRoot: request.target.repositoryRoot,
        routeId,
        targetSnapshotId: request.target.id,
        ...(recoveryExternalId ? { externalId: recoveryExternalId } : {})
      }
    }) : undefined;
    if (child && !child.mayExecute) return { status: "failed", summary: "A prior provider automation effect requires exact reconciliation and was not replayed.", effectDisposition: "ambiguous" };
    if (child) await request.childSaga!.markExecuting(child);
    const finish = async (outcome: BrokerOutcome): Promise<BrokerOutcome> => {
      if (!child || !request.childSaga) return outcome;
      const details = { routeId, ...(recoveryExternalId ? { externalId: recoveryExternalId } : {}), ...externalIdDetails(outcome.data) };
      const disposition = outcome.effectDisposition ?? "ambiguous";
      if (disposition === "not_started") await request.childSaga.settle(child, "failed", details);
      else if (disposition === "committed") {
        await request.childSaga.markExternalCommitted(child, details);
        if (outcome.status === "completed") await request.childSaga.settle(child, "completed", details);
        else await request.childSaga.settle(child, "ambiguous", details);
      } else if (disposition === "compensated") {
        await request.childSaga.markCompensating(child);
        await request.childSaga.settle(child, "cancelled", details);
      } else await request.childSaga.settle(child, "ambiguous", details);
      return outcome;
    };
    if (control.signal.aborted) return finish({ status: "cancelled", summary: "Configured provider automation was cancelled before dispatch.", effectDisposition: "not_started" });
    const document = {
      schema: "sxsy-b122.remote-automation",
      version: 1,
      action: request.action,
      operationId: request.operationId,
      target: targetDocument(request.target),
      session: request.session ? sessionDocument(request.session) : undefined,
      authorityId: request.authority?.id,
      testEnvironment: request.testEnvironment ? { id: request.testEnvironment.id, egress: request.testEnvironment.egress, databaseName: request.testEnvironment.databaseName } : undefined
    };
    const final = await request.effectGuard.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
    if (!final.allowed) return finish({ status: "blocked", summary: final.reason, effectDisposition: "not_started" });
    if (control.signal.aborted) return finish({ status: "cancelled", summary: "Configured provider automation was cancelled immediately before dispatch.", effectDisposition: "not_started" });
    let result: ConfiguredNetworkResult;
    try { result = await network.request({ routeId, repositoryRoot: request.target.repositoryRoot, body: JSON.stringify(document), signal: control.signal }); }
    catch { return finish({ status: "failed", summary: "The provider automation result was lost; exact observation is required.", effectDisposition: "ambiguous" }); }
    const outcome = adapterOutcome(result);
    return finish({ status: outcome.status === "awaiting_input" || outcome.status === "awaiting_confirmation" ? "incomplete" : outcome.status, summary: outcome.summary, effectDisposition: outcome.effectDisposition, ...(outcome.data ? { data: outcome.data } : {}) });
  } finally { control.dispose(); }
}

function externalIdDetails(data: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, string>> {
  const value = data?.externalId;
  return typeof value === "string" && value.length <= 256 && !/[\0\r\n]/.test(value) ? { externalId: value } : {};
}

function providerDocument(request: AdapterRequest, artifact: WorkflowArtifact) {
  let planAuthorization = {};
  if (artifact.action === "plan_approval") {
    const session = request.session;
    const authority = request.authority;
    if (!session || !authority || artifact.payload.kind !== "plan" || artifact.payload.mode !== "approve" || !request.confirmation?.currentUserConfirmed
      || request.confirmation.action !== "plan_approval" || request.confirmation.targetSnapshotId !== request.target?.id
      || request.confirmation.sessionId !== session.id || request.confirmation.authorityId !== authority.id
      || request.confirmation.confirmationDigest !== artifact.payload.confirmationDigest
      || artifact.payload.executorSessionId !== session.id || artifact.payload.authorityId !== authority.id
      || artifact.taskId !== artifact.payload.plan.taskId || artifact.planRevision !== artifact.payload.plan.revision
      || session.taskId !== artifact.payload.plan.taskId || session.planRevision !== artifact.payload.plan.revision) {
      throw new Error("Plan Approval requires dispatcher-proven current-user confirmation for the exact target, session, and authority.");
    }
    planAuthorization = {
        executionAuthorization: {
          executionAuthorized: true as const,
          executeOnce: true as const,
          currentUserConfirmed: true as const,
          confirmationDigest: request.confirmation.confirmationDigest,
          operationId: request.operationId!,
          artifactId: artifact.id,
          artifactDigest: artifact.digest,
          targetSnapshotId: request.target!.id,
          sessionId: request.session!.id,
          authorityId: request.authority!.id,
          planDigest: artifact.payload.plan.digest,
          planRevision: artifact.payload.plan.revision,
          originSessionId: artifact.payload.plan.originSessionId
        }
      };
  }
  return {
    schema: "sxsy-b122.workflow-command",
    version: 1,
    action: request.definition.action,
    operationId: request.operationId,
    target: targetDocument(request.target!),
    session: sessionDocument(request.session!),
    authorityId: request.authority?.id,
    ...planAuthorization,
    artifact: {
      id: artifact.id,
      digest: artifact.digest,
      taskId: artifact.taskId,
      planRevision: artifact.planRevision,
      payload: artifact.payload,
      executionAuthorized: false
    }
  };
}
function targetDocument(target: NonNullable<AdapterRequest["target"]>) { return { id: target.id, repositoryRoot: target.repositoryRoot, branch: target.branch, head: target.head, policyVersion: target.policyVersion, trackedManifest: target.trackedManifest, untrackedManifest: target.untrackedManifest }; }
function sessionDocument(session: NonNullable<AdapterRequest["session"]>) { return { id: session.id, provider: session.provider, surface: session.surface, capabilities: session.capabilities, taskId: session.taskId, planRevision: session.planRevision, plannedFiles: session.plannedFiles }; }
function providerWorkflowAction(action: CommandAction): WorkflowArtifactAction | undefined { return (providerCommandActions as readonly string[]).includes(action) ? action as WorkflowArtifactAction : undefined; }
function workflowOutcomeData(artifact: WorkflowArtifact, response: WorkflowProviderResponse): Readonly<Record<string, unknown>> {
  return redactRecord({
    artifactId: artifact.id,
    artifactDigest: artifact.digest,
    resultKind: response.result.kind,
    workflowResult: response.result,
    providerSummary: response.summary,
    ...(response.externalId ? { externalId: response.externalId } : {})
  });
}

function adapterOutcome(result: ConfiguredNetworkResult): AdapterOutcome {
  if (result.outcome !== "passed" || !result.body) return { status: result.outcome === "blocked" ? "blocked" : result.outcome === "unavailable" ? "unavailable" : "failed", summary: untrustedSummary(result.detail), effectDisposition: result.effectDisposition };
  let value: unknown;
  try { value = JSON.parse(Buffer.from(result.body).toString("utf8")); } catch { return { status: "failed", summary: "The configured remote adapter returned malformed JSON; no success was recorded.", effectDisposition: "ambiguous" }; }
  if (!record(value) || !exact(value, ["schema", "version", "status", "summary", "effectDisposition", ...(value.externalId === undefined ? [] : ["externalId"]), ...(value.data === undefined ? [] : ["data"])]) || value.schema !== "sxsy-b122.remote-result" || value.version !== 1 || !remoteStatus(value.status) || !effectDisposition(value.effectDisposition) || typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 512 || (value.externalId !== undefined && (typeof value.externalId !== "string" || value.externalId.length > 256)) || (value.data !== undefined && !record(value.data))) return { status: "failed", summary: "The configured remote adapter returned an invalid exact-v1 result; no success was recorded.", effectDisposition: "ambiguous" };
  return { status: value.status, summary: untrustedSummary(value.summary), effectDisposition: value.effectDisposition, data: redactRecord({ ...(value.externalId ? { externalId: value.externalId } : {}), ...(value.data ? value.data : {}) }) };
}
function remoteStatus(value: unknown): value is AdapterOutcome["status"] { return typeof value === "string" && ["completed", "unavailable", "blocked", "failed", "awaiting_input", "awaiting_confirmation", "running", "cancelled", "timed_out"].includes(value); }
function effectDisposition(value: unknown): value is NonNullable<AdapterOutcome["effectDisposition"]> { return value === "not_started" || value === "committed" || value === "ambiguous" || value === "compensated"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }

interface ProviderHandshakeResponse {
  readonly sessionId: string;
  readonly provider: ManagedSession["provider"];
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly capabilities: readonly Capability[];
  readonly status: SessionStatus;
  readonly adapterVersion: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  readonly plannedFiles: readonly string[];
  readonly resources: readonly string[];
  readonly dependencies: readonly string[];
  readonly diffDigest: string;
}

function parseProviderHandshake(result: ConfiguredNetworkResult): ProviderHandshakeResponse {
  if (result.outcome !== "passed" || !result.body) throw new Error("The configured provider handshake route did not complete successfully.");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(result.body).toString("utf8")); } catch { throw new Error("The provider handshake returned malformed JSON."); }
  if (!record(value)) throw new Error("The provider handshake returned a non-record response.");
  const optional = [value.taskId === undefined ? undefined : "taskId", value.planRevision === undefined ? undefined : "planRevision"].filter((item): item is string => !!item);
  if (!exact(value, ["schema", "version", "sessionId", "provider", "targetSnapshotId", "repositoryRoot", "capabilities", "status", "adapterVersion", "plannedFiles", "resources", "dependencies", "diffDigest", ...optional])
    || value.schema !== "sxsy-b122.provider-handshake" || value.version !== 1
    || typeof value.sessionId !== "string" || !boundedOpaque(value.sessionId, 256)
    || !providerIdentity(value.provider) || typeof value.targetSnapshotId !== "string" || !/^[a-f0-9]{64}$/i.test(value.targetSnapshotId)
    || !boundedAbsoluteRoot(value.repositoryRoot) || !Array.isArray(value.capabilities) || !value.capabilities.every(capability)
    || !sessionStatus(value.status) || typeof value.adapterVersion !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(value.adapterVersion)
    || !Array.isArray(value.plannedFiles) || value.plannedFiles.length > 512 || !value.plannedFiles.every(safePlannedFile)
    || !Array.isArray(value.resources) || value.resources.length > 128 || !value.resources.every(safeDeclaration)
    || !Array.isArray(value.dependencies) || value.dependencies.length > 128 || !value.dependencies.every(safeDeclaration)
    || typeof value.diffDigest !== "string" || !/^[a-f0-9]{64}$/i.test(value.diffDigest)
    || (value.taskId !== undefined && (typeof value.taskId !== "string" || !boundedOpaque(value.taskId, 256)))
    || (value.planRevision !== undefined && (typeof value.planRevision !== "string" || !boundedOpaque(value.planRevision, 256)))) {
    throw new Error("The provider handshake returned an invalid exact-v1 response.");
  }
  return {
    sessionId: value.sessionId,
    provider: value.provider,
    targetSnapshotId: value.targetSnapshotId,
    repositoryRoot: value.repositoryRoot,
    capabilities: value.capabilities as Capability[],
    status: value.status,
    adapterVersion: value.adapterVersion,
    ...(typeof value.taskId === "string" ? { taskId: value.taskId } : {}),
    ...(typeof value.planRevision === "string" ? { planRevision: value.planRevision } : {}),
    plannedFiles: value.plannedFiles as string[],
    resources: value.resources as string[],
    dependencies: value.dependencies as string[],
    diffDigest: value.diffDigest
  };
}

function normalizeHandshakeCapabilities(values: readonly Capability[]): readonly Capability[] {
  const result = [...new Set(values)];
  if (!result.includes("registered")) throw new Error("A provider handshake must retain Registered capability.");
  if (result.includes("mediated") && (!result.includes("observable") || !result.includes("controllable"))) throw new Error("Mediated capability requires Observable and Controllable.");
  if (result.includes("controllable") && !result.includes("observable")) throw new Error("Controllable capability requires Observable.");
  return result;
}
function requireHandshakeTarget(target: TargetSnapshot | undefined, repositoryRoot: string): asserts target is TargetSnapshot {
  if (!target || target.completeness !== "complete" || normalizeRoot(target.repositoryRoot) !== normalizeRoot(repositoryRoot)) throw new Error("Provider handshake requires a complete exact TargetSnapshot.");
}
function boundedAbsoluteRoot(value: unknown): value is string { return typeof value === "string" && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && value.length <= 4_096 && !/[\r\n\0]/.test(value); }
function normalizeRoot(value: string): string { return value.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase(); }
function boundedOpaque(value: string, maximum: number): boolean { return !!value.trim() && value.length <= maximum && !/[\r\n\0]/.test(value); }
function providerIdentity(value: unknown): value is ManagedSession["provider"] { return value === "claude" || value === "codex" || value === "generic" || value === "voice"; }
function capability(value: unknown): value is Capability { return value === "registered" || value === "observable" || value === "controllable" || value === "mediated"; }
function sessionStatus(value: unknown): value is SessionStatus { return value === "running" || value === "verified_blocked" || value === "verified_finished" || value === "unreachable" || value === "stale" || value === "unknown"; }
function safePlannedFile(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value) && !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value) && !value.split(/[\\/]/).includes(".."); }
function safeDeclaration(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value); }

async function operationAbort(control: AutomationRequest["executionControl"] | AdapterRequest["executionControl"]): Promise<DurableAbortControl> {
  return createDurableAbortControl(control);
}
