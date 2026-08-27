import { randomBytes } from "node:crypto";

import { commandActionIds, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { EffectGuard } from "../../../packages/control-plane/src/brokers.ts";
import type { Capability, EffectDisposition, ManagedSession, SessionStatus } from "../../../packages/control-plane/src/contracts.ts";
import type { OperationControllerObservation, OperationReconciliationBinding } from "../../../packages/control-plane/src/runtime.ts";
import {
  canonicalReanchorProviderAcknowledgement,
  reanchorApplyArtifactDigest,
  type ReanchorApplyOutcome,
  type ReanchorApplyPort,
  type ReanchorApplyRequest
} from "../../../packages/control-plane/src/reanchor.ts";
import { redactText } from "../../../packages/control-plane/src/redaction.ts";
import { ProtectedJsonStore, sha256, stableJson, type JsonValue } from "../../../packages/control-plane/src/store.ts";
import type {
  AuthorityPendingRequest,
  CoordinatorEvidenceBundle,
  ExistingPlanBinding,
  PendingDecision,
  PlanStepArtifact,
  WorkflowEvidenceReference,
  WorkflowTestEvidence
} from "../../../packages/control-plane/src/workflow-artifacts.ts";
import type { ProviderCommandTransport } from "./remote-adapters.ts";

export type ConfiguredProviderIdentity = Extract<ManagedSession["provider"], "claude" | "codex">;

export interface ConfiguredProviderOperationIdentity {
  readonly operationId: string;
  readonly externalId: string;
  readonly routeId: string;
  readonly sessionId: string;
  readonly provider: ConfiguredProviderIdentity;
  readonly action: CommandAction;
  readonly authorityId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
}

export interface ConfiguredProviderOperationObservation extends ConfiguredProviderOperationIdentity {
  readonly outcome: "committed" | "failed" | "cancelled" | "unresolved";
  readonly effectDisposition: EffectDisposition;
  readonly summary: string;
}

export interface ConfiguredProviderCancellationAcknowledgement extends ConfiguredProviderOperationIdentity {
  readonly accepted: boolean;
  readonly summary: string;
}

export interface ConfiguredProviderRecoveryObservation {
  readonly outcome: ConfiguredProviderOperationObservation["outcome"];
  readonly note: string;
  readonly details?: Readonly<Record<string, string>>;
}

export interface ConfiguredProviderHostReconciliationReceipt {
  readonly operationsInspected: number;
  readonly operationsSettled: number;
  readonly councilsInspected: number;
  readonly councilsSettled: number;
}

export interface ConfiguredProviderCouncilCleanup {
  readonly provider: ConfiguredProviderIdentity;
  readonly epochId: string;
  readonly sessionId: string;
  readonly targetSnapshotId: string;
  readonly resourceHostDigest: string;
  readonly outcome: "completed" | "aborted" | "cancelled";
  readonly repositoryRoot: string;
}

export interface ConfiguredProviderWorkflowContextTarget {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly head: string;
}

export interface ConfiguredProviderWorkflowContextRequest {
  readonly session: ManagedSession;
  readonly target: ConfiguredProviderWorkflowContextTarget;
}

export interface ConfiguredProviderWorkflowContextObservation {
  readonly schema: "sxsy-b122.provider-workflow-context-observation";
  readonly version: 1;
  readonly sessionId: string;
  readonly provider: ConfiguredProviderIdentity;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly head: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly requestNonce: string;
  readonly contextId: string;
  readonly sourceRevision: number;
  readonly plannedFiles: readonly string[];
  readonly resources: readonly string[];
  readonly dependencies: readonly string[];
  readonly diffDigest: string;
  readonly evidence: CoordinatorEvidenceBundle;
  readonly pendingDecisions: readonly PendingDecision[];
  readonly pendingRequest: AuthorityPendingRequest | null;
  readonly adapter: Readonly<{ id: string; version: string; moduleSha256: string }>;
  readonly contextDigest: string;
  readonly observedAt: string;
  readonly envelopeDigest: string;
}

export interface ConfiguredProviderHostClientOptions {
  readonly nonceFactory?: () => string;
  readonly observationDeadlineMs?: number;
}

/** Dedicated one-effect Re-anchor port. It never falls back to generic provider.execute. */
export class ConfiguredProviderReanchorApplyPort implements ReanchorApplyPort {
  constructor(private readonly network: ProviderCommandTransport, private readonly effectGuard: EffectGuard) {}

  async apply(input: ReanchorApplyRequest): Promise<ReanchorApplyOutcome> {
    const { artifactDigest, ...unsigned } = input;
    if (reanchorApplyArtifactDigest(unsigned) !== artifactDigest) {
      return { disposition: "not_started", summary: "The protected Re-anchor artifact digest changed before provider dispatch." };
    }
    const guard: EffectGuard = {
      assertCurrent: async () => {
        const oldCurrent = await this.effectGuard.assertCurrent({
          action: "reanchor", operationId: input.operationId, target: input.oldTarget, session: input.session, authority: input.authority
        });
        if (!oldCurrent.allowed) return oldCurrent;
        return this.effectGuard.assertCurrent({
          action: "reanchor", operationId: input.operationId, target: input.newTarget, session: input.session, authority: input.authority
        });
      }
    };
    const final = await guard.assertCurrent({ action: "reanchor", operationId: input.operationId, target: input.oldTarget, session: input.session, authority: input.authority });
    if (!final.allowed) return { disposition: "not_started", summary: redactText(final.reason) };
    const body = JSON.stringify({ schema: "sxsy-b122.provider-reanchor-request", ...input });
    let result;
    try {
      result = await this.network.request({
        routeId: `provider.reanchor.${input.provider}`,
        repositoryRoot: input.repositoryRoot,
        body,
        trustedDispatch: {
          action: "reanchor",
          guardAction: "reanchor",
          operationId: input.operationId,
          guardOperationId: input.operationId,
          target: input.oldTarget,
          session: input.session,
          authority: input.authority,
          artifact: { id: input.requestId, digest: input.artifactDigest, coordinatorContextDigest: null, coordinatorContextRevision: null },
          confirmation: { digest: input.confirmationDigest, scopeDigest: input.confirmationScopeDigest },
          effectGuard: guard
        }
      });
    } catch {
      return this.observeAmbiguous(input, body);
    }
    if (result.outcome !== "passed") {
      if (result.effectDisposition === "not_started") return { disposition: "not_started", summary: redactText(result.detail) };
      return this.observeAmbiguous(input, body);
    }
    return {
      disposition: "committed",
      acknowledgement: canonicalReanchorProviderAcknowledgement(responseRecord(result, "provider Re-anchor"), input)
    };
  }

  private async observeAmbiguous(input: ReanchorApplyRequest, body: string): Promise<ReanchorApplyOutcome> {
    try {
      const observed = await this.network.request({
        routeId: `provider.observe-reanchor.${input.provider}`,
        repositoryRoot: input.repositoryRoot,
        body
      });
      if (observed.outcome === "passed") {
        return {
          disposition: "committed",
          acknowledgement: canonicalReanchorProviderAcknowledgement(responseRecord(observed, "observed provider Re-anchor"), input)
        };
      }
      return { disposition: "ambiguous", summary: redactText(observed.detail) };
    } catch {
      return { disposition: "ambiguous", summary: "The provider Re-anchor may have committed, but exact observation is unavailable; it was not replayed." };
    }
  }
}

/**
 * Read-only/cancellation client for the separately packaged provider host.
 * Every request carries the complete provider/session/target/operation binding;
 * no route, external ID, or target is derived from provider output.
 */
export class ConfiguredProviderHostClient {
  private readonly network: ProviderCommandTransport;
  private readonly now: () => string;
  private readonly nonceFactory: () => string;
  private readonly observationDeadlineMs: number;
  private readonly workflowObservationTails = new Map<string, Promise<void>>();
  private readonly workflowObservationHeads = new Map<string, Readonly<{ sourceRevision: number; contextDigest: string }>>();

  constructor(network: ProviderCommandTransport, now: () => string = () => new Date().toISOString(), options: ConfiguredProviderHostClientOptions = {}) {
    this.network = network;
    this.now = now;
    this.nonceFactory = options.nonceFactory ?? (() => randomBytes(32).toString("hex"));
    this.observationDeadlineMs = boundedDeadline(options.observationDeadlineMs ?? 10_000);
  }

  recoveryExternalId(input: Readonly<{ routeId: string; operationId: string; provider: ManagedSession["provider"] }>): string | undefined {
    return supportedProvider(input.provider) && safeId(input.operationId) && safeRoute(input.routeId) && input.routeId.startsWith("provider.")
      ? input.operationId
      : undefined;
  }

  async refreshSession(session: ManagedSession, signal?: AbortSignal): Promise<ManagedSession> {
    const provider = requireProvider(session.provider);
    const repositoryRoot = requireRoot(session.workspaceRoot);
    const targetSnapshotId = requireDigest(session.targetSnapshotId);
    requireHostHandshake(session);
    const result = await this.network.request({
      routeId: `provider.observe-session.${provider}`,
      repositoryRoot,
      body: JSON.stringify({
        schema: "sxsy-b122.provider-session-observe", version: 1,
        sessionId: session.id, targetSnapshotId, repositoryRoot
      }),
      ...(signal ? { signal } : {})
    });
    const value = responseRecord(result, "provider session observation");
    const keys = ["schema", "version", "sessionId", "provider", "targetSnapshotId", "repositoryRoot", "status", "capabilities", "adapterVersion"];
    if (!exact(value, keys) || value.schema !== "sxsy-b122.provider-session-observation" || value.version !== 1
      || value.sessionId !== session.id || value.provider !== provider || value.targetSnapshotId !== targetSnapshotId
      || rootKey(value.repositoryRoot) !== rootKey(repositoryRoot) || !sessionStatus(value.status) || !capabilityList(value.capabilities)
      || typeof value.adapterVersion !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(value.adapterVersion)) throw rejected();
    return Object.freeze({ ...session, status: value.status, capabilities: value.capabilities, adapterVersion: value.adapterVersion, lastHeartbeat: timestamp(this.now()) });
  }

  async refreshSessions(sessions: readonly ManagedSession[], signal?: AbortSignal): Promise<readonly ManagedSession[]> {
    const results: ManagedSession[] = [];
    for (const session of sessions) {
      if (!supportedProvider(session.provider) || !hasHostHandshake(session)) { results.push(session); continue; }
      try { results.push(await this.refreshSession(session, signal)); }
      catch { results.push(Object.freeze({ ...session, status: "unreachable" as const, capabilities: session.capabilities.filter((item) => item === "registered"), lastHeartbeat: timestamp(this.now()) })); }
    }
    return results;
  }

  async observeWorkflowContext(input: ConfiguredProviderWorkflowContextRequest, signal?: AbortSignal): Promise<ConfiguredProviderWorkflowContextObservation> {
    const binding = workflowContextBinding(input);
    const key = workflowContextKey(binding);
    const boundary = new ProviderObservationBoundary(signal, this.observationDeadlineMs);
    const previous = this.workflowObservationTails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      if (boundary.signal.aborted) throw observationUnavailable();
      const requestNonce = this.nonceFactory();
      if (!digest(requestNonce)) throw new Error("The provider workflow-context nonce source is invalid.");
      const request = Object.freeze({
        schema: "sxsy-b122.provider-workflow-context-observe" as const,
        version: 1 as const,
        ...binding,
        requestNonce
      });
      const result = await boundary.wait(this.network.request({
        routeId: `provider.observe-workflow-context.${binding.provider}`,
        repositoryRoot: binding.repositoryRoot,
        body: JSON.stringify(request),
        signal: boundary.signal
      }));
      const observation = normalizeWorkflowContextResponse(responseRecord(result, "provider workflow-context observation"), request, input.session.adapterVersion);
      const latest = this.workflowObservationHeads.get(key);
      if (latest && observation.sourceRevision < latest.sourceRevision) throw new Error("The provider workflow-context source revision rolled back.");
      if (latest && observation.sourceRevision === latest.sourceRevision && observation.contextDigest !== latest.contextDigest) {
        throw new Error("One provider workflow-context source revision changed its exact content binding.");
      }
      this.workflowObservationHeads.set(key, Object.freeze({ sourceRevision: observation.sourceRevision, contextDigest: observation.contextDigest }));
      return observation;
    });
    const settled = run.then(() => undefined, () => undefined);
    this.workflowObservationTails.set(key, settled);
    void settled.finally(() => { if (this.workflowObservationTails.get(key) === settled) this.workflowObservationTails.delete(key); });
    try { return await run; }
    finally { boundary.dispose(); }
  }

  async observeOperation(identity: ConfiguredProviderOperationIdentity, signal?: AbortSignal): Promise<ConfiguredProviderOperationObservation> {
    validateOperationIdentity(identity);
    const result = await this.network.request({
      routeId: `provider.observe-operation.${identity.provider}`,
      repositoryRoot: identity.repositoryRoot,
      body: JSON.stringify({ schema: "sxsy-b122.provider-operation-observe", version: 1, ...identity }),
      ...(signal ? { signal } : {})
    });
    const value = responseRecord(result, "provider operation observation");
    const keys = ["schema", "version", "operationId", "externalId", "routeId", "sessionId", "provider", "action", "authorityId", "targetSnapshotId", "repositoryRoot", "outcome", "effectDisposition", "summary"];
    if (!exact(value, keys) || value.schema !== "sxsy-b122.provider-operation-observation" || value.version !== 1 || !sameOperation(value, identity)
      || !operationOutcome(value.outcome) || !effectDisposition(value.effectDisposition)
      || !consistentOperationEffect(value.outcome, value.effectDisposition) || !summary(value.summary)) throw rejected();
    return Object.freeze({ ...identity, outcome: value.outcome, effectDisposition: value.effectDisposition, summary: value.summary });
  }

  async cancelOperation(identity: ConfiguredProviderOperationIdentity, reason: string, signal?: AbortSignal): Promise<ConfiguredProviderCancellationAcknowledgement> {
    validateOperationIdentity(identity);
    if (!summary(reason, 1_024)) throw new Error("The provider cancellation reason is invalid.");
    const result = await this.network.request({
      routeId: `provider.cancel.${identity.provider}`,
      repositoryRoot: identity.repositoryRoot,
      body: JSON.stringify({ schema: "sxsy-b122.provider-operation-cancel", version: 1, ...identity, reason }),
      ...(signal ? { signal } : {})
    });
    const value = responseRecord(result, "provider cancellation acknowledgement");
    const keys = ["schema", "version", "operationId", "externalId", "routeId", "sessionId", "provider", "action", "authorityId", "targetSnapshotId", "repositoryRoot", "accepted", "summary"];
    if (!exact(value, keys) || value.schema !== "sxsy-b122.provider-cancellation-ack" || value.version !== 1
      || !sameOperation(value, identity) || typeof value.accepted !== "boolean" || !summary(value.summary)) throw rejected();
    return Object.freeze({ ...identity, accepted: value.accepted, summary: value.summary });
  }

  async reconcile(repositoryRoot: string, signal?: AbortSignal): Promise<ConfiguredProviderHostReconciliationReceipt> {
    const root = requireRoot(repositoryRoot);
    const result = await this.network.request({ routeId: "provider.reconcile", repositoryRoot: root, body: "{}", ...(signal ? { signal } : {}) });
    const value = responseRecord(result, "provider-host reconciliation");
    const keys = ["schema", "version", "operationsInspected", "operationsSettled", "councilsInspected", "councilsSettled"];
    if (!exact(value, keys) || value.schema !== "sxsy-b122.provider-host-reconciliation" || value.version !== 1 || !keys.slice(2).every((key) => boundedCount(value[key]))) throw rejected();
    return Object.freeze({ operationsInspected: value.operationsInspected as number, operationsSettled: value.operationsSettled as number, councilsInspected: value.councilsInspected as number, councilsSettled: value.councilsSettled as number });
  }

  async cleanupCouncilResources(input: ConfiguredProviderCouncilCleanup, signal?: AbortSignal): Promise<void> {
    if (!supportedProvider(input.provider) || !safeId(input.epochId) || !safeId(input.sessionId) || !digest(input.targetSnapshotId) || !digest(input.resourceHostDigest)
      || (input.outcome !== "completed" && input.outcome !== "aborted" && input.outcome !== "cancelled")) throw new Error("The exact provider Council cleanup binding is invalid.");
    const repositoryRoot = requireRoot(input.repositoryRoot);
    const request = { schema: "sxsy-b122.council-resource-cleanup", version: 1, epochId: input.epochId, sessionId: input.sessionId, targetSnapshotId: input.targetSnapshotId, resourceHostDigest: input.resourceHostDigest, outcome: input.outcome };
    const result = await this.network.request({ routeId: `provider.council-cleanup.${input.provider}`, repositoryRoot, body: JSON.stringify(request), ...(signal ? { signal } : {}) });
    const value = responseRecord(result, "provider Council resource cleanup");
    if (!exact(value, ["schema", "version", "epochId", "sessionId", "targetSnapshotId", "resourceHostDigest", "outcome", "closed"])
      || value.schema !== "sxsy-b122.council-resource-cleanup-ack" || value.version !== 1 || value.epochId !== input.epochId || value.sessionId !== input.sessionId
      || value.targetSnapshotId !== input.targetSnapshotId || value.resourceHostDigest !== input.resourceHostDigest || value.outcome !== input.outcome || value.closed !== true) throw rejected();
  }
}

