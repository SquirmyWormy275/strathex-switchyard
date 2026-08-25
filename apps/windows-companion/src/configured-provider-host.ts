import type { Capability, ManagedSession, SessionStatus } from "../../../packages/control-plane/src/contracts.ts";
import type { ProviderCommandTransport } from "./remote-adapters.ts";

export type ConfiguredProviderIdentity = Extract<ManagedSession["provider"], "claude" | "codex">;

export interface ConfiguredProviderOperationIdentity {
  readonly operationId: string;
  readonly externalId: string;
  readonly routeId: string;
  readonly sessionId: string;
  readonly provider: ConfiguredProviderIdentity;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
}

export interface ConfiguredProviderOperationObservation extends ConfiguredProviderOperationIdentity {
  readonly outcome: "committed" | "failed" | "cancelled" | "unresolved";
  readonly summary: string;
}

export interface ConfiguredProviderCancellationAcknowledgement {
  readonly operationId: string;
  readonly externalId: string;
  readonly sessionId: string;
  readonly provider: ConfiguredProviderIdentity;
  readonly targetSnapshotId: string;
  readonly accepted: boolean;
  readonly summary: string;
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

/**
 * Read-only/cancellation client for the separately packaged provider host.
 * Every request carries the complete provider/session/target/operation binding;
 * no route, external ID, or target is derived from provider output.
 */
export class ConfiguredProviderHostClient {
  private readonly network: ProviderCommandTransport;
  private readonly now: () => string;

  constructor(network: ProviderCommandTransport, now: () => string = () => new Date().toISOString()) {
    this.network = network;
    this.now = now;
  }

  recoveryExternalId(input: Readonly<{ routeId: string; operationId: string; provider: ManagedSession["provider"] }>): string | undefined {
    return supportedProvider(input.provider) && safeId(input.operationId) && safeRoute(input.routeId) && (input.routeId.startsWith("provider.") || input.routeId.startsWith("automation."))
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

  async observeOperation(identity: ConfiguredProviderOperationIdentity, signal?: AbortSignal): Promise<ConfiguredProviderOperationObservation> {
    validateOperationIdentity(identity);
    const result = await this.network.request({
      routeId: `provider.observe-operation.${identity.provider}`,
      repositoryRoot: identity.repositoryRoot,
      body: JSON.stringify({ schema: "sxsy-b122.provider-operation-observe", version: 1, ...identity }),
      ...(signal ? { signal } : {})
    });
    const value = responseRecord(result, "provider operation observation");
    const keys = ["schema", "version", "operationId", "externalId", "routeId", "sessionId", "provider", "targetSnapshotId", "repositoryRoot", "outcome", "summary"];
    if (!exact(value, keys) || value.schema !== "sxsy-b122.provider-operation-observation" || value.version !== 1 || !sameOperation(value, identity)
      || !operationOutcome(value.outcome) || !summary(value.summary)) throw rejected();
    return Object.freeze({ ...identity, outcome: value.outcome, summary: value.summary });
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
    const keys = ["schema", "version", "operationId", "externalId", "sessionId", "provider", "targetSnapshotId", "accepted", "summary"];
    if (!exact(value, keys) || value.schema !== "sxsy-b122.provider-cancellation-ack" || value.version !== 1
      || value.operationId !== identity.operationId || value.externalId !== identity.externalId || value.sessionId !== identity.sessionId
      || value.provider !== identity.provider || value.targetSnapshotId !== identity.targetSnapshotId || typeof value.accepted !== "boolean" || !summary(value.summary)) throw rejected();
    return Object.freeze({ operationId: identity.operationId, externalId: identity.externalId, sessionId: identity.sessionId, provider: identity.provider, targetSnapshotId: identity.targetSnapshotId, accepted: value.accepted, summary: value.summary });
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

function responseRecord(result: Awaited<ReturnType<ProviderCommandTransport["request"]>>, label: string): Record<string, unknown> {
  if (result.outcome !== "passed" || !result.body || result.body.byteLength > 64 * 1024) throw new Error(`The exact ${label} route was unavailable.`);
  let value: unknown;
  try { value = JSON.parse(Buffer.from(result.body).toString("utf8")); } catch { throw rejected(); }
  if (!record(value)) throw rejected();
  return value;
}
function validateOperationIdentity(value: ConfiguredProviderOperationIdentity): void {
  if (!safeId(value.operationId) || !safeId(value.externalId) || !safeRoute(value.routeId) || !safeId(value.sessionId) || !supportedProvider(value.provider) || !digest(value.targetSnapshotId) || !absoluteRoot(value.repositoryRoot)) throw new Error("The exact provider operation identity is invalid.");
}
function sameOperation(value: Record<string, unknown>, expected: ConfiguredProviderOperationIdentity): boolean { return value.operationId === expected.operationId && value.externalId === expected.externalId && value.routeId === expected.routeId && value.sessionId === expected.sessionId && value.provider === expected.provider && value.targetSnapshotId === expected.targetSnapshotId && rootKey(value.repositoryRoot) === rootKey(expected.repositoryRoot); }
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
function rootKey(value: unknown): string { return typeof value === "string" ? value.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase() : ""; }
function summary(value: unknown, maximum = 512): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value); }
function sessionStatus(value: unknown): value is SessionStatus { return value === "running" || value === "verified_blocked" || value === "verified_finished" || value === "unreachable" || value === "stale" || value === "unknown"; }
function capabilityList(value: unknown): value is readonly Capability[] { return Array.isArray(value) && value.length <= 4 && new Set(value).size === value.length && value.every((entry) => entry === "registered" || entry === "observable" || entry === "controllable" || entry === "mediated"); }
function operationOutcome(value: unknown): value is ConfiguredProviderOperationObservation["outcome"] { return value === "committed" || value === "failed" || value === "cancelled" || value === "unresolved"; }
function boundedCount(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000; }
function timestamp(value: string): string { if (!Number.isFinite(Date.parse(value))) throw new Error("The provider-host client clock is invalid."); return value; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function rejected(): Error { return new Error("The provider host returned malformed or inconsistently bound evidence."); }
