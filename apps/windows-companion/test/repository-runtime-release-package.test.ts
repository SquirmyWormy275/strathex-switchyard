import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const deployment = join(root, "deployment", "windows");
const recipeIds = [
  "full_sandbox",
  "quarantine",
  "pipeline_local_gate",
  "pipeline_clean_reproduction",
  "shield_change_scan",
  "shield_codebase_audit",
  "shield_supply_chain",
  "release_shield"
] as const;

test("Windows release packages and attests the pinned Job-Object helper", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const start = await readFile(join(deployment, "Start-B122.ps1"), "utf8");
  for (const expected of [
    "RepositoryRuntimeHelperPath",
    "RepositoryRuntimeHelperSha256",
    "repository-runner-helper\\Sxsy.B122.RepositoryRunner.csproj",
    "b122-repository-runner.exe",
    "repositoryRuntimeHelperSha256",
    "--self-test"
  ]) assert.equal(build.includes(expected), true, `release build is missing ${expected}`);
  assert.match(artifact, /repositoryRuntimeHelperSha256/);
  assert.match(artifact, /repository-runner-helper\/Program\.cs/);
  assert.match(portable, /repositoryRuntimeContainmentSelfTest=\$true/);
  assert.match(start, /b122-repository-runner\.exe/);
});

test("Windows release packages and runtime-pins the companion lifecycle supervisor", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const project = await readFile(join(root, "apps", "windows-companion", "companion-lifecycle-helper", "Sxsy.B122.CompanionLifecycleHelper.csproj"), "utf8");
  for (const expected of [
    "CompanionLifecycleHelperPath",
    "CompanionLifecycleHelperSha256",
    "companion-lifecycle-helper\\Sxsy.B122.CompanionLifecycleHelper.csproj",
    "b122-companion-supervisor.exe",
    "companionLifecycleHelperSha256",
    "sxsy-b122.companion-supervisor-self-test"
  ]) assert.equal(build.includes(expected), true, `release build is missing ${expected}`);
  assert.match(project, /<RuntimeFrameworkVersion>8\.0\.30<\/RuntimeFrameworkVersion>/);
  assert.match(artifact, /companionLifecycleHelperSha256/);
  assert.match(artifact, /companion-lifecycle-helper\/Program\.cs/);
  assert.match(portable, /b122-companion-supervisor\.exe/);
  assert.match(portable, /sxsy-b122\.companion-supervisor-self-test/);
  assert.match(portable, /capturedProcesses/);
  assert.match(portable, /activeProcesses/);
  assert.match(portable, /processTreeSurvivors/);
  assert.match(portable, /function Invoke-B122PortableExactTreeKill/);
  assert.match(portable, /foreach \(\$identity in \$survivors\) \{ Invoke-B122PortableExactTreeKill \$identity \}/);
  assert.match(portable, /created=\$\(\[string\]\$_\.createdAt\)/);
  const unhealthyCleanup = portable.indexOf("The unhealthy portable companion did not exit after exact process-tree cleanup.");
  const diagnosticRead = portable.indexOf("$companionDetail = Read-B122PortableBoundedFile $stderr");
  assert.ok(unhealthyCleanup >= 0 && diagnosticRead > unhealthyCleanup);
  assert.match(portable, /\$process\.Dispose\(\)/);
});

