import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import type { ContainmentAssessmentRequest } from "../../../packages/control-plane/src/containment-incidents.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  containmentRemoteEvidenceId,
  containmentRemoteEvidenceSigningPayload,
  createContainmentRemoteEvidenceAdministration,
  DurableContainmentRemoteEvidenceRegistry,
  type ContainmentRemoteEvidenceBinding,
  type ContainmentRemoteEvidenceChallenge,
  type ContainmentRemoteEvidenceRefResult,
  type ContainmentRemoteTrustPolicy,
  type UnsignedContainmentRemoteEvidence
} from "../src/containment-remote-evidence.ts";

const initialNow = "2026-08-25T12:00:00.000Z";
const authorityId = "independent-remote-auditor";
const purpose = "containment-remote-assessment" as const;
const authenticator = {
  provider: "containment-remote-test",
  async seal(hash: string) { return `test:${hash}`; },
  async verify(hash: string, tag: string) { return tag === `test:${hash}`; }
};

async function setup(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "sxsy-containment-remote-evidence-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  let clock = new Date(initialNow);
  let nonce = 0;
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = createHash("sha256").update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })).digest("hex");
  const filePath = join(root, "protected.jsonl");
  const store = new ProtectedJsonStore({ filePath, clock: () => clock.toISOString(), authenticator });
  const options = { now: () => new Date(clock), nonceFactory: () => (++nonce).toString(16).padStart(64, "0") };
  const registry = new DurableContainmentRemoteEvidenceRegistry(store, options);
  const trust: ContainmentRemoteTrustPolicy = {
    schema: "sxsy-b122.containment-remote-trust-policy", version: 1, purpose,
    authorityId, keyId, publicKeyPem, expiresAt: "2026-08-26T12:00:00.000Z"
  };
  await registry.installTrust(trust, "TEST\\Security");
  const repositoryRoot = resolve(root, "repository");
  const request: ContainmentAssessmentRequest = {
    schema: "sxsy-b122.containment-assessment-request", version: 1,
    incidentId: `containment-incident:${"1".repeat(64)}`, repositoryRoot, fenceEpoch: 7, step: "remote",
    operationId: `containment-assessment:${"2".repeat(64)}`,
    externalId: `containment-assessment:${"3".repeat(64)}`,
    egressAllowed: false, revealSecretValues: false
  };
  const binding: ContainmentRemoteEvidenceBinding = {
    request, generation: 3, targetSnapshotId: `target:${"4".repeat(64)}`,
    canonicalRemote: "https://github.com/acme/switchyard.git", policyVersion: "containment-policy-9",
    authorityId, keyId,
    requiredRefs: [
      { ref: "refs/heads/main", expectedHead: "5".repeat(40) },
      { ref: "refs/heads/release", expectedHead: "6".repeat(40) }
    ]
  };
  const challenge = await registry.issueChallenge({ ...binding, expiresAt: "2026-08-25T12:10:00.000Z" }, "TEST\\Security");
  return {
    root, filePath, keys, keyId, publicKeyPem, trust, registry, binding, challenge, options,
    setNow(value: string) { clock = new Date(value); }
  };
}

function passedRefs(challenge: ContainmentRemoteEvidenceChallenge): readonly ContainmentRemoteEvidenceRefResult[] {
  return challenge.requiredRefs.map((item) => ({ ...item, status: "passed", exposure: "none", summary: "Remote ref was assessed.", findings: [] }));
}

function unsigned(
  setupValue: Awaited<ReturnType<typeof setup>>,
  challenge: ContainmentRemoteEvidenceChallenge = setupValue.challenge,
  overrides: Partial<UnsignedContainmentRemoteEvidence> = {}
): UnsignedContainmentRemoteEvidence {
  const evaluatorNonce = "a".repeat(64);
  const base: UnsignedContainmentRemoteEvidence = {
    schema: "sxsy-b122.containment-remote-evidence", version: 1, purpose,
    evidenceId: containmentRemoteEvidenceId(challenge.id, evaluatorNonce, authorityId, setupValue.keyId),
    authorityId, keyId: setupValue.keyId, challenge, evaluatorNonce,
    evaluatedAt: "2026-08-25T12:01:00.000Z", expiresAt: "2026-08-25T12:08:00.000Z",
    status: "passed", exposure: "none", summary: "Every required remote ref was assessed.",
    refResults: passedRefs(challenge), signatureAlgorithm: "ecdsa-p256-sha256"
  };
  return { ...base, ...overrides };
}

