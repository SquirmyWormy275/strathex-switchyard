import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { companionBridgeVersion } from "../src/bridge.ts";
import { createDurableWindowsCompanion } from "../src/bootstrap.ts";
import { DurableHostActionAdapter, DurableHostActionQueue } from "../src/host-actions.ts";

const authenticator: JournalAuthenticator = {
  provider: "isolated-host-action-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

const target: TargetSnapshot = {
  id: "target-host-action", repositoryRoot: "C:/isolated/repo", canonicalRemote: "git@github.com:acme/switchyard.git",
  branch: "feature/host-actions", head: "head", indexTree: "tree", trackedManifest: "tracked", untrackedManifest: "untracked",
  submodules: {}, policyVersion: "policy-host", environmentFingerprint: "environment", capturedAt: "2026-08-23T00:00:00.000Z",
  completeness: "complete", reasons: []
};

test("GitHub host action derives only a trusted canonical URL and is durably idempotent", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-actions-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  let tick = 0;
  const queue = new DurableHostActionQueue(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }), {
    now: () => new Date(`2026-08-23T00:00:0${tick++}.000Z`),
    finalAuthorizer: { async authorize() { return { allowed: true, reason: "exact target remains current" }; } }
  });
  const adapter = new DurableHostActionAdapter(queue, { async resolve(_request, page) {
    assert.equal(page, "pr");
    return { kind: "open", url: "https://github.com/acme/switchyard/pull/23", summary: "resolved exact current-branch PR" };
  } });
  const request = { definition: commandForAction("github_pr"), operationId: "operation-github", target };
  const first = await adapter.execute(request);
  const second = await adapter.execute(request);
  assert.equal(first.status, "running");
  assert.deepEqual(second.data, first.data);
  assert.equal(first.data?.hostActionUrl, "https://github.com/acme/switchyard/pull/23");
  assert.equal((await queue.listPending()).length, 1);
  const authorization = await queue.authorize({ hostActionId: String(first.data?.hostActionId), adapterVersion: "isolated-extension-1" });
  assert.equal(authorization.url, "https://github.com/acme/switchyard/pull/23", "final authorization must rebind the exact durable URL");
  const completion = await queue.settle({ hostActionId: String(first.data?.hostActionId), succeeded: true, summary: "Opened the exact reviewed host destination.", adapterVersion: "isolated-extension-1", authorizationToken: authorization.authorizationToken });
  assert.equal("evidenceDigest" in completion, false, "host UI acknowledgement must not mint gate-bearing receipt evidence");
  assert.equal("toolVersions" in completion, false, "only typed runtime/scanner issuers may supply receipt tool evidence");
});

test("GitHub host actions preserve the exact canonical GitHub Enterprise host", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-actions-ghe-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const queue = new DurableHostActionQueue(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }));
  const adapter = new DurableHostActionAdapter(queue, { async resolve(_request, page) {
    assert.equal(page, "actions");
    return { kind: "open", url: "https://ghe.example.test/acme/switchyard/actions/runs/9", summary: "resolved exact current-head run" };
  } });
  const enterpriseTarget = { ...target, canonicalRemote: "ssh://git@ghe.example.test/acme/switchyard.git" };
  const result = await adapter.execute({ definition: commandForAction("github_actions"), operationId: "operation-ghe", target: enterpriseTarget });
  assert.equal(result.status, "running");
  assert.equal(result.data?.hostActionUrl, "https://ghe.example.test/acme/switchyard/actions/runs/9");
});

