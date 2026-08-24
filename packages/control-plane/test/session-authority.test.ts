import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthorityLedger } from "../src/authority.ts";
import { ProtectedJsonStore } from "../src/store.ts";
import { SessionCapabilityError, SessionRegistry } from "../src/session-registry.ts";

async function withStore(run: (store: ProtectedJsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-session-test-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected-audit.jsonl") }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("session registry never infers verified blocked or finished state without observability", async () => {
  await withStore(async (store) => {
    const registry = new SessionRegistry(store, { clock: () => "2026-08-23T10:00:00.000Z" });
    await registry.register({
      id: "session-1",
      provider: "codex",
      surface: "vscode_terminal",
      capabilities: ["registered"],
      status: "unknown",
      workspaceRoot: "C:/repos/one",
      plannedFiles: [],
      adapterVersion: "1.0.0",
      metadata: { terminalId: "7" }
    });

    await assert.rejects(registry.setStatus("session-1", "verified_blocked"), SessionCapabilityError);
    await registry.setCapabilities("session-1", ["registered", "observable", "controllable"]);
    await registry.setStatus("session-1", "verified_blocked");
    assert.equal((await registry.requireCapabilities("session-1", ["observable"])).allowed, true);

    const reloaded = new SessionRegistry(store);
    assert.equal((await reloaded.get("session-1"))?.status, "verified_blocked");
    assert.equal((await reloaded.listByStatus("verified_blocked")).length, 1);
  });
});

test("heartbeats persist, stale state is explicit, and a heartbeat never guesses a new working state", async () => {
  await withStore(async (store) => {
    const registry = new SessionRegistry(store, { clock: () => "2026-08-23T10:00:00.000Z" });
    await registry.register({
      id: "session-2",
      provider: "claude",
      surface: "vscode_terminal",
      capabilities: ["registered", "observable"],
      status: "running",
      plannedFiles: [],
      adapterVersion: "1.0.0",
      metadata: {}
    });
    await registry.markStale("2026-08-23T10:10:00.000Z", 1_000);
    assert.equal((await registry.get("session-2"))?.status, "stale");
    await registry.heartbeat("session-2", "2026-08-23T10:11:00.000Z");
    assert.equal((await registry.get("session-2"))?.status, "stale");
  });
});

test("trusted companion persistence can upsert a normalized session without retaining a stale elevated capability", async () => {
  await withStore(async (store) => {
    const registry = new SessionRegistry(store, { clock: () => "2026-08-23T10:00:00.000Z" });
    await registry.register({
      id: "session-upsert", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "mediated"],
      status: "running", plannedFiles: ["src/one.ts"], adapterVersion: "trusted", metadata: { source: "trusted-host" }
    });
    const normalized = await registry.upsert({
      id: "session-upsert", provider: "generic", surface: "vscode_terminal", capabilities: ["registered"],
      status: "unknown", plannedFiles: [], adapterVersion: "bridge", metadata: { source: "json-registration" }
    });
    assert.deepEqual(normalized.capabilities, ["registered"]);
    assert.equal(normalized.status, "unknown");
    assert.equal((await new SessionRegistry(store).get("session-upsert"))?.provider, "generic");
  });
});

test("authority is exact-scoped, expires, and survives revocation/reload", async () => {
  await withStore(async (store) => {
    const ledger = new AuthorityLedger(store, {
      clock: () => "2026-08-23T10:00:00.000Z",
      idFactory: () => "grant-1"
    });
    const grant = await ledger.issue({
      repositoryRoot: "C:/repos/one",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      allowedActions: ["proof.normal"],
      prohibitedActions: ["commit.merge"],
      expiresAt: "2026-08-23T11:00:00.000Z",
      issuedBy: "authenticated-user"
    });

    assert.equal((await ledger.evaluate({
      authorityId: grant.id,
      repositoryRoot: "C:/repos/one",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      action: "proof.normal"
    })).allowed, true);
    assert.equal((await ledger.evaluate({
      authorityId: grant.id,
      repositoryRoot: "C:/repos/two",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      action: "proof.normal"
    })).allowed, false);
    assert.equal((await ledger.evaluate({
      authorityId: grant.id,
      repositoryRoot: "C:/repos/one",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      action: "commit.merge"
    })).allowed, false);
    const expired = await ledger.evaluate({
      authorityId: grant.id,
      repositoryRoot: "C:/repos/one",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      action: "proof.normal",
      now: "2026-08-23T11:01:00.000Z"
    });
    assert.equal(expired.allowed, false);
    assert.match(expired.reason, /expired/i);

    await ledger.revoke(grant.id, "operator containment");
    const reloaded = new AuthorityLedger(store, { clock: () => "2026-08-23T10:30:00.000Z" });
    const decision = await reloaded.evaluate({
      authorityId: grant.id,
      repositoryRoot: "C:/repos/one",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      action: "proof.normal"
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /revoked/i);
  });
});
