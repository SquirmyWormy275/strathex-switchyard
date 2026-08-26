import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import type { ContainmentAssessmentRequest } from "../../../packages/control-plane/src/containment-incidents.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  DurableContainmentRemoteEvidenceRegistry,
  containmentRemoteDetectorManifest,
  containmentRemoteEvidenceId,
  containmentRemoteEvidenceSigningPayload,
  containmentRemoteNamespaceDigest,
  containmentRemoteResultForNoConfiguredRemotes,
  createContainmentRemoteEvidenceAdministration,
  type ContainmentRemoteEvidenceBinding,
  type ContainmentRemoteEvidenceChallenge,
  type ContainmentRemoteEvidenceRefResult,
  type ContainmentRemoteNamespaceResult,
  type ContainmentRemoteTrustPolicy,
  type UnsignedContainmentRemoteEvidence
} from "../src/containment-remote-evidence.ts";

const initialNow = "2026-08-25T12:00:00.000Z";
const authorityId = "independent-remote-auditor";
const purpose = "containment-remote-assessment" as const;
const gitExecutableSha256 = "f".repeat(64);
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
    schema: "sxsy-b122.containment-remote-trust-policy", version: 2, purpose,
    authorityId, keyId, publicKeyPem, gitExecutableSha256,
    detectorManifestId: containmentRemoteDetectorManifest.id,
    networkPolicy: "public-https-dns-pinned-no-redirect-v1",
    expiresAt: "2026-08-26T12:00:00.000Z"
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
    policyVersion: "containment-policy-9", authorityId, keyId,
    configuredRemotes: [
      { name: "origin", canonicalIdentity: "https://github.com/acme/switchyard.git" },
      { name: "upstream", canonicalIdentity: "https://github.com/upstream/switchyard.git" }
    ]
  };
  const challenge = await registry.issueChallenge({ ...binding, expiresAt: "2026-08-25T12:10:00.000Z" }, "TEST\\Security");
  return {
    root, filePath, keys, keyId, publicKeyPem, trust, registry, binding, challenge, options,
    setNow(value: string) { clock = new Date(value); }
  };
}

function namespace(
  remote: ContainmentRemoteEvidenceChallenge["configuredRemotes"][number],
  refs: readonly Readonly<{ ref: string; head: string }>[]
): ContainmentRemoteNamespaceResult {
  const namespaceRefs = refs.map((item) => ({ ...item }));
  const refResults: readonly ContainmentRemoteEvidenceRefResult[] = refs.map((item) => ({
    ...item, status: "passed", exposure: "none", summary: "Ref was assessed.", findings: []
  }));
  return {
    ...remote, namespaceComplete: true, refCount: namespaceRefs.length,
    namespaceSha256: containmentRemoteNamespaceDigest(namespaceRefs),
    namespaceRefs, status: "passed", exposure: "none", summary: "Complete namespace assessed.", refResults
  };
}

function completeNamespaces(challenge: ContainmentRemoteEvidenceChallenge): readonly ContainmentRemoteNamespaceResult[] {
  return [
    namespace(challenge.configuredRemotes[0]!, [
      { ref: "refs/heads/main", head: "5".repeat(40) },
      { ref: "refs/pull/22/head", head: "7".repeat(40) },
      { ref: "refs/tags/v1.0.0", head: "6".repeat(40) }
    ]),
    namespace(challenge.configuredRemotes[1]!, [])
  ];
}

