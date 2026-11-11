import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, readFile, writeFile, unlink, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { windowsScannerSaveFixture } from "./test-support/windows-scanner-save-fixture.mjs";
import { draftInput } from "./test-support/scanner-draft-fixture.mjs";
import { createRepositoryExecution } from "./repository-execution.mjs";
import { loadWindowsReviewedRun } from "./windows-reviewed-run.mjs";
import { scanShieldInputs } from "./shield-scanner-engine.mjs";
import { withShieldGitInputs } from "./shield-git-inputs.mjs";
import { buildWindowsIndexPacket } from "./windows-index-inputs.mjs";
import { buildWindowsHistoryPacket, windowsCombinedGitRequest } from "./windows-history-inputs.mjs";
import { scopeHash } from "./confirmations.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const runtime = () => ({ nodeVersion: "24.14.0", identity: { canonicalPath: "C:\\synthetic\\node.exe", sha256: "b".repeat(64), device: "1", inode: "2", size: 123, modifiedMs: 456 } });

test("generated Windows controls flow through protected save, fresh permission and reviewed execution with actual Git bytes and explicit native doubles", async t => {
  let runtimeSha256 = runtime().identity.sha256;
  const f = await windowsScannerSaveFixture(t, { authority: { platform: "win32", readWindowsScannerRuntime: async () => runtime() } });
  await writeFile(join(f.root, "removed.env"), "-----BEGIN PRIVATE KEY-----\nSYNTHETIC_REMOVED_WINDOWS_DRAFT_SECRET");
  await f.run("add", "removed.env"); await f.run("-c", "commit.gpgsign=false", "commit", "-m", "synthetic history");
  await unlink(join(f.root, "removed.env")); await f.run("add", "removed.env"); await f.run("-c", "commit.gpgsign=false", "commit", "-m", "synthetic deletion");
  await writeFile(join(f.root, "task.txt"), "-----BEGIN PRIVATE KEY-----\nSYNTHETIC_STAGED_WINDOWS_DRAFT_SECRET"); await f.run("add", "task.txt");
  await writeFile(join(f.root, "task.txt"), "ordinary current source\n");
  const before = { index: await readFile(join(f.root, ".git/index")), head: await f.run("rev-parse", "HEAD"), source: await readFile(join(f.root, "task.txt")) };
  const savedReview = await f.saver.review("personal", { ...draftInput(f), includeIndex: true, historyDepth: 4, includeRemovedHistory: true }), draft = savedReview.draft;
  assert.equal(draft.files.length, 6); assert.deepEqual(f.commands, []);
  assert.equal((await f.saver.apply("personal", { id: draft.id, token: savedReview.confirmation.token })).status, "saved");
  assert.deepEqual(f.commands, ["create-directory", ...Array(6).fill("write-file"), "inspect-files"]);
  for (const file of draft.files) assert.equal(await readFile(join(f.root, file.path), "utf8"), file.content);
  assert.equal((await f.service.list("personal")).length, 0);
  const permission = await f.service.review("personal", draft.authorityProposal), grant = await f.service.issue("personal", { ...draft.authorityProposal, token: permission.confirmation.token });
  assert.ok(grant.proposal.history.paths.includes("removed.env")); assert.equal(grant.proposal.paths.includes("removed.env"), false);
  let executions = 0;
  // Only native process/guest effects are doubled. Production parsers, Git
  // witnesses, signed feeds, policy, confirmations and output attestation run.
  const prerequisites = () => ({ helperSha256: "c".repeat(64), recipeRuntime: { path: runtime().identity.canonicalPath, sha256: runtimeSha256 }, nodeVersion: "24.14.0" });
  const runner = {
    prerequisites: async () => prerequisites(), recover: async () => ({ cleaned: true }), list: async c => (await f.store.snapshot(c)).repositoryWindowsRuns ?? [],
    stopCompartment: async () => ({ stopped: true, cleaned: true }), close: async () => {},
    run: async (c, context, plan, guard, signal, action, gitOptions) => {
      await guard(); assert.equal(signal.aborted, false); assert.equal(action, draft.action);
      const loaded = await loadWindowsReviewedRun({ ...plan, expectedAction: action, recipeRuntimeSha256: runtimeSha256 });
      assert.deepEqual(loaded.recipe, draft.recipe);
      const review = (await f.store.snapshot(c)).repositoryExecutionReviews.find(row => row.operationId === context.operationId);
      assert.equal(review.scopeDigest, context.scopeDigest); assert.equal(review.checkpoint.digest, scopeHash(review.checkpoint.payload));
      const report = await withShieldGitInputs(review.shield, gitOptions, async options => {
        const index = buildWindowsIndexPacket({ action, indexWitness: plan.indexWitness, indexBytes: options.indexBytes, inputFiles: loaded.manifest.inputFiles });
        const history = buildWindowsHistoryPacket({ action, historyWitness: plan.historyWitness, historyBytes: options.historyBytes, inputFiles: loaded.manifest.inputFiles, indexWitness: plan.indexWitness });
        windowsCombinedGitRequest({ inputFiles: loaded.manifest.inputFiles }, index, history);
        return scanShieldInputs(draft.request, { readInput: async path => {
          const privateFile = options.indexBytes?.get(path) ?? options.historyBytes?.get(path);
          return privateFile ? Buffer.from(privateFile.bytes) : readFile(join(f.root, path));
        } });
      });
      await guard(); executions++;
      const resultRoot = join(f.stage, "execution", "windows", c, "results", context.operationId, "sandbox-11111111-2222-4333-8444-555555555555"); await mkdir(resultRoot, { recursive: true });
      const result = { status: "completed", summary: "Explicit Windows guest double", resultRoot, programExitCode: 0, validatedOutputs: [], resultManifestSha256: "e".repeat(64), recipeCatalogSha256: loaded.manifest.catalogSha256, sandboxHelperSha256: prerequisites().helperSha256 };
      for (const [path, text] of [["process.stdout.txt", JSON.stringify(report)], ["process.stderr.txt", ""]]) {
        const bytes = Buffer.from(text); await writeFile(join(resultRoot, path), bytes); result.validatedOutputs.push({ path, size: bytes.length, sha256: sha(bytes) });
      }
      await f.store.update(c, "synthetic-Windows-native-result", state => { (state.repositoryWindowsRuns ??= []).push({ schema: "switchyard-windows-reviewed-runner/v1", ...context, action, planDigest: scopeHash(plan), status: "settled", cleanupPending: false, nativeExitVerified: true, result, backendObservation: result }); });
      return result;
    }
  };
  const execution = createRepositoryExecution({ store: f.store, authority: f.service, stateDirectory: join(f.stage, "execution"), platform: "win32", windowsRunner: runner, resolveScannerFixtures: (c, input) => f.feeds.resolve(c, input), now: f.now }); f.onCleanup(() => execution.close());
  const proposal = { requestId: randomUUID(), authorityId: grant.id, action: draft.action, manifestPath: draft.manifestPath, manifestSha256: draft.manifestSha256 };
  const review = await execution.review("personal", proposal); assert.equal(review.review.engine, "windows-sandbox"); assert.deepEqual(review.review.recipe, draft.recipe);
  runtimeSha256 = "d".repeat(64);
  await assert.rejects(execution.apply("personal", { requestId: proposal.requestId, token: review.confirmation.token }), /pinned guest Node/); assert.equal(executions, 0);
  runtimeSha256 = runtime().identity.sha256;
  const result = await execution.apply("personal", { requestId: proposal.requestId, token: review.confirmation.token });
  assert.equal(result.status, "failed", JSON.stringify(result)); assert.ok(result.receiptId);
  assert.ok(result.data.shieldReport.findings.some(row => row.path === ".switchyard-index/task.txt" && row.ruleId === "secret.private-key"));
  assert.ok(result.data.shieldReport.findings.some(row => row.path.startsWith(".switchyard-history/") && row.path.endsWith("/removed.env") && row.ruleId === "secret.private-key"));
  assert.equal(result.data.shieldReport.findings.some(row => row.path === "task.txt"), false);
  assert.equal(result.data.receiptEvidenceEnvelope.completeness, "incomplete");
  assert.equal(JSON.stringify(result).includes("SYNTHETIC_REMOVED_WINDOWS_DRAFT_SECRET"), false); assert.equal(JSON.stringify(result).includes("SYNTHETIC_STAGED_WINDOWS_DRAFT_SECRET"), false);
  assert.equal((await execution.apply("personal", { requestId: proposal.requestId, token: review.confirmation.token })).receiptId, result.receiptId); assert.equal(executions, 1);
  assert.deepEqual(await readFile(join(f.root, ".git/index")), before.index); assert.deepEqual(await readFile(join(f.root, "task.txt")), before.source); assert.equal(await f.run("rev-parse", "HEAD"), before.head);
  for (const path of ["removed.env", ".switchyard-index", ".switchyard-history"]) await assert.rejects(access(join(f.root, path)), { code: "ENOENT" });
  const state = await f.store.snapshot("personal"); assert.ok(state.scannerRecipeNativeOwners.every(row => row.stoppedVerified)); assert.ok(state.repositoryProbes.every(row => row.stoppedVerified && !row.scratchCleanupPending));
});

test("a runtime update between Windows save review and apply cannot write the old approved controls", async t => {
  let pin = runtime(); const f = await windowsScannerSaveFixture(t, { authority: { platform: "win32", readWindowsScannerRuntime: async () => structuredClone(pin) } });
  const review = await f.prepare(), before = await readdir(f.root); pin.identity.sha256 = "c".repeat(64);
  await assert.rejects(f.saver.apply("personal", { id: review.draft.id, token: review.confirmation.token }), /generated bytes changed/);
  assert.deepEqual(f.commands, []); assert.deepEqual(await readdir(f.root), before); assert.deepEqual(await f.service.list("personal"), []);
  assert.equal((await f.saver.list("personal"))[0].status, "reviewed");
});
