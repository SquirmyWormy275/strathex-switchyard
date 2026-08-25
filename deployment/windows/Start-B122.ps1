[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$InstallRoot,[string]$StateRoot,[switch]$WaitForHealth)
$ErrorActionPreference = 'Stop'
$current = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$node = Join-Path $current 'runtime\node.exe'
$main = Join-Path $current 'app\dist\apps\windows-companion\src\main.js'
$health = Join-Path $current 'scripts\Test-B122Health.mjs'
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$installTools = Join-Path $root 'B122InstallTools.psm1'
$validator = Join-Path $current 'scripts\Test-B122ReleaseArtifact.ps1'
$repositoryRuntimeHelper = Join-Path $current 'app\dist\apps\windows-companion\repository-runtime\b122-repository-runner.exe'
$companionLifecycleHelper = Join-Path $current 'app\dist\apps\windows-companion\companion-lifecycle\b122-companion-supervisor.exe'
$sandboxLifecycleHelper = Join-Path $current 'app\dist\apps\windows-companion\sandbox-helper\b122-sandbox-lifecycle.exe'
$rawHidSimulator = Join-Path $current 'app\dist\apps\windows-companion\src\raw-hid-simulator.js'
$councilParticipant = Join-Path $current 'app\dist\apps\windows-companion\src\council-participant-main.js'
$voiceHelper = Join-Path $current 'app\dist\apps\windows-companion\voice\sxsy-b122-voice-helper.exe'
$providerHostMain = Join-Path $current 'provider-adapter-host\dist\apps\provider-adapter-host\src\main.js'
$providerHostLifecycle = Join-Path $current 'scripts\Manage-B122ProviderHost.ps1'
$providerHostHealth = Join-Path $current 'scripts\Test-B122ProviderHostHealth.mjs'
$providerHostConfigurationValidator = Join-Path $current 'scripts\provisioning\Test-B122ProviderHostConfiguration.ps1'
$state = if($StateRoot){[IO.Path]::GetFullPath($StateRoot)}else{Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard'}
$providerConfiguration=Join-Path $state 'provider-host\provider-host.json'
if(-not(Test-Path -LiteralPath $installTools -PathType Leaf)){throw 'The digest-pinned B122 bootstrap module is missing.'}
Import-Module $installTools -Force
$lifecycleLock=Enter-B122LifecycleLock -InstallRoot $root
try{
Assert-B122RootTools -InstallRoot $root|Out-Null
foreach ($file in @($node,$main,$health,$validator,$repositoryRuntimeHelper,$companionLifecycleHelper,$sandboxLifecycleHelper,$rawHidSimulator,$councilParticipant,$voiceHelper,$providerHostMain,$providerHostLifecycle,$providerHostHealth,$providerHostConfigurationValidator)) { Assert-B122InstalledPayloadFile -InstallRoot $root -Path $file|Out-Null }
$validation = & $validator -BundleRoot $current
if ([string]::IsNullOrWhiteSpace($validation)) { throw 'The installed SXSY-B122 bundle failed integrity validation.' }
$validationRecord = $validation | ConvertFrom-Json
if ($validationRecord.schema -cne 'sxsy-b122.release-validation' -or $validationRecord.version -ne 1 -or $validationRecord.status -cne 'passed') { throw 'The installed SXSY-B122 bundle returned an invalid integrity receipt.' }
Get-B122StateOwnership -StateRoot $state|Out-Null
Assert-B122InstallStateRootBinding -InstallRoot $root -StateRoot $state|Out-Null
$logs = Join-Path $state 'logs'
function Assert-B122SafeLogDirectory([string]$Path){
  if(-not(Test-Path -LiteralPath $Path)){return}
  $item=Get-Item -LiteralPath $Path -Force
  if(-not$item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or-not[IO.Path]::GetFullPath($item.FullName).Equals([IO.Path]::GetFullPath($Path),[StringComparison]::OrdinalIgnoreCase)){throw 'The protected B122 log directory is not one concrete state-owned directory.'}
}
Assert-B122SafeLogDirectory $logs
New-Item -ItemType Directory -Path $logs -Force | Out-Null
Assert-B122SafeLogDirectory $logs
$configuration=Join-Path $state 'authenticated-pipe.json'
$installState=Get-B122InstallState -InstallRoot $root
if($null-eq$installState-or[string]$installState.currentBundleId-cnotmatch'^[a-f0-9]{64}$'){throw 'The protected install state has no exact current bundle identity.'}
$companionAlreadyRunning=$false
if(Test-Path -LiteralPath $configuration -PathType Leaf){
  $existingProbe=Invoke-B122CompanionHealthProbe -NodePath $node -HealthScript $health -ConfigurationPath $configuration
  if($existingProbe.status-ceq'ready'){
    if(Test-B122InstalledCompanionCurrent -InstallRoot $root -StateRoot $state){$companionAlreadyRunning=$true}
    else{Stop-B122InstalledCompanion -InstallRoot $root -StateRoot $state|Out-Null}
  }
}
$stdout = Join-Path $logs 'companion.stdout.log'
$stderr = Join-Path $logs 'companion.stderr.log'
function Assert-B122SafeLogLeaf([string]$Path){
  if(-not(Test-Path -LiteralPath $Path)){return}
  $item=Get-Item -LiteralPath $Path -Force
  if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or-not[IO.Path]::GetFullPath($item.FullName).Equals([IO.Path]::GetFullPath($Path),[StringComparison]::OrdinalIgnoreCase)){throw 'A protected B122 log path is not one concrete regular file.'}
}
Assert-B122SafeLogLeaf $stdout;Assert-B122SafeLogLeaf $stderr
if ($main.Contains('"') -or $state.Contains('"')) { throw 'Installed SXSY-B122 paths containing quotation marks are unsupported.' }
$defaultState=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard'
$arguments=@("`"$main`"");if(-not$state.Equals([IO.Path]::GetFullPath($defaultState),[StringComparison]::OrdinalIgnoreCase)){$arguments+=@('--isolated-test-state-directory',('"{0}"' -f $state))}
$process = $null
$supervisorReceipt=$null
$providerStartAttempted=$false
try {
if(-not$companionAlreadyRunning){
  # Reconcile any exact prior generation before replacing its fixed control
  # paths. Stop is authoritative even when the child lease was never written.
  Stop-B122InstalledCompanion -InstallRoot $root -StateRoot $state|Out-Null
  Assert-B122SafeLogDirectory $logs;Assert-B122SafeLogLeaf $stdout;Assert-B122SafeLogLeaf $stderr
  $supervisorRequestPath=Join-Path $state 'companion-supervisor.request.json';$supervisorStatePath=Join-Path $state 'companion-supervisor.state.json';$supervisorIntentPath=Join-Path $state 'companion-supervisor.starting.json';$supervisorTemp=Join-Path $state 'supervisor-temp'
  if(-not(Test-Path -LiteralPath $supervisorTemp)){New-Item -ItemType Directory -Path $supervisorTemp|Out-Null};Assert-B122SafeLogDirectory $supervisorTemp
  foreach($path in @($current,$node,$main,$companionLifecycleHelper,$state,$stdout,$stderr,$supervisorRequestPath,$supervisorStatePath,$supervisorTemp)){if($path.Contains('"')-or$path-match"[`0`r`n]"){throw 'A companion supervisor path is unsupported.'}}
  function New-B122RandomHex([int]$ByteCount){$bytes=New-Object byte[] $ByteCount;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes);return([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()}finally{$rng.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}}
  $supervisorId='companion:'+(New-B122RandomHex 32);$controlToken=New-B122RandomHex 32
  $windows=[IO.Path]::GetDirectoryName([Environment]::SystemDirectory);$local=[Environment]::GetFolderPath('LocalApplicationData');$roaming=[Environment]::GetFolderPath('ApplicationData')
  $request=[ordered]@{schema='sxsy-b122.companion-supervisor-request';version=1;supervisorId=$supervisorId;bundleRoot=$current;bundleId=[string]$installState.currentBundleId;helperPath=$companionLifecycleHelper;helperSha256=(Get-FileHash -LiteralPath $companionLifecycleHelper -Algorithm SHA256).Hash.ToLowerInvariant();nodePath=$node;nodeSha256=(Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant();mainPath=$main;mainSha256=(Get-FileHash -LiteralPath $main -Algorithm SHA256).Hash.ToLowerInvariant();arguments=@($main)+$(if($arguments.Count-eq3){@('--isolated-test-state-directory',$state)}else{@()});workingDirectory=$current;stateRoot=$state;stdoutPath=$stdout;stderrPath=$stderr;environment=[ordered]@{SystemRoot=$windows;WINDIR=$windows;TEMP=$supervisorTemp;TMP=$supervisorTemp;LOCALAPPDATA=$local;APPDATA=$roaming;SXSY_B122_COMPANION_SUPERVISOR_REQUEST=$supervisorRequestPath;SXSY_B122_COMPANION_SUPERVISOR_STATE=$supervisorStatePath};controlToken=$controlToken;statePath=$supervisorStatePath}
  Write-B122CompanionSupervisorRequest -StateRoot $state -Payload $request|Out-Null
  $starterOut=Join-Path $supervisorTemp ('starter-'+[guid]::NewGuid().ToString('N')+'.out');$starterErr=Join-Path $supervisorTemp ('starter-'+[guid]::NewGuid().ToString('N')+'.err')
  try{
    $starter=Start-Process -FilePath $companionLifecycleHelper -ArgumentList @('--start',('"{0}"'-f$supervisorRequestPath),('"{0}"'-f$supervisorStatePath),('"{0}"'-f$supervisorIntentPath)) -WorkingDirectory $current -WindowStyle Hidden -RedirectStandardOutput $starterOut -RedirectStandardError $starterErr -PassThru
    $deadline=[DateTime]::UtcNow.AddSeconds(10);do{$starter.Refresh();if($starter.HasExited){break};foreach($path in @($starterOut,$starterErr)){if((Test-Path -LiteralPath $path)-and(Get-Item -LiteralPath $path).Length-gt64KB){$starter.Kill();throw 'The companion supervisor starter exceeded its output bound.'}};Start-Sleep -Milliseconds 50}while([DateTime]::UtcNow-lt$deadline)
    $starter.Refresh();if(-not$starter.HasExited){$starter.Kill();$starter.WaitForExit(5000)|Out-Null;try{Stop-B122InstalledCompanion -InstallRoot $root -StateRoot $state|Out-Null}catch{};throw 'The companion supervisor starter exceeded its time bound.'}
    $starter.WaitForExit();$starterLines=@((Get-Content -LiteralPath $starterOut -ErrorAction SilentlyContinue)|Where-Object{-not[string]::IsNullOrWhiteSpace($_)});$starterDiagnostic=[string]$(if(Test-Path -LiteralPath $starterErr){Get-Content -LiteralPath $starterErr -Raw}else{''})
    if($starter.ExitCode-ne0-or$starterLines.Count-ne1){throw "The companion supervisor starter failed closed. $starterDiagnostic"};try{$supervisorReceipt=$starterLines[0]|ConvertFrom-Json}catch{throw 'The companion supervisor starter returned a malformed receipt.'}
    if((@($supervisorReceipt.PSObject.Properties.Name|Sort-Object)-join',')-cne'schema,status,supervisorCreationFileTimeUtc,supervisorId,supervisorPid,version'-or$supervisorReceipt.schema-cne'sxsy-b122.companion-supervisor-start'-or$supervisorReceipt.version-ne1-or$supervisorReceipt.status-cne'started'-or$supervisorReceipt.supervisorId-cne$supervisorId-or[int64]$supervisorReceipt.supervisorPid-lt1-or[string]$supervisorReceipt.supervisorCreationFileTimeUtc-cnotmatch'^[1-9][0-9]{10,19}$'){throw 'The companion supervisor starter returned an invalid exact receipt.'}
  }finally{foreach($path in @($starterOut,$starterErr)){if(Test-Path -LiteralPath $path -PathType Leaf){Remove-Item -LiteralPath $path -Force}}}
}
  if(-not$companionAlreadyRunning){
    $identityDeadline=[DateTime]::UtcNow.AddSeconds(20);$identityReady=$false;$identityFailure=$null
    do{
      try{$supervisorLive=[SxsyB122V2.NativeCommandLine]::GetCreationFileTimeUtc([int]$supervisorReceipt.supervisorPid)-ceq[string]$supervisorReceipt.supervisorCreationFileTimeUtc}catch{$supervisorLive=$false};if(-not$supervisorLive){throw "The installed companion supervisor exited before publishing an authenticated process identity. See $stderr"}
      if((Test-Path -LiteralPath (Join-Path $state 'companion-instance.json') -PathType Leaf)-and(Test-Path -LiteralPath (Join-Path $state 'companion-process-identity.json') -PathType Leaf)){
        try{$identityReady=Test-B122InstalledCompanionCurrent -InstallRoot $root -StateRoot $state;if($identityReady){break}}catch{$identityFailure=$_.Exception.Message}
      }
      Start-Sleep -Milliseconds 100
    }while([DateTime]::UtcNow-lt$identityDeadline)
    if(-not$identityReady){throw "The installed companion did not publish an authenticated current-bundle process identity within the bounded startup interval. $identityFailure"}
    $lease=Get-Content -LiteralPath (Join-Path $state 'companion-instance.json') -Raw|ConvertFrom-Json
    if($lease.version-ne2-or$lease.supervisorId-cne$supervisorId-or[int64]$lease.pid-lt1){throw 'The installed companion did not bind its exact supervisor generation.'}
    $process=Get-Process -Id ([int]$lease.pid) -ErrorAction Stop
  }
  if ($WaitForHealth -and -not$companionAlreadyRunning) {Wait-B122CompanionHealth -NodePath $node -HealthScript $health -ConfigurationPath $configuration -Process $process -TimeoutSeconds 30 -PollMilliseconds 250|Out-Null}
  $providerStartAttempted=$true
  $providerOutput=@(& $providerHostLifecycle -Action Start -BundleRoot $current -ConfigurationPath $providerConfiguration -WaitForHealth:$WaitForHealth)
  $providerLines=@($providerOutput|ForEach-Object{[string]$_}|Where-Object{-not[string]::IsNullOrWhiteSpace($_)})
  if($providerLines.Count-ne1){throw 'The provider-host lifecycle returned an invalid startup receipt count.'}
  try{$providerReceipt=$providerLines[0]|ConvertFrom-Json}catch{throw 'The provider-host lifecycle returned a malformed startup receipt.'}
  if($providerReceipt.schema-cne'sxsy-b122.provider-host-lifecycle'-or$providerReceipt.version-ne1-or$providerReceipt.action-cne'start'-or$providerReceipt.status-cnotin@('running','already_running','disabled_unconfigured')){throw 'The provider-host lifecycle returned an invalid startup receipt.'}
  $providerNames=@($providerReceipt.PSObject.Properties.Name|Sort-Object)
  if($providerReceipt.status-ceq'disabled_unconfigured'){
    if(($providerNames-join',')-cne'action,configured,schema,status,version'-or$providerReceipt.configured-ne$false){throw 'The disabled provider-host receipt made unexpected process or configuration claims.'}
  }else{
    $expected=if($providerReceipt.status-ceq'running'){'action,authenticated,configurationSha256,configured,lifecycleNonceSha256,processId,schema,startingIntentReconciled,status,tlsIdentityPinned,version'}else{'action,authenticated,configurationSha256,configured,lifecycleNonceSha256,processId,schema,status,tlsIdentityPinned,version'}
    if(($providerNames-join',')-cne$expected-or$providerReceipt.configured-ne$true-or$providerReceipt.authenticated-ne$true-or$providerReceipt.tlsIdentityPinned-ne$true-or[int64]$providerReceipt.processId-lt1-or[string]$providerReceipt.lifecycleNonceSha256-cnotmatch'^[a-f0-9]{64}$'-or[string]$providerReceipt.configurationSha256-cnotmatch'^[a-f0-9]{64}$'-or($providerReceipt.status-ceq'running'-and$providerReceipt.startingIntentReconciled-ne$true)){throw 'The provider-host startup receipt did not bind an exact authenticated pinned-TLS process and configuration identity.'}
  }
} catch {
  $startupFailure=$_
  $cleanupFailures=New-Object Collections.Generic.List[string]
  if($providerStartAttempted){
    try{Stop-B122InstalledProviderHost -InstallRoot $root -ConfigurationPath $providerConfiguration|Out-Null}catch{$cleanupFailures.Add("provider host: $($_.Exception.Message)")}
  }
  if(-not$companionAlreadyRunning){
    try{Stop-B122InstalledCompanion -InstallRoot $root -StateRoot $state|Out-Null}catch{$cleanupFailures.Add("companion: $($_.Exception.Message)")}
    if($null-ne$supervisorReceipt){try{$supervisorLive=[SxsyB122V2.NativeCommandLine]::GetCreationFileTimeUtc([int]$supervisorReceipt.supervisorPid)-ceq[string]$supervisorReceipt.supervisorCreationFileTimeUtc}catch{$supervisorLive=$false};if($supervisorLive){$cleanupFailures.Add('the exact companion supervisor and Job tree remain live')}}
  }
  if($cleanupFailures.Count){throw "Candidate startup cleanup could not prove no-survivor rollback. Original failure: $($startupFailure.Exception.Message). Cleanup failures: $($cleanupFailures -join '; ')"}
  throw $startupFailure
}
$status=if(-not$companionAlreadyRunning){'started'}elseif($providerReceipt.status-ceq'running'){'provider_started'}elseif($providerReceipt.status-ceq'already_running'){'already_running'}else{'already_running_provider_disabled'}
[ordered]@{schema='sxsy-b122.start-result';version=1;status=$status;sourceCommit=[string]$validationRecord.sourceCommit;pid=if($null-eq$process){$null}else{[int]$process.Id};healthVerified=([bool]$WaitForHealth-or$companionAlreadyRunning);companionStatus=if($companionAlreadyRunning){'already_running'}else{'started'};providerHostStatus=[string]$providerReceipt.status}|ConvertTo-Json -Compress
}finally{Exit-B122LifecycleLock -Lock $lifecycleLock}