function unsigned(
  fixture: Awaited<ReturnType<typeof setup>>,
  challenge: ContainmentRemoteEvidenceChallenge = fixture.challenge,
  overrides: Partial<UnsignedContainmentRemoteEvidence> = {}
): UnsignedContainmentRemoteEvidence {
  const evaluatorNonce = "a".repeat(64);
  const base: UnsignedContainmentRemoteEvidence = {
    schema: "sxsy-b122.containment-remote-evidence", version: 3, purpose,
    evidenceId: containmentRemoteEvidenceId(challenge.id, evaluatorNonce, authorityId, fixture.keyId),
    authorityId, keyId: fixture.keyId, challenge, evaluatorNonce,
    evaluatedAt: "2026-08-25T12:01:00.000Z", expiresAt: "2026-08-25T12:08:00.000Z",
    namespaceComplete: true, status: "passed", exposure: "none",
    summary: "Every configured remote namespace was completely assessed.",
    toolManifest: {
      schema: "sxsy-b122.containment-remote-tool-manifest", version: 1,
      detectorManifest: containmentRemoteDetectorManifest, gitExecutableSha256,
      gitVersion: "git version 2.51.0", evaluationProfile: challenge.evaluationProfile,
      networkPolicy: challenge.networkPolicy,
      networkBindings: challenge.configuredRemotes.map((remote) => ({
        remoteName: remote.name, hostname: new URL(remote.canonicalIdentity).hostname, port: 443 as const,
        addresses: ["140.82.112.4"]
      }))
    },
    remoteResults: completeNamespaces(challenge), signatureAlgorithm: "ecdsa-p256-sha256"
  };
  return { ...base, ...overrides };
}

async function signedFile(
  fixture: Awaited<ReturnType<typeof setup>>,
  value: UnsignedContainmentRemoteEvidence,
  key: KeyObject = fixture.keys.privateKey,
  name = `evidence-${Math.random().toString(16).slice(2)}.json`
): Promise<string> {
  const signature = sign("sha256", containmentRemoteEvidenceSigningPayload(value), key).toString("base64");
  const path = join(fixture.root, name);
  await writeFile(path, JSON.stringify({ ...value, signature }), "utf8");
  return path;
}

test("complete multi-remote evidence includes an empty namespace and has a durable release proof", async (context) => {
  const fixture = await setup(context);
  const imported = await fixture.registry.importEvidence(await signedFile(fixture, unsigned(fixture)), "TEST\\Security");
  assert.equal(imported.status, "available");
  assert.match(imported.documentSha256, /^[a-f0-9]{64}$/);
  const available = await fixture.registry.observe(fixture.binding);
  assert.equal(available.state, "available");
  assert.equal(available.result?.status, "passed");
  assert.deepEqual(available.result?.findings, []);
  const consumed = await fixture.registry.consume(fixture.binding);
  assert.equal(consumed?.status, "passed");
  const observation = await fixture.registry.observe(fixture.binding);
  assert.equal(observation.state, "consumed");
  assert.deepEqual(observation.result, consumed);
  const release = await fixture.registry.validateConsumedForRelease(fixture.binding);
  assert.equal(release.evidenceId, imported.evidenceId);
  assert.equal(release.challengeId, fixture.challenge.id);
  assert.equal(release.generation, fixture.binding.generation);
  assert.equal(release.targetSnapshotId, fixture.binding.targetSnapshotId);
  assert.equal(release.remoteOperationId, fixture.binding.request.operationId);
  assert.equal(release.remoteExternalId, fixture.binding.request.externalId);
  assert.deepEqual(release.configuredRemotes, fixture.challenge.configuredRemotes);
});

test("zero configured remotes is an explicit clean host result and cannot issue evidence", async (context) => {
  const fixture = await setup(context);
  const binding = { ...fixture.binding, configuredRemotes: [] };
  const clean = containmentRemoteResultForNoConfiguredRemotes(binding);
  assert.equal(clean.status, "passed");
  assert.equal(clean.exposure, "none");
  assert.deepEqual(clean.findings, []);
  assert.deepEqual(await fixture.registry.resolve(binding), clean);
  assert.deepEqual(await fixture.registry.consume(binding), clean);
  await assert.rejects(fixture.registry.issueChallenge({ ...binding, expiresAt: "2026-08-25T12:10:00.000Z" }, "TEST\\Security"), /no configured remotes|not require.*evidence/i);
  await assert.rejects(fixture.registry.validateConsumedForRelease(binding), /no configured remotes|signed.*not required/i);
});

