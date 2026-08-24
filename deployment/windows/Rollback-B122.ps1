[CmdletBinding()]
param([string]$InstallRoot,[switch]$SkipVsCode)
$ErrorActionPreference='Stop'
$root = if ($InstallRoot) { [IO.Path]::GetFullPath($InstallRoot) } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard\install' }
Import-Module (Join-Path $root 'B122InstallTools.psm1') -Force
$before = Get-B122InstallState -InstallRoot $root
if($null -eq $before -or [string]::IsNullOrWhiteSpace([string]$before.previous)){throw 'No previous B122 version is available for rollback.'}
$targetVersion=[string]$before.previous
$bundle=Join-Path (Join-Path $root 'versions') $targetVersion
$validator=Join-Path $bundle 'scripts\Test-B122ReleaseArtifact.ps1'
if(-not (Test-Path -LiteralPath $validator -PathType Leaf)){throw 'The rollback version has no release validator.'}
$receipt=& $validator -BundleRoot $bundle|ConvertFrom-Json
if($receipt.schema -cne 'sxsy-b122.release-validation' -or $receipt.status -cne 'passed' -or [string]$receipt.sourceCommit -cne $targetVersion){throw 'The rollback version failed immediate integrity validation.'}
$code=if($SkipVsCode){$null}else{(Get-Command code.cmd -ErrorAction Stop).Source}
Stop-B122InstalledCompanion -InstallRoot $root
$installExtension={if($null -ne $code){& $code --install-extension (Join-Path $bundle 'extension\sxsy-b122-switchyard.vsix') --force;if($LASTEXITCODE -ne 0){throw 'VS Code refused the rollback extension.'}}}
$health={& (Join-Path $root 'Invoke-B122Current.ps1') -InstallRoot $root -WaitForHealth}
$noop={}
$restoreExtension={if($null -ne $code){$priorBundle=Join-Path (Join-Path $root 'versions') ([string]$before.current);& $code --install-extension (Join-Path $priorBundle 'extension\sxsy-b122-switchyard.vsix') --force;if($LASTEXITCODE -ne 0){throw 'VS Code refused restoration of the newer extension.'}}}
$recover={& (Join-Path $root 'Invoke-B122Current.ps1') -InstallRoot $root}
$rolled=Invoke-B122AtomicActivation -InstallRoot $root -VersionId $targetVersion -PriorState $before -InstallExtension $installExtension -WaitForHealth $health -ConfigureAutostart $noop -RestoreExtension $restoreExtension -RestoreAutostart $noop -RecoverPrior $recover
[ordered]@{ schema='sxsy-b122.install-result'; version=1; status='rolled_back'; sourceCommit=[string]$rolled.current; previous=[string]$rolled.previous } | ConvertTo-Json -Compress
