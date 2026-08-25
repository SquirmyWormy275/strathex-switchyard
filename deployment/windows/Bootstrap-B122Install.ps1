[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$BundleRoot,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedTrustDigest,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$ExpectedSourceCommit,
  [string]$InstallRoot,
  [string]$StateRoot,
  [switch]$SkipVsCode,
  [switch]$SkipAutostart,
  [Parameter(Mandatory=$true)][ValidateSet('install','update')][string]$OperationKindOverride,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedPowerShellSha256,
  [ValidateRange(30,3600)][int]$InstallerTimeoutSeconds=900,
  [string]$TestStagingRoot,
  [switch]$AllowTestStagingRoot,
  [ValidateSet('none','replace-root-before-file-delete','replace-root-before-root-delete')][string]$TestCleanupMutation='none'
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

# This file is the deliberately small, independently trusted first-install and
# migration boundary. It must be obtained from a reviewed source independently
# of the candidate bundle. The caller supplies the release trust digest through
# a second channel. No module or validator from the candidate is imported here.

$nativeToken=[guid]::NewGuid().ToString('N');$nativeTypeName='FileIdentity_'+$nativeToken
$nativeSource=@'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
namespace SxsyB122BootstrapNative {
  public sealed class FileIdentitySnapshot___TOKEN__ {
    public string FinalPath { get; private set; }
    public string Identity { get; private set; }
    public uint Attributes { get; private set; }
    internal FileIdentitySnapshot___TOKEN__(string finalPath,string identity,uint attributes){FinalPath=finalPath;Identity=identity;Attributes=attributes;}
  }
  public static class __TYPE__ {
    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)] struct ByHandleFileInformation { public uint Attributes; public FileTime Creation; public FileTime Access; public FileTime Write; public uint VolumeSerial; public uint SizeHigh; public uint SizeLow; public uint Links; public uint FileIndexHigh; public uint FileIndexLow; }
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern uint GetFinalPathNameByHandleW(IntPtr handle,StringBuilder path,uint length,uint flags);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr handle,out ByHandleFileInformation information);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static FileIdentitySnapshot___TOKEN__ Capture(string path){
      IntPtr handle=CreateFileW(path,0,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
      if(handle==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
      try{
        ByHandleFileInformation information;if(!GetFileInformationByHandle(handle,out information))throw new Win32Exception(Marshal.GetLastWin32Error());
        var builder=new StringBuilder(32768);uint count=GetFinalPathNameByHandleW(handle,builder,(uint)builder.Capacity,0);
        if(count==0||count>=builder.Capacity)throw new Win32Exception(Marshal.GetLastWin32Error());
        string finalPath=builder.ToString();if(finalPath.StartsWith(@"\\?\UNC\",StringComparison.OrdinalIgnoreCase))finalPath=@"\\"+finalPath.Substring(8);else if(finalPath.StartsWith(@"\\?\",StringComparison.OrdinalIgnoreCase))finalPath=finalPath.Substring(4);
        string identity=information.VolumeSerial.ToString("x8")+":"+information.FileIndexHigh.ToString("x8")+information.FileIndexLow.ToString("x8");
        return new FileIdentitySnapshot___TOKEN__(finalPath,identity,information.Attributes);
      }finally{CloseHandle(handle);}
    }
  }
}
'@.Replace('__TOKEN__',$nativeToken).Replace('__TYPE__',$nativeTypeName)
$script:B122BootstrapIdentityType=@(Add-Type -TypeDefinition $nativeSource -PassThru|Where-Object{$_.Name-ceq$nativeTypeName})[0]
if($null-eq$script:B122BootstrapIdentityType){throw 'The trusted bootstrap could not create its private filesystem-identity verifier.'}

if([Environment]::OSVersion.Platform-ne[PlatformID]::Win32NT){throw 'The B122 trusted installer bootstrap is Windows-only.'}

function Get-B122BootstrapSha256Bytes([byte[]]$Bytes){
  $sha=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}
  finally{$sha.Dispose()}
}

function New-B122BootstrapHex([ValidateRange(16,64)][int]$Bytes=32){
  $buffer=New-Object byte[] $Bytes;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try{$rng.GetBytes($buffer);return ([BitConverter]::ToString($buffer)).Replace('-','').ToLowerInvariant()}
  finally{$rng.Dispose();[Array]::Clear($buffer,0,$buffer.Length)}
}

function Get-B122BootstrapSha256File([string]$Path){
  $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $sha=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
  finally{$sha.Dispose();$stream.Dispose()}
}

function Get-B122BootstrapSha256Stream([IO.FileStream]$Stream){
  $Stream.Position=0
  $sha=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash($Stream))).Replace('-','').ToLowerInvariant()}
  finally{$sha.Dispose();$Stream.Position=0}
}

