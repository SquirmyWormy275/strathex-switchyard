import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { BrokerOutcome, IsolationRequest, IsolationRuntime, PermitVerifier } from "../../../packages/control-plane/src/brokers.ts";
import type { JournalEntry, JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";
import {
  WindowsSandboxBackend,
  WindowsSandboxIsolationRuntime,
  type WindowsSandboxEffectGuard
} from "./windows-sandbox.ts";

const installKind = "b122.windows-sandbox.install.v1";
const revokeKind = "b122.windows-sandbox.revoke.v1";
const maximumCatalogBytes = 256 * 1024;

export interface SandboxInstallationPin {
  readonly canonicalRepositoryRoot: string;
  readonly catalogPath: string;
  readonly catalogSha256: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly installedAt: string;
  readonly status: "active" | "revoked";
}

export interface SandboxInstallationCoordinator {
  install(input: Readonly<{ repositoryRoot: string; catalogPath: string }>): Promise<SandboxInstallationPin>;
  revoke(repositoryRoot: string): Promise<SandboxInstallationPin>;
  list(): Promise<readonly SandboxInstallationPin[]>;
}

interface InstallPayload extends Record<string, JsonValue> {
  readonly canonicalRepositoryRoot: string;
  readonly catalogPath: string;
  readonly catalogSha256: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly attestedAt: string;
}

interface RevokePayload extends Record<string, JsonValue> {
  readonly canonicalRepositoryRoot: string;
  readonly attestedAt: string;
}

export class DurableSandboxInstallationRegistry {
  private readonly store: ProtectedJsonStore;
  private readonly configuredHelperPath: string;
  private readonly now: () => string;

  constructor(store: ProtectedJsonStore, helperPath: string, now: () => string = () => new Date().toISOString()) {
    if (!boundedAbsolute(helperPath)) throw new Error("Windows Sandbox requires a fixed absolute guest-helper path.");
    this.store = store;
    this.configuredHelperPath = resolve(helperPath);
    this.now = now;
  }

  async install(input: Readonly<{ repositoryRoot: string; catalogPath: string; catalogSha256: string; helperSha256: string; attestedAt: string }>): Promise<SandboxInstallationPin> {
    this.assertAttestation(input.attestedAt);
    const verified = await this.verify({
      canonicalRepositoryRoot: input.repositoryRoot,
      catalogPath: input.catalogPath,
      catalogSha256: input.catalogSha256,
      helperPath: this.configuredHelperPath,
      helperSha256: input.helperSha256
    });
    const entry = await this.store.append(installKind, { ...verified, attestedAt: input.attestedAt });
    return { ...verified, installedAt: entry.at, status: "active" };
  }

  async revoke(repositoryRoot: string, attestedAt: string): Promise<SandboxInstallationPin> {
    this.assertAttestation(attestedAt);
    const canonicalRepositoryRoot = await realpath(repositoryRoot);
    const current = (await this.state()).get(pathKey(canonicalRepositoryRoot));
    if (!current || current.status !== "active") throw new Error("No active Windows Sandbox installation exists for the selected repository.");
    const entry = await this.store.append(revokeKind, { canonicalRepositoryRoot, attestedAt });
    return { ...current, installedAt: entry.at, status: "revoked" };
  }

  async resolve(repositoryRoot: string): Promise<SandboxInstallationPin> {
    const canonicalRepositoryRoot = await realpath(repositoryRoot);
    const pin = (await this.state()).get(pathKey(canonicalRepositoryRoot));
    if (!pin || pin.status !== "active") throw new Error("No active host-attested Windows Sandbox installation exists for this repository.");
    const verified = await this.verify(pin);
    return { ...verified, installedAt: pin.installedAt, status: "active" };
  }

  async list(): Promise<readonly SandboxInstallationPin[]> { return [...(await this.state()).values()]; }

  private async verify(input: Readonly<{ canonicalRepositoryRoot: string; catalogPath: string; catalogSha256: string; helperPath: string; helperSha256: string }>) {
    if (!digest(input.catalogSha256) || !digest(input.helperSha256)) throw new Error("Windows Sandbox installation digests are invalid.");
    const canonicalRepositoryRoot = await realpath(input.canonicalRepositoryRoot);
    const catalogPath = await realpath(input.catalogPath);
    const helperPath = await realpath(input.helperPath);
    const configuredHelperPath = await realpath(this.configuredHelperPath);
    if (!samePath(helperPath, configuredHelperPath)) throw new Error("The installed Windows Sandbox helper does not match the fixed host helper path.");
    if (!inside(canonicalRepositoryRoot, catalogPath) || samePath(canonicalRepositoryRoot, catalogPath)) throw new Error("The Windows Sandbox catalog must be a regular file inside the selected repository.");
    const [catalogStat, helperStat] = await Promise.all([stat(catalogPath), stat(helperPath)]);
    if (!catalogStat.isFile() || catalogStat.size <= 0 || catalogStat.size > maximumCatalogBytes) throw new Error("The Windows Sandbox catalog is not a bounded regular file.");
    if (!helperStat.isFile() || helperStat.size <= 0 || helperStat.size > 256 * 1024 * 1024 || basename(helperPath).toLowerCase() !== "b122-sandbox-worker.exe") throw new Error("The fixed Windows Sandbox helper is invalid.");
    const [catalogBytes, helperBytes] = await Promise.all([readFile(catalogPath), readFile(helperPath)]);
    if (sha256(catalogBytes) !== input.catalogSha256.toLowerCase()) throw new Error("The Windows Sandbox catalog changed after host attestation.");
    if (sha256(helperBytes) !== input.helperSha256.toLowerCase()) throw new Error("The Windows Sandbox helper changed after host attestation.");
    validateCatalog(catalogBytes);
    return { canonicalRepositoryRoot, catalogPath, catalogSha256: input.catalogSha256.toLowerCase(), helperPath, helperSha256: input.helperSha256.toLowerCase() };
  }

  private async state(): Promise<Map<string, SandboxInstallationPin>> {
    const pins = new Map<string, SandboxInstallationPin>();
    for (const entry of await this.store.readEntries<JsonValue>()) this.apply(entry, pins);
    return pins;
  }

  private apply(entry: JournalEntry<JsonValue>, pins: Map<string, SandboxInstallationPin>): void {
    if (entry.kind === installKind) {
      const value = parseInstall(entry.payload);
      pins.set(pathKey(value.canonicalRepositoryRoot), { ...value, installedAt: entry.at, status: "active" });
    } else if (entry.kind === revokeKind) {
      const value = parseRevoke(entry.payload);
      const current = pins.get(pathKey(value.canonicalRepositoryRoot));
      if (current) pins.set(pathKey(value.canonicalRepositoryRoot), { ...current, installedAt: entry.at, status: "revoked" });
    }
  }

  private assertAttestation(value: string): void {
    const attested = Date.parse(value);
    const current = Date.parse(this.now());
    if (!Number.isFinite(attested) || Math.abs(current - attested) > 5 * 60_000) throw new Error("Windows Sandbox installation user-presence attestation is missing, stale, or future-dated.");
  }
}

export class AttestedSandboxInstallationCoordinator implements SandboxInstallationCoordinator {
  private readonly registry: DurableSandboxInstallationRegistry;
  private readonly helperPath: string;
  private readonly presence: WindowsUserPresenceRunner;
  private readonly now: () => Date;
  constructor(
    registry: DurableSandboxInstallationRegistry,
    helperPath: string,
    presence: WindowsUserPresenceRunner,
    now: () => Date = () => new Date()
  ) { this.registry = registry; this.helperPath = helperPath; this.presence = presence; this.now = now; }

  async install(input: Readonly<{ repositoryRoot: string; catalogPath: string }>): Promise<SandboxInstallationPin> {
    if (!boundedAbsolute(input.repositoryRoot) || !boundedAbsolute(input.catalogPath)) throw new Error("Windows Sandbox installation requires bounded absolute host paths.");
    const [catalog, helper] = await Promise.all([readFile(input.catalogPath), readFile(this.helperPath)]);
    if (!catalog.length || catalog.length > maximumCatalogBytes || !helper.length || helper.length > 256 * 1024 * 1024) throw new Error("Windows Sandbox installation inputs are outside their bounds.");
    validateCatalog(catalog);
    const approved = await this.presence.verify("Approve this exact SXSY-B122 Windows Sandbox recipe catalog and fixed guest helper for the selected Git root.");
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve Windows Sandbox installation.");
    return this.registry.install({ repositoryRoot: input.repositoryRoot, catalogPath: input.catalogPath, catalogSha256: sha256(catalog), helperSha256: sha256(helper), attestedAt: this.now().toISOString() });
  }

  async revoke(repositoryRoot: string): Promise<SandboxInstallationPin> {
    if (!boundedAbsolute(repositoryRoot)) throw new Error("Windows Sandbox revocation requires a bounded absolute repository path.");
    const approved = await this.presence.verify("Revoke the SXSY-B122 Windows Sandbox catalog and helper pin for the selected Git root.");
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve Windows Sandbox revocation.");
    return this.registry.revoke(repositoryRoot, this.now().toISOString());
  }

  list(): Promise<readonly SandboxInstallationPin[]> { return this.registry.list(); }
}

/** Resolves the exact current pin on every dispatch, then constructs the concrete OS boundary. */
export class InstalledWindowsSandboxIsolationRuntime implements IsolationRuntime {
  private readonly registry: DurableSandboxInstallationRegistry;
  private readonly stateDirectory: string;
  private readonly permitVerifier: PermitVerifier;
  constructor(
    registry: DurableSandboxInstallationRegistry,
    stateDirectory: string,
    permitVerifier: PermitVerifier
  ) { this.registry = registry; this.stateDirectory = stateDirectory; this.permitVerifier = permitVerifier; }

  async start(request: IsolationRequest): Promise<BrokerOutcome> {
    return this.runRecipe(request, request.profile);
  }

  async runRecipe(request: IsolationRequest, recipeId: string): Promise<BrokerOutcome> {
    let pin: SandboxInstallationPin;
    try { pin = await this.registry.resolve(request.target.repositoryRoot); }
    catch { return { status: "unavailable", summary: "No unchanged current-user-attested Windows Sandbox installation is available for the exact target." }; }
    const targetKey = sha256(pin.canonicalRepositoryRoot).slice(0, 24);
    const sandboxState = join(this.stateDirectory, "windows-sandbox", targetKey);
    const destinationRoot = join(sandboxState, "validated-results");
    await Promise.all([mkdir(sandboxState, { recursive: true }), mkdir(destinationRoot, { recursive: true })]);
    const catalogRelativePath = relative(pin.canonicalRepositoryRoot, pin.catalogPath).replaceAll("\\", "/");
    const denyFallback: WindowsSandboxEffectGuard = { async check() { return { allowed: false, reason: "No dispatch-bound final effect guard is available." }; } };
    const backend = new WindowsSandboxBackend({
      allowedTaskRoots: [pin.canonicalRepositoryRoot, this.stateDirectory, dirname(pin.helperPath)],
      stateRoot: sandboxState,
      helperDirectory: dirname(pin.helperPath),
      helperFilename: basename(pin.helperPath),
      jobManifestRelativePath: catalogRelativePath,
      defaultDestinationRoot: destinationRoot,
      effectGuard: denyFallback
    });
    return new WindowsSandboxIsolationRuntime(backend, {
      destinationRoot,
      permitVerifier: this.permitVerifier,
      recipeCatalogDigest: pin.catalogSha256,
      helperDigest: pin.helperSha256
    }).executeRecipe(request, recipeId);
  }
}

function validateCatalog(bytes: Uint8Array): void {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error("Windows Sandbox catalog is not valid JSON."); }
  if (!record(value) || !exact(value, ["schema", "version", "recipes"]) || value.schema !== "sxsy-b122.windows-sandbox-catalog" || value.version !== 1 || !Array.isArray(value.recipes) || value.recipes.length < 1 || value.recipes.length > 32) {
    throw new Error("Windows Sandbox catalog does not use the exact bounded v1 schema.");
  }
  const ids = new Set<string>();
  for (const recipe of value.recipes) {
    if (!record(recipe) || !exact(recipe, ["id", "executable", "executableSha256", "arguments", "workingRoot", "workingDirectory", "environment", "timeoutMs", "maxOutputBytes", "artifacts"])
      || typeof recipe.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(recipe.id) || ids.has(recipe.id)) throw new Error("Windows Sandbox catalog contains an invalid or duplicate recipe.");
    ids.add(recipe.id);
  }
}

