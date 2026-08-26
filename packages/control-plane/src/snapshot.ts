import type { TargetSnapshot } from "./contracts.ts";
import { sha256, stableJson } from "./store.ts";

export interface ManifestFile {
  readonly path: string;
  /** Content or canonical stat/hash data supplied by a trusted Git adapter. */
  readonly digest?: string;
  /** Every untracked file must be explicitly included or excluded by policy. */
  readonly classification?: "included" | "excluded" | "unknown";
  /** Ignored inputs are never silently absent from a consequential snapshot. */
  readonly source?: "untracked" | "ignored";
}

/**
 * The companion supplies this from a trusted Git adapter. Repository files,
 * CLI output, and shell text are data only; they never create authority.
 */
export interface GitInspection {
  readonly repositoryRoot?: string;
  readonly canonicalRemote?: string;
  readonly branch?: string;
  readonly defaultBranch?: string;
  readonly detached?: true;
  readonly upstream?: string;
  readonly head?: string;
  readonly indexTree?: string;
  readonly trackedFiles?: readonly ManifestFile[];
  readonly untrackedFiles?: readonly ManifestFile[];
  /** Policy-classified ignored worktree inputs, including protected config. */
  readonly ignoredFiles?: readonly ManifestFile[];
  readonly submodules?: Readonly<Record<string, string>>;
  readonly issues?: readonly string[];
}

export interface GitInspector {
  inspect(targetHint?: string): Promise<GitInspection>;
}

export interface SnapshotEnvironment {
  readonly toolVersions?: Readonly<Record<string, string>>;
  readonly scannerVersions?: Readonly<Record<string, string>>;
  readonly dependencyFingerprint?: string;
  readonly values?: Readonly<Record<string, string>>;
}

export interface SnapshotCaptureOptions {
  readonly policyVersion: string;
  readonly environment: SnapshotEnvironment;
  readonly targetHint?: string;
  /** Canonical remote and branch are required by default for consequential work. */
  readonly requireCanonicalRemote?: boolean;
  readonly requireBranch?: boolean;
}

export interface SnapshotRevalidation {
  readonly current: boolean;
  readonly expected: TargetSnapshot;
  readonly actual: TargetSnapshot;
}

/**
 * The immutable portion of a TargetSnapshot. Capture time is intentionally
 * excluded: two captures of the same exact workspace state retain the same
 * identity while their observation timestamps remain available in the ledger.
 */
export type TargetSnapshotIdentityInput = Omit<TargetSnapshot, "id" | "capturedAt">;

/**
 * Canonical material behind a TargetSnapshot content ID. Keeping this public
 * lets the durable ledger reject a caller-supplied ID that does not bind the
 * exact repository, worktree, policy, and environment state it claims to.
 */
export function targetSnapshotIdentity(snapshot: TargetSnapshotIdentityInput): Readonly<Record<string, unknown>> {
  return {
    repositoryRoot: snapshot.repositoryRoot,
    canonicalRemote: snapshot.canonicalRemote ?? null,
    branch: snapshot.branch ?? null,
    defaultBranch: snapshot.defaultBranch ?? null,
    detached: snapshot.detached ?? false,
    upstream: snapshot.upstream ?? null,
    head: snapshot.head ?? null,
    indexTree: snapshot.indexTree ?? null,
    trackedManifest: snapshot.trackedManifest,
    untrackedManifest: snapshot.untrackedManifest,
    submodules: Object.fromEntries(Object.keys(snapshot.submodules).sort().map((path) => [path, snapshot.submodules[path]!])),
    policyVersion: snapshot.policyVersion,
    environmentFingerprint: snapshot.environmentFingerprint,
    completeness: snapshot.completeness,
    reasons: [...snapshot.reasons]
  };
}

export function targetSnapshotDigest(snapshot: TargetSnapshotIdentityInput): string {
  return sha256(stableJson(targetSnapshotIdentity(snapshot)));
}

export class IncompleteTargetSnapshotError extends Error {
  constructor(snapshot: TargetSnapshot) {
    super(`TargetSnapshot ${snapshot.id} is incomplete: ${snapshot.reasons.join("; ") || "no reason supplied"}`);
    this.name = "IncompleteTargetSnapshotError";
  }
}

function nonEmpty(value: string | undefined, field: string, reasons: string[]): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    reasons.push(`${field} is unavailable.`);
    return undefined;
  }
  return value.trim();
}

function optionalNonEmpty(value: string | undefined, field: string, reasons: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (!value.trim()) {
    reasons.push(`${field} was supplied but empty.`);
    return undefined;
  }
  return value.trim();
}

