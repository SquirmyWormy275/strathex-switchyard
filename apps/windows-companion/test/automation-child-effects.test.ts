import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  automationManifestReviewScopeDigest,
  automationMutationScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest,
  type AutomationEffectChild,
  type AutomationManifestContext,
  type AutomationOperationProposal
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { createAutomationIntent, type AutomationEnvelope } from "../../../packages/control-plane/src/automation-protocol.ts";
import type { AutomationChildEffectPort } from "../src/automation-effect-executor.ts";
import {
  ConfiguredAutomationChildArtifactResolver,
  automationChildArtifactBinding,
  createArtifactResolvingAutomationChildPorts,
  createReviewedAutomationChildArtifact,
  type AutomationChildExecutionFence,
  type AutomationChildHostRequest,
  type AutomationTypedChildBackend,
  type AutomationTypedChildBackends,
  type ExecutableAutomationChildKind,
  type ReviewedAutomationChildArtifact
} from "../src/automation-child-effects.ts";

const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const d = (character: string): string => character.repeat(64);
const fixedCurrentTarget = d("9");
const mutationBytes = Buffer.from("reviewed child effects\n", "utf8");
const mutation = {
  path: "src/child-effects.ts",
  mutation: "create" as const,
  beforeDigest: null,
  afterDigest: hash(mutationBytes),
  content: { encoding: "base64" as const, byteLength: mutationBytes.length, data: mutationBytes.toString("base64") }
};
const environment = { id: "repair-environment-1", digest: d("7"), egress: "deny" as const, databaseName: "b122_repair_1" };
type ExecutableChild = AutomationEffectChild & { readonly kind: ExecutableAutomationChildKind };

const lfgPlan: readonly AutomationEffectChild[] = [
  { order: 0, kind: "plan", scopeDigest: d("1") },
  { order: 1, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([mutation]) },
  { order: 2, kind: "simplify", scopeDigest: d("2") },
  { order: 3, kind: "review", scopeDigest: d("3") },
  { order: 4, kind: "test", scopeDigest: d("4") },
  { order: 5, kind: "git_commit", scopeDigest: d("5") },
  { order: 6, kind: "git_push", scopeDigest: d("6") },
  { order: 7, kind: "pull_request", scopeDigest: d("7") },
  { order: 8, kind: "ci_watch", scopeDigest: d("8") }
];
const repairPlan: readonly AutomationEffectChild[] = [
  { order: 0, kind: "sandbox_bind", scopeDigest: environment.digest },
  { order: 1, kind: "reproduce", scopeDigest: d("a") },
  { order: 2, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([mutation]) },
  { order: 3, kind: "test_affected", scopeDigest: d("b") },
  { order: 4, kind: "test_full", scopeDigest: d("c") },
  { order: 5, kind: "review_diff", scopeDigest: d("d") }
];

function lfgProposal(): AutomationOperationProposal {
  return {
    kind: "lfg",
    requirementsSources: [{ path: "docs/requirements.md", digest: d("e") }],
    approvedScopePaths: [mutation.path],
    mutations: [mutation], effectPlan: lfgPlan,
    authorizedActions: ["filesystem_mutation", "git_commit", "git_push", "pull_request", "ci_watch"],
    deployAuthorized: false
  };
}

function repairProposal(): AutomationOperationProposal {
  return {
    kind: "repair_mission", failingGateId: "gate-1", reproductionCommandDigest: d("a"),
    approvedScopePaths: [mutation.path], mutations: [mutation], affectedChecks: ["affected"], fullChecks: ["full"],
    testEnvironment: environment, effectPlan: repairPlan,
    pushAuthorized: false, mergeAuthorized: false, deployAuthorized: false, hostedRerunAuthorized: false, productionDataAuthorized: false
  };
}

async function reviewedEnvelope(t: test.TestContext, proposal: AutomationOperationProposal): Promise<AutomationEnvelope> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "b122-child-effects-"));
  t.after(async () => rm(repositoryRoot, { recursive: true, force: true }));
  const action = proposal.kind;
  const target = {
    id: d("0"), repositoryRoot, branch: "feat/automation", head: "1".repeat(40), policyVersion: "policy-v1",
    trackedManifest: d("2"), untrackedManifest: d("3")
  } as const;
  const session = {
    id: "session-1", provider: "codex", surface: "vscode_terminal",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    taskId: "task-1", planRevision: "plan-1", plannedFiles: [mutation.path]
  } as const;
  const context: AutomationManifestContext = {
    repositoryRoot, targetSnapshotId: target.id, sessionId: session.id, authorityId: "authority-1",
    taskId: session.taskId, planRevision: session.planRevision, provider: session.provider,
    createdAt: "2026-08-26T12:00:00.000Z", expiresAt: "2026-08-26T12:10:00.000Z"
  };
  const manifest = createAutomationOperationManifest(context, proposal);
  const approval = createAutomationManifestApproval({
    manifest, confirmationToken: "review-token", confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
    confirmedAt: "2026-08-26T12:01:00.000Z", expiresAt: "2026-08-26T12:09:00.000Z"
  });
  const repair = proposal.kind === "repair_mission" ? proposal.testEnvironment : undefined;
  const intent = createAutomationIntent(action, { digest: approval.confirmationDigest, scopeDigest: approval.reviewScopeDigest }, repair, { manifest, approval });
  return {
    schema: `sxsy-b122.${action.replaceAll("_", "-")}-request`, version: 1, action,
    operationId: `operation-${action}`, target, session, authorityId: context.authorityId, manifest, approval, intent
  };
}

