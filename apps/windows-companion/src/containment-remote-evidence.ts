/** Host-owned, offline signed evidence for the complete containment remote namespace. */
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute, resolve } from "node:path";

import type {
  ContainmentAssessmentRequest,
  ContainmentAssessmentResult,
  ContainmentAssessmentStatus,
  ContainmentExposure,
  ContainmentFinding
} from "../../../packages/control-plane/src/containment-incidents.ts";
import { untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import { stableJson, type JournalEntry, type JsonValue, type ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";

const trustInstallKind = "b122.containment-remote.trust.install.v3";
const trustRevokeKind = "b122.containment-remote.trust.revoke.v3";
const challengeIssueKind = "b122.containment-remote.challenge.issue.v3";
const evidenceImportKind = "b122.containment-remote.evidence.import.v3";
const evidenceConsumeKind = "b122.containment-remote.evidence.consume.v3";
const purpose = "containment-remote-assessment" as const;
const signatureAlgorithm = "ecdsa-p256-sha256" as const;
const maximumTrustBytes = 64 * 1024;
const maximumEvidenceBytes = 256 * 1024;
const maximumChallengeLifetimeMs = 15 * 60_000;
const maximumEvidenceAgeMs = 15 * 60_000;
const maximumFutureSkewMs = 60_000;
const maximumRemotes = 16;
const maximumRefsPerRemote = 256;
const maximumFindingsPerRef = 64;
const maximumFindings = 512;
const digestPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const incidentPattern = /^containment-incident:[a-f0-9]{64}$/;
const childPattern = /^containment-assessment:[a-f0-9]{64}$/;
const challengePattern = /^containment-remote-challenge:[a-f0-9]{64}$/;
const evidencePattern = /^containment-remote-evidence:[a-f0-9]{64}$/;
const findingPattern = /^containment-finding:[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const remoteNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const containmentRemoteDetectorPatterns = Object.freeze([
  "(api[_-]?key|password|passwd|pwd|secret|token|credential|authorization|client[_-]?secret|private[_-]?key|access[_-]?key)[[:space:]]*[:=][[:space:]]*[^[:space:]]+",
  "-----BEGIN[[:space:]]+(RSA|EC|OPENSSH|DSA|PGP)?[[:space:]]*PRIVATE KEY-----",
  "(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})",
  "(AKIA|ASIA)[A-Z0-9]{16}",
  "xox[baprs]-[A-Za-z0-9-]{10,}",
  "Bearer[[:space:]]+[A-Za-z0-9._~+/-]{16,}"
] as const);
const containmentRemoteScanArguments = Object.freeze([
  "--root", "-m", "--full-history", "--text", "--no-ext-diff", "--no-textconv",
  "--extended-regexp", "--regexp-ignore-case", "--format=", "--name-only", "-z"
] as const);
const containmentRemotePathspec = Object.freeze(["--", "."] as const);
const containmentRemoteMirrorIntegrityChecks = Object.freeze([
  Object.freeze({ id: "non-shallow" as const, arguments: Object.freeze(["rev-parse", "--is-shallow-repository"] as const), expectation: "stdout-exact-false" as const }),
  Object.freeze({ id: "no-promisor-config" as const, arguments: Object.freeze(["config", "--local", "--get-regexp", "^(extensions\\.partialClone|remote\\..*\\.promisor)$"] as const), expectation: "exit-one-empty" as const }),
  Object.freeze({ id: "object-closure" as const, arguments: Object.freeze(["rev-list", "--objects", "--all", "--missing=print"] as const), expectation: "no-missing-markers" as const }),
  Object.freeze({ id: "strict-fsck" as const, arguments: Object.freeze(["fsck", "--full", "--strict", "--no-dangling", "--no-reflogs"] as const), expectation: "exit-zero" as const })
] as const);

export const containmentRemoteDetectorManifest = Object.freeze({
  schema: "sxsy-b122.containment-remote-detector-manifest" as const,
  version: 2 as const,
  id: "credential-history-signatures-v2" as const,
  namespaceScope: "all-advertised-refs" as const,
  pathHandling: "sha256-redacted-v1" as const,
  detectors: Object.freeze([
    "credential-assignment", "authorization-bearer", "private-key-block",
    "github-token", "aws-access-key", "slack-token"
  ] as const),
  patterns: containmentRemoteDetectorPatterns,
  patternSha256: sha256(containmentRemoteDetectorPatterns.join("|")),
  scanProfile: Object.freeze({
    id: "git-log-full-history-paths-v1" as const,
    fixedArguments: containmentRemoteScanArguments,
    patternOption: "-G" as const,
    pathspec: containmentRemotePathspec,
    mirrorIntegrityChecks: containmentRemoteMirrorIntegrityChecks,
    fixedArgumentsSha256: sha256(stableJson({
      fixedArguments: containmentRemoteScanArguments, patternOption: "-G", pathspec: containmentRemotePathspec,
      mirrorIntegrityChecks: containmentRemoteMirrorIntegrityChecks
    }))
  })
});

export type ContainmentRemoteEvaluationProfile = "production-public-https-v1" | "test-local-file-v1";
export type ContainmentRemoteNetworkPolicy = "public-https-dns-pinned-no-redirect-v1" | "test-local-file-no-network-v1";

export interface ContainmentRemoteNetworkBinding {
  readonly remoteName: string;
  readonly hostname: string;
  readonly port: 443;
  readonly addresses: readonly string[];
}

export interface ContainmentRemoteToolManifest {
  readonly schema: "sxsy-b122.containment-remote-tool-manifest";
  readonly version: 1;
  readonly detectorManifest: typeof containmentRemoteDetectorManifest;
  readonly gitExecutableSha256: string;
  readonly gitVersion: string;
  readonly evaluationProfile: ContainmentRemoteEvaluationProfile;
  readonly networkPolicy: ContainmentRemoteNetworkPolicy;
  readonly networkBindings: readonly ContainmentRemoteNetworkBinding[];
}

export type ContainmentRemoteEvidencePurpose = typeof purpose;

export interface ContainmentRemoteTrustPolicy {
  readonly schema: "sxsy-b122.containment-remote-trust-policy";
  /** Version 1 is retained in the structural type only for legacy test/admin adapters; installation rejects it closed. */
  readonly version: 1 | 2;
  readonly purpose: ContainmentRemoteEvidencePurpose;
  readonly authorityId: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly gitExecutableSha256?: string;
  readonly detectorManifestId?: typeof containmentRemoteDetectorManifest.id;
  readonly networkPolicy?: "public-https-dns-pinned-no-redirect-v1";
  readonly expiresAt: string;
}

export interface InstalledContainmentRemoteTrust extends ContainmentRemoteTrustPolicy {
  readonly installedAt: string;
  readonly installedBy: string;
  readonly status: "active" | "revoked";
  readonly revokedAt?: string;
}

/** A trusted host inventory entry. This must never be populated from an IPC command payload. */
export interface ContainmentConfiguredRemote {
  readonly name: string;
  readonly canonicalIdentity: string;
}

export interface ContainmentRemoteNamespaceRef {
  readonly ref: string;
  readonly head: string;
}

/**
 * The trusted host supplies this complete binding from the current incident,
 * TargetSnapshot, policy, and live Git configuration. An evaluator supplies no
 * part of it and a UI/API caller must not select remote names or refs.
 */
export interface ContainmentRemoteEvidenceBinding {
  readonly request: ContainmentAssessmentRequest;
  readonly generation: number;
  readonly targetSnapshotId: string;
  readonly policyVersion: string;
  readonly authorityId: string;
  readonly keyId: string;
  readonly configuredRemotes: readonly ContainmentConfiguredRemote[];
}

export interface ContainmentRemoteChallengeIssue extends ContainmentRemoteEvidenceBinding {
  readonly expiresAt: string;
}

export interface ContainmentRemoteEvidenceChallenge {
  readonly schema: "sxsy-b122.containment-remote-challenge";
  readonly version: 3;
  readonly purpose: ContainmentRemoteEvidencePurpose;
  readonly id: string;
  readonly authorityId: string;
  readonly keyId: string;
  readonly incidentId: string;
  readonly repositoryRootDigest: string;
  readonly fenceEpoch: number;
  readonly generation: number;
  readonly remoteOperationId: string;
  readonly remoteExternalId: string;
  readonly targetSnapshotId: string;
  readonly policyVersion: string;
  readonly configuredRemotes: readonly ContainmentConfiguredRemote[];
  readonly gitExecutableSha256: string;
  readonly detectorManifestId: typeof containmentRemoteDetectorManifest.id;
  readonly evaluationProfile: ContainmentRemoteEvaluationProfile;
  readonly networkPolicy: ContainmentRemoteNetworkPolicy;
  readonly challengeNonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface InstalledContainmentRemoteChallenge extends ContainmentRemoteEvidenceChallenge {
  readonly issuedBy: string;
  readonly status: "active" | "used";
  readonly evidenceId?: string;
}

export interface ContainmentRemoteEvidenceFinding {
  readonly relativePath: string;
  readonly pathSha256: string;
  readonly credentialRelated: boolean;
}

export interface ContainmentRemoteEvidenceRefResult extends ContainmentRemoteNamespaceRef {
  readonly status: ContainmentAssessmentStatus;
  readonly exposure: ContainmentExposure;
  readonly summary: string;
  readonly findings: readonly ContainmentRemoteEvidenceFinding[];
}

export interface ContainmentRemoteNamespaceResult extends ContainmentConfiguredRemote {
  readonly namespaceComplete: true;
  readonly refCount: number;
  readonly namespaceSha256: string;
  readonly namespaceRefs: readonly ContainmentRemoteNamespaceRef[];
  readonly status: ContainmentAssessmentStatus;
  readonly exposure: ContainmentExposure;
  readonly summary: string;
  readonly refResults: readonly ContainmentRemoteEvidenceRefResult[];
}

export interface SignedContainmentRemoteEvidence {
  readonly schema: "sxsy-b122.containment-remote-evidence";
  readonly version: 3;
  readonly purpose: ContainmentRemoteEvidencePurpose;
  readonly evidenceId: string;
  readonly authorityId: string;
  readonly keyId: string;
  readonly challenge: ContainmentRemoteEvidenceChallenge;
  readonly evaluatorNonce: string;
  readonly evaluatedAt: string;
  readonly expiresAt: string;
  readonly namespaceComplete: true;
  readonly status: ContainmentAssessmentStatus;
  readonly exposure: ContainmentExposure;
  readonly summary: string;
  readonly toolManifest: ContainmentRemoteToolManifest;
  readonly remoteResults: readonly ContainmentRemoteNamespaceResult[];
  readonly signatureAlgorithm: typeof signatureAlgorithm;
  readonly signature: string;
}

export type UnsignedContainmentRemoteEvidence = Omit<SignedContainmentRemoteEvidence, "signature">;

interface StoredRemoteResult {
  readonly status: ContainmentAssessmentStatus;
  readonly exposure: ContainmentExposure;
  readonly summary: string;
  readonly findings: readonly ContainmentFinding[];
}

export interface ImportedContainmentRemoteEvidence {
  readonly evidenceId: string;
  readonly challengeId: string;
  readonly authorityId: string;
  readonly keyId: string;
  readonly evaluatorNonce: string;
  readonly evaluatedAt: string;
  readonly expiresAt: string;
  readonly documentSha256: string;
  readonly importedAt: string;
  readonly importedBy: string;
  readonly toolManifest: ContainmentRemoteToolManifest;
  readonly result: StoredRemoteResult;
  readonly status: "available" | "consumed";
  readonly consumedAt?: string;
  readonly consumptionDigest?: string;
}

export interface ContainmentRemoteEvidenceObservation {
  readonly state: "absent" | "available" | "consumed" | "invalid" | "not_required";
  readonly evidenceId?: string;
  readonly challengeId?: string;
  readonly result?: ContainmentAssessmentResult;
}

export interface ContainmentRemoteReleaseValidation {
  readonly evidenceId: string;
  readonly challengeId: string;
  readonly documentSha256: string;
  readonly consumptionDigest: string;
  readonly consumedAt: string;
  readonly validatedAt: string;
  readonly generation: number;
  readonly targetSnapshotId: string;
  readonly remoteOperationId: string;
  readonly remoteExternalId: string;
  readonly configuredRemotes: readonly ContainmentConfiguredRemote[];
  readonly result: ContainmentAssessmentResult;
}

export interface ContainmentRemoteEvidencePort {
  /** Read-only recovery. A valid consumed result remains observable after a host crash. */
  resolve(binding: ContainmentRemoteEvidenceBinding): Promise<ContainmentAssessmentResult | undefined>;
  /** The only transition from imported evidence to the exact remote child. */
  consume(binding: ContainmentRemoteEvidenceBinding): Promise<ContainmentAssessmentResult | undefined>;
  /** Distinguishes a crash-reconcilable consumed result from absent or invalid evidence. */
  observe(binding: ContainmentRemoteEvidenceBinding): Promise<ContainmentRemoteEvidenceObservation>;
  /** Host-only, read-only final check for the exact current release binding. */
  validateConsumedForRelease(binding: ContainmentRemoteEvidenceBinding): Promise<ContainmentRemoteReleaseValidation>;
}

export interface ContainmentRemoteEvidenceRegistryOptions {
  readonly now?: () => Date;
  readonly nonceFactory?: () => string;
}

interface RegistryState {
  readonly trust: Map<string, InstalledContainmentRemoteTrust>;
  readonly challenges: Map<string, InstalledContainmentRemoteChallenge>;
  readonly evidence: Map<string, ImportedContainmentRemoteEvidence>;
}

/** Protected, append-only registry. It performs no network access. */
export class DurableContainmentRemoteEvidenceRegistry implements ContainmentRemoteEvidencePort {
  private readonly now: () => Date;
  private readonly nonceFactory: () => string;

  constructor(private readonly store: ProtectedJsonStore, options: ContainmentRemoteEvidenceRegistryOptions = {}) {
    if (!store.hasAuthenticatedProtection) throw new Error("Containment remote evidence requires authenticated host-owned durable storage.");
    this.now = options.now ?? (() => new Date());
    this.nonceFactory = options.nonceFactory ?? (() => randomBytes(32).toString("hex"));
  }

  async installTrust(policyInput: ContainmentRemoteTrustPolicy, installedByInput: string): Promise<InstalledContainmentRemoteTrust> {
    const policy = validateTrust(policyInput, this.now());
    const installedBy = boundedText(installedByInput, "containment remote trust operator", 160);
    return this.store.transaction(async (transaction) => {
      const state = readState(await transaction.readEntries());
      if ([...state.trust.values()].some((item) => item.authorityId === policy.authorityId && item.status === "active")) {
        throw new Error("An active containment remote authority already exists; revoke it before key rotation.");
      }
      if (state.trust.has(trustKey(policy.authorityId, policy.keyId))) throw new Error("Containment remote trust history cannot reinstall the same key identity.");
      const entry = await transaction.append(trustInstallKind, { policy: policy as unknown as JsonValue, installedBy });
      return { ...policy, installedAt: entry.at, installedBy, status: "active" };
    });
  }

  async revokeTrust(authorityIdInput: string, keyIdInput: string, reasonInput: string, revokedByInput: string): Promise<InstalledContainmentRemoteTrust> {
    const authorityId = identifier(authorityIdInput, "containment remote authority");
    const keyId = digest(keyIdInput, "containment remote key");
    const reason = boundedText(reasonInput, "containment remote trust revocation", 512);
    const revokedBy = boundedText(revokedByInput, "containment remote trust operator", 160);
    return this.store.transaction(async (transaction) => {
      const state = readState(await transaction.readEntries());
      const current = state.trust.get(trustKey(authorityId, keyId));
      if (!current || current.status !== "active") throw new Error("The containment remote authority is absent or already revoked.");
      const entry = await transaction.append(trustRevokeKind, { authorityId, keyId, reason, revokedBy });
      return { ...current, status: "revoked", revokedAt: entry.at };
    });
  }

  async listTrust(): Promise<readonly InstalledContainmentRemoteTrust[]> {
    return [...readState(await this.store.readEntries()).trust.values()].map(clone);
  }

  async issueChallenge(input: ContainmentRemoteChallengeIssue, issuedByInput: string): Promise<ContainmentRemoteEvidenceChallenge> {
    const issuedAt = exactNow(this.now());
    const binding = validateBinding(input);
    if (binding.configuredRemotes.length === 0) throw new Error("No configured remotes exist; signed remote evidence is not required.");
    for (const remote of binding.configuredRemotes) requireProductionRemoteIdentity(remote.canonicalIdentity);
    const expiresAt = future(input.expiresAt, issuedAt, maximumChallengeLifetimeMs, "containment remote challenge expiry");
    const challengeNonce = digest(this.nonceFactory(), "containment remote challenge nonce");
    const issuedBy = boundedText(issuedByInput, "containment remote challenge operator", 160);
    return this.store.transaction(async (transaction) => {
      const state = readState(await transaction.readEntries());
      const anchor = state.trust.get(trustKey(binding.authorityId, binding.keyId));
      requireUsableTrust(anchor, issuedAt, expiresAt);
      const withoutId = {
        schema: "sxsy-b122.containment-remote-challenge" as const, version: 3 as const, purpose,
        authorityId: binding.authorityId, keyId: binding.keyId,
        incidentId: binding.request.incidentId, repositoryRootDigest: repositoryDigest(binding.request.repositoryRoot),
        fenceEpoch: binding.request.fenceEpoch, generation: binding.generation,
        remoteOperationId: binding.request.operationId, remoteExternalId: binding.request.externalId,
        targetSnapshotId: binding.targetSnapshotId, policyVersion: binding.policyVersion,
        configuredRemotes: binding.configuredRemotes,
        gitExecutableSha256: digest(anchor.gitExecutableSha256, "containment remote Git executable"),
        detectorManifestId: detectorManifestId(anchor.detectorManifestId),
        evaluationProfile: "production-public-https-v1" as const,
        networkPolicy: productionNetworkPolicy(anchor.networkPolicy),
        challengeNonce, issuedAt: issuedAt.toISOString(), expiresAt
      };
      const challenge: ContainmentRemoteEvidenceChallenge = { ...withoutId, id: deriveChallengeId(withoutId) };
      const exactBinding = challengeBindingDigest(challenge);
      const existing = [...state.challenges.values()].filter((item) => challengeBindingDigest(item) === exactBinding);
      if (existing.some((item) => item.evidenceId || Date.parse(item.expiresAt) > issuedAt.getTime())) {
        throw new Error("A live or already-used containment remote challenge exists for this exact generation and child binding.");
      }
      if ([...state.challenges.values()].some((item) => item.challengeNonce === challenge.challengeNonce)) throw new Error("The containment remote challenge nonce was reused.");
      await transaction.append(challengeIssueKind, { challenge: challenge as unknown as JsonValue, issuedBy });
      return clone(challenge);
    });
  }

  async listChallenges(): Promise<readonly InstalledContainmentRemoteChallenge[]> {
    return [...readState(await this.store.readEntries()).challenges.values()].map(clone);
  }

  async importEvidence(sourcePath: string, importedByInput: string): Promise<ImportedContainmentRemoteEvidence> {
    const selected = await readBoundedRegularFile(sourcePath, maximumEvidenceBytes, "containment remote evidence");
    const observedAt = exactNow(this.now());
    const signed = parseEvidence(selected.bytes, observedAt);
    const importedBy = boundedText(importedByInput, "containment remote evidence operator", 160);
    return this.store.transaction(async (transaction) => {
      const state = readState(await transaction.readEntries());
      const challenge = state.challenges.get(signed.challenge.id);
      if (!challenge || !sameDigest(stableJson(challengeDocument(challenge)), stableJson(signed.challenge))) {
        throw new Error("Containment remote evidence changed the exact host-issued challenge binding.");
      }
      if (challenge.status === "used" || [...state.evidence.values()].some((item) => item.challengeId === challenge.id)) {
        throw new Error("The containment remote challenge was already used; evidence replay is rejected.");
      }
      const anchor = state.trust.get(trustKey(signed.authorityId, signed.keyId));
      requireUsableTrust(anchor, observedAt, signed.expiresAt);
      if (signed.authorityId !== challenge.authorityId || signed.keyId !== challenge.keyId) throw new Error("Containment remote evidence uses the wrong authority or key binding.");
      if (signed.challenge.evaluationProfile !== "production-public-https-v1"
        || signed.toolManifest.evaluationProfile !== "production-public-https-v1"
        || signed.challenge.networkPolicy !== "public-https-dns-pinned-no-redirect-v1") {
        throw new Error("Test-local or non-production remote evidence cannot be imported into the release registry.");
      }
      verifySignedEvidence(signed, anchor);
      assertRemoteCoverage(challenge.configuredRemotes, signed.remoteResults);
      if ([...state.evidence.values()].some((item) => item.authorityId === signed.authorityId && item.keyId === signed.keyId && item.evaluatorNonce === signed.evaluatorNonce)) {
        throw new Error("Containment remote evaluator nonce replay is rejected.");
      }
      const result = storedResult(signed);
      const stored: Omit<ImportedContainmentRemoteEvidence, "importedAt" | "status"> = {
        evidenceId: signed.evidenceId, challengeId: challenge.id, authorityId: signed.authorityId, keyId: signed.keyId,
        evaluatorNonce: signed.evaluatorNonce, evaluatedAt: signed.evaluatedAt, expiresAt: signed.expiresAt,
        documentSha256: sha256(selected.bytes), importedBy, toolManifest: signed.toolManifest, result
      };
      if (state.evidence.has(stored.evidenceId)) throw new Error("Containment remote evidence identity was already imported; replay is rejected.");
      const entry = await transaction.append(evidenceImportKind, { evidence: stored as unknown as JsonValue });
      return { ...stored, importedAt: entry.at, status: "available" };
    });
  }

  async listEvidence(): Promise<readonly ImportedContainmentRemoteEvidence[]> {
    return [...readState(await this.store.readEntries()).evidence.values()].map(clone);
  }

  async observe(bindingInput: ContainmentRemoteEvidenceBinding): Promise<ContainmentRemoteEvidenceObservation> {
    const binding = validateBinding(bindingInput);
    if (binding.configuredRemotes.length === 0) return { state: "not_required", result: containmentRemoteResultForNoConfiguredRemotes(binding) };
    const state = readState(await this.store.readEntries());
    const selected = selectEvidence(state, binding);
    if (!selected) return { state: "absent" };
    if (!usableEvidence(state, selected.challenge, selected.evidence, this.now())) {
      return { state: "invalid", evidenceId: selected.evidence.evidenceId, challengeId: selected.challenge.id };
    }
    return {
      state: selected.evidence.status, evidenceId: selected.evidence.evidenceId, challengeId: selected.challenge.id,
      result: resultFor(binding.request, selected.evidence.result)
    };
  }

  async resolve(bindingInput: ContainmentRemoteEvidenceBinding): Promise<ContainmentAssessmentResult | undefined> {
    const observation = await this.observe(bindingInput);
    return observation.state === "available" || observation.state === "consumed" || observation.state === "not_required" ? observation.result : undefined;
  }

  async consume(bindingInput: ContainmentRemoteEvidenceBinding): Promise<ContainmentAssessmentResult | undefined> {
    const binding = validateBinding(bindingInput);
    if (binding.configuredRemotes.length === 0) return containmentRemoteResultForNoConfiguredRemotes(binding);
    const consumptionDigest = bindingDigest(binding);
    return this.store.transaction(async (transaction) => {
      const state = readState(await transaction.readEntries());
      const selected = selectEvidence(state, binding);
      if (!selected) return undefined;
      if (!usableEvidence(state, selected.challenge, selected.evidence, this.now())) throw new Error("Containment remote evidence is expired, revoked, or otherwise unavailable.");
      if (selected.evidence.status === "consumed") throw new Error("Containment remote evidence was already consumed; replay is rejected.");
      await transaction.append(evidenceConsumeKind, { evidenceId: selected.evidence.evidenceId, consumptionDigest });
      return resultFor(binding.request, selected.evidence.result);
    });
  }

  async validateConsumedForRelease(bindingInput: ContainmentRemoteEvidenceBinding): Promise<ContainmentRemoteReleaseValidation> {
    const binding = validateBinding(bindingInput);
    if (binding.configuredRemotes.length === 0) throw new Error("No configured remotes exist; signed evidence is not required for this release binding.");
    const state = readState(await this.store.readEntries());
    const selected = selectEvidence(state, binding);
    if (!selected || selected.evidence.status !== "consumed" || !selected.evidence.consumedAt || !selected.evidence.consumptionDigest) {
      throw new Error("No consumed containment remote evidence exists for the exact current release binding.");
    }
    const validatedAt = exactNow(this.now());
    if (!usableEvidence(state, selected.challenge, selected.evidence, validatedAt)) throw new Error("Consumed containment remote evidence is expired, revoked, invalid, or unavailable.");
    const expectedDigest = bindingDigest(binding);
    if (!sameDigest(selected.evidence.consumptionDigest, expectedDigest)) throw new Error("Consumed containment remote evidence changed its exact release binding.");
    if (selected.evidence.result.status !== "passed" || selected.evidence.result.exposure !== "none" || selected.evidence.result.findings.length !== 0) {
      throw new Error("Consumed containment remote evidence is not a clean complete-namespace release result.");
    }
    return {
      evidenceId: selected.evidence.evidenceId, challengeId: selected.challenge.id,
      documentSha256: selected.evidence.documentSha256, consumptionDigest: selected.evidence.consumptionDigest,
      consumedAt: selected.evidence.consumedAt, validatedAt: validatedAt.toISOString(),
      generation: selected.challenge.generation, targetSnapshotId: selected.challenge.targetSnapshotId,
      remoteOperationId: selected.challenge.remoteOperationId, remoteExternalId: selected.challenge.remoteExternalId,
      configuredRemotes: clone(selected.challenge.configuredRemotes), result: resultFor(binding.request, selected.evidence.result)
    };
  }
}

export interface ContainmentRemoteEvidenceAdministration {
  installTrustPolicy(sourcePath: string): Promise<InstalledContainmentRemoteTrust>;
  listTrust(): Promise<readonly InstalledContainmentRemoteTrust[]>;
  revokeTrust(authorityId: string, keyId: string, reason: string): Promise<InstalledContainmentRemoteTrust>;
  issueChallenge(input: ContainmentRemoteChallengeIssue): Promise<ContainmentRemoteEvidenceChallenge>;
  listChallenges(): Promise<readonly InstalledContainmentRemoteChallenge[]>;
  importEvidence(sourcePath: string): Promise<ImportedContainmentRemoteEvidence>;
  listEvidence(): Promise<readonly ImportedContainmentRemoteEvidence[]>;
}

export function createContainmentRemoteEvidenceAdministration(options: Readonly<{
  registry: DurableContainmentRemoteEvidenceRegistry;
  presence: WindowsUserPresenceRunner;
  now?: () => Date;
}>): ContainmentRemoteEvidenceAdministration {
  const operator = async (prompt: string): Promise<string> => {
    const result = await options.presence.verify(prompt);
    if (!result.verified || !result.operator?.trim()) throw new Error("Current-user presence did not approve containment remote-evidence administration.");
    return boundedText(result.operator, "containment remote evidence operator", 160);
  };
  return {
    async installTrustPolicy(sourcePath) {
      const selected = await readBoundedRegularFile(sourcePath, maximumTrustBytes, "containment remote trust policy");
      const policy = parseTrust(selected.bytes, options.now?.() ?? new Date());
      return options.registry.installTrust(policy, await operator(`Install purpose-scoped containment remote authority ${policy.authorityId} key ${policy.keyId.slice(0, 12)}.`));
    },
    async listTrust() { return options.registry.listTrust(); },
    async revokeTrust(authorityId, keyId, reason) { return options.registry.revokeTrust(authorityId, keyId, reason, await operator(`Revoke containment remote authority ${authorityId} key ${keyId.slice(0, 12)}.`)); },
    async issueChallenge(input) { return options.registry.issueChallenge(input, await operator(`Issue one offline complete-namespace challenge for ${input.request.incidentId}.`)); },
    async listChallenges() { return options.registry.listChallenges(); },
    async importEvidence(sourcePath) { return options.registry.importEvidence(sourcePath, await operator("Import one selected signed complete-namespace evidence document.")); },
    async listEvidence() { return options.registry.listEvidence(); }
  };
}

/** Exact canonical bytes an independent evaluator signs. */
export function containmentRemoteEvidenceSigningPayload(value: UnsignedContainmentRemoteEvidence): Uint8Array {
  return Buffer.from(stableJson(value), "utf8");
}

export function containmentRemoteEvidenceId(challengeIdInput: string, evaluatorNonceInput: string, authorityIdInput: string, keyIdInput: string): string {
  const challengeId = pattern(challengeIdInput, challengePattern, "containment remote challenge id");
  const evaluatorNonce = digest(evaluatorNonceInput, "containment remote evaluator nonce");
  const authorityId = identifier(authorityIdInput, "containment remote authority");
  const keyId = digest(keyIdInput, "containment remote key");
  return `containment-remote-evidence:${sha256(stableJson({ authorityId, challengeId, evaluatorNonce, keyId, purpose }))}`;
}

/** Exact identity of a host-issued challenge, for independent evaluator verification. */
export function containmentRemoteChallengeId(value: Omit<ContainmentRemoteEvidenceChallenge, "id">): string {
  return deriveChallengeId(value);
}

/** Strict shared parser used by the host and an independent evaluator. */
export function validateContainmentRemoteEvidenceChallenge(value: unknown, now: Date): ContainmentRemoteEvidenceChallenge {
  return parseChallenge(value, exactNow(now));
}

/** Digest of the evaluator's ordered complete advertised-ref namespace inventory. */
export function containmentRemoteNamespaceDigest(refsInput: readonly ContainmentRemoteNamespaceRef[]): string {
  const refs = parseNamespaceRefs(refsInput, "containment remote namespace");
  return sha256(stableJson(refs));
}

/** Canonical credential-free identity used by the trusted host inventory. */
export function canonicalContainmentRemoteIdentity(value: string): string { return canonicalRemote(value); }

export function containmentProductionRemoteEndpoint(value: string): Readonly<{ hostname: string; port: 443 }> {
  const canonical = canonicalRemote(value);
  let url: URL;
  try { url = new URL(canonical); } catch { throw new Error("Containment production remote must be fixed public HTTPS."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || url.hostname.toLowerCase() === "localhost" || (isIP(url.hostname) && !containmentPublicAddress(url.hostname))) {
    throw new Error("Containment production remote must be credential-free public HTTPS on port 443.");
  }
  return { hostname: url.hostname.toLowerCase(), port: 443 };
}

export function containmentPublicAddress(value: string): boolean {
  const family = isIP(value);
  if (family === 4) {
    const octets = value.split(".").map(Number);
    const [a, b] = octets;
    return !(a === 0 || a === 10 || a === 127 || a! >= 224
      || (a === 100 && b! >= 64 && b! <= 127)
      || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19))
      || (a === 192 && b === 0 && octets[2] === 2) || (a === 198 && b === 51 && octets[2] === 100)
      || (a === 203 && b === 0 && octets[2] === 113));
  }
  if (family === 6) {
    const normalized = value.toLowerCase();
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8:")) return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    return mapped ? containmentPublicAddress(mapped[1]!) : true;
  }
  return false;
}

/** The only clean result path that does not use signed evidence. */
export function containmentRemoteResultForNoConfiguredRemotes(bindingInput: ContainmentRemoteEvidenceBinding): ContainmentAssessmentResult {
  const binding = validateBinding(bindingInput);
  if (binding.configuredRemotes.length !== 0) throw new Error("The no-configured-remotes result cannot represent a repository that has remotes.");
  return resultFor(binding.request, { status: "passed", exposure: "none", summary: "No Git remotes are configured in the current host-derived target.", findings: [] });
}

function readState(entries: readonly JournalEntry<unknown>[]): RegistryState {
  const trust = new Map<string, InstalledContainmentRemoteTrust>();
  const challenges = new Map<string, InstalledContainmentRemoteChallenge>();
  const evidence = new Map<string, ImportedContainmentRemoteEvidence>();
  const evidenceByChallenge = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === trustInstallKind) {
      const payload = exactRecord(entry.payload, ["policy", "installedBy"], "protected containment remote trust installation");
      const policy = validateTrust(payload.policy, new Date(0), true);
      const key = trustKey(policy.authorityId, policy.keyId);
      if (trust.has(key)) throw new Error("Protected containment remote trust history contains a duplicate installation.");
      trust.set(key, { ...policy, installedAt: exactIso(entry.at, "containment remote trust installation"), installedBy: boundedText(payload.installedBy, "containment remote trust operator", 160), status: "active" });
    } else if (entry.kind === trustRevokeKind) {
      const payload = exactRecord(entry.payload, ["authorityId", "keyId", "reason", "revokedBy"], "protected containment remote trust revocation");
      const key = trustKey(identifier(payload.authorityId, "containment remote authority"), digest(payload.keyId, "containment remote key"));
      boundedText(payload.reason, "containment remote trust revocation", 512);
      boundedText(payload.revokedBy, "containment remote trust operator", 160);
      const current = trust.get(key);
      if (!current || current.status !== "active") throw new Error("Protected containment remote trust revocation has no active predecessor.");
      trust.set(key, { ...current, status: "revoked", revokedAt: exactIso(entry.at, "containment remote trust revocation") });
    } else if (entry.kind === challengeIssueKind) {
      const payload = exactRecord(entry.payload, ["challenge", "issuedBy"], "protected containment remote challenge");
      const challenge = parseChallenge(payload.challenge, new Date(0), true);
      if (challenges.has(challenge.id)) throw new Error("Protected containment remote challenge history contains a duplicate identity.");
      const issuedBy = boundedText(payload.issuedBy, "containment remote challenge operator", 160);
      challenges.set(challenge.id, { ...challenge, issuedBy, status: "active" });
    } else if (entry.kind === evidenceImportKind) {
      const payload = exactRecord(entry.payload, ["evidence"], "protected containment remote evidence import");
      const stored = parseStoredEvidence(payload.evidence);
      if (evidence.has(stored.evidenceId) || evidenceByChallenge.has(stored.challengeId)) throw new Error("Protected containment remote evidence history contains a replay.");
      const challenge = challenges.get(stored.challengeId);
      if (!challenge || challenge.status !== "active") throw new Error("Protected containment remote evidence has no unused durable challenge.");
      const item: ImportedContainmentRemoteEvidence = { ...stored, importedAt: exactIso(entry.at, "containment remote evidence import"), status: "available" };
      evidence.set(item.evidenceId, item);
      evidenceByChallenge.set(item.challengeId, item.evidenceId);
      challenges.set(challenge.id, { ...challenge, status: "used", evidenceId: item.evidenceId });
    } else if (entry.kind === evidenceConsumeKind) {
      const payload = exactRecord(entry.payload, ["evidenceId", "consumptionDigest"], "protected containment remote evidence consumption");
      const evidenceId = pattern(payload.evidenceId, evidencePattern, "containment remote evidence id");
      const consumptionDigest = digest(payload.consumptionDigest, "containment remote consumption");
      const current = evidence.get(evidenceId);
      if (!current || current.status !== "available") throw new Error("Protected containment remote evidence consumption is missing or replayed.");
      evidence.set(evidenceId, { ...current, status: "consumed", consumedAt: exactIso(entry.at, "containment remote evidence consumption"), consumptionDigest });
    }
  }
  return { trust, challenges, evidence };
}

function parseStoredEvidence(value: unknown): Omit<ImportedContainmentRemoteEvidence, "importedAt" | "status" | "consumedAt" | "consumptionDigest"> {
  const payload = exactRecord(value, ["evidenceId", "challengeId", "authorityId", "keyId", "evaluatorNonce", "evaluatedAt", "expiresAt", "documentSha256", "importedBy", "toolManifest", "result"], "protected containment remote evidence");
  return {
    evidenceId: pattern(payload.evidenceId, evidencePattern, "containment remote evidence id"),
    challengeId: pattern(payload.challengeId, challengePattern, "containment remote challenge id"),
    authorityId: identifier(payload.authorityId, "containment remote authority"), keyId: digest(payload.keyId, "containment remote key"),
    evaluatorNonce: digest(payload.evaluatorNonce, "containment remote evaluator nonce"),
    evaluatedAt: exactIso(payload.evaluatedAt, "containment remote evaluation"), expiresAt: exactIso(payload.expiresAt, "containment remote evidence expiry"),
    documentSha256: digest(payload.documentSha256, "containment remote document"), importedBy: boundedText(payload.importedBy, "containment remote evidence operator", 160),
    toolManifest: parseToolManifest(payload.toolManifest), result: parseStoredResult(payload.result)
  };
}

function parseStoredResult(value: unknown): StoredRemoteResult {
  const item = exactRecord(value, ["status", "exposure", "summary", "findings"], "protected containment remote result");
  const status = assessmentStatus(item.status);
  const exposure = exposureStatus(item.exposure);
  if (!Array.isArray(item.findings) || item.findings.length > maximumFindings) throw new Error("Protected containment remote findings are invalid.");
  const findings = item.findings.map((finding) => {
    const entry = exactRecord(finding, ["id", "relativePath", "credentialRelated"], "protected containment remote finding");
    if (typeof entry.credentialRelated !== "boolean") throw new Error("Protected containment remote finding is malformed.");
    return { id: pattern(entry.id, findingPattern, "containment finding id"), relativePath: safeRelative(entry.relativePath), credentialRelated: entry.credentialRelated };
  });
  assertResultConsistency(status, exposure, findings.length);
  return { status, exposure, summary: boundedText(item.summary, "containment remote result summary", 1_024), findings };
}

function parseTrust(bytes: Uint8Array, now: Date): ContainmentRemoteTrustPolicy {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error("Containment remote trust policy is not JSON."); }
  return validateTrust(value, now);
}

