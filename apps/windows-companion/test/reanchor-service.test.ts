import assert from "node:assert/strict";
import test from "node:test";

import { companionBridgeVersion } from "../src/bridge.ts";
import { CompanionService } from "../src/service.ts";

const requestId = `reanchor:${"a".repeat(64)}`;
const operationId = `reanchor-operation:${"b".repeat(64)}`;
const targetId = "c".repeat(64);

function request(method: string, payload?: unknown) {
  return { version: companionBridgeVersion, id: `request-${method}`, method, payload } as never;
}

function status(state: "pending_confirmation" | "recorded") {
  return {
    schema: "sxsy-b122.installed-reanchor-status" as const,
    version: 1 as const,
    requestId,
    operationId,
    sessionId: "session-one",
    authorityId: "authority-one",
    oldTargetSnapshotId: targetId,
    newTargetSnapshotId: "d".repeat(64),
    state,
    summary: state === "recorded" ? "reanchored_without_resume" : "Read-only transition preview.",
    discrepancies: ["HEAD changed."],
    risks: ["The participant remains stopped."],
    questions: ["Review the new task boundary?"],
    confirmationScopeDigest: "e".repeat(64),
    confirmationExpiresAt: "2026-08-25T12:02:00.000Z",
    ...(state === "recorded" ? {
      receipt: {
        result: "reanchored_without_resume",
        resumed: false,
        report: {
          summary: "Provider reread the exact task and stopped.",
          discrepancies: ["HEAD changed."],
          risks: ["The participant remains stopped."],
          questions: ["Review the new task boundary?"],
          result: "reanchored_without_resume"
        }
      }
    } : {})
  };
}

test("authenticated companion exposes only eligible existing Re-anchor authorities and the dedicated lifecycle", async () => {
  const calls: string[] = [];
  const service = new CompanionService({
    reanchor: {
      async eligibleAuthorities(sessionId: string) {
        calls.push(`authorities:${sessionId}`);
        return [{ id: "authority-one", issuedBy: "TEST\\Reviewer", expiresAt: "2026-08-25T12:10:00.000Z" }];
      },
      async begin(input: unknown) { calls.push(`begin:${JSON.stringify(input)}`); return status("pending_confirmation"); },
      async confirmAndApply(input: unknown) { calls.push(`confirm:${JSON.stringify(input)}`); return status("recorded"); },
      async get(input: string) { calls.push(`get:${input}`); return status("recorded"); }
    }
  } as never);

  const authorities = await service.handle(request("reanchor.authority.list", { sessionId: "session-one" }));
  assert.equal(authorities.ok, true);
  assert.deepEqual(authorities.result, { authorities: [{ id: "authority-one", issuedBy: "TEST\\Reviewer", expiresAt: "2026-08-25T12:10:00.000Z" }] });

  const begun = await service.handle(request("reanchor.begin", { sessionId: "session-one", authorityId: "authority-one", reason: "Reconcile the exact task context." }));
  assert.equal((begun.result as { reanchor: { state: string } }).reanchor.state, "pending_confirmation");

  const completed = await service.handle(request("reanchor.confirm-apply", { requestId }));
  const final = (completed.result as { reanchor: ReturnType<typeof status> }).reanchor;
  assert.equal(final.state, "recorded");
  assert.equal(final.receipt?.result, "reanchored_without_resume");
  assert.equal(final.receipt?.resumed, false);

  const read = await service.handle(request("reanchor.get", { requestId }));
  assert.equal((read.result as { reanchor: { requestId: string } }).reanchor.requestId, requestId);
  assert.deepEqual(calls, [
    "authorities:session-one",
    'begin:{"sessionId":"session-one","authorityId":"authority-one","reason":"Reconcile the exact task context."}',
    `confirm:{"requestId":"${requestId}"}`,
    `get:${requestId}`
  ]);
});

test("generic Re-anchor workflow preparation is rejected before any legacy artifact path", async () => {
  const service = new CompanionService();
  const response = await service.handle(request("workflow.prepare", {
    action: "reanchor",
    sessionId: "session-one",
    authorityId: "authority-one",
    intent: { kind: "none" }
  }));
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "invalid_request");
  assert.match(response.error?.message ?? "", /dedicated Re-anchor lifecycle/i);
});

