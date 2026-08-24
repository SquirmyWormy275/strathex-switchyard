[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BundleRoot,[string]$InstallRoot,[switch]$SkipVsCode,[switch]$SkipAutostart)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'Install-B122.ps1') -BundleRoot $BundleRoot -InstallRoot $InstallRoot -SkipVsCode:$SkipVsCode -SkipAutostart:$SkipAutostart
