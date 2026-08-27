import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { CommandResult } from "../../../packages/control-plane/src/contracts.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import type { AdapterRequest } from "../../../packages/control-plane/src/adapters.ts";
import { DurableHostActionAdapter, DurableHostActionQueue, type HostActionIntent, type LocalHostActionKind } from "../src/host-actions.ts";
import type { ExternalCompletionCapableMediatedCommandExecutor, HostActionCompletionRecord } from "../src/service.ts";
import {
  CompanionWindowsHostActionConsumer,
  type FixedWindowsHostApplicationIdentity,
  type WindowsHostActionEffectPort,
  type WindowsHostActionEffectRequest,
  type WindowsHostActionEffectResult,
  type WindowsHostActionQueuePort
} from "../src/windows-host-action-consumer.ts";

const authenticator: JournalAuthenticator = {
  provider: "windows-host-action-consumer-isolated-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};
const fixedNow = "2026-08-25T17:00:00.000Z";

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function identity(application: "vscode" | "terminal"): FixedWindowsHostApplicationIdentity {
  const vscode = application === "vscode";
  return {
    version: 1,
    application,
    productId: vscode ? "microsoft.visual-studio-code" : "microsoft.windows-terminal",
    canonicalExecutablePath: vscode
      ? "C:\\Program Files\\Microsoft VS Code\\Code.exe"
      : "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.0.0.0_x64__8wekyb3d8bbwe\\WindowsTerminal.exe",
    executableSha256: sha256(`${application}-executable`),
    signerSubject: "CN=Microsoft Corporation, O=Microsoft Corporation, C=US",
    signerThumbprint: vscode ? "a".repeat(40) : "b".repeat(40),
    size: vscode ? 123_456 : 234_567,
    modifiedMs: 1_777_000_000_000,
    device: "4294967295",
    inode: vscode ? "59672695062879660" : "59672695062879661"
  };
}

class RecordingExecutor implements ExternalCompletionCapableMediatedCommandExecutor {
  readonly records: HostActionCompletionRecord[] = [];
  fail = false;

  async execute(): Promise<CommandResult> { throw new Error("not used"); }

  async completeExternalOperation(record: HostActionCompletionRecord): Promise<CommandResult> {
    this.records.push(record);
    if (this.fail) throw new Error("injected external completion loss");
    return {
      status: record.status === "completed" ? "completed" : record.status === "incomplete" ? "incomplete" : "failed",
      summary: record.summary,
      effectDisposition: record.status === "completed" ? "committed" : record.status === "incomplete" ? "ambiguous" : "not_started",
      operationId: record.operationId
    };
  }
}

class RecordingEffects implements WindowsHostActionEffectPort {
  readonly requests: WindowsHostActionEffectRequest[] = [];
  implementation: (request: WindowsHostActionEffectRequest) => Promise<WindowsHostActionEffectResult> = async (request) => {
    await request.beforeEffect();
    return { disposition: "committed", summary: `Focused fixed ${request.application} surface.` };
  };

  async execute(request: WindowsHostActionEffectRequest): Promise<WindowsHostActionEffectResult> {
    this.requests.push(request);
    return this.implementation(request);
  }
}

async function fixture(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "b122-windows-host-action-consumer-"));
  context.after(async () => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  let clock = fixedNow;
  let token = 0;
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator, clock: () => clock });
  const queue = new DurableHostActionQueue(store, {
    now: () => new Date(clock),
    finalAuthorizer: { async authorize(intent) {
      return intent.targetSnapshotId === undefined && intent.sessionId === undefined && intent.workspaceRoot === undefined
        ? { allowed: true, reason: "Exact targetless local action." }
        : { allowed: false, reason: "Contextual host actions remain extension-owned." };
    } }
  });
  const executor = new RecordingExecutor();
  const effects = new RecordingEffects();
  const create = (queuePort: WindowsHostActionQueuePort = queue, completionExecutor: RecordingExecutor = executor, applications: Readonly<Partial<Record<"vscode" | "terminal", FixedWindowsHostApplicationIdentity>>> = { vscode: identity("vscode"), terminal: identity("terminal") }) => new CompanionWindowsHostActionConsumer(
    store,
    queuePort,
    completionExecutor,
    effects,
    {
      applications,
      pollIntervalMs: 10,
      effectTimeoutMs: 75,
      now: () => clock,
      claimTokenFactory: () => `isolated-windows-host-claim-${String(++token).padStart(4, "0")}`
    }
  );
  return { directory, store, queue, executor, effects, create, setClock(value: string) { clock = value; } };
}

