#!/usr/bin/env node
/** Installed Linux proof using only a fresh synthetic Personal compartment/feed. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationStateRoot, applicationStatus } from "../deployment/suite/application.mjs";
import { installationRoot } from "../deployment/suite/installation.mjs";
import { verifySuiteRelease } from "../deployment/suite/release.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { directoryIdentity, privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { createScannerAuthority, signScannerFixture } from "./b122-scanner-fixture.mjs";

if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw Error("Use on the installed pilot: node scripts/verify-fixtures-host.mjs --synthetic. No model, account, microphone or keyboard operation is requested.");
const installed = await applicationStatus(); assert.match(installed.build ?? "", /^[a-f0-9]{64}$/);
const manifest = await verifySuiteRelease(join(installationRoot(), "versions", installed.build), { expectedId: installed.build, platform: "linux", checkRuntime: true });
const store = createSuiteStore(), directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"), compartment = "fixture-validation-" + randomUUID().slice(0, 8), fixtureId = "synthetic-" + randomUUID().slice(0, 8);
const endpointFile = join(applicationStateRoot(), "endpoint.json"), endpointBefore = await privateRead(endpointFile), url = new URL(JSON.parse(endpointBefore).url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
assert.ok(token && url.protocol === "http:" && url.hostname === "127.0.0.1");
const sha = x => createHash("sha256").update(x).digest("hex"), digest = x => sha(JSON.stringify(x)), definitions = s => digest([s.profile, s.workflow, s.roleBindings ?? [], s.mode]);
const selected = await store.selection(), selectedBefore = await store.snapshot(selected), personalBefore = definitions(await store.snapshot("personal"));
assert.equal(selectedBefore.observations.some(o => o.status === "recording") || selectedBefore.voice.some(v => v.status === "recording") || selectedBefore.conversations.some(c => c.status === "pending") || (selectedBefore.codingTurns ?? []).some(t => ["submitting", "submitted", "cancellation-requested"].includes(t.status)), false, "Preserve active user work; do not select the synthetic workspace while it is running.");
const checks = [], evidence = { schema: "switchyard-installed-signed-fixtures-proof/v1", at: new Date().toISOString(), sourceCommit: manifest.sourceCommit, applicationRelease: installed.build, compartment, fixtureId, checks, providerPrompted: false, accountCreated: false, microphoneOpened: false, keyboardOpened: false, configurationWritten: false, frontendVisualAcceptance: false };
let stage, stageIdentity, baseline, authority, installedRoot, created = false, failure;
async function api(path, body = {}, expected = 200, authenticated = true) {
  const response = await fetch(new URL("/api/suite/" + path, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const value = await response.json(); assert.equal(response.status, expected, "The installed " + path + " returned an unexpected status."); return value;
}
async function perform(action, payload) {
  const review = await api("host/scanner-fixtures/review", { compartment, requestId: randomUUID(), action, ...payload });
  assert.equal(review.status, "requires-confirmation"); assert.equal(review.confirmation.record.action, "configure_scanner_fixtures");
  const input = { compartment, requestId: review.review.requestId, token: review.confirmation.token }, result = await api("host/scanner-fixtures/apply", input);
  assert.equal(result.status, "completed"); assert.equal(result.authorityGranted, false); return { result, input };
}
try {
  await api("host/scanner-fixtures/list", {}, 401, false); checks.push("unauthenticated fixture access refused before protected state access");
  await api("compartment/create", { compartment, policy: "personal" }); created = true; baseline = definitions(await store.snapshot(compartment));
  await api("compartment/select", { compartment }); await api("mode", { compartment, mode: "personal-companion" });
  await api("host/scanner-fixtures/review", { compartment, requestId: randomUUID(), action: "install-trust", approved: true, policy: {} }, 409); checks.push("task-style approval overrides refused by the actual closed maintenance route");
  stage = await mkdtemp(join(directory, "signed-fixtures-proof-")); stageIdentity = await directoryIdentity(stage);
  authority = await createScannerAuthority({ outputDirectory: join(stage, "authority"), authorityId: "synthetic-pilot-" + randomUUID().slice(0, 8), allowedKinds: ["scanner", "advisory"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const policy = JSON.parse(await readFile(authority.trustPolicyPath, "utf8")), contentPath = join(stage, "content.bin"), content = Buffer.from("Synthetic Switchyard evidence feed.\n"); await privateWrite(contentPath, content);
  await perform("install-trust", { policy }); checks.push("exact public P-256 authority approved and enrolled only in the synthetic Personal compartment");
  const packageDirectory = join(stage, "package"); await signScannerFixture({ ...authority, contentPath, outputDirectory: packageDirectory, id: fixtureId, kind: "advisory", feedVersion: "synthetic-pilot-v1", toolName: "synthetic-pilot", toolVersion: "1.0.0", expiresAt: new Date(Date.now() + 3600000).toISOString(), maximumAgeSeconds: 3600 });
  const imported = await perform("install-fixture", { manifestPath: join(packageDirectory, "manifest.json") });
  const rows = (await store.snapshot(compartment)).scannerFixtureJournal ?? [], entry = rows.find(e => e.kind === "b122.scanner-fixture.install.v1" && e.payload.id === fixtureId); assert.ok(entry);
  installedRoot = entry.payload.packageRoot;
  assert.equal(sha(await readFile(join(installedRoot, "manifest.json"))), entry.payload.manifestSha256); assert.deepEqual(await readFile(join(installedRoot, "content.bin")), content);
  evidence.manifestSha256 = entry.payload.manifestSha256; evidence.contentSha256 = sha(content); checks.push("reviewed signed package copied and exact manifest/content readback verified through the normal backend");
  const duplicate = await api("host/scanner-fixtures/apply", imported.input); assert.equal(duplicate.replayed, true); assert.equal(duplicate.receiptId, imported.result.receiptId); checks.push("duplicate approval returns the original receipt without reinstalling a package");
  const snapshot = await api("snapshot", { compartment }); assert.equal(Object.hasOwn(snapshot, "scannerFixtureJournal"), false); assert.equal(Object.hasOwn(snapshot, "scannerFixtureReviews"), false);
  const listed = await api("host/scanner-fixtures/list", { compartment }); assert.equal(Object.hasOwn(listed.trusts[0], "publicKeyPem"), false); assert.equal(Object.hasOwn(listed.fixtures[0], "packageRoot"), false); checks.push("ordinary snapshots omit private maintenance and explicit listing omits key bytes/package paths");
  await perform("revoke-fixture", { fixtureId, reason: "Synthetic pilot verification complete" }); await perform("revoke-trust", { authorityId: policy.authorityId, keyId: policy.keyId, reason: "Synthetic pilot verification complete" });
  const revoked = await api("host/scanner-fixtures/list", { compartment }); assert.equal(revoked.fixtures[0].status, "revoked"); assert.equal(revoked.trusts[0].status, "revoked"); checks.push("exact synthetic fixture and authority revoked through separately reviewed effects");
  const allocated = await api("host/scanner-fixtures/list", { compartment }); assert.equal(allocated.storage.allocatedCount, 1); assert.ok(allocated.storage.allocatedBytes > content.byteLength); checks.push("aggregate reservation includes manifest and content and remains allocated after revocation");
  const removed = await perform("remove-fixture", { fixtureId, reason: "Explicit synthetic retention complete" });
  const retired = await api("host/scanner-fixtures/list", { compartment }); assert.equal(retired.storage.allocatedCount, 0); assert.equal(retired.storage.allocatedBytes, 0); assert.equal(retired.fixtures[0].status, "removed"); assert.equal(retired.trusts[0].status, "revoked");
  await assert.rejects(readdir(installedRoot), { code: "ENOENT" });
  const repeatedRemoval = await api("host/scanner-fixtures/apply", removed.input); assert.equal(repeatedRemoval.replayed, true); assert.equal(repeatedRemoval.receiptId, removed.result.receiptId);
  await api("host/scanner-fixtures/review", { compartment, requestId: randomUUID(), action: "install-fixture", manifestPath: join(packageDirectory, "manifest.json") }, 409);
  evidence.knownSyntheticPackageRemoved = true;
  checks.push("separately approved installed removal deletes only original fixture files, releases quota, preserves tombstones and returns the same receipt on replay");
} catch (error) { failure = error; evidence.failure = error.message.replaceAll(url.origin, "[local application]"); }
finally {
  if (created) {
    try {
      await api("mode", { compartment, mode: "keyboard-only" }); const recovered = await api("host/scanner-fixtures/recover", { compartment }); assert.equal(recovered.stopped, true);
      await api("compartment/select", { compartment: selected });
      assert.equal(definitions(await store.snapshot(compartment)), baseline); assert.equal(definitions(await store.snapshot("personal")), personalBefore); assert.equal(await store.selection(), selected); assert.equal(await privateRead(endpointFile), endpointBefore);
      const home = await fetch(url.origin, { signal: AbortSignal.timeout(15000) }); evidence.homeSha256 = sha(await home.text()); assert.equal(evidence.homeSha256, "20ba0095a6b9650046df34541872aa7e0a7cdc7db5182f065abb009127c6c130"); assert.equal((await applicationStatus()).build, installed.build);
      evidence.validationRestored = true; checks.push("original selection, Personal definitions/mode, validation keyboard-only state, private endpoint and exact frozen Home restored");
    } catch (error) { failure ??= error; evidence.restoreFailure = error.message.replaceAll(url.origin, "[local application]"); }
  }
  if (!failure && stage) { const current = await directoryIdentity(stage); assert.equal(current.dev, stageIdentity.dev); assert.equal(current.ino, stageIdentity.ino); await rm(stage, { recursive: true }); evidence.signingScratchRemoved = true; checks.push("owned synthetic source package and signing secret removed; no runtime copy or provider prompt"); }
}
evidence.success = !failure;
const receipt = join(directory, "installed-signed-fixtures-" + Date.now() + ".json"); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt, sourceCommit: evidence.sourceCommit, applicationRelease: evidence.applicationRelease, success: evidence.success, checks: checks.length, validationRestored: evidence.validationRestored ?? false, knownSyntheticPackageRemoved: evidence.knownSyntheticPackageRemoved ?? false, signingScratchRemoved: evidence.signingScratchRemoved ?? false, failure: evidence.failure ?? evidence.restoreFailure ?? null }));
if (failure) process.exitCode = 1;
