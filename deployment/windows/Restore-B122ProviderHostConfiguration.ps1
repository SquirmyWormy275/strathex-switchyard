[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
param([Parameter(Mandatory=$true)][string]$ConfigurationPath,[switch]$Force)
$ErrorActionPreference='Stop'
$path=[IO.Path]::GetFullPath($ConfigurationPath);$backup=$path+'.previous'
if(-not(Test-Path -LiteralPath $backup -PathType Leaf)){throw 'No previous provider-host configuration is available.'}
& (Join-Path $PSScriptRoot 'Test-B122ProviderHostConfiguration.ps1') -ConfigurationPath $backup|Out-Null
if(-not $Force -and -not $PSCmdlet.ShouldProcess($path,'Atomically restore the previous provider-host configuration')){return}
$parent=Split-Path -Parent $path;$temporary=Join-Path $parent ('.provider-host-rollback-'+[guid]::NewGuid().ToString('N')+'.tmp')
try{
  if(Test-Path -LiteralPath $path){Move-Item -LiteralPath $path -Destination $temporary -Force}
  Move-Item -LiteralPath $backup -Destination $path -Force
  if(Test-Path -LiteralPath $temporary){Move-Item -LiteralPath $temporary -Destination $backup -Force}
}catch{
  if(-not(Test-Path -LiteralPath $path) -and (Test-Path -LiteralPath $temporary)){Move-Item -LiteralPath $temporary -Destination $path -Force}
  throw
}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
[ordered]@{schema='sxsy-b122.provider-host-configuration-rollback';version=1;status='restored';configurationPath=$path;previousPreserved=(Test-Path -LiteralPath $backup -PathType Leaf)}|ConvertTo-Json -Compress
