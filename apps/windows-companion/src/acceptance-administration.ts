/**
 * Host-owned administration for independently signed acceptance evidence.
 *
 * A dispatch payload cannot install a trust anchor, import evidence, or enable
 * a high-consequence action. Those transitions require Windows user presence,
 * a protected journal, a current signature, exact artifact hashes, and an
 * explicit target-bound activation record.
 */
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  GateEvidenceLedger,
  type EvidenceArtifactVerifier,
  type EvidenceAuthorizationRequest,
  type EvidenceAuthorizer,
  type GateEvidence,
  type GateEvidenceInput
} from "../../../packages/control-plane/src/acceptance-evidence.ts";
import { commandForAction, type AcceptanceGate, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";

const trustInstallKind = "b122.acceptance-trust.install.v1";
const trustRevokeKind = "b122.acceptance-trust.revoke.v1";
const activationKind = "b122.high-consequence.activate.v1";
const activationRevokeKind = "b122.high-consequence.revoke.v1";
const maximumDocumentBytes = 1024 * 1024;
const maximumArtifactBytes = 16 * 1024 * 1024;
const maximumPackageBytes = 64 * 1024 * 1024;
const maximumEvidenceLifetimeMs = 366 * 24 * 60 * 60_000;
const maximumActivationLifetimeMs = 30 * 24 * 60 * 60_000;
const digestPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface AcceptanceTrustPolicy {
  readonly schema: "sxsy-b122.acceptance-trust-policy";
  readonly version: 1;
  readonly authorityId: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly allowedGates: readonly AcceptanceGate[];
  readonly expiresAt: string;
}

export interface InstalledAcceptanceTrust extends AcceptanceTrustPolicy {
  readonly installedAt: string;
  readonly installedBy: string;
  readonly status: "active" | "revoked";
}

export interface AcceptanceEvidenceArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mediaType: string;
}

export interface SignedAcceptanceEvidenceBundle {
  readonly schema: "sxsy-b122.acceptance-evidence-bundle";
  readonly version: 1;
  readonly id: string;
  readonly authorityId: string;
  readonly keyId: string;
  readonly gate: AcceptanceGate;
  readonly status: "passed" | "failed" | "unavailable" | "incomplete";
  readonly targetSnapshotId: string | null;
  readonly operationId: string | null;
  readonly evidenceDigest: string;
  readonly policyVersion: string;
  readonly evaluatedBy: string;
  readonly evaluatedAt: string;
  readonly expiresAt: string;
  readonly rationale: string;
  readonly artifacts: readonly AcceptanceEvidenceArtifact[];
  readonly signatureAlgorithm: "ecdsa-p256-sha256";
  readonly signature: string;
}

export interface HighConsequenceActivation {
  readonly id: string;
  readonly action: CommandAction;
  readonly targetSnapshotId: string;
  readonly policyVersion: string;
  readonly gateEvidenceIds: readonly string[];
  readonly activatedAt: string;
  readonly expiresAt: string;
  readonly activatedBy: string;
  readonly status: "active" | "revoked";
}

interface TrustInstallPayload extends Record<string, JsonValue> {
  readonly policy: JsonValue;
  readonly installedBy: string;
}

interface TrustRevokePayload extends Record<string, JsonValue> {
  readonly authorityId: string;
  readonly keyId: string;
  readonly reason: string;
  readonly revokedBy: string;
}

interface ActivationPayload extends Record<string, JsonValue> {
  readonly activation: JsonValue;
}

interface ActivationRevokePayload extends Record<string, JsonValue> {
  readonly activationId: string;
  readonly reason: string;
  readonly revokedBy: string;
}

/** Protected trust-anchor registry. Public keys are never selected by clients. */
export class DurableAcceptanceTrustRegistry {
  constructor(private readonly store: ProtectedJsonStore, private readonly now: () => Date = () => new Date()) {}

