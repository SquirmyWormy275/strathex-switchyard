#!/usr/bin/env node
/** Explicit public package queries only. Does not sign feeds or enroll trust. */
import { mkdir, open, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { collectOsvAdvisories } from "../tools/layout-studio/osv-advisory-source.mjs";

const flags = process.argv.slice(2), out = flags.filter(flag => flag.startsWith("--out=")), selected = flags.filter(flag => flag.startsWith("--package="));
if (out.length !== 1 || !selected.length || flags.length !== out.length + selected.length) throw Error("Usage: node scripts/collect-osv-advisories.mjs --package=NAME@EXACT_STABLE_VERSION [--package=...] --out=NEW_DIRECTORY. Sends only these explicit public identities to OSV; output is unsigned.");
const packages = selected.map(flag => { const value = flag.slice(10), index = value.lastIndexOf("@"); return { ecosystem: "npm", name: value.slice(0, index), version: value.slice(index + 1) }; }), directory = resolve(out[0].slice(6));
try { await lstat(directory); throw Error("Choose a new output directory; existing contents are preserved."); } catch (error) { if (error.code !== "ENOENT") throw error; }
const collected = await collectOsvAdvisories(packages); await mkdir(directory, { mode: 0o700 });
const hashes = {};
for (const [name, value] of [["advisory.json", collected.feed], ["provenance.json", collected.provenance]]) {
  const bytes = JSON.stringify(value, null, 2) + "\n", file = await open(join(directory, name), "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  hashes[name] = createHash("sha256").update(bytes).digest("hex");
}
console.log(JSON.stringify({ directory, packages: collected.feed.packages.length, advisories: collected.feed.packages.reduce((count, item) => count + item.advisories.length, 0), hashes, unsigned: true, authorityGranted: false, sourceFilesSubmitted: false }));
