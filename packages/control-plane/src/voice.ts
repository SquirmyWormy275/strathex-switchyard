import { randomUUID } from "node:crypto";

import { redactText } from "./redaction.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore } from "./store.ts";

export type VoiceProvider = "claude" | "chatgpt" | "system";
export type VoiceTranscriptPolicy = "off" | "redacted";
export type VoiceBindingStatus = "active" | "muted" | "interrupted" | "ended";

export interface VoiceConsent {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly contextPackageId: string;
  readonly contextDigest: string;
  readonly provider: VoiceProvider;
  readonly operatorPresenceId: string;
  readonly transcript: VoiceTranscriptPolicy;
  readonly retentionMinutes: number;
  readonly grantedAt: string;
  readonly expiresAt: string;
}

export interface VoiceBinding {
  readonly id: string;
  readonly consentId: string;
  readonly voiceSessionId: string;
  /** Previous exact binding in the same provider-switch conversation. */
  readonly previousBindingId?: string;
  readonly managedSessionId?: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly contextPackageId: string;
  readonly contextDigest: string;
  readonly provider: VoiceProvider;
  readonly transcript: VoiceTranscriptPolicy;
  readonly retentionMinutes: number;
  readonly status: VoiceBindingStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly endedAt?: string;
  readonly interruptionReason?: string;
  readonly transcriptDeletedAt?: string;
}

export interface VoiceTranscriptEntry {
  readonly id: string;
  readonly bindingId: string;
  readonly text: string;
  readonly recordedAt: string;
  readonly expiresAt: string;
}

export interface VoiceConsentInput {
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly contextPackageId: string;
  readonly contextDigest: string;
  readonly provider: VoiceProvider;
  readonly operatorPresenceId: string;
  readonly transcript: VoiceTranscriptPolicy;
  readonly retentionMinutes: number;
  readonly expiresAt: string;
}

interface VoiceConsentEvent { readonly consent: VoiceConsent; }
interface VoiceBindingEvent { readonly binding: VoiceBinding; }

/**
 * Transcript text deliberately lives outside the append-only authority journal.
 * Production supplies an erasable encrypted vault; the default is process-only
 * so an unconfigured host can never create undeletable plaintext history.
 */
export interface VoiceTranscriptStore {
  append(entry: VoiceTranscriptEntry): Promise<void>;
  list(bindingId: string, now: string): Promise<readonly VoiceTranscriptEntry[]>;
  delete(bindingId: string): Promise<void>;
  purgeExpired(now: string): Promise<void>;
}

export class EphemeralVoiceTranscriptStore implements VoiceTranscriptStore {
  private readonly entries = new Map<string, VoiceTranscriptEntry[]>();

  async append(entry: VoiceTranscriptEntry): Promise<void> {
    const current = this.entries.get(entry.bindingId) ?? [];
    this.entries.set(entry.bindingId, [...current, clone(entry)]);
  }

  async list(bindingId: string, now: string): Promise<readonly VoiceTranscriptEntry[]> {
    await this.purgeExpired(now);
    return (this.entries.get(bindingId) ?? []).map(clone);
  }

  async delete(bindingId: string): Promise<void> { this.entries.delete(bindingId); }

  async purgeExpired(now: string): Promise<void> {
    const cutoff = Date.parse(time(now, "transcript purge clock"));
    for (const [bindingId, values] of this.entries) {
      const retained = values.filter((entry) => Date.parse(entry.expiresAt) > cutoff);
      if (retained.length) this.entries.set(bindingId, retained);
      else this.entries.delete(bindingId);
    }
  }
}

export class VoiceCoordinatorError extends Error {
  constructor(message: string) { super(message); this.name = "VoiceCoordinatorError"; }
}

/** Durable single-binding voice state. It stores no audio and transcripts default off. */
export class VoiceCoordinator {
  private readonly store: ProtectedJsonStore;
  private readonly transcripts: VoiceTranscriptStore;
  private readonly clock: () => string;
  private readonly idFactory: () => string;

