import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthorityLedger, ContainmentController, CouncilCoordinator, DeterministicAdapter, DeterministicExecutionBroker, DeterministicProviderAdapter, DeterministicTestEnvironmentBroker, LeaseRegistry, OperationCoordinator, ProtectedStore,
  SafeLocalExecutionBroker, SessionRegistry, UnavailableAdapter, UnavailableProviderAdapter, captureTargetSnapshot, createContextPackage, createReviewPackage, type ManagedSession
} from "../src/control-plane.ts";
import { assignments } from "../../../packages/protocol/src/b122.ts";

const snapshot = (revision = "a") => captureTargetSnapshot({ gitRoot: ".", remote: "https://example.invalid/acme/repo.git", branch: "feature/a", head: revision, indexTree: revision, tracked: ["src/a.ts:1"], untracked: [], submodules: [], policyVersion: "policy-1", toolFingerprint: "tools-1", environmentFingerprint: "env-1" });
const session = (target = snapshot()): ManagedSession => ({ id: "codex-1", provider: "codex", adapterVersion: "test", surface: "vscode", windowId: "window-1", target, task: "task", planRevision: "plan-1", plannedFiles: ["src/a.ts"], capability: { registered: true, observable: true, controllable: true, mediated: true }, status: "running", lastHeartbeat: Date.now(), focused: true, authorityVersion: "authority-v1" });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-test-"));
  const store = new ProtectedStore(join(directory, "protected-store.json")); await store.load();
  const registry = new SessionRegistry(); const selected = session(); registry.register(selected);
  const authorities = new AuthorityLedger(); authorities.issue({ id: "authority", version: "authority-v1", sessionId: selected.id, targetDigest: selected.target!.digest, planRevision: "plan-1", allowedActions: assignments.map((item) => `${item.control}:${item.modifier}`), prohibitions: [], expiresAt: Date.now() + 60_000 });
  return { directory, store, registry, authorities, selected };
}

test("TargetSnapshot hashes dirty inputs, policy, and environment instead of only HEAD", () => {
  assert.notEqual(snapshot("same").digest, captureTargetSnapshot({ gitRoot: ".", remote: "https://example.invalid/acme/repo.git", branch: "feature/a", head: "same", indexTree: "same", tracked: ["src/a.ts:changed"], untracked: [], submodules: [], policyVersion: "policy-1", toolFingerprint: "tools-1", environmentFingerprint: "env-1" }).digest);
  assert.notEqual(snapshot("same").digest, captureTargetSnapshot({ gitRoot: ".", remote: "https://example.invalid/acme/repo.git", branch: "feature/a", head: "same", indexTree: "same", tracked: ["src/a.ts:1"], untracked: [".env"], submodules: [], policyVersion: "policy-1", toolFingerprint: "tools-1", environmentFingerprint: "env-1" }).digest);
});

test("registry preserves capability truth and never infers blocked or finished from unknown", () => {
  const registry = new SessionRegistry(); registry.register({ ...session(), status: "unknown", capability: { registered: true, observable: false, controllable: false, mediated: false } });
  assert.equal(registry.discover("verified_blocked").length, 0);
  assert.equal(registry.discover("verified_finished").length, 0);
  assert.equal(registry.applyCapabilityReport("codex-1", { capability: { registered: true, observable: false, controllable: false, mediated: false }, status: "verified_finished", heartbeat: Date.now(), evidenceDigest: "proof" }), undefined);
  assert.equal(registry.applyCapabilityReport("codex-1", { capability: { registered: true, observable: true, controllable: false, mediated: false }, status: "verified_finished", heartbeat: Date.now(), evidenceDigest: "provider-event" })?.status, "verified_finished");
});

test("all 65 settled controls dispatch and intentionally unassigned chords do not", async () => {
  const setup = await fixture();
  try {
    const coordinator = new OperationCoordinator(setup.store, setup.registry, setup.authorities, new DeterministicAdapter(), new SafeLocalExecutionBroker());
    for (const assignment of assignments) {
      const result = await coordinator.dispatch({ control: assignment.control, modifier: assignment.modifier, sessionId: setup.selected.id, authorityId: "authority", target: setup.selected.target });
      assert.notEqual(result.status, "unassigned", `${assignment.control}:${assignment.modifier}`);
    }
    assert.equal((await coordinator.dispatch({ control: "REANCHOR", modifier: "ctrl", sessionId: setup.selected.id })).status, "unassigned");
  } finally { await rm(setup.directory, { recursive: true, force: true }); }
});

test("high-consequence controls create a durable blocked operation without external execution", async () => {
  const setup = await fixture();
  try {
    const adapter = new DeterministicAdapter(); const coordinator = new OperationCoordinator(setup.store, setup.registry, setup.authorities, adapter);
    const result = await coordinator.dispatch({ control: "COMMIT", modifier: "alt", sessionId: setup.selected.id, authorityId: "authority", target: setup.selected.target });
    assert.equal(result.status, "blocked"); assert.ok(result.operationId); assert.equal(adapter.calls.length, 0);
    assert.equal(setup.store.allOperations()[0]?.status, "blocked");
  } finally { await rm(setup.directory, { recursive: true, force: true }); }
});

