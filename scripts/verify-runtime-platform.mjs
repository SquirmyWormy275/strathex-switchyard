#!/usr/bin/env node
/** Disposable native runtime acceptance; no pre-existing installation or account. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { lstat, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setupRuntime, runtimeEnvironment } from "../tools/layout-studio/runtime-setup.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";
import { privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";

export async function verifyFreshPlatformRuntime({ uv, windowsHelper, receiptFile, temporaryParent = tmpdir(), setup = setupRuntime, guardianStopped = runtimeGuardianStopped } = {}) {
  const root = join(await realpath(temporaryParent), `switchyard-native-runtime-${randomUUID()}`);
  await privateDirectory(root);
  const receipt = { schema: "switchyard-fresh-platform-runtime/v1", at: new Date().toISOString(), platform: process.platform,
    succeeded: false, hardwareOpened: false, providerAccountUsed: false, microphoneOpened: false, temporaryRuntimeRemoved: false };
  const command = (exe, args, options) => runRuntimeCommand(exe, args, { ...options, ...(windowsHelper ? { windowsHelper } : {}) });
  const verified = (r) => r.status === "verified" && /^[a-f0-9]{64}$/.test(r.releaseId ?? "") && r.python === "3.12.14" && r.modelLoaded === true && r.hidOpened === false && r.providerContacted === false && Array.isArray(r.extraDistributions) && r.extraDistributions.length === 0 && Object.keys(r.packages ?? {}).length >= 4;
  try {
    const first = await setup({ root, install: true, uvResolver: async () => uv, command });
    assert.ok(verified(first), "The fresh native installation did not verify exact dependencies, imports and offline CPU model load.");
    receipt.install = { releaseId: first.releaseId, python: first.python, packageCount: Object.keys(first.packages).length, extraDistributions: first.extraDistributions, modelLoaded: first.modelLoaded, installedComponents: first.installedComponents };
    const second = await setup({ root, install: false, uvResolver: async () => uv, command });
    assert.ok(verified(second) && second.releaseId === first.releaseId, "The installed native runtime did not pass a second independent inventory/import/model check.");
    receipt.recheck = { sameRelease: true, modelLoaded: true, packageCount: Object.keys(second.packages).length }; receipt.succeeded = true;
  } catch (error) { receipt.failure = error.message; }
  finally {
    try {
      let pending; try { pending = JSON.parse(await readFile(join(root, ".maintenance/pending.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (pending?.guardian && !await guardianStopped(pending.guardian, windowsHelper ? { windowsHelper } : {})) { receipt.succeeded = false; receipt.recoveryRequired = root; receipt.cleanupFailure = "The exact runtime guardian has not verified exit; its software/model stage was preserved."; }
      else { await rm(root, { recursive: true, force: true }); receipt.temporaryRuntimeRemoved = true; }
    } catch (error) { receipt.succeeded = false; receipt.cleanupFailure = error.message; receipt.recoveryRequired = root; }
    await privateWrite(receiptFile, JSON.stringify(receipt, null, 2) + "\n");
  }
  return receipt;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.platform !== "win32") throw new Error("Run this fresh-install verifier on native Windows CI. The separate Linux fresh-runtime check reuses the pilot's verified model.");
  const args = process.argv.slice(2), values = {};
  if (args.length !== 6 || args.some((a, i) => i % 2 === 0 && !["--uv", "--helper", "--receipt"].includes(a))) throw new Error("Usage: node scripts/verify-runtime-platform.mjs --uv /absolute/verified/uv --helper /absolute/Windows/helper --receipt /absolute/result.json (downloads a disposable hash-locked runtime/model; intended for native Windows CI)");
  for (let i = 0; i < args.length; i += 2) { if (values[args[i]]) throw new Error("Duplicate runtime verification option."); values[args[i]] = args[i + 1]; }
  if (Object.keys(values).length !== 3 || Object.values(values).some((p) => !isAbsolute(p))) throw new Error("Explicit absolute tool and receipt paths are required.");
  for (const path of [values["--uv"], values["--helper"]]) { const s = await lstat(path); if (!s.isFile() || s.isSymbolicLink()) throw new Error("The verified native executable is not a regular file."); }
  const uvSha256 = createHash("sha256").update(await readFile(values["--uv"])).digest("hex");
  const helperSha256 = createHash("sha256").update(await readFile(values["--helper"])).digest("hex");
  let uvVersion;
  try {
    uvVersion = (await runRuntimeCommand(values["--uv"], ["--version"], { env: runtimeEnvironment(), windowsHelper: values["--helper"], timeout: 10000 })).trim();
    assert.match(uvVersion, /^uv 0\.12\.7(?:\s|$)/, "The native uv version did not match the reviewed CI pin.");
  } catch (error) {
    await privateWrite(values["--receipt"], JSON.stringify({ schema: "switchyard-fresh-platform-runtime/v1", at: new Date().toISOString(), platform: process.platform, phase: "tool-preflight", succeeded: false, runtimeNotCreated: true, temporaryRuntimeRemoved: false, hardwareOpened: false, providerAccountUsed: false, microphoneOpened: false, verifiedTools: { uvSha256, helperSha256 }, failure: error.message, failureCode: error.code ?? null }, null, 2) + "\n");
    throw error;
  }
  const receipt = await verifyFreshPlatformRuntime({ uv: values["--uv"], windowsHelper: values["--helper"], receiptFile: values["--receipt"] });
  receipt.verifiedTools = { uvVersion, uvSha256, helperSha256 };
  receipt.requirementSha256 = createHash("sha256").update(await readFile(new URL("../tools/layout-studio/runtime.requirements.lock", import.meta.url))).digest("hex");
  await privateWrite(values["--receipt"], JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ receipt: values["--receipt"], succeeded: receipt.succeeded, temporaryRuntimeRemoved: receipt.temporaryRuntimeRemoved, uvSha256, hardwareOpened: false, providerAccountUsed: false }));
  if (!receipt.succeeded) process.exitCode = 1;
}