test("venv host actions durably preserve the exact protected interpreter identity and reject idempotency-field substitution", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-actions-venv-identity-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const queue = new DurableHostActionQueue(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }));
  const pythonInterpreter = `${target.repositoryRoot}\\.venv\\Scripts\\python.exe`;
  const pythonInterpreterIdentity = {
    canonicalPath: pythonInterpreter, sha256: "7".repeat(64), device: "1", inode: "2", size: 42, modifiedMs: 1_777_000_000_000
  };
  const request = { definition: commandForAction("venv"), operationId: "operation-venv-identity", target };
  const intent = await queue.enqueue(request, { hostAction: "configure_python_venv", pythonInterpreter, pythonInterpreterIdentity });
  assert.deepEqual(intent.pythonInterpreterIdentity, pythonInterpreterIdentity);
  assert.deepEqual((await queue.listPending())[0]?.pythonInterpreterIdentity, pythonInterpreterIdentity);
  await assert.rejects(
    queue.enqueue(request, { hostAction: "configure_python_venv", pythonInterpreter, pythonInterpreterIdentity: { ...pythonInterpreterIdentity, sha256: "8".repeat(64) } }),
    /different intent|operation/i
  );
  await assert.rejects(
    queue.enqueue({ definition: commandForAction("github_home"), operationId: "operation-invalid-identity", target }, { hostAction: "open_external_url", url: "https://github.com/acme/switchyard", pythonInterpreterIdentity } as never),
    /only the exact Python-environment host action/i
  );
});

test("all four Voice chords queue one durable extension-owned host-action lifecycle and never a browser or workflow fallback", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-actions-voice-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const queue = new DurableHostActionQueue(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }));
  const adapter = new DurableHostActionAdapter(queue);
  for (const [index, action] of (["open_voice", "switch_voice_provider", "bind_voice_session", "voice_session_picker"] as const).entries()) {
    const result = await adapter.execute({ definition: commandForAction(action), operationId: `operation-voice-${index}`, target });
    assert.equal(result.status, "running");
    assert.equal(result.data?.hostActionKind, "show_voice_center");
    assert.equal(result.data?.hostActionUrl, undefined);
  }
  assert.deepEqual((await queue.listPending()).map((intent) => [intent.commandAction, intent.hostAction]), [
    ["open_voice", "show_voice_center"],
    ["switch_voice_provider", "show_voice_center"],
    ["bind_voice_session", "show_voice_center"],
    ["voice_session_picker", "show_voice_center"]
  ]);
});

test("targeted Voice actions can be claimed only by a registered window containing their exact repository root", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-actions-voice-root-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const queue = new DurableHostActionQueue(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }), {
    now: () => new Date("2026-08-25T12:00:00.000Z"),
    claimTokenFactory: () => "target-aware-voice-claim-token"
  });
  const source: ManagedSession = {
    id: "voice-provider-source", provider: "codex", surface: "vscode_terminal", capabilities: ["registered"], status: "running",
    workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, plannedFiles: [], lastHeartbeat: "2026-08-25T12:00:00.000Z", adapterVersion: "provider-1", metadata: {}
  };
  await queue.enqueue({ definition: commandForAction("bind_voice_session"), operationId: "operation-targeted-voice", target, session: source }, { hostAction: "show_voice_center" });
  assert.equal(await queue.claim({ windowSessionId: "wrong-window", workspaceRoots: ["C:/isolated/other"], adapterVersion: "1.2.3", capabilities: ["show_voice_center"], focused: true }), undefined);
  const claim = await queue.claim({ windowSessionId: "exact-window", workspaceRoots: ["C:/isolated/repo", "C:/isolated/second"], adapterVersion: "1.2.3", capabilities: ["show_voice_center"], focused: true });
  assert.ok(claim);
  assert.equal(claim.workspaceRoot, target.repositoryRoot);
  assert.equal(claim.targetSnapshotId, target.id);
  assert.equal(claim.sessionId, source.id);
  assert.equal(claim.commandAction, "bind_voice_session");
});

