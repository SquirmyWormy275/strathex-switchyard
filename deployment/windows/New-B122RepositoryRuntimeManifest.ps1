[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RepositoryRoot,
    [Parameter(Mandatory)][string]$PlanPath,
    [Parameter(Mandatory)][string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'B122ManifestTools.psm1') -Force

$root = Get-B122CanonicalDirectory -Path $RepositoryRoot -Label 'Repository root'
$output = Get-B122OwnedOutputPath -RepositoryRoot $root -OutputPath $OutputPath
$plan = Read-B122Plan -RepositoryRoot $root -PlanPath $PlanPath -ExpectedSchema 'sxsy-b122.repository-runtime-plan'
$generated = ConvertTo-B122RuntimeDocument -RepositoryRoot $root -Plan $plan
Write-B122GeneratedDocument -RepositoryRoot $root -OutputPath $output -Kind 'repository-runtime' -Generated $generated
