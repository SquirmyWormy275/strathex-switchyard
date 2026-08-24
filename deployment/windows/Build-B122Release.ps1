[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$NodeRuntimeZip,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$NodeRuntimeSha256,
  [Parameter(Mandatory = $true)][string]$NodeRuntimeSourceUri,
  [string]$OutputDirectory,
  [string]$SandboxHelperPath,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$SandboxHelperSha256,
  [string]$RawHidHelperPath,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$RawHidHelperSha256,
  [switch]$SkipVerification
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$OutputDirectory = if ($OutputDirectory) { $OutputDirectory } else { Join-Path $repo 'artifacts\b122-windows' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
Set-Location -LiteralPath $repo
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($Path), $Content, $utf8NoBom)
}
function Assert-Child([string]$Parent, [string]$Child) {
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $childFull = [IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing path outside the release root: $childFull" }
}
Assert-Child ([IO.Path]::GetFullPath((Join-Path $repo 'artifacts'))) $output
$nodeRuntimeArchive = [IO.Path]::GetFullPath($NodeRuntimeZip)
if (-not (Test-Path -LiteralPath $nodeRuntimeArchive -PathType Leaf)) { throw 'The reviewed official Node runtime archive is missing.' }
if (-not ((Get-FileHash -LiteralPath $nodeRuntimeArchive -Algorithm SHA256).Hash.Equals($NodeRuntimeSha256, [StringComparison]::OrdinalIgnoreCase))) { throw 'The Node runtime archive digest does not match the reviewed value.' }
$nodeSource = [Uri]$NodeRuntimeSourceUri
if ($nodeSource.Scheme -cne 'https' -or $nodeSource.Host -cne 'nodejs.org' -or $nodeSource.Query -or $nodeSource.Fragment -or $nodeSource.UserInfo -or $nodeSource.AbsoluteUri -cne $NodeRuntimeSourceUri -or $nodeSource.AbsolutePath -notmatch '^/dist/v\d+\.\d+\.\d+/node-v\d+\.\d+\.\d+-win-x64\.zip$' -or [IO.Path]::GetFileName($nodeRuntimeArchive) -cne [IO.Path]::GetFileName($nodeSource.AbsolutePath)) { throw 'The Node runtime source must be the exact matching official nodejs.org Windows x64 archive URL.' }
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Path $output | Out-Null
if (-not $SkipVerification) {
  & git.exe diff --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Release verification requires a clean unstaged source tree.' }
  & git.exe diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Release verification requires a clean staged source tree.' }
  & npm.cmd run typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed.' }
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw 'Test verification failed.' }
}
& npm.cmd run build:companion
if ($LASTEXITCODE -ne 0) { throw 'Companion build failed.' }
& npm.cmd run build:vscode
if ($LASTEXITCODE -ne 0) { throw 'VS Code extension build failed.' }

