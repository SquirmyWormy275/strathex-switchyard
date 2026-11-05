#!/usr/bin/env node
/** Reproducible, unsigned lock-metadata example; no network or package execution. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { scanShieldInputs, shieldEngineVersion } from "../tools/layout-studio/shield-scanner-engine.mjs";

const flags = process.argv.slice(2);
if (flags.length > 1 || flags.length && flags[0] !== "--check") throw Error("Usage: node scripts/export-development-sbom.mjs [--check]");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const lock = await readFile(new URL("../package-lock.json", import.meta.url));
const rules = Buffer.from(JSON.stringify({ schema: "switchyard-shield-rules/v1", version: 1, engine: shieldEngineVersion, rules: ["secret.private-key"], allowedLicenses: ["MIT", "Apache-2.0"] }));
const inputs = new Map([["package-lock.json", lock], ["rules.json", rules]]);
const report = await scanShieldInputs({
  schema: "switchyard-shield-scan/v1", version: 1, action: "shield_supply_chain", scope: "reviewed-inputs",
  files: [{ path: "package-lock.json", sha256: sha(lock), size: lock.length }],
  scanner: { id: "development-example", path: "rules.json", sha256: sha(rules) }, advisory: null
}, { readInput: async (path, maximum) => {
  const bytes = inputs.get(path);
  if (!bytes || bytes.length > maximum) throw Error("Unreviewed or oversized example input.");
  return bytes;
} });
const output = JSON.stringify(report.cycloneDx, null, 2) + "\n", path = new URL("../docs/evidence/switchyard-development.cdx.json", import.meta.url);
if (flags[0] === "--check") {
  if (await readFile(path, "utf8") !== output) throw Error("Development SBOM is stale; run scripts/export-development-sbom.mjs.");
} else await writeFile(path, output);
console.log(JSON.stringify({ checked: flags[0] === "--check", components: report.sbom.components.length, workspaceComponents: report.sbom.components.filter(component => component.workspace).length, sha256: sha(output), composition: "unknown", authenticated: false, sourceVerified: false }));
