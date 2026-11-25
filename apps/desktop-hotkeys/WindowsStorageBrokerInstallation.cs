using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerInstallation
{
    internal const string Schema="switchyard-windows-storage-broker-installation/v1";
    internal const string Executable="Switchyard.StorageBroker.exe", Configuration="installation.json", PrivateKey="identity.pk8";
    internal sealed record Settings(string InstallationId,string ClientSid,string OwnerScope,string ServiceImageSha256,string PublicKey)
    {
        internal WindowsStorageBrokerProtocol.Binding Binding=>new(InstallationId,OwnerScope,ServiceImageSha256);
        internal string Root=>WindowsStorageBrokerFiles.Root(ClientSid);
        internal string ServiceName=>"SwitchyardStorage-"+OwnerScope;
        internal string ImagePath=>Path.Combine(Root,Executable);
        internal string ServiceCommand=>"\""+ImagePath+"\" --windows-storage-broker-service";
    }
    private static Exception Invalid()=>new InvalidOperationException("The original protected storage broker installation did not verify.");
    private static void Exact(JsonElement value,params string[] fields)
    {
        if(value.ValueKind!=JsonValueKind.Object)throw Invalid();var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var property in value.EnumerateObject())if(!fields.Contains(property.Name,StringComparer.Ordinal)||!seen.Add(property.Name))throw Invalid();
        if(seen.Count!=fields.Length)throw Invalid();
    }
    internal static byte[] PublicKeyBytes(Settings settings)
    {
        if(settings.PublicKey.Length>344)throw Invalid();byte[] bytes=Convert.FromBase64String(settings.PublicKey);
        if(bytes.Length is <64 or >256||Convert.ToBase64String(bytes)!=settings.PublicKey)throw Invalid();
        using var key=ECDsa.Create();key.ImportSubjectPublicKeyInfo(bytes,out int read);
        if(read!=bytes.Length||key.KeySize!=256||key.ExportParameters(false).Curve.Oid.Value!="1.2.840.10045.3.1.7")throw Invalid();return bytes;
    }
    internal static Settings Load(string sid)
    {
        string root=WindowsStorageBrokerFiles.Root(sid);using var pinned=WindowsStorageBrokerFiles.PinDirectory(root,sid);
        byte[] data=WindowsStorageBrokerFiles.ReadFile(Path.Combine(root,Configuration),sid,4096);
        try
        {
            using var json=JsonDocument.Parse(data,new JsonDocumentOptions{MaxDepth=4});var value=json.RootElement;
            Exact(value,"schema","installationId","clientSid","ownerScope","serviceImageSha256","publicKey");if(value.GetProperty("schema").GetString()!=Schema)throw Invalid();
            var settings=new Settings(value.GetProperty("installationId").GetString()??"",value.GetProperty("clientSid").GetString()??"",value.GetProperty("ownerScope").GetString()??"",value.GetProperty("serviceImageSha256").GetString()??"",value.GetProperty("publicKey").GetString()??"");
            if(settings.ClientSid!=sid||settings.OwnerScope!=WindowsStorageBrokerFiles.OwnerScope(sid))throw Invalid();
            WindowsStorageBrokerProtocol.Request(settings.Binding,new string('a',64));PublicKeyBytes(settings);
            byte[] image=WindowsStorageBrokerFiles.ReadFile(settings.ImagePath,sid,134217728,executable:true);
            try{if(Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant()!=settings.ServiceImageSha256)throw Invalid();}finally{CryptographicOperations.ZeroMemory(image);}
            return settings;
        }
        finally{CryptographicOperations.ZeroMemory(data);}
    }
    internal static Settings LoadSelf()
    {
        string path=Environment.ProcessPath??throw Invalid(),root=Path.GetDirectoryName(path)??throw Invalid();
        string sid=WindowsStorageBrokerFiles.OwnerForRoot(root);var settings=Load(sid);
        if(!Path.GetFullPath(path).Equals(settings.ImagePath,StringComparison.OrdinalIgnoreCase))throw Invalid();return settings;
    }
    internal static ECDsa OpenSigningKey(Settings settings)
    {
        byte[] bytes=WindowsStorageBrokerFiles.ReadFile(Path.Combine(settings.Root,PrivateKey),settings.ClientSid,4096,clientRead:false);
        var key=ECDsa.Create();
        try
        {
            key.ImportPkcs8PrivateKey(bytes,out int read);if(read!=bytes.Length||!key.ExportSubjectPublicKeyInfo().AsSpan().SequenceEqual(PublicKeyBytes(settings)))throw Invalid();return key;
        }
        catch{key.Dispose();throw;}
        finally{CryptographicOperations.ZeroMemory(bytes);}
    }
    // Only an already elevated, separately authorized installer may call this.
    // It refuses every existing root; repair/update needs its own exact review.
    internal static Settings Create(string sid,string installationId,string expectedSelfSha256)
    {
        string scope=WindowsStorageBrokerFiles.OwnerScope(sid);WindowsStorageBrokerProtocol.Request(new(installationId,scope,expectedSelfSha256),new string('a',64));
        byte[] image=WindowsStorageBrokerFiles.ReadSelf(expectedSelfSha256);using var key=ECDsa.Create(ECCurve.NamedCurves.nistP256);
        byte[] secret=key.ExportPkcs8PrivateKey();
        try
        {
            var settings=new Settings(installationId,sid,scope,expectedSelfSha256,Convert.ToBase64String(key.ExportSubjectPublicKeyInfo()));
            using var directory=WindowsStorageBrokerFiles.CreateDirectory(settings.Root,sid);
            using var runtime=WindowsStorageBrokerFiles.CreateDirectory(WindowsStorageBrokerRuntime.Root(settings),sid,clientRead:false);
            WindowsStorageBrokerFiles.CreateFile(settings.ImagePath,sid,image,executable:true);
            WindowsStorageBrokerFiles.CreateFile(Path.Combine(settings.Root,PrivateKey),sid,secret,clientRead:false);
            byte[] config=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{schema=Schema,installationId,clientSid=sid,ownerScope=scope,serviceImageSha256=expectedSelfSha256,publicKey=settings.PublicKey}));
            WindowsStorageBrokerFiles.CreateFile(Path.Combine(settings.Root,Configuration),sid,config);
            return Load(sid);
        }
        finally{CryptographicOperations.ZeroMemory(image);CryptographicOperations.ZeroMemory(secret);}
    }
}
