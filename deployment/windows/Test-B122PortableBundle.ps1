[CmdletBinding()]
param([string]$BundleRoot)

$ErrorActionPreference = 'Stop'
$root = if ($BundleRoot) { [IO.Path]::GetFullPath($BundleRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
$node = Join-Path $root 'runtime\node.exe'
$main = Join-Path $root 'app\dist\apps\windows-companion\src\main.js'
$providerHostMain = Join-Path $root 'provider-adapter-host\dist\apps\provider-adapter-host\src\main.js'
$health = Join-Path $root 'scripts\Test-B122Health.mjs'
$sandboxHelper = Join-Path $root 'app\dist\apps\windows-companion\sandbox-helper\b122-sandbox-worker.exe'
$sandboxLifecycleHelper = Join-Path $root 'app\dist\apps\windows-companion\sandbox-helper\b122-sandbox-lifecycle.exe'
$repositoryRuntimeHelper = Join-Path $root 'app\dist\apps\windows-companion\repository-runtime\b122-repository-runner.exe'
$companionLifecycleHelper = Join-Path $root 'app\dist\apps\windows-companion\companion-lifecycle\b122-companion-supervisor.exe'
$rawHidHelper = Join-Path $root 'app\dist\apps\windows-companion\raw-hid\strathex-b122-hid-helper.exe'
$rawHidSimulator = Join-Path $root 'app\dist\apps\windows-companion\src\raw-hid-simulator.js'
$councilParticipant = Join-Path $root 'app\dist\apps\windows-companion\src\council-participant-main.js'
$containmentRemoteEvaluator = Join-Path $root 'app\dist\apps\windows-companion\src\containment-remote-evaluator-main.js'
$providerDesktopHelper = Join-Path $root 'app\dist\apps\windows-companion\provider-desktop\sxsy-b122-provider-desktop-helper.exe'
$voiceHelper = Join-Path $root 'app\dist\apps\windows-companion\voice\sxsy-b122-voice-helper.exe'
foreach ($file in @($node, $main, $providerHostMain, $health, $sandboxHelper, $sandboxLifecycleHelper, $repositoryRuntimeHelper, $companionLifecycleHelper, $rawHidHelper, $rawHidSimulator, $councilParticipant, $containmentRemoteEvaluator, $providerDesktopHelper, $voiceHelper)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Portable SXSY-B122 file is missing: $file" }
  if ($file.Contains('"')) { throw 'Portable bundle paths containing quotation marks are unsupported.' }
}
if (-not ('B122PortableBoundedCapture' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public sealed class B122PortableBoundedCapture
{
    private readonly int limit;
    private readonly StringBuilder value = new StringBuilder();
    private long totalCharacters;

    public B122PortableBoundedCapture(int limit)
    {
        if (limit < 1 || limit > 1048576) throw new ArgumentOutOfRangeException("limit");
        this.limit = limit;
    }

    public Task Begin(StreamReader reader)
    {
        if (reader == null) throw new ArgumentNullException("reader");
        return Task.Factory.StartNew(() =>
        {
            var buffer = new char[4096];
            int read;
            while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
            {
                lock (value)
                {
                    totalCharacters += read;
                    var remaining = limit - value.Length;
                    if (remaining > 0) value.Append(buffer, 0, Math.Min(remaining, read));
                }
            }
        }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
    }

    public string Value { get { lock (value) return value.ToString(); } }
    public long TotalCharacters { get { lock (value) return totalCharacters; } }
}
'@
}

function ConvertTo-B122PortableArgumentLine([string[]]$ArgumentValues) {
  return (@($ArgumentValues | ForEach-Object {
    $value = [string]$_
    if ($value.IndexOf([char]0) -ge 0 -or $value.Contains('"') -or $value -match '[\r\n]') { throw 'A portable verifier argument is invalid.' }
    if ($value -match '\s') { '"' + $value + '"' } else { $value }
  }) -join ' ')
}

function Get-B122PortableProcessTree([int]$RootProcessId) {
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $queue = New-Object Collections.Generic.Queue[int]
  $selected = New-Object Collections.Generic.List[object]
  $seen = @{}
  $queue.Enqueue($RootProcessId)
  while ($queue.Count) {
    $id = $queue.Dequeue()
    if ($seen.ContainsKey($id)) { continue }
    $seen[$id] = $true
    $item = @($all | Where-Object { [int]$_.ProcessId -eq $id })[0]
    if ($null -ne $item) {
      $created = if ($item.CreationDate -is [DateTime]) { [DateTime]$item.CreationDate } else { [Management.ManagementDateTimeConverter]::ToDateTime([string]$item.CreationDate) }
      $selected.Add([pscustomobject]@{ processId=[int]$item.ProcessId; createdAt=$created.ToUniversalTime().ToString('o') })
    }
    foreach ($child in @($all | Where-Object { [int]$_.ParentProcessId -eq $id })) { $queue.Enqueue([int]$child.ProcessId) }
  }
  return @($selected | ForEach-Object { $_ })
}

function Test-B122PortableProcessIdentityAlive($Identity) {
  $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Identity.processId)" -ErrorAction SilentlyContinue
  if ($null -eq $candidate) { return $false }
  try {
    $created = if ($candidate.CreationDate -is [DateTime]) { [DateTime]$candidate.CreationDate } else { [Management.ManagementDateTimeConverter]::ToDateTime([string]$candidate.CreationDate) }
    return $created.ToUniversalTime().ToString('o') -ceq [string]$Identity.createdAt
  } catch { return $true }
}

function Add-B122PortableProcessTree([hashtable]$Inventory, [int]$RootProcessId) {
  foreach ($identity in @(Get-B122PortableProcessTree -RootProcessId $RootProcessId)) {
    $Inventory[([string]$identity.processId + '|' + [string]$identity.createdAt)] = $identity
  }
}

function Invoke-B122PortableExactTreeKill($Identity) {
  if (-not (Test-B122PortableProcessIdentityAlive $Identity)) { return }
  $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
  $kill = New-Object Diagnostics.ProcessStartInfo
  $kill.FileName = $taskkill
  $kill.Arguments = "/PID $([int]$Identity.processId) /T /F"
  $kill.UseShellExecute = $false
  $kill.CreateNoWindow = $true
  $killer = New-Object Diagnostics.Process
  $killer.StartInfo = $kill
  try {
    if ($killer.Start() -and -not $killer.WaitForExit(10000)) { try { $killer.Kill() } catch {} }
  } finally { $killer.Dispose() }
}

function Stop-B122PortableProcessTree([int]$RootProcessId, [hashtable]$Inventory) {
  Add-B122PortableProcessTree -Inventory $Inventory -RootProcessId $RootProcessId
  $rootIdentity = @($Inventory.Values | Where-Object { [int]$_.processId -eq $RootProcessId } | Select-Object -First 1)
  if ($rootIdentity.Count) { Invoke-B122PortableExactTreeKill $rootIdentity[0] }
  foreach ($identity in @($Inventory.Values | Sort-Object processId -Descending)) {
    Invoke-B122PortableExactTreeKill $identity
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $survivors = @($Inventory.Values | Where-Object { Test-B122PortableProcessIdentityAlive $_ })
    if (-not $survivors.Count) { return }
    foreach ($identity in $survivors) { Invoke-B122PortableExactTreeKill $identity }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  $detail = @($survivors | ForEach-Object {
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$_.processId)" -ErrorAction SilentlyContinue
    "pid=$([int]$_.processId),created=$([string]$_.createdAt),name=$(if($null-eq$candidate){'exited'}else{[string]$candidate.Name})"
  }) -join ';'
  if ($detail.Length -gt 1024) { $detail = $detail.Substring(0,1024) }
  throw "Portable verifier cleanup left $($survivors.Count) exact process-tree survivor(s): $detail"
}

function Invoke-B122PortableBoundedProcess([string]$Executable, [string[]]$ArgumentValues, [int]$TimeoutSeconds, [string]$Label) {
  if ($TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 120) { throw 'A portable verifier timeout is outside the bounded range.' }
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $Executable
  $start.Arguments = ConvertTo-B122PortableArgumentLine $ArgumentValues
  $start.WorkingDirectory = $root
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $child = New-Object Diagnostics.Process
  $child.StartInfo = $start
  if (-not $child.Start()) { throw "$Label could not start." }
  $stdoutCapture = New-Object B122PortableBoundedCapture(32768)
  $stderrCapture = New-Object B122PortableBoundedCapture(32768)
  $stdoutTask = $stdoutCapture.Begin($child.StandardOutput)
  $stderrTask = $stderrCapture.Begin($child.StandardError)
  $inventory = @{}
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $timedOut = $false
  try {
    do {
      Add-B122PortableProcessTree -Inventory $inventory -RootProcessId $child.Id
      if ($child.WaitForExit(50)) { break }
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $child.HasExited) {
      $timedOut = $true
      Stop-B122PortableProcessTree -RootProcessId $child.Id -Inventory $inventory
    }
    if (-not $child.WaitForExit(10000)) { throw "$Label did not exit after bounded process-tree cleanup." }
    Add-B122PortableProcessTree -Inventory $inventory -RootProcessId $child.Id
    $survivors = @($inventory.Values | Where-Object { Test-B122PortableProcessIdentityAlive $_ })
    if ($survivors.Count) {
      Stop-B122PortableProcessTree -RootProcessId $child.Id -Inventory $inventory
      if (-not $timedOut) { throw "$Label left an unexpected process-tree survivor." }
    }
    if (-not [Threading.Tasks.Task]::WaitAll(@($stdoutTask,$stderrTask),10000)) { throw "$Label output drains did not close within the bounded cleanup interval." }
    return [pscustomobject]@{
      exitCode = if ($timedOut) { $null } else { $child.ExitCode }
      timedOut = $timedOut
      stdout = $stdoutCapture.Value
      stderr = $stderrCapture.Value
      outputCharacters = [long]$stdoutCapture.TotalCharacters + [long]$stderrCapture.TotalCharacters
      outputTruncated = $stdoutCapture.TotalCharacters -gt 32768 -or $stderrCapture.TotalCharacters -gt 32768
      capturedProcessTree = $inventory.Count
      processTreeSurvivors = 0
    }
  } finally {
    if (-not $child.HasExited) { Stop-B122PortableProcessTree -RootProcessId $child.Id -Inventory $inventory }
    $child.Dispose()
  }
}

function Assert-B122PortableCommandSucceeded($Result, [string]$Label) {
  if ($Result.timedOut) { throw "$Label timed out and its exact process tree was terminated." }
  if ($Result.exitCode -ne 0) { throw "$Label failed: $($Result.stderr)" }
  if ($Result.outputTruncated) { throw "$Label exceeded the bounded output allowance." }
  if ([string]::IsNullOrWhiteSpace([string]$Result.stdout)) { throw "$Label returned no receipt." }
}

$sandboxLifecycleCommand = Invoke-B122PortableBoundedProcess -Executable $sandboxLifecycleHelper -ArgumentValues @('--self-test') -TimeoutSeconds 30 -Label 'The portable Sandbox lifecycle helper self-test'
Assert-B122PortableCommandSucceeded $sandboxLifecycleCommand 'The portable Sandbox lifecycle helper self-test'
$sandboxLifecycleSelfTestRaw = $sandboxLifecycleCommand.stdout
$sandboxLifecycleSelfTest = $sandboxLifecycleSelfTestRaw | ConvertFrom-Json
if ($sandboxLifecycleSelfTest.schema -cne 'sxsy-b122.sandbox-lifecycle-self-test' -or $sandboxLifecycleSelfTest.version -ne 1 -or $sandboxLifecycleSelfTest.status -cne 'ok' -or $sandboxLifecycleSelfTest.hardwareAccessed -ne $false) { throw 'The portable Sandbox lifecycle helper returned an invalid self-test receipt.' }
$rawHidSimulationCommand = Invoke-B122PortableBoundedProcess -Executable $node -ArgumentValues @($rawHidSimulator,'--self-test') -TimeoutSeconds 30 -Label 'The portable Raw-HID simulator self-test'
Assert-B122PortableCommandSucceeded $rawHidSimulationCommand 'The portable Raw-HID simulator self-test'
$rawHidSimulationRaw = $rawHidSimulationCommand.stdout
$rawHidSimulation = $rawHidSimulationRaw | ConvertFrom-Json
if (
  $rawHidSimulation.schema -cne 'sxsy-b122.raw-hid-simulation' -or $rawHidSimulation.version -ne 1 -or $rawHidSimulation.status -cne 'passed' -or
  $rawHidSimulation.chordsExercised -ne 176 -or $rawHidSimulation.assignedChords -ne 65 -or $rawHidSimulation.unassignedChords -ne 111 -or
  $rawHidSimulation.duplicateAcknowledgedWithoutRedispatch -ne $true -or $rawHidSimulation.staleEpochRejected -ne $true -or
  $rawHidSimulation.corruptFrameRejected -ne $true -or $rawHidSimulation.hardwareAccessed -ne $false -or $rawHidSimulation.networkAccessed -ne $false
) { throw 'The portable Raw-HID simulator returned incomplete or unsafe coverage.' }
$repositoryRuntimeCommand = Invoke-B122PortableBoundedProcess -Executable $repositoryRuntimeHelper -ArgumentValues @('--self-test') -TimeoutSeconds 30 -Label 'The portable repository runtime helper self-test'
Assert-B122PortableCommandSucceeded $repositoryRuntimeCommand 'The portable repository runtime helper self-test'
$repositoryRuntimeSelfTestRaw = $repositoryRuntimeCommand.stdout
$repositoryRuntimeSelfTest = $repositoryRuntimeSelfTestRaw | ConvertFrom-Json
if ($repositoryRuntimeSelfTest.schema -cne 'sxsy-b122.repository-runner-self-test' -or $repositoryRuntimeSelfTest.childTreeTerminated -ne $true -or $repositoryRuntimeSelfTest.noSurvivors -ne $true) { throw 'The portable repository runtime helper returned an invalid containment receipt.' }
$companionLifecycleCommand = Invoke-B122PortableBoundedProcess -Executable $companionLifecycleHelper -ArgumentValues @('--self-test') -TimeoutSeconds 30 -Label 'The portable companion lifecycle helper self-test'
Assert-B122PortableCommandSucceeded $companionLifecycleCommand 'The portable companion lifecycle helper self-test'
$companionLifecycleSelfTestRaw = $companionLifecycleCommand.stdout
$companionLifecycleSelfTest = $companionLifecycleSelfTestRaw | ConvertFrom-Json
if (
  $companionLifecycleSelfTest.schema -cne 'sxsy-b122.companion-supervisor-self-test' -or $companionLifecycleSelfTest.version -ne 1 -or
  $companionLifecycleSelfTest.status -cne 'passed' -or [int]$companionLifecycleSelfTest.capturedProcesses -ne 2 -or
  [int]$companionLifecycleSelfTest.activeProcesses -ne 0 -or $companionLifecycleCommand.processTreeSurvivors -ne 0
) { throw 'The portable companion lifecycle helper returned an invalid no-survivor self-test receipt.' }
$providerDesktopCommand = Invoke-B122PortableBoundedProcess -Executable $providerDesktopHelper -ArgumentValues @('--self-test') -TimeoutSeconds 30 -Label 'The portable provider-desktop helper self-test'
Assert-B122PortableCommandSucceeded $providerDesktopCommand 'The portable provider-desktop helper self-test'
$providerDesktopSelfTestRaw = $providerDesktopCommand.stdout
$providerDesktopSelfTest = $providerDesktopSelfTestRaw | ConvertFrom-Json
if ($providerDesktopSelfTest.schema -cne 'sxsy-b122.provider-desktop-self-test' -or $providerDesktopSelfTest.version -ne 1 -or $providerDesktopSelfTest.status -cne 'ok') { throw 'The portable provider-desktop helper returned an invalid self-test receipt.' }
$voiceCommand = Invoke-B122PortableBoundedProcess -Executable $voiceHelper -ArgumentValues @('--self-test') -TimeoutSeconds 30 -Label 'The portable voice helper self-test'
Assert-B122PortableCommandSucceeded $voiceCommand 'The portable voice helper self-test'
$voiceSelfTestRaw = $voiceCommand.stdout
$voiceSelfTest = $voiceSelfTestRaw | ConvertFrom-Json
if ($voiceSelfTest.schema -cne 'sxsy-b122.voice-helper-self-test' -or $voiceSelfTest.version -ne 1 -or $voiceSelfTest.status -cne 'ok' -or $voiceSelfTest.hardwareAccessed -ne $false -or $voiceSelfTest.networkAccessed -ne $false) { throw 'The portable voice helper returned an invalid hardware-independent self-test receipt.' }
$providerHostCommand = Invoke-B122PortableBoundedProcess -Executable $node -ArgumentValues @($providerHostMain,'--self-test') -TimeoutSeconds 30 -Label 'The portable provider-adapter host self-test'
Assert-B122PortableCommandSucceeded $providerHostCommand 'The portable provider-adapter host self-test'
$providerHostSelfTestRaw = $providerHostCommand.stdout
$providerHostSelfTest = $providerHostSelfTestRaw | ConvertFrom-Json
if ($providerHostSelfTest.schema -cne 'sxsy-b122.provider-host-self-test' -or $providerHostSelfTest.version -ne 1 -or $providerHostSelfTest.status -cne 'ok' -or $providerHostSelfTest.authenticatedState -ne $true -or $providerHostSelfTest.fixtureBackend -ne $true -or $providerHostSelfTest.proprietaryCredentialAccessed -ne $false -or $providerHostSelfTest.networkAccessed -ne $false) { throw 'The portable provider-adapter host returned an invalid credential-free self-test receipt.' }
$containmentRemoteEvaluatorCommand = Invoke-B122PortableBoundedProcess -Executable $node -ArgumentValues @($containmentRemoteEvaluator,'--help') -TimeoutSeconds 10 -Label 'The portable signed containment remote evaluator help probe'
Assert-B122PortableCommandSucceeded $containmentRemoteEvaluatorCommand 'The portable signed containment remote evaluator help probe'
if ($containmentRemoteEvaluatorCommand.stdout -cnotmatch '^Usage: sxsy-b122-containment-remote-evaluator --challenge <absolute-json> --private-key <absolute-pem> --output <absolute-json> --git-executable <absolute-pinned-git>\s*$') { throw 'The portable signed containment remote evaluator returned an invalid help contract.' }

$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$testRoot = [IO.Path]::GetFullPath((Join-Path $temporaryBase ("sxsy-b122-portable-smoke-" + [guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing an unsafe portable-smoke root.' }
$localAppData = Join-Path $testRoot 'localappdata'
$state = Join-Path $localAppData 'STRATHEX\switchyard'
$stdout = Join-Path $testRoot 'companion.stdout.log'
$stderr = Join-Path $testRoot 'companion.stderr.log'
$process = $null

function Read-B122PortableBoundedFile([string]$Path, [int]$MaximumCharacters = 32768) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
  $reader = New-Object IO.StreamReader($Path)
  try {
    $buffer = New-Object char[] $MaximumCharacters
    $read = $reader.Read($buffer,0,$MaximumCharacters)
    return New-Object string($buffer,0,$read)
  } finally { $reader.Dispose() }
}

function Assert-B122PortableCompanionLogsBounded {
  foreach ($path in @($stdout,$stderr)) {
    if ((Test-Path -LiteralPath $path -PathType Leaf) -and (Get-Item -LiteralPath $path).Length -gt 65536) {
      throw 'The portable companion exceeded its bounded smoke-test output allowance.'
    }
  }
}

$companionInventory = @{}
try {
  New-Item -ItemType Directory -Force -Path $state | Out-Null
  $processControlFixture = Join-Path $testRoot 'bounded-process-tree.cjs'
  [IO.File]::WriteAllText($processControlFixture, @'
const { spawn } = require('node:child_process');
spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
process.stdout.write('x'.repeat(131072));
setInterval(() => {}, 1000);
'@, (New-Object Text.UTF8Encoding($false)))
  $processControlReceipt = Invoke-B122PortableBoundedProcess -Executable $node -ArgumentValues @($processControlFixture) -TimeoutSeconds 1 -Label 'The portable bounded process-control self-test'
  if (-not $processControlReceipt.timedOut -or -not $processControlReceipt.outputTruncated -or $processControlReceipt.processTreeSurvivors -ne 0 -or $processControlReceipt.capturedProcessTree -lt 2) {
    throw 'The portable verifier did not prove bounded output and exact process-tree timeout cleanup.'
  }
  $arguments = @("`"$main`"", '--isolated-test-state-directory', "`"$state`"")
  $process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  # Cold startup loads the complete secured runtime and can be materially
  # slower under Windows Defender on hosted runners. Keep the probe bounded,
  # but allow enough time for a valid release bundle to reach authenticated
  # readiness before exact process-tree cleanup.
  $startupTimeoutSeconds = 120
  $deadline = [DateTime]::UtcNow.AddSeconds($startupTimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 250
    Add-B122PortableProcessTree -Inventory $companionInventory -RootProcessId $process.Id
    Assert-B122PortableCompanionLogsBounded
    if ($process.HasExited) {
      $process.WaitForExit()
      $detail = Read-B122PortableBoundedFile $stderr
      throw "The portable companion exited before health verification: $detail"
    }
    $configuration = Join-Path $state 'authenticated-pipe.json'
    $healthCommand = Invoke-B122PortableBoundedProcess -Executable $node -ArgumentValues @($health,'--configuration',$configuration) -TimeoutSeconds 8 -Label 'The portable companion health probe'
    if ($healthCommand.timedOut) { throw 'The portable companion health probe timed out after exact process-tree cleanup.' }
    if ($healthCommand.exitCode -eq 0) {
      $unexpectedRawHid = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Where-Object { $_.Name -ceq 'strathex-b122-hid-helper.exe' })
      if ($unexpectedRawHid.Count -ne 0) { throw 'The unprovisioned portable companion launched the Raw-HID helper.' }
      $unexpectedRepositoryRuntime = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Where-Object { $_.Name -ceq 'b122-repository-runner.exe' })
      if ($unexpectedRepositoryRuntime.Count -ne 0) { throw 'The unprovisioned portable companion launched the repository runtime helper.' }
      $unexpectedProviderDesktop = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Where-Object { $_.Name -ceq 'sxsy-b122-provider-desktop-helper.exe' })
      if ($unexpectedProviderDesktop.Count -ne 0) { throw 'The unprovisioned portable companion launched the provider-desktop helper.' }
      $unexpectedVoice = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Where-Object { $_.Name -ceq 'sxsy-b122-voice-helper.exe' })
      if ($unexpectedVoice.Count -ne 0) { throw 'The unconsented portable companion launched the voice helper.' }
      $unexpectedCouncilParticipant = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Where-Object { $_.CommandLine -like '*council-participant-main.js*' })
      if ($unexpectedCouncilParticipant.Count -ne 0) { throw 'The unassigned portable companion launched a Council participant.' }
      Add-B122PortableProcessTree -Inventory $companionInventory -RootProcessId $process.Id
      $capturedTree = @($companionInventory.Values)
      if (-not $capturedTree.Count) { throw 'The portable companion process identity disappeared before graceful shutdown.' }
      $shutdownCommand = Invoke-B122PortableBoundedProcess -Executable $node -ArgumentValues @($health,'--shutdown','--configuration',$configuration) -TimeoutSeconds 10 -Label 'The portable companion authenticated shutdown probe'
      Assert-B122PortableCommandSucceeded $shutdownCommand 'The portable companion authenticated shutdown probe'
      $shutdownReceipt = $shutdownCommand.stdout | ConvertFrom-Json
      if ($shutdownReceipt.schema -cne 'sxsy-b122.install-shutdown' -or $shutdownReceipt.version -ne 1 -or $shutdownReceipt.status -cne 'stopping') { throw 'The portable companion returned an invalid authenticated shutdown receipt.' }
      $shutdownDeadline = [DateTime]::UtcNow.AddSeconds(30)
      do {
        $survivors = @($capturedTree | Where-Object { Test-B122PortableProcessIdentityAlive $_ })
        if (-not $survivors.Count) { break }
        Start-Sleep -Milliseconds 100
      } while ([DateTime]::UtcNow -lt $shutdownDeadline)
      if ($survivors.Count) {
        $survivorDetail = @($survivors | ForEach-Object {
          $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$_.processId)" -ErrorAction SilentlyContinue
          if ($null -eq $candidate) { "pid=$([int]$_.processId),name=exited" } else { "pid=$([int]$_.processId),name=$([string]$candidate.Name)" }
        }) -join ';'
        if ($survivorDetail.Length -gt 1024) { $survivorDetail = $survivorDetail.Substring(0,1024) }
        throw "The portable companion graceful shutdown left one or more captured process-tree survivors: $survivorDetail"
      }
      $nodeVersionCommand = Invoke-B122PortableBoundedProcess -Executable $node -ArgumentValues @('-p','process.version') -TimeoutSeconds 10 -Label 'The portable Node version probe'
      Assert-B122PortableCommandSucceeded $nodeVersionCommand 'The portable Node version probe'
      [ordered]@{ schema='sxsy-b122.portable-smoke'; version=1; status='ready'; node=$nodeVersionCommand.stdout.Trim(); sandboxHelperPresent=$true; sandboxLifecycleHelperPresent=$true; sandboxLifecycleSelfTest=$true; repositoryRuntimeHelperPresent=$true; repositoryRuntimeContainmentSelfTest=$true; companionLifecycleHelperPresent=$true; companionLifecycleSelfTest=$true; companionLifecycleCapturedProcesses=[int]$companionLifecycleSelfTest.capturedProcesses; companionLifecycleActiveProcesses=[int]$companionLifecycleSelfTest.activeProcesses; rawHidHelperPresent=$true; rawHidSimulatorPresent=$true; rawHidSimulationSelfTest=$true; rawHidChordsExercised=[int]$rawHidSimulation.chordsExercised; rawHidAssignedChords=[int]$rawHidSimulation.assignedChords; rawHidUnassignedChords=[int]$rawHidSimulation.unassignedChords; councilParticipantPresent=$true; councilParticipantAutoLaunched=$false; containmentRemoteEvaluatorPresent=$true; containmentRemoteEvaluatorHelp=$true; providerDesktopHelperPresent=$true; providerDesktopSelfTest=$true; providerHostPresent=$true; providerHostSelfTest=$true; voiceHelperPresent=$true; voiceHelperSelfTest=$true; microphoneAccessed=$false; providerNetworkAccessed=$false; proprietaryProviderCredentialAccessed=$false; physicalRawHidHardwareAccessed=$false; authenticatedGracefulShutdown=$true; boundedProcessControlSelfTest=$true; boundedProcessOutputCharacters=[long]$processControlReceipt.outputCharacters; capturedProcessTree=$capturedTree.Count; processTreeSurvivors=0 } | ConvertTo-Json -Compress
      return
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  Add-B122PortableProcessTree -Inventory $companionInventory -RootProcessId $process.Id
  $remaining = @($companionInventory.Values | Where-Object { Test-B122PortableProcessIdentityAlive $_ })
  if ($remaining.Count) { Stop-B122PortableProcessTree -RootProcessId $process.Id -Inventory $companionInventory }
  if (-not $process.HasExited -and -not $process.WaitForExit(10000)) { throw 'The unhealthy portable companion did not exit after exact process-tree cleanup.' }
  $process.WaitForExit()
  $companionDetail = Read-B122PortableBoundedFile $stderr
  $healthDetail = [string]$healthCommand.stderr
  throw "The portable companion did not become healthy within $startupTimeoutSeconds seconds. Companion: $companionDetail Health: $healthDetail"
} finally {
  if ($null -ne $process) {
    Add-B122PortableProcessTree -Inventory $companionInventory -RootProcessId $process.Id
    $remaining = @($companionInventory.Values | Where-Object { Test-B122PortableProcessIdentityAlive $_ })
    if ($remaining.Count) { Stop-B122PortableProcessTree -RootProcessId $process.Id -Inventory $companionInventory }
    if (-not $process.HasExited) { $process.WaitForExit(10000) | Out-Null }
    if ($process.HasExited) { $process.WaitForExit() }
    $process.Dispose()
  }
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
