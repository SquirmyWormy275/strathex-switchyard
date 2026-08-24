/**
 * The companion's provider-independent control plane.  This module contains
 * no desktop automation: adapters and brokers are explicit dependencies so a
 * missing integration fails closed rather than becoming an implicit shell.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assignments, assignmentFor, type Assignment, type Control, type Modifier } from "../../../packages/protocol/src/b122.ts";

export type SessionStatus = "running" | "verified_blocked" | "verified_finished" | "unreachable" | "stale" | "unknown";
export type OperationStatus = "prepared" | "executing" | "external_committed" | "recorded" | "failed" | "cancelling" | "compensating" | "blocked" | "unavailable" | "incomplete";
export type Outcome = "passed" | "failed" | "unavailable" | "incomplete" | "not_run" | "blocked";

export interface CapabilitySet { registered: boolean; observable: boolean; controllable: boolean; mediated: boolean; }
export interface TargetSnapshot {
  gitRoot: string; remote: string; branch: string; upstream?: string; head: string; indexTree: string;
  trackedManifest: string; untrackedManifest: string; submodules: string; policyVersion: string;
  toolFingerprint: string; environmentFingerprint: string; digest: string;
}
export interface ManagedSession {
  id: string; provider: "claude" | "codex" | "generic"; adapterVersion: string; surface: string;
  windowId: string; terminalId?: string; target?: TargetSnapshot; task?: string; planRevision?: string;
  plannedFiles: readonly string[]; capability: CapabilitySet; status: SessionStatus; lastHeartbeat: number;
  authorityVersion?: string; registrationEpoch?: string; focused?: boolean;
}
export interface CapabilityReport { capability: CapabilitySet; status: SessionStatus; heartbeat: number; evidenceDigest: string; }

/** Capability labels are independent; only a registered surface may claim one. */
export function capabilityReportIsConsistent(capability: CapabilitySet): boolean {
  return capability.registered || (!capability.observable && !capability.controllable && !capability.mediated);
}

export class SessionRegistry {
  private readonly sessions = new Map<string, ManagedSession>();
  register(session: ManagedSession): ManagedSession {
    if (!capabilityReportIsConsistent(session.capability)) throw new Error("Managed-session capability report is internally inconsistent.");
    this.sessions.set(session.id, { ...session, target: session.target && { ...session.target }, plannedFiles: [...session.plannedFiles] }); return this.get(session.id)!;
  }
  get(id: string): ManagedSession | undefined { const item = this.sessions.get(id); return item && { ...item, target: item.target && { ...item.target }, plannedFiles: [...item.plannedFiles] }; }
  list(): ManagedSession[] { return [...this.sessions.values()].map((item) => ({ ...item, target: item.target && { ...item.target }, plannedFiles: [...item.plannedFiles] })); }
  update(id: string, patch: Partial<ManagedSession>): ManagedSession | undefined { const current = this.sessions.get(id); if (!current) return undefined; return this.register({ ...current, ...patch, id }); }
  applyCapabilityReport(id: string, report: CapabilityReport): ManagedSession | undefined {
    const current = this.get(id);
    if (!current || !report.evidenceDigest || !Number.isFinite(report.heartbeat) || report.heartbeat < current.lastHeartbeat) return undefined;
    if (!capabilityReportIsConsistent(report.capability)) return undefined;
    if ((report.status === "verified_blocked" || report.status === "verified_finished") && !report.capability.observable) return undefined;
    if (report.capability.mediated && !report.capability.registered) return undefined;
    return this.update(id, { capability: { ...report.capability }, status: report.status, lastHeartbeat: report.heartbeat });
  }
  focus(id: string): ManagedSession | undefined { for (const item of this.sessions.values()) item.focused = false; return this.update(id, { focused: true }); }
  active(): ManagedSession | undefined { return this.list().find((item) => item.focused); }
  discover(status: "verified_blocked" | "verified_finished"): ManagedSession[] { return this.list().filter((item) => item.status === status && item.capability.observable); }
  async discoverFrom(adapter: ProviderSessionAdapter): Promise<ManagedSession[]> { const found = await adapter.discover(); return found.map((session) => this.register(session)); }
  select(ids: readonly string[]): { selection?: ManagedSession[]; reason?: string } { const found = ids.map((id) => this.get(id)).filter((item): item is ManagedSession => Boolean(item)); return found.length === ids.length && found.length > 0 ? { selection: found } : { reason: "A session selection is missing or stale." }; }
}

