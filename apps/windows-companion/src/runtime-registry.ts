/** Durable, host-attested pins for repository-owned runtime manifests. */
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { JournalEntry, JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  loadVerifiedRepositoryRuntimeManifest,
  RepositoryRuntime,
  type RepositoryExecutionRootProvider,
  type RuntimeEffectGuard,
  type RuntimeHealthProbe
} from "./repository-runtime.ts";

const pinKind = "b122.repository-runtime.pin.v1";
const revokeKind = "b122.repository-runtime.revoke.v1";

export interface RuntimePinAttestation {
  readonly method: "windows-user-presence" | "none";
  readonly at: string;
}

export interface RepositoryRuntimePin {
  readonly canonicalRepositoryRoot: string;
  readonly manifestPath: string;
  readonly expectedSha256: string;
  readonly installedAt: string;
  readonly status: "active" | "revoked";
}

export interface InstallRepositoryRuntimePin {
  readonly repositoryRoot: string;
  readonly manifestPath: string;
  readonly expectedSha256: string;
  readonly attestation: RuntimePinAttestation;
}

export interface DurableRepositoryRuntimeRegistryOptions {
  readonly effectGuard?: RuntimeEffectGuard;
  readonly executionRoots?: RepositoryExecutionRootProvider;
  readonly healthProbe?: RuntimeHealthProbe;
  readonly now?: () => string;
}

interface PinPayload extends Record<string, JsonValue> {
  readonly canonicalRepositoryRoot: string;
  readonly manifestPath: string;
  readonly expectedSha256: string;
  readonly attestedAt: string;
}

interface RevokePayload extends Record<string, JsonValue> {
  readonly canonicalRepositoryRoot: string;
  readonly attestedAt: string;
}

/**
 * The repository may describe commands, but only a current-user-attested pin
 * in the authenticated companion journal authorizes a specific manifest
 * digest. Resolution rechecks both the bytes and executable identities.
 */
export class DurableRepositoryRuntimeRegistry {
  private readonly store: ProtectedJsonStore;
  private readonly options: DurableRepositoryRuntimeRegistryOptions;
  private readonly now: () => string;
  private readonly cache = new Map<string, RepositoryRuntime>();

  constructor(store: ProtectedJsonStore, options: DurableRepositoryRuntimeRegistryOptions = {}) {
    this.store = store;
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async install(input: InstallRepositoryRuntimePin): Promise<RepositoryRuntimePin> {
    this.assertAttestation(input.attestation);
    const manifestPath = resolve(input.manifestPath);
    const verified = await loadVerifiedRepositoryRuntimeManifest({
      filePath: manifestPath,
      expectedSha256: input.expectedSha256,
      repositoryRoot: input.repositoryRoot
    });
    const payload: PinPayload = {
      canonicalRepositoryRoot: verified.canonicalRepositoryRoot,
      manifestPath,
      expectedSha256: verified.digest,
      attestedAt: input.attestation.at
    };
    const entry = await this.store.append(pinKind, payload);
    this.cache.delete(this.cacheKey(verified.canonicalRepositoryRoot, verified.digest));
    return {
      canonicalRepositoryRoot: verified.canonicalRepositoryRoot,
      manifestPath,
      expectedSha256: verified.digest,
      installedAt: entry.at,
      status: "active"
    };
  }

  async revoke(repositoryRoot: string, attestation: RuntimePinAttestation): Promise<RepositoryRuntimePin> {
    this.assertAttestation(attestation);
    const canonicalRepositoryRoot = await realpath(repositoryRoot);
    const current = (await this.state()).get(pathKey(canonicalRepositoryRoot));
    if (!current || current.status !== "active") throw new Error("No active repository runtime pin exists for the canonical repository root.");
    const payload: RevokePayload = { canonicalRepositoryRoot, attestedAt: attestation.at };
    const entry = await this.store.append(revokeKind, payload);
    this.cache.delete(this.cacheKey(canonicalRepositoryRoot, current.expectedSha256));
    return { ...current, installedAt: entry.at, status: "revoked" };
  }

  async resolve(repositoryRoot: string): Promise<RepositoryRuntime> {
    const canonicalRepositoryRoot = await realpath(repositoryRoot);
    const pin = (await this.state()).get(pathKey(canonicalRepositoryRoot));
    if (!pin || pin.status !== "active") throw new Error("No active host-attested repository runtime pin exists for this repository.");
    const verified = await loadVerifiedRepositoryRuntimeManifest({
      filePath: pin.manifestPath,
      expectedSha256: pin.expectedSha256,
      repositoryRoot: canonicalRepositoryRoot
    });
    const key = this.cacheKey(canonicalRepositoryRoot, verified.digest);
    const existing = this.cache.get(key);
    if (existing) return existing;
    const runtime = new RepositoryRuntime(verified, {
      ...(this.options.effectGuard ? { effectGuard: this.options.effectGuard } : {}),
      ...(this.options.executionRoots ? { executionRoots: this.options.executionRoots } : {}),
      ...(this.options.healthProbe ? { healthProbe: this.options.healthProbe } : {})
    });
    this.cache.set(key, runtime);
    return runtime;
  }

  async list(): Promise<readonly RepositoryRuntimePin[]> {
    return [...(await this.state()).values()];
  }

  private async state(): Promise<Map<string, RepositoryRuntimePin>> {
    const entries = await this.store.readEntries<JsonValue>();
    const pins = new Map<string, RepositoryRuntimePin>();
    for (const entry of entries) this.applyEntry(entry, pins);
    return pins;
  }

  private applyEntry(entry: JournalEntry<JsonValue>, pins: Map<string, RepositoryRuntimePin>): void {
    if (entry.kind === pinKind) {
      const payload = parsePin(entry.payload);
      pins.set(pathKey(payload.canonicalRepositoryRoot), {
        canonicalRepositoryRoot: payload.canonicalRepositoryRoot,
        manifestPath: payload.manifestPath,
        expectedSha256: payload.expectedSha256,
        installedAt: entry.at,
        status: "active"
      });
      return;
    }
    if (entry.kind === revokeKind) {
      const payload = parseRevoke(entry.payload);
      const key = pathKey(payload.canonicalRepositoryRoot);
      const current = pins.get(key);
      if (current) pins.set(key, { ...current, installedAt: entry.at, status: "revoked" });
    }
  }

  private assertAttestation(attestation: RuntimePinAttestation): void {
    if (attestation.method !== "windows-user-presence") throw new Error("Repository runtime pin changes require Windows user-presence attestation.");
    const at = Date.parse(attestation.at);
    const now = Date.parse(this.now());
    if (!Number.isFinite(at) || Math.abs(now - at) > 5 * 60_000) throw new Error("Repository runtime pin user-presence attestation is missing, stale, or future-dated.");
  }

  private cacheKey(root: string, digest: string): string { return `${pathKey(root)}:${digest}`; }
}

function parsePin(value: JsonValue): PinPayload {
  if (!record(value)
    || typeof value.canonicalRepositoryRoot !== "string"
    || typeof value.manifestPath !== "string"
    || typeof value.expectedSha256 !== "string"
    || typeof value.attestedAt !== "string"
    || !/^[a-f0-9]{64}$/i.test(value.expectedSha256)) throw new Error("The protected repository runtime pin journal is malformed.");
  return value as unknown as PinPayload;
}

function parseRevoke(value: JsonValue): RevokePayload {
  if (!record(value) || typeof value.canonicalRepositoryRoot !== "string" || typeof value.attestedAt !== "string") {
    throw new Error("The protected repository runtime revocation journal is malformed.");
  }
  return value as unknown as RevokePayload;
}

function record(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathKey(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