const providerOperationBindingKind = "b122.configured-provider.operation-binding.v1";

interface StoredProviderOperationBinding {
  readonly schema: "sxsy-b122.configured-provider-operation-binding";
  readonly version: 1;
  readonly identity: ConfiguredProviderOperationIdentity;
}

export interface DurableConfiguredProviderOperationControlOptions {
  readonly store: ProtectedJsonStore;
  readonly transport: ProviderCommandTransport;
  readonly host: Pick<ConfiguredProviderHostClient, "recoveryExternalId" | "observeOperation" | "cancelOperation" | "reconcile">;
}

/**
 * Persists the companion-known provider identity before the effect transport
 * is invoked. Restart observation and cancellation use only this authenticated
 * binding and never reconstruct identity from a provider response or replay
 * the original request.
 */
export class DurableConfiguredProviderOperationControl implements ProviderCommandTransport {
  private readonly store: ProtectedJsonStore;
  private readonly transport: ProviderCommandTransport;
  private readonly host: DurableConfiguredProviderOperationControlOptions["host"];

  constructor(options: DurableConfiguredProviderOperationControlOptions) {
    if (!options.store.hasAuthenticatedProtection) throw new Error("Configured provider operation recovery requires authenticated durable storage.");
    this.store = options.store;
    this.transport = options.transport;
    this.host = options.host;
  }

