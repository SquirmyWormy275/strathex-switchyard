import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorityGrant, ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { canonicalWorkflowArtifact, type WorkflowProviderEffectBinding } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import type { ProviderGatewayWorkflowCommand } from "../../windows-companion/src/provider-gateway.ts";
import { CodexProviderAdapterBackend, FixtureProviderRuntimePort } from "../src/backends.ts";

const targetId = "a".repeat(64);

function effect(provider: "claude" | "codex", sessionId: string, authorityId: string, adapterVersion: string, adapterId: string, moduleSha256: string): WorkflowProviderEffectBinding {
  const session: ManagedSession = { id: sessionId, provider, surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: "C:\\repo", targetSnapshotId: targetId, taskId: "task-provider-host", planRevision: "plan-1", plannedFiles: ["src/example.ts"], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion, metadata: {} };
  const authority: AuthorityGrant = { id: authorityId, repositoryRoot: "C:\\repo", sessionId, taskId: session.taskId, planRevision: session.planRevision, allowedActions: ["proof_adversarial"], prohibitedActions: [], issuedAt: "2026-08-24T00:00:00.000Z", expiresAt: "2099-08-24T00:00:00.000Z", issuedBy: "test" };
  const material = { role: "proof_backend" as const, provider, session, authority, adapterId, adapterVersion, moduleSha256, providerContextDigest: sha256(`context-${provider}`) };
  return { ...material, bindingDigest: sha256(stableJson(material)) };
}

function evidence() {
  const planMaterial = { revision: "plan-1", originSessionId: "codex-session", taskId: "task-provider-host", objective: "Verify independent backends", steps: [{ id: "step-1", summary: "Verify", ownedFiles: ["src/example.ts"], dependencies: [], status: "approved" as const }], decisions: [] as string[] };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const material = { instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context" as const, summary: "Instructions" }], plan, documentation: [{ id: "documentation", digest: "2".repeat(64), source: "repository" as const, summary: "Documentation" }], diff: { id: "diff", digest: "3".repeat(64), source: "target_snapshot" as const, summary: "Diff" }, files: [{ id: "file", digest: "4".repeat(64), source: "repository" as const, summary: "File" }], tests: [{ id: "test", digest: "5".repeat(64), source: "receipt" as const, summary: "Test", status: "passed" as const }] };
  return { contextDigest: sha256(stableJson(material)), ...material };
}

test("provider host stamps child results with the host-owned adapter identity and rejects profile aliases", async () => {
  const port = new FixtureProviderRuntimePort("codex", { effectfulTestOnly: true });
  const backend = new CodexProviderAdapterBackend(port);
  await backend.handshake({ sessionId: "codex-session", provider: "codex", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40) }, new AbortController().signal);
  const codex = effect("codex", "codex-session", "authority-codex", "codex-fixture-provider-host-v1", backend.dispatchIdentity.adapterId, backend.dispatchIdentity.moduleSha256);
  const claude = effect("claude", "claude-session", "authority-claude", "claude-v1", "independent-claude", sha256("independent-claude"));
  const payload = { kind: "proof" as const, evidence: evidence(), claims: ["claim"], requiredBackends: ["codex", "claude"], independentBackendRequired: true, providerEffects: [codex, claude] };
  const artifact = canonicalWorkflowArtifact({ id: "artifact-adversarial", action: "proof_adversarial", repositoryRoot: "C:\\repo", targetSnapshotId: targetId, sessionId: "codex-session", taskId: "task-provider-host", planRevision: "plan-1", authorityId: "authority-codex", payload });
  const command: ProviderGatewayWorkflowCommand = {
    kind: "workflow", routeId: "provider.proof_adversarial", operationId: "child-codex-1", externalId: "child-codex-1", action: "proof_adversarial",
    repositoryRoot: "C:\\repo", targetSnapshotId: targetId, sessionId: "codex-session", authorityId: "authority-codex", provider: "codex",
    artifact: { id: artifact.immutable.id, digest: artifact.digest, sessionId: "codex-session", operationId: "parent-adversarial", taskId: "task-provider-host", planRevision: "plan-1", authorityId: "authority-codex", payload },
    child: { role: "proof_backend", bindingDigest: codex.bindingDigest, effect: codex, parentOperationId: "parent-adversarial" }
  };
  const original = port.execute.bind(port);
  port.execute = async (request) => ({ ...(await original(request)), adapterId: "provider-spoof", moduleSha256: sha256("provider-spoof") }) as never;
  const response = await backend.execute(command, new AbortController().signal);
  assert.equal("adapterId" in response ? response.adapterId : undefined, backend.dispatchIdentity.adapterId);
  assert.equal("moduleSha256" in response ? response.moduleSha256 : undefined, backend.dispatchIdentity.moduleSha256);

  const aliased = effect("codex", "codex-session", "authority-codex", "codex-fixture-provider-host-v1", "untrusted-alias", sha256("untrusted-alias"));
  const aliasPayload = { ...payload, providerEffects: [aliased, claude] };
  const aliasArtifact = canonicalWorkflowArtifact({ id: "artifact-adversarial-alias", action: "proof_adversarial", repositoryRoot: "C:\\repo", targetSnapshotId: targetId, sessionId: "codex-session", taskId: "task-provider-host", planRevision: "plan-1", authorityId: "authority-codex", payload: aliasPayload });
  await assert.rejects(() => backend.execute({ ...command, operationId: "child-codex-alias", externalId: "child-codex-alias", artifact: { ...command.artifact, id: aliasArtifact.immutable.id, digest: aliasArtifact.digest, payload: aliasPayload }, child: { ...command.child!, bindingDigest: aliased.bindingDigest, effect: aliased } }, new AbortController().signal), /profile|binding|adapter/i);
});
