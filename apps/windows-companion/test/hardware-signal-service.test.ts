import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import type { CommandRequest, ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { companionBridgeVersion, type CompanionRequest } from "../src/bridge.ts";
import { DurableHardwareSignalInbox } from "../src/hardware-signal-queue.ts";
import type { RawHidDeviceIdentity, RawHidInstallationPin } from "../src/raw-hid-installation.ts";
import { CompanionService, type CommandPreparationCapableMediatedCommandExecutor } from "../src/service.ts";

const authenticator: JournalAuthenticator = {
  provider: "hardware-service-isolated-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

function request(id: string, method: string, payload?: unknown): CompanionRequest {
  return { version: companionBridgeVersion, id, method: method as CompanionRequest["method"], payload };
}

function windowSession(): ManagedSession {
  return {
    id: "window-1", provider: "generic", surface: "vscode_window", capabilities: ["registered"], status: "unknown",
    workspaceRoot: "C:\\repo", plannedFiles: [], lastHeartbeat: "2026-08-24T12:00:00.000Z", adapterVersion: "test",
    metadata: { "sxsy-b122.kind": "window", "sxsy-b122.workspaceRoots": JSON.stringify(["C:\\repo"]) }
  };
}

test("Raw-HID install/list/status/revoke schemas expose only the fixed host coordinator", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-raw-hid-service-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const identity: RawHidDeviceIdentity = { vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61, serialNumber: "B122-A" };
  const pin: RawHidInstallationPin = { identity, helperPath: "C:\\Program Files\\STRATHEX\\strathex-b122-hid-helper.exe", helperSha256: "a".repeat(64), protocolVersion: 1, mapFingerprint: "0123456789abcdef", installedAt: "2026-08-24T12:00:00.000Z", status: "active" };
  const installed: RawHidDeviceIdentity[] = [];
  const lifecycle: string[] = [];
  let stops = 0;
  let starts = 0;
  const service = new CompanionService({
    rawHidInstallations: {
      async install(value) { lifecycle.push("install"); installed.push(value); return pin; },
      async list() { return [pin]; },
      async revoke() { lifecycle.push("revoke"); return { ...pin, status: "revoked" }; }
    },
    rawHidSupervisor: {
      async startConfigured() { lifecycle.push("start"); starts += 1; return { state: "running", generation: 1, detail: "ready" }; },
      async stop() { lifecycle.push("stop"); stops += 1; },
      status() { return { state: "running", generation: 1, detail: "ready" }; }
    },
    hardwareSignals: new DurableHardwareSignalInbox(new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator }))
  });

  const install = await service.handle(request("install", "raw-hid.install", identity));
  assert.equal(install.ok, true);
  assert.deepEqual(installed, [identity]);
  assert.deepEqual(lifecycle.slice(0, 3), ["stop", "install", "start"], "an old helper generation stops before a replacement pin is installed");
  assert.equal(starts, 1);
  assert.equal((await service.handle(request("list", "raw-hid.list"))).ok, true);
  assert.equal((await service.handle(request("status", "raw-hid.status"))).ok, true);
  assert.equal((await service.handle(request("revoke", "raw-hid.revoke"))).ok, true);
  assert.deepEqual(lifecycle.slice(3), ["stop", "revoke"], "the helper stops before the durable pin is revoked");
  assert.equal(stops, 2, "install generation replacement and revocation both stop supervision");

  const injected = await service.handle(request("injected", "raw-hid.install", { ...identity, helperPath: "C:\\evil.exe" }));
  assert.equal(injected.ok, false);
  assert.equal(injected.error?.code, "invalid_request");
});

test("focused hardware claim is session/workspace bound and canonical chord cannot be rebound by dispatch payload", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-hardware-service-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const inbox = new DurableHardwareSignalInbox(new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator }), { claimTokenFactory: () => "claim-token-service" });
  await inbox.accept("b".repeat(64), { type: "signal", connectionEpoch: 1, bootNonce: 2, counter: 3, control: "SHIELD", modifier: "normal", assigned: true });
  const prepared: string[] = [];
  const dispatched: CommandRequest[] = [];
  const executor: CommandPreparationCapableMediatedCommandExecutor = {
    async prepareCommand(input) { prepared.push(input.action); return { status: "prepared", summary: "prepared", authorityId: "authority-1", confirmationToken: "confirmation-1" }; },
    async execute(input) { dispatched.push(input); return { status: "completed", summary: "handled" }; }
  };
  const service = new CompanionService({ executor, hardwareSignals: inbox, canonicalizeHostPath: async (value) => value });
  service.installTrustedSession(windowSession());
  const binding = { windowSessionId: "window-1", workspaceRoots: ["C:\\repo"], focused: true };

  const claimResponse = await service.handle(request("claim", "hardware-signal.claim", binding));
  assert.equal(claimResponse.ok, true);
  const claim = (claimResponse.result as { claim: { signalId: string; claimToken: string; control: string; modifier: string } }).claim;
  assert.equal(claim.control, "SHIELD");
  assert.equal(claim.modifier, "normal");

  const common = { signalId: claim.signalId, claimToken: claim.claimToken, windowSessionId: "window-1", workspaceRoots: ["C:\\repo"] };
  const preparation = await service.handle(request("prepare", "hardware-signal.prepare", { ...common, reason: "Physical B122 chord in the focused installed window." }));
  assert.equal(preparation.ok, true);
  assert.deepEqual(prepared, ["shield_change_scan"]);
  const dispatch = await service.handle(request("dispatch", "hardware-signal.dispatch", { ...common, authorityId: "authority-1", confirmationToken: "confirmation-1" }));
  assert.equal(dispatch.ok, true);
  assert.equal(dispatched[0]?.control, "SHIELD");
  assert.equal(dispatched[0]?.modifier, "normal");
  const dispatchReceiptId = (dispatch.result as { dispatchReceiptId: string }).dispatchReceiptId;

  const rebound = await service.handle(request("rebound", "hardware-signal.dispatch", { ...common, control: "COMMIT", modifier: "shift_alt" }));
  assert.equal(rebound.ok, false);
  assert.equal(rebound.error?.code, "invalid_request");
  const forgedCompletion = await service.handle(request("forged-complete", "hardware-signal.complete", { ...common, outcome: "handled", summary: "Client omitted the server receipt." }));
  assert.equal(forgedCompletion.ok, false);
  const completion = await service.handle(request("complete", "hardware-signal.complete", { ...common, outcome: "handled", summary: "Mediated flow returned a durable result.", dispatchReceiptId }));
  assert.equal(completion.ok, true);
});

