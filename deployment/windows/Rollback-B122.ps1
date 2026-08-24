[CmdletBinding()]
param([string]$InstallRoot,[switch]$SkipVsCode)
$ErrorActionPreference='Stop'
$root = if ($InstallRoot) { [IO.Path]::GetFullPath($InstallRoot) } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard\install' }
Import-Module (Join-Path $root 'B122InstallTools.psm1') -Force
$before = Get-B122InstallState -InstallRoot $root
Stop-B122InstalledCompanion -InstallRoot $root
$rolled = Restore-B122PreviousVersion -InstallRoot $root
$bundle = Get-B122CurrentBundle -InstallRoot $root
try {
  if (-not $SkipVsCode) { $code=(Get-Command code.cmd -ErrorAction Stop).Source; & $code --install-extension (Join-Path $bundle 'extension\sxsy-b122-switchyard.vsix') --force; if($LASTEXITCODE -ne 0){throw 'VS Code refused the rollback extension.'} }
  & (Join-Path $root 'Invoke-B122Current.ps1') -InstallRoot $root -WaitForHealth
} catch { Write-B122InstallStateAtomic -InstallRoot $root -Current ([string]$before.current) -Previous ([string]$before.previous) | Out-Null; & (Join-Path $root 'Invoke-B122Current.ps1') -InstallRoot $root; throw }
[ordered]@{ schema='sxsy-b122.install-result'; version=1; status='rolled_back'; sourceCommit=[string]$rolled.current; previous=[string]$rolled.previous } | ConvertTo-Json -Compress
