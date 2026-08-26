import assert from "node:assert/strict";
import test from "node:test";
import { companionBridgeVersion, InProcessCompanionBridge, UnavailableCompanionBridge } from "../src/bridge.ts";
import { CompanionService, type CompanionServiceOptions, type MediatedCommandExecutor } from "../src/service.ts";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";

const session = (id = "vscode-window"): ManagedSession => ({
  id,
  provider: "generic",
  surface: "vscode_window",
  capabilities: ["registered", "mediated"],
  status: "verified_finished",
  workspaceRoot: "C:\\safe\\repo",
  plannedFiles: [],
  lastHeartbeat: "2026-08-23T00:00:00.000Z",
  adapterVersion: "test",
  metadata: { source: "test" }
});

const request = (id: string, method: Parameters<CompanionService["handle"]>[0]["method"], payload?: unknown) => ({
  version: companionBridgeVersion,
  id,
  method,
  payload
} as const);

test("plain companion registration records identity but cannot self-grant mediation or verified state", async () => {
  let tick = 0;
  const service = new CompanionService({ now: () => `2026-08-23T00:00:0${++tick}.000Z`, idFactory: () => `audit-${tick}` });
  const registered = await service.handle(request("register", "session.register", { session: session() }));
  assert.equal(registered.ok, true);
  const record = registered.result as ManagedSession;
  assert.deepEqual(record.capabilities, ["registered"]);
  assert.equal(record.status, "unknown");

  const adopted = await service.handle(request("adopt", "terminal.adopt", {
    sessionId: record.id,
    adoptionKey: "terminal:one",
    provider: "claude"
  }));
  assert.equal(adopted.ok, true);
  assert.equal((adopted.result as ManagedSession).provider, "claude");
  assert.deepEqual((adopted.result as ManagedSession).capabilities, ["registered"]);

  const secondAdoption = await service.handle(request("adopt-again", "terminal.adopt", {
    sessionId: record.id,
    adoptionKey: "terminal:one",
    provider: "codex"
  }));
  assert.equal(secondAdoption.ok, false);
  assert.equal(secondAdoption.error?.code, "already_adopted");

  const falseFinished = await service.handle(request("finished", "session.status", { sessionId: record.id, status: "verified_finished" }));
  assert.equal(falseFinished.ok, false);
  assert.equal(falseFinished.error?.code, "capability_denied");
});

test("dispatches every request through canonical safety classification before any executor", async () => {
  const service = new CompanionService({ now: () => "2026-08-23T00:00:00.000Z", idFactory: () => "audit" });
  const registered = await service.handle(request("register", "session.register", { session: session("registered") }));
  const sessionId = (registered.result as ManagedSession).id;

  const mediationRequired = await service.handle(request("proof", "command.dispatch", {
    control: "PROOF", modifier: "normal", sessionId
  }));
  assert.equal((mediationRequired.result as { command: { status: string } }).command.status, "unavailable");

  const directVsCode = await service.handle(request("claude", "command.dispatch", {
    control: "CLAUDE", modifier: "alt", sessionId
  }));
  const directCommand = (directVsCode.result as { command: { status: string; data?: Record<string, unknown> } }).command;
  assert.equal(directCommand.status, "unavailable");
  assert.equal(directCommand.data?.localAction, undefined);

  const runWithoutMediator = await service.handle(request("run", "command.dispatch", {
    control: "RUN", modifier: "normal", sessionId
  }));
  const runCommand = (runWithoutMediator.result as { command: { status: string; data?: Record<string, unknown> } }).command;
  assert.equal(runCommand.status, "unavailable");
  assert.equal(runCommand.data?.localAction, undefined);

  const disabled = await service.handle(request("merge", "command.dispatch", {
    control: "COMMIT", modifier: "alt", sessionId
  }));
  assert.equal((disabled.result as { command: { status: string } }).command.status, "blocked");

  const unassigned = await service.handle(request("empty", "command.dispatch", {
    control: "PROOF", modifier: "ctrl", sessionId
  }));
  assert.equal((unassigned.result as { command: { status: string } }).command.status, "unavailable");
});

