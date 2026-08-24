import { assignmentFor, controls, type Control, type Modifier } from "../../../packages/protocol/src/b122.ts";
import { commandActionIds, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type {
  AuditEvent,
  Capability,
  CommandRequest,
  CommandResult,
  ManagedSession,
  SessionStatus
} from "../../../packages/control-plane/src/contracts.ts";
import {
  companionBridgeVersion,
  isRecord,
  type CompanionError,
  type CompanionRequest,
  type CompanionResponse,
  type DispatchPayload,
  type ConfirmationRequestPayload,
  type OperationCancellationPayload,
  type SessionAdoptionPayload,
  type SessionHeartbeatPayload,
  type SessionRegistrationPayload,
  type SessionStatusPayload
} from "./bridge.ts";

/**
 * A mediator can be attached after it has a verified execution boundary.  The
 * default service deliberately has no executor, so a local JSON request can
 * never become a shell, Git, credential, network, or prompt operation.
 */
export interface MediatedCommandExecutor {
  execute(request: CommandRequest): Promise<CommandResult> | CommandResult;
}

/** Optional runtime capability; a transport cannot fabricate this route. */
export interface CancellableMediatedCommandExecutor extends MediatedCommandExecutor {
  cancelOperation(operationId: string, reason: string): Promise<CommandResult> | CommandResult;
}

export interface ConfirmationCapableMediatedCommandExecutor extends MediatedCommandExecutor {
  requestConfirmation(request: Readonly<{ action: CommandAction; sessionId?: string; authorityId?: string; reason: string }>): Promise<Readonly<{ status: string; summary: string; token?: string; expiresAt?: string }>>;
}

export interface CompanionServiceOptions {
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly executor?: MediatedCommandExecutor;
  /**
   * Only a trusted adapter handshake may provide this callback.  A plain
   * JSON-lines registration is deliberately normalized to Registered.
   */
  readonly verifyCapabilities?: (session: ManagedSession) => readonly Capability[];
}

/**
 * Companion-facing session and intent service. It is a real local control
 * plane endpoint, but intentionally not an execution boundary on its own.
 * Persistent stores, receipts, and brokers attach through the executor rather
 * than by making this transport trust client-provided state.
 */
export class CompanionService {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly adoptionKeys = new Map<string, string>();
  private readonly audit: AuditEvent[] = [];
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly executor?: MediatedCommandExecutor;
  private readonly verifyCapabilities?: (session: ManagedSession) => readonly Capability[];

  constructor(options: CompanionServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => `audit-${crypto.randomUUID()}`);
    this.executor = options.executor;
    this.verifyCapabilities = options.verifyCapabilities;
  }

  async handle(request: CompanionRequest): Promise<CompanionResponse> {
    if (request.version !== companionBridgeVersion) {
      return this.failure(request.id, "unsupported_version", "Unsupported SXSY-B122 companion protocol version.");
    }

    try {
      switch (request.method) {
        case "ping":
          return this.success(request.id, { state: "ready", version: companionBridgeVersion });
        case "session.register":
        case "terminal.register":
        case "debug.register":
          return this.success(request.id, this.register(this.requireRegistration(request.payload)));
        case "session.adopt":
        case "terminal.adopt":
          return this.success(request.id, this.adopt(this.requireAdoption(request.payload)));
        case "session.status":
          return this.success(request.id, this.setStatus(this.requireStatus(request.payload)));
        case "session.heartbeat":
          return this.success(request.id, this.heartbeat(this.requireHeartbeat(request.payload)));
        case "session.list":
          return this.success(request.id, this.listSessions());
        case "command.dispatch":
          return this.success(request.id, { command: await this.dispatch(this.requireDispatch(request.payload)) });
        case "operation.cancel":
          return this.success(request.id, { command: await this.cancelOperation(this.requireCancellation(request.payload)) });
        case "confirmation.request":
          return this.success(request.id, { confirmation: await this.requestConfirmation(this.requireConfirmation(request.payload)) });
        default:
          return this.failure(request.id, "unknown_method", "Unknown SXSY-B122 companion method.");
      }
    } catch (error) {
      if (error instanceof CompanionServiceError) return this.failure(request.id, error.code, error.message);
      // Never send a stack, input, terminal output, or secret-bearing error across the bridge.
      return this.failure(request.id, "invalid_request", "The local companion rejected this request.");
    }
  }

  listSessions(): readonly ManagedSession[] {
    return [...this.sessions.values()].map((session) => cloneSession(session));
  }

  /**
   * Restores a session only from the host-owned protected registry during
   * companion startup. JSON-lines clients never call this method and cannot
   * preserve or invent a capability by re-registering a known ID.
   */
  installTrustedSession(session: ManagedSession): void {
    const trusted = cloneSession(session);
    if (!trusted.capabilities.includes("registered")) {
      throw new CompanionServiceError("capability_denied", "A restored session must have a verified Registered capability.");
    }
    this.sessions.set(trusted.id, trusted);
    const adoptionKey = trusted.metadata["sxsy-b122.adoptionKey"];
    if (adoptionKey) this.adoptionKeys.set(adoptionKey, trusted.id);
  }

  listAuditEvents(): readonly AuditEvent[] {
    return this.audit.map((event) => ({ ...event }));
  }

  private register(payload: SessionRegistrationPayload): ManagedSession {
    const incoming = parseManagedSession(payload.session);
    const existing = this.sessions.get(incoming.id);
    const verifiedCapabilities = this.verifyCapabilities
      ? normalizeCapabilities(this.verifyCapabilities(incoming))
      : ["registered"] as const;
    const capabilities: readonly Capability[] = verifiedCapabilities.includes("registered")
      ? verifiedCapabilities
      : ["registered", ...verifiedCapabilities] as readonly Capability[];
    const previousMetadata = existing?.metadata ?? {};
    const metadata = {
      ...previousMetadata,
      ...incoming.metadata,
      "sxsy-b122.registration": "registered"
    };
    const next: ManagedSession = {
      ...incoming,
      capabilities,
      // A JSON caller may identify a surface but cannot assert that it is
      // observable, controllable, mediated, running, blocked, or finished.
      // Re-registration deliberately resets rather than retaining a prior
      // trusted capability by a known session ID.
      status: "unknown",
      lastHeartbeat: this.now(),
      metadata
    };
    this.sessions.set(next.id, next);
    this.record("session.register", "completed", `Registered ${next.surface} session without implying mediation.`, next.id);
    return cloneSession(next);
  }

  private adopt(payload: SessionAdoptionPayload): ManagedSession {
    const session = this.requireSession(payload.sessionId);
    const existingAdoption = this.adoptionKeys.get(payload.adoptionKey);
    if (existingAdoption || session.metadata["sxsy-b122.adoptionKey"]) {
      throw new CompanionServiceError("already_adopted", "This terminal has already been adopted; its capabilities were not changed.");
    }
    const next: ManagedSession = {
      ...session,
      provider: payload.provider,
      // Adoption is only naming/binding. It must never manufacture a provider
      // handshake, heartbeat, authority grant, or mediated capability.
      capabilities: session.capabilities,
      status: session.status,
      lastHeartbeat: this.now(),
      metadata: {
        ...session.metadata,
        "sxsy-b122.adoptionKey": payload.adoptionKey,
        "sxsy-b122.adoptedAt": this.now()
      }
    };
    this.adoptionKeys.set(payload.adoptionKey, session.id);
    this.sessions.set(session.id, next);
    this.record("session.adopt", "completed", "Adopted a terminal as Registered only; no capability was elevated.", session.id);
    return cloneSession(next);
  }

  private setStatus(payload: SessionStatusPayload): ManagedSession {
    const session = this.requireSession(payload.sessionId);
    if ((payload.status === "verified_blocked" || payload.status === "verified_finished") && !session.capabilities.includes("observable")) {
      throw new CompanionServiceError("capability_denied", "Verified blocked or finished status requires an Observable adapter signal.");
    }
    const next: ManagedSession = { ...session, status: payload.status, lastHeartbeat: this.now() };
    this.sessions.set(session.id, next);
    this.record("session.status", "completed", `Recorded session status as ${payload.status}.`, session.id);
    return cloneSession(next);
  }

  private heartbeat(payload: SessionHeartbeatPayload): ManagedSession {
    const session = this.requireSession(payload.sessionId);
    const next: ManagedSession = { ...session, lastHeartbeat: payload.at ?? this.now() };
    this.sessions.set(session.id, next);
    this.record("session.heartbeat", "completed", "Recorded a session heartbeat.", session.id);
    return cloneSession(next);
  }

  private async dispatch(payload: DispatchPayload): Promise<CommandResult> {
    const assignment = assignmentFor(payload.control, payload.modifier);
    if (!assignment) {
      const result: CommandResult = {
        status: "unavailable",
        summary: "This B122 chord is intentionally unassigned and was not routed."
      };
      this.record("command.dispatch", result.status, result.summary, payload.sessionId);
      return result;
    }

    if (!this.executor) {
      const result: CommandResult = {
        status: assignment.capability === "disabled_pending_gates" ? "blocked" : "unavailable",
        summary: assignment.capability === "disabled_pending_gates"
          ? "This high-consequence B122 control remains disabled until the durable policy executor evaluates its acceptance gates."
          : "No durable policy executor is attached; this command was not reported as completed and no host action was requested."
      };
      this.record("command.dispatch", result.status, result.summary, payload.sessionId);
      return result;
    }

    // Every settled assignment, including route-only UI/navigation work, must
    // cross the durable executor. Missing adapters remain unavailable instead
    // of becoming false-green transport acknowledgements.
    const request: CommandRequest = {
      assignment,
      control: payload.control,
      modifier: payload.modifier,
      sessionId: payload.sessionId,
      authorityId: payload.authorityId,
      confirmationToken: payload.confirmationToken,
      input: payload.input
    };
    const result = await this.executor.execute(request);
    this.record("command.dispatch", result.status, result.summary, payload.sessionId, result.operationId);
    return result;
  }

  private async cancelOperation(payload: OperationCancellationPayload): Promise<CommandResult> {
    if (!isCancellableExecutor(this.executor)) {
      const result: CommandResult = { status: "unavailable", summary: "No verified mediated operation-control adapter is attached; no cancellation was sent.", operationId: payload.operationId };
      this.record("operation.cancel", result.status, result.summary, undefined, payload.operationId);
      return result;
    }
    const result = await this.executor.cancelOperation(payload.operationId, payload.reason);
    this.record("operation.cancel", result.status, result.summary, undefined, payload.operationId);
    return result;
  }

  private async requestConfirmation(payload: ConfirmationRequestPayload): Promise<Readonly<{ status: string; summary: string; token?: string; expiresAt?: string }>> {
    if (!isConfirmationCapableExecutor(this.executor)) {
      return { status: "unavailable", summary: "No trusted companion-UI confirmation attestor is attached; no confirmation token was issued." };
    }
    return this.executor.requestConfirmation(payload);
  }

  private requireRegistration(payload: unknown): SessionRegistrationPayload {
    if (!isRecord(payload) || !isRecord(payload.session)) throw new CompanionServiceError("invalid_request", "A session registration requires a session record.");
    return { session: payload.session as unknown as ManagedSession };
  }

  private requireAdoption(payload: unknown): SessionAdoptionPayload {
    if (!isRecord(payload) || typeof payload.sessionId !== "string" || typeof payload.adoptionKey !== "string" || !isTerminalProvider(payload.provider)) {
      throw new CompanionServiceError("invalid_request", "A terminal adoption requires a session ID, stable adoption key, and known provider.");
    }
    return { sessionId: payload.sessionId, adoptionKey: payload.adoptionKey, provider: payload.provider };
  }

  private requireStatus(payload: unknown): SessionStatusPayload {
    if (!isRecord(payload) || typeof payload.sessionId !== "string" || !isSessionStatus(payload.status)) {
      throw new CompanionServiceError("invalid_request", "A session status update requires a known session ID and status.");
    }
    return { sessionId: payload.sessionId, status: payload.status };
  }

  private requireHeartbeat(payload: unknown): SessionHeartbeatPayload {
    if (!isRecord(payload) || typeof payload.sessionId !== "string" || (payload.at !== undefined && typeof payload.at !== "string")) {
      throw new CompanionServiceError("invalid_request", "A heartbeat requires a known session ID and optional timestamp.");
    }
    return { sessionId: payload.sessionId, at: payload.at };
  }

  private requireDispatch(payload: unknown): DispatchPayload {
    if (!isRecord(payload) || !isControl(payload.control) || !isModifier(payload.modifier)) {
      throw new CompanionServiceError("invalid_request", "A command dispatch requires a canonical B122 control and modifier.");
    }
    if (payload.sessionId !== undefined && typeof payload.sessionId !== "string") {
      throw new CompanionServiceError("invalid_request", "A command dispatch session ID must be a string.");
    }
    return {
      control: payload.control,
      modifier: payload.modifier,
      sessionId: payload.sessionId,
      authorityId: optionalReference(payload.authorityId, "authority ID"),
      confirmationToken: optionalReference(payload.confirmationToken, "confirmation token"),
      input: parseInput(payload.input)
    };
  }

  private requireCancellation(payload: unknown): OperationCancellationPayload {
    if (!isRecord(payload) || typeof payload.operationId !== "string" || typeof payload.reason !== "string" || !payload.operationId.trim() || !payload.reason.trim() || payload.operationId.length > 256 || payload.reason.length > 512) {
      throw new CompanionServiceError("invalid_request", "An operation cancellation requires bounded operation ID and reason values.");
    }
    return { operationId: payload.operationId, reason: payload.reason };
  }

  private requireConfirmation(payload: unknown): ConfirmationRequestPayload {
    if (!isRecord(payload) || typeof payload.action !== "string" || !(commandActionIds as readonly string[]).includes(payload.action)
      || typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 512
      || (payload.sessionId !== undefined && typeof payload.sessionId !== "string")
      || (payload.authorityId !== undefined && typeof payload.authorityId !== "string")) {
      throw new CompanionServiceError("invalid_request", "A confirmation request requires a known action, bounded reason, and optional opaque session/authority references.");
    }
    return { action: payload.action as CommandAction, reason: payload.reason, ...(payload.sessionId ? { sessionId: payload.sessionId } : {}), ...(payload.authorityId ? { authorityId: payload.authorityId } : {}) };
  }

  private requireSession(id: string): ManagedSession {
    const session = this.sessions.get(id);
    if (!session) throw new CompanionServiceError("not_found", "The requested managed session is not registered with this companion.");
    return session;
  }

  private record(action: string, status: AuditEvent["status"], detail: string, sessionId?: string, operationId?: string): void {
    this.audit.push({
      id: this.idFactory(),
      action,
      status,
      operationId,
      at: this.now(),
      detail: sessionId ? `${detail} Session: ${sessionId}.` : detail
    });
  }

  private success(id: string, result: unknown): CompanionResponse {
    return { version: companionBridgeVersion, id, ok: true, result };
  }

  private failure(id: string, code: CompanionError["code"], message: string): CompanionResponse {
    return { version: companionBridgeVersion, id, ok: false, error: { code, message } };
  }
}

