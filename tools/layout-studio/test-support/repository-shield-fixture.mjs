import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./task-authority-fixture.mjs";
import { scannerFixture, cargoLockFixture, pinnedRequirementsFixture, licenseDeclarationsFixture, npmArtifactFixture, cargoArtifactFixture, pypiArtifactFixture } from "./shield-scanner-fixture.mjs";
import { connectedExecutionActions } from "../repository-execution-actions.mjs";
import { createScannerFixtures } from "../scanner-fixtures.mjs";
import { createRepositoryExecution } from "../repository-execution.mjs";
import { createShieldExceptions } from "../shield-exceptions.mjs";
import { createScannerAuthority, signScannerFixture } from "../../../scripts/b122-scanner-fixture.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
export async function repositoryShieldFixture(t, { action = "shield_change_scan", clean = false, revokeAfterRun = false, ignoredSecrets = false, workspaceLock = false, ignoredBuildTree = false, advisorySeverity = "high", npmVersion = "1.0.0", npmAdvisory, packageArtifact, packageArchive, cargoArtifact, pypiArtifact, exceptions = false, stagedIndex = false, historyInputs = false, requirements = false, pythonVersions = {}, licenseExpressions = false, cargoLock = false, cargoVersion = "1.2.3" } = {}) {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") }), fixtures = createScannerFixtures({ store: f.store, stateDirectory: join(f.stage, "fixtures") }); f.onCleanup(() => fixtures.close());
  const perform = async (action, payload) => { const r = await fixtures.review("personal", { requestId: randomUUID(), action, ...payload }), result = await fixtures.apply("personal", { requestId: r.review.requestId, token: r.confirmation.token }); assert.equal(result.status, "completed"); };
  const signing = await createScannerAuthority({ outputDirectory: join(f.stage, "signing"), authorityId: "synthetic-shield-authority", allowedKinds: ["scanner", "advisory"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  await perform("install-trust", { policy: JSON.parse(await readFile(signing.trustPolicyPath, "utf8")) });
  const lock = JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "synthetic" }, ...(workspaceLock?{"packages/local":{name:"@synthetic/local",version:"2.0.0",license:"MIT",scripts:{install:"NEVER_EXECUTE_WORKSPACE_SCRIPT"}},"node_modules/local-alias":{resolved:"packages/local",link:true}}:{}), "node_modules/synthetic": { version: npmVersion, license: "MIT", resolved: "https://registry.npmjs.org/synthetic/-/synthetic-1.0.0.tgz", integrity: "sha512-" + Buffer.alloc(64, 3).toString("base64") } } });
  const sample = pypiArtifact ? pypiArtifactFixture({ action, artifactStatus: pypiArtifact }) : cargoArtifact ? cargoArtifactFixture({ action, artifactStatus: cargoArtifact }) : packageArtifact ? npmArtifactFixture({ action, artifactStatus: packageArtifact, archiveStatus: packageArchive }) : cargoLock ? cargoLockFixture({action,clean,cargoVersion}) : licenseExpressions ? licenseDeclarationsFixture({ action }) : requirements ? pinnedRequirementsFixture({ action, clean, ...pythonVersions }) : scannerFixture({ action, files: { ...(ignoredSecrets?{".env":"-----BEGIN PRIVATE KEY-----\nsynthetic ignored secret"}:{}), "app.js": clean||ignoredSecrets ? "const ordinary = 1;" : "-----BEGIN PRIVATE KEY-----\neval(untrusted);", "package-lock.json": lock }, advisory: [...(workspaceLock?[{ecosystem:"npm",name:"@synthetic/local",version:"2.0.0",advisories:[]}]:[]), { ecosystem: "npm", name: "synthetic", version: npmVersion, advisories: npmAdvisory ?? (clean ? [] : [{ id: "GHSA-synthetic-only", severity: advisorySeverity }]) }] });
  for (const [kind, feed] of [["scanner", sample.request.scanner], ["advisory", sample.request.advisory]]) {
    const contentPath = join(f.stage, `${kind}-content.json`); await writeFile(contentPath, sample.content.get(feed.path));
    const outputDirectory = join(f.stage, `package-${kind}`); await signScannerFixture({ ...signing, contentPath, outputDirectory, id: feed.id, kind, feedVersion: "synthetic-shield-v1", toolName: "switchyard-baseline-scanner", toolVersion: "1", expiresAt: new Date(Date.now() + 3600000).toISOString(), maximumAgeSeconds: 3600 });
    await perform("install-fixture", { manifestPath: join(outputDirectory, "manifest.json") });
  }
  const engine = await readFile(new URL("../shield-scanner-engine.mjs", import.meta.url)); sample.content.set("engine.mjs", engine); sample.content.set("request.json", Buffer.from(JSON.stringify(sample.request)));
  for (const [path, bytes] of sample.content) await writeFile(join(f.root, path), bytes);
  if(stagedIndex){
    const staged=Buffer.from("-----BEGIN PRIVATE KEY-----\nSYNTHETIC_STAGED_ONLY_SECRET\neval(untrusted);\n");
    await writeFile(join(f.root,"app.js"),staged);await f.run("add","app.js");await writeFile(join(f.root,"app.js"),sample.content.get("app.js"));
    const path=".switchyard-index/app.js",source={kind:"git-index",path:"app.js",objectId:(await f.run("rev-parse",":app.js")).trim(),mode:"100644"};
    sample.request.files.push({path,sha256:sha(staged),size:staged.length,source});sample.content.set(path,staged);
    sample.content.set("request.json",Buffer.from(JSON.stringify(sample.request)));await writeFile(join(f.root,"request.json"),sample.content.get("request.json"));
  }
  if(historyInputs){
    assert.equal(stagedIndex,false);assert.ok(["shield_codebase_audit","release_shield"].includes(action));
    const old=Buffer.from("-----BEGIN PRIVATE KEY-----\nSYNTHETIC_HISTORICAL_ONLY_SECRET\n"),current=sample.content.get("app.js"),rows=[];
    for(const content of [old,current]){await writeFile(join(f.root,"app.js"),content);await f.run("add","app.js");await f.run("-c","commit.gpgsign=false","commit","-m","SYNTHETIC_HISTORY_MESSAGE_NEVER_RETURNED");rows.push({commit:(await f.run("rev-parse","HEAD")).trim(),objectId:(await f.run("rev-parse","HEAD:app.js")).trim(),content});}
    for(const row of rows.reverse()){const path=".switchyard-history/"+row.commit+"/app.js",source={kind:"git-history",path:"app.js",commit:row.commit,objectId:row.objectId,mode:"100644",depth:4};sample.request.files.push({path,sha256:sha(row.content),size:row.content.length,source});sample.content.set(path,row.content);}
    sample.content.set("request.json",Buffer.from(JSON.stringify(sample.request)));await writeFile(join(f.root,"request.json"),sample.content.get("request.json"));
  }
  if(ignoredSecrets||ignoredBuildTree)await writeFile(join(f.root,".gitignore"),"cache.txt\n"+(ignoredSecrets?".env\n":"")+(ignoredBuildTree?"node_modules/\n":""));
  if(ignoredBuildTree){await mkdir(join(f.root,"node_modules"));const file=await open(join(f.root,"node_modules/large.bin"),"wx");try{await file.truncate(80*1024*1024);}finally{await file.close();}}
  const recipe = { kind: "process", executable: process.execPath, args: ["engine.mjs", "request.json"], cwd: ".", environment: { NODE_ENV: "test" }, lifecycle: "foreground", isolation: "disposable", workspaceMode: "read-only", timeoutMs: 10000, maxOutputBytes: 524288, inputFiles: [...sample.content].map(([path, b]) => ({ path, sha256: sha(b), size: b.length, classification: "non-production" })) };
  const manifest = { schema: "sxsy-b122.repository-runtime", version: 1, repositoryRoot: f.root, allowedHttpsUrls: [], recipes: { [action]: recipe } }, bytes = JSON.stringify(manifest); await writeFile(join(f.root, "shield.json"), bytes);
  const included = [...sample.content.keys(), "shield.json"].filter(p=>!p.startsWith(".switchyard-index/")&&!p.startsWith(".switchyard-history/")), grantInput = { ...f.proposed, paths: ["task.txt", ...included], classifications: { includedUntracked: included.filter(p=>(!ignoredSecrets||p!==".env")&&(!(stagedIndex||historyInputs)||p!=="app.js")), ...(ignoredSecrets?{includedIgnored:[".env"]}:{}), ...(ignoredBuildTree?{excludedIgnoredTrees:["node_modules"]}:{}) }, actions: [action] }, approval = await f.service.review("personal", grantInput), grant = await f.service.issue("personal", { ...grantInput, token: approval.confirmation.token });
  const exceptionService=exceptions?createShieldExceptions({store:f.store,authority:f.service,now:f.now}):undefined;if(exceptionService)f.onCleanup(()=>exceptionService.close());
  let resolutions = 0;
  const execution = createRepositoryExecution({ store: f.store, authority: f.service, stateDirectory: join(f.stage, "execution"), ...(exceptionService?{resolveShieldExceptions:(c,input)=>exceptionService.evaluate(c,input)}:{}), resolveScannerFixtures: async (c, input) => { resolutions++; if (revokeAfterRun && resolutions === 4) await perform("revoke-fixture", { fixtureId: sample.request.scanner.id, reason: "Synthetic post-execution revocation" }); return fixtures.resolve(c, input); } }); f.onCleanup(() => execution.close());
  return { ...f, fixtures, execution, exceptions:exceptionService, sample, recipe, manifest, perform, grantInput, resolutions: () => resolutions, proposed: { requestId: randomUUID(), authorityId: grant.id, manifestPath: "shield.json", manifestSha256: sha(bytes), action } };
}
