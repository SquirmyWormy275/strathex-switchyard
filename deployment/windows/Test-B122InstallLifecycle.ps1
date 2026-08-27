$ErrorActionPreference='Stop'
$module = Join-Path $PSScriptRoot 'B122InstallTools.psm1'
Import-Module $module -Force
$temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
$root = [IO.Path]::GetFullPath((Join-Path $temporary ('sxsy-b122-install-test-'+[guid]::NewGuid().ToString('N'))))
if(-not $root.StartsWith($temporary,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe install test root.'}
$startScriptPath=Join-Path $PSScriptRoot 'Start-B122.ps1';$startTokens=$null;$startParseErrors=$null
$startAst=[Management.Automation.Language.Parser]::ParseFile($startScriptPath,[ref]$startTokens,[ref]$startParseErrors)
if($startParseErrors.Count){throw 'The installed Start-B122 entry point did not parse for cleanup-boundary inspection.'}
$guardedLaunches=@($startAst.FindAll({param($node)
  if($node-isnot[Management.Automation.Language.TryStatementAst]-or$node.CatchClauses.Count-ne1){return $false}
  $tryText=[string]$node.Body.Extent.Text;$catchText=[string]$node.CatchClauses[0].Body.Extent.Text
  return $tryText.IndexOf('$starter=Start-Process',[StringComparison]::Ordinal)-ge0-and$tryText.IndexOf('$providerHostLifecycle -Action Start',[StringComparison]::Ordinal)-ge0-and$catchText.IndexOf('Stop-B122InstalledCompanion',[StringComparison]::Ordinal)-ge0-and$catchText.IndexOf('Stop-B122InstalledProviderHost',[StringComparison]::Ordinal)-ge0
},$true))
if($guardedLaunches.Count-ne1){throw 'Companion/provider startup is not enclosed by one fail-closed no-survivor cleanup boundary.'}
function New-FakeBundle([string]$Path,[string]$Commit,[string]$Marker='one'){
  New-Item -ItemType Directory -Force -Path (Join-Path $Path 'scripts') | Out-Null
  [IO.File]::WriteAllText((Join-Path $Path 'payload.txt'),$Marker,(New-Object Text.UTF8Encoding($false)))
  $payloadHash=(Get-FileHash -LiteralPath (Join-Path $Path 'payload.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText((Join-Path $Path 'SHA256SUMS.json'),(@([ordered]@{path='payload.txt';sha256=$payloadHash;size=(Get-Item -LiteralPath (Join-Path $Path 'payload.txt')).Length})|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText((Join-Path $Path 'release.json'),([ordered]@{schema='sxsy-b122.windows-release';version=1;sourceCommit=$Commit;payloadCount=1}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText((Join-Path $Path 'scripts\Start-B122.ps1'),'param([switch]$WaitForHealth)',(New-Object Text.UTF8Encoding($false)))
}
try {
  $install=Join-Path $root 'install'; $one=Join-Path $root 'bundle-one'; $two=Join-Path $root 'bundle-two'; $first='1'*40; $second='2'*40
  New-FakeBundle $one $first; New-FakeBundle $two $second 'two'

  # PATH is not installation authority for VS Code.  Even an exact-looking
  # code.cmd wrapper in an attacker-controlled directory must be ignored.  A
  # fake installation is admitted only through the isolated-test contract,
  # remains under SXSY_TEST_ROOT, and is byte/identity checked again at use.
  $attackerBin=Join-Path $root 'attacker-bin';New-Item -ItemType Directory -Path $attackerBin|Out-Null
  [IO.File]::WriteAllText((Join-Path $attackerBin 'code.cmd'),'@echo attacker',(New-Object Text.UTF8Encoding($false)))
  $savedPath=$env:PATH;$savedTestMode=$env:SXSY_B122_TEST_MODE;$savedTestRoot=$env:SXSY_TEST_ROOT;$savedVsCodeInstallation=$env:SXSY_B122_TEST_VSCODE_INSTALLATION
  try{
    $env:PATH=$attackerBin+';'+$savedPath;$env:SXSY_B122_TEST_MODE=$null;$env:SXSY_TEST_ROOT=$null;$env:SXSY_B122_TEST_VSCODE_INSTALLATION=$null
    $pathResolved=Resolve-B122VsCodeCli
    if($null-ne$pathResolved-and[IO.Path]::GetFullPath([string]$pathResolved.installationRoot).StartsWith([IO.Path]::GetFullPath($attackerBin),[StringComparison]::OrdinalIgnoreCase)){throw 'An attacker-controlled PATH entry became VS Code lifecycle authority.'}
    $fakeVsCode=Join-Path $root 'reviewed fake VS Code';$fakeCli=Join-Path $fakeVsCode 'resources\app\out\cli.js';New-Item -ItemType Directory -Path (Split-Path -Parent $fakeCli) -Force|Out-Null
    Copy-Item -LiteralPath (Get-Command node.exe -ErrorAction Stop).Source -Destination (Join-Path $fakeVsCode 'Code.exe')
    [IO.File]::WriteAllText($fakeCli,'process.stdout.write("fixture");',(New-Object Text.UTF8Encoding($false)))
    $env:SXSY_B122_TEST_MODE='1';$env:SXSY_TEST_ROOT=$root;$env:SXSY_B122_TEST_VSCODE_INSTALLATION=$fakeVsCode
    $reviewedCli=Resolve-B122VsCodeCli;if($null-eq$reviewedCli-or-not[bool]$reviewedCli.testOverride){throw 'The isolated reviewed VS Code fixture did not resolve.'}
    Assert-B122VsCodeCliIdentity -Cli $reviewedCli|Out-Null
    [IO.File]::AppendAllText($fakeCli,'// changed')
    $changedRejected=$false;try{Assert-B122VsCodeCliIdentity -Cli $reviewedCli|Out-Null}catch{$changedRejected=$_.Exception.Message-match'bytes changed'}
    if(-not$changedRejected){throw 'A changed VS Code CLI entry point retained lifecycle authority.'}
  }finally{$env:PATH=$savedPath;$env:SXSY_B122_TEST_MODE=$savedTestMode;$env:SXSY_TEST_ROOT=$savedTestRoot;$env:SXSY_B122_TEST_VSCODE_INSTALLATION=$savedVsCodeInstallation}
  Initialize-B122OwnedInstallRoot -InstallRoot $install -ProtectedPaths @($one,$two)|Out-Null
  $ownership=Get-B122InstallOwnership -InstallRoot $install
  if($ownership.schema -cne 'sxsy-b122.install-root-ownership' -or $ownership.version -ne 1 -or $ownership.canonicalRoot -cne [IO.Path]::GetFullPath($install)){throw 'Install root ownership was not authenticated.'}
  # A state generation is a one-to-one lifecycle/process authority boundary.
  # The bidirectional binding is serialized by the state-root mutex so a
  # second install root cannot share receipts, provider controls, or a
  # companion endpoint with the first generation.
  $bindingState=Join-Path $root 'binding-state';$bindingInstallA=Join-Path $bindingState 'install-a';$bindingInstallB=Join-Path $root 'install-b'
  Initialize-B122OwnedStateRoot -StateRoot $bindingState -ProtectedPaths @($module,$PSScriptRoot)|Out-Null
  Initialize-B122OwnedInstallRoot -InstallRoot $bindingInstallA -ProtectedPaths @($module,$PSScriptRoot)|Out-Null
  Initialize-B122OwnedInstallRoot -InstallRoot $bindingInstallB -ProtectedPaths @($module,$PSScriptRoot)|Out-Null
  Bind-B122InstallStateRoot -InstallRoot $bindingInstallA -StateRoot $bindingState|Out-Null
  Assert-B122InstallStateRootBinding -InstallRoot $bindingInstallA -StateRoot $bindingState|Out-Null
  $purgePreflightRejected=$false;try{& (Join-Path $PSScriptRoot 'Uninstall-B122.ps1') -InstallRoot $bindingInstallA -StateRoot $bindingState -PurgeState -ConfirmStateRoot $bindingState -PurgeConfirmation 'WRONG' -Confirm:$false|Out-Null}catch{$purgePreflightRejected=$_.Exception.Message-match'before any product effect'}
  if(-not$purgePreflightRejected-or-not(Test-Path -LiteralPath (Join-Path $bindingInstallA '.sxsy-b122-install-root.json') -PathType Leaf)-or-not(Test-Path -LiteralPath (Join-Path $bindingState '.sxsy-b122-state-root.json') -PathType Leaf)){throw 'An invalid purge confirmation changed the live install or state generation.'}
  $staleStateId=[guid]::NewGuid().ToString('D');$staleHasher=[Security.Cryptography.SHA256]::Create();try{$staleRecoveryDigest=([BitConverter]::ToString($staleHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($bindingState)).ToLowerInvariant())))).Replace('-','').ToLowerInvariant()}finally{$staleHasher.Dispose()};$staleRecoveryPath=Join-Path (Split-Path -Parent $bindingState) ('.sxsy-b122-'+$staleRecoveryDigest+'-recovery.json')
  Write-B122ExternalRecoveryRecord -Path $staleRecoveryPath -Payload ([ordered]@{schema='sxsy-b122.uninstall-external-recovery';version=1;status='completed';canonicalInstallRoot=[IO.Path]::GetFullPath($bindingInstallA);installRootId=[guid]::NewGuid().ToString('D');canonicalStateRoot=[IO.Path]::GetFullPath($bindingState);stateRootId=$staleStateId;purgeState=$true;keepVsCode=$true;extensionIdentity='SquirmyWormy275.strathex-switchyard-b122@0.0.0';extensionVsixSha256=('0'*64)})|Out-Null
  $stalePurgeRejected=$false;try{& (Join-Path $PSScriptRoot 'Uninstall-B122.ps1') -InstallRoot $bindingInstallA -StateRoot $bindingState -PurgeState -ConfirmStateRoot $bindingState -PurgeConfirmation ("PURGE SXSY-B122 STATE $staleStateId") -Confirm:$false|Out-Null}catch{$stalePurgeRejected=$_.Exception.Message-match'before any product effect'}
  if(-not$stalePurgeRejected-or-not(Test-Path -LiteralPath (Join-Path $bindingInstallA '.sxsy-b122-install-root.json') -PathType Leaf)-or-not(Test-Path -LiteralPath (Join-Path $bindingState '.sxsy-b122-state-root.json') -PathType Leaf)){throw 'A completed purge tombstone authorized effects against a different live state generation.'}
  Remove-Item -LiteralPath $staleRecoveryPath -Force

  # The purge inventory is not deletion authority by itself.  If a nested
  # parent is replaced by a junction after inventory, the exact saved-path
  # delete must fail before it can reach the external target.
  $swapState=Join-Path $root 'purge-swap-state';$swapInstall=Join-Path $root 'purge-swap-install';$swapOutside=Join-Path $root 'purge-swap-outside'
  Initialize-B122OwnedStateRoot -StateRoot $swapState -ProtectedPaths @($module,$PSScriptRoot,$swapInstall,$swapOutside)|Out-Null
  $swapNested=Join-Path $swapState 'logs\nested';New-Item -ItemType Directory -Path $swapNested -Force|Out-Null;[IO.File]::WriteAllText((Join-Path $swapNested 'owned.txt'),'owned')
  New-Item -ItemType Directory -Path $swapOutside|Out-Null;$swapMarker=Join-Path $swapOutside 'must-survive.txt';[IO.File]::WriteAllText($swapMarker,'preserve')
  $swapStateOwnership=Get-B122StateOwnership -StateRoot $swapState;$swapStateIdentity=Get-B122FileSystemIdentity -Path $swapState;$swapInstallId=[guid]::NewGuid().ToString('D')
  $swapHasher=[Security.Cryptography.SHA256]::Create();try{$swapRecoveryDigest=([BitConverter]::ToString($swapHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($swapState)).ToLowerInvariant())))).Replace('-','').ToLowerInvariant()}finally{$swapHasher.Dispose()};$swapRecoveryPath=Join-Path (Split-Path -Parent $swapState) ('.sxsy-b122-'+$swapRecoveryDigest+'-recovery.json')
  $swapCapsule=New-B122UninstallRecoveryCapsule -StateRoot $swapState -ExpectedStateRootId ([string]$swapStateOwnership.rootId) -InstallRootId $swapInstallId -EntryPointSource (Join-Path $PSScriptRoot 'Uninstall-B122.ps1') -ModuleSource $module
  $swapRecord=[ordered]@{schema='sxsy-b122.uninstall-external-recovery';version=1;status='purging';canonicalInstallRoot=[IO.Path]::GetFullPath($swapInstall);installRootId=$swapInstallId;installFileIdentity='00000000:0000000000000000';canonicalStateRoot=[IO.Path]::GetFullPath($swapState);stateRootId=[string]$swapStateOwnership.rootId;stateFileIdentity=$swapStateIdentity;sourceCommit=('6'*40);bundleId=('6'*64);keepVsCode=$true;purgeState=$true;extensionIdentity='SquirmyWormy275.strathex-switchyard-b122@0.0.0';extensionVsixSha256=('0'*64);extensionRemoved=$false;extensionAbsenceVerified=$false;shutdown=[ordered]@{status='stopped';survivors=@()};providerHostShutdown=[ordered]@{status='stopped';survivorCount=0};recoveryCapsule=$swapCapsule;createdAt=(Get-Date).ToUniversalTime().ToString('o');updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  Write-B122ExternalRecoveryRecord -Path $swapRecoveryPath -Payload $swapRecord|Out-Null
  $savedSwapMode=$env:SXSY_B122_TEST_MODE;$savedSwapParent=$env:SXSY_B122_TEST_SWAP_STATE_PARENT;$savedSwapTarget=$env:SXSY_B122_TEST_SWAP_STATE_TARGET
  try{$env:SXSY_B122_TEST_MODE='1';$env:SXSY_B122_TEST_SWAP_STATE_PARENT='logs\nested';$env:SXSY_B122_TEST_SWAP_STATE_TARGET=$swapOutside;$swapRejected=$false;try{& (Join-Path $PSScriptRoot 'Uninstall-B122.ps1') -InstallRoot $swapInstall -StateRoot $swapState -KeepVsCodeExtension -PurgeState -ConfirmStateRoot $swapState -PurgeConfirmation ("PURGE SXSY-B122 STATE $($swapStateOwnership.rootId)") -Confirm:$false|Out-Null}catch{$swapRejected=$_.Exception.Message-match'changed during purge|ancestor identity'}
  }finally{$env:SXSY_B122_TEST_MODE=$savedSwapMode;$env:SXSY_B122_TEST_SWAP_STATE_PARENT=$savedSwapParent;$env:SXSY_B122_TEST_SWAP_STATE_TARGET=$savedSwapTarget}
  if(-not$swapRejected-or-not(Test-Path -LiteralPath $swapMarker -PathType Leaf)-or-not(Test-Path -LiteralPath $swapState -PathType Container)){throw 'A nested state-parent swap was not rejected before external deletion.'}
  $swapLink=Join-Path $swapState 'logs\nested';$swapOriginal=$swapLink+'.b122-test-original';if(Test-Path -LiteralPath $swapLink){[IO.Directory]::Delete($swapLink)};if(Test-Path -LiteralPath $swapOriginal){[IO.Directory]::Move($swapOriginal,$swapLink)}
  $swapResult=& (Join-Path $PSScriptRoot 'Uninstall-B122.ps1') -InstallRoot $swapInstall -StateRoot $swapState -KeepVsCodeExtension -PurgeState -ConfirmStateRoot $swapState -PurgeConfirmation ("PURGE SXSY-B122 STATE $($swapStateOwnership.rootId)") -Confirm:$false|ConvertFrom-Json
  if($swapResult.statePreserved-ne$false-or(Test-Path -LiteralPath $swapState)-or-not(Test-Path -LiteralPath $swapMarker -PathType Leaf)){throw 'Exact retry after rejecting a nested state-parent swap did not purge only the owned state generation.'}
  $secondBindingRejected=$false;try{Bind-B122InstallStateRoot -InstallRoot $bindingInstallB -StateRoot $bindingState|Out-Null}catch{$secondBindingRejected=$_.Exception.Message-match'already bound|different install'}
  if(-not$secondBindingRejected){throw 'A second install generation claimed an already-bound state root.'}
  $bindingAOwnership=Get-B122InstallOwnership -InstallRoot $bindingInstallA;$retiredRemoval=Remove-B122OwnedInstallation -InstallRoot $bindingInstallA
  if(-not$retiredRemoval.complete-or(Test-Path -LiteralPath $bindingInstallA)){throw 'The binding-retirement fixture did not remove its exact first install generation.'}
  Release-B122InstallStateRootBinding -InstallRoot $bindingInstallA -StateRoot $bindingState -ExpectedInstallRootId ([string]$bindingAOwnership.rootId)|Out-Null
  $replacementOwnership=Initialize-B122OwnedInstallRoot -InstallRoot $bindingInstallA -ProtectedPaths @($module,$PSScriptRoot)
  if([string]$replacementOwnership.rootId-ceq[string]$bindingAOwnership.rootId){throw 'The reinstall fixture reused an install generation identity.'}
  Bind-B122InstallStateRoot -InstallRoot $bindingInstallA -StateRoot $bindingState|Out-Null
  Assert-B122InstallStateRootBinding -InstallRoot $bindingInstallA -StateRoot $bindingState|Out-Null

  # A power loss after the ownership sentinel is the final deleted control
  # leaves only the original empty directory.  The authenticated external
  # record plus the immutable directory identity must be sufficient to finish
  # that exact generation; retry must not require the now-absent sentinel.
  $finalizeState=Join-Path $root 'finalize-state';$finalizeInstall=Join-Path $root 'finalize-install';$finalizeBundle=Join-Path $root 'finalize-bundle';$finalizeCommit='5'*40
  New-FakeBundle $finalizeBundle $finalizeCommit 'finalize'
  Initialize-B122OwnedStateRoot -StateRoot $finalizeState -ProtectedPaths @($module,$PSScriptRoot,$finalizeInstall)|Out-Null
  Initialize-B122OwnedInstallRoot -InstallRoot $finalizeInstall -ProtectedPaths @($module,$PSScriptRoot,$finalizeState,$finalizeBundle)|Out-Null
  Bind-B122InstallStateRoot -InstallRoot $finalizeInstall -StateRoot $finalizeState|Out-Null
  Import-B122ValidatedBundle -BundleRoot $finalizeBundle -InstallRoot $finalizeInstall|Out-Null
  $finalizeInstallState=Set-B122CurrentVersion -InstallRoot $finalizeInstall -VersionId $finalizeCommit
  $finalizeOwnership=Get-B122InstallOwnership -InstallRoot $finalizeInstall;$finalizeStateOwnership=Get-B122StateOwnership -StateRoot $finalizeState
  $finalizeInstallIdentity=Get-B122FileSystemIdentity -Path $finalizeInstall;$finalizeStateIdentity=Get-B122FileSystemIdentity -Path $finalizeState
  $hash=[Security.Cryptography.SHA256]::Create();try{$recoveryDigest=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($finalizeState)).ToLowerInvariant())))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  $finalizeRecovery=Join-Path (Split-Path -Parent $finalizeState) ('.sxsy-b122-'+$recoveryDigest+'-recovery.json')
  $finalizeCapsule=New-B122UninstallRecoveryCapsule -StateRoot $finalizeState -ExpectedStateRootId ([string]$finalizeStateOwnership.rootId) -InstallRootId ([string]$finalizeOwnership.rootId) -EntryPointSource (Join-Path $PSScriptRoot 'Uninstall-B122.ps1') -ModuleSource $module
  $finalizeRecord=[ordered]@{schema='sxsy-b122.uninstall-external-recovery';version=1;status='removing_product';canonicalInstallRoot=[IO.Path]::GetFullPath($finalizeInstall);installRootId=[string]$finalizeOwnership.rootId;installFileIdentity=$finalizeInstallIdentity;canonicalStateRoot=[IO.Path]::GetFullPath($finalizeState);stateRootId=[string]$finalizeStateOwnership.rootId;stateFileIdentity=$finalizeStateIdentity;sourceCommit=$finalizeCommit;bundleId=[string]$finalizeInstallState.currentBundleId;keepVsCode=$true;purgeState=$false;extensionIdentity='SquirmyWormy275.strathex-switchyard-b122@0.0.0';extensionVsixSha256=('0'*64);extensionRemoved=$false;extensionAbsenceVerified=$false;shutdown=[ordered]@{status='stopped';survivors=@()};providerHostShutdown=[ordered]@{status='stopped';survivorCount=0};recoveryCapsule=$finalizeCapsule;createdAt=(Get-Date).ToUniversalTime().ToString('o');updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  Write-B122ExternalRecoveryRecord -Path $finalizeRecovery -Payload $finalizeRecord|Out-Null
  $finalizeRemoval=Remove-B122OwnedInstallation -InstallRoot $finalizeInstall -PreserveLifecycleMetadata
  if(-not$finalizeRemoval.complete){throw 'The sentinel-finalization fixture retained unexpected product content.'}
  $savedFinalizationMode=$env:SXSY_B122_TEST_MODE;$savedFinalizationCount=$env:SXSY_B122_TEST_FAIL_AFTER_CONTROL_DELETE_COUNT
  try{$env:SXSY_B122_TEST_MODE='1';$env:SXSY_B122_TEST_FAIL_AFTER_CONTROL_DELETE_COUNT='3';$injectedFinalization=$false;try{Complete-B122OwnedRootFinalization -InstallRoot $finalizeInstall -ExpectedRootId ([string]$finalizeOwnership.rootId) -ExpectedFileIdentity $finalizeInstallIdentity|Out-Null}catch{$injectedFinalization=$_.Exception.Message-match'Injected root-control'}
  }finally{$env:SXSY_B122_TEST_MODE=$savedFinalizationMode;$env:SXSY_B122_TEST_FAIL_AFTER_CONTROL_DELETE_COUNT=$savedFinalizationCount}
  if(-not$injectedFinalization-or-not(Test-Path -LiteralPath $finalizeInstall -PathType Container)-or(Test-Path -LiteralPath (Join-Path $finalizeInstall '.sxsy-b122-install-root.json'))){throw 'The root-finalization power-loss fixture did not stop after deleting the ownership sentinel.'}
  $finalizeResume=& ([string]$finalizeCapsule.entryPoint) -InstallRoot $finalizeInstall -StateRoot $finalizeState -KeepVsCodeExtension -Confirm:$false|ConvertFrom-Json
  if($finalizeResume.status-cne'uninstalled'-or(Test-Path -LiteralPath $finalizeInstall)-or-not(Test-Path -LiteralPath $finalizeState -PathType Container)){throw 'Uninstall could not resume the exact empty product generation after ownership-sentinel deletion.'}

  # The recovery capsule must be durable before the first manifested deletion,
  # and it must remain independently executable after both the installed
  # Uninstall entry point and its module have been removed.
  $capsuleState=Join-Path $root 'capsule-state';$capsuleInstall=Join-Path $root 'capsule-install';$capsuleBundle=Join-Path $root 'capsule-bundle';$capsuleCommit='7'*40
  New-FakeBundle $capsuleBundle $capsuleCommit 'capsule'
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Uninstall-B122.ps1') -Destination (Join-Path $capsuleBundle 'scripts\Uninstall-B122.ps1')
  Copy-Item -LiteralPath $module -Destination (Join-Path $capsuleBundle 'scripts\B122InstallTools.psm1')
  [IO.File]::WriteAllText((Join-Path $capsuleBundle 'scripts\Manage-B122ProviderHost.ps1'),"param([string]`$Action,[string]`$BundleRoot,[string]`$ConfigurationPath)`n[ordered]@{schema='sxsy-b122.provider-host-lifecycle';version=1;action='stop';status='stopped';configured=`$false;processes=@();survivorCount=0}|ConvertTo-Json -Compress",(New-Object Text.UTF8Encoding($false)))
  $capsuleVsix=Join-Path $capsuleBundle 'extension\sxsy-b122-switchyard.vsix';New-Item -ItemType Directory -Path (Split-Path -Parent $capsuleVsix)|Out-Null;[IO.File]::WriteAllBytes($capsuleVsix,[byte[]](1,2,3,4))
  $capsuleRelease=Get-Content -LiteralPath (Join-Path $capsuleBundle 'release.json') -Raw|ConvertFrom-Json;$capsuleRelease|Add-Member -NotePropertyName vscodeExtension -NotePropertyValue '0.0.0' -Force;[IO.File]::WriteAllText((Join-Path $capsuleBundle 'release.json'),($capsuleRelease|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
  Initialize-B122OwnedStateRoot -StateRoot $capsuleState -ProtectedPaths @($module,$PSScriptRoot,$capsuleInstall,$capsuleBundle)|Out-Null
  Initialize-B122OwnedInstallRoot -InstallRoot $capsuleInstall -ProtectedPaths @($module,$PSScriptRoot,$capsuleState,$capsuleBundle)|Out-Null
  Bind-B122InstallStateRoot -InstallRoot $capsuleInstall -StateRoot $capsuleState|Out-Null
  $capsuleVersion=Import-B122ValidatedBundle -BundleRoot $capsuleBundle -InstallRoot $capsuleInstall;Set-B122CurrentVersion -InstallRoot $capsuleInstall -VersionId $capsuleCommit|Out-Null
  $capsuleRecord=Get-B122InstalledVersionRecord -InstallRoot $capsuleInstall -SourceCommit $capsuleCommit
  $orderedRemoval=@($capsuleRecord.files|Sort-Object {([string]$_.path).Length} -Descending);$entryIndex=[Array]::IndexOf([object[]]$orderedRemoval,@($orderedRemoval|Where-Object{$_.path-ceq'scripts/Uninstall-B122.ps1'})[0])+1;$moduleIndex=[Array]::IndexOf([object[]]$orderedRemoval,@($orderedRemoval|Where-Object{$_.path-ceq'scripts/B122InstallTools.psm1'})[0])+1;$deleteCount=[Math]::Max($entryIndex,$moduleIndex)
  if($entryIndex-lt1-or$moduleIndex-lt1){throw 'The recovery-capsule fixture could not locate its installed recovery payload.'}
  $savedCapsuleMode=$env:SXSY_B122_TEST_MODE;$savedCapsuleDelete=$env:SXSY_B122_TEST_FAIL_AFTER_MANIFEST_DELETE_COUNT;$savedRunKey=$env:SXSY_B122_TEST_RUN_KEY_PATH;$testRunParent='HKCU:\Software\SXSY-B122-Tests\'+[guid]::NewGuid().ToString('N');$testRunKey=$testRunParent+'\Run'
  try{
    $env:SXSY_B122_TEST_MODE='1';$env:SXSY_B122_TEST_RUN_KEY_PATH=$testRunKey;$env:SXSY_B122_TEST_FAIL_AFTER_MANIFEST_DELETE_COUNT=[string]$deleteCount
    $interrupted=$false;$interruptionError=$null;try{& (Join-Path $capsuleVersion 'scripts\Uninstall-B122.ps1') -InstallRoot $capsuleInstall -StateRoot $capsuleState -KeepVsCodeExtension -Confirm:$false|Out-Null}catch{$interruptionError=$_.Exception.Message;$interrupted=$interruptionError-match'Injected manifested-file removal'}
    $entryStillExists=Test-Path -LiteralPath (Join-Path $capsuleVersion 'scripts\Uninstall-B122.ps1');$moduleStillExists=Test-Path -LiteralPath (Join-Path $capsuleVersion 'scripts\B122InstallTools.psm1')
    if(-not$interrupted-or$entryStillExists-or$moduleStillExists){throw "The uninstall fixture did not interrupt after deleting its installed recovery code. deleteCount=$deleteCount entryIndex=$entryIndex moduleIndex=$moduleIndex interrupted=$interrupted entryExists=$entryStillExists moduleExists=$moduleStillExists error=$interruptionError"}
    $capsuleHasher=[Security.Cryptography.SHA256]::Create();try{$capsuleRecoveryDigest=([BitConverter]::ToString($capsuleHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($capsuleState)).ToLowerInvariant())))).Replace('-','').ToLowerInvariant()}finally{$capsuleHasher.Dispose()};$capsuleRecoveryPath=Join-Path (Split-Path -Parent $capsuleState) ('.sxsy-b122-'+$capsuleRecoveryDigest+'-recovery.json')
    $capsuleExternal=Read-B122ExternalRecoveryRecord -Path $capsuleRecoveryPath
    if($null-eq$capsuleExternal-or$capsuleExternal.status-cne'removing_product'){throw 'The uninstall did not durably publish removing_product before manifested deletion.'}
    Assert-B122UninstallRecoveryCapsule -StateRoot $capsuleState -StateRootId ([string]$capsuleExternal.stateRootId) -InstallRootId ([string]$capsuleExternal.installRootId) -Capsule $capsuleExternal.recoveryCapsule|Out-Null
    $env:SXSY_B122_TEST_FAIL_AFTER_MANIFEST_DELETE_COUNT=$null
    $capsuleResume=& ([string]$capsuleExternal.recoveryCapsule.entryPoint) -InstallRoot $capsuleInstall -StateRoot $capsuleState -KeepVsCodeExtension -Confirm:$false|ConvertFrom-Json
    if($capsuleResume.status-cne'uninstalled'-or(Test-Path -LiteralPath $capsuleInstall)-or-not(Test-Path -LiteralPath $capsuleState -PathType Container)){throw 'The independently durable uninstall capsule did not resume product removal.'}
  }finally{
    $env:SXSY_B122_TEST_MODE=$savedCapsuleMode;$env:SXSY_B122_TEST_FAIL_AFTER_MANIFEST_DELETE_COUNT=$savedCapsuleDelete;$env:SXSY_B122_TEST_RUN_KEY_PATH=$savedRunKey
    if(Test-Path -LiteralPath $testRunParent){Remove-Item -LiteralPath $testRunParent -Recurse -Force}
  }
  Import-B122ValidatedBundle -BundleRoot $one -InstallRoot $install | Out-Null
  $state=Set-B122CurrentVersion -InstallRoot $install -VersionId $first
  if($state.current -cne $first -or $null -ne $state.previous){throw 'Initial version activation failed.'}
  $abandoned=Join-Path $install 'versions\.staging-interrupted'; New-Item -ItemType Directory -Path $abandoned | Out-Null
  Repair-B122InterruptedInstall -InstallRoot $install
  if(Test-Path -LiteralPath $abandoned){throw 'Interrupted staging recovery failed.'}
  Import-B122ValidatedBundle -BundleRoot $two -InstallRoot $install | Out-Null
  $state=Set-B122CurrentVersion -InstallRoot $install -VersionId $second
  if($state.current -cne $second -or $state.previous -cne $first){throw 'Update pointer did not preserve rollback.'}
  $state=Restore-B122PreviousVersion -InstallRoot $install
  if($state.current -cne $first -or $state.previous -cne $second){throw 'Rollback pointer did not swap atomically.'}
  $rootModule=Join-Path $install 'B122InstallTools.psm1'; $rootLauncher=Join-Path $install 'Invoke-B122Current.ps1'
  $oldModuleBytes=[byte[]](0,255,12,34,56,78); $oldLauncherBytes=[byte[]](239,187,191,35,111,108,100)
  foreach($stage in @('extension','health','autostart')){
    [IO.File]::WriteAllBytes($rootModule,$oldModuleBytes); [IO.File]::WriteAllBytes($rootLauncher,$oldLauncherBytes)
    $moduleSnapshot=Get-B122FileSnapshot -Path $rootModule; $launcherSnapshot=Get-B122FileSnapshot -Path $rootLauncher
    [IO.File]::WriteAllText($rootModule,'candidate incompatible module',(New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText($rootLauncher,'candidate incompatible launcher',(New-Object Text.UTF8Encoding($false)))
    $effects=@{extension='old';autostart='old';priorRecovered=$false;rootToolsRestored=$false}
    $installExtension={ $effects.extension='new'; if($stage -ceq 'extension'){throw 'injected extension failure'} }
    $health={ if($stage -ceq 'health'){throw 'injected health failure'} }
    $autostart={ $effects.autostart='new'; if($stage -ceq 'autostart'){throw 'injected autostart failure'} }
    $restoreExtension={ $effects.extension='old' }; $restoreAutostart={ $effects.autostart='old' }
    $restoreRootTools={ Restore-B122FileSnapshot -Path $rootModule -Snapshot $moduleSnapshot; Restore-B122FileSnapshot -Path $rootLauncher -Snapshot $launcherSnapshot; $effects.rootToolsRestored=$true }
    $recover={
      if([Convert]::ToBase64String([IO.File]::ReadAllBytes($rootModule)) -cne [Convert]::ToBase64String($oldModuleBytes) -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($rootLauncher)) -cne [Convert]::ToBase64String($oldLauncherBytes)){throw 'Prior recovery observed candidate root tooling.'}
      $effects.priorRecovered=$true
    }
    $failed=$false; try{Invoke-B122AtomicActivation -InstallRoot $install -VersionId $second -PriorState $state -InstallExtension $installExtension -WaitForHealth $health -ConfigureAutostart $autostart -RestoreExtension $restoreExtension -RestoreAutostart $restoreAutostart -RestoreRootTools $restoreRootTools -RecoverPrior $recover|Out-Null}catch{$failed=$true}
    if(-not $failed){throw "Failure injection at $stage did not fail."}
    $after=Get-B122InstallState -InstallRoot $install
    if($after.current -cne $first -or $after.previous -cne $second -or $effects.extension -cne 'old' -or $effects.autostart -cne 'old' -or -not $effects.rootToolsRestored -or -not $effects.priorRecovered){throw "Activation rollback was incomplete at $stage."}
  }
  $firstInstall=Join-Path $root 'first-install'; Import-B122ValidatedBundle -BundleRoot $one -InstallRoot $firstInstall|Out-Null
  $firstModule=Join-Path $firstInstall 'B122InstallTools.psm1'; $firstLauncher=Join-Path $firstInstall 'Invoke-B122Current.ps1'
  $firstModuleSnapshot=Get-B122FileSnapshot -Path $firstModule; $firstLauncherSnapshot=Get-B122FileSnapshot -Path $firstLauncher
  [IO.File]::WriteAllText($firstModule,'candidate module'); [IO.File]::WriteAllText($firstLauncher,'candidate launcher')
  $firstEffects=@{restored=$false;rootToolsRestored=$false}; $failFirst={throw 'injected first-install failure'}; $noop={}; $restoreFirst={$firstEffects.restored=$true}
  $restoreFirstTools={Restore-B122FileSnapshot -Path $firstModule -Snapshot $firstModuleSnapshot;Restore-B122FileSnapshot -Path $firstLauncher -Snapshot $firstLauncherSnapshot;$firstEffects.rootToolsRestored=$true}
  $failed=$false; try{Invoke-B122AtomicActivation -InstallRoot $firstInstall -VersionId $first -PriorState $null -InstallExtension $failFirst -WaitForHealth $noop -ConfigureAutostart $noop -RestoreExtension $restoreFirst -RestoreAutostart $noop -RestoreRootTools $restoreFirstTools -RecoverPrior $noop|Out-Null}catch{$failed=$true}
  if(-not $failed -or $null -ne (Get-B122InstallState -InstallRoot $firstInstall) -or -not $firstEffects.restored -or -not $firstEffects.rootToolsRestored -or (Test-Path -LiteralPath $firstModule) -or (Test-Path -LiteralPath $firstLauncher)){throw 'First-install rollback did not restore an uninstalled state.'}
  Remove-B122UnreferencedVersion -InstallRoot $firstInstall -VersionId $first
  if(Test-Path -LiteralPath (Join-Path (Join-Path $firstInstall 'versions') $first)){throw 'First-install cleanup retained an unreferenced version.'}
  if(@(Get-ChildItem -LiteralPath $install -Filter '*.tmp' -File -Force).Count -ne 0){throw 'Atomic state write leaked a temporary file.'}
  $escaped=$false; try{Assert-B122ChildPath -Parent $install -Child (Join-Path $install '..\escape')|Out-Null}catch{$escaped=$true}; if(-not $escaped){throw 'Containment accepted an escaping install path.'}

  # Same source commit is idempotent only for the exact immutable bundle identity.
  $collision=Join-Path $root 'bundle-collision'; New-FakeBundle $collision $first 'different-content'
  $rejectedCollision=$false; try{Import-B122ValidatedBundle -BundleRoot $collision -InstallRoot $install|Out-Null}catch{$rejectedCollision=$_.Exception.Message -match 'same source commit|bundle'}
  if(-not $rejectedCollision){throw 'A same-commit/different-bundle collision was accepted.'}
  $identical=Import-B122ValidatedBundle -BundleRoot $one -InstallRoot $install
  if($identical -cne (Join-Path (Join-Path $install 'versions') $first)){throw 'Exact bundle re-import was not idempotent.'}

  # Recursive traversal never follows a junction from source, staging, or an
  # installed version.  The exact external marker must survive every rejected
  # operation and the junction itself must remain for explicit operator review.
  $outside=Join-Path $root 'junction-outside';New-Item -ItemType Directory -Path $outside|Out-Null;$outsideMarker=Join-Path $outside 'must-survive.txt';[IO.File]::WriteAllText($outsideMarker,'preserve')
  $reparseBundle=Join-Path $root 'bundle-reparse';New-FakeBundle $reparseBundle ('4'*40);$sourceLink=Join-Path $reparseBundle 'linked-outside'
  New-Item -ItemType Junction -Path $sourceLink -Target $outside|Out-Null
  $sourceReparseRejected=$false;try{Get-B122BundleIdentity -BundleRoot $reparseBundle|Out-Null}catch{$sourceReparseRejected=$_.Exception.Message-match'reparse|junction'}
  if(-not$sourceReparseRejected-or-not(Test-Path -LiteralPath $outsideMarker -PathType Leaf)){throw 'Bundle inventory followed or accepted a source junction.'}
  [IO.Directory]::Delete($sourceLink)
  $stageRoot=Join-Path $root 'stage-reparse';Initialize-B122OwnedInstallRoot -InstallRoot $stageRoot -ProtectedPaths @($module,$PSScriptRoot)|Out-Null;$stageVersions=Join-Path $stageRoot 'versions';New-Item -ItemType Directory -Path $stageVersions|Out-Null;$stageLink=Join-Path $stageVersions '.staging-junction'
  New-Item -ItemType Junction -Path $stageLink -Target $outside|Out-Null
  $stageReparseRejected=$false;try{Repair-B122InterruptedInstall -InstallRoot $stageRoot}catch{$stageReparseRejected=$_.Exception.Message-match'reparse|junction'}
  if(-not$stageReparseRejected-or-not(Test-Path -LiteralPath $stageLink)-or-not(Test-Path -LiteralPath $outsideMarker -PathType Leaf)){throw 'Interrupted-install repair followed or removed a staging junction.'}
  [IO.Directory]::Delete($stageLink)

  # Any unmanifested nested content (including a junction) keeps the
  # authenticated ownership and manifest intact so a later exact retry is
  # possible.  Only the operator-removed unknown content unlocks completion.
  $nestedRoot=Join-Path $root 'nested-unmanifested';Initialize-B122OwnedInstallRoot -InstallRoot $nestedRoot -ProtectedPaths @($module,$PSScriptRoot)|Out-Null;Import-B122ValidatedBundle -BundleRoot $one -InstallRoot $nestedRoot|Out-Null;Set-B122CurrentVersion -InstallRoot $nestedRoot -VersionId $first|Out-Null
  $nestedVersion=Join-Path (Join-Path $nestedRoot 'versions') $first;$nestedUnknown=Join-Path $nestedVersion 'unmanifested\nested.txt';New-Item -ItemType Directory -Path (Split-Path -Parent $nestedUnknown)|Out-Null;[IO.File]::WriteAllText($nestedUnknown,'foreign')
  $nestedLink=Join-Path $nestedVersion 'unmanifested-junction';New-Item -ItemType Junction -Path $nestedLink -Target $outside|Out-Null
  $nestedRemoval=Remove-B122OwnedInstallation -InstallRoot $nestedRoot
  if($nestedRemoval.complete-ne$false-or$nestedRemoval.rootRemoved-ne$false-or-not(Test-Path -LiteralPath (Join-Path $nestedRoot '.sxsy-b122-install-root.json') -PathType Leaf)-or-not(Test-Path -LiteralPath (Join-Path $nestedRoot '.sxsy-b122-root-manifest.json') -PathType Leaf)-or@($nestedRemoval.unownedPaths|Where-Object{$_-ceq'versions/'+$first+'/unmanifested/nested.txt'}).Count-ne1-or@($nestedRemoval.unownedPaths|Where-Object{$_-ceq'versions/'+$first+'/unmanifested-junction'}).Count-ne1-or-not(Test-Path -LiteralPath $outsideMarker -PathType Leaf)){throw 'Nested unmanifested content destroyed retry metadata or escaped the owned root.'}
  [IO.Directory]::Delete($nestedLink);Remove-Item -LiteralPath $nestedUnknown -Force;Remove-Item -LiteralPath (Split-Path -Parent $nestedUnknown) -Force
  $nestedRetry=Remove-B122OwnedInstallation -InstallRoot $nestedRoot
  if(-not$nestedRetry.complete-or-not$nestedRetry.rootRemoved-or(Test-Path -LiteralPath $nestedRoot)){throw 'Manifest-only cleanup did not complete after exact unknown-content removal.'}

  # Dangerous, mixed, and tampered roots fail before any recursive effect.
  foreach($dangerous in @([IO.Path]::GetPathRoot($install),[Environment]::GetFolderPath('UserProfile'))){
    $blocked=$false;try{Initialize-B122OwnedInstallRoot -InstallRoot $dangerous -ProtectedPaths @($PSScriptRoot)|Out-Null}catch{$blocked=$true};if(-not $blocked){throw "Dangerous install root was accepted: $dangerous"}
  }
  $mixed=Join-Path $root 'mixed';New-Item -ItemType Directory -Path $mixed|Out-Null;[IO.File]::WriteAllText((Join-Path $mixed 'foreign.txt'),'foreign')
  $blocked=$false;try{Initialize-B122OwnedInstallRoot -InstallRoot $mixed -ProtectedPaths @($PSScriptRoot)|Out-Null}catch{$blocked=$true};if(-not $blocked){throw 'A nonempty unowned install root was accepted.'}
  $sentinel=Join-Path $install '.sxsy-b122-install-root.json';$saved=[IO.File]::ReadAllBytes($sentinel);[IO.File]::WriteAllText($sentinel,'{}')
  $tamperBlocked=$false;try{Get-B122InstallOwnership -InstallRoot $install|Out-Null}catch{$tamperBlocked=$true};[IO.File]::WriteAllBytes($sentinel,$saved)
  if(-not $tamperBlocked){throw 'A tampered ownership sentinel was accepted.'}

  # The protected root inventory owns deletion. Unknown files are preserved and reported.
  Set-B122RootToolInventory -InstallRoot $install -RelativePaths @('B122InstallTools.psm1','Invoke-B122Current.ps1')|Out-Null
  $foreign=Join-Path $install 'foreign.txt';[IO.File]::WriteAllText($foreign,'foreign')
  $removal=Remove-B122OwnedInstallation -InstallRoot $install -PreserveRoot
  if(-not (Test-Path -LiteralPath $foreign -PathType Leaf) -or $removal.complete -ne $false -or @($removal.unownedPaths).Count -ne 1){throw "Manifest-only removal crossed into an unowned path: $($removal|ConvertTo-Json -Compress)"}

  # Every lifecycle phase is durable and an unfinished candidate is deterministically recovered.
  $recoverRoot=Join-Path $root 'recover';Initialize-B122OwnedInstallRoot -InstallRoot $recoverRoot -ProtectedPaths @($PSScriptRoot)|Out-Null
  $journal=Start-B122LifecycleOperation -InstallRoot $recoverRoot -Kind install -SourceCommit $first -BundleId ('a'*64) -PriorState $null
  foreach($phase in @('candidate_imported','candidate_started','candidate_healthy','extension_installed','autostart_configured')){$journal=Set-B122LifecyclePhase -InstallRoot $recoverRoot -OperationId $journal.operationId -Phase $phase -Effects ([ordered]@{candidatePid=1234})}
  $recovered=Repair-B122Lifecycle -InstallRoot $recoverRoot -StopCandidate { param($record) $true } -RestorePrior { param($record) $true }
  if($recovered.status -cne 'recovered' -or $null -ne (Get-B122LifecycleOperation -InstallRoot $recoverRoot)){throw 'Interrupted lifecycle recovery was not durable and deterministic.'}

  # Kill a separate installer process immediately after every durable phase
  # boundary, then prove the next invocation deterministically reconciles the
  # authenticated journal. This models power loss without killing the test
  # driver or any unrelated process.
  $killScript=Join-Path $root 'invoke-phase-and-pause.ps1'
  [IO.File]::WriteAllText($killScript,@'
param([string]$ModulePath,[string]$InstallRoot,[string]$OperationId,[string]$Phase,[string]$ReadyPath)
$ErrorActionPreference='Stop'
$env:SXSY_B122_TEST_MODE='1';$env:SXSY_B122_TEST_PAUSE_AFTER_PHASE=$Phase;$env:SXSY_B122_TEST_KILL_READY_PATH=$ReadyPath
Import-Module $ModulePath -Force
Set-B122LifecyclePhase -InstallRoot $InstallRoot -OperationId $OperationId -Phase $Phase -Effects ([ordered]@{killInjected=$true})|Out-Null
'@,(New-Object Text.UTF8Encoding($false)))
  $allDurablePhases=@('recovery_prepared','candidate_imported','root_module_installed','root_launcher_installed','root_tools_installed','candidate_started','candidate_healthy','extension_installed','autostart_configured','activated','stop_candidate','restoring_prior','recovery_required','uninstalling','completed')
  foreach($phase in $allDurablePhases){
    $killRoot=Join-Path $root ('kill-'+$phase);Initialize-B122OwnedInstallRoot -InstallRoot $killRoot -ProtectedPaths @($module,$PSScriptRoot)|Out-Null
    $killOperation=Start-B122LifecycleOperation -InstallRoot $killRoot -Kind install -SourceCommit $first -BundleId ('b'*64) -PriorState $null
    $ready=Join-Path $root ('ready-'+$phase+'.txt');if(Test-Path -LiteralPath $ready){Remove-Item -LiteralPath $ready -Force}
    $child=Start-Process -FilePath powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',"`"$killScript`"",'-ModulePath',"`"$module`"",'-InstallRoot',"`"$killRoot`"",'-OperationId',$killOperation.operationId,'-Phase',$phase,'-ReadyPath',"`"$ready`"") -WindowStyle Hidden -PassThru
    $killDeadline=[DateTime]::UtcNow.AddSeconds(30);do{Start-Sleep -Milliseconds 50;if($child.HasExited){throw "Lifecycle kill-injection child exited before the durable $phase marker."}}while(-not(Test-Path -LiteralPath $ready -PathType Leaf)-and[DateTime]::UtcNow-lt$killDeadline)
    if(-not(Test-Path -LiteralPath $ready -PathType Leaf)){Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue;throw "Lifecycle kill-injection marker was not durable for $phase."}
    Stop-Process -Id $child.Id -Force;$child.WaitForExit(5000)|Out-Null
    if(-not$child.HasExited){throw "Lifecycle kill-injection child survived termination for $phase."}
    $afterKill=Get-B122LifecycleOperation -InstallRoot $killRoot;if($afterKill.phase-cne$phase){throw "Lifecycle kill injection did not preserve the exact $phase boundary."}
    $killRecovery=Repair-B122Lifecycle -InstallRoot $killRoot -StopCandidate {param($record)$true} -RestorePrior {param($record)$true}
    $expectedRecovery=if($phase-ceq'completed'){'recovered_completed'}else{'recovered'}
    if($killRecovery.status-cne$expectedRecovery-or$null-ne(Get-B122LifecycleOperation -InstallRoot $killRoot)){throw "Lifecycle kill recovery failed at $phase."}
  }

  # Windows PowerShell 5 turns native stderr into NativeCommandError when the
  # caller uses ErrorActionPreference=Stop.  Exercise the exact exported
  # readiness helper with a native Node child that is unavailable twice (and
  # writes stderr) before it becomes ready.  A classified authentication or
  # integrity rejection must fail on the first probe instead of being retried.
  $healthRoot=Join-Path $root 'health probe with spaces';Initialize-B122OwnedStateRoot -StateRoot $healthRoot -ProtectedPaths @($module,$PSScriptRoot)|Out-Null
  $healthScript=Join-Path $healthRoot 'delayed-health.mjs';$healthCounter=Join-Path $healthRoot 'attempts.txt';$healthConfiguration=Join-Path $healthRoot 'authenticated-pipe.json'
  [IO.File]::WriteAllText($healthConfiguration,'{}',(New-Object Text.UTF8Encoding($false)))
  if(-not('SxsyB122HandleIsolationFixture'-as[type])){Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class SxsyB122HandleIsolationFixture {
  [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int Length; public IntPtr SecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle; }
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string path,uint access,uint share,ref SecurityAttributes security,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public static IntPtr Open(string path){var security=new SecurityAttributes{Length=Marshal.SizeOf(typeof(SecurityAttributes)),InheritHandle=true};var handle=CreateFileW(path,0x40000000,3,ref security,2,0x80,IntPtr.Zero);if(handle==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());return handle;}
}
'@}
  $unrelatedHandlePath=Join-Path $healthRoot 'unrelated-inheritable-handle.txt';$inheritedMarker=Join-Path $healthRoot 'unrelated-handle-was-visible.txt';$handleProbe=Join-Path $healthRoot 'probe-unrelated-handle.ps1'
  [IO.File]::WriteAllText($handleProbe,@'
param([string]$RawHandle,[string]$Marker)
$ErrorActionPreference='Stop'
try{
  $safe=New-Object Microsoft.Win32.SafeHandles.SafeFileHandle(([IntPtr]([Int64]$RawHandle)),$false)
  $stream=New-Object IO.FileStream($safe,[IO.FileAccess]::Write,1,$false)
  try{$bytes=[Text.Encoding]::UTF8.GetBytes('leaked');$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose();$safe.Dispose()}
  [IO.File]::WriteAllText($Marker,'leaked');exit 9
}catch{exit 0}
'@,(New-Object Text.UTF8Encoding($false)))
  $unrelatedHandle=[SxsyB122HandleIsolationFixture]::Open($unrelatedHandlePath)
  try{
    $handleProbeResult=Invoke-B122BoundedNativeProcess -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$handleProbe,'-RawHandle',[string]$unrelatedHandle.ToInt64(),'-Marker',$inheritedMarker) -StateRoot $healthRoot -TimeoutSeconds 15 -MaxOutputBytes 65536
  }finally{[void][SxsyB122HandleIsolationFixture]::CloseHandle($unrelatedHandle)}
  if($handleProbeResult.exitCode-ne0-or(Test-Path -LiteralPath $inheritedMarker)-or(Get-Item -LiteralPath $unrelatedHandlePath).Length-ne0-or@($handleProbeResult.survivors).Count){throw 'The bounded native launcher leaked an unrelated inheritable handle or left a process survivor.'}
  [IO.File]::WriteAllText($healthScript,@'
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const counter = process.env.SXSY_B122_HEALTH_COUNTER;
const rejected = process.env.SXSY_B122_HEALTH_REJECTED === "1";
const attempt = (existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0) + 1;
writeFileSync(counter, String(attempt), "utf8");
if (rejected) {
  process.stdout.write(JSON.stringify({ schema: "sxsy-b122.install-health-probe", version: 1, status: "rejected", retryable: false, reason: "integrity_or_authentication_failure" }) + "\n");
  process.exitCode = 3;
} else if (attempt < 3) {
  process.stderr.write("expected delayed readiness\n");
  process.stdout.write(JSON.stringify({ schema: "sxsy-b122.install-health-probe", version: 1, status: "unavailable", retryable: true, reason: "endpoint_unavailable" }) + "\n");
  process.exitCode = 2;
} else {
  process.stdout.write(JSON.stringify({ schema: "sxsy-b122.install-health-probe", version: 1, status: "ready", retryable: false, reason: "authenticated_ready" }) + "\n");
}
'@,(New-Object Text.UTF8Encoding($false)))
  $savedCounter=$env:SXSY_B122_HEALTH_COUNTER;$savedRejected=$env:SXSY_B122_HEALTH_REJECTED
  try{
    $env:SXSY_B122_HEALTH_COUNTER=$healthCounter;$env:SXSY_B122_HEALTH_REJECTED='0'
    $healthResult=Wait-B122CompanionHealth -NodePath (Get-Command node.exe -ErrorAction Stop).Source -HealthScript $healthScript -ConfigurationPath $healthConfiguration -TimeoutSeconds 5 -PollMilliseconds 25
    if($healthResult.status-cne'ready'-or[int](Get-Content -LiteralPath $healthCounter -Raw)-ne3){throw 'The PowerShell 5 health loop did not tolerate bounded delayed readiness.'}
    Remove-Item -LiteralPath $healthCounter -Force
    $env:SXSY_B122_HEALTH_REJECTED='1';$rejectedHealth=$false
    try{Wait-B122CompanionHealth -NodePath (Get-Command node.exe -ErrorAction Stop).Source -HealthScript $healthScript -ConfigurationPath $healthConfiguration -TimeoutSeconds 5 -PollMilliseconds 25|Out-Null}catch{$rejectedHealth=$_.Exception.Message-match'failed closed'}
  if(-not$rejectedHealth-or[int](Get-Content -LiteralPath $healthCounter -Raw)-ne1){throw 'The health loop retried a classified integrity/authentication rejection.'}
  }finally{$env:SXSY_B122_HEALTH_COUNTER=$savedCounter;$env:SXSY_B122_HEALTH_REJECTED=$savedRejected}

  # No caller-selected state directory may be read or changed until its
  # current-user ownership sentinel is authenticated, including the absent-PID
  # cleanup path.  Exercise both an unowned and a tampered owned root.
  foreach($stateCase in @('unowned','tampered')){
    $unsafeState=Join-Path $root ('unsafe-state-'+$stateCase);New-Item -ItemType Directory -Path $unsafeState|Out-Null
    if($stateCase-ceq'tampered'){
      Remove-Item -LiteralPath $unsafeState -Force
      Initialize-B122OwnedStateRoot -StateRoot $unsafeState -ProtectedPaths @($module,$PSScriptRoot)|Out-Null
      [IO.File]::WriteAllText((Join-Path $unsafeState '.sxsy-b122-state-root.json'),'{}',(New-Object Text.UTF8Encoding($false)))
    }
    $absentLease=[ordered]@{schema='sxsy-b122.companion-instance';version=1;nonce=[guid]::NewGuid().ToString('D');pid=2147483646;startedAt=(Get-Date).ToUniversalTime().ToString('o');mainPath='C:\owned\app\dist\apps\windows-companion\src\main.js';processPath='C:\owned\runtime\node.exe'}
    [IO.File]::WriteAllText((Join-Path $unsafeState 'companion-instance.json'),($absentLease|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $unsafeState 'companion-process-identity.json'),'preserve',(New-Object Text.UTF8Encoding($false)))
    $unsafeRejected=$false;try{Stop-B122InstalledCompanion -InstallRoot $install -StateRoot $unsafeState|Out-Null}catch{$unsafeRejected=$_.Exception.Message-match'ownership|state_ownership|DACL|owned root'}
    if(-not$unsafeRejected-or-not(Test-Path -LiteralPath (Join-Path $unsafeState 'companion-instance.json'))-or-not(Test-Path -LiteralPath (Join-Path $unsafeState 'companion-process-identity.json'))){throw "The $stateCase state-root absent-PID path changed unauthenticated files."}
  }

  # Real bounded fallback: a DPAPI-authenticated exact process plus its child
  # tree must be gone even when the mutable graceful-health script is absent.
  $shutdownBundle=Join-Path $root 'bundle with spaces';$shutdownInstall=Join-Path $root 'installed product with spaces';$shutdownState=Join-Path $root 'state with spaces';$shutdownCommit='3'*40
  $shutdownMainSource=Join-Path $shutdownBundle 'app\dist\apps\windows-companion\src\main.js';$shutdownNodeSource=Join-Path $shutdownBundle 'runtime\node.exe'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $shutdownMainSource),(Split-Path -Parent $shutdownNodeSource)|Out-Null
  Copy-Item -LiteralPath (Get-Command node.exe -ErrorAction Stop).Source -Destination $shutdownNodeSource
  [IO.File]::WriteAllText((Join-Path $shutdownBundle 'app\package.json'),'{"type":"commonjs"}',(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($shutdownMainSource,"const{spawn}=require('node:child_process');const{writeFileSync}=require('node:fs');const{join}=require('node:path');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(join(process.argv[3],'child.pid'),String(c.pid));setInterval(()=>{},1000);",(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText((Join-Path $shutdownBundle 'release.json'),([ordered]@{schema='sxsy-b122.windows-release';version=1;sourceCommit=$shutdownCommit}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
  Initialize-B122OwnedInstallRoot -InstallRoot $shutdownInstall -ProtectedPaths @($shutdownBundle,$PSScriptRoot)|Out-Null
  Initialize-B122OwnedStateRoot -StateRoot $shutdownState -ProtectedPaths @($shutdownBundle,$PSScriptRoot,$shutdownInstall)|Out-Null
  Bind-B122InstallStateRoot -InstallRoot $shutdownInstall -StateRoot $shutdownState|Out-Null
  $shutdownVersion=Import-B122ValidatedBundle -BundleRoot $shutdownBundle -InstallRoot $shutdownInstall
  Set-B122CurrentVersion -InstallRoot $shutdownInstall -VersionId $shutdownCommit|Out-Null
  $installedNode=Join-Path $shutdownVersion 'runtime\node.exe';$installedMain=Join-Path $shutdownVersion 'app\dist\apps\windows-companion\src\main.js';$childPidPath=Join-Path $shutdownState 'child.pid';$shutdownProcess=$null
  try{
    $shutdownProcess=Start-Process -FilePath $installedNode -ArgumentList @("`"$installedMain`"",'--isolated-test-state-directory',"`"$shutdownState`"") -WorkingDirectory $shutdownVersion -WindowStyle Hidden -PassThru
    $deadline=[DateTime]::UtcNow.AddSeconds(15);do{Start-Sleep -Milliseconds 100}while((-not(Test-Path -LiteralPath $childPidPath -PathType Leaf) -or $null -eq (Get-CimInstance Win32_Process -Filter "ProcessId = $($shutdownProcess.Id)" -ErrorAction SilentlyContinue))-and [DateTime]::UtcNow -lt $deadline)
    if(-not(Test-Path -LiteralPath $childPidPath -PathType Leaf)){throw 'The shutdown fixture did not create its child process.'}
    $childPid=[int](Get-Content -LiteralPath $childPidPath -Raw);$observed=Get-CimInstance Win32_Process -Filter "ProcessId = $($shutdownProcess.Id)"
    $created=if($observed.CreationDate -is [DateTime]){[DateTime]$observed.CreationDate}else{[Management.ManagementDateTimeConverter]::ToDateTime([string]$observed.CreationDate)};$creationFileTime=[SxsyB122V2.NativeCommandLine]::GetCreationFileTimeUtc([int]$observed.ProcessId);$nonce=[guid]::NewGuid().ToString('D')
    $lease=[ordered]@{schema='sxsy-b122.companion-instance';version=1;nonce=$nonce;pid=[int]$observed.ProcessId;startedAt=$created.ToUniversalTime().ToString('o');mainPath=$installedMain;processPath=[string]$observed.ExecutablePath}
    [IO.File]::WriteAllText((Join-Path $shutdownState 'companion-instance.json'),($lease|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
    $identity=[ordered]@{schema='sxsy-b122.companion-process-identity';version=1;nonce=$nonce;stateDirectory=[IO.Path]::GetFullPath($shutdownState);pid=[int]$observed.ProcessId;creationFileTimeUtc=$creationFileTime;executablePath=[string]$observed.ExecutablePath;executableSha256=(Get-FileHash -LiteralPath $installedNode -Algorithm SHA256).Hash.ToLowerInvariant();mainPath=[IO.Path]::GetFullPath($installedMain);mainSha256=(Get-FileHash -LiteralPath $installedMain -Algorithm SHA256).Hash.ToLowerInvariant();arguments=@([IO.Path]::GetFullPath($installedMain),'--isolated-test-state-directory',[IO.Path]::GetFullPath($shutdownState));parentProcessId=[int]$observed.ParentProcessId;sessionId=[int]$observed.SessionId}
    $clear=[Text.Encoding]::UTF8.GetBytes(($identity|ConvertTo-Json -Compress));$sealed=[Security.Cryptography.ProtectedData]::Protect($clear,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $envelope=[ordered]@{schema='sxsy-b122.dpapi-companion-process-identity';version=1;protector='windows-dpapi-current-user';sealed=[Convert]::ToBase64String($sealed)}
    [IO.File]::WriteAllText((Join-Path $shutdownState 'companion-process-identity.json'),($envelope|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
    $observedAgain=Get-CimInstance Win32_Process -Filter "ProcessId = $($shutdownProcess.Id)"
    if([int]$observedAgain.ProcessId -ne [int]$identity.pid -or [int]$observedAgain.ParentProcessId -ne [int]$identity.parentProcessId -or [int]$observedAgain.SessionId -ne [int]$identity.sessionId -or -not([IO.Path]::GetFullPath([string]$observedAgain.ExecutablePath).Equals([IO.Path]::GetFullPath([string]$identity.executablePath),[StringComparison]::OrdinalIgnoreCase)) -or [SxsyB122V2.NativeCommandLine]::GetCreationFileTimeUtc([int]$observedAgain.ProcessId) -cne [string]$identity.creationFileTimeUtc){throw 'The shutdown fixture process identity drifted before termination.'}
    $expectedCommand=[string[]](@([string]$identity.executablePath)+@($identity.arguments|ForEach-Object{[string]$_}));if(-not[SxsyB122V2.NativeCommandLine]::Matches([string]$observedAgain.CommandLine,$expectedCommand)){$parsed=[SxsyB122V2.NativeCommandLine]::Parse([string]$observedAgain.CommandLine);throw "The shutdown fixture command line differs. actual=$($parsed -join '<ARG>') expected=$($expectedCommand -join '<ARG>')"}
    $shutdown=Stop-B122InstalledCompanion -InstallRoot $shutdownInstall -StateRoot $shutdownState -GracefulTimeoutSeconds 0 -ForceTimeoutSeconds 10
    if($shutdown.status -cne 'stopped' -or $shutdown.forced -ne $true -or @($shutdown.survivors).Count -ne 0 -or $null -ne (Get-CimInstance Win32_Process -Filter "ProcessId = $($shutdownProcess.Id)" -ErrorAction SilentlyContinue) -or $null -ne (Get-CimInstance Win32_Process -Filter "ProcessId = $childPid" -ErrorAction SilentlyContinue)){throw 'Bounded companion fallback did not prove the exact process tree absent.'}
  }finally{if($null -ne $shutdownProcess -and $null -ne (Get-CimInstance Win32_Process -Filter "ProcessId = $($shutdownProcess.Id)" -ErrorAction SilentlyContinue)){& (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID ([string]$shutdownProcess.Id) /T /F *> $null;$cleanupDeadline=[DateTime]::UtcNow.AddSeconds(10);do{Start-Sleep -Milliseconds 100}while($null -ne (Get-CimInstance Win32_Process -Filter "ProcessId = $($shutdownProcess.Id)" -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $cleanupDeadline)}}

  [ordered]@{schema='sxsy-b122.install-lifecycle-test';version=2;status='passed';atomicPointer=$true;rollback=$true;activationFailureInjection=$true;rootToolRollback=$true;firstInstallCleanup=$true;interruptionRecovery=$true;pathContainment=$true;authenticatedOwnership=$true;unauthenticatedStateMutationRejected=$true;bundleCollisionRejected=$true;manifestOnlyRemoval=$true;nestedUnmanifestedRetry=$true;reparseTraversalRejected=$true;durablePhaseRecovery=$true;powerKillEveryPhase=$true;phaseKillChildSurvivors=0;powerShell5DelayedReadiness=$true;healthIntegrityFailureRetryCount=0;authenticatedExactShutdown=$true;processTreeNoSurvivors=$true;nativeLauncherJobBound=$true;unrelatedHandleInherited=$false}|ConvertTo-Json -Compress
} finally { if(Test-Path -LiteralPath $root){try{Remove-Item -LiteralPath $root -Recurse -Force}catch{Write-Warning "Lifecycle fixture cleanup retained bytes after the asserted shutdown path: $($_.Exception.Message)"}} }
