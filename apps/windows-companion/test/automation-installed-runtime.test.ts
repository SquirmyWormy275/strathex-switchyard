import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AutomationRequest, PermitVerifier } from "../../../packages/control-plane/src/brokers.ts";
import type { OperationRecord, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import {
  automationManifestReviewScopeDigest,
  createAutomationManifestApproval,
  createAutomationOperationManifest,
  type AutomationPathMutation
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { automationRequestSchema, createAutomationIntent, parseAutomationEnvelope } from "../../../packages/control-plane/src/automation-protocol.ts";
import { SessionRegistry, sessionBindingDigest } from "../../../packages/control-plane/src/session-registry.ts";
import { TargetSnapshotLedger } from "../../../packages/control-plane/src/snapshot-ledger.ts";
import { TargetSnapshotFactory, trackedMissingFileDigest, type GitInspection } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, sha256, stableJson, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import {
  ProtectedStoreAutomationEffectJournal,
  type AutomationEffectJournalState,
  type AutomationInFlightTargetTransition,
  type AutomationTargetTransitionPhase
} from "../src/automation-effect-executor.ts";
import {
  InstalledAutomationEffectRuntime,
  automationHostTargetObservation,
  type AutomationHostTargetObservation,
  type InstalledAutomationEffectRuntimeOptions
} from "../src/automation-installed-runtime.ts";
import { DurableEffectTargetTransitionCoordinator, type EffectTargetTransitionPort } from "../src/effect-target-transition.ts";

const root = "C:\\b122-installed-automation";
const nowIso = "2026-08-26T00:01:00.000Z";
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const fileDigest = (value: string): string => `sha256:${digest(value)}`;
const authenticator: JournalAuthenticator = {
  provider: "automation-installed-runtime-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

interface Fixture {
  readonly directory: string;
  readonly store: ProtectedJsonStore;
  readonly sessions: SessionRegistry;
  readonly authorities: AuthorityLedger;
  readonly request: AutomationRequest;
  readonly envelope: ReturnType<typeof parseAutomationEnvelope>;
  readonly source: AutomationHostTargetObservation;
  readonly transitionCoordinator: EffectTargetTransitionPort;
  readonly journal: ProtectedStoreAutomationEffectJournal;
  readonly controls: {
    now: Date;
    current: AutomationHostTargetObservation;
    cancelled: boolean;
    policyAllowed: boolean;
    containmentEpoch: number;
    observerFailure: boolean;
    operationState: OperationRecord["state"];
    resolverTarget?: TargetSnapshot;
  };
  runtime(targetTransitions?: EffectTargetTransitionPort): InstalledAutomationEffectRuntime;
  initialize(runtime?: InstalledAutomationEffectRuntime): Promise<InstalledAutomationEffectRuntime>;
  cleanup(): Promise<void>;
}

async function observed(input: Readonly<{
  tracked: GitInspection["trackedFiles"];
  untracked?: GitInspection["untrackedFiles"];
  head?: string;
  indexTree?: string;
}>): Promise<AutomationHostTargetObservation> {
  const inspection: GitInspection = {
    repositoryRoot: root,
    canonicalRemote: "https://github.com/example/b122.git",
    branch: "feat/automation",
    defaultBranch: "main",
    upstream: "origin/feat/automation",
    head: input.head ?? "1".repeat(40),
    indexTree: input.indexTree ?? "2".repeat(40),
    trackedFiles: input.tracked,
    untrackedFiles: input.untracked ?? [],
    ignoredFiles: [],
    submodules: {},
    issues: []
  };
  const snapshot = await new TargetSnapshotFactory({ inspect: async () => inspection }, { clock: () => nowIso }).capture({
    targetHint: root,
    policyVersion: "b122-test-v1",
    environment: { values: { runtime: "installed-test" } }
  });
  return automationHostTargetObservation(snapshot, inspection);
}

async function fixture(sourceFiles: GitInspection["trackedFiles"] = [{ path: "docs/learning.md", digest: fileDigest("old") }]): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "b122-automation-installed-"));
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator, requireAuthenticatedProtection: true, clock: () => nowIso });
  const source = await observed({ tracked: sourceFiles });
  const sessions = new SessionRegistry(store, { clock: () => nowIso });
  const session = await sessions.register({
    id: "session-installed-automation",
    provider: "codex",
    surface: "vscode_window",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running",
    workspaceRoot: root,
    targetSnapshotId: source.snapshot.id,
    taskId: "task-installed-automation",
    planRevision: "plan-v1",
    plannedFiles: ["docs/learning.md"],
    lastHeartbeat: nowIso,
    adapterVersion: "test-v1",
    metadata: {}
  });
  const authorities = new AuthorityLedger(store, { clock: () => nowIso });
  const authority = await authorities.issue({
    id: "authority-installed-automation",
    repositoryRoot: root,
    sessionId: session.id,
    taskId: session.taskId,
    planRevision: session.planRevision,
    allowedActions: ["compound_refresh"],
    prohibitedActions: [],
    expiresAt: "2026-08-26T00:20:00.000Z",
    issuedBy: "test"
  });
  const mutation: AutomationPathMutation = {
    path: "docs/learning.md",
    mutation: "delete",
    beforeDigest: digest("old"),
    afterDigest: null,
    content: null
  };
  const mutations: AutomationPathMutation[] = [mutation];
  if (sourceFiles?.some((entry) => entry.path === "src/second.ts")) {
    mutations.push({ path: "src/second.ts", mutation: "delete", beforeDigest: digest("second"), afterDigest: null, content: null });
  }
  const message = "Refresh reviewed learning";
  const manifest = createAutomationOperationManifest({
    repositoryRoot: root,
    targetSnapshotId: source.snapshot.id,
    sessionId: session.id,
    authorityId: authority.id,
    taskId: session.taskId!,
    planRevision: session.planRevision!,
    provider: session.provider,
    createdAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "2026-08-26T00:10:00.000Z"
  }, {
    kind: "compound_refresh",
    audit: ["drift", "overlap", "supersession", "contradiction"],
    mutations,
    commit: { planned: true, messageDigest: digest(message), message }
  });
  const confirmationToken = "installed-automation-confirmation";
  const approval = createAutomationManifestApproval({
    manifest,
    confirmationToken,
    confirmationScopeDigest: automationManifestReviewScopeDigest(manifest),
    confirmedAt: nowIso,
    expiresAt: "2026-08-26T00:06:00.000Z"
  });
  const intent = createAutomationIntent("compound_refresh", {
    digest: approval.confirmationDigest,
    scopeDigest: approval.reviewScopeDigest
  }, undefined, { manifest, approval });
  const operationId = "operation-installed-automation";
  const envelope = parseAutomationEnvelope({
    schema: automationRequestSchema("compound_refresh"),
    version: 1,
    action: "compound_refresh",
    operationId,
    target: {
      id: source.snapshot.id,
      repositoryRoot: root,
      branch: source.snapshot.branch,
      head: source.snapshot.head,
      policyVersion: source.snapshot.policyVersion,
      trackedManifest: source.snapshot.trackedManifest,
      untrackedManifest: source.snapshot.untrackedManifest
    },
    session: {
      id: session.id,
      provider: session.provider,
      surface: session.surface,
      capabilities: session.capabilities,
      taskId: session.taskId,
      planRevision: session.planRevision,
      plannedFiles: session.plannedFiles
    },
    authorityId: authority.id,
    manifest,
    approval,
    intent
  });
  const controls = {
    now: new Date(nowIso),
    current: source,
    cancelled: false,
    policyAllowed: true,
    containmentEpoch: 0,
    observerFailure: false,
    operationState: "executing" as OperationRecord["state"],
    resolverTarget: undefined as TargetSnapshot | undefined
  };
  const request: AutomationRequest = {
    action: "compound_refresh",
    operationId,
    target: source.snapshot,
    session,
    authority,
    permit: {
      id: "permit-installed-automation",
      action: "compound_refresh",
      operationId,
      targetSnapshotId: source.snapshot.id,
      sessionId: session.id,
      authorityId: authority.id,
      expiresAt: "2026-08-26T00:08:00.000Z"
    },
    executionControl: {
      operationId,
      deadline: "2026-08-26T00:09:00.000Z",
      async isCancellationRequested() { return controls.cancelled; }
    },
    confirmation: {
      currentUserConfirmed: true,
      confirmationDigest: approval.confirmationDigest,
      confirmationScopeDigest: approval.reviewScopeDigest,
      action: "compound_refresh",
      targetSnapshotId: source.snapshot.id,
      sessionId: session.id,
      authorityId: authority.id
    },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    reviewedManifest: manifest,
    manifestApproval: approval
  };
  const targets = new TargetSnapshotLedger(store);
  await targets.record(source.snapshot);
  const targetResolver = {
    async resolve() { return controls.resolverTarget ?? controls.current.snapshot; }
  };
  const transitionCoordinator = new DurableEffectTargetTransitionCoordinator({ sessions, targets, targetResolver });
  const policy: PermitVerifier = { verifyPermit: () => controls.policyAllowed };
  const baseOptions = (): InstalledAutomationEffectRuntimeOptions => ({
    store,
    request,
    envelope,
    operations: {
      async get(id) {
        if (id !== operationId) return undefined;
        return {
          id: operationId,
          idempotencyKey: "automation-installed",
          action: "compound_refresh",
          targetSnapshotId: source.snapshot.id,
          state: controls.operationState,
          createdAt: nowIso,
          updatedAt: nowIso,
          childIds: [],
          details: {}
        };
      }
    },
    sessions,
    authorities,
    policy,
    containment: {
      async currentClear() {
        const material = { repositoryRoot: root.toLowerCase(), status: "clear", fenceEpoch: controls.containmentEpoch, activationOperationId: null } as const;
        return { status: "clear", bindingDigest: sha256(stableJson(material)), fenceEpoch: controls.containmentEpoch, activationOperationId: null };
      }
    },
    targetResolver,
    targetObserver: {
      async observe() {
        if (controls.observerFailure) throw new Error("reparse or unreadable target");
        return controls.current;
      }
    },
    targetTransitions: transitionCoordinator,
    now: () => new Date(controls.now)
  });
  const makeRuntime = (targetTransitions: EffectTargetTransitionPort = transitionCoordinator) => new InstalledAutomationEffectRuntime({ ...baseOptions(), targetTransitions });
  const initialize = async (runtime = makeRuntime()) => {
    await runtime.guard.assertCurrent({ envelope, boundary: "before_operation", expectedTargetSnapshotId: source.snapshot.id });
    return runtime;
  };
  return {
    directory,
    store,
    sessions,
    authorities,
    request,
    envelope,
    source,
    transitionCoordinator,
    journal: new ProtectedStoreAutomationEffectJournal(store),
    controls,
    runtime: makeRuntime,
    initialize,
    cleanup: () => rm(directory, { recursive: true, force: true })
  };
}