test("hardware signal claims reject background, unknown, and mismatched workspace windows", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-hardware-binding-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const inbox = new DurableHardwareSignalInbox(new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator }));
  await inbox.accept("c".repeat(64), { type: "signal", connectionEpoch: 1, bootNonce: 2, counter: 3, control: "PROOF", modifier: "normal", assigned: true });
  const service = new CompanionService({ hardwareSignals: inbox, canonicalizeHostPath: async (value) => value });
  service.installTrustedSession(windowSession());
  for (const [id, payload] of [
    ["background", { windowSessionId: "window-1", workspaceRoots: ["C:\\repo"], focused: false }],
    ["unknown", { windowSessionId: "missing", workspaceRoots: ["C:\\repo"], focused: true }],
    ["mismatch", { windowSessionId: "window-1", workspaceRoots: ["C:\\other"], focused: true }]
  ] as const) {
    const response = await service.handle(request(id, "hardware-signal.claim", payload));
    assert.equal(response.ok, false, id);
  }
  assert.deepEqual(await inbox.status(), { pending: 1, claimed: 0, completed: 0, needsReconciliation: 0 });
});

test("Plan Approval hardware review keeps the exact signal live for reviewed second preparation", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-hardware-plan-review-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const inbox = new DurableHardwareSignalInbox(new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator }), { claimTokenFactory: () => "claim-token-plan-review" });
  await inbox.accept("f".repeat(64), { type: "signal", connectionEpoch: 1, bootNonce: 2, counter: 3, control: "PLAN_APPROVAL", modifier: "normal", assigned: true });
  const scopeDigest = "1".repeat(64);
  const reviews: Array<string | undefined> = [];
  const executor: CommandPreparationCapableMediatedCommandExecutor = {
    async prepareCommand(input) {
      reviews.push(input.reviewScopeDigest);
      if (!input.reviewScopeDigest) {
        return {
          status: "incomplete",
          summary: "Review the exact provider-observed plan before confirmation.",
          workflowReview: {
            action: "plan_approval",
            sessionId: "window-1",
            targetSnapshotId: "2".repeat(64),
            repositoryRoot: "C:\\repo",
            provider: "claude",
            contextId: "context-1",
            observedAt: "2026-08-24T12:00:00.000Z",
            adapter: { id: "provider-host", version: "1.0.0", moduleSha256: "3".repeat(64) },
            plan: {
              digest: "4".repeat(64), revision: "1", originSessionId: "window-1", taskId: "task-1", objective: "Complete the reviewed plan.",
              steps: [{ id: "step-1", summary: "Run the exact step.", ownedFiles: ["apps/example.ts"], dependencies: [], status: "approved" }],
              decisions: ["Use the reviewed provider context."]
            },
            scopeDigest,
            summary: "Complete the reviewed plan. Step step-1: Run the exact step.",
            providerContextDigest: "5".repeat(64),
            sourceRevision: 1
          }
        };
      }
      return { status: "prepared", summary: "prepared", authorityId: "authority-plan", confirmationToken: "confirmation-plan", confirmationScopeDigest: scopeDigest };
    },
    async execute() { return { status: "completed", summary: "handled" }; }
  };
  const service = new CompanionService({ executor, hardwareSignals: inbox, canonicalizeHostPath: async (value) => value });
  service.installTrustedSession(windowSession());
  const claimed = await service.handle(request("claim-plan", "hardware-signal.claim", { windowSessionId: "window-1", workspaceRoots: ["C:\\repo"], focused: true }));
  const claim = (claimed.result as { claim: { signalId: string; claimToken: string } }).claim;
  const common = { signalId: claim.signalId, claimToken: claim.claimToken, windowSessionId: "window-1", workspaceRoots: ["C:\\repo"], reason: "Physical Plan Approval chord." };

  const review = await service.handle(request("prepare-plan-review", "hardware-signal.prepare", common));
  assert.equal(review.ok, true);
  assert.equal((review.result as { dispositionReceiptId?: string }).dispositionReceiptId, undefined);
  assert.equal((review.result as { preparation: { workflowReview?: { scopeDigest: string } } }).preparation.workflowReview?.scopeDigest, scopeDigest);
  assert.deepEqual(await inbox.status(), { pending: 0, claimed: 1, completed: 0, needsReconciliation: 0 });

  const approved = await service.handle(request("prepare-plan-approved", "hardware-signal.prepare", { ...common, reviewScopeDigest: scopeDigest }));
  assert.equal(approved.ok, true);
  assert.equal((approved.result as { preparation: { status: string; confirmationScopeDigest?: string } }).preparation.status, "prepared");
  assert.equal((approved.result as { preparation: { confirmationScopeDigest?: string } }).preparation.confirmationScopeDigest, scopeDigest);
  assert.deepEqual(reviews, [undefined, scopeDigest]);
  assert.deepEqual(await inbox.status(), { pending: 0, claimed: 1, completed: 0, needsReconciliation: 0 });
});

