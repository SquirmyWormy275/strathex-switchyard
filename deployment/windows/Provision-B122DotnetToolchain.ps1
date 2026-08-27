[CmdletBinding()]
param(
  [string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [switch]$VerifyExisting,
  [switch]$UseExistingPackageCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Get-Sha256([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Get-Sha512([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA512).Hash.ToLowerInvariant()}
function Assert-Child([string]$Root,[string]$Path){
  $rootFull=[IO.Path]::GetFullPath($Root).TrimEnd('\')+'\';$pathFull=[IO.Path]::GetFullPath($Path)
  if(-not$pathFull.StartsWith($rootFull,[StringComparison]::OrdinalIgnoreCase)){throw "Toolchain path escapes the repository: $pathFull"}
}
function Write-Utf8NoBom([string]$Path,[string]$Text){[IO.File]::WriteAllText($Path,$Text,(New-Object Text.UTF8Encoding($false)))}

$repo=[IO.Path]::GetFullPath($RepositoryRoot)
$manifestPath=Join-Path $PSScriptRoot 'dotnet-toolchain.json'
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
if($manifest.schema-cne'sxsy-b122.dotnet-toolchain'-or$manifest.version-ne1-or$manifest.sdkVersion-cne'8.0.424'-or$manifest.sdkArchive.source-cne'https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.424/dotnet-sdk-8.0.424-win-x64.zip'-or$manifest.sdkArchive.sha512-cnotmatch'^[0-9a-f]{128}$'){throw 'The reviewed .NET SDK archive manifest is invalid.'}
$packages=@($manifest.runtimePackages)+@($manifest.buildPackages)
if($packages.Count-ne4-or@($packages.id|Sort-Object -Unique).Count-ne4-or@($packages|Where-Object{$_.version-cne'8.0.30'-or$_.sha256-cnotmatch'^[0-9a-f]{64}$'}).Count){throw 'The reviewed .NET package manifest is incomplete or ambiguous.'}

$tools=Join-Path $repo '.tools';$dotnetRoot=Join-Path $tools 'dotnet';$dotnetExe=Join-Path $dotnetRoot 'dotnet.exe';$feed=Join-Path $tools 'nuget-feed';$cache=Join-Path $tools 'nuget-packages';$config=Join-Path $tools 'NuGet.Config'
foreach($path in @($tools,$dotnetRoot,$dotnetExe,$feed,$cache,$config)){Assert-Child $repo $path}
$configText="<?xml version=`"1.0`" encoding=`"utf-8`"?>`n<configuration>`n  <packageSources>`n    <clear />`n  </packageSources>`n</configuration>`n"

if(-not$VerifyExisting){
  if(Test-Path -LiteralPath $tools){throw "Refusing to replace an existing repository toolchain: $tools"}
  $stage=Join-Path $repo ('.tools-stage-'+[guid]::NewGuid().ToString('N'));Assert-Child $repo $stage
  try{
    New-Item -ItemType Directory -Path $stage,(Join-Path $stage 'dotnet'),(Join-Path $stage 'nuget-feed'),(Join-Path $stage 'nuget-packages')|Out-Null
    $sdkArchive=Join-Path $stage 'dotnet-sdk.zip'
    Invoke-WebRequest -UseBasicParsing -Uri ([string]$manifest.sdkArchive.source) -OutFile $sdkArchive
    if((Get-Sha512 $sdkArchive)-cne[string]$manifest.sdkArchive.sha512){throw 'The downloaded .NET SDK archive digest did not match the reviewed value.'}
    Expand-Archive -LiteralPath $sdkArchive -DestinationPath (Join-Path $stage 'dotnet')
    if((Get-Sha256 (Join-Path $stage 'dotnet\dotnet.exe'))-cne[string]$manifest.dotnetExeSha256){throw 'The extracted .NET host digest did not match the reviewed value.'}
    foreach($package in $packages){
      $name=([string]$package.id)+'.'+([string]$package.version)+'.nupkg';$path=Join-Path $stage "nuget-feed\$name"
      $uri='https://api.nuget.org/v3-flatcontainer/'+([string]$package.id).ToLowerInvariant()+'/'+([string]$package.version).ToLowerInvariant()+'/'+$name.ToLowerInvariant()
      Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $path
      if((Get-Sha256 $path)-cne[string]$package.sha256){throw "The downloaded package digest did not match the reviewed value: $($package.id)"}
    }
    Write-Utf8NoBom (Join-Path $stage 'NuGet.Config') $configText
    if((Get-Sha256 (Join-Path $stage 'NuGet.Config'))-cne[string]$manifest.nugetConfigSha256){throw 'The generated offline NuGet configuration digest is wrong.'}
    $projectRelatives=@(
      'firmware\windows-hid-helper\Strathex.B122.RawHidHelper.csproj',
      'apps\windows-companion\sandbox-helper\Sxsy.B122.SandboxHelper.csproj',
      'apps\windows-companion\repository-runner-helper\Sxsy.B122.RepositoryRunner.csproj',
      'apps\windows-companion\companion-lifecycle-helper\Sxsy.B122.CompanionLifecycleHelper.csproj',
      'apps\windows-companion\sandbox-lifecycle-helper\Sxsy.B122.SandboxLifecycleHelper.csproj',
      'apps\windows-companion\provider-desktop-helper\Sxsy.B122.ProviderDesktopHelper.csproj',
      'apps\windows-companion\voice-helper\Sxsy.B122.VoiceHelper.csproj'
    )
    $projects=@($projectRelatives|ForEach-Object{$path=Join-Path $repo $_;if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "A reviewed native project is missing: $_"};Get-Item -LiteralPath $path})
    foreach($project in $projects){
      & (Join-Path $stage 'dotnet\dotnet.exe') restore $project.FullName --source (Join-Path $stage 'nuget-feed') --packages (Join-Path $stage 'nuget-packages') --configfile (Join-Path $stage 'NuGet.Config') --disable-parallel
      if($LASTEXITCODE-ne0){throw "Offline package-cache preparation failed: $($project.FullName)"}
    }
    Remove-Item -LiteralPath $sdkArchive -Force
    Move-Item -LiteralPath $stage -Destination $tools
  }finally{if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}}
}elseif($UseExistingPackageCache){
  New-Item -ItemType Directory -Path $feed -Force|Out-Null
  foreach($package in $packages){
    $name=([string]$package.id)+'.'+([string]$package.version)+'.nupkg';$source=Join-Path $cache (([string]$package.id)+'\'+([string]$package.version)+'\'+$name);$destination=Join-Path $feed $name
    if((Get-Sha256 $source)-cne[string]$package.sha256){throw "The cached package digest is wrong: $($package.id)"}
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
}

foreach($required in @($dotnetExe,$feed,$cache,$config)){if(-not(Test-Path -LiteralPath $required)){throw "A provisioned toolchain input is missing: $required"}}
if((Get-Sha256 $dotnetExe)-cne[string]$manifest.dotnetExeSha256-or(Get-Sha256 $config)-cne[string]$manifest.nugetConfigSha256){throw 'The provisioned .NET host or configuration digest is wrong.'}
foreach($package in $packages){$name=([string]$package.id)+'.'+([string]$package.version)+'.nupkg';if((Get-Sha256 (Join-Path $feed $name))-cne[string]$package.sha256){throw "The provisioned feed package digest is wrong: $($package.id)"}}
if((@(& $dotnetExe --version)-join'').Trim()-cne[string]$manifest.sdkVersion){throw 'The provisioned .NET SDK version is wrong.'}
[ordered]@{schema='sxsy-b122.dotnet-toolchain-provisioning';version=1;status='passed';sdkVersion=[string]$manifest.sdkVersion;packageCount=$packages.Count;offlineFeed=$true}|ConvertTo-Json -Compress
