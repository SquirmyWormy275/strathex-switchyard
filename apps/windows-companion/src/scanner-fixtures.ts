/** Signed scanner/advisory fixture installation and freshness verification. */
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";

const trustInstallKind = "b122.scanner-trust.install.v1";
const trustRevokeKind = "b122.scanner-trust.revoke.v1";
const fixtureInstallKind = "b122.scanner-fixture.install.v1";
const fixtureRevokeKind = "b122.scanner-fixture.revoke.v1";
const maximumManifestBytes = 1024 * 1024;
const maximumContentBytes = 64 * 1024 * 1024;
const digestPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ScannerFixtureKind = "scanner" | "advisory";

export interface ScannerFixtureTrustPolicy {
  readonly schema: "sxsy-b122.scanner-fixture-trust";
  readonly version: 1;
  readonly authorityId: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly allowedKinds: readonly ScannerFixtureKind[];
  readonly expiresAt: string;
}

export interface SignedScannerFixtureManifest {
  readonly schema: "sxsy-b122.scanner-fixture";
  readonly version: 1;
  readonly id: string;
  readonly kind: ScannerFixtureKind;
  readonly authorityId: string;
  readonly keyId: string;
  readonly feedVersion: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly contentFile: string;
  readonly contentSha256: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly maximumAgeSeconds: number;
  readonly signatureAlgorithm: "ecdsa-p256-sha256";
  readonly signature: string;
}

export interface VerifiedScannerFixture {
  readonly id: string;
  readonly kind: ScannerFixtureKind;
  readonly authorityId: string;
  readonly keyId: string;
  readonly feedVersion: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly manifestSha256: string;
  readonly contentSha256: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
}

export interface ScannerFixtureResolver {
  resolve(input: Readonly<{ scannerFixtureIds: readonly string[]; advisoryFixtureIds: readonly string[]; observedAt: Date }>): Promise<readonly VerifiedScannerFixture[]>;
}

export interface InstalledScannerFixtureTrust extends ScannerFixtureTrustPolicy { readonly installedAt: string; readonly installedBy: string; readonly status: "active" | "revoked"; }
export interface InstalledScannerFixture { readonly id: string; readonly kind: ScannerFixtureKind; readonly packageRoot: string; readonly manifestSha256: string; readonly installedAt: string; readonly installedBy: string; readonly status: "active" | "revoked"; }

/**
 * Protected installed-state registry. Every resolve rehashes the copied files,
 * verifies the ECDSA signature, and enforces both absolute expiry and the
 * signed maximum-age SLA. A recipe-emitted ID alone is never trusted.
 */
export class DurableScannerFixtureRegistry implements ScannerFixtureResolver {
  private readonly packageRoot: string;
  constructor(private readonly store: ProtectedJsonStore, stateDirectory: string, private readonly now: () => Date = () => new Date()) {
    if (!boundedAbsolute(stateDirectory)) throw new Error("Scanner fixture state directory must be fixed and absolute.");
    this.packageRoot = resolve(stateDirectory, "scanner-fixtures");
  }

  async installTrust(policyInput: ScannerFixtureTrustPolicy, installedBy: string): Promise<InstalledScannerFixtureTrust> {
    const policy = validateTrust(policyInput, this.now());
    if ((await this.trust()).some((item) => item.authorityId === policy.authorityId && item.status === "active")) throw new Error("An active scanner-fixture authority already exists under that identity.");
    const entry = await this.store.append(trustInstallKind, { policy: policy as unknown as JsonValue, installedBy: bounded(installedBy, "scanner trust operator", 160) });
    return { ...policy, installedAt: entry.at, installedBy, status: "active" };
  }

  async revokeTrust(authorityId: string, keyId: string, reason: string, revokedBy: string): Promise<void> {
    const found = (await this.trust()).find((item) => item.authorityId === authorityId && item.keyId === keyId && item.status === "active");
    if (!found) throw new Error("The scanner-fixture authority is not active.");
    await this.store.append(trustRevokeKind, { authorityId: identifier(authorityId, "scanner authority"), keyId: digest(keyId, "scanner key"), reason: bounded(reason, "scanner trust revocation", 512), revokedBy: bounded(revokedBy, "scanner trust operator", 160) });
  }

