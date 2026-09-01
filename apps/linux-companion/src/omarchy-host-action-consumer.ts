import { createHash, randomBytes } from "node:crypto";

import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { JsonStoreTransaction, JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { HostActionAuthorizationPayload, HostActionCompletionPayload } from "../../windows-companion/src/bridge.ts";
import type { HostActionIntent } from "../../windows-companion/src/host-actions.ts";
import type { ExternalCompletionCapableMediatedCommandExecutor, HostActionCompletionRecord } from "../../windows-companion/src/service.ts";
import type { OmarchyHostEvidence } from "./omarchy-capabilities.ts";
import { NativeOmarchyHostActionAdapter, type FixedOmarchySurfaceIdentity, type OmarchyFocusAction, type OmarchySurface } from "./omarchy-host-action.ts";

const claimKind = "b122.omarchy-host-action.claimed.v1";
const effectKind = "b122.omarchy-host-action.effect-started.v1";
const terminalKind = "b122.omarchy-host-action.terminal.v1";
const adapterVersion = "sxsy-b122.omarchy-host-action-consumer.v1";

export interface OmarchyHostActionQueuePort {
  listPending(): Promise<readonly HostActionIntent[]>;
  listSettled(): Promise<readonly HostActionCompletionRecord[]>;
  authorize(payload: HostActionAuthorizationPayload): Promise<Readonly<{ hostActionId: string; authorizationToken: string; expiresAt: string }>>;
  settle(payload: HostActionCompletionPayload): Promise<HostActionCompletionRecord>;
}

export interface CompanionOmarchyHostActionConsumerOptions {
  readonly evidence: OmarchyHostEvidence;
  readonly identities: Readonly<Partial<Record<OmarchySurface, FixedOmarchySurfaceIdentity>>>;
  readonly pollIntervalMs?: number;
  readonly now?: () => string;
  readonly claimTokenFactory?: () => string;
}

interface Claim extends Record<string, JsonValue> {
  readonly version: 1; readonly claimId: string; readonly claimToken: string;
  readonly hostActionId: string; readonly operationId: string; readonly commandAction: CommandAction;
  readonly hostAction: OmarchyFocusAction; readonly surface: OmarchySurface; readonly identityDigest: string; readonly claimedAt: string;
}
interface Effect extends Record<string, JsonValue> { readonly version: 1; readonly claimId: string; readonly claimToken: string; readonly startedAt: string; }
interface Terminal extends Record<string, JsonValue> { readonly version: 1; readonly claimId: string; readonly claimToken: string; readonly disposition: "not_started" | "committed" | "ambiguous"; readonly summary: string; readonly completedAt: string; }
interface State { claim: Claim; effect?: Effect; terminal?: Terminal; }

const plans: Readonly<Record<"focus_vscode" | "focus_terminal", Readonly<{ action: OmarchyFocusAction; surface: OmarchySurface }>>> = Object.freeze({
  focus_vscode: Object.freeze({ action: "focus_vscode", surface: "vscode" }),
  focus_terminal: Object.freeze({ action: "focus_external_terminal", surface: "terminal" })
});

/** Durable Linux consumer for only the two canonical, targetless Omarchy focus actions. */
export class CompanionOmarchyHostActionConsumer {
  private running = false;
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private abort?: AbortController;
  private readonly pollIntervalMs: number;
  private readonly now: () => string;
  private readonly claimTokenFactory: () => string;

  constructor(
    private readonly store: ProtectedJsonStore,
    private readonly queue: OmarchyHostActionQueuePort,
    private readonly executor: ExternalCompletionCapableMediatedCommandExecutor,
    private readonly effects: NativeOmarchyHostActionAdapter,
    private readonly options: CompanionOmarchyHostActionConsumerOptions
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    this.now = options.now ?? (() => new Date().toISOString());
    this.claimTokenFactory = options.claimTokenFactory ?? (() => randomBytes(32).toString("base64url"));
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 10 || this.pollIntervalMs > 60_000) throw new Error("The Omarchy polling interval is outside safe bounds.");
  }

  async start(): Promise<void> { if (this.running) return; await this.recover(); this.running = true; this.kick(); }
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.abort?.abort(new Error("The Omarchy host-action consumer stopped."));
    if (this.active) await this.active.catch(() => undefined);
  }

  /** Reconciliation is read-only with respect to the compositor and never replays an effect. */
  async recover(): Promise<void> {
    const current = await states(this.store);
    const settled = new Map((await this.queue.listSettled()).map((record) => [record.hostActionId, record]));
    for (const state of current.values()) {
      if (state.terminal) continue;
      let record = settled.get(state.claim.hostActionId);
      if (!record && state.effect) record = await this.queue.settle({
        hostActionId: state.claim.hostActionId, succeeded: false, effectDisposition: "ambiguous",
        summary: "The Omarchy focus action crossed its durable effect boundary before restart; it was not replayed.", adapterVersion
      });
      if (record) {
        await this.executor.completeExternalOperation(record);
        await this.appendTerminal(state.claim, record.status === "completed" ? "committed" : record.status === "incomplete" ? "ambiguous" : "not_started", record.summary);
      } else await this.appendTerminal(state.claim, "ambiguous", "The Omarchy claim ended before its effect boundary; authorization ownership is unresolved and no effect was replayed.");
    }
  }

  private kick(): void {
    if (!this.running || this.active) return;
    const abort = new AbortController(); this.abort = abort;
    const task = this.drain(abort).catch(() => undefined); this.active = task;
    void task.finally(() => { if (this.active === task) this.active = undefined; if (this.abort === abort) this.abort = undefined; if (this.running) { this.timer = setTimeout(() => { this.timer = undefined; this.kick(); }, this.pollIntervalMs); this.timer.unref?.(); } });
  }

  private async drain(abort: AbortController): Promise<void> {
    while (this.running && !abort.signal.aborted) {
      const claimed = await states(this.store);
      const intent = (await this.queue.listPending()).filter(validIntent).filter((candidate) => !claimed.has(candidate.id))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
      if (!intent) return;
      await this.dispatch(intent, abort);
    }
  }

  private async dispatch(intent: HostActionIntent, abort: AbortController): Promise<void> {
    const plan = plans[intent.commandAction as keyof typeof plans]!;
    const identity = this.options.identities[plan.surface];
    const claim = await this.claim(intent, plan.action, plan.surface, digest(JSON.stringify(identity ?? `unavailable:${plan.surface}`)));
    if (!claim) return;
    let authorization;
    try { authorization = await this.queue.authorize({ hostActionId: intent.id, adapterVersion }); }
    catch { await this.appendTerminal(claim, "ambiguous", "The one-time Omarchy authorization was unavailable or already owned; no effect was requested."); return; }
    let disposition: Terminal["disposition"] = "not_started";
    let summary = `The commissioned Omarchy ${plan.surface} identity is unavailable; no host effect was admitted.`;
    let crossed = false;
    if (identity) try {
      const result = await this.effects.execute(plan.action, this.options.evidence, this.options.identities, {
        signal: abort.signal,
        beforeEffect: async () => { if (crossed) throw new Error("The Omarchy effect barrier is single-use."); await this.appendEffect(claim); crossed = true; }
      });
      disposition = result.disposition;
      summary = result.summary;
    } catch {
      disposition = crossed ? "ambiguous" : "not_started";
      summary = crossed ? "The Omarchy focus action failed after its durable effect boundary; its outcome is ambiguous and it will not be replayed." : "The Omarchy focus action failed before its durable effect boundary; no effect was admitted.";
    }
    let record: HostActionCompletionRecord;
    try { record = await this.queue.settle({ hostActionId: intent.id, succeeded: disposition === "committed", effectDisposition: disposition, summary, adapterVersion, authorizationToken: authorization.authorizationToken }); }
    catch { return; }
    await this.executor.completeExternalOperation(record);
    await this.appendTerminal(claim, disposition, record.summary);
  }

  private async claim(intent: HostActionIntent, action: OmarchyFocusAction, surface: OmarchySurface, identityDigest: string): Promise<Claim | undefined> {
    return this.store.transaction(async (transaction) => {
      if ((await statesFrom(transaction)).has(intent.id)) return undefined;
      const claim: Claim = { version: 1, claimId: `omarchy-host-action-claim:${digest(`${intent.id}:${identityDigest}`)}`, claimToken: token(this.claimTokenFactory()), hostActionId: intent.id, operationId: intent.operationId, commandAction: intent.commandAction, hostAction: action, surface, identityDigest, claimedAt: timestamp(this.now()) };
      await transaction.append(claimKind, claim); return claim;
    });
  }
  private async appendEffect(claim: Claim): Promise<void> { await this.store.transaction(async (transaction) => { const state = (await statesFrom(transaction)).get(claim.hostActionId); if (!state || state.effect || state.terminal || !sameClaim(state.claim, claim)) throw new Error("The Omarchy claim is no longer live."); await transaction.append(effectKind, { version: 1, claimId: claim.claimId, claimToken: claim.claimToken, startedAt: timestamp(this.now()) } satisfies Effect); }); }
  private async appendTerminal(claim: Claim, disposition: Terminal["disposition"], summaryInput: string): Promise<void> { const summary = bounded(summaryInput); await this.store.transaction(async (transaction) => { const state = (await statesFrom(transaction)).get(claim.hostActionId); if (!state || !sameClaim(state.claim, claim)) throw new Error("The Omarchy terminal record changed its claim binding."); if (state.terminal) return; await transaction.append(terminalKind, { version: 1, claimId: claim.claimId, claimToken: claim.claimToken, disposition, summary, completedAt: timestamp(this.now()) } satisfies Terminal); }); }
}