class CompanionServiceError extends Error {
  readonly code: CompanionError["code"];

  constructor(code: CompanionError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const statusValues = ["running", "verified_blocked", "verified_finished", "unreachable", "stale", "unknown"] as const;
const capabilityValues = ["registered", "observable", "controllable", "mediated"] as const;
const modifierValues = ["normal", "shift", "alt", "shift_alt", "ctrl", "ctrl_shift", "ctrl_alt", "ctrl_shift_alt"] as const;

function parseManagedSession(value: unknown): ManagedSession {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || !isProvider(value.provider) || !isSurface(value.surface)) {
    throw new CompanionServiceError("invalid_request", "A session must include a non-empty ID, provider, and supported surface.");
  }
  if (!Array.isArray(value.capabilities) || !value.capabilities.every(isCapability) || !isSessionStatus(value.status)) {
    throw new CompanionServiceError("invalid_request", "A session must include a valid capability set and status.");
  }
  if (!Array.isArray(value.plannedFiles) || !value.plannedFiles.every((file) => typeof file === "string") || typeof value.lastHeartbeat !== "string" || typeof value.adapterVersion !== "string") {
    throw new CompanionServiceError("invalid_request", "A session must include planned files, heartbeat, and adapter version.");
  }
  const metadata = parseStringRecord(value.metadata);
  return {
    id: value.id,
    provider: value.provider,
    surface: value.surface,
    capabilities: normalizeCapabilities(value.capabilities),
    status: value.status,
    workspaceRoot: optionalString(value.workspaceRoot),
    targetSnapshotId: optionalString(value.targetSnapshotId),
    taskId: optionalString(value.taskId),
    planRevision: optionalString(value.planRevision),
    plannedFiles: value.plannedFiles,
    lastHeartbeat: value.lastHeartbeat,
    adapterVersion: value.adapterVersion,
    metadata
  };
}

function parseInput(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).length > 20) {
    throw new CompanionServiceError("invalid_request", "Command input must be a bounded map of named string values.");
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) || typeof item !== "string" || item.length > 512) {
      throw new CompanionServiceError("invalid_request", "Command input contains an invalid name or value.");
    }
    result[key] = item;
  }
  return result;
}

function parseStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) throw new CompanionServiceError("invalid_request", "Session metadata must be a string map.");
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || item.length > 512) throw new CompanionServiceError("invalid_request", "Session metadata values must be bounded strings.");
    result[key] = item;
  }
  return result;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new CompanionServiceError("invalid_request", "Optional session fields must be strings.");
  return value;
}

function optionalReference(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\r\n\0]/.test(value)) {
    throw new CompanionServiceError("invalid_request", `A command dispatch ${label} must be a bounded opaque reference.`);
  }
  return value;
}

function normalizeCapabilities(values: readonly Capability[]): readonly Capability[] {
  return [...new Set(values.filter(isCapability))];
}

function cloneSession(session: ManagedSession): ManagedSession {
  return {
    ...session,
    capabilities: [...session.capabilities],
    plannedFiles: [...session.plannedFiles],
    metadata: { ...session.metadata }
  };
}

function isCancellableExecutor(value: MediatedCommandExecutor | undefined): value is CancellableMediatedCommandExecutor {
  return !!value && typeof (value as Partial<CancellableMediatedCommandExecutor>).cancelOperation === "function";
}

function isConfirmationCapableExecutor(value: MediatedCommandExecutor | undefined): value is ConfirmationCapableMediatedCommandExecutor {
  return !!value && typeof (value as Partial<ConfirmationCapableMediatedCommandExecutor>).requestConfirmation === "function";
}

function isControl(value: unknown): value is Control {
  return typeof value === "string" && (controls as readonly string[]).includes(value);
}

function isModifier(value: unknown): value is Modifier {
  return typeof value === "string" && (modifierValues as readonly string[]).includes(value);
}

function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (capabilityValues as readonly string[]).includes(value);
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && (statusValues as readonly string[]).includes(value);
}

function isProvider(value: unknown): value is ManagedSession["provider"] {
  return value === "claude" || value === "codex" || value === "generic" || value === "voice";
}

function isTerminalProvider(value: unknown): value is SessionAdoptionPayload["provider"] {
  return value === "claude" || value === "codex" || value === "generic";
}

function isSurface(value: unknown): value is ManagedSession["surface"] {
  return value === "vscode_terminal" || value === "vscode_window" || value === "desktop" || value === "browser" || value === "bridge";
}