test("configured remote identity coverage is exact, complete, and duplicate-free", async (context) => {
  const fixture = await setup(context);
  const complete = completeNamespaces(fixture.challenge);
  const cases: readonly Readonly<{ name: string; results: readonly ContainmentRemoteNamespaceResult[] }>[] = [
    { name: "omitted-remote", results: complete.slice(0, 1) },
    { name: "extra-remote", results: [...complete, namespace({ name: "other", canonicalIdentity: "https://github.com/acme/other.git" }, [])] },
    { name: "duplicate-remote", results: [complete[0]!, complete[0]!] },
    { name: "changed-identity", results: [{ ...complete[0]!, canonicalIdentity: "https://github.com/acme/other.git" }, complete[1]!] }
  ];
  for (const item of cases) {
    const value = unsigned(fixture, fixture.challenge, { remoteResults: item.results });
    await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, value, fixture.keys.privateKey, `${item.name}.json`), "TEST\\Security"), /coverage|duplicate|configured remote|identity/i);
  }
  const duplicateBinding = { ...fixture.binding, configuredRemotes: [fixture.binding.configuredRemotes[0]!, fixture.binding.configuredRemotes[0]!] };
  await assert.rejects(fixture.registry.issueChallenge({ ...duplicateBinding, expiresAt: "2026-08-25T12:10:00.000Z" }, "TEST\\Security"), /duplicate/i);
});

test("each signed complete namespace rejects omitted, extra, duplicate, and head-drifted ref assessments", async (context) => {
  const fixture = await setup(context);
  const complete = completeNamespaces(fixture.challenge);
  const origin = complete[0]!;
  const extraRef = { ref: "refs/heads/new", head: "7".repeat(40), status: "passed" as const, exposure: "none" as const, summary: "new", findings: [] };
  const variants: readonly Readonly<{ name: string; remote: ContainmentRemoteNamespaceResult }>[] = [
    { name: "omitted-ref", remote: { ...origin, refResults: origin.refResults.slice(0, 1) } },
    { name: "extra-ref", remote: { ...origin, refResults: [...origin.refResults, extraRef] } },
    { name: "duplicate-result-ref", remote: { ...origin, refResults: [origin.refResults[0]!, origin.refResults[0]!] } },
    { name: "head-drift", remote: { ...origin, refResults: [{ ...origin.refResults[0]!, head: "8".repeat(40) }, origin.refResults[1]!] } },
    { name: "duplicate-namespace-ref", remote: { ...origin, namespaceRefs: [origin.namespaceRefs[0]!, origin.namespaceRefs[0]!] } },
    { name: "wrong-count", remote: { ...origin, refCount: origin.refCount + 1 } },
    { name: "wrong-digest", remote: { ...origin, namespaceSha256: "9".repeat(64) } },
    { name: "not-complete", remote: { ...origin, namespaceComplete: false as true } }
  ];
  for (const item of variants) {
    const value = unsigned(fixture, fixture.challenge, { remoteResults: [item.remote, complete[1]!] });
    await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, value, fixture.keys.privateKey, `${item.name}.json`), "TEST\\Security"), /namespace|coverage|duplicate|head|complete|count|digest/i);
  }
});

test("post-consume expiry invalidates resolution and release without replaying the effect", async (context) => {
  const fixture = await setup(context);
  await fixture.registry.importEvidence(await signedFile(fixture, unsigned(fixture), fixture.keys.privateKey, "expiry.json"), "TEST\\Security");
  await fixture.registry.consume(fixture.binding);
  fixture.setNow("2026-08-25T12:09:00.000Z");
  assert.equal(await fixture.registry.resolve(fixture.binding), undefined);
  assert.equal((await fixture.registry.observe(fixture.binding)).state, "invalid");
  await assert.rejects(fixture.registry.validateConsumedForRelease(fixture.binding), /expired|invalid|unavailable/i);
  await assert.rejects(fixture.registry.consume(fixture.binding), /expired|unavailable/i);
});

