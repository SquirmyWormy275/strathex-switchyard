import assert from "node:assert/strict";
import test from "node:test";

import {
  forwardedHostAction,
  forwardedWorkflowResult,
  JsonLineCompanionBridge,
  type ExtensionManagedSession,
  type JsonLineTransport
} from "../src/companion-bridge.ts";

const session: ExtensionManagedSession = {
  id: "vscode-window-1",
  provider: "generic",
  surface: "vscode_window",
  capabilities: ["registered"],
  status: "unknown",
  workspaceRoot: "C:/isolated/repo",
  plannedFiles: [],
  lastHeartbeat: "2026-08-23T00:00:00.000Z",
  adapterVersion: "test",
  metadata: {}
};

test("the VS Code JSON-lines client sends bounded companion methods and preserves matching responses", async () => {
  const seen: Array<{ id: string; method: string; payload: unknown }> = [];
  const transport: JsonLineTransport = {
    async request(line) {
      const request = JSON.parse(line) as { version: number; id: string; method: string; payload: unknown };
      seen.push({ id: request.id, method: request.method, payload: request.payload });
      if (request.method === "command.dispatch") {
        return JSON.stringify({ version: 1, id: request.id, ok: true, result: { command: { status: "unavailable", summary: "No mediated execution broker is attached." } } });
      }
      if (request.method === "command.prepare") {
        return JSON.stringify({ version: 1, id: request.id, ok: true, result: { preparation: { status: "prepared", summary: "Exact scope prepared.", authorityId: "authority" } } });
      }
      if (request.method === "git.review.submit") {
        return JSON.stringify({ version: 1, id: request.id, ok: true, result: { review: { status: "approved", summary: "Exact Git mutation reviewed." } } });
      }
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: (request.payload as { session: ExtensionManagedSession }).session });
    }
  };
  const bridge = new JsonLineCompanionBridge(transport, "isolated-vscode");

  const registered = await bridge.registerSession(session);
  assert.equal(registered.ok, true);
  if (registered.ok) assert.equal(registered.value.id, session.id);

  const prepared = await bridge.prepareCommand({ control: "RUN", modifier: "normal", sessionId: session.id, reason: "operator requested run" });
  assert.equal(prepared.ok, true);
  if (prepared.ok) assert.equal(prepared.value.authorityId, "authority");

  const reviewed = await bridge.reviewGitMutation({ action: "local_commit", sessionId: session.id, mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe" } });
  assert.equal(reviewed.ok, true);
  if (reviewed.ok) assert.equal(reviewed.value.status, "approved");

  const dispatched = await bridge.dispatch({ control: "RUN", modifier: "normal", sessionId: session.id });
  assert.equal(dispatched.ok, true);
  if (dispatched.ok) assert.equal(dispatched.value.status, "unavailable");
  assert.deepEqual(seen.map((entry) => entry.method), ["session.register", "command.prepare", "git.review.submit", "command.dispatch"]);
  assert.equal(seen.every((entry) => entry.id.startsWith("isolated-vscode-")), true);
});

test("malformed or mismatched local-companion replies fail closed in the extension bridge", async () => {
  const malformed = new JsonLineCompanionBridge({ request: async () => "not json" });
  const malformedResult = await malformed.dispatch({ control: "RUN", modifier: "normal" });
  assert.equal(malformedResult.ok, false);
  if (!malformedResult.ok) assert.equal(malformedResult.code, "invalid_response");

  const mismatched = new JsonLineCompanionBridge({
    request: async () => JSON.stringify({ version: 1, id: "other-request", ok: true, result: {} })
  });
  const mismatchedResult = await mismatched.dispatch({ control: "RUN", modifier: "normal" });
  assert.equal(mismatchedResult.ok, false);
  if (!mismatchedResult.ok) assert.equal(mismatchedResult.code, "invalid_response");
});

test("managed-session listing accepts only the strict protected-registry shape", async () => {
  let malformed = false;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string };
      assert.equal(request.method, "session.list");
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: malformed ? [{ ...session, capabilities: ["registered", "fabricated"] }] : [session] });
    }
  });
  const accepted = await bridge.listSessions();
  assert.equal(accepted.ok, true);
  malformed = true;
  const rejected = await bridge.listSessions();
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "invalid_response");
});