async function queueAction(queue: DurableHostActionQueue, action: CommandAction, operationId: string): Promise<void> {
  const request: AdapterRequest = { definition: commandForAction(action), operationId };
  const result = await new DurableHostActionAdapter(queue).execute(request);
  assert.equal(result.status, "running");
}

async function waitFor(check: () => Promise<boolean> | boolean, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

test("the companion consumes only exact targetless VS Code and terminal focus intents after durable claims", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_vscode", "operation-focus-vscode");
  await queueAction(setup.queue, "focus_terminal", "operation-focus-terminal");
  setup.effects.implementation = async (request) => {
    const before = await setup.store.readEntries();
    assert.ok(before.some((entry) => entry.kind === "b122.windows-host-action.claimed.v1"));
    assert.equal(before.some((entry) => entry.kind === "b122.windows-host-action.effect-started.v1" && (entry.payload as { claimId?: string }).claimId?.includes(request.hostActionId)), false);
    await request.beforeEffect();
    const after = await setup.store.readEntries();
    assert.ok(after.some((entry) => entry.kind === "b122.windows-host-action.effect-started.v1"));
    return { disposition: "committed", summary: `Focused ${request.application}.` };
  };

  const consumer = setup.create();
  await consumer.start();
  await waitFor(() => setup.executor.records.length === 2, "two exact Windows host actions");
  await consumer.stop();

  assert.deepEqual(setup.effects.requests.map((request) => request.action), ["focus_vscode", "focus_external_terminal"]);
  const vscode = setup.effects.requests[0]!;
  assert.equal(vscode.application, "vscode");
  assert.equal(vscode.executable.productId, "microsoft.visual-studio-code");
  assert.deepEqual(vscode.fixedArguments, ["--reuse-window"]);
  assert.equal(vscode.processOwner, "current-user");
  assert.equal(vscode.processSession, "current-session");
  assert.equal(vscode.windowSurface, "visible-top-level");
  assert.equal(vscode.windowCycleOrdinal, 0);
  assert.equal(vscode.shell, false);
  assert.equal("workspaceRoot" in vscode, false);
  assert.equal("url" in vscode, false);

  const terminal = setup.effects.requests[1]!;
  assert.equal(terminal.application, "terminal");
  assert.equal(terminal.windowCycleOrdinal, 0);
  assert.equal(terminal.executable.productId, "microsoft.windows-terminal");
  assert.deepEqual(terminal.fixedArguments, []);
  assert.ok(setup.executor.records.every((record) => record.status === "completed"));
  assert.equal((await setup.queue.listPending()).length, 0);
});

test("an unavailable reviewed host application settles not-started without invoking the effect port", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_vscode", "operation-unavailable-vscode");
  const consumer = setup.create(setup.queue, setup.executor, { terminal: identity("terminal") });
  await consumer.start();
  await waitFor(() => setup.executor.records.length === 1, "unavailable VS Code settlement");
  await consumer.stop();
  assert.equal(setup.effects.requests.length, 0);
  assert.equal(setup.executor.records[0]!.status, "failed");
  assert.match(setup.executor.records[0]!.summary, /vscode.*unavailable/i);
});

test("repeated VS Code focus durably advances the exact native window ordinal across consumer restart and resets after the repeat window", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_vscode", "operation-focus-vscode-cycle-1");
  const first = setup.create();
  await first.start();
  await waitFor(() => setup.executor.records.length === 1, "first VS Code focus cycle");
  await first.stop();

  setup.setClock("2026-08-25T17:00:01.000Z");
  await queueAction(setup.queue, "focus_vscode", "operation-focus-vscode-cycle-2");
  const restarted = setup.create();
  await restarted.start();
  await waitFor(() => setup.executor.records.length === 2, "second VS Code focus cycle");
  await restarted.stop();

  setup.setClock("2026-08-25T17:00:10.000Z");
  await queueAction(setup.queue, "focus_vscode", "operation-focus-vscode-cycle-reset");
  const afterTimeout = setup.create();
  await afterTimeout.start();
  await waitFor(() => setup.executor.records.length === 3, "reset VS Code focus cycle");
  await afterTimeout.stop();

  assert.deepEqual(setup.effects.requests.map((request) => request.windowCycleOrdinal), [0, 1, 0]);
  const claims = (await setup.store.readEntries())
    .filter((entry) => entry.kind === "b122.windows-host-action.claimed.v1")
    .map((entry) => (entry.payload as { windowCycleOrdinal?: unknown }).windowCycleOrdinal);
  assert.deepEqual(claims, [0, 1, 0], "the repeat cursor must be protected durable claim state, not process-local UI state");
});