test("post-consume trust revocation invalidates resolution and release", async (context) => {
  const fixture = await setup(context);
  await fixture.registry.importEvidence(await signedFile(fixture, unsigned(fixture), fixture.keys.privateKey, "revocation.json"), "TEST\\Security");
  await fixture.registry.consume(fixture.binding);
  await fixture.registry.revokeTrust(authorityId, fixture.keyId, "authority withdrawn", "TEST\\Security");
  assert.equal(await fixture.registry.resolve(fixture.binding), undefined);
  assert.equal((await fixture.registry.observe(fixture.binding)).state, "invalid");
  await assert.rejects(fixture.registry.validateConsumedForRelease(fixture.binding), /revoked|invalid|unavailable/i);
  await assert.rejects(fixture.registry.consume(fixture.binding), /revoked|unavailable/i);
});

test("generation, target, child, fence, policy, and remote-set drift cannot select consumed evidence", async (context) => {
  const fixture = await setup(context);
  await fixture.registry.importEvidence(await signedFile(fixture, unsigned(fixture), fixture.keys.privateKey, "drift.json"), "TEST\\Security");
  await fixture.registry.consume(fixture.binding);
  const mutations: readonly ((binding: ContainmentRemoteEvidenceBinding) => ContainmentRemoteEvidenceBinding)[] = [
    (value) => ({ ...value, generation: value.generation + 1 }),
    (value) => ({ ...value, targetSnapshotId: `target:${"9".repeat(64)}` }),
    (value) => ({ ...value, request: { ...value.request, operationId: `containment-assessment:${"8".repeat(64)}` } }),
    (value) => ({ ...value, request: { ...value.request, externalId: `containment-assessment:${"7".repeat(64)}` } }),
    (value) => ({ ...value, request: { ...value.request, fenceEpoch: value.request.fenceEpoch + 1 } }),
    (value) => ({ ...value, policyVersion: "containment-policy-10" }),
    (value) => ({ ...value, configuredRemotes: value.configuredRemotes.slice(0, 1) })
  ];
  for (const mutate of mutations) {
    const drifted = mutate(fixture.binding);
    assert.equal(await fixture.registry.resolve(drifted), undefined);
    await assert.rejects(fixture.registry.validateConsumedForRelease(drifted), /consumed|exact|binding|absent/i);
  }
});

test("a crash after durable consumption is read-only reconcilable after restart and cannot consume twice", async (context) => {
  const fixture = await setup(context);
  await fixture.registry.importEvidence(await signedFile(fixture, unsigned(fixture), fixture.keys.privateKey, "crash.json"), "TEST\\Security");
  const first = await fixture.registry.consume(fixture.binding);
  const restarted = new DurableContainmentRemoteEvidenceRegistry(new ProtectedJsonStore({ filePath: fixture.filePath, clock: () => initialNow, authenticator }), fixture.options);
  const observed = await restarted.observe(fixture.binding);
  assert.equal(observed.state, "consumed");
  assert.deepEqual(observed.result, first);
  assert.deepEqual(await restarted.resolve(fixture.binding), first);
  await assert.rejects(restarted.consume(fixture.binding), /consumed|replay/i);
  assert.equal((await restarted.listEvidence())[0]?.status, "consumed");
});

test("signature, challenge identity, freshness, and one-use import fail closed", async (context) => {
  const fixture = await setup(context);
  const wrong = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, unsigned(fixture), wrong.privateKey, "wrong-signature.json"), "TEST\\Security"), /signature/i);
  const changedChallenge = { ...fixture.challenge, generation: fixture.challenge.generation + 1 };
  const changed = unsigned(fixture, changedChallenge, { challenge: changedChallenge, evidenceId: containmentRemoteEvidenceId(changedChallenge.id, "a".repeat(64), authorityId, fixture.keyId), remoteResults: completeNamespaces(changedChallenge) });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, changed, fixture.keys.privateKey, "changed-challenge.json"), "TEST\\Security"), /challenge|identity|binding/i);
  const source = await signedFile(fixture, unsigned(fixture), fixture.keys.privateKey, "one-use.json");
  await fixture.registry.importEvidence(source, "TEST\\Security");
  await assert.rejects(fixture.registry.importEvidence(source, "TEST\\Security"), /used|replay/i);
  const expired = await setup(context);
  expired.setNow("2026-08-25T12:11:00.000Z");
  await assert.rejects(expired.registry.importEvidence(await signedFile(expired, unsigned(expired), expired.keys.privateKey, "expired.json"), "TEST\\Security"), /expired|fresh/i);
});

