import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSuiteRelease, verifySuiteRelease, readReleaseFile } from "./release.mjs";
import { fixture, sourceRoot } from "./test-support/fixture.mjs";
test("release verification rejects a different adjacent 64-bit file identity before reading content", async () => {
  const original = 2n ** 60n, replacement = original + 1n; assert.equal(Number(original), Number(replacement));
  let swapped = true, reads = 0, closed = 0;
  const stats = (id, options) => ({ ino: options?.bigint ? id : Number(id), dev: options?.bigint ? 1n : 1, size: options?.bigint ? 4n : 4, uid: options?.bigint ? 0n : 0, mode: options?.bigint ? 0o600n : 0o600, isFile: () => true, isSymbolicLink: () => false });
  const options = { openFile: async () => ({ stat: async (o) => stats(original, o), readFile: async () => { reads++; return Buffer.from("safe"); }, close: async () => { closed++; } }), statName: async (_, o) => stats(swapped ? replacement : original, o) };
  await assert.rejects(readReleaseFile("synthetic", options), /unsafe, changed/); assert.equal(reads, 0); assert.equal(closed, 1);
  swapped = false; assert.equal((await readReleaseFile("synthetic", options)).toString(), "safe"); assert.equal(closed, 2);
});
test("suite bundles contain the actual offline backend, frozen frontend and licenses without private data, tests or copied runtimes", () => fixture(async ({ bundle, options }) => {
  const manifest = await verifySuiteRelease(bundle.directory, { expectedId: bundle.id, platform: "linux", checkRuntime: true });
  const { reviewDesignObservations } = await import(pathToFileURL(join(bundle.directory, "tools/layout-studio/design-observations.mjs")).href);
  assert.equal(typeof reviewDesignObservations, "function");
  for (const name of ["index.html", "style.css", "app.mjs", "home.mjs", "shell.mjs", "keyboard-view.mjs", "suite-ui.mjs", "device-ui.mjs", "model-f-catalog.json", "connection.mjs", "sample-info.json", "sample-keymap.json", "sample-study-report.json"]) {
    assert.equal(manifest.files.some(file => file.path === `tools/layout-studio/${name}`), false, "Browser-only modules and static assets must ship once in the frozen frontend.");
    assert.ok(manifest.files.some(file => file.path === `frontend/${name}`));
  }
  assert.ok(manifest.files.some(file => file.path === "tools/layout-studio/catalog.mjs"), "The readout backend still needs its shared catalog.");
  for (const name of ["workflow-artifacts", "context-packages", "voice"]) assert.equal(manifest.files.some(file => file.path === `packages/control-plane/src/${name}.ts`), false, "Separate companion implementations reached only through erased types must not inflate the installed app.");
  await import(pathToFileURL(join(bundle.directory, "packages/control-plane/src/runtime.ts")).href);
  const catalog = await import(pathToFileURL(join(bundle.directory, "tools/layout-studio/model-f-source.mjs")).href);
  assert.deepEqual(catalog.default, JSON.parse(await readFile(join(bundle.directory, "frontend/model-f-catalog.json"), "utf8")), "The packaged backend must consume the exact frozen catalog.");
  const { cvssV4Metrics } = await import(pathToFileURL(join(bundle.directory, "tools/layout-studio/cvss-v4-metrics.mjs")).href);
  const v4 = cvssV4Metrics("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:U/MVC:N/MVI:N/MVA:N");
  assert.deepEqual([v4.baseScore, v4.score, v4.severity], [9.3, 0, "critical"]);
  const scoringData = await readFile(join(bundle.directory, "tools/layout-studio/cvss-v4-data.mjs"), "utf8");
  assert.match(scoringData, /SPDX-License-Identifier: BSD-2-Clause/); assert.match(scoringData, /Copyright \(c\) 2023 FIRST\.ORG, Inc\., Red Hat, and contributors/); assert.match(scoringData, /THIS SOFTWARE IS PROVIDED/);
  const { openCodexEditorIngress } = await import(pathToFileURL(join(bundle.directory, "tools/layout-studio/codex-editor-ingress.mjs")).href);
  assert.equal(typeof openCodexEditorIngress, "function");
  const { createCodexEditorRelay } = await import(pathToFileURL(join(bundle.directory, "tools/layout-studio/codex-editor-relay.mjs")).href);
  assert.equal(typeof createCodexEditorRelay, "function");
  const { createCodingEditorJournal } = await import(pathToFileURL(join(bundle.directory, "tools/layout-studio/coding-editor-journal.mjs")).href);
  assert.equal(typeof createCodingEditorJournal, "function");
  const { createCodingEditorConnections } = await import(pathToFileURL(join(bundle.directory, "tools/layout-studio/coding-editor-connections.mjs")).href);
  assert.equal(typeof createCodingEditorConnections, "function");
  const { retireStoppedEditorConnection } = await import(pathToFileURL(join(bundle.directory, "tools/layout-studio/codex-editor-recovery.mjs")).href);
  assert.equal(typeof retireStoppedEditorConnection, "function");
  const ingressPath = "tools/layout-studio/codex-editor-ingress.py";
  assert.equal(await readFile(join(bundle.directory, ingressPath), "utf8"), await readFile(join(sourceRoot, ingressPath), "utf8"));
  const { createCodexEditorProtocol } = await import(pathToFileURL(join(bundle.directory, "tools/layout-studio/codex-editor-protocol.mjs")).href);
  const protocol = createCodexEditorProtocol({ sessionId: "11111111-1111-4111-8111-111111111111", repositoryRoot: "/synthetic/repository", accountFingerprint: "a".repeat(64) });
  assert.equal(protocol.observation().ideAttached, false); protocol.close(); assert.equal(protocol.observation().protocolAcknowledged, false);
  assert.ok(bundle.bytes < 5 * 1024 * 1024); assert.equal(manifest.integrity, "sha256-content-manifest-not-signed");
  for (const path of ["integrations/README.md", "tools/layout-studio/README.md", "deployment/suite/frontend-review.json"]) { assert.equal(manifest.files.some(file => file.path === path), false); assert.ok((await readFile(join(sourceRoot, path))).length > 0); }
  assert.ok(manifest.files.some(file => file.path === "ATTRIBUTION.md"));
  const manifestBytes = await readFile(join(bundle.directory, "switchyard-release.json"));
  assert.deepEqual(JSON.parse(manifestBytes), manifest);
  assert.ok(bundle.bytes + manifestBytes.length < 5 * 1024 * 1024, "The full Linux package, including its integrity manifest, must stay below the original budget.");
  const provenancePath = "third_party/model-f-catalog/SOURCES.json", provenance = JSON.parse(await readFile(join(options.sourceRoot, provenancePath), "utf8"));
  const { default: decodedProvenance } = await import(pathToFileURL(join(bundle.directory, "tools/layout-studio/catalog-source.mjs")).href);
  assert.deepEqual(decodedProvenance, provenance, "Compressed provenance retains every source revision, hash, notice and metadata field.");
  assert.ok(manifest.files.some(f => f.path === provenancePath + ".gz")); assert.equal(manifest.files.some(f => f.path === provenancePath), false);
  assert.ok(manifest.files.some((f) => f.path.endsWith("mymakercorner/LICENSE"))); assert.ok(manifest.files.some((f) => f.path === "integrations/switchyard_agent.py"));
  for (const name of ["pure-template.svg", "template-faces.json", "pure-template.pdf", "README.md", "ReadMe.txt"]) assert.ok(manifest.files.some((f) => f.path === `third-party/cyber_engineer/${name}`));
  assert.equal(manifest.files.some((f) => /(?:\.test\.|test-support\/|\.sealed\.|\.git\/|node_modules\/|\.venv\/|__pycache__\/|\.pyc$|base\.en\/)/.test(f.path)), false);
  assert.equal((await buildSuiteRelease(options)).id, bundle.id, "rebuilding identical inputs must reuse one verified bundle");
  const serve = pathToFileURL(join(bundle.directory, "tools/layout-studio/serve.mjs")).href;
  assert.ok(manifest.files.some(file => file.path === "apps/windows-companion/src/scanner-fixtures.ts"), "The signed fixture registry must ship with the actual Suite backend.");
  const served = Object.fromEntries(["connection.mjs", "sample-info.json", "sample-keymap.json", "sample-study-report.json"].map(name => ["/" + name, manifest.files.find(f => f.path === "frontend/" + name).sha256]));
  const script = `await import(${JSON.stringify(pathToFileURL(join(bundle.directory, "apps/windows-companion/src/windows-sandbox.ts")).href)});await import(${JSON.stringify(pathToFileURL(join(bundle.directory, "tools/layout-studio/repository-effect-recovery.mjs")).href)});await import(${JSON.stringify(pathToFileURL(join(bundle.directory, "packages/control-plane/src/runtime.ts")).href)});await import(${JSON.stringify(pathToFileURL(join(bundle.directory, "tools/layout-studio/repository-effect-commands.mjs")).href)});await import(${JSON.stringify(pathToFileURL(join(bundle.directory, "tools/layout-studio/repository-effect-checkpoints.mjs")).href)});await import(${JSON.stringify(pathToFileURL(join(bundle.directory, "apps/windows-companion/src/mediated-git.ts")).href)});import{createStudioServer}from ${JSON.stringify(serve)};const s=createStudioServer({assetRoot:${JSON.stringify(join(bundle.directory, "frontend"))}});s.listen(0,'127.0.0.1',async()=>{try{let r=await fetch('http://127.0.0.1:'+s.address().port+'/');if(r.status!==200||!(await r.text()).includes('Switchyard'))throw Error('missing frontend');for(const [path,digest]of Object.entries(${JSON.stringify(served)})){const asset=await fetch('http://127.0.0.1:'+s.address().port+path);if(asset.status!==200||(await import('node:crypto')).createHash('sha256').update(Buffer.from(await asset.arrayBuffer())).digest('hex')!==digest)throw Error('frozen asset missing or changed');}r=await fetch('http://127.0.0.1:'+s.address().port+'/api/discovery');if(r.status!==401)throw Error('missing authorization');}catch(e){console.error(e.message);process.exitCode=1;}finally{s.closeAllConnections();s.close();}});`;
  await new Promise((resolve, reject) => { const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: bundle.directory, shell: false, stdio: ["ignore", "ignore", "pipe"] }); let diagnostic = ""; child.stderr.on("data", (b) => { if (diagnostic.length < 2048) diagnostic += b; }); const timer = setTimeout(() => child.kill("SIGKILL"), 10000); child.once("error", reject); child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Actual packaged server failed: ${diagnostic}`)); }); });
}));
test("release verification rejects changed, missing, additional and mis-scoped contents without rewriting them", () => fixture(async ({ bundle }) => {
  await assert.rejects(verifySuiteRelease(bundle.directory, { expectedId: "0".repeat(64) }), /expected content identity/);
  await assert.rejects(verifySuiteRelease(bundle.directory, { platform: "win32" }), /another operating system/);
  const path = join(bundle.directory, "frontend/index.html"), original = await readFile(path); await writeFile(path, "changed");
  await assert.rejects(verifySuiteRelease(bundle.directory), /integrity failed/); assert.equal(await readFile(path, "utf8"), "changed"); await writeFile(path, original);
  const extra = join(bundle.directory, "unmanifested.txt"); await writeFile(extra, "unexpected"); await assert.rejects(verifySuiteRelease(bundle.directory), /unmanifested/); await rm(extra);
  await rm(path); await assert.rejects(verifySuiteRelease(bundle.directory), /missing/);
}));
test("the Windows bundle includes broker/bootstrap sources and the linked guest worker needed to rebuild its helper",()=>fixture(async({bundle})=>{
  const manifest=await verifySuiteRelease(bundle.directory,{expectedId:bundle.id,platform:"win32"});
  for(const name of ["WindowsStorageBroker.cs","WindowsStorageBrokerBootstrap.cs","WindowsStorageBrokerService.cs","WindowsStorageBrokerControl.cs","WindowsStorageBrokerPipe.cs","WindowsStorageBrokerRuntime.cs","WindowsStorageBrokerDiagnostic.cs","RuntimePackageMetadata.cs"]){
    assert.ok(manifest.files.some(file=>file.path===`apps/desktop-hotkeys/${name}`),`The shipped helper cannot be rebuilt without ${name}.`);
  }
  assert.match(await readFile(join(bundle.directory,"apps/desktop-hotkeys/Switchyard.Hotkeys.csproj"),"utf8"),/\.\.\/windows-companion\/sandbox-helper\/Program.cs/);
  assert.ok(manifest.files.some(file=>file.path==="apps/windows-companion/sandbox-helper/Program.cs"));
  assert.ok(manifest.files.some(file=>file.path==="runtime/hotkeys/Switchyard.Setup.exe"));
  assert.ok(manifest.files.some(file=>file.path==="apps/windows-setup/Setup.cpp"));
  assert.ok(manifest.files.some(file=>file.path==="deployment/windows/Build-SwitchyardSetup.ps1"));
},"win32"));
test("release identity binds file names, platform, revision and the complete frozen frontend; builders refuse changed reviews and missing Windows helpers", () => fixture(async ({ bundle, options, frontendRoot }) => {
  const manifestPath = join(bundle.directory, "switchyard-release.json"), original = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, JSON.stringify({ ...original, sourceCommit: "b".repeat(40) })); await assert.rejects(verifySuiteRelease(bundle.directory), /content identity/);
  await writeFile(manifestPath, JSON.stringify({ ...original, files: [{ ...original.files[0], path: "../escape" }, ...original.files.slice(1)] })); await assert.rejects(verifySuiteRelease(bundle.directory), /portable relative/);
  await assert.rejects(buildSuiteRelease({ ...options, platform: "win32", windowsHotkeys: undefined }), /native hotkey helper/);
  await writeFile(join(frontendRoot, "index.html"), "review changed"); await assert.rejects(buildSuiteRelease(options), /frozen frontend asset/);
}));
