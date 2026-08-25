$ErrorActionPreference = 'Stop'
$build = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Build-B122Release.ps1') -Raw
$portable = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Test-B122PortableBundle.ps1') -Raw
$artifact = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Test-B122ReleaseArtifact.ps1') -Raw
$integritySource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'B122ReleaseIntegrity.psm1') -Raw
$companionPackage = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\apps\windows-companion\package.json') -Raw | ConvertFrom-Json

$requiredBuildTokens = @(
  'ProviderDesktopHelperPath',
  'ProviderDesktopHelperSha256',
  'provider-desktop-helper\Sxsy.B122.ProviderDesktopHelper.csproj',
  'sxsy-b122-provider-desktop-helper.exe',
  'providerDesktopHelperSha256',
  'New-B122ProviderDesktopPaths.ps1'
)
foreach ($token in $requiredBuildTokens) {
  if ($build.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
    throw "Release build is missing provider-desktop integration token: $token"
  }
}

foreach ($content in @($portable, $artifact)) {
  foreach ($token in @('provider-desktop', 'sxsy-b122-provider-desktop-helper.exe')) {
    if ($content.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
      throw "Release validation is missing provider-desktop integration token: $token"
    }
  }
}
if ($portable.IndexOf('sxsy-b122.provider-desktop-self-test', [StringComparison]::Ordinal) -lt 0) {
  throw 'Portable smoke does not validate the native provider-desktop self-test receipt.'
}
if ($artifact.IndexOf('providerDesktopHelperSha256', [StringComparison]::Ordinal) -lt 0) {
  throw 'Release provenance validation does not bind the provider-desktop helper digest.'
}
$hasProgramSource = $artifact.IndexOf('apps/windows-companion/provider-desktop-helper/Program.cs', [StringComparison]::Ordinal) -ge 0
$hasProjectSource = $artifact.IndexOf('apps/windows-companion/provider-desktop-helper/Sxsy.B122.ProviderDesktopHelper.csproj', [StringComparison]::Ordinal) -ge 0
if (-not $hasProgramSource -or -not $hasProjectSource) {
  throw 'The exact source archive validation omits the provider-desktop helper source.'
}

foreach ($token in @(
  'Get-B122ReleaseSourceCommit',
  'Assert-B122ReleaseSourceState',
  'archive --format=zip --output $sourceSnapshotArchive $sourceCommit',
  'Expand-Archive -LiteralPath $sourceSnapshotArchive -DestinationPath $buildRoot',
  'npm.cmd ci --ignore-scripts',
  "sourceAssembly='git-archive'",
  'verificationSkipped=$verificationSkipped',
  'evidenceEligible=$evidenceEligible',
  'package-qmk.ps1'
)) {
  if ($build.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
    throw "Release build is missing immutable-source/evidence token: $token"
  }
}
foreach ($token in @('--porcelain=v1', '--untracked-files=all', 'HEAD changed', 'worktree is not clean')) {
  if ($integritySource.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
    throw "Release source guard is missing state-rejection token: $token"
  }
}
if ([regex]::Matches($build, 'Assert-B122ReleaseSourceState').Count -lt 3) {
  throw 'Release build must check the pinned HEAD/worktree at entry and again around final validation.'
}
foreach ($token in @('AllowDevelopmentArtifact', 'verificationSkipped', 'evidenceEligible', 'development-only', 'firmware/b122/keymap.c', 'firmware/vial.json')) {
  if ($artifact.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
    throw "Release artifact validation is missing evidence/QMK token: $token"
  }
}
if ($companionPackage.b122Distribution.scope -cne 'javascript-companion-only' -or
    $companionPackage.b122Distribution.nativeHelpersIncluded -ne $false -or
    $companionPackage.b122Distribution.releaseEvidenceEligible -ne $false -or
    $companionPackage.b122Distribution.verifiedWindowsBundleBuilder -cne 'deployment/windows/Build-B122Release.ps1') {
  throw 'The npm package must explicitly identify itself as JavaScript-only and evidence-ineligible.'
}

