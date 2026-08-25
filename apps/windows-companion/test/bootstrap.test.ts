import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, sha256, stableJson, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { JsonLineCompanionBridge } from "../../vscode-extension/src/companion-bridge.ts";
import { NamedPipeJsonLineTransport } from "../../vscode-extension/src/named-pipe-transport.ts";
import { companionBridgeVersion } from "../src/bridge.ts";
import { createDurableWindowsCompanion } from "../src/bootstrap.ts";
import { AuthenticatedPipeServer, createPipeConfiguration } from "../src/authenticated-pipe.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";
import type { RawHidTransportEvents } from "../src/raw-hid-installation.ts";
import { LocalCheckpointCapture, LocalRecoveryArtifactVerifier } from "../src/local-checkpoints.ts";
import { InstalledOperationControl } from "../src/operation-control.ts";
import { WorkflowArtifactStore } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { DeterministicProviderGatewayBackend } from "../src/provider-gateway.ts";

async function git(root: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn("git", [...args], { cwd: root, shell: false, windowsHide: true });
    let stderr = ""; child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject); child.once("close", (code) => code === 0 ? resolveRun() : reject(new Error(stderr || `git ${args[0]} failed`)));
  });
}

async function gitText(root: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolveRun, reject) => {
    const child = spawn("git", [...args], { cwd: root, shell: false, windowsHide: true });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRun(stdout.trim()) : reject(new Error(stderr || `git ${args[0]} failed`)));
  });
}

const targetMaterial = {
  repositoryRoot: "C:/safe/repo", canonicalRemote: "https://github.com/example/safe.git", branch: "feature/safe",
  head: "abc", indexTree: "tree", trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "policy-1",
  environmentFingerprint: "env", completeness: "complete" as const, reasons: [] as readonly string[]
};
const target: TargetSnapshot = {
  id: targetSnapshotDigest(targetMaterial), ...targetMaterial, capturedAt: "2026-08-23T12:00:00.000Z"
};

const isolatedAuthenticator: JournalAuthenticator = {
  provider: "isolated-test-authenticator",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

function proofPayload(sessionId: string, taskId: string, planRevision: string, backend: string) {
  const planMaterial = { revision: planRevision, originSessionId: sessionId, taskId, objective: "Verify the exact workflow.", steps: [{ id: "step-1", summary: "Verify", ownedFiles: ["src/safe.ts"], dependencies: [], status: "approved" as const }], decisions: [] as string[] };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const material = { instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context" as const, summary: "Instructions" }], plan, documentation: [{ id: "documentation", digest: "5".repeat(64), source: "repository" as const, summary: "Documentation" }], diff: { id: "diff", digest: "2".repeat(64), source: "target_snapshot" as const, summary: "Diff" }, files: [{ id: "file", digest: "3".repeat(64), source: "repository" as const, summary: "File" }], tests: [{ id: "receipt", digest: "4".repeat(64), source: "receipt" as const, summary: "Test", status: "passed" as const }] };
  return { kind: "proof" as const, evidence: { contextDigest: sha256(stableJson(material)), ...material }, claims: ["claim"], requiredBackends: [backend], independentBackendRequired: false };
}

test("bootstrap wires a protected registry and durable executor while a missing authority remains fail-closed", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-bootstrap-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const companion = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator: isolatedAuthenticator }), policyVersion: "policy-1",
    targetResolver: { resolve: async () => target }
  });
  await companion.registerTrustedSession({
    id: "trusted", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task", planRevision: "plan",
    plannedFiles: [], lastHeartbeat: "2026-08-23T12:00:00.000Z", adapterVersion: "trusted", metadata: {}
  });
  const response = await companion.endpoint.handle({
    version: companionBridgeVersion, id: "proof", method: "command.dispatch", payload: { control: "PROOF", modifier: "normal", sessionId: "trusted" }
  });
  assert.equal(response.ok, true);
  assert.equal((response.result as { command: { status: string } }).command.status, "blocked");
  assert.equal((await companion.endpoint.listSessions()).length, 1);
  assert.ok(companion.checkpointCapture instanceof LocalCheckpointCapture);
  assert.ok(companion.checkpointVerifier instanceof LocalRecoveryArtifactVerifier);
  assert.ok(companion.operationControl instanceof InstalledOperationControl);
  const councilIngress = await companion.endpoint.handle({
    version: companionBridgeVersion,
    id: "council-resource-ingress",
    method: "council.port-proxy.activate",
    payload: {
      epochId: "missing-epoch",
      sessionId: "trusted",
      targetSnapshotId: target.id,
      leaseId: "missing-port-lease",
      operationId: "missing-port-operation",
      fenceDigest: "1".repeat(64),
      resourceHostDigest: "2".repeat(64),
      expectedPort: "45123",
      backendPipePath: "\\\\.\\pipe\\sxsy-b122-council-backend-missing",
      backendProof: "3".repeat(64)
    }
  });
  assert.equal(councilIngress.ok, false);
  assert.equal(councilIngress.error?.code, "invalid_request");
  const workflowArtifacts = new WorkflowArtifactStore(companion.store, { idFactory: () => "provider-artifact" });
  await workflowArtifacts.create({
    action: "proof", repositoryRoot: target.repositoryRoot, targetSnapshotId: target.id, sessionId: "trusted",
    payload: proofPayload("trusted", "task", "plan", "provider")
  });
  await workflowArtifacts.claimForDispatch({ action: "proof", targetSnapshotId: target.id, sessionId: "trusted", operationId: "provider-operation" });
  assert.equal((await companion.operationControl.cancel({ operationId: "provider-operation", reason: "operator cancelled" })).accepted, true);
  assert.equal((await workflowArtifacts.get("provider-artifact"))?.status, "cancelling");
});