async function signedFile(
  setupValue: Awaited<ReturnType<typeof setup>>,
  value: UnsignedContainmentRemoteEvidence,
  key: KeyObject = setupValue.keys.privateKey,
  name = `evidence-${Math.random().toString(16).slice(2)}.json`
): Promise<string> {
  const signature = sign("sha256", containmentRemoteEvidenceSigningPayload(value), key).toString("base64");
  const path = join(setupValue.root, name);
  await writeFile(path, JSON.stringify({ ...value, signature }), "utf8");
  return path;
}

test("signed offline evidence resolves once, consumes once, and survives restart for observation", async (context) => {
  const fixture = await setup(context);
  const source = await signedFile(fixture, unsigned(fixture));
  const imported = await fixture.registry.importEvidence(source, "TEST\\Security");
  assert.equal(imported.status, "available");
  assert.match(imported.documentSha256, /^[a-f0-9]{64}$/);

  const before = await fixture.registry.resolve(fixture.binding);
  assert.equal(before?.status, "passed");
  assert.equal(before?.exposure, "none");
  assert.equal(before?.effectDisposition, "committed");
  assert.deepEqual(before?.findings, []);

  const consumed = await fixture.registry.consume(fixture.binding);
  assert.deepEqual(consumed, before);
  await assert.rejects(fixture.registry.consume(fixture.binding), /consumed|replay/i);
  await assert.rejects(fixture.registry.importEvidence(source, "TEST\\Security"), /challenge.*used|replay/i);

  const restarted = new DurableContainmentRemoteEvidenceRegistry(
    new ProtectedJsonStore({ filePath: fixture.filePath, clock: () => initialNow, authenticator }), fixture.options
  );
  assert.deepEqual(await restarted.resolve(fixture.binding), before);
  assert.equal((await restarted.listChallenges())[0]?.status, "used");
  assert.equal((await restarted.listTrust())[0]?.status, "active");
});

