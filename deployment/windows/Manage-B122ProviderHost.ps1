[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Start','Stop','Status','Health')][string]$Action,
  [string]$BundleRoot,
  [string]$InstallRoot,
  [string]$ConfigurationPath,
  [switch]$WaitForHealth
)
$ErrorActionPreference='Stop'
if($BundleRoot -and $InstallRoot){throw 'Use BundleRoot or InstallRoot, not both.'}
if($InstallRoot){
  $install=[IO.Path]::GetFullPath($InstallRoot);Import-Module (Join-Path $install 'B122InstallTools.psm1') -Force
  $bundle=Get-B122CurrentBundle -InstallRoot $install
}elseif($BundleRoot){$bundle=[IO.Path]::GetFullPath($BundleRoot)}else{$bundle=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))}
$local=if($env:SXSY_TEST_MODE-ceq'1'){$test=[IO.Path]::GetFullPath([string]$env:SXSY_TEST_ROOT);$candidate=[IO.Path]::GetFullPath([string]$env:LOCALAPPDATA);$prefix=$test.TrimEnd('\')+'\';if(-not$candidate.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Test LocalAppData must be a strict child of SXSY_TEST_ROOT.'};$candidate}else{[Environment]::GetFolderPath('LocalApplicationData')}
if([string]::IsNullOrWhiteSpace($local)){throw 'A current-user LocalApplicationData directory is required for provider-host lifecycle state.'}
$local=[IO.Path]::GetFullPath($local);$config=if($ConfigurationPath){[IO.Path]::GetFullPath($ConfigurationPath)}else{Join-Path $local 'STRATHEX\switchyard\provider-host\provider-host.json'}
$stateDirectory=Split-Path -Parent $config;$recordPath=Join-Path $stateDirectory 'provider-host-process.json'
$node=[IO.Path]::GetFullPath((Join-Path $bundle 'runtime\node.exe'));$main=[IO.Path]::GetFullPath((Join-Path $bundle 'provider-adapter-host\dist\apps\provider-adapter-host\src\main.js'))
$health=[IO.Path]::GetFullPath((Join-Path $bundle 'scripts\Test-B122ProviderHostHealth.mjs'));$validator=[IO.Path]::GetFullPath((Join-Path $bundle 'scripts\provisioning\Test-B122ProviderHostConfiguration.ps1'))
$utf8NoBom=New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class B122CommandLine {
  [DllImport("shell32.dll", SetLastError=true)] static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string commandLine, out int argc);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
  public static string[] Parse(string commandLine) {
    int argc; IntPtr argv=CommandLineToArgvW(commandLine,out argc); if(argv==IntPtr.Zero) throw new InvalidOperationException("Command line parsing failed.");
    try { var result=new string[argc]; for(int i=0;i<argc;i++) result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv,i*IntPtr.Size)); return result; }
    finally { LocalFree(argv); }
  }
}
'@