test("installed bootstrap routes an authorized workflow through the authenticated local provider gateway", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-provider-bootstrap-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const backend = new DeterministicProviderGatewayBackend("codex");
  const companion = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator: isolatedAuthenticator }),
    policyVersion: "policy-1",
    targetResolver: { resolve: async () => target },
    providerGatewayBackends: [backend]
  });
  const session = await companion.registerTrustedSession({
    id: "gateway-session", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task", planRevision: "plan",
    plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "gateway-test", metadata: {
      "sxsy-b122.providerHandshake": "exact-route-v1",
      "sxsy-b122.providerHandshakeTarget": target.id
    }
  });
  await companion.workflowArtifacts.create({
    id: "gateway-proof-artifact", action: "proof", repositoryRoot: target.repositoryRoot, targetSnapshotId: target.id, sessionId: session.id,
    taskId: "task", planRevision: "plan", payload: proofPayload("gateway-session", "task", "plan", "local")
  });
  const authority = await companion.executor.authorities.issue({
    repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: "task", planRevision: "plan", allowedActions: ["proof"], prohibitedActions: [],
    expiresAt: "2099-01-01T00:00:00.000Z", issuedBy: "isolated-user"
  });
  const response = await companion.endpoint.handle({
    version: companionBridgeVersion, id: "gateway-proof", method: "command.dispatch",
    payload: { control: "PROOF", modifier: "normal", sessionId: session.id, authorityId: authority.id }
  });
  assert.equal(response.ok, true);
  assert.equal((response.result as { command: { status: string } }).command.status, "completed", JSON.stringify(response));
  assert.equal(backend.commandCalls, 1);
  assert.ok(companion.providerGateway);
});

test("packaged restart finalizes a durable authenticated host effect without replaying it", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-host-restart-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const filePath = join(folder, "protected.jsonl");
  const firstStore = new ProtectedJsonStore({ filePath, authenticator: isolatedAuthenticator });
  const first = createDurableWindowsCompanion({
    store: firstStore,
    policyVersion: "policy-1",
    localStateDirectory: folder,
    targetResolver: { resolve: async () => undefined }
  });
  await first.endpoint.ready();
  const dispatched = await first.endpoint.handle({
    version: companionBridgeVersion,
    id: "crash-after-host-effect",
    method: "command.dispatch",
    payload: { control: "VSCODE", modifier: "normal" }
  });
  assert.equal(dispatched.ok, true);
  const command = (dispatched.result as { command: { operationId: string; data: { hostActionId: string } } }).command;
  const authorization = await first.hostActions.authorize({ hostActionId: command.data.hostActionId, adapterVersion: "installed-test-1" });
  await first.hostActions.settle({
    hostActionId: command.data.hostActionId,
    succeeded: true,
    summary: "The installed VS Code host completed the exact durable action before the companion crashed.",
    adapterVersion: "installed-test-1",
    authorizationToken: authorization.authorizationToken
  });
  assert.equal((await first.executor.operations.get(command.operationId))?.state, "executing");

  const restartedStore = new ProtectedJsonStore({ filePath, authenticator: isolatedAuthenticator });
  const restarted = createDurableWindowsCompanion({
    store: restartedStore,
    policyVersion: "policy-1",
    localStateDirectory: folder,
    targetResolver: { resolve: async () => undefined }
  });
  await restarted.endpoint.ready();
  assert.equal((await restarted.executor.operations.get(command.operationId))?.state, "recorded");
  assert.equal((await restarted.hostActions.listPending()).length, 0);
  assert.equal((await restarted.hostActions.listSettled()).length, 1);
  assert.equal((await restartedStore.readEntries()).filter((entry) => entry.kind === "host_action" && (entry.payload as { event?: string }).event === "queued").length, 1);
});