function validateTrust(value: unknown, now: Date, allowExpired = false): ContainmentRemoteTrustPolicy {
  const item = exactRecord(value, ["schema", "version", "purpose", "authorityId", "keyId", "publicKeyPem", "gitExecutableSha256", "detectorManifestId", "networkPolicy", "expiresAt"], "containment remote trust policy");
  if (item.schema !== "sxsy-b122.containment-remote-trust-policy" || item.version !== 2 || item.purpose !== purpose
    || item.detectorManifestId !== containmentRemoteDetectorManifest.id || item.networkPolicy !== "public-https-dns-pinned-no-redirect-v1") {
    throw new Error("Containment remote trust policy schema, purpose, detector, or network policy is invalid.");
  }
  const publicKeyPem = boundedText(item.publicKeyPem, "containment remote public key", 16_384);
  let publicKey;
  try { publicKey = createPublicKey(publicKeyPem); } catch { throw new Error("Containment remote trust policy public key is invalid."); }
  if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Containment remote trust policy requires ECDSA P-256.");
  const keyId = sha256(publicKey.export({ type: "spki", format: "der" }));
  if (!sameDigest(keyId, digest(item.keyId, "containment remote key"))) throw new Error("Containment remote trust key ID does not match its P-256 SPKI key.");
  const expiresAt = exactIso(item.expiresAt, "containment remote trust expiry");
  if (!allowExpired && Date.parse(expiresAt) <= exactNow(now).getTime()) throw new Error("Containment remote trust policy is expired.");
  return {
    schema: "sxsy-b122.containment-remote-trust-policy", version: 2, purpose,
    authorityId: identifier(item.authorityId, "containment remote authority"), keyId, publicKeyPem,
    gitExecutableSha256: digest(item.gitExecutableSha256, "containment remote Git executable"),
    detectorManifestId: containmentRemoteDetectorManifest.id,
    networkPolicy: "public-https-dns-pinned-no-redirect-v1", expiresAt
  };
}

