/**
 * Host-owned lifecycle for installed B122 desktop and managed-terminal
 * providers.
 *
 * Provider paths and argument profiles enter through a bootstrap-owned fixed
 * catalog, never an IPC request. Installation and revocation require current
 * Windows-user presence and are recorded in the authenticated durable journal.
 * Every effect resolves and hashes the executable again inside the process
 * port's final-effect callback.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  stableJson,
  type JournalEntry,
  type JsonValue,
  type ProtectedJsonStore
} from "../../../packages/control-plane/src/store.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";

const installKind = "b122.provider-desktop.install.v1";
const revokeKind = "b122.provider-desktop.revoke.v1";
const maximumExecutableBytes = 2 * 1024 * 1024 * 1024;
const maximumActionLifetimeMs = 5 * 60_000;
const terminalMetadataLifetimeMs = 30_000;
const cancellationPollMs = 25;

export const providerIds = ["claude_desktop", "chatgpt_desktop", "claude_code", "codex"] as const;
export type ProviderId = typeof providerIds[number];
export type DesktopProviderId = "claude_desktop" | "chatgpt_desktop";
export type ManagedTerminalProviderId = "claude_code" | "codex";

export interface ProviderProductIdentity {
  readonly productId: string;
  readonly displayName: string;
  readonly publisher: string;
  readonly role: "desktop" | "managed_terminal";
}

export interface ProviderCatalogEntry {
  readonly provider: ProviderId;
  readonly executablePath: string;
  readonly productIdentity: ProviderProductIdentity;
  readonly normalArgs: readonly string[];
  readonly freshArgs?: readonly string[];
  readonly terminalProfileName?: string;
  readonly catalogDigest: string;
}

export interface FixedProviderDesktopPaths {
  readonly claude_desktop: string;
  readonly chatgpt_desktop: string;
  readonly claude_code: string;
  readonly codex: string;
}

const products: Readonly<Record<ProviderId, Omit<ProviderCatalogEntry, "provider" | "executablePath" | "catalogDigest">>> = {
  claude_desktop: {
    productIdentity: { productId: "anthropic.claude-desktop", displayName: "Claude Desktop", publisher: "Anthropic, PBC", role: "desktop" },
    normalArgs: [],
    freshArgs: ["--new-window"]
  },
  chatgpt_desktop: {
    productIdentity: { productId: "openai.chatgpt-desktop", displayName: "ChatGPT Desktop", publisher: "OpenAI, L.L.C.", role: "desktop" },
    normalArgs: [],
    freshArgs: ["--new-window"]
  },
  claude_code: {
    productIdentity: { productId: "anthropic.claude-code", displayName: "Claude Code", publisher: "Anthropic, PBC", role: "managed_terminal" },
    normalArgs: [],
    terminalProfileName: "SXSY-B122 Claude Code"
  },
  codex: {
    productIdentity: { productId: "openai.codex", displayName: "Codex", publisher: "OpenAI, L.L.C.", role: "managed_terminal" },
    normalArgs: [],
    terminalProfileName: "SXSY-B122 Codex"
  }
};

/**
 * Immutable host catalog. Only four paths are configurable by bootstrap; the
 * provider identities, roles, and argument profiles are compiled source.
 */
export class FixedProviderDesktopCatalog {
  private readonly entries: ReadonlyMap<ProviderId, ProviderCatalogEntry>;

  constructor(paths: FixedProviderDesktopPaths) {
    const entries = providerIds.map((provider): readonly [ProviderId, ProviderCatalogEntry] => {
      const executablePath = fixedExecutablePath(paths[provider], provider);
      const unsigned = { provider, executablePath, ...products[provider] };
      return [provider, { ...unsigned, catalogDigest: sha256(stableJson(unsigned)) }];
    });
    this.entries = new Map(entries);
  }

  get(provider: ProviderId): ProviderCatalogEntry {
    assertProvider(provider);
    const entry = this.entries.get(provider);
    if (!entry) throw new Error("The requested provider is absent from the fixed host catalog.");
    return entry;
  }

