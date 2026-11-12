using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerFiles
{
    private const uint ReadControl=0x20000, GenericRead=0x80000000, GenericWrite=0x40000000, OpenExisting=3, CreateNew=1, OpenReparsePoint=0x200000, BackupSemantics=0x2000000;
    private const int Full=0x1f01ff, Read=0x120089, ReadExecute=0x1200a9;
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public uint Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written; public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFileW(string path,uint access,uint sharing,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFileW(string path,uint access,uint sharing,ref SecurityAttributes security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool CreateDirectoryW(string path,ref SecurityAttributes security);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool GetFileInformationByHandle(SafeFileHandle file,out FileInformation information);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint revision,out IntPtr descriptor,out uint length);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityInfo(SafeFileHandle handle,uint type,uint information,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    private static Exception Invalid()=>new InvalidOperationException("The protected Windows broker installation files did not verify.");
    internal static string OwnerScope(string sid)
    {
        if(!System.Text.RegularExpressions.Regex.IsMatch(sid,@"^S-1-5-21-(?:[0-9]{1,10}-){3}[0-9]{1,10}$")||new SecurityIdentifier(sid).Value!=sid)throw Invalid();
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sid))).ToLowerInvariant();
    }
    internal static string CurrentOwnerSid()=>WindowsIdentity.GetCurrent().User?.Value??throw Invalid();
    internal static bool RootAbsent(string sid)
    {
        string path=Root(sid);NoRedirectedParents(path);using var handle=CreateFileW(path,ReadControl|0x80,3,IntPtr.Zero,OpenExisting,BackupSemantics|OpenReparsePoint,IntPtr.Zero);
        int error=Marshal.GetLastWin32Error();return handle.IsInvalid&&error is 2 or 3;
    }
    internal static string Root(string sid)
    {
        if(!Environment.Is64BitProcess)throw Invalid();
        string parent=Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles,Environment.SpecialFolderOption.DoNotVerify);
        if(!Path.IsPathFullyQualified(parent)||parent.StartsWith(@"\\",StringComparison.Ordinal)||parent.Any(char.IsControl))throw Invalid();
        return Path.Combine(parent,"Switchyard.StorageBroker-"+OwnerScope(sid));
    }
    private static void NoRedirectedParents(string path)
    {
        string? parent=Path.GetDirectoryName(path);
        for(int count=0;parent!=null;count++)
        {
            if(count>64||(File.GetAttributes(parent)&(FileAttributes.Directory|FileAttributes.ReparsePoint))!=FileAttributes.Directory)throw Invalid();
            parent=Path.GetDirectoryName(parent);
        }
    }
    private static void Verify(SafeFileHandle handle,string sid,bool directory,bool clientRead,bool executable,bool inheritedPrivate=false,bool mountPoint=false)
    {
        if(handle.IsInvalid||!GetFileInformationByHandle(handle,out var info)||(!mountPoint&&(info.Attributes&0x400)!=0)||((info.Attributes&0x10)!=0)!=directory)throw Invalid();
        uint error=GetSecurityInfo(handle,1,5,out _,out _,out _,out _,out var descriptor);if(error!=0)throw new Win32Exception(checked((int)error));
        try
        {
            uint size=GetSecurityDescriptorLength(descriptor);if(size is <20 or >65536)throw Invalid();byte[] bytes=new byte[size];Marshal.Copy(descriptor,bytes,0,checked((int)size));var security=new RawSecurityDescriptor(bytes,0);
            if(security.Owner?.Value is not ("S-1-5-18" or "S-1-5-32-544")||!inheritedPrivate&&!security.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected)||security.DiscretionaryAcl==null||inheritedPrivate&&clientRead)throw Invalid();
            var expected=new Dictionary<string,int>{{"S-1-5-18",Full},{"S-1-5-32-544",Full}};if(clientRead)expected.Add(sid,directory||executable?ReadExecute:Read);
            var seen=new HashSet<string>(StringComparer.Ordinal);
            foreach(GenericAce entry in security.DiscretionaryAcl)
            {
                if(entry is not CommonAce ace||ace.AceQualifier!=AceQualifier.AccessAllowed||!expected.TryGetValue(ace.SecurityIdentifier.Value,out int mask)||ace.AccessMask!=mask||!seen.Add(ace.SecurityIdentifier.Value)
                    ||(ace.AceFlags&~(inheritedPrivate?AceFlags.Inherited:AceFlags.None))!=(directory?AceFlags.ContainerInherit|AceFlags.ObjectInherit:AceFlags.None))throw Invalid();
            }
            if(seen.Count!=expected.Count)throw Invalid();
        }
        finally{LocalFree(descriptor);}
    }
    private static SecurityAttributes Security(string sid,bool directory,bool clientRead,bool executable)
    {
        OwnerScope(sid);string flags=directory?"OICI":"",rights=(directory||executable?ReadExecute:Read).ToString("x");
        string sddl=$"O:BAG:SYD:P(A;{flags};FA;;;SY)(A;{flags};FA;;;BA)"+(clientRead?$"(A;{flags};0x{rights};;;{sid})":"");
        if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,1,out var memory,out _))throw new Win32Exception(Marshal.GetLastWin32Error());
        return new SecurityAttributes{Length=checked((uint)Marshal.SizeOf<SecurityAttributes>()),Descriptor=memory,Inherit=false};
    }
    internal static SafeFileHandle PinDirectory(string path,string sid,bool clientRead=true)
    {
        NoRedirectedParents(path);var handle=CreateFileW(path,ReadControl|0x80,3,IntPtr.Zero,OpenExisting,BackupSemantics|OpenReparsePoint,IntPtr.Zero);
        try{Verify(handle,sid,true,clientRead,false);return handle;}catch{handle.Dispose();throw;}
    }
    // Only the bounded-volume core calls this after verifying the exact mount
    // reparse tag, native ID and original volume/device/extent binding.
    internal static void VerifyMountDirectory(SafeFileHandle handle,string sid)=>Verify(handle,sid,true,true,false,mountPoint:true);
    internal static SafeFileHandle CreateDataFile(string path,string sid)
    {
        NoRedirectedParents(path);var security=Security(sid,false,true,false);
        try
        {
            var handle=CreateFileW(path,GenericRead|GenericWrite|ReadControl,1,ref security,CreateNew,OpenReparsePoint,IntPtr.Zero);
            try{Verify(handle,sid,false,true,false);return handle;}catch{handle.Dispose();throw;}
        }
        finally{LocalFree(security.Descriptor);}
    }
    internal static string OwnerForRoot(string path)
    {
        NoRedirectedParents(path);using var handle=CreateFileW(path,ReadControl|0x80,3,IntPtr.Zero,OpenExisting,BackupSemantics|OpenReparsePoint,IntPtr.Zero);
        if(handle.IsInvalid||!GetFileInformationByHandle(handle,out var info)||(info.Attributes&0x410)!=0x10)throw Invalid();
        uint error=GetSecurityInfo(handle,1,5,out _,out _,out _,out _,out var descriptor);if(error!=0)throw new Win32Exception(checked((int)error));
        string sid;
        try
        {
            uint size=GetSecurityDescriptorLength(descriptor);if(size is <20 or >65536)throw Invalid();byte[] bytes=new byte[size];Marshal.Copy(descriptor,bytes,0,checked((int)size));var security=new RawSecurityDescriptor(bytes,0);
            var clients=security.DiscretionaryAcl?.OfType<CommonAce>().Where(ace=>ace.SecurityIdentifier.Value.StartsWith("S-1-5-21-",StringComparison.Ordinal)).Select(ace=>ace.SecurityIdentifier.Value).Distinct().ToArray();
            if(clients?.Length!=1)throw Invalid();sid=clients[0];
        }
        finally{LocalFree(descriptor);}
        Verify(handle,sid,true,true,false);
        if(!Path.GetFullPath(path).TrimEnd('\\').Equals(Root(sid).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw Invalid();
        return sid;
    }
    internal static SafeFileHandle CreateDirectory(string path,string sid,bool clientRead=true)
    {
        NoRedirectedParents(path);var security=Security(sid,true,clientRead,false);
        try{if(!CreateDirectoryW(path,ref security))throw new Win32Exception(Marshal.GetLastWin32Error());}finally{LocalFree(security.Descriptor);}
        return PinDirectory(path,sid,clientRead);
    }
    internal static byte[] ReadFile(string path,string sid,int maximum,bool clientRead=true,bool executable=false)
    {
        NoRedirectedParents(path);using var handle=CreateFileW(path,GenericRead|ReadControl,1,IntPtr.Zero,OpenExisting,OpenReparsePoint,IntPtr.Zero);Verify(handle,sid,false,clientRead,executable);
        using var stream=new FileStream(handle,FileAccess.Read);if(stream.Length<1||stream.Length>maximum)throw Invalid();byte[] bytes=new byte[checked((int)stream.Length)];stream.ReadExactly(bytes);if(stream.ReadByte()!=-1)throw Invalid();return bytes;
    }
    internal static void CreateFile(string path,string sid,ReadOnlySpan<byte> bytes,bool clientRead=true,bool executable=false)
    {
        NoRedirectedParents(path);if(bytes.Length is <1 or >134217728)throw Invalid();var security=Security(sid,false,clientRead,executable);
        try
        {
            using var handle=CreateFileW(path,GenericRead|GenericWrite|ReadControl,1,ref security,CreateNew,OpenReparsePoint,IntPtr.Zero);Verify(handle,sid,false,clientRead,executable);
            using var stream=new FileStream(handle,FileAccess.ReadWrite);stream.Write(bytes);stream.Flush(true);stream.Position=0;byte[] observed=new byte[bytes.Length];
            try{stream.ReadExactly(observed);if(!CryptographicOperations.FixedTimeEquals(SHA256.HashData(bytes),SHA256.HashData(observed)))throw Invalid();}finally{CryptographicOperations.ZeroMemory(observed);}
        }
        finally{LocalFree(security.Descriptor);}
    }
    internal static byte[] ReadSelf(string expectedSha256)
    {
        string path=Environment.ProcessPath??throw Invalid();if(Path.GetFileName(path)!="Switchyard.Hotkeys.exe")throw Invalid();
        NoRedirectedParents(path);using var file=CreateFileW(path,GenericRead,1,IntPtr.Zero,OpenExisting,OpenReparsePoint,IntPtr.Zero);
        if(file.IsInvalid||!GetFileInformationByHandle(file,out var info)||(info.Attributes&0x410)!=0)throw Invalid();
        using var stream=new FileStream(file,FileAccess.Read);if(stream.Length is <1 or >134217728)throw Invalid();byte[] bytes=new byte[checked((int)stream.Length)];stream.ReadExactly(bytes);
        if(stream.ReadByte()!=-1||Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()!=expectedSha256)throw Invalid();return bytes;
    }
    internal sealed record PrivateIdentity(string NativeId,bool Directory,long Size,string? Sha256);
    internal static PrivateIdentity InspectPrivate(string path,string sid,bool directory)
    {
        NoRedirectedParents(path);using var handle=CreateFileW(path,ReadControl|0x80|(directory?0:GenericRead),1,IntPtr.Zero,OpenExisting,OpenReparsePoint|(directory?BackupSemantics:0),IntPtr.Zero);
        Verify(handle,sid,directory,false,false,inheritedPrivate:true);
        if(!GetFileInformationByHandle(handle,out var info)||!directory&&info.Links!=1)throw Invalid();
        long size=((long)info.SizeHigh<<32)|info.SizeLow;if(!directory&&(size<1||size>134217728))throw Invalid();
        string nativeId=$"{info.Volume:x8}:{info.IndexHigh:x8}{info.IndexLow:x8}";
        if(directory)return new(nativeId,true,0,null);
        using var stream=new FileStream(handle,FileAccess.Read);if(stream.Length!=size)throw Invalid();
        return new(nativeId,false,size,Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant());
    }
}
