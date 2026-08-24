[CmdletBinding()]
param([string]$BundleRoot,[string]$InstallRoot,[switch]$SkipVsCode,[switch]$SkipAutostart)
$ErrorActionPreference='Stop'
$bundle = if ($BundleRoot) { [IO.Path]::GetFullPath($BundleRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
$root = if ($InstallRoot) { [IO.Path]::GetFullPath($InstallRoot) } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard\install' }
$validator = Join-Path $bundle 'scripts\Test-B122ReleaseArtifact.ps1'
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'The B122 release validator is missing.' }
$receipt = & $validator -BundleRoot $bundle | ConvertFrom-Json
if ($receipt.schema -cne 'sxsy-b122.release-validation' -or $receipt.status -cne 'passed') { throw 'The B122 release bundle did not pass exact integrity validation.' }
Import-Module (Join-Path $bundle 'scripts\B122InstallTools.psm1') -Force
$versionRoot = Import-B122ValidatedBundle -BundleRoot $bundle -InstallRoot $root
Copy-Item -LiteralPath (Join-Path $bundle 'scripts\B122InstallTools.psm1') -Destination (Join-Path $root 'B122InstallTools.psm1') -Force
Copy-Item -LiteralPath (Join-Path $bundle 'scripts\Invoke-B122Current.ps1') -Destination (Join-Path $root 'Invoke-B122Current.ps1') -Force
$release = Get-Content -LiteralPath (Join-Path $versionRoot 'release.json') -Raw | ConvertFrom-Json
$prior = Get-B122InstallState -InstallRoot $root
Stop-B122InstalledCompanion -InstallRoot $root
try {
  Set-B122CurrentVersion -InstallRoot $root -VersionId ([string]$release.sourceCommit) | Out-Null
  if (-not $SkipVsCode) {
    $code = (Get-Command code.cmd -ErrorAction Stop).Source
    & $code --install-extension (Join-Path $versionRoot 'extension\sxsy-b122-switchyard.vsix') --force
    if ($LASTEXITCODE -ne 0) { throw 'VS Code refused the reviewed B122 extension package.' }
  }
  & (Join-Path $root 'Invoke-B122Current.ps1') -InstallRoot $root -WaitForHealth
} catch {
  if ($null -ne $prior) { Write-B122InstallStateAtomic -InstallRoot $root -Current ([string]$prior.current) -Previous ([string]$prior.previous) | Out-Null; & (Join-Path $root 'Invoke-B122Current.ps1') -InstallRoot $root }
  throw
}
if (-not $SkipAutostart) {
  if ($root.Contains('"')) { throw 'B122 install paths containing quotation marks are unsupported.' }
  $powershell = Join-Path $PSHOME 'powershell.exe'; $launcher = Join-Path $root 'Invoke-B122Current.ps1'
  $command = "`"$powershell`" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -InstallRoot `"$root`""
  New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Force | Out-Null
  Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'STRATHEX-SXSY-B122' -Value $command
}
[ordered]@{ schema='sxsy-b122.install-result'; version=1; status='installed'; sourceCommit=[string]$release.sourceCommit; installRoot=$root; previous=if($null -eq $prior){$null}else{[string]$prior.current} } | ConvertTo-Json -Compress