test("Windows release binds the reviewed local dotnet toolchain and isolates nested build authority", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const toolchain = JSON.parse(await readFile(join(deployment, "dotnet-toolchain.json"), "utf8")) as {
    schema: string;
    version: number;
    sdkVersion: string;
    runtimeVersion: string;
    dotnetExeSha256: string;
    nugetConfigSha256: string;
    runtimePackages: Array<{ id: string; version: string; sha256: string }>;
  };

  assert.equal(toolchain.schema, "sxsy-b122.dotnet-toolchain");
  assert.equal(toolchain.version, 1);
  assert.equal(toolchain.sdkVersion, "8.0.424");
  assert.equal(toolchain.runtimeVersion, "8.0.30");
  assert.match(toolchain.dotnetExeSha256, /^[0-9a-f]{64}$/);
  assert.match(toolchain.nugetConfigSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(toolchain.runtimePackages.map(({ id, version }) => `${id}@${version}`).sort(), [
    "microsoft.aspnetcore.app.runtime.win-x64@8.0.30",
    "microsoft.netcore.app.runtime.win-x64@8.0.30",
    "microsoft.windowsdesktop.app.runtime.win-x64@8.0.30"
  ]);
  assert.equal(toolchain.runtimePackages.every(({ sha256 }) => /^[0-9a-f]{64}$/.test(sha256)), true);

  assert.doesNotMatch(build, /Get-Command\s+dotnet\.exe/);
  for (const expected of [
    "dotnet-toolchain.json",
    ".tools\\dotnet\\dotnet.exe",
    ".tools\\NuGet.Config",
    "Invoke-B122WithIsolatedBuildEnvironment",
    "npm_config_userconfig",
    "npm_config_globalconfig",
    "DOTNET_CLI_HOME",
    "NUGET_PACKAGES",
    "SXSY_B122_BUILD_SECRET_SENTINEL",
    "dotnetExeSha256",
    "nugetConfigSha256",
    "runtimePackages"
  ]) assert.equal(build.includes(expected), true, `release builder does not bind ${expected}`);
  assert.match(artifact, /dotnetRuntime\.sdkVersion/);
  assert.match(artifact, /dotnetRuntime\.dotnetExeSha256/);
  assert.match(artifact, /dotnetRuntime\.nugetConfigSha256/);
  assert.match(artifact, /dotnetRuntime\.runtimePackages/);
});

test("Windows release packages both exact provider workflow-context observation routes", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const networkPolicy = await readFile(join(deployment, "New-B122NetworkPolicy.ps1"), "utf8");
  assert.match(build, /New-B122NetworkPolicy\.ps1/);
  assert.match(artifact, /provider\.observe-workflow-context\.claude/);
  assert.match(artifact, /provider\.observe-workflow-context\.codex/);
  for (const provider of ["claude", "codex"] as const) {
    assert.equal(networkPolicy.includes(`("provider.observe-workflow-context.$provider") 'POST' ("$base/v1/b122/observe/workflow-context/$provider")`), true, `packaged policy is missing exact ${provider} workflow-context observation route`);
  }
});

test("Windows release packages only exact provider Re-anchor and automation proposal policy routes", async () => {
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const networkPolicy = await readFile(join(deployment, "New-B122NetworkPolicy.ps1"), "utf8");
  const bootstrap = await readFile(join(root, "apps", "windows-companion", "src", "bootstrap.ts"), "utf8");
  for (const provider of ["claude", "codex"] as const) {
    assert.equal(networkPolicy.includes(`("provider.reanchor.$provider") 'POST' ("$base/v1/b122/reanchor/$provider")`), true, `packaged policy is missing exact ${provider} Re-anchor apply route`);
    assert.equal(networkPolicy.includes(`("provider.observe-reanchor.$provider") 'POST' ("$base/v1/b122/observe/reanchor/$provider")`), true, `packaged policy is missing exact ${provider} Re-anchor observation route`);
  }
  for (const action of ["compound_capture", "compound_refresh", "lfg", "repair_mission"] as const) {
    assert.equal(networkPolicy.includes(`("automation.proposal.$action") 'POST' ("$base/v1/b122/automation-proposal/$action")`), true, `packaged policy is missing exact ${action} proposal route`);
    assert.equal(networkPolicy.includes(`("automation.$action") 'POST' ("$base/v1/b122/automation/$action")`), false, `packaged policy must not expose provider-owned ${action} effects`);
  }
  assert.equal(networkPolicy.includes(`("provider.reanchor") 'POST' ("$base/v1/b122/command/reanchor")`), false);
  assert.equal(bootstrap.includes("remoteAutomationActions"), false, "installed recovery must not route host-local automation through provider effect observation");
  assert.match(artifact, /provider\.observe-reanchor\.\$provider/);
  assert.match(artifact, /automation\.proposal\.\$action/);
});