  list(): readonly ProviderCatalogEntry[] { return providerIds.map((provider) => this.get(provider)); }
}

export function createFixedProviderDesktopCatalog(paths: FixedProviderDesktopPaths): FixedProviderDesktopCatalog {
  return new FixedProviderDesktopCatalog(paths);
}

export interface ProviderExecutableIdentity {
  readonly canonicalExecutablePath: string;
  readonly executableSha256: string;
  readonly productIdentity: ProviderProductIdentity;
  readonly size: number;
  readonly modifiedMs: number;
  readonly device: number;
  readonly inode: number;
}

export interface ProviderExecutableIdentityProbe {
  inspect(entry: ProviderCatalogEntry): Promise<ProviderExecutableIdentity>;
}

/** Exact byte and file identity probe; product identity is bound by the compiled catalog and the approved digest. */
export class NodeProviderExecutableIdentityProbe implements ProviderExecutableIdentityProbe {
  async inspect(entry: ProviderCatalogEntry): Promise<ProviderExecutableIdentity> {
    const configured = resolve(entry.executablePath);
    const linkMetadata = await lstat(configured).catch(() => { throw new Error("The fixed provider executable is unavailable."); });
    if (linkMetadata.isSymbolicLink()) throw new Error("The fixed provider executable cannot be a symbolic link or redirect.");
    const canonicalExecutablePath = await realpath(configured).catch(() => { throw new Error("The fixed provider executable cannot be canonicalized."); });
    const metadata = await stat(canonicalExecutablePath);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumExecutableBytes) {
      throw new Error("The fixed provider executable is not a bounded regular file.");
    }
    const executableSha256 = await fileSha256(canonicalExecutablePath);
    return {
      canonicalExecutablePath,
      executableSha256,
      productIdentity: entry.productIdentity,
      size: metadata.size,
      modifiedMs: metadata.mtimeMs,
      device: metadata.dev,
      inode: metadata.ino
    };
  }
}

export interface ProviderInstallation {
  readonly provider: ProviderId;
  readonly installationId: string;
  readonly catalogDigest: string;
  readonly identity: ProviderExecutableIdentity;
  readonly operator: string;
  readonly installedAt: string;
  readonly statusAt: string;
  readonly status: "active" | "revoked";
}

interface ProviderInstallPayload extends Record<string, JsonValue> {
  readonly provider: ProviderId;
  readonly catalogDigest: string;
  readonly canonicalExecutablePath: string;
  readonly executableSha256: string;
  readonly productId: string;
  readonly displayName: string;
  readonly publisher: string;
  readonly role: "desktop" | "managed_terminal";
  readonly size: number;
  readonly modifiedMs: number;
  readonly device: number;
  readonly inode: number;
  readonly operator: string;
}

interface ProviderRevokePayload extends Record<string, JsonValue> {
  readonly provider: ProviderId;
  readonly installationId: string;
  readonly operator: string;
}

export interface AttestedProviderDesktopRegistryOptions {
  readonly store: ProtectedJsonStore;
  readonly catalog: FixedProviderDesktopCatalog;
  readonly identityProbe: ProviderExecutableIdentityProbe;
  readonly presence: WindowsUserPresenceRunner;
  readonly now?: () => Date;
}

/** Durable current-user-approved provider installation registry. */
export class AttestedProviderDesktopRegistry {
  private readonly store: ProtectedJsonStore;
  private readonly catalog: FixedProviderDesktopCatalog;
  private readonly identityProbe: ProviderExecutableIdentityProbe;
  private readonly presence: WindowsUserPresenceRunner;
  private readonly now: () => Date;

  constructor(options: AttestedProviderDesktopRegistryOptions) {
    if (!options.store.hasAuthenticatedProtection) throw new Error("The provider registry requires authenticated durable storage.");
    this.store = options.store;
    this.catalog = options.catalog;
    this.identityProbe = options.identityProbe;
    this.presence = options.presence;
    this.now = options.now ?? (() => new Date());
  }