test("a verified mediator calls only its attached executor and disabled actions cannot bypass it", async () => {
  const received: string[] = [];
  const executor: MediatedCommandExecutor = {
    execute(command) {
      received.push(`${command.control}:${command.modifier}`);
      if (command.control === "PIPELINE" && command.modifier === "ctrl_shift_alt") {
        return { status: "blocked", summary: "Repair Mission gate evidence is incomplete." };
      }
      return { status: "completed", summary: "Broker accepted the canonical request.", operationId: "op-1" };
    }
  };
  const service = new CompanionService({
    now: () => "2026-08-23T00:00:00.000Z",
    idFactory: () => "audit",
    verifyCapabilities: () => ["registered", "mediated"],
    executor
  });
  const registered = await service.handle(request("register", "session.register", { session: session("mediated") }));
  const sessionId = (registered.result as ManagedSession).id;

  const proof = await service.handle(request("proof", "command.dispatch", { control: "PROOF", modifier: "normal", sessionId }));
  assert.equal((proof.result as { command: { status: string } }).command.status, "completed");
  assert.deepEqual(received, ["PROOF:normal"]);

  const routed = await service.handle(request("github", "command.dispatch", { control: "GITHUB", modifier: "normal", sessionId }));
  assert.equal((routed.result as { command: { status: string } }).command.status, "completed");

  const localHost = await service.handle(request("claude", "command.dispatch", { control: "CLAUDE", modifier: "alt", sessionId }));
  assert.equal((localHost.result as { command: { status: string } }).command.status, "completed");

  const run = await service.handle(request("run", "command.dispatch", { control: "RUN", modifier: "shift", sessionId }));
  assert.equal((run.result as { command: { status: string } }).command.status, "completed");
  assert.deepEqual(received, ["PROOF:normal", "GITHUB:normal", "CLAUDE:alt", "RUN:shift"]);

  const repair = await service.handle(request("repair", "command.dispatch", { control: "PIPELINE", modifier: "ctrl_shift_alt", sessionId }));
  assert.equal((repair.result as { command: { status: string } }).command.status, "blocked");
  assert.deepEqual(received, ["PROOF:normal", "GITHUB:normal", "CLAUDE:alt", "RUN:shift", "PIPELINE:ctrl_shift_alt"]);
});

test("cancellation and confirmation requests cross only their dedicated mediator hooks", async () => {
  const cancelled: Array<{ operationId: string; reason: string }> = [];
  const confirmationRequests: Array<Readonly<Record<string, unknown>>> = [];
  const preparationRequests: Array<Readonly<Record<string, unknown>>> = [];
  const executor = {
    execute: (): { status: "unavailable"; summary: string } => ({ status: "unavailable", summary: "not used by this bridge test" }),
    cancelOperation: async (operationId: string, reason: string) => {
      cancelled.push({ operationId, reason });
      return { status: "cancelling" as const, summary: "Durable cancellation intent accepted.", operationId };
    },
    requestConfirmation: async (input: Readonly<Record<string, unknown>>) => {
      confirmationRequests.push(input);
      return { status: "issued", summary: "Host UI attested the exact request.", token: "test-token", expiresAt: "2026-08-23T00:05:00.000Z" };
    },
    prepareCommand: async (input: Readonly<Record<string, unknown>>) => {
      preparationRequests.push(input);
      return { status: "prepared" as const, summary: "Exact command prepared.", authorityId: "authority-1", confirmationToken: "confirmation-1" };
    }
  };
  const service = new CompanionService({ executor });

  const cancelledResponse = await service.handle(request("cancel", "operation.cancel", {
    operationId: "operation-1", reason: "Operator stopped the isolated run."
  }));
  assert.equal(cancelledResponse.ok, true);
  assert.deepEqual(cancelled, [{ operationId: "operation-1", reason: "Operator stopped the isolated run." }]);

  const confirmationResponse = await service.handle(request("confirm", "confirmation.request", {
    action: "proof_adversarial", reason: "Review isolated proof evidence."
  }));
  assert.equal(confirmationResponse.ok, true);
  assert.equal((confirmationResponse.result as { confirmation: { status: string } }).confirmation.status, "issued");
  assert.equal("reauthenticated" in (confirmationRequests[0] ?? {}), false, "bridge payload cannot self-attest reauthentication");

  const preparationResponse = await service.handle(request("prepare", "command.prepare", {
    control: "COMMIT", modifier: "normal", sessionId: "session-1", reason: "Review exact local commit."
  }));
  assert.equal(preparationResponse.ok, true);
  assert.equal((preparationResponse.result as { preparation: { status: string; authorityId: string } }).preparation.authorityId, "authority-1");
  assert.deepEqual(preparationRequests, [{ action: "local_commit", sessionId: "session-1", reason: "Review exact local commit." }]);
  assert.equal("reauthenticated" in (preparationRequests[0] ?? {}), false, "bridge payload cannot self-attest current-user presence");

  const forgedConfirmation = await service.handle(request("forged-confirm", "confirmation.request", {
    action: "proof_adversarial", reason: "Review isolated proof evidence.", reauthenticated: true
  }));
  const forgedPreparation = await service.handle(request("forged-prepare", "command.prepare", {
    control: "COMMIT", modifier: "normal", sessionId: "session-1", reason: "Review exact local commit.", reauthenticated: true
  }));
  assert.equal(forgedConfirmation.ok, false);
  assert.equal(forgedPreparation.ok, false);
  assert.equal(confirmationRequests.length, 1);
  assert.equal(preparationRequests.length, 1);

  const malformed = await service.handle(request("bad-cancel", "operation.cancel", { operationId: "", reason: "" }));
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error?.code, "invalid_request");
});

