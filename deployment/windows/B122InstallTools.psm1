Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
if(-not('SxsyB122V2.NativeCommandLine' -as [type])){
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
namespace SxsyB122V2 {
  public static class NativeCommandLine {
    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)] struct ByHandleFileInformation { public uint Attributes; public FileTime Creation; public FileTime Access; public FileTime Write; public uint VolumeSerial; public uint SizeHigh; public uint SizeLow; public uint Links; public uint FileIndexHigh; public uint FileIndexLow; }
    [DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern uint GetFinalPathNameByHandleW(IntPtr handle, StringBuilder path, uint length, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr handle, out ByHandleFileInformation information);
    public static string[] Parse(string commandLine) {
      int count; IntPtr pointer=CommandLineToArgvW(commandLine,out count);
      if(pointer==IntPtr.Zero || count<1 || count>32) throw new Win32Exception(Marshal.GetLastWin32Error());
      try { var result=new string[count]; for(int i=0;i<count;i++) result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer,i*IntPtr.Size)); return result; }
      finally { LocalFree(pointer); }
    }
    public static bool Matches(string commandLine, string[] expected) {
      string[] actual=Parse(commandLine); if(actual.Length!=expected.Length) return false;
      for(int i=0;i<actual.Length;i++) { var comparison=i<=1?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal; if(!string.Equals(actual[i],expected[i],comparison)) return false; }
      return true;
    }
    public static string GetCreationFileTimeUtc(int pid) {
      IntPtr process=OpenProcess(0x1000,false,(uint)pid); if(process==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      try { uint exitCode; if(!GetExitCodeProcess(process,out exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error()); if(exitCode!=259) throw new InvalidOperationException("The process has exited."); FileTime creation,exit,kernel,user; if(!GetProcessTimes(process,out creation,out exit,out kernel,out user)) throw new Win32Exception(Marshal.GetLastWin32Error()); return (((ulong)creation.High<<32)|creation.Low).ToString(); }
      finally { CloseHandle(process); }
    }
    public static string GetFinalPath(string path) {
      IntPtr handle=CreateFileW(path,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero); if(handle==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try { var builder=new StringBuilder(32768); uint count=GetFinalPathNameByHandleW(handle,builder,(uint)builder.Capacity,0); if(count==0 || count>=builder.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error()); string value=builder.ToString(); if(value.StartsWith(@"\\?\UNC\",StringComparison.OrdinalIgnoreCase)) return @"\\"+value.Substring(8); if(value.StartsWith(@"\\?\",StringComparison.OrdinalIgnoreCase)) return value.Substring(4); return value; }
      finally { CloseHandle(handle); }
    }
    public static string GetFileIdentity(string path) {
      IntPtr handle=CreateFileW(path,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero); if(handle==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try { ByHandleFileInformation information; if(!GetFileInformationByHandle(handle,out information)) throw new Win32Exception(Marshal.GetLastWin32Error()); return information.VolumeSerial.ToString("x8")+":"+information.FileIndexHigh.ToString("x8")+information.FileIndexLow.ToString("x8"); }
      finally { CloseHandle(handle); }
    }
  }
  public sealed class BoundedJobProcess : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int Length; public IntPtr SecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo { public int cb; public string reserved; public string desktop; public string title; public int x,y,xSize,ySize,xCountChars,yCountChars,fillAttribute,flags; public short showWindow,reserved2; public IntPtr reserved2Pointer,stdInput,stdOutput,stdError; }
    [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx { public StartupInfo startup; public IntPtr attributeList; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInformation { public IntPtr process,thread; public int processId,threadId; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long perProcessUserTime,perJobUserTime; public uint limitFlags; public UIntPtr minimumWorkingSet,maximumWorkingSet; public uint activeProcessLimit; public UIntPtr affinity; public uint priorityClass,schedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit basic; public IoCounters io; public UIntPtr processMemoryLimit,jobMemoryLimit,peakProcessMemoryUsed,peakJobMemoryUsed; }
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int infoClass,ref ExtendedLimit info,uint length);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,[MarshalAs(UnmanagedType.Bool)] out bool result);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string application,StringBuilder commandLine,IntPtr processAttributes,IntPtr threadAttributes,bool inheritHandles,uint flags,IntPtr environment,string currentDirectory,ref StartupInfoEx startup,out ProcessInformation process);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,EntryPoint="CreateFileW")] static extern IntPtr CreateFileInheritable(string path,uint access,uint share,ref SecurityAttributes security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint exitCode);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint exitCode);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int infoClass,IntPtr info,uint length,out uint returnedLength);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    IntPtr job,process; bool disposed; public int ProcessId {get;private set;}
    BoundedJobProcess(IntPtr jobHandle,IntPtr processHandle,int processId){job=jobHandle;process=processHandle;ProcessId=processId;}
    public static BoundedJobProcess Start(string executable,string commandLine,string workingDirectory,string stdoutPath,string stderrPath){
      var security=new SecurityAttributes{Length=Marshal.SizeOf(typeof(SecurityAttributes)),InheritHandle=true}; IntPtr stdout=CreateFileInheritable(stdoutPath,0x40000000,3,ref security,2,0x80,IntPtr.Zero); if(stdout==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      IntPtr stderr=CreateFileInheritable(stderrPath,0x40000000,3,ref security,2,0x80,IntPtr.Zero); if(stderr==new IntPtr(-1)){CloseHandle(stdout);throw new Win32Exception(Marshal.GetLastWin32Error());}
      IntPtr stdin=CreateFileInheritable("NUL",0x80000000,3,ref security,3,0x80,IntPtr.Zero);if(stdin==new IntPtr(-1)){CloseHandle(stdout);CloseHandle(stderr);throw new Win32Exception(Marshal.GetLastWin32Error());}
      IntPtr job=IntPtr.Zero,attributeList=IntPtr.Zero,handleList=IntPtr.Zero,jobList=IntPtr.Zero; ProcessInformation pi=new ProcessInformation();
      try{
        job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits=new ExtendedLimit();limits.basic.limitFlags=0x2000;if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit))))throw new Win32Exception(Marshal.GetLastWin32Error());
        var startup=new StartupInfoEx();startup.startup.cb=Marshal.SizeOf(typeof(StartupInfoEx));startup.startup.flags=0x100;startup.startup.stdInput=stdin;startup.startup.stdOutput=stdout;startup.startup.stdError=stderr;
        IntPtr attributeSize=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref attributeSize);attributeList=Marshal.AllocHGlobal(attributeSize);startup.attributeList=attributeList;
        if(!InitializeProcThreadAttributeList(attributeList,2,0,ref attributeSize))throw new Win32Exception(Marshal.GetLastWin32Error());
        handleList=Marshal.AllocHGlobal(IntPtr.Size*3);Marshal.WriteIntPtr(handleList,0,stdin);Marshal.WriteIntPtr(handleList,IntPtr.Size,stdout);Marshal.WriteIntPtr(handleList,IntPtr.Size*2,stderr);
        if(!UpdateProcThreadAttribute(attributeList,0,new IntPtr(0x00020002),handleList,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());
        jobList=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobList,job);
        if(!UpdateProcThreadAttribute(attributeList,0,new IntPtr(0x0002000d),jobList,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());
        if(!CreateProcessW(executable,new StringBuilder(commandLine),IntPtr.Zero,IntPtr.Zero,true,0x08080004,IntPtr.Zero,workingDirectory,ref startup,out pi))throw new Win32Exception(Marshal.GetLastWin32Error());
        bool assigned;if(!IsProcessInJob(pi.process,job,out assigned)||!assigned)throw new Win32Exception(Marshal.GetLastWin32Error());
        if(ResumeThread(pi.thread)==0xffffffff)throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(pi.thread);pi.thread=IntPtr.Zero;return new BoundedJobProcess(job,pi.process,pi.processId);
      }catch(Exception failure){
        if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}
        bool contained=true;if(pi.process!=IntPtr.Zero){TerminateProcess(pi.process,130);contained=WaitForSingleObject(pi.process,5000)==0;}
        if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);
        if(!contained)throw new InvalidOperationException("The bounded native child could not be contained after launch failure.",failure);throw;
      }
      finally{if(attributeList!=IntPtr.Zero){DeleteProcThreadAttributeList(attributeList);Marshal.FreeHGlobal(attributeList);}if(handleList!=IntPtr.Zero)Marshal.FreeHGlobal(handleList);if(jobList!=IntPtr.Zero)Marshal.FreeHGlobal(jobList);CloseHandle(stdin);CloseHandle(stdout);CloseHandle(stderr);}
    }
    public bool Wait(int milliseconds){return WaitForSingleObject(process,(uint)milliseconds)==0;}
    public int ExitCode {get{uint code;if(!GetExitCodeProcess(process,out code))throw new Win32Exception(Marshal.GetLastWin32Error());return unchecked((int)code);}}
    public int[] JobProcessIds(){IntPtr buffer=Marshal.AllocHGlobal(8+IntPtr.Size*4096);try{uint returned;if(!QueryInformationJobObject(job,3,buffer,(uint)(8+IntPtr.Size*4096),out returned))throw new Win32Exception(Marshal.GetLastWin32Error());uint count=(uint)Marshal.ReadInt32(buffer,4);var result=new int[count];for(int i=0;i<count;i++)result[i]=unchecked((int)Marshal.ReadIntPtr(buffer,8+i*IntPtr.Size).ToInt64());return result;}finally{Marshal.FreeHGlobal(buffer);}}
    public void CloseJob(){if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}}
    public void Dispose(){if(disposed)return;disposed=true;CloseJob();if(process!=IntPtr.Zero){CloseHandle(process);process=IntPtr.Zero;}}
  }
}
'@
}

$script:B122OwnershipName = '.sxsy-b122-install-root.json'
$script:B122ManifestName = '.sxsy-b122-root-manifest.json'
$script:B122LifecycleName = '.sxsy-b122-lifecycle.json'
$script:B122StateOwnershipName = '.sxsy-b122-state-root.json'
$script:B122ProtectedDocumentSchema = 'sxsy-b122.dpapi-protected-document'

function Get-B122Sha256Bytes {
  param([Parameter(Mandatory=$true)][byte[]]$Bytes)
  $algorithm=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose()}
}

function ConvertFrom-B122Hex {
  param([Parameter(Mandatory=$true)][string]$Hex)
  if($Hex -notmatch '^(?:[0-9a-fA-F]{2})+$'){throw 'B122 digest hex is invalid.'}
  $bytes=New-Object byte[] ($Hex.Length/2)
  for($index=0;$index -lt $bytes.Length;$index++){$bytes[$index]=[Convert]::ToByte($Hex.Substring($index*2,2),16)}
  return ,$bytes
}

function Test-B122FixedTimeBytes {
  param([Parameter(Mandatory=$true)][byte[]]$First,[Parameter(Mandatory=$true)][byte[]]$Second)
  if($First.Length -ne $Second.Length){return $false};$difference=0
  for($index=0;$index -lt $First.Length;$index++){$difference=$difference -bor ($First[$index] -bxor $Second[$index])}
  return $difference -eq 0
}

