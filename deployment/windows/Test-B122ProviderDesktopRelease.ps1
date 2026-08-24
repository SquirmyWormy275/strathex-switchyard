$ErrorActionPreference = 'Stop'
$build = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Build-B122Release.ps1') -Raw
$portable = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Test-B122PortableBundle.ps1') -Raw
$artifact = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Test-B122ReleaseArtifact.ps1') -Raw

$requiredBuildTokens = @(
  'ProviderDesktopHelperPath',
  'ProviderDesktopHelperSha256',
  'provider-desktop-helper\Sxsy.B122.ProviderDesktopHelper.csproj',
  'sxsy-b122-provider-desktop-helper.exe',
  'providerDesktopHelperSha256'
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

[ordered]@{
  schema = 'sxsy-b122.provider-desktop-release-test'
  version = 1
  status = 'passed'
  helperPackaged = $true
  selfTestRequired = $true
  provenanceBound = $true
  sourceIncluded = $true
} | ConvertTo-Json -Compress