function parseEvidence(bytes: Uint8Array, now: Date): SignedContainmentRemoteEvidence {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error("Containment remote evidence is not JSON."); }
  const item = exactRecord(value, ["schema", "version", "purpose", "evidenceId", "authorityId", "keyId", "challenge", "evaluatorNonce", "evaluatedAt", "expiresAt", "namespaceComplete", "status", "exposure", "summary", "toolManifest", "remoteResults", "signatureAlgorithm", "signature"], "containment remote evidence");
  if (item.schema !== "sxsy-b122.containment-remote-evidence" || item.version !== 3 || item.purpose !== purpose || item.signatureAlgorithm !== signatureAlgorithm || item.namespaceComplete !== true) {
    throw new Error("Containment remote evidence schema, purpose, complete-namespace assertion, or signature algorithm is invalid.");
  }
  const challenge = parseChallenge(item.challenge, now);
  const authorityId = identifier(item.authorityId, "containment remote authority");
  const keyId = digest(item.keyId, "containment remote key");
  if (authorityId !== challenge.authorityId || keyId !== challenge.keyId) throw new Error("Containment remote evidence uses the wrong challenge authority or key.");
  const evaluatorNonce = digest(item.evaluatorNonce, "containment remote evaluator nonce");
  if (sameDigest(evaluatorNonce, challenge.challengeNonce)) throw new Error("Containment remote evidence requires an independent evaluator nonce.");
  const evidenceId = pattern(item.evidenceId, evidencePattern, "containment remote evidence id");
  if (!sameDigest(evidenceId, containmentRemoteEvidenceId(challenge.id, evaluatorNonce, authorityId, keyId))) throw new Error("Containment remote evidence identity does not match its exact challenge and evaluator nonce.");
  const evaluatedAt = exactIso(item.evaluatedAt, "containment remote evaluation");
  const expiresAt = exactIso(item.expiresAt, "containment remote evidence expiry");
  const observed = exactNow(now).getTime();
  const evaluated = Date.parse(evaluatedAt);
  const expires = Date.parse(expiresAt);
  if (evaluated < Date.parse(challenge.issuedAt) || evaluated > observed + maximumFutureSkewMs || observed - evaluated > maximumEvidenceAgeMs
    || expires <= observed || expires <= evaluated || expires > Date.parse(challenge.expiresAt)) {
    throw new Error("Containment remote evidence is future-dated, expired, or outside its exact freshness window.");
  }
  const remoteResults = parseRemoteResults(item.remoteResults);
  const toolManifest = parseToolManifest(item.toolManifest);
  if (toolManifest.gitExecutableSha256 !== challenge.gitExecutableSha256
    || toolManifest.detectorManifest.id !== challenge.detectorManifestId
    || toolManifest.evaluationProfile !== challenge.evaluationProfile
    || toolManifest.networkPolicy !== challenge.networkPolicy) {
    throw new Error("Containment remote evidence tool manifest changed the host-issued evaluator policy binding.");
  }
  assertNetworkCoverage(challenge, toolManifest);
  assertRemoteCoverage(challenge.configuredRemotes, remoteResults);
  const status = assessmentStatus(item.status);
  const exposure = exposureStatus(item.exposure);
  const derived = deriveAggregate(remoteResults.map((remote) => ({ status: remote.status, exposure: remote.exposure, findings: remote.refResults.reduce((total, ref) => total + ref.findings.length, 0) })));
  if (status !== derived.status || exposure !== derived.exposure) throw new Error("Containment remote evidence aggregate result is inconsistent with its complete remote namespaces.");
  const signature = boundedText(item.signature, "containment remote evidence signature", 512);
  return {
    schema: "sxsy-b122.containment-remote-evidence", version: 3, purpose, evidenceId, authorityId, keyId, challenge,
    evaluatorNonce, evaluatedAt, expiresAt, namespaceComplete: true, status, exposure,
    summary: boundedText(item.summary, "containment remote evidence summary", 2_048), toolManifest, remoteResults, signatureAlgorithm, signature
  };
}