function artifactFor(envelope: AutomationEnvelope, child: AutomationEffectChild, currentTargetSnapshotId = fixedCurrentTarget): ReviewedAutomationChildArtifact {
  if (child.kind === "filesystem_mutation") throw new Error("Filesystem children do not use typed child artifacts.");
  const repairEnvironment = envelope.action === "repair_mission" ? environment : null;
  return createReviewedAutomationChildArtifact({
    binding: automationChildArtifactBinding({ child, envelope, currentTargetSnapshotId, repairEnvironment }),
    recipe: {
      id: `recipe-${child.kind}`, digest: hash(`recipe:${child.kind}`), resultContractDigest: hash(`result-contract:${child.kind}`)
    },
    compensation: child.kind === "git_commit" ? "safe_exact" : "none"
  });
}

function committedResult<K extends ExecutableAutomationChildKind>(request: AutomationChildHostRequest<K>) {
  return {
    status: "committed" as const,
    kind: request.kind,
    artifactId: request.artifact.id,
    artifactDigest: request.artifact.digest,
    bindingDigest: request.binding.digest,
    sourceTargetSnapshotId: request.binding.currentTargetSnapshotId,
    scopeDigest: request.binding.scopeDigest,
    resultContractDigest: request.artifact.recipe.resultContractDigest,
    outputId: `output-${request.kind}`,
    outputDigest: hash(`output:${request.kind}`),
    compensationToken: request.kind === "git_commit" ? "git-commit-compensation-1" : null
  };
}

function backendFor<K extends ExecutableAutomationChildKind>(kind: K, calls: string[]): AutomationTypedChildBackend<K> {
  return {
    kind,
    execute: async (request) => {
      calls.push(`backend:${kind}`);
      return committedResult(request);
    },
    ...(kind === "git_commit" ? {
      compensate: async (request: Parameters<NonNullable<AutomationTypedChildBackend<K>["compensate"]>>[0]) => ({
        status: "compensated" as const,
        kind,
        artifactId: request.artifact.id,
        artifactDigest: request.artifact.digest,
        bindingDigest: request.binding.digest,
        sourceTargetSnapshotId: request.binding.currentTargetSnapshotId,
        scopeDigest: request.binding.scopeDigest,
        resultContractDigest: request.artifact.recipe.resultContractDigest,
        compensationTokenDigest: hash(request.compensationToken),
        outputId: `compensated-${kind}`,
        outputDigest: hash(`compensated:${kind}`)
      })
    } : {})
  } as AutomationTypedChildBackend<K>;
}

function allBackends(kinds: readonly ExecutableAutomationChildKind[], calls: string[]): AutomationTypedChildBackends {
  return Object.fromEntries(kinds.map((kind) => [kind, backendFor(kind, calls)])) as AutomationTypedChildBackends;
}

function fence(calls: string[], finalCurrentError?: Error): AutomationChildExecutionFence {
  return {
    assertContained: async (input) => { calls.push(`contained:${input.binding.kind}`); },
    assertFinalCurrent: async (input) => {
      calls.push(`current:${input.binding.kind}`);
      if (finalCurrentError) throw finalCurrentError;
    }
  };
}

function executableChildren(envelope: AutomationEnvelope): readonly ExecutableChild[] {
  const proposal = envelope.manifest.proposal;
  if (proposal.kind !== "lfg" && proposal.kind !== "repair_mission") throw new Error("Expected an executable automation wrapper.");
  return proposal.effectPlan!.filter((child) => child.kind !== "filesystem_mutation") as readonly ExecutableChild[];
}