function boundaryDigest(value: Readonly<Record<string, unknown>>): string {
  return sha256(stableJson({ schema: "sxsy-b122.automation-effect-boundary", version: 1, ...value }));
}

function refreshGitEvidenceDigest(
  fx: Fixture,
  sourceTarget: TargetSnapshot,
  session: NonNullable<Awaited<ReturnType<SessionRegistry["get"]>>>,
  postHead: string
): string {
  assert.equal(fx.envelope.manifest.proposal.kind, "compound_refresh");
  const proposal = fx.envelope.manifest.proposal;
  assert.equal(proposal.commit.planned, true);
  const operationId = `automation-refresh-${sha256(stableJson({
    schema: "sxsy-b122.automation-refresh-git-operation",
    version: 1,
    operationId: fx.envelope.operationId,
    manifestId: fx.envelope.manifest.id,
    currentTargetSnapshotId: sourceTarget.id
  })).slice(0, 48)}`;
  return sha256(stableJson({
    schema: "sxsy-b122.installed-refresh-git-evidence",
    version: 1,
    operationId,
    manifestId: fx.envelope.manifest.id,
    targetSnapshotId: sourceTarget.id,
    sessionBindingDigest: sessionBindingDigest(session),
    beforeHead: sourceTarget.head,
    postHead,
    paths: proposal.mutations.map((mutation) => mutation.path),
    messageDigest: proposal.commit.messageDigest
  }));
}