  configuration(provider: ProviderId): ProviderCatalogEntry { return this.catalog.get(provider); }

  async install(providerInput: ProviderId): Promise<ProviderInstallation> {
    const provider = assertProvider(providerInput);
    const entry = this.catalog.get(provider);
    const inspected = await this.identityProbe.inspect(entry);
    const approval = await this.presence.verify(`Approve ${entry.productIdentity.displayName} at its fixed host path with SHA-256 ${inspected.executableSha256}.`);
    const operator = approvedOperator(approval);
    const finalIdentity = await this.identityProbe.inspect(entry);
    if (!sameIdentity(inspected, finalIdentity)) throw new Error("The provider executable identity changed during current-user approval.");
    const payload = installPayload(provider, entry, finalIdentity, operator);

    return this.store.transaction(async (transaction) => {
      const state = stateFromEntries(await transaction.readEntries<JsonValue>());
      const current = state.get(provider);
      if (current?.status === "active" && current.catalogDigest === entry.catalogDigest && sameIdentity(current.identity, finalIdentity)) return current;
      const journal = await transaction.append<ProviderInstallPayload>(installKind, payload);
      return installationFromInstall(journal, payload);
    });
  }

  async revoke(providerInput: ProviderId): Promise<ProviderInstallation> {
    const provider = assertProvider(providerInput);
    const current = (await this.state()).get(provider);
    if (!current || current.status !== "active") throw new Error("The provider is not installed or is already revoked.");
    const approval = await this.presence.verify(`Revoke the exact current-user-approved ${current.identity.productIdentity.displayName} installation.`);
    const operator = approvedOperator(approval);
    return this.store.transaction(async (transaction) => {
      const latest = stateFromEntries(await transaction.readEntries<JsonValue>()).get(provider);
      if (!latest || latest.status !== "active" || latest.installationId !== current.installationId) {
        throw new Error("The provider installation changed during current-user revocation approval.");
      }
      const payload: ProviderRevokePayload = { provider, installationId: latest.installationId, operator };
      const journal = await transaction.append<ProviderRevokePayload>(revokeKind, payload);
      return { ...latest, operator, status: "revoked", statusAt: journal.at };
    });
  }

  async resolve(providerInput: ProviderId): Promise<ProviderInstallation> {
    const provider = assertProvider(providerInput);
    const installation = (await this.state()).get(provider);
    if (!installation || installation.status !== "active") throw new Error("The provider is not installed or has been revoked.");
    const entry = this.catalog.get(provider);
    if (installation.catalogDigest !== entry.catalogDigest) throw new Error("The host provider catalog changed after approval.");
    const current = await this.identityProbe.inspect(entry);
    if (!sameIdentity(installation.identity, current)) throw new Error("The installed provider executable identity changed after approval.");
    return installation;
  }

  async list(): Promise<readonly ProviderInstallation[]> {
    const state = await this.state();
    return providerIds.flatMap((provider) => {
      const installation = state.get(provider);
      return installation ? [installation] : [];
    });
  }

  private async state(): Promise<Map<ProviderId, ProviderInstallation>> {
    return stateFromEntries(await this.store.readEntries<JsonValue>());
  }
}

export interface ProviderDesktopProcessObservation {
  readonly processId: number;
  readonly windowId: string;
  readonly identity: ProviderExecutableIdentity;
}

export interface ProviderProcessEffectRequest {
  readonly provider: DesktopProviderId;
  readonly operationId: string;
  readonly identity: ProviderExecutableIdentity;
  readonly signal: AbortSignal;
  readonly shell: false;
  /**
   * The process port must hold a native handle that prevents executable-image
   * replacement, verify that handle/process against `identity`, then call this
   * immediately before SetForegroundWindow/CreateProcess while the handle is
   * still held. It must not cause an effect when this callback rejects.
   */
  readonly beforeEffect: () => Promise<void>;
}