test("Voice Center claims are durable, single-consumer, and never replayed after an ambiguous or expired lease", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-actions-voice-claim-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator });
  let now = new Date("2026-08-25T12:00:00.000Z");
  let token = 0;
  const options = {
    now: () => now,
    claimLifetimeMs: 1_000,
    claimTokenFactory: () => `voice-claim-token-${++token}`,
    finalAuthorizer: { async authorize() { return { allowed: true, reason: "exact extension claim remains current" }; } }
  } as const;
  const queue = new DurableHostActionQueue(store, options);
  const intent = await queue.enqueue({ definition: commandForAction("open_voice"), operationId: "operation-voice-claim" }, { hostAction: "show_voice_center" });
  const first = await queue.claim({ windowSessionId: "vscode-window-one", workspaceRoots: [target.repositoryRoot], adapterVersion: "1.2.3", capabilities: ["show_voice_center"], focused: true });
  assert.ok(first);
  assert.equal(first.hostActionId, intent.id);
  assert.equal(first.hostActionKind, "show_voice_center");
  assert.equal(first.claimToken, "voice-claim-token-1");

  assert.equal(await queue.claim({ windowSessionId: "vscode-window-two", workspaceRoots: [target.repositoryRoot], adapterVersion: "1.2.3", capabilities: ["show_voice_center"], focused: true }), undefined);
  assert.equal(await queue.claim({ windowSessionId: "vscode-window-one", workspaceRoots: [target.repositoryRoot], adapterVersion: "1.2.3", capabilities: ["show_voice_center"], focused: true }), undefined, "a lost claim response must not be replayed even to the same window");

  const restarted = new DurableHostActionQueue(store, options);
  assert.equal(await restarted.claim({ windowSessionId: "vscode-window-two", workspaceRoots: [target.repositoryRoot], adapterVersion: "1.2.3", capabilities: ["show_voice_center"], focused: true }), undefined, "a queued claim remains single-consumer across restart");
  now = new Date("2026-08-25T12:00:01.001Z");
  assert.equal(await restarted.claim({ windowSessionId: "vscode-window-two", workspaceRoots: [target.repositoryRoot], adapterVersion: "1.2.3", capabilities: ["show_voice_center"], focused: true }), undefined, "an expired claim is reconciliation work, not replay authority");
  await assert.rejects(restarted.authorize({
    hostActionId: first.hostActionId,
    adapterVersion: first.adapterVersion,
    claimId: first.claimId,
    claimToken: first.claimToken,
    windowSessionId: first.windowSessionId
  }), /claim.*expired|lease.*expired/i);
  assert.deepEqual((await restarted.listPending()).map((candidate) => candidate.id), [intent.id]);
});

test("a claimed Voice Center action authorizes and settles only through its exact extension lease", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-actions-voice-settle-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const queue = new DurableHostActionQueue(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }), {
    now: () => new Date("2026-08-25T12:00:00.000Z"),
    claimTokenFactory: () => "exact-voice-claim-token",
    finalAuthorizer: { async authorize() { return { allowed: true, reason: "current" }; } }
  });
  await queue.enqueue({ definition: commandForAction("open_voice"), operationId: "operation-voice-settle" }, { hostAction: "show_voice_center" });
  const claim = await queue.claim({ windowSessionId: "vscode-window-one", workspaceRoots: ["C:/isolated/ui"], adapterVersion: "1.2.3", capabilities: ["show_voice_center"], focused: true });
  assert.ok(claim);
  await assert.rejects(queue.authorize({ hostActionId: claim.hostActionId, adapterVersion: claim.adapterVersion }), /claim/i);
  await assert.rejects(queue.authorize({ ...claim, hostActionId: claim.hostActionId, claimToken: "substituted-token" }), /claim/i);
  const authorization = await queue.authorize({
    hostActionId: claim.hostActionId,
    adapterVersion: claim.adapterVersion,
    claimId: claim.claimId,
    claimToken: claim.claimToken,
    windowSessionId: claim.windowSessionId
  });
  await assert.rejects(queue.settle({ hostActionId: claim.hostActionId, succeeded: true, summary: "opened", adapterVersion: claim.adapterVersion, authorizationToken: authorization.authorizationToken }), /claim/i);
  const settled = await queue.settle({
    hostActionId: claim.hostActionId,
    succeeded: true,
    effectDisposition: "committed",
    summary: "Opened the real native Voice Center.",
    adapterVersion: claim.adapterVersion,
    authorizationToken: authorization.authorizationToken,
    claimId: claim.claimId,
    claimToken: claim.claimToken,
    windowSessionId: claim.windowSessionId
  });
  assert.equal(settled.status, "completed");
  assert.deepEqual(await queue.listPending(), []);
});