test("provider-observed sessions reject extension status and heartbeat forgery while local heartbeat stays monotonic", async () => {
  const now = "2026-08-24T00:02:00.000Z";
  const service = new CompanionService({ now: () => now });
  service.installTrustedSession({
    ...session("provider-observed"),
    capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running",
    lastHeartbeat: "2026-08-24T00:01:30.000Z",
    metadata: { "sxsy-b122.providerHandshake": "exact-route-v1" }
  });
  const status = await service.handle(request("provider-status", "session.status", { sessionId: "provider-observed", status: "verified_finished" }));
  const heartbeat = await service.handle(request("provider-heartbeat", "session.heartbeat", { sessionId: "provider-observed", at: now }));
  assert.equal(status.ok, false);
  assert.equal(status.error?.code, "capability_denied");
  assert.equal(heartbeat.ok, false);
  assert.equal(heartbeat.error?.code, "capability_denied");

  service.installTrustedSession({ ...session("local"), status: "running", lastHeartbeat: "2026-08-24T00:01:30.000Z" });
  const backwards = await service.handle(request("backwards", "session.heartbeat", { sessionId: "local", at: "2026-08-24T00:01:00.000Z" }));
  const future = await service.handle(request("future", "session.heartbeat", { sessionId: "local", at: "2026-08-24T00:03:00.000Z" }));
  const current = await service.handle(request("current", "session.heartbeat", { sessionId: "local", at: "2026-08-24T00:02:10.000Z" }));
  assert.equal(backwards.ok, false);
  assert.equal(future.ok, false);
  assert.equal(current.ok, true);
});

test("provider handshake capabilities can enter only through the trusted coordinator", async () => {
  const service = new CompanionService({
    now: () => "2026-08-24T00:00:00.000Z",
    providerHandshakes: { async handshake(input) { return { ...input.session, provider: "codex", workspaceRoot: input.repositoryRoot, targetSnapshotId: "a".repeat(64), capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "provider-v1" }; } }
  });
  const registered = await service.handle(request("register-handshake", "session.register", { session: session("provider-session") }));
  assert.deepEqual((registered.result as ManagedSession).capabilities, ["registered"]);
  const elevated = await service.handle(request("provider-handshake", "provider.handshake", { sessionId: "provider-session", repositoryRoot: "C:\\safe\\repo" }));
  assert.equal(elevated.ok, true);
  assert.deepEqual((elevated.result as ManagedSession).capabilities, ["registered", "observable", "controllable", "mediated"]);
  assert.equal((elevated.result as ManagedSession).targetSnapshotId, "a".repeat(64));
});