function Get-B122BootstrapItem([string]$Path,[bool]$Directory){
  $item=Microsoft.PowerShell.Management\Get-Item -LiteralPath $Path -Force
  if((($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0)-or([bool]$item.PSIsContainer-ne$Directory)){
    throw "The trusted bootstrap encountered a reparse point or wrong filesystem type: $Path"
  }
  return $item
}

function Get-B122BootstrapDirectoryIdentity([string]$Path){
  $full=[IO.Path]::GetFullPath($Path).TrimEnd('\')
  $snapshot=$script:B122BootstrapIdentityType::Capture($full)
  if(([uint32]$snapshot.Attributes-band[uint32][IO.FileAttributes]::ReparsePoint)-ne0-or([uint32]$snapshot.Attributes-band[uint32][IO.FileAttributes]::Directory)-eq0){throw "The trusted bootstrap directory identity is a reparse point or wrong filesystem type: $full"}
  return [pscustomobject]@{path=$full;finalPath=[IO.Path]::GetFullPath([string]$snapshot.FinalPath).TrimEnd('\');identity=[string]$snapshot.Identity}
}

function Assert-B122BootstrapNoReparseAncestors([string]$Path){
  $full=[IO.Path]::GetFullPath($Path);$root=[IO.Path]::GetPathRoot($full);$cursor=$root
  foreach($segment in @($full.Substring($root.Length)-split'[\\/]'|Where-Object{$_})){
    $cursor=Join-Path $cursor $segment
    if(-not[IO.Directory]::Exists($cursor)){continue}
    Get-B122BootstrapDirectoryIdentity $cursor|Out-Null
  }
}

function Assert-B122BootstrapProtectedAcl([string]$Path){
  $root=[IO.Path]::GetFullPath($Path).TrimEnd('\');Assert-B122BootstrapNoReparseAncestors $root
  $info=New-Object IO.DirectoryInfo($root);$sections=[Security.AccessControl.AccessControlSections]::Owner-bor[Security.AccessControl.AccessControlSections]::Access
  $security=if('System.IO.FileSystemAclExtensions'-as[type]){[IO.FileSystemAclExtensions]::GetAccessControl($info,$sections)}else{$info.GetAccessControl($sections)}
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User;$system=New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::LocalSystemSid,$null);$owner=$security.GetOwner([Security.Principal.SecurityIdentifier])
  if(-not$owner.Equals($user)-or-not$security.AreAccessRulesProtected){throw 'A trusted-bootstrap staging directory lacks its protected current-user owner and DACL.'}
  $allowed=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase);[void]$allowed.Add($user.Value);[void]$allowed.Add($system.Value);$fullControl=@{}
  foreach($rule in @($security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))){
    $sid=[string]$rule.IdentityReference.Value
    if($rule.IsInherited-or-not$allowed.Contains($sid)-or$rule.AccessControlType-ne[Security.AccessControl.AccessControlType]::Allow){throw 'A trusted-bootstrap staging DACL grants or inherits authority outside the current user and SYSTEM.'}
    if(($rule.FileSystemRights-band[Security.AccessControl.FileSystemRights]::FullControl)-eq[Security.AccessControl.FileSystemRights]::FullControl){$fullControl[$sid]=$true}
  }
  if(-not$fullControl[$user.Value]-or-not$fullControl[$system.Value]){throw 'A trusted-bootstrap staging DACL lacks exact current-user or SYSTEM authority.'}
}

function Set-B122BootstrapProtectedAcl([string]$Path){
  $root=[IO.Path]::GetFullPath($Path).TrimEnd('\');Assert-B122BootstrapNoReparseAncestors $root;$info=New-Object IO.DirectoryInfo($root)
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User;$system=New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::LocalSystemSid,$null)
  $security=New-Object Security.AccessControl.DirectorySecurity;$security.SetAccessRuleProtection($true,$false)
  $inherit=[Security.AccessControl.InheritanceFlags]::ContainerInherit-bor[Security.AccessControl.InheritanceFlags]::ObjectInherit
  foreach($sid in @($user,$system)){$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);[void]$security.AddAccessRule($rule)}
  if('System.IO.FileSystemAclExtensions'-as[type]){[IO.FileSystemAclExtensions]::SetAccessControl($info,$security)}else{$info.SetAccessControl($security)}
  Assert-B122BootstrapProtectedAcl $root
}

function Add-B122BootstrapDirectoryIdentity([System.Collections.IDictionary]$Inventory,[string]$Path){
  $snapshot=Get-B122BootstrapDirectoryIdentity $Path;$Inventory[[string]$snapshot.path]=$snapshot
}

function New-B122BootstrapDirectoryIdentityInventory([string]$StagingBase,[string]$Root,[string[]]$RelativeFiles){
  $inventory=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
  Add-B122BootstrapDirectoryIdentity $inventory $StagingBase;Add-B122BootstrapDirectoryIdentity $inventory $Root
  $directories=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);[void]$directories.Add('runtime-temp')
  foreach($relative in $RelativeFiles){
    $parent=[IO.Path]::GetDirectoryName($relative.Replace('/','\'))
    while(-not[string]::IsNullOrWhiteSpace($parent)){[void]$directories.Add($parent);$parent=[IO.Path]::GetDirectoryName($parent)}
  }
  foreach($relative in @($directories|Sort-Object Length)){Add-B122BootstrapDirectoryIdentity $inventory (Join-Path $Root $relative)}
  return $inventory
}

function Test-B122BootstrapContainsPath([string]$Parent,[string]$Candidate){
  $parentFull=[IO.Path]::GetFullPath($Parent).TrimEnd('\');$candidateFull=[IO.Path]::GetFullPath($Candidate).TrimEnd('\')
  return $candidateFull.Equals($parentFull,[StringComparison]::OrdinalIgnoreCase)-or$candidateFull.StartsWith(($parentFull+'\'),[StringComparison]::OrdinalIgnoreCase)
}

function Assert-B122BootstrapDirectoryIdentities([System.Collections.IDictionary]$Inventory,[string]$Path,[switch]$All){
  $target=[IO.Path]::GetFullPath($Path).TrimEnd('\')
  foreach($key in @($Inventory.Keys|Sort-Object{([string]$_).Length})){
    if(-not$All-and-not(Test-B122BootstrapContainsPath ([string]$key) $target)){continue}
    $expected=$Inventory[$key];$actual=Get-B122BootstrapDirectoryIdentity ([string]$key)
    if([string]$actual.identity-cne[string]$expected.identity-or-not([string]$actual.finalPath).Equals([string]$expected.finalPath,[StringComparison]::OrdinalIgnoreCase)){throw "A trusted-bootstrap staging directory changed filesystem identity: $key"}
  }
}

function Read-B122BootstrapBytes([string]$Path,[long]$MaximumBytes){
  $item=Get-B122BootstrapItem $Path $false
  if($item.Length-lt2-or$item.Length-gt$MaximumBytes){throw "Trusted release metadata is outside its size bound: $Path"}
  return [IO.File]::ReadAllBytes($item.FullName)
}

function Get-B122BootstrapTrustSnapshot([string]$Root){
  $records=[Collections.Generic.List[string]]::new()
  $hashes=[ordered]@{}
  $bounds=@{'release.json'=1MB;'SHA256SUMS.json'=32MB;'sbom.spdx.json'=64MB}
  foreach($name in @('release.json','SHA256SUMS.json','sbom.spdx.json')){
    $path=Join-Path $Root $name
    $item=Get-B122BootstrapItem $path $false
    if($item.Length-lt2-or$item.Length-gt[long]$bounds[$name]){throw "Release trust-root metadata is outside its size bound: $name"}
    $hash=Get-B122BootstrapSha256File $path
    $hashes[$name]=[pscustomobject]@{sha256=$hash;bytes=[long]$item.Length}
    $records.Add("$name`0$hash")
  }
  $bytes=[Text.Encoding]::UTF8.GetBytes(($records.ToArray()-join"`n"))
  try{return [pscustomobject]@{digest=(Get-B122BootstrapSha256Bytes $bytes);files=$hashes}}
  finally{[Array]::Clear($bytes,0,$bytes.Length)}
}

function Test-B122BootstrapRelativePath([string]$Value){
  if([string]::IsNullOrWhiteSpace($Value)-or$Value.Length-gt1024-or$Value.StartsWith('/')-or$Value.EndsWith('/')-or$Value.Contains('\')-or$Value.Contains(':')-or$Value.IndexOfAny([char[]]@([char]0,[char]10,[char]13))-ge0-or$Value.Normalize([Text.NormalizationForm]::FormC)-cne$Value){throw 'The trusted payload manifest contains an unsafe or non-canonical path.'}
  $segments=@($Value.Split('/'))
  foreach($segment in $segments){
    if([string]::IsNullOrWhiteSpace($segment)-or@('.','..')-ccontains$segment-or$segment.EndsWith('.')-or$segment.EndsWith(' ')-or$segment.Normalize([Text.NormalizationForm]::FormC)-cne$segment){throw 'The trusted payload manifest contains an ambiguous path.'}
    foreach($character in $segment.ToCharArray()){if([int]$character-lt32-or'<>:"/\|?*'.Contains([string]$character)){throw 'The trusted payload manifest contains an invalid Windows filename character.'}}
    if($segment-match'^(?i:CON|PRN|AUX|NUL|COM[1-9\u00B9\u00B2\u00B3]|LPT[1-9\u00B9\u00B2\u00B3])(?:\..*)?$'){throw 'The trusted payload manifest contains a reserved Windows device name.'}
  }
  return $segments
}

function New-B122BootstrapConcreteDirectory([string]$Root,[string[]]$Segments){
  $cursor=$Root
  Get-B122BootstrapItem $cursor $true|Out-Null
  foreach($segment in $Segments){
    $cursor=Join-Path $cursor $segment
    [IO.Directory]::CreateDirectory($cursor)|Out-Null
    Get-B122BootstrapItem $cursor $true|Out-Null
  }
  return $cursor
}

function Open-B122BootstrapVerifiedFile([string]$Path,[string]$ExpectedSha256,[long]$ExpectedBytes){
  $item=Get-B122BootstrapItem $Path $false
  if([long]$item.Length-ne$ExpectedBytes){throw "A privately staged file changed size before execution: $Path"}
  $stream=New-Object IO.FileStream($item.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try{
    if((Get-B122BootstrapSha256Stream $stream)-cne$ExpectedSha256){throw "A privately staged file changed identity before execution: $Path"}
    return $stream
  }catch{$stream.Dispose();throw}
}

function Assert-B122BootstrapConcreteSource([string]$Root,[string[]]$Segments){
  $cursor=$Root
  Get-B122BootstrapItem $cursor $true|Out-Null
  for($index=0;$index-lt$Segments.Count;$index++){
    $cursor=Join-Path $cursor $Segments[$index]
    Get-B122BootstrapItem $cursor ($index-lt($Segments.Count-1))|Out-Null
  }
  return $cursor
}

function Get-B122BootstrapStagingBase([string]$Override,[bool]$AllowOverride){
  if(-not[string]::IsNullOrWhiteSpace($Override)){
    if(-not$AllowOverride){throw 'A test staging root requires -AllowTestStagingRoot.'}
    $candidate=[IO.Path]::GetFullPath($Override)
    $temporary=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(-not($candidate.TrimEnd('\')+'\').StartsWith($temporary,[StringComparison]::OrdinalIgnoreCase)){throw 'The test bootstrap staging root must remain below the operating-system temporary directory.'}
    return $candidate
  }
  $local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if([string]::IsNullOrWhiteSpace($local)-or-not[IO.Path]::IsPathRooted($local)){throw 'The current-user LocalApplicationData Known Folder is unavailable.'}
  return [IO.Path]::GetFullPath((Join-Path $local 'STRATHEX-B122-Bootstrap'))
}

function Get-B122BootstrapKnownFolder([Environment+SpecialFolder]$Folder,[string]$Label){
  $value=[Environment]::GetFolderPath($Folder)
  if([string]::IsNullOrWhiteSpace($value)-or-not[IO.Path]::IsPathRooted($value)-or$value.IndexOfAny([char[]]@([char]0,[char]10,[char]13))-ge0){throw "The current-user $Label Known Folder is unavailable."}
  return [IO.Path]::GetFullPath($value)
}

function Get-B122BootstrapHost([string]$ExpectedPwshDigest){
  $modules=@([Diagnostics.Process]::GetCurrentProcess().Modules|Where-Object{$_.ModuleName-ieq'kernel32.dll'})
  if($modules.Count-ne1){throw 'The trusted bootstrap cannot derive the operating-system System32 directory.'}
  $systemDirectory=[IO.Path]::GetFullPath([IO.Path]::GetDirectoryName([string]$modules[0].FileName))
  Get-B122BootstrapItem $systemDirectory $true|Out-Null
  if([IO.Path]::GetFileName($systemDirectory)-ine'System32'){throw 'The loaded kernel32 module is outside the native System32 directory.'}
  $windowsRoot=[IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($systemDirectory))
  Get-B122BootstrapItem $windowsRoot $true|Out-Null
  $current=[IO.Path]::GetFullPath([string](Microsoft.PowerShell.Management\Get-Process -Id $PID).Path)
  $item=Get-B122BootstrapItem $current $false
  $name=$item.Name.ToLowerInvariant()
  $digest=Get-B122BootstrapSha256File $item.FullName
  if($name-ceq'powershell.exe'){
    $anchored=[IO.Path]::GetFullPath((Join-Path $systemDirectory 'WindowsPowerShell\v1.0\powershell.exe'))
    Get-B122BootstrapItem $anchored $false|Out-Null
    if(-not$current.Equals($anchored,[StringComparison]::OrdinalIgnoreCase)){throw 'Windows PowerShell is not the operating-system-anchored System32 host.'}
  }elseif($name-ceq'pwsh.exe'){
    if([string]::IsNullOrWhiteSpace($ExpectedPwshDigest)-or$digest-cne$ExpectedPwshDigest.ToLowerInvariant()){throw 'pwsh.exe requires its independently reviewed SHA-256 digest.'}
  }else{throw 'The trusted bootstrap requires an exact powershell.exe or digest-pinned pwsh.exe host.'}
  return [pscustomobject]@{path=$item.FullName;sha256=$digest;name=$name;systemDirectory=$systemDirectory;windowsRoot=$windowsRoot}
}

function Get-B122BootstrapChildEnvironment($HostIdentity,[string]$StagingRoot){
  $runtimeTemp=New-B122BootstrapConcreteDirectory $StagingRoot @('runtime-temp')
  $profile=Get-B122BootstrapKnownFolder ([Environment+SpecialFolder]::UserProfile) 'profile'
  $local=Get-B122BootstrapKnownFolder ([Environment+SpecialFolder]::LocalApplicationData) 'LocalApplicationData'
  $roaming=Get-B122BootstrapKnownFolder ([Environment+SpecialFolder]::ApplicationData) 'ApplicationData'
  $common=Get-B122BootstrapKnownFolder ([Environment+SpecialFolder]::CommonApplicationData) 'CommonApplicationData'
  $programFiles=Get-B122BootstrapKnownFolder ([Environment+SpecialFolder]::ProgramFiles) 'ProgramFiles'
  $pathEntries=[Collections.Generic.List[string]]::new()
  foreach($path in @([string]$HostIdentity.systemDirectory,[IO.Path]::GetDirectoryName([string]$HostIdentity.path),(Join-Path $local 'Programs\Microsoft VS Code\bin'),(Join-Path $programFiles 'Microsoft VS Code\bin'))){
    if([string]::IsNullOrWhiteSpace($path)-or$pathEntries.Contains($path)){continue}
    if([IO.Directory]::Exists($path)){Get-B122BootstrapItem $path $true|Out-Null;$pathEntries.Add([IO.Path]::GetFullPath($path))}
  }
  $comspec=Join-Path ([string]$HostIdentity.systemDirectory) 'cmd.exe';Get-B122BootstrapItem $comspec $false|Out-Null
  $environment=[ordered]@{
    SystemRoot=[string]$HostIdentity.windowsRoot
    WINDIR=[string]$HostIdentity.windowsRoot
    SystemDrive=[IO.Path]::GetPathRoot([string]$HostIdentity.windowsRoot).TrimEnd('\')
    ComSpec=$comspec
    TEMP=$runtimeTemp
    TMP=$runtimeTemp
    USERPROFILE=$profile
    LOCALAPPDATA=$local
    APPDATA=$roaming
    ProgramData=$common
    ProgramFiles=$programFiles
    ProgramW6432=$programFiles
    PATH=($pathEntries.ToArray()-join';')
    PSModulePath=if($HostIdentity.name-ceq'powershell.exe'){Join-Path ([string]$HostIdentity.systemDirectory) 'WindowsPowerShell\v1.0\Modules'}else{''}
    SXSY_B122_TRUSTED_BOOTSTRAP='1'
  }
  foreach($entry in $environment.GetEnumerator()){
    $value=[string]$entry.Value
    if($entry.Key-cnotmatch'^[A-Za-z_][A-Za-z0-9_]{0,127}$'-or$value.IndexOfAny([char[]]@([char]0,[char]10,[char]13))-ge0-or$value.Length-gt8192){throw 'The trusted bootstrap produced an invalid child environment.'}
  }
  return $environment
}

function ConvertTo-B122BootstrapWindowsArgument([string]$Value){
  if($Value.IndexOf([char]0)-ge0-or$Value.IndexOfAny([char[]]@([char]10,[char]13))-ge0){throw 'A trusted-bootstrap process argument is invalid.'}
  $builder=New-Object Text.StringBuilder;[void]$builder.Append('"');$slashes=0
  foreach($character in $Value.ToCharArray()){
    if($character-eq'\'){$slashes++;continue}
    if($character-eq'"'){[void]$builder.Append(('\'*($slashes*2+1)));[void]$builder.Append('"');$slashes=0;continue}
    if($slashes){[void]$builder.Append(('\'*$slashes));$slashes=0};[void]$builder.Append($character)
  }
  if($slashes){[void]$builder.Append(('\'*($slashes*2)))};[void]$builder.Append('"');return $builder.ToString()
}

function Invoke-B122BootstrapSupervisor([string]$HelperPath,[string]$RequestPath,[string]$StatePath,[System.Collections.IDictionary]$Environment,[int]$TimeoutSeconds){
  $start=New-Object Diagnostics.ProcessStartInfo
  $start.FileName=$HelperPath
  $start.Arguments=(@('--supervise',$RequestPath,$StatePath)|ForEach-Object{ConvertTo-B122BootstrapWindowsArgument ([string]$_)})-join' '
  $start.WorkingDirectory=[IO.Path]::GetDirectoryName($RequestPath)
  $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  $start.EnvironmentVariables.Clear()
  foreach($entry in $Environment.GetEnumerator()){$start.EnvironmentVariables[[string]$entry.Key]=[string]$entry.Value}
  $process=New-Object Diagnostics.Process;$process.StartInfo=$start
  try{
    if(-not$process.Start()){throw 'The trusted repository supervisor could not start.'}
    $stdoutTask=$process.StandardOutput.ReadToEndAsync();$stderrTask=$process.StandardError.ReadToEndAsync()
    if(-not$process.WaitForExit([Math]::Min([int]::MaxValue,($TimeoutSeconds+30)*1000))){
      try{$process.Kill()}catch{};[void]$process.WaitForExit(10000)
      throw 'The trusted repository supervisor exceeded its bounded lifecycle.'
    }
    $process.WaitForExit()
    $stdout=[string]$stdoutTask.GetAwaiter().GetResult();$stderr=[string]$stderrTask.GetAwaiter().GetResult()
    if([Text.Encoding]::UTF8.GetByteCount($stdout)+[Text.Encoding]::UTF8.GetByteCount($stderr)-gt262144){throw 'The trusted installer exceeded its bootstrap output bound.'}
    return [pscustomobject]@{exitCode=[int]$process.ExitCode;stdout=$stdout;stderr=$stderr}
  }finally{$process.Dispose()}
}

function Assert-B122BootstrapInstallResult([string]$Raw,[string]$ExpectedOperation,[string]$ExpectedCommit,[string]$ExpectedDigest,[string]$ExpectedInstallRoot,[string]$ExpectedStateRoot){
  if([string]::IsNullOrWhiteSpace($Raw)-or[Text.Encoding]::UTF8.GetByteCount($Raw)-gt65536-or$Raw.IndexOf([char]0)-ge0){throw 'The verified installer returned no exact bounded receipt.'}
  $text=$Raw.Trim()
  try{$parsed=@($text|Microsoft.PowerShell.Utility\ConvertFrom-Json)}catch{throw 'The verified installer returned malformed JSON.'}
  if($parsed.Count-ne1){throw 'The verified installer returned multiple or absent receipts.'};$value=$parsed[0]
  $expectedKeys=@('schema','version','status','operation','sourceCommit','bundleId','trustDigest','installRoot','stateRoot','previous')
  $keys=@($value.PSObject.Properties.Name)
  if($keys.Count-ne$expectedKeys.Count-or@($keys|Where-Object{$_-cnotin$expectedKeys}).Count-or($value|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress)-cne$text){throw 'The verified installer result is not one exact canonical receipt.'}
  $expectedStatus=if($ExpectedOperation-ceq'install'){'installed'}else{'updated'}
  if($value.schema-cne'sxsy-b122.install-result'-or$value.version-ne3-or[string]$value.status-cne$expectedStatus-or[string]$value.operation-cne$ExpectedOperation-or[string]$value.sourceCommit-cne$ExpectedCommit-or[string]$value.trustDigest-cne$ExpectedDigest-or[string]$value.bundleId-cnotmatch'^[a-f0-9]{64}$'){throw 'The verified installer result is bound to another release or operation.'}
  $actualInstall=[IO.Path]::GetFullPath([string]$value.installRoot);$actualState=[IO.Path]::GetFullPath([string]$value.stateRoot)
  if(-not$actualInstall.Equals($ExpectedInstallRoot,[StringComparison]::OrdinalIgnoreCase)-or-not$actualState.Equals($ExpectedStateRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'The verified installer result is bound to different local roots.'}
  if($null-ne$value.previous-and[string]$value.previous-cnotmatch'^[a-f0-9]{40}$'){throw 'The verified installer result contains an invalid previous-version identity.'}
  return $value
}

function Write-B122BootstrapOperationReceipt([string]$StagingBase,[string]$OperationId,[string]$Suffix,[System.Collections.Specialized.OrderedDictionary]$Fields){
  $directory=New-B122BootstrapConcreteDirectory $StagingBase @('receipts')
  Set-B122BootstrapProtectedAcl $directory
  if($Fields.Contains('receiptSha256')){throw 'Bootstrap receipt fields already contain an integrity digest.'}
  $body=[Text.Encoding]::UTF8.GetBytes(($Fields|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress))
  try{$Fields['receiptSha256']=Get-B122BootstrapSha256Bytes $body}finally{[Array]::Clear($body,0,$body.Length)}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($Fields|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress))
  if($bytes.Length-lt2-or$bytes.Length-gt65536){throw 'The external bootstrap operation receipt is outside its size bound.'}
  $path=Join-Path $directory "$OperationId.$Suffix.json"
  $stream=New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
  return $path
}

function Invoke-B122BootstrapCleanupReplacementProbe([string]$Root){
  $retained="$Root.retained-$(New-B122BootstrapHex 16)";[IO.Directory]::Move($Root,$retained);[IO.Directory]::CreateDirectory($Root)|Out-Null;Set-B122BootstrapProtectedAcl $Root
  [IO.File]::WriteAllText((Join-Path $Root 'replacement-sentinel.txt'),'must survive cleanup',(New-Object Text.UTF8Encoding($false)))
}

function Remove-B122BootstrapStaging([string]$Root,[string[]]$RelativeFiles,[System.Collections.IDictionary]$ExpectedFiles,[System.Collections.IDictionary]$DirectoryIdentities,[string]$CleanupMutation){
  $failures=[Collections.Generic.List[string]]::new()
  try{Assert-B122BootstrapDirectoryIdentities $DirectoryIdentities $Root -All}catch{$failures.Add(". ($($_.Exception.Message))");return $failures.ToArray()}
  $mutationApplied=$false
  $uniqueFiles=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($relative in $RelativeFiles){$uniqueFiles.Add($relative)|Out-Null}
  foreach($relative in @($uniqueFiles|Sort-Object Length -Descending)){
    $path=Join-Path $Root ($relative.Replace('/','\'))
    $removed=$false;$lastFailure=$null
    for($attempt=0;$attempt-lt100;$attempt++){
      try{
        Assert-B122BootstrapDirectoryIdentities $DirectoryIdentities $path
        if([IO.File]::Exists($path)){
          $segments=@(Test-B122BootstrapRelativePath $relative);Assert-B122BootstrapConcreteSource $Root $segments|Out-Null
          $item=Get-B122BootstrapItem $path $false
          if(-not$ExpectedFiles.Contains($relative)){throw 'Staged cleanup encountered an unbound file.'}
          $expected=$ExpectedFiles[$relative]
          if([long]$item.Length-ne[long]$expected.bytes-or(Get-B122BootstrapSha256File $path)-cne[string]$expected.sha256){throw 'Staged file identity changed before cleanup.'}
          if(-not$mutationApplied-and$CleanupMutation-ceq'replace-root-before-file-delete'){Invoke-B122BootstrapCleanupReplacementProbe $Root;$mutationApplied=$true}
          Assert-B122BootstrapDirectoryIdentities $DirectoryIdentities $path;Assert-B122BootstrapConcreteSource $Root $segments|Out-Null
        }elseif([IO.Directory]::Exists($path)){throw 'A staged file path became a directory.'}
      }catch{$failures.Add("$relative ($($_.Exception.Message))");return $failures.ToArray()}
      try{if([IO.File]::Exists($path)){[IO.File]::Delete($path)};$removed=$true;break}catch{$lastFailure=$_.Exception.Message;[Threading.Thread]::Sleep(20)}
    }
    if(-not$removed){$failures.Add("$relative ($lastFailure)")}
  }
  $directories=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $directories.Add('runtime-temp')|Out-Null
  foreach($relative in $RelativeFiles){
    $parent=[IO.Path]::GetDirectoryName($relative.Replace('/','\'))
    while(-not[string]::IsNullOrWhiteSpace($parent)){$directories.Add($parent)|Out-Null;$parent=[IO.Path]::GetDirectoryName($parent)}
  }
  foreach($relative in @($directories|Sort-Object Length -Descending)){
    $path=Join-Path $Root $relative
    $removed=$false;$lastFailure=$null
    for($attempt=0;$attempt-lt100;$attempt++){
      try{Assert-B122BootstrapDirectoryIdentities $DirectoryIdentities $path}catch{$failures.Add("$relative ($($_.Exception.Message))");return $failures.ToArray()}
      try{if([IO.Directory]::Exists($path)){Get-B122BootstrapItem $path $true|Out-Null;Assert-B122BootstrapDirectoryIdentities $DirectoryIdentities $path;[IO.Directory]::Delete($path,$false)};$removed=$true;break}catch{$lastFailure=$_.Exception.Message;[Threading.Thread]::Sleep(20)}
    }
    if(-not$removed){$failures.Add("$relative ($lastFailure)")}
  }
  $removedRoot=$false;$lastFailure=$null
  if(-not$mutationApplied-and$CleanupMutation-ceq'replace-root-before-root-delete'){
    try{Invoke-B122BootstrapCleanupReplacementProbe $Root;$mutationApplied=$true}catch{$failures.Add(". (test cleanup mutation failed safely: $($_.Exception.Message))");return $failures.ToArray()}
  }
  for($attempt=0;$attempt-lt100;$attempt++){
    try{Assert-B122BootstrapDirectoryIdentities $DirectoryIdentities $Root}catch{$failures.Add(". ($($_.Exception.Message))");return $failures.ToArray()}
    try{if([IO.Directory]::Exists($Root)){Get-B122BootstrapItem $Root $true|Out-Null;Assert-B122BootstrapDirectoryIdentities $DirectoryIdentities $Root;[IO.Directory]::Delete($Root,$false)};$removedRoot=$true;break}catch{$lastFailure=$_.Exception.Message;[Threading.Thread]::Sleep(20)}
  }
  if(-not$removedRoot){$failures.Add(". ($lastFailure)")}
  return @($failures.ToArray()|Sort-Object -Unique)
}

$bundle=[IO.Path]::GetFullPath($BundleRoot)
if($bundle.IndexOfAny([char[]]@([char]0,[char]10,[char]13,[char]34))-ge0){throw 'The candidate bundle path contains unsafe characters.'}
Get-B122BootstrapItem $bundle $true|Out-Null
if($TestCleanupMutation-cne'none'-and(-not$AllowTestStagingRoot-or[string]::IsNullOrWhiteSpace($TestStagingRoot))){throw 'A cleanup-mutation probe requires the explicit temporary test staging boundary.'}
$expectedDigest=$ExpectedTrustDigest.ToLowerInvariant();$expectedCommit=$ExpectedSourceCommit.ToLowerInvariant()
$hostIdentity=Get-B122BootstrapHost $ExpectedPowerShellSha256
$defaultState=[IO.Path]::GetFullPath((Join-Path (Get-B122BootstrapKnownFolder ([Environment+SpecialFolder]::LocalApplicationData) 'LocalApplicationData') 'STRATHEX\switchyard'))
$expectedState=if([string]::IsNullOrWhiteSpace($StateRoot)){$defaultState}else{[IO.Path]::GetFullPath($StateRoot)}
$expectedInstall=if([string]::IsNullOrWhiteSpace($InstallRoot)){[IO.Path]::GetFullPath((Join-Path $defaultState 'install'))}else{[IO.Path]::GetFullPath($InstallRoot)}
foreach($path in @($expectedInstall,$expectedState)){if($path.IndexOfAny([char[]]@([char]0,[char]10,[char]13,[char]34))-ge0){throw 'An installation root contains unsafe characters.'}}
if(-not$SkipVsCode-and-not$expectedState.Equals($defaultState,[StringComparison]::OrdinalIgnoreCase)){throw 'A custom state root is isolated-test only and requires -SkipVsCode.'}

$trusted=Get-B122BootstrapTrustSnapshot $bundle
if([string]$trusted.digest-cne$expectedDigest){throw 'The candidate release trust digest does not match the independently supplied value.'}
$releaseBytes=Read-B122BootstrapBytes (Join-Path $bundle 'release.json') 1MB
$manifestBytes=Read-B122BootstrapBytes (Join-Path $bundle 'SHA256SUMS.json') 32MB
try{
  $release=([Text.Encoding]::UTF8.GetString($releaseBytes)|Microsoft.PowerShell.Utility\ConvertFrom-Json)
  $manifest=@(([Text.Encoding]::UTF8.GetString($manifestBytes)|Microsoft.PowerShell.Utility\ConvertFrom-Json))
}finally{[Array]::Clear($releaseBytes,0,$releaseBytes.Length);[Array]::Clear($manifestBytes,0,$manifestBytes.Length)}
$trustedAgain=Get-B122BootstrapTrustSnapshot $bundle
if([string]$trustedAgain.digest-cne$expectedDigest){throw 'Release trust-root metadata changed during bootstrap validation.'}
if($release.schema-cne'sxsy-b122.windows-release'-or$release.version-ne1-or[string]$release.sourceCommit-cne$expectedCommit-or$release.verificationSkipped-ne$false-or$release.evidenceEligible-ne$true){throw 'The trusted release identity is invalid, development-only, or not the expected source commit.'}
if($manifest.Count-lt1-or$manifest.Count-gt100000-or[int]$release.payloadCount-ne$manifest.Count){throw 'The trusted payload manifest count is invalid.'}

$entries=[Collections.Generic.List[object]]::new();$paths=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);[long]$totalBytes=0
foreach($entry in $manifest){
  $properties=@($entry.PSObject.Properties.Name)
  if($properties.Count-ne3-or@($properties|Where-Object{$_-cnotin@('path','sha256','bytes')}).Count){throw 'The trusted payload manifest schema is invalid.'}
  $relative=[string]$entry.path;$segments=@(Test-B122BootstrapRelativePath $relative)
  if(-not$paths.Add($relative)){throw 'The trusted payload manifest contains a normalization, case, or duplicate path collision.'}
  if($relative-cin@('release.json','SHA256SUMS.json','sbom.spdx.json')){throw 'Release trust-root metadata must not be self-listed as payload.'}
  $sha256=[string]$entry.sha256
  if($sha256-cnotmatch'^[a-f0-9]{64}$'-or($entry.bytes-isnot[int]-and$entry.bytes-isnot[long])-or[long]$entry.bytes-lt0-or[long]$entry.bytes-gt2GB){throw 'The trusted payload manifest contains an invalid file identity.'}
  $totalBytes+=[long]$entry.bytes;if($totalBytes-gt4GB){throw 'The trusted payload manifest exceeds the bootstrap disk bound.'}
  $source=Assert-B122BootstrapConcreteSource $bundle $segments;$sourceItem=Get-B122BootstrapItem $source $false
  if([long]$sourceItem.Length-ne[long]$entry.bytes-or(Get-B122BootstrapSha256File $source)-cne$sha256){throw "Candidate payload bytes do not match the trusted manifest: $relative"}
  $entries.Add([pscustomobject]@{path=$relative;segments=$segments;sha256=$sha256;bytes=[long]$entry.bytes;source=$source})
}
$helperRelative='app/dist/apps/windows-companion/repository-runtime/b122-repository-runner.exe'
foreach($required in @('scripts/Install-B122.ps1','scripts/B122InstallTools.psm1','scripts/B122ReleaseIntegrity.psm1','scripts/Test-B122ReleaseArtifact.ps1',$helperRelative)){if(-not$paths.Contains($required)){throw "The trusted candidate is missing a bootstrap-critical file: $required"}}

$stagingBase=Get-B122BootstrapStagingBase $TestStagingRoot ([bool]$AllowTestStagingRoot)
[IO.Directory]::CreateDirectory($stagingBase)|Out-Null;Get-B122BootstrapItem $stagingBase $true|Out-Null;Set-B122BootstrapProtectedAcl $stagingBase
$operationStem=New-B122BootstrapHex;$operationId="bootstrap:$operationStem"
$staging=Join-Path $stagingBase ("c-$($operationStem.Substring(0,24))");[IO.Directory]::CreateDirectory($staging)|Out-Null
try{Get-B122BootstrapItem $staging $true|Out-Null;Set-B122BootstrapProtectedAcl $staging}catch{try{[IO.Directory]::Delete($staging,$false)}catch{};throw}
$stagedRelative=[Collections.Generic.List[string]]::new();$stagedFiles=[ordered]@{};$locks=[Collections.Generic.List[IDisposable]]::new();$directoryIdentities=$null
$startedAt=[DateTimeOffset]::UtcNow.ToString('O');$outcomeWritten=$false;$installSucceeded=$false;$caught=$null;$supervisorExit=$null;$installResult=$null
try{
  foreach($metadata in @('release.json','SHA256SUMS.json','sbom.spdx.json')){
    $source=Assert-B122BootstrapConcreteSource $bundle @($metadata);$destination=Join-Path $staging $metadata
    [IO.File]::Copy($source,$destination,$false);$stagedRelative.Add($metadata)
    $identity=$trusted.files[$metadata];$stagedFiles[$metadata]=[pscustomobject]@{sha256=[string]$identity.sha256;bytes=[long]$identity.bytes}
  }
  foreach($entry in $entries){
    $parentSegments=if($entry.segments.Count-gt1){@($entry.segments[0..($entry.segments.Count-2)])}else{@()}
    New-B122BootstrapConcreteDirectory $staging $parentSegments|Out-Null
    $destination=Join-Path $staging ([string]$entry.path).Replace('/','\');[IO.File]::Copy([string]$entry.source,$destination,$false)
    $stagedRelative.Add([string]$entry.path);$stagedFiles[[string]$entry.path]=[pscustomobject]@{sha256=[string]$entry.sha256;bytes=[long]$entry.bytes}
  }
  foreach($entry in $stagedFiles.GetEnumerator()){
    $path=Join-Path $staging ([string]$entry.Key).Replace('/','\')
    $locks.Add((Open-B122BootstrapVerifiedFile $path ([string]$entry.Value.sha256) ([long]$entry.Value.bytes)))
  }
  $stagedTrust=Get-B122BootstrapTrustSnapshot $staging
  if([string]$stagedTrust.digest-cne$expectedDigest){throw 'Release trust-root metadata changed while it was privately staged and locked.'}

  $environment=Get-B122BootstrapChildEnvironment $hostIdentity $staging
  $directoryIdentities=New-B122BootstrapDirectoryIdentityInventory $stagingBase $staging $stagedRelative.ToArray()
  $helper=Join-Path $staging $helperRelative.Replace('/','\');$installer=Join-Path $staging 'scripts\Install-B122.ps1'
  $helperEntry=@($entries|Where-Object{[string]$_.path-ceq$helperRelative});if($helperEntry.Count-ne1){throw 'The trusted process supervisor has an ambiguous manifest identity.'}
  $arguments=[Collections.Generic.List[string]]::new()
  foreach($value in @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$installer,'-BundleRoot',$staging,'-InstallRoot',$expectedInstall,'-StateRoot',$expectedState,'-TrustedBootstrapDigest',$expectedDigest,'-TrustedBootstrapSourceCommit',$expectedCommit,'-OperationKindOverride',$OperationKindOverride)){$arguments.Add($value)}
  if($SkipVsCode){$arguments.Add('-SkipVsCode')};if($SkipAutostart){$arguments.Add('-SkipAutostart')}
  $controlToken=New-B122BootstrapHex;$requestPath=Join-Path $staging 'bootstrap-supervisor.request.json';$statePath=Join-Path $staging 'bootstrap-supervisor.state.json'
  $manifestIdentity=$trusted.files['SHA256SUMS.json'];$helperIdentity=$helperEntry[0]
  $request=[ordered]@{
    schema='sxsy-b122.repository-supervisor-request';version=1;supervisorId="managed:$operationStem";operationId=$operationId;action='trusted_bootstrap'
    repositoryRoot=$staging;manifestSha256=[string]$manifestIdentity.sha256;helperPath=$helper;helperSha256=[string]$helperIdentity.sha256
    executable=[string]$hostIdentity.path;executableSha256=[string]$hostIdentity.sha256;arguments=$arguments.ToArray();workingDirectory=$staging;environment=$environment
    lifecycle='foreground';timeoutMs=$InstallerTimeoutSeconds*1000;maxOutputBytes=262144;controlToken=$controlToken;statePath=$statePath
  }
  $requestBytes=[Text.Encoding]::UTF8.GetBytes(($request|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 8 -Compress))
  if($requestBytes.Length-lt2-or$requestBytes.Length-gt262144){throw 'The trusted supervisor request is outside its size bound.'}
  $requestStream=New-Object IO.FileStream($requestPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try{$requestStream.Write($requestBytes,0,$requestBytes.Length);$requestStream.Flush($true)}finally{$requestStream.Dispose()}
  $requestLength=[long]$requestBytes.Length;$requestSha=Get-B122BootstrapSha256Bytes $requestBytes;$stagedFiles['bootstrap-supervisor.request.json']=[pscustomobject]@{sha256=$requestSha;bytes=$requestLength};$stagedRelative.Add('bootstrap-supervisor.request.json')
  [Array]::Clear($requestBytes,0,$requestBytes.Length);$locks.Add((Open-B122BootstrapVerifiedFile $requestPath $requestSha $requestLength))
  Write-B122BootstrapOperationReceipt $stagingBase $operationStem 'started' ([ordered]@{schema='sxsy-b122.bootstrap-operation';version=1;operationId=$operationId;status='started';cleanup='pending';sourceCommit=$expectedCommit;trustDigest=$expectedDigest;operation=$OperationKindOverride;installRoot=$expectedInstall;stateRoot=$expectedState;stagingRoot=$staging;startedAt=$startedAt;completedAt=$null;childExitCode=$null;resultSha256=$null;error=$null})|Out-Null

  $run=Invoke-B122BootstrapSupervisor $helper $requestPath $statePath $environment $InstallerTimeoutSeconds;$supervisorExit=[int]$run.exitCode
  if([IO.File]::Exists($statePath)){
    $stateItem=Get-B122BootstrapItem $statePath $false
    if($stateItem.Length-lt2-or$stateItem.Length-gt262144){throw 'The trusted supervisor state is outside its size bound.'}
    $stateSha=Get-B122BootstrapSha256File $statePath;$stagedFiles['bootstrap-supervisor.state.json']=[pscustomobject]@{sha256=$stateSha;bytes=[long]$stateItem.Length};$stagedRelative.Add('bootstrap-supervisor.state.json')
  }
  if($run.exitCode-ne0){$diagnostic=([string]$run.stderr).Trim().Replace("`r",' ').Replace("`n",' ');if($diagnostic.Length-gt2048){$diagnostic=$diagnostic.Substring(0,2048)};throw "The independently verified B122 installer failed in its Job-contained host (exit $($run.exitCode)): $diagnostic"}
  if(-not[string]::IsNullOrWhiteSpace([string]$run.stderr)){throw 'The independently verified B122 installer emitted unexpected diagnostics on success.'}
  $stateBytes=Read-B122BootstrapBytes $statePath 262144
  try{$supervisorState=([Text.Encoding]::UTF8.GetString($stateBytes)|Microsoft.PowerShell.Utility\ConvertFrom-Json)}finally{[Array]::Clear($stateBytes,0,$stateBytes.Length)}
  $stateKeys=@($supervisorState.PSObject.Properties.Name);$expectedStateKeys=@('schema','version','supervisorId','operationId','action','repositoryRoot','manifestSha256','helperPath','helperSha256','requestSha256','controlTokenSha256','jobName','supervisorPid','childPid','startedAt','state','exitCode','outputTruncated')
  $controlBytes=[Text.Encoding]::UTF8.GetBytes($controlToken);try{$controlHash=Get-B122BootstrapSha256Bytes $controlBytes}finally{[Array]::Clear($controlBytes,0,$controlBytes.Length)}
  if($stateKeys.Count-ne$expectedStateKeys.Count-or@($stateKeys|Where-Object{$_-cnotin$expectedStateKeys}).Count-or$supervisorState.schema-cne'sxsy-b122.repository-supervisor-state'-or$supervisorState.version-ne1-or[string]$supervisorState.supervisorId-cne"managed:$operationStem"-or[string]$supervisorState.operationId-cne$operationId-or[string]$supervisorState.action-cne'trusted_bootstrap'-or[string]$supervisorState.repositoryRoot-cne$staging-or[string]$supervisorState.manifestSha256-cne[string]$manifestIdentity.sha256-or[string]$supervisorState.helperPath-cne$helper-or[string]$supervisorState.helperSha256-cne[string]$helperIdentity.sha256-or[string]$supervisorState.requestSha256-cne$requestSha-or[string]$supervisorState.controlTokenSha256-cne$controlHash-or[string]$supervisorState.jobName-cne"Local\SxsyB122-$operationStem"-or[string]$supervisorState.state-cne'completed'-or[int]$supervisorState.exitCode-ne0-or[bool]$supervisorState.outputTruncated){throw 'The trusted process supervisor did not produce one exact successful terminal state.'}
  $installResult=Assert-B122BootstrapInstallResult ([string]$run.stdout) $OperationKindOverride $expectedCommit $expectedDigest $expectedInstall $expectedState
  $resultBytes=[Text.Encoding]::UTF8.GetBytes(([string]$run.stdout).Trim());try{$resultSha=Get-B122BootstrapSha256Bytes $resultBytes}finally{[Array]::Clear($resultBytes,0,$resultBytes.Length)}
  Write-B122BootstrapOperationReceipt $stagingBase $operationStem 'outcome' ([ordered]@{schema='sxsy-b122.bootstrap-operation';version=1;operationId=$operationId;status='installer_succeeded';cleanup='pending';sourceCommit=$expectedCommit;trustDigest=$expectedDigest;operation=$OperationKindOverride;installRoot=$expectedInstall;stateRoot=$expectedState;stagingRoot=$staging;startedAt=$startedAt;completedAt=[DateTimeOffset]::UtcNow.ToString('O');childExitCode=0;resultSha256=$resultSha;error=$null})|Out-Null
  $outcomeWritten=$true;$installSucceeded=$true
}catch{
  $caught=$_
  if(-not$outcomeWritten){
    $message=([string]$_.Exception.Message).Replace([char]0,[char]' ').Replace("`r",' ').Replace("`n",' ');if($message.Length-gt1024){$message=$message.Substring(0,1024)}
    try{Write-B122BootstrapOperationReceipt $stagingBase $operationStem 'outcome' ([ordered]@{schema='sxsy-b122.bootstrap-operation';version=1;operationId=$operationId;status='installer_failed';cleanup='pending';sourceCommit=$expectedCommit;trustDigest=$expectedDigest;operation=$OperationKindOverride;installRoot=$expectedInstall;stateRoot=$expectedState;stagingRoot=$staging;startedAt=$startedAt;completedAt=[DateTimeOffset]::UtcNow.ToString('O');childExitCode=$supervisorExit;resultSha256=$null;error=$message})|Out-Null;$outcomeWritten=$true}catch{}
  }
}finally{
  foreach($lock in $locks){try{$lock.Dispose()}catch{}}
  $cleanupFailures=@(if($null-eq$directoryIdentities){'. (staging directory identities were not established)'}else{Remove-B122BootstrapStaging $staging $stagedRelative.ToArray() $stagedFiles $directoryIdentities $TestCleanupMutation})
  $cleanup=if($cleanupFailures.Count){'retained'}else{'completed'}
  try{Write-B122BootstrapOperationReceipt $stagingBase $operationStem 'cleanup' ([ordered]@{schema='sxsy-b122.bootstrap-operation';version=1;operationId=$operationId;status=if($installSucceeded){'installer_succeeded'}else{'installer_failed'};cleanup=$cleanup;sourceCommit=$expectedCommit;trustDigest=$expectedDigest;operation=$OperationKindOverride;installRoot=$expectedInstall;stateRoot=$expectedState;stagingRoot=$staging;startedAt=$startedAt;completedAt=[DateTimeOffset]::UtcNow.ToString('O');childExitCode=$supervisorExit;resultSha256=$null;error=if($cleanupFailures.Count){"Retained exact staging paths: $($cleanupFailures-join', ')"}else{$null}})|Out-Null}catch{}
}
if($null-ne$caught){throw $caught}
if($cleanupFailures.Count){Microsoft.PowerShell.Utility\Write-Warning "The successful bootstrap retained exact staging content; consult the durable external cleanup receipt: $($cleanupFailures-join', ')"}
$installResult|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress|Write-Output
