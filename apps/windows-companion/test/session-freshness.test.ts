import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { SessionFreshnessCoordinator } from "../src/session-freshness.ts";

async function withRegistry(run: (registry: SessionRegistry) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-session-freshness-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl") });
    await run(new SessionRegistry(store));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function session(id: string, heartbeat: string): ManagedSession {
  return {
    id,
    provider: "claude",
    surface: "bridge",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running",
    workspaceRoot: "C:/safe/repo",
    plannedFiles: [],
    lastHeartbeat: heartbeat,
    adapterVersion: "provider-adapter-v1",
    metadata: { "sxsy-b122.providerHandshake": "exact-route-v1" }
  };
}

test("expires old sessions, rejects future heartbeat claims, and retains current sessions", async () => {
  await withRegistry(async (registry) => {
    await registry.register(session("old", "2026-08-24T00:00:00.000Z"));
    await registry.register(session("future", "2026-08-24T00:03:00.000Z"));
    await registry.register(session("current", "2026-08-24T00:01:40.000Z"));
    const coordinator = new SessionFreshnessCoordinator(registry, {
      now: () => "2026-08-24T00:02:00.000Z",
      staleAfterMs: 90_000,
      maxFutureSkewMs: 30_000,
      refreshIntervalMs: 0
    });

    const byId = new Map((await coordinator.refresh()).map((value) => [value.id, value]));
    assert.equal(byId.get("old")?.status, "stale");
    assert.equal(byId.get("future")?.status, "stale");
    assert.equal(byId.get("current")?.status, "running");
  });
});

test("persists stale state across restart and throttles repeated scans without corrupting records", async () => {
  await withRegistry(async (registry) => {
    await registry.register(session("provider", "2026-08-24T00:00:00.000Z"));
    let now = "2026-08-24T00:02:00.000Z";
    const coordinator = new SessionFreshnessCoordinator(registry, {
      now: () => now,
      staleAfterMs: 60_000,
      refreshIntervalMs: 5_000
    });
    assert.equal((await coordinator.refresh())[0]?.status, "stale");

    await registry.upsert({ ...session("provider", "2026-08-24T00:02:01.000Z"), status: "running" });
    now = "2026-08-24T00:02:02.000Z";
    assert.equal((await coordinator.refresh())[0]?.status, "running", "throttled reads return the durable current record");

    const restarted = new SessionFreshnessCoordinator(registry, {
      now: () => "2026-08-24T00:04:00.000Z",
      staleAfterMs: 60_000,
      refreshIntervalMs: 0
    });
    assert.equal((await restarted.refresh())[0]?.status, "stale");
    assert.equal((await registry.get("provider"))?.status, "stale");
  });
});
