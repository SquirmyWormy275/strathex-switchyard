import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  automationManifestReviewScopeDigest,
  automationMutationScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest,
  type AutomationManifestContext,
  type AutomationOperationProposal,
  type AutomationPathMutation
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { createAutomationIntent, type AutomationAction, type AutomationEnvelope } from "../../../packages/control-plane/src/automation-protocol.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  AutomationEffectExecutionError,
  LocalAutomationEffectExecutor,
  NodeAutomationFilesystemPort,
  ProtectedStoreAutomationEffectJournal,
  type AutomationChildEffectPorts,
  type AutomationEffectJournal,
  type AutomationEffectJournalState,
  type AutomationEffectGuardPort,
  type AutomationFilesystemApplyResult,
  type AutomationFilesystemPort,
  type AutomationFilesystemRecovery,
  type AutomationHighConsequenceAuthorizationPort,
  type AutomationTargetTransitionPort
} from "../src/automation-effect-executor.ts";

const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const content = (value: string) => {
  const bytes = Buffer.from(value, "utf8");
  return { afterDigest: hash(bytes), content: { encoding: "base64" as const, byteLength: bytes.length, data: bytes.toString("base64") } };
};
const d = (character: string): string => character.repeat(64);
const fixedNow = "2026-08-26T12:02:00.000Z";

class MemoryJournal implements AutomationEffectJournal {
  readonly states = new Map<string, AutomationEffectJournalState>();
  async load(operationId: string) { return this.states.get(operationId); }
  async save(state: AutomationEffectJournalState) { this.states.set(state.operationId, state); }
}

function reviewedEnvelope(
  repositoryRoot: string,
  action: AutomationAction,
  proposal: AutomationOperationProposal,
  operationId = `operation-${action}`
): Readonly<{ envelope: AutomationEnvelope; context: AutomationManifestContext }> {
  const target = {
    id: d("c"), repositoryRoot, branch: "feat/automation", head: "d".repeat(40),
    policyVersion: "policy-v1", trackedManifest: d("e"), untrackedManifest: d("f")
  } as const;
  const session = {
    id: "session-1", provider: "codex", surface: "vscode_terminal",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    taskId: "task-1", planRevision: "plan-1", plannedFiles: ["src/example.ts"]
  } as const;
  const context: AutomationManifestContext = {
    repositoryRoot, targetSnapshotId: target.id, sessionId: session.id, authorityId: "authority-1",
    taskId: session.taskId, planRevision: session.planRevision, provider: session.provider,
    createdAt: "2026-08-26T12:00:00.000Z", expiresAt: "2026-08-26T12:10:00.000Z"
  };
  const manifest = createAutomationOperationManifest(context, proposal);
  const approval = createAutomationManifestApproval({
    manifest,
    confirmationToken: "review-token",
    confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
    confirmedAt: "2026-08-26T12:01:00.000Z",
    expiresAt: "2026-08-26T12:09:00.000Z"
  });
  const repair = proposal.kind === "repair_mission" ? proposal.testEnvironment : undefined;
  const intent = createAutomationIntent(action, { digest: approval.confirmationDigest, scopeDigest: approval.reviewScopeDigest }, repair, { manifest, approval });
  return {
    context,
    envelope: {
      schema: `sxsy-b122.${action.replaceAll("_", "-")}-request`, version: 1, action, operationId,
      target, session, authorityId: context.authorityId, manifest, approval, intent
    }
  };
}

function harness(options: Readonly<{
  filesystem?: AutomationFilesystemPort;
  childPorts?: AutomationChildEffectPorts;
  highConsequenceAuthorization?: AutomationHighConsequenceAuthorizationPort;
  guard?: AutomationEffectGuardPort;
  targetTransition?: AutomationTargetTransitionPort;
}> = {}) {
  const journal = new MemoryJournal();
  let transitions = 0;
  const targets = [d("c")];
  const targetTransition: AutomationTargetTransitionPort = options.targetTransition ?? {
    captureAndAccept: async (input) => {
      transitions += 1;
      assert.equal(input.previousTargetSnapshotId, targets.at(-1));
      let toTargetSnapshotId = input.previousTargetSnapshotId;
      if (input.expectation === "changed") {
        if (input.phase.direction === "rollback" || input.phase.direction === "compensate") {
          assert.ok(targets.length > 1);
          targets.pop();
          toTargetSnapshotId = targets.at(-1)!;
        } else {
          toTargetSnapshotId = hash(`target:${input.transitionId}`);
          targets.push(toTargetSnapshotId);
        }
      }
      return {
        accepted: true,
        transitionId: input.transitionId,
        fromTargetSnapshotId: input.previousTargetSnapshotId,
        toTargetSnapshotId,
        observedEffectEvidenceDigest: input.expectedEffectEvidenceDigest,
        hostObservationDigest: hash(`observation:${input.transitionId}`)
      };
    }
  };
  const executor = new LocalAutomationEffectExecutor({
    filesystem: options.filesystem,
    journal,
    guard: options.guard ?? { assertCurrent: async () => undefined },
    targetTransition,
    childPorts: options.childPorts,
    highConsequenceAuthorization: options.highConsequenceAuthorization,
    clock: () => fixedNow
  });
  return { executor, journal, transitionCount: () => transitions };
}

