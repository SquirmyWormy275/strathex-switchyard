using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Principal;

[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerService
{
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void ServiceMain(uint count,IntPtr arguments);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate uint ServiceHandler(uint control,uint eventType,IntPtr eventData,IntPtr context);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] private struct ServiceEntry { [MarshalAs(UnmanagedType.LPWStr)] public string? Name; [MarshalAs(UnmanagedType.FunctionPtr)] public ServiceMain? Main; }
    [StructLayout(LayoutKind.Sequential)] private struct ServiceStatus { public uint Type,State,Accepted,ExitCode,SpecificExitCode,Checkpoint,WaitHint; }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool StartServiceCtrlDispatcherW([In] ServiceEntry[] entries);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr RegisterServiceCtrlHandlerExW(string name,ServiceHandler handler,IntPtr context);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool SetServiceStatus(IntPtr handle,ref ServiceStatus status);
    private static readonly ServiceMain MainCallback=Main;
    private static readonly ServiceHandler HandlerCallback=Control;
    private static readonly CancellationTokenSource Stop=new();
    private static readonly object StatusLock=new();
    private static IntPtr statusHandle;
    private static ServiceStatus status;
    private static WindowsStorageBrokerInstallation.Settings? settings;
    private static void Report(uint state,uint error=0)
    {
        lock(StatusLock)
        {
            status=new ServiceStatus{Type=16,State=state,Accepted=state==4?5u:0u,ExitCode=error,Checkpoint=state is 2 or 3?status.Checkpoint+1:0,WaitHint=state is 2 or 3?10000u:0u};
            if(!SetServiceStatus(statusHandle,ref status))throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }
    private static uint Control(uint control,uint eventType,IntPtr eventData,IntPtr context)
    {
        try
        {
            if(control is 1 or 5){Report(3);Stop.Cancel();}
            else if(control==4){lock(StatusLock){if(!SetServiceStatus(statusHandle,ref status))return checked((uint)Marshal.GetLastWin32Error());}}
            return 0;
        }
        catch{return 1;}
    }
    private static void Main(uint count,IntPtr arguments)
    {
        uint error=0;
        try
        {
            var current=settings??throw new InvalidOperationException("The protected broker binding is unavailable.");
            statusHandle=RegisterServiceCtrlHandlerExW(current.ServiceName,HandlerCallback,IntPtr.Zero);if(statusHandle==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
            Report(2);using var identity=WindowsIdentity.GetCurrent();if(identity.User?.Value!="S-1-5-18")throw new InvalidOperationException("Broker service identity did not verify.");
            WindowsStorageBrokerRuntime.SealOrVerify(current);
            using var key=WindowsStorageBrokerInstallation.OpenSigningKey(current);using var pipe=WindowsStorageBrokerPipe.CreateServer(current);Report(4);
            WindowsStorageBrokerPipe.Serve(pipe,current,key,Stop.Token).GetAwaiter().GetResult();
            if(!Stop.IsCancellationRequested)error=1;
        }
        catch{error=1;}
        finally{if(statusHandle!=IntPtr.Zero)try{Report(1,error);}catch{/* SCM/process exit still needs independent observation. */}}
    }
    internal static int Run()
    {
        try
        {
            using var identity=WindowsIdentity.GetCurrent();if(identity.User?.Value!="S-1-5-18")return 2;
            settings=WindowsStorageBrokerInstallation.LoadSelf();
            return StartServiceCtrlDispatcherW(new[]{new ServiceEntry{Name=settings.ServiceName,Main=MainCallback},new ServiceEntry()})?0:2;
        }
        catch{return 2;}
    }
}
