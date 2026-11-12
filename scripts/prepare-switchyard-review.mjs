#!/usr/bin/env node
/** Freeze the current front end while backend implementation continues. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { studioAssets } from "../tools/layout-studio/serve.mjs";
const source = new URL("../tools/layout-studio/", import.meta.url), files = [];
for (const file of new Set([...studioAssets.values()].map((v) => v[0]))) {
  const data = await readFile(new URL(file, source));
  files.push({ file, sha256: createHash("sha256").update(data).digest("hex"), data });
}
const digest = createHash("sha256").update(JSON.stringify(files.map(({ data, ...f }) => f))).digest("hex");
const root = fileURLToPath(new URL("../artifacts/frontend-review/", import.meta.url)), directory = join(root, digest.slice(0, 12));
await mkdir(directory, { recursive: true });
for (const f of files) await writeFile(join(directory, f.file), f.data);
const manifest = { schema: "switchyard-front-end-review/v1", createdAt: new Date().toISOString(), digest, directory, files: files.map(({ data, ...f }) => f) };
await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(join(root, "current.json"), JSON.stringify({ directory, digest }, null, 2) + "\n");
console.log(`Frozen front end: ${directory}\nSHA-256: ${digest}\nStart: npm run review:serve -- --port 43177`);