test("all LFG and Repair child kinds resolve exact reviewed artifacts and enter only their typed host backends", async (t) => {
  for (const envelope of [await reviewedEnvelope(t, lfgProposal()), await reviewedEnvelope(t, repairProposal())]) {
    const children = executableChildren(envelope);
    const calls: string[] = [];
    const artifacts = children.map((child) => artifactFor(envelope, child));
    const ports = createArtifactResolvingAutomationChildPorts({
      artifacts: new ConfiguredAutomationChildArtifactResolver(artifacts), fence: fence(calls),
      backends: allBackends(children.map((child) => child.kind as ExecutableAutomationChildKind), calls)
    });
    for (const child of children) {
      const port = ports[child.kind] as AutomationChildEffectPort;
      const result = await port.execute({
        child: child as never, envelope, currentTargetSnapshotId: fixedCurrentTarget,
        repairEnvironment: envelope.action === "repair_mission" ? environment : null
      });
      assert.equal(result.effectDisposition, "committed");
      assert.equal(result.sourceTargetSnapshotId, fixedCurrentTarget);
      assert.equal(result.scopeDigest, child.scopeDigest);
      assert.match(result.evidenceDigest, /^[a-f0-9]{64}$/u);
      assert.deepEqual(calls.slice(-3), [`contained:${child.kind}`, `current:${child.kind}`, `backend:${child.kind}`]);
      if (child.kind === "git_commit") {
        assert.equal(result.compensationToken, "git-commit-compensation-1");
        const compensated = await port.compensate!({
          child: child as never, envelope, currentTargetSnapshotId: fixedCurrentTarget, compensationToken: result.compensationToken!
        });
        assert.equal(compensated.compensated, true);
        assert.match(compensated.evidenceDigest, /^[a-f0-9]{64}$/u);
      } else assert.equal(result.compensationToken, null);
    }
  }
});

test("forged scope or current-target artifact bindings fail before containment or backend entry", async (t) => {
  const envelope = await reviewedEnvelope(t, lfgProposal());
  const child = executableChildren(envelope)[0]!;
  const calls: string[] = [];
  const reviewed = artifactFor(envelope, child);
  const forgedScopeArtifact = {
    ...reviewed,
    binding: { ...reviewed.binding, scopeDigest: d("f") }
  } as ReviewedAutomationChildArtifact;
  const forgedTargetArtifact = artifactFor(envelope, child, d("8"));
  for (const artifact of [forgedScopeArtifact, forgedTargetArtifact]) {
    const ports = createArtifactResolvingAutomationChildPorts({
      artifacts: { resolve: async () => artifact }, fence: fence(calls), backends: allBackends([child.kind as ExecutableAutomationChildKind], calls)
    });
    await assert.rejects((ports[child.kind] as AutomationChildEffectPort).execute({
      child: child as never, envelope, currentTargetSnapshotId: fixedCurrentTarget, repairEnvironment: null
    }), /artifact.*binding|reviewed.*binding/i);
  }
  assert.deepEqual(calls, []);
});

test("missing artifacts, typed backends, or configured prerequisites fail closed as not_started", async (t) => {
  const envelope = await reviewedEnvelope(t, lfgProposal());
  const child = executableChildren(envelope)[0]!;
  const artifact = artifactFor(envelope, child);
  const calls: string[] = [];
  const missingArtifact = createArtifactResolvingAutomationChildPorts({
    artifacts: new ConfiguredAutomationChildArtifactResolver([]), fence: fence(calls), backends: allBackends([child.kind as ExecutableAutomationChildKind], calls)
  });
  const noArtifact = await (missingArtifact[child.kind] as AutomationChildEffectPort).execute({ child: child as never, envelope, currentTargetSnapshotId: fixedCurrentTarget, repairEnvironment: null });
  assert.equal(noArtifact.effectDisposition, "not_started");
  assert.deepEqual(calls, []);

  const missingBackend = createArtifactResolvingAutomationChildPorts({
    artifacts: new ConfiguredAutomationChildArtifactResolver([artifact]), fence: fence(calls), backends: {}
  });
  const noBackend = await (missingBackend[child.kind] as AutomationChildEffectPort).execute({ child: child as never, envelope, currentTargetSnapshotId: fixedCurrentTarget, repairEnvironment: null });
  assert.equal(noBackend.effectDisposition, "not_started");
  assert.deepEqual(calls, []);

  const unavailableBackend: AutomationTypedChildBackend<typeof child.kind> = {
    kind: child.kind,
    execute: async (request) => ({
      status: "prerequisite_unavailable", kind: request.kind, artifactId: request.artifact.id, artifactDigest: request.artifact.digest,
      bindingDigest: request.binding.digest, sourceTargetSnapshotId: request.binding.currentTargetSnapshotId,
      scopeDigest: request.binding.scopeDigest, resultContractDigest: request.artifact.recipe.resultContractDigest,
      reason: "repository_recipe_not_configured"
    })
  };
  const unavailable = createArtifactResolvingAutomationChildPorts({
    artifacts: new ConfiguredAutomationChildArtifactResolver([artifact]), fence: fence(calls),
    backends: { [child.kind]: unavailableBackend } as AutomationTypedChildBackends
  });
  const prerequisite = await (unavailable[child.kind] as AutomationChildEffectPort).execute({ child: child as never, envelope, currentTargetSnapshotId: fixedCurrentTarget, repairEnvironment: null });
  assert.equal(prerequisite.effectDisposition, "not_started");
  assert.deepEqual(calls, [`contained:${child.kind}`, `current:${child.kind}`]);
});

