import type { Capability, ManagedSession, SessionStatus } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { companionBridgeVersion, type CompanionRequest, type CompanionResponse } from "./bridge.ts";
import { CompanionService } from "./service.ts";
import type { CompanionRequestContext } from "./stdio.ts";

const sessionMutationMethods = new Set([
  "session.register",
  "terminal.register",
  "debug.register",
  "session.adopt",
  "terminal.adopt",
  "session.status",
  "session.heartbeat",
  "provider.handshake"
]);

/**
 * Host-owned persistence boundary for the local companion. It restores only
 * records previously written through the protected SessionRegistry, and it
 * treats a failed write as a terminal condition rather than allowing an
 * in-memory session to look durable.
 */
export class DurableCompanionEndpoint {
  private readonly service: CompanionService;
  private readonly registry: SessionRegistry;
  private readonly initialized: Promise<void>;
  private initializationFailed = false;
  private persistenceFailed = false;
  private readonly startupRecovery?: () => Promise<unknown>;
  private readonly refreshSessions?: () => Promise<readonly ManagedSession[]>;

  constructor(service: CompanionService, registry: SessionRegistry, options: { readonly startupRecovery?: () => Promise<unknown>; readonly refreshSessions?: () => Promise<readonly ManagedSession[]> } = {}) {
    this.service = service;
    this.registry = registry;
    this.startupRecovery = options.startupRecovery;
    this.refreshSessions = options.refreshSessions;
    // Capture startup failure internally so construction never creates an
    // unhandled rejection. `ready`, `handle`, and `listSessions` expose the
    // same fail-closed state to their callers.
    this.initialized = this.hydrate().catch(() => {
      this.initializationFailed = true;
    });
  }

  /** Resolves only after protected sessions have been installed in the service. */
  async ready(): Promise<void> {
    await this.initialized;
    this.assertHealthy();
  }

  /**
   * Routes a request only after hydration. Every successful session lifecycle
   * mutation is synchronously appended to the protected registry before its
   * successful response is returned to the caller.
   */
  async handle(request: CompanionRequest, context?: CompanionRequestContext): Promise<CompanionResponse> {
    await this.initialized;
    if (this.initializationFailed || this.persistenceFailed) return this.failClosed(request);
    if (this.refreshSessions) {
      try { for (const session of await this.refreshSessions()) this.service.installTrustedSession(session); }
      catch { this.persistenceFailed = true; return this.failClosed(request); }
    }

    let response: CompanionResponse;
    try {
      response = await this.service.handle(request, context);
    } catch {
      return this.failClosed(request);
    }
    if (!response.ok || !sessionMutationMethods.has(request.method)) return response;

    if (!isManagedSession(response.result)) {
      this.persistenceFailed = true;
      return this.failClosed(request);
    }
    try {
      const persisted = await this.registry.upsert(response.result);
      return { ...response, result: persisted };
    } catch {
      // The service may have updated its in-memory map, but it is no longer
      // reachable through this endpoint. Continuing would falsely imply the
      // change survived a restart.
      this.persistenceFailed = true;
      return this.failClosed(request);
    }
  }

  /** Returns the hydrated/current service view only while the endpoint is healthy. */
  async listSessions(): Promise<readonly ManagedSession[]> {
    await this.ready();
    return this.service.listSessions();
  }

  private async hydrate(): Promise<void> {
    const sessions = await this.registry.list();
    for (const session of sessions) this.service.installTrustedSession(session);
    // Startup recovery only probes durable records and never reruns a provider
    // side effect. A failed probe makes the endpoint unavailable rather than
    // guessing a recovery outcome.
    await this.startupRecovery?.();
    if (this.refreshSessions) for (const session of await this.refreshSessions()) this.service.installTrustedSession(session);
  }

  private assertHealthy(): void {
    if (this.initializationFailed) throw new DurableCompanionEndpointError("The protected session registry could not be hydrated.");
    if (this.persistenceFailed) throw new DurableCompanionEndpointError("The protected session registry could not persist a lifecycle mutation.");
  }

  private failClosed(request: CompanionRequest): CompanionResponse {
    return {
      version: companionBridgeVersion,
      id: request.id,
      ok: false,
      error: {
        code: "companion_unavailable",
        message: "The SXSY-B122 companion persistence boundary is unavailable; no session lifecycle request was accepted."
      }
    };
  }
}

export class DurableCompanionEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurableCompanionEndpointError";
  }
}

function isManagedSession(value: unknown): value is ManagedSession {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !isProvider(value.provider)
    || !isSurface(value.surface)
    || !Array.isArray(value.capabilities)
    || !value.capabilities.every(isCapability)
    || !isSessionStatus(value.status)
    || !Array.isArray(value.plannedFiles)
    || !value.plannedFiles.every((item) => typeof item === "string")
    || typeof value.lastHeartbeat !== "string"
    || typeof value.adapterVersion !== "string"
    || !isStringRecord(value.metadata)) return false;
  return optionalString(value.workspaceRoot)
    && optionalString(value.targetSnapshotId)
    && optionalString(value.taskId)
    && optionalString(value.planRevision);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCapability(value: unknown): value is Capability {
  return value === "registered" || value === "observable" || value === "controllable" || value === "mediated";
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return value === "running" || value === "verified_blocked" || value === "verified_finished" || value === "unreachable" || value === "stale" || value === "unknown";
}

function isProvider(value: unknown): value is ManagedSession["provider"] {
  return value === "claude" || value === "codex" || value === "generic" || value === "voice";
}

function isSurface(value: unknown): value is ManagedSession["surface"] {
  return value === "vscode_terminal" || value === "vscode_window" || value === "desktop" || value === "browser" || value === "bridge";
}
