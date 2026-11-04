using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// Read-only deployment diagnostics: never emit local paths or environment values.
[SupportedOSPlatform("windows")]
internal static class RuntimePackageMetadata
{
    internal static int Run()
    {
        try
        {
            string? extraction=Environment.GetEnvironmentVariable("DOTNET_BUNDLE_EXTRACT_BASE_DIR");
            static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
            static bool Under(string path,string? root)=>!string.IsNullOrEmpty(root)&&Path.IsPathFullyQualified(root)&&Path.GetFullPath(path).StartsWith(Path.GetFullPath(root).TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase);
            using var process=Process.GetCurrentProcess();var modules=new List<object>();if(process.Modules.Count>512)return 2;
            foreach(ProcessModule module in process.Modules)
            {
                string name=module.ModuleName.ToLowerInvariant();if(name is not ("coreclr.dll" or "clrjit.dll" or "hostpolicy.dll"))continue;
                string path=module.FileName;
                modules.Add(new{name,location=Under(path,extraction)?"configured-extraction":Under(path,AppContext.BaseDirectory)?"adjacent":"other",pathSha256=Hash(path)});
            }
            Console.WriteLine(JsonSerializer.Serialize(new{schema="switchyard-runtime-package-metadata/v1",framework=RuntimeInformation.FrameworkDescription,extractionConfigured=!string.IsNullOrEmpty(extraction),extractionBaseSha256=extraction==null?null:Hash(extraction),nativeModules=modules,effectStarted=false}));return 0;
        }
        catch{return 2;}
    }
}
