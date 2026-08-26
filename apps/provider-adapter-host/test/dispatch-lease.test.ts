import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import {
  ProviderDispatchLeaseAuthority,
  signProviderDispatchLease,
  type ProviderDispatchLeaseExpectation,
  type ProviderDispatchLeaseUnsigned
} from "../src/dispatch-lease.ts";
import { createProviderHostStore } from "../src/state.ts";

const leaseKey = "c".repeat(64);
const now = "2026-08-25T12:00:00.000Z";
const host = {
  configurationSha256: "1".repeat(64),
  lifecycleNonceSha256: "2".repeat(64),
  tlsSpkiSha256: "3".repeat(64)
} as const;
const moduleIdentity = { adapterId: "sxsy-b122.fixture.codex", moduleSha256: "4".repeat(64) } as const;
const targetIdentity = {
  repositoryRoot: "C:\\repo", canonicalRemote: "https://github.com/acme/repo.git",
  branch: "feature/provider-host", defaultBranch: "main", upstream: "origin/feature/provider-host",
  head: "6".repeat(40), indexTree: "7".repeat(40), trackedManifest: "8".repeat(64), untrackedManifest: "9".repeat(64),
  submodules: {}, policyVersion: "policy-v1", environmentFingerprint: "a".repeat(64),
  completeness: "complete", reasons: []
} as const;
const target = { id: targetSnapshotDigest(targetIdentity), ...targetIdentity, detached: false, capturedAt: now } as const;
const session = {
  id: "codex-session", provider: "codex", taskId: "task-provider-host", planRevision: "plan-1", adapterVersion: "fixture-codex-v1"
} as const;
const artifact = {
  id: "artifact-proof-1", digest: "b".repeat(64), coordinatorContextDigest: "d".repeat(64), coordinatorContextRevision: 3
} as const;
const confirmation = { digest: "e".repeat(64), scopeDigest: "f".repeat(64) } as const;

function unsigned(nonce = "0".repeat(64)): ProviderDispatchLeaseUnsigned {
  return {
    schema: "sxsy-b122.provider-dispatch-lease", version: 1,
    leaseId: "lease-provider-proof-1", nonce, issuedAt: now, expiresAt: "2026-08-25T12:00:30.000Z",
    authority: { id: "authority-provider-host", grantDigest: "1".repeat(64), scopeDigest: "2".repeat(64), expiresAt: "2026-08-25T12:01:00.000Z" },
    target, session,
    dispatch: { routeId: "provider.proof", action: "proof", operationId: "operation-proof-1" },
    artifact, confirmation,
    containment: { status: "clear", bindingDigest: "3".repeat(64), fenceEpoch: 7, activationOperationId: null },
    host, module: moduleIdentity
  };
}

function expectation(overrides: Partial<ProviderDispatchLeaseExpectation> = {}): ProviderDispatchLeaseExpectation {
  return {
    provider: "codex", routeId: "provider.proof", action: "proof", operationId: "operation-proof-1",
    authorityId: "authority-provider-host", target, session, artifact, confirmation, module: moduleIdentity,
    ...overrides
  };
}

test("dispatch leases are exact, cross-bound, atomically single-use, and restart durable", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-dispatch-lease-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const stateFile = join(root, "state.jsonl");
  const signed = signProviderDispatchLease(unsigned(), leaseKey);
  const authority = new ProviderDispatchLeaseAuthority({
    authenticationKey: leaseKey, store: createProviderHostStore(stateFile, "9".repeat(64)), host, now: () => now
  });

  await assert.rejects(() => authority.consume({ ...signed, unexpected: true }, expectation()), /schema|field|exact/i);
  await assert.rejects(() => authority.consume({ ...signed, authenticationTag: "0".repeat(64) }, expectation()), /authentication/i);
  await assert.rejects(() => authority.consume(signed, expectation({ operationId: "operation-other" })), /binding/i);
  const consumed = await authority.consume(signed, expectation());
  assert.equal(consumed.leaseId, signed.leaseId);
  await assert.rejects(() => authority.consume(signed, expectation()), /consumed|replay/i);

  const restarted = new ProviderDispatchLeaseAuthority({
    authenticationKey: leaseKey, store: createProviderHostStore(stateFile, "9".repeat(64)), host, now: () => now
  });
  await assert.rejects(() => restarted.consume(signed, expectation()), /consumed|replay/i);
});