function Write-B122BytesAtomic {
  param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][byte[]]$Bytes)
  $full=[IO.Path]::GetFullPath($Path);$parent=Split-Path -Parent $full
  if(-not(Test-Path -LiteralPath $parent -PathType Container)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
  Assert-B122NoReparseAncestors -Path $parent
  $parentCanonical=[SxsyB122V2.NativeCommandLine]::GetFinalPath($parent).TrimEnd('\');$parentIdentity=[SxsyB122V2.NativeCommandLine]::GetFileIdentity($parent)
  if(Test-Path -LiteralPath $full){Assert-B122NoReparseAncestors -Path $full;$destination=Get-Item -LiteralPath $full -Force;if($destination.PSIsContainer-or($destination.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'Atomic B122 metadata refused a non-regular destination.'}}
  $temporary=Join-Path $parent ('.b122-atomic-'+[guid]::NewGuid().ToString('N')+'.tmp')
  $backup=Join-Path $parent ('.b122-atomic-'+[guid]::NewGuid().ToString('N')+'.bak')
  try{
    $stream=New-Object IO.FileStream($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
    try{$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    Assert-B122NoReparseAncestors -Path $parent
    if(-not[SxsyB122V2.NativeCommandLine]::GetFinalPath($parent).TrimEnd('\').Equals($parentCanonical,[StringComparison]::OrdinalIgnoreCase)-or[SxsyB122V2.NativeCommandLine]::GetFileIdentity($parent)-cne$parentIdentity){throw 'Atomic B122 metadata parent identity changed before commit.'}
    if(Test-Path -LiteralPath $full){Assert-B122NoReparseAncestors -Path $full;$destination=Get-Item -LiteralPath $full -Force;if($destination.PSIsContainer-or($destination.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'Atomic B122 metadata destination changed before commit.'}}
    if(Test-Path -LiteralPath $full -PathType Leaf){[IO.File]::Replace($temporary,$full,$backup);Remove-Item -LiteralPath $backup -Force}else{[IO.File]::Move($temporary,$full)}
    Assert-B122NoReparseAncestors -Path $full
    if(-not[SxsyB122V2.NativeCommandLine]::GetFinalPath($parent).TrimEnd('\').Equals($parentCanonical,[StringComparison]::OrdinalIgnoreCase)-or[SxsyB122V2.NativeCommandLine]::GetFileIdentity($parent)-cne$parentIdentity){throw 'Atomic B122 metadata parent identity changed during commit.'}
  }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force};if(Test-Path -LiteralPath $backup){Remove-Item -LiteralPath $backup -Force}}
}

function ConvertTo-B122ProtectedDocument {
  param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$Kind,[Parameter(Mandatory=$true)]$Payload)
  $payloadBytes=[Text.Encoding]::UTF8.GetBytes(($Payload|ConvertTo-Json -Depth 100 -Compress))
  if($payloadBytes.Length -le 1 -or $payloadBytes.Length -gt 16MB){throw 'Protected B122 metadata is outside its size bound.'}
  $binding=[Text.Encoding]::UTF8.GetBytes("sxsy-b122-protected-v1`0$Kind`0$([IO.Path]::GetFullPath($Path).ToLowerInvariant())`0")
  $combined=New-Object byte[] ($binding.Length+$payloadBytes.Length);[Array]::Copy($binding,0,$combined,0,$binding.Length);[Array]::Copy($payloadBytes,0,$combined,$binding.Length,$payloadBytes.Length)
  $digestBytes=ConvertFrom-B122Hex (Get-B122Sha256Bytes -Bytes $combined)
  $proof=[Security.Cryptography.ProtectedData]::Protect($digestBytes,$binding,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  return [ordered]@{schema=$script:B122ProtectedDocumentSchema;version=1;kind=$Kind;payload=[Convert]::ToBase64String($payloadBytes);proof=[Convert]::ToBase64String($proof)}
}

function Write-B122ProtectedJson {
  param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$Kind,[Parameter(Mandatory=$true)]$Payload)
  $document=ConvertTo-B122ProtectedDocument -Path $Path -Kind $Kind -Payload $Payload
  Write-B122BytesAtomic -Path $Path -Bytes ([Text.Encoding]::UTF8.GetBytes(($document|ConvertTo-Json -Depth 8 -Compress)))
}

function Read-B122ProtectedJson {
  param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$Kind)
  $full=[IO.Path]::GetFullPath($Path);$item=Get-Item -LiteralPath $full -Force
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -le 1 -or $item.Length -gt 32MB){throw "Protected B122 $Kind metadata is not one bounded regular file."}
  $document=Get-Content -LiteralPath $full -Raw|ConvertFrom-Json
  $propertyNames=@($document.PSObject.Properties|ForEach-Object{[string]$_.Name}|Sort-Object)
  if(($propertyNames-join',')-cne'kind,payload,proof,schema,version'-or$document.schema -cne $script:B122ProtectedDocumentSchema -or $document.version -ne 1 -or $document.kind -cne $Kind){throw "Protected B122 $Kind metadata has an invalid envelope."}
  try{$payloadBytes=[Convert]::FromBase64String([string]$document.payload);$proof=[Convert]::FromBase64String([string]$document.proof)}catch{throw "Protected B122 $Kind metadata encoding is invalid."}
  $binding=[Text.Encoding]::UTF8.GetBytes("sxsy-b122-protected-v1`0$Kind`0$($full.ToLowerInvariant())`0")
  try{$expected=[Security.Cryptography.ProtectedData]::Unprotect($proof,$binding,[Security.Cryptography.DataProtectionScope]::CurrentUser)}catch{throw "Protected B122 $Kind metadata authentication failed."}
  $combined=New-Object byte[] ($binding.Length+$payloadBytes.Length);[Array]::Copy($binding,0,$combined,0,$binding.Length);[Array]::Copy($payloadBytes,0,$combined,$binding.Length,$payloadBytes.Length)
  $actual=ConvertFrom-B122Hex (Get-B122Sha256Bytes -Bytes $combined)
  if(-not(Test-B122FixedTimeBytes -First $expected -Second $actual)){throw "Protected B122 $Kind metadata authentication failed."}
  try{return [Text.Encoding]::UTF8.GetString($payloadBytes)|ConvertFrom-Json}catch{throw "Protected B122 $Kind payload is invalid."}
}

function Test-B122PathOverlap {
  param([Parameter(Mandatory=$true)][string]$First,[Parameter(Mandatory=$true)][string]$Second)
  $a=[IO.Path]::GetFullPath($First).TrimEnd('\');$b=[IO.Path]::GetFullPath($Second).TrimEnd('\')
  return $a.Equals($b,[StringComparison]::OrdinalIgnoreCase) -or $a.StartsWith($b+'\',[StringComparison]::OrdinalIgnoreCase) -or $b.StartsWith($a+'\',[StringComparison]::OrdinalIgnoreCase)
}

function Enter-B122LifecycleLock {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[ValidateRange(1,300)][int]$TimeoutSeconds=60)
  $requested=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$cursor=$requested;$tail=New-Object Collections.Generic.List[string]
  while(-not(Test-Path -LiteralPath $cursor)){if($cursor-eq[IO.Path]::GetPathRoot($cursor)){break};$tail.Insert(0,(Split-Path -Leaf $cursor));$cursor=Split-Path -Parent $cursor}
  $canonical=[SxsyB122V2.NativeCommandLine]::GetFinalPath($cursor).TrimEnd('\');foreach($part in $tail){$canonical=Join-Path $canonical $part};$canonical=$canonical.ToLowerInvariant()
  $digest=Get-B122Sha256Bytes -Bytes ([Text.Encoding]::UTF8.GetBytes($canonical));$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value.Replace('-','_')
  $mutex=New-Object Threading.Mutex($false,('Global\SxsyB122Lifecycle-'+$sid+'-'+$digest))
  try{$acquired=$mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))}catch [Threading.AbandonedMutexException] {$acquired=$true}
  if(-not$acquired){$mutex.Dispose();throw 'Another B122 lifecycle operation owns this exact install root.'}
  return $mutex
}

function Exit-B122LifecycleLock {
  param([Parameter(Mandatory=$true)][Threading.Mutex]$Lock)
  try{$Lock.ReleaseMutex()}finally{$Lock.Dispose()}
}

function Get-B122AutostartRegistryPath {
  $default='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if($env:SXSY_B122_TEST_MODE-cne'1'-or[string]::IsNullOrWhiteSpace($env:SXSY_B122_TEST_RUN_KEY_PATH)){return $default}
  $candidate=[string]$env:SXSY_B122_TEST_RUN_KEY_PATH
  if($candidate.IndexOfAny([char[]]@([char]0,[char]10,[char]13,[char]34))-ge0-or-not$candidate.StartsWith('HKCU:\Software\SXSY-B122-Tests\',[StringComparison]::OrdinalIgnoreCase)-or-not$candidate.EndsWith('\Run',[StringComparison]::OrdinalIgnoreCase)){throw 'The isolated B122 autostart registry path is invalid.'}
  return $candidate
}

function Get-B122FileSystemIdentity {
  param([Parameter(Mandatory=$true)][string]$Path)
  $full=[IO.Path]::GetFullPath($Path)
  Assert-B122NoReparseAncestors -Path $full
  if(-not(Test-Path -LiteralPath $full)){throw 'The B122 filesystem identity target does not exist.'}
  return [SxsyB122V2.NativeCommandLine]::GetFileIdentity($full)
}

function Assert-B122NoReparseAncestors {
  param([Parameter(Mandatory=$true)][string]$Path)
  $full=[IO.Path]::GetFullPath($Path);$drive=[IO.Path]::GetPathRoot($full);$relative=$full.Substring($drive.Length);$cursor=$drive
  foreach($part in @($relative -split '[\\/]'|Where-Object{$_})){
    $cursor=Join-Path $cursor $part
    if(-not(Test-Path -LiteralPath $cursor)){continue}
    $entry=Get-Item -LiteralPath $cursor -Force
    if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "B122 path contains a reparse/junction component: $cursor"}
  }
}

function Assert-B122SafeOwnedRootCandidate {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[string[]]$ProtectedPaths=@())
  if([string]::IsNullOrWhiteSpace($InstallRoot) -or $InstallRoot.IndexOf([char]0) -ge 0 -or $InstallRoot.Contains('"')){throw 'B122 install root is invalid.'}
  $full=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
  $drive=[IO.Path]::GetPathRoot($full).TrimEnd('\')
  if($full.Equals($drive,[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing a drive root as the B122 install root.'}
  foreach($broad in @([Environment]::GetFolderPath('UserProfile'),[Environment]::GetFolderPath('LocalApplicationData'),[Environment]::GetFolderPath('ApplicationData'))){
    if($broad -and $full.Equals([IO.Path]::GetFullPath($broad).TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing a user-profile root as the B122 install root.'}
  }
  foreach($protected in @($ProtectedPaths|Where-Object{-not[string]::IsNullOrWhiteSpace($_)})){if(Test-B122PathOverlap -First $full -Second $protected){throw 'The B122 install root overlaps a protected workspace or release source.'}}
  Assert-B122NoReparseAncestors -Path $full
  return $full
}

function Set-B122ProtectedRootAcl {
  param([Parameter(Mandatory=$true)][string]$Path)
  $root=[IO.Path]::GetFullPath($Path).TrimEnd('\');Assert-B122NoReparseAncestors -Path $root;$info=New-Object IO.DirectoryInfo($root)
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User;$system=New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::LocalSystemSid,$null)
  $security=New-Object Security.AccessControl.DirectorySecurity;$security.SetAccessRuleProtection($true,$false)
  $inherit=[Security.AccessControl.InheritanceFlags]::ContainerInherit-bor[Security.AccessControl.InheritanceFlags]::ObjectInherit
  foreach($sid in @($user,$system)){$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);[void]$security.AddAccessRule($rule)}
  if('System.IO.FileSystemAclExtensions'-as[type]){[IO.FileSystemAclExtensions]::SetAccessControl($info,$security)}else{$info.SetAccessControl($security)};Assert-B122ProtectedRootAcl -Path $root|Out-Null
}

function Assert-B122ProtectedRootAcl {
  param([Parameter(Mandatory=$true)][string]$Path)
  $root=[IO.Path]::GetFullPath($Path).TrimEnd('\');Assert-B122NoReparseAncestors -Path $root;$info=New-Object IO.DirectoryInfo($root);$sections=[Security.AccessControl.AccessControlSections]::Owner-bor[Security.AccessControl.AccessControlSections]::Access;$security=if('System.IO.FileSystemAclExtensions'-as[type]){[IO.FileSystemAclExtensions]::GetAccessControl($info,$sections)}else{$info.GetAccessControl($sections)}
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User;$system=New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::LocalSystemSid,$null);$owner=$security.GetOwner([Security.Principal.SecurityIdentifier])
  if(-not$owner.Equals($user)-or-not$security.AreAccessRulesProtected){throw 'The B122 owned root does not have a protected current-user DACL.'}
  $allowed=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase);[void]$allowed.Add($user.Value);[void]$allowed.Add($system.Value);$full=@{}
  foreach($rule in @($security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))){$sid=[string]$rule.IdentityReference.Value;if($rule.IsInherited-or-not$allowed.Contains($sid)-or$rule.AccessControlType-ne[Security.AccessControl.AccessControlType]::Allow){throw 'The B122 owned root DACL grants or inherits authority outside current-user and SYSTEM.'};if(($rule.FileSystemRights-band[Security.AccessControl.FileSystemRights]::FullControl)-eq[Security.AccessControl.FileSystemRights]::FullControl){$full[$sid]=$true}}
  if(-not$full[$user.Value]-or-not$full[$system.Value]){throw 'The B122 owned root DACL is missing exact current-user or SYSTEM authority.'}
  return $true
}

function Initialize-B122OwnedInstallRoot {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[string[]]$ProtectedPaths=@())
  $root=Assert-B122SafeOwnedRootCandidate -InstallRoot $InstallRoot -ProtectedPaths $ProtectedPaths
  $sentinel=Join-Path $root $script:B122OwnershipName
  if(Test-Path -LiteralPath $root){
    $item=Get-Item -LiteralPath $root -Force;if(-not$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'The B122 install root is not a concrete directory.'}
    if(Test-Path -LiteralPath $sentinel -PathType Leaf){return Get-B122InstallOwnership -InstallRoot $root}
    if(@(Get-ChildItem -LiteralPath $root -Force).Count -ne 0){throw 'Refusing a nonempty unowned B122 install root.'}
  }else{New-Item -ItemType Directory -Path $root|Out-Null}
  Set-B122ProtectedRootAcl -Path $root
  if(@(Get-ChildItem -LiteralPath $root -Force).Count-ne0){throw 'The new B122 install root changed before ownership protection.'}
  $payload=[ordered]@{schema='sxsy-b122.install-root-ownership';version=1;rootId=[guid]::NewGuid().ToString('D');canonicalRoot=$root;product='SXSY-B122';createdAt=(Get-Date).ToUniversalTime().ToString('o')}
  Write-B122ProtectedJson -Path $sentinel -Kind ownership -Payload $payload
  $manifest=[ordered]@{schema='sxsy-b122.install-root-manifest';version=1;rootId=$payload.rootId;stateRoot=$null;stateRootId=$null;versions=@();rootTools=@();updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  Write-B122ProtectedJson -Path (Join-Path $root $script:B122ManifestName) -Kind manifest -Payload $manifest
  return Get-B122InstallOwnership -InstallRoot $root
}

function Get-B122InstallOwnership {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $root=Assert-B122SafeOwnedRootCandidate -InstallRoot $InstallRoot;Assert-B122ProtectedRootAcl -Path $root|Out-Null
  $ownership=Read-B122ProtectedJson -Path (Join-Path $root $script:B122OwnershipName) -Kind ownership
  $parsed=[guid]::Empty
  if($ownership.schema -cne 'sxsy-b122.install-root-ownership' -or $ownership.version -ne 1 -or -not[guid]::TryParse([string]$ownership.rootId,[ref]$parsed) -or $ownership.product -cne 'SXSY-B122' -or -not([IO.Path]::GetFullPath([string]$ownership.canonicalRoot).Equals($root,[StringComparison]::OrdinalIgnoreCase))){throw 'The authenticated B122 install-root ownership sentinel is invalid.'}
  return $ownership
}

function Initialize-B122OwnedStateRoot {
  param([Parameter(Mandatory=$true)][string]$StateRoot,[string[]]$ProtectedPaths=@())
  $root=Assert-B122SafeOwnedRootCandidate -InstallRoot $StateRoot -ProtectedPaths $ProtectedPaths;$sentinel=Join-Path $root $script:B122StateOwnershipName
  if(Test-Path -LiteralPath $root){$item=Get-Item -LiteralPath $root -Force;if(-not$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'The B122 state root is not a concrete directory.'};if(Test-Path -LiteralPath $sentinel -PathType Leaf){return Get-B122StateOwnership -StateRoot $root};if(@(Get-ChildItem -LiteralPath $root -Force).Count){throw 'Refusing a nonempty unowned B122 state root.'}}
  else{New-Item -ItemType Directory -Path $root|Out-Null}
  Set-B122ProtectedRootAcl -Path $root
  if(@(Get-ChildItem -LiteralPath $root -Force).Count-ne0){throw 'The new B122 state root changed before ownership protection.'}
  $payload=[ordered]@{schema='sxsy-b122.state-root-ownership';version=2;rootId=[guid]::NewGuid().ToString('D');canonicalRoot=$root;product='SXSY-B122';boundInstallRoot=$null;boundInstallRootId=$null;retiredInstallRoot=$null;retiredInstallRootId=$null;bindingUpdatedAt=(Get-Date).ToUniversalTime().ToString('o');createdAt=(Get-Date).ToUniversalTime().ToString('o')}
  Write-B122ProtectedJson -Path $sentinel -Kind state_ownership -Payload $payload;return Get-B122StateOwnership -StateRoot $root
}

function Get-B122StateOwnership {
  param([Parameter(Mandatory=$true)][string]$StateRoot)
  $root=Assert-B122SafeOwnedRootCandidate -InstallRoot $StateRoot;Assert-B122ProtectedRootAcl -Path $root|Out-Null;$ownership=Read-B122ProtectedJson -Path (Join-Path $root $script:B122StateOwnershipName) -Kind state_ownership;$parsed=[guid]::Empty
  if($ownership.schema -cne 'sxsy-b122.state-root-ownership' -or $ownership.version -notin @(1,2) -or -not[guid]::TryParse([string]$ownership.rootId,[ref]$parsed) -or $ownership.product -cne 'SXSY-B122' -or -not([IO.Path]::GetFullPath([string]$ownership.canonicalRoot).Equals($root,[StringComparison]::OrdinalIgnoreCase))){throw 'The authenticated B122 state-root ownership sentinel is invalid.'}
  if($ownership.version-eq2){
    $boundRoot=$ownership.PSObject.Properties['boundInstallRoot'];$boundId=$ownership.PSObject.Properties['boundInstallRootId']
    if($null-eq$boundRoot-or$null-eq$boundId-or(([string]::IsNullOrWhiteSpace([string]$boundRoot.Value))-xor([string]::IsNullOrWhiteSpace([string]$boundId.Value)))){throw 'The authenticated B122 state-root install binding is invalid.'}
    if(-not[string]::IsNullOrWhiteSpace([string]$boundRoot.Value)){try{[void][IO.Path]::GetFullPath([string]$boundRoot.Value);$installId=[guid]::Empty;if(-not[guid]::TryParse([string]$boundId.Value,[ref]$installId)){throw 'invalid'}}catch{throw 'The authenticated B122 state-root install binding is invalid.'}}
    $retiredRoot=$ownership.PSObject.Properties['retiredInstallRoot'];$retiredId=$ownership.PSObject.Properties['retiredInstallRootId'];if(($null-ne$retiredRoot-or$null-ne$retiredId)-and($null-eq$retiredRoot-or$null-eq$retiredId-or(([string]::IsNullOrWhiteSpace([string]$retiredRoot.Value))-xor([string]::IsNullOrWhiteSpace([string]$retiredId.Value))))){throw 'The authenticated B122 state-root retirement binding is invalid.'}
    if($null-ne$retiredRoot-and-not[string]::IsNullOrWhiteSpace([string]$retiredRoot.Value)){try{[void][IO.Path]::GetFullPath([string]$retiredRoot.Value);$retiredGuid=[guid]::Empty;if(-not[guid]::TryParse([string]$retiredId.Value,[ref]$retiredGuid)){throw 'invalid'}}catch{throw 'The authenticated B122 state-root retirement binding is invalid.'}}
  }
  return $ownership
}

function Write-B122OperationReceipt {
  param([Parameter(Mandatory=$true)][string]$StateRoot,[Parameter(Mandatory=$true)][string]$Name,[Parameter(Mandatory=$true)]$Payload)
  $root=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\');Get-B122StateOwnership -StateRoot $root|Out-Null
  if($Name -notmatch '^[a-z0-9][a-z0-9-]{0,63}\.json$'){throw 'A B122 operation receipt requires one fixed safe JSON filename.'}
  $directory=Join-Path $root 'lifecycle-receipts';if(-not(Test-Path -LiteralPath $directory)){New-Item -ItemType Directory -Path $directory|Out-Null};Assert-B122NoReparseAncestors -Path $directory
  $path=Join-Path $directory $Name;Write-B122ProtectedJson -Path $path -Kind receipt -Payload $Payload;return $path
}

function Read-B122OperationReceipt {
  param([Parameter(Mandatory=$true)][string]$StateRoot,[Parameter(Mandatory=$true)][string]$Name)
  $root=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\');Get-B122StateOwnership -StateRoot $root|Out-Null
  if($Name-notmatch'^[a-z0-9][a-z0-9-]{0,63}\.json$'){throw 'A B122 operation receipt requires one fixed safe JSON filename.'}
  $path=Join-Path (Join-Path $root 'lifecycle-receipts') $Name;if(-not(Test-Path -LiteralPath $path -PathType Leaf)){return $null}
  return Read-B122ProtectedJson -Path $path -Kind receipt
}

function Write-B122CompanionSupervisorRequest {
  param([Parameter(Mandatory=$true)][string]$StateRoot,[Parameter(Mandatory=$true)]$Payload)
  $state=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\');Get-B122StateOwnership -StateRoot $state|Out-Null
  $names=@($Payload.PSObject.Properties.Name|Sort-Object)
  $expected=@('arguments','bundleId','bundleRoot','controlToken','environment','helperPath','helperSha256','mainPath','mainSha256','nodePath','nodeSha256','schema','statePath','stateRoot','stderrPath','stdoutPath','supervisorId','version','workingDirectory')|Sort-Object
  if(($names-join',')-cne($expected-join',')-or$Payload.schema-cne'sxsy-b122.companion-supervisor-request'-or$Payload.version-ne1-or[string]$Payload.supervisorId-cnotmatch'^companion:[a-f0-9]{64}$'){throw 'The companion supervisor request has an invalid exact schema.'}
  foreach($digest in @('bundleId','controlToken','helperSha256','mainSha256','nodeSha256')){if([string]$Payload.$digest-cnotmatch'^[a-f0-9]{64}$'){throw 'The companion supervisor request contains an invalid digest.'}}
  $requestPath=Join-Path $state 'companion-supervisor.request.json';$statePath=Join-Path $state 'companion-supervisor.state.json'
  if(-not([IO.Path]::GetFullPath([string]$Payload.stateRoot).Equals($state,[StringComparison]::OrdinalIgnoreCase))-or-not([IO.Path]::GetFullPath([string]$Payload.statePath).Equals($statePath,[StringComparison]::OrdinalIgnoreCase))){throw 'The companion supervisor request escaped the authenticated state root.'}
  $environmentNames=@($Payload.environment.PSObject.Properties.Name|Sort-Object);$expectedEnvironment=@('APPDATA','LOCALAPPDATA','SXSY_B122_COMPANION_SUPERVISOR_REQUEST','SXSY_B122_COMPANION_SUPERVISOR_STATE','SystemRoot','TEMP','TMP','WINDIR')|Sort-Object
  if(($environmentNames-join',')-cne($expectedEnvironment-join',')-or-not([IO.Path]::GetFullPath([string]$Payload.environment.SXSY_B122_COMPANION_SUPERVISOR_REQUEST).Equals($requestPath,[StringComparison]::OrdinalIgnoreCase))-or-not([IO.Path]::GetFullPath([string]$Payload.environment.SXSY_B122_COMPANION_SUPERVISOR_STATE).Equals($statePath,[StringComparison]::OrdinalIgnoreCase))){throw 'The companion supervisor request environment is invalid.'}
  foreach($property in @($Payload.PSObject.Properties)+@($Payload.environment.PSObject.Properties)){if($property.Value-is[string]-and([string]$property.Value-match"[`0`r`n]")){throw 'The companion supervisor request contains a forbidden control character.'}}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($Payload|ConvertTo-Json -Depth 8 -Compress));if($bytes.Length-lt2-or$bytes.Length-gt256KB){throw 'The companion supervisor request exceeds its size bound.'}
  Write-B122BytesAtomic -Path $requestPath -Bytes $bytes;return $requestPath
}

function Write-B122ExternalRecoveryRecord {
  param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)]$Payload)
  $full=[IO.Path]::GetFullPath($Path);$name=Split-Path -Leaf $full;if($name-notmatch'^\.sxsy-b122-[a-f0-9]{64}-recovery\.json$'){throw 'The external B122 recovery-record filename is invalid.'}
  $parent=Split-Path -Parent $full;Assert-B122NoReparseAncestors -Path $parent;if(-not(Test-Path -LiteralPath $parent -PathType Container)){New-Item -ItemType Directory -Path $parent|Out-Null;Assert-B122NoReparseAncestors -Path $parent}
  if(Test-Path -LiteralPath $full){$item=Get-Item -LiteralPath $full -Force;if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'The external B122 recovery-record path is unsafe.'}}
  Write-B122ProtectedJson -Path $full -Kind external_recovery -Payload $Payload;return $full
}

function Read-B122ExternalRecoveryRecord {
  param([Parameter(Mandatory=$true)][string]$Path)
  $full=[IO.Path]::GetFullPath($Path);$name=Split-Path -Leaf $full;if($name-notmatch'^\.sxsy-b122-[a-f0-9]{64}-recovery\.json$'){throw 'The external B122 recovery-record filename is invalid.'}
  if(-not(Test-Path -LiteralPath $full -PathType Leaf)){return $null};Assert-B122NoReparseAncestors -Path $full;return Read-B122ProtectedJson -Path $full -Kind external_recovery
}

function Get-B122UninstallRecoveryCapsulePath {
  param([Parameter(Mandatory=$true)][string]$StateRoot,[Parameter(Mandatory=$true)][string]$InstallRootId)
  $parsed=[guid]::Empty
  if(-not[guid]::TryParse($InstallRootId,[ref]$parsed)){throw 'The uninstall recovery capsule install generation is invalid.'}
  $state=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\\')
  $stateBytes=[Text.Encoding]::UTF8.GetBytes($state.ToLowerInvariant())
  try{$stateDigest=Get-B122Sha256Bytes -Bytes $stateBytes}finally{[Array]::Clear($stateBytes,0,$stateBytes.Length)}
  return Join-Path (Split-Path -Parent $state) ('.sxsy-b122-'+$stateDigest+'-'+$InstallRootId.Replace('-','').ToLowerInvariant()+'-uninstall')
}

function New-B122UninstallRecoveryCapsule {
  param(
    [Parameter(Mandatory=$true)][string]$StateRoot,
    [Parameter(Mandatory=$true)][string]$ExpectedStateRootId,
    [Parameter(Mandatory=$true)][string]$InstallRootId,
    [Parameter(Mandatory=$true)][string]$EntryPointSource,
    [Parameter(Mandatory=$true)][string]$ModuleSource
  )
  $state=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\\');$stateOwnership=Get-B122StateOwnership -StateRoot $state
  if([string]$stateOwnership.rootId-cne$ExpectedStateRootId){throw 'The uninstall recovery capsule refused a different state generation.'}
  $root=Get-B122UninstallRecoveryCapsulePath -StateRoot $state -InstallRootId $InstallRootId
  $parent=Split-Path -Parent $root;Assert-B122NoReparseAncestors -Path $parent
  if(Test-Path -LiteralPath $root){
    $rootItem=Get-Item -LiteralPath $root -Force
    if(-not$rootItem.PSIsContainer-or($rootItem.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'The uninstall recovery capsule root is unsafe.'}
    Assert-B122ProtectedRootAcl -Path $root|Out-Null
    $unknown=@(Get-ChildItem -LiteralPath $root -Force|Where-Object{$_.Name-cnotin@('Uninstall-B122.ps1','B122InstallTools.psm1')})
    if($unknown.Count){throw 'The uninstall recovery capsule contains unknown content.'}
  }else{
    New-Item -ItemType Directory -Path $root|Out-Null;Set-B122ProtectedRootAcl -Path $root
  }
  $sources=[ordered]@{'Uninstall-B122.ps1'=[IO.Path]::GetFullPath($EntryPointSource);'B122InstallTools.psm1'=[IO.Path]::GetFullPath($ModuleSource)}
  $written=[ordered]@{}
  foreach($name in $sources.Keys){
    $source=[string]$sources[$name];Assert-B122NoReparseAncestors -Path $source;$item=Get-Item -LiteralPath $source -Force
    if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-or[long]$item.Length-lt1-or[long]$item.Length-gt16MB){throw 'An uninstall recovery capsule source is unsafe or outside its size bound.'}
    $bytes=[IO.File]::ReadAllBytes($source)
    try{$destination=Join-Path $root $name;Write-B122BytesAtomic -Path $destination -Bytes $bytes;$written[$name]=[pscustomobject]@{path=$destination;sha256=Get-B122Sha256Bytes -Bytes $bytes;bytes=[long]$bytes.Length}}
    finally{[Array]::Clear($bytes,0,$bytes.Length)}
  }
  $capsule=[pscustomobject][ordered]@{
    schema='sxsy-b122.uninstall-recovery-capsule';version=1;root=$root;rootFileIdentity=Get-B122FileSystemIdentity -Path $root
    entryPoint=[string]$written['Uninstall-B122.ps1'].path;entryPointSha256=[string]$written['Uninstall-B122.ps1'].sha256;entryPointBytes=[long]$written['Uninstall-B122.ps1'].bytes
    modulePath=[string]$written['B122InstallTools.psm1'].path;moduleSha256=[string]$written['B122InstallTools.psm1'].sha256;moduleBytes=[long]$written['B122InstallTools.psm1'].bytes
  }
  Assert-B122UninstallRecoveryCapsule -StateRoot $state -StateRootId $ExpectedStateRootId -InstallRootId $InstallRootId -Capsule $capsule|Out-Null
  return $capsule
}

function Assert-B122UninstallRecoveryCapsule {
  param(
    [Parameter(Mandatory=$true)][string]$StateRoot,
    [Parameter(Mandatory=$true)][string]$StateRootId,
    [Parameter(Mandatory=$true)][string]$InstallRootId,
    [Parameter(Mandatory=$true)]$Capsule
  )
  $stateId=[guid]::Empty;$installId=[guid]::Empty
  if(-not[guid]::TryParse($StateRootId,[ref]$stateId)-or-not[guid]::TryParse($InstallRootId,[ref]$installId)){throw 'The uninstall recovery capsule generation binding is invalid.'}
  $properties=@($Capsule.PSObject.Properties.Name|Sort-Object);$expected=@('entryPoint','entryPointBytes','entryPointSha256','moduleBytes','modulePath','moduleSha256','root','rootFileIdentity','schema','version')|Sort-Object
  if(($properties-join',')-cne($expected-join',')-or$Capsule.schema-cne'sxsy-b122.uninstall-recovery-capsule'-or$Capsule.version-ne1){throw 'The uninstall recovery capsule has an invalid exact schema.'}
  $expectedRoot=Get-B122UninstallRecoveryCapsulePath -StateRoot $StateRoot -InstallRootId $InstallRootId;$root=[IO.Path]::GetFullPath([string]$Capsule.root).TrimEnd('\\')
  if(-not$root.Equals($expectedRoot,[StringComparison]::OrdinalIgnoreCase)-or[string]$Capsule.rootFileIdentity-cnotmatch'^[a-f0-9]{8}:[a-f0-9]{16}$'){throw 'The uninstall recovery capsule path or filesystem generation is invalid.'}
  Assert-B122NoReparseAncestors -Path $root;$rootItem=Get-Item -LiteralPath $root -Force
  if(-not$rootItem.PSIsContainer-or($rootItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-or(Get-B122FileSystemIdentity -Path $root)-cne[string]$Capsule.rootFileIdentity){throw 'The uninstall recovery capsule root changed after publication.'}
  Assert-B122ProtectedRootAcl -Path $root|Out-Null
  $entries=@(Get-ChildItem -LiteralPath $root -Force)
  if($entries.Count-ne2-or@($entries|Where-Object{$_.Name-cnotin@('Uninstall-B122.ps1','B122InstallTools.psm1')}).Count){throw 'The uninstall recovery capsule inventory changed after publication.'}
  foreach($definition in @(
    [pscustomobject]@{path=[string]$Capsule.entryPoint;expected=(Join-Path $root 'Uninstall-B122.ps1');sha256=[string]$Capsule.entryPointSha256;bytes=[long]$Capsule.entryPointBytes},
    [pscustomobject]@{path=[string]$Capsule.modulePath;expected=(Join-Path $root 'B122InstallTools.psm1');sha256=[string]$Capsule.moduleSha256;bytes=[long]$Capsule.moduleBytes}
  )){
    $path=[IO.Path]::GetFullPath($definition.path)
    if(-not$path.Equals([IO.Path]::GetFullPath($definition.expected),[StringComparison]::OrdinalIgnoreCase)-or$definition.sha256-cnotmatch'^[a-f0-9]{64}$'-or$definition.bytes-lt1-or$definition.bytes-gt16MB){throw 'The uninstall recovery capsule file binding is invalid.'}
    Assert-B122NoReparseAncestors -Path $path;$item=Get-Item -LiteralPath $path -Force
    if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-or[long]$item.Length-ne$definition.bytes-or(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()-cne$definition.sha256){throw 'An uninstall recovery capsule file changed after publication.'}
  }
  if(Test-Path -LiteralPath (Join-Path ([IO.Path]::GetFullPath($StateRoot)) '.sxsy-b122-state-root.json') -PathType Leaf){$liveState=Get-B122StateOwnership -StateRoot $StateRoot;if([string]$liveState.rootId-cne$StateRootId){throw 'The uninstall recovery capsule refused a different live state generation.'}}
  return $true
}

function Get-B122RootManifest {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $ownership=Get-B122InstallOwnership -InstallRoot $InstallRoot;$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
  $manifest=Read-B122ProtectedJson -Path (Join-Path $root $script:B122ManifestName) -Kind manifest
  if($manifest.schema -cne 'sxsy-b122.install-root-manifest' -or $manifest.version -ne 1 -or $manifest.rootId -cne $ownership.rootId -or $null -eq $manifest.versions -or $null -eq $manifest.rootTools){throw 'The authenticated B122 root manifest is invalid.'}
  return $manifest
}

function Write-B122RootManifest {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)]$Manifest)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$ownership=Get-B122InstallOwnership -InstallRoot $root
  if($Manifest.rootId -cne $ownership.rootId){throw 'The B122 root manifest ownership changed.'}
  $Manifest.updatedAt=(Get-Date).ToUniversalTime().ToString('o')
  Write-B122ProtectedJson -Path (Join-Path $root $script:B122ManifestName) -Kind manifest -Payload $Manifest
}

