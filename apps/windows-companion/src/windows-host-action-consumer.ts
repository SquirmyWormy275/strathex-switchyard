import { createHash, randomBytes } from "node:crypto";
import { win32 } from "node:path";

import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { CommandResult } from "../../../packages/control-plane/src/contracts.ts";
import type { JsonStoreTransaction, JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { HostActionAuthorizationPayload, HostActionCompletionPayload } from "./bridge.ts";
import type { HostActionIntent, LocalHostActionKind } from "./host-actions.ts";
import type { ExternalCompletionCapableMediatedCommandExecutor, HostActionCompletionRecord } from "./service.ts";

const claimKind = "b122.windows-host-action.claimed.v1";
const effectKind = "b122.windows-host-action.effect-started.v1";
const terminalKind = "b122.windows-host-action.terminal.v1";
const adapterVersion = "sxsy-b122.windows-host-action-consumer.v1";
const digestPattern = /^[a-f0-9]{64}$/;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9_.:+/-]{0,255}$/;
const maximumSummaryLength = 512;

export type CompanionWindowsHostAction = "focus_vscode" | "focus_external_terminal";
export type WindowsHostApplication = "vscode" | "terminal";
export type WindowsHostActionDisposition = "not_started" | "committed" | "ambiguous";

/**
 * Immutable executable identity installed by a separately reviewed Windows
 * provisioning boundary. No path, argument, product, or signer value comes
 * from a signal, host-action intent, VS Code request, or repository.
 */
export interface FixedWindowsHostApplicationIdentity {
  readonly version: 1;
  readonly application: WindowsHostApplication;
  readonly productId: "microsoft.visual-studio-code" | "microsoft.windows-terminal";
  readonly canonicalExecutablePath: string;
  readonly executableSha256: string;
  readonly signerSubject: string;
  readonly signerThumbprint: string;
  readonly size: number;
  readonly modifiedMs: number;
  readonly device: string;
  readonly inode: string;
}

export interface WindowsHostActionEffectRequest {
  readonly action: CompanionWindowsHostAction;
  readonly application: WindowsHostApplication;
  readonly hostActionId: string;
  readonly operationId: string;
  readonly executable: FixedWindowsHostApplicationIdentity;
  /** Compiled arguments only. The caller cannot add a URI, command, or path. */
  readonly fixedArguments: readonly string[];
  readonly processOwner: "current-user";
  readonly processSession: "current-session";
  readonly windowSurface: "visible-top-level";
  /** Protected repeat cursor. VS Code cycles by this ordinal; Terminal is always zero. */
  readonly windowCycleOrdinal: number;
  readonly shell: false;
  readonly signal: AbortSignal;
  /**
   * The pinned native port must hold and revalidate the exact executable,
   * process-owner, session, and window identities before calling this once,
   * immediately before SetForegroundWindow or fixed CreateProcess.
   */
  beforeEffect(): Promise<void>;
}

export interface WindowsHostActionEffectResult {
  readonly disposition: WindowsHostActionDisposition;
  readonly summary: string;
}

/**
 * Trust boundary for a separately packaged, digest-pinned Windows helper.
 * Implementations must use current-user process-token and top-level-window
 * APIs; PATH lookup, shell execution, caller arguments, and repository state
 * are forbidden by the closed request contract above.
 */
export interface WindowsHostActionEffectPort {
  execute(request: WindowsHostActionEffectRequest): Promise<WindowsHostActionEffectResult>;
}

export interface WindowsHostActionQueuePort {
  listPending(): Promise<readonly HostActionIntent[]>;
  listSettled(): Promise<readonly HostActionCompletionRecord[]>;
  authorize(payload: HostActionAuthorizationPayload): Promise<Readonly<{
    hostActionId: string;
    authorizationToken: string;
    expiresAt: string;
  }>>;
  settle(payload: HostActionCompletionPayload): Promise<HostActionCompletionRecord>;
}

export interface CompanionWindowsHostActionConsumerOptions {
  readonly applications: Readonly<Partial<Record<WindowsHostApplication, FixedWindowsHostApplicationIdentity>>>;
  readonly pollIntervalMs?: number;
  readonly effectTimeoutMs?: number;
  readonly repeatWindowMs?: number;
  readonly now?: () => string;
  readonly claimTokenFactory?: () => string;
}

