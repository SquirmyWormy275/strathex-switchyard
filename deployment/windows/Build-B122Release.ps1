[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$NodeRuntimeZip,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$NodeRuntimeSha256,
  [string]$OutputDirectory,
  [string]$SandboxHelperPath,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$SandboxHelperSha256,
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
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Path $output | Out-Null
if (-not $SkipVerification) {
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
New-Item -ItemType Directory -Path $app,$runtime,$extension,$scripts | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'apps\windows-companion\dist') -Destination (Join-Path $app 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $repo 'apps\windows-companion\package.json') -Destination $app
Copy-Item -LiteralPath (Join-Path $repo 'apps\windows-companion\README.md') -Destination $app
$helperDestination = Join-Path $app 'dist\apps\windows-companion\sandbox-helper'
New-Item -ItemType Directory -Path $helperDestination | Out-Null
Copy-Item -LiteralPath $helper -Destination (Join-Path $helperDestination 'b122-sandbox-worker.exe')
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
$vsix = Join-Path $extension 'sxsy-b122-switchyard.vsix'
[IO.Compression.ZipFile]::CreateFromDirectory($vsixRoot, $vsix, [IO.Compression.CompressionLevel]::Optimal, $false)
Copy-Item -LiteralPath (Join-Path $repo 'apps\vscode-extension\dist') -Destination (Join-Path $extension 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $repo 'apps\vscode-extension\package.json') -Destination $extension
Copy-Item -LiteralPath (Join-Path $repo 'apps\vscode-extension\README.md') -Destination $extension
foreach ($name in @('Start-B122.ps1','Test-B122Health.mjs','Test-B122PortableBundle.ps1','New-B122NetworkPolicy.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $scripts }
Copy-Item -LiteralPath (Join-Path $repo 'SECURITY.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $repo 'LICENSING.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $repo 'ATTRIBUTION.md') -Destination $output

Remove-Item -LiteralPath $runtimeExtract -Recurse -Force
Remove-Item -LiteralPath $vsixRoot -Recurse -Force
if (Test-Path -LiteralPath (Join-Path $output '.helper-publish')) { Remove-Item -LiteralPath (Join-Path $output '.helper-publish') -Recurse -Force }

$portableSmoke = & (Join-Path $scripts 'Test-B122PortableBundle.ps1') -BundleRoot $output
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($portableSmoke)) { throw 'Portable bundle smoke verification failed.' }
Write-Utf8NoBom (Join-Path $output 'portable-smoke.json') $portableSmoke

$payload = Get-ChildItem -LiteralPath $output -File -Recurse | Where-Object { $_.Name -notin @('SHA256SUMS.json','sbom.spdx.json','release.json') } | Sort-Object FullName | ForEach-Object {
  [ordered]@{ path = $_.FullName.Substring($output.Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $_.Length }
}
Write-Utf8NoBom (Join-Path $output 'SHA256SUMS.json') ($payload | ConvertTo-Json -Depth 4)
$packages = @(
  [ordered]@{ SPDXID='SPDXRef-Package-B122'; name='SXSY-B122 Switchyard'; versionInfo='0.2.0'; downloadLocation='NOASSERTION'; licenseConcluded='NOASSERTION' },
  [ordered]@{ SPDXID='SPDXRef-Package-Node'; name='Node.js runtime'; versionInfo=(& (Join-Path $runtime 'node.exe') -p 'process.version'); downloadLocation='https://nodejs.org/'; licenseConcluded='NOASSERTION' }
)
Write-Utf8NoBom (Join-Path $output 'sbom.spdx.json') ([ordered]@{ spdxVersion='SPDX-2.3'; dataLicense='CC0-1.0'; SPDXID='SPDXRef-DOCUMENT'; name='SXSY-B122 Windows bundle'; documentNamespace=('https://strathex.invalid/spdx/b122/' + [guid]::NewGuid()); creationInfo=[ordered]@{ created=(Get-Date).ToUniversalTime().ToString('o'); creators=@('Tool: SXSY-B122 Build-B122Release.ps1') }; packages=$packages; files=$payload } | ConvertTo-Json -Depth 8)
Write-Utf8NoBom (Join-Path $output 'release.json') ([ordered]@{ schema='sxsy-b122.windows-release'; version=1; createdAt=(Get-Date).ToUniversalTime().ToString('o'); architecture='x64'; companion='0.2.0'; vscodeExtension='0.1.0'; payloadCount=$payload.Count; hardwareAcceptance=$false; highConsequenceAcceptance=$false } | ConvertTo-Json)
Write-Output "Built verified SXSY-B122 Windows bundle: $output"
