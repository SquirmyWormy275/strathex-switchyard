[CmdletBinding()]
param([string]$InstallRoot,[string]$StateRoot,[switch]$WaitForHealth)
$ErrorActionPreference='Stop'
$root=if($InstallRoot){[IO.Path]::GetFullPath($InstallRoot)}else{[IO.Path]::GetFullPath($PSScriptRoot)}
$state=if($StateRoot){[IO.Path]::GetFullPath($StateRoot)}else{Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard'}
$module=Join-Path $PSScriptRoot 'B122InstallTools.psm1'
if(-not(Test-Path -LiteralPath $module -PathType Leaf)){throw 'The digest-pinned B122 bootstrap module is missing.'}
Import-Module $module -Force
$lifecycleLock=Enter-B122LifecycleLock -InstallRoot $root
try{
Assert-B122InstallStateRootBinding -InstallRoot $root -StateRoot $state|Out-Null
$pending=Get-B122LifecycleOperation -InstallRoot $root
if($null -ne $pending){
  if($pending.kind -ceq 'uninstall'){throw 'An interrupted B122 uninstall must be resumed through Uninstall-B122.ps1 before startup.'}
  $runPath=Get-B122AutostartRegistryPath;$runName='STRATHEX-SXSY-B122';$extensionId='SquirmyWormy275.strathex-switchyard-b122'
  function Get-B122Effect($record,[string]$name,$default=$null){$property=$record.effects.PSObject.Properties[$name];if($null-eq$property){return $default};return $property.Value}
  $stop={param($record)try{Stop-B122InstalledProviderHost -InstallRoot $root -ConfigurationPath (Join-Path $state 'provider-host\provider-host.json')|Out-Null;Stop-B122InstalledCompanion -InstallRoot $root -StateRoot $state|Out-Null;return $true}catch{return $false}}
  $restore={param($record)try{
    $rootModule=Join-Path $root 'B122InstallTools.psm1';$rootLauncher=Join-Path $root 'Invoke-B122Current.ps1'
    $savedModule=Get-B122Effect $record 'rootModuleSnapshot';$savedLauncher=Get-B122Effect $record 'rootLauncherSnapshot'
    if($null -ne $savedModule){Restore-B122FileSnapshot -Path $rootModule -Snapshot $savedModule}
    if($null -ne $savedLauncher){Restore-B122FileSnapshot -Path $rootLauncher -Snapshot $savedLauncher}
    $paths=@();if(Test-Path -LiteralPath $rootModule -PathType Leaf){$paths+='B122InstallTools.psm1'};if(Test-Path -LiteralPath $rootLauncher -PathType Leaf){$paths+='Invoke-B122Current.ps1'};Set-B122RootToolInventory -InstallRoot $root -RelativePaths $paths|Out-Null
    if(-not [bool](Get-B122Effect $record 'skipAutostart' $false)){if([bool](Get-B122Effect $record 'priorRunExists' $false)){New-Item -Path $runPath -Force|Out-Null;Set-ItemProperty -Path $runPath -Name $runName -Value ([string](Get-B122Effect $record 'priorRunValue' ''))}else{Remove-ItemProperty -Path $runPath -Name $runName -ErrorAction SilentlyContinue}}
    if(-not [bool](Get-B122Effect $record 'skipVsCode' $false)){$code=Resolve-B122VsCodeCli;if($null-eq$code){throw 'VS Code CLI is unavailable.'};$invokeCode={param([string[]]$values)Assert-B122VsCodeCliIdentity -Cli $code|Out-Null;$savedDev=$env:VSCODE_DEV;$savedElectron=$env:ELECTRON_RUN_AS_NODE;try{$env:VSCODE_DEV=$null;$env:ELECTRON_RUN_AS_NODE='1';Invoke-B122BoundedNativeProcess -FilePath $code.executable -Arguments (@([string]$code.cliScript)+$values) -StateRoot $state -TimeoutSeconds 45}finally{$env:VSCODE_DEV=$savedDev;$env:ELECTRON_RUN_AS_NODE=$savedElectron}};if($null -ne $record.priorState){$priorBundle=Join-Path (Join-Path $root 'versions') ([string]$record.priorState.current);$codeResult=& $invokeCode @('--install-extension',(Join-Path $priorBundle 'extension\sxsy-b122-switchyard.vsix'),'--force');if($codeResult.exitCode-ne0){throw 'VS Code prior-extension recovery failed.'}}else{$codeResult=& $invokeCode @('--uninstall-extension',$extensionId);if($codeResult.exitCode-ne0){throw 'VS Code first-install recovery failed.'};$inventory=& $invokeCode @('--list-extensions');if($inventory.exitCode-ne0-or@(([string]$inventory.stdout-split'\r?\n')|Where-Object{([string]$_).Equals($extensionId,[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'VS Code first-install recovery could not prove extension absence.'}}}
    return $true
  }catch{return $false}}
  Repair-B122Lifecycle -InstallRoot $root -StopCandidate $stop -RestorePrior $restore|Out-Null
  # Repair can atomically replace this script and module. Re-enter only through
  # the now-restored, digest-pinned launcher; never continue in stale code.
  $restoredBundle=Get-B122CurrentBundle -InstallRoot $root;$restoredBootstrap=Join-Path $restoredBundle 'scripts\Invoke-B122Current.ps1';Assert-B122InstalledPayloadFile -InstallRoot $root -Path $restoredBootstrap|Out-Null
  & $restoredBootstrap -InstallRoot $root -StateRoot $state -WaitForHealth:$WaitForHealth
  return
}
Assert-B122RootTools -InstallRoot $root|Out-Null
$bundle=Get-B122CurrentBundle -InstallRoot $root
$start=Join-Path $bundle 'scripts\Start-B122.ps1';Assert-B122InstalledPayloadFile -InstallRoot $root -Path $start|Out-Null
& $start -InstallRoot $root -StateRoot $state -WaitForHealth:$WaitForHealth
}finally{Exit-B122LifecycleLock -Lock $lifecycleLock}
