$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
$inputPipe = [IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8)
$outputPipe = [IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
$outputPipe.AutoFlush = $true
$tracePipe = [IO.StreamWriter]::new([Console]::OpenStandardError(), $utf8)
$tracePipe.AutoFlush = $true
$tracePipe.WriteLine('lease-entered')
$rawRequest = $inputPipe.ReadLine()
$tracePipe.WriteLine('lease-input-read')
# Do not discover user/third-party modules or rebuild their analysis cache on a
# cold, restricted desktop launch. Only the installed built-in utility is needed.
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
$PSModuleAutoLoadingPreference = 'None'
Import-Module -Name ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$request = $rawRequest | ConvertFrom-Json
if ($request.trace) { $tracePipe.WriteLine('lease-request-read') } else { $tracePipe.Dispose(); $tracePipe = $null }
$path = [string]$request.path
if (-not [IO.Path]::IsPathRooted($path)) { throw 'An absolute private lock path is required.' }
$parent = [Diagnostics.Process]::GetProcessById([int]$request.parentPid)
$parentStart = $parent.StartTime
if ($null -ne $tracePipe) { $tracePipe.WriteLine('lease-owner-found') }
$deadline = [DateTime]::UtcNow.AddSeconds(10)
$held = $null
try {
    while ($null -eq $held) {
        if ($parent.HasExited -or $parent.StartTime -ne $parentStart) { throw 'Lock owner exited.' }
        try { $held = [IO.File]::Open($path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch [IO.IOException] {
            $nativeError = $_.Exception.HResult -band 0xffff
            if ($null -ne $tracePipe) { $tracePipe.WriteLine('lease-error-' + $nativeError) }
            if ($nativeError -notin @(32, 33)) { throw }
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Private state is busy.' }; Start-Sleep -Milliseconds 25
        }
    }
    $outputPipe.WriteLine('LOCKED')
    if ($null -ne $tracePipe) { $tracePipe.WriteLine('lease-held') }
    $inputPipe.ReadLine() | Out-Null
} finally { if ($null -ne $held) { $held.Dispose() }; $parent.Dispose(); $inputPipe.Dispose(); $outputPipe.Dispose(); if ($null -ne $tracePipe) { $tracePipe.Dispose() } }