test("packaged restart reconciles an exact crash-after-local-commit child by read-only HEAD and tree observation", async (context) => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "sxsy-b122-git-restart-")));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  await git(folder, ["init"]);
  await git(folder, ["config", "user.email", "isolated@example.test"]);
  await git(folder, ["config", "user.name", "Isolated Test"]);
  await writeFile(join(folder, "README.md"), "baseline\n", "utf8");
  await git(folder, ["add", "README.md"]);
  await git(folder, ["commit", "-m", "baseline"]);
  const beforeHead = await gitText(folder, ["rev-parse", "HEAD"]);
  await writeFile(join(folder, "README.md"), "reviewed change\n", "utf8");
  await git(folder, ["add", "README.md"]);
  const expectedTree = await gitText(folder, ["write-tree"]);

  const filePath = join(folder, "state", "protected.jsonl");
  const first = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath, authenticator: isolatedAuthenticator }),
    policyVersion: "policy-1",
    localStateDirectory: join(folder, "state"),
    targetResolver: { resolve: async () => undefined }
  });
  await first.endpoint.ready();
  const parent = (await first.executor.operations.begin({ action: "test.composite", targetSnapshotId: "snapshot-git", idempotencyKey: "restart-parent" })).operation;
  await first.executor.operations.advance(parent.id, "executing");
  const child = (await first.executor.operations.beginChild(parent.id, {
    action: "git.local-commit",
    targetSnapshotId: "snapshot-git",
    idempotencyKey: "restart-local-child",
    details: { repositoryRoot: folder, beforeHead, expectedTree }
  })).operation;
  await first.executor.operations.advance(child.id, "executing");
  await git(folder, ["commit", "--no-verify", "-m", "reviewed change"]);
  const postHead = await gitText(folder, ["rev-parse", "HEAD"]);

  const restarted = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath, authenticator: isolatedAuthenticator }),
    policyVersion: "policy-1",
    localStateDirectory: join(folder, "state"),
    targetResolver: { resolve: async () => undefined }
  });
  await restarted.endpoint.ready();
  assert.equal((await restarted.executor.operations.get(child.id))?.state, "recorded");
  assert.equal((await restarted.executor.operations.get(parent.id))?.state, "recorded");
  assert.equal(await gitText(folder, ["rev-parse", "HEAD"]), postHead);
  assert.equal((await gitText(folder, ["rev-list", "--count", "HEAD"])), "2");
});

test("bootstrap rejects a hash-chain-only store outside the isolated test override", () => {
  assert.throws(() => createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: "C:/isolated/unsafe.jsonl" }),
    policyVersion: "policy-1",
    targetResolver: { resolve: async () => target }
  }), /host-backed journal authenticator/i);
});