export interface SnapshotInput {
  gitRoot: string; remote: string; branch: string; upstream?: string; head: string; indexTree: string;
  tracked: readonly string[]; untracked: readonly string[]; submodules: readonly string[]; policyVersion: string;
  toolFingerprint: string; environmentFingerprint: string;
}
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function captureTargetSnapshot(input: SnapshotInput): TargetSnapshot {
  const stable = (values: readonly string[]) => digest([...values].sort());
  const { tracked, untracked, submodules, ...identity } = input;
  const base = { ...identity, gitRoot: resolve(input.gitRoot),
    trackedManifest: stable(tracked), untrackedManifest: stable(untracked), submodules: stable(submodules) };
  return { ...base, digest: digest(base) } as TargetSnapshot;
}
export function sameTarget(current: TargetSnapshot, expected: TargetSnapshot): boolean { return current.digest === expected.digest; }

export interface Authority { id: string; version: string; sessionId: string; targetDigest: string; planRevision?: string; allowedActions: readonly string[]; prohibitions: readonly string[]; expiresAt: number; revoked?: boolean; }
export class AuthorityLedger {
  private readonly authorities = new Map<string, Authority>();
  issue(authority: Authority): void { this.authorities.set(authority.id, { ...authority, allowedActions: [...authority.allowedActions], prohibitions: [...authority.prohibitions] }); }
  revoke(id: string): void { const value = this.authorities.get(id); if (value) this.authorities.set(id, { ...value, revoked: true }); }
  list(): Authority[] { return [...this.authorities.values()].map((item) => ({ ...item, allowedActions: [...item.allowedActions], prohibitions: [...item.prohibitions] })); }
  validate(id: string | undefined, session: ManagedSession, action: string, now = Date.now()): string | undefined {
    if (!id) return "No authenticated authority is bound to this operation."; const value = this.authorities.get(id);
    if (!value || value.revoked || value.expiresAt <= now) return "Authority is missing, revoked, or expired.";
    if (value.sessionId !== session.id || value.targetDigest !== session.target?.digest || (value.planRevision && value.planRevision !== session.planRevision)) return "Authority binding does not match the selected session and target.";
    if (!value.allowedActions.includes(action) || value.prohibitions.includes(action)) return "The requested action is outside scoped authority.";
    return undefined;
  }
}

export interface Receipt { id: string; operationId: string; outcome: Outcome; target: TargetSnapshot; authorityVersion?: string; evidenceDigest: string; policyVersion: string; createdAt: number; expiresAt: number; previousHash?: string; hash: string; }
export interface AuditEntry { operationId: string; action: string; status: OperationStatus; detail: string; at: number; }
interface DurableDocument { version: 1; containment: Record<string, number>; operations: Record<string, DurableOperation>; receipts: Receipt[]; audit: AuditEntry[]; }
export interface DurableOperation { id: string; parentId?: string; idempotencyKey: string; action: string; targetDigest: string; status: OperationStatus; childIds: string[]; externalReference?: string; updatedAt: number; }