test("non-picker URL authorization accepts only an exact URL rebound by the companion", async () => {
  const hostActionId = `host-action:${"a".repeat(64)}`;
  let malformed = false;
  const expectedUrl = "http://127.0.0.1:4317/";
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload: unknown };
      assert.equal(request.method, "host-action.authorize");
      assert.deepEqual(request.payload, { hostActionId, adapterVersion: "extension-1" });
      const authorization = malformed
        ? { hostActionId, authorizationToken: `host-action-auth:${"b".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z", url: "http://127.0.0.1:4318/" }
        : { hostActionId, authorizationToken: `host-action-auth:${"b".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z", url: expectedUrl };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: { authorization } });
    }
  });
  const accepted = await bridge.authorizeHostAction(hostActionId, "extension-1", undefined, expectedUrl);
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.value.url, expectedUrl);
  malformed = true;
  const rejected = await bridge.authorizeHostAction(hostActionId, "extension-1", undefined, expectedUrl);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "invalid_response");
});

test("GitHub picker authorization binds one exact requested candidate and companion-selected URL", async () => {
  const hostActionId = `host-action:${"c".repeat(64)}`;
  let corrupt = false;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload: unknown };
      assert.equal(request.method, "host-action.authorize");
      assert.deepEqual(request.payload, { hostActionId, adapterVersion: "extension-1", selectionId: "pull:3" });
      const authorization = corrupt
        ? { hostActionId, authorizationToken: `host-action-auth:${"d".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z", selectionId: "pull:2", url: "https://evil.invalid/" }
        : { hostActionId, authorizationToken: `host-action-auth:${"d".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z", selectionId: "pull:3", url: "https://github.com/acme/project/pull/3" };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: { authorization } });
    }
  });
  const accepted = await bridge.authorizeHostAction(hostActionId, "extension-1", "pull:3");
  assert.equal(accepted.ok, true);
  corrupt = true;
  const rejected = await bridge.authorizeHostAction(hostActionId, "extension-1", "pull:3");
  assert.equal(rejected.ok, false);
});

