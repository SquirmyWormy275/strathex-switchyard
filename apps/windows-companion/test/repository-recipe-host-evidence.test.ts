import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExecutionRequest, IsolationRequest } from "../../../packages/control-plane/src/brokers.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { CommandResult, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { HostReceiptEvidenceFactory } from "../src/receipt-evidence.ts";
import { HostValidatedRepositoryRecipeRunner } from "../src/repository-recipe-host-evidence.ts";
import { SandboxedRepositoryExecutionBroker, repositoryRuntimeExecutionRecipe } from "../src/repository-runtime-broker.ts";
import type { SandboxInstallationPin } from "../src/sandbox-installation.ts";
import type { ScannerFixtureResolver } from "../src/scanner-fixtures.ts";

const now = "2026-08-24T12:00:00.000Z";
const runnerSha256 = "a".repeat(64);
const toolSha256 = "b".repeat(64);
const sandboxHelperSha256 = "c".repeat(64);
const configurationSha256 = "d".repeat(64);
const resultManifestSha256 = "e".repeat(64);
const fixtureManifestSha256 = "8".repeat(64);
const fixtureContentSha256 = "9".repeat(64);

function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }

const scannerFixtures: ScannerFixtureResolver = {
  async resolve(input) {
    assert.deepEqual(input.scannerFixtureIds, ["scanner-fixture-2026-08-24"]);
    assert.deepEqual(input.advisoryFixtureIds, []);
    assert.equal(input.observedAt.toISOString(), now);
    return [{
      id: "scanner-fixture-2026-08-24", kind: "scanner", authorityId: "security-lab", keyId: "f".repeat(64),
      feedVersion: "scanner-feed-2026-08-24", toolName: "b122-test-scanner", toolVersion: "1.0.0",
      manifestSha256: fixtureManifestSha256, contentSha256: fixtureContentSha256,
      generatedAt: "2026-08-24T11:30:00.000Z", expiresAt: "2026-08-24T12:30:00.000Z"
    }];
  }
};

async function fixture(context: test.TestContext) {
  const base = await mkdtemp(join(tmpdir(), "sxsy-b122-host-evidence-"));
  const repositoryRoot = join(base, "repository");
  const stateDirectory = join(base, "state");
  const resultRoot = join(stateDirectory, "windows-sandbox", "target", "validated-results", "sandbox-result");
  await Promise.all([mkdir(repositoryRoot), mkdir(resultRoot, { recursive: true })]);
  const catalogPath = join(repositoryRoot, "sandbox-catalog.json");
  const helperPath = join(base, "b122-sandbox-worker.exe");
  await writeFile(helperPath, "sandbox-helper", "utf8");
  const catalog = {
    schema: "sxsy-b122.windows-sandbox-catalog", version: 1,
    recipes: [{
      id: "shield_change_scan", executable: "C:\\B122\\input\\tools\\b122-repository-runner.exe", executableSha256: runnerSha256,
      arguments: ["--recipe", "shield_change_scan", "{INPUT_ROOT}", "{WORK_ROOT}", configurationSha256],
      workingRoot: "work", workingDirectory: ".", environment: {}, timeoutMs: 60_000, maxOutputBytes: 1024,
      artifacts: ["b122-recipe-evidence.json"]
    }]
  };
  const catalogBytes = Buffer.from(JSON.stringify(catalog), "utf8");
  await writeFile(catalogPath, catalogBytes);
  const evidence = {
    schema: "sxsy-b122.typed-recipe-result", version: 1, recipeId: "shield_change_scan",
    configurationSha256, helperSha256: runnerSha256, toolSha256, outcome: "completed", exitCode: 0,
    output: { stdoutSha256: "1".repeat(64), stdoutBytes: 12, stderrSha256: "2".repeat(64), stderrBytes: 0, truncated: false },
    coverage: [
      { dimension: "secrets", status: "covered", fixtureId: "secrets-fixture-v1" },
      { dimension: "pii", status: "covered", fixtureId: "pii-fixture-v1" },
      { dimension: "security_defects", status: "covered", fixtureId: "security-fixture-v1" }
    ],
    scannerFixtureIds: ["scanner-fixture-2026-08-24"], advisoryFixtureIds: [], unavailableDimensions: []
  };
  const evidencePath = join(resultRoot, "b122-recipe-evidence.json");
  const evidenceBytes = Buffer.from(JSON.stringify(evidence), "utf8");
  await writeFile(evidencePath, evidenceBytes);
  const material = {
    repositoryRoot: await realpath(repositoryRoot), branch: "feat/evidence", head: "3".repeat(40), indexTree: "4".repeat(40),
    trackedManifest: "5".repeat(64), untrackedManifest: "6".repeat(64), submodules: {}, policyVersion: "policy-host-evidence-v1",
    environmentFingerprint: "7".repeat(64), completeness: "complete" as const, reasons: [] as readonly string[]
  };
  const target: TargetSnapshot = { id: targetSnapshotDigest(material), ...material, capturedAt: now };
  const pin: SandboxInstallationPin = {
    canonicalRepositoryRoot: target.repositoryRoot,
    catalogPath,
    catalogSha256: sha256(catalogBytes),
    helperPath,
    helperSha256: sandboxHelperSha256,
    installedAt: now,
    status: "active"
  };
  context.after(async () => { await rm(base, { recursive: true, force: true }); });
  return { base, stateDirectory, resultRoot, evidencePath, evidenceBytes, target, pin };
}

