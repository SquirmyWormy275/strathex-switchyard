import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import {
  CodexProviderAdapterBackend,
  FixtureProviderRuntimePort,
  type ProviderRuntimeWorkflowContextObservation,
  type ProviderRuntimeWorkflowContextRequest
} from "../src/backends.ts";
import { ProviderAdapterHostService } from "../src/service.ts";
import { createProviderHostStore } from "../src/state.ts";

const token = "a".repeat(64);
const targetSnapshotId = "b".repeat(64);
const moduleSha256 = "c".repeat(64);
const repositoryRoot = "C:\\repo";

class ContextFixturePort extends FixtureProviderRuntimePort {
  sourceRevision = 7;
  contextId = "context-codex-7";
  extra: Readonly<Record<string, unknown>> = {};
  bindingChange: Readonly<Partial<ProviderRuntimeWorkflowContextObservation>> = {};
  transform?: (value: ProviderRuntimeWorkflowContextObservation) => ProviderRuntimeWorkflowContextObservation;

  constructor() { super("codex", { effectfulTestOnly: true }); }

  override async observeWorkflowContext(request: ProviderRuntimeWorkflowContextRequest): Promise<ProviderRuntimeWorkflowContextObservation> {
    const baseline = await super.observeWorkflowContext(request, new AbortController().signal);
    const value = {
      ...baseline,
      contextId: this.contextId,
      sourceRevision: this.sourceRevision,
      ...this.bindingChange,
      ...this.extra
    } as ProviderRuntimeWorkflowContextObservation;
    return this.transform?.(value) ?? value;
  }
}

async function setup(context: test.TestContext, port = new ContextFixturePort(), deadlineMs = 250) {
  const directory = await mkdtemp(join(tmpdir(), "b122-workflow-context-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const store = createProviderHostStore(join(directory, "state.jsonl"), token);
  const backend = new CodexProviderAdapterBackend(port, {
    adapterId: "installed.module.codex",
    moduleSha256,
    observationDeadlineMs: deadlineMs
  });
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store,
    backends: [backend],
    now: () => "2026-08-25T12:00:01.000Z"
  });
  const connected = await service.handle(request("/v1/b122/handshake/codex", handshake()));
  assert.equal(connected.status, 200);
  return { directory, store, port, backend, service };
}

test("workflow-context observation is exact, non-authorizing, digest-bound, and restart-monotonic", async (context) => {
  const setupResult = await setup(context);
  const first = await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("1".repeat(64))
  ));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(Object.keys(first.body).sort(), [
    "adapter", "branch", "contextDigest", "contextId", "dependencies", "diffDigest", "envelopeDigest", "evidence",
    "head", "observedAt", "pendingDecisions", "pendingRequest", "planRevision", "plannedFiles",
    "provider", "repositoryRoot", "requestNonce", "resources", "schema", "sessionId", "sourceRevision",
    "targetSnapshotId", "taskId", "version"
  ].sort());
  assert.deepEqual(first.body.adapter, { id: "installed.module.codex", version: "codex-fixture-provider-host-v1", moduleSha256 });
  assert.equal(first.body.requestNonce, "1".repeat(64));
  assert.equal(first.body.sourceRevision, 7);
  assert.equal(first.body.contextId, "context-codex-7");
  assert.equal(first.body.observedAt, "2026-08-25T12:00:01.000Z");
  assert.equal((first.body.evidence as { plan: { taskId: string } }).plan.taskId, "task-provider-host");
  assert.deepEqual(first.body.pendingDecisions, [{ id: "decision-1", question: "Choose the exact bounded option.", context: "The protected workflow requires one operator decision." }]);
  assert.deepEqual(first.body.pendingRequest, { requestId: "pending-1", targetSnapshotId, planRevision: "plan-1", planDigest: (first.body.evidence as { plan: { digest: string } }).plan.digest, action: "proof" });
  assert.equal(typeof first.body.contextDigest, "string");
  const { envelopeDigest, ...unsigned } = first.body;
  assert.equal(envelopeDigest, sha256(stableJson(unsigned)));
  assert.equal(/authority|permission|credential|executable|command/i.test(JSON.stringify(first.body)), false);

  const replayedSource = await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("2".repeat(64))
  ));
  assert.equal(replayedSource.status, 200);
  assert.equal(replayedSource.body.contextDigest, first.body.contextDigest);
  assert.notEqual(replayedSource.body.envelopeDigest, first.body.envelopeDigest);

  setupResult.port.sourceRevision = 6;
  const restarted = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(setupResult.directory, "state.jsonl"), token),
    backends: [setupResult.backend],
    now: () => "2026-08-25T12:00:02.000Z"
  });
  const rolledBack = await restarted.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("3".repeat(64))
  ));
  assert.equal(rolledBack.status, 409);

  setupResult.port.sourceRevision = 7;
  setupResult.port.contextId = "context-codex-drift";
  const drifted = await restarted.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("4".repeat(64))
  ));
  assert.equal(drifted.status, 409);
});