  recoveryExternalId(input: Readonly<{ routeId: string; operationId: string; provider: ManagedSession["provider"] }>): string | undefined {
    if (input.routeId.startsWith("automation.")) return undefined;
    const protectedIdentity = this.host.recoveryExternalId(input);
    const transportIdentity = this.transport.recoveryExternalId?.(input);
    return transportIdentity !== undefined && protectedIdentity !== transportIdentity ? undefined : transportIdentity ?? protectedIdentity;
  }

  handshakeCapabilityCeiling(input: Readonly<{ routeId: string; provider: ManagedSession["provider"]; repositoryRoot: string }>): Promise<readonly Capability[]> | readonly Capability[] {
    return this.transport.handshakeCapabilityCeiling?.(input) ?? ["registered"];
  }

  async request(input: Parameters<ProviderCommandTransport["request"]>[0]): ReturnType<ProviderCommandTransport["request"]> {
    if (input.routeId.startsWith("automation.proposal.")) {
      if (input.trustedDispatch) throw new Error("Automation proposal routes cannot carry a trusted effect dispatch binding.");
      return this.transport.request(input);
    }
    if (input.routeId.startsWith("automation.")) {
      throw new Error("Automation effect routes are proposal-only at the provider boundary; reviewed effects execute only through the host-local broker.");
    }
    const identity = this.dispatchIdentity(input);
    if (identity) await this.claim(identity);
    return this.transport.request(input);
  }

