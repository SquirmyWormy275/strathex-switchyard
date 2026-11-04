using System.Runtime.Versioning;
using System.Security.Principal;

// Invoked only by the closed native installer from its administrator-only stage.
// No caller-selected path, executable, script, disk or volume verb is accepted.
[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerBootstrap
{
    internal static int Run(string[] arguments)
    {
        bool attempted=false;
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
            attempted=true;WindowsStorageBrokerControl.Remove(original);return 0;
        }
        catch{return attempted?3:2;}
    }
}
