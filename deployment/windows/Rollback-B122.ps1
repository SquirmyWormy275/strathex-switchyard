[CmdletBinding()]
param([string]$InstallRoot,[string]$StateRoot,[switch]$SkipVsCode,[switch]$SkipAutostart)
$ErrorActionPreference='Stop'
$root=if($InstallRoot){[IO.Path]::GetFullPath($InstallRoot)}else{Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard\install'}
$module=Join-Path $PSScriptRoot 'B122InstallTools.psm1';Import-Module $module -Force
$lifecycleLock=Enter-B122LifecycleLock -InstallRoot $root
try{
Get-B122InstallOwnership -InstallRoot $root|Out-Null
$state=if($StateRoot){[IO.Path]::GetFullPath($StateRoot)}else{Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard'}
Assert-B122InstallStateRootBinding -InstallRoot $root -StateRoot $state|Out-Null
$before=Get-B122InstallState -InstallRoot $root
if($null -eq $before -or [string]::IsNullOrWhiteSpace([string]$before.previous)){throw 'No previous B122 version is available for rollback.'}
$target=Join-Path (Join-Path $root 'versions') ([string]$before.previous)
Assert-B122InstalledPayloadFile -InstallRoot $root -Path (Join-Path $target 'release.json')|Out-Null
$trustedInstaller=Join-Path (Get-B122CurrentBundle -InstallRoot $root) 'scripts\Install-B122.ps1'
Assert-B122InstalledPayloadFile -InstallRoot $root -Path $trustedInstaller|Out-Null
Assert-B122InstalledPayloadFile -InstallRoot $root -Path (Join-Path $target 'scripts\Test-B122ReleaseArtifact.ps1')|Out-Null
& $trustedInstaller -BundleRoot $target -InstallRoot $root -StateRoot $state -SkipVsCode:$SkipVsCode -SkipAutostart:$SkipAutostart -OperationKindOverride rollback
}finally{Exit-B122LifecycleLock -Lock $lifecycleLock}