function parseToolManifest(value: unknown): ContainmentRemoteToolManifest {
  const item = exactRecord(value, ["schema", "version", "detectorManifest", "gitExecutableSha256", "gitVersion", "evaluationProfile", "networkPolicy", "networkBindings"], "containment remote tool manifest");
  if (item.schema !== "sxsy-b122.containment-remote-tool-manifest" || item.version !== 1) throw new Error("Containment remote tool manifest schema is invalid.");
  const detector = exactRecord(item.detectorManifest, ["schema", "version", "id", "namespaceScope", "pathHandling", "detectors", "patterns", "patternSha256", "scanProfile"], "containment remote detector manifest");
  if (!Array.isArray(detector.detectors)
    || !Array.isArray(detector.patterns)
    || stableJson(detector) !== stableJson(containmentRemoteDetectorManifest)) throw new Error("Containment remote detector manifest is unsupported or incomplete.");
  const evaluation = evaluationProfile(item.evaluationProfile);
  const policy = networkPolicy(item.networkPolicy);
  if ((evaluation === "production-public-https-v1") !== (policy === "public-https-dns-pinned-no-redirect-v1")) throw new Error("Containment remote tool profile and network policy are inconsistent.");
  if (!Array.isArray(item.networkBindings) || item.networkBindings.length > maximumRemotes) throw new Error("Containment remote network bindings are invalid or unbounded.");
  const networkBindings = item.networkBindings.map((candidate) => {
    const binding = exactRecord(candidate, ["remoteName", "hostname", "port", "addresses"], "containment remote network binding");
    if (binding.port !== 443 || typeof binding.hostname !== "string" || !binding.hostname || binding.hostname.length > 253 || /[\0\r\n\s]/.test(binding.hostname)
      || !Array.isArray(binding.addresses) || binding.addresses.length < 1 || binding.addresses.length > 8) throw new Error("Containment remote network binding is invalid or unbounded.");
    const addresses = binding.addresses.map((address) => {
      if (typeof address !== "string" || isIP(address) !== 4) throw new Error("Containment remote network binding requires an unambiguous IPv4 address.");
      return address;
    });
    if (evaluation === "production-public-https-v1" && addresses.some((address) => !containmentPublicAddress(address))) {
      throw new Error("Containment production remote evidence contains a private, loopback, link-local, or reserved network binding.");
    }
    assertStrictOrder(addresses, "Containment remote network binding addresses are duplicate or unordered.");
    return { remoteName: remoteName(binding.remoteName), hostname: binding.hostname.toLowerCase(), port: 443 as const, addresses };
  });
  assertStrictOrder(networkBindings.map((binding) => binding.remoteName), "Containment remote network bindings are duplicate or unordered.", true);
  return {
    schema: "sxsy-b122.containment-remote-tool-manifest", version: 1,
    detectorManifest: containmentRemoteDetectorManifest,
    gitExecutableSha256: digest(item.gitExecutableSha256, "containment remote Git executable"),
    gitVersion: gitVersion(item.gitVersion), evaluationProfile: evaluation, networkPolicy: policy, networkBindings
  };
}

