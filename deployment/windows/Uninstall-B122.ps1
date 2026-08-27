[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
param(
  [string]$InstallRoot,
  [string]$StateRoot,
  [switch]$KeepVsCodeExtension,
  [switch]$PurgeState,
  [string]$ConfirmStateRoot,
  [string]$PurgeConfirmation
)
$ErrorActionPreference='Stop'
$root=if($InstallRoot){[IO.Path]::GetFullPath($InstallRoot)}else{Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard\install'}
$state=if($StateRoot){[IO.Path]::GetFullPath($StateRoot)}else{Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard'}
$modulePath=Join-Path $PSScriptRoot 'B122InstallTools.psm1';Import-Module $modulePath -Force
function Get-RecoveryPath([string]$CanonicalStateRoot){
  $hasher=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($CanonicalStateRoot.ToLowerInvariant())))).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose()}
  return Join-Path (Split-Path -Parent $CanonicalStateRoot) ('.sxsy-b122-'+$digest+'-recovery.json')
}
# Purge authority is a separate destructive decision and must be exact before
# stopping a process, changing autostart/VSIX state, or removing one product
# byte.  The later purge function repeats these checks at effect time.
if($PurgeState){
  $preflightExternal=Read-B122ExternalRecoveryRecord -Path (Get-RecoveryPath $state)
  if(Test-Path -LiteralPath $state){
    # A live authenticated generation is authoritative.  A completed record
    # from a prior purge/reinstall cycle must never supply the confirmation
    # phrase for this newer state root.
    $preflightStateId=[string](Get-B122StateOwnership -StateRoot $state).rootId
  }elseif($null-ne$preflightExternal-and[IO.Path]::GetFullPath([string]$preflightExternal.canonicalStateRoot).Equals($state,[StringComparison]::OrdinalIgnoreCase)-and[bool]$preflightExternal.purgeState){
    $preflightStateId=[string]$preflightExternal.stateRootId
  }else{throw 'Protected state purge has no authenticated live generation or exact recovery record.'}
  $confirmed=if($ConfirmStateRoot){[IO.Path]::GetFullPath($ConfirmStateRoot)}else{''};$expectedPhrase="PURGE SXSY-B122 STATE $preflightStateId"
  if(-not$confirmed.Equals($state,[StringComparison]::OrdinalIgnoreCase)-or$PurgeConfirmation-cne$expectedPhrase){throw "Protected state purge was refused before any product effect. Supply -ConfirmStateRoot with the exact canonical state root and -PurgeConfirmation '$expectedPhrase'."}
  if(-not$PSCmdlet.ShouldProcess($state,'Permanently purge only the exact authenticated SXSY-B122 state generation')){return}
}
if(-not$PSCmdlet.ShouldProcess($root,'Stop and remove only authenticated manifest-owned SXSY-B122 product bytes')){return}
$lifecycleLock=Enter-B122LifecycleLock -InstallRoot $root
try{
  function Assert-Options($record){
    if(-not([IO.Path]::GetFullPath([string]$record.canonicalInstallRoot).Equals($root,[StringComparison]::OrdinalIgnoreCase))-or-not([IO.Path]::GetFullPath([string]$record.canonicalStateRoot).Equals($state,[StringComparison]::OrdinalIgnoreCase))-or[bool]$record.keepVsCode-ne[bool]$KeepVsCodeExtension-or[bool]$record.purgeState-ne[bool]$PurgeState-or[string]$record.extensionIdentity-cnotmatch'^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9][A-Za-z0-9.-]*@[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$'-or[string]$record.extensionVsixSha256-cnotmatch'^[a-f0-9]{64}$'){throw 'The resumed uninstall arguments do not match the authenticated original disposition.'}
    $capsuleProperty=$record.PSObject.Properties['recoveryCapsule']
    if($record.schema-ceq'sxsy-b122.uninstall-external-recovery'-and$null-eq$capsuleProperty){throw 'The external uninstall recovery record has no independently durable recovery capsule.'}
    if($null-ne$capsuleProperty){Assert-B122UninstallRecoveryCapsule -StateRoot $state -StateRootId ([string]$record.stateRootId) -InstallRootId ([string]$record.installRootId) -Capsule $capsuleProperty.Value|Out-Null}
  }
  function Remove-ProtectedStateTree($record){
    Assert-Options $record
    $expectedPhrase="PURGE SXSY-B122 STATE $($record.stateRootId)";$confirmed=if($ConfirmStateRoot){[IO.Path]::GetFullPath($ConfirmStateRoot)}else{''}
    if(-not$confirmed.Equals($state,[StringComparison]::OrdinalIgnoreCase)-or$PurgeConfirmation-cne$expectedPhrase){throw "Protected state was preserved. Purge retry requires -ConfirmStateRoot with the exact canonical state root and -PurgeConfirmation '$expectedPhrase'."}
    if([string]$record.stateFileIdentity-cnotmatch'^[a-f0-9]{8}:[a-f0-9]{16}$'){throw 'Protected state purge is missing its immutable filesystem generation identity.'}
    if(-not(Test-Path -LiteralPath $state)){return}
    $stateItem=Get-Item -LiteralPath $state -Force;if(-not$stateItem.PSIsContainer-or($stateItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-or(Get-B122FileSystemIdentity -Path $state)-cne[string]$record.stateFileIdentity){throw 'Protected state purge refused a replaced or non-concrete state root.'}
    $stateSentinel=Join-Path $state '.sxsy-b122-state-root.json'
    if(Test-Path -LiteralPath $stateSentinel -PathType Leaf){$liveOwnership=Get-B122StateOwnership -StateRoot $state;if([string]$liveOwnership.rootId-cne[string]$record.stateRootId){throw 'Protected state purge refused a different authenticated state generation.'}}
    $allowed=@('.sxsy-b122-state-root.json','authenticated-pipe.json','checkpoints','companion-instance.json','companion-process-identity.json','council-isolation','git-locks','git-operations','install','lifecycle-receipts','logs','network-policy.json','protected-audit.jsonl','provider-desktop-paths.json','provider-host','receipt-evidence-key.json','repository-supervisors','sandboxes','scanner-fixtures','shutdown-recovery.json','supervisor-temp','voice-transcripts','windows-sandbox')
    $files=New-Object Collections.Generic.List[string];$directories=New-Object Collections.Generic.List[string];$directoryIdentities=New-Object 'Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase);$fileIdentities=New-Object 'Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase);$queue=New-Object Collections.Generic.Queue[string];$queue.Enqueue($state)
    while($queue.Count){
      $directory=[IO.Path]::GetFullPath($queue.Dequeue());$directoryItem=Get-Item -LiteralPath $directory -Force
      if(-not$directoryItem.PSIsContainer-or($directoryItem.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'Protected state was preserved because an inventoried directory is not concrete.'}
      $directoryIdentities[$directory]=Get-B122FileSystemIdentity -Path $directory;$directories.Add($directory)
      foreach($entry in @(Get-ChildItem -LiteralPath $directory -Force|Sort-Object Name)){
        $relative=$entry.FullName.Substring($state.TrimEnd('\').Length+1).Replace('\','/');if($directory.Equals($state,[StringComparison]::OrdinalIgnoreCase)-and$entry.Name-notin$allowed){throw "Protected state was preserved because it contains unknown content: $relative"};if(($entry.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw "Protected state was preserved because it contains reparse content: $relative"}
        if($entry.PSIsContainer){$queue.Enqueue($entry.FullName)}else{$fullFile=[IO.Path]::GetFullPath($entry.FullName);$fileIdentities[$fullFile]=Get-B122FileSystemIdentity -Path $fullFile;$files.Add($fullFile)}
      }
    }
    function Assert-StatePurgeGeneration([string]$Path,[switch]$Directory){
      $full=[IO.Path]::GetFullPath($Path);Assert-B122ChildPath -Parent $state -Child $full|Out-Null;$cursor=if($Directory){$full}else{Split-Path -Parent $full}
      while($true){
        if(-not$directoryIdentities.ContainsKey($cursor)){throw 'Protected state ancestor identity changed during purge.'}
        try{$currentIdentity=Get-B122FileSystemIdentity -Path $cursor}catch{throw 'Protected state ancestor identity changed during purge.'}
        $currentItem=Get-Item -LiteralPath $cursor -Force
        if(-not$currentItem.PSIsContainer-or($currentItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$currentIdentity-cne[string]$directoryIdentities[$cursor]){throw 'Protected state ancestor identity changed during purge.'}
        if($cursor.Equals($state,[StringComparison]::OrdinalIgnoreCase)){break};$cursor=Split-Path -Parent $cursor
      }
      if(-not$Directory){
        if(-not$fileIdentities.ContainsKey($full)){throw 'Protected state file identity changed during purge.'}
        try{$currentFileIdentity=Get-B122FileSystemIdentity -Path $full}catch{throw 'Protected state file identity changed during purge.'}
        $currentFile=Get-Item -LiteralPath $full -Force
        if($currentFile.PSIsContainer-or($currentFile.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$currentFileIdentity-cne[string]$fileIdentities[$full]){throw 'Protected state file identity changed during purge.'}
      }
    }
    if($env:SXSY_B122_TEST_MODE-ceq'1'-and-not[string]::IsNullOrWhiteSpace($env:SXSY_B122_TEST_SWAP_STATE_PARENT)){
      $relativeSwap=[string]$env:SXSY_B122_TEST_SWAP_STATE_PARENT;if([IO.Path]::IsPathRooted($relativeSwap)-or$relativeSwap-match'(^|[\\/])\.\.([\\/]|$)'){throw 'The state-parent swap test hook is invalid.'}
      $swapPath=[IO.Path]::GetFullPath((Join-Path $state $relativeSwap));Assert-B122ChildPath -Parent $state -Child $swapPath|Out-Null;$swapOriginal=$swapPath+'.b122-test-original';$swapTarget=[IO.Path]::GetFullPath([string]$env:SXSY_B122_TEST_SWAP_STATE_TARGET)
      if(Test-Path -LiteralPath $swapOriginal){throw 'The state-parent swap test backup already exists.'};[IO.Directory]::Move($swapPath,$swapOriginal);New-Item -ItemType Junction -Path $swapPath -Target $swapTarget|Out-Null
    }
    $sentinel=Join-Path $state '.sxsy-b122-state-root.json';$deleted=0
    foreach($file in @($files|Where-Object{-not$_.Equals($sentinel,[StringComparison]::OrdinalIgnoreCase)}|Sort-Object Length -Descending)+@($files|Where-Object{$_.Equals($sentinel,[StringComparison]::OrdinalIgnoreCase)})){
      if((Get-B122FileSystemIdentity -Path $state)-cne[string]$record.stateFileIdentity){throw 'Protected state filesystem identity changed during purge.'}
      Assert-StatePurgeGeneration -Path $file
      Remove-Item -LiteralPath $file -Force;if(Test-Path -LiteralPath $file){throw 'Protected state file survived its exact purge effect.'};$deleted++;if($env:SXSY_B122_TEST_MODE-ceq'1'-and[int]$env:SXSY_B122_TEST_FAIL_AFTER_STATE_DELETE_COUNT-eq$deleted){throw "Injected protected-state purge interruption after $deleted deletions."}
    }
    foreach($directory in @($directories|Sort-Object Length -Descending)){if($directory.Equals($state,[StringComparison]::OrdinalIgnoreCase)){continue};if(Test-Path -LiteralPath $directory -PathType Container){Assert-StatePurgeGeneration -Path $directory -Directory;if(@(Get-ChildItem -LiteralPath $directory -Force).Count-eq0){Remove-Item -LiteralPath $directory -Force;if(Test-Path -LiteralPath $directory){throw 'Protected state directory survived its exact purge effect.'}}}}
    if((Get-B122FileSystemIdentity -Path $state)-cne[string]$record.stateFileIdentity){throw 'Protected state filesystem identity changed during purge.'}
    if(@(Get-ChildItem -LiteralPath $state -Force).Count-eq0){Remove-Item -LiteralPath $state -Force}
    if(Test-Path -LiteralPath $state){throw 'Protected state purge could not prove deletion.'}
  }
  function Write-Progress($record){Write-B122OperationReceipt -StateRoot $state -Name 'uninstall-progress.json' -Payload $record|Out-Null}
  function Ensure-RecoveryCapsule($record){
    $property=$record.PSObject.Properties['recoveryCapsule']
    if($null-eq$property){
      $capsule=New-B122UninstallRecoveryCapsule -StateRoot $state -ExpectedStateRootId ([string]$record.stateRootId) -InstallRootId ([string]$record.installRootId) -EntryPointSource $PSCommandPath -ModuleSource $modulePath
      $record|Add-Member -NotePropertyName recoveryCapsule -NotePropertyValue $capsule -Force;Write-Progress $record
    }else{Assert-B122UninstallRecoveryCapsule -StateRoot $state -StateRootId ([string]$record.stateRootId) -InstallRootId ([string]$record.installRootId) -Capsule $property.Value|Out-Null}
    return $record.recoveryCapsule
  }
  function New-ExternalRecord($record,[string]$Status='removing_product'){
    Ensure-RecoveryCapsule $record|Out-Null
    return [ordered]@{schema='sxsy-b122.uninstall-external-recovery';version=1;status=$Status;canonicalInstallRoot=$root;installRootId=[string]$record.installRootId;installFileIdentity=[string]$record.installFileIdentity;canonicalStateRoot=$state;stateRootId=[string]$record.stateRootId;stateFileIdentity=[string]$record.stateFileIdentity;sourceCommit=[string]$record.sourceCommit;bundleId=[string]$record.bundleId;keepVsCode=[bool]$record.keepVsCode;purgeState=[bool]$record.purgeState;extensionIdentity=[string]$record.extensionIdentity;extensionVsixSha256=[string]$record.extensionVsixSha256;extensionRemoved=[bool]$record.extensionRemoved;extensionAbsenceVerified=[bool]$record.extensionAbsenceVerified;shutdown=$record.shutdown;providerHostShutdown=$record.providerHostShutdown;recoveryCapsule=$record.recoveryCapsule;createdAt=if($record.createdAt){[string]$record.createdAt}else{(Get-Date).ToUniversalTime().ToString('o')};updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  }
  function Publish-RemovingProductRecovery($record){
    $external=New-ExternalRecord $record 'removing_product';Write-B122ExternalRecoveryRecord -Path (Get-RecoveryPath $state) -Payload $external|Out-Null;return $external
  }
  function Finish-ProductRemoval($record){
    Assert-Options $record
    if([string]$record.installFileIdentity-cnotmatch'^[a-f0-9]{8}:[a-f0-9]{16}$'-or[string]$record.stateFileIdentity-cnotmatch'^[a-f0-9]{8}:[a-f0-9]{16}$'){throw 'The uninstall recovery record is missing immutable filesystem generation identities.'}
    $externalPath=Get-RecoveryPath $state
    $external=Publish-RemovingProductRecovery $record
    Write-B122ExternalRecoveryRecord -Path $externalPath -Payload $external|Out-Null
    if(Test-Path -LiteralPath $root){Complete-B122OwnedRootFinalization -InstallRoot $root -ExpectedRootId ([string]$record.installRootId) -ExpectedFileIdentity ([string]$record.installFileIdentity)|Out-Null}
    if(Test-Path -LiteralPath $root){throw 'B122 uninstall could not prove product-root deletion.'}
    if(Test-Path -LiteralPath $state){Release-B122InstallStateRootBinding -InstallRoot $root -StateRoot $state -ExpectedInstallRootId ([string]$record.installRootId)|Out-Null}
    $external.status='product_removed';$external.updatedAt=(Get-Date).ToUniversalTime().ToString('o');Write-B122ExternalRecoveryRecord -Path $externalPath -Payload $external|Out-Null
    $result=[ordered]@{schema='sxsy-b122.uninstall-result';version=2;status='uninstalled';sourceCommit=[string]$record.sourceCommit;bundleId=[string]$record.bundleId;extensionRemoved=[bool]$record.extensionRemoved;extensionAbsenceVerified=[bool]$record.extensionAbsenceVerified;statePreserved=$true;productRootRemoved=$true;unownedPaths=@();retainedChangedPaths=@();shutdown=$record.shutdown;providerHostShutdown=$record.providerHostShutdown}
    if($PurgeState){
      $external.status='purging';$external.updatedAt=(Get-Date).ToUniversalTime().ToString('o');Write-B122ExternalRecoveryRecord -Path $externalPath -Payload $external|Out-Null;Remove-ProtectedStateTree $external
      $external.status='completed';$external.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$external|Add-Member -NotePropertyName completedAt -NotePropertyValue $external.updatedAt -Force;Write-B122ExternalRecoveryRecord -Path $externalPath -Payload $external|Out-Null
      $result.statePreserved=$false;$result.purgeTombstone=$externalPath
    }else{$external.status='completed';$external.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$external|Add-Member -NotePropertyName completedAt -NotePropertyValue $external.updatedAt -Force;Write-B122ExternalRecoveryRecord -Path $externalPath -Payload $external|Out-Null;$result.receiptPath=Write-B122OperationReceipt -StateRoot $state -Name 'uninstall-complete.json' -Payload $result}
    return $result
  }

  $externalPath=Get-RecoveryPath $state;$external=Read-B122ExternalRecoveryRecord -Path $externalPath
  if($null-ne$external){
    if($external.schema-cne'sxsy-b122.uninstall-external-recovery'-or$external.version-ne1-or$external.status-cnotin@('removing_product','product_removed','purging','completed')){throw 'The authenticated external uninstall recovery record is invalid.'}
    $liveInstall=$null
    if(Test-Path -LiteralPath $root){
      $ownershipPath=Join-Path $root '.sxsy-b122-install-root.json'
      if(Test-Path -LiteralPath $ownershipPath -PathType Leaf){$liveInstall=Get-B122InstallOwnership -InstallRoot $root;if([string]$liveInstall.rootId-cne[string]$external.installRootId){$external=$null}}
      elseif($external.status-cne'removing_product'){throw 'A product root reappeared after the authenticated uninstall generation was removed.'}
    }
    if($null-ne$external){
      Assert-Options $external
      if(Test-Path -LiteralPath $root){if((Get-B122FileSystemIdentity -Path $root)-cne[string]$external.installFileIdentity){throw 'The uninstall recovery record refused a replaced product-root generation.'}}
      if($external.status-ceq'removing_product'){
        if(Test-Path -LiteralPath $root){
          $ownershipPath=Join-Path $root '.sxsy-b122-install-root.json';$manifestPath=Join-Path $root '.sxsy-b122-root-manifest.json'
          if((Test-Path -LiteralPath $ownershipPath -PathType Leaf)-and(Test-Path -LiteralPath $manifestPath -PathType Leaf)){
            $resumedRemoval=Remove-B122OwnedInstallation -InstallRoot $root -PreserveLifecycleMetadata
            if(-not$resumedRemoval.complete){throw 'B122 uninstall recovery preserved unowned or changed product bytes.'}
          }
          Complete-B122OwnedRootFinalization -InstallRoot $root -ExpectedRootId ([string]$external.installRootId) -ExpectedFileIdentity ([string]$external.installFileIdentity)|Out-Null
        }
        if(Test-Path -LiteralPath $root){throw 'B122 uninstall recovery could not prove product-root deletion.'}
        if(Test-Path -LiteralPath $state){Release-B122InstallStateRootBinding -InstallRoot $root -StateRoot $state -ExpectedInstallRootId ([string]$external.installRootId)|Out-Null}
        $external.status='product_removed';$external.updatedAt=(Get-Date).ToUniversalTime().ToString('o');Write-B122ExternalRecoveryRecord -Path $externalPath -Payload $external|Out-Null
      }
      if($external.status-ceq'product_removed'){
        if([bool]$external.purgeState){$external.status='purging';$external.updatedAt=(Get-Date).ToUniversalTime().ToString('o');Write-B122ExternalRecoveryRecord -Path $externalPath -Payload $external|Out-Null}
        else{$external.status='completed';$external.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$external|Add-Member -NotePropertyName completedAt -NotePropertyValue $external.updatedAt -Force;Write-B122ExternalRecoveryRecord -Path $externalPath -Payload $external|Out-Null}
      }
      if($external.status-ceq'purging'){Remove-ProtectedStateTree $external;$external.status='completed';$external.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$external|Add-Member -NotePropertyName completedAt -NotePropertyValue $external.updatedAt -Force;Write-B122ExternalRecoveryRecord -Path $externalPath -Payload $external|Out-Null}
      if(Test-Path -LiteralPath $root){throw 'A completed uninstall recovery record still has its authenticated product generation.'}
      if([bool]$external.purgeState-and(Test-Path -LiteralPath $state)){
        $liveState=Get-B122StateOwnership -StateRoot $state
        if([string]$liveState.rootId-cne[string]$external.stateRootId-or(Get-B122FileSystemIdentity -Path $state)-cne[string]$external.stateFileIdentity){throw 'A stale completed uninstall tombstone cannot act on a different state generation.'}
        throw 'A completed purge tombstone still has its authenticated state generation.'
      }
      $resumed=[ordered]@{schema='sxsy-b122.uninstall-result';version=2;status='uninstalled';sourceCommit=[string]$external.sourceCommit;bundleId=[string]$external.bundleId;extensionRemoved=[bool]$external.extensionRemoved;extensionAbsenceVerified=[bool]$external.extensionAbsenceVerified;statePreserved=(-not[bool]$external.purgeState);productRootRemoved=$true;unownedPaths=@();retainedChangedPaths=@();purgeTombstone=$externalPath}
      $resumed|ConvertTo-Json -Depth 8 -Compress;return
    }
  }

  $stateOwnership=Get-B122StateOwnership -StateRoot $state;$ownership=Get-B122InstallOwnership -InstallRoot $root;Assert-B122InstallStateRootBinding -InstallRoot $root -StateRoot $state|Out-Null
  $progress=Read-B122OperationReceipt -StateRoot $state -Name 'uninstall-progress.json'
  if($null-ne$progress-and($progress.schema-cne'sxsy-b122.uninstall-progress'-or$progress.version-ne1)){throw 'The authenticated uninstall progress record is invalid.'}
  if($null-ne$progress-and[string]$progress.installRootId-cne[string]$ownership.rootId){$progress=$null}
  $pending=Get-B122LifecycleOperation -InstallRoot $root;$before=if($null-ne$pending-and$pending.kind-ceq'uninstall'){$pending.priorState}else{Get-B122InstallState -InstallRoot $root}
  if($null-eq$before){throw 'SXSY-B122 is not installed.'}
  if($null-ne$pending-and$pending.kind-cne'uninstall'){$launcher=Join-Path $root 'Invoke-B122Current.ps1';Assert-B122RootTools -InstallRoot $root|Out-Null;& $launcher -InstallRoot $root -StateRoot $state|Out-Null;$pending=$null;$before=Get-B122InstallState -InstallRoot $root}
  $extensionId='SquirmyWormy275.strathex-switchyard-b122'
  if($null-ne$pending-and$null-ne$pending.effects.PSObject.Properties['extensionIdentity']){
    $extensionIdentity=[string]$pending.effects.extensionIdentity;$extensionVsixSha256=[string]$pending.effects.extensionVsixSha256
  }else{
    $currentBundle=Join-Path (Join-Path $root 'versions') ([string]$before.current);$currentReleasePath=Join-Path $currentBundle 'release.json';$currentVsixPath=Join-Path $currentBundle 'extension\sxsy-b122-switchyard.vsix'
    Assert-B122InstalledPayloadFile -InstallRoot $root -Path $currentReleasePath|Out-Null;Assert-B122InstalledPayloadFile -InstallRoot $root -Path $currentVsixPath|Out-Null
    $currentRelease=Get-Content -LiteralPath $currentReleasePath -Raw|ConvertFrom-Json;$extensionIdentity=$extensionId+'@'+[string]$currentRelease.vscodeExtension;$extensionVsixSha256=(Get-FileHash -LiteralPath $currentVsixPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $code=$null
  function Invoke-B122UninstallCodeCli([string[]]$Arguments){if($null-eq$code){throw 'VS Code CLI is unavailable.'};Assert-B122VsCodeCliIdentity -Cli $code|Out-Null;$savedDev=$env:VSCODE_DEV;$savedElectron=$env:ELECTRON_RUN_AS_NODE;try{$env:VSCODE_DEV=$null;$env:ELECTRON_RUN_AS_NODE='1';return Invoke-B122BoundedNativeProcess -FilePath $code.executable -Arguments (@([string]$code.cliScript)+$Arguments) -StateRoot $state -TimeoutSeconds 45 -MaxOutputBytes 1048576}finally{$env:VSCODE_DEV=$savedDev;$env:ELECTRON_RUN_AS_NODE=$savedElectron}}
  function Get-B122UninstallExtensionInventory {
    $inventory=Invoke-B122UninstallCodeCli @('--list-extensions','--show-versions');if($inventory.exitCode-ne0){throw 'VS Code extension inventory returned a failure exit code.'}
    $matches=New-Object Collections.Generic.List[string];foreach($raw in @([string]$inventory.stdout-split'\r?\n')){$line=[string]$raw;if([string]::IsNullOrWhiteSpace($line)){continue};$separator=$line.LastIndexOf('@');if($separator-lt1){if($line.Equals($extensionId,[StringComparison]::OrdinalIgnoreCase)){throw 'VS Code returned the managed extension without an exact version.'};continue};if($line.Substring(0,$separator).Equals($extensionId,[StringComparison]::OrdinalIgnoreCase)){$matches.Add($line)}}
    if($matches.Count-gt1){throw 'VS Code returned ambiguous managed-extension identities.'};return @($matches)
  }
  if(-not$KeepVsCodeExtension-and($null-eq$pending-or$pending.phase-cnotin@('extension_removed','owned_payload_removed'))){
    $code=Resolve-B122VsCodeCli;if($null-eq$code){throw 'VS Code CLI is unavailable; extension absence cannot be proven. Re-run with -KeepVsCodeExtension only if that was the original disposition.'}
    $preflightExtensions=@(Get-B122UninstallExtensionInventory);if($preflightExtensions.Count-and-not([string]$preflightExtensions[0]).Equals($extensionIdentity,[StringComparison]::OrdinalIgnoreCase)){throw 'The installed B122 VS Code extension was replaced or changed; uninstall preserved it and refused all product effects.'}
  }
  $installFileIdentity=Get-B122FileSystemIdentity -Path $root;$stateFileIdentity=Get-B122FileSystemIdentity -Path $state
  $effects=[ordered]@{keepVsCode=[bool]$KeepVsCodeExtension;purgeState=[bool]$PurgeState;canonicalStateRoot=$state;stateRootId=[string]$stateOwnership.rootId;installFileIdentity=$installFileIdentity;stateFileIdentity=$stateFileIdentity;extensionIdentity=$extensionIdentity;extensionVsixSha256=$extensionVsixSha256}
  if($null-eq$pending){$pending=Start-B122LifecycleOperation -InstallRoot $root -Kind uninstall -SourceCommit ([string]$before.current) -BundleId ([string]$before.currentBundleId) -PriorState $before -InitialEffects $effects}
  else{if($pending.sourceCommit-cne$before.current-or$pending.bundleId-cne$before.currentBundleId-or[bool]$pending.effects.keepVsCode-ne[bool]$KeepVsCodeExtension-or[bool]$pending.effects.purgeState-ne[bool]$PurgeState-or-not([IO.Path]::GetFullPath([string]$pending.effects.canonicalStateRoot).Equals($state,[StringComparison]::OrdinalIgnoreCase))-or[string]$pending.effects.stateRootId-cne[string]$stateOwnership.rootId-or[string]$pending.effects.installFileIdentity-cne$installFileIdentity-or[string]$pending.effects.stateFileIdentity-cne$stateFileIdentity-or[string]$pending.effects.extensionIdentity-cne$extensionIdentity-or[string]$pending.effects.extensionVsixSha256-cne$extensionVsixSha256){throw 'The pending uninstall journal does not match the exact bundle, filesystem generation, state root, extension identity, or requested disposition.'}}
  if($pending.phase-ceq'owned_payload_removed'){
    if($null-eq$progress-or$progress.schema-cne'sxsy-b122.uninstall-progress'-or$progress.version-ne1){throw 'The payload-removal journal is missing its authenticated state-root recovery record.'}
    Assert-Options $progress;$progress.status='finalizing';$progress.updatedAt=(Get-Date).ToUniversalTime().ToString('o');Write-Progress $progress;(Finish-ProductRemoval $progress)|ConvertTo-Json -Depth 8 -Compress;return
  }
  $resumeProgress=$null-ne$progress-and$progress.schema-ceq'sxsy-b122.uninstall-progress'-and$progress.version-eq1-and[string]$progress.operationId-ceq[string]$pending.operationId-and$progress.status-cin@('shutdown_proven','extension_removed','partial')
  if($resumeProgress){Assert-Options $progress}else{
    Set-B122LifecyclePhase -InstallRoot $root -OperationId $pending.operationId -Phase uninstalling -Effects $effects|Out-Null
    $providerShutdown=Stop-B122InstalledProviderHost -InstallRoot $root -ConfigurationPath (Join-Path $state 'provider-host\provider-host.json')
    $shutdown=Stop-B122InstalledCompanion -InstallRoot $root -StateRoot $state;if(@($shutdown.survivors).Count){throw 'Uninstall refused to continue with a surviving companion process.'}
    Remove-ItemProperty -Path (Get-B122AutostartRegistryPath) -Name 'STRATHEX-SXSY-B122' -ErrorAction SilentlyContinue
    Set-B122LifecyclePhase -InstallRoot $root -OperationId $pending.operationId -Phase shutdown_proven -Effects $effects|Out-Null
    $progress=[ordered]@{schema='sxsy-b122.uninstall-progress';version=1;status='shutdown_proven';operationId=[string]$pending.operationId;canonicalInstallRoot=$root;installRootId=[string]$ownership.rootId;installFileIdentity=$installFileIdentity;canonicalStateRoot=$state;stateRootId=[string]$stateOwnership.rootId;stateFileIdentity=$stateFileIdentity;sourceCommit=[string]$before.current;bundleId=[string]$before.currentBundleId;keepVsCode=[bool]$KeepVsCodeExtension;purgeState=[bool]$PurgeState;extensionIdentity=$extensionIdentity;extensionVsixSha256=$extensionVsixSha256;extensionRemoved=$false;extensionAbsenceVerified=$false;shutdown=$shutdown;providerHostShutdown=$providerShutdown;createdAt=(Get-Date).ToUniversalTime().ToString('o');updatedAt=(Get-Date).ToUniversalTime().ToString('o')};Write-Progress $progress
  }

  if($progress.status-ceq'shutdown_proven'-and-not$KeepVsCodeExtension){
    if($null-eq$code){$code=Resolve-B122VsCodeCli};if($null-eq$code){throw 'VS Code CLI is unavailable; extension absence cannot be proven. Re-run with -KeepVsCodeExtension only if that was the original disposition.'}
    $installed=@(Get-B122UninstallExtensionInventory)
    if($installed.Count-and-not([string]$installed[0]).Equals([string]$progress.extensionIdentity,[StringComparison]::OrdinalIgnoreCase)){throw 'The installed B122 VS Code extension changed after uninstall preflight; product bytes were preserved.'}
    if($installed.Count){$uninstallResult=Invoke-B122UninstallCodeCli @('--uninstall-extension',$extensionId);if($uninstallResult.exitCode-ne0){throw 'VS Code extension uninstall returned a failure exit code.'};if($env:SXSY_B122_TEST_MODE-ceq'1'-and$env:SXSY_B122_TEST_FAIL_AFTER_VSCODE_UNINSTALL-ceq'1'){throw 'Injected interruption after successful VS Code extension uninstall.'}}
    if(@(Get-B122UninstallExtensionInventory).Count){throw 'VS Code still reports the B122 extension after uninstall.'}
    $progress.extensionRemoved=[bool]$installed.Count;$progress.extensionAbsenceVerified=$true
  }
  if($progress.status-ceq'shutdown_proven'){Set-B122LifecyclePhase -InstallRoot $root -OperationId $pending.operationId -Phase extension_removed -Effects $effects|Out-Null;$progress.status='extension_removed';$progress.updatedAt=(Get-Date).ToUniversalTime().ToString('o');Write-Progress $progress}
  $publishRecoveryAction=${function:Publish-RemovingProductRecovery}
  $publishRecovery={param($manifest,$rootIdentity)if([string]$rootIdentity-cne[string]$progress.installFileIdentity){throw 'The product-root filesystem generation changed before recovery publication.'};& $publishRecoveryAction $progress|Out-Null}.GetNewClosure()
  $removal=Remove-B122OwnedInstallation -InstallRoot $root -PreserveLifecycleMetadata -BeforeFirstDelete $publishRecovery
  if([string]$removal.rootFileIdentity-cne[string]$progress.installFileIdentity){throw 'The product-root filesystem generation changed during manifest-owned removal.'}
  if(-not$removal.complete){$progress.status='partial';$progress|Add-Member -NotePropertyName unownedPaths -NotePropertyValue @($removal.unownedPaths) -Force;$progress|Add-Member -NotePropertyName retainedChangedPaths -NotePropertyValue @($removal.retainedChangedPaths) -Force;$progress.updatedAt=(Get-Date).ToUniversalTime().ToString('o');Write-Progress $progress;throw 'B122 uninstall preserved unowned or changed product bytes for deterministic retry.'}
  Set-B122LifecyclePhase -InstallRoot $root -OperationId $pending.operationId -Phase owned_payload_removed -Effects $effects|Out-Null;$progress.status='finalizing';$progress.updatedAt=(Get-Date).ToUniversalTime().ToString('o');Write-Progress $progress
  (Finish-ProductRemoval $progress)|ConvertTo-Json -Depth 8 -Compress
}finally{Exit-B122LifecycleLock -Lock $lifecycleLock}
