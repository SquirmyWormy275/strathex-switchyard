import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  containmentIncidentReviewDigest,
  DurableContainmentIncidentCoordinator,
  type ContainmentAssessmentEffectPort
} from "../../../packages/control-plane/src/containment-incidents.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  AttestedContainmentHistoryRemediator,
  SpawnContainmentHistoryGitRunner,
  type ContainmentHistoryGitRunner
} from "../src/containment-history-remediation.ts";

class FailOnceRefTransactionGit implements ContainmentHistoryGitRunner {
  private failed = false;
  constructor(private readonly inner: SpawnContainmentHistoryGitRunner) {}
  run(args: readonly string[], options: Readonly<{ cwd: string; environment?: Readonly<Record<string, string>>; stdin?: string }>) {
    if (!this.failed && args.join(" ") === "update-ref --stdin") {
      this.failed = true;
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "isolated atomic transaction failure" });
    }
    return this.inner.run(args, options);
  }
}

test("attested local history remediation removes a history-only path, preserves the tip tree, and records a recoverable receipt", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "sxsy-b122-history-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const repositoryRoot = join(parent, "repository");
  const stateDirectory = join(parent, "state");
  await mkdir(join(repositoryRoot, "config"), { recursive: true });
  const git = new SpawnContainmentHistoryGitRunner();
  await ok(git, ["init", "-b", "feature/contained"], repositoryRoot);
  await ok(git, ["config", "user.name", "B122 Isolated Test"], repositoryRoot);
  await ok(git, ["config", "user.email", "b122@example.invalid"], repositoryRoot);
  await writeFile(join(repositoryRoot, "config", "local.env"), "api_key=secret-one\n", "utf8");
  await writeFile(join(repositoryRoot, "README.md"), "safe\n", "utf8");
  await ok(git, ["add", "--", "config/local.env", "README.md"], repositoryRoot);
  await ok(git, ["commit", "-m", "add local configuration"], repositoryRoot);
  await rm(join(repositoryRoot, "config", "local.env"));
  await writeFile(join(repositoryRoot, "README.md"), "safe follow-up\n", "utf8");
  await ok(git, ["add", "-u", "--", "config/local.env", "README.md"], repositoryRoot);
  await ok(git, ["commit", "-m", "remove local configuration"], repositoryRoot);
  const oldHead = (await ok(git, ["rev-parse", "HEAD"], repositoryRoot)).trim();
  const oldTree = (await ok(git, ["rev-parse", "HEAD^{tree}"], repositoryRoot)).trim();
  const store = new ProtectedJsonStore({ filePath: join(stateDirectory, "protected.jsonl") });
  const incidents = new DurableContainmentIncidentCoordinator(store);
  const incident = await incidents.activate({
    repositoryRoot,
    fenceEpoch: 1,
    activationOperationId: "containment-history-test",
    targetSnapshotId: `snapshot:${oldHead}`,
    reason: "credential reached local history"
  });
  const assessment: ContainmentAssessmentEffectPort = {
    async execute(request) {
      const failed = request.step === "history";
      return {
        schema: "sxsy-b122.containment-assessment-result", version: 1,
        incidentId: request.incidentId, repositoryRoot: request.repositoryRoot, fenceEpoch: request.fenceEpoch,
        step: request.step, operationId: request.operationId, externalId: request.externalId, effectDisposition: "committed",
        status: failed ? "failed" : "passed", exposure: failed ? "found" : "none",
        summary: failed ? "Credential-shaped content is reachable in local history." : "No exposure found.",
        findings: failed ? [{ id: `containment-finding:${"f".repeat(64)}`, relativePath: "config/local.env", credentialRelated: true }] : []
      };
    },
    async observe() { return undefined; }
  };
  const assessed = await incidents.assess(incident.id, assessment);
  const finding = assessed.steps.find((step) => step.name === "history")!.result!.findings[0]!;
  const permit = await incidents.issueRemediationPermit({
    incidentId: incident.id,
    expectedIncidentDigest: containmentIncidentReviewDigest(assessed),
    action: "rewrite_local_history",
    relativePaths: [finding.relativePath],
    expiresAt: "2099-01-01T00:00:00.000Z",
    reviewedBy: "isolated-current-user"
  });
  const permitted = (await incidents.get(incident.id))!;
  let presenceCalls = 0;
  let presencePrompt = "";
  const remediator = new AttestedContainmentHistoryRemediator({
    store,
    stateDirectory,
    incidents,
    presence: { async verify(prompt) { presenceCalls += 1; presencePrompt = prompt; return { verified: true, operator: "ISOLATED\\User" }; } },
    targets: {
      async resolve(sessionId) {
        assert.equal(sessionId, "session-history");
        const head = (await ok(git, ["rev-parse", "HEAD"], repositoryRoot)).trim();
        return { repositoryRoot, targetSnapshotId: `snapshot:${head}`, branch: "feature/contained", head, completeness: "complete" };
      }
    },
    git
  });
  const request = {
    sessionId: "session-history",
    expectedIncidentId: assessed.id,
    expectedIncidentDigest: containmentIncidentReviewDigest(permitted),
    permitId: permit.id,
    relativePaths: permit.relativePaths,
    remediatedFindingIds: [finding.id]
  } as const;
  const result = await remediator.execute(request);

  assert.equal(result.oldHead, oldHead);
  assert.notEqual(result.newHead, oldHead);
  assert.ok(presencePrompt.length <= 240);
  assert.match(presencePrompt, new RegExp(`${oldHead.slice(0, 10)}>${result.newHead.slice(0, 10)}`));
  assert.match(presencePrompt, /rewrite 1 local ref\(s\); current [a-f0-9]{10}>[a-f0-9]{10}; purge 1 path\(s\); strip 0 tag signature\(s\); scope [a-f0-9]{64}; no remote/);
  assert.deepEqual(result.updatedRefs.map((update) => update.refName), ["refs/heads/feature/contained"]);
  assert.equal(result.strippedTagSignatures, 0);
  assert.equal((await ok(git, ["rev-parse", "HEAD^{tree}"], repositoryRoot)).trim(), oldTree);
  assert.equal(presenceCalls, 1);
  assert.equal((await ok(git, ["status", "--porcelain=v1"], repositoryRoot)).trim(), "");
  assert.equal((await ok(git, ["log", "--all", "--format=", "-Gapi_key", "--", "config/local.env"], repositoryRoot)).trim(), "");
  await assert.rejects(readFile(join(repositoryRoot, "config", "local.env")), /ENOENT/);
  assert.ok((await readFile(result.backupBundlePath)).byteLength > 0);
  assert.match(result.backupBundleSha256, /^[a-f0-9]{64}$/);
  const updated = await incidents.get(incident.id);
  assert.equal(updated?.receipts.at(-1)?.action, "rewrite_local_history");
  assert.deepEqual(updated?.receipts.at(-1)?.remediatedFindingIds, [finding.id]);

  // A dead-process lock from a crash is recoverable, and a completed effect
  // replays only its protected receipt/result without new presence or Git work.
  const operationKey = result.operationId.slice("containment-history:".length);
  await writeFile(join(stateDirectory, "history-remediation", `${operationKey}.lock`), JSON.stringify({ version: 1, pid: 2_147_483_647, token: "00000000-0000-4000-8000-000000000000" }), "utf8");
  const replay = await remediator.execute(request);
  assert.deepEqual(replay, result);
  assert.equal(presenceCalls, 1);
});