function validIntent(intent: HostActionIntent): boolean {
  const keys = Object.keys(intent as unknown as Record<string, unknown>).sort();
  const expected = ["commandAction", "createdAt", "expiresAt", "hostAction", "id", "operationId", "version"].sort();
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index]) || intent.version !== 1) return false;
  const plan = plans[intent.commandAction as keyof typeof plans];
  return !!plan && intent.hostAction === plan.action && intent.id === `host-action:${digest(`${intent.operationId}:${intent.commandAction}`)}` && Date.parse(intent.expiresAt) > Date.parse(intent.createdAt);
}
async function states(store: ProtectedJsonStore): Promise<Map<string, State>> { return store.transaction(statesFrom); }
async function statesFrom(transaction: JsonStoreTransaction): Promise<Map<string, State>> {
  const result = new Map<string, State>(); const byClaim = new Map<string, State>();
  for (const entry of await transaction.readEntries<JsonValue>()) {
    if (entry.kind === claimKind) { const claim = parseClaim(entry.payload); if (result.has(claim.hostActionId) || byClaim.has(claim.claimId)) throw new Error("The Omarchy journal contains a duplicate claim."); const state = { claim }; result.set(claim.hostActionId, state); byClaim.set(claim.claimId, state); }
    else if (entry.kind === effectKind) { const effect = parseEffect(entry.payload); const state = byClaim.get(effect.claimId); if (!state || state.effect || state.terminal || state.claim.claimToken !== effect.claimToken) throw new Error("The Omarchy effect record is orphaned."); state.effect = effect; }
    else if (entry.kind === terminalKind) { const terminal = parseTerminal(entry.payload); const state = byClaim.get(terminal.claimId); if (!state || state.terminal || state.claim.claimToken !== terminal.claimToken) throw new Error("The Omarchy terminal record is orphaned."); state.terminal = terminal; }
  } return result;
}
function parseClaim(value: JsonValue): Claim { if (!record(value) || !exact(value, ["version","claimId","claimToken","hostActionId","operationId","commandAction","hostAction","surface","identityDigest","claimedAt"]) || value.version !== 1 || typeof value.claimId !== "string" || !/^omarchy-host-action-claim:[a-f0-9]{64}$/.test(value.claimId) || typeof value.claimToken !== "string" || typeof value.hostActionId !== "string" || typeof value.operationId !== "string" || typeof value.commandAction !== "string" || typeof value.hostAction !== "string" || typeof value.surface !== "string" || typeof value.identityDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.identityDigest) || typeof value.claimedAt !== "string") throw new Error("The protected Omarchy claim is malformed."); token(value.claimToken); timestamp(value.claimedAt); const plan = plans[value.commandAction as keyof typeof plans]; if (!plan || plan.action !== value.hostAction || plan.surface !== value.surface) throw new Error("The Omarchy claim changed its closed mapping."); return value as unknown as Claim; }
function parseEffect(value: JsonValue): Effect { if (!record(value) || !exact(value,["version","claimId","claimToken","startedAt"]) || value.version !== 1 || typeof value.claimId !== "string" || typeof value.claimToken !== "string" || typeof value.startedAt !== "string") throw new Error("The protected Omarchy effect is malformed."); token(value.claimToken); timestamp(value.startedAt); return value as unknown as Effect; }
function parseTerminal(value: JsonValue): Terminal { if (!record(value) || !exact(value,["version","claimId","claimToken","disposition","summary","completedAt"]) || value.version !== 1 || typeof value.claimId !== "string" || typeof value.claimToken !== "string" || !["not_started","committed","ambiguous"].includes(String(value.disposition)) || typeof value.summary !== "string" || typeof value.completedAt !== "string") throw new Error("The protected Omarchy terminal is malformed."); token(value.claimToken); bounded(value.summary); timestamp(value.completedAt); return value as unknown as Terminal; }
function sameClaim(a: Claim,b: Claim): boolean { return a.claimId === b.claimId && a.claimToken === b.claimToken && a.hostActionId === b.hostActionId && a.identityDigest === b.identityDigest; }
function record(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function token(value: string): string { if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new Error("The Omarchy claim token is invalid."); return value; }
function timestamp(value: string): string { const time = Date.parse(value); if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error("The Omarchy timestamp is invalid."); return value; }
function bounded(value: string): string { const text = value.replace(/[\0\r\n]+/gu," ").trim(); if (!text || text.length > 512) throw new Error("The Omarchy summary is invalid."); return text; }
export const omarchyHostActionConsumerAdapterVersion = adapterVersion;