function pending(
  transitionId: string,
  phase: AutomationTargetTransitionPhase,
  expectation: "changed" | "unchanged",
  fromTargetSnapshotId: string,
  expectedEffectEvidenceDigest: string
): AutomationInFlightTargetTransition {
  return {
    transitionId,
    phase,
    expectation,
    fromTargetSnapshotId,
    toTargetSnapshotId: null,
    expectedEffectEvidenceDigest,
    hostObservationDigest: null,
    status: "pending"
  };
}

async function saveJournal(
  fx: Fixture,
  revision: number,
  currentTargetSnapshotId: string,
  targetTransitionChain: AutomationEffectJournalState["targetTransitionChain"],
  patch: Partial<AutomationEffectJournalState> = {}
): Promise<void> {
  await fx.journal.save({
    schema: "sxsy-b122.automation-effect-journal-state",
    version: 1,
    revision,
    operationId: fx.envelope.operationId,
    requestDigest: digest("executor-request"),
    action: "compound_refresh",
    status: "applying",
    canonicalRoot: root,
    currentTargetSnapshotId,
    targetTransitionChain,
    applied: [],
    deltas: [],
    children: [],
    rolledBackPaths: [],
    actualDelta: null,
    targetTransition: null,
    receipt: null,
    errors: [],
    updatedAt: nowIso,
    ...patch
  });
}