test("default installed composition refuses unpinned Shield recipes while high-consequence containment stays fail-closed", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-default-composition-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  await git(folder, ["init"]); await git(folder, ["config", "user.email", "isolated@example.test"]); await git(folder, ["config", "user.name", "Isolated Test"]);
  await writeFile(join(folder, "README.md"), "isolated\n", "utf8"); await git(folder, ["add", "README.md"]); await git(folder, ["commit", "-m", "isolated baseline"]);
  const material = { ...targetMaterial, repositoryRoot: folder, canonicalRemote: undefined, head: "local-head", indexTree: "local-tree", trackedManifest: "local-tracked", untrackedManifest: "local-untracked" };
  const localTarget: TargetSnapshot = { id: targetSnapshotDigest(material), ...material, capturedAt: new Date().toISOString() };
  const store = new ProtectedJsonStore({ filePath: join(folder, "state", "protected.jsonl"), authenticator: isolatedAuthenticator });
  const companion = createDurableWindowsCompanion({ store, policyVersion: "policy-1", localStateDirectory: join(folder, "state"), credentialProtector: new FakeUserSecretProtector(), targetResolver: { resolve: async () => localTarget } });
  const session = await companion.registerTrustedSession({ id: "mediated-local", provider: "generic", surface: "vscode_window", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: folder, targetSnapshotId: localTarget.id, taskId: "task", planRevision: "plan", plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "installed-smoke", metadata: {} });
  const safeGrant = await companion.executor.authorities.issue({ repositoryRoot: folder, sessionId: session.id, taskId: "task", planRevision: "plan", allowedActions: ["shield_change_scan"], prohibitedActions: [], expiresAt: "2099-01-01T00:00:00.000Z", issuedBy: "isolated-user" });
  const status = await companion.endpoint.handle({ version: companionBridgeVersion, id: "scan", method: "command.dispatch", payload: { control: "SHIELD", modifier: "normal", sessionId: session.id, authorityId: safeGrant.id } });
  assert.equal(status.ok, true);
  assert.equal((status.result as { command: { status: string; summary: string; data?: { broker?: string } } }).command.status, "unavailable", JSON.stringify(status.result));
  assert.match((status.result as { command: { summary: string } }).command.summary, /host-attested.*runtime pin/i);
  assert.ok(companion.localComponents);
  assert.equal(companion.localComponents?.filesystem, "canonical-allowlist");
  const epoch = companion.localComponents!.rawHid.connect("loopback-test");
  assert.equal(companion.localComponents!.rawHid.send("loopback-test", epoch, new Uint8Array([0xb1, 0x22])), true);
  const credentialScope = { repositoryRoot: folder, adapterId: "configured-network", purpose: "isolated-provider" } as const;
  await companion.localComponents!.credentials.provision({ reference: "isolated", scopes: [credentialScope] }, Buffer.from("ephemeral-test-secret", "utf8"));
  const credentialAdapter = companion.localComponents!.credentials.createAdapter("configured-network");
  const lease = await credentialAdapter.acquireLease({ reference: "isolated", repositoryRoot: folder, purpose: "isolated-provider" });
  await companion.localComponents!.containment.activate({ repositoryRoot: folder, operationId: "test-containment", reason: "verify credential lease revocation" });
  await assert.rejects(() => credentialAdapter.redeem(lease, async () => undefined), /used, expired, or revoked/i);
  const grant = await companion.executor.authorities.issue({ repositoryRoot: folder, sessionId: session.id, taskId: "task", planRevision: "plan", allowedActions: ["emergency_containment"], prohibitedActions: [], expiresAt: "2099-01-01T00:00:00.000Z", issuedBy: "isolated-user" });
  const high = await companion.endpoint.handle({ version: companionBridgeVersion, id: "contain", method: "command.dispatch", payload: { control: "SHIELD", modifier: "ctrl_shift_alt", sessionId: session.id, authorityId: grant.id } });
  assert.equal(high.ok, true);
  assert.equal((high.result as { command: { status: string } }).command.status, "blocked");
  assert.match((high.result as { command: { summary: string } }).command.summary, /high-consequence|acceptance/i);
});