function assertNetworkCoverage(challenge: ContainmentRemoteEvidenceChallenge, manifest: ContainmentRemoteToolManifest): void {
  if (challenge.evaluationProfile === "test-local-file-v1") {
    if (manifest.networkBindings.length !== 0) throw new Error("Test-local containment evidence cannot assert network bindings.");
    return;
  }
  if (manifest.networkBindings.length !== challenge.configuredRemotes.length
    || challenge.configuredRemotes.some((remote, index) => {
      const binding = manifest.networkBindings[index];
      return remote.name !== binding?.remoteName || containmentProductionRemoteEndpoint(remote.canonicalIdentity).hostname !== binding.hostname;
    })) {
    throw new Error("Containment remote tool manifest lacks exact configured-remote network coverage.");
  }
}

function parseChallenge(value: unknown, now: Date, allowExpired = false): ContainmentRemoteEvidenceChallenge {
  const item = exactRecord(value, ["schema", "version", "purpose", "id", "authorityId", "keyId", "incidentId", "repositoryRootDigest", "fenceEpoch", "generation", "remoteOperationId", "remoteExternalId", "targetSnapshotId", "policyVersion", "configuredRemotes", "gitExecutableSha256", "detectorManifestId", "evaluationProfile", "networkPolicy", "challengeNonce", "issuedAt", "expiresAt"], "containment remote challenge");
  if (item.schema !== "sxsy-b122.containment-remote-challenge" || item.version !== 3 || item.purpose !== purpose) throw new Error("Containment remote challenge schema or purpose is invalid.");
  const issuedAt = exactIso(item.issuedAt, "containment remote challenge issue");
  const expiresAt = exactIso(item.expiresAt, "containment remote challenge expiry");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt) || Date.parse(expiresAt) - Date.parse(issuedAt) > maximumChallengeLifetimeMs || (!allowExpired && Date.parse(expiresAt) <= exactNow(now).getTime())) {
    throw new Error("Containment remote challenge is expired or exceeds its maximum lifetime.");
  }
  const configuredRemotes = parseConfiguredRemotes(item.configuredRemotes);
  if (configuredRemotes.length === 0) throw new Error("A signed containment remote challenge cannot represent zero configured remotes.");
  const challenge: ContainmentRemoteEvidenceChallenge = {
    schema: "sxsy-b122.containment-remote-challenge", version: 3, purpose,
    id: pattern(item.id, challengePattern, "containment remote challenge id"),
    authorityId: identifier(item.authorityId, "containment remote authority"), keyId: digest(item.keyId, "containment remote key"),
    incidentId: pattern(item.incidentId, incidentPattern, "containment incident id"), repositoryRootDigest: digest(item.repositoryRootDigest, "containment repository root"),
    fenceEpoch: positiveInteger(item.fenceEpoch, "containment fence epoch"), generation: positiveInteger(item.generation, "containment assessment generation"),
    remoteOperationId: pattern(item.remoteOperationId, childPattern, "containment remote operation id"), remoteExternalId: pattern(item.remoteExternalId, childPattern, "containment remote external id"),
    targetSnapshotId: identifier(item.targetSnapshotId, "containment target snapshot"), policyVersion: identifier(item.policyVersion, "containment remote policy"),
    configuredRemotes,
    gitExecutableSha256: digest(item.gitExecutableSha256, "containment remote Git executable"),
    detectorManifestId: detectorManifestId(item.detectorManifestId),
    evaluationProfile: evaluationProfile(item.evaluationProfile),
    networkPolicy: networkPolicy(item.networkPolicy),
    challengeNonce: digest(item.challengeNonce, "containment remote challenge nonce"), issuedAt, expiresAt
  };
  if ((challenge.evaluationProfile === "production-public-https-v1") !== (challenge.networkPolicy === "public-https-dns-pinned-no-redirect-v1")) {
    throw new Error("Containment remote challenge evaluation profile and network policy are inconsistent.");
  }
  if (!sameDigest(challenge.id, deriveChallengeId(challengeIdentityDocument(challenge)))) throw new Error("Containment remote challenge identity does not bind its exact contents.");
  return challenge;
}

