import { randomUUID } from "node:crypto";

import { redactText } from "./redaction.ts";
import { jsonClone, sha256, stableJson, type JournalEntry, type JsonStoreTransaction, ProtectedJsonStore } from "./store.ts";

/** States are durable bookkeeping only. This module never starts a process or timer. */
export type BudgetClaimState = "claimed" | "running" | "cancelling" | "timed_out" | "completed" | "failed" | "cancelled" | "expired";

export interface CommandBudget {
  /** Maximum simultaneously unresolved claims for this exact command class. */
  readonly maxConcurrent: number;
  /** Overall claim deadline. A running timeout remains occupied until reconciled. */
  readonly timeoutMs: number;
  /** Initial attempt plus explicit retries. */
  readonly maxAttempts: number;
  readonly windowMs: number;
  readonly maxClaimsPerWindow: number;
  readonly maxCostUnitsPerWindow: number;
  readonly defaultCostUnits: number;
}

export interface BudgetConfiguration {
  readonly version: string;
  readonly commandClasses: Readonly<Record<string, CommandBudget>>;
}

export interface BudgetConfigurationRecord extends BudgetConfiguration {
  readonly configuredAt: string;
  readonly digest: string;
}

export interface BudgetClaimRequest {
  /** Binds retries and duplicate presses to one durable dispatch operation. */
  readonly operationId: string;
  readonly commandClass: string;
  readonly costUnits?: number;
  /** Explicit only. The manager never schedules or infers a retry. */
  readonly retryOf?: string;
  readonly requestedBy?: string;
}

export interface BudgetClaim {
  readonly id: string;
  readonly operationId: string;
  readonly commandClass: string;
  readonly policyVersion: string;
  readonly attempt: number;
  readonly costUnits: number;
  readonly state: BudgetClaimState;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly retryOf?: string;
  readonly requestedBy?: string;
  readonly startedAt?: string;
  readonly cancellationRequestedAt?: string;
  readonly cancellationReason?: string;
  readonly timedOutAt?: string;
  readonly settledAt?: string;
  readonly failureReason?: string;
}

export interface BudgetDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly claim?: BudgetClaim;
  /** A duplicate press focused the existing durable claim rather than creating another. */
  readonly reused?: boolean;
}

export interface BudgetStatus {
  readonly known: boolean;
  readonly reason: string;
  readonly configuration?: BudgetConfigurationRecord;
  readonly limit?: CommandBudget;
  readonly activeClaims?: number;
  readonly claimsInWindow?: number;
  readonly costUnitsInWindow?: number;
}

interface ConfigurationSavedEvent { readonly configuration: BudgetConfigurationRecord; }
interface ClaimSavedEvent { readonly claim: BudgetClaim; }
interface DecisionRecordedEvent {
  readonly at: string;
  readonly operationId: string;
  readonly commandClass: string;
  readonly reason: string;
}

const states = new Set<BudgetClaimState>(["claimed", "running", "cancelling", "timed_out", "completed", "failed", "cancelled", "expired"]);
const terminalStates = new Set<BudgetClaimState>(["completed", "failed", "cancelled", "expired"]);
const activeStates = new Set<BudgetClaimState>(["claimed", "running", "cancelling", "timed_out"]);

export class BudgetConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetConfigurationError";
  }
}

export class BudgetLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetLedgerError";
  }
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new BudgetLedgerError(`${field} must be non-empty.`);
  return redactText(normalized);
}

function timestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new BudgetLedgerError(`${field} must be an ISO timestamp.`);
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new BudgetConfigurationError(`${field} must be a positive integer.`);
  return value;
}

function normalizedLimit(value: CommandBudget, commandClass: string): CommandBudget {
  if (!value || typeof value !== "object") throw new BudgetConfigurationError(`Budget for ${commandClass} is missing.`);
  return {
    maxConcurrent: positiveInteger(value.maxConcurrent, `${commandClass}.maxConcurrent`),
    timeoutMs: positiveInteger(value.timeoutMs, `${commandClass}.timeoutMs`),
    maxAttempts: positiveInteger(value.maxAttempts, `${commandClass}.maxAttempts`),
    windowMs: positiveInteger(value.windowMs, `${commandClass}.windowMs`),
    maxClaimsPerWindow: positiveInteger(value.maxClaimsPerWindow, `${commandClass}.maxClaimsPerWindow`),
    maxCostUnitsPerWindow: positiveInteger(value.maxCostUnitsPerWindow, `${commandClass}.maxCostUnitsPerWindow`),
    defaultCostUnits: positiveInteger(value.defaultCostUnits, `${commandClass}.defaultCostUnits`)
  };
}