  async install(policy: AcceptanceTrustPolicy, installedBy: string): Promise<InstalledAcceptanceTrust> {
    const parsed = validateTrustPolicy(policy, this.now());
    const operator = boundedText(installedBy, "trust-anchor operator", 160);
    const active = (await this.list()).find((item) => item.authorityId === parsed.authorityId && item.status === "active");
    if (active) throw new Error("An active acceptance authority already exists; revoke it before key rotation.");
    const entry = await this.store.append<TrustInstallPayload>(trustInstallKind, { policy: parsed as unknown as JsonValue, installedBy: operator });
    return { ...parsed, installedAt: entry.at, installedBy: operator, status: "active" };
  }

  async revoke(authorityId: string, keyId: string, reason: string, revokedBy: string): Promise<InstalledAcceptanceTrust> {
    const current = await this.resolve(authorityId, keyId);
    if (!current || current.status !== "active") throw new Error("The selected acceptance authority is not active.");
    await this.store.append<TrustRevokePayload>(trustRevokeKind, {
      authorityId: identifier(authorityId, "authority id"),
      keyId: digest(keyId, "authority key id"),
      reason: boundedText(reason, "trust revocation reason", 512),
      revokedBy: boundedText(revokedBy, "trust revocation operator", 160)
    });
    return { ...current, status: "revoked" };
  }

  async resolve(authorityId: string, keyId: string): Promise<InstalledAcceptanceTrust | undefined> {
    return (await this.list()).find((item) => item.authorityId === authorityId && item.keyId === keyId);
  }

  async list(): Promise<readonly InstalledAcceptanceTrust[]> {
    const values = new Map<string, InstalledAcceptanceTrust>();
    for (const entry of await this.store.readEntries<JsonValue>()) {
      if (entry.kind === trustInstallKind) {
        const payload = entry.payload as unknown as Record<string, unknown>;
        if (!record(payload) || !record(payload.policy) || typeof payload.installedBy !== "string") throw new Error("The protected acceptance trust journal is malformed.");
        const policy = validateTrustPolicy(payload.policy, this.now(), true);
        values.set(`${policy.authorityId}:${policy.keyId}`, { ...policy, installedAt: entry.at, installedBy: payload.installedBy, status: "active" });
      } else if (entry.kind === trustRevokeKind) {
        const payload = entry.payload as unknown as Record<string, unknown>;
        if (!record(payload) || typeof payload.authorityId !== "string" || typeof payload.keyId !== "string") throw new Error("The protected acceptance trust revocation is malformed.");
        const key = `${payload.authorityId}:${payload.keyId}`;
        const existing = values.get(key);
        if (existing) values.set(key, { ...existing, status: "revoked" });
      }
    }
    return [...values.values()];
  }
}

/** Single-use capabilities keep the public ledger API fail-closed. */
export class SingleUseEvidenceAuthorizer implements EvidenceAuthorizer {
  private readonly capabilities = new Map<string, Readonly<{ digest: string; expiresAt: number }>>();
  constructor(private readonly now: () => number = Date.now) {}

  issue(request: Omit<EvidenceAuthorizationRequest, "authorizationProof">): string {
    for (const [token, item] of this.capabilities) if (item.expiresAt <= this.now()) this.capabilities.delete(token);
    if (this.capabilities.size >= 32) throw new Error("Too many acceptance-evidence authorizations are pending.");
    const token = randomBytes(32).toString("hex");
    this.capabilities.set(token, { digest: sha256Canonical(request), expiresAt: this.now() + 30_000 });
    return token;
  }

  assertMayRecord(request: EvidenceAuthorizationRequest): void {
    const token = request.authorizationProof;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Acceptance evidence lacks a host-issued single-use authorization.");
    const capability = this.capabilities.get(token);
    this.capabilities.delete(token);
    const { authorizationProof: _ignored, ...binding } = request;
    if (!capability || capability.expiresAt <= this.now() || !fixed(capability.digest, sha256Canonical(binding))) {
      throw new Error("Acceptance evidence authorization is expired, replayed, or bound to different evidence.");
    }
  }
}

/** Target-scoped activation registry consulted on every policy evaluation. */
export class DurableHighConsequenceActivationRegistry {
  constructor(private readonly store: ProtectedJsonStore, private readonly policyVersion: string, private readonly now: () => Date = () => new Date()) {
    boundedText(policyVersion, "activation policy version", 128);
  }