function parseRemoteResults(value: unknown): readonly ContainmentRemoteNamespaceResult[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumRemotes) throw new Error("Containment remote evidence configured-remote coverage is invalid or unbounded.");
  const results = value.map(parseRemoteResult);
  assertStrictOrder(results.map((item) => item.name), "Containment remote results contain duplicate or non-canonical remote names.", true);
  if (new Set(results.map((item) => item.canonicalIdentity.toLowerCase())).size !== results.length) throw new Error("Containment remote results contain duplicate canonical identities.");
  return results;
}

function parseRemoteResult(value: unknown): ContainmentRemoteNamespaceResult {
  const item = exactRecord(value, ["name", "canonicalIdentity", "namespaceComplete", "refCount", "namespaceSha256", "namespaceRefs", "status", "exposure", "summary", "refResults"], "containment remote namespace result");
  if (item.namespaceComplete !== true) throw new Error("Containment remote namespace must assert namespaceComplete true.");
  const namespaceRefs = parseNamespaceRefs(item.namespaceRefs, "containment remote namespace");
  const refCount = nonNegativeInteger(item.refCount, "containment remote namespace ref count");
  if (refCount !== namespaceRefs.length) throw new Error("Containment remote namespace ref count is inconsistent.");
  const namespaceSha256 = digest(item.namespaceSha256, "containment remote namespace digest");
  if (!sameDigest(namespaceSha256, containmentRemoteNamespaceDigest(namespaceRefs))) throw new Error("Containment remote namespace digest is inconsistent.");
  const refResults = parseRefResults(item.refResults);
  assertRefCoverage(namespaceRefs, refResults);
  const status = assessmentStatus(item.status);
  const exposure = exposureStatus(item.exposure);
  const derived = deriveAggregate(refResults.map((ref) => ({ status: ref.status, exposure: ref.exposure, findings: ref.findings.length })));
  if (status !== derived.status || exposure !== derived.exposure) throw new Error("Containment remote namespace aggregate result is inconsistent with its refs.");
  return {
    name: remoteName(item.name), canonicalIdentity: strictCanonicalRemote(item.canonicalIdentity), namespaceComplete: true,
    refCount, namespaceSha256, namespaceRefs, status, exposure,
    summary: boundedText(item.summary, "containment remote namespace summary", 1_024), refResults
  };
}

function parseNamespaceRefs(value: unknown, label: string): readonly ContainmentRemoteNamespaceRef[] {
  if (!Array.isArray(value) || value.length > maximumRefsPerRemote) throw new Error(`${label} refs are invalid or unbounded.`);
  const refs = value.map((candidate) => {
    const item = exactRecord(candidate, ["ref", "head"], `${label} ref`);
    return { ref: exactRef(item.ref), head: commit(item.head) };
  });
  assertStrictOrder(refs.map((item) => item.ref), `${label} refs contain duplicates or are not in canonical order.`);
  return refs;
}

function parseRefResults(value: unknown): readonly ContainmentRemoteEvidenceRefResult[] {
  if (!Array.isArray(value) || value.length > maximumRefsPerRemote) throw new Error("Containment remote ref results are invalid or unbounded.");
  const refs = value.map((candidate) => {
    const item = exactRecord(candidate, ["ref", "head", "status", "exposure", "summary", "findings"], "containment remote ref result");
    const status = assessmentStatus(item.status);
    const exposure = exposureStatus(item.exposure);
    if (!Array.isArray(item.findings) || item.findings.length > maximumFindingsPerRef) throw new Error("Containment remote ref findings exceed their bound.");
    const findings = item.findings.map((candidateFinding) => {
      const finding = exactRecord(candidateFinding, ["relativePath", "pathSha256", "credentialRelated"], "containment remote ref finding");
      if (typeof finding.credentialRelated !== "boolean") throw new Error("Containment remote ref finding is malformed.");
      const pathSha256 = digest(finding.pathSha256, "containment remote finding path");
      const relativePath = safeRelative(finding.relativePath);
      if (relativePath !== `redacted/${pathSha256}`) throw new Error("Containment remote finding path is not the exact redacted path digest.");
      return { relativePath, pathSha256, credentialRelated: finding.credentialRelated };
    });
    if (new Set(findings.map((finding) => finding.relativePath.toLowerCase())).size !== findings.length) throw new Error("Containment remote ref findings contain duplicate paths.");
    assertResultConsistency(status, exposure, findings.length);
    return { ref: exactRef(item.ref), head: commit(item.head), status, exposure, summary: boundedText(item.summary, "containment remote ref summary", 1_024), findings };
  });
  assertStrictOrder(refs.map((item) => item.ref), "Containment remote ref results contain duplicate refs or are not in canonical order.");
  return refs;
}

function validateBinding(input: ContainmentRemoteEvidenceBinding): ContainmentRemoteEvidenceBinding {
  const request = validateRemoteRequest(input.request);
  return {
    request, generation: positiveInteger(input.generation, "containment assessment generation"),
    targetSnapshotId: identifier(input.targetSnapshotId, "containment target snapshot"),
    policyVersion: identifier(input.policyVersion, "containment remote policy"),
    authorityId: identifier(input.authorityId, "containment remote authority"), keyId: digest(input.keyId, "containment remote key"),
    configuredRemotes: parseConfiguredRemotes(input.configuredRemotes)
  };
}

function validateRemoteRequest(value: ContainmentAssessmentRequest): ContainmentAssessmentRequest {
  const item = exactRecord(value, ["schema", "version", "incidentId", "repositoryRoot", "fenceEpoch", "step", "operationId", "externalId", "egressAllowed", "revealSecretValues"], "containment remote assessment request");
  if (item.schema !== "sxsy-b122.containment-assessment-request" || item.version !== 1 || item.step !== "remote" || item.egressAllowed !== false || item.revealSecretValues !== false) {
    throw new Error("Containment remote evidence requires the exact no-egress remote assessment child.");
  }
  return {
    schema: "sxsy-b122.containment-assessment-request", version: 1,
    incidentId: pattern(item.incidentId, incidentPattern, "containment incident id"), repositoryRoot: absolutePath(item.repositoryRoot, "containment repository root"),
    fenceEpoch: positiveInteger(item.fenceEpoch, "containment fence epoch"), step: "remote",
    operationId: pattern(item.operationId, childPattern, "containment remote operation id"), externalId: pattern(item.externalId, childPattern, "containment remote external id"),
    egressAllowed: false, revealSecretValues: false
  };
}