test("installed composition synchronizes an authenticated extension session and fails closed through the local pipe", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-ipc-composition-"));
  const state = join(folder, "state");
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  await git(folder, ["init"]); await git(folder, ["config", "user.email", "isolated@example.test"]); await git(folder, ["config", "user.name", "Isolated Test"]);
  await writeFile(join(folder, "README.md"), "isolated\n", "utf8"); await git(folder, ["add", "README.md"]); await git(folder, ["commit", "-m", "isolated baseline"]);
  const material = { ...targetMaterial, repositoryRoot: folder, canonicalRemote: undefined, head: "local-head", indexTree: "local-tree", trackedManifest: "local-tracked", untrackedManifest: "local-untracked" };
  const currentTarget: { value: TargetSnapshot } = { value: { id: targetSnapshotDigest(material), ...material, capturedAt: new Date().toISOString() } };
  let staleReplay = false;
  let resolverCalls = 0;
  const companion = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: join(state, "protected.jsonl"), authenticator: isolatedAuthenticator }),
    policyVersion: "policy-1", localStateDirectory: state, targetResolver: { resolve: async () => {
      resolverCalls += 1;
      return staleReplay && resolverCalls % 2 === 0
        ? { ...currentTarget.value, id: targetSnapshotDigest({ ...material, head: "changed" }), head: "changed", capturedAt: new Date().toISOString() }
        : currentTarget.value;
    } }
  });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(state, protector, `bootstrap-${Date.now()}`);
  const server = new AuthenticatedPipeServer(configuration, protector, companion.endpoint);
  await server.start();
  context.after(async () => { await server.stop(); });
  const bridge = new JsonLineCompanionBridge(new NamedPipeJsonLineTransport(configuration, protector));
  const reservedAdoptionKey = "terminal:managed-reservation-1";
  await companion.registerTrustedSession({ id: "managed-reserved", provider: "generic", surface: "vscode_terminal", capabilities: ["registered"], status: "unknown", workspaceRoot: folder, targetSnapshotId: currentTarget.value.id, taskId: "task", planRevision: "plan", plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "installed-host-reservation", metadata: { "sxsy-b122.adoptionKey": reservedAdoptionKey } });
  const reservedRegistration = await bridge.registerSession({ id: "managed-reserved", provider: "generic", surface: "vscode_terminal", capabilities: ["registered"], status: "unknown", workspaceRoot: folder, targetSnapshotId: currentTarget.value.id, taskId: "task", planRevision: "plan", plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "installed-extension", metadata: {} });
  assert.equal(reservedRegistration.ok, true);
  const adopted = await bridge.adoptTerminal("managed-reserved", reservedAdoptionKey, "codex");
  assert.equal(adopted.ok, true, JSON.stringify(adopted));
  assert.equal(adopted.ok && adopted.value.provider, "codex");
  assert.deepEqual(adopted.ok && adopted.value.capabilities, ["registered"]);
  const replayedAdoption = await bridge.adoptTerminal("managed-reserved", reservedAdoptionKey, "claude");
  assert.equal(replayedAdoption.ok, false);
  const secondRegistration = await bridge.registerSession({ id: "managed-reserved-2", provider: "generic", surface: "vscode_terminal", capabilities: ["registered"], status: "unknown", workspaceRoot: folder, targetSnapshotId: currentTarget.value.id, taskId: "task", planRevision: "plan", plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "installed-extension", metadata: {} });
  assert.equal(secondRegistration.ok, true);
  const crossSessionAdoption = await bridge.adoptTerminal("managed-reserved-2", reservedAdoptionKey, "codex");
  assert.equal(crossSessionAdoption.ok, false);
  const registered = await bridge.registerSession({ id: "installed-extension", provider: "generic", surface: "vscode_window", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: folder, targetSnapshotId: currentTarget.value.id, taskId: "task", planRevision: "plan", plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "installed-smoke", metadata: {} });
  assert.equal(registered.ok, true);
  assert.equal((await companion.sessions.get("installed-extension"))?.targetSnapshotId, currentTarget.value.id);
  // The extension can only create a Registered record.  A reviewed local host
  // must separately attest mediation before a broker can execute anything.
  await companion.registerTrustedSession({ id: "installed-extension", provider: "generic", surface: "vscode_window", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: folder, targetSnapshotId: currentTarget.value.id, taskId: "task", planRevision: "plan", plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "installed-host-attestation", metadata: { "sxsy-b122.registration": "registered" } });
  const authority = await companion.executor.authorities.issue({ repositoryRoot: folder, sessionId: "installed-extension", taskId: "task", planRevision: "plan", allowedActions: ["shield_change_scan"], prohibitedActions: [], expiresAt: "2099-01-01T00:00:00.000Z", issuedBy: "isolated-user" });
  const safe = await bridge.dispatch({ control: "SHIELD", modifier: "normal", sessionId: "installed-extension", authorityId: authority.id });
  assert.equal(safe.ok, true, JSON.stringify(safe));
  assert.equal(safe.ok && safe.value.status, "unavailable", JSON.stringify(safe));
  assert.match(safe.ok ? safe.value.summary : "", /host-attested.*runtime pin/i);
  const unauthorized = await bridge.dispatch({ control: "SHIELD", modifier: "normal", sessionId: "installed-extension", authorityId: "not-issued" });
  assert.equal(unauthorized.ok, true);
  assert.equal(unauthorized.ok && unauthorized.value.status, "blocked");
  const high = await bridge.dispatch({ control: "SHIELD", modifier: "ctrl_shift_alt", sessionId: "installed-extension", authorityId: authority.id });
  assert.equal(high.ok, true);
  assert.equal(high.ok && high.value.status, "blocked");
  const invalidConfiguration = { ...configuration, sealedToken: await protector.seal(Buffer.alloc(32, 0)) };
  const invalid = new JsonLineCompanionBridge(new NamedPipeJsonLineTransport(invalidConfiguration, protector));
  const rejected = await invalid.health();
  assert.equal(rejected.ok, false);
  staleReplay = true;
  resolverCalls = 0;
  const stale = await bridge.dispatch({ control: "SHIELD", modifier: "normal", sessionId: "installed-extension", authorityId: authority.id, input: { attempt: "stale" } });
  assert.equal(stale.ok, true);
  assert.notEqual(stale.ok && stale.value.status, "completed", JSON.stringify(stale));
});

