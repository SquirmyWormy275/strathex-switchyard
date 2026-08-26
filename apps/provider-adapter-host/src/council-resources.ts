import type { Socket } from "node:net";

import {
  loadInstalledCouncilParticipantClient,
  type CouncilParticipantPortProxyHandle,
  type InstalledCouncilParticipantClient
} from "../../windows-companion/src/council-participant-client.ts";
import type { ProviderCouncilCleanupRequest, ProviderCouncilHostedResource, ProviderCouncilRequest } from "./state.ts";

export interface ProviderCouncilResourceCallbacks {
  openPortProxy(request: ProviderCouncilRequest, input: Readonly<{ leaseId: string; onConnection(socket: Socket): void }>): Promise<Readonly<{ receipt: unknown }>>;
  credentialHealth(request: ProviderCouncilRequest, input: Readonly<{ leaseId: string }>): Promise<unknown>;
}

export interface ProviderCouncilResourceLifecycle {
  readonly callbacks: ProviderCouncilResourceCallbacks;
  closeForRequest(request: ProviderCouncilRequest, signal?: AbortSignal): Promise<void>;
  closeBinding(request: ProviderCouncilCleanupRequest, signal?: AbortSignal): Promise<void>;
  closeAll(signal?: AbortSignal): Promise<void>;
}

export type ProviderCouncilParticipantLoader = (request: ProviderCouncilRequest) => Promise<InstalledCouncilParticipantClient>;

/**
 * Host-owned bridge from a digest-pinned provider module to the companion's
 * fenced Council resource service. The module selects only an exact lease ID;
 * the host derives the resource kind/environment and the fixed operation.
 */
export class InstalledProviderCouncilResourceLifecycle implements ProviderCouncilResourceLifecycle {
  readonly callbacks: ProviderCouncilResourceCallbacks;
  private readonly loader: ProviderCouncilParticipantLoader;
  private readonly portHandles = new Map<string, CouncilParticipantPortProxyHandle>();
  private readonly portActivations = new Map<string, Promise<void>>();
  private readonly portClosures = new Map<string, Promise<void>>();

  constructor(companionStateDirectory: string, loader?: ProviderCouncilParticipantLoader) {
    this.loader = loader ?? (async (request) => {
      const environment = exactEnvironment(request);
      return loadInstalledCouncilParticipantClient(companionStateDirectory, {
        ...environment,
        // This is an out-of-band exact binding, not part of the self-hashed
        // resource-host environment document.
        SXSY_COUNCIL_RESOURCE_HOST_DIGEST: requireResourceHost(request).digest
      });
    });
    const callbacks: ProviderCouncilResourceCallbacks = {
      openPortProxy: (request: ProviderCouncilRequest, input: Readonly<{ leaseId: string; onConnection(socket: Socket): void }>) => this.openPortProxy(request, input),
      credentialHealth: (request: ProviderCouncilRequest, input: Readonly<{ leaseId: string }>) => this.credentialHealth(request, input)
    };
    this.callbacks = Object.freeze(callbacks);
  }

  async closeForRequest(request: ProviderCouncilRequest, signal?: AbortSignal): Promise<void> {
    const prefix = `${request.epochId}\0${request.sessionId}\0`;
    await this.closeSelected((key) => key.startsWith(prefix), signal);
  }

  async closeBinding(request: ProviderCouncilCleanupRequest, signal?: AbortSignal): Promise<void> {
    const prefix = `${request.epochId}\0${request.sessionId}\0${request.resourceHostDigest}\0`;
    await this.closeSelected((key) => key.startsWith(prefix), signal);
  }

  async closeAll(signal?: AbortSignal): Promise<void> {
    await this.closeSelected(() => true, signal);
  }