  async cancelByOperation(operationId: string, reason: string): Promise<number> {
    if (!safeId(operationId) || !summary(reason, 1_024)) throw new Error("The configured provider cancellation binding is invalid.");
    return this.cancel(this.uniqueBindings((await this.bindings()).filter((identity) => identity.operationId === operationId)), reason);
  }

  async cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number> {
    const root = requireRoot(repositoryRoot);
    if (!summary(reason, 1_024)) throw new Error("The configured provider cancellation reason is invalid.");
    return this.cancel(this.uniqueBindings((await this.bindings()).filter((identity) => rootKey(identity.repositoryRoot) === rootKey(root))), reason);
  }

  async observeOperation(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>> {
    if (!safeId(operationId)) throw new Error("The configured provider operation ID is invalid.");
    const identities = this.uniqueBindings((await this.bindings()).filter((identity) => identity.operationId === operationId));
    if (identities.length === 0) return { settled: false, summary: "No exact durable configured-provider operation is bound to this operation." };
    if (identities.length !== 1) return { settled: false, summary: "More than one configured-provider identity claims this operation; terminal state remains ambiguous." };
    const identity = identities[0]!;
    const observed = await this.observeBoundOperation(bindingFromProviderIdentity(identity));
    return { settled: observed.state === "terminal", summary: observed.summary };
  }

  async observeProviderOperation(identity: ConfiguredProviderOperationIdentity): Promise<ConfiguredProviderRecoveryObservation | undefined> {
    validateOperationIdentity(identity);
    const identities = this.uniqueBindings((await this.bindings()).filter((candidate) => stableJson(candidate) === stableJson(identity)));
    if (identities.length !== 1) return undefined;
    try {
      const observed = await this.host.observeOperation(identities[0]!);
      return {
        outcome: observed.outcome,
        note: observed.summary,
        details: {
          provider: observed.provider,
          externalId: observed.externalId,
          effectDisposition: observed.effectDisposition
        }
      };
    } catch {
      return {
        outcome: "unresolved",
        note: "The configured provider operation could not be observed through its exact authenticated identity; no work was replayed.",
        details: { provider: identity.provider, externalId: identity.externalId, effectDisposition: "ambiguous" }
      };
    }
  }

  async observeBoundOperation(binding: OperationReconciliationBinding): Promise<OperationControllerObservation> {
    const identities = this.uniqueBindings((await this.bindings()).filter((identity) => providerIdentityMatchesBinding(identity, binding)));
    if (identities.length === 0) return { state: "not_owner", operationId: binding.operationId, summary: "No exact durable configured-provider identity owns this protected operation binding." };
    if (identities.length !== 1) return providerActive(binding, "More than one configured-provider identity claims this protected operation; terminal state remains ambiguous.");
    let observed: ConfiguredProviderOperationObservation;
    try { observed = await this.host.observeOperation(identities[0]!); }
    catch { return providerActive(binding, "The configured provider operation could not be observed through its exact authenticated identity; no work was replayed."); }
    if (observed.outcome === "unresolved") return providerActive(binding, observed.summary);
    return {
      state: "terminal",
      ...binding,
      status: observed.outcome === "committed" ? "completed" : observed.outcome,
      effectDisposition: observed.effectDisposition,
      summary: observed.summary
    };
  }

  /** Lets the provider host settle its own durable unknowns before exact operation observation. */
  async recoverAfterRestart(): Promise<void> {
    const roots = [...new Set((await this.bindings()).map((identity) => rootKey(identity.repositoryRoot)))];
    const identities = await this.bindings();
    for (const root of roots) {
      const repositoryRoot = identities.find((identity) => rootKey(identity.repositoryRoot) === root)?.repositoryRoot;
      if (!repositoryRoot) continue;
      await this.host.reconcile(repositoryRoot).catch(() => undefined);
    }
  }

  private dispatchIdentity(input: Parameters<ProviderCommandTransport["request"]>[0]): ConfiguredProviderOperationIdentity | undefined {
    const binding = input.trustedDispatch;
    if (!binding || !supportedProvider(binding.session.provider) || !commandAction(binding.action)
      || !providerRouteMatchesAction(input.routeId, binding.action, binding.session.provider)) return undefined;
    const externalId = this.recoveryExternalId({ routeId: input.routeId, operationId: binding.operationId, provider: binding.session.provider });
    if (!externalId) throw new Error("The configured provider effect lacks a host-known recovery identity.");
    const identity: ConfiguredProviderOperationIdentity = {
      operationId: binding.operationId,
      externalId,
      routeId: input.routeId,
      sessionId: binding.session.id,
      provider: binding.session.provider,
      action: binding.action,
      authorityId: binding.authority.id,
      targetSnapshotId: binding.target.id,
      repositoryRoot: binding.target.repositoryRoot
    };
    if (rootKey(input.repositoryRoot) !== rootKey(identity.repositoryRoot)) throw new Error("The configured provider transport root changed from its protected dispatch binding.");
    validateOperationIdentity(identity);
    return Object.freeze(identity);
  }

  private async claim(identity: ConfiguredProviderOperationIdentity): Promise<void> {
    await this.store.transaction(async (transaction) => {
      const existing = (await transaction.readEntries<JsonValue>())
        .filter((entry) => entry.kind === providerOperationBindingKind)
        .map((entry) => parseStoredProviderBinding(entry.payload).identity)
        .filter((candidate) => candidate.operationId === identity.operationId);
      if (existing.length === 0) {
        await transaction.append<StoredProviderOperationBinding>(providerOperationBindingKind, {
          schema: "sxsy-b122.configured-provider-operation-binding",
          version: 1,
          identity
        });
        return;
      }
      if (existing.length !== 1 || stableJson(existing[0]) !== stableJson(identity)) {
        throw new Error("The durable configured-provider operation ID is already bound to a different exact identity.");
      }
    });
  }

  private async bindings(): Promise<readonly ConfiguredProviderOperationIdentity[]> {
    return (await this.store.readEntries<JsonValue>())
      .filter((entry) => entry.kind === providerOperationBindingKind)
      .map((entry) => parseStoredProviderBinding(entry.payload).identity);
  }

  private uniqueBindings(identities: readonly ConfiguredProviderOperationIdentity[]): readonly ConfiguredProviderOperationIdentity[] {
    const unique = new Map<string, ConfiguredProviderOperationIdentity>();
    for (const identity of identities) unique.set(stableJson(identity), identity);
    return [...unique.values()];
  }

  private async cancel(identities: readonly ConfiguredProviderOperationIdentity[], reason: string): Promise<number> {
    let accepted = 0;
    for (const identity of identities) if ((await this.host.cancelOperation(identity, reason)).accepted) accepted += 1;
    return accepted;
  }
}

interface WorkflowContextBinding {
  readonly sessionId: string;
  readonly provider: ConfiguredProviderIdentity;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly head: string;
  readonly taskId: string;
  readonly planRevision: string;
}

interface WorkflowContextRequestEnvelope extends WorkflowContextBinding {
  readonly schema: "sxsy-b122.provider-workflow-context-observe";
  readonly version: 1;
  readonly requestNonce: string;
}

function workflowContextBinding(input: ConfiguredProviderWorkflowContextRequest): WorkflowContextBinding {
  const provider = requireProvider(input.session.provider);
  requireHostHandshake(input.session);
  if (!safeId(input.session.id) || !safeAdapterVersion(input.session.adapterVersion)
    || input.session.status === "unreachable" || input.session.status === "stale" || input.session.status === "unknown"
    || !input.session.capabilities.includes("registered") || !input.session.capabilities.includes("observable")) {
    throw new Error("Workflow-context observation requires one fresh exact Observable provider-host session.");
  }
  const targetSnapshotId = requireDigest(input.session.targetSnapshotId);
  const repositoryRoot = requireRoot(input.session.workspaceRoot);
  if (input.target.id !== targetSnapshotId || rootKey(input.target.repositoryRoot) !== rootKey(repositoryRoot)
    || !safeBranch(input.target.branch) || !sha40(input.target.head)
    || !boundedIdentity(input.session.taskId) || !boundedIdentity(input.session.planRevision)) {
    throw new Error("The provider workflow-context request identity is invalid or inconsistently bound.");
  }
  return Object.freeze({
    sessionId: input.session.id,
    provider,
    targetSnapshotId,
    repositoryRoot,
    branch: input.target.branch,
    head: input.target.head,
    taskId: input.session.taskId,
    planRevision: input.session.planRevision
  });
}

function normalizeWorkflowContextResponse(value: Record<string, unknown>, request: WorkflowContextRequestEnvelope, adapterVersion: string): ConfiguredProviderWorkflowContextObservation {
  const keys = [
    "schema", "version", "sessionId", "provider", "targetSnapshotId", "repositoryRoot", "branch", "head", "taskId", "planRevision", "requestNonce",
    "contextId", "sourceRevision", "plannedFiles", "resources", "dependencies", "diffDigest", "evidence", "pendingDecisions", "pendingRequest",
    "adapter", "contextDigest", "observedAt", "envelopeDigest"
  ];
  if (!exact(value, keys) || value.schema !== "sxsy-b122.provider-workflow-context-observation" || value.version !== 1
    || value.sessionId !== request.sessionId || value.provider !== request.provider || value.targetSnapshotId !== request.targetSnapshotId
    || rootKey(value.repositoryRoot) !== rootKey(request.repositoryRoot) || value.branch !== request.branch || value.head !== request.head
    || value.taskId !== request.taskId || value.planRevision !== request.planRevision || value.requestNonce !== request.requestNonce
    || !safeId(value.contextId) || !Number.isSafeInteger(value.sourceRevision) || (value.sourceRevision as number) < 1
    || !relativePathList(value.plannedFiles, 512) || !boundedStringList(value.resources, 128, 256)
    || !boundedStringList(value.dependencies, 512, 512) || !digest(value.diffDigest) || !digest(value.contextDigest)
    || !timestampString(value.observedAt) || !digest(value.envelopeDigest)) throw rejected();
  const evidence = normalizeCoordinatorEvidence(value.evidence, request);
  const pendingDecisions = normalizePendingDecisions(value.pendingDecisions);
  const pendingRequest = normalizePendingRequest(value.pendingRequest, request, evidence.plan.digest);
  const adapter = normalizeAdapter(value.adapter, adapterVersion);
  const planned = new Set(value.plannedFiles.map(pathKey));
  const planFiles = new Set(evidence.plan.steps.flatMap((step) => step.ownedFiles).map(pathKey));
  if (planned.size !== planFiles.size || [...planned].some((entry) => !planFiles.has(entry)) || value.diffDigest !== evidence.diff.digest) throw rejected();
  const contextMaterial = Object.freeze({
    contextId: value.contextId,
    sourceRevision: value.sourceRevision as number,
    sessionId: request.sessionId,
    provider: request.provider,
    targetSnapshotId: request.targetSnapshotId,
    repositoryRoot: request.repositoryRoot,
    branch: request.branch,
    head: request.head,
    taskId: request.taskId,
    planRevision: request.planRevision,
    plannedFiles: Object.freeze([...value.plannedFiles]),
    resources: Object.freeze([...value.resources]),
    dependencies: Object.freeze([...value.dependencies]),
    diffDigest: value.diffDigest,
    evidence,
    pendingDecisions,
    pendingRequest,
    adapter
  });
  if (sha256(stableJson(contextMaterial)) !== value.contextDigest) throw rejected();
  const unsigned = Object.freeze({
    schema: "sxsy-b122.provider-workflow-context-observation" as const,
    version: 1 as const,
    ...contextMaterial,
    observedAt: value.observedAt,
    requestNonce: request.requestNonce,
    contextDigest: value.contextDigest
  });
  if (sha256(stableJson(unsigned)) !== value.envelopeDigest) throw rejected();
  return Object.freeze({ ...unsigned, envelopeDigest: value.envelopeDigest });
}

function normalizeCoordinatorEvidence(value: unknown, request: WorkflowContextBinding): CoordinatorEvidenceBundle {
  if (!record(value) || !exact(value, ["contextDigest", "instructions", "plan", "documentation", "diff", "files", "tests"]) || !digest(value.contextDigest)) throw rejected();
  const instructions = evidenceReferenceList(value.instructions, 1, 64, false);
  const plan = normalizePlan(value.plan, request);
  const documentation = evidenceReferenceList(value.documentation, 1, 256, false);
  const diff = normalizeEvidenceReference(value.diff, false);
  const files = evidenceReferenceList(value.files, 1, 512, false);
  const tests = evidenceReferenceList(value.tests, 1, 256, true) as readonly WorkflowTestEvidence[];
  const material = { instructions, plan, documentation, diff, files, tests };
  if (sha256(stableJson(material)) !== value.contextDigest) throw rejected();
  return Object.freeze({ contextDigest: value.contextDigest, ...material });
}

function normalizePlan(value: unknown, request: WorkflowContextBinding): ExistingPlanBinding {
  if (!record(value) || !exact(value, ["digest", "revision", "originSessionId", "taskId", "objective", "steps", "decisions", "expectedTargetTransition"])
    || !digest(value.digest) || value.revision !== request.planRevision || value.originSessionId !== request.sessionId || value.taskId !== request.taskId
    || !safeText(value.objective, 16_384) || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 256
    || !Array.isArray(value.decisions) || value.decisions.length > 512) throw rejected();
  const steps: PlanStepArtifact[] = value.steps.map((step) => {
    if (!record(step) || !exact(step, ["id", "summary", "ownedFiles", "dependencies", "status"]) || !safeId(step.id)
      || !safeText(step.summary, 16_384) || !relativePathList(step.ownedFiles, 512) || !identifierList(step.dependencies, 256)
      || (step.status !== "proposed" && step.status !== "approved" && step.status !== "completed" && step.status !== "blocked")) throw rejected();
    return Object.freeze({ id: step.id, summary: step.summary.trim(), ownedFiles: Object.freeze([...step.ownedFiles]), dependencies: Object.freeze([...step.dependencies]), status: step.status });
  });
  if (new Set(steps.map((step) => step.id)).size !== steps.length) throw rejected();
  const known = new Set(steps.map((step) => step.id));
  if (steps.some((step) => step.dependencies.some((dependency) => dependency === step.id || !known.has(dependency)))) throw rejected();
  if (!value.decisions.every((entry) => safeText(entry, 16_384)) || new Set(value.decisions).size !== value.decisions.length) throw rejected();
  const expectedTargetTransition = normalizeReviewedTargetTransition(value.expectedTargetTransition, request.targetSnapshotId);
  const normalized = Object.freeze({
    digest: value.digest,
    revision: value.revision,
    originSessionId: value.originSessionId,
    taskId: value.taskId,
    objective: value.objective.trim(),
    steps: Object.freeze(steps),
    decisions: Object.freeze(value.decisions.map((entry) => (entry as string).trim())),
    expectedTargetTransition
  });
  const { digest: _digest, ...material } = normalized;
  if (sha256(stableJson(material)) !== normalized.digest) throw rejected();
  return normalized;
}

function normalizeReviewedTargetTransition(value: unknown, beforeTargetSnapshotId: string): ExistingPlanBinding["expectedTargetTransition"] {
  if (!record(value) || !exact(value, ["beforeTargetSnapshotId", "expectedAfterTargetSnapshotId", "expectation"])
    || value.beforeTargetSnapshotId !== beforeTargetSnapshotId || !digest(value.expectedAfterTargetSnapshotId)
    || (value.expectation !== "unchanged" && value.expectation !== "changed")
    || ((value.expectation === "unchanged") !== (value.expectedAfterTargetSnapshotId === beforeTargetSnapshotId))) throw rejected();
  return Object.freeze({ beforeTargetSnapshotId, expectedAfterTargetSnapshotId: value.expectedAfterTargetSnapshotId, expectation: value.expectation });
}

function evidenceReferenceList(value: unknown, minimum: number, maximum: number, testEvidence: boolean): readonly (WorkflowEvidenceReference | WorkflowTestEvidence)[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw rejected();
  const normalized = value.map((entry) => normalizeEvidenceReference(entry, testEvidence));
  if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length) throw rejected();
  return Object.freeze(normalized);
}