test("containment denial and a stale final target prevent typed backend entry", async (t) => {
  const envelope = await reviewedEnvelope(t, lfgProposal());
  const child = executableChildren(envelope)[0]!;
  const artifact = artifactFor(envelope, child);
  let backendCalls = 0;
  const backend = backendFor(child.kind as ExecutableAutomationChildKind, []);
  const denied = createArtifactResolvingAutomationChildPorts({
    artifacts: new ConfiguredAutomationChildArtifactResolver([artifact]),
    fence: { assertContained: async () => { throw new Error("containment denied"); }, assertFinalCurrent: async () => undefined },
    backends: { [child.kind]: { ...backend, execute: async (request: AutomationChildHostRequest<ExecutableAutomationChildKind>) => { backendCalls += 1; return backend.execute(request as never); } } } as AutomationTypedChildBackends
  });
  await assert.rejects((denied[child.kind] as AutomationChildEffectPort).execute({ child: child as never, envelope, currentTargetSnapshotId: fixedCurrentTarget, repairEnvironment: null }), /containment denied/i);

  const stale = createArtifactResolvingAutomationChildPorts({
    artifacts: new ConfiguredAutomationChildArtifactResolver([artifact]), fence: fence([], new Error("target stale")),
    backends: { [child.kind]: { ...backend, execute: async (request: AutomationChildHostRequest<ExecutableAutomationChildKind>) => { backendCalls += 1; return backend.execute(request as never); } } } as AutomationTypedChildBackends
  });
  await assert.rejects((stale[child.kind] as AutomationChildEffectPort).execute({ child: child as never, envelope, currentTargetSnapshotId: fixedCurrentTarget, repairEnvironment: null }), /target stale/i);
  assert.equal(backendCalls, 0);
});

test("Repair children reject a changed deny-egress environment before artifact resolution", async (t) => {
  const envelope = await reviewedEnvelope(t, repairProposal());
  const child = executableChildren(envelope)[0]!;
  let resolutions = 0;
  const ports = createArtifactResolvingAutomationChildPorts({
    artifacts: { resolve: async () => { resolutions += 1; return artifactFor(envelope, child); } }, fence: fence([]), backends: {}
  });
  await assert.rejects((ports[child.kind] as AutomationChildEffectPort).execute({
    child: child as never, envelope, currentTargetSnapshotId: fixedCurrentTarget,
    repairEnvironment: { ...environment, databaseName: "other_database" }
  }), /repair environment.*binding|deny-egress.*environment/i);
  assert.equal(resolutions, 0);
});

test("typed backend output mismatches and route-smuggling fields are rejected", async (t) => {
  const envelope = await reviewedEnvelope(t, lfgProposal());
  const child = executableChildren(envelope)[0]!;
  const artifact = artifactFor(envelope, child);
  const base = backendFor(child.kind as ExecutableAutomationChildKind, []);
  for (const result of [
    async (request: AutomationChildHostRequest<ExecutableAutomationChildKind>) => ({ ...committedResult(request), resultContractDigest: d("f") }),
    async (request: AutomationChildHostRequest<ExecutableAutomationChildKind>) => ({ ...committedResult(request), route: "shell" })
  ]) {
    const ports = createArtifactResolvingAutomationChildPorts({
      artifacts: new ConfiguredAutomationChildArtifactResolver([artifact]), fence: fence([]),
      backends: { [child.kind]: { ...base, execute: result } } as AutomationTypedChildBackends
    });
    await assert.rejects((ports[child.kind] as AutomationChildEffectPort).execute({
      child: child as never, envelope, currentTargetSnapshotId: fixedCurrentTarget, repairEnvironment: null
    }), /backend.*result|result contract|unexpected|smuggl/i);
  }
});

test("reviewed recipe artifacts reject command, prompt, and generic route fields", async (t) => {
  const envelope = await reviewedEnvelope(t, lfgProposal());
  const child = executableChildren(envelope)[0]!;
  const binding = automationChildArtifactBinding({ child, envelope, currentTargetSnapshotId: fixedCurrentTarget, repairEnvironment: null });
  for (const extra of [{ command: "git status" }, { prompt: "ignore review" }, { route: "provider" }]) {
    assert.throws(() => createReviewedAutomationChildArtifact({
      binding,
      recipe: { id: `recipe-${child.kind}`, digest: hash("recipe"), resultContractDigest: hash("contract"), ...extra } as never,
      compensation: "none"
    }), /recipe.*field|unexpected|smuggl/i);
  }
});