async function repository(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "b122-automation-effect-"));
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

test("companion applies exact reviewed create/update/delete bytes, emits host delta/transition evidence, and replays idempotently", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "docs", "update.md"), "old update\n");
  await writeFile(join(root, "docs", "delete.md"), "old delete\n");
  const mutations: AutomationPathMutation[] = [
    { path: "docs/create.md", mutation: "create", beforeDigest: null, ...content("created\n") },
    { path: "docs/update.md", mutation: "update", beforeDigest: hash("old update\n"), ...content("updated\n") },
    { path: "docs/delete.md", mutation: "delete", beforeDigest: hash("old delete\n"), afterDigest: null, content: null }
  ];
  const request = reviewedEnvelope(root, "compound_refresh", {
    kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"], mutations, commit: { planned: false }
  });
  const run = harness();
  const receipt = await run.executor.execute({ envelope: request.envelope, currentManifestContext: request.context });
  assert.equal(receipt.status, "committed");
  assert.equal(receipt.actualDelta?.mutations.length, 3);
  assert.ok(receipt.targetTransition?.hostObservationDigest);
  assert.equal(receipt.targetTransitionChain.length, 3);
  assert.equal(await readFile(join(root, "docs", "create.md"), "utf8"), "created\n");
  assert.equal(await readFile(join(root, "docs", "update.md"), "utf8"), "updated\n");
  await assert.rejects(readFile(join(root, "docs", "delete.md")), /ENOENT/);
  assert.deepEqual(await run.executor.execute({
    envelope: request.envelope,
    currentManifestContext: { ...request.context, targetSnapshotId: receipt.targetTransition!.toTargetSnapshotId }
  }), receipt);
  assert.equal(run.transitionCount(), 3);
});

test("authenticated protected journal survives executor restart and rejects an unauthenticated store", async (t) => {
  const root = await repository(t);
  const request = reviewedEnvelope(root, "compound_refresh", {
    kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [{ path: "docs/durable.md", mutation: "create", beforeDigest: null, ...content("durable\n") }],
    commit: { planned: false }
  }, "operation-durable-restart");
  assert.throws(() => new ProtectedStoreAutomationEffectJournal(new ProtectedJsonStore({ filePath: join(root, "unauthenticated.jsonl") })), /authenticated|protected/i);
  const authenticator = {
    provider: "test-host-key",
    async seal(value: string) { return hash(`host-key:${value}`); },
    async verify(value: string, tag: string) { return tag === hash(`host-key:${value}`); }
  };
  const filePath = join(root, "protected-effect-journal.jsonl");
  const firstJournal = new ProtectedStoreAutomationEffectJournal(new ProtectedJsonStore({ filePath, authenticator, requireAuthenticatedProtection: true }));
  let firstTransitions = 0;
  const makeExecutor = (journal: ProtectedStoreAutomationEffectJournal, transition: () => void) => new LocalAutomationEffectExecutor({
    journal,
    guard: { assertCurrent: async () => undefined },
    targetTransition: { captureAndAccept: async (input) => {
      transition();
      return {
        accepted: true,
        transitionId: input.transitionId,
        fromTargetSnapshotId: input.previousTargetSnapshotId,
        toTargetSnapshotId: d("0"),
        observedEffectEvidenceDigest: input.expectedEffectEvidenceDigest,
        hostObservationDigest: d("1")
      };
    } },
    clock: () => fixedNow
  });
  const receipt = await makeExecutor(firstJournal, () => { firstTransitions += 1; }).execute({ envelope: request.envelope, currentManifestContext: request.context });
  assert.equal(firstTransitions, 1);
  let replayTransitions = 0;
  const restartedJournal = new ProtectedStoreAutomationEffectJournal(new ProtectedJsonStore({ filePath, authenticator, requireAuthenticatedProtection: true }));
  const replay = await makeExecutor(restartedJournal, () => { replayTransitions += 1; }).execute({
    envelope: request.envelope,
    currentManifestContext: { ...request.context, targetSnapshotId: d("0") }
  });
  assert.deepEqual(replay, receipt);
  assert.equal(replayTransitions, 0);
});

