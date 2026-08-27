import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAcceptanceAdministration, type AcceptanceEvidenceArtifact } from "../src/acceptance-administration.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";

const at = new Date("2026-08-24T12:00:00.000Z");

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-acceptance-admin-"));
  const source = join(root, "source");
  const state = join(root, "state");
  await Promise.all([mkdir(source), mkdir(state)]);
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = createHash("sha256").update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })).digest("hex");
  const trustPath = join(source, "trust.json");
  await writeFile(trustPath, JSON.stringify({
    schema: "sxsy-b122.acceptance-trust-policy", version: 1, authorityId: "independent-lab", keyId, publicKeyPem,
    allowedGates: [8, 20], expiresAt: "2027-08-24T12:00:00.000Z"
  }), "utf8");
  const presence = { calls: [] as string[], async verify(prompt: string) { this.calls.push(prompt); return { verified: true, operator: "TEST\\Reviewer" }; } };
  const store = new ProtectedJsonStore({ filePath: join(state, "protected.jsonl") });
  const administration = createAcceptanceAdministration({ store, stateDirectory: state, presence, policyVersion: "policy-v1", now: () => new Date(at) });
  await administration.installTrustPolicy(trustPath);
  return { root, source, state, keys, keyId, presence, administration };
}

async function writeBundle(
  setup: Awaited<ReturnType<typeof fixture>>,
  gate: 8 | 20,
  overrides: Readonly<Record<string, unknown>> = {}
): Promise<string> {
  const artifactPath = `gate-${gate}.txt`;
  const artifactBytes = Buffer.from(`independent acceptance observation for gate ${gate}`, "utf8");
  await writeFile(join(setup.source, artifactPath), artifactBytes);
  const artifacts: readonly AcceptanceEvidenceArtifact[] = [{
    path: artifactPath,
    sha256: createHash("sha256").update(artifactBytes).digest("hex"),
    bytes: artifactBytes.byteLength,
    mediaType: "text/plain"
  }];
  const unsigned = {
    schema: "sxsy-b122.acceptance-evidence-bundle", version: 1, id: `evidence-gate-${gate}`, authorityId: "independent-lab", keyId: setup.keyId,
    gate, status: "passed", targetSnapshotId: "a".repeat(64), operationId: `operation-gate-${gate}`,
    evidenceDigest: `sha256:${hashCanonical(artifacts)}`, policyVersion: "policy-v1", evaluatedBy: "Independent Lab Reviewer",
    evaluatedAt: "2026-08-24T11:30:00.000Z", expiresAt: "2026-08-25T12:00:00.000Z", rationale: `Gate ${gate} passed independent observation.`,
    artifacts, signatureAlgorithm: "ecdsa-p256-sha256", ...overrides
  };
  const signature = sign("sha256", Buffer.from(canonical(unsigned), "utf8"), setup.keys.privateKey).toString("base64");
  const path = join(setup.source, `bundle-${gate}.json`);
  await writeFile(path, JSON.stringify({ ...unsigned, signature }), "utf8");
  return path;
}

test("signed host evidence imports once, remains artifact-verifiable, and explicitly activates one exact target", async (context) => {
  const setup = await fixture(context);
  const gate8 = await setup.administration.importEvidence(await writeBundle(setup, 8));
  const gate20 = await setup.administration.importEvidence(await writeBundle(setup, 20));
  assert.equal((await setup.administration.ledger.statusFor(8, "a".repeat(64))).status, "passed");
  assert.equal((await setup.administration.ledger.statusFor(20, "a".repeat(64))).status, "passed");
  await assert.rejects(setup.administration.ledger.record({
    gate: 8, status: "passed", targetSnapshotId: "a".repeat(64), evidenceDigest: gate8.evidenceDigest,
    policyVersion: "policy-v1", evaluatedBy: "Independent Lab Reviewer", rationale: "forged direct call"
  }), /single-use authorization/i);

  const activation = await setup.administration.activate("emergency_containment", "a".repeat(64), "2026-08-25T00:00:00.000Z");
  assert.deepEqual(await setup.administration.activations.enabledActions("a".repeat(64)), ["emergency_containment"]);
  assert.deepEqual(await setup.administration.activations.enabledActions("b".repeat(64)), []);
  await setup.administration.revokeActivation(activation.id, "exercise complete");
  assert.deepEqual(await setup.administration.activations.enabledActions("a".repeat(64)), []);

  await writeFile(join(gate20.evidenceReference!, "artifacts", "gate-20.txt"), "tampered", "utf8");
  assert.equal((await setup.administration.ledger.statusFor(20, "a".repeat(64))).status, "incomplete");
  assert.ok(setup.presence.calls.length >= 5);
  assert.equal(gate8.evidenceReference?.startsWith(setup.state), true);
});

test("forged, stale, mismatched, and revoked evidence fails closed", async (context) => {
  const setup = await fixture(context);
  const forged = await writeBundle(setup, 8);
  const value = JSON.parse(await readFile(forged, "utf8")) as Record<string, unknown>;
  value.rationale = "changed after signature";
  await writeFile(forged, JSON.stringify(value), "utf8");
  await assert.rejects(setup.administration.importEvidence(forged), /signature/i);

  const stale = await writeBundle(setup, 8, { id: "stale-evidence", expiresAt: "2026-08-24T11:59:59.000Z" });
  await assert.rejects(setup.administration.importEvidence(stale), /expired/i);
  const wrongPolicy = await writeBundle(setup, 8, { id: "wrong-policy", policyVersion: "other-policy" });
  await assert.rejects(setup.administration.importEvidence(wrongPolicy), /policy version/i);

  const good = await setup.administration.importEvidence(await writeBundle(setup, 8, { id: "revoked-evidence" }));
  assert.equal((await setup.administration.ledger.statusFor(8, "a".repeat(64))).status, "passed");
  await setup.administration.revokeTrust("independent-lab", setup.keyId, "authority rotation");
  assert.equal((await setup.administration.ledger.statusFor(8, "a".repeat(64))).status, "incomplete");
  assert.ok(good.evidenceReference);
});

function hashCanonical(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
