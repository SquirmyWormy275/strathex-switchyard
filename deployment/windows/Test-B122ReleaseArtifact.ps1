[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BundleRoot,
  [switch]$AllowDevelopmentArtifact
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($BundleRoot)
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'The B122 release root is missing.' }
Import-Module (Join-Path $PSScriptRoot 'B122ReleaseIntegrity.psm1') -Force

function Read-Json([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Release metadata is missing: $Path" }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
function Get-ConcretePayloadFiles([string]$Path) {
  $pending = [Collections.Generic.Queue[string]]::new()
  $pending.Enqueue([IO.Path]::GetFullPath($Path))
  $files = [Collections.Generic.List[IO.FileInfo]]::new()
  while ($pending.Count -gt 0) {
    $directory = $pending.Dequeue()
    foreach ($item in (Get-ChildItem -LiteralPath $directory -Force)) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "The release payload contains a reparse entry: $($item.FullName)" }
      if ($item.PSIsContainer) { $pending.Enqueue($item.FullName) }
      elseif ($item -is [IO.FileInfo]) { $files.Add($item) }
      else { throw "The release payload contains an unsupported filesystem entry: $($item.FullName)" }
    }
  }
  return $files.ToArray()
}

$release = Read-Json (Join-Path $root 'release.json')
$requiredInstallScripts = @('B122InstallTools.psm1','B122ReleaseIntegrity.psm1','Bootstrap-B122Install.ps1','Invoke-B122Current.ps1','Install-B122.ps1','Update-B122.ps1','Rollback-B122.ps1','Uninstall-B122.ps1','Manage-B122ProviderHost.ps1','Test-B122ProviderHostHealth.mjs')
foreach ($name in $requiredInstallScripts) { if (-not (Test-Path -LiteralPath (Join-Path $root (Join-Path 'scripts' $name)) -PathType Leaf)) { throw "The versioned install lifecycle script is missing: $name" } }
if ($release.schema -cne 'sxsy-b122.windows-release' -or $release.version -ne 1 -or $release.companion -notmatch '^\d+\.\d+\.\d+' -or $release.providerAdapterHost -notmatch '^\d+\.\d+\.\d+' -or $release.vscodeExtension -notmatch '^\d+\.\d+\.\d+' -or $release.providerHostLifecycle -cne 'configured-or-disabled' -or $release.hardwareAcceptance -ne $false -or $release.highConsequenceAcceptance -ne $false) { throw 'Release status metadata is invalid or overclaims acceptance.' }
if ($release.sourceCommit -notmatch '^[0-9a-f]{40}$' -or $release.sourceAssembly -cne 'git-archive' -or $release.nodeRuntime.executableSha256 -notmatch '^[0-9a-f]{64}$' -or $release.nodeRuntime.npmCliSha256 -notmatch '^[0-9a-f]{64}$' -or $release.nodeRuntime.tscSha256 -notmatch '^[0-9a-f]{64}$' -or $release.nodeRuntime.npmVersion -notmatch '^\d+\.\d+\.\d+' -or $release.nodeRuntime.tscVersion -notmatch '^Version \d+\.\d+\.\d+' -or $release.sandboxHelperSha256 -notmatch '^[0-9a-f]{64}$' -or $release.sandboxLifecycleHelperSha256 -notmatch '^[0-9a-f]{64}$' -or $release.repositoryRuntimeHelperSha256 -notmatch '^[0-9a-f]{64}$' -or $release.companionLifecycleHelperSha256 -notmatch '^[0-9a-f]{64}$' -or $release.rawHidHelperSha256 -notmatch '^[0-9a-f]{64}$' -or $release.providerDesktopHelperSha256 -notmatch '^[0-9a-f]{64}$' -or $release.voiceHelperSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Release provenance metadata is invalid.' }
$developmentOnly = $release.verificationSkipped -eq $true -and $release.evidenceEligible -eq $false
$verifiedEvidence = $release.verificationSkipped -eq $false -and $release.evidenceEligible -eq $true
if (-not $developmentOnly -and -not $verifiedEvidence) { throw 'Release verification/evidence metadata is inconsistent.' }
if ($developmentOnly -and -not $AllowDevelopmentArtifact) { throw 'Verification-skipped development artifacts are ineligible for release evidence or installation.' }
$firmwareVerificationPath = Join-Path $root 'firmware-verification.json'
if ($verifiedEvidence) {
  if ($release.firmwareVerificationReceipt -cne 'firmware-verification.json') { throw 'Evidence-eligible release provenance does not name the firmware verification receipt.' }
  $firmwareVerification = Read-Json $firmwareVerificationPath
  if ($firmwareVerification.schema -cne 'sxsy-b122.firmware-verification' -or $firmwareVerification.version -ne 1 -or $firmwareVerification.status -cne 'passed' -or $firmwareVerification.compilerRequired -ne $true -or $firmwareVerification.compiled -ne $true -or $firmwareVerification.protocolSelfTest -ne $true -or $firmwareVerification.hardwareAccessed -ne $false -or [string]::IsNullOrWhiteSpace([string]$firmwareVerification.compiler.kind) -or @($firmwareVerification.compiler.flags).Count -lt 1 -or $firmwareVerification.compiler.versionOutputSha256 -notmatch '^[0-9a-f]{64}$' -or $firmwareVerification.compiler.fingerprintSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Evidence-eligible firmware verification receipt is invalid or lacks a compiler fingerprint.' }
} elseif ($release.firmwareVerificationReceipt -or (Test-Path -LiteralPath $firmwareVerificationPath)) {
  throw 'A development-only release must not present a compiler receipt as accepted release evidence.'
}
$checksumsDocument = Read-Json (Join-Path $root 'SHA256SUMS.json')
$checksums = @($checksumsDocument | ForEach-Object { $_ })
$sbom = Read-Json (Join-Path $root 'sbom.spdx.json')
$sbomPackages = @($sbom.packages | ForEach-Object { $_ })
$sbomFiles = @($sbom.files | ForEach-Object { $_ })
if ($release.payloadCount -ne $checksums.Count) { throw 'Release payload count does not match the checksum manifest.' }
if ($sbom.spdxVersion -cne 'SPDX-2.3' -or $sbom.dataLicense -cne 'CC0-1.0' -or $sbom.SPDXID -cne 'SPDXRef-DOCUMENT') { throw 'The SPDX document header is invalid.' }
if ($sbomPackages.Count -lt 4 -or $sbomFiles.Count -ne $checksums.Count) { throw 'The SPDX package or file inventory is incomplete.' }
$providerHostSpdx = @($sbomPackages | Where-Object { $_.SPDXID -ceq 'SPDXRef-Package-ProviderAdapterHost' })
if ($providerHostSpdx.Count -ne 1 -or $providerHostSpdx[0].versionInfo -cne $release.providerAdapterHost) { throw 'The SPDX inventory omits the exact provider-adapter-host package.' }

$expected = @{}
foreach ($entry in $checksums) {
  $segments = @(([string]$entry.path).Split('/'))
  if ($entry.path -notmatch '^[^\\:\r\n\0]+$' -or $entry.path.StartsWith('/') -or $segments.Count -eq 0 -or @($segments | Where-Object { $_ -in @('', '.', '..') }).Count -ne 0 -or $entry.sha256 -notmatch '^[0-9a-f]{64}$' -or $expected.ContainsKey($entry.path)) { throw 'The checksum manifest contains an invalid or duplicate entry.' }
  $expected[$entry.path] = $entry
}
if ($verifiedEvidence -and (-not $expected.ContainsKey('firmware-verification.json') -or $expected['firmware-verification.json'].sha256 -cne (Get-FileHash -LiteralPath $firmwareVerificationPath -Algorithm SHA256).Hash.ToLowerInvariant())) { throw 'The firmware verification receipt is not bound into the payload checksum manifest.' }
$sandboxHelperPath = 'app/dist/apps/windows-companion/sandbox-helper/b122-sandbox-worker.exe'
$repositoryRuntimeHelperPath = 'app/dist/apps/windows-companion/repository-runtime/b122-repository-runner.exe'
$companionLifecycleHelperPath = 'app/dist/apps/windows-companion/companion-lifecycle/b122-companion-supervisor.exe'
$rawHidHelperPath = 'app/dist/apps/windows-companion/raw-hid/strathex-b122-hid-helper.exe'
$sandboxLifecycleHelperPath = 'app/dist/apps/windows-companion/sandbox-helper/b122-sandbox-lifecycle.exe'
$rawHidSimulatorPath = 'app/dist/apps/windows-companion/src/raw-hid-simulator.js'
$councilParticipantPath = 'app/dist/apps/windows-companion/src/council-participant-main.js'
$providerDesktopHelperPath = 'app/dist/apps/windows-companion/provider-desktop/sxsy-b122-provider-desktop-helper.exe'
$voiceHelperPath = 'app/dist/apps/windows-companion/voice/sxsy-b122-voice-helper.exe'
if (-not $expected.ContainsKey($sandboxHelperPath) -or $expected[$sandboxHelperPath].sha256 -cne $release.sandboxHelperSha256) { throw 'Sandbox-helper release provenance is incomplete.' }
if (-not $expected.ContainsKey($repositoryRuntimeHelperPath) -or $expected[$repositoryRuntimeHelperPath].sha256 -cne $release.repositoryRuntimeHelperSha256) { throw 'Repository-runtime-helper release provenance is incomplete.' }
if (-not $expected.ContainsKey($companionLifecycleHelperPath) -or $expected[$companionLifecycleHelperPath].sha256 -cne $release.companionLifecycleHelperSha256) { throw 'Companion-lifecycle-helper release provenance is incomplete.' }
if (-not $expected.ContainsKey($rawHidHelperPath) -or $expected[$rawHidHelperPath].sha256 -cne $release.rawHidHelperSha256) { throw 'Raw-HID-helper release provenance is incomplete.' }
if (-not $expected.ContainsKey($sandboxLifecycleHelperPath) -or $expected[$sandboxLifecycleHelperPath].sha256 -cne $release.sandboxLifecycleHelperSha256) { throw 'Sandbox lifecycle-helper release provenance is incomplete.' }
if (-not $expected.ContainsKey($rawHidSimulatorPath) -or $release.rawHidSimulationSelfTest -ne $true) { throw 'The no-hardware Raw-HID product simulator is absent or unattested.' }
if (-not $expected.ContainsKey($councilParticipantPath) -or $release.councilParticipantPresent -ne $true) { throw 'The authenticated Council participant entry point is absent or unattested.' }
if (-not $expected.ContainsKey($providerDesktopHelperPath) -or $expected[$providerDesktopHelperPath].sha256 -cne $release.providerDesktopHelperSha256) { throw 'Provider-desktop-helper release provenance is incomplete.' }
if (-not $expected.ContainsKey($voiceHelperPath) -or $expected[$voiceHelperPath].sha256 -cne $release.voiceHelperSha256) { throw 'Voice-helper release provenance is incomplete.' }
foreach ($qmkPath in @('firmware/b122/keymap.c','firmware/b122/rules.mk','firmware/b122/config.h','firmware/b122/b122_manifest.h','firmware/b122/b122_protocol.c','firmware/b122/b122_protocol.h','firmware/vial.json')) {
  if (-not $expected.ContainsKey($qmkPath)) { throw "The packaged QMK/Vial overlay is incomplete: $qmkPath" }
}
$companionPackage = Read-Json (Join-Path $root 'app\package.json')
if ($companionPackage.version -cne $release.companion -or $companionPackage.b122Distribution.scope -cne 'javascript-companion-only' -or $companionPackage.b122Distribution.nativeHelpersIncluded -ne $false -or $companionPackage.b122Distribution.releaseEvidenceEligible -ne $false -or $companionPackage.b122Distribution.verifiedWindowsBundleBuilder -cne 'deployment/windows/Build-B122Release.ps1') { throw 'The npm companion package does not accurately declare its JavaScript-only distribution boundary.' }
$providerHostPackage = Read-Json (Join-Path $root 'provider-adapter-host\package.json')
if ($providerHostPackage.name -cne '@strathex/switchyard-provider-adapter-host' -or $providerHostPackage.version -cne $release.providerAdapterHost -or $providerHostPackage.bin.'sxsy-b122-provider-adapter-host' -cne 'dist/apps/provider-adapter-host/src/main.js' -or $providerHostPackage.b122Distribution.scope -cne 'provider-adapter-host' -or $providerHostPackage.b122Distribution.fixtureBackendIncluded -ne $true -or $providerHostPackage.b122Distribution.liveProviderCredentialsIncluded -ne $false -or $providerHostPackage.b122Distribution.liveProviderAcceptanceIncluded -ne $false -or $providerHostPackage.b122Distribution.verifiedWindowsBundleBuilder -cne 'deployment/windows/Build-B122Release.ps1') { throw 'The provider-adapter-host package metadata is invalid or overclaims live provider acceptance.' }
foreach ($providerHostPath in @('provider-adapter-host/package.json','provider-adapter-host/README.md','provider-adapter-host/dist/apps/provider-adapter-host/src/main.js','provider-adapter-host/dist/apps/provider-adapter-host/src/index.js','provider-adapter-host/dist/apps/provider-adapter-host/src/config.js','provider-adapter-host/dist/apps/provider-adapter-host/src/service.js','provider-adapter-host/dist/apps/provider-adapter-host/src/backends.js','provider-adapter-host/dist/apps/provider-adapter-host/src/state.js','provider-adapter-host/dist/apps/provider-adapter-host/src/council-resources.js','provider-adapter-host/dist/apps/provider-adapter-host/src/server.js','provider-adapter-host/dist/apps/provider-adapter-host/src/secret-envelope.js','provider-adapter-host/dist/apps/provider-adapter-host/src/windows-path-security.js')) {
  if (-not $expected.ContainsKey($providerHostPath)) { throw "The provider-adapter-host payload is incomplete: $providerHostPath" }
}
foreach ($providerLifecyclePath in @('scripts/Manage-B122ProviderHost.ps1','scripts/Test-B122ProviderHostHealth.mjs','scripts/New-B122NetworkPolicy.ps1','scripts/Get-B122TlsIdentity.mjs','scripts/provisioning/Initialize-B122ProviderHost.ps1','scripts/provisioning/Protect-B122ProviderHostSecret.ps1','scripts/provisioning/New-B122LoopbackTlsIdentity.mjs','scripts/provisioning/Get-B122TlsIdentity.mjs','scripts/provisioning/Provision-B122ProviderHostCompanion.mjs','scripts/provisioning/New-B122ProviderHostConfiguration.ps1','scripts/provisioning/Test-B122ProviderHostConfiguration.ps1','scripts/provisioning/Restore-B122ProviderHostConfiguration.ps1')) {
  if (-not $expected.ContainsKey($providerLifecyclePath)) { throw "The provider-host lifecycle payload is incomplete: $providerLifecyclePath" }
}
$requiredProviderWorkflowContextRouteIds = @('provider.observe-workflow-context.claude','provider.observe-workflow-context.codex')
$networkPolicySource = Get-Content -LiteralPath (Join-Path $root 'scripts\New-B122NetworkPolicy.ps1') -Raw
if ($networkPolicySource -cnotmatch [regex]::Escape('$routes += Provider-Route ("provider.observe-workflow-context.$provider") ''POST'' ("$base/v1/b122/observe/workflow-context/$provider")')) { throw "The packaged network policy omits the exact provider workflow-context observation route generator: $($requiredProviderWorkflowContextRouteIds -join ', ')" }
$dotnetToolchainRelative='build-provenance/dotnet-toolchain.json'
if ($release.dotnetRuntime.version -cne '8.0.30' -or $release.dotnetRuntime.sdkVersion -cne '8.0.424' -or $release.dotnetRuntime.dotnetExeSha256 -notmatch '^[0-9a-f]{64}$' -or $release.dotnetRuntime.nugetConfigSha256 -notmatch '^[0-9a-f]{64}$' -or $release.dotnetRuntime.toolchainManifest -cne $dotnetToolchainRelative -or $release.dotnetRuntime.toolchainManifestSha256 -notmatch '^[0-9a-f]{64}$' -or $release.dotnetRuntime.license -cne 'licenses/DOTNET-RUNTIME-LICENSE.txt' -or $release.dotnetRuntime.thirdPartyNotices -cne 'licenses/DOTNET-RUNTIME-THIRD-PARTY-NOTICES.txt' -or -not $expected.ContainsKey($release.dotnetRuntime.license) -or -not $expected.ContainsKey($release.dotnetRuntime.thirdPartyNotices) -or -not $expected.ContainsKey($dotnetToolchainRelative)) { throw 'The self-contained .NET runtime/toolchain provenance or notices are incomplete.' }
$dotnetToolchainPath=Join-Path $root $dotnetToolchainRelative.Replace('/','\')
if((Get-FileHash -LiteralPath $dotnetToolchainPath -Algorithm SHA256).Hash.ToLowerInvariant()-cne[string]$release.dotnetRuntime.toolchainManifestSha256-or[string]$expected[$dotnetToolchainRelative].sha256-cne[string]$release.dotnetRuntime.toolchainManifestSha256){throw 'The reviewed .NET toolchain manifest is not checksum-bound into the release.'}
$dotnetToolchain=Read-Json $dotnetToolchainPath
if($dotnetToolchain.schema-cne'sxsy-b122.dotnet-toolchain'-or$dotnetToolchain.version-ne1-or$dotnetToolchain.sdkVersion-cne[string]$release.dotnetRuntime.sdkVersion-or$dotnetToolchain.runtimeVersion-cne[string]$release.dotnetRuntime.version-or$dotnetToolchain.dotnetExeSha256-cne[string]$release.dotnetRuntime.dotnetExeSha256-or$dotnetToolchain.nugetConfigSha256-cne[string]$release.dotnetRuntime.nugetConfigSha256){throw 'Release .NET toolchain metadata does not match its reviewed manifest.'}
$manifestRuntimePackages=@($dotnetToolchain.runtimePackages|Sort-Object id);$releaseRuntimePackages=@($release.dotnetRuntime.runtimePackages|Sort-Object id)
if($manifestRuntimePackages.Count-ne3-or$releaseRuntimePackages.Count-ne3){throw 'Release .NET runtime-package provenance is incomplete.'}
for($runtimePackageIndex=0;$runtimePackageIndex-lt3;$runtimePackageIndex++){if($manifestRuntimePackages[$runtimePackageIndex].id-cne$releaseRuntimePackages[$runtimePackageIndex].id-or$manifestRuntimePackages[$runtimePackageIndex].version-cne$releaseRuntimePackages[$runtimePackageIndex].version-or$manifestRuntimePackages[$runtimePackageIndex].sha256-cne$releaseRuntimePackages[$runtimePackageIndex].sha256-or$manifestRuntimePackages[$runtimePackageIndex].sha256-notmatch'^[0-9a-f]{64}$'){throw 'Release .NET runtime-package provenance does not match its reviewed manifest.'}}
if($release.buildEnvironment.isolated-ne$true-or$release.buildEnvironment.ambientInherited-ne$false-or$release.buildEnvironment.profile-cne'ephemeral-exclusive-output'-or$release.buildEnvironment.gitExeSha256-notmatch'^[0-9a-f]{64}$'-or@($release.buildEnvironment.environmentNames|Where-Object{$_-ceq'SXSY_B122_BUILD_SECRET_SENTINEL'}).Count-ne0){throw 'The release does not carry a valid isolated build-environment receipt.'}
$actualFiles = @(Get-ConcretePayloadFiles $root|Where-Object{$_.FullName.Substring($root.Length+1).Replace('\','/') -notin @('SHA256SUMS.json','sbom.spdx.json','release.json')})
if ($actualFiles.Count -ne $checksums.Count) { throw 'The bundle has missing or unmanifested payload files.' }
foreach ($file in $actualFiles) {
  if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'The release payload contains a reparse file.'}
  $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
  if (-not $expected.ContainsKey($relative)) { throw "Unmanifested payload file: $relative" }
  $entry = $expected[$relative]
  $digest = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($digest -cne $entry.sha256 -or [long]$file.Length -ne [long]$entry.bytes) { throw "Payload digest or size mismatch: $relative" }
}
if((Get-FileHash -LiteralPath (Join-Path $root 'runtime\node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $release.nodeRuntime.executableSha256){throw 'The bundled Node executable does not match its build provenance fingerprint.'}
if((Get-FileHash -LiteralPath (Join-Path $root 'app\dist\apps\windows-companion\sandbox-helper\b122-sandbox-lifecycle.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $release.sandboxLifecycleHelperSha256){throw 'The bundled Sandbox lifecycle helper does not match release provenance.'}
$portableSmoke=Read-Json (Join-Path $root 'portable-smoke.json')
if($portableSmoke.schema -cne 'sxsy-b122.portable-smoke' -or $portableSmoke.version -ne 1 -or $portableSmoke.status -cne 'ready' -or $portableSmoke.sandboxLifecycleSelfTest -ne $true -or $portableSmoke.rawHidSimulationSelfTest -ne $true -or $portableSmoke.rawHidChordsExercised -ne 176 -or $portableSmoke.rawHidAssignedChords -ne 65 -or $portableSmoke.rawHidUnassignedChords -ne 111 -or $portableSmoke.councilParticipantPresent -ne $true -or $portableSmoke.councilParticipantAutoLaunched -ne $false -or $portableSmoke.physicalRawHidHardwareAccessed -ne $false){throw 'The portable product smoke receipt is incomplete or unsafe.'}
$extensionPackage=Read-Json (Join-Path $root 'extension\package.json');if($extensionPackage.name-cne'@strathex/switchyard-vscode'-or$extensionPackage.publisher-cne'SquirmyWormy275'-or$extensionPackage.version-cne$release.vscodeExtension-or$extensionPackage.main-cne'./dist/extension.js'){throw 'The installed VS Code package identity does not match release identity.'}
foreach ($file in $sbomFiles) {
  $relative = ([string]$file.fileName).TrimStart('.', '/')
  $checksum = @($file.checksums | Where-Object { $_.algorithm -ceq 'SHA256' })
  if (-not $expected.ContainsKey($relative) -or $checksum.Count -ne 1 -or $checksum[0].checksumValue -cne $expected[$relative].sha256) { throw "SPDX file evidence is incomplete: $relative" }
}
$providerHostFileIds = @($sbomFiles | Where-Object { ([string]$_.fileName).TrimStart('.', '/').StartsWith('provider-adapter-host/') } | ForEach-Object { $_.SPDXID })
$providerHostRelationships = @($sbom.relationships | Where-Object { $_.spdxElementId -ceq 'SPDXRef-Package-ProviderAdapterHost' -and $_.relationshipType -ceq 'CONTAINS' } | ForEach-Object { $_.relatedSpdxElement })
if ($providerHostFileIds.Count -lt 3 -or @($providerHostFileIds | Where-Object { $_ -notin $providerHostRelationships }).Count -ne 0) { throw 'The SPDX provider-adapter-host file ownership is incomplete.' }

$vsixPath = Join-Path $root 'extension\sxsy-b122-switchyard.vsix'
Assert-B122VsixIdentity -VsixPath $vsixPath -ExpectedVersion ([string]$release.vscodeExtension)|Out-Null

$sourcePath = Join-Path $root 'source\sxsy-b122-source.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceArchive = [IO.Compression.ZipFile]::OpenRead($sourcePath)
try {
  foreach ($entryName in @('package.json', 'firmware/qmk/keymaps/b122/keymap.c', 'firmware/windows-hid-helper/Program.cs', 'apps/windows-companion/repository-runner-helper/Program.cs', 'apps/windows-companion/repository-runner-helper/Sxsy.B122.RepositoryRunner.csproj', 'apps/windows-companion/companion-lifecycle-helper/Program.cs', 'apps/windows-companion/companion-lifecycle-helper/Sxsy.B122.CompanionLifecycleHelper.csproj', 'apps/windows-companion/sandbox-lifecycle-helper/Program.cs', 'apps/windows-companion/sandbox-lifecycle-helper/Sxsy.B122.SandboxLifecycleHelper.csproj', 'apps/windows-companion/src/raw-hid-simulator.ts', 'apps/windows-companion/src/council-participant-main.ts', 'apps/windows-companion/src/council-participant-client.ts', 'apps/windows-companion/provider-desktop-helper/Program.cs', 'apps/windows-companion/provider-desktop-helper/Sxsy.B122.ProviderDesktopHelper.csproj', 'apps/windows-companion/voice-helper/Program.cs', 'apps/windows-companion/voice-helper/Sxsy.B122.VoiceHelper.csproj', 'apps/provider-adapter-host/package.json', 'apps/provider-adapter-host/src/main.ts', 'apps/provider-adapter-host/src/index.ts', 'apps/provider-adapter-host/src/config.ts', 'apps/provider-adapter-host/src/service.ts', 'apps/provider-adapter-host/src/backends.ts', 'apps/provider-adapter-host/src/state.ts', 'apps/provider-adapter-host/src/council-resources.ts', 'apps/provider-adapter-host/src/server.ts', 'apps/provider-adapter-host/src/secret-envelope.ts', 'apps/provider-adapter-host/src/windows-path-security.ts', 'deployment/windows/B122ReleaseIntegrity.psm1', 'deployment/windows/dotnet-toolchain.json', 'deployment/windows/Initialize-B122ProviderHost.ps1', 'deployment/windows/Protect-B122ProviderHostSecret.ps1', 'deployment/windows/New-B122LoopbackTlsIdentity.mjs', 'deployment/windows/Get-B122TlsIdentity.mjs', 'deployment/windows/Provision-B122ProviderHostCompanion.mjs', 'deployment/windows/Manage-B122ProviderHost.ps1', 'deployment/windows/Test-B122ProviderHostHealth.mjs', 'deployment/windows/New-B122NetworkPolicy.ps1', 'deployment/windows/New-B122ProviderHostConfiguration.ps1', 'deployment/windows/Test-B122ProviderHostConfiguration.ps1', 'deployment/windows/Restore-B122ProviderHostConfiguration.ps1', 'deployment/windows/Manage-B122VoiceRoute.ps1', 'docs/SXSY-B122-complete-key-specification-and-audit.md', 'docs/historical-interview-notes-reconstructed.md', 'docs/adversarial-review.md')) {
    if ($null -eq $sourceArchive.GetEntry($entryName)) { throw "Source archive entry is missing: $entryName" }
  }
} finally { $sourceArchive.Dispose() }

$validationStatus = if ($developmentOnly) { 'development-only' } else { 'passed' }
[ordered]@{ schema='sxsy-b122.release-validation'; version=1; status=$validationStatus; sourceCommit=[string]$release.sourceCommit; evidenceEligible=[bool]$release.evidenceEligible; payloadCount=$checksums.Count; spdxFiles=$sbomFiles.Count; hardwareAcceptance=$false; highConsequenceAcceptance=$false } | ConvertTo-Json -Compress