test("digest mismatch fails before mutation and records compensated recovery visibility", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "docs", "current.md"), "current\n");
  const request = reviewedEnvelope(root, "compound_refresh", {
    kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [{ path: "docs/current.md", mutation: "update", beforeDigest: d("7"), ...content("changed\n") }],
    commit: { planned: false }
  });
  const run = harness();
  await assert.rejects(
    run.executor.execute({ envelope: request.envelope, currentManifestContext: request.context }),
    (error: unknown) => error instanceof AutomationEffectExecutionError && error.receipt?.status === "compensated"
  );
  assert.equal(await readFile(join(root, "docs", "current.md"), "utf8"), "current\n");
  assert.equal(run.journal.states.get(request.envelope.operationId)?.status, "compensated");
  assert.equal(run.transitionCount(), 0);
});

test("planned Compound Refresh commit is exact reviewed text and runs only through the typed Git child port after file effects", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "docs", "commit.md"), "before\n");
  const message = "Refresh durable project learning";
  const request = reviewedEnvelope(root, "compound_refresh", {
    kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [{ path: "docs/commit.md", mutation: "update", beforeDigest: hash("before\n"), ...content("after\n") }],
    commit: { planned: true, message, messageDigest: hash(message) }
  }, "operation-refresh-commit");
  await assert.rejects(harness().executor.execute({ envelope: request.envelope, currentManifestContext: request.context }), /git_commit|port|unavailable/i);
  assert.equal(await readFile(join(root, "docs", "commit.md"), "utf8"), "before\n");
  const calls: string[] = [];
  const gitCommit = {
    execute: async (input: { child: { scopeDigest: string }; envelope: AutomationEnvelope; currentTargetSnapshotId: string }) => {
      const proposal = input.envelope.manifest.proposal;
      assert.equal(proposal.kind, "compound_refresh");
      assert.equal(proposal.kind === "compound_refresh" && proposal.commit.planned ? proposal.commit.message : undefined, message);
      assert.equal(input.child.scopeDigest, hash(message));
      assert.notEqual(input.currentTargetSnapshotId, input.envelope.manifest.targetSnapshotId, "Git must bind the accepted post-filesystem target, never the stale reviewed source target");
      calls.push("git_commit");
      return { sourceTargetSnapshotId: input.currentTargetSnapshotId, scopeDigest: input.child.scopeDigest, evidenceDigest: hash("commit-evidence"), effectDisposition: "committed" as const, compensationToken: "refresh-commit-compensation" };
    },
    compensate: async (input: { currentTargetSnapshotId: string }) => ({ compensated: true as const, sourceTargetSnapshotId: input.currentTargetSnapshotId, evidenceDigest: hash("commit-compensated") })
  };
  const receipt = await harness({ childPorts: { git_commit: gitCommit } }).executor.execute({ envelope: request.envelope, currentManifestContext: request.context });
  assert.equal(receipt.status, "committed");
  assert.deepEqual(calls, ["git_commit"]);
  assert.equal(await readFile(join(root, "docs", "commit.md"), "utf8"), "after\n");
});

test("planned Compound Refresh rolls filesystem effects back when the exact local commit did not start", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "docs", "commit-unavailable.md"), "before\n");
  const message = "Refresh durable project learning";
  const request = reviewedEnvelope(root, "compound_refresh", {
    kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [{ path: "docs/commit-unavailable.md", mutation: "update", beforeDigest: hash("before\n"), ...content("after\n") }],
    commit: { planned: true, message, messageDigest: hash(message) }
  }, "operation-refresh-commit-unavailable");
  const gitCommit = {
    execute: async (input: { child: { scopeDigest: string }; currentTargetSnapshotId: string }) => ({
      sourceTargetSnapshotId: input.currentTargetSnapshotId,
      scopeDigest: input.child.scopeDigest,
      evidenceDigest: hash("commit-prerequisite-unavailable"),
      effectDisposition: "not_started" as const,
      compensationToken: null
    })
  };
  await assert.rejects(
    harness({ childPorts: { git_commit: gitCommit } }).executor.execute({ envelope: request.envelope, currentManifestContext: request.context }),
    (error: unknown) => error instanceof AutomationEffectExecutionError && error.receipt?.status === "compensated"
  );
  assert.equal(await readFile(join(root, "docs", "commit-unavailable.md"), "utf8"), "before\n");
});

