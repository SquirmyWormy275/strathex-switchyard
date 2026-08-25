[CmdletBinding()]
param(
  [string]$RepositoryRunnerPath,
  [ValidateSet('no-output','multiple','wrong-root','wrong-source','wrong-status','malformed','oversized')][string[]]$ReceiptModes=@('no-output','multiple','wrong-root','wrong-source','wrong-status','malformed','oversized')
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

if([Environment]::OSVersion.Platform-ne[PlatformID]::Win32NT){throw 'The B122 trusted-bootstrap test is Windows-only.'}

function Assert-True([bool]$Condition,[string]$Message){if(-not$Condition){throw $Message}}
function Write-Utf8NoBom([string]$Path,[string]$Text){[IO.File]::WriteAllText($Path,$Text,(New-Object Text.UTF8Encoding($false)))}
function Get-Sha256File([string]$Path){return (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Get-TrustDigest([string]$Root){
  $records=@('release.json','SHA256SUMS.json','sbom.spdx.json')|ForEach-Object{"$_`0$(Get-Sha256File (Join-Path $Root $_))"}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($records-join"`n"));$sha=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}
  finally{$sha.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
}
function Write-Manifest([string]$Bundle,[string[]]$RelativePaths){
  $manifest=@($RelativePaths|Sort-Object|ForEach-Object{$path=Join-Path $Bundle $_;[ordered]@{path=$_.Replace('\','/');sha256=Get-Sha256File $path;bytes=(Microsoft.PowerShell.Management\Get-Item -LiteralPath $path).Length}})
  Write-Utf8NoBom (Join-Path $Bundle 'SHA256SUMS.json') ($manifest|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 4)
}

$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('sxsy-b122-trusted-bootstrap-'+[guid]::NewGuid().ToString('N'))
$bundle=Join-Path $testRoot 'candidate bundle'
$scripts=Join-Path $bundle 'scripts'
$stagingBase=Join-Path $testRoot 'private staging'
$installRoot=Join-Path $testRoot 'install root'
$stateRoot=Join-Path $testRoot 'state root'
$bootstrap=Join-Path $PSScriptRoot 'Bootstrap-B122Install.ps1'
$sourceCommit='1234567890abcdef1234567890abcdef12345678'
$helperRelative='app/dist/apps/windows-companion/repository-runtime/b122-repository-runner.exe'
$repositoryRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if([string]::IsNullOrWhiteSpace($RepositoryRunnerPath)){$RepositoryRunnerPath=Join-Path $repositoryRoot 'apps\windows-companion\repository-runner-helper\bin\Release\net8.0\win-x64\b122-repository-runner.exe'}
$RepositoryRunnerPath=[IO.Path]::GetFullPath($RepositoryRunnerPath)
if(-not(Test-Path -LiteralPath $RepositoryRunnerPath -PathType Leaf)){throw 'Pass the exact built b122-repository-runner.exe to the trusted-bootstrap test.'}
$payload=@('scripts/Install-B122.ps1','scripts/B122InstallTools.psm1','scripts/B122ReleaseIntegrity.psm1','scripts/Test-B122ReleaseArtifact.ps1','scripts/receipt-mode.txt',$helperRelative)
try{
  [IO.Directory]::CreateDirectory($scripts)|Out-Null
  [IO.Directory]::CreateDirectory((Join-Path $bundle 'app\dist\apps\windows-companion\repository-runtime'))|Out-Null
  [IO.Directory]::CreateDirectory($stagingBase)|Out-Null
  [IO.Directory]::CreateDirectory($installRoot)|Out-Null
  [IO.Directory]::CreateDirectory($stateRoot)|Out-Null
  $installer=@'
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$BundleRoot,
  [string]$InstallRoot,
  [string]$StateRoot,
  [switch]$SkipVsCode,
  [switch]$SkipAutostart,
  [ValidateSet('install','update')][string]$OperationKindOverride,
  [Parameter(Mandatory=$true)][string]$TrustedBootstrapDigest,
  [Parameter(Mandatory=$true)][string]$TrustedBootstrapSourceCommit
)
$ErrorActionPreference='Stop'
if($null-ne('SxsyB122.NativeCommandLine'-as[type])){throw 'A stale parent-process native helper ABI leaked into the candidate installer.'}
$counterPath=Join-Path $StateRoot 'bootstrap-invocations.txt'
$count=if([IO.File]::Exists($counterPath)){[int]([IO.File]::ReadAllText($counterPath))}else{0}
[IO.File]::WriteAllText($counterPath,[string]($count+1))
$lockProtected=$false
try{[IO.File]::WriteAllText((Join-Path $BundleRoot 'scripts\B122InstallTools.psm1'),'replaced')}catch{$lockProtected=$true}
if(-not$lockProtected){throw 'The trusted bootstrap did not hold staged payload bytes immutable through installer completion.'}
$evidence=[ordered]@{pid=$PID;bundleRoot=$BundleRoot;skipVsCode=[bool]$SkipVsCode;skipAutostart=[bool]$SkipAutostart;operation=$OperationKindOverride;lockProtected=$lockProtected;path=$env:PATH;modulePath=$env:PSModulePath;ambientLeak=$env:B122_BOOTSTRAP_LEAK_SECRET}
[IO.File]::WriteAllText((Join-Path $StateRoot 'bootstrap-fixture-evidence.json'),($evidence|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
$result=[ordered]@{schema='sxsy-b122.install-result';version=3;status=if($OperationKindOverride-ceq'install'){'installed'}else{'updated'};operation=$OperationKindOverride;sourceCommit=$TrustedBootstrapSourceCommit;bundleId=('b'*64);trustDigest=$TrustedBootstrapDigest;installRoot=[IO.Path]::GetFullPath($InstallRoot);stateRoot=[IO.Path]::GetFullPath($StateRoot);previous=$null}
$mode=[IO.File]::ReadAllText((Join-Path $BundleRoot 'scripts\receipt-mode.txt')).Trim()
switch($mode){
  'valid' {$result|ConvertTo-Json -Compress}
  'no-output' {return}
  'multiple' {$result|ConvertTo-Json -Compress;$result|ConvertTo-Json -Compress}
  'wrong-root' {$result.installRoot=Join-Path $InstallRoot 'wrong';$result|ConvertTo-Json -Compress}
  'wrong-source' {$result.sourceCommit=('a'*40);$result|ConvertTo-Json -Compress}
  'wrong-status' {$result.status='rolled_back';$result|ConvertTo-Json -Compress}
  'malformed' {Write-Output '{'}
  'oversized' {Write-Output ('x'*70000)}
  default {throw 'Unknown trusted-bootstrap receipt fixture mode.'}
}
'@
  Write-Utf8NoBom (Join-Path $scripts 'Install-B122.ps1') $installer
  Write-Utf8NoBom (Join-Path $scripts 'B122InstallTools.psm1') "# candidate module fixture`n"
  Write-Utf8NoBom (Join-Path $scripts 'B122ReleaseIntegrity.psm1') "# candidate validator module fixture`n"
  Write-Utf8NoBom (Join-Path $scripts 'Test-B122ReleaseArtifact.ps1') "# candidate validator fixture`n"
  Write-Utf8NoBom (Join-Path $scripts 'receipt-mode.txt') 'valid'
  [IO.File]::Copy($RepositoryRunnerPath,(Join-Path $bundle $helperRelative.Replace('/','\')),$false)
  Write-Utf8NoBom (Join-Path $bundle 'release.json') ([ordered]@{schema='sxsy-b122.windows-release';version=1;sourceCommit=$sourceCommit;verificationSkipped=$false;evidenceEligible=$true;payloadCount=$payload.Count}|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress)
  Write-Utf8NoBom (Join-Path $bundle 'sbom.spdx.json') ([ordered]@{spdxVersion='SPDX-2.3';name='bootstrap-fixture'}|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress)
  Write-Manifest $bundle $payload
  $trustDigest=Get-TrustDigest $bundle

  if($null-eq('SxsyB122.NativeCommandLine'-as[type])){Add-Type -TypeDefinition 'namespace SxsyB122 { public static class NativeCommandLine { public static int Version { get { return 1; } } } }'}
  $currentHost=(Microsoft.PowerShell.Management\Get-Process -Id $PID).Path
  function Invoke-Fixture([string]$Digest,[string]$Commit=$sourceCommit,[string]$CleanupMutation='none'){
    $parameters=@{BundleRoot=$bundle;ExpectedTrustDigest=$Digest;ExpectedSourceCommit=$Commit;InstallRoot=$installRoot;StateRoot=$stateRoot;SkipVsCode=$true;SkipAutostart=$true;OperationKindOverride='update';TestStagingRoot=$stagingBase;AllowTestStagingRoot=$true}
    if($CleanupMutation-cne'none'){$parameters.TestCleanupMutation=$CleanupMutation}
    if([IO.Path]::GetFileName($currentHost)-ieq'pwsh.exe'){$parameters.ExpectedPowerShellSha256=Get-Sha256File $currentHost}
    return @(& $bootstrap @parameters)
  }
  $savedPath=$env:PATH;$savedModulePath=$env:PSModulePath;$savedLeak=$env:B122_BOOTSTRAP_LEAK_SECRET
  try{$env:PATH=(Join-Path $testRoot 'attacker-path');$env:PSModulePath=(Join-Path $testRoot 'attacker-modules');$env:B122_BOOTSTRAP_LEAK_SECRET='must-not-cross';$raw=Invoke-Fixture $trustDigest}
  finally{$env:PATH=$savedPath;$env:PSModulePath=$savedModulePath;$env:B122_BOOTSTRAP_LEAK_SECRET=$savedLeak}
  $result=(($raw-join"`n")|Microsoft.PowerShell.Utility\ConvertFrom-Json)
  $evidence=([IO.File]::ReadAllText((Join-Path $stateRoot 'bootstrap-fixture-evidence.json'))|Microsoft.PowerShell.Utility\ConvertFrom-Json)
  Assert-True ($result.schema-ceq'sxsy-b122.install-result'-and$result.version-eq3-and$result.status-ceq'updated') 'The trusted bootstrap did not return one exact v3 installer result.'
  Assert-True ([int]$evidence.pid-ne$PID) 'The trusted bootstrap did not isolate the new installer in a fresh PowerShell process.'
  Assert-True ([string]$result.sourceCommit-ceq$sourceCommit) 'The trusted bootstrap changed the expected source commit.'
  Assert-True ([string]$result.trustDigest-ceq$trustDigest) 'The trusted bootstrap changed the release trust digest.'
  Assert-True ([string]$evidence.bundleRoot-ne$bundle) 'The trusted bootstrap executed directly from the untrusted candidate path.'
  Assert-True (([string]$evidence.bundleRoot).StartsWith(([IO.Path]::GetFullPath($stagingBase).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)) 'The candidate was not executed from private staging.'
  Assert-True ([bool]$evidence.skipVsCode-and[bool]$evidence.skipAutostart-and[string]$evidence.operation-ceq'update'-and[bool]$evidence.lockProtected) 'The fixed bootstrap invocation or immutable staging contract failed.'
  Assert-True ([string]::IsNullOrWhiteSpace([string]$evidence.ambientLeak)-and-not([string]$evidence.path).Contains('attacker-path')-and-not([string]$evidence.modulePath).Contains('attacker-modules')) 'The trusted child inherited hostile ambient environment state.'
  Assert-True (([IO.File]::ReadAllText((Join-Path $stateRoot 'bootstrap-invocations.txt')))-ceq'1') 'The candidate fixture did not execute exactly once.'
  $retainedCandidates=@(Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $stagingBase -Directory -Force|Where-Object{$_.Name-like'c-*'})
  $retainedListing=@($retainedCandidates|ForEach-Object{Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $_.FullName -Recurse -Force|Select-Object -ExpandProperty FullName})
  Assert-True ($retainedCandidates.Count-eq0) "The trusted bootstrap left its verified staging bundle behind: $($retainedListing-join', ')"
  $receipts=@(Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath (Join-Path $stagingBase 'receipts') -File -Filter '*.json');Assert-True ($receipts.Count-eq3) 'The trusted bootstrap did not persist its exact started/outcome/cleanup reconciliation receipts.'
  foreach($receiptFile in $receipts){
    $rawReceipt=[IO.File]::ReadAllText($receiptFile.FullName);$receipt=($rawReceipt|Microsoft.PowerShell.Utility\ConvertFrom-Json)
    $suffix=',"receiptSha256":"'+[string]$receipt.receiptSha256+'"}';Assert-True ($rawReceipt.EndsWith($suffix,[StringComparison]::Ordinal)) 'An external bootstrap receipt does not use its exact canonical envelope.'
    $bodyText=$rawReceipt.Substring(0,$rawReceipt.Length-$suffix.Length)+'}';$bytes=[Text.Encoding]::UTF8.GetBytes($bodyText);$sha=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
    Assert-True ([string]$receipt.receiptSha256-ceq$digest) 'An external bootstrap reconciliation receipt is not self-consistent.'
  }

  # A trusted-but-defective installer cannot confuse the parent with absent,
  # multiple, malformed, oversized, or wrong-identity success output.
  foreach($mode in $ReceiptModes){
    Write-Utf8NoBom (Join-Path $scripts 'receipt-mode.txt') $mode;Write-Manifest $bundle $payload;$modeDigest=Get-TrustDigest $bundle;$rejectedReceipt=$false;$receiptError=$null
    try{Invoke-Fixture $modeDigest|Out-Null}catch{$receiptError=$_.Exception.Message;$rejectedReceipt=$receiptError-match'receipt|malformed JSON|different local roots|another release|output bound'}
    Assert-True $rejectedReceipt "The trusted bootstrap accepted the $mode installer receipt fixture or failed for an unrelated reason: $receiptError"
  }
  Write-Utf8NoBom (Join-Path $scripts 'receipt-mode.txt') 'valid';Write-Manifest $bundle $payload

  # A malicious candidate may rewrite both a module and its self-consistent
  # payload manifest. The independently supplied trust digest must still stop
  # that candidate before any installer process is launched.
  Write-Utf8NoBom (Join-Path $scripts 'B122InstallTools.psm1') "# attacker-controlled replacement verifier`n"
  Write-Manifest $bundle $payload
  $rejected=$false
  try{Invoke-Fixture $trustDigest|Out-Null}catch{$rejected=$_.Exception.Message-match'trust digest'}
  Assert-True $rejected 'A self-consistent attacker replacement passed the independent release trust anchor.'
  Assert-True (([IO.File]::ReadAllText((Join-Path $stateRoot 'bootstrap-invocations.txt')))-ceq[string](1+$ReceiptModes.Count)) 'A digest-rejected candidate reached its installer.'

  $wrongCommit=$false
  $currentDigest=Get-TrustDigest $bundle
  try{Invoke-Fixture $currentDigest ('a'*40)|Out-Null}catch{$wrongCommit=$_.Exception.Message-match'source commit'}
  Assert-True $wrongCommit 'The independent source-commit binding did not fail closed.'

  $testOverrideRejected=$false
  $withoutAllow=@{BundleRoot=$bundle;ExpectedTrustDigest=$currentDigest;ExpectedSourceCommit=$sourceCommit;InstallRoot=$installRoot;StateRoot=$stateRoot;SkipVsCode=$true;SkipAutostart=$true;OperationKindOverride='update';TestStagingRoot=$stagingBase};if([IO.Path]::GetFileName($currentHost)-ieq'pwsh.exe'){$withoutAllow.ExpectedPowerShellSha256=Get-Sha256File $currentHost}
  try{& $bootstrap @withoutAllow|Out-Null}catch{$testOverrideRejected=$_.Exception.Message-match'AllowTestStagingRoot'}
  Assert-True $testOverrideRejected 'A test staging root was accepted without its explicit test-only switch.'

  # Rename/replace at both destructive seams: after the first file hash but
  # before its final parent check, and immediately before final root deletion.
  foreach($cleanupMode in @('replace-root-before-file-delete','replace-root-before-root-delete')){
    $beforeMutationReceipts=@(Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath (Join-Path $stagingBase 'receipts') -File -Filter '*.json'|Select-Object -ExpandProperty FullName)
    $mutationRaw=Invoke-Fixture $currentDigest $sourceCommit $cleanupMode;$mutationResult=(($mutationRaw-join"`n")|Microsoft.PowerShell.Utility\ConvertFrom-Json)
    Assert-True ([string]$mutationResult.status-ceq'updated') 'The cleanup identity fixture did not complete its verified installer before mutation.'
    $newReceipts=@(Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath (Join-Path $stagingBase 'receipts') -File -Filter '*.json'|Where-Object{$_.FullName-cnotin$beforeMutationReceipts})
    $cleanupReceipts=@($newReceipts|Where-Object{$_.Name.EndsWith('.cleanup.json',[StringComparison]::Ordinal)});Assert-True ($newReceipts.Count-eq3-and$cleanupReceipts.Count-eq1) 'The cleanup-identity fixture lacks one exact external reconciliation receipt set.'
    $cleanupReceipt=([IO.File]::ReadAllText($cleanupReceipts[0].FullName)|Microsoft.PowerShell.Utility\ConvertFrom-Json);$replacementRoot=[IO.Path]::GetFullPath([string]$cleanupReceipt.stagingRoot);$replacementLeaf=[IO.Path]::GetFileName($replacementRoot)
    $retained=@(Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $stagingBase -Directory -Force|Where-Object{$_.Name.StartsWith(($replacementLeaf+'.retained-'),[StringComparison]::Ordinal)})
    Assert-True ((Test-Path -LiteralPath (Join-Path $replacementRoot 'replacement-sentinel.txt') -PathType Leaf)-and$retained.Count-eq1-and[IO.File]::ReadAllText((Join-Path $replacementRoot 'replacement-sentinel.txt'))-ceq'must survive cleanup') 'Cleanup followed or deleted a replacement staging generation.'
    if($cleanupMode-ceq'replace-root-before-file-delete'){Assert-True (Test-Path -LiteralPath (Join-Path $retained[0].FullName 'scripts\Install-B122.ps1') -PathType Leaf) 'Cleanup deleted staged bytes after the final file-identity seam changed.'}
    Assert-True ([string]$cleanupReceipt.cleanup-ceq'retained'-and[string]$cleanupReceipt.error-match'filesystem identity') 'A replaced staging generation was not durably retained as an identity mismatch.'
  }
  Assert-True (([IO.File]::ReadAllText((Join-Path $stateRoot 'bootstrap-invocations.txt')))-ceq[string](3+$ReceiptModes.Count)) 'The cleanup-identity fixtures did not each execute exactly once.'

  [ordered]@{schema='sxsy-b122.trusted-bootstrap-test';version=1;status='passed';checks=19;freshProcess=$true;jobContained=$true;immutableStaging=$true;environmentIsolated=$true;exactReceiptBound=$true;externalReceipts=$true;selfConsistentTamperRejected=$true;sourceCommitBound=$true;testOverrideBound=$true;cleanupIdentityBound=$true;fileDeleteSeamBound=$true;rootDeleteSeamBound=$true;replacementSentinelPreserved=$true}|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
}finally{
  $resolved=[IO.Path]::GetFullPath($testRoot);$temporary=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
  if($resolved.StartsWith($temporary,[StringComparison]::OrdinalIgnoreCase)-and[IO.Path]::GetFileName($resolved).StartsWith('sxsy-b122-trusted-bootstrap-',[StringComparison]::Ordinal)){
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