test("ambiguous GitHub identities queue a bounded picker and authorize only the selected exact candidate", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-actions-picker-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const queue = new DurableHostActionQueue(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }), {
    finalAuthorizer: { async authorize() { return { allowed: true, reason: "exact target remains current" }; } }
  });
  const adapter = new DurableHostActionAdapter(queue, { async resolve() { return { kind: "picker", summary: "Select an exact PR.", candidates: [
    { id: "pull:2", label: "PR #2", description: "to main", url: "https://github.com/acme/switchyard/pull/2" },
    { id: "pull:3", label: "PR #3", description: "to release", url: "https://github.com/acme/switchyard/pull/3" }
  ] }; } });
  const result = await adapter.execute({ definition: commandForAction("github_pr"), operationId: "operation-picker", target });
  assert.equal(result.status, "running");
  assert.equal(result.data?.hostActionKind, "select_github_navigation");
  assert.equal((result.data?.githubCandidates as readonly unknown[]).length, 2);
  assert.equal((await queue.listPending()).length, 1);
  await assert.rejects(queue.authorize({ hostActionId: String(result.data?.hostActionId), adapterVersion: "extension-1" }), /selection/i);
  await assert.rejects(queue.authorize({ hostActionId: String(result.data?.hostActionId), adapterVersion: "extension-1", selectionId: "pull:99" }), /selection/i);
  const authorized = await queue.authorize({ hostActionId: String(result.data?.hostActionId), adapterVersion: "extension-1", selectionId: "pull:3" });
  assert.equal(authorized.selectionId, "pull:3");
  assert.equal(authorized.url, "https://github.com/acme/switchyard/pull/3");

  const unconfigured = await new DurableHostActionAdapter(queue).execute({ definition: commandForAction("github_home"), operationId: "operation-no-route", target: { ...target, canonicalRemote: "https://gitlab.example/acme/switchyard.git" } });
  assert.equal(unconfigured.status, "unavailable");
  assert.match(unconfigured.summary, /no search URL was guessed/i);
  assert.equal((await queue.listPending()).length, 1);
});

test("installed dispatch keeps provider desktop commands unavailable without the exact installed adapter", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-integration-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator });
  const companion = createDurableWindowsCompanion({
    store,
    policyVersion: "policy-host",
    localStateDirectory: directory,
    targetResolver: { resolve: async () => undefined }
  });
  const dispatch = await companion.endpoint.handle({ version: companionBridgeVersion, id: "open-claude", method: "command.dispatch", payload: { control: "CLAUDE", modifier: "normal" } });
  assert.equal(dispatch.ok, true);
  const command = (dispatch.result as { command: { status: string; summary: string } }).command;
  assert.equal(command.status, "unavailable");
  assert.match(command.summary, /adapter|unavailable|configured/i);
  assert.equal((await companion.hostActions.listPending()).length, 0);
});

test("host actions fail closed on target churn, missing authorization, and authorization replay", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-final-barrier-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  let current = false;
  const queue = new DurableHostActionQueue(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }), {
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    finalAuthorizer: { async authorize() { return { allowed: current, reason: current ? "current" : "TargetSnapshot changed before the host effect." }; } }
  });
  const intent = await queue.enqueue({ definition: commandForAction("github_home"), operationId: "operation-barrier", target }, { hostAction: "open_external_url", url: "https://github.com/acme/switchyard" });
  await assert.rejects(queue.authorize({ hostActionId: intent.id, adapterVersion: "extension-1" }), /TargetSnapshot changed/i);
  await assert.rejects(queue.settle({ hostActionId: intent.id, succeeded: true, summary: "forged success", adapterVersion: "extension-1" }), /authorization/i);

  current = true;
  const authorization = await queue.authorize({ hostActionId: intent.id, adapterVersion: "extension-1" });
  await assert.rejects(queue.authorize({ hostActionId: intent.id, adapterVersion: "extension-1" }), /already authorized|reconciliation/i);
  await assert.rejects(queue.settle({ hostActionId: intent.id, succeeded: true, summary: "wrong token", adapterVersion: "extension-1", authorizationToken: `host-action-auth:${"0".repeat(64)}` }), /authorization/i);
  const settled = await queue.settle({ hostActionId: intent.id, succeeded: true, summary: "exact effect completed", adapterVersion: "extension-1", authorizationToken: authorization.authorizationToken });
  assert.equal(settled.status, "completed");
});