test("history remediation atomically rewrites every affected local branch and annotated tag across clean worktrees while leaving stale remote refs untouched", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "sxsy-b122-history-refs-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const repositoryRoot = join(parent, "repository");
  const linkedWorktree = join(parent, "linked-worktree");
  const stateDirectory = join(parent, "state");
  await mkdir(join(repositoryRoot, "config"), { recursive: true });
  const git = new SpawnContainmentHistoryGitRunner();
  await ok(git, ["init", "-b", "feature/current"], repositoryRoot);
  await ok(git, ["config", "user.name", "B122 Isolated Test"], repositoryRoot);
  await ok(git, ["config", "user.email", "b122@example.invalid"], repositoryRoot);
  await writeFile(join(repositoryRoot, "config", "local.env"), "api_key=secret-in-shared-ancestor\n", "utf8");
  await writeFile(join(repositoryRoot, "README.md"), "base\n", "utf8");
  await ok(git, ["add", "--", "config/local.env", "README.md"], repositoryRoot);
  await ok(git, ["commit", "-m", "shared secret ancestor"], repositoryRoot);
  const secretCommit = (await ok(git, ["rev-parse", "HEAD"], repositoryRoot)).trim();
  await ok(git, ["branch", "feature/other", secretCommit], repositoryRoot);
  await ok(git, ["tag", "-a", "temporary-signed-source", secretCommit, "-m", "release evidence"], repositoryRoot);
  const ordinaryTag = (await ok(git, ["cat-file", "tag", "refs/tags/temporary-signed-source"], repositoryRoot));
  const fakeSignedTag = (await git.run(["hash-object", "-t", "tag", "-w", "--stdin"], {
    cwd: repositoryRoot,
    stdin: `${ordinaryTag.trimEnd()}\n-----BEGIN PGP SIGNATURE-----\nZmFrZS1pc29sYXRlZC1zaWduYXR1cmU=\n-----END PGP SIGNATURE-----\n`
  })).stdout.trim();
  assert.match(fakeSignedTag, /^[a-f0-9]{40,64}$/);
  await ok(git, ["update-ref", "refs/tags/release-signed", fakeSignedTag], repositoryRoot);
  await ok(git, ["tag", "-d", "temporary-signed-source"], repositoryRoot);
  await ok(git, ["update-ref", "refs/remotes/origin/stale", secretCommit], repositoryRoot);

  await rm(join(repositoryRoot, "config", "local.env"));
  await writeFile(join(repositoryRoot, "README.md"), "current branch\n", "utf8");
  await ok(git, ["add", "-u", "--", "config/local.env", "README.md"], repositoryRoot);
  await ok(git, ["commit", "-m", "remove secret on current"], repositoryRoot);
  await ok(git, ["worktree", "add", linkedWorktree, "feature/other"], repositoryRoot);
  await rm(join(linkedWorktree, "config", "local.env"));
  await writeFile(join(linkedWorktree, "OTHER.md"), "other branch\n", "utf8");
  await ok(git, ["add", "-A", "--", "config/local.env", "OTHER.md"], linkedWorktree);
  await ok(git, ["commit", "-m", "remove secret on other"], linkedWorktree);
  await ok(git, ["merge", "--no-ff", "feature/other", "-m", "merge remediated branches"], repositoryRoot);
  const oldHead = (await ok(git, ["rev-parse", "HEAD"], repositoryRoot)).trim();
  const oldOther = (await ok(git, ["rev-parse", "refs/heads/feature/other"], repositoryRoot)).trim();
  const oldTag = (await ok(git, ["rev-parse", "refs/tags/release-signed"], repositoryRoot)).trim();
  const oldRemote = (await ok(git, ["rev-parse", "refs/remotes/origin/stale"], repositoryRoot)).trim();

  const store = new ProtectedJsonStore({ filePath: join(stateDirectory, "protected.jsonl") });
  const incidents = new DurableContainmentIncidentCoordinator(store);
  const prepared = await prepareHistoryPermit(incidents, repositoryRoot, oldHead, "multiref");
  let prompt = "";
  const remediator = new AttestedContainmentHistoryRemediator({
    store, stateDirectory, incidents, git,
    presence: { async verify(value) { prompt = value; return { verified: true, operator: "ISOLATED\\User" }; } },
    targets: { async resolve() { const head = (await ok(git, ["rev-parse", "HEAD"], repositoryRoot)).trim(); return { repositoryRoot, targetSnapshotId: `snapshot:${head}`, branch: "feature/current", head, completeness: "complete" }; } }
  });
  const outcome = await remediator.execute(prepared.request);

  assert.deepEqual(outcome.updatedRefs.map((update) => update.refName), ["refs/heads/feature/current", "refs/heads/feature/other", "refs/tags/release-signed"]);
  assert.equal(outcome.strippedTagSignatures, 1);
  assert.match(prompt, /rewrite 3 local ref\(s\).*strip 1 tag signature\(s\)/);
  assert.notEqual((await ok(git, ["rev-parse", "HEAD"], repositoryRoot)).trim(), oldHead);
  assert.notEqual((await ok(git, ["rev-parse", "refs/heads/feature/other"], repositoryRoot)).trim(), oldOther);
  assert.notEqual((await ok(git, ["rev-parse", "refs/tags/release-signed"], repositoryRoot)).trim(), oldTag);
  assert.equal((await ok(git, ["rev-parse", "refs/remotes/origin/stale"], repositoryRoot)).trim(), oldRemote);
  assert.equal((await ok(git, ["cat-file", "-t", "refs/tags/release-signed"], repositoryRoot)).trim(), "tag");
  assert.doesNotMatch(await ok(git, ["cat-file", "tag", "refs/tags/release-signed"], repositoryRoot), /BEGIN PGP SIGNATURE/);
  assert.equal((await ok(git, ["log", "--branches", "--tags", "--format=", "-Gapi_key", "--", "config/local.env"], repositoryRoot)).trim(), "");
  assert.notEqual((await ok(git, ["log", "--remotes", "--format=%H", "-Gapi_key", "--", "config/local.env"], repositoryRoot)).trim(), "");
  assert.equal((await ok(git, ["status", "--porcelain=v1"], repositoryRoot)).trim(), "");
  assert.equal((await ok(git, ["status", "--porcelain=v1"], linkedWorktree)).trim(), "");
  const bundleHeads = await ok(git, ["bundle", "list-heads", outcome.backupBundlePath], repositoryRoot);
  assert.match(bundleHeads, new RegExp(`${oldHead} refs/heads/feature/current`));
  assert.match(bundleHeads, new RegExp(`${oldOther} refs/heads/feature/other`));
  assert.match(bundleHeads, new RegExp(`${oldTag} refs/tags/release-signed`));
});

