using System.Buffers.Binary;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static class NativeExchangeProof
{
    internal static int CompletedChecks { get; private set; }
    internal static string Phase { get; private set; } = "not-started";
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool LookupPrivilegeValueW(string? system,string name,out long luid);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool GetTokenInformation(SafeAccessTokenHandle token,int kind,[Out]byte[] bytes,uint length,out uint returned);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFileW(string path,uint access,uint sharing,IntPtr security,uint creation,uint flags,IntPtr template);
    private static bool VolumePrivilegeAssigned()
    {
        using var identity=WindowsIdentity.GetCurrent();if(!LookupPrivilegeValueW(null,"SeManageVolumePrivilege",out long luid))throw new Win32Exception(Marshal.GetLastWin32Error());
        var bytes=new byte[4096];if(!GetTokenInformation(identity.AccessToken,3,bytes,4096,out uint used)||used<4||used>4096)throw new Win32Exception(Marshal.GetLastWin32Error());
        uint count=BinaryPrimitives.ReadUInt32LittleEndian(bytes);if(count>256||used!=4+12*count)throw new InvalidOperationException("The restricted token shape did not verify.");
        for(int offset=4;offset<used;offset+=12)if(BinaryPrimitives.ReadInt64LittleEndian(bytes.AsSpan(offset))==luid&&(BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(offset+8))&4)==0)return true;
        return false;
    }
    internal static int Run()
    {
        if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||Environment.GetEnvironmentVariable("RUNNER_OS")!="Windows")throw new InvalidOperationException("Use only the disposable Windows bounded exchange proof.");
        CompletedChecks=0;Phase="installation";var settings=WindowsStorageBrokerInstallation.Load(WindowsStorageBrokerFiles.CurrentOwnerSid());int checks=0;
        void Require(bool value){if(!value)throw new InvalidOperationException("The original restricted-client bounded exchange proof failed.");CompletedChecks=++checks;}
        void Refuses(Action action){try{action();}catch(Exception error)when(error is IOException or InvalidOperationException or UnauthorizedAccessException){CompletedChecks=++checks;return;}throw new InvalidOperationException("A foreign exchange operation was accepted.");}
        Require(settings.InstallationId==Environment.GetEnvironmentVariable("SWITCHYARD_TEST_BROKER_INSTALLATION_ID"));
        Phase="restricted-token";NativeServiceProof.WithoutVolumePrivilege(()=>
        {
            Require(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator));Require(!VolumePrivilegeAssigned());
            var files=new WindowsStorageBrokerExchangeFiles(settings);string operation=Guid.NewGuid().ToString("D"),createId=Guid.NewGuid().ToString("D"),task=new string('c',64),inputs=new string('d',64);
            WindowsStorageBrokerExchangeProtocol.Proof Call(string action,string? requestId=null,string? scope=null,string? operationId=null){Phase="exchange-"+action;return WindowsStorageBrokerPipe.Exchange(settings,action,requestId??Guid.NewGuid().ToString("D"),operationId??operation,scope??task,inputs).GetAwaiter().GetResult();}
            var created=Call("create",createId);Require(created.State=="created"&&created.DetachedVerified&&!created.Attached);Require(files.Read(operation).Count==2);
            using var image=JsonDocument.Parse(files.ReadFact(operation,"image.json"));string disk=files.DiskRoot(operation),imagePath=Path.Combine(disk,"exchange.vhd"),mount=Path.Combine(disk,"mount");
            Require(new FileInfo(imagePath).Length==WindowsStorageBrokerExchangeProtocol.BackingBytes);
            Require(Call("create",createId)==created&&files.Read(operation).Count==2);
            var original=WindowsStorageBrokerExchangeProtocol.ReadRequest(WindowsStorageBrokerExchangeProtocol.Request(settings.Binding,"create",createId,operation,task,inputs,new string('a',64)),settings.Binding);
            Require(files.Journal().Lookup(original).Proof==created&&files.Read(operation).Count==2);
            string other=Guid.NewGuid().ToString("D");Refuses(()=>Call("create",operationId:other));Require(files.DiskAbsent(other));
            Refuses(()=>Call("inspect",scope:new string('e',64)));
            Refuses(()=>{using var stream=File.Open(imagePath,FileMode.Open,FileAccess.Write,FileShare.ReadWrite);});
            Refuses(()=>{using var stream=File.Open(Path.Combine(files.OperationRoot(operation),"0000.json"),FileMode.Open,FileAccess.Write,FileShare.Read);});
            var attached=Call("attach");Require(attached.State=="mounted"&&attached.Attached&&attached.Mounted&&attached.ExchangeQuotaEnforced);
            foreach(uint access in new uint[]{0x2,0x100,0x10000,0x40000,0x80000})
            {
                using var changedMount=CreateFileW(mount,access,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);Require(changedMount.IsInvalid&&Marshal.GetLastWin32Error()==5);
            }
            Phase="mapping-observation";var binding=WindowsStorageBrokerExchangeMapping.Observe(settings,operation,task,inputs);Require(binding.GetProperty("broker").GetProperty("taskScopeSha256").GetString()==task);
            var changed=System.Text.Json.Nodes.JsonNode.Parse(binding.GetRawText())!;string foreignRoot=Path.Combine(settings.Root,"foreign","disk-"+operation);changed["stagingRoot"]=foreignRoot;
            Refuses(()=>{using var json=JsonDocument.Parse(changed.ToJsonString());using var mapping=ReviewedInputStager.PinBoundedMapping(json.RootElement,Path.Combine(foreignRoot,"mount"));});
            Require(Call("inspect")==attached with{EffectStarted=false});
            Phase="capacity-write";bool full=false;long written=0;
            try{using var output=new FileStream(Path.Combine(mount,"synthetic.bin"),FileMode.CreateNew,FileAccess.Write,FileShare.Read);var block=new byte[1024*1024];for(int count=0;count<80;count++){output.Write(block);written+=block.Length;}output.Flush(true);}
            catch(IOException error)when((error.HResult&0xffff)is 39 or 112){full=true;}
            Require(full&&written>0&&written<=WindowsStorageBrokerExchangeProtocol.VirtualBytes);
            Require(Call("inspect").ExchangeQuotaEnforced);
            var detached=Call("detach");Require(detached.State=="detached"&&detached.DetachedVerified&&!detached.Attached&&!detached.Mounted);
            Require(Call("inspect")==detached with{EffectStarted=false});
            var retired=Call("retire");Require(retired.State=="retired"&&retired.DetachedVerified&&files.DiskAbsent(operation));
            Require(Call("create",createId)==created&&files.Read(operation).Count==8);
            Require(files.Journal().Lookup(original).Proof==created&&files.Read(operation).Count==8);
            Require(Call("inspect")==retired with{EffectStarted=false});Require(!VolumePrivilegeAssigned());
        });
        return checks;
    }
}