test("workflow-context observation rejects provider-added authority and inconsistent exact bindings", async (context) => {
  const setupResult = await setup(context);
  setupResult.port.extra = { authorityId: "provider-selected-authority" };
  assert.equal((await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("5".repeat(64))
  ))).status, 400);

  setupResult.port.extra = {};
  setupResult.port.bindingChange = { taskId: "other-task" };
  assert.equal((await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("6".repeat(64))
  ))).status, 400);

  setupResult.port.bindingChange = {};
  setupResult.port.transform = (value) => ({ ...value, evidence: { ...value.evidence, authorityId: "nested-authority" } } as ProviderRuntimeWorkflowContextObservation);
  assert.equal((await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("9".repeat(64))
  ))).status, 400);

  setupResult.port.transform = (value) => {
    const { evidence, ...withoutOwnEvidence } = value;
    return Object.assign(Object.create({ evidence }), withoutOwnEvidence, { authorityId: "prototype-smuggled-authority" }) as ProviderRuntimeWorkflowContextObservation;
  };
  assert.equal((await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("d".repeat(64))
  ))).status, 400);

  setupResult.port.transform = (value) => ({ ...value, pendingRequest: { ...value.pendingRequest!, planDigest: "f".repeat(64) } });
  assert.equal((await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("a".repeat(64))
  ))).status, 400);

  setupResult.port.transform = (value) => ({ ...value, pendingRequest: null });
  const optionalPending = await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("b".repeat(64))
  ));
  assert.equal(optionalPending.status, 200, JSON.stringify(optionalPending.body));
  assert.equal(optionalPending.body.pendingRequest, null);

  const injected = observationRequest("7".repeat(64)) as Record<string, unknown>;
  injected.authorityId = "caller-selected-authority";
  assert.equal((await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    injected
  ))).status, 400);
});

test("workflow-context observation has one bounded cancellation signal and consumes late module rejection", async (context) => {
  let observedAbort = false;
  let rejectLate!: (error: Error) => void;
  class HangingContextPort extends FixtureProviderRuntimePort {
    constructor() { super("codex", { effectfulTestOnly: true }); }
    override observeWorkflowContext(_request: ProviderRuntimeWorkflowContextRequest, signal: AbortSignal): Promise<ProviderRuntimeWorkflowContextObservation> {
      signal.addEventListener("abort", () => { observedAbort = true; }, { once: true });
      return new Promise((_resolve, reject) => { rejectLate = reject; });
    }
  }
  const setupResult = await setup(context, new HangingContextPort() as ContextFixturePort, 25);
  const started = Date.now();
  const response = await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("8".repeat(64))
  ));
  assert.equal(response.status, 400);
  assert.equal(observedAbort, true);
  assert.ok(Date.now() - started < 1_000);
  rejectLate(new Error("late provider secret must be consumed"));
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test("workflow-context observation rejects module settlement after the wall-clock deadline before the timer callback runs", async (context) => {
  let observedAbort = false;
  class LateSettlingContextPort extends FixtureProviderRuntimePort {
    constructor() { super("codex", { effectfulTestOnly: true }); }
    override async observeWorkflowContext(request: ProviderRuntimeWorkflowContextRequest, signal: AbortSignal): Promise<ProviderRuntimeWorkflowContextObservation> {
      signal.addEventListener("abort", () => { observedAbort = true; }, { once: true });
      const baseline = await super.observeWorkflowContext(request, signal);
      await new Promise<void>((resolve) => setTimeout(() => {
        const blockedUntil = Date.now() + 35;
        while (Date.now() < blockedUntil) { /* hold the event loop beyond the exact observation deadline */ }
        resolve();
      }, 5));
      return baseline;
    }
  }
  const setupResult = await setup(context, new LateSettlingContextPort() as ContextFixturePort, 20);
  const response = await setupResult.service.handle(request(
    "/v1/b122/observe/workflow-context/codex",
    observationRequest("c".repeat(64))
  ));
  assert.equal(response.status, 400);
  assert.equal(observedAbort, true);
});

function handshake() {
  return {
    schema: "sxsy-b122.provider-handshake-request", version: 1,
    sessionId: "codex-session", provider: "codex", targetSnapshotId, repositoryRoot,
    branch: "feature/provider-host", head: "d".repeat(40), requestedAt: "2026-08-25T12:00:00.000Z"
  };
}

function observationRequest(requestNonce: string) {
  return {
    schema: "sxsy-b122.provider-workflow-context-observe", version: 1,
    sessionId: "codex-session", provider: "codex", targetSnapshotId, repositoryRoot,
    branch: "feature/provider-host", head: "d".repeat(40),
    taskId: "task-provider-host", planRevision: "plan-1", requestNonce
  };
}

function request(path: string, body: unknown) {
  return { method: "POST", path, headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) };
}
