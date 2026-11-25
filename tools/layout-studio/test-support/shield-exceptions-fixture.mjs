import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "../suite-store.mjs";
import { createShieldExceptions } from "../shield-exceptions.mjs";
import { repositoryEffectJournal } from "../repository-effect-journal.mjs";
import { shieldReceiptEvidence } from "../repository-shield.mjs";
import { ReceiptLedger } from "../../../packages/control-plane/src/receipts.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { HostReceiptEvidenceFactory } from "../../../apps/windows-companion/src/receipt-evidence.ts";
import { createRepositoryRecipeEvidence } from "../../../apps/windows-companion/src/repository-runtime-broker.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { scannerFixture } from "./shield-scanner-fixture.mjs";

// Real scanner, HMAC, AEAD and journals; target-authority revalidation is doubled.
export async function exceptionFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sx-exception-review-")), keys = new Map(); let time = Date.UTC(2026, 10, 4), active = "personal";
  const now = () => time, sha = bytes => createHash("sha256").update(bytes).digest("hex"), store = createSuiteStore({ root, secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => keys.set(c+p,v) }, clock: now }); await store.initialize("personal"); await store.initialize("work", "work"); await store.update("personal", "synthetic-mode", state => { state.mode = "personal-companion"; });
  const material = { repositoryRoot: "/synthetic", branch: "feature/scan", head: "a".repeat(40), indexTree: "b".repeat(40), trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "synthetic-policy", environmentFingerprint: "environment", completeness: "complete", reasons: [] }, target = { id: targetSnapshotDigest(material), ...material, capturedAt: new Date(time).toISOString() };
  let currentTarget = target.id;
  const action = "shield_change_scan", operationId = randomUUID(), authorityId = randomUUID(), sample = scannerFixture({ action, files: { "app.js": "eval(untrusted);" } }), report = await sample.scan(), output = JSON.stringify(report), engineSha256 = sha(await readFile(new URL("../shield-scanner-engine.mjs", import.meta.url)));
  const factory = shieldReceiptEvidence(new HostReceiptEvidenceFactory({ authenticationKey: Buffer.alloc(32, 7), policyVersion: target.policyVersion, exactVersions: { suite: "synthetic" }, clock: () => new Date(time) })), request = { action, operationId, target, recipe: { id: "sxsy-b122.repository-runtime:" + action } }, observation = { status: "completed", summary: "Synthetic scanner observation", exitCode: 0, output };
  const binding = { manifestSha256: "d".repeat(64), helperSha256: engineSha256, helperVersion: "switchyard-baseline-scanner/1", resultSha256: sha(output), toolVersions: { scannerSource: "sha256:" + engineSha256 }, scannerFixtureIds: [sample.request.scanner.id], advisoryFixtureIds: [], coverage: ["secrets", "pii", "security_defects"].map(dimension => ({ dimension, status: "unavailable", fixtureId: sample.request.scanner.id })), policyVersion: target.policyVersion, createdAt: new Date(time).toISOString(), expiresAt: new Date(time + 300000).toISOString() }, envelope = factory.issueRepositoryRecipeEvidence(createRepositoryRecipeEvidence(request, observation, binding, time), request, binding), result = { status: "failed", operationId, summary: "Synthetic pinned finding", data: { shieldReport: report, receiptEvidenceEnvelope: envelope } }, evidence = factory.forResult(commandForAction(action), result, target);
  const receipts = new ReceiptLedger(repositoryEffectJournal(store, "personal", { domain: "execution", now }), { clock: () => new Date(time).toISOString() }), receipt = await receipts.issue({ operationId, action, targetSnapshotId: target.id, authorityId, result: "failed", completeness: "incomplete", evidenceDigest: evidence.evidenceDigest, policyVersion: evidence.policyVersion, toolVersions: evidence.toolVersions, expiresAt: evidence.expiresAt });
  await store.update("personal", "synthetic-source", state => { state.repositoryExecutionReviews = [{ requestId: randomUUID(), authorityId, action, operationId, targetSnapshotId: target.id, shield: { engineSha256, requestSha256: report.requestSha256 }, outcome: { ...result, receiptId: receipt.id } }]; });
  let authorityChecks = 0;
  const authority = { resolve: async (_c, id, selected) => { if (id !== authorityId || selected !== action) throw Error("Synthetic authority mismatch"); authorityChecks++; return { snapshot: { ...target, id: currentTarget } }; } }, service = createShieldExceptions({ store, authority, now, isActive: async c => active === c });
  t.after(async () => { active = "personal"; await service.close(); await rm(root, { recursive: true, force: true }); });
  const proposal = { requestId: randomUUID(), action: "grant", sourceReceiptId: receipt.id, fingerprint: report.findings[0].fingerprint, reason: "Synthetic finding accepted for this exact test fixture", expiresAt: new Date(time + 3600000).toISOString() };
  const review = () => service.review("personal", proposal), apply = reviewed => service.apply("personal", { requestId: proposal.requestId, token: reviewed.confirmation.token });
  return { store, service, receipts, receipt, report, target, engineSha256, proposal, now, review, apply, advance: ms => { time += ms; }, active: c => { active = c; }, changeTarget: () => { currentTarget = "e".repeat(64); }, authorityChecks: () => authorityChecks };
}
