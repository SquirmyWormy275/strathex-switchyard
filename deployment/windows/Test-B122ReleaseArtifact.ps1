[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$BundleRoot)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($BundleRoot)
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'The B122 release root is missing.' }

function Read-Json([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Release metadata is missing: $Path" }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

$release = Read-Json (Join-Path $root 'release.json')
$checksumsDocument = Read-Json (Join-Path $root 'SHA256SUMS.json')
$checksums = @($checksumsDocument | ForEach-Object { $_ })
$sbom = Read-Json (Join-Path $root 'sbom.spdx.json')
$sbomPackages = @($sbom.packages | ForEach-Object { $_ })
$sbomFiles = @($sbom.files | ForEach-Object { $_ })
if ($release.schema -cne 'sxsy-b122.windows-release' -or $release.version -ne 1 -or $release.hardwareAcceptance -ne $false -or $release.highConsequenceAcceptance -ne $false) { throw 'Release status metadata is invalid or overclaims acceptance.' }
if ($release.payloadCount -ne $checksums.Count) { throw 'Release payload count does not match the checksum manifest.' }
if ($sbom.spdxVersion -cne 'SPDX-2.3' -or $sbom.dataLicense -cne 'CC0-1.0' -or $sbom.SPDXID -cne 'SPDXRef-DOCUMENT') { throw 'The SPDX document header is invalid.' }
if ($sbomPackages.Count -lt 2 -or $sbomFiles.Count -ne $checksums.Count) { throw 'The SPDX package or file inventory is incomplete.' }

$expected = @{}
foreach ($entry in $checksums) {
  if ($entry.path -notmatch '^[^\\\r\n\0]+$' -or $entry.sha256 -notmatch '^[0-9a-f]{64}$' -or $expected.ContainsKey($entry.path)) { throw 'The checksum manifest contains an invalid or duplicate entry.' }
  $expected[$entry.path] = $entry
}
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

[ordered]@{ schema='sxsy-b122.release-validation'; version=1; status='passed'; payloadCount=$checksums.Count; spdxFiles=$sbomFiles.Count; hardwareAcceptance=$false; highConsequenceAcceptance=$false } | ConvertTo-Json -Compress
