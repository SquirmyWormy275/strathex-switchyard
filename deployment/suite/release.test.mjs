import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSuiteRelease, verifySuiteRelease } from "./release.mjs";
import { fixture } from "./test-support/fixture.mjs";
test("suite bundles contain the actual offline backend, frozen frontend and licenses without private data, tests or copied runtimes", () => fixture(async ({ bundle, options }) => {
  const manifest = await verifySuiteRelease(bundle.directory, { expectedId: bundle.id, platform: "linux", checkRuntime: true });
  assert.ok(bundle.bytes < 4 * 1024 * 1024); assert.equal(manifest.integrity, "sha256-content-manifest-not-signed");
  assert.ok(manifest.files.some((f) => f.path.endsWith("mymakercorner/LICENSE"))); assert.ok(manifest.files.some((f) => f.path === "integrations/switchyard_agent.py"));
  assert.equal(manifest.files.some((f) => /(?:\.test\.|test-support\/|\.sealed\.|\.git\/|node_modules\/|\.venv\/|__pycache__\/|\.pyc$|base\.en\/)/.test(f.path)), false);
  assert.equal((await buildSuiteRelease(options)).id, bundle.id, "rebuilding identical inputs must reuse one verified bundle");
  const serve = pathToFileURL(join(bundle.directory, "tools/layout-studio/serve.mjs")).href;
  const script = `import{createStudioServer}from ${JSON.stringify(serve)};const s=createStudioServer({assetRoot:${JSON.stringify(join(bundle.directory, "frontend"))}});s.listen(0,'127.0.0.1',async()=>{try{let r=await fetch('http://127.0.0.1:'+s.address().port+'/');if(r.status!==200||!(await r.text()).includes('Switchyard'))throw Error('missing frontend');r=await fetch('http://127.0.0.1:'+s.address().port+'/api/discovery');if(r.status!==401)throw Error('missing authorization');}catch(e){console.error(e.message);process.exitCode=1;}finally{s.closeAllConnections();s.close();}});`;
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
test("release identity binds file names, platform, revision and the complete frozen frontend; builders refuse changed reviews and missing Windows helpers", () => fixture(async ({ bundle, options, frontendRoot }) => {
  const manifestPath = join(bundle.directory, "switchyard-release.json"), original = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, JSON.stringify({ ...original, sourceCommit: "b".repeat(40) })); await assert.rejects(verifySuiteRelease(bundle.directory), /content identity/);
  await writeFile(manifestPath, JSON.stringify({ ...original, files: [{ ...original.files[0], path: "../escape" }, ...original.files.slice(1)] })); await assert.rejects(verifySuiteRelease(bundle.directory), /portable relative/);
  await assert.rejects(buildSuiteRelease({ ...options, platform: "win32", windowsHotkeys: undefined }), /native hotkey helper/);
  await writeFile(join(frontendRoot, "index.html"), "review changed"); await assert.rejects(buildSuiteRelease(options), /frozen frontend asset/);
}));