test("acceptance and scanner administration replies are strict and preserve host-owned identities", async () => {
  const keyId = "a".repeat(64);
  const trust = { schema: "sxsy-b122.acceptance-trust-policy", version: 1, authorityId: "lab", keyId, publicKeyPem: "PUBLIC KEY", allowedGates: [8], expiresAt: "2027-08-24T00:00:00.000Z", installedAt: "2026-08-24T00:00:00.000Z", installedBy: "reviewer", status: "active" };
  const fixture = { id: "scanner-feed", kind: "scanner", packageRoot: "C:/state/scanner-feed", manifestSha256: "b".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", installedBy: "reviewer", status: "active" };
  let corrupt = false;
  const bridge = new JsonLineCompanionBridge({ async request(line) {
    const request = JSON.parse(line) as { id: string; method: string; payload?: unknown };
    const result = request.method === "acceptance.trust.install" ? { trust: corrupt ? { ...trust, allowedGates: [0] } : trust }
      : request.method === "acceptance.trust.list" ? { trust: [trust] }
        : request.method === "scanner.fixture.install" ? { fixture }
          : request.method === "scanner.fixture.list" ? { fixtures: [fixture] }
            : { revoked: true };
    return JSON.stringify({ version: 1, id: request.id, ok: true, result });
  } }, "admin-vscode");
  const installed = await bridge.installAcceptanceTrust("C:/reviewed/trust.json");
  assert.equal(installed.ok, true);
  assert.equal((await bridge.listAcceptanceTrust()).ok, true);
  assert.equal((await bridge.installScannerFixture("C:/reviewed/scanner.json")).ok, true);
  assert.equal((await bridge.listScannerFixtures()).ok, true);
  assert.deepEqual(await bridge.revokeScannerFixture("scanner-feed", "retired"), { ok: true, value: true });
  corrupt = true;
  assert.equal((await bridge.installAcceptanceTrust("C:/reviewed/trust.json")).ok, false);
});

test("provider administration and managed-terminal host effects preserve only exact compiled identities", async () => {
  const seen: Array<{ method: string; payload?: unknown }> = [];
  const installation = {
    provider: "codex", installationId: "provider-install:codex", catalogDigest: "a".repeat(64),
    identity: {
      canonicalExecutablePath: "C:\\Program Files\\SXSY\\codex.exe", executableSha256: "b".repeat(64),
      signerSubject: "CN=Isolated Provider Test", signerThumbprint: "a".repeat(40),
      productIdentity: { productId: "openai.codex", displayName: "Codex", publisher: "OpenAI, L.L.C.", role: "managed_terminal" },
      size: 42, modifiedMs: 1, device: "3894844051", inode: "59672695062879660"
    },
    operator: "Current User", installedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:00:00.000Z", status: "active"
  } as const;
  const profile = {
    provider: "codex", profileName: "SXSY-B122 Codex", canonicalLauncherPath: "C:\\Program Files\\SXSY\\sxsy-b122-provider-desktop-helper.exe",
    launcherSha256: "c".repeat(64), launcherProtocolVersion: 1,
    canonicalExecutablePath: installation.identity.canonicalExecutablePath,
    executableSha256: installation.identity.executableSha256, signerSubject: installation.identity.signerSubject, signerThumbprint: installation.identity.signerThumbprint, executableSize: installation.identity.size,
    executableModifiedMs: installation.identity.modifiedMs, executableDevice: installation.identity.device, executableInode: installation.identity.inode,
    productIdentity: installation.identity.productIdentity,
    args: [], shell: false, installationId: installation.installationId, catalogDigest: installation.catalogDigest,
    issuedAt: "2026-08-24T00:00:00.000Z", validUntil: "2026-08-24T00:00:20.000Z", requiresFinalIdentityVerification: true
  } as const;
  let corrupt: "none" | "installation" | "wrong_provider" | "duplicates" | "profile" = "none";
  const bridge = new JsonLineCompanionBridge({ async request(line) {
    const request = JSON.parse(line) as { id: string; method: string; payload?: unknown };
    seen.push({ method: request.method, ...(request.payload !== undefined ? { payload: request.payload } : {}) });
    const returnedInstallation = corrupt === "installation"
      ? { ...installation, identity: { ...installation.identity, productIdentity: { ...installation.identity.productIdentity, productId: "substituted.product" } } }
      : corrupt === "wrong_provider"
        ? { ...installation, provider: "claude_desktop", identity: { ...installation.identity, canonicalExecutablePath: "C:\\Program Files\\SXSY\\claude.exe", productIdentity: { productId: "anthropic.claude-desktop", displayName: "Claude Desktop", publisher: "Anthropic, PBC", role: "desktop" } } }
        : installation;
    const result = request.method === "provider-desktop.install" || request.method === "provider-desktop.revoke"
      ? { installation: returnedInstallation }
      : request.method === "provider-desktop.list"
        ? { installations: corrupt === "duplicates" ? [installation, installation] : [installation] }
        : { command: { status: "running", summary: "Exact terminal pending.", data: {
            hostActionId: `host-action:${"c".repeat(64)}`, hostActionKind: "create_codex_terminal", hostActionExpiresAt: "2026-08-24T00:00:20.000Z",
            managedTerminalProfile: corrupt === "profile" ? { ...profile, profileName: "Substituted" } : profile
          } } };
    return JSON.stringify({ version: 1, id: request.id, ok: true, result });
  } }, "provider-vscode");

  assert.equal((await bridge.installProviderDesktop("codex")).ok, true);
  assert.equal((await bridge.listProviderDesktops()).ok, true);
  assert.equal((await bridge.revokeProviderDesktop("codex")).ok, true);
  assert.deepEqual(seen.slice(0, 3), [
    { method: "provider-desktop.install", payload: { provider: "codex" } },
    { method: "provider-desktop.list" },
    { method: "provider-desktop.revoke", payload: { provider: "codex" } }
  ]);

  const dispatched = await bridge.dispatch({ control: "CLAUDE", modifier: "ctrl_shift_alt" });
  assert.ok(dispatched.ok && forwardedHostAction(dispatched.value)?.managedTerminalProfile?.provider === "codex");
  corrupt = "installation";
  assert.equal((await bridge.installProviderDesktop("codex")).ok, false);
  corrupt = "wrong_provider";
  assert.equal((await bridge.installProviderDesktop("codex")).ok, false);
  corrupt = "duplicates";
  assert.equal((await bridge.listProviderDesktops()).ok, false);
  corrupt = "profile";
  const substituted = await bridge.dispatch({ control: "CLAUDE", modifier: "ctrl_shift_alt" });
  assert.ok(substituted.ok);
  if (substituted.ok) assert.equal(forwardedHostAction(substituted.value), undefined);
});

test("hardware bridge never sends a client-selected chord and carries the server dispatch receipt into completion", async () => {
  const seen: Array<{ method: string; payload: Record<string, unknown> | undefined }> = [];
  const signalId = `hardware-signal:${"a".repeat(64)}`;
  const claimToken = "claim-token-bridge";
  const dispatchReceiptId = `hardware-dispatch:${"b".repeat(64)}`;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload?: Record<string, unknown> };
      seen.push({ method: request.method, payload: request.payload });
      if (request.method === "hardware-signal.claim") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { claim: { signalId, claimToken, deviceId: "c".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 3, control: "SHIELD", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"] } } });
      if (request.method === "hardware-signal.prepare") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { preparation: { status: "prepared", summary: "prepared", authorityId: "authority" } } });
      if (request.method === "hardware-signal.dispatch") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { command: { status: "completed", summary: "handled" }, dispatchReceiptId } });
      if (request.method === "hardware-signal.complete") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { completion: { signalId, outcome: "handled" } } });
      return JSON.stringify({ version: 1, id: request.id, ok: false, error: { code: "unknown_method", message: "unexpected" } });
    }
  });
  const claim = await bridge.claimHardwareSignal({ windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"], focused: true });
  assert.equal(claim.ok, true);
  assert.ok(claim.ok && claim.value);
  if (!claim.ok || !claim.value) return;
  const prepared = await bridge.prepareHardwareSignal(claim.value, session.id, "Focused physical chord");
  assert.equal(prepared.ok, true);
  const dispatched = await bridge.dispatchHardwareSignal(claim.value, { sessionId: session.id, authorityId: "authority" });
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) return;
  await bridge.completeHardwareSignal(claim.value, { outcome: "handled", summary: "Mediated dispatch returned.", dispatchReceiptId: dispatched.value.dispatchReceiptId, dispatchSessionId: session.id, repositoryRoot: "C:/isolated/repo" });

  const dispatchPayload = seen.find((entry) => entry.method === "hardware-signal.dispatch")?.payload;
  assert.equal("control" in (dispatchPayload ?? {}), false);
  assert.equal("modifier" in (dispatchPayload ?? {}), false);
  assert.equal(seen.find((entry) => entry.method === "hardware-signal.complete")?.payload?.dispatchReceiptId, dispatchReceiptId);
});