test("split debug-stop intent durably preserves separate source/effect bindings and rejects field confusion across restart", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-debug-split-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator });
  const queue = new DurableHostActionQueue(store, { now: () => new Date("2026-08-24T12:00:00.000Z") });
  const source: ManagedSession = {
    id: "provider-source", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-debug", planRevision: "plan-debug",
    plannedFiles: [], lastHeartbeat: "2026-08-24T12:00:00.000Z", adapterVersion: "provider-1", metadata: { "sxsy-b122.providerHandshake": "exact-route-v1" }
  };
  const plan = {
    hostAction: "stop_vscode_debug" as const, debugConfiguration: "Launch test", debugSessionId: "debug-1",
    debugEffectSessionId: "debug-effect", debugEffectSessionBindingDigest: "a".repeat(64), debugSourceSessionBindingDigest: "b".repeat(64),
    debugBindingId: "debug-binding-1", debugOriginOperationId: "operation-debug-origin"
  };
  const intent = await queue.enqueue({ definition: commandForAction("stop_managed_run"), operationId: "operation-debug-stop", target, session: source }, plan);
  assert.equal(intent.sessionId, source.id);
  assert.equal(intent.debugEffectSessionId, "debug-effect");
  assert.equal(intent.debugSourceSessionBindingDigest, "b".repeat(64));
  assert.equal(intent.debugEffectSessionBindingDigest, "a".repeat(64));
  assert.equal(intent.debugBindingId, "debug-binding-1");
  assert.equal(intent.debugOriginOperationId, "operation-debug-origin");

  const restarted = new DurableHostActionQueue(store, { now: () => new Date("2026-08-24T12:00:01.000Z") });
  assert.deepEqual(await restarted.listPending(), [intent], "restart recovery must retain the sealed split binding without a new bridge selection");
  await assert.rejects(
    restarted.enqueue({ definition: commandForAction("stop_managed_run"), operationId: "operation-debug-stop", target, session: source }, { ...plan, debugEffectSessionId: "substituted-effect" }),
    /different intent data/i
  );
  await assert.rejects(
    restarted.enqueue({ definition: commandForAction("github_home"), operationId: "operation-non-debug", target, session: source }, { hostAction: "open_external_url", url: "https://github.com/acme/switchyard", debugEffectSessionId: "debug-effect" }),
    /only the exact VS Code debug host actions/i
  );
  await assert.rejects(
    restarted.enqueue({ definition: commandForAction("stop_managed_run"), operationId: "operation-missing-debug-binding", target, session: source }, { ...plan, debugBindingId: undefined }),
    /requires one exact configuration.*protected source\/effect.*debug binding/i
  );
});

test("expired authorization and post-effect uncertainty remain incomplete and non-replayable", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-uncertain-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  let now = new Date("2026-08-24T12:00:00.000Z");
  const queue = new DurableHostActionQueue(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }), {
    now: () => now,
    lifetimeMs: 10_000,
    authorizationLifetimeMs: 500,
    finalAuthorizer: { async authorize() { return { allowed: true, reason: "exact target remains current" }; } }
  });
  const late = await queue.enqueue({ definition: commandForAction("github_home"), operationId: "operation-late", target }, { hostAction: "open_external_url", url: "https://github.com/acme/switchyard" });
  const lateAuthorization = await queue.authorize({ hostActionId: late.id, adapterVersion: "extension-1" });
  now = new Date("2026-08-24T12:00:00.600Z");
  const lateCompletion = await queue.settle({ hostActionId: late.id, succeeded: true, effectDisposition: "committed", summary: "host reported a late effect", adapterVersion: "extension-1", authorizationToken: lateAuthorization.authorizationToken });
  assert.equal(lateCompletion.status, "incomplete");
  assert.match(lateCompletion.summary, /authorization expired|reconciliation/i);
  assert.equal((await queue.observeOperation("operation-late", "github_home")).outcome, "unresolved");

  const uncertain = await queue.enqueue({ definition: commandForAction("open_managed_codex_terminal"), operationId: "operation-uncertain", target }, { hostAction: "create_codex_terminal" });
  const uncertainAuthorization = await queue.authorize({ hostActionId: uncertain.id, adapterVersion: "extension-1" });
  const uncertainCompletion = await queue.settle({ hostActionId: uncertain.id, succeeded: false, effectDisposition: "ambiguous", summary: "terminal exists but adoption requires reconciliation", adapterVersion: "extension-1", authorizationToken: uncertainAuthorization.authorizationToken });
  assert.equal(uncertainCompletion.status, "incomplete");
  assert.equal((await queue.observeOperation("operation-uncertain", "open_managed_codex_terminal")).outcome, "unresolved");
  await assert.rejects(queue.authorize({ hostActionId: uncertain.id, adapterVersion: "extension-1" }), /already authorized|settled|reconciliation/i);
});