test("Voice Center remains extension-owned and is never confused with launching or focusing Code", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "open_voice", "operation-open-voice");
  const consumer = setup.create();
  await consumer.start();
  await new Promise((resolve) => setTimeout(resolve, 45));
  await consumer.stop();

  assert.equal(setup.effects.requests.length, 0);
  assert.equal(setup.executor.records.length, 0);
  assert.deepEqual((await setup.queue.listPending()).map((intent) => [intent.commandAction, intent.hostAction]), [["open_voice", "show_voice_center"]]);
  const entries = await setup.store.readEntries();
  assert.equal(entries.some((entry) => entry.kind.startsWith("b122.windows-host-action.")), false);
});

test("context fields, unknown fields, and mismatched closed mappings never reach authorization or Windows", async (context) => {
  const setup = await fixture(context);
  const createdAt = fixedNow;
  const expiresAt = "2026-08-25T17:00:30.000Z";
  const intents: Array<Record<string, unknown>> = [
    hostileIntent("hostile-context", "focus_vscode", "focus_vscode", createdAt, expiresAt, { targetSnapshotId: "target-hostile" }),
    hostileIntent("hostile-extra", "focus_terminal", "focus_external_terminal", createdAt, expiresAt, { command: "calc.exe" }),
    hostileIntent("hostile-map", "focus_vscode", "focus_external_terminal", createdAt, expiresAt)
  ];
  for (const intent of intents) await setup.store.append("host_action", { version: 1, event: "queued", intent });

  const consumer = setup.create();
  await consumer.start();
  await new Promise((resolve) => setTimeout(resolve, 45));
  await consumer.stop();

  assert.equal(setup.effects.requests.length, 0);
  assert.equal(setup.executor.records.length, 0);
  const entries = await setup.store.readEntries();
  assert.equal(entries.some((entry) => entry.kind === "host_action" && (entry.payload as { event?: string }).event === "authorized"), false);
  assert.equal(entries.some((entry) => entry.kind.startsWith("b122.windows-host-action.")), false);
});

test("a returned effect without the single-use durable barrier is failed as not started", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_vscode", "operation-missing-barrier");
  setup.effects.implementation = async () => ({ disposition: "committed", summary: "Untrusted early success." });
  const consumer = setup.create();
  await consumer.start();
  await waitFor(() => setup.executor.records.length === 1, "missing-barrier settlement");
  await consumer.stop();

  assert.equal(setup.executor.records[0]?.status, "failed");
  assert.match(setup.executor.records[0]?.summary ?? "", /without crossing|required durable effect barrier/i);
  const entries = await setup.store.readEntries();
  assert.equal(entries.some((entry) => entry.kind === "b122.windows-host-action.effect-started.v1"), false);
});

test("an exception after the durable effect boundary is ambiguous and never replayed", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_terminal", "operation-ambiguous-effect");
  setup.effects.implementation = async (request) => {
    await request.beforeEffect();
    throw new Error("injected lost native response");
  };
  const first = setup.create();
  await first.start();
  await waitFor(() => setup.executor.records.length === 1, "ambiguous effect settlement");
  await first.stop();
  assert.equal(setup.executor.records[0]?.status, "incomplete");
  assert.equal(setup.effects.requests.length, 1);

  const afterRestartEffects = new RecordingEffects();
  const restarted = new CompanionWindowsHostActionConsumer(
    setup.store,
    setup.queue,
    setup.executor,
    afterRestartEffects,
    { applications: { vscode: identity("vscode"), terminal: identity("terminal") }, pollIntervalMs: 10, effectTimeoutMs: 75, now: () => fixedNow }
  );
  await restarted.start();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await restarted.stop();
  assert.equal(afterRestartEffects.requests.length, 0);
});