test("Raw-HID and hardware response schemas fail closed on malformed or mismatched durable identities", async () => {
  const signalId = `hardware-signal:${"a".repeat(64)}`;
  const claimToken = "claim-token-schema";
  let responseKind: "bad-claim" | "bad-dispatch" | "bad-completion" | "bad-list" = "bad-claim";
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string };
      const result = responseKind === "bad-claim"
        ? { claim: { signalId, claimToken, deviceId: "c".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 3, control: "NOT_A_CHORD", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"] } }
        : responseKind === "bad-dispatch"
          ? { command: { status: "completed", summary: "handled" }, dispatchReceiptId: "client-forged" }
          : responseKind === "bad-completion"
            ? { completion: { signalId: `hardware-signal:${"d".repeat(64)}`, outcome: "handled" } }
            : { installations: {} };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result });
    }
  });

  const malformedClaim = await bridge.claimHardwareSignal({ windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"], focused: true });
  assert.equal(malformedClaim.ok, false);
  if (!malformedClaim.ok) assert.equal(malformedClaim.code, "invalid_response");

  const claim = { signalId, claimToken, deviceId: "c".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 3, control: "SHIELD", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"] } as const;
  responseKind = "bad-dispatch";
  const malformedDispatch = await bridge.dispatchHardwareSignal(claim, { sessionId: session.id });
  assert.equal(malformedDispatch.ok, false);
  responseKind = "bad-completion";
  const mismatchedCompletion = await bridge.completeHardwareSignal(claim, { outcome: "handled", summary: "done", dispatchReceiptId: `hardware-dispatch:${"b".repeat(64)}` });
  assert.equal(mismatchedCompletion.ok, false);
  responseKind = "bad-list";
  const malformedList = await bridge.listRawHid();
  assert.equal(malformedList.ok, false);
});

test("Handoff, typed workflow, and private voice replies are strictly validated across the installed bridge", async () => {
  const methods: string[] = [];
  const handoff = {
    id: "handoff-1", digest: "a".repeat(64), repositoryRoot: "C:/isolated/repo", targetSnapshotId: "target-1", taskId: "task-1", planRevision: "plan-1",
    plan: "Finish the exact plan.", decisions: ["Keep mediation."], documentation: ["docs/design.md"], references: ["ref-1"], constraints: ["Fail closed."], openQuestions: [], nextActions: ["Verify."],
    recipientSessionId: "recipient-1", status: "queued", executionAuthorized: false, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z"
  } as const;
  const artifact = {
    action: "handoff", repositoryRoot: handoff.repositoryRoot, targetSnapshotId: handoff.targetSnapshotId, sessionId: session.id,
    payload: { kind: "handoff", packageId: handoff.id, route: "queue", recipientSessionId: handoff.recipientSessionId }, id: "artifact-1", digest: "b".repeat(64),
    status: "prepared", executionAuthorized: false, createdAt: "2026-08-24T00:00:01.000Z", updatedAt: "2026-08-24T00:00:01.000Z"
  } as const;
  const consent = {
    id: "consent-1", repositoryRoot: handoff.repositoryRoot, targetSnapshotId: handoff.targetSnapshotId, contextPackageId: handoff.id, contextDigest: handoff.digest,
    provider: "claude", operatorPresenceId: "presence-1", transcript: "off", retentionMinutes: 0, grantedAt: "2026-08-24T00:00:02.000Z", expiresAt: "2026-08-24T00:15:02.000Z"
  } as const;
  const binding = {
    id: "binding-1", consentId: consent.id, voiceSessionId: "voice-session-1", managedSessionId: session.id, repositoryRoot: handoff.repositoryRoot,
    targetSnapshotId: handoff.targetSnapshotId, contextPackageId: handoff.id, contextDigest: handoff.digest, provider: "claude", transcript: "off", retentionMinutes: 0,
    status: "active", createdAt: "2026-08-24T00:00:03.000Z", updatedAt: "2026-08-24T00:00:03.000Z"
  } as const;
  let corrupt = false;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string };
      methods.push(request.method);
      const result = request.method === "handoff.create" ? { handoff }
        : request.method === "handoff.list" ? { handoffs: [handoff] }
          : request.method === "handoff.routing.get" ? { routing: "queue" }
            : request.method === "workflow.prepare" ? { artifact: corrupt ? { ...artifact, executionAuthorized: true } : artifact }
              : request.method === "workflow.list" ? { artifacts: [artifact] }
                : request.method === "voice.consent" ? { consent }
                  : request.method === "voice.current" ? { binding }
                    : { binding };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result });
    }
  }, "workflow-vscode");

  assert.equal((await bridge.createHandoff({ sessionId: session.id, recipientSessionId: "recipient-1", plan: handoff.plan, decisions: handoff.decisions, documentation: handoff.documentation, references: handoff.references, constraints: handoff.constraints, openQuestions: handoff.openQuestions, nextActions: handoff.nextActions })).ok, true);
  assert.equal((await bridge.listHandoffs()).ok, true);
  assert.deepEqual(await bridge.handoffRouting(), { ok: true, value: "queue" });
  assert.equal((await bridge.prepareWorkflow({ action: "handoff", sessionId: session.id, authorityId: "authority-1", intent: { kind: "handoff", recipientSessionId: "recipient-1", route: "immediate" } })).ok, true);
  assert.equal((await bridge.listWorkflows()).ok, true);
  assert.equal((await bridge.grantVoiceConsent({ handoffId: handoff.id, provider: "claude", transcript: "off", retentionMinutes: 0, expiresInMinutes: 15 })).ok, true);
  assert.equal((await bridge.startVoice({ consentId: consent.id, voiceSessionId: binding.voiceSessionId, managedSessionId: session.id })).ok, true);
  assert.equal((await bridge.currentVoice()).ok, true);
  assert.equal((await bridge.bindVoice(binding.id, session.id)).ok, true);
  assert.equal(methods.includes("voice.bind"), true);

  corrupt = true;
  const forgedAuthority = await bridge.prepareWorkflow({ action: "handoff", sessionId: session.id, authorityId: "authority-1", intent: { kind: "handoff", recipientSessionId: "recipient-1", route: "immediate" } });
  assert.equal(forgedAuthority.ok, false);
  if (!forgedAuthority.ok) assert.equal(forgedAuthority.code, "invalid_response");
});