/** Injectable native Windows boundary; tests use a deterministic fake. */
export interface ProviderDesktopProcessPort {
  listRunning(identity: ProviderExecutableIdentity, signal: AbortSignal): Promise<readonly ProviderDesktopProcessObservation[]>;
  focusExisting(request: ProviderProcessEffectRequest & { readonly process: ProviderDesktopProcessObservation }): Promise<Readonly<{ processId: number }>>;
  launch(request: ProviderProcessEffectRequest & { readonly args: readonly string[]; readonly requireDistinctSurface: boolean }): Promise<Readonly<{
    processId: number;
    surfaceId: string;
    /** The native host sets this only after observing a new window/surface identity. */
    distinctSurface: boolean;
  }>>;
}

export type ProviderEffectKind = "normal" | "focus" | "launch" | "terminal_metadata";
export interface ProviderDesktopEffectGuard {
  check(input: Readonly<{
    provider: ProviderId;
    operationId: string;
    effect: ProviderEffectKind;
    phase: "admission" | "final";
  }>): Promise<{ readonly allowed: boolean; readonly reason: string }>;
}

export interface ProviderLifecycleControl {
  readonly deadline: string;
  readonly signal?: AbortSignal;
  isCancellationRequested(): Promise<boolean>;
}

export interface ProviderLifecycleOutcome {
  readonly status: "completed" | "unavailable" | "blocked" | "failed" | "cancelled" | "timed_out";
  readonly summary: string;
  readonly effect?: "focused" | "launched" | "launched_fresh";
  readonly processId?: number;
  readonly surfaceId?: string;
}

export interface ManagedTerminalProfile {
  readonly provider: ManagedTerminalProviderId;
  readonly profileName: string;
  readonly canonicalExecutablePath: string;
  readonly executableSha256: string;
  readonly productIdentity: ProviderProductIdentity;
  readonly args: readonly string[];
  readonly shell: false;
  readonly installationId: string;
  readonly catalogDigest: string;
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly requiresFinalIdentityVerification: true;
}

export interface ManagedTerminalProfileOutcome {
  readonly status: ProviderLifecycleOutcome["status"];
  readonly summary: string;
  readonly profile?: ManagedTerminalProfile;
}

export interface InstalledProviderDesktopLifecycleOptions {
  readonly registry: AttestedProviderDesktopRegistry;
  readonly processes: ProviderDesktopProcessPort;
  readonly effectGuard: ProviderDesktopEffectGuard;
  readonly now?: () => Date;
}

/** Fixed-profile desktop open/fresh and managed-terminal metadata boundary. */
export class InstalledProviderDesktopLifecycle {
  private readonly registry: AttestedProviderDesktopRegistry;
  private readonly processes: ProviderDesktopProcessPort;
  private readonly effectGuard: ProviderDesktopEffectGuard;
  private readonly now: () => Date;

  constructor(options: InstalledProviderDesktopLifecycleOptions) {
    this.registry = options.registry;
    this.processes = options.processes;
    this.effectGuard = options.effectGuard;
    this.now = options.now ?? (() => new Date());
  }