function transitionInput(
  fx: Fixture,
  transitionId: string,
  phase: AutomationTargetTransitionPhase,
  expectation: "changed" | "unchanged",
  fromTargetSnapshotId: string,
  expectedEffectEvidenceDigest: string
) {
  return {
    transitionId,
    operationId: fx.envelope.operationId,
    action: fx.envelope.action,
    envelope: fx.envelope,
    repositoryRoot: root,
    previousTargetSnapshotId: fromTargetSnapshotId,
    manifestId: fx.envelope.manifest.id,
    phase,
    expectation,
    expectedEffectEvidenceDigest
  } as const;
}

test("installed runtime accepts a sequential exact tracked deletion then reviewed Git-commit-only target transition", async () => {
  const fx = await fixture();
  try {
    const runtime = await fx.initialize();
    const deletion = await observed({ tracked: [{ path: "docs/learning.md", digest: trackedMissingFileDigest("docs/learning.md"), state: "tracked_missing" }] });
    const committed = await observed({
      tracked: [{ path: "docs/learning.md", digest: trackedMissingFileDigest("docs/learning.md"), state: "tracked_missing" }],
      head: "3".repeat(40),
      indexTree: "4".repeat(40)
    });
    const delta = { path: "docs/learning.md", mutation: "delete" as const, beforeDigest: digest("old"), afterDigest: null, byteLength: 0, status: "applied" as const };
    const fileEvidence = boundaryDigest({ delta });
    const filePhase = { kind: "filesystem" as const, direction: "apply" as const, path: "docs/learning.md" };
    const fileId = digest("file-transition");
    const filePending = pending(fileId, filePhase, "changed", fx.source.snapshot.id, fileEvidence);
    await saveJournal(fx, 1, fx.source.snapshot.id, [filePending], {
      applied: [{ path: "docs/learning.md", mutation: "delete", beforeDigest: digest("old"), afterDigest: null, beforeContentBase64: Buffer.from("old").toString("base64"), beforeByteLength: 3, beforeMode: 0o644, stagingPath: null }],
      deltas: [delta]
    });
    fx.controls.current = deletion;
    const fileResult = await runtime.targetTransition.captureAndAccept(transitionInput(fx, fileId, filePhase, "changed", fx.source.snapshot.id, fileEvidence));
    assert.equal(fileResult.toTargetSnapshotId, deletion.snapshot.id);
    assert.equal((await fx.sessions.get(fx.request.session!.id))?.targetSnapshotId, deletion.snapshot.id);

    const child = { order: 1, kind: "git_commit" as const, scopeDigest: fx.envelope.manifest.proposal.kind === "compound_refresh" && fx.envelope.manifest.proposal.commit.planned ? fx.envelope.manifest.proposal.commit.messageDigest : "" };
    const currentSession = await fx.sessions.get(fx.request.session!.id);
    assert.ok(currentSession);
    const childResult = { sourceTargetSnapshotId: deletion.snapshot.id, scopeDigest: child.scopeDigest, evidenceDigest: refreshGitEvidenceDigest(fx, deletion.snapshot, currentSession, committed.snapshot.head!), effectDisposition: "committed" as const, compensationToken: "commit-compensation" };
    const childEvidence = boundaryDigest({ child, result: childResult });
    const childPhase = { kind: "child" as const, direction: "execute" as const, order: 1, childKind: "git_commit" as const };
    const childId = digest("commit-transition");
    const acceptedFile: AutomationInFlightTargetTransition = { ...filePending, toTargetSnapshotId: deletion.snapshot.id, hostObservationDigest: fileResult.hostObservationDigest, status: "accepted" };
    const childPending = pending(childId, childPhase, "changed", deletion.snapshot.id, childEvidence);
    await saveJournal(fx, 2, deletion.snapshot.id, [acceptedFile, childPending], {
      applied: [{ path: "docs/learning.md", mutation: "delete", beforeDigest: digest("old"), afterDigest: null, beforeContentBase64: Buffer.from("old").toString("base64"), beforeByteLength: 3, beforeMode: 0o644, stagingPath: null }],
      deltas: [delta],
      children: [{ order: 1, kind: "git_commit", scopeDigest: child.scopeDigest, evidenceDigest: childResult.evidenceDigest, effectDisposition: "committed", compensationToken: childResult.compensationToken, compensatedEvidenceDigest: null }]
    });
    fx.controls.current = committed;
    const commitResult = await runtime.targetTransition.captureAndAccept(transitionInput(fx, childId, childPhase, "changed", deletion.snapshot.id, childEvidence));
    assert.equal(commitResult.toTargetSnapshotId, committed.snapshot.id);
    await runtime.guard.assertCurrent({ envelope: fx.envelope, boundary: "before_operation", expectedTargetSnapshotId: committed.snapshot.id });
    assert.match(commitResult.hostObservationDigest, /^[a-f0-9]{64}$/);
  } finally { await fx.cleanup(); }
});