function request(target: TargetSnapshot, guard: IsolationRequest["effectGuard"] = { async assertCurrent() { return { allowed: true, reason: "exact target remains current" }; } }): IsolationRequest {
  return {
    action: "shield_change_scan", operationId: "operation-host-evidence", target, profile: "full_sandbox",
    permit: { expiresAt: "2026-08-24T12:10:00.000Z" } as IsolationRequest["permit"], effectGuard: guard
  };
}

test("installed sandbox bytes become a complete HMAC receipt only after exact host validation", async (context) => {
  const setup = await fixture(context);
  const evidence = new HostReceiptEvidenceFactory({
    authenticationKey: Buffer.alloc(32, 9), policyVersion: setup.target.policyVersion,
    exactVersions: { companion: "test", sandboxHelper: `sha256:${sandboxHelperSha256}`, repositoryRunner: `sha256:${runnerSha256}` },
    clock: () => new Date(now)
  });
  const runner = new HostValidatedRepositoryRecipeRunner(
    { async runRecipe() { return { status: "completed", summary: "sandbox complete", data: {
      backend: "windows-sandbox", enforced: true, resultRoot: setup.resultRoot,
      resultManifestSha256, recipeCatalogSha256: setup.pin.catalogSha256, sandboxHelperSha256,
      validatedOutputs: [{ path: "b122-recipe-evidence.json", size: setup.evidenceBytes.byteLength, sha256: sha256(setup.evidenceBytes) }]
    } }; } },
    { async resolve() { return setup.pin; } },
    evidence,
    { stateDirectory: setup.stateDirectory, clock: () => new Date(now), scannerFixtures }
  );
  const invocation = request(setup.target);
  const broker = new SandboxedRepositoryExecutionBroker(
    { async resolve() { throw new Error("sandboxed evidence recipes must never fall back to the host runtime"); } },
    runner
  );
  const outcome = await broker.execute({ ...invocation, recipe: repositoryRuntimeExecutionRecipe("shield_change_scan", setup.target) } as ExecutionRequest);
  assert.equal(outcome.status, "completed");
  const envelope = outcome.data?.receiptEvidenceEnvelope;
  assert.ok(envelope);
  assert.equal(
    (envelope as { evidence: { toolVersions: Readonly<Record<string, string>> } }).evidence.toolVersions["fixture:scanner:scanner-fixture-2026-08-24"],
    `manifest=sha256:${fixtureManifestSha256};content=sha256:${fixtureContentSha256};feed=scanner-feed-2026-08-24;tool=b122-test-scanner@1.0.0;generated=2026-08-24T11:30:00.000Z;expires=2026-08-24T12:30:00.000Z`
  );
  assert.deepEqual(evidence.forResult(
    commandForAction("shield_change_scan"),
    { status: "completed", summary: outcome.summary, operationId: "operation-host-evidence", data: { receiptEvidenceEnvelope: envelope } } as CommandResult,
    setup.target
  ), {
    policyVersion: setup.target.policyVersion,
    evidenceDigest: (envelope as { evidenceDigest: string }).evidenceDigest,
    toolVersions: { companion: "test", sandboxHelper: `sha256:${sandboxHelperSha256}`, repositoryRunner: `sha256:${runnerSha256}` },
    expiresAt: "2026-08-24T12:05:00.000Z"
  });
});

