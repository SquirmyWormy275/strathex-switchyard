using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static class NativeFilesProof
{
    [StructLayout(LayoutKind.Sequential)] private struct SidAttributes { public IntPtr Sid; public uint Attributes; }
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(IntPtr process,uint access,out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool CreateRestrictedToken(SafeAccessTokenHandle source,uint flags,uint disableCount,ref SidAttributes disable,uint deleteCount,IntPtr delete,uint restrictCount,IntPtr restrict,out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool ConvertStringSidToSidW(string text,out IntPtr sid);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFileW(string path,uint access,uint sharing,IntPtr security,uint creation,uint flags,IntPtr template);
    internal static int Run()
    {
        if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||Environment.GetEnvironmentVariable("RUNNER_OS")!="Windows")throw new InvalidOperationException("Protected broker file proof requires its disposable Windows CI worker.");
        string sid=WindowsStorageBrokerFiles.CurrentOwnerSid(),parent=Path.GetDirectoryName(WindowsStorageBrokerFiles.Root(sid))!,root=Path.Combine(parent,"Switchyard.StorageBroker-Proof-"+Guid.NewGuid().ToString("D"));
        string binary=Path.Combine(root,"code.bin"),metadata=Path.Combine(root,"installation.json"),secret=Path.Combine(root,"identity.pk8");
        int checks=0;bool created=false;
        void Require(bool valid){if(!valid)throw new InvalidOperationException("Protected broker file proof failed.");checks++;}
        void Denied(Action action){try{action();}catch(UnauthorizedAccessException){checks++;return;}throw new InvalidOperationException("An unprivileged token changed protected broker files.");}
        try
        {
            using(var directory=WindowsStorageBrokerFiles.CreateDirectory(root,sid)){created=true;Require(!directory.IsInvalid);}
            WindowsStorageBrokerFiles.CreateFile(binary,sid,"synthetic immutable code"u8,executable:true);
            WindowsStorageBrokerFiles.CreateFile(metadata,sid,"synthetic public metadata"u8);
            WindowsStorageBrokerFiles.CreateFile(secret,sid,"synthetic private key"u8,clientRead:false);
            Require(System.Text.Encoding.UTF8.GetString(WindowsStorageBrokerFiles.ReadFile(binary,sid,256,executable:true))=="synthetic immutable code");
            Require(System.Text.Encoding.UTF8.GetString(WindowsStorageBrokerFiles.ReadFile(metadata,sid,256))=="synthetic public metadata");
            Require(System.Text.Encoding.UTF8.GetString(WindowsStorageBrokerFiles.ReadFile(secret,sid,256,clientRead:false))=="synthetic private key");
            if(!OpenProcessToken(new IntPtr(-1),0xe,out var source))throw new Win32Exception(Marshal.GetLastWin32Error());
            using(source)
            {
                if(!ConvertStringSidToSidW("S-1-5-32-544",out var admins))throw new Win32Exception(Marshal.GetLastWin32Error());
                try
                {
                    var disabled=new SidAttributes{Sid=admins,Attributes=0};
                    // Disable maximum privileges and make Administrators deny-only.
                    if(!CreateRestrictedToken(source,1,1,ref disabled,0,IntPtr.Zero,0,IntPtr.Zero,out var restricted))throw new Win32Exception(Marshal.GetLastWin32Error());
                    using(restricted)WindowsIdentity.RunImpersonated(restricted,()=>
                    {
                        Require(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator));
                        Require(File.ReadAllText(metadata)=="synthetic public metadata");
                        Denied(()=>File.WriteAllText(binary,"substituted code"));
                        Denied(()=>File.WriteAllText(metadata,"substituted public key"));
                        Denied(()=>File.ReadAllText(secret));
                        Denied(()=>File.WriteAllText(Path.Combine(root,"foreign"),"untrusted"));
                        Denied(()=>File.SetAttributes(metadata,FileAttributes.Hidden));
                        using var writeDacl=CreateFileW(metadata,0x40000,1,IntPtr.Zero,3,0x200000,IntPtr.Zero);Require(writeDacl.IsInvalid&&Marshal.GetLastWin32Error()==5);
                    });
                }
                finally{LocalFree(admins);}
            }
            Require(System.Text.Encoding.UTF8.GetString(WindowsStorageBrokerFiles.ReadFile(metadata,sid,256))=="synthetic public metadata");
            Require(System.Text.Encoding.UTF8.GetString(WindowsStorageBrokerFiles.ReadFile(binary,sid,256,executable:true))=="synthetic immutable code");
            Require(Directory.GetFileSystemEntries(root).Length==3);
        }
        finally
        {
            // Only this new nonce directory and its exact known file set exist.
            if(created){using(var pin=WindowsStorageBrokerFiles.PinDirectory(root,sid)){if(Directory.GetFileSystemEntries(root).Any(path=>path!=binary&&path!=metadata&&path!=secret))throw new InvalidOperationException("Preserve foreign protected proof files.");}foreach(string path in new[]{binary,metadata,secret})if(File.Exists(path))File.Delete(path);Directory.Delete(root);}
        }
        Require(!Directory.Exists(root));return checks;
    }
}