test("a typed child that reports execution against the stale reviewed target is rejected as ambiguous", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "docs", "stale-child.md"), "before\n");
  const message = "Exact local commit";
  const request = reviewedEnvelope(root, "compound_refresh", {
    kind: "compound_refresh",
    audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [{ path: "docs/stale-child.md", mutation: "update", beforeDigest: hash("before\n"), ...content("after\n") }],
    commit: { planned: true, message, messageDigest: hash(message) }
  }, "operation-stale-child-target");
  const staleChild = {
    execute: async (input: { child: { scopeDigest: string }; envelope: AutomationEnvelope }) => ({
      sourceTargetSnapshotId: input.envelope.manifest.targetSnapshotId,
      scopeDigest: input.child.scopeDigest,
      evidenceDigest: hash("stale-child-evidence"),
      effectDisposition: "committed" as const,
      compensationToken: null
    })
  };
  const run = harness({ childPorts: { git_commit: staleChild } });
  await assert.rejects(run.executor.execute({ envelope: request.envelope, currentManifestContext: request.context }),
    (error: unknown) => error instanceof AutomationEffectExecutionError && error.receipt?.status === "recovery_required"
      && /scope|evidence|target|ambiguous/i.test(error.message));
  const state = run.journal.states.get(request.envelope.operationId)!;
  assert.notEqual(state.currentTargetSnapshotId, request.envelope.manifest.targetSnapshotId);
  assert.equal(state.children[0]?.effectDisposition, "ambiguous");
  assert.equal(state.targetTransitionChain.length, 1);
});

test("every sequential effect guard binds the latest accepted target and churn before a later path rolls back through a target transition", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "docs", "first.md"), "first old\n");
  await writeFile(join(root, "docs", "second.md"), "second old\n");
  const request = reviewedEnvelope(root, "compound_refresh", {
    kind: "compound_refresh",
    audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [
      { path: "docs/first.md", mutation: "update", beforeDigest: hash("first old\n"), ...content("first new\n") },
      { path: "docs/second.md", mutation: "update", beforeDigest: hash("second old\n"), ...content("second new\n") }
    ],
    commit: { planned: false }
  }, "operation-guard-chain");
  const guards: Array<{ boundary: string; target: string }> = [];
  let secondPathRejected = false;
  const run = harness({
    guard: {
      assertCurrent: async (input) => {
        guards.push({ boundary: input.boundary, target: input.expectedTargetSnapshotId });
        if (input.boundary === "before_path" && input.path === "docs/second.md" && !secondPathRejected) {
          secondPathRejected = true;
          throw new Error("injected target churn before second path");
        }
      }
    }
  });
  await assert.rejects(run.executor.execute({ envelope: request.envelope, currentManifestContext: request.context }),
    (error: unknown) => error instanceof AutomationEffectExecutionError && error.receipt?.status === "compensated");
  assert.equal(guards[0]?.boundary, "before_operation");
  assert.equal(guards[1]?.boundary, "before_path");
  assert.equal(guards[0]?.target, request.envelope.manifest.targetSnapshotId);
  assert.equal(guards[1]?.target, request.envelope.manifest.targetSnapshotId);
  assert.equal(guards[2]?.boundary, "before_path");
  assert.notEqual(guards[2]?.target, request.envelope.manifest.targetSnapshotId);
  assert.deepEqual(guards[3], { boundary: "before_rollback", target: guards[2]!.target });
  assert.equal(await readFile(join(root, "docs", "first.md"), "utf8"), "first old\n");
  assert.equal(await readFile(join(root, "docs", "second.md"), "utf8"), "second old\n");
  const state = run.journal.states.get(request.envelope.operationId)!;
  assert.equal(state.currentTargetSnapshotId, request.envelope.manifest.targetSnapshotId);
  assert.deepEqual(state.targetTransitionChain.map((entry) => `${entry.phase.kind}:${entry.phase.direction}`), ["filesystem:apply", "filesystem:rollback"]);
});

