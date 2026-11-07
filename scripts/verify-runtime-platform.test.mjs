import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyFreshPlatformRuntime } from "./verify-runtime-platform.mjs";
import { privateWrite } from "../tools/layout-studio/private-fs.mjs";
const result = () => ({ status: "verified", releaseId: "a".repeat(64), python: "3.12.14", packages: { av: "16.1.0", hidapi: "0.15.0", "faster-whisper": "1.2.1", "langchain-core": "1.7.3" }, modelLoaded: true, hidOpened: false, providerContacted: false, extraDistributions: [], installedComponents: ["python", "model"] });
async function fixture(fn) { const root = await mkdtemp(join(tmpdir(), "sx-runtime-platform-test-")); try { await fn(root); } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } }
test("fresh native verification checks installation and exact reuse then removes only its own disposable runtime", () => fixture(async (root) => {
  const calls = [], receiptFile = join(root, "receipt.json"); await writeFile(join(root, "preserved-user-file"), "Preserved");
  const receipt = await verifyFreshPlatformRuntime({ temporaryParent: root, receiptFile, uv: "/synthetic/uv", setup: async (options) => { calls.push(options); return result(); } });
  assert.equal(receipt.succeeded, true); assert.deepEqual(calls.map((c) => c.install), [true, false]); assert.equal(calls[0].root, calls[1].root); assert.equal(receipt.temporaryRuntimeRemoved, true); assert.equal((JSON.parse(await readFile(receiptFile))).recheck.sameRelease, true);
  assert.deepEqual((await readdir(root)).sort(), ["preserved-user-file", "receipt.json"]);
}));
test("an uncertain native guardian preserves its exact failed stage and records recovery instead of deleting it", () => fixture(async (root) => {
  let stage;
  const receipt = await verifyFreshPlatformRuntime({ temporaryParent: root, receiptFile: join(root, "receipt.json"), uv: "/synthetic/uv", setup: async ({ root }) => { stage = root; await privateWrite(join(root, ".maintenance/pending.json"), JSON.stringify({ guardian: { synthetic: "owned guardian" } })); throw Error("Synthetic native install interruption"); }, guardianStopped: async () => false });
  assert.equal(receipt.succeeded, false); assert.equal(receipt.temporaryRuntimeRemoved, false); assert.equal(receipt.recoveryRequired, stage); assert.equal((await readdir(stage)).includes(".maintenance"), true);
}));
test("changed release, missing CPU model or unexpected dependencies cannot become successful platform evidence", async () => {
  for (const change of ["release", "model", "packages"]) await fixture(async (root) => {
    let calls = 0; const receipt = await verifyFreshPlatformRuntime({ temporaryParent: root, receiptFile: join(root, "receipt.json"), uv: "/synthetic/uv", setup: async () => { const value = result(); if (++calls === 2 && change === "release") value.releaseId = "b".repeat(64); if (change === "model") value.modelLoaded = false; if (change === "packages") value.extraDistributions = ["unexpected"]; return value; } });
    assert.equal(receipt.succeeded, false); assert.equal(receipt.temporaryRuntimeRemoved, true); assert.ok(receipt.failure);
  });
});