  async installFixture(manifestPath: string, installedBy: string): Promise<InstalledScannerFixture> {
    const source = await concreteFile(manifestPath, maximumManifestBytes, "scanner fixture manifest");
    const manifest = parseManifest(source.bytes, this.now());
    const sourceRoot = dirname(source.path);
    const contentSource = await concreteFile(resolve(sourceRoot, manifest.contentFile), maximumContentBytes, "scanner fixture content");
    if (!inside(sourceRoot, contentSource.path)) throw new Error("Scanner fixture content resolves outside its signed package boundary.");
    await this.verifyManifest(manifest, source.bytes, sourceRoot, this.now(), contentSource.bytes);
    const destination = resolve(this.packageRoot, manifest.id);
    const staging = resolve(this.packageRoot, `.${manifest.id}.${randomUUID()}.tmp`);
    if (!inside(this.packageRoot, destination) || !inside(this.packageRoot, staging)) throw new Error("Scanner fixture identity escaped host state.");
    if ((await this.fixtures()).some((item) => item.id === manifest.id)) throw new Error("Scanner fixture identity is already installed and cannot be replaced in place.");
    await mkdir(this.packageRoot, { recursive: true });
    await mkdir(staging);
    try {
      await writeFile(resolve(staging, "manifest.json"), source.bytes, { flag: "wx" });
      await writeFile(resolve(staging, "content.bin"), contentSource.bytes, { flag: "wx" });
      await this.verifyInstalledAt(staging, this.now());
      await rename(staging, destination);
      const manifestSha256 = sha256(source.bytes);
      const entry = await this.store.append(fixtureInstallKind, { id: manifest.id, kind: manifest.kind, packageRoot: destination, manifestSha256, installedBy: bounded(installedBy, "scanner fixture operator", 160) });
      return { id: manifest.id, kind: manifest.kind, packageRoot: destination, manifestSha256, installedAt: entry.at, installedBy, status: "active" };
    } catch (error) {
      await Promise.all([rm(staging, { recursive: true, force: true }), rm(destination, { recursive: true, force: true })]);
      throw error;
    }
  }

  async revokeFixture(id: string, reason: string, revokedBy: string): Promise<void> {
    const found = (await this.fixtures()).find((item) => item.id === id && item.status === "active");
    if (!found) throw new Error("The scanner fixture is not active.");
    await this.store.append(fixtureRevokeKind, { id: identifier(id, "scanner fixture"), reason: bounded(reason, "scanner fixture revocation", 512), revokedBy: bounded(revokedBy, "scanner fixture operator", 160) });
  }

  async resolve(input: Readonly<{ scannerFixtureIds: readonly string[]; advisoryFixtureIds: readonly string[]; observedAt: Date }>): Promise<readonly VerifiedScannerFixture[]> {
    if (!Number.isFinite(input.observedAt.getTime())) throw new Error("Scanner fixture observation clock is invalid.");
    const requested = [
      ...uniqueIds(input.scannerFixtureIds).map((id) => ({ id, kind: "scanner" as const })),
      ...uniqueIds(input.advisoryFixtureIds).map((id) => ({ id, kind: "advisory" as const }))
    ];
    if (new Set(requested.map((item) => item.id)).size !== requested.length) throw new Error("A scanner fixture cannot be both scanner and advisory evidence.");
    const installed = await this.fixtures();
    const result: VerifiedScannerFixture[] = [];
    for (const request of requested) {
      const candidate = installed.find((item) => item.id === request.id && item.kind === request.kind && item.status === "active");
      if (!candidate) throw new Error(`Required ${request.kind} fixture ${request.id} is not actively installed.`);
      const verified = await this.verifyInstalledAt(candidate.packageRoot, input.observedAt);
      if (verified.id !== candidate.id || verified.kind !== candidate.kind || verified.manifestSha256 !== candidate.manifestSha256) throw new Error("Installed scanner fixture no longer matches its protected registry record.");
      result.push(verified);
    }
    return result;
  }