  async open(input: Readonly<{
    provider: ProviderId;
    mode: "normal" | "fresh";
    operationId: string;
    control: ProviderLifecycleControl;
  }>): Promise<ProviderLifecycleOutcome> {
    try {
      const provider = assertProvider(input.provider);
      const operationId = boundedReference(input.operationId, "provider operation ID");
      await assertControl(input.control, this.now);
      await this.assertGuard(provider, operationId, input.mode === "normal" ? "normal" : "launch", "admission", input.control);
      const installation = await this.resolveControlled(provider, input.control);
      const entry = this.registry.configuration(provider);
      if (entry.productIdentity.role !== "desktop") return unavailable("The requested provider is not an installed desktop application.");

      if (input.mode === "fresh") {
        if (!entry.freshArgs || entry.freshArgs.length === 0) return unavailable("The installed desktop provider has no host-reviewed fresh-surface profile.");
        return await this.launch(provider as DesktopProviderId, operationId, installation, entry.freshArgs, true, input.control);
      }

      const observations = await runControlled(input.control, this.now, (signal) => this.processes.listRunning(installation.identity, signal));
      if (observations.some((observation) => !safeObservation(observation) || !sameIdentity(observation.identity, installation.identity))) {
        return unavailable("The running provider process set did not match the exact approved executable identity.");
      }
      if (observations.length > 1) return unavailable("More than one exact provider window was observed, so focus selection is ambiguous.");
      if (observations.length === 0) return await this.launch(provider as DesktopProviderId, operationId, installation, entry.normalArgs, false, input.control);

      const process = observations[0]!;
      const focused = await runControlled(input.control, this.now, (signal) => this.processes.focusExisting({
        provider: provider as DesktopProviderId,
        operationId,
        identity: installation.identity,
        process,
        signal,
        shell: false,
        beforeEffect: () => this.finalBarrier(provider, operationId, "focus", installation, input.control)
      }));
      return { status: "completed", summary: "Focused the exact current-user-approved desktop provider window.", effect: "focused", processId: validProcessId(focused.processId) };
    } catch (error) {
      return lifecycleFailure(error);
    }
  }

  async managedTerminal(input: Readonly<{
    provider: ManagedTerminalProviderId | DesktopProviderId;
    operationId: string;
    control: ProviderLifecycleControl;
  }>): Promise<ManagedTerminalProfileOutcome> {
    try {
      const provider = assertProvider(input.provider);
      const operationId = boundedReference(input.operationId, "managed-terminal operation ID");
      await assertControl(input.control, this.now);
      await this.assertGuard(provider, operationId, "terminal_metadata", "admission", input.control);
      const installation = await this.resolveControlled(provider, input.control);
      const entry = this.registry.configuration(provider);
      if (entry.productIdentity.role !== "managed_terminal" || !entry.terminalProfileName) {
        return unavailable("The requested provider is not an installed managed-terminal provider.");
      }
      await this.finalBarrier(provider, operationId, "terminal_metadata", installation, input.control);
      const issuedAt = this.now();
      const deadline = Date.parse(input.control.deadline);
      const validUntil = new Date(Math.min(deadline, issuedAt.getTime() + terminalMetadataLifetimeMs)).toISOString();
      return {
        status: "completed",
        summary: "Issued a bounded host-attested managed-terminal profile; the companion did not spawn it.",
        profile: {
          provider: provider as ManagedTerminalProviderId,
          profileName: entry.terminalProfileName,
          canonicalExecutablePath: installation.identity.canonicalExecutablePath,
          executableSha256: installation.identity.executableSha256,
          productIdentity: installation.identity.productIdentity,
          args: entry.normalArgs,
          shell: false,
          installationId: installation.installationId,
          catalogDigest: installation.catalogDigest,
          issuedAt: issuedAt.toISOString(),
          validUntil,
          requiresFinalIdentityVerification: true
        }
      };
    } catch (error) {
      return lifecycleFailure(error);
    }
  }

  private async launch(
    provider: DesktopProviderId,
    operationId: string,
    installation: ProviderInstallation,
    args: readonly string[],
    fresh: boolean,
    control: ProviderLifecycleControl
  ): Promise<ProviderLifecycleOutcome> {
    const launched = await runControlled(control, this.now, (signal) => this.processes.launch({
      provider,
      operationId,
      identity: installation.identity,
      args,
      requireDistinctSurface: fresh,
      signal,
      shell: false,
      beforeEffect: () => this.finalBarrier(provider, operationId, "launch", installation, control)
    }));
    if (fresh && (!launched.distinctSurface || !safeSurfaceId(launched.surfaceId))) {
      throw new ProviderLifecycleError("failed", "The desktop provider did not attest a distinct fresh surface.");
    }
    if (!safeSurfaceId(launched.surfaceId)) throw new ProviderLifecycleError("failed", "The desktop provider returned an invalid surface identity.");
    return {
      status: "completed",
      summary: fresh ? "Launched a distinct host-reviewed provider surface." : "Launched the exact current-user-approved desktop provider.",
      effect: fresh ? "launched_fresh" : "launched",
      processId: validProcessId(launched.processId),
      surfaceId: launched.surfaceId
    };
  }

