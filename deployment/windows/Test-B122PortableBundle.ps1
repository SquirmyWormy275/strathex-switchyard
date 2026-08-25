[CmdletBinding()]
param([string]$BundleRoot)

$ErrorActionPreference = 'Stop'
$root = if ($BundleRoot) { [IO.Path]::GetFullPath($BundleRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
$node = Join-Path $root 'runtime\node.exe'
$main = Join-Path $root 'app\dist\apps\windows-companion\src\main.js'
$health = Join-Path $root 'scripts\Test-B122Health.mjs'
$sandboxHelper = Join-Path $root 'app\dist\apps\windows-companion\sandbox-helper\b122-sandbox-worker.exe'
$repositoryRuntimeHelper = Join-Path $root 'app\dist\apps\windows-companion\repository-runtime\b122-repository-runner.exe'
$rawHidHelper = Join-Path $root 'app\dist\apps\windows-companion\raw-hid\strathex-b122-hid-helper.exe'
$providerDesktopHelper = Join-Path $root 'app\dist\apps\windows-companion\provider-desktop\sxsy-b122-provider-desktop-helper.exe'
$voiceHelper = Join-Path $root 'app\dist\apps\windows-companion\voice\sxsy-b122-voice-helper.exe'
foreach ($file in @($node, $main, $health, $sandboxHelper, $repositoryRuntimeHelper, $rawHidHelper, $providerDesktopHelper, $voiceHelper)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Portable SXSY-B122 file is missing: $file" }
  if ($file.Contains('"')) { throw 'Portable bundle paths containing quotation marks are unsupported.' }
}
$repositoryRuntimeSelfTestRaw = & $repositoryRuntimeHelper --self-test
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repositoryRuntimeSelfTestRaw)) { throw 'The portable repository runtime helper failed its Job-Object self-test.' }
$repositoryRuntimeSelfTest = $repositoryRuntimeSelfTestRaw | ConvertFrom-Json
if ($repositoryRuntimeSelfTest.schema -cne 'sxsy-b122.repository-runner-self-test' -or $repositoryRuntimeSelfTest.childTreeTerminated -ne $true -or $repositoryRuntimeSelfTest.noSurvivors -ne $true) { throw 'The portable repository runtime helper returned an invalid containment receipt.' }
$providerDesktopSelfTestRaw = & $providerDesktopHelper --self-test
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($providerDesktopSelfTestRaw)) { throw 'The portable provider-desktop helper failed its self-test.' }
$providerDesktopSelfTest = $providerDesktopSelfTestRaw | ConvertFrom-Json
if ($providerDesktopSelfTest.schema -cne 'sxsy-b122.provider-desktop-self-test' -or $providerDesktopSelfTest.version -ne 1 -or $providerDesktopSelfTest.status -cne 'ok') { throw 'The portable provider-desktop helper returned an invalid self-test receipt.' }
$voiceSelfTestRaw = & $voiceHelper --self-test
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($voiceSelfTestRaw)) { throw 'The portable voice helper failed its self-test.' }
$voiceSelfTest = $voiceSelfTestRaw | ConvertFrom-Json
if ($voiceSelfTest.schema -cne 'sxsy-b122.voice-helper-self-test' -or $voiceSelfTest.version -ne 1 -or $voiceSelfTest.status -cne 'ok' -or $voiceSelfTest.hardwareAccessed -ne $false -or $voiceSelfTest.networkAccessed -ne $false) { throw 'The portable voice helper returned an invalid hardware-independent self-test receipt.' }

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
      $unexpectedRawHid = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Where-Object { $_.Name -ceq 'strathex-b122-hid-helper.exe' })
      if ($unexpectedRawHid.Count -ne 0) { throw 'The unprovisioned portable companion launched the Raw-HID helper.' }
      $unexpectedRepositoryRuntime = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Where-Object { $_.Name -ceq 'b122-repository-runner.exe' })
      if ($unexpectedRepositoryRuntime.Count -ne 0) { throw 'The unprovisioned portable companion launched the repository runtime helper.' }
      $unexpectedProviderDesktop = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Where-Object { $_.Name -ceq 'sxsy-b122-provider-desktop-helper.exe' })
      if ($unexpectedProviderDesktop.Count -ne 0) { throw 'The unprovisioned portable companion launched the provider-desktop helper.' }
      $unexpectedVoice = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Where-Object { $_.Name -ceq 'sxsy-b122-voice-helper.exe' })
      if ($unexpectedVoice.Count -ne 0) { throw 'The unconsented portable companion launched the voice helper.' }
      [ordered]@{ schema='sxsy-b122.portable-smoke'; version=1; status='ready'; node=(& $node -p 'process.version'); sandboxHelperPresent=$true; repositoryRuntimeHelperPresent=$true; repositoryRuntimeContainmentSelfTest=$true; rawHidHelperPresent=$true; providerDesktopHelperPresent=$true; providerDesktopSelfTest=$true; voiceHelperPresent=$true; voiceHelperSelfTest=$true; microphoneAccessed=$false; providerNetworkAccessed=$false } | ConvertTo-Json -Compress
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