test("a recipe-supplied scanner label cannot earn evidence without exact host fixture resolution", async (context) => {
  const setup = await fixture(context);
  const evidence = new HostReceiptEvidenceFactory({ authenticationKey: Buffer.alloc(32, 6), policyVersion: setup.target.policyVersion, exactVersions: { companion: "test" }, clock: () => new Date(now) });
  const runner = new HostValidatedRepositoryRecipeRunner(
    { async runRecipe() { return { status: "completed", summary: "sandbox complete", data: {
      backend: "windows-sandbox", enforced: true, resultRoot: setup.resultRoot,
      resultManifestSha256, recipeCatalogSha256: setup.pin.catalogSha256, sandboxHelperSha256,
      validatedOutputs: [{ path: "b122-recipe-evidence.json", size: setup.evidenceBytes.byteLength, sha256: sha256(setup.evidenceBytes) }]
    } }; } },
    { async resolve() { return setup.pin; } },
    evidence,
    { stateDirectory: setup.stateDirectory, clock: () => new Date(now) }
  );
  const outcome = await runner.runRecipe(request(setup.target), "shield_change_scan");
  assert.equal(outcome.status, "incomplete");
  assert.match(outcome.summary, /signed scanner\/advisory fixture registry/i);
  assert.equal(outcome.data, undefined);
});

test("post-extraction tamper and final target churn can never earn completion evidence", async (context) => {
  const setup = await fixture(context);
  const evidence = new HostReceiptEvidenceFactory({ authenticationKey: Buffer.alloc(32, 3), policyVersion: setup.target.policyVersion, exactVersions: { companion: "test" }, clock: () => new Date(now) });
  await writeFile(setup.evidencePath, `${await readFile(setup.evidencePath, "utf8")} `, "utf8");
  const outcomeData = { backend: "windows-sandbox", enforced: true, resultRoot: setup.resultRoot, resultManifestSha256, recipeCatalogSha256: setup.pin.catalogSha256, sandboxHelperSha256, validatedOutputs: [{ path: "b122-recipe-evidence.json", size: setup.evidenceBytes.byteLength, sha256: sha256(setup.evidenceBytes) }] };
  const runner = new HostValidatedRepositoryRecipeRunner({ async runRecipe() { return { status: "completed", summary: "sandbox complete", data: outcomeData }; } }, { async resolve() { return setup.pin; } }, evidence, { stateDirectory: setup.stateDirectory, clock: () => new Date(now) });
  const tampered = await runner.runRecipe(request(setup.target), "shield_change_scan");
  assert.equal(tampered.status, "incomplete");
  assert.equal(tampered.data, undefined);

  await writeFile(setup.evidencePath, setup.evidenceBytes);
  const stale = await runner.runRecipe(request(setup.target, { async assertCurrent() { return { allowed: false, reason: "target changed before receipt issuance" }; } }), "shield_change_scan");
  assert.equal(stale.status, "incomplete");
  assert.match(stale.summary, /target changed/i);
  assert.equal(stale.data, undefined);
});
