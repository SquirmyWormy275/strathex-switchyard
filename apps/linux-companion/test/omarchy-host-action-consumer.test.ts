import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { DurableHostActionAdapter, DurableHostActionQueue } from "../../windows-companion/src/host-actions.ts";
import type { HostActionCompletionRecord } from "../../windows-companion/src/service.ts";
import type { AdapterRequest } from "../../../packages/control-plane/src/adapters.ts";
import type { OmarchyHostEvidence } from "../src/omarchy-capabilities.ts";
import { CompanionOmarchyHostActionConsumer, type OmarchyHostActionQueuePort } from "../src/omarchy-host-action-consumer.ts";
import { NativeOmarchyHostActionAdapter } from "../src/omarchy-host-action.ts";

const authenticator: JournalAuthenticator = { provider: "omarchy-consumer-test", async seal(hash) { return `test:${hash}`; }, async verify(hash, tag) { return tag === `test:${hash}`; } };
const evidence: OmarchyHostEvidence = { schemaVersion: 1, collectedAt: "2026-09-01T07:00:00.000Z", platform: "linux", capabilities: ["omarchy","hyprland","wayland","tmux","systemd-user"].map((id) => ({ id: id as "omarchy", available: true, evidence: [id] })) };

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "b122-omarchy-consumer-")); context.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProtectedJsonStore({ filePath: join(root, "protected.jsonl"), authenticator });
  const queue = new DurableHostActionQueue(store, { finalAuthorizer: { async authorize(intent) { return intent.targetSnapshotId === undefined && intent.sessionId === undefined && intent.workspaceRoot === undefined ? { allowed: true, reason: "targetless" } : { allowed: false, reason: "contextual" }; } } });
  const records: HostActionCompletionRecord[] = [];
  const executor = { async execute() { throw new Error("unused"); }, async completeExternalOperation(record: HostActionCompletionRecord) { records.push(record); return { status: record.status === "completed" ? "completed" as const : record.status === "incomplete" ? "incomplete" as const : "failed" as const, summary: record.summary, operationId: record.operationId }; } };
  return { store, queue, records, executor };
}
async function queueAction(queue: DurableHostActionQueue, action: CommandAction, operationId: string): Promise<void> { const request: AdapterRequest = { definition: commandForAction(action), operationId }; assert.equal((await new DurableHostActionAdapter(queue).execute(request)).status, "running"); }
async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> { const until = Date.now() + 2_000; while (Date.now() < until) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error("timed out"); }

test("durable Omarchy consumer admits only exact targetless focus intents", async (context) => {
  const setup = await fixture(context); await queueAction(setup.queue, "focus_vscode", "operation-omarchy-code"); await queueAction(setup.queue, "focus_terminal", "operation-omarchy-foot");
  const calls: string[][] = []; let phase = 0;
  const effects = new NativeOmarchyHostActionAdapter({ async run(executable, args) { calls.push([executable, ...args]); const selector = phase === 0 ? "code" : "foot"; if (args[0] === "activewindow") phase += 1; return { stdout: args[0] === "clients" ? `[{"mapped":true,"initialClass":"${selector}"}]` : args[0] === "activewindow" ? `{"initialClass":"${selector}"}` : "ok\n", stderr: "" }; } });
  const consumer = new CompanionOmarchyHostActionConsumer(setup.store, setup.queue, setup.executor, effects, { evidence, identities: { vscode: { version: 1, surface: "vscode", initialClass: "code" }, terminal: { version: 1, surface: "terminal", initialClass: "foot" } }, pollIntervalMs: 10 });
  await consumer.start(); await waitFor(() => setup.records.length === 2); await consumer.stop();
  assert.deepEqual(calls.filter((call) => call[1] === "dispatch"), [
    ["/usr/bin/hyprctl", "dispatch", "hl.dsp.focus({ window = \"initialclass:^(code)$\" })"],
    ["/usr/bin/hyprctl", "dispatch", "hl.dsp.focus({ window = \"initialclass:^(foot)$\" })"]
  ]);
  assert.ok(setup.records.every((record) => record.status === "completed"));
  const entries = await setup.store.readEntries(); assert.equal(entries.filter((entry) => entry.kind === "b122.omarchy-host-action.effect-started.v1").length, 2);
});

test("missing identity fails closed without a compositor effect", async (context) => {
  const setup = await fixture(context); await queueAction(setup.queue, "focus_vscode", "operation-omarchy-code-missing"); let calls = 0;
  const consumer = new CompanionOmarchyHostActionConsumer(setup.store, setup.queue, setup.executor, new NativeOmarchyHostActionAdapter({ async run() { calls += 1; return { stdout: "ok", stderr: "" }; } }), { evidence, identities: { terminal: { version: 1, surface: "terminal", initialClass: "foot" } }, pollIntervalMs: 10 });
  await consumer.start(); await waitFor(() => setup.records.length === 1); await consumer.stop();
  assert.equal(calls, 0); assert.equal(setup.records[0]?.status, "failed"); assert.match(setup.records[0]?.summary ?? "", /identity is unavailable/i);
});

test("startup reconciliation never replays an effect whose settlement response was lost", async (context) => {
  const setup = await fixture(context); await queueAction(setup.queue, "focus_terminal", "operation-omarchy-recovery"); let effects = 0; let lose = true;
  const lossy: OmarchyHostActionQueuePort = { listPending: () => setup.queue.listPending(), listSettled: () => setup.queue.listSettled(), authorize: (value) => setup.queue.authorize(value), async settle(value) { if (lose) { lose = false; throw new Error("lost settlement"); } return setup.queue.settle(value); } };
  const adapter = new NativeOmarchyHostActionAdapter({ async run(_executable, args) { if (args[0] === "dispatch") effects += 1; return { stdout: args[0] === "clients" ? '[{"mapped":true,"initialClass":"foot"}]' : args[0] === "activewindow" ? '{"initialClass":"foot"}' : "ok", stderr: "" }; } });
  const first = new CompanionOmarchyHostActionConsumer(setup.store, lossy, setup.executor, adapter, { evidence, identities: { terminal: { version: 1, surface: "terminal", initialClass: "foot" } }, pollIntervalMs: 10 });
  await first.start(); await waitFor(async () => (await setup.store.readEntries()).some((entry) => entry.kind === "b122.omarchy-host-action.effect-started.v1")); await first.stop();
  const restarted = new CompanionOmarchyHostActionConsumer(setup.store, lossy, setup.executor, adapter, { evidence, identities: { terminal: { version: 1, surface: "terminal", initialClass: "foot" } }, pollIntervalMs: 10 });
  await restarted.start(); await waitFor(() => setup.records.length === 1); await restarted.stop();
  assert.equal(effects, 1); assert.equal(setup.records[0]?.status, "incomplete"); assert.match(setup.records[0]?.summary ?? "", /not replayed/i);
});
