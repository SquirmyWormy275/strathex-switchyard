[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
param([string]$InstallRoot,[switch]$KeepVsCodeExtension,[switch]$PurgeState)
$ErrorActionPreference='Stop'
$root = if ($InstallRoot) { [IO.Path]::GetFullPath($InstallRoot) } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard\install' }
if (-not $PSCmdlet.ShouldProcess($root,'Stop and remove the versioned SXSY-B122 installation')) { return }
if (Test-Path -LiteralPath (Join-Path $root 'B122InstallTools.psm1')) { Import-Module (Join-Path $root 'B122InstallTools.psm1') -Force; Stop-B122InstalledCompanion -InstallRoot $root }
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'STRATHEX-SXSY-B122' -ErrorAction SilentlyContinue
if (-not $KeepVsCodeExtension) { $code=Get-Command code.cmd -ErrorAction SilentlyContinue; if($code){ & $code.Source --uninstall-extension SquirmyWormy275.strathex-switchyard-b122 *> $null } }
if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
if ($PurgeState) {
  $state = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard'
  if ([IO.Path]::GetFullPath($root).StartsWith(([IO.Path]::GetFullPath($state).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $state)) { Remove-Item -LiteralPath $state -Recurse -Force }
}
[ordered]@{ schema='sxsy-b122.uninstall-result'; version=1; status='uninstalled'; statePreserved=(-not $PurgeState) } | ConvertTo-Json -Compress
