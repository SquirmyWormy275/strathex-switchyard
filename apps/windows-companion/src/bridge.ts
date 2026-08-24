import type { Control, Modifier } from "../../../packages/protocol/src/b122.ts";
import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { CommandResult, ManagedSession, SessionStatus } from "../../../packages/control-plane/src/contracts.ts";
import type { CompanionService } from "./service.ts";

/**
 * Versioned, local-only JSON-lines contract used between the VS Code extension
 * and the companion.  It deliberately carries intent and registration data,
 * never shell text or a request to execute an arbitrary command.
 */
export const companionBridgeVersion = 1 as const;

export type CompanionMethod =
  | "ping"
  | "session.register"
  | "session.adopt"
  | "session.status"
  | "session.heartbeat"
  | "session.list"
  | "terminal.register"
  | "terminal.adopt"
  | "debug.register"
  | "command.dispatch"
  | "operation.cancel"
  | "confirmation.request"
  | "host-action.complete";

export interface CompanionRequest {
  readonly version: typeof companionBridgeVersion;
  readonly id: string;
  readonly method: CompanionMethod;
  readonly payload?: unknown;
}

export interface CompanionError {
  readonly code:
    | "invalid_request"
    | "unsupported_version"
    | "unknown_method"
    | "not_found"
    | "already_adopted"
    | "capability_denied"
    | "companion_unavailable";
  readonly message: string;
}

export interface CompanionResponse {
  readonly version: typeof companionBridgeVersion;
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: CompanionError;
}

export interface SessionRegistrationPayload {
  readonly session: ManagedSession;
}

export interface SessionAdoptionPayload {
  readonly sessionId: string;
  /** Stable per-window terminal identity, not a display name. */
  readonly adoptionKey: string;
  readonly provider: "claude" | "codex" | "generic";
}

export interface SessionStatusPayload {
  readonly sessionId: string;
  readonly status: SessionStatus;
}

export interface SessionHeartbeatPayload {
  readonly sessionId: string;
  readonly at?: string;
}

export interface DispatchPayload {
  readonly control: Control;
  readonly modifier: Modifier;
  readonly sessionId?: string;
  /** References are verified against host-owned ledgers; they are never grants by themselves. */
  readonly authorityId?: string;
  /** A short-lived, companion-UI-created confirmation reference. */
  readonly confirmationToken?: string;
  /**
   * Named, bounded values selected by the host UI (for example a debug
   * configuration name).  Repository or terminal output is not authority.
   */
  readonly input?: Readonly<Record<string, string>>;
}

export interface CommandDispatchResponse {
  readonly command: CommandResult;
}

export interface OperationCancellationPayload {
  readonly operationId: string;
  readonly reason: string;
}

/** A UI may ask for review, but it cannot claim reauthentication in payload. */
export interface ConfirmationRequestPayload {
  readonly action: CommandAction;
  readonly sessionId?: string;
  readonly authorityId?: string;
  readonly reason: string;
}

/** A typed result from the installed VS Code host, never an execution request. */
export interface HostActionCompletionPayload {
  readonly hostActionId: string;
  readonly succeeded: boolean;
  readonly summary: string;
  readonly adapterVersion: string;
}

/** A minimal transport so extension and companion hosts can use the same wire format. */
export interface CompanionBridge {
  request(request: CompanionRequest): Promise<CompanionResponse>;
}

/**
 * An in-process bridge is useful for local development and deterministic
 * integration tests. It performs no external I/O; the service remains the
 * policy decision point.
 */
export class InProcessCompanionBridge implements CompanionBridge {
  private readonly service: CompanionService;

  constructor(service: CompanionService) {
    this.service = service;
  }

  request(request: CompanionRequest): Promise<CompanionResponse> {
    return this.service.handle(request);
  }
}

/**
 * The extension uses this until a deliberately configured local companion is
 * available. Falling closed avoids treating a disconnected service as an
 * approval to run a terminal, Git command, or provider action.
 */
export class UnavailableCompanionBridge implements CompanionBridge {
  private readonly reason: string;

  constructor(reason = "The local SXSY-B122 companion is unavailable.") {
    this.reason = reason;
  }

  async request(request: CompanionRequest): Promise<CompanionResponse> {
    return {
      version: companionBridgeVersion,
      id: request.id,
      ok: false,
      error: { code: "companion_unavailable", message: this.reason }
    };
  }
}

export function isCompanionRequest(value: unknown): value is CompanionRequest {
  if (!isRecord(value) || value.version !== companionBridgeVersion || typeof value.id !== "string") return false;
  return isCompanionMethod(value.method);
}

export function isCompanionMethod(value: unknown): value is CompanionMethod {
  return typeof value === "string" && [
    "ping", "session.register", "session.adopt", "session.status", "session.heartbeat", "session.list",
    "terminal.register", "terminal.adopt", "debug.register", "command.dispatch", "operation.cancel", "confirmation.request",
    "host-action.complete"
  ].includes(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
