import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { CommandDefinition } from "../../../packages/control-plane/src/command-catalog.ts";
import type { CommandResult, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { ExecutionRequest } from "../../../packages/control-plane/src/brokers.ts";
import type { DispatchReceiptEvidence, DispatchReceiptEvidenceFactory } from "../../../packages/control-plane/src/dispatch.ts";
import { stableJson } from "../../../packages/control-plane/src/store.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import type { UserSecretProtector } from "./windows-secret.ts";
import {
  verifyRepositoryRecipeEvidence,
  type RepositoryRecipeEvidenceBinding,
  type RepositoryRecipeEvidenceEnvelope
} from "./repository-runtime-broker.ts";

const schema = "sxsy-b122.host-receipt-evidence" as const;
const version = 1 as const;
const maximumLifetimeMs = 10 * 60_000;
const maximumClockSkewMs = 5_000;

export type TrustedEvidenceProducer = "repository-runtime" | "scanner";
export type TrustedEvidenceOutcome = "passed" | "incomplete";

export interface RepositoryRuntimeEvidence {
  readonly recipeEvidenceSha256: string;
  readonly manifestSha256: string;
  readonly helperSha256: string;
  readonly helperVersion: string;
  readonly resultSha256: string;
  readonly outputSha256: string;
  readonly toolVersions: Readonly<Record<string, string>>;
}

export interface ScannerEvidence {
  readonly scannerFeedSha256: string;
  readonly findingCount: number;
}

export interface HostReceiptEvidenceEnvelope {
  readonly schema: typeof schema;
  readonly version: typeof version;
  readonly producer: TrustedEvidenceProducer;
  readonly action: string;
  readonly operationId: string;
  readonly targetSnapshotId: string;
  readonly targetDigest: string;
  readonly targetCompleteness: TargetSnapshot["completeness"];
  readonly outcome: TrustedEvidenceOutcome;
  readonly completeness: "complete" | "incomplete";
  readonly policyVersion: string;
  readonly exactVersions: Readonly<Record<string, string>>;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly evidence: RepositoryRuntimeEvidence | ScannerEvidence;
  readonly evidenceDigest: string;
  readonly authenticationTag: string;
}

type TrustedIssueInput = Readonly<{
  producer: "repository-runtime";
  action: string;
  operationId: string;
  target: TargetSnapshot;
  outcome: TrustedEvidenceOutcome;
  completeness: "complete" | "incomplete";
  observedAt: string;
  expiresAt: string;
  evidence: RepositoryRuntimeEvidence;
}> | Readonly<{
  producer: "scanner";
  action: string;
  operationId: string;
  target: TargetSnapshot;
  outcome: TrustedEvidenceOutcome;
  completeness: "complete" | "incomplete";
  observedAt: string;
  expiresAt: string;
  evidence: ScannerEvidence;
}>;

export interface HostReceiptEvidenceIssuer {
  issue(input: Extract<TrustedIssueInput, { readonly producer: "scanner" }>): HostReceiptEvidenceEnvelope;
  issueRepositoryRecipeEvidence(envelope: RepositoryRecipeEvidenceEnvelope, request: ExecutionRequest, binding: RepositoryRecipeEvidenceBinding): HostReceiptEvidenceEnvelope;
}

export interface HostReceiptEvidenceFactoryOptions {
  readonly authenticationKey: Uint8Array;
  readonly policyVersion: string;
  /** Exact installed tool and helper identities included in every receipt. */
  readonly exactVersions: Readonly<Record<string, string>>;
  readonly clock?: () => Date;
}

/**
 * Host-only issuer/verifier. Workspace, provider, and bridge payloads never
 * receive the authentication key. A result earns receipt metadata only when
 * its typed envelope verifies against the exact live dispatch binding.
 */
export class HostReceiptEvidenceFactory implements DispatchReceiptEvidenceFactory, HostReceiptEvidenceIssuer {
  private readonly key: Buffer;
  private readonly policyVersion: string;
  private readonly exactVersions: Readonly<Record<string, string>>;
  private readonly clock: () => Date;

  constructor(options: HostReceiptEvidenceFactoryOptions) {
    this.key = Buffer.from(options.authenticationKey);
    if (this.key.byteLength !== 32) throw new Error("Receipt evidence requires an exact 256-bit host key.");
    this.policyVersion = bounded(options.policyVersion, "receipt policy version");
    this.exactVersions = Object.freeze(versions(options.exactVersions));
    this.clock = options.clock ?? (() => new Date());
  }

  issue(input: Extract<TrustedIssueInput, { readonly producer: "scanner" }>): HostReceiptEvidenceEnvelope {
    return this.issueTrusted(input);
  }

  issueRepositoryRecipeEvidence(envelope: RepositoryRecipeEvidenceEnvelope, request: ExecutionRequest, binding: RepositoryRecipeEvidenceBinding): HostReceiptEvidenceEnvelope {
    const verified = verifyRepositoryRecipeEvidence(envelope, request, binding, this.clock().getTime());
    if (!verified.valid) throw new Error(`Repository recipe evidence was rejected: ${verified.reason}`);
    if (envelope.outcome === "failed") throw new Error("Repository recipe evidence for a failed runtime cannot issue a receipt.");
    return this.issueTrusted({
      producer: "repository-runtime",
      action: request.action,
      operationId: request.operationId,
      target: request.target,
      outcome: envelope.outcome,
      completeness: envelope.completeness,
      observedAt: envelope.createdAt,
      expiresAt: envelope.expiresAt,
      evidence: {
        recipeEvidenceSha256: envelope.evidenceSha256,
        manifestSha256: envelope.manifestSha256,
        helperSha256: envelope.helperSha256,
        helperVersion: envelope.helperVersion,
        resultSha256: envelope.resultSha256,
        outputSha256: envelope.output.sha256,
        toolVersions: envelope.toolVersions
      }
    });
  }

  private issueTrusted(input: TrustedIssueInput): HostReceiptEvidenceEnvelope {
    if (input.producer !== "repository-runtime" && input.producer !== "scanner") throw new Error("Receipt evidence producer is not trusted.");
    if (input.outcome !== "passed" && input.outcome !== "incomplete") throw new Error("Receipt evidence outcome is invalid.");
    if (input.completeness !== "complete" && input.completeness !== "incomplete") throw new Error("Receipt evidence completeness is invalid.");
    validateBinding(input.action, input.operationId);
    validateTimes(input.observedAt, input.expiresAt, this.clock());
    if (!exactTargetIdentity(input.target)) throw new Error("Receipt evidence target identity is not canonical.");
    if (input.target.policyVersion !== this.policyVersion) throw new Error("Receipt evidence target policy does not match the installed policy.");
    if (input.outcome === "passed" && (input.completeness !== "complete" || input.target.completeness !== "complete")) {
      throw new Error("Passing receipt evidence requires a complete exact target and complete observation.");
    }
    if (input.outcome === "incomplete" && input.completeness !== "incomplete") throw new Error("Incomplete evidence must be marked incomplete.");
    const evidence = evidenceFor(input.producer, input.evidence);
    const unsigned = {
      schema, version, producer: input.producer, action: input.action, operationId: input.operationId,
      targetSnapshotId: input.target.id, targetDigest: digest(stableJson(input.target)), targetCompleteness: input.target.completeness,
      outcome: input.outcome, completeness: input.completeness, policyVersion: this.policyVersion,
      exactVersions: this.exactVersions, observedAt: input.observedAt, expiresAt: input.expiresAt, evidence
    } as const;
    const evidenceDigest = digest(stableJson(unsigned));
    return { ...unsigned, evidenceDigest, authenticationTag: this.authenticate(evidenceDigest) };
  }

  forResult(definition: CommandDefinition, result: CommandResult, target: TargetSnapshot | undefined): DispatchReceiptEvidence | undefined {
    const candidate = result.data?.receiptEvidenceEnvelope;
    if (!target || !result.operationId || !isEnvelope(candidate) || !exactTargetIdentity(target)) return undefined;
    try {
      validateBinding(candidate.action, candidate.operationId);
      validateTimes(candidate.observedAt, candidate.expiresAt, this.clock());
      if (candidate.action !== definition.action || candidate.operationId !== result.operationId || candidate.targetSnapshotId !== target.id) return undefined;
      if (candidate.targetDigest !== digest(stableJson(target)) || candidate.targetCompleteness !== target.completeness) return undefined;
      if (candidate.policyVersion !== this.policyVersion || target.policyVersion !== this.policyVersion) return undefined;
      if (stableJson(candidate.exactVersions) !== stableJson(this.exactVersions)) return undefined;
      if (candidate.outcome === "passed" && (result.status !== "completed" || candidate.completeness !== "complete" || target.completeness !== "complete")) return undefined;
      if (candidate.outcome === "incomplete" && (result.status !== "incomplete" || candidate.completeness !== "incomplete")) return undefined;
      evidenceFor(candidate.producer, candidate.evidence);
      const unsigned = withoutAuthentication(candidate);
      const expectedDigest = digest(stableJson(unsigned));
      if (!constantEqual(candidate.evidenceDigest, expectedDigest) || !constantEqual(candidate.authenticationTag, this.authenticate(expectedDigest))) return undefined;
      return { policyVersion: this.policyVersion, evidenceDigest: expectedDigest, toolVersions: this.exactVersions, expiresAt: candidate.expiresAt };
    } catch {
      return undefined;
    }
  }

  private authenticate(evidenceDigest: string): string {
    return createHmac("sha256", this.key).update(evidenceDigest, "utf8").digest("hex");
  }
}

export interface InstalledHostReceiptEvidenceFactoryOptions {
  readonly filePath: string;
  readonly protector: UserSecretProtector;
  readonly policyVersion: string;
  readonly exactVersions: Readonly<Record<string, string>>;
  readonly clock?: () => Date;
}

/** Loads one DPAPI/current-user-sealed host key; only an absent file may create it. */
export async function loadOrCreateHostReceiptEvidenceFactory(options: InstalledHostReceiptEvidenceFactoryOptions): Promise<HostReceiptEvidenceFactory> {
  if (!isAbsolute(options.filePath) || /[\0\r\n]/.test(options.filePath)) throw new Error("The receipt evidence key path must be a fixed absolute host path.");
  const filePath = resolve(options.filePath);
  let key: Buffer;
  try {
    key = Buffer.from(await options.protector.open(await readSealedKey(filePath, options.protector.provider)));
  } catch (error) {
    if (!missing(error)) throw new Error("The installed receipt evidence key could not be opened or verified.");
    key = randomBytes(32);
    const sealedKey = await options.protector.seal(key);
    validateSealed(sealedKey);
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify({ schema: "sxsy-b122.receipt-evidence-key", version: 1, protector: options.protector.provider, sealedKey })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, filePath);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  try {
    if (key.byteLength !== 32) throw new Error("The installed receipt evidence key has the wrong length.");
    return new HostReceiptEvidenceFactory({
      authenticationKey: key,
      policyVersion: options.policyVersion,
      exactVersions: options.exactVersions,
      ...(options.clock ? { clock: options.clock } : {})
    });
  } finally { key.fill(0); }
}

async function readSealedKey(filePath: string, expectedProtector: string): Promise<string> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > 64 * 1024) throw new Error("The installed receipt evidence key record is not a bounded regular file.");
  let value: unknown;
  try { value = JSON.parse(await readFile(filePath, "utf8")); }
  catch { throw new Error("The installed receipt evidence key record is malformed."); }
  if (!plain(value) || !exact(value, ["schema", "version", "protector", "sealedKey"])
    || value.schema !== "sxsy-b122.receipt-evidence-key" || value.version !== 1
    || value.protector !== expectedProtector || typeof value.sealedKey !== "string") {
    throw new Error("The installed receipt evidence key record is malformed or belongs to another protector.");
  }
  return validateSealed(value.sealedKey);
}