interface ConsumerClaim extends Record<string, JsonValue> {
  readonly version: 1;
  readonly claimId: string;
  readonly claimToken: string;
  readonly hostActionId: string;
  readonly operationId: string;
  readonly commandAction: CommandAction;
  readonly hostAction: CompanionWindowsHostAction;
  readonly application: WindowsHostApplication;
  readonly executableIdentityDigest: string;
  readonly windowCycleOrdinal: number;
  readonly claimedAt: string;
}

interface EffectStarted extends Record<string, JsonValue> {
  readonly version: 1;
  readonly claimId: string;
  readonly claimToken: string;
  readonly startedAt: string;
}

interface ConsumerTerminal {
  readonly version: 1;
  readonly claimId: string;
  readonly claimToken: string;
  readonly outcome: "settled" | "yielded" | "reconciled";
  readonly disposition: WindowsHostActionDisposition;
  readonly completionStatus?: HostActionCompletionRecord["status"];
  readonly summary: string;
  readonly completedAt: string;
}

interface ClaimState {
  readonly claim: ConsumerClaim;
  effect?: EffectStarted;
  terminal?: ConsumerTerminal;
}

interface EffectPlan {
  readonly action: CompanionWindowsHostAction;
  readonly application: WindowsHostApplication;
  readonly fixedArguments: readonly string[];
}

const effectPlans: Readonly<Record<"focus_vscode" | "focus_terminal", EffectPlan>> = Object.freeze({
  focus_vscode: Object.freeze({ action: "focus_vscode", application: "vscode", fixedArguments: Object.freeze(["--reuse-window"]) }),
  focus_terminal: Object.freeze({ action: "focus_external_terminal", application: "terminal", fixedArguments: Object.freeze([]) })
});

/**
 * Companion-owned consumer for the two Windows-global, authority-free focus
 * actions. Voice Center deliberately remains queued for a real extension UI
 * acknowledgement; launching Code is not treated as opening that UI.
 *
 * The consumer claim and host-action authorization are both durable before an
 * effect barrier can open. A claim that crossed the effect barrier is never
 * replayed after an exception, timeout, stop, or restart.
 */
export class CompanionWindowsHostActionConsumer {
  private readonly store: ProtectedJsonStore;
  private readonly queue: WindowsHostActionQueuePort;
  private readonly executor: ExternalCompletionCapableMediatedCommandExecutor;
  private readonly effects: WindowsHostActionEffectPort;
  private readonly applications: Readonly<Partial<Record<WindowsHostApplication, FixedWindowsHostApplicationIdentity>>>;
  private readonly pollIntervalMs: number;
  private readonly effectTimeoutMs: number;
  private readonly repeatWindowMs: number;
  private readonly now: () => string;
  private readonly claimTokenFactory: () => string;
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  private activeAbort: AbortController | undefined;
  private starting: Promise<void> | undefined;
  private startAbort: AbortController | undefined;
  private stopping: Promise<void> | undefined;
  private readonly ignored = new Set<string>();

