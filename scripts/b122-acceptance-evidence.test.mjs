import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuthority, signEvidenceBundle, verifyEvidenceBundle } from "./b122-acceptance-evidence.mjs";

test("offline acceptance tooling generates a scoped authority and detects artifact tampering", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-acceptance-tool-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const authorityDirectory = join(root, "authority");
  const evidenceDirectory = join(root, "evidence");
  await mkdir(evidenceDirectory);
  const authority = await createAuthority({ outputDirectory: authorityDirectory, authorityId: "independent-lab", allowedGates: [8, 20], expiresAt: "2099-01-01T00:00:00.000Z" });
  const trust = JSON.parse(await readFile(authority.trustPolicyPath, "utf8"));
  assert.equal(trust.authorityId, "independent-lab");
  assert.deepEqual(trust.allowedGates, [8, 20]);
  assert.equal("privateKey" in trust, false);

  await writeFile(join(evidenceDirectory, "observation.txt"), "independent observation", "utf8");
  const draftPath = join(evidenceDirectory, "draft.json");
  await writeFile(draftPath, JSON.stringify({
    schema: "sxsy-b122.acceptance-evidence-draft", version: 1, id: "gate-8-observation", gate: 8, status: "passed",
    targetSnapshotId: "a".repeat(64), operationId: "operation-8", policyVersion: "policy-v1", evaluatedBy: "Independent Reviewer",
    evaluatedAt: "2026-08-24T12:00:00.000Z", expiresAt: "2027-08-24T12:00:00.000Z", rationale: "Observed the exact containment boundary.",
    artifacts: [{ path: "observation.txt", mediaType: "text/plain" }]
  }), "utf8");
  const bundlePath = join(evidenceDirectory, "bundle.json");
  const bundle = await signEvidenceBundle({ draftPath, privateKeyPath: authority.privateKeyPath, trustPolicyPath: authority.trustPolicyPath, outputPath: bundlePath });
  assert.match(bundle.signature, /^[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(await verifyEvidenceBundle({ bundlePath, trustPolicyPath: authority.trustPolicyPath, now: new Date("2026-08-25T00:00:00.000Z") }), {
    valid: true, id: "gate-8-observation", gate: 8, evidenceDigest: bundle.evidenceDigest
  });

  await writeFile(join(evidenceDirectory, "observation.txt"), "tampered observation", "utf8");
  await assert.rejects(verifyEvidenceBundle({ bundlePath, trustPolicyPath: authority.trustPolicyPath, now: new Date("2026-08-25T00:00:00.000Z") }), /artifact evidence changed/i);
});

test("offline acceptance tooling rejects unauthorized gates and mismatched private keys", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-acceptance-tool-reject-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const first = await createAuthority({ outputDirectory: join(root, "first"), authorityId: "first", allowedGates: [8], expiresAt: "2099-01-01T00:00:00.000Z" });
  const second = await createAuthority({ outputDirectory: join(root, "second"), authorityId: "second", allowedGates: [20], expiresAt: "2099-01-01T00:00:00.000Z" });
  const evidence = join(root, "evidence");
  await mkdir(evidence);
  await writeFile(join(evidence, "proof.txt"), "proof", "utf8");
  const draft = join(evidence, "draft.json");
  await writeFile(draft, JSON.stringify({ schema: "sxsy-b122.acceptance-evidence-draft", version: 1, id: "proof", gate: 20, status: "passed", targetSnapshotId: "a".repeat(64), operationId: null, policyVersion: "policy", evaluatedBy: "reviewer", evaluatedAt: "2026-08-24T12:00:00.000Z", expiresAt: "2027-08-24T12:00:00.000Z", rationale: "proof", artifacts: [{ path: "proof.txt", mediaType: "text/plain" }] }), "utf8");
  await assert.rejects(signEvidenceBundle({ draftPath: draft, privateKeyPath: first.privateKeyPath, trustPolicyPath: first.trustPolicyPath, outputPath: join(evidence, "unauthorized.json") }), /does not authorize/i);
  await assert.rejects(signEvidenceBundle({ draftPath: draft, privateKeyPath: first.privateKeyPath, trustPolicyPath: second.trustPolicyPath, outputPath: join(evidence, "mismatch.json") }), /does not match/i);
});