test("Windows release packages, self-tests, and provenance-binds the native voice helper", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const start = await readFile(join(deployment, "Start-B122.ps1"), "utf8");
  const routes = await readFile(join(deployment, "Manage-B122VoiceRoute.ps1"), "utf8");
  for (const expected of [
    "VoiceHelperPath",
    "VoiceHelperSha256",
    "voice-helper\\Sxsy.B122.VoiceHelper.csproj",
    "sxsy-b122-voice-helper.exe",
    "sxsy-b122.voice-helper-self-test",
    "voiceHelperSha256",
    "Manage-B122VoiceRoute.ps1"
  ]) assert.equal(build.includes(expected), true, `release build is missing ${expected}`);
  assert.match(artifact, /voiceHelperSha256/);
  assert.match(artifact, /voice-helper\/Program\.cs/);
  assert.match(artifact, /Manage-B122VoiceRoute\.ps1/);
  assert.match(portable, /voiceHelperSelfTest=\$true/);
  assert.match(portable, /unconsented portable companion launched the voice helper/);
  assert.match(start, /sxsy-b122-voice-helper\.exe/);
  assert.match(routes, /credential-ref:(?:claude|chatgpt)-current-user/);
  assert.match(routes, /Exact current-user confirmation/);
  assert.match(routes, /Test-B122ReleaseArtifact\.ps1/);
  assert.match(routes, /Assert-VoiceHelperIdentity/);
  assert.match(routes, /voiceHelperSha256/);
  assert.match(routes, /ReparsePoint/);
});

test("Windows release packages, self-tests, and provenance-binds the exact Sandbox lifecycle helper", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const start = await readFile(join(deployment, "Start-B122.ps1"), "utf8");
  for (const expected of [
    "SandboxLifecycleHelperPath",
    "SandboxLifecycleHelperSha256",
    "sandbox-lifecycle-helper\\Sxsy.B122.SandboxLifecycleHelper.csproj",
    "b122-sandbox-lifecycle.exe",
    "sxsy-b122.sandbox-lifecycle-self-test",
    "sandboxLifecycleHelperSha256"
  ]) assert.equal(build.includes(expected), true, `release build is missing ${expected}`);
  assert.match(artifact, /sandboxLifecycleHelperSha256/);
  assert.match(artifact, /sandbox-lifecycle-helper\/Program\.cs/);
  assert.match(artifact, /sandbox-lifecycle-helper\/Sxsy\.B122\.SandboxLifecycleHelper\.csproj/);
  assert.match(portable, /sandboxLifecycleHelperPresent=\$true/);
  assert.match(portable, /sandboxLifecycleSelfTest=\$true/);
  assert.match(start, /b122-sandbox-lifecycle\.exe/);
});

test("Windows release exercises and attests the complete no-hardware Raw-HID product simulator", async () => {
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const start = await readFile(join(deployment, "Start-B122.ps1"), "utf8");
  const companionPackage = await readFile(join(root, "apps", "windows-companion", "package.json"), "utf8");
  assert.match(companionPackage, /"sxsy-b122-hid-simulator"\s*:\s*"dist\/apps\/windows-companion\/src\/raw-hid-simulator\.js"/);
  assert.match(portable, /raw-hid-simulator\.js/);
  assert.match(portable, /sxsy-b122\.raw-hid-simulation/);
  for (const receiptField of ["chordsExercised", "assignedChords", "unassignedChords", "duplicateAcknowledgedWithoutRedispatch", "staleEpochRejected", "corruptFrameRejected", "hardwareAccessed", "networkAccessed"]) {
    assert.equal(portable.includes(receiptField), true, `portable verification is missing Raw-HID receipt field ${receiptField}`);
  }
  assert.match(portable, /rawHidSimulationSelfTest=\$true/);
  assert.match(artifact, /rawHidSimulationSelfTest/);
  assert.match(artifact, /raw-hid-simulator\.js/);
  assert.match(artifact, /raw-hid-simulator\.ts/);
  assert.match(start, /raw-hid-simulator\.js/);
});