function Sha-Text([string]$Value){$bytes=[Text.Encoding]::UTF8.GetBytes($Value);$hasher=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{[Array]::Clear($bytes,0,$bytes.Length);$hasher.Dispose()}}
function Emit([string]$Status,[hashtable]$Additional=@{}){$value=[ordered]@{schema='sxsy-b122.provider-host-lifecycle';version=1;action=$Action.ToLowerInvariant();status=$Status;configured=(Test-Path -LiteralPath $config -PathType Leaf)};foreach($key in $Additional.Keys){$value[$key]=$Additional[$key]};$value|ConvertTo-Json -Depth 8 -Compress}
function Write-Record($Record){
  New-Item -ItemType Directory -Force -Path $stateDirectory|Out-Null
  $temporary=Join-Path $stateDirectory ('.provider-host-process-'+[guid]::NewGuid().ToString('N')+'.tmp')
  try{[IO.File]::WriteAllText($temporary,($Record|ConvertTo-Json -Depth 8),$utf8NoBom);Move-Item -LiteralPath $temporary -Destination $recordPath -Force}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
}
function Remove-Record {if(Test-Path -LiteralPath $recordPath -PathType Leaf){Remove-Item -LiteralPath $recordPath -Force}}
function Read-Record {
  if(-not(Test-Path -LiteralPath $recordPath -PathType Leaf)){return $null}
  $item=Get-Item -LiteralPath $recordPath -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or$item.Length-lt1-or$item.Length-gt65536){throw 'The provider-host lifecycle receipt is not one bounded regular file.'}
  $record=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
  $names=@($record.PSObject.Properties.Name);$required=@('schema','version','state','lifecycleNonce','lifecycleNonceSha256','processId','node','main','configurationPath','configurationSha256','sourceCommit','intentStartedAt','processStartedAt')
  if($record.schema-cne'sxsy-b122.provider-host-process'-or$record.version-ne2){throw 'The provider-host process receipt has an invalid schema.'}
  if(@($required|Where-Object{$_-notin$names}).Count-or@($names|Where-Object{$_-notin$required}).Count){throw 'The provider-host process receipt has invalid fields.'}
  if($record.state-cnotin@('starting','running','stopping')){throw 'The provider-host process receipt has an invalid state.'}
  if(([string]$record.lifecycleNonce)-cnotmatch'^[a-f0-9]{64}$'-or([string]$record.lifecycleNonceSha256)-cne(Sha-Text ([string]$record.lifecycleNonce))){throw 'The provider-host process receipt has an invalid lifecycle nonce.'}
  if(([string]$record.configurationSha256)-cnotmatch'^[a-f0-9]{64}$'){throw 'The provider-host process receipt has an invalid configuration digest.'}
  if(([string]$record.node)-cne$node-or([string]$record.main)-cne$main-or([string]$record.configurationPath)-cne$config){throw 'The provider-host process receipt belongs to another installed version.'}
  try{$record.intentStartedAt=([DateTimeOffset]$record.intentStartedAt).UtcDateTime.ToString('o')}catch{throw 'The provider-host process receipt has an invalid intent timestamp.'}
  if($null-ne$record.processId){$pid64=[long]$record.processId;if($pid64-lt1-or$pid64-gt[UInt32]::MaxValue){throw 'The provider-host process identity is invalid.'};$record.processId=[int]$pid64}
  if($null-ne$record.processStartedAt){try{$record.processStartedAt=([DateTimeOffset]$record.processStartedAt).UtcDateTime.ToString('o')}catch{throw 'The provider-host process start identity is invalid.'}}
  return $record
}
function Parsed-Arguments($Process){try{return [B122CommandLine]::Parse([string]$Process.CommandLine)}catch{return @()}}
function Process-Start($Process){try{return ([DateTime]$Process.CreationDate).ToUniversalTime().ToString('o')}catch{return $null}}
function Exact-Arguments($Process,[string]$Nonce){
  $arguments=@(Parsed-Arguments $Process);if($arguments.Count-ne6){return $false}
  try{$executable=[IO.Path]::GetFullPath([string]$arguments[0]);$entry=[IO.Path]::GetFullPath([string]$arguments[1]);$configured=[IO.Path]::GetFullPath([string]$arguments[3])}catch{return $false}
  return $executable.Equals($node,[StringComparison]::OrdinalIgnoreCase)-and$entry.Equals($main,[StringComparison]::OrdinalIgnoreCase)-and[string]$arguments[2]-ceq'--config'-and$configured.Equals($config,[StringComparison]::OrdinalIgnoreCase)-and[string]$arguments[4]-ceq'--lifecycle-nonce'-and[string]$arguments[5]-ceq$Nonce
}
function Exact-Process($Record){
  if($null-eq$Record-or$null-eq$Record.processId){return $null}
  $candidate=Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Record.processId)" -ErrorAction SilentlyContinue
  if($null-eq$candidate-or-not(Exact-Arguments $candidate ([string]$Record.lifecycleNonce))){return $null}
  if([string]$candidate.ExecutablePath){try{if(-not([IO.Path]::GetFullPath([string]$candidate.ExecutablePath).Equals($node,[StringComparison]::OrdinalIgnoreCase))){return $null}}catch{return $null}}
  if($null-ne$Record.processStartedAt-and(Process-Start $candidate)-cne[string]$Record.processStartedAt){return $null}
  return $candidate
}
function Find-ConfigurationProcesses([string]$Nonce=''){
  $foundProcesses=@()
  foreach($candidate in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)){
    $arguments=@(Parsed-Arguments $candidate);if($arguments.Count-ne6){continue}
    $candidateNonce=[string]$arguments[5];if($candidateNonce-cnotmatch'^[a-f0-9]{64}$'-or($Nonce-and$candidateNonce-cne$Nonce)){continue}
    if(Exact-Arguments $candidate $candidateNonce){$foundProcesses+=,[pscustomobject]@{Process=$candidate;Nonce=$candidateNonce}}
  }
  return @($foundProcesses)
}
function Stop-ExactProbe($Probe){
  try{if($Probe.HasExited){return}}catch{return}
  $taskkill=Join-Path $env:SystemRoot 'System32\taskkill.exe';$killInfo=New-Object Diagnostics.ProcessStartInfo;$killInfo.FileName=$taskkill;$killInfo.Arguments=('/PID {0} /T /F' -f [int]$Probe.Id);$killInfo.UseShellExecute=$false;$killInfo.CreateNoWindow=$true
  $killer=New-Object Diagnostics.Process;$killer.StartInfo=$killInfo
  try{if($killer.Start()-and-not$killer.WaitForExit(5000)){try{$killer.Kill()}catch{}}}catch{}finally{$killer.Dispose()}
  try{if(-not$Probe.WaitForExit(5000)){$Probe.Kill();$Probe.WaitForExit(5000)|Out-Null}}catch{}
}
function Invoke-HealthProcess([string[]]$ArgumentValues){
  foreach($value in $ArgumentValues){if($null-eq$value-or[string]$value -match '[\x00\r\n"]'){throw 'Provider-host health arguments contain an unsupported value.'}}
  $startInfo=New-Object Diagnostics.ProcessStartInfo;$startInfo.FileName=$node;$startInfo.Arguments=(@($ArgumentValues|ForEach-Object{'"'+[string]$_+'"'})-join ' ');$startInfo.UseShellExecute=$false;$startInfo.CreateNoWindow=$true;$startInfo.RedirectStandardOutput=$true;$startInfo.RedirectStandardError=$true
  $probe=New-Object Diagnostics.Process;$probe.StartInfo=$startInfo
  try{
    if(-not$probe.Start()){return $null}
    $stdoutTask=$probe.StandardOutput.ReadToEndAsync();$stderrTask=$probe.StandardError.ReadToEndAsync()
    if(-not$probe.WaitForExit(12000)){Stop-ExactProbe $probe;return $null}
    $probe.WaitForExit()
    try{$stdout=[string]$stdoutTask.GetAwaiter().GetResult();$stderr=[string]$stderrTask.GetAwaiter().GetResult()}catch{return $null}
    if($stdout.Length-gt131072-or$stderr.Length-gt131072){return $null}
    return [pscustomobject]@{exitCode=[int]$probe.ExitCode;stdout=$stdout}
  }finally{$probe.Dispose()}
}
function Invoke-Health($Record,[switch]$Shutdown){
  $arguments=@($health,'--configuration',$config,'--expect-lifecycle-nonce',[string]$Record.lifecycleNonce,'--expect-process-id',[string][int]$Record.processId);if($Shutdown){$arguments+='--shutdown'}
  $result=Invoke-HealthProcess $arguments;if($null-eq$result-or$result.exitCode-ne0-or[string]::IsNullOrWhiteSpace([string]$result.stdout)){return $null}
  try{$receipt=[string]$result.stdout|ConvertFrom-Json}catch{return $null}
  if($Shutdown){if($receipt.schema-cne'sxsy-b122.provider-host-shutdown-check'-or$receipt.status-cne'accepted'){return $null}}
  elseif($receipt.schema-cne'sxsy-b122.provider-host-health-check'-or$receipt.status-cne'passed'){return $null}
  if([int]$receipt.processId-ne[int]$Record.processId-or[string]$receipt.lifecycleNonceSha256-cne[string]$Record.lifecycleNonceSha256-or[string]$receipt.configurationSha256-cne[string]$Record.configurationSha256){return $null}
  return $receipt
}
function Wait-Healthy($Record,[int]$Seconds=30){$deadline=[DateTime]::UtcNow.AddSeconds($Seconds);do{if($null-eq(Exact-Process $Record)){return $null};$healthReceipt=Invoke-Health $Record;if($null-ne$healthReceipt){return $healthReceipt};Start-Sleep -Milliseconds 200}while([DateTime]::UtcNow-lt$deadline);return $null}
function Snapshot-Tree([int]$RootProcessId){
  $all=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue);$selected=New-Object Collections.Generic.List[object];$queue=New-Object Collections.Generic.Queue[int];$queue.Enqueue($RootProcessId);$seen=@{}
  while($queue.Count){$id=$queue.Dequeue();if($seen.ContainsKey($id)){continue};$seen[$id]=$true;$item=@($all|Where-Object{[int]$_.ProcessId-eq$id})[0];if($null-ne$item){$selected.Add([pscustomobject]@{processId=[int]$item.ProcessId;parentProcessId=[int]$item.ParentProcessId;startedAt=(Process-Start $item);executablePath=if([string]$item.ExecutablePath){[IO.Path]::GetFullPath([string]$item.ExecutablePath)}else{$null}})};foreach($child in @($all|Where-Object{[int]$_.ParentProcessId-eq$id})){$queue.Enqueue([int]$child.ProcessId)}}
  return @($selected|ForEach-Object{$_})
}
function Same-Identity($Identity){$candidate=Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Identity.processId)" -ErrorAction SilentlyContinue;if($null-eq$candidate){return $false};return(Process-Start $candidate)-ceq[string]$Identity.startedAt}
function Wait-TreeExit($Tree,[int]$Seconds){$deadline=[DateTime]::UtcNow.AddSeconds($Seconds);do{$survivors=@($Tree|Where-Object{Same-Identity $_});if(-not$survivors.Count){return @()};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow-lt$deadline);return @($Tree|Where-Object{Same-Identity $_})}
function Stop-HostedProcess($Record){
  $process=Exact-Process $Record;if($null-eq$process){Remove-Record;return [ordered]@{processId=if($null-ne$Record.processId){[int]$Record.processId}else{$null};gracefulShutdownAcknowledged=$false;forcedFallback=$false;treeCaptured=0;treeExited=0;treeSurvivors=@()}}
  $tree=@(Snapshot-Tree ([int]$process.ProcessId));$Record.state='stopping';Write-Record $Record
  $ack=$null;try{$ack=Invoke-Health $Record -Shutdown}catch{$ack=$null}
  $survivors=@(Wait-TreeExit $tree 10);$forced=$false
  if($survivors.Count){
    $forced=$true;$taskkill=Join-Path $env:SystemRoot 'System32\taskkill.exe'
    foreach($survivor in $survivors){if(Same-Identity $survivor){& $taskkill /PID ([string][int]$survivor.processId) /T /F *> $null}}
    $survivors=@(Wait-TreeExit $tree 10)
  }
  if($survivors.Count){throw 'The exact provider-host process tree did not terminate within its bounded deadline.'}
  Remove-Record
  return [ordered]@{processId=[int]$Record.processId;gracefulShutdownAcknowledged=($null-ne$ack);forcedFallback=$forced;treeCaptured=$tree.Count;treeExited=$tree.Count;treeSurvivors=@()}
}
function Adopt-Record($Record,$Process){$Record.processId=[int]$Process.ProcessId;$Record.processStartedAt=Process-Start $Process;Write-Record $Record;return $Record}
function Reconcile-Starting($Record){
  if($Record.state-cne'starting'){return $Record}
  $process=Exact-Process $Record
  if($null-eq$process){
    $found=@(Find-ConfigurationProcesses ([string]$Record.lifecycleNonce))
    if($found.Count-gt1){foreach($match in $found){$synthetic=Adopt-Record $Record $match.Process;Stop-HostedProcess $synthetic|Out-Null};throw 'Multiple processes claimed one provider-host lifecycle nonce and were stopped.'}
    if($found.Count-eq0){Remove-Record;return $null}
    $Record=Adopt-Record $Record $found[0].Process;$process=$found[0].Process
  }
  $healthy=Wait-Healthy $Record 15
  if($null-eq$healthy){Stop-HostedProcess $Record|Out-Null;return $null}
  $Record.state='running';Write-Record $Record;return $Record
}
function New-Nonce{$bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes);return([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()}finally{[Array]::Clear($bytes,0,$bytes.Length);$rng.Dispose()}}