function normalizeEvidenceReference(value: unknown, testEvidence: boolean): WorkflowEvidenceReference | WorkflowTestEvidence {
  const keys = testEvidence ? ["id", "digest", "source", "summary", "status"] : ["id", "digest", "source", "summary"];
  if (!record(value) || !exact(value, keys) || !safeId(value.id) || !digest(value.digest)
    || (value.source !== "protected_context" && value.source !== "repository" && value.source !== "target_snapshot" && value.source !== "receipt")
    || !safeText(value.summary, 16_384) || (testEvidence && value.status !== "passed" && value.status !== "failed" && value.status !== "unavailable"
      && value.status !== "incomplete" && value.status !== "assumed" && value.status !== "not_run")) throw rejected();
  const base = { id: value.id, digest: value.digest, source: value.source, summary: value.summary.trim() } as WorkflowEvidenceReference;
  return testEvidence ? Object.freeze({ ...base, status: value.status as WorkflowTestEvidence["status"] }) : Object.freeze(base);
}

function normalizePendingDecisions(value: unknown): readonly PendingDecision[] {
  if (!Array.isArray(value) || value.length > 128) throw rejected();
  const normalized = value.map((entry) => {
    if (!record(entry) || !exact(entry, ["id", "question", "context"]) || !safeId(entry.id)
      || !safeText(entry.question, 4_096) || !safeText(entry.context, 16_384)) throw rejected();
    return Object.freeze({ id: entry.id, question: entry.question.trim(), context: entry.context.trim() });
  });
  if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length) throw rejected();
  return Object.freeze(normalized);
}

