[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$NodeRuntimeZip,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\artifacts\b122-windows'),
  [string]$SandboxHelperPath,
  [switch]$SkipVerification
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
Set-Location -LiteralPath $repo
function Assert-Child([string]$Parent, [string]$Child) {
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $childFull = [IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing path outside the release root: $childFull" }
}
Assert-Child ([IO.Path]::GetFullPath((Join-Path $repo 'artifacts'))) $output
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

$runtimeExtract = Join-Path $output '.node-runtime'
Assert-Child $output $runtimeExtract
Expand-Archive -LiteralPath ([IO.Path]::GetFullPath($NodeRuntimeZip)) -DestinationPath $runtimeExtract
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
$vsixPackagePath=Join-Path $vsixExtension 'package.json'; $vsixPackage=Get-Content -LiteralPath $vsixPackagePath -Raw | ConvertFrom-Json; $vsixPackage.name='strathex-switchyard-b122'; $vsixPackage | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $vsixPackagePath -Encoding utf8NoBOM
Copy-Item -LiteralPath (Join-Path $repo 'deployment\windows\extension.vsixmanifest') -Destination $vsixRoot
Copy-Item -LiteralPath (Join-Path $repo 'deployment\windows\Content_Types.xml') -Destination (Join-Path $vsixRoot '[Content_Types].xml')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$vsix = Join-Path $extension 'sxsy-b122-switchyard.vsix'
[IO.Compression.ZipFile]::CreateFromDirectory($vsixRoot, $vsix, [IO.Compression.CompressionLevel]::Optimal, $false)
Copy-Item -LiteralPath (Join-Path $repo 'apps\vscode-extension\dist') -Destination (Join-Path $extension 'dist') -Recurse
foreach ($name in @('Start-B122.ps1','Test-B122Health.mjs','New-B122NetworkPolicy.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $scripts }
Copy-Item -LiteralPath (Join-Path $repo 'SECURITY.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $repo 'LICENSING.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $repo 'ATTRIBUTION.md') -Destination $output

Remove-Item -LiteralPath $runtimeExtract -Recurse -Force
Remove-Item -LiteralPath $vsixRoot -Recurse -Force
if (Test-Path -LiteralPath (Join-Path $output '.helper-publish')) { Remove-Item -LiteralPath (Join-Path $output '.helper-publish') -Recurse -Force }

$payload = Get-ChildItem -LiteralPath $output -File -Recurse | Where-Object { $_.Name -notin @('SHA256SUMS.json','sbom.spdx.json','release.json') } | Sort-Object FullName | ForEach-Object {
  [ordered]@{ path = $_.FullName.Substring($output.Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $_.Length }
}
$payload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.json') -Encoding utf8NoBOM
$packages = @(
  [ordered]@{ SPDXID='SPDXRef-Package-B122'; name='SXSY-B122 Switchyard'; versionInfo='0.2.0'; downloadLocation='NOASSERTION'; licenseConcluded='NOASSERTION' },
  [ordered]@{ SPDXID='SPDXRef-Package-Node'; name='Node.js runtime'; versionInfo=(& (Join-Path $runtime 'node.exe') -p 'process.version'); downloadLocation='https://nodejs.org/'; licenseConcluded='NOASSERTION' }
)
[ordered]@{ spdxVersion='SPDX-2.3'; dataLicense='CC0-1.0'; SPDXID='SPDXRef-DOCUMENT'; name='SXSY-B122 Windows bundle'; documentNamespace=('https://strathex.invalid/spdx/b122/' + [guid]::NewGuid()); creationInfo=[ordered]@{ created=(Get-Date).ToUniversalTime().ToString('o'); creators=@('Tool: SXSY-B122 Build-B122Release.ps1') }; packages=$packages; files=$payload } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'sbom.spdx.json') -Encoding utf8NoBOM
[ordered]@{ schema='sxsy-b122.windows-release'; version=1; createdAt=(Get-Date).ToUniversalTime().ToString('o'); architecture='x64'; companion='0.2.0'; vscodeExtension='0.1.0'; payloadCount=$payload.Count; hardwareAcceptance=$false; highConsequenceAcceptance=$false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'release.json') -Encoding utf8NoBOM
Write-Output "Built verified SXSY-B122 Windows bundle: $output"
