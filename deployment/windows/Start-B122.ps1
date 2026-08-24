[CmdletBinding()]
param([switch]$WaitForHealth)
$ErrorActionPreference = 'Stop'
$current = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$node = Join-Path $current 'runtime\node.exe'
$main = Join-Path $current 'app\dist\apps\windows-companion\src\main.js'
$health = Join-Path $current 'scripts\Test-B122Health.mjs'
$state = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard'
$logs = Join-Path $state 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
foreach ($file in @($node,$main,$health)) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Installed SXSY-B122 file is missing: $file" } }
$stdout = Join-Path $logs 'companion.stdout.log'
$stderr = Join-Path $logs 'companion.stderr.log'
$process = Start-Process -FilePath $node -ArgumentList @($main) -WorkingDirectory $current -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
if ($WaitForHealth) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    if ($process.HasExited) { throw "The installed companion exited before health verification. See $stderr" }
    & $node $health *> $null
    if ($LASTEXITCODE -eq 0) { return }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'The installed companion did not become healthy within 30 seconds.'
}