function parseConfiguredRemotes(value: unknown): readonly ContainmentConfiguredRemote[] {
  if (!Array.isArray(value) || value.length > maximumRemotes) throw new Error("Containment configured remotes are invalid or unbounded.");
  const remotes = value.map((candidate) => {
    const item = exactRecord(candidate, ["name", "canonicalIdentity"], "containment configured remote");
    return { name: remoteName(item.name), canonicalIdentity: canonicalRemote(item.canonicalIdentity) };
  }).sort((left, right) => compareText(left.name, right.name));
  if (new Set(remotes.map((item) => item.name.toLowerCase())).size !== remotes.length) throw new Error("Containment configured remotes contain duplicate names.");
  if (new Set(remotes.map((item) => item.canonicalIdentity.toLowerCase())).size !== remotes.length) throw new Error("Containment configured remotes contain duplicate canonical identities.");
  return remotes;
}

function selectEvidence(state: RegistryState, binding: ContainmentRemoteEvidenceBinding): Readonly<{ challenge: InstalledContainmentRemoteChallenge; evidence: ImportedContainmentRemoteEvidence }> | undefined {
  const wanted = bindingDigest(binding);
  const imported = [...state.challenges.values()].filter((item) => challengeBindingDigest(item) === wanted && item.evidenceId);
  if (imported.length > 1) throw new Error("Protected containment remote challenge selection is ambiguous.");
  const challenge = imported[0];
  if (!challenge?.evidenceId) return undefined;
  const evidence = state.evidence.get(challenge.evidenceId);
  if (!evidence) throw new Error("Protected containment remote challenge lost its imported evidence.");
  if (evidence.status === "consumed" && evidence.consumptionDigest !== wanted) throw new Error("Protected containment remote evidence consumption changed its exact child binding.");
  return { challenge, evidence };
}

function usableEvidence(state: RegistryState, challenge: InstalledContainmentRemoteChallenge, evidence: ImportedContainmentRemoteEvidence, nowInput: Date): boolean {
  const now = exactNow(nowInput).getTime();
  const trust = state.trust.get(trustKey(evidence.authorityId, evidence.keyId));
  return !!trust && trust.status === "active" && trust.purpose === purpose
    && Date.parse(trust.expiresAt) > now && Date.parse(challenge.expiresAt) > now && Date.parse(evidence.expiresAt) > now
    && evidence.challengeId === challenge.id && evidence.authorityId === challenge.authorityId && evidence.keyId === challenge.keyId;
}

function resultFor(request: ContainmentAssessmentRequest, result: StoredRemoteResult): ContainmentAssessmentResult {
  return {
    schema: "sxsy-b122.containment-assessment-result", version: 1,
    incidentId: request.incidentId, repositoryRoot: request.repositoryRoot, fenceEpoch: request.fenceEpoch, step: "remote",
    operationId: request.operationId, externalId: request.externalId, effectDisposition: "committed",
    status: result.status, exposure: result.exposure, summary: result.summary, findings: clone(result.findings)
  };
}

function storedResult(evidence: SignedContainmentRemoteEvidence): StoredRemoteResult {
  const byPath = new Map<string, { relativePath: string; credentialRelated: boolean }>();
  for (const remote of evidence.remoteResults) for (const ref of remote.refResults) for (const finding of ref.findings) {
    const key = finding.pathSha256;
    const current = byPath.get(key);
    byPath.set(key, { relativePath: current?.relativePath ?? finding.relativePath, credentialRelated: (current?.credentialRelated ?? false) || finding.credentialRelated });
  }
  if (byPath.size > maximumFindings) throw new Error("Containment remote evidence has too many generation-scoped findings.");
  const findings = [...byPath.values()].sort((left, right) => compareText(left.relativePath, right.relativePath)).map((finding) => ({
    id: `containment-finding:${sha256(stableJson({
      configuredRemotes: evidence.challenge.configuredRemotes, generation: evidence.challenge.generation,
      incidentId: evidence.challenge.incidentId, remoteOperationId: evidence.challenge.remoteOperationId,
      targetSnapshotId: evidence.challenge.targetSnapshotId, pathSha256: finding.relativePath.slice("redacted/".length)
    }))}`,
    relativePath: finding.relativePath, credentialRelated: finding.credentialRelated
  }));
  assertResultConsistency(evidence.status, evidence.exposure, findings.length);
  const summary = untrustedSummary(evidence.summary, 1_024).trim() || "Remote assessment completed with evaluator detail redacted.";
  return { status: evidence.status, exposure: evidence.exposure, summary, findings };
}

function verifySignedEvidence(evidence: SignedContainmentRemoteEvidence, trust: InstalledContainmentRemoteTrust): void {
  const signature = Buffer.from(evidence.signature, "base64");
  if (signature.length < 64 || signature.length > 144 || signature.toString("base64") !== evidence.signature) throw new Error("Containment remote evidence signature is malformed.");
  const { signature: _signature, ...unsigned } = evidence;
  if (!verify("sha256", containmentRemoteEvidenceSigningPayload(unsigned), trust.publicKeyPem, signature)) throw new Error("Containment remote evidence signature is invalid.");
}

function requireUsableTrust(trust: InstalledContainmentRemoteTrust | undefined, nowInput: Date, evidenceExpiry?: string): asserts trust is InstalledContainmentRemoteTrust {
  const now = exactNow(nowInput);
  if (!trust || trust.status !== "active" || trust.purpose !== purpose || Date.parse(trust.expiresAt) <= now.getTime()
    || (evidenceExpiry !== undefined && Date.parse(evidenceExpiry) > Date.parse(trust.expiresAt))) {
    throw new Error("Containment remote evidence authority is absent, revoked, expired, wrong-purpose, or shorter-lived than the requested evidence.");
  }
}

function deriveAggregate(items: readonly Readonly<{ status: ContainmentAssessmentStatus; exposure: ContainmentExposure; findings: number }>[]): Readonly<{ status: ContainmentAssessmentStatus; exposure: ContainmentExposure }> {
  if (items.length === 0) return { status: "passed", exposure: "none" };
  const unknown = items.filter((item) => item.exposure === "unknown");
  const findings = items.reduce((total, item) => total + item.findings, 0);
  if (unknown.length) {
    if (findings > 0 || items.some((item) => item.status === "failed" || item.exposure === "found")) throw new Error("Containment remote evidence cannot hide known findings behind partial or unknown namespace truth.");
    return { status: unknown.some((item) => item.status === "incomplete") ? "incomplete" : "unavailable", exposure: "unknown" };
  }
  if (findings > 0) return { status: "failed", exposure: "found" };
  return { status: "passed", exposure: "none" };
}

function assertResultConsistency(status: ContainmentAssessmentStatus, exposure: ContainmentExposure, findings: number): void {
  if ((status === "passed") !== (exposure === "none") || (status === "failed") !== (exposure === "found")
    || ((status === "unavailable" || status === "incomplete") && exposure !== "unknown") || (exposure === "found") !== (findings > 0)) {
    throw new Error("Containment remote assessment status, exposure, and findings are inconsistent.");
  }
}

function assertRemoteCoverage(required: readonly ContainmentConfiguredRemote[], actual: readonly ContainmentRemoteNamespaceResult[]): void {
  if (required.length !== actual.length || required.some((remote, index) => remote.name !== actual[index]?.name || remote.canonicalIdentity !== actual[index]?.canonicalIdentity)) {
    throw new Error("Containment remote evidence does not provide exact complete configured-remote identity coverage.");
  }
}

function assertRefCoverage(required: readonly ContainmentRemoteNamespaceRef[], actual: readonly ContainmentRemoteEvidenceRefResult[]): void {
  if (required.length !== actual.length || required.some((item, index) => item.ref !== actual[index]?.ref || item.head !== actual[index]?.head)) {
    throw new Error("Containment remote evidence does not assess the exact complete namespace refs and heads.");
  }
}

function bindingDigest(binding: ContainmentRemoteEvidenceBinding): string {
  return sha256(stableJson({
    authorityId: binding.authorityId, configuredRemotes: binding.configuredRemotes,
    fenceEpoch: binding.request.fenceEpoch, generation: binding.generation,
    incidentId: binding.request.incidentId, keyId: binding.keyId, policyVersion: binding.policyVersion, purpose,
    remoteExternalId: binding.request.externalId, remoteOperationId: binding.request.operationId,
    repositoryRootDigest: repositoryDigest(binding.request.repositoryRoot), targetSnapshotId: binding.targetSnapshotId
  }));
}

function challengeBindingDigest(challenge: ContainmentRemoteEvidenceChallenge): string {
  return sha256(stableJson({
    authorityId: challenge.authorityId, configuredRemotes: challenge.configuredRemotes,
    fenceEpoch: challenge.fenceEpoch, generation: challenge.generation,
    incidentId: challenge.incidentId, keyId: challenge.keyId, policyVersion: challenge.policyVersion, purpose,
    remoteExternalId: challenge.remoteExternalId, remoteOperationId: challenge.remoteOperationId,
    repositoryRootDigest: challenge.repositoryRootDigest, targetSnapshotId: challenge.targetSnapshotId
  }));
}

