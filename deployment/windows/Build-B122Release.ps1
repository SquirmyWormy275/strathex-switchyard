[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$NodeRuntimeZip,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$NodeRuntimeSha256,
  [Parameter(Mandatory = $true)][string]$NodeRuntimeSourceUri,
  [string]$OutputDirectory,
  [string]$SandboxHelperPath,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$SandboxHelperSha256,
  [string]$SandboxLifecycleHelperPath,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$SandboxLifecycleHelperSha256,
  [string]$RepositoryRuntimeHelperPath,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$RepositoryRuntimeHelperSha256,
  [string]$CompanionLifecycleHelperPath,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$CompanionLifecycleHelperSha256,
  [string]$RawHidHelperPath,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$RawHidHelperSha256,
  [string]$ProviderDesktopHelperPath,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ProviderDesktopHelperSha256,
  [string]$VoiceHelperPath,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$VoiceHelperSha256,
  [switch]$SkipVerification
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$integrityModule = Join-Path $PSScriptRoot 'B122ReleaseIntegrity.psm1'
Import-Module -Name $integrityModule -Force
if(-not('SxsyB122ReleaseBuildV1.FileSystemIdentity'-as[type])){
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace SxsyB122ReleaseBuildV1 {
  public static class FileSystemIdentity {
    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)] struct ByHandleFileInformation { public uint Attributes; public FileTime Creation; public FileTime Access; public FileTime Write; public uint VolumeSerial; public uint SizeHigh; public uint SizeLow; public uint Links; public uint FileIndexHigh; public uint FileIndexLow; }
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr handle,out ByHandleFileInformation information);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static string Get(string path) {
      IntPtr handle=CreateFileW(path,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero); if(handle==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try { ByHandleFileInformation information; if(!GetFileInformationByHandle(handle,out information)) throw new Win32Exception(Marshal.GetLastWin32Error()); return information.VolumeSerial.ToString("x8")+":"+information.FileIndexHigh.ToString("x8")+information.FileIndexLow.ToString("x8"); }
      finally { CloseHandle(handle); }
    }
  }
}
'@
}
$sourceCommit = Get-B122ReleaseSourceCommit -RepositoryRoot $repo
Assert-B122ReleaseSourceState -RepositoryRoot $repo -ExpectedCommit $sourceCommit | Out-Null
$OutputDirectory = if ($OutputDirectory) { $OutputDirectory } else { Join-Path $repo 'artifacts\b122-windows' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
$bootstrapTrustSidecar=$output+'.bootstrap-trust.json'
if(Test-Path -LiteralPath $bootstrapTrustSidecar){throw 'The adjacent bootstrap trust receipt already exists; choose a new exclusive output leaf.'}
Set-Location -LiteralPath $repo
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($Path), $Content, $utf8NoBom)
}
function Write-DurableBytes([string]$Path,[byte[]]$Bytes){$stream=New-Object IO.FileStream([IO.Path]::GetFullPath($Path),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough);try{$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}}
function Assert-Child([string]$Parent, [string]$Child) {
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $childFull = [IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing path outside the release root: $childFull" }
}
function Assert-B122NoReparseAncestors([string]$Path) {
  $full=[IO.Path]::GetFullPath($Path);$drive=[IO.Path]::GetPathRoot($full);$relative=$full.Substring($drive.Length);$cursor=$drive
  foreach($part in @($relative -split '[\\/]'|Where-Object{$_})){
    $cursor=Join-Path $cursor $part
    if(-not(Test-Path -LiteralPath $cursor)){continue}
    $item=Get-Item -LiteralPath $cursor -Force
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "Release output contains a reparse/junction ancestor: $cursor"}
  }
}
function Set-B122ProtectedBuildOutputAcl([string]$Path){
  $root=[IO.Path]::GetFullPath($Path).TrimEnd('\');Assert-B122NoReparseAncestors -Path $root;$info=New-Object IO.DirectoryInfo($root)
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User;$system=New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::LocalSystemSid,$null)
  $security=New-Object Security.AccessControl.DirectorySecurity;$security.SetOwner($user);$security.SetAccessRuleProtection($true,$false)
  $inherit=[Security.AccessControl.InheritanceFlags]::ContainerInherit-bor[Security.AccessControl.InheritanceFlags]::ObjectInherit
  foreach($sid in @($user,$system)){$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);[void]$security.AddAccessRule($rule)}
  if('System.IO.FileSystemAclExtensions'-as[type]){[IO.FileSystemAclExtensions]::SetAccessControl($info,$security)}else{$info.SetAccessControl($security)}
  Assert-B122ProtectedBuildOutputAcl -Path $root
}
function Assert-B122ProtectedBuildOutputAcl([string]$Path){
  $root=[IO.Path]::GetFullPath($Path).TrimEnd('\');Assert-B122NoReparseAncestors -Path $root;$info=New-Object IO.DirectoryInfo($root);$sections=[Security.AccessControl.AccessControlSections]::Owner-bor[Security.AccessControl.AccessControlSections]::Access
  $security=if('System.IO.FileSystemAclExtensions'-as[type]){[IO.FileSystemAclExtensions]::GetAccessControl($info,$sections)}else{$info.GetAccessControl($sections)}
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User;$system=New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::LocalSystemSid,$null);$owner=$security.GetOwner([Security.Principal.SecurityIdentifier])
  if(-not$owner.Equals($user)-or-not$security.AreAccessRulesProtected){throw 'The release output does not have a protected current-user DACL.'}
  $allowed=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase);[void]$allowed.Add($user.Value);[void]$allowed.Add($system.Value);$full=@{}
  foreach($rule in @($security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))){$sid=[string]$rule.IdentityReference.Value;if($rule.IsInherited-or-not$allowed.Contains($sid)-or$rule.AccessControlType-ne[Security.AccessControl.AccessControlType]::Allow){throw 'The release output DACL grants or inherits authority outside current-user and SYSTEM.'};if(($rule.FileSystemRights-band[Security.AccessControl.FileSystemRights]::FullControl)-eq[Security.AccessControl.FileSystemRights]::FullControl){$full[$sid]=$true}}
  if(-not$full[$user.Value]-or-not$full[$system.Value]){throw 'The release output DACL is missing exact current-user or SYSTEM authority.'}
}
function Get-B122ConcreteFiles([string]$Path){$queue=New-Object Collections.Generic.Queue[string];$files=New-Object Collections.Generic.List[IO.FileInfo];$queue.Enqueue([IO.Path]::GetFullPath($Path));while($queue.Count){$directory=$queue.Dequeue();foreach($item in @(Get-ChildItem -LiteralPath $directory -Force|Sort-Object Name)){if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw "Release output contains a reparse entry: $($item.FullName)"};if($item.PSIsContainer){$queue.Enqueue($item.FullName)}elseif($item-is[IO.FileInfo]){$files.Add($item)}else{throw "Release output contains an unsupported filesystem entry: $($item.FullName)"}}};return $files.ToArray()}
function Remove-B122VerifiedWorkspaceJunction([string]$Link,[string]$ExpectedTarget){
  $linkFull=[IO.Path]::GetFullPath($Link);$targetFull=[IO.Path]::GetFullPath($ExpectedTarget);Assert-Child $buildRoot $linkFull;Assert-Child $buildRoot $targetFull
  $linkParent=Split-Path -Parent $linkFull;Assert-B122NoReparseAncestors -Path $linkParent
  if(-not(Test-Path -LiteralPath $linkFull)){throw "The reviewed npm workspace junction is missing: $linkFull"}
  $linkItem=Get-Item -LiteralPath $linkFull -Force;$targets=@($linkItem.Target)
  if(-not$linkItem.PSIsContainer-or($linkItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-eq0-or$linkItem.LinkType-cne'Junction'-or$targets.Count-ne1){throw "The reviewed npm workspace entry is not one exact junction: $linkFull"}
  $reportedTarget=[string]$targets[0];if(-not[IO.Path]::IsPathRooted($reportedTarget)){$reportedTarget=Join-Path $linkParent $reportedTarget};$reportedTarget=[IO.Path]::GetFullPath($reportedTarget)
  if(-not$reportedTarget.Equals($targetFull,[StringComparison]::OrdinalIgnoreCase)){throw "The reviewed npm workspace junction has an unexpected target: $linkFull"}
  $targetIdentity=[SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($targetFull);[IO.Directory]::Delete($linkFull,$false)
  if(Test-Path -LiteralPath $linkFull){throw "The reviewed npm workspace junction survived unlink: $linkFull"}
  if([SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($targetFull)-cne$targetIdentity){throw "The npm workspace target identity changed during junction unlink: $targetFull"}
}
function Remove-B122OwnedBuildTree([string]$Path){
  $tree=[IO.Path]::GetFullPath($Path).TrimEnd('\');if(-not(Test-Path -LiteralPath $tree)){return};Assert-Child $output $tree;Assert-B122ProtectedBuildOutputAcl -Path $output;Assert-B122NoReparseAncestors -Path $tree
  $outputIdentity=[SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($output);$treeItem=Get-Item -LiteralPath $tree -Force;if(-not$treeItem.PSIsContainer-or($treeItem.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'Build cleanup target is not a concrete owned directory.'};$treeIdentity=[SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($tree)
  $quarantine=Join-Path $output ('.cleanup-'+[guid]::NewGuid().ToString('N'));if(Test-Path -LiteralPath $quarantine){throw 'Build cleanup quarantine collision.'}
  if([SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($output)-cne$outputIdentity-or[SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($tree)-cne$treeIdentity){throw 'Build cleanup target identity changed before quarantine.'}
  Move-Item -LiteralPath $tree -Destination $quarantine
  if([SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($output)-cne$outputIdentity-or-not(Test-Path -LiteralPath $quarantine -PathType Container)-or[SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($quarantine)-cne$treeIdentity){throw 'Build cleanup quarantine did not retain the target directory identity.'}
  $queue=New-Object Collections.Generic.Queue[string];$directories=New-Object Collections.Generic.List[object];$files=New-Object Collections.Generic.List[object];$queue.Enqueue($quarantine)
  while($queue.Count){$directory=$queue.Dequeue();Assert-B122NoReparseAncestors -Path $directory;$directoryItem=Get-Item -LiteralPath $directory -Force;if(-not$directoryItem.PSIsContainer-or($directoryItem.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw "Build cleanup inventory encountered an unsafe quarantined directory: $directory"};$relativeDirectory=if($directory.Length-eq$quarantine.Length){''}else{$directory.Substring($quarantine.Length+1)};$directories.Add([pscustomobject]@{relative=$relativeDirectory;identity=[SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($directory)});foreach($entry in @(Get-ChildItem -LiteralPath $directory -Force)){if(($entry.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw "Build cleanup inventory encountered a reparse point: $($entry.FullName)"};if($entry.PSIsContainer){$queue.Enqueue($entry.FullName)}elseif($entry-is[IO.FileInfo]){$files.Add([pscustomobject]@{relative=$entry.FullName.Substring($quarantine.Length+1);identity=[SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($entry.FullName)})}else{throw "Build cleanup inventory encountered an unsupported filesystem entry: $($entry.FullName)"}}}
  foreach($record in $files){$leaf=Join-Path $quarantine $record.relative;Assert-B122NoReparseAncestors -Path $leaf;if([SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($leaf)-cne$record.identity){throw "Build cleanup file identity changed inside quarantine: $leaf"};Remove-Item -LiteralPath $leaf -Force}
  foreach($record in @($directories|Sort-Object {$_.relative.Length} -Descending)){if([string]::IsNullOrEmpty([string]$record.relative)){continue};$directory=Join-Path $quarantine $record.relative;Assert-B122NoReparseAncestors -Path $directory;if([SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($directory)-cne$record.identity){throw "Build cleanup directory identity changed inside quarantine: $directory"};Remove-Item -LiteralPath $directory -Force}
  Assert-B122NoReparseAncestors -Path $quarantine;if([SxsyB122ReleaseBuildV1.FileSystemIdentity]::Get($quarantine)-cne$treeIdentity-or@(Get-ChildItem -LiteralPath $quarantine -Force).Count){throw 'Build cleanup quarantine is not the empty inventoried directory.'};Remove-Item -LiteralPath $quarantine -Force
}
Assert-Child ([IO.Path]::GetFullPath((Join-Path $repo 'artifacts'))) $output
Assert-B122NoReparseAncestors -Path $output
$artifactsRoot=[IO.Path]::GetFullPath((Join-Path $repo 'artifacts')).TrimEnd('\')
if($output.TrimEnd('\').Equals($artifactsRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Release output must be one exclusive product leaf below artifacts, never the artifacts root.'}
$nodeRuntimeArchive = [IO.Path]::GetFullPath($NodeRuntimeZip)
if (-not (Test-Path -LiteralPath $nodeRuntimeArchive -PathType Leaf)) { throw 'The reviewed official Node runtime archive is missing.' }
if (-not ((Get-FileHash -LiteralPath $nodeRuntimeArchive -Algorithm SHA256).Hash.Equals($NodeRuntimeSha256, [StringComparison]::OrdinalIgnoreCase))) { throw 'The Node runtime archive digest does not match the reviewed value.' }
$nodeSource = [Uri]$NodeRuntimeSourceUri
if ($nodeSource.Scheme -cne 'https' -or $nodeSource.Host -cne 'nodejs.org' -or $nodeSource.Query -or $nodeSource.Fragment -or $nodeSource.UserInfo -or $nodeSource.AbsoluteUri -cne $NodeRuntimeSourceUri -or $nodeSource.AbsolutePath -notmatch '^/dist/v\d+\.\d+\.\d+/node-v\d+\.\d+\.\d+-win-x64\.zip$' -or [IO.Path]::GetFileName($nodeRuntimeArchive) -cne [IO.Path]::GetFileName($nodeSource.AbsolutePath)) { throw 'The Node runtime source must be the exact matching official nodejs.org Windows x64 archive URL.' }
if(Test-Path -LiteralPath $output){$outputItem=Get-Item -LiteralPath $output -Force;if(-not$outputItem.PSIsContainer -or ($outputItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Release output must be a concrete directory.'};if(@(Get-ChildItem -LiteralPath $output -Force).Count){throw 'Release output already contains data. Choose a new empty exclusive output leaf; the builder never recursively replaces an existing tree.'}}
else{New-Item -ItemType Directory -Path $output|Out-Null}
Set-B122ProtectedBuildOutputAcl -Path $output
$outputSentinelPayload=[ordered]@{schema='sxsy-b122.build-output-ownership';version=1;product='SXSY-B122';canonicalOutput=$output;repositoryRoot=$repo;buildId=[guid]::NewGuid().ToString('D');sourceCommit=$sourceCommit;createdAt=(Get-Date).ToUniversalTime().ToString('o')}
$outputSentinelBytes=[Text.Encoding]::UTF8.GetBytes(($outputSentinelPayload|ConvertTo-Json -Compress));$outputSentinelDigest=[Security.Cryptography.SHA256]::Create().ComputeHash($outputSentinelBytes);Add-Type -AssemblyName System.Security;$outputSentinelProof=[Security.Cryptography.ProtectedData]::Protect($outputSentinelDigest,[Text.Encoding]::UTF8.GetBytes($output.ToLowerInvariant()),[Security.Cryptography.DataProtectionScope]::CurrentUser)
Write-DurableBytes (Join-Path $output '.sxsy-b122-build-output.json') ([Text.Encoding]::UTF8.GetBytes(([ordered]@{schema='sxsy-b122.dpapi-build-output';version=1;payload=[Convert]::ToBase64String($outputSentinelBytes);proof=[Convert]::ToBase64String($outputSentinelProof)}|ConvertTo-Json -Compress)))
$openedOutputSentinel=[Security.Cryptography.ProtectedData]::Unprotect($outputSentinelProof,[Text.Encoding]::UTF8.GetBytes($output.ToLowerInvariant()),[Security.Cryptography.DataProtectionScope]::CurrentUser)
$sentinelDifference=if($openedOutputSentinel.Length-ne$outputSentinelDigest.Length){1}else{0};for($sentinelIndex=0;$sentinelIndex-lt[Math]::Min($openedOutputSentinel.Length,$outputSentinelDigest.Length);$sentinelIndex++){$sentinelDifference=$sentinelDifference-bor($openedOutputSentinel[$sentinelIndex]-bxor$outputSentinelDigest[$sentinelIndex])}
if($sentinelDifference-ne0){throw 'The release build-output ownership sentinel could not be authenticated after its durable write.'}
$runtimeExtract = Join-Path $output '.node-runtime'
Assert-Child $output $runtimeExtract
Expand-Archive -LiteralPath $nodeRuntimeArchive -DestinationPath $runtimeExtract
$nodes=@(Get-ChildItem -LiteralPath $runtimeExtract -Filter node.exe -File -Recurse)
if($nodes.Count -ne 1){throw 'The reviewed Node runtime must contain exactly one node.exe.'}
$node=$nodes[0];$reviewedRuntimeBin=Split-Path -Parent $node.FullName
$nodeLicense=Get-Item -LiteralPath (Join-Path $reviewedRuntimeBin 'LICENSE') -Force -ErrorAction SilentlyContinue
$npmCli=Get-Item -LiteralPath (Join-Path $reviewedRuntimeBin 'node_modules\npm\bin\npm-cli.js') -Force -ErrorAction SilentlyContinue
if($null-eq$nodeLicense-or$nodeLicense.PSIsContainer-or$null-eq$npmCli-or$npmCli.PSIsContainer){throw 'The reviewed Node runtime is missing its exact root LICENSE or npm-cli.js.'}
foreach($runtimeFile in @($node,$nodeLicense,$npmCli)){if(($runtimeFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'The reviewed Node runtime contains a reparse file.'}}
$reviewedNpmCommand=Join-Path $reviewedRuntimeBin 'npm.cmd'
if(-not(Test-Path -LiteralPath $reviewedNpmCommand -PathType Leaf)-or(Get-Item -LiteralPath $reviewedNpmCommand -Force).Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'The reviewed Node runtime does not contain its concrete npm command shim.'}
$programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
$programFilesX86=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
$systemDirectory=[IO.Path]::GetFullPath([Environment]::SystemDirectory)
$windowsDirectory=[IO.Directory]::GetParent($systemDirectory).FullName
$trustedGitExe=[IO.Path]::GetFullPath((Join-Path $programFiles 'Git\cmd\git.exe'))
foreach($trustedBuildExecutable in @($trustedGitExe,(Join-Path $systemDirectory 'cmd.exe'))){
  Assert-B122NoReparseAncestors -Path $trustedBuildExecutable
  if(-not(Test-Path -LiteralPath $trustedBuildExecutable -PathType Leaf)-or((Get-Item -LiteralPath $trustedBuildExecutable -Force).Attributes-band[IO.FileAttributes]::ReparsePoint)){throw "A required fixed build executable is missing or unsafe: $trustedBuildExecutable"}
}
$trustedGitSha256=(Get-FileHash -LiteralPath $trustedGitExe -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceSnapshotArchive = Join-Path $output '.source-commit.zip'
$buildRoot = Join-Path $output '.source-tree'
Assert-Child $output $sourceSnapshotArchive
Assert-Child $output $buildRoot
& $trustedGitExe -C $repo archive --format=zip --output $sourceSnapshotArchive $sourceCommit
if ($LASTEXITCODE -ne 0) { throw 'The pinned source-commit archive could not be created.' }
Expand-Archive -LiteralPath $sourceSnapshotArchive -DestinationPath $buildRoot
$sourceScripts = Join-Path $buildRoot 'deployment\windows'
Set-Location -LiteralPath $buildRoot

$dotnetToolchainManifestPath=Join-Path $sourceScripts 'dotnet-toolchain.json'
if(-not(Test-Path -LiteralPath $dotnetToolchainManifestPath -PathType Leaf)-or((Get-Item -LiteralPath $dotnetToolchainManifestPath -Force).Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'The source commit omits the reviewed .NET toolchain manifest.'}
$dotnetToolchainManifestBytes=[IO.File]::ReadAllBytes($dotnetToolchainManifestPath)
$dotnetToolchainHasher=[Security.Cryptography.SHA256]::Create();try{$dotnetToolchainManifestSha256=([BitConverter]::ToString($dotnetToolchainHasher.ComputeHash($dotnetToolchainManifestBytes))).Replace('-','').ToLowerInvariant()}finally{$dotnetToolchainHasher.Dispose()}
$dotnetToolchain=[Text.Encoding]::UTF8.GetString($dotnetToolchainManifestBytes)|ConvertFrom-Json
if($dotnetToolchain.schema-cne'sxsy-b122.dotnet-toolchain'-or$dotnetToolchain.version-ne1-or$dotnetToolchain.sdkVersion-cne'8.0.424'-or$dotnetToolchain.runtimeVersion-cne'8.0.30'-or$dotnetToolchain.dotnetExeSha256-notmatch'^[0-9a-f]{64}$'-or$dotnetToolchain.nugetConfigSha256-notmatch'^[0-9a-f]{64}$'){throw 'The reviewed .NET toolchain manifest is invalid.'}
$expectedRuntimePackageIds=@('microsoft.aspnetcore.app.runtime.win-x64','microsoft.netcore.app.runtime.win-x64','microsoft.windowsdesktop.app.runtime.win-x64')
$expectedBuildPackageIds=@('microsoft.net.illink.tasks')
$runtimePackageRecords=@($dotnetToolchain.runtimePackages)
if($runtimePackageRecords.Count-ne$expectedRuntimePackageIds.Count-or@($runtimePackageRecords|Where-Object{$_.id-notin$expectedRuntimePackageIds-or$_.version-cne$dotnetToolchain.runtimeVersion-or$_.sha256-notmatch'^[0-9a-f]{64}$'}).Count-ne0-or@($runtimePackageRecords.id|Sort-Object -Unique).Count-ne$expectedRuntimePackageIds.Count){throw 'The reviewed .NET runtime-package manifest is incomplete or ambiguous.'}
$buildPackageRecords=@($dotnetToolchain.buildPackages)
if($buildPackageRecords.Count-ne$expectedBuildPackageIds.Count-or@($buildPackageRecords|Where-Object{$_.id-notin$expectedBuildPackageIds-or$_.version-cne$dotnetToolchain.runtimeVersion-or$_.sha256-notmatch'^[0-9a-f]{64}$'}).Count-ne0){throw 'The reviewed .NET build-package manifest is incomplete or ambiguous.'}
$dotnetExe=[IO.Path]::GetFullPath((Join-Path $repo '.tools\dotnet\dotnet.exe'))
$trustedNuGetConfig=[IO.Path]::GetFullPath((Join-Path $repo '.tools\NuGet.Config'))
$trustedNuGetFeed=[IO.Path]::GetFullPath((Join-Path $repo '.tools\nuget-feed'))
foreach($toolchainPath in @($dotnetExe,$trustedNuGetConfig,$trustedNuGetFeed)){Assert-B122NoReparseAncestors -Path $toolchainPath;if(-not(Test-Path -LiteralPath $toolchainPath)){throw "A reviewed local .NET toolchain input is missing: $toolchainPath"}}
if(-not(Test-Path -LiteralPath $dotnetExe -PathType Leaf)-or-not(Test-Path -LiteralPath $trustedNuGetConfig -PathType Leaf)-or-not(Test-Path -LiteralPath $trustedNuGetFeed -PathType Container)){throw 'The reviewed local .NET toolchain has the wrong filesystem type.'}
$dotnetExeSha256=(Get-FileHash -LiteralPath $dotnetExe -Algorithm SHA256).Hash.ToLowerInvariant()
$nugetConfigSha256=(Get-FileHash -LiteralPath $trustedNuGetConfig -Algorithm SHA256).Hash.ToLowerInvariant()
if($dotnetExeSha256-cne[string]$dotnetToolchain.dotnetExeSha256-or$nugetConfigSha256-cne[string]$dotnetToolchain.nugetConfigSha256){throw 'The local .NET host or offline NuGet configuration does not match the reviewed toolchain manifest.'}
$verifiedRuntimePackages=[Collections.Generic.List[object]]::new()
foreach($runtimePackage in @($runtimePackageRecords)+@($buildPackageRecords)){
  $packagePath=Join-Path $trustedNuGetFeed (([string]$runtimePackage.id)+'.'+([string]$runtimePackage.version)+'.nupkg')
  Assert-B122NoReparseAncestors -Path $packagePath
  if(-not(Test-Path -LiteralPath $packagePath -PathType Leaf)-or((Get-Item -LiteralPath $packagePath -Force).Attributes-band[IO.FileAttributes]::ReparsePoint)){throw "A reviewed .NET runtime package is missing or unsafe: $($runtimePackage.id)"}
  $packageDigest=(Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if($packageDigest-cne[string]$runtimePackage.sha256){throw "A reviewed .NET runtime package digest is wrong: $($runtimePackage.id)"}
  if($runtimePackage.id-in$expectedRuntimePackageIds){$verifiedRuntimePackages.Add([ordered]@{id=[string]$runtimePackage.id;version=[string]$runtimePackage.version;sha256=$packageDigest})}
}

$buildProfile=Join-Path $output '.build-profile'
$buildProfileLocal=Join-Path $buildProfile 'AppData\Local'
$buildProfileRoaming=Join-Path $buildProfile 'AppData\Roaming'
$buildTemp=Join-Path $buildProfileLocal 'Temp'
$npmCache=Join-Path $buildProfileLocal 'npm-cache'
$npmPrefix=Join-Path $buildProfileLocal 'npm-prefix'
$dotnetCliHome=Join-Path $buildProfileLocal 'dotnet-home'
$trustedNuGetPackages=Join-Path $buildProfileLocal 'nuget-packages'
$testTempRoot=Join-Path $output '.test-temp'
foreach($directory in @($buildProfile,$buildProfileLocal,$buildProfileRoaming,$buildTemp,$npmCache,$npmPrefix,$dotnetCliHome,$trustedNuGetPackages,$testTempRoot)){New-Item -ItemType Directory -Path $directory -Force|Out-Null;Assert-B122NoReparseAncestors -Path $directory}
$npmUserConfig=Join-Path $buildProfile 'npm-userconfig'
$npmGlobalConfig=Join-Path $buildProfile 'npm-globalconfig'
Write-Utf8NoBom $npmUserConfig "`n"
Write-Utf8NoBom $npmGlobalConfig "`n"
$trustedPowerShellDirectory=if([IO.Path]::GetFileName((Get-Process -Id $PID).Path)-ieq'pwsh.exe'){Split-Path -Parent (Get-Process -Id $PID).Path}else{Join-Path $systemDirectory 'WindowsPowerShell\v1.0'}
$windowsPowerShellDirectory=Join-Path $systemDirectory 'WindowsPowerShell\v1.0'
$isolatedPath=@($reviewedRuntimeBin,(Join-Path $buildRoot 'node_modules\.bin'),(Split-Path -Parent $dotnetExe),(Split-Path -Parent $trustedGitExe),$trustedPowerShellDirectory,$windowsPowerShellDirectory,$systemDirectory)|Select-Object -Unique
$isolatedPath=$isolatedPath-join';'
$buildEnvironment=[ordered]@{
  'PATH'=$isolatedPath;'PATHEXT'='.COM;.EXE;.BAT;.CMD';'SystemRoot'=$windowsDirectory;'WINDIR'=$windowsDirectory;'ComSpec'=(Join-Path $systemDirectory 'cmd.exe');'OS'='Windows_NT'
  'ProgramFiles'=$programFiles;'ProgramFiles(x86)'=$programFilesX86;'ProgramData'=[Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
  'USERPROFILE'=$buildProfile;'HOME'=$buildProfile;'APPDATA'=$buildProfileRoaming;'LOCALAPPDATA'=$buildProfileLocal;'TEMP'=$buildTemp;'TMP'=$buildTemp
  'npm_config_cache'=$npmCache;'npm_config_userconfig'=$npmUserConfig;'npm_config_globalconfig'=$npmGlobalConfig;'npm_config_prefix'=$npmPrefix;'npm_config_update_notifier'='false';'npm_config_audit'='false';'npm_config_fund'='false';'npm_config_scripts_prepend_node_path'='true';'npm_node_execpath'=$node.FullName;'npm_execpath'=$npmCli.FullName
  'DOTNET_ROOT'=(Split-Path -Parent $dotnetExe);'DOTNET_CLI_HOME'=$dotnetCliHome;'DOTNET_NOLOGO'='1';'DOTNET_SKIP_FIRST_TIME_EXPERIENCE'='1';'DOTNET_CLI_TELEMETRY_OPTOUT'='1';'DOTNET_MULTILEVEL_LOOKUP'='0';'NUGET_PACKAGES'=$trustedNuGetPackages;'SXSY_B122_NUGET_CONFIG'=$trustedNuGetConfig;'SXSY_B122_NUGET_FEED'=$trustedNuGetFeed;'SXSY_B122_TEST_TEMP_ROOT'=$testTempRoot;'MSBUILDDISABLENODEREUSE'='1'
  'GIT_CONFIG_NOSYSTEM'='1';'GIT_CONFIG_GLOBAL'='NUL';'GIT_TERMINAL_PROMPT'='0';'GCM_INTERACTIVE'='Never';'CI'='1';'NO_COLOR'='1'
}
function Invoke-B122WithIsolatedBuildEnvironment([scriptblock]$Action){
  $savedEnvironment=@{}
  foreach($entry in [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process).GetEnumerator()){$savedEnvironment[[string]$entry.Key]=[string]$entry.Value}
  try{
    foreach($name in @($savedEnvironment.Keys)){if(-not$name.StartsWith('=')){[Environment]::SetEnvironmentVariable($name,$null,[EnvironmentVariableTarget]::Process)}}
    foreach($entry in $buildEnvironment.GetEnumerator()){[Environment]::SetEnvironmentVariable([string]$entry.Key,[string]$entry.Value,[EnvironmentVariableTarget]::Process)}
    [Environment]::SetEnvironmentVariable('SXSY_B122_BUILD_SECRET_SENTINEL',$null,[EnvironmentVariableTarget]::Process)
    Remove-Item -LiteralPath 'Env:\SXSY_B122_BUILD_SECRET_SENTINEL' -ErrorAction SilentlyContinue
    if($null-ne[Environment]::GetEnvironmentVariable('SXSY_B122_BUILD_SECRET_SENTINEL',[EnvironmentVariableTarget]::Process)){throw 'The isolated build parent retained the secret sentinel.'}
    & $Action
  }finally{
    foreach($entry in [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process).GetEnumerator()){if(-not([string]$entry.Key).StartsWith('=')){[Environment]::SetEnvironmentVariable([string]$entry.Key,$null,[EnvironmentVariableTarget]::Process)}}
    foreach($entry in $savedEnvironment.GetEnumerator()){if(-not([string]$entry.Key).StartsWith('=')){[Environment]::SetEnvironmentVariable([string]$entry.Key,[string]$entry.Value,[EnvironmentVariableTarget]::Process)}}
  }
}
$secretSentinelPrevious=[Environment]::GetEnvironmentVariable('SXSY_B122_BUILD_SECRET_SENTINEL',[EnvironmentVariableTarget]::Process)
[Environment]::SetEnvironmentVariable('SXSY_B122_BUILD_SECRET_SENTINEL','must-not-reach-build-children',[EnvironmentVariableTarget]::Process)
try{
  $environmentProbe=Invoke-B122WithIsolatedBuildEnvironment { $probeOutput=@(& $node.FullName -e "if(process.env.SXSY_B122_BUILD_SECRET_SENTINEL)process.exit(23);process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))");[pscustomobject]@{exitCode=$LASTEXITCODE;output=($probeOutput-join'')} }
  if($environmentProbe.exitCode-ne0-or[Environment]::GetEnvironmentVariable('SXSY_B122_BUILD_SECRET_SENTINEL',[EnvironmentVariableTarget]::Process)-cne'must-not-reach-build-children'){throw 'The isolated build environment secret-sentinel probe failed.'}
  $buildEnvironmentNames=@($environmentProbe.output|ConvertFrom-Json)
  if($buildEnvironmentNames-contains'SXSY_B122_BUILD_SECRET_SENTINEL'){throw 'An ambient secret sentinel reached the isolated build child.'}
}finally{[Environment]::SetEnvironmentVariable('SXSY_B122_BUILD_SECRET_SENTINEL',$secretSentinelPrevious,[EnvironmentVariableTarget]::Process)}
$dotnetSdkVersion=(@(Invoke-B122WithIsolatedBuildEnvironment { & $dotnetExe --version })-join'').Trim()
$dotnetRuntimeInventory=@(Invoke-B122WithIsolatedBuildEnvironment { & $dotnetExe --list-runtimes })
if($dotnetSdkVersion-cne[string]$dotnetToolchain.sdkVersion){throw 'The reviewed .NET host did not select the pinned SDK from global.json.'}
foreach($runtimePackage in $verifiedRuntimePackages){$frameworkName=if($runtimePackage.id-eq'microsoft.netcore.app.runtime.win-x64'){'Microsoft.NETCore.App'}elseif($runtimePackage.id-eq'microsoft.windowsdesktop.app.runtime.win-x64'){'Microsoft.WindowsDesktop.App'}else{'Microsoft.AspNetCore.App'};if(@($dotnetRuntimeInventory|Where-Object{$_-match('^'+[regex]::Escape($frameworkName)+'\s+'+[regex]::Escape([string]$runtimePackage.version)+'\s+\[')}).Count-ne1){throw "The reviewed .NET host runtime inventory does not contain exactly one $frameworkName $($runtimePackage.version)."}}
function Invoke-B122PinnedNpm([string[]]$Arguments,[string]$FailureMessage){
  $exitCode=Invoke-B122WithIsolatedBuildEnvironment { & $node.FullName $npmCli.FullName @Arguments|Out-Host;return $LASTEXITCODE }
  if([int]$exitCode-ne0){throw $FailureMessage}
}
function Invoke-B122PinnedDotNetPublish([string]$Project,[string]$Destination,[string]$FailureMessage){
  Assert-Child $output $Destination
  $runtimeFrameworkVersion=[string]$dotnetToolchain.runtimeVersion
  $exitCode=Invoke-B122WithIsolatedBuildEnvironment {
    & $dotnetExe publish $Project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true "-p:RuntimeFrameworkVersion=$runtimeFrameworkVersion" "-p:RestorePackagesPath=$trustedNuGetPackages" -p:UseSharedCompilation=false --disable-build-servers --configfile $trustedNuGetConfig --source $trustedNuGetFeed -o $Destination|Out-Host
    return $LASTEXITCODE
  }
  if([int]$exitCode-ne0){throw $FailureMessage}
}
function Invoke-B122PinnedDotNetRestore([string]$Project,[string]$FailureMessage){
  $runtimeFrameworkVersion=[string]$dotnetToolchain.runtimeVersion
  $exitCode=Invoke-B122WithIsolatedBuildEnvironment {
    & $dotnetExe restore $Project -r win-x64 "-p:RuntimeFrameworkVersion=$runtimeFrameworkVersion" "-p:RestorePackagesPath=$trustedNuGetPackages" --disable-parallel --configfile $trustedNuGetConfig --source $trustedNuGetFeed|Out-Host
    return $LASTEXITCODE
  }
  if([int]$exitCode-ne0){throw $FailureMessage}
}
function Invoke-B122IsolatedCapture([string]$Executable,[string[]]$Arguments,[string]$FailureMessage){
  $result=Invoke-B122WithIsolatedBuildEnvironment { $captured=@(& $Executable @Arguments);[pscustomobject]@{exitCode=$LASTEXITCODE;output=($captured-join[Environment]::NewLine)} }
  if([int]$result.exitCode-ne0){throw $FailureMessage}
  return [string]$result.output
}
function Invoke-B122IsolatedHost([string]$Executable,[string[]]$Arguments,[string]$FailureMessage){
  $exitCode=Invoke-B122WithIsolatedBuildEnvironment { & $Executable @Arguments|Out-Host;return $LASTEXITCODE }
  if([int]$exitCode-ne0){throw $FailureMessage}
}
Invoke-B122PinnedNpm -Arguments @('ci','--ignore-scripts','--no-audit','--no-fund','--prefer-offline') -FailureMessage 'Pinned dependency installation from package-lock.json failed.'
$testHelperProjects=@(
  'apps\windows-companion\repository-runner-helper\Sxsy.B122.RepositoryRunner.csproj',
  'apps\windows-companion\sandbox-lifecycle-helper\Sxsy.B122.SandboxLifecycleHelper.csproj',
  'apps\windows-companion\companion-lifecycle-helper\Sxsy.B122.CompanionLifecycleHelper.csproj'
)
foreach($testHelperProject in $testHelperProjects){Invoke-B122PinnedDotNetRestore -Project (Join-Path $buildRoot $testHelperProject) -FailureMessage "Pinned restore failed for $testHelperProject"}
$tscCli=Join-Path $buildRoot 'node_modules\typescript\lib\tsc.js'
if(-not(Test-Path -LiteralPath $tscCli -PathType Leaf)-or(Get-Item -LiteralPath $tscCli -Force).Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'The lockfile-installed TypeScript compiler is missing or unsafe.'}
$nodeExecutableSha256=(Get-FileHash -LiteralPath $node.FullName -Algorithm SHA256).Hash.ToLowerInvariant();$npmCliSha256=(Get-FileHash -LiteralPath $npmCli.FullName -Algorithm SHA256).Hash.ToLowerInvariant();$tscSha256=(Get-FileHash -LiteralPath $tscCli -Algorithm SHA256).Hash.ToLowerInvariant()
$npmVersion=(Invoke-B122IsolatedCapture -Executable $node.FullName -Arguments @($npmCli.FullName,'--version') -FailureMessage 'Bundled npm version probe failed.').Trim();$tscVersion=(Invoke-B122IsolatedCapture -Executable $node.FullName -Arguments @($tscCli,'--version') -FailureMessage 'Lockfile TypeScript version probe failed.').Trim();if($npmVersion-notmatch'^\d+\.\d+\.\d+'-or$tscVersion-notmatch'^Version \d+\.\d+\.\d+'){throw 'Bundled npm or lockfile TypeScript returned an invalid version.'}
if (-not $SkipVerification) {
  Invoke-B122PinnedNpm -Arguments @('run','typecheck') -FailureMessage 'Typecheck failed.'
  Invoke-B122PinnedNpm -Arguments @('test') -FailureMessage 'Test verification failed.'
  $firmwareVerificationReceipt = Join-Path $output 'firmware-verification.json'
  Assert-Child $output $firmwareVerificationReceipt
  Invoke-B122IsolatedHost -Executable $node.FullName -Arguments @('firmware\verify.mjs','--require-c-compiler','--dotnet',$dotnetExe,'--receipt',$firmwareVerificationReceipt) -FailureMessage 'Firmware and Raw-HID protocol verification failed.'
  $firmwareVerification = Get-Content -LiteralPath $firmwareVerificationReceipt -Raw | ConvertFrom-Json
  if ($firmwareVerification.schema -cne 'sxsy-b122.firmware-verification' -or $firmwareVerification.version -ne 1 -or $firmwareVerification.status -cne 'passed' -or $firmwareVerification.compilerRequired -ne $true -or $firmwareVerification.compiled -ne $true -or $firmwareVerification.protocolSelfTest -ne $true -or $firmwareVerification.hardwareAccessed -ne $false -or $firmwareVerification.compiler.fingerprintSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Firmware verification did not produce a valid compiler-bound receipt.' }
  Invoke-B122PinnedNpm -Arguments @('run','package:vscode:dry-run') -FailureMessage 'VS Code extension package dry-run failed.'
  Invoke-B122PinnedNpm -Arguments @('run','package:companion:dry-run') -FailureMessage 'Companion package dry-run failed.'
  Invoke-B122PinnedNpm -Arguments @('run','package:provider-host:dry-run') -FailureMessage 'Provider-adapter-host package dry-run failed.'
}
Invoke-B122PinnedNpm -Arguments @('run','build:companion') -FailureMessage 'Companion build failed.'
Invoke-B122PinnedNpm -Arguments @('run','build:vscode') -FailureMessage 'VS Code extension build failed.'
Invoke-B122PinnedNpm -Arguments @('run','build:provider-host') -FailureMessage 'Provider-adapter-host build failed.'
$rawHidSimulatorBuild = Join-Path $buildRoot 'apps\windows-companion\dist\apps\windows-companion\src\raw-hid-simulator.js'
$councilParticipantBuild = Join-Path $buildRoot 'apps\windows-companion\dist\apps\windows-companion\src\council-participant-main.js'
$containmentRemoteEvaluatorBuild = Join-Path $buildRoot 'apps\windows-companion\dist\apps\windows-companion\src\containment-remote-evaluator-main.js'
foreach ($compiledProduct in @($rawHidSimulatorBuild, $councilParticipantBuild, $containmentRemoteEvaluatorBuild)) {
  if (-not (Test-Path -LiteralPath $compiledProduct -PathType Leaf)) { throw "The companion build omitted a required packaged product entry point: $compiledProduct" }
}
$containmentRemoteEvaluatorHelp = Invoke-B122IsolatedCapture -Executable $node.FullName -Arguments @($containmentRemoteEvaluatorBuild,'--help') -FailureMessage 'The signed containment remote evaluator packaged entry point failed.'
if ($containmentRemoteEvaluatorHelp -cnotmatch '^Usage: sxsy-b122-containment-remote-evaluator --challenge <absolute-json> --private-key <absolute-pem> --output <absolute-json> --git-executable <absolute-pinned-git>\s*$') { throw 'The signed containment remote evaluator returned an invalid packaged help contract.' }
$rawHidSimulationRaw = Invoke-B122IsolatedCapture -Executable $node.FullName -Arguments @($rawHidSimulatorBuild,'--self-test') -FailureMessage 'The complete no-hardware Raw-HID product simulation failed.'
if ([string]::IsNullOrWhiteSpace($rawHidSimulationRaw)) { throw 'The complete no-hardware Raw-HID product simulation returned no receipt.' }
$rawHidSimulation = $rawHidSimulationRaw | ConvertFrom-Json
if ($rawHidSimulation.schema -cne 'sxsy-b122.raw-hid-simulation' -or $rawHidSimulation.version -ne 1 -or $rawHidSimulation.status -cne 'passed' -or $rawHidSimulation.chordsExercised -ne 176 -or $rawHidSimulation.assignedChords -ne 65 -or $rawHidSimulation.unassignedChords -ne 111 -or $rawHidSimulation.duplicateAcknowledgedWithoutRedispatch -ne $true -or $rawHidSimulation.staleEpochRejected -ne $true -or $rawHidSimulation.corruptFrameRejected -ne $true -or $rawHidSimulation.hardwareAccessed -ne $false -or $rawHidSimulation.networkAccessed -ne $false) { throw 'The complete no-hardware Raw-HID product simulation receipt is invalid.' }
$providerHostBuildMain = Join-Path $buildRoot 'apps\provider-adapter-host\dist\apps\provider-adapter-host\src\main.js'
$providerHostCompiledProductNames = @('main.js','index.js','config.js','service.js','backends.js','state.js','council-resources.js','server.js','secret-envelope.js','windows-path-security.js')
foreach ($compiledName in $providerHostCompiledProductNames) {
  $compiledProviderProduct = Join-Path $buildRoot ("apps\provider-adapter-host\dist\apps\provider-adapter-host\src\$compiledName")
  if (-not (Test-Path -LiteralPath $compiledProviderProduct -PathType Leaf)) { throw "The provider-adapter-host build omitted required compiled product code: $compiledName" }
}
$providerHostBuildSelfTestRaw = Invoke-B122IsolatedCapture -Executable $node.FullName -Arguments @($providerHostBuildMain,'--self-test') -FailureMessage 'Provider-adapter-host build self-test failed.'
if ([string]::IsNullOrWhiteSpace($providerHostBuildSelfTestRaw)) { throw 'Provider-adapter-host build self-test returned no receipt.' }
$providerHostBuildSelfTest = $providerHostBuildSelfTestRaw | ConvertFrom-Json
if ($providerHostBuildSelfTest.schema -cne 'sxsy-b122.provider-host-self-test' -or $providerHostBuildSelfTest.version -ne 1 -or $providerHostBuildSelfTest.status -cne 'ok' -or $providerHostBuildSelfTest.authenticatedState -ne $true -or $providerHostBuildSelfTest.fixtureBackend -ne $true -or $providerHostBuildSelfTest.proprietaryCredentialAccessed -ne $false -or $providerHostBuildSelfTest.networkAccessed -ne $false) { throw 'Provider-adapter-host returned an invalid credential-free build self-test receipt.' }
$companionPackageIdentity=Get-Content -LiteralPath (Join-Path $buildRoot 'apps\windows-companion\package.json') -Raw|ConvertFrom-Json
$providerPackageIdentity=Get-Content -LiteralPath (Join-Path $buildRoot 'apps\provider-adapter-host\package.json') -Raw|ConvertFrom-Json
$vscodePackageIdentity=Get-Content -LiteralPath (Join-Path $buildRoot 'apps\vscode-extension\package.json') -Raw|ConvertFrom-Json
foreach($packageIdentity in @($companionPackageIdentity,$providerPackageIdentity,$vscodePackageIdentity)){if([string]$packageIdentity.version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$'){throw 'A packaged B122 component has an invalid version identity.'}}

$helper = $SandboxHelperPath
if (-not $helper) {
  if ($SandboxHelperSha256) { throw '-SandboxHelperSha256 is valid only with -SandboxHelperPath.' }
  $publish = Join-Path $output '.helper-publish'
  Invoke-B122PinnedDotNetPublish -Project (Join-Path $buildRoot 'apps\windows-companion\sandbox-helper\Sxsy.B122.SandboxHelper.csproj') -Destination $publish -FailureMessage 'Windows Sandbox guest-helper build failed.'
  $helper = Join-Path $publish 'b122-sandbox-worker.exe'
}
$helper = [IO.Path]::GetFullPath($helper)
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'The fixed sandbox helper executable is missing.' }
if ($SandboxHelperPath) {
  if (-not $SandboxHelperSha256) { throw '-SandboxHelperSha256 is required with a prebuilt helper.' }
  if (-not ((Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.Equals($SandboxHelperSha256, [StringComparison]::OrdinalIgnoreCase))) { throw 'The sandbox helper digest does not match the reviewed value.' }
}

$sandboxLifecycleHelper=$SandboxLifecycleHelperPath
if(-not$sandboxLifecycleHelper){
  if($SandboxLifecycleHelperSha256){throw '-SandboxLifecycleHelperSha256 is valid only with -SandboxLifecycleHelperPath.'}
  $sandboxLifecyclePublish=Join-Path $output '.sandbox-lifecycle-helper-publish'
  Invoke-B122PinnedDotNetPublish -Project (Join-Path $buildRoot 'apps\windows-companion\sandbox-lifecycle-helper\Sxsy.B122.SandboxLifecycleHelper.csproj') -Destination $sandboxLifecyclePublish -FailureMessage 'Windows Sandbox lifecycle-helper build failed.'
  $sandboxLifecycleHelper=Join-Path $sandboxLifecyclePublish 'b122-sandbox-lifecycle.exe'
}
$sandboxLifecycleHelper=[IO.Path]::GetFullPath($sandboxLifecycleHelper)
if(-not(Test-Path -LiteralPath $sandboxLifecycleHelper -PathType Leaf)){throw 'The fixed sandbox lifecycle helper is missing.'}
if($SandboxLifecycleHelperPath){if(-not$SandboxLifecycleHelperSha256){throw '-SandboxLifecycleHelperSha256 is required with a prebuilt lifecycle helper.'};if(-not(Get-FileHash -LiteralPath $sandboxLifecycleHelper -Algorithm SHA256).Hash.Equals($SandboxLifecycleHelperSha256,[StringComparison]::OrdinalIgnoreCase)){throw 'Sandbox lifecycle-helper digest mismatch.'}}
$sandboxLifecycleSelfTest=(Invoke-B122IsolatedCapture -Executable $sandboxLifecycleHelper -Arguments @('--self-test') -FailureMessage 'Sandbox lifecycle helper self-test failed.')|ConvertFrom-Json
if($sandboxLifecycleSelfTest.schema -cne 'sxsy-b122.sandbox-lifecycle-self-test' -or $sandboxLifecycleSelfTest.version -ne 1 -or $sandboxLifecycleSelfTest.status -cne 'ok' -or $sandboxLifecycleSelfTest.hardwareAccessed -ne $false){throw 'Sandbox lifecycle helper returned an invalid self-test receipt.'}

$repositoryRuntimeHelper = $RepositoryRuntimeHelperPath
if (-not $repositoryRuntimeHelper) {
  if ($RepositoryRuntimeHelperSha256) { throw '-RepositoryRuntimeHelperSha256 is valid only with -RepositoryRuntimeHelperPath.' }
  $repositoryRuntimePublish = Join-Path $output '.repository-runtime-helper-publish'
  Invoke-B122PinnedDotNetPublish -Project (Join-Path $buildRoot 'apps\windows-companion\repository-runner-helper\Sxsy.B122.RepositoryRunner.csproj') -Destination $repositoryRuntimePublish -FailureMessage 'Repository runtime Job-Object helper build failed.'
  $repositoryRuntimeHelper = Join-Path $repositoryRuntimePublish 'b122-repository-runner.exe'
}
$repositoryRuntimeHelper = [IO.Path]::GetFullPath($repositoryRuntimeHelper)
if (-not (Test-Path -LiteralPath $repositoryRuntimeHelper -PathType Leaf)) { throw 'The repository runtime Job-Object helper executable is missing.' }
if ($RepositoryRuntimeHelperPath) {
  if (-not $RepositoryRuntimeHelperSha256) { throw '-RepositoryRuntimeHelperSha256 is required with a prebuilt helper.' }
  if (-not ((Get-FileHash -LiteralPath $repositoryRuntimeHelper -Algorithm SHA256).Hash.Equals($RepositoryRuntimeHelperSha256, [StringComparison]::OrdinalIgnoreCase))) { throw 'The repository runtime helper digest does not match the reviewed value.' }
}
$repositoryRuntimeSelfTestRaw = Invoke-B122IsolatedCapture -Executable $repositoryRuntimeHelper -Arguments @('--self-test') -FailureMessage 'Repository runtime helper Job-Object self-test failed.'
if ([string]::IsNullOrWhiteSpace($repositoryRuntimeSelfTestRaw)) { throw 'Repository runtime helper Job-Object self-test returned no receipt.' }
$repositoryRuntimeSelfTest = $repositoryRuntimeSelfTestRaw | ConvertFrom-Json
if ($repositoryRuntimeSelfTest.schema -cne 'sxsy-b122.repository-runner-self-test' -or $repositoryRuntimeSelfTest.version -ne 1 -or $repositoryRuntimeSelfTest.killOnClose -ne $true -or $repositoryRuntimeSelfTest.childTreeTerminated -ne $true -or $repositoryRuntimeSelfTest.noSurvivors -ne $true) { throw 'Repository runtime helper returned an invalid containment self-test receipt.' }

$companionLifecycleHelper=$CompanionLifecycleHelperPath
if(-not$companionLifecycleHelper){
  if($CompanionLifecycleHelperSha256){throw '-CompanionLifecycleHelperSha256 is valid only with -CompanionLifecycleHelperPath.'}
  $companionLifecyclePublish=Join-Path $output '.companion-lifecycle-helper-publish'
  Invoke-B122PinnedDotNetPublish -Project (Join-Path $buildRoot 'apps\windows-companion\companion-lifecycle-helper\Sxsy.B122.CompanionLifecycleHelper.csproj') -Destination $companionLifecyclePublish -FailureMessage 'Companion lifecycle Job-Object helper build failed.'
  $companionLifecycleHelper=Join-Path $companionLifecyclePublish 'b122-companion-supervisor.exe'
}
$companionLifecycleHelper=[IO.Path]::GetFullPath($companionLifecycleHelper)
if(-not(Test-Path -LiteralPath $companionLifecycleHelper -PathType Leaf)){throw 'The fixed companion lifecycle helper is missing.'}
if($CompanionLifecycleHelperPath){if(-not$CompanionLifecycleHelperSha256){throw '-CompanionLifecycleHelperSha256 is required with a prebuilt companion lifecycle helper.'};if(-not(Get-FileHash -LiteralPath $companionLifecycleHelper -Algorithm SHA256).Hash.Equals($CompanionLifecycleHelperSha256,[StringComparison]::OrdinalIgnoreCase)){throw 'Companion lifecycle helper digest mismatch.'}}
$companionLifecycleSelfTestRaw=Invoke-B122IsolatedCapture -Executable $companionLifecycleHelper -Arguments @('--self-test') -FailureMessage 'Companion lifecycle helper self-test failed.'
if([string]::IsNullOrWhiteSpace($companionLifecycleSelfTestRaw)){throw 'Companion lifecycle helper self-test returned no receipt.'}
$companionLifecycleSelfTest=$companionLifecycleSelfTestRaw|ConvertFrom-Json
if($companionLifecycleSelfTest.schema-cne'sxsy-b122.companion-supervisor-self-test'-or$companionLifecycleSelfTest.version-ne1-or$companionLifecycleSelfTest.status-cne'passed'-or[int]$companionLifecycleSelfTest.capturedProcesses-ne2-or[int]$companionLifecycleSelfTest.activeProcesses-ne0){throw 'Companion lifecycle helper returned an invalid no-survivor self-test receipt.'}

$rawHidHelper = $RawHidHelperPath
if (-not $rawHidHelper) {
  if ($RawHidHelperSha256) { throw '-RawHidHelperSha256 is valid only with -RawHidHelperPath.' }
  $rawHidPublish = Join-Path $output '.raw-hid-helper-publish'
  Invoke-B122PinnedDotNetPublish -Project (Join-Path $buildRoot 'firmware\windows-hid-helper\Strathex.B122.RawHidHelper.csproj') -Destination $rawHidPublish -FailureMessage 'Windows Raw-HID helper build failed.'
  $rawHidHelper = Join-Path $rawHidPublish 'strathex-b122-hid-helper.exe'
}
$rawHidHelper = [IO.Path]::GetFullPath($rawHidHelper)
if (-not (Test-Path -LiteralPath $rawHidHelper -PathType Leaf)) { throw 'The fixed Raw-HID helper executable is missing.' }
if ($RawHidHelperPath) {
  if (-not $RawHidHelperSha256) { throw '-RawHidHelperSha256 is required with a prebuilt Raw-HID helper.' }
  if (-not ((Get-FileHash -LiteralPath $rawHidHelper -Algorithm SHA256).Hash.Equals($RawHidHelperSha256, [StringComparison]::OrdinalIgnoreCase))) { throw 'The Raw-HID helper digest does not match the reviewed value.' }
}

$providerDesktopHelper = $ProviderDesktopHelperPath
if (-not $providerDesktopHelper) {
  if ($ProviderDesktopHelperSha256) { throw '-ProviderDesktopHelperSha256 is valid only with -ProviderDesktopHelperPath.' }
  $providerDesktopPublish = Join-Path $output '.provider-desktop-helper-publish'
  Invoke-B122PinnedDotNetPublish -Project (Join-Path $buildRoot 'apps\windows-companion\provider-desktop-helper\Sxsy.B122.ProviderDesktopHelper.csproj') -Destination $providerDesktopPublish -FailureMessage 'Provider-desktop native helper build failed.'
  $providerDesktopHelper = Join-Path $providerDesktopPublish 'sxsy-b122-provider-desktop-helper.exe'
}
$providerDesktopHelper = [IO.Path]::GetFullPath($providerDesktopHelper)
if (-not (Test-Path -LiteralPath $providerDesktopHelper -PathType Leaf)) { throw 'The fixed provider-desktop helper executable is missing.' }
if ($ProviderDesktopHelperPath) {
  if (-not $ProviderDesktopHelperSha256) { throw '-ProviderDesktopHelperSha256 is required with a prebuilt provider-desktop helper.' }
  if (-not ((Get-FileHash -LiteralPath $providerDesktopHelper -Algorithm SHA256).Hash.Equals($ProviderDesktopHelperSha256, [StringComparison]::OrdinalIgnoreCase))) { throw 'The provider-desktop helper digest does not match the reviewed value.' }
}
$providerDesktopSelfTestRaw = Invoke-B122IsolatedCapture -Executable $providerDesktopHelper -Arguments @('--self-test') -FailureMessage 'Provider-desktop helper self-test failed.'
if ([string]::IsNullOrWhiteSpace($providerDesktopSelfTestRaw)) { throw 'Provider-desktop helper self-test returned no receipt.' }
$providerDesktopSelfTest = $providerDesktopSelfTestRaw | ConvertFrom-Json
if ($providerDesktopSelfTest.schema -cne 'sxsy-b122.provider-desktop-self-test' -or $providerDesktopSelfTest.version -ne 1 -or $providerDesktopSelfTest.status -cne 'ok') { throw 'Provider-desktop helper returned an invalid self-test receipt.' }

$voiceHelper = $VoiceHelperPath
if (-not $voiceHelper) {
  if ($VoiceHelperSha256) { throw '-VoiceHelperSha256 is valid only with -VoiceHelperPath.' }
  $voiceHelperPublish = Join-Path $output '.voice-helper-publish'
  Invoke-B122PinnedDotNetPublish -Project (Join-Path $buildRoot 'apps\windows-companion\voice-helper\Sxsy.B122.VoiceHelper.csproj') -Destination $voiceHelperPublish -FailureMessage 'Windows voice native helper build failed.'
  $voiceHelper = Join-Path $voiceHelperPublish 'sxsy-b122-voice-helper.exe'
}
$voiceHelper = [IO.Path]::GetFullPath($voiceHelper)
if (-not (Test-Path -LiteralPath $voiceHelper -PathType Leaf)) { throw 'The fixed Windows voice helper executable is missing.' }
if ($VoiceHelperPath) {
  if (-not $VoiceHelperSha256) { throw '-VoiceHelperSha256 is required with a prebuilt voice helper.' }
  if (-not ((Get-FileHash -LiteralPath $voiceHelper -Algorithm SHA256).Hash.Equals($VoiceHelperSha256, [StringComparison]::OrdinalIgnoreCase))) { throw 'The voice helper digest does not match the reviewed value.' }
}
$voiceSelfTestRaw = Invoke-B122IsolatedCapture -Executable $voiceHelper -Arguments @('--self-test') -FailureMessage 'Voice helper self-test failed.'
if ([string]::IsNullOrWhiteSpace($voiceSelfTestRaw)) { throw 'Voice helper self-test returned no receipt.' }
$voiceSelfTest = $voiceSelfTestRaw | ConvertFrom-Json
if ($voiceSelfTest.schema -cne 'sxsy-b122.voice-helper-self-test' -or $voiceSelfTest.version -ne 1 -or $voiceSelfTest.status -cne 'ok' -or $voiceSelfTest.dpapiCurrentUser -ne $true -or $voiceSelfTest.hardwareAccessed -ne $false -or $voiceSelfTest.networkAccessed -ne $false) { throw 'Voice helper returned an invalid hardware-independent self-test receipt.' }
$helperDigest = (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant()
$sandboxLifecycleHelperDigest=(Get-FileHash -LiteralPath $sandboxLifecycleHelper -Algorithm SHA256).Hash.ToLowerInvariant()
$repositoryRuntimeHelperDigest = (Get-FileHash -LiteralPath $repositoryRuntimeHelper -Algorithm SHA256).Hash.ToLowerInvariant()
$companionLifecycleHelperDigest = (Get-FileHash -LiteralPath $companionLifecycleHelper -Algorithm SHA256).Hash.ToLowerInvariant()
$rawHidHelperDigest = (Get-FileHash -LiteralPath $rawHidHelper -Algorithm SHA256).Hash.ToLowerInvariant()
$providerDesktopHelperDigest = (Get-FileHash -LiteralPath $providerDesktopHelper -Algorithm SHA256).Hash.ToLowerInvariant()
$voiceHelperDigest = (Get-FileHash -LiteralPath $voiceHelper -Algorithm SHA256).Hash.ToLowerInvariant()

$app = Join-Path $output 'app'
$providerHost = Join-Path $output 'provider-adapter-host'
$runtime = Join-Path $output 'runtime'
$extension = Join-Path $output 'extension'
$scripts = Join-Path $output 'scripts'
$provisioning = Join-Path $scripts 'provisioning'
$documentation = Join-Path $output 'docs'
$source = Join-Path $output 'source'
$firmware = Join-Path $output 'firmware'
$licenses = Join-Path $output 'licenses'
$buildProvenance=Join-Path $output 'build-provenance'
New-Item -ItemType Directory -Path $app,$providerHost,$runtime,$extension,$scripts,$provisioning,$documentation,$source,$firmware,$licenses,$buildProvenance | Out-Null
Copy-Item -LiteralPath $dotnetToolchainManifestPath -Destination (Join-Path $buildProvenance 'dotnet-toolchain.json')
Move-Item -LiteralPath $sourceSnapshotArchive -Destination (Join-Path $source 'sxsy-b122-source.zip')
& (Join-Path $buildRoot 'firmware\package-qmk.ps1') -OutputDirectory $firmware
if ($LASTEXITCODE -ne 0) { throw 'The portable QMK/Vial source overlay could not be packaged.' }
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\windows-companion\dist') -Destination (Join-Path $app 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\windows-companion\package.json') -Destination $app
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\windows-companion\README.md') -Destination $app
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\provider-adapter-host\dist') -Destination (Join-Path $providerHost 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\provider-adapter-host\package.json') -Destination $providerHost
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\provider-adapter-host\README.md') -Destination $providerHost
$helperDestination = Join-Path $app 'dist\apps\windows-companion\sandbox-helper'
New-Item -ItemType Directory -Path $helperDestination | Out-Null
Copy-Item -LiteralPath $helper -Destination (Join-Path $helperDestination 'b122-sandbox-worker.exe')
Copy-Item -LiteralPath $sandboxLifecycleHelper -Destination (Join-Path $helperDestination 'b122-sandbox-lifecycle.exe')
$repositoryRuntimeDestination = Join-Path $app 'dist\apps\windows-companion\repository-runtime'
New-Item -ItemType Directory -Path $repositoryRuntimeDestination | Out-Null
Copy-Item -LiteralPath $repositoryRuntimeHelper -Destination (Join-Path $repositoryRuntimeDestination 'b122-repository-runner.exe')
$companionLifecycleDestination = Join-Path $app 'dist\apps\windows-companion\companion-lifecycle'
New-Item -ItemType Directory -Path $companionLifecycleDestination | Out-Null
Copy-Item -LiteralPath $companionLifecycleHelper -Destination (Join-Path $companionLifecycleDestination 'b122-companion-supervisor.exe')
$rawHidDestination = Join-Path $app 'dist\apps\windows-companion\raw-hid'
New-Item -ItemType Directory -Path $rawHidDestination | Out-Null
Copy-Item -LiteralPath $rawHidHelper -Destination (Join-Path $rawHidDestination 'strathex-b122-hid-helper.exe')
$providerDesktopDestination = Join-Path $app 'dist\apps\windows-companion\provider-desktop'
New-Item -ItemType Directory -Path $providerDesktopDestination | Out-Null
Copy-Item -LiteralPath $providerDesktopHelper -Destination (Join-Path $providerDesktopDestination 'sxsy-b122-provider-desktop-helper.exe')
$voiceDestination = Join-Path $app 'dist\apps\windows-companion\voice'
New-Item -ItemType Directory -Path $voiceDestination | Out-Null
Copy-Item -LiteralPath $voiceHelper -Destination (Join-Path $voiceDestination 'sxsy-b122-voice-helper.exe')
Copy-Item -LiteralPath $node.FullName -Destination (Join-Path $runtime 'node.exe')
Copy-Item -LiteralPath $nodeLicense.FullName -Destination (Join-Path $runtime 'NODE-LICENSE.txt')

$vsixRoot = Join-Path $output '.vsix'
Assert-Child $output $vsixRoot
$vsixExtension = Join-Path $vsixRoot 'extension'
New-Item -ItemType Directory -Path $vsixExtension | Out-Null
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\vscode-extension\dist') -Destination (Join-Path $vsixExtension 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\vscode-extension\package.json') -Destination $vsixExtension
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\vscode-extension\README.md') -Destination $vsixExtension
$vsixPackagePath=Join-Path $vsixExtension 'package.json'; $vsixPackage=Get-Content -LiteralPath $vsixPackagePath -Raw | ConvertFrom-Json; $vsixPackage.name='strathex-switchyard-b122'; Write-Utf8NoBom $vsixPackagePath ($vsixPackage | ConvertTo-Json -Depth 20)
$vsixManifestPath=Join-Path $vsixRoot 'extension.vsixmanifest';Copy-Item -LiteralPath (Join-Path $buildRoot 'deployment\windows\extension.vsixmanifest') -Destination $vsixManifestPath
[xml]$vsixManifest=Get-Content -LiteralPath $vsixManifestPath -Raw;$vsixNamespace=New-Object Xml.XmlNamespaceManager($vsixManifest.NameTable);$vsixNamespace.AddNamespace('v','http://schemas.microsoft.com/developer/vsx-schema/2011');$vsixIdentity=$vsixManifest.SelectSingleNode('/v:PackageManifest/v:Metadata/v:Identity',$vsixNamespace)
if($null-eq$vsixIdentity-or[string]$vscodePackageIdentity.name-cne'@strathex/switchyard-vscode'-or[string]$vscodePackageIdentity.publisher-cne'SquirmyWormy275'-or[string]$vscodePackageIdentity.main-cne'./dist/apps/vscode-extension/src/extension.js'-or[string]$vscodePackageIdentity.version-cnotmatch'^\d+\.\d+\.\d+$'){throw 'The reviewed VS Code package identity cannot be represented by the fixed VSIX contract.'}
$vsixIdentity.SetAttribute('Id','strathex-switchyard-b122');$vsixIdentity.SetAttribute('Publisher',[string]$vscodePackageIdentity.publisher);$vsixIdentity.SetAttribute('Version',[string]$vscodePackageIdentity.version);Write-Utf8NoBom $vsixManifestPath $vsixManifest.OuterXml
Copy-Item -LiteralPath (Join-Path $buildRoot 'deployment\windows\Content_Types.xml') -Destination (Join-Path $vsixRoot '[Content_Types].xml')
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$vsix = Join-Path $extension 'sxsy-b122-switchyard.vsix'
$vsixArchive = [IO.Compression.ZipFile]::Open($vsix, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($sourceFile in (Get-ChildItem -LiteralPath $vsixRoot -File -Recurse | Sort-Object FullName)) {
    $entryName = $sourceFile.FullName.Substring($vsixRoot.Length + 1).Replace('\', '/')
    $entry = $vsixArchive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
    $inputStream = [IO.File]::OpenRead($sourceFile.FullName); $outputStream = $entry.Open()
    try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
  }
} finally { $vsixArchive.Dispose() }
Assert-B122VsixIdentity -VsixPath $vsix -ExpectedVersion ([string]$vscodePackageIdentity.version)|Out-Null
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\vscode-extension\dist') -Destination (Join-Path $extension 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\vscode-extension\package.json') -Destination $extension
Copy-Item -LiteralPath (Join-Path $buildRoot 'apps\vscode-extension\README.md') -Destination $extension
$runtimeScriptNames = @(
  'Start-B122.ps1','Test-B122Health.mjs','Manage-B122ProviderHost.ps1','Test-B122ProviderHostHealth.mjs','Test-B122PortableBundle.ps1','Test-B122ReleaseArtifact.ps1','New-B122NetworkPolicy.ps1','Get-B122TlsIdentity.mjs',
  'B122InstallTools.psm1','B122ReleaseIntegrity.psm1','Bootstrap-B122Install.ps1','Invoke-B122Current.ps1','Install-B122.ps1','Update-B122.ps1','Rollback-B122.ps1','Uninstall-B122.ps1'
)
$providerProvisioningNames = @(
  'Initialize-B122ProviderHost.ps1','Protect-B122ProviderHostSecret.ps1','New-B122LoopbackTlsIdentity.mjs','Get-B122TlsIdentity.mjs','Provision-B122ProviderHostCompanion.mjs',
  'New-B122ProviderHostConfiguration.ps1','Test-B122ProviderHostConfiguration.ps1','Restore-B122ProviderHostConfiguration.ps1'
)
$manifestProvisioningNames = @('B122ManifestTools.psm1','New-B122RepositoryRuntimeManifest.ps1','New-B122WindowsSandboxCatalog.ps1','New-B122ProviderDesktopPaths.ps1','Manage-B122VoiceRoute.ps1','README-manifest-generators.md','repository-runtime-plan.template.json','Test-B122ManifestGenerators.ps1','windows-sandbox-catalog-plan.template.json','typed-recipes.template.json')
foreach ($name in $runtimeScriptNames) { Copy-Item -LiteralPath (Join-Path $sourceScripts $name) -Destination $scripts }
foreach ($name in @($providerProvisioningNames + $manifestProvisioningNames)) { Copy-Item -LiteralPath (Join-Path $sourceScripts $name) -Destination $provisioning }
$documentationSource = [IO.Path]::GetFullPath((Join-Path $buildRoot 'docs')).TrimEnd('\')
foreach ($document in (Get-ChildItem -LiteralPath $documentationSource -File -Recurse | Sort-Object FullName)) {
  $relativeDocument = $document.FullName.Substring($documentationSource.Length + 1)
  $documentDestination = Join-Path $documentation $relativeDocument
  New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($documentDestination)) | Out-Null
  Copy-Item -LiteralPath $document.FullName -Destination $documentDestination
}
$manualPdfSource = Join-Path $buildRoot 'output\pdf\SXSY-B122-operator-technical-manual.pdf'
if (
  -not (Test-Path -LiteralPath $manualPdfSource -PathType Leaf) -or
  (((Get-Item -LiteralPath $manualPdfSource -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
) { throw 'The pinned source commit omits the validated B122 operator manual PDF.' }
Copy-Item -LiteralPath $manualPdfSource -Destination (Join-Path $documentation 'SXSY-B122-operator-technical-manual.pdf')
Copy-Item -LiteralPath (Join-Path $buildRoot 'README.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $buildRoot 'SECURITY.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $buildRoot 'LICENSING.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $buildRoot 'ATTRIBUTION.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $sourceScripts 'licenses\DOTNET-RUNTIME-LICENSE.txt') -Destination $licenses
Copy-Item -LiteralPath (Join-Path $sourceScripts 'licenses\DOTNET-RUNTIME-THIRD-PARTY-NOTICES.txt') -Destination $licenses

Set-Location -LiteralPath $output
foreach($workspaceJunction in @(
  @{link=(Join-Path $buildRoot 'node_modules\@strathex\switchyard-companion');target=(Join-Path $buildRoot 'apps\windows-companion')},
  @{link=(Join-Path $buildRoot 'node_modules\@strathex\switchyard-provider-adapter-host');target=(Join-Path $buildRoot 'apps\provider-adapter-host')},
  @{link=(Join-Path $buildRoot 'node_modules\@strathex\switchyard-vscode');target=(Join-Path $buildRoot 'apps\vscode-extension')}
)){Remove-B122VerifiedWorkspaceJunction -Link $workspaceJunction.link -ExpectedTarget $workspaceJunction.target}
foreach($temporaryBuildTree in @($runtimeExtract,$vsixRoot,(Join-Path $output '.helper-publish'),(Join-Path $output '.sandbox-lifecycle-helper-publish'),(Join-Path $output '.repository-runtime-helper-publish'),(Join-Path $output '.companion-lifecycle-helper-publish'),(Join-Path $output '.raw-hid-helper-publish'),(Join-Path $output '.provider-desktop-helper-publish'),(Join-Path $output '.voice-helper-publish'),$testTempRoot,$buildRoot)){Remove-B122OwnedBuildTree -Path $temporaryBuildTree}

$portableSmokeResult=Invoke-B122WithIsolatedBuildEnvironment { $captured=@(& (Join-Path $scripts 'Test-B122PortableBundle.ps1') -BundleRoot $output);[pscustomobject]@{exitCode=$LASTEXITCODE;output=($captured-join[Environment]::NewLine)} }
$portableSmoke=[string]$portableSmokeResult.output
if ($portableSmokeResult.exitCode -ne 0 -or [string]::IsNullOrWhiteSpace($portableSmoke)) { throw 'Portable bundle smoke verification failed.' }
Write-Utf8NoBom (Join-Path $output 'portable-smoke.json') $portableSmoke
Remove-B122OwnedBuildTree -Path $buildProfile

$outputOwnershipSidecar=$output+'.ownership.json'
if(Test-Path -LiteralPath $outputOwnershipSidecar){throw 'The exclusive release-output ownership sidecar already exists; refusing replacement.'}
Move-Item -LiteralPath (Join-Path $output '.sxsy-b122-build-output.json') -Destination $outputOwnershipSidecar

$payload = Get-B122ConcreteFiles $output|Sort-Object FullName|ForEach-Object {
  $relative=$_.FullName.Substring($output.Length+1).Replace('\','/')
  if($relative -notin @('SHA256SUMS.json','sbom.spdx.json','release.json')){[ordered]@{path=$relative;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$_.Length}}
}
Write-Utf8NoBom (Join-Path $output 'SHA256SUMS.json') ($payload | ConvertTo-Json -Depth 4)
$nodeVersion = (Invoke-B122IsolatedCapture -Executable (Join-Path $runtime 'node.exe') -Arguments @('-p','process.version') -FailureMessage 'Bundled Node version probe failed.').Trim()
$packages = @(
  [ordered]@{ SPDXID='SPDXRef-Package-B122'; name='SXSY-B122 Switchyard'; versionInfo=[string]$companionPackageIdentity.version; downloadLocation='NOASSERTION'; filesAnalyzed=$true; licenseConcluded='NOASSERTION'; licenseDeclared='NOASSERTION'; copyrightText='NOASSERTION' },
  [ordered]@{ SPDXID='SPDXRef-Package-ProviderAdapterHost'; name='SXSY-B122 Provider Adapter Host'; versionInfo=[string]$providerPackageIdentity.version; downloadLocation='NOASSERTION'; filesAnalyzed=$true; licenseConcluded='NOASSERTION'; licenseDeclared='NOASSERTION'; copyrightText='NOASSERTION' },
  [ordered]@{ SPDXID='SPDXRef-Package-Node'; name='Node.js runtime'; versionInfo=$nodeVersion; downloadLocation=$NodeRuntimeSourceUri; filesAnalyzed=$true; licenseConcluded='NOASSERTION'; licenseDeclared='NOASSERTION'; copyrightText='NOASSERTION' },
  [ordered]@{ SPDXID='SPDXRef-Package-DotNet'; name='Microsoft .NET runtime in self-contained helpers'; versionInfo=[string]$dotnetToolchain.runtimeVersion; downloadLocation='NOASSERTION'; filesAnalyzed=$true; licenseConcluded='NOASSERTION'; licenseDeclared='MIT'; copyrightText='NOASSERTION' }
)
$spdxFiles = @(); $relationships = @(
  [ordered]@{ spdxElementId='SPDXRef-DOCUMENT'; relationshipType='DESCRIBES'; relatedSpdxElement='SPDXRef-Package-B122' },
  [ordered]@{ spdxElementId='SPDXRef-DOCUMENT'; relationshipType='DESCRIBES'; relatedSpdxElement='SPDXRef-Package-ProviderAdapterHost' },
  [ordered]@{ spdxElementId='SPDXRef-DOCUMENT'; relationshipType='DESCRIBES'; relatedSpdxElement='SPDXRef-Package-Node' },
  [ordered]@{ spdxElementId='SPDXRef-DOCUMENT'; relationshipType='DESCRIBES'; relatedSpdxElement='SPDXRef-Package-DotNet' },
  [ordered]@{ spdxElementId='SPDXRef-Package-B122'; relationshipType='STATIC_LINK'; relatedSpdxElement='SPDXRef-Package-DotNet' }
)
for ($index = 0; $index -lt $payload.Count; $index++) {
  $entry = $payload[$index]; $fileId = 'SPDXRef-File-' + ($index + 1)
  $spdxFiles += [ordered]@{ SPDXID=$fileId; fileName=('./' + $entry.path); checksums=@([ordered]@{ algorithm='SHA256'; checksumValue=$entry.sha256 }); licenseConcluded='NOASSERTION'; copyrightText='NOASSERTION' }
  $owner = if ($entry.path -in @('runtime/node.exe', 'runtime/NODE-LICENSE.txt')) { 'SPDXRef-Package-Node' } elseif ($entry.path.StartsWith('licenses/DOTNET-RUNTIME-')) { 'SPDXRef-Package-DotNet' } elseif ($entry.path.StartsWith('provider-adapter-host/')) { 'SPDXRef-Package-ProviderAdapterHost' } else { 'SPDXRef-Package-B122' }
  $relationships += [ordered]@{ spdxElementId=$owner; relationshipType='CONTAINS'; relatedSpdxElement=$fileId }
}
Write-Utf8NoBom (Join-Path $output 'sbom.spdx.json') ([ordered]@{ spdxVersion='SPDX-2.3'; dataLicense='CC0-1.0'; SPDXID='SPDXRef-DOCUMENT'; name='SXSY-B122 Windows bundle'; documentNamespace=('https://strathex.invalid/spdx/b122/' + [guid]::NewGuid()); creationInfo=[ordered]@{ created=(Get-Date).ToUniversalTime().ToString('o'); creators=@('Tool: SXSY-B122 Build-B122Release.ps1') }; packages=$packages; files=$spdxFiles; relationships=$relationships } | ConvertTo-Json -Depth 10)
Assert-B122ReleaseSourceState -RepositoryRoot $repo -ExpectedCommit $sourceCommit | Out-Null
$verificationSkipped = [bool]$SkipVerification
$evidenceEligible = -not $verificationSkipped
Write-Utf8NoBom (Join-Path $output 'release.json') ([ordered]@{ schema='sxsy-b122.windows-release'; version=1; createdAt=(Get-Date).ToUniversalTime().ToString('o'); architecture='x64'; sourceCommit=$sourceCommit; sourceAssembly='git-archive'; verificationSkipped=$verificationSkipped; evidenceEligible=$evidenceEligible; companion=[string]$companionPackageIdentity.version; providerAdapterHost=[string]$providerPackageIdentity.version; providerHostLifecycle='configured-or-disabled'; vscodeExtension=[string]$vscodePackageIdentity.version; nodeRuntime=[ordered]@{ version=$nodeVersion; source=$NodeRuntimeSourceUri; archiveSha256=$NodeRuntimeSha256.ToLowerInvariant();executableSha256=$nodeExecutableSha256;npmVersion=$npmVersion;npmCliSha256=$npmCliSha256;tscVersion=$tscVersion;tscSha256=$tscSha256 }; dotnetRuntime=[ordered]@{ version=[string]$dotnetToolchain.runtimeVersion; sdkVersion=$dotnetSdkVersion; dotnetExeSha256=$dotnetExeSha256; nugetConfigSha256=$nugetConfigSha256; toolchainManifest='build-provenance/dotnet-toolchain.json'; toolchainManifestSha256=$dotnetToolchainManifestSha256; runtimePackages=@($verifiedRuntimePackages); license='licenses/DOTNET-RUNTIME-LICENSE.txt'; thirdPartyNotices='licenses/DOTNET-RUNTIME-THIRD-PARTY-NOTICES.txt' }; buildEnvironment=[ordered]@{ isolated=$true; ambientInherited=$false; profile='ephemeral-exclusive-output'; environmentNames=@($buildEnvironmentNames|Sort-Object); gitExeSha256=$trustedGitSha256 }; firmwareVerificationReceipt=$(if ($SkipVerification) { $null } else { 'firmware-verification.json' }); sandboxHelperSha256=$helperDigest;sandboxLifecycleHelperSha256=$sandboxLifecycleHelperDigest; repositoryRuntimeHelperSha256=$repositoryRuntimeHelperDigest; companionLifecycleHelperSha256=$companionLifecycleHelperDigest; rawHidHelperSha256=$rawHidHelperDigest; rawHidSimulationSelfTest=$true; councilParticipantPresent=$true; providerDesktopHelperSha256=$providerDesktopHelperDigest; voiceHelperSha256=$voiceHelperDigest; payloadCount=$payload.Count; hardwareAcceptance=$false; highConsequenceAcceptance=$false } | ConvertTo-Json -Depth 8)
$releaseValidation = & (Join-Path $scripts 'Test-B122ReleaseArtifact.ps1') -BundleRoot $output -AllowDevelopmentArtifact:$SkipVerification
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($releaseValidation)) { throw 'Release artifact validation failed.' }
$bootstrapTrustRecords=[Collections.Generic.List[string]]::new()
foreach($metadataName in @('release.json','SHA256SUMS.json','sbom.spdx.json')){$bootstrapTrustRecords.Add("$metadataName`0$((Get-FileHash -LiteralPath (Join-Path $output $metadataName) -Algorithm SHA256).Hash.ToLowerInvariant())")}
$bootstrapTrustBytes=[Text.Encoding]::UTF8.GetBytes(($bootstrapTrustRecords.ToArray()-join"`n"));$bootstrapTrustHasher=[Security.Cryptography.SHA256]::Create()
try{$bootstrapTrustDigest=([BitConverter]::ToString($bootstrapTrustHasher.ComputeHash($bootstrapTrustBytes))).Replace('-','').ToLowerInvariant()}finally{$bootstrapTrustHasher.Dispose();[Array]::Clear($bootstrapTrustBytes,0,$bootstrapTrustBytes.Length)}
Write-DurableBytes $bootstrapTrustSidecar ([Text.Encoding]::UTF8.GetBytes(([ordered]@{schema='sxsy-b122.bootstrap-trust';version=1;sourceCommit=$sourceCommit;trustDigest=$bootstrapTrustDigest;bundleRoot=$output;createdAt=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress)))
Assert-B122ReleaseSourceState -RepositoryRoot $repo -ExpectedCommit $sourceCommit | Out-Null
if ($SkipVerification) {
  Write-Warning "Built development-only SXSY-B122 bundle; verification was skipped and the artifact is ineligible for release evidence or installation: $output"
} else {
  Write-Output "Built verified SXSY-B122 Windows bundle: $output (bootstrap trust receipt: $bootstrapTrustSidecar)"
}
