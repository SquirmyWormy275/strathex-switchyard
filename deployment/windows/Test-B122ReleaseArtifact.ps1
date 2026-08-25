[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BundleRoot,
  [switch]$AllowDevelopmentArtifact
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($BundleRoot)
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'The B122 release root is missing.' }

function Read-Json([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Release metadata is missing: $Path" }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

$release = Read-Json (Join-Path $root 'release.json')
$requiredInstallScripts = @('B122InstallTools.psm1','Invoke-B122Current.ps1','Install-B122.ps1','Update-B122.ps1','Rollback-B122.ps1','Uninstall-B122.ps1')
foreach ($name in $requiredInstallScripts) { if (-not (Test-Path -LiteralPath (Join-Path $root (Join-Path 'scripts' $name)) -PathType Leaf)) { throw "The versioned install lifecycle script is missing: $name" } }
if ($release.schema -cne 'sxsy-b122.windows-release' -or $release.version -ne 1 -or $release.hardwareAcceptance -ne $false -or $release.highConsequenceAcceptance -ne $false) { throw 'Release status metadata is invalid or overclaims acceptance.' }
if ($release.sourceCommit -notmatch '^[0-9a-f]{40}$' -or $release.sourceAssembly -cne 'git-archive' -or $release.sandboxHelperSha256 -notmatch '^[0-9a-f]{64}$' -or $release.repositoryRuntimeHelperSha256 -notmatch '^[0-9a-f]{64}$' -or $release.rawHidHelperSha256 -notmatch '^[0-9a-f]{64}$' -or $release.providerDesktopHelperSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Release provenance metadata is invalid.' }
$developmentOnly = $release.verificationSkipped -eq $true -and $release.evidenceEligible -eq $false
$verifiedEvidence = $release.verificationSkipped -eq $false -and $release.evidenceEligible -eq $true
if (-not $developmentOnly -and -not $verifiedEvidence) { throw 'Release verification/evidence metadata is inconsistent.' }
if ($developmentOnly -and -not $AllowDevelopmentArtifact) { throw 'Verification-skipped development artifacts are ineligible for release evidence or installation.' }
$checksumsDocument = Read-Json (Join-Path $root 'SHA256SUMS.json')
$checksums = @($checksumsDocument | ForEach-Object { $_ })
$sbom = Read-Json (Join-Path $root 'sbom.spdx.json')
$sbomPackages = @($sbom.packages | ForEach-Object { $_ })
$sbomFiles = @($sbom.files | ForEach-Object { $_ })
if ($release.payloadCount -ne $checksums.Count) { throw 'Release payload count does not match the checksum manifest.' }
if ($sbom.spdxVersion -cne 'SPDX-2.3' -or $sbom.dataLicense -cne 'CC0-1.0' -or $sbom.SPDXID -cne 'SPDXRef-DOCUMENT') { throw 'The SPDX document header is invalid.' }
if ($sbomPackages.Count -lt 3 -or $sbomFiles.Count -ne $checksums.Count) { throw 'The SPDX package or file inventory is incomplete.' }

$expected = @{}
foreach ($entry in $checksums) {
  $segments = @(([string]$entry.path).Split('/'))
  if ($entry.path -notmatch '^[^\\:\r\n\0]+$' -or $entry.path.StartsWith('/') -or $segments.Count -eq 0 -or @($segments | Where-Object { $_ -in @('', '.', '..') }).Count -ne 0 -or $entry.sha256 -notmatch '^[0-9a-f]{64}$' -or $expected.ContainsKey($entry.path)) { throw 'The checksum manifest contains an invalid or duplicate entry.' }
  $expected[$entry.path] = $entry
}
$sandboxHelperPath = 'app/dist/apps/windows-companion/sandbox-helper/b122-sandbox-worker.exe'
$repositoryRuntimeHelperPath = 'app/dist/apps/windows-companion/repository-runtime/b122-repository-runner.exe'
$rawHidHelperPath = 'app/dist/apps/windows-companion/raw-hid/strathex-b122-hid-helper.exe'
$providerDesktopHelperPath = 'app/dist/apps/windows-companion/provider-desktop/sxsy-b122-provider-desktop-helper.exe'
if (-not $expected.ContainsKey($sandboxHelperPath) -or $expected[$sandboxHelperPath].sha256 -cne $release.sandboxHelperSha256) { throw 'Sandbox-helper release provenance is incomplete.' }
if (-not $expected.ContainsKey($repositoryRuntimeHelperPath) -or $expected[$repositoryRuntimeHelperPath].sha256 -cne $release.repositoryRuntimeHelperSha256) { throw 'Repository-runtime-helper release provenance is incomplete.' }
if (-not $expected.ContainsKey($rawHidHelperPath) -or $expected[$rawHidHelperPath].sha256 -cne $release.rawHidHelperSha256) { throw 'Raw-HID-helper release provenance is incomplete.' }
if (-not $expected.ContainsKey($providerDesktopHelperPath) -or $expected[$providerDesktopHelperPath].sha256 -cne $release.providerDesktopHelperSha256) { throw 'Provider-desktop-helper release provenance is incomplete.' }
foreach ($qmkPath in @('firmware/b122/keymap.c','firmware/b122/rules.mk','firmware/b122/config.h','firmware/b122/b122_manifest.h','firmware/b122/b122_protocol.c','firmware/b122/b122_protocol.h','firmware/vial.json')) {
  if (-not $expected.ContainsKey($qmkPath)) { throw "The packaged QMK/Vial overlay is incomplete: $qmkPath" }
}
$companionPackage = Read-Json (Join-Path $root 'app\package.json')
if ($companionPackage.b122Distribution.scope -cne 'javascript-companion-only' -or $companionPackage.b122Distribution.nativeHelpersIncluded -ne $false -or $companionPackage.b122Distribution.releaseEvidenceEligible -ne $false -or $companionPackage.b122Distribution.verifiedWindowsBundleBuilder -cne 'deployment/windows/Build-B122Release.ps1') { throw 'The npm companion package does not accurately declare its JavaScript-only distribution boundary.' }
if ($release.dotnetRuntime.version -cne '8.0.30' -or $release.dotnetRuntime.license -cne 'licenses/DOTNET-RUNTIME-LICENSE.txt' -or $release.dotnetRuntime.thirdPartyNotices -cne 'licenses/DOTNET-RUNTIME-THIRD-PARTY-NOTICES.txt' -or -not $expected.ContainsKey($release.dotnetRuntime.license) -or -not $expected.ContainsKey($release.dotnetRuntime.thirdPartyNotices)) { throw 'The self-contained .NET runtime notices are missing from release provenance.' }
$actualFiles = @(Get-ChildItem -LiteralPath $root -File -Recurse | Where-Object { $_.Name -notin @('SHA256SUMS.json', 'sbom.spdx.json', 'release.json') })
if ($actualFiles.Count -ne $checksums.Count) { throw 'The bundle has missing or unmanifested payload files.' }
foreach ($file in $actualFiles) {
  $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
  if (-not $expected.ContainsKey($relative)) { throw "Unmanifested payload file: $relative" }
  $entry = $expected[$relative]
  $digest = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($digest -cne $entry.sha256 -or [long]$file.Length -ne [long]$entry.bytes) { throw "Payload digest or size mismatch: $relative" }
}
foreach ($file in $sbomFiles) {
  $relative = ([string]$file.fileName).TrimStart('.', '/')
  $checksum = @($file.checksums | Where-Object { $_.algorithm -ceq 'SHA256' })
  if (-not $expected.ContainsKey($relative) -or $checksum.Count -ne 1 -or $checksum[0].checksumValue -cne $expected[$relative].sha256) { throw "SPDX file evidence is incomplete: $relative" }
}

$vsixPath = Join-Path $root 'extension\sxsy-b122-switchyard.vsix'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($vsixPath)
try {
  foreach ($entryName in @('extension.vsixmanifest', '[Content_Types].xml', 'extension/package.json', 'extension/dist/extension.js')) {
    if ($null -eq $archive.GetEntry($entryName)) { throw "VSIX entry is missing: $entryName" }
  }
} finally { $archive.Dispose() }

$sourcePath = Join-Path $root 'source\sxsy-b122-source.zip'
$sourceArchive = [IO.Compression.ZipFile]::OpenRead($sourcePath)
try {
  foreach ($entryName in @('package.json', 'firmware/qmk/keymaps/b122/keymap.c', 'firmware/windows-hid-helper/Program.cs', 'apps/windows-companion/repository-runner-helper/Program.cs', 'apps/windows-companion/repository-runner-helper/Sxsy.B122.RepositoryRunner.csproj', 'apps/windows-companion/provider-desktop-helper/Program.cs', 'apps/windows-companion/provider-desktop-helper/Sxsy.B122.ProviderDesktopHelper.csproj', 'deployment/windows/B122ReleaseIntegrity.psm1', 'docs/SXSY-B122-complete-key-specification-and-audit.md', 'docs/historical-interview-notes-reconstructed.md', 'docs/adversarial-review.md')) {
    if ($null -eq $sourceArchive.GetEntry($entryName)) { throw "Source archive entry is missing: $entryName" }
  }
} finally { $sourceArchive.Dispose() }

$validationStatus = if ($developmentOnly) { 'development-only' } else { 'passed' }
[ordered]@{ schema='sxsy-b122.release-validation'; version=1; status=$validationStatus; sourceCommit=[string]$release.sourceCommit; evidenceEligible=[bool]$release.evidenceEligible; payloadCount=$checksums.Count; spdxFiles=$sbomFiles.Count; hardwareAcceptance=$false; highConsequenceAcceptance=$false } | ConvertTo-Json -Compress