$integrityModule = Join-Path $PSScriptRoot 'B122ReleaseIntegrity.psm1'
Import-Module -Name $integrityModule -Force
$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$testRepository = [IO.Path]::GetFullPath((Join-Path $temporaryBase ('sxsy-b122-release-integrity-' + [guid]::NewGuid().ToString('N'))))
$pinnedArchive = $testRepository + '-source.zip'
if (-not $testRepository.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing an unsafe release-integrity test root.' }
function Invoke-TestGit([string[]]$Arguments) {
  & git.exe -C $testRepository -c core.excludesFile= @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Release-integrity fixture Git command failed: $($Arguments -join ' ')" }
}
function Assert-Rejected([scriptblock]$Action, [string]$Pattern) {
  $rejected = $false
  try { & $Action | Out-Null } catch { $rejected = $_.Exception.Message -match $Pattern }
  if (-not $rejected) { throw "Release source guard did not reject: $Pattern" }
}
try {
  New-Item -ItemType Directory -Path $testRepository | Out-Null
  Invoke-TestGit @('init', '--initial-branch=main')
  Invoke-TestGit @('config', 'user.email', 'release-integrity@example.invalid')
  Invoke-TestGit @('config', 'user.name', 'Release Integrity Test')
  [IO.File]::WriteAllText((Join-Path $testRepository 'payload.txt'), "version one`n", (New-Object Text.UTF8Encoding($false)))
  Invoke-TestGit @('add', '--', 'payload.txt')
  Invoke-TestGit @('commit', '-m', 'fixture')
  $pinnedCommit = Get-B122ReleaseSourceCommit -RepositoryRoot $testRepository
  Assert-B122ReleaseSourceState -RepositoryRoot $testRepository -ExpectedCommit $pinnedCommit | Out-Null
  & git.exe -C $testRepository -c core.excludesFile= archive --format=zip --output $pinnedArchive $pinnedCommit
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the pinned-commit fixture archive.' }

  [IO.File]::WriteAllText((Join-Path $testRepository 'untracked.txt'), "untracked`n", (New-Object Text.UTF8Encoding($false)))
  Assert-Rejected { Assert-B122ReleaseSourceState -RepositoryRoot $testRepository -ExpectedCommit $pinnedCommit } 'not clean'
  Remove-Item -LiteralPath (Join-Path $testRepository 'untracked.txt') -Force

  [IO.File]::WriteAllText((Join-Path $testRepository 'payload.txt'), "unstaged`n", (New-Object Text.UTF8Encoding($false)))
  Assert-Rejected { Assert-B122ReleaseSourceState -RepositoryRoot $testRepository -ExpectedCommit $pinnedCommit } 'not clean'
  Invoke-TestGit @('restore', '--', 'payload.txt')

  [IO.File]::WriteAllText((Join-Path $testRepository 'payload.txt'), "staged`n", (New-Object Text.UTF8Encoding($false)))
  Invoke-TestGit @('add', '--', 'payload.txt')
  Assert-Rejected { Assert-B122ReleaseSourceState -RepositoryRoot $testRepository -ExpectedCommit $pinnedCommit } 'not clean'
  Invoke-TestGit @('commit', '-m', 'concurrent source change')
  Assert-Rejected { Assert-B122ReleaseSourceState -RepositoryRoot $testRepository -ExpectedCommit $pinnedCommit } 'HEAD changed'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($pinnedArchive)
  try {
    $entry = $archive.GetEntry('payload.txt')
    if ($null -eq $entry) { throw 'Pinned source archive omitted its reviewed payload.' }
    $reader = New-Object IO.StreamReader($entry.Open())
    try { $archivedPayload = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($archivedPayload.Trim() -cne 'version one') { throw 'Pinned source archive mixed in a later worktree or HEAD change.' }
  } finally { $archive.Dispose() }
} finally {
  if (Test-Path -LiteralPath $testRepository) { Remove-Item -LiteralPath $testRepository -Recurse -Force }
  if (Test-Path -LiteralPath $pinnedArchive) { Remove-Item -LiteralPath $pinnedArchive -Force }
}

$developmentBundle = [IO.Path]::GetFullPath((Join-Path $temporaryBase ('sxsy-b122-development-artifact-' + [guid]::NewGuid().ToString('N'))))
if (-not $developmentBundle.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing an unsafe development-artifact test root.' }
try {
  $developmentScripts = Join-Path $developmentBundle 'scripts'
  New-Item -ItemType Directory -Path $developmentScripts | Out-Null
  foreach ($name in @('B122InstallTools.psm1','Invoke-B122Current.ps1','Install-B122.ps1','Update-B122.ps1','Rollback-B122.ps1','Uninstall-B122.ps1')) {
    [IO.File]::WriteAllText((Join-Path $developmentScripts $name), '', (New-Object Text.UTF8Encoding($false)))
  }
  $developmentRelease = [ordered]@{
    schema='sxsy-b122.windows-release'; version=1; sourceCommit=('a' * 40); sourceAssembly='git-archive';
    verificationSkipped=$true; evidenceEligible=$false; hardwareAcceptance=$false; highConsequenceAcceptance=$false;
    sandboxHelperSha256=('b' * 64); repositoryRuntimeHelperSha256=('c' * 64); rawHidHelperSha256=('d' * 64); providerDesktopHelperSha256=('e' * 64); voiceHelperSha256=('f' * 64)
  }
  [IO.File]::WriteAllText((Join-Path $developmentBundle 'release.json'), ($developmentRelease | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  Assert-Rejected { & (Join-Path $PSScriptRoot 'Test-B122ReleaseArtifact.ps1') -BundleRoot $developmentBundle } 'ineligible for release evidence or installation'
} finally {
  if (Test-Path -LiteralPath $developmentBundle) { Remove-Item -LiteralPath $developmentBundle -Recurse -Force }
}

[ordered]@{
  schema = 'sxsy-b122.provider-desktop-release-test'
  version = 1
  status = 'passed'
  helperPackaged = $true
  selfTestRequired = $true
  provenanceBound = $true
  sourceIncluded = $true
  immutableCommitArchive = $true
  laterSourceChangeExcluded = $true
  dirtyStateRejected = $true
  concurrentHeadChangeRejected = $true
  skippedVerificationEvidenceRejected = $true
  qmkOverlayPackaged = $true
  npmScopeDeclared = $true
} | ConvertTo-Json -Compress
