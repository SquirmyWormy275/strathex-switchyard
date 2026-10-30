#!/usr/bin/env node
/** Serve a hash-verified frozen front end with the current local backend. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { createStudioServer, studioAssets } from "../tools/layout-studio/serve.mjs";
import { publishEndpoint } from "../tools/layout-studio/physical-intent.mjs";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]) || +args[1] < 1024 || +args[1] > 65535)) throw new Error("Usage: npm run review:serve -- [--port 43177]");
const root = fileURLToPath(new URL("../artifacts/frontend-review/", import.meta.url)), pointer = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
if (!/^[a-f0-9]{64}$/.test(pointer.digest) || resolve(pointer.directory) !== join(root, pointer.digest.slice(0, 12))) throw new Error("Invalid review build location.");
const manifest = JSON.parse(await readFile(join(pointer.directory, "manifest.json"), "utf8"));
const expected = [...new Set([...studioAssets.values()].map((v) => v[0]))].sort();
if (JSON.stringify(manifest.files.map((f) => f.file).sort()) !== JSON.stringify(expected)) throw new Error("The front-end asset contract changed. Preserve this build and prepare a new review deliberately.");
for (const f of manifest.files) if (createHash("sha256").update(await readFile(join(pointer.directory, f.file))).digest("hex") !== f.sha256) throw new Error(`Review asset changed: ${f.file}`);
if (createHash("sha256").update(JSON.stringify(manifest.files)).digest("hex") !== pointer.digest) throw new Error("Review manifest failed verification.");
const server = createStudioServer({ assetRoot: pointer.directory });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { server.closeAllConnections(); server.close(); });
server.listen(Number(args[1] ?? 43177), "127.0.0.1", async () => {
  const url = process.env.XDG_RUNTIME_DIR ? await publishEndpoint(server, { review: pointer.digest }) : `http://127.0.0.1:${server.address().port}/#access=${server.accessToken}`;
  console.log(`Switchyard morning review: ${url}\nFrozen front end ${pointer.digest.slice(0, 12)} · current local backend.`);
});