test("bootstrap owns a durable Raw-HID inbox and fixed-helper supervisor without launching while unprovisioned", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-bootstrap-raw-hid-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const helperPath = join(folder, "strathex-b122-hid-helper.exe");
  await writeFile(helperPath, "isolated native helper", "utf8");
  const events: RawHidTransportEvents[] = [];
  let starts = 0;
  let stops = 0;
  const companion = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator: isolatedAuthenticator }),
    policyVersion: "policy-1",
    targetResolver: { resolve: async () => target },
    rawHidHelperPath: helperPath,
    runtimePinPresence: { async verify() { return { verified: true, operator: "Current User", method: "windows-user-presence" }; } },
    rawHidTransportFactory: {
      create(_pin, callbacks) {
        events.push(callbacks);
        return { async start() { starts += 1; }, async stop() { stops += 1; } };
      }
    }
  });
  assert.ok(companion.hardwareSignals);
  assert.ok(companion.rawHidInstallationRegistry);
  assert.ok(companion.rawHidInstallations);
  assert.ok(companion.rawHidSupervisor);
  await companion.endpoint.ready();
  assert.equal((await companion.rawHidSupervisor!.startConfigured()).state, "unprovisioned");
  assert.equal(starts, 0);

  const installed = await companion.endpoint.handle({ version: companionBridgeVersion, id: "hid-install", method: "raw-hid.install", payload: { vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61, serialNumber: "B122-A" } });
  assert.equal(installed.ok, true, JSON.stringify(installed));
  assert.equal(starts, 1);
  assert.equal(events.length, 1);
  await companion.rawHidSupervisor!.stop();
  assert.equal(stops, 1);
});

test("installed bootstrap exposes protected acceptance and scanner administration while retaining empty fail-closed registries", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-bootstrap-administration-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const companion = createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator: isolatedAuthenticator }),
    policyVersion: "policy-1",
    localStateDirectory: folder,
    targetResolver: { resolve: async () => target },
    runtimePinPresence: { async verify() { return { verified: true, operator: "Current User", method: "windows-user-presence" }; } }
  });
  assert.ok(companion.acceptanceAdministration);
  assert.ok(companion.scannerAdministration);
  assert.ok(companion.scannerFixtures);
  const acceptance = await companion.endpoint.handle({
    version: companionBridgeVersion,
    id: "acceptance-list",
    method: "acceptance.trust.list",
    payload: {}
  });
  const scanner = await companion.endpoint.handle({
    version: companionBridgeVersion,
    id: "scanner-list",
    method: "scanner.fixture.list",
    payload: {}
  });
  assert.equal(acceptance.ok, true, JSON.stringify(acceptance));
  assert.deepEqual((acceptance.result as { trust: readonly unknown[] }).trust, []);
  assert.equal(scanner.ok, true, JSON.stringify(scanner));
  assert.deepEqual((scanner.result as { fixtures: readonly unknown[] }).fixtures, []);
});