test("dispatch leases reject expiry, future issuance, host churn, target churn, and cross-module reuse before consumption", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-dispatch-binding-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const authority = new ProviderDispatchLeaseAuthority({
    authenticationKey: leaseKey, store: createProviderHostStore(join(root, "state.jsonl"), "9".repeat(64)), host, now: () => now
  });

  const expired = signProviderDispatchLease({ ...unsigned("1".repeat(64)), issuedAt: "2026-08-25T11:59:00.000Z", expiresAt: "2026-08-25T11:59:30.000Z" }, leaseKey);
  await assert.rejects(() => authority.consume(expired, expectation()), /expired|validity/i);
  const future = signProviderDispatchLease({ ...unsigned("2".repeat(64)), issuedAt: "2026-08-25T12:00:10.000Z", expiresAt: "2026-08-25T12:00:40.000Z" }, leaseKey);
  await assert.rejects(() => authority.consume(future, expectation()), /future|validity/i);
  const wrongHost = signProviderDispatchLease({ ...unsigned("3".repeat(64)), host: { ...host, configurationSha256: "f".repeat(64) } }, leaseKey);
  await assert.rejects(() => authority.consume(wrongHost, expectation()), /host|binding/i);
  const exact = signProviderDispatchLease(unsigned("4".repeat(64)), leaseKey);
  await assert.rejects(() => authority.consume(exact, expectation({ target: { ...target, head: "0".repeat(40) } })), /target|binding/i);
  await assert.rejects(() => authority.consume(exact, expectation({ module: { ...moduleIdentity, moduleSha256: "0".repeat(64) } })), /module|binding/i);
});

test("concurrent consumers cannot both cross the durable single-use boundary", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-dispatch-race-"));
  context.after(async () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = createProviderHostStore(join(root, "state.jsonl"), "9".repeat(64));
  const authority = new ProviderDispatchLeaseAuthority({ authenticationKey: leaseKey, store, host, now: () => now });
  const signed = signProviderDispatchLease(unsigned("5".repeat(64)), leaseKey);

  const results = await Promise.allSettled([authority.consume(signed, expectation()), authority.consume(signed, expectation())]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.match(String((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason), /consumed|replay/i);
  assert.equal((await store.readEntries()).filter((entry) => entry.kind === "provider-host.dispatch-lease-consumed").length, 1);
});

test("a full target with canonical null optionals binds the same TargetSnapshot identity", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-dispatch-null-target-"));
  context.after(async () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const identity = {
    repositoryRoot: "C:\\repo", trackedManifest: "8".repeat(64), untrackedManifest: "9".repeat(64),
    submodules: {}, policyVersion: "policy-v1", environmentFingerprint: "a".repeat(64), completeness: "incomplete" as const,
    reasons: ["Canonical remote is unavailable."]
  };
  const nullTarget = {
    id: targetSnapshotDigest(identity), repositoryRoot: identity.repositoryRoot, canonicalRemote: null, branch: null,
    defaultBranch: null, detached: false, upstream: null, head: null, indexTree: null,
    trackedManifest: identity.trackedManifest, untrackedManifest: identity.untrackedManifest, submodules: {},
    policyVersion: identity.policyVersion, environmentFingerprint: identity.environmentFingerprint, capturedAt: now,
    completeness: identity.completeness, reasons: identity.reasons
  } as const;
  const exactUnsigned = { ...unsigned("6".repeat(64)), target: nullTarget };
  const exactExpectation = expectation({ target: nullTarget });
  const authority = new ProviderDispatchLeaseAuthority({
    authenticationKey: leaseKey, store: createProviderHostStore(join(root, "state.jsonl"), "9".repeat(64)), host, now: () => now
  });
  assert.equal((await authority.consume(signProviderDispatchLease(exactUnsigned, leaseKey), exactExpectation)).target.id, nullTarget.id);
});