  async activate(input: Omit<HighConsequenceActivation, "id" | "activatedAt" | "status">): Promise<HighConsequenceActivation> {
    const definition = commandForAction(input.action);
    if (!definition.highConsequence) throw new Error("Only a high-consequence catalog action can be activated.");
    const at = this.now();
    const expires = validFuture(input.expiresAt, at, maximumActivationLifetimeMs, "activation expiry");
    if (input.policyVersion !== this.policyVersion) throw new Error("Activation policy version does not match the installed companion policy.");
    const recordValue: HighConsequenceActivation = {
      id: randomUUID(),
      action: input.action,
      targetSnapshotId: identifier(input.targetSnapshotId, "activation target snapshot"),
      policyVersion: this.policyVersion,
      gateEvidenceIds: uniqueIdentifiers(input.gateEvidenceIds, "gate evidence id"),
      activatedAt: at.toISOString(),
      expiresAt: expires.toISOString(),
      activatedBy: boundedText(input.activatedBy, "activation operator", 160),
      status: "active"
    };
    const required = new Set(definition.acceptanceGates);
    if (recordValue.gateEvidenceIds.length !== required.size) throw new Error("Activation does not bind exactly one current evidence record per required gate.");
    await this.store.append<ActivationPayload>(activationKind, { activation: recordValue as unknown as JsonValue });
    return recordValue;
  }

  async revoke(activationId: string, reason: string, revokedBy: string): Promise<void> {
    const current = (await this.list()).find((item) => item.id === activationId && item.status === "active");
    if (!current) throw new Error("The selected high-consequence activation is not active.");
    await this.store.append<ActivationRevokePayload>(activationRevokeKind, {
      activationId: identifier(activationId, "activation id"),
      reason: boundedText(reason, "activation revocation reason", 512),
      revokedBy: boundedText(revokedBy, "activation revocation operator", 160)
    });
  }

  async list(): Promise<readonly HighConsequenceActivation[]> {
    const values = new Map<string, HighConsequenceActivation>();
    for (const entry of await this.store.readEntries<JsonValue>()) {
      if (entry.kind === activationKind) {
        const payload = entry.payload as unknown as Record<string, unknown>;
        if (!record(payload) || !record(payload.activation)) throw new Error("The protected activation journal is malformed.");
        const item = parseActivation(payload.activation);
        values.set(item.id, item);
      } else if (entry.kind === activationRevokeKind) {
        const payload = entry.payload as unknown as Record<string, unknown>;
        if (!record(payload) || typeof payload.activationId !== "string") throw new Error("The protected activation revocation is malformed.");
        const existing = values.get(payload.activationId);
        if (existing) values.set(existing.id, { ...existing, status: "revoked" });
      }
    }
    return [...values.values()];
  }

  async enabledActions(targetSnapshotId: string, now = this.now()): Promise<readonly CommandAction[]> {
    const actions = (await this.list())
      .filter((item) => item.status === "active" && item.policyVersion === this.policyVersion && item.targetSnapshotId === targetSnapshotId && Date.parse(item.expiresAt) > now.getTime())
      .map((item) => item.action);
    return [...new Set(actions)].sort();
  }
}

export interface AcceptanceAdministration {
  readonly ledger: GateEvidenceLedger;
  readonly trust: DurableAcceptanceTrustRegistry;
  readonly activations: DurableHighConsequenceActivationRegistry;
  installTrustPolicy(sourcePath: string): Promise<InstalledAcceptanceTrust>;
  listTrust(): Promise<readonly InstalledAcceptanceTrust[]>;
  revokeTrust(authorityId: string, keyId: string, reason: string): Promise<InstalledAcceptanceTrust>;
  importEvidence(sourcePath: string): Promise<GateEvidence>;
  listEvidence(): Promise<readonly GateEvidence[]>;
  invalidateEvidence(evidenceId: string, reason: string): Promise<void>;
  activate(action: CommandAction, targetSnapshotId: string, expiresAt: string): Promise<HighConsequenceActivation>;
  listActivations(): Promise<readonly HighConsequenceActivation[]>;
  revokeActivation(activationId: string, reason: string): Promise<void>;
}