/** JSON persistence is intentionally atomic and belongs outside any repository. */
export class ProtectedStore {
  private state: DurableDocument = { version: 1, containment: {}, operations: {}, receipts: [], audit: [] };
  private readonly path: string;
  private writeChain: Promise<void> = Promise.resolve();
  constructor(path: string) { this.path = path; }
  async load(): Promise<void> { try { const loaded = JSON.parse(await readFile(this.path, "utf8")) as DurableDocument; this.verifyReceipts(loaded.receipts); this.state = loaded; } catch (error: unknown) { if ((error as { code?: string }).code !== "ENOENT") throw error; } }
  private verifyReceipts(receipts: readonly Receipt[]): void { let previousHash: string | undefined; for (const receipt of receipts) { const { hash, ...unsigned } = receipt; if (receipt.previousHash !== previousHash || digest(unsigned) !== hash) throw new Error("Protected receipt chain failed integrity verification."); previousHash = hash; } }
  private async save(): Promise<void> { await mkdir(dirname(this.path), { recursive: true }); const temporary = `${this.path}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(this.state), "utf8"); await rename(temporary, this.path); }
  private async mutate<T>(change: () => T): Promise<T> {
    let result!: T;
    const write = this.writeChain.then(async () => { result = change(); await this.save(); });
    this.writeChain = write.catch(() => undefined);
    await write;
    return result;
  }
  operation(key: string): DurableOperation | undefined { return Object.values(this.state.operations).find((operation) => operation.idempotencyKey === key); }
  async putOperation(operation: DurableOperation): Promise<void> { await this.mutate(() => { this.state.operations[operation.id] = { ...operation, childIds: [...operation.childIds] }; }); }
  async createOperation(operation: DurableOperation): Promise<{ operation: DurableOperation; created: boolean }> {
    return this.mutate(() => {
      const existing = this.operation(operation.idempotencyKey);
      if (existing) return { operation: existing, created: false };
      this.state.operations[operation.id] = { ...operation, childIds: [...operation.childIds] };
      return { operation: { ...operation, childIds: [...operation.childIds] }, created: true };
    });
  }
  async receipt(receipt: Omit<Receipt, "id" | "previousHash" | "hash">): Promise<Receipt> { return this.mutate(() => { const previousHash = this.state.receipts.at(-1)?.hash; const unsigned = { ...receipt, id: randomUUID(), previousHash }; const complete = { ...unsigned, hash: digest(unsigned) }; this.state.receipts.push(complete); return complete; }); }
  receipts(): readonly Receipt[] { return this.state.receipts.map((receipt) => ({ ...receipt })); }
  async audit(entry: AuditEntry): Promise<void> { await this.mutate(() => { this.state.audit.push({ ...entry, detail: redact(entry.detail) }); }); }
  isContained(targetDigest: string): boolean { return Boolean(this.state.containment[targetDigest]); }
  async contain(targetDigest: string): Promise<void> { await this.mutate(() => { this.state.containment[targetDigest] = (this.state.containment[targetDigest] ?? 0) + 1; }); }
  async release(targetDigest: string, reauthenticated: boolean, reason: string): Promise<boolean> { if (!reauthenticated || !reason.trim()) return false; return this.mutate(() => { delete this.state.containment[targetDigest]; return true; }); }
  allOperations(): DurableOperation[] { return Object.values(this.state.operations).map((operation) => ({ ...operation, childIds: [...operation.childIds] })); }
}
export const redact = (value: string): string => value.replace(/(token|secret|password|authorization)\s*[:=]\s*[^\s,]+/gi, "$1=[REDACTED]").replace(/https?:\/\/[^\s]+/gi, "[URL REDACTED]");

export interface AdapterResult { outcome: Outcome; detail: string; externalReference?: string; }
export interface ExternalAdapter { readonly name: string; reconcile(operation: DurableOperation): Promise<AdapterResult>; execute(operation: DurableOperation, request: DispatchRequest): Promise<AdapterResult>; }
/** Provider contract: capability reports, not window appearance, establish agent state. */
export interface ProviderSessionAdapter { readonly provider: "claude" | "codex" | "generic"; readonly version: string; discover(): Promise<ManagedSession[]>; focus(sessionId: string): Promise<AdapterResult>; pause(sessionId: string): Promise<AdapterResult>; injectContext(sessionId: string, packet: ContextPackage): Promise<AdapterResult>; }
export class UnavailableProviderAdapter implements ProviderSessionAdapter {
  readonly provider: "claude" | "codex" | "generic"; readonly version = "unavailable"; private readonly reason: string;
  constructor(provider: "claude" | "codex" | "generic", reason = "The provider integration is unavailable.") { this.provider = provider; this.reason = reason; }
  async discover(): Promise<ManagedSession[]> { return []; }
  async focus(_sessionId: string): Promise<AdapterResult> { return { outcome: "unavailable", detail: this.reason }; }
  async pause(_sessionId: string): Promise<AdapterResult> { return { outcome: "unavailable", detail: this.reason }; }
  async injectContext(_sessionId: string, _packet: ContextPackage): Promise<AdapterResult> { return { outcome: "unavailable", detail: this.reason }; }
}
export class DeterministicProviderAdapter implements ProviderSessionAdapter {
  readonly calls: string[] = []; readonly version = "deterministic"; readonly provider: "claude" | "codex" | "generic"; private readonly known: readonly ManagedSession[];
  constructor(provider: "claude" | "codex" | "generic", known: readonly ManagedSession[]) { this.provider = provider; this.known = known; }
  async discover(): Promise<ManagedSession[]> { this.calls.push("discover"); return this.known.map((item) => ({ ...item, plannedFiles: [...item.plannedFiles] })); }
  async focus(sessionId: string): Promise<AdapterResult> { this.calls.push(`focus:${sessionId}`); return { outcome: "passed", detail: "focused deterministic session" }; }
  async pause(sessionId: string): Promise<AdapterResult> { this.calls.push(`pause:${sessionId}`); return { outcome: "passed", detail: "paused deterministic session" }; }
  async injectContext(sessionId: string, _packet: ContextPackage): Promise<AdapterResult> { this.calls.push(`inject:${sessionId}`); return { outcome: "passed", detail: "injected deterministic context" }; }
}
/** Safe default for proprietary or unavailable services: it never launches a UI or executes a command. */
export class UnavailableAdapter implements ExternalAdapter {
  readonly name: string; private readonly reason: string;
  constructor(name: string, reason = "The requested provider adapter is unavailable.") { this.name = name; this.reason = reason; }
  async reconcile(_operation: DurableOperation): Promise<AdapterResult> { return { outcome: "unavailable", detail: this.reason }; }
  async execute(_operation: DurableOperation, _request: DispatchRequest): Promise<AdapterResult> { return { outcome: "unavailable", detail: this.reason }; }
}
/** Deterministic test adapter; production code must use a concrete structured adapter. */
export class DeterministicAdapter implements ExternalAdapter {
  readonly calls: string[] = []; readonly name: string; private readonly result: AdapterResult;
  constructor(name = "deterministic", result: AdapterResult = { outcome: "passed", detail: "deterministic adapter completed" }) { this.name = name; this.result = result; }
  async reconcile(operation: DurableOperation): Promise<AdapterResult> { this.calls.push(`reconcile:${operation.id}`); return operation.externalReference ? { outcome: "passed", detail: "external effect already committed", externalReference: operation.externalReference } : this.result; }
  async execute(operation: DurableOperation): Promise<AdapterResult> { this.calls.push(`execute:${operation.id}`); return this.result; }
}

export interface ContextPackage { id: string; target: TargetSnapshot; task: string; planRevision: string; decisions: readonly string[]; authorityVersion?: string; documentation: readonly string[]; references: readonly string[]; digest: string; }
export interface ReviewPackage { id: string; target: TargetSnapshot; requirements: readonly string[]; changedFiles: readonly string[]; unchangedFiles: readonly string[]; testEvidence: readonly string[]; risks: readonly string[]; digest: string; }
export function createContextPackage(input: Omit<ContextPackage, "id" | "digest">): ContextPackage { const value = { ...input, decisions: [...input.decisions], documentation: [...input.documentation], references: [...input.references] }; return { ...value, id: randomUUID(), digest: digest(value) }; }
export function createReviewPackage(input: Omit<ReviewPackage, "id" | "digest">): ReviewPackage { const value = { ...input, requirements: [...input.requirements], changedFiles: [...input.changedFiles], unchangedFiles: [...input.unchangedFiles], testEvidence: [...input.testEvidence], risks: [...input.risks] }; return { ...value, id: randomUUID(), digest: digest(value) }; }

export interface ResourceLease { id: string; resource: string; owner: string; expiresAt: number; }
export class LeaseRegistry {
  private readonly leases = new Map<string, ResourceLease>();
  acquire(resource: string, owner: string, expiresAt: number, now = Date.now()): ResourceLease | undefined { const existing = this.leases.get(resource); if (existing && existing.expiresAt > now && existing.owner !== owner) return undefined; const lease = { id: randomUUID(), resource, owner, expiresAt }; this.leases.set(resource, lease); return lease; }
  release(owner: string): void { for (const [resource, lease] of this.leases) if (lease.owner === owner) this.leases.delete(resource); }
}
export interface CouncilReport { conflicts: readonly string[]; dependencies: readonly string[]; participants: readonly ManagedSession[]; }
export class CouncilCoordinator {
  private readonly registry: SessionRegistry; private readonly leases: LeaseRegistry;
  constructor(registry: SessionRegistry, leases: LeaseRegistry) { this.registry = registry; this.leases = leases; }
  report(sessionIds: readonly string[]): CouncilReport { const selected = this.registry.select(sessionIds); const participants = selected.selection; if (!participants) return { conflicts: [selected.reason!], dependencies: [], participants: [] }; const conflicts: string[] = []; for (let i = 0; i < participants.length; i += 1) for (let j = i + 1; j < participants.length; j += 1) { const overlap = participants[i].plannedFiles.filter((file) => participants[j].plannedFiles.includes(file)); if (overlap.length) conflicts.push(`${participants[i].id} and ${participants[j].id} overlap: ${overlap.join(", ")}`); } return { conflicts, dependencies: [], participants }; }
  prepareAutomatic(sessionIds: readonly string[], leaseUntil: number): { report: CouncilReport; leases: readonly ResourceLease[]; reason?: string } { const report = this.report(sessionIds); if (report.conflicts.length) return { report, leases: [], reason: "Council automatic mode stops on ambiguity or file overlap." }; if (report.participants.some((item) => !item.capability.observable || !item.capability.controllable || !item.capability.mediated || item.status !== "running")) return { report, leases: [], reason: "Every Council participant must be running, Observable, Controllable, and Mediated." }; const leases: ResourceLease[] = []; for (const participant of report.participants) for (const file of participant.plannedFiles) { const lease = this.leases.acquire(file, participant.id, leaseUntil); if (!lease) { for (const owner of report.participants) this.leases.release(owner.id); return { report, leases: [], reason: "A resource lease conflicted; Council automatic mode stopped." }; } leases.push(lease); } return { report, leases }; }
}

export interface CredentialBroker { acquire(target: TargetSnapshot, action: string): Promise<{ available: boolean; credential?: string; reason?: string }>; }
export interface TestEnvironmentBroker { prepare(target: TargetSnapshot): Promise<{ available: boolean; environment?: Record<string, string>; reason?: string }>; }
export interface ExecutionBroker { execute(action: string, target: TargetSnapshot, request: DispatchRequest): Promise<AdapterResult>; }
export class SafeLocalCredentialBroker implements CredentialBroker { async acquire(): Promise<{ available: boolean; reason: string }> { return { available: false, reason: "No credentials are exposed by the safe local broker." }; } }
export class SafeLocalTestEnvironmentBroker implements TestEnvironmentBroker { async prepare(): Promise<{ available: boolean; reason: string }> { return { available: false, reason: "No verified disposable test-environment recipe is configured." }; } }
export class SafeLocalExecutionBroker implements ExecutionBroker { async execute(): Promise<AdapterResult> { return { outcome: "unavailable", detail: "Safe local broker does not execute filesystem, Git, process, credential, or network mutations." }; } }
export class DeterministicTestEnvironmentBroker implements TestEnvironmentBroker { async prepare(): Promise<{ available: boolean; environment: Record<string, string> }> { return { available: true, environment: { SXSY_TEST_MODE: "1", DATABASE_URL: "sqlite::memory:", SXSY_NETWORK: "deny" } }; } }
export class DeterministicExecutionBroker implements ExecutionBroker { readonly calls: string[] = []; async execute(action: string): Promise<AdapterResult> { this.calls.push(action); return { outcome: "passed", detail: "deterministic broker completed in isolated test mode" }; } }

export interface DispatchRequest {
  control: Control; modifier: Modifier; sessionId?: string; authorityId?: string; target?: TargetSnapshot; operationKey?: string; now?: number;
  /** Present only after the local UI has shown the exact action/target review. */
  reviewApproval?: { id: string; action: string; targetDigest: string; issuedAt: number; expiresAt: number; actor: string };
  commitMessage?: string;
}
export interface DispatchResult { status: OperationStatus | "unassigned"; assignment?: Assignment; reason: string; operationId?: string; }
export const maximumHeartbeatAgeMs = 60_000;
const highRisk = new Set(["COUNCIL:shift", "COMMIT:alt", "COMMIT:shift_alt", "COMPOUND:shift_alt", "PIPELINE:ctrl_shift_alt", "SHIELD:ctrl_shift_alt", "SANDBOX:alt", "SANDBOX:shift_alt", "SANDBOX:ctrl_shift_alt"]);
const requiresAuthority = new Set(["PLAN_APPROVAL", "AUTHORITY_REFRESH", "COMMIT", "COMPOUND", "PIPELINE", "SHIELD", "SANDBOX", "COUNCIL"]);
const requiresControllableProvider = new Set<Control>(["REANCHOR", "PROOF", "OPTION_PROVIDER", "PLAN_EXPANDER", "PLAN_APPROVAL", "HANDOFF", "AUTHORITY_REFRESH"]);
const requiresObservableProvider = new Set<Control>(["FIND_BLOCKED_AGENT", "FIND_FINISHED_AGENT", "COUNCIL"]);
export class OperationCoordinator {
  private readonly store: ProtectedStore; private readonly registry: SessionRegistry; private readonly authorities: AuthorityLedger; private readonly adapter: ExternalAdapter; private readonly execution: ExecutionBroker; private readonly testEnvironment: TestEnvironmentBroker;
  constructor(store: ProtectedStore, registry: SessionRegistry, authorities: AuthorityLedger, adapter: ExternalAdapter, execution: ExecutionBroker = new SafeLocalExecutionBroker(), testEnvironment: TestEnvironmentBroker = new SafeLocalTestEnvironmentBroker()) { this.store = store; this.registry = registry; this.authorities = authorities; this.adapter = adapter; this.execution = execution; this.testEnvironment = testEnvironment; }
  async recover(): Promise<void> { for (const operation of this.store.allOperations().filter((item) => item.status === "executing" || item.status === "external_committed")) { const result = await this.adapter.reconcile(operation); const status: OperationStatus = result.outcome === "passed" ? "recorded" : result.outcome === "unavailable" ? "unavailable" : "incomplete"; await this.store.putOperation({ ...operation, status, externalReference: result.externalReference ?? operation.externalReference, updatedAt: Date.now() }); await this.store.audit({ operationId: operation.id, action: operation.action, status, detail: `Recovery: ${result.detail}`, at: Date.now() }); } }
  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const assignment = assignmentFor(request.control, request.modifier); if (!assignment) return { status: "unassigned", reason: "This B122 chord is intentionally unassigned." };
    const session = request.sessionId ? this.registry.get(request.sessionId) : this.registry.active();
    if (!session) return { status: "blocked", assignment, reason: "No verified managed session is selected; picker-or-stop applies." };
    const now = request.now ?? Date.now();
    if (!capabilityReportIsConsistent(session.capability)) return { status: "blocked", assignment, reason: "The selected session capability report is internally inconsistent." };
    if (assignment.capability === "requires_mediation" && !session.capability.mediated) return { status: "blocked", assignment, reason: "This action requires a registered Mediated session; each capability must be separately proved." };
    if (session.status !== "running" || session.lastHeartbeat + maximumHeartbeatAgeMs < now) return { status: "blocked", assignment, reason: "The selected managed session is not currently running with a fresh capability heartbeat." };
    if (assignment.capability === "requires_mediation" && requiresControllableProvider.has(request.control) && !session.capability.controllable) return { status: "blocked", assignment, reason: "This action requires a Controllable provider session; mediation alone cannot pause or inject context." };
    if (assignment.capability === "requires_mediation" && requiresObservableProvider.has(request.control) && !session.capability.observable) return { status: "blocked", assignment, reason: "This action requires an Observable provider session; state cannot be inferred from a window." };
    const target = request.target ?? session.target; if (!target) return { status: "incomplete", assignment, reason: "A complete TargetSnapshot is required." };
    if (!session.target || !sameTarget(target, session.target)) return { status: "blocked", assignment, reason: "The selected TargetSnapshot changed or is stale; revalidate immediately before the operation." };
    const action = `${request.control}:${request.modifier}`;
    const key = request.operationKey ?? `${action}:${session.id}:${target.digest}`; const existing = this.store.operation(key);
    if (existing) {
      if (existing.action !== action || existing.targetDigest !== target.digest) return { status: "blocked", assignment, reason: "The supplied idempotency key belongs to a different action or target." };
      if (["prepared", "executing", "external_committed", "recorded"].includes(existing.status)) return { status: existing.status, assignment, reason: "An identical durable operation already exists; its status was focused.", operationId: existing.id };
    }
    if (this.store.isContained(target.digest) && request.control !== "SHIELD") return { status: "blocked", assignment, reason: "Durable containment blocks this brokered repository action." };
    if (requiresAuthority.has(request.control)) { const error = this.authorities.validate(request.authorityId, session, `${request.control}:${request.modifier}`, request.now); if (error) return { status: "blocked", assignment, reason: error }; }
    const candidate: DurableOperation = { id: randomUUID(), idempotencyKey: key, action, targetDigest: target.digest, status: "prepared", childIds: [], updatedAt: now };
    const created = await this.store.createOperation(candidate);
    if (!created.created) {
      const operation = created.operation;
      if (operation.action !== action || operation.targetDigest !== target.digest) return { status: "blocked", assignment, reason: "The supplied idempotency key belongs to a different action or target." };
      return { status: operation.status, assignment, reason: "An identical durable operation was created concurrently; its status was focused.", operationId: operation.id };
    }
    const operation = created.operation;
    await this.store.audit({ operationId: operation.id, action: operation.action, status: "prepared", detail: "Target and authority were validated.", at: now });
    if (highRisk.has(`${request.control}:${request.modifier}`)) {
      const blocked = { ...operation, status: "blocked" as const, updatedAt: Date.now() };
      await this.store.putOperation(blocked); await this.store.audit({ operationId: operation.id, action: operation.action, status: "blocked", detail: "Activation gate is not satisfied; no external action was attempted.", at: Date.now() });
      await this.store.receipt({ operationId: operation.id, outcome: "blocked", target, authorityVersion: session.authorityVersion, evidenceDigest: digest("activation gate unsatisfied"), policyVersion: target.policyVersion, createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
      return { status: "blocked", assignment, reason: "This high-consequence action has durable operation and audit machinery but remains disabled until documented adversarial and operational acceptance evidence is recorded.", operationId: operation.id };
    }
    if (request.control === "PIPELINE") {
      const environment = await this.testEnvironment.prepare(target);
      if (!environment.available) { const unavailable = { ...operation, status: "unavailable" as const, updatedAt: Date.now() }; const reason = environment.reason ?? "No verified isolated test environment."; await this.store.putOperation(unavailable); await this.store.audit({ operationId: operation.id, action: operation.action, status: "unavailable", detail: reason, at: Date.now() }); await this.store.receipt({ operationId: operation.id, outcome: "unavailable", target, authorityVersion: session.authorityVersion, evidenceDigest: digest(reason), policyVersion: target.policyVersion, createdAt: Date.now(), expiresAt: Date.now() + 60_000 }); return { status: "unavailable", assignment, reason, operationId: operation.id }; }
    }
    const executing = { ...operation, status: "executing" as const, updatedAt: Date.now() }; await this.store.putOperation(executing);
    const result = await this.execution.execute(operation.action, target, request); const status: OperationStatus = result.outcome === "passed" ? "recorded" : result.outcome === "unavailable" ? "unavailable" : result.outcome === "blocked" ? "blocked" : result.outcome === "incomplete" ? "incomplete" : "failed";
    const finished = { ...executing, status, externalReference: result.externalReference, updatedAt: Date.now() }; await this.store.putOperation(finished); await this.store.audit({ operationId: operation.id, action: operation.action, status, detail: result.detail, at: Date.now() });
    await this.store.receipt({ operationId: operation.id, outcome: result.outcome, target, authorityVersion: session.authorityVersion, evidenceDigest: digest(result), policyVersion: target.policyVersion, createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
    return { status, assignment, reason: result.detail, operationId: operation.id };
  }
  async child(parentId: string, action: string, target: TargetSnapshot): Promise<DurableOperation> {
    const parent = this.store.allOperations().find((item) => item.id === parentId);
    if (!parent) throw new Error("Parent operation is missing.");
    if (parent.targetDigest !== target.digest) throw new Error("Child operation target does not match its parent saga.");
    const candidate: DurableOperation = { id: randomUUID(), parentId, idempotencyKey: `${parentId}:${action}`, action, targetDigest: target.digest, status: "prepared", childIds: [], updatedAt: Date.now() };
    const created = await this.store.createOperation(candidate);
    const child = created.operation;
    if (child.parentId !== parentId || child.targetDigest !== target.digest) throw new Error("Child idempotency key belongs to a different saga or target.");
    if (!parent.childIds.includes(child.id)) await this.store.putOperation({ ...parent, childIds: [...parent.childIds, child.id], updatedAt: Date.now() });
    return child;
  }
}

/** Containment is durable and only governs traffic that actually uses the broker. */
export class ContainmentController {
  private readonly store: ProtectedStore;
  constructor(store: ProtectedStore) { this.store = store; }
  async activate(target: TargetSnapshot): Promise<void> { await this.store.contain(target.digest); }
  isActive(target: TargetSnapshot): boolean { return this.store.isContained(target.digest); }
  async release(target: TargetSnapshot, reauthenticated: boolean, reason: string): Promise<boolean> { return this.store.release(target.digest, reauthenticated, reason); }
}
