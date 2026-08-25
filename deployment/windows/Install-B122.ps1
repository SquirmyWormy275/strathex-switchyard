[CmdletBinding()]
param([string]$BundleRoot,[string]$InstallRoot,[switch]$SkipVsCode,[switch]$SkipAutostart)
$ErrorActionPreference='Stop'
$bundle = if ($BundleRoot) { [IO.Path]::GetFullPath($BundleRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
$root = if ($InstallRoot) { [IO.Path]::GetFullPath($InstallRoot) } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard\install' }
$validator = Join-Path $bundle 'scripts\Test-B122ReleaseArtifact.ps1'
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'The B122 release validator is missing.' }
$receipt = & $validator -BundleRoot $bundle | ConvertFrom-Json
if ($receipt.schema -cne 'sxsy-b122.release-validation' -or $receipt.status -cne 'passed') { throw 'The B122 release bundle did not pass exact integrity validation.' }
Import-Module (Join-Path $bundle 'scripts\B122InstallTools.psm1') -Force
$release = Get-Content -LiteralPath (Join-Path $bundle 'release.json') -Raw | ConvertFrom-Json
$versionId = Test-B122VersionId ([string]$release.sourceCommit)
$candidatePath = Join-Path (Join-Path $root 'versions') $versionId
$candidateExisted = Test-Path -LiteralPath $candidatePath -PathType Container
$versionRoot = Import-B122ValidatedBundle -BundleRoot $bundle -InstallRoot $root
$stagedValidator = Join-Path $versionRoot 'scripts\Test-B122ReleaseArtifact.ps1'
if (-not (Test-Path -LiteralPath $stagedValidator -PathType Leaf)) { throw 'The staged B122 release validator is missing.' }
$stagedReceipt = & $stagedValidator -BundleRoot $versionRoot | ConvertFrom-Json
if ($stagedReceipt.schema -cne 'sxsy-b122.release-validation' -or $stagedReceipt.status -cne 'passed' -or [string]$stagedReceipt.sourceCommit -cne $versionId) { throw 'The staged B122 bytes failed immediate pre-activation validation.' }
$prior = Get-B122InstallState -InstallRoot $root
$code = if ($SkipVsCode) { $null } else { (Get-Command code.cmd -ErrorAction Stop).Source }
$extensionId = 'SquirmyWormy275.strathex-switchyard-b122'
if ($null -eq $prior -and $null -ne $code) {
  $existingExtension = @(& $code --list-extensions --show-versions 2>$null | Where-Object { $_ -match ('^'+[regex]::Escape($extensionId)+'@') })
  if ($existingExtension.Count -ne 0) { throw 'A pre-existing unmanaged B122 VS Code extension was detected; refusing to overwrite state that cannot be rolled back.' }
}
$runPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; $runName = 'STRATHEX-SXSY-B122'
$priorRunExists = $false; $priorRunValue = $null
if(Test-Path -LiteralPath $runPath){$runProperties=Get-ItemProperty -LiteralPath $runPath; $runProperty=$runProperties.PSObject.Properties[$runName]; if($null -ne $runProperty){$priorRunValue=[string]$runProperty.Value;$priorRunExists=$true}}
$rootModule = Join-Path $root 'B122InstallTools.psm1'; $rootLauncher = Join-Path $root 'Invoke-B122Current.ps1'
$rootModuleSnapshot = Get-B122FileSnapshot -Path $rootModule; $rootLauncherSnapshot = Get-B122FileSnapshot -Path $rootLauncher
$rootToolState = @{ installed=$false }
$restoreRootTools = {
  Restore-B122FileSnapshot -Path $rootModule -Snapshot $rootModuleSnapshot
  Restore-B122FileSnapshot -Path $rootLauncher -Snapshot $rootLauncherSnapshot
  $rootToolState.installed = $false
}
Stop-B122InstalledCompanion -InstallRoot $root
try {
  $rootToolState.installed = $true
  Copy-B122FileAtomic -Source (Join-Path $bundle 'scripts\B122InstallTools.psm1') -Destination $rootModule
  Copy-B122FileAtomic -Source (Join-Path $bundle 'scripts\Invoke-B122Current.ps1') -Destination $rootLauncher
  $installExtension = { if($null -ne $code){ & $code --install-extension (Join-Path $versionRoot 'extension\sxsy-b122-switchyard.vsix') --force; if($LASTEXITCODE -ne 0){throw 'VS Code refused the reviewed B122 extension package.'} } }
  $waitForHealth = { & (Join-Path $root 'Invoke-B122Current.ps1') -InstallRoot $root -WaitForHealth }
  $configureAutostart = {
    if(-not $SkipAutostart){
      if($root.Contains('"')){throw 'B122 install paths containing quotation marks are unsupported.'}
      $powershell=Join-Path $PSHOME 'powershell.exe'; $launcher=Join-Path $root 'Invoke-B122Current.ps1'
      $command="`"$powershell`" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -InstallRoot `"$root`""
      New-Item -Path $runPath -Force | Out-Null; Set-ItemProperty -Path $runPath -Name $runName -Value $command
    }
  }
  $restoreExtension = {
    if($null -ne $code){
      if($null -ne $prior){$priorBundle=Join-Path (Join-Path $root 'versions') ([string]$prior.current); & $code --install-extension (Join-Path $priorBundle 'extension\sxsy-b122-switchyard.vsix') --force; if($LASTEXITCODE -ne 0){throw 'VS Code refused restoration of the prior B122 extension.'}}
      else { & $code --uninstall-extension $extensionId; if($LASTEXITCODE -ne 0){throw 'VS Code refused cleanup of the first-install B122 extension.'} }
    }
  }
  $restoreAutostart = { if($SkipAutostart){return}; if($priorRunExists){New-Item -Path $runPath -Force|Out-Null;Set-ItemProperty -Path $runPath -Name $runName -Value $priorRunValue}else{Remove-ItemProperty -Path $runPath -Name $runName -ErrorAction SilentlyContinue} }
  $recoverPrior = { & (Join-Path $root 'Invoke-B122Current.ps1') -InstallRoot $root }
  Invoke-B122AtomicActivation -InstallRoot $root -VersionId $versionId -PriorState $prior -InstallExtension $installExtension -WaitForHealth $waitForHealth -ConfigureAutostart $configureAutostart -RestoreExtension $restoreExtension -RestoreAutostart $restoreAutostart -RestoreRootTools $restoreRootTools -RecoverPrior $recoverPrior | Out-Null
} catch {
  if($rootToolState.installed){ try{& $restoreRootTools}catch{} }
  if(-not $candidateExisted){ try{Remove-B122UnreferencedVersion -InstallRoot $root -VersionId $versionId}catch{} }
  throw
}
[ordered]@{ schema='sxsy-b122.install-result'; version=1; status='installed'; sourceCommit=[string]$release.sourceCommit; installRoot=$root; previous=if($null -eq $prior){$null}else{[string]$prior.current} } | ConvertTo-Json -Compress