test("tool, detector, redacted-path, legacy trust, and non-public remote policy drift fail closed", async (context) => {
  const fixture = await setup(context);
  const differentTool = unsigned(fixture, fixture.challenge, {
    toolManifest: { ...unsigned(fixture).toolManifest, gitExecutableSha256: "e".repeat(64) }
  });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, differentTool, fixture.keys.privateKey, "wrong-tool.json"), "TEST\\Security"), /tool manifest|policy binding|Git executable/i);

  const wrongNetwork = unsigned(fixture, fixture.challenge, {
    toolManifest: {
      ...unsigned(fixture).toolManifest,
      networkBindings: unsigned(fixture).toolManifest.networkBindings.map((binding, index) => index === 0 ? { ...binding, hostname: "attacker.example" } : binding)
    }
  });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, wrongNetwork, fixture.keys.privateKey, "wrong-network.json"), "TEST\\Security"), /network coverage|configured-remote/i);

  const detectorDrift = unsigned(fixture, fixture.challenge, {
    toolManifest: {
      ...unsigned(fixture).toolManifest,
      detectorManifest: { ...containmentRemoteDetectorManifest, detectors: ["credential-assignment"] }
    } as unknown as UnsignedContainmentRemoteEvidence["toolManifest"]
  });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, detectorDrift, fixture.keys.privateKey, "wrong-detector.json"), "TEST\\Security"), /detector manifest|unsupported|incomplete/i);

  const patternDrift = unsigned(fixture, fixture.challenge, {
    toolManifest: {
      ...unsigned(fixture).toolManifest,
      detectorManifest: {
        ...containmentRemoteDetectorManifest,
        patterns: [...containmentRemoteDetectorManifest.patterns.slice(0, -1), "Bearer[[:space:]]+.*"]
      }
    } as unknown as UnsignedContainmentRemoteEvidence["toolManifest"]
  });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, patternDrift, fixture.keys.privateKey, "wrong-pattern.json"), "TEST\\Security"), /detector manifest|unsupported|incomplete/i);

  const namespaces = completeNamespaces(fixture.challenge);
  const pathSha256 = createHash("sha256").update("secret-name.txt").digest("hex");
  const badFinding = {
    ...namespaces[0]!.refResults[0]!, status: "failed" as const, exposure: "found" as const,
    findings: [{ relativePath: `redacted/${"0".repeat(64)}`, pathSha256, credentialRelated: true }]
  };
  const badRemote = { ...namespaces[0]!, status: "failed" as const, exposure: "found" as const, refResults: [badFinding, namespaces[0]!.refResults[1]!] };
  const badPath = unsigned(fixture, fixture.challenge, { status: "failed", exposure: "found", remoteResults: [badRemote, namespaces[1]!] });
  await assert.rejects(fixture.registry.importEvidence(await signedFile(fixture, badPath, fixture.keys.privateKey, "bad-redaction.json"), "TEST\\Security"), /redacted path digest|finding path/i);

  const legacyRoot = await mkdtemp(join(tmpdir(), "sxsy-containment-legacy-trust-"));
  context.after(async () => { await rm(legacyRoot, { recursive: true, force: true }); });
  const legacyRegistry = new DurableContainmentRemoteEvidenceRegistry(new ProtectedJsonStore({ filePath: join(legacyRoot, "protected.jsonl"), authenticator }), { now: () => new Date(initialNow) });
  await assert.rejects(legacyRegistry.installTrust({
    schema: "sxsy-b122.containment-remote-trust-policy", version: 1, purpose,
    authorityId, keyId: fixture.keyId, publicKeyPem: fixture.publicKeyPem,
    expiresAt: "2026-08-26T12:00:00.000Z"
  }, "TEST\\Security"), /schema|detector|network policy/i);

  await assert.rejects(fixture.registry.issueChallenge({
    ...fixture.binding, configuredRemotes: [{ name: "private", canonicalIdentity: "https://127.0.0.1/repository.git" }],
    expiresAt: "2026-08-25T12:09:00.000Z"
  }, "TEST\\Security"), /public HTTPS|credential-free|port 443/i);
  await assert.rejects(fixture.registry.issueChallenge({
    ...fixture.binding, configuredRemotes: [{ name: "credentialed", canonicalIdentity: "https://user:secret@example.com/repository.git" }],
    expiresAt: "2026-08-25T12:09:00.000Z"
  }, "TEST\\Security"), /credential|canonical remote/i);
});

