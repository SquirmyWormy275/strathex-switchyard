import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { JournalEntry, JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { ConfiguredNetworkPolicy } from "./configured-network.ts";
import { loadConfiguredNetworkPolicy } from "./configured-network.ts";
import type { CredentialReferenceSummary, CredentialScope, DurableCredentialReferenceVault } from "./durable-credentials.ts";
import type { UserSecretProtector } from "./windows-secret.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";

const networkInstallKind = "b122.network-policy.install.v1";
const networkRevokeKind = "b122.network-policy.revoke.v1";
const scopedNetworkInstallKind = "b122.network-policy.install.v2";
const scopedNetworkRevokeKind = "b122.network-policy.revoke.v2";
const maximumPolicyBytes = 1024 * 1024;

export interface CredentialProvisioningCoordinator {
  provision(input: CredentialProvisioningRequest): Promise<CredentialReferenceSummary>;
  list(): Promise<readonly CredentialReferenceSummary[]>;
  revoke(reference: string, reason: string): Promise<boolean>;
}

export interface CredentialProvisioningRequest {
  readonly reference: string;
  readonly scopes: readonly CredentialScope[];
  readonly sealedSecret: string;
  readonly replaceExisting?: boolean;
}

export class AttestedCredentialProvisioningCoordinator implements CredentialProvisioningCoordinator {
  private readonly vault: DurableCredentialReferenceVault;
  private readonly protector: UserSecretProtector;
  private readonly presence: WindowsUserPresenceRunner;
  constructor(
    vault: DurableCredentialReferenceVault,
    protector: UserSecretProtector,
    presence: WindowsUserPresenceRunner
  ) { this.vault = vault; this.protector = protector; this.presence = presence; }

  async provision(input: CredentialProvisioningRequest): Promise<CredentialReferenceSummary> {
    if (!record(input) || !allowedCredentialProvisionKeys(input) || !identifier(input.reference) || typeof input.sealedSecret !== "string" || !input.sealedSecret || input.sealedSecret.length > 256 * 1024 || (input.replaceExisting !== undefined && typeof input.replaceExisting !== "boolean")) throw new Error("Credential provisioning fields are invalid.");
    const scopes = exactCredentialScopes(input.scopes);
    const approved = await this.presence.verify(credentialPresencePrompt(input.reference, scopes, input.replaceExisting === true));
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve credential provisioning.");
    let cleartext: Uint8Array | undefined;
    try {
      cleartext = await this.protector.open(input.sealedSecret);
      return await this.vault.provision({
        reference: input.reference,
        scopes,
        ...(input.replaceExisting ? { replaceExisting: true } : {})
      }, cleartext);
    } finally { cleartext?.fill(0); }
  }

  list(): Promise<readonly CredentialReferenceSummary[]> { return this.vault.listReferences(); }

  async revoke(reference: string, reason: string): Promise<boolean> {
    if (!identifier(reference) || typeof reason !== "string" || !reason.trim() || reason.length > 256 || /[\r\n\0]/.test(reason)) throw new Error("Credential revocation fields are invalid.");
    const approved = await this.presence.verify("Revoke this SXSY-B122 credential reference and every outstanding in-process lease.");
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve credential revocation.");
    return this.vault.revoke(reference, reason);
  }
}

export interface InstalledNetworkPolicy {
  /** Present for every repository-scoped policy. Absent only for a migrated v1 global record. */
  readonly repositoryRoot?: string;
  readonly filePath: string;
  readonly sha256: string;
  readonly installedAt: string;
  readonly status: "active" | "revoked";
}

export interface NetworkPolicyCoordinator {
  install(sourcePath: string): Promise<InstalledNetworkPolicy>;
  install(repositoryRoot: string, sourcePath: string): Promise<InstalledNetworkPolicy>;
  current(): Promise<InstalledNetworkPolicy | undefined>;
  current(repositoryRoot: string): Promise<InstalledNetworkPolicy | undefined>;
  revoke(): Promise<InstalledNetworkPolicy>;
  revoke(repositoryRoot: string): Promise<InstalledNetworkPolicy>;
}

export class DurableNetworkPolicyRegistry {
  private readonly store: ProtectedJsonStore;
  private readonly installedPath: string;
  private readonly now: () => string;
  constructor(store: ProtectedJsonStore, installedPath: string, now: () => string = () => new Date().toISOString()) {
    if (!boundedAbsolute(installedPath)) throw new Error("The installed network policy path must be fixed and absolute.");
    this.store = store; this.installedPath = installedPath; this.now = now;
  }

  async install(sourcePath: string, attestedAt: string): Promise<InstalledNetworkPolicy>;
  async install(repositoryRoot: string, sourcePath: string, attestedAt: string): Promise<InstalledNetworkPolicy>;
  async install(repositoryRootOrSource: string, sourceOrAttestedAt: string, maybeAttestedAt?: string): Promise<InstalledNetworkPolicy> {
    const scoped = maybeAttestedAt !== undefined;
    const repositoryRoot = scoped ? canonicalRepositoryRoot(repositoryRootOrSource) : undefined;
    const sourcePath = scoped ? sourceOrAttestedAt : repositoryRootOrSource;
    const attestedAt = scoped ? maybeAttestedAt : sourceOrAttestedAt;
    this.assertAttestation(attestedAt);
    if (!boundedAbsolute(sourcePath)) throw new Error("The selected network policy path must be absolute.");
    const source = resolve(sourcePath);
    const metadata = await stat(source);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumPolicyBytes) throw new Error("The selected network policy is not a bounded regular file.");
    await loadConfiguredNetworkPolicy(source);
    const bytes = await readFile(source);
    const sha256 = digest(bytes);
    const destination = repositoryRoot ? scopedInstalledPath(this.installedPath, repositoryRoot) : this.installedPath;
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, destination);
    const entry = repositoryRoot
      ? await this.store.append(scopedNetworkInstallKind, { repositoryRoot, filePath: destination, sha256, attestedAt })
      : await this.store.append(networkInstallKind, { filePath: destination, sha256, attestedAt });
    return { ...(repositoryRoot ? { repositoryRoot } : {}), filePath: destination, sha256, installedAt: entry.at, status: "active" };
  }

  async resolve(repositoryRoot?: string): Promise<ConfiguredNetworkPolicy> {
    const current = await this.current(repositoryRoot);
    if (!current || current.status !== "active") return { version: 1, proxy: "direct", routes: [] };
    const bytes = await readFile(current.filePath);
    if (digest(bytes) !== current.sha256) throw new Error("The installed network policy changed after current-user attestation.");
    return loadConfiguredNetworkPolicy(current.filePath);
  }

  async current(repositoryRoot?: string): Promise<InstalledNetworkPolicy | undefined> {
    const states = new Map<string, InstalledNetworkPolicy>();
    for (const entry of await this.store.readEntries<JsonValue>()) {
      if (entry.kind === networkInstallKind) {
        const payload = parseInstall(entry.payload);
        states.set("", { filePath: payload.filePath, sha256: payload.sha256, installedAt: entry.at, status: "active" });
      } else if (entry.kind === networkRevokeKind) {
        const value = states.get("");
        if (value) states.set("", { ...value, installedAt: entry.at, status: "revoked" });
      } else if (entry.kind === scopedNetworkInstallKind) {
        const payload = parseScopedInstall(entry.payload);
        states.set(repositoryIdentity(payload.repositoryRoot), { repositoryRoot: payload.repositoryRoot, filePath: payload.filePath, sha256: payload.sha256, installedAt: entry.at, status: "active" });
      } else if (entry.kind === scopedNetworkRevokeKind) {
        const payload = parseScopedInstall(entry.payload);
        const key = repositoryIdentity(payload.repositoryRoot);
        const value = states.get(key);
        if (!value || value.filePath !== payload.filePath || value.sha256 !== payload.sha256) throw new Error("The protected scoped network-policy revocation journal is inconsistent.");
        states.set(key, { ...value, installedAt: entry.at, status: "revoked" });
      }
    }
    if (repositoryRoot !== undefined) return states.get(repositoryIdentity(canonicalRepositoryRoot(repositoryRoot)));
    if (states.size > 1) throw new Error("A repository root is required when multiple configured network policies exist.");
    return states.values().next().value as InstalledNetworkPolicy | undefined;
  }

  async revoke(attestedAt: string): Promise<InstalledNetworkPolicy>;
  async revoke(repositoryRoot: string, attestedAt: string): Promise<InstalledNetworkPolicy>;
  async revoke(repositoryRootOrAttestedAt: string, maybeAttestedAt?: string): Promise<InstalledNetworkPolicy> {
    const repositoryRoot = maybeAttestedAt === undefined ? undefined : canonicalRepositoryRoot(repositoryRootOrAttestedAt);
    const attestedAt = maybeAttestedAt ?? repositoryRootOrAttestedAt;
    this.assertAttestation(attestedAt);
    const current = await this.current(repositoryRoot);
    if (!current || current.status !== "active") throw new Error("No active configured network policy is installed.");
    const entry = repositoryRoot
      ? await this.store.append(scopedNetworkRevokeKind, { repositoryRoot, filePath: current.filePath, sha256: current.sha256, attestedAt })
      : await this.store.append(networkRevokeKind, { filePath: current.filePath, sha256: current.sha256, attestedAt });
    return { ...current, installedAt: entry.at, status: "revoked" };
  }

  private assertAttestation(value: string): void { const at = Date.parse(value); const now = Date.parse(this.now()); if (!Number.isFinite(at) || Math.abs(now - at) > 5 * 60_000) throw new Error("Network policy user-presence attestation is missing, stale, or future-dated."); }
}

