using System.Runtime.Versioning;
using System.Security.Principal;

// Invoked only by the closed native installer from its administrator-only stage.
// No caller-selected path, executable, script, disk or volume verb is accepted.
[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerBootstrap
{
    // Private child exit diagnostics only. Every nonzero code remains an
    // unconfirmed setup outcome; it never authorizes replay or broad cleanup.
    private static int RemovalFailure(string phase) => phase switch
    {
        "administrator-manager" => 101,
        "exchange-preflight" => 102,
        "service-configuration" => 103,
        "capture-native-process" => 104,
        "stop-service" => 105,
        "native-process-exit" => 106,
        "exchange-after-exit" => 107,
        "delete-service-configuration" => 108,
        "delete-service" => 109,
        "service-absence" => 110,
        "service-absence-open" => 111,
        "service-absence-configuration" => 112,
        "service-absence-status" => 113,
        "service-absence-delete-pending" => 114,
        "service-absence-wait" => 115,
        "protected-inventory" => 116,
        "installation-readback" => 117,
        "retired-journal-removal" => 118,
        "runtime-removal" => 119,
        "known-file-removal" => 120,
        "root-removal" => 121,
        "service-absence-configuration-required-size" => 122,
        "service-absence-query-configuration-read" => 123,
        "service-absence-configuration-returned-size" => 124,
        "service-absence-configuration-header" => 125,
        "service-absence-configuration-tag" => 126,
        "service-absence-environment" => 127,
        "service-absence-query-configuration-size" => 128,
        "service-absence-configuration-header-type" => 130,
        "service-absence-configuration-header-start-boot" => 131,
        "service-absence-configuration-header-start-system" => 132,
        "service-absence-configuration-header-start-demand" => 133,
        "service-absence-configuration-header-start-disabled" => 134,
        "service-absence-configuration-header-start-unexpected" => 135,
        "service-absence-configuration-header-error-ignore" => 136,
        "service-absence-configuration-header-error-severe" => 137,
        "service-absence-configuration-header-error-critical" => 138,
        "service-absence-configuration-header-error-unexpected" => 139,
        "service-absence-configuration-header-start-auto" => 140,
        "service-absence-configuration-header-error-normal" => 141,
        _ when phase.StartsWith("service-absence-configuration-",StringComparison.Ordinal) => 129,
        _ => 199
    };
    internal static int Run(string[] arguments)
    {
        bool attempted=false;int failure=3;
        try
        {
            if(arguments.Length!=5||arguments[0] is not ("install-bootstrap" or "remove-bootstrap"))return 2;
            using var identity=WindowsIdentity.GetCurrent();if(!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))return 2;
            string action=arguments[0],sid=arguments[1],id=arguments[2],sourceSha=arguments[3],brokerSha=arguments[4];
            string scope=WindowsStorageBrokerFiles.OwnerScope(sid);WindowsStorageBrokerProtocol.Request(new(id,scope,sourceSha),new string('a',64));WindowsStorageBrokerProtocol.Request(new(id,scope,brokerSha),new string('b',64));
            byte[] image=WindowsStorageBrokerFiles.ReadSelf(sourceSha);System.Security.Cryptography.CryptographicOperations.ZeroMemory(image);
            string cache=Environment.GetEnvironmentVariable("DOTNET_BUNDLE_EXTRACT_BASE_DIR")??throw new InvalidOperationException();RuntimePackageMetadata.AssertPrivateRuntime(cache);
            if(action=="install-bootstrap")
            {
                if(sourceSha!=brokerSha)return 2;attempted=true;var settings=WindowsStorageBrokerControl.Install(sid,id,sourceSha);return WindowsStorageBrokerControl.IsRunning(settings)?0:3;
            }
            var original=WindowsStorageBrokerInstallation.Load(sid);if(original.InstallationId!=id||original.ServiceImageSha256!=brokerSha)return 2;
            attempted=true;WindowsStorageBrokerControl.Remove(original, phase => failure=RemovalFailure(phase));return 0;
        }
        catch{return attempted?failure:2;}
    }
}
