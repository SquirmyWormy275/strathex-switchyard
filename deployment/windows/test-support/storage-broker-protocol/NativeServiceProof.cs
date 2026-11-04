using System.Buffers.Binary;
using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static class NativeServiceProof
{
    [StructLayout(LayoutKind.Sequential)] private struct SidAttributes{public IntPtr Sid;public uint Attributes;}
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(IntPtr process,uint access,out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool CreateRestrictedToken(SafeAccessTokenHandle source,uint flags,uint count,ref SidAttributes disabled,uint deleteCount,IntPtr delete,uint restrictCount,IntPtr restrict,out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool ConvertStringSidToSidW(string text,out IntPtr sid);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafePipeHandle CreateFileW(string name,uint access,uint sharing,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool WaitNamedPipeW(string name,uint timeout);
    internal static int Run()
    {
        if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||Environment.GetEnvironmentVariable("RUNNER_OS")!="Windows")throw new InvalidOperationException("Use only the disposable Windows broker service proof.");
        var settings=WindowsStorageBrokerInstallation.Load(WindowsStorageBrokerFiles.CurrentOwnerSid());int checks=0;
        void Require(bool value){if(!value)throw new InvalidOperationException("The exact native broker service proof failed.");checks++;}
        void Denied(Action action){try{action();}catch(UnauthorizedAccessException){checks++;return;}throw new InvalidOperationException("The ordinary client reached private broker state.");}
        Require(settings.InstallationId==Environment.GetEnvironmentVariable("SWITCHYARD_TEST_BROKER_INSTALLATION_ID"));
        Require(WindowsStorageBrokerPipe.Observe(settings).GetAwaiter().GetResult().GetProperty("privilegeStateUnchanged").GetBoolean());
        Require(!WindowsStorageBrokerPipe.Observe(settings).GetAwaiter().GetResult().GetProperty("brokerImplemented").GetBoolean());
        if(!OpenProcessToken(new IntPtr(-1),0xe,out var source))throw new Win32Exception(Marshal.GetLastWin32Error());
        using(source)
        {
            if(!ConvertStringSidToSidW("S-1-5-32-544",out var admins))throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                var disabled=new SidAttributes{Sid=admins};if(!CreateRestrictedToken(source,1,1,ref disabled,0,IntPtr.Zero,0,IntPtr.Zero,out var restricted))throw new Win32Exception(Marshal.GetLastWin32Error());
                using(restricted)WindowsIdentity.RunImpersonated(restricted,()=>
                {
                    Require(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator));
                    Require(WindowsStorageBrokerInstallation.Load(settings.ClientSid)==settings);
                    Require(WindowsStorageBrokerPipe.Observe(settings).GetAwaiter().GetResult().GetProperty("privilegeStateUnchanged").GetBoolean());
                    Denied(()=>File.ReadAllBytes(Path.Combine(settings.Root,WindowsStorageBrokerInstallation.PrivateKey)));
                    Denied(()=>Directory.GetFileSystemEntries(WindowsStorageBrokerRuntime.Root(settings)));
                    Denied(()=>File.ReadAllBytes(Path.Combine(settings.Root,WindowsStorageBrokerRuntime.InventoryName)));
                    string name=@"\\.\pipe\switchyard-storage-"+settings.OwnerScope+"-"+settings.InstallationId;
                    using(var broad=CreateFileW(name,0xc0000000,0,IntPtr.Zero,3,0x40110000,IntPtr.Zero))Require(broad.IsInvalid&&Marshal.GetLastWin32Error()==5);
                });
            }
            finally{LocalFree(admins);}
        }
        RejectMalformed(settings).GetAwaiter().GetResult();checks++;
        Require(WindowsStorageBrokerPipe.Observe(settings).GetAwaiter().GetResult().GetProperty("privilegeStateUnchanged").GetBoolean());
        return checks;
    }
    private static async Task RejectMalformed(WindowsStorageBrokerInstallation.Settings settings)
    {
        string name=@"\\.\pipe\switchyard-storage-"+settings.OwnerScope+"-"+settings.InstallationId;
        var handle=CreateFileW(name,0x100183,0,IntPtr.Zero,3,0x40110000,IntPtr.Zero);
        if(handle.IsInvalid){handle.Dispose();if(!WaitNamedPipeW(name,1000))throw new InvalidOperationException("The exact pipe is unavailable.");handle=CreateFileW(name,0x100183,0,IntPtr.Zero,3,0x40110000,IntPtr.Zero);}
        if(handle.IsInvalid){handle.Dispose();throw new InvalidOperationException("The exact pipe did not reopen.");}
        using var pipe=new NamedPipeClientStream(PipeDirection.InOut,true,true,handle);using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(5));
        byte[] bytes=Encoding.UTF8.GetBytes("{\"schema\":\"untrusted\",\"action\":\"attach\",\"path\":\"C:\\\\foreign.vhd\"}"),header=new byte[4];BinaryPrimitives.WriteUInt32LittleEndian(header,(uint)bytes.Length);
        await pipe.WriteAsync(header,deadline.Token);await pipe.WriteAsync(bytes,deadline.Token);await pipe.FlushAsync(deadline.Token);
        byte[] response=new byte[1];try{if(await pipe.ReadAsync(response,deadline.Token)!=0)throw new InvalidOperationException("An unapproved pipe request received data.");}catch(IOException){/* Server disconnects without any reply. */}
    }
}
