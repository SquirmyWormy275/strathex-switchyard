using System.Buffers.Binary;
using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerPipe
{
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public uint Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafePipeHandle CreateNamedPipeW(string name,uint openMode,uint mode,uint maximumInstances,uint outputBytes,uint inputBytes,uint timeout,ref SecurityAttributes security);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafePipeHandle CreateFileW(string path,uint access,uint sharing,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool WaitNamedPipeW(string name,uint timeout);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint revision,out IntPtr descriptor,out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    private static Exception Invalid()=>new InvalidOperationException("The authenticated Windows storage broker pipe did not verify.");
    private static string Name(WindowsStorageBrokerInstallation.Settings settings)=>@"\\.\pipe\switchyard-storage-"+settings.OwnerScope+"-"+settings.InstallationId;
    private static void SystemIdentity(){using var identity=WindowsIdentity.GetCurrent();if(identity.User?.Value!="S-1-5-18")throw Invalid();}
    internal static NamedPipeServerStream CreateServer(WindowsStorageBrokerInstallation.Settings settings)
    {
        SystemIdentity();WindowsStorageBrokerFiles.OwnerScope(settings.ClientSid);
        // Read/write data and attributes, without FILE_CREATE_PIPE_INSTANCE.
        string sddl="O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x120183;;;"+settings.ClientSid+")";
        if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,1,out var memory,out _))throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var security=new SecurityAttributes{Length=checked((uint)Marshal.SizeOf<SecurityAttributes>()),Descriptor=memory,Inherit=false};
            // One retained first instance; remote clients are refused by the kernel.
            var handle=CreateNamedPipeW(Name(settings),0x40080003,8,1,16384,4096,1000,ref security);
            if(handle.IsInvalid){int error=Marshal.GetLastWin32Error();handle.Dispose();throw new Win32Exception(error);}
            try{return new NamedPipeServerStream(PipeDirection.InOut,true,false,handle);}catch{handle.Dispose();throw;}
        }
        finally{LocalFree(memory);}
    }
    private static async Task<byte[]> ReadFrame(Stream pipe,int maximum,CancellationToken stop)
    {
        byte[] header=new byte[4];await pipe.ReadExactlyAsync(header,stop);uint length=BinaryPrimitives.ReadUInt32LittleEndian(header);
        if(length<2||length>maximum)throw Invalid();byte[] bytes=new byte[checked((int)length)];await pipe.ReadExactlyAsync(bytes,stop);return bytes;
    }
    private static async Task WriteFrame(Stream pipe,byte[] bytes,CancellationToken stop)
    {
        if(bytes.Length is <2 or >16384)throw Invalid();byte[] header=new byte[4];BinaryPrimitives.WriteUInt32LittleEndian(header,checked((uint)bytes.Length));
        await pipe.WriteAsync(header,stop);await pipe.WriteAsync(bytes,stop);await pipe.FlushAsync(stop);
    }
    internal static async Task Serve(NamedPipeServerStream pipe,WindowsStorageBrokerInstallation.Settings settings,ECDsa signingKey,CancellationToken stop)
    {
        SystemIdentity();
        while(!stop.IsCancellationRequested)
        {
            bool connected=false,callerMatched=false;string phase="connection";
            try
            {
                await pipe.WaitForConnectionAsync(stop);connected=true;phase="frame";
                using var deadline=CancellationTokenSource.CreateLinkedTokenSource(stop);deadline.CancelAfter(TimeSpan.FromSeconds(5));
                byte[] bytes=await ReadFrame(pipe,4096,deadline.Token);
                try
                {
                    phase="caller";string? client=null;pipe.RunAsClient(()=>{using var identity=WindowsIdentity.GetCurrent(true);client=identity?.User?.Value;});SystemIdentity();
                    callerMatched=client==settings.ClientSid;if(!callerMatched)throw Invalid();phase="request";
                    byte[] reply;
                    using(var document=JsonDocument.Parse(bytes,new JsonDocumentOptions{MaxDepth=4}))
                    {
                        if(document.RootElement.GetProperty("schema").GetString()==WindowsStorageBrokerExchangeProtocol.Schema)
                        {
                            var request=WindowsStorageBrokerExchangeProtocol.ReadRequest(bytes,settings.Binding);
                            // A separate fixed bound for newly implemented data
                            // effects; metadata retains its original five seconds.
                            deadline.CancelAfter(TimeSpan.FromSeconds(45));phase="exchange";
                            var proof=WindowsStorageBrokerExchangeEngine.Execute(settings,request);
                            phase="signature";reply=WindowsStorageBrokerExchangeProtocol.Reply(settings.Binding,request,proof,signingKey);
                        }
                        else
                        {
                            var request=WindowsStorageBrokerProtocol.ReadRequest(bytes,settings.Binding);
                            phase="storage";var storage=JsonSerializer.SerializeToElement(ReviewedInputStager.StoragePrerequisites());
                            phase="signature";reply=WindowsStorageBrokerProtocol.Reply(settings.Binding,request,storage,signingKey);
                        }
                    }
                    try
                    {
                        phase="write";await WriteFrame(pipe,reply,deadline.Token);
                        // DisconnectNamedPipe discards unread server output. A
                        // bounded acknowledgement proves the client consumed
                        // this exact nonce-bound signed reply before disconnect.
                        phase="acknowledgement";byte[] acknowledgement=await ReadFrame(pipe,32,deadline.Token);
                        try{if(acknowledgement.Length!=32||!CryptographicOperations.FixedTimeEquals(acknowledgement,SHA256.HashData(reply)))throw Invalid();}
                        finally{CryptographicOperations.ZeroMemory(acknowledgement);}
                    }
                    finally{CryptographicOperations.ZeroMemory(reply);}
                }
                finally{CryptographicOperations.ZeroMemory(bytes);}
            }
            catch(Exception error) when(error is IOException or InvalidOperationException or JsonException or CryptographicException or UnauthorizedAccessException or OperationCanceledException or FormatException or DecoderFallbackException or Win32Exception or System.Security.SecurityException)
            {
                // Malformed/unauthorized clients receive no data and start no effect.
                SystemIdentity();
                if(!stop.IsCancellationRequested)WindowsStorageBrokerDiagnostic.RetainFirst(settings,phase,error,callerMatched);
            }
            finally{if(connected)pipe.Disconnect();}
        }
    }
    internal static async Task<JsonElement> Observe(WindowsStorageBrokerInstallation.Settings settings)
    {
        using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(5));
        string name=Name(settings);var handle=CreateFileW(name,0x100183,0,IntPtr.Zero,3,0x40110000,IntPtr.Zero);
        if(handle.IsInvalid)
        {
            handle.Dispose();if(!WaitNamedPipeW(name,1000))throw Invalid();
            handle=CreateFileW(name,0x100183,0,IntPtr.Zero,3,0x40110000,IntPtr.Zero);
        }
        if(handle.IsInvalid){handle.Dispose();throw Invalid();}
        using var pipe=new NamedPipeClientStream(PipeDirection.InOut,true,true,handle);
        string nonce=Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();byte[] bytes=WindowsStorageBrokerProtocol.Request(settings.Binding,nonce);
        var request=WindowsStorageBrokerProtocol.ReadRequest(bytes,settings.Binding);await WriteFrame(pipe,bytes,deadline.Token);byte[] reply=await ReadFrame(pipe,16384,deadline.Token);
        try
        {
            var verified=WindowsStorageBrokerProtocol.Verify(reply,settings.Binding,request,WindowsStorageBrokerInstallation.PublicKeyBytes(settings));
            byte[] acknowledgement=SHA256.HashData(reply);try{await WriteFrame(pipe,acknowledgement,deadline.Token);}finally{CryptographicOperations.ZeroMemory(acknowledgement);}return verified;
        }
        finally{CryptographicOperations.ZeroMemory(bytes);CryptographicOperations.ZeroMemory(reply);}
    }
    internal static async Task<WindowsStorageBrokerExchangeProtocol.Proof> Exchange(WindowsStorageBrokerInstallation.Settings settings,string action,string requestId,string operationId,string taskScopeSha256,string inputManifestSha256)
    {
        using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(45));
        string name=Name(settings);var handle=CreateFileW(name,0x100183,0,IntPtr.Zero,3,0x40110000,IntPtr.Zero);
        if(handle.IsInvalid){handle.Dispose();if(!WaitNamedPipeW(name,1000))throw Invalid();handle=CreateFileW(name,0x100183,0,IntPtr.Zero,3,0x40110000,IntPtr.Zero);}
        if(handle.IsInvalid){handle.Dispose();throw Invalid();}
        using var pipe=new NamedPipeClientStream(PipeDirection.InOut,true,true,handle);
        string nonce=Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        byte[] bytes=WindowsStorageBrokerExchangeProtocol.Request(settings.Binding,action,requestId,operationId,taskScopeSha256,inputManifestSha256,nonce);
        var request=WindowsStorageBrokerExchangeProtocol.ReadRequest(bytes,settings.Binding);await WriteFrame(pipe,bytes,deadline.Token);byte[] reply=await ReadFrame(pipe,16384,deadline.Token);
        try
        {
            var verified=WindowsStorageBrokerExchangeProtocol.Verify(reply,settings.Binding,request,WindowsStorageBrokerInstallation.PublicKeyBytes(settings));
            byte[] acknowledgement=SHA256.HashData(reply);try{await WriteFrame(pipe,acknowledgement,deadline.Token);}finally{CryptographicOperations.ZeroMemory(acknowledgement);}return verified;
        }
        finally{CryptographicOperations.ZeroMemory(bytes);CryptographicOperations.ZeroMemory(reply);}
    }
}
