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
  readonly filePath: string;
  readonly sha256: string;
  readonly installedAt: string;
  readonly status: "active" | "revoked";
}

export interface NetworkPolicyCoordinator {
  install(sourcePath: string): Promise<InstalledNetworkPolicy>;
  current(): Promise<InstalledNetworkPolicy | undefined>;
  revoke(): Promise<InstalledNetworkPolicy>;
}

export class DurableNetworkPolicyRegistry {
  private readonly store: ProtectedJsonStore;
  private readonly installedPath: string;
  private readonly now: () => string;
  constructor(store: ProtectedJsonStore, installedPath: string, now: () => string = () => new Date().toISOString()) {
    if (!boundedAbsolute(installedPath)) throw new Error("The installed network policy path must be fixed and absolute.");
    this.store = store; this.installedPath = installedPath; this.now = now;
  }

  async install(sourcePath: string, attestedAt: string): Promise<InstalledNetworkPolicy> {
    this.assertAttestation(attestedAt);
    if (!boundedAbsolute(sourcePath)) throw new Error("The selected network policy path must be absolute.");
    const source = resolve(sourcePath);
    const metadata = await stat(source);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumPolicyBytes) throw new Error("The selected network policy is not a bounded regular file.");
    await loadConfiguredNetworkPolicy(source);
    const bytes = await readFile(source);
    const sha256 = digest(bytes);
    await mkdir(dirname(this.installedPath), { recursive: true });
    const temporary = `${this.installedPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, this.installedPath);
    const entry = await this.store.append(networkInstallKind, { filePath: this.installedPath, sha256, attestedAt });
    return { filePath: this.installedPath, sha256, installedAt: entry.at, status: "active" };
  }

  async resolve(): Promise<ConfiguredNetworkPolicy> {
    const current = await this.current();
    if (!current || current.status !== "active") return { version: 1, proxy: "direct", routes: [] };
    const bytes = await readFile(current.filePath);
    if (digest(bytes) !== current.sha256) throw new Error("The installed network policy changed after current-user attestation.");
    return loadConfiguredNetworkPolicy(current.filePath);
  }

  async current(): Promise<InstalledNetworkPolicy | undefined> {
    let value: InstalledNetworkPolicy | undefined;
    for (const entry of await this.store.readEntries<JsonValue>()) {
      if (entry.kind === networkInstallKind) {
        const payload = parseInstall(entry.payload);
        value = { filePath: payload.filePath, sha256: payload.sha256, installedAt: entry.at, status: "active" };
      } else if (entry.kind === networkRevokeKind && value) value = { ...value, installedAt: entry.at, status: "revoked" };
    }
    return value;
  }

  async revoke(attestedAt: string): Promise<InstalledNetworkPolicy> {
    this.assertAttestation(attestedAt);
    const current = await this.current();
    if (!current || current.status !== "active") throw new Error("No active configured network policy is installed.");
    const entry = await this.store.append(networkRevokeKind, { filePath: current.filePath, sha256: current.sha256, attestedAt });
    return { ...current, installedAt: entry.at, status: "revoked" };
  }

  private assertAttestation(value: string): void { const at = Date.parse(value); const now = Date.parse(this.now()); if (!Number.isFinite(at) || Math.abs(now - at) > 5 * 60_000) throw new Error("Network policy user-presence attestation is missing, stale, or future-dated."); }
}

export class AttestedNetworkPolicyCoordinator implements NetworkPolicyCoordinator {
  private readonly registry: DurableNetworkPolicyRegistry;
  private readonly presence: WindowsUserPresenceRunner;
  private readonly now: () => Date;
  constructor(registry: DurableNetworkPolicyRegistry, presence: WindowsUserPresenceRunner, now: () => Date = () => new Date()) { this.registry = registry; this.presence = presence; this.now = now; }
  async install(sourcePath: string): Promise<InstalledNetworkPolicy> { const approved = await this.presence.verify("Approve this exact SXSY-B122 configured HTTPS route policy. It can enable only the fixed routes and credential purposes shown in the selected file."); if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve network policy installation."); return this.registry.install(sourcePath, this.now().toISOString()); }
  current(): Promise<InstalledNetworkPolicy | undefined> { return this.registry.current(); }
  async revoke(): Promise<InstalledNetworkPolicy> { const approved = await this.presence.verify("Revoke the active SXSY-B122 configured HTTPS route policy."); if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve network policy revocation."); return this.registry.revoke(this.now().toISOString()); }
}

interface NetworkInstallPayload extends Record<string, JsonValue> { readonly filePath: string; readonly sha256: string; readonly attestedAt: string; }
function parseInstall(value: JsonValue): NetworkInstallPayload { if (!record(value) || typeof value.filePath !== "string" || typeof value.sha256 !== "string" || typeof value.attestedAt !== "string" || !/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error("The protected network policy journal is malformed."); return value as unknown as NetworkInstallPayload; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function identifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function boundedAbsolute(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\r\n\0]/.test(value) && isAbsolute(value); }
function digest(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

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
