$ErrorActionPreference='Stop'
$module = Join-Path $PSScriptRoot 'B122InstallTools.psm1'
Import-Module $module -Force
$temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
$root = [IO.Path]::GetFullPath((Join-Path $temporary ('sxsy-b122-install-test-'+[guid]::NewGuid().ToString('N'))))
if(-not $root.StartsWith($temporary,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe install test root.'}
function New-FakeBundle([string]$Path,[string]$Commit){ New-Item -ItemType Directory -Force -Path (Join-Path $Path 'scripts') | Out-Null; [IO.File]::WriteAllText((Join-Path $Path 'release.json'),([ordered]@{schema='sxsy-b122.windows-release';version=1;sourceCommit=$Commit}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false))); [IO.File]::WriteAllText((Join-Path $Path 'scripts\Start-B122.ps1'),'param([switch]$WaitForHealth)',(New-Object Text.UTF8Encoding($false))) }
try {
  $install=Join-Path $root 'install'; $one=Join-Path $root 'bundle-one'; $two=Join-Path $root 'bundle-two'; $first='1'*40; $second='2'*40
  New-FakeBundle $one $first; New-FakeBundle $two $second
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
  [ordered]@{schema='sxsy-b122.install-lifecycle-test';version=1;status='passed';atomicPointer=$true;rollback=$true;activationFailureInjection=$true;rootToolRollback=$true;firstInstallCleanup=$true;interruptionRecovery=$true;pathContainment=$true}|ConvertTo-Json -Compress
} finally { if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force} }
