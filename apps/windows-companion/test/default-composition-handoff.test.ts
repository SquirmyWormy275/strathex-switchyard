import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { DurableMediatedExecutor } from "../../../packages/control-plane/src/runtime.ts";
import type { RuntimeDispatcherContext } from "../../../packages/control-plane/src/runtime.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { companionBridgeVersion } from "../src/bridge.ts";
import { createDefaultLocalComposition } from "../src/default-composition.ts";
import type { ProviderCommandTransport } from "../src/remote-adapters.ts";
import { CompanionService } from "../src/service.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";

const unusedContext = {
  policy: {}, sessions: {}, authorities: {}, operationCoordinator: {}
} as RuntimeDispatcherContext;

test("default composition reserves handoff_immediate for the exact provider route and has no host-action fallback", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-handoff-composition-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const providerTransport: ProviderCommandTransport = {
    async request() { throw new Error("The route-selection test must not contact a provider."); }
  };
  const withProvider = createDefaultLocalComposition(
    unusedContext,
    new ProtectedJsonStore({ filePath: join(directory, "provider.jsonl") }),
    directory,
    { credentialProtector: new FakeUserSecretProtector(), providerTransport }
  );
  const withoutProvider = createDefaultLocalComposition(
    unusedContext,
    new ProtectedJsonStore({ filePath: join(directory, "unavailable.jsonl") }),
    directory,
    { credentialProtector: new FakeUserSecretProtector() }
  );

  assert.ok(withProvider.dependencies.adapters);
  assert.ok(withoutProvider.dependencies.adapters);
  assert.equal(withProvider.dependencies.adapters.get("handoff_immediate")?.id, "configured-provider-v1");
  assert.equal(withoutProvider.dependencies.adapters.get("handoff_immediate"), undefined);
  assert.equal(withProvider.dependencies.adapters.get("pipeline_failure_trace")?.id, "pipeline-failure-presentation-v1");
  assert.equal(withoutProvider.dependencies.adapters.get("pipeline_failure_trace")?.id, "pipeline-failure-presentation-v1", "no-route Pipeline Alt must be backed by protected local evidence rather than a host-action placeholder");
  assert.equal((await withoutProvider.components.hostActions.listPending()).length, 0);
  const providerEffect = await withProvider.dependencies.automation!.execute({
    action: "compound_capture",
    operationId: "provider-must-not-own-effects",
    target: { repositoryRoot: directory } as never,
    permit: { expiresAt: "2099-01-01T00:00:00.000Z" } as never
  });
  assert.equal(providerEffect.status, "unavailable");
  assert.match(providerEffect.summary, /no local provider automation adapter is installed/i);
});

test("installed GitHub and Pipeline read paths all fail before provider or host effects when the exact target guard churns", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-default-read-guard-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const now = "2026-08-26T12:00:00.000Z";
  const material = {
    repositoryRoot: directory,
    canonicalRemote: "https://github.com/SquirmyWormy275/strathex-switchyard.git",
    branch: "feat/read-guard",
    upstream: "origin/feat/read-guard",
    head: "1".repeat(40),
    indexTree: "2".repeat(40),
    trackedManifest: "3".repeat(64),
    untrackedManifest: "4".repeat(64),
    submodules: {},
    policyVersion: "installed-read-guard-test",
    environmentFingerprint: "5".repeat(64),
    completeness: "complete" as const,
    reasons: [] as readonly string[]
  };
  const target: TargetSnapshot = { id: targetSnapshotDigest(material), ...material, capturedAt: now };
  const policy = {
    version: 1 as const,
    proxy: "direct" as const,
    routes: [
      { id: "github.graphql", method: "POST", url: "https://api.github.com/graphql", redirects: "deny" as const },
      { id: "github.repository", method: "HEAD", url: "https://github.com/SquirmyWormy275/strathex-switchyard", redirects: "deny" as const },
      { id: "git.receive-pack.advertise", method: "GET", url: "https://github.com/SquirmyWormy275/strathex-switchyard.git/info/refs?service=git-receive-pack", redirects: "deny" as const },
      { id: "git.receive-pack", method: "POST", url: "https://github.com/SquirmyWormy275/strathex-switchyard.git/git-receive-pack", redirects: "deny" as const }
    ]
  };
  const composition = createDefaultLocalComposition(
    unusedContext,
    new ProtectedJsonStore({ filePath: join(directory, "read-guard.jsonl"), clock: () => now }),
    directory,
    {
      credentialProtector: new FakeUserSecretProtector(),
      networkPolicyRegistry: { async resolve(repositoryRoot?: string) {
        assert.equal(repositoryRoot, directory);
        return policy;
      } } as never
    }
  );
  const session = {
    id: "read-guard-session", provider: "codex" as const, surface: "vscode_terminal" as const,
    capabilities: ["registered", "observable", "controllable", "mediated"] as const, status: "running" as const,
    workspaceRoot: directory, targetSnapshotId: target.id, taskId: "task-read-guard", planRevision: "plan-read-guard",
    plannedFiles: [] as readonly string[], lastHeartbeat: now, adapterVersion: "installed-provider-v1", metadata: {}
  };
  let guardChecks = 0;
  for (const action of ["github_home", "github_pr", "github_issues", "github_actions", "pipeline_status", "pipeline_failure_trace"] as const) {
    const adapter = composition.dependencies.adapters?.get(action);
    assert.ok(adapter, `installed composition must register ${action}`);
    const result = await adapter!.execute({
      definition: commandForAction(action),
      operationId: `operation-${action}`,
      target,
      session,
      effectGuard: { async assertCurrent() { guardChecks += 1; return { allowed: false, reason: `TargetSnapshot churned before ${action}.` }; } }
    });
    assert.equal(result.status, "blocked", `${action} must stop at its exact target barrier`);
    assert.match(result.summary, /TargetSnapshot churned/);
  }
  assert.equal(guardChecks, 6);
  assert.equal((await composition.components.hostActions.listPending()).length, 0, "no host effect may be queued after target churn");
});