export function createAcceptanceAdministration(options: Readonly<{
  store: ProtectedJsonStore;
  stateDirectory: string;
  presence: WindowsUserPresenceRunner;
  policyVersion: string;
  now?: () => Date;
}>): AcceptanceAdministration {
  const now = options.now ?? (() => new Date());
  const trust = new DurableAcceptanceTrustRegistry(options.store, now);
  const authorizer = new SingleUseEvidenceAuthorizer(() => now().getTime());
  const artifacts = new DurableAcceptanceEvidencePackages(options.stateDirectory, trust, now);
  const ledger = new GateEvidenceLedger(options.store, authorizer, { clock: () => now().toISOString(), artifactVerifier: artifacts });
  const activations = new DurableHighConsequenceActivationRegistry(options.store, options.policyVersion, now);

  const operator = async (prompt: string): Promise<string> => {
    const approved = await options.presence.verify(prompt);
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve acceptance administration.");
    return boundedText(approved.operator, "acceptance operator", 160);
  };

  return {
    ledger,
    trust,
    activations,
    async installTrustPolicy(sourcePath) {
      const policy = parseTrustPolicy(await readBoundedRegularFile(sourcePath, maximumDocumentBytes), now());
      const approvedBy = await operator(`Approve acceptance authority ${policy.authorityId} key ${policy.keyId.slice(0, 12)} for gates ${policy.allowedGates.join(", ")}.`);
      return trust.install(policy, approvedBy);
    },
    async listTrust() { return trust.list(); },
    async revokeTrust(authorityId, keyId, reason) {
      const approvedBy = await operator(`Revoke acceptance authority ${authorityId} key ${keyId.slice(0, 12)}.`);
      return trust.revoke(authorityId, keyId, reason, approvedBy);
    },
    async importEvidence(sourcePath) {
      const prepared = await artifacts.prepareImport(sourcePath, options.policyVersion);
      try {
        const approvedBy = await operator(`Import signed acceptance evidence ${prepared.bundle.id} for gate ${prepared.bundle.gate} with status ${prepared.bundle.status}.`);
        const input: GateEvidenceInput = {
          id: prepared.bundle.id,
          gate: prepared.bundle.gate,
          status: prepared.bundle.status,
          ...(prepared.bundle.targetSnapshotId ? { targetSnapshotId: prepared.bundle.targetSnapshotId } : {}),
          ...(prepared.bundle.operationId ? { operationId: prepared.bundle.operationId } : {}),
          evidenceDigest: prepared.bundle.evidenceDigest,
          evidenceReference: prepared.reference,
          policyVersion: prepared.bundle.policyVersion,
          evaluatedBy: prepared.bundle.evaluatedBy,
          expiresAt: prepared.bundle.expiresAt,
          rationale: `${prepared.bundle.rationale} Imported by ${approvedBy}.`
        };
        const proof = authorizer.issue({ operation: "record", evaluatedBy: input.evaluatedBy, gate: input.gate, evidenceId: input.id, evidenceDigest: input.evidenceDigest });
        await artifacts.commitImport(prepared);
        return await ledger.record({ ...input, authorizationProof: proof });
      } catch (error) {
        await artifacts.abortImport(prepared);
        throw error;
      }
    },
    async listEvidence() { return ledger.list(); },
    async invalidateEvidence(evidenceId, reason) {
      const evidence = await ledger.get(evidenceId);
      if (!evidence) throw new Error("The selected acceptance evidence does not exist.");
      const approvedBy = await operator(`Invalidate acceptance evidence ${evidence.id} for gate ${evidence.gate}.`);
      const proof = authorizer.issue({ operation: "invalidate", evaluatedBy: approvedBy, gate: evidence.gate, evidenceId: evidence.id, evidenceDigest: evidence.evidenceDigest });
      await ledger.invalidate(evidence.id, reason, approvedBy, proof);
    },
    async activate(action, targetSnapshotId, expiresAt) {
      const definition = commandForAction(action);
      if (!definition.highConsequence) throw new Error("The selected command is not high consequence.");
      const evidence: GateEvidence[] = [];
      for (const selectedGate of definition.acceptanceGates) {
        const status = await ledger.statusFor(selectedGate, targetSnapshotId, now().toISOString());
        if (status.status !== "passed" || !status.evidence) throw new Error(`Gate ${selectedGate} lacks current, signed, target-bound passing evidence.`);
        evidence.push(status.evidence);
      }
      const approvedBy = await operator(`Enable ${definition.title} only for target ${targetSnapshotId.slice(0, 12)} until ${expiresAt}.`);
      return activations.activate({ action, targetSnapshotId, policyVersion: options.policyVersion, gateEvidenceIds: evidence.map((item) => item.id), expiresAt, activatedBy: approvedBy });
    },
    async listActivations() { return activations.list(); },
    async revokeActivation(activationId, reason) {
      const approvedBy = await operator(`Revoke high-consequence activation ${activationId}.`);
      await activations.revoke(activationId, reason, approvedBy);
    }
  };
}

