import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { companionBridgeVersion, type CompanionRequest } from "../src/bridge.ts";
import { DurableCompanionEndpoint, DurableCompanionEndpointError } from "../src/durable-endpoint.ts";
import { CompanionService } from "../src/service.ts";

async function withRegistry(run: (registry: SessionRegistry) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-durable-endpoint-"));
  try {
    const store = new ProtectedJsonStore({
      filePath: join(directory, "protected-audit.jsonl"),
      clock: () => "2026-08-23T12:00:00.000Z",
      idFactory: sequenceFactory("entry")
    });
    await run(new SessionRegistry(store, { clock: () => "2026-08-23T12:00:00.000Z" }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function trustedSession(id = "terminal-1"): ManagedSession {
  return {
    id,
    provider: "claude",
    surface: "vscode_terminal",
    capabilities: ["registered", "observable", "mediated"],
    status: "running",
    workspaceRoot: "C:/safe/repo",
    plannedFiles: ["src/owned.ts"],
    lastHeartbeat: "2026-08-23T12:00:00.000Z",
    adapterVersion: "trusted-adapter",
    metadata: { source: "trusted-registry" }
  };
}

function request(id: string, method: CompanionRequest["method"], payload?: unknown): CompanionRequest {
  return { version: companionBridgeVersion, id, method, payload };
}

test("hydrates protected sessions through installTrustedSession before exposing the endpoint", async () => {
  await withRegistry(async (registry) => {
    await registry.register(trustedSession());
    const endpoint = new DurableCompanionEndpoint(new CompanionService(), registry);
    await endpoint.ready();

    const sessions = await endpoint.listSessions();
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0]?.capabilities, ["registered", "observable", "mediated"]);
    assert.equal(sessions[0]?.status, "running");
  });
});

test("awaits no-replay startup recovery before accepting a request", async () => {
  await withRegistry(async (registry) => {
    let signalRecoveryStarted!: () => void;
    const recoveryStarted = new Promise<void>((resolve) => { signalRecoveryStarted = resolve; });
    let releaseRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const endpoint = new DurableCompanionEndpoint(new CompanionService(), registry, {
      startupRecovery: async () => {
        signalRecoveryStarted();
        await recoveryGate;
      }
    });

    await recoveryStarted;
    let requestCompleted = false;
    const responsePromise = endpoint.handle(request("queued-during-recovery", "session.list")).then((response) => {
      requestCompleted = true;
      return response;
    });
    await Promise.resolve();
    assert.equal(requestCompleted, false);

    releaseRecovery();
    const response = await responsePromise;
    assert.equal(response.ok, true);
    assert.deepEqual(response.result, []);
  });
});

test("a startup recovery failure leaves the durable endpoint fail-closed", async () => {
  await withRegistry(async (registry) => {
    const endpoint = new DurableCompanionEndpoint(new CompanionService(), registry, {
      startupRecovery: async () => { throw new Error("recovery probe unavailable"); }
    });

    await assert.rejects(endpoint.ready(), DurableCompanionEndpointError);
    const response = await endpoint.handle(request("recovery-failed", "session.list"));
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "companion_unavailable");
    await assert.rejects(endpoint.listSessions(), DurableCompanionEndpointError);
  });
});

test("persists normalized lifecycle updates and prevents a raw re-registration from retaining trusted capability after restart", async () => {
  await withRegistry(async (registry) => {
    await registry.register(trustedSession("terminal-2"));
    const endpoint = new DurableCompanionEndpoint(new CompanionService(), registry);
    await endpoint.ready();

    const rawRegistration = await endpoint.handle(request("raw-register", "session.register", { session: trustedSession("terminal-2") }));
    assert.equal(rawRegistration.ok, true);
    const normalized = rawRegistration.result as ManagedSession;
    assert.deepEqual(normalized.capabilities, ["registered"]);
    assert.equal(normalized.status, "unknown");

    const adopted = await endpoint.handle(request("adopt", "terminal.adopt", {
      sessionId: "terminal-2", adoptionKey: "terminal:two", provider: "codex"
    }));
    assert.equal(adopted.ok, true);
    const status = await endpoint.handle(request("status", "session.status", { sessionId: "terminal-2", status: "running" }));
    assert.equal(status.ok, true);
    const heartbeat = await endpoint.handle(request("heartbeat", "session.heartbeat", {
      sessionId: "terminal-2", at: "2026-08-23T12:05:00.000Z"
    }));
    assert.equal(heartbeat.ok, true);

    const persisted = await registry.get("terminal-2");
    assert.deepEqual(persisted?.capabilities, ["registered"]);
    assert.equal(persisted?.provider, "codex");
    assert.equal(persisted?.status, "running");
    assert.equal(persisted?.lastHeartbeat, "2026-08-23T12:05:00.000Z");

    const restarted = new DurableCompanionEndpoint(new CompanionService(), registry);
    await restarted.ready();
    const recovered = (await restarted.listSessions())[0];
    assert.deepEqual(recovered?.capabilities, ["registered"]);
    assert.equal(recovered?.metadata["sxsy-b122.adoptionKey"], "terminal:two");

    const duplicateAdoption = await restarted.handle(request("duplicate", "terminal.adopt", {
      sessionId: "terminal-2", adoptionKey: "terminal:two", provider: "claude"
    }));
    assert.equal(duplicateAdoption.ok, false);
    assert.equal(duplicateAdoption.error?.code, "already_adopted");
  });
});

test("a persistence write failure returns a companion error and closes the endpoint", async () => {
  await withRegistry(async (registry) => {
    const failingPersistence = {
      list: (): Promise<readonly ManagedSession[]> => registry.list(),
      upsert: async (): Promise<ManagedSession> => { throw new Error("disk unavailable"); }
    } as unknown as SessionRegistry;
    const endpoint = new DurableCompanionEndpoint(new CompanionService(), failingPersistence);
    await endpoint.ready();

    const response = await endpoint.handle(request("register", "session.register", { session: trustedSession("terminal-3") }));
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "companion_unavailable");
    await assert.rejects(endpoint.listSessions(), DurableCompanionEndpointError);

    const retry = await endpoint.handle(request("retry", "session.list"));
    assert.equal(retry.ok, false);
    assert.equal(retry.error?.code, "companion_unavailable");
  });
});

function sequenceFactory(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}
