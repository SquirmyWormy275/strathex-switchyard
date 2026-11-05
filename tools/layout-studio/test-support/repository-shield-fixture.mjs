import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./task-authority-fixture.mjs";
import { scannerFixture } from "./shield-scanner-fixture.mjs";
import { connectedExecutionActions } from "../repository-execution-actions.mjs";
import { createScannerFixtures } from "../scanner-fixtures.mjs";
import { createRepositoryExecution } from "../repository-execution.mjs";
import { createScannerAuthority, signScannerFixture } from "../../../scripts/b122-scanner-fixture.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
export async function repositoryShieldFixture(t, { action = "shield_change_scan", clean = false, revokeAfterRun = false, ignoredSecrets = false } = {}) {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") }), fixtures = createScannerFixtures({ store: f.store, stateDirectory: join(f.stage, "fixtures") }); f.onCleanup(() => fixtures.close());
  const perform = async (action, payload) => { const r = await fixtures.review("personal", { requestId: randomUUID(), action, ...payload }), result = await fixtures.apply("personal", { requestId: r.review.requestId, token: r.confirmation.token }); assert.equal(result.status, "completed"); };
  const signing = await createScannerAuthority({ outputDirectory: join(f.stage, "signing"), authorityId: "synthetic-shield-authority", allowedKinds: ["scanner", "advisory"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  await perform("install-trust", { policy: JSON.parse(await readFile(signing.trustPolicyPath, "utf8")) });
  const lock = JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "synthetic" }, "node_modules/synthetic": { version: "1.0.0", license: "MIT", resolved: "https://registry.npmjs.org/synthetic/-/synthetic-1.0.0.tgz", integrity: "sha512-" + Buffer.alloc(64, 3).toString("base64") } } });
  const sample = scannerFixture({ action, files: { ...(ignoredSecrets?{".env":"-----BEGIN PRIVATE KEY-----\nsynthetic ignored secret"}:{}), "app.js": clean||ignoredSecrets ? "const ordinary = 1;" : "-----BEGIN PRIVATE KEY-----\neval(untrusted);", "package-lock.json": lock }, advisory: [{ ecosystem: "npm", name: "synthetic", version: "1.0.0", advisories: clean ? [] : [{ id: "GHSA-synthetic-only", severity: "high" }] }] });
  for (const [kind, feed] of [["scanner", sample.request.scanner], ["advisory", sample.request.advisory]]) {
    const contentPath = join(f.stage, `${kind}-content.json`); await writeFile(contentPath, sample.content.get(feed.path));
    const outputDirectory = join(f.stage, `package-${kind}`); await signScannerFixture({ ...signing, contentPath, outputDirectory, id: feed.id, kind, feedVersion: "synthetic-shield-v1", toolName: "switchyard-baseline-scanner", toolVersion: "1", expiresAt: new Date(Date.now() + 3600000).toISOString(), maximumAgeSeconds: 3600 });
    await perform("install-fixture", { manifestPath: join(outputDirectory, "manifest.json") });
  }
  const engine = await readFile(new URL("../shield-scanner-engine.mjs", import.meta.url)); sample.content.set("engine.mjs", engine); sample.content.set("request.json", Buffer.from(JSON.stringify(sample.request)));
  for (const [path, bytes] of sample.content) await writeFile(join(f.root, path), bytes);
  if(ignoredSecrets)await writeFile(join(f.root,".gitignore"),"cache.txt\n.env\n");
  const recipe = { kind: "process", executable: process.execPath, args: ["engine.mjs", "request.json"], cwd: ".", environment: { NODE_ENV: "test" }, lifecycle: "foreground", isolation: "disposable", workspaceMode: "read-only", timeoutMs: 10000, maxOutputBytes: 524288, inputFiles: [...sample.content].map(([path, b]) => ({ path, sha256: sha(b), size: b.length, classification: "non-production" })) };
  const manifest = { schema: "sxsy-b122.repository-runtime", version: 1, repositoryRoot: f.root, allowedHttpsUrls: [], recipes: { [action]: recipe } }, bytes = JSON.stringify(manifest); await writeFile(join(f.root, "shield.json"), bytes);
  const included = [...sample.content.keys(), "shield.json"], grantInput = { ...f.proposed, paths: ["task.txt", ...included], classifications: { includedUntracked: included.filter(p=>!ignoredSecrets||p!==".env"), ...(ignoredSecrets?{includedIgnored:[".env"]}:{}) }, actions: [action] }, approval = await f.service.review("personal", grantInput), grant = await f.service.issue("personal", { ...grantInput, token: approval.confirmation.token });
  let resolutions = 0;
  const execution = createRepositoryExecution({ store: f.store, authority: f.service, stateDirectory: join(f.stage, "execution"), resolveScannerFixtures: async (c, input) => { resolutions++; if (revokeAfterRun && resolutions === 4) await perform("revoke-fixture", { fixtureId: sample.request.scanner.id, reason: "Synthetic post-execution revocation" }); return fixtures.resolve(c, input); } }); f.onCleanup(() => execution.close());
  return { ...f, fixtures, execution, sample, recipe, manifest, perform, grantInput, resolutions: () => resolutions, proposed: { requestId: randomUUID(), authorityId: grant.id, manifestPath: "shield.json", manifestSha256: sha(bytes), action } };
}
