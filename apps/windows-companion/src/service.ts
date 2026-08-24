import { isAbsolute } from "node:path";

import { assignmentFor, controls, type Control, type Modifier } from "../../../packages/protocol/src/b122.ts";
import { commandActionIds, commandFor, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { GitMutation } from "../../../packages/control-plane/src/brokers.ts";
import type { GitReviewResult } from "./git-review.ts";
import type { RuntimePinCoordinator } from "./runtime-provisioning.ts";
import type { SandboxInstallationCoordinator } from "./sandbox-installation.ts";
import type { CredentialProvisioningCoordinator, NetworkPolicyCoordinator } from "./host-provisioning.ts";
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
  type CommandPreparationPayload,
  type ConfirmationRequestPayload,
  type HostActionCompletionPayload,
  type GitReviewPayload,
  type RuntimePinInstallPayload,
  type RuntimePinRevokePayload,
  type SandboxInstallPayload,
  type SandboxRevokePayload,
  type CredentialProvisionPayload,
  type CredentialRevokePayload,
  type NetworkPolicyInstallPayload,
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

export interface CommandPreparationCapableMediatedCommandExecutor extends MediatedCommandExecutor {
  prepareCommand(request: Readonly<{ action: CommandAction; sessionId?: string; reason: string }>): Promise<Readonly<{ status: "prepared" | "blocked" | "unavailable" | "incomplete"; summary: string; session?: ManagedSession; authorityId?: string; confirmationToken?: string; confirmationExpiresAt?: string }>>;
}

export interface HostActionCompletionRecord {
  readonly hostActionId: string;
  readonly operationId: string;
  readonly action: CommandAction;
  readonly targetSnapshotId?: string;
  readonly status: "completed" | "failed";
  readonly summary: string;
  readonly evidenceDigest: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly completedAt: string;
}

export interface HostActionCoordinator {
  settle(payload: HostActionCompletionPayload): Promise<HostActionCompletionRecord>;
}

export interface GitMutationReviewCoordinator {
  review(payload: GitReviewPayload): Promise<GitReviewResult>;
}

export interface ExternalCompletionCapableMediatedCommandExecutor extends MediatedCommandExecutor {
  completeExternalOperation(record: HostActionCompletionRecord): Promise<CommandResult>;
}

export interface CompanionServiceOptions {
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly executor?: MediatedCommandExecutor;
  readonly hostActions?: HostActionCoordinator;
  readonly gitReviews?: GitMutationReviewCoordinator;
  readonly runtimePins?: RuntimePinCoordinator;
  readonly sandboxInstallations?: SandboxInstallationCoordinator;
  readonly credentialProvisioning?: CredentialProvisioningCoordinator;
  readonly networkPolicyProvisioning?: NetworkPolicyCoordinator;
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
  private readonly hostActions?: HostActionCoordinator;
  private readonly gitReviews?: GitMutationReviewCoordinator;
  private readonly runtimePins?: RuntimePinCoordinator;
  private readonly sandboxInstallations?: SandboxInstallationCoordinator;
  private readonly credentialProvisioning?: CredentialProvisioningCoordinator;
  private readonly networkPolicyProvisioning?: NetworkPolicyCoordinator;
  private readonly verifyCapabilities?: (session: ManagedSession) => readonly Capability[];

  constructor(options: CompanionServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => `audit-${crypto.randomUUID()}`);
    this.executor = options.executor;
    this.hostActions = options.hostActions;
    this.gitReviews = options.gitReviews;
    this.runtimePins = options.runtimePins;
    this.sandboxInstallations = options.sandboxInstallations;
    this.credentialProvisioning = options.credentialProvisioning;
    this.networkPolicyProvisioning = options.networkPolicyProvisioning;
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
        case "command.prepare":
          return this.success(request.id, { preparation: await this.prepareCommand(this.requireCommandPreparation(request.payload)) });
        case "confirmation.request":
          return this.success(request.id, { confirmation: await this.requestConfirmation(this.requireConfirmation(request.payload)) });
        case "git.review.submit":
          return this.success(request.id, { review: await this.reviewGitMutation(this.requireGitReview(request.payload)) });
        case "runtime.pin.install":
          return this.success(request.id, { pin: await this.installRuntimePin(this.requireRuntimePinInstall(request.payload)) });
        case "runtime.pin.list":
          return this.success(request.id, { pins: await this.listRuntimePins(request.payload) });
        case "runtime.pin.revoke":
          return this.success(request.id, { pin: await this.revokeRuntimePin(this.requireRuntimePinRevoke(request.payload)) });
        case "sandbox.install":
          return this.success(request.id, { installation: await this.installSandbox(this.requireSandboxInstall(request.payload)) });
        case "sandbox.list":
          return this.success(request.id, { installations: await this.listSandboxes(request.payload) });
        case "sandbox.revoke":
          return this.success(request.id, { installation: await this.revokeSandbox(this.requireSandboxRevoke(request.payload)) });
        case "credential.provision":
          return this.success(request.id, { credential: await this.provisionCredential(this.requireCredentialProvision(request.payload)) });
        case "credential.list":
          return this.success(request.id, { credentials: await this.listCredentials(request.payload) });
        case "credential.revoke":
          return this.success(request.id, { revoked: await this.revokeCredential(this.requireCredentialRevoke(request.payload)) });
        case "network-policy.install":
          return this.success(request.id, { policy: await this.installNetworkPolicy(this.requireNetworkPolicyInstall(request.payload)) });
        case "network-policy.current":
          return this.success(request.id, { policy: await this.currentNetworkPolicy(request.payload) });
        case "network-policy.revoke":
          return this.success(request.id, { policy: await this.revokeNetworkPolicy(request.payload) });
        case "host-action.complete":
          return this.success(request.id, { command: await this.completeHostAction(this.requireHostActionCompletion(request.payload)) });
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

  private async prepareCommand(payload: CommandPreparationPayload): Promise<Readonly<{ status: "prepared" | "blocked" | "unavailable" | "incomplete"; summary: string; session?: ManagedSession; authorityId?: string; confirmationToken?: string; confirmationExpiresAt?: string }>> {
    if (!isCommandPreparationExecutor(this.executor)) return { status: "unavailable", summary: "No durable command-preparation boundary is attached." };
    const definition = commandFor(payload.control, payload.modifier);
    if (!definition) return { status: "blocked", summary: "The chord is intentionally unassigned and cannot be prepared." };
    const result = await this.executor.prepareCommand({ action: definition.action, ...(payload.sessionId ? { sessionId: payload.sessionId } : {}), reason: payload.reason });
    if (result.session) this.installTrustedSession(result.session);
    this.record("command.prepare", result.status === "prepared" ? "completed" : result.status, result.summary, payload.sessionId);
    return result;
  }

  private async completeHostAction(payload: HostActionCompletionPayload): Promise<CommandResult> {
    if (!this.hostActions || !isExternalCompletionExecutor(this.executor)) {
      return { status: "unavailable", summary: "No durable host-action settlement boundary is attached; the acknowledgement was not accepted." };
    }
    const record = await this.hostActions.settle(payload);
    const result = await this.executor.completeExternalOperation(record);
    this.record("host-action.complete", result.status, result.summary, undefined, result.operationId);
    return result;
  }

  private async reviewGitMutation(payload: GitReviewPayload): Promise<GitReviewResult> {
    if (!this.gitReviews) return { status: "unavailable", summary: "No trusted current-user Git review boundary is attached." };
    const result = await this.gitReviews.review(payload);
    if (result.session) this.installTrustedSession(result.session);
    this.record("git.review.submit", result.status === "approved" ? "completed" : result.status, result.summary, payload.sessionId);
    return result;
  }

  private async installRuntimePin(payload: RuntimePinInstallPayload) {
    if (!this.runtimePins) throw new CompanionServiceError("capability_denied", "No trusted runtime provisioning boundary is attached.");
    const pin = await this.runtimePins.install(payload);
    this.record("runtime.pin.install", "completed", "Installed one current-user-attested repository runtime digest.");
    return pin;
  }

  private async listRuntimePins(payload: unknown) {
    if (payload !== undefined && (!isRecord(payload) || Object.keys(payload).length !== 0)) throw new CompanionServiceError("invalid_request", "Runtime pin listing accepts no client options.");
    if (!this.runtimePins) throw new CompanionServiceError("capability_denied", "No trusted runtime provisioning boundary is attached.");
    return this.runtimePins.list();
  }

  private async revokeRuntimePin(payload: RuntimePinRevokePayload) {
    if (!this.runtimePins) throw new CompanionServiceError("capability_denied", "No trusted runtime provisioning boundary is attached.");
    const pin = await this.runtimePins.revoke(payload.repositoryRoot);
    this.record("runtime.pin.revoke", "completed", "Revoked one current-user-attested repository runtime digest.");
    return pin;
  }

  private requireRuntimePinInstall(payload: unknown): RuntimePinInstallPayload {
    if (!isRecord(payload) || !exactKeys(payload, ["repositoryRoot", "manifestPath"])
      || !boundedHostPath(payload.repositoryRoot) || !boundedHostPath(payload.manifestPath)) {
      throw new CompanionServiceError("invalid_request", "Runtime pin installation requires only bounded absolute repository and manifest paths.");
    }
    return { repositoryRoot: payload.repositoryRoot, manifestPath: payload.manifestPath };
  }

  private requireRuntimePinRevoke(payload: unknown): RuntimePinRevokePayload {
    if (!isRecord(payload) || !exactKeys(payload, ["repositoryRoot"]) || !boundedHostPath(payload.repositoryRoot)) {
      throw new CompanionServiceError("invalid_request", "Runtime pin revocation requires one bounded absolute repository path.");
    }
    return { repositoryRoot: payload.repositoryRoot };
  }

  private async installSandbox(payload: SandboxInstallPayload) {
    if (!this.sandboxInstallations) throw new CompanionServiceError("capability_denied", "No trusted Windows Sandbox installation boundary is attached.");
    const installation = await this.sandboxInstallations.install(payload);
    this.record("sandbox.install", "completed", "Installed one current-user-attested Windows Sandbox catalog and helper pin.");
    return installation;
  }

  private async listSandboxes(payload: unknown) {
    if (payload !== undefined && (!isRecord(payload) || Object.keys(payload).length !== 0)) throw new CompanionServiceError("invalid_request", "Windows Sandbox listing accepts no client options.");
    if (!this.sandboxInstallations) throw new CompanionServiceError("capability_denied", "No trusted Windows Sandbox installation boundary is attached.");
    return this.sandboxInstallations.list();
  }

  private async revokeSandbox(payload: SandboxRevokePayload) {
    if (!this.sandboxInstallations) throw new CompanionServiceError("capability_denied", "No trusted Windows Sandbox installation boundary is attached.");
    const installation = await this.sandboxInstallations.revoke(payload.repositoryRoot);
    this.record("sandbox.revoke", "completed", "Revoked one current-user-attested Windows Sandbox installation.");
    return installation;
  }

  private requireSandboxInstall(payload: unknown): SandboxInstallPayload {
    if (!isRecord(payload) || !exactKeys(payload, ["repositoryRoot", "catalogPath"]) || !boundedHostPath(payload.repositoryRoot) || !boundedHostPath(payload.catalogPath)) {
      throw new CompanionServiceError("invalid_request", "Windows Sandbox installation requires only bounded absolute repository and catalog paths.");
    }
    return { repositoryRoot: payload.repositoryRoot, catalogPath: payload.catalogPath };
  }

  private requireSandboxRevoke(payload: unknown): SandboxRevokePayload {
    if (!isRecord(payload) || !exactKeys(payload, ["repositoryRoot"]) || !boundedHostPath(payload.repositoryRoot)) throw new CompanionServiceError("invalid_request", "Windows Sandbox revocation requires one bounded absolute repository path.");
    return { repositoryRoot: payload.repositoryRoot };
  }

  private async provisionCredential(payload: CredentialProvisionPayload) {
    if (!this.credentialProvisioning) throw new CompanionServiceError("capability_denied", "No trusted credential provisioning boundary is attached.");
    const credential = await this.credentialProvisioning.provision(payload);
    this.record("credential.provision", "completed", "Provisioned one DPAPI-sealed, repository-and-purpose-scoped credential reference.");
    return credential;
  }

  private async listCredentials(payload: unknown) {
    requireEmptyPayload(payload, "Credential listing");
    if (!this.credentialProvisioning) throw new CompanionServiceError("capability_denied", "No trusted credential provisioning boundary is attached.");
    return this.credentialProvisioning.list();
  }

  private async revokeCredential(payload: CredentialRevokePayload): Promise<boolean> {
    if (!this.credentialProvisioning) throw new CompanionServiceError("capability_denied", "No trusted credential provisioning boundary is attached.");
    const revoked = await this.credentialProvisioning.revoke(payload.reference, payload.reason);
    this.record("credential.revoke", revoked ? "completed" : "unavailable", revoked ? "Revoked the selected credential reference." : "The selected live credential reference was not found.");
    return revoked;
  }

  private async installNetworkPolicy(payload: NetworkPolicyInstallPayload) {
    if (!this.networkPolicyProvisioning) throw new CompanionServiceError("capability_denied", "No trusted network-policy provisioning boundary is attached.");
    const policy = await this.networkPolicyProvisioning.install(payload.sourcePath);
    this.record("network-policy.install", "completed", "Installed one current-user-attested exact-route HTTPS policy.");
    return policy;
  }

  private async currentNetworkPolicy(payload: unknown) { requireEmptyPayload(payload, "Network policy inspection"); if (!this.networkPolicyProvisioning) throw new CompanionServiceError("capability_denied", "No trusted network-policy provisioning boundary is attached."); return this.networkPolicyProvisioning.current(); }
  private async revokeNetworkPolicy(payload: unknown) { requireEmptyPayload(payload, "Network policy revocation"); if (!this.networkPolicyProvisioning) throw new CompanionServiceError("capability_denied", "No trusted network-policy provisioning boundary is attached."); const policy = await this.networkPolicyProvisioning.revoke(); this.record("network-policy.revoke", "completed", "Revoked the active exact-route HTTPS policy."); return policy; }

  private requireCredentialProvision(payload: unknown): CredentialProvisionPayload {
    if (!isRecord(payload) || !allowedExactKeys(payload, ["reference", "repositoryRoot", "purposes", "sealedSecret"], ["replaceExisting"])
      || typeof payload.reference !== "string" || !boundedHostPath(payload.repositoryRoot) || !Array.isArray(payload.purposes) || !payload.purposes.every((value) => typeof value === "string") || typeof payload.sealedSecret !== "string" || (payload.replaceExisting !== undefined && typeof payload.replaceExisting !== "boolean")) throw new CompanionServiceError("invalid_request", "Credential provisioning requires only a reference, exact repository, bounded purposes, and a DPAPI-sealed secret.");
    return { reference: payload.reference, repositoryRoot: payload.repositoryRoot, purposes: payload.purposes as string[], sealedSecret: payload.sealedSecret, ...(payload.replaceExisting === true ? { replaceExisting: true } : {}) };
  }

  private requireCredentialRevoke(payload: unknown): CredentialRevokePayload { if (!isRecord(payload) || !exactKeys(payload, ["reference", "reason"]) || typeof payload.reference !== "string" || typeof payload.reason !== "string") throw new CompanionServiceError("invalid_request", "Credential revocation requires exact reference and reason fields."); return { reference: payload.reference, reason: payload.reason }; }
  private requireNetworkPolicyInstall(payload: unknown): NetworkPolicyInstallPayload { if (!isRecord(payload) || !exactKeys(payload, ["sourcePath"]) || !boundedHostPath(payload.sourcePath)) throw new CompanionServiceError("invalid_request", "Network policy installation requires one bounded absolute source path."); return { sourcePath: payload.sourcePath }; }

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

  private requireCommandPreparation(payload: unknown): CommandPreparationPayload {
    if (!isRecord(payload) || !isControl(payload.control) || !isModifier(payload.modifier)
      || typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 512
      || (payload.sessionId !== undefined && typeof payload.sessionId !== "string")) {
      throw new CompanionServiceError("invalid_request", "Command preparation requires a canonical chord, bounded host reason, and optional exact session ID.");
    }
    return { control: payload.control, modifier: payload.modifier, reason: payload.reason, ...(payload.sessionId ? { sessionId: payload.sessionId } : {}) };
  }

  private requireHostActionCompletion(payload: unknown): HostActionCompletionPayload {
    if (!isRecord(payload)
      || typeof payload.hostActionId !== "string" || !/^host-action:[a-f0-9]{64}$/.test(payload.hostActionId)
      || typeof payload.succeeded !== "boolean"
      || typeof payload.summary !== "string" || !payload.summary.trim() || payload.summary.length > 512
      || typeof payload.adapterVersion !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(payload.adapterVersion)) {
      throw new CompanionServiceError("invalid_request", "A host-action acknowledgement requires an exact durable ID, outcome, bounded summary, and adapter version.");
    }
    return { hostActionId: payload.hostActionId, succeeded: payload.succeeded, summary: payload.summary, adapterVersion: payload.adapterVersion };
  }

  private requireGitReview(payload: unknown): GitReviewPayload {
    if (!isRecord(payload) || !isGitReviewAction(payload.action) || typeof payload.sessionId !== "string" || !payload.sessionId.trim() || payload.sessionId.length > 256) {
      throw new CompanionServiceError("invalid_request", "Git review requires an exact action and managed session ID.");
    }
    return { action: payload.action, sessionId: payload.sessionId, mutation: parseGitMutation(payload.mutation) };
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

function parseGitMutation(value: unknown): GitMutation {
  if (!isRecord(value) || typeof value.kind !== "string") throw new CompanionServiceError("invalid_request", "Git review requires a typed mutation record.");
  switch (value.kind) {
    case "local_commit":
      exactMutationKeys(value, ["kind", "paths", "message"]);
      if (!Array.isArray(value.paths) || !value.paths.length || value.paths.length > 256 || !value.paths.every((path) => typeof path === "string" && path.length <= 512)
        || typeof value.message !== "string" || !value.message.trim() || value.message.length > 120) throw new CompanionServiceError("invalid_request", "Local commit review requires bounded paths and message.");
      return { kind: "local_commit", paths: value.paths, message: value.message };
    case "pr_upsert":
      exactMutationKeys(value, ["kind", "headBranch", "baseBranch"]);
      if (typeof value.headBranch !== "string" || typeof value.baseBranch !== "string") throw new CompanionServiceError("invalid_request", "PR review requires exact head and base branches.");
      return { kind: "pr_upsert", headBranch: value.headBranch, baseBranch: value.baseBranch };
    case "merge_pr":
      exactMutationKeys(value, ["kind", "pullRequest", "head", "baseBranch"]);
      if (!Number.isSafeInteger(value.pullRequest) || typeof value.head !== "string" || typeof value.baseBranch !== "string") throw new CompanionServiceError("invalid_request", "PR merge review requires exact pull request, head, and base values.");
      return { kind: "merge_pr", pullRequest: value.pullRequest as number, head: value.head, baseBranch: value.baseBranch };
    case "direct_main":
      exactMutationKeys(value, ["kind", "branch", "validationReceiptId"]);
      if (typeof value.branch !== "string" || typeof value.validationReceiptId !== "string") throw new CompanionServiceError("invalid_request", "Direct Main review requires an exact branch and validation receipt.");
      return { kind: "direct_main", branch: value.branch, validationReceiptId: value.validationReceiptId };
    default:
      throw new CompanionServiceError("invalid_request", "Git review mutation kind is unknown.");
  }
}

function exactMutationKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some((key) => !(key in value))) throw new CompanionServiceError("invalid_request", "Git review mutation contains an unknown or missing field.");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => key in value);
}

function allowedExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && keys.every((key) => allowed.has(key));
}

function requireEmptyPayload(payload: unknown, label: string): void {
  if (payload !== undefined && (!isRecord(payload) || Object.keys(payload).length !== 0)) throw new CompanionServiceError("invalid_request", `${label} accepts no client options.`);
}

function boundedHostPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\r\n\0]/.test(value)
    && (isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value));
}

function isCommandPreparationExecutor(value: MediatedCommandExecutor | undefined): value is CommandPreparationCapableMediatedCommandExecutor {
  return !!value && typeof (value as Partial<CommandPreparationCapableMediatedCommandExecutor>).prepareCommand === "function";
}

function isExternalCompletionExecutor(value: MediatedCommandExecutor | undefined): value is ExternalCompletionCapableMediatedCommandExecutor {
  return !!value && typeof (value as Partial<ExternalCompletionCapableMediatedCommandExecutor>).completeExternalOperation === "function";
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

function isGitReviewAction(value: unknown): value is GitReviewPayload["action"] {
  return value === "local_commit" || value === "pr_upsert" || value === "pr_merge" || value === "direct_main";
}

function isSurface(value: unknown): value is ManagedSession["surface"] {
  return value === "vscode_terminal" || value === "vscode_window" || value === "desktop" || value === "browser" || value === "bridge";
}