  private async verifyInstalledAt(root: string, observedAt: Date): Promise<VerifiedScannerFixture> {
    const canonicalRoot = await realpath(root);
    const manifestFile = await concreteFile(resolve(canonicalRoot, "manifest.json"), maximumManifestBytes, "installed scanner manifest");
    const manifest = parseManifest(manifestFile.bytes, observedAt);
    const content = await concreteFile(resolve(canonicalRoot, "content.bin"), maximumContentBytes, "installed scanner content");
    if (!inside(canonicalRoot, manifestFile.path) || !inside(canonicalRoot, content.path) || sha256(content.bytes) !== manifest.contentSha256) throw new Error("Installed scanner content digest is invalid.");
    await this.verifyManifest(manifest, manifestFile.bytes, canonicalRoot, observedAt, content.bytes);
    return { id: manifest.id, kind: manifest.kind, authorityId: manifest.authorityId, keyId: manifest.keyId, feedVersion: manifest.feedVersion, toolName: manifest.toolName, toolVersion: manifest.toolVersion, manifestSha256: sha256(manifestFile.bytes), contentSha256: manifest.contentSha256, generatedAt: manifest.generatedAt, expiresAt: manifest.expiresAt };
  }

  private async verifyManifest(manifest: SignedScannerFixtureManifest, bytes: Uint8Array, root: string, observedAt: Date, installedContent?: Uint8Array): Promise<void> {
    const authority = (await this.trust()).find((item) => item.authorityId === manifest.authorityId && item.keyId === manifest.keyId && item.status === "active");
    if (!authority || !authority.allowedKinds.includes(manifest.kind) || Date.parse(authority.expiresAt) <= observedAt.getTime()) throw new Error("Scanner fixture authority is unavailable, revoked, expired, or wrong-kind.");
    const { signature, ...signed } = manifest;
    const signatureBytes = Buffer.from(signature, "base64");
    if (signatureBytes.length < 64 || signatureBytes.length > 144 || signatureBytes.toString("base64") !== signature || !verify("sha256", Buffer.from(canonical(signed)), authority.publicKeyPem, signatureBytes)) throw new Error("Scanner fixture signature is invalid.");
    const content = installedContent ?? (await concreteFile(resolve(root, manifest.contentFile), maximumContentBytes, "scanner fixture content")).bytes;
    if (sha256(content) !== manifest.contentSha256) throw new Error("Scanner fixture content digest is invalid.");
    if (!digestPattern.test(sha256(bytes))) throw new Error("Scanner fixture manifest digest is invalid.");
  }

  async listTrust(): Promise<readonly InstalledScannerFixtureTrust[]> { return this.trust(); }
  async listFixtures(): Promise<readonly InstalledScannerFixture[]> { return this.fixtures(); }

  private async trust(): Promise<readonly InstalledScannerFixtureTrust[]> {
    const values = new Map<string, InstalledScannerFixtureTrust>();
    for (const entry of await this.store.readEntries<JsonValue>()) {
      const payload = entry.payload as unknown as Record<string, unknown>;
      if (entry.kind === trustInstallKind) {
        if (!record(payload) || !record(payload.policy) || typeof payload.installedBy !== "string") throw new Error("Protected scanner trust journal is malformed.");
        const policy = validateTrust(payload.policy, this.now(), true);
        values.set(`${policy.authorityId}:${policy.keyId}`, { ...policy, installedAt: entry.at, installedBy: payload.installedBy, status: "active" });
      } else if (entry.kind === trustRevokeKind) {
        if (!record(payload) || typeof payload.authorityId !== "string" || typeof payload.keyId !== "string") throw new Error("Protected scanner trust revocation is malformed.");
        const key = `${payload.authorityId}:${payload.keyId}`; const found = values.get(key); if (found) values.set(key, { ...found, status: "revoked" });
      }
    }
    return [...values.values()];
  }

  private async fixtures(): Promise<readonly InstalledScannerFixture[]> {
    const values = new Map<string, InstalledScannerFixture>();
    for (const entry of await this.store.readEntries<JsonValue>()) {
      const payload = entry.payload as unknown as Record<string, unknown>;
      if (entry.kind === fixtureInstallKind) {
        if (!record(payload) || typeof payload.id !== "string" || !kind(payload.kind) || typeof payload.packageRoot !== "string" || typeof payload.manifestSha256 !== "string" || typeof payload.installedBy !== "string") throw new Error("Protected scanner fixture journal is malformed.");
        values.set(payload.id, { id: identifier(payload.id, "scanner fixture"), kind: payload.kind, packageRoot: payload.packageRoot, manifestSha256: digest(payload.manifestSha256, "scanner manifest"), installedAt: entry.at, installedBy: payload.installedBy, status: "active" });
      } else if (entry.kind === fixtureRevokeKind) {
        if (!record(payload) || typeof payload.id !== "string") throw new Error("Protected scanner fixture revocation is malformed.");
        const found = values.get(payload.id); if (found) values.set(found.id, { ...found, status: "revoked" });
      }
    }
    return [...values.values()];
  }
}

