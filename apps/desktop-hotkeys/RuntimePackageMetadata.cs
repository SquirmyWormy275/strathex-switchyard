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
    internal sealed record Module(string Name,string Location,string PathSha256);
    internal static Module[] Modules(string? extraction)
    {
        static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
        static bool Under(string path,string? root)=>!string.IsNullOrEmpty(root)&&Path.IsPathFullyQualified(root)&&Path.GetFullPath(path).StartsWith(Path.GetFullPath(root).TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase);
        using var process=Process.GetCurrentProcess();var modules=new List<Module>();if(process.Modules.Count>512)throw new InvalidOperationException("The native module inventory exceeds its bound.");
        foreach(ProcessModule module in process.Modules)
        {
            string name=module.ModuleName.ToLowerInvariant();if(name is not ("coreclr.dll" or "clrjit.dll" or "hostpolicy.dll" or "hostfxr.dll"))continue;
            string path=module.FileName;modules.Add(new(name,Under(path,extraction)?"configured-extraction":Under(path,AppContext.BaseDirectory)?"adjacent":"other",Hash(path)));
        }
        return modules.ToArray();
    }
    internal static void AssertPrivateRuntime(string extraction)
    {
        // .NET 6+ Windows singlefilehost statically links the CLR/JIT. An empty
        // DLL inventory is expected there; any external runtime must be private.
        if(Modules(extraction).Any(module=>module.Location!="configured-extraction"))throw new InvalidOperationException("A native runtime loaded outside the protected broker cache.");
    }
    internal static int Run()
    {
        try
        {
            string? extraction=Environment.GetEnvironmentVariable("DOTNET_BUNDLE_EXTRACT_BASE_DIR");
            static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
            var modules=Modules(extraction);using var image=File.OpenRead(Environment.ProcessPath??throw new InvalidOperationException());if(image.Length is <1 or >134217728)return 2;
            Console.WriteLine(JsonSerializer.Serialize(new{schema="switchyard-runtime-package-metadata/v1",framework=RuntimeInformation.FrameworkDescription,extractionConfigured=!string.IsNullOrEmpty(extraction),extractionBaseSha256=extraction==null?null:Hash(extraction),mainImageSha256=Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant(),runtimeLinkedIntoImage=modules.Length==0,nativeModules=modules.Select(module=>new{name=module.Name,location=module.Location,pathSha256=module.PathSha256}),effectStarted=false}));return 0;
        }
        catch{return 2;}
    }
}