test("restart converts a lost post-effect settlement into durable ambiguity without re-forwarding", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_vscode", "operation-lost-settlement");
  const losingQueue: WindowsHostActionQueuePort = {
    listPending: () => setup.queue.listPending(),
    listSettled: () => setup.queue.listSettled(),
    authorize: (payload) => setup.queue.authorize(payload),
    async settle() { throw new Error("injected lost settlement write"); }
  };
  const first = setup.create(losingQueue);
  await first.start();
  await waitFor(async () => (await setup.store.readEntries()).some((entry) => entry.kind === "b122.windows-host-action.effect-started.v1"), "durable effect boundary");
  await first.stop();
  assert.equal(setup.effects.requests.length, 1);
  assert.equal(setup.executor.records.length, 0);

  const afterRestartEffects = new RecordingEffects();
  const restarted = new CompanionWindowsHostActionConsumer(
    setup.store,
    setup.queue,
    setup.executor,
    afterRestartEffects,
    { applications: { vscode: identity("vscode"), terminal: identity("terminal") }, pollIntervalMs: 10, effectTimeoutMs: 75, now: () => fixedNow }
  );
  await restarted.start();
  await waitFor(() => setup.executor.records.length === 1, "restart ambiguity reconciliation");
  await restarted.stop();
  assert.equal(afterRestartEffects.requests.length, 0);
  assert.equal(setup.executor.records[0]?.status, "incomplete");
  assert.match(setup.executor.records[0]?.summary ?? "", /restart|ambiguous|not replayed/i);
});

test("restart retries only durable external completion after its queue settlement was already committed", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_terminal", "operation-lost-external-completion");
  setup.executor.fail = true;
  const first = setup.create();
  await first.start();
  await waitFor(async () => (await setup.queue.listSettled()).length === 1, "durable queue settlement");
  await first.stop();
  assert.equal(setup.effects.requests.length, 1);
  assert.equal(setup.executor.records.length, 1);

  setup.executor.fail = false;
  const afterRestartEffects = new RecordingEffects();
  const restarted = new CompanionWindowsHostActionConsumer(
    setup.store,
    setup.queue,
    setup.executor,
    afterRestartEffects,
    { applications: { vscode: identity("vscode"), terminal: identity("terminal") }, pollIntervalMs: 10, effectTimeoutMs: 75, now: () => fixedNow }
  );
  await restarted.start();
  await waitFor(() => setup.executor.records.length === 2, "external completion retry");
  await restarted.stop();
  assert.equal(afterRestartEffects.requests.length, 0);
  assert.equal(setup.executor.records[1]?.status, "completed");
});

test("stop aborts a non-settling post-barrier native effect and records ambiguity without hanging", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_vscode", "operation-stop-post-barrier");
  let crossed!: () => void;
  const started = new Promise<void>((resolve) => { crossed = resolve; });
  setup.effects.implementation = async (request) => {
    await request.beforeEffect();
    crossed();
    return new Promise<WindowsHostActionEffectResult>(() => undefined);
  };
  const consumer = setup.create();
  await consumer.start();
  await started;
  const before = Date.now();
  await consumer.stop();
  assert.ok(Date.now() - before < 500, "stop waited on a non-settling native port");
  assert.equal(setup.executor.records.length, 1);
  assert.equal(setup.executor.records[0]?.status, "incomplete");
});

test("stop before the native barrier admits no effect and settles failed", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_terminal", "operation-stop-pre-barrier");
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  setup.effects.implementation = async (request) => {
    entered();
    await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve(), { once: true }));
    await request.beforeEffect();
    return { disposition: "committed", summary: "must not commit" };
  };
  const consumer = setup.create();
  await consumer.start();
  await ready;
  await consumer.stop();
  assert.equal(setup.executor.records.length, 1);
  assert.equal(setup.executor.records[0]?.status, "failed");
  const entries = await setup.store.readEntries();
  assert.equal(entries.some((entry) => entry.kind === "b122.windows-host-action.effect-started.v1"), false);
});

test("stop bounds a never-settling queue authorization and observes its late promise", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_vscode", "operation-never-authorized");
  const stalled: WindowsHostActionQueuePort = {
    listPending: () => setup.queue.listPending(),
    listSettled: () => setup.queue.listSettled(),
    authorize: async () => new Promise<never>(() => undefined),
    settle: (payload) => setup.queue.settle(payload)
  };
  const consumer = setup.create(stalled);
  await consumer.start();
  await waitFor(async () => (await setup.store.readEntries()).some((entry) => entry.kind === "b122.windows-host-action.claimed.v1"), "pre-authorization durable claim");
  const before = Date.now();
  await consumer.stop();
  assert.ok(Date.now() - before < 500, "stop waited on a non-settling authorization");
  assert.equal(setup.effects.requests.length, 0);
  assert.equal(setup.executor.records.length, 0);
});