test("a lost transition response resumes idempotently after restart without replaying reviewed bytes", async (t) => {
  const root = await repository(t);
  const request = reviewedEnvelope(root, "compound_refresh", {
    kind: "compound_refresh",
    audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [{ path: "docs/resume.md", mutation: "create", beforeDigest: null, ...content("resume once\n") }],
    commit: { planned: false }
  }, "operation-transition-resume");
  const journal = new MemoryJournal();
  const filesystem = new NodeAutomationFilesystemPort();
  let applies = 0;
  const countingFilesystem: AutomationFilesystemPort = {
    canonicalizeRoot: (value) => filesystem.canonicalizeRoot(value),
    apply: async (input) => { applies += 1; return filesystem.apply(input); },
    rollback: (input) => filesystem.rollback(input)
  };
  const accepted = new Map<string, Awaited<ReturnType<AutomationTargetTransitionPort["captureAndAccept"]>>>();
  let loseFirstResponse = true;
  const transition: AutomationTargetTransitionPort = {
    captureAndAccept: async (input) => {
      const prior = accepted.get(input.transitionId);
      if (prior) return prior;
      const result = {
        accepted: true as const,
        transitionId: input.transitionId,
        fromTargetSnapshotId: input.previousTargetSnapshotId,
        toTargetSnapshotId: hash(`accepted:${input.transitionId}`),
        observedEffectEvidenceDigest: input.expectedEffectEvidenceDigest,
        hostObservationDigest: hash(`observation:${input.transitionId}`)
      };
      accepted.set(input.transitionId, result);
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error("injected lost response after durable target acceptance");
      }
      return result;
    }
  };
  const createExecutor = () => new LocalAutomationEffectExecutor({
    filesystem: countingFilesystem,
    journal,
    guard: { assertCurrent: async () => undefined },
    targetTransition: transition,
    clock: () => fixedNow
  });
  await assert.rejects(createExecutor().execute({ envelope: request.envelope, currentManifestContext: request.context }),
    (error: unknown) => error instanceof AutomationEffectExecutionError && error.receipt?.status === "recovery_required");
  assert.equal(journal.states.get(request.envelope.operationId)?.targetTransitionChain[0]?.status, "pending");
  const receipt = await createExecutor().execute({ envelope: request.envelope, currentManifestContext: request.context });
  assert.equal(receipt.status, "committed");
  assert.equal(receipt.targetTransitionChain[0]?.status, "accepted");
  assert.equal(applies, 1);
  assert.equal(await readFile(join(root, "docs", "resume.md"), "utf8"), "resume once\n");
});