export interface ScannerFixtureAdministration {
  installTrust(sourcePath: string): Promise<InstalledScannerFixtureTrust>;
  listTrust(): Promise<readonly InstalledScannerFixtureTrust[]>;
  revokeTrust(authorityId: string, keyId: string, reason: string): Promise<void>;
  installFixture(sourcePath: string): Promise<InstalledScannerFixture>;
  listFixtures(): Promise<readonly InstalledScannerFixture[]>;
  revokeFixture(id: string, reason: string): Promise<void>;
}

export function createScannerFixtureAdministration(options: Readonly<{ registry: DurableScannerFixtureRegistry; presence: WindowsUserPresenceRunner; now?: () => Date }>): ScannerFixtureAdministration {
  const operator = async (prompt: string): Promise<string> => { const result = await options.presence.verify(prompt); if (!result.verified || !result.operator?.trim()) throw new Error("Current-user presence did not approve scanner fixture administration."); return result.operator; };
  return {
    async installTrust(sourcePath: string) { const policy = parseTrust(await readBounded(sourcePath, maximumManifestBytes), (options.now ?? (() => new Date()))()); return options.registry.installTrust(policy, await operator(`Install scanner fixture authority ${policy.authorityId} for ${policy.allowedKinds.join(" and ")}.`)); },
    async listTrust() { return options.registry.listTrust(); },
    async revokeTrust(authorityId: string, keyId: string, reason: string) { return options.registry.revokeTrust(authorityId, keyId, reason, await operator(`Revoke scanner fixture authority ${authorityId}.`)); },
    async installFixture(sourcePath: string) { const bytes = await readBounded(sourcePath, maximumManifestBytes); const manifest = parseManifest(bytes, (options.now ?? (() => new Date()))()); return options.registry.installFixture(sourcePath, await operator(`Install signed ${manifest.kind} fixture ${manifest.id} until ${manifest.expiresAt}.`)); },
    async listFixtures() { return options.registry.listFixtures(); },
    async revokeFixture(id: string, reason: string) { return options.registry.revokeFixture(id, reason, await operator(`Revoke scanner fixture ${id}.`)); }
  };
}