test("scoped authority, containment, and safe broker failures fail closed", async () => {
  const setup = await fixture();
  try {
    const coordinator = new OperationCoordinator(setup.store, setup.registry, setup.authorities, new DeterministicAdapter());
    const denied = await coordinator.dispatch({ control: "PIPELINE", modifier: "shift", sessionId: setup.selected.id, authorityId: "missing", target: setup.selected.target });
    assert.equal(denied.status, "blocked");
    const stale = await coordinator.dispatch({ control: "PIPELINE", modifier: "shift", sessionId: setup.selected.id, authorityId: "authority", target: snapshot("other-revision") });
    assert.equal(stale.status, "blocked"); assert.match(stale.reason, /snapshot changed/i);
    const containment = new ContainmentController(setup.store); await containment.activate(setup.selected.target!);
    const contained = await coordinator.dispatch({ control: "PIPELINE", modifier: "shift", sessionId: setup.selected.id, authorityId: "authority", target: setup.selected.target });
    assert.equal(contained.status, "blocked"); assert.equal(await containment.release(setup.selected.target!, false, ""), false); assert.equal(await containment.release(setup.selected.target!, true, "reviewed incident"), true);
    const unavailable = await coordinator.dispatch({ control: "PIPELINE", modifier: "shift", sessionId: setup.selected.id, authorityId: "authority", target: setup.selected.target });
    assert.equal(unavailable.status, "unavailable");
  } finally { await rm(setup.directory, { recursive: true, force: true }); }
});

test("restart recovery reconciles ambiguous external children and receipt chains are protected", async () => {
  const setup = await fixture();
  try {
    const adapter = new DeterministicAdapter(); const coordinator = new OperationCoordinator(setup.store, setup.registry, setup.authorities, adapter);
    const operation = { id: "ambiguous", idempotencyKey: "ambiguous", action: "COMMIT:shift", targetDigest: setup.selected.target!.digest, status: "executing" as const, childIds: [], externalReference: "pr-42", updatedAt: Date.now() };
    await setup.store.putOperation(operation); await coordinator.recover();
    assert.equal(setup.store.allOperations()[0]?.status, "recorded");
    const child = await coordinator.child("ambiguous", "push", setup.selected.target!);
    assert.equal(child.parentId, "ambiguous"); assert.ok(setup.store.allOperations().find((item) => item.id === "ambiguous")?.childIds.includes(child.id));
    const first = await setup.store.receipt({ operationId: "ambiguous", outcome: "passed", target: setup.selected.target!, evidenceDigest: "x", policyVersion: "p", createdAt: 1, expiresAt: 2 });
    const second = await setup.store.receipt({ operationId: "child", outcome: "passed", target: setup.selected.target!, evidenceDigest: "y", policyVersion: "p", createdAt: 2, expiresAt: 3 });
    assert.equal(second.previousHash, first.hash); assert.ok(second.hash);
    await writeFile(join(setup.directory, "protected-store.json"), "{\"version\":1,\"containment\":{},\"operations\":{},\"receipts\":[{\"hash\":\"tampered\"}],\"audit\":[]}", "utf8");
    await assert.rejects(new ProtectedStore(join(setup.directory, "protected-store.json")).load(), /integrity verification/i);
  } finally { await rm(setup.directory, { recursive: true, force: true }); }
});

test("Pipeline uses an isolated test-environment broker before executing", async () => {
  const setup = await fixture();
  try {
    const execution = new DeterministicExecutionBroker(); const coordinator = new OperationCoordinator(setup.store, setup.registry, setup.authorities, new DeterministicAdapter(), execution, new DeterministicTestEnvironmentBroker());
    const result = await coordinator.dispatch({ control: "PIPELINE", modifier: "shift", sessionId: setup.selected.id, authorityId: "authority", target: setup.selected.target });
    assert.equal(result.status, "recorded"); assert.deepEqual(execution.calls, ["PIPELINE:shift"]);
    const repeated = await coordinator.dispatch({ control: "PIPELINE", modifier: "shift", sessionId: setup.selected.id, authorityId: "expired", target: setup.selected.target });
    assert.equal(repeated.status, "recorded"); assert.deepEqual(execution.calls, ["PIPELINE:shift"]);
  } finally { await rm(setup.directory, { recursive: true, force: true }); }
});

test("unavailable provider adapters are explicit and never execute a happy path", async () => {
  const adapter = new UnavailableAdapter("claude", "Claude is not installed.");
  assert.equal((await adapter.execute({ id: "x", idempotencyKey: "x", action: "x", targetDigest: "x", status: "prepared", childIds: [], updatedAt: 1 }, { control: "CLAUDE", modifier: "normal" })).outcome, "unavailable");
});

test("provider discovery, context/review packages, and Council leases are provider-independent", async () => {
  const registry = new SessionRegistry(); const first = session(); const second = { ...session(), id: "claude-1", provider: "claude" as const, windowId: "window-2", plannedFiles: ["src/b.ts"] };
  const adapter = new DeterministicProviderAdapter("codex", [first, second]); await registry.discoverFrom(adapter); assert.equal(registry.list().length, 2);
  const context = createContextPackage({ target: first.target!, task: "repair", planRevision: "v2", decisions: ["use broker"], authorityVersion: "authority-v1", documentation: ["README.md"], references: ["issue-1"] });
  const review = createReviewPackage({ target: first.target!, requirements: ["no production DB"], changedFiles: ["src/a.ts"], unchangedFiles: ["README.md"], testEvidence: ["pass"], risks: [] });
  assert.ok(context.digest); assert.ok(review.digest); assert.equal((await adapter.injectContext(first.id, context)).outcome, "passed");
  const council = new CouncilCoordinator(registry, new LeaseRegistry()); const prepared = council.prepareAutomatic([first.id, second.id], Date.now() + 60_000);
  assert.equal(prepared.leases.length, 2); assert.equal(prepared.reason, undefined);
  const unavailable = new UnavailableProviderAdapter("claude"); assert.equal((await unavailable.pause("claude-2")).outcome, "unavailable");
});