test("an unknown or conflicting host acknowledgement cannot finalize an operation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-reject-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const companion = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator }),
    policyVersion: "policy-host",
    localStateDirectory: directory,
    targetResolver: { resolve: async () => undefined }
  });
  const response = await companion.endpoint.handle({
    version: companionBridgeVersion,
    id: "unknown-ack",
    method: "host-action.complete",
    payload: { hostActionId: `host-action:${"0".repeat(64)}`, succeeded: true, summary: "fabricated", adapterVersion: "test-extension-1" }
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "invalid_request");
});

test("host-owned cancellation settles only exact queued operation intents and is restart-durable", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-cancel-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator });
  const queue = new DurableHostActionQueue(store, { now: () => new Date("2026-08-24T12:00:00.000Z") });
  const adapter = new DurableHostActionAdapter(queue);
  await adapter.execute({ definition: commandForAction("focus_vscode"), operationId: "operation-cancel", target });
  await adapter.execute({ definition: commandForAction("focus_terminal"), operationId: "operation-keep", target });

  assert.equal(await queue.cancelPendingByOperation("operation-cancel", "Operator cancelled exact durable work."), 1);
  assert.equal(await queue.cancelPendingByOperation("operation-cancel", "Operator cancelled exact durable work."), 0);
  assert.deepEqual((await queue.listPending()).map((item) => item.operationId), ["operation-keep"]);

  assert.equal(await queue.cancelQueuedForRepository("C:\\unrelated", "containment"), 0);
  assert.equal(await queue.cancelQueuedForRepository(target.repositoryRoot, "containment"), 1);

  const restarted = new DurableHostActionQueue(store, { now: () => new Date("2026-08-24T12:00:01.000Z") });
  assert.deepEqual(await restarted.observeOperation("operation-cancel", "focus_vscode", target.id, target.repositoryRoot), {
    outcome: "cancelled", note: "The exact durable host action was cancelled before authenticated completion.",
    binding: { action: "focus_vscode", targetSnapshotId: target.id, repositoryRoot: target.repositoryRoot }
  });
  assert.deepEqual(await restarted.observeOperation("operation-keep", "focus_terminal", target.id, target.repositoryRoot), {
    outcome: "cancelled", note: "The exact durable host action was cancelled before authenticated completion.",
    binding: { action: "focus_terminal", targetSnapshotId: target.id, repositoryRoot: target.repositoryRoot }
  });
  assert.equal((await restarted.observeOperation("operation-cancel", "focus_vscode", "wrong-target", target.repositoryRoot)).outcome, "unresolved");
  assert.equal((await restarted.observeOperation("operation-cancel", "focus_vscode", target.id, "C:\\wrong-repository")).outcome, "unresolved");
  assert.deepEqual(await restarted.listSettled(), []);
});