  private async closeSelected(selected: (key: string) => boolean, signal?: AbortSignal): Promise<void> {
    const failures: unknown[] = [];
    const activations = [...this.portActivations.entries()].filter(([key]) => selected(key));
    for (const [key, activation] of activations) {
      try { await waitForResourceBoundary(activation, signal); }
      catch (error) {
        if (signal?.aborted) {
          const lateClose = activation.then(() => {
            const handle = this.portHandles.get(key);
            return handle ? this.closeHandle(key, handle) : undefined;
          }, () => undefined);
          lateClose.then(() => undefined, () => undefined);
        }
        failures.push(error);
      }
    }
    for (const [key, handle] of [...this.portHandles.entries()].filter(([candidate]) => selected(candidate))) {
      try {
        await waitForResourceBoundary(this.closeHandle(key, handle), signal);
      } catch (error) {
        // Retain the failed handle so an idempotent cleanup replay or shutdown
        // retry can close it. A failure never prevents later handles closing.
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "One or more Council participant port proxies remain open.");
  }

  private closeHandle(key: string, handle: CouncilParticipantPortProxyHandle): Promise<void> {
    const active = this.portClosures.get(key);
    if (active) return active;
    const closing = Promise.resolve().then(() => handle.close()).then(() => {
      if (this.portHandles.get(key) === handle) this.portHandles.delete(key);
    });
    const tracked = closing.finally(() => {
      if (this.portClosures.get(key) === tracked) this.portClosures.delete(key);
    });
    tracked.then(() => undefined, () => undefined);
    this.portClosures.set(key, tracked);
    return tracked;
  }

  private async openPortProxy(request: ProviderCouncilRequest, input: Readonly<{ leaseId: string; onConnection(socket: Socket): void }>): Promise<Readonly<{ receipt: unknown }>> {
    requireAssignment(request);
    if (typeof input.onConnection !== "function") throw new Error("The Council port callback is invalid.");
    const resource = exactLease(request, input.leaseId, "port");
    const key = handleKey(request, resource);
    if (this.portHandles.has(key) || this.portActivations.has(key)) throw new Error("The exact Council port lease already has a participant proxy or activation in progress.");
    let receipt: unknown;
    const activation = (async () => {
      const participant = await this.loader(request);
      const handle = await participant.openPortProxy({ leaseId: resource.leaseId, portEnvironmentName: resource.environmentName, onConnection: input.onConnection });
      if (this.portHandles.has(key)) { await handle.close().catch(() => undefined); throw new Error("The exact Council port lease was activated concurrently."); }
      this.portHandles.set(key, handle);
      receipt = handle.receipt;
    })();
    this.portActivations.set(key, activation);
    try { await activation; }
    finally { if (this.portActivations.get(key) === activation) this.portActivations.delete(key); }
    return Object.freeze({ receipt });
  }

  private async credentialHealth(request: ProviderCouncilRequest, input: Readonly<{ leaseId: string }>): Promise<unknown> {
    requireAssignment(request);
    const resource = exactLease(request, input.leaseId, "credential_scope");
    const participant = await this.loader(request);
    return participant.credentialNetwork({ leaseId: resource.leaseId, credentialEnvironmentName: resource.environmentName, routeId: "provider.health" });
  }
}

export function wrapProviderRuntimeCouncilLifecycle<T extends Readonly<{ council(request: ProviderCouncilRequest, signal: AbortSignal): Promise<unknown> }>>(port: T, resources: ProviderCouncilResourceLifecycle): T & Readonly<{ cleanupCouncilResources(request: ProviderCouncilCleanupRequest, signal?: AbortSignal): Promise<void>; abortCouncilAssignment(request: ProviderCouncilRequest, signal?: AbortSignal): Promise<void> }> {
  return new Proxy(port, {
    get(target, property, receiver) {
      if (property === "cleanupCouncilResources") return (request: ProviderCouncilCleanupRequest, signal?: AbortSignal) => resources.closeBinding(request, signal);
      if (property === "abortCouncilAssignment") return (request: ProviderCouncilRequest, signal?: AbortSignal) => resources.closeForRequest(request, signal);
      if (property !== "council") {
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (request: ProviderCouncilRequest, signal: AbortSignal) => {
        try {
          const result = await target.council(request, signal);
          return result;
        } catch (error) {
          if (request.phase === "assignment") await resources.closeForRequest(request).catch(() => undefined);
          throw error;
        }
      };
    }
  }) as T & Readonly<{ cleanupCouncilResources(request: ProviderCouncilCleanupRequest, signal?: AbortSignal): Promise<void>; abortCouncilAssignment(request: ProviderCouncilRequest, signal?: AbortSignal): Promise<void> }>;
}

function waitForResourceBoundary<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  pending.then(() => undefined, () => undefined);
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(new Error("Council resource cleanup was cancelled or exceeded its host deadline."));
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => { cleanup(); reject(new Error("Council resource cleanup was cancelled or exceeded its host deadline.")); };
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}

function requireAssignment(request: ProviderCouncilRequest): void {
  if (request.phase !== "assignment" || !request.resourceHost) throw new Error("Council resources are available only during one exact assignment.");
}
function requireResourceHost(request: ProviderCouncilRequest) { if (!request.resourceHost) throw new Error("The exact Council resource-host binding is missing."); return request.resourceHost; }
function exactEnvironment(request: ProviderCouncilRequest): Readonly<Record<string, string>> { return requireResourceHost(request).environment; }
function exactLease(request: ProviderCouncilRequest, leaseId: string, kind: ProviderCouncilHostedResource["kind"]): ProviderCouncilHostedResource {
  if (typeof leaseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(leaseId)) throw new Error("The Council resource lease identity is invalid.");
  const matches = requireResourceHost(request).resources.filter((resource) => resource.leaseId === leaseId && resource.kind === kind);
  if (matches.length !== 1) throw new Error("The Council assignment does not contain one exact requested resource lease.");
  return matches[0]!;
}
function handleKey(request: ProviderCouncilRequest, resource: ProviderCouncilHostedResource): string { return `${request.epochId}\0${request.sessionId}\0${requireResourceHost(request).digest}\0${resource.leaseId}`; }