  constructor(store: ProtectedJsonStore, options: Readonly<{ clock?: () => string; idFactory?: () => string; transcripts?: VoiceTranscriptStore }> = {}) {
    this.store = store;
    this.transcripts = options.transcripts ?? new EphemeralVoiceTranscriptStore();
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async grantConsent(input: VoiceConsentInput): Promise<VoiceConsent> {
    const grantedAt = time(this.clock(), "voice consent clock");
    const expiresAt = time(input.expiresAt, "voice consent expiry");
    const duration = Date.parse(expiresAt) - Date.parse(grantedAt);
    if (duration <= 0 || duration > 24 * 60 * 60_000) throw new VoiceCoordinatorError("Voice consent must be fresh and expire within twenty-four hours.");
    const transcript = transcriptPolicy(input.transcript);
    const retentionMinutes = retention(input.retentionMinutes, transcript);
    const consent: VoiceConsent = {
      id: text(this.idFactory(), "voice consent id"), repositoryRoot: absoluteRoot(input.repositoryRoot),
      targetSnapshotId: digest(input.targetSnapshotId, "target snapshot id"), contextPackageId: text(input.contextPackageId, "context package id"),
      contextDigest: digest(input.contextDigest, "context digest"), provider: provider(input.provider), operatorPresenceId: text(input.operatorPresenceId, "operator presence id"),
      transcript, retentionMinutes, grantedAt, expiresAt
    };
    await this.store.append<VoiceConsentEvent>("voice.consent.saved", { consent });
    return clone(consent);
  }

  async start(input: Readonly<{ consentId: string; voiceSessionId: string; managedSessionId?: string }>): Promise<VoiceBinding> {
    return this.store.transaction(async (transaction) => {
      const entries = await transaction.readEntries();
      const consent = consents(entries).get(text(input.consentId, "voice consent id"));
      if (!consent || Date.parse(consent.expiresAt) <= Date.parse(this.clock())) throw new VoiceCoordinatorError("Voice startup requires one current exact-context consent.");
      if ([...bindings(entries).values()].some((binding) => live(binding.status))) throw new VoiceCoordinatorError("A voice binding is already active; end it or use the explicit provider switch.");
      const binding = makeBinding(consent, input, text(this.idFactory(), "voice binding id"), time(this.clock(), "voice binding clock"));
      await transaction.append<VoiceBindingEvent>("voice.binding.saved", { binding });
      return clone(binding);
    });
  }

  async getConsent(id: string): Promise<VoiceConsent | undefined> {
    const found = consents(await this.store.readEntries()).get(text(id, "voice consent id"));
    return found ? clone(found) : undefined;
  }

  async switchProvider(bindingId: string, input: Readonly<{ consentId: string; voiceSessionId: string }>): Promise<VoiceBinding> {
    return this.store.transaction(async (transaction) => {
      const entries = await transaction.readEntries();
      const allBindings = bindings(entries);
      const current = allBindings.get(text(bindingId, "voice binding id"));
      const consent = consents(entries).get(text(input.consentId, "voice consent id"));
      if (!current || !live(current.status)) throw new VoiceCoordinatorError("Only the current live voice binding can switch provider.");
      if (!consent || Date.parse(consent.expiresAt) <= Date.parse(this.clock())) throw new VoiceCoordinatorError("Provider switch requires fresh consent for the destination provider.");
      if (consent.provider === current.provider) throw new VoiceCoordinatorError("Provider switch must select a different provider.");
      if (consent.repositoryRoot !== current.repositoryRoot || consent.targetSnapshotId !== current.targetSnapshotId || consent.contextPackageId !== current.contextPackageId || consent.contextDigest !== current.contextDigest) throw new VoiceCoordinatorError("Provider switch consent does not preserve the exact work context.");
      if (lineage(allBindings, current).length >= 32) throw new VoiceCoordinatorError("The voice provider-switch lineage reached its bounded limit; end it before starting another conversation.");
      const now = time(this.clock(), "voice switch clock");
      const ended: VoiceBinding = { ...current, status: "ended", endedAt: now, updatedAt: now };
      const next = makeBinding(consent, { voiceSessionId: input.voiceSessionId, previousBindingId: current.id, ...(current.managedSessionId ? { managedSessionId: current.managedSessionId } : {}) }, text(this.idFactory(), "voice binding id"), now);
      await transaction.append<VoiceBindingEvent>("voice.binding.saved", { binding: ended });
      await transaction.append<VoiceBindingEvent>("voice.binding.saved", { binding: next });
      return clone(next);
    });
  }

  async getBinding(id: string): Promise<VoiceBinding | undefined> {
    const found = bindings(await this.store.readEntries()).get(text(id, "voice binding id"));
    return found ? clone(found) : undefined;
  }

  async bindingLineage(id: string): Promise<readonly VoiceBinding[]> {
    const all = bindings(await this.store.readEntries());
    const found = all.get(text(id, "voice binding id"));
    if (!found) throw new VoiceCoordinatorError(`Unknown voice binding: ${id}`);
    return lineage(all, found).map(clone);
  }

  async active(): Promise<VoiceBinding | undefined> {
    const found = [...bindings(await this.store.readEntries()).values()].find((binding) => live(binding.status));
    return found ? clone(found) : undefined;
  }

  async bindManagedSession(id: string, managedSessionId: string): Promise<VoiceBinding> { return this.mutate(id, (binding) => ({ ...binding, managedSessionId: text(managedSessionId, "managed session id") })); }
  async mute(id: string): Promise<VoiceBinding> { return this.mutate(id, (binding) => { if (binding.status !== "active") throw new VoiceCoordinatorError("Only an active voice binding can be muted."); return { ...binding, status: "muted" }; }); }
  async resume(id: string): Promise<VoiceBinding> { return this.mutate(id, (binding) => { if (binding.status !== "muted" && binding.status !== "interrupted") throw new VoiceCoordinatorError("Only a muted or interrupted voice binding can resume."); return { ...binding, status: "active" }; }); }
  async interrupt(id: string, reason: string): Promise<VoiceBinding> { return this.mutate(id, (binding) => { if (!live(binding.status)) throw new VoiceCoordinatorError("Only a live voice binding can be interrupted."); return { ...binding, status: "interrupted", interruptionReason: text(reason, "interruption reason") }; }); }
  async end(id: string): Promise<VoiceBinding> { return this.mutate(id, (binding, now) => binding.status === "ended" ? binding : { ...binding, status: "ended", endedAt: now }); }

  async appendTranscript(bindingId: string, value: string): Promise<VoiceTranscriptEntry> {
    return this.store.transaction(async (transaction) => {
      const binding = bindings(await transaction.readEntries()).get(text(bindingId, "voice binding id"));
      if (!binding || !live(binding.status) || binding.transcriptDeletedAt) throw new VoiceCoordinatorError("Transcript input requires a live, non-deleted voice binding.");
      if (binding.transcript !== "redacted") throw new VoiceCoordinatorError("Voice transcripts are disabled for this binding.");
      const recordedAt = time(this.clock(), "transcript clock");
      const entry: VoiceTranscriptEntry = {
        id: text(this.idFactory(), "transcript id"), bindingId: binding.id,
        text: redactVoiceTranscript(text(value.replace(/[\r\n\0]+/g, " ").slice(0, 4_096), "transcript text")),
        recordedAt, expiresAt: new Date(Date.parse(recordedAt) + binding.retentionMinutes * 60_000).toISOString()
      };
      await this.transcripts.purgeExpired(recordedAt);
      await this.transcripts.append(entry);
      return clone(entry);
    });
  }

  async transcript(bindingId: string): Promise<readonly VoiceTranscriptEntry[]> {
    return this.store.transaction(async (transaction) => {
      const all = bindings(await transaction.readEntries());
      const binding = all.get(text(bindingId, "voice binding id"));
      if (!binding || binding.transcriptDeletedAt) return [];
      const now = time(this.clock(), "transcript clock");
      const entries = (await Promise.all(lineage(all, binding).map((entry) => this.transcripts.list(entry.id, now)))).flat();
      return entries.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id)).map(clone);
    });
  }

  async deleteTranscript(id: string): Promise<VoiceBinding> {
    return this.store.transaction(async (transaction) => {
      const exactId = text(id, "voice binding id");
      const all = bindings(await transaction.readEntries());
      const found = all.get(exactId);
      if (!found) throw new VoiceCoordinatorError(`Unknown voice binding: ${id}`);
      const now = time(this.clock(), "voice binding clock");
      // Destroy transcript keys/content before recording success. A crash can
      // therefore leave an over-conservative missing transcript, never retained
      // plaintext or a false deletion receipt.
      let selected: VoiceBinding | undefined;
      for (const prior of lineage(all, found)) {
        await this.transcripts.delete(prior.id);
        const changed: VoiceBinding = { ...prior, transcriptDeletedAt: now, updatedAt: now };
        await transaction.append<VoiceBindingEvent>("voice.binding.saved", { binding: changed });
        if (prior.id === exactId) selected = changed;
      }
      return clone(selected!);
    });
  }

  private async mutate(id: string, change: (binding: VoiceBinding, now: string) => VoiceBinding): Promise<VoiceBinding> {
    return this.store.transaction(async (transaction) => {
      const found = bindings(await transaction.readEntries()).get(text(id, "voice binding id"));
      if (!found) throw new VoiceCoordinatorError(`Unknown voice binding: ${id}`);
      const now = time(this.clock(), "voice binding clock");
      const changed = { ...change(clone(found), now), updatedAt: now };
      await transaction.append<VoiceBindingEvent>("voice.binding.saved", { binding: changed });
      return clone(changed);
    });
  }
}

