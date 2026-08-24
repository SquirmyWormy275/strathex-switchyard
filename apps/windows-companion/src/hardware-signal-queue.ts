import { createHash, randomBytes } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { assignmentFor, type Control, type HandlerName, type Modifier } from "../../../packages/protocol/src/b122.ts";
import type { RawHidFrame } from "../../../packages/protocol/src/raw-hid.ts";
import type { JournalEntry, JsonStoreTransaction, JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";

const acceptedKind = "b122.hardware-signal.accepted.v1";
const claimedKind = "b122.hardware-signal.claimed.v1";
const dispatchedKind = "b122.hardware-signal.dispatched.v1";
const completedKind = "b122.hardware-signal.completed.v1";

export type CanonicalHardwareSignal = Extract<RawHidFrame, { type: "signal" }>;
export type HardwareSignalCompletionOutcome = "handled" | "failed_before_dispatch" | "needs_reconciliation" | "cancelled";

export interface HardwareSignalAcceptance {
  readonly status: "accepted" | "duplicate";
  readonly signalId: string;
}

export interface HardwareSignalClaim {
  readonly signalId: string;
  readonly claimToken: string;
  readonly deviceId: string;
  readonly connectionEpoch: number;
  readonly bootNonce: number;
  readonly counter: number;
  readonly control: Control;
  readonly modifier: Modifier;
  readonly acceptedAt: string;
  readonly claimedAt: string;
  readonly attempt: number;
  readonly windowSessionId: string;
  readonly workspaceRoots: readonly string[];
}

export interface HardwareSignalClaimBinding {
  readonly windowSessionId: string;
  readonly workspaceRoots: readonly string[];
}

export interface HardwareSignalCompletion extends HardwareSignalClaimBinding {
  readonly signalId: string;
  readonly claimToken: string;
  readonly outcome: HardwareSignalCompletionOutcome;
  readonly summary: string;
  readonly dispatchReceiptId?: string;
  readonly dispatchSessionId?: string;
  readonly repositoryRoot?: string;
}

export interface HardwareSignalInboxStatus {
  readonly pending: number;
  readonly claimed: number;
  readonly completed: number;
  readonly needsReconciliation: number;
}

interface AcceptedPayload extends Record<string, JsonValue> {
  readonly signalId: string;
  readonly deviceId: string;
  readonly connectionEpoch: number;
  readonly bootNonce: number;
  readonly counter: number;
  readonly control: Control;
  readonly modifier: Modifier;
}

interface ClaimedPayload extends Record<string, JsonValue> {
  readonly signalId: string;
  readonly claimToken: string;
  readonly windowSessionId: string;
  readonly workspaceRoots: readonly string[];
  readonly attempt: number;
}

interface CompletedPayload {
  readonly signalId: string;
  readonly claimToken: string;
  readonly windowSessionId: string;
  readonly workspaceRoots: readonly string[];
  readonly outcome: HardwareSignalCompletionOutcome;
  readonly summary: string;
  readonly dispatchReceiptId?: string;
  readonly dispatchSessionId?: string;
  readonly repositoryRoot?: string;
}

interface DispatchedPayload extends Record<string, JsonValue> {
  readonly signalId: string;
  readonly claimToken: string;
  readonly windowSessionId: string;
  readonly workspaceRoots: readonly string[];
  readonly handler: HandlerName;
  readonly resultStatus: string;
  readonly dispatchReceiptId: string;
  readonly operationId: string;
}

interface MutableSignalState {
  accepted: AcceptedPayload;
  acceptedAt: string;
  phase: "pending" | "claimed" | "completed" | "needs_reconciliation";
  attempt: number;
  claim?: ClaimedPayload;
  claimedAt?: string;
  dispatch?: DispatchedPayload;
  completion?: CompletedPayload;
}

export interface DurableHardwareSignalInboxOptions {
  readonly now?: () => string;
  readonly claimTokenFactory?: () => string;
  readonly dispatchReceiptFactory?: () => string;
}

/**
 * Protected two-phase inbox between the Raw-HID replay boundary and a focused
 * VS Code window. `accept` returns only after the canonical signal is in the
 * authenticated journal, so the transport may ACK only after this promise
 * resolves. A claimed signal is never silently redelivered after a crash.
 */
export class DurableHardwareSignalInbox {
  private readonly store: ProtectedJsonStore;
  private readonly now: () => string;
  private readonly claimTokenFactory: () => string;
  private readonly dispatchReceiptFactory: () => string;
  private readonly liveClaims = new Map<string, string>();

  constructor(store: ProtectedJsonStore, options: DurableHardwareSignalInboxOptions = {}) {
    this.store = store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.claimTokenFactory = options.claimTokenFactory ?? (() => randomBytes(32).toString("base64url"));
    this.dispatchReceiptFactory = options.dispatchReceiptFactory ?? (() => `hardware-dispatch:${randomBytes(32).toString("hex")}`);
  }

  async accept(deviceId: string, signal: CanonicalHardwareSignal): Promise<HardwareSignalAcceptance> {
    const accepted = acceptedPayload(deviceId, signal);
    return this.store.transaction(async (transaction) => {
      const states = await stateFrom(transaction);
      const existing = states.get(accepted.signalId);
      if (existing) {
        if (!sameAccepted(existing.accepted, accepted)) throw new Error("A Raw-HID device reused an accepted epoch/counter tuple for different signal bytes.");
        return { status: "duplicate", signalId: accepted.signalId };
      }
      await transaction.append(acceptedKind, accepted);
      return { status: "accepted", signalId: accepted.signalId };
    });
  }

  async claim(binding: HardwareSignalClaimBinding): Promise<HardwareSignalClaim | undefined> {
    const normalized = normalizeBinding(binding);
    return this.store.transaction(async (transaction) => {
      const states = await stateFrom(transaction);
      const next = [...states.values()]
        .filter((candidate) => candidate.phase === "pending")
        .sort((left, right) => left.acceptedAt.localeCompare(right.acceptedAt) || left.accepted.signalId.localeCompare(right.accepted.signalId))[0];
      if (!next) return undefined;
      const claimToken = boundedClaimToken(this.claimTokenFactory());
      const payload: ClaimedPayload = {
        signalId: next.accepted.signalId,
        claimToken,
        windowSessionId: normalized.windowSessionId,
        workspaceRoots: normalized.workspaceRoots,
        attempt: next.attempt + 1
      };
      const entry = await transaction.append(claimedKind, payload);
      this.liveClaims.set(payload.signalId, claimToken);
      return claimView(next, payload, entry.at);
    });
  }

  /** Resolves only a claim created by this live process with the exact binding. */
  async resolveLiveClaim(binding: HardwareSignalClaimBinding & Readonly<{ signalId: string; claimToken: string }>): Promise<HardwareSignalClaim> {
    const normalized = normalizeBinding(binding);
    validateSignalId(binding.signalId);
    boundedClaimToken(binding.claimToken);
    return this.store.transaction(async (transaction) => {
      const current = (await stateFrom(transaction)).get(binding.signalId);
      if (!current || current.phase !== "claimed" || !current.claim || !current.claimedAt
        || this.liveClaims.get(binding.signalId) !== binding.claimToken
        || current.claim.claimToken !== binding.claimToken
        || current.claim.windowSessionId !== normalized.windowSessionId
        || !sameRoots(current.claim.workspaceRoots, normalized.workspaceRoots)) {
        throw new Error("The hardware signal claim is missing, stale, completed, or bound to another VS Code window.");
      }
      return claimView(current, current.claim, current.claimedAt);
    });
  }

  async complete(input: HardwareSignalCompletion): Promise<Readonly<{ signalId: string; outcome: HardwareSignalCompletionOutcome }>> {
    const normalized = normalizeBinding(input);
    validateSignalId(input.signalId);
    boundedClaimToken(input.claimToken);
    const summary = boundedSummary(input.summary);
    if (!completionOutcome(input.outcome)) throw new Error("The hardware signal completion outcome is invalid.");
    if (input.dispatchSessionId !== undefined && !boundedReference(input.dispatchSessionId)) throw new Error("The hardware signal dispatch session ID is invalid.");
    if (input.repositoryRoot !== undefined && !boundedAbsolute(input.repositoryRoot)) throw new Error("The hardware signal repository root is invalid.");
    if (input.dispatchReceiptId !== undefined) validateDispatchReceiptId(input.dispatchReceiptId);
    return this.store.transaction(async (transaction) => {
      const current = (await stateFrom(transaction)).get(input.signalId);
      if (!current || current.phase !== "claimed" || !current.claim
        || this.liveClaims.get(input.signalId) !== input.claimToken
        || current.claim.claimToken !== input.claimToken
        || current.claim.windowSessionId !== normalized.windowSessionId
        || !sameRoots(current.claim.workspaceRoots, normalized.workspaceRoots)) {
        throw new Error("The hardware signal claim token or exact window/workspace binding does not match.");
      }
      if (input.outcome === "handled" && (!current.dispatch || input.dispatchReceiptId !== current.dispatch.dispatchReceiptId)) {
        throw new Error("A handled hardware signal requires the exact server-issued dispatch receipt for its canonical assignment.");
      }
      if (input.outcome === "failed_before_dispatch" && (current.dispatch || input.dispatchReceiptId !== undefined)) {
        throw new Error("A hardware signal already crossed dispatch and cannot be requeued as failed before dispatch.");
      }
      const payload: CompletedPayload = {
        signalId: input.signalId,
        claimToken: input.claimToken,
        windowSessionId: normalized.windowSessionId,
        workspaceRoots: normalized.workspaceRoots,
        outcome: input.outcome,
        summary,
        ...(input.dispatchReceiptId ? { dispatchReceiptId: input.dispatchReceiptId } : {}),
        ...(input.dispatchSessionId ? { dispatchSessionId: input.dispatchSessionId } : {}),
        ...(input.repositoryRoot ? { repositoryRoot: resolve(input.repositoryRoot) } : {})
      };
      await transaction.append(completedKind, payload as unknown as JsonValue);
      this.liveClaims.delete(input.signalId);
      return { signalId: input.signalId, outcome: input.outcome };
    });
  }

  /**
   * Called only by the companion service after it dispatches the canonical
   * assignment resolved from this claim. The client cannot create this receipt.
   */
  async recordDispatch(input: HardwareSignalClaimBinding & Readonly<{
    signalId: string;
    claimToken: string;
    handler: HandlerName;
    resultStatus: string;
    operationId?: string;
  }>): Promise<Readonly<{ dispatchReceiptId: string }>> {
    const normalized = normalizeBinding(input);
    validateSignalId(input.signalId);
    boundedClaimToken(input.claimToken);
    if (!boundedReference(input.resultStatus) || input.resultStatus.length > 80) throw new Error("The hardware dispatch result status is invalid.");
    if (input.operationId !== undefined && !boundedReference(input.operationId)) throw new Error("The hardware dispatch operation ID is invalid.");
    return this.store.transaction(async (transaction) => {
      const current = (await stateFrom(transaction)).get(input.signalId);
      const assignment = current ? assignmentFor(current.accepted.control, current.accepted.modifier) : undefined;
      if (!current || current.phase !== "claimed" || !current.claim || current.dispatch
        || this.liveClaims.get(input.signalId) !== input.claimToken
        || current.claim.claimToken !== input.claimToken
        || current.claim.windowSessionId !== normalized.windowSessionId
        || !sameRoots(current.claim.workspaceRoots, normalized.workspaceRoots)
        || !assignment || assignment.handler !== input.handler) {
        throw new Error("The hardware dispatch receipt does not match one live canonical signal claim.");
      }
      const dispatchReceiptId = this.dispatchReceiptFactory();
      validateDispatchReceiptId(dispatchReceiptId);
      const payload: DispatchedPayload = {
        signalId: input.signalId,
        claimToken: input.claimToken,
        windowSessionId: normalized.windowSessionId,
        workspaceRoots: normalized.workspaceRoots,
        handler: assignment.handler,
        resultStatus: input.resultStatus,
        dispatchReceiptId,
        operationId: input.operationId ?? ""
      };
      await transaction.append(dispatchedKind, payload);
      return { dispatchReceiptId };
    });
  }

  /** Called once during companion startup, before any client can claim. */
  async recoverAfterRestart(): Promise<void> {
    this.liveClaims.clear();
    await this.store.transaction(async (transaction) => {
      const states = await stateFrom(transaction);
      for (const current of states.values()) {
        if (current.phase !== "claimed" || !current.claim) continue;
        const payload: CompletedPayload = {
          signalId: current.accepted.signalId,
          claimToken: current.claim.claimToken,
          windowSessionId: current.claim.windowSessionId,
          workspaceRoots: current.claim.workspaceRoots,
          outcome: "needs_reconciliation",
          summary: "The companion restarted after claim and before an exact completion receipt; the signal will not be blindly redelivered."
        };
        await transaction.append(completedKind, payload as unknown as JsonValue);
      }
    });
  }

  /** Cancels only a live claimed signal whose server dispatch is bound to this exact durable operation. */
  async cancelByOperation(operationId: string, reason: string): Promise<number> {
    if (!boundedReference(operationId)) throw new Error("The hardware cancellation operation ID is invalid.");
    const exactOperation = operationId;
    const summary = boundedSummary(reason);
    const cancelled = await this.store.transaction(async (transaction) => {
      const states = await stateFrom(transaction);
      const matches = [...states.values()].filter((current) => current.phase === "claimed" && current.claim && current.dispatch?.operationId === exactOperation);
      for (const current of matches) await appendCancellation(transaction, current, summary);
      return matches.map((current) => current.accepted.signalId);
    });
    for (const signalId of cancelled) this.liveClaims.delete(signalId);
    return cancelled.length;
  }

  /** Cancels only claims already bound to the exact canonical repository; unbound pending signals are not guessed. */
  async cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number> {
    if (!boundedAbsolute(repositoryRoot)) throw new Error("The hardware cancellation repository root is invalid.");
    const canonicalRoot = resolve(repositoryRoot);
    const summary = boundedSummary(reason);
    const cancelled = await this.store.transaction(async (transaction) => {
      const states = await stateFrom(transaction);
      const matches = [...states.values()].filter((current) => current.phase === "claimed" && current.claim
        && current.claim.workspaceRoots.some((root) => samePath(root, canonicalRoot)));
      for (const current of matches) await appendCancellation(transaction, current, summary);
      return matches.map((current) => current.accepted.signalId);
    });
    for (const signalId of cancelled) this.liveClaims.delete(signalId);
    return cancelled.length;
  }

  /** Observes only a durable dispatch already bound to this exact operation. */
  async observeOperation(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>> {
    if (!boundedReference(operationId)) throw new Error("The hardware observation operation ID is invalid.");
    const states = await this.store.transaction(stateFrom);
    const matches = [...states.values()].filter((current) => current.dispatch?.operationId === operationId);
    if (matches.length === 0) {
      return { settled: false, summary: "No exact durable hardware dispatch is bound to this operation; nothing was replayed." };
    }
    if (matches.some((current) => current.phase === "claimed" || current.phase === "needs_reconciliation" || !current.completion)) {
      return { settled: false, summary: "The exact hardware dispatch needs reconciliation after restart; it was not replayed." };
    }
    if (matches.every((current) => current.completion?.outcome === "cancelled")) {
      return { settled: true, summary: "The exact hardware dispatch was durably cancelled." };
    }
    if (matches.every((current) => current.completion?.outcome === "handled")) {
      return { settled: true, summary: "The exact hardware dispatch has a durable handled completion." };
    }
    return { settled: false, summary: "The exact hardware dispatch has no terminal trusted completion; nothing was replayed." };
  }

  async status(): Promise<HardwareSignalInboxStatus> {
    const states = await this.store.transaction(stateFrom);
    const result: HardwareSignalInboxStatus = { pending: 0, claimed: 0, completed: 0, needsReconciliation: 0 };
    for (const state of states.values()) {
      if (state.phase === "pending") (result as { pending: number }).pending += 1;
      else if (state.phase === "claimed") (result as { claimed: number }).claimed += 1;
      else if (state.phase === "completed") (result as { completed: number }).completed += 1;
      else (result as { needsReconciliation: number }).needsReconciliation += 1;
    }
    return result;
  }
}

async function stateFrom(transaction: JsonStoreTransaction): Promise<Map<string, MutableSignalState>> {
  const states = new Map<string, MutableSignalState>();
  for (const entry of await transaction.readEntries<JsonValue>()) applyEntry(entry, states);
  return states;
}

function applyEntry(entry: JournalEntry<JsonValue>, states: Map<string, MutableSignalState>): void {
  if (entry.kind === acceptedKind) {
    const payload = parseAccepted(entry.payload);
    if (states.has(payload.signalId)) throw new Error("The protected hardware signal journal contains a duplicate acceptance record.");
    states.set(payload.signalId, { accepted: payload, acceptedAt: entry.at, phase: "pending", attempt: 0 });
    return;
  }
  if (entry.kind === claimedKind) {
    const payload = parseClaimed(entry.payload);
    const current = states.get(payload.signalId);
    if (!current || current.phase !== "pending" || payload.attempt !== current.attempt + 1) throw new Error("The protected hardware signal claim journal is inconsistent.");
    current.phase = "claimed";
    current.attempt = payload.attempt;
    current.claim = payload;
    current.claimedAt = entry.at;
    return;
  }
  if (entry.kind === dispatchedKind) {
    const payload = parseDispatched(entry.payload);
    const current = states.get(payload.signalId);
    const assignment = current ? assignmentFor(current.accepted.control, current.accepted.modifier) : undefined;
    if (!current || current.phase !== "claimed" || !current.claim || current.dispatch
      || current.claim.claimToken !== payload.claimToken || current.claim.windowSessionId !== payload.windowSessionId
      || !sameRoots(current.claim.workspaceRoots, payload.workspaceRoots) || !assignment || assignment.handler !== payload.handler) {
      throw new Error("The protected hardware dispatch receipt journal is inconsistent.");
    }
    current.dispatch = payload;
    return;
  }
  if (entry.kind === completedKind) {
    const payload = parseCompleted(entry.payload);
    const current = states.get(payload.signalId);
    if (!current || current.phase !== "claimed" || !current.claim || current.claim.claimToken !== payload.claimToken
      || current.claim.windowSessionId !== payload.windowSessionId || !sameRoots(current.claim.workspaceRoots, payload.workspaceRoots)) {
      throw new Error("The protected hardware signal completion journal is inconsistent.");
    }
    if (payload.outcome === "handled" && (!current.dispatch || payload.dispatchReceiptId !== current.dispatch.dispatchReceiptId)) throw new Error("The protected hardware completion lacks its exact server dispatch receipt.");
    if (payload.outcome === "failed_before_dispatch" && (current.dispatch || payload.dispatchReceiptId !== undefined)) throw new Error("The protected hardware journal requeues a signal after dispatch.");
    if (payload.outcome === "cancelled" && (current.dispatch
      ? payload.dispatchReceiptId !== current.dispatch.dispatchReceiptId
      : payload.dispatchReceiptId !== undefined)) throw new Error("The protected hardware cancellation does not match its exact dispatch boundary.");
    current.phase = payload.outcome === "failed_before_dispatch" ? "pending" : payload.outcome === "handled" || payload.outcome === "cancelled" ? "completed" : "needs_reconciliation";
    current.claim = undefined;
    current.claimedAt = undefined;
    current.completion = payload;
    if (payload.outcome === "failed_before_dispatch") current.dispatch = undefined;
  }
}

function acceptedPayload(deviceId: string, signal: CanonicalHardwareSignal): AcceptedPayload {
  if (!/^[a-f0-9]{64}$/i.test(deviceId)) throw new Error("The Raw-HID device ID is invalid.");
  for (const [label, value] of [["connection epoch", signal.connectionEpoch], ["boot nonce", signal.bootNonce], ["counter", signal.counter]] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`The Raw-HID ${label} is invalid.`);
  }
  if (!signal.assigned || !assignmentFor(signal.control, signal.modifier)) throw new Error("Only a settled canonical B122 assignment may enter the hardware signal inbox.");
  const material = `${deviceId.toLowerCase()}:${signal.connectionEpoch}:${signal.bootNonce}:${signal.counter}`;
  return {
    signalId: `hardware-signal:${createHash("sha256").update(material).digest("hex")}`,
    deviceId: deviceId.toLowerCase(),
    connectionEpoch: signal.connectionEpoch,
    bootNonce: signal.bootNonce,
    counter: signal.counter,
    control: signal.control,
    modifier: signal.modifier
  };
}

function claimView(state: MutableSignalState, claim: ClaimedPayload, claimedAt: string): HardwareSignalClaim {
  return {
    ...state.accepted,
    acceptedAt: state.acceptedAt,
    claimToken: claim.claimToken,
    claimedAt,
    attempt: claim.attempt,
    windowSessionId: claim.windowSessionId,
    workspaceRoots: [...claim.workspaceRoots]
  };
}

function normalizeBinding(binding: HardwareSignalClaimBinding): HardwareSignalClaimBinding {
  if (!boundedReference(binding.windowSessionId)) throw new Error("The hardware signal window session ID is invalid.");
  if (!Array.isArray(binding.workspaceRoots) || binding.workspaceRoots.length < 1 || binding.workspaceRoots.length > 32) throw new Error("The hardware signal workspace-root binding requires at least one exact canonical root.");
  const roots = binding.workspaceRoots.map((root) => {
    if (!boundedAbsolute(root)) throw new Error("The hardware signal workspace-root binding requires bounded absolute paths.");
    return resolve(root);
  });
  if (new Set(roots.map(pathKey)).size !== roots.length) throw new Error("The hardware signal workspace-root binding contains duplicates.");
  return { windowSessionId: binding.windowSessionId, workspaceRoots: roots };
}

function parseAccepted(value: JsonValue): AcceptedPayload {
  if (!record(value) || !exact(value, ["signalId", "deviceId", "connectionEpoch", "bootNonce", "counter", "control", "modifier"])
    || typeof value.signalId !== "string" || typeof value.deviceId !== "string" || typeof value.control !== "string" || typeof value.modifier !== "string"
    || typeof value.connectionEpoch !== "number" || typeof value.bootNonce !== "number" || typeof value.counter !== "number") throw new Error("The protected hardware signal acceptance journal is malformed.");
  const candidate = acceptedPayload(value.deviceId, { type: "signal", connectionEpoch: value.connectionEpoch, bootNonce: value.bootNonce, counter: value.counter, control: value.control as Control, modifier: value.modifier as Modifier, assigned: true });
  if (!sameAccepted(candidate, value as unknown as AcceptedPayload)) throw new Error("The protected hardware signal acceptance journal does not match its canonical ID.");
  return candidate;
}

function parseClaimed(value: JsonValue): ClaimedPayload {
  if (!record(value) || !exact(value, ["signalId", "claimToken", "windowSessionId", "workspaceRoots", "attempt"])
    || typeof value.signalId !== "string" || typeof value.claimToken !== "string" || typeof value.windowSessionId !== "string" || !Array.isArray(value.workspaceRoots)
    || !value.workspaceRoots.every((item) => typeof item === "string") || typeof value.attempt !== "number" || !Number.isSafeInteger(value.attempt) || value.attempt < 1) throw new Error("The protected hardware signal claim journal is malformed.");
  validateSignalId(value.signalId); boundedClaimToken(value.claimToken);
  const binding = normalizeBinding({ windowSessionId: value.windowSessionId, workspaceRoots: value.workspaceRoots });
  return { signalId: value.signalId, claimToken: value.claimToken, windowSessionId: binding.windowSessionId, workspaceRoots: binding.workspaceRoots, attempt: value.attempt };
}

function parseCompleted(value: JsonValue): CompletedPayload {
  if (!record(value) || !allowedExact(value, ["signalId", "claimToken", "windowSessionId", "workspaceRoots", "outcome", "summary"], ["dispatchReceiptId", "dispatchSessionId", "repositoryRoot"])
    || typeof value.signalId !== "string" || typeof value.claimToken !== "string" || typeof value.windowSessionId !== "string" || !Array.isArray(value.workspaceRoots)
    || !value.workspaceRoots.every((item) => typeof item === "string") || !completionOutcome(value.outcome) || typeof value.summary !== "string") throw new Error("The protected hardware signal completion journal is malformed.");
  validateSignalId(value.signalId); boundedClaimToken(value.claimToken); boundedSummary(value.summary);
  const binding = normalizeBinding({ windowSessionId: value.windowSessionId, workspaceRoots: value.workspaceRoots });
  if (value.dispatchSessionId !== undefined && (typeof value.dispatchSessionId !== "string" || !boundedReference(value.dispatchSessionId))) throw new Error("The protected hardware signal dispatch session is malformed.");
  if (value.repositoryRoot !== undefined && (typeof value.repositoryRoot !== "string" || !boundedAbsolute(value.repositoryRoot))) throw new Error("The protected hardware signal repository binding is malformed.");
  if (value.dispatchReceiptId !== undefined && typeof value.dispatchReceiptId !== "string") throw new Error("The protected hardware dispatch receipt is malformed.");
  if (typeof value.dispatchReceiptId === "string") validateDispatchReceiptId(value.dispatchReceiptId);
  return { signalId: value.signalId, claimToken: value.claimToken, windowSessionId: binding.windowSessionId, workspaceRoots: binding.workspaceRoots, outcome: value.outcome, summary: value.summary, ...(typeof value.dispatchReceiptId === "string" ? { dispatchReceiptId: value.dispatchReceiptId } : {}), ...(typeof value.dispatchSessionId === "string" ? { dispatchSessionId: value.dispatchSessionId } : {}), ...(typeof value.repositoryRoot === "string" ? { repositoryRoot: resolve(value.repositoryRoot) } : {}) };
}

function parseDispatched(value: JsonValue): DispatchedPayload {
  if (!record(value) || !exact(value, ["signalId", "claimToken", "windowSessionId", "workspaceRoots", "handler", "resultStatus", "dispatchReceiptId", "operationId"])
    || typeof value.signalId !== "string" || typeof value.claimToken !== "string" || typeof value.windowSessionId !== "string" || !Array.isArray(value.workspaceRoots)
    || !value.workspaceRoots.every((item) => typeof item === "string") || typeof value.handler !== "string" || typeof value.resultStatus !== "string"
    || typeof value.dispatchReceiptId !== "string" || typeof value.operationId !== "string") throw new Error("The protected hardware dispatch receipt journal is malformed.");
  validateSignalId(value.signalId); boundedClaimToken(value.claimToken); validateDispatchReceiptId(value.dispatchReceiptId);
  if (!boundedReference(value.resultStatus) || (value.operationId && !boundedReference(value.operationId))) throw new Error("The protected hardware dispatch result is malformed.");
  const binding = normalizeBinding({ windowSessionId: value.windowSessionId, workspaceRoots: value.workspaceRoots });
  return { signalId: value.signalId, claimToken: value.claimToken, windowSessionId: binding.windowSessionId, workspaceRoots: binding.workspaceRoots, handler: value.handler as HandlerName, resultStatus: value.resultStatus, dispatchReceiptId: value.dispatchReceiptId, operationId: value.operationId };
}

function sameAccepted(left: AcceptedPayload, right: AcceptedPayload): boolean {
  return left.signalId === right.signalId && left.deviceId === right.deviceId && left.connectionEpoch === right.connectionEpoch && left.bootNonce === right.bootNonce && left.counter === right.counter && left.control === right.control && left.modifier === right.modifier;
}
function sameRoots(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((root, index) => pathKey(root) === pathKey(right[index]!)); }
function samePath(left: string, right: string): boolean { return pathKey(left) === pathKey(right); }
function pathKey(value: string): string { return resolve(value).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase(); }
function boundedAbsolute(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\0\r\n]/.test(value) && (isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)); }
function boundedReference(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\0\r\n]/.test(value); }
function boundedClaimToken(value: string): string { if (!/^[A-Za-z0-9_-]{8,256}$/.test(value)) throw new Error("The hardware signal claim token is invalid."); return value; }
function boundedSummary(value: string): string { if (typeof value !== "string" || !value.trim() || value.length > 512 || /\0/.test(value)) throw new Error("The hardware signal completion summary is invalid."); return value.replace(/[\r\n]/g, " ").trim(); }
function validateSignalId(value: string): void { if (!/^hardware-signal:[a-f0-9]{64}$/.test(value)) throw new Error("The hardware signal ID is invalid."); }
function validateDispatchReceiptId(value: string): void { if (!/^hardware-dispatch:[a-f0-9]{64}$/.test(value)) throw new Error("The hardware dispatch receipt ID is invalid."); }
function completionOutcome(value: unknown): value is HardwareSignalCompletionOutcome { return value === "handled" || value === "failed_before_dispatch" || value === "needs_reconciliation" || value === "cancelled"; }
function record(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function allowedExact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const keys = Object.keys(value); const allowed = new Set([...required, ...optional]); return required.every((key) => key in value) && keys.every((key) => allowed.has(key)); }

async function appendCancellation(transaction: JsonStoreTransaction, current: MutableSignalState, summary: string): Promise<void> {
  if (!current.claim) throw new Error("Only a claimed hardware signal can be cancelled.");
  const payload: CompletedPayload = {
    signalId: current.accepted.signalId,
    claimToken: current.claim.claimToken,
    windowSessionId: current.claim.windowSessionId,
    workspaceRoots: current.claim.workspaceRoots,
    outcome: "cancelled",
    summary,
    ...(current.dispatch ? { dispatchReceiptId: current.dispatch.dispatchReceiptId } : {})
  };
  await transaction.append(completedKind, payload as unknown as JsonValue);
}