test("canonical filesystem boundary rejects reparse ancestors and final-boundary substitution", async (t) => {
  const root = await repository(t);
  const outside = await mkdtemp(join(tmpdir(), "b122-automation-outside-"));
  t.after(async () => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
  const reparse = reviewedEnvelope(root, "compound_refresh", {
    kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [{ path: "link/escape.md", mutation: "create", beforeDigest: null, ...content("escape\n") }], commit: { planned: false }
  }, "operation-reparse");
  await assert.rejects(harness().executor.execute({ envelope: reparse.envelope, currentManifestContext: reparse.context }), /reparse|symlink|ancestor/i);

  await writeFile(join(root, "docs", "substitute.md"), "before\n");
  const substitute = reviewedEnvelope(root, "compound_refresh", {
    kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [{ path: "docs/substitute.md", mutation: "update", beforeDigest: hash("before\n"), ...content("after\n") }], commit: { planned: false }
  }, "operation-substitution");
  const filesystem = new NodeAutomationFilesystemPort({
    beforeFinalMutationBoundary: async (absolutePath) => writeFile(absolutePath, "attacker substitution\n")
  });
  await assert.rejects(harness({ filesystem }).executor.execute({ envelope: substitute.envelope, currentManifestContext: substitute.context }), /substitut/i);
  assert.equal(await readFile(join(root, "docs", "substitute.md"), "utf8"), "attacker substitution\n");
});

class FailSecondFilesystem implements AutomationFilesystemPort {
  private count = 0;
  constructor(private readonly delegate: AutomationFilesystemPort, private readonly failRollback: boolean) {}
  canonicalizeRoot(root: string) { return this.delegate.canonicalizeRoot(root); }
  async apply(input: Parameters<AutomationFilesystemPort["apply"]>[0]): Promise<AutomationFilesystemApplyResult> {
    this.count += 1;
    if (this.count === 2) throw new Error("injected second mutation failure");
    return this.delegate.apply(input);
  }
  async rollback(input: Readonly<{ canonicalRoot: string; operationId: string; recovery: AutomationFilesystemRecovery }>) {
    if (this.failRollback) throw new Error("injected rollback failure");
    return this.delegate.rollback(input);
  }
}

test("partial failure rolls back exact prior bytes, while failed rollback is durably visible as recovery_required", async (t) => {
  const firstRoot = await repository(t);
  await writeFile(join(firstRoot, "docs", "first.md"), "first old\n");
  await writeFile(join(firstRoot, "docs", "second.md"), "second old\n");
  const proposal = (root: string): AutomationOperationProposal => ({
    kind: "compound_refresh", audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations: [
      { path: "docs/first.md", mutation: "update", beforeDigest: hash("first old\n"), ...content("first new\n") },
      { path: "docs/second.md", mutation: "update", beforeDigest: hash("second old\n"), ...content("second new\n") }
    ], commit: { planned: false }
  });
  const firstRequest = reviewedEnvelope(firstRoot, "compound_refresh", proposal(firstRoot), "operation-partial-compensated");
  const first = harness({ filesystem: new FailSecondFilesystem(new NodeAutomationFilesystemPort(), false) });
  await assert.rejects(first.executor.execute({ envelope: firstRequest.envelope, currentManifestContext: firstRequest.context }),
    (error: unknown) => {
      assert.ok(error instanceof AutomationEffectExecutionError);
      assert.equal(error.receipt?.status, "compensated");
      assert.deepEqual(error.receipt?.rolledBackPaths, ["docs/first.md"]);
      return true;
    });
  assert.equal(await readFile(join(firstRoot, "docs", "first.md"), "utf8"), "first old\n");

  const secondRoot = await repository(t);
  await writeFile(join(secondRoot, "docs", "first.md"), "first old\n");
  await writeFile(join(secondRoot, "docs", "second.md"), "second old\n");
  const secondRequest = reviewedEnvelope(secondRoot, "compound_refresh", proposal(secondRoot), "operation-partial-recovery");
  const second = harness({ filesystem: new FailSecondFilesystem(new NodeAutomationFilesystemPort(), true) });
  await assert.rejects(second.executor.execute({ envelope: secondRequest.envelope, currentManifestContext: secondRequest.context }),
    (error: unknown) => error instanceof AutomationEffectExecutionError && error.receipt?.status === "recovery_required");
  assert.equal(second.journal.states.get(secondRequest.envelope.operationId)?.status, "recovery_required");
  assert.equal(await readFile(join(secondRoot, "docs", "first.md"), "utf8"), "first new\n");
});

test("Capture instruction-file mutation requires a separate exact consent binding", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "AGENTS.md"), "before instructions\n");
  const request = reviewedEnvelope(root, "compound_capture", {
    kind: "compound_capture", solvedProblemEvidenceDigest: d("2"), verifiedOutcomeEvidenceDigest: d("3"),
    nonTrivialRationale: "The verified outcome is reusable.",
    documents: [{ path: "docs/capture.md", mutation: "create", beforeDigest: null, ...content("capture\n") }],
    instructionFileMutation: { kind: "edit_existing", path: "AGENTS.md", beforeDigest: hash("before instructions\n"), ...content("after instructions\n") }
  });
  await assert.rejects(harness().executor.execute({ envelope: request.envelope, currentManifestContext: request.context }), /consent/i);
  const run = harness();
  const reviewedInstruction = (request.envelope.manifest.proposal as Extract<AutomationOperationProposal, { kind: "compound_capture" }>).instructionFileMutation;
  assert.equal(reviewedInstruction.kind, "edit_existing");
  await run.executor.execute({
    envelope: request.envelope,
    currentManifestContext: request.context,
    instructionFileConsent: {
      path: reviewedInstruction.kind === "edit_existing" ? reviewedInstruction.path : "agents.md",
      approvalId: request.envelope.approval.id,
      confirmationDigest: request.envelope.approval.confirmationDigest
    }
  });
  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "after instructions\n");
});

