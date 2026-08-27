import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { createAutomationProposalResponse, parseAutomationProposalRequest } from "../../../packages/control-plane/src/automation-proposal-protocol.ts";
import type { AutomationOperationProposal } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { ConfiguredAutomationManifestProposalSource } from "../src/automation-proposal-source.ts";

const d = (value: string): string => value.repeat(64);
const exactContent = (value: string) => {
  const bytes = Buffer.from(value, "utf8");
  return {
    afterDigest: createHash("sha256").update(bytes).digest("hex"),
    content: { encoding: "base64" as const, byteLength: bytes.length, data: bytes.toString("base64") }
  };
};
const target: TargetSnapshot = { id: d("1"), repositoryRoot: "C:\\repo", branch: "feat/a", defaultBranch: "main", head: "2".repeat(40), indexTree: "3".repeat(40), trackedManifest: d("4"), untrackedManifest: d("5"), submodules: {}, policyVersion: "test", environmentFingerprint: d("6"), capturedAt: "2026-08-26T13:00:00.000Z", completeness: "complete", reasons: [] };
const session: ManagedSession = { id: "managed", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task", planRevision: "plan", plannedFiles: ["docs/a.md"], lastHeartbeat: "2026-08-26T13:00:00.000Z", adapterVersion: "provider-v1", metadata: {} };
const authority: AuthorityGrant = { id: "authority", repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision, allowedActions: ["compound_refresh"], prohibitedActions: [], issuedAt: "2026-08-26T13:00:00.000Z", expiresAt: "2026-08-26T13:10:00.000Z", issuedBy: "TEST\\operator" };
const proposal: AutomationOperationProposal = { kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"], mutations: [{ path: "docs/a.md", mutation: "update", beforeDigest: d("7"), ...exactContent("# Refreshed learning\n") }], commit: { planned: false } };

test("configured proposal source sends one no-effect exact observation route and parses the bound proposal", async () => {
  const calls: unknown[] = [];
  const source = new ConfiguredAutomationManifestProposalSource({
    async request(input) {
      calls.push(input);
      const request = parseAutomationProposalRequest(JSON.parse(String(input.body)), "compound_refresh");
      const response = createAutomationProposalResponse({ requestId: request.requestId, action: request.action, status: "completed", summary: "Exact preview.", proposal });
      return { outcome: "passed", routeId: input.routeId, detail: "ok", effectDisposition: "ambiguous", body: Buffer.from(JSON.stringify(response)) };
    }
  }, { idFactory: () => "proposal-request" });
  assert.deepEqual(await source.propose({ action: "compound_refresh", target, session, authority }), proposal);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { routeId: "automation.proposal.compound_refresh", repositoryRoot: target.repositoryRoot, body: JSON.stringify(JSON.parse(String((calls[0] as { body: string }).body))) });
  assert.equal("trustedDispatch" in (calls[0] as Record<string, unknown>), false);
});

test("configured proposal source rejects failed transport, cross-request results, and effect claims", async () => {
  const failed = new ConfiguredAutomationManifestProposalSource({ async request(input) { return { outcome: "unavailable", routeId: input.routeId, detail: "absent", effectDisposition: "not_started" }; } });
  await assert.rejects(() => failed.propose({ action: "compound_refresh", target, session, authority }), /unavailable/i);

  const forged = new ConfiguredAutomationManifestProposalSource({ async request(input) { return { outcome: "passed", routeId: input.routeId, detail: "ok", effectDisposition: "ambiguous", body: Buffer.from(JSON.stringify({ ...createAutomationProposalResponse({ requestId: "wrong", action: "compound_refresh", status: "completed", summary: "wrong", proposal }), effectDisposition: "committed" })) }; } }, { idFactory: () => "expected" });
  await assert.rejects(() => forged.propose({ action: "compound_refresh", target, session, authority }), /proposal response/i);
});