function configurationMaterial(version: string, commandClasses: Readonly<Record<string, CommandBudget>>): Record<string, unknown> {
  return {
    version,
    commandClasses: Object.fromEntries(Object.keys(commandClasses).sort().map((commandClass) => [commandClass, commandClasses[commandClass]!]))
  };
}

function configurationDigest(version: string, commandClasses: Readonly<Record<string, CommandBudget>>): string {
  return sha256(stableJson(configurationMaterial(version, commandClasses)));
}

function normalizeConfiguration(configuration: BudgetConfiguration, configuredAt: string): BudgetConfigurationRecord {
  const version = nonEmpty(configuration.version, "budget configuration version");
  if (!configuration.commandClasses || typeof configuration.commandClasses !== "object" || Array.isArray(configuration.commandClasses)) {
    throw new BudgetConfigurationError("Budget configuration needs a command class map.");
  }
  const entries = Object.entries(configuration.commandClasses);
  if (entries.length === 0) throw new BudgetConfigurationError("Budget configuration needs at least one command class.");
  const commandClasses: Record<string, CommandBudget> = {};
  for (const [rawCommandClass, rawLimit] of entries) {
    const commandClass = nonEmpty(rawCommandClass, "command class");
    if (commandClasses[commandClass]) throw new BudgetConfigurationError(`Budget configuration duplicates command class ${commandClass}.`);
    commandClasses[commandClass] = normalizedLimit(rawLimit, commandClass);
  }
  const recordedAt = timestamp(configuredAt, "budget configuration timestamp");
  return {
    version,
    commandClasses: Object.fromEntries(Object.keys(commandClasses).sort().map((key) => [key, commandClasses[key]!])),
    configuredAt: recordedAt,
    digest: configurationDigest(version, commandClasses)
  };
}

function cloneConfiguration(configuration: BudgetConfigurationRecord): BudgetConfigurationRecord {
  return {
    ...configuration,
    commandClasses: Object.fromEntries(Object.entries(configuration.commandClasses).map(([name, limit]) => [name, { ...limit }]))
  };
}

