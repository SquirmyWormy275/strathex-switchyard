import type { TargetSnapshot } from "./contracts.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore } from "./store.ts";
import { targetSnapshotDigest } from "./snapshot.ts";

interface TargetSnapshotRecordedEvent {
  readonly snapshot: TargetSnapshot;
}

export class TargetSnapshotLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetSnapshotLedgerError";
  }
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TargetSnapshotLedgerError(`${field} must be non-empty.`);
  return value.trim();
}

function timestamp(value: unknown): string {
  const parsed = nonEmpty(value, "snapshot capture timestamp");
  if (!Number.isFinite(Date.parse(parsed))) throw new TargetSnapshotLedgerError("snapshot capture timestamp must be an ISO timestamp.");
  return parsed;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return nonEmpty(value, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotFromUnknown(value: unknown): TargetSnapshot {
  if (!isRecord(value)) throw new TargetSnapshotLedgerError("Protected TargetSnapshot record is malformed.");
  if (!isRecord(value.submodules)) throw new TargetSnapshotLedgerError("Protected TargetSnapshot submodules are malformed.");
  if (!Array.isArray(value.reasons) || !value.reasons.every((reason) => typeof reason === "string")) {
    throw new TargetSnapshotLedgerError("Protected TargetSnapshot reasons are malformed.");
  }
  const submodules: Record<string, string> = {};
  for (const [path, revision] of Object.entries(value.submodules)) submodules[nonEmpty(path, "submodule path")] = nonEmpty(revision, "submodule revision");
  const completeness = value.completeness;
  if (completeness !== "complete" && completeness !== "incomplete") throw new TargetSnapshotLedgerError("Protected TargetSnapshot completeness is malformed.");
  if (value.detached !== undefined && value.detached !== true) {
    throw new TargetSnapshotLedgerError("Protected TargetSnapshot detached-HEAD observation is malformed.");
  }
  const defaultBranch = optionalText(value.defaultBranch, "default branch");
  const snapshot: TargetSnapshot = {
    id: nonEmpty(value.id, "snapshot id"),
    repositoryRoot: nonEmpty(value.repositoryRoot, "repository root"),
    ...(optionalText(value.canonicalRemote, "canonical remote") ? { canonicalRemote: optionalText(value.canonicalRemote, "canonical remote") } : {}),
    ...(optionalText(value.branch, "branch") ? { branch: optionalText(value.branch, "branch") } : {}),
    ...(defaultBranch ? { defaultBranch } : {}),
    ...(value.detached === true ? { detached: true } : {}),
    ...(optionalText(value.upstream, "upstream") ? { upstream: optionalText(value.upstream, "upstream") } : {}),
    ...(optionalText(value.head, "HEAD") ? { head: optionalText(value.head, "HEAD") } : {}),
    ...(optionalText(value.indexTree, "index tree") ? { indexTree: optionalText(value.indexTree, "index tree") } : {}),
    trackedManifest: nonEmpty(value.trackedManifest, "tracked manifest"),
    untrackedManifest: nonEmpty(value.untrackedManifest, "untracked manifest"),
    submodules,
    policyVersion: nonEmpty(value.policyVersion, "policy version"),
    environmentFingerprint: nonEmpty(value.environmentFingerprint, "environment fingerprint"),
    capturedAt: timestamp(value.capturedAt),
    completeness,
    reasons: value.reasons.map((reason) => nonEmpty(reason, "snapshot reason"))
  };
  const expected = targetSnapshotDigest(snapshot);
  if (snapshot.id !== expected) throw new TargetSnapshotLedgerError("TargetSnapshot content ID does not match its immutable digest.");
  if (snapshot.completeness === "complete" && snapshot.reasons.length > 0) {
    throw new TargetSnapshotLedgerError("A complete TargetSnapshot cannot carry incompleteness reasons.");
  }
  return snapshot;
}

function snapshots(entries: readonly JournalEntry<unknown>[]): Map<string, TargetSnapshot> {
  const result = new Map<string, TargetSnapshot>();
  for (const entry of entries) {
    if (entry.kind !== "target-snapshot.recorded") continue;
    const snapshot = snapshotFromUnknown((entry.payload as TargetSnapshotRecordedEvent | undefined)?.snapshot);
    const existing = result.get(snapshot.id);
    if (existing && targetSnapshotDigest(existing) !== targetSnapshotDigest(snapshot)) {
      throw new TargetSnapshotLedgerError(`TargetSnapshot ${snapshot.id} was rebound to different immutable content.`);
    }
    if (!existing) result.set(snapshot.id, snapshot);
  }
  return result;
}

function clone(snapshot: TargetSnapshot): TargetSnapshot {
  return jsonClone(snapshot);
}

/**
 * A protected, content-addressed TargetSnapshot ledger. It is intentionally
 * append-only and records snapshots before policy/broker dispatch; no caller
 * can replace an old target with a same-named but different workspace state.
 */
export class TargetSnapshotLedger {
  private readonly store: ProtectedJsonStore;

  constructor(store: ProtectedJsonStore) {
    this.store = store;
  }

  async record(input: TargetSnapshot): Promise<TargetSnapshot> {
    const snapshot = snapshotFromUnknown(input);
    return this.store.transaction(async (transaction) => {
      const existing = snapshots(await transaction.readEntries()).get(snapshot.id);
      if (existing) return clone(existing);
      await transaction.append<TargetSnapshotRecordedEvent>("target-snapshot.recorded", { snapshot });
      return clone(snapshot);
    });
  }

  async get(id: string): Promise<TargetSnapshot | undefined> {
    const snapshot = snapshots(await this.store.readEntries()).get(nonEmpty(id, "snapshot id"));
    return snapshot ? clone(snapshot) : undefined;
  }

  async list(): Promise<readonly TargetSnapshot[]> {
    return [...snapshots(await this.store.readEntries()).values()].map(clone);
  }
}
