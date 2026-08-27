import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { commandCatalog } from "../../../packages/control-plane/src/command-catalog.ts";
import type { CommandRequest, CommandResult } from "../../../packages/control-plane/src/contracts.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { assignmentFor } from "../../../packages/protocol/src/b122.ts";
import {
  CompanionHardwareSignalDispatcher,
  type HardwareSignalCommandExecutor
} from "../src/hardware-signal-dispatcher.ts";
import {
  DurableHardwareSignalInbox,
  isCompanionOwnedHardwareSignal
} from "../src/hardware-signal-queue.ts";
import { B122FirmwareProtocolSimulator, RawHidHostProtocol } from "../src/raw-hid-protocol.ts";
import { startStandaloneHardwareSignalDispatch } from "../src/main.ts";
import { createDurableWindowsCompanion } from "../src/bootstrap.ts";

const authenticator: JournalAuthenticator = {
  provider: "hardware-background-isolated-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

async function fixture(context: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-hardware-background-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  let token = 0;
  let dispatch = 0;
  const store = new ProtectedJsonStore({
    filePath: join(folder, "protected.jsonl"),
    authenticator,
    clock: () => "2026-08-25T12:00:00.000Z"
  });
  return {
    folder,
    store,
    inbox: new DurableHardwareSignalInbox(store, {
      claimTokenFactory: () => `background-claim-${++token}`,
      dispatchReceiptFactory: () => `hardware-dispatch:${String(++dispatch).padStart(64, "0")}`
    })
  };
}

class RecordingExecutor implements HardwareSignalCommandExecutor {
  readonly requests: CommandRequest[] = [];
  readonly dispatchWasDurable: boolean[] = [];
  private readonly store: ProtectedJsonStore;
  private readonly outcome?: (request: CommandRequest) => Promise<CommandResult>;

  constructor(store: ProtectedJsonStore, outcome?: (request: CommandRequest) => Promise<CommandResult>) {
    this.store = store;
    this.outcome = outcome;
  }

  async execute(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    const entries = await this.store.readEntries();
    this.dispatchWasDurable.push(entries.filter((entry) => entry.kind === "b122.hardware-signal.dispatched.v1").length >= this.requests.length);
    if (this.outcome) return this.outcome(request);
    return {
      status: "completed",
      summary: "The isolated targetless adapter settled.",
      effectDisposition: "committed",
      operationId: `background-operation-${this.requests.length}`,
      receiptId: `background-receipt-${this.requests.length}`
    };
  }
}

const deviceId = "b".repeat(64);

async function acceptSimulatedSignal(
  inbox: DurableHardwareSignalInbox,
  simulator: B122FirmwareProtocolSimulator,
  host: RawHidHostProtocol,
  control: Parameters<B122FirmwareProtocolSimulator["signal"]>[0],
  modifier: Parameters<B122FirmwareProtocolSimulator["signal"]>[1]
): Promise<void> {
  const packet = simulator.signal(control, modifier);
  const prepared = host.prepare(deviceId, packet);
  assert.equal(prepared.outcome, "signal_pending");
  assert.ok(prepared.signal);
  await inbox.accept(deviceId, prepared.signal);
  const committed = prepared.commit?.();
  assert.equal(committed?.outcome, "signal_accepted");
  assert.ok(committed?.response);
  simulator.receive(committed.response);
}

async function connectSimulator(simulator: B122FirmwareProtocolSimulator, host: RawHidHostProtocol): Promise<void> {
  const hello = host.receive(deviceId, simulator.hello());
  assert.equal(hello.outcome, "handshake_accepted");
  assert.ok(hello.response);
  simulator.receive(hello.response);
}

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

test("the companion-owned hardware eligibility boundary is exactly the five safe targetless adapter chords", () => {
  const eligible = commandCatalog
    .filter((definition) => definition.assignment && isCompanionOwnedHardwareSignal(definition.assignment.control, definition.assignment.modifier))
    .map((definition) => `${definition.assignment!.control}:${definition.assignment!.modifier}`)
    .sort();

  assert.deepEqual(eligible, ["CHATGPT:normal", "CLAUDE:normal", "TERMINAL:normal", "VOICE:normal", "VSCODE:normal"]);
});

test("a firmware simulator reaches companion-owned dispatch with no VS Code window while contextual signals remain pending", async (context) => {
  const { inbox, store } = await fixture(context);
  const simulator = new B122FirmwareProtocolSimulator({ bootNonce: 31, connectionEpoch: 9 });
  const host = new RawHidHostProtocol();
  await connectSimulator(simulator, host);
  for (const control of ["CLAUDE", "CHATGPT", "VSCODE", "TERMINAL", "VOICE"] as const) {
    await acceptSimulatedSignal(inbox, simulator, host, control, "normal");
  }
  await acceptSimulatedSignal(inbox, simulator, host, "SHIELD", "normal");

  const executor = new RecordingExecutor(store);
  const dispatcher = new CompanionHardwareSignalDispatcher(inbox, executor, { pollIntervalMs: 10 });
  await dispatcher.start();
  await waitFor(async () => (await inbox.status()).completed === 5, "five background completions");
  await dispatcher.stop();

  assert.equal(executor.requests.length, 5);
  assert.ok(executor.dispatchWasDurable.every(Boolean), "an effect began before its durable hardware dispatch receipt");
  assert.deepEqual(executor.requests.map((request) => `${request.control}:${request.modifier}`).sort(), [
    "CHATGPT:normal", "CLAUDE:normal", "TERMINAL:normal", "VOICE:normal", "VSCODE:normal"
  ]);
  for (const request of executor.requests) {
    assert.deepEqual(Object.keys(request).sort(), ["assignment", "control", "modifier"]);
    assert.equal(request.assignment, assignmentFor(request.control, request.modifier));
  }
  assert.deepEqual(await inbox.status(), { pending: 1, claimed: 0, completed: 5, needsReconciliation: 0 });
  const focusedClaim = await inbox.claim({ windowSessionId: "focused-window", workspaceRoots: ["C:\\repo"] });
  assert.equal(focusedClaim?.control, "SHIELD");
});

test("a physical Voice signal stays claimed until the exact extension-settled host operation is durable", async (context) => {
  const { inbox, store } = await fixture(context);
  await inbox.accept(deviceId, { type: "signal", connectionEpoch: 7, bootNonce: 8, counter: 1, control: "VOICE", modifier: "normal", assigned: true });
  let operationState: "executing" | "recorded" = "executing";
  let requests = 0;
  const executor: HardwareSignalCommandExecutor = {
    operations: {
      async get(operationId) {
        assert.equal(operationId, "operation-physical-voice");
        return { id: operationId, state: operationState };
      }
    },
    async execute() {
      requests += 1;
      const entries = await store.readEntries();
      assert.equal(entries.some((entry) => entry.kind === "b122.hardware-signal.dispatched.v1"), true);
      return {
        status: "running",
        summary: "Voice Center awaits the installed extension.",
        operationId: "operation-physical-voice",
        data: {
          hostActionId: `host-action:${"a".repeat(64)}`,
          hostActionKind: "show_voice_center",
          hostActionExpiresAt: new Date(Date.now() + 5_000).toISOString()
        }
      };
    }
  };
  const dispatcher = new CompanionHardwareSignalDispatcher(inbox, executor, { pollIntervalMs: 10, hostActionSettlementPollIntervalMs: 10 });
  await dispatcher.start();
  await waitFor(async () => requests === 1, "Voice host-action dispatch");
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.deepEqual(await inbox.status(), { pending: 0, claimed: 1, completed: 0, needsReconciliation: 0 }, "a Running host action must never be marked handled");

  operationState = "recorded";
  await waitFor(async () => (await inbox.status()).completed === 1, "extension-settled Voice completion");
  await dispatcher.stop();
  assert.equal(requests, 1, "waiting for the extension must not replay the physical command");
  assert.deepEqual(await inbox.status(), { pending: 0, claimed: 0, completed: 1, needsReconciliation: 0 });
});

test("a physical Voice action without a compatible extension settles only as reconciliation-required", async (context) => {
  const { inbox } = await fixture(context);
  await inbox.accept(deviceId, { type: "signal", connectionEpoch: 7, bootNonce: 8, counter: 2, control: "VOICE", modifier: "normal", assigned: true });
  const executor: HardwareSignalCommandExecutor = {
    operations: { async get(operationId) { return { id: operationId, state: "executing" }; } },
    async execute() {
      return {
        status: "running",
        summary: "No compatible extension has claimed Voice Center.",
        operationId: "operation-unclaimed-voice",
        data: {
          hostActionId: `host-action:${"b".repeat(64)}`,
          hostActionKind: "show_voice_center",
          hostActionExpiresAt: new Date(Date.now() + 40).toISOString()
        }
      };
    }
  };
  const dispatcher = new CompanionHardwareSignalDispatcher(inbox, executor, { pollIntervalMs: 10, hostActionSettlementPollIntervalMs: 10 });
  await dispatcher.start();
  await waitFor(async () => (await inbox.status()).needsReconciliation === 1, "unclaimed Voice reconciliation");
  await dispatcher.stop();
  assert.deepEqual(await inbox.status(), { pending: 0, claimed: 0, completed: 0, needsReconciliation: 1 });
});

test("focused VS Code claims cannot steal companion-owned signals even when they arrived first", async (context) => {
  const { inbox } = await fixture(context);
  await inbox.accept(deviceId, { type: "signal", connectionEpoch: 1, bootNonce: 2, counter: 1, control: "CLAUDE", modifier: "normal", assigned: true });
  await inbox.accept(deviceId, { type: "signal", connectionEpoch: 1, bootNonce: 2, counter: 2, control: "PROOF", modifier: "normal", assigned: true });

  const focused = await inbox.claim({ windowSessionId: "focused-window", workspaceRoots: ["C:\\repo"] });
  assert.equal(focused?.control, "PROOF");
  const background = await inbox.claimCompanionTargetless();
  assert.equal(background?.control, "CLAUDE");
  assert.deepEqual(background?.workspaceRoots, []);
});

test("a dispatch that crossed the durable boundary is never replayed after a crash or thrown effect", async (context) => {
  const { inbox, store } = await fixture(context);
  await inbox.accept(deviceId, { type: "signal", connectionEpoch: 1, bootNonce: 3, counter: 1, control: "CHATGPT", modifier: "normal", assigned: true });
  const throwing = new RecordingExecutor(store, async () => { throw new Error("injected ambiguous effect return"); });
  const first = new CompanionHardwareSignalDispatcher(inbox, throwing, { pollIntervalMs: 10 });
  await first.start();
  await waitFor(async () => (await inbox.status()).needsReconciliation === 1, "ambiguous completion");
  await first.stop();
  assert.equal(throwing.requests.length, 1);

  const restartedInbox = new DurableHardwareSignalInbox(store);
  await restartedInbox.recoverAfterRestart();
  const replay = new RecordingExecutor(store);
  const restarted = new CompanionHardwareSignalDispatcher(restartedInbox, replay, { pollIntervalMs: 10 });
  await restarted.start();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await restarted.stop();
  assert.equal(replay.requests.length, 0);
  assert.deepEqual(await restartedInbox.status(), { pending: 0, claimed: 0, completed: 0, needsReconciliation: 1 });

  await restartedInbox.accept(deviceId, { type: "signal", connectionEpoch: 1, bootNonce: 3, counter: 2, control: "CLAUDE", modifier: "normal", assigned: true });
  const crashedClaim = await restartedInbox.claimCompanionTargetless();
  assert.ok(crashedClaim);
  await restartedInbox.recordDispatch({ ...crashedClaim, handler: "b122.CLAUDE:normal", resultStatus: "dispatching" });
  const afterCrash = new DurableHardwareSignalInbox(store);
  await afterCrash.recoverAfterRestart();
  const afterCrashExecutor = new RecordingExecutor(store);
  const afterCrashDispatcher = new CompanionHardwareSignalDispatcher(afterCrash, afterCrashExecutor, { pollIntervalMs: 10 });
  await afterCrashDispatcher.start();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await afterCrashDispatcher.stop();
  assert.equal(afterCrashExecutor.requests.length, 0);
  assert.deepEqual(await afterCrash.status(), { pending: 0, claimed: 0, completed: 0, needsReconciliation: 2 });
});

test("startup accepts a protected pre-upgrade focused claim for a now companion-owned chord and reconciles it without replay", async (context) => {
  const { inbox, store } = await fixture(context);
  const accepted = await inbox.accept(deviceId, { type: "signal", connectionEpoch: 2, bootNonce: 7, counter: 1, control: "VSCODE", modifier: "normal", assigned: true });
  await store.append("b122.hardware-signal.claimed.v1", {
    signalId: accepted.signalId,
    claimToken: "legacy-focused-claim",
    windowSessionId: "legacy-focused-window",
    workspaceRoots: ["C:\\legacy-repo"],
    attempt: 1
  });

  const restarted = new DurableHardwareSignalInbox(store);
  await restarted.recoverAfterRestart();
  assert.deepEqual(await restarted.status(), { pending: 0, claimed: 0, completed: 0, needsReconciliation: 1 });
  assert.equal(await restarted.claimCompanionTargetless(), undefined);
});

test("background dispatcher start and stop are idempotent and stop prevents later claims", async (context) => {
  const { inbox, store } = await fixture(context);
  await inbox.accept(deviceId, { type: "signal", connectionEpoch: 1, bootNonce: 4, counter: 1, control: "VOICE", modifier: "normal", assigned: true });
  const executor = new RecordingExecutor(store);
  const dispatcher = new CompanionHardwareSignalDispatcher(inbox, executor, { pollIntervalMs: 10 });
  await Promise.all([dispatcher.start(), dispatcher.start()]);
  await waitFor(async () => (await inbox.status()).completed === 1, "first lifecycle dispatch");
  await Promise.all([dispatcher.stop(), dispatcher.stop()]);

  await inbox.accept(deviceId, { type: "signal", connectionEpoch: 1, bootNonce: 4, counter: 2, control: "CLAUDE", modifier: "normal", assigned: true });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(executor.requests.length, 1);
  assert.deepEqual(await inbox.status(), { pending: 1, claimed: 0, completed: 1, needsReconciliation: 0 });
});

test("shutdown after a durable dispatch intent fences executor entry and settles the exact claim without replay", async (context) => {
  const { inbox, store } = await fixture(context);
  await inbox.accept(deviceId, { type: "signal", connectionEpoch: 1, bootNonce: 5, counter: 1, control: "CLAUDE", modifier: "normal", assigned: true });
  const originalRecordDispatch = inbox.recordDispatch.bind(inbox);
  let releaseRecord!: () => void;
  const release = new Promise<void>((resolve) => { releaseRecord = resolve; });
  let recorded!: () => void;
  const crossed = new Promise<void>((resolve) => { recorded = resolve; });
  inbox.recordDispatch = async (input) => {
    const receipt = await originalRecordDispatch(input);
    recorded();
    await release;
    return receipt;
  };
  const executor = new RecordingExecutor(store);
  const dispatcher = new CompanionHardwareSignalDispatcher(inbox, executor, { pollIntervalMs: 10 });
  await dispatcher.start();
  await crossed;
  const stopped = dispatcher.stop();
  releaseRecord();
  await stopped;

  assert.equal(executor.requests.length, 0);
  assert.deepEqual(await inbox.status(), { pending: 0, claimed: 0, completed: 1, needsReconciliation: 0 });
  const restarted = new DurableHardwareSignalInbox(store);
  await restarted.recoverAfterRestart();
  assert.deepEqual(await restarted.status(), { pending: 0, claimed: 0, completed: 1, needsReconciliation: 0 });
});

test("a pre-effect receipt failure requeues at the bounded poll cadence without a tight retry loop", async (context) => {
  const { inbox, store } = await fixture(context);
  await inbox.accept(deviceId, { type: "signal", connectionEpoch: 1, bootNonce: 6, counter: 1, control: "CHATGPT", modifier: "normal", assigned: true });
  let attempts = 0;
  inbox.recordDispatch = async () => { attempts += 1; throw new Error("injected receipt failure"); };
  const executor = new RecordingExecutor(store);
  const dispatcher = new CompanionHardwareSignalDispatcher(inbox, executor, { pollIntervalMs: 10 });
  await dispatcher.start();
  await new Promise((resolve) => setTimeout(resolve, 45));
  await dispatcher.stop();

  assert.ok(attempts >= 1 && attempts <= 6, `unexpected retry count ${attempts}`);
  assert.equal(executor.requests.length, 0);
  assert.deepEqual(await inbox.status(), { pending: 1, claimed: 0, completed: 0, needsReconciliation: 0 });
});

test("standalone startup waits for durable recovery before enabling background hardware consumption", async () => {
  const events: string[] = [];
  await startStandaloneHardwareSignalDispatch({
    endpoint: { async ready() { events.push("ready"); } },
    hardwareSignalDispatcher: { async start() { events.push("start"); } }
  });
  assert.deepEqual(events, ["ready", "start"]);

  await assert.rejects(() => startStandaloneHardwareSignalDispatch({
    endpoint: { async ready() { throw new Error("injected recovery failure"); } },
    hardwareSignalDispatcher: { async start() { throw new Error("must not start"); } }
  }), /recovery failure/i);
});

test("bootstrap queues a host-owned hardware action but never marks it handled without exact host settlement", async (context) => {
  const { folder, store } = await fixture(context);
  const companion = createDurableWindowsCompanion({
    store,
    policyVersion: "hardware-background-test-policy",
    localStateDirectory: folder,
    targetResolver: { async resolve() { return undefined; } }
  });
  await companion.endpoint.ready();
  await companion.hardwareSignals.accept(deviceId, {
    type: "signal", connectionEpoch: 3, bootNonce: 8, counter: 1,
    control: "VSCODE", modifier: "normal", assigned: true
  });
  await companion.hardwareSignalDispatcher.start();
  await waitFor(async () => (await companion.hardwareSignals.status()).needsReconciliation === 1, "bootstrap host-action reconciliation");
  await companion.hardwareSignalDispatcher.stop();

  assert.deepEqual(await companion.hardwareSignals.status(), { pending: 0, claimed: 0, completed: 0, needsReconciliation: 1 });
  const hostAction = (await store.readEntries<{ event?: string; intent?: { hostAction?: string } }>())
    .find((entry) => entry.kind === "host_action" && entry.payload.event === "queued")?.payload.intent;
  assert.equal(hostAction?.hostAction, "focus_vscode");
});