test("Git review accepts only an exact typed mutation and cannot carry force or shell fields", async () => {
  const reviewed: unknown[] = [];
  const service = new CompanionService({ gitReviews: {
    async inspect() { return { repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), branch: "feature/review", defaultBranch: "main", detached: false, changedPaths: ["src/safe.ts"] }; },
    async review(payload) { reviewed.push(payload); return { status: "approved", summary: "Exact mutation approved." }; }
  } });
  const response = await service.handle(request("review", "git.review.submit", {
    action: "local_commit",
    sessionId: "session-1",
    mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe" }
  }));
  assert.equal(response.ok, true);
  assert.deepEqual(reviewed, [{ action: "local_commit", sessionId: "session-1", mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe" } }]);

  const force = await service.handle(request("force", "git.review.submit", {
    action: "local_commit",
    sessionId: "session-1",
    mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe", force: true }
  }));
  assert.equal(force.ok, false);
  assert.equal(force.error?.code, "invalid_request");
});

test("provider administration accepts only compiled provider identifiers and delegates path authority to the host registry", async () => {
  const calls: string[] = [];
  const installation = (provider: "claude_desktop" | "chatgpt_desktop" | "claude_code" | "codex", status: "active" | "revoked") => ({
    provider,
    installationId: `provider-install:${provider}`,
    catalogDigest: "a".repeat(64),
    identity: {
      canonicalExecutablePath: `C:\\Program Files\\SXSY\\${provider}.exe`,
      executableSha256: "b".repeat(64),
      signerSubject: "CN=Isolated Provider Test",
      signerThumbprint: "c".repeat(40),
      productIdentity: provider === "codex"
        ? { productId: "openai.codex", displayName: "Codex", publisher: "OpenAI, L.L.C.", role: "managed_terminal" as const }
        : { productId: "anthropic.claude-desktop", displayName: "Claude Desktop", publisher: "Anthropic, PBC", role: "desktop" as const },
      size: 42,
      modifiedMs: 1,
      device: "4294967295",
      inode: "59672695062879660"
    },
    operator: "Current User",
    installedAt: "2026-08-24T00:00:00.000Z",
    statusAt: "2026-08-24T00:00:00.000Z",
    status
  });
  const service = new CompanionService({ providerDesktopRegistry: {
    async install(provider) { calls.push(`install:${provider}`); return installation(provider, "active"); },
    async list() { calls.push("list"); return [installation("codex", "active")]; },
    async revoke(provider) { calls.push(`revoke:${provider}`); return installation(provider, "revoked"); }
  } });

  assert.equal((await service.handle(request("provider-install", "provider-desktop.install", { provider: "codex" }))).ok, true);
  assert.equal((await service.handle(request("provider-list", "provider-desktop.list"))).ok, true);
  assert.equal((await service.handle(request("provider-revoke", "provider-desktop.revoke", { provider: "codex" }))).ok, true);
  assert.deepEqual(calls, ["install:codex", "list", "revoke:codex"]);

  const pathInjection = await service.handle(request("provider-path", "provider-desktop.install", { provider: "codex", executablePath: "C:\\evil.exe" }));
  const unknown = await service.handle(request("provider-unknown", "provider-desktop.install", { provider: "arbitrary" }));
  const malformedList = await service.handle(request("provider-list-payload", "provider-desktop.list", { executablePath: "C:\\evil.exe" }));
  assert.equal(pathInjection.ok, false);
  assert.equal(unknown.ok, false);
  assert.equal(malformedList.ok, false);
  assert.deepEqual(calls, ["install:codex", "list", "revoke:codex"]);

  const unavailable = await new CompanionService().handle(request("provider-missing", "provider-desktop.install", { provider: "codex" }));
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error?.code, "capability_denied");
});

test("acceptance and scanner administration cross only installed user-presence-backed ports", async () => {
  const calls: string[] = [];
  const keyId = "a".repeat(64);
  const trust = { schema: "sxsy-b122.acceptance-trust-policy", version: 1, authorityId: "independent-lab", keyId, publicKeyPem: "test", allowedGates: [8] as const, expiresAt: "2027-08-24T00:00:00.000Z", installedAt: "2026-08-24T00:00:00.000Z", installedBy: "TEST\\Reviewer", status: "active" } as const;
  const evidence = { id: "evidence-8", gate: 8 as const, status: "passed" as const, targetSnapshotId: "b".repeat(64), evidenceDigest: `sha256:${"c".repeat(64)}`, policyVersion: "policy-v1", evaluatedBy: "Independent Lab", evaluatedAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-08-25T00:00:00.000Z", rationale: "Independent evidence." };
  const activation = { id: "activation-8", action: "emergency_containment" as const, targetSnapshotId: "b".repeat(64), policyVersion: "policy-v1", gateEvidenceIds: [evidence.id], activatedAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-08-24T00:10:00.000Z", activatedBy: "TEST\\Reviewer", status: "active" as const };
  const acceptanceAdministration: NonNullable<CompanionServiceOptions["acceptanceAdministration"]> = {
    async installTrustPolicy(path) { calls.push(`acceptance trust ${path}`); return trust; }, async listTrust() { return [trust]; }, async revokeTrust() { calls.push("acceptance trust revoke"); return { ...trust, status: "revoked" }; },
    async importEvidence(path) { calls.push(`acceptance evidence ${path}`); return evidence; }, async listEvidence() { return [evidence]; }, async invalidateEvidence() { calls.push("acceptance evidence invalidate"); },
    async activate() { calls.push("acceptance activate"); return activation; }, async listActivations() { return [activation]; }, async revokeActivation() { calls.push("acceptance activation revoke"); }
  };
  const scannerTrust = { schema: "sxsy-b122.scanner-fixture-trust", version: 1, authorityId: "security-lab", keyId, publicKeyPem: "test", allowedKinds: ["scanner"] as const, expiresAt: "2027-08-24T00:00:00.000Z", installedAt: "2026-08-24T00:00:00.000Z", installedBy: "TEST\\Security", status: "active" } as const;
  const scannerFixture = { id: "scanner-feed-1", kind: "scanner" as const, packageRoot: "C:\\state\\scanner-feed-1", manifestSha256: "d".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", installedBy: "TEST\\Security", status: "active" as const };
  const scannerAdministration: NonNullable<CompanionServiceOptions["scannerAdministration"]> = {
    async installTrust(path) { calls.push(`scanner trust ${path}`); return scannerTrust; }, async listTrust() { return [scannerTrust]; }, async revokeTrust() { calls.push("scanner trust revoke"); },
    async installFixture(path) { calls.push(`scanner fixture ${path}`); return scannerFixture; }, async listFixtures() { return [scannerFixture]; }, async revokeFixture() { calls.push("scanner fixture revoke"); }
  };
  const service = new CompanionService({ acceptanceAdministration, scannerAdministration });
  assert.equal((await service.handle(request("trust", "acceptance.trust.install", { sourcePath: "C:\\reviewed\\trust.json" }))).ok, true);
  assert.equal((await service.handle(request("evidence", "acceptance.evidence.import", { sourcePath: "C:\\reviewed\\evidence.json" }))).ok, true);
  assert.equal((await service.handle(request("activation", "acceptance.activation.activate", { action: "emergency_containment", targetSnapshotId: "b".repeat(64), expiresAt: "2026-08-24T00:10:00.000Z" }))).ok, true);
  assert.equal((await service.handle(request("fixture", "scanner.fixture.install", { sourcePath: "C:\\reviewed\\scanner.json" }))).ok, true);
  assert.equal((await service.handle(request("list", "scanner.fixture.list"))).ok, true);
  assert.deepEqual(calls, ["acceptance trust C:\\reviewed\\trust.json", "acceptance evidence C:\\reviewed\\evidence.json", "acceptance activate", "scanner fixture C:\\reviewed\\scanner.json"]);
  const injected = await service.handle(request("bad", "scanner.fixture.install", { sourcePath: "relative.json", operatorApproved: true }));
  assert.equal(injected.ok, false);
  assert.equal(injected.error?.code, "invalid_request");
  const unavailable = await new CompanionService().handle(request("missing", "acceptance.trust.list"));
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error?.code, "capability_denied");
});

test("runtime pin routes accept paths only and delegate digest and presence authority to the host", async () => {
  const calls: unknown[] = [];
  const pin = { canonicalRepositoryRoot: "C:\\repo", manifestPath: "C:\\repo\\runtime.json", expectedSha256: "a".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", status: "active" as const };
  const service = new CompanionService({ runtimePins: {
    async install(payload) { calls.push(["install", payload]); return pin; },
    async list() { calls.push(["list"]); return [pin]; },
    async revoke(repositoryRoot) { calls.push(["revoke", repositoryRoot]); return { ...pin, status: "revoked" as const }; }
  } });
  assert.equal((await service.handle(request("install", "runtime.pin.install", { repositoryRoot: "C:\\repo", manifestPath: "C:\\repo\\runtime.json" }))).ok, true);
  assert.equal((await service.handle(request("list", "runtime.pin.list"))).ok, true);
  assert.equal((await service.handle(request("revoke", "runtime.pin.revoke", { repositoryRoot: "C:\\repo" }))).ok, true);
  assert.deepEqual(calls, [
    ["install", { repositoryRoot: "C:\\repo", manifestPath: "C:\\repo\\runtime.json" }],
    ["list"],
    ["revoke", "C:\\repo"]
  ]);

  const fabricated = await service.handle(request("fabricated", "runtime.pin.install", {
    repositoryRoot: "C:\\repo", manifestPath: "C:\\repo\\runtime.json", expectedSha256: "b".repeat(64), approved: true
  }));
  assert.equal(fabricated.ok, false);
  assert.equal(fabricated.error?.code, "invalid_request");
});

test("Windows Sandbox installation routes cannot carry client-created digest or approval evidence", async () => {
  const calls: unknown[] = [];
  const installation = { canonicalRepositoryRoot: "C:\\repo", catalogPath: "C:\\repo\\sandbox.json", catalogSha256: "a".repeat(64), helperPath: "C:\\host\\b122-sandbox-worker.exe", helperSha256: "b".repeat(64), installedAt: "2026-08-24T00:00:00.000Z", status: "active" as const };
  const service = new CompanionService({ sandboxInstallations: {
    async install(payload) { calls.push(["install", payload]); return installation; },
    async list() { calls.push(["list"]); return [installation]; },
    async revoke(repositoryRoot) { calls.push(["revoke", repositoryRoot]); return { ...installation, status: "revoked" as const }; }
  } });
  assert.equal((await service.handle(request("install", "sandbox.install", { repositoryRoot: "C:\\repo", catalogPath: "C:\\repo\\sandbox.json" }))).ok, true);
  assert.equal((await service.handle(request("list", "sandbox.list"))).ok, true);
  assert.equal((await service.handle(request("revoke", "sandbox.revoke", { repositoryRoot: "C:\\repo" }))).ok, true);
  assert.deepEqual(calls, [["install", { repositoryRoot: "C:\\repo", catalogPath: "C:\\repo\\sandbox.json" }], ["list"], ["revoke", "C:\\repo"]]);
  const fabricated = await service.handle(request("fake", "sandbox.install", { repositoryRoot: "C:\\repo", catalogPath: "C:\\repo\\sandbox.json", helperSha256: "a".repeat(64), approved: true }));
  assert.equal(fabricated.ok, false);
});

test("in-process and unavailable bridges retain request IDs and fail closed", async () => {
  const service = new CompanionService({ now: () => "2026-08-23T00:00:00.000Z", idFactory: () => "audit" });
  const inProcess = new InProcessCompanionBridge(service);
  const pong = await inProcess.request(request("ping", "ping"));
  assert.equal(pong.ok, true);
  assert.equal(pong.id, "ping");

  const unavailable = new UnavailableCompanionBridge("offline");
  const response = await unavailable.request(request("offline", "ping"));
  assert.equal(response.ok, false);
  assert.equal(response.id, "offline");
  assert.equal(response.error?.code, "companion_unavailable");
});