test("installed runtime rejects a same-tree concurrent HEAD substitution for the reviewed Refresh commit", async () => {
  const fx = await fixture();
  try {
    const runtime = await fx.initialize();
    const deletedFiles = [{ path: "docs/learning.md", digest: trackedMissingFileDigest("docs/learning.md"), state: "tracked_missing" as const }];
    const deletion = await observed({ tracked: deletedFiles });
    const delta = { path: "docs/learning.md", mutation: "delete" as const, beforeDigest: digest("old"), afterDigest: null, byteLength: 0, status: "applied" as const };
    const fileEvidence = boundaryDigest({ delta });
    const filePhase = { kind: "filesystem" as const, direction: "apply" as const, path: "docs/learning.md" };
    const fileId = digest("substitution-file-transition");
    const filePending = pending(fileId, filePhase, "changed", fx.source.snapshot.id, fileEvidence);
    await saveJournal(fx, 1, fx.source.snapshot.id, [filePending], { deltas: [delta] });
    fx.controls.current = deletion;
    const fileResult = await runtime.targetTransition.captureAndAccept(transitionInput(fx, fileId, filePhase, "changed", fx.source.snapshot.id, fileEvidence));

    const reviewedPostHead = "3".repeat(40);
    const substituted = await observed({ tracked: deletedFiles, head: "5".repeat(40), indexTree: "4".repeat(40) });
    const currentSession = await fx.sessions.get(fx.request.session!.id);
    assert.ok(currentSession);
    const child = { order: 1, kind: "git_commit" as const, scopeDigest: fx.envelope.manifest.proposal.kind === "compound_refresh" && fx.envelope.manifest.proposal.commit.planned ? fx.envelope.manifest.proposal.commit.messageDigest : "" };
    const childResult = {
      sourceTargetSnapshotId: deletion.snapshot.id,
      scopeDigest: child.scopeDigest,
      evidenceDigest: refreshGitEvidenceDigest(fx, deletion.snapshot, currentSession, reviewedPostHead),
      effectDisposition: "committed" as const,
      compensationToken: null
    };
    const childEvidence = boundaryDigest({ child, result: childResult });
    const childPhase = { kind: "child" as const, direction: "execute" as const, order: 1, childKind: "git_commit" as const };
    const childId = digest("substituted-head-transition");
    const acceptedFile: AutomationInFlightTargetTransition = { ...filePending, toTargetSnapshotId: deletion.snapshot.id, hostObservationDigest: fileResult.hostObservationDigest, status: "accepted" };
    const childPending = pending(childId, childPhase, "changed", deletion.snapshot.id, childEvidence);
    await saveJournal(fx, 2, deletion.snapshot.id, [acceptedFile, childPending], {
      deltas: [delta],
      children: [{ order: 1, kind: "git_commit", scopeDigest: child.scopeDigest, evidenceDigest: childResult.evidenceDigest, effectDisposition: "committed", compensationToken: null, compensatedEvidenceDigest: null }]
    });
    fx.controls.current = substituted;

    await assert.rejects(
      runtime.targetTransition.captureAndAccept(transitionInput(fx, childId, childPhase, "changed", deletion.snapshot.id, childEvidence)),
      /exact committed Git evidence|Refresh HEAD|recovery/i
    );
    assert.equal((await fx.sessions.get(fx.request.session!.id))?.targetSnapshotId, deletion.snapshot.id);
  } finally { await fx.cleanup(); }
});