function manifestDigest(files: readonly ManifestFile[] | undefined, kind: "tracked" | "untracked", reasons: string[]): string {
  if (!files) {
    reasons.push(`${kind} worktree manifest is unavailable.`);
    return sha256(stableJson({ kind, unavailable: true }));
  }
  const normalized: Array<{ path: string; digest: string; classification?: string; source?: string }> = [];
  const paths = new Set<string>();
  for (const file of files) {
    const path = file.path?.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!path) {
      reasons.push(`${kind} manifest contains an unnamed path.`);
      continue;
    }
    if (paths.has(path)) reasons.push(`${kind} manifest repeats ${path}.`);
    paths.add(path);
    if (!file.digest?.trim()) reasons.push(`${kind} manifest cannot hash ${path}.`);
    if (kind === "untracked" && (!file.classification || file.classification === "unknown")) {
      reasons.push(`Untracked file ${path} has no policy classification.`);
    }
    normalized.push({
      path,
      digest: file.digest?.trim() ?? "<unhashed>",
      ...(kind === "untracked" ? { classification: file.classification ?? "unknown", source: file.source ?? "untracked" } : {})
    });
  }
  normalized.sort((left, right) => left.path.localeCompare(right.path));
  return sha256(stableJson(normalized));
}

export function environmentFingerprint(environment: SnapshotEnvironment): string {
  return sha256(stableJson({
    toolVersions: environment.toolVersions ?? {},
    scannerVersions: environment.scannerVersions ?? {},
    dependencyFingerprint: environment.dependencyFingerprint ?? null,
    values: environment.values ?? {}
  }));
}

function safeEnvironmentFingerprint(environment: SnapshotEnvironment): string {
  try {
    return environmentFingerprint(environment);
  } catch {
    return sha256(stableJson({ environment: "invalid-or-unavailable" }));
  }
}

function hasEnvironmentEvidence(environment: SnapshotEnvironment): boolean {
  return Boolean(
    environment.dependencyFingerprint
    || Object.keys(environment.toolVersions ?? {}).length
    || Object.keys(environment.scannerVersions ?? {}).length
    || Object.keys(environment.values ?? {}).length
  );
}

function canonicalSubmodules(submodules: Readonly<Record<string, string>> | undefined, reasons: string[]): Readonly<Record<string, string>> {
  if (!submodules) {
    reasons.push("Submodule revisions are unavailable.");
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const key of Object.keys(submodules).sort()) {
    const revision = submodules[key];
    if (!revision?.trim()) {
      reasons.push(`Submodule revision is unavailable for ${key}.`);
      continue;
    }
    normalized[key.replaceAll("\\", "/")] = revision.trim();
  }
  return normalized;
}

/**
 * Builds deterministic snapshots from a host-injected inspector. It does not
 * invoke a shell itself, so deployments can use an audited adapter/broker and
 * tests can use an entirely isolated fake inspection.
 */
export class TargetSnapshotFactory {
  private readonly inspector: GitInspector;
  private readonly clock: () => string;

