[CmdletBinding()]
param([string]$BundleRoot)

$ErrorActionPreference = 'Stop'
$root = if ($BundleRoot) { [IO.Path]::GetFullPath($BundleRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
$node = Join-Path $root 'runtime\node.exe'
$main = Join-Path $root 'app\dist\apps\windows-companion\src\main.js'
$health = Join-Path $root 'scripts\Test-B122Health.mjs'
foreach ($file in @($node, $main, $health)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Portable SXSY-B122 file is missing: $file" }
  if ($file.Contains('"')) { throw 'Portable bundle paths containing quotation marks are unsupported.' }
}

$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$testRoot = [IO.Path]::GetFullPath((Join-Path $temporaryBase ("sxsy-b122-portable-smoke-" + [guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing an unsafe portable-smoke root.' }
$localAppData = Join-Path $testRoot 'localappdata'
$state = Join-Path $localAppData 'STRATHEX\switchyard'
$stdout = Join-Path $testRoot 'companion.stdout.log'
$stderr = Join-Path $testRoot 'companion.stderr.log'
$healthStdout = Join-Path $testRoot 'health.stdout.log'
$healthStderr = Join-Path $testRoot 'health.stderr.log'
$process = $null
try {
  New-Item -ItemType Directory -Force -Path $state | Out-Null
  $arguments = @("`"$main`"", '--isolated-test-state-directory', "`"$state`"")
  $process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    if ($process.HasExited) {
      $detail = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
      throw "The portable companion exited before health verification: $detail"
    }
    $configuration = Join-Path $state 'authenticated-pipe.json'
    $healthProcess = Start-Process -FilePath $node -ArgumentList @("`"$health`"", '--configuration', "`"$configuration`"") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $healthStdout -RedirectStandardError $healthStderr -Wait -PassThru
    if ($healthProcess.ExitCode -eq 0) {
      [ordered]@{ schema='sxsy-b122.portable-smoke'; version=1; status='ready'; node=(& $node -p 'process.version'); helperPresent=(Test-Path -LiteralPath (Join-Path $root 'app\dist\apps\windows-companion\sandbox-helper\b122-sandbox-worker.exe') -PathType Leaf) } | ConvertTo-Json -Compress
      return
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  $companionDetail = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
  $healthDetail = if (Test-Path -LiteralPath $healthStderr) { Get-Content -LiteralPath $healthStderr -Raw } else { '' }
  throw "The portable companion did not become healthy within 30 seconds. Companion: $companionDetail Health: $healthDetail"
} finally {
  if ($null -ne $process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit(5000) | Out-Null
  }
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