function makeBinding(consent: VoiceConsent, input: Readonly<{ voiceSessionId: string; previousBindingId?: string; managedSessionId?: string }>, id: string, now: string): VoiceBinding {
  return { id, consentId: consent.id, voiceSessionId: text(input.voiceSessionId, "voice session id"), ...(input.previousBindingId ? { previousBindingId: text(input.previousBindingId, "previous voice binding id") } : {}), ...(input.managedSessionId ? { managedSessionId: text(input.managedSessionId, "managed session id") } : {}), repositoryRoot: consent.repositoryRoot, targetSnapshotId: consent.targetSnapshotId, contextPackageId: consent.contextPackageId, contextDigest: consent.contextDigest, provider: consent.provider, transcript: consent.transcript, retentionMinutes: consent.retentionMinutes, status: "active", createdAt: now, updatedAt: now };
}
function consents(entries: readonly JournalEntry<unknown>[]): Map<string, VoiceConsent> { const result = new Map<string, VoiceConsent>(); for (const entry of entries) if (entry.kind === "voice.consent.saved") { const value = (entry.payload as VoiceConsentEvent | undefined)?.consent; if (!value) throw new VoiceCoordinatorError("Protected voice consent is malformed."); result.set(value.id, clone(value)); } return result; }
function bindings(entries: readonly JournalEntry<unknown>[]): Map<string, VoiceBinding> { const result = new Map<string, VoiceBinding>(); for (const entry of entries) if (entry.kind === "voice.binding.saved") { const value = (entry.payload as VoiceBindingEvent | undefined)?.binding; if (!value || !bindingStatus(value.status)) throw new VoiceCoordinatorError("Protected voice binding is malformed."); result.set(value.id, clone(value)); } return result; }
function lineage(all: ReadonlyMap<string, VoiceBinding>, selected: VoiceBinding): VoiceBinding[] {
  const result: VoiceBinding[] = [];
  const seen = new Set<string>();
  let current: VoiceBinding | undefined = selected;
  while (current) {
    if (seen.has(current.id)) throw new VoiceCoordinatorError("Protected voice binding lineage contains a cycle.");
    seen.add(current.id);
    result.unshift(current);
    current = current.previousBindingId ? all.get(current.previousBindingId) : undefined;
    if (result.length > 32) throw new VoiceCoordinatorError("Protected voice binding lineage exceeds its bounded length.");
  }
  return result;
}
function live(value: VoiceBindingStatus): boolean { return value === "active" || value === "muted" || value === "interrupted"; }
function bindingStatus(value: unknown): value is VoiceBindingStatus { return value === "active" || value === "muted" || value === "interrupted" || value === "ended"; }
function provider(value: unknown): VoiceProvider { if (value === "claude" || value === "chatgpt" || value === "system") return value; throw new VoiceCoordinatorError("Unknown voice provider."); }
function transcriptPolicy(value: unknown): VoiceTranscriptPolicy { if (value === "off" || value === "redacted") return value; throw new VoiceCoordinatorError("Unknown transcript policy."); }
function retention(value: number, policy: VoiceTranscriptPolicy): number { if (!Number.isInteger(value) || value < 0 || value > 1_440 || (policy === "off" && value !== 0) || (policy === "redacted" && value < 1)) throw new VoiceCoordinatorError("Voice transcript retention does not match the selected privacy policy."); return value; }
function absoluteRoot(value: unknown): string { const result = text(value, "repository root"); if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(result)) throw new VoiceCoordinatorError("Voice repository root must be an absolute Windows path."); return result; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new VoiceCoordinatorError(`${label} must be a SHA-256 digest.`); return value.toLowerCase(); }
function text(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim() || value.length > 16_384 || /\0/.test(value)) throw new VoiceCoordinatorError(`${label} must be bounded nonempty text.`); return value.trim(); }
function time(value: unknown, label: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new VoiceCoordinatorError(`${label} must be an ISO timestamp.`); return value; }
function redactVoiceTranscript(value: string): string {
  return redactText(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-pii]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-pii]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-pii]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-pii]")
    .replace(/(?<!\w)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}(?!\w)/g, "[redacted-pii]")
    .replace(/\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){1,5}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b\.?/gi, "[redacted-pii]")
    .replace(/\b(?:account|customer|member|patient|case)\s*(?:id|number|no\.?|#)?\s*[:=#-]?\s*[A-Za-z0-9-]{4,}\b/gi, "[redacted-pii]")
    .replace(/\b(?:my name is|this is)\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3}\b/g, "[redacted-pii]");
}
function clone<T>(value: T): T { return jsonClone(value); }
