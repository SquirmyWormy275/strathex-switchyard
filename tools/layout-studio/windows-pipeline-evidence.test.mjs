import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostReceiptEvidenceFactory } from "../../apps/windows-companion/src/receipt-evidence.ts";
import { repositoryRuntimeExecutionRecipe } from "../../apps/windows-companion/src/repository-runtime-broker.ts";
import { targetSnapshotDigest } from "../../packages/control-plane/src/snapshot.ts";
import { attestWindowsPipeline } from "./repository-windows-pipeline.mjs";
const sha = v => createHash("sha256").update(v).digest("hex");

async function fixture(t, action = "pipeline_local_gate") {
  const stateDirectory = await mkdtemp(join(tmpdir(), "sx-windows-evidence-")), operationId = randomUUID(), now = () => Date.UTC(2026, 10, 4);
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const material = { repositoryRoot: stateDirectory, branch: "feature/synthetic", head: "3".repeat(40), indexTree: "4".repeat(40), trackedManifest: "5".repeat(64), untrackedManifest: "6".repeat(64), submodules: {}, policyVersion: "synthetic-pipeline-v1", environmentFingerprint: "7".repeat(64), completeness: "complete", reasons: [] };
  const target = { ...material, id: targetSnapshotDigest(material), capturedAt: new Date(now()).toISOString() }, request = { action, operationId, target, recipe: repositoryRuntimeExecutionRecipe(action, target) };
  const report = { schema: "sxsy-b122.windows-repository-recipe-result", version: 1, coverage: ["correctness", ...(action === "pipeline_clean_reproduction" ? ["reproduction"] : []), "isolation", "production_data", "ambient_credentials"].map(dimension => ({ dimension, status: "covered", fixtureId: "approved:synthetic-program" })), scannerFixtureIds: ["scanner-feed"], advisoryFixtureIds: ["advisory-feed"] };
  const root = join(stateDirectory, "windows/personal/results", operationId, "sandbox-" + randomUUID()); await mkdir(root, { recursive: true });
  const review = { action, operationId, scopeDigest: "a".repeat(64), manifestSha256: "b".repeat(64), catalogSha256: "c".repeat(64), executableIdentity: { helperSha256: "d".repeat(64) }, recipe: { maxOutputBytes: 8192 } };
  const result = { status: "completed", summary: "Explicit guest double", resultRoot: root, programExitCode: 0, resultManifestSha256: "e".repeat(64), recipeCatalogSha256: review.catalogSha256, sandboxHelperSha256: review.executableIdentity.helperSha256, validatedOutputs: [] };
  const native = { operationId, action, scopeDigest: review.scopeDigest, nativeExitVerified: true, result };
  const fixtures = ["scanner", "advisory"].map(kind => ({ id: kind + "-feed", kind, manifestSha256: "1".repeat(64), contentSha256: "2".repeat(64), feedVersion: "synthetic-v1", toolName: "synthetic-tool", toolVersion: "1", expiresAt: new Date(now() + 3600000).toISOString() }));
  const input = { store: { snapshot: async () => ({ repositoryWindowsRuns: [native] }) }, compartment: "personal", stateDirectory, review, request, result, receiptEvidence: new HostReceiptEvidenceFactory({ authenticationKey: Buffer.alloc(32, 9), policyVersion: target.policyVersion, exactVersions: { suite: "synthetic" }, clock: () => new Date(now()) }), resolveScannerFixtures: async () => fixtures, guard: async () => {}, now };
  const write = async (text = JSON.stringify(report)) => { await writeFile(join(root, "process.stdout.txt"), text); result.validatedOutputs = [{ path: "process.stdout.txt", size: Buffer.byteLength(text), sha256: sha(text) }]; };
  await write(); return { input, native, report, fixtures, result, root, write };
}
test("exact Windows pipeline attestation binds report, catalog, helper and freshly verified scanner/advisory hashes", async t => {
  for (const action of ["pipeline_local_gate", "pipeline_clean_reproduction"]) {
    const f = await fixture(t, action), result = await attestWindowsPipeline(f.input); assert.equal(result.status, "completed");
    const envelope = result.data.receiptEvidenceEnvelope; assert.equal(envelope.action, action); assert.equal(envelope.operationId, f.input.request.operationId); assert.equal(envelope.outcome, "passed");
    for (const fixture of f.fixtures) assert.equal(envelope.evidence.toolVersions[`fixture:${fixture.kind}:${fixture.id}`], `manifest=sha256:${fixture.manifestSha256};content=sha256:${fixture.contentSha256};feed=${fixture.feedVersion};tool=${fixture.toolName}@${fixture.toolVersion}`);
  }
});
test("unavailable coverage earns only incomplete evidence; malformed or substituted reports never earn a passing envelope", async t => {
  for (const fault of ["unavailable", "malformed", "dimension", "duplicate-dimension", "cross-kind", "extra-field", "invalid-utf8", "changed-bytes", "duplicate-output", "oversized"]) {
    const f = await fixture(t);
    if (fault === "unavailable") f.report.coverage[0].status = "unavailable";
    if (fault === "dimension") f.report.coverage.pop();
    if (fault === "duplicate-dimension") f.report.coverage[1] = f.report.coverage[0];
    if (fault === "cross-kind") f.report.advisoryFixtureIds = f.report.scannerFixtureIds;
    if (fault === "extra-field") f.report.approved = true;
    await f.write(fault === "malformed" ? "untyped result" : JSON.stringify(f.report));
    if (fault === "invalid-utf8") { const bytes = Buffer.from([0xff, 0xff, 0xff]); await writeFile(join(f.root, "process.stdout.txt"), bytes); f.result.validatedOutputs = [{ path: "process.stdout.txt", size: bytes.length, sha256: sha(bytes) }]; }
    if (fault === "changed-bytes") await writeFile(join(f.root, "process.stdout.txt"), "changed original output");
    if (fault === "duplicate-output") f.result.validatedOutputs.push(f.result.validatedOutputs[0]);
    if (fault === "oversized") f.input.review.recipe.maxOutputBytes = 1;
    const result = await attestWindowsPipeline(f.input); assert.equal(result.status, "incomplete", fault); assert.notEqual(result.data?.receiptEvidenceEnvelope?.outcome, "passed", fault);
    if (fault === "unavailable") assert.equal(result.data.receiptEvidenceEnvelope.completeness, "incomplete");
  }
});
test("unknown exit, cross-bound native results, changed extraction roots, revoked fixtures and expired authority cannot become pipeline success", async t => {
  for (const fault of ["exit", "operation", "action", "scope", "result", "catalog", "helper", "program-exit", "root", "fixtures", "expired", "guard"]) {
    const f = await fixture(t);
    if (fault === "exit") f.native.nativeExitVerified = false;
    if (fault === "operation") f.input.request.operationId = randomUUID();
    if (fault === "action") f.native.action = "run_target";
    if (fault === "scope") f.native.scopeDigest = "f".repeat(64);
    if (fault === "result") f.native.result = { ...f.result, summary: "different original" };
    if (fault === "catalog") f.result.recipeCatalogSha256 = "f".repeat(64);
    if (fault === "helper") f.result.sandboxHelperSha256 = "f".repeat(64);
    if (fault === "program-exit") f.result.programExitCode = 7;
    if (fault === "root") { await rename(f.root, f.root + "-replaced"); f.result.resultRoot += "-replaced"; }
    if (fault === "fixtures") f.input.resolveScannerFixtures = async () => { throw Error("Synthetic revoked fixture"); };
    if (fault === "expired") f.fixtures[0].expiresAt = new Date(f.input.now() - 1).toISOString();
    if (fault === "guard") f.input.guard = async () => { throw Error("Synthetic revoked authority"); };
    assert.equal((await attestWindowsPipeline(f.input)).status, "incomplete", fault);
  }
});