test("installed runtime advances two reviewed filesystem paths through a strict sequential target chain", async () => {
  const fx = await fixture([
    { path: "docs/learning.md", digest: fileDigest("old") },
    { path: "src/second.ts", digest: fileDigest("second") }
  ]);
  try {
    const runtime = await fx.initialize();
    const afterFirst = await observed({ tracked: [
      { path: "docs/learning.md", digest: trackedMissingFileDigest("docs/learning.md"), state: "tracked_missing" },
      { path: "src/second.ts", digest: fileDigest("second") }
    ] });
    const afterSecond = await observed({ tracked: [
      { path: "docs/learning.md", digest: trackedMissingFileDigest("docs/learning.md"), state: "tracked_missing" },
      { path: "src/second.ts", digest: trackedMissingFileDigest("src/second.ts"), state: "tracked_missing" }
    ] });
    const firstDelta = { path: "docs/learning.md", mutation: "delete" as const, beforeDigest: digest("old"), afterDigest: null, byteLength: 0, status: "applied" as const };
    const secondDelta = { path: "src/second.ts", mutation: "delete" as const, beforeDigest: digest("second"), afterDigest: null, byteLength: 0, status: "applied" as const };
    const firstEvidence = boundaryDigest({ delta: firstDelta });
    const secondEvidence = boundaryDigest({ delta: secondDelta });
    const firstPhase = { kind: "filesystem" as const, direction: "apply" as const, path: firstDelta.path };
    const secondPhase = { kind: "filesystem" as const, direction: "apply" as const, path: secondDelta.path };
    const firstId = digest("sequential-first");
    const secondId = digest("sequential-second");
    const firstPending = pending(firstId, firstPhase, "changed", fx.source.snapshot.id, firstEvidence);
    await saveJournal(fx, 1, fx.source.snapshot.id, [firstPending], { deltas: [firstDelta] });
    fx.controls.current = afterFirst;
    const first = await runtime.targetTransition.captureAndAccept(transitionInput(fx, firstId, firstPhase, "changed", fx.source.snapshot.id, firstEvidence));
    const acceptedFirst: AutomationInFlightTargetTransition = { ...firstPending, toTargetSnapshotId: afterFirst.snapshot.id, hostObservationDigest: first.hostObservationDigest, status: "accepted" };
    const secondPending = pending(secondId, secondPhase, "changed", afterFirst.snapshot.id, secondEvidence);
    await saveJournal(fx, 2, afterFirst.snapshot.id, [acceptedFirst, secondPending], { deltas: [firstDelta, secondDelta] });
    fx.controls.current = afterSecond;
    const second = await runtime.targetTransition.captureAndAccept(transitionInput(fx, secondId, secondPhase, "changed", afterFirst.snapshot.id, secondEvidence));
    assert.equal(second.toTargetSnapshotId, afterSecond.snapshot.id);
    await runtime.guard.assertCurrent({ envelope: fx.envelope, boundary: "before_path", expectedTargetSnapshotId: afterSecond.snapshot.id, path: "src/second.ts" });
  } finally { await fx.cleanup(); }
});

test("installed runtime host-observes an exact rollback and returns the durable session to the reviewed source target", async () => {
  const fx = await fixture();
  try {
    const runtime = await fx.initialize();
    const deletion = await observed({ tracked: [{ path: "docs/learning.md", digest: trackedMissingFileDigest("docs/learning.md"), state: "tracked_missing" }] });
    const delta = { path: "docs/learning.md", mutation: "delete" as const, beforeDigest: digest("old"), afterDigest: null, byteLength: 0, status: "applied" as const };
    const recovery = { path: "docs/learning.md", mutation: "delete" as const, beforeDigest: digest("old"), afterDigest: null, beforeContentBase64: Buffer.from("old").toString("base64"), beforeByteLength: 3, beforeMode: 0o644, stagingPath: null };
    const applyEvidence = boundaryDigest({ delta });
    const applyPhase = { kind: "filesystem" as const, direction: "apply" as const, path: delta.path };
    const applyId = digest("rollback-apply");
    const applyPending = pending(applyId, applyPhase, "changed", fx.source.snapshot.id, applyEvidence);
    await saveJournal(fx, 1, fx.source.snapshot.id, [applyPending], { applied: [recovery], deltas: [delta] });
    fx.controls.current = deletion;
    const applied = await runtime.targetTransition.captureAndAccept(transitionInput(fx, applyId, applyPhase, "changed", fx.source.snapshot.id, applyEvidence));

    const rollbackDelta = { path: delta.path, mutation: "create" as const, beforeDigest: null, afterDigest: digest("old"), byteLength: 3, status: "applied" as const };
    const rollbackEvidence = boundaryDigest({ rollbackDelta });
    const rollbackPhase = { kind: "filesystem" as const, direction: "rollback" as const, path: delta.path };
    const rollbackId = digest("rollback-restore");
    const acceptedApply: AutomationInFlightTargetTransition = { ...applyPending, toTargetSnapshotId: deletion.snapshot.id, hostObservationDigest: applied.hostObservationDigest, status: "accepted" };
    const rollbackPending = pending(rollbackId, rollbackPhase, "changed", deletion.snapshot.id, rollbackEvidence);
    await saveJournal(fx, 2, deletion.snapshot.id, [acceptedApply, rollbackPending], { applied: [recovery], deltas: [delta], rolledBackPaths: [delta.path] });
    fx.controls.current = fx.source;
    const rolledBack = await runtime.targetTransition.captureAndAccept(transitionInput(fx, rollbackId, rollbackPhase, "changed", deletion.snapshot.id, rollbackEvidence));
    assert.equal(rolledBack.toTargetSnapshotId, fx.source.snapshot.id);
    assert.equal((await fx.sessions.get(fx.request.session!.id))?.targetSnapshotId, fx.source.snapshot.id);
  } finally { await fx.cleanup(); }
});

