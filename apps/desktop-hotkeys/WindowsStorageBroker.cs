using System.Runtime.Versioning;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

[SupportedOSPlatform("windows")]
internal static class WindowsStorageBroker
{
    private const string Schema="switchyard-windows-storage-broker-host/v1";
    private static Exception Invalid()=>new InvalidOperationException("Choose only one exact Windows broker metadata or bootstrap lifecycle action.");
    private static void Exact(JsonElement value,params string[] names)
    {
        if(value.ValueKind!=JsonValueKind.Object)throw Invalid();var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var property in value.EnumerateObject())if(!names.Contains(property.Name,StringComparer.Ordinal)||!seen.Add(property.Name))throw Invalid();if(seen.Count!=names.Length)throw Invalid();
    }
    private static void Write(object value)=>Console.WriteLine(JsonSerializer.Serialize(value));
    internal static int Run()
    {
        string action="";bool attempted=false;
        try
        {
            Console.InputEncoding=new UTF8Encoding(false,true);Console.OutputEncoding=new UTF8Encoding(false);
            char[] chars=new char[8193];int count=0;while(count<chars.Length){int read=Console.In.Read(chars,count,chars.Length-count);if(read==0)break;count+=read;}
            if(count>8192)throw Invalid();using var document=JsonDocument.Parse(new string(chars,0,count),new JsonDocumentOptions{MaxDepth=4});var request=document.RootElement;
            action=request.GetProperty("action").GetString()??"";
            if(action=="metadata")Exact(request,"schema","action");else if(action is "install-bootstrap" or "remove-bootstrap")Exact(request,"schema","action","clientSid","installationId","helperSha256");else throw Invalid();
            if(request.GetProperty("schema").GetString()!=Schema)throw Invalid();
            if(action=="metadata")
            {
                string stage="installation";object? serviceState=null;WindowsStorageBrokerInstallation.Settings? settings=null;
                try
                {
                    settings=WindowsStorageBrokerInstallation.Load(WindowsStorageBrokerFiles.CurrentOwnerSid());stage="service-status";serviceState=WindowsStorageBrokerControl.ObserveState(settings);stage="authenticated-pipe";var storage=WindowsStorageBrokerPipe.Observe(settings).GetAwaiter().GetResult();
                    Write(new{schema=Schema,action,status="bootstrap-ready",installationId=settings.InstallationId,ownerScope=settings.OwnerScope,serviceImageSha256=settings.ServiceImageSha256,protocolVerified=true,storage,brokerImplemented=false,effectStarted=false});return 0;
                }
                catch(Exception error){JsonElement? diagnostic=null;bool installationAbsentVerified=false;try{installationAbsentVerified=WindowsStorageBrokerFiles.RootAbsent(WindowsStorageBrokerFiles.CurrentOwnerSid());}catch{}if(settings!=null){try{serviceState=WindowsStorageBrokerControl.ObserveState(settings);}catch{}try{diagnostic=WindowsStorageBrokerDiagnostic.Read(settings);}catch{}}Write(new{schema=Schema,action,status="unavailable",reason="The original protected broker and its fresh authenticated metadata could not be verified.",installationAbsentVerified,failureStage=stage,serviceState,diagnostic,errorCategory=error.GetType().Name,nativeCode=error is System.ComponentModel.Win32Exception native?native.NativeErrorCode:(int?)null,brokerImplemented=false,effectStarted=false});return 0;}
            }
            string sid=request.GetProperty("clientSid").GetString()??"",installationId=request.GetProperty("installationId").GetString()??"",sha=request.GetProperty("helperSha256").GetString()??"";
            string scope=WindowsStorageBrokerFiles.OwnerScope(sid);WindowsStorageBrokerProtocol.Request(new(installationId,scope,sha),new string('a',64));
            using(var identity=WindowsIdentity.GetCurrent())if(!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))throw Invalid();
            if(action=="install-bootstrap")
            {
                attempted=true;var settings=WindowsStorageBrokerControl.Install(sid,installationId,sha);var storage=WindowsStorageBrokerPipe.Observe(settings).GetAwaiter().GetResult();
                Write(new{schema=Schema,action,status="bootstrap-ready",installationId,ownerScope=scope,serviceImageSha256=sha,protocolVerified=true,storage,serviceInstalled=true,brokerImplemented=false,effectStarted=true});return 0;
            }
            else
            {
                var settings=WindowsStorageBrokerInstallation.Load(sid);if(settings.InstallationId!=installationId||settings.ServiceImageSha256!=sha)throw Invalid();
                attempted=true;WindowsStorageBrokerControl.Remove(settings);
                Write(new{schema=Schema,action,status="removed",installationId,ownerScope=scope,serviceRemovedVerified=true,filesRemovedVerified=true,brokerImplemented=false,effectStarted=true});return 0;
            }
        }
        catch
        {
            if(attempted){Write(new{schema=Schema,action,status="outcome-unconfirmed",reason="Preserve the exact protected installation and reconcile its original native service ownership; no bootstrap action was replayed.",brokerImplemented=false,effectStarted=true});return 0;}
            return 2;
        }
    }
}