function normalizePendingRequest(value: unknown, request: WorkflowContextBinding, planDigest: string): AuthorityPendingRequest | null {
  if (value === null) return null;
  if (!record(value) || !exact(value, ["requestId", "targetSnapshotId", "planRevision", "planDigest", "action"]) || !safeId(value.requestId)
    || value.targetSnapshotId !== request.targetSnapshotId || value.planRevision !== request.planRevision || value.planDigest !== planDigest || !commandAction(value.action)) throw rejected();
  return Object.freeze({ requestId: value.requestId, targetSnapshotId: value.targetSnapshotId, planRevision: value.planRevision, planDigest: value.planDigest, action: value.action });
}

function normalizeAdapter(value: unknown, expectedVersion: string): Readonly<{ id: string; version: string; moduleSha256: string }> {
  if (!record(value) || !exact(value, ["id", "version", "moduleSha256"]) || !safeId(value.id) || !safeAdapterVersion(value.version)
    || value.version !== expectedVersion || !digest(value.moduleSha256)) throw rejected();
  return Object.freeze({ id: value.id, version: value.version, moduleSha256: value.moduleSha256 });
}

class ProviderObservationBoundary {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly deadlineAt: number;
  private readonly caller?: AbortSignal;
  private readonly onCallerAbort = () => this.controller.abort();