test("findings are generation-scoped and summaries are redacted before protected persistence", async (context) => {
  const fixture = await setup(context);
  const remotes = completeNamespaces(fixture.challenge);
  const pathSha256 = createHash("sha256").update("config/credential.txt").digest("hex");
  const exposedRef = { ...remotes[0]!.refResults[0]!, status: "failed" as const, exposure: "found" as const, summary: "token=supersecretvalue", findings: [{ relativePath: `redacted/${pathSha256}`, pathSha256, credentialRelated: true }] };
  const failedOrigin: ContainmentRemoteNamespaceResult = { ...remotes[0]!, status: "failed", exposure: "found", summary: "token=supersecretvalue", refResults: [exposedRef, ...remotes[0]!.refResults.slice(1)] };
  const value = unsigned(fixture, fixture.challenge, { status: "failed", exposure: "found", summary: "token=supersecretvalue", remoteResults: [failedOrigin, remotes[1]!] });
  await fixture.registry.importEvidence(await signedFile(fixture, value, fixture.keys.privateKey, "redaction.json"), "TEST\\Security");
  const result = await fixture.registry.resolve(fixture.binding);
  assert.equal(result?.status, "failed");
  assert.match(result?.summary ?? "", /\[REDACTED\]/);
  assert.match(result?.findings[0]?.id ?? "", /^containment-finding:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(await fixture.registry.listEvidence()), /supersecretvalue/);
  assert.doesNotMatch(await readFile(fixture.filePath, "utf8"), /supersecretvalue/);
  await fixture.registry.consume(fixture.binding);
  await assert.rejects(fixture.registry.validateConsumedForRelease(fixture.binding), /not a clean|release result/i);
});

test("the administration boundary requires current-user presence for every state transition", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-containment-remote-admin-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = createHash("sha256").update(keys.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const policy = {
    schema: "sxsy-b122.containment-remote-trust-policy", version: 2, purpose, authorityId, keyId, publicKeyPem,
    gitExecutableSha256, detectorManifestId: containmentRemoteDetectorManifest.id,
    networkPolicy: "public-https-dns-pinned-no-redirect-v1", expiresAt: "2026-08-26T12:00:00.000Z"
  } as const;
  const policyPath = join(root, "trust.json");
  await writeFile(policyPath, JSON.stringify(policy), "utf8");
  assert.throws(() => new DurableContainmentRemoteEvidenceRegistry(new ProtectedJsonStore({ filePath: join(root, "unprotected.jsonl") })), /authenticated.*storage/i);
  const registry = new DurableContainmentRemoteEvidenceRegistry(new ProtectedJsonStore({ filePath: join(root, "protected.jsonl"), authenticator }), { now: () => new Date(initialNow) });
  const administration = createContainmentRemoteEvidenceAdministration({ registry, presence: { async verify() { return { verified: false }; } } });
  await assert.rejects(administration.installTrustPolicy(policyPath), /presence|approve/i);
  assert.deepEqual(await registry.listTrust(), []);
});