test("stop during startup cancels a never-settling reconciliation read and cannot start later", async (context) => {
  const setup = await fixture(context);
  const stalled: WindowsHostActionQueuePort = {
    listPending: () => setup.queue.listPending(),
    listSettled: async () => new Promise<never>(() => undefined),
    authorize: (payload) => setup.queue.authorize(payload),
    settle: (payload) => setup.queue.settle(payload)
  };
  const consumer = setup.create(stalled);
  const starting = consumer.start();
  await new Promise((resolve) => setTimeout(resolve, 15));
  const before = Date.now();
  await consumer.stop();
  await starting;
  assert.ok(Date.now() - before < 500, "stop waited on a non-settling startup read");

  await queueAction(setup.queue, "focus_terminal", "operation-after-stopped-startup");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(setup.effects.requests.length, 0);
});

test("a competing extension authorization owns the single effect and is not overwritten by the companion", async (context) => {
  const setup = await fixture(context);
  await queueAction(setup.queue, "focus_vscode", "operation-extension-wins");
  const pending = (await setup.queue.listPending())[0]!;
  const authorization = await setup.queue.authorize({ hostActionId: pending.id, adapterVersion: "vscode-extension-0.1.0" });

  const consumer = setup.create();
  await consumer.start();
  await waitFor(async () => (await setup.store.readEntries()).some((entry) => entry.kind === "b122.windows-host-action.terminal.v1"), "yielded consumer claim");
  await consumer.stop();
  assert.equal(setup.effects.requests.length, 0);
  assert.equal((await setup.queue.listSettled()).length, 0);

  const completed = await setup.queue.settle({
    hostActionId: pending.id,
    succeeded: true,
    effectDisposition: "committed",
    summary: "The extension committed the exact focus action.",
    adapterVersion: "vscode-extension-0.1.0",
    authorizationToken: authorization.authorizationToken
  });
  assert.equal(completed.status, "completed");
});

test("fixed application identities and effect results reject hostile paths, products, extra fields, and output", async (context) => {
  const setup = await fixture(context);
  const vscode = identity("vscode");
  assert.throws(() => new CompanionWindowsHostActionConsumer(setup.store, setup.queue, setup.executor, setup.effects, {
    applications: { vscode: { ...vscode, canonicalExecutablePath: "Code.exe" }, terminal: identity("terminal") }
  }), /identity is invalid/i);
  assert.throws(() => new CompanionWindowsHostActionConsumer(setup.store, setup.queue, setup.executor, setup.effects, {
    applications: { vscode: { ...vscode, productId: "microsoft.windows-terminal" as "microsoft.visual-studio-code" }, terminal: identity("terminal") }
  }), /identity is invalid/i);
  assert.throws(() => new CompanionWindowsHostActionConsumer(setup.store, setup.queue, setup.executor, setup.effects, {
    applications: { vscode: { ...vscode, command: "calc.exe" } as FixedWindowsHostApplicationIdentity, terminal: identity("terminal") }
  }), /identity is invalid/i);

  await queueAction(setup.queue, "focus_vscode", "operation-hostile-result");
  setup.effects.implementation = async (request) => {
    await request.beforeEffect();
    return { disposition: "committed", summary: "forged", command: "calc.exe" } as WindowsHostActionEffectResult;
  };
  const consumer = setup.create();
  await consumer.start();
  await waitFor(() => setup.executor.records.length === 1, "hostile result settlement");
  await consumer.stop();
  assert.equal(setup.executor.records[0]?.status, "incomplete");
});

function hostileIntent(
  suffix: string,
  commandAction: "focus_vscode" | "focus_terminal",
  hostAction: LocalHostActionKind,
  createdAt: string,
  expiresAt: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const operationId = `operation-${suffix}`;
  return {
    version: 1,
    id: `host-action:${sha256(`${operationId}:${commandAction}`)}`,
    operationId,
    commandAction,
    hostAction,
    createdAt,
    expiresAt,
    ...extra
  } satisfies Omit<HostActionIntent, "hostAction"> & { hostAction: LocalHostActionKind } & Record<string, unknown>;
}