function validateSealed(value: string): string {
  if (!value || value.length > 60 * 1024 || /[\0\r\n]/.test(value)) throw new Error("The installed receipt evidence key envelope is malformed.");
  return value;
}

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function withoutAuthentication(value: HostReceiptEvidenceEnvelope): Omit<HostReceiptEvidenceEnvelope, "evidenceDigest" | "authenticationTag"> {
  const { evidenceDigest: _evidenceDigest, authenticationTag: _authenticationTag, ...unsigned } = value;
  return unsigned;
}

function evidenceFor(producer: TrustedEvidenceProducer, value: unknown): RepositoryRuntimeEvidence | ScannerEvidence {
  if (!plain(value)) throw new Error("Receipt evidence must be a plain typed record.");
  if (producer === "repository-runtime") {
    if (!exact(value, ["recipeEvidenceSha256", "manifestSha256", "helperSha256", "helperVersion", "resultSha256", "outputSha256", "toolVersions"])
      || !sha(value.recipeEvidenceSha256) || !sha(value.manifestSha256) || !sha(value.helperSha256) || !sha(value.resultSha256) || !sha(value.outputSha256)
      || typeof value.helperVersion !== "string" || !value.helperVersion.trim() || !plain(value.toolVersions)) throw new Error("Repository runtime receipt evidence is malformed.");
    return {
      recipeEvidenceSha256: value.recipeEvidenceSha256,
      manifestSha256: value.manifestSha256,
      helperSha256: value.helperSha256,
      helperVersion: bounded(value.helperVersion, "repository helper version"),
      resultSha256: value.resultSha256,
      outputSha256: value.outputSha256,
      toolVersions: versions(value.toolVersions as Record<string, string>)
    };
  }
  if (!exact(value, ["scannerFeedSha256", "findingCount"]) || !sha(value.scannerFeedSha256)
    || typeof value.findingCount !== "number" || !Number.isSafeInteger(value.findingCount) || value.findingCount < 0) throw new Error("Scanner receipt evidence is malformed.");
  return { scannerFeedSha256: value.scannerFeedSha256, findingCount: value.findingCount };
}