test("generic Re-anchor command dispatch is rejected before the durable command executor", async () => {
  let executions = 0;
  const service = new CompanionService({
    executor: { async execute() { executions += 1; return { status: "completed", summary: "must not execute" }; } }
  } as never);
  const response = await service.handle(request("command.dispatch", {
    control: "REANCHOR", modifier: "normal", sessionId: "session-one"
  }));
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "invalid_request");
  assert.match(response.error?.message ?? "", /dedicated Re-anchor lifecycle/i);
  assert.equal(executions, 0);
});

test("Re-anchor companion routes reject caller-supplied targets, confirmation material, and open authority queries", async () => {
  const service = new CompanionService({
    reanchor: {
      async eligibleAuthorities() { return []; },
      async begin() { return status("pending_confirmation"); },
      async confirmAndApply() { return status("recorded"); },
      async get() { return status("recorded"); }
    }
  } as never);
  for (const [method, payload] of [
    ["reanchor.authority.list", { sessionId: "session-one", repositoryRoot: "C:/attacker" }],
    ["reanchor.begin", { sessionId: "session-one", authorityId: "authority-one", reason: "Review.", newTargetSnapshotId: targetId }],
    ["reanchor.confirm-apply", { requestId, confirmationToken: "caller-token" }],
    ["reanchor.get", { requestId, sessionId: "substituted" }]
  ] as const) {
    const response = await service.handle(request(method, payload));
    assert.equal(response.ok, false, method);
    assert.equal(response.error?.code, "invalid_request", method);
  }
});

test("dedicated hardware Re-anchor begin resolves the live canonical claim and records one server dispatch receipt", async () => {
  const calls: unknown[] = [];
  const service = new CompanionService({
    verifyCapabilities: () => ["registered", "observable", "controllable", "mediated"],
    reanchor: {
      async eligibleAuthorities() { return []; },
      async begin(input: unknown) { calls.push(input); return status("pending_confirmation"); },
      async confirmAndApply() { return status("recorded"); },
      async get() { return undefined; }
    },
    hardwareSignals: {
      async resolveLiveClaim() {
        return {
          signalId: `hardware-signal:${"1".repeat(64)}`, claimToken: "claim-token-one", deviceId: "device-one",
          connectionEpoch: 1, bootNonce: 1, counter: 1, control: "REANCHOR", modifier: "normal",
          acceptedAt: "2026-08-25T12:00:00.000Z", claimedAt: "2026-08-25T12:00:01.000Z", attempt: 1,
          windowSessionId: "window-one", workspaceRoots: ["C:\\repo"]
        };
      },
      async recordDispatch(input: unknown) { calls.push(input); return { dispatchReceiptId: `hardware-dispatch:${"f".repeat(64)}` }; }
    },
    canonicalizeHostPath: async (value: string) => value
  } as never);
  const managed = {
    id: "session-one", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running", workspaceRoot: "C:\\repo", targetSnapshotId: targetId, taskId: "task-one", planRevision: "plan-one",
    plannedFiles: [], lastHeartbeat: "2026-08-25T12:00:00.000Z", adapterVersion: "codex-v1", metadata: {}
  };
  assert.equal((await service.handle(request("session.register", { session: managed }))).ok, true);
  const response = await service.handle(request("reanchor.hardware.begin", {
    signalId: `hardware-signal:${"1".repeat(64)}`, claimToken: "claim-token-one", windowSessionId: "window-one", workspaceRoots: ["C:\\repo"],
    sessionId: "session-one", authorityId: "authority-one", reason: "Reread exact protected context."
  }));
  assert.equal(response.ok, true, response.error?.message);
  assert.equal((response.result as { dispatchReceiptId: string }).dispatchReceiptId, `hardware-dispatch:${"f".repeat(64)}`);
  assert.deepEqual(calls[0], { sessionId: "session-one", authorityId: "authority-one", reason: "Reread exact protected context." });
  assert.equal((calls[1] as { handler: string }).handler, "b122.REANCHOR:normal");
  assert.equal((calls[1] as { operationId: string }).operationId, operationId);
});