test("a failed atomic ref transaction leaves every ref old and restart reconciliation applies the prepared plan without replaying presence", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "sxsy-b122-history-restart-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const repositoryRoot = join(parent, "repository");
  const stateDirectory = join(parent, "state");
  await mkdir(join(repositoryRoot, "config"), { recursive: true });
  const git = new SpawnContainmentHistoryGitRunner();
  await ok(git, ["init", "-b", "feature/current"], repositoryRoot);
  await ok(git, ["config", "user.name", "B122 Isolated Test"], repositoryRoot);
  await ok(git, ["config", "user.email", "b122@example.invalid"], repositoryRoot);
  await writeFile(join(repositoryRoot, "config", "local.env"), "token=secret\n", "utf8");
  await ok(git, ["add", "--", "config/local.env"], repositoryRoot);
  await ok(git, ["commit", "-m", "secret"], repositoryRoot);
  await ok(git, ["branch", "feature/other"], repositoryRoot);
  await rm(join(repositoryRoot, "config", "local.env"));
  await ok(git, ["add", "-u", "--", "config/local.env"], repositoryRoot);
  await ok(git, ["commit", "-m", "remove secret"], repositoryRoot);
  await ok(git, ["branch", "-f", "feature/other", "HEAD"], repositoryRoot);
  const oldCurrent = (await ok(git, ["rev-parse", "refs/heads/feature/current"], repositoryRoot)).trim();
  const oldOther = (await ok(git, ["rev-parse", "refs/heads/feature/other"], repositoryRoot)).trim();
  const store = new ProtectedJsonStore({ filePath: join(stateDirectory, "protected.jsonl") });
  const incidents = new DurableContainmentIncidentCoordinator(store);
  const prepared = await prepareHistoryPermit(incidents, repositoryRoot, oldCurrent, "restart");
  let presenceCalls = 0;
  const common = {
    store, stateDirectory, incidents,
    presence: { async verify() { presenceCalls += 1; return { verified: true, operator: "ISOLATED\\User" }; } },
    targets: { async resolve() { const head = (await ok(git, ["rev-parse", "HEAD"], repositoryRoot)).trim(); return { repositoryRoot, targetSnapshotId: `snapshot:${head}`, branch: "feature/current", head, completeness: "complete" as const }; } }
  };
  await assert.rejects(new AttestedContainmentHistoryRemediator({ ...common, git: new FailOnceRefTransactionGit(git) }).execute(prepared.request), /transaction did not commit atomically/i);
  assert.equal((await ok(git, ["rev-parse", "refs/heads/feature/current"], repositoryRoot)).trim(), oldCurrent);
  assert.equal((await ok(git, ["rev-parse", "refs/heads/feature/other"], repositoryRoot)).trim(), oldOther);
  assert.equal(presenceCalls, 1);

  const recovered = await new AttestedContainmentHistoryRemediator({ ...common, git }).execute(prepared.request);
  assert.equal(recovered.updatedRefs.length, 2);
  assert.notEqual((await ok(git, ["rev-parse", "refs/heads/feature/current"], repositoryRoot)).trim(), oldCurrent);
  assert.notEqual((await ok(git, ["rev-parse", "refs/heads/feature/other"], repositoryRoot)).trim(), oldOther);
  assert.equal(presenceCalls, 1);
});