  constructor(inspector: GitInspector, options: { readonly clock?: () => string } = {}) {
    this.inspector = inspector;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async capture(options: SnapshotCaptureOptions): Promise<TargetSnapshot> {
    let inspection: GitInspection;
    try {
      inspection = await this.inspector.inspect(options.targetHint);
    } catch {
      return this.incompleteFromFailure(options, "Git inspection failed; target identity is unavailable.");
    }
    try {
      return this.fromInspection(inspection, options);
    } catch {
      return this.incompleteFromFailure(options, "Snapshot material was invalid or unavailable; consequential work is blocked.");
    }
  }

  async revalidate(expected: TargetSnapshot, options: SnapshotCaptureOptions): Promise<SnapshotRevalidation> {
    const actual = await this.capture(options);
    return { current: actual.completeness === "complete" && actual.id === expected.id, expected, actual };
  }

  assertComplete(snapshot: TargetSnapshot): asserts snapshot is TargetSnapshot & { readonly completeness: "complete" } {
    if (snapshot.completeness !== "complete") throw new IncompleteTargetSnapshotError(snapshot);
  }

  private fromInspection(inspection: GitInspection, options: SnapshotCaptureOptions): TargetSnapshot {
    const reasons = [...(inspection.issues ?? [])];
    const repositoryRoot = nonEmpty(inspection.repositoryRoot, "Canonical Git root", reasons) ?? options.targetHint ?? "<unresolved>";
    const canonicalRemote = (options.requireCanonicalRemote ?? true)
      ? nonEmpty(inspection.canonicalRemote, "Canonical remote", reasons)
      : optionalNonEmpty(inspection.canonicalRemote, "Canonical remote", reasons);
    const branch = optionalNonEmpty(inspection.branch, "Branch", reasons);
    const defaultBranch = optionalNonEmpty(inspection.defaultBranch, "Default branch", reasons);
    const detached = inspection.detached === true;
    if (branch && detached) reasons.push("Git target cannot be both branch-bound and detached.");
    const head = nonEmpty(inspection.head, "HEAD object id", reasons);
    const indexTree = nonEmpty(inspection.indexTree, "Index tree hash", reasons);
    const upstream = inspection.upstream?.trim() || undefined;
    const trackedManifest = manifestDigest(inspection.trackedFiles, "tracked", reasons);
    const untrackedInputs = [...(inspection.untrackedFiles ?? []).map((entry) => ({ ...entry, source: entry.source ?? "untracked" as const })), ...(inspection.ignoredFiles ?? []).map((entry) => ({ ...entry, source: "ignored" as const }))];
    const untrackedManifest = manifestDigest(untrackedInputs, "untracked", reasons);
    const submodules = canonicalSubmodules(inspection.submodules, reasons);
    const policyVersion = nonEmpty(options.policyVersion, "Repository policy version", reasons) ?? "<unresolved>";
    if (!hasEnvironmentEvidence(options.environment)) reasons.push("Tool, scanner, dependency, and environment fingerprints are unavailable.");
    const fingerprint = environmentFingerprint(options.environment);
    if (options.requireCanonicalRemote ?? true) {
      if (!canonicalRemote) reasons.push("Consequential work requires a canonical remote.");
    }
    if (options.requireBranch ?? true) {
      if (!branch && !detached) reasons.push("Consequential work requires a verified branch or detached-HEAD observation.");
    }
    const completeness = reasons.length === 0 ? "complete" : "incomplete";
    const identity: TargetSnapshotIdentityInput = {
      repositoryRoot,
      ...(canonicalRemote ? { canonicalRemote } : {}),
      ...(branch ? { branch } : {}),
      ...(defaultBranch ? { defaultBranch } : {}),
      ...(detached ? { detached: true as const } : {}),
      ...(upstream ? { upstream } : {}),
      ...(head ? { head } : {}),
      ...(indexTree ? { indexTree } : {}),
      trackedManifest,
      untrackedManifest,
      submodules,
      policyVersion,
      environmentFingerprint: fingerprint,
      completeness,
      reasons
    };
    return {
      id: targetSnapshotDigest(identity),
      repositoryRoot,
      ...(canonicalRemote ? { canonicalRemote } : {}),
      ...(branch ? { branch } : {}),
      ...(defaultBranch ? { defaultBranch } : {}),
      ...(detached ? { detached: true as const } : {}),
      ...(upstream ? { upstream } : {}),
      ...(head ? { head } : {}),
      ...(indexTree ? { indexTree } : {}),
      trackedManifest,
      untrackedManifest,
      submodules,
      policyVersion,
      environmentFingerprint: fingerprint,
      capturedAt: this.clock(),
      completeness,
      reasons
    };
  }

  private incompleteFromFailure(options: SnapshotCaptureOptions, reason: string): TargetSnapshot {
    const repositoryRoot = options.targetHint ?? "<unresolved>";
    const fingerprint = safeEnvironmentFingerprint(options.environment);
    const reasons = [reason];
    const trackedManifest = sha256(stableJson({ unavailable: "tracked" }));
    const untrackedManifest = sha256(stableJson({ unavailable: "untracked" }));
    const identity: TargetSnapshotIdentityInput = {
      repositoryRoot,
      trackedManifest,
      untrackedManifest,
      submodules: {},
      policyVersion: options.policyVersion || "<unresolved>",
      environmentFingerprint: fingerprint,
      completeness: "incomplete",
      reasons
    };
    return {
      // Failure snapshots must use the same immutable identity material as
      // successful captures.  Otherwise the protected snapshot ledger would
      // reject the very incomplete evidence that is needed to explain why a
      // consequential action failed closed.
      id: targetSnapshotDigest(identity),
      repositoryRoot,
      trackedManifest,
      untrackedManifest,
      submodules: {},
      policyVersion: identity.policyVersion,
      environmentFingerprint: fingerprint,
      capturedAt: this.clock(),
      completeness: "incomplete",
      reasons
    };
  }
}
