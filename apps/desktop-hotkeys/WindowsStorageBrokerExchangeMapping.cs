using System.Runtime.Versioning;
using System.Text.Json;

[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerExchangeMapping
{
    private static Exception Invalid() => new InvalidOperationException("The original protected broker mapping did not verify; no arbitrary directory was admitted.");
    private static void Exact(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid(); var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject()) if (!names.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name)) throw Invalid();
        if (seen.Count != names.Length) throw Invalid();
    }
    private static bool SameIdentity(JsonElement a, JsonElement b)
    {
        Exact(a, "device", "inode"); Exact(b, "device", "inode");
        return a.GetProperty("device").GetString() == b.GetProperty("device").GetString() && a.GetProperty("inode").GetString() == b.GetProperty("inode").GetString();
    }
    internal static WindowsStorageBrokerInstallation.Settings Validate(JsonElement binding)
    {
        string operationId = binding.GetProperty("operationId").GetString() ?? throw Invalid(); var broker = binding.GetProperty("broker");
        Exact(broker, "installationId", "ownerScope", "serviceImageSha256", "taskScopeSha256", "inputManifestSha256");
        var settings = WindowsStorageBrokerInstallation.Load(WindowsStorageBrokerFiles.CurrentOwnerSid()); var files = new WindowsStorageBrokerExchangeFiles(settings);
        string task = broker.GetProperty("taskScopeSha256").GetString() ?? "", inputs = broker.GetProperty("inputManifestSha256").GetString() ?? "";
        // Validate every scope field through the closed request contract, but
        // do not send an effect or create a journal during mapping admission.
        _ = WindowsStorageBrokerExchangeProtocol.Request(settings.Binding, "inspect", Guid.NewGuid().ToString("D"), operationId, task, inputs, new string('a', 64));
        if (broker.GetProperty("installationId").GetString() != settings.InstallationId || broker.GetProperty("ownerScope").GetString() != settings.OwnerScope || broker.GetProperty("serviceImageSha256").GetString() != settings.ServiceImageSha256
            || !files.DiskRoot(operationId).Equals(binding.GetProperty("stagingRoot").GetString(), StringComparison.OrdinalIgnoreCase)) throw Invalid();
        var current = files.Journal().Current(operationId);
        if (current is not { Phase: "recorded", Proof.State: "mounted", Proof.Attached: true, Proof.Mounted: true, Proof.ExchangeQuotaEnforced: true } || current.TaskScopeSha256 != task || current.InputManifestSha256 != inputs) throw Invalid();
        var image = WindowsStorageBrokerExchangeFacts.Image(files.ReadFact(operationId, "image.json"), operationId);
        string volume = WindowsStorageBrokerExchangeFacts.Mount(files.ReadFact(operationId, "mount.json"), operationId);
        if (binding.GetProperty("footerSha256").GetString() != image.GetProperty("footerSha256").GetString() || !volume.Equals(binding.GetProperty("volumeGuid").GetString(), StringComparison.OrdinalIgnoreCase)
            || !SameIdentity(binding.GetProperty("stagingIdentity"), image.GetProperty("stagingIdentity")) || !SameIdentity(binding.GetProperty("imageIdentity"), image.GetProperty("imageIdentity")) || !SameIdentity(binding.GetProperty("mountIdentity"), image.GetProperty("mountIdentity"))) throw Invalid();
        return settings;
    }
    internal static JsonElement Observe(WindowsStorageBrokerInstallation.Settings settings, string operationId, string taskScopeSha256, string inputManifestSha256)
    {
        var observed = WindowsStorageBrokerPipe.Exchange(settings, "inspect", Guid.NewGuid().ToString("D"), operationId, taskScopeSha256, inputManifestSha256).GetAwaiter().GetResult();
        if (observed.State != "mounted" || observed.EffectStarted || !observed.Attached || !observed.Mounted || !observed.ExchangeQuotaEnforced) throw Invalid();
        var files = new WindowsStorageBrokerExchangeFiles(settings); var image = WindowsStorageBrokerExchangeFacts.Image(files.ReadFact(operationId, "image.json"), operationId);
        string volume = WindowsStorageBrokerExchangeFacts.Mount(files.ReadFact(operationId, "mount.json"), operationId);
        var binding = JsonSerializer.SerializeToElement(new
        {
            schema = "switchyard-windows-bounded-volume/v1", operationId, stagingRoot = files.DiskRoot(operationId), stagingIdentity = image.GetProperty("stagingIdentity"), imageIdentity = image.GetProperty("imageIdentity"), mountIdentity = image.GetProperty("mountIdentity"), footerSha256 = image.GetProperty("footerSha256"), volumeGuid = volume,
            broker = new { installationId = settings.InstallationId, ownerScope = settings.OwnerScope, serviceImageSha256 = settings.ServiceImageSha256, taskScopeSha256, inputManifestSha256 }
        });
        using var pinned = ReviewedInputStager.PinBoundedMapping(binding, Path.Combine(files.DiskRoot(operationId), "mount")); return binding;
    }
}
