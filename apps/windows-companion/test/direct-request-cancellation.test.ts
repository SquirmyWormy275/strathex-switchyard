import assert from "node:assert/strict";
import test from "node:test";

import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import type { VoiceCoordinator } from "../../../packages/control-plane/src/voice.ts";
import type { CouncilResourceBrokerPort } from "../src/council-resource-broker.ts";
import type { ProviderHandshakeCoordinator } from "../src/remote-adapters.ts";
import type { CompanionRequest } from "../src/bridge.ts";
import { CompanionService, type MediatedCommandExecutor, type VoiceRuntimeCoordinator } from "../src/service.ts";

const providerSession: ManagedSession = {
  id: "provider-session",
  provider: "claude",
  surface: "bridge",
  capabilities: ["registered"],
  status: "unknown",
  workspaceRoot: "C:\\repo",
  plannedFiles: [],
  lastHeartbeat: "2026-08-25T00:00:00.000Z",
  adapterVersion: "test",
  metadata: {}
};

test("direct voice request receives the exact transport signal and settles before a late provider rejection", async () => {
  const call = cancellableDirectCall();
  const runtime = {
    mute: call.invoke,
    async open() { throw new Error("not used"); },
    async switchProvider() { throw new Error("not used"); },
    async bindManagedSession() { throw new Error("not used"); },
    async resume() { throw new Error("not used"); },
    async interrupt() { throw new Error("not used"); },
    async end() { throw new Error("not used"); },
    async deleteTranscript() { throw new Error("not used"); }
  } as unknown as VoiceRuntimeCoordinator;
  const service = new CompanionService({ voice: {} as VoiceCoordinator, voiceRuntime: runtime });
  await assertDirectCancellation(service, request("voice", "voice.mute", { bindingId: "binding-1" }), call);
});

test("direct provider handshake receives the exact transport signal and settles before late rejection", async () => {
  const call = cancellableDirectCall();
  const service = new CompanionService({ providerHandshakes: { handshake: call.invoke } as unknown as ProviderHandshakeCoordinator });
  service.installTrustedSession(providerSession);
  await assertDirectCancellation(service, request("provider", "provider.handshake", { sessionId: providerSession.id, repositoryRoot: providerSession.workspaceRoot }), call);
});

test("direct Council request receives the exact transport signal and settles before late rejection", async () => {
  const call = cancellableDirectCall();
  const council = {
    activatePortProxy: call.invoke,
    async credentialNetwork() { throw new Error("not used"); },
    async shutdownForRestart() {}
  } as unknown as CouncilResourceBrokerPort;
  const service = new CompanionService({ councilResources: council });
  await assertDirectCancellation(service, request("council", "council.port-proxy.activate", {
    epochId: "epoch-1", sessionId: "session-1", targetSnapshotId: "target-1", leaseId: "lease-1", operationId: "operation-1",
    fenceDigest: "fence-1", resourceHostDigest: "host-1", expectedPort: "43123", backendPipePath: "\\\\.\\pipe\\sxsy-b122-council-operation-1", backendProof: "proof-1"
  }), call);
});

test("direct provider administration receives the exact transport signal and settles before late rejection", async () => {
  const call = cancellableDirectCall();
  const service = new CompanionService({
    providerDesktopRegistry: {
      async install() { throw new Error("not used"); },
      list: call.invoke,
      async revoke() { throw new Error("not used"); }
    }
  });
  await assertDirectCancellation(service, request("administration", "provider-desktop.list"), call);
});

