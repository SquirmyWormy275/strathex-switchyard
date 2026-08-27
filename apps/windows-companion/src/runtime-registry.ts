/** Durable, host-attested pins for repository-owned runtime manifests. */
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { OperationControllerObservation, OperationReconciliationBinding } from "../../../packages/control-plane/src/runtime.ts";
import type { JournalEntry, JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  loadVerifiedRepositoryRuntimeManifest,
  type ManagedRepositoryProcess,
  RepositoryRuntime,
  type RepositoryExecutionRootProvider,
  type RepositoryProcessSupervisor,
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
  readonly processSupervisor?: RepositoryProcessSupervisor;
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
      ...(this.options.healthProbe ? { healthProbe: this.options.healthProbe } : {}),
      ...(this.options.processSupervisor ? { processSupervisor: this.options.processSupervisor } : {})
    });
    this.cache.set(key, runtime);
    return runtime;
  }

  async list(): Promise<readonly RepositoryRuntimePin[]> {
    return [...(await this.state()).values()];
  }

  async cancelOperation(operationId: string, _reason: string): Promise<number> {
    bounded(operationId, "operation ID");
    bounded(_reason, "cancellation reason");
    const runtimes = (await this.activeRuntimeResolutions()).flatMap((item) => item.runtime ? [item.runtime] : []);
    await Promise.all(runtimes.map((runtime) => runtime.recoverManagedProcesses().catch(() => [])));
    const cancelled = await Promise.all(runtimes.map((runtime) => runtime.cancelOperation(operationId).catch(() => 0)));
    return sum(cancelled);
  }

  async cancelRepository(repositoryRoot: string, _reason: string): Promise<number> {
    bounded(_reason, "cancellation reason");
    const runtime = await this.resolve(bounded(repositoryRoot, "repository root"));
    await runtime.recoverManagedProcesses();
    return runtime.cancelRepository();
  }

  async cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number> {
    return this.cancelRepository(repositoryRoot, reason);
  }

  async reconcileOperation(bindingInput: OperationReconciliationBinding): Promise<OperationControllerObservation> {
    const binding = reconciliationBinding(bindingInput);
    if (!binding.targetSnapshotId || !binding.repositoryRoot) {
      return activeObservation(binding, "The protected repository target binding is absent or partial; terminal process state remains ambiguous.");
    }
    const resolutions = await this.activeRuntimeResolutions();
    const observations: OperationControllerObservation[] = [];
    let poisonedTarget = false;
    for (const resolution of resolutions) {
      if (!resolution.runtime) {
        if (binding.repositoryRoot && pathKey(resolution.pin.canonicalRepositoryRoot) === pathKey(binding.repositoryRoot)) {
          poisonedTarget = true;
          observations.push(activeObservation(binding, "The exact host-attested repository runtime pin or manifest is invalid; this scope remains ambiguous and no work was replayed."));
        }
        continue;
      }
      await resolution.runtime.recoverManagedProcesses().catch(() => []);
      observations.push(await resolution.runtime.reconcileOperation(binding).catch(() =>
        activeObservation(binding, "A pinned repository runtime could not prove the exact process live or terminal; no work was replayed.")));
    }
    const owners = observations.filter((observation) => observation.state !== "not_owner");
    if (owners.length === 0) {
      return { state: "not_owner", operationId: binding.operationId, summary: "No exact durable repository supervisor identity is known for this operation; no process was replayed or killed." };
    }
    if (owners.some((observation) => observation.state === "active")) {
      return activeObservation(binding, poisonedTarget
        ? "The exact host-attested repository runtime pin or manifest is invalid; this scope remains ambiguous and no work was replayed."
        : "At least one exact durable repository process tree remains active or unresolved; no work was replayed.");
    }
    const terminals = owners.filter((observation): observation is Extract<OperationControllerObservation, { state: "terminal" }> => observation.state === "terminal");
    return terminals.length === 1
      ? terminals[0]!
      : activeObservation(binding, "More than one pinned repository runtime claimed the same durable operation; terminal state remains ambiguous.");
  }

  /**
   * Startup-wide, read-only reconciliation of every active attested pin.
   * Recovery attaches only to helper-authenticated durable identities and never
   * replays a recipe or falls back to an ambient PID.
   */
  async recoverManagedProcesses(): Promise<readonly ManagedRepositoryProcess[]> {
    const runtimes = (await this.activeRuntimeResolutions()).flatMap((item) => item.runtime ? [item.runtime] : []);
    const recovered = await Promise.all(runtimes.map((runtime) => runtime.recoverManagedProcesses().catch(() => [])));
    return recovered.flat();
  }

  private async activeRuntimeResolutions(): Promise<readonly Readonly<{ pin: RepositoryRuntimePin; runtime?: RepositoryRuntime }>[] > {
    const pins = [...(await this.state()).values()].filter((pin) => pin.status === "active");
    return Promise.all(pins.map(async (pin) => {
      try { return { pin, runtime: await this.resolve(pin.canonicalRepositoryRoot) }; }
      catch { return { pin }; }
    }));
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

function bounded(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096 || /[\0\r\n]/.test(value)) throw new Error(`The ${label} is invalid.`);
  return value;
}

function sum(values: readonly number[]): number {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error("Repository process cancellation returned an invalid count.");
  return values.reduce((total, value) => total + value, 0);
}

function reconciliationBinding(input: OperationReconciliationBinding): OperationReconciliationBinding {
  const operationId = bounded(input.operationId, "operation ID");
  const action = bounded(input.action, "operation action") as OperationReconciliationBinding["action"];
  const targetSnapshotId = input.targetSnapshotId;
  if (targetSnapshotId !== undefined && !/^[a-f0-9]{64}$/.test(targetSnapshotId)) throw new Error("The target snapshot ID is invalid.");
  const repositoryRoot = input.repositoryRoot === undefined ? undefined : bounded(input.repositoryRoot, "repository root");
  if ((targetSnapshotId === undefined) !== (repositoryRoot === undefined)) throw new Error("The protected repository target binding is partial.");
  return { operationId, action, ...(targetSnapshotId ? { targetSnapshotId, repositoryRoot } : {}) };
}

function activeObservation(binding: OperationReconciliationBinding, summary: string): Extract<OperationControllerObservation, { state: "active" }> {
  return { state: "active", ...binding, effectDisposition: "ambiguous", summary };
}