test("installed handler prepares a provider workflow only for the exact provider-managed runtime session", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-session-preparation-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const now = "2026-08-26T12:00:00.000Z";
  const store = new ProtectedJsonStore({ filePath: join(directory, "runtime.jsonl"), clock: () => now });
  const targetMaterial = {
    repositoryRoot: directory,
    canonicalRemote: "https://github.com/SquirmyWormy275/strathex-switchyard.git",
    branch: "feat/provider-session",
    upstream: "origin/feat/provider-session",
    head: "a".repeat(40),
    indexTree: "b".repeat(40),
    trackedManifest: "c".repeat(64),
    untrackedManifest: "d".repeat(64),
    submodules: {},
    policyVersion: "installed-provider-session-test",
    environmentFingerprint: "e".repeat(64),
    completeness: "complete" as const,
    reasons: [] as readonly string[]
  };
  const target: TargetSnapshot = { id: targetSnapshotDigest(targetMaterial), ...targetMaterial, capturedAt: now };
  const protector = new FakeUserSecretProtector();
  const providerTransport: ProviderCommandTransport = {
    async request() { throw new Error("Preparation must not contact the configured provider before an exact artifact is dispatched."); }
  };
  const runtime = new DurableMediatedExecutor({
    store,
    policyVersion: target.policyVersion,
    now: () => new Date(now),
    targetResolver: { resolve: async ({ session }) => session?.workspaceRoot === target.repositoryRoot && session.targetSnapshotId === target.id ? target : undefined },
    confirmationAttestor: { attest: async () => ({ reauthenticated: true, operator: "TEST\\InstalledUser" }) },
    dependencies: (runtimeContext) => createDefaultLocalComposition(runtimeContext, store, directory, { credentialProtector: protector, providerTransport }).dependencies
  });
  const providerSession = await runtime.sessions.register({
    id: "codex-provider-executor",
    provider: "codex",
    surface: "vscode_terminal",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running",
    workspaceRoot: target.repositoryRoot,
    targetSnapshotId: target.id,
    taskId: "task-provider-session",
    planRevision: "plan-provider-session",
    plannedFiles: ["apps/vscode-extension/src/controller.ts"],
    lastHeartbeat: now,
    adapterVersion: "installed-provider-v1",
    metadata: { "sxsy-b122.providerHandshake": "exact-route-v1", "sxsy-b122.providerHandshakeTarget": target.id }
  });
  const genericGitRoot = await runtime.sessions.register({
    ...providerSession,
    id: "synthetic-git-root",
    provider: "generic",
    surface: "vscode_window",
    capabilities: ["registered"],
    metadata: { "sxsy-b122.kind": "git-root" }
  });
  const service = new CompanionService({ executor: runtime });

  const preparedResponse = await service.handle({
    version: companionBridgeVersion,
    id: "prepare-provider-proof",
    method: "command.prepare",
    payload: { control: "PROOF", modifier: "normal", sessionId: providerSession.id, reason: "Prepare the exact provider-managed Proof workflow." }
  });
  assert.equal(preparedResponse.ok, true);
  const prepared = (preparedResponse.result as { preparation: { status: string; session?: { id: string }; authorityId?: string } }).preparation;
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.session?.id, providerSession.id);
  assert.ok(prepared.authorityId);

  const substitutedResponse = await service.handle({
    version: companionBridgeVersion,
    id: "prepare-generic-proof",
    method: "command.prepare",
    payload: { control: "PROOF", modifier: "normal", sessionId: genericGitRoot.id, reason: "Attempt a synthetic Git-root substitution." }
  });
  assert.equal(substitutedResponse.ok, true);
  const substituted = (substitutedResponse.result as { preparation: { status: string; summary: string } }).preparation;
  assert.equal(substituted.status, "blocked");
  assert.match(substituted.summary, /lacks adapter-proven capabilities: observable/i);
});
