import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createScannerFixtureAdministration, DurableScannerFixtureRegistry } from "../src/scanner-fixtures.ts";
import { fixtureDirectory } from "../src/scanner-fixture-files.ts";
import { ProtectedJsonStore, type JournalEntry, type JsonValue } from "../../../packages/control-plane/src/store.ts";
import { HostReceiptEvidenceFactory } from "../src/receipt-evidence.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";

const observedAt = new Date("2026-08-24T12:00:00.000Z");

test("native directory spellings preserve fixture identity and child creation without accepting redirected parents", async context => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sxsy-fixture-alias-"))), selected = join(root, "Fixture directory with spaces");
  context.after(async () => { await rm(root, { recursive: true, force: true }); }); await mkdir(selected);
  let spelling = selected;
  if (process.platform === "win32") {
    // Existing test Python calls only the native path API; no shell parses paths.
    const program = "import ctypes,json,sys; from ctypes import wintypes; api=ctypes.WinDLL('kernel32',use_last_error=True).GetShortPathNameW; api.argtypes=[wintypes.LPCWSTR,wintypes.LPWSTR,wintypes.DWORD]; api.restype=wintypes.DWORD; out=ctypes.create_unicode_buffer(32768); size=api(sys.argv[1],out,len(out)); assert 0<size<len(out); print(json.dumps(out.value))";
    spelling = JSON.parse(execFileSync("python.exe", ["-I", "-B", "-c", program, selected], { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 131072 }));
    assert.equal(await realpath(spelling), await realpath(selected));
    context.diagnostic(`Native short-name spelling differs: ${spelling.toLowerCase() !== selected.toLowerCase()}`);
  }
  assert.deepEqual(await fixtureDirectory(spelling, false), await fixtureDirectory(selected, false));
  const created = await fixtureDirectory(join(spelling, "child"), true); assert.deepEqual(created, await fixtureDirectory(join(selected, "child"), false));
  const fs = await import("node:fs/promises"), alias = join(root, "redirected"); await fs.symlink(selected, alias, process.platform === "win32" ? "junction" : "dir");
  try { await assert.rejects(fixtureDirectory(join(alias, "unexpected"), true), /Preserve/); await assert.rejects(fs.stat(join(selected, "unexpected")), { code: "ENOENT" }); }
  finally { await fs.unlink(alias); }
});

async function fixture(context: test.TestContext, trustExpiresAt = "2027-08-24T12:00:00.000Z") {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-scanner-fixture-"));
  const source = join(root, "source"); const state = join(root, "state");
  await Promise.all([mkdir(source), mkdir(state)]);
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = createHash("sha256").update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })).digest("hex");
  const trustPath = join(source, "trust.json");
  await writeFile(trustPath, JSON.stringify({ schema: "sxsy-b122.scanner-fixture-trust", version: 1, authorityId: "security-lab", keyId, publicKeyPem, allowedKinds: ["scanner", "advisory"], expiresAt: trustExpiresAt }), "utf8");
  const presence = { async verify() { return { verified: true, operator: "TEST\\Security" }; } };
  const store=new ProtectedJsonStore({ filePath: join(state, "protected.jsonl") });
  const registry = new DurableScannerFixtureRegistry(store, state, () => new Date(observedAt));
  const administration = createScannerFixtureAdministration({ registry, presence, now: () => new Date(observedAt) });
  await administration.installTrust(trustPath);
  return { root, source, state, keys, keyId, store, registry, administration };
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
  assert.deepEqual((await setup.administration.listTrust()).map((item) => [item.authorityId, item.status]), [["security-lab", "active"]]);
  assert.deepEqual((await setup.administration.listFixtures()).map((item) => [item.id, item.kind, item.status]), [["scanner-feed-1", "scanner", "active"], ["advisory-feed-1", "advisory", "active"]]);
  const resolved = await setup.registry.resolve({ scannerFixtureIds: ["scanner-feed-1"], advisoryFixtureIds: ["advisory-feed-1"], observedAt });
  assert.deepEqual(resolved.map((item) => [item.id, item.kind]), [["scanner-feed-1", "scanner"], ["advisory-feed-1", "advisory"]]);
  assert.ok(resolved.every((item) => /^[a-f0-9]{64}$/.test(item.manifestSha256) && item.feedVersion.endsWith("-v1")));

  await writeFile(join(setup.state, "scanner-fixtures", "scanner-feed-1", "content.bin"), "tampered", "utf8");
  await assert.rejects(setup.registry.resolve({ scannerFixtureIds: ["scanner-feed-1"], advisoryFixtureIds: [], observedAt }), /digest/i);
});