interface PreparedImport {
  readonly bundle: SignedAcceptanceEvidenceBundle;
  readonly staging: string;
  readonly reference: string;
}

class DurableAcceptanceEvidencePackages implements EvidenceArtifactVerifier {
  private readonly root: string;
  constructor(root: string, private readonly trust: DurableAcceptanceTrustRegistry, private readonly now: () => Date) {
    if (!boundedAbsolute(root)) throw new Error("Acceptance evidence state directory must be fixed and absolute.");
    this.root = resolve(root, "acceptance-evidence");
  }

  async prepareImport(sourcePath: string, policyVersion: string): Promise<PreparedImport> {
    const source = await concreteFile(sourcePath, maximumDocumentBytes, "acceptance evidence bundle");
    const bundle = parseBundle(source.bytes, this.now());
    if (bundle.policyVersion !== policyVersion) throw new Error("Acceptance evidence policy version does not match the installed companion.");
    await verifyBundleTrust(bundle, this.trust, this.now());
    const sourceRoot = dirname(source.path);
    await verifyArtifacts(bundle, sourceRoot);
    await mkdir(this.root, { recursive: true });
    const staging = resolve(this.root, `.${bundle.id}.${randomUUID()}.tmp`);
    const reference = resolve(this.root, bundle.id);
    if (!inside(this.root, staging) || !inside(this.root, reference)) throw new Error("Acceptance evidence package identity escaped host state.");
    if (await lstat(reference).then(() => true).catch(() => false)) throw new Error("Acceptance evidence package already exists.");
    await mkdir(staging, { recursive: false });
    try {
      await copyFile(source.path, resolve(staging, "bundle.json"));
      for (const artifact of bundle.artifacts) {
        const from = resolve(sourceRoot, artifact.path);
        const to = resolve(staging, "artifacts", artifact.path);
        if (!inside(resolve(staging, "artifacts"), to)) throw new Error("Acceptance artifact path escaped staging.");
        await mkdir(dirname(to), { recursive: true });
        await copyFile(from, to);
      }
      if (!await this.verifyAt(bundle, staging, true)) throw new Error("Acceptance evidence changed while entering host-owned state.");
      return { bundle, staging, reference };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async commitImport(prepared: PreparedImport): Promise<void> { await rename(prepared.staging, prepared.reference); }
  async abortImport(prepared: PreparedImport): Promise<void> {
    await Promise.all([
      rm(prepared.staging, { recursive: true, force: true }),
      rm(prepared.reference, { recursive: true, force: true })
    ]);
  }

  async verify(evidence: GateEvidence): Promise<boolean> {
    if (!evidence.evidenceReference || !inside(this.root, resolve(evidence.evidenceReference))) return false;
    try {
      const bytes = await readBoundedRegularFile(resolve(evidence.evidenceReference, "bundle.json"), maximumDocumentBytes);
      const bundle = parseBundle(bytes, this.now());
      if (bundle.id !== evidence.id || bundle.gate !== evidence.gate || bundle.status !== evidence.status || bundle.evidenceDigest !== evidence.evidenceDigest || bundle.policyVersion !== evidence.policyVersion || bundle.targetSnapshotId !== (evidence.targetSnapshotId ?? null)) return false;
      await verifyBundleTrust(bundle, this.trust, this.now());
      return this.verifyAt(bundle, evidence.evidenceReference, true);
    } catch { return false; }
  }

  private async verifyAt(bundle: SignedAcceptanceEvidenceBundle, packageRoot: string, stored: boolean): Promise<boolean> {
    const artifactRoot = stored ? resolve(packageRoot, "artifacts") : packageRoot;
    await verifyArtifacts(bundle, artifactRoot);
    return true;
  }
}

async function verifyBundleTrust(bundle: SignedAcceptanceEvidenceBundle, trust: DurableAcceptanceTrustRegistry, now: Date): Promise<void> {
  const anchor = await trust.resolve(bundle.authorityId, bundle.keyId);
  if (!anchor || anchor.status !== "active" || Date.parse(anchor.expiresAt) <= now.getTime() || !anchor.allowedGates.includes(bundle.gate)) throw new Error("Acceptance evidence authority is absent, revoked, expired, or not authorized for this gate.");
  const signature = Buffer.from(bundle.signature, "base64");
  if (signature.length < 64 || signature.length > 144 || signature.toString("base64") !== bundle.signature) throw new Error("Acceptance evidence signature is malformed.");
  const { signature: _signature, ...signed } = bundle;
  if (!verify("sha256", Buffer.from(canonicalString(signed), "utf8"), anchor.publicKeyPem, signature)) throw new Error("Acceptance evidence signature is invalid.");
}

async function verifyArtifacts(bundle: SignedAcceptanceEvidenceBundle, root: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  let total = 0;
  for (const artifact of bundle.artifacts) {
    const candidate = resolve(canonicalRoot, artifact.path);
    if (!inside(canonicalRoot, candidate)) throw new Error("Acceptance evidence artifact escaped its package.");
    const file = await concreteFile(candidate, maximumArtifactBytes, "acceptance evidence artifact");
    const actualDigest = sha256(file.bytes);
    if (!inside(canonicalRoot, file.path) || file.bytes.byteLength !== artifact.bytes || actualDigest !== artifact.sha256) throw new Error(`Acceptance evidence artifact digest or size is invalid (${artifact.path}; ${file.bytes.byteLength}/${artifact.bytes}; ${actualDigest.slice(0, 12)}/${artifact.sha256.slice(0, 12)}).`);
    total += file.bytes.byteLength;
    if (total > maximumPackageBytes) throw new Error("Acceptance evidence package exceeds its total size bound.");
  }
  const expected = `sha256:${sha256Canonical(bundle.artifacts.map((item) => ({ path: item.path, sha256: item.sha256, bytes: item.bytes, mediaType: item.mediaType })))}`;
  if (!fixed(bundle.evidenceDigest, expected)) throw new Error("Acceptance evidence digest does not bind the exact artifact manifest.");
}

function parseTrustPolicy(bytes: Uint8Array, now: Date): AcceptanceTrustPolicy {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error("Acceptance trust policy is not JSON."); }
  return validateTrustPolicy(value, now);
}

function validateTrustPolicy(value: unknown, now: Date, allowExpired = false): AcceptanceTrustPolicy {
  if (!record(value) || !exact(value, ["schema", "version", "authorityId", "keyId", "publicKeyPem", "allowedGates", "expiresAt"]) || value.schema !== "sxsy-b122.acceptance-trust-policy" || value.version !== 1) throw new Error("Acceptance trust policy schema is invalid.");
  const publicKeyPem = boundedText(value.publicKeyPem, "acceptance public key", 16_384);
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Acceptance trust policy requires an ECDSA P-256 public key.");
  const derivedKeyId = sha256(key.export({ type: "spki", format: "der" }));
  if (!fixed(derivedKeyId, digest(value.keyId, "acceptance key id"))) throw new Error("Acceptance trust key id does not match the exact SPKI public key.");
  if (!Array.isArray(value.allowedGates) || value.allowedGates.length < 1 || value.allowedGates.length > 27) throw new Error("Acceptance trust policy gate allowlist is invalid.");
  const allowedGates = [...new Set(value.allowedGates.map(acceptanceGate))].sort((left, right) => left - right);
  if (allowedGates.length !== value.allowedGates.length) throw new Error("Acceptance trust policy contains duplicate gates.");
  const expiresAt = iso(value.expiresAt, "acceptance trust expiry");
  if (!allowExpired && Date.parse(expiresAt) <= now.getTime()) throw new Error("Acceptance trust policy is expired.");
  return { schema: "sxsy-b122.acceptance-trust-policy", version: 1, authorityId: identifier(value.authorityId, "acceptance authority id"), keyId: derivedKeyId, publicKeyPem, allowedGates, expiresAt };
}

function parseBundle(bytes: Uint8Array, now: Date): SignedAcceptanceEvidenceBundle {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error("Acceptance evidence bundle is not JSON."); }
  const keys = ["schema", "version", "id", "authorityId", "keyId", "gate", "status", "targetSnapshotId", "operationId", "evidenceDigest", "policyVersion", "evaluatedBy", "evaluatedAt", "expiresAt", "rationale", "artifacts", "signatureAlgorithm", "signature"];
  if (!record(value) || !exact(value, keys) || value.schema !== "sxsy-b122.acceptance-evidence-bundle" || value.version !== 1 || !["passed", "failed", "unavailable", "incomplete"].includes(String(value.status)) || value.signatureAlgorithm !== "ecdsa-p256-sha256") throw new Error("Acceptance evidence bundle schema is invalid.");
  const evaluatedAt = iso(value.evaluatedAt, "acceptance evaluation time");
  const evaluated = Date.parse(evaluatedAt);
  if (evaluated > now.getTime() + 5 * 60_000) throw new Error("Acceptance evidence is future-dated.");
  const expiresAt = iso(value.expiresAt, "acceptance evidence expiry");
  if (Date.parse(expiresAt) <= now.getTime() || Date.parse(expiresAt) <= evaluated || Date.parse(expiresAt) - evaluated > maximumEvidenceLifetimeMs) throw new Error("Acceptance evidence is expired or exceeds the maximum evidence lifetime.");
  if (!Array.isArray(value.artifacts) || value.artifacts.length < 1 || value.artifacts.length > 64) throw new Error("Acceptance evidence artifact manifest is invalid.");
  const artifacts = value.artifacts.map(parseArtifact);
  if (new Set(artifacts.map((item) => item.path.toLowerCase())).size !== artifacts.length) throw new Error("Acceptance evidence artifact paths are ambiguous.");
  return {
    schema: "sxsy-b122.acceptance-evidence-bundle", version: 1,
    id: identifier(value.id, "acceptance evidence id"), authorityId: identifier(value.authorityId, "acceptance authority id"), keyId: digest(value.keyId, "acceptance key id"),
    gate: acceptanceGate(value.gate), status: value.status as SignedAcceptanceEvidenceBundle["status"],
    targetSnapshotId: nullableIdentifier(value.targetSnapshotId, "acceptance target snapshot"), operationId: nullableIdentifier(value.operationId, "acceptance operation id"),
    evidenceDigest: prefixedDigest(value.evidenceDigest, "acceptance evidence digest"), policyVersion: boundedText(value.policyVersion, "acceptance policy version", 128), evaluatedBy: boundedText(value.evaluatedBy, "acceptance evaluator", 160),
    evaluatedAt, expiresAt, rationale: boundedText(value.rationale, "acceptance rationale", 2048), artifacts,
    signatureAlgorithm: "ecdsa-p256-sha256", signature: boundedText(value.signature, "acceptance signature", 512)
  };
}

