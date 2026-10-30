#!/usr/bin/env node
/** Optional developer acceptance: build a disposable environment, then remove it. */
import { setupRuntime, runtimeRoot, verifyRuntimeModel } from "../tools/layout-studio/runtime-setup.mjs";
import { mkdir, copyFile, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { resolveRuntimePaths } from "../tools/layout-studio/runtime-storage.mjs";
import { runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";

if (process.argv.length !== 2) throw new Error("Usage: npm run runtime:verify-fresh");
const source = fileURLToPath(new URL("../tools/layout-studio/", import.meta.url));
const model = JSON.parse(await readFile(join(source, "runtime-model.json")));
const installed = await resolveRuntimePaths();
await verifyRuntimeModel(installed.model, model);
const root = join(homedir(), ".local/share/strathex-switchyard", `.runtime-smoke-${randomUUID()}`);
const receipt = { at: new Date().toISOString(), modelRevision: model.revision, requirementSha256: createHash("sha256").update(await readFile(join(source, "runtime.requirements.lock"))).digest("hex") };
try {
  await privateDirectory(join(root, "base.en"));
  // Use copy-on-write when the filesystem supports it; never share mutable links.
  for (const f of model.files) await copyFile(join(installed.model, f.name), join(root, "base.en", f.name), constants.COPYFILE_FICLONE);
  const result = await setupRuntime({ root, install: true });
  receipt.freshInstall = { status: result.status, platform: process.platform, python: result.python, packageCount: Object.keys(result.packages).length, extraDistributions: result.extraDistributions, modelLoaded: result.modelLoaded, installedComponents: result.installedComponents, hidOpened: false, providerContacted: false };
} catch (error) { receipt.error = error.message; process.exitCode = 1; }
finally {
  let pending; try { pending = JSON.parse(await readFile(join(root, ".maintenance/pending.json"))); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (pending?.guardian && !await runtimeGuardianStopped(pending.guardian)) { receipt.temporaryRuntimeRemoved = false; receipt.recoveryRequired = root; }
  else { await rm(root, { recursive: true, force: true }); receipt.temporaryRuntimeRemoved = true; }
  const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification");
  await privateDirectory(directory); await privateWrite(join(directory, "runtime-reproducibility.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
}
