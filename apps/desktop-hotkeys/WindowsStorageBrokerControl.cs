using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;
using Microsoft.Win32;

[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerControl
{
    private sealed class ServiceHandle:SafeHandleZeroOrMinusOneIsInvalid
    {
        private ServiceHandle():base(true){}
        protected override bool ReleaseHandle()=>CloseServiceHandle(handle);
    }
    [StructLayout(LayoutKind.Sequential)] private struct Status { public uint Type,State,Accepted,ExitCode,SpecificExitCode,Checkpoint,WaitHint,Pid,Flags; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicStatus { public uint Type,State,Accepted,ExitCode,SpecificExitCode,Checkpoint,WaitHint; }
    [StructLayout(LayoutKind.Sequential)] private struct Configuration { public uint Type,Start,Error;public IntPtr Binary,Group;public uint Tag;public IntPtr Dependencies,Account,Display; }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern ServiceHandle OpenSCManagerW(string? machine,string? database,uint access);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern ServiceHandle OpenServiceW(ServiceHandle manager,string name,uint access);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern ServiceHandle CreateServiceW(ServiceHandle manager,string name,string display,uint access,uint type,uint start,uint error,string binary,string? group,IntPtr tag,string? dependencies,string? account,string? password);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool CloseServiceHandle(IntPtr handle);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool QueryServiceStatusEx(ServiceHandle service,uint level,out Status status,uint length,out uint required);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool QueryServiceConfigW(ServiceHandle service,IntPtr configuration,uint length,out uint required);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool StartServiceW(ServiceHandle service,uint count,IntPtr arguments);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool ControlService(ServiceHandle service,uint control,out BasicStatus status);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteService(ServiceHandle service);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern SafeProcessHandle OpenProcess(uint access,[MarshalAs(UnmanagedType.Bool)] bool inherit,uint pid);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool QueryFullProcessImageNameW(SafeProcessHandle process,uint flags,StringBuilder name,ref uint length);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern uint WaitForSingleObject(SafeProcessHandle handle,uint milliseconds);
    private static Exception Invalid()=>new InvalidOperationException("The exact protected broker service lifecycle did not verify.");
    private static void Administrator(){using var identity=WindowsIdentity.GetCurrent();if(!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))throw Invalid();}
    private static Status ReadStatus(ServiceHandle service)
    {
        if(!QueryServiceStatusEx(service,0,out var status,checked((uint)Marshal.SizeOf<Status>()),out uint required)||required!=Marshal.SizeOf<Status>()||status.Type!=16)throw Invalid();return status;
    }
    private static void VerifyEnvironment(WindowsStorageBrokerInstallation.Settings settings)
    {
        using var machine=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,RegistryView.Registry64);
        using var key=machine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\"+settings.ServiceName,false)??throw Invalid();
        if(key.GetValueKind("Environment")!=RegistryValueKind.MultiString||key.GetValue("Environment",null,RegistryValueOptions.DoNotExpandEnvironmentNames) is not string[] values||!values.SequenceEqual(new[]{"DOTNET_BUNDLE_EXTRACT_BASE_DIR="+WindowsStorageBrokerRuntime.Root(settings)}))throw Invalid();
    }
    private static void VerifyConfiguration(ServiceHandle service,WindowsStorageBrokerInstallation.Settings settings)
    {
        if(QueryServiceConfigW(service,IntPtr.Zero,0,out uint required)||Marshal.GetLastWin32Error()!=122||required<Marshal.SizeOf<Configuration>()||required>16384)throw Invalid();
        IntPtr memory=Marshal.AllocHGlobal(checked((int)required));
        try
        {
            if(!QueryServiceConfigW(service,memory,required,out uint returned)||returned>required)throw Invalid();var config=Marshal.PtrToStructure<Configuration>(memory);
            string Text(IntPtr pointer)
            {
                long offset=pointer.ToInt64()-memory.ToInt64();if(offset<0||offset>=required||(offset&1)!=0)throw Invalid();int maximum=checked((int)Math.Min((required-offset)/2,2049));
                for(int i=0;i<maximum;i++)if(Marshal.ReadInt16(pointer,i*2)==0)return Marshal.PtrToStringUni(pointer,i)??throw Invalid();throw Invalid();
            }
            if(config.Type!=16||config.Start!=2||config.Error!=1||Text(config.Binary)!=settings.ServiceCommand||!Text(config.Account).Equals("LocalSystem",StringComparison.OrdinalIgnoreCase)||Text(config.Display)!="Switchyard scoped storage (metadata bootstrap)"||config.Dependencies!=IntPtr.Zero&&Text(config.Dependencies).Length!=0||config.Group!=IntPtr.Zero&&Text(config.Group).Length!=0||config.Tag!=0)throw Invalid();
        }
        finally{Marshal.FreeHGlobal(memory);}
        VerifyEnvironment(settings);
    }
    internal static WindowsStorageBrokerInstallation.Settings Install(string sid,string installationId,string selfSha256)
    {
        Administrator();var settings=WindowsStorageBrokerInstallation.Create(sid,installationId,selfSha256);
        using var manager=OpenSCManagerW(null,null,3);if(manager.IsInvalid)throw Invalid();
        using var service=CreateServiceW(manager,settings.ServiceName,"Switchyard scoped storage (metadata bootstrap)",0xf01ff,16,2,1,settings.ServiceCommand,null,IntPtr.Zero,null,"LocalSystem",null);
        if(service.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error());
        using(var machine=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,RegistryView.Registry64))
        using(var key=machine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\"+settings.ServiceName,true)??throw Invalid())
        {
            if(key.GetValueNames().Contains("Environment",StringComparer.OrdinalIgnoreCase))throw Invalid();
            key.SetValue("Environment",new[]{"DOTNET_BUNDLE_EXTRACT_BASE_DIR="+WindowsStorageBrokerRuntime.Root(settings)},RegistryValueKind.MultiString);key.Flush();
        }
        VerifyConfiguration(service,settings);
        if(!StartServiceW(service,0,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());
        long deadline=Environment.TickCount64+30000;
        while(Environment.TickCount64<deadline)
        {
            var status=ReadStatus(service);if(status.State==4&&status.Pid>0)return settings;if(status.State==1)throw Invalid();Thread.Sleep(50);
        }
        throw Invalid();
    }
    internal static bool IsRunning(WindowsStorageBrokerInstallation.Settings settings)
    {
        using var manager=OpenSCManagerW(null,null,1);if(manager.IsInvalid)throw Invalid();using var service=OpenServiceW(manager,settings.ServiceName,5);if(service.IsInvalid)return false;
        VerifyConfiguration(service,settings);var status=ReadStatus(service);return status.State==4&&status.Pid>0;
    }
    internal static object ObserveState(WindowsStorageBrokerInstallation.Settings settings)
    {
        using var manager=OpenSCManagerW(null,null,1);if(manager.IsInvalid)throw Invalid();using var service=OpenServiceW(manager,settings.ServiceName,5);if(service.IsInvalid)throw Invalid();
        VerifyConfiguration(service,settings);var status=ReadStatus(service);
        return new{state=status.State,nativeExitCode=status.ExitCode,specificExitCode=status.SpecificExitCode,configurationVerified=true};
    }
    internal static void Remove(WindowsStorageBrokerInstallation.Settings settings)
    {
        Administrator();using var manager=OpenSCManagerW(null,null,1);if(manager.IsInvalid)throw Invalid();
        using(var service=OpenServiceW(manager,settings.ServiceName,0x10025))
        {
            if(service.IsInvalid)throw Invalid();VerifyConfiguration(service,settings);var status=ReadStatus(service);SafeProcessHandle? process=null;
            try
            {
                if(status.Pid>0)
                {
                    process=OpenProcess(0x101000,false,status.Pid);if(process.IsInvalid)throw Invalid();var image=new StringBuilder(4096);uint length=4096;
                    if(!QueryFullProcessImageNameW(process,0,image,ref length)||!Path.GetFullPath(image.ToString()).Equals(settings.ImagePath,StringComparison.OrdinalIgnoreCase))throw Invalid();
                }
                if(status.State!=1&&!ControlService(service,1,out _))throw Invalid();long deadline=Environment.TickCount64+30000;
                while(ReadStatus(service).State!=1){if(Environment.TickCount64>=deadline)throw Invalid();Thread.Sleep(50);}
                if(process!=null&&WaitForSingleObject(process,30000)!=0)throw Invalid();
                if(!DeleteService(service))throw Invalid();
            }
            finally{process?.Dispose();}
        }
        long absentDeadline=Environment.TickCount64+10000;
        while(true)
        {
            using var observed=OpenServiceW(manager,settings.ServiceName,4);int error=Marshal.GetLastWin32Error();
            if(observed.IsInvalid&&error==1060)break;if(!observed.IsInvalid||error!=1072||Environment.TickCount64>=absentDeadline)throw Invalid();Thread.Sleep(50);
        }
        string[] expected={WindowsStorageBrokerInstallation.Executable,WindowsStorageBrokerInstallation.Configuration,WindowsStorageBrokerInstallation.PrivateKey};
        using(var root=WindowsStorageBrokerFiles.PinDirectory(settings.Root,settings.ClientSid))
        {
            if(!Directory.GetFiles(settings.Root).Select(Path.GetFileName).Order().SequenceEqual(expected.Append(WindowsStorageBrokerRuntime.InventoryName).Order())||!Directory.GetDirectories(settings.Root).Select(Path.GetFileName).SequenceEqual(new[]{WindowsStorageBrokerRuntime.DirectoryName}))throw Invalid();
            WindowsStorageBrokerInstallation.Load(settings.ClientSid);using var key=WindowsStorageBrokerInstallation.OpenSigningKey(settings);
            WindowsStorageBrokerRuntime.RemoveVerified(settings);
            foreach(string name in expected)File.Delete(Path.Combine(settings.Root,name));
        }
        Directory.Delete(settings.Root);if(Directory.Exists(settings.Root))throw Invalid();
    }
}
