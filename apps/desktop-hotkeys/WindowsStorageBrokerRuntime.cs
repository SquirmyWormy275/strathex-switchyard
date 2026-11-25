using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text.Json;

// The bundled CLR extracts before Main. Its cache is created with System/BA-only
// access before SCM starts the service and is inventoried before serving clients.
[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerRuntime
{
    internal const string DirectoryName="runtime",InventoryName="runtime-inventory.json";
    private sealed record Entry(string Path,WindowsStorageBrokerFiles.PrivateIdentity Identity);
    private sealed record Inventory(string Schema,string InstallationId,string ServiceImageSha256,Entry[] Entries);
    private static Exception Invalid()=>new InvalidOperationException("The original private broker runtime cache did not verify; preserve it for reconciliation.");
    internal static string Root(WindowsStorageBrokerInstallation.Settings settings)=>Path.Combine(settings.Root,DirectoryName);
    private static Entry[] Observe(WindowsStorageBrokerInstallation.Settings settings)
    {
        var entries=new List<Entry>();long bytes=0;string root=Root(settings);
        void Visit(string path,int depth)
        {
            if(depth>8||entries.Count>=64)throw Invalid();
            string relative=Path.GetRelativePath(root,path).Replace('\\','/');
            // .NET 8 bundle IDs retain base64 '+' and '=' (only '/' becomes '_').
            if(relative!="."&&(!System.Text.RegularExpressions.Regex.IsMatch(relative,@"^[A-Za-z0-9_./+=-]{1,512}$")||relative.Split('/').Any(p=>p is "" or "." or "..")))throw Invalid();
            var attributes=File.GetAttributes(path);if((attributes&FileAttributes.ReparsePoint)!=0)throw Invalid();bool directory=attributes.HasFlag(FileAttributes.Directory);
            var identity=WindowsStorageBrokerFiles.InspectPrivate(path,settings.ClientSid,directory);bytes=checked(bytes+identity.Size);if(bytes>536870912)throw Invalid();
            entries.Add(new(relative,identity));
            if(directory)foreach(string child in Directory.EnumerateFileSystemEntries(path).Order(StringComparer.Ordinal))Visit(child,depth+1);
        }
        using var pin=WindowsStorageBrokerFiles.PinDirectory(root,settings.ClientSid,clientRead:false);Visit(root,0);
        if(entries.Count<1)throw Invalid();
        return entries.OrderBy(e=>e.Path,StringComparer.Ordinal).ToArray();
    }
    private static byte[] Bytes(WindowsStorageBrokerInstallation.Settings settings,Entry[] entries)=>JsonSerializer.SerializeToUtf8Bytes(new Inventory("switchyard-windows-broker-runtime/v1",settings.InstallationId,settings.ServiceImageSha256,entries));
    private static void Compare(WindowsStorageBrokerInstallation.Settings settings,Entry[] entries)
    {
        byte[] retained=WindowsStorageBrokerFiles.ReadFile(Path.Combine(settings.Root,InventoryName),settings.ClientSid,65536,clientRead:false),observed=Bytes(settings,entries);
        try{if(!CryptographicOperations.FixedTimeEquals(SHA256.HashData(retained),SHA256.HashData(observed)))throw Invalid();}
        finally{CryptographicOperations.ZeroMemory(retained);CryptographicOperations.ZeroMemory(observed);}
    }
    internal static void SealOrVerify(WindowsStorageBrokerInstallation.Settings settings)
    {
        if(WindowsStorageBrokerFiles.CurrentOwnerSid()!="S-1-5-18"||Environment.GetEnvironmentVariable("DOTNET_BUNDLE_EXTRACT_BASE_DIR")!=Root(settings))throw Invalid();
        RuntimePackageMetadata.AssertPrivateRuntime(Root(settings));
        Entry[] entries=Observe(settings);string inventory=Path.Combine(settings.Root,InventoryName);
        if(File.Exists(inventory))Compare(settings,entries);
        else WindowsStorageBrokerFiles.CreateFile(inventory,settings.ClientSid,Bytes(settings,entries),clientRead:false);
        Compare(settings,Observe(settings));
    }
    internal static void RemoveVerified(WindowsStorageBrokerInstallation.Settings settings)
    {
        // Caller has already independently observed exact SCM and process exit.
        Entry[] entries=Observe(settings);Compare(settings,entries);
        foreach(var entry in entries.Where(e=>!e.Identity.Directory))File.Delete(Path.Combine(Root(settings),entry.Path.Replace('/',Path.DirectorySeparatorChar)));
        foreach(var entry in entries.Where(e=>e.Identity.Directory).OrderByDescending(e=>e.Path.Length))Directory.Delete(entry.Path=="."?Root(settings):Path.Combine(Root(settings),entry.Path.Replace('/',Path.DirectorySeparatorChar)));
        File.Delete(Path.Combine(settings.Root,InventoryName));
        if(Directory.Exists(Root(settings))||File.Exists(Path.Combine(settings.Root,InventoryName)))throw Invalid();
    }
}