function parseArtifact(value: unknown): AcceptanceEvidenceArtifact {
  if (!record(value) || !exact(value, ["path", "sha256", "bytes", "mediaType"]) || typeof value.path !== "string" || !safeRelative(value.path) || !Number.isSafeInteger(value.bytes) || (value.bytes as number) <= 0 || (value.bytes as number) > maximumArtifactBytes) throw new Error("Acceptance evidence artifact entry is invalid.");
  return { path: value.path.replaceAll("\\", "/"), sha256: digest(value.sha256, "artifact digest"), bytes: value.bytes as number, mediaType: boundedText(value.mediaType, "artifact media type", 128) };
}

function parseActivation(value: unknown): HighConsequenceActivation {
  const keys = ["id", "action", "targetSnapshotId", "policyVersion", "gateEvidenceIds", "activatedAt", "expiresAt", "activatedBy", "status"];
  if (!record(value) || !exact(value, keys) || value.status !== "active" || typeof value.action !== "string") throw new Error("Protected high-consequence activation is malformed.");
  const definition = commandForAction(value.action as CommandAction);
  if (!definition.highConsequence) throw new Error("Protected activation names a non-high-consequence action.");
  return { id: identifier(value.id, "activation id"), action: definition.action, targetSnapshotId: identifier(value.targetSnapshotId, "activation target"), policyVersion: boundedText(value.policyVersion, "activation policy", 128), gateEvidenceIds: uniqueIdentifiers(value.gateEvidenceIds, "gate evidence id"), activatedAt: iso(value.activatedAt, "activation time"), expiresAt: iso(value.expiresAt, "activation expiry"), activatedBy: boundedText(value.activatedBy, "activation operator", 160), status: "active" };
}