function Bind-B122InstallStateRoot {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$StateRoot)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$state=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
  $stateLock=Enter-B122LifecycleLock -InstallRoot $state
  try{
    $installOwnership=Get-B122InstallOwnership -InstallRoot $root;$stateOwnership=Get-B122StateOwnership -StateRoot $state;$manifest=Get-B122RootManifest -InstallRoot $root
    $manifestRoot=$manifest.PSObject.Properties['stateRoot'];$manifestId=$manifest.PSObject.Properties['stateRootId'];$manifestUnbound=$null-eq$manifestRoot-or[string]::IsNullOrWhiteSpace([string]$manifestRoot.Value)
    if(-not$manifestUnbound-and(-not([IO.Path]::GetFullPath([string]$manifestRoot.Value).Equals($state,[StringComparison]::OrdinalIgnoreCase))-or[string]$manifestId.Value-cne[string]$stateOwnership.rootId)){throw 'The B122 install root is bound to a different authenticated state root.'}
    $stateRootProperty=$stateOwnership.PSObject.Properties['boundInstallRoot'];$stateIdProperty=$stateOwnership.PSObject.Properties['boundInstallRootId'];$stateUnbound=$stateOwnership.version-eq1-or$null-eq$stateRootProperty-or[string]::IsNullOrWhiteSpace([string]$stateRootProperty.Value)
    if(-not$stateUnbound-and(-not([IO.Path]::GetFullPath([string]$stateRootProperty.Value).Equals($root,[StringComparison]::OrdinalIgnoreCase))-or[string]$stateIdProperty.Value-cne[string]$installOwnership.rootId)){throw 'The authenticated B122 state root is already bound to a different install generation.'}
    if($stateUnbound){
      $otherEntries=@(Get-ChildItem -LiteralPath $state -Force|Where-Object{$_.Name-cne$script:B122StateOwnershipName-and-not($root.Equals($_.FullName,[StringComparison]::OrdinalIgnoreCase)-or$root.StartsWith($_.FullName.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase))})
      $retiredRoot=$stateOwnership.PSObject.Properties['retiredInstallRoot'];$retiredId=$stateOwnership.PSObject.Properties['retiredInstallRootId'];$retiredGuid=[guid]::Empty
      $reviewedRetirement=$null-ne$retiredRoot-and$null-ne$retiredId-and-not[string]::IsNullOrWhiteSpace([string]$retiredRoot.Value)-and[guid]::TryParse([string]$retiredId.Value,[ref]$retiredGuid)-and[IO.Path]::GetFullPath([string]$retiredRoot.Value).Equals($root,[StringComparison]::OrdinalIgnoreCase)
      if($otherEntries.Count-and$manifestUnbound-and-not$reviewedRetirement){throw 'A populated legacy B122 state root cannot be claimed without an exact pre-existing install binding or completed retirement.'}
      $boundState=[ordered]@{schema='sxsy-b122.state-root-ownership';version=2;rootId=[string]$stateOwnership.rootId;canonicalRoot=$state;product='SXSY-B122';boundInstallRoot=$root;boundInstallRootId=[string]$installOwnership.rootId;retiredInstallRoot=if($null-eq$retiredRoot){$null}else{$retiredRoot.Value};retiredInstallRootId=if($null-eq$retiredId){$null}else{$retiredId.Value};bindingUpdatedAt=(Get-Date).ToUniversalTime().ToString('o');createdAt=[string]$stateOwnership.createdAt}
      Write-B122ProtectedJson -Path (Join-Path $state $script:B122StateOwnershipName) -Kind state_ownership -Payload $boundState
      $stateOwnership=Get-B122StateOwnership -StateRoot $state
    }
    if($manifestUnbound){
      if($null-eq$manifestRoot){$manifest|Add-Member -NotePropertyName stateRoot -NotePropertyValue $state}else{$manifest.stateRoot=$state}
      if($null-eq$manifestId){$manifest|Add-Member -NotePropertyName stateRootId -NotePropertyValue ([string]$stateOwnership.rootId)}else{$manifest.stateRootId=[string]$stateOwnership.rootId}
      Write-B122RootManifest -InstallRoot $root -Manifest $manifest
    }
    return [pscustomobject][ordered]@{canonicalRoot=$state;rootId=[string]$stateOwnership.rootId}
  }finally{Exit-B122LifecycleLock -Lock $stateLock}
}

function Release-B122InstallStateRootBinding {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$StateRoot,[Parameter(Mandatory=$true)][string]$ExpectedInstallRootId)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$state=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\');$expected=[guid]::Empty
  if(-not[guid]::TryParse($ExpectedInstallRootId,[ref]$expected)){throw 'The state-root retirement requires one exact install generation.'}
  if(Test-Path -LiteralPath $root){throw 'The B122 state-root binding cannot retire while its install root still exists.'}
  $stateLock=Enter-B122LifecycleLock -InstallRoot $state
  try{
    $ownership=Get-B122StateOwnership -StateRoot $state;$boundRoot=$ownership.PSObject.Properties['boundInstallRoot'];$boundId=$ownership.PSObject.Properties['boundInstallRootId'];$retiredRoot=$ownership.PSObject.Properties['retiredInstallRoot'];$retiredId=$ownership.PSObject.Properties['retiredInstallRootId']
    $alreadyRetired=$null-ne$retiredRoot-and$null-ne$retiredId-and-not[string]::IsNullOrWhiteSpace([string]$retiredRoot.Value)-and[IO.Path]::GetFullPath([string]$retiredRoot.Value).Equals($root,[StringComparison]::OrdinalIgnoreCase)-and[string]$retiredId.Value-cne''-and[string]$retiredId.Value-ceq$ExpectedInstallRootId
    if($ownership.version-eq2-and[string]::IsNullOrWhiteSpace([string]$boundRoot.Value)-and$alreadyRetired){return $ownership}
    if($ownership.version-ne2-or$null-eq$boundRoot-or$null-eq$boundId-or[string]::IsNullOrWhiteSpace([string]$boundRoot.Value)-or-not([IO.Path]::GetFullPath([string]$boundRoot.Value).Equals($root,[StringComparison]::OrdinalIgnoreCase))-or[string]$boundId.Value-cne$ExpectedInstallRootId){throw 'The B122 state-root retirement does not match its live install generation.'}
    $retired=[ordered]@{schema='sxsy-b122.state-root-ownership';version=2;rootId=[string]$ownership.rootId;canonicalRoot=$state;product='SXSY-B122';boundInstallRoot=$null;boundInstallRootId=$null;retiredInstallRoot=$root;retiredInstallRootId=$ExpectedInstallRootId;bindingUpdatedAt=(Get-Date).ToUniversalTime().ToString('o');createdAt=[string]$ownership.createdAt}
    Write-B122ProtectedJson -Path (Join-Path $state $script:B122StateOwnershipName) -Kind state_ownership -Payload $retired
    return Get-B122StateOwnership -StateRoot $state
  }finally{Exit-B122LifecycleLock -Lock $stateLock}
}

function Assert-B122InstallStateRootBinding {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$StateRoot)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$state=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
  $installOwnership=Get-B122InstallOwnership -InstallRoot $root;$stateOwnership=Get-B122StateOwnership -StateRoot $state;$manifest=Get-B122RootManifest -InstallRoot $root
  $boundRoot=$manifest.PSObject.Properties['stateRoot'];$boundId=$manifest.PSObject.Properties['stateRootId']
  $stateBoundRoot=$stateOwnership.PSObject.Properties['boundInstallRoot'];$stateBoundId=$stateOwnership.PSObject.Properties['boundInstallRootId']
  if($stateOwnership.version-ne2-or$null-eq$boundRoot-or$null-eq$boundId-or[string]::IsNullOrWhiteSpace([string]$boundRoot.Value)-or-not([IO.Path]::GetFullPath([string]$boundRoot.Value).Equals($state,[StringComparison]::OrdinalIgnoreCase))-or[string]$boundId.Value-cne[string]$stateOwnership.rootId-or$null-eq$stateBoundRoot-or$null-eq$stateBoundId-or-not([IO.Path]::GetFullPath([string]$stateBoundRoot.Value).Equals($root,[StringComparison]::OrdinalIgnoreCase))-or[string]$stateBoundId.Value-cne[string]$installOwnership.rootId){throw 'The B122 install root and authenticated state root are not bidirectionally bound.'}
  return [pscustomobject][ordered]@{canonicalRoot=$state;rootId=[string]$stateOwnership.rootId}
}