function parseTrust(bytes: Uint8Array, now: Date): ScannerFixtureTrustPolicy { let value: unknown; try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error("Scanner fixture trust policy is not JSON."); } return validateTrust(value, now); }
function validateTrust(value: unknown, now: Date, allowExpired = false): ScannerFixtureTrustPolicy {
  if (!record(value) || !exact(value, ["schema", "version", "authorityId", "keyId", "publicKeyPem", "allowedKinds", "expiresAt"]) || value.schema !== "sxsy-b122.scanner-fixture-trust" || value.version !== 1 || !Array.isArray(value.allowedKinds) || value.allowedKinds.length < 1 || value.allowedKinds.length > 2 || !value.allowedKinds.every(kind)) throw new Error("Scanner fixture trust policy schema is invalid.");
  const publicKeyPem = bounded(value.publicKeyPem, "scanner public key", 16_384); const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Scanner fixture trust requires ECDSA P-256.");
  const keyId = sha256(key.export({ type: "spki", format: "der" })); if (keyId !== digest(value.keyId, "scanner key")) throw new Error("Scanner fixture trust key ID is invalid.");
  const expiresAt = time(value.expiresAt, "scanner trust expiry"); if (!allowExpired && Date.parse(expiresAt) <= now.getTime()) throw new Error("Scanner fixture trust policy is expired.");
  const allowedKinds = [...new Set(value.allowedKinds as ScannerFixtureKind[])].sort(); if (allowedKinds.length !== value.allowedKinds.length) throw new Error("Scanner fixture trust kinds contain duplicates.");
  return { schema: "sxsy-b122.scanner-fixture-trust", version: 1, authorityId: identifier(value.authorityId, "scanner authority"), keyId, publicKeyPem, allowedKinds, expiresAt };
}
function parseManifest(bytes: Uint8Array, observedAt: Date): SignedScannerFixtureManifest {
  let value: unknown; try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error("Scanner fixture manifest is not JSON."); }
  const keys = ["schema", "version", "id", "kind", "authorityId", "keyId", "feedVersion", "toolName", "toolVersion", "contentFile", "contentSha256", "generatedAt", "expiresAt", "maximumAgeSeconds", "signatureAlgorithm", "signature"];
  if (!record(value) || !exact(value, keys) || value.schema !== "sxsy-b122.scanner-fixture" || value.version !== 1 || !kind(value.kind) || value.signatureAlgorithm !== "ecdsa-p256-sha256" || !Number.isSafeInteger(value.maximumAgeSeconds) || (value.maximumAgeSeconds as number) < 60 || (value.maximumAgeSeconds as number) > 31 * 24 * 60 * 60) throw new Error("Scanner fixture manifest schema is invalid.");
  const generatedAt = time(value.generatedAt, "scanner fixture generation"); const expiresAt = time(value.expiresAt, "scanner fixture expiry"); const generated = Date.parse(generatedAt); const expires = Date.parse(expiresAt);
  if (generated > observedAt.getTime() + 5 * 60_000 || expires <= observedAt.getTime() || expires <= generated || observedAt.getTime() - generated > (value.maximumAgeSeconds as number) * 1000) throw new Error("Scanner fixture is future-dated, expired, or outside its signed freshness SLA.");
  return { schema: "sxsy-b122.scanner-fixture", version: 1, id: identifier(value.id, "scanner fixture"), kind: value.kind, authorityId: identifier(value.authorityId, "scanner authority"), keyId: digest(value.keyId, "scanner key"), feedVersion: bounded(value.feedVersion, "feed version", 128), toolName: bounded(value.toolName, "scanner tool", 128), toolVersion: bounded(value.toolVersion, "scanner tool version", 128), contentFile: safeRelative(value.contentFile), contentSha256: digest(value.contentSha256, "scanner content"), generatedAt, expiresAt, maximumAgeSeconds: value.maximumAgeSeconds as number, signatureAlgorithm: "ecdsa-p256-sha256", signature: bounded(value.signature, "scanner signature", 512) };
}

async function concreteFile(path: string, maximum: number, label: string): Promise<Readonly<{ path: string; bytes: Uint8Array }>> { if (!boundedAbsolute(path)) throw new Error(`${label} path must be absolute.`); const selected = resolve(path); const info = await lstat(selected); if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maximum) throw new Error(`${label} is absent, linked, empty, or oversized.`); const canonicalPath = await realpath(selected); const bytes = await readFile(canonicalPath); if (bytes.byteLength !== info.size) throw new Error(`${label} changed while being read.`); return { path: canonicalPath, bytes }; }
async function readBounded(path: string, maximum: number): Promise<Uint8Array> { return (await concreteFile(path, maximum, "selected scanner file")).bytes; }
function kind(value: unknown): value is ScannerFixtureKind { return value === "scanner" || value === "advisory"; }
function uniqueIds(value: readonly string[]): readonly string[] { if (!Array.isArray(value) || value.length > 32) throw new Error("Scanner fixture ID list is unbounded."); const result = value.map((item) => identifier(item, "scanner fixture")); if (new Set(result).size !== result.length) throw new Error("Scanner fixture ID list contains duplicates."); return result; }
function identifier(value: unknown, label: string): string { if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function bounded(value: unknown, label: string, maximum: number): string { if (typeof value !== "string" || !value.trim() || value.length > maximum || /\0/.test(value)) throw new Error(`${label} is invalid.`); return value.trim(); }
function time(value: unknown, label: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`); return new Date(value).toISOString(); }
function safeRelative(value: unknown): string { if (typeof value !== "string" || !value || value.length > 1024 || isAbsolute(value) || /[\0\r\n]/.test(value) || value.replaceAll("\\", "/").split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Scanner fixture content path is invalid."); return value; }
function boundedAbsolute(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\0\r\n]/.test(value) && isAbsolute(value); }
function inside(root: string, candidate: string): boolean { const item = relative(resolve(root), resolve(candidate)); return item === "" || !!item && !item.startsWith("..") && !isAbsolute(item); }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; }