test("installed runtime rejects unrelated file churn even when the reviewed path has the exact after digest", async () => {
  const fx = await fixture([
    { path: "docs/learning.md", digest: fileDigest("old") },
    { path: "src/other.ts", digest: fileDigest("before") }
  ]);
  try {
    const runtime = await fx.initialize();
    const changed = await observed({ tracked: [
      { path: "docs/learning.md", digest: trackedMissingFileDigest("docs/learning.md"), state: "tracked_missing" },
      { path: "src/other.ts", digest: fileDigest("after") }
    ] });
    const delta = { path: "docs/learning.md", mutation: "delete" as const, beforeDigest: digest("old"), afterDigest: null, byteLength: 0, status: "applied" as const };
    const evidence = boundaryDigest({ delta });
    const phase = { kind: "filesystem" as const, direction: "apply" as const, path: "docs/learning.md" };
    const id = digest("unrelated-churn");
    await saveJournal(fx, 1, fx.source.snapshot.id, [pending(id, phase, "changed", fx.source.snapshot.id, evidence)], { deltas: [delta] });
    fx.controls.current = changed;
    await assert.rejects(runtime.targetTransition.captureAndAccept(transitionInput(fx, id, phase, "changed", fx.source.snapshot.id, evidence)), /unrelated target churn/i);
    assert.equal((await fx.sessions.get(fx.request.session!.id))?.targetSnapshotId, fx.source.snapshot.id);
  } finally { await fx.cleanup(); }
});

test("installed runtime proves an unchanged child and rejects forged phase or effect evidence", async () => {
  const fx = await fixture();
  try {
    const runtime = await fx.initialize();
    const child = { order: 1, kind: "git_commit" as const, scopeDigest: fx.envelope.manifest.proposal.kind === "compound_refresh" && fx.envelope.manifest.proposal.commit.planned ? fx.envelope.manifest.proposal.commit.messageDigest : "" };
    const result = { sourceTargetSnapshotId: fx.source.snapshot.id, scopeDigest: child.scopeDigest, evidenceDigest: digest("not-started"), effectDisposition: "not_started" as const, compensationToken: null };
    const evidence = boundaryDigest({ child, result });
    const phase = { kind: "child" as const, direction: "execute" as const, order: 1, childKind: "git_commit" as const };
    const id = digest("unchanged-child");
    await saveJournal(fx, 1, fx.source.snapshot.id, [pending(id, phase, "unchanged", fx.source.snapshot.id, evidence)], {
      children: [{ order: 1, kind: "git_commit", scopeDigest: child.scopeDigest, evidenceDigest: result.evidenceDigest, effectDisposition: "not_started", compensationToken: null, compensatedEvidenceDigest: null }]
    });
    const accepted = await runtime.targetTransition.captureAndAccept(transitionInput(fx, id, phase, "unchanged", fx.source.snapshot.id, evidence));
    assert.equal(accepted.fromTargetSnapshotId, accepted.toTargetSnapshotId);

    const forged = await fixture();
    try {
      const forgedRuntime = await forged.initialize();
      await saveJournal(forged, 1, forged.source.snapshot.id, [pending(id, phase, "unchanged", forged.source.snapshot.id, evidence)], {
        children: [{ order: 1, kind: "git_commit", scopeDigest: child.scopeDigest, evidenceDigest: result.evidenceDigest, effectDisposition: "not_started", compensationToken: null, compensatedEvidenceDigest: null }]
      });
      await assert.rejects(forgedRuntime.targetTransition.captureAndAccept(transitionInput(forged, id, phase, "unchanged", forged.source.snapshot.id, digest("forged-effect"))), /pending|forged|contradicts/i);
      const forgedPhase = { kind: "filesystem" as const, direction: "apply" as const, path: "src/not-reviewed.ts" };
      await assert.rejects(forgedRuntime.targetTransition.captureAndAccept(transitionInput(forged, id, forgedPhase, "unchanged", forged.source.snapshot.id, evidence)), /pending|reviewed|transition/i);
    } finally { await forged.cleanup(); }
  } finally { await fx.cleanup(); }
});