async function readBoundedRegularFile(path: string, maximum: number): Promise<Uint8Array> { return (await concreteFile(path, maximum, "selected file")).bytes; }

async function concreteFile(path: string, maximum: number, label: string): Promise<Readonly<{ path: string; bytes: Uint8Array }>> {
  if (!boundedAbsolute(path)) throw new Error(`${label} path must be fixed and absolute.`);
  const selected = resolve(path);
  const metadata = await lstat(selected);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maximum) throw new Error(`${label} is absent, linked, empty, or oversized.`);
  const canonical = await realpath(selected);
  const canonicalMetadata = await lstat(canonical);
  if (!canonicalMetadata.isFile() || canonicalMetadata.isSymbolicLink() || canonicalMetadata.size !== metadata.size) throw new Error(`${label} changed during validation.`);
  const bytes = await readFile(canonical);
  if (bytes.byteLength !== metadata.size) throw new Error(`${label} changed while being read.`);
  return { path: canonical, bytes };
}

function validFuture(value: string, now: Date, maximumMs: number, label: string): Date {
  const parsed = new Date(iso(value, label));
  if (parsed.getTime() <= now.getTime() || parsed.getTime() - now.getTime() > maximumMs) throw new Error(`${label} is expired or exceeds its maximum lifetime.`);
  return parsed;
}
function acceptanceGate(value: unknown): AcceptanceGate { if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 27) throw new Error("Acceptance gate must be 1 through 27."); return value as AcceptanceGate; }
function identifier(value: unknown, label: string): string { if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function nullableIdentifier(value: unknown, label: string): string | null { return value === null ? null : identifier(value, label); }
function uniqueIdentifiers(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.length > 27) throw new Error(`${label} list is invalid.`); const result = value.map((item) => identifier(item, label)); if (new Set(result).size !== result.length) throw new Error(`${label} list contains duplicates.`); return result; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(`${label} is invalid.`); return value.toLowerCase(); }
function prefixedDigest(value: unknown, label: string): string { if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is invalid.`); return value; }
function boundedText(value: unknown, label: string, maximum: number): string { if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\0]/.test(value)) throw new Error(`${label} is invalid.`); return value.trim(); }
function iso(value: unknown, label: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is not an ISO timestamp.`); return new Date(value).toISOString(); }
function safeRelative(value: string): boolean { return !!value && value.length <= 1024 && !isAbsolute(value) && !/[\0\r\n]/.test(value) && !value.replaceAll("\\", "/").split("/").some((part) => !part || part === "." || part === ".."); }
function boundedAbsolute(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\0\r\n]/.test(value) && isAbsolute(value); }
function inside(root: string, candidate: string): boolean { const rel = relative(resolve(root), resolve(candidate)); return rel === "" || !!rel && !rel.startsWith("..") && !isAbsolute(rel); }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function sha256Canonical(value: unknown): string { return sha256(canonicalString(value)); }
function canonicalString(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalString).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalString(item)}`).join(",")}}`; }
function fixed(left: string, right: string): boolean { if (left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0; }