function validateBinding(action: string, operationId: string): void {
  bounded(action, "receipt action"); bounded(operationId, "receipt operation");
}

function exactTargetIdentity(target: TargetSnapshot): boolean {
  const { id, capturedAt: _capturedAt, ...identity } = target;
  return id === targetSnapshotDigest(identity);
}

function validateTimes(observedAt: string, expiresAt: string, now: Date): void {
  const observed = Date.parse(observedAt); const expires = Date.parse(expiresAt); const current = now.getTime();
  if (!Number.isFinite(observed) || !Number.isFinite(expires)) throw new Error("Receipt evidence timestamps are invalid.");
  if (observed > current + maximumClockSkewMs || expires <= current || expires <= observed || expires - observed > maximumLifetimeMs) {
    throw new Error("Receipt evidence is stale, future-dated, or exceeds its fixed lifetime.");
  }
}

function versions(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  if (!plain(value) || Object.keys(value).length < 1 || Object.keys(value).length > 32) throw new Error("Receipt evidence requires exact installed versions.");
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([name, identity]) => [bounded(name, "version name"), bounded(identity, "version identity")]));
}

function isEnvelope(value: unknown): value is HostReceiptEvidenceEnvelope {
  if (!plain(value) || !exact(value, ["schema", "version", "producer", "action", "operationId", "targetSnapshotId", "targetDigest", "targetCompleteness", "outcome", "completeness", "policyVersion", "exactVersions", "observedAt", "expiresAt", "evidence", "evidenceDigest", "authenticationTag"])) return false;
  return value.schema === schema && value.version === version && (value.producer === "repository-runtime" || value.producer === "scanner")
    && typeof value.action === "string" && typeof value.operationId === "string" && typeof value.targetSnapshotId === "string"
    && sha(value.targetDigest) && (value.targetCompleteness === "complete" || value.targetCompleteness === "incomplete")
    && (value.outcome === "passed" || value.outcome === "incomplete") && (value.completeness === "complete" || value.completeness === "incomplete")
    && typeof value.policyVersion === "string" && plain(value.exactVersions) && typeof value.observedAt === "string" && typeof value.expiresAt === "string"
    && plain(value.evidence) && sha(value.evidenceDigest) && sha(value.authenticationTag);
}

function bounded(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\0\r\n]/.test(value)) throw new Error(`${field} is invalid.`);
  return value;
}
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
function plain(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function constantEqual(left: string, right: string): boolean { const a = Buffer.from(left, "utf8"); const b = Buffer.from(right, "utf8"); return a.length === b.length && timingSafeEqual(a, b); }