test("an authorized host action remains ambiguous during cancellation and can still report its exact late effect", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-authorized-cancel-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator });
  const queue = new DurableHostActionQueue(store, {
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    finalAuthorizer: { async authorize() { return { allowed: true, reason: "exact target remains current" }; } }
  });
  const intent = await queue.enqueue(
    { definition: commandForAction("github_home"), operationId: "operation-authorized-cancel", target },
    { hostAction: "open_external_url", url: "https://github.com/acme/switchyard" }
  );
  const authorization = await queue.authorize({ hostActionId: intent.id, adapterVersion: "extension-1" });

  assert.equal(await queue.cancelPendingByOperation(intent.operationId, "Operator requested cancellation after authorization."), 0);
  assert.equal(await queue.cancelQueuedForRepository(target.repositoryRoot, "Containment requested after authorization."), 0);
  assert.equal((await queue.observeOperation(intent.operationId, intent.commandAction, target.id, target.repositoryRoot)).outcome, "unresolved");
  assert.deepEqual((await queue.listPending()).map((candidate) => candidate.id), [intent.id]);

  const late = await queue.settle({
    hostActionId: intent.id,
    succeeded: true,
    effectDisposition: "committed",
    summary: "The authorized native host effect completed before cancellation could be proven.",
    adapterVersion: "extension-1",
    authorizationToken: authorization.authorizationToken
  });
  assert.equal(late.status, "completed");
  assert.equal((await new DurableHostActionQueue(store).observeOperation(intent.operationId, intent.commandAction, target.id, target.repositoryRoot)).outcome, "committed");
});

test("an authorized plus cancelled legacy journal remains ambiguous until authenticated settlement", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-authorized-legacy-cancel-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator });
  const queue = new DurableHostActionQueue(store, {
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    finalAuthorizer: { async authorize() { return { allowed: true, reason: "exact target remains current" }; } }
  });
  const intent = await queue.enqueue(
    { definition: commandForAction("github_home"), operationId: "operation-authorized-legacy-cancel", target },
    { hostAction: "open_external_url", url: "https://github.com/acme/switchyard" }
  );
  await queue.authorize({ hostActionId: intent.id, adapterVersion: "extension-1" });
  await store.transaction(async (transaction) => {
    await transaction.append("host_action", {
      version: 1,
      event: "cancelled",
      hostActionId: intent.id,
      operationId: intent.operationId,
      reason: "legacy concurrent cancellation",
      at: "2026-08-24T12:00:00.000Z"
    });
  });

  const observed = await new DurableHostActionQueue(store).observeOperation(
    intent.operationId,
    intent.commandAction,
    target.id,
    target.repositoryRoot
  );
  assert.equal(observed.outcome, "unresolved", "authorization proves the host effect may have started, so cancellation cannot become not_started truth");
  assert.match(observed.note, /authorized|ambiguous|settlement|unresolved|may have started/i);
});

test("restart recovery sanitizes legacy host completions so UI evidence can never become a gate receipt", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-host-action-legacy-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator });
  const queue = new DurableHostActionQueue(store, { now: () => new Date("2026-08-24T12:00:00.000Z") });
  const intent = await queue.enqueue({ definition: commandForAction("open_claude"), operationId: "operation-legacy", target }, { hostAction: "open_external_url", url: "https://claude.ai/new" });
  await store.transaction(async (transaction) => {
    await transaction.append("host_action", {
      version: 1,
      event: "settled",
      record: {
        hostActionId: intent.id, operationId: intent.operationId, action: intent.commandAction,
        targetSnapshotId: intent.targetSnapshotId, status: "completed", summary: "legacy completion",
        completedAt: "2026-08-24T12:00:00.000Z", evidenceDigest: "a".repeat(64), toolVersions: { ui: "legacy" }
      }
    });
  });
  const [recovered] = await queue.listSettled();
  assert.ok(recovered);
  assert.equal("evidenceDigest" in recovered, false);
  assert.equal("toolVersions" in recovered, false);
  assert.deepEqual(await queue.observeOperation(intent.operationId, intent.commandAction), {
    outcome: "committed", note: "The authenticated host completion is durable for the exact operation.",
    binding: { action: intent.commandAction, targetSnapshotId: intent.targetSnapshotId, repositoryRoot: intent.workspaceRoot }
  });
});