  constructor(
    store: ProtectedJsonStore,
    queue: WindowsHostActionQueuePort,
    executor: ExternalCompletionCapableMediatedCommandExecutor,
    effects: WindowsHostActionEffectPort,
    options: CompanionWindowsHostActionConsumerOptions
  ) {
    this.store = store;
    this.queue = queue;
    this.executor = executor;
    this.effects = effects;
    this.applications = Object.freeze({
      ...(options.applications.vscode ? { vscode: validateApplicationIdentity(options.applications.vscode, "vscode") } : {}),
      ...(options.applications.terminal ? { terminal: validateApplicationIdentity(options.applications.terminal, "terminal") } : {})
    });
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    this.effectTimeoutMs = options.effectTimeoutMs ?? 10_000;
    this.repeatWindowMs = options.repeatWindowMs ?? 1_500;
    this.now = options.now ?? (() => new Date().toISOString());
    this.claimTokenFactory = options.claimTokenFactory ?? (() => randomBytes(32).toString("base64url"));
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 10 || this.pollIntervalMs > 60_000) {
      throw new Error("The Windows host-action polling interval is outside safe bounds.");
    }
    if (!Number.isSafeInteger(this.effectTimeoutMs) || this.effectTimeoutMs < 50 || this.effectTimeoutMs > 60_000) {
      throw new Error("The Windows host-action effect timeout is outside safe bounds.");
    }
    if (!Number.isSafeInteger(this.repeatWindowMs) || this.repeatWindowMs < 50 || this.repeatWindowMs > 30_000) {
      throw new Error("The Windows host-action repeat window is outside safe bounds.");
    }
  }

  async start(): Promise<void> {
    if (this.stopping) await this.stopping;
    if (this.running) return;
    if (this.starting) return this.starting;
    const abort = new AbortController();
    this.startAbort = abort;
    const starting = (async () => {
      try {
        await this.recover(abort.signal);
        if (abort.signal.aborted) return;
        this.running = true;
        this.kick();
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      }
    })();
    this.starting = starting;
    try { await starting; }
    finally {
      if (this.starting === starting) this.starting = undefined;
      if (this.startAbort === abort) this.startAbort = undefined;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.startAbort?.abort(new Error("Windows host-action consumer startup stopped."));
    this.activeAbort?.abort(new Error("Windows host-action consumer stopped."));
    const starting = this.starting;
    const active = this.active;
    if (!active && !starting) return;
    const stopping = Promise.allSettled([...(starting ? [starting] : []), ...(active ? [active] : [])]).then(() => undefined);
    this.stopping = stopping;
    try { await stopping; }
    finally { if (this.stopping === stopping) this.stopping = undefined; }
  }

  /** Read-only-safe startup reconciliation; it never invokes the effect port. */
  async recover(signal?: AbortSignal): Promise<void> {
    const states = await boundedCoordination(consumerStates(this.store), signal, this.effectTimeoutMs, "Windows host-action recovery journal read");
    const settledRecords = await boundedCoordination(this.queue.listSettled(), signal, this.effectTimeoutMs, "Windows host-action settled-record read");
    const settled = new Map(settledRecords.map((record) => [record.hostActionId, record]));
    for (const state of states.values()) {
      if (state.terminal) continue;
      const completed = settled.get(state.claim.hostActionId);
      if (completed) {
        await boundedCoordination(
          this.completeExternalAndRecord(state.claim, completed, "reconciled", completed.status === "completed" ? "committed" : completed.status === "incomplete" ? "ambiguous" : "not_started"),
          signal,
          this.effectTimeoutMs,
          "Windows host-action external recovery completion"
        );
        continue;
      }
      if (state.effect) {
        const record = await boundedCoordination(this.queue.settle({
            hostActionId: state.claim.hostActionId,
            succeeded: false,
            effectDisposition: "ambiguous",
            summary: "The Windows host action crossed its durable effect boundary before restart; its outcome is ambiguous and it was not replayed.",
            adapterVersion
          }), signal, this.effectTimeoutMs, "Windows host-action ambiguous recovery settlement");
        await boundedCoordination(
          this.completeExternalAndRecord(state.claim, record, "reconciled", "ambiguous"),
          signal,
          this.effectTimeoutMs,
          "Windows host-action ambiguous external recovery completion"
        );
        continue;
      }
      // A lost authorization response can be indistinguishable from another
      // consumer winning the queue's one-time authorization. Preserve it as a
      // reconciliation-required yield; never settle over that other consumer.
      await this.appendTerminal(state.claim, "yielded", "ambiguous", "The consumer claim ended before its effect boundary; authorization ownership is unresolved and no effect was replayed.");
    }
  }

  private kick(): void {
    if (!this.running || this.active) return;
    const abort = new AbortController();
    this.activeAbort = abort;
    const task = this.drainAvailable(abort).catch(() => undefined);
    this.active = task;
    void task.finally(() => {
      if (this.active === task) this.active = undefined;
      if (this.activeAbort === abort) this.activeAbort = undefined;
      if (this.running) this.schedule();
    });
  }

  private schedule(): void {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.kick();
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  private async drainAvailable(abort: AbortController): Promise<void> {
    while (this.running && !abort.signal.aborted) {
      const pending = await boundedCoordination(this.queue.listPending(), abort.signal, this.effectTimeoutMs, "Windows host-action pending-record read");
      const states = await boundedCoordination(consumerStates(this.store), abort.signal, this.effectTimeoutMs, "Windows host-action claim-record read");
      const next = pending
        .filter((intent) => runtimeIntentRecord(intent) && ownedCommand(intent.commandAction))
        .filter((intent) => !states.has(safeIntentText(intent.id)) && !this.ignored.has(ignoredIntentKey(intent)))
        .sort((left, right) => safeIntentText(left.createdAt).localeCompare(safeIntentText(right.createdAt)) || safeIntentText(left.id).localeCompare(safeIntentText(right.id)))[0];
      if (!next) return;
      const validated = effectIntent(next);
      if (!validated) {
        this.ignored.add(ignoredIntentKey(next));
        continue;
      }
      await this.dispatch(next, validated, abort);
    }
  }

  private async dispatch(intent: HostActionIntent, plan: EffectPlan, abort: AbortController): Promise<void> {
    const identity = this.applications[plan.application];
    const executableIdentityDigest = identity ? identityDigest(identity) : digest(`unavailable:${plan.application}`);
    const claim = await this.claim(intent, plan, executableIdentityDigest);
    if (!claim) return;

    let authorization: Awaited<ReturnType<WindowsHostActionQueuePort["authorize"]>>;
    try {
      authorization = await boundedCoordination(
        this.queue.authorize({ hostActionId: intent.id, adapterVersion }),
        abort.signal,
        this.effectTimeoutMs,
        "Windows host-action authorization"
      );
    } catch {
      // The queue authorization is the cross-consumer single-effect fence. A
      // rejection can mean the extension won, or that the append committed and
      // its response was lost. Never overwrite that winner with a false failure.
      await this.appendTerminal(claim, "yielded", "ambiguous", "The one-time host-action authorization was unavailable or already owned; no Windows effect was requested by this consumer.");
      return;
    }

    let barrierCrossed = false;
    let barrierCalls = 0;
    let disposition: WindowsHostActionDisposition;
    let summary: string;
    if (!identity) {
      disposition = "not_started";
      summary = `The reviewed Windows ${plan.application} application is unavailable; no host effect was admitted.`;
    } else try {
      const request: WindowsHostActionEffectRequest = Object.freeze({
        action: plan.action,
        application: plan.application,
        hostActionId: intent.id,
        operationId: intent.operationId,
        executable: identity,
        fixedArguments: plan.fixedArguments,
        processOwner: "current-user",
        processSession: "current-session",
        windowSurface: "visible-top-level",
        windowCycleOrdinal: claim.windowCycleOrdinal,
        shell: false,
        signal: abort.signal,
        beforeEffect: async () => {
          barrierCalls += 1;
          if (barrierCalls !== 1) throw new Error("The Windows effect barrier is single-use.");
          if (!this.running || abort.signal.aborted) throw new Error("The Windows effect was cancelled before its durable boundary.");
          await this.appendEffectStarted(claim);
          if (!this.running || abort.signal.aborted) throw new Error("The Windows effect was cancelled at its durable boundary.");
          barrierCrossed = true;
        }
      });
      const outcome = await boundedEffect(this.effects.execute(request), abort, this.effectTimeoutMs);
      if (outcome.kind === "timeout") {
        disposition = barrierCrossed ? "ambiguous" : "not_started";
        summary = barrierCrossed
          ? "The bounded Windows host action did not settle after its durable effect boundary; manual reconciliation is required."
          : "The bounded Windows host action timed out before its effect boundary; no effect was admitted.";
      } else if (outcome.kind === "aborted") {
        disposition = barrierCrossed ? "ambiguous" : "not_started";
        summary = barrierCrossed
          ? "Shutdown interrupted the Windows host action after its durable effect boundary; manual reconciliation is required."
          : "Shutdown cancelled the Windows host action before its effect boundary; no effect was admitted.";
      } else {
        const result = validateEffectResult(outcome.value);
        if (!barrierCrossed && result.disposition !== "not_started") {
          disposition = "not_started";
          summary = "The Windows effect port returned without crossing the required durable effect barrier; no completion claim was accepted.";
        } else {
          disposition = result.disposition;
          summary = result.summary;
        }
      }
    } catch {
      disposition = barrierCrossed ? "ambiguous" : "not_started";
      summary = barrierCrossed
        ? "The Windows host action failed after its durable effect boundary; its outcome is ambiguous and it will not be replayed."
        : "The Windows host action failed before its effect boundary; no effect was admitted.";
    } finally { /* the drain owns the shared cancellation epoch */ }

    const succeeded = disposition === "committed";
    let record: HostActionCompletionRecord;
    try {
      record = await boundedCoordination(
        this.queue.settle({
          hostActionId: intent.id,
          succeeded,
          effectDisposition: disposition,
          summary,
          adapterVersion,
          authorizationToken: authorization.authorizationToken
        }),
        undefined,
        this.effectTimeoutMs,
        "Windows host-action settlement"
      );
    } catch {
      // The effect-started journal record remains authoritative for startup
      // recovery. A possibly committed effect is never forwarded a second time.
      return;
    }
    await boundedCoordination(
      this.completeExternalAndRecord(claim, record, "settled", disposition),
      undefined,
      this.effectTimeoutMs,
      "Windows host-action external completion"
    ).catch(() => undefined);
  }

  private async claim(intent: HostActionIntent, plan: EffectPlan, executableIdentityDigest: string): Promise<ConsumerClaim | undefined> {
    const claimToken = boundedClaimToken(this.claimTokenFactory());
    const claimedAt = exactTimestamp(this.now(), "Windows host-action claim time");
    return this.store.transaction(async (transaction) => {
      const states = await statesFrom(transaction);
      if (states.has(intent.id)) return undefined;
      const prior = [...states.values()]
        .map((state) => state.claim)
        .filter((candidate) => candidate.hostAction === "focus_vscode" && Date.parse(candidate.claimedAt) <= Date.parse(claimedAt))
        .sort((left, right) => right.claimedAt.localeCompare(left.claimedAt) || right.hostActionId.localeCompare(left.hostActionId))[0];
      const repeated = plan.action === "focus_vscode" && prior !== undefined
        && Date.parse(claimedAt) - Date.parse(prior.claimedAt) <= this.repeatWindowMs;
      const windowCycleOrdinal = repeated ? (prior.windowCycleOrdinal + 1) % 65_536 : 0;
      const claim: ConsumerClaim = {
        version: 1,
        claimId: `windows-host-action-claim:${digest(`${intent.id}:${executableIdentityDigest}`)}`,
        claimToken,
        hostActionId: intent.id,
        operationId: intent.operationId,
        commandAction: intent.commandAction,
        hostAction: plan.action,
        application: plan.application,
        executableIdentityDigest,
        windowCycleOrdinal,
        claimedAt
      };
      await transaction.append(claimKind, claim);
      return claim;
    });
  }

  private async appendEffectStarted(claim: ConsumerClaim): Promise<void> {
    await this.store.transaction(async (transaction) => {
      const state = (await statesFrom(transaction)).get(claim.hostActionId);
      exactLiveClaim(state, claim);
      if (state!.effect) throw new Error("The Windows host-action effect boundary was already crossed.");
      await transaction.append(effectKind, {
        version: 1,
        claimId: claim.claimId,
        claimToken: claim.claimToken,
        startedAt: exactTimestamp(this.now(), "Windows host-action effect time")
      } satisfies EffectStarted);
    });
  }

  private async completeExternalAndRecord(
    claim: ConsumerClaim,
    record: HostActionCompletionRecord,
    outcome: ConsumerTerminal["outcome"],
    disposition: WindowsHostActionDisposition
  ): Promise<CommandResult> {
    const result = await this.executor.completeExternalOperation(record);
    await this.appendTerminal(claim, outcome, disposition, record.summary, record.status);
    return result;
  }

  private async appendTerminal(
    claim: ConsumerClaim,
    outcome: ConsumerTerminal["outcome"],
    disposition: WindowsHostActionDisposition,
    summaryInput: string,
    completionStatus?: HostActionCompletionRecord["status"]
  ): Promise<void> {
    const summary = boundedSummary(summaryInput);
    await this.store.transaction(async (transaction) => {
      const state = (await statesFrom(transaction)).get(claim.hostActionId);
      if (!state || !sameClaim(state.claim, claim)) throw new Error("The Windows host-action terminal record changed its durable claim binding.");
      if (state.terminal) {
        if (state.terminal.outcome !== outcome || state.terminal.disposition !== disposition
          || state.terminal.summary !== summary || state.terminal.completionStatus !== completionStatus) {
          throw new Error("The Windows host-action terminal outcome conflicts with its durable record.");
        }
        return;
      }
      await transaction.append(terminalKind, {
        version: 1,
        claimId: claim.claimId,
        claimToken: claim.claimToken,
        outcome,
        disposition,
        ...(completionStatus ? { completionStatus } : {}),
        summary,
        completedAt: exactTimestamp(this.now(), "Windows host-action completion time")
      } satisfies ConsumerTerminal);
    });
  }
}

async function boundedEffect(
  effect: Promise<WindowsHostActionEffectResult>,
  abort: AbortController,
  timeoutMs: number
): Promise<Readonly<{ kind: "result"; value: WindowsHostActionEffectResult }> | Readonly<{ kind: "timeout" }> | Readonly<{ kind: "aborted" }>> {
  effect.then(() => undefined, () => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<Readonly<{ kind: "timeout" }>>((resolveTimeout) => {
    timer = setTimeout(() => {
      abort.abort(new Error("Windows host-action effect timed out."));
      resolveTimeout({ kind: "timeout" });
    }, timeoutMs);
    timer.unref?.();
  });
  const cancelled = new Promise<Readonly<{ kind: "aborted" }>>((resolveAbort) => {
    onAbort = () => resolveAbort({ kind: "aborted" });
    if (abort.signal.aborted) onAbort();
    else abort.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      effect.then((value) => ({ kind: "result" as const, value })),
      timeout,
      cancelled
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) abort.signal.removeEventListener("abort", onAbort);
  }
}

async function boundedCoordination<T>(promise: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number, label: string): Promise<T> {
  // A store/queue implementation may ignore cancellation. Keep late handlers
  // attached so stop and startup cannot hang or create an unhandled rejection.
  promise.then(() => undefined, () => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, rejectTimeout) => {
    timer = setTimeout(() => rejectTimeout(new Error(`${label} timed out.`)), timeoutMs);
    timer.unref?.();
  });
  const cancelled = new Promise<never>((_resolve, rejectAbort) => {
    if (!signal) return;
    onAbort = () => rejectAbort(new Error(`${label} was cancelled.`));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([promise, timeout, cancelled]); }
  finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function consumerStates(store: ProtectedJsonStore): Promise<Map<string, ClaimState>> {
  return store.transaction(async (transaction) => statesFrom(transaction));
}

async function statesFrom(transaction: JsonStoreTransaction): Promise<Map<string, ClaimState>> {
  const entries = await transaction.readEntries<JsonValue>();
  const states = new Map<string, ClaimState>();
  const claimsById = new Map<string, ClaimState>();
  for (const entry of entries) {
    if (entry.kind === claimKind) {
      const claim = parseClaim(entry.payload);
      if (states.has(claim.hostActionId) || claimsById.has(claim.claimId)) throw new Error("The protected Windows host-action journal contains a duplicate claim.");
      const state: ClaimState = { claim };
      states.set(claim.hostActionId, state);
      claimsById.set(claim.claimId, state);
      continue;
    }
    if (entry.kind === effectKind) {
      const effect = parseEffect(entry.payload);
      const state = claimsById.get(effect.claimId);
      if (!state || state.claim.claimToken !== effect.claimToken || state.effect || state.terminal) throw new Error("The protected Windows host-action effect record is orphaned or conflicting.");
      state.effect = effect;
      continue;
    }
    if (entry.kind === terminalKind) {
      const terminal = parseTerminal(entry.payload);
      const state = claimsById.get(terminal.claimId);
      if (!state || state.claim.claimToken !== terminal.claimToken || state.terminal) throw new Error("The protected Windows host-action terminal record is orphaned or conflicting.");
      state.terminal = terminal;
    }
  }
  return states;
}

function parseClaim(value: JsonValue): ConsumerClaim {
  const record = exactRecord(value, ["version", "claimId", "claimToken", "hostActionId", "operationId", "commandAction", "hostAction", "application", "executableIdentityDigest", "windowCycleOrdinal", "claimedAt"], "claim");
  if (record.version !== 1 || typeof record.claimId !== "string" || !/^windows-host-action-claim:[a-f0-9]{64}$/.test(record.claimId)
    || typeof record.claimToken !== "string" || typeof record.hostActionId !== "string" || typeof record.operationId !== "string"
    || typeof record.commandAction !== "string" || typeof record.hostAction !== "string" || typeof record.application !== "string"
    || typeof record.executableIdentityDigest !== "string" || !digestPattern.test(record.executableIdentityDigest)
    || !Number.isSafeInteger(record.windowCycleOrdinal) || (record.windowCycleOrdinal as number) < 0 || (record.windowCycleOrdinal as number) > 65_535
    || typeof record.claimedAt !== "string") throw new Error("The protected Windows host-action claim is malformed.");
  boundedClaimToken(record.claimToken);
  boundedHostActionId(record.hostActionId);
  boundedReference(record.operationId, "operation ID");
  const plan = effectPlans[record.commandAction as keyof typeof effectPlans];
  if (!plan || plan.action !== record.hostAction || plan.application !== record.application) throw new Error("The protected Windows host-action claim changed its closed action mapping.");
  if (plan.action === "focus_external_terminal" && record.windowCycleOrdinal !== 0) throw new Error("The protected Windows Terminal host-action claim carried a forbidden cycle ordinal.");
  exactTimestamp(record.claimedAt, "Windows host-action claim time");
  return record as unknown as ConsumerClaim;
}

function parseEffect(value: JsonValue): EffectStarted {
  const record = exactRecord(value, ["version", "claimId", "claimToken", "startedAt"], "effect");
  if (record.version !== 1 || typeof record.claimId !== "string" || !/^windows-host-action-claim:[a-f0-9]{64}$/.test(record.claimId)
    || typeof record.claimToken !== "string" || typeof record.startedAt !== "string") throw new Error("The protected Windows host-action effect record is malformed.");
  boundedClaimToken(record.claimToken);
  exactTimestamp(record.startedAt, "Windows host-action effect time");
  return record as unknown as EffectStarted;
}

function parseTerminal(value: JsonValue): ConsumerTerminal {
  const allowed = ["version", "claimId", "claimToken", "outcome", "disposition", "completionStatus", "summary", "completedAt"];
  const record = exactRecord(value, allowed, "terminal", ["completionStatus"]);
  if (record.version !== 1 || typeof record.claimId !== "string" || !/^windows-host-action-claim:[a-f0-9]{64}$/.test(record.claimId)
    || typeof record.claimToken !== "string" || !["settled", "yielded", "reconciled"].includes(String(record.outcome))
    || !isDisposition(record.disposition) || (record.completionStatus !== undefined && !["completed", "failed", "incomplete"].includes(String(record.completionStatus)))
    || typeof record.summary !== "string" || typeof record.completedAt !== "string") throw new Error("The protected Windows host-action terminal record is malformed.");
  boundedClaimToken(record.claimToken);
  boundedSummary(record.summary);
  exactTimestamp(record.completedAt, "Windows host-action completion time");
  return record as unknown as ConsumerTerminal;
}

function effectIntent(intent: HostActionIntent): EffectPlan | undefined {
  try {
    const expectedKeys = ["version", "id", "operationId", "commandAction", "hostAction", "createdAt", "expiresAt"];
    if (!sameKeys(intent as unknown as Record<string, unknown>, expectedKeys) || intent.version !== 1) return undefined;
    const plan = effectPlans[intent.commandAction as keyof typeof effectPlans];
    if (!plan || intent.hostAction !== plan.action) return undefined;
    boundedHostActionId(intent.id);
    boundedReference(intent.operationId, "operation ID");
    if (intent.id !== `host-action:${digest(`${intent.operationId}:${intent.commandAction}`)}`) return undefined;
    const createdAt = Date.parse(exactTimestamp(intent.createdAt, "host-action creation time"));
    const expiresAt = Date.parse(exactTimestamp(intent.expiresAt, "host-action expiration time"));
    if (expiresAt <= createdAt) return undefined;
    return plan;
  } catch { return undefined; }
}

function ownedCommand(action: CommandAction): action is "focus_vscode" | "focus_terminal" {
  return action === "focus_vscode" || action === "focus_terminal";
}

function runtimeIntentRecord(value: unknown): value is HostActionIntent {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as { commandAction?: unknown }).commandAction === "string";
}

function safeIntentText(value: unknown): string { return typeof value === "string" ? value : ""; }

function ignoredIntentKey(intent: HostActionIntent): string {
  const id = safeIntentText((intent as { id?: unknown }).id);
  if (id.length >= 1 && id.length <= 256 && !/[\0\r\n]/u.test(id)) return id;
  return `invalid:${digest(JSON.stringify(intent).slice(0, 16_384))}`;
}

function validateApplicationIdentity(value: FixedWindowsHostApplicationIdentity, application: WindowsHostApplication): FixedWindowsHostApplicationIdentity {
  const expectedProduct = application === "vscode" ? "microsoft.visual-studio-code" : "microsoft.windows-terminal";
  if (!sameKeys(value as unknown as Record<string, unknown>, ["version", "application", "productId", "canonicalExecutablePath", "executableSha256", "signerSubject", "signerThumbprint", "size", "modifiedMs", "device", "inode"])
    || value.version !== 1 || value.application !== application || value.productId !== expectedProduct
    || !win32.isAbsolute(value.canonicalExecutablePath) || /[\0\r\n"]/u.test(value.canonicalExecutablePath) || !/\.exe$/i.test(value.canonicalExecutablePath)
    || !digestPattern.test(value.executableSha256) || !/^[A-Fa-f0-9]{40,64}$/.test(value.signerThumbprint)
    || !boundedText(value.signerSubject, 240) || !Number.isSafeInteger(value.size) || value.size < 1
    || !Number.isSafeInteger(value.modifiedMs) || value.modifiedMs < 1
    || !/^\d{1,32}$/.test(value.device) || !/^\d{1,32}$/.test(value.inode)) {
    throw new Error(`The fixed ${application} executable identity is invalid.`);
  }
  return Object.freeze({ ...value, signerThumbprint: value.signerThumbprint.toLowerCase(), executableSha256: value.executableSha256.toLowerCase() });
}

function validateEffectResult(value: WindowsHostActionEffectResult): WindowsHostActionEffectResult {
  if (!value || typeof value !== "object" || !sameKeys(value as unknown as Record<string, unknown>, ["disposition", "summary"])
    || !isDisposition(value.disposition) || typeof value.summary !== "string") throw new Error("The Windows host-action effect result is malformed.");
  return Object.freeze({ disposition: value.disposition, summary: boundedSummary(value.summary) });
}

function exactRecord(value: JsonValue, allowed: readonly string[], label: string, optional: readonly string[] = []): Record<string, JsonValue | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`The protected Windows host-action ${label} record is malformed.`);
  const record = value as Record<string, JsonValue>;
  const required = allowed.filter((key) => !optional.includes(key));
  if (!sameKeys(record, [...required, ...optional.filter((key) => key in record)])) throw new Error(`The protected Windows host-action ${label} record changed its closed schema.`);
  return record;
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function exactLiveClaim(state: ClaimState | undefined, claim: ConsumerClaim): void {
  if (!state || !sameClaim(state.claim, claim) || state.terminal) throw new Error("The Windows host-action claim is no longer live.");
}

function sameClaim(left: ConsumerClaim, right: ConsumerClaim): boolean {
  return left.claimId === right.claimId && left.claimToken === right.claimToken && left.hostActionId === right.hostActionId
    && left.operationId === right.operationId && left.commandAction === right.commandAction && left.hostAction === right.hostAction
    && left.application === right.application && left.executableIdentityDigest === right.executableIdentityDigest
    && left.windowCycleOrdinal === right.windowCycleOrdinal;
}

function identityDigest(identity: FixedWindowsHostApplicationIdentity): string {
  return digest(JSON.stringify({
    version: identity.version,
    application: identity.application,
    productId: identity.productId,
    canonicalExecutablePath: identity.canonicalExecutablePath.toLowerCase(),
    executableSha256: identity.executableSha256,
    signerSubject: identity.signerSubject,
    signerThumbprint: identity.signerThumbprint.toLowerCase(),
    size: identity.size,
    modifiedMs: identity.modifiedMs,
    device: identity.device,
    inode: identity.inode
  }));
}

function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

function boundedClaimToken(value: string): string {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new Error("The Windows host-action claim token is invalid.");
  return value;
}

function boundedHostActionId(value: string): string {
  if (!/^host-action:[a-f0-9]{64}$/.test(value)) throw new Error("The Windows host-action ID is invalid.");
  return value;
}

function boundedReference(value: string, label: string): string {
  if (!referencePattern.test(value)) throw new Error(`The Windows host-action ${label} is invalid.`);
  return value;
}

function boundedSummary(value: string): string {
  const normalized = value.replace(/[\0\r\n]+/g, " ").trim();
  if (!normalized || normalized.length > maximumSummaryLength) throw new Error("The Windows host-action summary is invalid.");
  return normalized;
}

function boundedText(value: string, maximum: number): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum && !/[\0\r\n]/u.test(value) && value.trim() === value;
}

function exactTimestamp(value: string, label: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new Error(`The ${label} is invalid.`);
  return value;
}

function isDisposition(value: unknown): value is WindowsHostActionDisposition {
  return value === "not_started" || value === "committed" || value === "ambiguous";
}

export const windowsHostActionConsumerAdapterVersion = adapterVersion;