$helper = $SandboxHelperPath
if (-not $helper) {
  if ($SandboxHelperSha256) { throw '-SandboxHelperSha256 is valid only with -SandboxHelperPath.' }
  $dotnet = (Get-Command dotnet.exe -ErrorAction SilentlyContinue).Source
  if (-not $dotnet -or -not (& $dotnet --list-sdks)) { throw 'A .NET 8 SDK or -SandboxHelperPath is required to build the fixed Windows Sandbox guest helper.' }
  $publish = Join-Path $output '.helper-publish'
  Assert-Child $output $publish
  & $dotnet publish (Join-Path $repo 'apps\windows-companion\sandbox-helper\Sxsy.B122.SandboxHelper.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $publish
  if ($LASTEXITCODE -ne 0) { throw 'Windows Sandbox guest-helper build failed.' }
  $helper = Join-Path $publish 'b122-sandbox-worker.exe'
}
$helper = [IO.Path]::GetFullPath($helper)
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'The fixed sandbox helper executable is missing.' }
if ($SandboxHelperPath) {
  if (-not $SandboxHelperSha256) { throw '-SandboxHelperSha256 is required with a prebuilt helper.' }
  if (-not ((Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.Equals($SandboxHelperSha256, [StringComparison]::OrdinalIgnoreCase))) { throw 'The sandbox helper digest does not match the reviewed value.' }
}

$rawHidHelper = $RawHidHelperPath
if (-not $rawHidHelper) {
  if ($RawHidHelperSha256) { throw '-RawHidHelperSha256 is valid only with -RawHidHelperPath.' }
  $dotnet = (Get-Command dotnet.exe -ErrorAction SilentlyContinue).Source
  if (-not $dotnet -or -not (& $dotnet --list-sdks)) { throw 'A .NET 8 SDK or -RawHidHelperPath is required to build the fixed Windows Raw-HID helper.' }
  $rawHidPublish = Join-Path $output '.raw-hid-helper-publish'
  Assert-Child $output $rawHidPublish
  & $dotnet publish (Join-Path $repo 'firmware\windows-hid-helper\Strathex.B122.RawHidHelper.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $rawHidPublish
  if ($LASTEXITCODE -ne 0) { throw 'Windows Raw-HID helper build failed.' }
  $rawHidHelper = Join-Path $rawHidPublish 'strathex-b122-hid-helper.exe'
}
$rawHidHelper = [IO.Path]::GetFullPath($rawHidHelper)
if (-not (Test-Path -LiteralPath $rawHidHelper -PathType Leaf)) { throw 'The fixed Raw-HID helper executable is missing.' }
if ($RawHidHelperPath) {
  if (-not $RawHidHelperSha256) { throw '-RawHidHelperSha256 is required with a prebuilt Raw-HID helper.' }
  if (-not ((Get-FileHash -LiteralPath $rawHidHelper -Algorithm SHA256).Hash.Equals($RawHidHelperSha256, [StringComparison]::OrdinalIgnoreCase))) { throw 'The Raw-HID helper digest does not match the reviewed value.' }
}
$helperDigest = (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant()
$rawHidHelperDigest = (Get-FileHash -LiteralPath $rawHidHelper -Algorithm SHA256).Hash.ToLowerInvariant()

$runtimeExtract = Join-Path $output '.node-runtime'
Assert-Child $output $runtimeExtract
Expand-Archive -LiteralPath $nodeRuntimeArchive -DestinationPath $runtimeExtract
$node = Get-ChildItem -LiteralPath $runtimeExtract -Filter node.exe -File -Recurse | Select-Object -First 1
$nodeLicense = Get-ChildItem -LiteralPath $runtimeExtract -Filter LICENSE -File -Recurse | Select-Object -First 1
if (-not $node -or -not $nodeLicense) { throw 'The official Node runtime archive must contain node.exe and LICENSE.' }

$app = Join-Path $output 'app'
$runtime = Join-Path $output 'runtime'
$extension = Join-Path $output 'extension'
$scripts = Join-Path $output 'scripts'
$provisioning = Join-Path $scripts 'provisioning'
$documentation = Join-Path $output 'docs'
$source = Join-Path $output 'source'
New-Item -ItemType Directory -Path $app,$runtime,$extension,$scripts,$provisioning,$documentation,$source | Out-Null
& git.exe archive --format=zip --output (Join-Path $source 'sxsy-b122-source.zip') HEAD
if ($LASTEXITCODE -ne 0) { throw 'The exact source-commit archive could not be created.' }
Copy-Item -LiteralPath (Join-Path $repo 'apps\windows-companion\dist') -Destination (Join-Path $app 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $repo 'apps\windows-companion\package.json') -Destination $app
Copy-Item -LiteralPath (Join-Path $repo 'apps\windows-companion\README.md') -Destination $app
$helperDestination = Join-Path $app 'dist\apps\windows-companion\sandbox-helper'
New-Item -ItemType Directory -Path $helperDestination | Out-Null
Copy-Item -LiteralPath $helper -Destination (Join-Path $helperDestination 'b122-sandbox-worker.exe')
$rawHidDestination = Join-Path $app 'dist\apps\windows-companion\raw-hid'
New-Item -ItemType Directory -Path $rawHidDestination | Out-Null
Copy-Item -LiteralPath $rawHidHelper -Destination (Join-Path $rawHidDestination 'strathex-b122-hid-helper.exe')
Copy-Item -LiteralPath $node.FullName -Destination (Join-Path $runtime 'node.exe')
Copy-Item -LiteralPath $nodeLicense.FullName -Destination (Join-Path $runtime 'NODE-LICENSE.txt')

$vsixRoot = Join-Path $output '.vsix'
Assert-Child $output $vsixRoot
$vsixExtension = Join-Path $vsixRoot 'extension'
New-Item -ItemType Directory -Path $vsixExtension | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'apps\vscode-extension\dist') -Destination (Join-Path $vsixExtension 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $repo 'apps\vscode-extension\package.json') -Destination $vsixExtension
Copy-Item -LiteralPath (Join-Path $repo 'apps\vscode-extension\README.md') -Destination $vsixExtension
$vsixPackagePath=Join-Path $vsixExtension 'package.json'; $vsixPackage=Get-Content -LiteralPath $vsixPackagePath -Raw | ConvertFrom-Json; $vsixPackage.name='strathex-switchyard-b122'; Write-Utf8NoBom $vsixPackagePath ($vsixPackage | ConvertTo-Json -Depth 20)
Copy-Item -LiteralPath (Join-Path $repo 'deployment\windows\extension.vsixmanifest') -Destination $vsixRoot
Copy-Item -LiteralPath (Join-Path $repo 'deployment\windows\Content_Types.xml') -Destination (Join-Path $vsixRoot '[Content_Types].xml')
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$vsix = Join-Path $extension 'sxsy-b122-switchyard.vsix'
$vsixArchive = [IO.Compression.ZipFile]::Open($vsix, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($sourceFile in (Get-ChildItem -LiteralPath $vsixRoot -File -Recurse | Sort-Object FullName)) {
    $entryName = $sourceFile.FullName.Substring($vsixRoot.Length + 1).Replace('\', '/')
    $entry = $vsixArchive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
    $inputStream = [IO.File]::OpenRead($sourceFile.FullName); $outputStream = $entry.Open()
    try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
  }
} finally { $vsixArchive.Dispose() }
Copy-Item -LiteralPath (Join-Path $repo 'apps\vscode-extension\dist') -Destination (Join-Path $extension 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $repo 'apps\vscode-extension\package.json') -Destination $extension
Copy-Item -LiteralPath (Join-Path $repo 'apps\vscode-extension\README.md') -Destination $extension
foreach ($name in @('Start-B122.ps1','Test-B122Health.mjs','Test-B122PortableBundle.ps1','Test-B122ReleaseArtifact.ps1','New-B122NetworkPolicy.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $scripts }
foreach ($name in @('B122ManifestTools.psm1','New-B122RepositoryRuntimeManifest.ps1','New-B122WindowsSandboxCatalog.ps1','README-manifest-generators.md','repository-runtime-plan.template.json','Test-B122ManifestGenerators.ps1','windows-sandbox-catalog-plan.template.json')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $provisioning }
$documentationSource = [IO.Path]::GetFullPath((Join-Path $repo 'docs')).TrimEnd('\')
foreach ($document in (Get-ChildItem -LiteralPath $documentationSource -File -Recurse | Sort-Object FullName)) {
  $relativeDocument = $document.FullName.Substring($documentationSource.Length + 1)
  $documentDestination = Join-Path $documentation $relativeDocument
  New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($documentDestination)) | Out-Null
  Copy-Item -LiteralPath $document.FullName -Destination $documentDestination
}
Copy-Item -LiteralPath (Join-Path $repo 'README.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $repo 'SECURITY.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $repo 'LICENSING.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $repo 'ATTRIBUTION.md') -Destination $output

Remove-Item -LiteralPath $runtimeExtract -Recurse -Force
Remove-Item -LiteralPath $vsixRoot -Recurse -Force
if (Test-Path -LiteralPath (Join-Path $output '.helper-publish')) { Remove-Item -LiteralPath (Join-Path $output '.helper-publish') -Recurse -Force }
if (Test-Path -LiteralPath (Join-Path $output '.raw-hid-helper-publish')) { Remove-Item -LiteralPath (Join-Path $output '.raw-hid-helper-publish') -Recurse -Force }

$portableSmoke = & (Join-Path $scripts 'Test-B122PortableBundle.ps1') -BundleRoot $output
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($portableSmoke)) { throw 'Portable bundle smoke verification failed.' }
Write-Utf8NoBom (Join-Path $output 'portable-smoke.json') $portableSmoke

$payload = Get-ChildItem -LiteralPath $output -File -Recurse | Where-Object { $_.Name -notin @('SHA256SUMS.json','sbom.spdx.json','release.json') } | Sort-Object FullName | ForEach-Object {
  [ordered]@{ path = $_.FullName.Substring($output.Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $_.Length }
}
Write-Utf8NoBom (Join-Path $output 'SHA256SUMS.json') ($payload | ConvertTo-Json -Depth 4)
$nodeVersion = & (Join-Path $runtime 'node.exe') -p 'process.version'
$packages = @(
  [ordered]@{ SPDXID='SPDXRef-Package-B122'; name='SXSY-B122 Switchyard'; versionInfo='0.2.0'; downloadLocation='NOASSERTION'; filesAnalyzed=$true; licenseConcluded='NOASSERTION'; licenseDeclared='NOASSERTION'; copyrightText='NOASSERTION' },
  [ordered]@{ SPDXID='SPDXRef-Package-Node'; name='Node.js runtime'; versionInfo=$nodeVersion; downloadLocation=$NodeRuntimeSourceUri; filesAnalyzed=$true; licenseConcluded='NOASSERTION'; licenseDeclared='NOASSERTION'; copyrightText='NOASSERTION' }
)
$spdxFiles = @(); $relationships = @(
  [ordered]@{ spdxElementId='SPDXRef-DOCUMENT'; relationshipType='DESCRIBES'; relatedSpdxElement='SPDXRef-Package-B122' },
  [ordered]@{ spdxElementId='SPDXRef-DOCUMENT'; relationshipType='DESCRIBES'; relatedSpdxElement='SPDXRef-Package-Node' }
)
for ($index = 0; $index -lt $payload.Count; $index++) {
  $entry = $payload[$index]; $fileId = 'SPDXRef-File-' + ($index + 1)
  $spdxFiles += [ordered]@{ SPDXID=$fileId; fileName=('./' + $entry.path); checksums=@([ordered]@{ algorithm='SHA256'; checksumValue=$entry.sha256 }); licenseConcluded='NOASSERTION'; copyrightText='NOASSERTION' }
  $owner = if ($entry.path -in @('runtime/node.exe', 'runtime/NODE-LICENSE.txt')) { 'SPDXRef-Package-Node' } else { 'SPDXRef-Package-B122' }
  $relationships += [ordered]@{ spdxElementId=$owner; relationshipType='CONTAINS'; relatedSpdxElement=$fileId }
}
Write-Utf8NoBom (Join-Path $output 'sbom.spdx.json') ([ordered]@{ spdxVersion='SPDX-2.3'; dataLicense='CC0-1.0'; SPDXID='SPDXRef-DOCUMENT'; name='SXSY-B122 Windows bundle'; documentNamespace=('https://strathex.invalid/spdx/b122/' + [guid]::NewGuid()); creationInfo=[ordered]@{ created=(Get-Date).ToUniversalTime().ToString('o'); creators=@('Tool: SXSY-B122 Build-B122Release.ps1') }; packages=$packages; files=$spdxFiles; relationships=$relationships } | ConvertTo-Json -Depth 10)
$sourceCommit = (& git.exe rev-parse HEAD).Trim()
Write-Utf8NoBom (Join-Path $output 'release.json') ([ordered]@{ schema='sxsy-b122.windows-release'; version=1; createdAt=(Get-Date).ToUniversalTime().ToString('o'); architecture='x64'; sourceCommit=$sourceCommit; companion='0.2.0'; vscodeExtension='0.1.0'; nodeRuntime=[ordered]@{ version=$nodeVersion; source=$NodeRuntimeSourceUri; archiveSha256=$NodeRuntimeSha256.ToLowerInvariant() }; sandboxHelperSha256=$helperDigest; rawHidHelperSha256=$rawHidHelperDigest; payloadCount=$payload.Count; hardwareAcceptance=$false; highConsequenceAcceptance=$false } | ConvertTo-Json -Depth 5)
$releaseValidation = & (Join-Path $scripts 'Test-B122ReleaseArtifact.ps1') -BundleRoot $output
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($releaseValidation)) { throw 'Release artifact validation failed.' }
Write-Output "Built verified SXSY-B122 Windows bundle: $output"
