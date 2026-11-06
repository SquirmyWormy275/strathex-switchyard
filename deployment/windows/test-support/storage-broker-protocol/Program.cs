using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            // Actual cryptography and parser execution; no service, volume, account or VM.
            using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            using var foreign = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            var binding = new WindowsStorageBrokerProtocol.Binding(Guid.NewGuid().ToString("D"), new string('a',64), new string('b',64));
            string nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            byte[] requestBytes = WindowsStorageBrokerProtocol.Request(binding, nonce);
            var request = WindowsStorageBrokerProtocol.ReadRequest(requestBytes, binding);
            using var storage = JsonDocument.Parse("""
            {"schema":"switchyard-windows-storage-prerequisites/v1","privilegeAssigned":true,"privilegeEnabled":false,"privilegeStateUnchanged":true,"requiresPrivilegedSetup":false,"brokerImplemented":false,"effectStarted":false,"sandboxEnforced":false}
            """);
            byte[] reply = WindowsStorageBrokerProtocol.Reply(binding, request, storage.RootElement, key), publicKey = key.ExportSubjectPublicKeyInfo();
            int pipeTextProtocolChecks = PipeTextProtocolProof.Run();
            int serviceHeaderChecks = ServiceHeaderProof.Run();
            int restrictedChildEventChecks = RestrictedChildApplicationEventsProof.Run();
            int stateLeaseProtocolChecks = StateLeaseProtocolProof.Run();
            int restrictedChildStderrChecks = RestrictedChildStderrProof.Run();
            int coldRandomParserChecks = ColdRandomReport.VerifyParser();
            int stateLockFailureChecks = StateLockFailureEvidence.VerifyParser();
            int descendantQueryProtocolChecks = DescendantQueryProtocolProof.Run();
            int checks = 0;
            void Require(bool value) { if (!value) throw new InvalidOperationException("Storage broker protocol proof failed."); checks++; }
            void Refuses(Action action)
            {
                try { action(); } catch (Exception error) when (error is InvalidOperationException or JsonException or CryptographicException or FormatException or DecoderFallbackException) { checks++; return; }
                throw new InvalidOperationException("An untrusted broker message was accepted.");
            }
            Require(WindowsStorageBrokerProtocol.Verify(reply,binding,request,publicKey).GetProperty("privilegeStateUnchanged").GetBoolean());
            Refuses(()=>WindowsStorageBrokerProtocol.Verify(reply,binding,request,foreign.ExportSubjectPublicKeyInfo()));
            Refuses(()=>WindowsStorageBrokerProtocol.Verify(reply,binding with {InstallationId=Guid.NewGuid().ToString("D")},request,publicKey));
            Refuses(()=>WindowsStorageBrokerProtocol.Verify(reply,binding with {OwnerScope=new string('c',64)},request,publicKey));
            Refuses(()=>WindowsStorageBrokerProtocol.Verify(reply,binding with {ServiceImageSha256=new string('d',64)},request,publicKey));
            var nextRequest=WindowsStorageBrokerProtocol.ReadRequest(WindowsStorageBrokerProtocol.Request(binding,new string('e',64)),binding);
            Refuses(()=>WindowsStorageBrokerProtocol.Verify(reply,binding,nextRequest,publicKey));
            Refuses(()=>WindowsStorageBrokerProtocol.Verify(reply,binding,request,publicKey.Concat(new byte[]{0}).ToArray()));
            Refuses(()=>WindowsStorageBrokerProtocol.Verify(new byte[16385],binding,request,publicKey));
            var envelope=JsonNode.Parse(reply)!.AsObject();envelope["payload"]=envelope["payload"]!.GetValue<string>().Replace("privilegeEnabled\":false","privilegeEnabled\":true",StringComparison.Ordinal);
            Refuses(()=>WindowsStorageBrokerProtocol.Verify(Encoding.UTF8.GetBytes(envelope.ToJsonString()),binding,request,publicKey));
            envelope=JsonNode.Parse(reply)!.AsObject();envelope["command"]="untrusted";
            Refuses(()=>WindowsStorageBrokerProtocol.Verify(Encoding.UTF8.GetBytes(envelope.ToJsonString()),binding,request,publicKey));
            string raw=Encoding.UTF8.GetString(requestBytes);
            Refuses(()=>WindowsStorageBrokerProtocol.ReadRequest(Encoding.UTF8.GetBytes(raw.Replace("\"metadata\"","\"attach\"",StringComparison.Ordinal)),binding));
            Refuses(()=>WindowsStorageBrokerProtocol.ReadRequest(Encoding.UTF8.GetBytes(raw.Replace("\"nonce\":","\"nonce\":\""+nonce+"\",\"nonce\":",StringComparison.Ordinal)),binding));
            Refuses(()=>WindowsStorageBrokerProtocol.ReadRequest(new byte[]{255,255},binding));
            Refuses(()=>WindowsStorageBrokerProtocol.Request(binding,"replayed-or-arbitrary"));
            using var changed=JsonDocument.Parse(storage.RootElement.GetRawText().Replace("\"effectStarted\":false","\"effectStarted\":true",StringComparison.Ordinal));
            Refuses(()=>WindowsStorageBrokerProtocol.Reply(binding,request,changed.RootElement,key));
            using var wrongCurve=ECDsa.Create(ECCurve.NamedCurves.nistP384);
            Refuses(()=>WindowsStorageBrokerProtocol.Reply(binding,request,storage.RootElement,wrongCurve));
            int exchangeProtocolChecks=ExchangeProtocolProof.Run(),exchangeJournalChecks=ExchangeJournalProof.Run(),exchangeFactsChecks=ExchangeFactsProof.Run(),indexInputChecks=ReviewedIndexProof.Run(),historyInputChecks=ReviewedHistoryProof.Run(),protectedFilesChecks=0,nativeServiceChecks=0,nativeExchangeChecks=0;
            object? nativeRestrictedHostProof = null;
            if(args.Length>0)
            {
                if(!OperatingSystem.IsWindows()||args.Length!=1)throw new InvalidOperationException("Choose only the explicit disposable Windows proof.");
                if(args[0]=="--native-files")protectedFilesChecks=NativeFilesProof.Run();
                else if(args[0]=="--native-service")nativeServiceChecks=NativeServiceProof.Run();
                else if(args[0]=="--native-exchange")nativeExchangeChecks=NativeExchangeProof.Run();
                else if(args[0]=="--native-host-owner")nativeRestrictedHostProof=NativeRestrictedHostProof.Run();
                else throw new InvalidOperationException("The native proof flag is not recognized.");
            }
            Console.WriteLine(JsonSerializer.Serialize(new {schema="switchyard-storage-broker-protocol-proof/v1",success=true,checks,pipeTextProtocolChecks,serviceHeaderChecks,restrictedChildEventChecks,stateLeaseProtocolChecks,restrictedChildStderrChecks,coldRandomParserChecks, stateLockFailureChecks,descendantQueryProtocolChecks,exchangeProtocolChecks,exchangeJournalChecks,exchangeFactsChecks,indexInputChecks,historyInputChecks,protectedFilesChecks,nativeServiceChecks,nativeExchangeChecks,nativeRestrictedHostProof,serviceInstalled=false,volumeOpened=nativeExchangeChecks>0||nativeRestrictedHostProof!=null,guestLaunched=false}));
            return 0;
        }
        catch(Exception error)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { schema="switchyard-storage-broker-protocol-proof/v1",success=false,errorCategory=error.GetType().Name,nativeCode=error is System.ComponentModel.Win32Exception native?(int?)native.NativeErrorCode:null,errorHResult=error.HResult,nativeExchangeChecks=OperatingSystem.IsWindows()?NativeExchangeProof.CompletedChecks:0,failedCheckPhase=OperatingSystem.IsWindows()?NativeExchangeProof.Phase:null,restrictedHostPhase=OperatingSystem.IsWindows()?NativeRestrictedHostProof.Phase:null,restrictedHostCreatorPrivileges=OperatingSystem.IsWindows()?NativeRestrictedHostProof.CreatorPrivileges:null,restrictedHostHistoricalFilterFlags=OperatingSystem.IsWindows()?NativeRestrictedHostProof.HistoricalFilterObservations:null,restrictedHostHistoricalFilterBytes=OperatingSystem.IsWindows()?NativeRestrictedHostProof.HistoricalFilterWidths:null,restrictedHostTokenRead=OperatingSystem.IsWindows()?NativeRestrictedHostProof.TokenReadDiagnostic:null,restrictedHostChildExit=OperatingSystem.IsWindows()?NativeRestrictedHostProof.ChildExitDiagnostic:null,restrictedHostApplicationEvents=OperatingSystem.IsWindows()?NativeRestrictedHostProof.ApplicationEventDiagnostic:null,restrictedHostUserObjectAccess=OperatingSystem.IsWindows()?NativeRestrictedHostProof.UserObjectAccessDiagnostic:null,restrictedHostNamespaceAccess=OperatingSystem.IsWindows()?NativeRestrictedHostProof.NamespaceAccessDiagnostic:null,restrictedHostStdio=OperatingSystem.IsWindows()?NativeRestrictedHostProof.StdioDiagnostic:null,restrictedHostRandomAccess=OperatingSystem.IsWindows()?NativeRestrictedHostProof.RandomAccessDiagnostic:null,restrictedHostEnvironment=OperatingSystem.IsWindows()?NativeRestrictedHostProof.EnvironmentDiagnostic:null,restrictedHostColdRandom=OperatingSystem.IsWindows()?NativeRestrictedHostProof.ColdRandomDiagnostic:null,restrictedHostUnmodifiedColdRandom=OperatingSystem.IsWindows()?NativeRestrictedHostProof.UnmodifiedColdRandomDiagnostic:null,restrictedHostLeaseConsoles=OperatingSystem.IsWindows()?NativeRestrictedHostProof.LeaseConsoleDiagnostic:null,restrictedHostTokenObjectSecurity=OperatingSystem.IsWindows()?NativeRestrictedHostProof.TokenObjectSecurityDiagnostic:null,restrictedHostSelfTokenQueryAcl=OperatingSystem.IsWindows()?NativeRestrictedHostProof.SelfTokenQueryAclDiagnostic:null,restrictedHostDescendantSelfQueryAcl=OperatingSystem.IsWindows()?NativeRestrictedHostProof.DescendantSelfQueryDiagnostic:null }));
            return 2;
        }
    }
}
