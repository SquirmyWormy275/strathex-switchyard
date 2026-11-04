using System.Runtime.Versioning;
using System.Text.Json;

[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerDiagnostic
{
    internal const string FileName="first-request-failure.json";
    private static readonly string[] Phases={"connection","frame","caller","request","storage","signature","write","acknowledgement","service-loop"};
    internal static void RetainFirst(WindowsStorageBrokerInstallation.Settings settings,string phase,Exception error,bool callerMatched)
    {
        try
        {
            if(WindowsStorageBrokerFiles.CurrentOwnerSid()!="S-1-5-18"||!Phases.Contains(phase))return;
            // Only the first bounded failure is created. Never overwrite an
            // existing record or log paths, request bodies, tokens or key bytes.
            WindowsStorageBrokerFiles.CreateFile(Path.Combine(settings.Root,FileName),settings.ClientSid,JsonSerializer.SerializeToUtf8Bytes(new{schema="switchyard-windows-broker-diagnostic/v1",installationId=settings.InstallationId,phase,errorCategory=error.GetType().Name,callerMatched}));
        }
        catch{/* Diagnostic availability cannot authorize an effect or a retry. */}
    }
    internal static JsonElement? Read(WindowsStorageBrokerInstallation.Settings settings)
    {
        string path=Path.Combine(settings.Root,FileName);if(!File.Exists(path))return null;
        byte[] bytes=WindowsStorageBrokerFiles.ReadFile(path,settings.ClientSid,2048);using var json=JsonDocument.Parse(bytes);var value=json.RootElement;
        string[] fields={"schema","installationId","phase","errorCategory","callerMatched"};var seen=new HashSet<string>();
        foreach(var property in value.EnumerateObject())if(!fields.Contains(property.Name)||!seen.Add(property.Name))throw new InvalidOperationException("The bounded broker diagnostic changed.");
        if(seen.Count!=5||value.GetProperty("schema").GetString()!="switchyard-windows-broker-diagnostic/v1"||value.GetProperty("installationId").GetString()!=settings.InstallationId||!Phases.Contains(value.GetProperty("phase").GetString())||!System.Text.RegularExpressions.Regex.IsMatch(value.GetProperty("errorCategory").GetString()??"",@"^[A-Za-z][A-Za-z0-9]{0,127}$")||value.GetProperty("callerMatched").ValueKind is not (JsonValueKind.True or JsonValueKind.False))throw new InvalidOperationException("The bounded broker diagnostic did not verify.");
        return value.Clone();
    }
}