test("installed runtime resumes idempotently after the durable session CAS response is lost", async () => {
  const fx = await fixture();
  try {
    const deletion = await observed({ tracked: [{ path: "docs/learning.md", digest: trackedMissingFileDigest("docs/learning.md"), state: "tracked_missing" }] });
    const delta = { path: "docs/learning.md", mutation: "delete" as const, beforeDigest: digest("old"), afterDigest: null, byteLength: 0, status: "applied" as const };
    const evidence = boundaryDigest({ delta });
    const phase = { kind: "filesystem" as const, direction: "apply" as const, path: "docs/learning.md" };
    const id = digest("lost-cas-response");
    const lossy: EffectTargetTransitionPort = {
      async captureAndAccept(input) {
        await fx.transitionCoordinator.captureAndAccept(input);
        throw new Error("simulated lost response after CAS");
      }
    };
    const first = await fx.initialize(fx.runtime(lossy));
    await saveJournal(fx, 1, fx.source.snapshot.id, [pending(id, phase, "changed", fx.source.snapshot.id, evidence)], { deltas: [delta] });
    fx.controls.current = deletion;
    await assert.rejects(first.targetTransition.captureAndAccept(transitionInput(fx, id, phase, "changed", fx.source.snapshot.id, evidence)), /lost response/i);
    assert.equal((await fx.sessions.get(fx.request.session!.id))?.targetSnapshotId, deletion.snapshot.id);
    const restarted = fx.runtime();
    const recovered = await restarted.targetTransition.captureAndAccept(transitionInput(fx, id, phase, "changed", fx.source.snapshot.id, evidence));
    assert.equal(recovered.toTargetSnapshotId, deletion.snapshot.id);
    const replay = await restarted.targetTransition.captureAndAccept(transitionInput(fx, id, phase, "changed", fx.source.snapshot.id, evidence));
    assert.deepEqual(replay, recovered);
  } finally { await fx.cleanup(); }
});

test("installed runtime fails closed on stale operation, permit, session, authority, containment, deadline, cancellation, target, and unreadable observation", async (suite) => {
  for (const scenario of ["operation", "permit", "session", "authority", "containment", "deadline", "cancellation", "target", "unreadable"] as const) {
    await suite.test(scenario, async () => {
      const fx = await fixture();
      try {
        const runtime = await fx.initialize();
        if (scenario === "operation") fx.controls.operationState = "failed";
        if (scenario === "permit") fx.controls.policyAllowed = false;
        if (scenario === "session") await fx.sessions.heartbeat(fx.request.session!.id, "2026-08-26T00:01:01.000Z");
        if (scenario === "authority") await fx.authorities.revoke(fx.request.authority!.id, "test revocation");
        if (scenario === "containment") fx.controls.containmentEpoch = 1;
        if (scenario === "deadline") fx.controls.now = new Date("2026-08-26T00:09:00.000Z");
        if (scenario === "cancellation") fx.controls.cancelled = true;
        if (scenario === "target") fx.controls.resolverTarget = (await observed({ tracked: [{ path: "docs/learning.md", digest: fileDigest("changed") }] })).snapshot;
        if (scenario === "unreadable") fx.controls.observerFailure = true;
        await assert.rejects(runtime.guard.assertCurrent({ envelope: fx.envelope, boundary: "before_operation", expectedTargetSnapshotId: fx.source.snapshot.id }), /operation|policy|permit|session|authority|containment|deadline|cancel|target|inventory|unreadable/i);
      } finally { await fx.cleanup(); }
    });
  }
});
