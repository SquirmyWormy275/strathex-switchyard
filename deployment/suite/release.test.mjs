import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, lstat, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { studioAssets } from "../../tools/layout-studio/serve.mjs";
import { buildSuiteRelease, verifySuiteRelease } from "./release.mjs";
const sourceRoot = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
// Release verification also runs from an exported source tree with no .git.
const sourceFiles = ["apps/vscode-extension/src/codex-daemon-status.cjs", "packages/control-plane/src/confirmations.ts", "packages/control-plane/src/store.ts", "packages/control-plane/src/redaction.ts", "scripts/setup-switchyard-runtime.mjs", "scripts/workflow-monitor.mjs", "scripts/workflow-capture.mjs", "ATTRIBUTION.md"];
for (const prefix of ["tools/layout-studio", "integrations", "examples/custom-agent", "examples/langchain-agent", "deployment/suite", "third_party/model-f-catalog"]) for (const name of await readdir(join(sourceRoot, prefix), { recursive: true })) if ((await lstat(join(sourceRoot, prefix, name))).isFile()) sourceFiles.push(`${prefix}/${name.replaceAll("\\", "/")}`);
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function fixture(fn) {
  const root = join(sourceRoot, "artifacts", `suite-release-test-${randomUUID()}`), frontendRoot = join(root, "review");
  await mkdir(frontendRoot, { recursive: true, mode: 0o700 }); const files = [];
  for (const name of new Set([...studioAssets.values()].map((v) => v[0]))) { const data = await readFile(join(sourceRoot, "tools/layout-studio", name)); await writeFile(join(frontendRoot, name), data, { mode: 0o600 }); files.push({ file: name, sha256: hash(data) }); }
  const digest = hash(JSON.stringify(files)); await writeFile(join(frontendRoot, "manifest.json"), JSON.stringify({ schema: "switchyard-front-end-review/v1", digest, files }), { mode: 0o600 });
  const options = { sourceRoot, sourceFiles, frontendRoot, outputRoot: join(root, "bundles"), sourceCommit: "a".repeat(40), development: true, platform: "linux" };
  try { await fn({ root, frontendRoot, options, bundle: await buildSuiteRelease(options) }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
test("suite bundles contain the actual offline backend, frozen frontend and licenses without private data, tests or copied runtimes", () => fixture(async ({ bundle, options }) => {
  const manifest = await verifySuiteRelease(bundle.directory, { expectedId: bundle.id, platform: "linux", checkRuntime: true });
  assert.ok(bundle.bytes < 4 * 1024 * 1024); assert.equal(manifest.integrity, "sha256-content-manifest-not-signed");
  assert.ok(manifest.files.some((f) => f.path.endsWith("mymakercorner/LICENSE"))); assert.ok(manifest.files.some((f) => f.path === "integrations/switchyard_agent.py"));
  assert.equal(manifest.files.some((f) => /(?:\.test\.|\.sealed\.|\.git\/|node_modules\/|\.venv\/|__pycache__\/|\.pyc$|base\.en\/)/.test(f.path)), false);
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
  await assert.rejects(buildSuiteRelease({ ...options, platform: "win32" }), /native hotkey helper/);
  await writeFile(join(frontendRoot, "index.html"), "review changed"); await assert.rejects(buildSuiteRelease(options), /frozen frontend asset/);
}));
