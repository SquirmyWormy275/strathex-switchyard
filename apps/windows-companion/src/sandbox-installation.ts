import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { BrokerOutcome, IsolationRequest, IsolationRuntime, PermitVerifier } from "../../../packages/control-plane/src/brokers.ts";
import type { JournalEntry, JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";
import {
  WindowsSandboxBackend,
  FixedWindowsSandboxLifecycleController,
  WindowsSandboxIsolationRuntime,
  type ApprovedWindowsSandboxPersistentVolume,
  type WindowsSandboxEffectGuard
} from "./windows-sandbox.ts";

const installKind = "b122.windows-sandbox.install.v1";
const revokeKind = "b122.windows-sandbox.revoke.v1";
const approveVolumeKind = "b122.windows-sandbox.volume-approve.v1";
const revokeVolumeKind = "b122.windows-sandbox.volume-revoke.v1";
const maximumCatalogBytes = 256 * 1024;

export interface SandboxInstallationPin {
  readonly canonicalRepositoryRoot: string;
  readonly catalogPath: string;
  readonly catalogSha256: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  /** Absent only on legacy journal entries, which cannot run interactively. */
  readonly lifecycleHelperPath?: string;
  readonly lifecycleHelperSha256?: string;
  readonly installedAt: string;
  readonly status: "active" | "revoked";
}

export interface SandboxPersistentVolumePin extends ApprovedWindowsSandboxPersistentVolume {
  readonly readOnly: boolean;
  readonly approvedAt: string;
  readonly status: "active" | "revoked";
}

export interface SandboxInstallationCoordinator {
  install(input: Readonly<{ repositoryRoot: string; catalogPath: string }>): Promise<SandboxInstallationPin>;
  revoke(repositoryRoot: string): Promise<SandboxInstallationPin>;
  list(): Promise<readonly SandboxInstallationPin[]>;
}

interface InstallPayload {
  readonly canonicalRepositoryRoot: string;
  readonly catalogPath: string;
  readonly catalogSha256: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly lifecycleHelperPath?: string;
  readonly lifecycleHelperSha256?: string;
  readonly attestedAt: string;
}

interface RevokePayload extends Record<string, JsonValue> {
  readonly canonicalRepositoryRoot: string;
  readonly attestedAt: string;
}

interface VolumeApprovalPayload extends Record<string, JsonValue> {
  readonly canonicalRepositoryRoot: string;
  readonly id: string;
  readonly hostRoot: string;
  readonly readOnly: boolean;
  readonly operator: string;
  readonly attestedAt: string;
}

interface VolumeRevokePayload extends Record<string, JsonValue> {
  readonly canonicalRepositoryRoot: string;
  readonly id: string;
  readonly operator: string;
  readonly attestedAt: string;
}

export class DurableSandboxInstallationRegistry {
  private readonly store: ProtectedJsonStore;
  private readonly configuredHelperPath: string;
  private readonly configuredLifecycleHelperPath: string;
  private readonly now: () => string;

  constructor(store: ProtectedJsonStore, helperPath: string, now: () => string = () => new Date().toISOString()) {
    if (!boundedAbsolute(helperPath)) throw new Error("Windows Sandbox requires a fixed absolute guest-helper path.");
    this.store = store;
    this.configuredHelperPath = resolve(helperPath);
    this.configuredLifecycleHelperPath = resolve(dirname(helperPath), "b122-sandbox-lifecycle.exe");
    this.now = now;
  }

  async install(input: Readonly<{ repositoryRoot: string; catalogPath: string; catalogSha256: string; helperSha256: string; lifecycleHelperSha256: string; attestedAt: string }>): Promise<SandboxInstallationPin> {
    this.assertAttestation(input.attestedAt);
    const verified = await this.verify({
      canonicalRepositoryRoot: input.repositoryRoot,
      catalogPath: input.catalogPath,
      catalogSha256: input.catalogSha256,
      helperPath: this.configuredHelperPath,
      helperSha256: input.helperSha256,
      lifecycleHelperPath: this.configuredLifecycleHelperPath,
      lifecycleHelperSha256: input.lifecycleHelperSha256
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

  async approvePersistentVolume(input: Readonly<{
    repositoryRoot: string;
    id: string;
    hostRoot: string;
    readOnly: boolean;
    operator: string;
    attestedAt: string;
  }>): Promise<SandboxPersistentVolumePin> {
    this.assertAttestation(input.attestedAt);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.id) || !input.operator.trim() || input.operator.length > 256) throw new Error("Windows Sandbox persistent-volume approval is invalid.");
    const installation = await this.resolve(input.repositoryRoot);
    const hostRoot = await realpath(input.hostRoot);
    const metadata = await stat(hostRoot);
    if (!metadata.isDirectory()) throw new Error("Windows Sandbox persistent volume must be one concrete directory.");
    const taskRoot = dirname(installation.canonicalRepositoryRoot);
    if (!inside(taskRoot, hostRoot) || overlaps(installation.canonicalRepositoryRoot, hostRoot)
      || overlaps(dirname(installation.helperPath), hostRoot)
      || installation.lifecycleHelperPath && overlaps(dirname(installation.lifecycleHelperPath), hostRoot)) {
      throw new Error("Windows Sandbox persistent volumes must be task-owned and disjoint from repository, helper, and lifecycle roots.");
    }
    const entry = await this.store.append(approveVolumeKind, {
      canonicalRepositoryRoot: installation.canonicalRepositoryRoot,
      id: input.id,
      hostRoot,
      readOnly: input.readOnly,
      operator: input.operator.trim(),
      attestedAt: input.attestedAt
    });
    return { id: input.id, hostRoot, readOnly: input.readOnly, approvedAt: entry.at, status: "active" };
  }

  async revokePersistentVolume(input: Readonly<{ repositoryRoot: string; id: string; operator: string; attestedAt: string }>): Promise<SandboxPersistentVolumePin> {
    this.assertAttestation(input.attestedAt);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.id) || !input.operator.trim() || input.operator.length > 256) throw new Error("Windows Sandbox persistent-volume revocation is invalid.");
    const installation = await this.resolve(input.repositoryRoot);
    const current = (await this.volumeState(installation.canonicalRepositoryRoot)).get(input.id.toLowerCase());
    if (!current || current.status !== "active") throw new Error("No active Windows Sandbox persistent-volume approval exists for this repository and ID.");
    const entry = await this.store.append(revokeVolumeKind, {
      canonicalRepositoryRoot: installation.canonicalRepositoryRoot,
      id: input.id,
      operator: input.operator.trim(),
      attestedAt: input.attestedAt
    });
    return { ...current, approvedAt: entry.at, status: "revoked" };
  }

  async resolvePersistentVolumes(repositoryRoot: string): Promise<readonly SandboxPersistentVolumePin[]> {
    const installation = await this.resolve(repositoryRoot);
    const active = [...(await this.volumeState(installation.canonicalRepositoryRoot)).values()]
      .filter((volume) => volume.status === "active")
      .sort((left, right) => left.id.localeCompare(right.id));
    const verified: SandboxPersistentVolumePin[] = [];
    for (const volume of active) {
      const hostRoot = await realpath(volume.hostRoot).catch(() => { throw new Error(`Windows Sandbox persistent volume ${volume.id} is unavailable.`); });
      const metadata = await stat(hostRoot);
      if (!metadata.isDirectory() || !samePath(hostRoot, volume.hostRoot)) throw new Error(`Windows Sandbox persistent volume ${volume.id} changed after approval.`);
      verified.push({ ...volume, hostRoot });
    }
    return verified;
  }

  private async volumeState(canonicalRepositoryRoot: string): Promise<Map<string, SandboxPersistentVolumePin>> {
    const volumes = new Map<string, SandboxPersistentVolumePin>();
    for (const entry of await this.store.readEntries<JsonValue>()) {
      if (entry.kind === approveVolumeKind) {
        const value = parseVolumeApproval(entry.payload);
        if (samePath(value.canonicalRepositoryRoot, canonicalRepositoryRoot)) {
          volumes.set(value.id.toLowerCase(), { id: value.id, hostRoot: value.hostRoot, readOnly: value.readOnly, approvedAt: entry.at, status: "active" });
        }
      } else if (entry.kind === revokeVolumeKind) {
        const value = parseVolumeRevoke(entry.payload);
        if (!samePath(value.canonicalRepositoryRoot, canonicalRepositoryRoot)) continue;
        const current = volumes.get(value.id.toLowerCase());
        if (current) volumes.set(value.id.toLowerCase(), { ...current, approvedAt: entry.at, status: "revoked" });
      }
    }
    return volumes;
  }

  private async verify(input: Readonly<{ canonicalRepositoryRoot: string; catalogPath: string; catalogSha256: string; helperPath: string; helperSha256: string; lifecycleHelperPath?: string; lifecycleHelperSha256?: string }>) {
    if (!digest(input.catalogSha256) || !digest(input.helperSha256) || !input.lifecycleHelperPath || !input.lifecycleHelperSha256 || !digest(input.lifecycleHelperSha256)) throw new Error("Windows Sandbox installation digests or lifecycle-helper pin are invalid.");
    const canonicalRepositoryRoot = await realpath(input.canonicalRepositoryRoot);
    const catalogPath = await realpath(input.catalogPath);
    const helperPath = await realpath(input.helperPath);
    const lifecycleHelperPath = await realpath(input.lifecycleHelperPath);
    const configuredHelperPath = await realpath(this.configuredHelperPath);
    const configuredLifecycleHelperPath = await realpath(this.configuredLifecycleHelperPath);
    if (!samePath(helperPath, configuredHelperPath)) throw new Error("The installed Windows Sandbox helper does not match the fixed host helper path.");
    if (!samePath(lifecycleHelperPath, configuredLifecycleHelperPath)) throw new Error("The installed Windows Sandbox lifecycle helper does not match the fixed host helper path.");
    if (!inside(canonicalRepositoryRoot, catalogPath) || samePath(canonicalRepositoryRoot, catalogPath)) throw new Error("The Windows Sandbox catalog must be a regular file inside the selected repository.");
    const [catalogStat, helperStat, lifecycleHelperStat] = await Promise.all([stat(catalogPath), stat(helperPath), stat(lifecycleHelperPath)]);
    if (!catalogStat.isFile() || catalogStat.size <= 0 || catalogStat.size > maximumCatalogBytes) throw new Error("The Windows Sandbox catalog is not a bounded regular file.");
    if (!helperStat.isFile() || helperStat.size <= 0 || helperStat.size > 256 * 1024 * 1024 || basename(helperPath).toLowerCase() !== "b122-sandbox-worker.exe") throw new Error("The fixed Windows Sandbox helper is invalid.");
    if (!lifecycleHelperStat.isFile() || lifecycleHelperStat.size <= 0 || lifecycleHelperStat.size > 256 * 1024 * 1024 || basename(lifecycleHelperPath).toLowerCase() !== "b122-sandbox-lifecycle.exe") throw new Error("The fixed Windows Sandbox lifecycle helper is invalid.");
    const [catalogBytes, helperBytes, lifecycleHelperBytes] = await Promise.all([readFile(catalogPath), readFile(helperPath), readFile(lifecycleHelperPath)]);
    if (sha256(catalogBytes) !== input.catalogSha256.toLowerCase()) throw new Error("The Windows Sandbox catalog changed after host attestation.");
    if (sha256(helperBytes) !== input.helperSha256.toLowerCase()) throw new Error("The Windows Sandbox helper changed after host attestation.");
    if (sha256(lifecycleHelperBytes) !== input.lifecycleHelperSha256.toLowerCase()) throw new Error("The Windows Sandbox lifecycle helper changed after host attestation.");
    validateCatalog(catalogBytes);
    return {
      canonicalRepositoryRoot,
      catalogPath,
      catalogSha256: input.catalogSha256.toLowerCase(),
      helperPath,
      helperSha256: input.helperSha256.toLowerCase(),
      lifecycleHelperPath,
      lifecycleHelperSha256: input.lifecycleHelperSha256.toLowerCase()
    };
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
  private readonly lifecycleHelperPath: string;
  private readonly presence: WindowsUserPresenceRunner;
  private readonly now: () => Date;
  constructor(
    registry: DurableSandboxInstallationRegistry,
    helperPath: string,
    presence: WindowsUserPresenceRunner,
    now: () => Date = () => new Date()
  ) {
    this.registry = registry;
    this.helperPath = helperPath;
    this.lifecycleHelperPath = resolve(dirname(helperPath), "b122-sandbox-lifecycle.exe");
    this.presence = presence;
    this.now = now;
  }

  async install(input: Readonly<{ repositoryRoot: string; catalogPath: string }>): Promise<SandboxInstallationPin> {
    if (!boundedAbsolute(input.repositoryRoot) || !boundedAbsolute(input.catalogPath)) throw new Error("Windows Sandbox installation requires bounded absolute host paths.");
    const [catalog, helper, lifecycleHelper] = await Promise.all([readFile(input.catalogPath), readFile(this.helperPath), readFile(this.lifecycleHelperPath)]);
    if (!catalog.length || catalog.length > maximumCatalogBytes || !helper.length || helper.length > 256 * 1024 * 1024 || !lifecycleHelper.length || lifecycleHelper.length > 256 * 1024 * 1024) throw new Error("Windows Sandbox installation inputs are outside their bounds.");
    validateCatalog(catalog);
    const approved = await this.presence.verify("Approve this exact SXSY-B122 Windows Sandbox recipe catalog and fixed guest helper for the selected Git root.");
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve Windows Sandbox installation.");
    return this.registry.install({ repositoryRoot: input.repositoryRoot, catalogPath: input.catalogPath, catalogSha256: sha256(catalog), helperSha256: sha256(helper), lifecycleHelperSha256: sha256(lifecycleHelper), attestedAt: this.now().toISOString() });
  }

  async revoke(repositoryRoot: string): Promise<SandboxInstallationPin> {
    if (!boundedAbsolute(repositoryRoot)) throw new Error("Windows Sandbox revocation requires a bounded absolute repository path.");
    const approved = await this.presence.verify("Revoke the SXSY-B122 Windows Sandbox catalog and helper pin for the selected Git root.");
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve Windows Sandbox revocation.");
    return this.registry.revoke(repositoryRoot, this.now().toISOString());
  }

  list(): Promise<readonly SandboxInstallationPin[]> { return this.registry.list(); }

  async approvePersistentVolume(input: Readonly<{ repositoryRoot: string; id: string; hostRoot: string; readOnly: boolean }>): Promise<SandboxPersistentVolumePin> {
    if (!boundedAbsolute(input.repositoryRoot) || !boundedAbsolute(input.hostRoot)) throw new Error("Windows Sandbox persistent-volume approval requires bounded absolute paths.");
    const approved = await this.presence.verify(`Approve the exact host directory ${input.hostRoot} as ${input.readOnly ? "read-only" : "read-write"} Full Sandbox persistent volume ${input.id} for the selected Git root.`);
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve the Windows Sandbox persistent volume.");
    return this.registry.approvePersistentVolume({ ...input, operator: approved.operator, attestedAt: this.now().toISOString() });
  }

  async revokePersistentVolume(repositoryRoot: string, id: string): Promise<SandboxPersistentVolumePin> {
    if (!boundedAbsolute(repositoryRoot) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error("Windows Sandbox persistent-volume revocation requires an exact repository and volume ID.");
    const approved = await this.presence.verify(`Revoke Full Sandbox persistent volume ${id} for the selected Git root without deleting its host contents.`);
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve the Windows Sandbox persistent-volume revocation.");
    return this.registry.revokePersistentVolume({ repositoryRoot, id, operator: approved.operator, attestedAt: this.now().toISOString() });
  }
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
    if (!pin.lifecycleHelperPath || !pin.lifecycleHelperSha256) return { status: "unavailable", summary: "The installed Windows Sandbox boundary predates exact interactive lifecycle attestation and must be reinstalled." };
    let persistentVolumes: readonly SandboxPersistentVolumePin[];
    try { persistentVolumes = await this.registry.resolvePersistentVolumes(request.target.repositoryRoot); }
    catch { return { status: "unavailable", summary: "Windows Sandbox persistent-volume state could not be revalidated." }; }
    const targetKey = sha256(pin.canonicalRepositoryRoot).slice(0, 24);
    const sandboxState = join(this.stateDirectory, "windows-sandbox", targetKey);
    const destinationRoot = join(sandboxState, "validated-results");
    await Promise.all([mkdir(sandboxState, { recursive: true }), mkdir(destinationRoot, { recursive: true })]);
    const catalogRelativePath = relative(pin.canonicalRepositoryRoot, pin.catalogPath).replaceAll("\\", "/");
    const denyFallback: WindowsSandboxEffectGuard = { async check() { return { allowed: false, reason: "No dispatch-bound final effect guard is available." }; } };
    const backend = new WindowsSandboxBackend({
      allowedTaskRoots: [pin.canonicalRepositoryRoot, this.stateDirectory, dirname(pin.helperPath), ...persistentVolumes.map((volume) => volume.hostRoot)],
      stateRoot: sandboxState,
      helperDirectory: dirname(pin.helperPath),
      helperFilename: basename(pin.helperPath),
      jobManifestRelativePath: catalogRelativePath,
      defaultDestinationRoot: destinationRoot,
      effectGuard: denyFallback,
      lifecycleController: new FixedWindowsSandboxLifecycleController(pin.lifecycleHelperPath, pin.lifecycleHelperSha256),
      approvedPersistentVolumes: persistentVolumes.map((volume) => ({ id: volume.id, hostRoot: volume.hostRoot, readOnly: volume.readOnly }))
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
  if (!record(value) || typeof value.canonicalRepositoryRoot !== "string" || typeof value.catalogPath !== "string" || typeof value.catalogSha256 !== "string" || typeof value.helperPath !== "string" || typeof value.helperSha256 !== "string" || typeof value.attestedAt !== "string" || !digest(value.catalogSha256) || !digest(value.helperSha256)
    || (value.lifecycleHelperPath !== undefined || value.lifecycleHelperSha256 !== undefined)
      && (typeof value.lifecycleHelperPath !== "string" || typeof value.lifecycleHelperSha256 !== "string" || !digest(value.lifecycleHelperSha256))) throw new Error("The protected Windows Sandbox installation journal is malformed.");
  return value as unknown as InstallPayload;
}
function parseRevoke(value: JsonValue): RevokePayload {
  if (!record(value) || typeof value.canonicalRepositoryRoot !== "string" || typeof value.attestedAt !== "string") throw new Error("The protected Windows Sandbox revocation journal is malformed.");
  return value as unknown as RevokePayload;
}
function parseVolumeApproval(value: JsonValue): VolumeApprovalPayload {
  if (!record(value) || typeof value.canonicalRepositoryRoot !== "string" || typeof value.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.id)
    || typeof value.hostRoot !== "string" || typeof value.readOnly !== "boolean" || typeof value.operator !== "string" || typeof value.attestedAt !== "string") {
    throw new Error("The protected Windows Sandbox persistent-volume approval journal is malformed.");
  }
  return value as unknown as VolumeApprovalPayload;
}
function parseVolumeRevoke(value: JsonValue): VolumeRevokePayload {
  if (!record(value) || typeof value.canonicalRepositoryRoot !== "string" || typeof value.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.id)
    || typeof value.operator !== "string" || typeof value.attestedAt !== "string") throw new Error("The protected Windows Sandbox persistent-volume revocation journal is malformed.");
  return value as unknown as VolumeRevokePayload;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function digest(value: string): boolean { return /^[a-f0-9]{64}$/i.test(value); }
function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function boundedAbsolute(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\0\r\n]/.test(value) && isAbsolute(value); }
function pathKey(value: string): string { const result = resolve(value).replaceAll("\\", "/").replace(/\/+$/, ""); return process.platform === "win32" ? result.toLowerCase() : result; }
function samePath(left: string, right: string): boolean { return pathKey(left) === pathKey(right); }
function inside(root: string, candidate: string): boolean { const value = relative(root, candidate); return value !== "" && value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(value); }
function overlaps(left: string, right: string): boolean { return samePath(left, right) || inside(left, right) || inside(right, left); }