export class AttestedNetworkPolicyCoordinator implements NetworkPolicyCoordinator {
  private readonly registry: DurableNetworkPolicyRegistry;
  private readonly presence: WindowsUserPresenceRunner;
  private readonly now: () => Date;
  constructor(registry: DurableNetworkPolicyRegistry, presence: WindowsUserPresenceRunner, now: () => Date = () => new Date()) { this.registry = registry; this.presence = presence; this.now = now; }
  async install(sourcePath: string): Promise<InstalledNetworkPolicy>;
  async install(repositoryRoot: string, sourcePath: string): Promise<InstalledNetworkPolicy>;
  async install(repositoryRootOrSource: string, maybeSource?: string): Promise<InstalledNetworkPolicy> { const approved = await this.presence.verify("Approve this exact SXSY-B122 configured HTTPS route policy. It can enable only the fixed routes and credential purposes shown in the selected file."); if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve network policy installation."); return maybeSource === undefined ? this.registry.install(repositoryRootOrSource, this.now().toISOString()) : this.registry.install(repositoryRootOrSource, maybeSource, this.now().toISOString()); }
  current(repositoryRoot?: string): Promise<InstalledNetworkPolicy | undefined> { return this.registry.current(repositoryRoot); }
  async revoke(repositoryRoot?: string): Promise<InstalledNetworkPolicy> { const approved = await this.presence.verify("Revoke the active SXSY-B122 configured HTTPS route policy."); if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve network policy revocation."); return repositoryRoot === undefined ? this.registry.revoke(this.now().toISOString()) : this.registry.revoke(repositoryRoot, this.now().toISOString()); }
}

interface NetworkInstallPayload extends Record<string, JsonValue> { readonly filePath: string; readonly sha256: string; readonly attestedAt: string; }
function parseInstall(value: JsonValue): NetworkInstallPayload { if (!record(value) || typeof value.filePath !== "string" || typeof value.sha256 !== "string" || typeof value.attestedAt !== "string" || !/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error("The protected network policy journal is malformed."); return value as unknown as NetworkInstallPayload; }
interface ScopedNetworkInstallPayload extends NetworkInstallPayload { readonly repositoryRoot: string; }
function parseScopedInstall(value: JsonValue): ScopedNetworkInstallPayload { const payload = parseInstall(value); if (!record(value) || typeof value.repositoryRoot !== "string" || !boundedAbsolute(value.repositoryRoot)) throw new Error("The protected scoped network-policy journal is malformed."); return payload as ScopedNetworkInstallPayload; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function identifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function boundedAbsolute(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\r\n\0]/.test(value) && isAbsolute(value); }
function digest(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function canonicalRepositoryRoot(value: string): string { if (!boundedAbsolute(value)) throw new Error("The network policy repository root must be fixed and absolute."); return resolve(value); }
function repositoryIdentity(value: string): string { const normalized = resolve(value).replaceAll("\\", "/").replace(/\/+$/, ""); return process.platform === "win32" ? normalized.toLowerCase() : normalized; }
function scopedInstalledPath(basePath: string, repositoryRoot: string): string { const identity = createHash("sha256").update(repositoryIdentity(repositoryRoot), "utf8").digest("hex"); const name = basePath.toLowerCase().endsWith(".json") ? basePath.slice(0, -5) : basePath; return `${name}.${identity}.json`; }

function exactCredentialScopes(value: readonly CredentialScope[]): readonly CredentialScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error("Credential provisioning requires 1-16 explicit scope triples.");
  const scopes = value.map((scope) => {
    if (!record(scope) || Object.keys(scope).length !== 3 || !["repositoryRoot", "adapterId", "purpose"].every((key) => key in scope)
      || !boundedAbsolute(scope.repositoryRoot) || !identifier(scope.adapterId) || !identifier(scope.purpose)) throw new Error("Credential provisioning scope triples are invalid.");
    return {
      repositoryRoot: canonicalCredentialRoot(scope.repositoryRoot),
      adapterId: scope.adapterId,
      purpose: scope.purpose
    };
  });
  const identities = scopes.map((scope) => `${scope.repositoryRoot}\0${scope.adapterId}\0${scope.purpose}`);
  if (new Set(identities).size !== identities.length) throw new Error("Credential provisioning scope triples must be unique.");
  return scopes;
}

function credentialPresencePrompt(reference: string, scopes: readonly CredentialScope[], replacing: boolean): string {
  const grouped = new Map<string, string[]>();
  for (const scope of scopes) grouped.set(scope.repositoryRoot, [...(grouped.get(scope.repositoryRoot) ?? []), `${scope.adapterId}/${scope.purpose}`]);
  const exactScopes = [...grouped].map(([repositoryRoot, pairs]) => `${JSON.stringify(repositoryRoot)}=>${pairs.join(",")}`).join("; ");
  const prompt = `${replacing ? "Rotate" : "Provision"} B122 credential ${reference} for ${exactScopes}`;
  if (prompt.length > 240) throw new Error("The exact credential scope set is too large for the trusted presence prompt.");
  return prompt;
}

function canonicalCredentialRoot(value: string): string {
  const normalized = resolve(value).replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function allowedCredentialProvisionKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return ["reference", "scopes", "sealedSecret"].every((key) => key in value)
    && keys.every((key) => key === "reference" || key === "scopes" || key === "sealedSecret" || key === "replaceExisting");
}
