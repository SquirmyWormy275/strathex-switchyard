#!/usr/bin/env node
/** Reproduce the pinned identifier-only catalog inside the single-file scanner. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const flags = process.argv.slice(2);
if (flags.length > 1 || flags.length && flags[0] !== "--check") throw Error("Usage: node scripts/generate-spdx-license-catalog.mjs [--check]");
const bytes = await readFile(new URL("./data/spdx-license-identifiers.json", import.meta.url));
if (bytes.length > 32768) throw Error("Identifier catalog exceeds its bound.");
const catalog = JSON.parse(bytes);
if (catalog.schema !== "switchyard-spdx-identifier-catalog/v1" || catalog.version !== "3.29.0" || catalog.sourceCommit !== "31ba1a50e5397e00a304dbadc76531740e89ee48") throw Error("Unreviewed SPDX catalog revision.");
const sets = [];
for (const [kind, count, label] of [["licenses", 740, "License"], ["exceptions", 86, "Exception"]]) {
  const rows = catalog[kind];
  if (!Array.isArray(rows) || rows.length !== count || rows.some(row => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,79}\+?$/.test(row[0]) || typeof row[1] !== "boolean") || new Set(rows.map(row => row[0].toLowerCase())).size !== rows.length) throw Error("Invalid SPDX identifier inventory.");
  for (const deprecated of [false, true]) {
    const ids = rows.filter(row => !deprecated || row[1]).map(row => row[0].toLowerCase()).sort();
    sets.push(`const spdx${label}${deprecated ? "Deprecated" : "Ids"} = new Set(${JSON.stringify(ids.join(" "))}.split(" "));`);
  }
}
const digest = createHash("sha256").update(bytes).digest("hex");
const block = ["// BEGIN GENERATED SPDX IDENTIFIERS", `// SPDX license-list-data ${catalog.version}, commit ${catalog.sourceCommit}.`, `// Identifier projection SHA-256: ${digest}. See docs/npm-license-declarations.md.`, `export const spdxLicenseListVersion = ${JSON.stringify(catalog.version)};`, ...sets, "// END GENERATED SPDX IDENTIFIERS"].join("\n");
const target = new URL("../tools/layout-studio/shield-scanner-engine.mjs", import.meta.url), source = await readFile(target, "utf8");
const pattern = /\/\/ BEGIN GENERATED SPDX IDENTIFIERS[\s\S]*?\/\/ END GENERATED SPDX IDENTIFIERS/g;
if ([...source.matchAll(pattern)].length !== 1) throw Error("Exactly one generated SPDX block is required.");
const output = source.replace(pattern, block);
if (flags[0] === "--check") { if (source !== output) throw Error("SPDX catalog is stale; run scripts/generate-spdx-license-catalog.mjs."); }
else await writeFile(target, output);
console.log(JSON.stringify({ checked: flags[0] === "--check", version: catalog.version, licenses: 740, exceptions: 86, projectionSha256: digest }));