test("Windows release packages the authenticated Council participant client", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const start = await readFile(join(deployment, "Start-B122.ps1"), "utf8");
  const companionPackage = await readFile(join(root, "apps", "windows-companion", "package.json"), "utf8");
  assert.match(companionPackage, /"sxsy-b122-council-participant"\s*:\s*"dist\/apps\/windows-companion\/src\/council-participant-main\.js"/);
  assert.match(build, /council-participant-main\.js/);
  assert.match(portable, /council-participant-main\.js/);
  assert.match(portable, /councilParticipantPresent=\$true/);
  assert.match(artifact, /council-participant-main\.js/);
  assert.match(artifact, /council-participant-main\.ts/);
  assert.match(start, /council-participant-main\.js/);
});

test("Windows release inventories the complete provider host and its protected provisioning surface", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const start = await readFile(join(deployment, "Start-B122.ps1"), "utf8");
  const providerPackage = await readFile(join(root, "apps", "provider-adapter-host", "package.json"), "utf8");
  assert.match(providerPackage, /"sxsy-b122-provider-adapter-host"\s*:\s*"dist\/apps\/provider-adapter-host\/src\/main\.js"/);

  const installedPayloads = [
    "dist\\apps\\provider-adapter-host\\src\\main.js",
    "index.js",
    "server.js",
    "secret-envelope.js",
    "windows-path-security.js",
    "council-resources.js",
    "Initialize-B122ProviderHost.ps1",
    "Protect-B122ProviderHostSecret.ps1",
    "New-B122LoopbackTlsIdentity.mjs",
    "Get-B122TlsIdentity.mjs",
    "Provision-B122ProviderHostCompanion.mjs",
    "New-B122ProviderHostConfiguration.ps1",
    "Test-B122ProviderHostConfiguration.ps1",
    "Restore-B122ProviderHostConfiguration.ps1",
    "Manage-B122ProviderHost.ps1",
    "Test-B122ProviderHostHealth.mjs",
    "New-B122NetworkPolicy.ps1"
  ];
  for (const payload of installedPayloads) {
    assert.equal(build.includes(payload), true, `release build does not explicitly carry ${payload}`);
    assert.equal(artifact.includes(payload.replaceAll("\\", "/")) || artifact.includes(payload), true, `artifact validator does not inventory ${payload}`);
  }
  assert.match(build, /runtimeScriptNames[\s\S]*'Get-B122TlsIdentity\.mjs'/);
  assert.match(artifact, /scripts\/Get-B122TlsIdentity\.mjs/);

  for (const source of [
    "apps/provider-adapter-host/src/config.ts",
    "apps/provider-adapter-host/src/service.ts",
    "apps/provider-adapter-host/src/backends.ts",
    "apps/provider-adapter-host/src/state.ts",
    "apps/provider-adapter-host/src/council-resources.ts",
    "apps/provider-adapter-host/src/index.ts",
    "apps/provider-adapter-host/src/server.ts",
    "apps/provider-adapter-host/src/secret-envelope.ts",
    "apps/provider-adapter-host/src/windows-path-security.ts",
    "deployment/windows/Initialize-B122ProviderHost.ps1",
    "deployment/windows/Protect-B122ProviderHostSecret.ps1",
    "deployment/windows/Provision-B122ProviderHostCompanion.mjs"
  ]) assert.equal(artifact.includes(source), true, `source archive validation omits ${source}`);

  for (const receiptField of ["providerHostPresent=$true", "providerHostSelfTest=$true", "providerNetworkAccessed=$false", "proprietaryProviderCredentialAccessed=$false"]) {
    assert.equal(portable.includes(receiptField), true, `portable receipt omits ${receiptField}`);
  }
  for (const operational of ["provider-adapter-host\\dist\\apps\\provider-adapter-host\\src\\main.js", "Manage-B122ProviderHost.ps1", "Test-B122ProviderHostHealth.mjs", "Test-B122ProviderHostConfiguration.ps1"]) {
    assert.equal(start.includes(operational), true, `installed startup preflight omits ${operational}`);
  }
});

