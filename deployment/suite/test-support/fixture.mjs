import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, lstat, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { studioAssets } from "../../../tools/layout-studio/serve.mjs";
import { buildSuiteRelease } from "../release.mjs";
export const sourceRoot = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
// Release verification also runs from an exported source tree with no .git.
const sourceFiles = ["packages/protocol/src/b122.ts", "apps/windows-companion/src/mediated-git.ts", "apps/windows-companion/src/git-content-stager.ts", "apps/windows-companion/src/git-index-lease.ts", "apps/vscode-extension/src/codex-daemon-status.cjs", "scripts/setup-switchyard-runtime.mjs", "scripts/workflow-monitor.mjs", "scripts/workflow-capture.mjs", "ATTRIBUTION.md", "apps/desktop-hotkeys/Program.cs", "apps/desktop-hotkeys/RuntimeCommandRunner.cs", "apps/desktop-hotkeys/Switchyard.Hotkeys.csproj", "deployment/windows/licenses/DOTNET-RUNTIME-LICENSE.txt", "deployment/windows/licenses/DOTNET-RUNTIME-THIRD-PARTY-NOTICES.txt"];
sourceFiles.push("apps/windows-setup/Setup.cpp","deployment/windows/Build-SwitchyardSetup.ps1");
sourceFiles.push("apps/windows-companion/src/repository-runtime.ts", "apps/windows-companion/src/repository-runtime-broker.ts", "apps/windows-companion/src/repository-inputs.ts", "apps/linux-companion/src/linux-repository-runtime.ts", "apps/linux-companion/src/linux-repository-inputs.ts");
sourceFiles.push("apps/windows-companion/src/scanner-fixtures.ts", "apps/windows-companion/src/receipt-evidence.ts", "apps/desktop-hotkeys/WindowsStoragePrerequisites.cs");
sourceFiles.push("apps/desktop-hotkeys/WindowsStorageBrokerProtocol.cs");
sourceFiles.push("apps/desktop-hotkeys/WindowsStorageBrokerFiles.cs");
for(const entry of await readdir(join(sourceRoot,"apps/desktop-hotkeys"),{withFileTypes:true}))if(entry.isFile()&&/\.(cs|csproj)$/.test(entry.name))sourceFiles.push(`apps/desktop-hotkeys/${entry.name}`);
sourceFiles.push("apps/desktop-hotkeys/ReviewedInputStager.cs", "apps/desktop-hotkeys/BoundedExchangeImage.cs", "apps/desktop-hotkeys/BoundedExchangeVolume.cs", "apps/desktop-hotkeys/WindowsSandboxCli.cs", "apps/windows-companion/sandbox-helper/Program.cs", "apps/windows-companion/src/windows-sandbox.ts", "apps/windows-companion/src/execution-cancellation.ts");
for (const name of ["pure-template.svg", "template-faces.json", "pure-template.pdf", "README.md", "ReadMe.txt"]) sourceFiles.push(`third-party/cyber_engineer/${name}`);
for (const prefix of ["packages/control-plane/src", "tools/layout-studio", "integrations", "examples/custom-agent", "examples/langchain-agent", "deployment/suite", "third_party/model-f-catalog"]) for (const name of await readdir(join(sourceRoot, prefix), { recursive: true })) if ((await lstat(join(sourceRoot, prefix, name))).isFile()) sourceFiles.push(`${prefix}/${name.replaceAll("\\", "/")}`);
const hash = (b) => createHash("sha256").update(b).digest("hex");
export async function fixture(fn, platform = "linux") {
  const root = join(sourceRoot, "artifacts", `st-${randomUUID().slice(0,8)}`), frontendRoot = join(root, "review");
  await mkdir(frontendRoot, { recursive: true, mode: 0o700 }); await writeFile(join(root, "fault-helper.exe"), "Synthetic fixture; never executed as a native helper.", {mode:0o600}); const files = [];
  for (const name of new Set([...studioAssets.values()].map((v) => v[0]))) { const data = await readFile(join(sourceRoot, "tools/layout-studio", name)); await writeFile(join(frontendRoot, name), data, { mode: 0o600 }); files.push({ file: name, sha256: hash(data) }); }
  const digest = hash(JSON.stringify(files)); await writeFile(join(frontendRoot, "manifest.json"), JSON.stringify({ schema: "switchyard-front-end-review/v1", digest, files }), { mode: 0o600 });
  const options = { sourceRoot, sourceFiles, frontendRoot, outputRoot: join(root, "bundles"), sourceCommit: "a".repeat(40), development: true, platform, windowsHotkeys: join(root, "fault-helper.exe"), ...(platform==="win32"?{windowsSetup:join(root,"fault-helper.exe")}: {}) };
  try { await fn({ root, frontendRoot, options, bundle: await buildSuiteRelease(options) }); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