test("racing imports cannot both consume the same durable challenge", async (context) => {
  const fixture = await setup(context);
  const source = await signedFile(fixture, unsigned(fixture), fixture.keys.privateKey, "racing-import.json");
  const results = await Promise.allSettled([
    fixture.registry.importEvidence(source, "TEST\\Security-A"),
    fixture.registry.importEvidence(source, "TEST\\Security-B")
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.equal((await fixture.registry.listEvidence()).length, 1);
  assert.equal((await fixture.registry.listChallenges())[0]?.status, "used");
});

test("every incident, fence, generation, remote-child, target, remote, policy, nonce, time, and ref binding is exact", async (context) => {
  const fixture = await setup(context);
  const mutations: readonly ((challenge: ContainmentRemoteEvidenceChallenge) => ContainmentRemoteEvidenceChallenge)[] = [
    (value) => ({ ...value, incidentId: `containment-incident:${"9".repeat(64)}` }),
    (value) => ({ ...value, repositoryRootDigest: "9".repeat(64) }),
    (value) => ({ ...value, fenceEpoch: value.fenceEpoch + 1 }),
    (value) => ({ ...value, generation: value.generation + 1 }),
    (value) => ({ ...value, remoteOperationId: `containment-assessment:${"8".repeat(64)}` }),
    (value) => ({ ...value, remoteExternalId: `containment-assessment:${"7".repeat(64)}` }),
    (value) => ({ ...value, targetSnapshotId: `target:${"9".repeat(64)}` }),
    (value) => ({ ...value, canonicalRemote: "https://github.com/acme/other.git" }),
    (value) => ({ ...value, policyVersion: "containment-policy-other" }),
    (value) => ({ ...value, challengeNonce: "f".repeat(64) }),
    (value) => ({ ...value, issuedAt: "2026-08-25T12:00:01.000Z" }),
    (value) => ({ ...value, expiresAt: "2026-08-25T12:09:59.000Z" }),
    (value) => ({ ...value, requiredRefs: value.requiredRefs.slice(0, 1) })
  ];
  for (const [index, mutate] of mutations.entries()) {
    const changed = mutate(fixture.challenge);
    const source = await signedFile(fixture, unsigned(fixture, changed, { challenge: changed, refResults: passedRefs(changed) }), fixture.keys.privateKey, `wrong-binding-${index}.json`);
    await assert.rejects(fixture.registry.importEvidence(source, "TEST\\Security"), /challenge|binding|identity/i);
  }
});

test("signature, trusted key identity, purpose, and revocation fail closed", async (context) => {
  const fixture = await setup(context);
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, unsigned(fixture), other.privateKey, "wrong-signature.json"), "TEST\\Security"), /signature/i);

  const otherKeyId = createHash("sha256").update(other.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const wrongKey = unsigned(fixture, fixture.challenge, {
    keyId: otherKeyId,
    evidenceId: containmentRemoteEvidenceId(fixture.challenge.id, "a".repeat(64), authorityId, otherKeyId)
  });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, wrongKey, other.privateKey, "wrong-key.json"), "TEST\\Security"), /authority|key|trust/i);
  await assert.rejects(fixture.registry.installTrust({ ...fixture.trust, keyId: "0".repeat(64) }, "TEST\\Security"), /key ID/i);
  await assert.rejects(fixture.registry.installTrust({ ...fixture.trust, authorityId: "wrong-purpose", purpose: "acceptance" as typeof purpose }, "TEST\\Security"), /purpose/i);
  await assert.rejects(fixture.registry.installTrust({ ...fixture.trust, authorityId: "expired-authority", expiresAt: initialNow }, "TEST\\Security"), /expired/i);

  await fixture.registry.revokeTrust(authorityId, fixture.keyId, "rotation", "TEST\\Security");
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, unsigned(fixture), fixture.keys.privateKey, "revoked.json"), "TEST\\Security"), /revoked|trust|authority/i);
  assert.equal((await fixture.registry.listTrust())[0]?.status, "revoked");
});

test("revocation after import invalidates available evidence before its only consumption", async (context) => {
  const fixture = await setup(context);
  await fixture.registry.importEvidence(await signedFile(fixture, unsigned(fixture), fixture.keys.privateKey, "before-revocation.json"), "TEST\\Security");
  assert.equal((await fixture.registry.resolve(fixture.binding))?.status, "passed");
  await fixture.registry.revokeTrust(authorityId, fixture.keyId, "authority withdrawn", "TEST\\Security");
  assert.equal(await fixture.registry.resolve(fixture.binding), undefined);
  await assert.rejects(fixture.registry.consume(fixture.binding), /revoked|unavailable/i);
});

test("expired, stale, and future-dated evidence cannot satisfy a live challenge", async (context) => {
  const fixture = await setup(context);
  fixture.setNow("2026-08-25T12:11:00.000Z");
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, unsigned(fixture), fixture.keys.privateKey, "expired.json"), "TEST\\Security"), /expired|fresh/i);

  const second = await setup(context);
  const future = unsigned(second, second.challenge, {
    evaluatedAt: "2026-08-25T12:06:00.000Z",
    expiresAt: "2026-08-25T12:09:00.000Z"
  });
  await assert.rejects(second.registry.importEvidence(await signedFile(second, future, second.keys.privateKey, "future.json"), "TEST\\Security"), /future|fresh/i);

  const sameNonce = unsigned(second, second.challenge, {
    evaluatorNonce: second.challenge.challengeNonce,
    evidenceId: containmentRemoteEvidenceId(second.challenge.id, second.challenge.challengeNonce, authorityId, second.keyId)
  });
  await assert.rejects(second.registry.importEvidence(await signedFile(second, sameNonce, second.keys.privateKey, "same-nonce.json"), "TEST\\Security"), /independent.*nonce/i);
});