test("provider companion provisioning accepts only an optional exact absolute configuration path", async () => {
  const script = join(deployment, "Provision-B122ProviderHostCompanion.mjs");
  const source = await readFile(script, "utf8");
  assert.match(source, /new ProvisionedNamedPipeJsonLineTransport\(parsedArguments\.configurationPath\)/);
  const required = ["--artifact", join(root, "missing-artifact.json"), "--bundle-root", root];
  const rejected = (extra: readonly string[], expected: RegExp): void => {
    const result = spawnSync(process.execPath, [script, ...required, ...extra], { encoding: "utf8", timeout: 5_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  };
  rejected(["--configuration", "relative-state.json"], /--configuration requires one absolute path/);
  rejected(["--configuration", `${root}\rmalformed`], /--configuration requires one absolute path/);
  rejected(["--unexpected"], /Unsupported provider provisioning argument/);
  rejected(["--artifact", join(root, "second-artifact.json")], /--artifact may be supplied at most once/);
});

test("Windows install lifecycle stops the exact provider host and portable smoke proves graceful process-tree exit", async () => {
  const tools = await readFile(join(deployment, "B122InstallTools.psm1"), "utf8");
  const install = await readFile(join(deployment, "Install-B122.ps1"), "utf8");
  const update = await readFile(join(deployment, "Update-B122.ps1"), "utf8");
  const rollback = await readFile(join(deployment, "Rollback-B122.ps1"), "utf8");
  const uninstall = await readFile(join(deployment, "Uninstall-B122.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  assert.match(tools, /function Stop-B122InstalledProviderHost/);
  assert.match(tools, /Manage-B122ProviderHost\.ps1/);
  assert.match(tools, /survivorCount/);
  assert.match(install, /Stop-B122InstalledProviderHost/);
  assert.match(update, /Bootstrap-B122Install\.ps1/);
  assert.match(update, /ExpectedTrustDigest/);
  assert.match(update, /ExpectedSourceCommit/);
  assert.match(rollback, /Install-B122\.ps1/);
  assert.match(rollback, /OperationKindOverride rollback/);
  assert.match(uninstall, /Stop-B122InstalledProviderHost/);
  assert.match(portable, /--shutdown/);
  assert.match(portable, /authenticatedGracefulShutdown=\$true/);
  assert.match(portable, /processTreeSurvivors=0/);
});

test("Windows lifecycle resolves VS Code only from reviewed Known Folder installations", async () => {
  const tools = await readFile(join(deployment, "B122InstallTools.psm1"), "utf8");
  const install = await readFile(join(deployment, "Install-B122.ps1"), "utf8");
  const invokeCurrent = await readFile(join(deployment, "Invoke-B122Current.ps1"), "utf8");
  const uninstall = await readFile(join(deployment, "Uninstall-B122.ps1"), "utf8");
  assert.doesNotMatch(tools, /Get-Command\s+code\.cmd/);
  assert.match(tools, /Microsoft VS Code/);
  assert.match(tools, /resources\\app\\out\\cli\.js/);
  assert.match(tools, /Get-AuthenticodeSignature/);
  assert.match(tools, /function Assert-B122VsCodeCliIdentity/);
  for (const entrypoint of [install, invokeCurrent, uninstall]) {
    assert.match(entrypoint, /Assert-B122VsCodeCliIdentity/);
  }
});

test("Windows lifecycle native children are Job-bound at creation with an exact inherited-handle list", async () => {
  const tools = await readFile(join(deployment, "B122InstallTools.psm1"), "utf8");
  const bounded = tools.slice(
    tools.indexOf("public sealed class BoundedJobProcess"),
    tools.indexOf("function Resolve-B122VsCodeCli")
  );
  const nativeFunction = tools.slice(
    tools.indexOf("function Invoke-B122BoundedNativeProcess"),
    tools.indexOf("function Resolve-B122VsCodeCli")
  );
  assert.match(bounded, /StartupInfoEx/);
  assert.match(bounded, /InitializeProcThreadAttributeList/);
  assert.match(bounded, /0x00020002/);
  assert.match(bounded, /0x0002000d/i);
  assert.match(bounded, /0x08080004/);
  assert.match(bounded, /IsProcessInJob/);
  assert.match(nativeFunction, /StateRoot/);
  assert.match(nativeFunction, /native-operations/);
  assert.doesNotMatch(nativeFunction, /Remove-Item[^\r\n]*-Recurse/);
});

test("Windows release packages the independently trusted bootstrap and the installer rebinds its exact trust receipt", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const install = await readFile(join(deployment, "Install-B122.ps1"), "utf8");
  const update = await readFile(join(deployment, "Update-B122.ps1"), "utf8");
  assert.match(build, /Bootstrap-B122Install\.ps1/);
  assert.match(build, /bootstrapTrustDigest/);
  assert.match(artifact, /Bootstrap-B122Install\.ps1/);
  assert.match(install, /TrustedBootstrapDigest/);
  assert.match(install, /TrustedBootstrapSourceCommit/);
  assert.match(install, /Get-B122InstallerTrustDigest/);
  assert.match(install, /schema='sxsy-b122\.install-result';version=3/);
  assert.match(install, /trustDigest=\$trustedBootstrapDigest/);
  assert.match(update, /OperationKindOverride='update'/);
});

test("managed recovery loads immutable versioned tools before checking mutable root tools", async () => {
  const install = await readFile(join(deployment, "Install-B122.ps1"), "utf8");
  const invokeCurrent = await readFile(join(deployment, "Invoke-B122Current.ps1"), "utf8");

  assert.match(install, /\$modulePath\s*=\s*Join-Path\s+\$PSScriptRoot\s+'B122InstallTools\.psm1'/);
  assert.match(install, /Assert-B122BootstrapPinnedPayload[\s\S]*Import-Module\s+\$modulePath/);
  assert.ok(
    install.indexOf("Repair-B122Lifecycle -InstallRoot $root") < install.indexOf("Assert-B122RootTools -InstallRoot $root"),
    "installer checks mutable root tools before durable recovery"
  );
  assert.ok(
    invokeCurrent.indexOf("$pending=Get-B122LifecycleOperation") < invokeCurrent.indexOf("Assert-B122RootTools -InstallRoot $root"),
    "immutable autostart launcher checks mutable root tools before durable recovery"
  );
});

test("Windows startup repairs provider lifecycle even when the authenticated companion is already healthy", async () => {
  const start = await readFile(join(deployment, "Start-B122.ps1"), "utf8");
  const existingProbe = start.indexOf("$existingProbe=");
  const providerStart = start.indexOf("$providerOutput=");
  assert.ok(existingProbe >= 0 && providerStart > existingProbe, "startup must probe the companion before ensuring the provider host");
  assert.doesNotMatch(start.slice(existingProbe, providerStart), /;return\s*}/);
  assert.match(start, /companionAlreadyRunning/);
  assert.match(start, /providerHostStatus/);
  assert.match(start, /provider_started/);
  assert.match(start, /already_running_provider_disabled/);
  assert.match(start, /if\(-not\$companionAlreadyRunning\)/);
});

test("Windows activation journals pre-import intent and autostarts only the immutable validated version", async () => {
  const tools = await readFile(join(deployment, "B122InstallTools.psm1"), "utf8");
  const install = await readFile(join(deployment, "Install-B122.ps1"), "utf8");
  assert.match(tools, /recovery_prepared/);
  const prepared = install.indexOf("-Phase recovery_prepared");
  const effects = install.indexOf("$effects=[ordered]");
  const operation = install.indexOf("Start-B122LifecycleOperation");
  const imported = install.indexOf("Import-B122ValidatedBundle");
  const committed = install.indexOf("-Phase candidate_imported", imported);
  assert.ok(effects >= 0 && operation > effects && prepared > operation && imported > prepared && committed > imported, "recovery effects and lifecycle phases must durably bracket the candidate import effect");
  assert.match(install.slice(operation, prepared), /-InitialEffects \$effects/);
  assert.match(install, /Join-Path \$versionRoot 'scripts\\Invoke-B122Current\.ps1'/);
  const autostartBlock = install.slice(install.indexOf("$configureAutostart="), install.indexOf("$restoreTools="));
  assert.doesNotMatch(autostartBlock, /\$rootLauncher/);
  assert.match(autostartBlock, /Assert-B122RootTools/);
  const healthBlock = install.slice(install.indexOf("$health="), install.indexOf("$configureAutostart="));
  assert.match(healthBlock, /scripts\\Start-B122\.ps1/);
  assert.doesNotMatch(healthBlock, /\$rootLauncher/);
  const invokeCurrent = await readFile(join(deployment, "Invoke-B122Current.ps1"), "utf8");
  assert.match(invokeCurrent, /Join-Path \$PSScriptRoot 'B122InstallTools\.psm1'/);
  assert.match(invokeCurrent, /Assert-B122InstalledPayloadFile/);
  const copyTool = tools.slice(tools.indexOf("function Copy-B122FileAtomic"), tools.indexOf("function Restore-B122FileSnapshot"));
  assert.match(copyTool, /Write-B122BytesAtomic/);
  assert.doesNotMatch(copyTool, /WriteAllBytes/);
  const restoreTool = tools.slice(tools.indexOf("function Restore-B122FileSnapshot"), tools.indexOf("function Invoke-B122AtomicActivation"));
  assert.match(restoreTool, /Write-B122BytesAtomic/);
});

test("Windows uninstall reports every VS Code removal failure and proves extension absence before deleting product bytes", async () => {
  const uninstall = await readFile(join(deployment, "Uninstall-B122.ps1"), "utf8");
  const removeProduct = uninstall.indexOf("Remove-B122OwnedInstallation");
  const partial = uninstall.indexOf("$progress.status='partial'", removeProduct);
  const finishProduct = uninstall.indexOf("Finish-ProductRemoval $progress", partial);
  assert.ok(removeProduct >= 0 && partial > removeProduct && finishProduct > partial);
  assert.match(uninstall, /VS Code CLI is unavailable/);
  assert.match(uninstall, /extension uninstall returned a failure exit code/);
  assert.match(uninstall, /still reports the B122 extension/);
  assert.match(uninstall, /--show-versions/);
  assert.match(uninstall, /extensionIdentity/);
  assert.match(uninstall, /extensionVsixSha256/);
  assert.match(uninstall, /replaced or changed/);
  assert.match(uninstall.slice(partial, finishProduct), /Write-Progress \$progress/);
  assert.match(uninstall, /extensionAbsenceVerified=\$true/);
});

test("Windows release output is an authenticated exclusive leaf with no reparse ancestors", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  assert.match(build, /function Assert-B122NoReparseAncestors/);
  assert.match(build, /Assert-B122NoReparseAncestors -Path \$output/);
  assert.match(build, /build-output-ownership/);
  assert.match(build, /ProtectedData\]::Protect/);
  assert.match(build, /ProtectedData\]::Unprotect/);
  assert.match(build, /output\+'\.ownership\.json'/);
  assert.match(build, /Set-B122ProtectedBuildOutputAcl -Path \$output/);
  assert.match(build, /function Remove-B122OwnedBuildTree/);
  assert.match(build, /Build cleanup target identity changed before quarantine/);
  assert.match(build, /CreateFileW\(ExtendedPath\(path\)/);
  assert.match(build, /Cannot open exact filesystem identity for/);
  const cleanupFunction = build.slice(
    build.indexOf("function Remove-B122OwnedBuildTree"),
    build.indexOf("Assert-Child ([IO.Path]::GetFullPath((Join-Path $repo 'artifacts'))) $output"),
  );
  const quarantineMove = cleanupFunction.indexOf("Move-Item -LiteralPath $tree -Destination $quarantine");
  const quarantineInventory = cleanupFunction.indexOf("$queue.Enqueue($quarantine)");
  assert.ok(quarantineMove >= 0 && quarantineInventory > quarantineMove);
  assert.equal(cleanupFunction.includes("$queue.Enqueue($tree)"), false);
  assert.doesNotMatch(build, /Remove-Item[^\r\n]*-Recurse/);
  assert.equal(artifact.includes("$_.FullName.Substring($root.Length+1).Replace('\\','/') -notin @('SHA256SUMS.json','sbom.spdx.json','release.json')"), true);
});