function childPorts(log: string[], observeRepair?: (value: unknown) => void): AutomationChildEffectPorts {
  const kinds = ["plan", "simplify", "review", "test", "git_commit", "git_push", "pull_request", "ci_watch", "sandbox_bind", "reproduce", "test_affected", "test_full", "review_diff"] as const;
  return Object.fromEntries(kinds.map((kind) => [kind, {
    execute: async (input: { child: { kind: string; scopeDigest: string }; repairEnvironment: unknown; currentTargetSnapshotId: string }) => {
      log.push(input.child.kind);
      if (input.child.kind === "sandbox_bind") observeRepair?.(input.repairEnvironment);
      return { sourceTargetSnapshotId: input.currentTargetSnapshotId, scopeDigest: input.child.scopeDigest, evidenceDigest: hash(`evidence:${input.child.kind}`), effectDisposition: "committed" as const, compensationToken: `compensate-${input.child.kind}` };
    },
    compensate: async (input: { currentTargetSnapshotId: string }) => ({ compensated: true as const, sourceTargetSnapshotId: input.currentTargetSnapshotId, evidenceDigest: hash(`compensated:${kind}`) })
  }])) as AutomationChildEffectPorts;
}

const acceptance: AutomationHighConsequenceAuthorizationPort = {
  authorize: async () => ({ authorized: true, acceptanceEvidenceDigest: d("9") })
};

test("LFG executes only the exact ordered typed child plan and Repair binds its reviewed deny-egress sandbox", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "src", "example.ts"), "before\n");
  const mutation = { path: "src/example.ts", mutation: "update" as const, beforeDigest: hash("before\n"), ...content("after\n") };
  const lfg: AutomationOperationProposal = {
    kind: "lfg", requirementsSources: [{ path: "docs/requirements.md", digest: d("1") }], approvedScopePaths: ["src/example.ts"],
    mutations: [mutation],
    effectPlan: [
      { order: 0, kind: "plan", scopeDigest: d("1") },
      { order: 1, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([mutation]) },
      { order: 2, kind: "simplify", scopeDigest: d("2") }, { order: 3, kind: "review", scopeDigest: d("3") },
      { order: 4, kind: "test", scopeDigest: d("4") }, { order: 5, kind: "git_commit", scopeDigest: d("5") },
      { order: 6, kind: "git_push", scopeDigest: d("6") }, { order: 7, kind: "pull_request", scopeDigest: d("7") },
      { order: 8, kind: "ci_watch", scopeDigest: d("8") }
    ],
    authorizedActions: ["filesystem_mutation", "git_commit", "git_push", "pull_request", "ci_watch"], deployAuthorized: false
  };
  const lfgRequest = reviewedEnvelope(root, "lfg", lfg, "operation-lfg");
  await assert.rejects(harness({ childPorts: childPorts([]) }).executor.execute({ envelope: lfgRequest.envelope, currentManifestContext: lfgRequest.context }), /gate|acceptance|disabled/i);
  const log: string[] = [];
  await harness({ childPorts: childPorts(log), highConsequenceAuthorization: acceptance }).executor.execute({ envelope: lfgRequest.envelope, currentManifestContext: lfgRequest.context });
  assert.deepEqual(log, ["plan", "simplify", "review", "test", "git_commit", "git_push", "pull_request", "ci_watch"]);

  await writeFile(join(root, "src", "example.ts"), "before repair\n");
  const repairMutation = { path: "src/example.ts", mutation: "update" as const, beforeDigest: hash("before repair\n"), ...content("after repair\n") };
  const environment = { id: "sandbox-1", digest: d("a"), egress: "deny" as const, databaseName: "b122_test_1" };
  const repair: AutomationOperationProposal = {
    kind: "repair_mission", failingGateId: "gate-1", reproductionCommandDigest: d("b"), approvedScopePaths: ["src/example.ts"],
    mutations: [repairMutation], affectedChecks: ["targeted"], fullChecks: ["full"], testEnvironment: environment,
    effectPlan: [
      { order: 0, kind: "sandbox_bind", scopeDigest: environment.digest }, { order: 1, kind: "reproduce", scopeDigest: d("b") },
      { order: 2, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([repairMutation]) },
      { order: 3, kind: "test_affected", scopeDigest: d("c") }, { order: 4, kind: "test_full", scopeDigest: d("d") },
      { order: 5, kind: "review_diff", scopeDigest: d("e") }
    ],
    pushAuthorized: false, mergeAuthorized: false, deployAuthorized: false, hostedRerunAuthorized: false, productionDataAuthorized: false
  };
  const repairRequest = reviewedEnvelope(root, "repair_mission", repair, "operation-repair");
  let observedEnvironment: unknown;
  await harness({ childPorts: childPorts([], (value) => { observedEnvironment = value; }), highConsequenceAuthorization: acceptance })
    .executor.execute({ envelope: repairRequest.envelope, currentManifestContext: repairRequest.context });
  assert.deepEqual(observedEnvironment, environment);
});