test("history remediation rejects client path broadening before user presence or Git mutation", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "sxsy-b122-history-reject-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const store = new ProtectedJsonStore({ filePath: join(parent, "protected.jsonl") });
  let presenceCalls = 0;
  const remediator = new AttestedContainmentHistoryRemediator({
    store,
    stateDirectory: join(parent, "state"),
    incidents: {
      async get() { return undefined; },
      async assertRemediationPermit() { throw new Error("must not reach permit"); },
      async recordRemediation() { throw new Error("must not record"); }
    },
    presence: { async verify() { presenceCalls += 1; return { verified: true, operator: "test" }; } },
    targets: { async resolve() { throw new Error("must not resolve"); } }
  });
  await assert.rejects(remediator.execute({
    sessionId: "session-history",
    expectedIncidentId: `containment-incident:${"a".repeat(64)}`,
    expectedIncidentDigest: "b".repeat(64),
    permitId: `containment-remediation-permit:${"c".repeat(64)}`,
    relativePaths: ["../outside"],
    remediatedFindingIds: [`containment-finding:${"d".repeat(64)}`]
  }), /escapes.*boundary/i);
  assert.equal(presenceCalls, 0);
});

async function ok(git: SpawnContainmentHistoryGitRunner, args: readonly string[], cwd: string): Promise<string> {
  const result = await git.run(args, { cwd });
  assert.equal(result.exitCode, 0, `${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

async function prepareHistoryPermit(incidents: DurableContainmentIncidentCoordinator, repositoryRoot: string, head: string, suffix: string) {
  const incident = await incidents.activate({ repositoryRoot, fenceEpoch: 1, activationOperationId: `containment-history-${suffix}`, targetSnapshotId: `snapshot:${head}`, reason: "credential reached local history" });
  const findingId = `containment-finding:${"e".repeat(64)}`;
  const assessment: ContainmentAssessmentEffectPort = {
    async execute(request) {
      const failed = request.step === "history";
      return { schema: "sxsy-b122.containment-assessment-result", version: 1, incidentId: request.incidentId, repositoryRoot: request.repositoryRoot, fenceEpoch: request.fenceEpoch, step: request.step, operationId: request.operationId, externalId: request.externalId, effectDisposition: "committed", status: failed ? "failed" : "passed", exposure: failed ? "found" : "none", summary: failed ? "Credential-shaped content is reachable in local history." : "No exposure found.", findings: failed ? [{ id: findingId, relativePath: "config/local.env", credentialRelated: true }] : [] };
    },
    async observe() { return undefined; }
  };
  const assessed = await incidents.assess(incident.id, assessment);
  const permit = await incidents.issueRemediationPermit({ incidentId: incident.id, expectedIncidentDigest: containmentIncidentReviewDigest(assessed), action: "rewrite_local_history", relativePaths: ["config/local.env"], expiresAt: "2099-01-01T00:00:00.000Z", reviewedBy: "isolated-current-user" });
  const permitted = (await incidents.get(incident.id))!;
  return { request: { sessionId: "session-history", expectedIncidentId: incident.id, expectedIncidentDigest: containmentIncidentReviewDigest(permitted), permitId: permit.id, relativePaths: permit.relativePaths, remediatedFindingIds: [findingId] } as const };
}
