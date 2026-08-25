[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$BundleRoot,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedTrustDigest,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$ExpectedSourceCommit,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedPowerShellSha256,
  [string]$InstallRoot,
  [string]$StateRoot,
  [switch]$SkipVsCode,
  [switch]$SkipAutostart
)
$ErrorActionPreference='Stop'
$parameters=@{BundleRoot=$BundleRoot;ExpectedTrustDigest=$ExpectedTrustDigest;ExpectedSourceCommit=$ExpectedSourceCommit;InstallRoot=$InstallRoot;StateRoot=$StateRoot;SkipVsCode=$SkipVsCode;SkipAutostart=$SkipAutostart;OperationKindOverride='update'}
if(-not[string]::IsNullOrWhiteSpace($ExpectedPowerShellSha256)){$parameters.ExpectedPowerShellSha256=$ExpectedPowerShellSha256}
& (Join-Path $PSScriptRoot 'Bootstrap-B122Install.ps1') @parameters
