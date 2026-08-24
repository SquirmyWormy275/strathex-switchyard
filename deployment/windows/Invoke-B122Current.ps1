[CmdletBinding()]
param([string]$InstallRoot,[switch]$WaitForHealth)
$ErrorActionPreference='Stop'
$root = if ($InstallRoot) { [IO.Path]::GetFullPath($InstallRoot) } else { [IO.Path]::GetFullPath($PSScriptRoot) }
Import-Module (Join-Path $root 'B122InstallTools.psm1') -Force
$bundle = Get-B122CurrentBundle -InstallRoot $root
& (Join-Path $bundle 'scripts\Start-B122.ps1') -WaitForHealth:$WaitForHealth
