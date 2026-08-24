import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createScannerAuthority, signScannerFixture, verifyScannerFixture } from "./b122-scanner-fixture.mjs";

const now = new Date("2026-08-24T12:00:00.000Z");

test("offline scanner tooling emits an exact signed package and detects content tampering", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-scanner-tool-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const authority = await createScannerAuthority({ outputDirectory: join(root, "authority"), authorityId: "security-lab", allowedKinds: ["scanner", "advisory"], expiresAt: "2027-08-24T12:00:00.000Z", now });
  const trust = JSON.parse(await readFile(authority.trustPolicyPath, "utf8"));
  assert.equal("privateKey" in trust, false);
  assert.deepEqual(trust.allowedKinds, ["advisory", "scanner"]);
  const contentPath = join(root, "scanner-output.json");
  await writeFile(contentPath, JSON.stringify({ findings: [] }), "utf8");
  const packageDirectory = join(root, "package");
  const signed = await signScannerFixture({
    outputDirectory: packageDirectory, contentPath, privateKeyPath: authority.privateKeyPath, trustPolicyPath: authority.trustPolicyPath,
    id: "scanner-feed-2026-08-24", kind: "scanner", feedVersion: "feed-2026.08.24", toolName: "security-scanner", toolVersion: "4.2.1",
    generatedAt: now.toISOString(), expiresAt: "2026-08-25T12:00:00.000Z", maximumAgeSeconds: 86_400, now
  });
  assert.deepEqual(await verifyScannerFixture({ packageDirectory, trustPolicyPath: authority.trustPolicyPath, now: new Date("2026-08-24T12:05:00.000Z") }), {
    valid: true, id: signed.id, kind: "scanner", feedVersion: "feed-2026.08.24", contentSha256: signed.contentSha256
  });
  await writeFile(join(packageDirectory, "content.bin"), "tampered", "utf8");
  await assert.rejects(verifyScannerFixture({ packageDirectory, trustPolicyPath: authority.trustPolicyPath, now }), /content digest/i);
});

test("offline scanner tooling rejects unauthorized kinds, stale packages, and mismatched keys", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-scanner-tool-reject-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const first = await createScannerAuthority({ outputDirectory: join(root, "first"), authorityId: "scanner-only", allowedKinds: ["scanner"], expiresAt: "2027-08-24T12:00:00.000Z", now });
  const second = await createScannerAuthority({ outputDirectory: join(root, "second"), authorityId: "other", allowedKinds: ["advisory"], expiresAt: "2027-08-24T12:00:00.000Z", now });
  const contentPath = join(root, "feed.json"); await writeFile(contentPath, "{}", "utf8");
  const common = { contentPath, id: "feed", feedVersion: "v1", toolName: "tool", toolVersion: "v1", generatedAt: now.toISOString(), expiresAt: "2026-08-24T13:00:00.000Z", maximumAgeSeconds: 3600, now };
  await assert.rejects(signScannerFixture({ ...common, outputDirectory: join(root, "wrong-kind"), privateKeyPath: first.privateKeyPath, trustPolicyPath: first.trustPolicyPath, kind: "advisory" }), /does not authorize/i);
  await assert.rejects(signScannerFixture({ ...common, outputDirectory: join(root, "wrong-key"), privateKeyPath: first.privateKeyPath, trustPolicyPath: second.trustPolicyPath, kind: "advisory" }), /does not match/i);
  const packageDirectory = join(root, "stale");
  await signScannerFixture({ ...common, outputDirectory: packageDirectory, privateKeyPath: first.privateKeyPath, trustPolicyPath: first.trustPolicyPath, kind: "scanner" });
  await assert.rejects(verifyScannerFixture({ packageDirectory, trustPolicyPath: first.trustPolicyPath, now: new Date("2026-08-24T13:00:01.000Z") }), /expired|freshness SLA/i);
});
