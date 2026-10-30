$ErrorActionPreference = 'Stop'
$request = [Console]::ReadLine() | ConvertFrom-Json
$path = [string]$request.path
if (-not [IO.Path]::IsPathRooted($path)) { throw 'An absolute private lock path is required.' }
$parent = [Diagnostics.Process]::GetProcessById([int]$request.parentPid)
$parentStart = $parent.StartTime
$deadline = [DateTime]::UtcNow.AddSeconds(10)
$held = $null
try {
    while ($null -eq $held) {
        if ($parent.HasExited -or $parent.StartTime -ne $parentStart) { throw 'Lock owner exited.' }
        try { $held = [IO.File]::Open($path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch [IO.IOException] { if ([DateTime]::UtcNow -ge $deadline) { throw 'Private state is busy.' }; Start-Sleep -Milliseconds 25 }
    }
    [Console]::Out.WriteLine('LOCKED')
    [Console]::Out.Flush()
    [Console]::ReadLine() | Out-Null
} finally { if ($null -ne $held) { $held.Dispose() }; $parent.Dispose() }