test("evidence-eligible release requires and hashes a compiler-bound firmware receipt", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  for (const expected of ["--require-c-compiler", "--receipt", "firmware-verification.json", "compiler.fingerprintSha256"]) {
    assert.equal(build.includes(expected), true, `release build is missing ${expected}`);
    assert.equal(artifact.includes(expected === "--require-c-compiler" || expected === "--receipt" ? "compilerRequired" : expected), true, `release validation is missing ${expected}`);
  }
  assert.match(artifact, /payload checksum manifest/);
  assert.match(artifact, /development-only release must not present a compiler receipt/);
});

test("deployment templates expose every typed recipe and never pretend the supervisor is a project command", async () => {
  const runtimePlan = JSON.parse(await readFile(join(deployment, "repository-runtime-plan.template.json"), "utf8")) as { recipes: Record<string, { executable?: string; managedActions?: string[] }> };
  const sandboxPlan = JSON.parse(await readFile(join(deployment, "windows-sandbox-catalog-plan.template.json"), "utf8")) as { recipes: Record<string, { executable: string; arguments: string[]; artifacts: string[] }> };
  const recipes = JSON.parse(await readFile(join(deployment, "typed-recipes.template.json"), "utf8")) as { recipes: Record<string, { executableSha256: string; coverage: unknown[] }> };
  assert.doesNotMatch(JSON.stringify(runtimePlan), /b122-repository-runner\.exe/);
  assert.deepEqual(runtimePlan.recipes.stop_managed_run?.managedActions, ["run_target", "debug_target", "launch_web_app"]);
  for (const recipeId of recipeIds) {
    assert.deepEqual(sandboxPlan.recipes[recipeId]?.arguments.slice(0, 2), ["--recipe", recipeId]);
    assert.equal(sandboxPlan.recipes[recipeId]?.executable.endsWith("b122-repository-runner.exe"), true);
    assert.deepEqual(sandboxPlan.recipes[recipeId]?.artifacts, ["b122-recipe-evidence.json"]);
    assert.equal(recipes.recipes[recipeId]?.executableSha256, "0".repeat(64));
    assert.ok((recipes.recipes[recipeId]?.coverage.length ?? 0) > 0);
  }
});

test("Windows release carries the validated operator manual in both the bundle and pinned source archive", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const manual = "SXSY-B122-operator-technical-manual.pdf";
  assert.match(build, /output\\pdf\\SXSY-B122-operator-technical-manual\.pdf/);
  assert.match(build, /Copy-Item -LiteralPath \$manualPdfSource -Destination/);
  assert.match(artifact, /docs\\SXSY-B122-operator-technical-manual\.pdf/);
  assert.match(artifact, /\(Get-Item -LiteralPath \$manualPdf\)\.Length -lt 10KB/);
  assert.equal(artifact.includes(`output/pdf/${manual}`), true);
});
