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
  SpawnContainmentHistoryGitRunner
} from "../src/containment-history-remediation.ts";

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
  assert.match(presencePrompt, /purge 1 path\(s\) from all commits; tip changes 0; scope [a-f0-9]{64}; no remote/);
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
