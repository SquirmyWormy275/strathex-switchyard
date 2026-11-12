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
    private static object Proof(WindowsStorageBrokerExchangeProtocol.Proof proof)=>new{state=proof.State,effectStarted=proof.EffectStarted,attached=proof.Attached,mounted=proof.Mounted,detachedVerified=proof.DetachedVerified,exchangeQuotaEnforced=proof.ExchangeQuotaEnforced,virtualBytes=WindowsStorageBrokerExchangeProtocol.VirtualBytes,backingBytes=WindowsStorageBrokerExchangeProtocol.BackingBytes,sandboxEnforced=false};
    private static void Installation(JsonElement request,WindowsStorageBrokerInstallation.Settings settings)
    {
        if(request.GetProperty("installationId").GetString()!=settings.InstallationId||request.GetProperty("ownerScope").GetString()!=settings.OwnerScope||request.GetProperty("serviceImageSha256").GetString()!=settings.ServiceImageSha256)throw Invalid();
    }
    internal static int Run()
    {
        string action="",effectPhase="request";bool attempted=false;
        try
        {
            PipeTextProtocol.Configure();
            char[] chars=new char[8193];int count=0;while(count<chars.Length){int read=Console.In.Read(chars,count,chars.Length-count);if(read==0)break;count+=read;}
            if(count>8192)throw Invalid();using var document=JsonDocument.Parse(new string(chars,0,count),new JsonDocumentOptions{MaxDepth=4});var request=document.RootElement;
            action=request.GetProperty("action").GetString()??"";
            if(action is "metadata" or "probe-exchange")Exact(request,"schema","action");else if(action=="exchange-binding")Exact(request,"schema","action","installationId","ownerScope","serviceImageSha256","operationId","taskScopeSha256","inputManifestSha256");else if(action is "exchange" or "exchange-result")Exact(request,"schema","action","installationId","ownerScope","serviceImageSha256","verb","requestId","operationId","taskScopeSha256","inputManifestSha256");else if(action is "install-bootstrap" or "remove-bootstrap")Exact(request,"schema","action","clientSid","installationId","helperSha256");else throw Invalid();
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
            if(action=="probe-exchange")
            {
                try
                {
                    var settings=WindowsStorageBrokerInstallation.Load(WindowsStorageBrokerFiles.CurrentOwnerSid());
                    var proof=WindowsStorageBrokerPipe.Exchange(settings,"inspect",Guid.NewGuid().ToString("D"),Guid.NewGuid().ToString("D"),new string('a',64),new string('b',64)).GetAwaiter().GetResult();
                    if(proof.State!="outcome-unconfirmed"||proof.EffectStarted||proof.Attached||proof.Mounted||proof.DetachedVerified||proof.ExchangeQuotaEnforced)throw Invalid();
                    Write(new{schema=Schema,action,status="available",installationId=settings.InstallationId,ownerScope=settings.OwnerScope,serviceImageSha256=settings.ServiceImageSha256,protocolVerified=true,exchangeSupported=true,effectStarted=false,brokerImplemented=false});
                }
                catch{Write(new{schema=Schema,action,status="unavailable",exchangeSupported=false,effectStarted=false,brokerImplemented=false});}
                return 0;
            }
            if(action=="exchange-binding")
            {
                var settings=WindowsStorageBrokerInstallation.Load(WindowsStorageBrokerFiles.CurrentOwnerSid());Installation(request,settings);
                var binding=WindowsStorageBrokerExchangeMapping.Observe(settings,request.GetProperty("operationId").GetString()??"",request.GetProperty("taskScopeSha256").GetString()??"",request.GetProperty("inputManifestSha256").GetString()??"");
                Write(new{schema=Schema,action,status="mapping-verified",binding,protocolVerified=true,effectStarted=false,brokerImplemented=false});return 0;
            }
            if(action is "exchange" or "exchange-result")
            {
                var settings=WindowsStorageBrokerInstallation.Load(WindowsStorageBrokerFiles.CurrentOwnerSid());Installation(request,settings);
                string verb=request.GetProperty("verb").GetString()??"",requestId=request.GetProperty("requestId").GetString()??"",operationId=request.GetProperty("operationId").GetString()??"",taskScopeSha256=request.GetProperty("taskScopeSha256").GetString()??"",inputManifestSha256=request.GetProperty("inputManifestSha256").GetString()??"";
                if(action=="exchange-result")
                {
                    // A fresh serial pipe challenge precedes the protected
                    // read. Lookup cannot reserve or perform any missing effect.
                    _=WindowsStorageBrokerPipe.Observe(settings).GetAwaiter().GetResult();
                    var originalRequest=WindowsStorageBrokerExchangeProtocol.ReadRequest(WindowsStorageBrokerExchangeProtocol.Request(settings.Binding,verb,requestId,operationId,taskScopeSha256,inputManifestSha256,new string('a',64)),settings.Binding);
                    var recorded=new WindowsStorageBrokerExchangeFiles(settings).Journal().Lookup(originalRequest);
                    Write(new{schema=Schema,action,status=recorded.Status,verb,requestId,operationId,taskScopeSha256,inputManifestSha256,installationId=settings.InstallationId,ownerScope=settings.OwnerScope,serviceImageSha256=settings.ServiceImageSha256,protocolVerified=true,proof=recorded.Proof==null?null:Proof(recorded.Proof),effectStarted=false,brokerImplemented=false});return 0;
                }
                var proof=WindowsStorageBrokerPipe.Exchange(settings,verb,requestId,operationId,taskScopeSha256,inputManifestSha256).GetAwaiter().GetResult();
                Write(new{schema=Schema,action,status="exchange-observed",verb,requestId,operationId,taskScopeSha256,inputManifestSha256,installationId=settings.InstallationId,ownerScope=settings.OwnerScope,serviceImageSha256=settings.ServiceImageSha256,protocolVerified=true,proof=Proof(proof),brokerImplemented=false});return 0;
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
                attempted=true;WindowsStorageBrokerControl.Remove(settings,phase=>effectPhase=phase);
                Write(new{schema=Schema,action,status="removed",installationId,ownerScope=scope,serviceRemovedVerified=true,filesRemovedVerified=true,brokerImplemented=false,effectStarted=true});return 0;
            }
        }
        catch(Exception error)
        {
            if(attempted){Write(new{schema=Schema,action,status="outcome-unconfirmed",reason="Preserve the exact protected installation and reconcile its original native service ownership; no bootstrap action was replayed.",failurePhase=effectPhase,errorCategory=error.GetType().Name,nativeCode=error is System.ComponentModel.Win32Exception native?native.NativeErrorCode:(int?)null,brokerImplemented=false,effectStarted=true});return 0;}
            return 2;
        }
    }
}