test("required remote refs must have exact complete coverage and immutable expected heads", async (context) => {
  const fixture = await setup(context);
  const complete = passedRefs(fixture.challenge);
  const partial = unsigned(fixture, fixture.challenge, { refResults: complete.slice(0, 1) });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, partial, fixture.keys.privateKey, "partial.json"), "TEST\\Security"), /coverage|refs/i);

  const changedHead = [{ ...complete[0]!, expectedHead: "b".repeat(40) }, complete[1]!];
  const drifted = unsigned(fixture, fixture.challenge, { refResults: changedHead });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, drifted, fixture.keys.privateKey, "head-drift.json"), "TEST\\Security"), /coverage|head|refs/i);
});

test("path traversal, relative imports, and oversized evidence documents are rejected", async (context) => {
  const fixture = await setup(context);
  const refs: readonly ContainmentRemoteEvidenceRefResult[] = [
    { ...fixture.challenge.requiredRefs[0]!, status: "failed", exposure: "found", summary: "finding", findings: [{ relativePath: "../secret.txt", credentialRelated: true }] },
    { ...fixture.challenge.requiredRefs[1]!, status: "passed", exposure: "none", summary: "clean", findings: [] }
  ];
  const traversing = unsigned(fixture, fixture.challenge, { status: "failed", exposure: "found", refResults: refs });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, traversing, fixture.keys.privateKey, "traversal.json"), "TEST\\Security"), /path|repository boundary/i);
  await assert.rejects(fixture.registry.importEvidence("relative-evidence.json", "TEST\\Security"), /absolute|fixed/i);

  const oversized = join(fixture.root, "oversized.json");
  await writeFile(oversized, "x".repeat(256 * 1024 + 1), "utf8");
  await assert.rejects(fixture.registry.importEvidence(oversized, "TEST\\Security"), /oversized|size/i);
});

test("top-level and per-ref result contradictions are rejected instead of hiding partial truth", async (context) => {
  const fixture = await setup(context);
  const finding = { relativePath: "config/credential.txt", credentialRelated: true };
  const exposed: readonly ContainmentRemoteEvidenceRefResult[] = [
    { ...fixture.challenge.requiredRefs[0]!, status: "failed", exposure: "found", summary: "found", findings: [finding] },
    { ...fixture.challenge.requiredRefs[1]!, status: "passed", exposure: "none", summary: "clean", findings: [] }
  ];
  const wrongOverall = unsigned(fixture, fixture.challenge, { status: "passed", exposure: "none", refResults: exposed });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, wrongOverall, fixture.keys.privateKey, "wrong-overall.json"), "TEST\\Security"), /inconsistent|result/i);

  const contradictory = [{ ...exposed[0]!, status: "passed" as const }, exposed[1]!];
  const wrongRef = unsigned(fixture, fixture.challenge, { status: "failed", exposure: "found", refResults: contradictory });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, wrongRef, fixture.keys.privateKey, "wrong-ref.json"), "TEST\\Security"), /inconsistent|result/i);

  const partialTruth: readonly ContainmentRemoteEvidenceRefResult[] = [
    exposed[0]!,
    { ...fixture.challenge.requiredRefs[1]!, status: "unavailable", exposure: "unknown", summary: "unknown", findings: [] }
  ];
  const hiddenUnknown = unsigned(fixture, fixture.challenge, { status: "failed", exposure: "found", refResults: partialTruth });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, hiddenUnknown, fixture.keys.privateKey, "hidden-unknown.json"), "TEST\\Security"), /partial|inconsistent|unknown/i);

  const openSchemaPath = await signedFile(fixture, unsigned(fixture), fixture.keys.privateKey, "open-schema.json");
  const openSchema = JSON.parse(await readFile(openSchemaPath, "utf8")) as Record<string, unknown>;
  openSchema.networkAllowed = true;
  await writeFile(openSchemaPath, JSON.stringify(openSchema), "utf8");
  await assert.rejects(fixture.registry.importEvidence(openSchemaPath, "TEST\\Security"), /open or incomplete schema/i);
});