  private async resolve(provider: ProviderId): Promise<ProviderInstallation> {
    try { return await this.registry.resolve(provider); }
    catch { throw new ProviderLifecycleError("unavailable", "The fixed provider installation is absent, revoked, or no longer has its approved identity."); }
  }

  private async resolveControlled(provider: ProviderId, control: ProviderLifecycleControl): Promise<ProviderInstallation> {
    return runControlled(control, this.now, () => this.resolve(provider));
  }

  private async finalBarrier(
    provider: ProviderId,
    operationId: string,
    effect: "focus" | "launch" | "terminal_metadata",
    admitted: ProviderInstallation,
    control: ProviderLifecycleControl
  ): Promise<void> {
    await assertControl(control, this.now);
    const current = await this.resolveControlled(provider, control);
    if (current.installationId !== admitted.installationId || !sameIdentity(current.identity, admitted.identity)) {
      throw new ProviderLifecycleError("unavailable", "The provider installation changed before the final side effect.");
    }
    await this.assertGuard(provider, operationId, effect, "final", control);
    await assertControl(control, this.now);
  }

  private async assertGuard(provider: ProviderId, operationId: string, effect: ProviderEffectKind, phase: "admission" | "final", control: ProviderLifecycleControl): Promise<void> {
    const result = await runControlled(control, this.now, () => this.effectGuard.check({ provider, operationId, effect, phase }));
    if (!result.allowed) throw new ProviderLifecycleError("blocked", boundedSummary(result.reason));
  }
}

class ProviderLifecycleError extends Error {
  readonly status: Exclude<ProviderLifecycleOutcome["status"], "completed">;
  constructor(status: Exclude<ProviderLifecycleOutcome["status"], "completed">, message: string) {
    super(message);
    this.name = "ProviderLifecycleError";
    this.status = status;
  }
}

function unavailable(summary: string): ProviderLifecycleOutcome & ManagedTerminalProfileOutcome {
  return { status: "unavailable", summary };
}

function lifecycleFailure(error: unknown): ProviderLifecycleOutcome & ManagedTerminalProfileOutcome {
  if (error instanceof ProviderLifecycleError) return { status: error.status, summary: error.message };
  return { status: "failed", summary: "The provider lifecycle failed; desktop effect completion was not inferred." };
}

async function assertControl(control: ProviderLifecycleControl, now: () => Date): Promise<void> {
  const deadline = Date.parse(control.deadline);
  const current = now().getTime();
  if (!Number.isFinite(deadline)) throw new ProviderLifecycleError("unavailable", "The provider action deadline is invalid.");
  if (deadline <= current) throw new ProviderLifecycleError("timed_out", "The provider action deadline elapsed before the side effect.");
  if (deadline - current > maximumActionLifetimeMs) throw new ProviderLifecycleError("unavailable", "The provider action deadline exceeds the bounded lifetime.");
  if (control.signal?.aborted) throw new ProviderLifecycleError("cancelled", "The provider action was cancelled before the side effect.");
  let cancelled = false;
  try { cancelled = await boundedCancellationRead(control, deadline - current); }
  catch (error) {
    if (error instanceof ProviderLifecycleError) throw error;
    throw new ProviderLifecycleError("unavailable", "The durable provider cancellation state is unavailable.");
  }
  if (cancelled) throw new ProviderLifecycleError("cancelled", "The provider action was cancelled before the side effect.");
}

