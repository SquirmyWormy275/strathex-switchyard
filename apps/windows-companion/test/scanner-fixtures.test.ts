import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createScannerFixtureAdministration, DurableScannerFixtureRegistry } from "../src/scanner-fixtures.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";

const observedAt = new Date("2026-08-24T12:00:00.000Z");

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-scanner-fixture-"));
  const source = join(root, "source"); const state = join(root, "state");
  await Promise.all([mkdir(source), mkdir(state)]);
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = createHash("sha256").update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })).digest("hex");
  const trustPath = join(source, "trust.json");
  await writeFile(trustPath, JSON.stringify({ schema: "sxsy-b122.scanner-fixture-trust", version: 1, authorityId: "security-lab", keyId, publicKeyPem, allowedKinds: ["scanner", "advisory"], expiresAt: "2027-08-24T12:00:00.000Z" }), "utf8");
  const presence = { async verify() { return { verified: true, operator: "TEST\\Security" }; } };
  const registry = new DurableScannerFixtureRegistry(new ProtectedJsonStore({ filePath: join(state, "protected.jsonl") }), state, () => new Date(observedAt));
  const administration = createScannerFixtureAdministration({ registry, presence, now: () => new Date(observedAt) });
  await administration.installTrust(trustPath);
  return { root, source, state, keys, keyId, registry, administration };
}

async function signedManifest(setup: Awaited<ReturnType<typeof fixture>>, id: string, kind: "scanner" | "advisory", overrides: Readonly<Record<string, unknown>> = {}): Promise<string> {
  const contentFile = `${id}.json`;
  const contents = Buffer.from(JSON.stringify({ feed: id, findings: [] }), "utf8");
  await writeFile(join(setup.source, contentFile), contents);
  const unsigned = {
    schema: "sxsy-b122.scanner-fixture", version: 1, id, kind, authorityId: "security-lab", keyId: setup.keyId,
    feedVersion: `${id}-v1`, toolName: kind === "scanner" ? "test-scanner" : "test-advisory-db", toolVersion: "1.0.0",
    contentFile, contentSha256: createHash("sha256").update(contents).digest("hex"), generatedAt: "2026-08-24T11:30:00.000Z",
    expiresAt: "2026-08-25T11:30:00.000Z", maximumAgeSeconds: 86_400, signatureAlgorithm: "ecdsa-p256-sha256", ...overrides
  };
  const signature = sign("sha256", Buffer.from(canonical(unsigned)), setup.keys.privateKey).toString("base64");
  const path = join(setup.source, `${id}-manifest.json`);
  await writeFile(path, JSON.stringify({ ...unsigned, signature }), "utf8");
  return path;
}

test("installed signed scanner and advisory fixtures are rehashed and SLA-checked on every resolution", async (context) => {
  const setup = await fixture(context);
  await setup.administration.installFixture(await signedManifest(setup, "scanner-feed-1", "scanner"));
  await setup.administration.installFixture(await signedManifest(setup, "advisory-feed-1", "advisory"));
  const resolved = await setup.registry.resolve({ scannerFixtureIds: ["scanner-feed-1"], advisoryFixtureIds: ["advisory-feed-1"], observedAt });
  assert.deepEqual(resolved.map((item) => [item.id, item.kind]), [["scanner-feed-1", "scanner"], ["advisory-feed-1", "advisory"]]);
  assert.ok(resolved.every((item) => /^[a-f0-9]{64}$/.test(item.manifestSha256) && item.feedVersion.endsWith("-v1")));

  await writeFile(join(setup.state, "scanner-fixtures", "scanner-feed-1", "content.bin"), "tampered", "utf8");
  await assert.rejects(setup.registry.resolve({ scannerFixtureIds: ["scanner-feed-1"], advisoryFixtureIds: [], observedAt }), /digest/i);
});

test("fixture IDs, signatures, freshness, kind, and revocation all fail closed", async (context) => {
  const setup = await fixture(context);
  const stale = await signedManifest(setup, "stale-feed", "scanner", { generatedAt: "2026-08-20T00:00:00.000Z", expiresAt: "2026-08-30T00:00:00.000Z", maximumAgeSeconds: 3600 });
  await assert.rejects(setup.administration.installFixture(stale), /freshness SLA/i);
  const good = await signedManifest(setup, "scanner-feed", "scanner");
  const value = JSON.parse(await (await import("node:fs/promises")).readFile(good, "utf8")) as Record<string, unknown>;
  value.toolVersion = "changed";
  await writeFile(good, JSON.stringify(value), "utf8");
  await assert.rejects(setup.administration.installFixture(good), /signature/i);

  await setup.administration.installFixture(await signedManifest(setup, "revoked-feed", "scanner"));
  await setup.administration.revokeFixture("revoked-feed", "feed withdrawn");
  await assert.rejects(setup.registry.resolve({ scannerFixtureIds: ["revoked-feed"], advisoryFixtureIds: [], observedAt }), /not actively installed/i);
  await assert.rejects(setup.registry.resolve({ scannerFixtureIds: [], advisoryFixtureIds: ["revoked-feed"], observedAt }), /not actively installed/i);
});

function canonical(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; }