test("every direct administration family receives transport cancellation", async (context) => {
  const families: ReadonlyArray<Readonly<{
    name: string;
    method: CompanionRequest["method"];
    service(call: DirectCallFixture): CompanionService;
  }>> = [
    { name: "runtime pins", method: "runtime.pin.list", service: (call) => new CompanionService({ runtimePins: { list: call.invoke } as never }) },
    { name: "sandbox", method: "sandbox.list", service: (call) => new CompanionService({ sandboxInstallations: { list: call.invoke } as never }) },
    { name: "credentials", method: "credential.list", service: (call) => new CompanionService({ credentialProvisioning: { list: call.invoke } as never }) },
    { name: "network policy", method: "network-policy.current", service: (call) => new CompanionService({ networkPolicyProvisioning: { current: call.invoke } as never }) },
    { name: "acceptance", method: "acceptance.trust.list", service: (call) => new CompanionService({ acceptanceAdministration: { listTrust: call.invoke } as never }) },
    { name: "scanner", method: "scanner.trust.list", service: (call) => new CompanionService({ scannerAdministration: { listTrust: call.invoke } as never }) },
    { name: "Raw-HID", method: "raw-hid.list", service: (call) => new CompanionService({ rawHidInstallations: { list: call.invoke } as never }) }
  ];
  for (const family of families) {
    await context.test(family.name, async () => {
      const call = cancellableDirectCall();
      await assertDirectCancellation(family.service(call), request(`administration-${family.name}`, family.method, family.name === "network policy" ? { repositoryRoot: "C:\\repo" } : undefined), call);
    });
  }
});

test("transport cancellation does not cancel an admitted durable command dispatch", async () => {
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const executor: MediatedCommandExecutor = {
    async execute() {
      enter();
      await released;
      return { status: "completed", summary: "Durable effect reconciled.", operationId: "operation-1" };
    }
  };
  const service = new CompanionService({ executor });
  const controller = new AbortController();
  let settled = false;
  const responsePromise = service.handle(request("dispatch", "command.dispatch", { control: "PROOF", modifier: "normal" }), { signal: controller.signal }).then((response) => {
    settled = true;
    return response;
  });
  await entered;
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(settled, false, "transport cancellation incorrectly cancelled an admitted durable dispatch");
  release();
  const response = await responsePromise;
  assert.equal(response.ok, true);
  assert.equal((response.result as { command: { status: string } }).command.status, "completed");
});

interface DirectCallFixture {
  readonly invoke: (...args: unknown[]) => Promise<never>;
  readonly entered: Promise<void>;
  signal(): AbortSignal | undefined;
  forceReject(): void;
  readonly rejected: Promise<void>;
}

function cancellableDirectCall(): DirectCallFixture {
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  let rejectOperation!: (error: Error) => void;
  let rejectObserved!: () => void;
  const rejected = new Promise<void>((resolve) => { rejectObserved = resolve; });
  let received: AbortSignal | undefined;
  let rejectionScheduled = false;
  const forceReject = (): void => {
    if (rejectionScheduled) return;
    rejectionScheduled = true;
    rejectOperation(new Error("late direct fixture rejection"));
    rejectObserved();
  };
  const invoke = (...args: unknown[]): Promise<never> => {
    const options = args.at(-1) as { readonly signal?: AbortSignal } | undefined;
    received = options?.signal;
    enter();
    const pending = new Promise<never>((_resolve, reject) => { rejectOperation = reject; });
    received?.addEventListener("abort", () => setTimeout(forceReject, 20), { once: true });
    if (received?.aborted) setTimeout(forceReject, 20);
    return pending;
  };
  return { invoke, entered, signal: () => received, forceReject, rejected };
}

async function assertDirectCancellation(service: CompanionService, candidate: CompanionRequest, call: DirectCallFixture): Promise<void> {
  const controller = new AbortController();
  const responsePromise = service.handle(candidate, { signal: controller.signal });
  try {
    await call.entered;
    assert.equal(call.signal(), controller.signal);
    controller.abort();
    const response = await Promise.race([
      responsePromise,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("direct request did not settle after transport cancellation")), 500))
    ]);
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "companion_unavailable");
    await call.rejected;
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    controller.abort();
    call.forceReject();
    await responsePromise.catch(() => undefined);
  }
}

function request(id: string, method: CompanionRequest["method"], payload?: unknown): CompanionRequest {
  return { version: 1, id, method, payload };
}