async function runControlled<T>(control: ProviderLifecycleControl, now: () => Date, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  await assertControl(control, now);
  const controller = new AbortController();
  let settled = false;
  let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
  const remaining = Date.parse(control.deadline) - now().getTime();
  const timeout = setTimeout(() => controller.abort(new ProviderLifecycleError("timed_out", "The provider action timed out before its bounded effect completed.")), remaining);
  const onExternalAbort = () => controller.abort(new ProviderLifecycleError("cancelled", "The provider action was cancelled before its bounded effect completed."));
  control.signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (control.signal?.aborted) onExternalAbort();
  const pollCancellation = async (): Promise<void> => {
    if (settled || controller.signal.aborted) return;
    try {
      if (await control.isCancellationRequested()) {
        controller.abort(new ProviderLifecycleError("cancelled", "The provider action was cancelled before its bounded effect completed."));
        return;
      }
    } catch {
      controller.abort(new ProviderLifecycleError("unavailable", "The durable provider cancellation state is unavailable."));
      return;
    }
    cancellationTimer = setTimeout(() => { void pollCancellation(); }, cancellationPollMs);
  };
  cancellationTimer = setTimeout(() => { void pollCancellation(); }, cancellationPollMs);
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason instanceof Error
      ? controller.signal.reason
      : new ProviderLifecycleError("cancelled", "The provider action was cancelled.")), { once: true });
  });
  const operation = Promise.resolve().then(() => run(controller.signal));
  operation.catch(() => undefined);
  try { return await Promise.race([operation, aborted]); }
  finally {
    settled = true;
    clearTimeout(timeout);
    if (cancellationTimer) clearTimeout(cancellationTimer);
    control.signal?.removeEventListener("abort", onExternalAbort);
  }
}

function stateFromEntries(entries: readonly JournalEntry<JsonValue>[]): Map<ProviderId, ProviderInstallation> {
  const state = new Map<ProviderId, ProviderInstallation>();
  for (const entry of entries) {
    if (entry.kind === installKind) {
      const payload = parseInstall(entry.payload);
      state.set(payload.provider, installationFromInstall(entry as JournalEntry<ProviderInstallPayload>, payload));
    } else if (entry.kind === revokeKind) {
      const payload = parseRevoke(entry.payload);
      const current = state.get(payload.provider);
      if (current?.installationId === payload.installationId) state.set(payload.provider, { ...current, operator: payload.operator, status: "revoked", statusAt: entry.at });
    }
  }
  return state;
}

function installationFromInstall(entry: JournalEntry<ProviderInstallPayload>, payload: ProviderInstallPayload): ProviderInstallation {
  return {
    provider: payload.provider,
    installationId: entry.id,
    catalogDigest: payload.catalogDigest,
    identity: {
      canonicalExecutablePath: payload.canonicalExecutablePath,
      executableSha256: payload.executableSha256,
      productIdentity: { productId: payload.productId, displayName: payload.displayName, publisher: payload.publisher, role: payload.role },
      size: payload.size,
      modifiedMs: payload.modifiedMs,
      device: payload.device,
      inode: payload.inode
    },
    operator: payload.operator,
    installedAt: entry.at,
    statusAt: entry.at,
    status: "active"
  };
}

function installPayload(provider: ProviderId, entry: ProviderCatalogEntry, identity: ProviderExecutableIdentity, operator: string): ProviderInstallPayload {
  return {
    provider,
    catalogDigest: entry.catalogDigest,
    canonicalExecutablePath: identity.canonicalExecutablePath,
    executableSha256: identity.executableSha256,
    productId: identity.productIdentity.productId,
    displayName: identity.productIdentity.displayName,
    publisher: identity.productIdentity.publisher,
    role: identity.productIdentity.role,
    size: identity.size,
    modifiedMs: identity.modifiedMs,
    device: identity.device,
    inode: identity.inode,
    operator
  };
}

function parseInstall(value: JsonValue): ProviderInstallPayload {
  if (!record(value)
    || !isProvider(value.provider)
    || !digest(value.catalogDigest)
    || typeof value.canonicalExecutablePath !== "string"
    || !digest(value.executableSha256)
    || typeof value.productId !== "string"
    || typeof value.displayName !== "string"
    || typeof value.publisher !== "string"
    || (value.role !== "desktop" && value.role !== "managed_terminal")
    || !finiteNonNegative(value.size)
    || !finiteNonNegative(value.modifiedMs)
    || !finiteNonNegative(value.device)
    || !finiteNonNegative(value.inode)
    || typeof value.operator !== "string") throw new Error("The protected provider installation journal is malformed.");
  return value as ProviderInstallPayload;
}

