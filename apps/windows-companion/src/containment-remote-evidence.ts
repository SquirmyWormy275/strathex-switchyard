/** Host-owned, offline signed evidence for the containment remote-assessment child. */
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type {
  ContainmentAssessmentRequest,
  ContainmentAssessmentResult,
  ContainmentAssessmentStatus,
  ContainmentExposure,
  ContainmentFinding
} from "../../../packages/control-plane/src/containment-incidents.ts";
import { untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import { stableJson, type JournalEntry, type JsonStoreTransaction, type JsonValue, type ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";

const trustInstallKind = "b122.containment-remote.trust.install.v1";
const trustRevokeKind = "b122.containment-remote.trust.revoke.v1";
const challengeIssueKind = "b122.containment-remote.challenge.issue.v1";
const evidenceImportKind = "b122.containment-remote.evidence.import.v1";
const evidenceConsumeKind = "b122.containment-remote.evidence.consume.v1";
const purpose = "containment-remote-assessment" as const;
const signatureAlgorithm = "ecdsa-p256-sha256" as const;
const maximumTrustBytes = 64 * 1024;
const maximumEvidenceBytes = 256 * 1024;
const maximumChallengeLifetimeMs = 15 * 60_000;
const maximumEvidenceAgeMs = 15 * 60_000;
const maximumFutureSkewMs = 60_000;
const maximumRefs = 32;
const maximumFindings = 256;
const digestPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const incidentPattern = /^containment-incident:[a-f0-9]{64}$/;
const childPattern = /^containment-assessment:[a-f0-9]{64}$/;
const challengePattern = /^containment-remote-challenge:[a-f0-9]{64}$/;
const evidencePattern = /^containment-remote-evidence:[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export type ContainmentRemoteEvidencePurpose = typeof purpose;

export interface ContainmentRemoteTrustPolicy {
  readonly schema: "sxsy-b122.containment-remote-trust-policy";
  readonly version: 1;
  readonly purpose: ContainmentRemoteEvidencePurpose;
  readonly authorityId: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly expiresAt: string;
}

export interface InstalledContainmentRemoteTrust extends ContainmentRemoteTrustPolicy {
  readonly installedAt: string;
  readonly installedBy: string;
  readonly status: "active" | "revoked";
  readonly revokedAt?: string;
}

export interface ContainmentRemoteRefBinding {
  readonly ref: string;
  readonly expectedHead: string;
}

/**
 * The host supplies the current incident generation and TargetSnapshot data;
 * neither an offline evaluator nor a command payload gets to choose them.
 */
export interface ContainmentRemoteEvidenceBinding {
  readonly request: ContainmentAssessmentRequest;
  readonly generation: number;
  readonly targetSnapshotId: string;
  readonly canonicalRemote: string;
  readonly policyVersion: string;
  readonly authorityId: string;
  readonly keyId: string;
  readonly requiredRefs: readonly ContainmentRemoteRefBinding[];
}

export interface ContainmentRemoteChallengeIssue extends ContainmentRemoteEvidenceBinding {
  readonly expiresAt: string;
}

export interface ContainmentRemoteEvidenceChallenge {
  readonly schema: "sxsy-b122.containment-remote-challenge";
  readonly version: 1;
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
  readonly canonicalRemote: string;
  readonly policyVersion: string;
  readonly requiredRefs: readonly ContainmentRemoteRefBinding[];
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
  readonly credentialRelated: boolean;
}

export interface ContainmentRemoteEvidenceRefResult extends ContainmentRemoteRefBinding {
  readonly status: ContainmentAssessmentStatus;
  readonly exposure: ContainmentExposure;
  readonly summary: string;
  readonly findings: readonly ContainmentRemoteEvidenceFinding[];
}

export interface SignedContainmentRemoteEvidence {
  readonly schema: "sxsy-b122.containment-remote-evidence";
  readonly version: 1;
  readonly purpose: ContainmentRemoteEvidencePurpose;
  readonly evidenceId: string;
  readonly authorityId: string;
  readonly keyId: string;
  readonly challenge: ContainmentRemoteEvidenceChallenge;
  readonly evaluatorNonce: string;
  readonly evaluatedAt: string;
  readonly expiresAt: string;
  readonly status: ContainmentAssessmentStatus;
  readonly exposure: ContainmentExposure;
  readonly summary: string;
  readonly refResults: readonly ContainmentRemoteEvidenceRefResult[];
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
  readonly result: StoredRemoteResult;
  readonly status: "available" | "consumed";
  readonly consumedAt?: string;
  readonly consumptionDigest?: string;
}

export interface ContainmentRemoteEvidencePort {
  /** Read-only recovery/observation. A consumed result remains observable. */
  resolve(binding: ContainmentRemoteEvidenceBinding): Promise<ContainmentAssessmentResult | undefined>;
  /** One durable transition from imported evidence to the exact remote child. */
  consume(binding: ContainmentRemoteEvidenceBinding): Promise<ContainmentAssessmentResult | undefined>;
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

/**
 * Protected, append-only registry for an offline evaluator. This class owns no
 * network or credential port; the only ingress is a selected bounded regular
 * file and the only egress is a closed ContainmentAssessmentResult.
 */
export class DurableContainmentRemoteEvidenceRegistry implements ContainmentRemoteEvidencePort {
  private readonly now: () => Date;
  private readonly nonceFactory: () => string;

  constructor(private readonly store: ProtectedJsonStore, options: ContainmentRemoteEvidenceRegistryOptions = {}) {
    if (!store.hasAuthenticatedProtection) throw new Error("Containment remote evidence requires authenticated host-owned durable storage.");
    this.now = options.now ?? (() => new Date());
    this.nonceFactory = options.nonceFactory ?? (() => randomBytes(32).toString("hex"));
  }

  async installTrust(policyInput: ContainmentRemoteTrustPolicy, installedBy: string): Promise<InstalledContainmentRemoteTrust> {
    const policy = validateTrust(policyInput, this.now());
    const operator = boundedText(installedBy, "containment remote trust operator", 160);
    return this.store.transaction(async (transaction) => {
      const state = readState(await transaction.readEntries());
      if ([...state.trust.values()].some((item) => item.authorityId === policy.authorityId && item.status === "active")) {
        throw new Error("An active containment remote authority already exists; revoke it before key rotation.");
      }
      if (state.trust.has(trustKey(policy.authorityId, policy.keyId))) throw new Error("Containment remote trust history cannot reinstall the same key identity.");
      const entry = await transaction.append(trustInstallKind, { policy: policy as unknown as JsonValue, installedBy: operator });
      return { ...policy, installedAt: entry.at, installedBy: operator, status: "active" };
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
    const expiresAt = future(input.expiresAt, issuedAt, maximumChallengeLifetimeMs, "containment remote challenge expiry");
    const challengeNonce = digest(this.nonceFactory(), "containment remote challenge nonce");
    const withoutId = {
      schema: "sxsy-b122.containment-remote-challenge" as const, version: 1 as const, purpose,
      authorityId: binding.authorityId, keyId: binding.keyId,
      incidentId: binding.request.incidentId, repositoryRootDigest: repositoryDigest(binding.request.repositoryRoot),
      fenceEpoch: binding.request.fenceEpoch, generation: binding.generation,
      remoteOperationId: binding.request.operationId, remoteExternalId: binding.request.externalId,
      targetSnapshotId: binding.targetSnapshotId, canonicalRemote: binding.canonicalRemote,
      policyVersion: binding.policyVersion, requiredRefs: binding.requiredRefs,
      challengeNonce, issuedAt: issuedAt.toISOString(), expiresAt
    };
    const challenge: ContainmentRemoteEvidenceChallenge = { ...withoutId, id: deriveChallengeId(withoutId) };
    const issuedBy = boundedText(issuedByInput, "containment remote challenge operator", 160);
    return this.store.transaction(async (transaction) => {
      const state = readState(await transaction.readEntries());
      const anchor = state.trust.get(trustKey(challenge.authorityId, challenge.keyId));
      requireUsableTrust(anchor, issuedAt, challenge.expiresAt);
      const exactBindingDigest = challengeBindingDigest(challenge);
      if ([...state.challenges.values()].some((item) => challengeBindingDigest(item) === exactBindingDigest)) {
        throw new Error("A containment remote challenge already exists for this exact generation and child binding.");
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
      verifySignedEvidence(signed, anchor!);
      assertRefCoverage(challenge.requiredRefs, signed.refResults);
      const result = storedResult(signed);
      const stored: Omit<ImportedContainmentRemoteEvidence, "importedAt" | "status"> = {
        evidenceId: signed.evidenceId, challengeId: challenge.id, authorityId: signed.authorityId, keyId: signed.keyId,
        evaluatorNonce: signed.evaluatorNonce, evaluatedAt: signed.evaluatedAt, expiresAt: signed.expiresAt,
        documentSha256: sha256(selected.bytes), importedBy, result
      };
      if (state.evidence.has(stored.evidenceId)) throw new Error("Containment remote evidence identity was already imported; replay is rejected.");
      const entry = await transaction.append(evidenceImportKind, { evidence: stored as unknown as JsonValue });
      return { ...stored, importedAt: entry.at, status: "available" };
    });
  }

  async listEvidence(): Promise<readonly ImportedContainmentRemoteEvidence[]> {
    return [...readState(await this.store.readEntries()).evidence.values()].map(clone);
  }

  async resolve(bindingInput: ContainmentRemoteEvidenceBinding): Promise<ContainmentAssessmentResult | undefined> {
    const binding = validateBinding(bindingInput);
    const state = readState(await this.store.readEntries());
    const selected = selectEvidence(state, binding);
    if (!selected) return undefined;
    if (selected.evidence.status === "available" && !usableEvidence(state, selected.evidence, this.now())) return undefined;
    return resultFor(binding.request, selected.evidence.result);
  }

  async consume(bindingInput: ContainmentRemoteEvidenceBinding): Promise<ContainmentAssessmentResult | undefined> {
    const binding = validateBinding(bindingInput);
    const consumptionDigest = bindingDigest(binding);
    return this.store.transaction(async (transaction) => {
      const state = readState(await transaction.readEntries());
      const selected = selectEvidence(state, binding);
      if (!selected) return undefined;
      if (selected.evidence.status === "consumed") throw new Error("Containment remote evidence was already consumed; replay is rejected.");
      if (!usableEvidence(state, selected.evidence, this.now())) throw new Error("Containment remote evidence is expired, revoked, or otherwise unavailable.");
      await transaction.append(evidenceConsumeKind, { evidenceId: selected.evidence.evidenceId, consumptionDigest });
      return resultFor(binding.request, selected.evidence.result);
    });
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
    async issueChallenge(input) { return options.registry.issueChallenge(input, await operator(`Issue one offline containment remote-assessment challenge for ${input.request.incidentId}.`)); },
    async listChallenges() { return options.registry.listChallenges(); },
    async importEvidence(sourcePath) { return options.registry.importEvidence(sourcePath, await operator("Import one selected signed containment remote-assessment evidence document.")); },
    async listEvidence() { return options.registry.listEvidence(); }
  };
}

/** Exact bytes an independent evaluator signs; the signature field is excluded by type. */
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
      boundedText(payload.reason, "containment remote trust revocation", 512); boundedText(payload.revokedBy, "containment remote trust operator", 160);
      const current = trust.get(key);
      if (!current || current.status !== "active") throw new Error("Protected containment remote trust revocation has no active predecessor.");
      trust.set(key, { ...current, status: "revoked", revokedAt: exactIso(entry.at, "containment remote trust revocation") });
    } else if (entry.kind === challengeIssueKind) {
      const payload = exactRecord(entry.payload, ["challenge", "issuedBy"], "protected containment remote challenge");
      const challenge = parseChallenge(payload.challenge, new Date(0), true);
      if (challenges.has(challenge.id)) throw new Error("Protected containment remote challenge history contains a duplicate identity.");
      boundedText(payload.issuedBy, "containment remote challenge operator", 160);
      challenges.set(challenge.id, { ...challenge, issuedBy: payload.issuedBy as string, status: "active" });
    } else if (entry.kind === evidenceImportKind) {
      const payload = exactRecord(entry.payload, ["evidence"], "protected containment remote evidence import");
      const stored = parseStoredEvidence(payload.evidence);
      if (evidence.has(stored.evidenceId) || evidenceByChallenge.has(stored.challengeId)) throw new Error("Protected containment remote evidence history contains a replay.");
      const challenge = challenges.get(stored.challengeId);
      if (!challenge) throw new Error("Protected containment remote evidence has no durable challenge.");
      const item: ImportedContainmentRemoteEvidence = { ...stored, importedAt: exactIso(entry.at, "containment remote evidence import"), status: "available" };
      evidence.set(item.evidenceId, item); evidenceByChallenge.set(item.challengeId, item.evidenceId);
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
  const payload = exactRecord(value, ["evidenceId", "challengeId", "authorityId", "keyId", "evaluatorNonce", "evaluatedAt", "expiresAt", "documentSha256", "importedBy", "result"], "protected containment remote evidence");
  return {
    evidenceId: pattern(payload.evidenceId, evidencePattern, "containment remote evidence id"),
    challengeId: pattern(payload.challengeId, challengePattern, "containment remote challenge id"),
    authorityId: identifier(payload.authorityId, "containment remote authority"), keyId: digest(payload.keyId, "containment remote key"),
    evaluatorNonce: digest(payload.evaluatorNonce, "containment remote evaluator nonce"),
    evaluatedAt: exactIso(payload.evaluatedAt, "containment remote evaluation"), expiresAt: exactIso(payload.expiresAt, "containment remote evidence expiry"),
    documentSha256: digest(payload.documentSha256, "containment remote document"), importedBy: boundedText(payload.importedBy, "containment remote evidence operator", 160),
    result: parseStoredResult(payload.result)
  };
}

function parseStoredResult(value: unknown): StoredRemoteResult {
  const item = exactRecord(value, ["status", "exposure", "summary", "findings"], "protected containment remote result");
  const status = assessmentStatus(item.status); const exposure = exposureStatus(item.exposure);
  if (!Array.isArray(item.findings) || item.findings.length > maximumFindings) throw new Error("Protected containment remote findings are invalid.");
  const findings = item.findings.map((finding) => {
    const entry = exactRecord(finding, ["id", "relativePath", "credentialRelated"], "protected containment remote finding");
    if (typeof entry.credentialRelated !== "boolean") throw new Error("Protected containment remote finding is malformed.");
    return { id: pattern(entry.id, /^containment-finding:[a-f0-9]{64}$/, "containment finding id"), relativePath: safeRelative(entry.relativePath), credentialRelated: entry.credentialRelated };
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
  const item = exactRecord(value, ["schema", "version", "purpose", "authorityId", "keyId", "publicKeyPem", "expiresAt"], "containment remote trust policy");
  if (item.schema !== "sxsy-b122.containment-remote-trust-policy" || item.version !== 1 || item.purpose !== purpose) throw new Error("Containment remote trust policy schema or purpose is invalid.");
  const publicKeyPem = boundedText(item.publicKeyPem, "containment remote public key", 16_384);
  let publicKey;
  try { publicKey = createPublicKey(publicKeyPem); } catch { throw new Error("Containment remote trust policy public key is invalid."); }
  if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Containment remote trust policy requires ECDSA P-256.");
  const keyId = sha256(publicKey.export({ type: "spki", format: "der" }));
  if (!sameDigest(keyId, digest(item.keyId, "containment remote key"))) throw new Error("Containment remote trust key ID does not match its P-256 SPKI key.");
  const expiresAt = exactIso(item.expiresAt, "containment remote trust expiry");
  if (!allowExpired && Date.parse(expiresAt) <= exactNow(now).getTime()) throw new Error("Containment remote trust policy is expired.");
  return { schema: "sxsy-b122.containment-remote-trust-policy", version: 1, purpose, authorityId: identifier(item.authorityId, "containment remote authority"), keyId, publicKeyPem, expiresAt };
}

function parseEvidence(bytes: Uint8Array, now: Date): SignedContainmentRemoteEvidence {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error("Containment remote evidence is not JSON."); }
  const item = exactRecord(value, ["schema", "version", "purpose", "evidenceId", "authorityId", "keyId", "challenge", "evaluatorNonce", "evaluatedAt", "expiresAt", "status", "exposure", "summary", "refResults", "signatureAlgorithm", "signature"], "containment remote evidence");
  if (item.schema !== "sxsy-b122.containment-remote-evidence" || item.version !== 1 || item.purpose !== purpose || item.signatureAlgorithm !== signatureAlgorithm) throw new Error("Containment remote evidence schema, purpose, or signature algorithm is invalid.");
  const challenge = parseChallenge(item.challenge, now);
  const authorityId = identifier(item.authorityId, "containment remote authority"); const keyId = digest(item.keyId, "containment remote key");
  if (authorityId !== challenge.authorityId || keyId !== challenge.keyId) throw new Error("Containment remote evidence uses the wrong challenge authority or key.");
  const evaluatorNonce = digest(item.evaluatorNonce, "containment remote evaluator nonce");
  if (sameDigest(evaluatorNonce, challenge.challengeNonce)) throw new Error("Containment remote evidence requires an independent evaluator nonce.");
  const evidenceId = pattern(item.evidenceId, evidencePattern, "containment remote evidence id");
  if (!sameDigest(evidenceId, containmentRemoteEvidenceId(challenge.id, evaluatorNonce, authorityId, keyId))) throw new Error("Containment remote evidence identity does not match its exact challenge and evaluator nonce.");
  const evaluatedAt = exactIso(item.evaluatedAt, "containment remote evaluation"); const expiresAt = exactIso(item.expiresAt, "containment remote evidence expiry");
  const observed = exactNow(now).getTime(); const evaluated = Date.parse(evaluatedAt); const expires = Date.parse(expiresAt);
  if (evaluated < Date.parse(challenge.issuedAt) || evaluated > observed + maximumFutureSkewMs || observed - evaluated > maximumEvidenceAgeMs
    || expires <= observed || expires <= evaluated || expires > Date.parse(challenge.expiresAt)) {
    throw new Error("Containment remote evidence is future-dated, expired, or outside its exact freshness window.");
  }
  if (!Array.isArray(item.refResults) || item.refResults.length < 1 || item.refResults.length > maximumRefs) throw new Error("Containment remote evidence ref coverage is invalid.");
  const refResults = item.refResults.map(parseRefResult);
  const status = assessmentStatus(item.status); const exposure = exposureStatus(item.exposure);
  const derived = deriveAggregate(refResults);
  if (status !== derived.status || exposure !== derived.exposure) throw new Error("Containment remote evidence aggregate result is inconsistent with its ref results.");
  const signature = boundedText(item.signature, "containment remote evidence signature", 512);
  return {
    schema: "sxsy-b122.containment-remote-evidence", version: 1, purpose, evidenceId, authorityId, keyId, challenge,
    evaluatorNonce, evaluatedAt, expiresAt, status, exposure, summary: boundedText(item.summary, "containment remote evidence summary", 2_048),
    refResults, signatureAlgorithm, signature
  };
}

function parseChallenge(value: unknown, now: Date, allowExpired = false): ContainmentRemoteEvidenceChallenge {
  const item = exactRecord(value, ["schema", "version", "purpose", "id", "authorityId", "keyId", "incidentId", "repositoryRootDigest", "fenceEpoch", "generation", "remoteOperationId", "remoteExternalId", "targetSnapshotId", "canonicalRemote", "policyVersion", "requiredRefs", "challengeNonce", "issuedAt", "expiresAt"], "containment remote challenge");
  if (item.schema !== "sxsy-b122.containment-remote-challenge" || item.version !== 1 || item.purpose !== purpose) throw new Error("Containment remote challenge schema or purpose is invalid.");
  const issuedAt = exactIso(item.issuedAt, "containment remote challenge issue"); const expiresAt = exactIso(item.expiresAt, "containment remote challenge expiry");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt) || Date.parse(expiresAt) - Date.parse(issuedAt) > maximumChallengeLifetimeMs || (!allowExpired && Date.parse(expiresAt) <= exactNow(now).getTime())) throw new Error("Containment remote challenge is expired or exceeds its maximum lifetime.");
  const challenge: ContainmentRemoteEvidenceChallenge = {
    schema: "sxsy-b122.containment-remote-challenge", version: 1, purpose,
    id: pattern(item.id, challengePattern, "containment remote challenge id"), authorityId: identifier(item.authorityId, "containment remote authority"), keyId: digest(item.keyId, "containment remote key"),
    incidentId: pattern(item.incidentId, incidentPattern, "containment incident id"), repositoryRootDigest: digest(item.repositoryRootDigest, "containment repository root"),
    fenceEpoch: positiveInteger(item.fenceEpoch, "containment fence epoch"), generation: positiveInteger(item.generation, "containment assessment generation"),
    remoteOperationId: pattern(item.remoteOperationId, childPattern, "containment remote operation id"), remoteExternalId: pattern(item.remoteExternalId, childPattern, "containment remote external id"),
    targetSnapshotId: identifier(item.targetSnapshotId, "containment target snapshot"), canonicalRemote: strictCanonicalRemote(item.canonicalRemote),
    policyVersion: identifier(item.policyVersion, "containment remote policy"), requiredRefs: parseRefs(item.requiredRefs), challengeNonce: digest(item.challengeNonce, "containment remote challenge nonce"),
    issuedAt, expiresAt
  };
  if (!sameDigest(challenge.id, deriveChallengeId(challengeIdentityDocument(challenge)))) throw new Error("Containment remote challenge identity does not bind its exact contents.");
  return challenge;
}

function parseRefResult(value: unknown): ContainmentRemoteEvidenceRefResult {
  const item = exactRecord(value, ["ref", "expectedHead", "status", "exposure", "summary", "findings"], "containment remote ref result");
  const ref = exactRef(item.ref); const expectedHead = commit(item.expectedHead); const status = assessmentStatus(item.status); const exposure = exposureStatus(item.exposure);
  if (!Array.isArray(item.findings) || item.findings.length > 64) throw new Error("Containment remote ref findings exceed their bound.");
  const findings = item.findings.map((valueItem) => {
    const finding = exactRecord(valueItem, ["relativePath", "credentialRelated"], "containment remote ref finding");
    if (typeof finding.credentialRelated !== "boolean") throw new Error("Containment remote ref finding is malformed.");
    return { relativePath: safeRelative(finding.relativePath), credentialRelated: finding.credentialRelated };
  });
  if (new Set(findings.map((finding) => finding.relativePath.toLowerCase())).size !== findings.length) throw new Error("Containment remote ref findings contain duplicate paths.");
  assertResultConsistency(status, exposure, findings.length);
  return { ref, expectedHead, status, exposure, summary: boundedText(item.summary, "containment remote ref summary", 1_024), findings };
}

function validateBinding(input: ContainmentRemoteEvidenceBinding): ContainmentRemoteEvidenceBinding {
  const request = validateRemoteRequest(input.request);
  return {
    request, generation: positiveInteger(input.generation, "containment assessment generation"),
    targetSnapshotId: identifier(input.targetSnapshotId, "containment target snapshot"), canonicalRemote: canonicalRemote(input.canonicalRemote),
    policyVersion: identifier(input.policyVersion, "containment remote policy"), authorityId: identifier(input.authorityId, "containment remote authority"),
    keyId: digest(input.keyId, "containment remote key"), requiredRefs: parseRefs(input.requiredRefs)
  };
}

function validateRemoteRequest(value: ContainmentAssessmentRequest): ContainmentAssessmentRequest {
  const item = exactRecord(value, ["schema", "version", "incidentId", "repositoryRoot", "fenceEpoch", "step", "operationId", "externalId", "egressAllowed", "revealSecretValues"], "containment remote assessment request");
  if (item.schema !== "sxsy-b122.containment-assessment-request" || item.version !== 1 || item.step !== "remote" || item.egressAllowed !== false || item.revealSecretValues !== false) throw new Error("Containment remote evidence requires the exact no-egress remote assessment child.");
  const repositoryRoot = absolutePath(item.repositoryRoot, "containment repository root");
  return {
    schema: "sxsy-b122.containment-assessment-request", version: 1, incidentId: pattern(item.incidentId, incidentPattern, "containment incident id"), repositoryRoot,
    fenceEpoch: positiveInteger(item.fenceEpoch, "containment fence epoch"), step: "remote",
    operationId: pattern(item.operationId, childPattern, "containment remote operation id"), externalId: pattern(item.externalId, childPattern, "containment remote external id"),
    egressAllowed: false, revealSecretValues: false
  };
}

function selectEvidence(state: RegistryState, binding: ContainmentRemoteEvidenceBinding): Readonly<{ challenge: InstalledContainmentRemoteChallenge; evidence: ImportedContainmentRemoteEvidence }> | undefined {
  const wanted = bindingDigest(binding);
  const matches = [...state.challenges.values()].filter((item) => challengeBindingDigest(item) === wanted);
  if (matches.length > 1) throw new Error("Protected containment remote challenge selection is ambiguous.");
  const challenge = matches[0]; if (!challenge?.evidenceId) return undefined;
  const evidence = state.evidence.get(challenge.evidenceId);
  if (!evidence) throw new Error("Protected containment remote challenge lost its imported evidence.");
  if (evidence.status === "consumed" && evidence.consumptionDigest !== wanted) throw new Error("Protected containment remote evidence consumption changed its exact child binding.");
  return { challenge, evidence };
}

function usableEvidence(state: RegistryState, evidence: ImportedContainmentRemoteEvidence, nowInput: Date): boolean {
  const now = exactNow(nowInput);
  const trust = state.trust.get(trustKey(evidence.authorityId, evidence.keyId));
  return !!trust && trust.status === "active" && Date.parse(trust.expiresAt) > now.getTime() && Date.parse(evidence.expiresAt) > now.getTime();
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
  for (const ref of evidence.refResults) for (const finding of ref.findings) {
    const key = finding.relativePath.toLowerCase(); const current = byPath.get(key);
    byPath.set(key, { relativePath: current?.relativePath ?? finding.relativePath, credentialRelated: (current?.credentialRelated ?? false) || finding.credentialRelated });
  }
  if (byPath.size > maximumFindings) throw new Error("Containment remote evidence has too many generation-scoped findings.");
  const findings = [...byPath.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath)).map((finding) => ({
    id: `containment-finding:${sha256(stableJson({
      generation: evidence.challenge.generation, incidentId: evidence.challenge.incidentId,
      remoteOperationId: evidence.challenge.remoteOperationId, targetSnapshotId: evidence.challenge.targetSnapshotId,
      relativePath: finding.relativePath.toLowerCase()
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

function requireUsableTrust(trust: InstalledContainmentRemoteTrust | undefined, now: Date, evidenceExpiry?: string): asserts trust is InstalledContainmentRemoteTrust {
  if (!trust || trust.status !== "active" || trust.purpose !== purpose || Date.parse(trust.expiresAt) <= now.getTime()
    || (evidenceExpiry !== undefined && Date.parse(evidenceExpiry) > Date.parse(trust.expiresAt))) {
    throw new Error("Containment remote evidence authority is absent, revoked, expired, wrong-purpose, or shorter-lived than the requested evidence.");
  }
}

function deriveAggregate(refs: readonly ContainmentRemoteEvidenceRefResult[]): Readonly<{ status: ContainmentAssessmentStatus; exposure: ContainmentExposure }> {
  const unknown = refs.filter((item) => item.exposure === "unknown");
  const findings = refs.reduce((total, item) => total + item.findings.length, 0);
  if (unknown.length) {
    if (findings > 0 || refs.some((item) => item.status === "failed" || item.exposure === "found")) throw new Error("Containment remote evidence cannot hide known findings behind partial or unknown ref truth.");
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

function assertRefCoverage(required: readonly ContainmentRemoteRefBinding[], actual: readonly ContainmentRemoteEvidenceRefResult[]): void {
  if (required.length !== actual.length || required.some((item, index) => item.ref !== actual[index]?.ref || item.expectedHead !== actual[index]?.expectedHead)) {
    throw new Error("Containment remote evidence does not provide exact complete required-ref coverage and expected heads.");
  }
}

function bindingDigest(binding: ContainmentRemoteEvidenceBinding): string {
  return sha256(stableJson({
    authorityId: binding.authorityId, canonicalRemote: binding.canonicalRemote, fenceEpoch: binding.request.fenceEpoch,
    generation: binding.generation, incidentId: binding.request.incidentId, keyId: binding.keyId, policyVersion: binding.policyVersion,
    purpose, remoteExternalId: binding.request.externalId, remoteOperationId: binding.request.operationId,
    repositoryRootDigest: repositoryDigest(binding.request.repositoryRoot), requiredRefs: binding.requiredRefs,
    targetSnapshotId: binding.targetSnapshotId
  }));
}

function challengeBindingDigest(challenge: ContainmentRemoteEvidenceChallenge): string {
  return sha256(stableJson({
    authorityId: challenge.authorityId, canonicalRemote: challenge.canonicalRemote, fenceEpoch: challenge.fenceEpoch,
    generation: challenge.generation, incidentId: challenge.incidentId, keyId: challenge.keyId, policyVersion: challenge.policyVersion,
    purpose, remoteExternalId: challenge.remoteExternalId, remoteOperationId: challenge.remoteOperationId,
    repositoryRootDigest: challenge.repositoryRootDigest, requiredRefs: challenge.requiredRefs,
    targetSnapshotId: challenge.targetSnapshotId
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

function parseRefs(value: unknown): readonly ContainmentRemoteRefBinding[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumRefs) throw new Error("Containment remote required refs are invalid or unbounded.");
  const refs = value.map((candidate) => {
    const item = exactRecord(candidate, ["ref", "expectedHead"], "containment remote ref binding");
    return { ref: exactRef(item.ref), expectedHead: commit(item.expectedHead) };
  }).sort((left, right) => left.ref.localeCompare(right.ref));
  if (new Set(refs.map((item) => item.ref.toLowerCase())).size !== refs.length) throw new Error("Containment remote required refs contain duplicates.");
  return refs;
}

function exactRef(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || !/^refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/.test(value)
    || value.includes("..") || value.includes("@{") || value.endsWith(".") || value.endsWith(".lock")
    || value.split("/").some((part) => !part || part === "." || part === "..") || /[\0\r\n\\~^:?*[ ]/.test(value)) {
    throw new Error("Containment remote ref is invalid.");
  }
  return value;
}

function canonicalRemote(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2_048 || /[\0\r\n\s]/.test(value)) throw new Error("Containment canonical remote is invalid.");
  if (/^https?:\/\//i.test(value) || /^ssh:\/\//i.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Containment canonical remote is invalid."); }
    if (!(["https:", "ssh:"] as const).includes(url.protocol as "https:" | "ssh:") || url.password || url.search || url.hash || !url.hostname || !safeRemotePath(url.pathname)) throw new Error("Containment canonical remote is invalid or credential-bearing.");
    if (url.protocol === "https:" && url.username) throw new Error("Containment canonical remote cannot contain HTTPS credentials.");
    const user = url.username ? `${url.username}@` : ""; const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//${user}${url.hostname.toLowerCase()}${port}${url.pathname.replace(/\/+$/, "")}`;
  }
  const scp = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(.+)$/.exec(value);
  if (!scp || !safeRemotePath(`/${scp[3]}`)) throw new Error("Containment canonical remote must be fixed HTTPS, SSH, or SCP-style Git identity.");
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

async function readBoundedRegularFile(pathInput: string, maximum: number, label: string): Promise<Readonly<{ path: string; bytes: Uint8Array }>> {
  if (typeof pathInput !== "string" || !isAbsolute(pathInput) || pathInput.length > 4_096 || /[\0\r\n]/.test(pathInput)) throw new Error(`${label} path must be fixed and absolute.`);
  const selected = resolve(pathInput); const before = await lstat(selected);
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maximum) throw new Error(`${label} is absent, linked, empty, or oversized.`);
  const canonical = await realpath(selected); const canonicalBefore = await lstat(canonical);
  if (!canonicalBefore.isFile() || canonicalBefore.isSymbolicLink() || canonicalBefore.size !== before.size || canonicalBefore.dev !== before.dev || canonicalBefore.ino !== before.ino) throw new Error(`${label} changed during regular-file validation.`);
  const bytes = await readFile(canonical); const after = await lstat(canonical);
  if (bytes.byteLength !== before.size || after.size !== before.size || after.mtimeMs !== canonicalBefore.mtimeMs || after.dev !== canonicalBefore.dev || after.ino !== canonicalBefore.ino) throw new Error(`${label} changed while being read.`);
  return { path: canonical, bytes };
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} is not a plain closed record.`);
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== keys.length || !keys.every((key) => Object.hasOwn(item, key))) throw new Error(`${label} has an open or incomplete schema.`);
  return item;
}

function assessmentStatus(value: unknown): ContainmentAssessmentStatus {
  if (value !== "passed" && value !== "failed" && value !== "unavailable" && value !== "incomplete") throw new Error("Containment remote assessment status is invalid.");
  return value;
}
function exposureStatus(value: unknown): ContainmentExposure {
  if (value !== "none" && value !== "found" && value !== "unknown") throw new Error("Containment remote exposure is invalid.");
  return value;
}
function absolutePath(value: unknown, label: string): string { if (typeof value !== "string" || !isAbsolute(value) || value.length > 4_096 || /[\0\r\n]/.test(value)) throw new Error(`${label} must be exact and absolute.`); return resolve(value); }
function repositoryDigest(value: string): string { const canonical = resolve(value).replaceAll("\\", "/").replace(/\/+$/, ""); return sha256(process.platform === "win32" ? canonical.toLowerCase() : canonical); }
function safeRelative(value: unknown): string { if (typeof value !== "string") throw new Error("Containment remote finding path is invalid."); const normalized = value.replaceAll("\\", "/"); if (!normalized || normalized.length > 2_048 || isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || /[\0\r\n]/.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) throw new Error("Containment remote finding path is outside the repository boundary."); return normalized; }
function exactNow(value: Date): Date { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Containment remote clock is invalid."); return new Date(value); }
function exactIso(value: unknown, label: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} timestamp is invalid.`); return value; }
function future(value: unknown, now: Date, maximum: number, label: string): string { const timestamp = exactIso(value, label); const delta = Date.parse(timestamp) - now.getTime(); if (delta <= 0 || delta > maximum) throw new Error(`${label} is expired or exceeds its maximum lifetime.`); return timestamp; }
function positiveInteger(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} is invalid.`); return value as number; }
function commit(value: unknown): string { if (typeof value !== "string" || !commitPattern.test(value)) throw new Error("Containment remote expected head is invalid."); return value; }
function identifier(value: unknown, label: string): string { if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function pattern(value: unknown, expected: RegExp, label: string): string { if (typeof value !== "string" || !expected.test(value)) throw new Error(`${label} is invalid.`); return value; }
function boundedText(value: unknown, label: string, maximum: number): string { if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\0]/.test(value)) throw new Error(`${label} is invalid.`); return value.trim(); }
function trustKey(authorityId: string, keyId: string): string { return `${authorityId}:${keyId}`; }
function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function sameDigest(left: string, right: string): boolean { const leftHash = sha256(left); const rightHash = sha256(right); if (leftHash.length !== rightHash.length) return false; let result = 0; for (let index = 0; index < leftHash.length; index += 1) result |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index); return result === 0; }
function clone<T>(value: T): T { return JSON.parse(stableJson(value)) as T; }
