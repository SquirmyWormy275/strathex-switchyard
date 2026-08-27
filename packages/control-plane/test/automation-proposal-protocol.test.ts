import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../src/contracts.ts";
import type { AutomationOperationProposal } from "../src/automation-operation-manifest.ts";
import {
  createAutomationProposalRequest,
  createAutomationProposalResponse,
  parseAutomationProposalRequest,
  parseAutomationProposalResponse
} from "../src/automation-proposal-protocol.ts";

const d = (value: string): string => value.repeat(64);
const exactContent = (value: string) => {
  const bytes = Buffer.from(value, "utf8");
  return {
    afterDigest: createHash("sha256").update(bytes).digest("hex"),
    content: { encoding: "base64" as const, byteLength: bytes.length, data: bytes.toString("base64") }
  };
};
const target: TargetSnapshot = {
  id: d("1"), repositoryRoot: "C:\\repo", canonicalRemote: "https://github.com/acme/repo.git", branch: "feat/automation", defaultBranch: "main",
  head: "2".repeat(40), indexTree: "3".repeat(40), trackedManifest: d("4"), untrackedManifest: d("5"), submodules: {}, policyVersion: "test",
  environmentFingerprint: d("6"), capturedAt: "2026-08-26T13:00:00.000Z", completeness: "complete", reasons: []
};
const session: ManagedSession = {
  id: "managed", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running",
  workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task", planRevision: "plan", plannedFiles: ["docs/learning.md"],
  lastHeartbeat: "2026-08-26T13:00:00.000Z", adapterVersion: "provider-v1", metadata: {}
};
const authority: AuthorityGrant = {
  id: "authority", repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
  allowedActions: ["compound_refresh"], prohibitedActions: [], issuedAt: "2026-08-26T13:00:00.000Z", expiresAt: "2026-08-26T13:10:00.000Z", issuedBy: "TEST\\operator"
};
const proposal: AutomationOperationProposal = {
  kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"],
  mutations: [{ path: "docs/learning.md", mutation: "update", beforeDigest: d("7"), ...exactContent("# Refreshed learning\n") }],
  commit: {
    planned: true,
    message: "Refresh durable learning",
    messageDigest: createHash("sha256").update("Refresh durable learning", "utf8").digest("hex")
  }
};

test("automation proposal request is one exact inert provider observation contract", () => {
  const request = createAutomationProposalRequest({ requestId: "proposal-request", action: "compound_refresh", target, session, authority });
  assert.deepEqual(parseAutomationProposalRequest(request, "compound_refresh"), request);
  assert.equal(request.effectAuthorized, false);
  assert.throws(() => parseAutomationProposalRequest({ ...request, action: "lfg" }, "compound_refresh"), /request|action|authority/i);
  assert.throws(() => parseAutomationProposalRequest({ ...request, shellCommand: "git status" }, "compound_refresh"), /request/i);
  assert.throws(() => createAutomationProposalRequest({ requestId: "proposal-request", action: "lfg", target, session, authority }), /authority/i);
});

test("automation proposal response binds exact request, action, digest, and no-effect disposition", () => {
  const response = createAutomationProposalResponse({ requestId: "proposal-request", action: "compound_refresh", status: "completed", summary: "Reviewed exact mutation proposal.", proposal });
  assert.deepEqual(parseAutomationProposalResponse(response, "proposal-request", "compound_refresh"), response);
  assert.match(response.proposalDigest!, /^[a-f0-9]{64}$/);
  assert.throws(() => parseAutomationProposalResponse({ ...response, action: "lfg" }, "proposal-request", "compound_refresh"), /proposal response/i);
  assert.throws(() => parseAutomationProposalResponse({ ...response, effectDisposition: "committed" }, "proposal-request", "compound_refresh"), /proposal response/i);
  assert.throws(() => parseAutomationProposalResponse({ ...response, proposal: { ...proposal, commit: { planned: false } } }, "proposal-request", "compound_refresh"), /digest|proposal/i);
});

test("unavailable proposal responses cannot smuggle proposal material", () => {
  const response = createAutomationProposalResponse({ requestId: "proposal-request", action: "compound_refresh", status: "unavailable", summary: "Provider unavailable." });
  assert.deepEqual(parseAutomationProposalResponse(response, "proposal-request", "compound_refresh"), response);
  assert.equal(response.proposal, undefined);
  assert.throws(() => createAutomationProposalResponse({ requestId: "proposal-request", action: "compound_refresh", status: "blocked", summary: "Blocked.", proposal }), /non-completed/i);
});