test("draft feed reads return only verified content without journal writes and reject tampering", async context => {
  const setup = await fixture(context);
  await setup.administration.installFixture(await signedManifest(setup, "draft-feed", "scanner"));
  const input = { scannerFixtureIds: ["draft-feed"], advisoryFixtureIds: [], observedAt };
  const before = await setup.store.readEntries(), content = await setup.registry.readResolvedContent(input);
  assert.equal(content.length, 1); assert.equal(createHash("sha256").update(content[0]!.bytes).digest("hex"), content[0]!.fixture.contentSha256);
  assert.deepEqual(JSON.parse(Buffer.from(content[0]!.bytes).toString("utf8")), { feed: "draft-feed", findings: [] });
  assert.deepEqual(await setup.store.readEntries(), before); content[0]!.bytes.fill(0);
  await assert.rejects(setup.registry.readResolvedContent({ ...input, scannerFixtureIds: [] }), /one scanner/);
  await writeFile(join(setup.state, "scanner-fixtures/draft-feed/content.bin"), "changed public content");
  await assert.rejects(setup.registry.readResolvedContent(input), /digest/);
});

test("resolved evidence expires at the earliest signed SLA, trust or absolute deadline, including its exact boundary", async context => {
  for (const [label, trustSeconds, absoluteSeconds, expectedSeconds] of [["sla", 300, 300, 60], ["trust", 30, 300, 30], ["absolute", 300, 20, 20]] as const) {
    const setup = await fixture(context, new Date(observedAt.getTime() + trustSeconds * 1000).toISOString());
    await setup.administration.installFixture(await signedManifest(setup, `deadline-${label}`, "scanner", { generatedAt: observedAt.toISOString(), expiresAt: new Date(observedAt.getTime() + absoluteSeconds * 1000).toISOString(), maximumAgeSeconds: 60 }));
    const resolve = (offset: number) => setup.registry.resolve({ scannerFixtureIds: [`deadline-${label}`], advisoryFixtureIds: [], observedAt: new Date(observedAt.getTime() + offset) });
    const deadline = new Date(observedAt.getTime() + expectedSeconds * 1000).toISOString();
    assert.equal((await resolve(0))[0]!.expiresAt, deadline);
    assert.equal((await resolve(expectedSeconds * 1000 - 1))[0]!.expiresAt, deadline);
    await assert.rejects(resolve(expectedSeconds * 1000), /expired|freshness SLA|authority/i);
  }
});