function cloneClaim(claim: BudgetClaim): BudgetClaim {
  return { ...claim };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function persistedConfiguration(value: unknown): BudgetConfigurationRecord {
  if (!isRecord(value) || typeof value.version !== "string" || !isRecord(value.commandClasses) || typeof value.configuredAt !== "string" || typeof value.digest !== "string") {
    throw new BudgetConfigurationError("Protected budget configuration is malformed.");
  }
  const configuration = normalizeConfiguration({ version: value.version, commandClasses: value.commandClasses as Readonly<Record<string, CommandBudget>> }, value.configuredAt);
  if (configuration.digest !== value.digest) throw new BudgetConfigurationError("Protected budget configuration digest does not match its limits.");
  return configuration;
}

function configurations(entries: readonly JournalEntry<unknown>[]): readonly BudgetConfigurationRecord[] {
  const result: BudgetConfigurationRecord[] = [];
  for (const entry of entries) {
    if (entry.kind !== "budget.configuration.saved") continue;
    const configuration = persistedConfiguration((entry.payload as ConfigurationSavedEvent | undefined)?.configuration);
    const existing = result.find((candidate) => candidate.version === configuration.version);
    if (existing && existing.digest !== configuration.digest) {
      throw new BudgetConfigurationError(`Budget configuration version ${configuration.version} was mutated after recording.`);
    }
    result.push(configuration);
  }
  return result;
}

function currentConfiguration(entries: readonly JournalEntry<unknown>[]): BudgetConfigurationRecord | undefined {
  const recorded = configurations(entries);
  return recorded.at(-1);
}

function finiteString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new BudgetLedgerError(`Protected ${field} is malformed.`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return nonEmpty(finiteString(value, field), field);
}

function persistedClaim(value: unknown): BudgetClaim {
  if (!isRecord(value)) throw new BudgetLedgerError("Protected budget claim is malformed.");
  const state = finiteString(value.state, "claim state") as BudgetClaimState;
  if (!states.has(state)) throw new BudgetLedgerError("Protected budget claim state is invalid.");
  const claim: BudgetClaim = {
    id: nonEmpty(finiteString(value.id, "claim id"), "claim id"),
    operationId: nonEmpty(finiteString(value.operationId, "operation id"), "operation id"),
    commandClass: nonEmpty(finiteString(value.commandClass, "command class"), "command class"),
    policyVersion: nonEmpty(finiteString(value.policyVersion, "policy version"), "policy version"),
    attempt: typeof value.attempt === "number" && Number.isInteger(value.attempt) && value.attempt > 0 ? value.attempt : (() => { throw new BudgetLedgerError("Protected claim attempt is invalid."); })(),
    costUnits: typeof value.costUnits === "number" && Number.isInteger(value.costUnits) && value.costUnits > 0 ? value.costUnits : (() => { throw new BudgetLedgerError("Protected claim cost is invalid."); })(),
    state,
    createdAt: timestamp(finiteString(value.createdAt, "claim creation timestamp"), "claim creation timestamp"),
    expiresAt: timestamp(finiteString(value.expiresAt, "claim expiry timestamp"), "claim expiry timestamp"),
    ...(optionalString(value.retryOf, "retry source") ? { retryOf: optionalString(value.retryOf, "retry source") } : {}),
    ...(optionalString(value.requestedBy, "claim requester") ? { requestedBy: optionalString(value.requestedBy, "claim requester") } : {}),
    ...(optionalString(value.startedAt, "claim start timestamp") ? { startedAt: timestamp(optionalString(value.startedAt, "claim start timestamp")!, "claim start timestamp") } : {}),
    ...(optionalString(value.cancellationRequestedAt, "claim cancellation timestamp") ? { cancellationRequestedAt: timestamp(optionalString(value.cancellationRequestedAt, "claim cancellation timestamp")!, "claim cancellation timestamp") } : {}),
    ...(optionalString(value.cancellationReason, "claim cancellation reason") ? { cancellationReason: optionalString(value.cancellationReason, "claim cancellation reason") } : {}),
    ...(optionalString(value.timedOutAt, "claim timeout timestamp") ? { timedOutAt: timestamp(optionalString(value.timedOutAt, "claim timeout timestamp")!, "claim timeout timestamp") } : {}),
    ...(optionalString(value.settledAt, "claim settlement timestamp") ? { settledAt: timestamp(optionalString(value.settledAt, "claim settlement timestamp")!, "claim settlement timestamp") } : {}),
    ...(optionalString(value.failureReason, "claim failure reason") ? { failureReason: optionalString(value.failureReason, "claim failure reason") } : {})
  };
  if (Date.parse(claim.expiresAt) <= Date.parse(claim.createdAt)) throw new BudgetLedgerError("Protected claim expiry must be later than its creation.");
  if (claim.state === "running" && !claim.startedAt) throw new BudgetLedgerError("A running budget claim is missing its start timestamp.");
  if (claim.state === "cancelling" && !claim.cancellationRequestedAt) throw new BudgetLedgerError("A cancelling budget claim is missing its cancellation timestamp.");
  if (claim.state === "timed_out" && !claim.timedOutAt) throw new BudgetLedgerError("A timed-out budget claim is missing its timeout timestamp.");
  if (terminalStates.has(claim.state) && !claim.settledAt) throw new BudgetLedgerError("A terminal budget claim is missing its settlement timestamp.");
  return claim;
}

function claims(entries: readonly JournalEntry<unknown>[]): Map<string, BudgetClaim> {
  const result = new Map<string, BudgetClaim>();
  for (const entry of entries) {
    if (entry.kind !== "budget.claim.saved") continue;
    const claim = persistedClaim((entry.payload as ClaimSavedEvent | undefined)?.claim);
    const existing = result.get(claim.id);
    if (existing && (existing.operationId !== claim.operationId || existing.commandClass !== claim.commandClass || existing.createdAt !== claim.createdAt)) {
      throw new BudgetLedgerError(`Protected budget claim ${claim.id} changed its immutable identity.`);
    }
    result.set(claim.id, claim);
  }
  return result;
}

function claimIsActive(claim: BudgetClaim): boolean {
  return activeStates.has(claim.state);
}

function denial(reason: string): BudgetDecision {
  return { allowed: false, reason: redactText(reason) };
}

function request(input: BudgetClaimRequest): Required<Pick<BudgetClaimRequest, "operationId" | "commandClass">> & Pick<BudgetClaimRequest, "costUnits" | "retryOf" | "requestedBy"> {
  return {
    operationId: nonEmpty(input.operationId, "operation id"),
    commandClass: nonEmpty(input.commandClass, "command class"),
    ...(input.costUnits === undefined ? {} : { costUnits: positiveInteger(input.costUnits, "cost units") }),
    ...(input.retryOf ? { retryOf: nonEmpty(input.retryOf, "retry source") } : {}),
    ...(input.requestedBy ? { requestedBy: nonEmpty(input.requestedBy, "claim requester") } : {})
  };
}

function datePlus(timestampValue: string, durationMs: number): string {
  return new Date(Date.parse(timestampValue) + durationMs).toISOString();
}

function withinWindow(claim: BudgetClaim, now: string, windowMs: number): boolean {
  const created = Date.parse(claim.createdAt);
  const current = Date.parse(now);
  return created > current - windowMs && created <= current;
}

async function appendClaim(transaction: JsonStoreTransaction, claimsById: Map<string, BudgetClaim>, claim: BudgetClaim): Promise<void> {
  await transaction.append<ClaimSavedEvent>("budget.claim.saved", { claim });
  claimsById.set(claim.id, claim);
}

/**
 * A durable, explicit budget ledger. It makes admission decisions and records
 * state only: calling it cannot start, cancel, kill, retry, or otherwise run
 * a provider, terminal, CI job, or sandbox.
 */
export class DurableBudgetManager {
  private readonly store: ProtectedJsonStore;
  private readonly clock: () => string;
  private readonly idFactory: () => string;

  constructor(store: ProtectedJsonStore, options: { readonly clock?: () => string; readonly idFactory?: () => string } = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  /** Record a validated configuration. A new version is needed to change limits. */
  async configure(configuration: BudgetConfiguration): Promise<BudgetConfigurationRecord> {
    const next = normalizeConfiguration(configuration, this.clock());
    return this.store.transaction(async (transaction) => {
      const existing = configurations(await transaction.readEntries()).find((record) => record.version === next.version);
      if (existing) {
        if (existing.digest !== next.digest) throw new BudgetConfigurationError(`Budget configuration version ${next.version} already exists with different limits.`);
        return cloneConfiguration(existing);
      }
      await transaction.append<ConfigurationSavedEvent>("budget.configuration.saved", { configuration: next });
      return cloneConfiguration(next);
    });
  }

  async configuration(): Promise<BudgetConfigurationRecord | undefined> {
    const configuration = currentConfiguration(await this.store.readEntries());
    return configuration ? cloneConfiguration(configuration) : undefined;
  }

  /**
   * Atomically admits a claim. Missing, malformed, or absent command-class
   * configuration produces a durable denied decision rather than a fallback.
   */
  async claim(input: BudgetClaimRequest): Promise<BudgetDecision> {
    const parsed = request(input);
    const now = timestamp(this.clock(), "budget claim timestamp");
    return this.store.transaction(async (transaction) => {
      const entries = await transaction.readEntries();
      let configuration: BudgetConfigurationRecord | undefined;
      try {
        configuration = currentConfiguration(entries);
      } catch (error) {
        return this.recordDenial(transaction, parsed, now, `Budget configuration is invalid; unsafe claim denied: ${error instanceof Error ? error.message : "unknown configuration error"}`);
      }
      if (!configuration) return this.recordDenial(transaction, parsed, now, "No verified budget configuration is available; unsafe claim denied.");
      const limit = configuration.commandClasses[parsed.commandClass];
      if (!limit) return this.recordDenial(transaction, parsed, now, `No budget limit exists for command class ${parsed.commandClass}; unsafe claim denied.`);

      const claimsById = claims(entries);
      await this.expireDueWithin(transaction, claimsById, now);
      const operationClaims = [...claimsById.values()].filter((candidate) => candidate.operationId === parsed.operationId);
      if (operationClaims.some((candidate) => candidate.commandClass !== parsed.commandClass)) {
        return this.recordDenial(transaction, parsed, now, "A durable operation cannot be claimed under more than one command class.");
      }
      const activeForOperation = operationClaims.find(claimIsActive);
      if (activeForOperation) {
        if (!parsed.retryOf || activeForOperation.retryOf === parsed.retryOf) {
          return { allowed: true, reason: "Existing active budget claim focused; no duplicate operation was created.", claim: cloneClaim(activeForOperation), reused: true };
        }
        return this.recordDenial(transaction, parsed, now, "An operation already has an active budget claim; retry is not allowed until it is reconciled.");
      }

      let attempt = 1;
      if (parsed.retryOf) {
        const retrySource = claimsById.get(parsed.retryOf);
        if (!retrySource || retrySource.operationId !== parsed.operationId || retrySource.commandClass !== parsed.commandClass) {
          return this.recordDenial(transaction, parsed, now, "Retry source does not bind this operation and command class.");
        }
        const existingRetry = operationClaims.find((candidate) => candidate.retryOf === retrySource.id);
        if (existingRetry) return { allowed: true, reason: "Existing explicit retry focused; no duplicate retry was created.", claim: cloneClaim(existingRetry), reused: true };
        if (retrySource.state !== "failed") {
          return this.recordDenial(transaction, parsed, now, retrySource.state === "timed_out"
            ? "A timed-out claim must be externally reconciled before any retry can be considered."
            : "Only an explicitly failed claim may be retried; cancellation and unsettled states are not retry shortcuts.");
        }
        if (retrySource.policyVersion !== configuration.version) {
          return this.recordDenial(transaction, parsed, now, "Retry is denied because the original claim was admitted under a different budget policy version.");
        }
        attempt = Math.max(...operationClaims.map((claim) => claim.attempt)) + 1;
      } else if (operationClaims.length > 0) {
        return this.recordDenial(transaction, parsed, now, "A settled operation requires an explicit retry source; no automatic retry is permitted.");
      }
      if (attempt > limit.maxAttempts) return this.recordDenial(transaction, parsed, now, `Retry denied: attempt ${attempt} exceeds the ${limit.maxAttempts}-attempt budget.`);

      const activeInClass = [...claimsById.values()].filter((claim) => claim.commandClass === parsed.commandClass && claimIsActive(claim));
      if (activeInClass.length >= limit.maxConcurrent) {
        return this.recordDenial(transaction, parsed, now, `Concurrency budget exhausted for ${parsed.commandClass}; ${activeInClass.length}/${limit.maxConcurrent} unresolved claims are active.`);
      }
      const costUnits = parsed.costUnits ?? limit.defaultCostUnits;
      if (costUnits > limit.maxCostUnitsPerWindow) return this.recordDenial(transaction, parsed, now, "Requested claim cost exceeds the configured command-class cost budget.");
      const inWindow = [...claimsById.values()].filter((claim) => claim.commandClass === parsed.commandClass && withinWindow(claim, now, limit.windowMs));
      if (inWindow.length >= limit.maxClaimsPerWindow) {
        return this.recordDenial(transaction, parsed, now, `Claim quota exhausted for ${parsed.commandClass} in the configured window.`);
      }
      const costInWindow = inWindow.reduce((total, claim) => total + claim.costUnits, 0);
      if (costInWindow + costUnits > limit.maxCostUnitsPerWindow) {
        return this.recordDenial(transaction, parsed, now, `Cost budget exhausted for ${parsed.commandClass} in the configured window.`);
      }

      const id = nonEmpty(this.idFactory(), "budget claim id");
      if (claimsById.has(id)) throw new BudgetLedgerError(`Budget claim ID already exists: ${id}`);
      const claim: BudgetClaim = {
        id,
        operationId: parsed.operationId,
        commandClass: parsed.commandClass,
        policyVersion: configuration.version,
        attempt,
        costUnits,
        state: "claimed",
        createdAt: now,
        expiresAt: datePlus(now, limit.timeoutMs),
        ...(parsed.retryOf ? { retryOf: parsed.retryOf } : {}),
        ...(parsed.requestedBy ? { requestedBy: parsed.requestedBy } : {})
      };
      await appendClaim(transaction, claimsById, claim);
      return { allowed: true, reason: "Budget claim recorded; execution remains explicitly caller-controlled.", claim: cloneClaim(claim) };
    });
  }

  /** Mark that an already-admitted claim has actually been handed to a broker. */
  async start(id: string): Promise<BudgetDecision> {
    const claimId = nonEmpty(id, "budget claim id");
    const now = timestamp(this.clock(), "budget start timestamp");
    return this.store.transaction(async (transaction) => {
      const entries = await transaction.readEntries();
      const claimsById = claims(entries);
      const existing = claimsById.get(claimId);
      if (!existing) return denial(`Unknown budget claim: ${claimId}`);
      let configuration: BudgetConfigurationRecord | undefined;
      try {
        configuration = currentConfiguration(entries);
      } catch (error) {
        return denial(`Budget configuration is invalid; start denied: ${error instanceof Error ? error.message : "unknown configuration error"}`);
      }
      if (!configuration || configuration.version !== existing.policyVersion || !configuration.commandClasses[existing.commandClass]) {
        return denial("The claim's verified budget configuration is unavailable or changed; start denied.");
      }
      await this.expireDueWithin(transaction, claimsById, now);
      const current = claimsById.get(claimId)!;
      if (current.state === "running") return { allowed: true, reason: "Budget claim is already running.", claim: cloneClaim(current), reused: true };
      if (current.state !== "claimed") return denial(`Budget claim cannot start from ${current.state}.`);
      const running: BudgetClaim = { ...current, state: "running", startedAt: now };
      await appendClaim(transaction, claimsById, running);
      return { allowed: true, reason: "Budget claim marked running; this did not execute a command.", claim: cloneClaim(running) };
    });
  }

  /**
   * Record cancellation intent. For a running or timed-out external action the
   * state remains cancelling until a broker/reconciler records a final result.
   */
  async requestCancellation(id: string, reason: string): Promise<BudgetDecision> {
    const claimId = nonEmpty(id, "budget claim id");
    const now = timestamp(this.clock(), "budget cancellation timestamp");
    const cancellationReason = nonEmpty(reason, "cancellation reason");
    return this.store.transaction(async (transaction) => {
      const claimsById = claims(await transaction.readEntries());
      await this.expireDueWithin(transaction, claimsById, now);
      const current = claimsById.get(claimId);
      if (!current) return denial(`Unknown budget claim: ${claimId}`);
      if (current.state === "cancelled") return { allowed: true, reason: "Budget claim is already cancelled.", claim: cloneClaim(current), reused: true };
      if (terminalStates.has(current.state)) return denial(`Budget claim is already ${current.state}; cancellation cannot alter historical state.`);
      const next: BudgetClaim = current.state === "claimed"
        ? { ...current, state: "cancelled", cancellationRequestedAt: now, cancellationReason, settledAt: now }
        : { ...current, state: "cancelling", cancellationRequestedAt: current.cancellationRequestedAt ?? now, cancellationReason };
      await appendClaim(transaction, claimsById, next);
      return { allowed: true, reason: next.state === "cancelled" ? "Unstarted budget claim cancelled; no executor was invoked." : "Cancellation intent persisted; broker reconciliation is still required.", claim: cloneClaim(next), reused: current.state === "cancelling" };
    });
  }

  /** Persist a broker/reconciler's explicit final observation. It never invokes that broker. */
  async settle(id: string, outcome: "completed" | "failed" | "cancelled", detail?: string): Promise<BudgetDecision> {
    const claimId = nonEmpty(id, "budget claim id");
    const now = timestamp(this.clock(), "budget settlement timestamp");
    return this.store.transaction(async (transaction) => {
      const claimsById = claims(await transaction.readEntries());
      await this.expireDueWithin(transaction, claimsById, now);
      const current = claimsById.get(claimId);
      if (!current) return denial(`Unknown budget claim: ${claimId}`);
      if (terminalStates.has(current.state)) {
        if (current.state === outcome) return { allowed: true, reason: "Final budget state was already recorded.", claim: cloneClaim(current), reused: true };
        return denial(`Budget claim is already ${current.state}; a final state cannot be rewritten.`);
      }
      if (current.state === "claimed" && outcome !== "cancelled") {
        return denial("An unstarted budget claim cannot be recorded as externally completed or failed.");
      }
      const next: BudgetClaim = {
        ...current,
        state: outcome,
        settledAt: now,
        ...(outcome === "failed" && detail ? { failureReason: redactText(detail) } : {})
      };
      await appendClaim(transaction, claimsById, next);
      return { allowed: true, reason: "Broker/reconciler outcome recorded; no background retry will occur.", claim: cloneClaim(next) };
    });
  }

  /**
   * Explicit lifecycle sweep. Claimed work becomes expired (never started);
   * running work becomes timed_out and continues to occupy its concurrency slot
   * until an adapter/reconciler settles it. No timer invokes this automatically.
   */
  async expireDue(now = this.clock()): Promise<readonly BudgetClaim[]> {
    const timestampValue = timestamp(now, "budget expiry timestamp");
    return this.store.transaction(async (transaction) => {
      const claimsById = claims(await transaction.readEntries());
      return (await this.expireDueWithin(transaction, claimsById, timestampValue)).map(cloneClaim);
    });
  }

  async get(id: string): Promise<BudgetClaim | undefined> {
    const claim = claims(await this.store.readEntries()).get(nonEmpty(id, "budget claim id"));
    return claim ? cloneClaim(claim) : undefined;
  }

  async list(commandClass?: string): Promise<readonly BudgetClaim[]> {
    const normalized = commandClass === undefined ? undefined : nonEmpty(commandClass, "command class");
    return [...claims(await this.store.readEntries()).values()]
      .filter((claim) => normalized === undefined || claim.commandClass === normalized)
      .map(cloneClaim);
  }

  /** Safe UI/dispatch query; unknown or malformed policy remains visibly unavailable. */
  async status(commandClass: string, now = this.clock()): Promise<BudgetStatus> {
    const normalized = nonEmpty(commandClass, "command class");
    const timestampValue = timestamp(now, "budget status timestamp");
    const entries = await this.store.readEntries();
    let configuration: BudgetConfigurationRecord | undefined;
    try {
      configuration = currentConfiguration(entries);
    } catch (error) {
      return { known: false, reason: redactText(`Budget configuration is invalid: ${error instanceof Error ? error.message : "unknown error"}`) };
    }
    if (!configuration) return { known: false, reason: "No verified budget configuration is available." };
    const limit = configuration.commandClasses[normalized];
    if (!limit) return { known: false, reason: `No budget limit exists for command class ${normalized}.`, configuration: cloneConfiguration(configuration) };
    const all = [...claims(entries).values()].filter((claim) => claim.commandClass === normalized);
    const inWindow = all.filter((claim) => withinWindow(claim, timestampValue, limit.windowMs));
    return {
      known: true,
      reason: "Budget configuration is available; active claims remain caller-controlled.",
      configuration: cloneConfiguration(configuration),
      limit: { ...limit },
      activeClaims: all.filter(claimIsActive).length,
      claimsInWindow: inWindow.length,
      costUnitsInWindow: inWindow.reduce((total, claim) => total + claim.costUnits, 0)
    };
  }

  private async recordDenial(
    transaction: JsonStoreTransaction,
    input: Required<Pick<BudgetClaimRequest, "operationId" | "commandClass">> & Pick<BudgetClaimRequest, "costUnits" | "retryOf" | "requestedBy">,
    at: string,
    reason: string
  ): Promise<BudgetDecision> {
    const sanitized = redactText(reason);
    await transaction.append<DecisionRecordedEvent>("budget.decision.denied", {
      at,
      operationId: input.operationId,
      commandClass: input.commandClass,
      reason: sanitized
    });
    return denial(sanitized);
  }

  private async expireDueWithin(transaction: JsonStoreTransaction, claimsById: Map<string, BudgetClaim>, now: string): Promise<readonly BudgetClaim[]> {
    const expired: BudgetClaim[] = [];
    for (const current of [...claimsById.values()]) {
      if (!claimIsActive(current) || Date.parse(current.expiresAt) > Date.parse(now)) continue;
      const next: BudgetClaim = current.state === "claimed"
        ? { ...current, state: "expired", settledAt: now }
        : { ...current, state: "timed_out", timedOutAt: current.timedOutAt ?? now };
      if (next.state === current.state) continue;
      await appendClaim(transaction, claimsById, next);
      expired.push(next);
    }
    return expired;
  }
}