New-Item -ItemType Directory -Force -Path $stateDirectory|Out-Null
$lockName='Local\SXSY-B122-ProviderHost-'+(Sha-Text $config).Substring(0,32);$mutex=New-Object Threading.Mutex($false,$lockName);$locked=$false
try{
  $locked=$mutex.WaitOne([TimeSpan]::FromSeconds(30));if(-not$locked){throw 'Another provider-host lifecycle operation owns the exact configuration.'}
  if($Action-ceq'Status'){
    if(-not(Test-Path -LiteralPath $config -PathType Leaf)){Emit 'disabled_unconfigured';return}
    $record=Read-Record;if($null-ne$record){$record=Reconcile-Starting $record}
    $process=Exact-Process $record;if($null-eq$process){if($null-ne$record){Remove-Record};Emit 'stopped';return}
    $healthy=Invoke-Health $record;if($null-eq$healthy){Emit 'unhealthy' @{processId=[int]$process.ProcessId;lifecycleNonceSha256=[string]$record.lifecycleNonceSha256};return}
    Emit 'running' @{processId=[int]$process.ProcessId;lifecycleNonceSha256=[string]$record.lifecycleNonceSha256;configurationSha256=[string]$record.configurationSha256;authenticated=$true;tlsIdentityPinned=$true};return
  }
  if($Action-ceq'Stop'){
    $record=Read-Record;if($null-ne$record){$record=Reconcile-Starting $record}
    $receipts=@();if($null-ne$record){$receipts+=,(Stop-HostedProcess $record)}
    elseif(-not(Test-Path -LiteralPath $recordPath)){foreach($match in @(Find-ConfigurationProcesses)){$validationSha=if(Test-Path -LiteralPath $config -PathType Leaf){$stream=[IO.File]::OpenRead($config);$hasher=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose();$stream.Dispose()}}else{'0'*64};$synthetic=[pscustomobject]@{schema='sxsy-b122.provider-host-process';version=2;state='running';lifecycleNonce=$match.Nonce;lifecycleNonceSha256=(Sha-Text $match.Nonce);processId=[int]$match.Process.ProcessId;node=$node;main=$main;configurationPath=$config;configurationSha256=$validationSha;sourceCommit=$null;intentStartedAt=(Process-Start $match.Process);processStartedAt=(Process-Start $match.Process)};$receipts+=,(Stop-HostedProcess $synthetic)}}
    Emit 'stopped' @{processes=$receipts;survivorCount=0};return
  }
  if(-not(Test-Path -LiteralPath $config -PathType Leaf)){Emit 'disabled_unconfigured';return}
  foreach($file in @($node,$main,$health,$validator)){if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw 'The provider-host lifecycle payload is incomplete.'}}
  $validation=& $validator -ConfigurationPath $config|ConvertFrom-Json
  if($validation.schema-cne'sxsy-b122.provider-host-configuration-validation'-or$validation.version-ne1-or$validation.status-cne'passed'-or$validation.startReady-ne$true-or$validation.cleartextCredentialRead-ne$false-or[string]$validation.configurationSha256-cnotmatch'^[a-f0-9]{64}$'){throw 'The configured provider host is not start-ready; no process was launched.'}
  if($Action-ceq'Health'){
    $record=Read-Record;if($null-ne$record){$record=Reconcile-Starting $record};if($null-eq(Exact-Process $record)){throw 'The configured provider host is not running.'}
    $receipt=Invoke-Health $record;if($null-eq$receipt){throw 'The configured provider-host authenticated pinned-TLS health check failed.'};$receipt|ConvertTo-Json -Compress;return
  }
  $existing=Read-Record;if($null-ne$existing){$existing=Reconcile-Starting $existing}
  $running=Exact-Process $existing
  if($null-ne$running){$healthReceipt=Invoke-Health $existing;if($null-ne$healthReceipt){Emit 'already_running' @{processId=[int]$running.ProcessId;lifecycleNonceSha256=[string]$existing.lifecycleNonceSha256;configurationSha256=[string]$existing.configurationSha256;authenticated=$true;tlsIdentityPinned=$true};return};Stop-HostedProcess $existing|Out-Null}
  foreach($orphan in @(Find-ConfigurationProcesses)){ $synthetic=[pscustomobject]@{schema='sxsy-b122.provider-host-process';version=2;state='running';lifecycleNonce=$orphan.Nonce;lifecycleNonceSha256=(Sha-Text $orphan.Nonce);processId=[int]$orphan.Process.ProcessId;node=$node;main=$main;configurationPath=$config;configurationSha256=[string]$validation.configurationSha256;sourceCommit=$null;intentStartedAt=(Process-Start $orphan.Process);processStartedAt=(Process-Start $orphan.Process)};Stop-HostedProcess $synthetic|Out-Null }
  if($node.Contains('"')-or$main.Contains('"')-or$config.Contains('"')){throw 'Provider-host lifecycle paths containing quotation marks are unsupported.'}
  $releasePath=Join-Path $bundle 'release.json';$sourceCommit=$null;if(Test-Path -LiteralPath $releasePath -PathType Leaf){$candidate=[string](Get-Content -LiteralPath $releasePath -Raw|ConvertFrom-Json).sourceCommit;if($candidate-cmatch'^[a-f0-9]{40}$'){$sourceCommit=$candidate}}
  $nonce=New-Nonce;$intentStartedAt=(Get-Date).ToUniversalTime().ToString('o')
  $record=[pscustomobject][ordered]@{schema='sxsy-b122.provider-host-process';version=2;state='starting';lifecycleNonce=$nonce;lifecycleNonceSha256=(Sha-Text $nonce);processId=$null;node=$node;main=$main;configurationPath=$config;configurationSha256=[string]$validation.configurationSha256;sourceCommit=$sourceCommit;intentStartedAt=$intentStartedAt;processStartedAt=$null}
  Write-Record $record
  try{
    # The provider host receives only its exact OS/runtime boundary. In
    # particular, never inherit ambient developer credentials, management
    # pipe handles, or a ShellExecute-substituted profile environment.
    $windowsRoot=[IO.Path]::GetFullPath([string]$env:SystemRoot)
    foreach($value in @($windowsRoot,$local)){if([string]::IsNullOrWhiteSpace($value)-or$value-match'[\x00\r\n]'){throw 'The provider-host process environment is invalid.'}}
    $environment=@("SystemRoot=$windowsRoot","WINDIR=$windowsRoot","LOCALAPPDATA=$local")
    if($env:SXSY_TEST_MODE-ceq'1'){
      $environment+=@('SXSY_TEST_MODE=1',"SXSY_TEST_ROOT=$test","SXSY_TEST_ROOT_SHA256=$(Sha-Text $test)","SXSY_TEST_LOCAL_SHA256=$(Sha-Text $local)")
      if($env:SXSY_PROVIDER_E2E_TRACE-ceq'1'){$environment+='SXSY_PROVIDER_E2E_TRACE=1'}
    }
    $startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0;EnvironmentVariables=[string[]]$environment}
    $commandLine=('"{0}" "{1}" --config "{2}" --lifecycle-nonce {3}' -f $node,$main,$config,$nonce)
    $created=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$commandLine;CurrentDirectory=$bundle;ProcessStartupInformation=$startup}
    if($null-eq$created){throw 'The provider-host process launch returned no exact identity.'}
    if([int]$created.ReturnValue-ne0-or[int]$created.ProcessId-lt1){throw "The provider-host process launch returned safe code $([int]$created.ReturnValue) without an exact identity."}
    $candidate=$null;$deadline=[DateTime]::UtcNow.AddSeconds(5);do{$candidate=Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$created.ProcessId)" -ErrorAction SilentlyContinue;if($null-ne$candidate){break};Start-Sleep -Milliseconds 50}while([DateTime]::UtcNow-lt$deadline)
    if($null-eq$candidate-or-not(Exact-Arguments $candidate $nonce)){throw 'The provider host did not establish its exact process identity.'}
    $record=Adopt-Record $record $candidate
    # A freshly extracted, signed bundle can be held briefly by host malware
    # scanning before Node reaches the TLS listener. Keep this bounded beneath
    # the 240-second release-test ceiling, but do not turn scanner contention
    # into a false startup failure.
    $healthReceipt=Wait-Healthy $record 120
    if($null-eq$healthReceipt){
      $stage='unreported';$stagePath=$config+'.startup-stage'
      if($env:SXSY_PROVIDER_E2E_TRACE-ceq'1'-and(Test-Path -LiteralPath $stagePath -PathType Leaf)){
        $stageItem=Get-Item -LiteralPath $stagePath -Force
        if(($stageItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-eq0-and$stageItem.Length-gt0-and$stageItem.Length-le128){$candidateStage=[string](Get-Content -LiteralPath $stagePath -Raw).Trim();if($candidateStage-cmatch'^(configuration|config-(read|paths|test-mode-absent|test-root-missing|test-local-missing|test-root-rewritten|test-local-rewritten|test-boundary-rewritten|test-path-invalid|test-local-equals-root|test-local-sibling|test-drive-diverged|test-boundary-valid|root-not-config-dir|file-and-root-outside-base|boundaries-diverged|allowed-base|owned-paths|providers|path-security|bearer-secret|journal-secret|dispatch-secret|tls-material)|backend-runtime|service-reconcile|tls-listen|running|failed-(backend-runtime|service-reconcile|tls-listen))$'){$stage=$candidateStage}}
      }
      throw "The provider host did not pass authenticated pinned-TLS health within 120 seconds (safe startup stage: $stage)."
    }
    $record.state='running';Write-Record $record
    Emit 'running' @{processId=[int]$record.processId;lifecycleNonceSha256=[string]$record.lifecycleNonceSha256;configurationSha256=[string]$record.configurationSha256;tlsIdentityPinned=$true;authenticated=$true;startingIntentReconciled=$true};return
  }catch{
    $current=Read-Record;if($null-ne$current){$current=Reconcile-Starting $current;if($null-ne$current){Stop-HostedProcess $current|Out-Null}};Remove-Record;throw
  }
}finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
