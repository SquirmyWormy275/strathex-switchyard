$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
$inputPipe = [IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8)
$outputPipe = [IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
$outputPipe.AutoFlush = $true
$tracePipe = [IO.StreamWriter]::new([Console]::OpenStandardError(), $utf8)
$tracePipe.AutoFlush = $true
$tracePipe.WriteLine('lease-entered')
$requestCharacters = [Text.StringBuilder]::new()
while ($true) {
    $character = $inputPipe.Read()
    if ($character -lt 0) { throw 'The private lock request ended before its delimiter.' }
    if ($character -eq 10) { break }
    if ($character -gt 127 -or $character -eq 13 -or $requestCharacters.Length -ge 22000) { throw 'The private lock request is invalid or oversized.' }
    [void]$requestCharacters.Append([char]$character)
}
$tracePipe.WriteLine('lease-input-read')
# All operations use built-in language/.NET APIs. Acquiring a kernel lease must
# not import modules, discover user modules or rebuild an analysis cache.
$PSModuleAutoLoadingPreference = 'None'
$parts = $requestCharacters.ToString().Split([char]9)
$parentPidValue = 0
if ($parts.Length -ne 5 -or $parts[0] -cne 'SXSY-LOCK/1' -or $parts[1] -cnotmatch '^[1-9][0-9]{0,9}$' -or -not [int]::TryParse($parts[1], [ref]$parentPidValue) -or $parentPidValue -lt 1 -or $parts[2] -cnotmatch '^[01]$' -or $parts[3] -cnotmatch '^[01]$') { throw 'The private lock request is invalid.' }
$pathBytes = [Convert]::FromBase64String($parts[4])
if ($pathBytes.Length -lt 1 -or $pathBytes.Length -gt 16384 -or [Convert]::ToBase64String($pathBytes) -cne $parts[4]) { throw 'The private lock path encoding is invalid.' }
$path = [Text.UTF8Encoding]::new($false, $true).GetString($pathBytes)
if ($path.IndexOf([char]0) -ge 0 -or $path.IndexOf([char]10) -ge 0 -or $path.IndexOf([char]13) -ge 0) { throw 'The private lock path is invalid.' }
$nonBlocking = $parts[3] -ceq '1'
if ($parts[2] -ceq '1') { $tracePipe.WriteLine('lease-request-read') } else { $tracePipe.Dispose(); $tracePipe = $null }
if (-not [IO.Path]::IsPathRooted($path)) { throw 'An absolute private lock path is required.' }
$parent = [Diagnostics.Process]::GetProcessById($parentPidValue)
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
            if ($nonBlocking) { exit 75 }
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Private state is busy.' }; [Threading.Thread]::Sleep(25)
        }
    }
    $outputPipe.WriteLine('LOCKED')
    if ($null -ne $tracePipe) { $tracePipe.WriteLine('lease-held') }
    [void]$inputPipe.ReadLine()
} finally { if ($null -ne $held) { $held.Dispose() }; $parent.Dispose(); $inputPipe.Dispose(); $outputPipe.Dispose(); if ($null -ne $tracePipe) { $tracePipe.Dispose() } }