test("dispatch intent is durable before executor entry so a concurrent client cannot requeue during an effect", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-hardware-dispatch-race-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const inbox = new DurableHardwareSignalInbox(new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator }), { claimTokenFactory: () => "claim-token-race", dispatchReceiptFactory: () => `hardware-dispatch:${"f".repeat(64)}` });
  await inbox.accept("d".repeat(64), { type: "signal", connectionEpoch: 1, bootNonce: 2, counter: 3, control: "PROOF", modifier: "normal", assigned: true });
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const service = new CompanionService({
    hardwareSignals: inbox,
    canonicalizeHostPath: async (value) => value,
    executor: { async execute() { enter(); await released; return { status: "completed", summary: "effect completed" }; } }
  });
  service.installTrustedSession(windowSession());
  const claimed = await service.handle(request("claim", "hardware-signal.claim", { windowSessionId: "window-1", workspaceRoots: ["C:\\repo"], focused: true }));
  const claim = (claimed.result as { claim: { signalId: string; claimToken: string } }).claim;
  const common = { signalId: claim.signalId, claimToken: claim.claimToken, windowSessionId: "window-1", workspaceRoots: ["C:\\repo"] };
  const dispatchPromise = service.handle(request("dispatch", "hardware-signal.dispatch", common));
  await entered;
  const forgedRequeue = await service.handle(request("requeue", "hardware-signal.complete", { ...common, outcome: "failed_before_dispatch", summary: "forge requeue while effect runs" }));
  assert.equal(forgedRequeue.ok, false);
  release();
  const dispatched = await dispatchPromise;
  assert.equal(dispatched.ok, true);
  const receipt = (dispatched.result as { dispatchReceiptId: string }).dispatchReceiptId;
  const completed = await service.handle(request("complete", "hardware-signal.complete", { ...common, outcome: "handled", summary: "effect returned", dispatchReceiptId: receipt }));
  assert.equal(completed.ok, true);
});

test("workspace or session churn after claim fails before canonical hardware preparation or dispatch", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-hardware-binding-churn-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const inbox = new DurableHardwareSignalInbox(new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator }), { claimTokenFactory: () => "claim-token-churn" });
  await inbox.accept("e".repeat(64), { type: "signal", connectionEpoch: 1, bootNonce: 2, counter: 3, control: "SHIELD", modifier: "normal", assigned: true });
  let prepared = 0;
  let dispatched = 0;
  const executor: CommandPreparationCapableMediatedCommandExecutor = {
    async prepareCommand() { prepared += 1; return { status: "prepared", summary: "prepared" }; },
    async execute() { dispatched += 1; return { status: "completed", summary: "handled" }; }
  };
  const service = new CompanionService({
    hardwareSignals: inbox,
    canonicalizeHostPath: async (value) => value,
    executor
  });
  service.installTrustedSession(windowSession());
  const claimed = await service.handle(request("claim", "hardware-signal.claim", { windowSessionId: "window-1", workspaceRoots: ["C:\\repo"], focused: true }));
  const claim = (claimed.result as { claim: { signalId: string; claimToken: string } }).claim;
  const common = { signalId: claim.signalId, claimToken: claim.claimToken, windowSessionId: "window-1", workspaceRoots: ["C:\\repo"] };

  service.installTrustedSession({
    ...windowSession(),
    workspaceRoot: "C:\\other",
    metadata: { "sxsy-b122.kind": "window", "sxsy-b122.workspaceRoots": JSON.stringify(["C:\\other"]) }
  });

  assert.equal((await service.handle(request("prepare-after-churn", "hardware-signal.prepare", { ...common, reason: "Physical chord." }))).ok, false);
  assert.equal((await service.handle(request("dispatch-after-churn", "hardware-signal.dispatch", common))).ok, false);
  assert.equal(prepared, 0);
  assert.equal(dispatched, 0);
});