function challengeDocument(value: ContainmentRemoteEvidenceChallenge): ContainmentRemoteEvidenceChallenge {
  const { issuedBy: _issuedBy, status: _status, evidenceId: _evidenceId, ...challenge } = value as InstalledContainmentRemoteChallenge;
  return challenge;
}

function challengeIdentityDocument(value: ContainmentRemoteEvidenceChallenge): Omit<ContainmentRemoteEvidenceChallenge, "id"> {
  const { id: _id, ...challenge } = challengeDocument(value);
  return challenge;
}

function deriveChallengeId(value: Omit<ContainmentRemoteEvidenceChallenge, "id">): string {
  return `containment-remote-challenge:${sha256(stableJson(value))}`;
}

function exactRef(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || !/^refs\/[A-Za-z0-9._/-]+$/.test(value)
    || value.includes("..") || value.includes("@{") || value.endsWith(".") || value.endsWith(".lock")
    || value.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith(".") || part.endsWith(".lock"))
    || /[\0\r\n\\~^:?*[ ]/.test(value)) {
    throw new Error("Containment remote ref is invalid.");
  }
  return value;
}

function canonicalRemote(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2_048 || /[\0\r\n\s]/.test(value)) throw new Error("Containment canonical remote identity is invalid.");
  if (/^(?:https?|ssh|file):\/\//i.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Containment canonical remote identity is invalid."); }
    if (!(url.protocol === "https:" || url.protocol === "ssh:" || url.protocol === "file:") || url.password || url.search || url.hash || !safeRemotePath(url.pathname)) {
      throw new Error("Containment canonical remote identity is invalid or credential-bearing.");
    }
    if (url.protocol === "https:" && url.username) throw new Error("Containment canonical remote identity cannot contain HTTPS credentials.");
    if (url.protocol === "file:") {
      if (url.username || url.hostname && url.hostname !== "localhost") throw new Error("Containment file remote identity is invalid.");
      return `file://${url.pathname.replace(/\/+$/, "")}`;
    }
    if (!url.hostname) throw new Error("Containment canonical remote identity is invalid.");
    const user = url.username ? `${url.username}@` : "";
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//${user}${url.hostname.toLowerCase()}${port}${url.pathname.replace(/\/+$/, "")}`;
  }
  const scp = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(.+)$/.exec(value);
  if (!scp || !safeRemotePath(`/${scp[3]}`)) throw new Error("Containment canonical remote identity must be fixed HTTPS, SSH, file, or SCP-style Git identity.");
  return `${scp[1]}@${scp[2]!.toLowerCase()}:${scp[3]!.replace(/\/+$/, "")}`;
}

function strictCanonicalRemote(value: unknown): string {
  const canonical = canonicalRemote(value);
  if (canonical !== value) throw new Error("Containment remote evidence changed the canonical remote representation.");
  return canonical;
}

function safeRemotePath(value: string): boolean {
  return value.startsWith("/") && value.length > 1 && !/[\0\r\n]/.test(value) && !value.split("/").some((part, index) => index > 0 && (!part || part === "." || part === ".."));
}

function requireProductionRemoteIdentity(value: string): void { containmentProductionRemoteEndpoint(value); }

function detectorManifestId(value: unknown): typeof containmentRemoteDetectorManifest.id {
  if (value !== containmentRemoteDetectorManifest.id) throw new Error("Containment remote detector manifest identity is unsupported.");
  return containmentRemoteDetectorManifest.id;
}

function evaluationProfile(value: unknown): ContainmentRemoteEvaluationProfile {
  if (value !== "production-public-https-v1" && value !== "test-local-file-v1") throw new Error("Containment remote evaluation profile is invalid.");
  return value;
}

function networkPolicy(value: unknown): ContainmentRemoteNetworkPolicy {
  if (value !== "public-https-dns-pinned-no-redirect-v1" && value !== "test-local-file-no-network-v1") throw new Error("Containment remote network policy is invalid.");
  return value;
}

function productionNetworkPolicy(value: unknown): "public-https-dns-pinned-no-redirect-v1" {
  if (value !== "public-https-dns-pinned-no-redirect-v1") throw new Error("Containment remote trust has no supported production network policy.");
  return value;
}

function gitVersion(value: unknown): string {
  if (typeof value !== "string" || !/^git version [0-9]+\.[0-9]+\.[0-9]+(?:\.[A-Za-z0-9.-]+)?$/.test(value) || value.length > 96) {
    throw new Error("Containment remote Git tool version is invalid.");
  }
  return value;
}

async function readBoundedRegularFile(pathInput: string, maximum: number, label: string): Promise<Readonly<{ path: string; bytes: Uint8Array }>> {
  if (typeof pathInput !== "string" || !isAbsolute(pathInput) || pathInput.length > 4_096 || /[\0\r\n]/.test(pathInput)) throw new Error(`${label} path must be fixed and absolute.`);
  const selected = resolve(pathInput);
  const before = await lstat(selected);
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maximum) throw new Error(`${label} is absent, linked, empty, or oversized.`);
  const canonical = await realpath(selected);
  const canonicalBefore = await lstat(canonical);
  if (!canonicalBefore.isFile() || canonicalBefore.isSymbolicLink() || canonicalBefore.size !== before.size || canonicalBefore.dev !== before.dev || canonicalBefore.ino !== before.ino) throw new Error(`${label} changed during regular-file validation.`);
  const flags = process.platform === "win32" ? fsConstants.O_RDONLY : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
  const handle = await open(canonical, flags);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== before.size || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error(`${label} changed before its stable handle was opened.`);
    const bytes = await handle.readFile();
    const afterHandle = await handle.stat();
    const afterPath = await lstat(canonical);
    if (bytes.byteLength !== before.size || afterHandle.size !== opened.size || afterHandle.mtimeMs !== opened.mtimeMs
      || afterHandle.dev !== opened.dev || afterHandle.ino !== opened.ino || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino) {
      throw new Error(`${label} changed while it was read through a stable handle.`);
    }
    return { path: canonical, bytes };
  } finally { await handle.close(); }
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} is not a plain closed record.`);
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== keys.length || !keys.every((key) => Object.hasOwn(item, key))) throw new Error(`${label} has an open or incomplete schema.`);
  return item;
}

function assertStrictOrder(values: readonly string[], message: string, caseInsensitive = false): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = caseInsensitive ? values[index - 1]!.toLowerCase() : values[index - 1]!;
    const current = caseInsensitive ? values[index]!.toLowerCase() : values[index]!;
    if (compareText(previous, current) >= 0) throw new Error(message);
  }
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function assessmentStatus(value: unknown): ContainmentAssessmentStatus { if (value !== "passed" && value !== "failed" && value !== "unavailable" && value !== "incomplete") throw new Error("Containment remote assessment status is invalid."); return value; }
function exposureStatus(value: unknown): ContainmentExposure { if (value !== "none" && value !== "found" && value !== "unknown") throw new Error("Containment remote exposure is invalid."); return value; }
function absolutePath(value: unknown, label: string): string { if (typeof value !== "string" || !isAbsolute(value) || value.length > 4_096 || /[\0\r\n]/.test(value)) throw new Error(`${label} must be exact and absolute.`); return resolve(value); }
function repositoryDigest(value: string): string { const canonical = resolve(value).replaceAll("\\", "/").replace(/\/+$/, ""); return sha256(process.platform === "win32" ? canonical.toLowerCase() : canonical); }
function safeRelative(value: unknown): string { if (typeof value !== "string") throw new Error("Containment remote finding path is invalid."); const normalized = value.replaceAll("\\", "/"); if (!normalized || normalized.length > 2_048 || isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || /[\0\r\n]/.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) throw new Error("Containment remote finding path is outside the repository boundary."); return normalized; }
function exactNow(value: Date): Date { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Containment remote clock is invalid."); return new Date(value); }
function exactIso(value: unknown, label: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} timestamp is invalid.`); return value; }
function future(value: unknown, now: Date, maximum: number, label: string): string { const timestamp = exactIso(value, label); const delta = Date.parse(timestamp) - now.getTime(); if (delta <= 0 || delta > maximum) throw new Error(`${label} is expired or exceeds its maximum lifetime.`); return timestamp; }
function nonNegativeInteger(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid.`); return value as number; }
function positiveInteger(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} is invalid.`); return value as number; }
function commit(value: unknown): string { if (typeof value !== "string" || !commitPattern.test(value)) throw new Error("Containment remote head is invalid."); return value; }
function remoteName(value: unknown): string { if (typeof value !== "string" || !remoteNamePattern.test(value)) throw new Error("Containment remote name is invalid."); return value; }
function identifier(value: unknown, label: string): string { if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function pattern(value: unknown, expected: RegExp, label: string): string { if (typeof value !== "string" || !expected.test(value)) throw new Error(`${label} is invalid.`); return value; }
function boundedText(value: unknown, label: string, maximum: number): string { if (typeof value !== "string" || !value.trim() || value.length > maximum || /\0/.test(value)) throw new Error(`${label} is invalid.`); return value.trim(); }
function trustKey(authorityId: string, keyId: string): string { return `${authorityId}:${keyId}`; }
function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function sameDigest(left: string, right: string): boolean { const leftHash = sha256(left); const rightHash = sha256(right); if (leftHash.length !== rightHash.length) return false; let result = 0; for (let index = 0; index < leftHash.length; index += 1) result |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index); return result === 0; }
function clone<T>(value: T): T { return JSON.parse(stableJson(value)) as T; }