function parseRevoke(value: JsonValue): ProviderRevokePayload {
  if (!record(value) || !isProvider(value.provider) || typeof value.installationId !== "string" || typeof value.operator !== "string") {
    throw new Error("The protected provider revocation journal is malformed.");
  }
  return value as ProviderRevokePayload;
}

function approvedOperator(value: Awaited<ReturnType<WindowsUserPresenceRunner["verify"]>>): string {
  if (!value.verified || !value.operator || !/^[A-Za-z0-9_.@\\ -]{1,160}$/.test(value.operator)) {
    throw new Error("Current-user presence did not approve the provider registry change.");
  }
  return value.operator;
}

function safeObservation(value: ProviderDesktopProcessObservation): boolean {
  return Number.isSafeInteger(value.processId) && value.processId > 0
    && typeof value.windowId === "string" && /^[A-Za-z0-9:._-]{1,160}$/.test(value.windowId);
}

function sameIdentity(left: ProviderExecutableIdentity, right: ProviderExecutableIdentity): boolean {
  return samePath(left.canonicalExecutablePath, right.canonicalExecutablePath)
    && left.executableSha256 === right.executableSha256
    && stableJson(left.productIdentity) === stableJson(right.productIdentity)
    && left.size === right.size
    && left.modifiedMs === right.modifiedMs
    && left.device === right.device
    && left.inode === right.inode;
}

function fixedExecutablePath(value: string, provider: ProviderId): string {
  if (typeof value !== "string" || value.length > 4_096 || /[\0\r\n]/.test(value) || !isAbsolute(value)) {
    throw new Error(`The fixed ${provider} executable must be a bounded absolute host path.`);
  }
  const path = resolve(value);
  if (!/\.exe$/i.test(path)) throw new Error(`The fixed ${provider} provider executable must be an .exe file.`);
  return path;
}

function boundedReference(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\0\r\n]/.test(value)) throw new ProviderLifecycleError("unavailable", `The ${label} is invalid.`);
  return value;
}

function boundedSummary(value: string): string {
  const summary = typeof value === "string" ? value.replace(/[\0\r\n]+/g, " ").trim().slice(0, 512) : "";
  return summary || "The provider effect fence denied the operation.";
}

function validProcessId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("The provider process boundary returned an invalid process identity.");
  return value;
}

function safeSurfaceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,160}$/.test(value);
}

async function boundedCancellationRead(control: ProviderLifecycleControl, remainingMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const bounded = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProviderLifecycleError("timed_out", "The provider deadline elapsed while reading cancellation state.")), remainingMs);
    if (control.signal) {
      onAbort = () => reject(new ProviderLifecycleError("cancelled", "The provider action was cancelled while reading durable state."));
      control.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  try { return await Promise.race([control.isCancellationRequested(), bounded]); }
  finally {
    if (timer) clearTimeout(timer);
    if (control.signal && onAbort) control.signal.removeEventListener("abort", onAbort);
  }
}

function assertProvider(value: ProviderId): ProviderId {
  if (!isProvider(value)) throw new Error("The provider identity is not part of the fixed host catalog.");
  return value;
}

function isProvider(value: unknown): value is ProviderId { return providerIds.includes(value as ProviderId); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function finiteNonNegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function record(value: JsonValue): value is { readonly [key: string]: JsonValue } { return typeof value === "object" && value !== null && !Array.isArray(value); }
function pathKey(value: string): string { const normalized = value.replaceAll("\\", "/").replace(/\/+$/, ""); return process.platform === "win32" ? normalized.toLowerCase() : normalized; }
function samePath(left: string, right: string): boolean { return pathKey(left) === pathKey(right); }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectHash);
    stream.once("end", resolveHash);
  });
  return hash.digest("hex");
}