test("findings are host-derived, generation-scoped, and redacted before protected persistence", async (context) => {
  const fixture = await setup(context);
  const failedRefs = (challenge: ContainmentRemoteEvidenceChallenge): readonly ContainmentRemoteEvidenceRefResult[] => [
    { ...challenge.requiredRefs[0]!, status: "failed", exposure: "found", summary: "token=supersecretvalue", findings: [{ relativePath: "config/credential.txt", credentialRelated: true }] },
    { ...challenge.requiredRefs[1]!, status: "passed", exposure: "none", summary: "clean", findings: [] }
  ];
  const first = unsigned(fixture, fixture.challenge, { status: "failed", exposure: "found", summary: "token=supersecretvalue", refResults: failedRefs(fixture.challenge) });
  await fixture.registry.importEvidence(await signedFile(fixture, first, fixture.keys.privateKey, "generation-3.json"), "TEST\\Security");
  const firstResult = await fixture.registry.resolve(fixture.binding);
  assert.equal(firstResult?.status, "failed");
  assert.match(firstResult?.summary ?? "", /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(await fixture.registry.listEvidence()), /supersecretvalue/);
  assert.doesNotMatch(await readFile(fixture.filePath, "utf8"), /supersecretvalue/);
  const firstFinding = firstResult?.findings[0];
  assert.match(firstFinding?.id ?? "", /^containment-finding:[a-f0-9]{64}$/);

  const nextRequest = {
    ...fixture.binding.request,
    operationId: `containment-assessment:${"7".repeat(64)}`,
    externalId: `containment-assessment:${"8".repeat(64)}`
  };
  const nextBinding: ContainmentRemoteEvidenceBinding = { ...fixture.binding, request: nextRequest, generation: 4 };
  const nextChallenge = await fixture.registry.issueChallenge({ ...nextBinding, expiresAt: "2026-08-25T12:10:00.000Z" }, "TEST\\Security");
  const next = unsigned(fixture, nextChallenge, {
    challenge: nextChallenge,
    evidenceId: containmentRemoteEvidenceId(nextChallenge.id, "a".repeat(64), authorityId, fixture.keyId),
    status: "failed", exposure: "found", summary: "same path", refResults: failedRefs(nextChallenge)
  });
  await fixture.registry.importEvidence(await signedFile(fixture, next, fixture.keys.privateKey, "generation-4.json"), "TEST\\Security");
  const nextFinding = (await fixture.registry.resolve(nextBinding))?.findings[0];
  assert.notEqual(nextFinding?.id, firstFinding?.id);
});

test("the administration boundary requires current-user presence for trust and evidence transitions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-containment-remote-admin-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = createHash("sha256").update(keys.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const policy = { schema: "sxsy-b122.containment-remote-trust-policy", version: 1, purpose, authorityId, keyId, publicKeyPem, expiresAt: "2026-08-26T12:00:00.000Z" };
  const policyPath = join(root, "trust.json");
  await writeFile(policyPath, JSON.stringify(policy), "utf8");
  assert.throws(() => new DurableContainmentRemoteEvidenceRegistry(new ProtectedJsonStore({ filePath: join(root, "unprotected.jsonl") })), /authenticated.*storage/i);
  const registry = new DurableContainmentRemoteEvidenceRegistry(new ProtectedJsonStore({ filePath: join(root, "protected.jsonl"), authenticator }), { now: () => new Date(initialNow) });
  const administration = createContainmentRemoteEvidenceAdministration({ registry, presence: { async verify() { return { verified: false }; } } });
  await assert.rejects(administration.installTrustPolicy(policyPath), /presence|approve/i);
  assert.deepEqual(await registry.listTrust(), []);
});