test("an authenticated observation issued just before real fixture trust expiry cannot outlive that effective deadline", async context => {
  const setup = await fixture(context, "2026-08-24T12:00:30.000Z");
  await setup.administration.installFixture(await signedManifest(setup, "short-trust", "scanner", { generatedAt: observedAt.toISOString(), expiresAt: "2026-08-25T12:00:00.000Z", maximumAgeSeconds: 60 }));
  let clock = new Date("2026-08-24T12:00:29.999Z");
  const facts = (await setup.registry.resolve({ scannerFixtureIds: ["short-trust"], advisoryFixtureIds: [], observedAt: clock }))[0]!;
  const material = { repositoryRoot: setup.root, branch: "feature/expiry", head: "1".repeat(40), indexTree: "2".repeat(40), trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "expiry-policy", environmentFingerprint: "environment", completeness: "complete" as const, reasons: [] };
  const target = { ...material, id: targetSnapshotDigest(material), capturedAt: clock.toISOString() }, factory = new HostReceiptEvidenceFactory({ authenticationKey: Buffer.alloc(32, 9), policyVersion: target.policyVersion, exactVersions: { scanner: "synthetic" }, clock: () => clock });
  const envelope = factory.issue({ producer: "scanner", action: "shield_change_scan", operationId: "expiry-observation", target, outcome: "incomplete", completeness: "incomplete", observedAt: clock.toISOString(), expiresAt: facts.expiresAt, evidence: { scannerFeedSha256: facts.contentSha256, findingCount: 0 } });
  const result = { status: "incomplete" as const, summary: "Partial observation", operationId: "expiry-observation", data: { receiptEvidenceEnvelope: envelope } };
  assert.ok(factory.forResult(commandForAction("shield_change_scan"), result, target));
  clock = new Date("2026-08-24T12:00:30.000Z");
  assert.equal(factory.forResult(commandForAction("shield_change_scan"), result, target), undefined);
  await assert.rejects(setup.registry.resolve({ scannerFixtureIds: ["short-trust"], advisoryFixtureIds: [], observedAt: clock }), /authority/i);
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

test("independent concurrent fixture installers cannot replace or erase the accepted destination",async context=>{
  const setup=await fixture(context),manifest=await signedManifest(setup,"concurrent-feed","scanner");
  const other=new DurableScannerFixtureRegistry(new ProtectedJsonStore({filePath:setup.store.filePath}),setup.state,()=>new Date(observedAt));
  const results=await Promise.allSettled([setup.registry.installFixture(manifest,"first"),other.installFixture(manifest,"second")]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
  assert.equal((await setup.registry.listFixtures()).length,1);
  assert.equal((await setup.registry.resolve({scannerFixtureIds:["concurrent-feed"],advisoryFixtureIds:[],observedAt})).length,1);
  assert.deepEqual((await readdir(join(setup.state,"scanner-fixtures","concurrent-feed"))).sort(),["content.bin","manifest.json"]);
});

test("a lost final fixture acknowledgement preserves its committed journal and original files without replay",async context=>{
  const setup=await fixture(context),manifest=await signedManifest(setup,"lost-ack-feed","scanner"),append=setup.store.append.bind(setup.store);
  setup.store.append=async(kind,payload)=>{const result=await append(kind,payload);if(kind==="b122.scanner-fixture.install.v1")throw Error("Synthetic lost acknowledgement");return result;};
  await assert.rejects(setup.registry.installFixture(manifest,"operator"),/unconfirmed/);
  const path=join(setup.state,"scanner-fixtures","lost-ack-feed","content.bin"),before=await readFile(path);
  assert.equal((await setup.registry.listFixtures()).length,1);assert.equal((await setup.registry.resolve({scannerFixtureIds:["lost-ack-feed"],advisoryFixtureIds:[],observedAt})).length,1);
  await assert.rejects(setup.registry.installFixture(manifest,"retry"),/already installed/);assert.deepEqual(await readFile(path),before);
});

test("an unfamiliar empty or populated fixture directory is preserved before any writes",async context=>{
  const setup=await fixture(context);await mkdir(join(setup.state,"scanner-fixtures"));
  for(const id of ["foreign-empty","foreign-populated"]){
    const manifest=await signedManifest(setup,id,"scanner"),root=join(setup.state,"scanner-fixtures",id);await mkdir(root);
    if(id==="foreign-populated")await writeFile(join(root,"foreign.txt"),"preserve this independent file");
    await assert.rejects(setup.registry.installFixture(manifest,"operator"),/preserve/);
    assert.deepEqual(await readdir(root),id==="foreign-empty"?[]:["foreign.txt"]);
    if(id==="foreign-populated")assert.equal(await readFile(join(root,"foreign.txt"),"utf8"),"preserve this independent file");
  }
  assert.equal((await setup.registry.listFixtures()).length,0);
});

function canonical(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; }


test("a different valid signed package substituted during user presence cannot inherit the original fixture approval", async context => {
  const setup = await fixture(context), first = await signedManifest(setup, "reviewed-feed", "scanner"), second = await signedManifest(setup, "substituted-feed", "advisory");
  const administration = createScannerFixtureAdministration({ registry: setup.registry, now: () => new Date(observedAt), presence: { async verify(prompt) {
    assert.match(prompt, /reviewed-feed/); await writeFile(first, await readFile(second)); return { verified: true, operator: "TEST\\Security" };
  } } });
  await assert.rejects(administration.installFixture(first), /changed after review/);
  assert.deepEqual(await setup.registry.listFixtures(), []);
  await assert.rejects(readdir(join(setup.state, "scanner-fixtures")), { code: "ENOENT" });
});

test("concurrent authority enrollment cannot admit two keys under the same active authority identity", async context => {
  const setup = await fixture(context), otherStore = new ProtectedJsonStore({ filePath: setup.store.filePath }), other = new DurableScannerFixtureRegistry(otherStore, setup.state, () => new Date(observedAt));
  const original = (await setup.registry.listTrust())[0]!, secondKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const secondPem = secondKeys.publicKey.export({ type: "spki", format: "pem" }).toString(), secondId = createHash("sha256").update(createPublicKey(secondPem).export({ type: "spki", format: "der" })).digest("hex");
  const firstPolicy = { ...original, authorityId: "concurrent-authority" }, { installedAt: _at, installedBy: _by, status: _status, ...policy } = firstPolicy;
  // Reproduce simultaneous stale preflight reads from independent old clients.
  // A transaction's own read remains protected by the actual store's lock.
  let reads = 0, release!: () => void; const bothRead = new Promise<void>(resolve => { release = resolve; });
  for (const store of [setup.store, otherStore]) {
    const read = store.readEntries.bind(store);
    store.readEntries = async <T = JsonValue>(): Promise<readonly JournalEntry<T>[]> => { const entries = await read<T>(); if (++reads === 2) release(); await bothRead; return entries; };
  }
  const results = await Promise.allSettled([setup.registry.installTrust(policy, "first operator"), other.installTrust({ ...policy, keyId: secondId, publicKeyPem: secondPem }, "second operator")]);
  // Restore fixture adapters before observing the accepted protected journal.
  setup.store.readEntries = ProtectedJsonStore.prototype.readEntries.bind(setup.store); otherStore.readEntries = ProtectedJsonStore.prototype.readEntries.bind(otherStore);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal((await setup.registry.listTrust()).filter(r => r.authorityId === policy.authorityId && r.status === "active").length, 1);
});


test("public trust enrollment rejects a matching signing private key before writing or exposing it as trust metadata", async context => {
  const setup = await fixture(context), { installedAt: _at, installedBy: _by, status: _status, ...policy } = (await setup.registry.listTrust())[0]!;
  const secret = setup.keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  await assert.rejects(setup.registry.installTrust({ ...policy, authorityId: "secret-must-not-be-enrolled", publicKeyPem: secret }, "operator"), /only a public key PEM block/);
  assert.equal((await setup.registry.listTrust()).length, 1);
  assert.equal(JSON.stringify(await setup.store.readEntries()).includes("PRIVATE KEY"), false);
});

test("quota counts manifest bytes and unknown reservations before destination creation, including conservative legacy allocations", async context => {
  const s = await fixture(context), manifest = await signedManifest(s, "quota-refusal", "scanner");
  await s.store.append("b122.scanner-fixture.reserve.v1", { id: "unconfirmed-original", manifestSha256: "a".repeat(64), contentSha256: "b".repeat(64), storageBytes: 64 * 1024 * 1024 });
  await assert.rejects(s.registry.installFixture(manifest, "operator"), /aggregate.*quota/);
  await assert.rejects(readdir(join(s.state, "scanner-fixtures")), { code: "ENOENT" });
  assert.equal((await s.registry.storageUsage()).remainingBytes, 0);
  const fresh = await s.registry.inspectRemoval("unconfirmed-original");
  await s.registry.removeFixture(fresh, "Observe absent original allocation", "operator");
  await s.registry.installFixture(manifest, "operator");
  const installed = (await s.registry.listFixtures())[0]!;
  assert.equal((await s.registry.storageUsage()).allocatedBytes, (await readFile(manifest)).length + (await readFile(join(installed.packageRoot, "content.bin"))).length);
  // Historical installs had no reservation/byte count. They must not provide
  // unlimited new capacity merely because their files predate accounting.
  await s.store.append("b122.scanner-fixture.install.v1", { id: "legacy", kind: "scanner", manifestSha256: "c".repeat(64), packageRoot: join(s.state, "scanner-fixtures/legacy"), installedBy: "legacy operator" });
  await assert.rejects(s.registry.installFixture(await signedManifest(s, "legacy-quota-refusal", "scanner"), "operator"), /aggregate.*quota/);
  assert.equal((await s.registry.storageUsage()).remainingBytes, 0);
});

test("independent installers atomically compete for the final retained allocation slot", async context => {
  const s = await fixture(context);
  for (let n = 0; n < 31; n++) await s.store.append("b122.scanner-fixture.reserve.v1", { id: "pending-" + n, manifestSha256: "a".repeat(64), contentSha256: "b".repeat(64), storageBytes: 1 });
  const other = new DurableScannerFixtureRegistry(new ProtectedJsonStore({ filePath: s.store.filePath }), s.state, () => new Date(observedAt));
  const a = await signedManifest(s, "quota-race-a", "scanner"), b = await signedManifest(s, "quota-race-b", "advisory");
  const results = await Promise.allSettled([s.registry.installFixture(a, "first"), other.installFixture(b, "second")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal((await s.registry.storageUsage()).allocatedCount, 32); assert.equal((await s.registry.listFixtures()).length, 1);
  assert.equal((await readdir(join(s.state, "scanner-fixtures"))).length, 1);
});

test("a lost reservation reply retains quota without copying or replaying an installation", async context => {
  const s = await fixture(context), manifest = await signedManifest(s, "reserved-lost-reply", "scanner"), transaction = s.store.transaction.bind(s.store); let fail = true;
  s.store.transaction = async work => { const result = await transaction(work); if (fail && (result as JournalEntry | undefined)?.kind === "b122.scanner-fixture.reserve.v1") { fail = false; throw Error("Synthetic lost durable reservation reply"); } return result; };
  await assert.rejects(s.registry.installFixture(manifest, "operator"), /lost durable reservation/);
  await assert.rejects(readdir(join(s.state, "scanner-fixtures")), { code: "ENOENT" });
  assert.equal((await s.registry.storageUsage()).allocatedCount, 1);
  await assert.rejects(s.registry.installFixture(manifest, "retry"), /already installed or retained/);
  await s.registry.removeFixture(await s.registry.inspectRemoval("reserved-lost-reply"), "Fresh absent-allocation reconciliation", "operator");
  assert.equal((await s.registry.storageUsage()).allocatedBytes, 0);
  await assert.rejects(s.registry.installFixture(manifest, "reuse removed identity"), /already installed or retained/);
});

test("reviewed removal requires revocation, preserves tombstones and quota until exact directory absence", async context => {
  const s = await fixture(context), path = await signedManifest(s, "remove-original", "scanner");
  await s.registry.installFixture(path, "operator");
  await assert.rejects(s.registry.inspectRemoval("remove-original"), /Separately revoke/);
  const bytes = (await s.registry.storageUsage()).allocatedBytes;
  await s.registry.revokeFixture("remove-original", "withdraw", "operator"); assert.equal((await s.registry.storageUsage()).allocatedBytes, bytes);
  await s.administration.removeFixture("remove-original", "Reviewed retention complete");
  assert.equal((await s.registry.storageUsage()).allocatedBytes, 0); assert.equal((await s.registry.listFixtures())[0]!.status, "removed");
  assert.equal((await s.registry.listTrust())[0]!.status, "active");
  await assert.rejects(readdir(join(s.state, "scanner-fixtures/remove-original")), { code: "ENOENT" });
  await assert.rejects(s.registry.installFixture(path, "replacement"), /already installed or retained/);
});

test("partial removal retains quota and requires a fresh review of only original remaining files", async context => {
  const s = await fixture(context), id = "partial-removal";
  await s.registry.installFixture(await signedManifest(s, id, "scanner"), "operator"); await s.registry.revokeFixture(id, "withdraw", "operator");
  const snapshot = await s.registry.inspectRemoval(id); let checks = 0;
  await assert.rejects(s.registry.removeFixture(snapshot, "remove", "operator", async () => { if (++checks === 4) throw Error("Synthetic interrupted deletion"); }), /interrupted deletion/);
  assert.deepEqual(await readdir(join(s.state, "scanner-fixtures", id)), ["content.bin"]); assert.equal((await s.registry.storageUsage()).allocatedCount, 1);
  await assert.rejects(s.registry.removeFixture(snapshot, "replay", "operator"), /changed/);
  const remaining = await s.registry.inspectRemoval(id); assert.equal(remaining.files.length, 1); assert.ok(remaining.originalRemovalSha256);
  await s.registry.removeFixture(remaining, "fresh reviewed remainder", "operator"); assert.equal((await s.registry.storageUsage()).allocatedCount, 0);
});

test("removal preserves extra files, changed bytes, replacement roots and identity substitutions", async context => {
  const s = await fixture(context), id = "preserve-removal", root = join(s.state, "scanner-fixtures", id);
  await s.registry.installFixture(await signedManifest(s, id, "scanner"), "operator"); await s.registry.revokeFixture(id, "withdraw", "operator");
  const original = await s.registry.inspectRemoval(id), content = await readFile(join(root, "content.bin"));
  await writeFile(join(root, "foreign.txt"), "irreplaceable"); await assert.rejects(s.registry.inspectRemoval(id), /Preserve/);
  await (await import("node:fs/promises")).unlink(join(root, "foreign.txt"));
  await writeFile(join(root, "content.bin"), "changed"); await assert.rejects(s.registry.removeFixture(original, "remove", "operator"), /Preserve/); await writeFile(join(root, "content.bin"), content);
  const { rename } = await import("node:fs/promises"); await rename(root, root + "-original"); await mkdir(root);
  for (const file of ["manifest.json", "content.bin"]) await writeFile(join(root, file), await readFile(join(root + "-original", file)));
  await assert.rejects(s.registry.inspectRemoval(id), /Preserve/);
  await assert.rejects(s.registry.removeFixture(original, "remove", "operator"), /Preserve/);
  assert.equal((await s.registry.storageUsage()).allocatedCount, 1); assert.equal(await readFile(join(root, "content.bin"), "utf8"), content.toString());
});

test("a lost removed-journal acknowledgement frees only committed storage and never repeats deletion", async context => {
  const s = await fixture(context), id = "removed-lost-reply";
  await s.registry.installFixture(await signedManifest(s, id, "scanner"), "operator"); await s.registry.revokeFixture(id, "withdraw", "operator");
  const snapshot = await s.registry.inspectRemoval(id), append = s.store.append.bind(s.store);
  s.store.append = async (kind, payload) => { const result = await append(kind, payload); if (kind === "b122.scanner-fixture.remove.v1") throw Error("Synthetic lost removed acknowledgement"); return result; };
  await assert.rejects(s.registry.removeFixture(snapshot, "remove", "operator"), /lost removed/);
  assert.equal((await s.registry.storageUsage()).allocatedCount, 0); assert.equal((await s.registry.listFixtures())[0]!.status, "removed");
  await assert.rejects(s.registry.removeFixture(snapshot, "replay", "operator"), /Separately revoke/);
});

test("linked directory and hard-linked content cannot inherit reviewed removal ownership", async context => {
  const s = await fixture(context), id = "linked-removal", root = join(s.state, "scanner-fixtures", id);
  await s.registry.installFixture(await signedManifest(s, id, "scanner"), "operator"); await s.registry.revokeFixture(id, "withdraw", "operator");
  const reviewed = await s.registry.inspectRemoval(id), fs = await import("node:fs/promises"), outside = root + "-outside";
  await fs.rename(root, outside); await fs.symlink(outside, root, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(s.registry.removeFixture(reviewed, "remove", "operator"), /Preserve/); assert.equal((await readdir(outside)).length, 2);
  await fs.unlink(root); await fs.rename(outside, root);
  const content = join(root, "content.bin"), foreign = join(s.source, "independent.bin"); await fs.rename(content, foreign); await fs.link(foreign, content);
  await assert.rejects(s.registry.inspectRemoval(id), /Preserve/); assert.equal((await s.registry.storageUsage()).allocatedCount, 1); assert.ok((await readFile(foreign)).length > 0);
});

test("an expired legacy revoked fixture can be explicitly removed and partial removal retains its original content pin", async context => {
  const s = await fixture(context), id = "legacy-expired", source = await signedManifest(s, id, "scanner"), root = join(s.state, "scanner-fixtures", id);
  await mkdir(root, { recursive: true }); await writeFile(join(root, "manifest.json"), await readFile(source)); await writeFile(join(root, "content.bin"), await readFile(join(s.source, id + ".json")));
  await s.store.append("b122.scanner-fixture.install.v1", { id, kind: "scanner", packageRoot: root, manifestSha256: createHash("sha256").update(await readFile(source)).digest("hex"), installedBy: "original legacy operator" });
  const expired = new DurableScannerFixtureRegistry(s.store, s.state, () => new Date("2028-01-01"));
  await expired.revokeFixture(id, "retention complete", "operator"); assert.equal((await expired.storageUsage()).allocatedBytes, 67108864);
  const snapshot = await expired.inspectRemoval(id); let calls = 0;
  await assert.rejects(expired.removeFixture(snapshot, "remove", "operator", async () => { if (++calls === 4) throw Error("Synthetic legacy partial deletion"); }), /partial deletion/);
  assert.deepEqual(await readdir(root), ["content.bin"]);
  await expired.removeFixture(await expired.inspectRemoval(id), "new exact remainder review", "operator"); assert.equal((await expired.storageUsage()).allocatedBytes, 0);
});
