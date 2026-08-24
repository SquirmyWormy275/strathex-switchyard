Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-B122ChildPath {
  param([Parameter(Mandatory=$true)][string]$Parent,[Parameter(Mandatory=$true)][string]$Child)
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $childFull = [IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentFull,[StringComparison]::OrdinalIgnoreCase)) { throw "Refusing a path outside the B122 install root: $childFull" }
  return $childFull
}

function Test-B122VersionId {
  param([Parameter(Mandatory=$true)][string]$VersionId)
  if ($VersionId -notmatch '^[0-9a-f]{40}$') { throw 'A B122 installed version must be one exact source commit.' }
  return $VersionId.ToLowerInvariant()
}

function Get-B122InstallState {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $path = Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'install-state.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  $state = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $parsed = [DateTime]::MinValue
  if ($state.schema -cne 'sxsy-b122.install-state' -or $state.version -ne 1 -or $state.current -notmatch '^[0-9a-f]{40}$' -or ($null -ne $state.previous -and $state.previous -notmatch '^[0-9a-f]{40}$') -or -not [DateTime]::TryParse([string]$state.updatedAt,[ref]$parsed)) { throw 'The protected B122 install pointer is malformed.' }
  $current = Join-Path (Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'versions') $state.current
  Assert-B122ChildPath -Parent $InstallRoot -Child $current | Out-Null
  if (-not (Test-Path -LiteralPath $current -PathType Container)) { throw 'The current B122 install pointer references a missing version.' }
  return $state
}

function Write-B122InstallStateAtomic {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$Current,[AllowNull()][string]$Previous)
  $root = [IO.Path]::GetFullPath($InstallRoot)
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $currentId = Test-B122VersionId $Current
  $previousId = if ([string]::IsNullOrWhiteSpace($Previous)) { $null } else { Test-B122VersionId $Previous }
  foreach ($id in @($currentId,$previousId)) {
    if ($null -eq $id) { continue }
    $versionRoot = Join-Path (Join-Path $root 'versions') $id
    Assert-B122ChildPath -Parent $root -Child $versionRoot | Out-Null
    if (-not (Test-Path -LiteralPath $versionRoot -PathType Container)) { throw "Cannot point at a missing B122 version: $id" }
  }
  $state = [ordered]@{ schema='sxsy-b122.install-state'; version=1; current=$currentId; previous=$previousId; updatedAt=(Get-Date).ToUniversalTime().ToString('o') }
  $path = Join-Path $root 'install-state.json'; $temporary = Join-Path $root ('.install-state-' + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [IO.File]::WriteAllText($temporary,($state | ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $path -Force
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
  return Get-B122InstallState -InstallRoot $root
}

function Repair-B122InterruptedInstall {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $root = [IO.Path]::GetFullPath($InstallRoot); $versions = Join-Path $root 'versions'
  if (-not (Test-Path -LiteralPath $versions -PathType Container)) { return }
  foreach ($entry in @(Get-ChildItem -LiteralPath $versions -Directory -Force | Where-Object { $_.Name.StartsWith('.staging-',[StringComparison]::Ordinal) })) {
    Assert-B122ChildPath -Parent $versions -Child $entry.FullName | Out-Null
    Remove-Item -LiteralPath $entry.FullName -Recurse -Force
  }
}

function Import-B122ValidatedBundle {
  param([Parameter(Mandatory=$true)][string]$BundleRoot,[Parameter(Mandatory=$true)][string]$InstallRoot)
  $source = [IO.Path]::GetFullPath($BundleRoot); $root = [IO.Path]::GetFullPath($InstallRoot)
  $releasePath = Join-Path $source 'release.json'
  if (-not (Test-Path -LiteralPath $releasePath -PathType Leaf)) { throw 'The reviewed B122 bundle has no release.json.' }
  $release = Get-Content -LiteralPath $releasePath -Raw | ConvertFrom-Json
  if ($release.schema -cne 'sxsy-b122.windows-release' -or $release.version -ne 1) { throw 'The reviewed B122 bundle release identity is invalid.' }
  $versionId = Test-B122VersionId ([string]$release.sourceCommit)
  $versions = Join-Path $root 'versions'; New-Item -ItemType Directory -Force -Path $versions | Out-Null
  Repair-B122InterruptedInstall -InstallRoot $root
  $destination = Join-Path $versions $versionId; Assert-B122ChildPath -Parent $versions -Child $destination | Out-Null
  if (Test-Path -LiteralPath $destination -PathType Container) { return $destination }
  $staging = Join-Path $versions ('.staging-' + $versionId + '-' + [guid]::NewGuid().ToString('N')); Assert-B122ChildPath -Parent $versions -Child $staging | Out-Null
  try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    if (@(Get-ChildItem -LiteralPath $source -Recurse -Force | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }).Count -ne 0) { throw 'The reviewed B122 bundle contains a reparse point.' }
    foreach ($entry in @(Get-ChildItem -LiteralPath $source -Force)) { Copy-Item -LiteralPath $entry.FullName -Destination $staging -Recurse -Force }
    $copied = Get-Content -LiteralPath (Join-Path $staging 'release.json') -Raw | ConvertFrom-Json
    if ([string]$copied.sourceCommit -cne $versionId) { throw 'The staged B122 release identity changed during copy.' }
    Move-Item -LiteralPath $staging -Destination $destination
  } finally { if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force } }
  return $destination
}

function Set-B122CurrentVersion {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$VersionId)
  $next = Test-B122VersionId $VersionId; $existing = Get-B122InstallState -InstallRoot $InstallRoot
  $previous = if ($null -eq $existing -or $existing.current -ceq $next) { if ($null -eq $existing) { $null } else { $existing.previous } } else { [string]$existing.current }
  return Write-B122InstallStateAtomic -InstallRoot $InstallRoot -Current $next -Previous $previous
}

function Restore-B122PreviousVersion {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $state = Get-B122InstallState -InstallRoot $InstallRoot
  if ($null -eq $state -or [string]::IsNullOrWhiteSpace([string]$state.previous)) { throw 'No previous B122 version is available for rollback.' }
  return Write-B122InstallStateAtomic -InstallRoot $InstallRoot -Current ([string]$state.previous) -Previous ([string]$state.current)
}

function Get-B122CurrentBundle {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $state = Get-B122InstallState -InstallRoot $InstallRoot
  if ($null -eq $state) { throw 'SXSY-B122 is not installed.' }
  return Join-Path (Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'versions') ([string]$state.current)
}

function Stop-B122InstalledCompanion {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\versions\'
  foreach ($candidate in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)) {
    $line = [string]$candidate.CommandLine
    if (-not $line -or -not $line.StartsWith('"',[StringComparison]::Ordinal)) { continue }
    if ($line.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -lt 0 -or $line.IndexOf('\app\dist\apps\windows-companion\src\main.js',[StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
    Stop-Process -Id $candidate.ProcessId -Force -ErrorAction Stop
  }
}

Export-ModuleMember -Function Assert-B122ChildPath,Get-B122InstallState,Write-B122InstallStateAtomic,Repair-B122InterruptedInstall,Import-B122ValidatedBundle,Set-B122CurrentVersion,Restore-B122PreviousVersion,Get-B122CurrentBundle,Stop-B122InstalledCompanion