test("required LFG children cannot report not_started and high-consequence authorization is rechecked before every effect", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "src", "example.ts"), "before\n");
  const mutation = { path: "src/example.ts", mutation: "update" as const, beforeDigest: hash("before\n"), ...content("after\n") };
  const proposal: AutomationOperationProposal = {
    kind: "lfg",
    requirementsSources: [{ path: "docs/requirements.md", digest: d("1") }],
    approvedScopePaths: ["src/example.ts"],
    mutations: [mutation],
    effectPlan: [
      { order: 0, kind: "plan", scopeDigest: d("1") },
      { order: 1, kind: "filesystem_mutation", scopeDigest: automationMutationScopeDigest([mutation]) },
      { order: 2, kind: "simplify", scopeDigest: d("2") }, { order: 3, kind: "review", scopeDigest: d("3") },
      { order: 4, kind: "test", scopeDigest: d("4") }, { order: 5, kind: "git_commit", scopeDigest: d("5") },
      { order: 6, kind: "git_push", scopeDigest: d("6") }, { order: 7, kind: "pull_request", scopeDigest: d("7") },
      { order: 8, kind: "ci_watch", scopeDigest: d("8") }
    ],
    authorizedActions: ["filesystem_mutation", "git_commit", "git_push", "pull_request", "ci_watch"],
    deployAuthorized: false
  };

  const refused = reviewedEnvelope(root, "lfg", proposal, "operation-lfg-not-started");
  const notStartedPorts: AutomationChildEffectPorts = {
    ...childPorts([]),
    plan: {
      execute: async (input) => ({
        sourceTargetSnapshotId: input.currentTargetSnapshotId,
        scopeDigest: input.child.scopeDigest,
        evidenceDigest: hash("plan-not-started"),
        effectDisposition: "not_started",
        compensationToken: null
      })
    }
  };
  await assert.rejects(
    harness({ childPorts: notStartedPorts, highConsequenceAuthorization: acceptance }).executor.execute({ envelope: refused.envelope, currentManifestContext: refused.context }),
    (error: unknown) => error instanceof AutomationEffectExecutionError
      && error.receipt?.status === "compensated"
      && error.receipt.children[0]?.effectDisposition === "not_started"
  );
  assert.equal(await readFile(join(root, "src", "example.ts"), "utf8"), "before\n");

  let authorizationChecks = 0;
  const revoked: AutomationHighConsequenceAuthorizationPort = {
    authorize: async () => {
      authorizationChecks += 1;
      if (authorizationChecks >= 3) throw new Error("acceptance authorization revoked");
      return { authorized: true, acceptanceEvidenceDigest: d("9") };
    }
  };
  const effects: string[] = [];
  const committedPlan: AutomationChildEffectPorts = {
    ...childPorts([]),
    plan: {
      execute: async (input) => {
        effects.push("plan");
        return {
          sourceTargetSnapshotId: input.currentTargetSnapshotId,
          scopeDigest: input.child.scopeDigest,
          evidenceDigest: hash("plan-committed"),
          effectDisposition: "committed",
          compensationToken: "plan-compensation"
        };
      },
      compensate: async (input) => ({ compensated: true, sourceTargetSnapshotId: input.currentTargetSnapshotId, evidenceDigest: hash("plan-compensated") })
    }
  };
  const interrupted = reviewedEnvelope(root, "lfg", proposal, "operation-lfg-revoked");
  await assert.rejects(
    harness({ childPorts: committedPlan, highConsequenceAuthorization: revoked }).executor.execute({ envelope: interrupted.envelope, currentManifestContext: interrupted.context }),
    (error: unknown) => error instanceof AutomationEffectExecutionError && error.receipt?.status === "compensated"
  );
  assert.equal(authorizationChecks, 3);
  assert.deepEqual(effects, ["plan"]);
  assert.equal(await readFile(join(root, "src", "example.ts"), "utf8"), "before\n");
});
