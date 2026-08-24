import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { JsonLineCompanionBridge } from "../../vscode-extension/src/companion-bridge.ts";
import { NamedPipeJsonLineTransport } from "../../vscode-extension/src/named-pipe-transport.ts";
import { companionBridgeVersion } from "../src/bridge.ts";
import { createDurableWindowsCompanion } from "../src/bootstrap.ts";
import { AuthenticatedPipeServer, createPipeConfiguration } from "../src/authenticated-pipe.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";

async function git(root: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn("git", [...args], { cwd: root, shell: false, windowsHide: true });
    let stderr = ""; child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject); child.once("close", (code) => code === 0 ? resolveRun() : reject(new Error(stderr || `git ${args[0]} failed`)));
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
});

test("bootstrap rejects a hash-chain-only store outside the isolated test override", () => {
  assert.throws(() => createDurableWindowsCompanion({
    store: new ProtectedJsonStore({ filePath: "C:/isolated/unsafe.jsonl" }),
    policyVersion: "policy-1",
    targetResolver: { resolve: async () => target }
  }), /host-backed journal authenticator/i);
});

test("default installed composition uses canonical filesystem and allowlisted Git status, while high-consequence containment stays fail-closed", async (context) => {
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
  assert.equal((status.result as { command: { status: string; summary: string; data?: { broker?: string } } }).command.status, "completed", JSON.stringify(status.result));
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
  const registered = await bridge.registerSession({ id: "installed-extension", provider: "generic", surface: "vscode_window", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: folder, targetSnapshotId: currentTarget.value.id, taskId: "task", planRevision: "plan", plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "installed-smoke", metadata: {} });
  assert.equal(registered.ok, true);
  assert.equal((await companion.sessions.get("installed-extension"))?.targetSnapshotId, currentTarget.value.id);
  // The extension can only create a Registered record.  A reviewed local host
  // must separately attest mediation before a broker can execute anything.
  await companion.registerTrustedSession({ id: "installed-extension", provider: "generic", surface: "vscode_window", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: folder, targetSnapshotId: currentTarget.value.id, taskId: "task", planRevision: "plan", plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "installed-host-attestation", metadata: { "sxsy-b122.registration": "registered" } });
  const authority = await companion.executor.authorities.issue({ repositoryRoot: folder, sessionId: "installed-extension", taskId: "task", planRevision: "plan", allowedActions: ["shield_change_scan"], prohibitedActions: [], expiresAt: "2099-01-01T00:00:00.000Z", issuedBy: "isolated-user" });
  const safe = await bridge.dispatch({ control: "SHIELD", modifier: "normal", sessionId: "installed-extension", authorityId: authority.id });
  assert.equal(safe.ok, true);
  assert.equal(safe.ok && safe.value.status, "completed", JSON.stringify(safe));
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