test("durable workflow results preserve only the exact bounded provider-result envelope", async () => {
  const anchor = {
    kind: "anchor",
    anchorDigest: "c".repeat(64),
    discrepancies: ["The implementation differs from the accepted plan."],
    questions: ["Should the reviewed boundary remain unchanged?"],
    resumed: false
  } as const;
  let data: Record<string, unknown> = {
    artifactId: "artifact-result-1",
    artifactDigest: "d".repeat(64),
    resultKind: "anchor",
    workflowResult: anchor,
    providerSummary: "The protected Re-anchor result is ready.",
    externalId: "provider-result-1"
  };
  const bridge = new JsonLineCompanionBridge({ async request(line) {
    const request = JSON.parse(line) as { id: string; method: string };
    assert.equal(request.method, "command.dispatch");
    return JSON.stringify({ version: 1, id: request.id, ok: true, result: { command: { status: "completed", summary: "Re-anchor completed.", data } } });
  } }, "workflow-result-vscode");

  const accepted = await bridge.dispatch({ control: "REANCHOR", modifier: "normal" });
  assert.ok(accepted.ok);
  if (!accepted.ok) return;
  assert.deepEqual(forwardedWorkflowResult(accepted.value), anchor);

  const variants = [
    { kind: "proof", verifiedClaims: [], evidenceReferences: [], backendResults: [{ backend: "local", status: "passed" }] },
    { kind: "decision", decisionPacketId: "packet-1", decisions: [{ decisionId: "decision-1", options: [
      { id: "option-1", label: "One", tradeoffs: ["Tradeoff one"], risks: ["Risk one"] },
      { id: "option-2", label: "Two", tradeoffs: ["Tradeoff two"], risks: ["Risk two"] }
    ], recommendationId: "option-1" }], userSelectionRequired: true },
    { kind: "plan", mode: "expanded", planDigest: "e".repeat(64), alternatives: Array.from({ length: 15 }, (_, index) => ({ rank: index + 1, id: `alternative-${index + 1}`, summary: `Alternative ${index + 1}`, rationale: `Rationale ${index + 1}`, risks: [] })) },
    { kind: "plan", mode: "execution_ack", planDigest: "e".repeat(64), planRevision: "revision-1", originSessionId: "origin-1", executorSessionId: "executor-1", authorityId: "authority-1", acknowledgementId: "ack-1", executionStarted: true },
    { kind: "handoff", packageId: "handoff-1", recipientSessionId: "recipient-1", acknowledged: true },
    { kind: "focus", selectedSessionId: "session-1", status: "verified_blocked", queueCycleId: "cycle-1", resultDelivered: true },
    { kind: "authority", acknowledgements: [{ recipientSessionId: "recipient-1", grantId: "grant-1", matchDigest: "f".repeat(64), acknowledged: true }] },
    { kind: "voice_binding", bindingId: "binding-1", active: true }
  ] as const;
  for (const workflowResult of variants) {
    data = { ...data, resultKind: workflowResult.kind, workflowResult };
    const variant = await bridge.dispatch({ control: "REANCHOR", modifier: "normal" });
    assert.ok(variant.ok && forwardedWorkflowResult(variant.value)?.kind === workflowResult.kind);
  }

  data = { ...data, resultKind: "proof", workflowResult: anchor };
  assert.equal((await bridge.dispatch({ control: "REANCHOR", modifier: "normal" })).ok, false);
  data = { ...data, resultKind: "anchor", workflowResult: anchor, unexpected: "not allowed" };
  assert.equal((await bridge.dispatch({ control: "REANCHOR", modifier: "normal" })).ok, false);
  data = { ...data };
  delete data.unexpected;
  data.workflowResult = { ...anchor, questions: ["x".repeat(16_385)] };
  assert.equal((await bridge.dispatch({ control: "REANCHOR", modifier: "normal" })).ok, false);
  data = { ...data, workflowResult: anchor, providerSummary: "   " };
  assert.equal((await bridge.dispatch({ control: "REANCHOR", modifier: "normal" })).ok, false);
});
