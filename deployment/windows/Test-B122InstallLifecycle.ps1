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
  foreach($stage in @('extension','health','autostart')){
    $effects=@{extension='old';autostart='old';priorRecovered=$false}
    $installExtension={ $effects.extension='new'; if($stage -ceq 'extension'){throw 'injected extension failure'} }
    $health={ if($stage -ceq 'health'){throw 'injected health failure'} }
    $autostart={ $effects.autostart='new'; if($stage -ceq 'autostart'){throw 'injected autostart failure'} }
    $restoreExtension={ $effects.extension='old' }; $restoreAutostart={ $effects.autostart='old' }; $recover={ $effects.priorRecovered=$true }
    $failed=$false; try{Invoke-B122AtomicActivation -InstallRoot $install -VersionId $second -PriorState $state -InstallExtension $installExtension -WaitForHealth $health -ConfigureAutostart $autostart -RestoreExtension $restoreExtension -RestoreAutostart $restoreAutostart -RecoverPrior $recover|Out-Null}catch{$failed=$true}
    if(-not $failed){throw "Failure injection at $stage did not fail."}
    $after=Get-B122InstallState -InstallRoot $install
    if($after.current -cne $first -or $after.previous -cne $second -or $effects.extension -cne 'old' -or $effects.autostart -cne 'old' -or -not $effects.priorRecovered){throw "Activation rollback was incomplete at $stage."}
  }
  $firstInstall=Join-Path $root 'first-install'; Import-B122ValidatedBundle -BundleRoot $one -InstallRoot $firstInstall|Out-Null
  $firstEffects=@{restored=$false}; $failFirst={throw 'injected first-install failure'}; $noop={}; $restoreFirst={$firstEffects.restored=$true}
  $failed=$false; try{Invoke-B122AtomicActivation -InstallRoot $firstInstall -VersionId $first -PriorState $null -InstallExtension $failFirst -WaitForHealth $noop -ConfigureAutostart $noop -RestoreExtension $restoreFirst -RestoreAutostart $noop -RecoverPrior $noop|Out-Null}catch{$failed=$true}
  if(-not $failed -or $null -ne (Get-B122InstallState -InstallRoot $firstInstall) -or -not $firstEffects.restored){throw 'First-install rollback did not restore an uninstalled state.'}
  Remove-B122UnreferencedVersion -InstallRoot $firstInstall -VersionId $first
  if(Test-Path -LiteralPath (Join-Path (Join-Path $firstInstall 'versions') $first)){throw 'First-install cleanup retained an unreferenced version.'}
  if(@(Get-ChildItem -LiteralPath $install -Filter '*.tmp' -File -Force).Count -ne 0){throw 'Atomic state write leaked a temporary file.'}
  $escaped=$false; try{Assert-B122ChildPath -Parent $install -Child (Join-Path $install '..\escape')|Out-Null}catch{$escaped=$true}; if(-not $escaped){throw 'Containment accepted an escaping install path.'}
  [ordered]@{schema='sxsy-b122.install-lifecycle-test';version=1;status='passed';atomicPointer=$true;rollback=$true;activationFailureInjection=$true;firstInstallCleanup=$true;interruptionRecovery=$true;pathContainment=$true}|ConvertTo-Json -Compress
} finally { if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force} }