  constructor(caller: AbortSignal | undefined, timeoutMs: number) {
    this.signal = this.controller.signal;
    this.deadlineAt = Date.now() + timeoutMs;
    this.caller = caller;
    if (caller?.aborted) this.controller.abort();
    else caller?.addEventListener("abort", this.onCallerAbort, { once: true });
    this.timer = setTimeout(() => this.controller.abort(), timeoutMs);
    this.timer.unref?.();
  }

  wait<T>(pending: Promise<T>): Promise<T> {
    pending.then(() => undefined, () => undefined);
    if (this.signal.aborted) return Promise.reject(observationUnavailable());
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => this.signal.removeEventListener("abort", onAbort);
      const onAbort = () => { cleanup(); reject(observationUnavailable()); };
      this.signal.addEventListener("abort", onAbort, { once: true });
      pending.then((value) => {
        cleanup();
        if (Date.now() >= this.deadlineAt) { this.controller.abort(); reject(observationUnavailable()); }
        else resolve(value);
      }, (error) => { cleanup(); reject(error); });
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.caller?.removeEventListener("abort", this.onCallerAbort);
    this.controller.abort();
  }
}

function responseRecord(result: Awaited<ReturnType<ProviderCommandTransport["request"]>>, label: string): Record<string, unknown> {
  if (result.outcome !== "passed" || !result.body || result.body.byteLength > 64 * 1024) throw new Error(`The exact ${label} route was unavailable.`);
  let value: unknown;
  try { value = JSON.parse(Buffer.from(result.body).toString("utf8")); } catch { throw rejected(); }
  if (!record(value)) throw rejected();
  return value;
}
function parseStoredProviderBinding(value: JsonValue): StoredProviderOperationBinding {
  if (!record(value) || !exact(value, ["schema", "version", "identity"])
    || value.schema !== "sxsy-b122.configured-provider-operation-binding" || value.version !== 1 || !record(value.identity)
    || !exact(value.identity, ["operationId", "externalId", "routeId", "sessionId", "provider", "action", "authorityId", "targetSnapshotId", "repositoryRoot"])) {
    throw new Error("The authenticated configured-provider operation binding is malformed.");
  }
  const identity = value.identity as unknown as ConfiguredProviderOperationIdentity;
  validateOperationIdentity(identity);
  return Object.freeze({ schema: "sxsy-b122.configured-provider-operation-binding", version: 1, identity: Object.freeze({ ...identity }) });
}
function bindingFromProviderIdentity(identity: ConfiguredProviderOperationIdentity): OperationReconciliationBinding {
  return {
    operationId: identity.operationId,
    action: identity.action,
    targetSnapshotId: identity.targetSnapshotId,
    repositoryRoot: identity.repositoryRoot,
    sessionId: identity.sessionId,
    authorityId: identity.authorityId
  };
}
function providerIdentityMatchesBinding(identity: ConfiguredProviderOperationIdentity, binding: OperationReconciliationBinding): boolean {
  return identity.operationId === binding.operationId && identity.action === binding.action
    && identity.targetSnapshotId === binding.targetSnapshotId && rootKey(identity.repositoryRoot) === rootKey(binding.repositoryRoot)
    && identity.sessionId === binding.sessionId && identity.authorityId === binding.authorityId;
}
function providerActive(binding: OperationReconciliationBinding, summary: string): Extract<OperationControllerObservation, { state: "active" }> {
  return { state: "active", ...binding, effectDisposition: "ambiguous", summary };
}
function validateOperationIdentity(value: ConfiguredProviderOperationIdentity): void {
  if (!safeId(value.operationId) || !safeId(value.externalId) || !safeRoute(value.routeId) || !safeId(value.sessionId) || !supportedProvider(value.provider)
    || !commandAction(value.action) || !providerRouteMatchesAction(value.routeId, value.action, value.provider)
    || !safeId(value.authorityId) || !digest(value.targetSnapshotId) || !absoluteRoot(value.repositoryRoot)) throw new Error("The exact provider operation identity is invalid.");
}
function sameOperation(value: Record<string, unknown>, expected: ConfiguredProviderOperationIdentity): boolean { return value.operationId === expected.operationId && value.externalId === expected.externalId && value.routeId === expected.routeId && value.sessionId === expected.sessionId && value.provider === expected.provider && value.action === expected.action && value.authorityId === expected.authorityId && value.targetSnapshotId === expected.targetSnapshotId && rootKey(value.repositoryRoot) === rootKey(expected.repositoryRoot); }
function requireHostHandshake(session: ManagedSession): void { if (!hasHostHandshake(session)) throw new Error("The managed session lacks an exact provider-host handshake binding."); }
function hasHostHandshake(session: ManagedSession): boolean { return session.metadata["sxsy-b122.providerHandshake"] === "exact-route-v1" && session.metadata["sxsy-b122.providerHandshakeTarget"] === session.targetSnapshotId; }
function requireProvider(value: ManagedSession["provider"]): ConfiguredProviderIdentity { if (!supportedProvider(value)) throw new Error("The provider host supports only Claude and Codex."); return value; }
function supportedProvider(value: ManagedSession["provider"]): value is ConfiguredProviderIdentity { return value === "claude" || value === "codex"; }
function requireRoot(value: string | undefined): string { if (!absoluteRoot(value)) throw new Error("The exact provider repository root is invalid."); return value; }
function requireDigest(value: string | undefined): string { if (!digest(value)) throw new Error("The exact provider TargetSnapshot is invalid."); return value; }
function absoluteRoot(value: unknown): value is string { return typeof value === "string" && value.length <= 4_096 && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && !/[\0\r\n]/.test(value); }
function safeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value); }
function safeRoute(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9_.-]{0,127}$/.test(value); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function sha40(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
function rootKey(value: unknown): string { return typeof value === "string" ? value.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase() : ""; }
function pathKey(value: unknown): string { return typeof value === "string" ? value.replaceAll("\\", "/").toLowerCase() : ""; }
function summary(value: unknown, maximum = 512): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value); }
function boundedIdentity(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value); }
function safeBranch(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\0\r\n~^:?*\\\[]/.test(value); }
function safeAdapterVersion(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_.+-]{1,80}$/.test(value); }
function safeText(value: unknown, maximumLength: number): value is string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > maximumLength || value.includes("\0")) return false;
  return redactText(value.trim()) === value.trim();
}
function boundedStringList(value: unknown, maximumItems: number, maximumLength: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= maximumItems && new Set(value).size === value.length
    && value.every((entry) => typeof entry === "string" && entry.trim().length > 0 && entry.length <= maximumLength && !/[\0\r\n]/.test(entry));
}
function identifierList(value: unknown, maximumItems: number): value is readonly string[] { return Array.isArray(value) && value.length <= maximumItems && new Set(value).size === value.length && value.every(safeId); }
function relativePathList(value: unknown, maximumItems: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= maximumItems && new Set(value.map(pathKey)).size === value.length && value.every((entry) => {
    if (typeof entry !== "string" || entry.length < 1 || entry.length > 512 || /[\0\r\n]/.test(entry) || /^(?:[A-Za-z]:[\\/]|\\\\|[\\/])/.test(entry)) return false;
    return entry.replaceAll("\\", "/").split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  });
}
function commandAction(value: unknown): value is CommandAction { return typeof value === "string" && (commandActionIds as readonly string[]).includes(value); }
function sessionStatus(value: unknown): value is SessionStatus { return value === "running" || value === "verified_blocked" || value === "verified_finished" || value === "unreachable" || value === "stale" || value === "unknown"; }
function capabilityList(value: unknown): value is readonly Capability[] { return Array.isArray(value) && value.length <= 4 && new Set(value).size === value.length && value.every((entry) => entry === "registered" || entry === "observable" || entry === "controllable" || entry === "mediated"); }
function operationOutcome(value: unknown): value is ConfiguredProviderOperationObservation["outcome"] { return value === "committed" || value === "failed" || value === "cancelled" || value === "unresolved"; }
function providerRouteMatchesAction(routeId: string, action: CommandAction, provider: ConfiguredProviderIdentity): boolean {
  return routeId === `provider.${action}` || (action === "reanchor" && routeId === `provider.reanchor.${provider}`);
}
function effectDisposition(value: unknown): value is EffectDisposition { return value === "not_started" || value === "committed" || value === "ambiguous" || value === "compensated"; }
function consistentOperationEffect(outcome: unknown, disposition: unknown): boolean {
  if (outcome === "unresolved") return disposition === "ambiguous";
  if (outcome === "committed") return disposition === "committed";
  return (outcome === "failed" || outcome === "cancelled") && (disposition === "not_started" || disposition === "committed" || disposition === "compensated");
}
function boundedCount(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000; }
function timestamp(value: string): string { if (!Number.isFinite(Date.parse(value))) throw new Error("The provider-host client clock is invalid."); return value; }
function timestampString(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function boundedDeadline(value: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) throw new Error("The provider workflow-context observation deadline is invalid."); return value; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  const allowed = new Set(keys);
  return actual.length === keys.length && actual.every((key) => allowed.has(key)) && keys.every((key) => Object.hasOwn(value, key));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function rejected(): Error { return new Error("The provider host returned malformed or inconsistently bound evidence."); }
function observationUnavailable(): Error { return new Error("The provider workflow-context observation was cancelled or exceeded its deadline."); }
function workflowContextKey(value: WorkflowContextBinding): string {
  return sha256(stableJson({ provider: value.provider, sessionId: value.sessionId, targetSnapshotId: value.targetSnapshotId, repositoryRoot: rootKey(value.repositoryRoot), taskId: value.taskId, planRevision: value.planRevision }));
}