function Get-B122TreeInventory {
  param([Parameter(Mandatory=$true)][string]$Root)
  $full=[IO.Path]::GetFullPath($Root).TrimEnd('\');Assert-B122NoReparseAncestors -Path $full
  $rootItem=Get-Item -LiteralPath $full -Force
  if(-not$rootItem.PSIsContainer-or($rootItem.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'A B122 bundle or installed tree root is not one concrete directory.'}
  $files=New-Object Collections.Generic.List[object];$queue=New-Object Collections.Generic.Queue[string];$queue.Enqueue($full)
  while($queue.Count){
    $directory=$queue.Dequeue();$directoryItem=Get-Item -LiteralPath $directory -Force
    if(-not$directoryItem.PSIsContainer-or($directoryItem.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'A B122 bundle or installed tree contains a reparse directory.'}
    foreach($entry in @(Get-ChildItem -LiteralPath $directory -Force|Sort-Object Name)){
      $relative=$entry.FullName.Substring($full.Length+1).Replace('\','/')
      if($relative -match '(^|/)\.\.?($|/)'){throw 'A B122 tree contains a traversal-like path.'}
      if(($entry.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'A B122 bundle or installed tree contains a reparse point.'}
      if($entry.PSIsContainer){$queue.Enqueue($entry.FullName)}
      else{$files.Add($entry)}
    }
  }
  $entries=@($files|ForEach-Object{$relative=$_.FullName.Substring($full.Length+1).Replace('\','/');[pscustomobject][ordered]@{path=$relative;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant();size=[long]$_.Length}}|Sort-Object path)
  return ,$entries
}

function Copy-B122ConcreteTree {
  param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
  $sourceRoot=[IO.Path]::GetFullPath($Source).TrimEnd('\');$destinationRoot=[IO.Path]::GetFullPath($Destination).TrimEnd('\');Assert-B122NoReparseAncestors -Path $sourceRoot;Assert-B122NoReparseAncestors -Path $destinationRoot
  $sourceItem=Get-Item -LiteralPath $sourceRoot -Force;$destinationItem=Get-Item -LiteralPath $destinationRoot -Force
  if(-not$sourceItem.PSIsContainer-or($sourceItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-or-not$destinationItem.PSIsContainer-or($destinationItem.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'B122 concrete tree copy requires two concrete directories.'}
  $queue=New-Object Collections.Generic.Queue[object];$queue.Enqueue([pscustomobject]@{source=$sourceRoot;destination=$destinationRoot})
  while($queue.Count){
    $pair=$queue.Dequeue();$current=Get-Item -LiteralPath $pair.source -Force
    if(-not$current.PSIsContainer-or($current.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'The reviewed B122 bundle changed into a reparse directory during copy.'}
    foreach($entry in @(Get-ChildItem -LiteralPath $pair.source -Force|Sort-Object Name)){
      if(($entry.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'The reviewed B122 bundle contains a reparse point.'}
      $target=Join-Path $pair.destination $entry.Name
      if($entry.PSIsContainer){New-Item -ItemType Directory -Path $target|Out-Null;$queue.Enqueue([pscustomobject]@{source=$entry.FullName;destination=$target})}
      else{Copy-Item -LiteralPath $entry.FullName -Destination $target}
    }
  }
}

function Get-B122BundleIdentity {
  param([Parameter(Mandatory=$true)][string]$BundleRoot)
  $root=[IO.Path]::GetFullPath($BundleRoot);$releasePath=Join-Path $root 'release.json'
  if(-not(Test-Path -LiteralPath $releasePath -PathType Leaf)){throw 'The reviewed B122 bundle has no release.json.'}
  $release=Get-Content -LiteralPath $releasePath -Raw|ConvertFrom-Json
  if($release.schema -cne 'sxsy-b122.windows-release' -or $release.version -ne 1){throw 'The reviewed B122 bundle release identity is invalid.'}
  $commit=Test-B122VersionId ([string]$release.sourceCommit);$files=Get-B122TreeInventory -Root $root
  $identityBytes=[Text.Encoding]::UTF8.GetBytes((@($files|ForEach-Object{"$($_.path)`0$($_.sha256)`0$($_.size)"}) -join "`n"))
  return [pscustomobject][ordered]@{sourceCommit=$commit;bundleId=Get-B122Sha256Bytes -Bytes $identityBytes;files=$files}
}

function Get-B122InstalledVersionRecord {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$SourceCommit)
  $id=Test-B122VersionId $SourceCommit;$manifest=Get-B122RootManifest -InstallRoot $InstallRoot
  $matches=@($manifest.versions|Where-Object{$_.sourceCommit -ceq $id})
  if($matches.Count -gt 1){throw 'The B122 root manifest contains duplicate source commits.'}
  return $(if($matches.Count -eq 1){$matches[0]}else{$null})
}

function Assert-B122ChildPath {
  param([Parameter(Mandatory=$true)][string]$Parent,[Parameter(Mandatory=$true)][string]$Child)
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $childFull = [IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentFull,[StringComparison]::OrdinalIgnoreCase)) { throw "Refusing a path outside the B122 install root: $childFull" }
  return $childFull
}

function Test-B122VersionId {
  param([Parameter(Mandatory=$true)][string]$VersionId)
  if ($VersionId -notmatch '^[0-9a-f]{40}$') { throw 'A B122 installed version must be one exact source commit.' }
  return $VersionId.ToLowerInvariant()
}

function Get-B122InstallState {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');Get-B122InstallOwnership -InstallRoot $root|Out-Null
  $path = Join-Path $root 'install-state.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  $state = Read-B122ProtectedJson -Path $path -Kind state
  $parsed = [DateTime]::MinValue
  if ($state.schema -cne 'sxsy-b122.install-state' -or $state.version -ne 2 -or $state.current -notmatch '^[0-9a-f]{40}$' -or $state.currentBundleId -notmatch '^[0-9a-f]{64}$' -or ($null -ne $state.previous -and ($state.previous -notmatch '^[0-9a-f]{40}$' -or $state.previousBundleId -notmatch '^[0-9a-f]{64}$')) -or -not [DateTime]::TryParse([string]$state.updatedAt,[ref]$parsed)) { throw 'The protected B122 install pointer is malformed.' }
  $record=Get-B122InstalledVersionRecord -InstallRoot $root -SourceCommit ([string]$state.current)
  if($null -eq $record -or $record.bundleId -cne $state.currentBundleId){throw 'The protected B122 install pointer does not match the immutable root manifest.'}
  $current = Join-Path (Join-Path $root 'versions') $state.current
  Assert-B122ChildPath -Parent $InstallRoot -Child $current | Out-Null
  if (-not (Test-Path -LiteralPath $current -PathType Container)) { throw 'The current B122 install pointer references a missing version.' }
  return $state
}

function Write-B122InstallStateAtomic {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$Current,[AllowNull()][string]$Previous,[string]$CurrentBundleId,[AllowNull()][string]$PreviousBundleId)
  $root = [IO.Path]::GetFullPath($InstallRoot)
  Get-B122InstallOwnership -InstallRoot $root|Out-Null
  $currentId = Test-B122VersionId $Current
  $previousId = if ([string]::IsNullOrWhiteSpace($Previous)) { $null } else { Test-B122VersionId $Previous }
  $currentRecord=Get-B122InstalledVersionRecord -InstallRoot $root -SourceCommit $currentId
  if($null -eq $currentRecord){throw "Cannot point at an unmanifested B122 version: $currentId"}
  $resolvedCurrentBundle=if([string]::IsNullOrWhiteSpace($CurrentBundleId)){[string]$currentRecord.bundleId}else{$CurrentBundleId}
  if($resolvedCurrentBundle -cne [string]$currentRecord.bundleId){throw 'The current B122 bundle identity does not match the root manifest.'}
  $resolvedPreviousBundle=$null
  foreach ($id in @($currentId,$previousId)) {
    if ($null -eq $id) { continue }
    $versionRoot = Join-Path (Join-Path $root 'versions') $id
    Assert-B122ChildPath -Parent $root -Child $versionRoot | Out-Null
    if (-not (Test-Path -LiteralPath $versionRoot -PathType Container)) { throw "Cannot point at a missing B122 version: $id" }
  }
  if($null -ne $previousId){$previousRecord=Get-B122InstalledVersionRecord -InstallRoot $root -SourceCommit $previousId;if($null -eq $previousRecord){throw 'The previous B122 version is absent from the root manifest.'};$resolvedPreviousBundle=if([string]::IsNullOrWhiteSpace($PreviousBundleId)){[string]$previousRecord.bundleId}else{$PreviousBundleId};if($resolvedPreviousBundle -cne [string]$previousRecord.bundleId){throw 'The previous B122 bundle identity does not match the root manifest.'}}
  $state = [ordered]@{ schema='sxsy-b122.install-state'; version=2; current=$currentId; currentBundleId=$resolvedCurrentBundle; previous=$previousId; previousBundleId=$resolvedPreviousBundle; updatedAt=(Get-Date).ToUniversalTime().ToString('o') }
  $path = Join-Path $root 'install-state.json';Write-B122ProtectedJson -Path $path -Kind state -Payload $state
  return Get-B122InstallState -InstallRoot $root
}

function Repair-B122InterruptedInstall {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $root = [IO.Path]::GetFullPath($InstallRoot); $versions = Join-Path $root 'versions'
  if (-not (Test-Path -LiteralPath $versions -PathType Container)) { return }
  foreach ($entry in @(Get-ChildItem -LiteralPath $versions -Directory -Force | Where-Object { $_.Name.StartsWith('.staging-',[StringComparison]::Ordinal) })) {
    Assert-B122ChildPath -Parent $versions -Child $entry.FullName | Out-Null
    if(($entry.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'Interrupted B122 staging is a reparse/junction; refusing recursive cleanup.'}
    # A staging directory is created only beneath an authenticated owned root.
    Remove-Item -LiteralPath $entry.FullName -Recurse -Force
  }
}

function Import-B122ValidatedBundle {
  param([Parameter(Mandatory=$true)][string]$BundleRoot,[Parameter(Mandatory=$true)][string]$InstallRoot)
  $source = [IO.Path]::GetFullPath($BundleRoot); $root = [IO.Path]::GetFullPath($InstallRoot)
  if(-not(Test-Path -LiteralPath (Join-Path $root $script:B122OwnershipName) -PathType Leaf)){Initialize-B122OwnedInstallRoot -InstallRoot $root -ProtectedPaths @($source)|Out-Null}else{Get-B122InstallOwnership -InstallRoot $root|Out-Null}
  $identity=Get-B122BundleIdentity -BundleRoot $source;$versionId=[string]$identity.sourceCommit
  $versions = Join-Path $root 'versions'; New-Item -ItemType Directory -Force -Path $versions | Out-Null
  Repair-B122InterruptedInstall -InstallRoot $root
  $destination = Join-Path $versions $versionId; Assert-B122ChildPath -Parent $versions -Child $destination | Out-Null
  $existingRecord=Get-B122InstalledVersionRecord -InstallRoot $root -SourceCommit $versionId
  if(Test-Path -LiteralPath $destination -PathType Container){
    if($null -eq $existingRecord -or [string]$existingRecord.bundleId -cne [string]$identity.bundleId){throw 'A different B122 bundle already uses the same source commit.'}
    $existing=Get-B122TreeInventory -Root $destination
    $existingDigest=Get-B122Sha256Bytes -Bytes ([Text.Encoding]::UTF8.GetBytes((@($existing|ForEach-Object{"$($_.path)`0$($_.sha256)`0$($_.size)"}) -join "`n")))
    if($existingDigest -cne [string]$identity.bundleId){throw 'The installed B122 version changed after import.'}
    return $destination
  }
  if($null -ne $existingRecord){throw 'The B122 root manifest references a missing version; refusing replacement.'}
  $staging = Join-Path $versions ('.staging-' + $versionId + '-' + [guid]::NewGuid().ToString('N')); Assert-B122ChildPath -Parent $versions -Child $staging | Out-Null
  try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    Copy-B122ConcreteTree -Source $source -Destination $staging
    $stagedIdentity=Get-B122BundleIdentity -BundleRoot $staging
    if ([string]$stagedIdentity.sourceCommit -cne $versionId -or [string]$stagedIdentity.bundleId -cne [string]$identity.bundleId) { throw 'The staged B122 release identity changed during copy.' }
    Move-Item -LiteralPath $staging -Destination $destination
  } finally { if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force } }
  $manifest=Get-B122RootManifest -InstallRoot $root
  $manifest.versions=@($manifest.versions)+,[pscustomobject][ordered]@{sourceCommit=$versionId;bundleId=[string]$identity.bundleId;relativePath=('versions/'+$versionId);files=@($identity.files)}
  Write-B122RootManifest -InstallRoot $root -Manifest $manifest
  return $destination
}

function Set-B122CurrentVersion {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$VersionId)
  $next = Test-B122VersionId $VersionId; $existing = Get-B122InstallState -InstallRoot $InstallRoot
  $previous = if ($null -eq $existing -or $existing.current -ceq $next) { if ($null -eq $existing) { $null } else { $existing.previous } } else { [string]$existing.current }
  $previousBundle=if($null -eq $existing -or $existing.current -ceq $next){if($null -eq $existing){$null}else{$existing.previousBundleId}}else{$existing.currentBundleId}
  return Write-B122InstallStateAtomic -InstallRoot $InstallRoot -Current $next -Previous $previous -PreviousBundleId $previousBundle
}

function Restore-B122PreviousVersion {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $state = Get-B122InstallState -InstallRoot $InstallRoot
  if ($null -eq $state -or [string]::IsNullOrWhiteSpace([string]$state.previous)) { throw 'No previous B122 version is available for rollback.' }
  return Write-B122InstallStateAtomic -InstallRoot $InstallRoot -Current ([string]$state.previous) -Previous ([string]$state.current) -CurrentBundleId ([string]$state.previousBundleId) -PreviousBundleId ([string]$state.currentBundleId)
}

function Restore-B122InstallStateSnapshot {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[AllowNull()]$Snapshot)
  $root = [IO.Path]::GetFullPath($InstallRoot)
  $path = Join-Path $root 'install-state.json'
  if ($null -eq $Snapshot) {
    if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
    return $null
  }
  return Write-B122InstallStateAtomic -InstallRoot $root -Current ([string]$Snapshot.current) -Previous $(if($null -eq $Snapshot.previous){$null}else{[string]$Snapshot.previous}) -CurrentBundleId ([string]$Snapshot.currentBundleId) -PreviousBundleId $(if($null -eq $Snapshot.previousBundleId){$null}else{[string]$Snapshot.previousBundleId})
}

function Get-B122FileSnapshot {
  param([Parameter(Mandatory=$true)][string]$Path)
  $full = [IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
    return [pscustomobject]@{ exists=$false; bytes=$null }
  }
  return [pscustomobject]@{ exists=$true; bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($full)) }
}

function Copy-B122FileAtomic {
  param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
  $sourceFull = [IO.Path]::GetFullPath($Source); $destinationFull = [IO.Path]::GetFullPath($Destination)
  if (-not (Test-Path -LiteralPath $sourceFull -PathType Leaf)) { throw "The B122 source file is missing: $sourceFull" }
  $parent = Split-Path -Parent $destinationFull; New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Write-B122BytesAtomic -Path $destinationFull -Bytes ([IO.File]::ReadAllBytes($sourceFull))
}

function Restore-B122FileSnapshot {
  param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)]$Snapshot)
  $full = [IO.Path]::GetFullPath($Path)
  if (-not [bool]$Snapshot.exists) {
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Force }
    return
  }
  $parent = Split-Path -Parent $full; New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Write-B122BytesAtomic -Path $full -Bytes ([Convert]::FromBase64String([string]$Snapshot.bytes))
}

function Invoke-B122AtomicActivation {
  param(
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [Parameter(Mandatory=$true)][string]$VersionId,
    [AllowNull()]$PriorState,
    [Parameter(Mandatory=$true)][scriptblock]$InstallExtension,
    [Parameter(Mandatory=$true)][scriptblock]$WaitForHealth,
    [Parameter(Mandatory=$true)][scriptblock]$ConfigureAutostart,
    [Parameter(Mandatory=$true)][scriptblock]$RestoreExtension,
    [Parameter(Mandatory=$true)][scriptblock]$RestoreAutostart,
    [scriptblock]$RestoreRootTools = {},
    [Parameter(Mandatory=$true)][scriptblock]$RecoverPrior,
    [scriptblock]$StopCandidate = { $true },
    [ValidateSet('install','update','rollback')][string]$OperationKind='update',
    $ExistingOperation
  )
  $versionRecord=Get-B122InstalledVersionRecord -InstallRoot $InstallRoot -SourceCommit $VersionId
  if($null -eq $versionRecord){throw 'The activation candidate is absent from the authenticated root manifest.'}
  $operation=if($null -eq $ExistingOperation){Start-B122LifecycleOperation -InstallRoot $InstallRoot -Kind $OperationKind -SourceCommit $VersionId -BundleId ([string]$versionRecord.bundleId) -PriorState $PriorState}else{$ExistingOperation}
  if($operation.sourceCommit -cne $VersionId -or $operation.bundleId -cne $versionRecord.bundleId -or $operation.kind -cne $OperationKind){throw 'The existing B122 lifecycle operation does not match the activation candidate.'}
  $effects=$operation.effects
  $extensionAttempted = $false; $autostartAttempted = $false; $primary = $null; $rollbackErrors = New-Object Collections.Generic.List[string]
  try {
    Set-B122LifecyclePhase -InstallRoot $InstallRoot -OperationId $operation.operationId -Phase candidate_imported -Effects $effects|Out-Null
    Set-B122CurrentVersion -InstallRoot $InstallRoot -VersionId $VersionId | Out-Null
    $extensionAttempted = $true; & $InstallExtension
    Set-B122LifecyclePhase -InstallRoot $InstallRoot -OperationId $operation.operationId -Phase extension_installed -Effects $effects|Out-Null
    Set-B122LifecyclePhase -InstallRoot $InstallRoot -OperationId $operation.operationId -Phase candidate_started -Effects $effects|Out-Null
    & $WaitForHealth
    Set-B122LifecyclePhase -InstallRoot $InstallRoot -OperationId $operation.operationId -Phase candidate_healthy -Effects $effects|Out-Null
    $autostartAttempted = $true; & $ConfigureAutostart
    Set-B122LifecyclePhase -InstallRoot $InstallRoot -OperationId $operation.operationId -Phase autostart_configured -Effects $effects|Out-Null
    Set-B122LifecyclePhase -InstallRoot $InstallRoot -OperationId $operation.operationId -Phase activated -Effects $effects|Out-Null
    $result=Get-B122InstallState -InstallRoot $InstallRoot;Complete-B122LifecycleOperation -InstallRoot $InstallRoot -OperationId $operation.operationId
    return $result
  } catch {
    $primary = $_
    try{Set-B122LifecyclePhase -InstallRoot $InstallRoot -OperationId $operation.operationId -Phase stop_candidate -Effects $effects|Out-Null}catch{$rollbackErrors.Add("lifecycle stop phase: $($_.Exception.Message)")}
    try{if((& $StopCandidate) -ne $true){throw 'candidate stop did not prove absence'}}catch{$rollbackErrors.Add("candidate shutdown: $($_.Exception.Message)")}
    try{Set-B122LifecyclePhase -InstallRoot $InstallRoot -OperationId $operation.operationId -Phase restoring_prior -Effects $effects|Out-Null}catch{$rollbackErrors.Add("lifecycle restore phase: $($_.Exception.Message)")}
    try { Restore-B122InstallStateSnapshot -InstallRoot $InstallRoot -Snapshot $PriorState | Out-Null } catch { $rollbackErrors.Add("install pointer: $($_.Exception.Message)") }
    $rootToolsRestored = $true
    try { & $RestoreRootTools } catch { $rootToolsRestored = $false; $rollbackErrors.Add("root launcher tooling: $($_.Exception.Message)") }
    if ($extensionAttempted) { try { & $RestoreExtension } catch { $rollbackErrors.Add("VS Code extension: $($_.Exception.Message)") } }
    if ($autostartAttempted) { try { & $RestoreAutostart } catch { $rollbackErrors.Add("autostart: $($_.Exception.Message)") } }
    if ($null -ne $PriorState) {
      if ($rootToolsRestored) { try { & $RecoverPrior } catch { $rollbackErrors.Add("prior companion: $($_.Exception.Message)") } }
      else { $rollbackErrors.Add('prior companion: recovery skipped because root launcher tooling could not be restored') }
    }
    if($rollbackErrors.Count -eq 0){try{Complete-B122LifecycleOperation -InstallRoot $InstallRoot -OperationId $operation.operationId}catch{$rollbackErrors.Add("lifecycle completion: $($_.Exception.Message)")}}
    else{try{Set-B122LifecyclePhase -InstallRoot $InstallRoot -OperationId $operation.operationId -Phase recovery_required -Effects ([ordered]@{rollbackErrors=@($rollbackErrors)})|Out-Null}catch{}}
    $suffix = if($rollbackErrors.Count){' Rollback errors: '+($rollbackErrors -join '; ')}else{''}
    throw "B122 activation failed: $($primary.Exception.Message).$suffix"
  }
}

function Remove-B122UnreferencedVersion {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$VersionId)
  $root = [IO.Path]::GetFullPath($InstallRoot); $id = Test-B122VersionId $VersionId; $state = Get-B122InstallState -InstallRoot $root
  if ($null -ne $state -and ($state.current -ceq $id -or $state.previous -ceq $id)) { throw 'Refusing to remove a referenced B122 version.' }
  $versions = Join-Path $root 'versions'; $path = Join-Path $versions $id; Assert-B122ChildPath -Parent $versions -Child $path | Out-Null
  $manifest=Get-B122RootManifest -InstallRoot $root;$record=Get-B122InstalledVersionRecord -InstallRoot $root -SourceCommit $id
  if($null -eq $record){throw 'Refusing to remove an unmanifested B122 version.'}
  $retained=@(Remove-B122ManifestedFiles -Root $root -Entries @($record.files|ForEach-Object{[pscustomobject]@{path=('versions/'+$id+'/'+$_.path);sha256=$_.sha256;size=$_.size}}))
  if($retained.Count){throw "The unreferenced B122 version contains changed files and was preserved: $($retained -join ', ')"}
  if(Test-Path -LiteralPath $path){Remove-B122EmptyDirectories -Root $root -Start $path}
  $manifest.versions=@($manifest.versions|Where-Object{$_.sourceCommit -cne $id});Write-B122RootManifest -InstallRoot $root -Manifest $manifest
}

function Remove-B122ManifestedFiles {
  param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][AllowEmptyCollection()][object[]]$Entries)
  $rootFull=[IO.Path]::GetFullPath($Root).TrimEnd('\');$retained=New-Object Collections.Generic.List[string]
  $deleted=0
  foreach($entry in @($Entries|Sort-Object {([string]$_.path).Length} -Descending)){
    $relative=([string]$entry.path).Replace('/','\')
    if([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|\\)\.\.(\\|$)'){throw 'The authenticated B122 manifest contains an escaping path.'}
    $path=Join-Path $rootFull $relative;Assert-B122ChildPath -Parent $rootFull -Child $path|Out-Null
    Assert-B122NoReparseAncestors -Path $path
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)){continue}
    $item=Get-Item -LiteralPath $path -Force
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or [long]$item.Length -ne [long]$entry.size -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$entry.sha256){$retained.Add(([string]$entry.path).Replace('\','/'));continue}
    Assert-B122NoReparseAncestors -Path $path
    $final=Get-Item -LiteralPath $path -Force
    if(($final.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or[long]$final.Length-ne[long]$entry.size-or(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()-cne[string]$entry.sha256){$retained.Add(([string]$entry.path).Replace('\','/'));continue}
    Remove-Item -LiteralPath $path -Force
    $deleted++
    if($env:SXSY_B122_TEST_MODE-ceq'1'-and[int]$env:SXSY_B122_TEST_FAIL_AFTER_MANIFEST_DELETE_COUNT-eq$deleted){throw "Injected manifested-file removal interruption after $deleted deletions."}
  }
  return $retained.ToArray()
}

function Remove-B122EmptyDirectories {
  param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$Start)
  $rootFull=[IO.Path]::GetFullPath($Root).TrimEnd('\');$cursor=[IO.Path]::GetFullPath($Start).TrimEnd('\');Assert-B122ChildPath -Parent $rootFull -Child $cursor|Out-Null
  if(Test-Path -LiteralPath $cursor -PathType Container){
    $directories=New-Object Collections.Generic.List[string];$queue=New-Object Collections.Generic.Queue[string];$queue.Enqueue($cursor)
    while($queue.Count){$directory=$queue.Dequeue();$item=Get-Item -LiteralPath $directory -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){continue};$directories.Add($directory);foreach($child in @(Get-ChildItem -LiteralPath $directory -Directory -Force)){if(($child.Attributes-band[IO.FileAttributes]::ReparsePoint)-eq0){$queue.Enqueue($child.FullName)}}}
    foreach($directory in @($directories|Sort-Object Length -Descending)){if($directory.Equals($cursor,[StringComparison]::OrdinalIgnoreCase)){continue};if((Test-Path -LiteralPath $directory -PathType Container)-and@(Get-ChildItem -LiteralPath $directory -Force).Count-eq0){Remove-Item -LiteralPath $directory -Force}}
  }
  while($cursor.StartsWith($rootFull+'\',[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $cursor -PathType Container)){
    $item=Get-Item -LiteralPath $cursor -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){break}
    if(@(Get-ChildItem -LiteralPath $cursor -Force).Count -ne 0){break}
    Remove-Item -LiteralPath $cursor -Force;$cursor=Split-Path -Parent $cursor
  }
}

function Get-B122RemainingUnownedPaths {
  param([Parameter(Mandatory=$true)][string]$Root,[string[]]$ControlNames=@(),[string[]]$OwnedPaths=@())
  $rootFull=[IO.Path]::GetFullPath($Root).TrimEnd('\');Assert-B122NoReparseAncestors -Path $rootFull
  $owned=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase);foreach($path in $OwnedPaths){[void]$owned.Add(([string]$path).Replace('\','/'))}
  $result=New-Object Collections.Generic.List[string];$queue=New-Object Collections.Generic.Queue[string];$queue.Enqueue($rootFull)
  while($queue.Count){
    $directory=$queue.Dequeue()
    Assert-B122NoReparseAncestors -Path $directory
    foreach($entry in @(Get-ChildItem -LiteralPath $directory -Force|Sort-Object Name)){
      $relative=$entry.FullName.Substring($rootFull.Length+1).Replace('\','/')
      $isTop=$directory.Equals($rootFull,[StringComparison]::OrdinalIgnoreCase)
      $reparse=($entry.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0
      if($isTop-and$entry.Name-in$ControlNames-and-not$entry.PSIsContainer-and-not$reparse){continue}
      if($reparse){$result.Add($relative);continue}
      if(-not$entry.PSIsContainer){if(-not$owned.Contains($relative)){$result.Add($relative)};continue}
      $children=@(Get-ChildItem -LiteralPath $entry.FullName -Force)
      $ownedBelow=@($OwnedPaths|Where-Object{([string]$_).Replace('\','/').StartsWith($relative+'/',[StringComparison]::OrdinalIgnoreCase)}).Count-ne0
      if($children.Count-eq0){if(-not$ownedBelow){$result.Add($relative)}}else{$queue.Enqueue($entry.FullName)}
    }
  }
  return @($result|Sort-Object -Unique)
}

function Set-B122RootToolInventory {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][AllowEmptyCollection()][string[]]$RelativePaths)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$manifest=Get-B122RootManifest -InstallRoot $root;$tools=@()
  foreach($relative in $RelativePaths){
    if([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)'){throw 'A root tool path escaped the B122 install root.'}
    $path=Join-Path $root $relative;Assert-B122ChildPath -Parent $root -Child $path|Out-Null;$item=Get-Item -LiteralPath $path -Force
    if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'A B122 root tool is not one concrete file.'}
    $tools += [pscustomobject][ordered]@{path=$relative.Replace('\','/');sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();size=[long]$item.Length}
  }
  $manifest.rootTools=$tools;Write-B122RootManifest -InstallRoot $root -Manifest $manifest
  return ,$tools
}

function Assert-B122RootTools {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$manifest=Get-B122RootManifest -InstallRoot $root
  if(@($manifest.rootTools).Count -lt 2){throw 'The B122 bootstrap tools are not digest-pinned.'}
  foreach($tool in $manifest.rootTools){
    $path=Join-Path $root ([string]$tool.path);Assert-B122ChildPath -Parent $root -Child $path|Out-Null;$item=Get-Item -LiteralPath $path -Force
    if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or [long]$item.Length -ne [long]$tool.size -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$tool.sha256){throw 'A digest-pinned B122 bootstrap tool is missing or changed.'}
  }
  return ,@($manifest.rootTools)
}

function Remove-B122OwnedInstallation {
  [CmdletBinding()]
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[switch]$PreserveRoot,[switch]$PreserveLifecycleMetadata,[scriptblock]$BeforeFirstDelete)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$manifest=Get-B122RootManifest -InstallRoot $root;$rootFileIdentity=Get-B122FileSystemIdentity -Path $root;$retained=New-Object Collections.Generic.List[string]
  $ownedPaths=New-Object Collections.Generic.List[string]
  foreach($version in @($manifest.versions)){
    $entries=@($version.files|ForEach-Object{[pscustomobject]@{path=('versions/'+$version.sourceCommit+'/'+$_.path);sha256=$_.sha256;size=$_.size}})
    foreach($entry in $entries){$ownedPaths.Add([string]$entry.path);$path=Join-Path $root ([string]$entry.path).Replace('/','\');Assert-B122NoReparseAncestors -Path $path;if(Test-Path -LiteralPath $path -PathType Leaf){$item=Get-Item -LiteralPath $path -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or[long]$item.Length-ne[long]$entry.size-or(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()-cne[string]$entry.sha256){$retained.Add([string]$entry.path)}}}
  }
  foreach($entry in @($manifest.rootTools)){$ownedPaths.Add([string]$entry.path);$path=Join-Path $root ([string]$entry.path).Replace('/','\');Assert-B122NoReparseAncestors -Path $path;if(Test-Path -LiteralPath $path -PathType Leaf){$item=Get-Item -LiteralPath $path -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or[long]$item.Length-ne[long]$entry.size-or(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()-cne[string]$entry.sha256){$retained.Add([string]$entry.path)}}}
  $controls=@($script:B122OwnershipName,$script:B122ManifestName,'install-state.json',$script:B122LifecycleName)
  $unknown=@(Get-B122RemainingUnownedPaths -Root $root -ControlNames $controls -OwnedPaths $ownedPaths.ToArray())
  if($unknown.Count-or$retained.Count){return [pscustomobject][ordered]@{complete=$false;unownedPaths=@($unknown|Sort-Object -Unique);retainedChangedPaths=@($retained|Sort-Object -Unique);rootRemoved=$false;rootFileIdentity=$rootFileIdentity}}
  if($null-ne$BeforeFirstDelete){& $BeforeFirstDelete $manifest $rootFileIdentity}
  foreach($version in @($manifest.versions)){$entries=@($version.files|ForEach-Object{[pscustomobject]@{path=('versions/'+$version.sourceCommit+'/'+$_.path);sha256=$_.sha256;size=$_.size}});foreach($path in @(Remove-B122ManifestedFiles -Root $root -Entries $entries|Where-Object{$_})){$retained.Add([string]$path)}}
  foreach($path in @(Remove-B122ManifestedFiles -Root $root -Entries @($manifest.rootTools)|Where-Object{$_})){$retained.Add([string]$path)}
  foreach($version in @($manifest.versions)){Remove-B122EmptyDirectories -Root $root -Start (Join-Path (Join-Path $root 'versions') ([string]$version.sourceCommit))}
  if(Test-Path -LiteralPath (Join-Path $root 'versions')){Remove-B122EmptyDirectories -Root $root -Start (Join-Path $root 'versions')}
  $unknown=@(Get-B122RemainingUnownedPaths -Root $root -ControlNames $controls)
  $rootRemoved=$false
  if(-not$PreserveRoot-and-not$PreserveLifecycleMetadata-and$unknown.Count -eq0 -and $retained.Count-eq0){$final=Complete-B122OwnedRootFinalization -InstallRoot $root -ExpectedRootId ([string]$manifest.rootId) -ExpectedFileIdentity $rootFileIdentity;$rootRemoved=[bool]$final.rootRemoved}
  return [pscustomobject][ordered]@{complete=($unknown.Count-eq0-and$retained.Count-eq0);unownedPaths=@($unknown|Sort-Object -Unique);retainedChangedPaths=@($retained|Sort-Object -Unique);rootRemoved=$rootRemoved;rootFileIdentity=$rootFileIdentity}
}

function Complete-B122OwnedRootFinalization {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$ExpectedRootId,[Parameter(Mandatory=$true)][string]$ExpectedFileIdentity)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$parsed=[guid]::Empty;if(-not[guid]::TryParse($ExpectedRootId,[ref]$parsed)-or$ExpectedFileIdentity-cnotmatch'^[a-f0-9]{8}:[a-f0-9]{16}$'){throw 'The uninstall root-finalization identity is invalid.'}
  if(-not(Test-Path -LiteralPath $root)){return [pscustomobject]@{rootRemoved=$true}}
  Assert-B122NoReparseAncestors -Path $root;$item=Get-Item -LiteralPath $root -Force;if(-not$item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-or(Get-B122FileSystemIdentity -Path $root)-cne$ExpectedFileIdentity){throw 'The uninstall root-finalization target is not the authenticated original directory.'}
  $controls=@($script:B122OwnershipName,$script:B122ManifestName,'install-state.json',$script:B122LifecycleName);$unknown=@(Get-B122RemainingUnownedPaths -Root $root -ControlNames $controls)
  if($unknown.Count){throw "Root finalization preserved unexpected content: $($unknown-join', ')"}
  $ownershipPath=Join-Path $root $script:B122OwnershipName;if(Test-Path -LiteralPath $ownershipPath -PathType Leaf){$ownership=Read-B122ProtectedJson -Path $ownershipPath -Kind ownership;if([string]$ownership.rootId-cne$ExpectedRootId){throw 'Root finalization ownership identity changed.'}}
  $manifestPath=Join-Path $root $script:B122ManifestName;if(Test-Path -LiteralPath $manifestPath -PathType Leaf){$manifest=Read-B122ProtectedJson -Path $manifestPath -Kind manifest;if([string]$manifest.rootId-cne$ExpectedRootId){throw 'Root finalization manifest identity changed.'}}
  $deleted=0
  foreach($control in @('install-state.json',$script:B122ManifestName,$script:B122LifecycleName,$script:B122OwnershipName)){
    if((Get-B122FileSystemIdentity -Path $root)-cne$ExpectedFileIdentity){throw 'The uninstall root-finalization directory identity changed.'}
    $path=Join-Path $root $control;if(Test-Path -LiteralPath $path -PathType Leaf){Assert-B122NoReparseAncestors -Path $path;$leaf=Get-Item -LiteralPath $path -Force;if($leaf.PSIsContainer-or($leaf.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'Root finalization encountered unsafe control metadata.'};Remove-Item -LiteralPath $path -Force;$deleted++;if($env:SXSY_B122_TEST_MODE-ceq'1'-and[int]$env:SXSY_B122_TEST_FAIL_AFTER_CONTROL_DELETE_COUNT-eq$deleted){throw "Injected root-control finalization interruption after $deleted deletions."}}
  }
  if((Get-B122FileSystemIdentity -Path $root)-cne$ExpectedFileIdentity){throw 'The uninstall root-finalization directory identity changed.'}
  if(@(Get-ChildItem -LiteralPath $root -Force).Count-eq0){Remove-Item -LiteralPath $root -Force}
  if(Test-Path -LiteralPath $root){throw 'Root finalization could not prove product-root deletion.'}
  return [pscustomobject]@{rootRemoved=$true}
}

function Get-B122LifecycleOperation {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');Get-B122InstallOwnership -InstallRoot $root|Out-Null;$path=Join-Path $root $script:B122LifecycleName
  if(-not(Test-Path -LiteralPath $path -PathType Leaf)){return $null}
  $record=Read-B122ProtectedJson -Path $path -Kind lifecycle
  if($record.schema -cne 'sxsy-b122.lifecycle-operation' -or $record.version -ne 1 -or $record.operationId -notmatch '^[a-f0-9-]{36}$' -or $record.kind -notin @('install','update','rollback','uninstall','purge','start') -or $record.sourceCommit -notmatch '^[0-9a-f]{40}$' -or $record.bundleId -notmatch '^[0-9a-f]{64}$'){throw 'The protected B122 lifecycle journal is invalid.'}
  return $record
}

function Start-B122LifecycleOperation {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][ValidateSet('install','update','rollback','uninstall','purge','start')][string]$Kind,[Parameter(Mandatory=$true)][string]$SourceCommit,[Parameter(Mandatory=$true)][string]$BundleId,[AllowNull()]$PriorState,$InitialEffects=[ordered]@{})
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');Get-B122InstallOwnership -InstallRoot $root|Out-Null
  if($null -ne (Get-B122LifecycleOperation -InstallRoot $root)){throw 'An unfinished B122 lifecycle operation requires recovery.'}
  if($null-eq$InitialEffects){$InitialEffects=[ordered]@{}}
  $record=[ordered]@{schema='sxsy-b122.lifecycle-operation';version=1;operationId=[guid]::NewGuid().ToString('D');kind=$Kind;sourceCommit=(Test-B122VersionId $SourceCommit);bundleId=$BundleId.ToLowerInvariant();phase='started';priorState=$PriorState;effects=$InitialEffects;startedAt=(Get-Date).ToUniversalTime().ToString('o');updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  if($record.bundleId -notmatch '^[0-9a-f]{64}$'){throw 'A B122 lifecycle bundle identity must be one SHA-256 digest.'}
  Write-B122ProtectedJson -Path (Join-Path $root $script:B122LifecycleName) -Kind lifecycle -Payload $record;return Get-B122LifecycleOperation -InstallRoot $root
}

function Set-B122LifecyclePhase {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$OperationId,[Parameter(Mandatory=$true)][ValidateSet('recovery_prepared','candidate_imported','root_module_installed','root_launcher_installed','root_tools_installed','candidate_started','candidate_healthy','extension_installed','autostart_configured','activated','stop_candidate','restoring_prior','recovery_required','uninstalling','shutdown_proven','extension_removed','owned_payload_removed','completed')][string]$Phase,$Effects)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$record=Get-B122LifecycleOperation -InstallRoot $root
  if($null -eq $record -or $record.operationId -cne $OperationId){throw 'The B122 lifecycle operation identity changed.'}
  $payload=[ordered]@{schema=$record.schema;version=$record.version;operationId=$record.operationId;kind=$record.kind;sourceCommit=$record.sourceCommit;bundleId=$record.bundleId;phase=$Phase;priorState=$record.priorState;effects=if($null -eq $Effects){$record.effects}else{$Effects};startedAt=$record.startedAt;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  Write-B122ProtectedJson -Path (Join-Path $root $script:B122LifecycleName) -Kind lifecycle -Payload $payload
  if($env:SXSY_B122_TEST_MODE-ceq'1'-and$env:SXSY_B122_TEST_PAUSE_AFTER_PHASE-ceq$Phase){
    $ready=[IO.Path]::GetFullPath([string]$env:SXSY_B122_TEST_KILL_READY_PATH);$temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(-not$ready.StartsWith($temporaryRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'The lifecycle kill-injection marker escaped the temporary test root.'}
    Write-B122BytesAtomic -Path $ready -Bytes ([Text.Encoding]::UTF8.GetBytes($Phase))
    $pauseDeadline=[DateTime]::UtcNow.AddSeconds(60);while([DateTime]::UtcNow-lt$pauseDeadline){Start-Sleep -Milliseconds 100}
    throw "Lifecycle kill injection was not terminated after $Phase."
  }
  if($env:SXSY_B122_TEST_FAIL_AFTER_PHASE -ceq $Phase){throw "Injected lifecycle interruption after $Phase."}
  return Get-B122LifecycleOperation -InstallRoot $root
}

function Complete-B122LifecycleOperation {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$OperationId)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$record=Get-B122LifecycleOperation -InstallRoot $root
  if($null -eq $record -or $record.operationId -cne $OperationId){throw 'The B122 lifecycle operation identity changed before completion.'}
  Set-B122LifecyclePhase -InstallRoot $root -OperationId $OperationId -Phase completed -Effects $record.effects|Out-Null
  Remove-Item -LiteralPath (Join-Path $root $script:B122LifecycleName) -Force
}

function Repair-B122Lifecycle {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[scriptblock]$StopCandidate={param($record)$true},[scriptblock]$RestorePrior={param($record)$true})
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$record=Get-B122LifecycleOperation -InstallRoot $root
  if($null -eq $record){return [pscustomobject]@{status='clean';operationId=$null}}
  if($record.phase-ceq'completed'){
    Remove-Item -LiteralPath (Join-Path $root $script:B122LifecycleName) -Force
    return [pscustomobject]@{status='recovered_completed';operationId=$record.operationId}
  }
  Set-B122LifecyclePhase -InstallRoot $root -OperationId $record.operationId -Phase stop_candidate -Effects $record.effects|Out-Null
  $stopped=& $StopCandidate $record;if($stopped -ne $true){Set-B122LifecyclePhase -InstallRoot $root -OperationId $record.operationId -Phase recovery_required -Effects $record.effects|Out-Null;throw 'B122 lifecycle recovery could not prove the candidate stopped.'}
  Set-B122LifecyclePhase -InstallRoot $root -OperationId $record.operationId -Phase restoring_prior -Effects $record.effects|Out-Null
  if($null -eq $record.priorState){$statePath=Join-Path $root 'install-state.json';if(Test-Path -LiteralPath $statePath){Remove-Item -LiteralPath $statePath -Force}}
  else{Restore-B122InstallStateSnapshot -InstallRoot $root -Snapshot $record.priorState|Out-Null}
  $restored=& $RestorePrior $record;if($restored -ne $true){Set-B122LifecyclePhase -InstallRoot $root -OperationId $record.operationId -Phase recovery_required -Effects $record.effects|Out-Null;throw 'B122 lifecycle recovery could not restore the prior state.'}
  Complete-B122LifecycleOperation -InstallRoot $root -OperationId $record.operationId
  return [pscustomobject]@{status='recovered';operationId=$record.operationId}
}

function Get-B122CurrentBundle {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $state = Get-B122InstallState -InstallRoot $InstallRoot
  if ($null -eq $state) { throw 'SXSY-B122 is not installed.' }
  return Join-Path (Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'versions') ([string]$state.current)
}

function Assert-B122InstalledPayloadFile {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$Path)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$full=[IO.Path]::GetFullPath($Path);Assert-B122ChildPath -Parent (Join-Path $root 'versions') -Child $full|Out-Null
  $relative=$full.Substring((Join-Path $root 'versions').TrimEnd('\').Length+1).Replace('\','/');$parts=$relative.Split('/')
  if($parts.Count -lt 2){throw 'Installed payload path has no immutable version identity.'};$version=$parts[0];$inside=($parts[1..($parts.Count-1)] -join '/')
  $record=Get-B122InstalledVersionRecord -InstallRoot $root -SourceCommit $version;if($null -eq $record){throw 'Installed payload version is absent from the root manifest.'}
  $entries=@($record.files|Where-Object{$_.path -ceq $inside});if($entries.Count -ne 1){throw 'Installed payload file is absent from the immutable root manifest.'}
  Assert-B122NoReparseAncestors -Path $full
  $item=Get-Item -LiteralPath $full -Force;if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or [long]$item.Length -ne [long]$entries[0].size -or (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$entries[0].sha256){throw 'Installed payload file changed after import.'}
  Assert-B122NoReparseAncestors -Path $full
  $final=Get-Item -LiteralPath $full -Force;if($final.PSIsContainer-or($final.Attributes-band[IO.FileAttributes]::ReparsePoint)-or[long]$final.Length-ne[long]$entries[0].size-or(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()-cne[string]$entries[0].sha256){throw 'Installed payload file changed during final verification.'}
  return $full
}

function Get-B122ExactProcess {
  param([Parameter(Mandatory=$true)][int]$ProcessId)
  return @(Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue)|Select-Object -First 1
}

function ConvertTo-B122WindowsArgument {
  param([AllowEmptyString()][Parameter(Mandatory=$true)][string]$Value)
  if($Value.IndexOf([char]0)-ge0-or$Value-match'[\r\n]'){throw 'A bounded native-process argument is invalid.'}
  if($Value.Length-ne0-and$Value-notmatch'[\s"]'){return $Value}
  $builder=New-Object Text.StringBuilder;[void]$builder.Append('"');$slashes=0
  foreach($character in $Value.ToCharArray()){
    if($character-eq'\'){$slashes++;continue}
    if($character-eq'"'){[void]$builder.Append(('\' * ($slashes*2+1)));[void]$builder.Append('"');$slashes=0;continue}
    if($slashes){[void]$builder.Append(('\' * $slashes));$slashes=0};[void]$builder.Append($character)
  }
  if($slashes){[void]$builder.Append(('\' * ($slashes*2)))};[void]$builder.Append('"');return $builder.ToString()
}

function Invoke-B122BoundedNativeProcess {
  param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(Mandatory=$true)][AllowEmptyCollection()][string[]]$Arguments,
    [Parameter(Mandatory=$true)][string]$StateRoot,
    [ValidateRange(1,300)][int]$TimeoutSeconds=30,
    [ValidateRange(1024,16777216)][int]$MaxOutputBytes=1048576
  )
  $file=[IO.Path]::GetFullPath($FilePath);Assert-B122NoReparseAncestors -Path $file
  $item=Get-Item -LiteralPath $file -Force;if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'The bounded native-process executable is not one concrete file.'}
  if([IO.Path]::GetExtension($file).Equals('.cmd',[StringComparison]::OrdinalIgnoreCase)-and@($Arguments|Where-Object{[string]$_-match'[&|<>^%!()]'}).Count){throw 'A VS Code command-script argument contains a forbidden command-shell metacharacter.'}
  $state=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\');Get-B122StateOwnership -StateRoot $state|Out-Null;$stateIdentity=Get-B122FileSystemIdentity -Path $state
  $supervisorTemporary=Join-Path $state 'supervisor-temp';$temporaryBase=Join-Path $supervisorTemporary 'native-operations'
  foreach($directory in @($supervisorTemporary,$temporaryBase)){if(-not(Test-Path -LiteralPath $directory)){New-Item -ItemType Directory -Path $directory|Out-Null};Assert-B122NoReparseAncestors -Path $directory;$directoryItem=Get-Item -LiteralPath $directory -Force;if(-not$directoryItem.PSIsContainer-or($directoryItem.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'The bounded native-process temporary root is unsafe.'}}
  $temporary=Join-Path $temporaryBase ([guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $temporary|Out-Null;Assert-B122NoReparseAncestors -Path $temporary;$temporaryIdentity=Get-B122FileSystemIdentity -Path $temporary
  $stdoutPath=Join-Path $temporary 'stdout.txt';$stderrPath=Join-Path $temporary 'stderr.txt';$job=$null;$captured=@{}
  try{
    $argumentLine=@($Arguments|ForEach-Object{ConvertTo-B122WindowsArgument -Value ([string]$_)})-join' '
    $commandLine=(ConvertTo-B122WindowsArgument -Value $file)+$(if($argumentLine){' '+$argumentLine}else{''})
    $job=[SxsyB122V2.BoundedJobProcess]::Start($file,$commandLine,(Split-Path -Parent $file),$stdoutPath,$stderrPath)
    try{$captured[[int]$job.ProcessId]=[SxsyB122V2.NativeCommandLine]::GetCreationFileTimeUtc([int]$job.ProcessId)}catch{throw 'The bounded native process has no stable creation identity.'}
    $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$failure=$null
    do{
      $bytes=0;foreach($path in @($stdoutPath,$stderrPath)){if(Test-Path -LiteralPath $path -PathType Leaf){$bytes+=(Get-Item -LiteralPath $path -Force).Length}}
      if($bytes-gt$MaxOutputBytes){$failure="exceeded the $MaxOutputBytes-byte output bound";break}
      if($job.Wait(0)){break}
      Start-Sleep -Milliseconds 50
    }while([DateTime]::UtcNow-lt$deadline)
    $rootExited=$job.Wait(0);if(-not$rootExited-and$null-eq$failure){$failure="exceeded the $TimeoutSeconds-second time bound"}
    foreach($pidValue in @($job.JobProcessIds())){try{$captured[[int]$pidValue]=[SxsyB122V2.NativeCommandLine]::GetCreationFileTimeUtc([int]$pidValue)}catch{}}
    $exitCode=if($rootExited){[int]$job.ExitCode}else{-1};$job.CloseJob();if(-not$job.Wait(10000)){throw 'Bounded native-process job cleanup did not terminate its root process.'};[void]$captured.Remove([int]$job.ProcessId)
    $exitDeadline=[DateTime]::UtcNow.AddSeconds(10);$survivors=@()
    do{$survivors=@();foreach($pidValue in @($captured.Keys)){try{if([SxsyB122V2.NativeCommandLine]::GetCreationFileTimeUtc([int]$pidValue)-ceq[string]$captured[$pidValue]){$survivors+=[int]$pidValue}}catch{}};if(-not$survivors.Count){break};Start-Sleep -Milliseconds 50}while([DateTime]::UtcNow-lt$exitDeadline)
    if($survivors.Count){throw "Bounded native-process job cleanup could not prove process-tree absence: $((@($survivors)|Sort-Object -Unique)-join ',')."}
    $stdout=[string]$(if(Test-Path -LiteralPath $stdoutPath){Get-Content -LiteralPath $stdoutPath -Raw}else{''});$stderr=[string]$(if(Test-Path -LiteralPath $stderrPath){Get-Content -LiteralPath $stderrPath -Raw}else{''})
    if($null-eq$stdout){$stdout=''};if($null-eq$stderr){$stderr=''}
    if([Text.Encoding]::UTF8.GetByteCount([string]$stdout)+[Text.Encoding]::UTF8.GetByteCount([string]$stderr)-gt$MaxOutputBytes){throw 'The bounded native process exceeded its output bound.'}
    if($null-ne$failure){throw "The bounded native process $failure."}
    return [pscustomobject][ordered]@{exitCode=$exitCode;stdout=$stdout;stderr=$stderr;processId=[int]$job.ProcessId;survivors=@()}
  }finally{
    if($null-ne$job){$job.Dispose()}
    if(Test-Path -LiteralPath $temporary){
      if((Get-B122FileSystemIdentity -Path $state)-cne$stateIdentity-or(Get-B122FileSystemIdentity -Path $temporary)-cne$temporaryIdentity){throw 'The bounded native-process temporary generation changed before cleanup.'}
      foreach($path in @($stdoutPath,$stderrPath)){if(Test-Path -LiteralPath $path -PathType Leaf){Assert-B122NoReparseAncestors -Path $path;$leaf=Get-Item -LiteralPath $path -Force;if($leaf.PSIsContainer-or($leaf.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'Bounded native-process cleanup encountered an unsafe output leaf.'};Remove-Item -LiteralPath $path -Force}}
      if(@(Get-ChildItem -LiteralPath $temporary -Force).Count){throw 'Bounded native-process cleanup preserved unexpected temporary content.'};Remove-Item -LiteralPath $temporary -Force
    }
  }
}

function Resolve-B122VsCodeCli {
  $candidates=New-Object 'System.Collections.Generic.List[string]'
  $testInstallation=[string]$env:SXSY_B122_TEST_VSCODE_INSTALLATION
  if(-not[string]::IsNullOrWhiteSpace($testInstallation)){
    if($env:SXSY_B122_TEST_MODE-cne'1'){throw 'A test VS Code installation override is forbidden outside the isolated test mode.'}
    $testRoot=[string]$env:SXSY_TEST_ROOT;if([string]::IsNullOrWhiteSpace($testRoot)){throw 'The isolated VS Code installation override requires SXSY_TEST_ROOT.'}
    $testRoot=[IO.Path]::GetFullPath($testRoot).TrimEnd('\');$testInstallation=[IO.Path]::GetFullPath($testInstallation).TrimEnd('\')
    Assert-B122ChildPath -Parent $testRoot -Child $testInstallation|Out-Null;$candidates.Add($testInstallation)
  }else{
    foreach($folder in @([Environment+SpecialFolder]::LocalApplicationData,[Environment+SpecialFolder]::ProgramFiles,[Environment+SpecialFolder]::ProgramFilesX86)){
      $known=[Environment]::GetFolderPath($folder);if([string]::IsNullOrWhiteSpace($known)-or-not[IO.Path]::IsPathRooted($known)){continue}
      $candidate=if($folder-eq[Environment+SpecialFolder]::LocalApplicationData){Join-Path $known 'Programs\Microsoft VS Code'}else{Join-Path $known 'Microsoft VS Code'}
      if(-not($candidates.Contains($candidate))){$candidates.Add($candidate)}
    }
  }
  foreach($candidateValue in @($candidates)){
    $installation=[IO.Path]::GetFullPath([string]$candidateValue).TrimEnd('\')
    if(-not(Test-Path -LiteralPath $installation -PathType Container)){continue}
    Assert-B122NoReparseAncestors -Path $installation;$installationItem=Get-Item -LiteralPath $installation -Force
    if(-not$installationItem.PSIsContainer-or($installationItem.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'The reviewed VS Code installation root is unsafe.'}
    $executable=Join-Path $installation 'Code.exe';$cli=Join-Path $installation 'resources\app\out\cli.js'
    if(-not(Test-Path -LiteralPath $executable -PathType Leaf)-or-not(Test-Path -LiteralPath $cli -PathType Leaf)){continue}
    foreach($path in @($executable,$cli)){Assert-B122NoReparseAncestors -Path $path;$item=Get-Item -LiteralPath $path -Force;if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'A reviewed VS Code CLI component is unsafe.'}}
    $testOverride=$env:SXSY_B122_TEST_MODE-ceq'1'-and-not[string]::IsNullOrWhiteSpace($testInstallation)
    $signerSubject=$null
    if(-not$testOverride){
      $signature=Get-AuthenticodeSignature -LiteralPath $executable
      if($signature.Status-ne[Management.Automation.SignatureStatus]::Valid-or$null-eq$signature.SignerCertificate-or[string]$signature.SignerCertificate.Subject-cnotmatch'(?i)(^|,\s*)O=Microsoft Corporation(,|$)'){throw 'The fixed VS Code CLI host is not validly signed by Microsoft Corporation.'}
      $signerSubject=[string]$signature.SignerCertificate.Subject
    }else{$signerSubject='isolated-test-override'}
    return [pscustomobject][ordered]@{
      installationRoot=$installation
      installationIdentity=Get-B122FileSystemIdentity -Path $installation
      executable=$executable
      executableIdentity=Get-B122FileSystemIdentity -Path $executable
      executableSha256=(Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
      cliScript=$cli
      cliScriptIdentity=Get-B122FileSystemIdentity -Path $cli
      cliScriptSha256=(Get-FileHash -LiteralPath $cli -Algorithm SHA256).Hash.ToLowerInvariant()
      signerSubject=$signerSubject
      testOverride=[bool]$testOverride
    }
  }
  return $null
}

function Assert-B122VsCodeCliIdentity {
  param([Parameter(Mandatory=$true)]$Cli)
  $expected=@('cliScript','cliScriptIdentity','cliScriptSha256','executable','executableIdentity','executableSha256','installationIdentity','installationRoot','signerSubject','testOverride')|Sort-Object
  if((@($Cli.PSObject.Properties.Name|Sort-Object)-join',')-cne($expected-join',')){throw 'The reviewed VS Code CLI identity has an unexpected schema.'}
  $installation=[IO.Path]::GetFullPath([string]$Cli.installationRoot).TrimEnd('\');$executable=[IO.Path]::GetFullPath([string]$Cli.executable);$script=[IO.Path]::GetFullPath([string]$Cli.cliScript)
  if(-not$executable.Equals((Join-Path $installation 'Code.exe'),[StringComparison]::OrdinalIgnoreCase)-or-not$script.Equals((Join-Path $installation 'resources\app\out\cli.js'),[StringComparison]::OrdinalIgnoreCase)){throw 'The reviewed VS Code CLI identity escaped its fixed installation layout.'}
  foreach($path in @($installation,$executable,$script)){Assert-B122NoReparseAncestors -Path $path;if(-not(Test-Path -LiteralPath $path)){throw 'A reviewed VS Code CLI component disappeared before use.'}}
  if((Get-B122FileSystemIdentity -Path $installation)-cne[string]$Cli.installationIdentity-or(Get-B122FileSystemIdentity -Path $executable)-cne[string]$Cli.executableIdentity-or(Get-B122FileSystemIdentity -Path $script)-cne[string]$Cli.cliScriptIdentity){throw 'The reviewed VS Code CLI filesystem identity changed before use.'}
  if((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()-cne[string]$Cli.executableSha256-or(Get-FileHash -LiteralPath $script -Algorithm SHA256).Hash.ToLowerInvariant()-cne[string]$Cli.cliScriptSha256){throw 'The reviewed VS Code CLI bytes changed before use.'}
  if([bool]$Cli.testOverride){
    if($env:SXSY_B122_TEST_MODE-cne'1'){throw 'The isolated VS Code CLI identity cannot be reused outside test mode.'}
    $testRoot=[IO.Path]::GetFullPath([string]$env:SXSY_TEST_ROOT).TrimEnd('\');Assert-B122ChildPath -Parent $testRoot -Child $installation|Out-Null
  }else{
    $signature=Get-AuthenticodeSignature -LiteralPath $executable
    if($signature.Status-ne[Management.Automation.SignatureStatus]::Valid-or$null-eq$signature.SignerCertificate-or[string]$signature.SignerCertificate.Subject-cne[string]$Cli.signerSubject-or[string]$signature.SignerCertificate.Subject-cnotmatch'(?i)(^|,\s*)O=Microsoft Corporation(,|$)'){throw 'The reviewed VS Code CLI signature changed before use.'}
  }
  return $Cli
}

function Get-B122AuthenticatedCompanionProcessIdentity {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$StateRoot,[Parameter(Mandatory=$true)]$LeaseRecord)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$state=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\');Get-B122StateOwnership -StateRoot $state|Out-Null
  $path=Join-Path $state 'companion-process-identity.json';$item=Get-Item -LiteralPath $path -Force
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -le 1 -or $item.Length -gt 64KB){throw 'The authenticated companion process identity is missing or unsafe.'}
  $envelope=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
  if($envelope.schema -cne 'sxsy-b122.dpapi-companion-process-identity' -or $envelope.version -ne 1 -or $envelope.protector -cne 'windows-dpapi-current-user' -or @($envelope.PSObject.Properties).Count -ne 4){throw 'The companion process identity envelope is invalid.'}
  try{$sealed=[Convert]::FromBase64String([string]$envelope.sealed);$bytes=[Security.Cryptography.ProtectedData]::Unprotect($sealed,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);$identity=[Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json}catch{throw 'The companion process identity could not be authenticated for this Windows user.'}
  if($identity.schema -cne 'sxsy-b122.companion-process-identity' -or $identity.version -ne 1 -or @($identity.PSObject.Properties).Count -ne 13 -or [int]$identity.pid -ne [int]$LeaseRecord.pid -or [string]$identity.nonce -cne ([string]$LeaseRecord.nonce).ToLowerInvariant() -or [string]$identity.creationFileTimeUtc -notmatch '^[1-9][0-9]{10,19}$' -or $identity.executableSha256 -notmatch '^[a-f0-9]{64}$' -or $identity.mainSha256 -notmatch '^[a-f0-9]{64}$' -or @($identity.arguments).Count -notin @(1,3)){throw 'The authenticated companion process identity payload is invalid.'}
  if(-not([IO.Path]::GetFullPath([string]$identity.stateDirectory).Equals($state,[StringComparison]::OrdinalIgnoreCase)) -or -not([IO.Path]::GetFullPath([string]$identity.executablePath).Equals([IO.Path]::GetFullPath([string]$LeaseRecord.processPath),[StringComparison]::OrdinalIgnoreCase)) -or -not([IO.Path]::GetFullPath([string]$identity.mainPath).Equals([IO.Path]::GetFullPath([string]$LeaseRecord.mainPath),[StringComparison]::OrdinalIgnoreCase))){throw 'The authenticated companion process identity does not bind the active lease.'}
  if(-not([IO.Path]::GetFullPath([string]$identity.arguments[0]).Equals([IO.Path]::GetFullPath([string]$identity.mainPath),[StringComparison]::OrdinalIgnoreCase)) -or (@($identity.arguments).Count -eq 3 -and ([string]$identity.arguments[1] -cne '--isolated-test-state-directory' -or -not([IO.Path]::GetFullPath([string]$identity.arguments[2]).Equals($state,[StringComparison]::OrdinalIgnoreCase))))){throw 'The authenticated companion arguments are outside the packaged entry-point contract.'}
  Assert-B122ChildPath -Parent (Join-Path $root 'versions') -Child ([string]$identity.executablePath)|Out-Null;Assert-B122ChildPath -Parent (Join-Path $root 'versions') -Child ([string]$identity.mainPath)|Out-Null
  return $identity
}

function Get-B122ValidatedCompanionSupervisorControl {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$StateRoot,[Parameter(Mandatory=$true)]$LeaseRecord)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$state=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
  $leaseNames=@($LeaseRecord.PSObject.Properties.Name|Sort-Object);$expectedLease=@('childCreationFileTimeUtc','mainPath','nonce','pid','processPath','schema','startedAt','supervisorCreationFileTimeUtc','supervisorHelperPath','supervisorHelperSha256','supervisorId','supervisorJobName','supervisorRequestPath','supervisorStatePath','version')|Sort-Object
  if(($leaseNames-join',')-cne($expectedLease-join',')-or$LeaseRecord.schema-cne'sxsy-b122.companion-instance'-or$LeaseRecord.version-ne2-or[string]$LeaseRecord.supervisorId-cnotmatch'^companion:[a-f0-9]{64}$'-or[string]$LeaseRecord.supervisorHelperSha256-cnotmatch'^[a-f0-9]{64}$'-or[string]$LeaseRecord.supervisorCreationFileTimeUtc-cnotmatch'^[1-9][0-9]{10,19}$'-or[string]$LeaseRecord.childCreationFileTimeUtc-cnotmatch'^[1-9][0-9]{10,19}$'){throw 'The supervised companion lease has an invalid exact schema.'}
  $requestPath=[IO.Path]::GetFullPath([string]$LeaseRecord.supervisorRequestPath);$statePath=[IO.Path]::GetFullPath([string]$LeaseRecord.supervisorStatePath);$helper=[IO.Path]::GetFullPath([string]$LeaseRecord.supervisorHelperPath)
  if(-not$requestPath.Equals((Join-Path $state 'companion-supervisor.request.json'),[StringComparison]::OrdinalIgnoreCase)-or-not$statePath.Equals((Join-Path $state 'companion-supervisor.state.json'),[StringComparison]::OrdinalIgnoreCase)-or[string]$LeaseRecord.supervisorJobName-cne('Global\SxsyB122Companion-'+([string]$LeaseRecord.supervisorId).Substring(10))){throw 'The supervised companion lease escaped its authenticated state root.'}
  foreach($path in @($requestPath,$statePath)){Assert-B122NoReparseAncestors -Path $path;$item=Get-Item -LiteralPath $path -Force;if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$item.Length-lt2-or$item.Length-gt256KB){throw 'A companion supervisor control file is unsafe.'}}
  Assert-B122InstalledPayloadFile -InstallRoot $root -Path $helper|Out-Null;if((Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant()-cne[string]$LeaseRecord.supervisorHelperSha256){throw 'The companion supervisor helper changed after launch.'}
  $request=Get-Content -LiteralPath $requestPath -Raw|ConvertFrom-Json;$requestNames=@($request.PSObject.Properties.Name|Sort-Object);$expectedRequest=@('arguments','bundleId','bundleRoot','controlToken','environment','helperPath','helperSha256','mainPath','mainSha256','nodePath','nodeSha256','schema','statePath','stateRoot','stderrPath','stdoutPath','supervisorId','version','workingDirectory')|Sort-Object
  if(($requestNames-join',')-cne($expectedRequest-join',')-or$request.schema-cne'sxsy-b122.companion-supervisor-request'-or$request.version-ne1-or$request.supervisorId-cne$LeaseRecord.supervisorId-or[string]$request.controlToken-cnotmatch'^[a-f0-9]{64}$'-or[string]$request.bundleId-cnotmatch'^[a-f0-9]{64}$'-or-not([IO.Path]::GetFullPath([string]$request.helperPath).Equals($helper,[StringComparison]::OrdinalIgnoreCase))-or[string]$request.helperSha256-cne[string]$LeaseRecord.supervisorHelperSha256-or-not([IO.Path]::GetFullPath([string]$request.stateRoot).Equals($state,[StringComparison]::OrdinalIgnoreCase))-or-not([IO.Path]::GetFullPath([string]$request.statePath).Equals($statePath,[StringComparison]::OrdinalIgnoreCase))){throw 'The companion supervisor request is stale or confused.'}
  $supervisorState=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json;$stateNames=@($supervisorState.PSObject.Properties.Name|Sort-Object);$expectedState=@('activeProcesses','authenticationTag','bundleId','bundleRoot','childCreationFileTimeUtc','childPid','controlTokenSha256','exitCode','helperPath','helperSha256','jobName','requestSha256','schema','startedAt','status','supervisorCreationFileTimeUtc','supervisorId','supervisorPid','version')|Sort-Object
  if(($stateNames-join',')-cne($expectedState-join',')-or$supervisorState.schema-cne'sxsy-b122.companion-supervisor-state'-or$supervisorState.version-ne1-or$supervisorState.supervisorId-cne$LeaseRecord.supervisorId-or[int]$supervisorState.childPid-ne[int]$LeaseRecord.pid-or[string]$supervisorState.childCreationFileTimeUtc-cne[string]$LeaseRecord.childCreationFileTimeUtc-or[string]$supervisorState.supervisorCreationFileTimeUtc-cne[string]$LeaseRecord.supervisorCreationFileTimeUtc-or[string]$supervisorState.authenticationTag-cnotmatch'^[a-f0-9]{64}$'){throw 'The companion supervisor state is stale or confused.'}
  return [pscustomobject][ordered]@{requestPath=$requestPath;statePath=$statePath;helperPath=$helper;request=$request;state=$supervisorState}
}

function Test-B122InstalledCompanionCurrent {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$StateRoot)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$state=[IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
  Get-B122InstallOwnership -InstallRoot $root|Out-Null;Get-B122StateOwnership -StateRoot $state|Out-Null;Assert-B122InstallStateRootBinding -InstallRoot $root -StateRoot $state|Out-Null
  $recordPath=Join-Path $state 'companion-instance.json';if(-not(Test-Path -LiteralPath $recordPath -PathType Leaf)){return $false}
  Assert-B122NoReparseAncestors -Path $recordPath;$recordItem=Get-Item -LiteralPath $recordPath -Force;if($recordItem.PSIsContainer-or($recordItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$recordItem.Length-lt2-or$recordItem.Length-gt64KB){throw 'The companion instance record is unsafe.'}
  $record=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
  if($record.schema-cne'sxsy-b122.companion-instance'-or$record.version-ne2-or[int64]$record.pid-lt1){return $false}
  $control=Get-B122ValidatedCompanionSupervisorControl -InstallRoot $root -StateRoot $state -LeaseRecord $record
  $observation=Invoke-B122BoundedNativeProcess -FilePath $control.helperPath -Arguments @('--observe',$control.requestPath,$control.statePath) -StateRoot $state -TimeoutSeconds 10 -MaxOutputBytes 65536
  $observationLines=@(([string]$observation.stdout-split'\r?\n')|Where-Object{-not[string]::IsNullOrWhiteSpace($_)});if($observation.exitCode-ne0-or$observationLines.Count-ne1){return $false};try{$observationReceipt=$observationLines[0]|ConvertFrom-Json}catch{return $false}
  if((@($observationReceipt.PSObject.Properties.Name|Sort-Object)-join',')-cne'activeProcesses,schema,status,supervisorId,version'-or$observationReceipt.schema-cne'sxsy-b122.companion-supervisor-observation'-or$observationReceipt.version-ne1-or$observationReceipt.supervisorId-cne$record.supervisorId-or$observationReceipt.status-cne'active'-or[int]$observationReceipt.activeProcesses-lt1){return $false}
  $process=Get-B122ExactProcess -ProcessId ([int]$record.pid);if($null-eq$process){return $false}
  $identity=Get-B122AuthenticatedCompanionProcessIdentity -InstallRoot $root -StateRoot $state -LeaseRecord $record
  if(-not(Test-B122RecordedProcess -Process $process -Identity $identity)){throw 'The active companion does not have its authenticated recorded Windows process identity.'}
  $bundle=Get-B122CurrentBundle -InstallRoot $root;$expectedNode=Join-Path $bundle 'runtime\node.exe';$expectedMain=Join-Path $bundle 'app\dist\apps\windows-companion\src\main.js'
  Assert-B122InstalledPayloadFile -InstallRoot $root -Path $expectedNode|Out-Null;Assert-B122InstalledPayloadFile -InstallRoot $root -Path $expectedMain|Out-Null
  return [IO.Path]::GetFullPath([string]$identity.executablePath).Equals([IO.Path]::GetFullPath($expectedNode),[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFullPath([string]$identity.mainPath).Equals([IO.Path]::GetFullPath($expectedMain),[StringComparison]::OrdinalIgnoreCase) -and [string]$identity.executableSha256-ceq(Get-FileHash -LiteralPath $expectedNode -Algorithm SHA256).Hash.ToLowerInvariant() -and [string]$identity.mainSha256-ceq(Get-FileHash -LiteralPath $expectedMain -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-B122RecordedProcess {
  param([Parameter(Mandatory=$true)]$Process,[Parameter(Mandatory=$true)]$Identity)
  $script:B122ProcessIdentityFailure='unknown'
  if($null -eq $Process){$script:B122ProcessIdentityFailure='missing';return $false}
  if([int]$Process.ProcessId -ne [int]$Identity.pid){$script:B122ProcessIdentityFailure='pid';return $false}
  if([int]$Process.ParentProcessId -ne [int]$Identity.parentProcessId){$script:B122ProcessIdentityFailure='parent';return $false}
  if([int]$Process.SessionId -ne [int]$Identity.sessionId){$script:B122ProcessIdentityFailure='session';return $false}
  if(-not([IO.Path]::GetFullPath([string]$Process.ExecutablePath).Equals([IO.Path]::GetFullPath([string]$Identity.executablePath),[StringComparison]::OrdinalIgnoreCase))){$script:B122ProcessIdentityFailure='executable';return $false}
  $expectedArguments=[string[]](@([string]$Identity.executablePath)+@($Identity.arguments|ForEach-Object{[string]$_}));try{if(-not[SxsyB122V2.NativeCommandLine]::Matches([string]$Process.CommandLine,$expectedArguments)){$script:B122ProcessIdentityFailure='command';return $false}}catch{$script:B122ProcessIdentityFailure='command_invalid';return $false}
  try{if([SxsyB122V2.NativeCommandLine]::GetCreationFileTimeUtc([int]$Process.ProcessId) -cne [string]$Identity.creationFileTimeUtc){$script:B122ProcessIdentityFailure='creation';return $false}}catch{$script:B122ProcessIdentityFailure='creation_invalid';return $false}
  $script:B122ProcessIdentityFailure=$null
  return $true
}

function Get-B122ProcessTreeSnapshot {
  param([Parameter(Mandatory=$true)][int]$RootProcessId)
  $all=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue);$queue=New-Object Collections.Generic.Queue[int];$queue.Enqueue($RootProcessId);$result=@()
  while($queue.Count){$parent=$queue.Dequeue();foreach($child in @($all|Where-Object{[int]$_.ParentProcessId -eq $parent})){if(@($result|Where-Object{[int]$_.ProcessId -eq [int]$child.ProcessId}).Count){continue};$result+=$child;$queue.Enqueue([int]$child.ProcessId)}}
  return $result
}

function Stop-B122InstalledCompanion {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[string]$StateRoot,[int]$GracefulTimeoutSeconds=15,[int]$ForceTimeoutSeconds=10)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');Get-B122InstallOwnership -InstallRoot $root|Out-Null
  $state=if($StateRoot){[IO.Path]::GetFullPath($StateRoot)}else{Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard'}
  Get-B122StateOwnership -StateRoot $state|Out-Null
  Assert-B122InstallStateRootBinding -InstallRoot $root -StateRoot $state|Out-Null
  $recordPath=Join-Path $state 'companion-instance.json';$requestPath=Join-Path $state 'companion-supervisor.request.json';$supervisorStatePath=Join-Path $state 'companion-supervisor.state.json';$hadLease=Test-Path -LiteralPath $recordPath -PathType Leaf
  if(-not$hadLease){
    $hasRequest=Test-Path -LiteralPath $requestPath -PathType Leaf;$hasState=Test-Path -LiteralPath $supervisorStatePath -PathType Leaf
    if(-not$hasRequest-and-not$hasState){return [pscustomobject][ordered]@{status='absent';graceful=$true;forced=$false;survivors=@()}}
    if($hasState-and-not$hasRequest){throw 'A companion supervisor state exists without its authenticated request.'}
    Assert-B122NoReparseAncestors -Path $requestPath;$requestItem=Get-Item -LiteralPath $requestPath -Force;if($requestItem.PSIsContainer-or($requestItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$requestItem.Length-lt2-or$requestItem.Length-gt256KB){throw 'The companion supervisor request is unsafe.'}
    $request=Get-Content -LiteralPath $requestPath -Raw|ConvertFrom-Json;$helper=[IO.Path]::GetFullPath([string]$request.helperPath);Assert-B122InstalledPayloadFile -InstallRoot $root -Path $helper|Out-Null
    if(-not$hasState){
      $reconcile=Invoke-B122BoundedNativeProcess -FilePath $helper -Arguments @('--reconcile',$requestPath,$supervisorStatePath) -StateRoot $state -TimeoutSeconds 10 -MaxOutputBytes 65536;$lines=@(([string]$reconcile.stdout-split'\r?\n')|Where-Object{-not[string]::IsNullOrWhiteSpace($_)})
      if($reconcile.exitCode-ne1-or$lines.Count-ne1){throw 'A request-only companion supervisor generation could not be reconciled.'};$receipt=$lines[0]|ConvertFrom-Json
      if((@($receipt.PSObject.Properties.Name|Sort-Object)-join',')-cne'activeProcesses,schema,status,supervisorId,version'-or$receipt.schema-cne'sxsy-b122.companion-supervisor-observation'-or$receipt.status-cnotin@('request_only_absent','request_only_contained')-or[int]$receipt.activeProcesses-ne0-or$receipt.supervisorId-cne$request.supervisorId){throw 'A request-only companion supervisor returned an invalid absence receipt.'}
      foreach($path in @((Join-Path $state 'companion-supervisor.starting.json'),($supervisorStatePath+'.lock'),$requestPath)){if(Test-Path -LiteralPath $path -PathType Leaf){Remove-Item -LiteralPath $path -Force}};return [pscustomobject][ordered]@{status='absent';graceful=$true;forced=($receipt.status-ceq'request_only_contained');survivors=@()}
    }
    Assert-B122NoReparseAncestors -Path $supervisorStatePath;$supervisorState=Get-Content -LiteralPath $supervisorStatePath -Raw|ConvertFrom-Json
    $record=[pscustomobject][ordered]@{schema='sxsy-b122.companion-instance';version=2;nonce='00000000-0000-0000-0000-000000000000';pid=[int]$supervisorState.childPid;startedAt=[string]$supervisorState.startedAt;mainPath=[string]$request.mainPath;processPath=[string]$request.nodePath;supervisorId=[string]$request.supervisorId;supervisorRequestPath=$requestPath;supervisorStatePath=$supervisorStatePath;supervisorHelperPath=$helper;supervisorHelperSha256=[string]$request.helperSha256;supervisorJobName=[string]$supervisorState.jobName;supervisorCreationFileTimeUtc=[string]$supervisorState.supervisorCreationFileTimeUtc;childCreationFileTimeUtc=[string]$supervisorState.childCreationFileTimeUtc}
  }else{
    Assert-B122NoReparseAncestors -Path $recordPath;$recordItem=Get-Item -LiteralPath $recordPath -Force;if($recordItem.PSIsContainer-or($recordItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$recordItem.Length-lt2-or$recordItem.Length-gt64KB){throw 'The companion instance record is unsafe.'};$record=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
  }
  if($record.schema-cne'sxsy-b122.companion-instance'-or$record.version-notin@(1,2)-or[int64]$record.pid-lt1-or[string]$record.nonce-cnotmatch'^[a-f0-9-]{36}$'-or[string]$record.mainPath-cnotmatch'\\app\\dist\\apps\\windows-companion\\src\\main\.js$'){throw 'The companion instance record is malformed; refusing process termination.'}
  $process=Get-B122ExactProcess -ProcessId ([int]$record.pid);$identity=$null;$graceful=$false
  if($hadLease-and$null-ne$process){$identity=Get-B122AuthenticatedCompanionProcessIdentity -InstallRoot $root -StateRoot $state -LeaseRecord $record;if(-not(Test-B122RecordedProcess -Process $process -Identity $identity)){throw "The recorded companion PID no longer has the exact authenticated Windows process identity ($script:B122ProcessIdentityFailure); refusing termination."}}
  if($null-ne$identity){
    $main=[IO.Path]::GetFullPath([string]$identity.mainPath);$node=[IO.Path]::GetFullPath([string]$identity.executablePath);$versionId=$main.Substring((Join-Path $root 'versions').TrimEnd('\').Length+1).Split('\')[0];$health=Join-Path (Join-Path (Join-Path $root 'versions') $versionId) 'scripts\Test-B122Health.mjs';$configuration=Join-Path $state 'authenticated-pipe.json'
    if(Test-Path -LiteralPath $configuration -PathType Leaf){try{Assert-B122InstalledPayloadFile -InstallRoot $root -Path $node|Out-Null;Assert-B122InstalledPayloadFile -InstallRoot $root -Path $health|Out-Null;$shutdownProbe=Invoke-B122BoundedNativeProcess -FilePath $node -Arguments @($health,'--shutdown','--configuration',$configuration) -StateRoot $state -TimeoutSeconds $GracefulTimeoutSeconds;if($shutdownProbe.exitCode-eq0){$deadline=[DateTime]::UtcNow.AddSeconds($GracefulTimeoutSeconds);do{Start-Sleep -Milliseconds 100;$process=Get-B122ExactProcess -ProcessId ([int]$record.pid);if($null-eq$process){$graceful=$true;break}}while([DateTime]::UtcNow-lt$deadline)}}catch{$graceful=$false}}
  }
  $forced=$false
  if($record.version-eq2){
    $control=Get-B122ValidatedCompanionSupervisorControl -InstallRoot $root -StateRoot $state -LeaseRecord $record
    $termination=Invoke-B122BoundedNativeProcess -FilePath $control.helperPath -Arguments @('--terminate',$control.requestPath,$control.statePath,'0',[string]($ForceTimeoutSeconds*1000)) -StateRoot $state -TimeoutSeconds ($ForceTimeoutSeconds+10) -MaxOutputBytes 65536;$lines=@(([string]$termination.stdout-split'\r?\n')|Where-Object{-not[string]::IsNullOrWhiteSpace($_)})
    if($termination.exitCode-ne0-or$lines.Count-ne1){throw 'The companion supervisor did not return one exact termination receipt.'};$receipt=$lines[0]|ConvertFrom-Json
    if((@($receipt.PSObject.Properties.Name|Sort-Object)-join',')-cne'activeProcesses,schema,status,supervisorId,version'-or$receipt.schema-cne'sxsy-b122.companion-supervisor-termination'-or$receipt.version-ne1-or$receipt.supervisorId-cne$record.supervisorId-or$receipt.status-cnotin@('terminated','already_absent')-or[int]$receipt.activeProcesses-ne0){throw 'The companion supervisor did not prove exact Job-tree absence.'}
    $forced=-not$graceful-and$receipt.status-ceq'terminated';$deadline=[DateTime]::UtcNow.AddSeconds($ForceTimeoutSeconds)
    do{try{$same=[SxsyB122V2.NativeCommandLine]::GetCreationFileTimeUtc([int]$control.state.supervisorPid)-ceq[string]$control.state.supervisorCreationFileTimeUtc}catch{$same=$false};if(-not$same){break};Start-Sleep -Milliseconds 50}while([DateTime]::UtcNow-lt$deadline)
    if($same){throw 'The exact companion supervisor process survived Job termination.'}
    foreach($path in @($recordPath,(Join-Path $state 'companion-process-identity.json'),(Join-Path $state 'shutdown-recovery.json'),(Join-Path $state 'companion-supervisor.starting.json'),($control.statePath+'.lock'),$control.statePath,$control.requestPath)){if(Test-Path -LiteralPath $path -PathType Leaf){Assert-B122NoReparseAncestors -Path $path;Remove-Item -LiteralPath $path -Force}}
  }else{
    if($null-eq$identity){throw 'A dead legacy unsupervised companion requires reviewed migration recovery; PID absence cannot prove descendant absence.'}
    $process=Get-B122ExactProcess -ProcessId ([int]$record.pid);if($null-ne$process){if(-not(Test-B122RecordedProcess -Process $process -Identity $identity)){throw 'The legacy companion PID identity changed before migration termination.'};$forced=$true;$taskkill=Join-Path ([Environment]::SystemDirectory) 'taskkill.exe';$legacy=Invoke-B122BoundedNativeProcess -FilePath $taskkill -Arguments @('/PID',[string][int]$record.pid,'/T','/F') -StateRoot $state -TimeoutSeconds $ForceTimeoutSeconds -MaxOutputBytes 65536;if($legacy.exitCode-ne0){throw 'Legacy companion migration termination failed.'}}
    $deadline=[DateTime]::UtcNow.AddSeconds($ForceTimeoutSeconds);do{try{$same=[SxsyB122V2.NativeCommandLine]::GetCreationFileTimeUtc([int]$record.pid)-ceq[string]$identity.creationFileTimeUtc}catch{$same=$false};if(-not$same){break};Start-Sleep -Milliseconds 50}while([DateTime]::UtcNow-lt$deadline);if($same){throw 'The legacy companion survived migration termination.'}
    Remove-Item -LiteralPath $recordPath -Force;Remove-Item -LiteralPath (Join-Path $state 'companion-process-identity.json') -Force -ErrorAction SilentlyContinue
  }
  return [pscustomobject][ordered]@{status='stopped';graceful=$graceful;forced=$forced;survivors=@()}
}

function Stop-B122InstalledProviderHost {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[string]$ConfigurationPath)
  $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');Get-B122InstallOwnership -InstallRoot $root|Out-Null
  $installState=Get-B122InstallState -InstallRoot $root
  if($null -eq $installState){return [pscustomobject][ordered]@{schema='sxsy-b122.provider-host-lifecycle';version=1;action='stop';status='absent_uninstalled';configured=$false;processes=@();survivorCount=0}}
  $bundle=Get-B122CurrentBundle -InstallRoot $root
  $lifecycle=Join-Path $bundle 'scripts\Manage-B122ProviderHost.ps1'
  Assert-B122InstalledPayloadFile -InstallRoot $root -Path $lifecycle|Out-Null
  $arguments=@('-Action','Stop','-BundleRoot',$bundle)
  if($ConfigurationPath){
    $configuration=[IO.Path]::GetFullPath($ConfigurationPath)
    if($configuration.IndexOf([char]0)-ge0-or$configuration.Contains('"')){throw 'The provider-host configuration path is invalid.'}
    $arguments+=@('-ConfigurationPath',$configuration)
  }
  $output=@(& $lifecycle @arguments)
  $lines=@($output|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)});if($lines.Count-ne1){throw 'The installed provider-host lifecycle returned an invalid shutdown receipt count.'}
  try{$receipt=$lines[0]|ConvertFrom-Json}catch{throw 'The installed provider-host lifecycle returned a malformed shutdown receipt.'}
  if((@($receipt.PSObject.Properties.Name|Sort-Object)-join',')-cne'action,configured,processes,schema,status,survivorCount,version'-or$receipt.schema-cne'sxsy-b122.provider-host-lifecycle'-or$receipt.version-ne1-or$receipt.action-cne'stop'-or$receipt.status-cne'stopped'-or$receipt.configured-isnot[bool]-or[int]$receipt.survivorCount-ne0){throw 'The installed provider-host lifecycle did not prove exact process-tree absence.'}
  foreach($processReceipt in @($receipt.processes)){
    if((@($processReceipt.PSObject.Properties.Name|Sort-Object)-join',')-cne'forcedFallback,gracefulShutdownAcknowledged,processId,treeCaptured,treeExited,treeSurvivors'-or@($processReceipt.treeSurvivors).Count-ne0-or[int]$processReceipt.treeExited-ne[int]$processReceipt.treeCaptured-or[int64]$processReceipt.processId-lt1-or$processReceipt.gracefulShutdownAcknowledged-isnot[bool]-or$processReceipt.forcedFallback-isnot[bool]){throw 'The installed provider-host lifecycle reported an incomplete process-tree shutdown.'}
  }
  return $receipt
}

function Invoke-B122CompanionHealthProbe {
  param(
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$HealthScript,
    [Parameter(Mandatory=$true)][string]$ConfigurationPath
  )
  $node=[IO.Path]::GetFullPath($NodePath);$health=[IO.Path]::GetFullPath($HealthScript);$configuration=[IO.Path]::GetFullPath($ConfigurationPath)
  foreach($value in @($node,$health,$configuration)){if($value.IndexOf([char]0)-ge0-or$value.Contains('"')-or$value-match'[\r\n]'){throw 'The companion health-probe path is invalid.'}}
  if(-not(Test-Path -LiteralPath $node -PathType Leaf)-or-not(Test-Path -LiteralPath $health -PathType Leaf)){throw 'The companion health-probe executable or script is missing.'}
  $probe=Invoke-B122BoundedNativeProcess -FilePath $node -Arguments @($health,'--configuration',$configuration,'--probe') -StateRoot (Split-Path -Parent $configuration) -TimeoutSeconds 5 -MaxOutputBytes 65536
  $exitCode=[int]$probe.exitCode
  $lines=@(([string]$probe.stdout -split '\r?\n')|Where-Object{-not[string]::IsNullOrWhiteSpace($_)})
  if($lines.Count-ne1){throw 'The authenticated companion health probe failed closed: its receipt count was invalid.'}
  try{$receipt=$lines[0]|ConvertFrom-Json}catch{throw 'The authenticated companion health probe failed closed: its receipt was malformed.'}
  $propertyNames=@($receipt.PSObject.Properties.Name|Sort-Object)
  if(($propertyNames-join ',')-cne'reason,retryable,schema,status,version'-or$receipt.schema-cne'sxsy-b122.install-health-probe'-or$receipt.version-ne1){throw 'The authenticated companion health probe failed closed: its receipt schema was invalid.'}
  if($exitCode-eq0-and$receipt.status-ceq'ready'-and$receipt.retryable-eq$false-and$receipt.reason-ceq'authenticated_ready'){return $receipt}
  if($exitCode-eq2-and$receipt.status-ceq'unavailable'-and$receipt.retryable-eq$true-and$receipt.reason-ceq'endpoint_unavailable'){return $receipt}
  throw 'The authenticated companion health probe failed closed: integrity or authentication was not established.'
}

function Wait-B122CompanionHealth {
  param(
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$HealthScript,
    [Parameter(Mandatory=$true)][string]$ConfigurationPath,
    [Diagnostics.Process]$Process,
    [ValidateRange(1,300)][int]$TimeoutSeconds=30,
    [ValidateRange(10,5000)][int]$PollMilliseconds=250
  )
  $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do{
    if($null-ne$Process-and$Process.HasExited){throw 'The installed companion exited before health verification.'}
    $receipt=Invoke-B122CompanionHealthProbe -NodePath $NodePath -HealthScript $HealthScript -ConfigurationPath $ConfigurationPath
    if($receipt.status-ceq'ready'){return $receipt}
    if([DateTime]::UtcNow-ge$deadline){break}
    Start-Sleep -Milliseconds $PollMilliseconds
  }while([DateTime]::UtcNow-lt$deadline)
  throw "The installed companion did not become healthy within $TimeoutSeconds seconds."
}

Export-ModuleMember -Function Assert-B122ChildPath,Test-B122VersionId,Enter-B122LifecycleLock,Exit-B122LifecycleLock,Get-B122AutostartRegistryPath,Get-B122FileSystemIdentity,Initialize-B122OwnedInstallRoot,Get-B122InstallOwnership,Initialize-B122OwnedStateRoot,Get-B122StateOwnership,Bind-B122InstallStateRoot,Release-B122InstallStateRootBinding,Assert-B122InstallStateRootBinding,Write-B122OperationReceipt,Read-B122OperationReceipt,Write-B122CompanionSupervisorRequest,Write-B122ExternalRecoveryRecord,Read-B122ExternalRecoveryRecord,New-B122UninstallRecoveryCapsule,Assert-B122UninstallRecoveryCapsule,Get-B122RootManifest,Get-B122BundleIdentity,Get-B122InstalledVersionRecord,Get-B122InstallState,Write-B122InstallStateAtomic,Repair-B122InterruptedInstall,Import-B122ValidatedBundle,Set-B122CurrentVersion,Restore-B122PreviousVersion,Restore-B122InstallStateSnapshot,Get-B122FileSnapshot,Copy-B122FileAtomic,Restore-B122FileSnapshot,Invoke-B122AtomicActivation,Remove-B122UnreferencedVersion,Remove-B122OwnedInstallation,Complete-B122OwnedRootFinalization,Set-B122RootToolInventory,Assert-B122RootTools,Get-B122LifecycleOperation,Start-B122LifecycleOperation,Set-B122LifecyclePhase,Complete-B122LifecycleOperation,Repair-B122Lifecycle,Get-B122CurrentBundle,Assert-B122InstalledPayloadFile,Test-B122InstalledCompanionCurrent,Stop-B122InstalledCompanion,Stop-B122InstalledProviderHost,Resolve-B122VsCodeCli,Assert-B122VsCodeCliIdentity,Invoke-B122BoundedNativeProcess,Invoke-B122CompanionHealthProbe,Wait-B122CompanionHealth
