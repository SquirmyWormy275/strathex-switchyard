[CmdletBinding()]
param(
  [string]$BundleRoot,
  [string]$InstallRoot,
  [string]$StateRoot,
  [switch]$SkipVsCode,
  [switch]$SkipAutostart,
  [ValidateSet('install','update','rollback')][string]$OperationKindOverride,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$TrustedBootstrapDigest,
  [ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$TrustedBootstrapSourceCommit
)
$ErrorActionPreference='Stop'
$bundle=if($BundleRoot){[IO.Path]::GetFullPath($BundleRoot)}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))}
$root=if($InstallRoot){[IO.Path]::GetFullPath($InstallRoot)}else{Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard\install'}
$defaultState=[IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard'))
$state=if($StateRoot){[IO.Path]::GetFullPath($StateRoot)}else{$defaultState}
if(-not$SkipVsCode-and-not$state.Equals($defaultState,[StringComparison]::OrdinalIgnoreCase)){throw 'The installed VS Code extension discovers only the canonical current-user B122 state root; use -SkipVsCode for an isolated test-only state root.'}
$bootstrapOperation=$OperationKindOverride-cne'rollback'
if($bootstrapOperation-and([string]::IsNullOrWhiteSpace($TrustedBootstrapDigest)-or[string]::IsNullOrWhiteSpace($TrustedBootstrapSourceCommit))){throw 'Install and update require the independently reviewed trusted-bootstrap digest and source commit.'}
function Get-B122InstallerTrustDigest([string]$Root){
  $records=[Collections.Generic.List[string]]::new();$bounds=@{'release.json'=1MB;'SHA256SUMS.json'=32MB;'sbom.spdx.json'=64MB}
  foreach($name in @('release.json','SHA256SUMS.json','sbom.spdx.json')){
    $path=Join-Path $Root $name;$item=Get-Item -LiteralPath $path -Force
    if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$item.Length-lt2-or$item.Length-gt[long]$bounds[$name]){throw "Release trust-root metadata is missing, unsafe, or outside its size bound: $name"}
    $records.Add("$name`0$((Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant())")
  }
  $bytes=[Text.Encoding]::UTF8.GetBytes(($records.ToArray()-join"`n"));$hash=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
}
$trustedBootstrapDigest=if($bootstrapOperation){$TrustedBootstrapDigest.ToLowerInvariant()}else{$null}
$trustedBootstrapCommit=if($bootstrapOperation){$TrustedBootstrapSourceCommit.ToLowerInvariant()}else{$null}
if($bootstrapOperation-and(Get-B122InstallerTrustDigest $bundle)-cne$trustedBootstrapDigest){throw 'The privately staged release trust metadata no longer matches the independently reviewed bootstrap digest.'}
$bootstrapRelease=Get-Content -LiteralPath (Join-Path $bundle 'release.json') -Raw|ConvertFrom-Json
if($bootstrapOperation-and([string]$bootstrapRelease.sourceCommit-cne$trustedBootstrapCommit-or$bootstrapRelease.verificationSkipped-ne$false-or$bootstrapRelease.evidenceEligible-ne$true)){throw 'The privately staged release identity no longer matches the independently reviewed bootstrap source commit.'}
function Assert-B122BootstrapPinnedPayload([string]$RelativePath){
  if(-not$bootstrapOperation){return}
  if([IO.Path]::IsPathRooted($RelativePath)-or$RelativePath-match'(^|[\\/])\.\.([\\/]|$)'){throw 'A trusted-bootstrap payload path escaped the staged release.'}
  $entries=@(Get-Content -LiteralPath (Join-Path $bundle 'SHA256SUMS.json') -Raw|ConvertFrom-Json|Where-Object{[string]$_.path-ceq$RelativePath})
  if($entries.Count-ne1-or[string]$entries[0].sha256-cnotmatch'^[a-f0-9]{64}$'-or[long]$entries[0].bytes-lt1-or[long]$entries[0].bytes-gt64MB){throw "The trusted-bootstrap checksum manifest does not bind exactly one safe payload: $RelativePath"}
  $path=[IO.Path]::GetFullPath((Join-Path $bundle $RelativePath.Replace('/','\\')));$item=Get-Item -LiteralPath $path -Force
  if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-or[long]$item.Length-ne[long]$entries[0].bytes-or(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()-cne[string]$entries[0].sha256){throw "The trusted-bootstrap payload changed before import or execution: $RelativePath"}
}
$validator=Join-Path $bundle 'scripts\Test-B122ReleaseArtifact.ps1'
if(-not(Test-Path -LiteralPath $validator -PathType Leaf)){throw 'The B122 release validator is missing.'}
$modulePath=Join-Path $PSScriptRoot 'B122InstallTools.psm1'
Assert-B122BootstrapPinnedPayload 'scripts/B122InstallTools.psm1'
Assert-B122BootstrapPinnedPayload 'scripts/Test-B122ReleaseArtifact.ps1'
$moduleItem=Get-Item -LiteralPath $modulePath -Force
if($moduleItem.PSIsContainer-or($moduleItem.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'The immutable versioned B122 install module is unsafe.'}
$versionsPrefix=([IO.Path]::GetFullPath((Join-Path $root 'versions')).TrimEnd('\')+'\')
$installedSource=$bundle.StartsWith($versionsPrefix,[StringComparison]::OrdinalIgnoreCase)
$managedRoot=Test-Path -LiteralPath (Join-Path $root '.sxsy-b122-install-root.json') -PathType Leaf
Import-Module $modulePath -Force
$lifecycleLock=Enter-B122LifecycleLock -InstallRoot $root
try{
if($managedRoot){
  $trustedBundle=Get-B122CurrentBundle -InstallRoot $root;$trustedValidator=Join-Path $trustedBundle 'scripts\Test-B122ReleaseArtifact.ps1';Assert-B122InstalledPayloadFile -InstallRoot $root -Path $trustedValidator|Out-Null
  $validator=$trustedValidator
}
if($installedSource){
  Assert-B122InstalledPayloadFile -InstallRoot $root -Path (Join-Path $bundle 'release.json')|Out-Null
  Assert-B122InstalledPayloadFile -InstallRoot $root -Path (Join-Path $bundle 'scripts\Test-B122ReleaseArtifact.ps1')|Out-Null
  $installedIdentity=Get-B122BundleIdentity -BundleRoot $bundle;$installedRecord=Get-B122InstalledVersionRecord -InstallRoot $root -SourceCommit ([string]$installedIdentity.sourceCommit)
  if($null-eq$installedRecord-or[string]$installedRecord.bundleId-cne[string]$installedIdentity.bundleId){throw 'The rollback target is not the exact authenticated installed bundle.'}
}
$receipt=& $validator -BundleRoot $bundle|ConvertFrom-Json
if($receipt.schema -cne 'sxsy-b122.release-validation' -or $receipt.status -cne 'passed'){throw 'The B122 release bundle did not pass exact integrity validation.'}
$identity=Get-B122BundleIdentity -BundleRoot $bundle;$release=Get-Content -LiteralPath (Join-Path $bundle 'release.json') -Raw|ConvertFrom-Json
if($identity.sourceCommit -cne [string]$release.sourceCommit){throw 'The release and immutable bundle identities disagree.'}
if($bootstrapOperation-and((Get-B122InstallerTrustDigest $bundle)-cne$trustedBootstrapDigest-or[string]$identity.sourceCommit-cne$trustedBootstrapCommit)){throw 'The privately staged release identity changed before the first installation effect.'}
if(Test-Path -LiteralPath (Join-Path $state '.sxsy-b122-state-root.json') -PathType Leaf){Get-B122StateOwnership -StateRoot $state|Out-Null}else{Initialize-B122OwnedStateRoot -StateRoot $state -ProtectedPaths @($bundle,$PSScriptRoot)|Out-Null}
if(Test-Path -LiteralPath (Join-Path $root '.sxsy-b122-install-root.json') -PathType Leaf){Get-B122InstallOwnership -InstallRoot $root|Out-Null}else{Initialize-B122OwnedInstallRoot -InstallRoot $root -ProtectedPaths @($bundle,$PSScriptRoot)|Out-Null}
Bind-B122InstallStateRoot -InstallRoot $root -StateRoot $state|Out-Null

$code=if($SkipVsCode){$null}else{Resolve-B122VsCodeCli};if(-not$SkipVsCode-and$null-eq$code){throw 'VS Code CLI is unavailable.'}
$extensionId='SquirmyWormy275.strathex-switchyard-b122'
$candidateExtensionVersion=[string]$release.vscodeExtension
$candidateExtensionIdentity=$extensionId+'@'+$candidateExtensionVersion
$candidateVsixPath=Join-Path $bundle 'extension\sxsy-b122-switchyard.vsix'
$candidateVsixSha256=(Get-FileHash -LiteralPath $candidateVsixPath -Algorithm SHA256).Hash.ToLowerInvariant()
$providerConfiguration=Join-Path $state 'provider-host\provider-host.json'
function Invoke-B122CodeCli([string[]]$Arguments){if($null-eq$code){throw 'VS Code CLI is unavailable.'};Assert-B122VsCodeCliIdentity -Cli $code|Out-Null;$savedDev=$env:VSCODE_DEV;$savedElectron=$env:ELECTRON_RUN_AS_NODE;try{$env:VSCODE_DEV=$null;$env:ELECTRON_RUN_AS_NODE='1';return Invoke-B122BoundedNativeProcess -FilePath $code.executable -Arguments (@([string]$code.cliScript)+$Arguments) -StateRoot $state -TimeoutSeconds 45 -MaxOutputBytes 1048576}finally{$env:VSCODE_DEV=$savedDev;$env:ELECTRON_RUN_AS_NODE=$savedElectron}}
function Get-B122ManagedExtensionInventory {
  $inventory=Invoke-B122CodeCli @('--list-extensions','--show-versions');if($inventory.exitCode-ne0){throw 'VS Code extension inventory failed.'}
  $matches=New-Object Collections.Generic.List[string]
  foreach($raw in @([string]$inventory.stdout-split'\r?\n')){$line=[string]$raw;if([string]::IsNullOrWhiteSpace($line)){continue};$separator=$line.LastIndexOf('@');if($separator-lt1){if($line.Equals($extensionId,[StringComparison]::OrdinalIgnoreCase)){throw 'VS Code returned the managed extension without an exact version.'};continue};if($line.Substring(0,$separator).Equals($extensionId,[StringComparison]::OrdinalIgnoreCase)){$matches.Add($line)}}
  if($matches.Count-gt1){throw 'VS Code returned ambiguous managed-extension identities.'};return @($matches)
}
function Assert-B122ManagedExtension([string]$ExpectedIdentity,[switch]$AllowAbsent){
  $installed=@(Get-B122ManagedExtensionInventory)
  if(-not$installed.Count){if($AllowAbsent){return $false};throw 'VS Code did not report the exact reviewed managed extension after the lifecycle effect.'}
  if(-not([string]$installed[0]).Equals($ExpectedIdentity,[StringComparison]::OrdinalIgnoreCase)){throw "VS Code reports a different B122 extension version than the reviewed lifecycle generation: $($installed[0])"}
  return $true
}
$prior=Get-B122InstallState -InstallRoot $root
if($null -ne $code){
  if($null-eq$prior){if(@(Get-B122ManagedExtensionInventory).Count){throw 'A pre-existing unmanaged B122 VS Code extension was detected; refusing overwrite.'}}
  else{
    $priorBundle=Join-Path (Join-Path $root 'versions') ([string]$prior.current);$priorReleasePath=Join-Path $priorBundle 'release.json';Assert-B122InstalledPayloadFile -InstallRoot $root -Path $priorReleasePath|Out-Null
    $priorRelease=Get-Content -LiteralPath $priorReleasePath -Raw|ConvertFrom-Json;$priorExtensionIdentity=$extensionId+'@'+[string]$priorRelease.vscodeExtension
    Assert-B122ManagedExtension -ExpectedIdentity $priorExtensionIdentity -AllowAbsent|Out-Null
  }
}
$runPath=Get-B122AutostartRegistryPath;$runName='STRATHEX-SXSY-B122'
$priorRunExists=$false;$priorRunValue=$null
if(Test-Path -LiteralPath $runPath){$property=(Get-ItemProperty -LiteralPath $runPath).PSObject.Properties[$runName];if($null -ne $property){$priorRunExists=$true;$priorRunValue=[string]$property.Value}}
if($null-eq$prior-and$priorRunExists){throw 'A pre-existing unmanaged B122 autostart value was detected; refusing overwrite.'}
$rootModule=Join-Path $root 'B122InstallTools.psm1';$rootLauncher=Join-Path $root 'Invoke-B122Current.ps1'

function Get-B122Effect($record,[string]$name,$default=$null){$property=$record.effects.PSObject.Properties[$name];if($null-eq$property){return $default};return $property.Value}
function Start-B122InstalledCurrent([switch]$RequireHealth){
  $installedBundle=Get-B122CurrentBundle -InstallRoot $root;$installedStart=Join-Path $installedBundle 'scripts\Start-B122.ps1'
  Assert-B122InstalledPayloadFile -InstallRoot $root -Path $installedStart|Out-Null
  & $installedStart -InstallRoot $root -StateRoot $state -WaitForHealth:$RequireHealth|Out-Null
}
function Restore-RootToolsFromRecord($record){
  $savedModule=Get-B122Effect $record 'rootModuleSnapshot';$savedLauncher=Get-B122Effect $record 'rootLauncherSnapshot'
  if($null -ne $savedModule){Restore-B122FileSnapshot -Path $rootModule -Snapshot $savedModule}
  if($null -ne $savedLauncher){Restore-B122FileSnapshot -Path $rootLauncher -Snapshot $savedLauncher}
  $paths=@();if(Test-Path -LiteralPath $rootModule -PathType Leaf){$paths+='B122InstallTools.psm1'};if(Test-Path -LiteralPath $rootLauncher -PathType Leaf){$paths+='Invoke-B122Current.ps1'}
  Set-B122RootToolInventory -InstallRoot $root -RelativePaths $paths|Out-Null
}
function Restore-AutostartFromRecord($record){
  if([bool](Get-B122Effect $record 'skipAutostart' $false)){return}
  if([bool](Get-B122Effect $record 'priorRunExists' $false)){New-Item -Path $runPath -Force|Out-Null;Set-ItemProperty -Path $runPath -Name $runName -Value ([string](Get-B122Effect $record 'priorRunValue' ''))}
  else{Remove-ItemProperty -Path $runPath -Name $runName -ErrorAction SilentlyContinue}
}
function Restore-ExtensionFromRecord($record){
  if([bool](Get-B122Effect $record 'skipVsCode' $false) -or $null -eq $code){return}
  if($null -ne $record.priorState){$priorBundle=Join-Path (Join-Path $root 'versions') ([string]$record.priorState.current);$priorReleasePath=Join-Path $priorBundle 'release.json';Assert-B122InstalledPayloadFile -InstallRoot $root -Path $priorReleasePath|Out-Null;$priorRelease=Get-Content -LiteralPath $priorReleasePath -Raw|ConvertFrom-Json;$installResult=Invoke-B122CodeCli @('--install-extension',(Join-Path $priorBundle 'extension\sxsy-b122-switchyard.vsix'),'--force');if($installResult.exitCode-ne0){throw 'VS Code refused restoration of the prior extension.'};Assert-B122ManagedExtension -ExpectedIdentity ($extensionId+'@'+[string]$priorRelease.vscodeExtension)|Out-Null}
  else{$uninstallResult=Invoke-B122CodeCli @('--uninstall-extension',$extensionId);if($uninstallResult.exitCode-ne0){throw 'VS Code refused cleanup of the first-install extension.'};if(@(Get-B122ManagedExtensionInventory).Count){throw 'VS Code still reports the B122 extension after uninstall.'}}
}
$recoveryStop={param($record)try{Stop-B122InstalledProviderHost -InstallRoot $root -ConfigurationPath $providerConfiguration|Out-Null;Stop-B122InstalledCompanion -InstallRoot $root -StateRoot $state|Out-Null;return $true}catch{return $false}}
$recoveryRestore={param($record)try{Restore-RootToolsFromRecord $record;Restore-AutostartFromRecord $record;Restore-ExtensionFromRecord $record;if($null -ne $record.priorState){Start-B122InstalledCurrent};return $true}catch{return $false}}
if($null -ne (Get-B122LifecycleOperation -InstallRoot $root)){Repair-B122Lifecycle -InstallRoot $root -StopCandidate $recoveryStop -RestorePrior $recoveryRestore|Out-Null;$prior=Get-B122InstallState -InstallRoot $root}
if($managedRoot){Assert-B122RootTools -InstallRoot $root|Out-Null}
$moduleSnapshot=Get-B122FileSnapshot -Path $rootModule;$launcherSnapshot=Get-B122FileSnapshot -Path $rootLauncher

$operationKind=if($OperationKindOverride){$OperationKindOverride}elseif($null -eq $prior){'install'}else{'update'}
if($operationKind -ceq 'install' -and $null -ne $prior){throw 'Install lifecycle cannot overwrite an existing managed installation.'}
if($operationKind -ceq 'rollback' -and ($null -eq $prior -or [string]$prior.previous -cne [string]$identity.sourceCommit)){throw 'Rollback target is not the exact protected previous version.'}
$effects=[ordered]@{rootModuleSnapshot=$moduleSnapshot;rootLauncherSnapshot=$launcherSnapshot;priorRunExists=$priorRunExists;priorRunValue=$priorRunValue;skipVsCode=[bool]$SkipVsCode;skipAutostart=[bool]$SkipAutostart;extensionIdentity=$candidateExtensionIdentity;extensionVsixSha256=$candidateVsixSha256}
$operation=Start-B122LifecycleOperation -InstallRoot $root -Kind $operationKind -SourceCommit $identity.sourceCommit -BundleId $identity.bundleId -PriorState $prior -InitialEffects $effects
Set-B122LifecyclePhase -InstallRoot $root -OperationId $operation.operationId -Phase recovery_prepared -Effects $effects|Out-Null
$operation=Get-B122LifecycleOperation -InstallRoot $root
$candidatePath=Join-Path (Join-Path $root 'versions') $identity.sourceCommit;$candidateExisted=Test-Path -LiteralPath $candidatePath -PathType Container
try{
  $versionRoot=Import-B122ValidatedBundle -BundleRoot $bundle -InstallRoot $root
  Set-B122LifecyclePhase -InstallRoot $root -OperationId $operation.operationId -Phase candidate_imported -Effects $effects|Out-Null
  $stagedValidator=Join-Path $versionRoot 'scripts\Test-B122ReleaseArtifact.ps1';$staged=& $stagedValidator -BundleRoot $versionRoot|ConvertFrom-Json
  if($staged.schema -cne 'sxsy-b122.release-validation' -or $staged.status -cne 'passed' -or [string]$staged.sourceCommit -cne $identity.sourceCommit){throw 'The staged B122 bytes failed immediate validation.'}
  Stop-B122InstalledProviderHost -InstallRoot $root -ConfigurationPath $providerConfiguration|Out-Null
  Stop-B122InstalledCompanion -InstallRoot $root -StateRoot $state|Out-Null
  Copy-B122FileAtomic -Source (Join-Path $versionRoot 'scripts\B122InstallTools.psm1') -Destination $rootModule
  Set-B122LifecyclePhase -InstallRoot $root -OperationId $operation.operationId -Phase root_module_installed -Effects $effects|Out-Null
  Copy-B122FileAtomic -Source (Join-Path $versionRoot 'scripts\Invoke-B122Current.ps1') -Destination $rootLauncher
  Set-B122LifecyclePhase -InstallRoot $root -OperationId $operation.operationId -Phase root_launcher_installed -Effects $effects|Out-Null
  Set-B122RootToolInventory -InstallRoot $root -RelativePaths @('B122InstallTools.psm1','Invoke-B122Current.ps1')|Out-Null
  Set-B122LifecyclePhase -InstallRoot $root -OperationId $operation.operationId -Phase root_tools_installed -Effects $effects|Out-Null
  $installExtension={if($null -ne $code){$codeResult=Invoke-B122CodeCli @('--install-extension',(Join-Path $versionRoot 'extension\sxsy-b122-switchyard.vsix'),'--force');if($codeResult.exitCode-ne0){throw 'VS Code refused the reviewed B122 extension.'};Assert-B122ManagedExtension -ExpectedIdentity $candidateExtensionIdentity|Out-Null}}
  $health={$candidateStart=Join-Path $versionRoot 'scripts\Start-B122.ps1';Assert-B122InstalledPayloadFile -InstallRoot $root -Path $candidateStart|Out-Null;& $candidateStart -InstallRoot $root -StateRoot $state -WaitForHealth|Out-Null}
  $configureAutostart={if(-not$SkipAutostart){
    Assert-B122RootTools -InstallRoot $root|Out-Null
    $immutableStart=Join-Path $versionRoot 'scripts\Invoke-B122Current.ps1';Assert-B122InstalledPayloadFile -InstallRoot $root -Path $immutableStart|Out-Null
    $hostExecutable=(Get-Process -Id $PID).Path
    if(-not(Test-Path -LiteralPath $hostExecutable -PathType Leaf) -or [IO.Path]::GetFileName($hostExecutable) -notin @('powershell.exe','pwsh.exe') -or $immutableStart.Contains('"') -or $state.Contains('"')){throw 'The exact PowerShell autostart host is unavailable.'}
    $command="`"$hostExecutable`" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$immutableStart`" -InstallRoot `"$root`" -StateRoot `"$state`""
    New-Item -Path $runPath -Force|Out-Null;Set-ItemProperty -Path $runPath -Name $runName -Value $command
  }}
  $restoreTools={Restore-B122FileSnapshot -Path $rootModule -Snapshot $moduleSnapshot;Restore-B122FileSnapshot -Path $rootLauncher -Snapshot $launcherSnapshot;$paths=@();if($moduleSnapshot.exists){$paths+='B122InstallTools.psm1'};if($launcherSnapshot.exists){$paths+='Invoke-B122Current.ps1'};Set-B122RootToolInventory -InstallRoot $root -RelativePaths $paths|Out-Null}
  $restoreExtension={Restore-ExtensionFromRecord $operation};$restoreAutostart={Restore-AutostartFromRecord $operation};$recoverPrior={if($null -ne $prior){Start-B122InstalledCurrent}}
  $stopCandidate={Stop-B122InstalledProviderHost -InstallRoot $root -ConfigurationPath $providerConfiguration|Out-Null;Stop-B122InstalledCompanion -InstallRoot $root -StateRoot $state|Out-Null;return $true}
  $activated=Invoke-B122AtomicActivation -InstallRoot $root -VersionId $identity.sourceCommit -PriorState $prior -InstallExtension $installExtension -WaitForHealth $health -ConfigureAutostart $configureAutostart -RestoreExtension $restoreExtension -RestoreAutostart $restoreAutostart -RestoreRootTools $restoreTools -RecoverPrior $recoverPrior -StopCandidate $stopCandidate -OperationKind $operationKind -ExistingOperation $operation
}catch{
  if($null -ne (Get-B122LifecycleOperation -InstallRoot $root)){try{Repair-B122Lifecycle -InstallRoot $root -StopCandidate $recoveryStop -RestorePrior $recoveryRestore|Out-Null}catch{}}
  if(-not$candidateExisted){try{Remove-B122UnreferencedVersion -InstallRoot $root -VersionId $identity.sourceCommit}catch{}}
  throw
}
if($operationKind-in@('install','update')){
  [ordered]@{schema='sxsy-b122.install-result';version=3;status=if($operationKind-ceq'install'){'installed'}else{'updated'};operation=$operationKind;sourceCommit=[string]$activated.current;bundleId=[string]$activated.currentBundleId;trustDigest=$trustedBootstrapDigest;installRoot=$root;stateRoot=$state;previous=if($null-eq$prior){$null}else{[string]$prior.current}}|ConvertTo-Json -Compress
}else{
  [ordered]@{schema='sxsy-b122.install-result';version=2;status='rolled_back';sourceCommit=[string]$activated.current;bundleId=[string]$activated.currentBundleId;installRoot=$root;previous=[string]$prior.current}|ConvertTo-Json -Compress
}
}finally{Exit-B122LifecycleLock -Lock $lifecycleLock}