function parseInstall(value: JsonValue): InstallPayload {
  if (!record(value) || typeof value.canonicalRepositoryRoot !== "string" || typeof value.catalogPath !== "string" || typeof value.catalogSha256 !== "string" || typeof value.helperPath !== "string" || typeof value.helperSha256 !== "string" || typeof value.attestedAt !== "string" || !digest(value.catalogSha256) || !digest(value.helperSha256)) throw new Error("The protected Windows Sandbox installation journal is malformed.");
  return value as unknown as InstallPayload;
}
function parseRevoke(value: JsonValue): RevokePayload {
  if (!record(value) || typeof value.canonicalRepositoryRoot !== "string" || typeof value.attestedAt !== "string") throw new Error("The protected Windows Sandbox revocation journal is malformed.");
  return value as unknown as RevokePayload;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function digest(value: string): boolean { return /^[a-f0-9]{64}$/i.test(value); }
function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function boundedAbsolute(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\0\r\n]/.test(value) && isAbsolute(value); }
function pathKey(value: string): string { const result = resolve(value).replaceAll("\\", "/").replace(/\/+$/, ""); return process.platform === "win32" ? result.toLowerCase() : result; }
function samePath(left: string, right: string): boolean { return pathKey(left) === pathKey(right); }
function inside(root: string, candidate: string): boolean { const value = relative(root, candidate); return value !== "" && value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(value); }
